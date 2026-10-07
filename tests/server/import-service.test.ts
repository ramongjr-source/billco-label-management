import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import ExcelJS from 'exceljs'
import { findProductByPartNumber, migrateDatabase, openProductDatabase, seedProducts } from '../../database/index.js'
import { importProducts, previewProductImport, WorkbookImportError } from '../../server/import/index.js'
import { MAX_EXPANDED_BYTES, MAX_WORKBOOK_BYTES, validateWorkbookArchive } from '../../server/import/zip.js'

const headers = ['Part Number', 'Description', 'Bulk Fixed Quantity', 'Package Fixed Quantity', 'Barcode Value', 'Status']
const valid = ['NEW-001', 'BRASS COUPLING 3/8', 120, 12, 'DIRECT-0001', 'Active']

function database(t: TestContext) {
  const db = openProductDatabase(':memory:')
  migrateDatabase(db)
  seedProducts(db)
  t.after(() => db.close())
  return db
}

async function workbook(rows: ExcelJS.CellValue[][], columns = headers): Promise<Buffer> {
  const file = new ExcelJS.Workbook()
  const sheet = file.addWorksheet('Products')
  sheet.addRow(columns)
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await file.xlsx.writeBuffer())
}

test('preview classifies additions and updates without mutation; commit upserts every supplied field', async (t) => {
  const db = database(t)
  const before = findProductByPartNumber(db, '5080')
  const buffer = await workbook([
    ['5080', 'Changed master description', 222, 22, 'EXCEL-0005080', 'Inactive'],
    valid,
  ])
  const preview = await previewProductImport(db, buffer)
  assert.equal(preview.added, 1)
  assert.equal(preview.updated, 1)
  assert.deepEqual(preview.rows.map((row) => row.action), ['update', 'add'])
  assert.deepEqual(findProductByPartNumber(db, '5080'), before)
  assert.equal(findProductByPartNumber(db, 'NEW-001'), undefined)

  const imported = await importProducts(db, buffer)
  assert.equal(imported.added, 1)
  assert.equal(imported.updated, 1)
  assert.equal('rows' in imported, false)
  assert.deepEqual(findProductByPartNumber(db, '5080'), {
    partNumber: '5080', description: 'Changed master description', bulkFixedQuantity: 222,
    packageFixedQuantity: 22, barcodeValue: 'EXCEL-0005080', status: 'inactive',
  })
  assert.equal(findProductByPartNumber(db, 'NEW-001')?.barcodeValue, 'DIRECT-0001')
  const repeated = await importProducts(db, buffer)
  assert.equal(repeated.added, 0)
  assert.equal(repeated.updated, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get()?.count, 6)
})

test('legacy descriptions join trimmed fragments, ignore blank rows, and normalize header aliases', async (t) => {
  const db = database(t)
  const file = new ExcelJS.Workbook()
  const sheet = file.addWorksheet('Legacy')
  sheet.addRow([' ', '\t'])
  sheet.addRow([' PN ', 'Description 1', 'description_2', 'DESCRIPTION3', 'Description4', 'Description5', 'bulkFixedQuantity', 'package_fixed_quantity', 'Barcode_Value', 'STATUS'])
  sheet.addRow([' 000123 ', ' HEX ', '', 'HEAD', null, ' PIPE PLUG ', '500', 50, ' 00000BC ', ' aCtIvE '])
  sheet.addRow([' ', '\t', null, ' ', ' ', '', ' ', null, '\t', ' '])
  sheet.addRow(['000124', 'ADAPTER', '', '', '', '', 200, 20, 'EXPLICIT-BC', 'INACTIVE'])
  const buffer = Buffer.from(await file.xlsx.writeBuffer())
  const preview = await previewProductImport(db, buffer)
  assert.equal(preview.totalRows, 3)
  assert.equal(preview.blankRows, 1)
  assert.equal(preview.invalidRows, 0)
  assert.equal(preview.rows[0].row, 3)
  assert.equal(preview.rows[0].product.partNumber, '000123')
  assert.equal(preview.rows[0].product.description, 'HEX HEAD PIPE PLUG')
  assert.equal(preview.rows[0].product.barcodeValue, ' 00000BC ')
  await importProducts(db, buffer)
  assert.equal(findProductByPartNumber(db, '000124')?.status, 'inactive')
})

test('direct description is a fallback and conflicting populated description sources invalidate a row', async (t) => {
  const db = database(t)
  const buffer = await workbook([
    ['FALLBACK', 'Direct description', '', '', 10, 1, 'FALLBACK-BC', 'Active'],
    ['EQUAL', 'HEX HEAD', ' HEX ', 'HEAD ', 10, 1, 'EQUAL-BC', 'Active'],
    ['CONFLICT', 'Silent data loss?', 'HEX', 'HEAD', 10, 1, 'CONFLICT-BC', 'Active'],
  ], ['Part Number', 'Description', 'Description1', 'Description2', 'Bulk Fixed Quantity', 'Package Fixed Quantity', 'Barcode Value', 'Status'])
  const preview = await previewProductImport(db, buffer)
  assert.equal(preview.added, 2)
  assert.equal(preview.invalidRows, 1)
  assert.match(preview.errors[0].message, /differs/)
  assert.equal(preview.errors[0].row, 4)
  assert.deepEqual(preview.rows.map((row) => row.product.description), ['Direct description', 'HEX HEAD'])
})

test('legacy numeric description fragments are consolidated with text instead of being discarded', async (t) => {
  const db = database(t)
  const buffer = await workbook([
    ['NUMERIC-DESC', ' HEX ', 0, 'HEAD', 0.375, ' PIPE PLUG ', 100, 10, 'DESC-BARCODE', 'Active'],
  ], ['Part Number', 'Description1', 'Description2', 'Description3', 'Description4', 'Description5', 'Bulk Fixed Quantity', 'Package Fixed Quantity', 'Barcode Value', 'Status'])
  const result = await importProducts(db, buffer)
  assert.equal(result.added, 1)
  assert.equal(result.invalidRows, 0)
  assert.equal(findProductByPartNumber(db, 'NUMERIC-DESC')?.description, 'HEX 0 HEAD 0.375 PIPE PLUG')
})

test('all exact trimmed duplicate part numbers are invalid, including a duplicate with another validation error', async (t) => {
  const db = database(t)
  const buffer = await workbook([
    [' DUP ', 'First', 10, 1, 'FIRST', 'Active'],
    ['DUP', 'Second', 0, 1, 'SECOND', 'Active'],
    ['Dup', 'Case-sensitive distinct key', 10, 1, 'CASE', 'Active'],
  ])
  const preview = await previewProductImport(db, buffer)
  assert.equal(preview.invalidRows, 2)
  assert.equal(preview.added, 1)
  assert.deepEqual(preview.errors.filter((error) => /more than once/.test(error.message)).map((error) => error.row), [2, 3])
  const result = await importProducts(db, buffer)
  assert.equal(result.added, 1)
  assert.equal(findProductByPartNumber(db, 'DUP'), undefined)
  assert.equal(findProductByPartNumber(db, 'Dup')?.barcodeValue, 'CASE')
})

test('every required field is validated and an empty barcode never falls back to PN or an existing barcode', async (t) => {
  const db = database(t)
  const original = findProductByPartNumber(db, '5080')
  const invalid: ExcelJS.CellValue[][] = [
    [' ', ...valid.slice(1)],
    ['LONG'.repeat(17), ...valid.slice(1)],
    ['CONTROL\nPN', ...valid.slice(1)],
    ['DESC', '\u00a0\ufeff', ...valid.slice(2)],
    ['LONGDESC', 'D'.repeat(513), ...valid.slice(2)],
    ['ZERO', valid[1], 0, 1, 'B', 'Active'],
    ['FRACTION', valid[1], 1, 1.5, 'B', 'Active'],
    ['OVERMAX', valid[1], 1000000, 1, 'B', 'Active'],
    ['5080', 'Must not overwrite', 1, 1, '', 'Active'],
    ['UNICODEBC', valid[1], 1, 1, 'BÁR', 'Active'],
    ['LONGBC', valid[1], 1, 1, 'B'.repeat(129), 'Active'],
    ['STATUS', valid[1], 1, 1, 'B', 'Archived'],
    valid,
  ]
  const result = await importProducts(db, await workbook(invalid))
  assert.equal(result.invalidRows, 12)
  assert.equal(result.added, 1)
  assert.deepEqual(findProductByPartNumber(db, '5080'), original)
  assert.equal(findProductByPartNumber(db, 'NEW-001')?.barcodeValue, 'DIRECT-0001')
  assert.equal(new Set(result.errors.map((error) => error.row)).size, 12)
})

test('rich text and numeric zero-padding preserve direct identifiers while unsafe numeric identifiers are rejected', async (t) => {
  const db = database(t)
  const file = new ExcelJS.Workbook()
  const sheet = file.addWorksheet('Products')
  sheet.addRow(headers)
  const padded = sheet.addRow([123, { richText: [{ text: 'Rich ' }, { text: 'description' }] }, 1, 999999, 7, 'Active'])
  padded.getCell(1).numFmt = '000000'
  padded.getCell(5).numFmt = '00000'
  sheet.addRow([{ richText: [{ text: '00' }, { text: 'TEXT' }] }, 'Text identifier', 1, 1, { richText: [{ text: ' 00' }, { text: ' BAR ' }] }, 'Active'])
  sheet.addRow([1234567890123456, 'Precision unsupported', 1, 1, 'B', 'Active'])
  sheet.addRow([12.5, 'Fraction unsupported', 1, 1, 'B', 'Active'])
  const formatted = sheet.addRow([345, 'Format unsupported', 1, 1, 'B', 'Active'])
  formatted.getCell(1).numFmt = '0.00'
  sheet.addRow(['BADBAR', 'Barcode precision unsupported', 1, 1, 1234567890123456, 'Active'])
  const preview = await previewProductImport(db, Buffer.from(await file.xlsx.writeBuffer()))
  assert.equal(preview.invalidRows, 4)
  assert.equal(preview.added, 2)
  assert.equal(preview.rows[0].product.partNumber, '000123')
  assert.equal(preview.rows[0].product.barcodeValue, '00007')
  assert.equal(preview.rows[0].product.description, 'Rich description')
  assert.equal(preview.rows[1].product.partNumber, '00TEXT')
  assert.equal(preview.rows[1].product.barcodeValue, ' 00 BAR ')
  assert.ok(preview.errors.every((error) => /text|safe integer|format/.test(error.message)))
})

test('formula cells are errors even when they have cached values or appear under unknown prototype-name headers', async (t) => {
  const db = database(t)
  const buffer = await workbook([
    [{ formula: '1+1', result: 2 }, ...valid.slice(1), 'ordinary', 'ordinary'],
    ['BARFORMULA', valid[1], 1, 1, { formula: '"cached"', result: 'cached' }, 'Active', 'ordinary', 'ordinary'],
    ['EXTRAFORMULA', ...valid.slice(1), { formula: '2+2', result: 4 }, 'ordinary'],
    ['GOOD', ...valid.slice(1), 'ordinary', 'ordinary'],
  ], [...headers, 'constructor', 'constructor'])
  const preview = await previewProductImport(db, buffer)
  assert.equal(preview.invalidRows, 3)
  assert.equal(preview.added, 1)
  assert.ok(preview.errors.every((error) => /Formulas/.test(error.message)))
  assert.equal(preview.errors.find((error) => error.row === 4)?.field, 'Column 7')
})

test('missing or duplicate canonical headers report available worksheets; another worksheet can be selected', async (t) => {
  const db = database(t)
  const file = new ExcelJS.Workbook()
  file.addWorksheet('Instructions').addRow(['Use the Products worksheet'])
  const products = file.addWorksheet('Products')
  products.addRow(headers)
  products.addRow(valid)
  const buffer = Buffer.from(await file.xlsx.writeBuffer())
  await assert.rejects(previewProductImport(db, buffer), (error: unknown) => {
    assert.ok(error instanceof WorkbookImportError)
    assert.deepEqual(error.sheetNames, ['Instructions', 'Products'])
    assert.match(error.message, /Missing required headers/)
    return true
  })
  assert.equal((await previewProductImport(db, buffer, 'Products')).added, 1)
  await assert.rejects(previewProductImport(db, buffer, 'Unknown'), /available worksheet/)
  await assert.rejects(previewProductImport(db, await workbook([valid], [...headers, 'part_number'])), /Duplicate header/)
  const formulaHeader = [...headers] as ExcelJS.CellValue[]
  formulaHeader[0] = { formula: '"Part Number"', result: 'Part Number' }
  const formulaWorkbook = new ExcelJS.Workbook()
  formulaWorkbook.addWorksheet('Products').addRow(formulaHeader)
  await assert.rejects(previewProductImport(db, Buffer.from(await formulaWorkbook.xlsx.writeBuffer())), /Header formulas/)
})

test('row and column limits reject oversized ranges before per-row processing', async (t) => {
  const db = database(t)
  for (const [row, column, message] of [[5002, 1, /5000 data-row/], [2, 65, /64-column/], [1000000, 1, /5000 data-row/]] as const) {
    const file = new ExcelJS.Workbook()
    const sheet = file.addWorksheet('Products')
    sheet.addRow(headers)
    sheet.getCell(row, column).value = 'range limit'
    await assert.rejects(previewProductImport(db, Buffer.from(await file.xlsx.writeBuffer())), message)
  }
})

test('commit recomputes add/update counts and rolls back all valid rows on an unexpected database failure', async (t) => {
  const db = database(t)
  const buffer = await workbook([valid])
  assert.equal((await previewProductImport(db, buffer)).added, 1)
  db.prepare(`
    INSERT INTO products (part_number, description, bulk_fixed_quantity, package_fixed_quantity, barcode_value, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('NEW-001', 'Concurrent insert after preview', 10, 1, 'PREVIOUS', 'active')
  const result = await importProducts(db, buffer)
  assert.equal(result.added, 0)
  assert.equal(result.updated, 1)

  const original = findProductByPartNumber(db, '5080')
  db.exec(`CREATE TRIGGER reject_import BEFORE INSERT ON products WHEN NEW.part_number = 'FAIL'
    BEGIN SELECT RAISE(ABORT, 'Unexpected storage failure'); END;`)
  const failed = await workbook([
    ['5080', 'Would overwrite', 1, 1, 'WOULD-CHANGE', 'Inactive'],
    ['BEFOREFAIL', 'Would add', 1, 1, 'WOULD-ADD', 'Active'],
    ['FAIL', 'Rejected by storage', 1, 1, 'REJECT', 'Active'],
  ])
  await assert.rejects(importProducts(db, failed), /Unexpected storage failure/)
  assert.deepEqual(findProductByPartNumber(db, '5080'), original)
  assert.equal(findProductByPartNumber(db, 'BEFOREFAIL'), undefined)
})

interface ZipEntry {
  name: string
  content: Buffer
  declaredSize?: number
  flags?: number
  attributes?: number
}

// Small archive writer lets resource-limit tests vary central-directory metadata
// independently of compressed bytes, without relying on another runtime package.
function zip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const content = deflateRawSync(entry.content)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(entry.flags ?? 0, 6)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(content.length, 18)
    header.writeUInt32LE(entry.declaredSize ?? entry.content.length, 22)
    header.writeUInt16LE(name.length, 26)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(entry.flags ?? 0, 8)
    directory.writeUInt16LE(8, 10)
    directory.writeUInt32LE(content.length, 20)
    directory.writeUInt32LE(entry.declaredSize ?? entry.content.length, 24)
    directory.writeUInt16LE(name.length, 28)
    directory.writeUInt32LE(entry.attributes ?? 0, 38)
    directory.writeUInt32LE(offset, 42)
    local.push(header, name, content)
    central.push(directory, name)
    offset += header.length + name.length + content.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

test('archive preflight rejects invalid files, expanded-size bombs, false size metadata, excessive entries, encryption and macros', async () => {
  await assert.rejects(validateWorkbookArchive(Buffer.from('not a zip')), WorkbookImportError)
  await assert.rejects(validateWorkbookArchive(Buffer.alloc(MAX_WORKBOOK_BYTES + 1)), /5 MiB/)
  await assert.rejects(validateWorkbookArchive(zip([{ name: 'bomb.xml', content: Buffer.alloc(MAX_EXPANDED_BYTES + 1, 65) }])), /20 MiB/)
  await assert.rejects(validateWorkbookArchive(zip([{ name: 'incorrect.xml', content: Buffer.alloc(1024, 65), declaredSize: 1 }])), /corrupt/)
  await assert.rejects(validateWorkbookArchive(zip(Array.from({ length: 1001 }, (_, index) => ({ name: `${index}.xml`, content: Buffer.alloc(0) })))), /1000/)
  await assert.rejects(validateWorkbookArchive(zip([{ name: 'encrypted.xml', content: Buffer.from('x'), flags: 1 }])), /Encrypted/)
  await assert.rejects(validateWorkbookArchive(zip([{ name: 'link', content: Buffer.from('target'), attributes: (0xa1ff << 16) >>> 0 }])), /symbolic/)
  await assert.rejects(validateWorkbookArchive(zip([{ name: 'xl/vbaProject.bin', content: Buffer.alloc(0) }])), /Macro/)
  await assert.rejects(validateWorkbookArchive(zip([{ name: 'other.xml', content: Buffer.alloc(0) }])), /valid .xlsx/)
})

import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import ExcelJS from 'exceljs'
import { findProductByPartNumber, migrateDatabase, openProductDatabase, seedProducts } from '../../database/index.js'
import { createApp } from '../../server/app.js'

const headers = ['Part Number', 'Description', 'Bulk Fixed Quantity', 'Package Fixed Quantity', 'Barcode Value', 'Status']

async function startApi(t: TestContext) {
  const db = openProductDatabase(':memory:')
  migrateDatabase(db)
  seedProducts(db)
  const errors: unknown[] = []
  const server = createApp(db, { onError: (error) => errors.push(error) }).listen(0, '127.0.0.1')
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    db.close()
  })
  await once(server, 'listening')
  return { db, errors, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

async function workbookBuffer(rows: unknown[][], columnHeaders = headers, sheetName = 'Products') {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.addRow(columnHeaders)
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function formFor(buffer: Buffer, options: { filename?: string; sheetName?: string; type?: string } = {}) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buffer)], { type: options.type ?? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), options.filename ?? 'products.xlsx')
  if (options.sheetName !== undefined) form.append('sheetName', options.sheetName)
  return form
}

async function upload(url: string, path: string, buffer: Buffer, options: { filename?: string; sheetName?: string; type?: string } = {}) {
  return fetch(`${url}${path}`, { method: 'POST', body: formFor(buffer, options) })
}

test('HTTP preview classifies additions and updates without modifying stored products', async (t) => {
  const { db, url } = await startApi(t)
  const original = findProductByPartNumber(db, '5080')
  const buffer = await workbookBuffer([
    ['5080', 'Updated coupling', 900, 90, 'IMPORT-5080', 'inactive'],
    ['00075', 'New independent barcode', 100, 10, 'BARCODE-ONLY', 'active'],
  ])
  const response = await upload(url, '/api/products/import/preview', buffer)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const preview = await response.json()
  assert.equal(preview.sheetName, 'Products')
  assert.deepEqual(preview.sheetNames, ['Products'])
  assert.equal(preview.added, 1)
  assert.equal(preview.updated, 1)
  assert.equal(preview.totalRows, 2)
  assert.equal(preview.blankRows, 0)
  assert.equal(preview.invalidRows, 0)
  assert.deepEqual(preview.errors, [])
  assert.deepEqual(preview.rows.map((row: { row: number; action: string }) => [row.row, row.action]), [[2, 'update'], [3, 'add']])
  assert.equal(preview.rows[1].product.partNumber, '00075')
  assert.equal(preview.rows[1].product.barcodeValue, 'BARCODE-ONLY')
  assert.deepEqual(findProductByPartNumber(db, '5080'), original)
  assert.equal(findProductByPartNumber(db, '00075'), undefined)
})

test('HTTP import adds and updates products, preserves uniqueness, and immediately updates lookup', async (t) => {
  const { db, url } = await startApi(t)
  const countBefore = Number(db.prepare('SELECT count(*) AS count FROM products').get()!.count)
  const buffer = await workbookBuffer([
    ['5080', 'Updated product', 800, 80, 'SEPARATE-CODE', 'inactive'],
    ['00075', 'New product', 75, 5, 'ALTERNATE-BARCODE', 'active'],
  ])
  const response = await upload(url, '/api/products/import', buffer)
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.added, 1)
  assert.equal(result.updated, 1)
  assert.equal(result.invalidRows, 0)
  assert.equal('rows' in result, false)
  assert.equal(Number(db.prepare('SELECT count(*) AS count FROM products').get()!.count), countBefore + 1)
  const lookup = await fetch(`${url}/api/products?partNumber=5080`)
  assert.equal(lookup.status, 200)
  assert.deepEqual(await lookup.json(), {
    partNumber: '5080', description: 'Updated product', bulkFixedQuantity: 800,
    packageFixedQuantity: 80, barcodeValue: 'SEPARATE-CODE', status: 'inactive',
  })
  const leadingZeroLookup = await fetch(`${url}/api/products?partNumber=00075`)
  assert.equal(leadingZeroLookup.status, 200)
  assert.equal((await leadingZeroLookup.json()).barcodeValue, 'ALTERNATE-BARCODE')
  const repeated = await upload(url, '/api/products/import', buffer)
  assert.equal(repeated.status, 200)
  const repeatedResult = await repeated.json()
  assert.equal(repeatedResult.added, 0)
  assert.equal(repeatedResult.updated, 2)
  assert.equal(Number(db.prepare('SELECT count(*) AS count FROM products').get()!.count), countBefore + 1)
})

test('HTTP legacy import consolidates all nonempty description columns in order', async (t) => {
  const { db, url } = await startApi(t)
  const buffer = await workbookBuffer([
    ['LEGACY', ' HEX ', 'HEAD', '', ' PIPE PLUG ', null, 100, 10, 'LEGACY-BARCODE', 'active'],
  ], ['Part Number', 'Description1', 'Description2', 'Description3', 'Description4', 'Description5', 'Bulk Fixed Quantity', 'Package Fixed Quantity', 'Barcode Value', 'Status'])
  const response = await upload(url, '/api/products/import', buffer)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).added, 1)
  assert.deepEqual(findProductByPartNumber(db, 'LEGACY'), {
    partNumber: 'LEGACY', description: 'HEX HEAD PIPE PLUG', bulkFixedQuantity: 100,
    packageFixedQuantity: 10, barcodeValue: 'LEGACY-BARCODE', status: 'active',
  })
})

test('HTTP preview and import accept wide master sheets with either description format and ignore extra columns', async (t) => {
  const { url } = await startApi(t)
  for (const legacy of [false, true]) {
    const columnHeaders = Array.from({ length: 256 }, (_, index) => `Unrelated ${index}`)
    const mappedHeaders = legacy
      ? ['Part Number', 'Description1', 'Description2', 'Description3', 'Description4', 'Description5', 'Bulk Fixed Quantity', 'Package Fixed Quantity', 'Barcode Value', 'Status']
      : headers
    const part = legacy ? 'WIDE-LEGACY' : 'WIDE-DIRECT'
    const values = legacy
      ? [part, 'HEX', '', 'HEAD', null, 'PIPE PLUG', 120, 12, '000SEPARATE-CODE', 'active']
      : [part, 'HEX HEAD PIPE PLUG', 120, 12, '000SEPARATE-CODE', 'active']
    const row: ExcelJS.CellValue[] = columnHeaders.map(() => ({ formula: '1/0', result: { error: '#DIV/0!' } }))
    mappedHeaders.forEach((header, index) => {
      const position = 70 + index * 17
      columnHeaders[position] = header
      row[position] = values[index]
    })
    const buffer = await workbookBuffer([row], columnHeaders)
    const previewResponse = await upload(url, '/api/products/import/preview', buffer)
    assert.equal(previewResponse.status, 200)
    const preview = await previewResponse.json()
    assert.equal(preview.added, 1)
    assert.equal(preview.invalidRows, 0)
    assert.deepEqual(preview.errors, [])
    assert.equal((await fetch(`${url}/api/products?partNumber=${part}`)).status, 404)
    const response = await upload(url, '/api/products/import', buffer)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).added, 1)
    const lookup = await fetch(`${url}/api/products?partNumber=${part}`)
    assert.equal(lookup.status, 200)
    assert.deepEqual(await lookup.json(), {
      partNumber: part, description: 'HEX HEAD PIPE PLUG', bulkFixedQuantity: 120,
      packageFixedQuantity: 12, barcodeValue: '000SEPARATE-CODE', status: 'active',
    })
  }
})

test('HTTP import skips blank and invalid rows while reporting row-specific errors and importing valid rows', async (t) => {
  const { db, url } = await startApi(t)
  const buffer = await workbookBuffer([
    ['VALID', 'Valid product', 100, 10, 'VALID-CODE', 'active'],
    [],
    ['BAD', 'Invalid quantity', 0, 10, 'BAD-CODE', 'active'],
    ['EMPTY-CODE', 'Missing barcode', 100, 10, '', 'active'],
  ])
  const previewResponse = await upload(url, '/api/products/import/preview', buffer)
  assert.equal(previewResponse.status, 200)
  const preview = await previewResponse.json()
  assert.equal(preview.totalRows, 4)
  assert.equal(preview.blankRows, 1)
  assert.equal(preview.invalidRows, 2)
  assert.equal(preview.rows.length, 1)
  assert.deepEqual(preview.errors.map((error: { row: number }) => error.row), [4, 5])
  assert.equal(findProductByPartNumber(db, 'VALID'), undefined)
  const response = await upload(url, '/api/products/import', buffer)
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.added, 1)
  assert.equal(result.updated, 0)
  assert.equal(result.blankRows, 1)
  assert.equal(result.invalidRows, 2)
  assert.deepEqual(result.errors, preview.errors)
  assert.ok(findProductByPartNumber(db, 'VALID'))
  assert.equal(findProductByPartNumber(db, 'BAD'), undefined)
  assert.equal(findProductByPartNumber(db, 'EMPTY-CODE'), undefined)
})

test('HTTP sheet selection reports available sheets for unknown names and invalid headers without writes', async (t) => {
  const { db, url } = await startApi(t)
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Bad Headers').addRow(['Unrelated column'])
  const products = workbook.addWorksheet('Products')
  products.addRow(headers)
  products.addRow(['SHEET', 'Selected sheet product', 100, 10, 'SHEET-CODE', 'active'])
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  for (const sheetName of ['Missing', 'Bad Headers']) {
    const response = await upload(url, '/api/products/import', buffer, { sheetName })
    assert.equal(response.status, 422)
    const result = await response.json()
    assert.equal(typeof result.error, 'string')
    assert.deepEqual(result.sheetNames, ['Bad Headers', 'Products'])
    assert.equal(findProductByPartNumber(db, 'SHEET'), undefined)
  }
  const preview = await upload(url, '/api/products/import/preview', buffer, { sheetName: 'Products' })
  assert.equal(preview.status, 200)
  assert.equal((await preview.json()).sheetName, 'Products')
  const response = await upload(url, '/api/products/import', buffer, { sheetName: 'Products' })
  assert.equal(response.status, 200)
  assert.ok(findProductByPartNumber(db, 'SHEET'))
})

test('HTTP uploads reject missing files, unsupported extensions, and corrupt workbooks with JSON errors', async (t) => {
  const { url } = await startApi(t)
  const buffer = await workbookBuffer([['TEST', 'Test', 100, 10, 'TEST-CODE', 'active']])
  const missing = await fetch(`${url}/api/products/import`, { method: 'POST', body: new FormData() })
  assert.equal(missing.status, 400)
  assert.equal(typeof (await missing.json()).error, 'string')
  for (const filename of ['products.xls', 'products.xlsm', 'products.csv', 'products.xlsx.exe']) {
    const response = await upload(url, '/api/products/import', buffer, { filename })
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /\.xlsx/)
  }
  const corrupt = await upload(url, '/api/products/import', Buffer.from('not an Excel workbook'))
  assert.equal(corrupt.status, 422)
  assert.equal(typeof (await corrupt.json()).error, 'string')
  const uppercase = await upload(url, '/api/products/import/preview', buffer, { filename: 'PRODUCTS.XLSX', type: 'application/octet-stream' })
  assert.equal(uppercase.status, 200)
})

test('HTTP uploads enforce the 5 MiB file limit before parsing the workbook', async (t) => {
  const { db, errors, url } = await startApi(t)
  const countBefore = Number(db.prepare('SELECT count(*) AS count FROM products').get()!.count)
  const response = await upload(url, '/api/products/import', Buffer.alloc(5 * 1024 * 1024 + 1))
  assert.equal(response.status, 413)
  assert.match((await response.json()).error, /5 MiB/)
  assert.equal(Number(db.prepare('SELECT count(*) AS count FROM products').get()!.count), countBefore)
  assert.deepEqual(errors, [])
})

test('HTTP uploads reject extra files, duplicate fields, unknown fields, and invalid sheet names', async (t) => {
  const { db, url } = await startApi(t)
  const buffer = await workbookBuffer([['TEST', 'Test', 100, 10, 'TEST-CODE', 'active']])
  const cases = [
    () => { const form = formFor(buffer); form.append('file', new Blob([new Uint8Array(buffer)]), 'second.xlsx'); return form },
    () => { const form = formFor(buffer); form.append('wrongFile', new Blob([new Uint8Array(buffer)]), 'second.xlsx'); return form },
    () => { const form = formFor(buffer, { sheetName: 'Products' }); form.append('sheetName', 'Products'); return form },
    () => { const form = formFor(buffer); form.append('unknownField', 'value'); return form },
    ...['', ' ', 'X'.repeat(32), 'Bad\u0000Name', 'Bad\uFFFDName'].map((sheetName) => () => formFor(buffer, { sheetName })),
  ]
  for (const makeForm of cases) {
    const response = await fetch(`${url}/api/products/import`, { method: 'POST', body: makeForm() })
    assert.equal(response.status, 400)
    assert.equal(typeof (await response.json()).error, 'string')
    assert.equal(findProductByPartNumber(db, 'TEST'), undefined)
  }
})

test('HTTP malformed multipart requests return a controlled JSON error', async (t) => {
  const { errors, url } = await startApi(t)
  for (const contentType of ['multipart/form-data', 'multipart/form-data; boundary=missing']) {
    const response = await fetch(`${url}/api/products/import`, {
      method: 'POST', headers: { 'content-type': contentType }, body: 'not a multipart body',
    })
    assert.equal(response.status, 400)
    assert.equal(typeof (await response.json()).error, 'string')
  }
  assert.deepEqual(errors, [])
})

test('HTTP import database failures are logged, return generic errors, and roll back all valid writes', async (t) => {
  const { db, errors, url } = await startApi(t)
  db.exec(`CREATE TRIGGER reject_import BEFORE INSERT ON products
    WHEN NEW.part_number = 'BLOCKED'
    BEGIN SELECT RAISE(ABORT, 'internal protected detail'); END;`)
  const buffer = await workbookBuffer([
    ['FIRST', 'First valid row', 100, 10, 'FIRST-CODE', 'active'],
    ['BLOCKED', 'Second valid row', 100, 10, 'BLOCKED-CODE', 'active'],
  ])
  const response = await upload(url, '/api/products/import', buffer)
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'Unable to process the product import. Please try again.' })
  assert.equal(errors.length, 1)
  assert.equal(findProductByPartNumber(db, 'FIRST'), undefined)
  assert.equal(findProductByPartNumber(db, 'BLOCKED'), undefined)
})

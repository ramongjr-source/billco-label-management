import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { findProductByPartNumber, migrateDatabase, openProductDatabase, seedDevelopmentProducts } from '../../database/index.js'
import { billcoMasterProducts, billcoMasterSource } from '../../database/seeds/billco-master.js'
import { generateDevelopmentSeed } from '../../scripts/generate-development-seed.js'
import { importProducts, previewProductImport } from '../../server/import/index.js'

const headers = ['BillcoPart#', 'Description', 'StdPackQty', 'BulkQty', 'ProductBarcode', 'BulkBarcode', 'Status']
async function workbook(rows: ExcelJS.CellValue[][]) {
  const file = new ExcelJS.Workbook()
  file.addWorksheet('BillcoMaster').addRows([headers, ...rows])
  return Buffer.from(await file.xlsx.writeBuffer())
}

test('all generated master products load intact and repeated seeding preserves imported updates', async (t) => {
  const db = openProductDatabase(':memory:')
  t.after(() => db.close())
  migrateDatabase(db)
  assert.equal(billcoMasterProducts.length, 673)
  assert.equal(billcoMasterSource.totalRows, 743)
  assert.equal(seedDevelopmentProducts(db), billcoMasterProducts.length + 5)
  for (const product of billcoMasterProducts) {
    assert.deepEqual(findProductByPartNumber(db, product.partNumber.toLowerCase()), product)
  }
  assert.equal(seedDevelopmentProducts(db), 0)
  const update = await workbook([['pa.013', 'Imported update', 21, 210, 'NEW-PACK', 'NEW-BULK', 'Inactive']])
  const preview = await previewProductImport(db, update)
  assert.equal(preview.updated, 1)
  assert.equal(preview.added, 0)
  assert.equal(preview.rows[0].product.partNumber, 'PA.013')
  assert.equal((await importProducts(db, update)).updated, 1)
  assert.equal(seedDevelopmentProducts(db), 0)
  assert.deepEqual(findProductByPartNumber(db, 'PA.013'), {
    partNumber: 'PA.013', description: 'Imported update', packageFixedQuantity: 21,
    bulkFixedQuantity: 210, productBarcode: 'NEW-PACK', bulkBarcode: 'NEW-BULK', status: 'inactive',
  })
})

test('development setup initializes a fresh persistent database without an Excel file', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'billco-dev-seed-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, 'products.sqlite')
  const run = () => execFileSync(process.execPath, ['--import', 'tsx', 'server/setup.ts'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_PATH: filename }, encoding: 'utf8',
  })
  assert.match(run(), /inserted 678 development product/)
  assert.match(run(), /inserted 0 development product/)
  const db = openProductDatabase(filename)
  t.after(() => db.close())
  for (const part of ['PA.013', 'AB.025X013', 'HR.013']) {
    assert.equal(findProductByPartNumber(db, part)?.partNumber, part)
  }
})

test('generator uses production validation, preserves fields, and reports skipped rows', async () => {
  const file = await workbook([
    ['Ab.001', 'Real description', 10, 100, '000PACK', '000BULK', 'Inactive'],
    ['PACKAGE-ONLY', 'No bulk data', 20, null, 'PACKAGE', null, 'Active'],
    ['MISSING-DESCRIPTION', '', 10, 100, 'PACK', 'BULK', 'Active'],
    ['DUP', 'First duplicate', 10, 100, 'P', 'B', 'Active'],
    ['dup', 'Second duplicate', 10, 100, 'P', 'B', 'Active'],
  ])
  const generated = await generateDevelopmentSeed(file)
  assert.deepEqual(generated.products, [
    { partNumber: 'Ab.001', description: 'Real description', packageFixedQuantity: 10, bulkFixedQuantity: 100, productBarcode: '000PACK', bulkBarcode: '000BULK', status: 'inactive' },
    { partNumber: 'PACKAGE-ONLY', description: 'No bulk data', packageFixedQuantity: 20, bulkFixedQuantity: null, productBarcode: 'PACKAGE', bulkBarcode: '', status: 'active' },
  ])
  assert.equal(generated.invalidRows, 3)
  assert.deepEqual(await generateDevelopmentSeed(file), generated)
  await assert.rejects(generateDevelopmentSeed(await workbook([['INVALID', '', 1, 1, 'P', 'B', 'Active']])), /no valid products/)
})

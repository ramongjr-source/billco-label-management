import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import ExcelJS from 'exceljs'
import { findProductByPartNumber, migrateDatabase, openProductDatabase, seedProducts } from '../../database/index.js'
import { importProducts, inspectProductWorkbook, previewProductImport } from '../../server/import/index.js'
import { createApp } from '../../server/app.js'

const billcoHeaders = ['BillcoPart#', 'StdPackQty', 'Size', 'Description', 'ProductBarcode', 'BulkQty', 'BulkBarcode']

function database(t: TestContext) {
  const db = openProductDatabase(':memory:')
  migrateDatabase(db)
  t.after(() => db.close())
  return db
}

async function billcoFile() {
  const book = new ExcelJS.Workbook()
  book.addWorksheet('Customer source').addRows([['Unrelated customer fields'], ['Never import this']])
  const sheet = book.addWorksheet('BillcoMaster')
  sheet.addRows([billcoHeaders,
    ['000BOTH', '50', 'Ignored', 'HEX HEAD PIPE PLUG', '000PRODUCT', 500, '000BULK'],
    ['PACKAGE-ONLY', 10, 'Ignored', 'PACKAGE ONLY', 'PACKAGE-CODE', null, null],
    ['VARIABLE-ONLY', null, null, 'VARIABLE ONLY', null, null, null],
  ])
  return Buffer.from(await book.xlsx.writeBuffer())
}

test('BillcoMaster is primary even after another sheet; distinct barcodes and missing fixed fields import directly', async (t) => {
  const db = database(t)
  const file = await billcoFile()
  const columns = await inspectProductWorkbook(file)
  assert.equal(columns.sheetName, 'BillcoMaster')
  assert.deepEqual(columns.mapping, { descriptionColumns: [4], partNumber: 1, bulkFixedQuantity: 6, packageFixedQuantity: 2, productBarcode: 5, bulkBarcode: 7 })
  const preview = await previewProductImport(db, file, undefined, columns.mapping)
  assert.equal(preview.added, 3)
  assert.equal(preview.invalidRows, 0)
  assert.equal(findProductByPartNumber(db, '000BOTH'), undefined)
  await importProducts(db, file, undefined, columns.mapping)
  assert.deepEqual(findProductByPartNumber(db, '000BOTH'), {
    partNumber: '000BOTH', description: 'HEX HEAD PIPE PLUG', bulkFixedQuantity: 500,
    packageFixedQuantity: 50, productBarcode: '000PRODUCT', bulkBarcode: '000BULK', status: 'active',
  })
  assert.equal(findProductByPartNumber(db, 'PACKAGE-ONLY')?.bulkFixedQuantity, null)
  assert.equal(findProductByPartNumber(db, 'PACKAGE-ONLY')?.bulkBarcode, '')
  assert.equal(findProductByPartNumber(db, 'VARIABLE-ONLY')?.productBarcode, '')
  assert.equal(db.prepare('SELECT count(*) AS count FROM products').get()?.count, 3)
  db.prepare("UPDATE products SET status = 'inactive' WHERE part_number = '000BOTH'").run()
  const next = await previewProductImport(db, file)
  assert.equal(next.rows[0].product.status, 'inactive')
  const repeated = await importProducts(db, file)
  assert.equal(repeated.updated, 3)
  assert.equal(repeated.added, 0)
  assert.equal(findProductByPartNumber(db, '000BOTH')?.status, 'inactive')
})

test('operator mapping handles arbitrary headers and ordered description fragments, with no cross-barcode fallback', async (t) => {
  const db = database(t)
  const book = new ExcelJS.Workbook()
  book.addWorksheet('Supplier').addRows([
    ['Supplier Part No', 'Material', 'Shape', 'Bulk count', 'Master Case UPC', 'Case count', 'Unit UPC', 'Enabled', 'Ignored formula'],
    ['000CUSTOM', ' HEX ', ' HEAD ', 400, '000BULK-CUSTOM', 40, '000PRODUCT-CUSTOM', 'Inactive', { formula: '1/0', result: { error: '#DIV/0!' } }],
  ])
  const file = Buffer.from(await book.xlsx.writeBuffer())
  const inspection = await inspectProductWorkbook(file)
  assert.equal(inspection.columns.length, 9)
  const mapping = { partNumber: 1, descriptionColumns: [3, 2], bulkFixedQuantity: 4, bulkBarcode: 5, packageFixedQuantity: 6, productBarcode: 7, status: 8 }
  const preview = await previewProductImport(db, file, 'Supplier', mapping)
  assert.equal(preview.rows[0].product.description, 'HEAD HEX')
  assert.equal(preview.rows[0].product.productBarcode, '000PRODUCT-CUSTOM')
  await importProducts(db, file, 'Supplier', mapping)
  assert.equal(findProductByPartNumber(db, '000CUSTOM')?.bulkBarcode, '000BULK-CUSTOM')
  assert.equal(findProductByPartNumber(db, '000CUSTOM')?.status, 'inactive')
  for (const invalid of [null, [], { ...mapping, extra: 1 }, { ...mapping, partNumber: 0 }, { ...mapping, productBarcode: 1 }, { ...mapping, descriptionColumns: [] }, { ...mapping, bulkBarcode: 99 }]) {
    await assert.rejects(previewProductImport(db, file, 'Supplier', invalid))
  }
  await assert.rejects(previewProductImport(db, file, 'Supplier', { descriptionColumns: [2] }), /Missing required headers/)
  assert.equal(db.prepare('SELECT count(*) AS count FROM products').get()?.count, 1)
})

test('legacy files do not erase an existing bulk barcode when its column is absent', async (t) => {
  const db = database(t)
  seedProducts(db)
  const book = new ExcelJS.Workbook()
  book.addWorksheet('Legacy').addRows([
    ['Part Number', 'Description', 'Bulk Fixed Quantity', 'Package Fixed Quantity', 'Barcode Value'],
    ['5083', 'Updated description', 300, 30, 'NEW-PRODUCT'],
  ])
  await importProducts(db, Buffer.from(await book.xlsx.writeBuffer()))
  assert.equal(findProductByPartNumber(db, '5083')?.productBarcode, 'NEW-PRODUCT')
  assert.equal(findProductByPartNumber(db, '5083')?.bulkBarcode, 'BILLCO-BULK-5083')
})

test('HTTP column discovery and JSON mapping are read-only until import, with controlled mapping errors', async (t) => {
  const db = database(t)
  const server = createApp(db).listen(0, '127.0.0.1')
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })
  await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const file = await billcoFile()
  const upload = async (path: string, mapping?: string) => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(file)]), 'Billco_App_Master.xlsx')
    if (mapping !== undefined) form.append('mapping', mapping)
    return fetch(url + path, { method: 'POST', body: form })
  }
  const columns = await (await upload('/api/products/import/columns')).json()
  assert.equal(columns.sheetName, 'BillcoMaster')
  assert.equal(db.prepare('SELECT count(*) AS count FROM products').get()?.count, 0)
  const mapping = JSON.stringify(columns.mapping)
  const preview = await upload('/api/products/import/preview', mapping)
  assert.equal(preview.status, 200)
  assert.equal((await preview.json()).added, 3)
  assert.equal(db.prepare('SELECT count(*) AS count FROM products').get()?.count, 0)
  assert.equal((await upload('/api/products/import', '{not JSON')).status, 400)
  assert.equal((await upload('/api/products/import', JSON.stringify({ ...columns.mapping, bulkBarcode: 1 }))).status, 422)
  const committed = await upload('/api/products/import', mapping)
  assert.equal(committed.status, 200)
  assert.equal((await committed.json()).added, 3)
  const lookup = await (await fetch(url + '/api/products?partNumber=000BOTH')).json()
  assert.equal(lookup.productBarcode, '000PRODUCT')
  assert.equal(lookup.bulkBarcode, '000BULK')
})

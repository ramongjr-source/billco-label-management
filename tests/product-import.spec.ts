import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'
import type { ProductImportPreview, ProductImportResult } from '../shared/productImport.js'

const headers = ['Part Number', 'Description', 'Bulk Fixed Quantity', 'Package Fixed Quantity', 'Product Barcode', 'Status', 'Bulk Barcode']
const workbookMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function partNumber() {
  return `IMPORT-${randomUUID().replaceAll('-', '').slice(0, 12)}`
}

function productRow(part: string, description = 'IMPORTED BRASS COUPLING', bulk = 120, pack = 12, barcode = `BC-${part}`, status = 'active'): ExcelJS.CellValue[] {
  return [part, description, bulk, pack, barcode, status, `BULK-${barcode}`]
}

async function workbookFile(name: string, sheets: { name: string; rows: ExcelJS.CellValue[][] }[]) {
  const workbook = new ExcelJS.Workbook()
  for (const sheet of sheets) workbook.addWorksheet(sheet.name).addRows(sheet.rows)
  return { name, mimeType: workbookMimeType, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) }
}

async function uploadRows(page: Page, rows: ExcelJS.CellValue[][], filename = 'master-products.xlsx', sheetName = 'Products') {
  await page.getByLabel('Excel workbook (.xlsx)', { exact: true }).setInputFiles(await workbookFile(filename, [{ name: sheetName, rows }]))
}

async function validate(page: Page): Promise<ProductImportPreview> {
  const response = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/products/import/preview')
  await page.getByRole('button', { name: 'Validate workbook', exact: true }).click()
  const result = await response
  expect(result.status()).toBe(200)
  const preview = await result.json() as ProductImportPreview
  await expect(page.getByRole('heading', { name: 'Validation preview', exact: true })).toBeVisible()
  return preview
}

async function commit(page: Page): Promise<ProductImportResult> {
  const response = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/products/import')
  await page.getByRole('button', { name: 'Import valid rows', exact: true }).click()
  const result = await response
  expect(result.status()).toBe(200)
  const report = await result.json() as ProductImportResult
  await expect(page.getByRole('heading', { name: 'Import complete', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import valid rows', exact: true })).toBeDisabled()
  return report
}

async function expectCount(page: Page, label: string, value: number) {
  await expect(page.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').locator('dd')).toHaveText(String(value))
}

async function expectMissing(request: APIRequestContext, part: string) {
  const response = await request.get(`/api/products?partNumber=${encodeURIComponent(part)}`)
  expect(response.status()).toBe(404)
}

async function lookupImportedProduct(page: Page, part: string, description: string) {
  await page.getByRole('button', { name: 'Product Labels', exact: true }).click()
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill(part)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(description)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Import Master List', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Import Master List', exact: true })).toBeVisible()
})

test('previews a wide master without writes, commits an added product, and immediately applies all label rules', async ({ page, request }) => {
  const part = partNumber()
  const description = 'BRASS COUPLING 3/8'
  const barcode = `BARCODE-${part}`
  const bulkBarcode = `BULK-${barcode}`
  await expect(page.getByRole('button', { name: 'Validate workbook', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Import valid rows', exact: true })).toBeDisabled()
  const wideHeaders = Array.from({ length: 256 }, (_, index) => `Unrelated ${index}`)
  const wideRow: ExcelJS.CellValue[] = wideHeaders.map(() => ({ formula: '1/0', result: { error: '#DIV/0!' } }))
  const importedValues = productRow(part, description, 120, 12, barcode)
  headers.forEach((header, index) => {
    const column = 70 + index * 32
    wideHeaders[column] = header
    wideRow[column] = importedValues[index]
  })
  await uploadRows(page, [wideHeaders, wideRow])
  await expect(page.getByRole('button', { name: 'Import valid rows', exact: true })).toBeDisabled()
  expect(await validate(page)).toMatchObject({ added: 1, updated: 0, invalidRows: 0, blankRows: 0 })
  await expectCount(page, 'To add', 1)
  await expectCount(page, 'To update', 0)
  const rows = page.getByRole('region', { name: 'Valid product rows table', exact: true })
  await expect(rows).toContainText(part)
  await expect(rows).toContainText(description)
  await expect(rows).toContainText(barcode)
  await expectMissing(request, part)
  expect(await commit(page)).toMatchObject({ added: 1, updated: 0, invalidRows: 0 })
  await expectCount(page, 'Added', 1)
  await lookupImportedProduct(page, part, description)
  const preview = page.getByRole('region', { name: 'Label Preview', exact: true })
  const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
  await expect(preview.locator('.label-description strong')).toHaveText(description)
  for (const mode of [
    { name: 'Bulk Fixed Qty', height: 5, quantity: '120', editable: false },
    { name: 'Bulk Variable Qty', height: 5, quantity: '', editable: true },
    { name: 'Package Fixed Qty', height: 2, quantity: '12', editable: false },
    { name: 'BCC', height: 2, quantity: '', editable: true },
  ]) {
    await page.getByRole('radio', { name: mode.name, exact: true }).check()
    await expect(quantity).toHaveValue(mode.quantity)
    await expect(preview).toContainText(`Label Size (3″ × ${mode.height}″)`)
    if (mode.editable) {
      await expect(quantity).not.toHaveAttribute('readonly', '')
      await quantity.fill('37')
      await expect(preview.locator('.label-quantity strong')).toHaveText('37')
      await expect(preview.locator('.barcode-group')).toHaveCount(0)
    } else {
      await expect(quantity).toHaveAttribute('readonly', '')
      await expect(preview.locator('.barcode-value')).toHaveText(mode.height === 5 ? bulkBarcode : barcode)
      await expect(preview.getByRole('img', { name: `Code 128 barcode for ${mode.height === 5 ? bulkBarcode : barcode}` })).toBeVisible()
    }
  }
})

test('updates matching part numbers and adds new products in the same import', async ({ page, request }) => {
  const existing = partNumber()
  const added = partNumber()
  await uploadRows(page, [headers, productRow(existing, 'ORIGINAL DESCRIPTION', 80, 8, `OLD-${existing}`)])
  await validate(page)
  await commit(page)
  await uploadRows(page, [
    headers,
    productRow(existing, 'UPDATED DESCRIPTION', 240, 24, `NEW-${existing}`),
    productRow(added, 'NEW PRODUCT', 90, 9),
  ], 'updated-master.xlsx')
  const preview = await validate(page)
  expect(preview).toMatchObject({ added: 1, updated: 1, invalidRows: 0 })
  expect(preview.rows.find((row) => row.product.partNumber === existing)?.action).toBe('update')
  expect(preview.rows.find((row) => row.product.partNumber === added)?.action).toBe('add')
  await expectCount(page, 'To add', 1)
  await expectCount(page, 'To update', 1)
  expect(await (await request.get(`/api/products?partNumber=${existing}`)).json()).toMatchObject({ description: 'ORIGINAL DESCRIPTION', bulkFixedQuantity: 80 })
  await expectMissing(request, added)
  expect(await commit(page)).toMatchObject({ added: 1, updated: 1, invalidRows: 0 })
  await expectCount(page, 'Added', 1)
  await expectCount(page, 'Updated', 1)
  expect(await (await request.get(`/api/products?partNumber=${existing}`)).json()).toMatchObject({
    partNumber: existing, description: 'UPDATED DESCRIPTION', bulkFixedQuantity: 240, packageFixedQuantity: 24, productBarcode: `NEW-${existing}`,
  })
  expect(await (await request.get(`/api/products?partNumber=${added}`)).json()).toMatchObject({ partNumber: added, description: 'NEW PRODUCT' })
})

test('consolidates legacy description fragments while preserving a separate barcode', async ({ page, request }) => {
  const part = partNumber()
  const barcode = `LEGACY-${part}`
  const legacyHeaders = ['Part Number', 'Description1', 'Description2', 'Description3', 'Description4', 'Description5', 'Bulk Fixed Quantity', 'Package Fixed Quantity', 'Product Barcode', 'Status', 'Bulk Barcode']
  await uploadRows(page, [legacyHeaders, [part, '  BRASS ', '', ' COUPLING  ', null, ' 3/8 ', 80, 8, barcode, 'active', `BULK-${barcode}`]], 'legacy-master.xlsx')
  const preview = await validate(page)
  expect(preview.rows[0]?.product).toMatchObject({ partNumber: part, description: 'BRASS COUPLING 3/8', productBarcode: barcode })
  await expect(page.getByRole('region', { name: 'Valid product rows table', exact: true })).toContainText('BRASS COUPLING 3/8')
  await expectMissing(request, part)
  await commit(page)
  await lookupImportedProduct(page, part, 'BRASS COUPLING 3/8')
  await expect(page.locator('.label-description strong').first()).toHaveText('BRASS COUPLING 3/8')
  await expect(page.locator('.barcode-value').first()).toHaveText(`BULK-${barcode}`)
})

test('reports original row errors, ignores blank rows, and skips every duplicate occurrence', async ({ page, request }) => {
  const valid = partNumber()
  const duplicate = partNumber()
  const badQuantity = partNumber()
  const badStatus = partNumber()
  await uploadRows(page, [
    headers,
    productRow(valid),
    ['', '   ', '', '', '', ''],
    productRow(duplicate, 'FIRST DUPLICATE'),
    productRow(` ${duplicate} `, 'SECOND DUPLICATE'),
    productRow(badQuantity, 'INVALID QUANTITY', -1, 12),
    productRow(badStatus, 'INVALID STATUS', 120, 12, `BC-${badStatus}`, 'unknown'),
  ], 'master-with-errors.xlsx')
  const preview = await validate(page)
  expect(preview).toMatchObject({ added: 1, updated: 0, invalidRows: 4, blankRows: 1 })
  expect(preview.rows.map((row) => row.product.partNumber)).toEqual([valid])
  for (const row of [4, 5]) {
    expect(preview.errors.some((error) => error.row === row && /duplicate/i.test(error.message))).toBe(true)
  }
  expect(preview.errors.some((error) => error.row === 6)).toBe(true)
  expect(preview.errors.some((error) => error.row === 7)).toBe(true)
  await expectCount(page, 'Invalid rows', 4)
  await expectCount(page, 'Blank rows', 1)
  const errors = page.getByRole('region', { name: 'Validation errors table', exact: true })
  await expect(errors.getByRole('row').filter({ hasText: duplicate })).toHaveCount(2)
  await expect(errors).toContainText(badQuantity)
  await expect(errors).toContainText(badStatus)
  expect(await commit(page)).toMatchObject({ added: 1, updated: 0, invalidRows: 4, blankRows: 1 })
  expect((await request.get(`/api/products?partNumber=${valid}`)).status()).toBe(200)
  for (const part of [duplicate, badQuantity, badStatus]) await expectMissing(request, part)
})

test('invalidates an old preview when the worksheet or workbook changes', async ({ page, request }) => {
  const first = partNumber()
  const second = partNumber()
  const replacement = partNumber()
  const upload = page.getByLabel('Excel workbook (.xlsx)', { exact: true })
  await upload.setInputFiles(await workbookFile('two-sheets.xlsx', [
    { name: 'First products', rows: [headers, productRow(first)] },
    { name: 'Second products', rows: [headers, productRow(second)] },
  ]))
  expect(await validate(page)).toMatchObject({ sheetName: 'First products', sheetNames: ['First products', 'Second products'] })
  await page.getByLabel('Worksheet', { exact: true }).selectOption('Second products')
  await expect(page.getByRole('heading', { name: 'Validation preview', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import valid rows', exact: true })).toBeDisabled()
  const secondPreview = await validate(page)
  expect(secondPreview.sheetName).toBe('Second products')
  expect(secondPreview.rows.map((row) => row.product.partNumber)).toEqual([second])
  await uploadRows(page, [headers, productRow(replacement)], 'replacement.xlsx', 'Replacement products')
  await expect(page.getByLabel('Worksheet', { exact: true })).toHaveValue('Replacement products')
  await expect(page.getByRole('heading', { name: 'Validation preview', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import valid rows', exact: true })).toBeDisabled()
  const replacementPreview = await validate(page)
  expect(replacementPreview.sheetName).toBe('Replacement products')
  expect(replacementPreview.rows.map((row) => row.product.partNumber)).toEqual([replacement])
  await commit(page)
  expect((await request.get(`/api/products?partNumber=${replacement}`)).status()).toBe(200)
  await expectMissing(request, first)
  await expectMissing(request, second)
})

test('requires a fresh validation after unavailable validation or an unconfirmed import', async ({ page, request }) => {
  const part = partNumber()
  await uploadRows(page, [headers, productRow(part)])
  await page.route('**/api/products/import/preview', (route) => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await page.getByRole('button', { name: 'Validate workbook', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('unavailable')
  await expect(page.getByRole('button', { name: 'Import valid rows', exact: true })).toBeDisabled()
  await expectMissing(request, part)
  await page.unroute('**/api/products/import/preview')
  await validate(page)
  await page.route('**/api/products/import', (route) => route.abort('failed'))
  await page.getByRole('button', { name: 'Import valid rows', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The import could not be confirmed')
  await expect(page.getByRole('button', { name: 'Import valid rows', exact: true })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'Validation preview', exact: true })).toHaveCount(0)
  await expectMissing(request, part)
  await page.unroute('**/api/products/import')
  await validate(page)
  expect(await commit(page)).toMatchObject({ added: 1, updated: 0 })
})

test('discards a delayed validation response after selecting a different workbook', async ({ page, request }) => {
  const oldPart = partNumber()
  const newPart = partNumber()
  let acknowledge!: () => void
  let release!: () => void
  let complete!: () => void
  const requested = new Promise<void>((resolve) => { acknowledge = resolve })
  const released = new Promise<void>((resolve) => { release = resolve })
  const completed = new Promise<void>((resolve) => { complete = resolve })
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window)
    window.fetch = (input, init) => nativeFetch(input, { ...init, signal: undefined })
  })
  await page.route('**/api/products/import/preview', async (route) => {
    const response = await route.fetch()
    acknowledge()
    await released
    await route.fulfill({ response })
    complete()
  })
  await uploadRows(page, [headers, productRow(oldPart)], 'old-master.xlsx')
  await page.getByRole('button', { name: 'Validate workbook', exact: true }).click()
  await requested
  await expect(page.getByRole('button', { name: 'Validating…', exact: true })).toBeDisabled()
  await uploadRows(page, [headers, productRow(newPart)], 'new-master.xlsx')
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/products/import/preview')
  release()
  await completed
  expect(await (await response).finished()).toBeNull()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page.getByRole('heading', { name: 'Validation preview', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import valid rows', exact: true })).toBeDisabled()
  await page.unroute('**/api/products/import/preview')
  const preview = await validate(page)
  expect(preview.rows.map((row) => row.product.partNumber)).toEqual([newPart])
  await commit(page)
  await expectMissing(request, oldPart)
  expect((await request.get(`/api/products?partNumber=${newPart}`)).status()).toBe(200)
})

test('keeps the importer usable on mobile without making the page scroll horizontally', async ({ page }) => {
  const part = partNumber()
  await uploadRows(page, [headers, productRow(part, 'BRASS COUPLING WITH A LONG IMPORTED DESCRIPTION FOR MOBILE TABLES')], 'a-long-master-products-workbook-filename.xlsx')
  await validate(page)
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 1024 })
    await expect(page.getByLabel('Excel workbook (.xlsx)', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import valid rows', exact: true })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `Horizontal page overflow at ${width}px`).toBe(false)
  }
})

test('prefers BillcoMaster, maps its production headers, and selects independent fixed-label barcodes', async ({ page, request }) => {
  const part = partNumber()
  const packOnly = partNumber()
  await page.getByLabel('Excel workbook (.xlsx)', { exact: true }).setInputFiles(await workbookFile('Billco_App_Master.xlsx', [
    { name: 'Service PL', rows: [['Customer source'], ['Ignored customer row']] },
    { name: 'BillcoMaster', rows: [
      ['BillcoPart#', 'StdPackQty', 'Size', 'Description', 'ProductBarcode', 'BulkQty', 'BulkBarcode'],
      [part, 25, 'Ignored', 'PRODUCTION PRODUCT', `PACK-${part}`, 250, `BULK-${part}`],
      [packOnly, 10, 'Ignored', 'PACKAGE ONLY PRODUCT', `PACK-${packOnly}`, null, null],
    ] },
  ]))
  await expect(page.getByLabel('Worksheet', { exact: true })).toHaveValue('BillcoMaster')
  await expect(page.getByLabel('Map Part Number', { exact: true })).toHaveValue('1')
  await expect(page.getByLabel('Map Product Barcode', { exact: true })).toHaveValue('5')
  await expect(page.getByLabel('Map Bulk Barcode', { exact: true })).toHaveValue('7')
  await page.getByText('Detected columns (7)', { exact: true }).click()
  await expect(page.locator('.import-mapping details')).toContainText('3: Size')
  expect(await validate(page)).toMatchObject({ sheetName: 'BillcoMaster', added: 2, invalidRows: 0 })
  await expectMissing(request, part)
  await commit(page)
  await lookupImportedProduct(page, part, 'PRODUCTION PRODUCT')
  await expect(page.locator('.barcode-value').first()).toHaveText(`BULK-${part}`)
  await page.getByRole('button', { name: 'Expand label preview' }).click()
  await expect(page.getByRole('dialog').locator('.barcode-value')).toHaveText(`BULK-${part}`)
  await page.keyboard.press('Escape')
  await page.getByRole('radio', { name: 'Package Fixed Qty', exact: true }).check()
  await expect(page.locator('.barcode-value').first()).toHaveText(`PACK-${part}`)
  await page.getByRole('radio', { name: 'Bulk Variable Qty', exact: true }).check()
  await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('42')
  await expect(page.locator('.barcode-group')).toHaveCount(0)
  await page.getByRole('radio', { name: 'BCC', exact: true }).check()
  await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('8')
  await expect(page.locator('.barcode-group')).toHaveCount(0)
  await page.getByRole('radio', { name: 'Bulk Fixed Qty', exact: true }).check()
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill(packOnly)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('PACKAGE ONLY PRODUCT')
  await expect(page.getByRole('status').filter({ hasText: 'missing its bulk fixed quantity or barcode' })).toBeVisible()
  await expect(page.getByLabel('Product label preview', { exact: true })).toHaveCount(0)
  await page.getByRole('radio', { name: 'Package Fixed Qty', exact: true }).check()
  await expect(page.locator('.barcode-value').first()).toHaveText(`PACK-${packOnly}`)
  for (const name of ['BCC', 'Bulk Variable Qty']) {
    await page.getByRole('radio', { name, exact: true }).check()
    const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
    await expect(quantity).not.toHaveAttribute('readonly', '')
    await quantity.fill('16')
    await expect(page.getByLabel('Product label preview', { exact: true })).toBeVisible()
    await expect(page.locator('.label-quantity strong').first()).toHaveText('16')
    await expect(page.locator('.barcode-group')).toHaveCount(0)
  }
})

test('maps arbitrary supplier headers and ordered descriptions, and invalidates preview when mapping changes', async ({ page, request }) => {
  const part = partNumber()
  await uploadRows(page, [
    ['Supplier Part No', 'Material', 'Shape', 'Bulk Count', 'Unit Count', 'Unit UPC', 'Master Case UPC'],
    [part, 'HEX', 'HEAD', 300, 30, `PRODUCT-${part}`, `BULK-${part}`],
  ])
  await expect(page.getByLabel('Map Part Number', { exact: true })).toBeVisible()
  for (const [label, column] of [
    ['Part Number', '1'], ['Description 1', '2'], ['Description 2', '3'],
    ['Bulk Fixed Quantity', '4'], ['Package Fixed Quantity', '5'], ['Product Barcode', '6'], ['Bulk Barcode', '7'],
  ]) await page.getByLabel(`Map ${label}`, { exact: true }).selectOption(column)
  const first = await validate(page)
  expect(first.rows[0].product.description).toBe('HEX HEAD')
  await page.getByLabel('Map Description 2', { exact: true }).selectOption('')
  await expect(page.getByRole('heading', { name: 'Validation preview', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Import valid rows', exact: true })).toBeDisabled()
  expect((await validate(page)).rows[0].product.description).toBe('HEX')
  await expectMissing(request, part)
  await commit(page)
  const product = await (await request.get(`/api/products?partNumber=${part}`)).json()
  expect(product).toMatchObject({ description: 'HEX', productBarcode: `PRODUCT-${part}`, bulkBarcode: `BULK-${part}` })
})

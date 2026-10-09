import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Locator } from '@playwright/test'
import ExcelJS from 'exceljs'

async function importProduct(request: APIRequestContext, partNumber: string, description = 'HEX HEAD PIPE PLUG 1/2') {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('BillcoMaster').addRows([
    ['BillcoPart#', 'Description', 'StdPackQty', 'BulkQty', 'ProductBarcode', 'BulkBarcode'],
    [partNumber, description, 24, 672, '000123456789', '009876543210'],
  ])
  const response = await request.post('/api/products/import', {
    multipart: { file: { name: 'Billco_App_Master.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) } },
  })
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ added: 1, invalidRows: 0 })
}

async function verifyThermalLabel(label: Locator, height: number, part: string, barcode: string | null) {
  await expect(label.locator('.label-part strong')).toHaveText(part)
  await expect(label.locator('.label-brand')).toHaveText('BILLCOCORPORATION')
  const bounds = (await label.boundingBox())!
  expect(bounds.width / bounds.height).toBeCloseTo(3 / height, 2)
  const style = await label.evaluate((element) => {
    const part = parseFloat(getComputedStyle(element.querySelector('.label-part strong')!).fontSize)
    const text = [...element.querySelectorAll('strong, span')].map((node) => {
      const css = getComputedStyle(node)
      return { size: parseFloat(css.fontSize), color: css.color, italic: css.fontStyle, transform: css.transform }
    })
    const css = getComputedStyle(element)
    return { part, text, background: css.backgroundColor, borderRadius: css.borderRadius, shadow: css.boxShadow }
  })
  expect(style.background).toBe('rgb(255, 255, 255)')
  expect(style.borderRadius).toBe('0px')
  expect(style.shadow).toBe('none')
  for (const text of style.text) {
    expect(text.size).toBeLessThanOrEqual(style.part)
    expect(text.color).toBe('rgb(0, 0, 0)')
    expect(text.italic).toBe('normal')
    expect(text.transform).toBe('none')
  }
  expect(style.part).toBeGreaterThan(await label.locator('.label-quantity strong').evaluate((node) => parseFloat(getComputedStyle(node).fontSize)))
  if (height === 2) {
    await expect(label.locator('.label-description')).toHaveCount(0)
    await expect(label.locator('.label-po')).toHaveCount(0)
  } else {
    await expect(label.locator('.label-description strong')).toHaveText('HEX HEAD PIPE PLUG 1/2')
    await expect(label.locator('.label-po strong')).toHaveText('PO-123')
  }
  if (barcode) {
    await expect(label.locator('.barcode-value')).toHaveText(barcode)
    await expect(label.getByRole('img', { name: `Code 128 barcode for ${barcode}` })).toBeVisible()
    expect(await label.locator('.barcode rect').count()).toBeGreaterThan(10)
  } else await expect(label.locator('.barcode-group')).toHaveCount(0)
}

for (const mode of [
  { name: 'Bulk Fixed Qty', height: 5, barcode: '009876543210', quantity: '672', editable: false },
  { name: 'Package Fixed Qty', height: 2, barcode: '000123456789', quantity: '24', editable: false },
  { name: 'Bulk Variable Qty', height: 5, barcode: null, quantity: '75', editable: true },
  { name: 'BCC', height: 2, barcode: null, quantity: '75', editable: true },
]) {
  test(`${mode.name} renders imported data with dominant Part Number and a thermal layout`, async ({ page, request }) => {
    const part = `5123-${randomUUID().slice(0, 4)}`
    await importProduct(request, part)
    await page.goto('/')
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling')
    await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill(part)
    // Changing the part number looks up the imported product without pressing Search.
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue('HEX HEAD PIPE PLUG 1/2')
    await page.getByRole('radio', { name: mode.name, exact: true }).check()
    const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
    if (mode.editable) await quantity.fill(mode.quantity)
    else await expect(quantity).toHaveAttribute('readonly', '')
    await expect(quantity).toHaveValue(mode.quantity)
    await page.getByRole('textbox', { name: 'PO Number', exact: true }).fill('PO-123')
    await page.getByRole('textbox', { name: 'Lot Number', exact: true }).fill('LOT-321')
    await expect(page.locator('.label-lot strong').first()).toHaveText('LOT-321')
    await verifyThermalLabel(page.locator('.product-label').first(), mode.height, part, mode.barcode)
    await page.getByRole('button', { name: 'Expand label preview' }).click()
    const dialog = page.getByRole('dialog')
    await verifyThermalLabel(dialog.locator('.product-label'), mode.height, part, mode.barcode)
    await page.keyboard.press('Escape')
    await page.getByRole('textbox', { name: 'Lot Number', exact: true }).fill('LOT-UPDATED')
    await expect(page.locator('.label-lot strong').first()).toHaveText('LOT-UPDATED')
  })
}

test('fits complete long imported identifiers and descriptions at desktop and mobile sizes', async ({ page, request }) => {
  const part = `${randomUUID()}-ABCDEFGHIJKLMNOPQRSTUVWXYZ0`
  const description = 'LONG IMPORTED DESCRIPTION WITH DIMENSIONS AND MATERIAL '.repeat(10).slice(0, 512)
  await importProduct(request, part, description)
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill(part)
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(description)
  for (const width of [1536, 390]) {
    await page.setViewportSize({ width, height: 1024 })
    for (const name of ['Bulk Fixed Qty', 'Package Fixed Qty', 'BCC', 'Bulk Variable Qty']) {
      await page.getByRole('radio', { name, exact: true }).check()
      await expect(page.locator('.label-part strong').first()).toHaveText(part)
      await expect.poll(() => page.locator('.product-label').first().evaluate((label) => {
        const partSize = parseFloat(getComputedStyle(label.querySelector('.label-part strong')!).fontSize)
        return [...label.querySelectorAll('strong')].flatMap((node) => {
          const rect = node.getBoundingClientRect()
          const outer = label.getBoundingClientRect()
          const fits = node.scrollHeight <= node.clientHeight && node.scrollWidth <= node.clientWidth
            && rect.bottom <= outer.bottom && rect.right <= outer.right
            && parseFloat(getComputedStyle(node).fontSize) <= partSize
          return fits ? [] : [{ field: node.parentElement!.className, client: [node.clientWidth, node.clientHeight], scroll: [node.scrollWidth, node.scrollHeight], bottom: rect.bottom, right: rect.right, outerBottom: outer.bottom, outerRight: outer.right, size: getComputedStyle(node).fontSize, partSize }]
        })
      })).toEqual([])
    }
  }
})

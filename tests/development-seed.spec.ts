import { expect, test } from '@playwright/test'

test('fresh development startup provides real lookups and all label modes without workbook upload', async ({ page, request }) => {
  // Playwright starts npm run dev against a fresh temporary SQLite database.
  for (const part of ['PA.013', 'AB.025X013', 'HR.013']) {
    const response = await request.get(`/api/products?partNumber=${part.toLowerCase()}`)
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ partNumber: part, status: 'active' })
  }
  await page.goto('/')
  const input = page.getByRole('textbox', { name: 'Part Number', exact: true })
  const preview = page.getByRole('region', { name: 'Label Preview', exact: true })
  for (const mode of [
    { name: 'Package Fixed Qty', quantity: '100', barcode: '75328800951' },
    { name: 'Bulk Fixed Qty', quantity: '500', barcode: '75328800903' },
    { name: 'Bulk Variable Qty', quantity: '37', barcode: null },
    { name: 'BCC', quantity: '37', barcode: null },
  ]) {
    await page.getByRole('radio', { name: mode.name, exact: true }).check()
    await input.fill('pa.013')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(input).toHaveValue('PA.013')
    const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
    if (!mode.barcode) await quantity.fill(mode.quantity)
    await expect(quantity).toHaveValue(mode.quantity)
    await expect(preview.locator('.label-part strong')).toHaveText('PA.013')
    await expect(preview.locator('.label-description strong')).toHaveText('6061 ALUMINUM TT FULL COUPLINGS')
    if (mode.barcode) await expect(preview.locator('.barcode-value')).toHaveText(mode.barcode)
    else await expect(preview.locator('.barcode-group')).toHaveCount(0)
  }
})

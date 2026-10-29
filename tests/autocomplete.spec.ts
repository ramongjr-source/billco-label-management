import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'

test.beforeEach(async ({ page }) => { await page.goto('/'); await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling') })

test('partial part and description suggestions support keyboard navigation, Escape, and mouse selection', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Part Number', exact: true })
  await input.fill('  pa ')
  const options = page.getByRole('listbox', { name: 'Matching products' }).getByRole('option')
  await expect(options.first()).toContainText('PA.013')
  expect(await options.count()).toBeLessThanOrEqual(10)
  await input.press('ArrowDown'); await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await input.press('ArrowDown'); await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await input.press('ArrowUp'); await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await input.press('Escape'); await expect(options).toHaveCount(0)
  await input.fill('bush')
  await expect(options.filter({ hasText: 'AB.025X013' })).toContainText('BLK HEX BUSHINGS')
  await options.filter({ hasText: 'AB.025X013' }).click()
  await expect(input).toHaveValue('AB.025X013')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('BLK HEX BUSHINGS')
})

for (const mode of [
  { name: 'Package Fixed Qty', id: 'package-fixed', qty: '100', barcode: '75328800951' },
  { name: 'Bulk Fixed Qty', id: 'bulk-fixed', qty: '500', barcode: '75328800903' },
  { name: 'Bulk Variable Qty', id: 'bulk-variable', qty: '', barcode: null },
  { name: 'BCC', id: 'bcc', qty: '', barcode: null },
]) test(`autocomplete loads ${mode.name} preview and captures dropdown`, async ({ page }) => {
  await page.getByRole('radio', { name: mode.name, exact: true }).check()
  const input = page.getByRole('textbox', { name: 'Part Number', exact: true })
  await input.fill('PA')
  await expect(page.getByRole('listbox', { name: 'Matching products' }).getByRole('option').first()).toContainText('PA.013')
  mkdirSync('docs/screenshots/autocomplete', { recursive: true })
  await page.screenshot({ path: `docs/screenshots/autocomplete/${mode.id}.png`, fullPage: true })
  await input.press('ArrowDown'); await input.press('Enter')
  await expect(input).toHaveValue('PA.013')
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue(mode.qty)
  const preview = page.getByLabel('Product label preview', { exact: true })
  await expect(preview.locator('.label-part strong')).toHaveText('PA.013')
  await expect(preview.locator('.label-description strong')).toHaveText('6061 ALUMINUM TT FULL COUPLINGS')
  if (mode.barcode) await expect(preview.locator('.barcode-value')).toHaveText(mode.barcode)
  else { await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('37'); await expect(preview.locator('.label-quantity strong')).toHaveText('37'); await expect(preview.locator('.barcode-group')).toHaveCount(0) }
})

test('Enter immediately loads an exact match before suggestions arrive and without highlighting', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Part Number', exact: true })
  await input.fill(' pa.013 '); await input.press('Enter')
  await expect(input).toHaveValue('PA.013')
  await input.fill('pa.013')
  await expect(page.getByRole('listbox', { name: 'Matching products' }).getByRole('option').first()).toContainText('PA.013')
  await input.press('Enter')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('6061 ALUMINUM TT FULL COUPLINGS')
  await expect(page.getByRole('listbox', { name: 'Matching products' }).getByRole('option')).toHaveCount(0)
})

test('obsolete suggestions cannot reopen after Escape, Clear, or a newer query', async ({ page }) => {
  await page.evaluate(() => {
    const fetchOriginal = window.fetch.bind(window)
    window.fetch = (input, init) => fetchOriginal(input, { ...init, signal: undefined })
  })
  const input = page.getByRole('textbox', { name: 'Part Number', exact: true })
  let release!: () => void
  let requested!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { requested = resolve })
  await page.route('**/api/products/search?q=PA', async route => {
    const response = await route.fetch()
    requested(); await held; await route.fulfill({ response })
  })
  await input.fill('PA'); await started
  await input.press('Escape')
  await input.fill('bush')
  await expect(page.getByRole('listbox')).toContainText('AB.025X013')
  const response = page.waitForResponse(r => r.url().endsWith('/api/products/search?q=PA'))
  release(); await response
  await expect(page.getByRole('listbox')).toContainText('AB.025X013')
  await expect(page.getByRole('listbox')).not.toContainText('PA.013')
  await page.getByRole('button', { name: 'CLEAR', exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(input).toHaveValue('')
})

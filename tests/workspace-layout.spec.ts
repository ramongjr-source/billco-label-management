import { expect, test } from '@playwright/test'

for (const height of [1080, 1000]) {
  test(`desktop workspace keeps the entire workflow visible at 1920×${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height })
    await page.goto('/')
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling')
    await page.getByRole('combobox', { name: 'Printer', exact: true }).selectOption('example-sato-1')
    await page.getByRole('spinbutton', { name: 'Print Quantity', exact: true }).fill('25')
    const fits = () => page.evaluate(() => {
      const selectors = ['#part-number', '#description', '#customer', '#quantity', '#po-number', '#lot-number', '#printer', '#print-quantity', '.print-toolbar > button', '.product-label', '.preview-panel']
      return {
        overflow: Math.max(0, document.documentElement.scrollHeight - innerHeight),
        outside: selectors.filter(selector => {
          const r = document.querySelector(selector)!.getBoundingClientRect()
          return r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth
        }),
      }
    })
    for (const mode of ['Bulk Fixed Qty', 'Package Fixed Qty', 'Bulk Variable Qty', 'BCC']) {
      await page.getByRole('radio', { name: mode, exact: true }).check()
      if (mode === 'Bulk Variable Qty' || mode === 'BCC') await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('75')
      await expect(page.locator('.print-panel details')).not.toHaveAttribute('open')
      await expect.poll(fits).toEqual({ overflow: 0, outside: [] })
      const label = await page.locator('.product-label').boundingBox()
      expect(label!.width).toBe(435)
      const saved = page.waitForResponse(response => response.url().endsWith('/api/print-jobs') && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'PRINT', exact: true }).click()
      expect((await saved).status()).toBe(201)
      await expect(page.getByRole('status').filter({ hasText: 'Job recorded:' })).toBeVisible()
      await expect.poll(fits).toEqual({ overflow: 0, outside: [] })
    }
  })
}

import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('printer settings and audited stock changes persist and disabled devices disappear from selection', async ({ page, request }) => {
  const name = `A Config-${randomUUID()}`
  await page.goto('/')
  await page.getByRole('button', { name: 'Printer Setup', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Printer registry', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add printer', exact: true }).click()
  await page.getByLabel('Printer Name', { exact: true }).fill(name)
  await page.getByLabel('IP Address', { exact: true }).fill('192.168.1.194')
  await page.getByLabel('Description', { exact: true }).fill('Configurable operator station')
  await page.getByLabel('Supported Media', { exact: true }).fill('Aluminum, Stainless, Brass')
  await page.getByLabel('Require media confirmation', { exact: true }).check()
  const created = page.waitForResponse(response => response.url().endsWith('/api/printers') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Save printer settings', exact: true }).click()
  const response = await created
  expect(response.status()).toBe(201)
  const printer = await response.json()
  await expect(page.getByRole('status')).toHaveText('Printer settings saved.')
  await expect(page.getByText('No media change recorded. Confirm the stock loaded before use.')).toBeVisible()
  await page.getByLabel('Current Media', { exact: true }).fill('Aluminum')
  await page.getByLabel('Operator Name', { exact: true }).fill('Configuration Operator')
  await page.getByRole('button', { name: 'Save media change', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Loaded media updated and audited.')
  await expect(page.locator('.printer-media-history')).not.toHaveAttribute('open')
  await page.getByText('Media change history', { exact: true }).click()
  await expect(page.locator('.printer-audit-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.printer-audit-table')).toContainText('Configuration Operator')
  await expect(page.locator('.printer-audit-table')).toContainText('Unknown')
  await expect(page.locator('.printer-audit-table')).toContainText('Aluminum')
  await page.reload()
  await page.getByRole('button', { name: 'Printer Setup', exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByLabel('IP Address', { exact: true })).toHaveValue('192.168.1.194')
  await expect(page.getByLabel('Current Media', { exact: true })).toHaveValue('Aluminum')
  await expect(page.getByLabel('Require media confirmation', { exact: true })).toBeChecked()
  await page.getByLabel('Supported Media', { exact: true }).fill('Black 3x2, Magenta')
  await page.getByLabel('Enabled', { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save printer settings', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Printer settings saved.')
  const records = await (await request.get('/api/printers')).json()
  expect(records.find((record: { id: string }) => record.id === printer.id)).toMatchObject({
    status: 'inactive', ipAddress: '192.168.1.194', description: 'Configurable operator station', currentMedia: 'Aluminum',
    supportedMedia: ['Black 3x2', 'Magenta'], lastMediaChangeUser: 'Configuration Operator',
  })
  await page.getByRole('button', { name: 'Bulk Fixed Qty', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Printer', exact: true }).locator(`option[value="${printer.id}"]`)).toHaveCount(0)
})

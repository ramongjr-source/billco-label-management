import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('records all four label types, separates copies from label quantity, and remembers the printer', async ({ page, request }) => {
  const response = await request.post('/api/printers', { data: { name: `Printer-${randomUUID()}`, model: 'CL4NX Plus' } })
  expect(response.status()).toBe(201)
  const printer = await response.json()
  await page.addInitScript(() => { window.print = () => { throw new Error('Physical printing must not be invoked') } })
  await page.goto('/')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling')
  const select = page.getByRole('combobox', { name: 'Printer', exact: true })
  await select.selectOption(printer.id)
  await page.reload()
  await expect(select).toHaveValue(printer.id)
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling')
  for (const [mode, labelQuantity, copies] of [
    ['Bulk Fixed Qty', '500', '25'], ['Package Fixed Qty', '50', '100'], ['Bulk Variable Qty', '72', '1'], ['BCC', '18', '25'],
  ]) {
    await page.getByRole('radio', { name: mode, exact: true }).check()
    const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
    if (mode === 'BCC' || mode === 'Bulk Variable Qty') await quantity.fill(labelQuantity)
    await expect(quantity).toHaveValue(labelQuantity)
    const printQuantity = page.getByRole('spinbutton', { name: 'Print Quantity', exact: true })
    await printQuantity.fill('0')
    await expect(page.getByRole('button', { name: 'PRINT', exact: true })).toBeDisabled()
    await printQuantity.fill(copies)
    const saved = page.waitForResponse(response => response.url().endsWith('/api/print-jobs') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'PRINT', exact: true }).click()
    const job = await (await saved).json()
    expect(job.status).toBe('recorded')
    expect(job.printQuantity).toBe(Number(copies))
    expect(job.label.quantity).toBe(Number(labelQuantity))
    expect(job.printer.id).toBe(printer.id)
    await expect(page.getByRole('status').filter({ hasText: 'Job recorded:' })).toContainText('No labels have been sent')
  }
  await page.getByText('Print history', { exact: true }).click()
  await expect(page.locator('.print-history li').filter({ hasText: printer.name })).toHaveCount(4)
  await page.reload()
  await page.getByText('Print history', { exact: true }).click()
  await expect(page.locator('.print-history li').filter({ hasText: printer.name })).toHaveCount(4)
})

test('does not restore an inactive remembered printer', async ({ page, request }) => {
  const printer = await (await request.post('/api/printers', { data: { name: `Inactive-${randomUUID()}`, model: 'CL4NX Plus' } })).json()
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Printer', exact: true }).selectOption(printer.id)
  await request.patch(`/api/printers/${printer.id}`, { data: { status: 'inactive' } })
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Printer', exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'PRINT', exact: true })).toBeDisabled()
})

test('retries a lost response without recording duplicate jobs', async ({ page, request }) => {
  const printer = await (await request.post('/api/printers', { data: { name: `Retry-${randomUUID()}`, model: 'CL4NX Plus' } })).json()
  await page.goto('/')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling')
  await page.getByRole('combobox', { name: 'Printer', exact: true }).selectOption(printer.id)
  let requestId = ''
  await page.route('**/api/print-jobs', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    requestId = route.request().postDataJSON().requestId
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    await route.abort('failed')
  }, { times: 1 })
  await page.getByRole('button', { name: 'PRINT', exact: true }).click()
  await expect(page.getByRole('button', { name: 'PRINT', exact: true })).toBeEnabled()
  const retry = page.waitForResponse(response => response.url().endsWith('/api/print-jobs') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'PRINT', exact: true }).click()
  const response = await retry
  expect(response.status()).toBe(200)
  expect((await response.json()).requestId).toBe(requestId)
  const history = await (await request.get('/api/print-jobs')).json()
  expect(history.jobs.filter((job: { printer: { id: string } }) => job.printer.id === printer.id)).toHaveLength(1)
})

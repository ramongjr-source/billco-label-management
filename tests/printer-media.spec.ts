import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { MediaHistoryPage, Printer, PrintJob } from '../shared/printing'

async function configuredPrinter(request: APIRequestContext) {
  const response = await request.post('/api/printers', { data: {
    name: `Metal-${randomUUID()}`, model: 'SATO CL4NX Plus',
    supportedMedia: ['Aluminum', 'Stainless', 'Brass'], mediaValidationEnabled: true,
  } })
  expect(response.status()).toBe(201)
  const printer = await response.json() as Printer
  await loadMedia(request, printer.id, null, 'Aluminum')
  return printer
}

async function loadMedia(request: APIRequestContext, id: string, previousMedia: string | null, currentMedia: string) {
  const response = await request.post(`/api/printers/${id}/media-changes`, { data: {
    currentMedia, user: 'Setup Operator', expectedCurrentMedia: previousMedia, requestId: randomUUID(),
  } })
  expect(response.status()).toBe(201)
}

async function mediaHistory(request: APIRequestContext, id: string) {
  return await (await request.get(`/api/printers/${id}/media-history`)).json() as MediaHistoryPage
}

async function printerJobs(request: APIRequestContext, id: string) {
  const history = await (await request.get('/api/print-jobs')).json() as { jobs: PrintJob[] }
  return history.jobs.filter(job => job.printer.id === id)
}

async function openWorkspace(page: Page, printer: Printer) {
  await page.addInitScript(() => { window.print = () => { throw new Error('Physical printing must not be invoked') } })
  await page.goto('/')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling')
  await page.getByRole('combobox', { name: 'Printer', exact: true }).selectOption(printer.id)
}

const printResponse = (page: Page) => page.waitForResponse(response => response.url().endsWith('/api/print-jobs') && response.request().method() === 'POST')

test('media mismatch blocks recording; Cancel and Escape do not change media; matching stock needs no confirmation', async ({ page, request }) => {
  const printer = await configuredPrinter(request)
  await openWorkspace(page, printer)
  const print = page.getByRole('button', { name: 'PRINT', exact: true })
  const dialog = page.getByRole('dialog', { name: 'MEDIA MISMATCH', exact: true })
  await expect(print).toBeDisabled()
  await page.getByRole('combobox', { name: 'Requested Material', exact: true }).selectOption('Brass')
  for (const cancelWithEscape of [false, true]) {
    const blocked = printResponse(page)
    await print.click()
    expect((await blocked).status()).toBe(409)
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.media-comparison')).toContainText('Brass')
    await expect(dialog.locator('.media-comparison')).toContainText('Aluminum')
    await expect(dialog.getByRole('button', { name: 'Media Changed - Continue', exact: true })).toBeDisabled()
    if (cancelWithEscape) await page.keyboard.press('Escape')
    else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect((await mediaHistory(request, printer.id)).changes).toHaveLength(1)
    expect(await printerJobs(request, printer.id)).toHaveLength(0)
  }
  await print.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Operator name', exact: true }).fill('Metal Operator')
  const saved = printResponse(page)
  await dialog.getByRole('button', { name: 'Media Changed - Continue', exact: true }).click()
  expect((await saved).status()).toBe(201)
  await expect(dialog).not.toBeVisible()
  const audit = await mediaHistory(request, printer.id)
  expect(audit.changes).toHaveLength(2)
  expect(audit.changes[0]).toMatchObject({ previousMedia: 'Aluminum', newMedia: 'Brass', user: 'Metal Operator', printerId: printer.id })
  const next = printResponse(page)
  await print.click()
  expect((await next).status()).toBe(201)
  await expect(dialog).not.toBeVisible()
  expect((await mediaHistory(request, printer.id)).changes).toHaveLength(2)
  expect(await printerJobs(request, printer.id)).toHaveLength(2)
})

test('server media overrides stale browser state and concurrent changes cannot be silently overwritten', async ({ page, request }) => {
  const printer = await configuredPrinter(request)
  await openWorkspace(page, printer)
  await page.getByRole('combobox', { name: 'Requested Material', exact: true }).selectOption('Brass')
  await loadMedia(request, printer.id, 'Aluminum', 'Stainless')
  await page.getByRole('button', { name: 'PRINT', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'MEDIA MISMATCH', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.media-comparison')).toContainText('Stainless')
  await dialog.getByRole('textbox', { name: 'Operator name', exact: true }).fill('Review Operator')
  await loadMedia(request, printer.id, 'Stainless', 'Aluminum')
  await dialog.getByRole('button', { name: 'Media Changed - Continue', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Current media changed')
  expect((await mediaHistory(request, printer.id)).changes).toHaveLength(3)
  expect(await printerJobs(request, printer.id)).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'PRINT', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.media-comparison')).toContainText('Aluminum')
  const saved = printResponse(page)
  await dialog.getByRole('button', { name: 'Media Changed - Continue', exact: true }).click()
  expect((await saved).status()).toBe(201)
  expect((await mediaHistory(request, printer.id)).changes).toHaveLength(4)
})

test('lost media confirmation response retries the same audit and original print request exactly once', async ({ page, request }) => {
  const printer = await configuredPrinter(request)
  await openWorkspace(page, printer)
  await page.getByRole('combobox', { name: 'Requested Material', exact: true }).selectOption('Brass')
  await page.getByRole('spinbutton', { name: 'Print Quantity', exact: true }).fill('25')
  const mismatch = printResponse(page)
  await page.getByRole('button', { name: 'PRINT', exact: true }).click()
  const originalRequest = (await mismatch).request().postDataJSON()
  const dialog = page.getByRole('dialog', { name: 'MEDIA MISMATCH', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Operator name', exact: true }).fill('Retry Operator')
  let mediaRequestId = ''
  await page.route(`**/api/printers/${printer.id}/media-changes`, async route => {
    mediaRequestId = route.request().postDataJSON().requestId
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    await route.abort('failed')
  }, { times: 1 })
  await dialog.getByRole('button', { name: 'Media Changed - Continue', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  expect((await mediaHistory(request, printer.id)).changes).toHaveLength(2)
  expect(await printerJobs(request, printer.id)).toHaveLength(0)
  const retryMedia = page.waitForResponse(response => response.url().endsWith(`/api/printers/${printer.id}/media-changes`))
  const saved = printResponse(page)
  await dialog.getByRole('button', { name: 'Media Changed - Continue', exact: true }).click()
  const mediaResponse = await retryMedia
  expect(mediaResponse.status()).toBe(200)
  expect(mediaResponse.request().postDataJSON().requestId).toBe(mediaRequestId)
  const response = await saved
  expect(response.status()).toBe(201)
  const job = await response.json() as PrintJob
  expect(job).toMatchObject({ requestId: originalRequest.requestId, requestedMedia: 'Brass', printQuantity: 25 })
  expect(job.label.quantity).toBe(500)
  expect((await mediaHistory(request, printer.id)).changes).toHaveLength(2)
  expect(await printerJobs(request, printer.id)).toHaveLength(1)
})

test('all four label workflows include material confirmation without scrolling at 1920×900', async ({ page, request }) => {
  const printer = await configuredPrinter(request)
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.addInitScript(() => {
    Object.assign(window, { workspaceScrollEvents: 0 })
    window.addEventListener('scroll', () => {
      const state = window as typeof window & { workspaceScrollEvents: number }
      state.workspaceScrollEvents += 1
    })
  })
  await openWorkspace(page, printer)
  const fits = () => page.evaluate(() => {
    const selectors = ['#part-number', '#description', '#customer', '#quantity', '#po-number', '#lot-number', '#printer', '#print-quantity', '#requested-material', '.loaded-media', '.label-type-group', '.form-actions', '.print-toolbar > button', '.product-label', '.preview-panel']
    return {
      scrollY,
      scrollEvents: (window as typeof window & { workspaceScrollEvents: number }).workspaceScrollEvents,
      overflow: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      outside: selectors.filter(selector => {
        const bounds = document.querySelector(selector)!.getBoundingClientRect()
        return bounds.top < 0 || bounds.bottom > innerHeight || bounds.left < 0 || bounds.right > innerWidth
      }),
    }
  })
  for (const [mode, material] of [
    ['Bulk Fixed Qty', 'Brass'], ['Package Fixed Qty', 'Stainless'], ['Bulk Variable Qty', 'Aluminum'], ['BCC', 'Brass'],
  ]) {
    await page.getByRole('radio', { name: mode, exact: true }).check()
    if (mode === 'Bulk Variable Qty' || mode === 'BCC') await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('75')
    await page.getByRole('combobox', { name: 'Requested Material', exact: true }).selectOption(material)
    await page.getByRole('spinbutton', { name: 'Print Quantity', exact: true }).fill('25')
    for (const details of await page.locator('.print-panel details').all()) await expect(details).not.toHaveAttribute('open')
    await expect.poll(fits).toEqual({ scrollY: 0, scrollEvents: 0, overflow: 0, outside: [] })
    await page.getByRole('button', { name: 'PREVIEW', exact: true }).click()
    await expect.poll(fits).toEqual({ scrollY: 0, scrollEvents: 0, overflow: 0, outside: [] })
    expect((await page.locator('.product-label').boundingBox())!.width).toBe(435)
    await page.getByRole('button', { name: 'PRINT', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'MEDIA MISMATCH', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Operator name', exact: true })).toBeInViewport()
    await expect(dialog.getByRole('button', { name: 'Media Changed - Continue', exact: true })).toBeInViewport()
    await expect.poll(fits).toEqual({ scrollY: 0, scrollEvents: 0, overflow: 0, outside: [] })
    await dialog.getByRole('textbox', { name: 'Operator name', exact: true }).fill('Workstation Operator')
    const saved = printResponse(page)
    await dialog.getByRole('button', { name: 'Media Changed - Continue', exact: true }).click()
    expect((await saved).status()).toBe(201)
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Job recorded:' })).toBeVisible()
    await expect.poll(fits).toEqual({ scrollY: 0, scrollEvents: 0, overflow: 0, outside: [] })
  }
})

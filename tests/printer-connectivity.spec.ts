import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { expect, test, type Page } from '@playwright/test'
import type { Printer, PrinterConnectionHistoryPage, PrinterConnectionTestResult } from '../shared/printing'

async function connectionFixture() {
  let bytes = 0
  let connections = 0
  const sockets = new Set<Socket>()
  const server = createServer(socket => {
    connections += 1
    sockets.add(socket)
    socket.on('data', data => { bytes += data.length })
    socket.on('error', () => { /* The diagnostic closes its connection immediately. */ })
    socket.once('close', () => sockets.delete(socket))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    port: (server.address() as AddressInfo).port,
    bytes: () => bytes,
    connections: () => connections,
    openSockets: () => sockets.size,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}

async function setupPage(page: Page, printer: Printer) {
  await page.goto('/')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling', { timeout: 15000 })
  await page.getByRole('button', { name: 'Printer Setup', exact: true }).click()
  await page.getByRole('button', { name: printer.name, exact: true }).click()
}
const testResponse = (page: Page, id: string) => page.waitForResponse(response => response.url().endsWith(`/api/printers/${id}/test-connection`) && response.request().method() === 'POST')

test('manual tests persist Online/Offline and connection history, send no data, and never run while recording jobs', async ({ page, request }) => {
  const fixture = await connectionFixture()
  try {
    const printer = await (await request.post('/api/printers', { data: { name: `A Connect-${randomUUID()}`, model: 'SATO CL4NX Plus', ipAddress: '127.0.0.1', port: fixture.port, connectionTimeoutMs: 1000 } })).json() as Printer
    await setupPage(page, printer)
    const panel = page.locator('.printer-connection-panel')
    await expect(panel).toContainText('Unknown')
    await expect(page.getByLabel('Port', { exact: true })).toHaveValue(String(fixture.port))
    await expect(page.getByLabel('Connection Timeout (ms)', { exact: true })).toHaveValue('1000')
    await expect(page.locator('.printer-connection-history')).not.toHaveAttribute('open')
    expect(fixture.connections()).toBe(0)
    const tested = testResponse(page, printer.id)
    await page.getByRole('button', { name: 'Test Connection', exact: true }).click()
    const online = await (await tested).json() as PrinterConnectionTestResult
    expect(online).toMatchObject({ applied: true, printer: { connectionStatus: 'online', status: 'active' }, connection: { result: 'success', errorMessage: null, ipAddress: '127.0.0.1', port: fixture.port } })
    await expect(panel).toContainText('Connection Successful')
    await expect(panel.locator('.printer-connection-status')).toHaveText('Online')
    await expect.poll(fixture.openSockets).toBe(0)
    expect(fixture.bytes()).toBe(0)
    expect(fixture.connections()).toBe(1)
    await page.getByRole('button', { name: 'Refresh printers', exact: true }).click()
    await expect(panel.locator('.printer-connection-status')).toHaveText('Online')
    expect(fixture.connections()).toBe(1)
    await page.reload()
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling', { timeout: 15000 })
    await page.getByRole('button', { name: 'Printer Setup', exact: true }).click()
    await page.getByRole('button', { name: printer.name, exact: true }).click()
    await expect(panel.locator('.printer-connection-status')).toHaveText('Online')
    await fixture.close()
    const failed = testResponse(page, printer.id)
    await page.getByRole('button', { name: 'Test Connection', exact: true }).click()
    const offline = await (await failed).json() as PrinterConnectionTestResult
    expect(offline.printer.connectionStatus).toBe('offline')
    expect(offline.printer.lastSuccessfulConnectionAt).toBe(online.printer.lastSuccessfulConnectionAt)
    expect(offline.connection.result).toBe('failure')
    expect(offline.connection.errorMessage).toBeTruthy()
    await expect(panel).toContainText('Connection Failed')
    await expect(panel.locator('.printer-connection-status')).toHaveText('Offline')
    await page.getByText('Connection history', { exact: true }).click()
    await expect(page.locator('.printer-connection-history-table tbody tr')).toHaveCount(2)
    await expect(page.locator('.printer-connection-history-table')).toContainText('127.0.0.1')
    await expect(page.locator('.printer-connection-history-table')).toContainText(String(fixture.port))
    // Connectivity is diagnostic; the existing foundation still records jobs independently.
    await page.getByRole('button', { name: 'Bulk Fixed Qty', exact: true }).click()
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling')
    await page.getByRole('combobox', { name: 'Printer', exact: true }).selectOption(printer.id)
    const saved = page.waitForResponse(response => response.url().endsWith('/api/print-jobs') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'PRINT', exact: true }).click()
    expect((await saved).status()).toBe(201)
    const history = await (await request.get(`/api/printers/${printer.id}/connection-history`)).json() as PrinterConnectionHistoryPage
    expect(history.connections).toHaveLength(2)
    expect(fixture.bytes()).toBe(0)
  } finally { await fixture.close() }
})

test('connection settings must be saved, endpoint changes clear stale status, and Enabled remains independent', async ({ page, request }) => {
  const fixture = await connectionFixture()
  try {
    await page.setViewportSize({ width: 1920, height: 900 })
    const printer = await (await request.post('/api/printers', { data: { name: `A Connect-${randomUUID()}`, model: 'SATO CL4NX Plus' } })).json() as Printer
    await setupPage(page, printer)
    const panel = page.locator('.printer-connection-panel')
    const testButton = page.getByRole('button', { name: 'Test Connection', exact: true })
    await expect(testButton).toBeDisabled()
    await expect(page.getByLabel('Port', { exact: true })).toHaveValue('9100')
    await expect(page.getByLabel('Connection Timeout (ms)', { exact: true })).toHaveValue('3000')
    await page.getByLabel('IP Address', { exact: true }).fill('127.0.0.1')
    await page.getByLabel('Port', { exact: true }).fill(String(fixture.port))
    await page.getByLabel('Connection Timeout (ms)', { exact: true }).fill('1000')
    await expect(testButton).toBeDisabled()
    await expect(panel).toContainText('Save')
    await page.getByLabel('Enabled', { exact: true }).uncheck()
    await page.getByRole('button', { name: 'Save printer settings', exact: true }).click()
    await expect(testButton).toBeEnabled()
    expect(fixture.connections()).toBe(0)
    const tested = testResponse(page, printer.id)
    await testButton.click()
    const online = await (await tested).json() as PrinterConnectionTestResult
    expect(online.printer).toMatchObject({ status: 'inactive', connectionStatus: 'online', port: fixture.port, connectionTimeoutMs: 1000 })
    await expect(page.getByLabel('Enabled', { exact: true })).not.toBeChecked()
    await expect(panel.locator('.printer-connection-status')).toHaveText('Online')
    await page.getByLabel('Connection Timeout (ms)', { exact: true }).fill('2000')
    await expect(testButton).toBeDisabled()
    await page.getByRole('button', { name: 'Save printer settings', exact: true }).click()
    await expect(panel.locator('.printer-connection-status')).toHaveText('Unknown')
    const registry = await (await request.get('/api/printers')).json() as Printer[]
    expect(registry.find(item => item.id === printer.id)).toMatchObject({ connectionTimeoutMs: 2000, lastSuccessfulConnectionAt: null, lastConnectionTestAt: null })
    const history = await (await request.get(`/api/printers/${printer.id}/connection-history`)).json() as PrinterConnectionHistoryPage
    expect(history.connections).toHaveLength(1)
    expect(history.connections[0].connectionTimeoutMs).toBe(1000)
    expect(fixture.connections()).toBe(1)
    await expect(page.locator('.printer-connection-history')).not.toHaveAttribute('open')
    await expect(page.locator('.printer-media-history')).not.toHaveAttribute('open')
    await expect(testButton).toBeInViewport()
    await expect(page.getByLabel('Current Media', { exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBe(0)
  } finally { await fixture.close() }
})

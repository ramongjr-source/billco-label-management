import { expect, test, type Page, type Request, type Response } from '@playwright/test'

function isLookup(request: Request, partNumber: string) {
  const url = new URL(request.url())
  return request.method() === 'GET' && url.pathname === '/api/products' && url.searchParams.get('partNumber') === partNumber
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function holdLookup(page: Page, partNumber: string) {
  const requested = deferred()
  const released = deferred()
  const completed = deferred()
  await page.route((url) => url.pathname === '/api/products' && url.searchParams.get('partNumber') === partNumber, async (route) => {
    const response = await route.fetch()
    requested.resolve()
    await released.promise
    try {
      await route.fulfill({ response })
    } finally {
      completed.resolve()
    }
  })
  return {
    requested: requested.promise,
    async release() {
      released.resolve()
      await completed.promise
    },
  }
}

async function allowStaleResponseToArrive(page: Page) {
  // Exercise the generation guard even when the transport cannot cancel an old response.
  await page.evaluate(() => {
    const nativeFetch = window.fetch.bind(window)
    window.fetch = (input, init) => nativeFetch(input, { ...init, signal: undefined })
  })
}

async function finishResponseRendering(page: Page, response: Response) {
  expect(await response.finished()).toBeNull()
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling')
})

test('uses database product fields for the description, fixed quantities, and independent barcode value', async ({ page }) => {
  const request = page.waitForRequest((request) => isLookup(request, '5083'))
  const response = page.waitForResponse((response) => isLookup(response.request(), '5083'))
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill(' 5083 ')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  expect((await request).method()).toBe('GET')
  expect(await (await response).json()).toMatchObject({
    partNumber: '5083',
    description: 'BRASS COUPLING 3/8',
    bulkFixedQuantity: 120,
    packageFixedQuantity: 12,
    barcodeValue: 'BILLCO-5083',
    status: 'active',
  })
  await expect(page.getByRole('textbox', { name: 'Part Number', exact: true })).toHaveValue('5083')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('BRASS COUPLING 3/8')
  await expect(page.getByRole('status').filter({ hasText: 'Product status: Active' })).toBeVisible()
  const preview = page.getByRole('region', { name: 'Label Preview', exact: true })
  await expect(preview.locator('.label-description strong')).toHaveText('BRASS COUPLING 3/8')
  await expect(preview.locator('.label-part strong')).toHaveText('5083')
  await expect(preview.locator('.barcode-value')).toHaveText('BILLCO-5083')
  await expect(preview.getByRole('img', { name: 'Code 128 barcode for BILLCO-5083' })).toBeVisible()
  const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
  await expect(quantity).toHaveValue('120')
  await expect(quantity).toHaveAttribute('readonly', '')
  await page.getByRole('radio', { name: 'Package Fixed Qty', exact: true }).check()
  await expect(quantity).toHaveValue('12')
  await expect(preview.locator('.label-quantity strong')).toHaveText('12')
  await expect(preview.locator('.barcode-value')).toHaveText('BILLCO-5083')
})

test('rejects an inactive database product without showing a label', async ({ page }) => {
  const response = page.waitForResponse((response) => isLookup(response.request(), '5090'))
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill('5090')
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).press('Enter')
  const inactiveProduct = await (await response).json()
  expect(inactiveProduct).toMatchObject({ partNumber: '5090', status: 'inactive' })
  await expect(page.getByRole('status').filter({ hasText: 'Product 5090 is inactive' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Product status: Inactive' })).toBeVisible()
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(inactiveProduct.description)
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('')
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Product label preview', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'PREVIEW', exact: true })).toBeDisabled()
})

for (const failure of ['server error', 'network failure'] as const) {
  test(`reports an unavailable lookup after a ${failure} and clears the previous product`, async ({ page }) => {
    await page.route('**/api/products?*', async (route) => {
      if (failure === 'server error') await route.fulfill({ status: 503, json: { error: 'Service unavailable' } })
      else await route.abort('failed')
    })
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Product lookup is unavailable')
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue('')
    await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('')
    await expect(page.getByLabel('Product label preview', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'PREVIEW', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled()
  })
}

test('does not restore an old product when the part number changes during a lookup', async ({ page }) => {
  await allowStaleResponseToArrive(page)
  const lookup = await holdLookup(page, '5081')
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill('5081')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await lookup.requested
  await expect(page.getByRole('button', { name: 'Searching…', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill('5082')
  const response = page.waitForResponse((response) => isLookup(response.request(), '5081'))
  await lookup.release()
  await finishResponseRendering(page, await response)
  await expect(page.getByRole('textbox', { name: 'Part Number', exact: true })).toHaveValue('5082')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Product label preview', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled()
})

test('does not restore an old product after Clear during a lookup', async ({ page }) => {
  await allowStaleResponseToArrive(page)
  const lookup = await holdLookup(page, '5081')
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill('5081')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await lookup.requested
  await page.getByRole('button', { name: 'CLEAR', exact: true }).click()
  const response = page.waitForResponse((response) => isLookup(response.request(), '5081'))
  await lookup.release()
  await finishResponseRendering(page, await response)
  for (const name of ['Part Number', 'Description', 'PO Number', 'Lot Number']) {
    await expect(page.getByRole('textbox', { name, exact: true })).toHaveValue('')
  }
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('')
  await expect(page.getByRole('radio', { name: 'Bulk Fixed Qty', exact: true })).toBeChecked()
  await expect(page.getByLabel('Product label preview', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'PREVIEW', exact: true })).toBeDisabled()
})

test('keeps the newer lookup when an older response arrives later', async ({ page }) => {
  await allowStaleResponseToArrive(page)
  const lookup = await holdLookup(page, '5081')
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill('5081')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await lookup.requested
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill('5083')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('BRASS COUPLING 3/8')
  const response = page.waitForResponse((response) => isLookup(response.request(), '5081'))
  await lookup.release()
  await finishResponseRendering(page, await response)
  await expect(page.getByRole('textbox', { name: 'Part Number', exact: true })).toHaveValue('5083')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('BRASS COUPLING 3/8')
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('120')
  await expect(page.locator('.barcode-value').first()).toHaveText('BILLCO-5083')
})

for (const mode of [
  { name: 'Package Fixed Qty', quantity: '12', height: 2, editable: false },
  { name: 'Bulk Variable Qty', quantity: '', height: 5, editable: true },
  { name: 'BCC', quantity: '', height: 2, editable: true },
]) {
  test(`applies the latest ${mode.name} selection when an in-flight lookup completes`, async ({ page }) => {
    const lookup = await holdLookup(page, '5083')
    await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill('5083')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await lookup.requested
    await expect(page.getByRole('button', { name: 'Searching…', exact: true })).toBeDisabled()
    await page.getByRole('radio', { name: mode.name, exact: true }).check()
    await lookup.release()
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue('BRASS COUPLING 3/8')
    await expect(page.getByRole('radio', { name: mode.name, exact: true })).toBeChecked()
    const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
    await expect(quantity).toHaveValue(mode.quantity)
    const preview = page.getByRole('region', { name: 'Label Preview', exact: true })
    await expect(preview).toContainText(`Label Size (3″ × ${mode.height}″)`)
    await expect(preview.locator('.barcode-group')).toHaveCount(mode.editable ? 0 : 1)
    if (mode.editable) {
      await expect(quantity).not.toHaveAttribute('readonly', '')
      await quantity.fill('37')
      await expect(preview.locator('.label-quantity strong')).toHaveText('37')
    } else {
      await expect(quantity).toHaveAttribute('readonly', '')
      await expect(preview.locator('.label-quantity strong')).toHaveText('12')
      await expect(preview.locator('.barcode-value')).toHaveText('BILLCO-5083')
    }
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled()
  })
}

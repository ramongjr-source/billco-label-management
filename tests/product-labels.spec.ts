import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('renders the reference product and a real barcode without enabling printing', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Bulk Fixed Quantity Labels' })).toBeVisible()
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Coupling')
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('500')
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveAttribute('readonly', '')
  const barcode = page.getByRole('img', { name: 'Code 128 barcode for 5080' })
  await expect(barcode).toBeVisible()
  expect(await barcode.locator('rect').count()).toBeGreaterThan(10)
  await expect(page.locator('.barcode-value').first()).toHaveText('5080')
  await expect(page.getByRole('button', { name: 'PRINT', exact: true })).toBeDisabled()
})

test('searches sample products and prevents a stale label for an unknown part', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill('5081')
  await expect(page.getByLabel('Product label preview', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Elbow')
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('250')
  await expect(page.getByRole('img', { name: 'Code 128 barcode for 5081' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill('missing')
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).press('Enter')
  await expect(page.getByRole('status')).toContainText('No sample product found')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('')
  await expect(page.getByRole('heading', { name: 'Ready for your next label' })).toBeVisible()
})

test('applies fixed quantities, variable quantities, and BCC overrides to the live preview', async ({ page }) => {
  const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
  await page.getByRole('radio', { name: 'Package Fixed Qty', exact: true }).check()
  await expect(quantity).toHaveValue('50')
  await expect(page.getByRole('heading', { name: 'Package Fixed Quantity Labels' })).toBeVisible()
  await page.getByLabel('BCC (Override Quantity)', { exact: true }).check()
  await expect(quantity).not.toHaveAttribute('readonly', '')
  await quantity.fill('72')
  await expect(page.locator('.label-quantity strong').first()).toHaveText('72')
  await page.getByLabel('BCC (Override Quantity)', { exact: true }).uncheck()
  await expect(quantity).toHaveValue('50')
  await expect(quantity).toHaveAttribute('readonly', '')
  await page.getByRole('radio', { name: 'Bulk Variable Qty', exact: true }).check()
  await quantity.fill('125')
  await expect(page.locator('.label-quantity strong').first()).toHaveText('125')
  await page.getByRole('textbox', { name: 'PO Number', exact: true }).fill('PO-2026')
  await page.getByRole('textbox', { name: 'Lot Number', exact: true }).fill('LOT-08')
  await expect(page.locator('.label-detail').first()).toContainText('PO-2026')
  await expect(page.locator('.label-detail').nth(1)).toContainText('LOT-08')
  await quantity.fill('0')
  await expect(page.getByRole('status').last()).toContainText('Enter a positive whole-number quantity')
  await expect(page.locator('.label-quantity strong').first()).toHaveText('—')
  await page.getByRole('radio', { name: 'Bulk Fixed Qty', exact: true }).check()
  await expect(quantity).toHaveValue('500')
})

test('clears all fields and allows a new lookup without PO or lot details', async ({ page }) => {
  await page.getByLabel('BCC (Override Quantity)', { exact: true }).check()
  await page.getByRole('button', { name: 'CLEAR', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Part Number', exact: true })).toBeFocused()
  for (const name of ['Part Number', 'Description', 'PO Number', 'Lot Number', 'Quantity']) {
    await expect(page.getByRole(name === 'Quantity' ? 'spinbutton' : 'textbox', { name, exact: true })).toHaveValue('')
  }
  await expect(page.getByLabel('BCC (Override Quantity)', { exact: true })).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'PREVIEW', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill(' 5082 ')
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).press('Enter')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('1/2 Brass Adapter')
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('200')
})

test('supports keyboard-accessible preview expansion and Escape dismissal', async ({ page }) => {
  await page.getByRole('button', { name: 'Expand label preview' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('img', { name: 'Code 128 barcode for 5080' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Expand label preview' })).toBeFocused()
  await page.getByRole('button', { name: 'PREVIEW', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Label Preview', exact: true })).toBeFocused()
})

test('keeps mobile controls usable and label selection synchronized with the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toBeVisible()
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Package Fixed Qty', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Package Fixed Qty', exact: true })).toBeChecked()
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('50')
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute('aria-expanded', 'false')
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasHorizontalOverflow).toBe(false)
  await page.getByRole('button', { name: 'PREVIEW', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Code 128 barcode for 5080' })).toBeInViewport()
})

test('fits the workspace at mobile, tablet, and desktop widths', async ({ page }) => {
  for (const width of [320, 390, 760, 768, 800, 1024, 1151, 1280, 1536]) {
    await page.setViewportSize({ width, height: 1024 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow, `Horizontal overflow at ${width}px`).toBe(false)
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible()
  }
})

test('keeps long PO and lot values and the barcode inside the label', async ({ page }) => {
  const poNumber = 'PURCHASE-ORDER-12345678901234567890'.slice(0, 32)
  const lotNumber = 'LOT-NUMBER-12345678901234567890123'.slice(0, 32)
  await page.getByRole('textbox', { name: 'PO Number', exact: true }).fill(poNumber)
  await page.getByRole('textbox', { name: 'Lot Number', exact: true }).fill(lotNumber)
  await expect(page.locator('.label-detail strong').first()).toHaveText(poNumber)
  await expect(page.locator('.label-detail strong').nth(1)).toHaveText(lotNumber)
  for (const width of [1536, 390]) {
    await page.setViewportSize({ width, height: 1024 })
    const label = await page.locator('.product-label').first().boundingBox()
    const barcodeValue = await page.locator('.barcode-value').first().boundingBox()
    expect(label).not.toBeNull()
    expect(barcodeValue).not.toBeNull()
    expect(barcodeValue!.y + barcodeValue!.height).toBeLessThan(label!.y + label!.height)
  }
})

test('enforces size and barcode rules for every label type and BCC override', async ({ page }) => {
  const preview = page.getByRole('region', { name: 'Label Preview', exact: true })
  const modes = [
    { name: 'Bulk Fixed Qty', height: 5, editable: false },
    { name: 'Bulk Variable Qty', height: 5, editable: true },
    { name: 'Package Fixed Qty', height: 2, editable: false },
  ]
  for (const bcc of [false, true]) {
    await page.getByLabel('BCC (Override Quantity)', { exact: true }).setChecked(bcc)
    for (const mode of modes) {
      await page.getByRole('radio', { name: mode.name, exact: true }).check()
      const editable = bcc || mode.editable
      const height = bcc ? 2 : mode.height
      await expect(preview).toContainText(`Label Size (3″ × ${height}″)`)
      const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
      if (editable) {
        await expect(quantity).not.toHaveAttribute('readonly', '')
        await quantity.fill('75')
        await expect(preview.locator('.label-quantity strong')).toHaveText('75')
        await expect(preview.locator('.barcode-group')).toHaveCount(0)
        await expect(preview).toContainText('Editable quantity · No barcode')
      } else {
        await expect(quantity).toHaveAttribute('readonly', '')
        await expect(preview.getByRole('img', { name: 'Code 128 barcode for 5080' })).toBeVisible()
      }
      const bounds = await preview.locator('.product-label').boundingBox()
      expect(bounds!.width / bounds!.height).toBeCloseTo(3 / height, 2)
      await page.getByRole('button', { name: 'Expand label preview' }).click()
      await expect(page.getByRole('dialog').locator('.barcode-group')).toHaveCount(editable ? 0 : 1)
      await page.keyboard.press('Escape')
    }
  }
})

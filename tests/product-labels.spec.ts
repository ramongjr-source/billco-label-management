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

test('applies fixed and editable quantities to the live preview', async ({ page }) => {
  const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
  await page.getByRole('radio', { name: 'Package Fixed Qty', exact: true }).check()
  await expect(quantity).toHaveValue('50')
  await expect(page.getByRole('heading', { name: 'Package Fixed Quantity Labels' })).toBeVisible()
  await page.getByRole('radio', { name: 'BCC', exact: true }).check()
  await expect(quantity).not.toHaveAttribute('readonly', '')
  await expect(quantity).toHaveValue('')
  await quantity.fill('72')
  await expect(page.locator('.label-quantity strong').first()).toHaveText('72')
  await page.getByRole('radio', { name: 'Package Fixed Qty', exact: true }).check()
  await expect(quantity).toHaveValue('50')
  await expect(quantity).toHaveAttribute('readonly', '')
  await page.getByRole('radio', { name: 'Bulk Variable Qty', exact: true }).check()
  await expect(quantity).toHaveValue('')
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
  await page.getByRole('radio', { name: 'BCC', exact: true }).check()
  await page.getByRole('button', { name: 'CLEAR', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Part Number', exact: true })).toBeFocused()
  for (const name of ['Part Number', 'Description', 'PO Number', 'Lot Number', 'Quantity']) {
    await expect(page.getByRole(name === 'Quantity' ? 'spinbutton' : 'textbox', { name, exact: true })).toHaveValue('')
  }
  await expect(page.getByRole('radio', { name: 'BCC', exact: true })).not.toBeChecked()
  await expect(page.getByRole('radio', { name: 'Bulk Fixed Qty', exact: true })).toBeChecked()
  await expect(page.getByRole('heading', { name: 'Bulk Fixed Quantity Labels' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'PREVIEW', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill(' 5082 ')
  await page.getByRole('textbox', { name: 'Part Number', exact: true }).press('Enter')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('1/2 Brass Adapter')
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('200')
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveAttribute('readonly', '')
  await expect(page.getByRole('img', { name: 'Code 128 barcode for 5082' })).toBeVisible()
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
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'BCC', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'BCC', exact: true })).toBeChecked()
  await expect(page.getByRole('radio', { name: 'Package Fixed Qty', exact: true })).not.toBeChecked()
  await expect(page.getByRole('heading', { name: 'BCC Labels', exact: true })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).not.toHaveAttribute('readonly', '')
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('')
  await expect(page.getByRole('region', { name: 'Label Preview', exact: true })).toContainText('Label Size (3″ × 2″)')
  await expect(page.locator('.barcode-group')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute('aria-expanded', 'false')
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

test('enforces size and barcode rules for all four standalone label types', async ({ page }) => {
  const preview = page.getByRole('region', { name: 'Label Preview', exact: true })
  const modes = [
    { name: 'Bulk Fixed Qty', height: 5, editable: false, quantity: '500' },
    { name: 'Bulk Variable Qty', height: 5, editable: true },
    { name: 'Package Fixed Qty', height: 2, editable: false, quantity: '50' },
    { name: 'BCC', height: 2, editable: true },
  ]
  for (const mode of modes) {
    await page.getByRole('radio', { name: mode.name, exact: true }).check()
    await expect(page.locator('input[name="label-type"]:checked')).toHaveCount(1)
    await expect(preview).toContainText(`Label Size (3″ × ${mode.height}″)`)
    const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
    if (mode.editable) {
      await expect(quantity).not.toHaveAttribute('readonly', '')
      await expect(quantity).toHaveValue('')
      await quantity.fill('75')
      await expect(preview.locator('.label-quantity strong')).toHaveText('75')
      await expect(preview.locator('.barcode-group')).toHaveCount(0)
      await expect(preview).toContainText('Editable quantity · No barcode')
    } else {
      await expect(quantity).toHaveAttribute('readonly', '')
      await expect(quantity).toHaveValue(mode.quantity!)
      await expect(preview.getByRole('img', { name: 'Code 128 barcode for 5080' })).toBeVisible()
    }
    const bounds = await preview.locator('.product-label').boundingBox()
    expect(bounds!.width / bounds!.height).toBeCloseTo(3 / mode.height, 2)
    await page.getByRole('button', { name: 'Expand label preview' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('.barcode-group')).toHaveCount(mode.editable ? 0 : 1)
    await expect(dialog.locator('.label-quantity strong')).toHaveText(mode.editable ? '75' : mode.quantity!)
    if (!mode.editable) await expect(dialog.getByRole('img', { name: 'Code 128 barcode for 5080' })).toBeVisible()
    const expandedBounds = await dialog.locator('.product-label').boundingBox()
    expect(expandedBounds!.width / expandedBounds!.height).toBeCloseTo(3 / mode.height, 2)
    await page.keyboard.press('Escape')
  }
})

test('selects BCC exclusively and synchronizes its standalone sidebar entry', async ({ page }) => {
  await expect(page.getByRole('radio')).toHaveCount(4)
  await expect(page.getByRole('checkbox', { name: /BCC/ })).toHaveCount(0)
  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  await navigation.getByRole('button', { name: 'BCC', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'BCC', exact: true })).toBeChecked()
  for (const name of ['Bulk Fixed Qty', 'Bulk Variable Qty', 'Package Fixed Qty']) {
    await expect(page.getByRole('radio', { name, exact: true })).not.toBeChecked()
    await expect(navigation.getByRole('button', { name, exact: true })).not.toHaveAttribute('aria-current', 'page')
  }
  await expect(navigation.getByRole('button', { name: 'BCC', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'BCC Labels', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('BCC')
  await page.getByRole('spinbutton', { name: 'Quantity', exact: true }).fill('33')
  await navigation.getByRole('button', { name: 'BCC', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Quantity', exact: true })).toHaveValue('33')
  await page.getByRole('radio', { name: 'Bulk Fixed Qty', exact: true }).check()
  await expect(navigation.getByRole('button', { name: 'Bulk Fixed Qty', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(navigation.getByRole('button', { name: 'BCC', exact: true })).not.toHaveAttribute('aria-current', 'page')
})

test('restores each label type after leaving BCC without retaining its compact layout', async ({ page }) => {
  const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
  const preview = page.getByRole('region', { name: 'Label Preview', exact: true })
  for (const mode of [
    { name: 'Bulk Fixed Qty', height: 5, quantity: '500', editable: false },
    { name: 'Bulk Variable Qty', height: 5, quantity: '', editable: true },
    { name: 'Package Fixed Qty', height: 2, quantity: '50', editable: false },
  ]) {
    await page.getByRole('radio', { name: 'BCC', exact: true }).check()
    await expect(quantity).toHaveValue('')
    await quantity.fill('72')
    await page.getByRole('radio', { name: mode.name, exact: true }).check()
    await expect(page.getByRole('radio', { name: 'BCC', exact: true })).not.toBeChecked()
    await expect(quantity).toHaveValue(mode.quantity)
    if (mode.editable) await expect(quantity).not.toHaveAttribute('readonly', '')
    else await expect(quantity).toHaveAttribute('readonly', '')
    await expect(preview).toContainText(`Label Size (3″ × ${mode.height}″)`)
    await expect(preview.locator('.barcode-group')).toHaveCount(mode.editable ? 0 : 1)
    if (mode.editable) {
      await expect(preview.locator('.label-quantity strong')).toHaveText('—')
      await expect(page.getByRole('status').last()).toContainText('Enter a positive whole-number quantity')
    }
  }
})

test('requires operator quantity after lookup in either editable label type', async ({ page }) => {
  const quantity = page.getByRole('spinbutton', { name: 'Quantity', exact: true })
  const preview = page.getByRole('region', { name: 'Label Preview', exact: true })
  for (const mode of [
    { name: 'BCC', heading: 'BCC Labels', height: 2 },
    { name: 'Bulk Variable Qty', heading: 'Bulk Variable Quantity Labels', height: 5 },
  ]) {
    await page.getByRole('radio', { name: mode.name, exact: true }).check()
    await expect(quantity).toHaveValue('')
    await quantity.fill('72')
    await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill('5081')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue('3/8 Brass Elbow')
    await expect(page.getByRole('radio', { name: mode.name, exact: true })).toBeChecked()
    await expect(page.getByRole('heading', { name: mode.heading, exact: true })).toBeVisible()
    await expect(quantity).not.toHaveAttribute('readonly', '')
    await expect(quantity).toHaveValue('')
    await expect(preview.locator('.label-quantity strong')).toHaveText('—')
    await quantity.fill('64')
    await expect(preview.locator('.label-quantity strong')).toHaveText('64')
    await expect(preview).toContainText('5081')
    await expect(preview).toContainText(`Label Size (3″ × ${mode.height}″)`)
    await expect(preview.locator('.barcode-group')).toHaveCount(0)
  }
})

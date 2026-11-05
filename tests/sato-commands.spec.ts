import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import ExcelJS from 'exceljs'
import { randomUUID } from 'node:crypto'

test('admin command preview validates both stocks, preserves dimensions, warns on overflow and persists history', async ({ page, request }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const artifactDirectory = process.env.SATO_ARTIFACT_DIR
  if (artifactDirectory) mkdirSync(artifactDirectory, { recursive: true })
  const suffix = randomUUID().slice(0, 8)
  const descriptions = ['1/2" EMT Compression Coupling', '1-1/4" Rigid Conduit Body with cover and 3/4" threaded openings', '4" x 4" x 1/4" Angle '.repeat(20).trim()]
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('BillcoMaster')
  sheet.addRow(['BillcoPart#', 'Description', 'StdPackQty', 'BulkQty', 'ProductBarcode', 'BulkBarcode'])
  descriptions.forEach((description, index) => sheet.addRow([`S39-${suffix}-${index}`, description, 25, 500, '00001234', 'BULK-1234']))
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const imported = await request.post('/api/products/import', { multipart: { file: { name: 'sato.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer } } })
  expect(imported.status()).toBe(200)
  await page.addInitScript(() => { window.print = () => { throw new Error('Physical printing is forbidden') } })
  await page.goto('/')
  await expect(page.getByLabel('Description', { exact: true })).not.toHaveValue('')
  for (let index = 0; index < descriptions.length; index++) {
    const part = `S39-${suffix}-${index}`
    await page.getByRole('textbox', { name: 'Part Number', exact: true }).fill(part)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue(descriptions[index])
    for (const mode of ['Bulk Fixed Qty', 'Package Fixed Qty']) {
      await page.getByRole('radio', { name: mode, exact: true }).check()
      await page.getByRole('button', { name: 'SATO commands · Admin preview', exact: true }).click()
      const modal = page.getByRole('dialog', { name: 'SATO command preview' })
      const generated = page.waitForResponse(response => response.url().endsWith('/api/sato-commands') && response.request().method() === 'POST')
      await modal.getByRole('button', { name: 'Generate SATO commands', exact: true }).click()
      const command = await (await generated).json()
      await expect(modal.locator('.sato-description')).toHaveText(descriptions[index])
      if (index === 2) {
        await expect(modal.getByRole('status')).toContainText('Validation failed')
        await expect(modal.locator('.sato-issues')).toContainText('description')
        await expect(modal.getByLabel('SATO command output')).toContainText('Payload withheld')
      } else {
        await expect(modal.getByRole('status')).toContainText('validation passed')
        await expect(modal.getByLabel('SATO command output')).toContainText(descriptions[index].slice(0, 33))
        await expect(modal.getByLabel('Generated SATO label layout')).toBeVisible()
        const position = await modal.locator('[data-sato-field="barcode"]').evaluate(group => {
          const bounds = group.getBoundingClientRect()
          const label = group.closest('svg')!.getBoundingClientRect()
          return { top: (bounds.top - label.top) / label.height, bottom: (bounds.bottom - label.top) / label.height }
        })
        expect(position.top).toBeGreaterThan(0.7)
        expect(position.bottom).toBeLessThan(0.91)
      }
      if (artifactDirectory) {
        const name = `${index === 0 ? 'short' : index === 1 ? 'medium' : 'long'}-${mode.startsWith('Bulk') ? '3x5' : '3x2'}`
        await modal.screenshot({ path: join(artifactDirectory, `${name}.png`) })
        writeFileSync(join(artifactDirectory, `${name}.json`), JSON.stringify(command, null, 2))
        if (command.payload) {
          writeFileSync(join(artifactDirectory, `${name}.sbpl`), command.payload, 'ascii')
          writeFileSync(join(artifactDirectory, `${name}.txt`), command.payload.replaceAll('\u001b', '\n<ESC>').trimStart())
        }
      }
      await modal.getByRole('button', { name: 'Close', exact: true }).click()
    }
  }
  const jobs = (await (await request.get('/api/print-jobs')).json()).jobs as { label: { product: { partNumber: string } } }[]
  expect(jobs.filter(job => job.label.product.partNumber.startsWith(`S39-${suffix}`))).toHaveLength(0)
  await page.reload()
  await page.getByRole('button', { name: 'SATO commands · Admin preview', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'SATO command preview' })
  await modal.getByText(/Command history/).click()
  await expect(modal.locator('.sato-history li').filter({ hasText: `S39-${suffix}` })).toHaveCount(6)
  await modal.locator('.sato-history li').filter({ hasText: `S39-${suffix}-0 · package-fixed` }).getByRole('button').click()
  await expect(modal.locator('.sato-description')).toHaveText(descriptions[0])
  await expect(modal.getByText('Saved snapshot:', { exact: false })).toBeVisible()
})

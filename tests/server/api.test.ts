import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { migrateDatabase, openProductDatabase, seedProducts } from '../../database/index.js'
import { createApp } from '../../server/app.js'

async function startApi(t: TestContext, staticDirectory?: string) {
  const db = openProductDatabase(':memory:')
  migrateDatabase(db)
  seedProducts(db)
  const errors: unknown[] = []
  const server = createApp(db, { staticDirectory, onError: (error) => errors.push(error) }).listen(0, '127.0.0.1')
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    db.close()
  })
  await once(server, 'listening')
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { db, errors, url }
}

test('HTTP lookup returns database quantities, a single description, and the independent barcode value', async (t) => {
  const { url } = await startApi(t)
  const response = await fetch(`${url}/api/products?partNumber=5083`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-powered-by'), null)
  assert.deepEqual(await response.json(), {
    partNumber: '5083',
    description: 'BRASS COUPLING 3/8',
    bulkFixedQuantity: 120,
    packageFixedQuantity: 12,
    productBarcode: 'BILLCO-5083',
    bulkBarcode: 'BILLCO-BULK-5083',
    status: 'active',
  })
})

test('HTTP lookup trims input but preserves exact case and leading zeros', async (t) => {
  const { db, url } = await startApi(t)
  db.prepare(`
    INSERT INTO products
      (part_number, description, bulk_fixed_quantity, package_fixed_quantity, product_barcode, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('000Case', 'Leading zeros', 8, 2, 'CASE-CODE', 'active')
  const response = await fetch(`${url}/api/products?partNumber=${encodeURIComponent(' 000Case ')}`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).partNumber, '000Case')
  assert.equal((await fetch(`${url}/api/products?partNumber=000case`)).status, 404)
  assert.equal((await fetch(`${url}/api/products?partNumber=Case`)).status, 404)

  const unicodePart = '😀'.repeat(64)
  db.prepare(`
    INSERT INTO products
      (part_number, description, bulk_fixed_quantity, package_fixed_quantity, product_barcode, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(unicodePart, 'Unicode textual part number', 8, 2, 'UNICODE-CODE', 'active')
  assert.equal((await fetch(`${url}/api/products?partNumber=${encodeURIComponent(unicodePart)}`)).status, 200)
  assert.equal((await fetch(`${url}/api/products?partNumber=${encodeURIComponent(`${unicodePart}😀`)}`)).status, 400)
})

test('HTTP lookup returns inactive status so the UI can explicitly block label generation', async (t) => {
  const { url } = await startApi(t)
  const response = await fetch(`${url}/api/products?partNumber=5090`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).status, 'inactive')
})

test('missing, blank, malformed, repeated, and overlong part numbers return HTTP 400', async (t) => {
  const { url } = await startApi(t)
  const invalid = [
    '/api/products',
    '/api/products?partNumber=',
    '/api/products?partNumber=%20%09',
    '/api/products?partNumber=5080&partNumber=5081',
    '/api/products?partNumber[other]=5080',
    '/api/products?partNumber=%E0%A4%A',
    '/api/products?partNumber=%',
    '/api/products?partNumber=X?%',
    '/api/products?partNumber=50%0080',
    `/api/products?partNumber=${'P'.repeat(65)}`,
  ]
  for (const path of invalid) {
    const response = await fetch(`${url}${path}`)
    assert.equal(response.status, 400, path)
    assert.equal(typeof (await response.json()).error, 'string')
  }
})

test('unknown products and SQL-like input return HTTP 404 without matching other products', async (t) => {
  const { url } = await startApi(t)
  for (const partNumber of ['unknown', "5080' OR 1=1 --"]) {
    const response = await fetch(`${url}/api/products?partNumber=${encodeURIComponent(partNumber)}`)
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'Product not found.' })
  }
})

test('health verifies a database read and database failures return generic errors', async (t) => {
  const { db, errors, url } = await startApi(t)
  const healthy = await fetch(`${url}/api/health`)
  assert.equal(healthy.status, 200)
  assert.deepEqual(await healthy.json(), { status: 'ok' })

  db.exec('DROP TABLE products')
  const productResponse = await fetch(`${url}/api/products?partNumber=5080`)
  assert.equal(productResponse.status, 500)
  assert.deepEqual(await productResponse.json(), { error: 'Unable to load the product. Please try again.' })
  const unhealthy = await fetch(`${url}/api/health`)
  assert.equal(unhealthy.status, 503)
  assert.deepEqual(await unhealthy.json(), { status: 'unavailable' })
  assert.equal(errors.length, 2)
})

test('production static assets and SPA routes are served without swallowing unknown API routes', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'billco-static-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  mkdirSync(join(directory, 'assets'))
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Billco</title>')
  writeFileSync(join(directory, 'assets', 'app.js'), 'export const billco = true;')
  const { url } = await startApi(t, directory)

  const page = await fetch(`${url}/product-labels`, { headers: { Accept: 'text/html' } })
  assert.equal(page.status, 200)
  assert.match(await page.text(), /<title>Billco<\/title>/)
  const asset = await fetch(`${url}/assets/app.js`)
  assert.equal(asset.status, 200)
  assert.equal(await asset.text(), 'export const billco = true;')
  assert.equal((await fetch(`${url}/assets/missing.js`)).status, 404)

  const unknownApi = await fetch(`${url}/api/missing`)
  assert.equal(unknownApi.status, 404)
  assert.match(unknownApi.headers.get('content-type') ?? '', /application\/json/)
  assert.deepEqual(await unknownApi.json(), { error: 'API route not found.' })
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { openProductDatabase, migrateDatabase, seedDevelopmentProducts, seedProducts, searchProducts } from '../../database/index.js'
import { createApp } from '../../server/app.js'

test('seeded predictive search matches literal partial parts/descriptions, ranks and limits results', async (t) => {
  const db = openProductDatabase(':memory:')
  migrateDatabase(db); seedDevelopmentProducts(db)
  t.after(() => db.close())
  const parts = (q: string) => searchProducts(db, q).map(p => p.partNumber)
  assert.deepEqual(parts(' PA '), parts('pa'))
  assert.deepEqual(parts('Pa'), parts('pa'))
  assert.ok(parts('AB.025').includes('AB.025X013'))
  assert.ok(searchProducts(db, 'bush').some(p => p.description.includes('BUSHINGS')))
  assert.ok(searchProducts(db, 'coupling').some(p => p.description.includes('COUPLINGS')))
  assert.equal(parts('').length, 0)
  assert.equal(parts('%').length, 0)
  assert.equal(parts('a').length, 10)
  const results = searchProducts(db, 'pa')
  const rank = (p: typeof results[number]) => p.partNumber.toLowerCase().startsWith('pa') ? 0 : p.partNumber.toLowerCase().includes('pa') ? 1 : 2
  assert.deepEqual(results.map(rank), results.map(rank).sort())
  seedProducts(db, ['A-ZZZ', 'B-DESC', 'ZZZ-PREFIX'].map(partNumber => ({
    partNumber, description: 'ZZZ description', bulkFixedQuantity: 1, packageFixedQuantity: 1,
    productBarcode: '1', bulkBarcode: '2', status: 'active' as const,
  })))
  assert.deepEqual(parts('zzz'), ['ZZZ-PREFIX', 'A-ZZZ', 'B-DESC'])
  const start = performance.now()
  for (let i = 0; i < 100; i++) searchProducts(db, 'coupling')
  console.log(`Seed search average: ${(performance.now() - start) / 100}ms`)
  const server = createApp(db).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/products/search`
  assert.deepEqual(await (await fetch(`${url}?q=PA`)).json(), results)
  for (const query of ['', '?q=a&q=b', '?q=%', '?q=%00', `?q=${'a'.repeat(257)}`]) {
    assert.equal((await fetch(url + query)).status, 400)
  }
  assert.deepEqual(await (await fetch(`${url}?q=%20`)).json(), [])
})

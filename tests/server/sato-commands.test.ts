import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import { findProductByPartNumber, migrateDatabase, openProductDatabase, seedProducts } from '../../database/index.js'
import { createApp } from '../../server/app.js'
import { generateSato, SatoCommandService, validateSatoCommands } from '../../server/satoCommandService.js'
import type { SatoRequest } from '../../shared/sato.js'
import type { PrintJob } from '../../shared/printing.js'

function setup(t: TestContext, filename = ':memory:') {
  const db = openProductDatabase(filename); migrateDatabase(db); seedProducts(db)
  t.after(() => db.close())
  const service = new SatoCommandService(db)
  const request: SatoRequest = { requestId: randomUUID(), product: findProductByPartNumber(db, '5080')!, labelType: 'bulk-fixed', labelQuantity: 500, printQuantity: 25, poNumber: 'PO-39', lotNumber: 'LOT-39' }
  return { db, service, request }
}

for (const description of ['Coupling', '1/2" EMT Compression Coupling', '3/4" EMT Compression Coupling', '1-1/4" Rigid Conduit Body', '3" x 10\' Aluminum Tube', '4" x 4" x 1/4" Angle', '  3/4"  EMT Compression Coupling  ', 'Long description 1-1/4" Rigid Conduit Body with factory supplied cover and threaded hubs']) {
  for (const [labelType, labelQuantity] of [['bulk-fixed', 500], ['package-fixed', 50], ['bulk-variable', 72], ['bcc', 18]] as const) {
    test(`preserves exact description ${JSON.stringify(description)} on ${labelType}`, t => {
      const { db, service, request } = setup(t)
      db.prepare('UPDATE products SET description = ? WHERE part_number = ?').run(description, request.product.partNumber)
      const product = findProductByPartNumber(db, request.product.partNumber)!
      const result = service.generate({ ...request, product, labelType, labelQuantity }).command
      assert.equal(result.label.product.description, description)
      assert.equal(result.elements.filter(element => element.field === 'description').map(element => element.value).join(''), description)
      assert.equal(result.valid, true, JSON.stringify(result.issues))
      assert.equal(result.heightDots, labelType === 'package-fixed' || labelType === 'bcc' ? 406 : 1015)
      assert.ok(result.payload?.startsWith('\x1bA\x1bA1V'))
      assert.ok(result.payload?.endsWith('\x1bQ000025\x1bZ'))
      assert.equal(result.payload?.includes('\n'), false)
      const barcode = result.elements.find(element => element.kind === 'barcode')
      assert.equal(barcode?.value, result.elements.find(element => element.field === 'barcodeText')?.value)
      assert.equal(barcode !== undefined, labelType.endsWith('fixed'))
      assert.equal(db.prepare('SELECT count(*) AS n FROM print_jobs').get()?.n, 0)
      assert.equal(db.prepare('SELECT count(*) AS n FROM printer_connection_history').get()?.n, 0)
    })
  }
}

test('long descriptions and unrenderable fields fail visibly without losing source text on either stock', t => {
  const { db, service, request } = setup(t)
  for (const description of ['1/2" x 3/4" Coupling '.repeat(20), 'Coupling \x1bQ999999', '3/4" Coupling – special']) {
    db.prepare('UPDATE products SET description = ? WHERE part_number = ?').run(description, request.product.partNumber)
    for (const [labelType, labelQuantity] of [['bulk-fixed', 500], ['package-fixed', 50]] as const) {
      const result = service.generate({ ...request, requestId: randomUUID(), product: findProductByPartNumber(db, request.product.partNumber), labelType, labelQuantity }).command
      assert.equal(result.valid, false); assert.equal(result.payload, null)
      assert.equal(result.label.product.description, description)
      assert.ok(result.issues.some(issue => issue.field === 'description'))
    }
  }
})

test('barcode bytes, leading zeros and spaces match HRI; ambiguous, oversized and unsupported values fail', t => {
  const { db, service, request } = setup(t)
  for (const barcode of ['00001234', ' ABC-123 ', 'x'.repeat(30), '>H123']) {
    db.prepare('UPDATE products SET bulk_barcode = ? WHERE part_number = ?').run(barcode, request.product.partNumber)
    const result = service.generate({ ...request, requestId: randomUUID(), product: findProductByPartNumber(db, request.product.partNumber) }).command
    if (['00001234', ' ABC-123 '].includes(barcode)) {
      assert.equal(result.valid, true); assert.ok(result.payload?.includes(`>H${barcode}\x1b`)); assert.ok(result.payload?.includes(`XS${barcode}\x1b`))
    } else { assert.equal(result.payload, null); assert.ok(result.issues.some(issue => issue.field === 'barcode')) }
  }
})

test('serialized validator rejects altered barcode, text, copies, framing, coordinates and injected commands', t => {
  const { service, request } = setup(t)
  const result = service.generate(request).command
  const payload = result.payload!
  assert.deepEqual(validateSatoCommands(payload, result.elements, result.heightDots, 25), [])
  for (const changed of [payload.replace('>H5080', '>H5081'), payload.replace('XS5080', 'XS5081'), payload.replace('Q000025', 'Q000026'), payload.slice(1), payload.replace('H0024', 'H9999'), payload + '\x1bQ000001']) {
    assert.ok(validateSatoCommands(changed, result.elements, result.heightDots, 25).length)
  }
})

test('rejects stale/master overrides, missing fields, invalid types/quantities and fixed data', t => {
  const { db, service, request } = setup(t)
  for (const invalid of [null, [], { ...request, product: null }, ...[
    { printQuantity: 0 }, { printQuantity: 1000000 }, { printQuantity: 1.5 }, { labelQuantity: 1 },
    { labelType: '3x9' }, { poNumber: '' }, { lotNumber: '' }, { lotNumber: '\x1bZ' },
    { product: { ...request.product, description: 'Changed' } }, { product: { ...request.product, partNumber: 'missing' } },
  ].map(patch => ({ ...request, ...patch }))]) assert.throws(() => service.generate(invalid))
  db.prepare("UPDATE products SET status = 'inactive' WHERE part_number = '5080'").run()
  assert.throws(() => service.generate({ ...request, product: findProductByPartNumber(db, '5080') }), /active product/)
  assert.equal(service.listHistory().commands.length, 0)
})

test('history retries, rollback, snapshots and pagination persist without modifying jobs, media or connections', t => {
  const directory = mkdtempSync(join(tmpdir(), 'billco-sato-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, 'labels.sqlite')
  const { db, service, request } = setup(t, filename)
  const first = service.generate(request)
  assert.deepEqual(service.generate(request), { ...first, created: false })
  assert.throws(() => service.generate({ ...request, printQuantity: 100 }), /already used/)
  db.exec("CREATE TRIGGER fail_command BEFORE INSERT ON sato_commands BEGIN SELECT RAISE(ABORT, 'history failure'); END")
  assert.throws(() => service.generate({ ...request, requestId: randomUUID() }), /history failure/)
  assert.equal(service.listHistory().commands.length, 1)
  db.exec('DROP TRIGGER fail_command')
  for (let index = 0; index < 26; index++) service.generate({ ...request, requestId: randomUUID() })
  const page = service.listHistory()
  assert.equal(page.commands.length, 25); assert.ok(page.nextBefore)
  const reopened = openProductDatabase(filename)
  try {
    assert.equal(migrateDatabase(reopened), 0)
    const rest = new SatoCommandService(reopened).listHistory(page.nextBefore!)
    assert.equal(rest.commands.length, 2); assert.equal(rest.nextBefore, null)
    assert.ok(rest.commands.every(item => !page.commands.some(other => other.id === item.id)))
  } finally { reopened.close() }
  db.prepare("UPDATE products SET description = 'Changed' WHERE part_number = '5080'").run()
  assert.deepEqual(service.generate(request), { ...first, created: false })
  assert.throws(() => service.generate({ ...request, requestId: randomUUID() }), /changed/)
  for (const table of ['print_jobs', 'print_job_events', 'printer_connection_history', 'printer_media_changes']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0)
})

test('migration 007 upgrades 006 without replacing stored printers, media, jobs or history', t => {
  const db = openProductDatabase(':memory:'); t.after(() => db.close())
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT')
  for (const [index, name] of ['001-create-products.sql', '002-separate-barcodes.sql', '003-case-insensitive-parts.sql', '004-print-foundation.sql', '005-printer-media.sql', '006-printer-connectivity.sql'].entries()) {
    db.exec(readFileSync(new URL(`../../database/migrations/${name}`, import.meta.url), 'utf8'))
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(index + 1, name)
  }
  const before = db.prepare('SELECT * FROM printers ORDER BY id').all()
  assert.equal(migrateDatabase(db), 1); assert.equal(migrateDatabase(db), 0)
  assert.deepEqual(db.prepare('SELECT * FROM printers ORDER BY id').all(), before)
  assert.equal(new SatoCommandService(db).listHistory().commands.length, 0)
})

test('HTTP generation/history never invoke an injected connection probe or record a print job', async t => {
  const { db, request } = setup(t)
  let probes = 0
  const server = createApp(db, { connectionProbe: async () => { probes++; throw new Error('unexpected network') } }).listen(0, '127.0.0.1')
  await once(server, 'listening'); t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sato-commands`
  const post = (data: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  const response = await post(request)
  assert.equal(response.status, 201); assert.equal((await response.json()).valid, true)
  assert.equal((await post(request)).status, 200)
  assert.equal((await post({ ...request, printQuantity: 2 })).status, 409)
  assert.equal((await post({ ...request, requestId: randomUUID(), lotNumber: '' })).status, 400)
  assert.equal((await (await fetch(url)).json()).commands.length, 1)
  for (const cursor of ['0', 'invalid', '1.5', '1&before=2']) assert.equal((await fetch(`${url}?before=${cursor}`)).status, 400)
  assert.equal(probes, 0)
  assert.equal(db.prepare('SELECT count(*) AS n FROM print_jobs').get()?.n, 0)
})

test('layout validator detects field bounds and never substitutes a truncated identifier', t => {
  const { request } = setup(t)
  const label: PrintJob['label'] = { templateVersion: 1, type: 'package-fixed', width: 3, height: 2, product: { ...request.product, partNumber: 'P'.repeat(64) }, quantity: 50, barcode: '0001', poNumber: '', lotNumber: 'LOT' }
  const result = generateSato(label, 1)
  assert.equal(result.payload, null)
  assert.ok(result.issues.some(issue => issue.field === 'partNumber' && issue.code === 'LABEL_BOUNDS'))
  assert.equal(result.elements.find(element => element.field === 'partNumber')?.value, label.product.partNumber)
})

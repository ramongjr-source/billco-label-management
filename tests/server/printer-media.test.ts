import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { findProductByPartNumber, migrateDatabase, openProductDatabase, seedProducts } from '../../database/index.js'
import { createApp } from '../../server/app.js'
import { changePrinterMedia, createPrinter, listPrinterMediaHistory, PrintValidationError, RecordingPrintService, updatePrinter } from '../../server/printService.js'
import type { PrintRequest } from '../../shared/printing.js'

function setup(t: TestContext, filename = ':memory:') {
  const db = openProductDatabase(filename)
  migrateDatabase(db); seedProducts(db)
  t.after(() => db.close())
  const service = new RecordingPrintService(db)
  const request: PrintRequest = { requestId: randomUUID(), printerId: 'specialty-metals', product: findProductByPartNumber(db, '5080')!, labelType: 'bulk-fixed', labelQuantity: 500, printQuantity: 25, lotNumber: 'LOT-35', poNumber: 'PO-35', requestedMedia: 'Brass' }
  return { db, service, request }
}
const change = (currentMedia: string | null, expectedCurrentMedia: string | null, user = 'Operator 35') => ({ requestId: randomUUID(), currentMedia, expectedCurrentMedia, user })

test('registry defaults are editable devices, begin with unknown media, and are never reapplied', t => {
  const { db, service } = setup(t)
  const registry = service.listPrinters()
  assert.equal(registry.length, 4)
  for (const [id, name, ip, media] of [
    ['specialty-metals', 'Specialty Metals Printer', '192.168.1.190', ['Aluminum', 'Stainless', 'Brass']],
    ['bulk', 'Bulk Printer', '192.168.1.191', ['Black 3x5']],
    ['package', 'Package Printer', '192.168.1.192', ['Black 3x2']],
    ['galvanized', 'Galvanized Printer', '192.168.1.193', ['Magenta']],
  ] as const) {
    const printer = registry.find(printer => printer.id === id)!
    assert.equal(printer.name, name); assert.equal(printer.ipAddress, ip); assert.deepEqual(printer.supportedMedia, media)
    assert.equal(printer.currentMedia, null); assert.equal(printer.lastMediaChangeAt, null); assert.equal(printer.lastMediaChangeUser, null)
    assert.equal(printer.mediaValidationEnabled, id === 'specialty-metals')
    assert.ok(!('labelType' in printer))
  }
  updatePrinter(db, 'specialty-metals', { name: 'Flexible station', ipAddress: '192.168.1.200', status: 'inactive', description: 'Changed assignment', supportedMedia: ['Green', 'Aluminum'], mediaValidationEnabled: false })
  changePrinterMedia(db, 'specialty-metals', change('Custom ribbon / stock', null))
  assert.equal(migrateDatabase(db), 0)
  const maintained = service.listPrinters().find(printer => printer.id === 'specialty-metals')!
  assert.equal(maintained.name, 'Flexible station'); assert.equal(maintained.ipAddress, '192.168.1.200'); assert.equal(maintained.status, 'inactive')
  assert.equal(maintained.currentMedia, 'Custom ribbon / stock'); assert.deepEqual(maintained.supportedMedia, ['Green', 'Aluminum'])
  updatePrinter(db, 'specialty-metals', { supportedMedia: ['White'] })
  assert.equal(service.listPrinters().find(printer => printer.id === maintained.id)?.currentMedia, 'Custom ribbon / stock')
})

test('registry validation accepts old creation requests and syntactically checks configuration without touching the network', t => {
  const { db } = setup(t)
  const printer = createPrinter(db, { name: 'Legacy client', model: 'Generic' })
  assert.equal(printer.ipAddress, ''); assert.deepEqual(printer.supportedMedia, []); assert.equal(printer.mediaValidationEnabled, false)
  assert.equal(updatePrinter(db, printer.id, { ipAddress: '2001:db8::1' }).ipAddress, '2001:db8::1')
  for (const invalid of [
    { ipAddress: '192.168.1.999' }, { ipAddress: 'http://192.168.1.190' }, { ipAddress: 'printer.local' },
    { supportedMedia: ['Brass', 'brass'] }, { supportedMedia: [''] }, { supportedMedia: 'Brass' },
    { mediaValidationEnabled: true, supportedMedia: [] }, { mediaValidationEnabled: 'true' },
    { name: '' }, { description: 'x'.repeat(513) }, { status: 'disabled' }, { status: null },
    { currentMedia: 'Brass' }, { currentMedia: null }, { lastMediaChangeUser: 'Spoofed' },
  ]) assert.throws(() => updatePrinter(db, printer.id, invalid), PrintValidationError)
})

test('metal mismatch blocks job creation with server-owned facts and requires an explicit requested material', t => {
  const { db, service, request } = setup(t)
  changePrinterMedia(db, 'specialty-metals', change('Aluminum', null))
  assert.throws(() => service.recordJob(request), (error: unknown) => {
    assert.ok(error instanceof PrintValidationError)
    assert.equal(error.status, 409); assert.equal(error.code, 'MEDIA_MISMATCH')
    assert.deepEqual(error.details, { printerId: 'specialty-metals', printerName: 'Specialty Metals Printer', requestedMedia: 'Brass', currentMedia: 'Aluminum' })
    return true
  })
  for (const requestedMedia of [undefined, '', 'Unsupported']) assert.throws(() => service.recordJob({ ...request, requestedMedia }), /requested material/)
  assert.equal(service.listJobs().jobs.length, 0)
  assert.equal(db.prepare('SELECT count(*) AS count FROM print_job_events').get()?.count, 0)
  // Dismissing a mismatch requires no API mutation: stock and audit remain unchanged.
  assert.equal(service.listPrinters().find(printer => printer.id === 'specialty-metals')?.currentMedia, 'Aluminum')
  assert.equal(listPrinterMediaHistory(db, 'specialty-metals').changes.length, 1)
  assert.throws(() => service.recordJob({ ...request, product: { ...request.product, description: 'Changed preview' } }), /Product information changed/)
})

test('audited media confirmation unlocks all label formats, retains snapshots, and does not bind devices to formats', t => {
  const { db, service, request } = setup(t)
  const confirmation = changePrinterMedia(db, 'specialty-metals', change('Brass', null, 'Jane Operator'))
  assert.equal(confirmation.created, true)
  assert.equal(confirmation.printer.currentMedia, 'Brass'); assert.equal(confirmation.printer.lastMediaChangeUser, 'Jane Operator')
  assert.equal(confirmation.printer.lastMediaChangeAt, confirmation.change.timestamp)
  for (const [labelType, labelQuantity] of [['bulk-fixed', 500], ['package-fixed', 50], ['bulk-variable', 72], ['bcc', 18]] as const) {
    const { job } = service.recordJob({ ...request, requestId: randomUUID(), labelType, labelQuantity })
    assert.equal(job.requestedMedia, 'Brass'); assert.equal(job.printer.currentMedia, 'Brass'); assert.equal(job.status, 'recorded')
    assert.equal(job.printQuantity, 25)
  }
  changePrinterMedia(db, 'specialty-metals', change('Stainless', 'Brass'))
  assert.ok(service.listJobs().jobs.every(job => job.printer.currentMedia === 'Brass' && job.printer.lastMediaChangeUser === 'Jane Operator'))
  const old = service.listJobs().jobs[0]
  assert.deepEqual(service.recordJob({ ...request, requestId: old.requestId, labelType: old.label.type, labelQuantity: old.label.quantity }), { job: old, created: false })
  updatePrinter(db, 'specialty-metals', { status: 'inactive' })
  assert.throws(() => service.recordJob({ ...request, requestId: randomUUID() }), /available printer/)
  // Other configured devices remain valid for every format, regardless of their names.
  for (const printerId of ['bulk', 'package', 'galvanized']) assert.equal(service.recordJob({ ...request, requestId: randomUUID(), printerId, labelType: 'bcc', labelQuantity: 1, requestedMedia: undefined }).created, true)
})

test('media updates audit exact facts, reject stale state, and retry idempotently after later changes', t => {
  const { db, service } = setup(t)
  const firstInput = change('Aluminum', null, 'First operator')
  const first = changePrinterMedia(db, 'specialty-metals', firstInput)
  assert.deepEqual(first.change, { id: first.change.id, requestId: firstInput.requestId, printerId: 'specialty-metals', printerName: 'Specialty Metals Printer', previousMedia: null, newMedia: 'Aluminum', user: 'First operator', timestamp: first.change.timestamp })
  const second = changePrinterMedia(db, 'specialty-metals', change('Brass', 'Aluminum', 'Second operator'))
  assert.throws(() => changePrinterMedia(db, 'specialty-metals', change('Stainless', 'Aluminum')), (error: unknown) => error instanceof PrintValidationError && error.code === 'MEDIA_CHANGED')
  assert.deepEqual(changePrinterMedia(db, 'specialty-metals', firstInput), { ...first, created: false })
  assert.equal(service.listPrinters().find(printer => printer.id === 'specialty-metals')?.currentMedia, 'Brass')
  assert.throws(() => changePrinterMedia(db, 'specialty-metals', change('Brass', 'Brass')), /already matches/)
  assert.equal(service.listPrinters().find(printer => printer.id === 'specialty-metals')?.lastMediaChangeAt, second.change.timestamp)
  assert.throws(() => changePrinterMedia(db, 'specialty-metals', { ...firstInput, user: 'Different user' }), /already used/)
  for (const invalid of [{ user: '' }, { user: 'bad\nuser' }, { expectedCurrentMedia: undefined }, { currentMedia: '' }, { currentMedia: 5 }]) {
    assert.throws(() => changePrinterMedia(db, 'specialty-metals', { ...change('Stainless', 'Brass'), ...invalid }))
  }
  const history = listPrinterMediaHistory(db, 'specialty-metals')
  assert.equal(history.changes.length, 2); assert.equal(history.changes[0].id, second.change.id)
  updatePrinter(db, 'specialty-metals', { name: 'Renamed' })
  assert.equal(listPrinterMediaHistory(db, 'specialty-metals').changes[0].printerName, 'Specialty Metals Printer')
})

test('audit insertion failure rolls stock metadata back and permits clean retry', t => {
  const { db, service } = setup(t)
  const input = change('Brass', null)
  db.exec("CREATE TRIGGER fail_media_audit BEFORE INSERT ON printer_media_changes BEGIN SELECT RAISE(ABORT, 'audit failure'); END")
  assert.throws(() => changePrinterMedia(db, 'specialty-metals', input), /audit failure/)
  const current = service.listPrinters().find(printer => printer.id === 'specialty-metals')!
  assert.equal(current.currentMedia, null); assert.equal(current.lastMediaChangeAt, null); assert.equal(current.lastMediaChangeUser, null)
  assert.equal(listPrinterMediaHistory(db, 'specialty-metals').changes.length, 0)
  db.exec('DROP TRIGGER fail_media_audit')
  assert.equal(changePrinterMedia(db, 'specialty-metals', input).created, true)
})

test('configuration, loaded media, audit, and jobs persist through reopening and paginate without duplicates', t => {
  const folder = mkdtempSync(join(tmpdir(), 'billco-media-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const file = join(folder, 'labels.sqlite')
  let db = openProductDatabase(file)
  migrateDatabase(db); seedProducts(db)
  const custom = createPrinter(db, { name: 'Flexible device', model: 'SATO', ipAddress: '192.168.1.201', description: 'Custom stock', supportedMedia: ['Red'], mediaValidationEnabled: false })
  for (let i = 0; i < 27; i++) changePrinterMedia(db, custom.id, change(i % 2 ? 'Blue' : 'Red', i === 0 ? null : i % 2 ? 'Red' : 'Blue', `Operator ${i}`))
  const first = listPrinterMediaHistory(db, custom.id)
  assert.equal(first.changes.length, 25); assert.ok(first.nextBefore)
  db.close()
  db = openProductDatabase(file)
  try {
    assert.equal(migrateDatabase(db), 0)
    const printer = new RecordingPrintService(db).listPrinters().find(printer => printer.id === custom.id)!
    assert.equal(printer.ipAddress, custom.ipAddress); assert.equal(printer.description, custom.description); assert.equal(printer.currentMedia, 'Red'); assert.equal(printer.lastMediaChangeUser, 'Operator 26')
    const second = listPrinterMediaHistory(db, custom.id, first.nextBefore!)
    assert.equal(second.changes.length, 2); assert.equal(second.nextBefore, null)
    assert.ok(!second.changes.some(change => first.changes.some(old => old.id === change.id)))
  } finally { db.close() }
})

test('migration from foundation preserves configured devices, job snapshots, and pre-upgrade retries', t => {
  const db = openProductDatabase(':memory:')
  t.after(() => db.close())
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT')
  for (const [index, filename] of ['001-create-products.sql', '002-separate-barcodes.sql', '003-case-insensitive-parts.sql', '004-print-foundation.sql'].entries()) {
    db.exec(readFileSync(new URL(`../../database/migrations/${filename}`, import.meta.url), 'utf8'))
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(index + 1, filename)
  }
  seedProducts(db)
  const product = findProductByPartNumber(db, '5080')!
  const request = { requestId: 'old-request', printerId: 'old-printer', labelType: 'bulk-fixed', product, labelQuantity: 500, printQuantity: 25, lotNumber: 'OLD-LOT', poNumber: 'OLD-PO' }
  const printer = { id: 'old-printer', name: 'Maintained station', model: 'CL4NX Plus', status: 'active', createdAt: '2026-10-30T00:00:00.000Z' }
  db.prepare('INSERT INTO printers VALUES (?, ?, ?, ?, ?)').run(printer.id, printer.name, printer.model, printer.status, printer.createdAt)
  const job = { id: 'old-job', requestId: request.requestId, status: 'recorded', createdAt: printer.createdAt, printer, printQuantity: 25, label: { templateVersion: 1, type: request.labelType, width: 3, height: 5, product, quantity: 500, barcode: '5080', poNumber: request.poNumber, lotNumber: request.lotNumber } }
  const requestJson = JSON.stringify({ printerId: printer.id, type: request.labelType, product, labelQuantity: 500, printQuantity: 25, lotNumber: request.lotNumber, poNumber: request.poNumber })
  db.prepare('INSERT INTO print_jobs (id,request_id,request_json,printer_id,status,print_quantity,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?)').run(job.id, request.requestId, requestJson, printer.id, 'recorded', 25, JSON.stringify(job), job.createdAt)
  db.prepare('INSERT INTO print_job_events (job_id,event,created_at) VALUES (?,?,?)').run(job.id, 'recorded', job.createdAt)
  assert.equal(migrateDatabase(db), 3)
  const service = new RecordingPrintService(db)
  assert.equal(service.listPrinters().length, 5)
  assert.deepEqual(service.listJobs().jobs, [job])
  assert.deepEqual(service.recordJob(request), { job, created: false })
  assert.equal(service.listPrinters().find(item => item.id === printer.id)?.ipAddress, '')
  assert.equal(db.prepare('SELECT count(*) AS count FROM print_job_events').get()?.count, 1)
})

test('HTTP registry/media endpoints expose blocking mismatch, validation, and durable audit', async t => {
  const { db, request } = setup(t)
  const server = createApp(db).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string, data: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  const mismatch = await post('/api/print-jobs', request)
  assert.equal(mismatch.status, 409)
  assert.deepEqual(await mismatch.json(), { error: 'Please load the requested label stock before continuing.', code: 'MEDIA_MISMATCH', details: { printerId: 'specialty-metals', printerName: 'Specialty Metals Printer', currentMedia: null, requestedMedia: 'Brass' } })
  const input = change('Brass', null, 'Recorded operator')
  assert.equal((await post('/api/printers/specialty-metals/media-changes', input)).status, 201)
  assert.equal((await post('/api/printers/specialty-metals/media-changes', input)).status, 200)
  assert.equal((await post('/api/print-jobs', request)).status, 201)
  const stale = await post('/api/printers/specialty-metals/media-changes', change('Aluminum', null))
  assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'MEDIA_CHANGED')
  const history = await (await fetch(base + '/api/printers/specialty-metals/media-history')).json()
  assert.equal(history.changes.length, 1); assert.equal(history.changes[0].user, 'Recorded operator')
  assert.equal((await fetch(base + '/api/printers/specialty-metals/media-history?before=invalid')).status, 400)
  assert.equal((await fetch(base + '/api/printers/specialty-metals/media-history?before=0')).status, 400)
  assert.equal((await fetch(base + '/api/printers/missing/media-history')).status, 404)
  assert.equal((await post('/api/printers/missing/media-changes', change('Brass', null))).status, 404)
})

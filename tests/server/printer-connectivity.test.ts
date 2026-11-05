import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, Socket, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { findProductByPartNumber, migrateDatabase, openProductDatabase, seedProducts } from '../../database/index.js'
import { createApp } from '../../server/app.js'
import { PrinterConnectionService, tcpConnectionProbe, type ConnectionProbe } from '../../server/printerConnectionService.js'
import { createPrinter, findPrinter, PrintValidationError, RecordingPrintService, updatePrinter } from '../../server/printService.js'

const success = { result: 'success', errorMessage: null } as const
const failure = { result: 'failure', errorMessage: 'Connection refused (ECONNREFUSED).' } as const

function setup(t: TestContext) {
  const db = openProductDatabase(':memory:')
  migrateDatabase(db); seedProducts(db)
  t.after(() => db.close())
  const printer = createPrinter(db, { name: 'Connection fixture', model: 'SATO CL4NX Plus', ipAddress: '127.0.0.1' })
  return { db, printer }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

test('connection settings extend the registry, validate bounds, and keep server-owned status read-only', t => {
  const { db, printer } = setup(t)
  for (const [id, ip] of [['specialty-metals', '192.168.1.190'], ['bulk', '192.168.1.191'], ['package', '192.168.1.192'], ['galvanized', '192.168.1.193']]) {
    const configured = findPrinter(db, id)
    assert.equal(configured.ipAddress, ip)
    assert.equal(configured.port, 9100); assert.equal(configured.connectionTimeoutMs, 3000)
    assert.equal(configured.connectionStatus, 'unknown')
    assert.equal(configured.lastConnectionTestAt, null); assert.equal(configured.lastSuccessfulConnectionAt, null)
  }
  for (const input of [
    { port: 0 }, { port: 65536 }, { port: 1.5 }, { port: '9100' }, { port: null },
    { connectionTimeoutMs: 99 }, { connectionTimeoutMs: 30001 }, { connectionTimeoutMs: 100.5 }, { connectionTimeoutMs: '3000' },
    { connectionStatus: 'online' }, { lastConnectionTestAt: '2026-11-04T00:00:00Z' }, { lastSuccessfulConnectionAt: null }, { connectionGeneration: 1 },
  ]) assert.throws(() => updatePrinter(db, printer.id, input), PrintValidationError)
  assert.equal(updatePrinter(db, printer.id, { port: 1, connectionTimeoutMs: 100 }).port, 1)
  const maximum = updatePrinter(db, printer.id, { port: 65535, connectionTimeoutMs: 30000 })
  assert.equal(maximum.port, 65535); assert.equal(maximum.connectionTimeoutMs, 30000)
})

test('real TCP connection tests close immediately without sending application bytes', { timeout: 10000 }, async t => {
  const { db, printer } = setup(t)
  let bytes = 0
  const peerClosed = deferred<void>()
  const peers = new Set<Socket>()
  const server = createServer(socket => {
    peers.add(socket)
    socket.on('data', data => { bytes += data.length })
    socket.once('close', () => { peers.delete(socket); peerClosed.resolve() })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => {
    for (const socket of peers) socket.destroy()
    server.close(() => resolve())
  }))
  const port = (server.address() as AddressInfo).port
  updatePrinter(db, printer.id, { port, connectionTimeoutMs: 1000 })
  const service = new PrinterConnectionService(db)
  const result = await service.testConnection(printer.id)
  await peerClosed.promise
  assert.equal(result.connection.result, 'success'); assert.equal(result.applied, true)
  assert.equal(result.connection.errorMessage, null); assert.equal(result.connection.ipAddress, '127.0.0.1')
  assert.equal(result.connection.port, port); assert.equal(result.printer.connectionStatus, 'online')
  assert.equal(result.printer.lastSuccessfulConnectionAt, result.connection.timestamp)
  assert.equal(result.printer.lastConnectionTestAt, result.connection.timestamp)
  assert.equal(bytes, 0); assert.equal(peers.size, 0)
  assert.equal(service.listHistory(printer.id).connections.length, 1)
  assert.equal(new RecordingPrintService(db).listJobs().jobs.length, 0)
})

test('TCP probe bounds connection attempts and reports errors with socket cleanup', async t => {
  const socket = new Socket()
  t.mock.method(socket, 'connect', () => socket)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const timedOut = tcpConnectionProbe({ ipAddress: '127.0.0.1', port: 9100, timeoutMs: 100 }, () => socket)
  t.mock.timers.tick(100)
  const timeout = await timedOut
  assert.equal(timeout.result, 'failure'); assert.match(timeout.errorMessage ?? '', /timed out/i)
  assert.equal(socket.destroyed, true)
  t.mock.timers.reset()

  const refusedSocket = new Socket()
  t.mock.method(refusedSocket, 'connect', () => refusedSocket)
  const refused = tcpConnectionProbe({ ipAddress: '127.0.0.1', port: 9100, timeoutMs: 1000 }, () => refusedSocket)
  refusedSocket.emit('error', Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }))
  const error = await refused
  assert.equal(error.result, 'failure'); assert.match(error.errorMessage ?? '', /refused|ECONNREFUSED/i)
  assert.equal(refusedSocket.destroyed, true)
})

test('manual outcomes update connectivity independently from enabled status, media, and recorded jobs', async t => {
  const { db, printer } = setup(t)
  const service = new PrinterConnectionService(db, async () => success)
  updatePrinter(db, printer.id, { status: 'inactive' })
  const connected = await service.testConnection(printer.id)
  assert.equal(connected.printer.status, 'inactive'); assert.equal(connected.printer.connectionStatus, 'online')
  assert.equal(connected.printer.currentMedia, null)
  const failed = await new PrinterConnectionService(db, async () => failure).testConnection(printer.id)
  assert.equal(failed.printer.connectionStatus, 'offline')
  assert.equal(failed.printer.lastSuccessfulConnectionAt, connected.printer.lastSuccessfulConnectionAt)
  assert.equal(failed.connection.errorMessage, failure.errorMessage)
  const maintained = updatePrinter(db, printer.id, { name: 'Renamed', status: 'active', description: 'Maintained settings' })
  assert.equal(maintained.connectionStatus, 'offline')
  assert.equal(maintained.lastSuccessfulConnectionAt, connected.printer.lastSuccessfulConnectionAt)
  const printing = new RecordingPrintService(db)
  const job = printing.recordJob({ requestId: randomUUID(), printerId: printer.id, product: findProductByPartNumber(db, '5080'), labelType: 'bcc', labelQuantity: 10, printQuantity: 25, lotNumber: 'LOT-37', poNumber: '' }).job
  assert.equal(job.status, 'recorded'); assert.equal(job.printQuantity, 25)
  assert.equal(job.printer.connectionStatus, 'offline')
  assert.equal(service.listHistory(printer.id).connections.length, 2)
  for (const edit of [{ ipAddress: '127.0.0.2' }, { port: 9200 }, { connectionTimeoutMs: 500 }]) {
    await service.testConnection(printer.id)
    const changed = updatePrinter(db, printer.id, edit)
    assert.equal(changed.connectionStatus, 'unknown')
    assert.equal(changed.lastConnectionTestAt, null); assert.equal(changed.lastSuccessfulConnectionAt, null)
  }
  assert.equal(printing.listJobs().jobs[0].printer.connectionStatus, 'offline')
})

test('newer tests and configuration changes supersede pending outcomes without losing their history', async t => {
  const { db, printer } = setup(t)
  const older = deferred<typeof success>()
  const firstService = new PrinterConnectionService(db, () => older.promise)
  const pending = firstService.testConnection(printer.id)
  // Configuration can be saved while the asynchronous connection is pending.
  updatePrinter(db, printer.id, { port: 9200 })
  older.resolve(success)
  const stale = await pending
  assert.equal(stale.applied, false); assert.equal(stale.connection.port, 9100)
  assert.equal(stale.printer.port, 9200); assert.equal(stale.printer.connectionStatus, 'unknown')

  const deferredOlder = deferred<typeof success>()
  const nextPending = new PrinterConnectionService(db, () => deferredOlder.promise).testConnection(printer.id)
  const newest = await new PrinterConnectionService(db, async () => failure).testConnection(printer.id)
  deferredOlder.resolve(success)
  const earlier = await nextPending
  assert.equal(newest.applied, true); assert.equal(earlier.applied, false)
  assert.equal(findPrinter(db, printer.id).connectionStatus, 'offline')
  assert.equal(firstService.listHistory(printer.id).connections.length, 3)
})

test('history failures roll back status changes and missing configuration never probes', async t => {
  const { db, printer } = setup(t)
  let calls = 0
  const service = new PrinterConnectionService(db, async () => { calls++; return success })
  const blank = createPrinter(db, { name: 'Unconfigured', model: 'Generic' })
  await assert.rejects(() => service.testConnection('missing'), /not found/)
  await assert.rejects(() => service.testConnection(blank.id), /IP address/i)
  assert.equal(calls, 0)
  assert.equal(service.listHistory(blank.id).connections.length, 0)
  db.exec("CREATE TRIGGER fail_connection_history BEFORE INSERT ON printer_connection_history BEGIN SELECT RAISE(ABORT, 'history failure'); END")
  await assert.rejects(() => service.testConnection(printer.id), /history failure/)
  const untouched = findPrinter(db, printer.id)
  assert.equal(untouched.connectionStatus, 'unknown'); assert.equal(untouched.lastConnectionTestAt, null); assert.equal(untouched.lastSuccessfulConnectionAt, null)
  assert.equal(service.listHistory(printer.id).connections.length, 0)
  db.exec('DROP TRIGGER fail_connection_history')
  assert.equal((await service.testConnection(printer.id)).printer.connectionStatus, 'online')
  assert.equal(service.listHistory(printer.id).connections.length, 1)
})

test('connection history persists, paginates, and retains the tested endpoint after configuration edits', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'billco-connectivity-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const file = join(folder, 'labels.sqlite')
  let db = openProductDatabase(file)
  migrateDatabase(db)
  const printer = createPrinter(db, { name: 'Historical device', model: 'SATO', ipAddress: '127.0.0.1', port: 9200, connectionTimeoutMs: 200 })
  const service = new PrinterConnectionService(db, async () => success)
  for (let index = 0; index < 27; index++) await service.testConnection(printer.id)
  const first = service.listHistory(printer.id)
  assert.equal(first.connections.length, 25); assert.ok(first.nextBefore)
  updatePrinter(db, printer.id, { name: 'Renamed device', ipAddress: '127.0.0.2', port: 9300 })
  db.close()
  db = openProductDatabase(file)
  try {
    assert.equal(migrateDatabase(db), 0)
    const stored = findPrinter(db, printer.id)
    assert.equal(stored.port, 9300); assert.equal(stored.connectionTimeoutMs, 200); assert.equal(stored.connectionStatus, 'unknown')
    const history = new PrinterConnectionService(db)
    const remaining = history.listHistory(printer.id, first.nextBefore!)
    assert.equal(remaining.connections.length, 2); assert.equal(remaining.nextBefore, null)
    assert.ok(!remaining.connections.some(connection => first.connections.some(previous => previous.id === connection.id)))
    assert.ok([...first.connections, ...remaining.connections].every(connection => connection.printerName === 'Historical device' && connection.ipAddress === '127.0.0.1' && connection.port === 9200 && connection.connectionTimeoutMs === 200))
  } finally { db.close() }
})

test('migration from printer management preserves configured devices, media audit, and immutable jobs', t => {
  const db = openProductDatabase(':memory:')
  t.after(() => db.close())
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT')
  for (const [index, filename] of ['001-create-products.sql', '002-separate-barcodes.sql', '003-case-insensitive-parts.sql', '004-print-foundation.sql', '005-printer-media.sql'].entries()) {
    db.exec(readFileSync(new URL(`../../database/migrations/${filename}`, import.meta.url), 'utf8'))
    db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(index + 1, filename)
  }
  seedProducts(db)
  const product = findProductByPartNumber(db, '5080')!
  const printer = { id: 'bulk', name: 'Maintained bulk station', model: 'SATO CL4NX Plus', status: 'active', createdAt: '2026-11-04T00:00:00Z', ipAddress: '192.168.1.191', currentMedia: 'Custom stock' }
  db.prepare('UPDATE printers SET name = ?, current_media = ?, last_media_change_at = ?, last_media_change_user = ? WHERE id = ?').run(printer.name, printer.currentMedia, printer.createdAt, 'Earlier Operator', printer.id)
  const change = { id: 'old-media', requestId: 'old-media-request', printerId: printer.id, printerName: printer.name, previousMedia: null, newMedia: printer.currentMedia, user: 'Earlier Operator', timestamp: printer.createdAt }
  db.prepare('INSERT INTO printer_media_changes (id,request_id,request_json,printer_id,printer_name,previous_media,new_media,user,created_at,result_json) VALUES (?,?,?,?,?,?,?,?,?,?)').run(change.id, change.requestId, '{}', printer.id, printer.name, null, change.newMedia, change.user, change.timestamp, JSON.stringify({ printer, change }))
  const request = { requestId: 'old-print-request', printerId: printer.id, product, labelType: 'bulk-fixed', labelQuantity: 500, printQuantity: 25, lotNumber: 'OLD-LOT', poNumber: 'OLD-PO' }
  const job = { id: 'old-job', requestId: request.requestId, status: 'recorded', createdAt: printer.createdAt, printer, printQuantity: 25, label: { templateVersion: 1, type: request.labelType, width: 3, height: 5, product, quantity: 500, barcode: '5080', poNumber: request.poNumber, lotNumber: request.lotNumber } }
  const requestJson = JSON.stringify({ printerId: printer.id, type: request.labelType, product, labelQuantity: 500, printQuantity: 25, lotNumber: request.lotNumber, poNumber: request.poNumber })
  db.prepare('INSERT INTO print_jobs (id,request_id,request_json,printer_id,status,print_quantity,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?)').run(job.id, request.requestId, requestJson, printer.id, 'recorded', 25, JSON.stringify(job), job.createdAt)
  db.prepare('INSERT INTO print_job_events (job_id,event,created_at) VALUES (?,?,?)').run(job.id, 'recorded', job.createdAt)
  assert.equal(migrateDatabase(db), 2); assert.equal(migrateDatabase(db), 0)
  const stored = findPrinter(db, printer.id)
  assert.equal(stored.name, printer.name); assert.equal(stored.ipAddress, printer.ipAddress); assert.equal(stored.currentMedia, printer.currentMedia)
  assert.equal(stored.lastMediaChangeUser, change.user); assert.equal(stored.connectionStatus, 'unknown'); assert.equal(stored.port, 9100)
  const prints = new RecordingPrintService(db)
  assert.deepEqual(prints.listJobs().jobs, [job]); assert.deepEqual(prints.recordJob(request), { job, created: false })
  assert.equal(db.prepare('SELECT result_json FROM printer_media_changes WHERE id = ?').get(change.id)?.result_json, JSON.stringify({ printer, change }))
  assert.equal(new PrinterConnectionService(db).listHistory(printer.id).connections.length, 0)
})

test('HTTP connection actions use saved targets only and never run on list, refresh, or print recording', async t => {
  const { db, printer } = setup(t)
  const targets: Parameters<ConnectionProbe>[0][] = []
  const probe: ConnectionProbe = async target => { targets.push(target); return failure }
  const server = createApp(db, { connectionProbe: probe }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string, data: unknown = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  assert.equal((await fetch(base + '/api/printers')).status, 200)
  assert.equal((await fetch(base + `/api/printers/${printer.id}/connection-history`)).status, 200)
  assert.equal(targets.length, 0)
  const tested = await post(`/api/printers/${printer.id}/test-connection`, { ipAddress: '192.168.1.190', port: 1, connectionTimeoutMs: 30000 })
  assert.equal(tested.status, 200)
  const result = await tested.json()
  assert.equal(result.connection.result, 'failure'); assert.equal(result.printer.connectionStatus, 'offline')
  assert.deepEqual(targets, [{ ipAddress: '127.0.0.1', port: 9100, timeoutMs: 3000 }])
  assert.equal((await post('/api/print-jobs', { requestId: randomUUID(), printerId: printer.id, product: findProductByPartNumber(db, '5080'), labelType: 'bcc', labelQuantity: 1, printQuantity: 1, lotNumber: 'LOT-37', poNumber: '' })).status, 201)
  assert.equal((await fetch(base + '/api/printers')).status, 200)
  assert.equal(targets.length, 1)
  const history = await (await fetch(base + `/api/printers/${printer.id}/connection-history`)).json()
  assert.equal(history.connections.length, 1); assert.equal(history.connections[0].errorMessage, failure.errorMessage)
  assert.equal((await fetch(base + `/api/printers/${printer.id}/connection-history?before=bad`)).status, 400)
  assert.equal((await fetch(base + `/api/printers/${printer.id}/connection-history?before=0`)).status, 400)
  assert.equal((await post('/api/printers/missing/test-connection')).status, 404)
  assert.equal(targets.length, 1)
})

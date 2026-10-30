import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'
import { openProductDatabase, migrateDatabase, seedProducts, findProductByPartNumber } from '../../database/index.js'
import { createPrinter, updatePrinter, RecordingPrintService } from '../../server/printService.js'
import { seedDevelopmentPrinters } from '../../database/printers.js'
import { createApp } from '../../server/app.js'
import type { PrintRequest } from '../../shared/printing.js'

function setup(t: TestContext, filename = ':memory:') {
  const db = openProductDatabase(filename); migrateDatabase(db); seedProducts(db)
  t.after(() => db.close())
  const printer = createPrinter(db, { name: 'Printer A', model: 'SATO CL4NX Plus' })
  const service = new RecordingPrintService(db)
  const request: PrintRequest = { requestId: randomUUID(), printerId: printer.id, product: findProductByPartNumber(db, '5080')!, labelType: 'bulk-fixed', labelQuantity: 500, printQuantity: 25, lotNumber: 'LOT-27', poNumber: 'PO-27' }
  return { db, printer, service, request }
}

test('records all four formats with independent copy counts and immutable snapshots/events', t => {
  const { db, service, request, printer } = setup(t)
  for (const [type, quantity, barcode, height] of [
    ['bulk-fixed', 500, '5080', 5], ['package-fixed', 50, '5080', 2], ['bulk-variable', 72, null, 5], ['bcc', 72, null, 2],
  ] as const) {
    const { job, created } = service.recordJob({ ...request, requestId: randomUUID(), labelType: type, labelQuantity: quantity })
    assert.equal(created, true); assert.equal(job.status, 'recorded'); assert.equal(job.printQuantity, 25)
    assert.equal(job.label.quantity, quantity); assert.equal(job.label.barcode, barcode); assert.equal(job.label.height, height)
    assert.equal(job.label.poNumber, height === 5 ? 'PO-27' : '')
  }
  db.prepare("UPDATE products SET description = 'Changed master' WHERE part_number = '5080'").run()
  updatePrinter(db, printer.id, { name: 'Renamed printer', status: 'inactive' })
  const jobs = service.listJobs().jobs
  assert.equal(jobs.length, 4)
  assert.ok(jobs.every(job => job.label.product.description === '3/8 Brass Coupling' && job.printer.name === 'Printer A'))
  assert.equal(db.prepare('SELECT count(*) AS count FROM print_job_events').get()?.count, 4)
})

test('idempotent retries retain original result even after master/printer changes; conflicting reuse fails', t => {
  const { db, service, request, printer } = setup(t)
  const first = service.recordJob(request)
  updatePrinter(db, printer.id, { status: 'inactive' })
  db.prepare("UPDATE products SET status = 'inactive' WHERE part_number = '5080'").run()
  assert.deepEqual(service.recordJob(request), { job: first.job, created: false })
  assert.throws(() => service.recordJob({ ...request, printQuantity: 100 }), /already used/)
  assert.equal(service.listJobs().jobs.length, 1)
})

test('rejects invalid copies, quantity, product, fields, fixed data, and inactive/missing printers without recording', t => {
  const { db, service, request, printer } = setup(t)
  const invalid = [
    ...[0, -1, 1.5, '25', 1000000, null].map(printQuantity => ({ printQuantity })),
    { labelQuantity: 50 }, { labelType: 'unknown' }, { lotNumber: '' }, { lotNumber: 'x'.repeat(33) },
    { poNumber: '' }, { poNumber: 'x\n' }, { printerId: 'missing' },
    { product: { ...request.product, description: 'Spoofed' } },
    { product: findProductByPartNumber(db, '5090') },
  ]
  for (const changes of invalid) assert.throws(() => service.recordJob({ ...request, ...changes }))
  db.prepare("UPDATE products SET bulk_barcode = '' WHERE part_number = '5080'").run()
  assert.throws(() => service.recordJob({ ...request, product: findProductByPartNumber(db, '5080') }), /fixed quantity/)
  updatePrinter(db, printer.id, { status: 'inactive' })
  assert.throws(() => service.recordJob(request), /available printer/)
  assert.equal(service.listJobs().jobs.length, 0)
  assert.equal(db.prepare('SELECT count(*) AS count FROM print_job_events').get()?.count, 0)
})

test('history survives reopening the database and uses stable cursor pagination', t => {
  const folder = mkdtempSync(join(tmpdir(), 'billco-print-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const filename = join(folder, 'db.sqlite')
  // Own this connection separately so it can be closed/reopened in the test.
  const db = openProductDatabase(filename); migrateDatabase(db); seedProducts(db)
  const printer = createPrinter(db, { name: 'Printer B', model: 'SATO CL4NX Plus' })
  const service = new RecordingPrintService(db)
  for (let i = 0; i < 27; i++) service.recordJob({ requestId: randomUUID(), printerId: printer.id, product: findProductByPartNumber(db, '5080'), labelType: 'bcc', labelQuantity: 8, printQuantity: 100, lotNumber: 'LOT', poNumber: '' })
  const first = service.listJobs(); assert.equal(first.jobs.length, 25); assert.ok(first.nextBefore)
  db.close()
  const reopened = openProductDatabase(filename)
  try {
    const next = new RecordingPrintService(reopened).listJobs(first.nextBefore!)
    assert.equal(next.jobs.length, 2); assert.equal(next.nextBefore, null)
    assert.ok(!next.jobs.some(job => first.jobs.some(previous => previous.id === job.id)))
  } finally { reopened.close() }
})

test('print HTTP endpoints validate requests, configure printers, and expose recorded history', async t => {
  const { db, request } = setup(t)
  const server = createApp(db).listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await post('/api/printers', { name: 'Printer C', model: 'SATO CL4NX Plus' })).status, 201)
  assert.equal((await (await fetch(url + '/api/printers')).json()).length, 2)
  assert.equal((await post('/api/print-jobs', request)).status, 201)
  assert.equal((await post('/api/print-jobs', request)).status, 200)
  assert.equal((await post('/api/print-jobs', { ...request, printQuantity: 1 })).status, 409)
  const history = await (await fetch(url + '/api/print-jobs')).json()
  assert.equal(history.jobs.length, 1); assert.equal(history.jobs[0].status, 'recorded')
  assert.equal((await fetch(url + '/api/print-jobs?before=abc')).status, 400)
  assert.equal((await fetch(url + '/api/print-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400)
})


test('development printer examples are idempotent and never assign stock or overwrite configured records', t => {
  const { db, service } = setup(t)
  seedDevelopmentPrinters(db)
  const example = service.listPrinters().find(printer => printer.id === 'example-sato-1')!
  updatePrinter(db, example.id, { name: 'Changed name', status: 'inactive' })
  seedDevelopmentPrinters(db)
  assert.equal(service.listPrinters().length, 5)
  assert.equal(service.listPrinters().find(printer => printer.id === example.id)?.name, 'Changed name')
  assert.equal(service.listPrinters().find(printer => printer.id === example.id)?.status, 'inactive')
})

test('event-write failure rolls back the job and permits a clean retry', t => {
  const { db, service, request } = setup(t)
  db.exec("CREATE TRIGGER fail_print_event BEFORE INSERT ON print_job_events BEGIN SELECT RAISE(ABORT, 'event failure'); END")
  assert.throws(() => service.recordJob(request), /event failure/)
  assert.equal(service.listJobs().jobs.length, 0)
  db.exec('DROP TRIGGER fail_print_event')
  assert.equal(service.recordJob(request).created, true)
})


test('import, lookup, storage, and job recording share Unicode part-number boundaries', async t => {
  const { db, request } = setup(t)
  const server = createApp(db).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const valid = ['😀'.repeat(64), 'A'.repeat(32) + '😀'.repeat(32), 'A'.repeat(64)]
  const invalid = ['😀'.repeat(65), 'A'.repeat(65), 'part\nnumber', '   ']
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('BillcoMaster').addRows([
    ['BillcoPart#', 'Description', 'StdPackQty', 'BulkQty', 'ProductBarcode', 'BulkBarcode'],
    ...[...valid, ...invalid].map(part => [part, 'Unicode product', 50, 500, 'PRODUCT-CODE', 'BULK-CODE']),
  ])
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(await workbook.xlsx.writeBuffer())]), 'unicode.xlsx')
  const imported = await fetch(`${url}/api/products/import`, { method: 'POST', body: form })
  assert.equal(imported.status, 200)
  const result = await imported.json()
  assert.equal(result.added, valid.length)
  assert.equal(result.invalidRows, invalid.length)
  const record = (product: unknown, labelType: string, labelQuantity: number) => fetch(`${url}/api/print-jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, requestId: randomUUID(), product, labelType, labelQuantity }),
  })
  for (const part of valid) {
    assert.equal(db.prepare('SELECT length(part_number) AS length FROM products WHERE part_number = ?').get(part)?.length, 64)
    const lookup = await fetch(`${url}/api/products?partNumber=${encodeURIComponent(part)}`)
    assert.equal(lookup.status, 200)
    const product = await lookup.json()
    for (const [type, quantity] of [['bulk-fixed', 500], ['package-fixed', 50], ['bulk-variable', 72], ['bcc', 72]] as const) {
      const response = await record(product, type, quantity)
      assert.equal(response.status, 201)
      const job = await response.json()
      assert.equal(job.label.product.partNumber, part)
      assert.equal(job.status, 'recorded')
    }
  }
  for (const part of invalid) {
    assert.equal((await fetch(`${url}/api/products?partNumber=${encodeURIComponent(part)}`)).status, 400)
    const response = await record({ ...request.product, partNumber: part }, 'bulk-fixed', 500)
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /valid part number/)
    assert.throws(() => seedProducts(db, [{ ...request.product, partNumber: part }]), /CHECK constraint/)
  }
  assert.equal(new RecordingPrintService(db).listJobs().jobs.length, valid.length * 4)
})

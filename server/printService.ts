import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { findProductByPartNumber } from '../database/index.js'
import { printLabelTypes, type Printer, type PrintJob, type PrintLabelType, type PrintService } from '../shared/printing.js'

export class PrintValidationError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PrintValidationError('Enter a valid request.')
  return value as Record<string, unknown>
}
function text(value: unknown, name: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value) || (required && !value.trim())) {
    throw new PrintValidationError(`Enter a valid ${name}${required ? '' : ' or leave it blank'}.`)
  }
  return value.trim()
}
function quantity(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 999999) throw new PrintValidationError(`${name} must be a whole number from 1 to 999999.`)
  return value
}
export function createPrinter(db: DatabaseSync, input: unknown): Printer {
  const data = object(input)
  const printer: Printer = { id: randomUUID(), name: text(data.name, 'printer name', 80), model: text(data.model, 'printer model', 80), status: 'active', createdAt: new Date().toISOString() }
  db.prepare('INSERT INTO printers (id, name, model, status, created_at) VALUES (?, ?, ?, ?, ?)').run(printer.id, printer.name, printer.model, printer.status, printer.createdAt)
  return printer
}
export function updatePrinter(db: DatabaseSync, id: string, input: unknown): Printer {
  const data = object(input)
  const current = db.prepare('SELECT id, name, model, status, created_at AS createdAt FROM printers WHERE id = ?').get(id) as unknown as Printer | undefined
  if (!current) throw new PrintValidationError('Printer not found.', 404)
  if (data.status !== undefined && data.status !== 'active' && data.status !== 'inactive') throw new PrintValidationError('Choose an active or inactive printer status.')
  const printer: Printer = { ...current, name: data.name === undefined ? current.name : text(data.name, 'printer name', 80), model: data.model === undefined ? current.model : text(data.model, 'printer model', 80), status: data.status as Printer['status'] ?? current.status }
  db.prepare('UPDATE printers SET name = ?, model = ?, status = ? WHERE id = ?').run(printer.name, printer.model, printer.status, id)
  return printer
}

export class RecordingPrintService implements PrintService {
  constructor(private db: DatabaseSync) {}
  listPrinters(): Printer[] {
    return this.db.prepare('SELECT id, name, model, status, created_at AS createdAt FROM printers ORDER BY name COLLATE NOCASE, id').all().map(row => ({ ...row })) as unknown as Printer[]
  }
  listJobs(before?: number) {
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new PrintValidationError('Enter a valid history cursor.')
    const rows = this.db.prepare('SELECT sequence, snapshot_json FROM print_jobs WHERE sequence < ? ORDER BY sequence DESC LIMIT 26').all(before ?? Number.MAX_SAFE_INTEGER)
    return { jobs: rows.slice(0, 25).map(row => JSON.parse(String(row.snapshot_json)) as PrintJob), nextBefore: rows.length > 25 ? Number(rows[24].sequence) : null }
  }
  recordJob(input: unknown): { job: PrintJob; created: boolean } {
    const data = object(input)
    const requestId = text(data.requestId, 'request ID', 64)
    const printerId = text(data.printerId, 'printer', 64)
    if (!printLabelTypes.includes(data.labelType as PrintLabelType)) throw new PrintValidationError('Choose a supported label type.')
    const type = data.labelType as PrintLabelType
    const bulk = type === 'bulk-fixed' || type === 'bulk-variable'
    const fixed = type === 'bulk-fixed' || type === 'package-fixed'
    const labelQuantity = quantity(data.labelQuantity, 'Quantity on label')
    const printQuantity = quantity(data.printQuantity, 'Print quantity')
    const lotNumber = text(data.lotNumber, 'lot number', 32)
    const poNumber = text(data.poNumber, 'PO number', 32, bulk)
    const expected = object(data.product)
    const partNumber = text(expected.partNumber, 'part number', 64)
    // Canonical field order makes retry comparison independent of JSON key order.
    const expectedProduct = Object.fromEntries(['partNumber', 'description', 'bulkFixedQuantity', 'packageFixedQuantity', 'productBarcode', 'bulkBarcode', 'status'].map(key => [key, expected[key]]))
    const requestJson = JSON.stringify({ printerId, type, product: expectedProduct, labelQuantity, printQuantity, lotNumber, poNumber: bulk ? poNumber : '' })
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare('SELECT request_json, snapshot_json FROM print_jobs WHERE request_id = ?').get(requestId)
      if (existing) {
        if (existing.request_json !== requestJson) throw new PrintValidationError('This request ID was already used for different label details.', 409)
        this.db.exec('COMMIT')
        return { job: JSON.parse(String(existing.snapshot_json)), created: false }
      }
      const printer = this.listPrinters().find(printer => printer.id === printerId)
      if (!printer || printer.status !== 'active') throw new PrintValidationError('Choose an available printer.')
      const product = findProductByPartNumber(this.db, partNumber)
      if (!product || product.status !== 'active') throw new PrintValidationError('Choose an active product.')
      if (Object.entries(product).some(([key, value]) => expected[key] !== value)) throw new PrintValidationError('Product information changed. Search again and review the label.', 409)
      const barcode = fixed ? (bulk ? product.bulkBarcode : product.productBarcode) : null
      if (fixed && ((bulk ? product.bulkFixedQuantity : product.packageFixedQuantity) !== labelQuantity || !barcode?.trim())) throw new PrintValidationError('This product is missing fixed quantity/barcode data, or its quantity does not match the master.')
      const job: PrintJob = { id: randomUUID(), requestId, status: 'recorded', createdAt: new Date().toISOString(), printer, printQuantity,
        label: { templateVersion: 1, type, width: 3, height: bulk ? 5 : 2, product, quantity: labelQuantity, barcode, poNumber: bulk ? poNumber : '', lotNumber } }
      this.db.prepare('INSERT INTO print_jobs (id, request_id, request_json, printer_id, status, print_quantity, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(job.id, requestId, requestJson, printerId, job.status, printQuantity, JSON.stringify(job), job.createdAt)
      this.db.prepare('INSERT INTO print_job_events (job_id, event, created_at) VALUES (?, ?, ?)').run(job.id, 'recorded', job.createdAt)
      this.db.exec('COMMIT')
      return { job, created: true }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}

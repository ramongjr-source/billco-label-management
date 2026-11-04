import { isValidPartNumber } from '../shared/partNumber.js'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'
import { findProductByPartNumber } from '../database/index.js'
import { printLabelTypes, type Printer, type PrintJob, type PrintLabelType, type PrintService, type MediaChange, type MediaHistoryPage, type MediaMismatch } from '../shared/printing.js'

export class PrintValidationError extends Error {
  constructor(message: string, public status = 400, public code?: string, public details?: MediaMismatch) { super(message) }
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
const printerColumns = `id, name, model, status, created_at AS createdAt,
  ip_address AS ipAddress, description, supported_media_json AS supportedMediaJson,
  current_media AS currentMedia, last_media_change_at AS lastMediaChangeAt,
  last_media_change_user AS lastMediaChangeUser, media_validation_enabled AS mediaValidationEnabled`
function printerFromRow(row: Record<string, unknown>): Printer {
  const { supportedMediaJson, ...printer } = row
  return { ...printer, supportedMedia: JSON.parse(String(supportedMediaJson)), mediaValidationEnabled: Boolean(row.mediaValidationEnabled) } as unknown as Printer
}
function findPrinter(db: DatabaseSync, id: string): Printer {
  const row = db.prepare(`SELECT ${printerColumns} FROM printers WHERE id = ?`).get(id)
  if (!row) throw new PrintValidationError('Printer not found.', 404)
  return printerFromRow(row)
}
function mediaList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 40) throw new PrintValidationError('Enter up to 40 supported media names.')
  const media = value.map(item => text(item, 'media name', 80))
  if (new Set(media.map(item => item.toLowerCase())).size !== media.length) throw new PrintValidationError('Supported media names must be unique.')
  return media
}
function printerConfiguration(data: Record<string, unknown>, current?: Printer) {
  if (data.currentMedia !== undefined || data.lastMediaChangeAt !== undefined || data.lastMediaChangeUser !== undefined) throw new PrintValidationError('Use the media change action with an operator name to update loaded media.')
  const status = data.status === undefined ? current?.status ?? 'active' : data.status
  if (status !== 'active' && status !== 'inactive') throw new PrintValidationError('Choose an active or inactive printer status.')
  const ipAddress = data.ipAddress === undefined ? current?.ipAddress ?? '' : text(data.ipAddress, 'IP address', 45, false)
  if (ipAddress && !isIP(ipAddress)) throw new PrintValidationError('Enter a valid IPv4 or IPv6 address, or leave it blank.')
  const supportedMedia = data.supportedMedia === undefined ? current?.supportedMedia ?? [] : mediaList(data.supportedMedia)
  const mediaValidationEnabled = data.mediaValidationEnabled === undefined ? current?.mediaValidationEnabled ?? false : data.mediaValidationEnabled
  if (typeof mediaValidationEnabled !== 'boolean') throw new PrintValidationError('Choose whether media confirmation is required.')
  if (mediaValidationEnabled && !supportedMedia.length) throw new PrintValidationError('Add supported media before requiring media confirmation.')
  return {
    name: data.name === undefined && current ? current.name : text(data.name, 'printer name', 80),
    model: data.model === undefined && current ? current.model : text(data.model, 'printer model', 80),
    status, ipAddress,
    description: data.description === undefined ? current?.description ?? '' : text(data.description, 'printer description', 512, false),
    supportedMedia, mediaValidationEnabled,
  } as Pick<Printer, 'name' | 'model' | 'status' | 'ipAddress' | 'description' | 'supportedMedia' | 'mediaValidationEnabled'>
}
export function createPrinter(db: DatabaseSync, input: unknown): Printer {
  const config = printerConfiguration(object(input))
  const printer: Printer = { id: randomUUID(), ...config, createdAt: new Date().toISOString(), currentMedia: null, lastMediaChangeAt: null, lastMediaChangeUser: null }
  db.prepare(`INSERT INTO printers (id, name, model, status, created_at, ip_address, description, supported_media_json, media_validation_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(printer.id, printer.name, printer.model, printer.status, printer.createdAt, printer.ipAddress, printer.description, JSON.stringify(printer.supportedMedia), Number(printer.mediaValidationEnabled))
  return printer
}
export function updatePrinter(db: DatabaseSync, id: string, input: unknown): Printer {
  const data = object(input)
  db.exec('BEGIN IMMEDIATE')
  try {
    const current = findPrinter(db, id)
    const printer: Printer = { ...current, ...printerConfiguration(data, current) }
    db.prepare(`UPDATE printers SET name = ?, model = ?, status = ?, ip_address = ?, description = ?, supported_media_json = ?, media_validation_enabled = ? WHERE id = ?`)
      .run(printer.name, printer.model, printer.status, printer.ipAddress, printer.description, JSON.stringify(printer.supportedMedia), Number(printer.mediaValidationEnabled), id)
    db.exec('COMMIT')
    return printer
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
function nullableMedia(value: unknown): string | null {
  return value === null ? null : text(value, 'media name', 80)
}
export function changePrinterMedia(db: DatabaseSync, id: string, input: unknown): { printer: Printer; change: MediaChange; created: boolean } {
  const data = object(input)
  const requestId = text(data.requestId, 'request ID', 64)
  const user = text(data.user, 'operator name', 80)
  const newMedia = nullableMedia(data.currentMedia)
  const expectedCurrentMedia = nullableMedia(data.expectedCurrentMedia)
  const requestJson = JSON.stringify({ printerId: id, newMedia, expectedCurrentMedia, user })
  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = db.prepare('SELECT request_json, result_json FROM printer_media_changes WHERE request_id = ?').get(requestId)
    if (existing) {
      if (existing.request_json !== requestJson) throw new PrintValidationError('This request ID was already used for a different media change.', 409)
      db.exec('COMMIT')
      return { ...JSON.parse(String(existing.result_json)), created: false }
    }
    const current = findPrinter(db, id)
    if (current.currentMedia !== expectedCurrentMedia) throw new PrintValidationError('Loaded media changed since you reviewed it. Reload the printer and review the current stock.', 409, 'MEDIA_CHANGED')
    if (current.currentMedia === newMedia) throw new PrintValidationError('Loaded media already matches. No media change is needed.')
    const timestamp = new Date().toISOString()
    const printer: Printer = { ...current, currentMedia: newMedia, lastMediaChangeAt: timestamp, lastMediaChangeUser: user }
    const change: MediaChange = { id: randomUUID(), requestId, printerId: id, printerName: current.name, previousMedia: current.currentMedia, newMedia, user, timestamp }
    const result = { printer, change }
    db.prepare('UPDATE printers SET current_media = ?, last_media_change_at = ?, last_media_change_user = ? WHERE id = ?').run(newMedia, timestamp, user, id)
    db.prepare(`INSERT INTO printer_media_changes (id, request_id, request_json, printer_id, printer_name, previous_media, new_media, user, created_at, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(change.id, requestId, requestJson, id, current.name, current.currentMedia, newMedia, user, timestamp, JSON.stringify(result))
    db.exec('COMMIT')
    return { ...result, created: true }
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
export function listPrinterMediaHistory(db: DatabaseSync, id: string, before?: number): MediaHistoryPage {
  findPrinter(db, id)
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new PrintValidationError('Enter a valid history cursor.')
  const rows = db.prepare('SELECT sequence, result_json FROM printer_media_changes WHERE printer_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT 26').all(id, before ?? Number.MAX_SAFE_INTEGER)
  return { changes: rows.slice(0, 25).map(row => (JSON.parse(String(row.result_json)) as { change: MediaChange }).change), nextBefore: rows.length > 25 ? Number(rows[24].sequence) : null }
}

export class RecordingPrintService implements PrintService {
  constructor(private db: DatabaseSync) {}
  listPrinters(): Printer[] {
    return this.db.prepare(`SELECT ${printerColumns} FROM printers ORDER BY name COLLATE NOCASE, id`).all().map(printerFromRow)
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
    if (!isValidPartNumber(expected.partNumber)) throw new PrintValidationError('Enter a valid part number.')
    const partNumber = expected.partNumber.trim()
    const requestedMedia = data.requestedMedia === undefined ? undefined : text(data.requestedMedia, 'requested material', 80)
    // Canonical field order makes retry comparison independent of JSON key order.
    const expectedProduct = Object.fromEntries(['partNumber', 'description', 'bulkFixedQuantity', 'packageFixedQuantity', 'productBarcode', 'bulkBarcode', 'status'].map(key => [key, expected[key]]))
    const requestJson = JSON.stringify({ printerId, type, product: expectedProduct, labelQuantity, printQuantity, lotNumber, poNumber: bulk ? poNumber : '', ...(requestedMedia === undefined ? {} : { requestedMedia }) })
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
      if (printer.mediaValidationEnabled) {
        if (!requestedMedia || !printer.supportedMedia.includes(requestedMedia)) throw new PrintValidationError('Choose a requested material from this printer’s configured supported media.')
        if (printer.currentMedia !== requestedMedia) throw new PrintValidationError('Please load the requested label stock before continuing.', 409, 'MEDIA_MISMATCH', { printerId, printerName: printer.name, requestedMedia, currentMedia: printer.currentMedia })
      }
      const job: PrintJob = { id: randomUUID(), requestId, status: 'recorded', createdAt: new Date().toISOString(), printer, printQuantity, ...(requestedMedia === undefined ? {} : { requestedMedia }),
        label: { templateVersion: 1, type, width: 3, height: bulk ? 5 : 2, product, quantity: labelQuantity, barcode, poNumber: bulk ? poNumber : '', lotNumber } }
      this.db.prepare('INSERT INTO print_jobs (id, request_id, request_json, printer_id, status, print_quantity, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(job.id, requestId, requestJson, printerId, job.status, printQuantity, JSON.stringify(job), job.createdAt)
      this.db.prepare('INSERT INTO print_job_events (job_id, event, created_at) VALUES (?, ?, ?)').run(job.id, 'recorded', job.createdAt)
      this.db.exec('COMMIT')
      return { job, created: true }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}

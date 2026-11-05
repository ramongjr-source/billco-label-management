import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { printLabelTypes, type PrintJob, type PrintLabelType } from '../shared/printing.js'
import type { SatoCommand, SatoElement, SatoHistoryPage, SatoIssue } from '../shared/sato.js'
import { PrintValidationError, resolveLabelProduct } from './printService.js'

const ESC = '\u001b'
const command = (value: string) => ESC + value
const dots = (value: number) => String(value).padStart(4, '0')

/** Validate the serialized subset of SBPL this template emits, including data parity. */
export function validateSatoCommands(payload: string, elements: SatoElement[], heightDots: number, copies: number): SatoIssue[] {
  const issues: SatoIssue[] = []
  const fail = (field: string, message: string) => issues.push({ field, code: 'INVALID_COMMAND', message })
  const tokens = payload.split(ESC)
  if (tokens.shift() !== '') fail('command', 'The payload must begin with ESC.')
  if (tokens.shift() !== 'A' || tokens.shift() !== `A1V${dots(heightDots)}H0609` || tokens.shift() !== '%0') fail('command', 'Invalid SBPL framing, media dimensions, or orientation.')
  for (const element of elements) {
    if (tokens.shift() !== `H${dots(element.x)}` || tokens.shift() !== `V${dots(element.y)}`) fail(element.field, 'Position does not match the validated layout.')
    if (element.kind === 'barcode') {
      const token = tokens.shift() ?? ''
      const parsed = /^BG02(\d{3})>H([\x20-\x7e]+)$/.exec(token)
      if (!parsed || Number(parsed[1]) !== element.height || parsed[2] !== element.value || parsed[2].includes('>')) fail('barcode', 'Encoded Code 128 data or parameters do not match the label value.')
    } else {
      if (tokens.shift() !== `L0${element.scale}0${element.scale}` || tokens.shift() !== `${element.font}${element.value}`) fail(element.field, 'Resident-font text does not match the complete label value.')
    }
  }
  if (tokens.shift() !== `Q${String(copies).padStart(6, '0')}` || tokens.shift() !== 'Z' || tokens.length) fail('command', 'Invalid copy count, end command, or unexpected trailing commands.')
  return issues
}

/** SBPL standard protocol, resident fixed pitch fonts, Code 128 subset B.
 * No transport, printer registry, or connection-test dependency. */
export function generateSato(label: PrintJob['label'], printQuantity: number): Omit<SatoCommand, 'id' | 'requestId' | 'createdAt'> {
  const compact = label.height === 2
  const heightDots = compact ? 406 : 1015
  const elements: SatoElement[] = []
  const issues: SatoIssue[] = []
  const issue = (field: string, code: string, message: string) => {
    if (!issues.some(existing => existing.field === field && existing.code === code)) issues.push({ field, code, message })
  }
  function text(field: string, value: string, y: number, font: 'XM' | 'XS' = 'XS', scale = 1, x = 24) {
    const size = (font === 'XM' ? 24 : 17) * scale
    elements.push({ field, kind: 'text', value, x, y, width: value.length * size, height: size, font, scale })
  }
  function lines(field: string, value: string, y: number, maxLines: number) {
    // Split at fixed character boundaries: joining these runs recovers every byte,
    // including spaces, fractions and inch marks. Never ellipsize or trim.
    const runs = value.match(/[\s\S]{1,33}/g) ?? ['']
    runs.forEach((run, index) => text(field, run, y + index * 22))
    if (runs.length > maxLines) issue(field, 'FIELD_OVERFLOW', `${field} needs ${runs.length} lines; this ${label.width}×${label.height} layout allows ${maxLines}. Full text is preserved.`)
  }
  text('brand', 'BILLCO CORPORATION', 20, 'XS')
  text('partHeading', 'PART #', compact ? 54 : 88)
  text('partNumber', label.product.partNumber, compact ? 78 : 116, 'XM', label.product.partNumber.length <= 11 ? 2 : 1)
  text('descriptionHeading', 'DESCRIPTION', compact ? 140 : 204)
  lines('description', label.product.description, compact ? 162 : 230, compact ? 3 : 8)
  text('quantity', `QTY ${label.quantity}`, compact ? 234 : 465, label.product.partNumber.length <= 11 ? 'XM' : 'XS')
  if (!compact) {
    text('poHeading', 'PO #', 530)
    lines('poNumber', label.poNumber, 552, 2)
  }
  text('lotHeading', 'LOT #', compact ? 266 : 620)
  lines('lotNumber', label.lotNumber, compact ? 285 : 642, compact ? 1 : 2)
  if (label.barcode !== null) {
    const value = label.barcode
    // Subset B: start + n data + checksum (11 modules each), stop (13),
    // and a ten-module quiet zone at both ends. Module width is two dots.
    const width = (11 * (value.length + 2) + 13) * 2
    const x = Math.floor((609 - width) / 2)
    elements.push({ field: 'barcode', kind: 'barcode', value, x, y: compact ? 316 : 760, width, height: compact ? 38 : 120 })
    if (x < 20) issue('barcode', 'BARCODE_OVERFLOW', 'Code 128 with its quiet zones exceeds the label width at a two-dot module width.')
    // SBPL uses > as a Code 128 invocation character. Reject rather than silently
    // interpreting imported data as subset switches/function codes.
    if (!value.length || /[^\x20-\x7e]|>/.test(value)) issue('barcode', 'BARCODE_ENCODING', 'Code 128 subset B requires printable ASCII without the SBPL invocation character (>).')
    text('barcodeText', value, compact ? 368 : 912, 'XS', 1, Math.floor((609 - value.length * 17) / 2))
  }
  for (const element of elements) {
    if (/[^\x20-\x7e]/.test(element.value)) issue(element.field, 'UNSUPPORTED_TEXT', 'Resident SBPL fonts support printable ASCII in this template. The original value is preserved; no replacement payload is generated.')
    if (element.x < 20 || element.y < 20 || element.x + element.width > 589 || element.y + element.height > heightDots - 20) issue(element.field, 'LABEL_BOUNDS', `${element.field} exceeds the printable area (20-dot margins).`)
  }
  for (let index = 0; index < elements.length; index++) {
    const a = elements[index]
    for (const b of elements.slice(index + 1)) {
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) issue(a.field, 'FIELD_OVERLAP', `${a.field} overlaps ${b.field}.`)
    }
  }
  const barcode = elements.find(element => element.kind === 'barcode')
  const readable = elements.find(element => element.field === 'barcodeText')
  if (barcode?.value !== readable?.value) issue('barcodeText', 'BARCODE_MISMATCH', 'Human-readable text must exactly match the encoded barcode value.')
  if (!Number.isSafeInteger(printQuantity) || printQuantity < 1 || printQuantity > 999999) issue('printQuantity', 'INVALID_QUANTITY', 'Copies must be an integer from 1 to 999999.')
  // Every command is separated by ESC, never by inserted printable newlines.
  let payload = issues.length ? null : command('A') + command(`A1V${dots(heightDots)}H0609`) + command('%0')
    + elements.map(element => command(`H${dots(element.x)}`) + command(`V${dots(element.y)}`)
      + (element.kind === 'barcode' ? command(`BG02${String(element.height).padStart(3, '0')}>H${element.value}`)
        : command(`L0${element.scale}0${element.scale}`) + command(`${element.font}${element.value}`))).join('')
    + command(`Q${String(printQuantity).padStart(6, '0')}`) + command('Z')
  if (payload !== null) {
    issues.push(...validateSatoCommands(payload, elements, heightDots, printQuantity))
    if (issues.length) payload = null
  }
  return { templateVersion: 1, model: 'SATO CL4NX Plus', dpi: 203, widthDots: 609, heightDots, label, printQuantity, elements, issues, valid: issues.length === 0, payload }
}

export class SatoCommandService {
  constructor(private db: DatabaseSync) {}
  generate(input: unknown): { command: SatoCommand; created: boolean } {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PrintValidationError('Enter a valid command request.')
    const data = input as Record<string, unknown>
    const requiredText = (value: unknown, name: string, max: number, required = true) => {
      if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (required && !value.trim())) throw new PrintValidationError(`Enter a valid ${name}.`)
      return value.trim()
    }
    const requestId = requiredText(data.requestId, 'request ID', 64)
    if (!printLabelTypes.includes(data.labelType as PrintLabelType)) throw new PrintValidationError('Choose a supported label type.')
    const type = data.labelType as PrintLabelType
    const bulk = type === 'bulk-fixed' || type === 'bulk-variable'
    const integer = (value: unknown) => {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 999999) throw new PrintValidationError('Quantity must be a whole number from 1 to 999999.')
      return value
    }
    const quantity = integer(data.labelQuantity)
    const printQuantity = integer(data.printQuantity)
    const poNumber = requiredText(data.poNumber, 'PO number', 32, bulk)
    const lotNumber = requiredText(data.lotNumber, 'lot number', 32)
    if (!data.product || typeof data.product !== 'object' || Array.isArray(data.product)) throw new PrintValidationError('Choose an active product.')
    const expected = data.product as Record<string, unknown>
    const productKeys = ['partNumber', 'description', 'bulkFixedQuantity', 'packageFixedQuantity', 'productBarcode', 'bulkBarcode', 'status']
    const requestJson = JSON.stringify({ type, quantity, printQuantity, poNumber: bulk ? poNumber : '', lotNumber, product: Object.fromEntries(productKeys.map(key => [key, expected[key]])) })
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const previous = this.db.prepare('SELECT request_json, snapshot_json FROM sato_commands WHERE request_id = ?').get(requestId)
      if (previous) {
        if (previous.request_json !== requestJson) throw new PrintValidationError('This request ID was already used for different command details.', 409)
        this.db.exec('COMMIT')
        return { command: JSON.parse(String(previous.snapshot_json)), created: false }
      }
      const { product, barcode } = resolveLabelProduct(this.db, expected, type, quantity)
      const label: PrintJob['label'] = { templateVersion: 1, type, width: 3, height: bulk ? 5 : 2, product, quantity, barcode, poNumber: bulk ? poNumber : '', lotNumber }
      const result: SatoCommand = { ...generateSato(label, printQuantity), id: randomUUID(), requestId, createdAt: new Date().toISOString() }
      this.db.prepare('INSERT INTO sato_commands (id, request_id, request_json, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)').run(result.id, requestId, requestJson, JSON.stringify(result), result.createdAt)
      this.db.exec('COMMIT')
      return { command: result, created: true }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  listHistory(before?: number): SatoHistoryPage {
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new PrintValidationError('Enter a valid history cursor.')
    const rows = this.db.prepare('SELECT sequence, snapshot_json FROM sato_commands WHERE sequence < ? ORDER BY sequence DESC LIMIT 26').all(before ?? Number.MAX_SAFE_INTEGER)
    return { commands: rows.slice(0, 25).map(row => JSON.parse(String(row.snapshot_json)) as SatoCommand), nextBefore: rows.length > 25 ? Number(rows[24].sequence) : null }
  }
}

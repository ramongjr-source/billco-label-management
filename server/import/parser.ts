import ExcelJS from 'exceljs'
import { Readable } from 'node:stream'
import type { Product } from '../../shared/product.js'
import type { ImportField, ProductImportColumns, ProductImportError, ProductImportMapping } from '../../shared/productImport.js'
import { WorkbookImportError } from './errors.js'
import { validateWorkbookArchive } from './zip.js'

const MAX_DATA_ROWS = 5000
const MAX_HEADER_ROWS = MAX_DATA_ROWS + 1

type Field = ImportField | 'description'
type Header = Field | `description${1 | 2 | 3 | 4 | 5}`

const fieldLabels: Record<Field, string> = {
  partNumber: 'Part Number',
  description: 'Description',
  bulkFixedQuantity: 'Bulk Fixed Quantity',
  packageFixedQuantity: 'Package Fixed Quantity',
  productBarcode: 'Product Barcode',
  bulkBarcode: 'Bulk Barcode',
  status: 'Status',
}

const aliases: Record<string, Header> = {
  pn: 'partNumber',
  partnumber: 'partNumber',
  'billcopart#': 'partNumber',
  description: 'description',
  bulkfixedquantity: 'bulkFixedQuantity',
  bulkqty: 'bulkFixedQuantity',
  packagefixedquantity: 'packageFixedQuantity',
  stdpackqty: 'packageFixedQuantity',
  barcodevalue: 'productBarcode',
  productbarcode: 'productBarcode',
  bulkbarcode: 'bulkBarcode',
  status: 'status',
  description1: 'description1',
  description2: 'description2',
  description3: 'description3',
  description4: 'description4',
  description5: 'description5',
}

export interface ParsedProductImport {
  sheetName: string
  sheetNames: string[]
  totalRows: number
  blankRows: number
  invalidRows: number
  rows: Array<{ row: number, product: Product }>
  errors: ProductImportError[]
  providedFields: { bulkBarcode: boolean; status: boolean }
}

function isFormula(value: ExcelJS.CellValue): boolean {
  return !!value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)
}

function richText(value: ExcelJS.CellValue): string | undefined {
  if (value && typeof value === 'object' && 'richText' in value) {
    return value.richText.map((fragment) => fragment.text).join('')
  }
  return undefined
}

function isBlank(value: ExcelJS.CellValue): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return !value.trim()
  const text = richText(value)
  return text !== undefined && !text.trim()
}

function rowIsBlank(row: ExcelJS.Row, columns?: Iterable<number>): boolean {
  if (columns) {
    for (const column of columns) {
      if (!isBlank(row.getCell(column).value)) return false
    }
    return true
  }
  let blank = true
  row.eachCell((cell) => { if (!isBlank(cell.value)) blank = false })
  return blank
}

function text(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (isFormula(value)) throw new Error('Formulas are not supported; replace this cell with its value.')
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  const formatted = richText(value)
  if (formatted !== undefined) return formatted
  throw new Error('Use a text cell for this field.')
}

function identifier(cell: ExcelJS.Cell): string {
  if (typeof cell.value !== 'number') return text(cell)
  const value = cell.value
  if (!Number.isSafeInteger(value) || Math.abs(value).toString().length > 15) {
    throw new Error('Numeric identifiers must be safe integers of at most 15 digits; store this identifier as text.')
  }
  const format = cell.numFmt || 'General'
  if (format === 'General') return String(value)
  if (/^0+$/.test(format)) {
    const digits = Math.abs(value).toString().padStart(format.length, '0')
    return value < 0 ? `-${digits}` : digits
  }
  throw new Error('This numeric identifier format is not supported; store the identifier as text to preserve it.')
}

function descriptionText(cell: ExcelJS.Cell): string {
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) return String(cell.value)
  return text(cell)
}

function quantity(cell: ExcelJS.Cell): number | null {
  if (isBlank(cell.value)) return null
  const raw = typeof cell.value === 'number' ? cell.value : text(cell).trim()
  const value = typeof raw === 'number' ? raw : /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isInteger(value) || value < 1 || value > 999999) {
    throw new Error('Enter a whole-number quantity from 1 to 999999.')
  }
  return value
}

function label(header: Header): string {
  return header.startsWith('description') && header !== 'description'
    ? `Description ${header.slice(-1)}`
    : fieldLabels[header as Field]
}

async function loadWorksheet(buffer: Buffer, requestedSheet?: string) {
  await validateWorkbookArchive(buffer)
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.read(Readable.from(buffer))
  } catch {
    throw new WorkbookImportError('The workbook could not be read. Upload a valid .xlsx file.')
  }
  const sheetNames = workbook.worksheets.map((sheet) => sheet.name)
  const sheet = requestedSheet === undefined ? workbook.getWorksheet('BillcoMaster') ?? workbook.worksheets[0] : workbook.getWorksheet(requestedSheet)
  if (!sheet) throw new WorkbookImportError('Choose an available worksheet.', sheetNames)
  const lastRow = sheet.rowCount
  if (lastRow > MAX_HEADER_ROWS + MAX_DATA_ROWS) {
    throw new WorkbookImportError('The worksheet exceeds the 5000 data-row limit.', sheetNames)
  }
  let headerRow = 0
  for (let row = 1; row <= Math.min(lastRow, MAX_HEADER_ROWS); row += 1) {
    if (!rowIsBlank(sheet.getRow(row))) {
      headerRow = row
      break
    }
  }
  if (!headerRow) throw new WorkbookImportError('The worksheet has no header row within the first 5001 rows.', sheetNames)
  if (lastRow - headerRow > MAX_DATA_ROWS) {
    throw new WorkbookImportError('The worksheet exceeds the 5000 data-row limit.', sheetNames)
  }
  return { sheet, sheetNames, headerRow, lastRow }
}

function detectHeaders(sheet: ExcelJS.Worksheet, headerRow: number, sheetNames: string[], strict = true) {
  const headers = new Map<Header, number>()
  const ambiguous = new Set<Header>()
  sheet.getRow(headerRow).eachCell((cell, column) => {
    let headerText: string
    try {
      headerText = typeof cell.value === 'number' ? String(cell.value) : text(cell)
    } catch {
      return // Unrelated columns, including formula headers, are ignored.
    }
    const normalized = headerText.trim().replace(/[\s_]+/g, '').toLowerCase()
    const canonical = Object.hasOwn(aliases, normalized) ? aliases[normalized] : undefined
    if (!canonical) return
    if (ambiguous.has(canonical)) return
    if (headers.has(canonical)) {
      if (strict) throw new WorkbookImportError(`Duplicate header for ${label(canonical)}. Keep one column for each field.`, sheetNames)
      headers.delete(canonical)
      ambiguous.add(canonical)
      return
    }
    headers.set(canonical, column)
  })
  return headers
}

export async function inspectProductWorkbook(buffer: Buffer, requestedSheet?: string): Promise<ProductImportColumns> {
  const { sheet, sheetNames, headerRow } = await loadWorksheet(buffer, requestedSheet)
  const columns: ProductImportColumns['columns'] = []
  sheet.getRow(headerRow).eachCell((cell, index) => {
    if (isBlank(cell.value)) return
    let header: string
    try { header = typeof cell.value === 'number' ? String(cell.value) : text(cell).trim() } catch { header = `Column ${index}` }
    columns.push({ index, header: header || `Column ${index}` })
  })
  const headers = detectHeaders(sheet, headerRow, sheetNames, false)
  const mapping: ProductImportMapping = { descriptionColumns: [] }
  for (const field of ['partNumber', 'bulkFixedQuantity', 'packageFixedQuantity', 'productBarcode', 'bulkBarcode', 'status'] as const) {
    if (headers.has(field)) mapping[field] = headers.get(field)
  }
  const fragments = [1, 2, 3, 4, 5].map((n) => headers.get(`description${n}` as Header)).filter((n): n is number => n !== undefined)
  mapping.descriptionColumns = fragments.length ? fragments : headers.has('description') ? [headers.get('description')!] : []
  return { sheetName: sheet.name, sheetNames, columns, mapping }
}

function mappedHeaders(mapping: unknown, sheet: ExcelJS.Worksheet, headerRow: number, sheetNames: string[]) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new WorkbookImportError('Supply a valid column mapping.', sheetNames)
  const fields = ['partNumber', 'bulkFixedQuantity', 'packageFixedQuantity', 'productBarcode', 'bulkBarcode', 'status'] as const
  const values = mapping as Record<string, unknown>
  if (Object.keys(values).some((key) => ![...fields, 'descriptionColumns'].includes(key as ImportField))) throw new WorkbookImportError('Unknown mapping field.', sheetNames)
  const descriptions = values.descriptionColumns
  if (!Array.isArray(descriptions) || !descriptions.length || descriptions.length > 5) throw new WorkbookImportError('Map one to five description columns.', sheetNames)
  const headers = new Map<Header, number>()
  const used = new Set<number>()
  const add = (field: Header, column: unknown) => {
    if (!Number.isInteger(column) || typeof column !== 'number' || column < 1 || column > 16384
      || isBlank(sheet.getRow(headerRow).getCell(column).value)) throw new WorkbookImportError(`Choose an available column for ${label(field)}.`, sheetNames)
    if (used.has(column)) throw new WorkbookImportError('Each source column can be mapped only once.', sheetNames)
    used.add(column)
    headers.set(field, column)
  }
  for (const field of fields) if (values[field] !== undefined) add(field, values[field])
  descriptions.forEach((column, index) => add(`description${index + 1}` as Header, column))
  return headers
}

export async function parseProductWorkbook(buffer: Buffer, requestedSheet?: string, mapping?: unknown): Promise<ParsedProductImport> {
  const { sheet, sheetNames, headerRow, lastRow } = await loadWorksheet(buffer, requestedSheet)
  const headers = mapping === undefined ? detectHeaders(sheet, headerRow, sheetNames) : mappedHeaders(mapping, sheet, headerRow, sheetNames)
  const required: Field[] = ['partNumber', 'bulkFixedQuantity', 'packageFixedQuantity', 'productBarcode']
  // Legacy Barcode Value files remain readable. BillcoMaster's separate bulk
  // field must be mapped for the primary production worksheet.
  if (sheet.name === 'BillcoMaster') required.push('bulkBarcode')
  const missing = required.filter((field) => !headers.has(field)).map((field) => fieldLabels[field])
  if (!headers.has('description') && ![1, 2, 3, 4, 5].some((index) => headers.has(`description${index}` as Header))) {
    missing.push('Description (or Description1–Description5)')
  }
  if (missing.length) throw new WorkbookImportError(`Missing required headers: ${missing.join(', ')}.`, sheetNames)

  const candidates: Array<{ row: number, product: Product, errors: ProductImportError[] }> = []
  let blankRows = 0
  for (let rowNumber = headerRow + 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    if (rowIsBlank(row, headers.values())) {
      blankRows += 1
      continue
    }
    const errors: ProductImportError[] = []
    const addError = (field: string, message: string) => errors.push({ row: rowNumber, field, message })
    const read = <T>(field: Header, reader: (cell: ExcelJS.Cell) => T, fallback: T): T => {
      const column = headers.get(field)
      if (column === undefined) return fallback
      try {
        return reader(row.getCell(column))
      } catch (error) {
        addError(label(field), error instanceof Error ? error.message : 'Invalid cell value.')
        return fallback
      }
    }

    const partNumber = read('partNumber', identifier, '').trim()
    if (!partNumber || [...partNumber].length > 64 || /[\u0000-\u001f\u007f]/.test(partNumber)) {
      if (!errors.some((error) => error.field === fieldLabels.partNumber)) {
        addError(fieldLabels.partNumber, 'Enter a nonblank part number of at most 64 characters without control characters.')
      }
    }

    const directDescription = read('description', descriptionText, '').trim()
    const descriptionParts = [1, 2, 3, 4, 5].map((index) => read(`description${index}` as Header, descriptionText, '').trim()).filter(Boolean)
    const legacyDescription = descriptionParts.join(' ')
    const description = legacyDescription || directDescription
    if (legacyDescription && directDescription && legacyDescription !== directDescription) {
      addError(fieldLabels.description, 'Description differs from the combined Description1–Description5 fields. Use matching values or only one source.')
    }
    if (!description || [...description].length > 512 || description.includes('\0')) {
      if (!errors.some((error) => error.field.startsWith('Description'))) {
        addError(fieldLabels.description, 'Enter a nonblank description of at most 512 characters without NUL characters.')
      }
    }

    const bulkFixedQuantity = read('bulkFixedQuantity', quantity, null)
    const packageFixedQuantity = read('packageFixedQuantity', quantity, null)
    const productBarcode = read('productBarcode', identifier, '')
    if (productBarcode !== '' && (!productBarcode.trim() || productBarcode.length > 128 || /[^\x20-\x7e]/.test(productBarcode))) {
      if (!errors.some((error) => error.field === fieldLabels.productBarcode)) {
        addError(fieldLabels.productBarcode, 'Enter a nonblank printable ASCII barcode of at most 128 characters. It must come directly from this workbook.')
      }
    }
    const bulkBarcode = read('bulkBarcode', identifier, '')
    if (bulkBarcode !== '' && (!bulkBarcode.trim() || bulkBarcode.length > 128 || /[^\x20-\x7e]/.test(bulkBarcode))) {
      if (!errors.some((error) => error.field === fieldLabels.bulkBarcode)) addError(fieldLabels.bulkBarcode, 'Enter a nonblank printable ASCII bulk barcode of at most 128 characters from this workbook.')
    }
    const statusText = read('status', text, 'active').trim().toLowerCase()
    if (statusText !== 'active' && statusText !== 'inactive') {
      if (!errors.some((error) => error.field === fieldLabels.status)) {
        addError(fieldLabels.status, 'Status must be Active or Inactive.')
      }
    }
    const product: Product = {
      partNumber,
      description,
      bulkFixedQuantity,
      packageFixedQuantity,
      productBarcode,
      bulkBarcode,
      status: statusText as Product['status'],
    }
    for (const error of errors) if (partNumber) error.partNumber = partNumber
    candidates.push({ row: rowNumber, product, errors })
  }

  const occurrences = new Map<string, number>()
  for (const { product } of candidates) {
    if (product.partNumber) occurrences.set(product.partNumber, (occurrences.get(product.partNumber) ?? 0) + 1)
  }
  for (const candidate of candidates) {
    if ((occurrences.get(candidate.product.partNumber) ?? 0) > 1) {
      candidate.errors.push({
        row: candidate.row,
        partNumber: candidate.product.partNumber,
        field: fieldLabels.partNumber,
        message: 'This part number appears more than once in the worksheet. Every duplicate occurrence is skipped.',
      })
    }
  }

  return {
    sheetName: sheet.name,
    sheetNames,
    totalRows: lastRow - headerRow,
    blankRows,
    invalidRows: candidates.filter((candidate) => candidate.errors.length > 0).length,
    rows: candidates.filter((candidate) => candidate.errors.length === 0).map(({ row, product }) => ({ row, product })),
    errors: candidates.flatMap((candidate) => candidate.errors),
    providedFields: { bulkBarcode: headers.has('bulkBarcode'), status: headers.has('status') },
  }
}

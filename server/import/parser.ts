import ExcelJS from 'exceljs'
import { Readable } from 'node:stream'
import type { Product } from '../../shared/product.js'
import type { ProductImportError } from '../../shared/productImport.js'
import { WorkbookImportError } from './errors.js'
import { validateWorkbookArchive } from './zip.js'

const MAX_DATA_ROWS = 5000
const MAX_COLUMNS = 64
const MAX_HEADER_ROWS = MAX_DATA_ROWS + 1

type Field = 'partNumber' | 'description' | 'bulkFixedQuantity' | 'packageFixedQuantity' | 'barcodeValue' | 'status'
type Header = Field | `description${1 | 2 | 3 | 4 | 5}`

const fieldLabels: Record<Field, string> = {
  partNumber: 'Part Number',
  description: 'Description',
  bulkFixedQuantity: 'Bulk Fixed Quantity',
  packageFixedQuantity: 'Package Fixed Quantity',
  barcodeValue: 'Barcode Value',
  status: 'Status',
}

const aliases: Record<string, Header> = {
  pn: 'partNumber',
  partnumber: 'partNumber',
  description: 'description',
  bulkfixedquantity: 'bulkFixedQuantity',
  packagefixedquantity: 'packageFixedQuantity',
  barcodevalue: 'barcodeValue',
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

function rowIsBlank(row: ExcelJS.Row, columns: number): boolean {
  for (let column = 1; column <= columns; column += 1) {
    if (!isBlank(row.getCell(column).value)) return false
  }
  return true
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

function quantity(cell: ExcelJS.Cell): number {
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

export async function parseProductWorkbook(buffer: Buffer, requestedSheet?: string): Promise<ParsedProductImport> {
  await validateWorkbookArchive(buffer)
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.read(Readable.from(buffer))
  } catch {
    throw new WorkbookImportError('The workbook could not be read. Upload a valid .xlsx file.')
  }
  const sheetNames = workbook.worksheets.map((sheet) => sheet.name)
  const sheet = requestedSheet === undefined ? workbook.worksheets[0] : workbook.getWorksheet(requestedSheet)
  if (!sheet) throw new WorkbookImportError('Choose an available worksheet.', sheetNames)
  const lastRow = sheet.rowCount
  if (lastRow > MAX_HEADER_ROWS + MAX_DATA_ROWS) {
    throw new WorkbookImportError('The worksheet exceeds the 5000 data-row limit.', sheetNames)
  }
  const columns = Math.max(sheet.columnCount, sheet.columns?.length ?? 0)
  if (columns > MAX_COLUMNS) throw new WorkbookImportError('The worksheet exceeds the 64-column limit.', sheetNames)

  let headerRow = 0
  for (let row = 1; row <= Math.min(lastRow, MAX_HEADER_ROWS); row += 1) {
    if (!rowIsBlank(sheet.getRow(row), columns)) {
      headerRow = row
      break
    }
  }
  if (!headerRow) throw new WorkbookImportError('The worksheet has no header row within the first 5001 rows.', sheetNames)
  if (lastRow - headerRow > MAX_DATA_ROWS) {
    throw new WorkbookImportError('The worksheet exceeds the 5000 data-row limit.', sheetNames)
  }

  const headers = new Map<Header, number>()
  const mappedColumns = new Set<number>()
  for (let column = 1; column <= columns; column += 1) {
    const cell = sheet.getRow(headerRow).getCell(column)
    if (isFormula(cell.value)) throw new WorkbookImportError('Header formulas are not supported; use text headers.', sheetNames)
    let headerText: string
    try {
      headerText = typeof cell.value === 'number' ? String(cell.value) : text(cell)
    } catch {
      continue // Unrecognized extra columns do not need a text header.
    }
    const normalized = headerText.trim().replace(/[\s_]+/g, '').toLowerCase()
    const canonical = Object.hasOwn(aliases, normalized) ? aliases[normalized] : undefined
    if (!canonical) continue
    if (headers.has(canonical)) {
      throw new WorkbookImportError(`Duplicate header for ${label(canonical)}. Keep one column for each field.`, sheetNames)
    }
    headers.set(canonical, column)
    mappedColumns.add(column)
  }
  const required: Field[] = ['partNumber', 'bulkFixedQuantity', 'packageFixedQuantity', 'barcodeValue', 'status']
  const missing = required.filter((field) => !headers.has(field)).map((field) => fieldLabels[field])
  if (!headers.has('description') && ![1, 2, 3, 4, 5].some((index) => headers.has(`description${index}` as Header))) {
    missing.push('Description (or Description1–Description5)')
  }
  if (missing.length) throw new WorkbookImportError(`Missing required headers: ${missing.join(', ')}.`, sheetNames)

  const candidates: Array<{ row: number, product: Product, errors: ProductImportError[] }> = []
  let blankRows = 0
  for (let rowNumber = headerRow + 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    if (rowIsBlank(row, columns)) {
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

    const bulkFixedQuantity = read('bulkFixedQuantity', quantity, 0)
    const packageFixedQuantity = read('packageFixedQuantity', quantity, 0)
    const barcodeValue = read('barcodeValue', identifier, '')
    if (!barcodeValue.trim() || barcodeValue.length > 128 || /[^\x20-\x7e]/.test(barcodeValue)) {
      if (!errors.some((error) => error.field === fieldLabels.barcodeValue)) {
        addError(fieldLabels.barcodeValue, 'Enter a nonblank printable ASCII barcode of at most 128 characters. It must come directly from this workbook.')
      }
    }
    const statusText = read('status', text, '').trim().toLowerCase()
    if (statusText !== 'active' && statusText !== 'inactive') {
      if (!errors.some((error) => error.field === fieldLabels.status)) {
        addError(fieldLabels.status, 'Status must be Active or Inactive.')
      }
    }
    for (let column = 1; column <= columns; column += 1) {
      if (!mappedColumns.has(column) && isFormula(row.getCell(column).value)) {
        addError(`Column ${column}`, 'Formulas are not supported; replace this cell with its value.')
      }
    }

    const product: Product = {
      partNumber,
      description,
      bulkFixedQuantity,
      packageFixedQuantity,
      barcodeValue,
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
  }
}

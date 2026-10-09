import type { Product } from './product.js'

export type ImportField = 'partNumber' | 'bulkFixedQuantity' | 'packageFixedQuantity' | 'productBarcode' | 'bulkBarcode' | 'status'

/** One-based worksheet column indices; description order is operator-selected. */
export type ProductImportMapping = Partial<Record<ImportField, number>> & { descriptionColumns: number[] }

export interface ProductImportColumns {
  sheetName: string
  sheetNames: string[]
  columns: Array<{ index: number; header: string }>
  mapping: ProductImportMapping
}

export interface ProductImportRow {
  row: number
  product: Product
  action: 'add' | 'update'
}

export interface ProductImportError {
  row: number
  partNumber?: string
  field: string
  message: string
}

export interface ProductImportPreview {
  sheetName: string
  sheetNames: string[]
  totalRows: number
  blankRows: number
  invalidRows: number
  added: number
  updated: number
  rows: ProductImportRow[]
  errors: ProductImportError[]
}

export type ProductImportResult = Omit<ProductImportPreview, 'rows'>

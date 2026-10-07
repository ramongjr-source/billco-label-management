import type { Product } from './product.js'

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

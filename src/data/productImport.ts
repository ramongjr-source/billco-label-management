import type { ProductImportColumns, ProductImportMapping, ProductImportPreview, ProductImportResult } from '../../shared/productImport.js'

export class ProductImportRequestError extends Error {
  readonly sheetNames?: string[]

  constructor(message: string, sheetNames?: string[]) {
    super(message)
    this.sheetNames = sheetNames
  }
}

async function requestImport<T>(path: string, file: File, sheetName: string, signal: AbortSignal, mapping?: ProductImportMapping): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  if (sheetName) form.append('sheetName', sheetName)
  if (mapping) form.append('mapping', JSON.stringify({ ...mapping, descriptionColumns: mapping.descriptionColumns.filter(Boolean) }))
  const response = await fetch(path, { method: 'POST', body: form, signal })
  if (!response.ok) {
    let details: { error?: unknown; sheetNames?: unknown } = {}
    try {
      const body: unknown = await response.json()
      if (body && typeof body === 'object') details = body
    } catch { /* The server may be unavailable. */ }
    const sheetNames = Array.isArray(details.sheetNames) && details.sheetNames.every((name) => typeof name === 'string') ? details.sheetNames : undefined
    const message = response.status < 500 && typeof details.error === 'string'
      ? details.error
      : 'Product import is unavailable. Please try again.'
    throw new ProductImportRequestError(message, sheetNames)
  }
  return response.json() as Promise<T>
}

export function inspectProductImport(file: File, sheetName: string, signal: AbortSignal): Promise<ProductImportColumns> {
  return requestImport('/api/products/import/columns', file, sheetName, signal)
}

export function previewProductImport(file: File, sheetName: string, signal: AbortSignal, mapping?: ProductImportMapping): Promise<ProductImportPreview> {
  return requestImport('/api/products/import/preview', file, sheetName, signal, mapping)
}

export function commitProductImport(file: File, sheetName: string, signal: AbortSignal, mapping?: ProductImportMapping): Promise<ProductImportResult> {
  return requestImport('/api/products/import', file, sheetName, signal, mapping)
}

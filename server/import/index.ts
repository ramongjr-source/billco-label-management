import type { DatabaseSync } from 'node:sqlite'
import type { ProductImportPreview, ProductImportResult, ProductImportRow } from '../../shared/productImport.js'
import type { Product } from '../../shared/product.js'
import { parseProductWorkbook } from './parser.js'

export { WorkbookImportError } from './errors.js'
export { inspectProductWorkbook } from './parser.js'

function effectiveProduct(product: Product, provided: { bulkBarcode: boolean; status: boolean }, existing?: Record<string, unknown>): Product {
  return { ...product,
    bulkBarcode: provided.bulkBarcode ? product.bulkBarcode : (existing?.bulkBarcode as string | undefined) ?? '',
    status: provided.status ? product.status : (existing?.status as Product['status'] | undefined) ?? 'active',
  }
}

export async function previewProductImport(db: DatabaseSync, buffer: Buffer, sheetName?: string, mapping?: unknown): Promise<ProductImportPreview> {
  const { providedFields, ...parsed } = await parseProductWorkbook(buffer, sheetName, mapping)
  const exists = db.prepare('SELECT bulk_barcode AS bulkBarcode, status FROM products WHERE part_number = ? COLLATE BINARY')
  const rows: ProductImportRow[] = parsed.rows.map(({ row, product }) => {
    const existing = exists.get(product.partNumber)
    return { row, product: effectiveProduct(product, providedFields, existing), action: existing ? 'update' : 'add' }
  })
  const added = rows.filter((row) => row.action === 'add').length
  return { ...parsed, rows, added, updated: rows.length - added }
}

export async function importProducts(db: DatabaseSync, buffer: Buffer, sheetName?: string, mapping?: unknown): Promise<ProductImportResult> {
  const { providedFields, ...parsed } = await parseProductWorkbook(buffer, sheetName, mapping)
  let added = 0
  let updated = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    const exists = db.prepare('SELECT bulk_barcode AS bulkBarcode, status FROM products WHERE part_number = ? COLLATE BINARY')
    const upsert = db.prepare(`
      INSERT INTO products (
        part_number, description, bulk_fixed_quantity, package_fixed_quantity, product_barcode, bulk_barcode, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(part_number) DO UPDATE SET
        description = excluded.description,
        bulk_fixed_quantity = excluded.bulk_fixed_quantity,
        package_fixed_quantity = excluded.package_fixed_quantity,
        product_barcode = excluded.product_barcode,
        bulk_barcode = excluded.bulk_barcode,
        status = excluded.status
    `)
    for (const row of parsed.rows) {
      const existing = exists.get(row.product.partNumber)
      const product = effectiveProduct(row.product, providedFields, existing)
      upsert.run(
        product.partNumber,
        product.description,
        product.bulkFixedQuantity,
        product.packageFixedQuantity,
        product.productBarcode,
        product.bulkBarcode,
        product.status,
      )
      if (existing) updated += 1
      else added += 1
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const { rows: _rows, ...report } = parsed
  return { ...report, added, updated }
}

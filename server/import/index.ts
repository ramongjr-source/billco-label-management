import type { DatabaseSync } from 'node:sqlite'
import type { ProductImportPreview, ProductImportResult, ProductImportRow } from '../../shared/productImport.js'
import { parseProductWorkbook } from './parser.js'

export { WorkbookImportError } from './errors.js'

export async function previewProductImport(db: DatabaseSync, buffer: Buffer, sheetName?: string): Promise<ProductImportPreview> {
  const parsed = await parseProductWorkbook(buffer, sheetName)
  const exists = db.prepare('SELECT 1 FROM products WHERE part_number = ? COLLATE BINARY')
  const rows: ProductImportRow[] = parsed.rows.map(({ row, product }) => ({
    row,
    product,
    action: exists.get(product.partNumber) ? 'update' : 'add',
  }))
  const added = rows.filter((row) => row.action === 'add').length
  return { ...parsed, rows, added, updated: rows.length - added }
}

export async function importProducts(db: DatabaseSync, buffer: Buffer, sheetName?: string): Promise<ProductImportResult> {
  const parsed = await parseProductWorkbook(buffer, sheetName)
  let added = 0
  let updated = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    const exists = db.prepare('SELECT 1 FROM products WHERE part_number = ? COLLATE BINARY')
    const upsert = db.prepare(`
      INSERT INTO products (
        part_number, description, bulk_fixed_quantity, package_fixed_quantity, barcode_value, status
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(part_number) DO UPDATE SET
        description = excluded.description,
        bulk_fixed_quantity = excluded.bulk_fixed_quantity,
        package_fixed_quantity = excluded.package_fixed_quantity,
        barcode_value = excluded.barcode_value,
        status = excluded.status
    `)
    for (const { product } of parsed.rows) {
      const existing = !!exists.get(product.partNumber)
      upsert.run(
        product.partNumber,
        product.description,
        product.bulkFixedQuantity,
        product.packageFixedQuantity,
        product.barcodeValue,
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

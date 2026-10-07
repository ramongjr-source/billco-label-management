import type { DatabaseSync } from 'node:sqlite'
import type { Product } from '../shared/product.js'

const products: Product[] = [
  { partNumber: '5080', description: '3/8 Brass Coupling', bulkFixedQuantity: 500, packageFixedQuantity: 50, barcodeValue: '5080', status: 'active' },
  { partNumber: '5081', description: '3/8 Brass Elbow', bulkFixedQuantity: 250, packageFixedQuantity: 25, barcodeValue: '5081', status: 'active' },
  { partNumber: '5082', description: '1/2 Brass Adapter', bulkFixedQuantity: 200, packageFixedQuantity: 20, barcodeValue: '5082', status: 'active' },
  { partNumber: '5083', description: 'BRASS COUPLING 3/8', bulkFixedQuantity: 120, packageFixedQuantity: 12, barcodeValue: 'BILLCO-5083', status: 'active' },
  { partNumber: '5090', description: 'Discontinued Brass Coupling', bulkFixedQuantity: 100, packageFixedQuantity: 10, barcodeValue: '5090', status: 'inactive' },
]

/** Explicit development data only. Existing products, including inactive ones, are never changed. */
export function seedProducts(db: DatabaseSync): number {
  const insert = db.prepare(`
    INSERT INTO products (
      part_number, description, bulk_fixed_quantity, package_fixed_quantity, barcode_value, status
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(part_number) DO NOTHING
  `)

  let inserted = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const product of products) {
      inserted += Number(insert.run(
        product.partNumber,
        product.description,
        product.bulkFixedQuantity,
        product.packageFixedQuantity,
        product.barcodeValue,
        product.status,
      ).changes)
    }
    db.exec('COMMIT')
    return inserted
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

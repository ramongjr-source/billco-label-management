import type { DatabaseSync } from 'node:sqlite'
import type { Product } from '../shared/product.js'
import { billcoMasterProducts } from './seeds/billco-master.js'

const products: Product[] = [
  { partNumber: '5080', description: '3/8 Brass Coupling', bulkFixedQuantity: 500, packageFixedQuantity: 50, productBarcode: '5080', bulkBarcode: '5080', status: 'active' },
  { partNumber: '5081', description: '3/8 Brass Elbow', bulkFixedQuantity: 250, packageFixedQuantity: 25, productBarcode: '5081', bulkBarcode: '5081', status: 'active' },
  { partNumber: '5082', description: '1/2 Brass Adapter', bulkFixedQuantity: 200, packageFixedQuantity: 20, productBarcode: '5082', bulkBarcode: '5082', status: 'active' },
  { partNumber: '5083', description: 'BRASS COUPLING 3/8', bulkFixedQuantity: 120, packageFixedQuantity: 12, productBarcode: 'BILLCO-5083', bulkBarcode: 'BILLCO-BULK-5083', status: 'active' },
  { partNumber: '5090', description: 'Discontinued Brass Coupling', bulkFixedQuantity: 100, packageFixedQuantity: 10, productBarcode: '5090', bulkBarcode: '5090', status: 'inactive' },
]

/** Explicit development data only. Existing products, including inactive ones, are never changed. */
export function seedProducts(db: DatabaseSync, records: readonly Product[] = products): number {
  const insert = db.prepare(`
    INSERT INTO products (
      part_number, description, bulk_fixed_quantity, package_fixed_quantity, product_barcode, bulk_barcode, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(part_number_key(part_number)) DO NOTHING
  `)

  let inserted = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const product of records) {
      inserted += Number(insert.run(
        product.partNumber,
        product.description,
        product.bulkFixedQuantity,
        product.packageFixedQuantity,
        product.productBarcode,
        product.bulkBarcode,
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

/** Real master data first; keep legacy examples for existing UI demonstrations. */
export function seedDevelopmentProducts(db: DatabaseSync): number {
  return seedProducts(db, [...billcoMasterProducts, ...products])
}

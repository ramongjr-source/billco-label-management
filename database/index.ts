import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Product } from '../shared/product.js'

export { seedProducts } from './seed.js'

const migrations = [
  { version: 1, filename: '001-create-products.sql' },
  { version: 2, filename: '002-separate-barcodes.sql' },
] as const

export function openProductDatabase(filename: string): DatabaseSync {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true })
  const db = new DatabaseSync(filename)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function migrateDatabase(db: DatabaseSync): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
  `)

  let count = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    // Re-read after obtaining the write lock so concurrent startup processes
    // cannot both attempt an already-applied migration.
    const applied = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()
    for (const row of applied) {
      const known = migrations.find((migration) => migration.version === row.version)
      if (!known || known.filename !== row.name) {
        throw new Error('The database schema is incompatible with this application version.')
      }
    }
    for (const migration of migrations) {
      if (applied.some((row) => row.version === migration.version)) continue
      const sql = readFileSync(new URL(`./migrations/${migration.filename}`, import.meta.url), 'utf8')
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(migration.version, migration.filename)
      count += 1
    }
    db.exec('COMMIT')
    return count
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function findProductByPartNumber(db: DatabaseSync, partNumber: string): Product | undefined {
  const row = db.prepare(`
    SELECT
      part_number AS partNumber,
      description,
      bulk_fixed_quantity AS bulkFixedQuantity,
      package_fixed_quantity AS packageFixedQuantity,
      product_barcode AS productBarcode,
      bulk_barcode AS bulkBarcode,
      status
    FROM products
    WHERE part_number = ? COLLATE BINARY
  `).get(partNumber.trim())
  if (!row) return undefined

  return {
    partNumber: row.partNumber as string,
    description: row.description as string,
    bulkFixedQuantity: row.bulkFixedQuantity as number | null,
    packageFixedQuantity: row.packageFixedQuantity as number | null,
    productBarcode: row.productBarcode as string,
    bulkBarcode: row.bulkBarcode as string,
    status: row.status as Product['status'],
  }
}

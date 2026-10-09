import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { findProductByPartNumber, migrateDatabase, openProductDatabase, seedProducts } from '../../database/index.js'

function database(t: TestContext): DatabaseSync {
  const db = openProductDatabase(':memory:')
  t.after(() => db.close())
  migrateDatabase(db)
  return db
}

const valid = ['P-0001', 'BRASS COUPLING 3/8', 120, 12, 'BARCODE-P-0001', 'active']

function insert(db: DatabaseSync, values: Array<string | number | null> = valid) {
  db.prepare(`
    INSERT INTO products
      (part_number, description, bulk_fixed_quantity, package_fixed_quantity, product_barcode, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(...values)
}

test('initial migration creates strict products and tracks its version once', (t) => {
  const db = openProductDatabase(':memory:')
  t.after(() => db.close())
  assert.equal(migrateDatabase(db), 2)
  assert.equal(migrateDatabase(db), 0)
  assert.deepEqual({ ...db.prepare('SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1').get() }, {
    version: 2,
    name: '002-separate-barcodes.sql',
  })
  assert.equal(db.prepare("SELECT strict FROM pragma_table_list WHERE name = 'products'").get()?.strict, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get()?.count, 0)
})

test('schema rejects duplicate part numbers and invalid required fields', (t) => {
  const db = database(t)
  insert(db)
  assert.throws(() => insert(db), /UNIQUE/)

  const invalid: Array<{ name: string, index: number, value: string | number | null }> = [
    { name: 'null part number', index: 0, value: null },
    { name: 'blank part number', index: 0, value: '' },
    { name: 'untrimmed part number', index: 0, value: ' P-0002 ' },
    { name: 'Unicode whitespace around a part number', index: 0, value: '\u00a0P-0002\ufeff' },
    { name: 'control character in part number', index: 0, value: 'P\n0002' },
    { name: 'NUL in part number', index: 0, value: 'P\0X' },
    { name: 'long part number', index: 0, value: 'P'.repeat(65) },
    { name: 'null description', index: 1, value: null },
    { name: 'blank description', index: 1, value: '\t  \n' },
    { name: 'Unicode whitespace-only description', index: 1, value: '\u00a0\u2007\ufeff' },
    { name: 'long description', index: 1, value: 'D'.repeat(513) },
    { name: 'zero bulk quantity', index: 2, value: 0 },
    { name: 'fractional bulk quantity', index: 2, value: 1.5 },
    { name: 'long bulk quantity', index: 2, value: 1000000 },
    { name: 'negative package quantity', index: 3, value: -1 },
    { name: 'fractional package quantity', index: 3, value: 2.5 },
    { name: 'text package quantity', index: 3, value: 'invalid' },
    { name: 'null barcode', index: 4, value: null },
    { name: 'blank barcode', index: 4, value: '   ' },
    { name: 'non-ASCII barcode', index: 4, value: 'BÁRCODE' },
    { name: 'control character in barcode', index: 4, value: 'BAR\nCODE' },
    { name: 'long barcode', index: 4, value: 'B'.repeat(129) },
    { name: 'null status', index: 5, value: null },
    { name: 'invalid status', index: 5, value: 'deleted' },
  ]
  for (const { name, index, value } of invalid) {
    const values: Array<string | number | null> = ['P-0002', ...valid.slice(1)]
    values[index] = value
    assert.throws(() => {
      db.prepare(`
        INSERT INTO products
          (part_number, description, bulk_fixed_quantity, package_fixed_quantity, product_barcode, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(...values)
    }, name)
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get()?.count, 1)
})

test('schema accepts valid maximum field lengths and quantity boundaries', (t) => {
  const db = database(t)
  const partNumber = 'P'.repeat(64)
  insert(db, [partNumber, 'D'.repeat(512), 1, 999999, 'B'.repeat(128), 'inactive'])
  assert.equal(findProductByPartNumber(db, partNumber)?.bulkFixedQuantity, 1)
  assert.equal(findProductByPartNumber(db, partNumber)?.packageFixedQuantity, 999999)
})

test('lookup preserves textual leading zeros, exact case, combined descriptions, and barcode values', (t) => {
  const db = database(t)
  insert(db, ['005080', 'BRASS COUPLING 3/8', 120, 12, 'BILLCO-5083', 'active'])
  insert(db, ['ABC-01', 'Upper case', 10, 1, 'UPPER', 'active'])
  insert(db, ['abc-01', 'Lower case', 20, 2, 'LOWER', 'inactive'])

  assert.deepEqual(findProductByPartNumber(db, ' 005080 '), {
    partNumber: '005080',
    description: 'BRASS COUPLING 3/8',
    bulkFixedQuantity: 120,
    packageFixedQuantity: 12,
    productBarcode: 'BILLCO-5083',
    bulkBarcode: '',
    status: 'active',
  })
  assert.equal(findProductByPartNumber(db, '5080'), undefined)
  assert.equal(findProductByPartNumber(db, 'ABC-01')?.description, 'Upper case')
  assert.equal(findProductByPartNumber(db, 'abc-01')?.status, 'inactive')
  assert.equal(findProductByPartNumber(db, 'Abc-01'), undefined)
})

test('bound lookup never treats an operator input as SQL', (t) => {
  const db = database(t)
  seedProducts(db)
  assert.equal(findProductByPartNumber(db, "5080' OR 1=1 --"), undefined)
  const partNumber = "X' OR 1=1 --"
  insert(db, [partNumber, 'Literal punctuation', 10, 1, 'LITERAL', 'active'])
  assert.equal(findProductByPartNumber(db, partNumber)?.partNumber, partNumber)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get()?.count, 6)
})

test('explicit seeding is idempotent and never overwrites or reactivates existing products', (t) => {
  const db = database(t)
  assert.equal(seedProducts(db), 5)
  db.prepare(`
    UPDATE products
    SET description = ?, bulk_fixed_quantity = ?, package_fixed_quantity = ?, product_barcode = ?, status = ?
    WHERE part_number = ?
  `).run('Maintained master record', 777, 77, 'MASTER-5080', 'inactive', '5080')
  assert.equal(seedProducts(db), 0)
  assert.deepEqual(findProductByPartNumber(db, '5080'), {
    partNumber: '5080',
    description: 'Maintained master record',
    bulkFixedQuantity: 777,
    packageFixedQuantity: 77,
    productBarcode: 'MASTER-5080',
    bulkBarcode: '5080',
    status: 'inactive',
  })
  assert.equal(findProductByPartNumber(db, '5090')?.status, 'inactive')
})

test('file-backed products persist across closing, reopening, migrating, and seeding', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'billco-database-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, 'nested', 'products.sqlite')
  let db = openProductDatabase(filename)
  try {
    migrateDatabase(db)
    seedProducts(db)
    db.prepare('UPDATE products SET description = ?, status = ? WHERE part_number = ?')
      .run('Persisted inactive description', 'inactive', '5080')
  } finally {
    db.close()
  }

  db = openProductDatabase(filename)
  try {
    assert.equal(migrateDatabase(db), 0)
    assert.equal(seedProducts(db), 0)
    assert.equal(findProductByPartNumber(db, '5080')?.description, 'Persisted inactive description')
    assert.equal(findProductByPartNumber(db, '5080')?.status, 'inactive')
  } finally {
    db.close()
  }
})

test('migration refuses a schema from an incompatible application version', (t) => {
  const db = database(t)
  db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(3, 'future.sql')
  assert.throws(() => migrateDatabase(db), /incompatible/)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get()?.count, 0)
})

test('legacy migration preserves product records and never invents a bulk barcode', (t) => {
  const db = openProductDatabase(':memory:')
  t.after(() => db.close())
  db.exec(readFileSync(new URL('../../database/migrations/001-create-products.sql', import.meta.url), 'utf8'))
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT 'legacy') STRICT")
  db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(1, '001-create-products.sql')
  db.prepare('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?)').run('000LEGACY', 'Retained description', 150, 15, '000OLD-CODE', 'inactive')
  assert.equal(migrateDatabase(db), 1)
  assert.equal(migrateDatabase(db), 0)
  assert.deepEqual(findProductByPartNumber(db, '000LEGACY'), {
    partNumber: '000LEGACY', description: 'Retained description', bulkFixedQuantity: 150,
    packageFixedQuantity: 15, productBarcode: '000OLD-CODE', bulkBarcode: '', status: 'inactive',
  })
  insert(db, ['PACKAGE-ONLY', 'No bulk data', null, 10, 'PACKAGE-CODE', 'active'])
  assert.equal(findProductByPartNumber(db, 'PACKAGE-ONLY')?.bulkFixedQuantity, null)
  for (const code of [' ', 'BÁR', 'B'.repeat(129), 'B\nCODE']) {
    assert.throws(() => db.prepare('UPDATE products SET bulk_barcode = ? WHERE part_number = ?').run(code, '000LEGACY'))
  }
})

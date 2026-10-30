import { seedDevelopmentPrinters } from '../database/printers.js'
import { resolve } from 'node:path'
import { migrateDatabase, openProductDatabase, seedDevelopmentProducts } from '../database/index.js'

try {
  const databasePath = resolve(process.env.DATABASE_PATH ?? 'data/billco.sqlite')
  const db = openProductDatabase(databasePath)
  try {
    const migrations = migrateDatabase(db)
    const products = seedDevelopmentProducts(db)
    seedDevelopmentPrinters(db)
    console.info(`Database initialized at ${databasePath}; applied ${migrations} migration(s), inserted ${products} development product(s).`)
  } finally {
    db.close()
  }
} catch (error) {
  console.error('Unable to initialize the product database:', error)
  process.exitCode = 1
}

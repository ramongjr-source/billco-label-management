import { resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { migrateDatabase, openProductDatabase } from '../database/index.js'
import { createApp } from './app.js'

let db: DatabaseSync | undefined
try {
  const port = Number(process.env.API_PORT ?? '3001')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.')
  }
  const databasePath = resolve(process.env.DATABASE_PATH ?? 'data/billco.sqlite')
  db = openProductDatabase(databasePath)
  migrateDatabase(db)
  const app = createApp(db, { staticDirectory: resolve('dist') })
  const server = app.listen(port, '0.0.0.0', () => {
    console.info(`Billco product API listening on http://localhost:${port}`)
  })

  const closeDatabase = () => {
    db?.close()
    db = undefined
  }

  server.on('error', (error) => {
    console.error('Unable to start the Billco product API:', error)
    closeDatabase()
    process.exitCode = 1
  })

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    server.close((error) => {
      closeDatabase()
      if (error) {
        console.error('Unable to shut down the Billco product API:', error)
        process.exitCode = 1
      }
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
} catch (error) {
  console.error('Unable to start the Billco product API:', error)
  db?.close()
  process.exitCode = 1
}

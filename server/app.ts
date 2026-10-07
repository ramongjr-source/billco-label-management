import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import express from 'express'
import { findProductByPartNumber } from '../database/index.js'

interface AppOptions {
  staticDirectory?: string
  onError?: (error: unknown) => void
}

export function createApp(db: DatabaseSync, options: AppOptions = {}) {
  const app = express()
  const reportError = options.onError ?? ((error: unknown) => console.error('Product API request failed:', error))
  app.disable('x-powered-by')
  app.set('query parser', 'simple')
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  app.get('/api/health', (_request, response) => {
    try {
      db.prepare('SELECT part_number FROM products LIMIT 1').get()
      response.json({ status: 'ok' })
    } catch (error) {
      reportError(error)
      response.status(503).json({ status: 'unavailable' })
    }
  })

  app.get('/api/products', (request, response) => {
    const queryStart = request.originalUrl.indexOf('?')
    const rawQuery = queryStart === -1 ? '' : request.originalUrl.slice(queryStart + 1)
    try {
      // Query parsers may replace invalid UTF-8 instead of rejecting it.
      decodeURIComponent(rawQuery.replace(/\+/g, ' '))
    } catch {
      response.status(400).json({ error: 'Enter a valid part number (1–64 characters).' })
      return
    }

    const query = request.query.partNumber
    const partNumber = typeof query === 'string' ? query.trim() : ''
    if (!partNumber || [...partNumber].length > 64 || /[\u0000-\u001f\u007f]/.test(partNumber)) {
      response.status(400).json({ error: 'Enter a valid part number (1–64 characters).' })
      return
    }

    try {
      const product = findProductByPartNumber(db, partNumber)
      if (!product) {
        response.status(404).json({ error: 'Product not found.' })
        return
      }
      response.json(product)
    } catch (error) {
      reportError(error)
      response.status(500).json({ error: 'Unable to load the product. Please try again.' })
    }
  })

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'API route not found.' })
  })

  if (options.staticDirectory) {
    const directory = resolve(options.staticDirectory)
    const indexFile = join(directory, 'index.html')
    app.use(express.static(directory, { index: false }))
    app.get('/{*path}', (request, response, next) => {
      if (extname(request.path) || !request.accepts('html') || !existsSync(indexFile)) {
        next()
        return
      }
      response.sendFile(indexFile)
    })
  }

  return app
}

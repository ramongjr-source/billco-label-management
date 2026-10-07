import { extname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import express, { type Request, type Response } from 'express'
import multer from 'multer'
import { importProducts, previewProductImport, WorkbookImportError } from './import/index.js'

export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024

interface ImportRouterOptions {
  onError?: (error: unknown) => void
}

function uploadError(response: Response, error: unknown, reportError: (error: unknown) => void) {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    response.status(413).json({ error: 'The workbook exceeds the 5 MiB upload limit.' })
    return
  }
  const malformedUpload = error instanceof Error && (
    ['Multipart: Boundary not found', 'Malformed part header', 'Unexpected end of form',
      'Unexpected end of file', 'Malformed content type', 'Missing Content-Type',
      'Request error', 'Request aborted', 'Request closed'].includes(error.message)
    || error.message.startsWith('Unsupported content type:')
  )
  if (error instanceof multer.MulterError || malformedUpload) {
    response.status(400).json({ error: 'Upload one Excel workbook using the file field and an optional sheetName field.' })
    return
  }
  reportError(error)
  response.status(500).json({ error: 'Unable to process the product import. Please try again.' })
}

function selectedSheet(request: Request): { valid: true; name?: string } | { valid: false } {
  const body: unknown = request.body
  if (body === undefined) return { valid: true }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { valid: false }
  const fields = body as Record<string, unknown>
  if (Object.keys(fields).some((field) => field !== 'sheetName')) return { valid: false }
  if (!Object.hasOwn(fields, 'sheetName')) return { valid: true }
  const value = fields.sheetName
  if (typeof value !== 'string' || !value.trim() || [...value].length > 31
    || /[\u0000-\u001f\u007f\ufffd]/.test(value) || /[\ud800-\udfff]/u.test(value)) {
    return { valid: false }
  }
  return { valid: true, name: value }
}

export function createProductImportRouter(db: DatabaseSync, options: ImportRouterOptions = {}) {
  const router = express.Router()
  const reportError = options.onError ?? ((error: unknown) => console.error('Product import failed:', error))
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_WORKBOOK_BYTES,
      files: 1,
      fields: 1,
      parts: 2,
      fieldNameSize: 100,
      fieldSize: 128,
    },
  }).single('file')

  for (const [path, processWorkbook] of [
    ['/products/import/preview', previewProductImport],
    ['/products/import', importProducts],
  ] as const) {
    router.post(path, (request, response) => {
      upload(request, response, (error: unknown) => {
        if (error) {
          uploadError(response, error, reportError)
          return
        }
        if (!request.file) {
          response.status(400).json({ error: 'Choose an Excel workbook to upload.' })
          return
        }
        if (extname(request.file.originalname).toLowerCase() !== '.xlsx') {
          response.status(400).json({ error: 'Only .xlsx workbooks are supported. Save legacy .xls or macro-enabled .xlsm files as .xlsx first.' })
          return
        }
        const sheet = selectedSheet(request)
        if (!sheet.valid) {
          response.status(400).json({ error: 'Supply at most one valid sheetName (1–31 characters) and no other form fields.' })
          return
        }

        const buffer = request.file.buffer
        const processUpload = async () => {
          try {
            response.json(await processWorkbook(db, buffer, sheet.name))
          } catch (failure) {
            if (failure instanceof WorkbookImportError) {
              response.status(422).json({
                error: failure.message,
                ...(failure.sheetNames ? { sheetNames: failure.sheetNames } : {}),
              })
              return
            }
            reportError(failure)
            response.status(500).json({ error: 'Unable to process the product import. Please try again.' })
          }
        }
        void processUpload()
      })
    })
  }

  return router
}

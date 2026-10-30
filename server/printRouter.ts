import express from 'express'
import type { DatabaseSync } from 'node:sqlite'
import type { PrintService } from '../shared/printing.js'
import { createPrinter, updatePrinter, RecordingPrintService, PrintValidationError } from './printService.js'

export function createPrintRouter(db: DatabaseSync, reportError: (error: unknown) => void, service: PrintService = new RecordingPrintService(db)) {
  const router = express.Router()
  router.use(express.json({ limit: '16kb' }))
  router.get('/printers', (_req, res, next) => { try { res.json(service.listPrinters()) } catch (error) { next(error) } })
  router.post('/printers', (req, res, next) => { try { res.status(201).json(createPrinter(db, req.body)) } catch (error) { next(error) } })
  router.patch('/printers/:id', (req, res, next) => { try { res.json(updatePrinter(db, req.params.id, req.body)) } catch (error) { next(error) } })
  router.get('/print-jobs', (req, res, next) => {
    try {
      const cursor = req.query.before
      if (cursor !== undefined && (typeof cursor !== 'string' || !/^\d+$/.test(cursor))) throw new PrintValidationError('Enter a valid history cursor.')
      res.json(service.listJobs(cursor === undefined ? undefined : Number(cursor)))
    } catch (error) { next(error) }
  })
  router.post('/print-jobs', (req, res, next) => {
    try { const result = service.recordJob(req.body); res.status(result.created ? 201 : 200).json(result.job) } catch (error) { next(error) }
  })
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof PrintValidationError) { res.status(error.status).json({ error: error.message }); return }
    if (error instanceof SyntaxError || (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large')) { res.status(400).json({ error: 'Enter a valid print request within the size limit.' }); return }
    reportError(error)
    res.status(500).json({ error: 'Print service unavailable. Retry this request before starting another.' })
  })
  return router
}

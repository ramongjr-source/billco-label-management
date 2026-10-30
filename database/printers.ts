import type { DatabaseSync } from 'node:sqlite'

/** Explicit development examples only; never overwrite configured printer records. */
export function seedDevelopmentPrinters(db: DatabaseSync) {
  const insert = db.prepare('INSERT INTO printers (id, name, model, status, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
  for (const [id, name, model] of [
    ['example-sato-1', 'SATO CL4NX Plus #1', 'SATO CL4NX Plus'],
    ['example-sato-2', 'SATO CL4NX Plus #2', 'SATO CL4NX Plus'],
    ['example-sato-3', 'SATO CL4NX Plus #3', 'SATO CL4NX Plus'],
    ['example-generic', 'Generic Printer', 'Generic'],
  ]) insert.run(id, name, model, 'active', new Date().toISOString())
}

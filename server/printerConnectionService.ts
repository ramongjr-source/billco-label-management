import { randomUUID } from 'node:crypto'
import { isIP, Socket } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'
import type { PrinterConnectionHistoryPage, PrinterConnectionTest, PrinterConnectionTestResult } from '../shared/printing.js'
import { findPrinter, PrintValidationError } from './printService.js'

export interface ConnectionTarget {
  ipAddress: string
  port: number
  timeoutMs: number
}
export type ConnectionProbe = (target: ConnectionTarget) => Promise<{ result: 'success' | 'failure'; errorMessage: string | null }>

function connectionError(error: unknown, timeoutMs: number): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (code === 'ECONNREFUSED') return 'Connection refused (ECONNREFUSED).'
  if (code === 'ETIMEDOUT') return `Connection timed out after ${timeoutMs} ms.`
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Printer address is unreachable from the application server.'
  if (code === 'EACCES' || code === 'EPERM') return 'The application server is not permitted to connect to this address.'
  return 'Unable to establish a TCP connection.'
}

/** A TCP handshake only: never write printer commands or label bytes. */
export function tcpConnectionProbe(target: ConnectionTarget, socketFactory: () => Socket = () => new Socket()): ReturnType<ConnectionProbe> {
  return new Promise(resolve => {
    const socket = socketFactory()
    let settled = false
    const timer = setTimeout(() => finish({ result: 'failure', errorMessage: `Connection timed out after ${target.timeoutMs} ms.` }), target.timeoutMs)
    function finish(result: Awaited<ReturnType<ConnectionProbe>>) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => finish({ result: 'success', errorMessage: null }))
    socket.once('error', error => finish({ result: 'failure', errorMessage: connectionError(error, target.timeoutMs) }))
    socket.once('close', () => finish({ result: 'failure', errorMessage: 'Connection closed before it was established.' }))
    try { socket.connect({ host: target.ipAddress, port: target.port }) }
    catch (error) { finish({ result: 'failure', errorMessage: connectionError(error, target.timeoutMs) }) }
  })
}

/** Manual diagnostics only; the recording-only PrintService never calls this. */
export class PrinterConnectionService {
  constructor(private db: DatabaseSync, private probe: ConnectionProbe = tcpConnectionProbe) {}

  async testConnection(id: string): Promise<PrinterConnectionTestResult> {
    let target: ReturnType<typeof findPrinter>
    let generation: number
    // Reserve the attempt without holding a write transaction during network I/O.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      target = findPrinter(this.db, id)
      if (!isIP(target.ipAddress)) throw new PrintValidationError('Save a valid IP address before testing this printer.')
      this.db.prepare('UPDATE printers SET connection_generation = connection_generation + 1 WHERE id = ?').run(id)
      generation = Number(this.db.prepare('SELECT connection_generation FROM printers WHERE id = ?').get(id)!.connection_generation)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }

    let result: Awaited<ReturnType<ConnectionProbe>>
    try { result = await this.probe({ ipAddress: target.ipAddress, port: target.port, timeoutMs: target.connectionTimeoutMs }) }
    catch { result = { result: 'failure', errorMessage: 'Connection test failed unexpectedly.' } }
    const connection: PrinterConnectionTest = {
      id: randomUUID(), printerId: id, printerName: target.name, ipAddress: target.ipAddress,
      port: target.port, connectionTimeoutMs: target.connectionTimeoutMs,
      timestamp: new Date().toISOString(), result: result.result,
      errorMessage: result.result === 'success' ? null : result.errorMessage || 'Unable to establish a TCP connection.',
    }

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`INSERT INTO printer_connection_history (id, printer_id, printer_name, ip_address, port, connection_timeout_ms, result, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(connection.id, id, connection.printerName, connection.ipAddress, connection.port, connection.connectionTimeoutMs, connection.result, connection.errorMessage, connection.timestamp)
      const updated = this.db.prepare(`UPDATE printers SET connection_status = ?, last_connection_test_at = ?,
        last_successful_connection_at = CASE WHEN ? = 'success' THEN ? ELSE last_successful_connection_at END
        WHERE id = ? AND connection_generation = ?`)
        .run(connection.result === 'success' ? 'online' : 'offline', connection.timestamp, connection.result, connection.timestamp, id, generation)
      const printer = findPrinter(this.db, id)
      this.db.exec('COMMIT')
      return { printer, connection, applied: Number(updated.changes) === 1 }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  listHistory(id: string, before?: number): PrinterConnectionHistoryPage {
    findPrinter(this.db, id)
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new PrintValidationError('Enter a valid history cursor.')
    const rows = this.db.prepare(`SELECT sequence, id, printer_id AS printerId, printer_name AS printerName,
      ip_address AS ipAddress, port, connection_timeout_ms AS connectionTimeoutMs,
      result, error_message AS errorMessage, created_at AS timestamp FROM printer_connection_history
      WHERE printer_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT 26`).all(id, before ?? Number.MAX_SAFE_INTEGER)
    return {
      connections: rows.slice(0, 25).map(({ sequence: _sequence, ...connection }) => ({ ...connection }) as unknown as PrinterConnectionTest),
      nextBefore: rows.length > 25 ? Number(rows[24].sequence) : null,
    }
  }
}

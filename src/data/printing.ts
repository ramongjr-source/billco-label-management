import type { MediaChange, MediaHistoryPage, MediaMismatch, Printer, PrinterConnectionHistoryPage, PrinterConnectionTestResult, PrintJob, PrintRequest } from '../../shared/printing'
export type { MediaMismatch } from '../../shared/printing'
export class PrintRequestError extends Error {
  constructor(message: string, public code?: string, public details?: MediaMismatch) { super(message) }
}
export type PrinterConfiguration = Pick<Printer, 'name' | 'model' | 'status' | 'ipAddress' | 'port' | 'connectionTimeoutMs' | 'description' | 'supportedMedia' | 'mediaValidationEnabled'>

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) throw new PrintRequestError(data.error || 'Print service unavailable. Please try again.', data.code, data.details)
  return data as T
}
export const listPrinters = () => fetch('/api/printers').then(responseJson<Printer[]>)
export const listPrintJobs = (before?: number) => fetch(`/api/print-jobs${before === undefined ? '' : `?before=${before}`}`).then(responseJson<{ jobs: PrintJob[]; nextBefore: number | null }>)
export const recordPrintJob = (request: PrintRequest) => fetch('/api/print-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }).then(responseJson<PrintJob>)
export const createPrinter = (input: PrinterConfiguration) => fetch('/api/printers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then(responseJson<Printer>)
export const updatePrinter = (id: string, input: Partial<PrinterConfiguration>) => fetch(`/api/printers/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then(responseJson<Printer>)
export const listMediaHistory = (id: string, before?: number) => fetch(`/api/printers/${encodeURIComponent(id)}/media-history${before === undefined ? '' : `?before=${before}`}`).then(responseJson<MediaHistoryPage>)
export const changePrinterMedia = (id: string, input: { currentMedia: string | null; user: string; expectedCurrentMedia: string | null; requestId: string }) => fetch(`/api/printers/${encodeURIComponent(id)}/media-changes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).then(responseJson<{ printer: Printer; change: MediaChange; created: boolean }>)
export const testPrinterConnection = (id: string) => fetch(`/api/printers/${encodeURIComponent(id)}/test-connection`, { method: 'POST' }).then(responseJson<PrinterConnectionTestResult>)
export const listConnectionHistory = (id: string, before?: number) => fetch(`/api/printers/${encodeURIComponent(id)}/connection-history${before === undefined ? '' : `?before=${before}`}`).then(responseJson<PrinterConnectionHistoryPage>)

export function readOperatorName() { try { return localStorage.getItem('billco.operatorName') || '' } catch { return '' } }
export function rememberOperatorName(name: string) { try { localStorage.setItem('billco.operatorName', name.trim()) } catch { /* Audit entry still works without browser storage. */ } }

export function newRequestId() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') }

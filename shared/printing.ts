import type { Product } from './product.js'

export const printLabelTypes = ['bulk-fixed', 'bulk-variable', 'package-fixed', 'bcc'] as const
export type PrintLabelType = typeof printLabelTypes[number]
export interface Printer {
  id: string
  name: string
  model: string
  status: 'active' | 'inactive'
  createdAt: string
  ipAddress: string
  description: string
  supportedMedia: string[]
  currentMedia: string | null
  lastMediaChangeAt: string | null
  lastMediaChangeUser: string | null
  mediaValidationEnabled: boolean
  port: number
  connectionTimeoutMs: number
  connectionStatus: 'unknown' | 'online' | 'offline'
  lastConnectionTestAt: string | null
  lastSuccessfulConnectionAt: string | null
}
export interface PrinterConnectionTest {
  id: string
  printerId: string
  printerName: string
  ipAddress: string
  port: number
  connectionTimeoutMs: number
  timestamp: string
  result: 'success' | 'failure'
  errorMessage: string | null
}
export interface PrinterConnectionHistoryPage {
  connections: PrinterConnectionTest[]
  nextBefore: number | null
}
export interface PrinterConnectionTestResult {
  printer: Printer
  connection: PrinterConnectionTest
  /** False when settings changed or another test started while this attempt ran. */
  applied: boolean
}
export interface MediaChange {
  id: string
  requestId: string
  printerId: string
  printerName: string
  previousMedia: string | null
  newMedia: string | null
  user: string
  timestamp: string
}
export interface MediaHistoryPage {
  changes: MediaChange[]
  nextBefore: number | null
}
export interface MediaMismatch {
  printerId: string
  printerName: string
  requestedMedia: string
  currentMedia: string | null
}
export interface PrintRequest {
  requestId: string
  printerId: string
  labelType: PrintLabelType
  product: Product
  labelQuantity: number
  printQuantity: number
  poNumber: string
  lotNumber: string
  requestedMedia?: string
}
export interface PrintJob {
  id: string
  requestId: string
  status: 'recorded'
  createdAt: string
  /** Immutable snapshots from earlier versions may omit newer printer fields. */
  printer: Pick<Printer, 'id' | 'name' | 'model' | 'status' | 'createdAt'> & Partial<Printer>
  label: {
    templateVersion: 1
    type: PrintLabelType
    width: 3
    height: 2 | 5
    product: Product
    quantity: number
    barcode: string | null
    poNumber: string
    lotNumber: string
  }
  printQuantity: number
  requestedMedia?: string
}
/** Recording is deliberately separate from future physical delivery. */
export interface PrintService {
  listPrinters(): Printer[]
  recordJob(input: unknown): { job: PrintJob; created: boolean }
  listJobs(before?: number): { jobs: PrintJob[]; nextBefore: number | null }
}

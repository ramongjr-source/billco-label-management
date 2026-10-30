import type { Product } from './product.js'

export const printLabelTypes = ['bulk-fixed', 'bulk-variable', 'package-fixed', 'bcc'] as const
export type PrintLabelType = typeof printLabelTypes[number]
export interface Printer {
  id: string
  name: string
  model: string
  status: 'active' | 'inactive'
  createdAt: string
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
}
export interface PrintJob {
  id: string
  requestId: string
  status: 'recorded'
  createdAt: string
  printer: Printer
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
}
/** Recording is deliberately separate from future physical delivery. */
export interface PrintService {
  listPrinters(): Printer[]
  recordJob(input: unknown): { job: PrintJob; created: boolean }
  listJobs(before?: number): { jobs: PrintJob[]; nextBefore: number | null }
}

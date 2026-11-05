import type { PrintJob, PrintRequest } from './printing.js'

export type SatoRequest = Omit<PrintRequest, 'printerId' | 'requestedMedia'>
export interface SatoIssue { field: string; code: string; message: string }
export interface SatoElement {
  field: string
  kind: 'text' | 'barcode'
  value: string
  x: number
  y: number
  width: number
  height: number
  font?: 'XM' | 'XS'
  scale?: number
}
export interface SatoCommand {
  id: string
  requestId: string
  createdAt: string
  templateVersion: 1
  model: 'SATO CL4NX Plus'
  dpi: 203
  widthDots: 609
  heightDots: 406 | 1015
  label: PrintJob['label']
  printQuantity: number
  elements: SatoElement[]
  issues: SatoIssue[]
  valid: boolean
  /** Exact ASCII bytes represented as a JS string; null when validation fails. */
  payload: string | null
}
export interface SatoHistoryPage { commands: SatoCommand[]; nextBefore: number | null }

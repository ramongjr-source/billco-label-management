import type { Printer, PrintJob, PrintRequest } from '../../shared/printing'

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Print service unavailable. Please try again.')
  return data as T
}
export const listPrinters = () => fetch('/api/printers').then(responseJson<Printer[]>)
export const listPrintJobs = (before?: number) => fetch(`/api/print-jobs${before === undefined ? '' : `?before=${before}`}`).then(responseJson<{ jobs: PrintJob[]; nextBefore: number | null }>)
export const recordPrintJob = (request: PrintRequest) => fetch('/api/print-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }).then(responseJson<PrintJob>)

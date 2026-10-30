import { useEffect, useRef, useState } from 'react'
import type { Product } from '../../shared/product'
import type { Printer, PrintJob, PrintRequest } from '../../shared/printing'
import type { LabelType } from '../data/products'
import { listPrinters, listPrintJobs, recordPrintJob } from '../data/printing'

const storageKey = 'billco.lastPrinterId'
function rememberedPrinter() { try { return localStorage.getItem(storageKey) || '' } catch { return '' } }

export function PrintControls({ product, labelType, quantity, poNumber, lotNumber }: { product: Product | null; labelType: LabelType; quantity: string; poNumber: string; lotNumber: string }) {
  const [printers, setPrinters] = useState<Printer[]>([])
  const [printerId, setPrinterId] = useState(rememberedPrinter)
  const [printQuantity, setPrintQuantity] = useState('1')
  const [loading, setLoading] = useState(true)
  const [printerError, setPrinterError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const inFlight = useRef(false)
  const attempt = useRef<{ key: string; requestId: string } | null>(null)

  useEffect(() => {
    let active = true
    void listPrinters().then(items => {
      if (!active) return
      setPrinters(items)
      setPrinterId(previous => items.some(item => item.id === previous && item.status === 'active') ? previous : '')
    }).catch(() => { if (active) setPrinterError('Unable to load printers. Reload to try again.') }).finally(() => { if (active) setLoading(false) })
    void listPrintJobs().then(result => { if (active) { setJobs(result.jobs); setNextBefore(result.nextBefore) } }).catch(() => { if (active) setHistoryError('Unable to load print history.') })
    return () => { active = false }
  }, [])

  const integer = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 999999
  const bulk = labelType === 'bulk-fixed' || labelType === 'bulk-variable'
  const canRecord = Boolean(product && product.status === 'active' && integer(quantity) && integer(printQuantity)
    && lotNumber.trim() && lotNumber.trim().length <= 32 && (!bulk || (poNumber.trim() && poNumber.trim().length <= 32))
    && printers.some(printer => printer.id === printerId && printer.status === 'active'))

  async function history(before?: number) {
    setHistoryLoading(true)
    try {
      const result = await listPrintJobs(before)
      setJobs(previous => before === undefined ? result.jobs : [...previous, ...result.jobs])
      setNextBefore(result.nextBefore)
      setHistoryError('')
    } catch { setHistoryError('Unable to load print history. Try again.') }
    finally { setHistoryLoading(false) }
  }
  async function submit() {
    if (!canRecord || !product || inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setMessage('')
    const details = { product, printerId, labelType, labelQuantity: Number(quantity), printQuantity: Number(printQuantity), lotNumber: lotNumber.trim(), poNumber: bulk ? poNumber.trim() : '' }
    const key = JSON.stringify(details)
    if (attempt.current?.key !== key) attempt.current = { key, requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') }
    const request: PrintRequest = { ...details, requestId: attempt.current.requestId }
    try {
      const job = await recordPrintJob(request)
      attempt.current = null
      setMessage(`Job recorded: ${job.printQuantity} label(s) for ${job.printer.name}. No labels have been sent to the printer.`)
      await history()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to record the job. Retry before starting another request.') }
    finally { inFlight.current = false; setSubmitting(false) }
  }

  return <section className="panel print-panel" aria-labelledby="print-heading">
    <div className="print-heading">
      <h2 id="print-heading">Print job</h2>
      <p>Record jobs for review. Physical printing is not available yet.</p>
    </div>
    <div className="print-toolbar">
      <div className="field-group"><label htmlFor="printer">Printer</label>
        <select id="printer" value={printerId} disabled={loading || submitting} onChange={event => {
          setPrinterId(event.target.value)
          try { localStorage.setItem(storageKey, event.target.value) } catch { /* Selection still works without browser storage. */ }
        }}><option value="">{loading ? 'Loading printers…' : 'Select a printer'}</option>{printers.filter(printer => printer.status === 'active').map(printer => <option key={printer.id} value={printer.id}>{printer.name} · {printer.model}</option>)}</select>
        {printerError && <p role="alert">{printerError}</p>}
        {!loading && !printerError && !printers.some(printer => printer.status === 'active') && <p>No printers available. Ask your administrator to configure a printer.</p>}
      </div>
      <div className="field-group"><label htmlFor="print-quantity">Print Quantity</label><input id="print-quantity" type="number" min="1" max="999999" step="1" value={printQuantity} disabled={submitting} onChange={event => setPrintQuantity(event.target.value)} aria-describedby="print-quantity-help" /></div>
      <button className="button button-primary" type="button" disabled={!canRecord || submitting} onClick={() => { void submit() }}>{submitting ? 'Recording…' : 'PRINT'}</button>
    </div>
    <p id="print-quantity-help">Number of labels to produce; separate from the quantity shown on each label.</p>
    {message && <p role="status">{message}</p>}
    <details><summary>Print history</summary>
      <button className="button button-secondary" type="button" disabled={historyLoading || submitting} onClick={() => { void history() }}>Refresh history</button>
      {historyError && <p role="alert">{historyError}</p>}
      {!historyError && jobs.length === 0 && <p>No jobs recorded.</p>}
      <ol className="print-history">{jobs.map(job => <li key={job.id}>
        <strong>{job.label.product.partNumber} · {job.printQuantity} label(s)</strong>
        <p>{job.printer.name} · {job.label.type} · Recorded</p>
        <p>Quantity on label: {job.label.quantity} · LOT: {job.label.lotNumber}{job.label.poNumber && ` · PO: ${job.label.poNumber}`}</p>
        <p><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString()}</time> · Job {job.id}</p>
      </li>)}</ol>
      {nextBefore !== null && <button className="button button-secondary" type="button" disabled={historyLoading || submitting} onClick={() => { void history(nextBefore) }}>Load older jobs</button>}
    </details>
  </section>
}

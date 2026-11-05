import { SatoCommandPanel } from './SatoCommandPanel'
import { useEffect, useRef, useState } from 'react'
import type { Product } from '../../shared/product'
import type { Printer, PrintJob, PrintRequest } from '../../shared/printing'
import type { LabelType } from '../data/products'
import { changePrinterMedia, listPrinters, listPrintJobs, newRequestId, PrintRequestError, readOperatorName, recordPrintJob, rememberOperatorName, type MediaMismatch } from '../data/printing'
import { MediaConfirmationDialog } from './MediaConfirmationDialog'

const storageKey = 'billco.lastPrinterId'
function rememberedPrinter() { try { return localStorage.getItem(storageKey) || '' } catch { return '' } }

export function PrintControls({ product, labelType, quantity, poNumber, lotNumber }: { product: Product | null; labelType: LabelType; quantity: string; poNumber: string; lotNumber: string }) {
  const [printers, setPrinters] = useState<Printer[]>([])
  const [printerId, setPrinterId] = useState(rememberedPrinter)
  const [printQuantity, setPrintQuantity] = useState('1')
  const [requestedMedia, setRequestedMedia] = useState('')
  const [pending, setPending] = useState<{ request: PrintRequest; mismatch: MediaMismatch } | null>(null)
  const [operator, setOperator] = useState(readOperatorName)
  const [mediaError, setMediaError] = useState('')
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
  const mediaAttempt = useRef<{ key: string; requestId: string } | null>(null)

  useEffect(() => { setRequestedMedia('') }, [printerId, product?.partNumber])

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
  const selectedPrinter = printers.find(printer => printer.id === printerId)
  const bulk = labelType === 'bulk-fixed' || labelType === 'bulk-variable'
  const canRecord = Boolean(product && product.status === 'active' && integer(quantity) && integer(printQuantity)
    && lotNumber.trim() && lotNumber.trim().length <= 32 && (!bulk || (poNumber.trim() && poNumber.trim().length <= 32))
    && selectedPrinter?.status === 'active'
    && (!selectedPrinter.mediaValidationEnabled || selectedPrinter.supportedMedia.includes(requestedMedia)))

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
  async function record(request: PrintRequest) {
    try {
      const job = await recordPrintJob(request)
      attempt.current = null
      setPending(null)
      setMessage(`Job recorded: ${job.printQuantity} label(s) for ${job.printer.name}. No labels have been sent to the printer.`)
      await history()
    } catch (error) {
      if (error instanceof PrintRequestError && error.code === 'MEDIA_MISMATCH' && error.details) {
        const mismatch = error.details
        setPrinters(previous => previous.map(printer => printer.id === mismatch.printerId ? { ...printer, name: mismatch.printerName, currentMedia: mismatch.currentMedia } : printer))
        mediaAttempt.current = null
        setMediaError('')
        setPending({ request, mismatch })
      } else {
        setPending(null)
        setMessage(error instanceof Error ? error.message : 'Unable to record the job. Retry before starting another request.')
      }
    }
  }
  async function submit() {
    if (!canRecord || !product || inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setMessage('')
    const details = { product, printerId, labelType, labelQuantity: Number(quantity), printQuantity: Number(printQuantity), lotNumber: lotNumber.trim(), poNumber: bulk ? poNumber.trim() : '', ...(selectedPrinter?.mediaValidationEnabled ? { requestedMedia } : {}) }
    const key = JSON.stringify(details)
    if (attempt.current?.key !== key) attempt.current = { key, requestId: newRequestId() }
    try { await record({ ...details, requestId: attempt.current.requestId }) }
    finally { inFlight.current = false; setSubmitting(false) }
  }

  async function confirmMedia() {
    if (!pending || !operator.trim() || inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    setMediaError('')
    const details = { currentMedia: pending.mismatch.requestedMedia, expectedCurrentMedia: pending.mismatch.currentMedia, user: operator.trim() }
    const key = JSON.stringify({ printerId: pending.request.printerId, ...details })
    if (mediaAttempt.current?.key !== key) mediaAttempt.current = { key, requestId: newRequestId() }
    try {
      const result = await changePrinterMedia(pending.request.printerId, { ...details, requestId: mediaAttempt.current.requestId })
      setPrinters(previous => previous.map(printer => printer.id === result.printer.id ? result.printer : printer))
      rememberOperatorName(operator)
      await record(pending.request)
    } catch (error) {
      setMediaError(error instanceof PrintRequestError && error.code === 'MEDIA_CHANGED'
        ? 'Current media changed while this dialog was open. Cancel and press PRINT again to review the latest media.'
        : error instanceof Error ? error.message : 'Unable to record the media change. Try again.')
    } finally { inFlight.current = false; setSubmitting(false) }
  }

  return <section className="panel print-panel" aria-labelledby="print-heading">
    <div className="print-heading">
      <h2 id="print-heading">Print job</h2>
      <p>Record jobs for review. Physical printing is not available yet.</p>
    </div>
    {selectedPrinter && <div className="print-media-row">
      {selectedPrinter.mediaValidationEnabled && <div className="field-group"><label htmlFor="requested-material">Requested Material</label><select id="requested-material" value={requestedMedia} disabled={submitting} onChange={event => setRequestedMedia(event.target.value)}><option value="">Select material</option>{selectedPrinter.supportedMedia.map(media => <option key={media} value={media}>{media}</option>)}</select></div>}
      <p className="loaded-media">Current Media: <strong>{selectedPrinter.currentMedia ?? 'Unknown'}</strong></p>
    </div>}
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
    {message && <p role="status">{message}</p>}
    <div className="print-secondary">
    <SatoCommandPanel request={product && product.status === 'active' && integer(quantity) && integer(printQuantity) && lotNumber.trim() && (!bulk || poNumber.trim()) ? { product, labelType, labelQuantity: Number(quantity), printQuantity: Number(printQuantity), poNumber: bulk ? poNumber : '', lotNumber } : null} />
    <details className="print-help"><summary>Print help</summary><p id="print-quantity-help">Number of labels to produce; separate from the quantity shown on each label.</p></details>
    <details><summary>Print history</summary>
      <button className="button button-secondary" type="button" disabled={historyLoading || submitting} onClick={() => { void history() }}>Refresh history</button>
      {historyError && <p role="alert">{historyError}</p>}
      {!historyError && jobs.length === 0 && <p>No jobs recorded.</p>}
      <ol className="print-history">{jobs.map(job => <li key={job.id}>
        <strong>{job.label.product.partNumber} · {job.printQuantity} label(s)</strong>
        <p>{job.printer.name} · {job.label.type} · Recorded</p>
        <p>Quantity on label: {job.label.quantity} · LOT: {job.label.lotNumber}{job.label.poNumber && ` · PO: ${job.label.poNumber}`}</p>
        {job.requestedMedia && <p>Requested Material: {job.requestedMedia} · Media at recording: {job.printer.currentMedia ?? 'Unknown'}</p>}
        <p><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString()}</time> · Job {job.id}</p>
      </li>)}</ol>
      {nextBefore !== null && <button className="button button-secondary" type="button" disabled={historyLoading || submitting} onClick={() => { void history(nextBefore) }}>Load older jobs</button>}
    </details>
    </div>
    <MediaConfirmationDialog mismatch={pending?.mismatch ?? null} user={operator} busy={submitting} error={mediaError} onUserChange={setOperator} onCancel={() => { if (!inFlight.current) { setPending(null); setMediaError('') } }} onConfirm={() => { void confirmMedia() }} />
  </section>
}

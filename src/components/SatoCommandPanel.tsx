import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import type { SatoCommand, SatoElement, SatoRequest } from '../../shared/sato'
import { newRequestId } from '../data/printing'
import { generateSatoCommands, listSatoCommands } from '../data/sato'

function CommandBarcode({ element }: { element: SatoElement }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    try { JsBarcode(ref.current!, element.value, { format: 'CODE128B', width: 2, height: element.height, margin: 0, displayValue: false }) }
    catch { ref.current?.replaceChildren() }
  }, [element])
  // JsBarcode rewrites its SVG attributes, including x/y. Keep positioning on
  // a parent group so the rendered bars stay at the validated coordinates.
  return <g transform={`translate(${element.x} ${element.y})`} data-sato-field="barcode"><svg ref={ref} width={element.width} height={element.height} role="img" aria-label={`Code 128 barcode for ${element.value}`} /></g>
}

export function SatoCommandPanel({ request }: { request: Omit<SatoRequest, 'requestId'> | null }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [result, setResult] = useState<SatoCommand | null>(null)
  const [history, setHistory] = useState<SatoCommand[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const attempt = useRef<{ key: string; requestId: string } | null>(null)
  const inFlight = useRef(false)
  const requestKey = JSON.stringify(request)
  const [generatedKey, setGeneratedKey] = useState('')
  async function loadHistory(before?: number) {
    const page = await listSatoCommands(before)
    setHistory(previous => before === undefined ? page.commands : [...previous, ...page.commands])
    setNextBefore(page.nextBefore)
  }
  async function generate() {
    if (!request || inFlight.current) return
    inFlight.current = true
    setBusy(true); setError('')
    if (attempt.current?.key !== requestKey) attempt.current = { key: requestKey, requestId: newRequestId() }
    try {
      const data = await generateSatoCommands({ ...request, requestId: attempt.current.requestId })
      setResult(data); setGeneratedKey(requestKey); attempt.current = null
      await loadHistory()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Command preview unavailable. Retry this request.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <>
    <button type="button" className="sato-launch" onClick={() => { dialog.current?.showModal(); void loadHistory().catch(failure => setError(String(failure))) }}>SATO commands · Admin preview</button>
    <dialog ref={dialog} className="sato-dialog" aria-labelledby="sato-heading">
      <div className="sato-toolbar"><h2 id="sato-heading">SATO command preview</h2><button type="button" className="button button-secondary" onClick={() => dialog.current?.close()}>Close</button></div>
      <p>CL4NX Plus · 203 DPI · Generate and validate only. No data is sent to a printer.</p>
      <div className="sato-toolbar"><button type="button" className="button button-primary" disabled={!request || busy} onClick={() => { void generate() }}>{busy ? 'Generating…' : 'Generate SATO commands'}</button>
        <span>{request ? `${request.labelType} · ${request.printQuantity} label(s)` : 'Complete the product, quantity, PO (bulk), and LOT fields first.'}</span></div>
      {error && <p role="alert">{error}</p>}
      {result && <>
        <p role="status">{result.valid ? 'Command and layout validation passed.' : 'Validation failed. No executable payload generated.'} · {result.label.width}×{result.label.height} · {result.widthDots}×{result.heightDots} dots</p>
        {generatedKey !== requestKey && <p className="preview-warning">Saved snapshot: current form values differ. Generate again to preview the current label.</p>}
        <ul className="sato-issues">{result.issues.map((issue, index) => <li key={index}><strong>{issue.field}</strong>: {issue.message}</li>)}</ul>
        <div className="sato-grid">
          <div><h3>Generated layout</h3><svg className="sato-layout" viewBox={`0 0 609 ${result.heightDots}`} role="img" aria-label="Generated SATO label layout">
            <rect width="609" height={result.heightDots} fill="white" />
            <rect x="20" y="20" width="569" height={result.heightDots - 40} fill="none" stroke="#aaa" strokeDasharray="4" />
            {result.elements.map((element, index) => element.kind === 'barcode' ? <CommandBarcode key={index} element={element} /> : <text key={index} x={element.x} y={element.y} dominantBaseline="text-before-edge" fontFamily="monospace" fontSize={element.height} textLength={element.width || undefined} lengthAdjust="spacingAndGlyphs" xmlSpace="preserve">{element.value}</text>)}
          </svg><p>Geometry preview uses resident-font bounds. Physical output and scan quality require later hardware validation.</p></div>
          <div><h3>Description as stored</h3><pre className="sato-description">{result.label.product.description}</pre>
            <h3>SBPL commands (ESC shown as &lt;ESC&gt;)</h3><pre className="sato-payload" aria-label="SATO command output">{result.payload?.replaceAll('\u001b', '\n<ESC>').trimStart() ?? 'Payload withheld. Review the field warnings above; the complete source data is retained in history.'}</pre>
            <p>Barcode value: <code>{result.label.barcode === null ? 'None (variable quantity)' : JSON.stringify(result.label.barcode)}</code></p>
          </div>
        </div>
      </>}
      <details className="sato-history"><summary>Command history ({history.length})</summary>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => { void loadHistory().catch(failure => setError(String(failure))) }}>Refresh command history</button>
        {!history.length && <p>No command previews recorded.</p>}
        <ol>{history.map(item => <li key={item.id}><button type="button" disabled={busy} onClick={() => { setResult(item); setGeneratedKey('history') }}>{item.label.product.partNumber} · {item.label.type} · {item.valid ? 'Valid' : 'Needs review'} · {new Date(item.createdAt).toLocaleString()}</button></li>)}</ol>
        {nextBefore !== null && <button type="button" className="button button-secondary" disabled={busy} onClick={() => { void loadHistory(nextBefore).catch(failure => setError(String(failure))) }}>Load older commands</button>}
      </details>
    </dialog>
  </>
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronRight, Plus, Printer as PrinterIcon, RefreshCw } from 'lucide-react'
import { Header } from '../components/Header'
import { Sidebar } from '../components/Sidebar'
import { PrinterConnectionPanel, connectionStatusLabel } from '../components/PrinterConnectionPanel'
import type { LabelType } from '../data/products'
import type { MediaChange, Printer } from '../../shared/printing'
import { changePrinterMedia, createPrinter, listMediaHistory, listPrinters, newRequestId, readOperatorName, rememberOperatorName, updatePrinter, type PrinterConfiguration } from '../data/printing'

interface PrinterSetupProps {
  labelType: LabelType
  onNavigateImport: () => void
  onSelectLabelType: (type: LabelType) => void
}

const emptyConfiguration: PrinterConfiguration = {
  name: '', model: 'SATO CL4NX Plus', ipAddress: '', port: 9100, connectionTimeoutMs: 3000, description: '', status: 'active', supportedMedia: [], mediaValidationEnabled: false,
}
const messageFor = (error: unknown) => error instanceof Error ? error.message : 'Unable to save printer settings. Please try again.'

export function PrinterSetup({ labelType, onNavigateImport, onSelectLabelType }: PrinterSetupProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [printers, setPrinters] = useState<Printer[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [configuration, setConfiguration] = useState<PrinterConfiguration>(emptyConfiguration)
  const [supportedMediaText, setSupportedMediaText] = useState('')
  const [currentMedia, setCurrentMedia] = useState('')
  const [operator, setOperator] = useState(readOperatorName)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [page, setPage] = useState(1)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [changes, setChanges] = useState<MediaChange[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const historyRequest = useRef(0)
  const mediaAttempt = useRef<{ key: string; requestId: string } | null>(null)
  const selected = printers.find(printer => printer.id === selectedId)
  const pageSize = 4
  const pages = Math.max(1, Math.ceil(printers.length / pageSize))

  function select(printer: Printer | null) {
    setSelectedId(printer?.id ?? null)
    setConfiguration(printer ? { name: printer.name, model: printer.model, ipAddress: printer.ipAddress, port: printer.port, connectionTimeoutMs: printer.connectionTimeoutMs, description: printer.description, status: printer.status, supportedMedia: printer.supportedMedia, mediaValidationEnabled: printer.mediaValidationEnabled } : { ...emptyConfiguration })
    setSupportedMediaText(printer?.supportedMedia.join(', ') ?? '')
    setCurrentMedia(printer?.currentMedia ?? '')
    setError('')
    setMessage('')
    setHistoryOpen(false)
    setChanges([])
    setNextBefore(null)
    setHistoryError('')
    setHistoryLoading(false)
    historyRequest.current += 1
    mediaAttempt.current = null
  }

  useEffect(() => {
    let active = true
    void listPrinters().then(items => {
      if (!active) return
      setPrinters(items)
      select(items[0] ?? null)
    }).catch(error => { if (active) setError(messageFor(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; historyRequest.current += 1 }
  }, [])

  async function refresh() {
    setBusy(true)
    setError('')
    try {
      const items = await listPrinters()
      setPrinters(items)
      select(items.find(printer => printer.id === selectedId) ?? items[0] ?? null)
      setPage(previous => Math.min(previous, Math.max(1, Math.ceil(items.length / pageSize))))
    } catch (error) { setError(messageFor(error)) }
    finally { setBusy(false) }
  }

  function replacePrinter(printer: Printer) {
    setPrinters(items => [...items.filter(item => item.id !== printer.id), printer].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)))
    select(printer)
  }

  async function saveConfiguration(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const input = { ...configuration, supportedMedia: supportedMediaText.split(',').map(item => item.trim()).filter(Boolean) }
      const printer = selectedId ? await updatePrinter(selectedId, input) : await createPrinter(input)
      replacePrinter(printer)
      setMessage('Printer settings saved.')
    } catch (error) { setError(messageFor(error)) }
    finally { setBusy(false) }
  }

  async function saveMedia(event: FormEvent) {
    event.preventDefault()
    if (!selected || busy || (currentMedia.trim() || null) === selected.currentMedia) return
    setBusy(true)
    setError('')
    setMessage('')
    const input = { currentMedia: currentMedia.trim() || null, expectedCurrentMedia: selected.currentMedia, user: operator.trim() }
    const key = JSON.stringify({ printerId: selected.id, ...input })
    if (mediaAttempt.current?.key !== key) mediaAttempt.current = { key, requestId: newRequestId() }
    try {
      const result = await changePrinterMedia(selected.id, { ...input, requestId: mediaAttempt.current.requestId })
      rememberOperatorName(input.user)
      replacePrinter(result.printer)
      setMessage('Loaded media updated and audited.')
    } catch (error) { setError(messageFor(error)) }
    finally { setBusy(false) }
  }

  async function loadHistory(before?: number) {
    if (!selectedId) return
    const request = ++historyRequest.current
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const result = await listMediaHistory(selectedId, before)
      if (request !== historyRequest.current) return
      setChanges(previous => before === undefined ? result.changes : [...previous, ...result.changes])
      setNextBefore(result.nextBefore)
    } catch (error) { if (request === historyRequest.current) setHistoryError(messageFor(error)) }
    finally { if (request === historyRequest.current) setHistoryLoading(false) }
  }

  return <div className="app-shell label-shell">
    <a href="#main-content" className="skip-link">Skip to printer setup</a>
    <Header menuOpen={menuOpen} onToggleMenu={() => setMenuOpen(open => !open)} />
    {menuOpen && <button className="nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <Sidebar open={menuOpen} labelType={labelType} onSelectLabelType={onSelectLabelType} onNavigateImport={onNavigateImport} onNavigatePrinters={() => setMenuOpen(false)} activePage="printer-setup" navigationDisabled={busy} />
    <main id="main-content" className="workspace printer-workspace">
      <div className="printer-content">
        <nav className="breadcrumb flex items-center gap-3" aria-label="Breadcrumb"><span>Administration</span><ChevronRight size={17} aria-hidden="true" /><span aria-current="page">Printer Setup</span></nav>
        <div className="page-heading"><h1>Printer Setup</h1><p>Manage devices and loaded media. Physical printing is not available yet.</p></div>
        <div className="printer-setup-grid">
          <section className="panel printer-registry" aria-labelledby="printer-registry-heading">
            <div className="printer-section-heading"><h2 id="printer-registry-heading"><PrinterIcon size={22} aria-hidden="true" />Printer registry</h2><div className="flex gap-2">
              <button className="button button-secondary" type="button" onClick={() => { void refresh() }} disabled={busy || loading}><RefreshCw size={17} aria-hidden="true" />Refresh printers</button>
              <button className="button button-primary" type="button" onClick={() => select(null)} disabled={busy || loading}><Plus size={17} aria-hidden="true" />Add printer</button>
            </div></div>
            <p className="printer-guidance">Printers are devices. Media settings can change independently of label types.</p>
            {loading ? <p role="status">Loading printers…</p> : <div className="import-table-scroll">
              <table className="import-table printer-table">
                <caption className="sr-only">Configured printers and loaded media</caption>
                <thead><tr><th scope="col">Printer / IP address</th><th scope="col">Loaded media</th><th scope="col">Enabled</th><th scope="col">Connection</th></tr></thead>
                <tbody>{printers.slice((page - 1) * pageSize, page * pageSize).map(printer => <tr key={printer.id} className={selectedId === printer.id ? 'printer-row-selected' : undefined}>
                  <td><button className="printer-name-button" type="button" onClick={() => select(printer)} disabled={busy} aria-pressed={selectedId === printer.id}>{printer.name}</button><span className="printer-table-detail">{printer.ipAddress || 'No IP configured'}</span></td>
                  <td>{printer.currentMedia ?? 'Unknown'}</td><td>{printer.status === 'active' ? 'Yes' : 'No'}</td>
                  <td><span className={`printer-connection-status printer-connection-${printer.connectionStatus}`}>{connectionStatusLabel(printer.connectionStatus)}</span></td>
                </tr>)}</tbody>
              </table>
              {printers.length === 0 && <p className="printer-guidance">No printers configured. Add a printer to get started.</p>}
            </div>}
            {pages > 1 && <nav className="import-pagination" aria-label="Printer registry pagination"><span>{printers.length} printers · Page {page} of {pages}</span><div className="flex gap-2"><button className="button button-secondary" type="button" disabled={page <= 1 || busy} onClick={() => setPage(previous => previous - 1)}>Previous</button><button className="button button-secondary" type="button" disabled={page >= pages || busy} onClick={() => setPage(previous => previous + 1)}>Next</button></div></nav>}
            {selected && <PrinterConnectionPanel key={selected.id} printer={selected} busy={busy || loading} settingsChanged={configuration.ipAddress.trim() !== selected.ipAddress || configuration.port !== selected.port || configuration.connectionTimeoutMs !== selected.connectionTimeoutMs} onBusyChange={setBusy} onPrinterUpdated={printer => setPrinters(items => items.map(item => item.id === printer.id ? printer : item))} />}
          </section>
          <section className="panel printer-editor" aria-labelledby="printer-editor-heading">
            <h2 id="printer-editor-heading" className="panel-heading">{selected ? 'Edit printer' : 'Add printer'}</h2>
            {error && <p role="alert" className="import-error">{error} Refresh printers to review the latest stored settings.</p>}
            {message && <p role="status" className="printer-save-message">{message}</p>}
            <form onSubmit={event => { void saveConfiguration(event) }}>
              <fieldset disabled={busy || loading}>
                <div className="printer-form-row">
                  <div className="field-group"><label htmlFor="printer-name">Printer Name</label><input id="printer-name" required maxLength={80} value={configuration.name} onChange={event => setConfiguration(previous => ({ ...previous, name: event.target.value }))} /></div>
                  <div className="field-group"><label htmlFor="printer-model">Model</label><input id="printer-model" required maxLength={80} value={configuration.model} onChange={event => setConfiguration(previous => ({ ...previous, model: event.target.value }))} /></div>
                </div>
                <div className="printer-form-row printer-connection-fields">
                  <div className="field-group"><label htmlFor="printer-ip">IP Address</label><input id="printer-ip" maxLength={45} placeholder="192.168.1.190" value={configuration.ipAddress} onChange={event => setConfiguration(previous => ({ ...previous, ipAddress: event.target.value }))} /></div>
                  <div className="field-group"><label htmlFor="printer-port">Port</label><input id="printer-port" type="number" min="1" max="65535" step="1" required value={configuration.port || ''} onChange={event => setConfiguration(previous => ({ ...previous, port: Number(event.target.value) }))} /></div>
                  <div className="field-group"><label htmlFor="printer-connection-timeout">Connection Timeout (ms)</label><input id="printer-connection-timeout" type="number" min="100" max="30000" step="1" required value={configuration.connectionTimeoutMs || ''} onChange={event => setConfiguration(previous => ({ ...previous, connectionTimeoutMs: Number(event.target.value) }))} /></div>
                </div>
                <div className="printer-form-row">
                  <div className="field-group"><label htmlFor="printer-description">Description</label><input id="printer-description" maxLength={512} value={configuration.description} onChange={event => setConfiguration(previous => ({ ...previous, description: event.target.value }))} /></div>
                  <div className="field-group"><label htmlFor="printer-supported-media">Supported Media</label><input id="printer-supported-media" value={supportedMediaText} onChange={event => setSupportedMediaText(event.target.value)} placeholder="Aluminum, Stainless, Brass" aria-describedby="printer-media-help" /><p id="printer-media-help" className="field-help">Separate media names with commas.</p></div>
                </div>
                <div className="printer-checkboxes">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={configuration.status === 'active'} onChange={event => setConfiguration(previous => ({ ...previous, status: event.target.checked ? 'active' : 'inactive' }))} />Enabled</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={configuration.mediaValidationEnabled} onChange={event => setConfiguration(previous => ({ ...previous, mediaValidationEnabled: event.target.checked }))} />Require media confirmation</label>
                </div>
                <button className="button button-primary" type="submit">{busy ? 'Saving…' : 'Save printer settings'}</button>
              </fieldset>
            </form>
            {selected && <div className="printer-media-section">
              <h3>Loaded media</h3>
              <p className="printer-media-current">Current Media: <strong>{selected.currentMedia ?? 'Unknown'}</strong></p>
              <p className="field-help">{selected.lastMediaChangeAt ? <>Last changed: <time dateTime={selected.lastMediaChangeAt}>{new Date(selected.lastMediaChangeAt).toLocaleString()}</time> by {selected.lastMediaChangeUser}</> : 'No media change recorded. Confirm the stock loaded before use.'}</p>
              <form onSubmit={event => { void saveMedia(event) }}>
                <fieldset disabled={busy || loading}>
                  <div className="printer-form-row">
                    <div className="field-group"><label htmlFor="printer-current-media">Current Media</label><input id="printer-current-media" list="configured-media" maxLength={80} value={currentMedia} placeholder="Unknown" onChange={event => setCurrentMedia(event.target.value)} /><datalist id="configured-media">{selected.supportedMedia.map(media => <option key={media} value={media} />)}</datalist><p className="field-help">Leave blank to mark loaded media unknown.</p></div>
                    <div className="field-group"><label htmlFor="media-operator">Operator Name</label><input id="media-operator" required maxLength={80} value={operator} onChange={event => setOperator(event.target.value)} autoComplete="name" /><p className="field-help">Operator-entered name saved in the audit trail.</p></div>
                  </div>
                  <button className="button button-secondary" type="submit" disabled={(currentMedia.trim() || null) === selected.currentMedia || !operator.trim()}>Save media change</button>
                </fieldset>
              </form>
              <details className="printer-media-history" open={historyOpen} onToggle={event => {
                const open = event.currentTarget.open
                if (open === historyOpen) return
                setHistoryOpen(open)
                if (open) void loadHistory()
              }}>
                <summary>Media change history</summary>
                {historyOpen && <>
                  <button className="button button-secondary" type="button" disabled={historyLoading || busy} onClick={() => { void loadHistory() }}>Refresh media history</button>
                  {historyLoading && <p role="status">Loading media history…</p>}
                  {historyError && <p role="alert" className="import-error">{historyError}</p>}
                  {!historyLoading && !historyError && changes.length === 0 && <p className="field-help">No media changes recorded.</p>}
                  {changes.length > 0 && <div className="import-table-scroll"><table className="import-table printer-audit-table"><caption className="sr-only">Media changes for {selected.name}</caption><thead><tr><th scope="col">Timestamp / Operator</th><th scope="col">Previous Media</th><th scope="col">New Media</th></tr></thead><tbody>{changes.map(change => <tr key={change.id}><td><time dateTime={change.timestamp}>{new Date(change.timestamp).toLocaleString()}</time><span className="printer-table-detail">{change.user}</span></td><td>{change.previousMedia ?? 'Unknown'}</td><td>{change.newMedia ?? 'Unknown'}</td></tr>)}</tbody></table></div>}
                  {nextBefore !== null && <button className="button button-secondary" type="button" disabled={historyLoading || busy} onClick={() => { void loadHistory(nextBefore) }}>Load older media changes</button>}
                </>}
              </details>
              <p className="printer-record-id">Printer ID: {selected.id}</p>
            </div>}
          </section>
        </div>
      </div>
    </main>
  </div>
}

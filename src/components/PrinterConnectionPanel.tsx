import { useEffect, useRef, useState } from 'react'
import type { Printer, PrinterConnectionTest, PrinterConnectionTestResult } from '../../shared/printing'
import { listConnectionHistory, testPrinterConnection } from '../data/printing'

export const connectionStatusLabel = (status: Printer['connectionStatus']) => status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Unknown'
const messageFor = (error: unknown) => error instanceof Error ? error.message : 'Unable to test the connection. Please try again.'

function ConnectionTime({ value, empty }: { value: string | null; empty: string }) {
  return value ? <time dateTime={value}>{new Date(value).toLocaleString()}</time> : <>{empty}</>
}

export function PrinterConnectionPanel({ printer, busy, settingsChanged, onBusyChange, onPrinterUpdated }: {
  printer: Printer
  busy: boolean
  settingsChanged: boolean
  onBusyChange: (busy: boolean) => void
  onPrinterUpdated: (printer: Printer) => void
}) {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<PrinterConnectionTestResult | null>(null)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [connections, setConnections] = useState<PrinterConnectionTest[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const historyRequest = useRef(0)
  const testRequest = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => () => { historyRequest.current += 1; testRequest.current += 1 }, [])
  useEffect(() => {
    setResult(previous => previous?.applied && (previous.connection.ipAddress !== printer.ipAddress || previous.connection.port !== printer.port || previous.connection.connectionTimeoutMs !== printer.connectionTimeoutMs) ? null : previous)
  }, [printer.ipAddress, printer.port, printer.connectionTimeoutMs])

  async function loadHistory(before?: number) {
    const request = ++historyRequest.current
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const response = await listConnectionHistory(printer.id, before)
      if (request !== historyRequest.current) return
      setConnections(previous => before === undefined ? response.connections : [...previous, ...response.connections])
      setNextBefore(response.nextBefore)
    } catch (error) { if (request === historyRequest.current) setHistoryError(messageFor(error)) }
    finally { if (request === historyRequest.current) setHistoryLoading(false) }
  }

  async function testConnection() {
    if (busy || settingsChanged || !printer.ipAddress || inFlight.current) return
    inFlight.current = true
    const request = ++testRequest.current
    setTesting(true)
    onBusyChange(true)
    setError('')
    setResult(null)
    try {
      const response = await testPrinterConnection(printer.id)
      if (request !== testRequest.current) return
      setResult(response)
      onPrinterUpdated(response.printer)
      if (historyOpen) await loadHistory()
    } catch (error) { if (request === testRequest.current) setError(messageFor(error)) }
    finally {
      inFlight.current = false
      if (request === testRequest.current) { setTesting(false); onBusyChange(false) }
    }
  }

  const resultMatchesSettings = result && result.connection.ipAddress === printer.ipAddress && result.connection.port === printer.port && result.connection.connectionTimeoutMs === printer.connectionTimeoutMs

  return <section className="printer-connection-panel" aria-labelledby="printer-connection-heading">
    <div className="printer-connection-heading"><h3 id="printer-connection-heading">Connection</h3><span className={`printer-connection-status printer-connection-${printer.connectionStatus}`}>{connectionStatusLabel(printer.connectionStatus)}</span></div>
    <p className="field-help">Status reflects the last manual connection test. No automatic checks.</p>
    <dl className="printer-connection-facts">
      <div><dt>Current Status</dt><dd>{connectionStatusLabel(printer.connectionStatus)}</dd></div>
      <div><dt>Last Successful Connection</dt><dd><ConnectionTime value={printer.lastSuccessfulConnectionAt} empty="Never" /></dd></div>
      <div><dt>Last Connection Test</dt><dd><ConnectionTime value={printer.lastConnectionTestAt} empty="Not tested" /></dd></div>
    </dl>
    <div className="printer-connection-actions">
      <button type="button" className="button button-secondary" disabled={busy || testing || settingsChanged || !printer.ipAddress} onClick={() => { void testConnection() }}>{testing ? 'Testing…' : 'Test Connection'}</button>
      <span className="field-help">{settingsChanged ? 'Save connection settings before testing.' : !printer.ipAddress ? 'Save an IP address before testing.' : `Saved endpoint: ${printer.ipAddress}:${printer.port} · Timeout ${printer.connectionTimeoutMs} ms`}</span>
    </div>
    {result && <div role="status" className={`printer-connection-result${result.connection.result === 'failure' ? ' printer-connection-result-failed' : ''}`}>
      <strong>{result.connection.result === 'success' ? 'Connection Successful' : 'Connection Failed'}</strong>
      <span>{result.connection.ipAddress}:{result.connection.port}{result.connection.errorMessage && ` · ${result.connection.errorMessage}`}</span>
      {(!result.applied || !resultMatchesSettings) && <span>Settings changed or a newer test started. Review and test the current settings.</span>}
    </div>}
    {error && <p className="import-error" role="alert">{error}</p>}
    <details className="printer-connection-history" open={historyOpen} onToggle={event => {
      const open = event.currentTarget.open
      if (open === historyOpen) return
      setHistoryOpen(open)
      if (open) void loadHistory()
    }}>
      <summary>Connection history</summary>
      {historyOpen && <>
        <button className="button button-secondary" type="button" disabled={historyLoading || busy} onClick={() => { void loadHistory() }}>Refresh connection history</button>
        {historyLoading && <p role="status" className="field-help">Loading connection history…</p>}
        {historyError && <p role="alert" className="import-error">{historyError}</p>}
        {!historyLoading && !historyError && connections.length === 0 && <p className="field-help">No connection tests recorded.</p>}
        {connections.length > 0 && <div className="import-table-scroll"><table className="import-table printer-audit-table printer-connection-history-table">
          <caption className="sr-only">Connection tests for {printer.name}</caption>
          <thead><tr><th scope="col">Timestamp / Printer</th><th scope="col">IP Address / Port</th><th scope="col">Result / Error Message</th></tr></thead>
          <tbody>{connections.map(connection => <tr key={connection.id}>
            <td><time dateTime={connection.timestamp}>{new Date(connection.timestamp).toLocaleString()}</time><span className="printer-table-detail">{connection.printerName}</span></td>
            <td>{connection.ipAddress}<span className="printer-table-detail">Port {connection.port} · Timeout {connection.connectionTimeoutMs} ms</span></td>
            <td>{connection.result === 'success' ? 'Connection Successful' : 'Connection Failed'}<span className="printer-table-detail">{connection.errorMessage ?? '—'}</span></td>
          </tr>)}</tbody>
        </table></div>}
        {nextBefore !== null && <button className="button button-secondary" type="button" disabled={historyLoading || busy} onClick={() => { void loadHistory(nextBefore) }}>Load older connection tests</button>}
      </>}
    </details>
  </section>
}

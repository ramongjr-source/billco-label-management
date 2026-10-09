import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronRight, FileCheck2, RotateCcw, Upload } from 'lucide-react'
import { Header } from '../components/Header'
import { Sidebar } from '../components/Sidebar'
import type { LabelType } from '../data/products'
import { commitProductImport, inspectProductImport, previewProductImport, ProductImportRequestError } from '../data/productImport'
import type { ImportField, ProductImportColumns, ProductImportMapping, ProductImportPreview, ProductImportResult } from '../../shared/productImport.js'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const PAGE_SIZE = 50
const mappingFields: Array<{ field: ImportField; label: string }> = [
  { field: 'partNumber', label: 'Part Number' },
  { field: 'bulkFixedQuantity', label: 'Bulk Fixed Quantity' },
  { field: 'packageFixedQuantity', label: 'Package Fixed Quantity' },
  { field: 'productBarcode', label: 'Product Barcode' },
  { field: 'bulkBarcode', label: 'Bulk Barcode' },
  { field: 'status', label: 'Status (optional)' },
]

interface ProductImportProps {
  labelType: LabelType
  onNavigateProducts: () => void
  onSelectLabelType: (type: LabelType) => void
}

function fileError(file: File | null): string {
  if (!file) return 'Choose an Excel workbook to validate.'
  if (!/\.xlsx$/i.test(file.name)) return 'Choose an .xlsx workbook. The .xls and .xlsm formats are not supported.'
  if (!file.size) return 'The selected workbook is empty. Choose a workbook with product rows.'
  if (file.size > MAX_FILE_BYTES) return 'The workbook exceeds the 5 MiB limit. Choose a smaller file.'
  return ''
}

function Pagination({ total, page, label, onPageChange }: { total: number; page: number; label: string; onPageChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const start = total ? (page - 1) * PAGE_SIZE + 1 : 0
  return <nav className="import-pagination" aria-label={`${label} pagination`}>
    <span>{start}–{Math.min(page * PAGE_SIZE, total)} of {total} {label.toLowerCase()}</span>
    <div className="flex items-center gap-2">
      <button className="button button-secondary" type="button" aria-label={`Previous ${label.toLowerCase()}`} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button className="button button-secondary" type="button" aria-label={`Next ${label.toLowerCase()}`} disabled={page >= pages} onClick={() => onPageChange(page + 1)}>Next</button>
    </div>
  </nav>
}

function ImportCounts({ report, committed }: { report: ProductImportResult; committed: boolean }) {
  return <dl className="import-counts">
    <div><dt>Total rows</dt><dd>{report.totalRows}</dd></div>
    <div><dt>{committed ? 'Added' : 'To add'}</dt><dd>{report.added}</dd></div>
    <div><dt>{committed ? 'Updated' : 'To update'}</dt><dd>{report.updated}</dd></div>
    <div><dt>Invalid rows</dt><dd>{report.invalidRows}</dd></div>
    <div><dt>Blank rows</dt><dd>{report.blankRows}</dd></div>
  </dl>
}

export function ProductImport({ labelType, onNavigateProducts, onSelectLabelType }: ProductImportProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [columns, setColumns] = useState<ProductImportColumns['columns']>([])
  const [mapping, setMapping] = useState<ProductImportMapping>({ descriptionColumns: [] })
  const [preview, setPreview] = useState<ProductImportPreview | null>(null)
  const [result, setResult] = useState<ProductImportResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'reading' | 'validating' | 'importing' | null>(null)
  const [rowPage, setRowPage] = useState(1)
  const [errorPage, setErrorPage] = useState(1)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const committing = busy === 'importing'
  const report = result ?? preview

  const cancelRequest = useCallback(() => {
    requestIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  useEffect(() => cancelRequest, [cancelRequest])

  function resetReport() {
    cancelRequest()
    setBusy(null)
    setPreview(null)
    setResult(null)
    setError('')
    setRowPage(1)
    setErrorPage(1)
  }

  function chooseFile(nextFile: File | null) {
    if (committing) return
    resetReport()
    setFile(nextFile)
    setSheetName('')
    setSheetNames([])
    setColumns([])
    setMapping({ descriptionColumns: [] })
    if (nextFile) setError(fileError(nextFile))
    if (nextFile && !fileError(nextFile)) void readColumns(nextFile, '')
  }

  function chooseSheet(nextSheet: string) {
    if (committing) return
    resetReport()
    setSheetName(nextSheet)
    setColumns([])
    setMapping({ descriptionColumns: [] })
    if (file) void readColumns(file, nextSheet)
  }

  async function readColumns(workbook: File, worksheet: string) {
    cancelRequest()
    const requestId = requestIdRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy('reading')
    try {
      const detected = await inspectProductImport(workbook, worksheet, controller.signal)
      if (requestId !== requestIdRef.current) return
      setSheetName(detected.sheetName)
      setSheetNames(detected.sheetNames)
      setColumns(detected.columns)
      setMapping(detected.mapping)
    } catch (caught) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : 'Unable to read workbook columns.')
      if (caught instanceof ProductImportRequestError && caught.sheetNames) setSheetNames(caught.sheetNames)
    } finally {
      if (requestId === requestIdRef.current) { controllerRef.current = null; setBusy(null) }
    }
  }

  function changeMapping(field: ImportField, value: string) {
    resetReport()
    setMapping((previous) => {
      const next = { ...previous }
      if (value) next[field] = Number(value)
      else delete next[field]
      return next
    })
  }

  function changeDescription(index: number, value: string) {
    resetReport()
    setMapping((previous) => {
      const descriptions = Array.from({ length: 5 }, (_, n) => previous.descriptionColumns[n] || 0)
      descriptions[index] = Number(value)
      return { ...previous, descriptionColumns: descriptions }
    })
  }

  function clear() {
    if (committing) return
    chooseFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    fileInputRef.current?.focus()
  }

  async function submit(action: 'validating' | 'importing') {
    if (busy) return
    const invalidFile = fileError(file)
    if (invalidFile || !file) { setError(invalidFile); return }
    if (action === 'importing' && (!preview || !preview.rows.length)) return
    cancelRequest()
    const requestId = requestIdRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(action)
    setError('')
    setPreview(null)
    setResult(null)
    setRowPage(1)
    setErrorPage(1)
    try {
      const response = action === 'validating'
        ? await previewProductImport(file, sheetName, controller.signal, columns.length ? mapping : undefined)
        : await commitProductImport(file, sheetName, controller.signal, columns.length ? mapping : undefined)
      if (requestId !== requestIdRef.current) return
      setSheetName(response.sheetName)
      setSheetNames(response.sheetNames)
      if (action === 'validating') setPreview(response as ProductImportPreview)
      else setResult(response)
    } catch (caught) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      if (caught instanceof ProductImportRequestError) {
        setError(caught.message)
        if (caught.sheetNames) setSheetNames(caught.sheetNames)
      } else {
        setError(action === 'importing'
          ? 'The import could not be confirmed. Validate the workbook again before retrying.'
          : 'Workbook validation is unavailable. Please try again.')
      }
    } finally {
      if (requestId === requestIdRef.current) {
        controllerRef.current = null
        setBusy(null)
      }
    }
  }

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to import workspace</a>
    <Header menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((open) => !open)} />
    {menuOpen && <button className="nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <Sidebar open={menuOpen} labelType={labelType} onSelectLabelType={onSelectLabelType} onNavigateImport={() => setMenuOpen(false)} activePage="product-import" navigationDisabled={committing} />
    <main id="main-content" className="workspace import-workspace">
      <div className="import-content">
        <nav className="breadcrumb flex items-center gap-3" aria-label="Breadcrumb"><span>Database</span><ChevronRight size={17} aria-hidden="true" /><span aria-current="page">Import Master List</span></nav>
        <div className="page-heading"><h1>Import Master List</h1><p>Validate your product workbook, then import the valid rows.</p></div>
        <section className="panel import-upload-panel" aria-labelledby="workbook-heading">
          <h2 id="workbook-heading" className="panel-heading">Product workbook</h2>
          <form onSubmit={(event) => { event.preventDefault(); void submit('validating') }}>
            <div className="import-file-fields">
              <div className="field-group">
                <label htmlFor="product-workbook">Excel workbook (.xlsx)</label>
                <input ref={fileInputRef} id="product-workbook" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={committing} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} aria-describedby="workbook-help" />
                <p id="workbook-help" className="field-help">Up to 5 MiB and 5,000 product rows. Only .xlsx files are supported.</p>
              </div>
              <div className="field-group">
                <label htmlFor="product-worksheet">Worksheet</label>
                <select id="product-worksheet" value={sheetName} disabled={!file || committing} onChange={(event) => chooseSheet(event.target.value)} aria-describedby="worksheet-help">
                  <option value="">Automatic (prefer BillcoMaster)</option>
                  {sheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <p id="worksheet-help" className="field-help">BillcoMaster is selected automatically when present. Choose a product worksheet.</p>
              </div>
            </div>
            <p className="import-guidance">Use BillcoMaster in Billco_App_Master.xlsx. BillcoPart#, Description, StdPackQty, BulkQty, ProductBarcode, and BulkBarcode are mapped automatically. Other product worksheets can use the column mapping below.</p>
            <p className="import-guidance">Select one description column or combine up to five in order. Product and bulk barcodes are independent. Without Status, new products are active and updates keep their existing status. Blank quantities and barcodes remain unavailable for fixed labels.</p>
            {columns.length > 0 && <fieldset className="import-mapping" disabled={committing}>
              <legend className="panel-heading">Column mapping</legend>
              <details><summary>Detected columns ({columns.length})</summary><ul>{columns.map((column) => <li key={column.index}>{column.index}: {column.header}</li>)}</ul></details>
              <div className="import-mapping-grid">
                {mappingFields.map(({ field, label }) => <div className="field-group" key={field}>
                  <label htmlFor={`map-${field}`}>Map {label}</label>
                  <select id={`map-${field}`} value={mapping[field] ?? ''} onChange={(event) => changeMapping(field, event.target.value)}>
                    <option value="">{field === 'status' ? 'Keep existing status / new active' : 'Not mapped'}</option>
                    {columns.map((column) => <option key={column.index} value={column.index}>{column.index}: {column.header}</option>)}
                  </select>
                </div>)}
                {Array.from({ length: 5 }, (_, index) => <div className="field-group" key={`description-${index}`}>
                  <label htmlFor={`map-description-${index}`}>Map Description {index + 1}</label>
                  <select id={`map-description-${index}`} value={mapping.descriptionColumns[index] || ''} onChange={(event) => changeDescription(index, event.target.value)}>
                    <option value="">Not mapped</option>
                    {columns.map((column) => <option key={column.index} value={column.index}>{column.index}: {column.header}</option>)}
                  </select>
                </div>)}
              </div>
              {!mapping.bulkBarcode && <p className="field-help">{sheetName === 'BillcoMaster' ? 'Map Bulk Barcode to validate BillcoMaster.' : 'Map Bulk Barcode for bulk fixed labels. If omitted, existing bulk barcodes are retained; new products have no bulk barcode.'}</p>}
            </fieldset>}
            <div className="import-actions">
              <button className="button button-primary" type="submit" disabled={Boolean(busy) || Boolean(fileError(file))}><FileCheck2 size={21} aria-hidden="true" />{busy === 'validating' ? 'Validating…' : 'Validate workbook'}</button>
              <button className="button button-primary" type="button" onClick={() => { void submit('importing') }} disabled={Boolean(busy) || !preview?.rows.length}><Upload size={21} aria-hidden="true" />{committing ? 'Importing…' : 'Import valid rows'}</button>
              <button className="button button-secondary" type="button" onClick={clear} disabled={committing}><RotateCcw size={20} aria-hidden="true" />Clear</button>
            </div>
            {busy && <p className="import-progress" role="status">{committing ? 'Importing valid product rows. Keep this page open until the import finishes.' : busy === 'reading' ? 'Reading worksheet columns. No products have been changed.' : 'Validating the workbook. No products have been changed.'}</p>}
            {error && <p className="import-error" role="alert">{file && <strong>{file.name}: </strong>}{error}</p>}
          </form>
        </section>
        {report && <section className={`panel import-report-panel${result ? ' import-complete' : ''}`} aria-labelledby="import-report-heading">
          <h2 id="import-report-heading" className="panel-heading">{result ? <><CheckCircle2 size={23} aria-hidden="true" />Import complete</> : 'Validation preview'}</h2>
          <p className="import-report-source"><strong>{file?.name}</strong> · Worksheet: <strong>{report.sheetName}</strong></p>
          <ImportCounts report={report} committed={Boolean(result)} />
          <p className="import-report-message" role="status">{result
            ? `${result.added} products added and ${result.updated} updated. ${result.invalidRows} invalid rows were skipped; ${result.blankRows} blank rows were ignored.`
            : `${preview!.rows.length} valid rows are ready to import. ${preview!.invalidRows} invalid rows will be skipped; ${preview!.blankRows} blank rows will be ignored. No products have been changed.`}</p>
          {preview && preview.rows.length > 0 && <div className="import-table-section">
            <h3>Valid product rows</h3>
            <div className="import-table-scroll" tabIndex={0} role="region" aria-label="Valid product rows table">
              <table className="import-table">
                <caption className="sr-only">Valid products from {file?.name}, worksheet {preview.sheetName}</caption>
                <thead><tr><th scope="col">Row</th><th scope="col">Action</th><th scope="col">Part Number</th><th scope="col">Description</th><th scope="col">Bulk Fixed Quantity</th><th scope="col">Package Fixed Quantity</th><th scope="col">Product Barcode</th><th scope="col">Bulk Barcode</th><th scope="col">Status</th></tr></thead>
                <tbody>{preview.rows.slice((rowPage - 1) * PAGE_SIZE, rowPage * PAGE_SIZE).map(({ row, product, action }) => <tr key={row}>
                  <td>{row}</td><td><span className={`import-action import-action-${action}`}>{action === 'add' ? 'Add' : 'Update'}</span></td><td>{product.partNumber}</td><td>{product.description}</td><td>{product.bulkFixedQuantity ?? '—'}</td><td>{product.packageFixedQuantity ?? '—'}</td><td className="import-barcode-value">{product.productBarcode || '—'}</td><td className="import-barcode-value">{product.bulkBarcode || '—'}</td><td>{product.status === 'active' ? 'Active' : 'Inactive'}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <Pagination total={preview.rows.length} page={rowPage} label="Preview rows" onPageChange={setRowPage} />
          </div>}
          {report.errors.length > 0 && <div className="import-table-section">
            <h3>Validation errors</h3>
            <p className="field-help">Row numbers refer to the original worksheet. Correct these rows in your workbook before importing them.</p>
            <div className="import-table-scroll" tabIndex={0} role="region" aria-label="Validation errors table">
              <table className="import-table import-error-table">
                <caption className="sr-only">Validation errors from {file?.name}, worksheet {report.sheetName}</caption>
                <thead><tr><th scope="col">Row</th><th scope="col">Part Number</th><th scope="col">Field</th><th scope="col">Error</th></tr></thead>
                <tbody>{report.errors.slice((errorPage - 1) * PAGE_SIZE, errorPage * PAGE_SIZE).map((item, index) => <tr key={`${item.row}-${item.field}-${index}`}><td>{item.row}</td><td>{item.partNumber || '—'}</td><td>{item.field}</td><td>{item.message}</td></tr>)}</tbody>
              </table>
            </div>
            <Pagination total={report.errors.length} page={errorPage} label="Validation errors" onPageChange={setErrorPage} />
          </div>}
        </section>}
        <div className="import-return"><button className="button button-secondary" type="button" onClick={onNavigateProducts} disabled={committing}>Product Labels<ChevronRight size={20} aria-hidden="true" /></button></div>
      </div>
    </main>
  </div>
}

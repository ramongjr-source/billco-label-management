import { useEffect, useRef, useState, type RefObject } from 'react'
import { Maximize, PackageSearch, X } from 'lucide-react'
import JsBarcode from 'jsbarcode'
import { BillcoLogo } from './BillcoLogo'
import type { LabelData, LabelRules } from '../data/products'

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (ref.current) {
      JsBarcode(ref.current, value, { format: 'CODE128B', width: 3, height: 94, margin: 0, displayValue: false, background: '#ffffff', lineColor: '#000000' })
    }
  }, [value])

  return <div className="barcode-group"><svg ref={ref} className="barcode" role="img" aria-label={`Code 128 barcode for ${value}`} preserveAspectRatio="none" /><span className="barcode-value" aria-hidden="true">{value}</span></div>
}

function LabelDetail({ name, value }: { name: string; value: string }) {
  const text = value.trim() || '—'
  const fontSize = text.length > 16 ? 'calc(var(--detail-font-size) * .53)' : text.length > 10 ? 'calc(var(--detail-font-size) * .7)' : undefined

  return <div className="label-detail flex items-baseline gap-5"><span>{name} #:</span><strong style={{ fontSize }}>{text}</strong></div>
}

function ProductLabel({ data, rules }: { data: LabelData; rules: LabelRules }) {
  return (
    <div className={`product-label ${rules.height === 2 ? 'compact-label' : ''}`} aria-label="Product label preview">
      <div className="label-brand"><BillcoLogo /></div>
      <div className="label-part flex items-baseline gap-4"><span>PART #:</span><strong>{data.product.partNumber}</strong></div>
      <div className="label-description"><span>DESCRIPTION:</span><strong>{data.product.description}</strong></div>
      <LabelDetail name="PO" value={data.poNumber} />
      <LabelDetail name="LOT" value={data.lotNumber} />
      <div className="label-quantity flex items-baseline gap-6"><span>QTY:</span><strong>{data.quantity || '—'}</strong></div>
      {rules.showBarcode && <Barcode value={data.product.barcodeValue} />}
    </div>
  )
}

export function LabelPreviewPanel({ data, rules, previewRef }: { data: LabelData | null; rules: LabelRules; previewRef: RefObject<HTMLElement | null> }) {
  const [expanded, setExpanded] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (expanded && data) dialogRef.current?.showModal()
    else {
      dialogRef.current?.close()
      if (!data && expanded) setExpanded(false)
    }
  }, [expanded, data])

  return (
    <section className="preview-panel panel" aria-labelledby="preview-heading" ref={previewRef} tabIndex={-1}>
      <div className="preview-heading flex items-center gap-3">
        <h2 id="preview-heading">Label Preview</h2>
        <span className="preview-size ml-auto">Label Size ({rules.width}″ × {rules.height}″)</span>
        <button className="expand-button icon-button" type="button" aria-label="Expand label preview" onClick={() => setExpanded(true)} disabled={!data}><Maximize size={25} /></button>
      </div>
      <div className="preview-stage">
        {data ? <ProductLabel data={data} rules={rules} /> : <div className={`empty-preview ${rules.height === 2 ? 'compact-empty-preview' : ''} flex flex-col items-center justify-center gap-3`}><PackageSearch size={45} strokeWidth={1.5} /><h3>Ready for your next label</h3><p>Search an active product to see its label.</p></div>}
      </div>
      <p className="preview-policy">{rules.quantityEditable ? 'Editable quantity · No barcode' : 'Fixed quantity · Barcode included'}</p>
      <dialog className="preview-dialog" ref={dialogRef} onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)} aria-labelledby="expanded-preview-heading">
        <div className="flex items-center justify-between gap-4"><h2 id="expanded-preview-heading">Label Preview · {rules.width}″ × {rules.height}″</h2><button type="button" className="icon-button" aria-label="Close expanded preview" onClick={() => setExpanded(false)}><X size={25} /></button></div>
        {expanded && data && <ProductLabel data={data} rules={rules} />}
      </dialog>
    </section>
  )
}

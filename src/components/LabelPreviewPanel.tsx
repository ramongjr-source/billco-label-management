import { useEffect, useRef, useState, type RefObject } from 'react'
import { Maximize, PackageSearch, X } from 'lucide-react'
import { ProductLabel } from './ProductLabel'
import type { LabelData, LabelRules } from '../data/products'

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

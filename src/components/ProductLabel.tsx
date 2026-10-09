import { useLayoutEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import type { LabelData, LabelRules } from '../data/products'

/** Fit complete imported text into its allocated area without ellipses or clipping. */
function FittedText({ children, className = '', dominant = false }: { children: string; className?: string; dominant?: boolean }) {
  const ref = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const element = ref.current!
    let active = true
    const fit = () => {
      if (!active) return
      element.style.fontSize = ''
      const maximum = parseFloat(getComputedStyle(element).fontSize)
      let low = 1
      let high = maximum
      for (let step = 0; step < 12; step += 1) {
        const size = (low + high) / 2
        element.style.fontSize = `${size}px`
        if (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight) high = size
        else low = size
      }
      element.style.fontSize = `${low}px`
      if (dominant) element.closest<HTMLElement>('.product-label')?.style.setProperty('--part-font-size', `${low}px`)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    void document.fonts.ready.then(fit)
    return () => { active = false; observer.disconnect() }
  }, [children, dominant])

  return <strong ref={ref} className={className}>{children}</strong>
}

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useLayoutEffect(() => {
    JsBarcode(ref.current!, value, { format: 'CODE128B', width: 2, height: 80, margin: 0, displayValue: false, background: '#fff', lineColor: '#000' })
  }, [value])
  return <div className="barcode-group">
    <svg ref={ref} className="barcode" role="img" aria-label={`Code 128 barcode for ${value}`} preserveAspectRatio="none" />
    <span className="barcode-value">{value}</span>
  </div>
}

function LabelDetail({ name, value }: { name: 'PO' | 'LOT'; value: string }) {
  return <div className={`label-detail label-${name.toLowerCase()}`}>
    <span>{name} #</span><FittedText>{value.trim() || '—'}</FittedText>
  </div>
}

export function ProductLabel({ data, rules }: { data: LabelData; rules: LabelRules }) {
  const compact = rules.height === 2
  return <div
    className={`product-label${compact ? ' compact-label' : ''}${rules.showBarcode ? '' : ' no-barcode'}`}
    style={{ aspectRatio: `${rules.width} / ${rules.height}` }}
    aria-label="Product label preview"
  >
    <div className="label-brand" aria-label="Billco Corporation"><strong>BILLCO</strong><span>CORPORATION</span></div>
    <div className="label-part"><span>PART #</span><FittedText dominant>{data.product.partNumber}</FittedText></div>
    {!compact && <div className="label-description"><span>DESCRIPTION</span><FittedText>{data.product.description}</FittedText></div>}
    <div className="label-quantity"><span>QTY</span><strong>{data.quantity || '—'}</strong></div>
    <div className="label-details">
      {!compact && <LabelDetail name="PO" value={data.poNumber} />}
      <LabelDetail name="LOT" value={data.lotNumber} />
    </div>
    {rules.showBarcode && <Barcode value={compact ? data.product.productBarcode : data.product.bulkBarcode} />}
  </div>
}

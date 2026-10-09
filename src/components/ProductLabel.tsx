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

function CompactDescription({ description }: { description: string }) {
  const ref = useRef<HTMLElement>(null)
  const text = description.replace(/\s+/g, ' ').trim()

  useLayoutEffect(() => {
    const element = ref.current!
    let active = true
    const fit = () => {
      if (!active) return
      const fits = () => element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth
      element.textContent = text
      if (fits()) return
      const characters = Array.from(text)
      const shortened = (length: number) => `${characters.slice(0, length).join('').trimEnd()}...`
      let low = 0
      let high = characters.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        element.textContent = shortened(middle)
        if (fits()) low = middle
        else high = middle - 1
      }
      element.textContent = shortened(low)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    void document.fonts.ready.then(fit)
    return () => { active = false; observer.disconnect() }
  }, [text])

  return <div className="label-description"><span>DESCRIPTION</span><strong ref={ref} title={description}>{text}</strong></div>
}

export function ProductLabel({ data, rules }: { data: LabelData; rules: LabelRules }) {
  const compact = rules.height === 2
  const hasDescription = compact && Boolean(data.product.description.trim())
  return <div
    className={`product-label${compact ? ' compact-label' : ''}${hasDescription ? ' has-description' : ''}${rules.showBarcode ? '' : ' no-barcode'}`}
    style={{ aspectRatio: `${rules.width} / ${rules.height}` }}
    aria-label="Product label preview"
  >
    <div className="label-brand" aria-label="Billco Corporation"><strong>BILLCO</strong><span>CORPORATION</span></div>
    <div className="label-part"><span>PART #</span><FittedText dominant>{data.product.partNumber}</FittedText></div>
    {!compact && <div className="label-description"><span>DESCRIPTION</span><FittedText>{data.product.description}</FittedText></div>}
    {hasDescription && <CompactDescription description={data.product.description} />}
    <div className="label-quantity"><span>QTY</span><strong>{data.quantity || '—'}</strong></div>
    <div className="label-details">
      {!compact && <LabelDetail name="PO" value={data.poNumber} />}
      <LabelDetail name="LOT" value={data.lotNumber} />
    </div>
    {rules.showBarcode && <Barcode value={compact ? data.product.productBarcode : data.product.bulkBarcode} />}
  </div>
}

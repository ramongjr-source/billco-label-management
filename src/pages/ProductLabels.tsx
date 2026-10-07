import { useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Header } from '../components/Header'
import { Sidebar } from '../components/Sidebar'
import { ProductSearchForm } from '../components/ProductSearchForm'
import { LabelPreviewPanel } from '../components/LabelPreviewPanel'
import { fixedQuantity, getLabelRules, labelTypes, sampleProducts, type LabelType, type Product } from '../data/products'

export function ProductLabels() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [partNumber, setPartNumber] = useState('5080')
  const [product, setProduct] = useState<Product | null>(sampleProducts[0])
  const [searchMessage, setSearchMessage] = useState('Sample product 5080 loaded.')
  const [poNumber, setPoNumber] = useState('456789')
  const [lotNumber, setLotNumber] = useState('241007')
  const [quantity, setQuantity] = useState('500')
  const [labelType, setLabelType] = useState<LabelType>('bulk-fixed')
  const previewRef = useRef<HTMLElement>(null)
  const selectedType = labelTypes.find((type) => type.id === labelType)!
  const labelRules = getLabelRules(labelType)
  const validQuantity = /^\d+$/.test(quantity) && Number(quantity) >= 1 && Number(quantity) <= 999999

  function selectLabelType(type: LabelType) {
    setLabelType(type)
    setMenuOpen(false)
    if (product && type !== labelType) setQuantity(getLabelRules(type).quantityEditable ? '' : fixedQuantity(product, type))
  }

  function search() {
    if (!partNumber.trim()) {
      setProduct(null)
      setQuantity('')
      setSearchMessage('Enter a part number. Try 5080, 5081, or 5082.')
      return
    }
    const match = sampleProducts.find((item) => item.partNumber === partNumber.trim())
    setProduct(match ?? null)
    if (match) {
      setPartNumber(match.partNumber)
      setQuantity(labelRules.quantityEditable ? '' : fixedQuantity(match, labelType))
      setSearchMessage(`Sample product ${match.partNumber} loaded.`)
    } else {
      setQuantity('')
      setSearchMessage(`No sample product found for “${partNumber.trim()}”. Try 5080, 5081, or 5082.`)
    }
  }

  function clear() {
    setPartNumber('')
    setProduct(null)
    setSearchMessage('')
    setPoNumber('')
    setLotNumber('')
    setQuantity('')
    setLabelType('bulk-fixed')
    document.getElementById('part-number')?.focus()
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to label workspace</a>
      <Header menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((open) => !open)} />
      {menuOpen && <button className="nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <Sidebar open={menuOpen} labelType={labelType} onSelectLabelType={selectLabelType} />
      <main id="main-content" className="workspace">
        <div className="workspace-grid">
          <div className="form-column min-w-0">
            <nav className="breadcrumb flex items-center gap-3" aria-label="Breadcrumb"><span>Product Labels</span><ChevronRight size={17} aria-hidden="true" /><span aria-current="page">{selectedType.name}</span></nav>
            <div className="page-heading"><h1>{selectedType.title}</h1><p>{selectedType.subtitle}</p></div>
            <ProductSearchForm
              partNumber={partNumber} product={product} searchMessage={searchMessage}
              poNumber={poNumber} lotNumber={lotNumber} quantity={quantity}
              labelType={labelType} quantityEditable={labelRules.quantityEditable}
              onPartNumberChange={(value) => { setPartNumber(value); setProduct(null); setQuantity(''); setSearchMessage('') }}
              onSearch={search} onPoNumberChange={setPoNumber} onLotNumberChange={setLotNumber} onQuantityChange={setQuantity}
              onLabelTypeChange={selectLabelType}
              onPreview={() => { previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); previewRef.current?.focus({ preventScroll: true }) }}
              onClear={clear}
            />
          </div>
          <div className="preview-column min-w-0">
            <LabelPreviewPanel rules={labelRules} previewRef={previewRef} data={product ? { product, poNumber, lotNumber, quantity: validQuantity ? quantity : '' } : null} />
            {product && !validQuantity && <p className="preview-warning" role="status">Enter a positive whole-number quantity, up to 999999, to complete the label.</p>}
          </div>
        </div>
      </main>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Header } from '../components/Header'
import { Sidebar } from '../components/Sidebar'
import { ProductSearchForm } from '../components/ProductSearchForm'
import { LabelPreviewPanel } from '../components/LabelPreviewPanel'
import { fixedQuantity, getLabelRules, labelTypes, type LabelType, type Product } from '../data/products'
import { lookupProduct, ProductLookupError } from '../data/productLookup'

export function ProductLabels() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [partNumber, setPartNumber] = useState('5080')
  const [product, setProduct] = useState<Product | null>(null)
  const [searchMessage, setSearchMessage] = useState('')
  const [searchError, setSearchError] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [poNumber, setPoNumber] = useState('456789')
  const [lotNumber, setLotNumber] = useState('241007')
  const [quantity, setQuantity] = useState('')
  const [labelType, setLabelType] = useState<LabelType>('bulk-fixed')
  const labelTypeRef = useRef<LabelType>('bulk-fixed')
  const requestIdRef = useRef(0)
  const requestControllerRef = useRef<AbortController | null>(null)
  const previewRef = useRef<HTMLElement>(null)
  const selectedType = labelTypes.find((type) => type.id === labelType)!
  const labelRules = getLabelRules(labelType)
  const validQuantity = /^\d+$/.test(quantity) && Number(quantity) >= 1 && Number(quantity) <= 999999
  const activeProduct = product?.status === 'active' ? product : null

  const cancelLookup = useCallback(() => {
    requestIdRef.current += 1
    requestControllerRef.current?.abort()
    requestControllerRef.current = null
  }, [])

  const search = useCallback(async (query: string) => {
    cancelLookup()
    setProduct(null)
    setQuantity('')
    setSearchError(false)
    const part = query.trim()
    if (!part) {
      setIsSearching(false)
      setSearchError(true)
      setSearchMessage('Enter a part number.')
      return
    }
    const requestId = requestIdRef.current
    const controller = new AbortController()
    requestControllerRef.current = controller
    setIsSearching(true)
    setSearchMessage('Searching for your product…')
    try {
      const match = await lookupProduct(part, controller.signal)
      if (requestId !== requestIdRef.current) return
      setProduct(match)
      setPartNumber(match.partNumber)
      const currentType = labelTypeRef.current
      setQuantity(match.status === 'active' && !getLabelRules(currentType).quantityEditable ? fixedQuantity(match, currentType) : '')
      setSearchMessage(match.status === 'active'
        ? `Product ${match.partNumber} loaded.`
        : `Product ${match.partNumber} is inactive. Choose an active product to create a label.`)
    } catch (error) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      setSearchError(true)
      setSearchMessage(error instanceof ProductLookupError ? error.message : 'Product lookup is unavailable. Please try again.')
    } finally {
      if (requestId === requestIdRef.current) {
        requestControllerRef.current = null
        setIsSearching(false)
      }
    }
  }, [cancelLookup])

  useEffect(() => {
    void search('5080')
    return cancelLookup
  }, [search, cancelLookup])

  function selectLabelType(type: LabelType) {
    const changed = type !== labelTypeRef.current
    labelTypeRef.current = type
    setLabelType(type)
    setMenuOpen(false)
    if (changed) setQuantity(activeProduct && !getLabelRules(type).quantityEditable ? fixedQuantity(activeProduct, type) : '')
  }

  function changePartNumber(value: string) {
    cancelLookup()
    setPartNumber(value)
    setProduct(null)
    setQuantity('')
    setSearchMessage('')
    setSearchError(false)
    setIsSearching(false)
  }

  function clear() {
    cancelLookup()
    setPartNumber('')
    setProduct(null)
    setSearchMessage('')
    setSearchError(false)
    setIsSearching(false)
    setPoNumber('')
    setLotNumber('')
    setQuantity('')
    setLabelType('bulk-fixed')
    labelTypeRef.current = 'bulk-fixed'
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
              searchError={searchError} isSearching={isSearching} canPreview={Boolean(activeProduct)}
              poNumber={poNumber} lotNumber={lotNumber} quantity={quantity}
              labelType={labelType} quantityEditable={labelRules.quantityEditable}
              onPartNumberChange={changePartNumber}
              onSearch={() => { void search(partNumber) }} onPoNumberChange={setPoNumber} onLotNumberChange={setLotNumber} onQuantityChange={setQuantity}
              onLabelTypeChange={selectLabelType}
              onPreview={() => { previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); previewRef.current?.focus({ preventScroll: true }) }}
              onClear={clear}
            />
          </div>
          <div className="preview-column min-w-0">
            <LabelPreviewPanel rules={labelRules} previewRef={previewRef} data={activeProduct ? { product: activeProduct, poNumber, lotNumber, quantity: validQuantity ? quantity : '' } : null} />
            {activeProduct && !validQuantity && <p className="preview-warning" role="status">Enter a positive whole-number quantity, up to 999999, to complete the label.</p>}
          </div>
        </div>
      </main>
    </div>
  )
}

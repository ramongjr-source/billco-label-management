import { FileSearch, LockKeyhole, Printer, RotateCcw, Search } from 'lucide-react'
import { labelTypes, type LabelType, type Product } from '../data/products'

interface ProductSearchFormProps {
  partNumber: string
  product: Product | null
  searchMessage: string
  poNumber: string
  lotNumber: string
  quantity: string
  labelType: LabelType
  quantityEditable: boolean
  onPartNumberChange: (value: string) => void
  onSearch: () => void
  onPoNumberChange: (value: string) => void
  onLotNumberChange: (value: string) => void
  onQuantityChange: (value: string) => void
  onLabelTypeChange: (type: LabelType) => void
  onPreview: () => void
  onClear: () => void
}

function Required() {
  return <span className="required-mark" aria-hidden="true"> *</span>
}

export function ProductSearchForm(props: ProductSearchFormProps) {
  return (
    <section className="information-panel panel" aria-labelledby="information-heading">
      <h2 id="information-heading" className="panel-heading">Label Information</h2>
      <form noValidate onSubmit={(event) => { event.preventDefault(); props.onSearch() }}>
        <div className="field-group">
          <label htmlFor="part-number">Part Number<Required /></label>
          <div className="search-row grid gap-3">
            <input id="part-number" value={props.partNumber} onChange={(event) => props.onPartNumberChange(event.target.value)} placeholder="Enter a part number" required autoComplete="off" aria-describedby="product-search-help product-search-status" aria-invalid={Boolean(props.searchMessage && !props.product)} />
            <button className="button button-primary search-button" type="submit"><Search size={23} aria-hidden="true" /> Search</button>
          </div>
          <p id="product-search-help" className="sr-only">Sample parts: 5080, 5081, 5082</p>
          <p id="product-search-status" className={props.product ? 'sr-only' : 'search-status'} role="status">{props.searchMessage}</p>
        </div>
        <div className="field-group">
          <label htmlFor="description">Description</label>
          <input id="description" value={props.product?.description ?? ''} readOnly placeholder="Search for a product" />
        </div>
        <div className="field-group">
          <label htmlFor="customer">Customer</label>
          <select id="customer" defaultValue="billco-stock"><option value="billco-stock">BILLCO STOCK</option></select>
        </div>
        <div className="field-group grid grid-cols-2 gap-4">
          <div><label htmlFor="po-number">PO Number<Required /></label><input id="po-number" value={props.poNumber} onChange={(event) => props.onPoNumberChange(event.target.value)} required maxLength={32} autoComplete="off" /></div>
          <div><label htmlFor="lot-number">Lot Number<Required /></label><input id="lot-number" value={props.lotNumber} onChange={(event) => props.onLotNumberChange(event.target.value)} required maxLength={32} autoComplete="off" /></div>
        </div>
        <div className="field-group">
          <label htmlFor="quantity">Quantity<Required /></label>
          <div className="quantity-input relative">
            <input id="quantity" type="number" min="1" max="999999" step="1" value={props.quantity} onChange={(event) => props.onQuantityChange(event.target.value)} readOnly={!props.quantityEditable} required aria-describedby="quantity-help" />
            {!props.quantityEditable && <LockKeyhole size={18} className="quantity-lock" aria-label="Quantity locked" />}
          </div>
          <span id="quantity-help" className="sr-only">{props.quantityEditable ? 'Enter a positive whole number, up to 999999.' : 'Fixed quantity from the sample product.'}</span>
        </div>
        <fieldset className="label-type-group">
          <legend>Label Type</legend>
          {labelTypes.map((type) => (
            <label className="choice-row flex items-center gap-3" key={type.id}><input type="radio" name="label-type" value={type.id} checked={props.labelType === type.id} onChange={() => props.onLabelTypeChange(type.id)} />{type.name}</label>
          ))}
        </fieldset>
        <div className="form-actions grid gap-3">
          <button className="button button-primary print-button" type="button" disabled title="Printing is not available in this UI prototype." aria-describedby="printing-note"><Printer size={27} aria-hidden="true" /> PRINT</button>
          <button className="button button-secondary" type="button" onClick={props.onPreview} disabled={!props.product}><FileSearch size={25} aria-hidden="true" /> PREVIEW</button>
          <button className="button button-secondary" type="button" onClick={props.onClear}><RotateCcw size={24} aria-hidden="true" /> CLEAR</button>
        </div>
        <p id="printing-note" className="field-help sr-only max-md:not-sr-only max-md:mt-3 max-md:text-center">Sample parts: 5080, 5081, 5082. Preview only; printing unavailable.</p>
      </form>
    </section>
  )
}

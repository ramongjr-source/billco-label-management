import { useState } from 'react'
import { ProductLabels } from './pages/ProductLabels'
import { ProductImport } from './pages/ProductImport'
import { PrinterSetup } from './pages/PrinterSetup'
import type { LabelType } from './data/products'

export function App() {
  const [page, setPage] = useState<'product-labels' | 'product-import' | 'printer-setup'>('product-labels')
  const [labelType, setLabelType] = useState<LabelType>('bulk-fixed')

  if (page === 'product-import') {
    return <ProductImport labelType={labelType} onNavigateProducts={() => setPage('product-labels')} onNavigatePrinters={() => setPage('printer-setup')} onSelectLabelType={(type) => { setLabelType(type); setPage('product-labels') }} />
  }

  if (page === 'printer-setup') {
    return <PrinterSetup labelType={labelType} onNavigateImport={() => setPage('product-import')} onSelectLabelType={(type) => { setLabelType(type); setPage('product-labels') }} />
  }

  return <ProductLabels initialLabelType={labelType} onLabelTypeChange={setLabelType} onNavigateImport={() => setPage('product-import')} onNavigatePrinters={() => setPage('printer-setup')} />
}

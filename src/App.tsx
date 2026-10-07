import { useState } from 'react'
import { ProductLabels } from './pages/ProductLabels'
import { ProductImport } from './pages/ProductImport'
import type { LabelType } from './data/products'

export function App() {
  const [page, setPage] = useState<'product-labels' | 'product-import'>('product-labels')
  const [labelType, setLabelType] = useState<LabelType>('bulk-fixed')

  if (page === 'product-import') {
    return <ProductImport labelType={labelType} onNavigateProducts={() => setPage('product-labels')} onSelectLabelType={(type) => { setLabelType(type); setPage('product-labels') }} />
  }

  return <ProductLabels initialLabelType={labelType} onLabelTypeChange={setLabelType} onNavigateImport={() => setPage('product-import')} />
}

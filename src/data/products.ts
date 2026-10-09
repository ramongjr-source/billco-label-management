import type { Product } from '../../shared/product.js'

export type { Product } from '../../shared/product.js'

export const labelTypes = [
  { id: 'bulk-fixed', name: 'Bulk Fixed Qty', title: 'Bulk Fixed Quantity Labels', subtitle: 'Create 3 × 5 product labels with a fixed quantity.' },
  { id: 'bulk-variable', name: 'Bulk Variable Qty', title: 'Bulk Variable Quantity Labels', subtitle: 'Create 3 × 5 labels with an editable quantity.' },
  { id: 'package-fixed', name: 'Package Fixed Qty', title: 'Package Fixed Quantity Labels', subtitle: 'Create 3 × 2 product labels with a fixed package quantity.' },
  { id: 'bcc', name: 'BCC', title: 'BCC Labels', subtitle: 'Create 3 × 2 BCC labels with an editable quantity and no barcode.' },
] as const

export type LabelType = (typeof labelTypes)[number]['id']

export interface LabelRules {
  width: 3
  height: 2 | 5
  quantityEditable: boolean
  showBarcode: boolean
}

export function getLabelRules(type: LabelType): LabelRules {
  const quantityEditable = type === 'bulk-variable' || type === 'bcc'
  return {
    width: 3,
    height: type === 'package-fixed' || type === 'bcc' ? 2 : 5,
    quantityEditable,
    // Barcodes are permitted only when the quantity is fixed.
    showBarcode: !quantityEditable,
  }
}

export function fixedQuantity(product: Product, type: LabelType): string {
  return String((type === 'package-fixed' ? product.packageFixedQuantity : product.bulkFixedQuantity) ?? '')
}

export interface LabelData {
  product: Product
  poNumber: string
  lotNumber: string
  quantity: string
}

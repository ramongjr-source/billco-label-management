export interface Product {
  partNumber: string
  description: string
  barcode: string
  bulkQuantity: number
  packageQuantity: number
}

// Local fixtures for the UI prototype; there is no database or persistence.
export const sampleProducts: Product[] = [
  { partNumber: '5080', description: '3/8 Brass Coupling', barcode: '5080', bulkQuantity: 500, packageQuantity: 50 },
  { partNumber: '5081', description: '3/8 Brass Elbow', barcode: '5081', bulkQuantity: 250, packageQuantity: 25 },
  { partNumber: '5082', description: '1/2 Brass Adapter', barcode: '5082', bulkQuantity: 200, packageQuantity: 20 },
]

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
  return String(type === 'package-fixed' ? product.packageQuantity : product.bulkQuantity)
}

export interface LabelData {
  product: Product
  poNumber: string
  lotNumber: string
  quantity: string
}

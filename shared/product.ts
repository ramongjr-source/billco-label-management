export interface Product {
  partNumber: string
  description: string
  bulkFixedQuantity: number | null
  packageFixedQuantity: number | null
  productBarcode: string
  bulkBarcode: string
  status: 'active' | 'inactive'
}

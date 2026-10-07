export interface Product {
  partNumber: string
  description: string
  bulkFixedQuantity: number
  packageFixedQuantity: number
  barcodeValue: string
  status: 'active' | 'inactive'
}

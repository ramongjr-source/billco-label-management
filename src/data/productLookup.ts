import type { Product } from '../../shared/product.js'

export class ProductLookupError extends Error {}

function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== 'object') return false
  const product = value as Partial<Product>
  const validQuantity = (quantity: unknown) => typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 1 && quantity <= 999999
  return typeof product.partNumber === 'string' && product.partNumber.trim().length > 0
    && typeof product.description === 'string' && product.description.trim().length > 0
    && typeof product.barcodeValue === 'string' && /^[\x20-\x7e]+$/.test(product.barcodeValue)
    && validQuantity(product.bulkFixedQuantity) && validQuantity(product.packageFixedQuantity)
    && (product.status === 'active' || product.status === 'inactive')
}

export async function lookupProduct(partNumber: string, signal: AbortSignal): Promise<Product> {
  const response = await fetch(`/api/products?partNumber=${encodeURIComponent(partNumber)}`, { signal })
  if (response.status === 404) throw new ProductLookupError(`No product found for “${partNumber}”.`)
  if (response.status === 400) throw new ProductLookupError('Enter a valid part number and search again.')
  if (!response.ok) throw new ProductLookupError('Product lookup is unavailable. Please try again.')
  const product: unknown = await response.json()
  if (!isProduct(product)) throw new ProductLookupError('Product lookup is unavailable. Please try again.')
  return product
}

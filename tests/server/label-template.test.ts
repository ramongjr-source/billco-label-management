import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductLabel } from '../../src/components/ProductLabel.js'
import { getLabelRules, type LabelData } from '../../src/data/products.js'

test('compact templates omit blank descriptions while retaining the part, quantity, lot, and barcode rules', () => {
  const data: LabelData = {
    product: { partNumber: 'PA.013', description: ' \t\n ', bulkFixedQuantity: 500, packageFixedQuantity: 100, productBarcode: 'PRODUCT-001', bulkBarcode: 'BULK-001', status: 'active' },
    quantity: '100', lotNumber: '241007', poNumber: '456789',
  }
  for (const type of ['package-fixed', 'bcc'] as const) {
    const html = renderToStaticMarkup(createElement(ProductLabel, { data, rules: getLabelRules(type) }))
    assert.doesNotMatch(html, /label-description|has-description|DESCRIPTION/)
    assert.match(html, /PA\.013/)
    assert.match(html, /241007/)
    assert.match(html, /QTY/)
    if (type === 'package-fixed') assert.match(html, /Code 128 barcode for PRODUCT-001/)
    else assert.doesNotMatch(html, /barcode-group|PRODUCT-001|BULK-001/)
  }
})

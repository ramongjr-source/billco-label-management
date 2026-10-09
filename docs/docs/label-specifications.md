# Standard Product Label

Common fields:

- Billco Corporation
- Part Number
- Lot Number
- Quantity
- Barcode (fixed-quantity labels only)

Bulk Fixed and Bulk Variable also show Description and PO Number. The compact
Package Fixed and BCC layouts omit both fields.

Bulk Fixed encodes the imported Bulk Barcode and uses Bulk Fixed Quantity.
Package Fixed encodes the imported Product Barcode and uses Package Fixed Quantity.
No barcode is derived from Part Number or substituted from another field.

Product label types are mutually exclusive. Operators select one of these
four types; the application automatically selects its label dimensions.

| Label type | Size | Quantity | Barcode |
| --- | --- | --- | --- |
| Bulk Fixed | 3 x 5 inches | Fixed and locked | Included |
| Bulk Variable | 3 x 5 inches | Operator-entered and editable | None |
| Package Fixed | 3 x 2 inches | Fixed and locked | Included |
| BCC | 3 x 2 inches | Operator-entered and editable | None |

BCC is a standalone label type.

Only Bulk Fixed and Package Fixed labels contain barcodes.
Bulk Variable and BCC labels have editable quantities
and must not contain a barcode.

Excluded:

- Address
- Website
- Product Images

Printing:

- Monochrome
- Thermal Printer
- SATO Compatible

The current implementation is preview rendering only; printing, printer
integration, and PDF generation are not implemented.

## Thermal preview hierarchy

Part Number is boxed and is the largest text on every label. Bulk labels rank
Part Number, Description, Quantity, PO Number, Lot Number, then Barcode.
Compact labels rank Part Number, Quantity, Lot Number, then Barcode.
Quantity must remain smaller than Part Number.

Use only black ink on white stock, upright sans-serif text, and flat BILLCO
CORPORATION branding. No italics, slanted text, decorative fonts, color graphics,
addresses, websites, rounded label corners, or decorative shadows.

Preserve complete imported text; fit long values within their allocated areas
while keeping Part Number dominant. Normal and expanded previews share the
same renderer and retain the 3x5 or 3x2 aspect ratio at all viewport widths.

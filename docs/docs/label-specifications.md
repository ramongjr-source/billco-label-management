# Standard Product Label

Common fields:

- Billco Corporation
- Part Number
- Lot Number
- Quantity
- Barcode (fixed-quantity labels only)

All formats show Description when nonblank. Bulk Fixed and Bulk Variable also
show PO Number; compact formats omit PO Number. Package Fixed, BCC, and future
3x2 formats wrap descriptions to two lines, truncating overflow with `...`.
This does not change 3x5 description rendering.

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
Compact labels rank Part Number, Description, Quantity, Lot Number, then Barcode.
Adding Description must not shrink the existing Part Number text or boxed area.
Quantity must remain smaller than Part Number.

Use only black ink on white stock, upright sans-serif text, and flat BILLCO
CORPORATION branding. No italics, slanted text, decorative fonts, color graphics,
addresses, websites, rounded label corners, or decorative shadows.

Preserve complete Part Numbers and fit them within their allocated areas.
Compact descriptions show at most two lines; the full description is available
on hover. Normal and expanded previews share the
same renderer and retain the 3x5 or 3x2 aspect ratio at all viewport widths.

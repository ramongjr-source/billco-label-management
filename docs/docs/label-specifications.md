# Standard Product Label

Fields:

- Billco Corporation
- Part Number
- Description
- PO Number
- Lot Number
- Quantity
- Barcode (fixed-quantity labels only)

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

# Business Rules

## Label Formats

### 3x5 Label

Used for:

- Bulk Fixed Quantity
- Bulk Variable Quantity

### 3x2 Label

Used for:

- Package Fixed Quantity
- BCC Labels

---

## Bulk Fixed

- Uses 3x5 label format
- Quantity is pulled from product master
- Quantity is locked
- Barcode is included

---

## Bulk Variable

- Uses 3x5 label format
- Quantity is entered by operator
- Quantity is editable
- No barcode

---

## Package Fixed

- Uses 3x2 label format
- Quantity is pulled from product master
- Quantity is locked
- Barcode is included

---

## BCC

- Uses 3x2 label format
- Quantity is entered by operator
- Quantity is editable
- No barcode

---

## Barcode Rules

Barcodes appear only on fixed-quantity labels.

Editable quantity labels shall not display or print a barcode.

Examples:

- Bulk Fixed → Barcode
- Package Fixed → Barcode
- Bulk Variable → No Barcode
- BCC → No Barcode

---

## Label Format Selection

The application automatically selects the label format.

Mappings:

- Bulk Fixed → 3x5
- Bulk Variable → 3x5
- Package Fixed → 3x2
- BCC → 3x2

Operators do not manually select label dimensions.

---

## Required Label Fields

- Part Number
- Lot Number
- Quantity

Bulk Fixed and Bulk Variable also display Description and PO Number.
Package Fixed and BCC use the compact layout and omit Description and PO Number.

Fixed-quantity labels shall also display:

- Product Barcode on Package Fixed
- Bulk Barcode on Bulk Fixed

## Preview Rendering

- Use imported database fields, with no generated or substituted barcodes.
- Make Part Number the largest text on every label; Quantity must be smaller.
- Use flat BILLCO CORPORATION branding, black ink, white stock, and upright
  industrial typography. Exclude addresses, websites, and decorative graphics.
- Show proportional 3x5 or 3x2 previews and the matching size caption.
- Update automatically on label type, Part Number, quantity, PO, or lot edits.
- Missing bulk quantity or barcode affects only Bulk Fixed availability.
- Render previews only; printing, SATO integration, PDF generation, customer
  labels, pallet placards, and Will Call labels are outside this implementation.

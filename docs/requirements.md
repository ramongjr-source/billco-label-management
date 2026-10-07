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
- Description
- PO Number
- Lot Number
- Quantity

Fixed-quantity labels shall also display:

- Barcode

# billco-label-management
# Billco Labeling Platform

## Run the UI prototype

Requires Node.js 22.12+ (Node.js 24 recommended) and npm.

```sh
npm ci
npm run dev
```

In the cloud workspace, use `npm ci --cache /workspace/.cache/npm` for a
writable dependency cache.

Open the address shown by Vite. The Product Labels page follows
[`docs/Designer.jpg`](docs/Designer.jpg) and
[`docs/docs/label-specifications.md`](docs/docs/label-specifications.md).
The initial sample is part **5080**; sample parts **5081** and **5082** are also
available. Search a part, edit PO/lot details, select a label type, and use BCC
to override fixed quantities. The label updates locally; fixed-quantity labels
include a real Code 128 barcode. Any editable quantity suppresses the barcode.
The preview can be expanded, and Clear resets the workspace.

| Label mode | Size | Quantity | Barcode |
| --- | --- | --- | --- |
| Bulk Fixed | 3 × 5 inches | Fixed | Included |
| Bulk Variable | 3 × 5 inches | Editable | None |
| Package Fixed | 3 × 2 inches | Fixed | Included |
| BCC (any label type) | 3 × 2 inches | Editable | None |

This is a frontend prototype using sample data. Database, authentication,
Excel import, printing, and reporting are outside its scope. Print and
navigation for those features are disabled.

```sh
npm run build        # TypeScript checks and production bundle
npm run preview      # Serve the production bundle
npx playwright install chromium
npm test             # Browser tests for lookup, quantities, preview, and mobile
```

For an existing Chromium installation, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable when running tests.
Fonts are bundled locally; no external font service or API is required.

## Overview

Billco Labeling Platform is a centralized labeling application designed for Billco Corporation's packaging, shipping, warehouse, and customer service operations.

The goal is to provide a simple, fast, and reliable system for creating and printing labels directly from a maintained product database.

The application is optimized for manufacturing and warehouse environments where operators need to:

1. Search a part number
2. Verify product information
3. Select a label type
4. Preview the label
5. Print

---

# Design Principles

- Operator-focused
- Minimal training required
- Fast part lookup
- Large label preview
- Direct printing workflow
- Consistent Billco branding
- Support for future label expansion

---

# Core Features

## Product Database

Maintain a master list of products including:

- Part Number
- Description
- Barcode Value
- Bulk Fixed Quantity
- Package Fixed Quantity
- Status (Active/Inactive)

---

## Excel Import

Import and update products from Excel files.

Requirements:

- Support master product lists
- Support future imports
- Prevent duplicate part numbers
- Validate required fields

---

## Product Search

Users must be able to search products by:

- Part Number
- Description (future enhancement)

Search results should automatically populate label fields.

---

## Label Preview

Display a live preview before printing.

Preview should closely represent the final printed label.

Requirements:

- Large preview area
- Monochrome label display
- Real barcode rendering
- Instant updates as values change

---

## Printing

Primary user action.

Requirements:

- Print button
- SATO printer support
- Print history logging
- Error feedback

---

# Label Types

## Bulk Fixed Quantity

Quantity is automatically populated using the product master data.

Quantity field is locked.

Example:

Qty: 500

---

## Bulk Variable Quantity

Quantity field is editable by the operator.

Example:

Qty: User Entered

---

## Package Fixed Quantity

Quantity is automatically populated using package quantity rules.

Quantity field is locked.

Example:

Qty: 50

---

# BCC Labels

BCC is not a separate label format.

BCC acts as a modifier.

When enabled:

- Quantity becomes editable
- Label layout remains unchanged

Example:

Bulk Fixed + BCC = Editable Quantity

---

# Shipping Labels

## Will Call Label

Fields:

- Customer Name
- PO Number
- Box Count

---

## Pallet Placard

Fields:

- Customer Name
- PO Number
- Pallet Quantity
- Total Quantity

---

# Standard Product Label Layout

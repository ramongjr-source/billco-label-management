# billco-label-management
# Billco Labeling Platform

## Run the application

Requires Node.js 22.13+ (Node.js 24 recommended) and npm. The product database
uses Node's built-in `node:sqlite`; no separate database service is required.

```sh
npm ci
npm run dev
```

In the cloud workspace, use `npm ci --cache /workspace/.cache/npm` for a
writable dependency cache.

Open the address shown by Vite. The Product Labels page follows
[`docs/Designer.jpg`](docs/Designer.jpg) and
[`docs/docs/label-specifications.md`](docs/docs/label-specifications.md).
`npm run dev` initializes the local SQLite database and starts the API on port
**3001** and Vite on port **5173**. Set `API_PORT` or `UI_PORT` to use different
ports. Vite forwards `/api` requests to the local API.

The initial product **5080** is loaded from the API. Development seeds also
include active parts **5081**, **5082**, and **5083**, plus inactive part
**5090**. Search a part, edit PO/lot details, and select one of four label
types: Bulk Fixed, Bulk Variable, Package Fixed, or BCC. The label updates
live; fixed-quantity labels include a real Code 128 barcode. Any editable
quantity suppresses the barcode. Inactive product information is visible,
but its quantity and label preview remain unavailable.
The preview can be expanded, and Clear resets the workspace.
Part Number edits automatically look up the product after a 300 ms pause;
Search and Enter still perform an immediate lookup. A pending lookup clears the
previous product's preview, and cancelled or stale responses cannot restore it.
The label itself uses flat black-and-white thermal styling with a boxed Part
Number as its largest text. Bulk labels show description, quantity, PO, and lot;
compact Package Fixed and BCC labels show Part Number, quantity, and lot.
See [`docs/label-preview.md`](docs/label-preview.md) for layouts and screenshots.
Selecting Bulk Variable or BCC clears the quantity, and product lookups in
either type require a new operator-entered quantity.

| Label type | Size | Quantity | Barcode |
| --- | --- | --- | --- |
| Bulk Fixed | 3 × 5 inches | Fixed and locked | Included |
| Bulk Variable | 3 × 5 inches | Editable | None |
| Package Fixed | 3 × 2 inches | Fixed and locked | Included |
| BCC | 3 × 2 inches | Editable | None |

Products are stored in an ignored local SQLite file, `data/billco.sqlite`,
or the path specified by `DATABASE_PATH`. The development seeds are examples,
not a production product master. Setup applies migrations and inserts missing
seed products without replacing existing records. See
[`docs/product-database.md`](docs/product-database.md) for the schema, lookup API,
persistence, backups, and initialization details.

Use **Database → Import Master List** in the sidebar to import an `.xlsx`
product master. **BillcoMaster** in **Billco_App_Master.xlsx** is the primary
source and is selected automatically when present. Upload reads the worksheet
headers and preselects the Billco column mapping. Review or edit mappings, then
select **Validate workbook** and **Import valid rows**. Choose another product
worksheet to refresh its detected columns and mapping. The preview
makes no database changes. Import
adds new products, updates matching part numbers, and reports invalid and blank
rows that were skipped. Existing part numbers match exactly after trimming,
including case and leading zeros. See
[`docs/excel-import.md`](docs/excel-import.md) for workbook columns, description
consolidation, identifier rules, and size limits.

Authentication, printing, reporting, customer database management, and SATO
integration remain outside the implemented scope. Print and navigation for
those features are disabled. Legacy `.xls` and macro-enabled `.xlsm` imports
are not supported.

```sh
npm run db:setup     # Explicitly migrate and seed the selected local database
npm run build        # TypeScript checks, API/UI build, and migration assets
npm run start        # Serve the API and built UI (port 3001 by default)
npm run preview      # Alias for npm run start
npx playwright install chromium
npm test             # Server/database tests, then browser tests
npm run test:server  # Database and API tests using node:test
npm run test:e2e     # Browser tests for API lookup, label rules, and mobile
```

Production startup applies migrations but does not seed products. Initialize
the selected database with `npm run db:setup` only when the development samples
are appropriate, or supply the intended product records separately. Form state
(PO, lot, label type, column mapping, and editable quantity) remains local to the browser session.

For an existing Chromium installation, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable when running tests.
Fonts are bundled locally; no external frontend services are required. Product
lookup requires the application's API and SQLite database.

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

The implemented store uses SQLite and a shared TypeScript product model with a
single combined description field. Part numbers are unique, case-sensitive text
identifiers, preserving leading zeros. Active products can produce labels;
inactive products can be looked up but cannot produce labels.

Maintain a master list of products including:

- Part Number
- Description
- Product Barcode
- Bulk Barcode
- Bulk Fixed Quantity
- Package Fixed Quantity
- Status (Active/Inactive)

---

## Excel Import

Import and update product master records from `.xlsx` workbooks through
**Import Master List**. Validation and an add/update preview run before an
explicit import. Valid rows are saved in one transaction; invalid and blank
rows are skipped and reported. Duplicate part numbers within the selected
worksheet are all invalid.

Provide a combined Description or legacy Description1 through Description5
columns; nonempty legacy values are joined with spaces into one description.
ProductBarcode and BulkBarcode come directly from the spreadsheet and are
independent of Part Number and each other. Bulk Fixed uses BulkBarcode; Package
Fixed uses ProductBarcode. Missing fixed quantities or barcodes leave that label
type unavailable, while editable-quantity labels remain usable. Format identifiers as Text to preserve leading zeros. See
[`docs/excel-import.md`](docs/excel-import.md) for the complete template and rules.

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

Operators select one of four mutually exclusive label types in the sidebar or
Label Type radio group: Bulk Fixed, Bulk Variable, Package Fixed, or BCC.
The application automatically selects the matching label dimensions.

## Bulk Fixed Quantity

Uses a 3 × 5 inch label with a barcode.

Quantity is automatically populated using the product master data.

Quantity field is locked.

Example:

Qty: 500

---

## Bulk Variable Quantity

Uses a 3 × 5 inch label without a barcode.

Quantity field is editable by the operator.

Example:

Qty: User Entered

---

## Package Fixed Quantity

Uses a 3 × 2 inch label with a barcode.

Quantity is automatically populated using package quantity rules.

Quantity field is locked.

Example:

Qty: 50

---

## BCC

BCC is a standalone label type using a 3 × 2 inch label without a barcode.

Quantity is entered by the operator and remains editable.

Example:

Qty: User Entered

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

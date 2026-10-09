# Product database

The Product Labels application uses a local SQLite product store through Node's
built-in `node:sqlite` module. Requires Node.js 22.13 or newer; Node.js 24 is
recommended. There is no external database service or browser product fixture
list. The UI retrieves product information from the local lookup API.

## Product model and schema

The API and UI share the same TypeScript product shape:

| Field | Type | Constraint |
| --- | --- | --- |
| `partNumber` | Text | Unique, nonblank, trimmed, control-free, at most 64 characters; exact case-sensitive identity |
| `description` | Text | Single combined, nonblank description, at most 512 characters |
| `bulkFixedQuantity` | Integer or null | 1–999999 when present; null means unavailable |
| `packageFixedQuantity` | Integer or null | 1–999999 when present; null means unavailable |
| `productBarcode` | Text | Printable ASCII, at most 128 characters; empty means unavailable |
| `bulkBarcode` | Text | Independent printable ASCII, at most 128 characters; empty means unavailable |
| `status` | Text | `active` or `inactive` |

Part numbers remain text throughout storage and lookup. A part such as `005080`
is distinct from `5080`; `ABC-1` is distinct from `abc-1`. Duplicate part numbers
are rejected by the database. The `products` table uses SQLite `STRICT` typing
and schema constraints to validate stored values.

The description is one field containing the complete product description. The
model does not split it into material, dimensions, or another description field.
Excel import accepts a combined Description or consolidates nonempty legacy
Description1 through Description5 values into this same field; see
[`excel-import.md`](excel-import.md) for validation rules.

The initial schema is in `database/migrations/001-create-products.sql`; the
database access layer is `database/index.ts`. SQL columns use snake case and
map to the shared camel-case model in `shared/product.ts`. The
`schema_migrations` table records each applied migration's version, filename,
and application time. Migrations run transactionally and are applied once.

## Initialize and run

From the repository root:

```sh
npm ci
npm run db:setup
npm run dev
```

`npm run db:setup` applies the checked-in schema migrations and inserts missing
development seed products. It is idempotent: rerunning it keeps existing product
records and does not overwrite edited master values or reset statuses.
`npm run dev` also runs setup before starting the API and Vite together.

The development database starts with these examples:

| Part | Status | Bulk fixed quantity | Package fixed quantity | Product barcode | Bulk barcode |
| --- | --- | --- | --- | --- | --- |
| `5080` | active | 500 | 50 | `5080` | `5080` |
| `5081` | active | 250 | 25 | `5081` | `5081` |
| `5082` | active | 200 | 20 | `5082` | `5082` |
| `5083` | active | 120 | 12 | `BILLCO-5083` | `BILLCO-BULK-5083` |
| `5090` | inactive | 100 | 10 | `5090` | `5090` |

Part `5083` has the combined description `BRASS COUPLING 3/8` and distinct
product and bulk barcodes that differ from the part number. Part `5090` demonstrates
inactive-product handling: its stored quantities are available in the API
response, but the UI does not use them for labels. These records support local
development; they are not a production product master.

| Setting | Default | Purpose |
| --- | --- | --- |
| `DATABASE_PATH` | `data/billco.sqlite` | SQLite file used by setup and the API |
| `API_PORT` | `3001` | API port; also serves the built UI in production mode |
| `UI_PORT` | `5173` | Vite development server port |

For a separate local database, use the same path for setup and runtime:

```sh
DATABASE_PATH=/workspace/billco-data/products.sqlite npm run db:setup
DATABASE_PATH=/workspace/billco-data/products.sqlite npm run dev
```

The default `data/` directory is ignored by Git. Custom database locations should
also stay outside committed source files. No credentials are needed for the
local database.

## Lookup API

`GET /api/products?partNumber=5080` returns the product directly as JSON:

```json
{
  "partNumber": "5080",
  "description": "3/8 Brass Coupling",
  "bulkFixedQuantity": 500,
  "packageFixedQuantity": 50,
  "productBarcode": "5080",
  "bulkBarcode": "5080",
  "status": "active"
}
```

Lookup trims surrounding whitespace, then uses an exact text part number and a
parameterized database query. URL encode the query value when it contains
reserved characters. The endpoint
returns inactive products as well as active products so operators can see why
a known part cannot produce a label.

| HTTP status | Meaning |
| --- | --- |
| `200` | Product found; inspect its `status` |
| `400` | Missing or invalid part-number query |
| `404` | No product with the requested part number |
| `500` | Lookup failed; the response contains a generic error without database details |

Vite proxies `/api` to the local API during development. In production mode,
the API serves the built UI and the lookup endpoint from the same origin.
`GET /api/health` checks access to the products table and returns `200` when
available or `503` when unavailable.

## Product and label behavior

The initial `5080` lookup and subsequent searches use the API. Bulk Fixed uses
`bulkFixedQuantity`; Package Fixed uses `packageFixedQuantity`. Both quantities
are locked. Bulk Fixed encodes `bulkBarcode`; Package Fixed encodes
`productBarcode`. A fixed preview is unavailable when its quantity or matching
barcode is absent; no field is substituted from the other label type.
Missing bulk quantity or bulk barcode affects only Bulk Fixed. The product
remains available for Package Fixed when its package fields are present, and
for BCC and Bulk Variable with an operator-entered quantity.

The four label types are mutually exclusive:

| Label type | Size | Quantity | Barcode |
| --- | --- | --- | --- |
| Bulk Fixed | 3 × 5 inches | Master quantity, locked | Included |
| Bulk Variable | 3 × 5 inches | Operator-entered, editable | None |
| Package Fixed | 3 × 2 inches | Master quantity, locked | Included |
| BCC | 3 × 2 inches | Operator-entered, editable | None |

Bulk Variable and BCC do not copy master quantities. Selecting either type or
looking up a product in either type clears quantity for a new operator entry.
BCC is a standalone type. Any operator-editable quantity suppresses the barcode
in both normal and expanded previews.

Inactive products retain visible product information but do not populate a
label quantity or render a label preview. Unknown parts, invalid searches, and
lookup failures must not leave a previous product label available. There is no
authentication or role-based restriction on this local lookup endpoint.

## Excel master-list import

**Database → Import Master List** opens the `.xlsx` importer. Its validation
preview reads product records to classify rows as additions or updates without
writing to the database. Upload a workbook to discover its worksheets and
headers; BillcoMaster is selected when present. Review the editable column
mapping and use **Validate workbook** to preview the selected worksheet.
The explicit **Import valid rows** action saves valid rows in one
transaction and reports invalid and blank rows that were skipped. Database
failures roll back the valid batch.

An imported, trimmed Part Number updates its exact, case-sensitive match;
otherwise a new product is inserted. Leading zeros remain part of a text
identifier. Duplicate part numbers within the selected worksheet invalidate
every matching row. The spreadsheet supplies quantities, the single combined
description, Product Barcode, Bulk Barcode, and optional Active/Inactive status.
Both barcodes are independent source data, never derived from Part Number,
Description, or one another. Without a Status column, additions default to active
and updates retain their current status. Blank mapped quantities become null;
blank mapped barcodes become empty strings.

The preview and import endpoints are `POST /api/products/import/preview` and
`POST /api/products/import`. Both accept an `.xlsx` file in the multipart `file`
field, optional `sheetName`, and an optional JSON `mapping`.
`POST /api/products/import/columns` discovers headers and suggested mappings
without reading or writing products. BillcoMaster is preferred by default. Import is the write operation; it revalidates
the submitted workbook before saving. See [`excel-import.md`](excel-import.md)
for the full workbook contract, limits, and response details.

## Build and validation

```sh
npm run build
npm run start
```

The build checks TypeScript, compiles the API and UI, and copies migration assets
needed at runtime. `npm run start` serves the built UI and API on `API_PORT` and
applies migrations without inserting development seeds. `npm run preview` is
an alias for the same production server. A newly migrated, unseeded database has
no products; seed it explicitly only when the example records are appropriate.

```sh
npm run test:server
npx playwright install chromium
npm run test:e2e
npm test
```

Server tests use `node:test` to exercise the database, seed/migration behavior,
validation, lookup API, and Excel import. Browser tests cover API-backed lookup,
label behavior, and the import workflow. `npm test` runs server tests before
browser tests. Use
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when testing with an existing Chromium
installation. Test databases should be temporary and independent of the
development product store.

## Persistence, backups, and resetting development data

Products persist in the selected SQLite file across API restarts and UI reloads.
Browser form values are not stored in the product database. Keep the database on
persistent storage if product edits must survive replacement of the workspace.

For a file backup, stop the application before copying the SQLite database and
any accompanying `-wal` or `-shm` files. Keep backups outside the repository and
restore them to the same configured path while the application is stopped.
Migrations run on the restored database when the server starts.

For an intentional development reset, stop the application and remove only the
SQLite file selected by your `DATABASE_PATH`, plus its companion files if
present, then run `npm run db:setup` with the same path. This discards that
database's local product records and recreates the development samples. Normal
setup and startup never perform this reset or overwrite existing products.

Excel master-list import supports product additions and updates. A general
product-editing interface, customer database management, authentication,
printing, SATO integration, and reporting remain outside the implemented scope.

## Existing database upgrade

Migration `002-separate-barcodes.sql` rebuilds the strict products table in the
migration transaction, preserving every existing product, quantity, description,
status, and legacy barcode. The former `barcode_value` becomes `product_barcode`;
`bulk_barcode` initially remains empty because its value cannot be inferred.
Reimport BillcoMaster to populate actual bulk codes. Quantities may now be null
and barcode values may be empty to represent missing fixed-label master data.
Setup does not overwrite existing rows, and the migration runs once.
The lookup API replaces `barcodeValue` with `productBarcode` and `bulkBarcode`.

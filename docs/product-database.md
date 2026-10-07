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
| `bulkFixedQuantity` | Integer | 1–999999 |
| `packageFixedQuantity` | Integer | 1–999999 |
| `barcodeValue` | Text | Nonblank printable ASCII, at most 128 characters |
| `status` | Text | `active` or `inactive` |

Part numbers remain text throughout storage and lookup. A part such as `005080`
is distinct from `5080`; `ABC-1` is distinct from `abc-1`. Duplicate part numbers
are rejected by the database. The `products` table uses SQLite `STRICT` typing
and schema constraints to validate stored values.

The description is one field containing the complete product description. The
model does not split it into material, dimensions, or another description field.

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

| Part | Status | Bulk fixed quantity | Package fixed quantity | Barcode value |
| --- | --- | --- | --- | --- |
| `5080` | active | 500 | 50 | `5080` |
| `5081` | active | 250 | 25 | `5081` |
| `5082` | active | 200 | 20 | `5082` |
| `5083` | active | 120 | 12 | `BILLCO-5083` |
| `5090` | inactive | 100 | 10 | `5090` |

Part `5083` has the combined description `BRASS COUPLING 3/8` and a barcode
value that differs from the part number. Part `5090` demonstrates
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
  "barcodeValue": "5080",
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
are locked, and their Code 128 barcodes encode `barcodeValue`.

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
validation, and lookup API. Browser tests cover API-backed lookup and label
behavior. `npm test` runs server tests before browser tests. Use
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

Product maintenance, Excel import, customer database management, authentication,
printing, SATO integration, and reporting are not implemented by this change.

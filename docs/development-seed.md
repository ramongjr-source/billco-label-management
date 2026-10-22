# Development seed data

After `npm ci`, run `npm run dev`. Startup migrates the selected SQLite database
and adds missing products from `database/seeds/billco-master.ts`. No workbook
upload, workbook file, or external service is needed at runtime. The committed
snapshot includes all 673 records accepted by the existing BillcoMaster import
validation, plus the five legacy example products kept for UI demonstrations.

Search `PA.013`, `AB.025X013`, or `HR.013`, in any letter case. Stored Part Number
formatting is retained. `PA.013` supports Package Fixed, Bulk Fixed, Bulk Variable,
and BCC labels. The other two examples lack bulk-fixed quantity/barcode data in
the source workbook; that mode remains unavailable rather than inventing data.
Descriptions, quantities, both independent barcodes, and statuses are exactly
those returned by the production import preview. The supplied workbook has no
Status column, so the normal import rule defaults new products to active.

## Regenerate from an updated BillcoMaster

From the repository root:

```sh
npm ci
npm run db:seed:generate -- "/path/to/Billco_App_Master.xlsx"
git diff -- database/seeds/billco-master.ts
npm run build
npm run test:server
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- --workers=2
```

Use your installed Playwright Chromium instead if `/usr/bin/chromium` is absent.
Commit the generated dataset with the reviewed source update. The workbook does
not need to be committed. The generator selects **BillcoMaster**, discovers its
column mapping with the existing importer, and runs the production import
preview against an empty temporary in-memory database. It does not alter the
application database. It records the source SHA-256, counts, and validation
errors in the generated module. Generation is deterministic for the same file.
A missing BillcoMaster or a workbook with no valid products fails without
replacing the previous seed file.

Like the Excel import, generation includes valid rows and reports skipped rows.
The current source contains 743 data rows: 673 valid products, 65 blank rows,
and five invalid rows missing Part Number (worksheet rows 290, 481–484). Review
these warnings on each regeneration; correct invalid source records in the
workbook before regenerating if they should be products. Case-insensitive
duplicate rows are rejected by the existing import validator.

Update the snapshot count/representative-value assertions in
`tests/server/development-seed.test.ts` and `tests/development-seed.spec.ts` when
an intentional master change alters them. Run the checks again.

## Existing databases and production

Seeding inserts missing products in one transaction, using case-insensitive
identity. Repeated startup does not replace master spelling, quantities,
barcodes, descriptions, statuses, or later imports. Newly generated seed values
therefore do not overwrite records already in your local database. To test a
fresh snapshot without losing local work, select a new ignored database path:

```sh
DATABASE_PATH=data/billco-fresh.sqlite npm run dev
```

Alternatively, use the existing Excel import to update your local database.
Removed seed records are not automatically deleted from an existing database.

`npm run start` remains the production entry point and does not seed products.
`npm run db:setup` explicitly prepares development data; do not run it against a
production database. The upload, validation, BillcoMaster mapping, and import
update code paths are unchanged. Excel imports continue to add and update
products normally, including records initially supplied by the seed.

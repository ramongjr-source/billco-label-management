# Excel product import and column mapping

Use **Database → Import Master List** to upload a product `.xlsx` workbook.
**BillcoMaster** in **Billco_App_Master.xlsx** is the primary import source. When
present, BillcoMaster is selected even if it is not the first worksheet.
Customer imports, customer labels, printing, SATO integration, reporting, and
authentication are outside scope.

## Operator workflow

1. Choose a workbook. The application reads headers without saving products.
2. Review the detected columns and suggested mappings. BillcoMaster maps the
   production fields below automatically. Other product worksheets may use any
   header names; select their columns manually.
3. Map one description column or up to five ordered description fragments.
   Nonempty fragments are trimmed and joined with spaces. Numeric fragments are
   retained as text. Legacy Description1–Description5 columns are suggested in
   numeric order when present.
4. Select **Validate workbook** to preview additions, updates, and row errors.
5. Select **Import valid rows** to save. Review the counts and correct skipped
   rows in the source workbook before importing them again.

Changing the file, worksheet, or mapping clears the preview and requires new
validation. Import sends the same selected columns and reparses/revalidates the
workbook. All valid writes commit together; unexpected database failures roll
back the batch. Products absent from the worksheet are retained.

## Primary source mapping

| BillcoMaster column | Stored product field | Used by |
| --- | --- | --- |
| BillcoPart# | Part Number | Exact product lookup |
| Description | Description | All product labels |
| StdPackQty | Package Fixed Quantity | Package Fixed |
| BulkQty | Bulk Fixed Quantity | Bulk Fixed |
| ProductBarcode | Product Barcode | Package Fixed only |
| BulkBarcode | Bulk Barcode | Bulk Fixed only |

`Size` and other unrelated columns are ignored. There is no importer cap on
total worksheet columns. Values, formulas, and formatting in unmapped columns
are ignored. Rows empty in all mapped fields are counted as blank, even if
unrelated columns contain data.

Optional Status accepts Active or Inactive, ignoring case and surrounding
whitespace. Without a Status mapping, new products are active and existing
products retain their status. No customer records or customer labels are saved.

## Validation and missing values

Part Number and Description must be nonblank. Part Number is trimmed,
control-free text of at most 64 characters; Description is at most 512 characters.
Part Number matches are exact and case-sensitive: `005080` differs from `5080`
and `ABC` differs from `abc`. Every duplicate occurrence within one worksheet is
invalid, including a duplicate row with another field error.

Fixed quantity columns must be mapped and populated quantities must be whole
numbers from 1 to 999999. Blank quantities are stored as null. Barcode values
are independent source data; populated codes must be printable ASCII of at most
128 characters. Blank codes remain empty. A product missing a fixed quantity
or its matching barcode cannot preview that fixed label. Bulk Variable and BCC
remain available for operator quantity entry and never show barcodes.

Neither barcode is generated from Part Number, inferred from quantity, nor copied
from the other barcode. Text codes preserve leading zeros and meaningful spaces.
Format identifiers as Text before entering values in Excel. Numeric identifier
cells require safe integers of at most 15 digits and General or plain all-zero
formats such as `000000`; those formats preserve their displayed zero padding.
Values already rounded by Excel cannot be recovered.

Formula cells in mapped fields are unsupported; use **Paste Special → Values**.
Dates and unsupported cell types in mapped fields are reported as errors.
The importer does not execute formulas or trust cached formula results.
Mappings use one-based column indices. A column can be selected only once,
including description fragments. Missing mappings, nonexistent columns, and
invalid mappings reject validation without database writes.

## Legacy compatibility

Recognized legacy headers (Part Number or PN, Description1–Description5,
Bulk Fixed Quantity, Package Fixed Quantity, Barcode Value, and Status) remain
supported with case, whitespace, underscore, and camel-case variations.
Barcode Value maps only to Product Barcode. If a legacy file omits Bulk Barcode,
updates retain the existing bulk code and additions leave it empty. BillcoMaster
requires both barcode columns to be mapped, although individual cells may be
blank. A manual mapping imports only selected description columns. Without a
manual mapping, conflicting direct and legacy descriptions are reported as errors.
Duplicate recognized headers require an explicit unambiguous mapping.

## Limits and supported files

Only `.xlsx` is supported. Legacy `.xls`, macro-enabled `.xlsm`, encrypted
workbooks, and formula evaluation are unsupported. Limits are 5 MiB per upload,
20 MiB expanded ZIP contents, 1,000 ZIP entries, and 5,000 rows after the header.
The first nonblank header row must occur within the first 5,001 worksheet rows.
One selected product worksheet is processed per import.

## API

All endpoints use multipart `file`, optional `sheetName`, and optional JSON
`mapping`. Omitted sheetName prefers BillcoMaster, then the first worksheet.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/products/import/columns` | Return sheet names, detected headers/indices, and a suggested mapping; no writes |
| `POST /api/products/import/preview` | Validate mapped fields and classify additions/updates; no writes |
| `POST /api/products/import` | Revalidate and save valid products transactionally |

Example mapping for the primary workbook:

```json
{
  "partNumber": 1,
  "packageFixedQuantity": 2,
  "descriptionColumns": [4],
  "productBarcode": 5,
  "bulkFixedQuantity": 6,
  "bulkBarcode": 7
}
```

Preview returns sheetName, sheetNames, totalRows, blankRows, invalidRows,
added/updated counts, valid rows with product data/actions, and field-level
errors with original row numbers. Import returns the counts/errors without the
preview rows. A 200 response can include skipped invalid rows; inspect the report.
Malformed requests return 400, oversized uploads 413, workbook/mapping errors
422, and unexpected storage failures 500 with a generic message.

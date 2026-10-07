# Excel product import

Import a product master from an `.xlsx` workbook using **Database → Import
Master List** in the sidebar. The application validates the selected worksheet
and previews additions, updates, and row errors before any database write.
An explicit **Import valid rows** action saves the valid rows to SQLite.

## Operator workflow

1. Choose an `.xlsx` file.
2. Select **Validate workbook** to preview the first worksheet and discover the
   workbook's available worksheets.
3. To import another worksheet, select it in **Worksheet**, then select
   **Validate workbook** again. Changing the worksheet clears its previous
   preview.
4. Review the validation preview, including proposed additions/updates and
   skipped invalid or blank rows. Preview does not save products.
5. Select **Import valid rows** to commit the valid rows. Review the resulting
   counts and errors; correct skipped rows in the workbook before importing
   them again.

Changing the file or worksheet requires a new preview. Import revalidates the
workbook and uses current database records to identify additions and updates.
All valid rows save in one transaction. A database failure rolls back that
batch; row validation errors allow the remaining valid rows to be imported.

New part numbers are added. Existing part numbers are updated with the workbook
values, including Active/Inactive status. Matching trims surrounding whitespace
and preserves exact case and leading zeros: `005080` differs from `5080`, and
`ABC-1` differs from `abc-1`. Products absent from the workbook are retained.

## Workbook columns

The first nonblank worksheet row is the header row. Header matching accepts
case, spacing, underscore, and camel-case variations of the supported names,
such as `Part Number`, `part_number`, and `partNumber`.
The `PN` header is also accepted for Part Number. There is no importer limit on
total worksheet columns. Unrecognized columns are ignored, including their
values, formulas, and formatting. Required fields may appear anywhere in the
worksheet. Duplicate recognized headers, including aliases for the same field,
reject the worksheet.

| Column | Required | Value |
| --- | --- | --- |
| Part Number | Yes | Unique text identifier, 1–64 characters |
| Description | One description source | Combined, nonblank description, at most 512 characters |
| Description1 through Description5 | Alternative description source | Nonempty fragments joined in numeric order with spaces |
| Bulk Fixed Quantity | Yes | Whole number from 1 to 999999 |
| Package Fixed Quantity | Yes | Whole number from 1 to 999999 |
| Barcode Value | Yes | Nonblank printable ASCII text, at most 128 characters |
| Status | Yes | Active or Inactive, ignoring capitalization and surrounding whitespace |

You may supply Description, legacy Description1 through Description5 columns,
or both. Empty legacy fragments are omitted and the remaining fragments are
trimmed and joined with a single space. For example, Description1
`BRASS COUPLING` and Description2 `3/8` become `BRASS COUPLING 3/8`.
Finite numeric description cells are converted to text as well, so a numeric
dimension such as `0.375` or a `0` fragment is retained. Use Text cells when
description formatting or fraction notation must be preserved.

If a row supplies both a direct Description and nonempty legacy fragments, the
direct value must equal the consolidated value after trimming. Conflicting
descriptions invalidate that row. The database stores one description field.

Example worksheet:

| Part Number | Description1 | Description2 | Bulk Fixed Quantity | Package Fixed Quantity | Barcode Value | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 005083 | BRASS COUPLING | 3/8 | 120 | 12 | BILLCO-005083 | Active |

In Excel, format the Part Number and Barcode Value cells as **Text** before
entering values. This reliably preserves the example's `005083` identifier.

## Identifier, formula, and row rules

Barcode Value is read directly from the spreadsheet and stored independently
from the part number and description. The importer never creates it from a
part number. Text barcode cells are preserved exactly, including spaces and
leading zeros, subject to the nonblank printable ASCII requirement. Use Text
cells for both identifiers, especially values with leading zeros or long
numeric strings.

Numeric identifier cells are accepted only for safe whole numbers with at most
15 decimal digits, using General or a plain all-zero number format such as
`000000`. Plain zero formats preserve their displayed zero padding; General
uses the unpadded integer. Other number formats, fractions, and values exceeding
the precision limit require Text cells. An identifier already rounded by Excel
cannot be recovered by the importer.

Formula cells in imported fields are unsupported. Replace those formulas with
their values using Excel's **Paste Special → Values** before uploading. The importer does not calculate
formulas or trust their cached results.

Rows with no values in any mapped import field are skipped and counted as blank,
even if unrelated columns contain data. A row missing a required value,
containing an invalid quantity/status/identifier, or having conflicting
descriptions is invalid and skipped. Errors identify the original worksheet
row and field. When the same trimmed, case-sensitive part number appears more
than once in the selected worksheet, every row for that part number is invalid;
the importer does not choose one duplicate to save.

Active products may produce labels after import. Inactive products can be looked
up and their information remains visible, but their quantity and label preview
are unavailable. Bulk Fixed and Package Fixed use their imported fixed
quantities and Barcode Value. Bulk Variable and standalone BCC require operator
quantities and never display barcodes.

## Supported files and limits

| Limit | Maximum |
| --- | --- |
| Uploaded `.xlsx` file | 5 MiB |
| Decompressed ZIP contents | 20 MiB |
| ZIP entries | 1000 |
| Data rows in the selected worksheet | 5000 |

The first nonblank header row must occur within the first 5001 worksheet rows.
The selected worksheet may contain at most 5000 rows after that header.

Only `.xlsx` is supported. Legacy `.xls`, macro-enabled `.xlsm`, password-protected
workbooks, and formula evaluation are unsupported. Save a plain `.xlsx` copy
with values before importing. One worksheet is imported at a time. Oversized,
malformed, or unsupported workbooks are rejected without saving products.

## Import API

Both endpoints accept multipart form data with one `file` field and an optional
`sheetName` field:

| Endpoint | Behavior |
| --- | --- |
| `POST /api/products/import/preview` | Validate and return proposed additions/updates; no database writes |
| `POST /api/products/import` | Revalidate and transactionally save valid rows |

If `sheetName` is omitted, the first worksheet is selected. The preview returns
`sheetName`, available `sheetNames`, `totalRows`, `blankRows`, `invalidRows`,
proposed `added`/`updated` counts, valid `rows`, and field-level `errors`.
Each valid row includes its worksheet row number, product data, and `add` or
`update` action. Import returns the same counts and errors without the preview
`rows` list; its `added`/`updated` values describe saved products.

| HTTP status | Meaning |
| --- | --- |
| `200` | Workbook processed; inspect counts and row errors |
| `400` | Missing/invalid upload, unsupported filename extension, or invalid form fields |
| `413` | File exceeds the upload size limit |
| `422` | Workbook or worksheet cannot be validated, including format/structural limits |
| `500` | Import processing or database operation failed; response contains a generic error |

A successful HTTP response can include skipped invalid rows. Review `errors`
and `invalidRows` rather than interpreting `200` as every row being imported.
The API uses the same local SQLite database as product lookup. Authentication,
printing, SATO integration, reporting, and customer import are not implemented.

# Print Engine Foundation

This phase records print requests only. PRINT saves a job and reports **Recorded**;
it does not send labels to a printer. There is no browser print dialog, gateway,
TCP transport, SATO communication, or printer discovery.

## Setup and printer records

Startup applies migration `004-print-foundation.sql` to the selected
`DATABASE_PATH`. Existing product data is retained. Production startup creates no printer records.
Development setup (`npm run dev` / `npm run db:setup`) inserts four logical
examples: SATO CL4NX Plus #1, #2, #3, and Generic Printer. Existing names and
active/inactive settings are never overwritten. These are example records,
not discovered or connected devices. Printer names identify physical devices;
they do not assign label types, stock, colors, or media to those devices.

Configure printer records manually through the API. For a local development API:

```sh
curl -X POST http://localhost:3001/api/printers \
  -H 'Content-Type: application/json' \
  -d '{"name":"Printer A","model":"SATO CL4NX Plus"}'
```

`POST /api/printers` accepts a name/model (1–80 characters) and creates an active
printer with a generated ID. `GET /api/printers` lists configured records.
`PATCH /api/printers/:id` updates name, model, or active/inactive status. Deactivate
printers instead of deleting history. Configuration endpoints inherit the
application's current internal API access model; role-based administration is
not introduced in this phase.

Reload the workspace after configuring printers. Select a printer and enter
Print Quantity. The last selected active printer is remembered in this browser's
local storage, independently of label type. Unavailable remembered printers
leave the selection empty; the application never silently chooses another.
Storage restrictions do not prevent manually selecting a printer.

## Quantity and validation

Quantity on label retains existing rules: product-master quantity for fixed
labels, operator quantity for Bulk Variable/BCC. Print Quantity is a separate
whole number from 1 to 999999 and defaults to 1. For example, quantity on label
500 with Print Quantity 25 records 25 requested labels each showing QTY 500.

The server validates an active printer/product, supported label type, both
quantities, LOT, and PO on bulk labels. Compact labels omit PO. Fixed formats
require the correct master quantity and the matching nonblank barcode; variable
formats never include a barcode. Product data submitted from the preview must
match the current master; changes require searching again before recording.

## Service and persistence

`shared/printing.ts` defines Printer, PrintRequest, PrintJob and PrintService.
`RecordingPrintService` is the initial implementation. The app factory accepts
an optional PrintService so later delivery orchestration can be introduced
without coupling the operator workspace to transport details.

- `POST /api/print-jobs`: validates and records a request; 201 for a new job,
  200 for an identical retry, 409 for conflicting request-ID reuse or changed
  product data. Includes requestId, printerId, labelType, product snapshot,
  labelQuantity, printQuantity, lotNumber, and poNumber.
- `GET /api/print-jobs`: newest 25 jobs and `nextBefore`; pass that cursor as
  `?before=...` for older jobs. The history panel supports refresh and older pages.

Jobs store immutable product and printer snapshots, template version, dimensions,
barcode selection, label quantity, copy count, PO/LOT, and creation time. The
initial recorded event is written in the same transaction. Product imports and
printer renames/deactivation cannot change old job details. File-backed history
survives application restarts.

The browser reuses the same request ID when retrying unchanged details after a
failed response, preventing duplicate records. A subsequent successful deliberate
PRINT action creates a new job. Retry identity is kept for the current mounted
workspace; navigating away or reloading starts a new request. History should be
checked before resubmission after navigation following an uncertain response.

There is deliberately no "printed" state or delivery worker. These recorded
jobs must not automatically become a delivery backlog when a future transport
is introduced. That future phase must explicitly define which new/released jobs
are eligible for physical printing, printer/media setup handling, recovery,
and device-confirmed status.

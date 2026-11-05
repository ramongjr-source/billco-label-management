# SATO command generation and layout validation (#39)

## Review and scope

Reviewed Issues #28, #35, #37 and #39 and merged PRs #30 (recording engine),
#36 (printer/media management), and #38 (manual connectivity). Also reviewed
the existing label rules, rendered labels, source-data contracts, migrations,
API helpers, UI dialogs and server/Playwright tests. Related merged rendering/workspace
PRs #14, #16, #27, #32 and #34 were reviewed for label and one-page UI conventions. The supplied checkout was
at PR #36. It was updated to current main (`6d9970c`, merged PR #38) before
implementation; the Issue #39 diff excludes that existing connectivity feature.

This feature generates and validates SBPL for the SATO CL4NX Plus at 203 DPI.
There is no delivery API, socket, port-9100 transmission, Windows queue or
physical printing in the command service. Existing manual connection testing
remains an explicit, separate feature. Generating commands never records a
print job or changes printer/media/connection state. Command history is a
review archive, not a delivery queue.

## Architecture and files

| Area | Files | Behavior |
| --- | --- | --- |
| Contracts | `shared/sato.ts` | Versioned command snapshots, positioned elements, field issues, paginated history and request types reuse existing print/product contracts. |
| Source validation | `server/printService.ts` | Extracts canonical product/quantity/barcode checks into `resolveLabelProduct`, shared by recording and preview. Existing retry/media/device checks remain in recording. |
| Generation | `server/satoCommandService.ts` | Pure SBPL generation plus serialized-command validation; SQLite service resolves current products, guards stale data and stores immutable review snapshots. No transport dependency. |
| Persistence | `database/migrations/007-sato-commands.sql`, `database/index.ts` | Existing transactional migrations; dedicated command history preserves print jobs, printers, media and diagnostics. |
| API | `server/printRouter.ts` | Extends the existing router, JSON size limit, validation errors and cursor convention. |
| Browser API | `src/data/sato.ts`, `src/data/printing.ts` | Reuses the existing typed response/error helper for generation and history calls. |
| UI | `src/components/SatoCommandPanel.tsx`, `src/components/PrintControls.tsx`, `src/styles.css` | Compact admin-preview entry opens a native modal; shows source description, generated geometry, visible ESC commands, field warnings and selectable history. |
| Tests | `tests/server/sato-commands.test.ts`, `tests/sato-commands.spec.ts` | Data preservation, protocol, layout, persistence, HTTP and browser regressions. Existing migration assertions advance to 007. |

Open **SATO commands · Admin preview** in the Print job panel. Complete product,
quantity, LOT, and PO for bulk labels; choose copies using the existing Print
Quantity field. Preview generation does not require selecting a printer or
confirming loaded stock. The target model and DPI belong to the command template,
not to a permanent device/label-type association.

The panel follows the existing internal application's access conventions.
There is no existing authentication/role system; “Admin preview” identifies
its intended audience and does not claim role enforcement.

## Data and layout rules

| Label | Dots | Quantity | Barcode | PO |
| --- | --- | --- | --- | --- |
| Package Fixed | 609×406 (3×2) | Package fixed master quantity | Product barcode | Omitted |
| BCC | 609×406 (3×2) | Operator quantity | None | Omitted |
| Bulk Fixed | 609×1015 (3×5) | Bulk fixed master quantity | Bulk barcode | Required |
| Bulk Variable | 609×1015 (3×5) | Operator quantity | None | Required |

These are the application's existing barcode rules. No new fallback from an
empty bulk barcode to the product barcode is introduced. Label quantity and
requested copies are independent. Product values are read from SQLite and
compared with the reviewed product snapshot; changed/inactive/missing master
data is rejected. History retries return the original snapshot even if the
master later changes.

All descriptions are retained exactly, including quotes, fractions, inch/foot
marks, repeated spaces, and embedded dimensions. The generator splits description
text into contiguous runs of at most 33 characters with no trimming,
abbreviation, ellipsis or character substitution. Concatenating the runs
reconstructs the source string byte-for-byte for supported ASCII data.
The complete unsplit description is also shown in the modal and stored in
history. The compact layout allows three description lines; bulk allows eight.
Runs exceeding that region produce a field-specific warning. They are retained
in the review data, but no executable payload is returned.

This SBPL layout is version 1 and retains the existing brand, dominant Part
Number, description, quantity, PO/LOT, and conditional barcode hierarchy.
It uses explicit thermal-printer dot geometry, rather than attempting to send
the browser's font-fitting CSS or a screenshot to a printer. The normal browser
label preview remains unchanged; the modal's **Generated layout** is the geometry
used by the commands. Resident font bounds, 20-dot margins, field region capacity,
pairwise overlap, and barcode quiet zones are checked. The resident-font template
supports printable ASCII; unsupported Unicode/control characters cause a visible
field issue and a null payload, preserving the source rather than transliterating it.

## SBPL subset and validation

Commands use the standard ESC (0x1B) protocol: `A`, `A1VhhhhHhhhh`, `%0`,
`Hhhhh`, `Vhhhh`, `L0101`/`L0202`, resident `XS` (17×17) and `XM` (24×24),
Code 128 `BG02hhh>Hvalue` (two-dot module, subset B), `Qnnnnnn`, and `Z`.
The payload has no inserted newlines; preview text renders each ESC as `<ESC>`.
Copy count is 1–999999. Barcode values are independent imported values,
not inferred from Part Number. Human-readable text is generated from the exact
same string as the encoded data, including leading zeros and spaces.

Code 128 subset B requires printable ASCII. This first version rejects `>` in
barcode data because SBPL treats it as an invocation character. It does not
silently reinterpret subset switches/functions or guess an escaping scheme.
At two dots per module, width is `2 × (11 × (n + 2) + 13)` plus at least
20 dots of quiet zone per side. Oversized barcodes fail validation instead of
being horizontally squeezed.

The serialized validator checks framing, dimensions, orientation, every
position/font/text run, barcode parameters and exact encoded data, copy count,
termination and unexpected commands against the validated layout. Tampered
barcodes, human-readable text, copies, positions and framing are regression-tested.
Any command/layout/encoding issue sets `valid: false`, retains field issues and
complete review data, and withholds the payload (`null`). Validation-failed
previews are saved to history so an operator can inspect the original problem.

The SVG preview uses the same positioned elements and Code 128B encoding.
It represents geometry, not calibrated physical font rendering or scanner
certification. Printer SBPL standard-protocol configuration, orientation/media
setup, and actual output/scan quality must be verified during a future authorized
hardware phase. No physical printing was performed for this issue.

## API and history

- `POST /api/sato-commands`: existing label/product fields plus `requestId` and
  `printQuantity`; no printer ID or endpoint needed. Returns 201 for a new
  snapshot, 200 for an identical retry, 409 for conflicting ID reuse/stale
  master data, or 400 for malformed/missing input. Layout/encoding failures
  return a saved snapshot with `valid: false`, field issues and null payload.
- `GET /api/sato-commands?before=sequence`: newest-first history, 25 rows with
  `nextBefore`, using the existing history cursor convention.

Request IDs prevent duplicates after lost responses. Normalized request data
uses canonical key order. Source resolution, generation and history insertion
use one short SQLite transaction; insertion failures roll back. Snapshots
include original product data, label-specific fields, template version,
model/DPI, dot dimensions, copies, elements, validation issues, and exact payload.
Reopening SQLite preserves both valid and failed previews.

## Validation and evidence

Run `npm run build`,
`node --import tsx --test --test-concurrency=2 tests/server/*.test.ts`, and
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --workers=1 --timeout=120000`.

For screenshots and sample payloads, set `SATO_ARTIFACT_DIR` when running
`tests/sato-commands.spec.ts`. It captures short, medium and overflowing long
descriptions on both stock sizes, and saves the exact returned JSON, binary
ASCII SBPL payloads for valid layouts, and readable ESC versions.

Examples covered include `1/2" EMT Compression Coupling`,
`3/4" EMT Compression Coupling`, `1-1/4" Rigid Conduit Body`,
`3" x 10' Aluminum Tube`, and `4" x 4" x 1/4" Angle`.
Server cases also cover repeated/leading/trailing spaces, unsupported text,
oversized barcodes, exact HRI parity, immutable history, retry/conflict handling,
rollback, pagination/reopening, upgrades from 006, and zero probe/job side effects.


## Final verification results

- `npm run build`: passed (TypeScript, server assets, production UI).
- Complete server suite: **119 passed, zero failed** (79 existing + 40 new).
- Complete Chromium suite: **61 passed, four failed** in the concurrent run.
  `--last-failed --workers=1 --timeout=120000`: **all four passed**, completing
  all **65 cases**. Three existing checks hit lookup/render waits; the SATO
  capture was interrupted by a development-page reload. The serial rerun
  used `/tmp/billco-issue39-evidence` outside the watched project and passed
  without production code changes. Capture artifacts outside the watched
  development tree to avoid page reloads during evidence generation.
- Existing complete workflows pass at 1920×900, 940, 1000 and 1080, including
  all four formats, media confirmation and recorded jobs.
- Six captured API snapshots verify exact description reconstruction and barcode
  text/data parity. Both short and medium descriptions pass on both stocks;
  both overflowing long descriptions retain full data and withhold payloads.
- Four exact SBPL payloads and readable ESC copies accompany six screenshots
  and JSON snapshots. No printer payload was transmitted or physically printed.

See [screenshots and samples](screenshots/issue-39/README.md) and
[machine-readable validation results](screenshots/issue-39/validation-results.json).

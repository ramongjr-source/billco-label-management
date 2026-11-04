# Printer configuration and media confirmation

Issue #35 extends the Print Engine Foundation from #28 / PR #30. PRINT still
records a job only; no printer communication or delivery has been added.

## Repository integration

The registry extends the existing `Printer` contract and SQLite `printers` table.
`status: active/inactive` continues to represent enabled/disabled. Migration 005
adds IP address, description, configurable supported-media suggestions, loaded
media, last-change metadata, and a per-device media-confirmation setting. The
existing `createPrinter` / `updatePrinter` functions, Express print router, and
`RecordingPrintService` remain the implementation path.

Printer Setup activates the existing Administration sidebar entry. It follows
the App's state-based navigation, local React state, shared API helpers, and
existing panel/form/table styles. Media confirmation uses the same native
`dialog.showModal()` pattern as the expanded label preview. No routing, state,
storage, or UI framework was added.

Migration 005 inserts these defaults once, including in production startup:

| Printer | IP | Supported media | Require confirmation |
| --- | --- | --- | --- |
| Specialty Metals Printer | 192.168.1.190 | Aluminum, Stainless, Brass | Yes |
| Bulk Printer | 192.168.1.191 | Black 3x5 | No |
| Package Printer | 192.168.1.192 | Black 3x2 | No |
| Galvanized Printer | 192.168.1.193 | Magenta | No |

Existing printers, product records, job snapshots, and example development
printers are retained. Rerunning setup does not overwrite maintained records.
Loaded media starts **Unknown**; seed data cannot establish what is physically
loaded. IP validation checks address syntax only and makes no network request.

## Configuration and workflow

Printer Setup supports viewing, creating, editing, enabling/disabling, and
recording loaded media. Supported media and confirmation requirements are
editable per device. Current media can also be a different stock entered by the
operator. Changing configuration never rewrites loaded-media history. Printers
have no assigned label type, and all four label formats remain available on all
enabled devices. No printer is automatically selected.

Select a printer in the existing label workspace. Its current media is visible.
When confirmation is required, explicitly select Requested Material from that
printer's configured media. Products currently contain no structured material
field; the application does not infer stock from a part number or description.
The requested material is validation/job metadata and does not change the label
artwork, barcode, or quantity on the label.

The server checks the latest printer configuration and loaded media before
recording a new job. Matching media proceeds immediately. A mismatch, including
Unknown stock, returns `409 MEDIA_MISMATCH` and opens a blocking dialog with the
requested material and server-reported current media. Cancel/Escape writes
nothing. **Media Changed - Continue** requires an operator name, records the
stock change, then retries the original frozen print request with its original
request ID. Subsequent matching jobs need no repeated confirmation.

There is no authentication system in this repository. Audit users are explicitly
operator-entered names, remembered in this browser for convenience; they are not
verified sign-in identities. The prototype header greeting is never used as an
audit actor. Configuration endpoints retain the existing internal API access
model; this issue adds no role or authentication system.

## Audit and retry behavior

`printer_media_changes` stores an immutable timestamp, operator, printer ID/name,
previous media, and new media, plus canonical request/result JSON for retries.
Media and last-change metadata update in the same transaction as the audit
entry. If the audit write fails, the update rolls back. History is newest-first
with a stable cursor and is collapsed by default in Printer Setup.

Each media action has a separate request ID retained across response failures.
Identical retries return the original result; conflicting reuse returns 409.
An expected-current-media value rejects a stale operator change with
`409 MEDIA_CHANGED`, requiring a fresh review. Recording the stock change and
recording the job are separate transactions: if job recording fails after an
operator loaded stock, the truthful media audit remains. Retrying the original
job is safe through the existing print request idempotency behavior.
Saving unchanged media is disabled in the UI and rejected by the API, so it
does not rewrite last-change metadata or create a misleading audit entry.

New job snapshots include requested material when supplied and the complete
printer/media configuration at recording time. Older snapshots remain readable
and are not rewritten. Existing pre-upgrade request retries retain their
canonical request representation.

## API additions

- `GET /api/printers`: existing endpoint, now returns extended records.
- `POST /api/printers`: existing name/model fields plus optional IP, description,
  status, supportedMedia, and mediaValidationEnabled. Loaded media starts unknown.
- `PATCH /api/printers/:id`: updates configuration; loaded media must use the
  audited endpoint.
- `POST /api/printers/:id/media-changes`: `{requestId, user, currentMedia,
  expectedCurrentMedia}`; media values are text or null for Unknown. Returns
  `{printer, change, created}` with 201 for a new action or 200 for a retry.
- `GET /api/printers/:id/media-history?before=...`: `{changes, nextBefore}`,
  newest 25 entries.
- `POST /api/print-jobs`: existing request plus optional `requestedMedia`;
  mandatory and matched against current stock for a validated printer.

No raw sockets, SATO commands, Windows queues, browser print calls, discovery,
network tests, health monitoring, polling, or delivery worker are introduced.

## Validation and screenshots

See [Issue #35 screenshots](screenshots/issue-35/README.md) for the registry,
settings, mismatch dialog, audit history, and all four desktop label workflows.
Server tests cover upgrade/persistence, registry edits, authoritative media
validation, audit transactions, concurrency conflicts, and idempotent retries.
Browser tests exercise operator cancellation/continuation, response-loss retries,
and the full workflow at 1920×900 without scrolling or reducing the label preview.

Final verification:

- `npm run build` — passed.
- `node --import tsx --test --test-concurrency=2 tests/server/*.test.ts` — 70 passed.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --workers=2 --timeout=60000`
  — 59 passed, three checks timed out (one initial lookup and two long layout workflows).
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --last-failed --workers=1 --timeout=120000`
  — all three passed without code changes, completing coverage of all 62 browser cases.
- Screenshot measurements — zero overflow at 1920×900 for all four formats;
  identical label-surface hashes before/after.

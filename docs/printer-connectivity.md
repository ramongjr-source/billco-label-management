# Printer connectivity foundation

Issue #37 extends the printer management from #35 / PR #36 and the recording
foundation from #28 / PR #30. Connection tests are explicit diagnostic actions.
They do not print, generate SATO commands, send raw print data, use Windows
queues, discover printers, or poll devices.

## Integration and changed files

| Area | Files | Change |
| --- | --- | --- |
| Contracts | `shared/printing.ts` | Extend the existing Printer and add connection result/history types. |
| Persistence | `database/index.ts`, `database/migrations/006-printer-connectivity.sql` | Apply the existing migration pattern to connection settings, status metadata, and history. |
| Configuration | `server/printService.ts` | Reuse the Printer mapper and existing create/update functions; validate new settings and invalidate stale status. |
| Diagnostics | `server/printerConnectionService.ts` | A small injected connect-only probe and transactional connection-history service. |
| API | `server/app.ts`, `server/printRouter.ts` | Extend the existing app factory and router; retain recording-only PrintService. |
| Browser API | `src/data/printing.ts` | Extend existing configuration helpers and add manual test/history calls. |
| UI | `src/pages/PrinterSetup.tsx`, `src/components/PrinterConnectionPanel.tsx`, `src/styles.css` | Extend the existing settings page with compact fields, status, explicit testing, and collapsed history. |
| Tests | `tests/server/printer-connectivity.test.ts`, `tests/printer-connectivity.spec.ts` | Connection/settings/history regression coverage; existing migration tests advance to version 006. |

There is no second printer registry, configuration store, routing system, or
delivery engine. The diagnostic service reuses the existing printer storage,
validation error handling, API router, dependency injection, and transaction
patterns. The existing recording-only PrintService never invokes a probe.

## Settings and status

Migration 006 preserves every configured device, including the four existing
addresses 192.168.1.190, .191, .192, and .193. It supplies these defaults to both
existing and newly created printers:

| Setting | Default | Validation |
| --- | --- | --- |
| IP Address | Existing value, or blank | IPv4/IPv6 literal; blank remains allowed until a test is requested. |
| Port | 9100 | Whole number, 1–65535. |
| Connection Timeout | 3000 ms | Whole number, 100–30000 ms. |
| Current Status | Unknown | Server-managed result of the last applicable manual test. |
| Last Successful Connection | Never | Server-managed UTC timestamp. |

Enabled/Disabled remains the existing active/inactive configuration. It is
independent of Online/Offline. An administrator may test a disabled device;
testing it does not enable it or select it for a job.

Online means the application server established a TCP connection to the saved
IP and port during the last manual test. Offline means that attempt failed.
The UI shows the last-test time because these values are observations, not
live device health or print readiness. A TCP handshake does not establish
printer identity, media/ribbon availability, or job completion.

Changing IP, port, or timeout clears status to Unknown and clears the current
endpoint's timestamps. Previous successes remain in history. A failed test on
the unchanged endpoint retains its earlier Last Successful Connection. Renaming
or enabling/disabling a printer, or changing its media, does not clear status.
Status and timestamps cannot be edited through the configuration API.

## Manual test path

Save settings, then click **Test Connection**. The browser disables testing
while the endpoint has unsaved changes. The API resolves the target from the
stored printer ID; request bodies cannot override the target address or port.

The default probe opens one TCP connection with an explicit deadline. On
connection, refusal/error, timeout, or premature close, it settles once and
destroys the socket. It sends **zero application bytes**. Socket/timer cleanup
is covered with a real localhost peer and controlled timeout/error fixtures.

No connection is attempted when listing/selecting/refreshing printers, viewing
history, opening the app, or recording a print job. There is no background
timer or automatic retry loop. Offline status does not alter the existing
recording-only job behavior.

## History, concurrency, and persistence

`printer_connection_history` stores an immutable ID, completion timestamp,
printer ID/name snapshot, IP, port, timeout, result, and error message. Results
and current status update in one short transaction. If the history write fails,
the status update rolls back. Existing print-job and media-history snapshots
are not rewritten. History survives restarts and uses the existing newest-first
25-row cursor pattern.

The service reserves an internal generation before connecting and releases the
SQLite transaction before awaiting network I/O. Endpoint changes and newer
manual tests advance that generation. An older completion still gets a history
entry, but cannot replace the current target/test's status. The API returns
`applied: false` in that case, and the UI identifies the tested endpoint and
asks for a fresh test of current settings.

`createApp` accepts an optional `connectionProbe` for deterministic tests, using
the same app-factory injection approach already used for PrintService. The
default remains the real connect-only implementation. No simulation switch or
fixture printer is added to production configuration.

## API

- Existing `POST /api/printers` and `PATCH /api/printers/:id` accept `port` and
  `connectionTimeoutMs` alongside the existing configuration fields.
- `POST /api/printers/:id/test-connection` returns
  `{printer, connection, applied}`. Both a completed successful test and a
  completed failed test return HTTP 200 with the corresponding result. Missing
  printers or unsaved/invalid IPs return validation errors without attempting
  a connection. Persistence failures return the existing generic service error.
- `GET /api/printers/:id/connection-history?before=...` returns
  `{connections, nextBefore}`. Error messages are stored for failed attempts;
  successful attempts store null.

Configuration access follows the existing internal API model. No authentication
or authorization system is introduced in this issue.

## Screenshots and validation

See [Issue #37 screenshots](screenshots/issue-37/README.md) for before/after
settings, status, connection history, and the unchanged label workspace.
The tests use disposable SQLite databases, real localhost TCP peers, and
injected deterministic probes. Billco's private printer network is unavailable
from this cloud workspace, so no live result is claimed for the four LAN IPs.

Final results:

- `npm run build` — passed.
- `node --import tsx --test --test-concurrency=2 tests/server/*.test.ts` — 79 passed.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --workers=1 --timeout=120000`
  — all 64 passed in the complete run.
- Local TCP fixtures received zero application bytes; timeout/error fixtures
  verify bounded attempts and socket cleanup.
- Screenshots and browser tests verify settings/results fit at 1920×900.
  Existing all-format label workflows pass zero-scroll checks at 1920×1080,
  1000, 940, and 900. Label-surface hashes match the baseline for all four formats.

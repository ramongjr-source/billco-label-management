# Issue #37 — Printer connectivity foundation

Before captures use unchanged main commit `7d9c195` (merged PR #36). After
captures use the Issue #37 implementation. Both use the same disposable
database with the four configured production devices and real development
product data. The baseline UI ignores the new connectivity fields.

All images use Chromium, 100% browser zoom, and device scale factor 1. Dimensions
refer to the content viewport. A 1920×900 capture reserves 180px from a 1080p
monitor for browser and OS chrome; it is not a physical Windows-desktop capture.

| View | Before | After |
| --- | --- | --- |
| Printer Setup, 1920×1080 | [Before](before-printer-setup-1920x1080.png) | [After](after-printer-setup-1920x1080.png) |
| Printer Setup, 1920×900 | [Before](before-printer-setup-1920x900.png) | [After](after-printer-setup-1920x900.png) |
| Label workspace, 1920×900 | [Before](before-label-workspace-1920x900.png) | [After](after-label-workspace-1920x900.png) |

The default registry shows all four Billco addresses unchanged, port 9100,
timeout 3000ms, and Unknown status. No live result is claimed for these devices.

Real connection examples use **A Local Connectivity Fixture**, registered only
in this disposable database at `127.0.0.1` with an ephemeral port:

- [Online after a successful TCP handshake](connection-online-local-fixture-1920x1080.png)
- [Offline after closing the fixture listener](connection-offline-local-fixture-1920x1080.png)
- [Connection history with both outcomes and the error message](connection-history-local-fixture-1920x1080.png)
- [Offline result and primary controls fitting at 1920×900](connection-offline-local-fixture-1920x900.png)

The peer accepted one connection and received **zero application bytes**. The
second manual test correctly failed with connection refused. The last success
timestamp remained visible after that failure. The fixture is absent from the
production seed data.

[Measurements and label hashes](measurements.json) show zero document overflow
at 1920×900 for default settings, the visible failed result, and all four label
formats. Before/after element-screenshot SHA-256 hashes match for Bulk Fixed,
Package Fixed, Bulk Variable, and BCC. Full label surfaces remain 435px wide,
725px high for bulk and 290px for compact formats.

Connection/media histories collapse by default. Expanded audit history is
secondary content and can consume additional space. The server tests also
exercise timeout, refusal, stale settings/results, rollback, and persistence.

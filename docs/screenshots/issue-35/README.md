# Issue #35 — Printer configuration and media confirmation

Screenshots compare unchanged main commit `90c5ca3` with the Issue #35 branch.
Both use the same disposable database and product 5080. The baseline UI uses
the extended registry API without any UI changes, allowing the same printer
selection in both versions. The production database and physical printers were
not accessed.

Captures use Chromium with 100% browser zoom and device scale factor 1. Sizes
refer to the browser content viewport. The 1920×900 comparisons reserve 180px
from a 1080p monitor for browser/OS chrome. They demonstrate browser layout
behavior; they are not physical Windows-desktop captures.

| Workflow, 1920×900 | Before | After |
| --- | --- | --- |
| Bulk Fixed | [Before](before-bulk-fixed-1920x900.png) | [After](after-bulk-fixed-1920x900.png) |
| Package Fixed | [Before](before-package-fixed-1920x900.png) | [After](after-package-fixed-1920x900.png) |
| Bulk Variable | [Before](before-bulk-variable-1920x900.png) | [After](after-bulk-variable-1920x900.png) |
| BCC | [Before](before-bcc-1920x900.png) | [After](after-bcc-1920x900.png) |

Additional desktop captures at 1920×1080:

- [Before workspace](before-bulk-fixed-1920x1080.png)
- [After workspace](after-bulk-fixed-1920x1080.png)
- [Blocking mismatch confirmation](media-mismatch-1920x1080.png)
- [Confirmed media and recorded job](job-recorded-1920x1080.png)
- [Printer registry and settings](printer-setup-1920x1080.png)
- [Expanded media audit history](media-audit-1920x1080.png)

The four 900px workflows have zero document overflow and zero scroll offset.
All required fields, printer, copy quantity, PRINT, material controls, and the
complete label preview remain visible. Label surfaces remain 435px wide:
725px high for bulk and 290px for compact formats. Element-screenshot SHA-256
comparisons verify that all four label surfaces are pixel-identical to the
baseline. [Measurements and hashes](measurements.json) preserve the evidence.

Sample names in audit screenshots identify actions in disposable demonstration
data only. Loaded media is an operator-entered record, not a printer reading.

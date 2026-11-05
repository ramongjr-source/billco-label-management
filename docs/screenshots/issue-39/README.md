# Issue #39: command preview evidence

Chromium browser captures at a 1920×1080 content viewport, device scale 1,
100% zoom. Images capture the native command-preview dialog. All products are
clearly isolated test fixtures imported through the existing BillcoMaster API
into the disposable Playwright database. No production printer was accessed.

| Description | 3×2 | 3×5 | Expected validation |
| --- | --- | --- | --- |
| Short: `1/2" EMT Compression Coupling` | [Preview](short-3x2.png) | [Preview](short-3x5.png) | Valid; full measurements and inch mark retained. |
| Medium: `1-1/4" Rigid Conduit Body with cover and 3/4" threaded openings` | [Preview](medium-3x2.png) | [Preview](medium-3x5.png) | Valid; complete text spans runs without removing characters. |
| Long: repeated `4" x 4" x 1/4" Angle` (419 characters) | [Warnings](long-3x2.png) | [Warnings](long-3x5.png) | Description overflow flagged; source retained; payload withheld. |

Each image has a matching `.json` snapshot returned by the real API.
The four valid cases also have `.sbpl` files containing the exact ASCII payload
with real ESC bytes and no inserted newlines, plus `.txt` copies displaying
`<ESC>` on separate lines for review. Invalid cases deliberately have no
executable `.sbpl` file.

Package Fixed uses quantity 25 and barcode `00001234`; Bulk Fixed uses quantity
500 and barcode `BULK-1234`. Both use one requested copy. Human-readable barcode
text is generated from the same source value as the Code 128B data.

The browser regression checks that the barcode is positioned in the lower
label region, preserves descriptions in the panel, produces field warnings
for both overflowing formats, creates no print jobs for the fixture products,
and restores all six snapshots from command history after reloading.

The geometry preview follows the command elements and resident-font bounds;
it does not certify a physical print or scanner result. See
[architecture and protocol notes](../../sato-command-generation.md).

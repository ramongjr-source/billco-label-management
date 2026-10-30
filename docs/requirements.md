# Business Rules

## Label Formats

### 3x5 Label

Used for:

- Bulk Fixed Quantity
- Bulk Variable Quantity

### 3x2 Label

Used for:

- Package Fixed Quantity
- BCC Labels

---

## Bulk Fixed

- Uses 3x5 label format
- Quantity is pulled from product master
- Quantity is locked
- Barcode is included

---

## Bulk Variable

- Uses 3x5 label format
- Quantity is entered by operator
- Quantity is editable
- No barcode

---

## Package Fixed

- Uses 3x2 label format
- Quantity is pulled from product master
- Quantity is locked
- Barcode is included

---

## BCC

- Uses 3x2 label format
- Quantity is entered by operator
- Quantity is editable
- No barcode

---

## Barcode Rules

Barcodes appear only on fixed-quantity labels.

Editable quantity labels shall not display or print a barcode.

Examples:

- Bulk Fixed → Barcode
- Package Fixed → Barcode
- Bulk Variable → No Barcode
- BCC → No Barcode

---

## Label Format Selection

The application automatically selects the label format.

Mappings:

- Bulk Fixed → 3x5
- Bulk Variable → 3x5
- Package Fixed → 3x2
- BCC → 3x2

Operators do not manually select label dimensions.

---

## Required Label Fields

- Part Number
- Lot Number
- Quantity

All labels display Description when nonblank. Bulk Fixed and Bulk Variable also
display PO Number. Package Fixed and BCC omit PO Number; their descriptions wrap
to at most two lines and truncate overflow with `...`. Part Number retains its
existing size and remains dominant, followed by Description, Quantity, Lot Number,
and Barcode when applicable.

Fixed-quantity labels shall also display:

- Product Barcode on Package Fixed
- Bulk Barcode on Bulk Fixed

## Preview Rendering

- Use imported database fields, with no generated or substituted barcodes.
- Make Part Number the largest text on every label; Quantity must be smaller.
- Use flat BILLCO CORPORATION branding, black ink, white stock, and upright
  industrial typography. Exclude addresses, websites, and decorative graphics.
- Show proportional 3x5 or 3x2 previews and the matching size caption.
- Update automatically on label type, Part Number, quantity, PO, or lot edits.
- Missing bulk quantity or barcode affects only Bulk Fixed availability.
- Render previews only; printing, SATO integration, PDF generation, customer
  labels, pallet placards, and Will Call labels are outside this implementation.

## Operator workspace design standard: One Page, No Scroll

All operator-facing label workflows must keep their primary workflow on a single
screen. The acceptance target is a 1920×1080 workstation at 100% browser zoom and
100% Windows scaling.
Product fields, Printer, Print Quantity, PRINT, and the readable label preview
must be visible simultaneously, including after a job is recorded.

New features must not extend the normal workflow vertically. Reorganize using
horizontal groups, compact controls, responsive layouts, and collapsible secondary
panels. Print History is collapsed by default. Opening secondary history may
use additional space; normal label creation must not depend on opening it.
Maintain readable inputs, keyboard access, and the existing label rendering.
Do not achieve fit by clipping content or hiding document overflow.

Apply this standard to Package Fixed, Bulk Fixed, Bulk Variable, BCC, and future
operator label formats. Add viewport-bound checks when changing workspace layout
or introducing operator controls. Smaller displays should reorganize secondary
content responsively rather than reduce the physical label's legibility.

Layout priority: product selection, label preview, printer selection, print
quantity, then print action. Secondary information must collapse or move into
expandable sections before it forces normal operation to scroll.

Scrolling exceptions: administration, print history review, product maintenance,
import validation results, large reports, and audit logs. These exceptions do not
apply to normal operator label creation and printing.


### Monitor size is not browser content size

The 1080p monitor requirement is a hard pass/fail workflow requirement, not a
1080px CSS-viewport assumption. Reserve room for Windows and browser chrome.
Regression checks include 1920×900 usable content pixels (180px reserved), plus
940, 1000, and 1080px heights at scale 1 / 100% zoom. Keep all eleven primary
fields/actions and the full preview visible through lookup, mode selection,
PO/LOT entry, PREVIEW focus, keyboard navigation, printer/copy selection, and
job recording. Require zero document overflow, zero scroll offset, and zero
window scroll events throughout. Viewport-fit screenshots alone are insufficient.

A physical Windows workstation acceptance test remains the final acceptance
step; simulated Chromium viewport evidence must not be presented as a physical
Windows desktop capture or automatically close a reopened acceptance issue.

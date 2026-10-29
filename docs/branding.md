# Official Billco application logo

The shared application header uses the official image attached to
[Issue #24](https://github.com/ramongjr-source/billco-label-management/issues/24):

https://github.com/user-attachments/assets/d4390e47-4232-4fd2-be2b-ce5a80e18bcc

`src/components/BillcoLogo.tsx` references `/assets/billco-logo.png` as an image,
with accessible alt text. No artwork is recreated, cropped, recolored, skewed,
filtered, or stretched. CSS sets the width responsively and leaves height
automatic, preserving the source image's aspect ratio and any transparency.
The simulated letter/wordmark styles and the unused Roboto Slab font import
have been removed.

The header is shared by Product Labels (all four label types) and Import Master
List. Its branding area is positioned above the existing sidebar. Navigation,
sidebar widths, and application functionality are unchanged. Thermal label
branding and barcodes retain their existing rendering.

## Verification status

The runtime reference is local; there is no runtime dependency on GitHub.
The actual source image still needs to be added at `public/assets/billco-logo.png`.
The cloud environment blocks the original attachment redirect host,
`github-production-user-asset-6210df.s3.amazonaws.com`, with HTTP 403. Inline
images supplied in chat were visible to the assistant but were not exposed as
files in the execution workspace. A bundled source image, loaded-image visual
verification, and after screenshots are therefore still pending. The PR should
remain a draft until those checks can be completed. Existing application tests
do not establish that the external logo image loaded successfully.

The following before screenshots were captured from `de79890` before changing
the branding. They show the application header and sidebar at the existing
layout dimensions. Baseline layout measurements were also recorded for all
four label modes and Import Master List at 320, 390, 768, 1024, 1280, 1366,
and 1536 pixels wide.

| Before: desktop | Before: laptop |
| --- | --- |
| ![Desktop before](screenshots/official-logo/before-desktop.png) | ![Laptop before](screenshots/official-logo/before-laptop.png) |

| Before: import | Before: mobile navigation |
| --- | --- |
| ![Import before](screenshots/official-logo/before-import.png) | ![Mobile before](screenshots/official-logo/before-mobile.png) |

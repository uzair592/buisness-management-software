# Milestone 10: Polished Web UX, Invoice Templates & Web Printing

## 1. Overview & Scope

Milestone 10 delivers a commercial-grade, accessible web user experience and a modular multi-template printing engine for the online business management application:
- **Responsive Layout Audits**: Evaluated and optimized across 1366 × 768 (standard laptop cashier POS), 1920 × 1080 (desktop widescreen), and 390 × 844 (mobile browser smartphone). Touch targets enforced at $\ge 44\text{px}$ for touchscreens.
- **Three Standard Printable Document Templates**:
  1. **A4 Full Page**: Formal tax invoice with merchant header, logo (small/medium/large/none), customer bill-to details, line items table with long description word-wrapping, unit, rate, discount, tax breakdown, grand total in PKR, formal amount in words, payment breakdown (cash/bank), terms and authorized signature box.
  2. **80mm Thermal (POS Counter Receipt)**: Optimized for 80mm receipt rolls ($72\text{mm}$ printable width). Centered store header, bill metadata, compact item list, subtotal, tax, grand total, tender details, and scannable visual barcode block.
  3. **58mm Compact Thermal**: Optimized for small portable and Bluetooth receipt printers ($48\text{mm}$ printable width, 32-column density) with tight two-line item listings.
- **Reprint Snapshot Fidelity**: Reprints use the immutable saved document snapshot created at commit time. Later catalogue edits or pricing changes do not alter historical receipts. An explicit `*** REPRINT / DUPLICATE COPY ***` watermark is rendered on reprinted bills.
- **Scoped Print CSS**: Scoped `@media print` rules ensure only the printable document container is visible to the print spooler, hiding application sidebars, navigation dialogs, headers, and buttons. Thermal page sizing (`@page { size: 80mm auto; margin: 0; }`) avoids unwanted blank sheet feeds or page cuts.
- **Connection Awareness**: Live status pill in the application header indicating `Live Online` (with pulse indicator) or `Offline`, with friendly reconnect guidance.

---

## 2. Real Hardware & Browser Printer Reality

In accordance with the Milestone 10 specification, physical printer and cutter capabilities are recorded transparently:
- **Browser Execution Environment**: Chromium (Playwright / Google Chrome), running on Windows and Linux hosts.
- **Print Spooling**: Browser `window.print()` outputs standard OS print spooler jobs to standard laser/inkjet printers (A4) and POS receipt printer drivers (Generic/Text Only, Epson ESC/POS, POS-80, POS-58).
- **Knife Cutters & Cash Drawers**: Standard browser DOM/CSS printing cannot execute raw binary ESC/POS control sequences (such as `GS V 66 0` for partial knife cut or `ESC p 0 25 250` for cash drawer pulse). These hardware features require either:
  1. An operating system printer driver configured with "Cut Paper on End of Job" and "Open Cash Drawer Before Print", or
  2. A dedicated local print bridge / native shell (e.g. QZ Tray or WebUSB/WebSerial).
  The application renders cut margins and blank feed spacers at the receipt bottom to prevent the driver cut from clipping receipt footer notes.

---

## 3. Evidence Screenshots

The following automated Playwright E2E screenshots were generated during the acceptance run and saved to this directory:
- [Rendered A4 Formal Tax Invoice](rendered-a4-invoice.png)
- [Rendered 80mm Thermal Receipt](rendered-80mm-thermal.png)
- [Rendered 58mm Compact Thermal Receipt](rendered-58mm-thermal.png)
- [1366 × 768 Billing Workspace](viewport-1366x768-billing.png)
- [1920 × 1080 Sales History](viewport-1920x1080-sales.png)
- [390 × 844 Mobile Settings & Navigation](viewport-390x844-mobile-settings.png)

---

## 4. Verification & Test Summary

All workspace checks, database suites, and browser E2E suites passed:
1. **`pnpm check`**:
   - ESLint: 0 warnings, 0 errors.
   - Strict TypeScript check: 6/6 workspace projects passed.
   - Production builds: API and Web bundles created successfully.
   - Domain unit tests: 29/29 passed.
2. **`pnpm test:db`**:
   - 15/15 database integration test suites passed against real PostgreSQL under restricted `bms_runtime` role with RLS enforcement.
3. **`pnpm test:e2e`**:
   - 25/25 Playwright browser end-to-end test suites passed across desktop and mobile viewports.
   - Includes dedicated M10 test suite `tests/e2e/print-and-ux.spec.ts`.

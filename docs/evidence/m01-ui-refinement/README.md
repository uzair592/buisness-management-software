# M01 UI refinement evidence

**CI repair follow-up:** the initial reviewed commit failed its mobile browser
gate despite the local results below. See the [diagnosis, regression evidence
and current validation](ci-filter-fix.md) for the repair on the same PR.

Base: merged `main` at `7e2eef9`. Branch: `milestone-01-ui-refinement`.
Validated on 15 October 2026 with Node 22.20.0, pnpm 10.28.2 and Playwright
Chromium on Windows. [Design and isolation notes](../../m01-ui-refinement.md).

## Validation

| Command | Observed result |
| --- | --- |
| `pnpm install` | Passed; linked the new internal domain package, no external dependencies added |
| `pnpm install --frozen-lockfile` | Passed with the updated lockfile |
| `pnpm check` | Passed lint, all workspace/test typechecks, API/web production builds, and 4 tests (2 API/config, 2 exact arithmetic) |
| `pnpm test:e2e` | 7 tests passed against the production preview, across all three target sizes |
| `pnpm test:db` | 1 real PostgreSQL readiness/unreachable-endpoint/recovery test passed |
| `pnpm test:runtime` | 1 compiled API startup + real HTTP liveness/readiness test passed |
| `git diff --check` / `git diff --cached --check` | Passed before commit |

The DB regression checks used the existing temporary native PostgreSQL 17.7
cluster on loopback, with no tables or migrations added:

```powershell
$env:DATABASE_URL = 'postgresql://bms_local@127.0.0.1:55432/postgres?connect_timeout=2'
pnpm test:db
pnpm test:runtime
```

No API or database behaviour changed. The previous Docker Linux-engine limitation
is unchanged; these results are real PostgreSQL checks, not container-start claims.
CI uploads the expanded screenshot directory and runs all automated checks on Linux.
CI results are reported separately when observed.

## Observable browser checks

- Empty operational pages have no sample figures and keep invoice posting disabled.
  Every sidebar route works; selection, desktop collapse, mobile menu and focus
  restoration are checked at each viewport.
- Sample entry is explicit. Exit clears the sample cart/customer and returns Home;
  reload returns to operational mode. A second tab remains independent. The tested
  journey makes no posting requests and writes no localStorage, sessionStorage or
  IndexedDB data.
- The fixed-day sales amount is **PKR 1,772.50**; all fixture dates produce
  **PKR 4,886.50**; the final seven fixture days produce **PKR 3,995.50**. Date,
  name/reference search and paid/due filters update records. Details retain filters.
  Receivables, payables and low-stock shortcuts open corresponding filtered views.
- Name/barcode search supports mouse, arrows, Enter, Escape and no-match results.
  Two notebooks plus one tea produce **PKR 816.50**. Three notebooks plus one tea
  produce **PKR 1,002.00** in both cart and sample receipt. Removing tea gives
  **PKR 556.50**. Zero/invalid quantity blocks receipt preview. Clearing requires
  confirmation; cancellation preserves lines, confirmation returns focus to search.
- Command search, modal Tab containment, Escape and opener restoration work.
  Reduced-motion CSS, page overflow and reachable receipt action are checked.

Initial browser checks found missing focus restoration and native dialog Tab
boundary escapes. These were fixed in shared UI controls rather than removing
the assertions. Route tests wait for the destination heading before manipulating
controls shared by multiple routes. Final checks use no arbitrary sleeps or mock
posting responses.

Exact arithmetic tests cover decimal sums, six-decimal quantity increments,
ROUND_HALF_UP ties, amounts beyond JavaScript's safe integer range and crossing
18 integer digits, plus rejection of invalid/negative/zero/excess-precision input.
They do not assert completion of the future accounting engine.

## Before and after screenshots

Original M01 screenshots are preserved without modification in `../m01`. The
new images are captured at the actual named viewport, with CSS transitions
completed. Empty operational and populated sample Home/New Sale are both shown.
All images were visually inspected.

| Viewport | Before Home | Empty Home | Sample Home | Before Sale | Empty Sale | Sample Sale |
| --- | --- | --- | --- | --- | --- | --- |
| 1366×768 | [Before](../m01/home-1366x768.png) | [After](operational-home-1366x768.png) | [Sample](sample-home-1366x768.png) | [Before](../m01/sale-1366x768.png) | [After](operational-sale-1366x768.png) | [Sample](sample-sale-1366x768.png) |
| 1920×1080 | [Before](../m01/home-1920x1080.png) | [After](operational-home-1920x1080.png) | [Sample](sample-home-1920x1080.png) | [Before](../m01/sale-1920x1080.png) | [After](operational-sale-1920x1080.png) | [Sample](sample-sale-1920x1080.png) |
| 390×844 | [Before](../m01/home-390x844.png) | [After](operational-home-390x844.png) | [Sample](sample-home-390x844.png) | [Before](../m01/sale-390x844.png) | [After](operational-sale-390x844.png) | [Sample](sample-sale-390x844.png) |

[Sample receipt dialog at 1366×768](sample-receipt-1366x768.png).

## Remaining limits

Only frontend sample exploration is new. No real identity, invoice numbering,
posting, payments, journals, persistent transactions, offline support or sync was
implemented. Dates and stock are fixed fixtures, not live business results. Tax,
discount, allocation and valuation rules remain future work. Sample receipt preview
does not print, save or issue an invoice. Chromium viewport emulation is not a
physical mobile or printer test. No migration or storage reset is required.

M02 remains the next eligible numbered prompt after this refinement is reviewed
and merged. No merge or deployment is authorized by this evidence.

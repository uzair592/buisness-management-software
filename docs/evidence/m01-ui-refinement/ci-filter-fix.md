# PR #2 transaction-filter CI repair

## Diagnosis

[The reviewed-commit Actions run](https://github.com/uzair592/buisness-management-software/actions/runs/38764566377)
failed on `2c7f30181ab1c88867a17ba6ee5bb37f1befe485`: install,
`pnpm check`, database and runtime checks passed; browsers finished 6 passed,
1 failed. The 390×844 journey timed out waiting for `View Sample S-1045`.
That workflow uploaded screenshots but omitted its error context and trace, so
the exact filter values from that historical failure cannot be recovered.

The unchanged production preview passed the exact mobile journey locally.
Moderate CPU throttling also passed the ordinary journey. A focused browser
regression then reliably exposed an application race by delivering consecutive
native date/search/status events in one browser task, before React could commit
the intervening router renders. This stress phase follows five repetitions of
the original Reset filters → Ayesha → Due → detail → Escape journey.

`PeriodFilter` and `Transactions` cloned the URL parameters captured by their
last render. BrowserRouter updates browser history synchronously and renders
the new location through a React transition. A subsequent handler could
therefore restore an older date, query or status. The installed router's
functional `setSearchParams` callback also receives a render snapshot; changing
only to callback syntax would not fix composition across these components.

The before-fix capture shows:

- URL: `/home?period=day&q=&status=Due`, although the latest requested values
  were all dates, Ayesha and Due.
- Selected date: `day`; search: empty; status: `Due`.
- Rendered records: S-1047 and P-0216. S-1045 is dated 12 October and is
  correctly excluded by the incorrectly restored 15 October date filter.
- History changed to `period=all`, then the search handler restored `period=day`,
  then the status handler restored the empty query.
- No console warnings/errors or uncaught page errors.
- Accessibility snapshot exposes the selected day, empty searchbox and two
  transaction buttons; S-1045 is absent. This is filter state loss, not a hidden
  mobile button or incorrect fixture amount.

Evidence: [captured state and URL/event timeline](filter-race-before.json),
[accessibility tree](filter-race-before-accessibility.yml),
[before-fix mobile screenshot](filter-race-before-390x844.png).
These are local stress-reproduction artifacts, not artifacts from the old CI run.

## Fix and regression coverage

The shared transaction-filter hook now reads the current browser URL at event
time and applies only the requested field. React Router still owns navigation
and rendered state. Existing push/replace history choices and reset semantics
remain intact. This relies on the application's existing BrowserRouter; no
second store, fixture mutation, API call or persistence was introduced.

Three focused tests exercise five ordinary reset/search/status/detail cycles,
sixfold Chromium CPU throttling, same-task date/search/status composition,
the single expected S-1045 row and PKR 960.00 detail, Escape/focus restoration,
preserved controls, and browser Back/Forward. The same-task phase fails against
the old production bundle and passes with the fix. No assertions were removed,
no clicks forced, and no sleeps, retries or timeout increases were added.

Inspected corrected views:
[1366×768](filtered-transactions-1366x768.png),
[1920×1080](filtered-transactions-1920x1080.png),
[390×844](filtered-transactions-390x844.png).
The original visual evidence remains unchanged.

Playwright now retains traces and screenshots on failure and generates an HTML
report. The shared browser fixture attaches URL/parameters, control values,
rendered rows, focus, recent input/history events, console/page errors and an
accessibility snapshot on failure. CI always uploads `test-results/`,
`playwright-report/` and evidence screenshots with 14-day retention. Download
the run's `foundation-browser-evidence` artifact; use `pnpm exec playwright
show-report <report-directory>` or `pnpm exec playwright show-trace <trace.zip>`.

## Observed validation

Windows, Node 22.20.0, pnpm 10.28.2; real Vite production preview and Chromium:

| Command | Result |
| --- | --- |
| `pnpm exec playwright test -g "sample dashboard.*390"` before fix | 1 passed; original intermittent failure did not recur on this attempt |
| `pnpm exec playwright test transaction-filters -g "390"` before fix | 1 failed at combined URL assertion; date/query updates lost, state/accessibility/screenshot captured |
| `pnpm check` after application fix | Passed lint, all typechecks, production builds and 4 API/arithmetic tests |
| `pnpm test:e2e` | **10 passed (3.4m)**; all three viewports, original 7 tests plus 3 filter regressions |
| `pnpm test:db` | 1 passed against native PostgreSQL 17.7 |
| `pnpm test:runtime` | Initial concurrent run failed readiness (503); rerun after browsers finished: **1 passed** |
| `git diff --check` / `git diff --cached --check` | Passed before committing the repair |
| Relative documentation links in status and refinement evidence | 35 checked; none missing |

The local runtime 503's precise cause was not established. The server has short
connection/pool timeouts; host contention is a possibility, not a verified cause.
No API/database code or timeouts were changed to suppress it. Database checks
used `postgresql://bms_local@127.0.0.1:55432/postgres?connect_timeout=2`.

Repair commit: `33eb6cd96be94efa7647b0648af21da6a0ef8c8e`.
Both [PR Actions](https://github.com/uzair592/buisness-management-software/actions/runs/38770301679)
and [push Actions](https://github.com/uzair592/buisness-management-software/actions/runs/38770294122)
completed **successfully** on 15 October 2026. Install, Prisma generation,
`pnpm check` (including 4 tests), real PostgreSQL database/runtime checks
(1 test each), and **10 browser tests** passed on Linux.
The [expanded browser artifact](https://github.com/uzair592/buisness-management-software/actions/runs/38770301679/artifacts/11992180205)
uploaded successfully with the HTML report, test results and screenshots.
Passing runs discard traces by design; future failures retain their traces
and attached diagnostics. The historical failed run remains documented above.
PR #2 remains the review unit; its final documentation-follow-up checks are
reported on the PR rather than recursively generating evidence commits.

## Scope

No dependency, schema, migration, business record, browser-store or API change.
Sample data remains memory-only and operational posting stays disabled. M02
and later business capabilities remain unfinished. Chromium viewport/CPU
emulation is not physical device testing. No merge or deployment was performed.

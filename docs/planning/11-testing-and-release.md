# Testing and release evidence

The 2026-10-20 online-only decision supersedes offline issue cases T06–T12 as release prerequisites. Retain them as historical regression context for legacy recovery. Current M06 exit evidence is defined in [online M06](../../prompts/06-online-web-transition.md); real PostgreSQL/browser online retry, tenant scope, two-browser operation and old-browser retirement remain required.

## Test layers

| Layer | Required behaviour |
| --- | --- |
| Domain unit/property | Exact rounding and discount allocation, unit conversion, posting balance, state transitions, cost deficit settlement |
| PostgreSQL integration | Tenant FKs/RLS, transaction rollback, idempotency, row-lock concurrency, commit-ordered cursor, source-effect uniqueness |
| Migration | Empty database setup, representative previous version upgrade, duplicate/invalid fixtures, backup/recovery route |
| Browser end-to-end | Real login, persisted bill, ordinary reload, offline issue, two isolated contexts, queue recovery and role-restricted data |
| UI/print verification | Laptop/mobile layouts, keyboard/touch journey, A4/58/80 mm output, long data and logo sizes |
| Operational | Fresh deployment, backup/restore, old-epoch fencing, credentials, monitored worker failures and rollback compatibility |

Mocked network responses are useful for component states; they cannot prove posting, tenant isolation, multi-device convergence or accounting correctness. Run the real API and PostgreSQL for those claims.

## Acceptance scenarios

| ID | Scenario and expected result | Gate |
| --- | --- | --- |
| T01 | Username login sends the entered username; malformed auth errors retain input; no default production credentials | M02 |
| T02 | Business A user cannot query/mutate/export/restore Business B; runtime DB role and reused pool connections remain isolated | M02/M11 |
| T03 | Decimal fixtures match displayed/saved/printed totals exactly; entry debit equals credit at commit | M03/M05 |
| T04 | Inject failure between invoice/journal/stock/receipt writes: all effects roll back | M03/M05 |
| T05 | Double click, repeated POST and lost acknowledgement return one invoice, payment, stock effect and journal | M05/M06 |
| T06 | Offline issue, ordinary close/reopen and reconnect preserve the same number/snapshot and post once | M06 |
| T07 | Two devices issue separate bills concurrently, including last-known stock; both converge with explicit deficit handling | M06/M08 |
| T08 | Delay transaction A after cursor preparation; B must not expose a later committed cursor that lets pull skip A | M06 |
| T09 | Pull interrupted between payload and cursor application replays safely; expired cursor resnapshot preserves local overlay | M06 |
| T10 | Expired lease, revoked device, epoch mismatch, incompatible schema and clock anomaly block/hold correctly without erasing issued work | M06/M11 |
| T11 | Two tabs cannot reuse the same number; quota/abort displays unsaved and never prints success | M06 |
| T12 | Cashier snapshot/pull excludes cost/profit fields and unauthorised locations even when inspecting network/local storage | M02/M06 |
| T13 | Purchase creates stock/payable once; payment allocation replay or concurrent allocation cannot over-settle | M07 |
| T14 | Partial returns/refunds from two devices cannot exceed original remaining quantity/amount; refund does not reverse revenue twice | M08 |
| T15 | Negative stock plus partial/later receipts and returns produces linked cost adjustments and reconciled inventory/COGS | M08/M09 |
| T16 | Mixed sales/purchases/tax/discount/return/expense/advance/transfer/openings reconcile journal, P&L, stock, cash and dues | M09 |
| T17 | Offline report clearly shows last sync and scope; export matches filters and does not claim whole-business completeness | M09 |
| T18 | Close cash session, then sync a late offline cash bill: original close is retained and variance adjustment is visible | M09 |
| T19 | 1366 × 768 billing keeps cart/totals usable; 390 × 844 works by touch; keyboard focus/errors are accessible | M10 |
| T20 | Long receipts, large/small logos, page breaks and reprints verified; printer/cutter results state actual device/driver/browser | M10 |
| T21 | Tenant archive and local recovery bundle restore in isolation with checksums and matched balances; wrong key/version fails safely | M11 |
| T22 | Promote restored dataset; old devices/queues are fenced and cannot silently recreate deleted historical records | M11 |
| T23 | Import dry run makes no changes; repeated batch does not duplicate openings/items; CSV text is safe to open | M11 |
| T24 | Partial quote/order conversion and transfer dispatch/receipt races respect remaining quantities; transit balances reconcile | M12 |
| T25 | Fresh production-like host boots with migrations/worker/health; backup restore and rollback procedure executed | M11/M13 |

## Performance and scale targets

Treat these as proposed acceptance budgets, measured on documented pilot hardware/network: catalogue search at about 10,000 cached permitted items should feel immediate (target p95 under 150 ms); local cash issue excluding print under 500 ms; typical online posting under 1.5 seconds p95 on a normal connection; filtered dashboard under 2 seconds p95. Measure API, DB and browser separately. No benchmark claim without dataset, device and command evidence.

Paginate long histories and chunk bootstrap safely. Stress the business sync-head lock and explain achieved throughput before adding queues/microservices. Verify the expected concurrent counters and transaction volume chosen for the pilot, not an invented enterprise scale.

## Real-business pilot

Use a controlled pilot business with validated opening balances, known devices and a rollback/recovery plan. Compare at least one complete business day against an independent cash/stock/dues record. Exercise an outage, a reconnect, a return, a partial payment, a purchase and a restore drill. Verify actual receipt hardware and both owner mobile and billing laptop journeys.

Go/no-go evidence must state exact release SHA, enabled modules, supported browsers/devices, configuration, remaining defects, data reconciliation outcome and whether all release-blocking checks passed. An automated agent can prepare a candidate; it cannot invent physical hardware evidence or silently promote to production.

## Release blockers

Any data loss/duplicate effect; cross-business leak; unbalanced journal; unexplained cash/stock/dues mismatch; false saved/paid/synced state; silent loss on update/restore; missing recovery evidence; unsupported printer relied on by pilot; unresolved critical security issue; hidden provisional profit; failed enabled core workflow. Cosmetic improvements alone do not resolve these blockers.

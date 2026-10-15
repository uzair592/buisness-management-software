# Open decisions, assumptions and risks

Work may begin using the reversible defaults below. They are not a request to stop planning. Revisit a choice before its dependent milestone if the user supplies different requirements.

## Decisions to confirm

| Decision | Proposed default | Needed before |
| --- | --- | --- |
| Product name/brand | Working title Business Management Software; original neutral-blue UI | M10 branding |
| First business segment | General retail/wholesale/service, one pilot segment | M04/M05 data and workflows |
| Ownership model | Multiple isolated businesses with membership; no paid SaaS billing initially | M02; M14 only if selling SaaS |
| First platform | Laptop/mobile PWA; offline issue only on tested devices | M06/M10 |
| Language | English first; Urdu/RTL later | M10 |
| Local defaults | PKR, Asia/Karachi, configurable business profile | M02/M03 |
| Jurisdiction integration | Generic tax fields only; no FBR/KPRA/GST submission | Before any compliance claim |
| Offline actions | Cash sales, cached-item purchases and simple cash expenses; credit/refunds/allocations online | M06/M07 |
| Offline lease duration | 72 hours on a previously approved device | M02/M06 pilot policy |
| Negative stock | Warn, preserve sales and flag provisional valuation; strict-stock mode requires online issue | M06/M08 |
| Inventory costing | Perpetual moving weighted average with linked deficit adjustments | M03/M08 |
| Print hardware | Browser printing first; actual A4/58/80 mm devices determine bridge/native need | M10 |
| Multi-location | One active location first; warehouse transfer in M12 | M04/M12 |
| Backup targets | Encrypted daily cloud snapshots plus device bundle; verify measured RPO/RTO | M11 |
| Hosting/budget | Undecided; choose from measured pilot load and recovery needs | M11 |
| Expected size | Pilot dataset and concurrent counter count to be measured, not assumed unlimited | M06/M13 |

## Proposed additions beyond the baseline

These are candidates, not committed requirements or implemented features. Pick the additions that address the first customers' real needs; give each its own requirements and acceptance tests.

| Candidate | Why it may help | Sequence |
| --- | --- | --- |
| Owner mobile summary and exception inbox | Monitor cash, dues, stale devices and unresolved issued bills | Basic summary M09; richer alerts later |
| Customer-specific/wholesale price lists | Different retail and bulk prices without repeated manual edits | After core calculation/permissions |
| Urdu/English with RTL printing | Local staff adoption and readable receipts | After tested core UI |
| WhatsApp invoice sharing and due reminders | Faster collection and customer communication | Manual share first; provider automation later |
| Batches/expiry/serial numbers | Pharmacy, food and electronics inventory | Separate stock/allocation design; not a checkbox |
| Recipe/manufacturing and packaging conversions | Raw-material consumption and production costing | Later domain module, not a v1 shortcut |
| Customer loyalty and sale insights | Retention and product analysis | After reliable sales/report history |
| Android APK / Windows shell | OS printing, key storage and installation needs | Only after device tests demonstrate value |
| Approval thresholds | Control large discounts, refunds, expenses and account changes | Basic role rules first; approvals later |
| Read-only AI business assistant | Explain accepted reports with source links | After accounting accuracy; never auto-change books |
| SaaS subscription/platform portal | Sell access and manage customer businesses | Optional M14, isolated from business roles |

## Main risks and responses

| Risk | Planned response |
| --- | --- |
| Offline/multi-device overselling | Honest quantity warnings, explicit deficit valuation; online-only strict mode |
| Queue lost by browser clearing/device loss | Durable local transaction, persistence request, frequent sync and encrypted export; native option if justified |
| Duplicate effects on retries | Stable command IDs, immutable payload hashes, unique source effects and one DB transaction |
| Skipped sync events due to commit reordering | Business sync-head lock for all writers; delayed-commit concurrency test |
| Employee revocation while disconnected | Short signed lease, lock on reconnect and preserved review queue |
| Wrong profit from missing cost | Valuation exceptions and linked adjustments; no final-profit claim until resolved |
| Partial local data shown as company truth | Server reports plus explicit source/coverage/stale-device metadata |
| Scope expands into all industries | General core first; selected vertical modules after pilot |
| Printer/browser incompatibility | Real hardware matrix; saved-document reprint and optional later bridge |
| Restore followed by old-device replay | Dataset epoch fence, fresh snapshot and reviewed pending-work adoption |
| User expects exact Vyapar migration/parity | Published reference-behaviour matrix and tested CSV scope; no undocumented backup conversion claim |

Implementation agents should record any changed decision with its reason, affected documents, migration impact and required tests. Do not silently change an accounting or sync invariant to get a test green.

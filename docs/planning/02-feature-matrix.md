# Feature and offline matrix

All rows are **planned**, not implemented. M01–M13 form the main build sequence. “Offline” assumes an enrolled device, completed initial snapshot, supported cached schema/policy and unexpired signed offline lease.

| Module | Core behaviour | First milestone | Offline in core release |
| --- | --- | --- | --- |
| Business and identity | Sign-in, memberships, roles, device enrol/revoke | M02 | Existing local unlock only; no new login/enrolment |
| Catalogue | Items/services, categories, units, barcodes, active/archive | M04 | Read cached catalogue; draft proposed changes |
| Parties | Customers/suppliers, dual-role parties, contact data, statements | M04 | Read cached; create provisional party with stable UUID |
| Opening balances | Stock, cash/bank, receivables/payables and equity balancing | M04 | Online posting only |
| Sales | Items, discounts, taxes, cash/bank/credit and split payment online | M05 | Cash sale using cached items and permitted cash account at M06 |
| Credit sales | Customer dues, due date and credit policy | M05 | Draft only in initial release; strict limit needs current server data |
| Purchases | Stock receipt, supplier bill, payable and payment | M07 | Issue purchase with payable or authorised cash payment; requires cached items and supplier or provisional party |
| Expenses | Dynamic categories, attachments, cash/bank payment | M07 | Simple paid cash expense with cached category; attachment upload deferred |
| Payments | Receive/pay, advances, partial allocations, multiple accounts | M07 | Draft only standalone receipts/payments; invoice-cash components sync with parent command |
| Bank transfers | Transfer across internal money accounts | M07 | Online only |
| Returns and refunds | Linked partial credits, restock choices and remaining limits | M08 | Draft only; server checks shared return/refund limits |
| Inventory | Immutable movements, counts/adjustments, valuation exceptions | M08 | Quantity preview and warnings; counts/adjustments post online |
| Cash close | Count cash, variance reason, close watermark and late entries | M09 | Offline count draft; close online |
| Reports | Sales, purchases, dues, stock, cash/bank, P&L, trial balance | M09 | Cached report snapshots; explicit coverage and provisional labels |
| Printing | A4, 80 mm, 58 mm, logo scaling, reprint | Basic M05; full M10 | Print saved documents using installed/browser capability |
| Device sync | Durable queues, cursor pull, retry, review cases, resnapshot | M06 | Queue supported commands; no cross-device sync during total disconnection |
| Backup/recovery | Tenant snapshot, device bundle, isolated restore and epoch fence | M11 | Export encrypted local recovery bundle; cloud backup/restore online |
| Import/export | CSV item/party import, dry run, explicit opening imports | M11 | Export cached data with coverage; imports post online |
| Quotes/orders | Non-posting documents and partial conversion | M12 | Draft only; issue/convert online in v1 |
| Warehouses | Locations, dispatch/receive, in-transit stock | M12 | View last known quantities; transfer online |
| Install/update | PWA install help, safe app/schema updates | M06 basic; M10 full | Reopen installed app after prior online installation |
| Commercial SaaS | Plans, subscriptions, platform roles and device limits | Optional M14 | Defined business continuity policy required before enabling |

## Common rules

- “Offline support” means a tested local write path for the named action, not merely a service worker caching a page.
- New/provisional parties are uploaded before documents referencing them; similar names or phone numbers are suggestions for review, never automatic merging.
- Cash payment entered as part of an offline sale/purchase/expense is inside that command, with one atomic accounting effect. Do not also upload it as an independent payment command.
- Offline stock is a last-known local view. The default proposed policy allows quantity deficits with warnings and valuation exceptions. Businesses requiring strict no-negative stock must use online-only issue until a separate reservation design exists.
- Local-only changes never override canonical posted financial data. Current server authority can hold an issued local record for review; the original remains available.
- No supported operation should imply successful external card/bank processing, tax filing, email or messaging while offline.
- A fresh cloud report includes accepted cloud records, but may still lack other devices' pending work. Show last device contact and stale-device warnings.

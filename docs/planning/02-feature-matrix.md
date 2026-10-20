# Online web feature matrix

This is the intended scope after the 2026-10-20 online-only decision. A planned row is not an implemented feature; check [project status](../../PROJECT_STATUS.md) for evidence. Every real mutation requires an authenticated server connection. The old offline protocol is retained only as history and for recovery of browser-issued bills created before the cutover.

| Module | Core behaviour | First milestone | Connection and authority |
| --- | --- | --- | --- |
| Business and identity | Sign-in, memberships, roles, device enrol/revoke | M02 | Server session and selected business required |
| Catalogue | Items/services, categories, units, barcodes, archive | M04 | Server-authoritative CRUD |
| Parties | Customers/suppliers, dual-role parties, contact data | M04 | Server-authoritative CRUD |
| Opening balances | Stock, cash/bank, receivables/payables, equity | M04 | Preview and atomic online commit |
| Sales | Items, discounts, taxes, cash/bank/credit, split payment | M05 | Online posting and immutable server receipt |
| Purchases | Stock receipt, supplier bill, payable and payment | M07 | Online posting only |
| Expenses | Dynamic categories, cash/bank payment | M07 | Online posting only |
| Payments | Receive/pay, advances, partial allocations | M07 | Online limits and account locks |
| Bank transfers | Transfer across internal money accounts | M07 | Online atomic two-sided posting |
| Returns and refunds | Linked partial credits, restock and remaining limits | M08 | Online shared-limit checks |
| Inventory | Immutable movements, counts, adjustments and valuation | M08 | Online posting and source-cost reconciliation |
| Cash close | Count cash, variance reason and late entries | M09 | Online close watermark |
| Reports | Sales, purchases, dues, stock, cash/bank, P&L, trial balance | M09 | Server-authoritative coverage and freshness |
| Printing | A4, 80 mm, 58 mm, logo scaling, reprint | Basic M05; full M10 | Server-saved document before print |
| Multi-user access | Shared business data and concurrent posting | M06 online transition | Real PostgreSQL and two-browser evidence |
| Backup/recovery | Tenant backup, isolated restore and legacy device evidence | M11 | Cloud backup; encrypted local export only for old issued work |
| Import/export | CSV item/party import, dry run, explicit opening imports | M11 | Online validation and commit |
| Quotes/orders | Non-posting documents and partial conversion | M12 | Online issue and conversion |
| Warehouses | Locations, dispatch/receive and in-transit stock | M12 | Online shared-state checks |
| Web delivery | Responsive desktop/mobile browser UX | M06/M10 | Network required; no offline shell or install promise |
| Commercial SaaS | Plans, subscriptions and platform roles | Optional M14 | Separate product decision |

## Common rules

- No new bill may be issued from browser storage. The server assigns the final number and commits the document, journal, payments, stock and receipt in one transaction.
- An interrupted response is retried with the same command and document IDs. The server returns the original result without duplicating effects.
- Existing local issued work is evidence, not an automatically replayed source. Preserve its browser partition and encrypted export until an authorised reconciliation process is built and verified.
- Reports come from accepted server records and explicitly state coverage; no local array is a business-wide report.
- Printer, tax and external payment integrations require their own measured gates. Browser printing is not proof of hardware operation.

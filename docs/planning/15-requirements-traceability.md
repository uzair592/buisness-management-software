# Requirements traceability

All implementation status is tracked in [PROJECT_STATUS.md](../../PROJECT_STATUS.md). This table maps intended requirements to design and acceptance evidence; it does not mark them done.

| ID | Requirement | Design / diagram source | Milestone | Acceptance |
| --- | --- | --- | --- | --- |
| R01 | Clean, quick business UI | [UX](03-ux-and-screen-map.md), [navigation](../diagrams/03-navigation.mmd), [billing focus](../diagrams/22-billing-workspace.mmd) | M01/M05/M10 | T19, observed five-line sale |
| R02 | Sales, tax/discount and payment | [Rules](08-accounting-rules.md), [online sale](../diagrams/05-sale-online.mmd) | M03/M05 | T03–T05 |
| R03 | Genuine offline work | [Offline protocol](07-offline-sync.md), [offline sale](../diagrams/06-sale-offline.mmd) | M06/M07 | T06/T10/T11 |
| R04 | Multi-device convergence | [Sync sequence](../diagrams/07-sync-sequence.mmd), [states](../diagrams/08-sync-state.mmd) | M06 | T05/T07–T09 |
| R05 | Safe concurrent edits | [Metadata conflict](../diagrams/09-metadata-conflict.mmd) | M04/M06 | Expected-version test |
| R06 | Purchases and supplier dues | [Purchase flow](../diagrams/11-purchase.mmd) | M07 | T13/T16 |
| R07 | Cash, multiple banks, expenses and allocations | [Payments](../diagrams/12-payment-allocation.mmd), [expense/transfer](../diagrams/13-expense-transfer.mmd) | M07 | T13/T16 |
| R08 | Returns/refunds without history deletion | [Return](../diagrams/10-return-refund.mmd), [document states](../diagrams/25-document-state.mmd) | M08 | T14 |
| R09 | Accurate stock and cost exceptions | [Inventory/ledger ERD](../diagrams/20-erd-ledger-stock.mmd), [deficit valuation](../diagrams/27-valuation-exception.mmd) | M08 | T07/T15/T16 |
| R10 | Customer and supplier statements | [Trade ERD](../diagrams/19-erd-trade.mmd), [rules](08-accounting-rules.md) | M04/M07/M09 | T13/T16 |
| R11 | Shared reports with honest freshness | [Report flow](../diagrams/15-reports.mmd) | M09 | T16/T17 |
| R12 | Device/role control and tenant separation | [Identity ERD](../diagrams/18-erd-identity.mmd), [authority](../diagrams/23-offline-authorisation.mmd), [revocation](../diagrams/30-revocation.mmd) | M02/M06 | T01/T02/T10/T12 |
| R13 | Daily cash reconciliation | [Cash close](../diagrams/26-cash-close.mmd) | M09 | T18 |
| R14 | Print/logo/templates and reprints | [UX](03-ux-and-screen-map.md), [operations](12-deployment-backup.md) | M05/M10 | T20 |
| R15 | Backup, recovery and data portability | [Restore](../diagrams/16-backup-restore.mmd), [import](../diagrams/29-data-import.mmd) | M11 | T21–T23 |
| R16 | Quotes, orders and warehouses | [Quote/order](../diagrams/28-quotes-and-orders.mmd), [transfer](../diagrams/14-stock-transfer.mmd) | M12 | T24 |
| R17 | Deployable, recoverable product | [Topology](../diagrams/24-deployment.mmd), [release gates](11-testing-and-release.md) | M11/M13 | T25 and real-workday pilot |
| R18 | Ordered prompts and project map in GitHub | [Roadmap](10-delivery-roadmap.md), [dependencies](../diagrams/17-milestone-dependencies.mmd), [prompts](../../prompts/README.md) | M00 | Navigation, prompt/diagram validation and remote commit verification |
| R19 | Additional differentiating features | [Proposal backlog](13-open-decisions-and-risks.md) | Deferred/selected later | Requirement must be selected before claiming delivery |

T01–T25 are defined in [testing and release](11-testing-and-release.md). System context, module and sync ERDs describe cross-cutting boundaries used by all requirements.

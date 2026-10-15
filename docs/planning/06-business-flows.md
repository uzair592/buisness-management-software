# Business flow diagrams

The diagrams describe intended behaviour. They are not evidence of running features. Architecture, entity, sync, security and roadmap diagrams live in the linked specifications; [the catalogue](../diagrams/README.md) lists all 30 sources.

## Set up the business

### Business and device onboarding

```mermaid
flowchart TD
    Start["Open app online"] --> Login["Create account or sign in"]
    Login --> Business{"Existing business access?"}
    Business -->|Yes| Select["Select permitted business"]
    Business -->|No| Create["Create business and owner membership"]
    Create --> Setup["Currency, time zone and tax profile"]
    Setup --> Select
    Select --> Register["Approve device and number prefix"]
    Register --> Snapshot["Download scoped snapshot and cursor"]
    Snapshot --> Check["Verify storage and offline eligibility"]
    Check --> Ready["Ready to work"]
```

[Editable source](../diagrams/04-onboarding.mmd)

Online enrolment establishes identity, device numbering and a scoped initial snapshot. Opening balances are entered through a balanced setup workflow, not arbitrary edits to cash or stock totals.

## Sell and collect

### Online sale posting

```mermaid
flowchart TD
    New["New sale"] --> Lines["Choose customer and items"]
    Lines --> Totals["Calculate price, discount and tax"]
    Totals --> Payment["Cash, bank or credit split"]
    Payment --> Draft["Persist draft and stable command ID"]
    Draft --> API["Submit through command pipeline"]
    API --> Validate{"Authorised and valid?"}
    Validate -->|No| Correct["Show field or policy error"]
    Correct --> Draft
    Validate -->|Yes| Atomic["Commit invoice, stock, journal and receipt"]
    Atomic --> Ack["Apply canonical acknowledgement locally"]
    Ack --> Receipt["Print or share saved invoice"]
```

[Editable source](../diagrams/05-sale-online.mmd)
### Offline sale and later reconciliation

```mermaid
flowchart TD
    Open["Previously enrolled device"] --> Lease{"Offline lease valid?"}
    Lease -->|No| Read["Read saved data and prepare draft"]
    Lease -->|Yes| Sale["Create permitted cash sale"]
    Sale --> Check["Validate cached policy and local stock warning"]
    Check --> Local["One local transaction: invoice, number and outbox"]
    Local --> Print["Print saved invoice; cloud sync pending"]
    Print --> Connect["Reconnect and authenticate"]
    Connect --> Push["Retry same immutable command"]
    Push --> Result{"Server outcome?"}
    Result -->|Accepted| Accepted["Apply canonical entries and cursor"]
    Result -->|Needs review| Held["Preserve issued invoice in review queue"]
    Result -->|Temporary failure| Retry["Keep durable queue and retry"]
    Retry --> Connect
```

[Editable source](../diagrams/06-sale-offline.mmd)
### Business document lifecycle

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> IssuedLocal: Permitted offline issue
    Draft --> Posted: Online acceptance
    IssuedLocal --> Posted: Sync acceptance
    IssuedLocal --> ReviewRequired: Authority or compatibility conflict
    ReviewRequired --> Posted: Explicit authorised acceptance
    ReviewRequired --> ResolvedUnposted: Retain original and resolution evidence
    Posted --> PartlyCredited: Partial credit note
    PartlyCredited --> FullyCredited: Remaining quantities credited
    Posted --> FullyCredited: Full credit or eligible reversal
    Draft --> Discarded: No issued number or effects
    FullyCredited --> [*]
    ResolvedUnposted --> [*]
```

[Editable source](../diagrams/25-document-state.mmd)

Walk-in cash sales need no customer record. Credit sales require a party and current online credit-policy checks in the first release. A receipt always comes from saved data. Payment status is separate from document and sync status.

## Correct a sale

### Return and refund

```mermaid
flowchart TD
    Find["Open original accepted sale"] --> Select["Select remaining returnable quantities"]
    Select --> Reason["Reason and restock disposition"]
    Reason --> Validate["Lock original lines and prior credits"]
    Validate --> Credit["Post credit note and cost reversal"]
    Credit --> Due{"Credit use?"}
    Due -->|Reduce unpaid balance| Allocate["Allocate credit to receivable"]
    Due -->|Refund paid amount| Refund["Record approved cash or bank refund"]
    Due -->|Keep customer credit| Liability["Keep customer credit balance"]
    Refund --> Link["Link idempotent refund record"]
    Allocate --> Link
    Liability --> Link
    Link --> Receipt["Print credit note and updated statement"]
```

[Editable source](../diagrams/10-return-refund.mmd)

No delete-and-recalculate shortcut is allowed for a posted sale. A credit note can reduce an unpaid balance, retain customer credit or support an actual refund, subject to remaining quantities and amounts. A refund is a separate money event; it must not reverse revenue a second time.

## Buy, pay and record expenses

### Purchase and supplier payable

```mermaid
flowchart TD
    Start["Purchase bill or linked order"] --> Supplier["Supplier and unique reference"]
    Supplier --> Lines["Items, quantities, costs and tax"]
    Lines --> Pay["Paid amount and payment account"]
    Pay --> Validate["Validate totals and duplicate reference"]
    Validate --> Post["Atomic bill, stock receipt and journal"]
    Post --> Value["Update moving average or cost exception"]
    Value --> Due["Show supplier payable and payment history"]
    Due --> Audit["Save source document and audit trail"]
```

[Editable source](../diagrams/11-purchase.mmd)
### Payments and invoice allocation

```mermaid
flowchart TD
    Start["Receive or pay money"] --> Party["Party, direction and account"]
    Party --> Amount["Amount and reference"]
    Amount --> Allocate{"Allocate now?"}
    Allocate -->|Yes| Lock["Lock open documents and remaining amounts"]
    Allocate -->|No| Unallocated["Keep unapplied receipt or advance"]
    Lock --> Check{"Within outstanding and payment?"}
    Check -->|No| Correct["Correct allocations; no partial posting"]
    Correct --> Amount
    Check -->|Yes| Post["Atomic journal and allocation records"]
    Unallocated --> Post
    Post --> View["Receipt, account book and party statement"]
```

[Editable source](../diagrams/12-payment-allocation.mmd)
### Expenses and account transfers

```mermaid
flowchart TD
    Start["Money action"] --> Kind{"Expense or transfer?"}
    Kind -->|Expense| Expense["Category, amount, account and attachment"]
    Kind -->|Transfer| Transfer["Source, destination, amount and reference"]
    Expense --> Validate["Validate permissions and balances policy"]
    Transfer --> Validate
    Validate --> Atomic["Atomic balanced journal and source record"]
    Atomic --> Books["Update cash and bank books"]
    Books --> Reports["Expense affects profit; transfer does not"]
```

[Editable source](../diagrams/13-expense-transfer.mmd)

Purchase receiving and its accounting effect are atomic for the core purchase bill. Separately receiving against a purchase order belongs to M12 and must not double-add stock when a bill is later linked. An expense reduces profit; a cash-to-bank transfer does not.

## Control stock and daily cash

### Warehouse transfer with stock in transit

```mermaid
flowchart TD
    Plan["Draft transfer"] --> Check["Check source stock and permissions online"]
    Check --> Dispatch["Post source out and transit in"]
    Dispatch --> Transit["Goods in transit"]
    Transit --> Receive{"Destination receipt"}
    Receive -->|Full| Complete["Transit out and destination in"]
    Receive -->|Partial| Partial["Record received quantity; remainder stays in transit"]
    Partial --> Transit
    Receive -->|Damage or loss| Exception["Approved adjustment with reason"]
    Exception --> Complete
    Complete --> Audit["Same business cost; no sales revenue"]
```

[Editable source](../diagrams/14-stock-transfer.mmd)
### Negative stock valuation

```mermaid
flowchart TD
    Sale["Accepted stock sale"] --> Qty{"Known cost and sufficient quantity?"}
    Qty -->|Yes| Cost["Post moving-average inventory and COGS"]
    Qty -->|No| Estimate["Track deficit and provisional cost basis"]
    Estimate --> Flag["Flag valuation exception in profit reports"]
    Flag --> Receipt["Later receipt or approved cost evidence"]
    Receipt --> Adjust["Append linked COGS and inventory adjustment"]
    Adjust --> Resolve{"All deficit valued?"}
    Resolve -->|No| Flag
    Resolve -->|Yes| Closed["Close exception with full lineage"]
```

[Editable source](../diagrams/27-valuation-exception.mmd)
### Cash-session reconciliation

```mermaid
flowchart TD
    Open["Open cash session and counted float"] --> Trade["Record receipts, refunds and expenses"]
    Trade --> Sync["Sync assigned device queues"]
    Sync --> Freeze["Request close at server watermark"]
    Freeze --> Count["Enter physical cash count"]
    Count --> Difference{"Variance?"}
    Difference -->|No| Close["Seal session and counted balance"]
    Difference -->|Yes| Reason["Require reason and permitted approval"]
    Reason --> Close
    Close --> Late["Late offline entries remain visible as late adjustments"]
    Late --> Report["Retain original close and reconciliation history"]
```

[Editable source](../diagrams/26-cash-close.mmd)

Warehouses in the extended release use transit stock between dispatch and receipt. Negative stock caused by disconnected sales remains visible with provisional valuation; later cost evidence creates linked adjustment entries. Cash close preserves its original watermark and count when late offline records arrive.

## Review, protect and extend

### Report freshness and authority

```mermaid
flowchart TD
    Request["Choose report, dates and location"] --> Network{"Cloud reachable?"}
    Network -->|Yes| Canonical["Query posted server ledger at cursor"]
    Network -->|No| Snapshot["Read downloaded report snapshot"]
    Canonical --> Pending["Show unsynced device count and local queue"]
    Snapshot --> Label["Show last sync and incomplete coverage label"]
    Pending --> Result["Display source, coverage and valuation exceptions"]
    Label --> Result
    Result --> Drill["Drill into source documents"]
    Drill --> Export["Export same filters and freshness metadata"]
```

[Editable source](../diagrams/15-reports.mmd)
### Backup and isolated restore

```mermaid
flowchart TD
    Start["Owner requests backup"] --> Scope{"Backup scope"}
    Scope -->|Cloud records| Cloud["Consistent tenant snapshot and attachments"]
    Scope -->|Pending local work| Local["Encrypted device recovery bundle"]
    Cloud --> Manifest["Versioned manifest and checksums"]
    Local --> Manifest
    Manifest --> Download["Download and verify archive"]
    Download --> Restore["Restore into isolated recovery space"]
    Restore --> Validate["Validate schema, counts, balances and identifiers"]
    Validate --> Preview["Show differences and unresolved commands"]
    Preview --> Decide{"Owner selects resolution"}
    Decide -->|Review only| Keep["Keep current business unchanged"]
    Decide -->|Promote recovery| Epoch["Fence devices and increment dataset epoch"]
    Epoch --> Resnapshot["Re-enrol devices; inspect old queues separately"]
```

[Editable source](../diagrams/16-backup-restore.mmd)
### Safe data import

```mermaid
flowchart TD
    Upload["Upload CSV or supported archive"] --> Parse["Validate size, headers and types"]
    Parse --> Map["Map columns, units and identifiers"]
    Map --> Preview["Dry run with row errors and duplicate policy"]
    Preview --> Correct{"Ready?"}
    Correct -->|No| Upload
    Correct -->|Yes| Commit["Commit idempotent staged import batch"]
    Commit --> Reconcile["Verify counts and opening balances"]
    Reconcile --> Report["Download result and keep audit record"]
```

[Editable source](../diagrams/29-data-import.mmd)
### Quotes, orders and conversion

```mermaid
flowchart TD
    Draft["Draft quotation or purchase order"] --> Send["Issue non-posting document"]
    Send --> Accept{"Accepted?"}
    Accept -->|No| End["Expire or close with reason"]
    Accept -->|Yes| Convert["Convert selected remaining quantities"]
    Convert --> Invoice["Post sale or purchase through standard pipeline"]
    Invoice --> Remaining{"Unconverted quantities?"}
    Remaining -->|Yes| Partial["Retain partially fulfilled document"]
    Partial --> Convert
    Remaining -->|No| Complete["Mark fulfilled; preserve source link"]
```

[Editable source](../diagrams/28-quotes-and-orders.mmd)

Reports and exports carry the same filters and freshness information. A backup restore is first validated in isolation. An issued quote or order has no revenue/stock journal until a posting action explicitly converts or fulfils it.

## Other diagram groups

| Topic | Rendered diagrams |
| --- | --- |
| System and modules | [Architecture](04-architecture.md) |
| Screen navigation and billing focus | [UX map](03-ux-and-screen-map.md) |
| Entities and relationships | [Data model](05-data-model.md) |
| Delivery retries and conflicts | [Offline sync](07-offline-sync.md) |
| Offline authority and revocation | [Security](09-security-permissions.md) |
| Milestone dependencies | [Roadmap](10-delivery-roadmap.md) |
| Production runtime | [Deployment](12-deployment-backup.md) |

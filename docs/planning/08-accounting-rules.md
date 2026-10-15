# Accounting and inventory rules

This document specifies product behaviour and test fixtures. It is not a claim of statutory reporting certification. Obtain business/accountant review of the pilot's tax configuration and opening balances before relying on financial reports.

## Exact amounts and calculations

Use exact base-10 decimals end to end. Proposed v1: one currency per business; two currency decimal places; quantity scale 6; internal average-cost scale at least 8; explicit ROUND_HALF_UP for final currency amounts. Persist the currency, calculation version and rounding mode with each issued document. Do not use parseFloat, binary multiplication or locale formatting as a calculation engine.

Calculation order:

1. Convert quantity to the item's base unit using the versioned exact unit conversion. Keep original unit and conversion in the line snapshot.
2. Calculate quantity × entered unit price. Apply line discount, then allocate any document discount proportionally across eligible lines using a deterministic largest-remainder rule with stable line-ID tie-breaking.
3. Reject negative quantities/prices in ordinary issue commands, invalid percentages and discounts exceeding the eligible amount. Returns use dedicated commands, not negative sale lines.
4. For exclusive tax, round each line's discounted taxable base to currency precision, then round its tax. For inclusive tax, round the discounted inclusive amount, derive rounded tax as inclusive × rate / (100 + rate), and set base = inclusive − tax. v1 supports one generic tax rate per line and no compound/withholding regime.
5. Sum persisted line bases/taxes and explicit approved charges/rounding adjustment to the document total. Allocate any authorised cash rounding as a separate journalled adjustment. Document totals must equal the displayed/printed snapshot.
6. Apply payment components, credit and allocations separately. Cash tender greater than the amount applied is change, not revenue or a stored deposit unless the operator explicitly chooses an advance.

Store money/quantity values as decimal strings in API and local records. Use integer minor-unit techniques for allocation remainders where appropriate; do not convert large integers to unsafe JavaScript numbers. Version the calculation contract so old offline commands can be verified after an app update.

## Illustrative golden fixtures

| Scenario | Expected result |
| --- | --- |
| 3 × PKR 100, line discount 10%, exclusive generic tax 10% | Base 270.00; tax 27.00; total 297.00 |
| Inclusive amount PKR 110 with generic rate 10% | Base 100.00; tax 10.00; total 110.00 |
| PKR 0.01 document discount across three equal lines | Exactly one line gets the cent by stable remainder ordering; allocated sum 0.01 |
| Invoice total 1,000; cash applied 600; bank applied 200 | Receivable 200; no duplicated payment effect |
| Bill 900; customer tenders 1,000 cash | Applied 900; change 100; cash-book increase 900 |
| Purchase 10 units at 100; sell 3 at 150; no tax | Stock 7/value 700; revenue 450; COGS 300; gross profit 150 |
| Return one of those sold units and restock at original cost | Net sold 2; stock 8/value 800; net revenue 300; COGS 200 |

Rates above are arithmetic examples only. No statutory tax rate is implied.

## Journals and source events

Every posted business event has a balanced journal and one stable source identity. Revenue, cash receipt and inventory cost are distinct facts. An invoice may create revenue without receiving cash. A payment may settle an old receivable without creating revenue.

| Event | Debit | Credit |
| --- | --- | --- |
| Sale invoice | Customer receivable, or walk-in clearing | Sales income plus configured output-tax liability |
| Cash/bank receipt against sale | Selected cash/bank account | Receivable/clearing |
| Inventory sale cost | COGS | Inventory |
| Purchase bill | Inventory or expense; eligible input-tax asset if configured | Supplier payable |
| Payment to supplier | Payable | Selected cash/bank account |
| Paid expense | Expense category account; eligible tax asset if configured | Cash/bank |
| Cash-to-bank transfer | Destination account | Source account |
| Customer advance | Cash/bank | Customer deposit liability |
| Supplier advance | Supplier prepayment asset | Cash/bank |
| Credit note | Sales-return contra income; applicable output-tax reversal | Open receivable or customer credit liability |
| Restock from sale return | Inventory at linked original resolved cost | COGS |
| Refund of customer credit | Customer credit liability | Cash/bank |
| Approved stock shortage | Inventory loss expense | Inventory |

Use a documented clearing/reclassification step when a credit exceeds the remaining receivable; do not create duplicate revenue reversals in the refund. Apply advances/credits through explicit allocation journals. Supplier returns mirror original purchase and payable/prepayment effects with source links. Manual credit amounts cannot exceed permitted remaining source amounts.

The posting API computes complete entries before persistence. Enforce entry balance at commit using a deferred database guard and prevent direct write access outside the posting service. Corrections append linked entries; no direct edits to posted journal lines. Journal, stock, cash projection, command receipt and audit must either all commit or all roll back.

## Stock and cost

Use perpetual moving weighted-average cost per business + location + item, in base units, with server-ingest ordering under row locks. For positive stock receipts, new average = (old inventory value + received value) / (old quantity + received quantity). Sales consume the resolved average and persist cost lineage. Rounding residuals stay tracked and are cleared deterministically when the last valued quantity leaves.

Business date is a reporting date, not a hidden reordering instruction. Backdated purchases do not silently rewrite historical sale costs. An approved revaluation appends a traceable adjustment, subject to open-period policy.

### Negative stock policy

Default proposal: allow ordinary non-serialised quantity deficits so permitted offline sales are not erased. Post provisional cost using last known cost; if none exists, use explicit zero-provisional cost and flag it. Keep outstanding deficit quantities and estimated value separate from normal positive stock valuation. Reports with unresolved deficits must say provisional and enumerate missing cost coverage.

Receipts first settle deficit quantities in deterministic deficit order. For the settled portion, append a cost adjustment equal to actual assigned receipt cost minus the original provisional cost. Remaining positive stock uses its unconsumed receipt value. Do not average a negative denominator or pretend a zero-cost sale has final profit.

Example: one unit sold into deficit at provisional cost 100, then five units received at 120. Before receipt inventory is −100. Receipt adds 600. A linked additional COGS debit 20 / inventory credit 20 resolves the deficit, leaving four units with inventory value 480 and average 120. Partial receipts leave remaining deficits open; returns reference the original cost and any related adjustments.

This subsystem must pass real fixtures in M08 before financial reports are called reconciled. If it is not implemented correctly, block final valuation claims and restrict the pilot instead of hiding the exception. Strict-no-negative businesses use online issue checks; shared stock reservations while disconnected are outside v1.

Services produce no stock movement. Returns restock only quantities physically received into a valid sellable/damaged location; non-restocked returns do not invent inventory. A damaged/lost quantity uses an explicit loss/disposition entry. Warehouse transfers preserve total business cost and use a transit location; no revenue is created.

## Balances, limits and periods

- Derive cash/bank balances from journal lines and reconcile projections. Never store a standalone balance that survives an unrelated “reset data” operation without lineage.
- Derive party receivable, payable, deposits/prepayments and invoice remaining amount separately. The UI may show a net view alongside the separate balances; do not erase customer/supplier direction.
- Lock original document lines, allocations, credit and refund limits during posting. Concurrent partial returns/refunds or payments cannot exceed remaining quantity/amount.
- Opening stock, cash/bank, receivables/payables and equity use an idempotent opening batch with preview and balancing evidence. Opening customer dues link to opening documents so later allocations are traceable.
- A business period may be locked only with explicit owner/accountant permission. Closed-period corrections post into an open period with original business-date metadata and a source reference. The original record remains unchanged.
- Cash sessions have a defined device/cash-account scope, opening float, counted close, server watermark and variance reason. Late offline cash effects are flagged adjustments to reconciliation; never silently rewrite a sealed close.

## Reporting definitions

Net sales = posted sales excluding tax less linked sales credits. Gross profit = net sales − resolved COGS, with explicit provisional amounts. Net operating profit = gross profit − posted operating expenses plus/minus separately classified adjustments. Cash received is not net sales. Transfers and owner capital are not revenue.

Trial balance sums journal debit/credit totals. Balance sheet and P&L derive from classified accounts with a documented as-of period, including current-period profit. Stock quantity/value reconciles to movements and inventory journal, including valuation adjustments. Due/aging reports use remaining document amounts and due dates. Tax summary reports are generic configuration summaries until a jurisdiction module is explicitly implemented and verified.

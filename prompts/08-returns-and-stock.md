# Milestone 08 — Credits, refunds, stock counts and resolved valuation

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M08 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [05-data-model.md](../docs/planning/05-data-model.md)
- [06-business-flows.md](../docs/planning/06-business-flows.md)
- [07-offline-sync.md](../docs/planning/07-offline-sync.md)
- [08-accounting-rules.md](../docs/planning/08-accounting-rules.md)
- [11-testing-and-release.md](../docs/planning/11-testing-and-release.md)

## Work to complete

1. Implement online sale/purchase credit notes linked to original lines with remaining quantity/amount, reasons and disposition. Full cancellation is an eligible full credit/reversal, never hard deletion.
2. Implement refund records and customer/supplier credit/advance application with row locks, permission policy and idempotency. Distinguish reducing unpaid balance, holding credit and actual money refund.
3. Implement online stock counts/approved adjustments with source links, base-unit quantities, reasons and audit. Services do not move stock. Damaged/non-restocked returns must not invent sellable stock.
4. Complete negative-stock deficit settlement: deterministic quantity allocation, original provisional basis, actual receipt cost, linked COGS/inventory adjustments, partial receipts, subsequent returns and rounding residuals.
5. Preserve historical business dates and closed-period rules. Late cost evidence appends approved adjustments; it does not rewrite historical receipt snapshots.
6. Add readable return/refund/stock history screens and clear provisional valuation indicators. Offline return/count/refund is draft-only in v1.

## Acceptance gate

- T14/T15: two concurrent returns/refunds cannot exceed original limits; repeated refund has one money effect and no second revenue reversal.
- Golden purchase/sale/return and negative-stock example reconcile; cover partial receipts, unknown cost, later adjusted return and unit conversion.
- Stock movement total equals quantity projection; inventory journal equals valuation projection including adjustments.
- Posted records cannot be hard-deleted or silently edited; permissions and source lineage survive reload.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M09 reports and reconciliation.

# Milestone 07 — Purchases, expenses, receipts, payments and accounts

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M07 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [02-feature-matrix.md](../docs/planning/02-feature-matrix.md)
- [06-business-flows.md](../docs/planning/06-business-flows.md)
- [07-offline-sync.md](../docs/planning/07-offline-sync.md)
- [08-accounting-rules.md](../docs/planning/08-accounting-rules.md)
- [09-security-permissions.md](../docs/planning/09-security-permissions.md)

## Work to complete

1. Implement purchase bills with supplier reference, cached items, units/costs/tax, paid/payable split and atomic stock/cost/journal effects. Prevent accidental supplier-reference duplicates with an explicit reviewed exception path.
2. Add expense categories and paid expense UI with selected account and optional deferred attachment upload. No hard-coded unchangeable category list.
3. Implement standalone receive/pay, unapplied advances, partial allocations, account transfers and individual cash/bank books. Lock outstanding documents and remaining allocation amounts; do not confuse receipts/transfers with revenue.
4. Reuse embedded sale/purchase payments correctly. An invoice command's payment must not also be uploaded independently.
5. Extend offline command support to cached-item purchase bills with supplier/dependency and authorised cash/unpaid handling, plus simple paid cash expenses. Credit sale, standalone allocation, bank transfer and refund stay online-only per matrix.
6. Provide reloadable party statements and account transaction views. Preserve source links and access-controlled totals. Attachments use private scoped storage and do not block accounting transactions.

## Acceptance gate

- T13 and relevant T16 fixtures: purchase receipt/payable, partial payment, customer/supplier advance, expense, transfer and mixed cash/bank book reconciliation.
- Repeat commands and run concurrent allocations; no double stock, double settlement or excess allocation.
- Offline purchase/expense survives reopen, syncs once and matches canonical accounting. Test dependencies and attachment upload failure without losing the saved transaction.
- Verify cash transfer has zero income/expense effect and restricted users cannot access private account data.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M08 returns, refunds and inventory lifecycle.

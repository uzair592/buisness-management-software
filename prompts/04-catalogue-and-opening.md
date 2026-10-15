# Milestone 04 — Items, parties, accounts and opening balances

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M04 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [02-feature-matrix.md](../docs/planning/02-feature-matrix.md)
- [03-ux-and-screen-map.md](../docs/planning/03-ux-and-screen-map.md)
- [05-data-model.md](../docs/planning/05-data-model.md)
- [08-accounting-rules.md](../docs/planning/08-accounting-rules.md)
- [09-security-permissions.md](../docs/planning/09-security-permissions.md)

## Work to complete

1. Build persisted items/services, categories, base/alternate units, exact conversions, barcodes, default prices/tax profiles and active/archive status. Referenced rows cannot cascade-delete history.
2. Build customer/supplier parties with dual-role support, optional contact data, search and quick-create panels. Use expected-version edits; show a clear conflict when another device has changed the row.
3. Create cash/bank accounts and category-linked expense accounts with role-aware permissions. Account opening balances must go through the opening workflow, not editable standalone totals.
4. Implement previewed/idempotent opening batches for stock, cash/bank, receivables/payables and balancing equity. Opening party dues link to traceable documents for later allocation.
5. Extend permission-filtered bootstrap/pull to catalogue/party/account read models and versions. Define the provisional-party command with dependency ordering for offline sales/purchases; duplicate suggestions never auto-merge.
6. Make list/detail/create/edit/archive UI usable with validation, pagination/search, retained form data and appropriate empty/error/access states.

## Acceptance gate

- Reload after CRUD/archive and verify persistence, version conflict and ownership rules using two businesses.
- Unit-conversion fixtures and barcode uniqueness pass; archived/referenced data remains in snapshots/history.
- Repeating an opening batch creates no duplicate effect; opening stock, money, dues and journal reconcile.
- Cashier bootstrap contains sellable fields only and excludes cost/profit/private-account data.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M05 first online sale.

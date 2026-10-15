# Milestone 05 — Complete online sale, payment and saved receipt

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M05 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [03-ux-and-screen-map.md](../docs/planning/03-ux-and-screen-map.md)
- [06-business-flows.md](../docs/planning/06-business-flows.md)
- [07-offline-sync.md](../docs/planning/07-offline-sync.md)
- [08-accounting-rules.md](../docs/planning/08-accounting-rules.md)
- [11-testing-and-release.md](../docs/planning/11-testing-and-release.md)

## Work to complete

1. Complete the billing workspace with item search/barcode, customer quick-select, large visible cart, exact quantity/unit/price/discount/tax editing and sticky totals. Walk-in cash requires no customer; credit requires a party.
2. Support permitted online cash/bank/credit and split amounts. Distinguish tender, applied payment, change and remaining due. Bank entries record a manual payment reference, not unverified external processing.
3. Persist a draft and stable command/document ID, allocate a device-prefixed number through a shared safe path, then post sale, embedded payment, inventory/COGS, journal, audit and receipt atomically. Record deficit basis explicitly where allowed; final deficit settlement is M08.
4. Implement document list/detail with server filters/pagination, payment/sync/lifecycle badges and a basic print action from the saved snapshot. Preserve item/tax/branding snapshots where needed.
5. Route all writes through the common command dispatcher and update local working state from canonical acceptance. Keep retry IDs stable on timeouts and block duplicate issue during pending submission.
6. Do not add destructive posted-sale delete or calculate shared history from a device-only array.

## Acceptance gate

- Create a real multi-line sale through the UI, reload/open detail/reprint, and reconcile saved totals, journal, stock and payment account.
- Test cash change, bank split, partial credit, no customer walk-in and required-party credit.
- Inject failure and dropped/repeated submit; verify one invoice/number/payment/stock/journal, or no effects on rollback.
- Demonstrate T03–T05; inspect billing at 1366 × 768 with visible cart and totals.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M06 offline and multi-device proof. Do not expand modules before this gate.

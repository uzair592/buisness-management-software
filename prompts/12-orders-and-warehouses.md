# Milestone 12 — Quotations, purchase orders and warehouse transfers

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M12 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [02-feature-matrix.md](../docs/planning/02-feature-matrix.md)
- [05-data-model.md](../docs/planning/05-data-model.md)
- [06-business-flows.md](../docs/planning/06-business-flows.md)
- [08-accounting-rules.md](../docs/planning/08-accounting-rules.md)
- [11-testing-and-release.md](../docs/planning/11-testing-and-release.md)

## Work to complete

1. Implement quotations and purchase orders as non-posting documents with draft/issued/accepted/expired/partly-fulfilled/fulfilled states and saved snapshots.
2. Add locked, idempotent partial conversion into standard sale/purchase commands. Preserve source quantity links; two conversions cannot exceed remaining quantities. Never create journal/stock effects merely by issuing a quote/order.
3. If separate goods receipt is enabled, explicitly distinguish receipt stock from supplier bill liability and prevent duplicate inventory when the bill arrives. Prefer the simpler direct conversion until a complete receipt/bill clearing design exists.
4. Enable additional locations/warehouses with scoped access and online transfer dispatch/receive. Use transit stock, partial receipts, loss/damage reasons and preserved cost; do not invent sales between locations of one business.
5. Add usable lists/details/remaining quantities and stock-transfer histories. Offline actions remain drafts/views according to the matrix, not disconnected shared reservations.

## Acceptance gate

- T24: concurrent partial quote/order conversions respect remaining quantities and create one standard posting per conversion.
- Issue/expire a quote/order and confirm zero journal/stock effects.
- Transfer dispatch, partial receipt, full receipt and approved loss reconcile source/transit/destination quantities and business inventory cost.
- Second-business and restricted-location users cannot access or receive another location's transfer.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M13 controlled pilot and release assessment.

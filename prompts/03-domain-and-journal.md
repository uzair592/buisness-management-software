# Milestone 03 — Exact calculations and atomic posting foundation

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M03 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [04-architecture.md](../docs/planning/04-architecture.md)
- [05-data-model.md](../docs/planning/05-data-model.md)
- [07-offline-sync.md](../docs/planning/07-offline-sync.md)
- [08-accounting-rules.md](../docs/planning/08-accounting-rules.md)
- [11-testing-and-release.md](../docs/planning/11-testing-and-release.md)

## Work to complete

1. Implement pure shared decimal calculation functions: unit conversion, line and document discounts, inclusive/exclusive generic tax, stable remainder allocation, totals, cash tender/change and payment split validation. Persist a calculation version; JSON amounts are strings.
2. Create account/chart classifications, source events, journal entries/lines, stock movement identities, command receipts, business sync-head and change-batch persistence. Define provisional deficit-cost records without claiming settled valuation yet.
3. Implement the common command dispatcher: scope/schema/hash validation, business sync-head lock, idempotency lookup, deterministic affected-row locks, atomic effects/receipt/audit/change batch and bounded retry of transient conflicts.
4. Enforce balanced entries at commit using a deferred DB guard/equivalent, source-effect uniqueness and tenant FKs. Prevent direct journal writes outside posting paths. All business writers must use the same cursor protocol.
5. Add reusable posting/reversal/allocation interfaces and domain transitions without exposing an unreviewed arbitrary journal UI. Keep report projection rebuilds side-effect free.

## Acceptance gate

- Run all arithmetic golden fixtures from the accounting rules plus property/invariant tests for allocation sums and balanced entries.
- Real DB tests prove same-command replay, changed payload conflict, unique effects, intentional mid-transaction failure rollback and unbalanced commit rejection.
- Deliberately interleave business writers to prove cursor order is commit-visible. Use actual transaction delays/locks, not mocked counters.
- T03/T04 foundation passes; no JS Number accounting paths remain.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M04 catalogue and opening balances.

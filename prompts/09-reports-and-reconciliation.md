# Milestone 09 — Authoritative reports and daily cash reconciliation

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M09 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [03-ux-and-screen-map.md](../docs/planning/03-ux-and-screen-map.md)
- [06-business-flows.md](../docs/planning/06-business-flows.md)
- [08-accounting-rules.md](../docs/planning/08-accounting-rules.md)
- [11-testing-and-release.md](../docs/planning/11-testing-and-release.md)

## Work to complete

1. Build server-backed dashboard and reports for sales/purchases, returns, party statements/aging, stock quantity/value/movements, expenses, cash/bank, P&L, trial balance and balance sheet from accepted source/journal data.
2. Add consistent date/location/party filters, pagination, drill-down to documents and export queries using exactly the same filter semantics. Use Asia/Karachi/business time-zone boundaries correctly.
3. Return/report a committed watermark, scope, generated time, valuation exceptions and known stale devices. Company-wide cloud reports may still lack disconnected-device work; state that clearly.
4. Add offline cached report snapshots and a separately labelled local pending preview. Never add local data silently to a canonical total or call partial cache a complete report.
5. Implement cash sessions with opening float, online close watermark, counted amount, variance reason/approval and immutable close evidence. Late offline cash effects create visible late-adjustment reconciliation.
6. Add account/stock/dues reconciliation diagnostics restricted to owner/accountant. Derive balances; do not allow editing a summary to hide mismatch.

## Acceptance gate

- T16/T17/T18: use mixed openings, sales, credit, payments, purchases, taxes, returns, advances, expenses and transfers; reconcile report values independently to source records/journals.
- Trial balance balances; P&L excludes transfers/tax/advances as income; inventory matches cost adjustments; party dues match allocations.
- Filter/export parity, time-zone boundaries, source links, stale-device labels and provisional profit are verified.
- Close then upload a late offline cash bill; original count/watermark persists and late effect is visible.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M10 UX, printing and installation.

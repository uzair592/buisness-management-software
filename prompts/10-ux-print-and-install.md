# Milestone 10 — Polished UX, invoice templates and install/update behaviour

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M10 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [03-ux-and-screen-map.md](../docs/planning/03-ux-and-screen-map.md)
- [07-offline-sync.md](../docs/planning/07-offline-sync.md)
- [11-testing-and-release.md](../docs/planning/11-testing-and-release.md)
- [12-deployment-backup.md](../docs/planning/12-deployment-backup.md)

## Work to complete

1. Audit all implemented screens at 1366 × 768, 1920 × 1080 and 390 × 844. Fix excessive whitespace, unreadable tables, hidden cart, clipped actions, focus order and touch interactions. Retain real server/filter/permission behaviour.
2. Finish A4/80 mm/58 mm templates with readable bold headings, adjustable logo sizes, company/customer data, totals/payment/due, source numbering and a proper reprint path. Print action uses the saved snapshot.
3. Verify long item names, many lines, discounts/tax, bank/cash split, missing optional contacts and page breaks. Scope print CSS so it does not break normal UI. Browser margins, page length and cutter commands must not duplicate blank paper/cuts.
4. Add clear PWA installation/help and mobile owner journeys, sync status and safe update UX. Delay service-worker activation during issue; test queued-command and IndexedDB migration compatibility.
5. Record actual browser/OS/printer/driver combinations tested. If silent print/cutter behaviour requires a local bridge/native shell, document the concrete requirement and separate scope instead of claiming a browser can guarantee it.
6. Complete accessibility, empty/loading/error/offline states and remove obsolete scaffolding or duplicate controls without rewriting working business rules.

## Acceptance gate

- T19/T20 and relevant T06/T10 pass. Attach viewport screenshots and rendered A4/thermal output with long-data cases.
- Saved receipt reprints without a new sale. Offline print uses stored assets/document data. Logo selection is predictable across templates.
- Installation/reopen/update tested on supported real browsers; update while work is pending preserves the queue.
- Physical printer/cutter results are recorded only when actually tested; remaining hardware gate stays explicit.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M11 backup, import and operations.

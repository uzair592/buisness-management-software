# Milestone 06 — Genuine offline cash billing and multi-device convergence

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M06 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [02-feature-matrix.md](../docs/planning/02-feature-matrix.md)
- [04-architecture.md](../docs/planning/04-architecture.md)
- [05-data-model.md](../docs/planning/05-data-model.md)
- [07-offline-sync.md](../docs/planning/07-offline-sync.md)
- [09-security-permissions.md](../docs/planning/09-security-permissions.md)
- [11-testing-and-release.md](../docs/planning/11-testing-and-release.md)

## Work to complete

1. Implement safe service-worker asset caching and reopenable PWA basics. IndexedDB, not the service worker cache, stores permitted working data and transactions.
2. Enable permitted offline cash issue after prior enrolment/bootstrap. Validate lease/scope/policy, then commit immutable invoice, number/counter, provisional effects and outbox together. Print only after local commit.
3. Implement versioned push/pull/bootstrap, dependency ordering, original-result replay, immutable hash conflicts, commit-ordered business cursors, complete change batches and atomic local apply/cursor advancement.
4. Add foreground/startup/reconnect/manual retry with jitter/backoff. Treat background sync and SSE as optional improvements. Use a tab leader to reduce traffic but rely on database/command invariants for correctness.
5. Add queue/status/review UI for saved, retrying, blocked and held issued records. Preserve pending overlays during resnapshot, logout lock, app update, revoked-device handling and expired cursors. Add encrypted recovery export foundation for pending work.
6. Support provisional-party dependencies. Record last-item quantity deficits and provisional basis without erasing legitimate independent sales; completed receipt-based deficit valuation is M08.
7. Test permission-filtered snapshots/pulls, schema/policy version compatibility, epoch mismatch, clock anomalies and current-authority upload handling. Use the exact exception policies in the protocol.

## Acceptance gate

- Run two independent browser contexts against the real API/PostgreSQL: offline sale, ordinary close/reopen, reconnect and convergence with one effect.
- T05–T12 pass, including dropped ACK, simultaneous last-item sales, two-tab counter race, quota/abort, delayed-commit cursor order, interrupted pull and expired-cursor resnapshot.
- Expired lease blocks new offline issue; revocation/epoch/schema conflicts preserve and label old issued work. Inspect local/network data under cashier permissions.
- Show explicit limits: no real-time sharing during total disconnection, no company-wide stock guarantee, and no read-only-cache claim as offline completion.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M07 purchases and money only after the complete M06 gate passes.

# Milestone 13 — Deep enabled-scope review and launch decision

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M13 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [01-product-scope.md](../docs/planning/01-product-scope.md)
- [02-feature-matrix.md](../docs/planning/02-feature-matrix.md)
- [10-delivery-roadmap.md](../docs/planning/10-delivery-roadmap.md)
- [11-testing-and-release.md](../docs/planning/11-testing-and-release.md)
- [12-deployment-backup.md](../docs/planning/12-deployment-backup.md)
- [13-open-decisions-and-risks.md](../docs/planning/13-open-decisions-and-risks.md)

## Work to complete

1. Audit actual current code and enabled scope rather than trusting previous agent summaries. Record release candidate SHA, migrations, dependency/runtime versions, environment and supported device/browser matrix.
2. Run the complete relevant T01–T25 acceptance matrix, using real PostgreSQL and two browser contexts. Reconcile a mixed realistic dataset independently and investigate every mismatch.
3. Review auth/tenant/RLS, export/object access, production config/static exposure, input rendering, rate/proxy limits, secrets, worker failure and recovery. Fix proven defects in scoped commits and rerun affected checks.
4. Execute a controlled pilot with validated openings and independent cash/stock/dues comparison over a complete business day. Exercise outage/reconnect, return/refund, purchase, partial payment, owner mobile access, actual printing and restore.
5. Prepare a concrete launch-readiness report: pass/fail evidence, enabled modules, limitations, unresolved blockers, runbooks, rollback/recovery instructions and proposed release steps.
6. Update PROJECT_STATUS.md from evidence. If physical business/hardware access is missing, finish automated/code review and leave the specific external pilot gate unverified. Do not fabricate it or declare production readiness.
7. Push fixes and report PRs/release candidate. Deployment or merge is performed only if separately authorised by the user.

## Acceptance gate

- Every enabled core workflow has evidence and no unresolved release blocker from the test plan.
- Money, stock, dues and reports reconcile; offline/duplicates/permissions/restore fail safely.
- Actual printer and pilot-day evidence is attached or explicitly listed as a remaining gate.
- Final outcome is an evidence-backed go/no-go for the tested scope, not a vague claim that all tests passed.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

Optional custom features or M14 only when selected. Production deployment requires explicit authority.

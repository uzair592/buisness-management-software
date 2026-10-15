# Milestone 14 — Optional SaaS subscriptions and platform control

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M14 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [01-product-scope.md](../docs/planning/01-product-scope.md)
- [09-security-permissions.md](../docs/planning/09-security-permissions.md)
- [11-testing-and-release.md](../docs/planning/11-testing-and-release.md)
- [12-deployment-backup.md](../docs/planning/12-deployment-backup.md)
- [13-open-decisions-and-risks.md](../docs/planning/13-open-decisions-and-risks.md)

## Work to complete

Run this prompt only after the user selects commercial SaaS. It is not a prerequisite for an owner-operated business app.

1. Confirm the selected commercial model from current instructions and write concrete plan/entitlement rules: business limits, users/devices, trial/renewal/grace/suspension, offline continuity and data export rights. Do not silently reuse arbitrary defaults from other repositories.
2. Build a separate platform-admin role/scope and portal with strong authentication/MFA/recovery and redacted audit. Creating a business must atomically provision owner membership, valid default plan/subscription and required accounts without 500s or demo passwords.
3. Implement one selected billing path (manual invoicing or provider) with server-authoritative entitlements, idempotent checkout/payment handling, webhook receipt/crash recovery where applicable and honest external-provider states.
4. Enforce permitted device/plan limits on new enrolment and relevant commands; define offline lease/grace policy explicitly. Suspension must preserve records, pending recovery evidence and lawful/export access policy; never delete customer data as a billing shortcut.
5. Add credential reset/owner transfer/device management with explicit authority and no direct platform exposure of business financial data by default. Keep tenant business routes isolated from platform routes.
6. Test actual selected provider/manual lifecycle and operational recovery; document pricing/configuration as business decisions, not invented figures.

## Acceptance gate

- Business creation, plan selection, credentials, renewal, grace, suspension/reactivation and device limits work end to end.
- Replay/crash/concurrent billing events produce one entitlement/payment effect; secrets and MFA recovery material are protected.
- Tenant separation, platform/business scope, export rights and pending offline work survive lifecycle changes.
- Re-run affected core release gates. No provider claim without verified integration evidence.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

A separate commercial pilot/release review; do not retroactively call the SaaS layer included in the core launch.

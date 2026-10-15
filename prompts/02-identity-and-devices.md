# Milestone 02 — Username authentication, business scope and device enrolment

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M02 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [04-architecture.md](../docs/planning/04-architecture.md)
- [05-data-model.md](../docs/planning/05-data-model.md)
- [07-offline-sync.md](../docs/planning/07-offline-sync.md)
- [09-security-permissions.md](../docs/planning/09-security-permissions.md)

## Work to complete

1. Implement global username/password sign-in and safe account creation/bootstrap. Email is an optional recovery attribute, not a hidden required login field. Business selection follows successful authentication. No default/demo production user.
2. Create User, Business, Membership, Location, Session, DeviceEnrollment and OfflineLease persistence with tenant-consistent constraints and migrations. Add owner-managed role presets and location/account scope boundaries.
3. Add secure session cookies, rotation/revocation, current-password change verification, rate limits, honest recovery behaviour, CSRF protections as applicable and redacted audit records.
4. Implement device enrol/revoke with a server-issued non-reused numbering prefix and business dataset epoch. Define/sign a bounded offline lease; do not yet claim offline transaction issue.
5. Establish user/business/enrolment/epoch-partitioned IndexedDB, migration framework and a consistent permission-filtered identity bootstrap contract. Catalogue data will extend this in M04. Store no server password/hash or unauthorised financial data locally.
6. Add scoped server transaction/RLS infrastructure using a restricted runtime DB role and transaction-local context. Apply it to queries and jobs, not just selected UI routes. Preserve inaccessible pending work on logout/revocation.

## Acceptance gate

- Prove username payload and successful/failing login, logout, password change and session revocation through UI plus real API.
- Real PostgreSQL tests with two businesses and restricted users verify read/write/reference isolation and reused pooled connection context; test actual runtime RLS role, not an owner/superuser connection.
- Enrol, select business, bootstrap and revoke a device; verify scope/version/epoch binding and unique prefix.
- Inspect network/local storage to confirm session/password secrets and unauthorised fields are absent; T01/T02/T12 foundation passes.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M03 domain and journal. Offline lease issuance alone is not offline billing.

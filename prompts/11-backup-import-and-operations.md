# Milestone 11 — Recovery, portability and production-like operations

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M11 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [05-data-model.md](../docs/planning/05-data-model.md)
- [07-offline-sync.md](../docs/planning/07-offline-sync.md)
- [09-security-permissions.md](../docs/planning/09-security-permissions.md)
- [11-testing-and-release.md](../docs/planning/11-testing-and-release.md)
- [12-deployment-backup.md](../docs/planning/12-deployment-backup.md)

## Work to complete

1. Implement owner-authorised single-business archives with consistent snapshot, versioned manifest, checksums, attachments, journal/control totals and durable command/number registries. Keep operator database backups and device recovery bundles distinct.
2. Complete encrypted local pending-work export and recoverable import/review using a reviewed authenticated encryption format and explicit key recovery UX. Never include passwords/session secrets or treat a CSV as a full backup.
3. Implement isolated restore validation/diff preview. Promotion fences writers, revokes sessions/leases and increments dataset epoch. Old cursors/enrolments/commands cannot auto-post; preserve old pending bundles for explicit reconciliation.
4. Add CSV item/party templates, safe column mapping, dry run/row errors, explicit duplicates and idempotent import batch. Separate opening financial import and reconcile it. Exports prevent spreadsheet formula injection.
5. Add deploy artefacts/runbooks for web/API/worker/PostgreSQL/object storage, config validation, restricted user, locked/checksummed migration runner, health/worker readiness, safe logging and rollback compatibility.
6. Add backup-age/job-failure/sync-lag observability and lost-device/failed-upgrade/stuck-command/restore incident procedures. Verify actual RPO/RTO instead of assuming provider guarantees.

## Acceptance gate

- T21–T23/T25: restore a realistic archive in isolation; verify counts, trial balance, stock, dues, attachments and wrong-key/version failure safety.
- Promote a recovery dataset, then reconnect an old device with pending commands; epoch fencing prevents silent replay and preserves review evidence.
- Repeated import is idempotent; dry run makes zero writes; bad rows fail predictably without corrupting accepted batches.
- Execute fresh production-like deployment and one rehearsed migration recovery/rollback-compatible path. Secrets and public static paths are checked.
- Document measured backup/restore results and distinguish uploaded cloud data from never-synced work.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M12 extended orders/warehouses, or explicitly scope a core-only M13 pilot with M12 disabled.

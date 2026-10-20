# Instructions for coding agents

This is a planning repository for a new business application. Read README.md, PROJECT_STATUS.md, docs/planning/10-delivery-roadmap.md, and prompts/00-agent-contract.md before implementation. Then read the selected milestone prompt and its referenced specifications.

Current product scope (2026-10-20): online browser application. Earlier offline issue/sync clauses are historical safeguards for existing browser-issued records, not instructions to create new offline workflows. Follow the online M06 prompt and preserve legacy recovery evidence.

## Scope and working method

- Implement one selected milestone per branch/PR. Do not interpret the full roadmap as permission to build everything at once.
- The current user instruction overrides this file. Inspect existing code and preserve unrelated changes before editing.
- Planning suggestions are not implemented features. Keep actual completion and evidence in PROJECT_STATUS.md; never mark future features complete from mock screens.
- Use the documented architecture unless repository evidence justifies a recorded design decision. Select supported dependency versions at implementation time and commit the lockfile.
- Build one coherent modular monolith, not microservices. Keep calculations independent of UI, network, and database.
- Do not copy proprietary product assets or code. Implement the described original UI and familiar business workflows.

## Invariants

- Scope every business record, query, relationship, object key, command and report to an authorised business. Verify tenant-consistent composite foreign keys and restricted database role/RLS behaviour with real integration tests.
- Use exact decimal arithmetic for money, quantities and conversions. Do not use JavaScript floating-point values for accounting calculations.
- A posted command atomically commits its receipt, document, journal, stock movement, audit event and sync change batch. Unique constraints plus transaction retries enforce one business effect under repeated delivery.
- All business writers acquire the business sync-head lock before allocating a cursor. Do not use an ordinary sequence as a commit-ordered sync cursor.
- Never overwrite or hard-delete posted financial history. Corrections use linked credits, reversals or adjustments with reasons.
- Never use last-write-wins for invoices, payments, stock or journals.
- Persist local invoice, issued number and outbox together before displaying a saved receipt. Keep network calls outside local database transactions.
- Acknowledged cloud reports and local unsynced previews have explicit source, coverage and valuation status. Do not present a partial device cache as a complete business report.
- Roles determine which data may reach the device. Hiding a cost column does not protect downloaded cost data.
- Offline revocation has an unavoidable delay. Implement the signed lease, supported-actions matrix, quarantine and recovery rules; do not promise instant control of a disconnected device.
- Preserve pending work during logout, upgrades, storage pressure, device revocation and restore. Never silently reset an outbox or replay an old dataset into a restored business.

## Validation and handoff

Run the checks relevant to the changed behaviour and the milestone's acceptance gate. Core money, tenant isolation, concurrency, migration and sync claims require meaningful tests using actual persistence, not mocked success responses. Never claim printer/cutter/mobile hardware testing without that hardware.

Report: commit SHA, changed behaviour, migration impact, commands and results, UI evidence for visible work, remaining blockers, and the next eligible milestone. Push the milestone branch and open a reviewable PR when instructed; do not merge or deploy without user authority. Do not invent test totals or claim production readiness from CI alone.

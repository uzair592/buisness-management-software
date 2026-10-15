# Project status

Last planning update: 2026-10-15.

| Milestone | Status | Evidence |
| --- | --- | --- |
| M00 Product plan and diagrams | Complete | Planning documents, 30 Mermaid sources and staged agent prompts in this repository |
| M01 Foundation | Complete; review pending | Workspace, responsive shell, PostgreSQL readiness and [M01 evidence](docs/evidence/m01/README.md); UI prototype gate only |
| M02 Identity and devices | Not started | — |
| M03 Domain and journal | Not started | — |
| M04 Catalogue and opening balances | Not started | — |
| M05 First sale | Not started | — |
| M06 Offline and two-device sync | Not started | — |
| M07 Purchases and money | Not started | — |
| M08 Returns and inventory lifecycle | Not started | — |
| M09 Reports and reconciliation | Not started | — |
| M10 UX, printing and installation | Not started | — |
| M11 Backup, import and operations | Not started | — |
| M12 Quotes and warehouse workflows | Not started | — |
| M13 Pilot and release | Not started | — |
| M14 Optional commercial platform | Deferred | Requires product decision |

## Next action

Review and merge the M01 PR before starting [Milestone 02](prompts/02-identity-and-devices.md) with the [agent contract](prompts/00-agent-contract.md). Upgrade Prisma 6 to Prisma 7 before introducing the identity schema; Prisma 6 security support ends 19 November 2026. M01 completes only the UI prototype gate, not billing, identity or offline mode.

## M01 implementation and evidence

- Branch: `milestone-01-foundation`, based on fetched `origin/main` at `db9f44a`. No open PR existed when work began; continued the existing uncommitted M01 scaffold and preserved its original contents outside the repository.
- PR and implementation commit: recorded after push in this section.
- Implemented: pnpm TypeScript workspace, React/Tailwind shell and New Sale layout, shared UI/contracts/db packages, Fastify health API, env validation, local PostgreSQL Compose setup and CI. No business data, sample totals, login, invoice issue, browser database or sync is presented as working.
- Validation: fresh staged-tree checkout `pnpm install --frozen-lockfile --prefer-offline` and `pnpm db:generate` passed. `pnpm check` passed lint, typecheck, API/web production builds and 2 API/config smoke tests. Real PostgreSQL readiness/recovery and compiled HTTP API startup passed separately. Browser checks passed at all three required viewports; see [exact commands and screenshots](docs/evidence/m01/README.md).
- Migration/recovery: no business tables or SQL migrations, no browser DB/outbox. Application rollback requires no data reset. Compose uses a persistent volume; preserve it when stopping/reverting.
- Environment limitation: Docker Linux engine unavailable on this Windows host. Compose configuration validation passed; DB behaviour was tested against a real temporary native PostgreSQL 17.7 instance. Container startup remains unverified locally and is configured in CI.
- Release gate: UI prototype only. No hardware, PWA installation, financial integrity, tenant isolation, offline or multi-device acceptance claim. Prisma support deadline and later feature gates remain explicit.

## M00 validation

- All 30 Mermaid source diagrams parsed successfully with Mermaid 11.
- All 259 relative Markdown links resolve; all 30 embedded diagrams match their editable source files exactly.
- All 14 milestone prompts include required reading, concrete work, acceptance gates and handoff instructions.
- Staged `git diff --check` passed. Application tests are not applicable because implementation has not started.

## Milestone evidence format

For each completed milestone add: PR URL, commit SHA, exact check commands and outcomes, migration and rollback/recovery notes, screenshots for UI changes, known limitations, and release gate status. A passing build alone is insufficient evidence of business correctness.

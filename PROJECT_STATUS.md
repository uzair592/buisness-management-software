# Project status

Last planning update: 2026-10-15.

| Milestone | Status | Evidence |
| --- | --- | --- |
| M00 Product plan and diagrams | Complete | Planning documents, 30 Mermaid sources and staged agent prompts in this repository |
| M01 Foundation | Complete; PR #1 merged | Workspace, responsive shell, PostgreSQL readiness and [M01 evidence](docs/evidence/m01/README.md); UI prototype gate only |
| M01 UI refinement | Implemented; CI repair revalidation pending | [Screenshots and original checks](docs/evidence/m01-ui-refinement/README.md); [filter-race repair evidence](docs/evidence/m01-ui-refinement/ci-filter-fix.md); isolated sample interactions only |
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

Review and merge the M01 UI refinement PR before starting [Milestone 02](prompts/02-identity-and-devices.md) with the [agent contract](prompts/00-agent-contract.md). Upgrade Prisma 6 to Prisma 7 before introducing the identity schema; Prisma 6 security support ends 19 November 2026. M01 completes only the UI prototype gate, not billing, identity or offline mode.

## M01 implementation and evidence

- Branch: `milestone-01-foundation`, based on fetched `origin/main` at `db9f44a`. No open PR existed when work began; continued the existing uncommitted M01 scaffold and preserved its original contents outside the repository.
- PR: [#1 — M01 foundation](https://github.com/uzair592/buisness-management-software/pull/1). Tested implementation commit: `36026ece44b105851d594fbbd7f17575aba9519c`; the follow-up documentation commit records this review link.
- Implemented: pnpm TypeScript workspace, React/Tailwind shell and New Sale layout, shared UI/contracts/db packages, Fastify health API, env validation, local PostgreSQL Compose setup and CI. No business data, sample totals, login, invoice issue, browser database or sync is presented as working.
- Validation: fresh staged-tree checkout `pnpm install --frozen-lockfile --prefer-offline` and `pnpm db:generate` passed. `pnpm check` passed lint, typecheck, API/web production builds and 2 API/config smoke tests. Real PostgreSQL readiness/recovery and compiled HTTP API startup passed separately. Browser checks passed at all three required viewports; see [exact commands and screenshots](docs/evidence/m01/README.md).
- Migration/recovery: no business tables or SQL migrations, no browser DB/outbox. Application rollback requires no data reset. Compose uses a persistent volume; preserve it when stopping/reverting.
- Environment limitation: Docker Linux engine unavailable on this Windows host. Compose configuration validation passed; DB behaviour was tested against a real temporary native PostgreSQL 17.7 instance. Container startup remains unverified locally and is configured in CI.
- Release gate: UI prototype only. No hardware, PWA installation, financial integrity, tenant isolation, offline or multi-device acceptance claim. Prisma support deadline and later feature gates remain explicit.

## M01 UI refinement evidence

- Branch: `milestone-01-ui-refinement`, from merged `main` at `7e2eef9c102f8510b4e31b131ce88f16a165d019`. PR #1 remains merged; this is a separate refinement review.
- PR: [#2 — M01 UI refinement](https://github.com/uzair592/buisness-management-software/pull/2). Tested implementation commit: `245dc0778a119d23356b28523417277228e867b9`; the follow-up documentation commit records this review link.
- Changed behaviour: compact cohesive layout, one accessible Preview explanation, explicit isolated sample entry/exit, exact fixture-derived dashboard filtering and transaction details, sample directories, barcode/name item search, editable quantities, line removal, customer selection, sample receipt and confirmed clear-cart. Command search supports Ctrl/Command K, arrows, Enter and Escape. Shared modal focus is contained and restored.
- Validation: `pnpm install --frozen-lockfile` passed. `pnpm check` passed lint, all typechecks, both production builds and 4 API/arithmetic tests. `pnpm test:e2e` passed 7 tests at 1366×768, 1920×1080 and 390×844, including reset/isolation, no posting/storage writes, filtered views, exact totals, keyboard/dialog behaviour, reduced motion and overflow. Real PostgreSQL `pnpm test:db` and `pnpm test:runtime` each passed 1 regression test. [Evidence](docs/evidence/m01-ui-refinement/README.md) includes 13 inspected screenshots and links to the unchanged baseline images.
- Migration/rollback: internal domain workspace package and lockfile link added; no new external dependency, API change, SQL migration, business record, browser database or outbox. Roll back application code without clearing data.
- Limits: fixed public fixtures and memory-only changes, not completed authentication, billing, payments, tax/discount engine, accounting, offline support or sync. No real invoice number is allocated or receipt saved/issued. Chromium viewport emulation only; no physical device, printer or deployment claim. M02 and all later numbered milestones remain unfinished.

## PR #2 CI repair follow-up

- Reviewed commit `2c7f30181ab1c88867a17ba6ee5bb37f1befe485` failed [CI](https://github.com/uzair592/buisness-management-software/actions/runs/38764566377): 6 browser tests passed; the 390×844 sample journey timed out opening S-1045. Install, check, database and runtime stages passed. Earlier local results above are historical, not evidence of CI acceptance.
- Confirmed a stale URL snapshot race with consecutive native filter events in the real production preview. Date/search/status handlers now compose with current browser history. Original ordinary mobile journey and all 3 new filter regression tests pass; reset, details, focus and Back/Forward preserve the intended filters.
- Local validation: `pnpm check` passed (lint/typechecks/builds/4 tests); `pnpm test:e2e` passed **10 tests** across all three target viewports. `pnpm test:db` passed 1 real PostgreSQL test. `pnpm test:runtime` initially returned readiness 503 during concurrent checks and passed 1 test on rerun; precise cause unconfirmed. [Full diagnostics and screenshots](docs/evidence/m01-ui-refinement/ci-filter-fix.md).
- CI now retains failure traces/screenshots, HTML reports and attached browser state/accessibility/console diagnostics. Remote repair validation is pending; this does not yet claim the failed CI gate repaired remotely.
- Same branch and PR #2; no migration, API, storage or future-milestone implementation. M02 remains eligible only after refinement review and merge.

## M00 validation

- All 30 Mermaid source diagrams parsed successfully with Mermaid 11.
- All 259 relative Markdown links resolve; all 30 embedded diagrams match their editable source files exactly.
- All 14 milestone prompts include required reading, concrete work, acceptance gates and handoff instructions.
- Staged `git diff --check` passed. At the M00 planning gate, application tests were not applicable; subsequent implementation evidence is recorded above.

## Milestone evidence format

For each completed milestone add: PR URL, commit SHA, exact check commands and outcomes, migration and rollback/recovery notes, screenshots for UI changes, known limitations, and release gate status. A passing build alone is insufficient evidence of business correctness.

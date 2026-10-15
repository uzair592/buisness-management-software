# Project status

Last planning update: 2026-10-15.

| Milestone | Status | Evidence |
| --- | --- | --- |
| M00 Product plan and diagrams | Complete | Planning documents, 30 Mermaid sources and staged agent prompts in this repository |
| M01 Foundation | Complete; PR #1 merged | Workspace, responsive shell, PostgreSQL readiness and [M01 evidence](docs/evidence/m01/README.md); UI prototype gate only |
| M01 UI refinement | Complete; PR #2 merged | [Screenshots and original checks](docs/evidence/m01-ui-refinement/README.md); [filter-race repair and passing CI](docs/evidence/m01-ui-refinement/ci-filter-fix.md); isolated sample interactions only |
| M02 Identity and devices | Validated; PR review pending | [M02 evidence](docs/evidence/m02/README.md); Prisma 7 prerequisite, global username auth, PostgreSQL RLS under restricted `bms_runtime`, composite FKs, device enrolment/signed leases, partitioned IndexedDB bootstrap |
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

Review and merge the Milestone 02 PR before starting [Milestone 03: Domain and journal](prompts/03-domain-and-journal.md). M02 establishes username authentication, database/API tenant isolation under a restricted role, device enrolment, signed leases, and local IndexedDB partitioning; it does not claim offline billing, accounting journals, or sync replication (scheduled for later milestones).

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
- Repair commit: `33eb6cd96be94efa7647b0648af21da6a0ef8c8e`. Both the [PR run](https://github.com/uzair592/buisness-management-software/actions/runs/38770301679) and [push run](https://github.com/uzair592/buisness-management-software/actions/runs/38770294122) completed successfully. Install, Prisma generation, `pnpm check`, real PostgreSQL database/runtime checks and **10 browser tests** passed on Linux. The expanded evidence artifact uploaded successfully; CI now retains failure traces/screenshots, HTML reports and attached browser state/accessibility/console diagnostics. Final documentation follow-up checks are reported on PR #2.
- PR #2 was reviewed and merged to `main` at `6b46ae297b23a307197ed6379ab126c84bdb89c9`.

## M02 Identity and devices evidence

- Branch: `milestone-02-identity-and-devices`, branched from merged `main` at commit `6b46ae297b23a307197ed6379ab126c84bdb89c9`.
- PR: Pending review and user authorization.
- Prerequisite: Upgraded `@prisma/client` and `prisma` CLI from 6.19.3 to 7.10.0, with `@prisma/adapter-pg` 7.10.0, `pg` 8.23.1, and `@fastify/cookie` 11.0.2. Configured `prisma.config.ts`, added `packages/db/src/generated/` to `.gitignore`, and externalized client drivers in `apps/api/tsup.config.ts`.
- Transient readiness 503 check: investigated during compiled runtime tests; on native PostgreSQL 17, `pnpm test:runtime` consistently passed (1.68s) and the 503 did not recur. Retained note on potential transient port bind latency during rapid port re-use.
- Implemented:
  1. Working Authentication: global username/password login (email optional, never a required login field), safe owner account creation with default business and location, secure server sessions in PostgreSQL, `scrypt` hashing with constant-time verification (`crypto.timingSafeEqual`), SHA-256 session token hashing, Lax SameSite cookie flags, CSRF token verification, per-IP and per-account failed-attempt rate-limiting (429 Too Many Requests), current-password verification for credential changes, single-session and all-other-sessions revocation.
  2. Tenant Isolation & Restricted Runtime Role: Schema migration `20261015000000_init_identity_and_devices` creating tables, composite foreign keys `(business_id, location_id)` and `(business_id, membership_id)`, restricted PostgreSQL role `bms_runtime` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`), and Row Level Security (`FORCE ROW LEVEL SECURITY`) with scoped tenant transactions (`SET LOCAL app.current_business_id`, `SET LOCAL app.current_user_id`). Tested cross-tenant isolation and fail-closed pool non-leakage under the restricted `bms_runtime` role.
  3. Device Security & Signed Leases: sequential non-reusable prefix allocation (`D01`, `D02`, ...) enforced per business via prefix registry; owner-controlled device enrolment and revocation; HMAC-SHA256 signed 72-hour offline lease establishing future offline eligibility (explicitly does not claim offline billing).
  4. Local IndexedDB Partitioning: deterministic partition database per user, business, device enrolment, and dataset epoch (`bms_${userId}_${businessId}_${enrollmentId}_ep${datasetEpoch}`); permitted identity bootstrap downloaded and ingested; strict exclusion of secrets verified; session logout and business switching close active DB instances and clear client cache.
  5. Sample Workspace Isolation: completely client-side in memory; zero `/v1/` network calls during unauthenticated browsing or sample exploration; session hydration gated on `bms_csrf` cookie existence so unauthenticated or sample browsing never triggers `/v1/` calls or console errors.
- Validation:
  - `pnpm check`: passed ESLint 10 (0 errors, 0 warnings), TypeScript strict checks across all 7 workspace packages, production builds (API ESM bundle and Web Vite bundle), and 8 unit tests in `pnpm test`.
  - `pnpm test:db`: passed 3 real PostgreSQL test suites (`tests/db.test.ts`, `tests/db-isolation.test.ts`, `tests/identity-api.test.ts`) using the restricted `bms_runtime` role.
  - `pnpm test:runtime`: passed 1 compiled API startup and HTTP health readiness check against PostgreSQL.
  - `pnpm test:e2e`: passed **12 Playwright tests** across 1366×768, 1920×1080, and 390×844 viewports (covering navigation, sample workspace isolation, filter composition, and M02 settings/registration).
  - Screenshots in `docs/evidence/m02/`: `settings-signin-1366x768.png` and `settings-register-1366x768.png`.
- Migration/rollback: Initial SQL migration `20261015000000_init_identity_and_devices` applied via `prisma migrate deploy`. Rollback requires dropping schema or rolling down migration. No changes made to sample data fixtures.
- Limits: Offline leases establish eligibility only; offline transactions, offline billing, and sync replication are NOT implemented (reserved for M06). No hardware printers/scanners tested without physical hardware.

## M00 validation

- All 30 Mermaid source diagrams parsed successfully with Mermaid 11.
- All 259 relative Markdown links resolve; all 30 embedded diagrams match their editable source files exactly.
- All 14 milestone prompts include required reading, concrete work, acceptance gates and handoff instructions.
- Staged `git diff --check` passed. At the M00 planning gate, application tests were not applicable; subsequent implementation evidence is recorded above.

## Milestone evidence format

For each completed milestone add: PR URL, commit SHA, exact check commands and outcomes, migration and rollback/recovery notes, screenshots for UI changes, known limitations, and release gate status. A passing build alone is insufficient evidence of business correctness.

# Project status

Last planning update: 2026-10-15.

| Milestone | Status | Evidence |
| --- | --- | --- |
| M00 Product plan and diagrams | Complete | Planning documents, 30 Mermaid sources and staged agent prompts in this repository |
| M01 Foundation | Complete; PR #1 merged | Workspace, responsive shell, PostgreSQL readiness and [M01 evidence](docs/evidence/m01/README.md); UI prototype gate only |
| M01 UI refinement | Complete; PR #2 merged | [Screenshots and original checks](docs/evidence/m01-ui-refinement/README.md); [filter-race repair and passing CI](docs/evidence/m01-ui-refinement/ci-filter-fix.md); isolated sample interactions only |
| M02 Identity and devices | Core complete; PR #3 and #4 merged; migration history verification PR review pending | [M02 evidence](docs/evidence/m02/README.md); Prisma 7 prerequisite, global username auth, PostgreSQL RLS under restricted `bms_runtime`, composite FKs, device enrolment/signed leases, partitioned IndexedDB bootstrap, verified upgrade and fresh installation paths; historical checksum mismatch remains for upgraded PR #3 databases |
| M03 Domain and journal | In progress on draft PR #6, stacked on PR #5 | Versioned decimal calculation engine, posting schema/dispatcher and real PostgreSQL acceptance tests; [initial PR CI passed](https://github.com/uzair592/buisness-management-software/actions/runs/39000385837); acceptance review remains |
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

Review the M02 migration history verification PR and finish the stacked [Milestone 03: Domain and journal](prompts/03-domain-and-journal.md) acceptance gates. M02 establishes username authentication, database/API tenant isolation under a restricted role, device enrolment, signed leases, and local IndexedDB partitioning; it does not claim offline billing, accounting journals, or sync replication (scheduled for later milestones).

M03 development is proceeding on [draft PR #6](https://github.com/uzair592/buisness-management-software/pull/6), based on PR #5 while that PR is open. Its initial head passed PostgreSQL posting tests and final CI, but milestone acceptance remains open: earlier M02 business writers do not all use the business cursor protocol, full stock valuation and all accounting fixtures are not covered, and there is no operational sale. The M02 migration history limitation documented below still applies to databases created before PR #4.

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
- PR: [#3 — Milestone 02 identity and devices](https://github.com/uzair592/buisness-management-software/pull/3) (merged at `ee0752fec201544dc07737af9c78882999ff36ff`).
- Prerequisite: Upgraded `@prisma/client` and `prisma` CLI from 6.19.3 to 7.10.0, with `@prisma/adapter-pg` 7.10.0, `pg` 8.23.1, and `@fastify/cookie` 11.0.2. Configured `prisma.config.ts`, added `packages/db/src/generated/` to `.gitignore`, and externalized client drivers in `apps/api/tsup.config.ts`.
- Transient readiness 503 check: investigated during compiled runtime tests; on native PostgreSQL 17, `pnpm test:runtime` consistently passed (1.68s) and the 503 did not recur. Retained note on potential transient port bind latency during rapid port re-use.
- Implemented:
  1. Working Authentication: global username/password login (email optional, never a required login field), safe owner account creation with default business and location, secure server sessions in PostgreSQL, `scrypt` hashing with constant-time verification (`crypto.timingSafeEqual`), SHA-256 session token hashing, Lax SameSite cookie flags, CSRF token verification, per-IP and per-account failed-attempt rate-limiting (429 Too Many Requests), current-password verification for credential changes, single-session and all-other-sessions revocation.
  2. Tenant Isolation & Restricted Runtime Role: Schema migration `20261015000000_init_identity_and_devices` creating tables, composite foreign keys `(business_id, location_id)` and `(business_id, membership_id)`, restricted PostgreSQL role `bms_runtime` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`), and Row Level Security (`FORCE ROW LEVEL SECURITY`) with scoped tenant transactions (`SET LOCAL app.current_business_id`, `SET LOCAL app.current_user_id`). Tested cross-tenant isolation and fail-closed pool non-leakage under the restricted `bms_runtime` role.
  3. Device Security & Signed Leases: sequential non-reusable prefix allocation (`D01`, `D02`, ...) enforced per business via prefix registry; owner-controlled device enrolment and revocation; HMAC-SHA256 signed 72-hour offline lease establishing future offline eligibility (explicitly does not claim offline billing).
  4. Local IndexedDB Partitioning: deterministic partition database per user, business, device enrolment, and dataset epoch (`bms_${userId}_${businessId}_${enrollmentId}_ep${datasetEpoch}`); permitted identity bootstrap downloaded and ingested; strict exclusion of secrets verified; session logout and business switching close active DB instances and clear client cache.
  5. Sample Workspace Isolation: completely client-side in memory; zero `/v1/` network calls during unauthenticated browsing or sample exploration; session hydration gated on `bms_csrf` cookie existence so unauthenticated or sample browsing never triggers `/v1/` calls or console errors.

## M02 Repair: Authentication, Isolation and Provisioning Evidence

- Branch: `fix/m02-auth-and-isolation`, created from latest merged `main` (`ee0752f`). Open PR: [#4](https://github.com/uzair592/buisness-management-software/pull/4).
- Confirmed Findings and Tested Repairs:
  1. **Revoked Membership Access Removal**: `getSessionByToken` now strictly validates that `session.selectedBusinessId` matches an active membership of the user. If membership in that business was removed or revoked, `selectedBusinessId` and `activeMembership` are cleared to `null` and persisted to the database. Tenant requests require an active matching membership (`requireTenantContext`), preventing revoked users from reading locations or managing devices.
  2. **Restricted Runtime Role Operation**: Addressed unscoped membership and session hydration queries under `bms_runtime`. Migrated registration flow so user, business, location, owner membership, prefix registry, and audit event creation run within tenant context (`withTenantContext`) without requiring `bypassRls: true`.
  3. **Real Browser Authentication E2E**: Configured `/v1` and `/health` proxies in `apps/web/vite.config.ts` for both development and production preview. Configured Playwright `webServer` to launch the compiled API against native PostgreSQL. Added full browser E2E test in `tests/e2e/identity-and-devices.spec.ts` testing owner registration, reload persistence, device binding, IndexedDB bootstrap, password change, logout, and login with updated credentials.
  4. **Device, Membership and Location Scope Enforcement**:
     - Verified `ROLE_CAPABILITIES[role].includes("offline:lease")`; non-permitted roles (Viewer) receive 403 on lease requests and `lease: null` in bootstrap responses.
     - Scoped location queries return only assigned location for non-owner members with `membership.locationId`.
     - Deliberate device binding implemented via `bms_device_binding_${businessId}` in `localStorage`.
     - Dynamic server-provided `datasetEpoch` replaces hardcoded epoch 1.
     - Enforced device membership assignment: devices enrolled for a specific member cannot be leased or bootstrapped by other users (`403 Forbidden`). Tested two Cashiers at the same location (Bob and Dave): Dave cannot lease or bootstrap Bob's device.
     - Lease invariants: `/v1/sync/bootstrap` strictly validates that returned or issued leases match the caller's membership, business dataset epoch, and membership permission version. Bumping `datasetEpoch` or `permissionVersion` invalidates old leases and generates new leases with the updated metadata.
     - On authority rejection (401/403) or business switch, UI state and verified bootstrap metadata are cleared and the active local database partition is cleanly closed via `closeActiveLocalDb()`.
  5. **Authentication Throttling & Trusted Proxy Configuration**:
     - `apps/api/src/app.ts` defaults `trustProxy` to safe `false` for direct connections. Proxy trust is allowed only through explicit, validated deployment configuration (`TRUST_PROXY` in `env.ts` and `server.ts`).
     - Added test verifying that under the default setup, rotating `X-Forwarded-For` headers cannot change the effective client IP or evade source throttling (10 failed attempts trigger 429 on the 11th).
     - Enforced account-level rate limits (5 failures) alongside trusted source IP limits (10 failures). Successful login resets only the user's `accountKey` rate-limiting bucket without wiping source abuse tracking.
  6. **Arbitrary Database Name Provisioning & Safe Migration Upgrade Path**:
     - Removed hardcoded `bms` database requirement from migration `20261015000000_init_identity_and_devices/migration.sql` and `packages/db/src/provision.ts`. Connection grant now dynamically uses `current_database()`.
     - Migration 1 creates role `bms_runtime` without a default password; `provision.ts` configures runtime password and enforces non-default secure password in production.
     - Preserves safe upgrade path for existing databases via migration `20261016120000_repair_runtime_provisioning_and_isolation`.
     - Added automated regression test in `tests/db.test.ts` verifying fresh installation on an arbitrarily named database (`bms_arb_*`), testing rejection of default passwords in production mode, provisioning, Prisma migration deploy, and connecting as `bms_runtime` with custom credentials without creating or touching an extra `bms` database.
  7. **Local Cache Initialization & No Guessed Epoch**:
     - In `SettingsPage.tsx`, removed guessed epoch `1` fallback when loading bound device cache. Requires verified bootstrap metadata in local storage (`userId`, `businessId`, `enrollmentId`, numeric `datasetEpoch`) matching the current authenticated user and bound device before opening the scoped partition.
     - Added unit regression test in `tests/local-db.test.ts` verifying partition resolution rejects missing or tampered metadata and never guesses epoch 1.
  8. **Comprehensive Verification**:
     - `pnpm check`: Passed ESLint 10 (0 warnings/errors), strict typechecking across all workspace packages and tests, API & web builds, and 9 unit tests.
     - `pnpm test:db`: Passed 4 real PostgreSQL test suites (`tests/db.test.ts`, `tests/db-isolation.test.ts`, `tests/identity-api.test.ts`) under `bms_runtime` including arbitrary DB provisioning and two-user same-location device isolation.
     - `pnpm test:runtime`: Passed compiled API startup and database readiness test.
     - `pnpm test:e2e`: Passed all 13 Playwright browser tests across 1366×768, 1920×1080, and 390×844 viewports.
- Migration/Provisioning Instructions:
  - Run `pnpm db:provision` to create or update the `bms_runtime` role with dynamic permissions on the active database using `BMS_RUNTIME_PASSWORD`.
  - Run `pnpm db:migrate` (which runs provisioning followed by `prisma migrate deploy`).

## M02 Migration History and Upgrade Verification Evidence

- Branch: `fix/m02-migration-history-repair`, branched from `main` at `cda66ab398f72f43dfbcee273675c61016796636` (post-PR #4 merge).
- Investigation of PR #3 (`ee0752f`) vs PR #4 migration modification:
  - Original M02 migration `20261015000000_init_identity_and_devices/migration.sql` was merged in PR #3 with SHA-256 checksum `d536d3508b09f7209e77eefc23b7648ad998c22716772a12fc14e51c349e668e`.
  - PR #4 modified lines 212 and 219 in place to replace `GRANT CONNECT ON DATABASE bms` with dynamic `EXECUTE format('GRANT CONNECT ON DATABASE %I TO bms_runtime', current_database())` and removed the hardcoded password from `CREATE ROLE bms_runtime`. This changed the file's SHA-256 checksum on disk to `116dbc0db6c72a71b8e662ca2fc861c6fbe08413dfef976d0bf102e113916c18`.
- Path 1 reproduction (Existing database upgrade):
  - Applied original PR #3 migration SQL (from committed fixture `tests/fixtures/pr3_m02_migration.sql`) and seeded `_prisma_migrations` with `d536d3508b09f7209e77eefc23b7648ad998c22716772a12fc14e51c349e668e`.
  - Inserted representative business records across `businesses`, `locations`, `users`, `memberships`, `device_prefix_registry`, `device_enrollments`, and `sessions`.
  - Upgraded using current `main` via `pnpm db:migrate`.
  - **Tooling behavior on upgraded PR #3 database:**
    1. `pnpm db:migrate` / `prisma migrate deploy`:
       - Checks `_prisma_migrations` against the migration folder.
       - Migration 1 (`20261015000000_init_identity_and_devices`) is already marked applied; `migrate deploy` does not re-compute or enforce checksum equality on already applied historical migrations.
       - Safely applies the pending migration 2 (`20261016120000_repair_runtime_provisioning_and_isolation`).
       - Preserves all business records, locations, users, memberships, devices, and sessions completely intact without data loss.
       - Leaves restricted runtime role `bms_runtime` access fully functional under RLS.
    2. `prisma migrate status`:
       - Inspects whether all on-disk migration directories have finished execution rows in `_prisma_migrations`.
       - Exits with code 0 and reports `Database schema is up to date!`.
       - **Important distinction**: `prisma migrate status` checks migration presence and completion status; it does **not** perform checksum validation against on-disk files, and therefore a clean `migrate status` output alone does not prove that historical migration files match their applied checksums.
    3. `prisma migrate dev`:
       - Verifies the SHA-256 checksum of every applied migration file against `_prisma_migrations.checksum`.
       - Detects the checksum discrepancy on migration 1 (`d536...` in DB vs `116d...` on disk).
       - Halts execution and warns:
         `The migration 20261015000000_init_identity_and_devices was modified after it was applied.`
         `We need to reset the "public" schema at "..."`
       - Prompts the operator for an unassisted schema reset, which would delete all operational data if accepted.
- Path 2 reproduction (Fresh database installation):
  - Created an arbitrarily named PostgreSQL database without an extra `bms` database.
  - Verified `provisionDatabase` rejects default passwords in production mode and provisions a secure custom password.
  - Applied all migrations from scratch via `pnpm --filter @business/db exec prisma migrate deploy`. Confirmed all migrations succeed and `bms_runtime` connects and queries tables without requiring an extra `bms` database.
- Migration Strategy & Non-Destructive Invariant:
  - Checksum records in `_prisma_migrations` represent historical evidence of what was applied. Automated scripts must **never** silently rewrite applied migration records. Generic `db:repair-history` tooling was removed.
  - Production and staging deployments run `pnpm db:migrate` (`prisma migrate deploy`), which executes cleanly with zero data loss and requires no manual SQL or migration table modification.
  - Run `pnpm db:verify-history` to compare applied checksums with files on disk without modifying either. It exits nonzero and names every mismatch, including the known PR #3/PR #4 difference; a clean `prisma migrate status` does not replace this check.
  - **Development environments migrated from PR #3:** `prisma migrate dev` will request a schema reset because the historical file changed in PR #4. Do not accept that reset on a database with valuable data and do not change `_prisma_migrations` to hide the difference. Keep the database for application/testing with `prisma migrate deploy`; author new migrations against a fresh disposable database created from the current migration files. Retain a backup of any valuable local data before changing development databases. The historical checksum discrepancy remains an open tooling limitation until a reviewed migration-baseline strategy is implemented.
- Automated Repeatable Tests in `tests/db.test.ts`:
  - `existing database upgrade path: PR #3 original migration, representative data, migration deploy, and migration tooling verification`: tests the complete journey on an existing PR #3 database, confirms data preservation, verifies `_prisma_migrations.checksum` remains historically unaltered, validates `prisma migrate status` output, confirms read-only verification reports the mismatch, and confirms `prisma migrate dev` detects it.
  - `fresh installation on arbitrarily named PostgreSQL database with custom runtime password`: verifies fresh arbitrary database provisioning, default password rejection, migration deploy without an extra `bms` database, and matching migration history.
- Full verification gate results:
  - `pnpm check`: Passed (ESLint 10 with 0 warnings, TypeScript strict checking across contracts/db/domain/ui/api/web, API tsup build, Web Vite build, and 9 domain/decimal/local-db unit tests).
  - `pnpm test:db`: Passed 5 real PostgreSQL test suites (`tests/db.test.ts`, `tests/db-isolation.test.ts`, `tests/identity-api.test.ts`).
  - `pnpm test:runtime`: Passed compiled API server startup and DB readiness test.
  - `pnpm test:e2e`: Passed all 13 Playwright browser E2E tests across 1366×768, 1920×1080, and 390×844 viewports.

## M00 validation

- All 30 Mermaid source diagrams parsed successfully with Mermaid 11.
- All 259 relative Markdown links resolve; all 30 embedded diagrams match their editable source files exactly.
- All 14 milestone prompts include required reading, concrete work, acceptance gates and handoff instructions.
- Staged `git diff --check` passed. At the M00 planning gate, application tests were not applicable; subsequent implementation evidence is recorded above.

## Milestone evidence format

For each completed milestone add: PR URL, commit SHA, exact check commands and outcomes, migration and rollback/recovery notes, screenshots for UI changes, known limitations, and release gate status. A passing build alone is insufficient evidence of business correctness.

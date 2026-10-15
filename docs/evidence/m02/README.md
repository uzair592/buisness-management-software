# M02 Identity and devices evidence

Validated on 15 October 2026, Windows, Node 22.20.0, pnpm 10.28.2.
Branch: `milestone-02-identity-and-devices`. Review identity and commits are recorded in
[project status](../../PROJECT_STATUS.md).

## Commands and observed results

| Command | Result |
| --- | --- |
| `pnpm install` | Locked dependencies updated: Prisma upgraded to 7.10.0, `@prisma/adapter-pg` 7.10.0, `pg` 8.23.1, `@fastify/cookie` 11.0.2 |
| `pnpm db:generate` | Passed: Prisma 7.10.0 client generated to `packages/db/src/generated/prisma` |
| `pnpm db:migrate` | Passed: Applied migration `20261015000000_init_identity_and_devices` (created tables, composite FKs, restricted `bms_runtime` role, RLS policies) |
| `pnpm lint` | Passed: ESLint 10 with 0 errors and 0 warnings |
| `pnpm typecheck` | Passed: TypeScript strict checks across all 7 workspace packages |
| `pnpm build` | Passed: Packages contracts, db, domain, ui, apps api (tsup ESM bundle) and web (Vite production bundle) |
| `pnpm test` | Passed: 8 unit tests in `tests/api.test.ts`, `tests/decimal.test.ts`, `tests/local-db.test.ts` (IndexedDB partitioning & confidentiality) |
| `pnpm test:db` | Passed: 3 real PostgreSQL test suites (`tests/db.test.ts`, `tests/db-isolation.test.ts`, `tests/identity-api.test.ts`) under restricted `bms_runtime` role |
| `pnpm test:runtime` | Passed: 1 compiled API startup + real HTTP liveness/readiness test against PostgreSQL |
| `pnpm test:e2e` | Passed: 12 Playwright tests across 1366×768, 1920×1080, and 390×844 viewports |

## Architectural implementations

### 1. Prisma 7 upgrade prerequisite
Upgraded `@prisma/client` and `prisma` CLI from 6.19.3 to 7.10.0 in `@business/db`. Configured `prisma.config.ts` with explicit output to `packages/db/src/generated/prisma` and driver adapter `@prisma/adapter-pg` with connection pooling. Added `packages/db/src/generated/` to `.gitignore`. Externalized `@prisma/client`, `@prisma/adapter-pg`, and `pg` in API bundle configuration.

### 2. Tenant isolation, composite foreign keys, and restricted runtime role
- Created tables: `users`, `businesses`, `locations`, `memberships`, `sessions`, `device_enrollments`, `device_prefix_registry`, `offline_leases`, `audit_events`.
- Composite foreign keys enforced: `(business_id, location_id)`, `(business_id, membership_id)` to prevent cross-tenant referencing at the schema level.
- Created restricted PostgreSQL runtime role `bms_runtime` with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`.
- Enabled and forced Row Level Security (`FORCE ROW LEVEL SECURITY`) on all tenant tables (`businesses`, `locations`, `memberships`, `device_enrollments`, `device_prefix_registry`, `offline_leases`, `audit_events`).
- Scoped tenant execution via `withTenantContext`: sets `SET LOCAL app.current_business_id` and `SET LOCAL app.current_user_id` inside database transactions.
- Integration tests in `tests/db-isolation.test.ts` connect as the non-superuser `bms_runtime` role and verify:
  1. Tenant isolation across two businesses (reads and writes across boundaries rejected by RLS).
  2. Fail-closed behaviour under connection pool reuse (queries without tenant context return zero rows).
  3. Composite foreign key rejection of cross-tenant relationships.
  4. Non-reuse of device numbering prefixes (`D01`) within a business.

### 3. Username authentication and security
- Global username/password login: email is optional and never a required login field.
- Password hashing: `scrypt` hashing with unique salt and constant-time verification (`crypto.timingSafeEqual`).
- Server sessions: persisted in PostgreSQL with SHA-256 token hashing, Lax SameSite cookie flags, and CSRF token verification.
- Security controls:
  - Per-IP and per-account failed attempt rate limiting (5 failed attempts trigger 429 Too Many Requests).
  - Current-password verification required for credential updates.
  - Granular session revocation (individual session revocation and revoke-all-other-sessions option).
  - Explicit audit event recording for owner account creation, credential changes, and device revocation.

### 4. Device enrolment and signed offline lease
- Owner-controlled device enrolment with unique non-reusable prefix allocation (`D01`, `D02`, ...).
- HMAC-SHA256 signed 72-hour offline lease establishing future offline eligibility (explicitly does not claim offline billing).
- Enrolment revocation immediately invalidates future lease issuance and marks offline authority revoked.

### 5. Local IndexedDB partitioning and confidentiality
- Local storage partitioned via Dexie with deterministic naming: `bms_${userId}_${businessId}_${enrollmentId}_ep${datasetEpoch}`.
- Permitted identity bootstrap downloaded and ingested (`business`, `membership`, `rolePermissions`, `permittedLocations`, `device`, `lease`, `syncState`).
- Strict confidentiality: automated scans verify zero server passwords, password hashes, or session tokens exist in IndexedDB tables.
- Isolation: user B partition cannot access user A cached records; logout and business switching close active DB instances and clear client cache.

### 6. Sample workspace separation
- Sample workspace remains entirely client-side in-memory simulation.
- Session hydration is gated on `bms_csrf` cookie existence so unauthenticated page loads and sample workspace exploration make zero network requests to `/v1/`, preventing any interference with sample workspace isolation.

## Visible results

Screenshots captured from Playwright during automated E2E runs:

- `settings-signin-1366x768.png`: Sign In tab with global username/password credentials and clear navigation to owner registration.
- `settings-register-1366x768.png`: Owner Account Creation tab with business name, currency selection, optional recovery email explanation, and zero leakage.

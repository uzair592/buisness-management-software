# Foundation development

M01 provides a UI prototype and health API only. Login, business data, billing,
IndexedDB, offline issue and sync are not implemented. No seeded business or demo
account is created. Operational figures use a dash. An explicit, isolated
[sample workspace](m01-ui-refinement.md) provides fictional records for exploring
the UI; its changes reset on exit or reload.

## Fresh checkout

Use Node 24 LTS (Node 22.13+ also supported), pnpm 10.28.2, and Docker Compose v2.
Install pnpm with `npm install --global pnpm@10.28.2` if needed.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait
pnpm db:generate
pnpm dev
```

On PowerShell use `Copy-Item .env.example .env` instead of `cp`.
Open http://127.0.0.1:5173; the API listens on 127.0.0.1:3001.
`pnpm dev` starts both workspace processes. Ctrl+C stops them.

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

Stop `pnpm dev` before browser tests: they start the production preview on port
5173 and fail if that port is occupied. Run `pnpm build` before testing changed UI.

For DB validation set `DATABASE_URL` in your shell, then run `pnpm test:db`:

```powershell
$env:DATABASE_URL = 'postgresql://bms_local:bms_local@127.0.0.1:5432/bms'
pnpm test:db
pnpm test:runtime
```

The DB test runs real PostgreSQL queries, switches to an unreachable endpoint,
then verifies recovery. It creates no tables or business data. Tenant isolation,
migrations and financial persistence are later gates.

`pnpm test:runtime` starts the compiled API with the real PostgreSQL URL and checks
both endpoints over HTTP. Run `pnpm build` first. The API bundle keeps Prisma
external so the generated client can locate its native query engine.

`GET /health/live` returns 200 while the API runs. `GET /health/ready` executes
`SELECT 1`: 200 when PostgreSQL answers, 503 when unavailable. Database
connection/pool/socket timeouts bound readiness failure. Responses omit connection
details. Neither endpoint contains business information.

## Source responsibilities and version choices

| Source | Responsibility |
| --- | --- |
| `apps/web` | React screens, navigation, Tailwind layout and visual tokens |
| `apps/api` | One Fastify API, validated environment and health endpoints |
| `packages/ui` | Form fields, buttons, semantic tables, badges and panels |
| `packages/contracts` | Shared Zod response schemas and inferred types |
| `packages/db` | Prisma client factory and reviewed schema source |
| `packages/domain` | Exact decimal amount and quantity helpers used by the sample UI |
| `tests` | API smoke, real PostgreSQL readiness, responsive browser checks |

React 19, Vite 7 and Fastify 5 run on the supported Node LTS baseline. Tailwind 3.4
retains the existing scaffold's token configuration. Prisma 6.19 retains the
generated client/datasource URL interface without introducing an adapter change
in this foundation. [Prisma 6 security support](https://www.prisma.io/docs/orm/release-status)
ends on 19 November 2026; upgrade the foundation to Prisma 7 before introducing
the M02 identity schema, or earlier if that date is reached. pnpm locks resolved
versions in a single lockfile. The domain package contains narrow exact amount
helpers; the production tax/discount/posting engine remains M03. No empty worker
is created.

References: [Node release schedule](https://github.com/nodejs/Release#release-schedule),
[Vite requirements](https://vite.dev/guide/), and
[Fastify LTS policy](https://fastify.dev/docs/latest/Reference/LTS/).

## Configuration and compatibility

Only the API reads `.env`. `DATABASE_URL` must be PostgreSQL; `PORT` is 1–65535;
`NODE_ENV` is development, test or production. Validation errors identify fields
without printing secrets. `HOST` defaults to loopback. Production refuses the
documented local credentials and demo mode. No reset or seeding endpoint exists.

Compose credentials are public development defaults, bound to loopback only. Use
separate credentials and appropriate TLS for a hosted DB. The named volume
survives `docker compose down`; never use `down -v` when preserving work.
Stop with `docker compose stop`; resume with `up -d --wait`.

M01 introduces **no database migration or business tables**. There is no browser
database or outbox to migrate. Rollback means reverting application code, without
clearing PostgreSQL or browser storage.

`pnpm build` produces `apps/web/dist` and `apps/api/dist`. After build,
`pnpm --filter @business/api start` starts the compiled API. Static preview:
`pnpm --filter @business/web exec vite preview --host 127.0.0.1`.
Static hosting must fall back to `index.html` for client routes. Deployment,
authentication, HTTPS and service workers remain outside this milestone.

## Browser evidence

`pnpm test:e2e` uses the production web build and navigates every area at 1366×768, 1920×1080 and 390×844,
checks horizontal overflow, disabled issue, item-search entry focus, desktop
collapse, and mobile dialog Escape/focus restoration. Screenshots go to
`docs/evidence/m01-ui-refinement`; original M01 screenshots are preserved under
`docs/evidence/m01`. Tests also cover sample entry/exit and isolation, dashboard
filters, directories, cart totals, receipt and confirmation dialogs, and command
navigation. Native modal dialogs contain focus and restore their opener. No
hardware printing or installability claim is made.

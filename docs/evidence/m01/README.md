# M01 foundation evidence

Validated on 15 October 2026, Windows, Node 22.20.0, pnpm 10.28.2.
Branch: `milestone-01-foundation`. Review identity and commits are recorded in
[project status](../../../PROJECT_STATUS.md).

## Commands and observed results

| Command | Result |
| --- | --- |
| `git fetch origin --prune` | Fetched `main` at `db9f44a`; no remote implementation branch |
| GitHub connector open PR search | No open PR; continued existing local M01 branch |
| `pnpm install` | Passed after repairing an overlapping-install lock conflict; final versions locked |
| `pnpm install --frozen-lockfile --prefer-offline` | Passed in a fresh staged-tree checkout without node_modules or .env; 328 packages, 35.2 seconds |
| `pnpm db:generate` | Passed in that clean checkout; Prisma 6.19.3 client generated without models |
| `pnpm check` | Passed: ESLint 10, TypeScript checks including tests, both production builds, 2 API/config tests |
| `pnpm exec playwright install chromium` | Installed Chromium and headless shell successfully |
| `pnpm test:e2e` | 3 viewport tests passed against the production preview |
| `pnpm test:db` | 1 real PostgreSQL readiness/unreachable-endpoint/recovery test passed |
| `pnpm test:runtime` | 1 compiled API startup + real HTTP liveness/readiness test passed |
| `docker compose config --quiet` | Passed |
| `docker compose up -d --wait` | Could not connect: Docker Desktop Linux engine pipe unavailable |
| `git diff --cached --check` | Passed before commit |

The fresh checkout was exported using `git checkout-index --all --prefix=...`
to a new temporary directory. No private environment files were copied. Dependency
downloads were reused from pnpm's store, not from a previous node_modules tree.

Real DB checks used temporary native PostgreSQL **17.7**, installed outside the
repository from `@embedded-postgres/windows-x64@17.7.0-beta.15`. A new cluster was
initialized with `initdb -U bms_local -A trust --encoding=UTF8 --locale=C` and
started on loopback port 55432. The test environment was:

```powershell
$env:DATABASE_URL = 'postgresql://bms_local@127.0.0.1:55432/postgres?connect_timeout=2'
pnpm test:db
pnpm test:runtime
```

With Docker available, the documented Compose setup and `.env.example` URL can
run the same tests. No database tables, migrations, seed records or account
credentials are installed by this milestone. CI uses PostgreSQL 17 and Node 24;
local results do not assert that an unobserved CI run passed.

The compiled-runtime check caught Prisma being bundled incorrectly and was
fixed by keeping it external with a declared API runtime dependency. The first
development-server browser run exceeded its 30-second cold-start budget at
1366×768. Final checks use the built production preview and a 120-second test
budget; there is no random wait or mocked application response. Screenshot review
also found and fixed the mobile summary covering the cart.

## Visible results

Each image is captured at the named viewport, with CSS transitions completed.
All navigation areas are reachable. New Sale focuses item search, shows a cart
and disabled checkout, and displays no fabricated amounts. Mobile customer and
payment details expand; cart text stays above the compact sticky summary. Browser
checks cover dialog Escape/focus restoration, desktop collapse and horizontal
overflow. All six images were visually inspected.

| Viewport | Home | New Sale |
| --- | --- | --- |
| 1366×768 | [Screenshot](home-1366x768.png) | [Screenshot](sale-1366x768.png) |
| 1920×1080 | [Screenshot](home-1920x1080.png) | [Screenshot](sale-1920x1080.png) |
| 390×844 | [Screenshot](home-390x844.png) | [Screenshot](sale-390x844.png) |

## Limits and recovery

The M01 UI prototype gate is complete. Business login, tenant records, real
billing, accounting, local persistence, offline transactions and sync remain later
milestones. No printer/cutter/mobile hardware or installation testing occurred.
Browser mobile emulation is not a physical-device test.

No migration or local-store compatibility change exists. Reverting the code does
not require clearing a database or browser storage. Preserve the Compose volume.
Prisma 6 receives security updates only until 19 November 2026: upgrade to Prisma
7 before M02 adds the identity schema. Next prompt after review/merge:
[02-identity-and-devices.md](../../../prompts/02-identity-and-devices.md).

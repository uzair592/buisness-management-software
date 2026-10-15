# M01 UI refinement

This refinement follows merged PR #1. It remains the M01 UI prototype gate;
M02 identity, M03 posting calculations, M05 billing and M06 offline sync are
unfinished. The user's refinement request explicitly authorizes an interactive
sample workspace; it does not authorize operational posting or persistence.

## Boundary and source responsibilities

- `apps/web/src/preview/fixtures.ts`: fixed public sample items, parties and
  historical transactions, anchored to 15 October 2026. No real customer data.
- `PreviewProvider.tsx`: explicit, memory-only entry/exit, cart and customer state.
  Operational mode is the default. Exit clears the cart/customer; reload returns
  to operational mode. Each tab has independent React state. There is no API,
  localStorage, IndexedDB or outbox dependency in the provider.
- Dashboard, records, directories and billing use the existing shared panels,
  controls and table components. Sample records are read only. A sample receipt
  displays the current cart; it does not append a transaction, allocate a number,
  accept a payment, create a journal or imply a saved receipt.
- `packages/domain`: reusable BigInt decimal helpers for currency scale 2,
  quantity scale 6, line-level ROUND_HALF_UP and exact sums/remaining amounts.
  Decimal strings stay exact during formatting. This narrow arithmetic utility
  is not the versioned M03 tax/discount, allocation or accounting engine.
- Shared dialogs use native modal containment, explicit initial focus and opener
  restoration. The command palette exposes routes and sample entry/exit with
  Ctrl/Command K, arrow keys, Enter and Escape.

The visible sample strip says **Sample data — changes reset** and always offers
an exit. The single Preview control explains available functionality. Detailed
milestone information stays in documentation. Advanced routes state their
availability concisely. Operational posting remains disabled.

## Sample interpretation

Date filters select the fixed sample day, the seven days ending on that date, or
all fixture dates. Sales sum selected sale lines; receivables and payables sum
the unpaid portions of the selected sales and purchases. Stock is a separate
fixed snapshot and is labelled with its date. No sample amount is an operational
business result or authoritative accounting report.

Item quantities must be positive plain decimals with at most six fractional
digits. Invalid edits remain visible and block receipt preview. Sample prices
have two decimals; tax and discounts are explicitly not applied. Receipt totals
use the same exact helper as the cart.

On mobile, customer details expand, cart lines become readable cards, and the
summary follows the cart in normal flow. It does not cover content. Desktop
keeps cart and sticky totals side by side at 1366×768.

## Setup, compatibility and remaining work

Use the existing [development setup](development.md). `pnpm install` links the
new internal domain package; no external dependency was added. The lockfile is
updated. Run `pnpm check`, then `pnpm test:e2e` against the production build.

There are no API, database schema, migration, browser-store or outbox changes.
Rollback is an application-code revert without a data reset. Nothing is deployed.
Authentication, business persistence, tax rules, payments, offline behaviour and
physical hardware remain outside this refinement. The Prisma support deadline
recorded in project status still applies before M02.

See the [refinement evidence](evidence/m01-ui-refinement/README.md) for exact
results and before/after screenshots.

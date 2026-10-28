# M07 purchases and money evidence

Validated on 28 October 2026, Windows, Node 22, pnpm 10.
Branch: `milestone-07-purchases-and-bills`. Review identity and commits are recorded in
[project status](../../../PROJECT_STATUS.md).

## Increment 2: Purchase Bills and Inward Inventory Receipts

This increment implements operational purchase bills with supplier references, unit conversions, live tax calculations, split payment/due tracking, atomic stock receipts with moving weighted-average valuation, balanced double-entry accounting journals, and duplicate supplier invoice protection with an explicit reviewed override path.

### Key capabilities verified

1. **Additive Schema & Security Isolation**:
   - Migration `20261021000000_m07_purchase_documents` adds `purchase_sequence` integer counter to `businesses`, and creates `purchase_documents`, `purchase_lines`, and `purchase_payments` tables.
   - Enforces composite tenant foreign keys `(business_id, ...)`, Row Level Security (RLS) enabled and forced with `tenant_scope` policies, and restricted role `bms_runtime` grants (`SELECT, INSERT, UPDATE` on documents; `SELECT, INSERT` on lines/payments).
2. **Draft & Idempotent Post Protocol**:
   - `POST /v1/purchases/drafts` accepts structured purchase input with exact decimal quantities, costs, discounts, and payments. Idempotent on identical draft ID/payload; rejects collisions with altered content.
   - `POST /v1/purchases/:id/post` validates server items, units, conversions, and tax profiles; calculates exact document totals via `calculateDocument`; enforces cash/bank payment limits; creates atomic inward stock receipts with moving weighted-average cost updates; balances double-entry journals (Debit Inventory + Tax, Credit Accounts Payable; Debit Accounts Payable, Credit Cash/Bank); assigns sequential document numbers (`PB-XXXXXX`).
3. **Accidental Duplicate Reference Protection**:
   - Detects previously recorded supplier invoice references within the tenant business and returns a 409 conflict.
   - Provides an explicit `allowDuplicateSupplierReference: true` override path when the operator reviews and confirms the bill.
4. **Clean, Accessible User Experience**:
   - Paged purchase directory with status filters (Posted, Draft), search by bill number, supplier or supplier invoice ref, and snapshot print modal.
   - Interactive purchase entry screen with supplier and receiving location selectors, item search dropdown, unit conversions, unit costs, discounts, split payment controls, duplicate warning banner, draft saving, and instant posting.

## Commands and observed results

| Command | Result |
| --- | --- |
| `pnpm check` | **Passed**: ESLint 0 errors/warnings, TypeScript check across 7 workspace projects, API/Web production builds, and 26 unit tests |
| `pnpm test:runtime` | **Passed**: Compiled server starts and serves real database readiness |
| `pnpm test:db` | **Passed**: All 11 PostgreSQL integration tests passed, including `tests/purchase-db.test.ts` (draft idempotency, posting number sequence, inward stock, moving average update, balanced journal, duplicate ref conflict and reviewed override, tenant isolation) |
| `pnpm test:e2e` | **Passed**: All 21 Playwright browser tests passed against the production preview, including `tests/e2e/purchase.spec.ts` (bill creation, item search, quantity/cost entry, partial cash payment, posting to `PB-000001`, remaining payable verification, and details inspection) |

## Screenshots

- 1366 × 768 purchase bill and details inspection: [purchase-bill-1366.png](purchase-bill-1366.png)

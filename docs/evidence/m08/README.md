# Milestone 08 Evidence: Returns, Credit Notes, Stock Adjustments, and Resolved Valuation

This directory contains verification evidence for Milestone 08 implemented on branch `milestone-08-returns-and-stock`.

## Scope Summary

1. **Customer Returns & Credit Notes (`CN-xxxxxx`)**:
   - Return lines linked to original sales invoice lines.
   - Line-level disposition: `Restocked` (restores inventory at original resolved moving cost, balanced against COGS) vs `Damaged / Scrapped` (no stock restored).
   - Journal effects: reverses revenue (`SALE_REVENUE` / `SALE_RETURN`) and tax (`SALE_TAX`).
   - Flexible settlement options:
     - Reduces open invoice due (derived dynamically from `credit_notes.allocated_credit` preserving `paid + due = total`).
     - Issues holding customer credit liability.
     - Issues direct cash/bank refund via linked `credit_note_refunds` records.
   - T14/T15 concurrency protection: rejects returns exceeding remaining unreturned quantities with HTTP 409 `ReturnConflict`.

2. **Supplier Returns & Debit Notes (`DN-xxxxxx`)**:
   - Reverses purchase bill line quantities and input tax.
   - Credits inventory asset and debits accounts payable.
   - Outward stock movement recorded atomically.

3. **Online Stock Counts & Approved Adjustments**:
   - Kinds supported: `CountVariance`, `Damage`, `Loss`, `Surplus`, `Correction`.
   - Balanced journals: debits loss expense (`INVENTORY_LOSS` / `SALE_COGS`) and credits inventory asset (for shortages/losses) or vice versa (for surpluses).
   - Invariant: Services reject stock adjustments; goods only.

4. **Negative Stock Deficit Settlement**:
   - Deterministic FIFO reconciliation of historical open `provisional_deficit_costs` against subsequent inward receipts.
   - Generates COGS cost variance adjustment journals without mutating historical posted records.

5. **Frontend UI**:
   - `/returns` -> `<ReturnsPage />`: returns history list, interactive return creator with original document lookup, line selector, and settlement allocator.
   - `/stock/adjustments` -> `<StockAdjustmentsPage />`: adjustments history list, physical count / variance adjustment form, and open provisional deficits viewer.

---

## Verification Results

### 1. Project Gate Check (`pnpm check`)
- ESLint: 0 warnings, 0 errors.
- Strict TypeScript: Passed on all 7 workspace packages (`@business/contracts`, `@business/db`, `@business/domain`, `@business/ui`, `@business/api`, `@business/web`).
- Production builds: `@business/api` and `@business/web` built successfully.
- Unit tests: 29/29 passing (including `tests/returns-domain.test.ts`).

### 2. Database Integration Tests (`pnpm test:db`)
- 12/12 database test suites passed under real PostgreSQL schema with Row-Level Security (RLS) and restricted `bms_runtime` role:
  - `tests/returns-db.test.ts`:
    - Customer return (Credit Note `CN-000001`) with restock, journal balancing, remaining limit calculations.
    - Concurrency / limit check: returning beyond remaining quantity fails closed with 409 `ReturnConflict`.
    - Non-restocked (damaged) return: zero sellable stock restored, records refund in `credit_note_refunds`.
    - Supplier return (Debit Note `DN-000001`): reverses payable and inventory, outward stock movement.
    - Stock count shortage adjustment (`Damage`): debits loss expense, credits inventory, outward stock movement.
    - Service item stock adjustment rejection.
    - Deficit cost settlement: calculates cost difference journal (`Debit COGS, Credit Inventory`).
    - Tenant isolation: Business B cannot read Business A's credit notes or debit notes.

### 3. Browser End-to-End Test (`pnpm exec playwright test tests/e2e/returns.spec.ts`)
- `tests/e2e/returns.spec.ts` passed:
  - Owner registers and logs in with live tenant session.
  - Posts opening stock and creates sale invoice.
  - Visits `/returns`, fetches invoice, enters return quantity of 2 with `Restocked` disposition, allocates credit to unpaid due, and successfully posts Credit Note `CN-000001`.
  - Visits `/stock/adjustments`, enters count damage adjustment of `-1` unit at `60.00` unit cost, posts adjustment, and verifies adjustment record in history table.

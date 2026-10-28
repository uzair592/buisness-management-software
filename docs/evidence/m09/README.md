# Milestone 09 Evidence: Authoritative Double-Entry Financial Statements, Stock Valuation & Cash Register Reconciliation

This directory contains verification evidence for Milestone 09 implemented on branch `milestone-09-reports-and-reconciliation`.

## Scope Summary

1. **Authoritative Server-Backed Financial Statements (`apps/api/src/reports.ts`)**:
   - Strictly derived from immutable posted double-entry journal lines, stock movements, and source documents with exact decimal arithmetic (zero floating-point math).
   - **Profit & Loss Statement (Income Statement)**:
     - Operating Revenue: Gross sales revenue minus sales returns contra-revenue.
     - Cost of Goods Sold (COGS): Standard invoice FIFO/moving average COGS, provisional deficit settlements, minus restock cost reversals.
     - Gross Profit & Margin Percentage: Exact margin percentage calculation.
     - Categorized Operating Expenses: Detailed breakdown by expense heads and total operating expenditures.
     - Net Operating Profit: Net income after all operating expenditures.
     - Coverage Indicator: Audits provisional inventory state and unresolved deficits.
   - **Double-Entry Balance Sheet & Trial Balance**:
     - Assets: Cash & Bank Liquid Funds, Trade Accounts Receivable, Inventory Valuation, Input Tax Asset.
     - Liabilities: Trade Accounts Payable, Sales Tax Liability, Customer Advances.
     - Equity: Owner Capital, Current Period Net Profit.
     - Invariant: `Total Assets === Total Liabilities + Total Equity`.
     - Trial Balance: Debits vs Credits across all active ledger accounts (`totalDebits === totalCredits`).
   - **Stock Valuation & Moving Average Register**:
     - Quantity on hand, weighted moving average unit cost, total valuation, and deficit status per catalog item.
   - **Party Running Ledgers**:
     - Chronological statement of account with Sales Invoices, Customer Receipts, Credit Notes, Purchase Bills, Supplier Payouts, and Debit Notes with running due balances.

2. **Daily Cash Register Sessions & Shift Close Reconciliation (`apps/api/src/cash-sessions.ts`)**:
   - `CashSession` model in PostgreSQL with sequential numbering `CS-xxxxxx`.
   - Shift opening with initial cash drawer float; enforces mutual exclusion (at most one open shift per cash drawer account).
   - Dynamic real-time expected cash in till calculation:
     `Expected = Opening Float + Sales Cash Inflows + Customer Payments In + Transfers In - Supplier Payments Out - Operating Expenses - Transfers Out - Cash Refunds`.
   - Shift closing workflow:
     - Compares user-entered counted cash against live expected cash.
     - Computes exact variance amount.
     - Strictly enforces non-empty `variance_reason` whenever discrepancy exists (`counted != expected`).
     - Freezes server sync-cursor watermark (`closed_watermark_cursor`) into the record for tamper-evident offline/online shift auditing.

3. **Frontend Reports Dashboard (`apps/web/src/pages/ReportsPage.tsx`)**:
   - Responsive tabbed navigation with exact `Reports` heading and mobile 390px overflow compliance:
     - Executive Overview KPI summary cards.
     - Profit & Loss tab with custom date ranges.
     - Balance Sheet & Trial Balance tab with balanced status indicator.
     - Stock Valuation tab with inventory summary.
     - Party Ledgers tab with party selection and statement of account.
     - Cash Register Close tab with live active shift monitoring, count & close modal, and past shift audit history.

---

## Verification Results

### 1. Workspace Quality Gate (`pnpm check`)
- **ESLint**: 0 warnings, 0 errors.
- **Strict TypeScript (`pnpm typecheck`)**: Passed cleanly across all 6 workspace projects (`@business/contracts`, `@business/db`, `@business/domain`, `@business/ui`, `@business/api`, `@business/web`).
- **Production Builds**: `@business/api` (tsup) and `@business/web` (Vite) built successfully.
- **Unit & Domain Tests**: 29/29 passing.

### 2. Database Integration Tests (`pnpm test:db`)
- **15/15 database test suites passed** under real PostgreSQL database with Row-Level Security (RLS) and restricted `bms_runtime` role:
  - `tests/reports-db.test.ts`:
    - Cash session opening (`CS-000001`) with float.
    - Concurrent session prevention on same cash drawer (HTTP 409 `Conflict`).
    - Multi-tenant isolation: other business cannot see or close sessions.
    - Operating expenses deducted from till in real time.
    - Cash session close with discrepancy: mandates variance explanation (rejects empty reason with HTTP 409).
    - Cash session close with explanation: freezes status, captures watermark cursor.
    - P&L report generation: verifies expenses, revenue, net profit.
    - Balance Sheet report generation: verifies `isBalanced: true`, assets match liabilities + equity.
    - Trial Balance: debits match credits.
    - Stock Summary: items, moving average cost, valuation.

### 3. Playwright Browser E2E Tests (`pnpm test:e2e`)
- **24/24 E2E test suites passed** in real Chromium browser:
  - `tests/e2e/reports.spec.ts`: End-to-end operational journey: registration, accounts setup, opening stock and cash, operating expense recording, register shift opening, viewing Executive Overview, P&L statement, Balance Sheet, Stock Valuation, and shift close with counted cash variance and audit note.
  - `tests/e2e/shell.spec.ts`: Operational navigation, focus management, exact heading match (`Reports`), and 0 horizontal overflow across all viewports (1366×768, 1920×1080, and 390×844 mobile).

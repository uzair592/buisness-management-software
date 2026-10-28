import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase } from "../packages/db/src/index";

test("M09 reports and cash sessions calculate authoritative P&L, balance sheets, and shifts", async (t) => {
  const adminUrl = process.env.DATABASE_URL ?? "postgresql://bms_local:bms_local@127.0.0.1:5432/bms";
  const runtimeUrl = new URL(adminUrl);
  runtimeUrl.username = process.env.BMS_RUNTIME_USER ?? "bms_runtime";
  runtimeUrl.password = process.env.BMS_RUNTIME_PASSWORD ?? "bms_runtime_pass_change_in_production";
  const db = createDatabase(runtimeUrl.toString());
  const app = createApp({ db });
  t.after(async () => {
    await app.close();
    await db.$disconnect();
  });

  const suffix = crypto.randomUUID().slice(0, 8);
  async function register(name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: `rep_${name}_${suffix}`,
        password: "CorrectBatteryHorse123!",
        fullName: "Owner",
        businessName: name,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    return {
      id: res.json().business.id as string,
      userId: res.json().user.id as string,
      csrf: res.json().csrfToken as string,
      cookie: (res.headers["set-cookie"] as string[]).map((v) => v.split(";")[0]).join("; "),
    };
  }

  const owner = await register("RepBizA");
  const otherOwner = await register("RepBizB");

  const send = (actor: typeof owner, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { cookie: actor.cookie, "x-csrf-token": actor.csrf },
      ...(payload ? { payload } : {}),
    });

  // Setup system accounts
  const system = await send(owner, "POST", "/v1/accounts/system");
  assert.equal(system.statusCode, 200, system.body);

  // Setup cash account
  const cash = await send(owner, "POST", "/v1/accounts", { code: "MAIN_DRAWER", name: "Main Drawer", kind: "Cash" });
  assert.equal(cash.statusCode, 201);
  const cashAccountId = cash.json().id as string;

  // Fund cash with 5,000 via opening balance
  const openingInput = {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-24",
    entries: [{ kind: "Money", accountId: cashAccountId, amount: "5000.00" }],
  };
  const preview = await send(owner, "POST", "/v1/opening/preview", openingInput);
  assert.equal(preview.statusCode, 200, preview.body);
  const commit = await send(owner, "POST", "/v1/opening/commit", {
    ...openingInput,
    expectedCursor: preview.json().expectedCursor as string,
  });
  assert.equal(commit.statusCode, 201, commit.body);

  // Get location and enroll device for opening session
  const locRes = await send(owner, "GET", "/v1/cash-sessions/workspace");
  assert.equal(locRes.statusCode, 200, locRes.body);
  const locationId = locRes.json().locations[0].id as string;

  const deviceRes = await send(owner, "POST", "/v1/devices/enroll", { deviceName: "Main POS", locationId });
  assert.equal(deviceRes.statusCode, 201, deviceRes.body);
  const deviceId = deviceRes.json().id as string;

  const workspaceRes = await send(owner, "GET", "/v1/cash-sessions/workspace");
  assert.equal(workspaceRes.statusCode, 200, workspaceRes.body);
  const wsData = workspaceRes.json();
  assert.ok(wsData.locations.length > 0);
  assert.ok(wsData.devices.length > 0);

  // 1. Open Cash Session
  const openRes = await send(owner, "POST", "/v1/cash-sessions/open", {
    locationId,
    deviceId,
    cashAccountId,
    openingFloat: "300.00",
  });
  assert.equal(openRes.statusCode, 201, openRes.body);
  const session = openRes.json().session;
  assert.equal(session.sessionNumber, "CS-000001");
  assert.equal(session.status, "Open");
  assert.equal(session.openingFloat, "300.00");
  const sessionId = session.id as string;

  // 2. Prevent concurrent open sessions on the same cash account
  const duplicateOpen = await send(owner, "POST", "/v1/cash-sessions/open", {
    locationId,
    deviceId,
    cashAccountId,
    openingFloat: "100.00",
  });
  assert.equal(duplicateOpen.statusCode, 409);
  assert.match(duplicateOpen.json().error, /already an active open cash session/);

  // 3. Tenant Isolation check: Other business cannot see or close this session
  const otherCurrent = await send(otherOwner, "GET", "/v1/cash-sessions/current");
  assert.equal(otherCurrent.statusCode, 200);
  assert.equal(otherCurrent.json().session, null);

  const otherClose = await send(otherOwner, "POST", `/v1/cash-sessions/${sessionId}/close`, {
    countedAmount: "300.00",
  });
  assert.equal(otherClose.statusCode, 409);
  assert.match(otherClose.json().error, /Cash session not found/);

  // 4. Record an expense paid from the cash drawer
  const catRes = await send(owner, "POST", "/v1/expenses/categories", { name: "Store Maintenance" });
  assert.equal(catRes.statusCode, 201);
  const categoryId = catRes.json().id as string;

  const expAccRes = await send(owner, "POST", "/v1/accounts", {
    code: "EXP_MAINT",
    name: "Maintenance Expense",
    kind: "Expense",
    expenseCategoryId: categoryId,
  });
  assert.equal(expAccRes.statusCode, 201);
  const expenseAccountId = expAccRes.json().id as string;

  const postExpense = await send(owner, "POST", "/v1/expenses/post", {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    expenseCategoryId: categoryId,
    expenseAccountId,
    paidFromAccountId: cashAccountId,
    amount: "50.00",
    businessDate: "2026-10-24",
    note: "Light bulb replacement",
  });
  assert.equal(postExpense.statusCode, 200, postExpense.body);

  // 5. Verify real-time cash session calculation reflects outflow
  const currentSessionRes = await send(owner, "GET", "/v1/cash-sessions/current");
  assert.equal(currentSessionRes.statusCode, 200, currentSessionRes.body);
  const current = currentSessionRes.json().session;
  assert.ok(current);
  assert.equal(current.openingFloat, "300.00");
  assert.equal(current.cashOutflows, "50.00");
  assert.equal(current.expectedAmount, "250.00");

  // 6. Attempt to close session with variance but without reason (should fail with 409)
  const failClose = await send(owner, "POST", `/v1/cash-sessions/${sessionId}/close`, {
    countedAmount: "245.00", // $5 shortage
  });
  assert.equal(failClose.statusCode, 409);
  assert.match(failClose.json().error, /variance reason/);

  // 7. Close session with variance AND valid reason (should succeed)
  const closeRes = await send(owner, "POST", `/v1/cash-sessions/${sessionId}/close`, {
    countedAmount: "245.00",
    varianceReason: "Missing $5 change coin shortage",
  });
  assert.equal(closeRes.statusCode, 200, closeRes.body);
  const closedSession = closeRes.json().session;
  assert.equal(closedSession.status, "Closed");
  assert.equal(closedSession.countedAmount, "245.00");
  assert.equal(closedSession.expectedAmount, "250.00");
  assert.equal(closedSession.varianceAmount, "-5.00");
  assert.equal(closedSession.varianceReason, "Missing $5 change coin shortage");
  assert.ok(closedSession.closedAt);

  // 8. Financial Reports Verification
  // a) Profit & Loss
  const pnlRes = await send(owner, "GET", "/v1/reports/profit-and-loss?startDate=2026-10-01&endDate=2026-10-31");
  assert.equal(pnlRes.statusCode, 200, pnlRes.body);
  const pnl = pnlRes.json().report;
  assert.equal(pnl.expenses.totalExpenses, "50.00");
  assert.equal(pnl.expenses.categories.length, 1);
  assert.equal(pnl.expenses.categories[0].name, "Store Maintenance");
  assert.equal(pnl.netOperatingProfit, "-50.00");

  // b) Balance Sheet
  const bsRes = await send(owner, "GET", "/v1/reports/balance-sheet?asOfDate=2026-10-24");
  assert.equal(bsRes.statusCode, 200, bsRes.body);
  const bs = bsRes.json().report;
  assert.equal(bs.isBalanced, true);
  // Assets = Cash (5000 opening - 50 expense = 4950)
  assert.equal(bs.assets.cashAndBank, "4950.00");
  assert.equal(bs.assets.totalAssets, "4950.00");
  // Equity = Capital (5000) + Profit (-50) = 4950
  assert.equal(bs.equity.openingCapital, "5000.00");
  assert.equal(bs.equity.currentPeriodProfit, "-50.00");
  assert.equal(bs.equity.totalEquity, "4950.00");

  // c) Trial Balance
  const tbRes = await send(owner, "GET", "/v1/reports/trial-balance?asOfDate=2026-10-24");
  assert.equal(tbRes.statusCode, 200, tbRes.body);
  const tb = tbRes.json().report;
  assert.equal(tb.isBalanced, true);
  assert.equal(tb.totalDebits, tb.totalCredits);

  // d) Stock Valuation Summary
  const stockRes = await send(owner, "GET", "/v1/reports/stock-summary");
  assert.equal(stockRes.statusCode, 200, stockRes.body);
  const stock = stockRes.json().report;
  assert.ok(Array.isArray(stock.items));
  assert.equal(typeof stock.totalValuation, "string");
  assert.equal(typeof stock.openDeficitsCount, "number");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, withTenantContext } from "../packages/db/src/index";

test("M07 expense tracking persists sequence, balances double-entry ledger, checks cash limits, and isolates tenants", async (t) => {
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
        username: `exp_${name}_${suffix}`,
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

  const owner = await register("ExpBizA");
  const otherOwner = await register("ExpBizB");

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

  const cash = await send(owner, "POST", "/v1/accounts", { code: "SHOP_CASH", name: "Shop Cash", kind: "Cash" });
  assert.equal(cash.statusCode, 201);
  const cashAccountId = cash.json().id as string;

  // Fund cash with 10,000 via opening balance
  const openingInput = {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-23",
    entries: [{ kind: "Money", accountId: cashAccountId, amount: "10000.00" }],
  };
  const preview = await send(owner, "POST", "/v1/opening/preview", openingInput);
  assert.equal(preview.statusCode, 200, preview.body);
  const commit = await send(owner, "POST", "/v1/opening/commit", {
    ...openingInput,
    expectedCursor: preview.json().expectedCursor as string,
  });
  assert.equal(commit.statusCode, 201, commit.body);

  // 1. Create Expense Category
  const catRes = await send(owner, "POST", "/v1/expenses/categories", {
    name: "Utilities & Rent",
  });
  assert.equal(catRes.statusCode, 201, catRes.body);
  const categoryId = catRes.json().id as string;

  // 2. Create custom Expense Account under that category
  const expAccRes = await send(owner, "POST", "/v1/accounts", {
    code: "ELECTRICITY",
    name: "Electricity Bill",
    kind: "Expense",
    expenseCategoryId: categoryId,
  });
  assert.equal(expAccRes.statusCode, 201, expAccRes.body);
  const expAccountId = expAccRes.json().id as string;

  // 3. Post an expense: 2500.00 paid from Shop Cash
  const expenseId = crypto.randomUUID();
  const postExpRes = await send(owner, "POST", "/v1/expenses/post", {
    id: expenseId,
    commandId: crypto.randomUUID(),
    expenseCategoryId: categoryId,
    expenseAccountId: expAccountId,
    paidFromAccountId: cashAccountId,
    amount: "2500.00",
    reference: "K-Electric Oct 2026",
    note: "Paid in cash at counter",
    businessDate: "2026-10-23",
  });
  assert.equal(postExpRes.statusCode, 200, postExpRes.body);
  const postedExp = postExpRes.json();
  assert.equal(postedExp.number, "EXP-000001");
  assert.equal(postedExp.amount, "2500.00");
  assert.equal(postedExp.status, "Posted");

  // 4. Retrieve single expense and list
  const getExpRes = await send(owner, "GET", `/v1/expenses/${expenseId}`);
  assert.equal(getExpRes.statusCode, 200);
  assert.equal(getExpRes.json().expense.number, "EXP-000001");
  assert.equal(getExpRes.json().expense.categoryName, "Utilities & Rent");
  assert.equal(getExpRes.json().expense.expenseAccountName, "Electricity Bill");

  const listExpRes = await send(owner, "GET", "/v1/expenses");
  assert.equal(listExpRes.statusCode, 200);
  assert.equal(listExpRes.json().expenses.length, 1);

  // 5. Cash balance check: Shop Cash has 10,000 - 2,500 = 7,500 left.
  // Attempting to post an expense of 8,000.00 from cash must fail with 409!
  const overSpendRes = await send(owner, "POST", "/v1/expenses/post", {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    expenseCategoryId: categoryId,
    expenseAccountId: expAccountId,
    paidFromAccountId: cashAccountId,
    amount: "8000.00",
    businessDate: "2026-10-23",
  });
  assert.equal(overSpendRes.statusCode, 409, overSpendRes.body);

  // 6. Verify journal balance
  await withTenantContext(db, { businessId: owner.id, userId: owner.userId }, async (tx) => {
    const lines = await tx.journalLine.aggregate({
      where: { businessId: owner.id },
      _sum: { debit: true, credit: true },
    });
    assert.deepEqual(lines._sum.debit, lines._sum.credit, "All journal lines must balance exactly");
  });

  // 7. Multi-tenant isolation: otherOwner cannot see ExpBizA's expense
  const isolationRes = await send(otherOwner, "GET", `/v1/expenses/${expenseId}`);
  assert.equal(isolationRes.statusCode, 404, "Foreign tenant must receive 404");
});

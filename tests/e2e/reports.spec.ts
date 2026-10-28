import { test, expect } from "./fixtures";

test("owner reviews P&L, balance sheets, stock valuation, and reconciles cash register shift", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const registered = await page.request.post("/v1/auth/register", {
    data: {
      username: `rep_e2e_${suffix}`,
      password: "CorrectBatteryHorse123!",
      fullName: "Owner",
      businessName: `Reports Superstore ${suffix}`,
    },
  });
  expect(registered.status()).toBe(201);
  const regJson = await registered.json();
  const csrf = regJson.csrfToken as string;
  const post = (path: string, data: object) =>
    page.request.post(path, { data, headers: { "x-csrf-token": csrf } });

  // 1. Setup accounts
  expect((await post("/v1/accounts/system", {})).status()).toBe(200);
  const cashRes = await post("/v1/accounts", { code: "MAIN_CASH", name: "Main Cash Drawer", kind: "Cash" });
  expect(cashRes.status()).toBe(201);
  const cashAccountId = (await cashRes.json()).id;

  // 2. Setup unit & catalogue item
  const unitRes = await post("/v1/catalogue/units", { code: "PCS", name: "Pieces" });
  const unitId = (await unitRes.json()).id;

  const itemRes = await post("/v1/catalogue/items", {
    name: "Medical Diagnostic Kit",
    kind: "Goods",
    sku: `KIT-${suffix}`,
    salePrice: "850.00",
    baseUnitId: unitId,
  });
  expect(itemRes.status()).toBe(201);
  const itemId = (await itemRes.json()).id;

  // 3. Setup customer
  const partyRes = await post("/v1/catalogue/parties", {
    name: `Hospital Client ${suffix}`,
    isCustomer: true,
    isSupplier: false,
    phone: "555-4321",
  });
  expect(partyRes.status()).toBe(201);
  expect((await partyRes.json()).id).toBeDefined();

  // 4. Enroll device
  const locRes = await page.request.get("/v1/locations");
  const locationId = (await locRes.json())[0].id;
  const deviceRes = await post("/v1/devices/enroll", { deviceName: "Till 1", locationId });
  const deviceId = (await deviceRes.json()).id;

  // 5. Fund opening cash ($10,000) and opening stock (50 kits @ $500 = $25,000)
  const openingInput = {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-24",
    entries: [
      { kind: "Money", accountId: cashAccountId, amount: "10000.00" },
      { kind: "Stock", itemId, locationId, quantity: "50.000000", value: "25000.00" },
    ],
  };
  const preview = await post("/v1/opening/preview", openingInput);
  expect(preview.status()).toBe(200);
  const commit = await post("/v1/opening/commit", {
    ...openingInput,
    expectedCursor: (await preview.json()).expectedCursor,
  });
  expect(commit.status()).toBe(201);

  // 6. Record an operating expense ($250)
  const catRes = await post("/v1/expenses/categories", { name: "Office Supplies" });
  expect(catRes.status()).toBe(201);
  const categoryId = (await catRes.json()).id;

  const expAccRes = await post("/v1/accounts", {
    code: "EXP_SUPP",
    name: "Supplies Account",
    kind: "Expense",
    expenseCategoryId: categoryId,
  });
  expect(expAccRes.status()).toBe(201);
  const expAccountId = (await expAccRes.json()).id;

  const postExpRes = await post("/v1/expenses/post", {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    expenseCategoryId: categoryId,
    expenseAccountId: expAccountId,
    paidFromAccountId: cashAccountId,
    amount: "250.00",
    businessDate: "2026-10-24",
    note: "Printer ink and paper",
  });
  expect(postExpRes.status()).toBe(200);

  // 7. Open a register shift ($500 float)
  const openShiftRes = await post("/v1/cash-sessions/open", {
    locationId,
    deviceId,
    cashAccountId,
    openingFloat: "500.00",
  });
  expect(openShiftRes.status()).toBe(201);

  // 8. Navigate to /reports in browser UI
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();

  // 9. Verify Executive Overview
  await expect(page.getByText("Inventory Valuation", { exact: true })).toBeVisible();
  await expect(page.getByText("Cash & Bank Liquid Funds", { exact: true })).toBeVisible();

  // 10. Switch to Profit & Loss
  await page.getByRole("button", { name: "Profit & Loss" }).click();
  await expect(page.getByRole("heading", { name: "Income Statement (Profit & Loss)" })).toBeVisible();
  await expect(page.getByText("Office Supplies")).toBeVisible();
  await expect(page.getByText(/250\.00/).first()).toBeVisible();

  // 11. Switch to Balance Sheet & Trial Balance
  await page.getByRole("button", { name: "Balance Sheet & Trial Balance" }).click();
  await expect(page.getByRole("heading", { name: "Double-Entry Balance Sheet" })).toBeVisible();
  await expect(page.getByText("✓ Balanced (Assets = Liabilities + Equity)")).toBeVisible();
  await expect(page.getByText("Full Trial Balance")).toBeVisible();

  // 12. Switch to Stock Valuation
  await page.getByRole("button", { name: "Stock Valuation" }).click();
  await expect(page.getByRole("heading", { name: "Stock Valuation & Moving Average Cost Register" })).toBeVisible();
  await expect(page.getByText("Medical Diagnostic Kit")).toBeVisible();

  // 13. Switch to Cash Register Close
  await page.getByRole("button", { name: "Cash Register Close" }).click();
  await expect(page.getByText("REGISTER SESSION OPEN")).toBeVisible();
  await expect(page.getByText("CS-000001").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Count & Close Shift" })).toBeVisible();

  // 14. Count and Close Register Shift
  await page.getByRole("button", { name: "Count & Close Shift" }).click();
  await expect(page.getByRole("heading", { name: "Count & Close Shift (CS-000001)" })).toBeVisible();

  // Provide variance explanation and close
  await page.getByLabel("Counted Cash in Drawer ($)").fill("490.00");
  await page.getByPlaceholder("e.g. Missing $5 change, customer underpayment, damaged banknote...").fill("Reconciled end of day shift shortage $10");
  await page.getByRole("button", { name: "Close & Freeze Register" }).click();

  // Verify shift was closed and success alert appeared
  await expect(page.getByText(/Cash session CS-000001 closed with variance/)).toBeVisible();
  await expect(page.getByText("No Register Session Currently Open")).toBeVisible();
});

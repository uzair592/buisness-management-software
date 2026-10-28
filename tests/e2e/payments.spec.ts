import { test, expect } from "./fixtures";

test("owner records payment in with invoice allocation and tracks operating expenses", async ({ page }, testInfo) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const registered = await page.request.post("/v1/auth/register", {
    data: {
      username: `pay_e2e_${suffix}`,
      password: "CorrectBatteryHorse123!",
      fullName: "Owner",
      businessName: `Vyapar Store ${suffix}`,
    },
  });
  expect(registered.status()).toBe(201);
  const regJson = await registered.json();
  const csrf = regJson.csrfToken as string;
  const post = (path: string, data: object) => page.request.post(path, { data, headers: { "x-csrf-token": csrf } });

  // 1. Setup accounts
  expect((await post("/v1/accounts/system", {})).status()).toBe(200);
  const cashRes = await post("/v1/accounts", { code: "MAIN_CASH", name: "Main Cash", kind: "Cash" });
  expect(cashRes.status()).toBe(201);
  const cashAccountId = (await cashRes.json()).id;

  const bankRes = await post("/v1/accounts", { code: "MAIN_BANK", name: "Operating Bank", kind: "Bank" });
  expect(bankRes.status()).toBe(201);
  const bankAccountId = (await bankRes.json()).id;

  // 2. Setup catalogue (unit, item, customer)
  const unitRes = await post("/v1/catalogue/units", { code: "PCS", name: "Pieces" });
  const unitId = (await unitRes.json()).id;

  const itemRes = await post("/v1/catalogue/items", {
    name: "Standard Widget",
    kind: "Goods",
    sku: `WIDGET-${suffix}`,
    salePrice: "1500.00",
    baseUnitId: unitId,
  });
  expect(itemRes.status()).toBe(201);
  const itemId = (await itemRes.json()).id;

  const partyRes = await post("/v1/catalogue/parties", {
    name: `Alpha Customer ${suffix}`,
    isCustomer: true,
    isSupplier: false,
    phone: "555-8822",
  });
  expect(partyRes.status()).toBe(201);
  const partyId = (await partyRes.json()).id;

  // 3. Get location & enroll device
  const locRes = await page.request.get("/v1/locations");
  const locationId = (await locRes.json())[0].id;
  const deviceRes = await post("/v1/devices/enroll", { deviceName: "Main Counter", locationId });
  const deviceId = (await deviceRes.json()).id;

  // 4. Fund cash & opening stock
  const openingInput = {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-23",
    entries: [
      { kind: "Money", accountId: cashAccountId, amount: "50000.00" },
      { kind: "Money", accountId: bankAccountId, amount: "50000.00" },
      { kind: "Stock", itemId, locationId, quantity: "20.000000", value: "10000.00" },
    ],
  };
  const preview = await post("/v1/opening/preview", openingInput);
  expect(preview.status()).toBe(200);
  const commit = await post("/v1/opening/commit", {
    ...openingInput,
    expectedCursor: (await preview.json()).expectedCursor,
  });
  expect(commit.status()).toBe(201);

  // 5. Create and post a credit sale invoice (Total 1500.00, Paid 0, Due 1500.00)
  const saleId = crypto.randomUUID();
  const saleCmd = crypto.randomUUID();
  const saleDraft = await post("/v1/sales/drafts", {
    id: saleId,
    commandId: saleCmd,
    deviceEnrollmentId: deviceId,
    locationId,
    partyId,
    businessDate: "2026-10-23",
    documentDiscount: "0",
    lines: [
      {
        id: crypto.randomUUID(),
        itemId,
        conversionId: null,
        taxProfileId: null,
        quantity: "1",
        unitPrice: "1500.00",
        discount: "0",
      },
    ],
    payments: [],
  });
  expect(saleDraft.status()).toBe(201);

  const salePost = await post(`/v1/sales/${saleId}/post`, { commandId: saleCmd });
  expect(salePost.status()).toBe(200);
  const saleNumber = (await salePost.json()).number as string;

  // 6. UI Test: Navigate to /payments
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/payments");

  await expect(page.getByRole("heading", { name: "Payments & Receipts" })).toBeVisible();

  // Click "+ Payment In"
  await page.getByRole("button", { name: "+ Payment In" }).click();
  await expect(page.getByText("Record Payment In (Customer Receipt)")).toBeVisible();

  // Select customer
  await page.locator("select").first().selectOption(partyId);

  // Verify open document row appears
  await expect(page.getByText(saleNumber)).toBeVisible();
  await expect(page.getByText(/1,500\.00/).first()).toBeVisible();

  // Fill payment amount
  await page.getByPlaceholder("0.00").first().fill("1500.00");

  // Check the auto-allocate checkbox for this invoice
  await page.locator('input[type="checkbox"]').first().check();

  // Fill reference
  await page.getByPlaceholder("e.g. TR-99823 or Cheque #102").fill("CHQ-5501");

  // Submit payment
  await page.getByRole("button", { name: "Post Payment In" }).click();

  // Assert payment posted in list
  const payCell = page.getByRole("cell", { name: "PAY-IN-000001" });
  await expect(payCell).toBeVisible();
  await expect(page.getByRole("cell", { name: "Payment In" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "CHQ-5501" })).toBeVisible();

  // Open payment details modal
  await payCell.click();
  await expect(page.getByText("Document Allocations")).toBeVisible();
  await expect(page.getByText(saleNumber)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // 7. UI Test: Navigate to /expenses
  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Expenses", exact: true })).toBeVisible();

  // First create a category via Categories tab
  await page.getByRole("button", { name: "Categories" }).click();
  await page.getByPlaceholder("e.g. Office Supplies, Staff Welfare").fill("Shop Utilities");
  await page.getByRole("button", { name: "+ Add Category" }).click();
  await expect(page.getByRole("cell", { name: "Shop Utilities" })).toBeVisible();

  // Switch to Record Expense tab
  await page.getByRole("button", { name: "+ Record Expense" }).click();
  await expect(page.getByText("Record Shop Expense")).toBeVisible();

  // Fill expense form
  await page.getByPlaceholder("0.00").fill("350.00");
  await page.getByPlaceholder("e.g. Bill #8839, Receipt").fill("ELEC-OCT-26");
  await page.getByPlaceholder("e.g. Paid monthly shop electricity bill").fill("Tea and snacks for clients");

  await page.getByRole("button", { name: "Record Expense", exact: true }).click();

  // Assert expense posted in list
  await expect(page.getByRole("cell", { name: "EXP-000001" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Shop Utilities" }).first()).toBeVisible();
  await expect(page.getByText(/350\.00/).first()).toBeVisible();
  await expect(page.getByText("ELEC-OCT-26")).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("payments-and-expenses-1366.png"), fullPage: true });
});

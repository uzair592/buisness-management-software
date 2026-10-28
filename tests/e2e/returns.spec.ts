import { test, expect } from "./fixtures";

test("owner creates and posts a sales credit note return and a stock adjustment", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const registered = await page.request.post("/v1/auth/register", {
    data: {
      username: `return_e2e_${suffix}`,
      password: "CorrectBatteryHorse123!",
      fullName: "Owner",
      businessName: `Hardware Store ${suffix}`,
    },
  });
  expect(registered.status()).toBe(201);
  const csrf = (await registered.json()).csrfToken as string;
  const post = (path: string, data: object) => page.request.post(path, { data, headers: { "x-csrf-token": csrf } });

  // Setup accounts & catalogue
  expect((await post("/v1/accounts/system", {})).status()).toBe(200);
  const cash = await post("/v1/accounts", { code: "CASH_TILL", name: "Till Cash", kind: "Cash" });
  expect(cash.status()).toBe(201);
  const unit = await post("/v1/catalogue/units", { code: "PCS", name: "Pieces" });
  expect(unit.status()).toBe(201);
  const tax = await post("/v1/catalogue/tax-profiles", { name: "Zero Tax", rate: "0", mode: "Exclusive" });
  expect(tax.status()).toBe(201);

  const goods = await post("/v1/catalogue/items", {
    name: "Copper Pipe",
    kind: "Goods",
    sku: "PIPE-01",
    barcode: "666001",
    salePrice: "100.00",
    categoryId: null,
    baseUnitId: (await unit.json()).id,
    taxProfileId: (await tax.json()).id,
  });
  expect(goods.status()).toBe(201);
  const goodsData = await goods.json();

  const customer = await post("/v1/catalogue/parties", {
    name: "Standard Plumber",
    isCustomer: true,
    isSupplier: false,
    phone: "555-9876",
    email: "plumber@standard.test",
  });
  expect(customer.status()).toBe(201);
  const customerData = await customer.json();

  const locations = await page.request.get("/v1/locations");
  const locationId = (await locations.json())[0].id;
  const device = await post("/v1/devices/enroll", { deviceName: "Counter", locationId });
  expect(device.status()).toBe(201);
  const deviceId = (await device.json()).id;

  // Post opening stock
  const opening = {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-28",
    entries: [
      { kind: "Stock", itemId: goodsData.id, locationId, quantity: "20", value: "1000.00" },
    ],
  };
  const preview = await post("/v1/opening/preview", opening);
  expect(preview.status()).toBe(200);
  expect((await post("/v1/opening/commit", { ...opening, expectedCursor: (await preview.json()).expectedCursor })).status()).toBe(201);

  // Post a sale via API
  const saleDraftId = crypto.randomUUID();
  const saleCommandId = crypto.randomUUID();
  const saleRes = await post("/v1/sales/drafts", {
    id: saleDraftId,
    commandId: saleCommandId,
    deviceEnrollmentId: deviceId,
    locationId,
    partyId: customerData.id,
    lines: [
      {
        id: crypto.randomUUID(),
        itemId: goodsData.id,
        quantity: "10",
        unitPrice: "100.00",
        discount: "0",
        conversionId: null,
        taxProfileId: (await tax.json()).id,
      },
    ],
    payments: [],
    businessDate: "2026-10-28",
    documentDiscount: "0",
  });
  expect(saleRes.status()).toBe(201);

  const postSaleRes = await post(`/v1/sales/${saleDraftId}/post`, {
    commandId: saleCommandId,
  });
  expect(postSaleRes.status()).toBe(200);
  const postedSale = await postSaleRes.json();
  expect(postedSale.number).toBeTruthy();

  // 1. Visit Returns Page
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/returns");

  await expect(page.getByRole("heading", { name: "Returns & Credits" })).toBeVisible();

  // Switch to New Return tab
  await page.getByRole("button", { name: "+ New Return" }).click();
  await expect(page.getByRole("heading", { name: "Create Return Note" })).toBeVisible();

  // Paste original sale ID and fetch details
  await page.getByPlaceholder("Paste original Sale or Purchase UUID…").fill(postedSale.id);
  await page.getByRole("button", { name: "Load Document" }).click();

  // Expect line to load
  await expect(page.getByText("Copper Pipe")).toBeVisible();

  // Fill return quantity of 2
  const returnQtyInput = page.locator("table tbody input[type='number']").first();
  await returnQtyInput.fill("2");

  // Post return
  await page.getByRole("button", { name: /Post Return Note/ }).click();

  // Check success alert and Return History table
  await expect(page.getByText(/Credit Note CN-.* successfully posted!/)).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("Customer Return (CN)").first()).toBeVisible();

  // 2. Visit Stock Adjustments Page
  await page.goto("/stock/adjustments");
  await expect(page.getByRole("heading", { name: "Stock Adjustments & Counts" })).toBeVisible();

  // Switch to New Stock Adjustment tab
  await page.getByRole("button", { name: "+ New Stock Adjustment" }).click();
  await expect(page.getByRole("heading", { name: "Record Stock Count / Adjustment" })).toBeVisible();
  await expect(page.getByLabel("Inventory Item (Goods only)")).toContainText("Copper Pipe");

  // Fill adjustment form: Damage of -1 unit, unit cost 60.00
  await page.getByLabel("Adjustment Kind").selectOption("Damage");
  await page.getByPlaceholder("e.g. -2 or 5").fill("-1");
  await page.getByPlaceholder("100.00").fill("60.00");
  await page.getByPlaceholder(/Monthly physical stock audit/).fill("Damaged item during inspection");

  // Post adjustment
  await page.getByRole("button", { name: "Post Stock Adjustment" }).click();

  // Check success alert and Adjustments History table
  await expect(page.getByText(/Stock Adjustment .* successfully posted!/)).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("-1").first()).toBeVisible();
});

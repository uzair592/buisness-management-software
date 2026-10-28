import { test, expect } from "./fixtures";
import fs from "node:fs/promises";
import path from "node:path";

test("M12 browser journeys: quotation creation & sale conversion, purchase order to bill, and warehouse stock transfer dispatch & receipt", async ({ page }) => {
  const evidenceDir = path.resolve(process.cwd(), "docs/evidence/m12");
  await fs.mkdir(evidenceDir, { recursive: true });

  const suffix = crypto.randomUUID().slice(0, 8);
  const registered = await page.request.post("/v1/auth/register", {
    data: {
      username: `m12_user_${suffix}`,
      password: "CorrectBatteryHorse123!",
      fullName: "Owner Operator",
      businessName: `Metro Logistics & Trade ${suffix}`,
    },
  });
  expect(registered.status()).toBe(201);
  const csrf = (await registered.json()).csrfToken as string;
  const post = (path: string, data: object) => page.request.post(path, { data, headers: { "x-csrf-token": csrf } });

  // Setup system accounts & catalogue
  expect((await post("/v1/accounts/system", {})).status()).toBe(200);

  const unit = await post("/v1/catalogue/units", { code: "PCS", name: "Pieces" });
  expect(unit.status()).toBe(201);
  const unitId = (await unit.json()).id;

  const item = await post("/v1/catalogue/items", {
    name: "Solar Inverter 5kVA",
    kind: "Goods",
    sku: "INV-5K",
    salePrice: "1200.00",
    baseUnitId: unitId,
  });
  expect(item.status()).toBe(201);
  const itemId = (await item.json()).id;

  const customer = await post("/v1/catalogue/parties", {
    name: "Apex Engineering",
    isCustomer: true,
    isSupplier: false,
  });
  expect(customer.status()).toBe(201);

  const supplier = await post("/v1/catalogue/parties", {
    name: "Suntree Power Supply",
    isCustomer: false,
    isSupplier: true,
  });
  expect(supplier.status()).toBe(201);

  // Locations: primary and warehouse 2
  const locListRes = await page.request.get("/v1/locations");
  expect(locListRes.status()).toBe(200);
  const sourceLocationId = (await locListRes.json())[0].id;

  const wh2Res = await post("/v1/locations", { code: "WH2", name: "Secondary Warehouse" });
  expect(wh2Res.status()).toBe(201);

  // Enrolled device for sales
  const devRes = await post("/v1/devices/enroll", {
    deviceName: "Main Counter",
    locationId: sourceLocationId,
  });
  expect(devRes.status()).toBe(201);

  // Add opening stock so quotes can convert to sales
  const openingPreview = await post("/v1/opening/preview", {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-28",
    entries: [{ kind: "Stock", locationId: sourceLocationId, itemId, quantity: "50", value: "40000.00" }],
  });
  expect(openingPreview.status()).toBe(200);
  expect((await post("/v1/opening/commit", {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-28",
    expectedCursor: (await openingPreview.json()).expectedCursor,
    entries: [{ kind: "Stock", locationId: sourceLocationId, itemId, quantity: "50", value: "40000.00" }],
  })).status()).toBe(201);

  await page.setViewportSize({ width: 1366, height: 768 });

  // 1. JOURNEY 1: QUOTATIONS
  await page.goto("/quotes");
  await expect(page.getByRole("heading", { name: "Quotations / Estimates" })).toBeVisible();

  // Create quotation
  await page.getByRole("button", { name: "+ New Quotation" }).click();
  await expect(page.getByRole("heading", { name: "Create New Quotation" })).toBeVisible();

  await page.locator("select").first().selectOption({ label: "Apex Engineering" });
  await page.getByPlaceholder("Optional terms or remarks").fill("Valid for 15 days");
  await page.getByRole("button", { name: "Issue Quotation" }).click();

  await expect(page.getByText("Quotation created successfully!")).toBeVisible();
  await expect(page.getByText("QT-000001")).toBeVisible();
  await expect(page.getByRole("table").getByText("Issued")).toBeVisible();

  await page.screenshot({ path: path.join(evidenceDir, "01-quotation-issued.png") });

  // Convert to Sale
  await page.getByRole("button", { name: "Convert to Sale" }).click();
  await expect(page.getByRole("heading", { name: /Convert QT-000001 to Sales Invoice/ })).toBeVisible();
  await page.getByRole("button", { name: "Create & Post Invoice" }).click();

  await expect(page.getByText(/Quotation successfully converted to Sale Invoice!/)).toBeVisible();
  await expect(page.getByRole("table").getByText("Fulfilled")).toBeVisible();

  await page.screenshot({ path: path.join(evidenceDir, "02-quotation-converted.png") });

  // 2. JOURNEY 2: PURCHASE ORDERS
  await page.goto("/purchase-orders");
  await expect(page.getByRole("heading", { name: /Purchase Orders/ })).toBeVisible();

  await page.getByRole("button", { name: "+ New Purchase Order" }).click();
  await expect(page.getByRole("heading", { name: "Create New Purchase Order" })).toBeVisible();

  await page.locator("select").nth(0).selectOption({ label: "Suntree Power Supply" });
  await page.locator("select").nth(1).selectOption({ index: 1 });
  await page.locator("select").nth(2).selectOption({ index: 1 });

  await page.locator("input[type='number']").nth(0).fill("5");
  await page.locator("input[type='number']").nth(1).fill("950.00");
  await page.getByRole("button", { name: "Issue Purchase Order" }).click();

  await expect(page.getByText("Purchase order created successfully!")).toBeVisible();
  await expect(page.getByText("PO-000001")).toBeVisible();

  // Convert to Purchase Bill
  await page.getByRole("button", { name: "Convert to Bill" }).click();
  await expect(page.getByRole("heading", { name: /Convert PO-000001 to Purchase Bill/ })).toBeVisible();
  await page.getByPlaceholder("e.g. INV-2026-8877").fill("INV-STP-5544");
  await page.getByRole("button", { name: "Create & Post Bill" }).click();

  await expect(page.getByText(/Purchase order successfully converted to Purchase Bill!/)).toBeVisible();

  await page.screenshot({ path: path.join(evidenceDir, "03-purchase-order-converted.png") });

  // 3. JOURNEY 3: INTER-WAREHOUSE STOCK TRANSFERS
  await page.goto("/stock/transfers");
  await expect(page.getByRole("heading", { name: /Inter-Warehouse Stock Transfers/ })).toBeVisible();

  // Dispatch transfer
  await page.getByRole("button", { name: "+ Dispatch Transfer" }).click();
  await expect(page.getByRole("heading", { name: "Dispatch Inventory Transfer" })).toBeVisible();

  // Select destination warehouse (2nd select on page)
  await page.locator("select").nth(1).selectOption({ label: "Secondary Warehouse" });
  await page.getByPlaceholder("Vehicle number, driver name, shipment ref").fill("Van-402 Bulk Shipment");
  await page.locator("input[type='number']").first().fill("10");
  await page.getByRole("button", { name: "Dispatch Transfer", exact: true }).click();

  await expect(page.getByText("Stock transfer dispatched successfully!")).toBeVisible();
  await expect(page.getByText("TR-000001")).toBeVisible();
  await expect(page.getByRole("table").getByText("In Transit")).toBeVisible();

  await page.screenshot({ path: path.join(evidenceDir, "04-stock-transfer-dispatched.png") });

  // Receive goods with transit loss
  await page.getByRole("button", { name: "Receive Goods" }).click();
  await expect(page.getByRole("heading", { name: /Receive Transfer: TR-000001/ })).toBeVisible();

  const modal = page.locator(".fixed");
  const receiveQtyInput = modal.locator("input[type='number']").nth(0);
  const lossQtyInput = modal.locator("input[type='number']").nth(1);
  const lossReasonInput = modal.getByPlaceholder("Reason if loss > 0");

  await receiveQtyInput.fill("8");
  await lossQtyInput.fill("2");
  await lossReasonInput.fill("Transit vibration damage");

  await modal.getByRole("button", { name: "Confirm Receipt & Post" }).click();

  await expect(page.getByText(/Transfer receipt recorded successfully/)).toBeVisible();
  await expect(page.getByRole("table").getByText("Completed")).toBeVisible();

  await page.screenshot({ path: path.join(evidenceDir, "05-stock-transfer-received.png") });
});

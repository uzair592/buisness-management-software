import { test, expect } from "./fixtures";

test("owner creates and posts a purchase bill with supplier reference, stock receipt, and payment split", async ({ page }, testInfo) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const registered = await page.request.post("/v1/auth/register", {
    data: {
      username: `purch_e2e_${suffix}`,
      password: "CorrectBatteryHorse123!",
      fullName: "Owner",
      businessName: `Supply Store ${suffix}`,
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
  const tax = await post("/v1/catalogue/tax-profiles", { name: "VAT 10", rate: "10", mode: "Exclusive" });
  expect(tax.status()).toBe(201);

  const goods = await post("/v1/catalogue/items", {
    name: "Drill Bit",
    kind: "Goods",
    sku: "DRILL-01",
    barcode: "555001",
    salePrice: "50.00",
    categoryId: null,
    baseUnitId: (await unit.json()).id,
    taxProfileId: (await tax.json()).id,
  });
  expect(goods.status()).toBe(201);

  const supplier = await post("/v1/catalogue/parties", {
    name: "Industrial Tools Co",
    isCustomer: false,
    isSupplier: true,
    phone: "555-1234",
    email: "sales@industrialtools.test",
  });
  expect(supplier.status()).toBe(201);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/purchases/new");

  await expect(page.getByRole("heading", { name: "New Purchase Bill" })).toBeVisible();

  // Enter supplier invoice reference
  await page.getByLabel("Supplier Invoice Number *").fill("SUP-INV-9901");

  // Search and add item
  await page.getByPlaceholder("Search items by name, barcode or SKU to add...").fill("Drill Bit");
  await page.getByText("Drill Bit").click();

  // Assert line added and edit quantity/cost
  const qtyInput = page.getByLabel("Quantity");
  await expect(qtyInput).toBeVisible();
  await qtyInput.fill("5");

  const costInput = page.getByLabel("Unit Cost");
  await costInput.fill("30.00");

  // Total should be 5 * 30 = 150 + 10% tax (15) = 165.00
  await expect(page.getByText("165.00").first()).toBeVisible();

  // Apply partial cash payment 65.00 (leaving 100.00 due)
  const cashInput = page.getByLabel("Cash Paid");
  await cashInput.fill("65.00");
  await expect(page.getByText("100.00").first()).toBeVisible();

  // Post the purchase bill
  await page.getByRole("button", { name: "Post Purchase Bill" }).click();

  // Expect success view with issued number
  await expect(page.getByText("PURCHASE BILL POSTED")).toBeVisible();
  await expect(page.getByText("PB-000001")).toBeVisible();
  await expect(page.getByText("SUP-INV-9901")).toBeVisible();

  // Navigate to /purchases list
  await page.getByRole("link", { name: "Back to purchases" }).click();
  await expect(page.getByRole("heading", { name: "Purchases & Inward Bills" })).toBeVisible();
  await expect(page.getByText("PB-000001")).toBeVisible();
  await expect(page.getByText("SUP-INV-9901")).toBeVisible();
  await expect(page.getByText("Payable: 100.00")).toBeVisible();

  // Open detail
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText("Remaining Payable: 100.00")).toBeVisible();
  await expect(page.getByText("Drill Bit")).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("purchase-bill-1366.png"), fullPage: true });
});

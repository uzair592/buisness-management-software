import { test, expect } from "./fixtures";

test("M05 live billing saves a multi-line sale, reopens and prints its snapshot at 1366px", async ({ page }, testInfo) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const register = await page.request.post("/v1/auth/register", { data: { username: `sale_${suffix}`,
    password: "CorrectBatteryHorse123!", fullName: "Sale Owner", businessName: `Shop ${suffix}` } });
  expect(register.status()).toBe(201);
  const csrf = (await register.json()).csrfToken as string;
  const post = (path: string, data: object = {}) => page.request.post(path, { data, headers: { "x-csrf-token": csrf } });
  expect((await post("/v1/accounts/system")).status()).toBe(200);
  const cash = await post("/v1/accounts", { code: "TILL", name: "Main till", kind: "Cash" });
  expect(cash.status()).toBe(201);
  const unit = await post("/v1/catalogue/units", { code: "EA", name: "Each" });
  const goods = await post("/v1/catalogue/items", { name: "Coffee beans", kind: "Goods", sku: "COFFEE",
    barcode: "B123", salePrice: "12.00", categoryId: null, baseUnitId: (await unit.json()).id, taxProfileId: null });
  const service = await post("/v1/catalogue/items", { name: "Packaging", kind: "Service", sku: "PACK",
    barcode: null, salePrice: "3.00", categoryId: null, baseUnitId: null, taxProfileId: null });
  expect(goods.status()).toBe(201); expect(service.status()).toBe(201);
  const locations = await page.request.get("/v1/locations");
  const locationId = (await locations.json())[0].id;
  const device = await post("/v1/devices/enroll", { deviceName: "Counter", locationId });
  expect(device.status()).toBe(201);
  const opening = { batchId: crypto.randomUUID(), businessDate: "2026-10-18", entries: [
    { kind: "Stock", itemId: (await goods.json()).id, locationId, quantity: "10", value: "50.00" },
  ] };
  const preview = await post("/v1/opening/preview", opening);
  expect(preview.status()).toBe(200);
  expect((await post("/v1/opening/commit", { ...opening, expectedCursor: (await preview.json()).expectedCursor })).status()).toBe(201);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/sales/new");
  await expect(page.getByRole("heading", { name: "New sale" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search item or barcode" }).fill("B123");
  await page.getByRole("button", { name: /Coffee beans/ }).click();
  await page.getByRole("searchbox", { name: "Search item or barcode" }).fill("Packaging");
  await page.getByRole("button", { name: /Packaging/ }).click();
  await expect(page.getByText("15.00").first()).toBeVisible();
  await page.getByLabel("Cash applied").fill("15.00");
  await page.getByLabel("Cash tendered").fill("20.00");
  await page.getByLabel("Cash account").selectOption((await cash.json()).id);
  await page.screenshot({ path: testInfo.outputPath("billing-cart-1366.png"), fullPage: true });
  await page.getByRole("button", { name: "Save & issue sale" }).click();
  await expect(page.getByText(/Saved: D\d+-000001/)).toBeVisible();
  await page.getByRole("link", { name: "Open receipt" }).click();
  await expect(page.getByRole("button", { name: "Print saved receipt" })).toBeVisible();
  await expect(page.getByText("Coffee beans")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Print saved receipt" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("saved-receipt-1366.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sales/new");
  await expect(page.getByRole("heading", { name: "New sale" })).toBeVisible();
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1);
  await page.screenshot({ path: testInfo.outputPath("billing-mobile-390.png"), fullPage: true });
});

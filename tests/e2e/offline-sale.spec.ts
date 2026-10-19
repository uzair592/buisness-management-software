import { test, expect } from "./fixtures";

test("M06 cached cash bill survives an offline browser reopen and syncs its original number", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const register = await page.request.post("/v1/auth/register", { data: { username: `offline_${suffix}`,
    password: "CorrectBatteryHorse123!", fullName: "Owner", businessName: `Offline ${suffix}` } });
  expect(register.status()).toBe(201);
  const csrf = (await register.json()).csrfToken as string;
  const post = (path: string, data: object = {}) => page.request.post(path, { data, headers: { "x-csrf-token": csrf } });
  expect((await post("/v1/accounts/system")).status()).toBe(200);
  const cash = await post("/v1/accounts", { code: "TILL", name: "Cash till", kind: "Cash" });
  const unit = await post("/v1/catalogue/units", { code: "EA", name: "Each" });
  const item = await post("/v1/catalogue/items", { name: "Offline bottle", kind: "Goods", sku: "OFFLINE",
    barcode: "OFF-1", salePrice: "10.00", categoryId: null, baseUnitId: (await unit.json()).id, taxProfileId: null });
  const locationId = (await (await page.request.get("/v1/locations")).json())[0].id;
  const device = await post("/v1/devices/enroll", { deviceName: "Offline counter", locationId });
  for (const response of [cash, unit, item, device]) expect(response.status()).toBe(201);
  const opening = { batchId: crypto.randomUUID(), businessDate: new Date().toISOString().slice(0, 10), entries: [
    { kind: "Stock", itemId: (await item.json()).id, locationId, quantity: "1", value: "3.00" },
  ] };
  const preview = await post("/v1/opening/preview", opening);
  expect(preview.status()).toBe(200);
  expect((await post("/v1/opening/commit", { ...opening,
    expectedCursor: (await preview.json()).expectedCursor })).status()).toBe(201);

  await page.goto("/settings");
  const row = page.getByRole("row").filter({ hasText: "Offline counter" });
  await row.getByRole("button", { name: "Bootstrap IndexedDB" }).click();
  await expect(page.getByText(/Permitted catalogue cached/)).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // the service worker controls the next navigation
  await page.context().setOffline(true);
  await page.goto("/sales/new");
  await expect(page.getByText(/Using the last saved catalogue/)).toBeVisible();
  await page.getByRole("searchbox", { name: "Search item or barcode" }).fill("OFF-1");
  await page.getByRole("button", { name: /Offline bottle/ }).click();
  await page.getByLabel("Cash applied").fill("10.00");
  await page.getByLabel("Cash tendered").fill("10.00");
  await page.getByLabel("Cash account").selectOption((await cash.json()).id);
  await page.getByRole("button", { name: "Save offline cash bill" }).click();
  await expect(page.getByText(/Saved: D\d+-O-000001/)).toBeVisible();
  await expect(page.getByText(/cloud acceptance is pending/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/1 issued bill\(s\) saved on this device/)).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText(/1 issued bill\(s\) saved on this device/)).toHaveCount(0, { timeout: 30000 });
  const documents = await page.request.get("/v1/sales/documents?status=Posted");
  expect(documents.status()).toBe(200);
  const expectedNumber = `${(await device.json()).numberPrefix}-O-000001`;
  expect((await documents.json()).rows.filter((row: { number: string }) => row.number === expectedNumber)).toHaveLength(1);
});

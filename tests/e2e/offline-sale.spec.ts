import { test, expect } from "./fixtures";

test("M06 two browser profiles issue the last item offline and converge after reconnect", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const suffix = crypto.randomUUID().slice(0, 8);
  const registered = await page.request.post("/v1/auth/register", { data: { username: `dual_${suffix}`,
    password: "CorrectBatteryHorse123!", fullName: "Owner", businessName: `Dual ${suffix}` } });
  expect(registered.status()).toBe(201);
  const csrf = (await registered.json()).csrfToken as string;
  const post = (path: string, data: object = {}) => page.request.post(path, { data, headers: { "x-csrf-token": csrf } });
  expect((await post("/v1/accounts/system")).status()).toBe(200);
  const cash = await post("/v1/accounts", { code: "TILL", name: "Till", kind: "Cash" });
  const unit = await post("/v1/catalogue/units", { code: "EA", name: "Each" });
  const item = await post("/v1/catalogue/items", { name: "Last bottle", kind: "Goods", sku: "LAST",
    barcode: "LAST-1", salePrice: "10.00", categoryId: null, baseUnitId: (await unit.json()).id, taxProfileId: null });
  const locationId = (await (await page.request.get("/v1/locations")).json())[0].id;
  const firstDevice = await post("/v1/devices/enroll", { deviceName: "First counter", locationId });
  const secondDevice = await post("/v1/devices/enroll", { deviceName: "Second counter", locationId });
  for (const response of [cash, unit, item, firstDevice, secondDevice]) expect(response.status()).toBe(201);
  const opening = { batchId: crypto.randomUUID(), businessDate: new Date().toISOString().slice(0, 10), entries: [
    { kind: "Stock", itemId: (await item.json()).id, locationId, quantity: "1", value: "3.00" },
  ] };
  const preview = await post("/v1/opening/preview", opening);
  expect(preview.status()).toBe(200);
  expect((await post("/v1/opening/commit", { ...opening,
    expectedCursor: (await preview.json()).expectedCursor })).status()).toBe(201);

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    const login = await other.request.post("/v1/auth/login", { data: { username: `dual_${suffix}`,
      password: "CorrectBatteryHorse123!" } });
    expect(login.status()).toBe(200);
    async function prepare(client: typeof page, name: string) {
      await client.goto("/settings");
      const row = client.getByRole("row").filter({ hasText: name });
      await row.getByRole("button", { name: "Bootstrap IndexedDB" }).click();
      await expect(client.getByText(/Permitted catalogue cached/)).toBeVisible();
      await client.evaluate(async () => { await navigator.serviceWorker.ready; });
      await client.reload();
      await client.context().setOffline(true);
      await client.goto("/sales/new");
      await expect(client.getByText(/Using the last saved catalogue/)).toBeVisible();
      await client.getByRole("searchbox", { name: "Search item or barcode" }).fill("LAST-1");
      await client.getByRole("button", { name: /Last bottle/ }).click();
      await client.getByLabel("Cash applied").fill("10.00");
      await client.getByLabel("Cash tendered").fill("10.00");
      await client.getByLabel("Cash account").selectOption((await cash.json()).id);
      await client.getByRole("button", { name: "Save offline cash bill" }).click();
      await expect(client.getByText(/Saved: D\d+-O-000001/)).toBeVisible();
      await client.reload();
      await expect(client.getByText(/1 issued bill\(s\) saved on this device/)).toBeVisible();
    }
    await prepare(page, "First counter");
    await prepare(other, "Second counter");
    await Promise.all([page.context().setOffline(false), otherContext.setOffline(false)]);
    await Promise.all([page.evaluate(() => window.dispatchEvent(new Event("online"))),
      other.evaluate(() => window.dispatchEvent(new Event("online")))]);
    await expect(page.getByText(/1 issued bill\(s\) saved on this device/)).toHaveCount(0, { timeout: 30000 });
    await expect(other.getByText(/1 issued bill\(s\) saved on this device/)).toHaveCount(0, { timeout: 30000 });
    const documents = await page.request.get("/v1/sales/documents?status=Posted");
    expect(documents.status()).toBe(200);
    const numbers = (await documents.json()).rows.map((row: { number: string }) => row.number);
    expect(numbers).toContain(`${(await firstDevice.json()).numberPrefix}-O-000001`);
    expect(numbers).toContain(`${(await secondDevice.json()).numberPrefix}-O-000001`);
    const firstNumber = `${(await firstDevice.json()).numberPrefix}-O-000001`;
    const secondNumber = `${(await secondDevice.json()).numberPrefix}-O-000001`;
    for (const client of [page, other]) {
      await expect.poll(() => client.evaluate(async () => {
        const binding = JSON.parse(localStorage.getItem("bms_last_bootstrap") ?? "null") as {
          userId: string; businessId: string; enrollmentId: string; datasetEpoch: number } | null;
        if (!binding) throw new Error("Missing verified local partition");
        const name = `bms_${binding.userId}_${binding.businessId}_${binding.enrollmentId}_ep${binding.datasetEpoch}`;
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const rows = await new Promise<Array<{ group: string; row: { number?: string } }>>((resolve, reject) => {
            const request = database.transaction("catalogue").objectStore("catalogue").getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          return rows.filter((row) => row.group === "sale").map((row) => row.row.number);
        } finally { database.close(); }
      }), { timeout: 60_000 }).toEqual(expect.arrayContaining([firstNumber, secondNumber]));
    }
  } finally { await otherContext.close(); }
});

test("M06 cached cash bill survives an offline browser reopen and syncs its original number", async ({ page }, testInfo) => {
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
  await page.screenshot({ path: testInfo.outputPath("offline-saved-bill.png"), fullPage: true });
  await page.reload();
  await expect(page.getByText(/1 issued bill\(s\) saved on this device/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("offline-reopened-queue.png"), fullPage: true });
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/1 issued bill\(s\) saved on this device/)).toHaveCount(0, { timeout: 30000 });
  const documents = await page.request.get("/v1/sales/documents?status=Posted");
  expect(documents.status()).toBe(200);
  const expectedNumber = `${(await device.json()).numberPrefix}-O-000001`;
  expect((await documents.json()).rows.filter((row: { number: string }) => row.number === expectedNumber)).toHaveLength(1);
});

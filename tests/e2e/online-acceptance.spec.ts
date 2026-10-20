import { test, expect } from "./fixtures";

test("a lost posting response retries one cloud sale and a second browser sees it", async ({ page, browser }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const username = `online_retry_${suffix}`;
  const password = "CorrectBatteryHorse123!";
  const registered = await page.request.post("/v1/auth/register", { data: {
    username, password, fullName: "Owner", businessName: `Online retry ${suffix}`,
  } });
  expect(registered.status()).toBe(201);
  const csrf = (await registered.json()).csrfToken as string;
  const post = (path: string, data: object = {}) => page.request.post(path, {
    data, headers: { "x-csrf-token": csrf },
  });
  expect((await post("/v1/accounts/system")).status()).toBe(200);
  const cash = await post("/v1/accounts", { code: "TILL", name: "Till", kind: "Cash" });
  const item = await post("/v1/catalogue/items", { name: "Consultation", kind: "Service",
    sku: "CONSULT", barcode: null, salePrice: "3.00", categoryId: null, baseUnitId: null, taxProfileId: null });
  const locationId = (await (await page.request.get("/v1/locations")).json())[0].id;
  const device = await post("/v1/devices/enroll", { deviceName: "Counter", locationId });
  for (const response of [cash, item, device]) expect(response.status()).toBe(201);

  const second = await browser.newContext();
  try {
    const login = await second.request.post("/v1/auth/login", { data: { username, password } });
    expect(login.status()).toBe(200);
    const otherPage = await second.newPage();
    await otherPage.goto("/sales");
    await expect(otherPage.getByText("No matching sales")).toBeVisible();

    await page.goto("/sales/new");
    await page.getByRole("searchbox", { name: "Search item or barcode" }).fill("Consultation");
    await page.getByRole("button", { name: /Consultation/ }).click();
    await page.getByLabel("Cash applied").fill("3.00");
    await page.getByLabel("Cash tendered").fill("3.00");
    await page.getByLabel("Cash account").selectOption((await cash.json()).id);
    let committedResponse = false;
    await page.route("**/v1/sales/*/post", async (route) => {
      const response = await route.fetch();
      committedResponse = response.status() === 200;
      await route.abort("failed"); // The server committed, but this browser never received the receipt.
    });
    await page.getByRole("button", { name: "Save & issue sale" }).click();
    await expect.poll(async () =>
      await page.getByRole("button", { name: "Retry saved sale" }).count() +
      await page.getByText(/Saved: D\d+-000001/).count()).toBeGreaterThan(0);
    expect(committedResponse).toBe(true);
    await page.unroute("**/v1/sales/*/post");
    if (await page.getByRole("button", { name: "Retry saved sale" }).count())
      await page.getByRole("button", { name: "Retry saved sale" }).click();
    await expect(page.getByText(/Saved: D\d+-000001/)).toBeVisible();
    const number = (await page.getByText(/Saved: D\d+-000001/).textContent())!.replace("Saved: ", "");

    await otherPage.reload();
    await expect(otherPage.getByRole("row", { name: new RegExp(number) })).toBeVisible();
    await otherPage.getByRole("row", { name: new RegExp(number) }).getByRole("button", { name: "Open" }).click();
    await expect(otherPage.getByRole("button", { name: "Print saved receipt" })).toBeVisible();
    await expect(otherPage.getByText("Consultation")).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Saved: ${number}`)).toBeVisible();

    await page.getByRole("button", { name: "New sale" }).click();
    await otherPage.goto("/sales/new");
    for (const active of [page, otherPage]) {
      await active.getByRole("searchbox", { name: "Search item or barcode" }).fill("Consultation");
      await active.getByRole("button", { name: /Consultation/ }).click();
      await active.getByLabel("Cash applied").fill("3.00");
      await active.getByLabel("Cash tendered").fill("3.00");
      await active.getByLabel("Cash account").selectOption((await cash.json()).id);
    }
    await Promise.all([page, otherPage].map((active) =>
      active.getByRole("button", { name: "Save & issue sale" }).click()));
    for (const active of [page, otherPage]) {
      await expect.poll(async () =>
        await active.getByRole("button", { name: "Retry saved sale" }).count() +
        await active.getByText(/Saved: D\d+-00000[23]/).count()).toBeGreaterThan(0);
      if (await active.getByRole("button", { name: "Retry saved sale" }).count()) {
        await expect(active.getByRole("alert")).toContainText("Business changed since calculation");
        await active.getByRole("button", { name: "Retry saved sale" }).click();
      }
    }
    await expect(page.getByText(/Saved: D\d+-00000[23]/)).toBeVisible();
    await expect(otherPage.getByText(/Saved: D\d+-00000[23]/)).toBeVisible();
    const concurrentNumbers = await Promise.all([page, otherPage].map(async (active) =>
      (await active.getByText(/Saved: D\d+-00000[23]/).textContent())!.replace("Saved: ", "")));
    expect(new Set(concurrentNumbers).size).toBe(2);
    expect(new Set([number, ...concurrentNumbers]).size).toBe(3);
  } finally { await second.close(); }
});

test("an old controlled browser retires its shell while preserving issued recovery", async ({ page }, testInfo) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const registered = await page.request.post("/v1/auth/register", { data: {
    username: `legacy_${suffix}`, password: "CorrectBatteryHorse123!",
    fullName: "Owner", businessName: `Legacy ${suffix}`,
  } });
  expect(registered.status()).toBe(201);
  const { user, business } = await registered.json() as { user: { id: string }; business: { id: string } };
  const enrollmentId = crypto.randomUUID();
  const commandId = crypto.randomUUID();
  const billId = crypto.randomUUID();
  const number = "D01-O-000001";
  const issuedAt = new Date().toISOString();
  const dbName = `bms_${user.id}_${business.id}_${enrollmentId}_ep1`;

  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/legacy-sw-test.js");
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.evaluate(async ({ dbName, userId, businessId, enrollmentId, commandId, billId, number, issuedAt }) => {
    const cache = await caches.open("bms-public-shell-legacy");
    await cache.put("/old-shell", new Response("old shell"));
    await new Promise<void>((resolve, reject) => {
      // Dexie maps schema version 3 to the IndexedDB version 30.
      const open = indexedDB.open(dbName, 30);
      open.onerror = () => reject(open.error);
      open.onupgradeneeded = () => {
        const db = open.result;
        const identity = db.createObjectStore("identity", { keyPath: "key" });
        const device = db.createObjectStore("device", { keyPath: "id" });
        device.createIndex("numberPrefix", "numberPrefix"); device.createIndex("status", "status");
        db.createObjectStore("locations", { keyPath: "id" }).createIndex("code", "code");
        const lease = db.createObjectStore("lease", { keyPath: "id" });
        lease.createIndex("deviceEnrollmentId", "deviceEnrollmentId");
        lease.createIndex("expiresAt", "expiresAt");
        db.createObjectStore("syncState", { keyPath: "key" });
        db.createObjectStore("catalogue", { keyPath: "key" }).createIndex("group", "group");
        const pending = db.createObjectStore("pending", { keyPath: "commandId" });
        pending.createIndex("state", "state");
        const issued = db.createObjectStore("issuedSales", { keyPath: "id" });
        issued.createIndex("commandId", "commandId", { unique: true });
        issued.createIndex("number", "number", { unique: true });
        identity.put({ key: "user", value: { id: userId } });
        identity.put({ key: "business", value: { id: businessId, datasetEpoch: 1 } });
        device.put({ id: enrollmentId, businessId, numberPrefix: "D01", status: "Enrolled" });
        const envelope = { schemaVersion: 1, calculationVersion: 1, datasetEpoch: 1,
          number, issuedAt, input: { id: billId, commandId, deviceEnrollmentId: enrollmentId } };
        pending.put({ commandId, state: "held", payload: envelope, reason: "Legacy cutover" });
        issued.put({ id: billId, commandId, number, issuedAt, snapshot: envelope });
      };
      open.onsuccess = () => { open.result.close(); resolve(); };
    });
  }, { dbName, userId: user.id, businessId: business.id, enrollmentId, commandId, billId, number, issuedAt });

  // Replace the old root-scope worker with the retiring release worker.
  await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js"); });
  await page.goto("/settings");
  await expect.poll(() => page.evaluate(async () => ({
    registration: Boolean(await navigator.serviceWorker.getRegistration()),
    cache: (await caches.keys()).includes("bms-public-shell-legacy"),
  }))).toEqual({ registration: false, cache: false });
  await expect(page.getByRole("region", { name: "Saved issued work" })).toContainText("1 bill(s)");
  await page.getByLabel("Recovery passphrase", { exact: true }).fill("long recovery passphrase");
  await page.getByLabel("Confirm passphrase").fill("long recovery passphrase");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download encrypted recovery" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await (await import("node:fs/promises")).readFile(path!);
  expect(bytes.toString()).not.toContain(number);
  await page.getByLabel("File passphrase").fill("long recovery passphrase");
  await page.getByRole("region", { name: "Inspect recovery file" }).locator('input[type="file"]')
    .setInputFiles({ name: "recovery.json",
    mimeType: "application/json", buffer: bytes });
  await expect(page.getByRole("region", { name: "Inspect recovery file" })).toContainText(number);
  await expect(page.getByRole("region", { name: "Inspect recovery file" })).toContainText("No commands were submitted");
  await page.screenshot({ path: testInfo.outputPath("legacy-recovery-1366.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("legacy-recovery-390.png"), fullPage: true });
  expect(await page.evaluate(async (name) => Boolean((await indexedDB.databases()).find((db) => db.name === name)), dbName)).toBe(true);
});

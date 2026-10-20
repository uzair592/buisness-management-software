import { test, expect } from "./fixtures";

test("owner posts a transfer and reloads both account books", async ({ page }, testInfo) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const registered = await page.request.post("/v1/auth/register", { data: {
    username: `transfer_${suffix}`, password: "CorrectBatteryHorse123!", fullName: "Owner", businessName: `Shop ${suffix}`,
  } });
  expect(registered.status()).toBe(201);
  const csrf = (await registered.json()).csrfToken as string;
  const post = (path: string, data: object) => page.request.post(path, { data, headers: { "x-csrf-token": csrf } });
  const cash = await post("/v1/accounts", { code: "TILL", name: "Till", kind: "Cash" });
  expect(cash.status()).toBe(201);
  expect((await post("/v1/accounts", { code: "BANK", name: "Bank", kind: "Bank" })).status()).toBe(201);
  expect((await post("/v1/accounts/system", {})).status()).toBe(200);
  const opening = { batchId: crypto.randomUUID(), businessDate: "2026-10-20", entries: [
    { kind: "Money", accountId: (await cash.json()).id, amount: "100.00" },
  ] };
  const preview = await post("/v1/opening/preview", opening);
  expect(preview.status()).toBe(200);
  expect((await post("/v1/opening/commit", { ...opening, expectedCursor: (await preview.json()).expectedCursor })).status()).toBe(201);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/cash-bank");
  await expect(page.getByRole("heading", { name: "Transfers & account books" })).toBeVisible();
  await page.getByLabel("From").selectOption({ label: "Till (Cash)" });
  await page.getByLabel("To").selectOption({ label: "Bank (Bank)" });
  await page.getByLabel("Value to move").fill("25.50");
  await page.getByLabel("Reference").fill("Daily deposit");
  let committedResponse = false;
  await page.route("**/v1/accounts/transfers", async (route) => {
    const response = await route.fetch();
    committedResponse = response.status() === 201;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Post transfer" }).click();
  await expect(page.getByRole("button", { name: "Retry saved transfer" })).toBeVisible();
  expect(committedResponse).toBe(true);
  await page.unroute("**/v1/accounts/transfers");
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry saved transfer" })).toBeVisible();
  await page.getByRole("button", { name: "Retry saved transfer" }).click();
  await expect(page.getByText("Transfer posted. Both account books now include it.")).toBeVisible();
  await page.getByLabel("Account book").selectOption({ label: "Bank" });
  await expect(page.getByText("Bank · balance 25.50")).toBeVisible();
  await expect(page.getByText(/Daily deposit · Till → Bank/)).toBeVisible();
  await page.reload();
  await page.getByLabel("Account book").selectOption({ label: "Till" });
  await expect(page.getByText("Till · balance 74.50")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("transfer-book-1366.png"), fullPage: true });
});

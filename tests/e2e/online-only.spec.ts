import { test, expect } from "./fixtures";

test("billing requires a server workspace and offers no offline issue", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const registration = await page.request.post("/v1/auth/register", { data: {
    username: `online_${suffix}`, password: "CorrectBatteryHorse123!",
    fullName: "Owner", businessName: `Online ${suffix}`,
  } });
  expect(registration.status()).toBe(201);
  await page.goto("/sales/new");
  await expect(page.getByRole("heading", { name: "New sale" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save offline cash bill" })).toHaveCount(0);
  await page.context().setOffline(true);
  await expect(page.getByText(/Connection lost. New bills cannot be issued/)).toBeVisible();
  await page.context().setOffline(false);

  await page.route("**/v1/sales/workspace", (route) => route.abort());
  await page.reload();
  await expect(page.getByText(/Billing requires a connection to the server/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save & issue sale" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save offline cash bill" })).toHaveCount(0);
});

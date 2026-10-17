import { test, expect } from "./fixtures";

test("M04 owner can create and reload parties and services at desktop and mobile widths", async ({ page }) => {
  const unique = Date.now().toString().slice(-8);
  const response = await page.request.post("/v1/auth/register", { data: {
    username: `catalogue_${unique}`, password: "SafePassword123!",
    fullName: "Catalogue Owner", businessName: `Catalogue ${unique}`,
  } });
  expect(response.status()).toBe(201);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/parties");
  await expect(page.getByRole("heading", { name: "Parties", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add party" }).click();
  await page.getByRole("dialog", { name: "Add party" }).getByLabel("Name").fill("Apex Traders");
  await page.getByRole("dialog", { name: "Add party" }).getByLabel("Supplier").check();
  await page.getByRole("dialog", { name: "Add party" }).getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Apex Traders")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Apex Traders")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/items");
  await expect(page.getByRole("heading", { name: "Items & services" })).toBeVisible();
  await page.getByRole("button", { name: "Add item" }).click();
  const dialog = page.getByRole("dialog", { name: "Add item" });
  await dialog.getByLabel("Name").fill("Installation service");
  await dialog.getByLabel("Sale price").fill("125.00");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Installation service")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Installation service")).toBeVisible();
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1);
});

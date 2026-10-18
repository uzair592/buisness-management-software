import { test, expect } from "./fixtures";

test("M04 owner can create and reload parties, services and opening at desktop and mobile widths", async ({ page }, testInfo) => {
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

  await page.goto("/cash-bank");
  await expect(page.getByRole("heading", { name: "Accounts & opening" })).toBeVisible();
  await page.getByLabel("Code").fill("TILL");
  await page.getByLabel("Name", { exact: true }).fill("Front till");
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByRole("cell", { name: "Front till" })).toBeVisible();
  await page.getByRole("button", { name: "Initialize posting accounts" }).click();
  await page.locator(".account-opening-row select").nth(1).selectOption({ label: "Front till" });
  await page.getByLabel("Amount").fill("100.00");
  await page.getByRole("button", { name: "Preview opening" }).click();
  await expect(page.getByRole("heading", { name: "Review before posting" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Post opening batch" }).click();
  await expect(page.getByText("Opening batch recorded.", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("cell", { name: "Front till" })).toBeVisible();
  await expect(page.getByText("Opening batch recorded.", { exact: false })).toBeVisible();
  const accountWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(accountWidth.scroll).toBeLessThanOrEqual(accountWidth.viewport + 1);
  await page.screenshot({ path: testInfo.outputPath("account-setup-mobile.png"), fullPage: true });
});

test("M04 setup and opening search reach goods beyond the first page", async ({ page }, testInfo) => {
  const unique = crypto.randomUUID().slice(0, 8);
  const registration = await page.request.post("/v1/auth/register", { data: {
    username: `setup_${unique}`, password: "SafePassword123!", fullName: "Setup Owner", businessName: `Setup ${unique}`,
  } });
  expect(registration.status()).toBe(201);
  const csrf = (await registration.json()).csrfToken as string;
  const post = (path: string, data: object) => page.request.post(path, { data, headers: { "x-csrf-token": csrf } });
  const each = await post("/v1/catalogue/units", { code: "EA", name: "Each" });
  expect(each.status()).toBe(201);
  const box = await post("/v1/catalogue/units", { code: "BOX", name: "Box" });
  expect(box.status()).toBe(201);
  let lastId = "";
  for (let index = 0; index < 27; index++) {
    const item = await post("/v1/catalogue/items", { name: `Opening good ${String(index).padStart(2, "0")}`,
      kind: "Goods", baseUnitId: (await each.json()).id, sku: `GOOD-${index}`, salePrice: "12.00" });
    expect(item.status()).toBe(201);
    lastId = (await item.json()).id;
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/items");
  await page.getByLabel("New category").fill("Retail");
  await page.getByRole("button", { name: "Add category" }).click();
  await page.getByLabel("Tax profile").fill("General 5");
  await page.getByLabel("Rate (%)").fill("5.0000");
  await page.getByRole("button", { name: "Add tax profile" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Opening good 26")).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).nth(1).click();
  const dialog = page.getByRole("dialog", { name: "Edit item" });
  await dialog.getByLabel("Alternate unit").selectOption((await box.json()).id);
  await dialog.getByLabel("Units per base").fill("12");
  await dialog.getByRole("button", { name: "Add conversion" }).click();
  await expect(dialog.getByText("Box: 1 = 12 base units")).toBeVisible();
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByLabel("Base units per alternate").fill("24");
  await dialog.getByRole("button", { name: "Save conversion" }).click();
  await expect(dialog.getByText("Box: 1 = 24 base units")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).last().click();
  const taxEditor = page.getByRole("dialog", { name: "Edit tax-profiles" });
  await taxEditor.getByLabel("Rate (%)").fill("6.0000");
  await taxEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("General 5 · 6% Exclusive")).toBeVisible();
  await page.goto("/cash-bank");
  await page.locator(".account-opening-row select").first().selectOption("Stock");
  await page.getByRole("searchbox", { name: "Search items" }).fill("Opening good 26");
  await page.locator(".account-opening-row select").nth(1).selectOption(lastId);
  await expect(page.locator(".account-opening-row select").nth(1)).toHaveValue(lastId);
  await page.screenshot({ path: testInfo.outputPath("opening-search-desktop.png"), fullPage: true });
});

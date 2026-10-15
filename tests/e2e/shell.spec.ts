import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const evidence = "docs/evidence/m01-ui-refinement";
async function screenshot(
  page: Page,
  name: string,
  width: number,
  height: number,
) {
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: `${evidence}/${name}-${width}x${height}.png`,
    animations: "disabled",
  });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
for (const [width, height] of [
  [1366, 768],
  [1920, 1080],
  [390, 844],
]) {
  test(`operational navigation, focus and empty screenshots ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Sample data — changes reset")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Preview: available functionality" }),
    ).toHaveCount(1);
    await screenshot(page, "operational-home", width, height);
    await page
      .getByRole("button", { name: "Preview: available functionality" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "About this preview" }),
    ).toContainText("not available yet");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Preview: available functionality" }),
    ).toBeFocused();
    await page.getByRole("link", { name: "＋ New Sale", exact: true }).click();
    await expect(page.getByLabel("Item search or barcode")).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Save invoice", exact: true }),
    ).toBeDisabled();
    await noOverflow(page);
    await screenshot(page, "operational-sale", width, height);
    if (width < 1024) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(
        page.getByRole("button", { name: "Close navigation" }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Open navigation" }),
      ).toBeFocused();
    } else {
      await page.getByRole("button", { name: "Collapse navigation" }).click();
      await page.getByRole("button", { name: "Expand navigation" }).click();
    }
    for (const name of [
      "Home",
      "Sales",
      "Purchases",
      "Parties",
      "Items & Stock",
      "Cash & Bank",
      "Expenses",
      "Reports",
      "Settings",
      "Sync & Backup",
    ]) {
      if (width < 1024)
        await page.getByRole("button", { name: "Open navigation" }).click();
      const navigation =
        width < 1024
          ? page
              .getByRole("dialog", { name: "Navigation" })
              .getByRole("navigation")
          : page.locator(".desktop-sidebar").getByRole("navigation");
      await navigation.getByRole("link", { name, exact: true }).click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      if (width >= 1024)
        await expect(
          navigation.getByRole("link", { name, exact: true }),
        ).toHaveAttribute("aria-current", "page");
      await noOverflow(page);
    }
  });
  test(`sample dashboard, cart, dialogs and isolation ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const postingRequests: string[] = [];
    const errors: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() !== "GET" ||
        new URL(request.url()).pathname.startsWith("/v1/")
      )
        postingRequests.push(request.method() + " " + request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page
      .getByRole("button", { name: "Try sample workspace", exact: true })
      .click();
    await expect(page.getByText("Sample data — changes reset")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View Sales", exact: true }),
    ).toContainText("PKR 1,772.50");
    await expect(
      page.getByRole("link", { name: "View Receivables", exact: true }),
    ).toContainText("PKR 487.00");
    await expect(
      page.getByRole("link", { name: "View Payables", exact: true }),
    ).toContainText("PKR 1,673.00");
    await noOverflow(page);
    await screenshot(page, "sample-home", width, height);
    await page
      .getByRole("link", { name: "View Low stock", exact: true })
      .click();
    await expect(
      page.getByRole("checkbox", { name: "Low stock only" }),
    ).toBeChecked();
    await expect(page.getByRole("row")).toHaveCount(4);
    await page.getByLabel("Search items").fill("8901001");
    await expect(page.getByRole("row")).toHaveCount(2);
    await page.keyboard.press("Control+k");
    await page.getByLabel("Search commands").fill("Home");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "View Payables", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Purchases", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Transaction status")).toHaveValue("Due");
    await expect(
      page.getByRole("button", { name: "View Sample P-0216" }),
    ).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByLabel("Search commands").fill("Home");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Date range").selectOption("all");
    await expect(
      page.getByRole("link", { name: "View Sales", exact: true }),
    ).toContainText("PKR 4,886.50");
    await expect(
      page.getByText("8 transactions", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Date range").selectOption("week");
    await expect(
      page.getByRole("link", { name: "View Sales", exact: true }),
    ).toContainText("PKR 3,995.50");
    await page.getByLabel("Search transactions").fill("Bilal");
    await page.getByLabel("Transaction status").selectOption("Paid");
    await expect(
      page.getByRole("heading", { name: "No matching transactions" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reset filters" }).click();
    await page.getByLabel("Search transactions").fill("Ayesha");
    await page.getByLabel("Transaction status").selectOption("Due");
    await page.getByRole("button", { name: "View Sample S-1045" }).click();
    await expect(
      page.getByRole("dialog", { name: "Sample S-1045" }),
    ).toContainText("PKR 960.00");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "View Sample S-1045" }),
    ).toBeFocused();
    await expect(page.getByLabel("Search transactions")).toHaveValue("Ayesha");
    await expect(page.getByLabel("Transaction status")).toHaveValue("Due");
    await page
      .getByRole("link", { name: "View Receivables", exact: true })
      .click();
    await expect(page).toHaveURL(/sales\?status=Due/);
    await expect(
      page.getByRole("heading", { name: "Sales", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByLabel("Search commands")).toBeFocused();
    await page.getByLabel("Search commands").fill("New Sale");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "New Sale", exact: true }),
    ).toBeVisible();
    const search = page.getByLabel("Item search or barcode");
    await expect(search).toBeFocused();
    await search.fill("unlisted item");
    await expect(
      page.getByRole("status").filter({ hasText: "No matching sample items" }),
    ).toBeVisible();
    await search.press("Escape");
    await search.fill("8901003");
    await page.getByRole("option").filter({ hasText: "A5 notebook" }).click();
    await expect(search).toBeFocused();
    await search.fill("tea");
    await search.press("ArrowDown");
    await search.press("Enter");
    const quantity = page.getByLabel("Quantity for A5 notebook", {
      exact: true,
    });
    await quantity.fill("2");
    await expect(page.getByTestId("cart-total")).toHaveText("PKR 816.50");
    await quantity.fill("0");
    await expect(
      page.getByRole("button", { name: "Preview sample receipt", exact: true }),
    ).toBeDisabled();
    await expect(quantity).toHaveAttribute("aria-invalid", "true");
    await quantity.fill("0.1");
    await expect(page.getByTestId("cart-total")).toHaveText("PKR 464.05");
    await quantity.fill("3");
    await expect(page.getByTestId("cart-total")).toHaveText("PKR 1,002.00");
    if (width < 680)
      await page.getByRole("button", { name: /Customer details/ }).click();
    await page.getByLabel("Customer", { exact: true }).selectOption("ayesha");
    if (width < 680)
      await page.getByRole("button", { name: /Customer details/ }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await noOverflow(page);
    await screenshot(page, "sample-sale", width, height);
    const receipt = page.getByRole("button", {
      name: "Preview sample receipt",
      exact: true,
    });
    await receipt.scrollIntoViewIfNeeded();
    await expect(receipt).toBeInViewport();
    await receipt.click();
    await expect(
      page.getByRole("dialog", { name: "Sample receipt" }),
    ).toContainText("Ayesha Khan");
    await expect(
      page.getByRole("dialog", { name: "Sample receipt" }),
    ).toContainText("PKR 1,002.00");
    await expect(
      page.getByRole("dialog", { name: "Sample receipt" }),
    ).toContainText("Nothing is saved");
    await page.keyboard.press("Shift+Tab");
    expect(
      await page
        .getByRole("dialog", { name: "Sample receipt" })
        .evaluate((dialog) => dialog.contains(document.activeElement)),
    ).toBe(true);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Close Sample receipt", exact: true }),
    ).toBeFocused();
    if (width === 1366) await screenshot(page, "sample-receipt", width, height);
    await page.keyboard.press("Escape");
    await expect(receipt).toBeFocused();
    await page
      .getByRole("button", { name: "Remove Classic tea · 250 g" })
      .click();
    await expect(search).toBeFocused();
    await expect(page.getByTestId("cart-total")).toHaveText("PKR 556.50");
    await page.getByRole("button", { name: "Clear cart", exact: true }).click();
    await expect(page.getByRole("button", { name: "Keep cart" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Clear cart", exact: true }),
    ).toBeFocused();
    await expect(quantity).toHaveValue("3");
    await page.getByRole("button", { name: "Clear cart", exact: true }).click();
    await page
      .getByRole("button", { name: "Clear sample cart", exact: true })
      .click();
    await expect(search).toBeFocused();
    await expect(page.getByTestId("cart-total")).toHaveText("PKR 0.00");
    await page.getByRole("button", { name: "Exit sample workspace" }).click();
    await expect(page.getByText("Sample data — changes reset")).toHaveCount(0);
    await expect(page.getByText("Sample S-1048")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "View Sales", exact: true }),
    ).toContainText("—");
    await page
      .getByRole("button", { name: "Try sample workspace", exact: true })
      .click();
    await page.getByRole("link", { name: "＋ New Sale", exact: true }).click();
    await expect(page.getByTestId("cart-total")).toHaveText("PKR 0.00");
    if (width < 680)
      await page.getByRole("button", { name: /Customer details/ }).click();
    await expect(page.getByLabel("Customer", { exact: true })).toHaveValue(
      "walk-in",
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Save invoice", exact: true }),
    ).toBeDisabled();
    await expect(page.getByText("Sample data — changes reset")).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
      })),
    ).toEqual({ local: 0, session: 0 });
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).length),
    ).toBe(0);
    expect(postingRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
test("sample sessions are independent across browser tabs and command Escape restores focus", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try sample workspace" }).click();
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByText("Sample data — changes reset")).toHaveCount(0);
  await other.getByRole("button", { name: "Search pages and actions" }).click();
  await expect(other.getByLabel("Search commands")).toBeFocused();
  await other.keyboard.press("Escape");
  await expect(
    other.getByRole("button", { name: "Search pages and actions" }),
  ).toBeFocused();
  await other.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await other
      .locator(".sidebar-link")
      .first()
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe("0s");
  await other.close();
});

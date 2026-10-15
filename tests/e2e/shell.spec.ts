import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
for (const [width, height] of [
  [1366, 768],
  [1920, 1080],
  [390, 844],
]) {
  test(`navigation, sale focus and layout at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
    await mkdir("docs/evidence/m01", { recursive: true });
    await page.screenshot({
      path: `docs/evidence/m01/home-${width}x${height}.png`,
      fullPage: false,
      animations: "disabled",
    });
    await page.getByRole("link", { name: "＋ New Sale", exact: true }).click();
    await expect(page.getByLabel("Item search or barcode")).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Save & print · M05" }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/evidence/m01/sale-${width}x${height}.png`,
      fullPage: false,
      animations: "disabled",
    });
    if (width < 1024) {
      const cart = await page.locator(".mobile-cart h2").boundingBox();
      const summary = await page.locator(".sale-summary").boundingBox();
      expect(cart && summary && cart.y + cart.height <= summary.y).toBeTruthy();
      await expect(page.locator("#payment-details")).toBeHidden();
      await page.getByRole("button", { name: "Payment details +" }).click();
      await expect(page.locator("#payment-details")).toBeVisible();
      await page.getByRole("button", { name: "Payment details −" }).click();
      await page
        .getByRole("button", { name: "Walk-in customer · Optional details" })
        .click();
      await expect(page.getByLabel("Customer", { exact: true })).toBeVisible();
      await page
        .getByRole("button", { name: "Walk-in customer · Optional details" })
        .click();
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
          ? page.getByRole("dialog").getByRole("navigation")
          : page.locator(".desktop-sidebar").getByRole("navigation");
      await navigation.getByRole("link", { name, exact: true }).click();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

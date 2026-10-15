import { test, expect } from "./fixtures";

for (const [width, height] of [
  [1366, 768],
  [1920, 1080],
  [390, 844],
]) {
  test(`transaction filters compose after reset ${width}x${height}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await page.goto("/home");
    await page
      .getByRole("button", { name: "Try sample workspace", exact: true })
      .click();
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.getByLabel("Date range").selectOption("week");
      await page.getByLabel("Search transactions").fill("Bilal");
      await page.getByLabel("Transaction status").selectOption("Paid");
      await expect(
        page.getByRole("heading", { name: "No matching transactions" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Reset filters" }).click();
      await page.getByLabel("Search transactions").fill("Ayesha");
      await page.getByLabel("Transaction status").selectOption("Due");
      await expect(page).toHaveURL(/\?period=all&q=Ayesha&status=Due$/);
      await expect(page.getByLabel("Date range")).toHaveValue("all");
      await expect(page.getByLabel("Search transactions")).toHaveValue(
        "Ayesha",
      );
      await expect(page.getByLabel("Transaction status")).toHaveValue("Due");
      await expect(page.getByRole("row")).toHaveCount(2);
      await page.getByRole("button", { name: "View Sample S-1045" }).click();
      await expect(
        page.getByRole("dialog", { name: "Sample S-1045" }),
      ).toContainText("PKR 960.00");
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "View Sample S-1045" }),
      ).toBeFocused();
      await expect(page).toHaveURL(/\?period=all&q=Ayesha&status=Due$/);
    }
    // Deliver consecutive native changes in one task so a deferred router render
    // cannot finish between handlers. This exposes stale URL snapshots reliably.
    await page.getByLabel("Search transactions").fill("");
    await expect(page.getByLabel("Search transactions")).toHaveValue("");
    await page.getByLabel("Transaction status").selectOption("All");
    await expect(page.getByLabel("Transaction status")).toHaveValue("All");
    await page.getByLabel("Date range").selectOption("day");
    await expect(page.getByLabel("Date range")).toHaveValue("day");
    await page.evaluate(() => {
      const period = document.querySelector<HTMLSelectElement>(
        'select[aria-label="Date range"]',
      )!;
      period.value = "all";
      period.dispatchEvent(new Event("change", { bubbles: true }));
      const input = document.querySelector<HTMLInputElement>(
        'input[type="search"]',
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Ayesha");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const status = document.querySelector<HTMLSelectElement>(
        'select[aria-label="Transaction status"]',
      )!;
      status.value = "Due";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page).toHaveURL(/\?period=all&q=Ayesha&status=Due$/);
    await expect(page.getByRole("row")).toHaveCount(2);
    await page.getByRole("button", { name: "View Sample S-1045" }).click();
    await expect(
      page.getByRole("dialog", { name: "Sample S-1045" }),
    ).toContainText("PKR 960.00");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "View Sample S-1045" }),
    ).toBeFocused();
    await expect(page.getByLabel("Date range")).toHaveValue("all");
    await expect(page.getByLabel("Search transactions")).toHaveValue("Ayesha");
    await expect(page.getByLabel("Transaction status")).toHaveValue("Due");
    await page.screenshot({
      path: `docs/evidence/m01-ui-refinement/filtered-transactions-${width}x${height}.png`,
    });
    await page.goBack();
    await expect(page.getByLabel("Date range")).toHaveValue("day");
    await expect(page.getByLabel("Search transactions")).toHaveValue("");
    await expect(page.getByLabel("Transaction status")).toHaveValue("All");
    await page.goForward();
    await expect(page).toHaveURL(/\?period=all&q=Ayesha&status=Due$/);
    await expect(
      page.getByRole("button", { name: "View Sample S-1045" }),
    ).toBeVisible();
  });
}

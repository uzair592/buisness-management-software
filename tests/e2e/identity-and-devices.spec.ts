import { mkdir } from "node:fs/promises";
import { test, expect } from "./fixtures";

const evidenceDir = "docs/evidence/m02";

test.describe("M02 Identity, Authentication, and Settings UI", () => {
  test("renders sign in and owner registration tabs without leakages", async ({ page }) => {
    await mkdir(evidenceDir, { recursive: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/settings");

    // Must show Settings heading
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    // Verify Sign In tab is active by default
    await expect(page.getByRole("button", { name: "Sign In" }).first()).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByText("Global unique username (not email)")).toBeVisible();

    await page.screenshot({
      path: `${evidenceDir}/settings-signin-1366x768.png`,
      animations: "disabled",
    });

    // Switch to Register Owner Account tab
    await page.getByRole("button", { name: "Register Owner Account" }).click();

    // Verify Owner Registration fields
    await expect(page.getByLabel("Full Name *")).toBeVisible();
    await expect(page.getByLabel("Username *")).toBeVisible();
    await expect(page.getByLabel("Password * (min 8 chars)")).toBeVisible();
    await expect(page.getByLabel("Business Name *")).toBeVisible();
    await expect(page.getByLabel("Currency")).toBeVisible();
    await expect(page.getByLabel("Recovery Email (Optional)")).toBeVisible();
    await expect(
      page.getByText("Used for optional owner recovery, not required for login"),
    ).toBeVisible();

    // Verify Register button
    await expect(
      page.getByRole("button", { name: "Create Owner Account", exact: true }),
    ).toBeVisible();

    await page.screenshot({
      path: `${evidenceDir}/settings-register-1366x768.png`,
      animations: "disabled",
    });

    // Switch back to Sign In tab
    await page.getByRole("button", { name: "Sign In" }).first().click();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("header displays connection status and login link when unauthenticated", async ({ page }) => {
    await page.goto("/home");

    // Header shows no business connected indicator
    await expect(page.getByText("No business connected")).toBeVisible();

    // Header has Sign In link pointing to /settings
    const signInLink = page.getByRole("link", { name: "Sign in to account" });
    await expect(signInLink).toBeVisible();
    await signInLink.click();

    await expect(page).toHaveURL("http://127.0.0.1:5173/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  });
});

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

  test("completes real browser owner registration, reload persistence, device bootstrap, password change, logout and login", async ({
    page,
  }) => {
    const timestamp = Date.now().toString().slice(-6);
    const ownerUsername = `e2e_owner_${timestamp}`;
    const initialPassword = "InitialPassword123!";
    const newPassword = "UpdatedPassword123!";
    const businessName = `Apex Hardware ${timestamp}`;

    // 1. Navigate to Settings and switch to Register tab
    await page.goto("/settings");
    await page.getByRole("button", { name: "Register Owner Account" }).click();

    // 2. Fill owner registration form
    await page.getByLabel("Full Name *").fill("Apex Owner User");
    await page.getByLabel("Username *").fill(ownerUsername);
    await page.getByLabel("Password * (min 8 chars)").fill(initialPassword);
    await page.getByLabel("Business Name *").fill(businessName);
    await page.getByLabel("Recovery Email (Optional)").fill(`owner_${timestamp}@example.com`);

    // 3. Submit registration
    await page.getByRole("button", { name: "Create Owner Account" }).click();

    // 4. Verify authenticated state
    await expect(page.getByRole("button", { name: "Log Out" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Apex Owner User")).toBeVisible();
    await expect(page.getByText(businessName).first()).toBeVisible();

    // 5. Verify session persistence after full browser reload
    await page.reload();
    await expect(page.getByRole("button", { name: "Log Out" })).toBeVisible();
    await expect(page.getByText("Apex Owner User")).toBeVisible();

    // 6. Enroll a device and verify deliberate binding & local bootstrap
    await expect(page.locator("#new-device-loc option").first()).toBeAttached({ timeout: 10000 });
    await page.getByLabel("Device Name *").fill("Front Counter POS");
    await page.getByRole("button", { name: "Enroll Device" }).click();

    // Verify enrolled device appears and shows bound browser status
    await expect(page.getByText("Front Counter POS")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Bound Browser")).toBeVisible();

    // Trigger local IndexedDB bootstrap
    await page.getByRole("button", { name: "Bootstrap IndexedDB" }).first().click();
    await expect(
      page.getByText("Permitted catalogue cached. Online billing remains required while offline issue is under development."),
    ).toBeVisible({ timeout: 10000 });

    // 7. Change password
    await page.getByLabel("Current Password *").fill(initialPassword);
    await page.getByLabel("New Password * (min 8 chars)").fill(newPassword);
    await page.getByRole("button", { name: "Update Password" }).click();
    await expect(page.getByText("Password updated successfully.")).toBeVisible({ timeout: 10000 });

    // 8. Log out
    await page.getByRole("button", { name: "Log Out" }).click();

    // Verify unauthenticated state in header and form
    await expect(page.getByText("No business connected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" }).first()).toBeVisible();

    // Reload page: ensure unauthenticated state persists
    await page.reload();
    await expect(page.getByText("No business connected")).toBeVisible();

    // 9. Log in with the new password
    await page.getByLabel("Username").fill(ownerUsername);
    await page.getByLabel("Password").fill(newPassword);
    await page.locator('form button[type="submit"]').filter({ hasText: "Sign In" }).click();

    // Verify restored session
    await expect(page.getByRole("button", { name: "Log Out" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Apex Owner User")).toBeVisible();
  });
});

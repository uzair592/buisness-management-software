import { test, expect } from "./fixtures";
import fs from "node:fs/promises";
import path from "node:path";

test("owner exports encrypted backup archives, validates CSV dry-run with row errors, and commits batch imports", async ({
  page,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const username = `bkp_owner_${suffix}`;
  const password = "CorrectBatteryHorse123!";
  const businessName = `Metro Traders Hub ${suffix}`;

  const evidenceDir = path.resolve("docs/evidence/m11");
  await fs.mkdir(evidenceDir, { recursive: true });

  // 1. Register owner
  const registered = await page.request.post("/v1/auth/register", {
    data: {
      username,
      password,
      fullName: "Haris Farooq",
      businessName,
      currency: "PKR",
    },
  });
  expect(registered.status()).toBe(201);
  const regJson = await registered.json();
  const csrf = regJson.csrfToken as string;
  const post = (p: string, d: object) =>
    page.request.post(p, { data: d, headers: { "x-csrf-token": csrf } });

  // 2. Setup system accounts and basic unit
  expect((await post("/v1/accounts/system", {})).status()).toBe(200);
  const unitRes = await post("/v1/catalogue/units", { code: "PCS", name: "Pieces" });
  expect(unitRes.status()).toBe(201);

  // 3. Navigate directly to Settings page
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

  // 5. Test Encrypted Backup Archive Export
  const passphraseInput = page.getByPlaceholder("Choose a strong passphrase");
  await expect(passphraseInput).toBeVisible();
  await passphraseInput.fill("SecurePassphrase123!");

  const exportBtn = page.getByRole("button", { name: "Download Encrypted Backup (.bms.json)" });
  await expect(exportBtn).toBeEnabled();

  // Wait for the download event when clicking export
  const downloadPromise = page.waitForEvent("download");
  await exportBtn.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".bms.json");

  await page.screenshot({ path: path.join(evidenceDir, "01-backup-export-ui.png"), fullPage: true });

  // 6. Test CSV Dry-Run Validation with Errors
  const csvTextarea = page.locator("#csv-content-input");
  await expect(csvTextarea).toBeVisible();

  const invalidCsv = `Name,Price,SKU\n"Invalid Item 1",-15.00,SKU-ERR1\n"",25.00,SKU-NONAME`;
  await csvTextarea.fill(invalidCsv);

  const dryRunBtn = page.getByRole("button", { name: "Dry Run Validate" });
  await dryRunBtn.click();

  // Expect validation errors to appear in UI
  await expect(page.getByText("Validation Errors:")).toBeVisible();
  await expect(page.getByText("Invalid price")).toBeVisible();
  await expect(page.getByText("Item name is required")).toBeVisible();

  await page.screenshot({ path: path.join(evidenceDir, "02-csv-dry-run-validation-errors.png"), fullPage: true });

  // 7. Test CSV Dry-Run Valid Items and Commit
  const validCsv = `Name,Price,SKU,Barcode\n"Organic Ceylon Tea",450.00,SKU-TEA-01,890111\n"Cold Pressed Coconut Oil",850.00,SKU-OIL-02,890222`;
  await csvTextarea.fill(validCsv);
  await dryRunBtn.click();

  // Expect valid rows summary
  await expect(page.getByText("Valid: 2")).toBeVisible();
  await expect(page.getByText("Errors: 0")).toBeVisible();

  const commitBtn = page.getByRole("button", { name: "Commit 2 Records" });
  await expect(commitBtn).toBeVisible();
  await commitBtn.click();

  // Expect success banner
  await expect(page.getByText(/Successfully imported 2 items!/i)).toBeVisible();

  await page.screenshot({ path: path.join(evidenceDir, "03-csv-commit-success.png"), fullPage: true });

  // 8. Verify imported items appear in Catalogue
  await page.goto("/items");
  await expect(page.getByText("Organic Ceylon Tea")).toBeVisible();
  await expect(page.getByText("Cold Pressed Coconut Oil")).toBeVisible();
});

import { test, expect } from "./fixtures";
import fs from "node:fs/promises";
import path from "node:path";

test("invoice templates, reprint snapshot fidelity, and responsive UX across 1366, 1920 and 390 viewports", async ({
  page,
}, testInfo) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const username = `ux_owner_${suffix}`;
  const password = "CorrectBatteryHorse123!";
  const businessName = `Apex Global Traders ${suffix}`;

  // 1. Register owner
  const registered = await page.request.post("/v1/auth/register", {
    data: {
      username,
      password,
      fullName: "Muhammad Uzair",
      businessName,
      currency: "PKR",
    },
  });
  expect(registered.status()).toBe(201);
  const regJson = await registered.json();
  const csrf = regJson.csrfToken as string;
  const post = (p: string, d: object) =>
    page.request.post(p, { data: d, headers: { "x-csrf-token": csrf } });

  // 2. Setup system accounts, cash till, bank account, and opening stock
  expect((await post("/v1/accounts/system", {})).status()).toBe(200);
  const cashRes = await post("/v1/accounts", { code: "TILL_01", name: "Front Cash Till", kind: "Cash" });
  expect(cashRes.status()).toBe(201);
  const cashAccountId = (await cashRes.json()).id;

  const unitRes = await post("/v1/catalogue/units", { code: "BAG", name: "Bag" });
  expect(unitRes.status()).toBe(201);
  const unitId = (await unitRes.json()).id;

  const itemRes = await post("/v1/catalogue/items", {
    name: "Super Kernel Premium Basmati Rice (50kg Bag)",
    kind: "Goods",
    sku: `RICE-${suffix}`,
    barcode: `8901234${suffix.slice(0, 5)}`,
    salePrice: "7500.00",
    baseUnitId: unitId,
  });
  expect(itemRes.status()).toBe(201);
  const itemId = (await itemRes.json()).id;

  const partyRes = await post("/v1/catalogue/parties", {
    name: "Haji Usman & Sons",
    isCustomer: true,
    isSupplier: false,
    phone: "+92 300 9876543",
  });
  expect(partyRes.status()).toBe(201);
  const partyId = (await partyRes.json()).id;

  const locRes = await page.request.get("/v1/locations");
  const locationId = (await locRes.json())[0].id;
  const devRes = await post("/v1/devices/enroll", { deviceName: "Counter POS", locationId });
  expect(devRes.status()).toBe(201);
  const deviceId = (await devRes.json()).id;

  // Opening stock so sale has valued stock
  const openingInput = {
    batchId: crypto.randomUUID(),
    businessDate: new Date().toISOString().slice(0, 10),
    entries: [
      { kind: "Money", accountId: cashAccountId, amount: "50000.00" },
      { kind: "Stock", itemId, locationId, quantity: "100.000000", value: "500000.00" },
    ],
  };
  const preview = await post("/v1/opening/preview", openingInput);
  expect(preview.status()).toBe(200);
  const commit = await post("/v1/opening/commit", {
    ...openingInput,
    expectedCursor: (await preview.json()).expectedCursor,
  });
  expect(commit.status()).toBe(201);

  // 3. Test Invoice Templates & Printing Configuration in Settings
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Invoice Templates & Printing" })).toBeVisible();

  // Test custom title and tax ID input
  const titleInput = page.getByPlaceholder("e.g. TAX INVOICE, CASH MEMO");
  await titleInput.fill("OFFICIAL TAX INVOICE");
  const taxInput = page.getByPlaceholder("e.g. NTN: 1234567-8");
  await taxInput.fill("NTN: 8877665-1");

  // Open Template Preview Modal
  await page.getByRole("button", { name: "Preview & Test Print" }).click();
  const previewModal = page.getByRole("dialog", { name: "Document print preview" });
  await expect(previewModal).toBeVisible();
  await expect(previewModal.getByText("Print Preview: INV-2026-00042")).toBeVisible();

  // Verify A4 Template rendering
  await expect(previewModal.getByText("OFFICIAL TAX INVOICE")).toBeVisible();
  await expect(previewModal.getByText("NTN: 8877665-1")).toBeVisible();
  await expect(previewModal.getByText("Basmati Super Kernel Aged Rice")).toBeVisible();
  await expect(previewModal.getByText("Authorized Signatory")).toBeVisible();

  // Take A4 template screenshot evidence
  const evidenceDir = path.resolve(process.cwd(), "docs/evidence/m10");
  await fs.mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, "rendered-a4-invoice.png"), fullPage: true });

  // Switch to 80mm Thermal template
  await previewModal.getByRole("button", { name: "80mm Thermal (POS)" }).click();
  await expect(previewModal.locator(".template-80mm-root")).toBeVisible();
  await expect(previewModal.locator(".template-80mm-root").getByText("||| | |||| || | || ||||")).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "rendered-80mm-thermal.png"), fullPage: true });

  // Switch to 58mm Thermal template
  await previewModal.getByRole("button", { name: "58mm Compact" }).click();
  await expect(previewModal.locator(".template-58mm-root")).toBeVisible();
  await expect(previewModal.locator(".template-58mm-root").getByText("|| | |||| || | ||")).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "rendered-58mm-thermal.png"), fullPage: true });

  // Test logo toggle
  await previewModal.getByRole("button", { name: "sm" }).click();
  await previewModal.getByRole("button", { name: "none" }).click();

  // Test print button accessibility
  await expect(previewModal.getByRole("button", { name: "Print saved receipt" })).toBeVisible();

  // Close preview modal via Esc key
  await page.keyboard.press("Escape");
  await expect(previewModal).not.toBeVisible();

  // 4. Test Live Sale, Saved Receipt & Snapshot Reprint Path (T20)
  await page.goto("/sales/new");
  await page.getByLabel("Device").selectOption(deviceId);
  await page.getByRole("searchbox", { name: "Search item or barcode" }).fill("Basmati Rice");
  await page.getByRole("button", { name: /Basmati Rice/ }).click();
  await page.getByLabel("Cash applied").fill("7500.00");
  await page.getByLabel("Cash tendered").fill("8000.00");
  await page.getByLabel("Cash account").selectOption(cashAccountId);

  await page.getByRole("button", { name: "Save & issue sale" }).click();
  await expect(page.getByText(/Saved: D\d+-000001/)).toBeVisible();
  const saleNumber = (await page.getByText(/Saved: D\d+-000001/).textContent())!.replace("Saved: ", "");

  // Go to Sales List and open receipt reprint
  await page.goto("/sales");
  await expect(page.getByText(saleNumber)).toBeVisible();
  await page.getByRole("row", { name: new RegExp(saleNumber) }).getByRole("button", { name: "Open" }).click();

  // Verify PrintDocumentModal opens with the saved snapshot
  const reprintModal = page.getByRole("dialog", { name: "Document print preview" });
  await expect(reprintModal).toBeVisible();
  await expect(reprintModal.getByText(`Print Preview: ${saleNumber}`)).toBeVisible();
  await expect(reprintModal.getByText("Reprint", { exact: true })).toBeVisible();

  // Switch to A4 to verify A4 reprint banner
  await reprintModal.getByRole("button", { name: "A4 Full Page" }).click();
  await expect(reprintModal.getByText("*** REPRINT / DUPLICATE COPY ***")).toBeVisible();
  await expect(reprintModal.getByText("Super Kernel Premium Basmati Rice")).toBeVisible();
  await expect(reprintModal.getByText("7500.00", { exact: false })).toBeVisible();

  // Close reprint modal
  await reprintModal.getByRole("button", { name: "Close" }).click();
  await expect(reprintModal).not.toBeVisible();

  // 5. Test Viewport Responsiveness across 1366 × 768, 1920 × 1080 and 390 × 844 (T19)
  // 1366 × 768
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/sales/new");
  await expect(page.locator(".live-billing-main")).toBeVisible();
  await expect(page.locator(".live-billing-summary")).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "viewport-1366x768-billing.png"), fullPage: true });

  // 1920 × 1080
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/sales");
  await expect(page.getByRole("heading", { name: "Sales", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "viewport-1920x1080-sales.png"), fullPage: true });

  // 390 × 844 (Mobile)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sales/new");
  // Check touch target heights on mobile inputs
  const qtyInput = page.getByLabel("Qty");
  if (await qtyInput.count() > 0) {
    const box = await qtyInput.first().boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(40);
  }
  // Mobile menu toggle
  const menuToggle = page.getByRole("button", { name: "Open navigation" });
  await expect(menuToggle).toBeVisible();
  await menuToggle.click();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click();

  // Settings on mobile
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "viewport-390x844-mobile-settings.png"), fullPage: true });
});

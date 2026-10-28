import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, Prisma, withTenantContext } from "../packages/db/src/index";

test("M07 purchase bill persists number, updates stock and moving average, balances journal, and protects against duplicate supplier reference", async (t) => {
  const adminUrl = process.env.DATABASE_URL ?? "postgresql://bms_local:bms_local@127.0.0.1:5432/bms";
  const runtimeUrl = new URL(adminUrl);
  runtimeUrl.username = process.env.BMS_RUNTIME_USER ?? "bms_runtime";
  runtimeUrl.password = process.env.BMS_RUNTIME_PASSWORD ?? "bms_runtime_pass_change_in_production";
  const db = createDatabase(runtimeUrl.toString());
  const app = createApp({ db });
  t.after(async () => {
    await app.close();
    await db.$disconnect();
  });

  const suffix = crypto.randomUUID().slice(0, 8);
  async function register(name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: `purch_${name}_${suffix}`,
        password: "CorrectBatteryHorse123!",
        fullName: "Owner",
        businessName: name,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    return {
      id: res.json().business.id as string,
      csrf: res.json().csrfToken as string,
      cookie: (res.headers["set-cookie"] as string[]).map((v) => v.split(";")[0]).join("; "),
    };
  }

  const owner = await register("PurchA");
  const other = await register("PurchB");

  const send = (actor: typeof owner, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { cookie: actor.cookie, "x-csrf-token": actor.csrf },
      ...(payload ? { payload } : {}),
    });

  // Setup system accounts & custom accounts
  const system = await send(owner, "POST", "/v1/accounts/system");
  assert.equal(system.statusCode, 200, system.body);

  const cash = await send(owner, "POST", "/v1/accounts", { code: "MAIN_CASH", name: "Main Cash", kind: "Cash" });
  const bank = await send(owner, "POST", "/v1/accounts", { code: "OPERATING_BANK", name: "Operating Bank", kind: "Bank" });
  const unit = await send(owner, "POST", "/v1/catalogue/units", { code: "BOX", name: "Box" });
  const tax = await send(owner, "POST", "/v1/catalogue/tax-profiles", { name: "Input Tax 10", rate: "10", mode: "Exclusive" });

  const goods = await send(owner, "POST", "/v1/catalogue/items", {
    name: "Widget",
    kind: "Goods",
    sku: "WIDGET",
    barcode: "112233",
    salePrice: "100.00",
    categoryId: null,
    baseUnitId: unit.json().id,
    taxProfileId: tax.json().id,
  });

  const supplier = await send(owner, "POST", "/v1/catalogue/parties", {
    name: "Apex Supplies Ltd",
    isCustomer: false,
    isSupplier: true,
    phone: "12345678",
    email: "orders@apex.test",
  });

  const location = (await send(owner, "GET", "/v1/locations")).json()[0].id as string;
  for (const response of [cash, bank, unit, tax, goods, supplier]) {
    assert.equal(response.statusCode, 201, response.body);
  }

  // 1. Check workspace endpoint
  const workspace = await send(owner, "GET", "/v1/purchases/workspace");
  assert.equal(workspace.statusCode, 200, workspace.body);
  assert.equal(workspace.json().parties.length, 1);
  assert.equal(workspace.json().parties[0].id, supplier.json().id);
  assert.equal(workspace.json().items.length, 1);

  // 2. Create purchase draft
  const draftPayload = {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    locationId: location,
    partyId: supplier.json().id,
    supplierInvoiceNumber: "APEX-2026-001",
    allowDuplicateSupplierReference: false,
    businessDate: "2026-10-21",
    documentDiscount: "0",
    lines: [
      {
        id: crypto.randomUUID(),
        itemId: goods.json().id,
        conversionId: null,
        taxProfileId: tax.json().id,
        quantity: "10",
        unitCost: "40.00", // 10 * 40 = 400.00 + 10% tax (40.00) = 440.00
        discount: "0",
      },
    ],
    payments: [
      {
        id: crypto.randomUUID(),
        accountId: cash.json().id,
        kind: "Cash",
        applied: "140.00",
        reference: null,
      },
      {
        id: crypto.randomUUID(),
        accountId: bank.json().id,
        kind: "Bank",
        applied: "100.00",
        reference: "CHQ-7788",
      },
    ],
  };

  const draftRes = await send(owner, "POST", "/v1/purchases/drafts", draftPayload);
  assert.equal(draftRes.statusCode, 201, draftRes.body);

  // Resume identical draft returns 201
  const draftResume = await send(owner, "POST", "/v1/purchases/drafts", draftPayload);
  assert.equal(draftResume.statusCode, 201, draftResume.body);

  // Altering draft content with same ID fails with 409
  const draftConflict = await send(owner, "POST", "/v1/purchases/drafts", {
    ...draftPayload,
    documentDiscount: "5.00",
  });
  assert.equal(draftConflict.statusCode, 409);

  // 3. Post the purchase bill (test idempotency under concurrent post)
  const submit = () => send(owner, "POST", `/v1/purchases/${draftPayload.id}/post`, { commandId: draftPayload.commandId });
  const [first, repeat] = await Promise.all([submit(), submit()]);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(repeat.statusCode, 200, repeat.body);
  assert.equal(first.json().number, repeat.json().number);
  assert.match(first.json().number, /^PB-000001$/);
  assert.equal(first.json().total, "440");
  assert.equal(first.json().paid, "240");
  assert.equal(first.json().due, "200");

  // 4. Verify persistence: stock movements, balanced journals, lines, payments
  const saved = await withTenantContext(db, { businessId: owner.id }, async (tx) => ({
    purchase: await tx.purchaseDocument.findUniqueOrThrow({ where: { id: draftPayload.id } }),
    lines: await tx.purchaseLine.findMany({ where: { purchaseId: draftPayload.id } }),
    payments: await tx.purchasePayment.findMany({ where: { purchaseId: draftPayload.id } }),
    journal: await tx.journalEntry.findMany({
      where: { businessId: owner.id, postingKind: "purchase.bill" },
      include: { lines: true },
    }),
    movements: await tx.stockMovement.findMany({ where: { businessId: owner.id, movementKind: "purchase" } }),
    receipts: await tx.commandReceipt.findMany({ where: { businessId: owner.id, commandId: draftPayload.commandId } }),
  }));

  assert.equal(saved.purchase.status, "Posted");
  assert.equal(saved.lines.length, 1);
  assert.equal(saved.payments.length, 2);
  assert.equal(saved.movements.length, 1);
  assert.equal(saved.movements[0].quantityDelta.toString(), "10");
  assert.equal(saved.movements[0].valueDelta.toString(), "400");
  assert.equal(saved.movements[0].valuationStatus, "Resolved");
  assert.equal(saved.receipts.length, 1);

  // Journal balance check: sum of debits minus sum of credits must be exactly 0
  assert.equal(saved.journal.length, 1);
  const journalBalance = saved.journal[0].lines.reduce(
    (sum, row) => sum.plus(row.debit).minus(row.credit),
    new Prisma.Decimal(0),
  );
  assert.equal(journalBalance.toString(), "0");

  // 5. Duplicate supplier reference protection
  const secondDraftPayload = {
    ...draftPayload,
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    supplierInvoiceNumber: "APEX-2026-001", // Duplicate supplier reference!
    allowDuplicateSupplierReference: false,
    lines: [
      {
        ...draftPayload.lines[0],
        id: crypto.randomUUID(),
      },
    ],
    payments: [],
  };

  const draft2Res = await send(owner, "POST", "/v1/purchases/drafts", secondDraftPayload);
  assert.equal(draft2Res.statusCode, 201, draft2Res.body);

  const duplicateReject = await send(owner, "POST", `/v1/purchases/${secondDraftPayload.id}/post`, {
    commandId: secondDraftPayload.commandId,
  });
  assert.equal(duplicateReject.statusCode, 409, duplicateReject.body);
  assert.match(duplicateReject.json().error, /Supplier reference already recorded/);

  // With explicit reviewed exception: allowDuplicateSupplierReference: true
  const allowedPost = await send(owner, "POST", `/v1/purchases/${secondDraftPayload.id}/post`, {
    commandId: secondDraftPayload.commandId,
    allowDuplicateSupplierReference: true,
  });
  assert.equal(allowedPost.statusCode, 200, allowedPost.body);
  assert.equal(allowedPost.json().number, "PB-000002");

  // 6. Tenant isolation: Other business cannot see owner's purchase
  const otherGet = await send(other, "GET", `/v1/purchases/documents/${draftPayload.id}`);
  assert.equal(otherGet.statusCode, 404);

  // 7. Verify list endpoint
  const list = await send(owner, "GET", "/v1/purchases/documents");
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().rows.length, 2);
  assert.equal(list.json().rows[0].number, "PB-000002");
  assert.equal(list.json().rows[1].number, "PB-000001");
});

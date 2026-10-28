import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, Prisma, withTenantContext } from "../packages/db/src/index";
import { settleOpenDeficits } from "../apps/api/src/deficit-settlement";

test("M08 returns, credit notes, stock adjustments and deficit settlement with real PostgreSQL RLS", async (t) => {
  const adminUrl = process.env.DATABASE_URL ?? "postgresql://bms_local:bms_local@127.0.0.1:5432/bms";
  const runtimeUrl = new URL(adminUrl);
  runtimeUrl.username = process.env.BMS_RUNTIME_USER ?? "bms_runtime";
  runtimeUrl.password = process.env.BMS_RUNTIME_PASSWORD ?? "bms_runtime_pass_change_in_production";
  const db = createDatabase(runtimeUrl.toString());
  const admin = createDatabase(adminUrl);
  const app = createApp({ db });
  t.after(async () => {
    await app.close();
    await db.$disconnect();
    await admin.$disconnect();
  });

  const suffix = crypto.randomUUID().slice(0, 8);
  async function register(name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: `ret_${name}_${suffix}`,
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

  const owner = await register("RetA");
  const other = await register("RetB");

  const send = (actor: typeof owner, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { cookie: actor.cookie, "x-csrf-token": actor.csrf },
      ...(payload ? { payload } : {}),
    });

  // Setup system accounts & custom accounts
  assert.equal((await send(owner, "POST", "/v1/accounts/system")).statusCode, 200);

  const cash = await send(owner, "POST", "/v1/accounts", { code: "TILL", name: "Main till", kind: "Cash" });
  const bank = await send(owner, "POST", "/v1/accounts", { code: "BANK", name: "Bank", kind: "Bank" });
  const unit = await send(owner, "POST", "/v1/catalogue/units", { code: "PCS", name: "Pieces" });
  const tax = await send(owner, "POST", "/v1/catalogue/tax-profiles", { name: "Tax 10", rate: "10", mode: "Exclusive" });

  const goods = await send(owner, "POST", "/v1/catalogue/items", {
    name: "Notebook",
    kind: "Goods",
    sku: "NB-1",
    barcode: "99001",
    salePrice: "100.00",
    categoryId: null,
    baseUnitId: unit.json().id,
    taxProfileId: tax.json().id,
  });

  const service = await send(owner, "POST", "/v1/catalogue/items", {
    name: "Express Delivery",
    kind: "Service",
    sku: "SRV-1",
    barcode: null,
    salePrice: "20.00",
    categoryId: null,
    baseUnitId: null,
    taxProfileId: null,
  });

  const customer = await send(owner, "POST", "/v1/catalogue/parties", {
    name: "Tariq Customer",
    isCustomer: true,
    isSupplier: false,
    phone: "03001234567",
    email: "tariq@test.com",
  });

  const supplier = await send(owner, "POST", "/v1/catalogue/parties", {
    name: "Stationery Mart",
    isCustomer: false,
    isSupplier: true,
    phone: "03211234567",
    email: "mart@test.com",
  });

  const location = (await send(owner, "GET", "/v1/locations")).json()[0].id as string;
  const device = await send(owner, "POST", "/v1/devices/enroll", { deviceName: "Pos1", locationId: location });

  for (const resp of [cash, bank, unit, tax, goods, service, customer, supplier, device]) {
    assert.equal(resp.statusCode, 201, resp.body);
  }

  // 1. Initial opening stock: 20 Notebooks @ 50.00 each = 1,000.00 value
  const opening = {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-20",
    entries: [
      { kind: "Stock", itemId: goods.json().id, locationId: location, quantity: "20", value: "1000.00" },
    ],
  };
  const preview = await send(owner, "POST", "/v1/opening/preview", opening);
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(
    (await send(owner, "POST", "/v1/opening/commit", { ...opening, expectedCursor: preview.json().expectedCursor })).statusCode,
    201,
  );

  // 2. Post a Sale: 5 Notebooks @ 100.00 + 10% tax = 550.00. Paid 300.00 cash, 250.00 due
  const saleDraft = {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    deviceEnrollmentId: device.json().id,
    locationId: location,
    partyId: customer.json().id,
    businessDate: "2026-10-21",
    documentDiscount: "0",
    lines: [
      {
        id: crypto.randomUUID(),
        itemId: goods.json().id,
        conversionId: null,
        taxProfileId: tax.json().id,
        quantity: "5",
        unitPrice: "100.00",
        discount: "0",
      },
    ],
    payments: [
      {
        id: crypto.randomUUID(),
        accountId: cash.json().id,
        kind: "Cash",
        applied: "300.00",
        tendered: "300.00",
        reference: null,
      },
    ],
  };

  assert.equal((await send(owner, "POST", "/v1/sales/drafts", saleDraft)).statusCode, 201);
  const salePost = await send(owner, "POST", `/v1/sales/${saleDraft.id}/post`, { commandId: saleDraft.commandId });
  assert.equal(salePost.statusCode, 200, salePost.body);
  assert.equal(salePost.json().total, "550");
  assert.equal(salePost.json().paid, "300");
  assert.equal(salePost.json().due, "250");

  // 3. Customer Return 1: Return 2 Notebooks with restock
  // 2 units * 100 = 200.00 + 20.00 tax = 220.00 total.
  // Settlement: 220.00 allocated against unpaid due (reduces due from 250 to 30)
  const returnDraft1 = {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    originalSaleId: saleDraft.id,
    reason: "Wrong paper ruling requested by client",
    businessDate: "2026-10-22",
    lines: [
      {
        id: crypto.randomUUID(),
        originalLineId: saleDraft.lines[0].id,
        quantity: "2",
        disposition: "Restocked",
      },
    ],
    settlement: {
      allocateToDue: "220.00",
      customerCredit: "0.00",
      refund: null,
    },
  };

  const draftRes = await send(owner, "POST", "/v1/returns/sales/drafts", returnDraft1);
  assert.equal(draftRes.statusCode, 201, draftRes.body);
  const postRet1 = await send(owner, "POST", `/v1/returns/sales/${returnDraft1.id}/post`, { commandId: returnDraft1.commandId });
  assert.equal(postRet1.statusCode, 200, postRet1.body);
  assert.equal(postRet1.json().number, "CN-000001");
  assert.equal(postRet1.json().total.toString(), "220");
  assert.equal(postRet1.json().allocatedCredit.toString(), "220");

  // Verify remaining due derived from credit note allocation: 250 - 220 = 30
  const remainingSaleDue = Number(salePost.json().due) - Number(postRet1.json().allocatedCredit);
  assert.equal(remainingSaleDue, 30);

  // Verify Stock restored and journals balanced:
  const checkDb = await withTenantContext(db, { businessId: owner.id }, async (tx) => ({
    restockMovement: await tx.stockMovement.findFirst({
      where: { businessId: owner.id, movementKind: "SaleReturnRestock" },
    }),
    creditJournal: await tx.journalEntry.findFirst({
      where: { businessId: owner.id, postingKind: "sale.return" },
      include: { lines: true },
    }),
  }));

  assert.ok(checkDb.restockMovement);
  assert.equal(checkDb.restockMovement.quantityDelta.toString(), "2");
  assert.equal(checkDb.restockMovement.valueDelta.toString(), "100"); // 2 units @ 50.00 original cost = 100.00

  assert.ok(checkDb.creditJournal);
  assert.equal(
    checkDb.creditJournal.lines.reduce((s, r) => s.plus(r.debit).minus(r.credit), new Prisma.Decimal(0)).toString(),
    "0",
  );

  // 4. Test T14/T15 Concurrency / Remaining limit protection:
  // Original sale had 5 units. 2 units returned. Remaining limit is 3 units.
  // Attempting to return 4 units must fail closed with 409!
  const excessiveReturn = {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    originalSaleId: saleDraft.id,
    reason: "Returning more than remaining limit",
    businessDate: "2026-10-22",
    lines: [
      {
        id: crypto.randomUUID(),
        originalLineId: saleDraft.lines[0].id,
        quantity: "4", // 2 + 4 = 6 > 5!
        disposition: "Restocked",
      },
    ],
    settlement: {
      allocateToDue: "0.00",
      customerCredit: "440.00",
      refund: null,
    },
  };

  assert.equal((await send(owner, "POST", "/v1/returns/sales/drafts", excessiveReturn)).statusCode, 201);
  const excessPost = await send(owner, "POST", `/v1/returns/sales/${excessiveReturn.id}/post`, { commandId: excessiveReturn.commandId });
  assert.equal(excessPost.statusCode, 409, excessPost.body);
  assert.match(excessPost.json().error, /exceeds remaining limit/);

  // 5. Customer Return 2: Non-restocked (damaged) return with cash refund
  // Return 1 unit @ 100.00 + 10.00 tax = 110.00 total.
  // Disposition: Damaged (must NOT invent sellable inventory!)
  // Settlement: 30.00 to remaining due + 80.00 cash refund
  const returnDraft2 = {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    originalSaleId: saleDraft.id,
    reason: "Cover torn on delivery",
    businessDate: "2026-10-22",
    lines: [
      {
        id: crypto.randomUUID(),
        originalLineId: saleDraft.lines[0].id,
        quantity: "1",
        disposition: "Damaged",
      },
    ],
    settlement: {
      allocateToDue: "30.00",
      customerCredit: "0.00",
      refund: {
        accountId: cash.json().id,
        kind: "Cash",
        amount: "80.00",
        reference: null,
      },
    },
  };

  assert.equal((await send(owner, "POST", "/v1/returns/sales/drafts", returnDraft2)).statusCode, 201);
  const postRet2 = await send(owner, "POST", `/v1/returns/sales/${returnDraft2.id}/post`, { commandId: returnDraft2.commandId });
  assert.equal(postRet2.statusCode, 200, postRet2.body);
  assert.equal(postRet2.json().number, "CN-000002");
  assert.equal(postRet2.json().refundedAmount.toString(), "80");

  // Verify NO stock movement created for the damaged unit:
  const damagedMovement = await withTenantContext(db, { businessId: owner.id }, async (tx) =>
    tx.stockMovement.findMany({
      where: { businessId: owner.id, sourceLineId: returnDraft2.lines[0].id },
    }),
  );
  assert.equal(damagedMovement.length, 0, "Damaged return must not invent sellable stock");

  // Verify refund record exists in db:
  const refundRec = await withTenantContext(db, { businessId: owner.id }, async (tx) =>
    tx.creditNoteRefund.findFirst({
      where: { businessId: owner.id, creditNoteId: returnDraft2.id },
    }),
  );
  assert.ok(refundRec);
  assert.equal(refundRec.amount.toString(), "80");

  // 6. Purchase Bill & Purchase Return (Debit Note):
  // Record purchase bill: 10 Notebooks @ 60.00 = 600.00 + 60.00 tax = 660.00
  const purchDraft = {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    locationId: location,
    partyId: supplier.json().id,
    supplierInvoiceNumber: `SUP-${suffix}`,
    businessDate: "2026-10-22",
    lines: [
      {
        id: crypto.randomUUID(),
        itemId: goods.json().id,
        conversionId: null,
        taxProfileId: tax.json().id,
        quantity: "10",
        unitCost: "60.00",
        discount: "0",
      },
    ],
    payments: [],
  };

  assert.equal((await send(owner, "POST", "/v1/purchases/drafts", purchDraft)).statusCode, 201);
  const purchPost = await send(owner, "POST", `/v1/purchases/${purchDraft.id}/post`, { commandId: purchDraft.commandId });
  assert.equal(purchPost.statusCode, 200, purchPost.body);
  assert.equal(purchPost.json().due.toString(), "660");

  // Return 3 Notebooks to supplier (Debit Note):
  // 3 * 60 = 180 + 18 tax = 198.00 debit note
  const debitDraft = {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    originalPurchaseId: purchDraft.id,
    reason: "Damaged batch from supplier",
    businessDate: "2026-10-23",
    lines: [
      {
        id: crypto.randomUUID(),
        originalLineId: purchDraft.lines[0].id,
        quantity: "3",
      },
    ],
  };

  assert.equal((await send(owner, "POST", "/v1/returns/purchases/drafts", debitDraft)).statusCode, 201);
  const debitPost = await send(owner, "POST", `/v1/returns/purchases/${debitDraft.id}/post`, { commandId: debitDraft.commandId });
  assert.equal(debitPost.statusCode, 200, debitPost.body);
  assert.equal(debitPost.json().number, "DN-000001");
  assert.equal(debitPost.json().total.toString(), "198");

  // Verify remaining purchase due derived from debit note allocation: 660 - 198 = 462
  const remainingPurchDue = Number(purchPost.json().due) - Number(debitPost.json().allocatedCredit);
  assert.equal(remainingPurchDue, 462);

  // Verify outward stock movement:
  const purchReturnMv = await withTenantContext(db, { businessId: owner.id }, async (tx) =>
    tx.stockMovement.findFirst({
      where: { businessId: owner.id, movementKind: "PurchaseReturn" },
    }),
  );
  assert.ok(purchReturnMv);
  assert.equal(purchReturnMv.quantityDelta.toString(), "-3");
  assert.equal(purchReturnMv.valueDelta.toString(), "-180");

  // 7. Stock Counts & Adjustments:
  // Counted stock shortage: physical count found 2 Notebooks broken (-2 units @ 60.00 = -120.00)
  const adjDraft = {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    locationId: location,
    itemId: goods.json().id,
    adjustmentKind: "Damage",
    countedQuantity: "22",
    systemQuantity: "24",
    quantityDelta: "-2",
    unitCost: "60.00",
    reason: "Water leak in storage aisle",
    businessDate: "2026-10-23",
  };

  assert.equal((await send(owner, "POST", "/v1/stock/adjustments/drafts", adjDraft)).statusCode, 201);
  const adjPost = await send(owner, "POST", `/v1/stock/adjustments/${adjDraft.id}/post`, { commandId: adjDraft.commandId });
  assert.equal(adjPost.statusCode, 200, adjPost.body);
  assert.equal(adjPost.json().status, "Posted");

  // Verify stock movement and journal:
  const adjCheck = await withTenantContext(db, { businessId: owner.id }, async (tx) => ({
    movement: await tx.stockMovement.findFirst({
      where: { businessId: owner.id, sourceLineId: adjDraft.id },
    }),
    journal: await tx.journalEntry.findFirst({
      where: { businessId: owner.id, postingKind: "stock.adjustment" },
      include: { lines: true },
    }),
  }));
  assert.ok(adjCheck.movement);
  assert.equal(adjCheck.movement.quantityDelta.toString(), "-2");
  assert.equal(adjCheck.movement.valueDelta.toString(), "-120");
  assert.ok(adjCheck.journal);
  assert.equal(
    adjCheck.journal.lines.reduce((s, r) => s.plus(r.debit).minus(r.credit), new Prisma.Decimal(0)).toString(),
    "0",
  );

  // Services reject stock adjustments
  const serviceAdj = {
    ...adjDraft,
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    itemId: service.json().id,
  };
  const serviceReject = await send(owner, "POST", "/v1/stock/adjustments/drafts", serviceAdj);
  assert.equal(serviceReject.statusCode, 409);
  assert.match(serviceReject.json().error, /Services do not move stock/);

  // 8. Negative-stock Deficit Settlement Integration:
  // Simulate an open deficit: 1 unit sold into deficit at provisional cost 50.00
  const sourceEventId = crypto.randomUUID();
  await withTenantContext(admin, { bypassRls: true }, async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL app.posting_context = 'true';");
    await tx.sourceEvent.create({
      data: {
        id: sourceEventId,
        businessId: owner.id,
        commandId: crypto.randomUUID(),
        effectKind: "sale.invoice",
        businessDate: new Date("2026-10-21"),
      },
    });
    await tx.provisionalDeficitCost.create({
      data: {
        id: crypto.randomUUID(),
        businessId: owner.id,
        sourceEventId,
        sourceLineId: crypto.randomUUID(),
        quantityBase: new Prisma.Decimal("1.000000"),
        provisionalValue: new Prisma.Decimal("50.00"),
        status: "Open",
      },
    });
  });

  // Verify open deficits list endpoint
  const deficitsList = await send(owner, "GET", "/v1/stock/deficits");
  assert.equal(deficitsList.statusCode, 200);
  assert.equal(deficitsList.json().length, 1);
  assert.equal(deficitsList.json()[0].quantityBase.toString(), "1");

  // Inward receipt arrives at actual cost 75.00:
  // Settle deficit: 1 unit * (75 - 50) = +25.00 adjustment
  const cogsAccount = (await withTenantContext(db, { businessId: owner.id }, (tx) =>
    tx.account.findFirstOrThrow({ where: { businessId: owner.id, code: "SALE_COGS" } }),
  )).id;
  const invAccount = (await withTenantContext(db, { businessId: owner.id }, (tx) =>
    tx.account.findFirstOrThrow({ where: { businessId: owner.id, code: "OPEN_INVENTORY" } }),
  )).id;

  const settlementOutcome = await withTenantContext(db, { businessId: owner.id }, async (tx) =>
    settleOpenDeficits(tx, owner.id, goods.json().id, "5.000000", "75.00", cogsAccount, invAccount, "2026-10-23"),
  );

  assert.equal(settlementOutcome.settledCount, 1);
  assert.equal(settlementOutcome.costAdjustmentJournalLines.length, 2);
  assert.equal(settlementOutcome.costAdjustmentJournalLines[0].debit, "25.00"); // Debit COGS
  assert.equal(settlementOutcome.costAdjustmentJournalLines[1].credit, "25.00"); // Credit Inventory

  // 9. Tenant Isolation: Other business cannot view RetA's returns or adjustments
  assert.equal((await send(other, "GET", `/v1/returns/sales/${returnDraft1.id}`)).statusCode, 404);
  assert.equal((await send(other, "GET", `/v1/returns/purchases/${debitDraft.id}`)).statusCode, 404);
  const otherReturns = await send(other, "GET", "/v1/returns");
  assert.equal(otherReturns.statusCode, 200);
  assert.equal(otherReturns.json().length, 0);
});

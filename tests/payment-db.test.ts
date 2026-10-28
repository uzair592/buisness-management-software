import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, withTenantContext } from "../packages/db/src/index";

test("M07 payment in and payment out persist sequences, balance journals, reduce dues, and enforce tenant isolation", async (t) => {
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
        username: `pay_${name}_${suffix}`,
        password: "CorrectBatteryHorse123!",
        fullName: "Owner",
        businessName: name,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    return {
      id: res.json().business.id as string,
      userId: res.json().user.id as string,
      csrf: res.json().csrfToken as string,
      cookie: (res.headers["set-cookie"] as string[]).map((v) => v.split(";")[0]).join("; "),
    };
  }

  const owner = await register("PayBizA");
  const otherOwner = await register("PayBizB");

  const send = (actor: typeof owner, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { cookie: actor.cookie, "x-csrf-token": actor.csrf },
      ...(payload ? { payload } : {}),
    });

  // Setup system accounts
  const system = await send(owner, "POST", "/v1/accounts/system");
  assert.equal(system.statusCode, 200, system.body);

  const cash = await send(owner, "POST", "/v1/accounts", { code: "MAIN_CASH", name: "Main Cash", kind: "Cash" });
  assert.equal(cash.statusCode, 201);
  const bank = await send(owner, "POST", "/v1/accounts", { code: "OPERATING_BANK", name: "Operating Bank", kind: "Bank" });
  assert.equal(bank.statusCode, 201);

  const cashAccountId = cash.json().id as string;
  const bankAccountId = bank.json().id as string;

  // Create customer and supplier parties
  const customerRes = await send(owner, "POST", "/v1/catalogue/parties", {
    name: "Customer Alpha",
    isCustomer: true,
    isSupplier: false,
    phone: "1234567890",
  });
  assert.equal(customerRes.statusCode, 201, customerRes.body);
  const customerId = customerRes.json().id as string;

  const supplierRes = await send(owner, "POST", "/v1/catalogue/parties", {
    name: "Supplier Beta",
    isCustomer: false,
    isSupplier: true,
    phone: "0987654321",
  });
  assert.equal(supplierRes.statusCode, 201, supplierRes.body);
  const supplierId = supplierRes.json().id as string;

  // Fund cash account with opening balance so it has positive balance for payments out
  // Create an item for sales and purchases
  const unitRes = await send(owner, "POST", "/v1/catalogue/units", { code: "PCS", name: "Pieces" });
  assert.equal(unitRes.statusCode, 201);
  const unitId = unitRes.json().id as string;

  const itemRes = await send(owner, "POST", "/v1/catalogue/items", {
    name: "Product X",
    kind: "Goods",
    sku: "PROD-X",
    salePrice: "1000.00",
    baseUnitId: unitId,
  });
  assert.equal(itemRes.statusCode, 201);
  const itemId = itemRes.json().id as string;

  // Get location and enroll device
  const locRes = await send(owner, "GET", "/v1/locations");
  const locationId = (locRes.json() as { id: string }[])[0].id;
  const deviceRes = await send(owner, "POST", "/v1/devices/enroll", { deviceName: "Counter", locationId });
  assert.equal(deviceRes.statusCode, 201);
  const deviceId = deviceRes.json().id as string;

  // Fund cash & bank and opening stock so items can be sold
  const openingInput = {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-23",
    entries: [
      { kind: "Money", accountId: cashAccountId, amount: "50000.00" },
      { kind: "Money", accountId: bankAccountId, amount: "50000.00" },
      { kind: "Stock", itemId, locationId, quantity: "100.000000", value: "10000.00" },
    ],
  };
  const preview = await send(owner, "POST", "/v1/opening/preview", openingInput);
  assert.equal(preview.statusCode, 200, preview.body);
  const commit = await send(owner, "POST", "/v1/opening/commit", {
    ...openingInput,
    expectedCursor: preview.json().expectedCursor as string,
  });
  assert.equal(commit.statusCode, 201, commit.body);

  // 1. Post a Sale on Credit: Total 3000.00, Paid 1000.00, Due 2000.00
  const saleCommandId = crypto.randomUUID();
  const saleId = crypto.randomUUID();
  const saleDraftRes = await send(owner, "POST", "/v1/sales/drafts", {
    id: saleId,
    commandId: saleCommandId,
    deviceEnrollmentId: deviceId,
    locationId,
    partyId: customerId,
    businessDate: "2026-10-23",
    documentDiscount: "0",
    lines: [
      {
        id: crypto.randomUUID(),
        itemId,
        conversionId: null,
        taxProfileId: null,
        quantity: "3",
        unitPrice: "1000.00",
        discount: "0.00",
      },
    ],
    payments: [
      {
        id: crypto.randomUUID(),
        accountId: cashAccountId,
        kind: "Cash",
        applied: "1000.00",
        tendered: "1000.00",
        reference: null,
      },
    ],
  });
  assert.equal(saleDraftRes.statusCode, 201, saleDraftRes.body);

  const salePostRes = await send(owner, "POST", `/v1/sales/${saleId}/post`, { commandId: saleCommandId });
  assert.equal(salePostRes.statusCode, 200, salePostRes.body);

  // Check open documents for customer -> should show 1 document with remaining due 2000.00
  const openDocsRes = await send(owner, "GET", `/v1/payments/open-documents/${customerId}?paymentKind=PaymentIn`);
  assert.equal(openDocsRes.statusCode, 200, openDocsRes.body);
  const openDocs = openDocsRes.json().documents as { documentId: string; remainingDue: string; number: string }[];
  assert.equal(openDocs.length, 1);
  assert.equal(openDocs[0].documentId, saleId);
  assert.equal(openDocs[0].remainingDue, "2000.00");

  // 2. Post PaymentIn: 1500.00 allocated against invoice
  const paymentIn1Id = crypto.randomUUID();
  const payIn1Res = await send(owner, "POST", "/v1/payments/post", {
    id: paymentIn1Id,
    commandId: crypto.randomUUID(),
    partyId: customerId,
    accountId: bankAccountId,
    paymentKind: "PaymentIn",
    amount: "1500.00",
    reference: "Bank Transfer 1",
    businessDate: "2026-10-23",
    allocations: [
      {
        id: crypto.randomUUID(),
        documentId: saleId,
        allocatedAmount: "1500.00",
      },
    ],
  });
  assert.equal(payIn1Res.statusCode, 200, payIn1Res.body);
  const payIn1 = payIn1Res.json();
  assert.equal(payIn1.number, "PAY-IN-000001");
  assert.equal(payIn1.status, "Posted");
  assert.equal(payIn1.amount, "1500.00");
  assert.equal(payIn1.allocatedAmount, "1500.00");
  assert.equal(payIn1.unallocatedAmount, "0.00");

  // Check open documents again -> remaining due should now be 500.00
  const openDocs2Res = await send(owner, "GET", `/v1/payments/open-documents/${customerId}?paymentKind=PaymentIn`);
  const openDocs2 = openDocs2Res.json().documents as { documentId: string; remainingDue: string }[];
  assert.equal(openDocs2.length, 1);
  assert.equal(openDocs2[0].remainingDue, "500.00");

  // 3. Post PaymentIn with advance: Total 1000.00, allocate remaining 500.00, unallocated advance 500.00
  const paymentIn2Id = crypto.randomUUID();
  const payIn2Res = await send(owner, "POST", "/v1/payments/post", {
    id: paymentIn2Id,
    commandId: crypto.randomUUID(),
    partyId: customerId,
    accountId: cashAccountId,
    paymentKind: "PaymentIn",
    amount: "1000.00",
    reference: "Cash Settle + Advance",
    businessDate: "2026-10-23",
    allocations: [
      {
        id: crypto.randomUUID(),
        documentId: saleId,
        allocatedAmount: "500.00",
      },
    ],
  });
  assert.equal(payIn2Res.statusCode, 200, payIn2Res.body);
  const payIn2 = payIn2Res.json();
  assert.equal(payIn2.number, "PAY-IN-000002");
  assert.equal(payIn2.amount, "1000.00");
  assert.equal(payIn2.allocatedAmount, "500.00");
  assert.equal(payIn2.unallocatedAmount, "500.00");

  // Invoice is now fully settled -> open documents for customer should be empty!
  const openDocs3Res = await send(owner, "GET", `/v1/payments/open-documents/${customerId}?paymentKind=PaymentIn`);
  assert.equal(openDocs3Res.json().documents.length, 0);

  // 4. Over-allocation rejection test: attempting to allocate to the settled invoice throws 409
  const overflowRes = await send(owner, "POST", "/v1/payments/post", {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    partyId: customerId,
    accountId: cashAccountId,
    paymentKind: "PaymentIn",
    amount: "200.00",
    businessDate: "2026-10-23",
    allocations: [
      {
        id: crypto.randomUUID(),
        documentId: saleId,
        allocatedAmount: "200.00",
      },
    ],
  });
  assert.equal(overflowRes.statusCode, 409, overflowRes.body);

  // 5. Post a Purchase Bill on Credit: Total 4000.00, Paid 1000.00, Due 3000.00
  const purchaseId = crypto.randomUUID();
  const purchaseCommandId = crypto.randomUUID();
  const purchaseDraftRes = await send(owner, "POST", "/v1/purchases/drafts", {
    id: purchaseId,
    commandId: purchaseCommandId,
    locationId,
    partyId: supplierId,
    supplierInvoiceNumber: "INV-SUPP-001",
    businessDate: "2026-10-23",
    lines: [
      {
        id: crypto.randomUUID(),
        itemId,
        conversionId: null,
        taxProfileId: null,
        quantity: "4",
        unitCost: "1000.00",
        discount: "0.00",
      },
    ],
    payments: [
      {
        id: crypto.randomUUID(),
        accountId: bankAccountId,
        kind: "Bank",
        applied: "1000.00",
        reference: "Downpayment",
      },
    ],
  });
  assert.equal(purchaseDraftRes.statusCode, 201, purchaseDraftRes.body);

  const purchasePostRes = await send(owner, "POST", `/v1/purchases/${purchaseId}/post`, { commandId: purchaseCommandId });
  assert.equal(purchasePostRes.statusCode, 200, purchasePostRes.body);

  // Check open documents for supplier -> 1 purchase with remaining due 3000.00
  const suppOpenRes = await send(owner, "GET", `/v1/payments/open-documents/${supplierId}?paymentKind=PaymentOut`);
  const suppOpenDocs = suppOpenRes.json().documents as { documentId: string; remainingDue: string }[];
  assert.equal(suppOpenDocs.length, 1);
  assert.equal(suppOpenDocs[0].documentId, purchaseId);
  assert.equal(suppOpenDocs[0].remainingDue, "3000.00");

  // 6. Post PaymentOut to supplier: 3000.00
  const paymentOutId = crypto.randomUUID();
  const payOutRes = await send(owner, "POST", "/v1/payments/post", {
    id: paymentOutId,
    commandId: crypto.randomUUID(),
    partyId: supplierId,
    accountId: cashAccountId,
    paymentKind: "PaymentOut",
    amount: "3000.00",
    reference: "Supplier Payout",
    businessDate: "2026-10-23",
    allocations: [
      {
        id: crypto.randomUUID(),
        documentId: purchaseId,
        allocatedAmount: "3000.00",
      },
    ],
  });
  assert.equal(payOutRes.statusCode, 200, payOutRes.body);
  const payOut = payOutRes.json();
  assert.equal(payOut.number, "PAY-OUT-000001");
  assert.equal(payOut.amount, "3000.00");
  assert.equal(payOut.allocatedAmount, "3000.00");
  assert.equal(payOut.unallocatedAmount, "0.00");

  // Supplier bill is now fully settled
  const suppOpenRes2 = await send(owner, "GET", `/v1/payments/open-documents/${supplierId}?paymentKind=PaymentOut`);
  assert.equal(suppOpenRes2.json().documents.length, 0);

  // 7. Verify journal balances in database
  await withTenantContext(db, { businessId: owner.id, userId: owner.userId }, async (tx) => {
    const lines = await tx.journalLine.aggregate({
      where: { businessId: owner.id },
      _sum: { debit: true, credit: true },
    });
    assert.deepEqual(lines._sum.debit, lines._sum.credit, "All journal lines across transactions must balance exactly");
  });

  // 8. Multi-tenant isolation test: otherOwner cannot see or allocate to PayBizA's documents
  const isolationRes = await send(otherOwner, "GET", `/v1/payments/${paymentIn1Id}`);
  assert.equal(isolationRes.statusCode, 404, "Other tenant must receive 404 for foreign payment");

  const crossAllocRes = await send(otherOwner, "POST", "/v1/payments/post", {
    id: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    partyId: customerId,
    accountId: cashAccountId,
    paymentKind: "PaymentIn",
    amount: "100.00",
    businessDate: "2026-10-23",
    allocations: [],
  });
  assert.equal(crossAllocRes.statusCode, 409, "Cross-tenant party or account reference must be rejected");
});

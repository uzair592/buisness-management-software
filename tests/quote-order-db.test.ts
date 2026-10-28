import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, withTenantContext } from "../packages/db/src/index";

test("M12 quotations and purchase orders: non-posting lifecycle, partial conversion to sale/purchase, and multi-tenant isolation", async (t) => {
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
        username: `quote_${name}_${suffix}`,
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

  const owner = await register("QuoteBizA");
  const other = await register("QuoteBizB");

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

  // Setup catalogue: Customer, Supplier, Goods item
  const custRes = await send(owner, "POST", "/v1/catalogue/parties", {
    name: "Customer Alpha",
    isCustomer: true,
    isSupplier: false,
  });
  assert.equal(custRes.statusCode, 201, custRes.body);
  const customerId = custRes.json().id as string;

  const suppRes = await send(owner, "POST", "/v1/catalogue/parties", {
    name: "Supplier Beta",
    isCustomer: false,
    isSupplier: true,
  });
  assert.equal(suppRes.statusCode, 201, suppRes.body);
  const supplierId = suppRes.json().id as string;

  const unitRes = await send(owner, "POST", "/v1/catalogue/units", {
    code: "PCS",
    name: "Pieces",
  });
  assert.equal(unitRes.statusCode, 201, unitRes.body);
  const baseUnitId = unitRes.json().id as string;

  const itemRes = await send(owner, "POST", "/v1/catalogue/items", {
    name: "Standard Hammer",
    kind: "Goods",
    baseUnitId,
    salePrice: "50.00",
  });
  assert.equal(itemRes.statusCode, 201, itemRes.body);
  const itemId = itemRes.json().id as string;

  const locRes = await send(owner, "GET", "/v1/locations");
  assert.equal(locRes.statusCode, 200, locRes.body);
  const locationId = locRes.json()[0].id as string;

  // Enrolled device for sales
  const devRes = await send(owner, "POST", "/v1/devices/enroll", {
    deviceName: "Counter Terminal",
    locationId,
  });
  assert.equal(devRes.statusCode, 201, devRes.body);
  const deviceEnrollmentId = devRes.json().id as string;

  // Add opening stock so items can be sold
  const openingRes = await send(owner, "POST", "/v1/opening/preview", {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-28",
    entries: [{ kind: "Stock", locationId, itemId, quantity: "100", value: "2500.00" }],
  });
  assert.equal(openingRes.statusCode, 200, openingRes.body);
  const commitRes = await send(owner, "POST", "/v1/opening/commit", {
    batchId: crypto.randomUUID(),
    businessDate: "2026-10-28",
    expectedCursor: openingRes.json().expectedCursor,
    entries: [{ kind: "Stock", locationId, itemId, quantity: "100", value: "2500.00" }],
  });
  assert.equal(commitRes.statusCode, 201, commitRes.body);

  // Initial journal count
  const initialJournals = await withTenantContext(db, { businessId: owner.id, userId: owner.userId }, async (tx) =>
    tx.journalEntry.count({ where: { businessId: owner.id } }),
  );

  // 1. CREATE QUOTATION
  const quoteRes = await send(owner, "POST", "/v1/quotes", {
    partyId: customerId,
    notes: "Quote for 10 hammers",
    lines: [
      { itemId, quantity: "10", unitPrice: "50.00" },
    ],
  });
  assert.equal(quoteRes.statusCode, 201, quoteRes.body);
  const quote = quoteRes.json();
  assert.equal(quote.number, "QT-000001");
  assert.equal(quote.status, "Issued");
  assert.equal(Number(quote.subtotal), 500);
  assert.equal(Number(quote.grandTotal), 500);
  assert.equal(quote.lines.length, 1);
  const quoteLineId = quote.lines[0].id as string;

  // Verify: ZERO journal entries created
  const journalsAfterQuote = await withTenantContext(db, { businessId: owner.id, userId: owner.userId }, async (tx) =>
    tx.journalEntry.count({ where: { businessId: owner.id } }),
  );
  assert.equal(journalsAfterQuote, initialJournals, "Issuing quotation must create zero journal entries");

  // 2. STATUS UPDATE: Accept quote
  const acceptRes = await send(owner, "POST", `/v1/quotes/${quote.id}/status`, { status: "Accepted" });
  assert.equal(acceptRes.statusCode, 200, acceptRes.body);
  assert.equal(acceptRes.json().status, "Accepted");

  // 3. PARTIAL CONVERT: Convert 4 out of 10 hammers to sale
  const convert1Res = await send(owner, "POST", `/v1/quotes/${quote.id}/convert`, {
    locationId,
    deviceEnrollmentId,
    lines: [{ lineId: quoteLineId, quantityToConvert: "4" }],
  });
  assert.equal(convert1Res.statusCode, 200, convert1Res.body);
  assert.equal(convert1Res.json().quotation.status, "PartiallyFulfilled");
  assert.equal(convert1Res.json().quotation.lines[0].convertedQuantity, "4");

  // Verify journal entries increased by 1 (standard sale posting)
  const journalsAfterConvert1 = await withTenantContext(db, { businessId: owner.id, userId: owner.userId }, async (tx) =>
    tx.journalEntry.count({ where: { businessId: owner.id } }),
  );
  assert.equal(journalsAfterConvert1, initialJournals + 1, "Conversion to sale must post exactly one standard journal entry");

  // 4. OVER-CONVERSION REJECTED: Try converting 7 when only 6 remaining
  const overConvertRes = await send(owner, "POST", `/v1/quotes/${quote.id}/convert`, {
    locationId,
    deviceEnrollmentId,
    lines: [{ lineId: quoteLineId, quantityToConvert: "7" }],
  });
  assert.equal(overConvertRes.statusCode, 409, overConvertRes.body);

  // 5. FULL CONVERSION: Convert the remaining 6 hammers
  const convert2Res = await send(owner, "POST", `/v1/quotes/${quote.id}/convert`, {
    locationId,
    deviceEnrollmentId,
    lines: [{ lineId: quoteLineId, quantityToConvert: "6" }],
  });
  assert.equal(convert2Res.statusCode, 200, convert2Res.body);
  assert.equal(convert2Res.json().quotation.status, "Fulfilled");
  assert.equal(convert2Res.json().quotation.lines[0].convertedQuantity, "10");

  // 6. CREATE PURCHASE ORDER
  const poRes = await send(owner, "POST", "/v1/purchase-orders", {
    partyId: supplierId,
    locationId,
    notes: "Order for 50 hammers",
    lines: [
      { itemId, quantity: "50", unitPrice: "24.00" },
    ],
  });
  assert.equal(poRes.statusCode, 201, poRes.body);
  const po = poRes.json();
  assert.equal(po.number, "PO-000001");
  assert.equal(po.status, "Issued");
  assert.equal(Number(po.subtotal), 1200);
  assert.equal(Number(po.grandTotal), 1200);
  const poLineId = po.lines[0].id as string;

  // 7. CONVERT PURCHASE ORDER TO BILL
  const convertPoRes = await send(owner, "POST", `/v1/purchase-orders/${po.id}/convert`, {
    supplierInvoiceNumber: "INV-SUPP-9988",
    lines: [{ lineId: poLineId, quantityToConvert: "50" }],
  });
  assert.equal(convertPoRes.statusCode, 200, convertPoRes.body);
  assert.equal(convertPoRes.json().purchaseOrder.status, "Fulfilled");

  // 8. MULTI-TENANT ISOLATION: User from Biz B cannot access or convert Biz A's quote
  const foreignGet = await send(other, "GET", `/v1/quotes/${quote.id}`);
  assert.equal(foreignGet.statusCode, 404);

  const foreignConvert = await send(other, "POST", `/v1/quotes/${quote.id}/convert`, {
    lines: [{ lineId: quoteLineId, quantityToConvert: "1" }],
  });
  assert.equal(foreignConvert.statusCode, 409);
});

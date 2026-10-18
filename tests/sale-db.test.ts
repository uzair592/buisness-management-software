import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, Prisma, withTenantContext } from "../packages/db/src/index";

test("M05 online sale persists number, exact split, stock, journal and replay once", async (t) => {
  const adminUrl = process.env.DATABASE_URL ?? "postgresql://bms_local:bms_local@127.0.0.1:5432/bms";
  const runtimeUrl = new URL(adminUrl);
  runtimeUrl.username = process.env.BMS_RUNTIME_USER ?? "bms_runtime";
  runtimeUrl.password = process.env.BMS_RUNTIME_PASSWORD ?? "bms_runtime_pass_change_in_production";
  const db = createDatabase(runtimeUrl.toString());
  const app = createApp({ db });
  t.after(async () => { await app.close(); await db.$disconnect(); });
  const suffix = crypto.randomUUID().slice(0, 8);
  async function register(name: string) {
    const res = await app.inject({ method: "POST", url: "/v1/auth/register", payload: {
      username: `sale_${name}_${suffix}`, password: "CorrectBatteryHorse123!", fullName: "Owner", businessName: name,
    } });
    assert.equal(res.statusCode, 201, res.body);
    return { id: res.json().business.id as string, csrf: res.json().csrfToken as string,
      cookie: (res.headers["set-cookie"] as string[]).map((v) => v.split(";")[0]).join("; ") };
  }
  const owner = await register("A");
  const other = await register("B");
  const send = (actor: typeof owner, method: "GET" | "POST", url: string, payload?: object) => app.inject({
    method, url, headers: { cookie: actor.cookie, "x-csrf-token": actor.csrf }, ...(payload ? { payload } : {}),
  });
  const system = await send(owner, "POST", "/v1/accounts/system");
  assert.equal(system.statusCode, 200, system.body);
  const cash = await send(owner, "POST", "/v1/accounts", { code: "TILL", name: "Main till", kind: "Cash" });
  const bank = await send(owner, "POST", "/v1/accounts", { code: "BANK", name: "Bank", kind: "Bank" });
  const unit = await send(owner, "POST", "/v1/catalogue/units", { code: "EA", name: "Each" });
  const tax = await send(owner, "POST", "/v1/catalogue/tax-profiles", { name: "General 10", rate: "10", mode: "Exclusive" });
  const goods = await send(owner, "POST", "/v1/catalogue/items", { name: "Bottle", kind: "Goods", sku: "BOTTLE",
    barcode: "98765", salePrice: "10.00", categoryId: null, baseUnitId: unit.json().id, taxProfileId: tax.json().id });
  const service = await send(owner, "POST", "/v1/catalogue/items", { name: "Delivery", kind: "Service", sku: "DELIVERY",
    barcode: null, salePrice: "5.00", categoryId: null, baseUnitId: null, taxProfileId: null });
  const party = await send(owner, "POST", "/v1/catalogue/parties", { name: "Customer", isCustomer: true,
    isSupplier: false, phone: null, email: null });
  const location = (await send(owner, "GET", "/v1/locations")).json()[0].id as string;
  const device = await send(owner, "POST", "/v1/devices/enroll", { deviceName: "Counter", locationId: location });
  for (const response of [cash, bank, unit, tax, goods, service, party, device]) assert.equal(response.statusCode, 201, response.body);
  const opening = { batchId: crypto.randomUUID(), businessDate: "2026-10-18", entries: [
    { kind: "Stock", itemId: goods.json().id, locationId: location, quantity: "10", value: "30.00" },
  ] };
  const preview = await send(owner, "POST", "/v1/opening/preview", opening);
  assert.equal(preview.statusCode, 200, preview.body);
  const committed = await send(owner, "POST", "/v1/opening/commit", { ...opening, expectedCursor: preview.json().expectedCursor });
  assert.equal(committed.statusCode, 201, committed.body);
  const draft = { id: crypto.randomUUID(), commandId: crypto.randomUUID(), deviceEnrollmentId: device.json().id,
    locationId: location, partyId: party.json().id, businessDate: "2026-10-18", documentDiscount: "0",
    lines: [
      { id: crypto.randomUUID(), itemId: goods.json().id, conversionId: null, taxProfileId: tax.json().id,
        quantity: "2", unitPrice: "10.00", discount: "0" },
      { id: crypto.randomUUID(), itemId: service.json().id, conversionId: null, taxProfileId: null,
        quantity: "1", unitPrice: "5.00", discount: "0" },
    ], payments: [
      { id: crypto.randomUUID(), accountId: cash.json().id, kind: "Cash", applied: "10.00", tendered: "20.00", reference: null },
      { id: crypto.randomUUID(), accountId: bank.json().id, kind: "Bank", applied: "7.00", tendered: null, reference: "MANUAL-1" },
    ] };
  const created = await send(owner, "POST", "/v1/sales/drafts", draft);
  assert.equal(created.statusCode, 201, created.body);
  const submit = () => send(owner, "POST", `/v1/sales/${draft.id}/post`, { commandId: draft.commandId });
  const [first, repeat] = await Promise.all([submit(), submit()]);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(repeat.statusCode, 200, repeat.body);
  assert.equal(first.json().number, repeat.json().number);
  assert.match(first.json().number, /^D\d+-000001$/);
  assert.equal(first.json().total, "27");
  assert.equal(first.json().paid, "17");
  assert.equal(first.json().due, "10");
  assert.equal((await send(owner, "POST", "/v1/sales/drafts", draft)).statusCode, 201);
  assert.equal((await send(other, "GET", `/v1/sales/documents/${draft.id}`)).statusCode, 404);
  const detail = await send(owner, "GET", `/v1/sales/documents/${draft.id}`);
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().lines.length, 2);
  assert.equal(detail.json().payments.length, 2);
  const saved = await withTenantContext(db, { businessId: owner.id }, async (tx) => ({
    sale: await tx.saleDocument.findUniqueOrThrow({ where: { id: draft.id } }),
    journal: await tx.journalEntry.findMany({ where: { businessId: owner.id, postingKind: "sale.invoice" }, include: { lines: true } }),
    movements: await tx.stockMovement.findMany({ where: { businessId: owner.id, movementKind: "sale" } }),
    receipts: await tx.commandReceipt.findMany({ where: { businessId: owner.id, commandId: draft.commandId } }),
  }));
  assert.equal(saved.journal.length, 1);
  assert.equal(saved.journal[0].lines.reduce((sum, row) => sum.plus(row.debit).minus(row.credit), new Prisma.Decimal(0)).toString(), "0");
  assert.equal(saved.movements.length, 1);
  assert.equal(saved.movements[0].quantityDelta.toString(), "-2");
  assert.equal(saved.movements[0].valueDelta.toString(), "-6");
  assert.equal(saved.receipts.length, 1);
  assert.equal(saved.sale.status, "Posted");
});

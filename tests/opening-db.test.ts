import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, Prisma, withTenantContext } from "../packages/db/src/index";

test("M04 opening preview and idempotent posting reconcile money, stock, dues and equity", async (t) => {
  const adminUrl = process.env.DATABASE_URL ?? "postgresql://bms_local:bms_local@127.0.0.1:5432/bms";
  const runtimeUrl = new URL(adminUrl);
  runtimeUrl.username = process.env.BMS_RUNTIME_USER ?? "bms_runtime";
  runtimeUrl.password = process.env.BMS_RUNTIME_PASSWORD ?? "bms_runtime_pass_change_in_production";
  const db = createDatabase(runtimeUrl.toString());
  const app = createApp({ db });
  t.after(async () => { await app.close(); await db.$disconnect(); });
  const suffix = crypto.randomUUID().slice(0, 8);
  async function register(label: string) {
    const res = await app.inject({ method: "POST", url: "/v1/auth/register", payload: {
      username: `opening_${label}_${suffix}`, password: "CorrectBatteryHorse123!",
      fullName: "Opening owner", businessName: label,
    } });
    assert.equal(res.statusCode, 201, res.body);
    return { businessId: res.json().business.id as string, csrf: res.json().csrfToken as string,
      cookie: (res.headers["set-cookie"] as string[]).map((v) => v.split(";")[0]).join("; ") };
  }
  const owner = await register("A");
  const other = await register("B");
  async function send(actor: typeof owner, method: "GET" | "POST", url: string, payload?: object) {
    return app.inject({ method, url, headers: { cookie: actor.cookie, "x-csrf-token": actor.csrf },
      ...(payload ? { payload } : {}) });
  }
  const system = await send(owner, "POST", "/v1/accounts/system");
  assert.equal(system.statusCode, 200, system.body);
  assert.equal(system.json().accounts.length, 4);
  assert.equal((await send(owner, "POST", "/v1/accounts/system")).json().accounts.length, 4);
  const cash = await send(owner, "POST", "/v1/accounts", { code: "TILL", name: "Till", kind: "Cash" });
  const bank = await send(owner, "POST", "/v1/accounts", { code: "BANK", name: "Bank", kind: "Bank" });
  assert.equal(cash.statusCode, 201, cash.body);
  assert.equal(bank.statusCode, 201, bank.body);
  const unit = await send(owner, "POST", "/v1/catalogue/units", { code: "EA", name: "Each" });
  const item = await send(owner, "POST", "/v1/catalogue/items", { name: "Opening goods", kind: "Goods", sku: "OG",
    barcode: null, salePrice: "2.00", categoryId: null, baseUnitId: unit.json().id, taxProfileId: null });
  assert.equal(item.statusCode, 201, item.body);
  const party = await send(owner, "POST", "/v1/catalogue/parties", { name: "Customer and supplier",
    isCustomer: true, isSupplier: true, phone: null, email: null });
  assert.equal(party.statusCode, 201, party.body);
  const location = (await send(owner, "GET", "/v1/locations")).json()[0].id;
  const input = { batchId: crypto.randomUUID(), businessDate: "2026-10-17", entries: [
    { kind: "Money", accountId: cash.json().id, amount: "100.00" },
    { kind: "Money", accountId: bank.json().id, amount: "50.00" },
    { kind: "Stock", itemId: item.json().id, locationId: location, quantity: "10.000000", value: "30.00" },
    { kind: "Receivable", partyId: party.json().id, reference: "OLD-INV-1", amount: "70.00" },
    { kind: "Payable", partyId: party.json().id, reference: "OLD-BILL-1", amount: "20.00" },
  ] };
  const preview = await send(owner, "POST", "/v1/opening/preview", input);
  assert.equal(preview.statusCode, 200, preview.body);
  assert.deepEqual({ money: preview.json().preview.money, stock: preview.json().preview.stock,
    receivable: preview.json().preview.receivable, payable: preview.json().preview.payable,
    equity: preview.json().preview.equity },
  { money: "150.00", stock: "30.00", receivable: "70.00", payable: "20.00", equity: "230.00" });
  assert.equal((await send(other, "POST", "/v1/opening/preview", input)).statusCode, 400);
  const submitted = { ...input, expectedCursor: preview.json().expectedCursor as string };
  const commit = await send(owner, "POST", "/v1/opening/commit", submitted);
  assert.equal(commit.statusCode, 201, commit.body);
  assert.equal((await send(owner, "POST", "/v1/opening/commit", submitted)).json().cursor, commit.json().cursor);
  assert.equal((await send(owner, "POST", "/v1/opening/commit", {
    ...submitted, entries: [{ ...input.entries[0], amount: "101.00" }, ...input.entries.slice(1)],
  })).statusCode, 409);
  const second = { ...input, batchId: crypto.randomUUID() };
  const secondPreview = await send(owner, "POST", "/v1/opening/preview", second);
  assert.equal(secondPreview.statusCode, 200, secondPreview.body);
  assert.equal((await send(owner, "POST", "/v1/opening/commit", {
    ...second, expectedCursor: secondPreview.json().expectedCursor,
  })).statusCode, 409);
  const persisted = await withTenantContext(db, { businessId: owner.businessId }, async (tx) => ({
    batches: await tx.openingBatch.findMany({ where: { businessId: owner.businessId }, include: { documents: true } }),
    journal: await tx.journalEntry.findMany({ where: { businessId: owner.businessId, postingKind: "opening_batch" }, include: { lines: true } }),
    stock: await tx.stockMovement.findMany({ where: { businessId: owner.businessId, movementKind: "opening" } }),
    receipts: await tx.commandReceipt.findMany({ where: { businessId: owner.businessId, commandId: input.batchId } }),
  }));
  assert.equal(persisted.batches.length, 1);
  assert.equal(persisted.batches[0].documents.length, 2);
  assert.equal(persisted.batches[0].documents[0].partyNameSnapshot, "Customer and supplier");
  assert.equal(persisted.journal.length, 1);
  assert.equal(persisted.journal[0].lines.reduce((sum, line) => sum.plus(line.debit).minus(line.credit), new Prisma.Decimal(0)).toString(), "0");
  assert.equal(persisted.stock.length, 1);
  assert.equal(persisted.stock[0].itemId, item.json().id);
  assert.equal(persisted.stock[0].quantityDelta.toString(), "10");
  assert.equal(persisted.stock[0].valueDelta.toString(), "30");
  assert.equal(persisted.receipts.length, 1);
  assert.equal((await send(other, "GET", "/v1/opening")).json(), null);
});

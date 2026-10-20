import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, Prisma, withTenantContext } from "../packages/db/src/index";

test("M07 transfer is balanced, tenant scoped and idempotent under concurrent retries", async (t) => {
  const runtimeUrl = new URL(process.env.DATABASE_URL ?? "postgresql://bms_local:bms_local@127.0.0.1:5432/bms");
  runtimeUrl.username = process.env.BMS_RUNTIME_USER ?? "bms_runtime";
  runtimeUrl.password = process.env.BMS_RUNTIME_PASSWORD ?? "bms_runtime_pass_change_in_production";
  const db = createDatabase(runtimeUrl.toString());
  const app = createApp({ db });
  t.after(async () => { await app.close(); await db.$disconnect(); });
  const suffix = crypto.randomUUID().slice(0, 8);
  async function register(name: string) {
    const response = await app.inject({ method: "POST", url: "/v1/auth/register", payload: {
      username: `transfer_${name}_${suffix}`, password: "CorrectBatteryHorse123!", fullName: "Owner", businessName: name,
    } });
    assert.equal(response.statusCode, 201, response.body);
    return { id: response.json().business.id as string, csrf: response.json().csrfToken as string,
      cookie: (response.headers["set-cookie"] as string[]).map((v) => v.split(";")[0]).join("; ") };
  }
  const owner = await register("owner");
  const other = await register("other");
  const send = (actor: typeof owner, method: "GET" | "POST", url: string, payload?: object) => app.inject({
    method, url, headers: { cookie: actor.cookie, "x-csrf-token": actor.csrf }, ...(payload ? { payload } : {}),
  });
  const cash = await send(owner, "POST", "/v1/accounts", { code: "TILL", name: "Till", kind: "Cash" });
  const bank = await send(owner, "POST", "/v1/accounts", { code: "BANK", name: "Bank", kind: "Bank" });
  const foreign = await send(other, "POST", "/v1/accounts", { code: "BANK", name: "Other bank", kind: "Bank" });
  for (const response of [cash, bank, foreign]) assert.equal(response.statusCode, 201, response.body);
  const sourceAccountId = cash.json().id as string;
  const destinationAccountId = bank.json().id as string;
  assert.equal((await send(owner, "POST", "/v1/accounts/system")).statusCode, 200);
  const opening = { batchId: crypto.randomUUID(), businessDate: "2026-10-20", entries: [
    { kind: "Money", accountId: sourceAccountId, amount: "100.00" },
  ] };
  const preview = await send(owner, "POST", "/v1/opening/preview", opening);
  assert.equal(preview.statusCode, 200, preview.body);
  const committed = await send(owner, "POST", "/v1/opening/commit", { ...opening, expectedCursor: preview.json().expectedCursor });
  assert.equal(committed.statusCode, 201, committed.body);
  const input = { id: crypto.randomUUID(), commandId: crypto.randomUUID(), sourceAccountId, destinationAccountId,
    amount: "17.35", reference: "Till deposit 1", businessDate: "2026-10-20" };
  const post = (body: object) => send(owner, "POST", "/v1/accounts/transfers", body);
  const [first, replay] = await Promise.all([post(input), post(input)]);
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(replay.statusCode, 201, replay.body);
  assert.equal(first.json().id, replay.json().id);
  assert.equal((await post({ ...input, amount: "18.35" })).statusCode, 409);
  const invalid = await post({ ...input, id: crypto.randomUUID(), commandId: crypto.randomUUID(), destinationAccountId: foreign.json().id });
  assert.equal(invalid.statusCode, 409, invalid.body);
  const tooMuch = await post({ ...input, id: crypto.randomUUID(), commandId: crypto.randomUUID(), amount: "100.00" });
  assert.equal(tooMuch.statusCode, 409, tooMuch.body);
  assert.equal((await send(other, "GET", `/v1/accounts/books/${sourceAccountId}`)).statusCode, 404);
  assert.equal((await send(other, "POST", "/v1/accounts/transfers", input)).statusCode, 409);
  assert.equal((await app.inject({ method: "POST", url: "/v1/accounts/transfers", payload: input })).statusCode, 401);
  const source = await send(owner, "GET", `/v1/accounts/books/${sourceAccountId}`);
  const destination = await send(owner, "GET", `/v1/accounts/books/${destinationAccountId}`);
  assert.equal(source.statusCode, 200, source.body);
  assert.equal(destination.statusCode, 200, destination.body);
  assert.equal(source.json().balance, "82.65");
  assert.equal(destination.json().balance, "17.35");
  assert.equal(source.json().rows[0].transfer.reference, input.reference);
  const saved = await withTenantContext(db, { businessId: owner.id }, async (tx) => ({
    transfers: await tx.moneyTransfer.findMany({ where: { businessId: owner.id } }),
    entries: await tx.journalEntry.findMany({ where: { businessId: owner.id, postingKind: "money_transfer" }, include: { lines: true } }),
    receipts: await tx.commandReceipt.count({ where: { businessId: owner.id, commandId: input.commandId } }),
    changes: await tx.changeBatch.count({ where: { businessId: owner.id, sourceEventId: first.json().sourceEventId } }),
  }));
  assert.equal(saved.transfers.length, 1);
  assert.equal(saved.receipts, 1);
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].lines.reduce((sum, row) => sum.plus(row.debit).minus(row.credit), new Prisma.Decimal(0)).toString(), "0");
  assert.equal(saved.entries[0].lines.length, 2);
  assert.equal(saved.changes, 1);
  assert.equal((await withTenantContext(db, { businessId: other.id }, (tx) => tx.moneyTransfer.count({ where: { businessId: owner.id } }))), 0);
});

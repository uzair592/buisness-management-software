import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createDatabase, withTenantContext } from "../packages/db/src/index";
import { ChangedCommandError, postCommand, type PostingCommand } from "../packages/db/src/posting";

const uuid = () => crypto.randomUUID();
const adminUrl = process.env.DATABASE_URL ?? "postgresql://bms_local:bms_local@127.0.0.1:5432/bms";
const runtimeUrl = new URL(adminUrl);
runtimeUrl.username = process.env.BMS_RUNTIME_USER ?? "bms_runtime";
runtimeUrl.password = process.env.BMS_RUNTIME_PASSWORD ?? "bms_runtime_pass_change_in_production";

test("M03 posting: restricted role, replay, rollback, journal guard and commit-ordered cursors", async (t) => {
  const admin = createDatabase(adminUrl);
  const runtime = createDatabase(runtimeUrl.toString());
  t.after(async () => { await runtime.$disconnect(); await admin.$disconnect(); });

  const a = { businessId: uuid(), userId: uuid(), membershipId: uuid(), debit: uuid(), credit: uuid() };
  const b = { businessId: uuid(), userId: uuid(), membershipId: uuid(), debit: uuid(), credit: uuid() };
  const viewerId = uuid();
  await withTenantContext(admin, { bypassRls: true }, async (tx) => {
    for (const fixture of [a, b]) {
      await tx.user.create({ data: {
        id: fixture.userId, username: `posting_${fixture.userId}`, fullName: "Posting Owner", passwordHash: "fixture",
      } });
      await tx.business.create({ data: { id: fixture.businessId, name: "Posting Test" } });
      await tx.membership.create({ data: { id: fixture.membershipId, businessId: fixture.businessId, userId: fixture.userId, role: "Owner" } });
      await tx.account.createMany({ data: [
        { id: fixture.debit, businessId: fixture.businessId, code: "CASH", name: "Cash", classification: "Asset" },
        { id: fixture.credit, businessId: fixture.businessId, code: "EQUITY", name: "Opening Equity", classification: "Equity" },
      ] });
    }
    await tx.user.create({ data: { id: viewerId, username: `viewer_${viewerId}`, fullName: "Viewer", passwordHash: "fixture" } });
    await tx.membership.create({ data: { businessId: a.businessId, userId: viewerId, role: "Viewer" } });
  });

  const command = (amount: string, commandId = uuid()): PostingCommand => ({
    businessId: a.businessId, userId: a.userId, commandId, sourceEventId: uuid(), journalEntryId: uuid(),
    datasetEpoch: 1, schemaVersion: 1, calculationVersion: 1,
    businessDate: "2026-10-17", effectKind: "opening", postingKind: "opening.cash",
    lines: [
      { id: uuid(), accountId: a.debit, debit: amount, credit: "0.00" },
      { id: uuid(), accountId: a.credit, debit: "0.00", credit: amount },
    ],
  });

  const original = command("100.00");
  const first = await postCommand(runtime, original);
  assert.equal(first.cursor, "1");
  assert.deepEqual(await postCommand(runtime, original), first, "Repeated delivery returns original receipt");
  await assert.rejects(postCommand(runtime, { ...original, businessDate: "2026-10-18" }), ChangedCommandError);

  const unauthorized = command("10.00");
  unauthorized.userId = viewerId;
  await assert.rejects(postCommand(runtime, unauthorized), /Posting authority required/);
  const wrongAccount = command("10.00");
  wrongAccount.lines = [wrongAccount.lines[0], { ...wrongAccount.lines[1], accountId: b.credit }];
  await assert.rejects(postCommand(runtime, wrongAccount), /Account missing from this business/);

  const interrupted = command("20.00");
  await assert.rejects(postCommand(runtime, interrupted, { beforeCommit: async () => { throw new Error("Simulated crash before commit"); } }), /Simulated crash/);
  const rolledBack = await withTenantContext(admin, { bypassRls: true }, async (tx) => tx.sourceEvent.findUnique({ where: { id: interrupted.sourceEventId } }));
  assert.equal(rolledBack, null);

  await assert.rejects(withTenantContext(runtime, { businessId: a.businessId, userId: a.userId }, async (tx) => {
    await tx.$executeRaw`INSERT INTO source_events (id,business_id,command_id,effect_kind,business_date)
      VALUES (${uuid()}::uuid,${a.businessId}::uuid,${uuid()}::uuid,'opening','2026-10-17'::date)`;
  }), /Use the posting service/);

  const unbalancedId = uuid();
  await assert.rejects(withTenantContext(runtime, { businessId: a.businessId, userId: a.userId }, async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.posting_context','true',true)`;
    const sourceId = uuid();
    await tx.$executeRaw`INSERT INTO source_events (id,business_id,command_id,effect_kind,business_date)
      VALUES (${sourceId}::uuid,${a.businessId}::uuid,${uuid()}::uuid,'opening','2026-10-17'::date)`;
    await tx.$executeRaw`INSERT INTO journal_entries (id,business_id,source_event_id,posting_kind,business_date)
      VALUES (${unbalancedId}::uuid,${a.businessId}::uuid,${sourceId}::uuid,'opening','2026-10-17'::date)`;
    await tx.$executeRaw`INSERT INTO journal_lines (id,business_id,journal_entry_id,account_id,debit,credit)
      VALUES (${uuid()}::uuid,${a.businessId}::uuid,${unbalancedId}::uuid,${a.debit}::uuid,10,0)`;
  }), /Unbalanced journal entry/);

  let release!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const firstLocked = new Promise<void>((resolve) => { locked = resolve; });
  const delayed = command("30.00");
  const later = command("40.00");
  const delayedPosting = postCommand(runtime, delayed, { afterHeadLock: async () => { locked(); await gate; } });
  await firstLocked;
  let laterFinished = false;
  const laterPosting = postCommand(runtime, later).then((receipt) => { laterFinished = true; return receipt; });
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(laterFinished, false, "Later cursor must wait for earlier transaction to commit");
  } finally {
    release();
  }
  const [second, third] = await Promise.all([delayedPosting, laterPosting]);
  assert.deepEqual([second.cursor, third.cursor], ["2", "3"]);
  const changes = await withTenantContext(runtime, { businessId: a.businessId, userId: a.userId }, async (tx) =>
    tx.changeBatch.findMany({ where: { businessId: a.businessId }, orderBy: { cursor: "asc" } }));
  assert.deepEqual(changes.map((c) => c.cursor.toString()), ["1", "2", "3"]);
  assert.equal(changes[1].sourceEventId, delayed.sourceEventId);
  assert.equal(changes[2].sourceEventId, later.sourceEventId);
});

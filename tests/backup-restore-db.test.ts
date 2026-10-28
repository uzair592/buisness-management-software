import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, withTenantContext } from "../packages/db/src/index";
import { postCommand } from "../packages/db/src/posting";

test("M11 encrypted backup archives, epoch fencing, restore promotion, and CSV import/export", async (t) => {
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
  async function register(label: string) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        username: `m11_${label}_${suffix}`,
        password: "CorrectBatteryHorse123!",
        fullName: "Owner User",
        businessName: `Biz_${label}_${suffix}`,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    return {
      businessId: res.json().business.id as string,
      userId: res.json().user.id as string,
      csrf: res.json().csrfToken as string,
      cookie: (res.headers["set-cookie"] as string[]).map((v) => v.split(";")[0]).join("; "),
    };
  }

  const ownerA = await register("A");
  const ownerB = await register("B");

  async function send(actor: typeof ownerA, method: "GET" | "POST", url: string, payload?: object) {
    return app.inject({
      method,
      url,
      headers: { cookie: actor.cookie, "x-csrf-token": actor.csrf },
      ...(payload ? { payload } : {}),
    });
  }

  // 1. Setup accounts and a sample item & party for BizA
  const sysRes = await send(ownerA, "POST", "/v1/accounts/system");
  assert.equal(sysRes.statusCode, 200);

  const unitRes = await send(ownerA, "POST", "/v1/catalogue/units", { code: "PCS", name: "Pieces" });
  assert.equal(unitRes.statusCode, 201);

  const itemRes = await send(ownerA, "POST", "/v1/catalogue/items", {
    name: "Existing Item A",
    kind: "Goods",
    sku: "SKU-EXISTING",
    barcode: "BAR-100",
    salePrice: "15.00",
    baseUnitId: unitRes.json().id,
    categoryId: null,
    taxProfileId: null,
  });
  assert.equal(itemRes.statusCode, 201);

  const partyRes = await send(ownerA, "POST", "/v1/catalogue/parties", {
    name: "Existing Customer A",
    isCustomer: true,
    isSupplier: false,
    phone: "1234567890",
    email: "customer@biza.local",
  });
  assert.equal(partyRes.statusCode, 201);

  // 2. CSV Dry Run for Items
  const validCsv = `Name,Price,SKU,Barcode\n"Widget Alpha",19.99,SKU-A1,BC-001\n"Widget Beta",25.50,SKU-B2,BC-002`;
  const dryRunRes = await send(ownerA, "POST", "/v1/import/items/dry-run", { csvText: validCsv });
  assert.equal(dryRunRes.statusCode, 200, dryRunRes.body);
  const dryData = dryRunRes.json();
  assert.equal(dryData.totalRows, 2);
  assert.equal(dryData.validRows, 2);
  assert.equal(dryData.invalidRows, 0);

  // 3. CSV Dry Run with Validation Errors (Bad Price, Duplicate SKU)
  const badCsv = `Name,Price,SKU\n"Bad Price Item",-5.00,SKU-ERR1\n"Existing SKU Item",10.00,SKU-EXISTING\n"",12.00,SKU-NONAME`;
  const badDryRes = await send(ownerA, "POST", "/v1/import/items/dry-run", { csvText: badCsv });
  assert.equal(badDryRes.statusCode, 200);
  const badData = badDryRes.json();
  assert.equal(badData.totalRows, 3);
  assert.equal(badData.invalidRows, 3);
  assert.equal(badData.errors.length, 3);

  // 4. CSV Commit for Items (with Idempotency)
  const batchId = crypto.randomUUID();
  const commitItemsPayload = {
    batchId,
    items: dryData.preview,
  };
  const commitRes1 = await send(ownerA, "POST", "/v1/import/items/commit", commitItemsPayload);
  assert.equal(commitRes1.statusCode, 200, commitRes1.body);
  assert.equal(commitRes1.json().count, 2);
  assert.equal(commitRes1.json().alreadyCommitted, undefined);

  // Re-committing with identical batchId should be idempotent
  const commitRes2 = await send(ownerA, "POST", "/v1/import/items/commit", commitItemsPayload);
  assert.equal(commitRes2.statusCode, 200);
  assert.equal(commitRes2.json().count, 2);
  assert.equal(commitRes2.json().alreadyCommitted, true);

  // 5. CSV Parties Dry Run & Commit
  const partyCsv = `Name,Phone,Email,Type\n"Supplier One",555-1234,sup@test.com,Supplier\n"=Formula Party",555-9999,hacker@calc.org,Customer`;
  const partyDryRes = await send(ownerA, "POST", "/v1/import/parties/dry-run", { csvText: partyCsv });
  assert.equal(partyDryRes.statusCode, 200);
  assert.equal(partyDryRes.json().validRows, 2);

  const partyBatchId = crypto.randomUUID();
  const partyCommitRes = await send(ownerA, "POST", "/v1/import/parties/commit", {
    batchId: partyBatchId,
    parties: partyDryRes.json().preview,
  });
  assert.equal(partyCommitRes.statusCode, 200);
  assert.equal(partyCommitRes.json().count, 2);

  // 6. CSV Export with Formula Injection Sanitization
  const exportItemsRes = await send(ownerA, "GET", "/v1/export/items.csv");
  assert.equal(exportItemsRes.statusCode, 200);
  assert.ok(exportItemsRes.headers["content-type"]?.includes("text/csv"));
  assert.ok(exportItemsRes.body.includes("Widget Alpha"));

  const exportPartiesRes = await send(ownerA, "GET", "/v1/export/parties.csv");
  assert.equal(exportPartiesRes.statusCode, 200);
  // Party name starting with '=' should be prepended with single quote "'" for formula safety
  assert.ok(exportPartiesRes.body.includes("'=Formula Party"));

  // 7. Backup Archive Export (Encrypted Envelope)
  const passphrase = "CorrectHorseBatteryPassphrase456!";
  const exportBackupRes = await send(ownerA, "POST", "/v1/backup/export", { passphrase });
  assert.equal(exportBackupRes.statusCode, 200, exportBackupRes.body);
  const envelope = exportBackupRes.json();
  assert.ok(envelope.encryptedDataHex);
  assert.ok(envelope.ivHex);
  assert.ok(envelope.saltHex);
  assert.ok(envelope.authTagHex);
  assert.equal(envelope.businessId, ownerA.businessId);
  assert.ok(envelope.checksumSha256);

  // 8. Backup Inspection: Wrong Passphrase Rejection
  const badInspectRes = await send(ownerA, "POST", "/v1/backup/inspect", {
    envelope,
    passphrase: "WrongPassword123!",
  });
  assert.equal(badInspectRes.statusCode, 400);
  assert.ok(badInspectRes.json().error.includes("decrypt archive"));

  // Backup Inspection: Correct Passphrase
  const goodInspectRes = await send(ownerA, "POST", "/v1/backup/inspect", {
    envelope,
    passphrase,
  });
  assert.equal(goodInspectRes.statusCode, 200, goodInspectRes.body);
  const inspectData = goodInspectRes.json();
  assert.equal(inspectData.valid, true);
  assert.equal(inspectData.manifest.datasetEpoch, 1);
  assert.equal(inspectData.activeBusiness.currentEpoch, 1);

  // Cross-tenant: BizB cannot inspect BizA's archive
  const crossInspectRes = await send(ownerB, "POST", "/v1/backup/inspect", {
    envelope,
    passphrase,
  });
  assert.equal(crossInspectRes.statusCode, 403);

  // 9. Restore Promotion & Dataset Epoch Fencing
  const promoteRes = await send(ownerA, "POST", "/v1/backup/promote", {
    envelope,
    passphrase,
    confirmation: "RESTORE AND ADVANCE EPOCH",
  });
  assert.equal(promoteRes.statusCode, 200, promoteRes.body);
  assert.equal(promoteRes.json().success, true);
  assert.equal(promoteRes.json().newDatasetEpoch, 2);

  // Verify datasetEpoch advanced in database
  const { bizAInDb, headA } = await withTenantContext(
    db,
    { businessId: ownerA.businessId, userId: ownerA.userId },
    async (tx) => {
      const biz = await tx.business.findUnique({ where: { id: ownerA.businessId } });
      const head = await tx.syncHead.findUnique({ where: { businessId: ownerA.businessId } });
      return { bizAInDb: biz, headA: head };
    },
  );
  assert.equal(bizAInDb?.datasetEpoch, 2);
  assert.equal(headA?.datasetEpoch, 2);

  // 10. Verify Epoch Fencing: Command with stale epoch 1 MUST be rejected!
  const accs = await withTenantContext(db, { businessId: ownerA.businessId }, async (tx) => {
    return await tx.account.findMany({ where: { businessId: ownerA.businessId }, take: 2 });
  });
  assert.ok(accs.length >= 2);
  const acc1 = accs[0].id;
  const acc2 = accs[1].id;

  const lines = [
    { id: crypto.randomUUID(), accountId: acc1, debit: "10.00", credit: "0.00" },
    { id: crypto.randomUUID(), accountId: acc2, debit: "0.00", credit: "10.00" },
  ];

  const staleCommand = {
    businessId: ownerA.businessId,
    userId: ownerA.userId,
    commandId: crypto.randomUUID(),
    sourceEventId: crypto.randomUUID(),
    journalEntryId: crypto.randomUUID(),
    datasetEpoch: 1, // Stale epoch!
    schemaVersion: 1 as const,
    calculationVersion: 1 as const,
    businessDate: "2026-10-28",
    effectKind: "sale" as const,
    postingKind: "sale.post",
    lines,
  };

  await assert.rejects(
    async () => {
      await postCommand(db, staleCommand);
    },
    (err: Error) => {
      assert.ok(err.message.includes("Dataset epoch mismatch"));
      return true;
    },
  );

  // Command with active epoch 2 is accepted by the epoch gate
  const validEpochCommand = {
    ...staleCommand,
    commandId: crypto.randomUUID(),
    sourceEventId: crypto.randomUUID(),
    journalEntryId: crypto.randomUUID(),
    datasetEpoch: 2, // Active epoch!
    lines: [
      { id: crypto.randomUUID(), accountId: acc1, debit: "10.00", credit: "0.00" },
      { id: crypto.randomUUID(), accountId: acc2, debit: "0.00", credit: "10.00" },
    ],
  };

  const postResult = await postCommand(db, validEpochCommand);
  assert.ok(postResult.cursor);
});

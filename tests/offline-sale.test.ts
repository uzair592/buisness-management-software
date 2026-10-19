import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PartitionedLocalDatabase, bootstrapLocalIdentity, installCatalogueSnapshot } from "../apps/web/src/db/index";
import { issueOfflineCashSale, type OfflineCashInput } from "../apps/web/src/db/offline-sale";
import { exportPendingRecovery, listPendingPartitions } from "../apps/web/src/db/recovery";
import type { IdentityBootstrap } from "../packages/contracts/src/index";

const id = () => crypto.randomUUID();
const businessId = id(), memberId = id(), deviceId = id(), locationId = id(), accountId = id(), itemId = id();
function identity(): IdentityBootstrap {
  return { business: { id: businessId, name: "Shop", currency: "PKR", timezone: "Asia/Karachi", datasetEpoch: 1 },
    membership: { id: memberId, businessId, businessName: "Shop", role: "Cashier", permissionVersion: 1,
      locationId, locationName: "Shop" },
    device: { id: deviceId, businessId, membershipId: memberId, locationId, deviceName: "Till",
      numberPrefix: "D01", status: "Enrolled", enrolledAt: new Date().toISOString(), revokedAt: null },
    lease: { id: id(), businessId, deviceEnrollmentId: deviceId, membershipId: memberId,
      datasetEpoch: 1, policyVersion: 1, issuedAt: new Date(Date.now() - 60000).toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(), revokedAt: null, signature: "signed-lease" },
    permittedLocations: [{ id: locationId, code: "L01", name: "Shop" }],
    rolePermissions: { role: "Cashier", capabilities: ["trade:write", "offline:lease"] } };
}
function sale(): OfflineCashInput {
  return { id: id(), commandId: id(), deviceEnrollmentId: deviceId, locationId, partyId: null,
    businessDate: new Date().toISOString().slice(0, 10), documentDiscount: "0", lines: [
      { id: id(), itemId, conversionId: null, taxProfileId: null, quantity: "1", unitPrice: "10.00", discount: "0" },
    ], payments: [{ id: id(), accountId, kind: "Cash", applied: "10.00", tendered: "20.00", reference: null }] };
}
async function setup(name: string) {
  const db = new PartitionedLocalDatabase(name);
  const payload = identity();
  await bootstrapLocalIdentity(db, payload);
  await installCatalogueSnapshot(db, { business: payload.business, syncCursor: "0", catalogue: {
    items: [{ id: itemId, name: "Bottle", kind: "Goods", salePrice: "10.00", taxProfileId: null }],
    cashAccounts: [{ id: accountId, name: "Till", kind: "Cash" }],
    parties: [], categories: [], units: [], taxProfiles: [], conversions: [], sales: [], accountSetup: null,
  } }, false);
  return db;
}

test("two tabs issue unique numbers atomically; reopen retains frozen receipt and queue", async () => {
  const name = `issue-${id()}`;
  const first = await setup(name);
  const second = new PartitionedLocalDatabase(name);
  try {
    const [a, b] = await Promise.all([issueOfflineCashSale(first, sale()), issueOfflineCashSale(second, sale())]);
    assert.deepEqual([a.number, b.number].sort(), ["D01-O-000001", "D01-O-000002"]);
    first.close(); second.close();
    const reopened = new PartitionedLocalDatabase(name);
    assert.equal(await reopened.issuedSales.count(), 2);
    assert.equal(await reopened.pending.where("state").equals("queued").count(), 2);
    assert.equal((await reopened.issuedSales.get(a.id))?.number, a.number);
    reopened.close();
  } finally { await first.delete(); }
});

test("aborted storage transaction and expired lease never display a saved number", async () => {
  const db = await setup(`issue-${id()}`);
  try {
    const abort = () => { throw new Error("quota failed"); };
    db.pending.hook("creating", abort);
    await assert.rejects(issueOfflineCashSale(db, sale()), /quota failed/);
    db.pending.hook("creating").unsubscribe(abort);
    assert.equal(await db.issuedSales.count(), 0);
    assert.equal(await db.pending.count(), 0);
    assert.equal(await db.syncState.get("offlineSaleSequence"), undefined);
    const lease = await db.lease.toCollection().first();
    await db.lease.update(lease!.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await assert.rejects(issueOfflineCashSale(db, sale()), /Offline authority/);
    assert.equal(await db.issuedSales.count(), 0);
  } finally { db.close(); await db.delete(); }
});

test("recovery export encrypts pending receipt and rejects the wrong passphrase", async () => {
  const db = await setup(`issue-${id()}`);
  try {
    const saved = await issueOfflineCashSale(db, sale());
    const encrypted = await exportPendingRecovery(db, "a sufficiently long passphrase");
    assert.ok(!encrypted.includes(saved.number));
    assert.ok(!encrypted.includes("Bottle"));
    const bundle = JSON.parse(encrypted) as { salt: string; iv: string; ciphertext: string; iterations: number };
    const bytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const derive = async (passphrase: string) => crypto.subtle.deriveKey({ name: "PBKDF2",
      salt: bytes(bundle.salt), iterations: bundle.iterations, hash: "SHA-256" },
      await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]),
      { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const decrypt = async (passphrase: string) => crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(bundle.iv) },
      await derive(passphrase), bytes(bundle.ciphertext));
    await assert.rejects(decrypt("wrong long passphrase"));
    const recovered = JSON.parse(new TextDecoder().decode(await decrypt("a sufficiently long passphrase")));
    assert.equal(recovered.pending[0].commandId, saved.commandId);
    assert.equal(recovered.issuedSales[0].number, saved.number);
  } finally { db.close(); await db.delete(); }
});

test("older epoch pending work stays discoverable only for its user and business", async () => {
  const userId = id();
  const db = await setup(`bms_${userId}_${businessId}_${deviceId}_ep1`);
  try {
    await db.identity.put({ key: "user", value: { id: userId } });
    await issueOfflineCashSale(db, sale());
    assert.equal((await listPendingPartitions(userId, businessId))[0]?.count, 1);
    assert.deepEqual(await listPendingPartitions(id(), businessId), []);
    assert.deepEqual(await listPendingPartitions(userId, id()), []);
  } finally { db.close(); await db.delete(); }
});

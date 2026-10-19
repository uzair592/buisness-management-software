import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PartitionedLocalDatabase, bootstrapLocalIdentity, installCatalogueSnapshot, applyCataloguePull,
} from "../apps/web/src/db/index";
import type { IdentityBootstrap } from "../packages/contracts/src/index";

const businessId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000002";
const memberId = "00000000-0000-4000-8000-000000000003";
const locationId = "00000000-0000-4000-8000-000000000004";
const itemId = "00000000-0000-4000-8000-000000000005";
function identity(role: "Owner" | "Cashier" = "Cashier"): IdentityBootstrap {
  return {
    business: { id: businessId, name: "Shop", currency: "PKR", timezone: "Asia/Karachi", datasetEpoch: 1 },
    membership: { id: memberId, businessId, businessName: "Shop", role,
      permissionVersion: 1, locationId, locationName: "Shop floor" },
    device: { id: deviceId, businessId, membershipId: memberId, locationId,
      deviceName: "Counter", numberPrefix: "D01", status: "Enrolled",
      enrolledAt: new Date().toISOString(), revokedAt: null },
    lease: { id: "00000000-0000-4000-8000-000000000006", businessId,
      deviceEnrollmentId: deviceId, membershipId: memberId, datasetEpoch: 1, policyVersion: 1,
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
      revokedAt: null, signature: "test" },
    permittedLocations: [{ id: locationId, code: "L01", name: "Shop floor" }],
    rolePermissions: { role, capabilities: ["trade:read"] },
  };
}
function snapshot(business: IdentityBootstrap["business"], cursor = "4") {
  return { business, syncCursor: cursor, catalogue: {
    items: [{ id: itemId, name: "A", salePrice: "10.00" }], parties: [], categories: [],
    units: [], taxProfiles: [], conversions: [], sales: [], cashAccounts: [], accountSetup: null,
  } };
}

test("catalogue pull resumes after interruption, preserves pending work on resnapshot, and rejects wrong scope", async () => {
  const db = new PartitionedLocalDatabase(`catalogue-${crypto.randomUUID()}`);
  const bootstrap = identity();
  try {
    await bootstrapLocalIdentity(db, bootstrap);
    await db.pending.put({ commandId: "local-issued", state: "held", payload: { number: "D01-000001" } });
    await installCatalogueSnapshot(db, snapshot(bootstrap.business), false);
    assert.equal((await db.syncState.get("catalogueCursor"))?.value, "4");

    // A transport failure before local application leaves both row and cursor intact.
    await assert.rejects(applyCataloguePull(db, { datasetEpoch: 1, fromCursor: "4", nextCursor: "6",
      changes: [{ cursor: "5", action: "item.edit", row: { id: itemId, name: "B" } },
        { cursor: "7", action: "item.edit", row: { id: itemId, name: "C" } }] }, false));
    assert.equal((await db.catalogue.get(`item:${itemId}`))?.row.name, "A");
    assert.equal((await db.syncState.get("catalogueCursor"))?.value, "4");

    await applyCataloguePull(db, { datasetEpoch: 1, fromCursor: "4", nextCursor: "6",
      changes: [{ cursor: "5", action: "item.edit", row: { id: itemId, name: "B" } }] }, false);
    assert.equal((await db.catalogue.get(`item:${itemId}`))?.row.name, "B");
    assert.equal((await db.syncState.get("catalogueCursor"))?.value, "6");
    await applyCataloguePull(db, { datasetEpoch: 1, fromCursor: "6", nextCursor: "7",
      changes: [{ cursor: "7", action: "sale.post", row: { id: itemId, number: "D01-000001", total: "10.00" } }] }, false);
    assert.equal((await db.catalogue.get(`sale:${itemId}`))?.row.number, "D01-000001");
    await assert.rejects(applyCataloguePull(db, { datasetEpoch: 1, fromCursor: "4", nextCursor: "6", changes: [] }, false));
    await assert.rejects(installCatalogueSnapshot(db, snapshot({ ...bootstrap.business, datasetEpoch: 2 }), false));
    await installCatalogueSnapshot(db, snapshot(bootstrap.business, "8"), false);
    assert.equal((await db.pending.get("local-issued"))?.payload &&
      (await db.pending.get("local-issued"))?.state, "held");
    assert.equal((await db.syncState.get("catalogueCursor"))?.value, "8");
  } finally { db.close(); await db.delete(); }
});

test("cashier catalogue refuses private account changes and data", async () => {
  const db = new PartitionedLocalDatabase(`catalogue-${crypto.randomUUID()}`);
  try {
    const bootstrap = identity();
    await bootstrapLocalIdentity(db, bootstrap);
    await installCatalogueSnapshot(db, { ...snapshot(bootstrap.business, "0"), catalogue: {
      ...snapshot(bootstrap.business).catalogue,
      accountSetup: { accounts: [{ id: itemId, code: "BANK", balance: "100" }], expenseCategories: [] },
    } }, false);
    assert.equal(await db.catalogue.where("group").equals("account").count(), 0);
    await assert.rejects(applyCataloguePull(db, { datasetEpoch: 1, fromCursor: "0", nextCursor: "1",
      changes: [{ cursor: "1", action: "account.edit", row: { id: itemId, balance: "100" } }] }, false));
    assert.equal((await db.syncState.get("catalogueCursor"))?.value, "0");
  } finally { db.close(); await db.delete(); }
});

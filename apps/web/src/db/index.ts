import Dexie, { type Table } from "dexie";
import type { IdentityBootstrap } from "@business/contracts";

export interface LocalIdentityRecord {
  key: string;
  value: unknown;
}

export interface LocalLocationRecord {
  id: string;
  code: string;
  name: string;
}

export interface LocalDeviceRecord {
  id: string;
  businessId: string;
  membershipId: string;
  locationId: string;
  deviceName: string;
  numberPrefix: string;
  status: string;
  enrolledAt: string;
  revokedAt: string | null;
}

export interface LocalLeaseRecord {
  id: string;
  businessId: string;
  deviceEnrollmentId: string;
  membershipId: string;
  datasetEpoch: number;
  policyVersion: number;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  signature: string;
}

export interface LocalSyncStateRecord {
  key: string;
  value: unknown;
}

export interface LocalCatalogueRecord {
  key: string;
  group: string;
  row: Record<string, unknown>;
}

export interface LocalPendingRecord {
  commandId: string;
  state: "queued" | "blocked" | "held";
  payload: unknown;
}

export interface CatalogueSnapshot {
  business: IdentityBootstrap["business"];
  catalogue: Record<string, unknown>;
  syncCursor: string;
}

export interface CataloguePull {
  datasetEpoch: number;
  fromCursor: string;
  nextCursor: string;
  changes: Array<{ cursor: string; action: string; row: Record<string, unknown> }>;
}

const catalogueGroups = ["item", "party", "category", "unit", "tax_profile", "conversion", "account", "expense_category"] as const;
const snapshotGroups: Record<string, string> = {
  items: "item", parties: "party", categories: "category", units: "unit",
  taxProfiles: "tax_profile", conversions: "conversion", accounts: "account",
  expenseCategories: "expense_category",
};
const cursorValue = (value: string): bigint => {
  if (!/^\d{1,19}$/.test(value)) throw new Error("Invalid sync cursor");
  return BigInt(value);
};

export class PartitionedLocalDatabase extends Dexie {
  identity!: Table<LocalIdentityRecord, string>;
  locations!: Table<LocalLocationRecord, string>;
  device!: Table<LocalDeviceRecord, string>;
  lease!: Table<LocalLeaseRecord, string>;
  syncState!: Table<LocalSyncStateRecord, string>;
  catalogue!: Table<LocalCatalogueRecord, string>;
  pending!: Table<LocalPendingRecord, string>;

  constructor(dbName: string) {
    super(dbName);

    // Version 1: Identity & bootstrap baseline
    this.version(1).stores({
      identity: "key",
      locations: "id, code",
      device: "id, numberPrefix, status",
      lease: "id, deviceEnrollmentId, expiresAt",
      syncState: "key",
    });
    // The pending store is deliberately outside snapshot replacement. A resnapshot
    // must never delete issued local work awaiting acknowledgement or review.
    this.version(2).stores({
      identity: "key", locations: "id, code", device: "id, numberPrefix, status",
      lease: "id, deviceEnrollmentId, expiresAt", syncState: "key",
      catalogue: "key, group", pending: "commandId, state",
    });
  }
}

export async function installCatalogueSnapshot(db: PartitionedLocalDatabase, snapshot: CatalogueSnapshot,
  permittedPrivateAccounts: boolean): Promise<void> {
  const cached = await db.identity.get("business");
  const business = cached?.value as IdentityBootstrap["business"] | undefined;
  if (!business || business.id !== snapshot.business.id || business.datasetEpoch !== snapshot.business.datasetEpoch)
    throw new Error("Snapshot scope or epoch changed; keep pending work for review");
  const cursor = cursorValue(snapshot.syncCursor);
  const data = snapshot.catalogue;
  const accountSetup = data.accountSetup as Record<string, unknown> | null | undefined;
  const rows: LocalCatalogueRecord[] = [];
  for (const [field, group] of Object.entries(snapshotGroups)) {
    const source = field === "accounts" || field === "expenseCategories" ? accountSetup?.[field] : data[field];
    if ((group === "account" || group === "expense_category") && !permittedPrivateAccounts) continue;
    if (!Array.isArray(source)) throw new Error(`Incomplete catalogue snapshot: ${field}`);
    for (const row of source) {
      if (!row || typeof row !== "object" || typeof row.id !== "string") throw new Error("Invalid catalogue row");
      rows.push({ key: `${group}:${row.id}`, group, row });
    }
  }
  await db.transaction("rw", db.catalogue, db.syncState, async () => {
    await db.catalogue.clear();
    await db.catalogue.bulkPut(rows);
    await db.syncState.put({ key: "catalogueCursor", value: cursor.toString() });
  });
}

export async function applyCataloguePull(db: PartitionedLocalDatabase, pull: CataloguePull,
  permittedPrivateAccounts: boolean): Promise<void> {
  const business = (await db.identity.get("business"))?.value as IdentityBootstrap["business"] | undefined;
  if (!business || business.datasetEpoch !== pull.datasetEpoch) throw new Error("Dataset epoch changed; keep local work for review");
  const from = cursorValue(pull.fromCursor);
  const next = cursorValue(pull.nextCursor);
  if (next < from) throw new Error("Sync cursor moved backwards");
  const changes = pull.changes.flatMap((change) => {
    const cursor = cursorValue(change.cursor);
    if (cursor <= from || cursor > next) throw new Error("Change outside pull range");
    if (change.action === "account.system_init" && permittedPrivateAccounts) {
      if (!Array.isArray(change.row.accounts)) throw new Error("Invalid system account change");
      return change.row.accounts.map((row: unknown) => {
        if (!row || typeof row !== "object" || typeof (row as { id?: unknown }).id !== "string")
          throw new Error("Invalid system account");
        const account = row as Record<string, unknown>;
        return { group: "account", row: account, key: `account:${account.id}` };
      });
    }
    const group = change.action.split(".")[0];
    if (!catalogueGroups.includes(group as typeof catalogueGroups[number]) ||
      ((group === "account" || group === "expense_category") && !permittedPrivateAccounts))
      throw new Error("Unexpected catalogue change scope");
    if (typeof change.row.id !== "string") throw new Error("Invalid catalogue change");
    return [{ group, row: change.row, key: `${group}:${change.row.id}` }];
  });
  await db.transaction("rw", db.catalogue, db.syncState, async () => {
    const saved = await db.syncState.get("catalogueCursor");
    if (cursorValue(String(saved?.value ?? "-1")) !== from) throw new Error("Pull starts at a different saved cursor");
    for (const change of changes) await db.catalogue.put(change);
    await db.syncState.put({ key: "catalogueCursor", value: next.toString() });
  });
}

// Generate deterministic partitioned database name per user, business, enrollment, epoch
export function getPartitionDbName(params: {
  userId: string;
  businessId: string;
  enrollmentId: string;
  datasetEpoch: number;
}): string {
  return `bms_${params.userId}_${params.businessId}_${params.enrollmentId}_ep${params.datasetEpoch}`;
}

let activeDb: PartitionedLocalDatabase | null = null;
let activeDbName: string | null = null;

export function getLocalDatabase(params: {
  userId: string;
  businessId: string;
  enrollmentId: string;
  datasetEpoch: number;
}): PartitionedLocalDatabase {
  const name = getPartitionDbName(params);
  if (activeDb && activeDbName === name) {
    return activeDb;
  }

  if (activeDb) {
    activeDb.close();
  }

  activeDb = new PartitionedLocalDatabase(name);
  activeDbName = name;
  return activeDb;
}

export function closeActiveLocalDb(): void {
  if (activeDb) {
    activeDb.close();
    activeDb = null;
    activeDbName = null;
  }
}

export async function bootstrapLocalIdentity(
  db: PartitionedLocalDatabase,
  bootstrap: IdentityBootstrap,
): Promise<void> {
  await db.transaction(
    "rw",
    [db.identity, db.locations, db.device, db.lease, db.syncState],
    async () => {
      // Store business & membership details without secrets
      await db.identity.put({ key: "business", value: bootstrap.business });
      await db.identity.put({ key: "membership", value: bootstrap.membership });
      await db.identity.put({
        key: "rolePermissions",
        value: bootstrap.rolePermissions,
      });

      // Clear old locations and put permitted locations
      await db.locations.clear();
      for (const loc of bootstrap.permittedLocations) {
        await db.locations.put(loc);
      }

      // Store device enrollment
      await db.device.put(bootstrap.device);

      // Store offline lease
      await db.lease.put(bootstrap.lease);

      // Record sync state
      await db.syncState.put({
        key: "lastBootstrapAt",
        value: new Date().toISOString(),
      });
      await db.syncState.put({
        key: "datasetEpoch",
        value: bootstrap.business.datasetEpoch,
      });
    },
  );
}

export async function readCachedIdentity(db: PartitionedLocalDatabase) {
  const business = await db.identity.get("business");
  const membership = await db.identity.get("membership");
  const rolePermissions = await db.identity.get("rolePermissions");
  const device = await db.device.toCollection().first();
  const lease = await db.lease.toCollection().first();
  const locations = await db.locations.toArray();

  return {
    business: (business?.value as IdentityBootstrap["business"] | undefined) ?? null,
    membership: (membership?.value as IdentityBootstrap["membership"] | undefined) ?? null,
    rolePermissions:
      (rolePermissions?.value as IdentityBootstrap["rolePermissions"] | undefined) ?? null,
    device: device ?? null,
    lease: lease ?? null,
    locations,
  };
}

export function isOfflineLeaseValid(lease: LocalLeaseRecord | null): boolean {
  if (!lease) return false;
  if (lease.revokedAt) return false;
  const expiry = new Date(lease.expiresAt).getTime();
  return Date.now() < expiry;
}

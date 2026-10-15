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

export class PartitionedLocalDatabase extends Dexie {
  identity!: Table<LocalIdentityRecord, string>;
  locations!: Table<LocalLocationRecord, string>;
  device!: Table<LocalDeviceRecord, string>;
  lease!: Table<LocalLeaseRecord, string>;
  syncState!: Table<LocalSyncStateRecord, string>;

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
  }
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

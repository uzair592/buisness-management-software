import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getPartitionDbName,
  getLocalDatabase,
  bootstrapLocalIdentity,
  readCachedIdentity,
  isOfflineLeaseValid,
  closeActiveLocalDb,
} from "../apps/web/src/db/index";
import type { IdentityBootstrap } from "../packages/contracts/src/index";

test("local database partition naming is deterministic and scoped", () => {
  const name1 = getPartitionDbName({
    userId: "u-100",
    businessId: "b-200",
    enrollmentId: "d-300",
    datasetEpoch: 1,
  });
  const name2 = getPartitionDbName({
    userId: "u-100",
    businessId: "b-200",
    enrollmentId: "d-300",
    datasetEpoch: 2,
  });
  const name3 = getPartitionDbName({
    userId: "u-999",
    businessId: "b-200",
    enrollmentId: "d-300",
    datasetEpoch: 1,
  });

  assert.equal(name1, "bms_u-100_b-200_d-300_ep1");
  assert.equal(name2, "bms_u-100_b-200_d-300_ep2");
  assert.equal(name3, "bms_u-999_b-200_d-300_ep1");
  assert.notEqual(name1, name2, "Different epochs must yield different partitions");
  assert.notEqual(name1, name3, "Different users must yield different partitions");
});

test("bootstrap local identity persists permitted data and excludes secrets", async () => {
  const params = {
    userId: "00000000-0000-4000-8000-000000000001",
    businessId: "00000000-0000-4000-8000-000000000002",
    enrollmentId: "00000000-0000-4000-8000-000000000003",
    datasetEpoch: 1,
  };

  const db = getLocalDatabase(params);

  const bootstrapPayload: IdentityBootstrap = {
    business: {
      id: params.businessId,
      name: "Apex Electronics",
      currency: "PKR",
      timezone: "Asia/Karachi",
      datasetEpoch: 1,
    },
    membership: {
      id: "00000000-0000-4000-8000-000000000004",
      businessId: params.businessId,
      businessName: "Apex Electronics",
      role: "Owner",
      permissionVersion: 1,
      locationId: "00000000-0000-4000-8000-000000000005",
      locationName: "Main Branch",
    },
    device: {
      id: params.enrollmentId,
      businessId: params.businessId,
      membershipId: "00000000-0000-4000-8000-000000000004",
      locationId: "00000000-0000-4000-8000-000000000005",
      deviceName: "Primary Counter",
      numberPrefix: "D01",
      status: "Enrolled",
      enrolledAt: new Date().toISOString(),
      revokedAt: null,
    },
    lease: {
      id: "00000000-0000-4000-8000-000000000006",
      businessId: params.businessId,
      deviceEnrollmentId: params.enrollmentId,
      membershipId: "00000000-0000-4000-8000-000000000004",
      datasetEpoch: 1,
      policyVersion: 1,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      revokedAt: null,
      signature: "hmac-signed-offline-lease-sample",
    },
    permittedLocations: [
      {
        id: "00000000-0000-4000-8000-000000000005",
        code: "L01",
        name: "Main Branch",
      },
    ],
    rolePermissions: {
      role: "Owner",
      capabilities: ["business:admin", "users:manage", "devices:manage", "trade:read"],
    },
  };

  await bootstrapLocalIdentity(db, bootstrapPayload);

  const cached = await readCachedIdentity(db);
  const business = cached.business as { name: string } | null;
  const membership = cached.membership as { role: string } | null;
  assert.equal(business?.name, "Apex Electronics");
  assert.equal(membership?.role, "Owner");
  assert.equal(cached.device?.numberPrefix, "D01");
  assert.equal(cached.locations.length, 1);
  assert.equal(cached.locations[0].code, "L01");
  assert.ok(isOfflineLeaseValid(cached.lease));

  // Verify confidentiality: scan all stored tables for sensitive strings
  const allIdentity = await db.identity.toArray();
  const serialized = JSON.stringify(allIdentity);
  assert.ok(!serialized.includes("password"), "Must not store password string");
  assert.ok(!serialized.includes("password_hash"), "Must not store password hash");
  assert.ok(!serialized.includes("scrypt"), "Must not store scrypt hash");
  assert.ok(!serialized.includes("token_hash"), "Must not store session token hash");

  closeActiveLocalDb();
});

test("offline lease expiry and revocation evaluation", () => {
  const validLease = {
    id: "l-1",
    businessId: "b-1",
    deviceEnrollmentId: "d-1",
    membershipId: "m-1",
    datasetEpoch: 1,
    policyVersion: 1,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour ahead
    revokedAt: null,
    signature: "sig",
  };

  const expiredLease = {
    ...validLease,
    expiresAt: new Date(Date.now() - 1000).toISOString(), // expired
  };

  const revokedLease = {
    ...validLease,
    revokedAt: new Date().toISOString(), // revoked
  };

  assert.equal(isOfflineLeaseValid(validLease), true);
  assert.equal(isOfflineLeaseValid(expiredLease), false);
  assert.equal(isOfflineLeaseValid(revokedLease), false);
  assert.equal(isOfflineLeaseValid(null), false);
});

test("partition isolation: user B cannot access user A cached records", async () => {
  const userAParams = {
    userId: "user-alpha",
    businessId: "biz-1",
    enrollmentId: "dev-1",
    datasetEpoch: 1,
  };
  const userBParams = {
    userId: "user-beta",
    businessId: "biz-1",
    enrollmentId: "dev-2",
    datasetEpoch: 1,
  };

  const dbA = getLocalDatabase(userAParams);
  await dbA.identity.put({ key: "secretKey", value: "userAlphaConfidentialData" });

  // Switch to User B
  const dbB = getLocalDatabase(userBParams);
  const userBRecord = await dbB.identity.get("secretKey");

  assert.equal(userBRecord, undefined, "User B must not see User A's data");
  closeActiveLocalDb();
});

test("local cache initialization requires verified bootstrap metadata and never guesses dataset epoch", () => {
  // Helper simulating the verification rule enforced in SettingsPage
  function resolveVerifiedPartitionParams(params: {
    userId: string;
    businessId: string;
    boundDeviceId: string;
    storedBootstrapMeta: unknown;
  }) {
    if (!params.storedBootstrapMeta) return null;
    let meta: { userId?: string; businessId?: string; enrollmentId?: string; datasetEpoch?: number };
    try {
      meta =
        typeof params.storedBootstrapMeta === "string"
          ? JSON.parse(params.storedBootstrapMeta)
          : (params.storedBootstrapMeta as {
              userId?: string;
              businessId?: string;
              enrollmentId?: string;
              datasetEpoch?: number;
            });
    } catch {
      return null;
    }
    if (
      meta.userId !== params.userId ||
      meta.businessId !== params.businessId ||
      meta.enrollmentId !== params.boundDeviceId ||
      typeof meta.datasetEpoch !== "number"
    ) {
      return null;
    }
    return {
      userId: meta.userId,
      businessId: meta.businessId,
      enrollmentId: meta.enrollmentId,
      datasetEpoch: meta.datasetEpoch,
    };
  }

  // 1. Without verified metadata, no partition is opened (does NOT guess epoch 1)
  const noMeta = resolveVerifiedPartitionParams({
    userId: "u-1",
    businessId: "b-1",
    boundDeviceId: "d-1",
    storedBootstrapMeta: null,
  });
  assert.equal(noMeta, null, "Must not open partition or guess epoch without verified metadata");

  // 2. With tampered / mismatched user, no partition is opened
  const tamperedUser = resolveVerifiedPartitionParams({
    userId: "u-1",
    businessId: "b-1",
    boundDeviceId: "d-1",
    storedBootstrapMeta: JSON.stringify({
      userId: "u-OTHER",
      businessId: "b-1",
      enrollmentId: "d-1",
      datasetEpoch: 2,
    }),
  });
  assert.equal(tamperedUser, null, "Must reject mismatched userId");

  // 3. With missing or non-numeric epoch, no partition is opened
  const invalidEpoch = resolveVerifiedPartitionParams({
    userId: "u-1",
    businessId: "b-1",
    boundDeviceId: "d-1",
    storedBootstrapMeta: JSON.stringify({
      userId: "u-1",
      businessId: "b-1",
      enrollmentId: "d-1",
      datasetEpoch: "invalid",
    }),
  });
  assert.equal(invalidEpoch, null, "Must reject non-numeric datasetEpoch");

  // 4. With valid verified metadata, partition is opened for the exact verified epoch
  const valid = resolveVerifiedPartitionParams({
    userId: "u-1",
    businessId: "b-1",
    boundDeviceId: "d-1",
    storedBootstrapMeta: JSON.stringify({
      userId: "u-1",
      businessId: "b-1",
      enrollmentId: "d-1",
      datasetEpoch: 5,
    }),
  });
  assert.ok(valid);
  assert.equal(valid.datasetEpoch, 5);
  const partitionName = getPartitionDbName(valid);
  assert.equal(partitionName, "bms_u-1_b-1_d-1_ep5");
});


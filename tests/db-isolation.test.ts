import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createDatabase, withTenantContext } from "../packages/db/src/index";

test(
  "PostgreSQL RLS tenant isolation, pooled connection reuse, and composite foreign keys under restricted bms_runtime role",
  async () => {
    // 1. Verify restricted runtime role configuration
    const superuserUrl =
      process.env.DATABASE_URL ||
      "postgresql://bms_local:bms_local@127.0.0.1:5432/bms?schema=public";

    // Build bms_runtime URL
    const runtimeParsed = new URL(superuserUrl);
    runtimeParsed.username = "bms_runtime";
    runtimeParsed.password = "bms_runtime";
    const runtimeUrl = runtimeParsed.toString();

    const adminDb = createDatabase(superuserUrl);
    const runtimeDb = createDatabase(runtimeUrl);

    try {
      // Check that bms_runtime has no SUPERUSER and no BYPASSRLS
      const roleCheck = (await adminDb.$queryRawUnsafe(
        "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'bms_runtime';",
      )) as Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>;

      assert.equal(roleCheck.length, 1);
      assert.equal(roleCheck[0].rolsuper, false, "bms_runtime must not be superuser");
      assert.equal(roleCheck[0].rolbypassrls, false, "bms_runtime must not bypass RLS");

      // 2. Set up fixtures for Two Separate Businesses
      const biz1Id = crypto.randomUUID();
      const biz2Id = crypto.randomUUID();
      const loc1Id = crypto.randomUUID();
      const loc2Id = crypto.randomUUID();
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();
      const mem1Id = crypto.randomUUID();
      const mem2Id = crypto.randomUUID();

      // Seed businesses and users via admin
      await adminDb.business.createMany({
        data: [
          { id: biz1Id, name: "Business Alpha", currency: "PKR", timezone: "Asia/Karachi" },
          { id: biz2Id, name: "Business Beta", currency: "USD", timezone: "America/New_York" },
        ],
      });

      await adminDb.user.createMany({
        data: [
          {
            id: user1Id,
            username: `user_a_${Date.now()}`,
            fullName: "Alice Alpha",
            passwordHash: "hash_a",
          },
          {
            id: user2Id,
            username: `user_b_${Date.now()}`,
            fullName: "Bob Beta",
            passwordHash: "hash_b",
          },
        ],
      });

      await adminDb.location.createMany({
        data: [
          { id: loc1Id, businessId: biz1Id, code: "L01", name: "Alpha Central" },
          { id: loc2Id, businessId: biz2Id, code: "L02", name: "Beta Harbor" },
        ],
      });

      await adminDb.membership.createMany({
        data: [
          { id: mem1Id, businessId: biz1Id, userId: user1Id, role: "Owner", locationId: loc1Id },
          { id: mem2Id, businessId: biz2Id, userId: user2Id, role: "Cashier", locationId: loc2Id },
        ],
      });

      // --- TEST 1: Tenant Read Isolation with runtimeDb ---
      await withTenantContext(runtimeDb, { businessId: biz1Id }, async (tx) => {
        const locations = await tx.location.findMany();
        assert.equal(locations.length, 1, "Business Alpha must see exactly 1 location");
        assert.equal(locations[0].id, loc1Id);
        assert.equal(locations[0].code, "L01");

        // Verify Business Beta location is NOT visible
        const betaLoc = locations.find((l) => l.id === loc2Id);
        assert.equal(betaLoc, undefined, "Business Alpha must not see Business Beta location");
      });

      await withTenantContext(runtimeDb, { businessId: biz2Id }, async (tx) => {
        const locations = await tx.location.findMany();
        assert.equal(locations.length, 1, "Business Beta must see exactly 1 location");
        assert.equal(locations[0].id, loc2Id);
        assert.equal(locations[0].code, "L02");

        const alphaLoc = locations.find((l) => l.id === loc1Id);
        assert.equal(alphaLoc, undefined, "Business Beta must not see Business Alpha location");
      });

      // --- TEST 2: Tenant Write Isolation (RLS WITH CHECK Violation) ---
      await assert.rejects(
        async () => {
          // Context is Business Alpha, but attempting to write a location for Business Beta
          await withTenantContext(runtimeDb, { businessId: biz1Id }, async (tx) => {
            await tx.location.create({
              data: {
                id: crypto.randomUUID(),
                businessId: biz2Id, // Violates RLS WITH CHECK policy!
                code: "L99",
                name: "Intruder Branch",
              },
            });
          });
        },
        (err: unknown) => {
          assert.ok(
            err instanceof Error &&
              (err.message.includes("row-level security") || err.message.includes("violates")),
            "Cross-tenant write must be rejected by RLS policy",
          );
          return true;
        },
      );

      // --- TEST 3: Connection Pool Context Leakage Test ---
      // Transaction 1 sets Business Alpha context and commits
      await withTenantContext(runtimeDb, { businessId: biz1Id }, async (tx) => {
        const locs = await tx.location.findMany();
        assert.equal(locs.length, 1);
      });

      // Next transaction on the same pool without tenant context:
      // Must fail-closed and return 0 rows
      await runtimeDb.$transaction(async (tx) => {
        const locs = await tx.location.findMany();
        assert.equal(
          locs.length,
          0,
          "Queries without tenant context must return zero rows (fail-closed, no context leakage)",
        );
      });

      // --- TEST 4: Composite Foreign Keys Enforcement ---
      // Attempting to create a membership in Business Alpha that points to a Location in Business Beta
      await assert.rejects(
        async () => {
          await adminDb.membership.create({
            data: {
              id: crypto.randomUUID(),
              businessId: biz1Id, // Business Alpha
              userId: user2Id,
              role: "Viewer",
              locationId: loc2Id, // Location of Business Beta!
            },
          });
        },
        (err: unknown) => {
          assert.ok(
            err instanceof Error &&
              (err.message.includes("Foreign key constraint") || err.message.includes("fkey")),
            "Composite foreign key (business_id, location_id) must prevent cross-tenant references",
          );
          return true;
        },
      );

      // --- TEST 5: Device Prefix Registry Non-Reuse ---
      const dev1Id = crypto.randomUUID();
      const prefix = "D01";

      // Register and enroll device with prefix D01
      await withTenantContext(runtimeDb, { businessId: biz1Id }, async (tx) => {
        await tx.devicePrefixRegistry.create({
          data: {
            businessId: biz1Id,
            numberPrefix: prefix,
          },
        });
        await tx.deviceEnrollment.create({
          data: {
            id: dev1Id,
            businessId: biz1Id,
            membershipId: mem1Id,
            locationId: loc1Id,
            deviceName: "Register 1",
            numberPrefix: prefix,
            status: "Enrolled",
          },
        });
      });

      // Revoke the device
      await withTenantContext(runtimeDb, { businessId: biz1Id }, async (tx) => {
        await tx.deviceEnrollment.update({
          where: { id: dev1Id },
          data: { status: "Revoked", revokedAt: new Date() },
        });
      });

      // Attempt to enroll another device with the same prefix D01 in Business 1
      await assert.rejects(
        async () => {
          await withTenantContext(runtimeDb, { businessId: biz1Id }, async (tx) => {
            await tx.devicePrefixRegistry.create({
              data: {
                businessId: biz1Id,
                numberPrefix: prefix, // Unique constraint violation!
              },
            });
          });
        },
        (err: unknown) => {
          assert.ok(
            err instanceof Error &&
              (err.message.includes("Unique constraint") || err.message.includes("unique")),
            "Device prefix must never be reused within the business",
          );
          return true;
        },
      );

      // Different business (Business Beta) CAN use prefix D01
      await withTenantContext(runtimeDb, { businessId: biz2Id }, async (tx) => {
        const betaDevReg = await tx.devicePrefixRegistry.create({
          data: {
            businessId: biz2Id,
            numberPrefix: prefix,
          },
        });
        assert.equal(betaDevReg.numberPrefix, "D01");
      });
    } finally {
      await adminDb.$disconnect();
      await runtimeDb.$disconnect();
    }
  },
);

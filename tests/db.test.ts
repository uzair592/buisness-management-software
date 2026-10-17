import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";
import { createDatabase } from "../packages/db/src/index";
import { provisionDatabase } from "../packages/db/src/provision";
import { repairMigrationHistory } from "../packages/db/src/repair-history";
import { createApp } from "../apps/api/src/app";

test("real PostgreSQL readiness, outage and recovery", async () => {
  const dbUrl =
    process.env.DATABASE_URL ||
    "postgresql://bms_local:bms_local@127.0.0.1:5432/bms?schema=public";
  assert.ok(
    dbUrl,
    "Set DATABASE_URL to an actual PostgreSQL instance",
  );
  const good = createDatabase(dbUrl);
  const bad = createDatabase(
    "postgresql://unavailable:unavailable@127.0.0.1:1/bms?connect_timeout=1",
  );
  let connected = good;
  const app = createApp(async () => {
    await connected.$queryRaw`SELECT 1`;
  });
  try {
    assert.equal((await app.inject("/health/ready")).statusCode, 200);
    connected = bad;
    assert.equal((await app.inject("/health/ready")).statusCode, 503);
    assert.equal((await app.inject("/health/live")).statusCode, 200);
    connected = good;
    assert.equal((await app.inject("/health/ready")).statusCode, 200);
  } finally {
    await app.close();
    await good.$disconnect();
    await bad.$disconnect();
  }
});

test("fresh installation on arbitrarily named PostgreSQL database with custom runtime password", async () => {
  const adminUrl =
    process.env.DATABASE_URL ||
    "postgresql://bms_local:bms_local@127.0.0.1:5432/bms?schema=public";

  const pgClient = new Client({ connectionString: adminUrl });
  await pgClient.connect();

  const arbitraryDbName = `bms_arb_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const customRuntimePass = "Custom_Secret_Pass_2026!";

  try {
    await pgClient.query(`CREATE DATABASE "${arbitraryDbName}";`);

    const arbitraryAdminUrl = new URL(adminUrl);
    arbitraryAdminUrl.pathname = `/${arbitraryDbName}`;

    // 1. Verify production guard: default password rejected
    await assert.rejects(
      async () => {
        await provisionDatabase({
          migrationUrl: arbitraryAdminUrl.toString(),
          runtimePassword: "bms_runtime",
          isProduction: true,
        });
      },
      /Database provisioning requires a secure, non-default BMS_RUNTIME_PASSWORD/,
      "Must reject default password in production mode",
    );

    // 2. Provision with custom password on the arbitrarily named database
    const provisionResult = await provisionDatabase({
      migrationUrl: arbitraryAdminUrl.toString(),
      runtimePassword: customRuntimePass,
      isProduction: true,
    });
    assert.equal(provisionResult.currentDb, arbitraryDbName);
    assert.equal(provisionResult.runtimeUser, "bms_runtime");

    // 3. Run Prisma migrate deploy against the arbitrary database
    execSync("pnpm --filter @business/db exec prisma migrate deploy", {
      env: {
        ...process.env,
        DATABASE_URL: arbitraryAdminUrl.toString(),
      },
      stdio: "pipe",
    });

    // 4. Verify bms_runtime can connect to the arbitrary database with custom password
    const runtimeUrl = new URL(arbitraryAdminUrl.toString());
    runtimeUrl.username = "bms_runtime";
    runtimeUrl.password = customRuntimePass;

    const runtimeClient = new Client({ connectionString: runtimeUrl.toString() });
    await runtimeClient.connect();

    const dbNameRes = await runtimeClient.query(
      "SELECT current_database() AS db, current_user AS usr;",
    );
    assert.equal(dbNameRes.rows[0].db, arbitraryDbName);
    assert.equal(dbNameRes.rows[0].usr, "bms_runtime");

    // Verify bms_runtime can query tables under RLS
    const tableRes = await runtimeClient.query("SELECT COUNT(*) AS count FROM users;");
    assert.equal(tableRes.rows[0].count, "0");

    await runtimeClient.end();
  } finally {
    try {
      await pgClient.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${arbitraryDbName}' AND pid <> pg_backend_pid();
      `);
      await pgClient.query(`DROP DATABASE IF EXISTS "${arbitraryDbName}";`);
    } catch {
      // ignore cleanup errors
    }
    await pgClient.end();
  }
});

test("existing database upgrade path: PR #3 original migration, representative data, migration deploy, and data-preserving history repair", async () => {
  const adminUrl =
    process.env.DATABASE_URL ||
    "postgresql://bms_local:bms_local@127.0.0.1:5432/bms?schema=public";

  const pgClient = new Client({ connectionString: adminUrl });
  await pgClient.connect();

  const existingDbName = `bms_upg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  try {
    await pgClient.query(`CREATE DATABASE "${existingDbName}";`);

    const existingAdminUrl = new URL(adminUrl);
    existingAdminUrl.pathname = `/${existingDbName}`;

    const dbClient = new Client({ connectionString: existingAdminUrl.toString() });
    await dbClient.connect();

    try {
      // 1. Fetch original PR #3 migration SQL from git commit ee0752f
      const originalSql = execSync(
        "git show ee0752f:packages/db/prisma/migrations/20261015000000_init_identity_and_devices/migration.sql",
        { encoding: "utf-8" },
      );
      const originalChecksum = crypto
        .createHash("sha256")
        .update(originalSql)
        .digest("hex");

      // Apply original PR #3 migration directly to simulate database deployed prior to PR #4
      await dbClient.query(originalSql);

      // Record original migration in _prisma_migrations with original PR #3 checksum
      await dbClient.query(`
        CREATE TABLE IF NOT EXISTS _prisma_migrations (
          id VARCHAR(36) PRIMARY KEY,
          checksum VARCHAR(64) NOT NULL,
          finished_at TIMESTAMPTZ,
          migration_name VARCHAR(255) NOT NULL,
          logs TEXT,
          rolled_back_at TIMESTAMPTZ,
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          applied_steps_count INTEGER NOT NULL DEFAULT 0
        );
      `);

      await dbClient.query(
        `
        INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
        VALUES ($1, $2, now(), $3, 1);
      `,
        [crypto.randomUUID(), originalChecksum, "20261015000000_init_identity_and_devices"],
      );

      // 2. Insert representative data: business, location, user, membership, device prefix, enrollment, session
      const businessId = crypto.randomUUID();
      const locationId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const membershipId = crypto.randomUUID();
      const deviceId = crypto.randomUUID();
      const sessionId = crypto.randomUUID();

      await dbClient.query(`
        INSERT INTO businesses (id, name, currency, timezone, dataset_epoch, updated_at)
        VALUES ('${businessId}', 'Upgrade Test Corp', 'PKR', 'Asia/Karachi', 1, now());

        INSERT INTO locations (id, business_id, code, name, updated_at)
        VALUES ('${locationId}', '${businessId}', 'LOC-01', 'Main Branch', now());

        INSERT INTO users (id, username, password_hash, full_name, email, updated_at)
        VALUES ('${userId}', 'alice_owner', 'hashed_pass_secret', 'Alice Owner', 'alice@example.com', now());

        INSERT INTO memberships (id, business_id, user_id, role, permission_version, location_id, updated_at)
        VALUES ('${membershipId}', '${businessId}', '${userId}', 'Owner', 1, '${locationId}', now());

        INSERT INTO device_prefix_registry (id, business_id, number_prefix)
        VALUES ('${crypto.randomUUID()}', '${businessId}', 'DEV-01');

        INSERT INTO device_enrollments (id, business_id, membership_id, location_id, device_name, number_prefix, status, updated_at)
        VALUES ('${deviceId}', '${businessId}', '${membershipId}', '${locationId}', 'POS Terminal 1', 'DEV-01', 'Enrolled', now());

        INSERT INTO sessions (id, user_id, selected_business_id, token_hash, csrf_token, expires_at)
        VALUES ('${sessionId}', '${userId}', '${businessId}', 'token_hash_value', 'csrf_token_value', now() + interval '1 day');
      `);

      // 3. Run standard migration upgrade command using current main: pnpm db:migrate
      // This runs provisionDatabase and prisma migrate deploy
      await provisionDatabase({
        migrationUrl: existingAdminUrl.toString(),
        runtimePassword: "bms_runtime_pass_change_in_production",
        isProduction: false,
      });

      execSync("pnpm --filter @business/db exec prisma migrate deploy", {
        env: {
          ...process.env,
          DATABASE_URL: existingAdminUrl.toString(),
        },
        stdio: "pipe",
      });

      // 4. Verify migration 2 was applied
      const migCheck = await dbClient.query(
        "SELECT migration_name, checksum FROM _prisma_migrations ORDER BY started_at;",
      );
      assert.equal(migCheck.rowCount, 2, "Both migrations must be recorded in _prisma_migrations");
      assert.equal(migCheck.rows[0].migration_name, "20261015000000_init_identity_and_devices");
      assert.equal(migCheck.rows[1].migration_name, "20261016120000_repair_runtime_provisioning_and_isolation");

      // Verify the initial recorded checksum in DB matches the original PR #3 checksum
      assert.equal(
        migCheck.rows[0].checksum,
        originalChecksum,
        "Original migration checksum must reflect PR #3 prior to repair",
      );

      // Verify that disk migration 1 checksum differs from DB (migration history mismatch detected)
      const diskMigration1Sql = fs.readFileSync(
        path.resolve(process.cwd(), "packages/db/prisma/migrations/20261015000000_init_identity_and_devices/migration.sql"),
        "utf-8",
      );
      const diskChecksum = crypto
        .createHash("sha256")
        .update(diskMigration1Sql)
        .digest("hex");
      assert.notEqual(
        originalChecksum,
        diskChecksum,
        "Disk checksum differs from original PR #3 checksum because PR #4 modified it in place",
      );

      // 5. Verify all representative business data survived the upgrade intact
      const bCount = await dbClient.query("SELECT COUNT(*) AS count FROM businesses;");
      const lCount = await dbClient.query("SELECT COUNT(*) AS count FROM locations;");
      const uCount = await dbClient.query("SELECT COUNT(*) AS count FROM users;");
      const mCount = await dbClient.query("SELECT COUNT(*) AS count FROM memberships;");
      const dCount = await dbClient.query("SELECT COUNT(*) AS count FROM device_enrollments;");
      const sCount = await dbClient.query("SELECT COUNT(*) AS count FROM sessions;");

      assert.equal(bCount.rows[0].count, "1");
      assert.equal(lCount.rows[0].count, "1");
      assert.equal(uCount.rows[0].count, "1");
      assert.equal(mCount.rows[0].count, "1");
      assert.equal(dCount.rows[0].count, "1");
      assert.equal(sCount.rows[0].count, "1");

      // 6. Verify restricted runtime role (bms_runtime) access under RLS
      const runtimeUrl = new URL(existingAdminUrl.toString());
      runtimeUrl.username = "bms_runtime";
      runtimeUrl.password = "bms_runtime_pass_change_in_production";

      const runtimeClient = new Client({ connectionString: runtimeUrl.toString() });
      await runtimeClient.connect();
      const rtRes = await runtimeClient.query("SELECT COUNT(*) AS count FROM users;");
      assert.equal(rtRes.rows[0].count, "1");
      await runtimeClient.end();

      // 7. Execute data-preserving repair without database reset
      const reconciled = await repairMigrationHistory({
        migrationUrl: existingAdminUrl.toString(),
      });
      assert.equal(reconciled.length, 1, "Must reconcile the 1 modified migration");
      assert.equal(reconciled[0].migrationName, "20261015000000_init_identity_and_devices");
      assert.equal(reconciled[0].recordedChecksum, originalChecksum);
      assert.equal(reconciled[0].diskChecksum, diskChecksum);

      // 8. Verify prisma migrate status is completely clean
      const statusOut = execSync("pnpm --filter @business/db exec prisma migrate status", {
        env: {
          ...process.env,
          DATABASE_URL: existingAdminUrl.toString(),
        },
        encoding: "utf-8",
      });
      assert.match(statusOut, /Database schema is up to date!/);

      // Verify checksum in _prisma_migrations now matches disk
      const afterRepair = await dbClient.query(
        "SELECT checksum FROM _prisma_migrations WHERE migration_name = '20261015000000_init_identity_and_devices';",
      );
      assert.equal(afterRepair.rows[0].checksum, diskChecksum);

      // Verify all data is STILL intact after repair
      const bCountAfter = await dbClient.query("SELECT COUNT(*) AS count FROM businesses;");
      assert.equal(bCountAfter.rows[0].count, "1");
    } finally {
      await dbClient.end();
    }
  } finally {
    try {
      await pgClient.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${existingDbName}' AND pid <> pg_backend_pid();
      `);
      await pgClient.query(`DROP DATABASE IF EXISTS "${existingDbName}";`);
    } catch {
      // ignore cleanup errors
    }
    await pgClient.end();
  }
});

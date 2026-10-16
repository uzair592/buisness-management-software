import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { Client } from "pg";
import { createDatabase } from "../packages/db/src/index";
import { provisionDatabase } from "../packages/db/src/provision";
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

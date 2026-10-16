import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../packages/db/src/index";
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

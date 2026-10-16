import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../apps/api/src/app";
import { parseEnv } from "../apps/api/src/env";

test("liveness stays healthy when readiness fails, then recovers", async () => {
  let available = false;
  const app = createApp(async () => {
    if (!available) throw new Error("private DB detail");
  });
  try {
    assert.equal((await app.inject("/health/live")).statusCode, 200);
    const down = await app.inject("/health/ready");
    assert.equal(down.statusCode, 503);
    assert.deepEqual(down.json(), { status: "unavailable" });
    available = true;
    assert.equal((await app.inject("/health/ready")).statusCode, 200);
    assert.equal((await app.inject("/v1/invoices")).statusCode, 404);
  } finally {
    await app.close();
  }
});

test("invalid configuration and development production credentials fail closed", () => {
  assert.throws(() => parseEnv({}), /DATABASE_URL/);
  assert.throws(
    () => parseEnv({ DATABASE_URL: "https://example.com" }),
    /PostgreSQL/,
  );
  assert.throws(
    () =>
      parseEnv({
        DATABASE_URL: "postgresql://bms_local:bms_local@localhost/bms",
        NODE_ENV: "production",
      }),
    /credentials/,
  );
  assert.throws(
    () =>
      parseEnv({
        DATABASE_URL: "postgresql://user:secret@localhost/bms",
        DEMO_MODE: "true",
      }),
    /Demo/,
  );
  assert.throws(
    () =>
      parseEnv({
        DATABASE_URL: "postgresql://user:secret@localhost/bms",
        PORT: "0",
      }),
    /PORT/,
  );
  assert.throws(
    () =>
      parseEnv({
        DATABASE_URL: "postgresql://user:unique-secret@localhost/bms",
        NODE_ENV: "production",
      }),
    /session and lease secrets/,
  );
  assert.equal(
    parseEnv({
      DATABASE_URL: "postgresql://user:unique-secret@localhost/bms",
      NODE_ENV: "production",
      SESSION_SECRET: "production_custom_session_secret_at_least_32_chars!",
      LEASE_SECRET: "production_custom_lease_secret_at_least_32_chars!",
    }).PORT,
    3001,
  );
  assert.equal(
    parseEnv({
      DATABASE_URL: "postgresql://user:unique-secret@localhost/bms",
      TRUST_PROXY: "false",
    }).trustProxy,
    false,
  );
  assert.equal(
    parseEnv({
      DATABASE_URL: "postgresql://user:unique-secret@localhost/bms",
      TRUST_PROXY: "true",
    }).trustProxy,
    true,
  );
  assert.deepEqual(
    parseEnv({
      DATABASE_URL: "postgresql://user:unique-secret@localhost/bms",
      TRUST_PROXY: "127.0.0.1, 192.168.1.1",
    }).trustProxy,
    ["127.0.0.1", "192.168.1.1"],
  );
});

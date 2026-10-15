import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase } from "../packages/db/src/index";

test("End-to-end identity, auth, rate-limiting, devices, and bootstrap API", async (t) => {
  const dbUrl =
    process.env.DATABASE_URL ||
    "postgresql://bms_local:bms_local@127.0.0.1:5432/bms?schema=public";
  const db = createDatabase(dbUrl);
  const leaseSecret = "test_lease_secret_at_least_32_characters_long_bms!";
  const sessionSecret = "test_session_secret_at_least_32_characters_long_bms!";

  const app = createApp({
    db,
    sessionSecret,
    leaseSecret,
    isProduction: false,
  });

  t.after(async () => {
    await app.close();
    await db.$disconnect();
  });

  const suffix = Date.now().toString().slice(-6);
  const ownerUsername = `owner_${suffix}`;
  const ownerPassword = "SuperSecretPassword123!";
  const businessName = `Apex Hardware ${suffix}`;

  // 1. Register Owner Account
  const regRes = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      username: ownerUsername,
      password: ownerPassword,
      fullName: "Owner User",
      email: "owner@example.com",
      businessName,
      currency: "PKR",
      timezone: "Asia/Karachi",
    },
  });

  assert.equal(regRes.statusCode, 201);
  const regBody = regRes.json();
  assert.equal(regBody.user.username, ownerUsername);
  assert.equal(regBody.membership.role, "Owner");
  assert.equal(regBody.business.name, businessName);
  assert.ok(regBody.csrfToken);

  const ownerCookies = regRes.headers["set-cookie"];
  assert.ok(ownerCookies, "Register must set session cookies");

  // Duplicate registration must fail with 409
  const dupRes = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      username: ownerUsername,
      password: "AnotherPassword123!",
      fullName: "Duplicate User",
      businessName: "Another Business",
    },
  });
  assert.equal(dupRes.statusCode, 409);

  // 2. Authentication & Rate-Limiting
  // Test wrong password
  const failRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "x-forwarded-for": "192.168.1.100" },
    payload: {
      username: ownerUsername,
      password: "WrongPassword!",
    },
  });
  assert.equal(failRes.statusCode, 401);

  // Trigger rate-limit with 4 more failed attempts (5 total)
  for (let i = 0; i < 4; i++) {
    await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-forwarded-for": "192.168.1.100" },
      payload: {
        username: ownerUsername,
        password: "WrongPassword!",
      },
    });
  }

  // 6th attempt should return 429 Too Many Requests
  const rateLimitRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "x-forwarded-for": "192.168.1.100" },
    payload: {
      username: ownerUsername,
      password: ownerPassword,
    },
  });
  assert.equal(rateLimitRes.statusCode, 429);

  // Successful login from clean IP
  const loginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "x-forwarded-for": "10.0.0.1" },
    payload: {
      username: ownerUsername,
      password: ownerPassword,
    },
  });
  assert.equal(loginRes.statusCode, 200);
  const loginBody = loginRes.json();
  assert.equal(loginBody.authenticated, true);
  assert.equal(loginBody.user.username, ownerUsername);
  assert.equal(loginBody.activeMembership.role, "Owner");

  const loginCookies = loginRes.headers["set-cookie"] as string[];
  const sessionCookieHeader = loginCookies.map((c) => c.split(";")[0]).join("; ");
  const csrfToken = loginBody.csrfToken;

  // 3. /v1/auth/me session check
  const meRes = await app.inject({
    method: "GET",
    url: "/v1/auth/me",
    headers: {
      cookie: sessionCookieHeader,
    },
  });
  assert.equal(meRes.statusCode, 200);
  assert.equal(meRes.json().user.username, ownerUsername);

  // 4. Locations & Device Enrolment
  const locRes = await app.inject({
    method: "GET",
    url: "/v1/locations",
    headers: {
      cookie: sessionCookieHeader,
    },
  });
  assert.equal(locRes.statusCode, 200);
  const locations = locRes.json();
  assert.ok(locations.length >= 1);
  const mainLocationId = locations[0].id;

  // Enroll Device (auto prefix D01)
  const enrollRes = await app.inject({
    method: "POST",
    url: "/v1/devices/enroll",
    headers: {
      cookie: sessionCookieHeader,
      "x-csrf-token": csrfToken,
    },
    payload: {
      deviceName: "Point of Sale 1",
      locationId: mainLocationId,
    },
  });
  assert.equal(enrollRes.statusCode, 201);
  const device1 = enrollRes.json();
  assert.equal(device1.numberPrefix, "D01");
  assert.equal(device1.status, "Enrolled");

  // Enroll second device with custom prefix "D02"
  const enroll2Res = await app.inject({
    method: "POST",
    url: "/v1/devices/enroll",
    headers: {
      cookie: sessionCookieHeader,
      "x-csrf-token": csrfToken,
    },
    payload: {
      deviceName: "Mobile Terminal",
      locationId: mainLocationId,
      numberPrefix: "D02",
    },
  });
  assert.equal(enroll2Res.statusCode, 201);
  assert.equal(enroll2Res.json().numberPrefix, "D02");

  // Attempting to reuse prefix "D01" must fail
  const dupPrefixRes = await app.inject({
    method: "POST",
    url: "/v1/devices/enroll",
    headers: {
      cookie: sessionCookieHeader,
      "x-csrf-token": csrfToken,
    },
    payload: {
      deviceName: "Duplicate Prefix Device",
      locationId: mainLocationId,
      numberPrefix: "D01",
    },
  });
  assert.equal(dupPrefixRes.statusCode, 400);

  // 5. Offline Lease & Identity Bootstrap
  const bootstrapRes = await app.inject({
    method: "GET",
    url: `/v1/sync/bootstrap?deviceEnrollmentId=${device1.id}`,
    headers: {
      cookie: sessionCookieHeader,
    },
  });
  assert.equal(bootstrapRes.statusCode, 200);
  const bootstrapData = bootstrapRes.json();
  assert.equal(bootstrapData.business.name, businessName);
  assert.equal(bootstrapData.device.id, device1.id);
  assert.equal(bootstrapData.device.numberPrefix, "D01");
  assert.equal(bootstrapData.membership.role, "Owner");
  assert.ok(bootstrapData.lease.signature);

  // Verify HMAC-SHA256 signature of offline lease
  const expectedPayload = `${bootstrapData.business.id}:${device1.id}:${bootstrapData.membership.id}:${bootstrapData.business.datasetEpoch}:${bootstrapData.membership.permissionVersion}:${new Date(bootstrapData.lease.expiresAt).toISOString()}`;
  const recomputedSig = crypto
    .createHmac("sha256", leaseSecret)
    .update(expectedPayload)
    .digest("hex");
  assert.equal(bootstrapData.lease.signature, recomputedSig, "Lease signature must be valid");

  // Confidentiality assertion: bootstrap data must NEVER include server secrets
  const bootstrapJson = JSON.stringify(bootstrapData);
  assert.ok(!bootstrapJson.includes("password_hash"));
  assert.ok(!bootstrapJson.includes("token_hash"));
  assert.ok(!bootstrapJson.includes("csrf_token"));

  // 6. Device Revocation
  const revokeRes = await app.inject({
    method: "POST",
    url: "/v1/devices/revoke",
    headers: {
      cookie: sessionCookieHeader,
      "x-csrf-token": csrfToken,
    },
    payload: {
      deviceEnrollmentId: device1.id,
      reason: "Device lost",
    },
  });
  assert.equal(revokeRes.statusCode, 200);
  assert.equal(revokeRes.json().status, "Revoked");

  // Bootstrapping a revoked device must fail with 403
  const revokedBootstrapRes = await app.inject({
    method: "GET",
    url: `/v1/sync/bootstrap?deviceEnrollmentId=${device1.id}`,
    headers: {
      cookie: sessionCookieHeader,
    },
  });
  assert.equal(revokedBootstrapRes.statusCode, 403);

  // 7. Change Password & Session Revocation
  const changePwRes = await app.inject({
    method: "POST",
    url: "/v1/auth/change-password",
    headers: {
      cookie: sessionCookieHeader,
      "x-csrf-token": csrfToken,
    },
    payload: {
      currentPassword: ownerPassword,
      newPassword: "BrandNewPassword2026!",
      revokeOtherSessions: true,
    },
  });
  assert.equal(changePwRes.statusCode, 200);

  // Login with old password must fail
  const oldLoginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "x-forwarded-for": "10.0.0.2" },
    payload: {
      username: ownerUsername,
      password: ownerPassword,
    },
  });
  assert.equal(oldLoginRes.statusCode, 401);

  // Login with new password succeeds
  const newLoginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "x-forwarded-for": "10.0.0.2" },
    payload: {
      username: ownerUsername,
      password: "BrandNewPassword2026!",
    },
  });
  assert.equal(newLoginRes.statusCode, 200);

  // 8. Logout
  const logoutRes = await app.inject({
    method: "POST",
    url: "/v1/auth/logout",
    headers: {
      cookie: sessionCookieHeader,
    },
  });
  assert.equal(logoutRes.statusCode, 200);

  // Subsequent request with logged-out session cookie returns 401
  const afterLogoutRes = await app.inject({
    method: "GET",
    url: "/v1/devices",
    headers: {
      cookie: sessionCookieHeader,
    },
  });
  assert.equal(afterLogoutRes.statusCode, 401);
});

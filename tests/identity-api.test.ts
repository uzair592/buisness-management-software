import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../apps/api/src/app";
import { createDatabase, withTenantContext } from "../packages/db/src/index";
import { hashPassword } from "../apps/api/src/auth/password";
import { clearAllRateLimits } from "../apps/api/src/auth/rateLimit";

test("End-to-end identity, auth, rate-limiting, devices, and bootstrap API under bms_runtime", async (t) => {
  clearAllRateLimits();

  const superuserUrl =
    process.env.DATABASE_URL ||
    "postgresql://bms_local:bms_local@127.0.0.1:5432/bms?schema=public";

  const runtimeParsed = new URL(superuserUrl);
  runtimeParsed.username = process.env.BMS_RUNTIME_USER || "bms_runtime";
  runtimeParsed.password =
    process.env.BMS_RUNTIME_PASSWORD || "bms_runtime_pass_change_in_production";
  const runtimeDbUrl = runtimeParsed.toString();

  const adminDb = createDatabase(superuserUrl);
  const db = createDatabase(runtimeDbUrl);
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
    await adminDb.$disconnect();
  });

  const suffix = Date.now().toString().slice(-6);
  const ownerUsername = `owner_${suffix}`;
  const ownerPassword = "SuperSecretPassword123!";
  const businessName = `Apex Hardware ${suffix}`;

  // 1. Register Owner Account under bms_runtime
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

  // 2. Authentication & Rate-Limiting (Finding 5)
  // Test header spoofing with rotating X-Forwarded-For: account limit must lock after 5 attempts
  for (let i = 1; i <= 5; i++) {
    const failRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-forwarded-for": `192.168.10.${i}` },
      payload: {
        username: ownerUsername,
        password: "WrongPassword!",
      },
    });
    assert.equal(failRes.statusCode, 401);
  }

  // 6th attempt with a different spoofed IP should still return 429 because of account-level protection
  const rateLimitRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "x-forwarded-for": "172.16.0.99" },
    payload: {
      username: ownerUsername,
      password: ownerPassword,
    },
  });
  assert.equal(rateLimitRes.statusCode, 429, "Spoofed IPs must not bypass account rate limit");

  // Clear rate limits before testing source-level throttling
  clearAllRateLimits();

  // Test source throttling with rotating X-Forwarded-For under safe default (trustProxy: false)
  // An attacker uses 10 different usernames and 10 different X-Forwarded-For headers
  for (let i = 1; i <= 10; i++) {
    const failRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "x-forwarded-for": `198.51.100.${i}` },
      payload: {
        username: `attacker_target_${i}_${suffix}`,
        password: "WrongPassword!",
      },
    });
    assert.equal(failRes.statusCode, 401);
  }

  // 11th attempt with yet another rotated username and rotated X-Forwarded-For:
  // Because trustProxy defaults to false, Fastify uses the direct socket IP (127.0.0.1).
  // The source limit (10 failures) is tripped for 127.0.0.1, so the 11th attempt returns 429!
  const sourceRateLimitRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { "x-forwarded-for": "198.51.100.254" },
    payload: {
      username: `fresh_victim_${suffix}`,
      password: "WrongPassword!",
    },
  });
  assert.equal(
    sourceRateLimitRes.statusCode,
    429,
    "Rotating X-Forwarded-For must NOT evade source rate limits in default setup",
  );

  // Clear rate limits for clean continuation
  clearAllRateLimits();

  // Successful login
  const loginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
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

  // 5. Offline Lease & Identity Bootstrap (Finding 4)
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

  const deviceChanges = await withTenantContext(
    db, { businessId: bootstrapData.business.id, userId: regBody.user.id },
    async (tx) => tx.changeBatch.findMany({
      where: { businessId: bootstrapData.business.id }, orderBy: { cursor: "asc" },
    }),
  );
  assert.deepEqual(deviceChanges.map((batch) => batch.cursor.toString()), ["1", "2", "3", "4"]);
  assert.deepEqual(deviceChanges.map((batch) => (batch.payload as { action: string }).action), [
    "device.enrol", "device.enrol", "device.lease_issue", "device.revoke",
  ]);
  assert.ok(!JSON.stringify(deviceChanges.map((batch) => batch.payload)).includes(bootstrapData.lease.signature));

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

  // =========================================================================
  // REGRESSION 1: REVOKED MEMBERSHIP MUST REMOVE BUSINESS ACCESS (Finding 1)
  // Scenario:
  // - User belongs to Business A (as Viewer) and is Owner of Business B.
  // - Session selects Business A.
  // - Remove the user's membership in Business A out-of-band.
  // - Session must NOT fall back to Business B while keeping Business A context.
  // - Tenant operations (read locations, revoke devices) on Business A MUST fail (403).
  // - Business B's Owner role must NEVER apply to Business A.
  // =========================================================================
  const bizAId = crypto.randomUUID();
  const bizBId = crypto.randomUUID();
  const locAId = crypto.randomUUID();
  const locBId = crypto.randomUUID();
  const aliceId = crypto.randomUUID();
  const aliceMemAId = crypto.randomUUID();
  const aliceMemBId = crypto.randomUUID();
  const devAId = crypto.randomUUID();

  // Create Business A & B fixtures via adminDb
  await withTenantContext(adminDb, { bypassRls: true }, async (tx) => {
    await tx.business.createMany({
      data: [
        { id: bizAId, name: "Business A", currency: "PKR", timezone: "Asia/Karachi" },
        { id: bizBId, name: "Business B", currency: "USD", timezone: "America/New_York" },
      ],
    });

    await tx.location.createMany({
      data: [
        { id: locAId, businessId: bizAId, code: "LA1", name: "Location A1" },
        { id: locBId, businessId: bizBId, code: "LB1", name: "Location B1" },
      ],
    });

    const aliceHash = await hashPassword("AlicePassword123!");
    const ownerAId = crypto.randomUUID();
    const ownerMemAId = crypto.randomUUID();

    await tx.user.createMany({
      data: [
        {
          id: aliceId,
          username: `alice_${suffix}`,
          passwordHash: aliceHash,
          fullName: "Alice User",
        },
        {
          id: ownerAId,
          username: `ownerA_${suffix}`,
          passwordHash: aliceHash,
          fullName: "Owner A User",
        },
      ],
    });

    // Alice has Viewer membership in Business A and Owner membership in Business B
    await tx.membership.createMany({
      data: [
        {
          id: ownerMemAId,
          businessId: bizAId,
          userId: ownerAId,
          role: "Owner",
          locationId: locAId,
        },
        {
          id: aliceMemAId,
          businessId: bizAId,
          userId: aliceId,
          role: "Viewer",
          locationId: locAId,
        },
        {
          id: aliceMemBId,
          businessId: bizBId,
          userId: aliceId,
          role: "Owner",
          locationId: locBId,
        },
      ],
    });

    // Create a device in Business A enrolled by Owner A
    await tx.devicePrefixRegistry.create({
      data: { businessId: bizAId, numberPrefix: "DA1" },
    });
    await tx.deviceEnrollment.create({
      data: {
        id: devAId,
        businessId: bizAId,
        membershipId: ownerMemAId,
        locationId: locAId,
        deviceName: "Business A Register",
        numberPrefix: "DA1",
        status: "Enrolled",
      },
    });
  });

  // Alice logs in
  const aliceLoginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      username: `alice_${suffix}`,
      password: "AlicePassword123!",
    },
  });
  assert.equal(aliceLoginRes.statusCode, 200);
  const aliceCookies = (aliceLoginRes.headers["set-cookie"] as string[])
    .map((c) => c.split(";")[0])
    .join("; ");
  const aliceCsrf = aliceLoginRes.json().csrfToken;

  // Alice explicitly selects Business A
  const selectRes = await app.inject({
    method: "POST",
    url: "/v1/auth/select-business",
    headers: {
      cookie: aliceCookies,
      "x-csrf-token": aliceCsrf,
    },
    payload: {
      businessId: bizAId,
    },
  });
  assert.equal(selectRes.statusCode, 200);
  assert.equal(selectRes.json().selectedBusinessId, bizAId);
  assert.equal(selectRes.json().activeMembership.role, "Viewer");

  // Verify Alice can read Business A's locations as Viewer
  const aliceLocA = await app.inject({
    method: "GET",
    url: "/v1/locations",
    headers: { cookie: aliceCookies },
  });
  assert.equal(aliceLocA.statusCode, 200);
  assert.equal(aliceLocA.json().length, 1);
  assert.equal(aliceLocA.json()[0].id, locAId);

  // Now, out-of-band: Remove Alice's membership in Business A!
  await withTenantContext(adminDb, { bypassRls: true }, async (tx) => {
    await tx.membership.delete({ where: { id: aliceMemAId } });
  });

  // Alice's session next makes a request to /v1/locations
  // It MUST NOT read Business A's locations or apply Business B's Owner role!
  const revokedAccessRes = await app.inject({
    method: "GET",
    url: "/v1/locations",
    headers: { cookie: aliceCookies },
  });
  assert.equal(
    revokedAccessRes.statusCode,
    403,
    "Accessing Business A locations must be rejected after membership removal",
  );

  // Alice attempts to revoke a device in Business A using Business B's Owner role
  // This must be strictly rejected with 403!
  const revokedDeviceRes = await app.inject({
    method: "POST",
    url: "/v1/devices/revoke",
    headers: {
      cookie: aliceCookies,
      "x-csrf-token": aliceCsrf,
    },
    payload: {
      deviceEnrollmentId: devAId,
      reason: "Unauthorized attempt",
    },
  });
  assert.equal(
    revokedDeviceRes.statusCode,
    403,
    "Device revocation must be rejected; Business B owner role must never apply to Business A",
  );

  // Check /v1/auth/me: selectedBusinessId must have been cleared to null
  const aliceMeRes = await app.inject({
    method: "GET",
    url: "/v1/auth/me",
    headers: { cookie: aliceCookies },
  });
  assert.equal(aliceMeRes.statusCode, 200);
  assert.equal(aliceMeRes.json().selectedBusinessId, null);
  assert.equal(aliceMeRes.json().activeMembership, null);
  // Only remaining membership is Business B
  assert.equal(aliceMeRes.json().memberships.length, 1);
  assert.equal(aliceMeRes.json().memberships[0].businessId, bizBId);

  // =========================================================================
  // REGRESSION 2: ENFORCE DEVICE, MEMBERSHIP & LOCATION SCOPE (Finding 4)
  // Scenario:
  // - Viewer cannot obtain an offline lease via /v1/devices/lease (403)
  // - Viewer bootstrap returns lease: null
  // - Scoped Cashier with assigned locationId only receives permitted location
  // =========================================================================
  const bobId = crypto.randomUUID();
  const bobMemBId = crypto.randomUUID();
  const devBId = crypto.randomUUID();
  const locB2Id = crypto.randomUUID();

  // Create Bob as Cashier in Business B assigned to locB1
  await withTenantContext(adminDb, { bypassRls: true }, async (tx) => {
    // Add second location to Business B
    await tx.location.create({
      data: { id: locB2Id, businessId: bizBId, code: "LB2", name: "Location B2" },
    });

    const bobHash = await hashPassword("BobPassword123!");
    await tx.user.create({
      data: {
        id: bobId,
        username: `bob_${suffix}`,
        passwordHash: bobHash,
        fullName: "Bob Cashier",
      },
    });

    await tx.membership.create({
      data: {
        id: bobMemBId,
        businessId: bizBId,
        userId: bobId,
        role: "Cashier",
        locationId: locBId,
      },
    });

    // Create device in Business B at locB1
    await tx.devicePrefixRegistry.create({
      data: { businessId: bizBId, numberPrefix: "DB1" },
    });
    await tx.deviceEnrollment.create({
      data: {
        id: devBId,
        businessId: bizBId,
        membershipId: bobMemBId,
        locationId: locBId,
        deviceName: "Cashier Station B",
        numberPrefix: "DB1",
        status: "Enrolled",
      },
    });
  });

  // Bob logs in
  const bobLoginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      username: `bob_${suffix}`,
      password: "BobPassword123!",
    },
  });
  assert.equal(bobLoginRes.statusCode, 200);
  const bobCookies = (bobLoginRes.headers["set-cookie"] as string[])
    .map((c) => c.split(";")[0])
    .join("; ");

  // Bob requests /v1/locations: must ONLY receive permitted location locB1Id, not locB2Id!
  const bobLocsRes = await app.inject({
    method: "GET",
    url: "/v1/locations",
    headers: { cookie: bobCookies },
  });
  assert.equal(bobLocsRes.statusCode, 200);
  const bobLocs = bobLocsRes.json();
  assert.equal(bobLocs.length, 1, "Scoped cashier must only see assigned location");
  assert.equal(bobLocs[0].id, locBId);

  // Bob requests bootstrap: permittedLocations must only contain assigned location
  const bobBootstrapRes = await app.inject({
    method: "GET",
    url: `/v1/sync/bootstrap?deviceEnrollmentId=${devBId}`,
    headers: { cookie: bobCookies },
  });
  assert.equal(bobBootstrapRes.statusCode, 200);
  const bobBootstrap = bobBootstrapRes.json();
  assert.equal(bobBootstrap.permittedLocations.length, 1);
  assert.equal(bobBootstrap.permittedLocations[0].id, locBId);
  assert.ok(bobBootstrap.lease, "Cashier role has offline:lease capability so receives a lease");

  // Create Viewer user Charlie in Business B
  const charlieId = crypto.randomUUID();
  const charlieMemId = crypto.randomUUID();
  await withTenantContext(adminDb, { bypassRls: true }, async (tx) => {
    const charlieHash = await hashPassword("CharliePassword123!");
    await tx.user.create({
      data: {
        id: charlieId,
        username: `charlie_${suffix}`,
        passwordHash: charlieHash,
        fullName: "Charlie Viewer",
      },
    });
    await tx.membership.create({
      data: {
        id: charlieMemId,
        businessId: bizBId,
        userId: charlieId,
        role: "Viewer",
      },
    });
  });

  const charlieLoginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      username: `charlie_${suffix}`,
      password: "CharliePassword123!",
    },
  });
  assert.equal(charlieLoginRes.statusCode, 200);
  const charlieCookies = (charlieLoginRes.headers["set-cookie"] as string[])
    .map((c) => c.split(";")[0])
    .join("; ");
  const charlieCsrf = charlieLoginRes.json().csrfToken;

  // Create Charlie's own enrolled device
  const charlieDevId = crypto.randomUUID();
  await withTenantContext(adminDb, { bypassRls: true }, async (tx) => {
    await tx.devicePrefixRegistry.create({
      data: { businessId: bizBId, numberPrefix: "DC1" },
    });
    await tx.deviceEnrollment.create({
      data: {
        id: charlieDevId,
        businessId: bizBId,
        membershipId: charlieMemId,
        locationId: locBId,
        deviceName: "Charlie Viewer Device",
        numberPrefix: "DC1",
        status: "Enrolled",
      },
    });
  });

  // Charlie attempts to bootstrap Bob's device (devBId): MUST FAIL 403 (device assigned to Bob)!
  const charlieBobDevRes = await app.inject({
    method: "GET",
    url: `/v1/sync/bootstrap?deviceEnrollmentId=${devBId}`,
    headers: { cookie: charlieCookies },
  });
  assert.equal(
    charlieBobDevRes.statusCode,
    403,
    "Member cannot bootstrap a device assigned to another member",
  );

  // Charlie (Viewer) attempts to issue an offline lease for his own device: MUST FAIL 403 (Viewer role)!
  const charlieLeaseRes = await app.inject({
    method: "POST",
    url: "/v1/devices/lease",
    headers: {
      cookie: charlieCookies,
      "x-csrf-token": charlieCsrf,
    },
    payload: {
      deviceEnrollmentId: charlieDevId,
    },
  });
  assert.equal(
    charlieLeaseRes.statusCode,
    403,
    "Viewer role must be forbidden from issuing offline leases",
  );

  // Charlie (Viewer) calls /v1/sync/bootstrap with his own device: succeeds but lease is null
  const charlieBootstrapRes = await app.inject({
    method: "GET",
    url: `/v1/sync/bootstrap?deviceEnrollmentId=${charlieDevId}`,
    headers: { cookie: charlieCookies },
  });
  assert.equal(charlieBootstrapRes.statusCode, 200);
  assert.equal(
    charlieBootstrapRes.json().lease,
    null,
    "Viewer must receive null lease and cannot obtain offline authority",
  );

  // =========================================================================
  // REGRESSION 3: TWO PERMITTED USERS AT SAME LOCATION & LEASE INVARIANTS (Item 2)
  // Scenario:
  // - Bob and Dave are both Cashiers at the same location (locBId).
  // - devBId is enrolled for Bob.
  // - Dave cannot lease or bootstrap devBId (403 - assigned to Bob).
  // - Dave enrolls devDaveId at locBId.
  // - Dave can lease/bootstrap devDaveId; Bob cannot lease/bootstrap devDaveId.
  // - Re-bootstrap returns existing lease matching membership, epoch, policyVersion.
  // - Bumping datasetEpoch invalidates old lease and issues a new lease with epoch 2.
  // - Bumping membership permissionVersion invalidates old lease and issues a new lease.
  // =========================================================================
  const daveId = crypto.randomUUID();
  const daveMemBId = crypto.randomUUID();
  const devDaveId = crypto.randomUUID();

  await withTenantContext(adminDb, { bypassRls: true }, async (tx) => {
    const daveHash = await hashPassword("DavePassword123!");
    await tx.user.create({
      data: {
        id: daveId,
        username: `dave_${suffix}`,
        passwordHash: daveHash,
        fullName: "Dave Cashier",
      },
    });
    await tx.membership.create({
      data: {
        id: daveMemBId,
        businessId: bizBId,
        userId: daveId,
        role: "Cashier",
        locationId: locBId, // Same location as Bob!
      },
    });
    await tx.devicePrefixRegistry.create({
      data: { businessId: bizBId, numberPrefix: "DD1" },
    });
    await tx.deviceEnrollment.create({
      data: {
        id: devDaveId,
        businessId: bizBId,
        membershipId: daveMemBId,
        locationId: locBId,
        deviceName: "Dave Cashier Device",
        numberPrefix: "DD1",
        status: "Enrolled",
      },
    });
  });

  // Dave logs in
  const daveLoginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: {
      username: `dave_${suffix}`,
      password: "DavePassword123!",
    },
  });
  assert.equal(daveLoginRes.statusCode, 200);
  const daveCookies = (daveLoginRes.headers["set-cookie"] as string[])
    .map((c) => c.split(";")[0])
    .join("; ");
  const daveCsrf = daveLoginRes.json().csrfToken;

  // Dave attempts to lease Bob's device (devBId) -> 403 Forbidden
  const daveBobLeaseRes = await app.inject({
    method: "POST",
    url: "/v1/devices/lease",
    headers: {
      cookie: daveCookies,
      "x-csrf-token": daveCsrf,
    },
    payload: {
      deviceEnrollmentId: devBId,
    },
  });
  assert.equal(
    daveBobLeaseRes.statusCode,
    403,
    "Dave cannot lease Bob's device even though they share the same location and role",
  );

  // Dave attempts to bootstrap Bob's device (devBId) -> 403 Forbidden
  const daveBobBootstrapRes = await app.inject({
    method: "GET",
    url: `/v1/sync/bootstrap?deviceEnrollmentId=${devBId}`,
    headers: { cookie: daveCookies },
  });
  assert.equal(
    daveBobBootstrapRes.statusCode,
    403,
    "Dave cannot bootstrap Bob's device at the same location",
  );

  // Bob attempts to lease Dave's device (devDaveId) -> 403 Forbidden
  const bobDaveLeaseRes = await app.inject({
    method: "POST",
    url: "/v1/devices/lease",
    headers: {
      cookie: bobCookies,
      "x-csrf-token": bobLoginRes.json().csrfToken,
    },
    payload: {
      deviceEnrollmentId: devDaveId,
    },
  });
  assert.equal(bobDaveLeaseRes.statusCode, 403, "Bob cannot lease Dave's device");

  // Dave bootstraps his own device -> 200 with lease for Dave
  const daveBootstrapRes = await app.inject({
    method: "GET",
    url: `/v1/sync/bootstrap?deviceEnrollmentId=${devDaveId}`,
    headers: { cookie: daveCookies },
  });
  assert.equal(daveBootstrapRes.statusCode, 200);
  const daveBootstrap = daveBootstrapRes.json();
  assert.ok(daveBootstrap.lease, "Dave should receive a lease for his enrolled device");
  assert.equal(daveBootstrap.lease.membershipId, daveMemBId);

  // Bob bootstraps his own device -> 200 with lease for Bob
  const bobBootstrap2Res = await app.inject({
    method: "GET",
    url: `/v1/sync/bootstrap?deviceEnrollmentId=${devBId}`,
    headers: { cookie: bobCookies },
  });
  assert.equal(bobBootstrap2Res.statusCode, 200);
  const bobBootstrap2 = bobBootstrap2Res.json();
  const initialBobLease = bobBootstrap2.lease;
  assert.ok(initialBobLease);
  assert.equal(initialBobLease.membershipId, bobMemBId);
  assert.equal(initialBobLease.datasetEpoch, 1);
  assert.equal(initialBobLease.policyVersion, 1);

  // Calling bootstrap again returns the SAME lease
  const bobBootstrapCached = await app.inject({
    method: "GET",
    url: `/v1/sync/bootstrap?deviceEnrollmentId=${devBId}`,
    headers: { cookie: bobCookies },
  });
  assert.equal(bobBootstrapCached.statusCode, 200);
  assert.equal(
    bobBootstrapCached.json().lease.id,
    initialBobLease.id,
    "Unexpired matching lease must be returned",
  );

  // Bump business datasetEpoch to 2
  await withTenantContext(adminDb, { bypassRls: true }, async (tx) => {
    await tx.business.update({
      where: { id: bizBId },
      data: { datasetEpoch: 2 },
    });
  });

  // Bob bootstraps again: must NOT return the epoch 1 lease; must issue a new lease with datasetEpoch 2!
  const bobEpoch2Res = await app.inject({
    method: "GET",
    url: `/v1/sync/bootstrap?deviceEnrollmentId=${devBId}`,
    headers: { cookie: bobCookies },
  });
  assert.equal(bobEpoch2Res.statusCode, 200);
  const bobEpoch2Lease = bobEpoch2Res.json().lease;
  assert.ok(bobEpoch2Lease);
  assert.notEqual(
    bobEpoch2Lease.id,
    initialBobLease.id,
    "Old epoch lease must not be reused when datasetEpoch increases",
  );
  assert.equal(bobEpoch2Lease.datasetEpoch, 2);

  // Bump Bob's membership permissionVersion to 2
  await withTenantContext(adminDb, { bypassRls: true }, async (tx) => {
    await tx.membership.update({
      where: { id: bobMemBId },
      data: { permissionVersion: 2 },
    });
  });

  // Bob bootstraps again: must NOT return the policyVersion 1 lease; must issue a new lease with policyVersion 2!
  const bobPolicy2Res = await app.inject({
    method: "GET",
    url: `/v1/sync/bootstrap?deviceEnrollmentId=${devBId}`,
    headers: { cookie: bobCookies },
  });
  assert.equal(bobPolicy2Res.statusCode, 200);
  const bobPolicy2Lease = bobPolicy2Res.json().lease;
  assert.ok(bobPolicy2Lease);
  assert.notEqual(
    bobPolicy2Lease.id,
    bobEpoch2Lease.id,
    "Old policyVersion lease must not be reused when permissionVersion increases",
  );
  assert.equal(bobPolicy2Lease.policyVersion, 2);
  assert.equal(bobPolicy2Lease.datasetEpoch, 2);
});

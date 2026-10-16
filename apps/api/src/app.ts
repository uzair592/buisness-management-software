import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";
import fastifyCookie from "@fastify/cookie";
import {
  healthSchema,
  registerSchema,
  loginSchema,
  changePasswordSchema,
  selectBusinessSchema,
  enrollDeviceSchema,
  revokeDeviceSchema,
  requestLeaseSchema,
  ROLE_CAPABILITIES,
  type Role,
} from "@business/contracts";
import { type PrismaClient, withTenantContext } from "@business/db";
import { hashPassword, verifyPassword } from "./auth/password.js";
import {
  createSession,
  getSessionByToken,
  selectBusinessForSession,
  revokeSession,
  revokeOtherSessions,
  type SessionState,
} from "./auth/session.js";
import {
  isRateLimited,
  recordFailedAttempt,
  resetRateLimit,
} from "./auth/rateLimit.js";
import {
  enrollDevice,
  revokeDevice,
  issueOfflineLease,
} from "./devices/devices.js";

export interface CreateAppOptions {
  checkDatabase?: () => Promise<void>;
  db?: PrismaClient;
  sessionSecret?: string;
  leaseSecret?: string;
  isProduction?: boolean;
  trustProxy?: boolean | string | string[] | ((address: string, hop: number) => boolean);
}

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionState;
    user?: SessionState["user"];
    activeMembership?: SessionState["activeMembership"];
    memberships?: SessionState["memberships"];
  }
}

export function createApp(
  optionsOrCheckDb?: (() => Promise<void>) | PrismaClient | CreateAppOptions,
  legacyOptions?: { db?: PrismaClient; sessionSecret?: string; leaseSecret?: string },
): FastifyInstance {
  let checkDatabase: () => Promise<void>;
  let db: PrismaClient | undefined;
  let sessionSecret = "development_secret_at_least_32_characters_long_bms!";
  let leaseSecret = "development_lease_secret_at_least_32_characters_long!";
  let isProduction = false;
  let trustProxy: boolean | string | string[] | ((address: string, hop: number) => boolean) = true;

  if (typeof optionsOrCheckDb === "function") {
    checkDatabase = optionsOrCheckDb;
    db = legacyOptions?.db;
    if (legacyOptions?.sessionSecret) sessionSecret = legacyOptions.sessionSecret;
    if (legacyOptions?.leaseSecret) leaseSecret = legacyOptions.leaseSecret;
  } else if (optionsOrCheckDb && "user" in optionsOrCheckDb) {
    db = optionsOrCheckDb as PrismaClient;
    checkDatabase = async () => {
      await db!.$queryRaw`SELECT 1`;
    };
  } else {
    const opts = (optionsOrCheckDb as CreateAppOptions) || {};
    db = opts.db;
    checkDatabase =
      opts.checkDatabase ||
      (async () => {
        if (db) await db.$queryRaw`SELECT 1`;
      });
    if (opts.sessionSecret) sessionSecret = opts.sessionSecret;
    if (opts.leaseSecret) leaseSecret = opts.leaseSecret;
    if (opts.isProduction) isProduction = opts.isProduction;
    if (opts.trustProxy !== undefined) trustProxy = opts.trustProxy;
  }

  const app = Fastify({ http2: false, logger: false, requestTimeout: 5000, trustProxy });

  void app.register(fastifyCookie, {
    secret: sessionSecret,
    hook: "onRequest",
  });

  // Session extraction hook
  app.addHook("onRequest", async (request) => {
    if (!db) return;

    let token = request.cookies.bms_session;
    if (!token && request.headers.authorization?.startsWith("Bearer ")) {
      token = request.headers.authorization.slice(7);
    }

    if (token) {
      const sessionData = await getSessionByToken(db, token);
      if (sessionData) {
        request.session = sessionData;
        request.user = sessionData.user;
        request.activeMembership = sessionData.activeMembership;
        request.memberships = sessionData.memberships;
      }
    }
  });

  // Health checks
  app.get("/health/live", async () => healthSchema.parse({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await checkDatabase();
      return healthSchema.parse({ status: "ok" });
    } catch {
      reply.code(503);
      return healthSchema.parse({ status: "unavailable" });
    }
  });

  function requireDb(): PrismaClient {
    if (!db) throw new Error("Database client not configured");
    return db;
  }

  type AuthenticatedRequest = FastifyRequest & {
    session: SessionState;
    user: NonNullable<SessionState["user"]>;
  };

  function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ): request is AuthenticatedRequest {
    if (!request.session || !request.user) {
      void reply.code(401).send({ error: "Authentication required" });
      return false;
    }
    return true;
  }

  type TenantContextResult = {
    businessId: string;
    membership: NonNullable<SessionState["activeMembership"]>;
  };

  function requireTenantContext(
    request: AuthenticatedRequest,
    reply: FastifyReply,
  ): TenantContextResult | null {
    const businessId = request.session.selectedBusinessId;
    const membership = request.activeMembership;
    if (!businessId || !membership || membership.businessId !== businessId) {
      void reply.code(403).send({ error: "Active business membership required" });
      return null;
    }
    return { businessId, membership };
  }

  function verifyCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const headerToken = request.headers["x-csrf-token"];
      if (!headerToken || headerToken !== request.session?.csrfToken) {
        void reply.code(403).send({ error: "Invalid CSRF token" });
        return false;
      }
    }
    return true;
  }

  function setSessionCookies(
    reply: FastifyReply,
    rawToken: string,
    csrfToken: string,
  ) {
    reply.setCookie("bms_session", rawToken, {
      path: "/",
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
    });
    reply.setCookie("bms_csrf", csrfToken, {
      path: "/",
      httpOnly: false,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
    });
    reply.header("x-csrf-token", csrfToken);
  }

  // --- Auth routes ---

  app.post("/v1/auth/register", async (request, reply) => {
    const client = requireDb();
    const parseRes = registerSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({
        error: "Validation failed",
        details: parseRes.error.flatten(),
      });
    }

    const { username, password, fullName, email, businessName, currency, timezone } =
      parseRes.data;

    // Check unique username
    const existing = await client.user.findUnique({ where: { username } });
    if (existing) {
      return reply.code(409).send({ error: "Username already taken" });
    }

    const passwordHash = await hashPassword(password);
    const businessId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();

    // Bootstrap owner account, business, default location, and owner membership under least-privilege tenant context
    const result = await withTenantContext(
      client,
      { businessId, userId },
      async (tx) => {
        const user = await tx.user.create({
          data: {
            id: userId,
            username,
            passwordHash,
            fullName,
            email: email || null,
          },
        });

        const business = await tx.business.create({
          data: {
            id: businessId,
            name: businessName,
            currency,
            timezone,
            datasetEpoch: 1,
          },
        });

        const location = await tx.location.create({
          data: {
            id: locationId,
            businessId,
            code: "L01",
            name: "Main Branch",
          },
        });

        const membership = await tx.membership.create({
          data: {
            id: membershipId,
            businessId,
            userId,
            role: "Owner",
            locationId,
            permissionVersion: 1,
          },
        });

        await tx.auditEvent.create({
          data: {
            businessId,
            userId,
            action: "user.create",
            details: { username, role: "Owner" },
          },
        });

        return { user, business, location, membership };
      },
    );

    // Create session
    const ip = request.ip;
    const ua = request.headers["user-agent"];
    const sessionRes = await createSession(client, result.user.id, ua, ip);

    // Set selected business on session
    await client.session.update({
      where: { id: sessionRes.session.id },
      data: { selectedBusinessId: result.business.id },
    });

    setSessionCookies(reply, sessionRes.rawToken, sessionRes.csrfToken);

    return reply.code(201).send({
      user: {
        id: result.user.id,
        username: result.user.username,
        fullName: result.user.fullName,
        email: result.user.email,
      },
      business: result.business,
      membership: {
        id: result.membership.id,
        businessId: result.business.id,
        businessName: result.business.name,
        role: result.membership.role,
        permissionVersion: result.membership.permissionVersion,
        locationId: result.location.id,
        locationName: result.location.name,
      },
      csrfToken: sessionRes.csrfToken,
    });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const client = requireDb();
    const parseRes = loginSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: "Validation failed" });
    }

    const { username, password } = parseRes.data;
    // Finding 5: Do not trust arbitrary headers directly; use request.ip governed by trustProxy
    const clientIp = request.ip;
    const sourceKey = `source:${clientIp}`;
    const accountKey = `account:${username.toLowerCase().trim()}`;

    // Account-level limit (5 failures) and source IP limit (10 failures)
    if (isRateLimited(accountKey, 5) || isRateLimited(sourceKey, 10)) {
      return reply.code(429).send({
        error: "Too many failed login attempts. Please wait a minute before retrying.",
      });
    }

    const user = await client.user.findUnique({
      where: { username },
    });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      recordFailedAttempt(accountKey);
      recordFailedAttempt(sourceKey);
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    // Reset ONLY account-level limits for successful user.
    // Do NOT reset source-level limits, preventing erasure of unrelated abuse protection.
    resetRateLimit(accountKey);

    const ua = request.headers["user-agent"];
    const sessionRes = await createSession(client, user.id, ua, clientIp);

    setSessionCookies(reply, sessionRes.rawToken, sessionRes.csrfToken);

    // Retrieve fresh session state
    const sessionState = await getSessionByToken(client, sessionRes.rawToken);

    return reply.code(200).send({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
      },
      csrfToken: sessionRes.csrfToken,
      selectedBusinessId: sessionState?.selectedBusinessId ?? null,
      activeMembership: sessionState?.activeMembership
        ? {
            id: sessionState.activeMembership.id,
            businessId: sessionState.activeMembership.businessId,
            businessName: sessionState.activeMembership.business.name,
            role: sessionState.activeMembership.role,
            permissionVersion: sessionState.activeMembership.permissionVersion,
            locationId: sessionState.activeMembership.locationId,
            locationName: sessionState.activeMembership.location?.name ?? null,
          }
        : null,
      memberships: (sessionState?.memberships ?? []).map((m) => ({
        id: m.id,
        businessId: m.businessId,
        businessName: m.business.name,
        role: m.role,
        permissionVersion: m.permissionVersion,
        locationId: m.locationId,
        locationName: m.location?.name ?? null,
      })),
    });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const client = requireDb();
    if (request.session) {
      await revokeSession(client, request.session.id);
    }
    reply.clearCookie("bms_session", { path: "/" });
    reply.clearCookie("bms_csrf", { path: "/" });
    return reply.code(200).send({ success: true });
  });

  app.get("/v1/auth/me", async (request, reply) => {
    if (!request.session || !request.user) {
      return reply.code(200).send({
        authenticated: false,
        user: null,
        csrfToken: null,
        selectedBusinessId: null,
        activeMembership: null,
        memberships: [],
      });
    }

    return reply.code(200).send({
      authenticated: true,
      user: {
        id: request.user.id,
        username: request.user.username,
        fullName: request.user.fullName,
        email: request.user.email,
      },
      csrfToken: request.session.csrfToken,
      selectedBusinessId: request.session.selectedBusinessId ?? null,
      activeMembership: request.activeMembership
        ? {
            id: request.activeMembership.id,
            businessId: request.activeMembership.businessId,
            businessName: request.activeMembership.business.name,
            role: request.activeMembership.role,
            permissionVersion: request.activeMembership.permissionVersion,
            locationId: request.activeMembership.locationId,
            locationName: request.activeMembership.location?.name ?? null,
          }
        : null,
      memberships: (request.memberships ?? []).map((m) => ({
        id: m.id,
        businessId: m.businessId,
        businessName: m.business.name,
        role: m.role as Role,
        permissionVersion: m.permissionVersion,
        locationId: m.locationId,
        locationName: m.location?.name ?? null,
      })),
    });
  });

  app.post("/v1/auth/select-business", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!verifyCsrf(request, reply)) return;
    const client = requireDb();

    const parseRes = selectBusinessSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: "Invalid business ID" });
    }

    try {
      await selectBusinessForSession(
        client,
        request.session.id,
        request.user.id,
        parseRes.data.businessId,
      );

      // Re-fetch updated session state
      let token = request.cookies.bms_session;
      if (!token && request.headers.authorization?.startsWith("Bearer ")) {
        token = request.headers.authorization.slice(7);
      }
      const updated = token ? await getSessionByToken(client, token) : null;

      return reply.code(200).send({
        success: true,
        selectedBusinessId: parseRes.data.businessId,
        activeMembership: updated?.activeMembership
          ? {
              id: updated.activeMembership.id,
              businessId: updated.activeMembership.businessId,
              businessName: updated.activeMembership.business.name,
              role: updated.activeMembership.role,
              permissionVersion: updated.activeMembership.permissionVersion,
              locationId: updated.activeMembership.locationId,
              locationName: updated.activeMembership.location?.name ?? null,
            }
          : null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Access denied";
      return reply.code(403).send({ error: message });
    }
  });

  app.post("/v1/auth/change-password", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!verifyCsrf(request, reply)) return;
    const client = requireDb();

    const parseRes = changePasswordSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({
        error: "Validation failed",
        details: parseRes.error.flatten(),
      });
    }

    const { currentPassword, newPassword, revokeOtherSessions: shouldRevokeOthers } =
      parseRes.data;

    const user = await client.user.findUnique({
      where: { id: request.user.id },
    });

    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return reply.code(401).send({ error: "Current password is incorrect" });
    }

    const newHash = await hashPassword(newPassword);

    await client.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    if (shouldRevokeOthers) {
      await revokeOtherSessions(client, user.id, request.session.id);
    }

    await withTenantContext(
      client,
      { userId: user.id, businessId: request.session.selectedBusinessId ?? undefined },
      async (tx) => {
        await tx.auditEvent.create({
          data: {
            userId: user.id,
            businessId: request.session.selectedBusinessId,
            action: "credential.change",
            details: { revokedOtherSessions: shouldRevokeOthers },
          },
        });
      },
    );

    return reply.code(200).send({ success: true });
  });

  app.get("/v1/auth/sessions", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const client = requireDb();

    const sessions = await client.session.findMany({
      where: {
        userId: request.user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    return reply.code(200).send(
      sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        isCurrent: s.id === request.session.id,
      })),
    );
  });

  app.post("/v1/auth/sessions/:id/revoke", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!verifyCsrf(request, reply)) return;
    const client = requireDb();
    const { id } = request.params as { id: string };

    const target = await client.session.findFirst({
      where: { id, userId: request.user.id },
    });

    if (!target) {
      return reply.code(404).send({ error: "Session not found" });
    }

    await revokeSession(client, id);
    return reply.code(200).send({ success: true });
  });

  // --- Locations ---

  app.get("/v1/locations", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb();

    const locations = await withTenantContext(
      client,
      { businessId: tenant.businessId, userId: request.user.id },
      async (tx) => {
        // Return only permitted locations (scoped to membership location if assigned)
        if (tenant.membership.locationId && tenant.membership.role !== "Owner") {
          return await tx.location.findMany({
            where: { businessId: tenant.businessId, id: tenant.membership.locationId },
            orderBy: { code: "asc" },
          });
        }
        return await tx.location.findMany({
          where: { businessId: tenant.businessId },
          orderBy: { code: "asc" },
        });
      },
    );

    return reply.code(200).send(
      locations.map((loc) => ({
        id: loc.id,
        code: loc.code,
        name: loc.name,
      })),
    );
  });

  // --- Devices & Enrolment ---

  app.get("/v1/devices", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb();

    const devices = await withTenantContext(
      client,
      { businessId: tenant.businessId, userId: request.user.id },
      async (tx) => {
        return await tx.deviceEnrollment.findMany({
          where: { businessId: tenant.businessId },
          orderBy: { enrolledAt: "desc" },
        });
      },
    );

    return reply.code(200).send(
      devices.map((d) => ({
        id: d.id,
        businessId: d.businessId,
        membershipId: d.membershipId,
        locationId: d.locationId,
        deviceName: d.deviceName,
        numberPrefix: d.numberPrefix,
        status: d.status,
        enrolledAt: d.enrolledAt.toISOString(),
        revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
      })),
    );
  });

  app.post("/v1/devices/enroll", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!verifyCsrf(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb();

    if (tenant.membership.role !== "Owner") {
      return reply.code(403).send({ error: "Only owners can enroll devices" });
    }

    const parseRes = enrollDeviceSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({
        error: "Validation failed",
        details: parseRes.error.flatten(),
      });
    }

    try {
      const enrollment = await enrollDevice(client, {
        businessId: tenant.businessId,
        membershipId: tenant.membership.id,
        locationId: parseRes.data.locationId,
        deviceName: parseRes.data.deviceName,
        numberPrefix: parseRes.data.numberPrefix,
        actorUserId: request.user.id,
      });

      return reply.code(201).send({
        id: enrollment.id,
        businessId: enrollment.businessId,
        membershipId: enrollment.membershipId,
        locationId: enrollment.locationId,
        deviceName: enrollment.deviceName,
        numberPrefix: enrollment.numberPrefix,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt.toISOString(),
        revokedAt: enrollment.revokedAt ? enrollment.revokedAt.toISOString() : null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Enrollment failed";
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/v1/devices/revoke", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!verifyCsrf(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb();

    if (tenant.membership.role !== "Owner") {
      return reply.code(403).send({ error: "Only owners can revoke devices" });
    }

    const parseRes = revokeDeviceSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: "Validation failed" });
    }

    try {
      const revoked = await revokeDevice(client, {
        businessId: tenant.businessId,
        deviceEnrollmentId: parseRes.data.deviceEnrollmentId,
        actorUserId: request.user.id,
        reason: parseRes.data.reason,
      });

      return reply.code(200).send({
        id: revoked.id,
        businessId: revoked.businessId,
        status: revoked.status,
        revokedAt: revoked.revokedAt ? revoked.revokedAt.toISOString() : null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Revocation failed";
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/v1/devices/lease", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!verifyCsrf(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb();

    // Finding 4: Enforce capability check (A Viewer must not obtain an owner's lease or issue offline authority)
    const role = tenant.membership.role as Role;
    const capabilities = ROLE_CAPABILITIES[role] ?? [];
    if (!capabilities.includes("offline:lease")) {
      return reply.code(403).send({ error: "Membership lacks offline lease capability" });
    }

    const parseRes = requestLeaseSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: "Validation failed" });
    }

    // Verify device belongs to this business and matches location if membership is location-scoped
    const device = await withTenantContext(
      client,
      { businessId: tenant.businessId, userId: request.user.id },
      async (tx) => {
        return await tx.deviceEnrollment.findFirst({
          where: { id: parseRes.data.deviceEnrollmentId, businessId: tenant.businessId },
        });
      },
    );

    if (!device || device.status !== "Enrolled") {
      return reply.code(403).send({ error: "Device is not enrolled or has been revoked" });
    }

    if (tenant.membership.locationId && tenant.membership.role !== "Owner") {
      if (device.locationId !== tenant.membership.locationId) {
        return reply.code(403).send({ error: "Device location does not match membership scope" });
      }
    }

    try {
      const lease = await issueOfflineLease(client, leaseSecret, {
        businessId: tenant.businessId,
        deviceEnrollmentId: parseRes.data.deviceEnrollmentId,
        membershipId: tenant.membership.id,
      });

      return reply.code(200).send({
        id: lease.id,
        businessId: lease.businessId,
        deviceEnrollmentId: lease.deviceEnrollmentId,
        membershipId: lease.membershipId,
        datasetEpoch: lease.datasetEpoch,
        policyVersion: lease.policyVersion,
        issuedAt: lease.issuedAt.toISOString(),
        expiresAt: lease.expiresAt.toISOString(),
        revokedAt: lease.revokedAt ? lease.revokedAt.toISOString() : null,
        signature: lease.signature,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Lease issuance failed";
      return reply.code(400).send({ error: message });
    }
  });

  // --- Identity Bootstrap ---

  app.get("/v1/sync/bootstrap", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb();

    const { deviceEnrollmentId } = request.query as { deviceEnrollmentId?: string };
    if (!deviceEnrollmentId) {
      return reply.code(400).send({ error: "deviceEnrollmentId query parameter required" });
    }

    const { device, business, locations, existingLease } = await withTenantContext(
      client,
      { businessId: tenant.businessId, userId: request.user.id },
      async (tx) => {
        const d = await tx.deviceEnrollment.findFirst({
          where: { id: deviceEnrollmentId, businessId: tenant.businessId },
        });

        const b = await tx.business.findUniqueOrThrow({
          where: { id: tenant.businessId },
        });

        const locs = await tx.location.findMany({
          where: {
            businessId: tenant.businessId,
            ...(tenant.membership.locationId && tenant.membership.role !== "Owner"
              ? { id: tenant.membership.locationId }
              : {}),
          },
          orderBy: { code: "asc" },
        });

        const l = await tx.offlineLease.findFirst({
          where: {
            businessId: tenant.businessId,
            deviceEnrollmentId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          orderBy: { issuedAt: "desc" },
        });

        return { device: d, business: b, locations: locs, existingLease: l };
      },
    );

    if (!device || device.status !== "Enrolled") {
      return reply.code(403).send({ error: "Device is not enrolled or has been revoked" });
    }

    if (tenant.membership.locationId && tenant.membership.role !== "Owner") {
      if (device.locationId !== tenant.membership.locationId) {
        return reply.code(403).send({ error: "Device location does not match membership scope" });
      }
    }

    const role = tenant.membership.role as Role;
    const capabilities = ROLE_CAPABILITIES[role] ?? [];
    const canLease = capabilities.includes("offline:lease");

    let lease = null;
    if (canLease) {
      lease = existingLease;
      if (!lease) {
        lease = await issueOfflineLease(client, leaseSecret, {
          businessId: tenant.businessId,
          deviceEnrollmentId,
          membershipId: tenant.membership.id,
        });
      }
    }

    return reply.code(200).send({
      business: {
        id: business.id,
        name: business.name,
        currency: business.currency,
        timezone: business.timezone,
        datasetEpoch: business.datasetEpoch,
      },
      membership: {
        id: tenant.membership.id,
        businessId: tenant.membership.businessId,
        businessName: tenant.membership.business.name,
        role: tenant.membership.role,
        permissionVersion: tenant.membership.permissionVersion,
        locationId: tenant.membership.locationId,
        locationName: tenant.membership.location?.name ?? null,
      },
      device: {
        id: device.id,
        businessId: device.businessId,
        membershipId: device.membershipId,
        locationId: device.locationId,
        deviceName: device.deviceName,
        numberPrefix: device.numberPrefix,
        status: device.status,
        enrolledAt: device.enrolledAt.toISOString(),
        revokedAt: device.revokedAt ? device.revokedAt.toISOString() : null,
      },
      lease: lease
        ? {
            id: lease.id,
            businessId: lease.businessId,
            deviceEnrollmentId: lease.deviceEnrollmentId,
            membershipId: lease.membershipId,
            datasetEpoch: lease.datasetEpoch,
            policyVersion: lease.policyVersion,
            issuedAt: lease.issuedAt.toISOString(),
            expiresAt: lease.expiresAt.toISOString(),
            revokedAt: lease.revokedAt ? lease.revokedAt.toISOString() : null,
            signature: lease.signature,
          }
        : null,
      permittedLocations: locations.map((loc) => ({
        id: loc.id,
        code: loc.code,
        name: loc.name,
      })),
      rolePermissions: {
        role,
        capabilities,
      },
    });
  });

  return app;
}

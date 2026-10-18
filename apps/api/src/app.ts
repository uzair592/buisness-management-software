import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";
import fastifyCookie from "@fastify/cookie";
import { z } from "zod";
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
import { type Prisma, type PrismaClient, ChangedCommandError, withBusinessChange, withTenantContext } from "@business/db";
import { openingInput, prepareOpening, commitOpening, systemAccounts, OpeningConflict } from "./opening.js";
import { provisionalPartyInput, acceptProvisionalParty, ProvisionalPartyConflict } from "./provisional-party.js";
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
  let trustProxy: boolean | string | string[] | ((address: string, hop: number) => boolean) = false;

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

    if (device.membershipId !== tenant.membership.id) {
      return reply.code(403).send({ error: "Device is enrolled for another membership" });
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
        actorUserId: request.user.id,
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

    const { device, business, locations, existingLease, catalogue, syncCursor } = await withTenantContext(
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
            membershipId: tenant.membership.id,
            datasetEpoch: b.datasetEpoch,
            policyVersion: tenant.membership.permissionVersion,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          orderBy: { issuedAt: "desc" },
        });
        // Capture the floor before reading models: concurrent later changes can be replayed by pull.
        const syncHead = await tx.syncHead.findUnique({ where: { businessId: tenant.businessId } });

        const [items, parties, categories, units, taxProfiles, conversions] = await Promise.all([
          tx.item.findMany({ where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, kind: true, name: true, sku: true, barcode: true, salePrice: true,
              categoryId: true, baseUnitId: true, taxProfileId: true, version: true } }),
          tx.party.findMany({ where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, name: true, isCustomer: true, isSupplier: true, phone: true, email: true, version: true } }),
          tx.category.findMany({ where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, name: true, version: true } }),
          tx.unit.findMany({ where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, code: true, name: true, version: true } }),
          tx.taxProfile.findMany({ where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, name: true, rate: true, mode: true, version: true } }),
          tx.itemUnitConversion.findMany({ where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, itemId: true, unitId: true, factor: true, version: true } }),
        ]);
        const accountSetup = ["Owner", "Accountant"].includes(tenant.membership.role) ? {
          accounts: await tx.account.findMany({ where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, code: true, name: true, kind: true, classification: true,
              expenseCategoryId: true, version: true } }),
          expenseCategories: await tx.expenseCategory.findMany({ where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, name: true, version: true } }),
        } : null;
        return { device: d, business: b, locations: locs, existingLease: l,
          syncCursor: (syncHead?.committedCursor ?? 0n).toString(),
          catalogue: { items, parties, categories, units, taxProfiles, conversions, accountSetup } };
      },
    );

    if (!device || device.status !== "Enrolled") {
      return reply.code(403).send({ error: "Device is not enrolled or has been revoked" });
    }

    if (device.membershipId !== tenant.membership.id) {
      return reply.code(403).send({ error: "Device is enrolled for another membership" });
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
          actorUserId: request.user.id,
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
      catalogue,
      syncCursor,
      rolePermissions: {
        role,
        capabilities,
      },
    });
  });

  app.get("/v1/sync/pull", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const parsed = z.object({ deviceEnrollmentId: z.uuid(), afterCursor: z.string().regex(/^\d{1,19}$/),
      limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid pull cursor or device" });
    const { deviceEnrollmentId, afterCursor, limit } = parsed.data;
    const after = BigInt(afterCursor);
    const result = await withTenantContext(requireDb(), { businessId: tenant.businessId, userId: request.user.id }, async (tx) => {
      const device = await tx.deviceEnrollment.findFirst({ where: { id: deviceEnrollmentId,
        businessId: tenant.businessId, membershipId: tenant.membership.id, status: "Enrolled" } });
      if (!device || (tenant.membership.locationId && tenant.membership.role !== "Owner" && device.locationId !== tenant.membership.locationId)) return null;
      const head = await tx.syncHead.findUnique({ where: { businessId: tenant.businessId } });
      const committedCursor = head?.committedCursor ?? 0n;
      const epoch = head?.datasetEpoch ?? (await tx.business.findUniqueOrThrow({ where: { id: tenant.businessId } })).datasetEpoch;
      if (after > committedCursor) return { invalidCursor: true };
      const batches = await tx.changeBatch.findMany({ where: { businessId: tenant.businessId,
        datasetEpoch: epoch, cursor: { gt: after } }, orderBy: { cursor: "asc" }, take: limit });
      const privileged = ["Owner", "Accountant"].includes(tenant.membership.role);
      const changes = [];
      for (const batch of batches) {
        const payload = batch.payload as Record<string, unknown>;
        const action = typeof payload.action === "string" ? payload.action : "";
        const id = typeof payload.id === "string" ? payload.id : "";
        if (action === "account.system_init" && privileged) {
          const rows = await tx.account.findMany({ where: { businessId: tenant.businessId,
            code: { in: systemAccounts.map((account) => account.code) } },
            select: { id: true, code: true, name: true, kind: true, classification: true,
              expenseCategoryId: true, version: true, archivedAt: true } });
          changes.push({ cursor: batch.cursor.toString(), action, row: { accounts: rows } });
          continue;
        }
        if (!id) continue;
        const group = action.split(".")[0];
        if (["account", "expense_category"].includes(group) && !privileged) continue;
        const where = { id, businessId: tenant.businessId };
        let row: Record<string, unknown> | null = null;
        if (group === "item") row = await tx.item.findFirst({ where,
          select: { id: true, name: true, kind: true, sku: true, barcode: true, salePrice: true,
            categoryId: true, baseUnitId: true, taxProfileId: true, version: true, archivedAt: true } });
        else if (group === "party") row = await tx.party.findFirst({ where,
          select: { id: true, name: true, isCustomer: true, isSupplier: true, phone: true, email: true, version: true, archivedAt: true } });
        else if (group === "category") row = await tx.category.findFirst({ where,
          select: { id: true, name: true, version: true, archivedAt: true } });
        else if (group === "unit") row = await tx.unit.findFirst({ where,
          select: { id: true, name: true, code: true, version: true, archivedAt: true } });
        else if (group === "tax_profile") row = await tx.taxProfile.findFirst({ where,
          select: { id: true, name: true, rate: true, mode: true, version: true, archivedAt: true } });
        else if (group === "conversion") row = await tx.itemUnitConversion.findFirst({ where,
          select: { id: true, itemId: true, unitId: true, factor: true, version: true, archivedAt: true } });
        else if (group === "account" && privileged) row = await tx.account.findFirst({ where,
          select: { id: true, code: true, name: true, kind: true, classification: true,
            expenseCategoryId: true, version: true, archivedAt: true } });
        else if (group === "expense_category" && privileged) row = await tx.expenseCategory.findFirst({ where,
          select: { id: true, name: true, version: true, archivedAt: true } });
        if (row) changes.push({ cursor: batch.cursor.toString(), action, row });
      }
      const nextCursor = (batches.at(-1)?.cursor ?? after).toString();
      return { datasetEpoch: epoch, fromCursor: afterCursor, nextCursor,
        committedCursor: committedCursor.toString(), hasMore: BigInt(nextCursor) < committedCursor, changes };
    });
    if (!result) return reply.code(403).send({ error: "Device is not enrolled for this membership" });
    if ("invalidCursor" in result) return reply.code(400).send({ error: "Cursor is ahead of this business" });
    return result;
  });

  // --- M04 persisted master data (financial posting remains in the journal dispatcher) ---
  const listQuery = z.object({
    q: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  });
  const partyInput = z.object({
    name: z.string().trim().min(1).max(160),
    isCustomer: z.boolean(), isSupplier: z.boolean(),
    phone: z.string().trim().max(40).nullable().default(null),
    email: z.email().max(255).nullable().default(null),
  }).refine((value) => value.isCustomer || value.isSupplier, "Choose customer or supplier");
  const itemInput = z.object({
    name: z.string().trim().min(1).max(160),
    kind: z.enum(["Goods", "Service"]),
    categoryId: z.uuid().nullable().default(null),
    baseUnitId: z.uuid().nullable().default(null),
    taxProfileId: z.uuid().nullable().default(null),
    sku: z.string().trim().min(1).max(60).nullable().default(null),
    barcode: z.string().trim().min(1).max(100).nullable().default(null),
    salePrice: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  }).refine((value) => value.kind === "Service" || !!value.baseUnitId, "Goods require a base unit");
  const idParam = z.object({ id: z.uuid() });
  const partyEdit = partyInput.extend({ expectedVersion: z.number().int().positive(), archive: z.boolean().default(false) });
  const itemEdit = itemInput.extend({ expectedVersion: z.number().int().positive(), archive: z.boolean().default(false) });

  async function checkItemReferences(
    tx: Prisma.TransactionClient, businessId: string,
    data: { categoryId: string | null; baseUnitId: string | null; taxProfileId: string | null },
  ) {
    if (data.categoryId && !await tx.category.findFirst({ where: { id: data.categoryId, businessId, archivedAt: null } })) throw new Error("INVALID_ITEM_REFERENCE");
    if (data.baseUnitId && !await tx.unit.findFirst({ where: { id: data.baseUnitId, businessId, archivedAt: null } })) throw new Error("INVALID_ITEM_REFERENCE");
    if (data.taxProfileId && !await tx.taxProfile.findFirst({ where: { id: data.taxProfileId, businessId, archivedAt: null } })) throw new Error("INVALID_ITEM_REFERENCE");
  }

  function masterContext(request: FastifyRequest, reply: FastifyReply, write: boolean) {
    if (!requireAuth(request, reply)) return null;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return null;
    if (write && !["Owner", "Accountant"].includes(tenant.membership.role)) {
      void reply.code(403).send({ error: "Master data editing requires owner or accountant" });
      return null;
    }
    if (write && !verifyCsrf(request, reply)) return null;
    return { businessId: tenant.businessId, userId: request.user.id };
  }

  app.get("/v1/catalogue/parties", async (request, reply) => {
    const tenant = masterContext(request, reply, false);
    if (!tenant) return;
    const query = listQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid list query" });
    const { q, page } = query.data;
    const rows = await withTenantContext(requireDb(), tenant, async (tx) => tx.party.findMany({
      where: { businessId: tenant.businessId, archivedAt: null, name: { contains: q, mode: "insensitive" } },
      orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * 25, take: 26,
    }));
    return { rows: rows.slice(0, 25), page, hasMore: rows.length > 25 };
  });

  app.post("/v1/catalogue/parties", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = partyInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid party", details: parsed.error.flatten() });
    const id = crypto.randomUUID();
    const row = await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "party.create", async (tx) => {
      const result = await tx.party.create({ data: { id, businessId: tenant.businessId, ...parsed.data } });
      return { result, change: { id, version: 1 } };
    });
    return reply.code(201).send(row);
  });

  app.post("/v1/catalogue/parties/provisional", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant || !verifyCsrf(request, reply)) return;
    const parsed = provisionalPartyInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid provisional party command" });
    try {
      return await acceptProvisionalParty(requireDb(), { businessId: tenant.businessId, userId: request.user.id,
        membershipId: tenant.membership.id, role: tenant.membership.role,
        locationId: tenant.membership.locationId }, parsed.data);
    } catch (error) {
      if (error instanceof ProvisionalPartyConflict) return reply.code(409).send({ error: error.message });
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "Provisional party ID or command is already in use" });
      }
      throw error;
    }
  });

  app.patch("/v1/catalogue/parties/:id", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const params = idParam.safeParse(request.params);
    const parsed = partyEdit.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid party edit" });
    const { expectedVersion, archive, ...data } = parsed.data;
    try {
      const row = await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "party.edit", async (tx) => {
        const changed = await tx.party.updateMany({
          where: { id: params.data.id, businessId: tenant.businessId, version: expectedVersion, archivedAt: null },
          data: { ...data, version: { increment: 1 }, ...(archive ? { archivedAt: new Date() } : {}) },
        });
        if (!changed.count) throw new Error("VERSION_CONFLICT");
        const result = await tx.party.findUniqueOrThrow({ where: { id: params.data.id } });
        return { result, change: { id: result.id, version: result.version, archived: archive } };
      });
      return row;
    } catch (error) {
      if (error instanceof Error && error.message === "VERSION_CONFLICT") return reply.code(409).send({ error: "Party changed on another device; reload and review your edits" });
      throw error;
    }
  });

  const categoryInput = z.object({ name: z.string().trim().min(1).max(120) });
  const unitInput = z.object({ code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/), name: z.string().trim().min(1).max(80) });
  const taxInput = z.object({ name: z.string().trim().min(1).max(100), rate: z.string().regex(/^\d+(?:\.\d{1,4})?$/), mode: z.enum(["Inclusive", "Exclusive"]) })
    .refine((input) => { const [whole] = input.rate.split("."); return BigInt(whole) <= 100n && (whole !== "100" || !input.rate.includes(".") || /^100\.0+$/.test(input.rate)); });
  const conversionInput = z.object({ itemId: z.uuid(), unitId: z.uuid(), factor: z.string().regex(/^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,6})?$/) });

  app.get("/v1/catalogue/setup", async (request, reply) => {
    const tenant = masterContext(request, reply, false);
    if (!tenant) return;
    return withTenantContext(requireDb(), tenant, async (tx) => ({
      categories: await tx.category.findMany({ where: { businessId: tenant.businessId, archivedAt: null }, orderBy: { name: "asc" } }),
      units: await tx.unit.findMany({ where: { businessId: tenant.businessId, archivedAt: null }, orderBy: { code: "asc" } }),
      taxProfiles: await tx.taxProfile.findMany({ where: { businessId: tenant.businessId, archivedAt: null }, orderBy: { name: "asc" } }),
    }));
  });

  // Bounded choices for setup forms: do not download the entire catalogue to a device.
  app.get("/v1/catalogue/choices", async (request, reply) => {
    const tenant = masterContext(request, reply, false);
    if (!tenant) return;
    const parsed = listQuery.extend({ kind: z.enum(["items", "parties"]),
      role: z.enum(["Stock", "Receivable", "Payable"]) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid choice query" });
    const { kind, q, page, role } = parsed.data;
    if ((kind === "items") !== (role === "Stock")) return reply.code(400).send({ error: "Invalid choice role" });
    return withTenantContext(requireDb(), tenant, async (tx) => {
      const where = kind === "items" ? { businessId: tenant.businessId, archivedAt: null, kind: "Goods",
        OR: [{ name: { contains: q, mode: "insensitive" as const } }, { barcode: { contains: q } }] } :
        { businessId: tenant.businessId, archivedAt: null, ...(role === "Receivable" ? { isCustomer: true } : { isSupplier: true }),
          name: { contains: q, mode: "insensitive" as const } };
      const rows = kind === "items" ? await tx.item.findMany({ where, select: { id: true, name: true, kind: true },
        orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * 25, take: 26 }) :
        await tx.party.findMany({ where, select: { id: true, name: true, isCustomer: true, isSupplier: true },
          orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * 25, take: 26 });
      return { rows: rows.slice(0, 25), page, hasMore: rows.length > 25 };
    });
  });

  app.get("/v1/catalogue/conversions", async (request, reply) => {
    const tenant = masterContext(request, reply, false);
    if (!tenant) return;
    const parsed = z.object({ itemId: z.uuid() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid item" });
    return withTenantContext(requireDb(), tenant, async (tx) => ({ rows: await tx.itemUnitConversion.findMany({
      where: { businessId: tenant.businessId, itemId: parsed.data.itemId, archivedAt: null },
      orderBy: { id: "asc" }, select: { id: true, unitId: true, factor: true, version: true },
    }) }));
  });

  app.post("/v1/catalogue/categories", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = categoryInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid category" });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "category.create", async (tx) => {
        const result = await tx.category.create({ data: { id, businessId: tenant.businessId, name: parsed.data.name } });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Category name already exists" });
      throw error;
    }
  });

  app.post("/v1/catalogue/units", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = unitInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid unit" });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "unit.create", async (tx) => {
        const result = await tx.unit.create({ data: { id, businessId: tenant.businessId, ...parsed.data } });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Unit code already exists" });
      throw error;
    }
  });

  app.post("/v1/catalogue/tax-profiles", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = taxInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid tax profile" });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "tax_profile.create", async (tx) => {
        const result = await tx.taxProfile.create({ data: { id, businessId: tenant.businessId, ...parsed.data } });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Tax profile name already exists" });
      throw error;
    }
  });

  app.post("/v1/catalogue/conversions", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = conversionInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid unit conversion" });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "conversion.create", async (tx) => {
        const item = await tx.item.findFirst({ where: { id: parsed.data.itemId, businessId: tenant.businessId, kind: "Goods", archivedAt: null } });
        const unit = await tx.unit.findFirst({ where: { id: parsed.data.unitId, businessId: tenant.businessId, archivedAt: null } });
        if (!item || !unit || item.baseUnitId === unit.id) throw new Error("INVALID_CONVERSION_REFERENCE");
        const result = await tx.itemUnitConversion.create({ data: { id, businessId: tenant.businessId, ...parsed.data } });
        return { result, change: { id, itemId: item.id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CONVERSION_REFERENCE") return reply.code(400).send({ error: "Item and alternate unit must belong to this business" });
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Conversion already exists" });
      throw error;
    }
  });

  const setupVersion = z.object({ expectedVersion: z.number().int().positive(), archive: z.boolean().default(false) });
  const setupEditors = [
    { path: "categories", group: "category", input: categoryInput.extend(setupVersion.shape) },
    { path: "units", group: "unit", input: unitInput.pick({ name: true }).extend(setupVersion.shape) },
    { path: "tax-profiles", group: "tax_profile", input: taxInput.extend(setupVersion.shape) },
    { path: "conversions", group: "conversion", input: conversionInput.pick({ factor: true }).extend(setupVersion.shape) },
  ] as const;
  for (const editor of setupEditors) {
    app.patch(`/v1/catalogue/${editor.path}/:id`, async (request, reply) => {
      const tenant = masterContext(request, reply, true);
      if (!tenant) return;
      const params = idParam.safeParse(request.params);
      const parsed = editor.input.safeParse(request.body);
      if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid setup edit" });
      const { expectedVersion, archive, ...data } = parsed.data;
      try {
        return await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, `${editor.group}.edit`, async (tx) => {
          const where = { id: params.data.id, businessId: tenant.businessId, version: expectedVersion, archivedAt: null };
          const update = { ...data, version: { increment: 1 }, ...(archive ? { archivedAt: new Date() } : {}) };
          let result;
          if (editor.group === "category") {
            if (!(await tx.category.updateMany({ where, data: update })).count) throw new Error("VERSION_CONFLICT");
            result = await tx.category.findUniqueOrThrow({ where: { id: params.data.id } });
          } else if (editor.group === "unit") {
            if (!(await tx.unit.updateMany({ where, data: update })).count) throw new Error("VERSION_CONFLICT");
            result = await tx.unit.findUniqueOrThrow({ where: { id: params.data.id } });
          } else if (editor.group === "tax_profile") {
            if (!(await tx.taxProfile.updateMany({ where, data: update })).count) throw new Error("VERSION_CONFLICT");
            result = await tx.taxProfile.findUniqueOrThrow({ where: { id: params.data.id } });
          } else {
            if (!(await tx.itemUnitConversion.updateMany({ where, data: update })).count) throw new Error("VERSION_CONFLICT");
            result = await tx.itemUnitConversion.findUniqueOrThrow({ where: { id: params.data.id } });
          }
          return { result, change: { id: result.id, version: result.version, archived: archive } };
        });
      } catch (error) {
        if (error instanceof Error && error.message === "VERSION_CONFLICT") return reply.code(409).send({ error: "Setup changed on another device; reload and review your edits" });
        if (typeof error === "object" && error && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Setup name already exists in this business" });
        throw error;
      }
    });
  }

  app.get("/v1/catalogue/items", async (request, reply) => {
    const tenant = masterContext(request, reply, false);
    if (!tenant) return;
    const query = listQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid list query" });
    const { q, page } = query.data;
    const rows = await withTenantContext(requireDb(), tenant, async (tx) => tx.item.findMany({
      where: { businessId: tenant.businessId, archivedAt: null,
        OR: [{ name: { contains: q, mode: "insensitive" } }, { barcode: { contains: q } }] },
      orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * 25, take: 26,
    }));
    return { rows: rows.slice(0, 25), page, hasMore: rows.length > 25 };
  });

  app.post("/v1/catalogue/items", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = itemInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid item", details: parsed.error.flatten() });
    const id = crypto.randomUUID();
    try {
      const row = await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "item.create", async (tx) => {
        await checkItemReferences(tx, tenant.businessId, parsed.data);
        const result = await tx.item.create({ data: { id, businessId: tenant.businessId, ...parsed.data } });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_ITEM_REFERENCE") return reply.code(400).send({ error: "Catalogue reference is missing or archived in this business" });
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "SKU or barcode already exists in this business" });
      throw error;
    }
  });

  app.patch("/v1/catalogue/items/:id", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const params = idParam.safeParse(request.params);
    const parsed = itemEdit.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid item edit" });
    const { expectedVersion, archive, ...data } = parsed.data;
    try {
      return await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "item.edit", async (tx) => {
        await checkItemReferences(tx, tenant.businessId, data);
        const changed = await tx.item.updateMany({
          where: { id: params.data.id, businessId: tenant.businessId, version: expectedVersion, archivedAt: null },
          data: { ...data, version: { increment: 1 }, ...(archive ? { archivedAt: new Date() } : {}) },
        });
        if (!changed.count) throw new Error("VERSION_CONFLICT");
        const result = await tx.item.findUniqueOrThrow({ where: { id: params.data.id } });
        return { result, change: { id: result.id, version: result.version, archived: archive } };
      });
    } catch (error) {
      if (error instanceof Error && error.message === "VERSION_CONFLICT") return reply.code(409).send({ error: "Item changed on another device; reload and review your edits" });
      if (error instanceof Error && error.message === "INVALID_ITEM_REFERENCE") return reply.code(400).send({ error: "Catalogue reference is missing or archived in this business" });
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "SKU or barcode already exists in this business" });
      throw error;
    }
  });

  // Account setup never accepts an opening balance: money is introduced only by a posting.
  const accountInput = z.object({
    code: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["Cash", "Bank", "Expense"]),
    expenseCategoryId: z.uuid().nullable().default(null),
  }).strict().refine((value) => (value.kind === "Expense") === (value.expenseCategoryId !== null),
    "Expense accounts require an expense category; other accounts cannot use one")
    .refine((value) => !value.code.startsWith("OPEN_"), "System account codes are reserved");
  const expenseCategoryInput = z.object({ name: z.string().trim().min(1).max(120) });

  function accountContext(request: FastifyRequest, reply: FastifyReply, write: boolean) {
    if (!requireAuth(request, reply)) return null;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return null;
    if (!["Owner", "Accountant"].includes(tenant.membership.role)) {
      void reply.code(403).send({ error: "Account access requires owner or accountant" });
      return null;
    }
    if (write && !verifyCsrf(request, reply)) return null;
    return { businessId: tenant.businessId, userId: request.user.id };
  }

  app.get("/v1/accounts/setup", async (request, reply) => {
    const tenant = accountContext(request, reply, false);
    if (!tenant) return;
    return withTenantContext(requireDb(), tenant, async (tx) => ({
      accounts: await tx.account.findMany({ where: { businessId: tenant.businessId, archivedAt: null }, orderBy: { code: "asc" } }),
      expenseCategories: await tx.expenseCategory.findMany({ where: { businessId: tenant.businessId, archivedAt: null }, orderBy: { name: "asc" } }),
    }));
  });

  app.post("/v1/accounts/expense-categories", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const parsed = expenseCategoryInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid expense category" });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "expense_category.create", async (tx) => {
        const result = await tx.expenseCategory.create({ data: { id, businessId: tenant.businessId, name: parsed.data.name } });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Expense category name already exists" });
      throw error;
    }
  });

  app.post("/v1/accounts", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const parsed = accountInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid account", details: parsed.error.flatten() });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "account.create", async (tx) => {
        if (parsed.data.expenseCategoryId && !await tx.expenseCategory.findFirst({ where: {
          id: parsed.data.expenseCategoryId, businessId: tenant.businessId, archivedAt: null,
        } })) throw new Error("INVALID_EXPENSE_CATEGORY");
        const { kind, ...data } = parsed.data;
        const result = await tx.account.create({ data: { id, businessId: tenant.businessId,
          ...data, kind, classification: kind === "Expense" ? "Expense" : "Asset" } });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_EXPENSE_CATEGORY") return reply.code(400).send({ error: "Expense category missing from this business" });
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "Account code already exists" });
      throw error;
    }
  });

  app.patch("/v1/accounts/:id", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const params = idParam.safeParse(request.params);
    const parsed = z.object({ name: z.string().trim().min(1).max(120), expectedVersion: z.number().int().positive(), archive: z.boolean().default(false) }).safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid account edit" });
    try {
      return await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "account.edit", async (tx) => {
        const changed = await tx.account.updateMany({ where: { id: params.data.id, businessId: tenant.businessId,
          kind: { in: ["Cash", "Bank", "Expense"] }, version: parsed.data.expectedVersion, archivedAt: null },
          data: { name: parsed.data.name, version: { increment: 1 },
            ...(parsed.data.archive ? { archivedAt: new Date() } : {}) } });
        if (!changed.count) throw new Error("VERSION_CONFLICT");
        const result = await tx.account.findUniqueOrThrow({ where: { id: params.data.id } });
        return { result, change: { id: result.id, version: result.version, archived: parsed.data.archive } };
      });
    } catch (error) {
      if (error instanceof Error && error.message === "VERSION_CONFLICT") return reply.code(409).send({ error: "Account changed on another device; reload and review your edits" });
      throw error;
    }
  });

  app.post("/v1/accounts/system", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const existing = await withTenantContext(requireDb(), tenant, async (tx) => tx.account.findMany({
      where: { businessId: tenant.businessId, code: { in: systemAccounts.map((a) => a.code) } },
    }));
    if (existing.length === systemAccounts.length && systemAccounts.every((account) => existing.some((row) =>
      row.code === account.code && row.kind === account.kind && row.classification === account.classification && !row.archivedAt))) return { accounts: existing };
    try {
      return await withBusinessChange(requireDb(), tenant.businessId, tenant.userId, "account.system_init", async (tx) => {
        const rows = [];
        for (const account of systemAccounts) {
          const found = await tx.account.findFirst({ where: { businessId: tenant.businessId, code: account.code } });
          if (found && (found.kind !== account.kind || found.classification !== account.classification || found.archivedAt)) throw new OpeningConflict("A reserved system account code has conflicting configuration");
          rows.push(found ?? await tx.account.create({ data: { id: crypto.randomUUID(), businessId: tenant.businessId, ...account } }));
        }
        return { result: { accounts: rows }, change: { initialized: true } };
      });
    } catch (error) {
      if (error instanceof OpeningConflict) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  app.get("/v1/opening", async (request, reply) => {
    const tenant = accountContext(request, reply, false);
    if (!tenant) return;
    return withTenantContext(requireDb(), tenant, async (tx) => tx.openingBatch.findFirst({
      where: { businessId: tenant.businessId }, include: { documents: true },
    }));
  });

  app.post("/v1/opening/preview", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const parsed = openingInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid opening batch", details: parsed.error.flatten() });
    try {
      const prepared = await prepareOpening(requireDb(), tenant.businessId, tenant.userId, parsed.data);
      return { preview: prepared.preview, expectedCursor: prepared.expectedCursor };
    } catch (error) {
      if (error instanceof OpeningConflict) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  app.post("/v1/opening/commit", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const parsed = openingInput.extend({ expectedCursor: z.string().regex(/^\d+$/) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid opening batch", details: parsed.error.flatten() });
    const { expectedCursor, ...input } = parsed.data;
    try {
      const result = await commitOpening(requireDb(), tenant.businessId, tenant.userId, input, expectedCursor);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof OpeningConflict || error instanceof ChangedCommandError ||
          (typeof error === "object" && error && "code" in error && error.code === "P2002")) {
        return reply.code(409).send({ error: error instanceof Error ? error.message : "Opening batch already exists" });
      }
      throw error;
    }
  });

  return app;
}

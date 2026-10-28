import type { FastifyInstance } from "fastify";
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  selectBusinessSchema,
  type Role,
} from "@business/contracts";
import { withTenantContext } from "@business/db";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  createSession,
  getSessionByToken,
  selectBusinessForSession,
  revokeSession,
  revokeOtherSessions,
} from "../auth/session.js";
import {
  isRateLimited,
  recordFailedAttempt,
  resetRateLimit,
} from "../auth/rateLimit.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  verifyCsrf,
  setSessionCookies,
} from "./context.js";

export function registerAuthRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.post("/v1/auth/register", async (request, reply) => {
    const client = requireDb(deps.db);
    const parseRes = registerSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({
        error: "Validation failed",
        details: parseRes.error.flatten(),
      });
    }

    const { username, password, fullName, email, businessName, currency, timezone } =
      parseRes.data;

    const existing = await client.user.findUnique({ where: { username } });
    if (existing) {
      return reply.code(409).send({ error: "Username already taken" });
    }

    const passwordHash = await hashPassword(password);
    const businessId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();

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

    const ip = request.ip;
    const ua = request.headers["user-agent"];
    const sessionRes = await createSession(client, result.user.id, ua, ip);

    await client.session.update({
      where: { id: sessionRes.session.id },
      data: { selectedBusinessId: result.business.id },
    });

    setSessionCookies(reply, sessionRes.rawToken, sessionRes.csrfToken, deps.isProduction);

    return reply.code(201).send({
      user: {
        id: result.user.id,
        username: result.user.username,
        fullName: result.user.fullName,
        email: result.user.email,
      },
      business: {
        id: result.business.id,
        name: result.business.name,
        currency: result.business.currency,
        timezone: result.business.timezone,
        datasetEpoch: result.business.datasetEpoch,
        createdAt: result.business.createdAt,
        updatedAt: result.business.updatedAt,
      },
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
    const client = requireDb(deps.db);
    const parseRes = loginSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: "Validation failed" });
    }

    const { username, password } = parseRes.data;
    const clientIp = request.ip;
    const sourceKey = `source:${clientIp}`;
    const accountKey = `account:${username.toLowerCase().trim()}`;

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

    resetRateLimit(accountKey);

    const ua = request.headers["user-agent"];
    const sessionRes = await createSession(client, user.id, ua, clientIp);

    setSessionCookies(reply, sessionRes.rawToken, sessionRes.csrfToken, deps.isProduction);

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
    const client = requireDb(deps.db);
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
    const client = requireDb(deps.db);

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
    const client = requireDb(deps.db);

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
    const client = requireDb(deps.db);

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
    const client = requireDb(deps.db);
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
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withTenantContext } from "@business/db";
import {
  openCashSessionInputSchema,
  closeCashSessionInputSchema,
} from "@business/contracts";
import {
  openCashSession,
  getCurrentCashSession,
  closeCashSession,
  listCashSessions,
  CashSessionConflict,
} from "../cash-sessions.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";

function cashSessionContext(request: FastifyRequest, reply: FastifyReply, write = false) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (!["Owner", "Accountant", "Cashier"].includes(tenant.membership.role)) {
    void reply.code(403).send({ error: "Cash session management requires owner, accountant, or cashier" });
    return null;
  }
  if (write && !verifyCsrf(request, reply)) return null;
  return {
    businessId: tenant.businessId,
    userId: request.user.id,
    membershipId: tenant.membership.id,
    role: tenant.membership.role,
    locationId: tenant.membership.locationId,
  };
}

export function registerCashSessionRoutes(app: FastifyInstance, deps: RouteDeps) {
  // GET workspace locations, devices, and cash accounts for opening sessions
  app.get("/v1/cash-sessions/workspace", async (request, reply) => {
    const ctx = cashSessionContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    return withTenantContext(db, ctx, async (tx) => {
      const [locations, devices, cashAccounts] = await Promise.all([
        tx.location.findMany({
          where: { businessId: ctx.businessId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        tx.deviceEnrollment.findMany({
          where: { businessId: ctx.businessId, status: "Enrolled", revokedAt: null },
          select: { id: true, deviceName: true, locationId: true },
          orderBy: { deviceName: "asc" },
        }),
        tx.account.findMany({
          where: { businessId: ctx.businessId, archivedAt: null, kind: "Cash" },
          select: { id: true, name: true, code: true },
          orderBy: { name: "asc" },
        }),
      ]);

      return reply.send({ locations, devices, cashAccounts });
    });
  });

  // GET current active open session
  app.get("/v1/cash-sessions/current", async (request, reply) => {
    const ctx = cashSessionContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const query = request.query as { locationId?: string; cashAccountId?: string };
    const session = await getCurrentCashSession(db, ctx.businessId, ctx.userId, {
      locationId: query.locationId || ctx.locationId || undefined,
      cashAccountId: query.cashAccountId,
    });

    return reply.send({ session });
  });

  // GET list of cash sessions
  app.get("/v1/cash-sessions", async (request, reply) => {
    const ctx = cashSessionContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const query = request.query as { locationId?: string; status?: string; limit?: string };
    const sessions = await listCashSessions(db, ctx.businessId, ctx.userId, {
      locationId: query.locationId,
      status: query.status,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
    });

    return reply.send({ sessions });
  });

  // POST open cash session
  app.post("/v1/cash-sessions/open", async (request, reply) => {
    const ctx = cashSessionContext(request, reply, true);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const parsed = openCashSessionInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid open cash session data",
        issues: parsed.error.issues,
      });
    }

    try {
      const session = await openCashSession(db, ctx.businessId, ctx.userId, parsed.data);
      return reply.code(201).send({ session });
    } catch (err) {
      if (err instanceof CashSessionConflict) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  // POST close cash session
  app.post("/v1/cash-sessions/:id/close", async (request, reply) => {
    const ctx = cashSessionContext(request, reply, true);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const params = request.params as { id: string };
    if (!params.id) {
      return reply.code(400).send({ error: "Session ID required" });
    }

    const parsed = closeCashSessionInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid close cash session data",
        issues: parsed.error.issues,
      });
    }

    try {
      const session = await closeCashSession(
        db,
        ctx.businessId,
        ctx.userId,
        params.id,
        parsed.data,
      );
      return reply.send({ session });
    } catch (err) {
      if (err instanceof CashSessionConflict) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });
}

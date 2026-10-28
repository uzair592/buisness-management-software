import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  getProfitAndLossReport,
  getTrialBalanceReport,
  getBalanceSheetReport,
  getStockValuationReport,
  getPartyLedgerReport,
} from "../reports.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
} from "./context.js";

function reportContext(request: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (!["Owner", "Accountant", "Viewer"].includes(tenant.membership.role)) {
    void reply.code(403).send({ error: "Viewing reports requires owner, accountant, or viewer role" });
    return null;
  }
  return {
    businessId: tenant.businessId,
    userId: request.user.id,
    membershipId: tenant.membership.id,
    role: tenant.membership.role,
    locationId: tenant.membership.locationId,
  };
}

export function registerReportRoutes(app: FastifyInstance, deps: RouteDeps) {
  // GET Profit & Loss Statement
  app.get("/v1/reports/profit-and-loss", async (request, reply) => {
    const ctx = reportContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const query = request.query as { startDate?: string; endDate?: string; locationId?: string };
    const report = await getProfitAndLossReport(db, ctx.businessId, ctx.userId, {
      startDate: query.startDate,
      endDate: query.endDate,
      locationId: query.locationId,
    });

    return reply.send({ report });
  });

  // GET Trial Balance Statement
  app.get("/v1/reports/trial-balance", async (request, reply) => {
    const ctx = reportContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const query = request.query as { asOfDate?: string };
    const report = await getTrialBalanceReport(db, ctx.businessId, ctx.userId, {
      asOfDate: query.asOfDate,
    });

    return reply.send({ report });
  });

  // GET Balance Sheet Statement
  app.get("/v1/reports/balance-sheet", async (request, reply) => {
    const ctx = reportContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const query = request.query as { asOfDate?: string };
    const report = await getBalanceSheetReport(db, ctx.businessId, ctx.userId, {
      asOfDate: query.asOfDate,
    });

    return reply.send({ report });
  });

  // GET Stock Summary / Valuation Statement
  app.get("/v1/reports/stock-summary", async (request, reply) => {
    const ctx = reportContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const query = request.query as { locationId?: string };
    const report = await getStockValuationReport(db, ctx.businessId, ctx.userId, {
      locationId: query.locationId,
    });

    return reply.send({ report });
  });

  // GET Party Running Ledger Statement
  app.get("/v1/reports/party-ledger/:partyId", async (request, reply) => {
    const ctx = reportContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const params = request.params as { partyId: string };
    if (!params.partyId) {
      return reply.code(400).send({ error: "Party ID required" });
    }

    const report = await getPartyLedgerReport(db, ctx.businessId, ctx.userId, params.partyId);

    if (!report) {
      return reply.code(404).send({ error: "Party not found" });
    }

    return reply.send({ report });
  });
}

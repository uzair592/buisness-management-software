import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenantContext } from "@business/db";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";
import {
  stockAdjustmentInput,
  createStockAdjustment,
  postStockAdjustment,
  StockAdjustmentConflict,
} from "../stock-adjustments.js";

const idParam = z.object({ id: z.uuid() });
const postBody = z.object({ commandId: z.uuid() }).strict();

export async function stockRoutes(app: FastifyInstance, deps: RouteDeps) {
  function stockContext(request: FastifyRequest, reply: FastifyReply, write = false) {
    if (!requireAuth(request, reply)) return null;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return null;
    if (write && !verifyCsrf(request, reply)) return null;
    return {
      businessId: tenant.businessId,
      userId: request.user.id,
      membershipId: tenant.membership.id,
      role: tenant.membership.role,
    };
  }

  // List recent stock adjustments
  app.get("/v1/stock/adjustments", async (request, reply) => {
    const tenant = stockContext(request, reply);
    if (!tenant) return;
    return withTenantContext(requireDb(deps.db), tenant, async (tx) => {
      const adjustments = await tx.stockAdjustment.findMany({
        where: { businessId: tenant.businessId },
        include: {
          item: true,
          location: true,
        },
        orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
        take: 100,
      });
      return adjustments;
    });
  });

  // Create stock adjustment draft
  app.post("/v1/stock/adjustments/drafts", async (request, reply) => {
    const tenant = stockContext(request, reply, true);
    if (!tenant) return;
    const parsed = stockAdjustmentInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid stock adjustment" });
    }

    try {
      const created = await createStockAdjustment(
        requireDb(deps.db),
        tenant.businessId,
        tenant.userId,
        tenant.role,
        parsed.data,
      );
      return reply.code(201).send(created);
    } catch (error) {
      if (error instanceof StockAdjustmentConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  // Post stock adjustment
  app.post("/v1/stock/adjustments/:id/post", async (request, reply) => {
    const tenant = stockContext(request, reply, true);
    if (!tenant) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Valid adjustment UUID required" });
    const parsed = postBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Command ID is required" });

    try {
      const posted = await postStockAdjustment(
        requireDb(deps.db),
        tenant.businessId,
        tenant.userId,
        tenant.role,
        { id: params.data.id, commandId: parsed.data.commandId },
      );
      return reply.code(200).send(posted);
    } catch (error) {
      if (error instanceof StockAdjustmentConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  // List open provisional deficits
  app.get("/v1/stock/deficits", async (request, reply) => {
    const tenant = stockContext(request, reply);
    if (!tenant) return;
    return withTenantContext(requireDb(deps.db), tenant, async (tx) => {
      const deficits = await tx.provisionalDeficitCost.findMany({
        where: { businessId: tenant.businessId, status: "Open" },
        include: {
          sourceEvent: true,
        },
        orderBy: [{ sourceEvent: { businessDate: "asc" } }],
      });
      return deficits;
    });
  });
}

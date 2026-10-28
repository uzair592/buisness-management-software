import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ROLE_CAPABILITIES,
  type Role,
  stockTransferDispatchInputSchema,
  stockTransferReceiveInputSchema,
  stockTransferStatusSchema,
} from "@business/contracts";
import { withTenantContext } from "@business/db";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";
import {
  dispatchStockTransfer,
  receiveStockTransfer,
  StockTransferConflict,
} from "../stock-transfers.js";

function stockContext(request: FastifyRequest, reply: FastifyReply, write = false) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (!ROLE_CAPABILITIES[tenant.membership.role as Role]?.includes(write ? "trade:write" : "trade:read")) {
    void reply.code(403).send({ error: "Trade or Stock permission required" });
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

export function registerStockTransfersRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/v1/stock/transfers", async (request, reply) => {
    const ctx = stockContext(request, reply);
    if (!ctx) return;

    const querySchema = z.object({
      status: stockTransferStatusSchema.optional(),
      sourceLocationId: z.string().uuid().optional(),
      destinationLocationId: z.string().uuid().optional(),
    });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query parameters" });
    }

    return withTenantContext(requireDb(deps.db), ctx, async (tx) => {
      // If user is restricted to a location, they can see transfers where their location is source or destination
      const locationFilter = ctx.locationId && ctx.role !== "Owner"
        ? {
            OR: [
              { sourceLocationId: ctx.locationId },
              { destinationLocationId: ctx.locationId },
            ],
          }
        : {};

      const transfers = await tx.stockTransfer.findMany({
        where: {
          businessId: ctx.businessId,
          ...locationFilter,
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(parsed.data.sourceLocationId ? { sourceLocationId: parsed.data.sourceLocationId } : {}),
          ...(parsed.data.destinationLocationId ? { destinationLocationId: parsed.data.destinationLocationId } : {}),
        },
        include: {
          sourceLocation: { select: { id: true, name: true } },
          destinationLocation: { select: { id: true, name: true } },
          lines: {
            include: {
              item: { select: { id: true, name: true, sku: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      return transfers;
    });
  });

  app.get("/v1/stock/transfers/:id", async (request, reply) => {
    const ctx = stockContext(request, reply);
    if (!ctx) return;

    const paramsSchema = z.object({ id: z.string().uuid() });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Valid UUID transfer ID required" });
    }

    return withTenantContext(requireDb(deps.db), ctx, async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id: parsed.data.id, businessId: ctx.businessId },
        include: {
          sourceLocation: { select: { id: true, name: true } },
          destinationLocation: { select: { id: true, name: true } },
          lines: {
            include: {
              item: { select: { id: true, name: true, sku: true } },
            },
          },
        },
      });

      if (!transfer) {
        return reply.code(404).send({ error: "Stock transfer not found" });
      }

      // Check location scoping
      if (
        ctx.locationId &&
        ctx.role !== "Owner" &&
        transfer.sourceLocationId !== ctx.locationId &&
        transfer.destinationLocationId !== ctx.locationId
      ) {
        return reply.code(403).send({ error: "Access denied to transfer outside assigned location" });
      }

      return transfer;
    });
  });

  app.post("/v1/stock/transfers/dispatch", async (request, reply) => {
    const ctx = stockContext(request, reply, true);
    if (!ctx) return;

    const parsed = stockTransferDispatchInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid dispatch payload", details: parsed.error.flatten() });
    }

    try {
      const created = await dispatchStockTransfer(
        requireDb(deps.db),
        ctx.businessId,
        ctx.userId,
        ctx.role,
        ctx.locationId,
        parsed.data,
      );
      return reply.code(201).send(created);
    } catch (error) {
      if (error instanceof StockTransferConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/v1/stock/transfers/:id/receive", async (request, reply) => {
    const ctx = stockContext(request, reply, true);
    if (!ctx) return;

    const paramsSchema = z.object({ id: z.string().uuid() });
    const paramsParsed = paramsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: "Valid UUID transfer ID required" });
    }

    const bodyParsed = stockTransferReceiveInputSchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({ error: "Invalid receive payload", details: bodyParsed.error.flatten() });
    }

    try {
      const updated = await receiveStockTransfer(
        requireDb(deps.db),
        ctx.businessId,
        ctx.userId,
        ctx.role,
        ctx.locationId,
        paramsParsed.data.id,
        bodyParsed.data,
      );
      return reply.code(200).send(updated);
    } catch (error) {
      if (error instanceof StockTransferConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });
}

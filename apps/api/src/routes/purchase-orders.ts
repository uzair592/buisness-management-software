import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ROLE_CAPABILITIES,
  type Role,
  purchaseOrderInputSchema,
  purchaseOrderConvertInputSchema,
  purchaseOrderStatusSchema,
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
  createPurchaseOrder,
  updatePurchaseOrderStatus,
  convertPurchaseOrderToBill,
  PurchaseOrderConflict,
} from "../purchase-orders.js";
import { PurchaseConflict } from "../purchases.js";

function poContext(request: FastifyRequest, reply: FastifyReply, write = false) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (!ROLE_CAPABILITIES[tenant.membership.role as Role]?.includes(write ? "trade:write" : "trade:read")) {
    void reply.code(403).send({ error: "Trade permission required" });
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

export function registerPurchaseOrdersRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/v1/purchase-orders", async (request, reply) => {
    const ctx = poContext(request, reply);
    if (!ctx) return;

    const querySchema = z.object({
      status: purchaseOrderStatusSchema.optional(),
      partyId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
    });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query parameters" });
    }

    return withTenantContext(requireDb(deps.db), ctx, async (tx) => {
      const orders = await tx.purchaseOrder.findMany({
        where: {
          businessId: ctx.businessId,
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(parsed.data.partyId ? { partyId: parsed.data.partyId } : {}),
          ...(parsed.data.locationId ? { locationId: parsed.data.locationId } : {}),
        },
        include: {
          party: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          lines: {
            include: {
              item: { select: { id: true, name: true, sku: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      return orders;
    });
  });

  app.get("/v1/purchase-orders/:id", async (request, reply) => {
    const ctx = poContext(request, reply);
    if (!ctx) return;

    const paramsSchema = z.object({ id: z.string().uuid() });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Valid UUID purchase order ID required" });
    }

    return withTenantContext(requireDb(deps.db), ctx, async (tx) => {
      const order = await tx.purchaseOrder.findFirst({
        where: { id: parsed.data.id, businessId: ctx.businessId },
        include: {
          party: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          lines: {
            include: {
              item: { select: { id: true, name: true, sku: true } },
              taxProfile: { select: { id: true, name: true, rate: true } },
            },
          },
        },
      });

      if (!order) {
        return reply.code(404).send({ error: "Purchase order not found" });
      }
      return order;
    });
  });

  app.post("/v1/purchase-orders", async (request, reply) => {
    const ctx = poContext(request, reply, true);
    if (!ctx) return;

    const parsed = purchaseOrderInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid purchase order data", details: parsed.error.flatten() });
    }

    try {
      const created = await createPurchaseOrder(
        requireDb(deps.db),
        ctx.businessId,
        ctx.userId,
        ctx.role,
        parsed.data,
      );
      return reply.code(201).send(created);
    } catch (error) {
      if (error instanceof PurchaseOrderConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/v1/purchase-orders/:id/status", async (request, reply) => {
    const ctx = poContext(request, reply, true);
    if (!ctx) return;

    const paramsSchema = z.object({ id: z.string().uuid() });
    const paramsParsed = paramsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: "Valid UUID purchase order ID required" });
    }

    const bodySchema = z.object({ status: purchaseOrderStatusSchema });
    const bodyParsed = bodySchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({ error: "Valid purchase order status required" });
    }

    try {
      const updated = await updatePurchaseOrderStatus(
        requireDb(deps.db),
        ctx.businessId,
        ctx.userId,
        ctx.role,
        paramsParsed.data.id,
        bodyParsed.data.status,
      );
      return reply.code(200).send(updated);
    } catch (error) {
      if (error instanceof PurchaseOrderConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/v1/purchase-orders/:id/convert", async (request, reply) => {
    const ctx = poContext(request, reply, true);
    if (!ctx) return;

    const paramsSchema = z.object({ id: z.string().uuid() });
    const paramsParsed = paramsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: "Valid UUID purchase order ID required" });
    }

    const bodyParsed = purchaseOrderConvertInputSchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({ error: "Invalid convert payload", details: bodyParsed.error.flatten() });
    }

    try {
      const result = await convertPurchaseOrderToBill(
        requireDb(deps.db),
        ctx.businessId,
        ctx.userId,
        ctx.role,
        paramsParsed.data.id,
        bodyParsed.data,
      );
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof PurchaseOrderConflict || error instanceof PurchaseConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });
}

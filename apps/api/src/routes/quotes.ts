import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ROLE_CAPABILITIES, type Role, quotationInputSchema, quotationConvertInputSchema, quotationStatusSchema } from "@business/contracts";
import { withTenantContext } from "@business/db";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";
import {
  createQuotation,
  updateQuotationStatus,
  convertQuotationToSale,
  QuotationConflict,
} from "../quotes.js";
import { SaleConflict } from "../sales.js";

function quoteContext(request: FastifyRequest, reply: FastifyReply, write = false) {
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

export function registerQuotesRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/v1/quotes", async (request, reply) => {
    const ctx = quoteContext(request, reply);
    if (!ctx) return;

    const querySchema = z.object({
      status: quotationStatusSchema.optional(),
      partyId: z.string().uuid().optional(),
    });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query parameters" });
    }

    return withTenantContext(requireDb(deps.db), ctx, async (tx) => {
      const quotes = await tx.quotation.findMany({
        where: {
          businessId: ctx.businessId,
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(parsed.data.partyId ? { partyId: parsed.data.partyId } : {}),
        },
        include: {
          party: { select: { id: true, name: true } },
          lines: {
            include: {
              item: { select: { id: true, name: true, sku: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      return quotes;
    });
  });

  app.get("/v1/quotes/:id", async (request, reply) => {
    const ctx = quoteContext(request, reply);
    if (!ctx) return;

    const paramsSchema = z.object({ id: z.string().uuid() });
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Valid UUID quotation ID required" });
    }

    return withTenantContext(requireDb(deps.db), ctx, async (tx) => {
      const quote = await tx.quotation.findFirst({
        where: { id: parsed.data.id, businessId: ctx.businessId },
        include: {
          party: { select: { id: true, name: true } },
          lines: {
            include: {
              item: { select: { id: true, name: true, sku: true } },
              taxProfile: { select: { id: true, name: true, rate: true } },
            },
          },
        },
      });

      if (!quote) {
        return reply.code(404).send({ error: "Quotation not found" });
      }
      return quote;
    });
  });

  app.post("/v1/quotes", async (request, reply) => {
    const ctx = quoteContext(request, reply, true);
    if (!ctx) return;

    const parsed = quotationInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid quotation data", details: parsed.error.flatten() });
    }

    try {
      const created = await createQuotation(
        requireDb(deps.db),
        ctx.businessId,
        ctx.userId,
        ctx.role,
        parsed.data,
      );
      return reply.code(201).send(created);
    } catch (error) {
      if (error instanceof QuotationConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/v1/quotes/:id/status", async (request, reply) => {
    const ctx = quoteContext(request, reply, true);
    if (!ctx) return;

    const paramsSchema = z.object({ id: z.string().uuid() });
    const paramsParsed = paramsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: "Valid UUID quotation ID required" });
    }

    const bodySchema = z.object({ status: quotationStatusSchema });
    const bodyParsed = bodySchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({ error: "Valid quotation status required" });
    }

    try {
      const updated = await updateQuotationStatus(
        requireDb(deps.db),
        ctx.businessId,
        ctx.userId,
        ctx.role,
        paramsParsed.data.id,
        bodyParsed.data.status,
      );
      return reply.code(200).send(updated);
    } catch (error) {
      if (error instanceof QuotationConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/v1/quotes/:id/convert", async (request, reply) => {
    const ctx = quoteContext(request, reply, true);
    if (!ctx) return;

    const paramsSchema = z.object({ id: z.string().uuid() });
    const paramsParsed = paramsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: "Valid UUID quotation ID required" });
    }

    const bodyParsed = quotationConvertInputSchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({ error: "Invalid convert payload", details: bodyParsed.error.flatten() });
    }

    try {
      const result = await convertQuotationToSale(
        requireDb(deps.db),
        ctx.businessId,
        ctx.userId,
        ctx.membershipId,
        ctx.role,
        paramsParsed.data.id,
        bodyParsed.data,
      );
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof QuotationConflict || error instanceof SaleConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });
}

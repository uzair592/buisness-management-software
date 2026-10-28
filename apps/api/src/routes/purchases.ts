import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenantContext } from "@business/db";
import { purchaseInput, createPurchaseDraft, postPurchase, PurchaseConflict } from "../purchases.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";

function purchaseContext(request: FastifyRequest, reply: FastifyReply, write = false) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (!["Owner", "Accountant"].includes(tenant.membership.role)) {
    void reply.code(403).send({ error: "Purchase access requires owner or accountant" });
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

export function registerPurchaseRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/v1/purchases/workspace", async (request, reply) => {
    const ctx = purchaseContext(request, reply);
    if (!ctx) return;
    return withTenantContext(requireDb(deps.db), ctx, async (tx) => ({
      locations: await tx.location.findMany({
        where: { businessId: ctx.businessId, ...(ctx.locationId && ctx.role !== "Owner" ? { id: ctx.locationId } : {}) },
        select: { id: true, code: true, name: true },
      }),
      accounts: await tx.account.findMany({
        where: { businessId: ctx.businessId, archivedAt: null, kind: { in: ["Cash", "Bank"] } },
        select: { id: true, name: true, kind: true },
      }),
      parties: await tx.party.findMany({
        where: { businessId: ctx.businessId, archivedAt: null, isSupplier: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      items: await tx.item.findMany({
        where: { businessId: ctx.businessId, archivedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, kind: true, sku: true, barcode: true, salePrice: true, baseUnitId: true, taxProfileId: true },
      }),
      conversions: await tx.itemUnitConversion.findMany({
        where: { businessId: ctx.businessId, archivedAt: null },
        select: { id: true, itemId: true, unitId: true, factor: true },
      }),
      units: await tx.unit.findMany({
        where: { businessId: ctx.businessId, archivedAt: null },
        select: { id: true, name: true },
      }),
      taxProfiles: await tx.taxProfile.findMany({
        where: { businessId: ctx.businessId, archivedAt: null },
        select: { id: true, rate: true, mode: true },
      }),
    }));
  });

  app.post("/v1/purchases/drafts", async (request, reply) => {
    const ctx = purchaseContext(request, reply, true);
    if (!ctx) return;
    const parsed = purchaseInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid purchase draft", details: parsed.error.flatten() });
    try {
      return reply.code(201).send(await createPurchaseDraft(requireDb(deps.db), ctx.businessId, ctx.userId, ctx.role, parsed.data));
    } catch (error) {
      if (error instanceof PurchaseConflict) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  app.post("/v1/purchases/:id/post", async (request, reply) => {
    const ctx = purchaseContext(request, reply, true);
    if (!ctx) return;
    const id = z.object({ id: z.uuid() }).safeParse(request.params);
    const command = z.object({
      commandId: z.uuid(),
      allowDuplicateSupplierReference: z.boolean().default(false),
    }).strict().safeParse(request.body);
    if (!id.success || !command.success) return reply.code(400).send({ error: "Invalid purchase command" });
    try {
      return await postPurchase(requireDb(deps.db), ctx.businessId, ctx.userId, ctx.role, {
        id: id.data.id,
        ...command.data,
      });
    } catch (error) {
      if (error instanceof PurchaseConflict) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  app.get("/v1/purchases/documents", async (request, reply) => {
    const ctx = purchaseContext(request, reply);
    if (!ctx) return;
    const parsed = z.object({
      q: z.string().trim().max(100).default(""),
      page: z.coerce.number().int().min(1).max(10000).default(1),
      status: z.enum(["Draft", "Posted"]).optional(),
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid purchase filter" });
    return withTenantContext(requireDb(deps.db), ctx, async (tx) => {
      const rows = await tx.purchaseDocument.findMany({
        where: {
          businessId: ctx.businessId,
          ...(ctx.locationId && ctx.role !== "Owner" ? { locationId: ctx.locationId } : {}),
          status: parsed.data.status,
          ...(parsed.data.q ? {
            OR: [
              { number: { contains: parsed.data.q, mode: "insensitive" } },
              { supplierInvoiceNumber: { contains: parsed.data.q, mode: "insensitive" } },
              { party: { name: { contains: parsed.data.q, mode: "insensitive" } } },
            ],
          } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (parsed.data.page - 1) * 25,
        take: 26,
        select: {
          id: true,
          number: true,
          supplierInvoiceNumber: true,
          status: true,
          total: true,
          paid: true,
          due: true,
          businessDate: true,
          createdAt: true,
          party: { select: { name: true } },
        },
      });
      return { rows: rows.slice(0, 25), hasMore: rows.length > 25, page: parsed.data.page };
    });
  });

  app.get("/v1/purchases/documents/:id", async (request, reply) => {
    const ctx = purchaseContext(request, reply);
    if (!ctx) return;
    const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid purchase document ID" });
    const purchase = await withTenantContext(requireDb(deps.db), ctx, (tx) => tx.purchaseDocument.findFirst({
      where: {
        id: parsed.data.id,
        businessId: ctx.businessId,
        ...(ctx.locationId && ctx.role !== "Owner" ? { locationId: ctx.locationId } : {}),
      },
      include: { lines: true, payments: true, party: { select: { name: true } } },
    }));
    if (!purchase) return reply.code(404).send({ error: "Purchase not found" });
    return purchase;
  });
}

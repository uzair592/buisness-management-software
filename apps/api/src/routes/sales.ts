import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ROLE_CAPABILITIES, type Role } from "@business/contracts";
import { withTenantContext } from "@business/db";
import { saleInput, createSaleDraft, postSale, SaleConflict } from "../sales.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";

function saleContext(request: FastifyRequest, reply: FastifyReply, write = false) {
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

export function registerSalesRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/v1/sales/workspace", async (request, reply) => {
    const ctx = saleContext(request, reply);
    if (!ctx) return;
    return withTenantContext(requireDb(deps.db), ctx, async (tx) => ({
      devices: await tx.deviceEnrollment.findMany({
        where: {
          businessId: ctx.businessId,
          membershipId: ctx.membershipId,
          status: "Enrolled",
          ...(ctx.locationId && ctx.role !== "Owner" ? { locationId: ctx.locationId } : {}),
        },
        select: { id: true, locationId: true, numberPrefix: true, deviceName: true },
      }),
      accounts: await tx.account.findMany({
        where: { businessId: ctx.businessId, archivedAt: null, kind: { in: ["Cash", "Bank"] } },
        select: { id: true, name: true, kind: true },
      }),
      parties: await tx.party.findMany({
        where: { businessId: ctx.businessId, archivedAt: null, isCustomer: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      items: await tx.item.findMany({
        where: { businessId: ctx.businessId, archivedAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          kind: true,
          barcode: true,
          salePrice: true,
          baseUnitId: true,
          taxProfileId: true,
        },
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

  app.post("/v1/sales/drafts", async (request, reply) => {
    const ctx = saleContext(request, reply, true);
    if (!ctx) return;
    const parsed = saleInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid sale draft", details: parsed.error.flatten() });
    }
    try {
      return reply.code(201).send(
        await createSaleDraft(requireDb(deps.db), ctx.businessId, ctx.userId, ctx.membershipId, ctx.role, parsed.data),
      );
    } catch (error) {
      if (error instanceof SaleConflict) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  app.post("/v1/sales/:id/post", async (request, reply) => {
    const ctx = saleContext(request, reply, true);
    if (!ctx) return;
    const id = z.object({ id: z.uuid() }).safeParse(request.params);
    const command = z.object({ commandId: z.uuid() }).strict().safeParse(request.body);
    if (!id.success || !command.success) return reply.code(400).send({ error: "Invalid sale command" });
    try {
      return await postSale(requireDb(deps.db), ctx.businessId, ctx.userId, { id: id.data.id, ...command.data });
    } catch (error) {
      if (error instanceof SaleConflict) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  app.get("/v1/sales/documents", async (request, reply) => {
    const ctx = saleContext(request, reply);
    if (!ctx) return;
    const parsed = z.object({
      q: z.string().trim().max(100).default(""),
      page: z.coerce.number().int().min(1).max(10000).default(1),
      status: z.enum(["Draft", "Posted"]).optional(),
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid sale filter" });
    return withTenantContext(requireDb(deps.db), ctx, async (tx) => {
      const rows = await tx.saleDocument.findMany({
        where: {
          businessId: ctx.businessId,
          ...(ctx.locationId && ctx.role !== "Owner" ? { locationId: ctx.locationId } : {}),
          status: parsed.data.status,
          ...(parsed.data.q
            ? {
                OR: [
                  { number: { contains: parsed.data.q, mode: "insensitive" } },
                  { party: { name: { contains: parsed.data.q, mode: "insensitive" } } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (parsed.data.page - 1) * 25,
        take: 26,
        select: {
          id: true,
          number: true,
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

  app.get("/v1/sales/documents/:id", async (request, reply) => {
    const ctx = saleContext(request, reply);
    if (!ctx) return;
    const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid document ID" });
    const sale = await withTenantContext(requireDb(deps.db), ctx, (tx) =>
      tx.saleDocument.findFirst({
        where: {
          id: parsed.data.id,
          businessId: ctx.businessId,
          ...(ctx.locationId && ctx.role !== "Owner" ? { locationId: ctx.locationId } : {}),
        },
        include: { lines: { include: { item: true } }, payments: true },
      }),
    );
    if (!sale) return reply.code(404).send({ error: "Sale not found" });
    return sale;
  });
}

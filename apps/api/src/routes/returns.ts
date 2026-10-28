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
  saleReturnInput,
  purchaseReturnInput,
  createSaleReturnDraft,
  postSaleReturn,
  createPurchaseReturnDraft,
  postPurchaseReturn,
  ReturnConflict,
} from "../returns.js";

const idParam = z.object({ id: z.uuid() });
const postBody = z.object({ commandId: z.uuid() }).strict();

export async function returnsRoutes(app: FastifyInstance, deps: RouteDeps) {
  function returnContext(request: FastifyRequest, reply: FastifyReply, write = false) {
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

  // List recent credit & debit notes
  app.get("/v1/returns", async (request, reply) => {
    const tenant = returnContext(request, reply);
    if (!tenant) return;
    return withTenantContext(requireDb(deps.db), tenant, async (tx) => {
      const notes = await tx.creditNote.findMany({
        where: { businessId: tenant.businessId },
        include: {
          lines: { include: { item: true } },
          refunds: { include: { account: true } },
          party: true,
          location: true,
        },
        orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
        take: 50,
      });
      return notes;
    });
  });

  // Get single credit note
  app.get("/v1/returns/sales/:id", async (request, reply) => {
    const tenant = returnContext(request, reply);
    if (!tenant) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Valid return UUID required" });

    return withTenantContext(requireDb(deps.db), tenant, async (tx) => {
      const note = await tx.creditNote.findFirst({
        where: { id: params.data.id, businessId: tenant.businessId, kind: "SaleReturn" },
        include: {
          lines: { include: { item: true } },
          refunds: { include: { account: true } },
          party: true,
          location: true,
        },
      });
      if (!note) return reply.code(404).send({ error: "Credit note not found" });
      return note;
    });
  });

  // Create customer return draft
  app.post("/v1/returns/sales/drafts", async (request, reply) => {
    const tenant = returnContext(request, reply, true);
    if (!tenant) return;
    const parsed = saleReturnInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid return draft" });
    }

    try {
      const created = await createSaleReturnDraft(
        requireDb(deps.db),
        tenant.businessId,
        tenant.userId,
        tenant.role,
        parsed.data,
      );
      return reply.code(201).send(created);
    } catch (error) {
      if (error instanceof ReturnConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  // Post customer return (Credit Note)
  app.post("/v1/returns/sales/:id/post", async (request, reply) => {
    const tenant = returnContext(request, reply, true);
    if (!tenant) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Valid return UUID required" });
    const parsed = postBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Command ID is required" });

    try {
      const posted = await postSaleReturn(
        requireDb(deps.db),
        tenant.businessId,
        tenant.userId,
        tenant.role,
        { id: params.data.id, commandId: parsed.data.commandId },
      );
      return reply.code(200).send(posted);
    } catch (error) {
      if (error instanceof ReturnConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  // Get single purchase return (Debit Note)
  app.get("/v1/returns/purchases/:id", async (request, reply) => {
    const tenant = returnContext(request, reply);
    if (!tenant) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Valid debit note UUID required" });

    return withTenantContext(requireDb(deps.db), tenant, async (tx) => {
      const note = await tx.creditNote.findFirst({
        where: { id: params.data.id, businessId: tenant.businessId, kind: "PurchaseReturn" },
        include: {
          lines: { include: { item: true } },
          party: true,
          location: true,
        },
      });
      if (!note) return reply.code(404).send({ error: "Debit note not found" });
      return note;
    });
  });

  // Create supplier return draft (Debit Note)
  app.post("/v1/returns/purchases/drafts", async (request, reply) => {
    const tenant = returnContext(request, reply, true);
    if (!tenant) return;
    const parsed = purchaseReturnInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid debit note draft" });
    }

    try {
      const created = await createPurchaseReturnDraft(
        requireDb(deps.db),
        tenant.businessId,
        tenant.userId,
        tenant.role,
        parsed.data,
      );
      return reply.code(201).send(created);
    } catch (error) {
      if (error instanceof ReturnConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  // Post supplier return (Debit Note)
  app.post("/v1/returns/purchases/:id/post", async (request, reply) => {
    const tenant = returnContext(request, reply, true);
    if (!tenant) return;
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Valid debit note UUID required" });
    const parsed = postBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Command ID is required" });

    try {
      const posted = await postPurchaseReturn(
        requireDb(deps.db),
        tenant.businessId,
        tenant.userId,
        tenant.role,
        { id: params.data.id, commandId: parsed.data.commandId },
      );
      return reply.code(200).send(posted);
    } catch (error) {
      if (error instanceof ReturnConflict) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });
}

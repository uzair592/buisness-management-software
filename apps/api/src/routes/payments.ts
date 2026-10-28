import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { withTenantContext } from "@business/db";
import {
  paymentInput,
  createPaymentDraft,
  postPayment,
  getPartyOpenDocuments,
  PaymentConflict,
} from "../payments.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";

function paymentContext(request: FastifyRequest, reply: FastifyReply, write = false) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (!["Owner", "Accountant", "Cashier"].includes(tenant.membership.role)) {
    void reply.code(403).send({ error: "Payment access requires owner, accountant, or cashier" });
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

export function registerPaymentRoutes(app: FastifyInstance, deps: RouteDeps) {
  // GET workspace accounts and parties
  app.get("/v1/payments/workspace", async (request, reply) => {
    const ctx = paymentContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    return withTenantContext(db, ctx, async (tx) => {
      const [accounts, parties] = await Promise.all([
        tx.account.findMany({
          where: { businessId: ctx.businessId, archivedAt: null, kind: { in: ["Cash", "Bank"] } },
          select: { id: true, name: true, kind: true },
          orderBy: { name: "asc" },
        }),
        tx.party.findMany({
          where: { businessId: ctx.businessId, archivedAt: null },
          select: { id: true, name: true, isCustomer: true, isSupplier: true },
          orderBy: { name: "asc" },
        }),
      ]);

      return { accounts, parties };
    });
  });

  // GET open invoices or bills for a specific party
  app.get<{
    Params: { partyId: string };
    Querystring: { paymentKind?: "PaymentIn" | "PaymentOut" };
  }>("/v1/payments/open-documents/:partyId", async (request, reply) => {
    const ctx = paymentContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const partyId = request.params.partyId;
    const paymentKind = request.query.paymentKind ?? "PaymentIn";

    try {
      const documents = await getPartyOpenDocuments(db, ctx.businessId, ctx.userId, partyId, paymentKind);
      return { documents };
    } catch (err: unknown) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // GET list of payments
  app.get<{
    Querystring: { paymentKind?: "PaymentIn" | "PaymentOut"; partyId?: string };
  }>("/v1/payments", async (request, reply) => {
    const ctx = paymentContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    return withTenantContext(db, ctx, async (tx) => {
      const payments = await tx.payment.findMany({
        where: {
          businessId: ctx.businessId,
          ...(request.query.paymentKind ? { paymentKind: request.query.paymentKind } : {}),
          ...(request.query.partyId ? { partyId: request.query.partyId } : {}),
        },
        include: {
          party: { select: { id: true, name: true } },
          account: { select: { id: true, name: true, kind: true } },
          allocations: {
            include: {
              saleDocument: { select: { id: true, number: true, total: true } },
              purchaseDocument: { select: { id: true, number: true, total: true } },
            },
          },
        },
        orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      });

      return {
        payments: payments.map((p) => ({
          id: p.id,
          commandId: p.commandId,
          number: p.number,
          paymentKind: p.paymentKind,
          partyId: p.partyId,
          partyName: p.party.name,
          accountId: p.accountId,
          accountName: p.account.name,
          accountKind: p.account.kind,
          amount: Number(p.amount).toFixed(2),
          allocatedAmount: Number(p.allocatedAmount).toFixed(2),
          unallocatedAmount: Number(p.unallocatedAmount).toFixed(2),
          reference: p.reference,
          note: p.note,
          status: p.status,
          businessDate: p.businessDate.toISOString().slice(0, 10),
          createdAt: p.createdAt.toISOString(),
          postedAt: p.postedAt?.toISOString() ?? null,
          allocations: p.allocations.map((a) => ({
            id: a.id,
            saleDocumentId: a.saleDocumentId,
            purchaseDocumentId: a.purchaseDocumentId,
            documentNumber: a.saleDocument?.number ?? a.purchaseDocument?.number ?? null,
            allocatedAmount: Number(a.allocatedAmount).toFixed(2),
          })),
        })),
      };
    });
  });

  // GET single payment by id
  app.get<{ Params: { id: string } }>("/v1/payments/:id", async (request, reply) => {
    const ctx = paymentContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    return withTenantContext(db, ctx, async (tx) => {
      const p = await tx.payment.findFirst({
        where: { businessId: ctx.businessId, id: request.params.id },
        include: {
          party: { select: { id: true, name: true } },
          account: { select: { id: true, name: true, kind: true } },
          allocations: {
            include: {
              saleDocument: { select: { id: true, number: true, total: true } },
              purchaseDocument: { select: { id: true, number: true, total: true } },
            },
          },
        },
      });

      if (!p) {
        return reply.code(404).send({ error: "Payment not found" });
      }

      return {
        payment: {
          id: p.id,
          commandId: p.commandId,
          number: p.number,
          paymentKind: p.paymentKind,
          partyId: p.partyId,
          partyName: p.party.name,
          accountId: p.accountId,
          accountName: p.account.name,
          accountKind: p.account.kind,
          amount: Number(p.amount).toFixed(2),
          allocatedAmount: Number(p.allocatedAmount).toFixed(2),
          unallocatedAmount: Number(p.unallocatedAmount).toFixed(2),
          reference: p.reference,
          note: p.note,
          status: p.status,
          businessDate: p.businessDate.toISOString().slice(0, 10),
          createdAt: p.createdAt.toISOString(),
          postedAt: p.postedAt?.toISOString() ?? null,
          allocations: p.allocations.map((a) => ({
            id: a.id,
            saleDocumentId: a.saleDocumentId,
            purchaseDocumentId: a.purchaseDocumentId,
            documentNumber: a.saleDocument?.number ?? a.purchaseDocument?.number ?? null,
            allocatedAmount: Number(a.allocatedAmount).toFixed(2),
          })),
        },
      };
    });
  });

  // POST draft payment
  app.post("/v1/payments/drafts", async (request, reply) => {
    const ctx = paymentContext(request, reply, true);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const parsed = paymentInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid payment draft payload", details: parsed.error.issues });
    }

    if (parsed.data.paymentKind === "PaymentOut" && ctx.role === "Cashier") {
      return reply.code(403).send({ error: "Cashiers cannot create payment out drafts" });
    }

    try {
      const draft = await createPaymentDraft(db, ctx.businessId, ctx.userId, parsed.data);
      return reply.code(200).send({
        ...draft,
        amount: Number(draft.amount).toFixed(2),
        allocatedAmount: Number(draft.allocatedAmount).toFixed(2),
        unallocatedAmount: Number(draft.unallocatedAmount).toFixed(2),
      });
    } catch (err: unknown) {
      if (err instanceof PaymentConflict) {
        return reply.code(409).send({ error: err.message });
      }
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // POST post payment
  app.post("/v1/payments/post", async (request, reply) => {
    const ctx = paymentContext(request, reply, true);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const parsed = paymentInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid payment payload", details: parsed.error.issues });
    }

    if (parsed.data.paymentKind === "PaymentOut" && ctx.role === "Cashier") {
      return reply.code(403).send({ error: "Cashiers cannot record payment out" });
    }

    try {
      const posted = await postPayment(db, ctx.businessId, ctx.userId, parsed.data);
      return reply.code(200).send({
        ...posted,
        amount: Number(posted.amount).toFixed(2),
        allocatedAmount: Number(posted.allocatedAmount).toFixed(2),
        unallocatedAmount: Number(posted.unallocatedAmount).toFixed(2),
      });
    } catch (err: unknown) {
      if (err instanceof PaymentConflict) {
        return reply.code(409).send({ error: err.message });
      }
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
}

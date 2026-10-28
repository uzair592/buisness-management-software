import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { withTenantContext } from "@business/db";
import {
  expenseInput,
  createExpenseDraft,
  postExpense,
  ExpenseConflict,
} from "../expenses.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";

function expenseContext(request: FastifyRequest, reply: FastifyReply, write = false) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (!["Owner", "Accountant"].includes(tenant.membership.role)) {
    void reply.code(403).send({ error: "Expense management requires owner or accountant" });
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

export function registerExpenseRoutes(app: FastifyInstance, deps: RouteDeps) {
  // GET workspace categories and accounts
  app.get("/v1/expenses/workspace", async (request, reply) => {
    const ctx = expenseContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    return withTenantContext(db, ctx, async (tx) => {
      const [categories, expenseAccounts, paidFromAccounts] = await Promise.all([
        tx.expenseCategory.findMany({
          where: { businessId: ctx.businessId, archivedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        tx.account.findMany({
          where: {
            businessId: ctx.businessId,
            archivedAt: null,
            classification: "Expense",
          },
          select: { id: true, name: true, code: true, expenseCategoryId: true },
          orderBy: { name: "asc" },
        }),
        tx.account.findMany({
          where: {
            businessId: ctx.businessId,
            archivedAt: null,
            kind: { in: ["Cash", "Bank"] },
          },
          select: { id: true, name: true, kind: true },
          orderBy: { name: "asc" },
        }),
      ]);

      return { categories, expenseAccounts, paidFromAccounts };
    });
  });

  // GET list of expenses
  app.get<{
    Querystring: { expenseCategoryId?: string };
  }>("/v1/expenses", async (request, reply) => {
    const ctx = expenseContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    return withTenantContext(db, ctx, async (tx) => {
      const expenses = await tx.expense.findMany({
        where: {
          businessId: ctx.businessId,
          ...(request.query.expenseCategoryId ? { expenseCategoryId: request.query.expenseCategoryId } : {}),
        },
        include: {
          expenseCategory: { select: { id: true, name: true } },
          expenseAccount: { select: { id: true, name: true } },
          paidFromAccount: { select: { id: true, name: true, kind: true } },
        },
        orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      });

      return {
        expenses: expenses.map((e) => ({
          id: e.id,
          commandId: e.commandId,
          number: e.number,
          expenseCategoryId: e.expenseCategoryId,
          categoryName: e.expenseCategory.name,
          expenseAccountId: e.expenseAccountId,
          expenseAccountName: e.expenseAccount.name,
          paidFromAccountId: e.paidFromAccountId,
          paidFromAccountName: e.paidFromAccount.name,
          paidFromAccountKind: e.paidFromAccount.kind,
          amount: Number(e.amount).toFixed(2),
          taxAmount: Number(e.taxAmount).toFixed(2),
          reference: e.reference,
          note: e.note,
          status: e.status,
          businessDate: e.businessDate.toISOString().slice(0, 10),
          createdAt: e.createdAt.toISOString(),
          postedAt: e.postedAt?.toISOString() ?? null,
        })),
      };
    });
  });

  // GET single expense by id
  app.get<{ Params: { id: string } }>("/v1/expenses/:id", async (request, reply) => {
    const ctx = expenseContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    return withTenantContext(db, ctx, async (tx) => {
      const e = await tx.expense.findFirst({
        where: { businessId: ctx.businessId, id: request.params.id },
        include: {
          expenseCategory: { select: { id: true, name: true } },
          expenseAccount: { select: { id: true, name: true } },
          paidFromAccount: { select: { id: true, name: true, kind: true } },
        },
      });

      if (!e) {
        return reply.code(404).send({ error: "Expense not found" });
      }

      return {
        expense: {
          id: e.id,
          commandId: e.commandId,
          number: e.number,
          expenseCategoryId: e.expenseCategoryId,
          categoryName: e.expenseCategory.name,
          expenseAccountId: e.expenseAccountId,
          expenseAccountName: e.expenseAccount.name,
          paidFromAccountId: e.paidFromAccountId,
          paidFromAccountName: e.paidFromAccount.name,
          paidFromAccountKind: e.paidFromAccount.kind,
          amount: Number(e.amount).toFixed(2),
          taxAmount: Number(e.taxAmount).toFixed(2),
          reference: e.reference,
          note: e.note,
          status: e.status,
          businessDate: e.businessDate.toISOString().slice(0, 10),
          createdAt: e.createdAt.toISOString(),
          postedAt: e.postedAt?.toISOString() ?? null,
        },
      };
    });
  });

  // POST create new expense category
  app.post("/v1/expenses/categories", async (request, reply) => {
    const ctx = expenseContext(request, reply, true);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const schema = z.object({
      name: z.string().trim().min(1).max(120),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid category name", details: parsed.error.issues });
    }

    try {
      const category = await withTenantContext(db, ctx, async (tx) => {
        const id = crypto.randomUUID();
        const cat = await tx.expenseCategory.create({
          data: {
            id,
            businessId: ctx.businessId,
            name: parsed.data.name,
          },
          select: { id: true, name: true },
        });

        // Automatically create a matching expense account head under this category
        const cleanName = parsed.data.name.replace(/[^A-Za-z0-9]/g, "_").toUpperCase().slice(0, 20);
        const code = `EXP_${cleanName}_${id.slice(0, 4)}`;
        await tx.account.create({
          data: {
            id: crypto.randomUUID(),
            businessId: ctx.businessId,
            code,
            name: parsed.data.name,
            kind: "Expense",
            classification: "Expense",
            expenseCategoryId: id,
          },
        });

        return cat;
      });
      return reply.code(201).send(category);
    } catch (err: unknown) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  // POST draft expense
  app.post("/v1/expenses/drafts", async (request, reply) => {
    const ctx = expenseContext(request, reply, true);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const parsed = expenseInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid expense draft payload", details: parsed.error.issues });
    }

    try {
      const draft = await createExpenseDraft(db, ctx.businessId, ctx.userId, parsed.data);
      return reply.code(200).send({
        ...draft,
        amount: Number(draft.amount).toFixed(2),
        taxAmount: Number(draft.taxAmount).toFixed(2),
      });
    } catch (err: unknown) {
      if (err instanceof ExpenseConflict) {
        return reply.code(409).send({ error: err.message });
      }
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // POST post expense
  app.post("/v1/expenses/post", async (request, reply) => {
    const ctx = expenseContext(request, reply, true);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const parsed = expenseInput.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid expense payload", details: parsed.error.issues });
    }

    try {
      const posted = await postExpense(db, ctx.businessId, ctx.userId, parsed.data);
      return reply.code(200).send({
        ...posted,
        amount: Number(posted.amount).toFixed(2),
        taxAmount: Number(posted.taxAmount).toFixed(2),
      });
    } catch (err: unknown) {
      if (err instanceof ExpenseConflict) {
        return reply.code(409).send({ error: err.message });
      }
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
}

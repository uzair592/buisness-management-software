import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma, ChangedCommandError, withBusinessChange, withTenantContext } from "@business/db";
import { transferInput, postTransfer, TransferConflict } from "../transfers.js";
import { systemAccounts, OpeningConflict } from "../opening.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";

const idParam = z.object({ id: z.uuid() });

const accountInput = z.object({
  code: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["Cash", "Bank", "Expense"]),
  expenseCategoryId: z.uuid().nullable().default(null),
}).strict().refine(
  (value) => (value.kind === "Expense") === (value.expenseCategoryId !== null),
  "Expense accounts require an expense category; other accounts cannot use one",
).refine(
  (value) => !value.code.startsWith("OPEN_") && !value.code.startsWith("SALE_"),
  "System account codes are reserved",
);

const expenseCategoryInput = z.object({ name: z.string().trim().min(1).max(120) });

export function accountContext(request: FastifyRequest, reply: FastifyReply, write: boolean) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (!["Owner", "Accountant"].includes(tenant.membership.role)) {
    void reply.code(403).send({ error: "Account access requires owner or accountant" });
    return null;
  }
  if (write && !verifyCsrf(request, reply)) return null;
  return { businessId: tenant.businessId, userId: request.user.id };
}

export function registerAccountRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/v1/accounts/setup", async (request, reply) => {
    const tenant = accountContext(request, reply, false);
    if (!tenant) return;
    return withTenantContext(requireDb(deps.db), tenant, async (tx) => ({
      accounts: await tx.account.findMany({ where: { businessId: tenant.businessId, archivedAt: null }, orderBy: { code: "asc" } }),
      expenseCategories: await tx.expenseCategory.findMany({ where: { businessId: tenant.businessId, archivedAt: null }, orderBy: { name: "asc" } }),
    }));
  });

  app.post("/v1/accounts/transfers", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const parsed = transferInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid transfer", details: parsed.error.flatten() });
    try {
      return reply.code(201).send(await postTransfer(requireDb(deps.db), tenant.businessId, tenant.userId, parsed.data));
    } catch (error) {
      if (error instanceof TransferConflict || error instanceof ChangedCommandError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get("/v1/accounts/books/:id", async (request, reply) => {
    const tenant = accountContext(request, reply, false);
    if (!tenant) return;
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    const query = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid account book request" });
    const result = await withTenantContext(requireDb(deps.db), tenant, async (tx) => {
      const account = await tx.account.findFirst({
        where: { id: params.data.id, businessId: tenant.businessId, kind: { in: ["Cash", "Bank"] } },
        select: { id: true, name: true, kind: true },
      });
      if (!account) return null;
      const [totals, lines] = await Promise.all([
        tx.journalLine.aggregate({
          where: { businessId: tenant.businessId, accountId: account.id },
          _sum: { debit: true, credit: true },
        }),
        tx.journalLine.findMany({
          where: { businessId: tenant.businessId, accountId: account.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.data.page - 1) * 25,
          take: 26,
          include: {
            journalEntry: {
              include: {
                sourceEvent: {
                  include: {
                    moneyTransfers: {
                      select: {
                        id: true,
                        reference: true,
                        sourceAccount: { select: { name: true } },
                        destinationAccount: { select: { name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);
      return {
        account,
        page: query.data.page,
        hasMore: lines.length > 25,
        balance: (totals._sum.debit ?? new Prisma.Decimal(0)).minus(totals._sum.credit ?? new Prisma.Decimal(0)).toFixed(2),
        rows: lines.slice(0, 25).map((line) => ({
          id: line.id,
          businessDate: line.journalEntry.businessDate,
          postingKind: line.journalEntry.postingKind,
          debit: line.debit,
          credit: line.credit,
          transfer: line.journalEntry.sourceEvent.moneyTransfers[0] ?? null,
        })),
      };
    });
    if (!result) return reply.code(404).send({ error: "Account book not found" });
    return result;
  });

  app.post("/v1/accounts/expense-categories", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const parsed = expenseCategoryInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid expense category" });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "expense_category.create", async (tx) => {
        const result = await tx.expenseCategory.create({ data: { id, businessId: tenant.businessId, name: parsed.data.name } });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "Expense category name already exists" });
      }
      throw error;
    }
  });

  app.post("/v1/accounts", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const parsed = accountInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid account", details: parsed.error.flatten() });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "account.create", async (tx) => {
        if (parsed.data.expenseCategoryId && !await tx.expenseCategory.findFirst({
          where: { id: parsed.data.expenseCategoryId, businessId: tenant.businessId, archivedAt: null },
        })) {
          throw new Error("INVALID_EXPENSE_CATEGORY");
        }
        const { kind, ...data } = parsed.data;
        const result = await tx.account.create({
          data: {
            id,
            businessId: tenant.businessId,
            ...data,
            kind,
            classification: kind === "Expense" ? "Expense" : "Asset",
          },
        });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_EXPENSE_CATEGORY") {
        return reply.code(400).send({ error: "Expense category missing from this business" });
      }
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "Account code already exists" });
      }
      throw error;
    }
  });

  app.patch("/v1/accounts/:id", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const params = idParam.safeParse(request.params);
    const parsed = z.object({
      name: z.string().trim().min(1).max(120),
      expectedVersion: z.number().int().positive(),
      archive: z.boolean().default(false),
    }).safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid account edit" });
    try {
      return await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "account.edit", async (tx) => {
        const changed = await tx.account.updateMany({
          where: {
            id: params.data.id,
            businessId: tenant.businessId,
            kind: { in: ["Cash", "Bank", "Expense"] },
            version: parsed.data.expectedVersion,
            archivedAt: null,
          },
          data: {
            name: parsed.data.name,
            version: { increment: 1 },
            ...(parsed.data.archive ? { archivedAt: new Date() } : {}),
          },
        });
        if (!changed.count) throw new Error("VERSION_CONFLICT");
        const result = await tx.account.findUniqueOrThrow({ where: { id: params.data.id } });
        return { result, change: { id: result.id, version: result.version, archived: parsed.data.archive } };
      });
    } catch (error) {
      if (error instanceof Error && error.message === "VERSION_CONFLICT") {
        return reply.code(409).send({ error: "Account changed on another device; reload and review your edits" });
      }
      throw error;
    }
  });

  app.post("/v1/accounts/system", async (request, reply) => {
    const tenant = accountContext(request, reply, true);
    if (!tenant) return;
    const existing = await withTenantContext(requireDb(deps.db), tenant, async (tx) =>
      tx.account.findMany({
        where: { businessId: tenant.businessId, code: { in: systemAccounts.map((a) => a.code) } },
      }),
    );
    if (
      existing.length === systemAccounts.length &&
      systemAccounts.every((account) =>
        existing.some(
          (row) =>
            row.code === account.code &&
            row.kind === account.kind &&
            row.classification === account.classification &&
            !row.archivedAt,
        ),
      )
    ) {
      return { accounts: existing };
    }
    try {
      return await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "account.system_init", async (tx) => {
        const rows = [];
        for (const account of systemAccounts) {
          const found = await tx.account.findFirst({ where: { businessId: tenant.businessId, code: account.code } });
          if (found && (found.kind !== account.kind || found.classification !== account.classification || found.archivedAt)) {
            throw new OpeningConflict("A reserved system account code has conflicting configuration");
          }
          rows.push(
            found ??
              (await tx.account.create({
                data: { id: crypto.randomUUID(), businessId: tenant.businessId, ...account },
              })),
          );
        }
        return { result: { accounts: rows }, change: { initialized: true } };
      });
    } catch (error) {
      if (error instanceof OpeningConflict) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });
}

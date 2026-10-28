import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenantContext } from "@business/db";
import {
  dryRunImportItems,
  commitImportItems,
  dryRunImportParties,
  commitImportParties,
  formatCsv,
  ImportError,
} from "../import-export.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
} from "./context.js";

function managerContext(request: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (!["Owner", "Accountant"].includes(tenant.membership.role)) {
    void reply.code(403).send({ error: "Import and data portability require Owner or Accountant authority" });
    return null;
  }
  return {
    businessId: tenant.businessId,
    userId: request.user.id,
    role: tenant.membership.role,
  };
}

export function registerImportExportRoutes(app: FastifyInstance, deps: RouteDeps) {
  // 1. Dry run items import
  app.post("/v1/import/items/dry-run", async (request, reply) => {
    const ctx = managerContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const schema = z.object({ csvText: z.string().min(1, "CSV text cannot be empty") });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid CSV payload" });

    try {
      return await withTenantContext(db, ctx, async (tx) => {
        const result = await dryRunImportItems(tx, ctx.businessId, parsed.data.csvText);
        return reply.send(result);
      });
    } catch (err: unknown) {
      if (err instanceof ImportError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // 2. Commit items import
  app.post("/v1/import/items/commit", async (request, reply) => {
    const ctx = managerContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const schema = z.object({
      batchId: z.string().uuid(),
      items: z.array(
        z.object({
          rowNumber: z.number().int(),
          name: z.string().min(1),
          sku: z.string().optional(),
          barcode: z.string().optional(),
          salePrice: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
          unitCode: z.string().optional(),
          categoryName: z.string().optional(),
        }),
      ),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid items batch payload" });

    try {
      return await withTenantContext(db, ctx, async (tx) => {
        const result = await commitImportItems(tx, ctx.businessId, parsed.data.batchId, parsed.data.items);
        return reply.send(result);
      });
    } catch (err: unknown) {
      if (err instanceof ImportError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // 3. Dry run parties import
  app.post("/v1/import/parties/dry-run", async (request, reply) => {
    const ctx = managerContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const schema = z.object({ csvText: z.string().min(1, "CSV text cannot be empty") });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid CSV payload" });

    try {
      return await withTenantContext(db, ctx, async (tx) => {
        const result = await dryRunImportParties(tx, ctx.businessId, parsed.data.csvText);
        return reply.send(result);
      });
    } catch (err: unknown) {
      if (err instanceof ImportError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // 4. Commit parties import
  app.post("/v1/import/parties/commit", async (request, reply) => {
    const ctx = managerContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const schema = z.object({
      batchId: z.string().uuid(),
      parties: z.array(
        z.object({
          rowNumber: z.number().int(),
          name: z.string().min(1),
          phone: z.string().optional(),
          email: z.string().optional(),
          isCustomer: z.boolean(),
          isSupplier: z.boolean(),
        }),
      ),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid parties batch payload" });

    try {
      return await withTenantContext(db, ctx, async (tx) => {
        const result = await commitImportParties(tx, ctx.businessId, parsed.data.batchId, parsed.data.parties);
        return reply.send(result);
      });
    } catch (err: unknown) {
      if (err instanceof ImportError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // 5. Formula-safe export items to CSV
  app.get("/v1/export/items.csv", async (request, reply) => {
    const ctx = managerContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    return await withTenantContext(db, ctx, async (tx) => {
      const items = await tx.item.findMany({
        where: { businessId: ctx.businessId },
        include: { baseUnit: true, category: true },
        orderBy: { name: "asc" },
      });

      const header = ["Name", "SKU", "Barcode", "Price", "Unit", "Category"];
      const rows = [
        header,
        ...items.map((i) => [
          i.name,
          i.sku ?? "",
          i.barcode ?? "",
          i.salePrice.toFixed(2),
          i.baseUnit?.code ?? "",
          i.category?.name ?? "",
        ]),
      ];

      const csvOutput = formatCsv(rows);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="items-export.csv"')
        .send(csvOutput);
    });
  });

  // 6. Formula-safe export parties to CSV
  app.get("/v1/export/parties.csv", async (request, reply) => {
    const ctx = managerContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    return await withTenantContext(db, ctx, async (tx) => {
      const parties = await tx.party.findMany({
        where: { businessId: ctx.businessId },
        orderBy: { name: "asc" },
      });

      const header = ["Name", "Phone", "Email", "Type"];
      const rows = [
        header,
        ...parties.map((p) => [
          p.name,
          p.phone ?? "",
          p.email ?? "",
          p.isCustomer && p.isSupplier ? "Both" : p.isCustomer ? "Customer" : "Supplier",
        ]),
      ];

      const csvOutput = formatCsv(rows);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="parties-export.csv"')
        .send(csvOutput);
    });
  });
}

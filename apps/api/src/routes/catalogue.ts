import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma, withBusinessChange, withTenantContext } from "@business/db";
import { provisionalPartyInput, acceptProvisionalParty, ProvisionalPartyConflict } from "../provisional-party.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";

const listQuery = z.object({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

const partyInput = z.object({
  name: z.string().trim().min(1).max(160),
  isCustomer: z.boolean(),
  isSupplier: z.boolean(),
  phone: z.string().trim().max(40).nullable().default(null),
  email: z.email().max(255).nullable().default(null),
}).refine((value) => value.isCustomer || value.isSupplier, "Choose customer or supplier");

const itemInput = z.object({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(["Goods", "Service"]),
  categoryId: z.uuid().nullable().default(null),
  baseUnitId: z.uuid().nullable().default(null),
  taxProfileId: z.uuid().nullable().default(null),
  sku: z.string().trim().min(1).max(60).nullable().default(null),
  barcode: z.string().trim().min(1).max(100).nullable().default(null),
  salePrice: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
}).refine((value) => value.kind === "Service" || !!value.baseUnitId, "Goods require a base unit");

const idParam = z.object({ id: z.uuid() });
const partyEdit = partyInput.extend({ expectedVersion: z.number().int().positive(), archive: z.boolean().default(false) });
const itemEdit = itemInput.extend({ expectedVersion: z.number().int().positive(), archive: z.boolean().default(false) });

const categoryInput = z.object({ name: z.string().trim().min(1).max(120) });
const unitInput = z.object({
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(80),
});
const taxInput = z.object({
  name: z.string().trim().min(1).max(100),
  rate: z.string().regex(/^\d+(?:\.\d{1,4})?$/),
  mode: z.enum(["Inclusive", "Exclusive"]),
}).refine((input) => {
  const [whole] = input.rate.split(".");
  return BigInt(whole) <= 100n && (whole !== "100" || !input.rate.includes(".") || /^100\.0+$/.test(input.rate));
});
const conversionInput = z.object({
  itemId: z.uuid(),
  unitId: z.uuid(),
  factor: z.string().regex(/^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,6})?$/),
});

async function checkItemReferences(
  tx: Prisma.TransactionClient,
  businessId: string,
  data: { categoryId: string | null; baseUnitId: string | null; taxProfileId: string | null },
) {
  if (data.categoryId && !await tx.category.findFirst({ where: { id: data.categoryId, businessId, archivedAt: null } })) {
    throw new Error("INVALID_ITEM_REFERENCE");
  }
  if (data.baseUnitId && !await tx.unit.findFirst({ where: { id: data.baseUnitId, businessId, archivedAt: null } })) {
    throw new Error("INVALID_ITEM_REFERENCE");
  }
  if (data.taxProfileId && !await tx.taxProfile.findFirst({ where: { id: data.taxProfileId, businessId, archivedAt: null } })) {
    throw new Error("INVALID_ITEM_REFERENCE");
  }
}

function masterContext(request: FastifyRequest, reply: FastifyReply, write: boolean) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (write && !["Owner", "Accountant"].includes(tenant.membership.role)) {
    void reply.code(403).send({ error: "Master data editing requires owner or accountant" });
    return null;
  }
  if (write && !verifyCsrf(request, reply)) return null;
  return { businessId: tenant.businessId, userId: request.user.id };
}

export function registerCatalogueRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/v1/catalogue/parties", async (request, reply) => {
    const tenant = masterContext(request, reply, false);
    if (!tenant) return;
    const query = listQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid list query" });
    const { q, page } = query.data;
    const rows = await withTenantContext(requireDb(deps.db), tenant, async (tx) =>
      tx.party.findMany({
        where: { businessId: tenant.businessId, archivedAt: null, name: { contains: q, mode: "insensitive" } },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * 25,
        take: 26,
      }),
    );
    return { rows: rows.slice(0, 25), page, hasMore: rows.length > 25 };
  });

  app.post("/v1/catalogue/parties", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = partyInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid party", details: parsed.error.flatten() });
    const id = crypto.randomUUID();
    const row = await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "party.create", async (tx) => {
      const result = await tx.party.create({ data: { id, businessId: tenant.businessId, ...parsed.data } });
      return { result, change: { id, version: 1 } };
    });
    return reply.code(201).send(row);
  });

  app.post("/v1/catalogue/parties/provisional", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant || !verifyCsrf(request, reply)) return;
    const parsed = provisionalPartyInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid provisional party command" });
    try {
      return await acceptProvisionalParty(
        requireDb(deps.db),
        {
          businessId: tenant.businessId,
          userId: request.user.id,
          membershipId: tenant.membership.id,
          role: tenant.membership.role,
          locationId: tenant.membership.locationId,
        },
        parsed.data,
      );
    } catch (error) {
      if (error instanceof ProvisionalPartyConflict) return reply.code(409).send({ error: error.message });
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "Provisional party ID or command is already in use" });
      }
      throw error;
    }
  });

  app.patch("/v1/catalogue/parties/:id", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const params = idParam.safeParse(request.params);
    const parsed = partyEdit.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid party edit" });
    const { expectedVersion, archive, ...data } = parsed.data;
    try {
      const row = await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "party.edit", async (tx) => {
        const changed = await tx.party.updateMany({
          where: { id: params.data.id, businessId: tenant.businessId, version: expectedVersion, archivedAt: null },
          data: { ...data, version: { increment: 1 }, ...(archive ? { archivedAt: new Date() } : {}) },
        });
        if (!changed.count) throw new Error("VERSION_CONFLICT");
        const result = await tx.party.findUniqueOrThrow({ where: { id: params.data.id } });
        return { result, change: { id: result.id, version: result.version, archived: archive } };
      });
      return row;
    } catch (error) {
      if (error instanceof Error && error.message === "VERSION_CONFLICT") {
        return reply.code(409).send({ error: "Party changed on another device; reload and review your edits" });
      }
      throw error;
    }
  });

  app.get("/v1/catalogue/setup", async (request, reply) => {
    const tenant = masterContext(request, reply, false);
    if (!tenant) return;
    return withTenantContext(requireDb(deps.db), tenant, async (tx) => ({
      categories: await tx.category.findMany({ where: { businessId: tenant.businessId, archivedAt: null }, orderBy: { name: "asc" } }),
      units: await tx.unit.findMany({ where: { businessId: tenant.businessId, archivedAt: null }, orderBy: { code: "asc" } }),
      taxProfiles: await tx.taxProfile.findMany({ where: { businessId: tenant.businessId, archivedAt: null }, orderBy: { name: "asc" } }),
    }));
  });

  app.get("/v1/catalogue/choices", async (request, reply) => {
    const tenant = masterContext(request, reply, false);
    if (!tenant) return;
    const parsed = listQuery.extend({
      kind: z.enum(["items", "parties"]),
      role: z.enum(["Stock", "Receivable", "Payable"]),
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid choice query" });
    const { kind, q, page, role } = parsed.data;
    if ((kind === "items") !== (role === "Stock")) return reply.code(400).send({ error: "Invalid choice role" });
    return withTenantContext(requireDb(deps.db), tenant, async (tx) => {
      const where = kind === "items"
        ? {
            businessId: tenant.businessId,
            archivedAt: null,
            kind: "Goods" as const,
            OR: [{ name: { contains: q, mode: "insensitive" as const } }, { barcode: { contains: q } }],
          }
        : {
            businessId: tenant.businessId,
            archivedAt: null,
            ...(role === "Receivable" ? { isCustomer: true } : { isSupplier: true }),
            name: { contains: q, mode: "insensitive" as const },
          };
      const rows = kind === "items"
        ? await tx.item.findMany({
            where,
            select: { id: true, name: true, kind: true },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            skip: (page - 1) * 25,
            take: 26,
          })
        : await tx.party.findMany({
            where,
            select: { id: true, name: true, isCustomer: true, isSupplier: true },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            skip: (page - 1) * 25,
            take: 26,
          });
      return { rows: rows.slice(0, 25), page, hasMore: rows.length > 25 };
    });
  });

  app.get("/v1/catalogue/conversions", async (request, reply) => {
    const tenant = masterContext(request, reply, false);
    if (!tenant) return;
    const parsed = z.object({ itemId: z.uuid() }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid item" });
    return withTenantContext(requireDb(deps.db), tenant, async (tx) => ({
      rows: await tx.itemUnitConversion.findMany({
        where: { businessId: tenant.businessId, itemId: parsed.data.itemId, archivedAt: null },
        orderBy: { id: "asc" },
        select: { id: true, unitId: true, factor: true, version: true },
      }),
    }));
  });

  app.post("/v1/catalogue/categories", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = categoryInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid category" });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "category.create", async (tx) => {
        const result = await tx.category.create({ data: { id, businessId: tenant.businessId, name: parsed.data.name } });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "Category name already exists" });
      }
      throw error;
    }
  });

  app.post("/v1/catalogue/units", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = unitInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid unit" });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "unit.create", async (tx) => {
        const result = await tx.unit.create({ data: { id, businessId: tenant.businessId, ...parsed.data } });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "Unit code already exists" });
      }
      throw error;
    }
  });

  app.post("/v1/catalogue/tax-profiles", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = taxInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid tax profile" });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "tax_profile.create", async (tx) => {
        const result = await tx.taxProfile.create({ data: { id, businessId: tenant.businessId, ...parsed.data } });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "Tax profile name already exists" });
      }
      throw error;
    }
  });

  app.post("/v1/catalogue/conversions", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = conversionInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid unit conversion" });
    try {
      const id = crypto.randomUUID();
      const row = await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "conversion.create", async (tx) => {
        const item = await tx.item.findFirst({ where: { id: parsed.data.itemId, businessId: tenant.businessId, kind: "Goods", archivedAt: null } });
        const unit = await tx.unit.findFirst({ where: { id: parsed.data.unitId, businessId: tenant.businessId, archivedAt: null } });
        if (!item || !unit || item.baseUnitId === unit.id) throw new Error("INVALID_CONVERSION_REFERENCE");
        const result = await tx.itemUnitConversion.create({ data: { id, businessId: tenant.businessId, ...parsed.data } });
        return { result, change: { id, itemId: item.id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CONVERSION_REFERENCE") {
        return reply.code(400).send({ error: "Item and alternate unit must belong to this business" });
      }
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "Conversion already exists" });
      }
      throw error;
    }
  });

  const setupVersion = z.object({ expectedVersion: z.number().int().positive(), archive: z.boolean().default(false) });
  const setupEditors = [
    { path: "categories", group: "category", input: categoryInput.extend(setupVersion.shape) },
    { path: "units", group: "unit", input: unitInput.pick({ name: true }).extend(setupVersion.shape) },
    { path: "tax-profiles", group: "tax_profile", input: taxInput.extend(setupVersion.shape) },
    { path: "conversions", group: "conversion", input: conversionInput.pick({ factor: true }).extend(setupVersion.shape) },
  ] as const;

  for (const editor of setupEditors) {
    app.patch(`/v1/catalogue/${editor.path}/:id`, async (request, reply) => {
      const tenant = masterContext(request, reply, true);
      if (!tenant) return;
      const params = idParam.safeParse(request.params);
      const parsed = editor.input.safeParse(request.body);
      if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid setup edit" });
      const { expectedVersion, archive, ...data } = parsed.data;
      try {
        return await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, `${editor.group}.edit`, async (tx) => {
          const where = { id: params.data.id, businessId: tenant.businessId, version: expectedVersion, archivedAt: null };
          const update = { ...data, version: { increment: 1 }, ...(archive ? { archivedAt: new Date() } : {}) };
          let result;
          if (editor.group === "category") {
            if (!(await tx.category.updateMany({ where, data: update })).count) throw new Error("VERSION_CONFLICT");
            result = await tx.category.findUniqueOrThrow({ where: { id: params.data.id } });
          } else if (editor.group === "unit") {
            if (!(await tx.unit.updateMany({ where, data: update })).count) throw new Error("VERSION_CONFLICT");
            result = await tx.unit.findUniqueOrThrow({ where: { id: params.data.id } });
          } else if (editor.group === "tax_profile") {
            if (!(await tx.taxProfile.updateMany({ where, data: update })).count) throw new Error("VERSION_CONFLICT");
            result = await tx.taxProfile.findUniqueOrThrow({ where: { id: params.data.id } });
          } else {
            if (!(await tx.itemUnitConversion.updateMany({ where, data: update })).count) throw new Error("VERSION_CONFLICT");
            result = await tx.itemUnitConversion.findUniqueOrThrow({ where: { id: params.data.id } });
          }
          return { result, change: { id: result.id, version: result.version, archived: archive } };
        });
      } catch (error) {
        if (error instanceof Error && error.message === "VERSION_CONFLICT") {
          return reply.code(409).send({ error: "Setup changed on another device; reload and review your edits" });
        }
        if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
          return reply.code(409).send({ error: "Setup name already exists in this business" });
        }
        throw error;
      }
    });
  }

  app.get("/v1/catalogue/items", async (request, reply) => {
    const tenant = masterContext(request, reply, false);
    if (!tenant) return;
    const query = listQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid list query" });
    const { q, page } = query.data;
    const rows = await withTenantContext(requireDb(deps.db), tenant, async (tx) =>
      tx.item.findMany({
        where: {
          businessId: tenant.businessId,
          archivedAt: null,
          OR: [{ name: { contains: q, mode: "insensitive" } }, { barcode: { contains: q } }],
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * 25,
        take: 26,
      }),
    );
    return { rows: rows.slice(0, 25), page, hasMore: rows.length > 25 };
  });

  app.post("/v1/catalogue/items", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const parsed = itemInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid item", details: parsed.error.flatten() });
    const id = crypto.randomUUID();
    try {
      const row = await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "item.create", async (tx) => {
        await checkItemReferences(tx, tenant.businessId, parsed.data);
        const result = await tx.item.create({ data: { id, businessId: tenant.businessId, ...parsed.data } });
        return { result, change: { id, version: 1 } };
      });
      return reply.code(201).send(row);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_ITEM_REFERENCE") {
        return reply.code(400).send({ error: "Catalogue reference is missing or archived in this business" });
      }
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "SKU or barcode already exists in this business" });
      }
      throw error;
    }
  });

  app.patch("/v1/catalogue/items/:id", async (request, reply) => {
    const tenant = masterContext(request, reply, true);
    if (!tenant) return;
    const params = idParam.safeParse(request.params);
    const parsed = itemEdit.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: "Invalid item edit" });
    const { expectedVersion, archive, ...data } = parsed.data;
    try {
      return await withBusinessChange(requireDb(deps.db), tenant.businessId, tenant.userId, "item.edit", async (tx) => {
        await checkItemReferences(tx, tenant.businessId, data);
        const changed = await tx.item.updateMany({
          where: { id: params.data.id, businessId: tenant.businessId, version: expectedVersion, archivedAt: null },
          data: { ...data, version: { increment: 1 }, ...(archive ? { archivedAt: new Date() } : {}) },
        });
        if (!changed.count) throw new Error("VERSION_CONFLICT");
        const result = await tx.item.findUniqueOrThrow({ where: { id: params.data.id } });
        return { result, change: { id: result.id, version: result.version, archived: archive } };
      });
    } catch (error) {
      if (error instanceof Error && error.message === "VERSION_CONFLICT") {
        return reply.code(409).send({ error: "Item changed on another device; reload and review your edits" });
      }
      if (error instanceof Error && error.message === "INVALID_ITEM_REFERENCE") {
        return reply.code(400).send({ error: "Catalogue reference is missing or archived in this business" });
      }
      if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "SKU or barcode already exists in this business" });
      }
      throw error;
    }
  });
}

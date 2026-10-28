import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ROLE_CAPABILITIES, type Role } from "@business/contracts";
import { withTenantContext } from "@business/db";
import { issueOfflineLease } from "../devices/devices.js";
import { systemAccounts } from "../opening.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";

export function registerSyncRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/v1/sync/bootstrap", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb(deps.db);

    const { deviceEnrollmentId } = request.query as { deviceEnrollmentId?: string };
    if (!deviceEnrollmentId) {
      return reply.code(400).send({ error: "deviceEnrollmentId query parameter required" });
    }

    const { device, business, locations, existingLease, catalogue, syncCursor } = await withTenantContext(
      client,
      { businessId: tenant.businessId, userId: request.user.id },
      async (tx) => {
        const d = await tx.deviceEnrollment.findFirst({
          where: { id: deviceEnrollmentId, businessId: tenant.businessId },
        });

        const b = await tx.business.findUniqueOrThrow({
          where: { id: tenant.businessId },
        });

        const locs = await tx.location.findMany({
          where: {
            businessId: tenant.businessId,
            ...(tenant.membership.locationId && tenant.membership.role !== "Owner"
              ? { id: tenant.membership.locationId }
              : {}),
          },
          orderBy: { code: "asc" },
        });

        const l = await tx.offlineLease.findFirst({
          where: {
            businessId: tenant.businessId,
            deviceEnrollmentId,
            membershipId: tenant.membership.id,
            datasetEpoch: b.datasetEpoch,
            policyVersion: tenant.membership.permissionVersion,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          orderBy: { issuedAt: "desc" },
        });

        const syncHead = await tx.syncHead.findUnique({ where: { businessId: tenant.businessId } });

        const [items, parties, categories, units, taxProfiles, conversions, sales, cashAccounts] = await Promise.all([
          tx.item.findMany({
            where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, kind: true, name: true, sku: true, barcode: true, salePrice: true,
              categoryId: true, baseUnitId: true, taxProfileId: true, version: true },
          }),
          tx.party.findMany({
            where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, name: true, isCustomer: true, isSupplier: true, phone: true, email: true, version: true },
          }),
          tx.category.findMany({
            where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, name: true, version: true },
          }),
          tx.unit.findMany({
            where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, code: true, name: true, version: true },
          }),
          tx.taxProfile.findMany({
            where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, name: true, rate: true, mode: true, version: true },
          }),
          tx.itemUnitConversion.findMany({
            where: { businessId: tenant.businessId, archivedAt: null },
            select: { id: true, itemId: true, unitId: true, factor: true, version: true },
          }),
          tx.saleDocument.findMany({
            where: {
              businessId: tenant.businessId,
              status: "Posted",
              ...(tenant.membership.locationId && tenant.membership.role !== "Owner"
                ? { locationId: tenant.membership.locationId }
                : {}),
            },
            select: { id: true, number: true, locationId: true, partyId: true, businessDate: true,
              total: true, paid: true, due: true, postedAt: true, status: true },
          }),
          tx.account.findMany({
            where: { businessId: tenant.businessId, archivedAt: null, kind: "Cash" },
            select: { id: true, name: true, kind: true },
          }),
        ]);

        const accountSetup = ["Owner", "Accountant"].includes(tenant.membership.role)
          ? {
              accounts: await tx.account.findMany({
                where: { businessId: tenant.businessId, archivedAt: null },
                select: { id: true, code: true, name: true, kind: true, classification: true,
                  expenseCategoryId: true, version: true },
              }),
              expenseCategories: await tx.expenseCategory.findMany({
                where: { businessId: tenant.businessId, archivedAt: null },
                select: { id: true, name: true, version: true },
              }),
            }
          : null;

        return {
          device: d,
          business: b,
          locations: locs,
          existingLease: l,
          syncCursor: (syncHead?.committedCursor ?? 0n).toString(),
          catalogue: { items, parties, categories, units, taxProfiles, conversions, sales, cashAccounts, accountSetup },
        };
      },
    );

    if (!device || device.status !== "Enrolled") {
      return reply.code(403).send({ error: "Device is not enrolled or has been revoked" });
    }

    if (device.membershipId !== tenant.membership.id) {
      return reply.code(403).send({ error: "Device is enrolled for another membership" });
    }

    if (tenant.membership.locationId && tenant.membership.role !== "Owner") {
      if (device.locationId !== tenant.membership.locationId) {
        return reply.code(403).send({ error: "Device location does not match membership scope" });
      }
    }

    const role = tenant.membership.role as Role;
    const capabilities = ROLE_CAPABILITIES[role] ?? [];
    const canLease = capabilities.includes("offline:lease");

    let lease = null;
    if (canLease) {
      lease = existingLease;
      if (!lease) {
        lease = await issueOfflineLease(client, deps.leaseSecret, {
          businessId: tenant.businessId,
          deviceEnrollmentId,
          membershipId: tenant.membership.id,
          actorUserId: request.user.id,
        });
      }
    }

    return reply.code(200).send({
      business: {
        id: business.id,
        name: business.name,
        currency: business.currency,
        timezone: business.timezone,
        datasetEpoch: business.datasetEpoch,
      },
      membership: {
        id: tenant.membership.id,
        businessId: tenant.membership.businessId,
        businessName: tenant.membership.business.name,
        role: tenant.membership.role,
        permissionVersion: tenant.membership.permissionVersion,
        locationId: tenant.membership.locationId,
        locationName: tenant.membership.location?.name ?? null,
      },
      device: {
        id: device.id,
        businessId: device.businessId,
        membershipId: device.membershipId,
        locationId: device.locationId,
        deviceName: device.deviceName,
        numberPrefix: device.numberPrefix,
        saleSequence: device.saleSequence.toString(),
        status: device.status,
        enrolledAt: device.enrolledAt.toISOString(),
        revokedAt: device.revokedAt ? device.revokedAt.toISOString() : null,
      },
      lease: lease
        ? {
            id: lease.id,
            businessId: lease.businessId,
            deviceEnrollmentId: lease.deviceEnrollmentId,
            membershipId: lease.membershipId,
            datasetEpoch: lease.datasetEpoch,
            policyVersion: lease.policyVersion,
            issuedAt: lease.issuedAt.toISOString(),
            expiresAt: lease.expiresAt.toISOString(),
            revokedAt: lease.revokedAt ? lease.revokedAt.toISOString() : null,
            signature: lease.signature,
          }
        : null,
      permittedLocations: locations.map((loc) => ({
        id: loc.id,
        code: loc.code,
        name: loc.name,
      })),
      catalogue,
      syncCursor,
      rolePermissions: {
        role,
        capabilities,
      },
    });
  });

  app.get("/v1/sync/pull", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const parsed = z.object({
      deviceEnrollmentId: z.uuid(),
      afterCursor: z.string().regex(/^\d{1,19}$/),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid pull cursor or device" });

    const { deviceEnrollmentId, afterCursor, limit } = parsed.data;
    const after = BigInt(afterCursor);

    const result = await withTenantContext(
      requireDb(deps.db),
      { businessId: tenant.businessId, userId: request.user.id },
      async (tx) => {
        const device = await tx.deviceEnrollment.findFirst({
          where: {
            id: deviceEnrollmentId,
            businessId: tenant.businessId,
            membershipId: tenant.membership.id,
            status: "Enrolled",
          },
        });
        if (!device || (tenant.membership.locationId && tenant.membership.role !== "Owner" && device.locationId !== tenant.membership.locationId)) {
          return null;
        }

        const head = await tx.syncHead.findUnique({ where: { businessId: tenant.businessId } });
        const committedCursor = head?.committedCursor ?? 0n;
        const epoch = head?.datasetEpoch ?? (await tx.business.findUniqueOrThrow({ where: { id: tenant.businessId } })).datasetEpoch;

        if (after > committedCursor) return { invalidCursor: true };

        const batches = await tx.changeBatch.findMany({
          where: { businessId: tenant.businessId, datasetEpoch: epoch, cursor: { gt: after } },
          orderBy: { cursor: "asc" },
          take: limit,
        });

        if (after < committedCursor && (!batches.length || batches[0].cursor !== after + 1n)) {
          return { expiredCursor: true, committedCursor: committedCursor.toString() };
        }

        const privileged = ["Owner", "Accountant"].includes(tenant.membership.role);
        const changes = [];

        for (const batch of batches) {
          const payload = batch.payload as Record<string, unknown>;
          const action = typeof payload.action === "string" ? payload.action : "";
          const id = typeof payload.id === "string" ? payload.id : "";

          if (action === "account.system_init" && privileged) {
            const rows = await tx.account.findMany({
              where: { businessId: tenant.businessId, code: { in: systemAccounts.map((account) => account.code) } },
              select: { id: true, code: true, name: true, kind: true, classification: true,
                expenseCategoryId: true, version: true, archivedAt: true },
            });
            changes.push({ cursor: batch.cursor.toString(), action, row: { accounts: rows } });
            continue;
          }

          const sourceEventId = typeof payload.sourceEventId === "string" ? payload.sourceEventId : null;
          if (!action && sourceEventId) {
            const sale = await tx.saleDocument.findFirst({
              where: {
                businessId: tenant.businessId,
                sourceEventId,
                status: "Posted",
                ...(tenant.membership.locationId && tenant.membership.role !== "Owner"
                  ? { locationId: tenant.membership.locationId }
                  : {}),
              },
              select: { id: true, number: true, locationId: true, partyId: true, businessDate: true,
                total: true, paid: true, due: true, postedAt: true, status: true },
            });
            if (sale) changes.push({ cursor: batch.cursor.toString(), action: "sale.post", row: sale });
            continue;
          }

          if (!id) continue;
          const group = action.split(".")[0];
          if (group === "expense_category" && !privileged) continue;
          const where = { id, businessId: tenant.businessId };
          let row: Record<string, unknown> | null = null;

          if (group === "item") {
            row = await tx.item.findFirst({
              where,
              select: { id: true, name: true, kind: true, sku: true, barcode: true, salePrice: true,
                categoryId: true, baseUnitId: true, taxProfileId: true, version: true, archivedAt: true },
            });
          } else if (group === "party") {
            row = await tx.party.findFirst({
              where,
              select: { id: true, name: true, isCustomer: true, isSupplier: true, phone: true, email: true, version: true, archivedAt: true },
            });
          } else if (group === "category") {
            row = await tx.category.findFirst({
              where,
              select: { id: true, name: true, version: true, archivedAt: true },
            });
          } else if (group === "unit") {
            row = await tx.unit.findFirst({
              where,
              select: { id: true, name: true, code: true, version: true, archivedAt: true },
            });
          } else if (group === "tax_profile") {
            row = await tx.taxProfile.findFirst({
              where,
              select: { id: true, name: true, rate: true, mode: true, version: true, archivedAt: true },
            });
          } else if (group === "conversion") {
            row = await tx.itemUnitConversion.findFirst({
              where,
              select: { id: true, itemId: true, unitId: true, factor: true, version: true, archivedAt: true },
            });
          } else if (group === "account") {
            row = privileged
              ? await tx.account.findFirst({
                  where,
                  select: { id: true, code: true, name: true, kind: true, classification: true,
                    expenseCategoryId: true, version: true, archivedAt: true },
                })
              : await tx.account.findFirst({
                  where: { ...where, kind: "Cash" },
                  select: { id: true, name: true, kind: true, archivedAt: true },
                });
          } else if (group === "expense_category" && privileged) {
            row = await tx.expenseCategory.findFirst({
              where,
              select: { id: true, name: true, version: true, archivedAt: true },
            });
          }
          if (row) changes.push({ cursor: batch.cursor.toString(), action, row });
        }

        const nextCursor = (batches.at(-1)?.cursor ?? after).toString();
        return {
          datasetEpoch: epoch,
          fromCursor: afterCursor,
          nextCursor,
          permissionVersion: tenant.membership.permissionVersion,
          committedCursor: committedCursor.toString(),
          hasMore: BigInt(nextCursor) < committedCursor,
          changes,
        };
      },
    );

    if (!result) return reply.code(403).send({ error: "Device is not enrolled for this membership" });
    if ("invalidCursor" in result) return reply.code(400).send({ error: "Cursor is ahead of this business" });
    if ("expiredCursor" in result) {
      return reply.code(410).send({
        error: "Sync history is no longer continuous; resnapshot this device and preserve pending work",
        code: "CURSOR_EXPIRED",
        committedCursor: result.committedCursor,
      });
    }
    return result;
  });

  app.post("/v1/sync/push/sale", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    if (!ROLE_CAPABILITIES[tenant.membership.role as Role]?.includes("trade:write")) {
      return reply.code(403).send({ error: "Trade permission required" });
    }
    if (!verifyCsrf(request, reply)) return;
    return reply.code(410).send({
      code: "OFFLINE_RETIRED",
      error: "Offline issue is retired. Preserve any saved issued bill and its encrypted recovery file for authorised reconciliation.",
    });
  });
}

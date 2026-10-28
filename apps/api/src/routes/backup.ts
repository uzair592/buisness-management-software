import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { withTenantContext } from "@business/db";
import {
  exportBusinessArchive,
  inspectBusinessArchive,
  promoteBusinessArchive,
  BackupError,
} from "../backup.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
} from "./context.js";

function ownerContext(request: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (tenant.membership.role !== "Owner") {
    void reply.code(403).send({ error: "Backup export and restore require Owner authority" });
    return null;
  }
  return {
    businessId: tenant.businessId,
    userId: request.user.id,
    role: tenant.membership.role,
  };
}

function inspectorContext(request: FastifyRequest, reply: FastifyReply) {
  if (!requireAuth(request, reply)) return null;
  const tenant = requireTenantContext(request, reply);
  if (!tenant) return null;
  if (!["Owner", "Accountant"].includes(tenant.membership.role)) {
    void reply.code(403).send({ error: "Inspecting backup requires Owner or Accountant authority" });
    return null;
  }
  return {
    businessId: tenant.businessId,
    userId: request.user.id,
    role: tenant.membership.role,
  };
}

const envelopeSchema = z.object({
  version: z.number().int(),
  format: z.literal("bms-tenant-archive-v1"),
  saltHex: z.string().min(1),
  ivHex: z.string().min(1),
  authTagHex: z.string().min(1),
  encryptedDataHex: z.string().min(1),
  checksumSha256: z.string().min(64).max(64),
  businessId: z.string().uuid(),
  exportedAt: z.string(),
});

export function registerBackupRoutes(app: FastifyInstance, deps: RouteDeps) {
  // 1. Export single-business archive
  app.post("/v1/backup/export", async (request, reply) => {
    const ctx = ownerContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const bodySchema = z.object({
      passphrase: z.string().min(8, "Passphrase must be at least 8 characters"),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message || "Invalid passphrase" });
    }

    try {
      return await withTenantContext(db, ctx, async (tx) => {
        const envelope = await exportBusinessArchive(tx, ctx.businessId, parsed.data.passphrase);
        return reply.send(envelope);
      });
    } catch (err: unknown) {
      if (err instanceof BackupError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // 2. Inspect archive diff against active business
  app.post("/v1/backup/inspect", async (request, reply) => {
    const ctx = inspectorContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const bodySchema = z.object({
      envelope: envelopeSchema,
      passphrase: z.string().min(8),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid backup envelope or passphrase" });
    }

    if (parsed.data.envelope.businessId !== ctx.businessId) {
      return reply.code(403).send({ error: "Archive belongs to a different business: cross-tenant inspection forbidden" });
    }

    try {
      return await withTenantContext(db, ctx, async (tx) => {
        const summary = await inspectBusinessArchive(
          tx,
          ctx.businessId,
          parsed.data.envelope,
          parsed.data.passphrase,
        );
        return reply.send(summary);
      });
    } catch (err: unknown) {
      if (err instanceof BackupError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // 3. Promote archive with epoch fencing
  app.post("/v1/backup/promote", async (request, reply) => {
    const ctx = ownerContext(request, reply);
    if (!ctx) return;
    const db = requireDb(deps.db);

    const bodySchema = z.object({
      envelope: envelopeSchema,
      passphrase: z.string().min(8),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid backup envelope or passphrase" });
    }

    if (parsed.data.envelope.businessId !== ctx.businessId) {
      return reply.code(403).send({ error: "Archive belongs to a different business: cross-tenant inspection forbidden" });
    }

    try {
      return await withTenantContext(db, ctx, async (tx) => {
        const result = await promoteBusinessArchive(
          tx,
          ctx.businessId,
          ctx.userId,
          parsed.data.envelope,
          parsed.data.passphrase,
        );
        return reply.send(result);
      });
    } catch (err: unknown) {
      if (err instanceof BackupError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });
}

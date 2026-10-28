import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  enrollDeviceSchema,
  revokeDeviceSchema,
  requestLeaseSchema,
  ROLE_CAPABILITIES,
  type Role,
} from "@business/contracts";
import { withTenantContext } from "@business/db";
import {
  enrollDevice,
  revokeDevice,
  issueOfflineLease,
} from "../devices/devices.js";
import {
  type RouteDeps,
  requireDb,
  requireAuth,
  requireTenantContext,
  verifyCsrf,
} from "./context.js";

export function registerDeviceRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.get("/v1/locations", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb(deps.db);

    const locations = await withTenantContext(
      client,
      { businessId: tenant.businessId, userId: request.user.id },
      async (tx) => {
        if (tenant.membership.locationId && tenant.membership.role !== "Owner") {
          return await tx.location.findMany({
            where: { businessId: tenant.businessId, id: tenant.membership.locationId },
            orderBy: { code: "asc" },
          });
        }
        return await tx.location.findMany({
          where: { businessId: tenant.businessId },
          orderBy: { code: "asc" },
        });
      },
    );

    return reply.code(200).send(
      locations.map((loc) => ({
        id: loc.id,
        code: loc.code,
        name: loc.name,
      })),
    );
  });

  app.post("/v1/locations", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    if (!verifyCsrf(request, reply)) return;
    if (!["Owner", "Accountant"].includes(tenant.membership.role)) {
      return reply.code(403).send({ error: "Location management permission required" });
    }

    const bodySchema = z.object({
      code: z.string().trim().min(1).max(20),
      name: z.string().trim().min(1).max(100),
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Code and name are required for a location" });
    }

    const client = requireDb(deps.db);
    return withTenantContext(client, { businessId: tenant.businessId, userId: request.user.id }, async (tx) => {
      const existing = await tx.location.findFirst({
        where: { businessId: tenant.businessId, code: parsed.data.code },
      });
      if (existing) {
        return reply.code(409).send({ error: "Location code already exists" });
      }

      const created = await tx.location.create({
        data: {
          businessId: tenant.businessId,
          code: parsed.data.code,
          name: parsed.data.name,
        },
      });

      return reply.code(201).send(created);
    });
  });

  app.get("/v1/devices", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb(deps.db);

    const devices = await withTenantContext(
      client,
      { businessId: tenant.businessId, userId: request.user.id },
      async (tx) => {
        return await tx.deviceEnrollment.findMany({
          where: { businessId: tenant.businessId },
          orderBy: { enrolledAt: "desc" },
        });
      },
    );

    return reply.code(200).send(
      devices.map((d) => ({
        id: d.id,
        businessId: d.businessId,
        membershipId: d.membershipId,
        locationId: d.locationId,
        deviceName: d.deviceName,
        numberPrefix: d.numberPrefix,
        status: d.status,
        enrolledAt: d.enrolledAt.toISOString(),
        revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
      })),
    );
  });

  app.post("/v1/devices/enroll", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!verifyCsrf(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb(deps.db);

    if (tenant.membership.role !== "Owner") {
      return reply.code(403).send({ error: "Only owners can enroll devices" });
    }

    const parseRes = enrollDeviceSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({
        error: "Validation failed",
        details: parseRes.error.flatten(),
      });
    }

    try {
      const enrollment = await enrollDevice(client, {
        businessId: tenant.businessId,
        membershipId: tenant.membership.id,
        locationId: parseRes.data.locationId,
        deviceName: parseRes.data.deviceName,
        numberPrefix: parseRes.data.numberPrefix,
        actorUserId: request.user.id,
      });

      return reply.code(201).send({
        id: enrollment.id,
        businessId: enrollment.businessId,
        membershipId: enrollment.membershipId,
        locationId: enrollment.locationId,
        deviceName: enrollment.deviceName,
        numberPrefix: enrollment.numberPrefix,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt.toISOString(),
        revokedAt: enrollment.revokedAt ? enrollment.revokedAt.toISOString() : null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Enrollment failed";
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/v1/devices/revoke", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!verifyCsrf(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb(deps.db);

    if (tenant.membership.role !== "Owner") {
      return reply.code(403).send({ error: "Only owners can revoke devices" });
    }

    const parseRes = revokeDeviceSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: "Validation failed" });
    }

    try {
      const revoked = await revokeDevice(client, {
        businessId: tenant.businessId,
        deviceEnrollmentId: parseRes.data.deviceEnrollmentId,
        actorUserId: request.user.id,
        reason: parseRes.data.reason,
      });

      return reply.code(200).send({
        id: revoked.id,
        businessId: revoked.businessId,
        status: revoked.status,
        revokedAt: revoked.revokedAt ? revoked.revokedAt.toISOString() : null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Revocation failed";
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/v1/devices/lease", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (!verifyCsrf(request, reply)) return;
    const tenant = requireTenantContext(request, reply);
    if (!tenant) return;
    const client = requireDb(deps.db);

    const role = tenant.membership.role as Role;
    const capabilities = ROLE_CAPABILITIES[role] ?? [];
    if (!capabilities.includes("offline:lease")) {
      return reply.code(403).send({ error: "Membership lacks offline lease capability" });
    }

    const parseRes = requestLeaseSchema.safeParse(request.body);
    if (!parseRes.success) {
      return reply.code(400).send({ error: "Validation failed" });
    }

    const device = await withTenantContext(
      client,
      { businessId: tenant.businessId, userId: request.user.id },
      async (tx) => {
        return await tx.deviceEnrollment.findFirst({
          where: { id: parseRes.data.deviceEnrollmentId, businessId: tenant.businessId },
        });
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

    try {
      const lease = await issueOfflineLease(client, deps.leaseSecret, {
        businessId: tenant.businessId,
        deviceEnrollmentId: parseRes.data.deviceEnrollmentId,
        membershipId: tenant.membership.id,
        actorUserId: request.user.id,
      });

      return reply.code(200).send({
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
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Lease issuance failed";
      return reply.code(400).send({ error: message });
    }
  });
}

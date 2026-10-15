import crypto from "node:crypto";
import { type PrismaClient, withTenantContext } from "@business/db";

const DEFAULT_LEASE_HOURS = 72;

export function generateLeaseSignature(
  leaseSecret: string,
  data: {
    businessId: string;
    deviceEnrollmentId: string;
    membershipId: string;
    datasetEpoch: number;
    policyVersion: number;
    expiresAt: Date;
  },
): string {
  const payload = `${data.businessId}:${data.deviceEnrollmentId}:${data.membershipId}:${data.datasetEpoch}:${data.policyVersion}:${data.expiresAt.toISOString()}`;
  return crypto.createHmac("sha256", leaseSecret).update(payload).digest("hex");
}

export async function allocateNextPrefix(
  db: PrismaClient,
  businessId: string,
  preferredPrefix?: string,
): Promise<string> {
  if (preferredPrefix) {
    const formatted = preferredPrefix.trim().toUpperCase();
    const existing = await db.devicePrefixRegistry.findUnique({
      where: {
        businessId_numberPrefix: {
          businessId,
          numberPrefix: formatted,
        },
      },
    });
    if (existing) {
      throw new Error(`Device prefix '${formatted}' has already been used in this business`);
    }
    return formatted;
  }

  // Auto-allocate next prefix
  const usedPrefixes = await db.devicePrefixRegistry.findMany({
    where: { businessId },
    select: { numberPrefix: true },
  });
  const usedSet = new Set(usedPrefixes.map((p) => p.numberPrefix));

  for (let i = 1; i <= 999; i++) {
    const candidate = `D${String(i).padStart(2, "0")}`;
    if (!usedSet.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("Maximum device prefix allocation reached for business");
}

export async function enrollDevice(
  db: PrismaClient,
  opts: {
    businessId: string;
    membershipId: string;
    locationId: string;
    deviceName: string;
    numberPrefix?: string;
    actorUserId: string;
  },
) {
  // Verify location exists within business
  const location = await db.location.findFirst({
    where: { id: opts.locationId, businessId: opts.businessId },
  });
  if (!location) {
    throw new Error("Location does not exist in this business");
  }

  const prefix = await allocateNextPrefix(db, opts.businessId, opts.numberPrefix);

  return await withTenantContext(
    db,
    { businessId: opts.businessId, userId: opts.actorUserId },
    async (tx) => {
      // Register prefix to guarantee it can never be reused
      await tx.devicePrefixRegistry.create({
        data: {
          businessId: opts.businessId,
          numberPrefix: prefix,
        },
      });

      const enrollment = await tx.deviceEnrollment.create({
        data: {
          businessId: opts.businessId,
          membershipId: opts.membershipId,
          locationId: opts.locationId,
          deviceName: opts.deviceName,
          numberPrefix: prefix,
          status: "Enrolled",
        },
      });

      await tx.auditEvent.create({
        data: {
          businessId: opts.businessId,
          userId: opts.actorUserId,
          action: "device.enrol",
          details: {
            deviceEnrollmentId: enrollment.id,
            deviceName: enrollment.deviceName,
            numberPrefix: prefix,
            locationId: opts.locationId,
          },
        },
      });

      return enrollment;
    },
  );
}

export async function revokeDevice(
  db: PrismaClient,
  opts: {
    businessId: string;
    deviceEnrollmentId: string;
    actorUserId: string;
    reason?: string;
  },
) {
  return await withTenantContext(
    db,
    { businessId: opts.businessId, userId: opts.actorUserId },
    async (tx) => {
      const device = await tx.deviceEnrollment.findFirst({
        where: { id: opts.deviceEnrollmentId, businessId: opts.businessId },
      });
      if (!device) {
        throw new Error("Device not found in this business");
      }

      const revokedAt = new Date();

      const updated = await tx.deviceEnrollment.update({
        where: { id: opts.deviceEnrollmentId },
        data: {
          status: "Revoked",
          revokedAt,
        },
      });

      // Revoke any active offline leases
      await tx.offlineLease.updateMany({
        where: {
          deviceEnrollmentId: opts.deviceEnrollmentId,
          revokedAt: null,
        },
        data: { revokedAt },
      });

      await tx.auditEvent.create({
        data: {
          businessId: opts.businessId,
          userId: opts.actorUserId,
          action: "device.revoke",
          details: {
            deviceEnrollmentId: opts.deviceEnrollmentId,
            reason: opts.reason ?? "Revoked by business owner",
          },
        },
      });

      return updated;
    },
  );
}

export async function issueOfflineLease(
  db: PrismaClient,
  leaseSecret: string,
  opts: {
    businessId: string;
    deviceEnrollmentId: string;
    membershipId: string;
    durationHours?: number;
  },
) {
  const device = await db.deviceEnrollment.findFirst({
    where: {
      id: opts.deviceEnrollmentId,
      businessId: opts.businessId,
    },
  });

  if (!device || device.status !== "Enrolled") {
    throw new Error("Cannot issue lease for an unenrolled or revoked device");
  }

  const business = await db.business.findUniqueOrThrow({
    where: { id: opts.businessId },
  });

  const membership = await db.membership.findFirstOrThrow({
    where: { id: opts.membershipId, businessId: opts.businessId },
  });

  const hours = opts.durationHours ?? DEFAULT_LEASE_HOURS;
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const signature = generateLeaseSignature(leaseSecret, {
    businessId: opts.businessId,
    deviceEnrollmentId: opts.deviceEnrollmentId,
    membershipId: opts.membershipId,
    datasetEpoch: business.datasetEpoch,
    policyVersion: membership.permissionVersion,
    expiresAt,
  });

  return await withTenantContext(
    db,
    { businessId: opts.businessId },
    async (tx) => {
      return await tx.offlineLease.create({
        data: {
          businessId: opts.businessId,
          deviceEnrollmentId: opts.deviceEnrollmentId,
          membershipId: opts.membershipId,
          datasetEpoch: business.datasetEpoch,
          policyVersion: membership.permissionVersion,
          expiresAt,
          signature,
        },
      });
    },
  );
}

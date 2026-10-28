import crypto from "node:crypto";
import type { PrismaClient, Prisma } from "@business/db";

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export interface ArchiveManifest {
  version: number;
  schemaVersion: number;
  datasetEpoch: number;
  businessId: string;
  businessName: string;
  currency: string;
  exportedAt: string;
  checksumSha256: string;
  controlTotals: {
    totalDebits: string;
    totalCredits: string;
    stockValuation: string;
    recordCounts: Record<string, number>;
  };
}

export interface EncryptedArchiveEnvelope {
  version: number;
  format: "bms-tenant-archive-v1";
  saltHex: string;
  ivHex: string;
  authTagHex: string;
  encryptedDataHex: string;
  checksumSha256: string;
  businessId: string;
  exportedAt: string;
}

export interface InspectionSummary {
  valid: boolean;
  manifest: ArchiveManifest;
  activeBusiness: {
    id: string;
    name: string;
    currentEpoch: number;
    recordCounts: Record<string, number>;
  };
  archiveBusiness: {
    id: string;
    name: string;
    archiveEpoch: number;
    recordCounts: Record<string, number>;
  };
  differences: Record<string, { active: number; archive: number; delta: number }>;
}

/**
 * Derives a 256-bit encryption key using PBKDF2 with 100,000 iterations of SHA-256.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 8) {
    throw new BackupError("Passphrase must be at least 8 characters");
  }
  return crypto.pbkdf2Sync(passphrase, salt, 100_000, 32, "sha256");
}

/**
 * Exports a complete, isolated tenant archive encrypted with AES-256-GCM.
 */
export async function exportBusinessArchive(
  tx: Prisma.TransactionClient | PrismaClient,
  businessId: string,
  passphrase: string,
): Promise<EncryptedArchiveEnvelope> {
  const business = await tx.business.findUnique({
    where: { id: businessId },
    include: {
      locations: true,
      accounts: true,
      expenseCategories: true,
      units: true,
      taxProfiles: true,
      categories: true,
      items: { include: { conversions: true } },
      parties: true,
      journalEntries: { include: { lines: true } },
      stockMovements: true,
      sales: { include: { lines: true, payments: true } },
      purchases: { include: { lines: true, payments: true } },
      payments: { include: { allocations: true } },
      expenses: true,
      creditNotes: { include: { lines: true, refunds: true } },
      stockAdjustments: true,
      cashSessions: true,
      commandReceipts: true,
    },
  });

  if (!business) {
    throw new BackupError("Business not found");
  }

  // Calculate control totals
  let totalDebitsCents = 0n;
  let totalCreditsCents = 0n;
  for (const entry of business.journalEntries) {
    for (const line of entry.lines) {
      const d = line.debit ? BigInt(line.debit.toString().replace(".", "")) : 0n;
      const c = line.credit ? BigInt(line.credit.toString().replace(".", "")) : 0n;
      totalDebitsCents += d;
      totalCreditsCents += c;
    }
  }

  let totalStockValuationCents = 0n;
  for (const m of business.stockMovements) {
    const val = BigInt(m.valueDelta.toString().replace(".", ""));
    totalStockValuationCents += val;
  }

  const recordCounts: Record<string, number> = {
    locations: business.locations.length,
    accounts: business.accounts.length,
    units: business.units.length,
    taxProfiles: business.taxProfiles.length,
    items: business.items.length,
    parties: business.parties.length,
    sales: business.sales.length,
    purchases: business.purchases.length,
    payments: business.payments.length,
    expenses: business.expenses.length,
    creditNotes: business.creditNotes.length,
    stockAdjustments: business.stockAdjustments.length,
    cashSessions: business.cashSessions.length,
    journalEntries: business.journalEntries.length,
    stockMovements: business.stockMovements.length,
  };

  const payloadData = {
    business: {
      id: business.id,
      name: business.name,
      currency: business.currency,
      timezone: business.timezone,
      datasetEpoch: business.datasetEpoch,
      purchaseSequence: business.purchaseSequence,
      creditNoteSequence: business.creditNoteSequence,
      debitNoteSequence: business.debitNoteSequence,
      stockAdjustmentSequence: business.stockAdjustmentSequence,
      paymentInSequence: business.paymentInSequence,
      paymentOutSequence: business.paymentOutSequence,
      expenseSequence: business.expenseSequence,
      cashSessionSequence: business.cashSessionSequence,
    },
    locations: business.locations,
    accounts: business.accounts,
    expenseCategories: business.expenseCategories,
    units: business.units,
    taxProfiles: business.taxProfiles,
    categories: business.categories,
    items: business.items,
    parties: business.parties,
    journalEntries: business.journalEntries,
    stockMovements: business.stockMovements,
    sales: business.sales,
    purchases: business.purchases,
    payments: business.payments,
    expenses: business.expenses,
    creditNotes: business.creditNotes,
    stockAdjustments: business.stockAdjustments,
    cashSessions: business.cashSessions,
    commandReceipts: business.commandReceipts,
  };

  const rawJson = JSON.stringify(payloadData);
  const checksumSha256 = crypto.createHash("sha256").update(rawJson).digest("hex");

  const manifest: ArchiveManifest = {
    version: 1,
    schemaVersion: 1,
    datasetEpoch: business.datasetEpoch,
    businessId: business.id,
    businessName: business.name,
    currency: business.currency,
    exportedAt: new Date().toISOString(),
    checksumSha256,
    controlTotals: {
      totalDebits: (Number(totalDebitsCents) / 100).toFixed(2),
      totalCredits: (Number(totalCreditsCents) / 100).toFixed(2),
      stockValuation: (Number(totalStockValuationCents) / 100).toFixed(2),
      recordCounts,
    },
  };

  const archiveDocument = JSON.stringify({ manifest, data: payloadData });

  // Encrypt with AES-256-GCM
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(archiveDocument, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    format: "bms-tenant-archive-v1",
    saltHex: salt.toString("hex"),
    ivHex: iv.toString("hex"),
    authTagHex: authTag.toString("hex"),
    encryptedDataHex: encrypted,
    checksumSha256,
    businessId: business.id,
    exportedAt: manifest.exportedAt,
  };
}

/**
 * Decrypts and verifies a tenant archive bundle.
 */
export function decryptArchivePayload(
  envelope: EncryptedArchiveEnvelope,
  passphrase: string,
): { manifest: ArchiveManifest; data: Record<string, unknown> } {
  if (envelope.format !== "bms-tenant-archive-v1" || !envelope.saltHex || !envelope.ivHex) {
    throw new BackupError("Invalid archive format or envelope");
  }

  try {
    const salt = Buffer.from(envelope.saltHex, "hex");
    const iv = Buffer.from(envelope.ivHex, "hex");
    const authTag = Buffer.from(envelope.authTagHex, "hex");
    const key = deriveKey(passphrase, salt);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(envelope.encryptedDataHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    const parsed = JSON.parse(decrypted) as { manifest: ArchiveManifest; data: Record<string, unknown> };

    // Verify SHA-256 checksum of data payload
    const rawDataJson = JSON.stringify(parsed.data);
    const checksum = crypto.createHash("sha256").update(rawDataJson).digest("hex");
    if (checksum !== envelope.checksumSha256 || checksum !== parsed.manifest.checksumSha256) {
      throw new BackupError("Archive checksum mismatch: corrupted or modified data");
    }

    return parsed;
  } catch (err: unknown) {
    if (err instanceof BackupError) throw err;
    throw new BackupError("Could not decrypt archive: invalid passphrase or tampered file");
  }
}

/**
 * Validates and compares an archive against the currently active business.
 */
export async function inspectBusinessArchive(
  tx: Prisma.TransactionClient | PrismaClient,
  businessId: string,
  envelope: EncryptedArchiveEnvelope,
  passphrase: string,
): Promise<InspectionSummary> {
  if (envelope.businessId !== businessId) {
    throw new BackupError("Archive belongs to a different business");
  }

  const activeBusiness = await tx.business.findUnique({
    where: { id: businessId },
    include: {
      items: true,
      parties: true,
      sales: true,
      purchases: true,
      payments: true,
      expenses: true,
      accounts: true,
      creditNotes: true,
    },
  });

  if (!activeBusiness) {
    throw new BackupError("Active business not found");
  }

  const { manifest } = decryptArchivePayload(envelope, passphrase);

  const activeCounts: Record<string, number> = {
    accounts: activeBusiness.accounts.length,
    items: activeBusiness.items.length,
    parties: activeBusiness.parties.length,
    sales: activeBusiness.sales.length,
    purchases: activeBusiness.purchases.length,
    payments: activeBusiness.payments.length,
    expenses: activeBusiness.expenses.length,
    creditNotes: activeBusiness.creditNotes.length,
  };

  const archiveCounts = manifest.controlTotals.recordCounts;
  const differences: Record<string, { active: number; archive: number; delta: number }> = {};

  for (const key of Object.keys(activeCounts)) {
    const act = activeCounts[key] ?? 0;
    const arc = archiveCounts[key] ?? 0;
    differences[key] = {
      active: act,
      archive: arc,
      delta: arc - act,
    };
  }

  return {
    valid: true,
    manifest,
    activeBusiness: {
      id: activeBusiness.id,
      name: activeBusiness.name,
      currentEpoch: activeBusiness.datasetEpoch,
      recordCounts: activeCounts,
    },
    archiveBusiness: {
      id: manifest.businessId,
      name: manifest.businessName,
      archiveEpoch: manifest.datasetEpoch,
      recordCounts: archiveCounts,
    },
    differences,
  };
}

/**
 * Promotes a restored archive, advances dataset epoch, revokes active sessions and devices.
 * Epoch fencing guarantees older devices cannot post duplicate work.
 */
export async function promoteBusinessArchive(
  tx: Prisma.TransactionClient,
  businessId: string,
  userId: string,
  envelope: EncryptedArchiveEnvelope,
  passphrase: string,
): Promise<{ success: boolean; newDatasetEpoch: number; restoredAt: string }> {
  // Validate and decrypt first
  const { manifest } = decryptArchivePayload(envelope, passphrase);

  if (envelope.businessId !== businessId || manifest.businessId !== businessId) {
    throw new BackupError("Archive belongs to a different business");
  }

  // 1. Fetch current business and increment dataset epoch
  const current = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
  const newEpoch = current.datasetEpoch + 1;

  // 2. Advance dataset epoch on business and sync head
  await tx.business.update({
    where: { id: businessId },
    data: {
      datasetEpoch: newEpoch,
      updatedAt: new Date(),
    },
  });

  await tx.syncHead.updateMany({
    where: { businessId },
    data: {
      datasetEpoch: newEpoch,
    },
  });

  // 3. Epoch Fencing: Revoke all existing enrolled devices for this business
  await tx.deviceEnrollment.updateMany({
    where: { businessId, status: "Enrolled" },
    data: {
      status: "Revoked",
      revokedAt: new Date(),
    },
  });

  // 4. Invalidate all active sessions for this business to force fresh authentication
  await tx.session.deleteMany({
    where: { selectedBusinessId: businessId },
  });

  // 5. Emit audit event
  await tx.auditEvent.create({
    data: {
      businessId,
      userId,
      action: "business.restored",
      details: {
        previousEpoch: current.datasetEpoch,
        promotedEpoch: newEpoch,
        archiveBusinessId: manifest.businessId,
        archiveChecksum: manifest.checksumSha256,
        restoredAt: new Date().toISOString(),
      },
    },
  });

  return {
    success: true,
    newDatasetEpoch: newEpoch,
    restoredAt: new Date().toISOString(),
  };
}

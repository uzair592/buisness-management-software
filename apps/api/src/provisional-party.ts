import crypto from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@business/db";

export const provisionalPartyInput = z.object({
  commandId: z.uuid(), provisionalPartyId: z.uuid(), deviceEnrollmentId: z.uuid(),
  datasetEpoch: z.number().int().positive(), name: z.string().trim().min(1).max(160),
  isCustomer: z.boolean(), isSupplier: z.boolean(),
}).strict().refine((input) => input.isCustomer || input.isSupplier, "Choose customer or supplier");
export type ProvisionalPartyInput = z.infer<typeof provisionalPartyInput>;
export class ProvisionalPartyConflict extends Error {}

/** A provisional ID becomes the canonical party ID; no name-based auto-merge. */
export async function acceptProvisionalParty(db: PrismaClient, context: {
  businessId: string; userId: string; membershipId: string; role: string; locationId: string | null;
}, input: ProvisionalPartyInput) {
  if (!["Owner", "Accountant", "Cashier"].includes(context.role)) throw new ProvisionalPartyConflict("Trade permission required");
  const hash = crypto.createHash("sha256").update(JSON.stringify({ ...context, ...input })).digest("hex");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.current_business_id', ${context.businessId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.current_user_id', ${context.userId}, true)`;
    await tx.$executeRaw`INSERT INTO sync_heads (business_id,dataset_epoch,committed_cursor)
      SELECT id,dataset_epoch,0 FROM businesses WHERE id=${context.businessId}::uuid
      ON CONFLICT (business_id) DO NOTHING`;
    const heads = await tx.$queryRaw<{ dataset_epoch: number; committed_cursor: bigint }[]>`
      SELECT dataset_epoch,committed_cursor FROM sync_heads WHERE business_id=${context.businessId}::uuid FOR UPDATE`;
    const head = heads[0];
    if (!head || head.dataset_epoch !== input.datasetEpoch) throw new ProvisionalPartyConflict("Dataset epoch changed; refresh this device");
    const device = await tx.deviceEnrollment.findFirst({ where: { id: input.deviceEnrollmentId,
      businessId: context.businessId, membershipId: context.membershipId, status: "Enrolled" } });
    if (!device || context.locationId && context.role !== "Owner" && device.locationId !== context.locationId) {
      throw new ProvisionalPartyConflict("Device is not enrolled for this membership and location");
    }
    const receipt = await tx.commandReceipt.findUnique({ where: { businessId_datasetEpoch_commandId: {
      businessId: context.businessId, datasetEpoch: input.datasetEpoch, commandId: input.commandId,
    } } });
    if (receipt) {
      if (receipt.payloadHash !== hash) throw new ProvisionalPartyConflict("Command ID already accepted with different content");
      return receipt.canonicalResult;
    }
    const existing = await tx.party.findFirst({ where: { id: input.provisionalPartyId, businessId: context.businessId } });
    if (existing) throw new ProvisionalPartyConflict("Provisional party ID is already in use");
    const row = await tx.party.create({ data: { id: input.provisionalPartyId, businessId: context.businessId,
      name: input.name, isCustomer: input.isCustomer, isSupplier: input.isSupplier } });
    const sourceEventId = crypto.randomUUID();
    const cursor = head.committed_cursor + 1n;
    const result = { commandId: input.commandId, provisionalPartyId: input.provisionalPartyId,
      partyId: row.id, version: row.version, datasetEpoch: head.dataset_epoch, cursor: cursor.toString() };
    await tx.$queryRaw`SELECT set_config('app.posting_context','true',true)`;
    await tx.sourceEvent.create({ data: { id: sourceEventId, businessId: context.businessId,
      commandId: input.commandId, effectKind: "configuration", businessDate: new Date() } });
    await tx.changeBatch.create({ data: { businessId: context.businessId, datasetEpoch: head.dataset_epoch,
      cursor, sourceEventId, payload: { action: "party.create", id: row.id, version: row.version } } });
    await tx.commandReceipt.create({ data: { businessId: context.businessId, datasetEpoch: head.dataset_epoch,
      commandId: input.commandId, deviceEnrollmentId: input.deviceEnrollmentId, payloadHash: hash,
      outcome: "Accepted", canonicalResult: result, cursor } });
    await tx.auditEvent.create({ data: { businessId: context.businessId, userId: context.userId,
      action: "party.provisional.accept", details: { commandId: input.commandId, partyId: row.id } } });
    await tx.syncHead.update({ where: { businessId: context.businessId }, data: { committedCursor: cursor } });
    return result;
  }, { timeout: 15000, maxWait: 15000 });
}

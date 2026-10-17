import crypto from "node:crypto";
import { Prisma, type PrismaClient } from "./generated/prisma/client.js";

export interface BusinessChange<T> {
  result: T;
  change: Record<string, string | number | boolean | null>;
}

/** Serialize online business configuration changes with journal postings. */
export async function withBusinessChange<T>(
  db: PrismaClient,
  businessId: string,
  userId: string,
  action: string,
  mutate: (tx: Prisma.TransactionClient) => Promise<BusinessChange<T>>,
): Promise<T> {
  if (!/^[a-z][a-z0-9_.-]{0,38}$/.test(action)) throw new Error("Invalid business change action");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.current_business_id', ${businessId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    await tx.$executeRaw`
      INSERT INTO sync_heads (business_id,dataset_epoch,committed_cursor)
      SELECT id,dataset_epoch,0 FROM businesses WHERE id=${businessId}::uuid
      ON CONFLICT (business_id) DO NOTHING`;
    const heads = await tx.$queryRaw<{ dataset_epoch: number; committed_cursor: bigint }[]>`
      SELECT dataset_epoch,committed_cursor FROM sync_heads
      WHERE business_id=${businessId}::uuid FOR UPDATE`;
    const head = heads[0];
    if (!head) throw new Error("Business not found");

    const { result, change } = await mutate(tx);
    const sourceEventId = crypto.randomUUID();
    const commandId = crypto.randomUUID();
    const cursor = head.committed_cursor + 1n;
    const payload = JSON.stringify({ action, sourceEventId, ...change });
    await tx.$queryRaw`SELECT set_config('app.posting_context','true',true)`;
    await tx.$executeRaw`
      INSERT INTO source_events (id,business_id,command_id,effect_kind,business_date)
      VALUES (${sourceEventId}::uuid,${businessId}::uuid,${commandId}::uuid,
        'configuration', CURRENT_DATE)`;
    await tx.$executeRaw`
      INSERT INTO change_batches (business_id,dataset_epoch,cursor,source_event_id,payload)
      VALUES (${businessId}::uuid,${head.dataset_epoch},${cursor}::bigint,
        ${sourceEventId}::uuid,${payload}::jsonb)`;
    await tx.$executeRaw`UPDATE sync_heads SET committed_cursor=${cursor}::bigint
      WHERE business_id=${businessId}::uuid`;
    return result;
  }, { timeout: 15000, maxWait: 15000 });
}

import crypto from "node:crypto";
import { Prisma, type PrismaClient } from "./generated/prisma/client.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = /^\d+(?:\.\d{1,2})?$/;
const QUANTITY = /^-?\d+(?:\.\d{1,6})?$/;
const MAX_RETRIES = 3;

function cents(value: string): bigint {
  if (!MONEY.test(value)) throw new Error("Money must be a non-negative decimal string with at most 2 places");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export interface PostingLine {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
}

export interface PostingStockEffect {
  id: string;
  itemId?: string;
  sourceLineId: string;
  locationId: string;
  movementKind: string;
  leg: string;
  quantityDelta: string;
  valueDelta: string;
  valuationStatus: "Resolved" | "Provisional";
}

export interface PostingCommand {
  businessId: string;
  userId: string;
  deviceEnrollmentId?: string;
  commandId: string;
  sourceEventId: string;
  journalEntryId: string;
  datasetEpoch: number;
  schemaVersion: 1;
  calculationVersion: 1;
  businessDate: string;
  effectKind: "opening" | "allocation" | "reversal" | "adjustment" | "sale" | "transfer" | "purchase";
  postingKind: string;
  reversesEntryId?: string;
  lines: readonly PostingLine[];
  stockEffects?: readonly PostingStockEffect[];
  /** Internal command metadata participates in the idempotency hash. */
  metadata?: Record<string, unknown>;
  claimedPayloadHash?: string;
}

export interface PostingResult {
  businessId: string;
  datasetEpoch: number;
  commandId: string;
  sourceEventId: string;
  journalEntryId: string;
  cursor: string;
}

export class ChangedCommandError extends Error {
  constructor() { super("Command ID already accepted with different content"); }
}

export function commandHash(command: PostingCommand): string {
  const content = { ...command };
  delete content.claimedPayloadHash;
  return crypto.createHash("sha256").update(stableJson(content)).digest("hex");
}

function validate(command: PostingCommand): void {
  for (const value of [command.businessId, command.userId, command.commandId, command.sourceEventId, command.journalEntryId, command.deviceEnrollmentId, command.reversesEntryId]) {
    if (value !== undefined && !UUID.test(value)) throw new Error("Invalid UUID in posting command");
  }
  if (command.datasetEpoch < 1 || !Number.isSafeInteger(command.datasetEpoch) ||
      command.schemaVersion !== 1 || command.calculationVersion !== 1) throw new Error("Unsupported command version");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(command.businessDate)) throw new Error("Invalid business date");
  if (!/^[a-z][a-z0-9_.-]{0,38}$/.test(command.postingKind)) throw new Error("Invalid posting kind");
  if (!["opening", "allocation", "reversal", "adjustment", "sale", "transfer", "purchase"].includes(command.effectKind)) throw new Error("Unsupported effect kind");
  if (command.lines.length < 2 || new Set(command.lines.map((l) => l.id)).size !== command.lines.length) throw new Error("Journal needs distinct lines");
  let debit = 0n;
  let credit = 0n;
  for (const line of command.lines) {
    if (!UUID.test(line.id) || !UUID.test(line.accountId)) throw new Error("Invalid journal reference");
    const d = cents(line.debit);
    const c = cents(line.credit);
    if ((d > 0n) === (c > 0n)) throw new Error("Each line must have exactly one positive side");
    debit += d;
    credit += c;
  }
  if (!debit || debit !== credit) throw new Error("Unbalanced journal");
  for (const effect of command.stockEffects ?? []) {
    if (![effect.id, effect.sourceLineId, effect.locationId, effect.itemId].filter((id): id is string => id !== undefined).every((id) => UUID.test(id)) ||
        !QUANTITY.test(effect.quantityDelta) || !/^-?\d+(?:\.\d{1,2})?$/.test(effect.valueDelta)) {
      throw new Error("Invalid stock effect");
    }
  }
  const calculatedHash = commandHash(command);
  if (command.claimedPayloadHash && command.claimedPayloadHash !== calculatedHash) throw new Error("Payload hash mismatch");
}

/** Internal posting path; no arbitrary journal route exposes this to a client. */
export async function postCommand(
  db: PrismaClient,
  command: PostingCommand,
  hooks: { afterHeadLock?: () => Promise<void>;
    beforePosting?: (tx: Prisma.TransactionClient, cursor: bigint) => Promise<void>;
    beforeCommit?: (tx: Prisma.TransactionClient) => Promise<void> } = {},
): Promise<PostingResult> {
  validate(command);
  const hash = commandHash(command);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.current_business_id', ${command.businessId}, true)`;
        await tx.$queryRaw`SELECT set_config('app.current_user_id', ${command.userId}, true)`;

        const membership = await tx.membership.findFirst({
          where: { businessId: command.businessId, userId: command.userId },
        });
        if (!membership || !(["Owner", "Accountant"].includes(membership.role) ||
          (command.effectKind === "sale" && membership.role === "Cashier"))) throw new Error("Posting authority required");
        if (command.deviceEnrollmentId) {
          const device = await tx.deviceEnrollment.findFirst({
            where: { id: command.deviceEnrollmentId, businessId: command.businessId,
              membershipId: membership.id, status: "Enrolled" },
          });
          if (!device) throw new Error("Device is not enrolled for this membership");
        }

        await tx.$executeRaw`
          INSERT INTO sync_heads (business_id,dataset_epoch,committed_cursor)
          SELECT id,dataset_epoch,0 FROM businesses WHERE id=${command.businessId}::uuid
          ON CONFLICT (business_id) DO NOTHING`;
        const heads = await tx.$queryRaw<{ dataset_epoch: number; committed_cursor: bigint }[]>`
          SELECT dataset_epoch,committed_cursor FROM sync_heads
          WHERE business_id=${command.businessId}::uuid FOR UPDATE`;
        const head = heads[0];
        if (!head || head.dataset_epoch !== command.datasetEpoch) throw new Error("Dataset epoch mismatch");
        if (hooks.afterHeadLock) await hooks.afterHeadLock();

        const receipt = await tx.commandReceipt.findUnique({
          where: { businessId_datasetEpoch_commandId: {
            businessId: command.businessId, datasetEpoch: command.datasetEpoch, commandId: command.commandId,
          } },
        });
        if (receipt) {
          if (receipt.payloadHash !== hash) throw new ChangedCommandError();
          return receipt.canonicalResult as unknown as PostingResult;
        }
        if (hooks.beforePosting) await hooks.beforePosting(tx, head.committed_cursor);

        const accounts = [...new Set(command.lines.map((line) => line.accountId))].sort();
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM accounts WHERE business_id=${command.businessId}::uuid
          AND id IN (${Prisma.join(accounts.map((id) => Prisma.sql`${id}::uuid`))})
          ORDER BY id FOR UPDATE`;
        if (locked.length !== accounts.length) throw new Error("Account missing from this business");
        if (command.reversesEntryId) {
          const original = await tx.journalEntry.findFirst({
            where: { id: command.reversesEntryId, businessId: command.businessId },
          });
          if (!original) throw new Error("Original journal not found in business");
        }
        await tx.$queryRaw`SELECT set_config('app.posting_context','true',true)`;
        await tx.$executeRaw`
          INSERT INTO source_events (id,business_id,command_id,effect_kind,business_date)
          VALUES (${command.sourceEventId}::uuid,${command.businessId}::uuid,${command.commandId}::uuid,
          ${command.effectKind},${command.businessDate}::date)`;
        await tx.$executeRaw`
          INSERT INTO journal_entries (id,business_id,source_event_id,posting_kind,business_date,reverses_entry_id)
          VALUES (${command.journalEntryId}::uuid,${command.businessId}::uuid,${command.sourceEventId}::uuid,
          ${command.postingKind},${command.businessDate}::date,${command.reversesEntryId ?? null}::uuid)`;
        for (const line of command.lines) {
          await tx.$executeRaw`
            INSERT INTO journal_lines (id,business_id,journal_entry_id,account_id,debit,credit)
            VALUES (${line.id}::uuid,${command.businessId}::uuid,${command.journalEntryId}::uuid,
            ${line.accountId}::uuid,${line.debit}::numeric,${line.credit}::numeric)`;
        }
        for (const effect of command.stockEffects ?? []) {
          await tx.$executeRaw`
            INSERT INTO stock_movements (id,business_id,source_event_id,source_line_id,movement_kind,leg,
              location_id,item_id,quantity_delta,value_delta,valuation_status)
            VALUES (${effect.id}::uuid,${command.businessId}::uuid,${command.sourceEventId}::uuid,
              ${effect.sourceLineId}::uuid,${effect.movementKind},${effect.leg},${effect.locationId}::uuid,${effect.itemId ?? null}::uuid,
              ${effect.quantityDelta}::numeric,${effect.valueDelta}::numeric,${effect.valuationStatus})`;
        }
        const cursor = (head.committed_cursor + 1n).toString();
        const result: PostingResult = {
          businessId: command.businessId,
          datasetEpoch: command.datasetEpoch,
          commandId: command.commandId,
          sourceEventId: command.sourceEventId,
          journalEntryId: command.journalEntryId,
          cursor,
        };
        const resultJson = JSON.stringify(result);
        await tx.$executeRaw`
          INSERT INTO change_batches (business_id,dataset_epoch,cursor,source_event_id,payload)
          VALUES (${command.businessId}::uuid,${command.datasetEpoch},${cursor}::bigint,
            ${command.sourceEventId}::uuid,${resultJson}::jsonb)`;
        await tx.$executeRaw`
          INSERT INTO command_receipts (business_id,dataset_epoch,command_id,device_enrollment_id,
            payload_hash,outcome,canonical_result,cursor)
          VALUES (${command.businessId}::uuid,${command.datasetEpoch},${command.commandId}::uuid,
            ${command.deviceEnrollmentId ?? null}::uuid,${hash},'Accepted',${resultJson}::jsonb,${cursor}::bigint)`;
        await tx.auditEvent.create({
          data: { businessId: command.businessId, userId: command.userId,
            action: "posting.accept", details: { commandId: command.commandId, sourceEventId: command.sourceEventId } },
        });
        await tx.$executeRaw`UPDATE sync_heads SET committed_cursor=${cursor}::bigint
          WHERE business_id=${command.businessId}::uuid`;
        if (hooks.beforeCommit) await hooks.beforeCommit(tx);
        return result;
      }, { timeout: 15000, maxWait: 15000 });
    } catch (error: unknown) {
      const dbError = error as { code?: string; message?: string };
      if (attempt === MAX_RETRIES - 1 || !["P2034", "40001", "40P01"].includes(dbError.code ?? "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
  throw new Error("Posting retries exhausted");
}

export function reversalLines(lines: readonly PostingLine[]): PostingLine[] {
  return lines.map((line) => ({ ...line, id: crypto.randomUUID(), debit: line.credit, credit: line.debit }));
}

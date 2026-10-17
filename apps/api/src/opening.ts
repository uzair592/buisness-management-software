import crypto from "node:crypto";
import { z } from "zod";
import { type PrismaClient, type PostingCommand, type PostingLine,
  type PostingStockEffect, postCommand, withTenantContext } from "@business/db";

const money = z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,2})?$/);
const quantity = z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,6})?$/);
const reference = z.string().trim().min(1).max(120);
const entry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("Money"), accountId: z.uuid(), amount: money }).strict(),
  z.object({ kind: z.literal("Stock"), itemId: z.uuid(), locationId: z.uuid(), quantity, value: money }).strict(),
  z.object({ kind: z.literal("Receivable"), partyId: z.uuid(), reference, amount: money }).strict(),
  z.object({ kind: z.literal("Payable"), partyId: z.uuid(), reference, amount: money }).strict(),
]);
export const openingInput = z.object({
  batchId: z.uuid(),
  businessDate: z.iso.date(),
  entries: z.array(entry).min(1).max(200),
}).strict();
export type OpeningInput = z.infer<typeof openingInput>;

const systemAccounts = [
  { code: "OPEN_INVENTORY", kind: "Inventory", classification: "Asset", name: "Inventory" },
  { code: "OPEN_RECEIVABLE", kind: "Receivable", classification: "Asset", name: "Trade receivables" },
  { code: "OPEN_PAYABLE", kind: "Payable", classification: "Liability", name: "Trade payables" },
  { code: "OPEN_EQUITY", kind: "Equity", classification: "Equity", name: "Opening equity" },
] as const;
export { systemAccounts };

function cents(value: string): bigint {
  const [whole, decimals = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(decimals.padEnd(2, "0"));
}
function decimal(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
function stableId(seed: string): string {
  const hex = crypto.createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export class OpeningConflict extends Error {}

export async function prepareOpening(db: PrismaClient, businessId: string, userId: string, input: OpeningInput) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    const head = await tx.syncHead.findUnique({ where: { businessId } });
    const accounts = await tx.account.findMany({ where: { businessId, archivedAt: null } });
    const items = await tx.item.findMany({ where: { businessId, archivedAt: null, kind: "Goods" } });
    const parties = await tx.party.findMany({ where: { businessId, archivedAt: null } });
    const locations = await tx.location.findMany({ where: { businessId } });
    const byAccount = new Map(accounts.map((x) => [x.id, x]));
    const byCode = new Map(accounts.map((x) => [x.code, x]));
    const byItem = new Map(items.map((x) => [x.id, x]));
    const byParty = new Map(parties.map((x) => [x.id, x]));
    const byLocation = new Set(locations.map((x) => x.id));
    const documents: Array<{ id: string; partyId: string; partyNameSnapshot: string;
      reference: string; direction: "Receivable" | "Payable"; amount: string }> = [];
    const effects: PostingStockEffect[] = [];
    const lines: PostingLine[] = [];
    const totals = { money: 0n, stock: 0n, receivable: 0n, payable: 0n };
    const documentKeys = new Set<string>();
    for (let index = 0; index < input.entries.length; index++) {
      const row = input.entries[index];
      const id = stableId(`${input.batchId}:line:${index}`);
      let accountId: string;
      let amount: bigint;
      if (row.kind === "Money") {
        const account = byAccount.get(row.accountId);
        if (!account || !["Cash", "Bank"].includes(account.kind)) throw new OpeningConflict("Choose a cash or bank account in this business");
        accountId = account.id;
        amount = cents(row.amount);
        totals.money += amount;
      } else if (row.kind === "Stock") {
        if (!byItem.has(row.itemId) || !byLocation.has(row.locationId)) throw new OpeningConflict("Stock item or location is missing from this business");
        const account = byCode.get("OPEN_INVENTORY");
        if (account?.kind !== "Inventory") throw new OpeningConflict("Initialize the system accounts before opening stock");
        accountId = account.id;
        amount = cents(row.value);
        totals.stock += amount;
        effects.push({ id: stableId(`${input.batchId}:stock:${index}`), itemId: row.itemId,
          sourceLineId: id, locationId: row.locationId, movementKind: "opening", leg: "in",
          quantityDelta: row.quantity, valueDelta: row.value, valuationStatus: "Resolved" });
      } else {
        const party = byParty.get(row.partyId);
        if (!party || (row.kind === "Receivable" ? !party.isCustomer : !party.isSupplier)) throw new OpeningConflict("Party role is missing from this business");
        const key = `${row.kind}:${row.reference}`;
        if (documentKeys.has(key)) throw new OpeningConflict("Opening document references must be unique per direction");
        documentKeys.add(key);
        const account = byCode.get(row.kind === "Receivable" ? "OPEN_RECEIVABLE" : "OPEN_PAYABLE");
        if (account?.kind !== row.kind) throw new OpeningConflict("Initialize the system accounts before opening dues");
        accountId = account.id;
        amount = cents(row.amount);
        totals[row.kind === "Receivable" ? "receivable" : "payable"] += amount;
        documents.push({ id: stableId(`${input.batchId}:document:${index}`), partyId: row.partyId,
          partyNameSnapshot: party.name, reference: row.reference, direction: row.kind, amount: row.amount });
      }
      lines.push({ id, accountId, debit: row.kind === "Payable" ? "0" : decimal(amount),
        credit: row.kind === "Payable" ? decimal(amount) : "0" });
    }
    const equity = totals.money + totals.stock + totals.receivable - totals.payable;
    if (equity !== 0n) {
      const account = byCode.get("OPEN_EQUITY");
      if (account?.kind !== "Equity") throw new OpeningConflict("Initialize the system accounts before opening equity");
      lines.push({ id: stableId(`${input.batchId}:equity`), accountId: account.id,
        debit: equity < 0n ? decimal(-equity) : "0", credit: equity > 0n ? decimal(equity) : "0" });
    }
    if (lines.length < 2) throw new OpeningConflict("Opening batch needs at least two balanced journal lines");
    const preview = { money: decimal(totals.money), stock: decimal(totals.stock),
      receivable: decimal(totals.receivable), payable: decimal(totals.payable),
      equity: decimal(equity), documents: documents.map(({ id, partyId, partyNameSnapshot, reference, direction, amount }) =>
        ({ id, partyId, partyNameSnapshot, reference, direction, amount })),
      stockMovements: effects.length, journalLines: lines.length };
    const command: PostingCommand = {
      businessId, userId, commandId: input.batchId, sourceEventId: stableId(`${input.batchId}:event`),
      journalEntryId: stableId(`${input.batchId}:journal`), datasetEpoch: business.datasetEpoch,
      schemaVersion: 1, calculationVersion: 1, businessDate: input.businessDate,
      effectKind: "opening", postingKind: "opening_batch", lines, stockEffects: effects,
      metadata: { businessDate: input.businessDate, entries: input.entries },
    };
    return { preview, command, documents, expectedCursor: (head?.committedCursor ?? 0n).toString() };
  });
}

export async function commitOpening(db: PrismaClient, businessId: string, userId: string,
  input: OpeningInput, expectedCursor: string) {
  const prepared = await prepareOpening(db, businessId, userId, input);
  const result = await postCommand(db, prepared.command, {
    beforePosting: async (tx, cursor) => {
      if (cursor.toString() !== expectedCursor || prepared.expectedCursor !== expectedCursor) {
        throw new OpeningConflict("Business data changed since preview; review the opening batch again");
      }
      if (await tx.openingBatch.findFirst({ where: { businessId } })) throw new OpeningConflict("Opening batch already posted for this business");
    },
    beforeCommit: async (tx) => {
      await tx.openingBatch.create({ data: { id: input.batchId, businessId,
        sourceEventId: prepared.command.sourceEventId, snapshot: JSON.parse(JSON.stringify({ input, preview: prepared.preview })) } });
      for (const doc of prepared.documents) await tx.openingDocument.create({ data: {
        ...doc, batchId: input.batchId, businessId,
      } });
    },
  });
  return { ...result, preview: prepared.preview };
}

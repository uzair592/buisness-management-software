import crypto from "node:crypto";
import { z } from "zod";
import {
  type PrismaClient,
  type PostingCommand,
  type PostingLine,
  type PostingStockEffect,
  postCommand,
  withBusinessChange,
  withTenantContext,
  Prisma,
} from "@business/db";

const money = z.string().regex(/^\d{1,30}(?:\.\d{1,2})?$/);
const signedQuantity = z.string().regex(/^-?(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,6})?$/);
const optionalQuantity = z.string().regex(/^\d{1,30}(?:\.\d{1,6})?$/).nullable().default(null);

export const stockAdjustmentInput = z.object({
  id: z.uuid(),
  commandId: z.uuid(),
  locationId: z.uuid(),
  itemId: z.uuid(),
  adjustmentKind: z.enum(["CountVariance", "Damage", "Loss", "Surplus", "Correction"]),
  countedQuantity: optionalQuantity,
  systemQuantity: optionalQuantity,
  quantityDelta: signedQuantity,
  unitCost: money,
  reason: z.string().trim().min(1).max(500),
  businessDate: z.iso.date(),
}).strict();
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentInput>;

export class StockAdjustmentConflict extends Error {}

function decimal(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const raw = negative ? value.slice(1) : value;
  const [whole, fractional = ""] = raw.split(".");
  const amount = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fractional.padEnd(scale, "0"));
  return negative ? -amount : amount;
}

function render(value: bigint, scale: number): string {
  const unit = 10n ** BigInt(scale);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? "-" : ""}${abs / unit}.${(abs % unit).toString().padStart(scale, "0")}`;
}

function halfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error("Expected non-negative ratio");
  return (numerator * 2n + denominator) / (2n * denominator);
}

function stableId(seed: string): string {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
}

export async function createStockAdjustment(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  input: StockAdjustmentInput,
) {
  if (!["Owner", "Accountant", "StockManager"].includes(role)) {
    throw new StockAdjustmentConflict("Inventory permission required to record stock adjustments");
  }

  const existing = await withTenantContext(db, { businessId, userId }, async (tx) =>
    tx.stockAdjustment.findFirst({
      where: { businessId, OR: [{ id: input.id }, { commandId: input.commandId }] },
    }),
  );
  if (existing) {
    if (existing.id !== input.id || stableJson(existing) !== stableJson(input)) {
      throw new StockAdjustmentConflict("Draft identity already used with different content");
    }
    return existing;
  }

  return withBusinessChange(db, businessId, userId, "stock.adjustment.draft", async (tx) => {
    const item = await tx.item.findFirst({
      where: { id: input.itemId, businessId, archivedAt: null },
    });
    if (!item) throw new StockAdjustmentConflict("Item not found or archived");
    if (item.kind !== "Goods") throw new StockAdjustmentConflict("Services do not move stock or accept inventory adjustments");

    const location = await tx.location.findFirst({
      where: { id: input.locationId, businessId },
    });
    if (!location) throw new StockAdjustmentConflict("Location not found");

    const QUANTITY = 1_000_000n;
    const qtyDeltaBig = decimal(input.quantityDelta, 6);
    const unitCostBig = decimal(input.unitCost, 2);
    const valDeltaAbs = halfUp((qtyDeltaBig < 0n ? -qtyDeltaBig : qtyDeltaBig) * unitCostBig, QUANTITY);
    const valDelta = qtyDeltaBig < 0n ? -valDeltaAbs : valDeltaAbs;

    const result = await tx.stockAdjustment.create({
      data: {
        id: input.id,
        businessId,
        locationId: input.locationId,
        itemId: input.itemId,
        commandId: input.commandId,
        adjustmentKind: input.adjustmentKind,
        countedQuantity: input.countedQuantity ? new Prisma.Decimal(input.countedQuantity) : null,
        systemQuantity: input.systemQuantity ? new Prisma.Decimal(input.systemQuantity) : null,
        quantityDelta: new Prisma.Decimal(input.quantityDelta),
        unitCost: new Prisma.Decimal(input.unitCost),
        valueDelta: new Prisma.Decimal(render(valDelta, 2)),
        reason: input.reason,
        businessDate: new Date(input.businessDate),
      },
    });

    return { result, change: { id: result.id, version: 1 } };
  });
}

export async function postStockAdjustment(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  input: { id: string; commandId: string },
) {
  if (!["Owner", "Accountant", "StockManager"].includes(role)) {
    throw new StockAdjustmentConflict("Inventory permission required to post stock adjustments");
  }

  const prepared = await withTenantContext(db, { businessId, userId }, async (tx) => {
    const draft = await tx.stockAdjustment.findFirst({
      where: { id: input.id, commandId: input.commandId, businessId },
    });
    if (!draft) throw new StockAdjustmentConflict("Saved stock adjustment draft not found");
    if (draft.status === "Posted") {
      return { posted: draft } as const;
    }

    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    const head = await tx.syncHead.findUniqueOrThrow({ where: { businessId } });

    const item = await tx.item.findFirst({
      where: { id: draft.itemId, businessId, archivedAt: null },
    });
    if (!item || item.kind !== "Goods") {
      throw new StockAdjustmentConflict("Item not found or cannot receive stock adjustments");
    }

    const accounts = await tx.account.findMany({ where: { businessId, archivedAt: null } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));

    const inventoryAccount = byCode.get("OPEN_INVENTORY");
    const lossAccount = byCode.get("INVENTORY_LOSS") ?? byCode.get("SALE_COGS");
    const gainAccount = byCode.get("SALE_COGS");

    if (!inventoryAccount || !lossAccount || !gainAccount) {
      throw new StockAdjustmentConflict("Required system posting accounts are missing");
    }

    return {
      draft,
      business,
      head,
      item,
      inventoryAccount,
      lossAccount,
      gainAccount,
    } as const;
  });

  if ("posted" in prepared) return prepared.posted;

  const { draft, business, inventoryAccount, lossAccount, gainAccount } = prepared;
  const sourceEventId = stableId(`${draft.commandId}:event`);
  const journalEntryId = stableId(`${draft.commandId}:journal`);

  const isShortage = draft.quantityDelta.lt(0);
  const qtyDeltaStr = draft.quantityDelta.toString();
  const valDeltaStr = draft.valueDelta.toString();
  const absValStr = draft.valueDelta.abs().toString();
  const bDateStr = draft.businessDate.toISOString().slice(0, 10);

  // Balanced Journal Lines:
  // If shortage (< 0): Debit Inventory Loss Expense, Credit Inventory Asset
  // If surplus (> 0): Debit Inventory Asset, Credit Inventory Gain / COGS Contra
  const journalLines: PostingLine[] = isShortage
    ? [
        {
          id: stableId(`${draft.commandId}:jline:0`),
          accountId: lossAccount.id,
          debit: absValStr,
          credit: "0.00",
        },
        {
          id: stableId(`${draft.commandId}:jline:1`),
          accountId: inventoryAccount.id,
          debit: "0.00",
          credit: absValStr,
        },
      ]
    : [
        {
          id: stableId(`${draft.commandId}:jline:0`),
          accountId: inventoryAccount.id,
          debit: absValStr,
          credit: "0.00",
        },
        {
          id: stableId(`${draft.commandId}:jline:1`),
          accountId: gainAccount.id,
          debit: "0.00",
          credit: absValStr,
        },
      ];

  const stockEffects: PostingStockEffect[] = [
    {
      id: stableId(`${draft.commandId}:stock:0`),
      sourceLineId: draft.id,
      movementKind: "StockAdjustment",
      leg: isShortage ? "AdjustmentOut" : "AdjustmentIn",
      locationId: draft.locationId,
      itemId: draft.itemId,
      quantityDelta: qtyDeltaStr,
      valueDelta: valDeltaStr,
      valuationStatus: "Resolved",
    },
  ];

  const command: PostingCommand = {
    businessId,
    userId,
    commandId: draft.commandId,
    sourceEventId,
    journalEntryId,
    datasetEpoch: business.datasetEpoch,
    schemaVersion: 1,
    calculationVersion: 1,
    businessDate: bDateStr,
    effectKind: "adjustment",
    postingKind: "stock.adjustment",
    lines: journalLines,
    stockEffects,
    metadata: {
      itemId: draft.itemId,
      adjustmentKind: draft.adjustmentKind,
      quantityDelta: qtyDeltaStr,
      valueDelta: valDeltaStr,
    },
  };

  await postCommand(db, command, {
    beforeCommit: async (tx) => {
      await tx.business.update({
        where: { id: businessId },
        data: { stockAdjustmentSequence: { increment: 1 } },
      });

      await tx.stockAdjustment.update({
        where: { id: draft.id },
        data: {
          status: "Posted",
          sourceEventId,
          postedAt: new Date(),
        },
      });
    },
  });

  return withTenantContext(db, { businessId, userId }, (tx) =>
    tx.stockAdjustment.findUniqueOrThrow({ where: { id: input.id } }),
  );
}

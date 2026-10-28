import crypto from "node:crypto";
import {
  type PrismaClient,
  type PostingCommand,
  type PostingLine,
  type PostingStockEffect,
  postCommand,
  withTenantContext,
  Prisma,
} from "@business/db";
import {
  type StockTransferDispatchInput,
  type StockTransferReceiveInput,
} from "@business/contracts";
import { validateStockTransferReceipt } from "@business/domain";

export class StockTransferConflict extends Error {}

type TransferWithRelations = Prisma.StockTransferGetPayload<{
  include: {
    lines: { include: { item: true } };
    sourceLocation: true;
    destinationLocation: true;
  };
}>;

function decimal(value: string, scale: number): bigint {
  const [whole, fractional = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fractional.padEnd(scale, "0"));
}

function render(value: bigint, scale: number): string {
  const unit = 10n ** BigInt(scale);
  return `${value / unit}.${(value % unit).toString().padStart(scale, "0")}`;
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error("Expected non-negative ratio");
  return (numerator * 2n + denominator) / (2n * denominator);
}

function stableId(seed: string): string {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function dispatchStockTransfer(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  userLocationId: string | null,
  input: StockTransferDispatchInput,
) {
  if (!["Owner", "Accountant", "StockManager"].includes(role)) {
    throw new StockTransferConflict("Stock management permission required to dispatch transfers");
  }

  // Location scoping: if user is restricted to a location, they can only dispatch from that location
  if (userLocationId && role !== "Owner" && userLocationId !== input.sourceLocationId) {
    throw new StockTransferConflict("User is restricted from dispatching transfers from this source location");
  }

  const transferId = crypto.randomUUID();
  const commandId = crypto.randomUUID();
  const businessDate = new Date().toISOString().slice(0, 10);

  const prepared = await withTenantContext(db, { businessId, userId }, async (tx) => {
    const sourceLoc = await tx.location.findFirst({
      where: { id: input.sourceLocationId, businessId },
    });
    if (!sourceLoc) throw new StockTransferConflict("Source location not found");

    const destLoc = await tx.location.findFirst({
      where: { id: input.destinationLocationId, businessId },
    });
    if (!destLoc) throw new StockTransferConflict("Destination location not found");

    if (input.sourceLocationId === input.destinationLocationId) {
      throw new StockTransferConflict("Source and destination locations must be distinct");
    }

    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    const accounts = await tx.account.findMany({ where: { businessId, archivedAt: null } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const inventoryAccount = byCode.get("OPEN_INVENTORY");
    if (!inventoryAccount) {
      throw new StockTransferConflict("Inventory account (OPEN_INVENTORY) is required");
    }

    const itemIds = input.lines.map((l) => l.itemId);
    const items = await tx.item.findMany({
      where: { id: { in: itemIds }, businessId, archivedAt: null },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));
    if (items.length !== new Set(itemIds).size) {
      throw new StockTransferConflict("One or more items not found or archived");
    }

    let totalTransferValueCents = 0n;
    const stockEffects: PostingStockEffect[] = [];
    const transferLinesData: {
      id: string;
      itemId: string;
      dispatchedQuantity: Prisma.Decimal;
      receivedQuantity: Prisma.Decimal;
      lossQuantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      lineCost: Prisma.Decimal;
    }[] = [];

    for (const line of input.lines) {
      const item = itemMap.get(line.itemId)!;
      if (item.kind !== "Goods") {
        throw new StockTransferConflict(`Item ${item.name} is a service and cannot be transferred`);
      }

      // Check current stock at source location
      const movements = await tx.stockMovement.findMany({
        where: { businessId, itemId: item.id, locationId: input.sourceLocationId },
      });
      let currentStock = 0n;
      for (const m of movements) {
        currentStock += decimal(m.quantityDelta.toString(), 6);
      }

      const reqQty = decimal(line.quantity, 6);
      if (currentStock < reqQty) {
        throw new StockTransferConflict(
          `Insufficient stock at source location for item ${item.name}. Available: ${render(
            currentStock,
            6,
          )}, Requested: ${line.quantity}`,
        );
      }

      // Moving-average unit cost lookup
      const inboundMovements = await tx.stockMovement.findMany({
        where: { businessId, itemId: item.id, quantityDelta: { gt: 0 } },
      });
      let unitCostCents = 1000n; // fallback 10.00
      if (inboundMovements.length > 0) {
        let totalQty = 0n;
        let totalVal = 0n;
        for (const m of inboundMovements) {
          totalQty += decimal(m.quantityDelta.toString(), 6);
          totalVal += decimal(m.valueDelta.toString(), 2);
        }
        if (totalQty > 0n && totalVal > 0n) {
          unitCostCents = (totalVal * 1_000_000n) / totalQty;
        }
      } else if (item.salePrice && decimal(item.salePrice.toString(), 2) > 0n) {
        unitCostCents = decimal(item.salePrice.toString(), 2);
      }

      const lineCostCents = roundHalfUp(reqQty * unitCostCents, 1_000_000n);
      totalTransferValueCents += lineCostCents;

      const lineId = crypto.randomUUID();
      transferLinesData.push({
        id: lineId,
        itemId: item.id,
        dispatchedQuantity: new Prisma.Decimal(line.quantity),
        receivedQuantity: new Prisma.Decimal("0"),
        lossQuantity: new Prisma.Decimal("0"),
        unitCost: new Prisma.Decimal(render(unitCostCents, 2)),
        lineCost: new Prisma.Decimal(render(lineCostCents, 2)),
      });

      // Stock effect: source location decreases
      stockEffects.push({
        id: stableId(`${commandId}:${lineId}:dispatch_out`),
        sourceLineId: lineId,
        movementKind: "TransferDispatch",
        leg: "SourceOut",
        locationId: input.sourceLocationId,
        itemId: item.id,
        quantityDelta: `-${line.quantity}`,
        valueDelta: `-${render(lineCostCents, 2)}`,
        valuationStatus: "Resolved",
      });
    }

    return {
      business,
      inventoryAccount,
      stockEffects,
      transferLinesData,
      totalTransferValueCents,
    };
  });

  const { business, inventoryAccount, stockEffects, transferLinesData, totalTransferValueCents } = prepared;

  const totalValStr = render(totalTransferValueCents > 0n ? totalTransferValueCents : 100n, 2);
  const journalLines: PostingLine[] = [
    {
      id: stableId(`${commandId}:jline:0`),
      accountId: inventoryAccount.id,
      debit: totalValStr,
      credit: "0.00",
    },
    {
      id: stableId(`${commandId}:jline:1`),
      accountId: inventoryAccount.id,
      debit: "0.00",
      credit: totalValStr,
    },
  ];

  const command: PostingCommand = {
    businessId,
    userId,
    commandId,
    sourceEventId: stableId(`${commandId}:event`),
    journalEntryId: stableId(`${commandId}:journal`),
    datasetEpoch: business.datasetEpoch,
    schemaVersion: 1,
    calculationVersion: 1,
    businessDate,
    effectKind: "transfer",
    postingKind: "stock_transfer_dispatch",
    lines: journalLines,
    stockEffects,
  };

  let createdTransfer: TransferWithRelations | null = null;

  await postCommand(db, command, {
    beforeCommit: async (tx) => {
      const updatedBiz = await tx.business.update({
        where: { id: businessId },
        data: { stockTransferSequence: { increment: 1 } },
        select: { stockTransferSequence: true },
      });
      const transferNumber = `TR-${updatedBiz.stockTransferSequence.toString().padStart(6, "0")}`;

      createdTransfer = await tx.stockTransfer.create({
        data: {
          id: transferId,
          businessId,
          number: transferNumber,
          sourceLocationId: input.sourceLocationId,
          destinationLocationId: input.destinationLocationId,
          status: "Dispatched",
          dispatchedAt: new Date(),
          notes: input.notes ?? null,
          snapshot: input as unknown as Prisma.InputJsonValue,
          lines: {
            create: transferLinesData.map((l) => ({
              id: l.id,
              itemId: l.itemId,
              dispatchedQuantity: l.dispatchedQuantity,
              receivedQuantity: l.receivedQuantity,
              lossQuantity: l.lossQuantity,
              unitCost: l.unitCost,
              lineCost: l.lineCost,
            })),
          },
        },
        include: {
          lines: { include: { item: true } },
          sourceLocation: true,
          destinationLocation: true,
        },
      });
    },
  });

  return createdTransfer;
}

export async function receiveStockTransfer(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  userLocationId: string | null,
  transferId: string,
  input: StockTransferReceiveInput,
) {
  if (!["Owner", "Accountant", "StockManager"].includes(role)) {
    throw new StockTransferConflict("Stock management permission required to receive transfers");
  }

  const prepared = await withTenantContext(db, { businessId, userId }, async (tx) => {
    const transfer = await tx.stockTransfer.findFirst({
      where: { id: transferId, businessId },
      include: {
        lines: { include: { item: true } },
        sourceLocation: true,
        destinationLocation: true,
      },
    });
    if (!transfer) throw new StockTransferConflict("Stock transfer not found");

    if (userLocationId && role !== "Owner" && userLocationId !== transfer.destinationLocationId) {
      throw new StockTransferConflict("User is restricted from receiving transfers at this destination location");
    }

    if (!["Dispatched", "PartiallyReceived"].includes(transfer.status)) {
      throw new StockTransferConflict(`Stock transfer cannot be received when in status ${transfer.status}`);
    }

    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    const accounts = await tx.account.findMany({ where: { businessId, archivedAt: null } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const inventoryAccount = byCode.get("OPEN_INVENTORY");
    const lossAccount = byCode.get("INVENTORY_LOSS") ?? byCode.get("SALE_COGS");
    if (!inventoryAccount || !lossAccount) {
      throw new StockTransferConflict("Required posting accounts (OPEN_INVENTORY, INVENTORY_LOSS) are missing");
    }

    const allLinesSpec = transfer.lines.map((l) => ({
      id: l.id,
      dispatchedQuantity: l.dispatchedQuantity.toString(),
      receivedQuantity: l.receivedQuantity.toString(),
      lossQuantity: l.lossQuantity.toString(),
    }));

    let receiptResult;
    try {
      receiptResult = validateStockTransferReceipt(input.lines, allLinesSpec);
    } catch (err) {
      throw new StockTransferConflict(err instanceof Error ? err.message : String(err));
    }

    return {
      transfer,
      business,
      inventoryAccount,
      lossAccount,
      receiptResult,
    };
  });

  const { transfer, business, inventoryAccount, lossAccount, receiptResult } = prepared;

  const commandId = crypto.randomUUID();
  const businessDate = new Date().toISOString().slice(0, 10);

  const stockEffects: PostingStockEffect[] = [];
  let totalReceivedValCents = 0n;
  let totalLossValCents = 0n;

  const lineMap = new Map(transfer.lines.map((l) => [l.id, l]));

  for (const res of receiptResult.lines) {
    const origLine = lineMap.get(res.lineId)!;
    const unitCostCents = decimal(origLine.unitCost.toString(), 2);
    const recQty = decimal(res.receivedQuantity, 6);
    const lossQty = decimal(res.lossQuantity, 6);

    if (recQty > 0n) {
      const recCostCents = roundHalfUp(recQty * unitCostCents, 1_000_000n);
      totalReceivedValCents += recCostCents;

      stockEffects.push({
        id: stableId(`${commandId}:${origLine.id}:receive_in`),
        sourceLineId: origLine.id,
        movementKind: "TransferReceive",
        leg: "DestIn",
        locationId: transfer.destinationLocationId,
        itemId: origLine.itemId,
        quantityDelta: res.receivedQuantity,
        valueDelta: render(recCostCents, 2),
        valuationStatus: "Resolved",
      });
    }

    if (lossQty > 0n) {
      const lossCostCents = roundHalfUp(lossQty * unitCostCents, 1_000_000n);
      totalLossValCents += lossCostCents;

      stockEffects.push({
        id: stableId(`${commandId}:${origLine.id}:loss_out`),
        sourceLineId: origLine.id,
        movementKind: "TransferLoss",
        leg: "AdjustmentOut",
        locationId: transfer.destinationLocationId,
        itemId: origLine.itemId,
        quantityDelta: `-${res.lossQuantity}`,
        valueDelta: `-${render(lossCostCents, 2)}`,
        valuationStatus: "Resolved",
      });
    }
  }

  if (stockEffects.length === 0) {
    throw new StockTransferConflict("No received or loss quantity provided");
  }

  const journalLines: PostingLine[] = [];
  if (totalLossValCents > 0n) {
    const lossValStr = render(totalLossValCents, 2);
    journalLines.push(
      {
        id: stableId(`${commandId}:jline:0`),
        accountId: lossAccount.id,
        debit: lossValStr,
        credit: "0.00",
      },
      {
        id: stableId(`${commandId}:jline:1`),
        accountId: inventoryAccount.id,
        debit: "0.00",
        credit: lossValStr,
      },
    );
  } else {
    const recValStr = render(totalReceivedValCents > 0n ? totalReceivedValCents : 100n, 2);
    journalLines.push(
      {
        id: stableId(`${commandId}:jline:0`),
        accountId: inventoryAccount.id,
        debit: recValStr,
        credit: "0.00",
      },
      {
        id: stableId(`${commandId}:jline:1`),
        accountId: inventoryAccount.id,
        debit: "0.00",
        credit: recValStr,
      },
    );
  }

  const command: PostingCommand = {
    businessId,
    userId,
    commandId,
    sourceEventId: stableId(`${commandId}:event`),
    journalEntryId: stableId(`${commandId}:journal`),
    datasetEpoch: business.datasetEpoch,
    schemaVersion: 1,
    calculationVersion: 1,
    businessDate,
    effectKind: "transfer",
    postingKind: "stock_transfer_receive",
    lines: journalLines,
    stockEffects,
  };

  let updatedTransfer: TransferWithRelations | null = null;

  await postCommand(db, command, {
    beforeCommit: async (tx) => {
      for (const res of receiptResult.lines) {
        await tx.stockTransferLine.update({
          where: { businessId_id: { businessId, id: res.lineId } },
          data: {
            receivedQuantity: new Prisma.Decimal(res.newTotalReceived),
            lossQuantity: new Prisma.Decimal(res.newTotalLoss),
            lossReason: res.lossReason ?? undefined,
          },
        });
      }

      updatedTransfer = await tx.stockTransfer.update({
        where: { businessId_id: { businessId, id: transferId } },
        data: {
          status: receiptResult.newStatus,
          receivedAt: receiptResult.newStatus === "Completed" ? new Date() : undefined,
          version: { increment: 1 },
        },
        include: {
          lines: { include: { item: true } },
          sourceLocation: true,
          destinationLocation: true,
        },
      });
    },
  });

  return updatedTransfer;
}

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
import { validateReturnQuantity } from "@business/domain";

const money = z.string().regex(/^\d{1,30}(?:\.\d{1,2})?$/);
const nonZeroMoney = z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,2})?$/);
const quantity = z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,6})?$/);

export const saleReturnInput = z.object({
  id: z.uuid(),
  commandId: z.uuid(),
  originalSaleId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  businessDate: z.iso.date(),
  lines: z.array(z.object({
    id: z.uuid(),
    originalLineId: z.uuid(),
    quantity,
    disposition: z.enum(["Restocked", "Damaged", "Scrapped", "None"]),
  }).strict()).min(1).max(100),
  settlement: z.object({
    allocateToDue: money.default("0.00"),
    customerCredit: money.default("0.00"),
    refund: z.object({
      accountId: z.uuid(),
      kind: z.enum(["Cash", "Bank"]),
      amount: nonZeroMoney,
      reference: z.string().trim().min(1).max(120).nullable(),
    }).strict().nullable().default(null),
  }).strict(),
}).strict();
export type SaleReturnInput = z.infer<typeof saleReturnInput>;

export const purchaseReturnInput = z.object({
  id: z.uuid(),
  commandId: z.uuid(),
  originalPurchaseId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  businessDate: z.iso.date(),
  lines: z.array(z.object({
    id: z.uuid(),
    originalLineId: z.uuid(),
    quantity,
  }).strict()).min(1).max(100),
}).strict();
export type PurchaseReturnInput = z.infer<typeof purchaseReturnInput>;

export class ReturnConflict extends Error {}

function decimal(value: string, scale: number): bigint {
  const [whole, fractional = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fractional.padEnd(scale, "0"));
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

export async function createSaleReturnDraft(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  input: SaleReturnInput,
) {
  if (!["Owner", "Accountant", "Cashier"].includes(role)) {
    throw new ReturnConflict("Trade permission required to record returns");
  }

  const existing = await withTenantContext(db, { businessId, userId }, async (tx) =>
    tx.creditNote.findFirst({
      where: { businessId, OR: [{ id: input.id }, { commandId: input.commandId }] },
    }),
  );
  if (existing) {
    const saved = existing.status === "Posted"
      ? (existing.snapshot as { input?: unknown }).input
      : existing.snapshot;
    if (existing.id !== input.id || stableJson(saved) !== stableJson(input)) {
      throw new ReturnConflict("Draft identity already used with different content");
    }
    return existing;
  }

  return withBusinessChange(db, businessId, userId, "return.sale.draft", async (tx) => {
    const originalSale = await tx.saleDocument.findFirst({
      where: { id: input.originalSaleId, businessId, status: "Posted" },
      include: { lines: true },
    });
    if (!originalSale) throw new ReturnConflict("Posted original sale invoice not found");

    const result = await tx.creditNote.create({
      data: {
        id: input.id,
        businessId,
        kind: "SaleReturn",
        originalDocumentId: input.originalSaleId,
        locationId: originalSale.locationId,
        partyId: originalSale.partyId,
        commandId: input.commandId,
        reason: input.reason,
        businessDate: new Date(input.businessDate),
        snapshot: input,
      },
    });
    return { result, change: { id: result.id, version: 1 } };
  });
}

export async function postSaleReturn(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  input: { id: string; commandId: string },
) {
  if (!["Owner", "Accountant", "Cashier"].includes(role)) {
    throw new ReturnConflict("Trade permission required to post returns");
  }

  const prepared = await withTenantContext(db, { businessId, userId }, async (tx) => {
    const draft = await tx.creditNote.findFirst({
      where: { id: input.id, commandId: input.commandId, businessId, kind: "SaleReturn" },
    });
    if (!draft) throw new ReturnConflict("Saved sale return draft not found");
    if (draft.status === "Posted") {
      return { posted: draft } as const;
    }

    const data = saleReturnInput.parse(draft.snapshot);
    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    const head = await tx.syncHead.findUniqueOrThrow({ where: { businessId } });

    // Fetch original sale document and its lines
    const originalSale = await tx.saleDocument.findFirst({
      where: { id: data.originalSaleId, businessId, status: "Posted" },
      include: { lines: true },
    });
    if (!originalSale) throw new ReturnConflict("Original posted sale not found");

    const saleSnapshot = originalSale.snapshot as {
      lines: Array<{
        id: string;
        itemId: string;
        quantity: string;
        unitPrice: string;
        taxProfileId?: string | null;
        conversionId?: string | null;
      }>;
      calculation?: {
        lines: Array<{
          id: string;
          base: string;
          tax: string;
          total: string;
          quantityBase: string;
        }>;
      };
    };

    // Prior credit notes for this sale to compute remaining returnable quantity per line
    const priorCreditNotes = await tx.creditNote.findMany({
      where: {
        businessId,
        originalDocumentId: originalSale.id,
        kind: "SaleReturn",
        status: "Posted",
        NOT: { id: draft.id },
      },
      include: { lines: true },
    });

    const returnedQtyByLine = new Map<string, bigint>();
    for (const cn of priorCreditNotes) {
      for (const line of cn.lines) {
        const current = returnedQtyByLine.get(line.originalLineId) ?? 0n;
        returnedQtyByLine.set(line.originalLineId, current + decimal(line.quantity.toString(), 6));
      }
    }

    // Accounts
    const accounts = await tx.account.findMany({ where: { businessId, archivedAt: null } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const byId = new Map(accounts.map((a) => [a.id, a]));

    const returnRevenueAccount = byCode.get("SALE_RETURN") ?? byCode.get("SALE_REVENUE");
    const taxLiabilityAccount = byCode.get("SALE_TAX");
    const receivableAccount = byCode.get("OPEN_RECEIVABLE");
    const customerCreditAccount = byCode.get("CUSTOMER_CREDIT") ?? byCode.get("OPEN_PAYABLE");
    const inventoryAssetAccount = byCode.get("OPEN_INVENTORY");
    const cogsExpenseAccount = byCode.get("SALE_COGS");

    if (!returnRevenueAccount || !taxLiabilityAccount || !receivableAccount || !inventoryAssetAccount || !cogsExpenseAccount) {
      throw new ReturnConflict("Required system posting accounts are missing");
    }

    // Validate refund account if specified
    if (data.settlement.refund) {
      const refundAcc = byId.get(data.settlement.refund.accountId);
      if (!refundAcc || (refundAcc.kind !== "Cash" && refundAcc.kind !== "Bank")) {
        throw new ReturnConflict("Select a valid cash or bank account for money refund");
      }
    }

    // Original stock movements for unit cost derivation
    const originalMovements = await tx.stockMovement.findMany({
      where: { businessId, sourceEventId: originalSale.sourceEventId ?? undefined },
    });

    // Validate return lines and calculate totals
    const QUANTITY = 1_000_000n;
    let subtotalCents = 0n;
    let taxTotalCents = 0n;

    const validatedLines = data.lines.map((reqLine) => {
      const origLine = originalSale.lines.find((l) => l.id === reqLine.originalLineId);
      if (!origLine) throw new ReturnConflict(`Original sale line ${reqLine.originalLineId} not found`);

      const origSnapLine = saleSnapshot.lines?.find((l) => l.id === reqLine.originalLineId);
      const calcLine = saleSnapshot.calculation?.lines?.find((l) => l.id === reqLine.originalLineId);

      const origQty = origSnapLine ? decimal(origSnapLine.quantity, 6) : 0n;
      const priorQty = returnedQtyByLine.get(reqLine.originalLineId) ?? 0n;
      const reqQty = decimal(reqLine.quantity, 6);

      // Concurrency / remaining quantity limit check
      try {
        try {
        validateReturnQuantity(render(origQty, 6), render(priorQty, 6), render(reqQty, 6));
      } catch (err) {
        throw new ReturnConflict(err instanceof Error ? err.message : String(err));
      }
      } catch (err) {
        throw new ReturnConflict(err instanceof Error ? err.message : String(err));
      }

      // Calculate unit rate and tax proportionally
      const unitPriceCents = origSnapLine ? decimal(origSnapLine.unitPrice, 2) : 0n;
      const lineSubtotalCents = halfUp(unitPriceCents * reqQty, QUANTITY);

      let lineTaxCents = 0n;
      if (calcLine && origQty > 0n) {
        const origTaxCents = decimal(calcLine.tax, 2);
        lineTaxCents = halfUp(origTaxCents * reqQty, origQty);
      }

      subtotalCents += lineSubtotalCents;
      taxTotalCents += lineTaxCents;

      // Resolved unit cost for restock
      let resolvedUnitCost = "0.00";
      const origMv = originalMovements.find((m) => m.sourceLineId === reqLine.originalLineId);
      if (origMv && origMv.quantityDelta.abs().gt(0)) {
        const mvQty = decimal(origMv.quantityDelta.abs().toString(), 6);
        const mvVal = decimal(origMv.valueDelta.abs().toString(), 2);
        resolvedUnitCost = render(halfUp(mvVal * QUANTITY, mvQty), 2);
      }

      return {
        id: reqLine.id,
        originalLineId: reqLine.originalLineId,
        itemId: origLine.itemId,
        quantity: reqLine.quantity,
        unitPrice: origSnapLine?.unitPrice ?? "0.00",
        subtotal: render(lineSubtotalCents, 2),
        taxAmount: render(lineTaxCents, 2),
        total: render(lineSubtotalCents + lineTaxCents, 2),
        disposition: reqLine.disposition,
        resolvedUnitCost,
      };
    });

    const totalCents = subtotalCents + taxTotalCents;
    const totalAmount = render(totalCents, 2);

    // Validate settlement
    const allocDueCents = decimal(data.settlement.allocateToDue, 2);
    const custCreditCents = decimal(data.settlement.customerCredit, 2);
    const refundCents = data.settlement.refund ? decimal(data.settlement.refund.amount, 2) : 0n;

    if (allocDueCents + custCreditCents + refundCents !== totalCents) {
      throw new ReturnConflict(
        `Settlement sum (due: ${data.settlement.allocateToDue}, credit: ${data.settlement.customerCredit}, refund: ${data.settlement.refund?.amount ?? "0.00"}) must equal return total ${totalAmount}`,
      );
    }

    const priorAllocatedDue = priorCreditNotes.reduce(
      (sum, cn) => sum + decimal(cn.allocatedCredit ? cn.allocatedCredit.toString() : "0.00", 2),
      0n,
    );
    const origDueCents = decimal(originalSale.due ? originalSale.due.toString() : "0.00", 2) - priorAllocatedDue;
    if (allocDueCents > origDueCents) {
      throw new ReturnConflict(`Allocation to unpaid due (${data.settlement.allocateToDue}) exceeds remaining invoice balance (${render(origDueCents, 2)})`);
    }

    return {
      draft,
      data,
      business,
      head,
      originalSale,
      validatedLines,
      subtotalAmount: render(subtotalCents, 2),
      taxTotalAmount: render(taxTotalCents, 2),
      totalAmount,
      allocDueAmount: render(allocDueCents, 2),
      custCreditAmount: render(custCreditCents, 2),
      refundAmount: render(refundCents, 2),
      returnRevenueAccount,
      taxLiabilityAccount,
      receivableAccount,
      customerCreditAccount,
      inventoryAssetAccount,
      cogsExpenseAccount,
    } as const;
  });

  if ("posted" in prepared) return prepared.posted;

  const {
    draft,
    data,
    business,
    originalSale,
    validatedLines,
    subtotalAmount,
    taxTotalAmount,
    totalAmount,
    allocDueAmount,
    custCreditAmount,
    refundAmount,
    returnRevenueAccount,
    taxLiabilityAccount,
    receivableAccount,
    customerCreditAccount,
    inventoryAssetAccount,
    cogsExpenseAccount,
  } = prepared;

  const sourceEventId = stableId(`${data.commandId}:event`);
  const journalEntryId = stableId(`${data.commandId}:journal`);

  // Build balanced Journal Lines
  const journalLines: PostingLine[] = [];
  let jIdx = 0;

  // Debit: Return contra-revenue
  journalLines.push({
    id: stableId(`${data.commandId}:jline:${jIdx++}`),
    accountId: returnRevenueAccount.id,
    debit: subtotalAmount,
    credit: "0.00",
  });

  // Debit: Tax reversal
  if (decimal(taxTotalAmount, 2) > 0n) {
    journalLines.push({
      id: stableId(`${data.commandId}:jline:${jIdx++}`),
      accountId: taxLiabilityAccount.id,
      debit: taxTotalAmount,
      credit: "0.00",
    });
  }

  // Credit: Customer Receivable (reduce due)
  if (decimal(allocDueAmount, 2) > 0n) {
    journalLines.push({
      id: stableId(`${data.commandId}:jline:${jIdx++}`),
      accountId: receivableAccount.id,
      debit: "0.00",
      credit: allocDueAmount,
    });
  }

  // Credit: Customer Credit Liability
  if (decimal(custCreditAmount, 2) > 0n) {
    journalLines.push({
      id: stableId(`${data.commandId}:jline:${jIdx++}`),
      accountId: customerCreditAccount?.id ?? receivableAccount.id,
      debit: "0.00",
      credit: custCreditAmount,
    });
  }

  // Credit: Cash/Bank refund
  if (data.settlement.refund && decimal(refundAmount, 2) > 0n) {
    journalLines.push({
      id: stableId(`${data.commandId}:jline:${jIdx++}`),
      accountId: data.settlement.refund.accountId,
      debit: "0.00",
      credit: refundAmount,
    });
  }

  // Restock movements and Restock Journal (Debit Inventory, Credit COGS)
  const QUANTITY = 1_000_000n;
  const stockEffects: PostingStockEffect[] = [];
  let restockValueCents = 0n;

  for (let idx = 0; idx < validatedLines.length; idx++) {
    const line = validatedLines[idx];
    if (line.disposition === "Restocked") {
      const qty = decimal(line.quantity, 6);
      const unitCost = decimal(line.resolvedUnitCost, 2);
      const valCents = halfUp(qty * unitCost, QUANTITY);
      restockValueCents += valCents;

      stockEffects.push({
        id: stableId(`${data.commandId}:stock:${idx}`),
        sourceLineId: line.id,
        movementKind: "SaleReturnRestock",
        leg: "Restock",
        locationId: originalSale.locationId,
        itemId: line.itemId,
        quantityDelta: line.quantity,
        valueDelta: render(valCents, 2),
        valuationStatus: "Resolved",
      });
    }
  }

  if (restockValueCents > 0n) {
    journalLines.push({
      id: stableId(`${data.commandId}:jline:${jIdx++}`),
      accountId: inventoryAssetAccount.id,
      debit: render(restockValueCents, 2),
      credit: "0.00",
    });
    journalLines.push({
      id: stableId(`${data.commandId}:jline:${jIdx}`),
      accountId: cogsExpenseAccount.id,
      debit: "0.00",
      credit: render(restockValueCents, 2),
    });
  }

  const command: PostingCommand = {
    businessId,
    userId,
    commandId: data.commandId,
    sourceEventId,
    journalEntryId,
    datasetEpoch: business.datasetEpoch,
    schemaVersion: 1,
    calculationVersion: 1,
    businessDate: data.businessDate,
    effectKind: "reversal",
    postingKind: "sale.return",
    lines: journalLines,
    stockEffects,
    metadata: {
      documentId: draft.id,
      originalSaleId: originalSale.id,
      total: totalAmount,
    },
  };

  await postCommand(db, command, {
    beforeCommit: async (tx) => {
      const updatedBiz = await tx.business.update({
        where: { id: businessId },
        data: { creditNoteSequence: { increment: 1 } },
      });
      const creditNoteNumber = `CN-${updatedBiz.creditNoteSequence.toString().padStart(6, "0")}`;

      await tx.creditNote.update({
        where: { id: draft.id },
        data: {
          status: "Posted",
          number: creditNoteNumber,
          sourceEventId,
          subtotal: new Prisma.Decimal(subtotalAmount),
          taxTotal: new Prisma.Decimal(taxTotalAmount),
          total: new Prisma.Decimal(totalAmount),
          allocatedCredit: new Prisma.Decimal(allocDueAmount),
          customerCredit: new Prisma.Decimal(custCreditAmount),
          refundedAmount: new Prisma.Decimal(refundAmount),
          postedAt: new Date(),
          version: { increment: 1 },
        },
      });

      for (const line of validatedLines) {
        await tx.creditNoteLine.create({
          data: {
            id: line.id,
            businessId,
            creditNoteId: draft.id,
            originalLineId: line.originalLineId,
            itemId: line.itemId,
            quantity: new Prisma.Decimal(line.quantity),
            unitPrice: new Prisma.Decimal(line.unitPrice),
            subtotal: new Prisma.Decimal(line.subtotal),
            taxAmount: new Prisma.Decimal(line.taxAmount),
            total: new Prisma.Decimal(line.total),
            disposition: line.disposition,
            snapshot: line,
          },
        });
      }

      if (data.settlement.refund && decimal(refundAmount, 2) > 0n) {
        await tx.creditNoteRefund.create({
          data: {
            id: crypto.randomUUID(),
            businessId,
            creditNoteId: draft.id,
            accountId: data.settlement.refund.accountId,
            kind: data.settlement.refund.kind,
            amount: new Prisma.Decimal(refundAmount),
            reference: data.settlement.refund.reference,
          },
        });
      }
    },
  });

  return withTenantContext(db, { businessId, userId }, (tx) =>
    tx.creditNote.findUniqueOrThrow({ where: { id: input.id } }),
  );
}

export async function createPurchaseReturnDraft(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  input: PurchaseReturnInput,
) {
  if (!["Owner", "Accountant"].includes(role)) {
    throw new ReturnConflict("Owner or Accountant permission required to record purchase debit notes");
  }

  const existing = await withTenantContext(db, { businessId, userId }, async (tx) =>
    tx.creditNote.findFirst({
      where: { businessId, OR: [{ id: input.id }, { commandId: input.commandId }] },
    }),
  );
  if (existing) {
    const saved = existing.status === "Posted"
      ? (existing.snapshot as { input?: unknown }).input
      : existing.snapshot;
    if (existing.id !== input.id || stableJson(saved) !== stableJson(input)) {
      throw new ReturnConflict("Draft identity already used with different content");
    }
    return existing;
  }

  return withBusinessChange(db, businessId, userId, "return.purchase.draft", async (tx) => {
    const originalPurchase = await tx.purchaseDocument.findFirst({
      where: { id: input.originalPurchaseId, businessId, status: "Posted" },
      include: { lines: true },
    });
    if (!originalPurchase) throw new ReturnConflict("Posted original purchase bill not found");

    const result = await tx.creditNote.create({
      data: {
        id: input.id,
        businessId,
        kind: "PurchaseReturn",
        originalDocumentId: input.originalPurchaseId,
        locationId: originalPurchase.locationId,
        partyId: originalPurchase.partyId,
        commandId: input.commandId,
        reason: input.reason,
        businessDate: new Date(input.businessDate),
        snapshot: input,
      },
    });
    return { result, change: { id: result.id, version: 1 } };
  });
}

export async function postPurchaseReturn(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  input: { id: string; commandId: string },
) {
  if (!["Owner", "Accountant"].includes(role)) {
    throw new ReturnConflict("Owner or Accountant permission required to post purchase returns");
  }

  const prepared = await withTenantContext(db, { businessId, userId }, async (tx) => {
    const draft = await tx.creditNote.findFirst({
      where: { id: input.id, commandId: input.commandId, businessId, kind: "PurchaseReturn" },
    });
    if (!draft) throw new ReturnConflict("Saved purchase return draft not found");
    if (draft.status === "Posted") {
      return { posted: draft } as const;
    }

    const data = purchaseReturnInput.parse(draft.snapshot);
    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });

    const originalPurchase = await tx.purchaseDocument.findFirst({
      where: { id: data.originalPurchaseId, businessId, status: "Posted" },
      include: { lines: true },
    });
    if (!originalPurchase) throw new ReturnConflict("Original posted purchase bill not found");

    const purchaseSnapshot = originalPurchase.snapshot as {
      lines: Array<{
        id: string;
        itemId: string;
        quantity: string;
        unitCost: string;
      }>;
      calculation?: {
        lines: Array<{
          id: string;
          base: string;
          tax: string;
          total: string;
          quantityBase: string;
        }>;
      };
    };

    const priorDebitNotes = await tx.creditNote.findMany({
      where: {
        businessId,
        originalDocumentId: originalPurchase.id,
        kind: "PurchaseReturn",
        status: "Posted",
        NOT: { id: draft.id },
      },
      include: { lines: true },
    });

    const returnedQtyByLine = new Map<string, bigint>();
    for (const dn of priorDebitNotes) {
      for (const line of dn.lines) {
        const current = returnedQtyByLine.get(line.originalLineId) ?? 0n;
        returnedQtyByLine.set(line.originalLineId, current + decimal(line.quantity.toString(), 6));
      }
    }

    const accounts = await tx.account.findMany({ where: { businessId, archivedAt: null } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));

    const payableAccount = byCode.get("OPEN_PAYABLE");
    const inventoryAssetAccount = byCode.get("OPEN_INVENTORY");
    const taxReversalAccount = byCode.get("SALE_TAX");

    if (!payableAccount || !inventoryAssetAccount || !taxReversalAccount) {
      throw new ReturnConflict("Required system posting accounts are missing");
    }

    const QUANTITY = 1_000_000n;
    let subtotalCents = 0n;
    let taxTotalCents = 0n;

    const validatedLines = data.lines.map((reqLine) => {
      const origLine = originalPurchase.lines.find((l) => l.id === reqLine.originalLineId);
      if (!origLine) throw new ReturnConflict(`Original purchase line ${reqLine.originalLineId} not found`);

      const origSnapLine = purchaseSnapshot.lines?.find((l) => l.id === reqLine.originalLineId);
      const calcLine = purchaseSnapshot.calculation?.lines?.find((l) => l.id === reqLine.originalLineId);

      const origQty = origSnapLine ? decimal(origSnapLine.quantity, 6) : 0n;
      const priorQty = returnedQtyByLine.get(reqLine.originalLineId) ?? 0n;
      const reqQty = decimal(reqLine.quantity, 6);

      try {
        validateReturnQuantity(render(origQty, 6), render(priorQty, 6), render(reqQty, 6));
      } catch (err) {
        throw new ReturnConflict(err instanceof Error ? err.message : String(err));
      }

      const unitCostCents = origSnapLine ? decimal(origSnapLine.unitCost, 2) : 0n;
      const lineSubtotalCents = halfUp(unitCostCents * reqQty, QUANTITY);

      let lineTaxCents = 0n;
      if (calcLine && origQty > 0n) {
        const origTaxCents = decimal(calcLine.tax, 2);
        lineTaxCents = halfUp(origTaxCents * reqQty, origQty);
      }

      subtotalCents += lineSubtotalCents;
      taxTotalCents += lineTaxCents;

      return {
        id: reqLine.id,
        originalLineId: reqLine.originalLineId,
        itemId: origLine.itemId,
        quantity: reqLine.quantity,
        unitCost: origSnapLine?.unitCost ?? "0.00",
        subtotal: render(lineSubtotalCents, 2),
        taxAmount: render(lineTaxCents, 2),
        total: render(lineSubtotalCents + lineTaxCents, 2),
      };
    });

    const totalCents = subtotalCents + taxTotalCents;
    const totalAmount = render(totalCents, 2);

    const priorAllocatedDue = priorDebitNotes.reduce(
      (sum, dn) => sum + decimal(dn.allocatedCredit ? dn.allocatedCredit.toString() : "0.00", 2),
      0n,
    );
    const origDueCents = decimal(originalPurchase.due ? originalPurchase.due.toString() : "0.00", 2) - priorAllocatedDue;
    if (totalCents > origDueCents) {
      throw new ReturnConflict(`Debit note total (${totalAmount}) exceeds remaining purchase bill balance (${render(origDueCents, 2)})`);
    }

    return {
      draft,
      data,
      business,
      originalPurchase,
      validatedLines,
      subtotalAmount: render(subtotalCents, 2),
      taxTotalAmount: render(taxTotalCents, 2),
      totalAmount,
      payableAccount,
      inventoryAssetAccount,
      taxReversalAccount,
    } as const;
  });

  if ("posted" in prepared) return prepared.posted;

  const {
    draft,
    data,
    business,
    originalPurchase,
    validatedLines,
    subtotalAmount,
    taxTotalAmount,
    totalAmount,
    payableAccount,
    inventoryAssetAccount,
    taxReversalAccount,
  } = prepared;

  const sourceEventId = stableId(`${data.commandId}:event`);
  const journalEntryId = stableId(`${data.commandId}:journal`);

  let jIdx = 0;
  const journalLines: PostingLine[] = [
    {
      id: stableId(`${data.commandId}:jline:${jIdx++}`),
      accountId: payableAccount.id,
      debit: totalAmount,
      credit: "0.00",
    },
    {
      id: stableId(`${data.commandId}:jline:${jIdx++}`),
      accountId: inventoryAssetAccount.id,
      debit: "0.00",
      credit: subtotalAmount,
    },
    ...(decimal(taxTotalAmount, 2) > 0n
      ? [
          {
            id: stableId(`${data.commandId}:jline:${jIdx}`),
            accountId: taxReversalAccount.id,
            debit: "0.00",
            credit: taxTotalAmount,
          },
        ]
      : []),
  ];

  const stockEffects: PostingStockEffect[] = validatedLines.map((line, idx) => ({
    id: stableId(`${data.commandId}:stock:${idx}`),
    sourceLineId: line.id,
    movementKind: "PurchaseReturn",
    leg: "ReturnOut",
    locationId: originalPurchase.locationId,
    itemId: line.itemId,
    quantityDelta: `-${line.quantity}`,
    valueDelta: `-${line.subtotal}`,
    valuationStatus: "Resolved",
  }));

  const command: PostingCommand = {
    businessId,
    userId,
    commandId: data.commandId,
    sourceEventId,
    journalEntryId,
    datasetEpoch: business.datasetEpoch,
    schemaVersion: 1,
    calculationVersion: 1,
    businessDate: data.businessDate,
    effectKind: "reversal",
    postingKind: "purchase.return",
    lines: journalLines,
    stockEffects,
    metadata: {
      documentId: draft.id,
      originalPurchaseId: originalPurchase.id,
      total: totalAmount,
    },
  };

  await postCommand(db, command, {
    beforeCommit: async (tx) => {
      const updatedBiz = await tx.business.update({
        where: { id: businessId },
        data: { debitNoteSequence: { increment: 1 } },
      });
      const debitNoteNumber = `DN-${updatedBiz.debitNoteSequence.toString().padStart(6, "0")}`;

      await tx.creditNote.update({
        where: { id: draft.id },
        data: {
          status: "Posted",
          number: debitNoteNumber,
          sourceEventId,
          subtotal: new Prisma.Decimal(subtotalAmount),
          taxTotal: new Prisma.Decimal(taxTotalAmount),
          total: new Prisma.Decimal(totalAmount),
          allocatedCredit: new Prisma.Decimal(totalAmount),
          customerCredit: new Prisma.Decimal("0.00"),
          refundedAmount: new Prisma.Decimal("0.00"),
          postedAt: new Date(),
          version: { increment: 1 },
        },
      });

      for (const line of validatedLines) {
        await tx.creditNoteLine.create({
          data: {
            id: line.id,
            businessId,
            creditNoteId: draft.id,
            originalLineId: line.originalLineId,
            itemId: line.itemId,
            quantity: new Prisma.Decimal(line.quantity),
            unitPrice: new Prisma.Decimal(line.unitCost),
            subtotal: new Prisma.Decimal(line.subtotal),
            taxAmount: new Prisma.Decimal(line.taxAmount),
            total: new Prisma.Decimal(line.total),
            disposition: "None",
            snapshot: line,
          },
        });
      }
    },
  });

  return withTenantContext(db, { businessId, userId }, (tx) =>
    tx.creditNote.findUniqueOrThrow({ where: { id: input.id } }),
  );
}

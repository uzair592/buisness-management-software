import crypto from "node:crypto";
import { z } from "zod";
import { calculateDocument } from "@business/domain";
import { type PrismaClient, type PostingCommand, postCommand, withBusinessChange, withTenantContext } from "@business/db";

const money = z.string().regex(/^\d{1,30}(?:\.\d{1,2})?$/);
const nonZeroMoney = z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,2})?$/);
const quantity = z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,6})?$/);

export const purchaseInput = z.object({
  id: z.uuid(),
  commandId: z.uuid(),
  locationId: z.uuid(),
  partyId: z.uuid(),
  supplierInvoiceNumber: z.string().trim().min(1).max(120),
  allowDuplicateSupplierReference: z.boolean().default(false),
  businessDate: z.iso.date(),
  documentDiscount: money.default("0"),
  lines: z.array(z.object({
    id: z.uuid(),
    itemId: z.uuid(),
    conversionId: z.uuid().nullable(),
    taxProfileId: z.uuid().nullable(),
    quantity,
    unitCost: money,
    discount: money,
  }).strict()).min(1).max(100),
  payments: z.array(z.object({
    id: z.uuid(),
    accountId: z.uuid(),
    kind: z.enum(["Cash", "Bank"]),
    applied: nonZeroMoney,
    reference: z.string().trim().min(1).max(120).nullable(),
  }).strict()).max(5),
}).strict();

export type PurchaseInput = z.infer<typeof purchaseInput>;

export class PurchaseConflict extends Error {}

function decimal(value: string, scale: number): bigint {
  const [whole, fractional = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fractional.padEnd(scale, "0"));
}

function render(value: bigint, scale: number): string {
  const unit = 10n ** BigInt(scale);
  return `${value / unit}.${(value % unit).toString().padStart(scale, "0")}`;
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

export async function createPurchaseDraft(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  input: PurchaseInput,
) {
  if (!["Owner", "Accountant"].includes(role)) {
    throw new PurchaseConflict("Owner or Accountant permission required to record purchases");
  }

  const existing = await withTenantContext(db, { businessId, userId }, async (tx) =>
    tx.purchaseDocument.findFirst({
      where: { businessId, OR: [{ id: input.id }, { commandId: input.commandId }] },
    }),
  );

  if (existing) {
    const savedInput = existing.status === "Posted" ? (existing.snapshot as { input?: unknown }).input : existing.snapshot;
    if (existing.id !== input.id || stableJson(savedInput) !== stableJson(input)) {
      throw new PurchaseConflict("Draft identity already used with different content");
    }
    return existing;
  }

  return withBusinessChange(db, businessId, userId, "purchase.draft", async (tx) => {
    const location = await tx.location.findFirst({
      where: { id: input.locationId, businessId },
    });
    if (!location) throw new PurchaseConflict("Choose a valid business location");

    const party = await tx.party.findFirst({
      where: { id: input.partyId, businessId, archivedAt: null },
    });
    if (!party) throw new PurchaseConflict("Supplier is missing or archived");

    const result = await tx.purchaseDocument.create({
      data: {
        id: input.id,
        businessId,
        commandId: input.commandId,
        locationId: input.locationId,
        partyId: input.partyId,
        supplierInvoiceNumber: input.supplierInvoiceNumber,
        businessDate: new Date(input.businessDate),
        snapshot: input,
      },
    });
    return { result, change: { id: result.id, version: 1 } };
  });
}

export async function postPurchase(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  input: { id: string; commandId: string; allowDuplicateSupplierReference?: boolean },
) {
  if (!["Owner", "Accountant"].includes(role)) {
    throw new PurchaseConflict("Owner or Accountant permission required to post purchases");
  }

  const prepared = await withTenantContext(db, { businessId, userId }, async (tx) => {
    const draft = await tx.purchaseDocument.findFirst({
      where: { id: input.id, commandId: input.commandId, businessId },
    });
    if (!draft) throw new PurchaseConflict("Saved purchase draft not found");
    if (draft.status === "Posted") {
      return { posted: draft } as const;
    }

    const data = purchaseInput.parse(draft.snapshot);
    const allowDuplicate = Boolean(data.allowDuplicateSupplierReference || input.allowDuplicateSupplierReference);
    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    const head = await tx.syncHead.findUniqueOrThrow({ where: { businessId } });

    const location = await tx.location.findFirst({
      where: { id: data.locationId, businessId },
    });
    if (!location) throw new PurchaseConflict("Location is no longer active");

    const party = await tx.party.findFirst({
      where: { id: data.partyId, businessId, archivedAt: null },
    });
    if (!party) throw new PurchaseConflict("Supplier is missing or archived");

    // Check duplicate supplier invoice reference
    const existingRef = await tx.purchaseDocument.findFirst({
      where: {
        businessId,
        partyId: data.partyId,
        supplierInvoiceNumber: data.supplierInvoiceNumber,
        status: "Posted",
        NOT: { id: input.id },
      },
    });
    if (existingRef && !allowDuplicate) {
      throw new PurchaseConflict(
        "Supplier reference already recorded for this supplier. Review the existing bill or confirm this is an intentional repeat.",
      );
    }

    const items = await tx.item.findMany({
      where: { businessId, id: { in: data.lines.map((line) => line.itemId) }, archivedAt: null },
    });
    const byItem = new Map(items.map((item) => [item.id, item]));

    const accounts = await tx.account.findMany({ where: { businessId, archivedAt: null } });
    const byAccount = new Map(accounts.map((account) => [account.id, account]));
    const byCode = new Map(accounts.map((account) => [account.code, account]));

    const requiredAccounts = ["OPEN_INVENTORY", "OPEN_PAYABLE"];
    if (requiredAccounts.some((code) => !byCode.has(code))) {
      throw new PurchaseConflict("Owner must initialize posting accounts before recording purchases");
    }

    const taxIds = data.lines.map((line) => line.taxProfileId).filter((id): id is string => !!id);
    const taxes = await tx.taxProfile.findMany({ where: { businessId, id: { in: taxIds } } });
    const byTax = new Map(taxes.map((tax) => [tax.id, tax]));

    const conversions = await tx.itemUnitConversion.findMany({
      where: {
        businessId,
        id: { in: data.lines.map((line) => line.conversionId).filter((id): id is string => !!id) },
        archivedAt: null,
      },
    });
    const byConversion = new Map(conversions.map((conv) => [conv.id, conv]));

    const calculationLines = data.lines.map((line) => {
      const item = byItem.get(line.itemId);
      if (!item) throw new PurchaseConflict("An item is missing or archived");
      const conversion = line.conversionId ? byConversion.get(line.conversionId) : null;
      if (line.conversionId && (!conversion || conversion.itemId !== item.id || item.kind !== "Goods")) {
        throw new PurchaseConflict("Invalid item unit");
      }
      const tax = line.taxProfileId ? byTax.get(line.taxProfileId) : null;
      if (line.taxProfileId && (!tax || tax.archivedAt)) {
        throw new PurchaseConflict("Tax profile is missing or archived");
      }
      return {
        id: line.id,
        quantity: line.quantity,
        conversion: conversion?.factor.toString() ?? "1",
        conversionVersion: conversion?.version ?? 1,
        unitPrice: line.unitCost,
        lineDiscount: { kind: "amount" as const, value: line.discount },
        tax: {
          mode: (tax?.mode.toLowerCase() ?? "exclusive") as "exclusive" | "inclusive",
          percent: tax?.rate.toString() ?? "0",
        },
      };
    });

    if (new Set(data.lines.map((l) => l.id)).size !== data.lines.length ||
        new Set(data.payments.map((p) => p.id)).size !== data.payments.length) {
      throw new PurchaseConflict("Duplicate line or payment ID");
    }

    const calculated = calculateDocument({
      lines: calculationLines,
      documentDiscount: data.documentDiscount,
    });

    if (decimal(calculated.total, 2) === 0n) {
      throw new PurchaseConflict("Purchase total must be greater than zero");
    }

    let cashPaid = 0n;
    let bankPaid = 0n;
    for (const payment of data.payments) {
      const account = byAccount.get(payment.accountId);
      if (!account || account.kind !== payment.kind || decimal(payment.applied, 2) === 0n) {
        throw new PurchaseConflict("Invalid payment account or amount");
      }
      if (payment.kind === "Cash") {
        if (payment.reference !== null) throw new PurchaseConflict("Cash payment must not have reference");
        cashPaid += decimal(payment.applied, 2);
      } else {
        if (!payment.reference) throw new PurchaseConflict("Bank payment requires reference");
        bankPaid += decimal(payment.applied, 2);
      }
    }

    const totalPaid = cashPaid + bankPaid;
    const totalBill = decimal(calculated.total, 2);
    if (totalPaid > totalBill) {
      throw new PurchaseConflict("Applied payment exceeds purchase bill total");
    }
    const dueAmount = totalBill - totalPaid;

    const stockEffects: NonNullable<PostingCommand["stockEffects"]>[number][] = [];
    let goodsCostTotal = 0n;

    for (const [index, line] of data.lines.entries()) {
      const item = byItem.get(line.itemId)!;
      if (item.kind !== "Goods") continue;
      const netLineCost = decimal(calculated.lines[index].base, 2);
      goodsCostTotal += netLineCost;
      stockEffects.push({
        id: stableId(`${data.commandId}:stock:${line.id}`),
        itemId: item.id,
        sourceLineId: line.id,
        locationId: data.locationId,
        movementKind: "purchase",
        leg: "in",
        quantityDelta: calculated.lines[index].quantityBase,
        valueDelta: render(netLineCost, 2),
        valuationStatus: "Resolved",
      });
    }

    const journalLines: PostingCommand["lines"][number][] = [];
    const debit = (key: string, accountId: string, amount: string) => {
      if (decimal(amount, 2)) {
        journalLines.push({ id: stableId(`${data.commandId}:${key}`), accountId, debit: amount, credit: "0" });
      }
    };
    const credit = (key: string, accountId: string, amount: string) => {
      if (decimal(amount, 2)) {
        journalLines.push({ id: stableId(`${data.commandId}:${key}`), accountId, debit: "0", credit: amount });
      }
    };

    // Debit Inventory for goods net cost
    debit("inventory", byCode.get("OPEN_INVENTORY")!.id, render(goodsCostTotal, 2));

    // Debit Tax if input tax is present
    const taxTotal = decimal(calculated.tax, 2);
    if (taxTotal > 0n) {
      const taxAccount = byCode.get("PURCHASE_TAX") ?? byCode.get("SALE_TAX");
      if (taxAccount) {
        debit("tax", taxAccount.id, calculated.tax);
      } else {
        debit("tax-inv", byCode.get("OPEN_INVENTORY")!.id, calculated.tax);
      }
    }

    // Credit Supplier Payable for total bill
    credit("payable", byCode.get("OPEN_PAYABLE")!.id, calculated.total);

    // If payments applied, debit payable and credit payment account
    if (totalPaid > 0n) {
      debit("payment-payable", byCode.get("OPEN_PAYABLE")!.id, render(totalPaid, 2));
      for (const payment of data.payments) {
        credit(`payment:${payment.id}`, payment.accountId, payment.applied);
      }
    }

    const command: PostingCommand = {
      businessId,
      userId,
      commandId: data.commandId,
      sourceEventId: stableId(`${data.commandId}:event`),
      journalEntryId: stableId(`${data.commandId}:journal`),
      datasetEpoch: business.datasetEpoch,
      schemaVersion: 1,
      calculationVersion: 1,
      businessDate: data.businessDate,
      effectKind: "purchase",
      postingKind: "purchase.bill",
      lines: journalLines,
      stockEffects,
      metadata: { documentId: data.id, input: data, calculated },
    };

    const units = await tx.unit.findMany({ where: { businessId } });
    const byUnit = new Map(units.map((unit) => [unit.id, unit.name]));

    const itemSnapshots = data.lines.map((line, index) => {
      const item = byItem.get(line.itemId)!;
      const conversion = line.conversionId ? byConversion.get(line.conversionId) : null;
      return {
        name: item.name,
        kind: item.kind,
        sku: item.sku,
        barcode: item.barcode,
        unitName: byUnit.get(conversion?.unitId ?? item.baseUnitId ?? "") ?? "Each",
        tax: calculationLines[index].tax,
        conversion: calculationLines[index].conversion,
      };
    });

    return {
      draft,
      data,
      party,
      allowDuplicate,
      businessName: business.name,
      itemSnapshots,
      calculated,
      totalPaid: render(totalPaid, 2),
      dueAmount: render(dueAmount, 2),
      command,
      expectedCursor: head.committedCursor.toString(),
    } as const;
  });

  if ("posted" in prepared) return prepared.posted;

  await postCommand(db, prepared.command, {
    beforePosting: async (tx, cursor) => {
      if (cursor.toString() !== prepared.expectedCursor) {
        throw new PurchaseConflict("Business changed since calculation; retry the saved draft");
      }
      const draft = await tx.purchaseDocument.findFirst({
        where: { id: input.id, businessId, status: "Draft", version: prepared.draft.version },
      });
      if (!draft) throw new PurchaseConflict("Draft changed while posting");
    },
    beforeCommit: async (tx) => {
      const updatedBiz = await tx.business.update({
        where: { id: businessId },
        data: { purchaseSequence: { increment: 1 } },
      });
      const number = `PB-${updatedBiz.purchaseSequence.toString().padStart(6, "0")}`;

      const snapshot = {
        input: prepared.data,
        calculation: prepared.calculated,
        number,
        businessName: prepared.businessName,
        partyName: prepared.party.name,
        supplierInvoiceNumber: prepared.data.supplierInvoiceNumber,
        duplicateReferenceReviewed: prepared.allowDuplicate,
        lines: prepared.data.lines.map((line, index) => ({
          ...line,
          ...prepared.itemSnapshots[index],
          calculated: prepared.calculated.lines[index],
        })),
        payment: {
          total: prepared.calculated.total,
          paid: prepared.totalPaid,
          due: prepared.dueAmount,
          payments: prepared.data.payments,
        },
      };

      await tx.purchaseDocument.update({
        where: { id: input.id },
        data: {
          status: "Posted",
          version: { increment: 1 },
          number,
          sourceEventId: prepared.command.sourceEventId,
          snapshot: JSON.parse(JSON.stringify(snapshot)),
          total: prepared.calculated.total,
          paid: prepared.totalPaid,
          due: prepared.dueAmount,
          postedAt: new Date(),
        },
      });

      for (let index = 0; index < prepared.data.lines.length; index++) {
        const line = prepared.data.lines[index];
        await tx.purchaseLine.create({
          data: {
            id: line.id,
            businessId,
            purchaseId: input.id,
            itemId: line.itemId,
            snapshot: JSON.parse(JSON.stringify({
              ...line,
              ...prepared.itemSnapshots[index],
              calculated: prepared.calculated.lines[index],
            })),
          },
        });
      }

      for (const payment of prepared.data.payments) {
        await tx.purchasePayment.create({
          data: {
            id: payment.id,
            businessId,
            purchaseId: input.id,
            accountId: payment.accountId,
            kind: payment.kind,
            applied: payment.applied,
            reference: payment.reference,
          },
        });
      }
    },
  });

  return withTenantContext(db, { businessId, userId }, (tx) =>
    tx.purchaseDocument.findUniqueOrThrow({ where: { id: input.id } }),
  );
}

import crypto from "node:crypto";
import {
  type PrismaClient,
  withBusinessChange,
  withTenantContext,
  Prisma,
} from "@business/db";
import {
  type PurchaseOrderInput,
  type PurchaseOrderConvertInput,
  type PurchaseOrderStatus,
} from "@business/contracts";
import { validatePurchaseOrderConversion } from "@business/domain";
import { createPurchaseDraft, postPurchase } from "./purchases.js";

export class PurchaseOrderConflict extends Error {}

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

export async function createPurchaseOrder(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  input: PurchaseOrderInput,
) {
  if (!["Owner", "Accountant", "StockManager"].includes(role)) {
    throw new PurchaseOrderConflict("Permission required to create purchase orders");
  }

  return withBusinessChange(db, businessId, userId, "purchase_order.create", async (tx) => {
    const party = await tx.party.findFirst({
      where: { id: input.partyId, businessId, isSupplier: true, archivedAt: null },
    });
    if (!party) throw new PurchaseOrderConflict("Supplier not found or archived");

    const location = await tx.location.findFirst({
      where: { id: input.locationId, businessId },
    });
    if (!location) throw new PurchaseOrderConflict("Delivery location not found");

    const itemIds = input.lines.map((l) => l.itemId);
    const items = await tx.item.findMany({
      where: { id: { in: itemIds }, businessId, archivedAt: null },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));
    if (items.length !== new Set(itemIds).size) {
      throw new PurchaseOrderConflict("One or more items not found or archived");
    }

    const taxIds = input.lines.map((l) => l.taxProfileId).filter((id): id is string => !!id);
    const taxes = await tx.taxProfile.findMany({
      where: { id: { in: taxIds }, businessId, archivedAt: null },
    });
    const taxMap = new Map(taxes.map((t) => [t.id, t]));

    // Increment PO sequence
    const updatedBiz = await tx.business.update({
      where: { id: businessId },
      data: { purchaseOrderSequence: { increment: 1 } },
      select: { purchaseOrderSequence: true },
    });
    const poNumber = `PO-${updatedBiz.purchaseOrderSequence.toString().padStart(6, "0")}`;

    let subtotalCents = 0n;
    let taxTotalCents = 0n;

    const lineCalculations = input.lines.map((line) => {
      const item = itemMap.get(line.itemId)!;
      const qty = decimal(line.quantity, 6);
      const price = decimal(line.unitPrice, 2);

      const lineBaseCents = roundHalfUp(qty * price, 1_000_000n);

      let lineTaxCents = 0n;
      if (line.taxProfileId) {
        const tax = taxMap.get(line.taxProfileId);
        if (tax) {
          const rate = decimal(tax.rate.toString(), 2);
          lineTaxCents = roundHalfUp(lineBaseCents * rate, 10000n);
        }
      }

      const lineTotalCents = lineBaseCents + lineTaxCents;
      subtotalCents += lineBaseCents;
      taxTotalCents += lineTaxCents;

      return {
        itemId: item.id,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        taxProfileId: line.taxProfileId ?? null,
        taxAmount: render(lineTaxCents, 2),
        lineTotal: render(lineTotalCents, 2),
      };
    });

    const grandTotalCents = subtotalCents + taxTotalCents;

    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        businessId,
        partyId: input.partyId,
        locationId: input.locationId,
        number: poNumber,
        status: "Issued",
        expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
        subtotal: new Prisma.Decimal(render(subtotalCents, 2)),
        taxTotal: new Prisma.Decimal(render(taxTotalCents, 2)),
        grandTotal: new Prisma.Decimal(render(grandTotalCents, 2)),
        notes: input.notes ?? null,
        snapshot: input as unknown as Prisma.InputJsonValue,
        lines: {
          create: lineCalculations.map((l) => ({
            itemId: l.itemId,
            quantity: new Prisma.Decimal(l.quantity),
            convertedQuantity: new Prisma.Decimal("0"),
            unitPrice: new Prisma.Decimal(l.unitPrice),
            taxProfileId: l.taxProfileId,
            taxAmount: new Prisma.Decimal(l.taxAmount),
            lineTotal: new Prisma.Decimal(l.lineTotal),
          })),
        },
      },
      include: {
        lines: true,
        party: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    });

    return {
      result: purchaseOrder,
      change: { id: purchaseOrder.id, version: 1, number: poNumber },
    };
  });
}

export async function updatePurchaseOrderStatus(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  orderId: string,
  newStatus: PurchaseOrderStatus,
) {
  if (!["Owner", "Accountant", "StockManager"].includes(role)) {
    throw new PurchaseOrderConflict("Permission required to update purchase order status");
  }

  return withBusinessChange(db, businessId, userId, "purchase_order.status_update", async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: orderId, businessId },
    });
    if (!po) throw new PurchaseOrderConflict("Purchase order not found");

    if (["Fulfilled", "Closed"].includes(po.status) && newStatus !== po.status) {
      throw new PurchaseOrderConflict(`Cannot alter purchase order once ${po.status}`);
    }

    const updated = await tx.purchaseOrder.update({
      where: { businessId_id: { businessId, id: orderId } },
      data: { status: newStatus, version: { increment: 1 } },
      include: {
        lines: true,
        party: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    });

    return {
      result: updated,
      change: { id: orderId, version: updated.version, status: newStatus },
    };
  });
}

export async function convertPurchaseOrderToBill(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  orderId: string,
  input: PurchaseOrderConvertInput,
) {
  if (!["Owner", "Accountant"].includes(role)) {
    throw new PurchaseOrderConflict("Owner or Accountant permission required to convert purchase orders to bills");
  }

  const po = await withTenantContext(db, { businessId, userId }, async (tx) =>
    tx.purchaseOrder.findFirst({
      where: { id: orderId, businessId },
      include: { lines: true, party: true, location: true },
    }),
  );
  if (!po) throw new PurchaseOrderConflict("Purchase order not found");

  if (["Fulfilled", "Expired", "Closed"].includes(po.status)) {
    throw new PurchaseOrderConflict(`Purchase order cannot be converted when in status ${po.status}`);
  }

  const conversionSpec = input.lines.map((l) => ({
    lineId: l.lineId,
    quantityToConvert: l.quantityToConvert,
    totalQuantity: po.lines.find((pol) => pol.id === l.lineId)?.quantity.toString() ?? "0",
    previouslyConvertedQuantity:
      po.lines.find((pol) => pol.id === l.lineId)?.convertedQuantity.toString() ?? "0",
  }));

  const allLinesSpec = po.lines.map((l) => ({
    id: l.id,
    quantity: l.quantity.toString(),
    convertedQuantity: l.convertedQuantity.toString(),
  }));

  let validation;
  try {
    validation = validatePurchaseOrderConversion(conversionSpec, allLinesSpec);
  } catch (err) {
    throw new PurchaseOrderConflict(err instanceof Error ? err.message : String(err));
  }

  // Build standard purchase bill input
  const purchaseId = crypto.randomUUID();
  const commandId = crypto.randomUUID();
  const businessDate = new Date().toISOString().slice(0, 10);

  const poLineMap = new Map(po.lines.map((l) => [l.id, l]));

  const purchaseLines = input.lines.map((cl) => {
    const pol = poLineMap.get(cl.lineId)!;
    return {
      id: crypto.randomUUID(),
      itemId: pol.itemId,
      conversionId: null,
      taxProfileId: pol.taxProfileId,
      quantity: cl.quantityToConvert,
      unitCost: pol.unitPrice.toString(),
      discount: "0.00",
    };
  });

  const purchaseDraftInput = {
    id: purchaseId,
    commandId,
    locationId: po.locationId,
    partyId: po.partyId,
    supplierInvoiceNumber: input.supplierInvoiceNumber,
    allowDuplicateSupplierReference: false,
    businessDate,
    documentDiscount: "0.00",
    lines: purchaseLines,
    payments: [],
  };

  // Save and post standard purchase bill
  await createPurchaseDraft(db, businessId, userId, role, purchaseDraftInput);
  const postedPurchase = await postPurchase(db, businessId, userId, role, {
    id: purchaseId,
    commandId,
  });

  // Update PO lines and status
  const newStatus: PurchaseOrderStatus = validation.isDocumentFulfilled ? "Fulfilled" : "PartiallyFulfilled";
  const updatedPo = await withBusinessChange(db, businessId, userId, "purchase_order.convert", async (tx) => {
    for (const lineRes of validation.lines) {
      await tx.purchaseOrderLine.update({
        where: { businessId_id: { businessId, id: lineRes.lineId } },
        data: {
          convertedQuantity: new Prisma.Decimal(lineRes.newConvertedQuantity),
        },
      });
    }

    const res = await tx.purchaseOrder.update({
      where: { businessId_id: { businessId, id: orderId } },
      data: {
        status: newStatus,
        version: { increment: 1 },
      },
      include: {
        lines: true,
        party: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    });

    return {
      result: res,
      change: { id: orderId, version: res.version, status: newStatus, purchaseId },
    };
  });

  return {
    purchase: postedPurchase,
    purchaseOrder: updatedPo,
  };
}

import crypto from "node:crypto";
import {
  type PrismaClient,
  withBusinessChange,
  withTenantContext,
  Prisma,
} from "@business/db";
import {
  type QuotationInput,
  type QuotationConvertInput,
  type QuotationStatus,
} from "@business/contracts";
import { validateQuoteConversion } from "@business/domain";
import { createSaleDraft, postSale } from "./sales.js";

export class QuotationConflict extends Error {}

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

export async function createQuotation(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  input: QuotationInput,
) {
  if (!["Owner", "Accountant", "Cashier"].includes(role)) {
    throw new QuotationConflict("Trade permission required to create quotations");
  }

  return withBusinessChange(db, businessId, userId, "quotation.create", async (tx) => {
    const party = await tx.party.findFirst({
      where: { id: input.partyId, businessId, isCustomer: true, archivedAt: null },
    });
    if (!party) throw new QuotationConflict("Customer not found or archived");

    const itemIds = input.lines.map((l) => l.itemId);
    const items = await tx.item.findMany({
      where: { id: { in: itemIds }, businessId, archivedAt: null },
    });
    const itemMap = new Map(items.map((i) => [i.id, i]));
    if (items.length !== new Set(itemIds).size) {
      throw new QuotationConflict("One or more items not found or archived");
    }

    const taxIds = input.lines.map((l) => l.taxProfileId).filter((id): id is string => !!id);
    const taxes = await tx.taxProfile.findMany({
      where: { id: { in: taxIds }, businessId, archivedAt: null },
    });
    const taxMap = new Map(taxes.map((t) => [t.id, t]));

    // Increment quotation sequence
    const updatedBiz = await tx.business.update({
      where: { id: businessId },
      data: { quotationSequence: { increment: 1 } },
      select: { quotationSequence: true },
    });
    const quoteNumber = `QT-${updatedBiz.quotationSequence.toString().padStart(6, "0")}`;

    let subtotalCents = 0n;
    let taxTotalCents = 0n;

    const lineCalculations = input.lines.map((line) => {
      const item = itemMap.get(line.itemId)!;
      const qty = decimal(line.quantity, 6);
      const price = decimal(line.unitPrice, 2);

      // lineBase = (qty * price) / 1_000_000n rounded half up
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

    const quotation = await tx.quotation.create({
      data: {
        businessId,
        partyId: input.partyId,
        number: quoteNumber,
        status: "Issued",
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
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
      },
    });

    return {
      result: quotation,
      change: { id: quotation.id, version: 1, number: quoteNumber },
    };
  });
}

export async function updateQuotationStatus(
  db: PrismaClient,
  businessId: string,
  userId: string,
  role: string,
  quotationId: string,
  newStatus: QuotationStatus,
) {
  if (!["Owner", "Accountant", "Cashier"].includes(role)) {
    throw new QuotationConflict("Trade permission required to update quotation status");
  }

  return withBusinessChange(db, businessId, userId, "quotation.status_update", async (tx) => {
    const quote = await tx.quotation.findFirst({
      where: { id: quotationId, businessId },
    });
    if (!quote) throw new QuotationConflict("Quotation not found");

    if (["Fulfilled", "Closed"].includes(quote.status) && newStatus !== quote.status) {
      throw new QuotationConflict(`Cannot alter quotation once ${quote.status}`);
    }

    const updated = await tx.quotation.update({
      where: { businessId_id: { businessId, id: quotationId } },
      data: { status: newStatus, version: { increment: 1 } },
      include: { lines: true, party: { select: { id: true, name: true } } },
    });

    return {
      result: updated,
      change: { id: quotationId, version: updated.version, status: newStatus },
    };
  });
}

export async function convertQuotationToSale(
  db: PrismaClient,
  businessId: string,
  userId: string,
  membershipId: string,
  role: string,
  quotationId: string,
  input: QuotationConvertInput,
) {
  if (!["Owner", "Accountant", "Cashier"].includes(role)) {
    throw new QuotationConflict("Trade permission required to convert quotations to sales");
  }

  const quote = await withTenantContext(db, { businessId, userId }, async (tx) =>
    tx.quotation.findFirst({
      where: { id: quotationId, businessId },
      include: { lines: true, party: true },
    }),
  );
  if (!quote) throw new QuotationConflict("Quotation not found");

  if (["Fulfilled", "Expired", "Closed"].includes(quote.status)) {
    throw new QuotationConflict(`Quotation cannot be converted when in status ${quote.status}`);
  }

  const conversionSpec = input.lines.map((l) => ({
    lineId: l.lineId,
    quantityToConvert: l.quantityToConvert,
    totalQuantity: quote.lines.find((ql) => ql.id === l.lineId)?.quantity.toString() ?? "0",
    previouslyConvertedQuantity:
      quote.lines.find((ql) => ql.id === l.lineId)?.convertedQuantity.toString() ?? "0",
  }));

  const allLinesSpec = quote.lines.map((l) => ({
    id: l.id,
    quantity: l.quantity.toString(),
    convertedQuantity: l.convertedQuantity.toString(),
  }));

  let validation;
  try {
    validation = validateQuoteConversion(conversionSpec, allLinesSpec);
  } catch (err) {
    throw new QuotationConflict(err instanceof Error ? err.message : String(err));
  }

  // Pick location & enrolled device
  let locationId = input.locationId;
  let deviceEnrollmentId = input.deviceEnrollmentId;

  if (!locationId || !deviceEnrollmentId) {
    const device = await withTenantContext(db, { businessId, userId }, async (tx) =>
      tx.deviceEnrollment.findFirst({
        where: { businessId, membershipId, status: "Enrolled" },
      }),
    );
    if (!device) {
      throw new QuotationConflict("Active enrolled device required to record sale");
    }
    locationId = device.locationId;
    deviceEnrollmentId = device.id;
  }

  // Build standard sale input
  const saleId = crypto.randomUUID();
  const commandId = crypto.randomUUID();
  const businessDate = new Date().toISOString().slice(0, 10);

  const quoteLineMap = new Map(quote.lines.map((l) => [l.id, l]));

  const saleLines = input.lines.map((cl) => {
    const ql = quoteLineMap.get(cl.lineId)!;
    return {
      id: crypto.randomUUID(),
      itemId: ql.itemId,
      conversionId: null,
      taxProfileId: ql.taxProfileId,
      quantity: cl.quantityToConvert,
      unitPrice: ql.unitPrice.toString(),
      discount: "0.00",
    };
  });

  const saleDraftInput = {
    id: saleId,
    commandId,
    deviceEnrollmentId,
    locationId,
    partyId: quote.partyId,
    businessDate,
    documentDiscount: "0.00",
    lines: saleLines,
    payments: [],
  };

  // Save and post standard sale
  await createSaleDraft(db, businessId, userId, membershipId, role, saleDraftInput);
  const postedSale = await postSale(db, businessId, userId, { id: saleId, commandId });

  // Update quotation lines and status
  const newStatus: QuotationStatus = validation.isDocumentFulfilled ? "Fulfilled" : "PartiallyFulfilled";
  const updatedQuote = await withBusinessChange(db, businessId, userId, "quotation.convert", async (tx) => {
    for (const lineRes of validation.lines) {
      await tx.quotationLine.update({
        where: { businessId_id: { businessId, id: lineRes.lineId } },
        data: {
          convertedQuantity: new Prisma.Decimal(lineRes.newConvertedQuantity),
        },
      });
    }

    const res = await tx.quotation.update({
      where: { businessId_id: { businessId, id: quotationId } },
      data: {
        status: newStatus,
        version: { increment: 1 },
      },
      include: {
        lines: true,
        party: { select: { id: true, name: true } },
      },
    });

    return {
      result: res,
      change: { id: quotationId, version: res.version, status: newStatus, saleId },
    };
  });

  return {
    sale: postedSale,
    quotation: updatedQuote,
  };
}

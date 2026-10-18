import crypto from "node:crypto";
import { z } from "zod";
import { calculateDocument, allocatePayment } from "@business/domain";
import { type PrismaClient, type PostingCommand, postCommand, withBusinessChange, withTenantContext } from "@business/db";

const money = z.string().regex(/^\d{1,30}(?:\.\d{1,2})?$/);
const quantity = z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,6})?$/);
export const saleInput = z.object({
  id: z.uuid(), commandId: z.uuid(), deviceEnrollmentId: z.uuid(), locationId: z.uuid(),
  partyId: z.uuid().nullable(), businessDate: z.iso.date(), documentDiscount: money.default("0"),
  lines: z.array(z.object({ id: z.uuid(), itemId: z.uuid(), conversionId: z.uuid().nullable(), taxProfileId: z.uuid().nullable(),
    quantity, unitPrice: money, discount: money }).strict()).min(1).max(100),
  payments: z.array(z.object({ id: z.uuid(), accountId: z.uuid(), kind: z.enum(["Cash", "Bank"]),
    applied: money, tendered: money.nullable(), reference: z.string().trim().min(1).max(120).nullable() }).strict()).max(5),
}).strict();
export type SaleInput = z.infer<typeof saleInput>;
export class SaleConflict extends Error {}

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
export async function createSaleDraft(db: PrismaClient, businessId: string, userId: string,
  membershipId: string, role: string, input: SaleInput) {
  if (!["Owner", "Accountant", "Cashier"].includes(role)) throw new SaleConflict("Trade permission required");
  const existing = await withTenantContext(db, { businessId, userId }, async (tx) => tx.saleDocument.findFirst({
    where: { businessId, OR: [{ id: input.id }, { commandId: input.commandId }] },
  }));
  if (existing) {
    const savedInput = existing.status === "Posted" ? (existing.snapshot as { input?: unknown }).input : existing.snapshot;
    if (existing.id !== input.id || JSON.stringify(savedInput) !== JSON.stringify(input)) throw new SaleConflict("Draft identity already used with different content");
    return existing;
  }
  return withBusinessChange(db, businessId, userId, "sale.draft", async (tx) => {
    const device = await tx.deviceEnrollment.findFirst({ where: { id: input.deviceEnrollmentId,
      businessId, membershipId, locationId: input.locationId, status: "Enrolled" } });
    if (!device) throw new SaleConflict("Choose your enrolled device and location");
    const result = await tx.saleDocument.create({ data: { id: input.id, businessId, commandId: input.commandId,
      deviceEnrollmentId: input.deviceEnrollmentId, locationId: input.locationId, partyId: input.partyId,
      businessDate: new Date(input.businessDate), snapshot: input } });
    return { result, change: { id: result.id, version: 1 } };
  });
}

export async function postSale(db: PrismaClient, businessId: string, userId: string, input: { id: string; commandId: string }) {
  const prepared = await withTenantContext(db, { businessId, userId }, async (tx) => {
    const draft = await tx.saleDocument.findFirst({ where: { id: input.id, commandId: input.commandId, businessId } });
    if (!draft) throw new SaleConflict("Saved draft not found");
    if (draft.status === "Posted") return { posted: draft } as const;
    const data = saleInput.parse(draft.snapshot);
    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    const head = await tx.syncHead.findUniqueOrThrow({ where: { businessId } });
    const device = await tx.deviceEnrollment.findFirst({ where: { id: data.deviceEnrollmentId, businessId, status: "Enrolled" } });
    if (!device || device.locationId !== data.locationId) throw new SaleConflict("Device or location is no longer active");
    const items = await tx.item.findMany({ where: { businessId, id: { in: data.lines.map((line) => line.itemId) }, archivedAt: null } });
    const accounts = await tx.account.findMany({ where: { businessId, archivedAt: null } });
    const party = data.partyId ? await tx.party.findFirst({ where: { id: data.partyId, businessId, isCustomer: true, archivedAt: null } }) : null;
    if (data.partyId && !party) throw new SaleConflict("Customer is missing or archived");
    const byItem = new Map(items.map((item) => [item.id, item]));
    const byAccount = new Map(accounts.map((account) => [account.id, account]));
    const byCode = new Map(accounts.map((account) => [account.code, account]));
    const required = ["OPEN_RECEIVABLE", "SALE_REVENUE", "SALE_TAX", "SALE_COGS", "OPEN_INVENTORY"];
    if (required.some((code) => !byCode.has(code))) throw new SaleConflict("Owner must initialize posting accounts before issuing sales");
    const taxIds = data.lines.map((line) => line.taxProfileId).filter((id): id is string => !!id);
    const taxes = await tx.taxProfile.findMany({ where: { businessId, id: { in: taxIds } } });
    const byTax = new Map(taxes.map((tax) => [tax.id, tax]));
    const conversions = await tx.itemUnitConversion.findMany({ where: { businessId, id: { in: data.lines.map((line) => line.conversionId).filter((id): id is string => !!id) }, archivedAt: null } });
    const byConversion = new Map(conversions.map((conversion) => [conversion.id, conversion]));
    const calculationLines = data.lines.map((line) => {
      const item = byItem.get(line.itemId);
      if (!item) throw new SaleConflict("An item is missing or archived");
      const conversion = line.conversionId ? byConversion.get(line.conversionId) : null;
      if (line.conversionId && (!conversion || conversion.itemId !== item.id || item.kind !== "Goods")) throw new SaleConflict("Invalid item unit");
      const tax = line.taxProfileId ? byTax.get(line.taxProfileId) : null;
      if (line.taxProfileId && (!tax || tax.archivedAt)) throw new SaleConflict("Tax profile is missing or archived");
      return { id: line.id, quantity: line.quantity, conversion: conversion?.factor.toString() ?? "1",
        conversionVersion: conversion?.version ?? 1, unitPrice: line.unitPrice,
        lineDiscount: { kind: "amount" as const, value: line.discount },
        tax: { mode: (tax?.mode.toLowerCase() ?? "exclusive") as "exclusive" | "inclusive", percent: tax?.rate.toString() ?? "0" } };
    });
    if (new Set(data.lines.map((line) => line.id)).size !== data.lines.length ||
      new Set(data.payments.map((payment) => payment.id)).size !== data.payments.length) throw new SaleConflict("Duplicate line or payment ID");
    const calculated = calculateDocument({ lines: calculationLines, documentDiscount: data.documentDiscount });
    if (decimal(calculated.total, 2) === 0n) throw new SaleConflict("Sale total must be greater than zero");
    let cash = 0n, bank = 0n, tender = 0n;
    for (const payment of data.payments) {
      const account = byAccount.get(payment.accountId);
      if (!account || account.kind !== payment.kind || decimal(payment.applied, 2) === 0n) throw new SaleConflict("Invalid payment account or amount");
      if (payment.kind === "Cash") {
        if (payment.reference !== null || payment.tendered === null) throw new SaleConflict("Cash requires tendered amount");
        cash += decimal(payment.applied, 2); tender += decimal(payment.tendered, 2);
      } else {
        if (!payment.reference || payment.tendered !== null) throw new SaleConflict("Bank requires a manual reference");
        bank += decimal(payment.applied, 2);
      }
    }
    const allocation = allocatePayment({ total: calculated.total, cashApplied: render(cash, 2),
      bankApplied: render(bank, 2), cashTendered: render(tender, 2) });
    if (decimal(allocation.receivable, 2) > 0n && !party) throw new SaleConflict("Choose a customer for a sale with remaining credit");
    const stockEffects: NonNullable<PostingCommand["stockEffects"]>[number][] = [];
    let costTotal = 0n;
    const balances = new Map<string, { quantity: bigint; value: bigint }>();
    for (const [index, line] of data.lines.entries()) {
      const item = byItem.get(line.itemId)!;
      if (item.kind !== "Goods") continue;
      let balance = balances.get(item.id);
      if (!balance) {
        const movements = await tx.stockMovement.findMany({ where: { businessId, itemId: item.id, locationId: data.locationId } });
        balance = { quantity: movements.reduce((sum, row) => sum + decimal(row.quantityDelta.toString().replace("-", ""), 6) * (row.quantityDelta.isNegative() ? -1n : 1n), 0n),
          value: movements.reduce((sum, row) => sum + decimal(row.valueDelta.toString().replace("-", ""), 2) * (row.valueDelta.isNegative() ? -1n : 1n), 0n) };
        balances.set(item.id, balance);
      }
      const sold = decimal(calculated.lines[index].quantityBase, 6);
      if (balance.quantity < sold || balance.quantity <= 0n || balance.value < 0n) throw new SaleConflict("Insufficient valued stock; resolve opening or purchase before sale");
      const cost = sold === balance.quantity ? balance.value : (balance.value * sold * 2n + balance.quantity) / (2n * balance.quantity);
      balance.quantity -= sold; balance.value -= cost; costTotal += cost;
      stockEffects.push({ id: stableId(`${data.commandId}:stock:${line.id}`), itemId: item.id, sourceLineId: line.id,
        locationId: data.locationId, movementKind: "sale", leg: "out", quantityDelta: `-${calculated.lines[index].quantityBase}`,
        valueDelta: `-${render(cost, 2)}`, valuationStatus: "Resolved" });
    }
    const journalLines: PostingCommand["lines"][number][] = [];
    const debit = (key: string, accountId: string, amount: string) => { if (decimal(amount, 2)) journalLines.push({ id: stableId(`${data.commandId}:${key}`), accountId, debit: amount, credit: "0" }); };
    const credit = (key: string, accountId: string, amount: string) => { if (decimal(amount, 2)) journalLines.push({ id: stableId(`${data.commandId}:${key}`), accountId, debit: "0", credit: amount }); };
    debit("receivable", byCode.get("OPEN_RECEIVABLE")!.id, calculated.total);
    credit("revenue", byCode.get("SALE_REVENUE")!.id, calculated.base);
    credit("tax", byCode.get("SALE_TAX")!.id, calculated.tax);
    for (const payment of data.payments) {
      debit(`payment:${payment.id}`, payment.accountId, payment.applied);
    }
    credit("payment-clearing", byCode.get("OPEN_RECEIVABLE")!.id, render(cash + bank, 2));
    debit("cogs", byCode.get("SALE_COGS")!.id, render(costTotal, 2));
    credit("inventory", byCode.get("OPEN_INVENTORY")!.id, render(costTotal, 2));
    const command: PostingCommand = { businessId, userId, commandId: data.commandId,
      deviceEnrollmentId: data.deviceEnrollmentId, sourceEventId: stableId(`${data.commandId}:event`),
      journalEntryId: stableId(`${data.commandId}:journal`), datasetEpoch: business.datasetEpoch,
      schemaVersion: 1, calculationVersion: 1, businessDate: data.businessDate, effectKind: "sale",
      postingKind: "sale.invoice", lines: journalLines, stockEffects,
      metadata: { documentId: data.id, input: data, calculated } };
    const units = await tx.unit.findMany({ where: { businessId } });
    const byUnit = new Map(units.map((unit) => [unit.id, unit.name]));
    const itemSnapshots = data.lines.map((line, index) => {
      const item = byItem.get(line.itemId)!;
      const conversion = line.conversionId ? byConversion.get(line.conversionId) : null;
      return { name: item.name, kind: item.kind, barcode: item.barcode,
        unitName: byUnit.get(conversion?.unitId ?? item.baseUnitId ?? "") ?? "Each",
        tax: calculationLines[index].tax, conversion: calculationLines[index].conversion };
    });
    return { draft, data, device, party, businessName: business.name, itemSnapshots, calculated, allocation, calculationLines, command,
      expectedCursor: head.committedCursor.toString(), costTotal: render(costTotal, 2) } as const;
  });
  if ("posted" in prepared) return prepared.posted;
  await postCommand(db, prepared.command, {
    beforePosting: async (tx, cursor) => {
      if (cursor.toString() !== prepared.expectedCursor) throw new SaleConflict("Business changed since calculation; retry the saved draft");
      const draft = await tx.saleDocument.findFirst({ where: { id: input.id, businessId, status: "Draft", version: prepared.draft.version } });
      if (!draft) throw new SaleConflict("Draft changed while posting");
    },
    beforeCommit: async (tx) => {
      const device = await tx.deviceEnrollment.update({ where: { id: prepared.device.id }, data: { saleSequence: { increment: 1 } } });
      const number = `${device.numberPrefix}-${device.saleSequence.toString().padStart(6, "0")}`;
      const snapshot = { input: prepared.data, calculation: prepared.calculated, cost: prepared.costTotal,
        number, businessName: prepared.businessName, partyName: prepared.party?.name ?? "Walk-in", lines: prepared.data.lines.map((line, index) => ({
          ...line, ...prepared.itemSnapshots[index], calculated: prepared.calculated.lines[index] })),
        payment: prepared.allocation };
      await tx.saleDocument.update({ where: { id: input.id }, data: { status: "Posted", version: { increment: 1 },
        number, sourceEventId: prepared.command.sourceEventId, snapshot: JSON.parse(JSON.stringify(snapshot)), total: prepared.calculated.total,
        paid: render(decimal(prepared.calculated.total, 2) - decimal(prepared.allocation.receivable, 2), 2),
        due: prepared.allocation.receivable, postedAt: new Date() } });
      for (let index = 0; index < prepared.data.lines.length; index++) {
        const line = prepared.data.lines[index];
        await tx.saleLine.create({ data: { id: line.id, businessId, saleId: input.id, itemId: line.itemId,
          snapshot: JSON.parse(JSON.stringify({ ...line, ...prepared.itemSnapshots[index], calculated: prepared.calculated.lines[index] })) } });
      }
      for (const payment of prepared.data.payments) await tx.salePayment.create({ data: {
        id: payment.id, businessId, saleId: input.id, accountId: payment.accountId,
        kind: payment.kind, applied: payment.applied, tendered: payment.tendered,
        reference: payment.reference,
      } });
    },
  });
  return withTenantContext(db, { businessId, userId }, (tx) => tx.saleDocument.findUniqueOrThrow({ where: { id: input.id } }));
}

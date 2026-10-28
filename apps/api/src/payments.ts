import crypto from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient, postCommand, withTenantContext } from "@business/db";
import { validatePaymentAllocations, type PaymentAllocationPlan } from "@business/domain";

const nonZeroMoney = z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,2})?$/);

export const paymentAllocationInput = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  allocatedAmount: nonZeroMoney,
});

export const paymentInput = z.object({
  id: z.string().uuid(),
  commandId: z.string().uuid(),
  partyId: z.string().uuid(),
  accountId: z.string().uuid(),
  paymentKind: z.enum(["PaymentIn", "PaymentOut"]),
  amount: nonZeroMoney,
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  allocations: z.array(paymentAllocationInput).default([]),
});

export type PaymentInput = z.infer<typeof paymentInput>;

export class PaymentConflict extends Error {}

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

export interface OpenDocumentSummary {
  documentId: string;
  number: string;
  businessDate: string;
  total: string;
  remainingDue: string;
}

export async function getPartyOpenDocuments(
  db: PrismaClient,
  businessId: string,
  userId: string,
  partyId: string,
  paymentKind: "PaymentIn" | "PaymentOut",
): Promise<OpenDocumentSummary[]> {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    if (paymentKind === "PaymentIn") {
      const sales = await tx.saleDocument.findMany({
        where: { businessId, partyId, status: "Posted" },
        select: {
          id: true,
          number: true,
          businessDate: true,
          total: true,
          paid: true,
          due: true,
          paymentAllocations: { select: { allocatedAmount: true } },
        },
        orderBy: { businessDate: "asc" },
      });

      const saleIds = sales.map((s) => s.id);
      const creditNotes = saleIds.length > 0
        ? await tx.creditNote.findMany({
            where: { businessId, partyId, status: "Posted", originalDocumentId: { in: saleIds } },
            select: { originalDocumentId: true, allocatedCredit: true },
          })
        : [];

      const creditNoteReductions = new Map<string, bigint>();
      for (const cn of creditNotes) {
        if (!cn.originalDocumentId) continue;
        const current = creditNoteReductions.get(cn.originalDocumentId) ?? 0n;
        creditNoteReductions.set(
          cn.originalDocumentId,
          current + decimal(cn.allocatedCredit ? cn.allocatedCredit.toString() : "0.00", 2),
        );
      }

      const results: OpenDocumentSummary[] = [];
      for (const sale of sales) {
        const origDue = decimal(sale.due ? sale.due.toString() : "0.00", 2);
        const cnReductions = creditNoteReductions.get(sale.id) ?? 0n;
        const paymentReductions = sale.paymentAllocations.reduce(
          (sum, a) => sum + decimal(a.allocatedAmount.toString(), 2),
          0n,
        );
        const remainingDue = origDue - cnReductions - paymentReductions;
        if (remainingDue > 0n) {
          results.push({
            documentId: sale.id,
            number: sale.number ?? sale.id.slice(0, 8),
            businessDate: sale.businessDate.toISOString().slice(0, 10),
            total: sale.total ? sale.total.toString() : "0.00",
            remainingDue: render(remainingDue, 2),
          });
        }
      }
      return results;
    } else {
      const purchases = await tx.purchaseDocument.findMany({
        where: { businessId, partyId, status: "Posted" },
        select: {
          id: true,
          number: true,
          businessDate: true,
          total: true,
          paid: true,
          due: true,
          paymentAllocations: { select: { allocatedAmount: true } },
        },
        orderBy: { businessDate: "asc" },
      });

      const purchaseIds = purchases.map((p) => p.id);
      const debitNotes = purchaseIds.length > 0
        ? await tx.creditNote.findMany({
            where: {
              businessId,
              partyId,
              status: "Posted",
              kind: "PurchaseReturn",
              originalDocumentId: { in: purchaseIds },
            },
            select: { originalDocumentId: true, allocatedCredit: true },
          })
        : [];

      const debitNoteReductions = new Map<string, bigint>();
      for (const dn of debitNotes) {
        if (!dn.originalDocumentId) continue;
        const current = debitNoteReductions.get(dn.originalDocumentId) ?? 0n;
        debitNoteReductions.set(
          dn.originalDocumentId,
          current + decimal(dn.allocatedCredit ? dn.allocatedCredit.toString() : "0.00", 2),
        );
      }

      const results: OpenDocumentSummary[] = [];
      for (const purchase of purchases) {
        const origDue = decimal(purchase.due ? purchase.due.toString() : "0.00", 2);
        const dnReductions = debitNoteReductions.get(purchase.id) ?? 0n;
        const paymentReductions = purchase.paymentAllocations.reduce(
          (sum, a) => sum + decimal(a.allocatedAmount.toString(), 2),
          0n,
        );
        const remainingDue = origDue - dnReductions - paymentReductions;
        if (remainingDue > 0n) {
          results.push({
            documentId: purchase.id,
            number: purchase.number ?? purchase.id.slice(0, 8),
            businessDate: purchase.businessDate.toISOString().slice(0, 10),
            total: purchase.total ? purchase.total.toString() : "0.00",
            remainingDue: render(remainingDue, 2),
          });
        }
      }
      return results;
    }
  });
}

export async function createPaymentDraft(
  db: PrismaClient,
  businessId: string,
  userId: string,
  input: PaymentInput,
) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    const existing = await tx.payment.findFirst({
      where: { businessId, id: input.id },
    });
    if (existing && existing.status === "Posted") {
      throw new PaymentConflict("Cannot update a posted payment");
    }

    const party = await tx.party.findFirst({
      where: { businessId, id: input.partyId, archivedAt: null },
    });
    if (!party) throw new PaymentConflict("Party not found or archived");

    const account = await tx.account.findFirst({
      where: { businessId, id: input.accountId, archivedAt: null, kind: { in: ["Cash", "Bank"] } },
    });
    if (!account) throw new PaymentConflict("Payment account must be active Cash or Bank");

    const openDocs = await getPartyOpenDocuments(db, businessId, userId, input.partyId, input.paymentKind);
    const duesMap = new Map(openDocs.map((d) => [d.documentId, d.remainingDue]));

    let plan: PaymentAllocationPlan;
    try {
      plan = validatePaymentAllocations(input.amount, input.allocations, duesMap);
    } catch (err: unknown) {
      throw new PaymentConflict((err as Error).message);
    }

    const sourceEventId = stableId(`${input.commandId}:payment:event`);

    if (existing) {
      await tx.paymentAllocation.deleteMany({
        where: { businessId, paymentId: input.id },
      });

      return tx.payment.update({
        where: { id: input.id },
        data: {
          partyId: input.partyId,
          accountId: input.accountId,
          paymentKind: input.paymentKind,
          amount: plan.totalAmount,
          allocatedAmount: plan.allocatedAmount,
          unallocatedAmount: plan.unallocatedAmount,
          reference: input.reference ?? null,
          note: input.note ?? null,
          businessDate: new Date(input.businessDate),
          allocations: {
            create: plan.allocations.map((a) => ({
              id: a.id,
              ...(input.paymentKind === "PaymentIn"
                ? { saleDocumentId: a.documentId }
                : { purchaseDocumentId: a.documentId }),
              allocatedAmount: a.allocatedAmount,
            })),
          },
        },
        include: {
          party: { select: { name: true } },
          account: { select: { name: true, kind: true } },
          allocations: true,
        },
      });
    }

    return tx.payment.create({
      data: {
        id: input.id,
        businessId,
        commandId: input.commandId,
        sourceEventId,
        partyId: input.partyId,
        accountId: input.accountId,
        paymentKind: input.paymentKind,
        amount: plan.totalAmount,
        allocatedAmount: plan.allocatedAmount,
        unallocatedAmount: plan.unallocatedAmount,
        reference: input.reference ?? null,
        note: input.note ?? null,
        status: "Draft",
        businessDate: new Date(input.businessDate),
        allocations: {
          create: plan.allocations.map((a) => ({
            id: a.id,
            ...(input.paymentKind === "PaymentIn"
              ? { saleDocumentId: a.documentId }
              : { purchaseDocumentId: a.documentId }),
            allocatedAmount: a.allocatedAmount,
          })),
        },
      },
      include: {
        party: { select: { name: true } },
        account: { select: { name: true, kind: true } },
        allocations: true,
      },
    });
  });
}

export async function postPayment(
  db: PrismaClient,
  businessId: string,
  userId: string,
  input: PaymentInput,
) {
  // Check if command has already been posted idempotently
  const existingByCommand = await withTenantContext(db, { businessId, userId }, (tx) =>
    tx.payment.findFirst({
      where: { businessId, commandId: input.commandId },
      include: {
        party: { select: { name: true } },
        account: { select: { name: true, kind: true } },
        allocations: true,
      },
    }),
  );
  if (existingByCommand && existingByCommand.status === "Posted") {
    return existingByCommand;
  }

  // Pre-validate in tenant context
  const { epoch, plan, arApAccount } = await withTenantContext(
    db,
    { businessId, userId },
    async (tx) => {
      const business = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { datasetEpoch: true },
      });

      const party = await tx.party.findFirst({
        where: { businessId, id: input.partyId, archivedAt: null },
      });
      if (!party) throw new PaymentConflict("Party not found or archived");

      if (input.paymentKind === "PaymentOut" && !party.isSupplier) {
        throw new PaymentConflict("Payment out recipient must be a supplier");
      }

      const account = await tx.account.findFirst({
        where: { businessId, id: input.accountId, archivedAt: null, kind: { in: ["Cash", "Bank"] } },
      });
      if (!account) throw new PaymentConflict("Payment account must be active Cash or Bank");

      const systemAccounts = await tx.account.findMany({
        where: { businessId, archivedAt: null },
      });
      const byCode = new Map(systemAccounts.map((a) => [a.code, a]));

      const targetAccountCode = input.paymentKind === "PaymentIn" ? "OPEN_RECEIVABLE" : "OPEN_PAYABLE";
      const arApAccount = byCode.get(targetAccountCode);
      if (!arApAccount) {
        throw new PaymentConflict(`Required system account ${targetAccountCode} is missing`);
      }

      // Check cash balance for PaymentOut
      if (input.paymentKind === "PaymentOut" && account.kind === "Cash") {
        const totals = await tx.journalLine.aggregate({
          where: { businessId, accountId: input.accountId },
          _sum: { debit: true, credit: true },
        });
        const available = (totals._sum.debit ?? new Prisma.Decimal(0)).minus(
          totals._sum.credit ?? new Prisma.Decimal(0),
        );
        if (available.lessThan(new Prisma.Decimal(input.amount))) {
          throw new PaymentConflict("Not enough cash in the account for this payment");
        }
      }

      // Calculate and validate allocations
      const openDocs = await getPartyOpenDocuments(db, businessId, userId, input.partyId, input.paymentKind);
      const duesMap = new Map(openDocs.map((d) => [d.documentId, d.remainingDue]));

      let plan: PaymentAllocationPlan;
      try {
        plan = validatePaymentAllocations(input.amount, input.allocations, duesMap);
      } catch (err: unknown) {
        throw new PaymentConflict((err as Error).message);
      }

      return { epoch: business.datasetEpoch, plan, arApAccount };
    },
  );

  const sourceEventId = stableId(`${input.commandId}:payment:event`);
  const journalEntryId = stableId(`${input.commandId}:payment:journal`);
  const postingKind = input.paymentKind === "PaymentIn" ? "payment.in" : "payment.out";

  // Build double-entry lines:
  // PaymentIn: Debit Cash/Bank, Credit OPEN_RECEIVABLE
  // PaymentOut: Debit OPEN_PAYABLE, Credit Cash/Bank
  const lines =
    input.paymentKind === "PaymentIn"
      ? [
          {
            id: stableId(`${input.commandId}:payment:debit`),
            accountId: input.accountId,
            debit: plan.totalAmount,
            credit: "0.00",
          },
          {
            id: stableId(`${input.commandId}:payment:credit`),
            accountId: arApAccount.id,
            debit: "0.00",
            credit: plan.totalAmount,
          },
        ]
      : [
          {
            id: stableId(`${input.commandId}:payment:debit`),
            accountId: arApAccount.id,
            debit: plan.totalAmount,
            credit: "0.00",
          },
          {
            id: stableId(`${input.commandId}:payment:credit`),
            accountId: input.accountId,
            debit: "0.00",
            credit: plan.totalAmount,
          },
        ];

  await postCommand(
    db,
    {
      businessId,
      userId,
      commandId: input.commandId,
      sourceEventId,
      journalEntryId,
      datasetEpoch: epoch,
      schemaVersion: 1,
      calculationVersion: 1,
      businessDate: input.businessDate,
      effectKind: "allocation",
      postingKind,
      lines,
      metadata: {
        paymentId: input.id,
        partyId: input.partyId,
        paymentKind: input.paymentKind,
        accountId: input.accountId,
        amount: plan.totalAmount,
        allocatedAmount: plan.allocatedAmount,
        unallocatedAmount: plan.unallocatedAmount,
        reference: input.reference ?? null,
      },
    },
    {
      beforePosting: async (tx) => {
        // Ensure payment id is not used by an already posted payment with different command
        const existing = await tx.payment.findFirst({
          where: { businessId, id: input.id },
        });
        if (existing && existing.commandId !== input.commandId && existing.status === "Posted") {
          throw new PaymentConflict("Payment ID already used for another posted transaction");
        }
      },
      beforeCommit: async (tx) => {
        // Allocate sequence number atomically
        let number: string;
        if (input.paymentKind === "PaymentIn") {
          const updated = await tx.business.update({
            where: { id: businessId },
            data: { paymentInSequence: { increment: 1 } },
            select: { paymentInSequence: true },
          });
          number = `PAY-IN-${updated.paymentInSequence.toString().padStart(6, "0")}`;
        } else {
          const updated = await tx.business.update({
            where: { id: businessId },
            data: { paymentOutSequence: { increment: 1 } },
            select: { paymentOutSequence: true },
          });
          number = `PAY-OUT-${updated.paymentOutSequence.toString().padStart(6, "0")}`;
        }

        // Clean up draft allocations if updating from draft
        await tx.paymentAllocation.deleteMany({
          where: { businessId, paymentId: input.id },
        });

        // Upsert payment document
        await tx.payment.upsert({
          where: { id: input.id },
          create: {
            id: input.id,
            businessId,
            commandId: input.commandId,
            sourceEventId,
            partyId: input.partyId,
            accountId: input.accountId,
            paymentKind: input.paymentKind,
            number,
            amount: plan.totalAmount,
            allocatedAmount: plan.allocatedAmount,
            unallocatedAmount: plan.unallocatedAmount,
            reference: input.reference ?? null,
            note: input.note ?? null,
            status: "Posted",
            businessDate: new Date(input.businessDate),
            postedAt: new Date(),
            allocations: {
              create: plan.allocations.map((a) => ({
                id: a.id,
                ...(input.paymentKind === "PaymentIn"
                  ? { saleDocumentId: a.documentId }
                  : { purchaseDocumentId: a.documentId }),
                allocatedAmount: a.allocatedAmount,
              })),
            },
          },
          update: {
            commandId: input.commandId,
            sourceEventId,
            partyId: input.partyId,
            accountId: input.accountId,
            paymentKind: input.paymentKind,
            number,
            amount: plan.totalAmount,
            allocatedAmount: plan.allocatedAmount,
            unallocatedAmount: plan.unallocatedAmount,
            reference: input.reference ?? null,
            note: input.note ?? null,
            status: "Posted",
            businessDate: new Date(input.businessDate),
            postedAt: new Date(),
            allocations: {
              create: plan.allocations.map((a) => ({
                id: a.id,
                ...(input.paymentKind === "PaymentIn"
                  ? { saleDocumentId: a.documentId }
                  : { purchaseDocumentId: a.documentId }),
                allocatedAmount: a.allocatedAmount,
              })),
            },
          },
        });
      },
    },
  );

  return withTenantContext(db, { businessId, userId }, (tx) =>
    tx.payment.findFirstOrThrow({
      where: { businessId, commandId: input.commandId },
      include: {
        party: { select: { name: true } },
        account: { select: { name: true, kind: true } },
        allocations: true,
      },
    }),
  );
}

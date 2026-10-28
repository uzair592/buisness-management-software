import crypto from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient, postCommand, withTenantContext } from "@business/db";

const money = z.string().regex(/^\d{1,30}(?:\.\d{1,2})?$/);
const nonZeroMoney = z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,2})?$/);

export const expenseInput = z.object({
  id: z.string().uuid(),
  commandId: z.string().uuid(),
  expenseCategoryId: z.string().uuid(),
  expenseAccountId: z.string().uuid(),
  paidFromAccountId: z.string().uuid(),
  amount: nonZeroMoney,
  taxAmount: money.default("0.00"),
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type ExpenseInput = z.infer<typeof expenseInput>;

export class ExpenseConflict extends Error {}

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

export async function createExpenseDraft(
  db: PrismaClient,
  businessId: string,
  userId: string,
  input: ExpenseInput,
) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    const existing = await tx.expense.findFirst({
      where: { businessId, id: input.id },
    });
    if (existing && existing.status === "Posted") {
      throw new ExpenseConflict("Cannot update a posted expense");
    }

    const category = await tx.expenseCategory.findFirst({
      where: { businessId, id: input.expenseCategoryId, archivedAt: null },
    });
    if (!category) throw new ExpenseConflict("Expense category not found or archived");

    const expenseAccount = await tx.account.findFirst({
      where: {
        businessId,
        id: input.expenseAccountId,
        archivedAt: null,
        classification: "Expense",
      },
    });
    if (!expenseAccount) throw new ExpenseConflict("Expense account must be an active expense account");

    const paidFromAccount = await tx.account.findFirst({
      where: {
        businessId,
        id: input.paidFromAccountId,
        archivedAt: null,
        kind: { in: ["Cash", "Bank"] },
      },
    });
    if (!paidFromAccount) throw new ExpenseConflict("Paid-from account must be active Cash or Bank");

    const amountScaled = decimal(input.amount, 2);
    const taxScaled = decimal(input.taxAmount, 2);
    const exactAmount = render(amountScaled, 2);
    const exactTaxAmount = render(taxScaled, 2);
    const sourceEventId = stableId(`${input.commandId}:expense:event`);

    if (existing) {
      return tx.expense.update({
        where: { id: input.id },
        data: {
          expenseCategoryId: input.expenseCategoryId,
          expenseAccountId: input.expenseAccountId,
          paidFromAccountId: input.paidFromAccountId,
          amount: exactAmount,
          taxAmount: exactTaxAmount,
          reference: input.reference ?? null,
          note: input.note ?? null,
          businessDate: new Date(input.businessDate),
        },
        include: {
          expenseCategory: { select: { name: true } },
          expenseAccount: { select: { name: true } },
          paidFromAccount: { select: { name: true, kind: true } },
        },
      });
    }

    return tx.expense.create({
      data: {
        id: input.id,
        businessId,
        commandId: input.commandId,
        sourceEventId,
        expenseCategoryId: input.expenseCategoryId,
        expenseAccountId: input.expenseAccountId,
        paidFromAccountId: input.paidFromAccountId,
        amount: exactAmount,
        taxAmount: exactTaxAmount,
        reference: input.reference ?? null,
        note: input.note ?? null,
        status: "Draft",
        businessDate: new Date(input.businessDate),
      },
      include: {
        expenseCategory: { select: { name: true } },
        expenseAccount: { select: { name: true } },
        paidFromAccount: { select: { name: true, kind: true } },
      },
    });
  });
}

export async function postExpense(
  db: PrismaClient,
  businessId: string,
  userId: string,
  input: ExpenseInput,
) {
  // Check if command has already been posted idempotently
  const existingByCommand = await withTenantContext(db, { businessId, userId }, (tx) =>
    tx.expense.findFirst({
      where: { businessId, commandId: input.commandId },
      include: {
        expenseCategory: { select: { name: true } },
        expenseAccount: { select: { name: true } },
        paidFromAccount: { select: { name: true, kind: true } },
      },
    }),
  );
  if (existingByCommand && existingByCommand.status === "Posted") {
    return existingByCommand;
  }

  const amountScaled = decimal(input.amount, 2);
  const taxScaled = decimal(input.taxAmount, 2);
  const exactAmount = render(amountScaled, 2);
  const exactTaxAmount = render(taxScaled, 2);

  const { epoch } = await withTenantContext(db, { businessId, userId }, async (tx) => {
    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { datasetEpoch: true },
    });

    const category = await tx.expenseCategory.findFirst({
      where: { businessId, id: input.expenseCategoryId, archivedAt: null },
    });
    if (!category) throw new ExpenseConflict("Expense category not found or archived");

    const expenseAccount = await tx.account.findFirst({
      where: {
        businessId,
        id: input.expenseAccountId,
        archivedAt: null,
        classification: "Expense",
      },
    });
    if (!expenseAccount) throw new ExpenseConflict("Expense account must be an active expense account");

    const paidFromAccount = await tx.account.findFirst({
      where: {
        businessId,
        id: input.paidFromAccountId,
        archivedAt: null,
        kind: { in: ["Cash", "Bank"] },
      },
    });
    if (!paidFromAccount) throw new ExpenseConflict("Paid-from account must be active Cash or Bank");

    if (paidFromAccount.kind === "Cash") {
      const totals = await tx.journalLine.aggregate({
        where: { businessId, accountId: input.paidFromAccountId },
        _sum: { debit: true, credit: true },
      });
      const available = (totals._sum.debit ?? new Prisma.Decimal(0)).minus(
        totals._sum.credit ?? new Prisma.Decimal(0),
      );
      if (available.lessThan(new Prisma.Decimal(exactAmount))) {
        throw new ExpenseConflict("Not enough cash in the account for this expense");
      }
    }

    return { epoch: business.datasetEpoch };
  });

  const sourceEventId = stableId(`${input.commandId}:expense:event`);
  const journalEntryId = stableId(`${input.commandId}:expense:journal`);

  // Double entry lines:
  // Dr Expense Account (amount)
  // Cr Paid From Account (amount)
  const lines = [
    {
      id: stableId(`${input.commandId}:expense:debit`),
      accountId: input.expenseAccountId,
      debit: exactAmount,
      credit: "0.00",
    },
    {
      id: stableId(`${input.commandId}:expense:credit`),
      accountId: input.paidFromAccountId,
      debit: "0.00",
      credit: exactAmount,
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
      effectKind: "expense",
      postingKind: "expense.create",
      lines,
      metadata: {
        expenseId: input.id,
        expenseCategoryId: input.expenseCategoryId,
        expenseAccountId: input.expenseAccountId,
        paidFromAccountId: input.paidFromAccountId,
        amount: exactAmount,
        taxAmount: exactTaxAmount,
        reference: input.reference ?? null,
      },
    },
    {
      beforePosting: async (tx) => {
        const existing = await tx.expense.findFirst({
          where: { businessId, id: input.id },
        });
        if (existing && existing.commandId !== input.commandId && existing.status === "Posted") {
          throw new ExpenseConflict("Expense ID already used for another posted transaction");
        }
      },
      beforeCommit: async (tx) => {
        const updated = await tx.business.update({
          where: { id: businessId },
          data: { expenseSequence: { increment: 1 } },
          select: { expenseSequence: true },
        });
        const number = `EXP-${updated.expenseSequence.toString().padStart(6, "0")}`;

        await tx.expense.upsert({
          where: { id: input.id },
          create: {
            id: input.id,
            businessId,
            commandId: input.commandId,
            sourceEventId,
            expenseCategoryId: input.expenseCategoryId,
            expenseAccountId: input.expenseAccountId,
            paidFromAccountId: input.paidFromAccountId,
            number,
            amount: exactAmount,
            taxAmount: exactTaxAmount,
            reference: input.reference ?? null,
            note: input.note ?? null,
            status: "Posted",
            businessDate: new Date(input.businessDate),
            postedAt: new Date(),
          },
          update: {
            commandId: input.commandId,
            sourceEventId,
            expenseCategoryId: input.expenseCategoryId,
            expenseAccountId: input.expenseAccountId,
            paidFromAccountId: input.paidFromAccountId,
            number,
            amount: exactAmount,
            taxAmount: exactTaxAmount,
            reference: input.reference ?? null,
            note: input.note ?? null,
            status: "Posted",
            businessDate: new Date(input.businessDate),
            postedAt: new Date(),
          },
        });
      },
    },
  );

  return withTenantContext(db, { businessId, userId }, (tx) =>
    tx.expense.findFirstOrThrow({
      where: { businessId, commandId: input.commandId },
      include: {
        expenseCategory: { select: { name: true } },
        expenseAccount: { select: { name: true } },
        paidFromAccount: { select: { name: true, kind: true } },
      },
    }),
  );
}

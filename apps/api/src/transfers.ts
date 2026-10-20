import crypto from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient, postCommand, withTenantContext } from "@business/db";

export const transferInput = z.object({
  id: z.uuid(), commandId: z.uuid(), sourceAccountId: z.uuid(), destinationAccountId: z.uuid(),
  amount: z.string().regex(/^(?!0+(?:\.0+)?$)\d{1,30}(?:\.\d{1,2})?$/),
  reference: z.string().trim().min(1).max(120), businessDate: z.iso.date(),
}).strict().refine((value) => value.sourceAccountId !== value.destinationAccountId,
  "Choose different source and destination accounts");
export type TransferInput = z.infer<typeof transferInput>;
export class TransferConflict extends Error {}

function stableId(seed: string): string {
  const hash = crypto.createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function postTransfer(db: PrismaClient, businessId: string, userId: string, input: TransferInput) {
  const amount = BigInt(input.amount.split(".")[0]) * 100n +
    BigInt((input.amount.split(".")[1] ?? "").padEnd(2, "0"));
  const exactAmount = `${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`;
  const epoch = await withTenantContext(db, { businessId, userId }, async (tx) =>
    (await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { datasetEpoch: true } })).datasetEpoch);
  const sourceEventId = stableId(`${input.commandId}:transfer:event`);
  await postCommand(db, {
    businessId, userId, commandId: input.commandId, sourceEventId,
    journalEntryId: stableId(`${input.commandId}:transfer:journal`), datasetEpoch: epoch,
    schemaVersion: 1, calculationVersion: 1, businessDate: input.businessDate,
    effectKind: "transfer", postingKind: "money_transfer",
    lines: [
      { id: stableId(`${input.commandId}:transfer:debit`), accountId: input.destinationAccountId, debit: exactAmount, credit: "0" },
      { id: stableId(`${input.commandId}:transfer:credit`), accountId: input.sourceAccountId, debit: "0", credit: exactAmount },
    ],
    metadata: { transferId: input.id, sourceAccountId: input.sourceAccountId,
      destinationAccountId: input.destinationAccountId, reference: input.reference, amount: exactAmount },
  }, {
    beforePosting: async (tx) => {
      const accounts = await tx.account.findMany({ where: { businessId, archivedAt: null,
        id: { in: [input.sourceAccountId, input.destinationAccountId] }, kind: { in: ["Cash", "Bank"] } } });
      if (accounts.length !== 2) throw new TransferConflict("Both active money accounts must belong to this business");
      if (accounts.find((account) => account.id === input.sourceAccountId)?.kind === "Cash") {
        const totals = await tx.journalLine.aggregate({ where: { businessId, accountId: input.sourceAccountId },
          _sum: { debit: true, credit: true } });
        const available = (totals._sum.debit ?? new Prisma.Decimal(0)).minus(totals._sum.credit ?? new Prisma.Decimal(0));
        if (available.lessThan(exactAmount)) throw new TransferConflict("Not enough cash in the source account");
      }
      if (await tx.moneyTransfer.findFirst({ where: { businessId, id: input.id } }))
        throw new TransferConflict("Transfer ID already used for another command");
    },
    beforeCommit: async (tx) => {
      await tx.moneyTransfer.create({ data: { id: input.id, businessId, commandId: input.commandId,
        sourceEventId, sourceAccountId: input.sourceAccountId, destinationAccountId: input.destinationAccountId,
        amount: exactAmount, reference: input.reference, businessDate: new Date(input.businessDate) } });
    },
  });
  return withTenantContext(db, { businessId, userId }, (tx) => tx.moneyTransfer.findFirstOrThrow({
    where: { businessId, commandId: input.commandId },
    include: { sourceAccount: { select: { name: true } }, destinationAccount: { select: { name: true } } },
  }));
}

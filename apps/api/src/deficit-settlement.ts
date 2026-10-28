import { Prisma } from "@business/db";
import { allocateDeficitSettlement, type OpenDeficit } from "@business/domain";

export async function settleOpenDeficits(
  tx: Prisma.TransactionClient,
  businessId: string,
  itemId: string,
  receiptQuantityBase: string,
  receiptUnitCost: string,
  cogsAccountId: string,
  inventoryAccountId: string,
  _businessDate: string,
): Promise<{
  settledCount: number;
  costAdjustmentJournalLines: Array<{ accountId: string; debit: string; credit: string }>;
}> {
  // Find open provisional deficits for this business
  const openRows = await tx.provisionalDeficitCost.findMany({
    where: {
      businessId,
      status: "Open",
    },
    include: {
      sourceEvent: true,
    },
    orderBy: [
      { sourceEvent: { businessDate: "asc" } },
      { sourceEvent: { acceptedAt: "asc" } },
    ],
  });

  if (!openRows.length) {
    return { settledCount: 0, costAdjustmentJournalLines: [] };
  }

  const deficits: OpenDeficit[] = openRows.map((row) => ({
    id: row.id,
    openQuantityBase: row.quantityBase.toString(),
    provisionalCost: row.provisionalValue.toString(),
  }));

  const result = allocateDeficitSettlement(deficits, receiptQuantityBase, receiptUnitCost);

  const journalLines: Array<{ accountId: string; debit: string; credit: string }> = [];

  for (const settlement of result.settlements) {
    const adj = Number.parseFloat(settlement.valueAdjustment);
    if (adj > 0) {
      // Actual cost was higher than provisional cost: Debit COGS, Credit Inventory
      journalLines.push(
        { accountId: cogsAccountId, debit: settlement.valueAdjustment, credit: "0.00" },
        { accountId: inventoryAccountId, debit: "0.00", credit: settlement.valueAdjustment },
      );
    } else if (adj < 0) {
      // Actual cost was lower than provisional cost: Credit COGS, Debit Inventory
      const absAdj = Math.abs(adj).toFixed(2);
      journalLines.push(
        { accountId: inventoryAccountId, debit: absAdj, credit: "0.00" },
        { accountId: cogsAccountId, debit: "0.00", credit: absAdj },
      );
    }
  }

  return {
    settledCount: result.settlements.length,
    costAdjustmentJournalLines: journalLines,
  };
}

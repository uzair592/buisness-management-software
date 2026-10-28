import { Prisma, type PrismaClient, withTenantContext } from "@business/db";

function decimal(value: string, scale = 2): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0").slice(0, scale));
}

function render(value: bigint, scale = 2): string {
  const divisor = 10n ** BigInt(scale);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / divisor}.${(absolute % divisor).toString().padStart(scale, "0")}`;
}

export async function getProfitAndLossReport(
  db: PrismaClient,
  businessId: string,
  userId: string,
  filters: { startDate?: string; endDate?: string; locationId?: string },
) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    const today = new Date().toISOString().slice(0, 10);
    const startDate = filters.startDate ?? `${today.slice(0, 7)}-01`;
    const endDate = filters.endDate ?? today;

    const startObj = new Date(startDate);
    const endObj = new Date(endDate);

    // 1. REVENUE
    // a) Gross Sales (posted sale invoices total excluding tax)
    const salesWhere: Prisma.SaleDocumentWhereInput = {
      businessId,
      status: "Posted",
      businessDate: { gte: startObj, lte: endObj },
    };
    if (filters.locationId) salesWhere.locationId = filters.locationId;

    const sales = await tx.saleDocument.findMany({
      where: salesWhere,
      select: { total: true },
    });

    // Also get tax for sales
    const saleTaxLines = await tx.journalLine.aggregate({
      where: {
        businessId,
        account: { code: "SALE_TAX" },
        journalEntry: {
          businessDate: { gte: startObj, lte: endObj },
          postingKind: { contains: "sale" },
        },
      },
      _sum: { credit: true },
    });

    let grossSalesCents = 0n;
    for (const s of sales) {
      if (s.total) grossSalesCents += decimal(s.total.toString(), 2);
    }
    const saleTaxCents = saleTaxLines._sum.credit
      ? decimal(saleTaxLines._sum.credit.toString(), 2)
      : 0n;
    const netGrossSalesCents = grossSalesCents > saleTaxCents ? grossSalesCents - saleTaxCents : grossSalesCents;

    // b) Sales Returns (Credit Notes)
    const creditNotesWhere: Prisma.CreditNoteWhereInput = {
      businessId,
      status: "Posted",
      businessDate: { gte: startObj, lte: endObj },
    };
    if (filters.locationId) creditNotesWhere.locationId = filters.locationId;

    const creditNotes = await tx.creditNote.findMany({
      where: creditNotesWhere,
      select: { total: true, taxTotal: true },
    });

    let salesReturnsCents = 0n;
    for (const cn of creditNotes) {
      const tot = cn.total ? decimal(cn.total.toString(), 2) : 0n;
      const tax = cn.taxTotal ? decimal(cn.taxTotal.toString(), 2) : 0n;
      salesReturnsCents += tot > tax ? tot - tax : tot;
    }

    const netSalesCents = netGrossSalesCents > salesReturnsCents ? netGrossSalesCents - salesReturnsCents : 0n;

    // 2. COST OF GOODS SOLD (COGS)
    // a) Standard COGS debits
    const cogsDebits = await tx.journalLine.aggregate({
      where: {
        businessId,
        account: { code: "SALE_COGS" },
        journalEntry: {
          businessDate: { gte: startObj, lte: endObj },
        },
      },
      _sum: { debit: true, credit: true },
    });

    const cogsDebitCents = cogsDebits._sum.debit ? decimal(cogsDebits._sum.debit.toString(), 2) : 0n;
    const cogsCreditCents = cogsDebits._sum.credit ? decimal(cogsDebits._sum.credit.toString(), 2) : 0n;
    const netCogsCents = cogsDebitCents > cogsCreditCents ? cogsDebitCents - cogsCreditCents : 0n;

    // 3. GROSS PROFIT
    const grossProfitCents = netSalesCents - netCogsCents;
    const marginPct =
      netSalesCents > 0n
        ? ((Number(grossProfitCents) / Number(netSalesCents)) * 100).toFixed(2)
        : "0.00";

    // 4. OPERATING EXPENSES
    const expenseRecords = await tx.expense.findMany({
      where: {
        businessId,
        status: "Posted",
        businessDate: { gte: startObj, lte: endObj },
      },
      include: {
        expenseCategory: { select: { id: true, name: true } },
      },
    });

    const categoryMap = new Map<string, { id: string; name: string; amountCents: bigint }>();
    let totalExpenseCents = 0n;

    for (const e of expenseRecords) {
      const amtCents = decimal(e.amount.toString(), 2);
      totalExpenseCents += amtCents;
      const catId = e.expenseCategory.id;
      const existing = categoryMap.get(catId);
      if (existing) {
        existing.amountCents += amtCents;
      } else {
        categoryMap.set(catId, {
          id: catId,
          name: e.expenseCategory.name,
          amountCents: amtCents,
        });
      }
    }

    const expenseCategories = Array.from(categoryMap.values()).map((c) => ({
      id: c.id,
      name: c.name,
      amount: render(c.amountCents, 2),
    }));

    // 5. NET OPERATING PROFIT
    const netOperatingProfitCents = grossProfitCents - totalExpenseCents;

    // 6. COVERAGE & PROVISIONAL DEFICITS
    const openDeficits = await tx.provisionalDeficitCost.count({
      where: { businessId, status: "Open" },
    });

    return {
      period: { startDate, endDate },
      revenue: {
        grossSales: render(netGrossSalesCents, 2),
        salesReturns: render(salesReturnsCents, 2),
        netSales: render(netSalesCents, 2),
      },
      cogs: {
        salesCogs: render(cogsDebitCents, 2),
        deficitSettlements: "0.00",
        returnRestockReversals: render(cogsCreditCents, 2),
        netCogs: render(netCogsCents, 2),
      },
      grossProfit: {
        amount: render(grossProfitCents, 2),
        marginPercentage: marginPct,
      },
      expenses: {
        categories: expenseCategories,
        totalExpenses: render(totalExpenseCents, 2),
      },
      netOperatingProfit: render(netOperatingProfitCents, 2),
      coverage: {
        openDeficitsCount: openDeficits,
        isProvisional: openDeficits > 0,
      },
    };
  });
}

export async function getTrialBalanceReport(
  db: PrismaClient,
  businessId: string,
  userId: string,
  filters: { asOfDate?: string },
) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    const asOfDate = filters.asOfDate ?? new Date().toISOString().slice(0, 10);
    const asOfObj = new Date(asOfDate);

    // Get all accounts
    const accounts = await tx.account.findMany({
      where: { businessId, archivedAt: null },
      orderBy: [{ classification: "asc" }, { code: "asc" }],
    });

    // Query journal line sums per account up to asOfDate
    const lineSums = await tx.journalLine.groupBy({
      by: ["accountId"],
      where: {
        businessId,
        journalEntry: {
          businessDate: { lte: asOfObj },
        },
      },
      _sum: { debit: true, credit: true },
    });

    const sumMap = new Map<string, { debit: bigint; credit: bigint }>();
    for (const s of lineSums) {
      sumMap.set(s.accountId, {
        debit: s._sum.debit ? decimal(s._sum.debit.toString(), 2) : 0n,
        credit: s._sum.credit ? decimal(s._sum.credit.toString(), 2) : 0n,
      });
    }

    let grandDebitCents = 0n;
    let grandCreditCents = 0n;

    const accountRows = accounts.map((acc) => {
      const sums = sumMap.get(acc.id) ?? { debit: 0n, credit: 0n };
      grandDebitCents += sums.debit;
      grandCreditCents += sums.credit;

      const diff = sums.debit - sums.credit;
      let netKind: "Debit" | "Credit" | "Zero" = "Zero";
      if (diff > 0n) netKind = "Debit";
      else if (diff < 0n) netKind = "Credit";

      return {
        id: acc.id,
        code: acc.code,
        name: acc.name,
        kind: acc.kind,
        totalDebit: render(sums.debit, 2),
        totalCredit: render(sums.credit, 2),
        netBalance: render(diff < 0n ? -diff : diff, 2),
        netKind,
      };
    });

    return {
      asOfDate,
      accounts: accountRows,
      totalDebits: render(grandDebitCents, 2),
      totalCredits: render(grandCreditCents, 2),
      isBalanced: grandDebitCents === grandCreditCents,
    };
  });
}

export async function getBalanceSheetReport(
  db: PrismaClient,
  businessId: string,
  userId: string,
  filters: { asOfDate?: string },
) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    const asOfDate = filters.asOfDate ?? new Date().toISOString().slice(0, 10);
    const asOfObj = new Date(asOfDate);

    // 1. Get trial balance accounts up to asOfDate
    const accounts = await tx.account.findMany({
      where: { businessId, archivedAt: null },
    });

    const lineSums = await tx.journalLine.groupBy({
      by: ["accountId"],
      where: {
        businessId,
        journalEntry: {
          businessDate: { lte: asOfObj },
        },
      },
      _sum: { debit: true, credit: true },
    });

    const sumMap = new Map<string, bigint>();
    for (const s of lineSums) {
      const d = s._sum.debit ? decimal(s._sum.debit.toString(), 2) : 0n;
      const c = s._sum.credit ? decimal(s._sum.credit.toString(), 2) : 0n;
      sumMap.set(s.accountId, d - c); // positive = debit balance, negative = credit balance
    }

    // 2. Classify Assets
    let cashBankCents = 0n;
    let arCents = 0n;
    let inventoryCents = 0n;
    let taxAssetCents = 0n;

    // 3. Classify Liabilities
    let apCents = 0n;
    let taxLiabilityCents = 0n;
    let customerAdvancesCents = 0n;

    // 4. Equity
    let openingCapitalCents = 0n;

    for (const acc of accounts) {
      const net = sumMap.get(acc.id) ?? 0n;

      if (acc.kind === "Cash" || acc.kind === "Bank") {
        if (net > 0n) cashBankCents += net;
        else if (net < 0n) apCents += -net; // Bank overdraft
      } else if (acc.code === "OPEN_RECEIVABLE") {
        if (net > 0n) arCents += net;
      } else if (acc.code === "OPEN_INVENTORY") {
        if (net > 0n) inventoryCents += net;
      } else if (acc.code === "OPEN_PAYABLE") {
        if (net < 0n) apCents += -net;
        else if (net > 0n) arCents += net; // supplier debit
      } else if (acc.code === "SALE_TAX") {
        if (net < 0n) taxLiabilityCents += -net;
        else if (net > 0n) taxAssetCents += net;
      } else if (acc.code === "OPEN_EQUITY") {
        if (net < 0n) openingCapitalCents += -net;
      }
    }

    // Customer Advances from unallocated payments in
    const unallocatedPayments = await tx.payment.findMany({
      where: {
        businessId,
        paymentKind: "PaymentIn",
        status: "Posted",
        businessDate: { lte: asOfObj },
      },
      select: { unallocatedAmount: true },
    });
    for (const p of unallocatedPayments) {
      customerAdvancesCents += decimal(p.unallocatedAmount.toString(), 2);
    }

    // Current period net profit (Income - COGS - Expenses)
    let totalIncomeCents = 0n;
    let totalExpenseCents = 0n;

    for (const acc of accounts) {
      const net = sumMap.get(acc.id) ?? 0n;
      if (acc.classification === "Income") {
        // Income has normal credit balance (negative net)
        totalIncomeCents += -net;
      } else if (acc.classification === "Expense") {
        // Expense has normal debit balance (positive net)
        totalExpenseCents += net;
      }
    }

    const currentPeriodProfitCents = totalIncomeCents - totalExpenseCents;

    const totalAssetsCents = cashBankCents + arCents + inventoryCents + taxAssetCents;
    const totalLiabilitiesCents = apCents + taxLiabilityCents + customerAdvancesCents;
    const totalEquityCents = openingCapitalCents + currentPeriodProfitCents;

    return {
      asOfDate,
      assets: {
        cashAndBank: render(cashBankCents, 2),
        accountsReceivable: render(arCents, 2),
        inventoryValue: render(inventoryCents, 2),
        taxAsset: render(taxAssetCents, 2),
        totalAssets: render(totalAssetsCents, 2),
      },
      liabilities: {
        accountsPayable: render(apCents, 2),
        taxLiability: render(taxLiabilityCents, 2),
        customerAdvances: render(customerAdvancesCents, 2),
        totalLiabilities: render(totalLiabilitiesCents, 2),
      },
      equity: {
        openingCapital: render(openingCapitalCents, 2),
        currentPeriodProfit: render(currentPeriodProfitCents, 2),
        totalEquity: render(totalEquityCents, 2),
      },
      isBalanced: totalAssetsCents === totalLiabilitiesCents + totalEquityCents,
    };
  });
}

export async function getStockValuationReport(
  db: PrismaClient,
  businessId: string,
  userId: string,
  filters: { locationId?: string; categoryId?: string; search?: string },
) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    const itemWhere: Prisma.ItemWhereInput = {
      businessId,
      archivedAt: null,
      kind: "Goods",
    };
    if (filters.categoryId) itemWhere.categoryId = filters.categoryId;
    if (filters.search) {
      itemWhere.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { sku: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    const items = await tx.item.findMany({
      where: itemWhere,
      include: {
        baseUnit: { select: { code: true } },
        category: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });

    // Query net movements per item
    const movementWhere: Prisma.StockMovementWhereInput = { businessId };
    if (filters.locationId) movementWhere.locationId = filters.locationId;

    const movements = await tx.stockMovement.groupBy({
      by: ["itemId"],
      where: movementWhere,
      _sum: { quantityDelta: true, valueDelta: true },
    });

    const movementMap = new Map<string, { qty: bigint; val: bigint }>();
    for (const m of movements) {
      if (m.itemId) {
        movementMap.set(m.itemId, {
          qty: m._sum.quantityDelta ? decimal(m._sum.quantityDelta.toString(), 6) : 0n,
          val: m._sum.valueDelta ? decimal(m._sum.valueDelta.toString(), 2) : 0n,
        });
      }
    }

    let grandQtyCents = 0n;
    let grandValCents = 0n;
    let openDeficitsCount = 0;

    const itemRows = items.map((item) => {
      const data = movementMap.get(item.id) ?? { qty: 0n, val: 0n };
      grandQtyCents += data.qty;
      grandValCents += data.val;

      const isDeficit = data.qty < 0n;
      if (isDeficit) openDeficitsCount++;

      // Unit cost: if qty > 0, val / qty
      let avgCostStr = "0.00";
      if (data.qty > 0n && data.val > 0n) {
        // data.val is scale 2, data.qty is scale 6
        // unit cost = val / (qty / 1_000_000) = (val * 1_000_000) / qty
        const costCents = (data.val * 1_000_000n) / data.qty;
        avgCostStr = render(costCents, 2);
      }

      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        categoryName: item.category?.name ?? null,
        unitCode: item.baseUnit?.code ?? "PCS",
        quantity: render(data.qty, 6),
        movingAverageCost: avgCostStr,
        totalValuation: render(data.val, 2),
        isDeficit,
      };
    });

    return {
      items: itemRows,
      totalQuantity: render(grandQtyCents, 6),
      totalValuation: render(grandValCents, 2),
      openDeficitsCount,
    };
  });
}

export async function getPartyLedgerReport(
  db: PrismaClient,
  businessId: string,
  userId: string,
  partyId: string,
) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    const party = await tx.party.findFirst({
      where: { id: partyId, businessId },
    });
    if (!party) throw new Error("Party not found");

    // Gather all posted transactions for this party
    interface LedgerEntry {
      date: string;
      createdAt: Date;
      documentNumber: string;
      documentType: string;
      reference: string | null;
      debitCents: bigint;
      creditCents: bigint;
    }

    const rawEntries: LedgerEntry[] = [];

    // 1. Sales
    const sales = await tx.saleDocument.findMany({
      where: { businessId, partyId, status: "Posted" },
      select: {
        number: true,
        businessDate: true,
        createdAt: true,
        total: true,
      },
    });
    for (const s of sales) {
      rawEntries.push({
        date: s.businessDate.toISOString().slice(0, 10),
        createdAt: s.createdAt,
        documentNumber: s.number ?? "SALE",
        documentType: "Sale Invoice",
        reference: null,
        debitCents: s.total ? decimal(s.total.toString(), 2) : 0n,
        creditCents: 0n,
      });
    }

    // 2. Customer Payments In
    const paymentsIn = await tx.payment.findMany({
      where: { businessId, partyId, paymentKind: "PaymentIn", status: "Posted" },
      select: {
        number: true,
        businessDate: true,
        createdAt: true,
        amount: true,
        reference: true,
      },
    });
    for (const p of paymentsIn) {
      rawEntries.push({
        date: p.businessDate.toISOString().slice(0, 10),
        createdAt: p.createdAt,
        documentNumber: p.number ?? "PAY-IN",
        documentType: "Payment Received",
        reference: p.reference,
        debitCents: 0n,
        creditCents: decimal(p.amount.toString(), 2),
      });
    }

    // 3. Credit Notes
    const creditNotes = await tx.creditNote.findMany({
      where: { businessId, partyId, status: "Posted" },
      select: {
        number: true,
        businessDate: true,
        createdAt: true,
        total: true,
        reason: true,
      },
    });
    for (const cn of creditNotes) {
      rawEntries.push({
        date: cn.businessDate.toISOString().slice(0, 10),
        createdAt: cn.createdAt,
        documentNumber: cn.number ?? "CN",
        documentType: "Credit Note (Return)",
        reference: cn.reason,
        debitCents: 0n,
        creditCents: cn.total ? decimal(cn.total.toString(), 2) : 0n,
      });
    }

    // 4. Purchases
    const purchases = await tx.purchaseDocument.findMany({
      where: { businessId, partyId, status: "Posted" },
      select: {
        number: true,
        supplierInvoiceNumber: true,
        businessDate: true,
        createdAt: true,
        total: true,
      },
    });
    for (const p of purchases) {
      rawEntries.push({
        date: p.businessDate.toISOString().slice(0, 10),
        createdAt: p.createdAt,
        documentNumber: p.number ?? "PUR",
        documentType: "Purchase Bill",
        reference: p.supplierInvoiceNumber,
        debitCents: 0n,
        creditCents: p.total ? decimal(p.total.toString(), 2) : 0n,
      });
    }

    // 5. Supplier Payments Out
    const paymentsOut = await tx.payment.findMany({
      where: { businessId, partyId, paymentKind: "PaymentOut", status: "Posted" },
      select: {
        number: true,
        businessDate: true,
        createdAt: true,
        amount: true,
        reference: true,
      },
    });
    for (const p of paymentsOut) {
      rawEntries.push({
        date: p.businessDate.toISOString().slice(0, 10),
        createdAt: p.createdAt,
        documentNumber: p.number ?? "PAY-OUT",
        documentType: "Payment Paid",
        reference: p.reference,
        debitCents: decimal(p.amount.toString(), 2),
        creditCents: 0n,
      });
    }

    // Sort chronologically
    rawEntries.sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    let runningCents = 0n;

    const entries = rawEntries.map((e) => {
      runningCents += e.debitCents - e.creditCents;

      return {
        date: e.date,
        documentNumber: e.documentNumber,
        documentType: e.documentType,
        reference: e.reference,
        debit: render(e.debitCents, 2),
        credit: render(e.creditCents, 2),
        runningBalance: render(runningCents, 2),
      };
    });

    const isCust = party.isCustomer;
    const remainingDueCents = runningCents > 0n ? runningCents : 0n;
    const advanceCents = runningCents < 0n ? -runningCents : 0n;

    return {
      party: {
        id: party.id,
        name: party.name,
        isCustomer: party.isCustomer,
        isSupplier: party.isSupplier,
      },
      totalReceivableDue: isCust ? render(remainingDueCents, 2) : "0.00",
      totalPayableDue: !isCust ? render(advanceCents, 2) : "0.00",
      unallocatedAdvance: render(advanceCents, 2),
      entries,
    };
  });
}

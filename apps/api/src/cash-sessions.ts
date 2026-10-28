import { Prisma, type PrismaClient, withTenantContext } from "@business/db";
import type { OpenCashSessionInput, CloseCashSessionInput } from "@business/contracts";

export class CashSessionConflict extends Error {}

function decimal(value: string, scale = 2): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0").slice(0, scale));
}

function render(value: bigint, scale = 2): string {
  const divisor = 10n ** BigInt(scale);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / divisor}.${(absolute % divisor).toString().padStart(scale, "0")}`;
}

/**
 * Calculates net cash movements in a cash account between openedAt and (closedAt or now).
 */
export async function calculateSessionExpectedCash(
  tx: Prisma.TransactionClient,
  businessId: string,
  cashAccountId: string,
  openedAt: Date,
  closedAt: Date | null,
  openingFloatStr: string,
): Promise<{ expectedAmount: string; cashInflows: string; cashOutflows: string }> {
  const timeUpper = closedAt ?? new Date();

  // Inflows:
  // 1. Cash Sales
  const salePayments = await tx.salePayment.findMany({
    where: {
      accountId: cashAccountId,
      sale: {
        businessId,
        status: "Posted",
        postedAt: { gte: openedAt, lte: timeUpper },
      },
    },
    select: { applied: true },
  });

  // 2. Payments In (Customer receipts)
  const paymentsIn = await tx.payment.findMany({
    where: {
      businessId,
      accountId: cashAccountId,
      paymentKind: "PaymentIn",
      status: "Posted",
      postedAt: { gte: openedAt, lte: timeUpper },
    },
    select: { amount: true },
  });

  // 3. Transfers In
  const transfersIn = await tx.moneyTransfer.findMany({
    where: {
      businessId,
      destinationAccountId: cashAccountId,
      createdAt: { gte: openedAt, lte: timeUpper },
    },
    select: { amount: true },
  });

  // Outflows:
  // 4. Payments Out (Supplier payouts)
  const paymentsOut = await tx.payment.findMany({
    where: {
      businessId,
      accountId: cashAccountId,
      paymentKind: "PaymentOut",
      status: "Posted",
      postedAt: { gte: openedAt, lte: timeUpper },
    },
    select: { amount: true },
  });

  // 5. Operating Expenses
  const expenses = await tx.expense.findMany({
    where: {
      businessId,
      paidFromAccountId: cashAccountId,
      status: "Posted",
      postedAt: { gte: openedAt, lte: timeUpper },
    },
    select: { amount: true },
  });

  // 6. Transfers Out
  const transfersOut = await tx.moneyTransfer.findMany({
    where: {
      businessId,
      sourceAccountId: cashAccountId,
      createdAt: { gte: openedAt, lte: timeUpper },
    },
    select: { amount: true },
  });

  // 7. Customer Credit Note Cash Refunds
  const refunds = await tx.creditNoteRefund.findMany({
    where: {
      accountId: cashAccountId,
      creditNote: {
        businessId,
        status: "Posted",
        postedAt: { gte: openedAt, lte: timeUpper },
      },
    },
    select: { amount: true },
  });

  let inflowCents = 0n;
  for (const s of salePayments) inflowCents += decimal(s.applied.toString(), 2);
  for (const p of paymentsIn) inflowCents += decimal(p.amount.toString(), 2);
  for (const t of transfersIn) inflowCents += decimal(t.amount.toString(), 2);

  let outflowCents = 0n;
  for (const p of paymentsOut) outflowCents += decimal(p.amount.toString(), 2);
  for (const e of expenses) outflowCents += decimal(e.amount.toString(), 2);
  for (const t of transfersOut) outflowCents += decimal(t.amount.toString(), 2);
  for (const r of refunds) outflowCents += decimal(r.amount.toString(), 2);

  const floatCents = decimal(openingFloatStr, 2);
  const expectedCents = floatCents + inflowCents - outflowCents;

  return {
    expectedAmount: render(expectedCents, 2),
    cashInflows: render(inflowCents, 2),
    cashOutflows: render(outflowCents, 2),
  };
}

export async function openCashSession(
  db: PrismaClient,
  businessId: string,
  userId: string,
  input: OpenCashSessionInput,
) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    // 1. Verify location, device, cash account
    const [location, device, cashAccount] = await Promise.all([
      tx.location.findFirst({ where: { businessId, id: input.locationId } }),
      tx.deviceEnrollment.findFirst({ where: { businessId, id: input.deviceId } }),
      tx.account.findFirst({ where: { businessId, id: input.cashAccountId, kind: "Cash" } }),
    ]);

    if (!location) throw new CashSessionConflict("Location not found");
    if (!device) throw new CashSessionConflict("Device enrollment not found");
    if (!cashAccount) throw new CashSessionConflict("Account must be an active Cash account");

    // 2. Check for active open session on this register / cash account
    const existing = await tx.cashSession.findFirst({
      where: {
        businessId,
        cashAccountId: input.cashAccountId,
        status: "Open",
      },
    });
    if (existing) {
      throw new CashSessionConflict(
        `There is already an active open cash session (${existing.sessionNumber}) for this cash account. Please close it first.`,
      );
    }

    // 3. Increment session sequence
    const updatedBiz = await tx.business.update({
      where: { id: businessId },
      data: { cashSessionSequence: { increment: 1 } },
      select: { cashSessionSequence: true },
    });
    const sessionNumber = `CS-${updatedBiz.cashSessionSequence.toString().padStart(6, "0")}`;

    // 4. Create open session
    const session = await tx.cashSession.create({
      data: {
        businessId,
        sessionNumber,
        locationId: input.locationId,
        deviceId: input.deviceId,
        cashAccountId: input.cashAccountId,
        openedByUserId: userId,
        openingFloat: new Prisma.Decimal(input.openingFloat || "0.00"),
        status: "Open",
      },
      include: {
        location: { select: { name: true } },
        device: { select: { deviceName: true } },
        cashAccount: { select: { name: true } },
        openedByUser: { select: { fullName: true } },
      },
    });

    return {
      id: session.id,
      sessionNumber: session.sessionNumber,
      locationId: session.locationId,
      locationName: session.location.name,
      deviceId: session.deviceId,
      deviceName: session.device.deviceName,
      cashAccountId: session.cashAccountId,
      cashAccountName: session.cashAccount.name,
      openedAt: session.openedAt.toISOString(),
      closedAt: null,
      openedByUserId: session.openedByUserId,
      openedByUserName: session.openedByUser.fullName,
      closedByUserId: null,
      closedByUserName: null,
      openingFloat: session.openingFloat.toFixed(2),
      countedAmount: null,
      expectedAmount: session.openingFloat.toFixed(2),
      varianceAmount: null,
      varianceReason: null,
      status: session.status,
      closedWatermarkCursor: null,
      createdAt: session.createdAt.toISOString(),
    };
  });
}

export async function getCurrentCashSession(
  db: PrismaClient,
  businessId: string,
  userId: string,
  query: { locationId?: string; cashAccountId?: string },
) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    const whereClause: Prisma.CashSessionWhereInput = {
      businessId,
      status: "Open",
    };
    if (query.locationId) whereClause.locationId = query.locationId;
    if (query.cashAccountId) whereClause.cashAccountId = query.cashAccountId;

    const session = await tx.cashSession.findFirst({
      where: whereClause,
      include: {
        location: { select: { name: true } },
        device: { select: { deviceName: true } },
        cashAccount: { select: { name: true } },
        openedByUser: { select: { fullName: true } },
      },
      orderBy: { openedAt: "desc" },
    });

    if (!session) return null;

    // Calculate real-time expected cash in till
    const calc = await calculateSessionExpectedCash(
      tx,
      businessId,
      session.cashAccountId,
      session.openedAt,
      null,
      session.openingFloat.toString(),
    );

    return {
      id: session.id,
      sessionNumber: session.sessionNumber,
      locationId: session.locationId,
      locationName: session.location.name,
      deviceId: session.deviceId,
      deviceName: session.device.deviceName,
      cashAccountId: session.cashAccountId,
      cashAccountName: session.cashAccount.name,
      openedAt: session.openedAt.toISOString(),
      closedAt: null,
      openedByUserId: session.openedByUserId,
      openedByUserName: session.openedByUser.fullName,
      closedByUserId: null,
      closedByUserName: null,
      openingFloat: session.openingFloat.toFixed(2),
      countedAmount: null,
      expectedAmount: calc.expectedAmount,
      cashInflows: calc.cashInflows,
      cashOutflows: calc.cashOutflows,
      varianceAmount: null,
      varianceReason: null,
      status: session.status,
      closedWatermarkCursor: null,
      createdAt: session.createdAt.toISOString(),
    };
  });
}

export async function closeCashSession(
  db: PrismaClient,
  businessId: string,
  userId: string,
  sessionId: string,
  input: CloseCashSessionInput,
) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    const session = await tx.cashSession.findFirst({
      where: { id: sessionId, businessId },
    });

    if (!session) throw new CashSessionConflict("Cash session not found");
    if (session.status === "Closed") {
      throw new CashSessionConflict("Cash session is already closed");
    }

    const closedAt = new Date();

    // 1. Calculate final expected amount
    const calc = await calculateSessionExpectedCash(
      tx,
      businessId,
      session.cashAccountId,
      session.openedAt,
      closedAt,
      session.openingFloat.toString(),
    );

    // 2. Calculate variance
    const countedCents = decimal(input.countedAmount, 2);
    const expectedCents = decimal(calc.expectedAmount, 2);
    const varianceCents = countedCents - expectedCents;
    const varianceAmount = render(varianceCents, 2);

    if (varianceCents !== 0n && (!input.varianceReason || input.varianceReason.trim().length === 0)) {
      throw new CashSessionConflict(
        `Counted cash (${input.countedAmount}) does not match expected (${calc.expectedAmount}). Please provide a variance reason.`,
      );
    }

    // 3. Capture current cursor watermark
    const syncHead = await tx.syncHead.findUnique({ where: { businessId } });
    const closedWatermarkCursor = syncHead?.committedCursor ?? null;

    // 4. Update session to Closed
    const closed = await tx.cashSession.update({
      where: { id: sessionId },
      data: {
        status: "Closed",
        closedAt,
        closedByUserId: userId,
        countedAmount: new Prisma.Decimal(input.countedAmount),
        expectedAmount: new Prisma.Decimal(calc.expectedAmount),
        varianceAmount: new Prisma.Decimal(varianceAmount),
        varianceReason: input.varianceReason?.trim() || null,
        closedWatermarkCursor,
      },
      include: {
        location: { select: { name: true } },
        device: { select: { deviceName: true } },
        cashAccount: { select: { name: true } },
        openedByUser: { select: { fullName: true } },
        closedByUser: { select: { fullName: true } },
      },
    });

    return {
      id: closed.id,
      sessionNumber: closed.sessionNumber,
      locationId: closed.locationId,
      locationName: closed.location.name,
      deviceId: closed.deviceId,
      deviceName: closed.device.deviceName,
      cashAccountId: closed.cashAccountId,
      cashAccountName: closed.cashAccount.name,
      openedAt: closed.openedAt.toISOString(),
      closedAt: closed.closedAt!.toISOString(),
      openedByUserId: closed.openedByUserId,
      openedByUserName: closed.openedByUser.fullName,
      closedByUserId: closed.closedByUserId,
      closedByUserName: closed.closedByUser?.fullName ?? null,
      openingFloat: closed.openingFloat.toFixed(2),
      countedAmount: closed.countedAmount!.toFixed(2),
      expectedAmount: closed.expectedAmount!.toFixed(2),
      varianceAmount: closed.varianceAmount!.toFixed(2),
      varianceReason: closed.varianceReason,
      status: closed.status,
      closedWatermarkCursor: closed.closedWatermarkCursor?.toString() ?? null,
      createdAt: closed.createdAt.toISOString(),
    };
  });
}

export async function listCashSessions(
  db: PrismaClient,
  businessId: string,
  userId: string,
  query: { locationId?: string; status?: string; limit?: number },
) {
  return withTenantContext(db, { businessId, userId }, async (tx) => {
    const whereClause: Prisma.CashSessionWhereInput = { businessId };
    if (query.locationId) whereClause.locationId = query.locationId;
    if (query.status && query.status !== "All") whereClause.status = query.status;

    const sessions = await tx.cashSession.findMany({
      where: whereClause,
      include: {
        location: { select: { name: true } },
        device: { select: { deviceName: true } },
        cashAccount: { select: { name: true } },
        openedByUser: { select: { fullName: true } },
        closedByUser: { select: { fullName: true } },
      },
      orderBy: { openedAt: "desc" },
      take: query.limit || 50,
    });

    return sessions.map((s) => ({
      id: s.id,
      sessionNumber: s.sessionNumber,
      locationId: s.locationId,
      locationName: s.location.name,
      deviceId: s.deviceId,
      deviceName: s.device.deviceName,
      cashAccountId: s.cashAccountId,
      cashAccountName: s.cashAccount.name,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      openedByUserId: s.openedByUserId,
      openedByUserName: s.openedByUser.fullName,
      closedByUserId: s.closedByUserId,
      closedByUserName: s.closedByUser?.fullName ?? null,
      openingFloat: s.openingFloat.toFixed(2),
      countedAmount: s.countedAmount?.toFixed(2) ?? null,
      expectedAmount: s.expectedAmount?.toFixed(2) ?? null,
      varianceAmount: s.varianceAmount?.toFixed(2) ?? null,
      varianceReason: s.varianceReason,
      status: s.status,
      closedWatermarkCursor: s.closedWatermarkCursor?.toString() ?? null,
      createdAt: s.createdAt.toISOString(),
    }));
  });
}

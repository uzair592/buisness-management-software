export const CALCULATION_VERSION = 1;
const QUANTITY = 1_000_000n;
const PERCENT = 100_000_000n;

function decimal(value: string, scale: number, signed = false): bigint {
  const pattern = new RegExp(`^${signed ? "-?" : ""}\\d+(?:\\.\\d{1,${scale}})?$`);
  if (!pattern.test(value)) throw new Error(`Invalid decimal: ${value}`);
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const amount = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"));
  return negative ? -amount : amount;
}

function render(value: bigint, scale: number): string {
  const divisor = 10n ** BigInt(scale);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / divisor}.${(absolute % divisor).toString().padStart(scale, "0")}`;
}

function halfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error("Expected non-negative ratio");
  return (numerator * 2n + denominator) / (2n * denominator);
}

export function convertToBaseQuantity(quantity: string, multiplier: string): string {
  const units = decimal(quantity, 6);
  const factor = decimal(multiplier, 6);
  if (!units || !factor) throw new Error("Quantity and conversion must be positive");
  const converted = halfUp(units * factor, QUANTITY);
  if (!converted) throw new Error("Converted quantity rounds to zero");
  return render(converted, 6);
}

export interface CalculationLine {
  id: string;
  quantity: string;
  conversion: string;
  conversionVersion: number;
  unitPrice: string;
  lineDiscount: { kind: "amount" | "percent"; value: string };
  tax: { mode: "inclusive" | "exclusive"; percent: string };
  discountEligible?: boolean;
}

export interface CalculatedLine {
  id: string;
  quantityBase: string;
  conversionVersion: number;
  gross: string;
  lineDiscount: string;
  documentDiscount: string;
  base: string;
  tax: string;
  total: string;
}

export interface CalculatedDocument {
  calculationVersion: 1;
  roundingMode: "HALF_UP";
  lines: CalculatedLine[];
  base: string;
  tax: string;
  charges: string;
  roundingAdjustment: string;
  total: string;
}

/** Distribute indivisible cents by largest remainder, breaking ties by stable line ID. */
export function allocateDiscount(
  total: bigint,
  weights: readonly { id: string; cents: bigint }[],
): Map<string, bigint> {
  if (total < 0n || weights.some((w) => w.cents < 0n)) throw new Error("Negative allocation");
  if (new Set(weights.map((w) => w.id)).size !== weights.length) throw new Error("Duplicate line ID");
  const sum = weights.reduce((s, w) => s + w.cents, 0n);
  if (total > sum || (sum === 0n && total !== 0n)) throw new Error("Discount exceeds eligible amount");
  if (!sum) return new Map(weights.map((w) => [w.id, 0n]));
  const shares = weights.map((w) => ({
    id: w.id,
    cents: (total * w.cents) / sum,
    remainder: (total * w.cents) % sum,
  }));
  let remaining = total - shares.reduce((s, w) => s + w.cents, 0n);
  shares.sort((a, b) => a.remainder === b.remainder
    ? a.id.localeCompare(b.id)
    : a.remainder > b.remainder ? -1 : 1);
  for (const share of shares) {
    if (!remaining) break;
    share.cents += 1n;
    remaining -= 1n;
  }
  return new Map(shares.map((w) => [w.id, w.cents]));
}

export function calculateDocument(input: {
  lines: readonly CalculationLine[];
  documentDiscount: string;
  charges?: string;
  roundingAdjustment?: string;
}): CalculatedDocument {
  if (!input.lines.length) throw new Error("At least one line is required");
  const preliminary = input.lines.map((line) => {
    if (!line.id || !Number.isSafeInteger(line.conversionVersion) || line.conversionVersion < 1) {
      throw new Error("Invalid line identity or conversion version");
    }
    const quantity = decimal(line.quantity, 6);
    const factor = decimal(line.conversion, 6);
    if (!quantity || !factor) throw new Error("Quantity and conversion must be positive");
    const gross = halfUp(decimal(line.unitPrice, 2) * quantity, QUANTITY);
    const rate = decimal(line.tax.percent, 6);
    if (rate > PERCENT) throw new Error("Invalid tax percentage");
    let discount: bigint;
    if (line.lineDiscount.kind === "amount") {
      discount = decimal(line.lineDiscount.value, 2);
    } else if (line.lineDiscount.kind === "percent") {
      const percentage = decimal(line.lineDiscount.value, 6);
      if (percentage > PERCENT) throw new Error("Invalid discount percentage");
      discount = halfUp(gross * percentage, PERCENT);
    } else {
      throw new Error("Invalid discount kind");
    }
    if (discount > gross) throw new Error("Line discount exceeds gross amount");
    return { line, gross, discount, rate, eligible: line.discountEligible === false ? 0n : gross - discount };
  });
  const allocations = allocateDiscount(decimal(input.documentDiscount, 2),
    preliminary.map((p) => ({ id: p.line.id, cents: p.eligible })));

  let base = 0n;
  let tax = 0n;
  const lines = preliminary.map(({ line, gross, discount, rate }) => {
    const documentDiscount = allocations.get(line.id)!;
    const taxable = gross - discount - documentDiscount;
    const lineTax = line.tax.mode === "exclusive"
      ? halfUp(taxable * rate, PERCENT)
      : line.tax.mode === "inclusive"
        ? halfUp(taxable * rate, PERCENT + rate)
        : (() => { throw new Error("Invalid tax mode"); })();
    const lineBase = line.tax.mode === "inclusive" ? taxable - lineTax : taxable;
    base += lineBase;
    tax += lineTax;
    return {
      id: line.id,
      quantityBase: convertToBaseQuantity(line.quantity, line.conversion),
      conversionVersion: line.conversionVersion,
      gross: render(gross, 2),
      lineDiscount: render(discount, 2),
      documentDiscount: render(documentDiscount, 2),
      base: render(lineBase, 2),
      tax: render(lineTax, 2),
      total: render(lineBase + lineTax, 2),
    };
  });
  const charges = decimal(input.charges ?? "0.00", 2);
  const adjustment = decimal(input.roundingAdjustment ?? "0.00", 2, true);
  const total = base + tax + charges + adjustment;
  if (total < 0n) throw new Error("Rounding adjustment exceeds total");
  return {
    calculationVersion: CALCULATION_VERSION,
    roundingMode: "HALF_UP",
    lines,
    base: render(base, 2),
    tax: render(tax, 2),
    charges: render(charges, 2),
    roundingAdjustment: render(adjustment, 2),
    total: render(total, 2),
  };
}

export function allocatePayment(input: {
  total: string;
  cashApplied: string;
  bankApplied: string;
  creditApplied?: string;
  cashTendered?: string;
}) {
  const total = decimal(input.total, 2);
  const cash = decimal(input.cashApplied, 2);
  const bank = decimal(input.bankApplied, 2);
  const credit = decimal(input.creditApplied ?? "0.00", 2);
  const tender = decimal(input.cashTendered ?? input.cashApplied, 2);
  if (cash + bank + credit > total) throw new Error("Applied payment exceeds total");
  if (tender < cash) throw new Error("Cash tender is less than cash applied");
  return {
    cashBookIncrease: render(cash, 2),
    change: render(tender - cash, 2),
    receivable: render(total - cash - bank - credit, 2),
  };
}

export function validateReturnQuantity(
  originalQuantityBase: string,
  priorReturnedQuantityBase: string,
  requestedReturnQuantityBase: string,
): { remainingQuantityBase: string } {
  const orig = decimal(originalQuantityBase, 6);
  const prior = decimal(priorReturnedQuantityBase, 6);
  const req = decimal(requestedReturnQuantityBase, 6);
  if (req <= 0n) throw new Error("Return quantity must be greater than zero");
  if (prior + req > orig) {
    throw new Error(
      `Return quantity exceeds remaining limit (original: ${originalQuantityBase}, returned: ${priorReturnedQuantityBase})`,
    );
  }
  return { remainingQuantityBase: render(orig - prior - req, 6) };
}

export function calculateStockVariance(
  countedQuantity: string,
  systemQuantity: string,
  unitCost: string,
): {
  quantityDelta: string;
  valueDelta: string;
  kind: "Surplus" | "Shortage" | "NoChange";
} {
  const counted = decimal(countedQuantity, 6);
  const system = decimal(systemQuantity, 6);
  const cost = decimal(unitCost, 2);
  const deltaQty = counted - system;
  const deltaAbs = deltaQty < 0n ? -deltaQty : deltaQty;
  const deltaValue = halfUp(deltaAbs * cost, QUANTITY);
  const signedValue = deltaQty < 0n ? -deltaValue : deltaValue;
  return {
    quantityDelta: render(deltaQty, 6),
    valueDelta: render(signedValue, 2),
    kind: deltaQty > 0n ? "Surplus" : deltaQty < 0n ? "Shortage" : "NoChange",
  };
}

export interface OpenDeficit {
  id: string;
  openQuantityBase: string;
  provisionalCost: string;
}

export interface SettledDeficit {
  id: string;
  settledQuantityBase: string;
  remainingOpenQuantityBase: string;
  provisionalCost: string;
  actualCost: string;
  unitDifference: string;
  valueAdjustment: string;
}

export function allocateDeficitSettlement(
  openDeficits: readonly OpenDeficit[],
  receiptQuantityBase: string,
  receiptUnitCost: string,
): {
  settlements: SettledDeficit[];
  remainingReceiptQuantityBase: string;
} {
  let remainingReceipt = decimal(receiptQuantityBase, 6);
  const actualCost = decimal(receiptUnitCost, 2);
  const settlements: SettledDeficit[] = [];

  for (const deficit of openDeficits) {
    if (remainingReceipt <= 0n) break;
    const openQty = decimal(deficit.openQuantityBase, 6);
    if (openQty <= 0n) continue;
    const settledQty = remainingReceipt >= openQty ? openQty : remainingReceipt;
    remainingReceipt -= settledQty;
    const remainingOpen = openQty - settledQty;
    const provCost = decimal(deficit.provisionalCost, 2);
    const unitDiff = actualCost - provCost;
    const diffAbs = unitDiff < 0n ? -unitDiff : unitDiff;
    const valueAdjAbs = halfUp(settledQty * diffAbs, QUANTITY);
    const valueAdj = unitDiff < 0n ? -valueAdjAbs : valueAdjAbs;

    settlements.push({
      id: deficit.id,
      settledQuantityBase: render(settledQty, 6),
      remainingOpenQuantityBase: render(remainingOpen, 6),
      provisionalCost: deficit.provisionalCost,
      actualCost: receiptUnitCost,
      unitDifference: render(unitDiff, 2),
      valueAdjustment: render(valueAdj, 2),
    });
  }

  return {
    settlements,
    remainingReceiptQuantityBase: render(remainingReceipt, 6),
  };
}


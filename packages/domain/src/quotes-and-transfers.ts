const QUANTITY_SCALE = 6;
const QUANTITY_FACTOR = 1_000_000n;

function parseQuantity(value: string): bigint {
  const pattern = /^\d+(?:\.\d{1,6})?$/;
  if (!pattern.test(value)) {
    throw new Error(`Invalid quantity format: ${value}. Expected non-negative decimal with at most 6 decimal places.`);
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * QUANTITY_FACTOR + BigInt(fraction.padEnd(QUANTITY_SCALE, "0"));
}

function formatQuantity(value: bigint): string {
  if (value < 0n) {
    throw new Error("Quantity cannot be negative");
  }
  const whole = value / QUANTITY_FACTOR;
  const fraction = value % QUANTITY_FACTOR;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(QUANTITY_SCALE, "0")}`.replace(/\.?0+$/, "");
}

export interface QuoteConversionLineSpec {
  lineId: string;
  totalQuantity: string;
  previouslyConvertedQuantity: string;
  quantityToConvert: string;
}

export interface QuoteConversionResult {
  lines: {
    lineId: string;
    newConvertedQuantity: string;
    remainingQuantity: string;
    isFullyConverted: boolean;
  }[];
  isDocumentFulfilled: boolean;
}

export function validateQuoteConversion(
  specs: readonly QuoteConversionLineSpec[],
  allDocumentLines: readonly { id: string; quantity: string; convertedQuantity: string }[],
): QuoteConversionResult {
  const specMap = new Map(specs.map((s) => [s.lineId, s]));

  const lineResults = allDocumentLines.map((line) => {
    const total = parseQuantity(line.quantity);
    const prevConverted = parseQuantity(line.convertedQuantity);
    const spec = specMap.get(line.id);

    let convertNow = 0n;
    if (spec) {
      convertNow = parseQuantity(spec.quantityToConvert);
      if (convertNow <= 0n) {
        throw new Error(`Quantity to convert for line ${line.id} must be greater than zero`);
      }
    }

    const nextConverted = prevConverted + convertNow;
    if (nextConverted > total) {
      throw new Error(
        `Conversion exceeds remaining quantity for line ${line.id}. Remaining: ${formatQuantity(
          total - prevConverted,
        )}, Requested: ${formatQuantity(convertNow)}`,
      );
    }

    const remaining = total - nextConverted;
    return {
      lineId: line.id,
      newConvertedQuantity: formatQuantity(nextConverted),
      remainingQuantity: formatQuantity(remaining),
      isFullyConverted: remaining === 0n,
    };
  });

  const isDocumentFulfilled = lineResults.every((l) => l.isFullyConverted);

  return {
    lines: lineResults,
    isDocumentFulfilled,
  };
}

export interface PurchaseOrderConversionLineSpec {
  lineId: string;
  totalQuantity: string;
  previouslyConvertedQuantity: string;
  quantityToConvert: string;
}

export interface PurchaseOrderConversionResult {
  lines: {
    lineId: string;
    newConvertedQuantity: string;
    remainingQuantity: string;
    isFullyConverted: boolean;
  }[];
  isDocumentFulfilled: boolean;
}

export function validatePurchaseOrderConversion(
  specs: readonly PurchaseOrderConversionLineSpec[],
  allDocumentLines: readonly { id: string; quantity: string; convertedQuantity: string }[],
): PurchaseOrderConversionResult {
  const specMap = new Map(specs.map((s) => [s.lineId, s]));

  const lineResults = allDocumentLines.map((line) => {
    const total = parseQuantity(line.quantity);
    const prevConverted = parseQuantity(line.convertedQuantity);
    const spec = specMap.get(line.id);

    let convertNow = 0n;
    if (spec) {
      convertNow = parseQuantity(spec.quantityToConvert);
      if (convertNow <= 0n) {
        throw new Error(`Quantity to convert for line ${line.id} must be greater than zero`);
      }
    }

    const nextConverted = prevConverted + convertNow;
    if (nextConverted > total) {
      throw new Error(
        `Conversion exceeds remaining quantity for line ${line.id}. Remaining: ${formatQuantity(
          total - prevConverted,
        )}, Requested: ${formatQuantity(convertNow)}`,
      );
    }

    const remaining = total - nextConverted;
    return {
      lineId: line.id,
      newConvertedQuantity: formatQuantity(nextConverted),
      remainingQuantity: formatQuantity(remaining),
      isFullyConverted: remaining === 0n,
    };
  });

  const isDocumentFulfilled = lineResults.every((l) => l.isFullyConverted);

  return {
    lines: lineResults,
    isDocumentFulfilled,
  };
}

export interface StockTransferReceiveLineSpec {
  lineId: string;
  receivedQuantity: string;
  lossQuantity?: string;
  lossReason?: string;
}

export interface StockTransferReceiveResult {
  lines: {
    lineId: string;
    receivedQuantity: string;
    lossQuantity: string;
    lossReason?: string;
    newTotalReceived: string;
    newTotalLoss: string;
    remainingInTransit: string;
    isLineCompleted: boolean;
  }[];
  newStatus: "Dispatched" | "PartiallyReceived" | "Completed";
}

export function validateStockTransferReceipt(
  specs: readonly StockTransferReceiveLineSpec[],
  allTransferLines: readonly {
    id: string;
    dispatchedQuantity: string;
    receivedQuantity: string;
    lossQuantity: string;
  }[],
): StockTransferReceiveResult {
  const specMap = new Map(specs.map((s) => [s.lineId, s]));

  const lineResults = allTransferLines.map((line) => {
    const dispatched = parseQuantity(line.dispatchedQuantity);
    const priorReceived = parseQuantity(line.receivedQuantity);
    const priorLoss = parseQuantity(line.lossQuantity);
    const spec = specMap.get(line.id);

    let receiveNow = 0n;
    let lossNow = 0n;
    let reason = "";

    if (spec) {
      receiveNow = parseQuantity(spec.receivedQuantity || "0");
      lossNow = parseQuantity(spec.lossQuantity || "0");
      reason = spec.lossReason || "";

      if (receiveNow < 0n || lossNow < 0n) {
        throw new Error("Received and loss quantities must be non-negative");
      }

      if (lossNow > 0n && !reason.trim()) {
        throw new Error(`Loss reason is mandatory when recording loss on transfer line ${line.id}`);
      }
    }

    const totalProcessed = priorReceived + priorLoss + receiveNow + lossNow;
    if (totalProcessed > dispatched) {
      throw new Error(
        `Received plus lost quantities exceed dispatched quantity on line ${line.id}. Dispatched: ${formatQuantity(
          dispatched,
        )}, Accounted: ${formatQuantity(totalProcessed)}`,
      );
    }

    const remainingInTransit = dispatched - totalProcessed;
    const isLineCompleted = remainingInTransit === 0n;

    return {
      lineId: line.id,
      receivedQuantity: formatQuantity(receiveNow),
      lossQuantity: formatQuantity(lossNow),
      lossReason: reason ? reason.trim() : undefined,
      newTotalReceived: formatQuantity(priorReceived + receiveNow),
      newTotalLoss: formatQuantity(priorLoss + lossNow),
      remainingInTransit: formatQuantity(remainingInTransit),
      isLineCompleted,
    };
  });

  const allCompleted = lineResults.every((l) => l.isLineCompleted);
  const anyReceivedOrLost = lineResults.some(
    (l) => parseQuantity(l.newTotalReceived) > 0n || parseQuantity(l.newTotalLoss) > 0n,
  );

  let newStatus: "Dispatched" | "PartiallyReceived" | "Completed" = "Dispatched";
  if (allCompleted) {
    newStatus = "Completed";
  } else if (anyReceivedOrLost) {
    newStatus = "PartiallyReceived";
  }

  return {
    lines: lineResults,
    newStatus,
  };
}

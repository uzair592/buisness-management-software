import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateQuoteConversion,
  validatePurchaseOrderConversion,
  validateStockTransferReceipt,
} from "../packages/domain/src/index";

test("validateQuoteConversion correctly computes partial conversion and detects full fulfillment", () => {
  const allLines = [
    { id: "line-1", quantity: "10", convertedQuantity: "0" },
    { id: "line-2", quantity: "5", convertedQuantity: "2" },
  ];

  // Partial conversion of line 1 (4 units) and remaining line 2 (3 units)
  const result = validateQuoteConversion(
    [
      { lineId: "line-1", totalQuantity: "10", previouslyConvertedQuantity: "0", quantityToConvert: "4" },
      { lineId: "line-2", totalQuantity: "5", previouslyConvertedQuantity: "2", quantityToConvert: "3" },
    ],
    allLines,
  );

  assert.equal(result.lines[0]?.newConvertedQuantity, "4");
  assert.equal(result.lines[0]?.remainingQuantity, "6");
  assert.equal(result.lines[0]?.isFullyConverted, false);

  assert.equal(result.lines[1]?.newConvertedQuantity, "5");
  assert.equal(result.lines[1]?.remainingQuantity, "0");
  assert.equal(result.lines[1]?.isFullyConverted, true);

  assert.equal(result.isDocumentFulfilled, false);
});

test("validateQuoteConversion marks document as fulfilled when all lines reach 100%", () => {
  const allLines = [
    { id: "line-1", quantity: "10", convertedQuantity: "4" },
    { id: "line-2", quantity: "5", convertedQuantity: "5" },
  ];

  const result = validateQuoteConversion(
    [
      { lineId: "line-1", totalQuantity: "10", previouslyConvertedQuantity: "4", quantityToConvert: "6" },
    ],
    allLines,
  );

  assert.equal(result.lines[0]?.newConvertedQuantity, "10");
  assert.equal(result.lines[0]?.remainingQuantity, "0");
  assert.equal(result.lines[0]?.isFullyConverted, true);
  assert.equal(result.isDocumentFulfilled, true);
});

test("validateQuoteConversion rejects over-conversion exceeding remaining bounds", () => {
  const allLines = [
    { id: "line-1", quantity: "10", convertedQuantity: "8" },
  ];

  assert.throws(
    () =>
      validateQuoteConversion(
        [
          { lineId: "line-1", totalQuantity: "10", previouslyConvertedQuantity: "8", quantityToConvert: "2.000001" },
        ],
        allLines,
      ),
    /Conversion exceeds remaining quantity for line line-1/,
  );
});

test("validatePurchaseOrderConversion validates conversion bounds and status", () => {
  const allLines = [
    { id: "po-1", quantity: "100", convertedQuantity: "0" },
  ];

  const r1 = validatePurchaseOrderConversion(
    [{ lineId: "po-1", totalQuantity: "100", previouslyConvertedQuantity: "0", quantityToConvert: "60" }],
    allLines,
  );
  assert.equal(r1.lines[0]?.newConvertedQuantity, "60");
  assert.equal(r1.lines[0]?.remainingQuantity, "40");
  assert.equal(r1.isDocumentFulfilled, false);

  assert.throws(
    () =>
      validatePurchaseOrderConversion(
        [{ lineId: "po-1", totalQuantity: "100", previouslyConvertedQuantity: "0", quantityToConvert: "101" }],
        allLines,
      ),
    /Conversion exceeds remaining quantity/,
  );
});

test("validateStockTransferReceipt reconciles received, lost, transit and detects completion", () => {
  const allLines = [
    { id: "t-1", dispatchedQuantity: "50", receivedQuantity: "0", lossQuantity: "0" },
    { id: "t-2", dispatchedQuantity: "20", receivedQuantity: "0", lossQuantity: "0" },
  ];

  // Partial receipt with some damage/loss
  const r1 = validateStockTransferReceipt(
    [
      { lineId: "t-1", receivedQuantity: "45", lossQuantity: "5", lossReason: "Broken bottles during transit" },
      { lineId: "t-2", receivedQuantity: "10" },
    ],
    allLines,
  );

  assert.equal(r1.lines[0]?.newTotalReceived, "45");
  assert.equal(r1.lines[0]?.newTotalLoss, "5");
  assert.equal(r1.lines[0]?.remainingInTransit, "0");
  assert.equal(r1.lines[0]?.isLineCompleted, true);

  assert.equal(r1.lines[1]?.newTotalReceived, "10");
  assert.equal(r1.lines[1]?.newTotalLoss, "0");
  assert.equal(r1.lines[1]?.remainingInTransit, "10");
  assert.equal(r1.lines[1]?.isLineCompleted, false);

  assert.equal(r1.newStatus, "PartiallyReceived");
});

test("validateStockTransferReceipt requires lossReason if lossQuantity > 0", () => {
  const allLines = [
    { id: "t-1", dispatchedQuantity: "50", receivedQuantity: "0", lossQuantity: "0" },
  ];

  assert.throws(
    () =>
      validateStockTransferReceipt(
        [{ lineId: "t-1", receivedQuantity: "40", lossQuantity: "10" }],
        allLines,
      ),
    /Loss reason is mandatory/,
  );
});

test("validateStockTransferReceipt marks Completed when all dispatched stock is accounted for", () => {
  const allLines = [
    { id: "t-1", dispatchedQuantity: "50", receivedQuantity: "45", lossQuantity: "5" },
    { id: "t-2", dispatchedQuantity: "20", receivedQuantity: "10", lossQuantity: "0" },
  ];

  // Receiving the remaining 10 of line 2
  const r2 = validateStockTransferReceipt(
    [
      { lineId: "t-2", receivedQuantity: "10" },
    ],
    allLines,
  );

  assert.equal(r2.lines[1]?.remainingInTransit, "0");
  assert.equal(r2.lines[1]?.isLineCompleted, true);
  assert.equal(r2.newStatus, "Completed");
});

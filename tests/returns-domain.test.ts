import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateReturnQuantity,
  calculateStockVariance,
  allocateDeficitSettlement,
} from "../packages/domain/src/index";

test("validateReturnQuantity enforces non-negative bounds and remaining limit", () => {
  // Original 10, prior 0, request 3 -> remaining 7
  const r1 = validateReturnQuantity("10.000000", "0.000000", "3.000000");
  assert.equal(r1.remainingQuantityBase, "7.000000");

  // Original 10, prior 3, request 7 -> remaining 0
  const r2 = validateReturnQuantity("10.000000", "3.000000", "7.000000");
  assert.equal(r2.remainingQuantityBase, "0.000000");

  // Original 10, prior 3, request 7.000001 -> exceeds limit
  assert.throws(
    () => validateReturnQuantity("10.000000", "3.000000", "7.000001"),
    /Return quantity exceeds remaining limit/,
  );

  // Request zero or negative -> rejected
  assert.throws(
    () => validateReturnQuantity("10.000000", "0.000000", "0.000000"),
    /Return quantity must be greater than zero/,
  );
  assert.throws(
    () => validateReturnQuantity("10.000000", "0.000000", "-1.000000"),
    /Invalid decimal/,
  );
});

test("calculateStockVariance correctly calculates quantity delta, value delta and kind", () => {
  // Shortage: counted 8, system 10, unit cost 50.00 -> delta -2, value -100.00, Shortage
  const s1 = calculateStockVariance("8.000000", "10.000000", "50.00");
  assert.equal(s1.quantityDelta, "-2.000000");
  assert.equal(s1.valueDelta, "-100.00");
  assert.equal(s1.kind, "Shortage");

  // Surplus: counted 15, system 10, unit cost 25.50 -> delta +5, value +127.50, Surplus
  const s2 = calculateStockVariance("15.000000", "10.000000", "25.50");
  assert.equal(s2.quantityDelta, "5.000000");
  assert.equal(s2.valueDelta, "127.50");
  assert.equal(s2.kind, "Surplus");

  // NoChange: counted 10, system 10 -> delta 0, value 0.00, NoChange
  const s3 = calculateStockVariance("10.000000", "10.000000", "10.00");
  assert.equal(s3.quantityDelta, "0.000000");
  assert.equal(s3.valueDelta, "0.00");
  assert.equal(s3.kind, "NoChange");
});

test("allocateDeficitSettlement deterministically allocates receipt quantity and calculates cost adjustment", () => {
  // Scenario: 1 unit sold into deficit at prov cost 100.00, then 5 units received at 120.00
  // Value adjustment = 1 unit * (120 - 100) = +20.00 (additional COGS debit / Inventory credit)
  // Remaining receipt = 4 units
  const deficits = [
    { id: "def-1", openQuantityBase: "1.000000", provisionalCost: "100.00" },
  ];
  const res1 = allocateDeficitSettlement(deficits, "5.000000", "120.00");
  assert.equal(res1.settlements.length, 1);
  assert.equal(res1.settlements[0].id, "def-1");
  assert.equal(res1.settlements[0].settledQuantityBase, "1.000000");
  assert.equal(res1.settlements[0].remainingOpenQuantityBase, "0.000000");
  assert.equal(res1.settlements[0].unitDifference, "20.00");
  assert.equal(res1.settlements[0].valueAdjustment, "20.00");
  assert.equal(res1.remainingReceiptQuantityBase, "4.000000");

  // Scenario 2: Partial receipt
  // Deficit 3 units at 50.00, receipt 2 units at 45.00 (cheaper)
  // Unit diff = 45 - 50 = -5.00
  // Value adj = 2 units * -5.00 = -10.00 (COGS credit / Inventory debit)
  // Remaining open deficit = 1 unit, remaining receipt = 0
  const deficits2 = [
    { id: "def-2", openQuantityBase: "3.000000", provisionalCost: "50.00" },
  ];
  const res2 = allocateDeficitSettlement(deficits2, "2.000000", "45.00");
  assert.equal(res2.settlements.length, 1);
  assert.equal(res2.settlements[0].settledQuantityBase, "2.000000");
  assert.equal(res2.settlements[0].remainingOpenQuantityBase, "1.000000");
  assert.equal(res2.settlements[0].unitDifference, "-5.00");
  assert.equal(res2.settlements[0].valueAdjustment, "-10.00");
  assert.equal(res2.remainingReceiptQuantityBase, "0.000000");

  // Scenario 3: Multiple deficits settled across one receipt
  const deficits3 = [
    { id: "def-a", openQuantityBase: "2.000000", provisionalCost: "10.00" },
    { id: "def-b", openQuantityBase: "5.000000", provisionalCost: "12.00" },
  ];
  const res3 = allocateDeficitSettlement(deficits3, "4.000000", "15.00");
  assert.equal(res3.settlements.length, 2);
  // def-a is fully settled (2 units)
  assert.equal(res3.settlements[0].id, "def-a");
  assert.equal(res3.settlements[0].settledQuantityBase, "2.000000");
  assert.equal(res3.settlements[0].remainingOpenQuantityBase, "0.000000");
  assert.equal(res3.settlements[0].valueAdjustment, "10.00"); // 2 * (15 - 10) = 10.00
  // def-b is partially settled (2 units)
  assert.equal(res3.settlements[1].id, "def-b");
  assert.equal(res3.settlements[1].settledQuantityBase, "2.000000");
  assert.equal(res3.settlements[1].remainingOpenQuantityBase, "3.000000");
  assert.equal(res3.settlements[1].valueAdjustment, "6.00"); // 2 * (15 - 12) = 6.00
  assert.equal(res3.remainingReceiptQuantityBase, "0.000000");
});

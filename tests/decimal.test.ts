import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lineAmount,
  sumAmounts,
  remainingAmount,
  formatMoney,
  validQuantity,
  atOrBelow,
  addQuantities,
} from "../packages/domain/src/index";
test("exact decimal lines, half-up rounding and large amounts", () => {
  assert.equal(
    formatMoney(sumAmounts(["999999999999999999.99", "0.01"])),
    "PKR 1,000,000,000,000,000,000.00",
  );
  assert.equal(addQuantities("0.000001", "1"), "1.000001");
  assert.equal(lineAmount("65.25", "0.1"), "6.53");
  assert.equal(lineAmount("0.01", "0.5"), "0.01");
  assert.equal(lineAmount("185.50", "3"), "556.50");
  assert.equal(sumAmounts(["0.10", "0.20"]), "0.30");
  assert.equal(
    sumAmounts(["9007199254740993.01", "0.09"]),
    "9007199254740993.10",
  );
  assert.equal(remainingAmount("687.00", "200.00"), "487.00");
  assert.equal(
    formatMoney("9007199254740993.01"),
    "PKR 9,007,199,254,740,993.01",
  );
  assert.equal(atOrBelow("6", "10"), true);
});
test("invalid precision, negative, zero and nondecimal input is rejected", () => {
  for (const value of ["", "0", "-1", "1e2", "NaN", "1.0000001", "1,000"])
    assert.equal(validQuantity(value), false);
  assert.equal(validQuantity("0.000001"), true);
  assert.throws(() => lineAmount("1.001", "1"));
  assert.throws(() => lineAmount("2", "0"));
  assert.throws(() => remainingAmount("1", "2"));
});

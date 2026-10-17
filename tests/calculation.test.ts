import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateDocument,
  allocateDiscount,
  allocatePayment,
  convertToBaseQuantity,
} from "../packages/domain/src/calculation";

const line = (overrides: Record<string, unknown> = {}) => ({
  id: "line-a",
  quantity: "3.000000",
  conversion: "1.000000",
  conversionVersion: 1,
  unitPrice: "100.00",
  lineDiscount: { kind: "percent" as const, value: "10" },
  tax: { mode: "exclusive" as const, percent: "10" },
  ...overrides,
});

test("golden exclusive and inclusive tax, persisted version and base conversion", () => {
  const exclusive = calculateDocument({ lines: [line()], documentDiscount: "0.00" });
  assert.deepEqual([exclusive.base, exclusive.tax, exclusive.total], ["270.00", "27.00", "297.00"]);
  assert.equal(exclusive.calculationVersion, 1);
  assert.equal(exclusive.lines[0].quantityBase, "3.000000");

  const inclusive = calculateDocument({
    lines: [line({ quantity: "1", unitPrice: "110.00", lineDiscount: { kind: "amount", value: "0.00" }, tax: { mode: "inclusive", percent: "10" } })],
    documentDiscount: "0.00",
  });
  assert.deepEqual([inclusive.base, inclusive.tax, inclusive.total], ["100.00", "10.00", "110.00"]);
  assert.equal(convertToBaseQuantity("2.500000", "0.500000"), "1.250000");
});

test("cent allocation preserves sums and stable line-ID tie breaking", () => {
  const ids = ["c", "b", "a"];
  const doc = calculateDocument({
    lines: ids.map((id) => line({ id, quantity: "1", unitPrice: "1.00", lineDiscount: { kind: "amount", value: "0.00" }, tax: { mode: "exclusive", percent: "0" } })),
    documentDiscount: "0.01",
  });
  assert.equal(doc.lines.find((l) => l.id === "a")?.documentDiscount, "0.01");
  assert.equal(doc.total, "2.99");
  for (let n = 1n; n <= 89n; n++) {
    const weights = [1n, 11n, 19n, 100n].map((cents, i) => ({ id: String(i), cents }));
    const applied = allocateDiscount(n, weights);
    assert.equal([...applied.values()].reduce((sum, v) => sum + v, 0n), n);
    for (const weight of weights) assert.ok(applied.get(weight.id)! <= weight.cents);
  }
});

test("payment split separates receivable, applied cash, and change", () => {
  assert.deepEqual(allocatePayment({ total: "1000.00", cashApplied: "600.00", bankApplied: "200.00" }), {
    cashBookIncrease: "600.00", change: "0.00", receivable: "200.00",
  });
  assert.deepEqual(allocatePayment({ total: "900.00", cashApplied: "900.00", bankApplied: "0.00", cashTendered: "1000.00" }), {
    cashBookIncrease: "900.00", change: "100.00", receivable: "0.00",
  });
});

test("invalid values cannot silently round through Number or exceed balances", () => {
  assert.throws(() => calculateDocument({ lines: [line({ unitPrice: "-1.00" })], documentDiscount: "0.00" }));
  assert.throws(() => calculateDocument({ lines: [line({ lineDiscount: { kind: "percent", value: "101" } })], documentDiscount: "0.00" }));
  assert.throws(() => calculateDocument({ lines: [line()], documentDiscount: "271.00" }));
  assert.throws(() => allocatePayment({ total: "10.00", cashApplied: "11.00", bankApplied: "0.00" }));
  const huge = calculateDocument({ lines: [line({ quantity: "100000000000000000000.000000", unitPrice: "9007199254740993.00", lineDiscount: { kind: "amount", value: "0.00" }, tax: { mode: "exclusive", percent: "0" } })], documentDiscount: "0.00" });
  assert.equal(huge.total, "900719925474099300000000000000000000.00");
});

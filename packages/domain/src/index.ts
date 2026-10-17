// Narrow exact arithmetic primitives retained for the isolated sample preview.
// Versioned operational calculations are exported from calculation.ts.
export * from "./calculation.js";
export * from "./sync-dependencies.js";
function scaled(value: string, scale: number): bigint {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(value)) {
    throw new Error(
      `Use a non-negative decimal with at most ${scale} decimal places`,
    );
  }
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"))
  );
}
function currency(cents: bigint): string {
  if (cents < 0n) throw new Error("Amount cannot be negative");
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
export function validQuantity(value: string): boolean {
  try {
    return scaled(value, 6) > 0n;
  } catch {
    return false;
  }
}
export function addQuantities(first: string, second: string): string {
  const value = scaled(first, 6) + scaled(second, 6);
  return `${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, "0")}`.replace(
    /\.?0+$/,
    "",
  );
}
export function lineAmount(price: string, quantity: string): string {
  if (!validQuantity(quantity))
    throw new Error("Quantity must be greater than zero");
  // ROUND_HALF_UP once at the line's final currency boundary.
  return currency(
    (scaled(price, 2) * scaled(quantity, 6) + 500_000n) / 1_000_000n,
  );
}
export function sumAmounts(values: readonly string[]): string {
  return currency(values.reduce((sum, value) => sum + scaled(value, 2), 0n));
}
export function remainingAmount(total: string, paid: string): string {
  return currency(scaled(total, 2) - scaled(paid, 2));
}
export function atOrBelow(quantity: string, threshold: string): boolean {
  return scaled(quantity, 6) <= scaled(threshold, 6);
}
export function formatMoney(value: string): string {
  const [whole, fraction] = currency(scaled(value, 2)).split(".");
  return `PKR ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

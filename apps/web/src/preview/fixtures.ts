import { lineAmount, remainingAmount, sumAmounts } from "@business/domain";
export const sampleDate = "2026-10-15";
export const sampleItems = [
  {
    id: "rice",
    name: "Basmati rice · 1 kg",
    barcode: "8901001",
    unit: "bag",
    price: "320.00",
    stock: "6",
    reorder: "10",
    category: "Grocery",
  },
  {
    id: "tea",
    name: "Classic tea · 250 g",
    barcode: "8901002",
    unit: "box",
    price: "445.50",
    stock: "24",
    reorder: "8",
    category: "Grocery",
  },
  {
    id: "notebook",
    name: "A5 notebook",
    barcode: "8901003",
    unit: "each",
    price: "185.50",
    stock: "42",
    reorder: "12",
    category: "Stationery",
  },
  {
    id: "pen",
    name: "Blue ballpoint pen",
    barcode: "8901004",
    unit: "each",
    price: "65.25",
    stock: "8",
    reorder: "10",
    category: "Stationery",
  },
  {
    id: "oil",
    name: "Cooking oil · 1 litre",
    barcode: "8901005",
    unit: "bottle",
    price: "780.00",
    stock: "18",
    reorder: "6",
    category: "Grocery",
  },
  {
    id: "soap",
    name: "Hand soap · 100 g",
    barcode: "8901006",
    unit: "each",
    price: "120.75",
    stock: "5",
    reorder: "10",
    category: "Household",
  },
] as const;
export const sampleParties = [
  { id: "walk-in", name: "Walk-in customer", type: "Customer", city: "—" },
  { id: "ayesha", name: "Ayesha Khan", type: "Customer", city: "Lahore" },
  { id: "bilal", name: "Bilal Traders", type: "Customer", city: "Rawalpindi" },
  { id: "bright", name: "Bright Supplies", type: "Supplier", city: "Lahore" },
  { id: "punjab", name: "Punjab Foods", type: "Supplier", city: "Faisalabad" },
] as const;
export type ItemId = (typeof sampleItems)[number]["id"];
export type SampleLine = { itemId: ItemId; quantity: string };
export type SampleTransaction = {
  id: string;
  kind: "Sale" | "Purchase";
  date: string;
  partyId: string;
  lines: readonly SampleLine[];
  paid: string;
};
export const sampleTransactions: readonly SampleTransaction[] = [
  {
    id: "S-1048",
    kind: "Sale",
    date: sampleDate,
    partyId: "ayesha",
    lines: [
      { itemId: "rice", quantity: "2" },
      { itemId: "tea", quantity: "1" },
    ],
    paid: "1085.50",
  },
  {
    id: "S-1047",
    kind: "Sale",
    date: sampleDate,
    partyId: "bilal",
    lines: [
      { itemId: "notebook", quantity: "3" },
      { itemId: "pen", quantity: "2" },
    ],
    paid: "200.00",
  },
  {
    id: "P-0216",
    kind: "Purchase",
    date: sampleDate,
    partyId: "bright",
    lines: [{ itemId: "tea", quantity: "6" }],
    paid: "1000.00",
  },
  {
    id: "S-1046",
    kind: "Sale",
    date: "2026-10-14",
    partyId: "walk-in",
    lines: [
      { itemId: "soap", quantity: "4" },
      { itemId: "oil", quantity: "1" },
    ],
    paid: "1263.00",
  },
  {
    id: "S-1045",
    kind: "Sale",
    date: "2026-10-12",
    partyId: "ayesha",
    lines: [{ itemId: "rice", quantity: "3" }],
    paid: "0.00",
  },
  {
    id: "P-0215",
    kind: "Purchase",
    date: "2026-10-10",
    partyId: "punjab",
    lines: [{ itemId: "rice", quantity: "20" }],
    paid: "6400.00",
  },
  {
    id: "S-1044",
    kind: "Sale",
    date: "2026-10-05",
    partyId: "bilal",
    lines: [{ itemId: "tea", quantity: "2" }],
    paid: "500.00",
  },
  {
    id: "P-0214",
    kind: "Purchase",
    date: "2026-10-03",
    partyId: "bright",
    lines: [{ itemId: "notebook", quantity: "10" }],
    paid: "0.00",
  },
];
export function itemById(id: ItemId) {
  return sampleItems.find((item) => item.id === id)!;
}
export function partyName(id: string) {
  return sampleParties.find((p) => p.id === id)?.name ?? "Walk-in customer";
}
export function cartAmount(lines: readonly SampleLine[]) {
  return sumAmounts(
    lines.map((line) => lineAmount(itemById(line.itemId).price, line.quantity)),
  );
}
export function transactionDue(transaction: SampleTransaction) {
  return remainingAmount(cartAmount(transaction.lines), transaction.paid);
}
export function inPeriod(date: string, period: string) {
  return (
    period === "all" ||
    (period === "week"
      ? date >= "2026-10-09" && date <= sampleDate
      : date === sampleDate)
  );
}

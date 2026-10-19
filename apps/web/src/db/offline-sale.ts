import { allocatePayment, calculateDocument } from "@business/domain";
import type { PartitionedLocalDatabase, LocalIssuedSaleRecord } from "./index";

export interface OfflineCashInput {
  id: string;
  commandId: string;
  deviceEnrollmentId: string;
  locationId: string;
  partyId: string | null;
  businessDate: string;
  documentDiscount: string;
  lines: Array<{ id: string; itemId: string; conversionId: string | null; taxProfileId: string | null;
    quantity: string; unitPrice: string; discount: string }>;
  payments: Array<{ id: string; accountId: string; kind: "Cash"; applied: string;
    tendered: string; reference: null }>;
}

export interface OfflineSaleEnvelope {
  schemaVersion: 1;
  calculationVersion: 1;
  datasetEpoch: number;
  policyVersion: number;
  leaseId: string;
  issuedAt: string;
  number: string;
  input: OfflineCashInput;
  frozen: { calculation: ReturnType<typeof calculateDocument>; payment: ReturnType<typeof allocatePayment>;
    lines: Array<{ name: string; kind: string; conversion: string; tax: { mode: "inclusive" | "exclusive"; percent: string } }> };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The IndexedDB transaction is the issue boundary. A rejected transaction yields no number or receipt. */
export async function issueOfflineCashSale(db: PartitionedLocalDatabase, input: OfflineCashInput,
  now = new Date()): Promise<LocalIssuedSaleRecord> {
  if (![input.id, input.commandId, input.deviceEnrollmentId, input.locationId,
    ...input.lines.map((line) => line.id), ...input.payments.map((payment) => payment.id)].every((id) => uuid.test(id)))
    throw new Error("Invalid offline sale identity");
  if (!input.lines.length || input.lines.length > 100 || input.payments.length !== 1 ||
    input.payments[0].kind !== "Cash" || input.payments[0].reference !== null || input.partyId !== null)
    throw new Error("Offline issue supports one fully paid cash sale for a walk-in customer");

  // The catalogue view, counter, receipt and outbox share one IndexedDB snapshot.
  // A pull in another tab cannot replace an item halfway through issuing.
  return db.transaction("rw", [db.identity, db.device, db.lease, db.locations, db.syncState,
    db.catalogue, db.pending, db.issuedSales], async () => {
  const catalogue = await db.catalogue.toArray();
  const lookup = (group: string, id: string) => {
    const row = catalogue.find((entry) => entry.key === `${group}:${id}`)?.row;
    if (!row || row.archivedAt) throw new Error(`Offline ${group} is missing or archived; refresh catalogue`);
    return row;
  };
  const frozenLines = input.lines.map((line) => {
    const item = lookup("item", line.itemId);
    const conversion = line.conversionId ? lookup("conversion", line.conversionId) : null;
    if (conversion && (conversion.itemId !== line.itemId || item.kind !== "Goods")) throw new Error("Invalid offline item unit");
    const tax = line.taxProfileId ? lookup("tax_profile", line.taxProfileId) : null;
    if (line.taxProfileId && item.taxProfileId !== line.taxProfileId) throw new Error("Offline tax profile changed; refresh catalogue");
    return { name: String(item.name), kind: String(item.kind), conversion: String(conversion?.factor ?? "1"),
      tax: { mode: (String(tax?.mode ?? "Exclusive").toLowerCase()) as "inclusive" | "exclusive",
        percent: String(tax?.rate ?? "0") } };
  });
  const calculation = calculateDocument({ documentDiscount: input.documentDiscount,
    lines: input.lines.map((line, index) => ({ id: line.id, quantity: line.quantity,
      conversion: frozenLines[index].conversion, conversionVersion: 1, unitPrice: line.unitPrice,
      lineDiscount: { kind: "amount" as const, value: line.discount }, tax: frozenLines[index].tax })) });
  if (BigInt(calculation.total.replace(".", "")) <= 0n) throw new Error("Sale total must be greater than zero");
  const payment = allocatePayment({ total: calculation.total, cashApplied: input.payments[0].applied,
    bankApplied: "0", cashTendered: input.payments[0].tendered });
  if (payment.receivable !== "0.00") throw new Error("Offline sale must be fully paid in cash");
  lookup("cash_account", input.payments[0].accountId);

  // No network or cryptographic await belongs in this transaction. Dexie serializes
  // concurrent tabs' read-modify-write counter against the same IndexedDB store.
      const business = (await db.identity.get("business"))?.value as { id: string; datasetEpoch: number } | undefined;
      const membership = (await db.identity.get("membership"))?.value as { id: string; role: string; permissionVersion: number } | undefined;
      const device = await db.device.get(input.deviceEnrollmentId);
      const lease = await db.lease.toCollection().first();
      const lastClock = (await db.syncState.get("lastOfflineIssueAt"))?.value;
      if (!business || !membership || !device || !lease ||
        !["Owner", "Accountant", "Cashier"].includes(membership.role) ||
        device.status !== "Enrolled" || device.businessId !== business.id ||
        device.membershipId !== membership.id || device.locationId !== input.locationId ||
        !await db.locations.get(input.locationId) ||
        lease.businessId !== business.id || lease.deviceEnrollmentId !== device.id ||
        lease.membershipId !== membership.id || lease.datasetEpoch !== business.datasetEpoch ||
        lease.policyVersion !== membership.permissionVersion || lease.revokedAt || !lease.signature ||
        now.getTime() < Date.parse(lease.issuedAt) - 5 * 60_000 || now.getTime() >= Date.parse(lease.expiresAt) ||
        (typeof lastClock === "string" && now.getTime() < Date.parse(lastClock) - 5 * 60_000))
        throw new Error("Offline authority is unavailable or the device clock changed; reconnect for review");
      if (await db.pending.get(input.commandId) || await db.issuedSales.get(input.id)) throw new Error("Sale identity already issued");
      // A refreshed snapshot may advance the online counter; it never rolls the local counter back.
      const localSequence = BigInt(String((await db.syncState.get("offlineSaleSequence"))?.value ?? "0"));
      const next = localSequence + 1n;
      const number = `${device.numberPrefix}-O-${next.toString().padStart(6, "0")}`;
      const issuedAt = now.toISOString();
      const envelope: OfflineSaleEnvelope = { schemaVersion: 1, calculationVersion: 1,
        datasetEpoch: business.datasetEpoch, policyVersion: lease.policyVersion, leaseId: lease.id,
        issuedAt, number, input, frozen: { calculation, payment, lines: frozenLines } };
      const result: LocalIssuedSaleRecord = { id: input.id, commandId: input.commandId, number,
        snapshot: envelope, issuedAt };
      await db.syncState.put({ key: "offlineSaleSequence", value: next.toString() });
      await db.syncState.put({ key: "lastOfflineIssueAt", value: issuedAt });
      await db.issuedSales.put(result);
      await db.pending.put({ commandId: input.commandId, state: "queued", payload: envelope });
      return result;
    });
}

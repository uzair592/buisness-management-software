import type { PartitionedLocalDatabase } from "./index";

const encoder = new TextEncoder();
const iterations = 310_000;

/** Encrypted evidence of outstanding issued work. No network request is involved. */
export async function exportPendingRecovery(db: PartitionedLocalDatabase, passphrase: string) {
  if (passphrase.length < 12) throw new Error("Use at least 12 characters for the recovery passphrase");
  const [pending, issuedSales, business, device] = await Promise.all([
    db.pending.where("state").anyOf("queued", "held", "blocked").toArray(),
    db.issuedSales.toArray(), db.identity.get("business"), db.device.toCollection().first(),
  ]);
  if (!pending.length) throw new Error("No pending issued bills to export");
  const scope = business?.value as { id?: string; datasetEpoch?: number } | undefined;
  if (!scope?.id || !Number.isInteger(scope.datasetEpoch) || device?.businessId !== scope.id)
    throw new Error("Recovery scope is unavailable");
  const pendingIds = new Set(pending.map((row) => row.commandId));
  const payload = { version: 1, scope: { businessId: scope.id, datasetEpoch: scope.datasetEpoch,
    deviceEnrollmentId: device.id }, exportedAt: new Date().toISOString(), pending,
  issuedSales: issuedSales.filter((row) => pendingIds.has(row.commandId)) };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
    encoder.encode(JSON.stringify(payload))));
  const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
  return JSON.stringify({ format: "bms-pending-recovery", version: 1, kdf: "PBKDF2-SHA256",
    iterations, cipher: "AES-256-GCM", salt: base64(salt), iv: base64(iv), ciphertext: base64(ciphertext) });
}

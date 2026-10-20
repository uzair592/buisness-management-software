import Dexie from "dexie";
import { PartitionedLocalDatabase } from "./index";

const encoder = new TextEncoder();
const iterations = 310_000;

export interface PendingPartitionSummary {
  name: string;
  enrollmentId: string;
  datasetEpoch: number;
  count: number;
}

/** Find older epoch queues belonging to the current user and business. */
export async function listPendingPartitions(userId: string, businessId: string): Promise<PendingPartitionSummary[]> {
  const prefix = `bms_${userId}_${businessId}_`;
  const names = await Dexie.getDatabaseNames();
  const results: PendingPartitionSummary[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const match = /^(.+)_ep(\d+)$/.exec(name.slice(prefix.length));
    if (!match) continue;
    const db = new PartitionedLocalDatabase(name);
    try {
      const business = (await db.identity.get("business"))?.value as { id?: string; datasetEpoch?: number } | undefined;
      const user = (await db.identity.get("user"))?.value as { id?: string } | undefined;
      const device = await db.device.toCollection().first();
      if (business?.id !== businessId || business.datasetEpoch !== Number(match[2]) || device?.id !== match[1] ||
        user?.id !== userId) continue;
      const count = await db.pending.where("state").anyOf("queued", "held", "blocked").count();
      if (count) results.push({ name, enrollmentId: match[1], datasetEpoch: Number(match[2]), count });
    } finally { db.close(); }
  }
  return results.sort((a, b) => a.datasetEpoch - b.datasetEpoch);
}

/** Encrypted evidence of outstanding issued work. No network request is involved. */
export async function exportPendingRecovery(db: PartitionedLocalDatabase, passphrase: string) {
  if (passphrase.length < 12) throw new Error("Use at least 12 characters for the recovery passphrase");
  const [pending, issuedSales, business, device] = await db.transaction("r",
    [db.pending, db.issuedSales, db.identity, db.device], () => Promise.all([
      db.pending.where("state").anyOf("queued", "held", "blocked").toArray(),
      db.issuedSales.toArray(), db.identity.get("business"), db.device.toCollection().first(),
    ]));
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

/** Read encrypted evidence locally; never import or replay old issued commands. */
export async function inspectPendingRecovery(contents: string, passphrase: string, businessId: string) {
  if (contents.length > 10_000_000) throw new Error("Recovery file is too large for review");
  let file: unknown;
  try { file = JSON.parse(contents); } catch { throw new Error("Invalid recovery file"); }
  if (!file || typeof file !== "object") throw new Error("Invalid recovery file");
  const bundle = file as Record<string, unknown>;
  if (bundle.format !== "bms-pending-recovery" || bundle.version !== 1 ||
    bundle.kdf !== "PBKDF2-SHA256" || bundle.cipher !== "AES-256-GCM" || bundle.iterations !== iterations)
    throw new Error("Unsupported recovery format");
  const decode = (value: unknown, length?: number) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Invalid recovery file");
    try {
      const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
      if ((length !== undefined && bytes.length !== length) || !bytes.length) throw new Error("Invalid recovery file");
      return bytes;
    } catch { throw new Error("Invalid recovery file"); }
  };
  const salt = decode(bundle.salt, 16), iv = decode(bundle.iv, 12), ciphertext = decode(bundle.ciphertext);
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  let decrypted: unknown;
  try { decrypted = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv },
    key, ciphertext))); }
  catch { throw new Error("Recovery passphrase is incorrect or the file was changed"); }
  if (!decrypted || typeof decrypted !== "object") throw new Error("Invalid recovery contents");
  const payload = decrypted as Record<string, unknown>;
  const scope = payload.scope as Record<string, unknown> | undefined;
  if (!scope || scope.businessId !== businessId) throw new Error("Recovery belongs to a different business");
  if (payload.version !== 1 || !Number.isSafeInteger(scope.datasetEpoch) || Number(scope.datasetEpoch) < 1 ||
    typeof scope.deviceEnrollmentId !== "string" || !scope.deviceEnrollmentId ||
    !Array.isArray(payload.pending) || !Array.isArray(payload.issuedSales) || !payload.pending.length ||
    payload.pending.length !== payload.issuedSales.length)
    throw new Error("Invalid recovery contents");
  const pending = new Map<string, { state: string; payload: Record<string, unknown> }>();
  for (const entry of payload.pending) {
    if (!entry || typeof entry !== "object") throw new Error("Invalid recovery contents");
    const row = entry as Record<string, unknown>;
    const envelope = row.payload as Record<string, unknown> | undefined;
    const input = envelope?.input as Record<string, unknown> | undefined;
    if (typeof row.commandId !== "string" || !row.commandId || pending.has(row.commandId) ||
      !["queued", "held", "blocked"].includes(String(row.state)) ||
      !envelope || typeof envelope !== "object" || envelope.schemaVersion !== 1 ||
      envelope.calculationVersion !== 1 || envelope.datasetEpoch !== scope.datasetEpoch ||
      !input || input.commandId !== row.commandId || input.deviceEnrollmentId !== scope.deviceEnrollmentId)
      throw new Error("Invalid recovery contents");
    pending.set(row.commandId, { state: String(row.state), payload: envelope });
  }
  const numbers = new Set<string>();
  const records = payload.issuedSales.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid recovery contents");
    const row = entry as Record<string, unknown>;
    const queued = pending.get(String(row.commandId));
    if (typeof row.commandId !== "string" || !queued ||
      typeof row.number !== "string" || !row.number || numbers.has(row.number) ||
      typeof row.issuedAt !== "string" || !Number.isFinite(Date.parse(row.issuedAt)) ||
      row.id !== (queued.payload.input as Record<string, unknown>).id ||
      row.number !== queued.payload.number || row.issuedAt !== queued.payload.issuedAt ||
      JSON.stringify(row.snapshot) !== JSON.stringify(queued.payload))
      throw new Error("Invalid recovery contents");
    numbers.add(row.number); pending.delete(row.commandId);
    return { number: row.number, issuedAt: row.issuedAt, state: queued.state };
  });
  if (pending.size) throw new Error("Invalid recovery contents");
  return { businessId, datasetEpoch: Number(scope.datasetEpoch),
    deviceEnrollmentId: scope.deviceEnrollmentId, records };
}

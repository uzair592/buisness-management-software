import { applyCataloguePull, type CataloguePull, type PartitionedLocalDatabase } from "./index";
import type { OfflineSaleEnvelope } from "./offline-sale";

/** Foreground delivery is at least once; the server receipt is the replay boundary. */
export async function pushQueuedSales(db: PartitionedLocalDatabase, csrfToken: string) {
  const queued = await db.pending.where("state").equals("queued").toArray();
  const summary = { accepted: 0, held: 0, remaining: 0 };
  for (const record of queued) {
    const envelope = record.payload as OfflineSaleEnvelope;
    if (envelope.schemaVersion !== 1 || envelope.input?.commandId !== record.commandId) {
      await db.pending.update(record.commandId, { state: "blocked", reason: "Unsupported local command format" });
      summary.held++;
      continue;
    }
    try {
      const response = await fetch("/v1/sync/push/sale", { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(envelope) });
      if (response.ok) {
        const result = await response.json() as { commandId: string; sale: { id: string; number: string } };
        if (result.commandId !== record.commandId || result.sale?.id !== envelope.input.id || result.sale?.number !== envelope.number) {
          await db.pending.update(record.commandId, { state: "held", reason: "Server receipt identity did not match the issued bill" });
          summary.held++;
          continue;
        }
        await db.pending.update(record.commandId, { state: "acknowledged", result, reason: undefined });
        summary.accepted++;
      } else if ([400, 403, 409].includes(response.status)) {
        const problem = await response.json() as { error?: string; code?: string };
        await db.pending.update(record.commandId, { state: "held", reason: `${problem.code ?? "REVIEW"}: ${problem.error ?? "Owner review required"}` });
        summary.held++;
      } else {
        summary.remaining++;
        if (response.status === 401) break;
      }
    } catch {
      summary.remaining++;
      break;
    }
  }
  return summary;
}

/** Apply complete pages and their cursor together; rerunning an interrupted page is safe. */
export async function pullCatalogueChanges(db: PartitionedLocalDatabase) {
  const device = await db.device.toCollection().first();
  const membership = (await db.identity.get("membership"))?.value as { role?: string } | undefined;
  if (!device || !membership) throw new Error("Device bootstrap is missing");
  const privileged = ["Owner", "Accountant"].includes(membership.role ?? "");
  for (let page = 0; page < 100; page++) {
    const cursor = String((await db.syncState.get("catalogueCursor"))?.value ?? "");
    if (!/^\d+$/.test(cursor)) throw new Error("Catalogue cursor is missing; update the snapshot");
    const response = await fetch(`/v1/sync/pull?deviceEnrollmentId=${encodeURIComponent(device.id)}&afterCursor=${cursor}&limit=100`,
      { credentials: "include" });
    if (response.status === 410) throw new Error("Sync history expired. Update the catalogue in Settings; issued bills remain saved on this device.");
    if (!response.ok) throw new Error(`Catalogue pull needs review (${response.status})`);
    const pull = await response.json() as CataloguePull & { hasMore: boolean };
    try { await applyCataloguePull(db, pull, privileged); }
    catch (cause) {
      // Another tab or a previous in-flight cycle may have committed this page.
      // Start again from the durable cursor; never rewind or overwrite its work.
      const saved = String((await db.syncState.get("catalogueCursor"))?.value ?? "");
      if (cause instanceof Error && cause.message === "Pull starts at a different saved cursor" &&
        /^\d+$/.test(saved) && BigInt(saved) > BigInt(cursor)) continue;
      throw cause;
    }
    if (!pull.hasMore) return pull.nextCursor;
  }
  throw new Error("Catalogue pull page limit reached; retry to continue");
}

/** A tab leader reduces duplicate traffic; durable receipts remain the correctness boundary. */
export async function syncOfflineSales(db: PartitionedLocalDatabase, csrfToken: string) {
  const cycle = async () => {
    await pullCatalogueChanges(db);
    const result = await pushQueuedSales(db, csrfToken);
    await pullCatalogueChanges(db);
    return result;
  };
  if (!navigator.locks) return cycle();
  return navigator.locks.request(`bms-sync-${db.name}`, { ifAvailable: true },
    (lock) => lock ? cycle() : null);
}

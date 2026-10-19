import type { PartitionedLocalDatabase } from "./index";
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
        if (result.commandId !== record.commandId || result.sale.id !== envelope.input.id || result.sale.number !== envelope.number)
          throw new Error("Server receipt identity did not match the issued bill");
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

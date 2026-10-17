/** Offline outbox ordering contract. Server acceptance and replay belong to M05/M06. */
export type ProvisionalPartyCommand = {
  commandId: string;
  kind: "party.provisional.create";
  provisionalPartyId: string;
  name: string;
  isCustomer: boolean;
  isSupplier: boolean;
  dependsOn: readonly [];
};
export type DependentDocumentCommand = {
  commandId: string;
  kind: "sale.create" | "purchase.create";
  provisionalPartyId?: string;
  dependsOn: readonly string[];
};
export type OutboxCommand = ProvisionalPartyCommand | DependentDocumentCommand;

/** Stable topological order. A provisional party must be acknowledged before its document. */
export function orderOutbox(commands: readonly OutboxCommand[]): OutboxCommand[] {
  const byId = new Map(commands.map((command) => [command.commandId, command]));
  if (byId.size !== commands.length) throw new Error("Duplicate outbox command ID");
  const partyCreators = new Map<string, ProvisionalPartyCommand>();
  for (const command of commands) {
    if (command.kind !== "party.provisional.create") continue;
    if (!command.name.trim() || !(command.isCustomer || command.isSupplier)) throw new Error("Invalid provisional party");
    if (partyCreators.has(command.provisionalPartyId)) throw new Error("Duplicate provisional party ID");
    partyCreators.set(command.provisionalPartyId, command);
  }
  for (const command of commands) {
    for (const dependency of command.dependsOn) {
      if (!byId.has(dependency)) throw new Error("Missing outbox dependency");
    }
    if (command.kind === "party.provisional.create" || !command.provisionalPartyId) continue;
    const creator = partyCreators.get(command.provisionalPartyId);
    if (!creator || !command.dependsOn.includes(creator.commandId)) throw new Error("Document must depend on its provisional party create command");
    if (command.kind === "sale.create" && !creator.isCustomer ||
        command.kind === "purchase.create" && !creator.isSupplier) throw new Error("Provisional party role mismatch");
  }
  const sorted: OutboxCommand[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(command: OutboxCommand) {
    if (visited.has(command.commandId)) return;
    if (visiting.has(command.commandId)) throw new Error("Outbox dependency cycle");
    visiting.add(command.commandId);
    for (const dependency of command.dependsOn) visit(byId.get(dependency)!);
    visiting.delete(command.commandId);
    visited.add(command.commandId);
    sorted.push(command);
  }
  for (const command of commands) visit(command);
  return sorted;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { orderOutbox, type OutboxCommand } from "../packages/domain/src/index";

test("provisional party creates precede dependent documents with stable ordering", () => {
  const party: OutboxCommand = { commandId: "p1", kind: "party.provisional.create",
    provisionalPartyId: "local-party-1", name: "Apex", isCustomer: true, isSupplier: false, dependsOn: [] };
  const sale: OutboxCommand = { commandId: "s1", kind: "sale.create", provisionalPartyId: "local-party-1", dependsOn: ["p1"] };
  assert.deepEqual(orderOutbox([sale, party]).map((command) => command.commandId), ["p1", "s1"]);
  assert.deepEqual(orderOutbox([party, sale]).map((command) => command.commandId), ["p1", "s1"]);
  assert.throws(() => orderOutbox([{ ...sale, dependsOn: [] }, party]), /must depend/);
  assert.throws(() => orderOutbox([{ ...sale, dependsOn: ["missing"] }, party]), /Missing/);
  assert.throws(() => orderOutbox([{ ...sale, kind: "purchase.create" }, party]), /role mismatch/);
  assert.throws(() => orderOutbox([party, { ...party, commandId: "p2" }]), /Duplicate provisional/);
  assert.throws(() => orderOutbox([party, party]), /Duplicate outbox/);
  assert.throws(() => orderOutbox([{ ...sale, commandId: "s1", dependsOn: ["s2", "p1"] },
    { ...sale, commandId: "s2", dependsOn: ["s1", "p1"] }, party]), /cycle/);
});

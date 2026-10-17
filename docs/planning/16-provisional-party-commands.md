# Provisional party dependency contract

M04 defines the offline command shape and ordering. M05/M06 will implement device persistence, server acceptance and replay; no current UI can issue an offline sale.

- A device generates a provisional party ID and a unique command ID within its authenticated user, business, enrolled device and dataset epoch partition. The create command contains name, customer/supplier flags and an empty dependency list.
- An offline sale or purchase referring to the provisional ID explicitly includes the create command ID in `dependsOn`. The local outbox persists both commands before showing a saved document. `orderOutbox` performs stable topological sorting and rejects unknown dependencies, cycles, duplicate IDs and role mismatch.
- Upload the party create first. Do not release a dependent document until the server returns an accepted command receipt and the canonical server party ID. A rejected/quarantined create leaves dependent documents pending for correction; it never silently converts them to a walk-in party.
- The server scopes the accepted mapping by business, dataset epoch, device enrollment and command ID. Replaying the same command returns the same mapping; a changed payload under the same ID conflicts. Cross-business IDs cannot be resolved.
- Similar names or phone numbers may be suggested for manual review. They never auto-merge or silently redirect posted documents. Later corrections preserve the original source identity and an audit trail.

This protocol does not claim offline billing or multi-device replication until M05/M06 persistence and browser tests pass.

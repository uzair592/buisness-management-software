# Milestone 06 — Online browser cutover and multi-user proof

The 2026-10-20 product decision replaces the former offline issue target. Use [the shared contract](00-agent-contract.md), current [status](../PROJECT_STATUS.md) and the [roadmap](../docs/planning/10-delivery-roadmap.md). The former [offline prompt](06-offline-and-sync.md) is historical and is not an acceptance gate for new work.

## Behaviour

1. Real billing requires a verified server session and a live server catalogue. Never issue or number a new bill in IndexedDB, even when an older PWA shell remains cached.
2. Retire the old service worker and offline intake endpoint. Preserve old local partitions and provide encrypted inspection/export for bills issued before cutover. Do not automatically replay or discard them. A reviewed reconciliation workflow is a separate gate.
3. Keep server-issued sale IDs, command IDs, receipt replay, exact calculations, tenant scope and atomic journal/stock/payment writes intact.
4. Show clear connection and legacy-recovery states. Do not promise offline operation, installation or instant multi-device updates.

## Acceptance gate

- Fresh online sale and saved draft retry against real PostgreSQL and a browser; lost response returns one document, receipt, journal, stock effect and payment.
- Two signed-in browser profiles see server-accepted changes without accessing another business. Simultaneous issue, failed transaction and tenant permissions are checked against the restricted runtime role.
- A network-failed billing workspace shows no stale editable catalogue or offline issue control. Previously cached clients get `OFFLINE_RETIRED` from the server and cannot create new effects.
- Recovery export and inspection preserve old issued records. Upgrading a previously controlled browser retires the old shell cache without deleting IndexedDB. Provide screenshots at laptop and mobile widths for affected UI.

After this gate, continue M07 online purchases and money. Do not call the transition complete from a build or unit-only result.

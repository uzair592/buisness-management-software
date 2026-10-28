# Local Storage & Legacy Recovery Boundary (`apps/web/src/db`)

## Architectural Purpose (Online-Only Monolith)

As established in Milestone 06 (Online Web Transition, 2026-10-20), this business management software is strictly an **online browser application**.

The local database components in this directory (`apps/web/src/db/`) serve two explicit, safeguarded purposes:

1. **Legacy Recovery & Historical Safeguards**:
   - Holds legacy browser-issued records created before the online cutover in isolated, tenant-partitioned IndexedDB stores (`bms_v3_{businessId}_{userId}_{enrollmentId}`).
   - Provides encrypted inspection and export (`recovery.ts`) so an authorized operator can export pending/unreconciled records without ever silently deleting or dropping unacknowledged financial work.
   - The cloud server strictly rejects new offline push attempts with `410 OFFLINE_RETIRED`, keeping the accounting books under authoritative server control.
2. **Form Draft Resilience (Tab Refresh Protection)**:
   - Prevents operators from losing an active cart or multi-line invoice if a browser tab is accidentally refreshed or closed before posting.

## Modules

- `index.ts`: Partitioned IndexedDB manager using Dexie (version 30). Isolates storage per user, business, and device enrollment.
- `recovery.ts`: AES-GCM encrypted recovery bundle export/inspection for legacy pre-cutover bills.
- `offline-sale.ts` & `offline-sync.ts`: Preserved for legacy recovery tests and verification contracts (`tests/offline-sale.test.ts`). Not invoked by active online billing workflows.

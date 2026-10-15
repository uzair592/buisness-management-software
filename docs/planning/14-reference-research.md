# Reference research and source limits

Reviewed on 15 October 2026. Public product documentation establishes user-facing reference behaviour, not Vyapar's internal design, reliability under every failure, or a feature implemented in this repository. Feature availability may vary by plan/platform. Do not embed prices or plan promises from these pages in our product.

## Product reference

| Primary source | Observed reference behaviour | Planning consequence |
| --- | --- | --- |
| [Vyapar business management](https://vyaparapp.in/business-management-software) | Connected sales, inventory, accounting, parties, reports and business controls | Familiar module structure and connected business workflows; independent implementation |
| [Vyapar multi-device guide](https://vyaparapp.in/guides/how-to-use-vyapar-app-on-multiple-devices) | Shared company access, user/device setup, initial internet sync and role-controlled use | Explicit enrolment, business selection, roles and shared device workflow |
| [Vyapar offline billing guide](https://vyaparapp.in/guides/how-to-make-bills-offline-in-vyapar) | Previously downloaded local data supports offline bill creation; reconnect needed for shared updates and online-only external functions | Real local writes, pending-sync state and an action-specific offline matrix |

The offline guide describes a particular sync-setting workflow. We are not copying that workflow or inferring its concurrency guarantees. This project's always-durable outbox and conflict policies are proposed engineering choices. We have not audited a paid Vyapar app, its source, its exact screen layouts or its private sync protocol.

## Engineering references

| Primary source | Relevant constraint | Application in this plan |
| --- | --- | --- |
| [MDN: Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) | Multiple stores can participate in a transaction; lifecycle/shutdown durability needs care | Invoice/counter/outbox commit together; save before success; no unload-based persistence |
| [Dexie transaction documentation](https://dexie.org/docs/Dexie/Dexie.transaction()) | Transaction promise resolves on commit; unrelated async work can end the transaction | Keep network operations outside local transactions; use Dexie core, not assumed Dexie Cloud service |
| [MDN: StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist) | Persistence is a browser request and is not automatically granted | Request/verify storage policy and provide recovery; no promise browser data can never be lost |
| [MDN: Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API) | Browser availability is limited | Foreground/startup/reconnect/manual sync are required |
| [PostgreSQL: Explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html) | Row locks coordinate competing writers; consistent lock order reduces deadlocks | Short atomic posting, deterministic row locking, retry and a business sync-head lock |
| [PostgreSQL: Row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) | Policies require correct roles; owners/superusers can bypass normal RLS | Restricted runtime role, FORCE where applicable, scoped connection tests and separate maintenance role |
| [OWASP: Session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) | Session lifecycle, cookie protections and revocation need explicit design | Same-origin secure sessions, rotation/revocation and no cached server passwords |

## What remains empirical

Real printer/cutter behaviour, PWA installation and storage persistence on target browsers, offline window suitable for the pilot, expected transaction volume, hosting provider capabilities, accountant acceptance of configuration, and any jurisdiction integration must be tested or separately verified before claims are made. Public marketing pages cannot replace those checks.

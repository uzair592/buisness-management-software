# Project status

Last planning update: 2026-10-15.

| Milestone | Status | Evidence |
| --- | --- | --- |
| M00 Product plan and diagrams | Complete | Planning documents, 30 Mermaid sources and staged agent prompts in this repository |
| M01 Foundation | Not started | No application code |
| M02 Identity and devices | Not started | — |
| M03 Domain and journal | Not started | — |
| M04 Catalogue and opening balances | Not started | — |
| M05 First sale | Not started | — |
| M06 Offline and two-device sync | Not started | — |
| M07 Purchases and money | Not started | — |
| M08 Returns and inventory lifecycle | Not started | — |
| M09 Reports and reconciliation | Not started | — |
| M10 UX, printing and installation | Not started | — |
| M11 Backup, import and operations | Not started | — |
| M12 Quotes and warehouse workflows | Not started | — |
| M13 Pilot and release | Not started | — |
| M14 Optional commercial platform | Deferred | Requires product decision |

## Next action

Run [Milestone 01](prompts/01-foundation.md) together with the [agent contract](prompts/00-agent-contract.md). This establishes the repo and UI shell; it does not complete billing or offline mode.

## M00 validation

- All 30 Mermaid source diagrams parsed successfully with Mermaid 11.
- All 259 relative Markdown links resolve; all 30 embedded diagrams match their editable source files exactly.
- All 14 milestone prompts include required reading, concrete work, acceptance gates and handoff instructions.
- Staged `git diff --check` passed. Application tests are not applicable because implementation has not started.

## Milestone evidence format

For each completed milestone add: PR URL, commit SHA, exact check commands and outcomes, migration and rollback/recovery notes, screenshots for UI changes, known limitations, and release gate status. A passing build alone is insufficient evidence of business correctness.

# Project map

This package defines the intended product and how an agent should build it in reviewable steps. **Only M00 is complete.**

| Document | Decision it supports |
| --- | --- |
| [01 Product scope](planning/01-product-scope.md) | Who the product serves and what belongs in the first release |
| [02 Feature matrix](planning/02-feature-matrix.md) | What ships when, including offline limits |
| [03 UX and screen map](planning/03-ux-and-screen-map.md) | Navigation, screen behaviour and device layouts |
| [04 Architecture](planning/04-architecture.md) | Runtime, modules and transaction boundaries |
| [05 Data model](planning/05-data-model.md) | Entities, relationships and constraints |
| [06 Business flows](planning/06-business-flows.md) | Everyday work from onboarding to reconciliation |
| [07 Offline sync](planning/07-offline-sync.md) | Commands, retries, cursors, conflicts and failure recovery |
| [08 Accounting rules](planning/08-accounting-rules.md) | Amounts, journals, inventory costs and corrections |
| [09 Security](planning/09-security-permissions.md) | Roles, tenants, devices and data access |
| [10 Roadmap](planning/10-delivery-roadmap.md) | Ordered milestones and acceptance gates |
| [11 Testing and release](planning/11-testing-and-release.md) | Evidence needed before real business use |
| [12 Deployment and backup](planning/12-deployment-backup.md) | Hosting boundaries, recovery and operating procedures |
| [13 Decisions and risks](planning/13-open-decisions-and-risks.md) | Assumptions, unresolved choices and proposed additions |
| [14 Reference research](planning/14-reference-research.md) | Sources and limits of the Vyapar comparison |
| [15 Traceability](planning/15-requirements-traceability.md) | Requirements connected to diagrams, milestones and tests |
| [Diagram catalogue](diagrams/README.md) | All 30 editable diagrams |
| [Agent prompts](../prompts/README.md) | Copy-ready instructions for each milestone |

## How to use the package

Read scope, UX and architecture first. The offline protocol and accounting rules are shared contracts for every later milestone. Hand the agent the contract plus one numbered prompt, review its PR and evidence, merge through your normal process, then move to the next prompt. Read the latest repository state before every step.

All design choices are proposals for this repository. Vyapar's public pages establish reference behaviours; they do not disclose its internal architecture or prove any feature exists here.

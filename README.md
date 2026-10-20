# Business Management Software

A web-based business-management product inspired by Vyapar's ease of use: fast online billing, connected inventory and accounts, and shared access across devices.

**Current status:** Online sale and identity foundations are merged. The online-only transition is in local review; purchases, returns, reports and release gates remain open. An explicit sample workspace can be explored without creating business records. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for actual acceptance evidence. A server connection is required for real billing; older browser-issued bills remain recoverable for reconciliation.

## Start here

1. Read the [project map](docs/README.md) and [product scope](docs/planning/01-product-scope.md).
2. Review the [30 rendered diagrams](docs/planning/06-business-flows.md), [architecture](docs/planning/04-architecture.md), and [data model](docs/planning/05-data-model.md). The diagram links cover all planning documents, not just business flows.
3. Follow the [milestone roadmap](docs/planning/10-delivery-roadmap.md).
4. Follow the [agent contract](prompts/00-agent-contract.md) and the selected current milestone prompt.
5. Review each milestone's evidence before starting the next prompt. [PROJECT_STATUS.md](PROJECT_STATUS.md) records actual progress.

## Working product direction

| Area | Proposed direction |
| --- | --- |
| First customers | Pakistan-first small retailers, wholesalers, distributors and service businesses |
| Daily work | Sales, purchases, returns, parties, inventory, expenses, cash and bank, reports |
| Experience | Clear original design; compact laptop billing; mobile-friendly owner access |
| Connectivity | Online-only posting against the server; no new browser-issued bills |
| Multiple devices | Shared PostgreSQL authority; server-side concurrency and permissions |
| Platform | Responsive browser application on desktop and mobile |
| Accounts | Double-entry journal behind simple business screens |
| Local defaults | PKR, Asia/Karachi, English first; configurable generic taxes |

These are planning assumptions, not a claim that every requirement has been approved. See [open decisions and proposed additions](docs/planning/13-open-decisions-and-risks.md). The initial product does not promise Indian GST, Pakistan FBR/KPRA integration, or certified tax compliance.

## Planning contents

- [Feature matrix and release scope](docs/planning/02-feature-matrix.md)
- [Screen map and UX specification](docs/planning/03-ux-and-screen-map.md)
- [Historical offline protocol and legacy recovery](docs/planning/07-offline-sync.md)
- [Accounting and inventory rules](docs/planning/08-accounting-rules.md)
- [Security and permissions](docs/planning/09-security-permissions.md)
- [Testing and release gates](docs/planning/11-testing-and-release.md)
- [Deployment, backup and recovery](docs/planning/12-deployment-backup.md)
- [Requirements traceability](docs/planning/15-requirements-traceability.md)
- [Agent prompt sequence](prompts/README.md)
- [Reference research](docs/planning/14-reference-research.md)

No delivery dates or hosting prices are promised at this stage. Estimates should follow measured online billing and accounting gates.

## Run locally

See [development setup and validation](docs/development.md) for the pnpm workspace, local PostgreSQL, API and web application.

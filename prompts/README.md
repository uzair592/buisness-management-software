# Coding-agent prompt sequence

Start with the [shared contract](00-agent-contract.md) plus **one** milestone prompt. The agent must read repository specs and actual progress before implementation. The full roadmap is not a request to build all stages in one response.

## First message to your agent

Copy this starter, or provide the contract and M01 files directly:

```text
Work in https://github.com/uzair592/buisness-management-software.
Read AGENTS.md, README.md, PROJECT_STATUS.md, prompts/00-agent-contract.md,
and prompts/01-foundation.md. Implement Milestone 01 only, following its
required specifications and acceptance gate. Use a milestone branch,
run the required checks, update actual project status with evidence,
push the branch, and open a reviewable pull request. Report its URL,
commit SHA, screenshots, check results and remaining limitations.
Do not merge or deploy.
```

For later work, replace only the selected prompt path/ID after the previous required milestone is accepted/merged. Do not skip M06's real offline/two-device gate. M12 can be deferred for a documented core-only pilot; M14 runs only when the user selects commercial SaaS.

| Milestone | Copy-ready prompt |
| --- | --- |
| M01 | [Workspace and responsive application shell](01-foundation.md) |
| M02 | [Username authentication, business scope and device enrolment](02-identity-and-devices.md) |
| M03 | [Exact calculations and atomic posting foundation](03-domain-and-journal.md) |
| M04 | [Items, parties, accounts and opening balances](04-catalogue-and-opening.md) |
| M05 | [Complete online sale, payment and saved receipt](05-first-sale.md) |
| M06 | [Genuine offline cash billing and multi-device convergence](06-offline-and-sync.md) |
| M07 | [Purchases, expenses, receipts, payments and accounts](07-purchases-and-money.md) |
| M08 | [Credits, refunds, stock counts and resolved valuation](08-returns-and-stock.md) |
| M09 | [Authoritative reports and daily cash reconciliation](09-reports-and-reconciliation.md) |
| M10 | [Polished UX, invoice templates and install/update behaviour](10-ux-print-and-install.md) |
| M11 | [Recovery, portability and production-like operations](11-backup-import-and-operations.md) |
| M12 | [Quotations, purchase orders and warehouse transfers](12-orders-and-warehouses.md) |
| M13 | [Deep enabled-scope review and launch decision](13-pilot-and-release.md) |
| M14 | [Optional SaaS subscriptions and platform control](14-optional-commercial-platform.md) |

Reference: [roadmap and release gates](../docs/planning/10-delivery-roadmap.md), [test scenarios](../docs/planning/11-testing-and-release.md), [current status](../PROJECT_STATUS.md).

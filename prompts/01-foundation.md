# Milestone 01 — Workspace and responsive application shell

Repository: https://github.com/uzair592/buisness-management-software

Use [the shared agent contract](00-agent-contract.md) and AGENTS.md. Implement **M01 only**, on a reviewable milestone branch. Read current PROJECT_STATUS.md and verify prerequisites; all features in the plan are proposed until implemented and tested.

## Required reading

- [01-product-scope.md](../docs/planning/01-product-scope.md)
- [03-ux-and-screen-map.md](../docs/planning/03-ux-and-screen-map.md)
- [04-architecture.md](../docs/planning/04-architecture.md)
- [10-delivery-roadmap.md](../docs/planning/10-delivery-roadmap.md)

## Work to complete

1. Establish a pnpm TypeScript workspace for web, API and shared domain/contracts/UI/db as needed. Choose supported compatible versions, commit the lockfile and document why. Do not create separate microservices or duplicate business engines.
2. Add local PostgreSQL setup, env validation/example, repeatable dev/build/check commands and minimal API liveness/readiness. Ensure production mode cannot load demo credentials or reset data.
3. Implement an original compact light UI shell with navigation for Home, Sales, Purchases, Parties, Items/Stock, Cash/Bank, Expenses, Reports and Settings/Sync. Put advanced planned screens behind honest not-yet-available states. Avoid invented live totals.
4. Build reusable accessible controls, tables, panels, status badges, forms and layout tokens. Add a New Sale workspace layout with a visible cart, item-search focus and sticky summary, explicitly a shell until M05.
5. Establish CI for install/lint/typecheck/build and a small relevant smoke check. Document fresh-clone setup and source responsibilities. Add design-decision notes only where an actual choice differs from the plan.

## Acceptance gate

- A fresh checkout can install and run documented commands without secret files in git.
- Lint, typecheck and production build pass; API starts and reports DB readiness accurately.
- Inspect shell and sale layout at 1366 × 768, 1920 × 1080 and 390 × 844; attach screenshots and check navigation/focus.
- No random dashboard data or claim of functioning billing, login or offline transactions.

Run relevant existing checks and report exact commands/results. Attach reproducible persistence/DB/browser evidence where required. Update PROJECT_STATUS.md truthfully; commit and push the branch, open a PR, and report its URL and SHA. Do not merge or deploy without user authority.

## Next eligible work

M02 identity and devices. Do not implement the full billing/backend roadmap in this PR.

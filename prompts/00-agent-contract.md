# Shared coding-agent contract

Use this contract with exactly one numbered milestone prompt. Repository: https://github.com/uzair592/buisness-management-software

## Assignment

Build an original, easy-to-use business-management product with connected billing, inventory, accounts and multi-device offline operation. The repository's documents describe the intended product, not completed software. Read the current repository and verify its actual state before making claims.

## Before implementation

1. Read AGENTS.md, README.md, PROJECT_STATUS.md, the selected prompt and its required specifications.
2. Inspect latest merged base, open work and existing checks. Preserve unrelated changes and use one milestone branch. Do not reset the repo or rewrite history.
3. Identify prerequisites. If an earlier required gate is genuinely missing, implement the narrow prerequisite or report the concrete blocker; do not build a facade that pretends it works.
4. Use the working defaults in the decision register for reversible choices. Record justified architecture changes with their consequences and tests. Do not stall on an optional branding preference.

## Implementation standard

- Complete working UI/API/persistence for the selected milestone, with usable loading/empty/error/access/offline states. Reuse existing components and avoid parallel versions of the same workflow.
- All tenant records/references/queries/exports/jobs are membership-scoped. Tests must include a second business and a restricted user.
- Money and quantity calculations use shared exact decimal rules. Saved/printed totals and server recomputation agree under a persisted calculation version.
- Stable command IDs, immutable hashes, unique effect identities and one DB transaction prevent duplicate business effects under retries. All writers obey the commit-ordered business sync-head contract.
- Local issue atomically persists document, number and outbox before success. Do not use localStorage or a service-worker page cache as the transactional database.
- Never hard-delete/overwrite posted financial history. Apply explicit linked credits, reversals or adjustments.
- Never show a partial device cache as a complete shared report. Preserve and label pending or held issued work.
- Never add production demo credentials, fake provider success, random dashboard figures or buttons backed only by local temporary arrays.
- Use maintained supported dependencies, locked versions and an explicit env schema. Keep secrets and private data out of commits/logs/screenshots.

## Checks and review

Run required repository checks and the selected milestone acceptance scenarios. Use real PostgreSQL/browser persistence for integrity, concurrency and sync claims. Tests should demonstrate observable behaviour and failure recovery; avoid tests that only restate implementation details.

Before handoff: inspect the diff, run whitespace checks, review migrations and queued/local-store compatibility, and update PROJECT_STATUS.md with measured evidence. Include UI screenshots for visible work at relevant viewports. State untested physical hardware/provider checks honestly.

Push the milestone branch and create a clear PR when repository access allows. Do not merge or deploy unless the user has authorised that action. A milestone PR should be concrete and reviewable without asking the user to approve unfinished implementation.

## Required final report

- Branch, PR URL and exact commit SHA.
- Concrete behaviour now working and important implementation decisions.
- Migration/setup impact and reproducible check commands/results.
- Screenshots or artefacts for changed UI/print behaviour.
- Failed/unrun checks, known limitations and release gate outcome.
- Updated project status and the next eligible prompt.

Do not claim a milestone complete when a required gate fails. Do not say production-ready unless M13's enabled-scope evidence supports that statement. Run one milestone at a time; do not automatically continue through all prompts.

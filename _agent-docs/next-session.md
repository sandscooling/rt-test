# Next session

## Objective

Build RT Test as a standalone tool providing fast, queryable Vitest results, freshness tracking, selective execution, and named-defect evidence. Read `AGENTS.md` first, then `docs/plan.md`, `docs/architecture.md`, and `docs/roadmap.md`.

## Agreed direction

- Project name: RT Test; folder and repository slug: `rt-test`.
- Public GitHub repository under `sandscooling`, MIT license.
- Keep the product independent of any application or backend.
- Start with Vitest integration and local state; use adapters for Convex and other hidden dependencies.
- Maintain dependency, observed execution, and defect-detection relationships separately.
- Require current input evidence before reporting a current pass.
- Run ordinary tests promptly and schedule defect verification separately.
- Never mutate a consumer's live working files.
- Treat performance numbers as targets until benchmarked.

## Where the direction lives

The product direction agreed with the owner is carried by `docs/plan.md`, `docs/architecture.md`, `docs/roadmap.md`, `docs/requirements.md`, `docs/glossary.md`, and the ADRs in `docs/adr/`. The agent workflow decisions are carried by `AGENTS.md`, `_agent-docs/`, and the skills in `.claude/skills/`. Change either through `change-request`.

## Starter contents

The repository includes documentation, strict TypeScript tooling, an eight-test result-freshness core, explicit mutation records, a disposable-copy defect-check script, and Windows/Linux CI configuration. There is no daemon, watcher, dependency graph, persistence layer, consumer CLI, or general falsification engine yet.

The repository is a Bun workspace: the core lives in `packages/core` (`@rt-test/core`), `apps/*` is reserved for editor integrations, and repository tooling stays at the root. `packages/core/src/evidence.ts` trusts caller-supplied fingerprints. Completeness, hashing, project identity, revision ordering, and run ingestion remain M1/M2 work. `scripts/verify-defects.mjs` validates only the known hook-free fixtures in `test/defects.json`; its classifier must not be presented as a general solution.

Linting uses oxlint 1.85 (`.oxlintrc.json`, custom rules in `lint/`), because typescript-eslint cannot load TypeScript 7. Ported from Fleet Cooling: 500-line cap on production files, cognitive complexity warn 15 and error 40, the generic half of `no-nonlocal-comment` (D009 to D020), the test-file focus, skip, and snapshot bans, and the `bunfig.toml` three-day release-age gate. `lint/plugin.mjs` deep-imports SonarJS's `S3776` rule, since the package index resolves the hoisted TypeScript 7; recheck that path when upgrading `eslint-plugin-sonarjs`. Not ported: `naming-convention` (oxlint lacks it), the real-time-sleep test ban, and every Convex, Next, or product-specific rule.

## Validation

Run `bun install --frozen-lockfile` and `bun run check`. Inspect the committed setup record below for the initial verification outcome.

## Next action

The agent workflow is ported, and the plan `change-request` has written the M1 plan: sprints 1 and 2 in `_agent-docs/sprints/`, with ticket state in `_agent-docs/sprint-status.yaml`. Ticket 1.1 (discover tests across Vitest workspaces) is ready for dev, with its Vitest 4.1 and 5 spike done; 1.1b (record Vitest run states) was split from it and follows. Take each ticket through `dev-ticket`, `create-tests`, and `review-changes`. The orchestrator's working state is in `_agent-docs/.scratch/orchestrator-state.md`.

Work on `main`. Hand off to a successor instead of compacting, per `_agent-docs/handoff.md`. The owner's discussion session orchestrates: agreed changes go to lanes of child sessions (`.claude/skills/orchestrator/SKILL.md`, member half in `_agent-docs/crew.md` and `_agent-docs/code-change-standards.md` § Orchestrated Gate Delegation). No agent claims or persistent processes need to be resumed. No npm publication is authorized.

## Setup record

- Public repository: https://github.com/sandscooling/rt-test
- Working branch: `main`, which is the GitHub default. The remote `dev-work` branch is fully merged into `main` and awaits deletion by the owner.
- Local `bun run check` passed on Windows with Node 24.19.0 and Bun 1.3.14: formatting, strict typecheck, 8/8 Vitest tests, 8/8 named-defect checks, restored baseline, and build.
- Dependency versions are pinned and `bun.lock` is committed. The package remains private to prevent npm publication.
- CI runs the same gates on Windows and Linux with Node 22 and 24. Inspect the latest Actions run for remote validation status.
- Disposable mutation copies were removed. No background watcher or daemon was started.
- Lint port, validated locally on Windows with Node 24.19.0 and Bun 1.3.14: oxlint clean, typecheck clean, 20/20 Vitest tests, 20/20 named defects detected with the restored baseline green. Temporary probe files confirmed each root rule fires on its intended paths.

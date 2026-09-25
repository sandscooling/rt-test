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

## Direction agreed with the owner, not yet in the plan docs

Rewrite `docs/plan.md`, `docs/architecture.md`, and `docs/roadmap.md` to carry these before starting M1:

- Fleet Cooling (sibling checkout `C:\source\fleetcooling`) is the proving ground; RT Test stays generic. About 10,000 tests across five Vitest workspaces (jsdom and edge-runtime); the full sequential chain takes about 7 minutes, `packages/convex` about 3. Do not edit that checkout from RT Test work unless asked; it carries other sessions' uncommitted changes.
- Support Vitest 4.1.x, the consumer's version, as well as 5.x. Support multiple Vitest workspaces from M1.
- The daemon is the sole test executor. Agents never start runs; they query, or call `wait` scoped to their own files. A run whose inputs change mid-run is invalidated and rerun, which replaces Fleet Cooling's run lock for tests and falsification. Lint and typecheck stay with agents.
- Move the Convex adapter earlier by porting `scripts/test-blast-radius.mjs` (`vitest related` is useless there, since every Convex test globs the whole package). Porting any Fleet Cooling code is authorized.
- Port `scripts/falsify.mjs` into the product. Replace its message-text classifier, whose growth is the owner's main pain, with facts recorded during the run: failure phase, error kind, whether the mutated code was reached, and the baseline result. Apply mutations as transforms in a separate Vitest instance, never as file writes. Keep canary fixtures, aimed at the fact collector.
- Commit defect definitions in the consumer repo at a configurable location; keep evidence local under `.rt-test/`. Attribute by stable test ID, including `it.each` arms. Report tests with no defect as a gap.
- A missing mutation anchor is a per-defect `anchor-missing` state that names the gap in the denominator and blocks "verified"; the other defects still run.
- RT Test chooses no mutations and diagnoses no survivors; the author does.
- Port Fleet Cooling's workflow pipeline (change-request, create-ticket, dev-ticket, create-tests, review-changes, the full orchestrator), keeping only what fits RT Test. Adopt sprints mapped to milestones, tickets, a requirements doc with FR and NFR ids and lifecycle markers, ADRs, a glossary, doc verification in review, the ADR index and line-citation checks, the doc-integrity hook, rule maintenance, and lint-harden. Skip the UX spec and component catalog until an app exists; defer drift-sweep.
- Keep one home per concern. Use ADRs only, not Fleet Cooling's older CADs, and leave behind any gate that exists only to keep two copies of one fact aligned.
- Port the scale machinery (context fan-out agents, sharded checklist, sprint-context bundles) switched off, behind a configuration switch with a measurable trigger for enabling it, and keep the dormant path tested so it does not rot.
- Interface: a CLI with versioned `--json` output in front of the daemon, plus a small programmatic API. No MCP server. Support `status <path>` for files and folders with non-binary states, for a later VS Code folder-view extension.

## Starter contents

The repository includes documentation, strict TypeScript tooling, an eight-test result-freshness core, explicit mutation records, a disposable-copy defect-check script, and Windows/Linux CI configuration. There is no daemon, watcher, dependency graph, persistence layer, consumer CLI, or general falsification engine yet.

The repository is a Bun workspace: the core lives in `packages/core` (`@rt-test/core`), `apps/*` is reserved for editor integrations, and repository tooling stays at the root. `packages/core/src/evidence.ts` trusts caller-supplied fingerprints. Completeness, hashing, project identity, revision ordering, and run ingestion remain M1/M2 work. `scripts/verify-defects.mjs` validates only the known hook-free fixtures in `test/defects.json`; its classifier must not be presented as a general solution.

Linting uses oxlint 1.85 (`.oxlintrc.json`, custom rules in `lint/`), because typescript-eslint cannot load TypeScript 7. Ported from Fleet Cooling: 500-line cap on production files, cognitive complexity warn 15 and error 40, the generic half of `no-nonlocal-comment` (D009 to D020), the test-file focus, skip, and snapshot bans, and the `bunfig.toml` three-day release-age gate. `lint/plugin.mjs` deep-imports SonarJS's `S3776` rule, since the package index resolves the hoisted TypeScript 7; recheck that path when upgrading `eslint-plugin-sonarjs`. Not ported: `naming-convention` (oxlint lacks it), the real-time-sleep test ban, and every Convex, Next, or product-specific rule.

## Validation

Run `bun install --frozen-lockfile` and `bun run check`. Inspect the committed setup record below for the initial verification outcome.

## Next action

Port Fleet Cooling's workflow pipeline through lanes (a `workflow-port` inventory spike is mapping it). Once the pipeline works, hand the agreed direction above to `change-request` as its first real job: it creates the tickets and updates the plan docs. Then implement M1 as a vertical slice: a synthetic Vitest project produces structured events, a local store persists them, and a read-only JSON query returns honest counts and freshness. First spike the installed Vitest API, test identity, SQLite driver, and IPC transport. Establish baseline timings before optimizing selection.

Work on `main`. Hand off to a successor instead of compacting, per `_agent-docs/handoff.md`. The owner's discussion session orchestrates: agreed changes go to lanes of child sessions (`.claude/skills/orchestrator/SKILL.md`, member half in `_agent-docs/crew.md`), ported and slimmed from Fleet Cooling's orchestrator. No agent claims or persistent processes need to be resumed. No npm publication is authorized.

## Setup record

- Public repository: https://github.com/sandscooling/rt-test
- Working branch: `main`, which is the GitHub default. The remote `dev-work` branch is fully merged into `main` and awaits deletion by the owner.
- Local `bun run check` passed on Windows with Node 24.19.0 and Bun 1.3.14: formatting, strict typecheck, 8/8 Vitest tests, 8/8 named-defect checks, restored baseline, and build.
- Dependency versions are pinned and `bun.lock` is committed. The package remains private to prevent npm publication.
- CI runs the same gates on Windows and Linux with Node 22 and 24. Inspect the latest Actions run for remote validation status.
- Disposable mutation copies were removed. No background watcher or daemon was started.
- Lint port, validated locally on Windows with Node 24.19.0 and Bun 1.3.14: oxlint clean, typecheck clean, 20/20 Vitest tests, 20/20 named defects detected with the restored baseline green. Temporary probe files confirmed each root rule fires on its intended paths.

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

## Starter contents

The repository includes documentation, strict TypeScript tooling, an eight-test result-freshness core, explicit mutation records, a disposable-copy defect-check script, and Windows/Linux CI configuration. There is no daemon, watcher, dependency graph, persistence layer, consumer CLI, or general falsification engine yet.

`src/evidence.ts` trusts caller-supplied fingerprints. Completeness, hashing, project identity, revision ordering, and run ingestion remain M1/M2 work. `scripts/verify-defects.mjs` validates only the known hook-free bootstrap fixture; its classifier must not be presented as a general solution.

## Validation

Run `bun install --frozen-lockfile` and `bun run check`. Inspect the committed setup record below for the initial verification outcome.

## Next action

Implement M1 as a vertical slice: a synthetic Vitest project produces structured events, a local store persists them, and a read-only JSON query returns honest counts and freshness. First spike the installed Vitest API, test identity, SQLite driver, and IPC transport. Establish baseline timings before optimizing selection.

Use a feature branch. No agent claims or persistent processes need to be resumed. No npm publication is authorized.

## Setup record

- Public repository: https://github.com/sandscooling/rt-test
- Bootstrap branch: `dev-work`. Continue on a feature branch from it.
- Local `bun run check` passed on Windows with Node 24.19.0 and Bun 1.3.14: formatting, strict typecheck, 8/8 Vitest tests, 8/8 named-defect checks, restored baseline, and build.
- Dependency versions are pinned and `bun.lock` is committed. The package remains private to prevent npm publication.
- CI runs the same gates on Windows and Linux with Node 22 and 24. Inspect the latest Actions run for remote validation status.
- Disposable mutation copies were removed. No background watcher or daemon was started.

# Architecture

## Current implementation

`src/evidence.ts` assesses a historical result against a caller-supplied fingerprint. It preserves the outcome and returns freshness plus an explicit current-pass predicate. Missing or empty fingerprints produce unknown freshness.

This function does not build fingerprints, select tests, ingest runner events, or store history. The sections below describe the intended architecture.

## Components

| Component          | Responsibility                                                                    |
| ------------------ | --------------------------------------------------------------------------------- |
| Vitest integration | Discover tests, schedule supported runs, consume structured lifecycle events      |
| Input tracker      | Watch saved inputs, reconcile content, assign project revisions                   |
| Dependency index   | Store module/function relationships and reasons for uncertainty                   |
| Scheduler          | Deduplicate work, prioritize normal tests, apply concurrency and debounce budgets |
| Evidence store     | Persist inputs, runs, results, graph versions, and named-defect evidence          |
| Query service      | Serve consistent snapshots without running tests                                  |
| Defect verifier    | Execute isolated baseline/mutation/restoration experiments                        |
| Framework adapter  | Add otherwise hidden dependency edges and synchronization information             |

Use an independent local process. Keep the persistence interface small; SQLite is the leading candidate, pending a Node-version and cross-platform packaging spike. A local socket or loopback service is also a decision to benchmark. Do not introduce a remote backend for the core.

## Identity and freshness

Identify a project by canonical root and configuration, not package name alone. Distinguish Vitest projects, parameterized test cases, duplicate display names, file paths, and run identities. Scope state to a worktree; two worktrees must not overwrite each other's results.

Fingerprint relevant source and test content, fixtures, setup, configuration, declared environment inputs, dependency lockfiles, runtime, runner version, adapter version, and selection policy version. Persist digests rather than secret environment values. Content hashes alone cannot establish that the input set is complete; record completeness and reasons for uncertainty.

Publish query snapshots with a sequence number, observed revision, last reconciliation time, and watcher health. On startup, mark old evidence unconfirmed until reconciliation finishes. An unknown input set cannot yield a current pass.

Results belong to the inputs actually executed. If an input changes during a run, do not promote that run to current. Keep a generation token so a late completion cannot replace a newer result. If the run could have loaded mixed versions, record it as invalidated and rerun from stable inputs.

## State dimensions

| Dimension          | Intended values                                                 |
| ------------------ | --------------------------------------------------------------- |
| Last test outcome  | Passed, failed, skipped, error, never run                       |
| Freshness          | Current, stale, unknown                                         |
| Execution          | Idle, queued, running, interrupted                              |
| Defect evidence    | Detected, survived, invalid experiment, unclear, never verified |
| Evidence freshness | Current, stale, unknown                                         |

Collect module-level errors and run-level unhandled errors independently of individual test outcomes. Include discovered, selected, executed, skipped, stale, and unknown denominators in summaries. An empty or incomplete run cannot be called verified.

## Dependency index

Use a graph of source files, functions, tests, configuration, fixtures, and other declared inputs. Store dependency edges separately from observed execution and defect-detection edges. Preserve the reason and producer of each edge.

Start from static module dependencies and conservatively widen for unresolved behavior. Maintain reverse edges for invalidation. Analyze both the old and new graph around deletions and changed imports. Never remove a possible dependency solely because one prior test run did not execute it.

Function identity and per-test execution mapping are experimental until tested against refactoring, aliases, callbacks, mocks, concurrency, and module initialization. Stable test IDs must not depend only on a mutable display name. Per-test coverage instrumentation overhead must be measured separately.

Adapters can add edges or require broader selection. They must not suppress core uncertainty without a tested rule. An adapter result includes its version, completeness, affected inputs, and explanation.

## Convex adapter

Convex tests can use broad module registries and `api`/`internal` references, making ordinary import-based selection imprecise. The adapter should understand function references, scheduled dispatch, components, triggers, schema inputs, and generated API changes. Dynamic dispatch or incomplete registration must widen selection.

Keep `convex-test` results distinct from typechecking, development backend synchronization, and live integration results. Use synthetic public fixtures. Do not make the daemon depend on a running Convex backend or automatically push code.

## Execution and mutation isolation

Reuse runner infrastructure where supported, while retaining the configured test isolation. Debounce edit bursts, prioritize direct targets and prior failures, and avoid overlapping duplicate runs. Cancellation must leave explicit interrupted or stale states.

Run defects against an immutable snapshot or an isolated transform with a complete input identity. Never edit the consumer's working source, even temporarily. Ordinary results and intentionally failing mutation runs use different namespaces.

Verify the baseline before mutation. Attribute detection to the intended test and relevant assertion. Treat setup, collection, compile, timeout, and unrelated failures as invalid or unclear experiments. Changing the test, mutation, input closure, or verifier invalidates its evidence.

The bootstrap `scripts/verify-defects.mjs` only validates the known hook-free fixtures listed in `test/defects.json`. Its assertion-message check is not a general attribution algorithm and must not become one by copying it unchanged.

## Query surface

Planned operations include summary, failures, affected selection, explanation, defect evidence, and waiting for a specified revision. Read operations never trigger execution. A wait operation must define its target revision and behavior when more edits arrive.

Expose a versioned JSON schema before adding an agent protocol integration. Keep local endpoints scoped to an explicitly started project, authenticate access if using HTTP, and avoid binding to external interfaces by default. Do not leak source or environment values in summaries.

## Upstream integration references

- [Vitest lifecycle and reporter API](https://vitest.dev/api/advanced/reporters.html): use structured events rather than terminal parsing.
- [Vitest programmatic API](https://vitest.dev/api/advanced/vitest.html): evaluate persistent runner control against installed supported versions.
- [Stryker incremental testing](https://stryker-mutator.io/docs/stryker-js/incremental/): evaluate reuse without inheriting its documented input-invalidation blind spots.
- [Stryker Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/): assess compatibility before selecting a mutation engine.
- [Convex testing](https://docs.convex.dev/testing/convex-test): keep mock-backend evidence distinct from deployed behavior.

# Architecture

## Current implementation

`packages/core/src/evidence.ts` assesses a historical result against a caller-supplied fingerprint. It preserves the outcome and returns freshness plus an explicit current-pass predicate. Missing or empty fingerprints produce unknown freshness.

This function does not build fingerprints, select tests, ingest runner events, or store history. The sections below describe the intended architecture. Every component is TypeScript on Node ([ADR-0001](adr/0001-typescript-on-node.md)), and terms follow [the glossary](glossary.md).

## Components

| Component          | Responsibility                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Daemon             | The sole executor of tests and falsification for one started project                        |
| Vitest integration | Discover tests across workspaces, schedule supported runs, consume structured events        |
| Input tracker      | Watch saved inputs, reconcile content, assign project revisions                             |
| Dependency index   | Store workspace, module, and function relationships and reasons for uncertainty             |
| Scheduler          | Deduplicate work, prioritize ordinary tests, invalidate runs whose inputs moved             |
| Evidence store     | Persist inputs, runs, results, graph versions, and defect evidence                          |
| Query service      | Serve consistent snapshots and waits without running tests                                  |
| Falsifier          | Run baseline and mutated experiments as in-memory transforms and record run facts           |
| Framework adapter  | Add otherwise hidden dependency edges and synchronization information                       |
| CLI and API        | Query and wait through versioned `--json` output or a small programmatic API; never execute |

The daemon is an independent local process and the only component that executes tests ([ADR-0002](adr/0002-daemon-sole-executor.md)). The CLI and API talk to it over a local socket or loopback transport framed by line or by length and versioned (ADR-0001); the transport itself is an M1 spike on Windows and Linux. The store is SQLite through `node:sqlite`, which needs no flag from Node 22.13, the supported floor. Do not introduce a remote backend for the core.

## Identity and freshness

Identify a project by canonical root and configuration, not package name alone. Distinguish Vitest workspaces, parameterized test cases, duplicate display names, file paths, and run identities. Scope state to a worktree; two worktrees must not overwrite each other's results.

Fingerprint relevant source and test content, fixtures, setup, configuration, declared environment inputs, dependency lockfiles, runtime, runner version, adapter version, and selection policy version. Persist digests rather than secret environment values. Content hashes alone cannot establish that the input set is complete; record completeness and reasons for uncertainty.

Publish query snapshots with a sequence number, observed revision, last reconciliation time, and watcher health. On startup, mark old results unconfirmed until reconciliation finishes. An unknown input set cannot yield a current pass.

Results belong to the inputs actually executed. If an input changes during a run, do not promote that run to current: record it as invalidated and rerun from stable inputs. Keep a generation token so a late completion cannot replace a newer result. Because the daemon is the only executor, this replaces an agent-side run lock.

## State dimensions

| Dimension          | Intended values                                                                 |
| ------------------ | ------------------------------------------------------------------------------- |
| Last test outcome  | Passed, failed, skipped, error, never run                                       |
| Freshness          | Current, stale, unknown                                                         |
| Execution          | Idle, queued, running, interrupted                                              |
| Defect evidence    | Detected, survived, invalid experiment, unclear, anchor missing, never verified |
| Evidence freshness | Current, stale, unknown                                                         |

Collect module-level errors and run-level unhandled errors independently of individual test outcomes. Include discovered, selected, executed, skipped, stale, and unknown denominators in summaries. An empty or incomplete run cannot be called verified.

## Dependency index

Use a graph of workspaces, source files, functions, tests, configuration, fixtures, and other declared inputs. Store dependency edges separately from observed execution and defect-detection edges. Preserve the reason and producer of each edge.

Selection starts at workspace granularity: the edited file's workspace plus every workspace that depends on it, with configuration, setup, and lockfile changes as named broad fallbacks. File granularity then comes from static module dependencies, conservatively widened for unresolved behavior. Maintain reverse edges for invalidation. Analyze both the old and new graph around deletions and changed imports. Never remove a possible dependency solely because one prior test run did not execute it.

Function identity and per-test execution mapping are experimental until tested against refactoring, aliases, callbacks, mocks, concurrency, and module initialization. Stable test IDs must not depend only on a mutable display name. Per-test coverage instrumentation overhead must be measured separately.

Adapters can add edges or require broader selection. They must not suppress core uncertainty without a tested rule. An adapter result includes its version, completeness, affected inputs, and explanation.

## Convex adapter

Convex tests can use broad module registries and `api`/`internal` references, so every Convex test file globs the whole package and import-based selection, including `vitest related`, cannot see the real edges. The adapter ports Fleet Cooling's `scripts/test-blast-radius.mjs`: static imports plus `api.<path>` and `internal.<path>` name edges resolved against the generated API module list, where anything unresolved becomes a wildcard that widens every selection and an integrity failure refuses to narrow at all. It then extends to scheduled dispatch, components, triggers, and schema inputs.

Keep `convex-test` results distinct from typechecking, development backend synchronization, and live integration results. Use synthetic public fixtures. Do not make the daemon depend on a running Convex backend or automatically push code.

## Execution and falsification isolation

Reuse runner infrastructure where supported, while retaining the configured test isolation. Debounce edit bursts, prioritize direct targets and prior failures, and never run a test that holds a current result for the same inputs. Cancellation must leave explicit interrupted or stale states.

Falsification applies each mutation as an in-memory module transform in a separate Vitest instance and never writes a mutated file ([ADR-0003](adr/0003-transform-falsification.md)). Verify the baseline before mutation. Decide each verdict from run facts: the failure phase, the error kind, whether the mutated code was reached, and the baseline result. Only an assertion failure in the intended test counts as a detection; setup, collection, compile, timeout, and unrelated failures are invalid or unclear experiments. Ordinary results and mutation runs use different namespaces. Changing the test, mutation, input closure, or falsifier invalidates the evidence. Canary fixtures exercise the fact collector.

Defect definitions come from a configurable location in the consumer repository, and evidence stays under the local state directory ([ADR-0004](adr/0004-defect-definitions-in-consumer.md)). A missing mutation anchor is a per-defect state; the other defects still run.

The bootstrap `scripts/verify-defects.mjs` only validates the known hook-free fixtures listed in the repository's `defects.json` files. Its assertion-message check is not a general attribution algorithm and must not become one by copying it unchanged.

## Query surface

The CLI offers summary, `status <path>` with counts per state for files and folders, failures, affected selection, explanation, defect evidence, gaps, and `wait <files>`. Read operations never trigger execution. A wait binds to the input revision at call time and returns when every test covering the files has a current result or an explicit non-current state, or as superseded, naming the newer revision, as soon as a covering input changes.

Every `--json` payload carries a schema version, which also serves the later gap report that coding agents read to propose defects ([ADR-0005](adr/0005-no-model-calls.md)). There is no MCP server. Keep local endpoints scoped to an explicitly started project, authenticate access if using HTTP, and avoid binding to external interfaces by default. Do not leak source or environment values in summaries.

## Upstream integration references

- [Vitest lifecycle and reporter API](https://vitest.dev/api/advanced/reporters.html): use structured events rather than terminal parsing.
- [Vitest programmatic API](https://vitest.dev/api/advanced/vitest.html): persistent runner control and the separate falsification instance, checked against Vitest 4.1 and 5.
- [Convex testing](https://docs.convex.dev/testing/convex-test): keep mock-backend evidence distinct from deployed behavior.

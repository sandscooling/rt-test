# Architecture

## Current implementation

`packages/core/src/evidence.ts` assesses a historical result against a caller-supplied fingerprint. It preserves the outcome and returns freshness plus an explicit current-pass predicate. Missing or empty fingerprints produce unknown freshness. `packages/core/src/test-identity.ts` gives each test of one module a test identity (its Vitest workspace, Vitest project, module path, suite and test names, and its position among tests sharing those names), and marks a test whose names repeat in its module as a duplicate.

`packages/daemon` holds Vitest discovery and runs. `findVitestWorkspaces` lists a consumer's Vitest workspaces from the root `package.json` `workspaces` field and config file names (a `vitest.config.*`, or a `vite.config.*` in a directory whose `package.json` depends on Vitest), reading files only; it reports a root `pnpm-workspace.yaml` and each pattern it cannot expand as not read. It lists no directory that a `workspaces` pattern resolves outside the consumer root, through `..` or a link, deciding by canonical real path, and reports each such directory as not read with the real path it resolves to, so only the started project's own directories are loaded. When entries reached by different paths resolve to the same canonical real path, it lists only the first in pattern order, the consumer root first, and reports each later one as not read, naming the workspace listed in its place; a pattern that repeats a listed path adds nothing. So no directory is loaded or run twice. `discoverTests` loads each workspace's own Vitest, 4.1.x or 5.x, collects the modules of every project without running a test body or hook, and returns each test with its identity. It reports modules and workspaces that failed to load, workspaces with no supported Vitest, browser-mode projects, and typecheck modules, each as not discovered; it never collects a typecheck module. `runWorkspace` runs one workspace's tests on that same Vitest and records each test under the identity discovery gives it, with its outcome (passed, failed, skipped or error) and whether it finished or was interrupted as separate fields. It records modules that failed to load, hook errors on their module, crashed modules, modules not run and the run's unhandled errors apart from test outcomes, and gives a run in which no test passed or failed the reason nothing ran. The caller's `AbortSignal` interrupts a run, and a run Vitest stops itself under the consumer's `bail` is interrupted too. `discoverTests` takes an `AbortSignal` as well: once it aborts, discovery loads no further workspace, interrupts the collection in progress, and rejects with the signal's reason after the Vitest instance has closed and the host is restored, so an aborted discovery has no result. When a run or a discovery has not ended `FORCE_STOP_GRACE_MS` (10 s) after its signal aborted, Vitest force-stops its workers, which skips the project's `afterAll` hooks and teardown, and each run that loaded its workspace records whether that happened in a field beside its execution state. Work on Vitest's own thread, such as config loading or `globalSetup`, is beyond that force-stop. Discovery and runs share one queue, so none overlaps another, and each restores the host's environment and exit code. Neither writes into the consumer's tree. Each forces coverage, snapshot updates, Vitest's results cache and its module cache off over the workspace's config, so a snapshot assertion with no stored snapshot fails its test. Each also puts a setup file first in every project that keeps the project's snapshot environment, the consumer's own included, from saving or removing a snapshot file, since under update none Vitest still rewrites a snapshot file holding an entry no test checked; snapshots are still read through that environment. Each also names the config file Vitest would load and loads it through Vite's runner loader when Vite treats it as ESM, or otherwise through Vite's bundle loader, which writes nothing for a CommonJS config. Writes made by the consumer's own code (test bodies, hooks, setup files, `globalSetup`, plugins and config code) are the consumer's own. Five documented exceptions remain, all under `node_modules`: Vitest 4.1 on Vite 6.0.x, which has no runner loader, leaves an empty `node_modules/.vite-temp/`; a consumer that turns on Vite's dependency optimizer gets its cache in `node_modules/.vite/vitest`; a workspace whose project config files differ in format from its root config leaves `node_modules/.vite-temp/` for an ESM project config under a CommonJS root, and fails to load, as a failed workspace, a CommonJS project config under an ESM root; a Vitest 4.1 project config that itself sets `experimental.fsModuleCache` gets the module cache written; and Vitest 5, which creates its API token file whatever `api: false` says, writes it to `node_modules/.vitest/` when it cannot write the user data directory. Both load Vitest configs and import test files, so only the daemon calls them, after an explicit start; that start is not built yet, so neither has a production caller.

Nothing yet builds fingerprints or selects tests. `openStore` keeps runs and discoveries in a `node:sqlite` database, `store.sqlite`, in the consumer's state directory (`.rt-test` under the consumer root unless the caller names another). Each stored run (one workspace's `runWorkspace` result) and each discovery is bound to its project identity (the git repository's common directory, or the consumer root outside git), its worktree identity (the consumer root's canonical real path), an identity the store assigns, the input fingerprint its caller gives (explicitly not fingerprinted until inputs are tracked) and the Vitest adapter version, and becomes visible whole. Every read answers for one project and worktree, so worktrees can share one state directory, and the store migrates a store of the previous schema version in place, reading each of its runs as not force-stopped, since that version's code never force-stopped a run. It refuses, leaving the file unchanged, a store of any other schema version or a file that is not an RT Test store. Only the explicit start will open it, and that start is not built yet, so the store has no production caller. The sections below describe the intended architecture. Every component is TypeScript on Node ([ADR-0001](adr/0001-typescript-on-node.md)), and terms follow [the glossary](glossary.md).

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

Identify a project by its git repository's common directory, shared by every worktree checked out from it, or by its canonical root outside git; never by package name alone. Distinguish Vitest workspaces, parameterized test cases, duplicate display names, file paths, and run identities. Scope state to a worktree; two worktrees must not overwrite each other's results.

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

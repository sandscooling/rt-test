# Product plan

## Purpose

Give developers and coding agents a continuously queryable view of test results and the evidence behind them. A query should answer what passed, what failed, what is stale, what is running, and which named defects the tests have demonstrated they can detect.

The product is a separate project usable by Vitest consumers. Framework-specific behavior belongs in adapters. A Convex backend is an important compatibility case, not a requirement of the core.

## Core experience

1. A user explicitly starts RT Test for a trusted project.
2. RT Test discovers tests and establishes a baseline. Until then, results remain unknown.
3. A saved edit immediately invalidates affected evidence.
4. A scheduler debounces edit bursts and runs the smallest defensible selection.
5. Test events update a durable local store.
6. Humans and agents query that store without triggering new work.
7. After normal tests pass, lower-priority checks verify affected named defects in isolation.

State updates can be immediate; execution results arrive after tests finish. Unsaved buffers are outside the initial filesystem-watcher scope.

## Questions the product must answer

- What are the current pass/fail counts, and how many results are stale or unknown?
- What changed since a result was obtained?
- Which tests could be affected by this function or file edit, and why?
- Which functions were observed during a test run?
- Which tests detect a particular named defect?
- Which defects have current evidence, stale evidence, or no evidence?
- What prevents the project from being considered verified?
- Is the watcher healthy and caught up with the current filesystem revision?

## State and evidence

Track last outcome, freshness, execution state, and defect-verification state independently. Preserve historical failures after edits. Do not reduce all states to a single green/red flag.

Maintain three relationships:

| Relationship           | Meaning                                                     |
| ---------------------- | ----------------------------------------------------------- |
| Depends on             | A change can affect a test through an identified dependency |
| Executes               | A recorded run reached a function or module                 |
| Detects a named defect | The intended test rejected a specific behavioral mutation   |

Execution coverage is evidence of reachability in a prior run. It is not evidence that every new path is covered or every defect is detected.

## Selection strategy

Combine static imports, framework adapters, explicit external-input declarations, and observed execution. Treat dynamic or unresolved relationships conservatively. Explain broad fallbacks. Prefer file-level selection first; add function-level precision only where validated.

Watch additions, deletions, renames, test edits, snapshots, configuration, setup files, dependency lockfiles, and generated inputs as well as source files. Reconcile content fingerprints after restart or a branch change. Missing events must not preserve false freshness.

A new test must be discovered even if the old graph has no edge to it. A deleted dependency must be invalidated using the old graph as well as the new graph.

## Named defects

Each defect record connects a stable identifier, a plain-language failure, the required behavior, a test identity, a mutation specification, and evidence. Expected behavior comes from a requirement or specification.

Example: a boundary predicate accepts a value above the configured maximum. Its test exercises that boundary; its mutation changes the comparison to admit the invalid value. Verification requires the baseline to pass, the intended assertion to reject the mutation, and the restored baseline to pass.

Keep named defects authored and reviewable. Future automated suggestions may help authors, but they must not silently redefine requirements. Allow gradual adoption by existing test suites and report how much has defect evidence.

## Performance goals

The following are provisional targets for a warm local project with 10,000 discovered tests. They are not measurements or release claims.

| Operation                                       | Initial target                                      |
| ----------------------------------------------- | --------------------------------------------------- |
| Summary query from local state                  | p95 below 50 ms                                     |
| Saved edit to stale-state publication           | p95 below 100 ms after event receipt                |
| Incremental selection for an ordinary leaf edit | p95 below 100 ms                                    |
| Idle daemon CPU                                 | Below 1% averaged over one idle minute              |
| Added warm-run coordination overhead            | Below 100 ms, excluding test execution and debounce |

Record hardware, OS, runtime, graph size, baseline runner timing, and warm/cold conditions. Cold indexing and memory budgets need measurement before setting targets. Avoid full graph rebuilds and runner restarts on each edit. Bound queues and event buffers. Prioritize ordinary tests over mutation work.

## Initial scope

- Local Node-based Vitest projects with documented supported versions.
- Persistent state, explicit start/stop, a query CLI, and a local structured API.
- File-level invalidation, then validated function-level refinements.
- Named-defect metadata and isolated, incremental verification.
- Cross-platform development with Windows and Linux CI.

## Deferred scope

- Cloud hosting, collaboration accounts, billing, and a hosted dashboard.
- Automatic business-requirement inference or automatic test rewriting.
- A universal sound JavaScript call graph.
- Replacing clean CI integration/release checks.
- Browser Mode, live service orchestration, and broad framework support until their adapters are tested.
- Publishing an npm package before a consumer installation and compatibility matrix exist.

## Success criteria

An ordinary Vitest fixture can be edited, queried, selectively rerun, and restarted without falsely reporting stale evidence as current. Selected runs agree with full-run outcomes across a controlled corpus of edits. Named-defect evidence survives a restart, becomes stale on relevant changes, and never credits setup errors as detections.

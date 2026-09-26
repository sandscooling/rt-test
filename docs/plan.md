# Product plan

## Purpose

Take test execution and falsification off coding agents. Today an agent writes, runs, and falsifies every test itself, and that costs most of its time. RT Test runs the tests and the falsification instead, and answers queries: what passed, what failed, what is stale, what is running, and which named defects the tests have been shown to detect.

Correct answers matter far more than fast ones. A correct selection that never runs a test twice and answers in a couple of minutes beats a ten-minute full run; latency counts only where agents pay it on every call. Terms follow [the glossary](glossary.md).

The product is a separate project usable by any Vitest consumer. Framework-specific behavior belongs in adapters. Fleet Cooling is the proving ground, not a dependency: about 10,000 tests across five Vitest 4.1 workspaces, with a full sequential chain of about seven minutes, three of them in its Convex workspace. The Convex adapter and falsification are core value, and the milestones are ordered by what offloads agent work on Fleet Cooling soonest, while keeping every correctness guarantee.

## Core experience

1. A user explicitly starts RT Test for a trusted project.
2. RT Test discovers tests and establishes a baseline. Until then, results remain unknown.
3. A saved edit immediately invalidates affected results.
4. The daemon, the only executor, debounces edit bursts and runs the smallest defensible selection ([ADR-0002](adr/0002-daemon-sole-executor.md)).
5. Test events update a durable local store.
6. Agents and humans query that store, or wait for the results covering their own files, and never start a run. Lint and typecheck stay with agents.
7. After ordinary tests pass, lower-priority work falsifies the affected named defects in isolation.

State updates can be immediate; results arrive after tests finish. A run whose inputs change while it runs is invalidated and rerun. Unsaved buffers are outside the initial filesystem-watcher scope.

## Questions the product must answer

- What are the current pass/fail counts, and how many results are stale or unknown?
- What is the state of this file or folder, as counts per state?
- Are the results covering my files current yet, or were they superseded by a newer edit?
- What changed since a result was obtained?
- Which tests could be affected by this edit, and why?
- Which tests detect a particular named defect?
- Which defects have current evidence, stale evidence, no evidence, or a missing anchor?
- Which tests have no defect, and what prevents the project from being considered verified?
- Is the watcher healthy and caught up with the current filesystem revision?

## State and evidence

Track outcome, freshness, execution state, and defect evidence independently. Preserve historical failures after edits. Do not reduce all states to a single green/red flag.

Maintain three relationships:

| Relationship           | Meaning                                                     |
| ---------------------- | ----------------------------------------------------------- |
| Depends on             | A change can affect a test through an identified dependency |
| Executes               | A recorded run reached a function or module                 |
| Detects a named defect | The intended test rejected a specific behavioral mutation   |

Execution coverage is evidence of reachability in a prior run. It is not evidence that every new path is covered or every defect is detected.

## Selection strategy

Start at workspace granularity: an edit selects every test in its workspace and in the workspaces that depend on it, and a configuration, setup, or lockfile change is a broad fallback that names its trigger. That selection is coarse but correct, since it only widens. Refine to file granularity with static imports and framework adapters, where the Convex adapter ports Fleet Cooling's `scripts/test-blast-radius.mjs`, because every Convex test globs the whole package and `vitest related` cannot see the edges. Treat dynamic or unresolved relationships conservatively, explain broad fallbacks, and add function-level precision only where validated.

Watch additions, deletions, renames, test edits, snapshots, configuration, setup files, dependency lockfiles, and generated inputs as well as source files. Reconcile content fingerprints after restart or a branch change. Missing events must not preserve false freshness.

A new test must be discovered even if the old graph has no edge to it. A deleted dependency must be invalidated using the old graph as well as the new graph.

## Named defects

Each defect definition connects a stable identifier, a plain-language failure, the required behavior, a test identity, and a mutation; its evidence is recorded separately. Definitions are committed in the consumer repository and evidence stays local ([ADR-0004](adr/0004-defect-definitions-in-consumer.md)). Expected behavior comes from a requirement or specification.

Example: a boundary predicate accepts a value above the configured maximum. Its test exercises that boundary; its mutation changes the comparison to admit the invalid value. Verification requires the baseline to pass, the intended assertion to reject the mutation, and the restored baseline to pass.

Falsification ports Fleet Cooling's `scripts/falsify.mjs`, replacing its file writes with in-memory transforms and its message-text classifier with run facts ([ADR-0003](adr/0003-transform-falsification.md)). A defect whose mutation anchor is missing is reported as anchor missing, counts in the denominator, and blocks verified, while the other defects still run. Tests with no defect are reported as gaps. RT Test chooses no mutations and diagnoses no survivors; the author does. Existing suites adopt defects gradually, and the report says how much has evidence.

## Test suggestions

Two add-ons follow falsification, in this order:

1. **Mechanical suggestions, with no model.** From its own data, RT Test reports gaps (code no named defect covers, branches reached but never proven, tests with no defect) and proposes candidate mutations for uncovered code, checking each against the current tests first: one an existing test catches is an attribution to name, and one that survives is a test owed.
2. **Agent suggestions.** RT Test emits the gap report through its JSON CLI, the coding agent proposes defects and tests, and RT Test verifies them. RT Test calls no model and sends no source anywhere ([ADR-0005](adr/0005-no-model-calls.md)).

For both, a suggestion becomes a named defect only when the author accepts it into the defect definitions, expected behavior still comes from requirements, and no suggestion weakens an existing test.

## Targets

Correctness targets are requirements, measured at every milestone over the controlled edit corpus:

| Target              | Meaning                                                                                      | Value |
| ------------------- | -------------------------------------------------------------------------------------------- | ----- |
| Duplicate execution | A test run again while it holds a current result for the same input fingerprint (NFR1)       | 0     |
| Selection miss      | A failure a full run over the same input snapshot finds that the selected run did not (NFR2) | 0     |

The following are provisional targets for a warm local project with 10,000 discovered tests. They are not measurements or release claims.

| Operation                                                | Initial target                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Saved edit in Fleet Cooling's Convex workspace to `wait` | At most that workspace's own run at workspace granularity; well under it at file granularity |
| Summary inside the daemon                                | p95 below 50 ms                                                                              |
| End-to-end CLI call, process start included              | p95 below 100 ms                                                                             |
| Saved edit to stale-state publication                    | p95 below 100 ms after event receipt                                                         |
| Idle daemon CPU                                          | Below 1% averaged over one idle minute                                                       |

Record hardware, OS, runtime, graph size, baseline runner timing, and warm/cold conditions. Cold indexing and memory budgets need measurement before setting targets. Bound queues and event buffers. Prioritize ordinary tests over falsification.

## Initial scope

- Local Node-based Vitest projects on Vitest 4.1.x and 5.x, with several Vitest workspaces in one project.
- Persistent state, explicit start/stop, a CLI with versioned `--json` output including `status <path>` and `wait`, and a small programmatic API. No MCP server.
- Workspace-level selection, then file-level selection with the Convex adapter, then validated function-level refinements.
- Named-defect definitions and isolated, incremental falsification, then the two suggestion add-ons.
- Cross-platform development with Windows and Linux CI.

## Deferred scope

- Cloud hosting, collaboration accounts, billing, and a hosted dashboard.
- Automatic business-requirement inference or automatic test rewriting.
- A built-in model call, which needs explicit product approval.
- A universal sound JavaScript call graph.
- Replacing clean CI integration/release checks, lint, or typecheck.
- Browser Mode, live service orchestration, and broad framework support until their adapters are tested.
- A VS Code folder-view extension, which `status <path>` is shaped for.
- Publishing an npm package before a consumer installation and compatibility matrix exist.

## Success criteria

An ordinary Vitest fixture can be edited, queried, selectively rerun, and restarted without falsely reporting stale evidence as current. Selected runs agree with full-run outcomes across a controlled corpus of edits, with no duplicate execution. Named-defect evidence survives a restart, becomes stale on relevant changes, and never credits setup errors as detections. Each milestone then passes a trial on Fleet Cooling, started explicitly by the owner with RT Test's state kept outside that checkout.

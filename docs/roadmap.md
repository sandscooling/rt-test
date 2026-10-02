# Roadmap

Milestones are ordered by what takes work off coding agents on Fleet Cooling soonest, keeping every correctness guarantee. Each milestone's acceptance runs on synthetic fixtures committed in this repository. A trial on Fleet Cooling follows each one, started explicitly by the owner when that checkout is quiet, with RT Test's state directory kept outside its tree. Requirements live in [requirements.md](requirements.md); sprints live in `_agent-docs/sprints/`.

## M0: Repository foundation

Delivered in the starter:

- Product plan, architecture, testing conventions, and agent handoff.
- Strict TypeScript and Vitest development configuration.
- Result-freshness assessment with eight named-defect tests.
- Isolated bootstrap verification for those eight defects.
- Formatting, typechecking, build, and the pre-push Windows and Linux gates.
- oxlint standards ported from Fleet Cooling: file size, two-tier cognitive complexity, the comment rule with named-defect tests, test-file bans, and a dependency release-age gate.
- Fleet Cooling's workflow pipeline: tickets, sprints, requirements, ADRs, rule homes, file claims, and the orchestrator.

## M1: The daemon runs tests and answers

Sprints 1 and 2. The daemon discovers tests across every Vitest workspace on 4.1.x and 5.x, persists results locally, tracks inputs, and runs each edit's selection at workspace granularity: the edited workspace plus the workspaces that depend on it. Agents query `summary` and `status <path>` and call `wait <files>` rather than running tests. A hook the consumer installs adds the tests an agent's own edits changed to its context after each tool call, so the agent learns of a break without asking. Coarse but correct selection takes choosing and running the tests off the agent, not their time: on Fleet Cooling every workspace depends on its Convex workspace, so a Convex edit reruns all five (measured on 2026-10-02: the Convex answer 3 min 41 s after the save, everything 7 min 36 s after it), and an edit in a leaf app costs that app's whole run (1 min 50 s).

First spikes: the installed Vitest reporter and programmatic APIs on 4.1 and 5, test identity for `it.each` arms, `node:sqlite` on Node 22.13 (the raised floor), and the IPC transport on Windows and Linux.

Acceptance: run a synthetic multi-workspace project containing passing, failing, skipped, and setup-error cases; query exact counts; stop and restart, and historical results stay available but are not current until reconciliation. An edit during a run cannot restore a stale green result; new tests appear; deleted inputs cannot escape invalidation. Selected-run outcomes match full-run outcomes across the edit corpus with no duplicate execution. A status query starts no test process. Reject unsupported versions with an actionable message.

## M2: Falsification

Sprint 3. Port Fleet Cooling's `scripts/falsify.mjs` into the daemon: mutations as in-memory transforms in a separate Vitest instance ([ADR-0003](adr/0003-transform-falsification.md)), reused for each workspace's job ([ADR-0007](adr/0007-reused-instance-per-falsification-job.md)); verdicts from Vitest's recorded task facts, with canary fixtures aimed at the fact collector that also gate each Vitest version a consumer installs ([ADR-0008](adr/0008-detection-from-task-facts-and-canaries.md)); defect definitions committed in the consumer, in JSON files `rt-test.json` lists ([ADR-0004](adr/0004-defect-definitions-in-consumer.md), [ADR-0009](adr/0009-defect-definition-files.md)); attribution by stable test identity including `it.each` arms; per-defect `anchor-missing` and invalid definitions; tests with no defect reported as gaps; and affected defects re-verified after ordinary tests pass. The first spike, plugin transforms under Vitest 4.1, held on 4.1.11 (ADR-0007).

Acceptance: a weakened assertion retires earlier evidence; setup failure cannot count as a detection; a moved anchor is reported as anchor missing while the other defects run; consumer files never change; duplicate test names cannot misattribute a detection. Query verified and eligible counts. The Fleet Cooling trial needs defect definitions committed there first.

## M3: File-level results and selection

Sprint 4. Results are stored, rated and run by test module ([ADR-0010](adr/0010-results-by-test-module.md)): a run covers a list of test modules, each bound to a fingerprint of its own inputs, and a round runs the modules nearest an edit first, as a small run of their own ([ADR-0012](adr/0012-small-runs-nearest-first.md)). A dependency graph of the consumer's source files is scanned once in a daemon's life and updated for the files a save changed, and a selection is narrowed by the files each test module loaded in its last run, read beside that graph and never alone ([ADR-0011](adr/0011-load-record-beside-dependency-graph.md)). Defect evidence is bound to its test module's inputs. No Convex adapter is planned: the load record holds what a Convex test really loads through its registry, including a reference resolved by name at call time, which no static graph sees soundly; nothing specific to one consumer enters the product, and an adapter returns only for a dependency neither source sees (ADR-0011). This repository's own named defects stay with the bootstrap verifier through this milestone: its daemon and CLI tests read files and start processes by path, so their modules keep their workspace's whole inputs, and what an experiment costs when its test's module is long is not decided.

Acceptance: over the edit corpus, on Vitest 4.1 and 5, no selection miss and no duplicate execution once a run covers part of a workspace; a file few test modules load selects those modules alone, through a module registry, a barrel and a dispatch whose target is a variable; a new file selects every test module whose inputs hold a file that names it; a shared input, an unresolved reference, and a test module that reads a file by a path it builds at run time, such as `readFileSync(path.join(import.meta.dirname, ...))`, select as at workspace granularity; a Vitest install whose record canaries do not read as named narrows nothing by the record, and every answer says so; an interrupted round keeps the runs it stored; falsification re-verifies only the defects an edit can reach. Measure, against plain Vitest on the same test modules, the time from a save to a run starting, to the nearest modules' results and to every selected result.

## M4: Mechanical suggestions

Report gaps from RT Test's own data (code no named defect covers, branches reached but never proven, tests with no defect) and propose candidate mutations for uncovered code, checked against the current tests before they are suggested. No model is involved.

Acceptance: a suggestion an existing test catches is reported as an attribution to name, and one that survives as a test owed; a suggestion becomes a named defect only when the author accepts it into the definitions, and none weakens an existing test.

## M5: Agent suggestions

Emit the gap report through the JSON CLI so the coding agent can propose defects and tests, and verify each proposal. RT Test calls no model and sends no source anywhere ([ADR-0005](adr/0005-no-model-calls.md)).

Acceptance: an agent's proposed defect is verified against the current tests like any other, and acceptance still requires the author.

## M6: Precision and public consumer release

Add validated function-level refinements and optional observed per-test execution edges; measure instrumentation overhead and document unsupported cases. Package a consumer CLI and programmatic API, validate fresh installation in npm, pnpm, and Bun projects, document compatibility, and add agent-facing query examples. Benchmark Windows, Linux, and macOS. Add clean CI comparison and release checks. When a release gives `packages/daemon/package.json` a `files` member, it lists `canaries`: a canary reading reads the bundled set from the package, and without it every reading is no reading.

Acceptance: a user can install into a supported project, explicitly start it, query current evidence, stop it, and uninstall without modifying their tests or leaving a process running. Remove `private: true` and publish only after explicit release authorization.

## Open decisions

- Runtime support beyond the Node release lines in `package.json`.
- Handling Vitest advanced API changes between 4.1 and 5.
- Durable test identity across renames.
- State schema migrations and recovery from partial writes.
- Declared external inputs and handling nondeterministic/live-service tests.
- Performance budgets for cold indexing, memory, and function-level instrumentation.
- The time left between a save and a run starting once a save re-reads only the changed files, and a Vitest instance kept open between runs.

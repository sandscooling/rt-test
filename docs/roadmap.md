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

Sprints 1 and 2. The daemon discovers tests across every Vitest workspace on 4.1.x and 5.x, persists results locally, tracks inputs, and runs each edit's selection at workspace granularity: the edited workspace plus the workspaces that depend on it. Agents query `summary` and `status <path>` and call `wait <files>` rather than running tests. A hook the consumer installs adds the tests an agent's own edits changed to its context after each tool call, so the agent learns of a break without asking. Coarse but correct selection already offloads test runs: a Convex edit on Fleet Cooling costs about its three-minute workspace run rather than the seven-minute chain.

First spikes: the installed Vitest reporter and programmatic APIs on 4.1 and 5, test identity for `it.each` arms, `node:sqlite` on Node 22.13 (the raised floor), and the IPC transport on Windows and Linux.

Acceptance: run a synthetic multi-workspace project containing passing, failing, skipped, and setup-error cases; query exact counts; stop and restart, and historical results stay available but are not current until reconciliation. An edit during a run cannot restore a stale green result; new tests appear; deleted inputs cannot escape invalidation. Selected-run outcomes match full-run outcomes across the edit corpus with no duplicate execution. A status query starts no test process. Reject unsupported versions with an actionable message.

## M2: Falsification

Sprint 3. Port Fleet Cooling's `scripts/falsify.mjs` into the daemon: mutations as in-memory transforms in a separate Vitest instance ([ADR-0003](adr/0003-transform-falsification.md)), reused for each workspace's job ([ADR-0007](adr/0007-reused-instance-per-falsification-job.md)); verdicts from Vitest's recorded task facts, with canary fixtures aimed at the fact collector that also gate each Vitest version a consumer installs ([ADR-0008](adr/0008-detection-from-task-facts-and-canaries.md)); defect definitions committed in the consumer, in JSON files `rt-test.json` lists ([ADR-0004](adr/0004-defect-definitions-in-consumer.md), [ADR-0009](adr/0009-defect-definition-files.md)); attribution by stable test identity including `it.each` arms; per-defect `anchor-missing` and invalid definitions; tests with no defect reported as gaps; and affected defects re-verified after ordinary tests pass. The first spike, plugin transforms under Vitest 4.1, held on 4.1.11 (ADR-0007).

Acceptance: a weakened assertion retires earlier evidence; setup failure cannot count as a detection; a moved anchor is reported as anchor missing while the other defects run; consumer files never change; duplicate test names cannot misattribute a detection. Query verified and eligible counts. The Fleet Cooling trial needs defect definitions committed there first.

## M3: File-level selection and the Convex adapter

Compute reverse module dependencies for file-level selection. Introduce the adapter contract, and port Fleet Cooling's `scripts/test-blast-radius.mjs` as the Convex adapter over a synthetic Convex fixture covering function references, dynamic dispatch, schema changes, and module registry behavior.

Acceptance: precision reduces work without losing failures in the edit corpus; unresolved references widen selection; a test module that reads a file by a path it builds at run time, such as `readFileSync(path.join(import.meta.dirname, ...))`, widens to its whole workspace; falsification re-verifies only the defects an edit can affect. Measure selection latency and warm feedback time against native Vitest.

## M4: Mechanical suggestions

Report gaps from RT Test's own data (code no named defect covers, branches reached but never proven, tests with no defect) and propose candidate mutations for uncovered code, checked against the current tests before they are suggested. No model is involved.

Acceptance: a suggestion an existing test catches is reported as an attribution to name, and one that survives as a test owed; a suggestion becomes a named defect only when the author accepts it into the definitions, and none weakens an existing test.

## M5: Agent suggestions

Emit the gap report through the JSON CLI so the coding agent can propose defects and tests, and verify each proposal. RT Test calls no model and sends no source anywhere ([ADR-0005](adr/0005-no-model-calls.md)).

Acceptance: an agent's proposed defect is verified against the current tests like any other, and acceptance still requires the author.

## M6: Precision and public consumer release

Add validated function-level refinements and optional observed per-test execution edges; measure instrumentation overhead and document unsupported cases. Package a consumer CLI and programmatic API, validate fresh installation in npm, pnpm, and Bun projects, document compatibility, and add agent-facing query examples. Benchmark Windows, Linux, and macOS. Add clean CI comparison and release checks.

Acceptance: a user can install into a supported project, explicitly start it, query current evidence, stop it, and uninstall without modifying their tests or leaving a process running. Remove `private: true` and publish only after explicit release authorization.

## Open decisions

- Runtime support beyond the Node release lines in `package.json`.
- Handling Vitest advanced API changes between 4.1 and 5.
- Durable test identity across renames.
- State schema migrations, retention, and recovery from partial writes.
- Declared external inputs and handling nondeterministic/live-service tests.
- Performance budgets for cold indexing, memory, and function-level instrumentation.

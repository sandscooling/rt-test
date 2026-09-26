# Ticket 1.4: Query CLI

## Ticket

As a coding agent or user working in a consumer whose RT Test daemon is running,
I want `rt-test summary` and `rt-test status <path>` to tell me, as counts per state and per freshness with versioned `--json` output, what the daemon's stored runs say about the whole worktree or one file or folder, including everything that was not discovered or not run,
so that I read results instead of running tests myself (FR5), never mistake a partial, stale or unknown set for a pass, and never start a test by asking.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: `rt-test summary [root]` answers for the worktree at `root`, the current directory by default, from the daemon serving that worktree. It gives the number of tests in the worktree's latest stored discovery and, for each state, how many of them are in it. Every discovered test is in exactly one state, so the state counts add up to that number. A test's state comes only from the latest stored run of its workspace: passed, failed, skipped or error when the test finished in that run; interrupted when the run left it unfinished; its module not run, crashed, or failed to load in that run; that run failed to load the workspace, found no supported Vitest, or was interrupted before loading it; not in that run, when the run loaded the workspace but does not hold the test, whether or not it holds the test's module; and never run, when no run of its workspace is stored. No state is folded into another, and an older run never answers for a test its workspace's latest run does not hold.
- [ ] AC2: Every answer gives, beside the state counts and never inside them, how many of the same tests are current, stale and unknown. A test with no finished result is unknown, whatever its run's adapter version. A finished result from a run stored under a Vitest adapter version other than the daemon's current one keeps its outcome and is stale, counted apart from unknown, whether or not it was fingerprinted. A finished result of the current adapter version stored not fingerprinted is never current: its freshness is unknown. When the latest discovery was stored under another adapter version, it still gives the tests counted, and the answer says it is not current.
- [ ] AC3: The summary lists everything not discovered, each with its reason and never as a test state: each workspace whose discovery found no supported Vitest, failed, or was not confirmed at start; each module that failed to load during discovery; each typecheck module and each unsupported project; and each workspace source that was not read, including one outside the consumer root and a duplicate. It gives the number of discovered tests marked duplicate. For each workspace it gives its latest stored run's status, adapter version and whether that version is current, and for a run that loaded the workspace, whether it completed or was interrupted, whether Vitest was force-stopped, the reason nothing ran when there is one, and how many unhandled errors and module errors it recorded.
- [ ] AC4: Every answer carries the daemon's activity (discovering, running a named workspace, or idle) and each job it reports as ended with nothing stored, with its reason.
- [ ] AC5: `rt-test status <path> [--root <dir>]` resolves `path` against the current directory and answers for the discovered tests whose module file is that file or lies under that folder, with the state and freshness counts of AC1 and AC2. For a folder, it also gives one entry per test file under it with that file's own counts. It lists, with its reason, each entry of AC3's not-discovered list whose workspace, module or source path is the path or lies under it. `--root` defaults to the current directory, as `summary`'s root does, and neither command looks for a root in a parent directory.
- [ ] AC6: No answer, human or `--json`, gives a set of tests a single pass or fail verdict: a worktree, folder or file is described only by its counts, so a set holding any test that is not a current pass never reads as passing.
- [ ] AC7: A query that has nothing to answer exits 1 with a reason and prints no success-shaped result: when no daemon serves the root (the reason names the root and says to run `rt-test start`); when the daemon serving the root predates these queries (the reason says to stop it and start it again); when the daemon has stored no discovery for the worktree (the reason names the daemon's activity); when `status`'s path lies outside the root; and when neither a discovered test nor an entry of AC3's not-discovered list lies at or under `status`'s path. An answer that lists at least one test or one not-discovered entry exits 0, whatever the tests' states.
- [ ] AC8: `summary` and `status` never start a daemon, a discovery or a run, and a query sent while the daemon is running a workspace neither interrupts that run nor changes which jobs run after it. Neither command loads a Vitest module, a consumer config, a test file or `node:sqlite` in the CLI's own process, and neither opens the store there.
- [ ] AC9: An answer counts each stored run and discovery wholly or not at all: a run the daemon stores while the query is answered is either in every count of that answer or in none. An answer counts only the queried worktree's records, never another worktree's that shares the state directory.
- [ ] AC10: With `--json`, stdout carries exactly one JSON document per invocation, whatever the outcome, except a usage error, which writes nothing to stdout. The document carries the CLI's `schemaVersion` and the command, and on a failure the reason, which is also written to stderr. Warnings go to stderr. Without `--json`, an answer goes to stdout and a failure's reason to stderr. A missing `path`, an unknown option, a missing option value and an extra argument each exit 2 with the usage on stderr.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It reads 1.2's store through `node:sqlite` as the store already does, and uses `node:path` and `node:fs` as `find-workspaces.ts` does.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (AC1) In `packages/core/src/test-identity.ts`, add and export one key for a whole `TestIdentity` (workspace path, project name, module path, name path, occurrence), built the way `namePathKey` keeps name paths apart, and export it from `packages/core/src/index.ts`. The query matches a discovered test to a run's test by this key alone (C8, C14).
- [ ] (AC1, AC9) In `packages/daemon/src/store/read-runs.ts`, add a read of the latest stored run of each workspace path for one scope, choosing the latest by the store's `sequence`, never by row order (C29). Add a store read, exposed on `RtTestStore` in `open-store.ts`, that returns the worktree's latest discovery and those runs from one read transaction (C150), reusing `readLatestDiscovery`'s and `readRuns`'s row readers rather than a second decoding of any column (C8, C9). It reads only the given scope (C123).
- [ ] (AC1, AC2, AC3) Create `packages/daemon/src/query/test-states.ts`: given the latest discovery, the latest run of each workspace and the current `VITEST_ADAPTER_VERSION`, give each discovered test of each `discovered` workspace its one state (AC1) and its freshness (AC2). Freshness comes from `@rt-test/core`'s `assessEvidence`, passing the stored fingerprint's digest, or no fingerprint for `NOT_FINGERPRINTED`, and no current fingerprint, since none exists before ticket 2.1 (C113, C114). A test with no finished result is unknown. A finished result from a run of another adapter version is stale before `assessEvidence` is asked, in one function, so freshness has one answer (C8, C124). Name each state as a constant (C3).
- [ ] (AC1, AC2, AC3, AC4, AC6) Create `packages/daemon/src/query/summary.ts`: the summary of AC1 to AC4 from `test-states.ts`, the discovery's not-discovered entries and `notRead` sources, each workspace's latest-run facts, and the activity and nothing-stored jobs the daemon's status already tracks. Counts only: no field is a verdict for a set (AC6, C133).
- [ ] (AC2, AC4, AC5, AC6, AC7) Create `packages/daemon/src/query/path-status.ts`: given the absolute path the client sent, decide it against the daemon's consumer root by canonical real path where the path exists, and where it does not (a deleted file) by the canonical real path of its nearest existing ancestor joined with the remaining segments, refusing a path outside the root. Match it against each test's root-relative module file (the workspace path joined with the module path, normalized, `/`-separated, P13) and each entry of AC3's not-discovered list by its workspace, module or source path, and answer AC5's counts and per-file entries, with AC2's note when the latest discovery is of another adapter version and AC4's activity and nothing-stored jobs, or AC7's reason when nothing lies at or under it.
- [ ] (AC4, AC7, AC8, AC9) In 1.3's protocol module (`packages/daemon/src/daemon/protocol.ts` as it lands), add a summary request and a status request carrying an absolute path, their responses, and a nothing-to-answer error response carrying the reason. Keep the protocol version: the requests are additive, and a daemon from before this ticket answers them with 1.3 AC8's unknown-request error while `start` and `stop` keep working (orchestrator, 18:09). In 1.3's server and lifecycle, answer both from the daemon's open store and its tracked activity. A query only reads: it queues no job and changes no activity (AC8). When no discovery is stored, answer the error naming the activity (AC7).
- [ ] (AC7, AC8) In 1.3's client (`packages/daemon/src/client.ts`), add a summary query and a status query for a consumer root, rejecting with a reason naming the root when no daemon answers, as `daemonStatus` does, with the daemon's reason on its nothing-to-answer error, and, on the daemon's unknown-request error for the query, with "the daemon serving <root> predates this query; stop it and start it again" (AC7). They send and receive only; the client's module graph still loads neither `node:sqlite` nor Vitest (1.3's client task).
- [ ] (AC1 to AC10) Create `packages/cli/src/commands/summary.ts` and `packages/cli/src/commands/status.ts`, and add both to 1.3c's command table in `packages/cli/src/main.ts`. `summary` takes an optional `root` positional; `status` takes a required `path` positional and `--root <dir>`; both take `--json`. Resolve `root` and `path` to absolute paths against `io`'s current directory, never `process.cwd()` (1.3c's start task), and send only absolute paths to the client. Write through 1.3c's `output.ts` writer and `CLI_JSON_SCHEMA_VERSION`, unchanged at 1, with 1.3c's exit-code constants. Neither command reads the state directory or takes `--state-dir`: the daemon holds the store. The human rendering prints each set's counts only, with no pass, fail or success line for a worktree, folder or file (AC6).
- [ ] (Support) Send the orchestrator the README text for `rt-test summary` and `rt-test status` (arguments, `--root`, `--json`, the states and freshness values, the exit codes, and that a query needs a running daemon; C7), the `docs/architecture.md` § Current implementation sentences for the query path, and FR5's marker (`[Ticket 1.4]`).
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `@rt-test/core` `assessEvidence(evidence, currentFingerprint)`: outcome and freshness, with a missing or empty fingerprint giving unknown. `TestIdentity`, `IdentifiedTest` and `TestOutcome`.
- 1.2's store: `readLatestDiscovery` and `selectDiscovery` in `read-discovery.ts`, `readRuns`, `selectRun` and their row readers in `read-runs.ts`, `inReadTransaction` in `transaction.ts`, `requireScope` and `fingerprintFromColumns` in `stored-records.ts`, `NOT_FINGERPRINTED` and `FINGERPRINT_DIGEST` in `schema.ts`.
- `packages/daemon/src/vitest/adapter-version.ts` `VITEST_ADAPTER_VERSION`, the one current adapter version. 1.3b raises it to 2 and 1.3's AC11 raises it again, so read it, never a literal.
- The record types: `WorkspaceDiscovery` and `TestDiscovery` (`discover-tests.ts`, with 1.3's not-confirmed status), `WorkspaceRun` (`run-workspace.ts`, with 1.3b's `forceStopped`), `RecordedModule`, `RecordedTest`, `TestRunState` and `NothingRanReason` (`run-states.ts`), `FailedModule` and `ModuleReport` (`module-tests.ts`), `UnreadWorkspaceSource` (`find-workspaces.ts`). Derive the query's shapes from these (C14).
- `packages/daemon/src/vitest/find-workspaces.ts` `relativePosixPath` for `/`-separated relative paths, and 1.3b's canonical-real-path decision of whether a directory lies inside the consumer root (`realPath` and `outsideRootReason`, module-private there). Export and extend what `path-status.ts` needs, such as the nearest-existing-ancestor case, rather than a second inside-the-root rule (C5, C8).
- Ticket 1.3's protocol, server, lifecycle and client (unbuilt): the line-framed request and response shapes, the hello, the error response, the activity and nothing-stored job list its status tracks, and `daemonStatus`'s no-daemon rejection. Use the names that land.
- Ticket 1.3c's CLI (unbuilt): `main(argv, io)`, its command table, `output.ts`'s writer, `CLI_JSON_SCHEMA_VERSION` and the exit-code constants, and the usage handling for `ERR_PARSE_ARGS_*` and extra positionals. Use the names that land.
- `packages/daemon/src/vitest/error-text.ts` `errorText` for a rejection's reason.
- For create-tests: `packages/daemon/test/harness.ts` (`inTempDir`, `copyFixture`, `linkVitest`), the `test/fixtures/daemon/run` and `consumer` fixtures, `store.test.ts`'s store helpers, and whatever 1.3's and 1.3c's tests use to start a real daemon and drive `main`.

### Must Create

- The query modules: `rg -n "summary|pathStatus|querySummary" packages --glob '!**/node_modules/**'` finds only a local helper in `force-stop.test.ts`.
- The test-identity key: `namePathKey` in `test-identity.ts` keys a name path only and is private.
- The latest-run-per-workspace read: `readRuns` returns every run of the scope with all its tests, which grows with every start.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The build order is 1.3b (landing), then 1.3 (the daemon and its client), then 1.3c (`packages/cli` with `start` and `stop`), then this ticket. It is written against the tree as it will be once those three land. It adds `summary` and `status <path>` to 1.3c's CLI, and answers them inside 1.3's daemon from 1.2's store.

Requirements this ticket delivers (`docs/requirements.md`):

- FR5: "Answer summary and `status <path>` queries through a CLI with versioned `--json` output, reporting counts per state for files and folders, without starting a test." (AC1 to AC10)

Clauses the criteria rest on:

- The sprint file's 1.4 section: "This ticket counts from ticket 1.2's store: stored runs, and the worktree's latest discovery for never-run and unknown tests (C132). The store keeps an explicit not-fingerprinted value, which this ticket's queries map to an absent fingerprint before `assessEvidence`. A stored run or discovery whose adapter version differs from the daemon's current Vitest adapter version is reported as not current, since it was recorded under another meaning (C124)." (AC1, AC2)
- C124: "Results produced by an older adapter or runner version are not reported current under a newer one." C113: "A missing, empty or unreadable fingerprint yields unknown, never current." C114: "Freshness is derived at query time from current inputs". (AC2)
- C119: "Outcome, freshness, execution state, defect evidence and evidence freshness are separate fields; no value encodes two of them". (AC1, AC2)
- C131: "Collection errors, crashes, timeouts, interruptions, skips and unknown tests each keep their own state; none is coerced to passed or folded into a generic failed." C132: "A known test absent from a run's report is recorded as unknown or not run, never passed." (AC1, AC3)
- C133: "Any non-passing or unknown member keeps a path, folder or project summary from reading as passed." P34: "`status <path>` answers for files and folders with counts per state, never a single pass or fail, so an editor folder view can show mixed states." (AC5, AC6)
- C153: "A CLI command that could not answer exits non-zero with a reason; it never prints an empty success-shaped result." C130: "A selection or run that executed no tests reports that nothing ran and why, never success." (AC7)
- ADR-0002: "The CLI and the programmatic API query results, or wait for the results covering given files, and never spawn Vitest." `docs/architecture.md` § Query surface: "Read operations never trigger execution." (AC8)
- C150: "A read that decides from several values of shared state (a record's rows, a file header) takes them from one snapshot: one statement or one read transaction." C123: "A query joins on project identity and worktree, so results from another project or checkout never answer it." (AC9)
- C151: "Every `--json` payload carries a schema version, and a breaking field change bumps it." C152: "`--json` output goes to stdout alone; diagnostics and warnings go to stderr." (AC10)
- `docs/architecture.md` § State dimensions: "Include discovered, selected, executed, skipped, stale, and unknown denominators in summaries." Selection arrives in ticket 2.2, so this ticket has no selected denominator. (AC1, AC2)
- Glossary: **Outcome** "What a test did in its last run: passed, failed, skipped, error, or never run." **Freshness** "Whether a result still describes its test's current inputs." **Current pass** "A passed outcome whose freshness is current." **Result** "A test's outcome bound to the run and input fingerprint that produced it." **Worktree** "One checked-out consumer root, to which results are scoped".

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 1.4` over `packages/cli`, `main.ts`, `output.ts`, `packages/daemon/src/client.ts`, `packages/daemon/src/daemon`, `read-runs.ts`, `open-store.ts`, `packages/daemon/src/query`, `packages/daemon/package.json`, `packages/core/src/test-identity.ts`, `packages/core/src/index.ts`, `README.md` and `docs/architecture.md` named tickets 1.3 and 1.3c (ready-for-dev), 1.3b (review), and ticket 2.3 and the Sprint 2 preamble (backlog). Ticket 2.2's hit on the core files is its Execution Metadata comment naming `packages/core`, not a file it writes.

- **1.3** creates the protocol, server, lifecycle and client files this ticket edits. This ticket edits them after 1.3 lands, which is sequential work, not a collision (orchestrator, 18:03). 1.3 AC4's status already reports the activity and each job ended with nothing stored, which AC4 carries. 1.3 AC11 adds the discovery status for a workspace not confirmed at start, which AC3 lists.
- **1.3b** raises `VITEST_ADAPTER_VERSION` to 2, so every 1.2-era record reads as another adapter version (AC2), and adds `forceStopped` to a stored `ran` run (AC3). It adds the `notRead` reasons for a workspace outside the root and for a duplicate (AC3). It writes `read-runs.ts` and `open-store.ts` before this ticket, sequentially.
- **1.3c** creates `packages/cli`, `main.ts`'s command table, `output.ts`'s writer and `CLI_JSON_SCHEMA_VERSION`. This ticket adds two entries and two command modules after it lands, and changes neither `output.ts` nor the schema version.
- **2.1** (backlog) adds input fingerprints. Until then no current fingerprint exists, so every result's freshness is unknown or stale, never current. 2.1 supplies the current fingerprint `test-states.ts` passes to `assessEvidence`.
- **2.3** (backlog) replaces the start sequence with scheduled selections, and **2.4** adds `wait`. Neither changes what a stored run means here.

#### Owner rulings and grill record

The questions went to the orchestrator at about 17:59 on 2026-09-26 (crew.md § Questions). It answered at 18:03:

- Q1 Route, owner ruling at 18:03, asked in plain terms by the orchestrator. Queries go through the running daemon. Results are readable only while RT Test runs; when it is stopped, a query exits 1 saying no daemon serves the root and how to start it. The CLI never opens the store (AC7, AC8).
- Q2 Root, orchestrator at 18:03. `summary [root]` defaults to the current directory with no walk up to a parent. `status <path> [--root <dir>]` resolves the path against the current directory, and a path outside the root exits 1 with a reason. One root rule for every command (AC1, AC5, AC7).
- Q3 Which result answers a test, orchestrator at 18:03. The latest discovery is the denominator. Each test is answered only by its workspace's latest stored run. "Not in latest run" is its own state, with no fallback to an older run. A workspace with no stored run gives "never run". Tests present only in runs are not counted (AC1).
- Q4 Adapter version, orchestrator at 18:03. A result from a run of another adapter version keeps its outcome and is stale, distinct from unknown. A discovery of another adapter version still serves as the denominator, marked not current (AC2).
- Q5 Folder answers, orchestrator at 18:03. `status <folder>` includes one entry per test file under it with that file's counts (AC5).
- Q6 Nothing to answer, orchestrator at 18:03. Exit 1 with a reason when there is no daemon, no stored discovery, or nothing at or under the path. An answer listing at least one test or not-discovered entry exits 0: the exit code says the query answered, not that tests pass (AC7).
- Sizing, orchestrator at 18:04: proceed as-is, with no split, at about 22 raw files, 29 estimated, and 11 code units (§ Sizing).
- FYIs confirmed by the orchestrator at 18:03: the answer carries the daemon's activity (AC4); 1.3's protocol version is raised (reversed at 18:09, next entry); the CLI's `schemaVersion` stays 1.
- Protocol version, reversed by the orchestrator at 18:09 on the ticket review's finding. Raising the version would make a daemon started before this ticket fail every command's hello, `stop` included, stranding it. So the version is kept: the requests are additive (C151 does not apply), and an older daemon's unknown-request error exits 1 with "the daemon serving <root> predates this query; stop it and start it again" (AC7). The orchestrator is separately having ticket 1.3 make `stop` work across protocol versions.

Ticket review (create-ticket Step 6c, 18:07), 14 findings. Applied: the status task carries AC2's note and AC4's activity; the human rendering prints counts only; AC2's freshness order (another adapter version before not fingerprinted, and no finished result always unknown); AC5 and AC7 cover the whole not-discovered list; a deleted path is decided through its nearest existing ancestor; reuse of 1.3b's inside-the-root decision; the test-file list; the widened sibling scan; a narrowed completeness claim; the 1.3-era `RtTestStore` stand-in risk. Taken to the orchestrator: the protocol version (above). Answered from the record: timeouts, 1.1b's accepted C131 deviation (§ Design notes). Rejected: the empty Execution Metadata, which was filled after the review began; `sizing_ac_count` stays 11, the criteria plus validation.

#### Design notes

- **Where the counting runs.** Inside the daemon, which already holds the store open and knows its consumer root and activity. The CLI resolves paths and sends requests; it computes nothing (Q1, P32). `docs/plan.md` targets "Summary inside the daemon" at p95 below 50 ms, which is a target, not measured here.
- **States.** One state per discovered test, from its workspace's latest stored run, in this order of reach: the run's own status (`failed`, `unsupported`, `interrupted-before-load`); for a `ran` run, the test's module state (`failed`, `crashed`, `not-run`); for a `ran` module, the test's `TestRunState` (`finished` with its outcome, or `interrupted`); a `ran` run that does not hold the test, whether its module is absent or a `ran` module lacks it (a test added after that run), gives "not in latest run"; no run gives "never run". The JSON key names are dev's within AC1, each a named constant.
- **Freshness.** Asked per test from the run that answered it. A run of the current adapter version goes to `assessEvidence` with its digest, or with no fingerprint for `NOT_FINGERPRINTED`, and no current fingerprint. A test with no finished result has unknown freshness, whatever its run's adapter version. A finished result from a run of another adapter version is stale before `assessEvidence` is asked. So every Sprint 1 answer has zero current, which is honest: the sprint objective says "every result's freshness is honestly unknown".
- **Paths.** A test's file is its workspace path joined with its module path. The module path is relative to the workspace's real directory (`moduleLocator` in `module-tests.ts`), so normalize the join, since a module outside its workspace's directory gives a `..` segment. The daemon decides whether the requested path lies inside its root, since it holds the canonical root (1.2's worktree identity is the root's canonical real path).
- **Snapshot.** The discovery and the latest runs are read in one read transaction (C150). The daemon writes and answers on one thread, but the rule asks for one snapshot, and a second daemon of another worktree writes the same file.
- **Protocol version.** Unchanged. The two requests are additive, so C151's bump on a breaking change does not apply. A daemon started before this ticket answers either request with 1.3 AC8's unknown-request error and keeps serving, so `stop` and `start` still work across the upgrade, and the client turns that error into AC7's "predates this query" reason (orchestrator, 18:09).
- **Timeouts.** A timed-out test is stored as failed with its error text, so it counts as failed. That is ticket 1.1b's recorded C131 deviation, accepted by the owner: "A timeout stays failed. A distinct timeout state is deferred to M2 falsification, which classifies timeouts" (1.1b § State mapping). This ticket reads what the store holds and adds no timeout state.
- **Unanalyzed.** Case-insensitive path matching on Windows (a path typed in another case than the stored module path). A test file whose module path contains a `..` beyond the consumer root. Query latency against plan.md's targets, which M1's benchmarks measure.

#### Sizing

About 22 raw files, 29 estimated, and 11 code units (10 criteria plus validation). Production: 9 files to modify (`test-identity.ts`, core `index.ts`, `read-runs.ts`, `open-store.ts`, and 1.3's protocol, server, lifecycle and client, and 1.3c's `main.ts`) and 5 to create (three query modules and two command modules). Tests: core's test-identity test and its `defects.json`, `store.test.ts`, a new daemon query test, the daemon `defects.json`, 1.3's daemon test, 1.3's client test where it is a separate file, 1.3c's CLI test and its `defects.json`: 8 or 9 files, which the totals take as 8. No new fixture is expected. The work splits into three disjoint groups: the query model (core key, store read, query modules), the transport (protocol, server, lifecycle, client), and the CLI commands. The orchestrator ruled to proceed with no split at 18:04: a 1.4b split at the CLI would still leave 1.4 at the limit. Implementation is delegated to implementer agents, since the estimate is over 10.

#### Current structure of the modified files

- `packages/core/src/test-identity.ts`: `TestIdentity` `{ workspacePath, projectName, modulePath, namePath, occurrence }`, `IdentifiedTest` `{ identity, isDuplicate }`, `identifyModuleTests`, and the private `namePathKey`, which is `JSON.stringify(namePath)` so `["a b", "c"]` and `["a", "b c"]` stay apart.
- `packages/daemon/src/store/read-runs.ts` (after 1.3b): `readRuns(database, scope)` reads every run of the scope with its modules and tests in one `inReadTransaction`; `readRun` and `selectRun` read one run by id; `storedRun`, `workspaceRun` and `ranRun` rebuild a `StoredRun`, `ranRun` reading `forceStopped`.
- `packages/daemon/src/store/read-discovery.ts`: `readLatestDiscovery(database, scope)` reads the discovery of the highest `sequence` in one read transaction; `selectDiscovery` reads one inside the caller's transaction. After 1.3 it also reads the not-confirmed status.
- `packages/daemon/src/store/open-store.ts`: `RtTestStore` `{ file, writeRun, writeDiscovery, readRuns, readRun, readLatestDiscovery, close }`, built by `storeHandle`.
- 1.3's `protocol.ts`, `server.ts`, `lifecycle.ts` and `client.ts`, and 1.3c's `main.ts`: created by those tickets. Read each as landed before editing.

#### Existing tests this change breaks

None expected from the store: `store.test.ts` uses `openStore`'s real handle, never a hand-built `RtTestStore` (`rg -n "RtTestStore" packages/*/test test --glob '*.ts'` hits only `store.test.ts`'s helper signatures). Unanalyzed: 1.3's daemon tests, which may build a stand-in `RtTestStore` without the new read, since the grep ran before 1.3 lands; 1.3's protocol tests, which may use as their unknown request a name this ticket defines; 1.3c's usage tests, which may treat `summary` or `status` as an unknown command. create-tests runs the suite. For create-tests: AC8's "no `node:sqlite` in the CLI's own process" is observable only in a child process running the CLI entry, as 1.3c's AC9 test does.

#### Previous ticket

1.3c (ready-for-dev, the nearest earlier key): `main(argv, io)` takes the streams and the current directory and returns the exit code; each command is one module under `src/commands/` and one table entry, with options parsed per command in strict mode; `output.ts` holds `CLI_JSON_SCHEMA_VERSION` (1), the exit codes (0, 1, 2) and the one writer. Every document carries `schemaVersion`, `command` and `ok`, and a failure adds `reason`. 1.3 (ready-for-dev): the daemon holds 1.2's store open, tracks its activity and each job ended with nothing stored, answers status within a named bound while Vitest is busy, and its client rejects with a reason naming the root when no daemon answers. 1.3b (review): adapter version 2, `forceStopped` on `ran` runs, and `notRead` entries for workspaces outside the root and duplicates. 1.2 (done): every read answers for one project and worktree.

### References

- `docs/plan.md`: "What are the current pass/fail counts, and how many results are stale or unknown?" and "What is the state of this file or folder, as counts per state?"; the target "Summary inside the daemon: p95 below 50 ms".
- `docs/roadmap.md` § M1 acceptance: "query exact counts; stop and restart, and historical results stay available but are not current until reconciliation ... A status query starts no test process."
- `docs/architecture.md` § Components: "Query service: Serve consistent snapshots and waits without running tests".
- Tickets 1.3 (`_agent-docs/tickets/1-3-daemon-lifecycle.md`), 1.3b (`1-3b-run-safety.md`) and 1.3c (`1-3c-start-stop-cli.md`).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete`.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C7,C8,C9,C14,C29,C30,C38,C48,C52,C59,C113,C114,C119,C123,C124,C125,C130,C131,C132,C133,C134,C140,C150,C151,C152,C153 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P1,P13,P16,P17,P18,P19,P20,P21,P32,P33,P34,P42 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area: packages/core, packages/daemon, packages/cli
is_consolidation: false
sizing_ac_count: 11
files_to_modify:
  - packages/core/src/test-identity.ts
  - packages/core/src/index.ts
  - packages/daemon/src/store/read-runs.ts
  - packages/daemon/src/store/open-store.ts
  - packages/daemon/src/daemon/protocol.ts
  - packages/daemon/src/daemon/server.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/client.ts
  - packages/cli/src/main.ts
files_to_create:
  - packages/daemon/src/query/test-states.ts
  - packages/daemon/src/query/summary.ts
  - packages/daemon/src/query/path-status.ts
  - packages/cli/src/commands/summary.ts
  - packages/cli/src/commands/status.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId {{dev_thread_id}}

#### Test Files This Change Broke

None.

#### ACs Owed a Test

None.

#### Tests Owed

None.

### Tests Record

Tests session: threadId {{tests_thread_id}}

#### Named Defects

None.

#### Deliberately Untested

None.

### Review Record

#### Test Coverage Gaps

None.

### Completion Notes

### File List

Planning files the create-ticket run wrote:

- `_agent-docs/tickets/1-4-query-cli.md` (created)
- Held for the orchestrator, as exact text: `_agent-docs/sprint-status.yaml` (1.4 to `ready-for-dev`), the sprint file's 1.4 section (the ticket-file link), and FR5's marker in `docs/requirements.md` (`[Sprint 1]` to `[Ticket 1.4]`). The `README.md` and `docs/architecture.md` text follows from dev-ticket's Support task.

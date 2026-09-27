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

- [x] AC1: `rt-test summary [root]` answers for the worktree at `root`, the current directory by default, from the daemon serving that worktree. It gives the number of tests in the worktree's latest stored discovery and, for each state, how many of them are in it. Every discovered test is in exactly one state, so the state counts add up to that number. A test's state comes only from the latest stored run of its workspace: passed, failed, skipped or error when the test finished in that run; interrupted when the run left it unfinished; its module not run, crashed, or failed to load in that run; that run failed to load the workspace, found no supported Vitest, or was interrupted before loading it; not in that run, when the run loaded the workspace but does not hold the test, whether or not it holds the test's module; and never run, when no run of its workspace is stored. No state is folded into another, and an older run never answers for a test its workspace's latest run does not hold.
- [x] AC2: Every answer gives, beside the state counts and never inside them, how many of the same tests are current, stale and unknown. A test with no finished result is unknown, whatever its run's adapter version. A finished result from a run stored under a Vitest adapter version other than the daemon's current one keeps its outcome and is stale, counted apart from unknown, whether or not it was fingerprinted. A finished result of the current adapter version stored not fingerprinted is never current: its freshness is unknown. When the latest discovery was stored under another adapter version, it still gives the tests counted, and the answer says it is not current.
- [x] AC3: The summary lists everything not discovered, each with its reason and never as a test state: each workspace whose discovery found no supported Vitest, failed, or was not confirmed at start; each module that failed to load during discovery; each typecheck module and each unsupported project; and each workspace source that was not read, including one outside the consumer root and a duplicate. Each reason is given up to a named length, with how many characters were left out and, for a failed module, its error count; the full text stays in the store. It gives the number of discovered tests marked duplicate. For each workspace of the latest discovery it gives that no run of it is stored, or its latest stored run's status, adapter version and whether that version is current, and for a run that loaded the workspace, whether it completed or was interrupted, whether Vitest was force-stopped, the reason nothing ran when there is one, and how many unhandled errors and module errors it recorded.
- [x] AC4: Every answer carries the daemon's activity (discovering, running a named workspace, or idle) and each job it reports as ended with nothing stored, with its reason.
- [x] AC5: `rt-test status <path> [--root <dir>]` resolves `path` against the current directory and answers for the discovered tests whose module file is that file or lies under that folder, with the state and freshness counts of AC1 and AC2. For a folder, it also gives one entry per test file under it with that file's own counts. It lists, with its reason, each entry of AC3's not-discovered list whose workspace, module or source path is the path or lies under it. `--root` defaults to the current directory, as `summary`'s root does, and neither command looks for a root in a parent directory.
- [x] AC6: No answer, human or `--json`, gives a set of tests a single pass or fail verdict: a worktree, folder or file is described only by its counts, so a set holding any test that is not a current pass never reads as passing.
- [x] AC7: A query that has nothing to answer exits 1 with a reason and prints no success-shaped result: when no daemon serves the root (the reason names the root and says to run `rt-test start`); when the daemon serving the root predates these queries (the reason says to stop it and start it again); when the daemon is stopping (the reason says so); when the answer would be longer than the protocol's line limit (the reason gives the answer's size and the limit, and says to ask `status` for a narrower path); when the daemon has stored no discovery for the worktree (the reason names the daemon's activity); when `status`'s path lies outside the root; and when neither a discovered test nor an entry of AC3's not-discovered list lies at or under `status`'s path. An answer that lists at least one test or one not-discovered entry exits 0, whatever the tests' states.
- [x] AC8: `summary` and `status` never start a daemon, a discovery or a run, and a query sent while the daemon is running a workspace neither interrupts that run nor changes which jobs run after it. Neither command loads a Vitest module, a consumer config, a test file or `node:sqlite` in the CLI's own process, and neither opens the store there.
- [x] AC9: An answer counts each stored run and discovery wholly or not at all: a run the daemon stores while the query is answered is either in every count of that answer or in none. An answer counts only the queried worktree's records, never another worktree's that shares the state directory.
- [x] AC10: With `--json`, stdout carries exactly one JSON document per invocation, whatever the outcome, except a usage error, which writes nothing to stdout. The document carries the CLI's `schemaVersion` and the command, and on a failure the reason, which is also written to stderr. Warnings go to stderr. Without `--json`, an answer goes to stdout and a failure's reason to stderr. A missing `path`, an unknown option, a missing option value and an extra argument each exit 2 with the usage on stderr.

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

- [x] (AC1) In `packages/core/src/test-identity.ts`, add and export one key for a whole `TestIdentity` (workspace path, project name, module path, name path, occurrence), built the way `namePathKey` keeps name paths apart, and export it from `packages/core/src/index.ts`. The query matches a discovered test to a run's test by this key alone (C8, C14).
- [x] (AC1, AC9) In `packages/daemon/src/store/read-runs.ts`, add a read of the latest stored run of each workspace path for one scope, choosing the latest by the store's `sequence`, never by row order (C29). Add a store read, exposed on `RtTestStore` in `open-store.ts`, that returns the worktree's latest discovery and those runs from one read transaction (C150), reusing `readLatestDiscovery`'s and `readRuns`'s row readers rather than a second decoding of any column (C8, C9). It reads only the given scope (C123).
- [x] (AC1, AC2, AC3) Create `packages/daemon/src/query/test-states.ts`: given the latest discovery, the latest run of each workspace and the current `VITEST_ADAPTER_VERSION`, give each discovered test of each `discovered` workspace its one state (AC1) and its freshness (AC2). Freshness comes from `@rt-test/core`'s `assessEvidence`, passing the stored fingerprint's digest, or no fingerprint for `NOT_FINGERPRINTED`, and no current fingerprint, since none exists before ticket 2.1 (C113, C114). A test with no finished result is unknown. A finished result from a run of another adapter version is stale before `assessEvidence` is asked, in one function, so freshness has one answer (C8, C124). Name each state as a constant (C3).
- [x] (AC1, AC2, AC3, AC4, AC6) Create `packages/daemon/src/query/summary.ts`: the summary of AC1 to AC4 from `test-states.ts`, the discovery's not-discovered entries and `notRead` sources, each latest-discovery workspace's latest-run facts (or that none is stored; a workspace with runs but absent from the latest discovery is left out, Q3), each reason cut to one named length with the count of characters left out (C3, C32), and the activity and nothing-stored jobs the daemon's status already tracks. Counts only: no field is a verdict for a set (AC6, C133).
- [x] (AC2, AC4, AC5, AC6, AC7) Create `packages/daemon/src/query/path-status.ts`: given the absolute path the client sent, decide it against the daemon's consumer root by canonical real path where the path exists, and where it does not (a deleted file) by the canonical real path of its nearest existing ancestor joined with the remaining segments, refusing a path outside the root. Match it against each test's root-relative module file (the workspace path joined with the module path, normalized, `/`-separated, P13) and each entry of AC3's not-discovered list by its workspace, module or source path, and answer AC5's counts and per-file entries, with AC2's note when the latest discovery is of another adapter version and AC4's activity and nothing-stored jobs, or AC7's reason when nothing lies at or under it.
- [x] (AC4, AC7, AC8, AC9) In 1.3's protocol module (`packages/daemon/src/daemon/protocol.ts` as it lands), add a summary request and a status request carrying an absolute path, their responses, and a nothing-to-answer error response carrying the reason. Keep the protocol version: the requests are additive, and a daemon from before this ticket answers them with 1.3 AC8's unknown-request error while `start` and `stop` keep working (orchestrator, 18:09). In 1.3's server and lifecycle, answer both from the daemon's open store and its tracked activity. A query only reads: it queues no job and changes no activity (AC8). When no discovery is stored, answer the error naming the activity (AC7). A query to a stopping daemon gets the server's existing `stopping` error without touching the store, which the stop closes (AC7). Measure each encoded answer against `MAX_LINE_BYTES` and, when it would pass it, answer the nothing-to-answer error giving the size and the limit instead (AC7).
- [x] (AC7, AC8) In 1.3's client (`packages/daemon/src/client.ts`), add a summary query and a status query for a consumer root, rejecting with a reason naming the root when no daemon answers, as `daemonStatus` does, with the daemon's reason on its nothing-to-answer error, with "the daemon serving <root> is stopping" on its `stopping` error, and, on the daemon's unknown-request error for the query, with "the daemon serving <root> predates this query; stop it and start it again" (AC7). They send and receive only; the client's module graph still loads neither `node:sqlite` nor Vitest (1.3's client task). Send each query on a connection whose hello the client proved, through `client.ts`'s `provenRequest` (ADR-0006), so no answer is trusted from a process that cannot prove it is this user's daemon.
- [x] (AC1 to AC10) Create `packages/cli/src/commands/summary.ts` and `packages/cli/src/commands/status.ts`, and add both to 1.3c's command table in `packages/cli/src/main.ts`. `summary` takes an optional `root` positional; `status` takes a required `path` positional and `--root <dir>`; both take `--json`. Resolve `root` and `path` to absolute paths against `io`'s current directory, never `process.cwd()` (1.3c's start task), and send only absolute paths to the client. Write through 1.3c's `output.ts` writer and `CLI_JSON_SCHEMA_VERSION`, unchanged at 1, with 1.3c's exit-code constants. Neither command reads the state directory or takes `--state-dir`: the daemon holds the store. The human rendering prints each set's counts only, with no pass, fail or success line for a worktree, folder or file (AC6).
- [x] (Support) Send the orchestrator the README text for `rt-test summary` and `rt-test status` (arguments, `--root`, `--json`, the states and freshness values, the exit codes, and that a query needs a running daemon; C7), the `docs/architecture.md` § Current implementation sentences for the query path, and FR5's marker (`[Ticket 1.4]`).
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `@rt-test/core` `assessEvidence(evidence, currentFingerprint)`: outcome and freshness, with a missing or empty fingerprint giving unknown. `TestIdentity`, `IdentifiedTest` and `TestOutcome`.
- 1.2's store: `readLatestDiscovery` and `selectDiscovery` in `read-discovery.ts`, `readRuns`, `selectRun` and their row readers in `read-runs.ts`, `inReadTransaction` in `transaction.ts`, `requireScope` and `fingerprintFromColumns` in `stored-records.ts`, `NOT_FINGERPRINTED` and `FINGERPRINT_DIGEST` in `schema.ts`.
- `packages/daemon/src/vitest/adapter-version.ts` `VITEST_ADAPTER_VERSION`, the one current adapter version. 1.3b raises it to 2 and 1.3's AC11 raises it again, so read it, never a literal.
- The record types: `WorkspaceDiscovery` and `TestDiscovery` (`discover-tests.ts`, with 1.3's not-confirmed status), `WorkspaceRun` (`run-workspace.ts`, with 1.3b's `forceStopped`), `RecordedModule`, `RecordedTest`, `TestRunState` and `NothingRanReason` (`run-states.ts`), `FailedModule` and `ModuleReport` (`module-tests.ts`), `UnreadWorkspaceSource` (`find-workspaces.ts`). Derive the query's shapes from these (C14).
- `packages/daemon/src/vitest/find-workspaces.ts` `relativePosixPath` for `/`-separated relative paths, and 1.3b's canonical-real-path decision of whether a directory lies inside the consumer root (the exported `realPath` and `liesInside`). Reuse them, extended for the nearest-existing-ancestor case, rather than a second inside-the-root rule (C5, C8), and write the query's own reason text: `outsideRootReason`'s text describes the workspace search ("so it was not searched").
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
- **Answer size.** Every answer is one protocol line, and `MAX_LINE_BYTES` (1 MiB) is frozen. A failed module's stored `errors` are `errorText` output with stacks, often several KB, and one broken setup file can fail every module of a workspace, so the not-discovered list scales as entries times reason length, and `status <folder>`'s file entries as files times path and counts. The reason cap bounds the first; the size check turns any answer still over the limit into AC7's reason rather than an unreadable line (dev sanity check F1, 2026-09-27 09:05).
- **Not-discovered kinds.** Tell a discovery workspace's kind by its `status` (`unsupported`, `failed`, `not-confirmed`), never by its error text: the store keeps the not-confirmed reason (`NOT_CONFIRMED_REASON`, "not confirmed at start") in `discovery_workspaces.error` (orchestrator, 2026-09-27 07:43).
- **A run newer than the latest discovery.** A failed discovery write leaves the stored runs paired with an older discovery (orchestrator, 2026-09-27 07:43). Q3 still holds: the latest stored discovery is the denominator, so a test only the newer run holds is not counted, and a discovered test that run lacks is "not in latest run".
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

Dev session: threadId fb940042-c2ca-49a5-9e9f-b18d1c69de46

#### Test Files This Change Broke

- `packages/daemon/test/lifecycle.test.ts`: its hand-built `RecordingStore` implements `RtTestStore`, which now requires `readLatestResults`, so the daemon workspace typecheck fails there (TS2420, TS2741, TS2352).
- `packages/daemon/test/server.test.ts`: its handler stand-in (line 45) lacks the new `DaemonHandlers.summary` and `pathStatus` (TS2739).
- `packages/daemon/test/defects.json` D1503 and D1571: `requireAnswer` and `provenRequest` moved unchanged from `client.ts` to `packages/daemon/src/daemon/proven-connection.ts` (a size split), so each record's `old` text now matches there and 0 times in `client.ts`. Re-point the `file` field only.
- `packages/cli/test/cli.test.ts` D1741 ("every command's usage") still passes but lists only `rt-test start` and `rt-test stop`; the table now also holds `rt-test summary` and `rt-test status`.

#### ACs Owed a Test

- AC2: a finished result from a run of another adapter version is stale, not unknown, and keeps its outcome; a discovery of another adapter version still counts, with `discovery.adapterVersionCurrent` false. Traced in `finishedFreshness` and `adapterVersionFacts`, never observed, since the store writes only the current version.
- AC4: a real daemon's answers carry its activity and each nothing-stored job (the lifecycle's `#view`). Observed only with a hand-built view.
- AC6: the human rendering of a live answer holds counts only, with no pass, fail or success line for a set.
- AC7: the cases that need a daemon: a daemon predating the queries (unknown-request error to "predates this query"), a stopping daemon (`stopping` error, no store read), an answer over `MAX_LINE_BYTES` (the size check in `server.ts` `queryResponse`), and no stored discovery through the CLI. A summary whose discovery holds no test and no not-discovered entry exits 1.
- AC8: a query during a run neither interrupts it nor changes which jobs follow, and starts no job.

#### Tests Owed

- D1731 (`packages/cli/test/defects.json`, start's already-serving refusal): `start.ts` now builds that reason through the client's exported `alreadyServingReason`, so the mutation's anchor and what it breaks need re-checking. Its `old` text still matches once and the printed wording is unchanged (orchestrator, 2026-09-27 09:05).
- `status` of a path inside a workspace whose discovery failed, or that has an unsupported project: `enclosingNotDiscovered` names that entry, and a path with nothing at or under it exits 1 naming it (adversarial review F1).
- `status` of a deleted file known only as a failed or typecheck module reports `pathKind` `file` (review F3).
- A reason longer than 1,000 code points is cut with `omittedCharacters` counting code points, never splitting a surrogate pair (review F6).

### Tests Record

Tests session: threadId 09fbf65e-7f46-458c-b8de-e5dc8a67b9ab

Repaired, as the handoff listed: `lifecycle.test.ts`'s `RecordingStore` gains `readLatestResults`, and `server.test.ts`'s handler stand-in gains `summary` and `pathStatus`. D1503 and D1571 now mutate `packages/daemon/src/daemon/proven-connection.ts`, text unchanged. D1741's usage list adds `rt-test summary` and `rt-test status`. D1731's anchor still matches once in `start.ts` and its test is unchanged; `test:defects` re-proves it.

#### Named Defects

- D1791: The whole-identity key leaves out the occurrence, so a stored result of the first of two same-named tests also answers the second. (AC1)
- D1792: Every finished test reads passed, whatever outcome its latest run recorded. (AC1)
- D1793: A test its latest run left unfinished is counted failed instead of interrupted. (AC1)
- D1794: A test whose module was not run is folded into not-in-latest-run. (AC1)
- D1795: A test whose module crashed is folded into module-not-run. (AC1)
- D1796: A test whose module failed to load is folded into module-not-run. (AC1)
- D1797: A test whose workspace's latest run failed to load is folded into not-in-latest-run. (AC1)
- D1798: A test whose workspace's latest run found no supported Vitest is folded into run-failed. (AC1)
- D1799: A test whose workspace's latest run was interrupted before loading reads never-run. (AC1)
- D1800: A discovered test the latest run does not hold is counted passed. (AC1, AC6)
- D1801: A test of a workspace with no stored run reads not-in-latest-run instead of never-run. (AC1)
- D1802: The answer lists only the states some test is in. (AC1)
- D1803: The test-identity key leaves out the project, so a same-named test of another project answers the discovered test. (AC1)
- D1804: A finished result from a run of another adapter version reads unknown instead of stale. (AC2)
- D1805: A test with no finished result reads stale instead of unknown. (AC2)
- D1806: A fingerprinted result is compared with its own digest as the current fingerprint, so it reads current. (AC2)
- D1807: A discovery of another adapter version is reported current. (AC2)
- D1808: A workspace not confirmed at start is listed as a failed discovery. (AC3)
- D1809: A workspace whose discovery failed is listed as having no supported Vitest. (AC3)
- D1810: A workspace with no supported Vitest is listed without its reason. (AC3)
- D1811: A failed module's error count is always 1. (AC3)
- D1812: Typecheck modules are left out of the not-discovered list. (AC3)
- D1813: Unsupported projects are left out of the not-discovered list. (AC3)
- D1814: Workspace sources that were not read are left out of the not-discovered list. (AC3)
- D1815: A reason is cut by UTF-16 unit, splitting a character that straddles the cut and miscounting what was left out. (AC3)
- D1816: The reason bound is one short, so a reason of exactly 1,000 characters loses its last one. (AC3)
- D1817: The duplicate count counts the tests not marked duplicate. (AC3)
- D1818: A workspace's latest run never reports that Vitest was force-stopped. (AC3)
- D1819: A run's module errors count the modules holding errors, not the errors. (AC3)
- D1820: A summary of a discovery holding no test and nothing not discovered answers an empty, success-shaped result. (AC7)
- D1821: With no stored discovery, the reason says the daemon is idle whatever it is doing. (AC7)
- D1822: A path matches only what lies under it, so a test file's own tests never answer for it. (AC5)
- D1823: A folder matches any path its name prefixes, so packages/a also counts packages/ab. (AC5)
- D1824: A folder answer gives no per-file entries. (AC5)
- D1825: A module path holding .. is joined without normalizing, so its test never lies under the folder it is in. (AC5)
- D1826: A deleted path drops its own segments, so a deleted test file answers as its folder. (AC5)
- D1827: A deleted file known only as a module that failed to load is reported as a folder. (AC5)
- D1828: A path answer lists none of the not-discovered entries under it. (AC5)
- D1829: A path outside the consumer root is not refused as outside it. (AC7)
- D1830: A path with nothing at or under it never names the not-discovered workspace, project or source it lies in. (AC7)
- D1831: An answer never names the not-discovered entries above its path. (AC5)
- D1832: The latest run of a workspace is chosen as the earliest stored. (AC1)
- D1833: The latest run is chosen across every workspace path. (AC1)
- D1834: The latest run is chosen across worktrees, so another worktree's newer run hides this worktree's. (AC9)
- D1835: A query to a stopping daemon reads the store the stop is closing and answers it. (AC7)
- D1836: An answer longer than the line limit is sent anyway. (AC7)
- D1837: An answer exactly at the line limit is refused as too long. (AC7)
- D1838: A query that throws is answered without what went wrong, so the reason never says why it failed. (AC7)
- D1839: A query with nothing to answer loses its reason. (AC7)
- D1840: A path-status request with a relative path reaches the query. (AC5)
- D1841: A query's answer says the daemon is idle while it runs a workspace. (AC4)
- D1842: A query's answer leaves out the jobs that ended with nothing stored. (AC4)
- D1843: A summary aborts the job in progress. (AC8)
- D1844: A path status aborts the run in progress, against a real daemon held mid-run. (AC8)
- D1845: A real daemon's answer says it is idle while it runs a workspace; D1841's defect and mutation, re-proved end to end through the protocol and client. (AC4)
- D1846: A daemon that predates the queries reads as one that could not answer, so the reason never says to restart it. (AC7)
- D1847: A stopping daemon's error never says it is stopping. (AC7)
- D1848: With no daemon serving the root, the query's reason never says how to start one; the test also checks that no daemon serves the root afterwards. (AC7, AC8, AC10)
- D1849: A summary holding a failed test exits 1. (AC6, AC7)
- D1850: The human summary prints a verdict for the whole worktree, "All tests passed.". (AC6)
- D1851: The human status prints a verdict for the folder, "Some tests failed.". (AC6)
- D1852: A relative status path resolves against the process's directory instead of the command's. (AC5)
- D1853: A summary holding no test exits 1 even when it lists entries RT Test could not discover. (AC7)
- D1854: A query with nothing to answer drops the daemon's reason, so it never names the daemon's activity. (AC7)
- D1855: A status with no path queries the current directory instead of refusing as a usage error. (AC10)
- D1861: The whole-identity key leaves out the module path, so a same-named test in another module of the project answers the discovered test. (AC1)
- D1862: The whole-identity key leaves out the name path, so every first-occurrence test of a module shares one key. (AC1)
- D1863: The latest run is chosen across projects, so another project's newer run of the same worktree and workspace hides this project's. (AC9)
- D1864: A workspace's latest run never reports the reason nothing ran. (AC3)
- D1865: A workspace whose latest run failed to load it, found no supported Vitest, or was interrupted before loading reports no run at all. (AC3)
- D1866: A status of the consumer root itself answers that nothing lies at or under it. (AC5)
- D1867: A status path resolves against --root instead of the command's directory. (AC5)
- D1868: A status ignores --root and asks the daemon of the command's directory. (AC5)
- D1869: A summary ignores its root argument and asks the daemon of the command's directory. (AC1)
- D1870: An entry at the path is listed both at and above it. (AC5)
- D1871: A summary resets the daemon's activity to idle while a run continues. (AC8)
- D1872: A path-status answer leaves out the jobs that ended with nothing stored. (AC4)
- D1873: The human answer never gives a failed module's error count. (AC3)
- D1874: A workspace whose latest run could not load it reads as failed in the human summary. (AC6)
- D1875: A query whose connection fails mid-request rejects without naming the root. (AC7)
- D1876: A failed status document names the requested absolute path `path`, the key a success uses for the root-relative path. (AC10)
- AC8's no `node:sqlite`, Vitest or consumer module in the CLI process: covered by D1740, since `main.ts` imports both query commands statically and D1740 lists the modules `bin.ts` loads.

#### Deliberately Untested

- `packages/daemon/src/store/open-store.ts` `readLatestResults`'s one read transaction (AC9): no seam lets a test store a run between its two selects in one process, so dropping the transaction is unobservable (inert mutation).
- `packages/daemon/src/query/test-states.ts` `NO_FINGERPRINT` for a not-fingerprinted result: while no current fingerprint exists, `assessEvidence` rates every result unknown, so the mapping is unobservable until ticket 2.1 (inert mutation).
- `packages/daemon/src/query/summary.ts` leaving out a workspace that has runs but is absent from the latest discovery: the list is built from the discovery alone, and no minimal mutation reaches another source.
- `packages/cli/src/answer-text.ts` first-line cut and `(more lines)` marker: rendering only; `oneLine` already escapes a line break, so no defect breaks a line.
- `packages/daemon/src/query-client.ts` the fallback "could not answer" reason: no criterion names its text; D1846 and D1847 prove the named branches leave it.
- No walk-up to a parent root (AC5): no code looks for one; the default root is the command's directory, which D1852 and 1.3c's D1711 and D1770 pin.
- `packages/core/src/index.ts`, `packages/daemon/src/daemon/protocol.ts`, `packages/daemon/src/query/answer.ts`: exports, types and named constants; `activityText` is covered through D1821 and D1854.
- `packages/daemon/src/daemon/proven-connection.ts` and `read-discovery.ts` `selectLatestDiscovery`: moved or extracted unchanged, covered by D1503, D1571, D1556 to D1561 and the store's discovery tests.

### Review Record

Review session: threadId 01b2733e-ebb2-4bef-a4d6-7c2df6662e22

Fixed in review, each needing the gap row named beside it:

- `packages/cli/src/answer-text.ts`: a failed module's error count shows in the human line (AC3, gap 14); a reason that only ends in a line break is no longer marked `(more lines)`; `INDENT` is exported once and imported by `summary.ts` and `status.ts`.
- `packages/cli/src/commands/summary.ts`: each workspace's latest run is described by a named phrase per status (`latest run could not load the workspace`, never `latest run failed`) (AC6, gap 15).
- `packages/cli/src/commands/status.ts`: the dead `?? path` is gone, and a failure document carries the request as `requestedPath`, so `path` always means the root-relative path (gap 17).
- `packages/daemon/src/query-client.ts`: a transport failure during the request rejects naming the root (gap 16); an error answer is decided before `requireAnswer`, which now reads as a guard.
- `packages/daemon/src/query/path-status.ts`: `kindOf` falls back to the stored-file comparison when `statSync` throws for any reason, not only a missing path.
- `packages/daemon/src/daemon/protocol.ts`: `NOTHING_TO_ANSWER_CODE`'s docblock covers an answer over the line limit.

Tech debt, undisposed:

- [Pre-existing] `packages/daemon/src/store/open-store.ts` `RtTestStore.readRuns`, `readRun` and `readLatestDiscovery` have no production caller; only tests call them, and every hand-built store must implement them (C59).
- [Duplication] `packages/daemon/src/query/summary.ts` `summaryAnswer` rebuilds the workspace-path-to-run `Map` that `packages/daemon/src/query/test-states.ts` `testStandings` builds from the same `latestRuns`; `QueryBasis` could carry it.

D1838: its mutation names no defect a consumer can observe. `query-client.ts` `queryErrorReason` reads `invalid-request` and `query-failed` alike (its default branch), and the message is unchanged under the mutation, so the CLI's output and exit code are byte-identical; no criterion names a throwing query. Gap 10 re-points it.

#### Test Coverage Gaps

| #   | Source                                                                         | Defect                                                                                                                                                                                                              | Expected test                                                                                                                                                 | Severity |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `packages/core/src/test-identity.ts` `testIdentityKey`                         | The whole-identity key leaves out the module path, so a same-named test in another module of the project answers the discovered test. (AC1)                                                                         | Two identities differing only in module path get different keys, beside D1791                                                                                 | MEDIUM   |
| 2   | `packages/core/src/test-identity.ts` `testIdentityKey`                         | The whole-identity key leaves out the name path, so every first-occurrence test of a module shares one key and one result answers them all. (AC1)                                                                   | Two identities differing only in name path get different keys                                                                                                 | MEDIUM   |
| 3   | `packages/daemon/src/store/read-runs.ts` `SELECT_LATEST_RUN_IDS`               | The latest run is chosen across projects, so another project's newer run of the same worktree and workspace path hides this project's. (AC9)                                                                        | Beside D1834: `WORKTREE_A` stores a ran run, `OTHER_PROJECT` then stores a run of the same path; A's latest is still its own                                  | MEDIUM   |
| 4   | `packages/daemon/src/query/summary.ts` `latestRunFacts`                        | A workspace's latest run never reports the reason nothing ran. (AC3)                                                                                                                                                | A ran run with a `nothingRan` reason shows it in `workspaces[].latestRun.nothingRan`                                                                          | MEDIUM   |
| 5   | `packages/daemon/src/query/summary.ts` `latestRunFacts`                        | A workspace whose latest run failed to load it, found no supported Vitest, or was interrupted before loading reports no run status. (AC3)                                                                           | A stored `failed` run gives `latestRun.status` `failed` with its adapter facts                                                                                | MEDIUM   |
| 6   | `packages/daemon/src/query/path-status.ts` `liesAtOrUnder`, `rootRelativePath` | A status of the consumer root itself answers that nothing lies at or under it. (AC5)                                                                                                                                | `status .` answers path `.`, kind `folder`, and every test of the tree                                                                                        | MEDIUM   |
| 7   | `packages/cli/test/cli.test.ts` `verdictLines` (defective test)                | `PATH_TOKEN` strips any token holding a `.`, so a verdict ending a sentence ("All tests passed.") escapes D1850 and D1851. (AC6)                                                                                    | Strip only path-shaped tokens; a record whose mutation prints `All tests passed.` is detected                                                                 | MEDIUM   |
| 8   | `packages/cli/src/commands/status.ts`, `summary.ts`                            | `status` resolves its path against `--root` instead of the current directory, or ignores `--root`; `summary` ignores its `root` argument. Every query test runs with the current directory equal to the root. (AC5) | Run `status b --root ..` from `root/packages`, answering `packages/b`; run `summary <relative root>` from the root's parent                                   | MEDIUM   |
| 9   | `packages/daemon/src/query/path-status.ts` `encloses`                          | An entry at the path is listed both at and above it. (AC5)                                                                                                                                                          | `status packages/b` lists its unsupported project in `notDiscovered` and `enclosingNotDiscovered` is empty                                                    | LOW      |
| 10  | `packages/daemon/src/daemon/server.ts` `queryResponse` (D1838)                 | A query that throws is answered without what went wrong, so the reason never says why it failed. (AC7)                                                                                                              | Re-point D1838's mutation to drop `errorText(failure)` from the message and assert the message carries the thrown text; the status after it is still answered | LOW      |
| 11  | `packages/daemon/src/daemon/lifecycle.ts` `summary`, `pathStatus`              | A query resets the daemon's activity to idle while a run continues. (AC8)                                                                                                                                           | After D1843's queries, `status().activity` is still running workspace `a`                                                                                     | LOW      |
| 12  | `packages/daemon/src/daemon/lifecycle.ts` `pathStatus`                         | A path-status answer leaves out the jobs that ended with nothing stored. (AC4)                                                                                                                                      | A lifecycle path status from a real temp root carries the view's `unstoredJobs`; today's `/consumer` root never reaches the view                              | LOW      |
| 13  | `packages/daemon/test/defects.json` D1841, D1845                               | Both records apply the same mutation to the same line of `lifecycle.ts`, so the count overstates distinct defects.                                                                                                  | Point D1845 at a defect only the real daemon reaches, or say in its record that it re-proves D1841 end to end                                                 | LOW      |
| 14  | `packages/cli/src/answer-text.ts` `notDiscoveredLines`                         | The human answer never gives a failed module's error count. (AC3)                                                                                                                                                   | A human summary with a failed module prints `(N errors)` on its line                                                                                          | MEDIUM   |
| 15  | `packages/cli/src/commands/summary.ts` `RUN_STATUS_PHRASES`                    | A workspace whose latest run could not load it reads as failed in the human summary. (AC6)                                                                                                                          | `verdictLines` of a human summary whose workspace's latest run is `failed` is empty                                                                           | MEDIUM   |
| 16  | `packages/daemon/src/query-client.ts` `query`                                  | A query whose connection fails mid-request rejects without naming the root. (AC7)                                                                                                                                   | A stand-in daemon that proves the hello and then closes gives a reason naming the root                                                                        | LOW      |
| 17  | `packages/cli/src/commands/status.ts`                                          | A failed status document names the requested absolute path `path`, the key a success uses for the root-relative path. (AC10)                                                                                        | A failed `status --json` document carries `requestedPath` and no `path`                                                                                       | LOW      |
| 18  | `packages/cli/test/cli.test.ts` D1848                                          | A query with no daemon serving the root starts one. (AC8)                                                                                                                                                           | After D1848's query, no daemon serves the root                                                                                                                | LOW      |

Denominator: 65 named-defect tests (D1791 to D1855) against the ten criteria's behaviors; 18 gaps above, 8 of them MEDIUM.

### Completion Notes

What was built:

- Core's `testIdentityKey`.
- The store's `readLatestResults`: the latest discovery plus the latest run of each workspace path by `sequence`, in one read transaction, reusing `selectRun` and a new `selectLatestDiscovery`.
- `query/answer.ts`: the answer shapes and named states, importing only types, so the client and CLI load it without `node:sqlite`.
- `query/test-states.ts`, `query/summary.ts` and `query/path-status.ts`.
- In the protocol: the `summary` and `path-status` requests and the `nothing-to-answer` and `query-failed` codes. The protocol version is unchanged.
- In the server: queries come after the stopping check, a throw becomes `query-failed`, and each answer is measured against `MAX_LINE_BYTES`.
- The lifecycle's read-only `summary` and `pathStatus`.
- The client's `querySummary` and `queryPathStatus` on a proven connection.
- `rt-test summary` and `rt-test status`.

Sanity check (Step 4), sent to the author at 09:04. The author confirmed all three at 09:05 and updated the ticket (TICKET UPDATED):

- F1: answer size against `MAX_LINE_BYTES`.
- F2: a stopping daemon.
- F3: per-workspace run facts cover the latest discovery's workspaces.
- The noted item: `realPath` and `liesInside` are reused rather than `outsideRootReason`.

Unverified assumptions: none to resolve.

Decisions within the criteria:

- Test-state keys are `passed`, `failed`, `skipped`, `error`, `interrupted`, `module-not-run`, `module-crashed`, `module-failed-to-load`, `run-failed`, `run-unsupported-vitest`, `run-interrupted-before-load`, `not-in-latest-run` and `never-run`. Freshness keys are `current`, `stale` and `unknown`. JSON lists every key, zeros included; the human text leaves zero states out.
- Reasons are cut at 1,000 code points.
- The CLI's `--json` document carries 1.3c's `ok`, which says the command answered, never that tests passed (AC6, Q6).
- `status` adds `enclosingNotDiscovered`: workspace, project and source entries above the path. When nothing lies at or under the path, the exit-1 reason names them. AC5's at-or-under list and AC7's exit rule are unchanged.
- `summary` exits 1 when the latest discovery holds no test and no not-discovered entry, applying Q6's rule to the summary as well (review F2).
- The no-daemon reason names `rt-test start` inside the daemon client, as AC7 asks. A programmatic caller sees the same hint.

Size split: `client.ts` reached 515 code lines, over the cap. How a client reaches and proves the daemon (`DaemonTarget`, `targetOf`, `provenRequest`, `requireAnswer`, and the new `onProvenConnection`) moved to `daemon/proven-connection.ts`. The queries live in `query-client.ts`, which `client.ts` re-exports. Status and both queries share `onProvenConnection`, so every query goes through the proven hello (ADR-0006).

Taken from 1.3c's Step 9 (orchestrator, 2026-09-27 09:05): `alreadyServingReason(pid, root)` is exported from the client. `refuseRunningDaemon` and `start.ts`'s `runningDaemonRefusal` both use it. The client's refusal now reads "Refusing to start: a daemon, process N, already serves the worktree at R."; start's printed text is unchanged.

Validation, 2026-09-27 on Windows and Node 24.19, against the final tree:

- `bun x oxlint` over the 20 production files: exit 0, no warnings.
- `bun x prettier --check`: clean.
- `bun run --filter @rt-test/core typecheck` exits 0, and so do `--filter rt-test` and root `bun x tsc --noEmit`.
- `bun run --filter @rt-test/daemon typecheck` exits 1, only in `test/lifecycle.test.ts` and `test/server.test.ts` (listed above).
- `node scripts/check-line-citations.mjs`: clean.

Acceptance evidence without tests (scratch probes, since removed):

- The CLI without a daemon: exit 1 naming the root and `rt-test start`, with one JSON document under `--json` (AC7, AC10).
- Usage errors each exit 2 with nothing on stdout: a missing path, an extra argument, `--root` without a value, an unknown option (AC10).
- A real store with hand-built records:
  - six tests in six states, summing to 6;
  - a test the latest run lacks reads `not-in-latest-run` although an older run passed it;
  - all tests unknown;
  - a 1,507-character reason cut with 507 omitted and an error count of 2;
  - a workspace with no run shows `latestRun: null`;
  - another worktree's records are never counted;
  - file, folder, deleted-file, outside-root and nothing-at-path answers (AC1, AC3, AC5, AC7, AC9).
- Loading `client.ts` and the CLI's `main.ts` pulls in no `node:sqlite`, checked against a control that does see it (AC8, CLI process).

Adversarial review, 10 findings:

- Fixed: F1 (enclosing entries), F2 (empty summary), F3 (deleted module's kind), F5 (a comment's over-claim), F6 (code-point cut), F7 (CRLF reasons), F10 (`QUERY_FAILED_CODE`), plus the refusal naming the root twice and the lifecycle docblock.
- Discarded F4 (the response bound), on measurement: with 50,000 tests in 20 workspaces and 60 stored runs, warm, the read takes about 130 ms, the summary 38 ms, and status of the whole tree about 280 ms. That is far inside the 10 s `RESPONSE_BOUND_MS`.
- Discarded F8 (double serialization): 5 ms for a 1.87 MB answer.
- Discarded F9 (1 + 3W statements for the latest runs): it is the ticket's required reuse of `selectRun`'s decoder, and W is the workspace count.
- Post-fix re-validation (lint and typecheck, the implementer's arm): clean, as above.

README and `docs/architecture.md` text went to the orchestrator as exact text. FR5 already reads `[Ticket 1.4]`, so no marker change.

Change-request candidates: none.

### File List

Created:

- `packages/daemon/src/query/answer.ts`
- `packages/daemon/src/query/test-states.ts`
- `packages/daemon/src/query/summary.ts`
- `packages/daemon/src/query/path-status.ts`
- `packages/daemon/src/query-client.ts`
- `packages/daemon/src/daemon/proven-connection.ts`
- `packages/cli/src/answer-text.ts`
- `packages/cli/src/commands/summary.ts`
- `packages/cli/src/commands/status.ts`

Modified:

- `packages/core/src/test-identity.ts`
- `packages/core/src/index.ts`
- `packages/daemon/src/store/read-runs.ts`
- `packages/daemon/src/store/read-discovery.ts`
- `packages/daemon/src/store/open-store.ts`
- `packages/daemon/src/daemon/protocol.ts`
- `packages/daemon/src/daemon/server.ts`
- `packages/daemon/src/daemon/lifecycle.ts`
- `packages/daemon/src/client.ts`
- `packages/cli/src/main.ts`
- `packages/cli/src/commands/start.ts`
- `_agent-docs/tickets/1-4-query-cli.md`

No dependency change.

Planning files the create-ticket run wrote:

- `_agent-docs/tickets/1-4-query-cli.md` (created)
- Held for the orchestrator, as exact text: `_agent-docs/sprint-status.yaml` (1.4 to `ready-for-dev`), the sprint file's 1.4 section (the ticket-file link), and FR5's marker in `docs/requirements.md` (`[Sprint 1]` to `[Ticket 1.4]`). The `README.md` and `docs/architecture.md` text follows from dev-ticket's Support task.

# Ticket 3.7: Falsification corpus

## Ticket

As the owner reading whether milestone M2 is met,
I want the M2 acceptance replayed against RT Test's own daemon over a committed consumer that holds defect definitions, on each supported Vitest line and at every push, and the two targets ticket 3.5 left for this ticket measured,
so that a change that credits a setup failure, lets a weakened test keep its detection, hides a rewritten anchor, credits the wrong one of two tests sharing a name, miscounts verified or eligible, or writes into a consumer's tree fails the gate, and the job size and the time bound are read from runs rather than estimated.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

The **falsification corpus** is the committed fixture, the steps saved to it and the check that replays them. A **replay** is one run of every step in one daemon life, over a fresh copy of the fixture linked to one Vitest install. A definition is **waiting** as the glossary's Waiting defect is: eligible, with evidence missing or not current. A definition was **falsified at a step** when the evidence record the store holds for it after the step is not the record it held before that step; at the baseline, when the store holds a record for it at all.

- [x] AC1: A synthetic consumer committed under `test/fixtures/daemon/falsification-corpus/` holds two Vitest workspaces, a library and an app that depends on it, the dependency declared in the app's `package.json` and imported by package name, and an `rt-test.json` whose `defects` member lists one definition file in each workspace. Its definitions, in ADR-0009's format, hold between the two workspaces: one whose test rejects its mutation by an assertion in the test's body; one whose mutation fails an assertion in a setup hook before the intended test's body runs; two tests sharing one name path in one module, each named by its occurrence under one mutation, which the first checks and the second reaches without checking; one naming that name path with no occurrence; one whose anchor step 1 rewrites; and one more in the library, beside the one step 2 weakens, whose detection stands through both steps. Every test passes unmutated, is deterministic, finishes in well under a second and writes nothing into the tree. (FR12, FR24)
- [ ] AC2: A replay runs, in one daemon life: the baseline, a start with every workspace confirmed and no edit; step 1, which rewrites in the app's source the line a definition's anchor names, leaving what the code does unchanged; and step 2, which weakens in the library's test the assertion that detected a definition's mutation, so that the test passes with and without the mutation. The corpus is replayed once on Vitest 4.1 and once on Vitest 5, each replay in a temporary copy of the fixture made a git repository, with that Vitest and the workspace packages linked under `node_modules` as a package manager links them. Each replay ends its daemon and every process it started however it ends, and keeps its copy, its state directory and its log under the run's temp root, so it writes nothing into this repository's tree. The corpus runs in the ordinary suite, so the gate runs it on Windows and on Linux. (NFR7)
- [ ] AC3: At the baseline and after each step the check compares nothing until the daemon has finished what the step set off: a wait on the step's files, through `queryWait` (at the baseline, on every test module of the fixture), has answered settled; the daemon's schedule shows its round planned, every confirmed workspace idle and no change unread; its activity reads idle; and no definition is waiting. A step that does not get there within the check's bound is a finding naming the step, the definitions still waiting, the activity and each job the daemon lists as ended with nothing stored, and the replay ends there, since no later step can be judged. The check's waits share one deadline that falls before the test's own timeout, so a replay too slow to finish returns that finding, with what was pending, rather than ending at the test's timeout. This holds whether or not the daemon takes a canary job before a workspace's first falsification job (ticket 3.6). (FR15)
- [x] AC4: After the baseline and after each step, every definition reads the state, the eligibility, the evidence freshness and, where its verdict has one, the reason that the step declares for it. At the baseline: the library's definitions whose tests assert in their bodies read detected; the setup hook's reads invalid experiment with the reason `hook-not-passed`, and never detected; of the two tests sharing a name path, the first occurrence's definition reads detected and the second's survived; the definition naming no occurrence reads invalid definition and is not eligible; the anchor's definition reads detected; and every verdict's evidence freshness reads current. After step 1 the anchor's definition reads anchor missing and is not eligible, and every other definition reads as at the baseline. After step 2 the weakened test's definition reads survived with evidence freshness current, and every other definition reads as after step 1. A definition the answer lists that the corpus does not declare, and one it declares that the answer does not list, are each a finding. (FR11, FR13, FR15, FR24, NFR7)
- [x] AC5: After the baseline and after each step, the `defects` answer's total, eligible and verified counts and its count of each state equal the numbers the step declares. (FR22)
- [x] AC6: At each step the definitions falsified are exactly the ones the step declares. At the baseline they are every definition that reads a verdict. At step 1 they are the app's definitions that read eligible once the step has settled (so not the one whose anchor it rewrote) and no definition of the library, whose evidence stays the records the baseline stored: an edit that reaches no input of a workspace gives it no experiment. At step 2 they are the definitions of both workspaces that read eligible once the step has settled, since the app depends on the library. A definition falsified that the step does not declare, and one declared that was not falsified, are each a finding naming the step and the definition. Every evidence record a replay stores carries the version of the Vitest install that replay linked, and one that carries another is a finding. (FR15, NFR7)
- [x] AC7: After the baseline and after each step, every file of the consumer copy outside `.git`, any directory named `node_modules` at any depth and the state directory holds the bytes it held before the daemon started, the steps' own edits aside, with no entry added and none removed; and no file under the copy, those directories included and no link followed, other than a definition file, holds the `new` text of a definition. Each difference is a finding naming the step and the path. (NFR6)
- [x] AC8: The check returns one report for a replay listing every finding by kind (not settled, state not as declared, count not as declared, definition not declared, declared definition not listed, falsified outside the declared set, declared and not falsified, evidence under another Vitest version, consumer file changed, mutation text on disk), each naming its step and the definition, count or path involved, and a replay with no finding returns exactly one clean value, so a test asserts a whole replay with one assertion and no hook. It throws only when the harness itself cannot run, and never turns a failure into a clean report.
- [ ] AC9: Each replay, its baseline and both steps included, completes on an idle Windows machine in at most half of `DAEMON_TEST_TIMEOUT_MS`, measured on a tree that holds ticket 3.6's canary gate, so with a canary job ahead of the replay's first falsification job, and recorded in this ticket with the Linux figure. A figure taken on a tree without the gate does not meet this criterion. A replay that does not fit is never shortened by dropping a step: the figure goes to the orchestrator, since a second daemon life would start from a baseline that AC4, AC5 and AC6 do not declare. Nothing of AC10 runs in the suite.
- [x] AC10: The two targets ticket 3.5 left (the job size and the time bound) and the look between two jobs are measured outside the suite, over a consumer written for the measurement, on Windows and on Linux, and recorded in the Completion Notes with the hardware, the OS, the Node and Vitest versions, the consumer's sizes, the wall time of plain Vitest over the same consumer as the runner-only baseline, and that the file cache was warm, a cold figure being named as not taken: (a) the wall time, as the daemon's log reports it, of a falsification job of `MAX_JOB_DEFINITIONS` definitions and of a job of one definition, on Vitest 4.1 and on Vitest 5, as the median and the slowest of at least 5 jobs of each size on each line; (b) in the same runs, the time from one job's end entry to the next job's start entry, which is what the look between two jobs costs inside a running daemon at that consumer's size; and (c) on one Vitest line, named in the record, one job of a workspace whose `MAX_JOB_DEFINITIONS` experiments outlast `JOB_TIME_BOUND_MS`, run until the bound has ended it and the next job has started: when the job ended, how many verdicts were stored, which definition was marked, what a `defects` answer and the entry of the jobs that ended with nothing stored read, and how many definitions the next job holds. No figure of a job's wall time, of the look between two jobs or of the time bound is called measured in a doc but from these runs, and this ticket changes neither constant.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. Its fixture uses `describe`, `it`, `beforeEach` and `expect` as the committed `falsify` fixture and the canary set do, and create-ticket ran the fixture's shape and both steps through a real daemon on Vitest 4.1.11 and 5.0.1 (§ Settled facts).

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Before the first edit, read the landed code named under § Reuse and confirm each name this ticket uses. Read `git log --oneline -5` for whether ticket 3.6's merge is in the tree: if it is, read `packages/daemon/src/daemon/canary-gate.ts` and confirm that a canary job stores no evidence and that the activity reads falsifying while one runs (its AC5 and AC6, quoted under § Pending siblings). Before building the comparisons, take AC7's two readings once over a settled baseline, since create-ticket's spikes did not run them: the tree outside the directories AC7 leaves out must read as before the start, and the search must find no definition's `new` text in the store, the log or a `node_modules` directory. A hit in the state directory is a product finding for the orchestrator, never a path to leave out (§ Known limits).
- [x] (AC1) Create the fixture under `test/fixtures/daemon/falsification-corpus/` by § Fixture shape: the root `package.json` and `rt-test.json`; `packages/lib` and `packages/app`, each with a `package.json` naming it, with `type` `module` and an `exports` map, the app's with a `dependencies` entry (`workspace:*`) for the library, a `vitest.config.mjs` exporting a plain object as the other daemon fixtures do, its source, its test module and its definition file. Write the fixture's modules as `.mjs`, as the edit corpus's fixture is. Name no file `defects.json`: `readRecords` in `scripts/lib/defects/catalog.mjs` reads every file of that name under `test/` as this repository's own record array, and a definition file is an object, so `bun run check:defects` and every proof would throw (§ Settled facts). Give each definition a `new` text that occurs in no other file of the fixture and in no text a step writes, and that JSON stores without an escape (no double quote, backslash or line break), so AC7's search finds it in its own definition file as written and nowhere else (C60); the spike's label and receipt mutations held double quotes, so pick others. Keep step 1's rewrite one that leaves every test passing, and step 2's assertion one that passes with and without the mutation.
- [x] (AC2, AC4, AC5, AC6) Create `packages/daemon/test/falsification-corpus-steps.ts`: the fixture's name, the two workspaces, the steps as data, and what each step declares. Each step gives the files it changes, each change as an exact text replaced once, throwing when the text does not occur exactly once (C60); for every definition its declared state, eligibility, evidence freshness and reason, through the constants of `packages/daemon/src/defects/defect-states.ts` and `packages/daemon/src/query/answer.ts` (C14, C95); the declared total, eligible and verified counts and each state's count, written as numbers (AC5, C73, C74); and the definitions declared falsified. Derive every declared reading from the requirements and ADR clauses quoted in Dev Notes, never from a run; § Declared readings holds them as create-ticket's spike read them, for comparison.
- [x] (AC2, AC3, AC6, AC7) Create `packages/daemon/test/falsification-corpus.ts`, the check. For one Vitest install: copy the fixture with `inConsumerCopy`, link the packages with `linkWorkspacePackages`, make it a repository with `fixtureRepository`, and run inside `withDaemons`, starting the daemon with `started(root, pids, confirmEvery(root))`; throw when the start confirms other than the fixture's two workspaces. At the baseline call `queryWait` on every test module of the fixture, and after each step on the step's changed files, each with what is left of the replay's deadline as its limit. A wait that answers other than `WAIT_OUTCOME.settled` (superseded, or out of time) is the not-settled finding, recorded with one `queryDefects` answer taken then, and ends the replay (§ Grill, 2). Otherwise poll `queryDefects` until the answer's `schedule.round.state` is `ROUND.planned`, every `schedule.workspaces` entry is `EXECUTION_STATE.idle`, `inputs.pendingChanges` is 0, `activity.state` is idle and no listed definition is eligible with evidence absent or of a freshness other than current; when the deadline passes first, record the not-settled finding with the last answer's waiting definitions, activity and `unstoredJobs`, and end the replay (AC3). Give the replay one deadline, counted from the replay's first action (the copy), a named constant (C3) below `DAEMON_TEST_TIMEOUT_MS` by more than the harness needs to take a step's readings and end the daemon, and hand each `queryWait` and each poll what is left of it, so a slow replay ends by its report and the test's assertion and not by the test's timeout (§ Time and the suite's load). Read the evidence records through the store as `storedRuns` in `daemon-harness.ts` opens it: `openStore(stateDirectory).readLatestResults(consumerIdentity(root)).evidence`, each with its `defectId`, `evidenceId` and `vitestVersion`, closing the store in a `finally` (C106). Read the install's version from the `package.json` of the install the copy links, through the link. Take a reading of the copy's tree before the daemon starts and after each step settles (AC7): one line for each entry outside `.git`, any directory named `node_modules` at any depth and the state directory, an entry's path with a file's digest or a link's target, no link followed, as `treeLines` in `packages/daemon/test/falsify/canaries.test.ts` builds one (§ Design decisions, 7).
- [x] (AC4, AC5, AC6, AC7, AC8) Create `packages/daemon/test/falsification-corpus-findings.ts`: write every comparison as a pure function over the readings (the answer's definitions and counts, the evidence records before and after, the tree's lines before and after, the files searched), exported, with each finding kind a named constant (C3) and each finding naming its step and subject, so a test can drive one over hand-built readings. The state comparison reports a definition whose state, eligibility, freshness or reason differs, one listed and not declared, and one declared and not listed. The falsified comparison takes a definition as falsified when its `evidenceId` after the step differs from the one before, or it had none before. The count comparison reports each of the total, eligible and verified counts and each state's count that differs from the step's declared number, and a state the answer counts that the step does not declare. The version comparison takes the linked install's version beside the evidence records and reports each record whose `vitestVersion` differs. The tree comparison expects exactly the step's edited files to differ from the reading before it: a path that differs and is not the step's is a finding, and so is a step's edited file that shows no difference, since a reading that sees no edit did not look (C60). Both are of the kind consumer file changed, the second saying that the step edited the file and the reading holds the bytes it held before; it is a finding and no throw, since a step whose text did not match once has already thrown, so the old bytes were written back by another hand than the step's. The mutation search reads every regular file under the copy but the definition files, with `.git`, `node_modules` and the state directory included, follows no link, and reports each file holding a definition's `new` text; it throws when a definition's `new` text is not found in its own definition file, so a search that read nothing cannot pass (C60).
- [x] (AC8) Export one function that replays the corpus on a `VitestInstall` and resolves with its report, and the clean report as one exported value. It throws when the harness cannot run (a failed copy, a daemon that does not start, a step whose text does not match the fixture, a store or query read that fails) and never returns the clean value over a failure (C30, C32).
- [x] (AC9) Run each replay once through a stand-in test body on Windows and on Linux, and record each duration in the Completion Notes, saying of each whether the tree held ticket 3.6's gate. AC9's figure is the one taken on a tree that holds the gate: this lane merges main in once ticket 3.6 has landed there, and the dev measures on that merged tree if it is still building then; otherwise the tests member measures it, from the test file's own run, and writes it under the Tests Record. Until then list AC9 under the Dev Handoff as owed, with the figure taken without the gate beside it, so nobody signs it off on a tree without the gate (orchestrator, 16:13 on 2026-10-01). When a replay takes more than half of `DAEMON_TEST_TIMEOUT_MS` on Windows, stop and send the orchestrator the figure, as AC9 says. Delete the stand-in before handing off; create-tests writes `packages/daemon/test/falsification-corpus.test.ts`.
- [x] (AC10) Measure, through a stand-in under `_agent-docs/.scratch/` that is deleted afterwards and through the run lease (`_agent-docs/crew.md` § Gates). The run of (c) holds the lease for about 11 minutes on each platform: tell the orchestrator before starting each, so no gate queues behind one unawares (orchestrator, 16:13 on 2026-10-01). Write the measured consumer into a temporary directory, never into the fixture: for (a) and (b), a workspace of `MAX_JOB_DEFINITIONS` definitions and a workspace of one, each definition detected by its test, as § Settled facts describes the spike's, taking at least 5 jobs of each size on each line, by an edit to an input of the workspace between jobs or by a new daemon life, saying which in the record and giving a daemon life's first job apart from its later ones where they differ; beside them, the wall time of plain Vitest's command line over the larger workspace, as the runner-only baseline; for (c), on one Vitest line named in the record, a workspace of `MAX_JOB_DEFINITIONS` definitions, one to a test module, whose one test takes long enough that the job's experiments, two runs for each detected definition, together outlast `JOB_TIME_BOUND_MS` while its baseline, which runs the modules side by side, ends well inside it. Read each job's wall time and the time between two jobs from the daemon's log entries (`falsification started`, `falsification ended`, and their timestamps). Say with each figure whether the tree held ticket 3.6's gate; on a tree that holds it, leave a canary job's entries out of both figures, and take the time between two jobs only between two falsification jobs with no canary job between them. For (c), read the log's end entry, a `queryDefects` answer and its `unstoredJobs`, and the next job's start entry, then stop the daemon. Record with every figure the hardware, the OS, the Node and Vitest versions, the consumer's sizes (workspaces, test modules, tests, definitions, the test's duration) and that the file cache was warm, and say what the measured consumer does not hold (C177): no setup file, no hook, no import across workspaces, and modules of a few lines, so the figures say nothing of a consumer's load time or of a baseline over real modules.
- [x] (Support) Send the orchestrator, with the build, the text for the files this lane does not edit (C7): `docs/testing.md` (a `### Falsification corpus` entry under `Name the defect` with its line in the `Section menu`, written by the tests session once the records exist, and what the corpus replays, under `Falsification jobs, mutation transforms and reach` or beside `Selection validation`); `docs/architecture.md` § Reconciliation and the round of runs, where the job size and the time bound each read "(a target)" and the known limit of the time bound says what a workspace that outlasts it gets, with AC10's figures; and `_agent-docs/next-session.md`. Report with them that the words "A target until measured" stand in a comment above `JOB_TIME_BOUND_MS` in `packages/daemon/src/daemon/falsification.ts` and above `MAX_JOB_DEFINITIONS` in `packages/daemon/src/daemon/falsification-plan.ts`, which this ticket does not edit.
- [x] (Support) Lint, typecheck and format: `bun x oxlint` over the new files, `bun run --filter @rt-test/daemon typecheck`, `bun x prettier --check` over the fixture and the new files, and `bun run check:defects`, which must still pass with the fixture in the tree.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `inConsumerCopy`, `linkVitest`, `linkWorkspacePackages`, `fixtureRepository`, `confirmEvery`, `runTempRoot`, `REPO` and the `VitestInstall` type, whose members `vitest` and `vitest-4` are this repository's 5.x and 4.1.x installs (`packages/daemon/test/harness.ts`): a fixture copy in the run's temp root with a Vitest install linked at its root, the workspace packages linked by name, a git repository under the fixture git settings, and the start that confirms every workspace.
- `withDaemons`, `started`, `settled`, `eventually`, `logEntries`, `DAEMON_TEST_TIMEOUT_MS`, `DAEMON_WAIT_MS` (`packages/daemon/test/daemon-harness.ts`): ends every daemon and executor however a body ends, starts a trusted daemon recording its process, and the daemon tests' time bounds (P45 and P46 are covered by `DAEMON_TEST_TIMEOUT_MS`).
- `storedRuns` (`daemon-harness.ts`) as the pattern for reading the store while the daemon runs: `openStore(stateDirectory)`, then a read under `consumerIdentity(root)`, closed in a `finally`. The evidence read is `readLatestResults(scope).evidence` (`packages/daemon/src/store/open-store.ts`), each record a `StoredEvidence` (`packages/daemon/src/store/defect-evidence.ts`) with `evidenceId` ("The identity the store gave the reply this record was stored from"), `defectId`, `vitestVersion` and `verdict`.
- `queryDefects`, `queryWait`, `querySummary` (`@rt-test/daemon/client`, `packages/daemon/src/query-client.ts`). A `defects` answer carries the facts every answer carries (`activity`, `unstoredJobs`, `schedule`, `inputs`), `counts` (`total`, `eligible`, `verified`, `states`, `freshness`) and `definitions`, each with `id`, `state`, `eligible` and, beside a verdict, `evidence` with its `freshness` and `reason` (`packages/daemon/src/query/defects-answer.ts`).
- `DEFECT_STATE` (`packages/daemon/src/defects/defect-states.ts`); `ROUND`, `EXECUTION_STATE`, `WAIT_OUTCOME`, `CURRENT` (`packages/daemon/src/query/answer.ts`); `MAX_JOB_DEFINITIONS` (`packages/daemon/src/daemon/falsification-plan.ts`) and `JOB_TIME_BOUND_MS` (`packages/daemon/src/daemon/falsification.ts`), for AC10's sizes (C95).
- `packages/daemon/test/edit-corpus.ts`, the shape this check follows: `checkSequence`, its `Replay` class, its waits (`#settledWait`, `#idle`, `#isIdle`), its `applyChange` for an exact text replaced once, and `CLEAN`. Read it; import nothing from it and edit nothing in it (§ Design decisions, 7).
- The daemon fixtures' `vitest.config.mjs` files (`test/fixtures/daemon/edit-corpus/packages/lib/vitest.config.mjs`): a config that exports a plain object and imports nothing.

### Must Create

- The fixture under `test/fixtures/daemon/falsification-corpus/` (AC1).
- `packages/daemon/test/falsification-corpus-steps.ts`, the steps and what each declares (AC2, AC4, AC5, AC6).
- `packages/daemon/test/falsification-corpus.ts`, the replay, its readings and the clean report (AC2, AC3, AC6 to AC8). The comparisons and the finding kinds go in `packages/daemon/test/falsification-corpus-findings.ts`, as ticket 2.5's `edit-corpus-findings.ts` holds them: pure functions a test drives over hand-built readings are a responsibility apart from the replay (P16).
- The tree reading and the mutation search of AC7 (§ Design decisions, 7).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The sprint's entry, `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.7: "3.7 measures the milestone's acceptance." It builds on tickets 3.1 to 3.5b, all on main, and holds with ticket 3.6's gate in place or absent (§ Pending siblings). No test before it starts a real daemon that falsifies (ticket 3.6's § Tests this change may break: "No test starts a real daemon that falsifies"): the lifecycle's tests script their executor, and the job's tests call the job alone.

This ticket changes no production file. Dev builds the fixture, the steps and the check; create-tests writes `packages/daemon/test/falsification-corpus.test.ts` (a new file under P42: of the files under `packages/daemon/test` and `packages/cli/test` that start a real daemon, by `git grep -l -E "started\(|trustedStart\(|withDaemonConsumer\(|startDaemon\("` at 732bf343, which are `cli.test.ts`, `daemon-harness.ts`, `daemon.test.ts`, `edit-corpus.ts` and `job-tree.test.ts`, none writes an `rt-test.json` with a `defects` member; `daemon.test.ts` calls `queryDefects` in D3706 alone, for the request it sends) with a record for each test in `packages/daemon/test/defects.json`. The suite's load is on watch (orchestrator, 15:53 on 2026-10-01), so the tests keep one replay for each Vitest line for the whole file, as `falsifiedOn` in `packages/daemon/test/falsify/falsify-workspace.test.ts` keeps one job for each install, and each test asserts one reading of it: the corpus then costs two daemon lives in a suite run however many tests read them. Each finding kind wants a proof in which it fires alone, by a product mutation or over hand-built readings, which is why the comparisons are pure functions: ticket 2.5's review found two detectors that no proof reached but beside another finding (its Review Record, § Test Coverage Gaps).

#### What the criteria rest on

`docs/roadmap.md` § M2, Acceptance: "a weakened assertion retires earlier evidence; setup failure cannot count as a detection; a moved anchor is reported as anchor missing while the other defects run; consumer files never change; duplicate test names cannot misattribute a detection. Query verified and eligible counts." And its opening: "Each milestone's acceptance runs on synthetic fixtures committed in this repository."

Requirements (`docs/requirements.md`):

- "NFR6: Leave every consumer file byte-identical through falsification, writing no mutation anywhere on disk." (AC7)
- "NFR7: Credit no detection to a setup, collection, compile, timeout, unhandled, or unrelated failure, across the canary fixtures and the falsification corpus on every supported Vitest line." (AC2, AC4, AC6)
- "FR11: Decide each falsification verdict from run facts (failure phase, error kind, whether the intended test reached the step that holds the mutation, the baseline result), counting as a detection only an assertion failure in the intended test after it reached that step, repeated in a confirming run." (AC4)
- "FR12: Read defect definitions committed at a configurable location in the consumer repository, attribute evidence by stable test identity including each `it.each` arm, and keep evidence in the local state directory." (AC1, AC4)
- "FR13: Report a defect whose mutation anchor is missing as anchor missing, count it in the denominator, and withhold verified while the other defects still run." (AC4, AC5)
- "FR15: Mark defect evidence stale when its test, mutation, inputs, or execution configuration change, keep it across a daemon restart, and re-verify it at lower priority than ordinary tests." (AC3, AC4, AC6)
- "FR22: Answer a `defects` query through the CLI with versioned `--json` output, giving each defect definition's evidence state, its freshness and reason, the verified, eligible and total counts, and the gaps, without starting a test." (AC5)
- "FR24: Report a defect definition that cannot be applied as written as invalid, naming why (an unreadable file, a repeated id, a test not discovered or named ambiguously, a mutation that changes nothing, a file outside the consumer root), count it in the denominator, and withhold verified." (AC1, AC4)

The sprint entry names NFR6 and NFR7, whose markers already list this ticket. The other requirements are delivered by the tickets their markers name; this ticket replays them and adds no marker.

How this ticket reads NFR7's "across the canary fixtures and the falsification corpus": no detection is credited falsely in either set, on either line. It does not ask that each set hold each failure kind. The canary set holds every kind NFR7 lists and is read on both lines in every gate; the corpus holds the setup failure the acceptance names and carries its verdict through the store, the answer and the verified count, which the canary set's tests do not reach. Once ticket 3.6 lands, every replay's daemon also takes the canary reading under its own install before it falsifies.

Rule clauses:

- `docs/testing.md` § Selection validation: "Keep negative controls where unrelated changes should retain evidence." (AC6, step 1)
- `docs/testing.md` § Performance validation: "Report cold and warm measurements separately. Include runner-only baselines, hardware, OS, runtime versions, file/test counts, and the edit class." And: "Keep repeatable benchmarks out of correctness tests where machine timing would cause flakes. Never label provisional budgets as achieved measurements." (AC9, AC10)
- AGENTS.md § Tests and validation: "Keep performance targets labeled as targets until measured. Record hardware, runtime, project size, and warm/cold state with benchmarks." (AC10)
- AGENTS.md § Product guarantees: "Never inject defects into a consumer's working tree. Use isolated snapshots or isolated transforms." (AC7) And: "Never report historical results as current after a relevant edit or unresolved input change." (AC4, step 2)
- ADR-0007, as `_agent-docs/sprints/sprint-3-falsification.md` states it: "Evidence freshness has workspace granularity (ADR-0007): an edit anywhere in a workspace's inputs stales every defect in it, and M3's file-level dependencies narrow that." (AC6)
- ADR-0009: "Each definition has an `id`, unique across every file; the `defect`, the wrong behavior in plain language; the `required` behavior it breaks, in plain language or as a requirement reference; the `test`, as its module's root-relative path, its name path (each enclosing suite's name, then the test's, with an `it.each` arm named by its reported title), and, only where the module alone cannot tell, its Vitest project and its occurrence among tests sharing that name path; and the `mutation`, as a root-relative `file` with the exact `old` text and its `new` replacement." (AC1)
- `docs/architecture.md` § Defects query: "A definition is eligible when it is neither invalid nor anchor missing and its resolved test holds a current pass in the answer's own test standings, whatever its evidence. Verified counts the definitions that read detected with evidence freshness current". And: "More than one match is invalid as ambiguous and resolves to none of them". And: "`occurrence` counts from 0". And: "Invalid wins over anchor missing, and both win over any stored evidence." (AC4, AC5)
- `docs/architecture.md` § Reconciliation and the round of runs: "A defect is waiting when its standing reads it eligible and its evidence does not read current." And: "A definition of a job that ran to its end is not taken again until the input revision changes, whether or not it got a verdict". And: "A falsification job stores no run and no discovery ... its workspace's execution state reads idle throughout." (AC3: a workspace reads idle while it is falsified, so the wait and the idle workspaces alone do not show that falsification has finished; the activity and the waiting definitions do.)
- ADR-0007, in its own words: "An experiment's evidence is bound to the definition's digest (its id, test identity and mutation, with the assertion error names the consumer declares), a digest of the mutation file's text as the job read it, the workspace's input fingerprint the experiment ran at (the one its ordinary results use), the Vitest version, the falsifier version and the Vitest adapter version; a change to any of them makes it stale." And: "Evidence freshness has workspace granularity, so any change to a workspace's inputs stales every defect in it until file-level dependencies (M3) narrow it." (AC6)
- `docs/architecture.md` § Workspace fingerprints and narrowed inputs: "Each discovered workspace's inputs are the inputs whose selection, by `selectTests` over the dependency information built at the current input revision, includes it, and every test module and env file the discovery lists for it". And § Test selection and its known limits: "each path selects the deepest package workspace holding it and every workspace that depends on it, each through one shortest chain of edges and widenings." So a file of the library, a test module of it included, is an input of the app, and step 2's edit stales the app's evidence; a file of the app is no input of the library, and step 1's leaves the library's current. (AC6)
- The judge, `readRun` in `packages/daemon/src/falsify/verdict.ts`: an intended test whose state in the experiment's run is neither passed nor failed, or that the run does not hold, reads `test-not-run`; one that passed or failed has its hook states read next, and a hook whose state is not passed reads `hook-not-passed`. A test whose `beforeEach` fails an assertion is a failed test, so the setup hook's definition reads `hook-not-passed`, which the spike's answers carried with the detail `{"hook":"beforeEach","state":"run"}`. (AC4)
- `docs/architecture.md` § Defects query: "Evidence freshness is a field of its own, present only beside a verdict". So a definition that reads anchor missing or invalid definition carries no evidence in the answer, whatever record the store keeps for it. (AC4)
- `docs/architecture.md` § Falsification jobs, the judge's reasons: "Invalid experiment, the first that holds: `no-probe-site`, `no-module`, `baseline-not-passed`, `baseline-not-clean`, `restored-baseline-not-passed`, `restored-baseline-not-clean`, `run-not-clean`, `module-failed`, `suite-error`, `test-not-run`, `hook-not-passed`". (AC4)

Glossary (`docs/glossary.md`), verbatim:

- **Waiting defect**: "An eligible defect whose evidence is missing or not current, which the daemon falsifies when no ordinary job is due."
- **Eligible defect**: "A defect whose definition is valid, whose anchor matches, and whose test holds a current pass, so it can be falsified now."
- **Verified**: "Every defect definition in scope has current evidence that its test detects it."
- **Anchor missing**: "The state of a defect whose mutation no longer matches the code it names."
- **Invalid definition**: "A defect definition RT Test cannot apply as written, such as one naming no discovered test, or a test it shares a name with."
- **Invalid experiment**: "An experiment whose run cannot say whether the test rejects the mutation, such as one whose test failed in a hook or never reached the step that holds the mutation."
- **Evidence freshness**: "Whether a defect's evidence still describes its definition, its mutation's file, its workspace's inputs and the versions it was produced under."
- **Edit corpus**: "The committed synthetic consumer and the sequences of changes saved to it, each replayed against RT Test's own daemon beside a full run by plain Vitest, over which duplicate execution and selection misses are measured."
- **Canary job**: "The one executor job a canary reading takes. It runs the canary fixtures as a falsification job runs a workspace's waiting defects, and is no workspace's falsification job."

The owner's words that bind the design. 03:25 on 2026-09-30: "I only want you to elevate to me if a design decision that is truly broken needs my attention. I'm not terribly interested in chasing edge cases right now. this is tooling for fleet cooling and others going forward". 04:12 on 2026-10-01: "I think the catalog should go. I like asking the simpler question." 04:43: "the deciding factor on whether we should address it is look at Fleet Cooling's codebase. Would this edge case come up in it? If not leave it." 06:29: "i don't mind letting you make design decisions, I just want to avoid the over engineering branch that happened earlier". The orchestrator's reading of them for this ticket (15:53 on 2026-10-01): a corpus proves the milestone's acceptance as the roadmap words it and no more; for a case beyond it, cover it when Fleet Cooling's codebase would meet it, otherwise leave it and say so in one sentence.

#### Fixture shape

A design for dev, who may change names and contents while keeping the criteria. Create-ticket's spike ran this shape (§ Settled facts).

- Root: `package.json` (`private`, `type` `module`, `workspaces: ["packages/*"]`), `rt-test.json` (`{ "defects": ["packages/*/named-defects.json"] }`).
- `packages/lib` (the library): `package.json` with `exports` naming `./src/index.mjs`; `src/price.mjs` with a discount, a rate and a label function, and `src/index.mjs` re-exporting it; `test/price.test.mjs` with a test asserting the discount in its body, a suite whose `beforeEach` asserts the rate and whose test passes whatever the rate is below 1, and a test asserting the label; `named-defects.json` with one definition for each test: the discount's (step 2 weakens its assertion), the rate's, whose mutation fails the hook's assertion, and the label's.
- `packages/app` (the app, depending on the library): `src/cart.mjs` with a total that calls the library's discount, imported by package name, and a receipt line; `test/cart.test.mjs` with two suites of one name, each holding one test of one name, the first asserting the total and the second calling it and asserting nothing of it, and a test asserting the receipt; `named-defects.json` with these definitions: the total's mutation naming occurrence 0, the same mutation naming occurrence 1, the same mutation naming no occurrence, and the receipt's, whose anchor step 1 rewrites.

The harness writes nothing into the fixture; it links `node_modules/vitest` to the replay's install and `node_modules/<name>` to each package in the copy.

#### Declared readings

As create-ticket's spike read them on both lines (§ Settled facts), named as the fixture shape above names its definitions. They are for comparison: the steps file derives each from the clauses quoted above.

| Definition                 | Baseline                                                             | After step 1                                                                      | After step 2                 |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------- |
| library, discount          | detected, eligible, current; falsified                               | as before; record kept                                                            | survived, current; falsified |
| library, rate (setup hook) | invalid experiment (`hook-not-passed`), eligible, current; falsified | as before; record kept                                                            | as before; falsified         |
| library, label             | detected, eligible, current; falsified                               | as before; record kept                                                            | as before; falsified         |
| app, total, occurrence 0   | detected, eligible, current; falsified                               | as before; falsified                                                              | as before; falsified         |
| app, total, occurrence 1   | survived, eligible, current; falsified                               | as before; falsified                                                              | as before; falsified         |
| app, total, no occurrence  | invalid definition, not eligible, no evidence                        | as before                                                                         | as before                    |
| app, receipt (anchor)      | detected, eligible, current; falsified                               | anchor missing, not eligible, no evidence in the answer; record kept in the store | as after step 1              |

Counts read: total 7 at every step; eligible 6, then 5, then 5; verified 4, then 3, then 2; detected 4, 3, 2; survived 1, 1, 2; invalid experiment 1 throughout; invalid definition 1 throughout; anchor missing 0, 1, 1; never verified and unclear 0 throughout.

#### Settled facts

Settled by create-ticket on 2026-10-01, on main at 732bf343, which does not hold ticket 3.6. Three scratch test files under `_agent-docs/.scratch/t3-7-create/`, each run through the run lease as `bun x vitest run --config _agent-docs/.scratch/t3-7-create/vitest.config.ts <file>` (a config whose global setup is `packages/daemon/test/temp-root.ts`), each exit 0, on Windows 11, a Ryzen 7 8700F with 16 logical cores and 32 GB, Node 24.19.0, with no other leased run. Each wrote its consumer into a temp directory, started a real daemon through `started` inside `withDaemons`, and read `queryDefects`, the store and the daemon's log. The scratch files and their logs stay until the orchestrator closes the lane.

- **A real daemon falsifies end to end on both lines** (`spike.test.ts`, 16:00, 3 tests passed, 68.3 s). Two workspaces of five eligible definitions each, on Vitest 4.1.11 and on 5.0.1, and one consumer whose workspaces link the two installs apart: every definition read as its design intends, and a job of 5 definitions took 2.9 to 3.4 s by the log.
- **A dependent is falsified again and an unrelated workspace is not** (`spike2.test.ts`, 16:06, 2 tests passed, 75.4 s). After an edit to the library's source and test, the log read "changed path packages/lib/test/price.test.mjs, owned by packages/lib, selected packages/app (changed-path from packages/lib through packages/app by manifest", ran the library and the app, and falsified both; two workspaces that import neither got no job.
- **The measured job, one run each, so not yet AC10's figures.** In the same run, a workspace of 25 definitions in 5 test modules of 5 tests, each a one-line function its test asserts, every definition detected (so 50 experiment runs and two baselines): "falsification ended: packages/many, it ran to its end; verdicts stored: 25 detected; left without a verdict 0; 15365 ms" on Vitest 4.1.11 and 14463 ms on 5.0.1. A workspace of one definition: 1314 ms and 1017 ms. From one job's end entry to the next job's start entry: 47 to 63 ms in most gaps, 224 and 279 ms in the slowest two, at 7 to 33 definitions.
- **The steps of AC2 read as § Declared readings says, on both lines** (`spike3.test.ts`, 16:09, 2 tests passed, 57.0 s for both replays; 25.4 s on Vitest 4.1.11 and 29.8 s on 5.0.1 from before the start to the last settled reading). After step 1 the log read "selected 3 of 6 tests and 1 of 2 workspaces" and one job, "falsification started: packages/app, definitions 2"; the library's three evidence records kept the `evidenceId` the baseline stored, and the app's two eligible definitions took a new one. After step 2, an edit to the library's test alone, it read "selected 6 of 6 tests and 2 of 2 workspaces" and falsified the app's 2 and the library's 3. Every evidence record carried `vitestVersion` 4.1.11 in one replay and 5.0.1 in the other. The rewritten anchor's stored record stayed in the store, under its baseline `evidenceId`, while its definition read anchor missing.
- **Settling as AC3 words it was reached at every step of every replay**: `queryWait` answered settled each time (the fixture declares no non-input, so the baseline's wait is not superseded as the edit corpus's is), and polling `queryDefects` until the activity read idle, no change was unread and no listed definition was eligible without current evidence ended each time inside the bound. The spikes did not read the round or the workspaces' states; the edit corpus's `#isIdle` does, and AC3 asks for both.
- **A file named `defects.json` under `test/` is read as this repository's records.** `readRecords` in `scripts/lib/defects/catalog.mjs` filters the sandbox's files by `/(^|\/)defects\.json$/` and maps over each parsed value, and `SANDBOX_DIRS` holds `test`, so a definition file of that name, an object with a `defects` member, would make the catalog throw. The spikes named theirs `named-defects.json`.
- **Fleet Cooling would meet the two fixture shapes the corpus adds for the acceptance, tests sharing a name and an assertion in a setup hook** (read-only, at its 31fdbac4, `_agent-docs/.scratch/t3-7-create/fleet-facts.mjs` over the 991 files `git ls-files '*.test.ts' '*.test.tsx'` lists): 75 files repeat a test title within the file, 140 titles in all, by a line pattern over `it(` and `test(` titles that does not read the enclosing suites, so it bounds the files in which two tests can share a name path from above; 284 files hold a `beforeEach` or `beforeAll`, and in 42 of them an `expect(` stands within 600 characters of the first one. Its five workspaces declare `vitest` `^4.1.11`.

#### Design decisions (scope of analysis: what the corpus replays, what it reads and when, and what it measures; how a test file consumes it and which mutation proves each finding kind are the tests session's; the Fleet Cooling trial's own measurements are unanalyzed)

Each stands with doing nothing and one coarser rule beside it. The author's, reported to the orchestrator (threadId e6fd9ca0-a25f-4b3a-bd24-c2e62c99acab) at 16:12 on 2026-10-01.

1. **One daemon life for each Vitest line, over one fixture.** One consumer whose two workspaces link the two installs apart ran in the spike and would prove both lines in one life, but with ticket 3.6's gate that one life takes two canary jobs inside one test's timeout, estimated at 27 to 37 s on Windows as twice ticket 3.5b's figure for one, which with a replay's 25 to 30 s passes AC9's bound, and each acceptance case would have to stand in both workspaces. Two lives pay the same two canary jobs, one under each test's timeout. Fleet Cooling's workspaces resolve one install. A replay for each case would pay a start, a baseline and a canary job each time.
2. **Two workspaces, the app depending on the library, and two steps.** Do nothing, one burst of both edits in one workspace, reads the acceptance's states and counts and cannot tell a daemon that left a dependent's evidence reading current from one that verified it again, nor one that falsified an unrelated workspace again from one that left it. Step 1 edits the app, so the library is the control `docs/testing.md` asks for; step 2 edits the library, so the app is the dependent. Fleet Cooling meets both every day: its `packages/lib` is under `packages/convex` and both apps, and its two apps do not depend on each other. A third, unrelated workspace would give the control in one step at 5 more fixture files and a baseline job more.
3. **Which definitions were falsified is read from the store's evidence records.** Do nothing, reading states alone, passes a dependent that kept a stale detection reading current. Counting the log's job entries would also work until a canary job's entries, worded by ticket 3.6, are counted as a workspace's. The store's record changes with each job's reply and a canary job stores none.
4. **Settled means no definition is waiting.** A wait and idle workspaces, as the edit corpus settles, are both true while a workspace is being falsified. A fixed number of idle entries in the log would tie the check to the log's wording. The fixture holds no definition that gets no verdict, so none stays waiting; one that did would be a not-settled finding, which is the reading wanted.
5. **Counts are declared as numbers.** Computing them from the declared states would compare the answer's arithmetic with a copy of itself (C73).
6. **AC10's runs stay outside the suite and commit nothing.** A job of `MAX_JOB_DEFINITIONS` definitions costs about 15 s a line and a job that reaches `JOB_TIME_BOUND_MS` costs that bound in real time. `JOB_TIME_BOUND_MS` is a constant a real daemon cannot be handed another value of, and a seam for one would edit `daemon/falsification.ts`, `daemon/lifecycle.ts` and `daemon/daemon-main.ts`, the files ticket 3.6 is building in. The lifecycle's tests already pin the bound under a faked clock (`docs/testing.md` § Falsification jobs, mutation transforms and reach: "D4070 pins the bound by advancing the faked clock 599,999 ms, which aborts nothing, and then 1 ms more, which does"). A committed measurement helper that no suite test calls would be code nothing runs; ticket 2.5's AC10 measured through a stand-in that was deleted. A later measurement rebuilds the stand-in from the sizes, the test's duration and the edits between jobs that the Completion Notes record.
7. **The corpus takes its own reading of the tree.** `treeLines` and `entryLine` in `packages/daemon/test/falsify/canaries.test.ts` build the same reading and are private to that test file. Sharing them means editing that file, which ticket 3.6's tests session may be adding to in its own tree, and proving its records again (`_agent-docs/crew.md` § Gates). The corpus's reading skips several directories where that one skips one. The second copy is debt for the next ticket that edits `falsify/canaries.test.ts`; record it under the Dev Handoff. The edit corpus's `applyChange` and its waits are private to `edit-corpus.ts` in the same way, and this ticket edits that file no more than the other: the corpus writes its exact text replacement new, a few lines, and its settle new, since AC3 reads other things than the edit corpus's does. Not analyzed: what sharing either would cost in records proved again.

Left out, one sentence each. A restart, across which FR15 keeps evidence: ticket 3.4's store tests hold it, the acceptance paragraph does not name it, and with ticket 3.6 a second life costs a second canary job. An `it.each` arm: FR12 names it, the acceptance names duplicate names, and ticket 3.1's resolver tests hold the arm. The other five failure kinds NFR7 lists (collection, compile, timeout, unhandled, unrelated): the canary set reads each on both lines in every gate (`packages/daemon/canaries/canaries.json`: `module-load-throw`, `unparsed-mutation`, `timeout`, `leaked-rejection`, `site-called-by-another-test`), and once ticket 3.6 lands every replay's daemon takes that reading under its own install before it falsifies, so a replay that settles has read them; the corpus adds the setup failure the acceptance names, through the store and the answer. A consumer mixing Vitest lines: Fleet Cooling has one install. Counts scoped to a path, and the gaps: the acceptance asks for the verified and eligible counts. The OS temp directory: ticket 3.2's records search it at the job (`docs/testing.md` § Falsification jobs, mutation transforms and reach), and AC7 searches the consumer copy and its state directory.

#### Grill

Create-ticket, 16:18 to 16:20 on 2026-10-01; each settled from a rule, a doc or the code, so none went to the orchestrator. (1) AC3's settle cannot be true before the daemon has seen a step's edit: the wait binds to the revision that holds the edit and settles once the ordinary results are current there, at which point the evidence bound to the earlier fingerprint reads stale, so its definitions are waiting. (2) A wait that answers superseded is a not-settled finding, since nothing but a step changes an input. (3) `.git` is left out of AC7's byte comparison, as the inputs leave it out (§ Known limits). (4) The tree comparison and the mutation search each prove they looked (C60). (5) AC1 no longer asks that every test have a definition, which no criterion read. (6) AC10 (a) counts jobs, since one daemon life can give several. (7) In AC10 (c) the job is in an experiment when the bound passes because the job runs its baseline's modules side by side and each experiment alone (`docs/architecture.md` § Falsification jobs: "It forces isolation per test file and turns `bail` off in every project"; the committed `falsify` fixture sets `fileParallelism: false`, "which the job must override", `docs/testing.md`); the dev confirms the baseline's length in the run itself.

#### Known limits

- The corpus's definitions all get a verdict, so it does not replay a definition left without one, a job an input change ended, or a refused workspace; the lifecycle's tests hold those over a scripted executor.
- AC4 reads the state of the definition that names no occurrence and not why it is invalid: the reason is a sentence, ticket 3.1's resolver records pin it, and the acceptance's clause, that a detection is not misattributed, is read from the second occurrence's survived.
- The store and the log are expected to hold no definition's `new` text, which AC7's search rests on: the sprint's § Ticket 3.4 has the evidence "holding no source text", `docs/architecture.md` § Falsification jobs has the facts hold "states, kinds, names and counts, and never an error's message, its stack or source text", and ticket 3.5's AC8 has "A reason never holds a definition's `old` or `new` text." The spikes did not search for it; the first task does, before the comparisons are built.
- A daemon that falsified a workspace twice in one step reads the same as one that did it once: the record is replaced either way. The corpus sees a definition falsified that should not have been, and one not falsified that should have been.
- AC7 reads the tree when each step has settled, so a file written and restored between two readings is not seen; ticket 3.2's records watch the job's own writes.
- AC7's byte comparison leaves out `.git`, as the inputs do (`docs/architecture.md` § What counts as an input: "The inputs are every file under the consumer root except `.git`, `node_modules`, the daemon's state directory and log file"), and `node_modules`, where a run makes its documented writes. Whether a git query the daemon makes rewrites a file under `.git` was not checked. The daemon's log lies in the state directory (`daemonLogFile(stateDirectory, ...)` in `packages/daemon/src/client.ts`). The search for a mutation's text covers all three.
- AC10's figures are of a consumer written for the measurement (C177): they give the job's cost where loading and baselines are small, and the Fleet Cooling trial reads them at a consumer's size.

#### Ticket review

One review agent, ticket-internal, returned 23 edits and 6 questions at 16:30 on 2026-10-01 (F1 to F29). Every edit was applied, three in other words than the reviewer's, and every question was settled from the code, the docs or the spike's output, which the reviewer does not read; none went to the orchestrator.

- F1, AC9's split: removed. A second daemon life would start from a baseline no criterion declares, so a replay over the bound goes to the orchestrator with its figure.
- F6, the permission to export a helper from `edit-corpus.ts`: removed, so dev modifies no file (§ Design decisions, 7).
- F11, AC7: `node_modules` is left out at any depth, and the first task runs both readings over a settled baseline, since the spikes did not; what the store and the log are expected to hold is quoted under § Known limits.
- F12: a `new` text holds nothing JSON escapes, so the search's own control finds it in its definition file.
- F13: the clauses the app's step 2 set and `hook-not-passed` rest on are now quoted (§ What the criteria rest on), read in ADR-0007, `docs/architecture.md` and `packages/daemon/src/falsify/verdict.ts`.
- F18, what an anchor-missing definition's evidence reads: none in the answer, by § Defects query's "present only beside a verdict" and the spike's answers.
- F19, FR24's "naming why": AC4 reads the state alone (§ Known limits).
- F23: the comparisons have a file of their own as a responsibility apart from the replay, not for a line count (P16); the sizing counts it.
- F25: the search behind P42's claim is named (§ Where this sits).
- F28, two lanes writing `packages/daemon/test/defects.json`: each lane's ids come from a range the orchestrator allocates at its tests dispatch (P26), so no id is taken twice, and the file's merge is the orchestrator's; this lane merges main in once ticket 3.6 has landed (§ Pending siblings).
- F29, the empty metadata block: filled at the finalize step.

#### Sanity check

From the dev (rt-t3-7-dev, threadId b2352b23-a4b3-4f25-847b-43463c614e75) at 16:40 on 2026-10-01, answered at 16:41. F1, confirmed: the task asked for a finding AC8's kinds did not place, and the findings task now names it as consumer file changed. F2, stands: the replay's deadline is derived from `DAEMON_TEST_TIMEOUT_MS`, `STOP_DEADLINE_MS` and `RESPONSE_BOUND_MS`, about 85 s, and each poll is raced against what is left of it, which is AC3's "one deadline that falls before the test's own timeout". F3, stands: the Execution Metadata lists every file the ticket's stages write, the tests session's two among them, as ticket 2.5's did (§ Where this sits).

#### Time and the suite's load

The suite's load is on watch: the edit corpus went red once at a gate on a load timeout (D3466) and green on its rerun (orchestrator, 16:13 on 2026-10-01). A replay's test runs under `DAEMON_TEST_TIMEOUT_MS`, 120 s, the longest timeout a test here may declare (`test/scripts/longest-test-timeout.mjs`). Measured without ticket 3.6's gate, a replay took 25.4 s and 29.8 s on an idle Windows machine (§ Settled facts); with the gate's one canary job it is estimated at 39 to 48 s, which leaves 72 to 81 s under the timeout and 12 to 21 s under AC9's bound of half of it. The estimate is not AC9's figure. Under a loaded gate a replay runs slower than that by a factor nobody has measured, so the check ends by its own deadline first (AC3): a not-settled finding names what the daemon was still doing, where a test timeout names nothing. What the harness itself waits for, a daemon's start and its stop in `withDaemons`, keeps its own bounds (`DAEMON_WAIT_MS`).

In the suite the corpus costs two daemon lives, one for each line, however many tests read them (§ Where this sits): measured at 57.0 s of one worker for both on Windows without the gate, estimated at 84 to 94 s with it; Linux is unmeasured.

#### Orchestrator rulings

- **Q1, the look's read** (asked by `session_wake` at 16:12 on 2026-10-01, answered at 16:13; decider the orchestrator, threadId e6fd9ca0-a25f-4b3a-bd24-c2e62c99acab; no owner sentence is involved). The sprint entry asked this ticket to "measure a look's read of the definition files against the number of definitions". `docs/architecture.md` § Defects query holds that read measured: "reading the definition files, checking the definitions, reading each mutation's file, resolving, rating and counting take 233 ms (455) for 1,000 definitions ... 292 ms (499) for 3,327 definitions ... and, for 10,820 definitions ... 1,773 ms (2,852)", with "Every query pays this read whole, as does every look of the falsification schedule" and "Not measured: Linux, a cold file cache, the query end to end through a running daemon". The options were (a) no new large measurement, recording the time between two jobs inside a running daemon at the measured consumer's size and setting § Defects query's figures beside the measured job; (b) rebuilding the large generated repository and measuring the read again on Linux and through a daemon; (c) leaving it to the Fleet Cooling trial. Ruled: "(a), your recommendation. No new large measurement. The sentence in the sprint entry came from ticket 3.5's review before the read was measured ... (b) builds a generator for figures the trial gives for free; (c) leaves the sprint's sentence unanswered where one cheap figure answers it." AC10 (b) is that figure, and the dev sends the doc sentence that sets § Defects query's figures beside the measured job.
- From the same message, unasked: this ticket builds in Tree 2 beside ticket 3.6 while its File List names none of 3.6's files (§ Pending siblings); ticket 3.6 lands first, so AC9 is measured on the merged tree and the ticket says who measures it; the dev tells the orchestrator before each long measurement run; the author's design choices and what the corpus leaves out "stand as yours"; the private `treeLines` copy is accepted as a debt note the orchestrator carries; and the two production comments reading "A target until measured" wait for whoever next opens those files, the doc's "(a target)" being the orchestrator's at the docs step from the dev's measured text.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 3.7` over `packages/daemon/test/falsification-corpus.ts`, `falsification-corpus-steps.ts`, `falsification-corpus.test.ts`, `packages/daemon/test/defects.json`, `packages/daemon/test/harness.ts`, `packages/daemon/test/daemon-harness.ts`, `test/fixtures/daemon/falsification-corpus`, `test/fixtures/daemon`, `packages/daemon/src/query-client.ts`, `packages/daemon/src/client.ts` and `packages/daemon/src/query/defects-answer.ts` (16:07 on 2026-10-01) named ticket 3.6 alone.

- **3.6** (ready for dev, building in Tree 1 on `wt/1`): by its ticket and the orchestrator's message of 16:13 on 2026-10-01, it writes `packages/daemon/src/daemon/falsification.ts`, `daemon/lifecycle.ts`, `daemon/daemon-main.ts` and `vitest/load-vitest.ts`, creates `daemon/canary-gate.ts`, and for its tests takes `packages/daemon/test/lifecycle.test.ts`, `packages/daemon/test/scheduling-harness.ts`, `packages/daemon/test/load-vitest.test.ts`, `packages/daemon/test/defects.json` and one file for the gate's own tests, perhaps `packages/daemon/test/falsify/canaries.test.ts`; it reads `harness.ts` and `daemon-harness.ts` for helpers and writes neither. This ticket writes `packages/daemon/test/defects.json` beside it and no other file of that list, and calls nothing of `vitest/load-vitest.ts`, so it builds beside it. Ticket 3.6 lands first: this lane merges main in before it lands, and from then a replay's daemon takes one canary job, since both workspaces resolve one install, before its first falsification job. What of ticket 3.6 the corpus rests on, as its ticket states them:
  - Its AC6: "A canary job stores no run, no discovery and no evidence, and moves no input revision wherever the state directory lies. Neither it nor a reading changes a test's state or freshness, a definition's state, eligibility or evidence freshness, a count of any answer, whether a query answers, or a workspace's execution state". So AC4's states, AC5's counts and AC6's falsified sets read the same with the gate as without.
  - Its AC5: "While a canary job runs, the daemon's activity reads falsifying, with the workspace the look picked and 0 as the number of its definitions in the job". So AC3's settle waits through a canary job, during which the definitions it precedes are still waiting.
  - Its AC1: "The daemon sends a workspace's falsification job only while it holds a confirmed reading of that workspace's Vitest install". The corpus's installs are this repository's `vitest` and `vitest-4`, whose readings `packages/daemon/test/falsify/canaries.test.ts` takes in every gate. An install whose reading disagreed, or gave none, would leave every definition never verified and read as AC3's not-settled finding, which is a true red.
  - Its cost: "one canary job through a real `Executor` took 13.5 to 18.6 s on Windows ... and 7.6 to 8.3 s on Linux" (its § What a reading costs, from ticket 3.5b's spike). That is why AC9 measures with the gate in the tree. Estimated from it and the spike: 39 to 48 s for a replay on Windows.
  - The reading's directory lies in the state directory while a canary job runs (ticket 3.5b), outside what AC7 compares; AC7's search looks for the corpus's own `new` texts, which no canary file holds.
  - Sequencing: this ticket's build may begin before ticket 3.6 lands, and until its tree holds the gate it sees a daemon that sends a workspace's job with no canary job ahead of it. Every criterion but AC9 reads the same on either tree; AC9's figure is taken on the merged one, and its task says who takes it.
- **3.8** (backlog) converts this repository's own records into definition files and retires the bootstrap verifier; it names none of this ticket's files. Until it lands, the fixture's definition files must not be named `defects.json` (§ Settled facts).
- M3's acceptance (`docs/roadmap.md`): "falsification re-verifies only the defects an edit can affect". AC6's declared sets are the workspace-level ones M3 narrows.

#### Sizing

Raw 18 files: the fixture (13 new files of one repeated per-workspace shape: manifest, config, source, test, definition file, with the library's index), `falsification-corpus.ts`, `falsification-corpus-findings.ts` and `falsification-corpus-steps.ts` (new), and for create-tests `falsification-corpus.test.ts` (new) and `packages/daemon/test/defects.json`; 24 estimated (18 times 1.3 is 23.4). Sized on the decision-bearing files, 5 raw and 7 estimated (6.5), with the fixture a separate figure of 13. Code units 9: AC1 to AC8 and validation; AC9 and AC10 are measurements. One dependency chain (fixture, steps, check), so the 10-file figure applies and holds. Under every limit; reported to the orchestrator at 16:12 on 2026-10-01 at 16 raw, before the library's index file and the findings file were counted.

#### Current structure of the modified files

Dev modifies none: every file dev writes is new. `packages/daemon/test/defects.json` is the tests session's.

#### Existing tests this change breaks

None. `bun run check:defects` reads the fixture's tree, which is why no fixture file is named `defects.json`.

#### Doc text

The orchestrator writes these (reported at the authoring commit):

- `docs/glossary.md`, § Falsification, after **Canary job**: **Falsification corpus**: "The committed synthetic consumer with its defect definitions and the steps saved to it, replayed against RT Test's own daemon on each supported Vitest line, over which the milestone's falsification acceptance is checked." _Avoid_: mutation corpus, defect benchmark
- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.7: the scope line as the finished ticket has it, and the link to this file.

Dev and the tests session report the text of `docs/testing.md` and `docs/architecture.md` with their work (the task above).

#### Previous ticket

3.6 (ready for dev, not built): its Dev Notes are quoted under § Pending siblings. `git log --oneline -3` on main: 732bf343 "docs: ticket 3.6, the canary gate, ready for dev", 75bf2712 "Merge wt/2: the daemon schedules falsification (ticket 3.5)", b41ae817 "docs: the daemon schedules falsification, and ticket 3.5 done". Ticket 3.5's Review Record gave this ticket its two measurements: "A job the time bound ends stores nothing of the experiments that ran. Its reply has no restored baseline, so each such experiment is judged no verdict. A workspace whose 25 experiments outlast the bound therefore stores no verdict of a run at all, and each job marks whichever definition was running. Fleet Cooling's scoped runs of 2.3 to 3.2 s are far inside the bound; ticket 3.7 measures it." And its design decision 9: "The schedule pays the same read, with every mutation file's anchor count, once for each look, so once for each job, unmeasured here; ticket 3.7 measures it beside the two targets."

### References

- `_agent-docs/sprints/sprint-3-falsification.md`, the objective and § Ticket 3.7, § Ticket 3.5, § Ticket 3.6.
- `docs/roadmap.md` § M2; `docs/requirements.md`; `docs/glossary.md` § Falsification.
- `docs/architecture.md` § Falsification jobs, § Defects query, § Reconciliation and the round of runs; `docs/testing.md` § Selection validation, § Performance validation, § Edit corpus, § Falsification jobs, mutation transforms and reach.
- `docs/adr/0007-reused-instance-per-falsification-job.md`, `docs/adr/0008-detection-from-task-facts-and-canaries.md`, `docs/adr/0009-defect-definition-files.md`.
- `_agent-docs/tickets/2-5-edit-corpus.md`, the shape this ticket follows, with its AC10, its Review Record and its timings; `_agent-docs/tickets/3-5-schedule-falsification.md`, its design decisions, Known limits and Review Record; `_agent-docs/tickets/3-6-canary-gate.md`; `_agent-docs/tickets/3-4-defect-evidence.md`, whose review names this corpus as the first test of the standings' lookups by workspace.
- GitHub issues: none open (`node scripts/list-open-issues.mjs`, 16:00 on 2026-10-01: "0 open issues, complete").

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C7,C12,C13,C14,C30,C32,C49,C52,C60,C68,C72,C73,C74,C82,C85,C93,C95,C106,C118,C125,C135,C138,C139,C141,C156,C177 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P4,P10,P11,P13,P16,P21,P22,P23,P24,P26,P27,P28,P31,P35,P36,P38,P40,P42,P45,P46 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area:
  - packages/daemon
  - test
is_consolidation: false
sizing_ac_count: 9
files_to_modify:
  - packages/daemon/test/defects.json
files_to_create:
  - packages/daemon/test/falsification-corpus.ts
  - packages/daemon/test/falsification-corpus-findings.ts
  - packages/daemon/test/falsification-corpus-steps.ts
  - packages/daemon/test/falsification-corpus.test.ts
  - test/fixtures/daemon/falsification-corpus/package.json
  - test/fixtures/daemon/falsification-corpus/rt-test.json
  - test/fixtures/daemon/falsification-corpus/packages/lib/package.json
  - test/fixtures/daemon/falsification-corpus/packages/lib/vitest.config.mjs
  - test/fixtures/daemon/falsification-corpus/packages/lib/src/index.mjs
  - test/fixtures/daemon/falsification-corpus/packages/lib/src/price.mjs
  - test/fixtures/daemon/falsification-corpus/packages/lib/test/price.test.mjs
  - test/fixtures/daemon/falsification-corpus/packages/lib/named-defects.json
  - test/fixtures/daemon/falsification-corpus/packages/app/package.json
  - test/fixtures/daemon/falsification-corpus/packages/app/vitest.config.mjs
  - test/fixtures/daemon/falsification-corpus/packages/app/src/cart.mjs
  - test/fixtures/daemon/falsification-corpus/packages/app/test/cart.test.mjs
  - test/fixtures/daemon/falsification-corpus/packages/app/named-defects.json
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId b2352b23-a4b3-4f25-847b-43463c614e75

What the tests session calls: `replayCorpus(install)` and `CLEAN` from `packages/daemon/test/falsification-corpus.ts` (one replay for a `VitestInstall`, resolving with `CLEAN` or `{ install, findings }`), the comparisons and `FINDING` from `falsification-corpus-findings.ts`, each a pure function over hand-built readings (`stateFindings`, `countFindings`, `falsifiedFindings`, `versionFindings`, `treeFindings`, `mutationTextFindings`, `isSettled`, `waitingDefinitions`, `notSettledFinding`), and the steps from `falsification-corpus-steps.ts` (`BASELINE`, `ANCHOR_REWRITTEN`, `ASSERTION_WEAKENED`, `CORPUS_STEPS`). The replay's deadline is `REPLAY_DEADLINE_MS`, 85 s, counted from the copy, so a test that awaits a replay runs under `DAEMON_TEST_TIMEOUT_MS`.

Debt carried by the orchestrator (§ Design decisions, 7): the corpus keeps its own tree reading (`entriesUnder`, `treeEntries`) beside `treeLines` in `packages/daemon/test/falsify/canaries.test.ts`, and its own exact text replacement (`applyChange`) beside the one in `edit-corpus.ts`.

From the orchestrator at 17:58 on 2026-10-01, for the tests session: on the tree that holds ticket 3.6 the replay is the first real daemon to take a real canary reading through `daemon-main.ts`'s wiring. It shows that `falsify` is handed as a bound call (an unbound one leaves every reading a no reading and the replay not settled). It does not show that the gate shares the run Executor, which no test shows; that is a recorded limit of ticket 3.6, not something to build a test for.

#### Test Files This Change Broke

None.

#### ACs Owed a Test

- AC2: the corpus runs in the ordinary suite, so the gate runs it on Windows and on Linux. Dev wrote no test file. Guarantee for `packages/daemon/test/falsification-corpus.test.ts`: a replay on Vitest 4.1 and one on Vitest 5 each return `CLEAN`. Everything else of AC2 was observed through the stand-in (Completion Notes § AC9).
- AC3: two parts no run of dev's reached. (a) A step that does not settle within the bound is a finding naming the step, the waiting definitions, the activity and each job ended with nothing stored, and ends the replay: every replay settled, so the path was read only through `isSettled` and `notSettledFinding` over hand-built readings. (b) The settle holds with a canary job ahead of a workspace's first falsification job: this tree does not hold ticket 3.6's gate.
- AC9: owed on the tree that holds ticket 3.6's gate, which the orchestrator merges in after this stage's commit. The figure belongs to the tests member, from the test file's own run, written under the Tests Record. Taken WITHOUT the gate, so not AC9's figure: 30.2 s (Vitest 4.1.11) and 26.6 s (5.0.1) on Windows, 15.7 s and 14.6 s on Linux, against the bound of 60 s. A replay over 60 s on Windows goes to the orchestrator with its figure and is not shortened or split.

#### Tests Owed

Defects met while building that earn a test, each driven over hand-built readings unless it says otherwise:

- Each of the ten finding kinds firing alone, which the ticket already asks for (§ Where this sits). The cases dev's probe read are under Completion Notes § Acceptance evidence.
- `treeFindings`: an edited file that holds other bytes than the step wrote is reported. Defect: the comparison accepts any difference in a file the step edited, so a daemon that damaged it after the edit passes. From the adversarial review.
- `falsifiedFindings`: a record the store held before a step and holds no more, for a definition the step does not declare falsified, is reported. Defect: only records present after the step are compared, so lost evidence of a definition that is not eligible is invisible. From the adversarial review.
- `mutationTextFindings`: it throws when a definition's `new` text is not in its own definition file among the files read. Defect: a search that read nothing returns no finding.
- The settle's hold (`SETTLE_HOLD_MS` in `falsification-corpus.ts`), through a replay and a product mutation: a daemon that begins a job over definitions whose evidence reads current, after the declared jobs of step 1, comes back as falsified outside the declared set at step 1. Defect: a step taken as settled on one answer read between two jobs, so the undeclared job's evidence is absorbed as step 2's. From the adversarial review, sized by AC10 (b)'s slowest look of 321 ms.

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

Dev stage, rt-t3-7-dev (threadId b2352b23-a4b3-4f25-847b-43463c614e75), 2026-10-01, 16:35 to 18:05, in Tree 2 on `wt/2` at fd9e606f, which does not hold ticket 3.6's gate. No production file was edited, and no file beyond the ticket's list.

#### What was built

- The fixture, 13 files under `test/fixtures/daemon/falsification-corpus/`: a library and an app that imports it by package name, seven definitions in two `named-defects.json` files, both listed by path in `rt-test.json`. The ids are `lib-discount`, `lib-rate-setup`, `lib-label`, `app-total-first`, `app-total-second`, `app-total-unnamed` and `app-receipt`. The setup hook's assertion sits in a helper the `beforeEach` calls, since `vitest(no-standalone-expect)` rejects an `expect` written inline in a hook.
- `falsification-corpus-steps.ts`: the baseline and two steps, each with every definition's declared reading, the counts as numbers and the definitions declared falsified, derived from the clauses under § What the criteria rest on. They equal § Declared readings. The reason `hook-not-passed` is a literal typed by the production union `VerdictReason`, since the object that holds it in `falsify/verdict.ts` is not exported.
- `falsification-corpus-findings.ts`: the ten finding kinds and the comparisons as pure functions.
- `falsification-corpus.ts`: `replayCorpus`, `CLEAN`, `REPLAY_DEADLINE_MS` and the readings.

#### Sanity check and assumptions

Sent to the author at 16:39, answered at 16:42 (§ Sanity check). F1: the kind of an edited file that reads unchanged; confirmed, and the author updated the findings task. F2: the deadline, 120 s less `STOP_DEADLINE_MS` (25 s) less `RESPONSE_BOUND_MS` (10 s), 85 s, derived from the constants; stands. F3: the Execution Metadata lists the tests session's two files; stands, dev wrote neither. No unverified assumption had a row to resolve.

#### First task

Each name under § Reuse exists as the ticket uses it. `git log --oneline -5` at 16:36 showed no merge of ticket 3.6. AC7's two readings, taken at 16:47 through the run lease (exit 0, 2 passed, 54.9 s) over a consumer of the fixture's shape on Vitest 4.1.11 and 5.0.1, after the baseline and after each step: the tree outside `.git`, `node_modules` and the state directory differed from the reading before only in the step's own file; and a search of every regular file under the copy (37 files, the store, its WAL, the log and `.git` among them; three links not followed) found no definition's `new` text outside the definition files, the control finding all five texts in them. No run wrote a Vitest cache or a `node_modules` directory into a workspace. No product finding.

#### Choices that are dev's, all in the check's code

- A defects query is asked every 200 ms (`SETTLE_POLL_MS`), not without pause, since each reads every definition file.
- A step is settled once the answers have read settled for 400 ms (`SETTLE_HOLD_MS`). Between two jobs the daemon reads idle for the length of a look, 321 ms at the slowest measured (AC10 (b)), so one settled answer could fall between a declared job and an undeclared one.
- A file a step edited must hold the bytes the step wrote, by digest, which also covers an edited file that reads as before the edit.
- The names the tree comparison leaves out are the check's own constant, not the daemon's skip list.
- A not-settled finding takes its one defects answer inside the room the deadline leaves for an answer still in flight, and a query that fails there adds its failure to the finding's cause.

#### Adversarial review

One agent over the 16 created files, 17:13 to 17:23, returned 10 findings and found no path on which a skipped or unjudged step returns `CLEAN`. Fixed: F1 (an edited file only had to differ), F2 (two late answers could stack past the deadline), F3 (a job begun with nothing waiting could be absorbed by the next step), F5 (a failing diagnostic query lost the wait's own cause), F7 (a lost evidence record of a definition that is not eligible was invisible), F9 (the comparison borrowed the daemon's skip list). Discarded F4: AC8's kinds are closed and no criterion reads `unstoredJobs` of a settled answer. Discarded F6: AC4 reads the reason and not its detail. Discarded F8: it needs a listing bug that the count comparison already reads. Discarded F10: 37 files and half a megabyte a step, and no throw was observed. Post-fix lint and typecheck: exit 0.

#### Gates, on the final tree

`bun x oxlint` over the three files and the fixture, exit 0 (18:01). `bun x prettier --check` over them and this ticket, exit 0 (18:01). `bun run --filter @rt-test/daemon typecheck`, a whole-workspace compile, exit 0 (17:36, the last code edit). `bun run check:defects`, exit 0, 3366 records (18:01). `node scripts/check-line-citations.mjs`: nothing to check. The repo-wide `bun run check` is the orchestrator's.

#### Acceptance evidence

- AC1: the 13 files; each `old` matches once in its file and each `new` occurs only in its own definition file, with no double quote, backslash or line break (a scratch check over the fixture, exit 0). Every test passes unmutated and writes nothing: each replay's baseline read six definitions eligible, which needs a current pass of each named test, and its tree comparison found no difference.
- AC2: the stand-in replayed the corpus on both lines on both platforms, three times each, all clean, each in a copy under the run's temp root that `withDaemons` ended with no process left. The suite part is owed (Dev Handoff).
- AC3: every replay settled at all three steps and read the declared states, which a comparison taken before the daemon finished would not. The not-settled path and the canary job are owed (Dev Handoff).
- AC4 to AC7: the clean replays, beside a probe that drove each comparison over hand-built readings (17:26): clean on a reading as declared, and one finding each for a setup hook read detected, evidence read stale, a definition not declared, one not listed, a count off by one, a state the step does not declare, a library definition falsified at step 1, a declared definition not falsified, a lost record, a record under another Vitest version, another file changed, a file added, an edited file reading as before the edit or holding other bytes, and a `new` text in a store file. The search threw when its control file was absent.
- AC8: `replayCorpus` resolves with `CLEAN` or with the findings by kind, each naming its step and subject; the stand-in asserted a whole replay with one `expect` and no hook. A failed copy, a start that confirms other workspaces, a daemon that does not start, a step whose text does not match once, and a failed query or store read each throw.

#### AC9, measured without the gate

Not AC9's figure. Each replay's wall time through a stand-in test body, on an idle machine through the run lease, both replays in one file and one worker:

| Run                                 | Windows 4.1.11 | Windows 5.0.1 | Windows file | Linux 4.1.11 | Linux 5.0.1 | Linux file |
| ----------------------------------- | -------------- | ------------- | ------------ | ------------ | ----------- | ---------- |
| 17:09, before the review's fixes    | 30.0 s         | 24.2 s        | 55.7 s       | 14.3 s       | 14.1 s      | 29.1 s     |
| 17:27, after them                   | 29.8 s         | 23.4 s        | 54.7 s       | 14.5 s       | 14.2 s      | 29.5 s     |
| 17:45, the final code with the hold | 30.2 s         | 26.6 s        | 59.0 s       | 15.7 s       | 14.6 s      | 31.2 s     |

So the corpus costs a suite run about 59 s of one worker on Windows and 31 s on Linux on a tree without the gate. On the tree that holds it each replay adds one canary job, which this stage did not measure.

#### AC10, measured outside the suite

Machine: AMD Ryzen 7 8700F, 8 cores and 16 logical; Windows 11 Pro 10.0.26200 with 32 GB; Ubuntu 24.04.4 under WSL2 (kernel 6.6.87.2) with 16 logical cores and 15 GB. Node 24.19.0 on both. Vitest 4.1.11 and 5.0.1. The file cache was warm; a cold figure was not taken. Each run held the run lease alone. The tree did not hold ticket 3.6's gate, so no canary job stands in any figure.

(a) and (b), the consumer: two workspaces. `many` holds 5 test modules of 5 tests, 25 tests and 25 definitions; `one` holds 1 module, 1 test and 1 definition. Each test asserts a one-line function and each definition is detected (26 of 26 verified at the end of every run). One daemon life on each line: the baseline, then 5 edits, each appending a comment line to `src/m0.mjs` of both workspaces, so each size gave the life's first job and 5 later ones. Wall time is the figure in the log's `falsification ended` entry.

| Figure                                    | Windows 4.1.11 | Windows 5.0.1 | Linux 4.1.11 | Linux 5.0.1 |
| ----------------------------------------- | -------------- | ------------- | ------------ | ----------- |
| Job of 25, 5 later jobs, median           | 13,133 ms      | 10,172 ms     | 6,934 ms     | 6,130 ms    |
| Job of 25, 5 later jobs, slowest          | 16,999 ms      | 11,642 ms     | 7,264 ms     | 6,501 ms    |
| Job of 25, the life's first               | 14,567 ms      | 10,009 ms     | 6,789 ms     | 6,750 ms    |
| Job of one, 5 later jobs, median          | 1,645 ms       | 1,336 ms      | 844 ms       | 786 ms      |
| Job of one, 5 later jobs, slowest         | 2,000 ms       | 1,639 ms      | 884 ms       | 796 ms      |
| Job of one, the life's first              | 1,263 ms       | 1,072 ms      | 779 ms       | 837 ms      |
| Between two jobs, 6 gaps, median          | 53 ms          | 56 ms         | 15 ms        | 15 ms       |
| Between two jobs, 6 gaps, slowest         | 308 ms         | 321 ms        | 18 ms        | 22 ms       |
| Plain Vitest CLI over `many`, 5 runs, med | 923 ms         | 785 ms        | 487 ms       | 390 ms      |
| Plain Vitest CLI over `many`, slowest     | 1,310 ms       | 1,136 ms      | 518 ms       | 401 ms      |

Between two jobs is the time from the end entry of the job of 25 to the start entry of the job of one that followed it with no entry between, at 26 definitions in two definition files. The plain Vitest figure is `node node_modules/vitest/vitest.mjs run` from the workspace's directory, after the daemon had stopped.

(c), Vitest 4.1.11, one workspace of 25 definitions, one to a test module, whose one test waits 13 s before its assertion (`testTimeout` 60 s), so each detected definition's two runs take 26 s:

| Reading                                               | Windows                                                                  | Linux                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| The workspace's ordinary run, 25 modules side by side | 27.7 s                                                                   | 25.7 s                        |
| The job's end                                         | the time bound, at 600,049 ms                                            | the time bound, at 600,037 ms |
| Verdicts stored                                       | none                                                                     | none                          |
| Definitions through both runs, left unstored          | 21 (`restored-baseline-unrecorded`)                                      | 21                            |
| The definition marked                                 | `slow-21-0`, in its confirming run                                       | `slow-21-0`                   |
| Definitions never begun                               | 3 (`interrupted`)                                                        | 3                             |
| The `defects` answer                                  | 25 never verified, 25 eligible, 0 verified                               | the same                      |
| Its jobs ended with nothing stored                    | one, the falsification of the workspace, naming `slow-21-0 (time-bound)` | the same                      |
| The next job                                          | 348 ms later, 24 definitions, from the first again                       | 22 ms later, 24 definitions   |
| The stand-in's run                                    | 648.8 s                                                                  | 631.3 s                       |

What the measured consumer does not hold: no setup file, no hook, no import across workspaces, and modules of a few lines. The figures say nothing of a consumer's load time or of a baseline over real modules. A later measurement rebuilds the stand-in from these sizes, the 13 s test and the edits between jobs.

#### README

No user-visible behavior changed, so no README line moves. Its "(a target)" beside the 25 definitions and the 10 minutes is in the doc text sent to the orchestrator, with a recommendation to keep it.

#### Change-request candidates

- A fork, not a defect: a job the time bound ends discards the verdicts of every definition that had finished, 21 of 25 in (c), and the next job starts them again. Recommendation: leave it. `docs/architecture.md` records it as a known limit, and Fleet Cooling's scoped runs of 2.3 to 3.2 s are far inside the bound.
- An observation for whoever next reads the tracker: in (c)'s Windows log the watcher reported lost events once, 5.6 s after the start, at 54 inputs; the daemon reconciled, discarded the dependency build in progress and went on. It did not recur in the other runs.

#### Stand-ins and logs

The stand-in test bodies under `_agent-docs/.scratch/t3-7-dev/` are deleted. Their logs and result files stay there until the orchestrator closes the lane, with the doc text in `doc-text.md`. The Linux runs used the lane's own WSL clone, `~/rt-test-t3-7`, at fd9e606f with this stage's files copied in.

### File List

- `_agent-docs/tickets/3-7-falsification-corpus.md` (created by create-ticket, rt-t3-7-create, 2026-10-01; the sprint file's scope line, the status transition and the glossary entry were sent to the orchestrator as text, which writes them)

Created by dev (rt-t3-7-dev, 2026-10-01):

- `packages/daemon/test/falsification-corpus.ts`
- `packages/daemon/test/falsification-corpus-findings.ts`
- `packages/daemon/test/falsification-corpus-steps.ts`
- `test/fixtures/daemon/falsification-corpus/package.json`
- `test/fixtures/daemon/falsification-corpus/rt-test.json`
- `test/fixtures/daemon/falsification-corpus/packages/lib/package.json`
- `test/fixtures/daemon/falsification-corpus/packages/lib/vitest.config.mjs`
- `test/fixtures/daemon/falsification-corpus/packages/lib/src/index.mjs`
- `test/fixtures/daemon/falsification-corpus/packages/lib/src/price.mjs`
- `test/fixtures/daemon/falsification-corpus/packages/lib/test/price.test.mjs`
- `test/fixtures/daemon/falsification-corpus/packages/lib/named-defects.json`
- `test/fixtures/daemon/falsification-corpus/packages/app/package.json`
- `test/fixtures/daemon/falsification-corpus/packages/app/vitest.config.mjs`
- `test/fixtures/daemon/falsification-corpus/packages/app/src/cart.mjs`
- `test/fixtures/daemon/falsification-corpus/packages/app/test/cart.test.mjs`
- `test/fixtures/daemon/falsification-corpus/packages/app/named-defects.json`

Modified by dev: this ticket file only (task and criterion boxes, the Dev Handoff, the Completion Notes and this list). No dependency changed.

# Ticket 2.3f: Schedule runs of what is not current

## Ticket

As an agent editing a consumer the daemon serves,
I want the daemon to run every workspace an edit left without current results, rediscovering first when the tests may have changed, and to run nothing that still holds current results,
so that I never run tests myself, a restart costs no rerun, and a result an edit touched is replaced by a fresh one without anyone asking.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: Once the first reconciliation has ended, and again after each change of the input revision, the daemon runs each confirmed workspace the discovery in effect lists whose latest stored run is not bound to that workspace's current input fingerprint: stored under another digest, stored not fingerprinted, stored under another adapter version, or not stored at all, or its current fingerprint cannot be computed (the watcher is unhealthy, the input set cannot be established). Apart from AC5's retry, it runs no workspace whose latest stored run is bound to its current fingerprint, whatever that run's test outcomes, errors or execution. A run whose status is `failed` holds no test result, so AC5's retry of one runs no test that holds a current result (C154, NFR1). So a restart over results that read current runs no workspace, and a run stored not fingerprinted because a stop interrupted it runs again at the next start. A run stored not fingerprinted because an input changed or an event named one while it ran is run again from the inputs current once the input revision has settled: always when the change moved the revision, and once, by AC2's exception, when it did not.
- [x] AC2: Discoveries and runs run one at a time (2.3g's dependency builds run in their own executor), and a workspace waits in the queue at most once. Each confirmed workspace is run at most once for one input revision and one list of test modules the discovery in effect gives it, apart from AC5's retry, so a workspace whose run cannot be stored under a fingerprint (while the input set cannot be established, while the watcher is unhealthy, or when the run ended with nothing stored) is not run again until the revision or that list changes. The one exception: a run stored not fingerprinted because its inputs changed or an event named one while it ran, at a revision the change did not move (a save of identical bytes), is run once more at that revision, and if that run is also stored not fingerprinted the workspace is held until the revision or the list changes, and the log says so. After a stop, no discovery or run starts.
- [x] AC3: No discovery or run starts until the input revision has held still for `QUIET_WINDOW_MS` (1,000 ms, a target until measured) and the lifecycle's wait for 2.3g's dependency build at that revision has released: the build ended, finished, failed or timed out, none can begin (the dependency builds stopped working, the tracker cannot vouch for its inputs, or the discovery yields no selection input), or a second build in a row was discarded while it waited (2.3g's 17:42 and 18:03 rulings); ticket 2.3j bounds a build that never ends. A burst of input changes, each less than the quiet window after the one before, leads to one round of work that begins after the last of them and reads the inputs they leave.
- [x] AC4: Whenever the discovery in effect is not current at a settled revision (none stored, or stored under another digest, not fingerprinted, or under another adapter version, or no current fingerprint over every input can be computed), the daemon discovers every confirmed workspace again before any due run, protects and stores that discovery as the start does today, and takes each due run from it. A test module added where a workspace's test include patterns match, or a test added to an existing module, is then discovered, run, and counted in every answer. The discovery is attempted at most once for one input revision, apart from AC5's retry.
- [x] AC5: At each periodic reconciliation, at most once per reconciliation, the daemon retries what failed with no input change to blame: it discovers again while the discovery in effect lists a workspace whose status is `failed`, or while the last discovery attempted ended with nothing stored, and it runs a workspace again while its latest stored run's status is `failed`, or while its last run attempted ended with nothing stored (its executor process died or could not start) and it is still due by AC1. No other trigger retries them before the next change of the input revision.
- [x] AC7: Within a round, the due workspaces run in this order: first each direct target, a workspace that is the owner (the deepest package workspace holding it) of a path that changed since the previous round; then each workspace whose latest stored run holds a test with a `failed` or `error` outcome; then the rest; each group in the discovery's workspace order. A workspace due only as invalidated, never run, stale from an earlier life or a retry is a direct target only through a changed path. A round with no selection (AC6), and the first round after a start, which has no previous round to diff against, have no direct targets. The order changes no outcome and no freshness.
- [x] AC6: Each round of due runs that follows a change of the input revision is logged with its selection over every path whose input digest changed, appeared or disappeared since the previous round: for each changed path, the workspaces it selected or why it selected none; each broad fallback with the input or uncertainty that triggered it; and the selected and total test and workspace counts, saying when they are incomplete. Each due workspace is logged with why it is due, and a selected workspace that holds current results is logged as not run for that reason. When no selection can be made, because 2.3g's build failed or timed out, the dependency builds stopped working, the discovery yields no selection input, selection refused the change, or no build ended at the round's revision (the build wait released without one), the round is logged at warning level with that reason and every workspace AC1 finds due still runs.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It schedules the executor's existing discovery and run jobs, and calls `selectTests` in the daemon's own process over 2.3g's dependency information.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Before the first edit, re-read the landed code of ticket 2.3g at 5b0a006 (`daemon/dependency-builds.ts`'s `DependencyBuilds` with `use`, `start`, `narrowing`, `pending`, `discards`, `ended` and `stop`; `lifecycle.ts`'s `#awaitBuild`, `DISCARDS_A_RUN_WAITS_THROUGH`, `#runInputs` and `LifecycleParts.buildExecutor`; `TrackedInputs.changed()` and `current(narrowing?)`; `inputs/narrowed-inputs.ts`'s `Narrowing`, `NarrowingState` and `narrowingAt`; `inputs/queued-reads.ts`; and `InputsNotNarrowed` in `query/answer.ts`), ticket 2.3j's bound on the build, ticket 2.3e (`selection/selection-input.ts`) and ticket 2.3d (`selection/select-tests.ts`, `selection/selection-types.ts`), and confirm the names this ticket uses (§ Pending siblings and their routing). Check `lifecycle.ts`'s line count after 2.3g: the scheduling this ticket adds goes into a module of its own, never into `lifecycle.ts` (P16, P18).
- [x] (AC1, AC2, AC3) Create `packages/daemon/src/daemon/scheduler.ts`, which the lifecycle owns: after the first reconciliation, and again whenever the input revision changes or AC5's trigger fires, it waits out the quiet window (`QUIET_WINDOW_MS`, named, labeled a target, C3), then the tracker's `settled()`, then the lifecycle's build wait (`#awaitBuild`, which waits on `DependencyBuilds.pending()` and `ended()` through at most `DISCARDS_A_RUN_WAITS_THROUGH` discards), and goes round again while the revision moved during those waits. It learns of a change through `TrackedInputs.changed()`, which resolves at the next revision move, reconciliation end, drained read batch, protection walk end or stop, and reads the revision where it begins (C160). When the discovery in effect yields no selection input, there is no build to wait for (2.3g AC4, 2.3e AC2), and `pending()` is already false. It then plans one round: rediscover when `discoveryFreshness` rates the discovery in effect not `current` against the current fingerprint over every input (C8), at most once per input revision apart from AC5's retry, recording each attempt; after a rediscovery, which hands the builds the new discovery (`DependencyBuilds.use`, as `#startSequence` does at `writeDiscovery`), wait again through the build wait before selecting; then queue each due workspace in AC7's order, each once, skipping any already run at this revision and list of test modules (AC2) unless AC2's one exception applies, and run them one at a time through the lifecycle's existing job path. After each job it plans again from the state then current, so a revision that moved during a run queues what it left due. A plan at an unchanged revision continues the current round; a plan at a moved revision begins a new round after the waits above, and its changed paths (AC6) are diffed against the snapshot the previous round read. The quiet window is its only timer, and a stop clears it. After each wait (the window, `settled()`, the build) and before each job, it checks for a stop with no await between that check and the job's start (C160), so nothing starts after a stop (AC2). The lifecycle passes the window's length in, so a test can shorten it; `daemon-main.ts` passes the constant (P19: a value, not a mode).
- [x] (AC1) Decide "due" with the freshness the answers already compute, never a second comparison (C8): `discoveryFreshness(stored, currentFingerprint)` in `query/test-states.ts` rates any stored record (`StoredBasis`, a run or a discovery) against a current fingerprint; export it under a name that says so, and call it for the latest stored run with the workspace's current fingerprint. A workspace is due exactly when that rating is not `current`, which includes a current fingerprint that cannot be computed (the rating is then `unknown`); AC5's retry is the one other way a run is queued. A workspace with no stored run is due. Update `query/summary.ts`, the one other importer, to the new name.
- [x] (AC2) In `packages/daemon/src/inputs/input-jobs.ts`, let a `JobVerdict` that is not fingerprinted say whether its window named a change while the job ran (the `its inputs changed while it ran` case), apart from an unsettled start or an unavailable fingerprint at its end, so the scheduler can apply AC2's one exception to that case only; the reason text stays as today. Ticket 2.3h later splits a window's paths from its causes; this ticket needs only the verdict's kind.
- [x] (AC1, AC4) In `packages/daemon/src/daemon/lifecycle.ts`, replace `#startSequence`'s discover-then-run-each-once with the scheduler: `begin` starts it; the discovery step (`executor.discover`, `#protectDiscovered`, `#bindings`, `writeDiscovery`, and handing 2.3g's builds the new discovery) and the run step (`#run`) stay the lifecycle's, each called by the scheduler. The discovery in effect is the latest stored one (`readLatestResults`), read at each plan, so a rediscovery that failed to store leaves the previous one in effect. Rewrite the class doc comment ("discovers once, runs each confirmed workspace once, then idles", C46) and write the idle log entry, whose text begins `idle:`, each time a round leaves nothing queued; the harness constant `IDLE_ENTRY` names it (§ Existing tests this change breaks).
- [x] (AC5) Give the scheduler a signal that a periodic reconciliation has ended, the smallest one the tracker can give (`input-tracker.ts` `#reconcileWhileRequested` ends each reconciliation; `ReconcileSchedule` names the periodic one's reason). At that signal, allow one more discovery or run of what AC5 names, even at an unchanged revision and list of test modules, and nothing else (C37: a run whose failure is a deterministic outcome, such as a failed test or a module that failed to load, is not `failed` and is never retried). "Ended with nothing stored" is the lifecycle's `#nothingStored` path for a job whose `JobOutcome` did not end (`ended: false`), which the scheduler records per workspace and for the discovery; a store write that failed is also nothing stored.
- [x] (AC7) Order each round's queue as AC7 says, taking the direct targets from the `owner` of each `ChangedPathReport` in AC6's selection (`selection/selection-types.ts`) and the prior failures from each latest stored run's recorded test outcomes; keep the sort stable over the discovery's workspace order, and name each group's reason as a constant (C3). Record the order the queue ran in the log, one entry per job as today, so a test reads the sequence rather than timing it.
- [x] (AC6) At each round after a change of the input revision, take the paths whose digest changed, appeared or disappeared between the committed input snapshot the previous round read and the one this round reads (`ProjectInputs.digests`, `inputs/fingerprint.ts`); `TrackedInputs` does not expose it at 5b0a006 (only `current(narrowing?)` closes over it), so add the smallest read of it. Select those paths through a method this ticket adds to `Narrowing` (`inputs/narrowed-inputs.ts`), which holds the build's selection input and dependency information privately, so one owner selects over them (C8): the round's build is the latest ended build in `DependencyBuilds.narrowing().state` at the round's revision, and there is none once `narrowing().buildsEnded` is set, and log its explanation (C129, C128): the per-path reports, the broad fallbacks, the counts and whether they are complete. Log each due workspace's reason as a named constant (C3), and each workspace the selection picked that holds current results as not run, with that reason. A refused selection (`SELECTION_STATE.refused`, which a root-relative change should never draw) is logged as no selection, with its reason. When no build narrows the round's revision, log why at warning level (C32), taking the kind from 2.3g's `inputsNotNarrowed` (`DEPENDENCY_BUILD_FAILED`, `NO_SELECTION_INPUT`, `SELECTION_REFUSED`, and 2.3j's two kinds) or naming the released wait, and run AC1's due set. The round after a start has no previous snapshot: log each due workspace's reason only.
- [x] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [x] (Support) Lint and typecheck: `bun x oxlint` over the changed files, and `bun run --filter @rt-test/daemon typecheck`, which reports each stand-in the shapes break (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `DaemonLifecycle` `#run`, `#protectDiscovered`, `#bindings`, `#store`, `#nothingStored` (`daemon/lifecycle.ts`): the job path the scheduler calls. A job's verdict, fingerprint and storage are unchanged by this ticket.
- `discoveryFreshness`, `StoredBasis` (`query/test-states.ts`): the one rating of a stored record against a current fingerprint; AC1's due rule and AC4's rediscovery rule are that rating (C8).
- `confirmedEntry` (`vitest/confirmed-start.ts`): which listed workspaces the start confirmed.
- `TrackedInputs.settled`, `beginJob`, `endJob`, `current` (`inputs/input-tracker.ts`): when work may begin, and whether it held still.
- 2.3g's `DependencyBuilds` (`daemon/dependency-builds.ts`: `use`, `narrowing`, `pending`, `ended`, `discards`) and the lifecycle's `#awaitBuild`: the build wait AC3 needs; `Narrowing` (`inputs/narrowed-inputs.ts`), the build whose selection input and dependency information AC6's selection reads.
- `TrackedInputs.changed()` (`inputs/input-tracker.ts`): the change signal the scheduler waits on between rounds.
- `InputsNotNarrowed` and its kinds (`query/answer.ts`): why no build narrows a revision, which AC6's warning names.
- `selectTests` (`selection/select-tests.ts`) and 2.3e's selection-input builder (`selection/selection-input.ts`): AC6's selection and its explanation.
- `ProjectInputs` (`inputs/fingerprint.ts`): a committed snapshot of every input's digest by root-relative path; AC6 diffs two of them.
- `readLatestResults` (`store/open-store.ts`): the discovery in effect and each workspace's latest stored run, read in one transaction.

### Must Create

- `daemon/scheduler.ts`: the quiet window, the plan (rediscover, then the due workspaces), the queue and its per-revision record, AC5's retry and AC6's logged round.
- The tracker's periodic-reconciliation signal (AC5): `changed()` resolves at every reconciliation's end but does not say which one ended.
- A read of the committed input snapshot through `TrackedInputs`, and a method on `Narrowing` that selects a change over its build (AC6).
- A not-fingerprinted `JobVerdict`'s kind, telling a change while the job ran from an unsettled start or an unavailable fingerprint (AC2's exception).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The first of the three tickets the unsplit 2.3f became (orchestrator, 2026-09-28 06:10). This ticket schedules discoveries and runs of what is not current. Ticket 2.3h then judges a run by its workspace's narrowed inputs and interrupts one an edit inside them touched. Ticket 2.3i shows the schedule in every answer. Build order: 2.3d, 2.3e, 2.3g, 2.3f, 2.3h, 2.3i. Until 2.3h lands, a run stays stored not fingerprinted when any input changed while it ran (2.3g Q4), so AC1 reruns it once it ends; until 2.3i lands, answers carry today's `activity` and the log alone explains each round.

Requirements this ticket serves (`docs/requirements.md`):

- "FR8: Execute every selection in the daemon, and record a run whose inputs changed while it ran as invalidated and rerun it from stable inputs." (AC1 to AC7)
- "NFR1: Never execute a test while it holds a current result for the same input fingerprint, except to falsify it or to rerun an invalidated run." (AC1, AC2)

Rule clauses the criteria rest on:

- AGENTS.md § Product guarantees: "Never report historical results as current after a relevant edit or unresolved input change." (AC1, AC4)
- AGENTS.md § Product guarantees: "Explain each selection and each broad fallback. Report selected and total test counts." (AC6)
- AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states. A zero-test selection is not proof of success." (AC1: a run's outcomes do not decide whether it is due)
- `docs/architecture.md` § Execution and falsification isolation: "Debounce edit bursts, prioritize direct targets and prior failures, and never run a test that holds a current result for the same inputs." (AC1, AC3)
- `docs/architecture.md` § Identity and freshness: "If an input changes during a run, do not promote that run to current: record it as invalidated and rerun from stable inputs." (AC1)
- Ticket 2.1 § What 2.3 inherits: "2.3 narrows the seam with the dependency information its selection uses, turns a not-fingerprinted job into its invalidated state, and replaces the start sequence, which today reruns every workspace at start even when its results read current (NFR1 is 2.3's)." (AC1)

Glossary (`docs/glossary.md`), verbatim:

- **Run**: "One execution of a selection by the daemon, under its own run identity."
- **Invalidated run**: "A run whose inputs changed while it ran, so none of its results become current."
- **Duplicate execution**: "Running a test again while it holds a current result for the same input fingerprint."
- **Selection**: "The tests a change requires running, each with its reason."
- **Broad fallback**: "A widening to a whole workspace or project, named with the input that triggered it."
- **Input revision**: "The number naming a worktree's inputs as the daemon last observed them in its current life, raised once for each batch of changes it observes."

#### Orchestrator rulings

Asked by `session_wake` at 06:07 on 2026-09-28, answered at 06:09; decider the orchestrator, holding the owner's calls overnight. Each reason is the orchestrator's.

- Design basis (this ticket's AC1): a workspace is due when its latest stored run is not bound to its current fingerprint, and the rule is per run, so a deterministic failure at the current fingerprint never reruns in a loop.
- Q1 (2.3h's): a path change outside a workspace's narrowed inputs does not invalidate its run when its narrowed fingerprint at the end revision equals the one at its start; a change inside them and every non-path cause still invalidate. The verdict waits for the end revision's build.
- Q2 (2.3h's): a change inside a running workspace's inputs aborts the run at once, stores nothing (a job with nothing stored and its reason), and requeues it; the workspace shows interrupted, then queued. Reason: a stored interrupted run would erase the outcomes the agent is fixing. Starvation under a steady edit stream is a known limit.
- Q3 (AC4): rediscover whenever the discovery in effect is not current at a settled revision, before the due runs. Reason: a cheaper trigger can miss a test whose identity comes from an imported file, and a missing test is invisible to every answer; correctness over speed, the cost a target for 2.5. This ticket rediscovers the whole confirmed start: the stored discovery is one record under one fingerprint over every input, so merging a part rediscovered at one revision with parts from another would store workspaces from different revisions under one digest, with nothing to tell them apart (create-ticket, 06:10). The orchestrator queues rediscovering only the due workspaces as a performance change request.
- Q4 (AC5): retry at the existing periodic reconciliation, at most once per reconciliation, while a discovered workspace or its latest run is `failed`; no new timer and no backoff.
- Q5 (AC3): a 1,000 ms quiet window after the last change of the revision, a named constant labeled a target; a product delay, not a race fix.
- Q6 (2.3i's): every answer carries each workspace's execution state with its queue reason and the latest selection's explanation, in `--json`, the CLI text and the log. This ticket writes the log half (AC6).
- Q7 (2.3i's, moved there from 2.3h at 06:18): the invalidated state lives in memory for the daemon's life, with no schema change.
- G1, from the grill (asked 06:16, answered 06:16; AC5): at the periodic reconciliation only, at most once per reconciliation, also retry a discovery or a run whose last attempt stored nothing (the executor died or could not start). Reason: Q4's aim is that a cause outside the inputs never leaves a workspace stuck until an unrelated edit, and a dead executor is such a cause; AC2 still prevents a loop.
- G2, from the grill (asked 06:16, answered 06:16; AC7): direct targets first (a workspace owning a changed path of the round, as selection names the deepest package workspace holding it), then workspaces whose latest stored run has a `failed` or `error` outcome, then the rest, each group in the discovery's order. Reason: `docs/architecture.md` § Execution says to prioritize direct targets and prior failures, and a three-minute run ahead of the edited workspace is latency an agent pays on every edit. Order changes no outcome and no freshness, so a test proves it from the queue's recorded sequence, never from timing.
- R-F2, from the ticket review (asked 06:21, answered 06:21; AC1, AC2): a run stored not fingerprinted by a change at an unchanged revision (a save of identical bytes) is rerun once at that revision, then held; if the rerun is also stored not fingerprinted, the workspace reads unknown until the next revision, and the log and the known limits name the self-rewriting case. Reason: the common trigger is benign (format-on-save with nothing to change, an agent rewriting a file it just read), and under a strict rule `wait` (2.4) and the hook (2.7) would give the agent no answer after a no-op save; one extra run per revision cannot loop, and nothing reads falsely current. FR8's rerun is therefore: a change that moved the revision always reruns, and one that did not reruns once.
- Ticket review (create-ticket 6c, 06:16 to 06:20): 14 findings, all applied. F1 argued AC5's retry against C154 (a `failed` run holds no test result) and scoped the nothing-stored retry to a workspace still due; F2 became R-F2; F3 added a fingerprint that cannot be computed to AC1's and AC4's lists; F4 gave AC4's rediscovery its rule and once-per-revision record; F5 put a stop check beside each job's start (C160); F6 left 2.3g's builds outside "one at a time"; F7 gave the not-run log line its task; F8 waits for the build over a new discovery before selecting, and for none without a selection input; F9 keyed AC2 on the workspace's listed test modules; F10 widened the sibling scan; F11 found `summary.ts` importing `discoveryFreshness`; F12 corrected the type-change claim; F13 dropped counts beside their lists; F14 defined a round.
- Split (06:10): into 2.3f, 2.3h ("Judge and interrupt a run by its workspace's inputs") and 2.3i ("Show the schedule in every answer"), each under both limits and leaving a working state alone; sprint file granted to this lane at 06:10.

#### Decisions taken here

- **At most once per revision and list of test modules (AC2).** Without it, a run that cannot be stored under a fingerprint (an unhealthy watcher, an input set that cannot be established, an executor that died) leaves its workspace due at once, and the scheduler would rerun it in a loop with no input change. Keying on the test modules the discovery lists for the workspace too lets a rediscovery at an unchanged revision run what its new test modules left due, since each workspace's fingerprint covers them (ticket 2.1 AC11). The key is that list, not the discovery record: AC5 stores a new discovery at each periodic reconciliation while a workspace stays `failed`, and a key on the record would rerun every workspace that cannot be fingerprinted at each of them (review F9, 06:20).
- **The quiet window is timed from the last change of the revision**, not from the last event: an event that changes no digest (the access-time events of ticket 2.3) moves no revision and delays nothing.
- **A prior failure is a test outcome.** AC7's second group reads the latest stored run's recorded test outcomes (`failed`, `error`); a run whose status is `failed` or that stored nothing holds none, so it orders with the rest unless a changed path makes it a direct target.
- **Rediscovery comes before the due runs**, so a run is never counted against a discovery taken at another revision, and 2.3g's build over the new discovery ends before any run is fingerprinted (2.3g AC2, AC3).

#### Design notes

- **Why the due rule and freshness are one decision.** After 2.3g, a path selects workspace W exactly when it lies in W's narrowed inputs, so a change stales W exactly when selection picks W. Freshness adds what a change alone cannot say: never run, stored not fingerprinted, another adapter version, and an environment change after a restart. Deciding "due" by the rating answers already give means the daemon never runs what an answer calls current (NFR1), and never leaves idle what an answer calls stale or unknown for a reason a run can clear.
- **What a run cannot clear.** A workspace whose fingerprint cannot be computed (the watcher is unhealthy, the input set cannot be established) is due, runs once at that revision, and is stored not fingerprinted; AC2 keeps it from running again until the revision or its list of test modules changes, apart from AC2's one exception.
- **Why selection still runs.** AC6's selection explains the round; it decides nothing AC1 does not. A selected workspace that holds current results is not run and is logged so. A due workspace no changed path selected is logged with its own reason.
- **Stop.** A stop aborts the executor and stops the tracker, as today; the scheduler starts nothing after it and clears the quiet window. A run a stop interrupts is stored not fingerprinted, since the tracker's `STOPPED_REASON` makes its verdict unfingerprinted, so AC1 reruns it at the next start.
- **Scope of the analysis.** Analyzed: the start, a change of the input revision, a rediscovery at an unchanged revision, a run stored not fingerprinted, a `failed` workspace or run, a failed build, and a stop. Not analyzed here: judging a run by its narrowed inputs and interrupting it (2.3h), and the answer's schedule fields (2.3i). The cost of a whole rediscovery per round, and of the protection walk each one repeats, is a target for 2.5's corpus to measure, not a promise.

#### Known limits

- **A steady edit stream delays every round.** A new change inside the quiet window restarts it, so a stream of changes less than 1,000 ms apart starts nothing until it pauses.
- **A test that rewrites one of its own inputs with identical bytes** invalidates every run of its workspace with no revision change: AC2's exception reruns it once, and the workspace then reads unknown until the next input change (R-F2).
- **A test whose run moves the input revision reruns without end**: one that rewrites one of its own inputs with different bytes, or creates and deletes a file among them in steps the tracker reads apart, moves the revision each run, so AC1 finds its workspace due again after every run. Owner ruling, 2026-09-29 01:12 ("stop and explain"): a later ticket, after 2.3h, detects a workspace whose runs keep being invalidated only by changes made while it runs, stops rerunning it, marks its results with a reason naming the file, and waits for an outside edit. The daemon-lifecycle fixture writes markers into its own tree during a job, so its tests ignore those markers through git (`withDaemonConsumer`) or declare them non-inputs.
- **Each round rediscovers the whole confirmed start** after any input change, and re-runs 2.3c's protection walk, which reads and hashes every input under the root (2.3c review tech debt).

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3f` over `lifecycle.ts`, `input-tracker.ts`, `input-jobs.ts`, `protocol.ts`, `answer.ts`, `summary.ts`, `answer-text.ts`, `executor.ts`, `scheduler.ts` and `write-run.ts` (06:07), and again over `daemon-main.ts`, `reconcile-schedule.ts` and `test-states.ts` (06:20), named 2.3d, 2.3e and 2.3g, each by folder or by a file it writes or reads; of the second three, only `daemon-main.ts` is named, by 2.3e (reads) and 2.3g (writes the second executor). All three build before this ticket, so each is a shape it builds on, never a collision:

- **2.3g** (done, 5b0a006): `DependencyBuilds`, the lifecycle's `#awaitBuild`, `TrackedInputs.changed()`, `Narrowing` and `inputsNotNarrowed`. This ticket calls them, and writes `narrowed-inputs.ts` (a method on `Narrowing`) and `lifecycle.ts` after it.
- **2.3j** (done, builds before this ticket; orchestrator, 20:41): bounds a dependency build and records a build past its bound, and a builds loop that throws, each as a failure of its own `inputsNotNarrowed` kind. It writes `dependency-builds.ts`, `narrowed-inputs.ts`, `answer.ts` and `answer-text.ts`; this ticket writes `narrowed-inputs.ts` after it. Without it a build that never ends would stall every round.
- Re-run at 20:42 over this ticket's nine production files after 2.3g landed: it named 2.3h, 2.3i, 2.4, 2.4b and 2.4d, each building after this ticket, so each builds on its shapes. 2.4 writes `lifecycle.ts`; 2.4d writes `input-tracker.ts` and `lifecycle.ts`; 2.4b writes `scheduler.ts` and `lifecycle.ts` and reads `narrowed-inputs.ts`, `test-states.ts` and `summary.ts`.
- **2.3e** (done): `buildSelectionInput` in `selection/selection-input.ts`, the selection-input builder AC6's selection reads.
- **2.3d** (done) and **change request #26**: `selectTests`' alias widening, each alias with its project's Vite root, and `SELECTION_POLICY_VERSION` 9 (change requests #35 and #38); this ticket only calls `selectTests`.
- **2.3h and 2.3i** (backlog, split from this ticket): 2.3h writes `input-jobs.ts`, `input-tracker.ts`, `current-inputs.ts`, `executor.ts` and the scheduler after this ticket; 2.3i writes the answer and CLI files and reads the scheduler's state.
- Two change requests land before 2.3g (orchestrator's dispatch): a crashed idle-tracker child counted as a detection (a test-file fix), and a root-relative alias replacement (`/src`) that may add no edge. Neither touches this ticket's files.

#### Sizing

About 14 raw files and 18 estimated, re-counted at 20:41 after 2.3g landed; code units 8 (7 criteria plus validation). Production: `daemon/scheduler.ts` (new), `daemon/lifecycle.ts`, `daemon/daemon-main.ts`, `inputs/input-tracker.ts`, `inputs/reconcile-schedule.ts`, `inputs/input-jobs.ts`, `inputs/narrowed-inputs.ts`, `query/test-states.ts`, `query/summary.ts`. Tests, for create-tests: `lifecycle.test.ts`, `daemon.test.ts`, `input-tracker.test.ts`, `daemon-harness.ts` and `packages/daemon/test/defects.json`. Over 10 estimated, so dev delegates, in two groups on disjoint files: the tracker side (`input-tracker.ts`, `reconcile-schedule.ts`, `input-jobs.ts`) and the scheduling (`scheduler.ts`, `lifecycle.ts`, `daemon-main.ts`, `narrowed-inputs.ts`, `test-states.ts`, `summary.ts`), in that order. The #43 and T7 fold-in measured about 20 raw and 26 estimated with this ticket, so the orchestrator moved it to 2.3j (20:41).

#### Current structure of the modified files

As of 5b0a006, with 2.3e and 2.3g landed.

- `packages/daemon/src/daemon/lifecycle.ts` (421 lines, 360 code lines): `LifecycleParts { identity, scope, start, store, log, executor, buildExecutor, inputs, closeEndpoint }`; the constructor builds `#builds = new DependencyBuilds(...)`, which `begin` starts; `#protectStoredDiscovery` and `writeDiscovery`'s result hand it the discovery (`use`); `begin` calls `#protectStoredDiscovery`, `inputs.start()` and `#startSequence`, then sets activity idle; `#startSequence` waits `firstReconciled` and `settled`, discovers under a job mark, protects (`#protectDiscovered`), stores (`writeDiscovery`), logs, then `#run`s each entry not `not-confirmed`, and logs `idle: every confirmed workspace has run`; `#run` waits `settled` and `#awaitBuild`, opens `beginJob`, takes the workspace's fingerprint through `#runInputs()` (the tracker's view with the builds' narrowing), runs, and stores through `#bindings` and `unmoved`; `#awaitBuild` waits while `builds.pending()`, awaiting `ended()` then `settled()`, and proceeds once `DISCARDS_A_RUN_WAITS_THROUGH` (2) builds in a row were discarded while it waited, logging why; `#stopSequence` stops the builds first (so the tracker's stop cannot spin their rounds), aborts the run executor, stops the tracker, awaits the sequence and then the builds, and closes both executors, the store and the endpoint.
- `packages/daemon/src/inputs/input-tracker.ts` (520 lines, 432 code lines; 2.3g moved the read queue into `inputs/queued-reads.ts`): `#reconcileWhileRequested` ends each reconciliation by marking the first, arming `#schedule.periodic()`, notifying the ledger and calling `#signalChange()`, which resolves every `changed()` waiter; `#commit` signals when the revision moved; `ReconcileSchedule` (`inputs/reconcile-schedule.ts`) arms the periodic one with `PERIODIC_REASON` after `RECONCILE_INTERVAL_MS`.
- `packages/daemon/src/inputs/narrowed-inputs.ts` (227 lines): `EndedBuild`, `NarrowingState`, `QueryNarrowing`, `narrowingAt(query, revision)`, and `Narrowing`, whose private `#input` and `#dependencies` feed one `selectTests` call over every input path (`narrowedSets`); its public methods are `refusal(project)` and `workspaceInputs(project, workspacePath)`.
- `packages/daemon/src/query/test-states.ts`: `discoveryFreshness(stored: StoredBasis, currentFingerprint)` wraps the private `storedFreshness`, stale under another adapter version, unknown when stored not fingerprinted, else `assessFreshness`.
- `packages/daemon/src/daemon/daemon-main.ts`: `serve` builds the tracker and the `DaemonLifecycle`, passing `executor` and `buildExecutor`, two `Executor`s.

#### Existing tests this change breaks

- `packages/daemon/test/daemon-harness.ts`: `IDLE_ENTRY = "idle: every confirmed workspace has run"`, which `lifecycle.test.ts`, `daemon.test.ts`, `job-tree.test.ts` and `packages/cli/test/cli.test.ts` wait for (`rg -n IDLE_ENTRY packages`, 06:11; unchanged at 5b0a006, where the constant sits at `daemon-harness.ts` line 508). `job-tree.test.ts` and `packages/daemon/test/defects.json` are held by the Fixes-tree lane t-bare-waits while this ticket is authored; create-tests coordinates through the orchestrator. The idle entry's text changes (a round leaves nothing queued), so the constant changes; those tests break only if they rely on idle meaning "every workspace ran once".
- `packages/daemon/test/lifecycle.test.ts`: 2.3g's build-wait tests (its stand-in build executor and `DISCARDS_A_RUN_WAITS_THROUGH` cases), which a scheduler calling `#run` must keep passing; tests that expect every confirmed workspace to run at start; a stand-in store whose latest runs are current now runs none. Its stand-ins build `LifecycleParts` by hand and gain the quiet window.
- `packages/daemon/test/daemon.test.ts`: a real daemon over a fixture; a restart over current results now runs nothing, and an edit now runs its workspace again.
- `packages/daemon/test/input-tracker.test.ts`: only if the reconciliation signal or the job verdict's kind changes a shape it calls.
- Importers of `discoveryFreshness` (`rg -n discoveryFreshness packages`, 06:20): only `src/query/summary.ts` imports it, listed to modify; `lifecycle.test.ts` uses the word only as a field name of its own.
- The stand-ins that build `LifecycleParts` by hand fail the typecheck once it gains the quiet window, as does any stand-in building a `JobVerdict`; every other break above is a behavior change, found by the tests failing (P14).

#### Doc text

A draft for the orchestrator, final wording to follow the build.

- `docs/architecture.md`, the `startDaemon` paragraph: "It then opens the store, starts tracking its inputs, waits for the first reconciliation of them to end, discovers the confirmed workspaces, runs each once, stores the discovery and each run under the input fingerprint it started from, or as not fingerprinted when its inputs moved while it ran, and idles until it is stopped." becomes "It then opens the store, starts tracking its inputs, and once the first reconciliation has ended, and after each change of the input revision, waits until the revision has held still for 1,000 ms (a target) and the dependency build at that revision has ended. It then rediscovers every confirmed workspace when the stored discovery is not current, and runs, one at a time, each confirmed workspace whose latest stored run is not bound to its current input fingerprint, each at most once per input revision and list of the test modules discovery gives it (once more when a change left the revision unmoved), storing the discovery and each run under the input fingerprint it started from, or as not fingerprinted when its inputs moved while it ran. Each round runs the workspaces owning a changed path first, then those whose latest run holds a failed test, then the rest. A workspace or discovery that failed, or whose last attempt stored nothing, is retried at each periodic reconciliation. The log explains each round's selection."
- `README.md`: a user-visible change; a sentence that says the daemon runs each workspace once at start, if any, becomes that it runs what an edit left without current results. Dev confirms the sentence.

#### Previous ticket

2.3g (authored in wt/1, not built), the nearest earlier key in build order: it builds the dependency information once per input revision in a second executor, narrows each workspace's fingerprint with it, makes a run wait for the build at its revision, and widens every workspace to the whole project, with a reason in every answer, when a build fails or the discovery yields no selection input. 2.3e (authored, not built) builds selection's input from the discovery and the isolated build. 2.3d (in review in main) is the nearest earlier key past backlog in the status file; it gives `selectTests` its alias widening and moves `SELECTION_POLICY_VERSION` to 5. From 2.1 (done): the job fingerprint check (`beginJob`, `endJob`, `unmoved`) and Q6, which gives this work the rerun of a job stored not fingerprinted. From 2.3c (done): protection runs at each stored discovery. `git log --oneline -20` (06:05) shows no code commit since 2.3c's a3ca5bc other than c73c075, a defect-verifier fix outside `packages/daemon`.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3f, § Ticket 2.3h, § Ticket 2.3i, § Ticket 2.3g.
- Ticket 2.1 (`_agent-docs/tickets/2-1-track-inputs.md`) Q6 and § What 2.3 inherits.
- Ticket 2.3g (`_agent-docs/tickets/2-3g-narrow-fingerprints.md`) and ticket 2.3e (`_agent-docs/tickets/2-3e-dependency-build.md`).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (06:07).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C8,C14,C30,C32,C37,C38,C39,C46,C48,C55,C59,C113,C114,C116,C120,C126,C128,C129,C130,C140,C142,C154,C160 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P18,P19,P21,P32 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area:
  - packages/daemon
is_consolidation: false
sizing_ac_count: 8
files_to_modify:
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/daemon-main.ts
  - packages/daemon/src/inputs/input-tracker.ts
  - packages/daemon/src/inputs/reconcile-schedule.ts
  - packages/daemon/src/inputs/input-jobs.ts
  - packages/daemon/src/inputs/narrowed-inputs.ts
  - packages/daemon/src/query/test-states.ts
  - packages/daemon/src/query/summary.ts
files_to_create:
  - packages/daemon/src/daemon/scheduler.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId e9a16f2c-375f-46ef-9723-b0ad8b46991c

#### Test Files This Change Broke

Typecheck (`bun run --filter @rt-test/daemon typecheck`, 22:45, only test files error):

- `packages/daemon/test/lifecycle.test.ts`: `StandInInputs` lacks `TrackedInputs.periodicReconciliations()`; the hand-built `CurrentInputs` lacks `snapshot`; the `LifecycleParts` built by hand lack `quietWindowMs`; each `JobVerdict` literal `{ fingerprinted: false, reason }` lacks `changedWhileRunning`.
- `packages/daemon/test/query.test.ts`: the two hand-built `CurrentInputs` lack `snapshot`.

Behavior changes, found only by the tests failing:

- `packages/daemon/test/daemon-harness.ts`: `IDLE_ENTRY` is now `idle: no confirmed workspace is due` (the scheduler's `IDLE_ENTRY` text, written each time a round leaves nothing queued); `lifecycle.test.ts`, `daemon.test.ts`, `job-tree.test.ts` and `packages/cli/test/cli.test.ts` wait for it.
- `lifecycle.test.ts`, `daemon.test.ts`: a start now waits the quiet window (1,000 ms) before the first discovery, a restart over current results runs nothing, and an edit reruns its workspace; tests that expect every confirmed workspace to run at start, or a stand-in store whose latest runs read current, change.
- `lifecycle.test.ts` (`unstoredJobs`): `#nothingStored` now keeps one entry per job (the latest ending), where it appended; a test expecting two entries for one workspace changes.
- `lifecycle.test.ts` and `input-tracker.test.ts`: the tracker's "and N more" count of a verdict now counts distinct descriptions past the cap.
- `lifecycle.test.ts`: a run or discovery whose start finds a moved revision, or a stop, returns without beginning (the scheduler plans again).

#### ACs Owed a Test

Each criterion is ticked once its test was proven (see the Tests Record); the dev's traced code path stays as the statement of its guarantee.

- [x] AC1: a restart over results that read current runs no workspace, and a workspace whose latest run is stored not fingerprinted, under another digest or adapter version, missing, or with no computable current fingerprint runs (`Scheduler.#due`, `staleReason`).
- [x] AC2: a workspace runs at most once per (input revision, list of test modules), except one rerun of a run stored not fingerprinted by a change at an unmoved revision, then held (`Scheduler.#ranAlready`, `#run`); nothing starts after a stop.
- [x] AC3: nothing starts until the revision has held still `QUIET_WINDOW_MS` and the build wait released; a burst leads to one round (`Scheduler.#quiesce`, `#quietWindow`).
- [x] AC4: a discovery not current at a settled revision is rediscovered once per revision, before the due runs, and a new test is then counted (`Scheduler.#discoveryDue`, `#plan`).
- [x] AC5: at each periodic reconciliation a `failed` discovery or run, or a nothing-stored one still due, is retried once, and no other trigger retries it (`InputTracker.periodicReconciliations`, `Scheduler.#armRetries`).
- [x] AC6: each round after a revision change logs the selection over the changed paths, each due workspace with its reason, selected-but-current workspaces as not run, and a warning-level entry naming the cause when no selection can be made (`round-selection.ts`, `Scheduler.#explain`).
- [x] AC7: direct targets, then prior failures, then the rest, each in discovery order (`orderQueue`, `queueGroup`).

#### Tests Owed

- The scheduler survives a step that throws: `Scheduler.start` logs it and tries again at the next change, where the start sequence ended (review finding, fixed).
- `#nothingStored` keeps one `unstoredJobs` entry per job, so a retry at every periodic reconciliation cannot grow it (review finding, fixed).
- A run or discovery whose start finds the revision moved since it was planned begins nothing and reports so (review finding, fixed): the workspace runs at the new revision instead.
- An executor that throws ends a job with nothing stored and closes its change window (`threwOutcome`).
- `#stopSequence` releases the store and the endpoint when an executor's close rejects (`#closing`).
- `JobWindows`' "and N more" counts each distinct description past the cap once.
- `Narrowing.select` and `changedPaths`: the changed paths between two snapshots (changed, appeared, disappeared) are what `selectTests` is given.

### Tests Record

Tests session: threadId baed77b6-82b9-4d62-bde9-f7d14c5a2884 (rt-t2-3f-tests-2, successor of rt-t2-3f-tests, 96cf32d4-a219-47e9-a6e6-0ae4b2502280)

#### Named Defects

Proven by id at 02:38 (Windows, 81 of 81 detected, exit 0) and on Linux (WSL, Node 24, `~/rt-test-2-3f`).

- D1953: A stop given to the scheduler is not remembered, so a stop that arrives during the first reconciliation of the inputs is followed by the discovery once the reconciliation ends. (AC2)
- D2642: A workspace the discovery lists but the confirmed start does not is queued, so each input revision runs it into nothing stored and lists it as a job that stored nothing. (AC1)
- D2643: A workspace whose latest run is bound to its current input fingerprint is due, so a restart over current results runs it again. (AC1)
- D2644: A workspace whose latest run is stored under another digest than its current fingerprint is rated current, so an edit leaves its workspace unrun. (AC1)
- D2645: A workspace whose latest run is stored not fingerprinted is rated current, so a run a stop interrupted is never run again. (AC1)
- D2646: A workspace whose current fingerprint cannot be computed is logged as due because its inputs differ, so the log names a change that never happened. (AC1, AC6)
- D2647: A workspace whose latest run holds a failed test is due though the run is bound to its current fingerprint, so a deterministic failure reruns without end. (AC1)
- D2648: A workspace whose run ended with nothing stored is run again at the same input revision, so it runs in a loop with no input change. (AC2)
- D2649: A workspace is not run again when a rediscovery at an unchanged revision lists new test modules for it, so a test added to it stays unrun. (AC2)
- D2650: A run stored not fingerprinted by a change that left the revision unmoved is not run again, so a save of identical bytes leaves the workspace unknown. (AC2)
- D2651: The run repeated for an unmoved change is itself repeated when it is stored not fingerprinted again, so a test that rewrites its own input with identical bytes reruns without end. (AC2)
- D2652: The quiet window is 999 ms instead of the 1,000 ms the requirement names. (AC3)
- D2653: A discovery starts 1 ms before the input revision has held still for the quiet window. (AC3)
- D2654: The quiet window is timed from the first change of a burst, so a burst of changes each less than the window apart starts a round in the middle of the burst. (AC3)
- D2655: A round begins before the events the inputs have not yet read are read, so it plans over inputs that are about to change. (AC3)
- D2656: A round whose input revision moved while its waits ran begins at once at the new revision, without the quiet window. (AC3)
- D2657: A stop that arrives while the dependency build wait is held is followed by the discovery once the wait is released. (AC2, AC3)
- D2658: A discovery that is not current at a settled revision is not rediscovered, so the due runs are taken from a discovery of another revision. (AC4)
- D2659: A discovery whose record stays not current is attempted again at the same input revision, so it repeats in a loop with no input change. (AC4)
- D2660: A workspace whose latest run failed is not retried when a periodic reconciliation ends, so a cause outside the inputs leaves it failed until an unrelated edit. (AC5)
- D2661: A workspace whose retry fails again stays in the retry set, so it is retried without end instead of once for each periodic reconciliation. (AC5)
- D2662: A discovery listing a workspace whose status is failed is not retried when a periodic reconciliation ends. (AC5)
- D2663: A discovery that ended with nothing stored is not retried when a periodic reconciliation ends. (AC5)
- D2664: A path that disappeared between two rounds is left out of the paths selection is asked about, so the workspaces that depended on it are never selected. (AC6)
- D2665: The log names no owner for a changed path. (AC6)
- D2666: The log does not say when a count of tests is incomplete, so a total that is a lower bound reads as exact. (AC6)
- D2667: The log names no broad fallback, so a widening to a whole workspace or project is not explained. (AC6)
- D2668: A selected workspace that is due is logged as not run because it holds current results. (AC6)
- D2669: A round with no selection is logged below warning level, so a failed dependency build passes unnoticed. (AC6)
- D2670: The warning for a round whose build wait was released with no build ended does not say the wait was released. (AC6)
- D2671: A due workspace is logged at each plan of it instead of once for its input revision. (AC6)
- D2672: The workspace owning a changed path runs last in its round instead of first. (AC7)
- D2673: A workspace whose latest run holds a failed test runs after the workspaces with no failure instead of before them. (AC7)
- D2674: A job that throws ends the scheduler for good, so no later change of the input revision runs anything. (Tests Owed)
- D2675: A run whose executor call throws is not caught, so its change window stays open and nothing about the run is listed as a job that stored nothing. (Tests Owed)
- D2676: A discovery whose executor call throws is not caught, so its change window stays open and nothing about the discovery is listed as a job that stored nothing. (Tests Owed)
- D2677: A close that rejects during a stop is swallowed without a log entry, so the error that left a process or a lock behind is never reported. (Tests Owed)
- D2678: Each ending of a job that stored nothing is appended to the list, so a job retried at every periodic reconciliation grows it without end. (Tests Owed)
- D2679: A run whose start finds the input revision moved since it was planned begins anyway, without the quiet window at the new revision. (Tests Owed)
- D2680: The tracker never counts a periodic reconciliation as ended, so the scheduler is never told to retry what failed with no input change to blame. (AC5)
- D2681: Every reconciliation counts as a periodic one, so an edit's or a start's reconciliation retries what failed with no input change to blame. (AC5)
- D2684: A job during which a change was recorded is judged as not having had its inputs change while it ran, so a run stored not fingerprinted by an edit is never run again. (AC2)
- D2685: A job that began with its inputs unsettled is judged as having had them change while it ran, so a start over unsettled inputs is run again once more at the same revision. (AC2)
- D2686: A job that ended with no fingerprint computable is judged as having had its inputs change while it ran, so a workspace whose fingerprint cannot be computed is run again once more at the same revision. (AC2)
- D2687: A change recorded again past the cap is counted again, so a verdict says more changes went unnamed than there were. (Tests Owed)
- D2688: A view over settled inputs carries no committed inputs, so a round can never say which paths changed. (AC6)
- D2689: A narrowing asks selection about no changed path, so a round's selection names no workspace whatever changed. (AC6)
- D2690: The log says a changed path selected no workspace without saying why. (AC6)
- D2691: The daemon reads no stored results when it plans, so a restart rediscovers and reruns every workspace though its results read current. (AC1)
- D2692: An idle scheduler does not wake at a change of the input revision, so an edit leaves the workspaces it touched without a fresh result until a periodic reconciliation ends. (AC1)
- D2693: A workspace whose run ended with nothing stored and is still due is not retried when a periodic reconciliation ends, so it stays without a result until an input changes. (AC5)
- D2694: A stop given while the quiet window waits does not end the scheduler until the window runs out. (AC2, AC3)
- D2695: A round whose inputs' digests cannot be read logs a plain entry instead of the warning naming the cause. (AC6)

Records of earlier tickets that this change re-anchored or re-keyed, proven in the same run: D1451, D1452, D1455, D1465, D1538, D1877, D1880, D1883, D1885, D1921, D1987, D1988, D1998, D2080, D2081, D2082, D2083, D2084, D2088, D2090, D2092, D2517, D2519, D2521, D2537, D2559.

The log gaps refuted: none logged.

Review's Test Coverage Gaps (03:06): all 19 rows written, each pinned by a test; row 13 has two (D2740, D2747). Proven by id (119 records: every record mutating lifecycle.ts, scheduler.ts, round-selection.ts or input-jobs.ts, this round's records, and the re-anchored ones) on Windows at 03:33 and on Linux (Node 24) at 03:51: all detected but D1460, which is retired (see Deliberately Untested); D2694 also hung on Windows under its mutation until its test released the fake window, and was then detected at 03:44.

- D2728: A job whose window recorded a watcher failure, and which ended with no fingerprint computable, is judged as having had its inputs change while it ran, so a workspace whose fingerprint cannot be computed runs once more at the same revision. (Review gap 1)
- D2729: After a run ends the activity keeps naming its workspace while the scheduler waits out the next quiet window and build wait, so status and every answer say a run is going while none is. (Review gap 2)
- D2730: A job that ended with nothing stored stays listed after a later attempt of it stores its record, so status lists as unstored a workspace, or a discovery, whose latest record was stored. (Review gap 3)
- D2731: A workspace's periodic retry is dropped when its run does not begin because the revision moved, so a failed run bound to its current fingerprint waits for the next periodic reconciliation. (Review gap 4)
- D2732: A discovery's periodic retry is dropped when the discovery does not begin because the revision moved, so a current discovery listing a failed workspace waits for the next periodic reconciliation. (Review gap 5)
- D2733: A run whose job throws is not counted as having stored nothing, so a periodic reconciliation does not retry it while it stays due. (Review gap 6)
- D2734: A round whose build wait was released with no build ended at its revision, after an earlier build failed, is logged as that earlier failure, so the warning names a cause from another revision. (Review gap 7)
- D2735: The round's log names only the kind of each step a selection reason passed through, not its detail, so a selection widened through an uncertain dependency does not say which one. (Review gap 8)
- D2736: A changed path that selected a runnable workspace and also reached one that cannot run logs only the runnable one, so the excluded workspace and its reason go unexplained. (Review gap 9)
- D2737: The periodic flag is not cleared once counted, so every reconciliation after the first periodic one counts as periodic and an edit's reconciliation retries what failed. (Review gap 10)
- D2738: A periodic request that arrives while another reconciliation runs is not counted, so the retry waits another interval. (Review gap 11)
- D2739: A run whose executor died is reported as stored, so a periodic reconciliation never retries it. (Review gap 12)
- D2740: The run's report never says its inputs changed while it ran, so a save of identical bytes during a run is not rerun once at the revision it left unmoved. (Review gap 13)
- D2741: A round whose selection is refused is logged below warning level, so a refused change passes unnoticed. (Review gap 14)
- D2742: A workspace's due entry is keyed on the input revision alone, so a workspace run again after a rediscovery at the same revision lists new test modules is not logged as due. (Review gap 15)
- D2743: A run stored not fingerprinted by a change that moved the input revision is logged as running once more at its revision, though no rerun is owed. (Review gap 16)
- D2744: A workspace whose latest run holds only errored tests is queued with the rest instead of before them. (Review gap 17)
- D2745: A workspace whose latest run was stored under another adapter version is logged as due because its inputs differ. (Review gap 18)
- D2746: The view over unavailable inputs carries the last committed snapshot, so a round whose input set cannot be established logs a selection over inputs nobody can vouch for, with no warning. (Review gap 19)
- D2747: The run's report says its inputs changed while it ran for any run stored not fingerprinted, so a run that began with its inputs unsettled is rerun once more at the same revision. (Review gap 13)

Repairs the review's fixes forced: the fake clocks in scheduler.test.ts and lifecycle.test.ts fake `performance`, D2653 and D2654 are re-anchored on the `performance.now()` lines, D2684 on `changedWhileRunning: unavailable === undefined,`, D1455 is re-pointed at `#idleAfter` (its test now holds the scheduler in the next quiet window), and D1877 asserts the whole array of stored fingerprints.

#### Deliberately Untested

- `packages/daemon/src/daemon/daemon-main.ts`: passes `QUIET_WINDOW_MS` to the lifecycle with no branch; D2652 pins the constant's value.
- `packages/daemon/src/inputs/reconcile-schedule.ts`: exports a constant with no branch.
- `packages/daemon/src/query/test-states.ts` and `packages/daemon/src/query/summary.ts`: renames only; D1883 and D1885 cover them.
- `packages/daemon/src/daemon/scheduler.ts` `start()`'s `while (!this.#isStopping())`: guarded again by `#quietWindow`'s first check and the lifecycle's `#beginsNothing`, so no single edit shows it.
- `packages/daemon/src/daemon/lifecycle.ts` `isStopping()` (D1460's record, which mutates it to `return false;`): the scheduler's own stop flag (`Scheduler.stop()`, called first in `#stopSequence`) and `#beginsNothing` also keep the workspaces not yet run from starting after a stop, so the D1460 test passes under its mutation. No single edit removes every guard: mutating `Scheduler.#isStopping` makes a planned run begin nothing and the scheduler plan it again without end. D1953, D2657 and D2694 pin the scheduler's flag, D2083 and D2084 the job's start. Retired at 03:54 by the orchestrator's ruling: D1460's record and its test are removed (the verifier fails a test file holding a test that names no defect, so the test cannot stay under a title with no id), since the guarantee stays pinned by D1953, D2657 and D2694 (the scheduler's flag) and D2083 and D2084 (the job's start), and a working guard is not removed only to make a mutation visible.

### Review Record

Review session: threadId 93a47335-8e3a-4e57-b211-1c4d2d371a26 (rt-t2-3f-review)

Tech debt, undisposed until the commit exists:

- `packages/daemon/src/daemon/lifecycle.ts` `begin()` has no stop guard of its own: a `begin()` after `stop()` would start the tracker, the builds and the scheduler again. Only `daemon-main.ts`'s call order prevents it. Pre-existing.
- `packages/daemon/src/inputs/input-tracker.ts` `#reconcileWhileRequested` ends every reconciliation with `#schedule.periodic()`, which clears and re-arms the periodic timer (`reconcile-schedule.ts`, `RECONCILE_INTERVAL_MS`), and the lost-input-set retry replaces that timer too. A project that reconciles more often than every `RECONCILE_INTERVAL_MS` for another cause (an ignore-file edit, a git HEAD or index move, a watcher recovery) never reaches a periodic reconciliation, so AC5's retry of a `failed` run bound to its current fingerprint, or of a discovery listing a `failed` workspace, never comes while the revision stays put. Pre-existing, load-bearing since this ticket.
- `packages/daemon/src/inputs/narrowed-inputs.ts`: `Narrowing.select` and `narrowedSets` each build their own `selectTests({ ...input, change, dependencies })` call. A workspace's staleness and a round's selection must ask selection the same way, so `narrowedSets` could take its outcome from `select`. Duplication this change created.

#### Test Coverage Gaps

The orchestrator allocates the ids. Severity by `_agent-docs/rules/review-shared.md`; each row names the source file, the defect, and the test expected.

1. `packages/daemon/src/inputs/input-jobs.ts` (MEDIUM, daemon-state): A job whose window recorded a watcher failure, and which ended with no fingerprint computable, is judged as having had its inputs change while it ran, so a workspace whose fingerprint cannot be computed runs once more at the same revision. Expected: an `input-tracker.test.ts` test where a watcher failure is recorded during a job and the tracker is still unavailable at its end, asserting `changedWhileRunning: false`; mutation `changedWhileRunning: unavailable === undefined,` to `changedWhileRunning: true,`.
2. `packages/daemon/src/daemon/lifecycle.ts` `#idleAfter` (HIGH, consumer): After a run ends, the activity keeps naming its workspace while the scheduler waits out the next quiet window and build wait, so status and every answer say a run is going while none is. Expected: a `lifecycle.test.ts` test that reads `status().activity` after a run whose revision moved, before the new window ends, expecting idle; and one after a job that did not begin (the idle `#beginsNothing` used to set now comes from `#idleAfter`).
3. `packages/daemon/src/daemon/lifecycle.ts` `#store` (HIGH, consumer): A job that ended with nothing stored stays listed after a later attempt of it stores its record, so status lists as unstored a workspace whose latest run was stored. Expected: a `lifecycle.test.ts` test (D2678's shape) whose second write succeeds, expecting `unstoredJobs` empty; and the same for the discovery.
4. `packages/daemon/src/daemon/scheduler.ts` `#run` (MEDIUM, daemon-state): A workspace's periodic retry is dropped when its run does not begin because the revision moved, so a `failed` run bound to its current fingerprint waits for the next periodic reconciliation. Expected: a `scheduler.test.ts` test where the stand-in run returns undefined for the retry's first attempt, then runs at the new revision.
5. `packages/daemon/src/daemon/scheduler.ts` `#discover` (MEDIUM, daemon-state): A discovery's periodic retry is dropped when the discovery does not begin because the revision moved, so a current discovery listing a `failed` workspace is not retried until the next periodic reconciliation. Expected: a `scheduler.test.ts` test with the stand-in discovery returning undefined once.
6. `packages/daemon/src/daemon/scheduler.ts` `#run` (LOW, daemon-state): A run whose job throws is not counted as having stored nothing, so the periodic reconciliation does not retry it while it stays due. Expected: a `scheduler.test.ts` test with a throwing stand-in run, then a periodic reconciliation, expecting a second run; mutation `nothingStored: true,` in `#run`'s first attempt to `nothingStored: false,`.
7. `packages/daemon/src/daemon/round-selection.ts` `explainRound` (MEDIUM, daemon-state): A round whose build wait was released with no build ended at its revision, after an earlier build failed, is logged as that earlier failure, so the warning names a cause from another revision. Expected: a `scheduler.test.ts` test with a building narrowing that carries `lastFailure`, expecting the warning to name the released wait (`no-build-ended`).
8. `packages/daemon/src/daemon/round-selection.ts` `stepText` (MEDIUM, daemon-state): The round's log names only the kind of each step a selection reason passed through, not its detail, so a selection widened through an uncertain dependency does not say which one. Expected: a `scheduler.test.ts` test whose stand-in reason has a step with a detail, expecting the path entry to include it.
9. `packages/daemon/src/daemon/round-selection.ts` `notRunnableText` (LOW, daemon-state): A changed path that selected a runnable workspace and reached one that cannot run logs only the runnable one, so the excluded workspace and its reason go unexplained. Expected: a `scheduler.test.ts` test whose path report carries both.
10. `packages/daemon/src/inputs/input-tracker.ts` (MEDIUM, daemon-state): The periodic flag is not cleared once counted, so every reconciliation after the first periodic one counts as periodic and an edit's reconciliation retries what failed. Expected: an `input-tracker.test.ts` test with a periodic reconciliation followed by an ignore-file reconciliation, expecting the count to stay at 1; mutation deletes `this.#periodicRequested = false;`.
11. `packages/daemon/src/inputs/input-tracker.ts` `#requestReconciliation` (LOW, daemon-state): A periodic request that arrives while another reconciliation runs is not counted, so the retry waits another interval. Expected: an `input-tracker.test.ts` test where the periodic timer fires during a running reconciliation, expecting the count to rise.
12. `packages/daemon/src/daemon/lifecycle.ts` `#run` (MEDIUM, daemon-state): A run whose executor died is reported as stored, so the periodic reconciliation never retries it. Expected: a `lifecycle.test.ts` test with a run outcome `ended: false`, then a periodic reconciliation, expecting two runs; mutation the `!outcome.ended` branch's `report(false)` to `report(true)`.
13. `packages/daemon/src/daemon/lifecycle.ts` `#run`'s report (MEDIUM, daemon-state): The report's `changedWhileRunning` is not the verdict's, so a save of identical bytes during a run is not rerun once (mutation to `false`), or a run that started unsettled is rerun once more (mutation dropping `&& verdict.changedWhileRunning`). Expected: two `lifecycle.test.ts` tests over the stand-in tracker at an unmoved revision. The relaxed not-fingerprinted run test (asserting only `runFingerprints[0]`) no longer says whether the rerun happened; assert the whole array.
14. `packages/daemon/src/daemon/round-selection.ts` `explainRound` (MEDIUM, daemon-state): A round whose selection is refused is logged below warning level, so a refused change passes unnoticed. Expected: a `scheduler.test.ts` test with a refused `SelectionOutcome` from the stand-in narrowing, expecting one warning naming `SELECTION_REFUSED` and the reason, and the due workspace still running.
15. `packages/daemon/src/daemon/scheduler.ts` `#explain` (LOW, daemon-state): The due entry is keyed on the revision alone, so a workspace rerun after a rediscovery at the same revision lists new test modules is not logged as due. Expected: extend D2649's scenario to assert a second due entry.
16. `packages/daemon/src/daemon/scheduler.ts` `#run` (LOW, daemon-state): A run stored not fingerprinted by a change that moved the revision is logged as running once more at its revision. Expected: a `scheduler.test.ts` test with `changedWhileRunning` and a moved revision, expecting no "runs once more" entry.
17. `packages/daemon/src/daemon/due-workspaces.ts` `FAILING_OUTCOMES` (LOW, daemon-state): A workspace whose latest run holds only `error` tests is queued with the rest instead of before them. Expected: a `scheduler.test.ts` ordering test seeded with an `error` outcome.
18. `packages/daemon/src/daemon/due-workspaces.ts` `staleReason` (LOW, daemon-state): A workspace whose latest run was stored under another adapter version is logged as due because its inputs differ. Expected: a `scheduler.test.ts` test asserting the adapter-version reason.
19. `packages/daemon/src/inputs/current-inputs.ts` (MEDIUM, daemon-state): The view over unavailable inputs carries the last committed snapshot, so a round whose input set cannot be established logs a selection over inputs nobody can vouch for, with no warning. The recorded exclusion's reason does not hold: the scheduler reads `snapshot` directly, not through a fingerprint, and the tracker's `#state.project()` returns the last committed snapshot while unavailable. Expected: a `query.test.ts` test of the unavailable view, expecting `snapshot` undefined; mutation `snapshot: undefined,` to `snapshot: project(),`. Remove the exclusion line once it lands.

Tests this review's fixes break, for repair:

- `scheduler.ts` times the quiet window with `performance.now()`: `scheduler.test.ts`'s fake clock and `lifecycle.test.ts`'s D2679 fake only `Date`, so each needs `"performance"` in `toFake` (Vitest 5.0.1's bundled fake timers support it, `dist/chunks/index.m3L2HgmY.js` 6176); re-anchor D2653 and D2654 on the `performance.now()` lines.
- D2684's anchor is now `changedWhileRunning: unavailable === undefined,`.
- D1455: `#idleAfter` now also sets idle after every job, so removing the scheduler's idle callback alone no longer leaves a discovery that stored nothing reading busy; re-point the record.

### Completion Notes

Built alone: the tasks are one dependency chain (the tracker and verdict shapes, then the scheduler, then the lifecycle), so nothing was delegated. Two sibling modules beyond the ticket's list hold what `scheduler.ts` would otherwise carry: `due-workspaces.ts` (the due reason, queue groups and order) and `round-selection.ts` (AC6's explanation). `current-inputs.ts` gained `snapshot` on `CurrentInputs`, the "smallest read" of the committed input snapshot AC6 diffs.

Assumptions: the table was `None.`, so nothing to resolve.

Ticket sanity check: no blocking findings. One observation for the record, not a defect the ticket's rulings decide: AC2's once-per-revision bound holds per revision, so a test that rewrites one of its own inputs with different bytes on every run moves the revision each time and is rerun without end. R-F2 names only the identical-bytes case; the known limits could name this one.

Known limit of 2.3f, ruled on: a workspace whose runs keep being invalidated only by changes made while it runs (a test that rewrites one of its own inputs with different bytes on every run) moves the revision each run, so 2.3f reruns it without end. Ruling: "stop and explain". A later ticket, after 2.3h, will detect such a workspace, stop rerunning it, mark its results with a reason naming the file, and wait for an outside edit. 2.3f does not build this. Decider: the owner, relayed by the orchestrator, 2026-09-29 01:12.

Judgment calls:

- The scheduler keeps its per-workspace record under the revision the run began at (`RunReport.revision`), not the one planned, so a run that began after the revision moved is not counted against the plan.
- "Idle" is logged once after a burst of work or a retry that armed something, not on every wake, so a periodic reconciliation with nothing to retry writes no entry.
- A confirmed-start filter (`confirmedEntry`) sits in `Scheduler.#eligible`, so a workspace the discovery lists and the start does not confirm is never queued, since each revision would otherwise append an `unstoredJobs` entry for it. `#run`'s own check stays as the guard.
- One log entry per changed path is written for a round's selection, as AC6 says, however many paths changed.
- Answers still carry today's `activity`: it reads `idle` from the idle entry until the next job begins, including during a quiet window (2.3i shows the schedule).

Adversarial review (a general-purpose agent, 22:42, 12 findings):

- Fixed: F1 (a throw in a step ended the scheduler for good), F2 (`#unstored` grew at every periodic retry), F4 and F8 (a job began at a revision that moved after planning: `#beginsNothing` and the revision check in `#plan`), F5 (a reaction per wake on a never-settling stop promise: removable stop waiters), F7 (each closer in `#stopSequence` now runs whatever an earlier one did), F9 (retry logging and idle noise at every periodic reconciliation), F10 (`omitted` counted a repeated description each time), F11 (`digestOf` duplicated: `fingerprintDigest` in `test-states.ts`; `#eligible` computed once per plan), F12 (a throwing executor left its change window open: `threwOutcome` ends the job with nothing stored).
- Discarded #3: activity showing `idle` while a round is pending is 2.3i's ("Show the schedule in every answer"), and this ticket keeps today's `activity`.
- Discarded #6: a run stored not fingerprinted for a cause other than a change while it ran is not rerun at the same revision; AC2 says so ("is not run again until the revision or that list changes"), and R-F2 gives the one exception.

Fix after the tests session's report (01:19): `#run` no longer waits for the dependency build itself. The scheduler's round wait (`#awaitBuild("the round")` in `Scheduler.#quiesce`) is the one build wait before a job, since a second wait restarted the discard count and stalled a run behind a third in-flight build after the round's wait had released.

Validation: `bun x oxlint` over the changed production files, exit 0, no output; `bun run --filter @rt-test/daemon typecheck` errors only in `test/lifecycle.test.ts` and `test/query.test.ts` (listed above); `node scripts/check-line-citations.mjs` clean. No test ran.

README: user-visible (the daemon reruns what an edit left without current results); exact text sent to the orchestrator.

### File List

- _agent-docs/tickets/2-3f-schedule-runs.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3f rewritten and linked, § Ticket 2.3h and § Ticket 2.3i added, and the split note extended, under the orchestrator's 06:10 grant)
- _agent-docs/tickets/2-3f-schedule-runs.md (re-verified at build start by create-ticket, 20:42, against 2.3g as landed at 5b0a006 and #39/#40's test-harness changes)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3f builds after 2.3j, under the orchestrator's 20:41 grant)
- packages/daemon/src/daemon/scheduler.ts (created)
- packages/daemon/src/daemon/due-workspaces.ts (created)
- packages/daemon/src/daemon/round-selection.ts (created)
- packages/daemon/src/daemon/lifecycle.ts (modified)
- packages/daemon/src/daemon/daemon-main.ts (modified)
- packages/daemon/src/inputs/input-tracker.ts (modified)
- packages/daemon/src/inputs/reconcile-schedule.ts (modified)
- packages/daemon/src/inputs/input-jobs.ts (modified)
- packages/daemon/src/inputs/narrowed-inputs.ts (modified)
- packages/daemon/src/inputs/current-inputs.ts (modified)
- packages/daemon/src/query/test-states.ts (modified)
- packages/daemon/src/query/summary.ts (modified)
- packages/daemon/test/scheduler.test.ts, packages/daemon/test/scheduling-harness.ts, packages/daemon/test/round-fixtures.ts (created), packages/cli/test/cli.test.ts, packages/daemon/test/daemon-harness.ts, packages/daemon/test/daemon.test.ts, packages/daemon/test/defects.json, packages/daemon/test/input-tracker.test.ts, packages/daemon/test/lifecycle.test.ts, packages/daemon/test/query.test.ts, packages/daemon/test/selection/defects.json, packages/daemon/test/selection/harness.ts, packages/daemon/test/selection/select-tests.test.ts (create-tests)
- packages/daemon/src/daemon/lifecycle.ts, packages/daemon/src/daemon/scheduler.ts, packages/daemon/src/daemon/round-selection.ts, packages/daemon/src/inputs/input-jobs.ts, _agent-docs/tickets/2-3f-schedule-runs.md (review fixes, known limit and Review Record)

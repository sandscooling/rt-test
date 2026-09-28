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

- [ ] AC1: Once the first reconciliation has ended, and again after each change of the input revision, the daemon runs each confirmed workspace the discovery in effect lists whose latest stored run is not bound to that workspace's current input fingerprint: stored under another digest, stored not fingerprinted, stored under another adapter version, or not stored at all, or its current fingerprint cannot be computed (the watcher is unhealthy, the input set cannot be established). Apart from AC5's retry, it runs no workspace whose latest stored run is bound to its current fingerprint, whatever that run's test outcomes, errors or execution. A run whose status is `failed` holds no test result, so AC5's retry of one runs no test that holds a current result (C154, NFR1). So a restart over results that read current runs no workspace, and a run stored not fingerprinted because a stop interrupted it runs again at the next start. A run stored not fingerprinted because an input changed or an event named one while it ran is run again from the inputs current once the input revision has settled: always when the change moved the revision, and once, by AC2's exception, when it did not.
- [ ] AC2: Discoveries and runs run one at a time (2.3g's dependency builds run in their own executor), and a workspace waits in the queue at most once. Each confirmed workspace is run at most once for one input revision and one list of test modules the discovery in effect gives it, apart from AC5's retry, so a workspace whose run cannot be stored under a fingerprint (while the input set cannot be established, while the watcher is unhealthy, or when the run ended with nothing stored) is not run again until the revision or that list changes. The one exception: a run stored not fingerprinted because its inputs changed or an event named one while it ran, at a revision the change did not move (a save of identical bytes), is run once more at that revision, and if that run is also stored not fingerprinted the workspace is held until the revision or the list changes, and the log says so. After a stop, no discovery or run starts.
- [ ] AC3: No discovery or run starts until the input revision has held still for `QUIET_WINDOW_MS` (1,000 ms, a target until measured) and 2.3g's dependency build at that revision has ended, finished or failed. A burst of input changes, each less than the quiet window after the one before, leads to one round of work that begins after the last of them and reads the inputs they leave.
- [ ] AC4: Whenever the discovery in effect is not current at a settled revision (none stored, or stored under another digest, not fingerprinted, or under another adapter version, or no current fingerprint over every input can be computed), the daemon discovers every confirmed workspace again before any due run, protects and stores that discovery as the start does today, and takes each due run from it. A test module added where a workspace's test include patterns match, or a test added to an existing module, is then discovered, run, and counted in every answer. The discovery is attempted at most once for one input revision, apart from AC5's retry.
- [ ] AC5: At each periodic reconciliation, at most once per reconciliation, the daemon retries what failed with no input change to blame: it discovers again while the discovery in effect lists a workspace whose status is `failed`, or while the last discovery attempted ended with nothing stored, and it runs a workspace again while its latest stored run's status is `failed`, or while its last run attempted ended with nothing stored (its executor process died or could not start) and it is still due by AC1. No other trigger retries them before the next change of the input revision.
- [ ] AC7: Within a round, the due workspaces run in this order: first each direct target, a workspace that is the owner (the deepest package workspace holding it) of a path that changed since the previous round; then each workspace whose latest stored run holds a test with a `failed` or `error` outcome; then the rest; each group in the discovery's workspace order. A workspace due only as invalidated, never run, stale from an earlier life or a retry is a direct target only through a changed path. A round with no selection (AC6), and the first round after a start, which has no previous round to diff against, have no direct targets. The order changes no outcome and no freshness.
- [ ] AC6: Each round of due runs that follows a change of the input revision is logged with its selection over every path whose input digest changed, appeared or disappeared since the previous round: for each changed path, the workspaces it selected or why it selected none; each broad fallback with the input or uncertainty that triggered it; and the selected and total test and workspace counts, saying when they are incomplete. Each due workspace is logged with why it is due, and a selected workspace that holds current results is logged as not run for that reason. When no selection can be made, because 2.3g's build failed, the discovery yields no selection input, or selection refused the change, the round is logged at warning level with that reason and every workspace AC1 finds due still runs.

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

- [ ] (Support) Before the first edit, re-read the landed code of ticket 2.3g (`daemon/dependency-builds.ts`, the revision signal it adds to the tracker, the wait in `lifecycle.ts` `#run`, and the narrowing state in `current-inputs.ts`), ticket 2.3e (`selection/selection-input.ts`) and ticket 2.3d (`selection/select-tests.ts`, `selection/selection-types.ts`), and confirm the names this ticket uses (§ Pending siblings and their routing). Check `lifecycle.ts`'s line count after 2.3g: the scheduling this ticket adds goes into a module of its own, never into `lifecycle.ts` (P16, P18).
- [ ] (AC1, AC2, AC3) Create `packages/daemon/src/daemon/scheduler.ts`, which the lifecycle owns: after the first reconciliation, and again whenever the input revision changes or AC5's trigger fires, it waits out the quiet window (`QUIET_WINDOW_MS`, named, labeled a target, C3), then the tracker's `settled()`, then 2.3g's build at the revision it settled at, and goes round again while the revision moved during those waits. When the discovery in effect yields no selection input, there is no build to wait for (2.3g AC4, 2.3e AC2), so it waits for none. It then plans one round: rediscover when `discoveryFreshness` rates the discovery in effect not `current` against the current fingerprint over every input (C8), at most once per input revision apart from AC5's retry, recording each attempt; after a rediscovery, wait for 2.3g's build over the new discovery before selecting; then queue each due workspace in AC7's order, each once, skipping any already run at this revision and list of test modules (AC2) unless AC2's one exception applies, and run them one at a time through the lifecycle's existing job path. After each job it plans again from the state then current, so a revision that moved during a run queues what it left due. A plan at an unchanged revision continues the current round; a plan at a moved revision begins a new round after the waits above, and its changed paths (AC6) are diffed against the snapshot the previous round read. The quiet window is its only timer, and a stop clears it. After each wait (the window, `settled()`, the build) and before each job, it checks for a stop with no await between that check and the job's start (C160), so nothing starts after a stop (AC2). The lifecycle passes the window's length in, so a test can shorten it; `daemon-main.ts` passes the constant (P19: a value, not a mode).
- [ ] (AC1) Decide "due" with the freshness the answers already compute, never a second comparison (C8): `discoveryFreshness(stored, currentFingerprint)` in `query/test-states.ts` rates any stored record (`StoredBasis`, a run or a discovery) against a current fingerprint; export it under a name that says so, and call it for the latest stored run with the workspace's current fingerprint. A workspace is due exactly when that rating is not `current`, which includes a current fingerprint that cannot be computed (the rating is then `unknown`); AC5's retry is the one other way a run is queued. A workspace with no stored run is due. Update `query/summary.ts`, the one other importer, to the new name.
- [ ] (AC2) In `packages/daemon/src/inputs/input-jobs.ts`, let a `JobVerdict` that is not fingerprinted say whether its window named a change while the job ran (the `its inputs changed while it ran` case), apart from an unsettled start or an unavailable fingerprint at its end, so the scheduler can apply AC2's one exception to that case only; the reason text stays as today. Ticket 2.3h later splits a window's paths from its causes; this ticket needs only the verdict's kind.
- [ ] (AC1, AC4) In `packages/daemon/src/daemon/lifecycle.ts`, replace `#startSequence`'s discover-then-run-each-once with the scheduler: `begin` starts it; the discovery step (`executor.discover`, `#protectDiscovered`, `#bindings`, `writeDiscovery`, and handing 2.3g's builds the new discovery) and the run step (`#run`) stay the lifecycle's, each called by the scheduler. The discovery in effect is the latest stored one (`readLatestResults`), read at each plan, so a rediscovery that failed to store leaves the previous one in effect. Rewrite the class doc comment ("discovers once, runs each confirmed workspace once, then idles", C46) and write the idle log entry, whose text begins `idle:`, each time a round leaves nothing queued; the harness constant `IDLE_ENTRY` names it (§ Existing tests this change breaks).
- [ ] (AC5) Give the scheduler a signal that a periodic reconciliation has ended, the smallest one the tracker can give (`input-tracker.ts` `#reconcileWhileRequested` ends each reconciliation; `ReconcileSchedule` names the periodic one's reason). At that signal, allow one more discovery or run of what AC5 names, even at an unchanged revision and list of test modules, and nothing else (C37: a run whose failure is a deterministic outcome, such as a failed test or a module that failed to load, is not `failed` and is never retried). "Ended with nothing stored" is the lifecycle's `#nothingStored` path for a job whose `JobOutcome` did not end (`ended: false`), which the scheduler records per workspace and for the discovery; a store write that failed is also nothing stored.
- [ ] (AC7) Order each round's queue as AC7 says, taking the direct targets from the `owner` of each `ChangedPathReport` in AC6's selection (`selection/selection-types.ts`) and the prior failures from each latest stored run's recorded test outcomes; keep the sort stable over the discovery's workspace order, and name each group's reason as a constant (C3). Record the order the queue ran in the log, one entry per job as today, so a test reads the sequence rather than timing it.
- [ ] (AC6) At each round after a change of the input revision, take the paths whose digest changed, appeared or disappeared between the committed input snapshot the previous round read and the one this round reads (`ProjectInputs.digests`, `inputs/fingerprint.ts`); expose the snapshot through `TrackedInputs` if 2.3g has not. Call `selectTests` with those paths as the change, over 2.3e's selection input and 2.3g's dependency information for this discovery and revision, and log its explanation (C129, C128): the per-path reports, the broad fallbacks, the counts and whether they are complete. Log each due workspace's reason as a named constant (C3), and each workspace the selection picked that holds current results as not run, with that reason. A refused selection (`SELECTION_STATE.refused`, which a root-relative change should never draw) is logged as no selection, with its reason. When the build failed or no selection input exists, log the reason at warning level (C32) and run AC1's due set. The round after a start has no previous snapshot: log each due workspace's reason only.
- [ ] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files, and `bun run --filter @rt-test/daemon typecheck`, which reports each stand-in the shapes break (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `DaemonLifecycle` `#run`, `#protectDiscovered`, `#bindings`, `#store`, `#nothingStored` (`daemon/lifecycle.ts`): the job path the scheduler calls. A job's verdict, fingerprint and storage are unchanged by this ticket.
- `discoveryFreshness`, `StoredBasis` (`query/test-states.ts`): the one rating of a stored record against a current fingerprint; AC1's due rule and AC4's rediscovery rule are that rating (C8).
- `confirmedEntry` (`vitest/confirmed-start.ts`): which listed workspaces the start confirmed.
- `TrackedInputs.settled`, `beginJob`, `endJob`, `current` (`inputs/input-tracker.ts`), and 2.3g's revision signal: when work may begin, and whether it held still.
- 2.3g's dependency builds (`daemon/dependency-builds.ts`): the build wait AC3 needs and the dependency information AC6's selection reads.
- `selectTests` (`selection/select-tests.ts`) and 2.3e's selection-input builder (`selection/selection-input.ts`): AC6's selection and its explanation.
- `ProjectInputs` (`inputs/fingerprint.ts`): a committed snapshot of every input's digest by root-relative path; AC6 diffs two of them.
- `readLatestResults` (`store/open-store.ts`): the discovery in effect and each workspace's latest stored run, read in one transaction.

### Must Create

- `daemon/scheduler.ts`: the quiet window, the plan (rediscover, then the due workspaces), the queue and its per-revision record, AC5's retry and AC6's logged round.
- The tracker's periodic-reconciliation signal (AC5).
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
- **Each round rediscovers the whole confirmed start** after any input change, and re-runs 2.3c's protection walk, which reads and hashes every input under the root (2.3c review tech debt).

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3f` over `lifecycle.ts`, `input-tracker.ts`, `input-jobs.ts`, `protocol.ts`, `answer.ts`, `summary.ts`, `answer-text.ts`, `executor.ts`, `scheduler.ts` and `write-run.ts` (06:07), and again over `daemon-main.ts`, `reconcile-schedule.ts` and `test-states.ts` (06:20), named 2.3d, 2.3e and 2.3g, each by folder or by a file it writes or reads; of the second three, only `daemon-main.ts` is named, by 2.3e (reads) and 2.3g (writes the second executor). All three build before this ticket, so each is a shape it builds on, never a collision:

- **2.3g** (authored, not built): the per-revision dependency builds, the build wait before a run, the revision signal from the tracker, and each workspace's narrowed fingerprint. This ticket calls them, and re-verifies their names first.
- **2.3e** (done): `buildSelectionInput` in `selection/selection-input.ts`, the selection-input builder AC6's selection reads.
- **2.3d** (done) and **change request #26**: `selectTests`' alias widening, each alias with its project's Vite root, and `SELECTION_POLICY_VERSION` 6; this ticket only calls `selectTests`.
- **2.3h and 2.3i** (backlog, split from this ticket): 2.3h writes `input-jobs.ts`, `input-tracker.ts`, `current-inputs.ts`, `executor.ts` and the scheduler after this ticket; 2.3i writes the answer and CLI files and reads the scheduler's state.
- Two change requests land before 2.3g (orchestrator's dispatch): a crashed idle-tracker child counted as a detection (a test-file fix), and a root-relative alias replacement (`/src`) that may add no edge. Neither touches this ticket's files.

#### Sizing

About 13 raw files and 17 estimated; code units 8 (7 criteria plus validation). Production: `daemon/scheduler.ts` (new), `daemon/lifecycle.ts`, `daemon/daemon-main.ts`, `inputs/input-tracker.ts` (or the module 2.3g extracts from it), `inputs/reconcile-schedule.ts`, `inputs/input-jobs.ts`, `query/test-states.ts`, `query/summary.ts`. Tests, for create-tests: `lifecycle.test.ts`, `daemon.test.ts`, `input-tracker.test.ts`, `daemon-harness.ts` and `packages/daemon/test/defects.json`. Over 10 estimated, so dev delegates, in two groups on disjoint files: the tracker side (`input-tracker.ts`, `reconcile-schedule.ts`, `input-jobs.ts`) and the scheduling (`scheduler.ts`, `lifecycle.ts`, `daemon-main.ts`, `test-states.ts`, `summary.ts`), in that order.

#### Current structure of the modified files

As of wt/1 at dc87b7c, before 2.3e and 2.3g land.

- `packages/daemon/src/daemon/lifecycle.ts` (357 lines): `LifecycleParts { identity, scope, start, store, log, executor, inputs, closeEndpoint }`; `begin` calls `#protectStoredDiscovery`, `inputs.start()` and `#startSequence`, then sets activity idle; `#startSequence` waits `firstReconciled` and `settled`, discovers under a job mark, protects (`#protectDiscovered`), stores (`writeDiscovery`), logs, then `#run`s each entry not `not-confirmed`, and logs `idle: every confirmed workspace has run`; `#run` waits `settled`, opens `beginJob`, takes the workspace's fingerprint, runs, and stores through `#bindings` and `unmoved`; `#stopSequence` aborts the executor, stops the tracker, awaits the sequence, and closes the executor, the store and the endpoint. 2.3g adds the builds, the build wait in `#run`, and the second executor.
- `packages/daemon/src/inputs/input-tracker.ts` (582 lines, about 495 code lines): `#reconcileWhileRequested` ends each reconciliation by marking the first, arming `#schedule.periodic()`, and notifying the ledger; `ReconcileSchedule` (`inputs/reconcile-schedule.ts`) arms the periodic one with `PERIODIC_REASON` after `RECONCILE_INTERVAL_MS`. 2.3g extracts from this file before adding to it.
- `packages/daemon/src/query/test-states.ts`: `discoveryFreshness(stored: StoredBasis, currentFingerprint)` wraps the private `storedFreshness`, stale under another adapter version, unknown when stored not fingerprinted, else `assessFreshness`.
- `packages/daemon/src/daemon/daemon-main.ts`: `serve` builds the tracker and the `DaemonLifecycle`.

#### Existing tests this change breaks

- `packages/daemon/test/daemon-harness.ts`: `IDLE_ENTRY = "idle: every confirmed workspace has run"`, which `lifecycle.test.ts`, `daemon.test.ts`, `job-tree.test.ts` and `packages/cli/test/cli.test.ts` wait for (`rg -n IDLE_ENTRY packages`, 06:11). The idle entry's text changes (a round leaves nothing queued), so the constant changes; those tests break only if they rely on idle meaning "every workspace ran once".
- `packages/daemon/test/lifecycle.test.ts`: tests that expect every confirmed workspace to run at start; a stand-in store whose latest runs are current now runs none. Its stand-ins build `LifecycleParts` by hand and gain the quiet window.
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

- _agent-docs/tickets/2-3f-schedule-runs.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3f rewritten and linked, § Ticket 2.3h and § Ticket 2.3i added, and the split note extended, under the orchestrator's 06:10 grant)

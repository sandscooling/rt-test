# Ticket 2.3h: Judge and interrupt a run by its workspace's inputs

## Ticket

As an agent editing one workspace of a consumer while the daemon runs another,
I want a run judged only by the inputs its workspace's results depend on, and a run my edit made worthless stopped at once and started again,
so that my edits elsewhere never throw away a long run's fresh results, an edit to the running workspace gets me fresh results without waiting out a run that can never become current, and a failed run is still retried however often I commit.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: A run is stored under the input fingerprint it started from exactly when all of these hold: it started with a fingerprint (its inputs were settled, and its start revision's dependency build had ended or none could run); no cause that names no path was recorded while it ran (a watcher failure, or an input set that could not be established); no path that changed while it ran, or that an event named, lies among its workspace's inputs by the dependency build at the revision it started at, by any dependency build that ended while it ran, or by the build at the revision it ended at, whether or not the path exists at that build's revision; and its workspace's fingerprint at the revision it ended at, taken once that revision's dependency build has ended (finished, failed or timed out), equals the one it started from. Every changed path counts, however many changed. A path lies among a workspace's inputs by a build when selection of that one path, over that build's dependency information, includes the workspace, as 2.3g AC1 narrows a fingerprint, when selection reports it a declared non-input, or when it is a test module the discovery in effect lists for the workspace; by a revision widened to the whole project's inputs (its build failed or timed out, the discovery yields no selection input, selection refused the inputs, or the builds ended), for a path whose selection is refused, and by a build the run could not capture before the next one replaced it, every path does. So a change only outside the running workspace's inputs, at revisions whose builds narrowed them, leaves its run stored under its fingerprint, and its results read current, while a change inside them, even one reverted before the run ended, leaves it stored not fingerprinted; at a widened revision every change lies inside. A discovery and a dependency build are still judged over every input.
- [ ] AC2: While a run that started with a fingerprint is in progress, once a newer input revision's dependency build has ended and a path that changed, or that an event named, since the run started lies among its workspace's inputs, as AC1 places a path, by a narrowed build (the one at its start revision, or any that has ended since), the run is interrupted at once. Nothing is stored for it: the daemon lists it among the jobs that ended with nothing stored, with a reason naming those paths and never a stop, in that listing and in the log alike, and the workspace's latest stored run, with its outcomes, stays as it was, judged by its own fingerprint against the current one (stale, unless the change restored the inputs it was stored under). Unless that run reads current, the workspace then runs again once the inputs settle, by ticket 2.3f's rules. No other change or cause interrupts a run: not a cause that names no path, not a path that only a widened revision, a refused selection or an uncaptured build places inside, not a fingerprint difference no changed path explains, not any change to a run that started with no fingerprint, and not any change once a stop has been asked; AC1 and AC3 decide such a run's verdict when it ends. A run whose executor returns it finished although its interruption was asked (the interruption landed too late) is judged by AC1 and AC3. A stop's interruption keeps its own reasons.
- [ ] AC3: A run that is not interrupted and that AC1 does not store under its fingerprint is stored not fingerprinted, as today, and runs again by ticket 2.3f's rules. The log names what decided that verdict: each changed path inside its workspace's inputs, up to the window's bound with a count of the rest, or each cause that names no path, its start without a fingerprint, its end fingerprint being unavailable (a stop, a lost input set, or no build ending at its end revision), or its fingerprint moving. A run stored under its fingerprint although paths changed while it ran is logged with those paths, as outside its workspace's inputs.
- [ ] AC4: Ticket 2.3f's periodic retry (its AC5) is no longer held off by reconciliations for other causes. A reconciliation counts as periodic when it ends at least `RECONCILE_INTERVAL_MS` after the last one counted, whatever requested it; the daemon's first reconciliation counts as none and starts the measure, and no reconciliation ending sooner than that counts. So an agent whose commits, index writes or ignore-file edits reconcile more often than every `RECONCILE_INTERVAL_MS` still has a reconciliation counted no later than two intervals, plus that reconciliation's own duration, after the last one counted, and gets the retry that follows it; a reconciliation for another cause soon after a counted one retries nothing.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. Interrupting a run is the executor's existing abort, which a stop already uses, and every other change is the daemon's own code.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, confirm the names § Current structure of the modified files gives against `main`, and re-run the broken-tests search in § Existing tests this change breaks.
- [ ] (AC1) In `packages/daemon/src/inputs/input-jobs.ts`, keep a job window's changed paths apart from its causes that name no path, and keep every changed path, named or past `MAX_NAMED_CHANGES` (the window already holds each description past the cap in `ChangeWindow.omitted`, an uncapped `Set`); the cap bounds only how many paths a reason or log line names, with a count of the rest, and an overflow is no cause of its own (QB). Let a running job's window be read while it runs (AC2). Keep today's any-path-or-cause verdict for a discovery and a dependency build, without changing the `JobVerdict` shape `dependency-builds.ts` reads, so that file and its 40 named-defect records stay untouched.
- [ ] (AC1) In `packages/daemon/src/inputs/input-tracker.ts` and `packages/daemon/src/inputs/queued-reads.ts`, record each entry through the right channel. Paths are what `InputState` operations return: `QueuedReads.#recordAll`, the `record` callback in `#readPath` and `#readFile`, and the reconciliation's `changed` in `#settleReconciliation`. Causes are `#markUnhealthy`, `#inputSetLost`, and the batch `QueuedReads.read` records while there is no filter or no established input set, whose paths are unread event spellings that no read vouches for. A recorded path is the state's own root-relative key, the same key a narrowed `ProjectInputs` holds, so it is compared as a key, never by an event's spelling (P13, C42).
- [ ] (AC1, AC2) In `packages/daemon/src/inputs/narrowed-inputs.ts`, let a `Narrowing` answer which of given root-relative paths lie among a workspace's inputs, by one `select` call over the whole batch of paths and its own dependency information, never one call per path, and the same `includingWorkspaces` rule `narrowedSets` applies (a declared non-input selection reports lies in every workspace), so a path's placement never puts outside a path the set-membership rule would put inside (C8). A test module the discovery in effect lists for the workspace lies inside it whatever selection says (ticket 2.1 AC11). A path whose selection is refused is a widened judgment: inside for AC1, and never an interruption (QA, C126).
- [ ] (AC1, AC2) Create `packages/daemon/src/daemon/run-judgment.ts` holding one predicate, used both while a run is in progress (AC2) and when it ends (AC1), never two spellings (C8). Given the job's window, the run's start (its fingerprint, or why it has none), how its start revision, each revision whose build ended while it runs, and at its end the end revision, place a path (narrowed by that build's `Narrowing`, or widened), the test modules the discovery lists for the workspace, and at its end the end fingerprint or why none could be taken, it answers whether the run can still be stored under its starting fingerprint, and when not, why: the changed paths inside, the causes, a start with no fingerprint, an end fingerprint that could not be taken, or a fingerprint that moved. Only changed paths a narrowed revision places inside interrupt (AC2, QA). A path lies inside by a narrowed revision when `Narrowing`'s placement above puts it there, whether or not the file exists at that revision, so a file created and deleted between two ended builds is still placed; by a widened revision, a refused selection, or a build the run could not capture, every path does, for AC1's verdict only (C126). It is pure: no I/O, no clock.
- [ ] (AC1, AC3) In `packages/daemon/src/daemon/lifecycle.ts` `#run`, take the start placement in the same synchronous moment as the start fingerprint, with no await after `beginJob` (C160): widened when `startInputs.inputsNotNarrowed` is set, and otherwise narrowed by the `Narrowing` that `narrowingAt(this.#builds.narrowing(), revision)` gives, the one `currentInputs` fingerprinted by, so `current-inputs.ts` needs no change (C11). Once the run returns and its window closes, settle, wait for the end revision's dependency build by the lifecycle's own `#awaitBuild` (whose loop settles after each build), and take the end view's placement and fingerprint with no await after it returns, so the view is at the revision whose build ended (a later await could move the revision, and the view would then read building). A stop during that wait needs no branch: `#awaitBuild` returns once the builds stop, since `DependencyBuilds.pending` is false after a stop, and the stopped tracker's view gives no fingerprint, so the run is stored not fingerprinted with the stop's reason, as today. Judge the run with the predicate in place of today's any-path verdict and `unmoved`. Store it under its starting fingerprint only when the predicate says so, and log per AC3. `unmoved` and `MOVED_DURING_RUN_REASON` go, or move into the predicate, once it supersedes them (C57).
- [ ] (AC2) In `run-judgment.ts`, watch a run while it is in progress. After each newer revision's dependency build ends, capture how it places paths (its `Narrowing`, or widened) and hold it for the run, since `DependencyBuilds` keeps only its latest build (`NarrowingState.latest`); a build replaced before the watch captured it counts as widened. Then apply the predicate to the window so far. Interrupt only on a reason naming a changed path a narrowed revision places inside, never for a run that started with no fingerprint and never once a stop is asked, and only the run judged: confirm it is still the job in progress with no await between that check and the abort (C157, C160). The watch ends when the run returns, releasing every wait it holds on every way the run ends (C167), and its promise is awaited or caught, so a failure in it is logged and never unhandled. Lifecycle is 512 lines against lint's 500 code-line cap (P16), so the watch lives in this module, and the lifecycle only starts it and reads its answer.
- [ ] (AC2) In `lifecycle.ts` `#run`, a run whose interruption was asked stores nothing when the executor returns an interrupted run (status `ran` with execution `interrupted`, or status `interrupted-before-load`) or a job that ended with nothing (`ended: false`, which an exit after the abort gives, since #14 made `#stopAsked` turn it into a lost job). Such a run goes to `#nothingStored` with the interruption's reason, a named constant plus the paths (C3), and its report says nothing was stored, so 2.3f's next round runs it again. A run returned finished is judged by AC1 and AC3 instead.
- [ ] (AC2) In `packages/daemon/src/daemon/executor.ts`, let `abort` take what the abort is for, defaulting to a stop, so an interruption's abort never logs or returns a stop's reason while `DependencyBuilds`' calls, and `dependency-builds.ts`, stay untouched. `ABORTED_BEFORE_SEND_REASON` names a stop today, and `#unsent` logs it; a stop's aborts keep their reasons (C131). Those are every production caller `rg -n "\.abort\(" packages/daemon/src` finds (2026-09-29 08:54): the lifecycle's `#stopSequence`, `DependencyBuilds.stop` and its bound timer, and `Executor.close`'s own call during a build. The other reasons an aborted job ends with (the bound passing, an exit) name no stop already. The executor serves the next job after an interruption, so the abort's purpose is cleared when its job settles, as `#settle` already clears `#stopAsked` and `#job` clears `#abortBeforeSend` (C167): an exit in the next job is still stored `crashed`, never `lost`.
- [ ] (AC4) In `packages/daemon/src/inputs/input-tracker.ts` `#reconcileWhileRequested`, count a reconciliation as periodic when it ends at least `RECONCILE_INTERVAL_MS` after the last one counted, taking the first reconciliation's end as the start of the measure, on a monotonic clock (`performance.now()`, as the scheduler's quiet window uses). Export `RECONCILE_INTERVAL_MS` from `packages/daemon/src/inputs/reconcile-schedule.ts` for it (C4). The timer's own flag (`#periodicRequested`, set when the request's reason is `PERIODIC_REASON`) is then redundant, since the reconciliation the timer starts always ends at least the interval after the last counted one: remove it, and `PERIODIC_REASON`'s export if nothing else reads it, and sweep the production prose that describes the timer as what counts (C48, C57); the test titles that do are create-tests', listed in § Existing tests this change breaks. Add no timer (orchestrator, 05:01).
- [ ] (Support) Send the orchestrator the doc text in § Doc text, its final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files, and `bun run --filter @rt-test/daemon typecheck` (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `JobWindows`, `JobMark`, `JobVerdict` (`inputs/input-jobs.ts`): the change window each running job keeps; AC1 splits what the window holds rather than adding a second window, and discoveries and builds keep `JobVerdict` as it is.
- `CurrentInputs` (`inputs/input-tracker.ts`) with its `inputsNotNarrowed` fact and `workspaceFingerprint`, unchanged; `narrowingAt`, `NARROWING`, `Narrowing.select` and the private `includingWorkspaces` rule (`inputs/narrowed-inputs.ts`): how a revision's build places a path, asked as `narrowedSets` asks it.
- `DependencyBuilds` `narrowing`, `pending` and `ended` (`daemon/dependency-builds.ts`), read through the lifecycle, and `DaemonLifecycle` `#awaitBuild` and `#runInputs` (`daemon/lifecycle.ts`): the wait for a revision's build before a fingerprint is compared (AC1) or a mid-run judgment is made (AC2).
- `Executor.abort` (`daemon/executor.ts`): interrupting the job in progress, as a stop does.
- `DaemonLifecycle` `#bindings`, `#store` and `#nothingStored` (`daemon/lifecycle.ts`) with `UnstoredJob` (`daemon/protocol.ts`): the verdict, storage and nothing-stored paths the interruption reuses; `unstoredJobs` carries its reason to `status` and every answer.
- 2.3f's scheduler (`daemon/scheduler.ts`), unchanged: a report with nothing stored at a revision that has since moved leaves the workspace due at the next round.
- `RECONCILE_INTERVAL_MS` (`inputs/reconcile-schedule.ts`): the one interval AC4 measures by.

### Must Create

- `packages/daemon/src/daemon/run-judgment.ts`: the predicate that judges a run by its workspace's inputs (AC1, AC2) and the watch that interrupts a run in progress (AC2).
- The reason text for a run interrupted by a change, and for a run kept while paths outside its inputs changed (AC2, AC3), as named constants.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The second of the three tickets the unsplit 2.3f became (orchestrator, 2026-09-28 06:10). Ticket 2.3f schedules discoveries and runs of what is not current; this ticket narrows when a run is invalidated, interrupts one that can no longer become current, and fixes 2.3f's periodic retry, which other reconciliations starve; ticket 2.3i shows the schedule in every answer. Build order: 2.3d, 2.3e, 2.3g, 2.3j, 2.3f, 2.3h, 2.3i. Until 2.3i lands, an interrupted run shows as a job with nothing stored in `status` and every answer (`unstoredJobs`), and the log names why.

Requirements this ticket serves (`docs/requirements.md`):

- "FR8: Execute every selection in the daemon, and record a run whose inputs changed while it ran as invalidated and rerun it from stable inputs." (AC1, AC2, AC3, AC4)
- "NFR1: Never execute a test while it holds a current result for the same input fingerprint, except to falsify it or to rerun an invalidated run." (AC1: a run kept under its fingerprint is not rerun)

Rule clauses the criteria rest on:

- `docs/architecture.md` § Identity and freshness: "Results belong to the inputs actually executed. If an input changes during a run, do not promote that run to current: record it as invalidated and rerun from stable inputs." (AC1, AC2)
- `docs/architecture.md` § Execution and falsification isolation: "Cancellation must leave explicit interrupted or stale states." (AC2: the latest stored run keeps its own freshness, and the interruption is a job with nothing stored and its reason)
- AGENTS.md § Product guarantees: "Never report historical results as current after a relevant edit or unresolved input change." (AC1)
- AGENTS.md § Product guarantees: "Widen selection when dependency information is uncertain." (AC1: a widened revision, a refused selection and an uncaptured build place every path inside)
- AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states." (AC2)
- Ticket 2.3g AC1: "each discovered workspace's fingerprint covers exactly the inputs whose selection includes it (a change of that one path, as `selectTests` decides it over that dependency information and ticket 2.3e's selection input), and every test module that discovery lists for it, whatever git ignores." (AC1: how a build places a path)
- Ticket 2.1 AC11: "A Vitest workspace's inputs always include each of its own test modules, whatever narrowing replaces the whole-project input set." (AC1: a listed test module lies inside)
- Ticket 2.3f AC1, the rerun this ticket's AC2 and AC3 hand to: "A run stored not fingerprinted because an input changed or an event named one while it ran is run again from the inputs current once the input revision has settled: always when the change moved the revision, and once, by AC2's exception, when it did not." And its first sentence: "the daemon runs each confirmed workspace the discovery in effect lists whose latest stored run is not bound to that workspace's current input fingerprint".
- Ticket 2.3f AC5, the retry AC4 unstarves: "At each periodic reconciliation, at most once per reconciliation, the daemon retries what failed with no input change to blame".

Glossary (`docs/glossary.md`), verbatim:

- **Invalidated run**: "A run whose inputs changed while it ran, so none of its results become current."
- **Interrupted run**: "A run stopped before it finished, so each test it had not finished gets no outcome from it."
- **Input fingerprint**: "A digest of every input, the environment, and the runtime and tool versions that can change a test's result."
- **Input revision**: "The number naming a worktree's inputs as the daemon last observed them in its current life, raised once for each batch of changes it observes."
- **Reconciliation**: "Reading every input again to establish the current input fingerprints, without relying on change events."

"Its inputs" in **Invalidated run** is, after this ticket, the run's workspace's narrowed inputs, as the fingerprint's are since 2.3g; the glossary needs no edit, since a workspace's inputs are what its fingerprint covers.

#### Orchestrator rulings

Decider the orchestrator, holding the owner's calls, unless a line names the owner. Each reason is the decider's.

- Q1 (AC1), 2026-09-28 06:09: a path change outside a workspace's narrowed inputs does not invalidate its run, provided its narrowed fingerprint at the end revision equals the one at its start; a change inside them, and every non-path cause (watcher failure, input set lost, the window's cap), still invalidate. Reason: freshness reads the same set, so a result kept this way is exactly as current as one no event touched. The verdict waits for the end revision's build and never guesses.
- Q2 (AC2), 06:09: abort a run a change inside its workspace's inputs touched, and requeue it; do not store the aborted run, which becomes an unstored job with its reason, and the workspace shows interrupted, then queued. Reason: a stored interrupted run would erase the outcomes the agent is fixing; the interruption stays a distinct state through the execution state. Name the starvation under a steady edit stream as a known limit.
- H1 (AC2), 06:18: interrupt only on a named path change inside the running workspace's inputs, judged once the newer revision's build has ended. An overflowed window interrupts when a path it names lies inside, and the overflow alone does not. A cause that names no path lets the run finish, stored not fingerprinted, rerun under 2.3f's rules. Reason: after a non-path cause nothing marks when the inputs are stable again, so interrupting could loop, and a run stored not fingerprinted never reads current, so no false freshness is at stake.
- H2, 06:18: the in-memory invalidated state moves to 2.3i, beside its only reader (C59).
- Periodic retry (AC4), 2026-09-29 05:01, from 2.3f's review debt: "the periodic retry (2.3f AC5) starves. Every reconciliation re-arms the 5-minute timer (ReconcileSchedule.periodic), and git HEAD or index moves request one, so an agent that commits more often than every 5 minutes holds off the retry indefinitely. Fix it here, since 2.3h edits input-tracker.ts anyway: count as periodic any reconciliation that ends at least RECONCILE_INTERVAL_MS after the last one counted. Add no new timer."
- Self-rewriting tests, decided by the owner, relayed 2026-09-29 01:12: a test that rewrites or recreates its own inputs on every run reruns without end; a later change request after 2.3h detects it and stops it. This ticket does not fix it, and names in its known limits that interrupting on change makes it worse.
- G1 (AC2), 2026-09-29 08:44, asked 08:43: a run that started with no input fingerprint (an unsettled start, or no build ended at its start revision after two discards in a row) is never interrupted; it finishes, is stored not fingerprinted, and 2.3f reruns it. Reason: it cannot read current, so nothing false comes of letting it finish, and a widened interrupt would trade one workspace's loop for a project-wide one.
- QA (AC2), 2026-09-29 08:54, asked 08:54 from the ticket review: a change interrupts a run only when a narrowed build places it inside the workspace's inputs; a widened set alone never interrupts (a failed or timed-out build, no selection input, a refused selection, builds that ended). AC1 still judges the run at its end over the widened set, so such a run is stored not fingerprinted and rerun. Reason: G1's; a widened interrupt is the project-wide loop, and letting the run finish never produces false freshness.
- QB (AC1), 08:54: judge every changed path, named or omitted; `MAX_NAMED_CHANGES` bounds only how many paths a reason or log line names, with a count of the rest. A watcher failure and a lost input set stay causes. This supersedes the overflow half of Q1 and H1, whose premise (the omitted paths cannot be placed) is false: `JobWindows.record` puts every description past the cap into `ChangeWindow.omitted`, an uncapped `Set`.
- Per-path placement (AC1, AC2), proposed by create-ticket from the review's Q-C and accepted at 08:54 with conditions: a changed path is placed by selecting it over a held build's dependency information, not by membership in that revision's set, so a file created and deleted between two ended builds is placed. It must never place outside a path set membership would place inside: a path selection reports as a declared non-input lies inside every workspace; a test module the discovery lists for the workspace lies inside it whatever selection says; a path whose selection is refused is a widened judgment, inside for AC1 and never an interruption. Each batch of changed paths is selected in one call, and each ended build's dependency information is held for the run.
- Settled by create-ticket and confirmed at 08:44: AC2 judges by AC1's builds, the start revision's and every one that ended during the run, so both use one predicate (C8); a build the run could not capture counts every input (widening); no change interrupts a run once a stop is asked; the periodic count's measure starts at the first reconciliation's end, and `PERIODIC_REASON`'s flag goes once the elapsed rule makes it redundant (C48, C57).
- The split, 2026-09-28 06:10: 2.3f, this ticket, and 2.3i, in that order.
- Ticket review, 2026-09-28 06:23 to 06:26, the findings that changed the ticket: F1 lets only a named path inside the inputs interrupt (H1); F2 gives the predicate each later revision's inputs, so a new file is named; F3 and F4 leave a run that finished before its abort landed, or was never interrupted, to AC1 and AC3; F6 aborts only the job judged (C157, C160); F7, settled toward widening: AC1 also counts a path in the inputs of any revision whose build ended while the run ran, so a file that joined the inputs and left them mid-run never leaves the run current.
- Ticket review, 2026-09-29 08:47 to 08:52, on the re-verified draft: applied F1 (AC1's "so" sentence excepts widened revisions), F2 (the older stored run keeps its own freshness, current when the change restored its inputs), F3 (no await between the end build and the end read), F4 (`abort`'s purpose defaults to a stop), F5 (test titles are create-tests'), F6, F7 (the timer constraint left the criterion), F8 (an end fingerprint that cannot be taken), F9, F10 and F11 (counts and the broken-tests search), F12 (how the abort callers were found), F13 in part (`#settle` already clears `#stopAsked`; the purpose clears with it), F14 (the clauses quoted above) and F15 (the reconciliation's own duration). Q-A and Q-B went to the orchestrator (QA, QB above); Q-C became the per-path placement; Q-D needed no change, since `#awaitBuild` returns once the builds stop (`DependencyBuilds.pending` is false after a stop), recorded in the lifecycle task.

#### Facts from #14 and the workflow, as of `main` at c75cf48

- A run whose executor exits while no stop was asked is stored as `crashed` (`Executor.run`, the `exited` reply). `Executor.abort` sets `#stopAsked`, so an exit after it settles the job as `lost`, which `run` returns as `ended: false`. The interruption's abort must go through `Executor.abort`, so it marks the stop asked and the lifecycle stores nothing, as AC2 says.
- An unhandled rejection on the executor's host thread is recorded as one of the session's errors, not fatal (`vitest/host-rejections.ts`, installed by `executor-main.ts`). The daemon's own process installs no such guard.
- The child's own abort text (`executor-main.ts` `STOP_REASON`) reaches no run record or daemon log, so `executor-main.ts` needs no change.
- There are no file claims: report the paths edited. Named defects are proven on Windows and Linux under Node 24 only. The push gate re-proves no defect. Tooling is frozen, so this ticket builds only `packages/` code.

#### Design notes

- **One predicate, two moments.** AC2's mid-run judgment and AC1's end verdict ask the same question (can this run still be stored under its starting fingerprint?) at two moments, so they share one predicate (C8). A mid-run judgment that says "keep" can be followed by an end verdict that says "not fingerprinted", since later changes arrive; never the reverse, since the end verdict counts every build a mid-run judgment saw.
- **Why each build the run saw places a path, and by selection.** A change to a path the start build places inside can reach what the run reads, even when reverted (the window names it). A new file can join a workspace's inputs by its location alone (selection gives a path to its owning package workspace and that workspace's dependents), or by a new import; a later build places it, and the end fingerprint differs when it stays. Placing each changed path by selecting it, rather than looking it up in a revision's set, places a file whether or not it exists at that revision, so one created and deleted between two ended builds still counts; `narrowedSets` builds each set from the same per-path selection, so the two never disagree (2.3g AC1). A path no build the run saw places inside is one no selection of the workspace includes, so its change stales nothing.
- **Holding each build's dependency information.** `DependencyBuilds` keeps only its latest ended build (`NarrowingState.latest`), so the watch captures each one as it ends and holds it for the run. `Narrowing.select` reads only the build's own selection input and dependency information, never the tracker's current state, so a held build can be asked about any path later. A build replaced before the watch captured it counts as widened, which only adds invalidations (never an interruption, QA).
- **Why a change interrupts only once the newer build has ended.** Before that build, the newer revision's narrowed set is unknown (2.3g), and interrupting on the start set alone would miss a new file; waiting for a build keeps one rule. A change inside the start set could interrupt sooner, but the build takes seconds against a run of minutes.
- **Why a widened placement never interrupts (QA).** While builds fail or time out, every path lies inside every workspace, so interrupting on it would stop every run at any edit anywhere, and a rerun starting at such a revision would be stopped again at the next edit. Letting the run finish costs nothing false: its end fingerprint is over the whole project, it is stored not fingerprinted, and 2.3f reruns it.
- **Why neither a non-path cause nor a start without a fingerprint interrupts (H1, G1).** After a watcher failure or a lost input set, nothing tells the daemon when the inputs are stable again, and a watch that cannot open fails again at each reconciliation, so an interrupt and rerun could loop. A run that started without a fingerprint cannot be stored under one; judging it would take every input as its set, so any edit anywhere would interrupt every such run. Both finish, are stored not fingerprinted, and keep their fresh outcomes, which read unknown.
- **Paths recorded while the input set is not established are causes.** `QueuedReads.read` records the batch it cannot read by event spelling, with no read behind it, and `#inputSetLost` has already recorded the loss; the end fingerprint is then unavailable anyway, so classing them as causes changes no stored verdict and keeps them from interrupting (H1).
- **Nothing stored, and 2.3f's rules.** An interrupted run stores nothing, so the workspace's latest stored run is still the older one, and 2.3f's next round finds it due unless the change restored the inputs that run was stored under (an edit reverted mid-run), in which case it reads current and nothing runs, correctly. The interrupting change moved the revision, so 2.3f AC2's once-per-revision rule does not hold it back. The scheduler needs no change: `Scheduler.#run` records the attempt at the run's start revision with nothing stored.
- **A stop and an interruption.** Once a stop is asked, the watch interrupts nothing, and the stop's abort and reasons apply as today (an interrupted run a stop leaves is stored not fingerprinted, since the stopped tracker's view is unavailable). A run interrupted by a change before a stop stores nothing, as AC2 says.
- **The periodic count.** The timer (`ReconcileSchedule.periodic`) is re-armed at the end of every reconciliation, so it fires at most `RECONCILE_INTERVAL_MS` after the last one ended; with the elapsed rule, the count rises no later than two intervals, plus the counted reconciliation's own duration, after the last counted one, however often other causes reconcile, and 2.3f's retry follows at the next round. The first reconciliation's end starts the measure, so the count is still 0 once it has ended (D2680). A reconciliation requested while another runs is absorbed into it, and counts when the one that ends is at least the interval after the last counted one (D2738).
- **Scope of the analysis.** Analyzed: a change outside, inside, and inside then reverted; a new file joining the set, and one created and deleted between two ended builds; a failed or timed-out build; a build replaced before it was captured; a non-path cause; a bulk change past the window's naming cap; a start without a fingerprint; a run ending before its interruption lands; an abort before the job was sent; a stop before and after an interruption; and the periodic count under frequent other reconciliations. Not analyzed: a discovery's verdict, which stays over every input; a dependency build's verdict; the answers' execution states (2.3i).

#### Known limits

- **A steady edit stream into one workspace's inputs keeps its run from finishing** until the edits pause: each change inside its inputs interrupts it, and 2.3f's quiet window delays the rerun (orchestrator, Q2).
- **A test that rewrites or recreates one of its own inputs on every run reruns without end** (owner, 2026-09-29 01:12), and this ticket makes that loop worse: each run is interrupted at the write, once the newer revision's build has ended, so no run of that workspace ever finishes. A later change request after this ticket detects such a workspace and stops rerunning it.
- **Interruption waits for the newer revision's dependency build**, a few seconds of a run that can no longer become current.
- **A change during a run that started without a fingerprint does not interrupt it** (G1): the run finishes and is rerun.
- **While dependency builds fail or time out, an edit interrupts no run** (QA): a widened placement never interrupts, so each run finishes, is stored not fingerprinted, and is rerun.
- **Judging a bulk change runs selection over every changed path on the daemon's thread** (QB), once per held build: a branch switch touching thousands of files costs about what backlog item 42 measures for the narrowing itself (about 0.75 s at 20,000 paths).

#### Pending siblings and their routing

- **2.3i** (backlog, builds after this ticket): shows each workspace's execution state (interrupted, then queued) and the due reason "its last run was interrupted by a change, naming the paths", and holds the invalidated label (H2). Its task edits `scheduler.ts` to expose "the interrupted state from 2.3h's interruption", so carrying the interruption's paths into the scheduler's state is 2.3i's; this ticket adds no field nothing reads (C59).
- **2.4, 2.4d, 2.4b** (ready-for-dev, build after 2.3i): name `lifecycle.ts`, `input-tracker.ts`, `queued-reads.ts`, `current-inputs.ts` and `scheduler.ts`, and read what this ticket leaves. 2.4b's superseded rule ("an input of a workspace covering the files at the bound revision or at a newer one, judged once that revision's dependency build has ended") asks this ticket's question of a wait, so `run-judgment.ts`'s predicate and `Narrowing`'s per-path placement are the parts it can reuse.
- **Live lanes, per the dispatch**: #36 edits `windows-job.ts`, and #19 edits `selection-facts.ts`, `protection.ts` and possibly the store. This ticket's file list shares none of them.

#### Current structure of the modified files

Read on `main` at c75cf48.

- `inputs/input-jobs.ts` (133 lines): `MAX_NAMED_CHANGES = 20`; `JobMark { window, unsettled? }`; `JobVerdict` (`fingerprinted: true`, or `false` with `reason` and `changedWhileRunning`); `ChangeWindow { named: string[], omitted: Set<string> }`; `JobWindows.open(unsettled)`, `record(description)` (every open window, one list of paths and causes alike), `close(mark, unavailable)`; `EventLedger`.
- `inputs/input-tracker.ts` (536 lines): `CurrentInputs`, `TrackedInputs` (`beginJob`, `endJob`, `periodicReconciliations`, `current(narrowing?)`, `changed`, `settled`); `InputTracker` records into `#jobs` from `#markUnhealthy`, `#inputSetLost` and `#settleReconciliation` (`for (const path of changed) this.#jobs.record(path)`); `#reconcileWhileRequested` ends each run of reconciliations with `#periodicRequested` counted into `#periodicEnded`, then `#schedule.periodic()`; `#requestReconciliation` sets `#periodicRequested` when the reason is `PERIODIC_REASON`.
- `inputs/queued-reads.ts` (180 lines): `QueuedReads.read` records each batch path by label when there is no filter or no established set; `#readPath`, `#readFile` and `#readDirectory` record what `InputState.remove`, `set` and `replaceUnder` return, through `record` or `#recordAll`.
- `inputs/reconcile-schedule.ts`: `RECONCILE_INTERVAL_MS = 5 * 60 * 1000` (not exported), `LOST_INPUT_SET_RETRY_MS`, exported `PERIODIC_REASON`; `ReconcileSchedule.periodic()` and `retryLostInputSet()` each replace the one timer.
- `inputs/narrowed-inputs.ts` (250 lines): `narrowingAt(query, revision)` gives a `WorkspaceNarrowing` (`narrowed` with its `Narrowing`, `building`, or `widened`); `Narrowing.select(paths)` runs `selectTests` over the build's own selection input and dependency information; `Narrowing.workspaceInputs(project, workspacePath)` reads sets `narrowedSets` computes once, from the first `project`, placing each path by its report through the private `includingWorkspaces` (every workspace for a declared non-input report).
- `inputs/current-inputs.ts`, unchanged: `currentInputs` reads `narrowingAt(narrowing, facts.revision)` and `unlessRefused`, and sets `inputsNotNarrowed` whenever its view widened, which the lifecycle reads for the start placement.
- `daemon/lifecycle.ts` (512 lines): `#run` settles, checks `#beginsNothing`, calls `beginJob`, reads `startInputs = this.#runInputs()` and `started`, awaits `executor.run`, then `endJob`, then `#bindings(..., verdict, () => unmoved(started, this.#runInputs().workspaceFingerprint(entry)))`; `#nothingStored(workspacePath, reason)`; `#awaitBuild(subject)`; `#stopSequence` calls `executor.abort()`; module functions `threwOutcome`, `unmoved`, `MOVED_DURING_RUN_REASON`.
- `daemon/executor.ts` (370 lines): `abort()` with no argument; `ABORTED_BEFORE_SEND_REASON` ("the stop arrived before the job was sent..."), logged and returned by `#unsent`; `#stopAsked`; `run` maps an `exited` reply to a `crashed` run and every other failure to `ended: false`.

#### Sizing

About 15 raw files and 20 estimated (19.5 before rounding, so under the limit); code units 5 (4 criteria plus validation). Production: modify `inputs/input-jobs.ts`, `inputs/input-tracker.ts`, `inputs/queued-reads.ts`, `inputs/reconcile-schedule.ts`, `inputs/narrowed-inputs.ts`, `daemon/lifecycle.ts`, `daemon/executor.ts`; create `daemon/run-judgment.ts`. Tests, for create-tests: `lifecycle.test.ts`, `scheduling-harness.ts`, `input-tracker.test.ts`, `executor.test.ts`, `scheduler.test.ts`, `daemon.test.ts` and `packages/daemon/test/defects.json`. Over 10 estimated, so dev delegates, though the groups form a chain: the window, tracker and periodic count (`input-jobs.ts`, `input-tracker.ts`, `queued-reads.ts`, `reconcile-schedule.ts`) and the per-path placement (`narrowed-inputs.ts`) first, then the judgment and interruption (`run-judgment.ts`, `lifecycle.ts`, `executor.ts`), which read their shapes.

No edit to `scheduler.ts` or `dependency-builds.ts` is planned. If the build finds one needed, report it before making it: each carries many named-defect records to re-prove.

#### Named-defect records the edits reach

A lane re-proves every record whose test or mutated file it edits. Records in `packages/daemon/test/defects.json` whose mutated file this ticket edits, counted on c75cf48 by each record's `file` field: `lifecycle.ts` 59, `executor.ts` 33, `input-tracker.ts` 24, `input-jobs.ts` 7, `narrowed-inputs.ts` 7, `queued-reads.ts` 7, `reconcile-schedule.ts` 2. Count the `--changed` selection before proving, and prove by `--ids`. Three `input-tracker.ts` records mutate the `if (reason === PERIODIC_REASON) this.#periodicRequested = true;` line AC4 removes, so each loses its anchor and is re-pointed at the elapsed rule or deleted with its test's `D###` title, by create-tests.

#### Existing tests this change breaks

- `packages/daemon/test/lifecycle.test.ts`: D1877 (a run whose inputs changed is stored not fingerprinted, scripted with the verdict `its inputs changed while it ran: packages/a/src/a.ts`) and D1878 (a fingerprint that differs at the end); the stand-in tracker's scripted `JobVerdict`s and `StandInExecutor.abort` gain what the split window, the predicate and the abort's purpose need; D2519 and D2740 read the verdict path.
- `packages/daemon/test/scheduling-harness.ts`: the stand-in tracker's `beginJob`/`endJob` (`new JobWindows().open(undefined)`, scripted verdicts) and `periodicReconciliations`.
- `packages/daemon/test/input-tracker.test.ts`: tests reading a job's verdict reason (D1897, D1920, D1945, D1947, D2077, D2155, D2687); the periodic count tests D2680, D2681, D2737 and D2738, whose titles describe the timer's request. Its fake timers advance `RECONCILE_INTERVAL` (a local `300_000`); if the elapsed rule reads `performance.now()`, each fake clock needs `"performance"` in `toFake`, as 2.3f's review found for `scheduler.test.ts`.
- `packages/daemon/test/executor.test.ts`: D1684, D2244, D2245, D2251 and D2778 call `abort()`.
- `packages/daemon/test/scheduler.test.ts`: the periodic retry tests (D2660 to D2733) through the harness, if its tracker's shape changes.
- `packages/daemon/test/daemon.test.ts`: a real daemon; an edit during a run now interrupts it when the edit is inside the running workspace's inputs.
- `packages/daemon/test/defects.json`: the anchors above, and every record in the edited production files, which the lane re-proves.
- Found by `rg -c "abort|ABORTED_BEFORE_SEND|stop arrived before|PERIODIC_REASON|its inputs changed while it ran|JobWindows|JobVerdict|JobMark|MAX_NAMED_CHANGES|changedWhileRunning|periodicReconciliations|MOVED_DURING_RUN|RECONCILE_INTERVAL|endJob|beginJob|Narrowing\b|narrowingAt" packages/daemon/test` (2026-09-29 08:57). Besides the files above it hit `force-stop.test.ts` and `discover-tests.test.ts` (their own `AbortController`s), and `query.test.ts`, `round-fixtures.ts`, `selection/harness.ts` and `selection/select-tests.test.ts` (they build or call a `Narrowing`, whose existing members keep their shape). The typecheck reports each shape change (P14).

#### Doc text

A draft for the orchestrator, its final wording to follow the build.

- `docs/architecture.md`, the daemon paragraph: "storing the discovery and each run under the input fingerprint it started from, or as not fingerprinted when its inputs moved while it ran." becomes "storing the discovery under the input fingerprint it started from, or as not fingerprinted when its inputs moved while it ran, and each run as the input tracker's paragraph says. A change inside a running workspace's inputs interrupts its run; nothing is stored for it, the job is listed with the paths, and the workspace runs again once the inputs settle."; and "are retried at each periodic reconciliation." becomes "are retried at each periodic reconciliation, which is any reconciliation that ends at least 5 minutes after the last one counted as periodic."
- `docs/architecture.md`, the input tracker paragraph: "It is stored under the fingerprint it started from only when no input changed and no event named one while it ran; otherwise it is stored not fingerprinted, and the log names the changes." becomes "A discovery is stored under the fingerprint it started from only when no input changed and no event named one while it ran. A run is, only when it started with a fingerprint; no watcher failure or loss of the input set was recorded while it ran; no path that changed or that an event named while it ran lies among its workspace's inputs by the dependency build at the revision it started at, any that ended while it ran, or the one at the revision it ended at, each path placed by selecting it over that build's dependency information, and every path by a build that failed or timed out; and its workspace's fingerprint at the revision it ended at, once that revision's build has ended, equals the one it started from. Otherwise it is stored not fingerprinted, and the log names why. A change only outside the workspace's inputs leaves the run's results current. A change a narrowed build places inside them interrupts a run that started with a fingerprint once the newer revision's build has ended; nothing is stored for it, the job is listed with its reason, and the workspace runs again. While builds fail, an edit interrupts no run."
- The input tracker paragraph's known limits: add "a steady stream of edits into one workspace's inputs, which keeps its run from finishing until the edits pause; and a test that rewrites one of its own inputs on every run, whose runs are each interrupted and rerun without end".

#### Previous ticket

2.3f (done): the scheduler runs, one at a time, each confirmed workspace whose latest stored run is not bound to its current fingerprint, at most once per revision and list of test modules (once more when a change left the revision unmoved), after a 1,000 ms quiet window and the revision's dependency build, direct targets first, and retries what failed or stored nothing at the periodic reconciliation. Its completion notes: `#run` does not wait for the dependency build itself, since the scheduler's round wait (`#awaitBuild("the round")` in `Scheduler.#quiesce`) is the one build wait before a job, and a second wait restarted the discard count; this ticket's wait for the end revision's build comes after the job, so it does not stack on the round's. Its review debt handed this ticket the periodic starvation (ruled 05:01) and left open coverage gaps on `input-jobs.ts` and the periodic count (gaps 1, 10 and 11), which AC4's tests touch.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3h, § Ticket 2.3f, § Ticket 2.3g, § Ticket 2.3i, § Ticket 2.4b.
- Tickets 2.3f (`_agent-docs/tickets/2-3f-schedule-runs.md`, its Review Record and Completion Notes), 2.3g (`_agent-docs/tickets/2-3g-narrow-fingerprints.md`) and 2.3i (`_agent-docs/tickets/2-3i-schedule-answers.md`).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (2026-09-29 08:39).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C8,C11,C14,C25,C38,C39,C42,C46,C48,C55,C57,C59,C113,C116,C126,C131,C142,C154,C157,C160,C167 -->

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
sizing_ac_count: 5
files_to_modify:
  - packages/daemon/src/inputs/input-jobs.ts
  - packages/daemon/src/inputs/input-tracker.ts
  - packages/daemon/src/inputs/queued-reads.ts
  - packages/daemon/src/inputs/reconcile-schedule.ts
  - packages/daemon/src/inputs/narrowed-inputs.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/executor.ts
files_to_create:
  - packages/daemon/src/daemon/run-judgment.ts
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

- _agent-docs/tickets/2-3h-judge-runs.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3h added and linked, under the orchestrator's 06:10 grant)
- _agent-docs/tickets/2-3h-judge-runs.md (re-verified and rewritten by create-ticket, 2026-09-29, against `main` at c75cf48, with the 05:01, 01:12, 08:44 and 08:54 rulings)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3h scope, under the 2026-09-29 dispatch's grant)
- _agent-docs/sprint-status.yaml (2-3h-judge-runs to ready-for-dev, under the same grant)

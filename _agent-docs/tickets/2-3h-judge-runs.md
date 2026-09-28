# Ticket 2.3h: Judge and interrupt a run by its workspace's inputs

## Ticket

As an agent editing one workspace of a consumer while the daemon runs another,
I want a run judged only by the inputs its workspace's results depend on, and a run my edit made worthless stopped at once and started again,
so that my edits elsewhere never throw away a long run's fresh results, and an edit to the running workspace gets me fresh results without waiting out a run that can never become current.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: A run is stored under the input fingerprint it started from exactly when all of these hold: its inputs were settled when it started; no cause that names no path was recorded while it ran (the watcher failed, the input set could not be established, or more changes than the job's window names); no path that changed while it ran, or that an event named, lies among its workspace's inputs at the revision it started at or at any revision whose dependency build ended while it ran; and its workspace's fingerprint at the revision it ended at, taken once that revision's dependency build has ended, finished or failed, equals the one it started from. So a change only outside the running workspace's inputs leaves its run stored under its fingerprint, and its results read current, while a change inside them, even one reverted before the run ended, leaves it stored not fingerprinted. A discovery is still judged over every input.
- [ ] AC2: While a run is in progress, once the dependency build of a newer input revision has ended and a path that changed since the run started lies among its workspace's inputs at the revision it started at or at that newer revision, the run is interrupted at once. Nothing is stored for it: the daemon lists it among the jobs that ended with nothing stored, with a reason naming the path or paths that interrupted it and never a stop, and the workspace's latest stored run, with its outcomes, stays as it was, reading stale. The workspace then runs again once the inputs settle, by ticket 2.3f's rules. A cause that names no path does not interrupt a run; AC1 decides its verdict when it ends. A stop's interruption keeps its own reason.
- [ ] AC3: A run that ends uninterrupted (with no interruption decided, or before its interruption lands) and that AC1 does not store under its fingerprint is stored not fingerprinted, as today, and runs again by ticket 2.3f's rules; the log names each changed path, or each cause that names no path, that decided its verdict.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. Interrupting a run is the executor's existing abort, which a stop already uses.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read the landed code of ticket 2.3f (`daemon/scheduler.ts`, its round and queue, and the lifecycle's job path) and ticket 2.3g (the narrowing state in `inputs/current-inputs.ts`, `daemon/dependency-builds.ts`, and the build wait before a fingerprint is taken), and confirm the names this ticket uses (§ Pending siblings and their routing).
- [ ] (AC1) In `packages/daemon/src/inputs/input-jobs.ts`, keep a job window's changed paths apart from its causes that name no path, and keep whether it overflowed its named bound (`MAX_NAMED_CHANGES`); in `packages/daemon/src/inputs/input-tracker.ts`, record each through the right one: `#recordAll` and the reconciliation's changed paths are paths, and `#markUnhealthy`, `#inputSetLost` and a batch read while the input set is not established are causes (a path named while the set cannot be established is also a cause, since its read cannot be trusted). An overflowed window keeps the paths it named; its overflow alone is a cause for AC1 (the omitted paths cannot be placed). Keep the discovery's verdict as today: any path or cause.
- [ ] (AC1, AC2) Write one predicate, used both while a run is in progress (AC2) and when it ends (AC1), never two spellings (C8): given a job's window, the workspace's narrowed input paths at the revision the run started at and at each later revision whose build has ended while it runs (held as they arrive), and its narrowed input paths and fingerprint at the latest such revision (the whole project's when that build failed), it answers whether the run can still be stored under its starting fingerprint and, when not, why, naming the paths. Take the narrowed inputs from 2.3g's narrowing state, reading the start revision's set when the run begins and holding it for the run (C160: read beside the job mark). When 2.3g's build at a revision failed, that revision's fingerprint is over the whole project, which differs from a narrowed start, so the run is not stored under it (widening, C126).
- [ ] (AC1, AC3) In `packages/daemon/src/daemon/lifecycle.ts` `#run`, judge the ended run with that predicate in place of today's any-path verdict and `unmoved`, once the end revision's build has ended (2.3g AC3), and store it under its starting fingerprint only when the predicate says so. Log each path, or each cause that names no path, that decided a not-fingerprinted verdict (AC3).
- [ ] (AC2) In `packages/daemon/src/daemon/scheduler.ts`, while a run is in progress, after each newer revision's build has ended, apply the predicate to the running job's window so far; interrupt it through the executor and mark it interrupted for invalidation only when the predicate's reason names a changed path inside the narrowed inputs of the start revision or of a revision whose build ended while it runs, never on a cause that names no path, an overflow alone, or a fingerprint difference no named path explains (AC2, H1). In the lifecycle, a run so interrupted stores nothing when the executor returns an interrupted `WorkspaceRun` or a job that ended with nothing (a run it returns finished, before the abort landed, is judged by AC1 and AC3 instead), and goes to `#nothingStored` with a reason naming the changed paths, as a named constant plus the paths (C3). Its workspace stays due, since its latest stored run is not current, and 2.3f's next round runs it. A stop's abort keeps the stop's reasons (`DISCOVERY_STOPPED_REASON`, `ABORTED_BEFORE_SEND_REASON`); give the executor's abort the reason it should report, so an abort for invalidation never reads as a stop (C131). Interrupt only the job the predicate judged: confirm it is still the executor's job in progress with no await between that check and the abort (C157, C160), so a judgment that awaited a build never aborts the job after it.
- [ ] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files, and `bun run --filter @rt-test/daemon typecheck` (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `JobWindows`, `JobMark`, `JobVerdict` (`inputs/input-jobs.ts`): the change window each running job already keeps, and the verdict kind ticket 2.3f adds (a change while the job ran, apart from an unsettled start or an unavailable fingerprint); AC1 splits what the window holds rather than adding a second window, and keeps 2.3f's kind meaning "invalidated by a change", now judged against the workspace's inputs.
- 2.3g's narrowing state (`inputs/current-inputs.ts`) and `ProjectInputs` (`inputs/fingerprint.ts`): a workspace's narrowed inputs at a revision, as a set of root-relative paths with their digests, and its fingerprint.
- 2.3g's dependency builds (`daemon/dependency-builds.ts`): the wait for a revision's build, before a fingerprint is compared (AC1) or a mid-run judgment is made (AC2).
- `Executor.abort` (`daemon/executor.ts`): interrupting the job in progress, as a stop does.
- `DaemonLifecycle` `#run`, `#bindings`, `#nothingStored` (`daemon/lifecycle.ts`): the verdict, storage and unstored-job paths the interruption reuses; `UnstoredJob` (`daemon/protocol.ts`) carries its reason to `status` and every answer.
- 2.3f's scheduler (`daemon/scheduler.ts`): the round that reruns the interrupted workspace.

### Must Create

- The predicate that judges a run by its workspace's narrowed inputs (AC1, AC2), beside `JobWindows` or in its own module.
- The reason text for a run interrupted by a change, and for the paths that decided a verdict (AC2, AC3).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The second of the three tickets the unsplit 2.3f became (orchestrator, 2026-09-28 06:10). Ticket 2.3f schedules discoveries and runs of what is not current; this ticket narrows when a run is invalidated and interrupts one that can no longer become current; ticket 2.3i shows the schedule in every answer. Build order: 2.3d, 2.3e, 2.3g, 2.3f, 2.3h, 2.3i. Until 2.3i lands, an interrupted run shows as a job with nothing stored in `status` and every answer (`unstoredJobs`), and the log names why.

Requirements this ticket serves (`docs/requirements.md`):

- "FR8: Execute every selection in the daemon, and record a run whose inputs changed while it ran as invalidated and rerun it from stable inputs." (AC1, AC2, AC3)
- "NFR1: Never execute a test while it holds a current result for the same input fingerprint, except to falsify it or to rerun an invalidated run." (AC1: a run kept under its fingerprint is not rerun)

Rule clauses the criteria rest on:

- `docs/architecture.md` § Identity and freshness: "Results belong to the inputs actually executed. If an input changes during a run, do not promote that run to current: record it as invalidated and rerun from stable inputs." (AC1, AC2)
- `docs/architecture.md` § Execution and falsification isolation: "Cancellation must leave explicit interrupted or stale states." (AC2: the latest stored run reads stale, and the interruption is an unstored job with its reason)
- AGENTS.md § Product guarantees: "Never report historical results as current after a relevant edit or unresolved input change." (AC1)
- AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states." (AC2)
- Ticket 2.1 AC11 and 2.3g AC1: a workspace's narrowed inputs always include its own test modules, so a change to one of them always lies inside.

Glossary (`docs/glossary.md`), verbatim:

- **Invalidated run**: "A run whose inputs changed while it ran, so none of its results become current."
- **Interrupted run**: "A run stopped before it finished, so each test it had not finished gets no outcome from it."
- **Input fingerprint**: "A digest of every input, the environment, and the runtime and tool versions that can change a test's result."

"Its inputs" in **Invalidated run** is, after this ticket, the run's workspace's narrowed inputs, as the fingerprint's are since 2.3g; the glossary needs no edit, since a workspace's inputs are what its fingerprint covers.

#### Orchestrator rulings

Asked by `session_wake` at 06:07 on 2026-09-28, answered at 06:09; decider the orchestrator, holding the owner's calls overnight. Each reason is the orchestrator's.

- Q1 (AC1): a path change outside a workspace's narrowed inputs does not invalidate its run, provided its narrowed fingerprint at the end revision equals the one at its start; a change inside them, and every non-path cause (watcher failure, input set lost, the 20-change cap), still invalidate. Reason: freshness reads the same set, so a result kept this way is exactly as current as one no event touched. The verdict waits for the end revision's build and never guesses.
- Q2 (AC2): abort a run a change inside its workspace's inputs touched, and requeue it; do not store the aborted run, which becomes an unstored job with its reason, as status already reports, and the workspace shows interrupted, then queued. Reason: the plan says to preserve historical failures after edits, and a stored interrupted run would erase the outcomes the agent is fixing; the interruption stays a distinct state through the execution state. Name the starvation under a steady edit stream as a known limit.
- H1 (AC2), asked at 06:17, answered at 06:18: interrupt only on a named path change inside the running workspace's inputs, judged once the newer revision's build has ended. An overflowed window interrupts when any path it names lies inside, and the overflow alone does not. A cause that names no path lets the run finish, stored not fingerprinted, rerun under 2.3f's rules. Reason: after a non-path cause nothing marks when the inputs are stable again, so interrupting could loop, and a run stored not fingerprinted never reads current, so no false freshness is at stake. This corrects the 06:10 split wording, which had a non-path cause interrupt too.
- H2, answered at 06:18: Q7's in-memory invalidated state moves to 2.3i, beside its only reader (C59). Q7 itself: the invalidated state lives in memory for the daemon's life, with no schema change.
- Split (06:10): 2.3f, this ticket, and 2.3i, in that order.
- Ticket review (create-ticket 6c, 06:23 to 06:26): 10 findings, 9 applied. F1 lets only a named path inside the inputs interrupt (H1); F2 gives the predicate each later revision's paths, so a new file is named; F3 and F4 leave a run that finished before its abort landed, or was never interrupted, to AC1 and AC3, and log a cause that names no path; F5 tagged AC3's task; F6 aborts only the job judged (C157, C160); F8 and F9 corrected the doc text and the broken-tests method. F7, a question, was settled by create-ticket toward widening: AC1 also counts a path in the inputs of any revision whose build ended while the run ran, so a file that joined the inputs and left them mid-run never leaves the run current (AGENTS.md: never report results current after a relevant edit); it only adds invalidations, so it cannot loop. F10 (the raw file count beside its list) was rejected: create-ticket's sizing format reports the raw count.

#### Design notes

- **One predicate, two moments.** AC2's mid-run judgment and AC1's end verdict ask the same question (can this run still be stored under its starting fingerprint?) at two revisions, so they share one predicate (C8). A mid-run judgment that said "keep" is followed by an end verdict that can still say "not fingerprinted", since later changes arrive; never the reverse, since the end verdict counts every set a mid-run judgment saw.
- **Why the start revision's inputs and the newer one's.** A change to a path in the start set can reach what the run reads, even when reverted (the window names it). A new file that the start set lacks can join the set at the newer revision (a new module in the workspace's directory, or a new import); the newer revision's fingerprint then differs, so the run is not stored under the start's. A path in neither set is one no selection of the workspace includes, at either revision, so its change stales nothing (2.3g AC1).
- **Why a change interrupts only once the newer build has ended.** Before that build, the newer revision's narrowed set is unknown (2.3g AC3), and interrupting on the start set alone would miss a new file; waiting a build keeps one rule. A change inside the start set could interrupt sooner, but the build is seconds against a run of minutes.
- **Why a non-path cause does not interrupt (H1).** After a watcher failure or a lost input set, nothing tells the daemon when the inputs are stable again, and a watch that cannot open fails again at each reconciliation, so an interrupt-and-rerun could loop. The run finishes, is stored not fingerprinted, and keeps its fresh outcomes, which read unknown.
- **Nothing stored, and 2.3f's rules.** An interrupted run stores nothing, so the workspace's latest stored run is still the older one, not current at the newer revision, and 2.3f's next round finds it due. It is a new revision, so 2.3f AC2's once-per-revision rule does not hold it back.
- **Scope of the analysis.** Analyzed: a change outside, inside, and inside then reverted; a new file joining the set; a failed build; a non-path cause; a run ending before its interruption lands; and a stop. Not analyzed: a discovery's verdict, which stays over every input; the answers' execution states (2.3i).

#### Known limits

- **A steady edit stream into one workspace keeps its run from finishing** until the edits pause: each change inside its inputs interrupts it, and 2.3f's quiet window delays the rerun (orchestrator, Q2).
- **Interruption waits for the newer revision's dependency build**, a few seconds of a run that can no longer become current.

#### Pending siblings and their routing

- **2.3f** (builds before this ticket): the scheduler, its rounds and the lifecycle's job path, which this ticket edits after it lands.
- **2.3g** (builds before 2.3f): each workspace's narrowed inputs and fingerprint per revision, the build wait, and 2.3g Q4, which keeps any-change invalidation until this ticket.
- **2.3i** (builds after this ticket): shows each workspace's execution state (interrupted, then queued) and holds the invalidated label (Q7) in memory for the answers.

#### Sizing

About 11 raw files and 14 estimated; code units 4 (3 criteria plus validation). Production: `inputs/input-jobs.ts`, `inputs/input-tracker.ts` (or the module 2.3g extracts from it), `inputs/current-inputs.ts`, `daemon/lifecycle.ts`, `daemon/scheduler.ts`, `daemon/executor.ts`. Tests, for create-tests: `lifecycle.test.ts`, `input-tracker.test.ts`, `executor.test.ts`, `daemon.test.ts` and `packages/daemon/test/defects.json`. Over 10 estimated, so dev delegates, in two groups on disjoint files: the window and predicate (`input-jobs.ts`, `input-tracker.ts`, `current-inputs.ts`), then the interruption (`lifecycle.ts`, `scheduler.ts`, `executor.ts`).

#### Existing tests this change breaks

- `packages/daemon/test/lifecycle.test.ts`: D1877 ("a run whose inputs changed while it ran is stored not fingerprinted, and the log names the run and the change") and the tests near its reason `its inputs changed while it ran: packages/a/src/a.ts`; they hold where the changed path lies inside the workspace's inputs, and a stand-in whose narrowing leaves it outside now stores the run fingerprinted. Its stand-in `JobWindows` use and `StandInExecutor.abort` gain what the split and the abort reason need.
- `packages/daemon/test/input-tracker.test.ts`: tests reading a job's verdict reason (`its inputs changed while it ran: ...`), if the verdict's shape changes.
- `packages/daemon/test/executor.test.ts`: D1684 (an abort while the executor is being held) if `abort` takes a reason.
- `packages/daemon/test/daemon.test.ts`: a real daemon; an edit during a run now interrupts it when the edit is inside the running workspace's inputs.
- Found by `rg -n "abort|its inputs changed while it ran" packages/daemon/test` (06:17), before 2.3f and 2.3g landed and blind to tests that build or read a job window; dev-ticket reruns `rg -n "abort|its inputs changed while it ran|JobWindows|JobVerdict|MAX_NAMED_CHANGES" packages/daemon/test` once they land, including their scheduler and narrowing tests; the typecheck reports each shape change (P14).

#### Doc text

A draft for the orchestrator, final wording to follow the build.

- `docs/architecture.md`, the input tracker paragraph: "It is stored under the fingerprint it started from only when no input changed and no event named one while it ran; otherwise it is stored not fingerprinted, and the log names the changes." becomes "A run is stored under the fingerprint it started from only when no path among its workspace's inputs, at the revision it started at or any whose dependency build ended while it ran, changed and no event named one while it ran, no watcher failure, loss of the input set, or overflow of its change window was recorded, and its workspace's fingerprint at the revision it ended at, once that revision's dependency build has ended, equals the one it started from; otherwise it is stored not fingerprinted, and the log names why. A change outside the workspace's inputs leaves the run's results current. A change inside them interrupts the run once the newer revision's build has ended; nothing is stored for it, the job is listed with its reason, and the workspace runs again. A discovery is judged over every input."
- Known limits: add "a steady stream of edits into one workspace's inputs, which keeps its run from finishing until the edits pause".

#### Previous ticket

2.3f (authored in this lane, 06:07 to 06:18): the scheduler runs, one at a time, each confirmed workspace whose latest stored run is not bound to its current fingerprint, at most once per revision and list of test modules (once more when a change left the revision unmoved), after a 1,000 ms quiet window and the revision's dependency build, direct targets first, and retries what failed or stored nothing at the periodic reconciliation. 2.3g Q4 (orchestrator, 05:45) left this ticket's question open: any change invalidates until it lands.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3h, § Ticket 2.3f, § Ticket 2.3g.
- Tickets 2.3f (`_agent-docs/tickets/2-3f-schedule-runs.md`) and 2.3g (`_agent-docs/tickets/2-3g-narrow-fingerprints.md`).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (06:07).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C8,C14,C38,C39,C46,C48,C55,C59,C113,C116,C126,C131,C142,C154,C157,C160 -->

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
sizing_ac_count: 4
files_to_modify:
  - packages/daemon/src/inputs/input-jobs.ts
  - packages/daemon/src/inputs/input-tracker.ts
  - packages/daemon/src/inputs/current-inputs.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/scheduler.ts
  - packages/daemon/src/daemon/executor.ts
files_to_create: []
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

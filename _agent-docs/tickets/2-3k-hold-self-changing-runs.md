# Ticket 2.3k: Hold a workspace whose runs keep changing its inputs

## Ticket

As an agent, or the hook and `wait` that answer for one, working in a project whose tests change their own inputs,
I want the daemon to stop rerunning a workspace that keeps becoming due only through changes its own jobs made to the same file, and to say so, naming that file,
so that one test that rewrites a fixture never keeps the daemon busy forever, and I can tell a stale result nothing will rerun from one whose rerun is coming.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: The daemon tells each change to an input apart as job-caused or an edit, and counts every change the tracker reads as one or the other, never neither. A change is job-caused when the tracker records it inside the window of a run or a discovery that does not throw, from the job's start to its end, whichever workspace it reaches; a job that throws counts as no job, so its changes are measured as edits across it; a change recorded only while a dependency build runs, or while a discovery protects its files after its executor has ended, is not job-caused. An edit is a path whose digest differs between the end of one run or discovery and the start of the next, or between the end of the latest and now while none runs. Each changed path, job-caused or edit, lies in each workspace whose inputs the dependency build of the round that counts it places it in, by the rule a run's judgment places a path (selection over that build, a listed test module in its own workspace, and a path the build cannot place in every workspace), and in every workspace when that round's build widened or it proceeded without one. A change that names no path while a run or discovery runs (a watcher failure, a lost input set), any interval whose digests cannot be read, and any window or interval that changed more than `MAX_COUNTED_CHANGES`, 1,000, paths, count as an edit in every workspace; and a workspace for which more than `MAX_COUNTED_CHANGES` distinct paths changed since its last run began counts as having an edit in its inputs.
- [x] AC2: A workspace's count is decided each time a round finds it due while it is not held, from what happened since its last run in this daemon life began. It is one more than the count its last run began at when every one of these holds: it is due for a reason other than a periodic retry, and its current input fingerprint can be computed; its last run in this daemon life was interrupted by a change, stored not fingerprinted with a verdict that labels it invalidated (ticket 2.3i AC3: a changed path inside its inputs, or its fingerprint moved), or stored under its fingerprint; no edit has reached its inputs since that run began; and at least one job-caused path in its inputs since that run began also changed in every earlier counted time. When every other condition holds and the time has at least one job-caused path in its inputs but none that every earlier counted time shares, the count starts again at 1; anything else, a time with no job-caused path in its inputs included, sets it to 0. A run begins at the count decided for it. The run that begins at a count of 2 is not interrupted by a change, and the log says so, and why, as it begins; a stop still ends it. At `SELF_CHANGE_HOLD_COUNT`, 3, the workspace is held: no run of it begins, ticket 2.3f's periodic retry and its once-more rerun included, until an edit reaches its inputs, after which it runs as any due workspace does and its count starts again from 0. While held, its count is not decided again, so a round that finds it due only for a periodic retry leaves it held. So a test that rewrites one of its own inputs, and two workspaces whose tests write into each other's inputs, each stop after three runs. The counts, the holds and the record of changes are kept in memory only: a restart holds nothing and starts every count at 0.
- [x] AC3: While a workspace is held, no round is pending, and its latest run is not bound to its current fingerprint or is due a periodic retry, every summary and path-status answer, in `--json` and the CLI's text, gives it the idle state with the reason `self-changing`, which holds whatever other idle reason would apply (a round held after a failed step, a pending retry): no run is coming until an edit reaches its inputs or the daemon sees a change it cannot attribute (AC1), because the daemon's own runs and discoveries keep changing its inputs; while the round is held after a failed step, the CLI's text also names the daemon trying the held round again at the next input event or reconciliation, which may release it. The reason names each path that changed in all of its counted times, each with the jobs it changed during (the run of a named workspace, or the discovery), both lists up to `MAX_NAMED_CHANGES` with a count of the rest, beside its due reason as ticket 2.3i gives it. Its latest run keeps its own freshness and 2.3i's invalidated label, and its outcome and freshness counts do not change. The log says once, when the hold begins, that the workspace is held and why, naming those paths and jobs up to the same bound.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It reads the tracker's job windows and digests, the dependency builds' placement and the scheduler's own state.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Before the first edit, re-read the landed code of ticket 2.3r (`daemon/run-history.ts`, the record `daemon/scheduler.ts` now asks; `DependencyBuilds`' build wait) and confirm the names § Current structure gives, since this ticket was drafted before 2.3r built. Measure `lifecycle.ts` and `scheduler.ts` code lines after 2.3r (P16). Re-run the broken-tests search in § Existing tests this change breaks.
- [x] (AC1) In `packages/daemon/src/inputs/input-jobs.ts` and `packages/daemon/src/inputs/input-tracker.ts`, have a job's window keep the committed digests at its open and at its close, taken in the same synchronous step as the open inside `beginJob` and the close inside `endJob`, or none when the tracker cannot vouch for its inputs then (`#unavailableReason()`), so the lifecycle reads them from the mark and no change can fall between a window's edges and the digests an edit is measured from or to (C160). The window keeps every changed path, as it does today; `MAX_NAMED_CHANGES` bounds only the text that names them. Change no verdict: the dependency builds and the discovery's protection guard, which also open windows, ignore the digests.
- [x] (AC1, AC2) In `packages/daemon/src/daemon/lifecycle.ts`, have each run's and each discovery's report carry what its window recorded (every changed path, every cause that names no path) and its start and end digests, on every way a job that began ends (stored, stored nothing, interrupted, stopped); a job that did not begin reports none, and a run or discovery that throws leaves its changes to be measured as edits, since no report carries them (C167). Take a third argument on the scheduler's `run` part saying whether a change may interrupt the run, and when it may not, give `RunWatch` an interrupt that aborts nothing and returns false, so the watch records no interruption and the run is judged as one that finished while its inputs changed (stored not fingerprinted, invalidated, as § Scenarios' run 3 reads); log once at the run's start that a change will not interrupt it and why (AC2). Keep the `run started: <path>` line's text, which tests read. Add only fields, an argument and a line or two: the file's room after 2.3r is small.
- [x] (AC1) In `packages/daemon/src/daemon/run-judgment.ts`, export the placement rule a run's judgment uses (`placementOf` and the listed-module rule of `placedInside`), shaped so the count places a set of paths for a workspace over one round's build the same way, rather than restating it (C8, C14).
- [x] (AC1, AC2) In `packages/daemon/src/daemon/run-history.ts`, as 2.3r leaves it, add: the record of changes, each run's and discovery's job-caused paths with the job named (a `Pick<UnstoredJob, "workspacePath">`, undefined for the discovery) and the edits between jobs as digest differences (`changedPaths` in `round-selection.ts`), placed as AC1 says over the build of the round that decides a count; per workspace, its last run begun in this daemon life and how it ended, on the record's own `Attempt`: have a run that returns undefined (it never began) restore the attempt `began` replaced, as C167 says of a job that never begins, so the attempt is always the last run begun, and add to it how that run ended (qualifying or not, from the report or a throw); the count, the paths every counted time shares with the jobs each changed during, and the hold; and `SELF_CHANGE_HOLD_COUNT`, 3, with the uninterruptible count derived from it. Release a hold, and start its count from 0, when an edit reaches the workspace's inputs. A report's cause that names no path, an interval whose start or end digests are missing, and a window or interval past `MAX_COUNTED_CHANGES` changed paths are an edit in every workspace, placed nowhere (AC1, Q2, C22). Keep the change record and the same-path rule usable for a subject other than a workspace, since ticket 2.3l counts the discovery by the same rule over every input; build no discovery count here. Keep the record per subject, not as one shared log: fold each job's window and each interval between jobs into every subject's sets since its last run began (its job-caused paths with the jobs each changed during, its edit paths, and an edit-everywhere flag), unplaced, and clear a subject's sets when its run begins; place them over the build of the round that decides its count (Q1). A subject whose sets hold more than `MAX_COUNTED_CHANGES` distinct paths reads as edited (AC1), so memory is at most subjects times that bound and each decision places at most that many paths (C22). A shared log pruned "once nothing can read it" is not bounded, since a workspace that stays current keeps every change since its last run readable (dev's sanity check F1, 20:17).
- [x] (AC1, AC2) In `packages/daemon/src/daemon/scheduler.ts`, record into the history as the scheduler already decides, with no await between each read and the step it vouches for (C160): each plan's digests, each run's and discovery's report, and each run that throws (caught in `#runJob`), as a last run whose ending does not qualify it (decision (a)); in `#due`, decide each due workspace's count before `RunHistory.ranAlready` and the retry, and tell the history when `#run`'s report is undefined, so it restores the attempt; leave a held one out of the due list whatever its reason, and give the schedule its hold; start a run at the uninterruptible count through the `run` part's new argument; and log once when a hold begins. Since `#armRetries` runs before `#due`, have it skip a held workspace, and drop a workspace from `#retryWorkspaces` when its hold begins, so the periodic reconciliation's log line counts only workspaces that will retry and no stale retry marks the first run after a release (dev's sanity check F2, 20:17). Change no other decision.
- [x] (AC3) In `packages/daemon/src/query/answer.ts`, add `IDLE_REASON.selfChanging`, `"self-changing"`, to the open set 2.3i left, and to the idle state's `notRunning` an optional list of the shared paths, each with its jobs, both as `NamedList`s, reusing `UnstoredJob`'s job shape (C14). In `packages/daemon/src/daemon/workspace-schedule.ts`, have `#notRunning` read the hold through a new `ScheduleParts` member and give the held reason ahead of `round-held` and `retry-pending`, bounding both lists by `MAX_NAMED_CHANGES` (C23: the job window's dataset, as the interruption's paths are) and counting the rest (C24). Export from `packages/daemon/src/client.ts` only a type the CLI names (C59).
- [x] (AC3) In `packages/cli/src/answer-text.ts`, add the held reason's phrase to `IDLE_PHRASES` and render its paths and jobs, bounded as the answer is and counting the rest, each through `oneLine` or `firstLine` as today.
- [x] (Support) In `packages/daemon/src/daemon/protocol.ts`, raise `PROTOCOL_VERSION` from 2 to 3 (Q4): a 2.3i CLI renders the new idle reason as nothing. `CLI_JSON_SCHEMA_VERSION` stays, since every change is an added field or value (C151).
- [x] (Support) Send the orchestrator the doc text in § Doc text, its final wording to follow the build.
- [x] (Support) Lint and typecheck: `bun x oxlint` and `bun x prettier --check` over the changed files, `bun run --filter @rt-test/daemon typecheck` and `bun run --filter rt-test typecheck` (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `JobWindows`, `JobWindow`, `JobMark`, `MAX_NAMED_CHANGES` and `namedList` (`inputs/input-jobs.ts`): the window a job's changes are recorded in (every path, in a set), the bound on how many of them a text names, and the log's bounded list.
- `placementOf`, `placedInside`, `HeldPlacement` and `workspaceTestModules` (`daemon/run-judgment.ts`, `inputs/non-inputs.ts`): how a path is placed in a workspace's inputs over one build, exported by this ticket rather than restated (C8).
- `BuildPlacement.place` and `narrowingAt` (`inputs/narrowed-inputs.ts`): selection's placement over one build, and whether a revision's build narrowed.
- `changedPaths` (`daemon/round-selection.ts`): the digest difference between two snapshots, which the round's selection already uses.
- `CurrentInputs.snapshot` (`inputs/input-tracker.ts`): the committed digests at a round, undefined when they cannot be read.
- `RunHistory` (`daemon/run-history.ts`, ticket 2.3r): the per-workspace `Attempt` (revision, list of modules, stored nothing, rerun owed), `storedNothing`, `ranAlready`, and `began(entry, revision)`, which marks the run and returns the callback its report is handed to; the count extends it (C8).
- `JUDGMENT`, `NotKeptVerdict` and 2.3i's `INVALIDATING` set (`daemon/run-judgment.ts`, `daemon/workspace-schedule.ts`): which verdicts read a run invalidated; the count reads the same set (C8).
- `RunReport`, `DiscoverReport`, `EndedRun` (`daemon/scheduler.ts`, `daemon/workspace-schedule.ts`): what a job's end reports.
- `IDLE_REASON`, `NamedList`, `WorkspaceExecution` (`query/answer.ts`), `UnstoredJob` (`daemon/protocol.ts`): the idle reason's open set, the bounded list, and the job shape that names the discovery by leaving out the workspace.
- `IDLE_PHRASES`, `executionText`, `namedText`, `oneLine` (`cli/src/answer-text.ts`, `cli/src/output.ts`): the CLI's idle phrasing and bounded lists.

### Must Create

- The change record, the count and the hold in `daemon/run-history.ts`, with `SELF_CHANGE_HOLD_COUNT` and `MAX_COUNTED_CHANGES` (AC1, AC2).
- The window's end digests (AC1), the reports' job changes (AC1), and the `run` part's interrupt argument (AC2).
- `IDLE_REASON.selfChanging` and the idle state's shared-path list (AC3), and its CLI phrase.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Planned at f0983f0 from the owner's rulings, drafted on `main` at d6ea204 after 2.3h and 2.3i landed. Ticket 2.3r, split out of this one at 19:16, moves the build wait and the scheduler's run record out of the two files at lint's cap and builds first. Build order: 2.3r, 2.3k, then 2.3l, which counts the discovery by this ticket's rule, and 2.4b, whose wait reads the new idle reason.

Requirement this ticket serves (`docs/requirements.md`):

- "FR8: Execute every selection in the daemon, and record a run whose inputs changed while it ran as invalidated and rerun it from stable inputs; a workspace or discovery that keeps becoming due only through changes the daemon's own runs and discoveries made to the same file is held until an edit, and every answer says why." (AC1 to AC3; the discovery is 2.3l's)

Rule clauses the criteria rest on:

- AGENTS.md § Product guarantees: "Keep outcome, freshness, execution state, and falsification evidence independent." (AC3: the hold is an execution state and changes no count)
- AGENTS.md § Product guarantees: "Treat test execution as execution of project code." (AC1: a change during a run or discovery is job-caused, since both execute the consumer's code; a dependency build runs none)
- C169: "An answer that says a state lasts until an event names every source that can end it." (AC3: an edit reaching its inputs, or a change the daemon cannot attribute)
- C115: "A watcher overflow, missed event, branch switch or startup before reconciliation marks every result it could affect as unconfirmed or stale, never none." (AC1: a change naming no path is an edit everywhere, so it releases, never holds)
- C160: "A check whose answer vouches for state until an action relies on it ... runs with no await between it and that action." (AC1: the window's edges and their digests)
- C22: "Bound input before fanning out." (AC1: `MAX_COUNTED_CHANGES`)
- C116: "A run whose inputs changed while it ran is recorded as invalidated and rerun from stable inputs." AC2 departs from it as FR8 now requires: a held workspace's invalidated run is not rerun until an edit. The amendment goes to the orchestrator with § Doc text (C55, P21).
- Ticket 2.3i AC3: a run "stored not fingerprinted because its inputs changed while it ran (ticket 2.3h's verdict: a changed path inside its workspace's inputs, or its fingerprint at its end differing from the one at its start) reads as invalidated". (AC2: the qualifying verdicts)
- Ticket 2.3f AC2 and AC5 (a run at most once per revision and list of test modules, once more at an unmoved revision; the periodic retry): the two ways a workspace runs that the hold overrides (AC2).

Glossary (`docs/glossary.md`), verbatim, the two added by this ticket's grill:

- **Edit**: "A change to an input that the daemon does not attribute to one of its own runs or discoveries."
- **Self-changing workspace**: "A Vitest workspace that became due three times in a row only through changes the daemon's own runs and discoveries made to the same input, which the daemon holds, running it no more until an edit reaches its inputs."
- **Round**: "... A round is pending until that decision is made, and held after a scheduling step fails until the daemon tries again." The idle reason is `self-changing`, never a second "held", since a held round is another thing.
- **Invalidated run**: "A run whose inputs changed while it ran, so none of its results become current."
- **Interrupted run**: "A run stopped before it finished, so each test it had not finished gets no outcome from it."

#### Owner and orchestrator rulings

Decider and time on each line; the reasons are the decider's.

- Owner, 2026-09-29 01:12: a test that rewrites or recreates its own inputs on every run is stopped and explained, not rerun without end.
- Owner, 09:13, "Same file 3x": the same file must change in all three counted jobs; a time sharing none starts the count again at 1.
- Owner, 09:16, "Same file + hook": from ticket 2.7, the agent hook tells the daemon which files the agent edited, and a change to them is always an edit, so an agent's own edits never cause a hold. 2.7 builds it; this ticket leaves the change record open to it and adds nothing.
- Orchestrator, 09:05 to 09:13: a change made during any run or discovery is job-caused, so two workspaces writing into each other's inputs are held too; an edit is a change made while no such job runs; the third counted run is not interrupted, so there are results to mark; the hold overrides the periodic retry; a dependency build's window does not count.
- S1 (sizing), asked 19:14, decided by the orchestrator at 19:16: split the two extractions into ticket 2.3r, built before this one, changing no behavior. Reason: a behavior-neutral move stands alone, and it makes room for four tickets, since 2.4, 2.4d and 2.4b also write `lifecycle.ts`.
- Q1 (AC1), asked 19:14, decided by the orchestrator at 19:16: every change a round counts is placed over the build that round waited for, and in every workspace when that build widened or the round proceeded without one. Reason (create-ticket's, accepted): the build at a job's end revision often never exists, since builds at a revision the inputs moved past are discarded, and the round's build equals it whenever no change, an edit or another job's, came after the job.
- Q2 (AC1), 19:16: a cause that names no path during a run or discovery, like unreadable digests, is an edit in every workspace, so every count resets and every hold is released. Reason: C115, an unattributable change never narrows toward a hold.
- Q3 (AC3), 19:16: a held workspace reads `self-changing` even while the round is held after a failed step or a retry is owed, since neither runs it; while a round is pending it says nothing, as 2.3i does, since the pending round may be the edit that releases it.
- Q4 (Support), 19:16: `PROTOCOL_VERSION` rises from 2 to 3, as 2.3i raised it; `CLI_JSON_SCHEMA_VERSION` stays. The orchestrator has 2.4 and 2.4b's author reword "stays 2" as "unchanged by this ticket".
- Q5 (glossary), 19:16: both terms accepted, **Edit** reworded by the orchestrator as quoted above, under a grant for exactly those two entries.
- Decided by create-ticket at 19:14 and not vetoed at 19:16: (a) the "earlier run" is the workspace's last run begun in this daemon life, qualifying only as AC2 lists; a run that ended with nothing stored for another cause, was stored not fingerprinted for a cause that names no path, with no start fingerprint or with no end fingerprint, or threw, sets the count to 0, as does a workspace with no run begun in this life. (b) A change during a discovery's protection, after its executor has ended, or during a dependency build, is an edit when its digest differs, never job-caused. (c) The change record also feeds 2.3l; this ticket builds the workspace count only and leaves `#discoveryDue` alone. (d) 2.4b's AC3 list of nothing-coming idle reasons must gain `self-changing`; 2.4b's author owns that edit, relayed by the orchestrator when this ticket lands.

- S1 again, 19:26, decided by the orchestrator after the split: proceed at 19 raw and 25 estimated, dev delegates. Reason: the natural split (the hold in the daemon, its reason in the answer) leaves answers that break C169, and 2.3r has taken the extractions.
- Ticket review, one ticket-internal reviewer, 19:26 to 19:32, 17 findings, triaged by create-ticket at 19:33, all applied: a thrown run recorded as a non-qualifying last run and its changes measured as edits (1, 9); the edit-everywhere task (2); the uninterruptible run's log in AC2, and no claim that it always stores (3); the no-op interrupt returns false (4); digests at a window's open as well as its close, with AC1 stating the outcome, never neither (5, C2 and C5); the count's base, its restart at 1 and a held workspace's retry (6, 7, 8); the counts, searches and over-claims in the notes (11 to 16); C116's departure (17). Its question 10, whether a window keeps every path, settled on the code: `JobWindows` keeps every path in a set and `MAX_NAMED_CHANGES` bounds only the text; decided by create-ticket at 19:33, for the orchestrator's veto, a window or interval past `MAX_COUNTED_CHANGES`, 1,000, paths is an edit in every workspace, since placing each of a branch switch's paths per workspace per round is unbounded work (C22) and an edit never holds (C115). The orchestrator did not veto it (19:34), with its known limit, and writes the C116 rewording in § Doc text with this ticket's landing commit.
- Dev's sanity check (rt-t2-3k-dev, threadId 06dfcd31), 20:17, answered by create-ticket at 20:18. F1 CONFIRMED: a per-window bound left the shared record unbounded, since a workspace that stays current keeps every change since its last run readable; the record is kept per subject and a subject past `MAX_COUNTED_CHANGES` distinct paths since its last run began reads as edited, the same safe direction as the 19:34 bound (it resets and releases, never holds), sent to the orchestrator for veto. F2 CONFIRMED: `#armRetries` runs before `#due`, so it skips a held workspace and a hold drops the workspace's retry.

- From 2.3r's dev (its Completion Notes), relayed by the orchestrator at 19:40 for this ticket to decide: `RunHistory.began`'s mark that nothing is stored stays when the run never begins (a stop, or a revision that moved since the plan), as at d6ea204, though C167 says a job's mark is restored then; 2.3r's dev found no path where it changes a decision (`retryOwed` also needs the workspace stale, and a stale workspace is due again at the moved revision, where `ranAlready` no longer matches, so the next `began` overwrites the mark; after a stop nothing reads it). Decided by create-ticket at 19:41: restore it. Reason: this ticket's count reads "the last run begun" from the same record (C8, one record), which a mark left by a run that never began would misname; C167 asks for it; and the measured reach says no decision today changes.

- Review, Q-R1 (AC3, C169), asked by rt-t2-3k-review at 21:44, decided by the orchestrator at 21:45: a held workspace that an edit has reached, while the scheduling step that edit triggered failed, reads `self-changing` naming an edit that already came, since only `RunHistory.decide` releases a hold. Q: keep Q3's precedence as a known limit, or have each answer place the edits since the hold began? A: neither; while the round is held after a failed step, the CLI's text for `self-changing` also names the daemon trying the held round again at the next input event or reconciliation, which may release it. The idle reason stays `self-changing`. Reason (the orchestrator's): keeping it names a signal that has already come, against C169, and placing on every answer costs every summary and status to fix error-state text.
- Review, Q-R2 (AC3), asked 21:44, decided by the orchestrator at 21:45: the phrase "because its tests change their own inputs" is false when another workspace's run or the discovery made the change, as AC2's two-workspace case does. A: reword to "because the daemon's own runs and discoveries keep changing its inputs", amend AC3's gloss, and the tests session updates `HELD_LEAD` and re-proves D3174 to D3176.
- Review note, 21:44, agreed by the orchestrator at 21:45: the "Same file + hook" limit reaches a person's saves too, since any change recorded inside a run's window, which runs until `endJob` after the executor returns, is job-caused, and ticket 2.7's hook will vouch only for an agent's edits. The known-limits text reads "an agent or a person that edits...".
- Owner, 22:42, relayed by the orchestrator at 22:42, on the person-edits limit: keep 2.3k as built. A person's saves that land during jobs can hold a workspace as an agent's can; the hold always shows in every answer, it never reads a result current, and it lifts at the next edit that lands while no job runs. Ticket 2.7's hook will vouch only for an agent's edits, so the person case stays a documented known limit.

#### Decisions taken here

- **The count is decided when a round finds the workspace due while it is not held, and fixed when its run begins.** A workspace due behind others is decided again at each round until its run begins or it is held, so an edit that lands while it waits sets its count to 0 before it runs. A run that does not begin fixes nothing.
- **The held reason shows only while the workspace is not current or is due a retry**, as every 2.3i idle reason does; a held workspace that reads current says nothing more, and stays held.
- **Precedence:** `self-changing` over `round-held` over `retry-pending` and `no-run-until-input-change` (Q3). D3089 anchors the `round-held` line of `idleReason`; if the edit moves it, re-anchor it.
- **Placement is the run judgment's.** A path is inside a workspace's inputs for the count exactly when it would be inside for a run's verdict over the same build (C8), so a test's write that interrupts or invalidates its run is also one its count sees whenever the round's build places it as the run's own build did; a write that moves the graph can make the two builds differ (Q1).
- **Scope of the analysis.** Analyzed: the classification of each change against every window the tracker opens (run, discovery, the discovery's protection guard, the dependency build); each way a run ends and whether it qualifies; the count's three outcomes; the hold against the periodic retry, the once-more rerun and `#ranAlready`; the idle reason's precedence; the answer's bound. Not analyzed: the discovery's count (2.3l); the agent hook's attribution (2.7); what `wait` does with the new reason (2.4b).

#### Scenarios, traced against the rule

For create-tests; each follows AC2 from a fresh daemon.

- **One test rewrites its fixture `a/fixture.json` on each run.** Run 1 is interrupted at the write (2.3h); count 1 (the interruption qualifies, `a/fixture.json` job-caused, no edit). Run 2 is interrupted; count 2. Run 3 begins uninterruptible, finishes, is stored not fingerprinted and labeled invalidated; count 3, held. Answers read `self-changing`, naming `a/fixture.json` changed during the run of `a`.
- **Two workspaces write into each other's inputs.** `a` writes `b/x.json`, `b` writes `a/y.json`. Each count rises once per round trip; `a` reaches 3 on the third time `b`'s run changes `a/y.json`, and `b` stops once no run of `a` writes into it. Each has run three times.
- **An agent saves a file between jobs.** The save is an edit reaching the workspaces it lies in: their counts go to 0 and any hold on them is released.
- **A test writes a different path on each run.** Each time shares no path with the last, so the count restarts at 1 and never reaches 3: never held (a known limit).
- **Shared paths narrow.** Times sharing `{x, y}`, then `{y}`, then `{z}` count 1, 2, then 1 again, since `{z}` shares nothing with `{y}`.
- **A watcher failure during a run.** Its cause names no path, so it is an edit everywhere: every count goes to 0 and every hold is released (Q2).
- **A restart** holds nothing and counts from 0.

#### Current structure of the modified files

Read on `main` at d6ea204; the files 2.3r edited were read again on `main` at 65dafd6 (2.3r landed as 7d3ed21), whose code lines are the ones given here. 2.3q's merge at 65dafd6 touched none of this ticket's files.

- `inputs/input-jobs.ts` (149 lines, 107 code lines): `JobMark { window, unsettled? }`; `JobWindow { paths, causes }`; `JobWindows` with `open(unsettled)`, `recordPath`, `recordCause`, `close(mark, unavailable): JobVerdict`; `MAX_NAMED_CHANGES = 20`, `namedList`.
- `inputs/input-tracker.ts` (553 lines, 452 code lines): `beginJob()` opens a window with `#unavailableReason()`; `endJob(mark)` awaits `settled()`, then `return this.#jobs.close(mark, this.#unavailableReason())`. The committed digests are `this.#state.project().digests`, computed once per revision (`input-state.ts` `project()`), and `CurrentInputs.snapshot` is undefined whenever reads are pending, a reconciliation or protection walk runs, the watcher is unhealthy or the input set is not established (`current-inputs.ts` `unavailableReason`). `beginJob` has two callers besides the lifecycle's run and discovery: the discovery's protection guard (`#protectDiscovered`) and the dependency build (`dependency-builds.ts`).
- `daemon/lifecycle.ts` (524 lines, 451 code lines after 2.3r; the build wait is `this.#builds.awaitBuild(subject)` and the unstored list `UnstoredJobs` in `job-endings.ts`): `#discover` opens `mark = inputs.beginJob()` around `executor.discover` and returns `{ stored: false }` twice and `{ stored }`; `#run` opens `mark` before building `RunWatch`, whose `interrupt` part is `() => executor.abort(ABORT_PURPOSE.interruption)`, and returns `#settleRun`'s `RunReport`, built by its `report(stored, changed, ended)` closure.
- `daemon/scheduler.ts` (517 lines, 444 code lines after 2.3r): `SchedulerParts.run(entry, revision)` and `discover(revision)`; the constructor builds `this.#runs = new RunHistory({ log, revision })` and hands `WorkspaceSchedule` `storedNothing: (path) => this.#runs.storedNothing(path)`; `#plan` reads `view` once and returns a step with no await; `#due` computes `staleReason ?? retryReason` then skips `!retry && this.#runs.ranAlready(path, revision, entry)`; `#run` takes `recordEnd = this.#runs.began(entry, revision)` before the job, hands the report to it when there is one, and hands `WorkspaceSchedule.runEnded` the owed flag it returns; `#discover` wraps the job in `#schedule.during`.
- `daemon/run-history.ts` (122 lines, 89 code lines, created by 2.3r): `HistoryReport { revision, stored, changedWhileRunning }`, which `RunReport` satisfies structurally; private `Attempt { revision, modules, nothingStored, rerunOwed }`; `RunHistory` with `storedNothing(path)`, `ranAlready(path, revision, entry)`, and `began(entry, revision)`, which sets the attempt with `nothingStored: true` and returns `(report) => boolean`, recording the run's end and the two once-more log lines and returning whether it is owed once more. A run that never began leaves the mark (the decision above changes that).
- `daemon/run-judgment.ts` (431 lines, 346 code lines): module-private `HeldPlacement`, `placementOf(view, query)` (undefined while the build at the view's revision has not ended or the view vouches for no inputs) and `placedInside(facts)` (a path lies inside when a narrowed build's selection includes the workspace, that build cannot place it, a widened build is held, or it is a listed test module); `RunWatch` interrupts through its `interrupt` part only when it returns true.
- `daemon/workspace-schedule.ts` (501 lines, 418 code lines): `ScheduleParts { confirmed, storedNothing }`; `INVALIDATING` (changed-inside, moved); `#notRunning` returns nothing while the round is pending, else `{ why: idleReason(round, retrying), due }`; `idleReason` returns `round-held`, `retry-pending` or `no-run-until-input-change`.
- `query/answer.ts` (515 lines, 392 code lines): `IDLE_REASON { retryPending, noRunUntilInputChange, roundHeld }`; the idle state's `notRunning?: { why: IdleReason; due: DueFacts }`; `NamedList<T> { named, more }`.
- `cli/src/answer-text.ts` (381 lines, 337 code lines): `IDLE_PHRASES: Record<IdleReason, string>`, `executionText`.
- `daemon/protocol.ts`: `PROTOCOL_VERSION = 2`; `UnstoredJob { workspacePath?, reason }`, whose workspace path is undefined for the discovery.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3k` over this file list (19:07) named 2.3l, 2.3p, 2.4, 2.4b, 2.4c and 2.4d.

- **2.3r** (landed as 7d3ed21): moved `#awaitBuild` into `DependencyBuilds`, the unstored-jobs list into `job-endings.ts`, and the scheduler's run record into `run-history.ts`. This ticket extends that module.
- **2.3l** (backlog, builds after): counts and holds the discovery by this ticket's change record and rule, and reruns once a discovery stored not fingerprinted by a listed file no watch covers. This ticket builds neither and leaves `#discoveryDue` and `DiscoverReport`'s `stored` alone.
- **2.4, 2.4d** (ready-for-dev): write `lifecycle.ts` (the stop signal; `pathStatus`) and, for 2.4d, `input-tracker.ts` (a named read) and `protocol.ts` (2.4). Order is the orchestrator's; neither touches a job's window.
- **2.4b** (ready-for-dev, builds after): reads the idle reasons as nothing coming (its AC3), and writes `scheduler.ts`, `workspace-schedule.ts`, `answer.ts` and `protocol.ts`. Its AC3 list gains `self-changing` (decision (d)).
- **2.3p** (backlog): writes `input-jobs.ts`, `input-tracker.ts` and `run-judgment.ts` (a listed gitignored file's events reach running jobs). Its events then reach windows too, so they become job-caused or edits by this ticket's rule with no change here.
- **2.7** (backlog): the agent hook reports the files its agent edited, and a change to them is always an edit (owner, 09:16).
- **2.3q** (building in Tree 1): writes `vitest/load-vitest.ts`, `vitest/selection-facts.ts`, `inputs/env-files.ts`, `store/columns.ts` and `store/schema.ts`; none is on this ticket's list (orchestrator, 19:06 and 19:16).

#### Existing tests this change breaks

- `packages/daemon/test/scheduler.test.ts`: its rig's `discover` and `run` stand-ins build `DiscoverReport` and `RunReport` by hand, which gain the job's changes; the typecheck finds them.
- `packages/daemon/test/scheduling-harness.ts`: `StandInInputs.endJob` closes its windows through `JobWindows.close(mark, undefined)`, which gains the end digests; the lifecycle's tests of AC1 need the stand-in to give them.
- `packages/daemon/test/input-tracker.test.ts`: builds `new JobWindows()` and calls `close(mark, ...)` directly, comparing verdicts with `toStrictEqual`; it breaks only if the close's signature or the verdict's shape changes, which the input-jobs task avoids for the verdict.
- `packages/daemon/test/lifecycle.test.ts`: imports `JobWindows` for a stand-in (`windows = new JobWindows()`), and reads log lines; `run started: <path>` keeps its text. It is where the end-to-end tests of AC1 to AC3 go.
- `packages/cli/test/cli.test.ts`: `IDLE_PHRASES` is keyed exhaustively, so the CLI change is required, and existing expectations are unaffected; the new phrase's tests go here.
- `packages/daemon/test/query.test.ts` (its `new WorkspaceSchedule({` helper) and `packages/daemon/test/scheduler.test.ts` (a `new WorkspaceSchedule({` in its schedule tests): each builds `ScheduleParts` by hand, which gains the hold member, so both fail the typecheck until they supply it (`rg -n "ScheduleParts|new WorkspaceSchedule" packages/daemon/test packages/cli/test`, 19:33). `ScheduleReader` keeps its shape.
- `PROTOCOL_VERSION` 2 to 3: every test pin derives from `PROTOCOL_VERSION` since 2.3i, and no tracked file outside `protocol.ts` matches the three pin forms searched; the first task re-runs it with `protocolVersion"?:\s*2` over test fixtures too (`rg -n "protocolVersion: 2|protocol version 2|PROTOCOL_VERSION = 2"` over `git ls-files`, 19:19: only `protocol.ts` and two ticket files' history).
- Found by `rg -c "beginJob|endJob|JobWindow|JobMark|RunReport|DiscoverReport|changedWhileRunning|IDLE_REASON|IdleReason|notRunning|IDLE_PHRASES|interrupt:|SchedulerParts|ScheduleParts|placementOf|awaitBuild|DISCARDS_A_RUN" packages/daemon/test packages/cli/test` (19:11), then reading each hit, and `rg -l "IDLE_REASON|notRunning|retry-pending|round-held"` over every tracked file outside the packages' sources and the docs: no reader outside the two test directories.

#### Named-defect records the edits reach

A lane re-proves every record whose test or mutated file it edits. By each record's `file` field at d6ea204, before 2.3r moves any: `lifecycle.ts` 72, `scheduler.ts` 47, `workspace-schedule.ts` 38, `answer-text.ts` 32, `input-tracker.ts` 26, `run-judgment.ts` 24, `client.ts` 12, `input-jobs.ts` 8, `protocol.ts` 5, `answer.ts` 3, and whatever `run-history.ts` holds after 2.3r. Count the `--changed` selection before proving, and prove by `--ids`.

#### Sizing

19 raw files, 25 estimated (24.7); 4 code units (3 criteria plus validation). Production: modify `inputs/input-jobs.ts`, `inputs/input-tracker.ts`, `daemon/lifecycle.ts`, `daemon/run-judgment.ts`, `daemon/run-history.ts` (created by 2.3r), `daemon/scheduler.ts`, `daemon/workspace-schedule.ts`, `daemon/protocol.ts`, `query/answer.ts`, `client.ts`, `cli/src/answer-text.ts`. Tests, for create-tests: `scheduler.test.ts`, `scheduling-harness.ts`, `lifecycle.test.ts`, `input-tracker.test.ts`, `query.test.ts`, `packages/cli/test/cli.test.ts`, and the two `defects.json`. Over 20 estimated after the orchestrator's split (S1), which took the extractions out; still over 10, so dev delegates, in three groups on disjoint files, in order: the tracker window (`input-jobs.ts`, `input-tracker.ts`), then the daemon chain (`run-judgment.ts`, `run-history.ts`, `lifecycle.ts`, `scheduler.ts`, `workspace-schedule.ts`, `answer.ts`, `client.ts`, `protocol.ts`), then the CLI text, which reads its shapes.

#### Doc text

A draft for the orchestrator, its final wording to follow the build.

- `docs/architecture.md`, the scheduler paragraph, after the periodic retry's sentence: "A workspace that becomes due three times in a row only through changes the daemon's own runs and discoveries made to the same input is held: no run of it begins, the periodic retry included, until an edit reaches its inputs or the daemon sees a change it cannot attribute. A change the tracker records while a run or discovery runs is the daemon's own, whichever workspace it reaches; an edit is a path whose digest differs between the end of one such job and the start of the next. The third of those runs is not interrupted by a change, so it is stored; every answer names the paths and the jobs that changed them. The holds are kept in memory only."
- `docs/architecture.md`, the known limits: replace "a test that rewrites one of its own inputs on every run, whose runs are each interrupted and rerun without end;" with "a test that writes a different input on each run, or more than 1,000 inputs in one run, or a workspace in whose inputs more than 1,000 paths changed since its last run began, which is never held; an agent that edits the same input of a workspace while a run or discovery runs, in each of three rounds in a row with no edit between jobs, which holds that workspace until an edit lands while no job runs; a write a job makes that the tracker reads only after the job's window closes, which counts as an edit, so a loop driven by such writes is not held; until ticket 2.3l, a test module that writes an input when it is loaded, which keeps discoveries repeating, so no workspace runs;".
- `README.md`: user-visible; a summary's workspace line can read the new idle reason. Dev confirms the sentence.
- `_agent-docs/code-review-checklist/daemon-cli-state.md` C116, reworded: "A run whose inputs changed while it ran is recorded as invalidated and rerun from stable inputs, unless its workspace is held as a self-changing workspace, which reruns only after an edit; a generation token stops a late completion from replacing a newer result."

#### Previous ticket

2.3i (done, 13ede23; 3276808 fixed the round's explanation after a selection throws): every answer's schedule, whose idle reasons (`retry-pending`, `no-run-until-input-change`, `round-held`) and invalidated label it kept open for this ticket to add one member each (its orchestrator ruling, 09:05). Its completion notes put `scheduler.ts` at 491 and `lifecycle.ts` at 497 code lines, which 2.3r relieves. Its tech debt left a discovery stored not fingerprinted with no rerun coming to 2.3l.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3k, § Ticket 2.3r, § Ticket 2.3l, § Ticket 2.3h, § Ticket 2.7.
- Commit f0983f0 (the rulings of 01:12, 09:05 to 09:13 and 09:16, and FR8's clause).
- Tickets 2.3h (`_agent-docs/tickets/2-3h-judge-runs.md`: the interruption and the verdict kinds), 2.3i (`_agent-docs/tickets/2-3i-schedule-answers.md`: the schedule, the label, the open sets) and 2.4b (`_agent-docs/tickets/2-4b-wait-for-files.md` AC3).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (2026-09-29 19:12).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C8,C12,C14,C22,C23,C24,C170,C38,C39,C40,C46,C48,C55,C59,C115,C116,C119,C120,C126,C142,C151,C154,C160,C167,C169 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P14,P16,P17,P18,P19,P21 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area:
  - packages/daemon
  - packages/cli
is_consolidation: false
sizing_ac_count: 4
files_to_modify:
  - packages/daemon/src/inputs/input-jobs.ts
  - packages/daemon/src/inputs/input-tracker.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/run-judgment.ts
  - packages/daemon/src/daemon/run-history.ts
  - packages/daemon/src/daemon/scheduler.ts
  - packages/daemon/src/daemon/workspace-schedule.ts
  - packages/daemon/src/daemon/protocol.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/client.ts
  - packages/cli/src/answer-text.ts
files_to_create:
  - packages/daemon/src/daemon/change-record.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 06dfcd31-c506-4d33-b4fa-5a922a284c15

#### Test Files This Change Broke

- `packages/daemon/test/scheduler.test.ts`: the rig's `discover` stand-in returns `{ stored }` and its `run` stand-in builds a `RunReport` by hand; both now need `window: JobWindow` (typecheck errors at its `discover:` and `run:` stand-ins). Its `new WorkspaceSchedule({` in the schedule tests needs `heldBy: () => undefined`. The `run` part now takes a third argument, `uninterruptible: string | undefined`.
- `packages/daemon/test/query.test.ts`: its `new WorkspaceSchedule({` helper needs `heldBy`.
- `packages/daemon/test/scheduling-harness.ts`: compiles, but `StandInInputs` opens and closes windows with no digests (`open(undefined)`, `close(mark, undefined)`), so every interval between jobs reads as unreadable, an edit everywhere, and no count ever rises. The lifecycle's tests of AC1 and AC2 need the stand-in to pass digests: `JobWindows.open(unsettled, digests)` and `close(mark, unavailable, digests)`.
- `packages/daemon/test/defects.json`, anchors this change moved (found by comparing every record's `old` with its file; `bun run check:defects` stops at the first). Each is a moved or reworded line, not a lost behavior:
  - D1465, D1987 (`lifecycle.ts` `#discover`): `return { stored: false };` is now `return report(false);`.
  - D2729 (`lifecycle.ts` scheduler parts): the `run:` part is now two lines, `run: (entry, revision, uninterruptible) =>` then `this.#idleAfter(this.#run(entry, revision, uninterruptible)),`.
  - D2888 (`lifecycle.ts` `#run`): `interrupt:` is now a conditional whose interruptible arm is `? () => executor.abort(ABORT_PURPOSE.interruption)`.
  - D2661 (`scheduler.ts`): `this.#retryWorkspaces.delete(path);\n` now matches twice, since `#due` drops a held workspace's retry; anchor on `#run`'s occurrence with its preceding `const retried = this.#retryWorkspaces.has(path);` line.
  - D2668 (`scheduler.ts` `#selectRound`): the condition is now `const holdsCurrent = !dueNow.has(path) && !this.#runs.isHeld(path);` then `if (confirmed.has(path) && holdsCurrent) {`.
  - D2788 (`scheduler.ts` `#due`): the reason is now one line, `const reason = stale ?? (retry ? retryReason(latest) : undefined);`.
  - D2990 (`workspace-schedule.ts` `#dueFacts`): now `kind: labelsInvalidated(notKept) ? INVALIDATED : due,`.
  - D2991, D2992: the invalidating set moved, unchanged, to `packages/daemon/src/daemon/run-judgment.ts`; only their `file` changes.
- Every other record whose mutated file this change edited (`input-jobs.ts`, `input-tracker.ts`, `lifecycle.ts`, `run-judgment.ts`, `run-history.ts`, `scheduler.ts`, `workspace-schedule.ts`, `protocol.ts`, `answer.ts`, `client.ts`, `answer-text.ts`) is owed a by-id re-proof by the lane's rule.

#### ACs Owed a Test

- AC1: the daemon tells a change a run or discovery made while it ran from an edit between jobs, and counts every change as one or the other; a cause naming no path, unreadable digests, and more than 1,000 paths in one window, one interval or one workspace since its last run began each read as an edit. Evidence so far is a traced path (`ChangeRecord.jobEnded`, `observed`, `#interval`, `ChangeSets.#counts`), not an observation.
- AC2: a workspace whose own runs keep changing the same input is held after three runs, the third runs uninterruptible with its log line, and an edit releases the hold and starts the count from 0. Traced through `Scheduler.#due`, `RunHistory.decide`, `#nextCount`, `followOn`, `began`; only a test can show the loop stops.
- AC3: a held workspace's answers read `self-changing` over `round-held` and `retry-pending`, name the shared paths with their jobs within `MAX_NAMED_CHANGES` and count the rest, say nothing while a round is pending, and the CLI renders the phrase. Traced through `WorkspaceSchedule.#notRunning`, `selfChangedList` and `notRunningText`.

#### Tests Owed

- A change a run makes while it runs never reaches its workspace's count (its window not folded in), so a self-changing workspace is never held (AC1, AC2; `ChangeRecord.jobEnded`).
- An agent's save between jobs does not reset the count (the interval between the latest job's end digests and a plan's digests not measured), so an agent's edits hold a workspace (AC1; `ChangeRecord.observed`).
- A watcher failure or lost input set during a run leaves counts and holds in place instead of resetting and releasing every one (AC1, Q2; `window.causes` in `jobEnded`).
- A workspace with more than `MAX_COUNTED_CHANGES` distinct paths since its last run began keeps counting instead of reading as edited (AC1; `ChangeSets.#counts`).
- A run that throws has its changes counted as its own rather than measured as edits (AC1; no report, so `#last` stays at the plan's digests).
- Times that share no path still raise the count instead of restarting it at 1 (AC2; `followOn`); a count that rises with no job-caused path inside the workspace's inputs (AC2).
- The run begun at count 2 is interrupted by a change, or its "will not be interrupted" line is missing (AC2; `RunHistory.uninterruptible`, the lifecycle's `interrupt`).
- A held workspace still runs on the periodic retry or the once-more rerun (AC2; `#armRetries` skip, `decide` before `ranAlready`).
- A hold never releases after an edit placed inside its inputs, or releases on an edit outside them (AC2; `decide`, `#edited`).
- A run that never began leaves the attempt `began` wrote, so the next count reads a run that never ran (AC2, C167; `BegunRun.notBegun`).
- A placement that throws holds a workspace (AC1; `#inside` returns undefined, read as an edit).
- The idle reason under a held round or an owed retry reads `round-held` or `retry-pending` instead of `self-changing`, or a pending round names the hold (AC3; `#notRunning`).
- More than `MAX_NAMED_CHANGES` shared paths, or jobs per path, are named in full or lose the count of the rest (AC3; `selfChangedList`).
- The periodic reconciliation's log counts a held workspace among those it retries (sanity F2; `#armRetries`).
- `#selectRound` logs a held, selected workspace as holding current results (`holdsCurrent`).
- The CLI renders `self-changing` without its phrase, paths or jobs, or names the discovery as a run (AC3; `notRunningText`, `jobText`).

### Tests Record

Tests session: threadId 83266c4c-8d16-4fdb-8b49-cc51aeb69963

#### Named Defects

- D3138: A workspace is held after four times in a row it became due through its jobs' changes, rather than three. (AC2)
- D3139: A change a run makes while it runs never reaches its workspace's record of changes, so a workspace whose runs keep rewriting its own inputs is never held. (AC1, AC2)
- D3140: The log says nothing when a workspace's hold begins. (AC3)
- D3141: The scheduler never tells the run begun at a count of 2 that no change may interrupt it, so it is interrupted like any other run. (AC2)
- D3142: A digest that changed between two jobs is never measured as an edit, so an agent's save between runs does not start the count again. (AC1, AC2)
- D3143: A held workspace stays held after an edit reaches its inputs. (AC2)
- D3144: The log says nothing when an edit releases a held workspace. (AC2)
- D3145: A cause naming no path recorded while a job ran, such as a watcher failure, is not an edit in every workspace, so counts and holds survive it. (AC1)
- D3146: An interval whose digests cannot be read is not an edit in every workspace, so a hold survives a round that could not read its inputs. (AC1, AC2)
- D3147: A discovery's changes never reach the record of changes, so a workspace whose inputs each discovery rewrites is never held. (AC1, AC3)
- D3148: A time sharing no changed path with the times before it still raises the count instead of starting it again at 1. (AC2)
- D3149: The paths a count keeps are those of its earlier times rather than those every counted time shares, so a held workspace names paths its latest time did not change. (AC2, AC3)
- D3150: The schedule never learns which workspaces the count holds, so a held workspace reads as waiting for the next input change. (AC3)
- D3151: A held workspace reads round-held while the round is held after a failed step, though retrying the round runs no held workspace. (AC3)
- D3152: A held workspace whose latest run failed reads retry-pending, though the periodic retry runs no held workspace. (AC3)
- D3153: A held workspace names its hold while a round is pending, though the pending round may be the edit that releases it. (AC3)
- D3154: A held workspace names every path its counted times shared, however many, with no count of the rest. (AC3)
- D3155: A held workspace names every job that changed one of its paths, however many, with no count of the rest. (AC3)
- D3156: The periodic reconciliation arms a retry for a held workspace, so its log counts a workspace that will not retry. (AC2)
- D3157: A workspace due only for a periodic retry is counted, so failed runs that change its inputs hold it after three retries. (AC2)
- D3158: A workspace whose current input fingerprint cannot be computed is counted, so runs that change its inputs hold it. (AC2)
- D3159: A run stored not fingerprinted for a cause that names no path counts toward a hold, as an invalidated run does. (AC2)
- D3160: A run that stored nothing though no change interrupted it counts toward a hold. (AC2)
- D3161: A run that never began leaves its mark as the workspace's last run begun, so the next count starts from a run that never ran. (AC2)
- D3162: A placement that throws while counting puts every changed path inside the workspace's inputs, so uncertainty holds it. (AC1)
- D3163: A workspace for which exactly 1,000 distinct paths changed since its last run began reads as edited, though the bound is more than 1,000. (AC1)
- D3164: A workspace for which more than 1,000 distinct paths changed since its last run began keeps counting instead of reading as edited. (AC1)
- D3165: A workspace reads as edited only once more than 1,001 distinct paths changed since its last run began. (AC1)
- D3166: A run's report carries none of the paths its window recorded, so a workspace whose runs keep changing its inputs is never held. (AC1, AC2)
- D3167: The run begun at a count of 2 is interrupted by a change like any other run, so it leaves no results to mark. (AC2)
- D3168: The log says nothing when a run begins that no change will interrupt. (AC2)
- D3169: A count rises on job-caused paths outside the workspace's inputs, so a workspace whose runs change only another workspace's inputs is held. (AC1, AC2)
- D3170: An edit anywhere releases a held workspace, though it lies outside that workspace's inputs. (AC1, AC2)
- D3171: A held workspace that the round's selection chose is logged as not run because it holds current results. (AC2)
- D3172: A job's window never keeps the committed digests at its close, so every interval after a job reads as unreadable and no count ever rises. (AC1)
- D3173: A job's window keeps digests the tracker cannot vouch for, so an edit measured from them can be missed. (AC1)
- D3174: The CLI's line for a held workspace names none of the paths its runs changed or the jobs that changed them. (AC3)
- D3175: The CLI's line for a held workspace names the discovery as a run. (AC3)
- D3176: The CLI prints a held workspace's path as the consumer's tree spells it, so a line break in it breaks the answer's line. (AC3)
- D3177: While the round is held after a failed step, the CLI's line for a held workspace does not say the held round's next try may release it. (AC3, Q-R1)
- D3178: The CLI's line for a held workspace names the held round's try whatever the round's state, though only a held round is tried again. (AC3, Q-R1)
- D3179: While the round is held, the CLI gives every idle workspace the held workspace's phrase, whatever its own reason. (AC3, Q-R1)
- D3180: A held workspace names only the jobs that changed its shared path in the latest counted time, dropping the jobs of earlier times. (AC3)
- D3181: The count places paths without the listed-test-module rule, so a workspace whose runs rewrite a listed test module its narrowed build places elsewhere is never held. (AC1)
- D3182: The lifecycle's discovery report carries none of the paths its window recorded, so a discovery's own changes are never job-caused. (AC1)
- D3183: The CLI prints the workspace of a run that changed a held workspace's path as the consumer's tree spells it, so a line break in it breaks the answer's line. (AC3)
- D3174 to D3176 re-proven after `HELD_LEAD` took Q-R2's wording; D3166 to D3171 re-proven after `untilRunsEnd` began failing at its cap and `RewritingExecutor` began finishing a run once the daemon has gone quiet, not after a flush count.
- Re-anchored to the moved source, each keeping its defect: D1465, D1987 (`return report(false);`), D2729 (the `run` part's third argument), D2888 (the interruptible arm of `interrupt`), D2661 (`#run`'s retry delete), D2668 (`holdsCurrent`), D2788 (`#due`'s one-line reason), D2990 (`labelsInvalidated`), D2991 and D2992 (the invalidating set, now in `run-judgment.ts`).

#### Deliberately Untested

- packages/daemon/src/daemon/run-history.ts `threw` and `began`'s non-qualifying attempt: each guard alone keeps a thrown run's count at 0 (the attempt `began` writes does not qualify, and `threw` starts the subject afresh), so mutating either survives. They are inert mutations, not a vacuous test. A thrown run's own changes are measured as edits because no report exists to carry its window, and no single edit attributes them to it.
- packages/daemon/src/daemon/change-record.ts, the per-window and per-interval `MAX_COUNTED_CHANGES` checks: a window or interval past 1,000 paths also puts every subject past the per-subject bound, so each check is redundant with the per-subject bound that D3163 and D3164 pin (inert).
- A change recorded only while a dependency build or a discovery's protection runs: no code path reports those windows to the change record, so no single edit makes them job-caused.
- Two workspaces writing into each other's inputs: pinning that the fold reaches the other workspace needs two confirmed Vitest workspaces over a narrowed build. The fold into every subject is pinned by D3147, whose discovery job belongs to no workspace.
- The hold leaves the latest run's freshness, invalidated label and counts unchanged: the change touches no freshness or count code, so no mutation reaches it.
- packages/daemon/src/daemon/scheduler.ts `#run`'s restore only on a stop or a moved revision: the lifecycle refuses a run at its planned revision only when its confirmation check and the scheduler's disagree, which no unmutated path does, so mutating the condition alone changes no outcome. D2642's mutation, which makes them disagree, is what the condition keeps from spinning, and D2642 pins that.
- packages/daemon/src/inputs/input-tracker.ts `endJob`'s digests while the tracker cannot vouch (review gap row): `endJob` awaits `settled()`, which waits out pending reads and any reconciliation. A watcher failure or a lost input set records a cause into every open window (`#markUnhealthy`, `#inputSetLost`), and a cause is an edit in every workspace whatever the digests. That leaves a stopped tracker as the only cause-free way to close unvouched, and a stop discards the change record with the daemon. So keeping digests at such a close changes no count. D3173 pins the open.
- packages/daemon/src/client.ts: a type-only export.
- packages/daemon/src/daemon/protocol.ts `PROTOCOL_VERSION` 3: a version constant has no behavior of its own; every mismatch test sends `PROTOCOL_VERSION + 1` or `- 1`, and no test pins 2.

### Review Record

Review session: threadId 01a3b579-db3e-41bb-8175-e614a7cd74cb

Reviewed 2026-09-29 21:33 to 21:49 by rt-t2-3k-review: five fresh-eyes batches, two doc-verify agents (this ticket; sprint § 2.3k and the glossary's two terms from ed28fab), and the checklist pass over the ticket's 27 checklist and 6 project-context rules. No assumptions agent: the diff imports no third-party module, so the Unverified Assumptions answer holds.

Fixed in the review round:

- `cli/src/answer-text.ts`: the unstored-jobs line renders through `jobText` rather than restating its wording (C8, C3); the `self-changing` phrase ends "because the daemon's own runs and discoveries keep changing its inputs" (Q-R2); while the answer's round is held, the phrase also names the daemon trying the held round again at the next input event or reconciliation (Q-R1).
- `client.ts`: exports `ROUND`, which the CLI reads to tell a held round.
- `query/answer.ts`: the idle state's `notRunning` is a union, `selfChanged` required with `self-changing` and `never` otherwise, over the new `NotSelfChangingReason` (P17); the JSON shape is unchanged. `workspace-schedule.ts`'s `idleReason` returns that type, and `heldBy`'s docblock names what it returns.
- `daemon/run-judgment.ts`, `daemon/run-history.ts`: `HeldPlacement` is `ChangePlacement`, since the hold's own names use "held"; `Attempt` and `RunStart`'s count field is `startCount`, apart from the method `began()`.
- `daemon/scheduler.ts`: `#run` names its predicate `refusedAtPlan` instead of a comment describing the branch not taken.
- `daemon/change-record.ts`: the same-digests shortcut's comment says "usually", since `InputState.establish` can hand back a new object at an unmoved revision (C46).
- `daemon/lifecycle.ts` and `run-history.ts`: the uninterruptible run's log line and the count's comment say what happens ("a change inside its inputs while it runs leaves the run it stores invalidated") in place of "leaves results to mark".
- This record: the File List gains the tests session's eight files, and `files_to_create` gains `change-record.ts`.

The build differs from two ticked task texts, as its Completion Notes say: the placement rule is shared as the private `placeFor`, exported through `roundPlacement` and `pathsInside`, not by exporting `placementOf` and `placedInside`; and `#run` restores the attempt only on a stop or a moved revision.

Tech debt, not fixed here:

- `daemon/scheduler.ts` `#run`: a retried workspace the lifecycle refuses at its planned revision re-arms its retry (`if (retried) this.#retryWorkspaces.add(path);`), and `#due` skips `ranAlready` for a retry, so the plan-run loop still spins on the retry path, logging an unstored job each time. It predates this ticket and needs the scheduler's and the lifecycle's confirmation checks to disagree, which no unmutated path does (D2642's mutation). The fix that removes it is to hand the lifecycle the confirmed entry the scheduler already resolved, so no refusal at the planned revision can happen.

#### Test Coverage Gaps

| Source                                                  | Named defect                                                                                                                                                                                                                                              | Expected test                                                                                                                                                                                                 | Severity |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `cli/src/answer-text.ts` `notRunningText`               | While the round is held after a failed step, the CLI's line for a held workspace does not name the held round's retry, though trying the round again may release it.                                                                                      | `cli.test.ts`: a held workspace under a held round renders the held-round phrase; under a planned round it renders the plain phrase.                                                                          | MEDIUM   |
| `cli/src/answer-text.ts` `IDLE_PHRASES`                 | The test asserts behavior this review deliberately changed: `HELD_LEAD` expects "because its tests change their own inputs", now "because the daemon's own runs and discoveries keep changing its inputs" (Q-R2).                                         | Update `HELD_LEAD` in `cli.test.ts`, then re-prove D3174 to D3176.                                                                                                                                            | MEDIUM   |
| `cli/src/answer-text.ts` `jobText`                      | The CLI prints the workspace path of a job that changed a held workspace's input as the consumer's tree spells it, so a line break in it breaks the answer's line.                                                                                        | `cli.test.ts`: a job whose `workspacePath` holds a line break renders it escaped (D3176 covers only the changed path).                                                                                        | LOW      |
| `daemon/run-history.ts` `followOn`                      | A held workspace names only the jobs that changed its shared path in the latest counted time, dropping the jobs of earlier times.                                                                                                                         | `scheduler.test.ts`: a hold reached through a run of `a`, then discoveries changing the same path, names both jobs.                                                                                           | LOW      |
| `daemon/run-judgment.ts` `pathsInside`                  | The count places paths without the listed-test-module rule, so a workspace whose runs rewrite one of its listed test modules that the narrowed build does not place in it is never held.                                                                  | A hold test over a narrowed build whose rewritten path is a listed test module of `a` the build does not select; mutation `new Set(workspaceTestModules(entry))` to `new Set()` in `pathsInside`.             | LOW      |
| `daemon/lifecycle.ts` `#discover`                       | The lifecycle's discovery report carries an empty or wrong window, so a discovery's own changes are never job-caused.                                                                                                                                     | `lifecycle.test.ts`: a scripted discovery that writes a path inside `a`'s inputs on each rediscovery holds `a` (D3147 drives only the scheduler's stand-in).                                                  | LOW      |
| `inputs/input-tracker.ts` `endJob`                      | A job's window keeps the committed digests at its close even when the tracker cannot vouch for its inputs then.                                                                                                                                           | `input-tracker.test.ts`: close a window while the tracker cannot vouch, and its `endDigests` are undefined (D3173 covers only the open); or record it deliberately untested if a cause always accompanies it. | LOW      |
| `lifecycle.test.ts` `untilRunsEnd`, `RewritingExecutor` | A test can pass or fail for a reason other than its defect: `untilRunsEnd` returns silently at `RUNS_END_FLUSHES`, and `RewritingExecutor` finishes a run after `FINISH_FLUSHES`, so an interruption slower than that fails D3167 with no defect present. | Have `untilRunsEnd` fail at its cap, and finish a run on an explicit signal rather than a flush count.                                                                                                        | LOW      |
| `scheduler.test.ts` `RunResult.notBegun`                | The stand-in's doc says `notBegun` simulates a stop or a moved revision; alone it now drives a refusal at the planned revision, which keeps the attempt.                                                                                                  | Correct the doc to name both uses.                                                                                                                                                                            | LOW      |

Denominator: 39 named-defect tests (D3138 to D3176) in the touched test files, against the behaviors the three criteria name; every criterion's guarantee has a test that goes red on it, and the rows above are the gaps left.

### Completion Notes

Built by rt-t2-3k-dev, 2026-09-29 20:19 to 20:42, on `main` at ffd345f, alone: the tasks form one chain (the window, then the daemon, then the CLI text reading its shapes), so none was delegated.

- **Sanity check** (20:17, answered by create-ticket at 20:18, orchestrator no veto at 20:20): F1, a record bounded per window but not per reader, became a per-subject record capped at `MAX_COUNTED_CHANGES`; F2, `#armRetries` skipping a held workspace. Both applied as the ticket now reads.
- **Unverified assumptions**: none; the ticket calls no third-party behavior.
- **The window** (`input-jobs.ts`, `input-tracker.ts`): `JobWindow` gains `startDigests` and `endDigests`, the committed digests `beginJob` and `endJob` take in the same synchronous step as the open and the close, or undefined when `#unavailableReason()` is set. Both parameters are optional, so the verdict and its tests are unchanged.
- **The change record** (new `daemon/change-record.ts`, cleared by the orchestrator at 20:20): per subject, the paths runs and discoveries changed with their jobs, the edit paths and an edit-everywhere flag, unplaced. Each plan's digests and each job's window fold into every subject. A subject's sets start afresh at its run's report, not at `began`, so a run that never begins leaves them whole.
- **The count and hold** (`run-history.ts`): `Attempt` gains the count its run began at and whether its ending qualifies. `began` returns a `BegunRun` whose `notBegun` restores the attempt it replaced (C167, the 19:41 decision) and whose `threw` starts the subject afresh with a non-qualifying ending. `decide` releases a hold on an edit, then decides the count, holds at `SELF_CHANGE_HOLD_COUNT` and logs once. `uninterruptible` gives the reason the run at count 2 logs.
- **Placement** (`run-judgment.ts`): `placeFor` is the one rule both a run's judgment and the count use; `roundPlacement` widens whenever `placementOf` gives none, and `pathsInside` adds the listed-module rule. The invalidating verdicts moved here as `labelsInvalidated`, which the count and the answer's label both read (C8).
- **Scheduler**: each plan records its digests; `#due` decides each due workspace's count before `ranAlready` and drops a held workspace's retry; `#armRetries` skips a held one; `#selectRound`'s "not run" line leaves out a held workspace, which does not hold current results (a consumer of the due list the ticket did not name, C39); the discovery's report feeds the record.
- **Answer and CLI**: `IDLE_REASON.selfChanging` and `notRunning.selfChanged`, a `NamedList` of `SelfChangedPath` (`jobs` a `NamedList` of `Pick<UnstoredJob, "workspacePath">`), both bounded by `MAX_NAMED_CHANGES`; `client.ts` exports `SelfChangedPath`, which the CLI names. `PROTOCOL_VERSION` is 3.
- **Decisions taken here, code-only**: a placement that throws while counting reads as an edit to the workspace's inputs, so uncertainty never holds a workspace nor keeps it held (adversarial finding F1; the run's own judgment still widens). The released hold logs one line, `<path> is no longer held, since an edit reached its inputs`.
- **Adversarial review** (one agent, 20:30 to 20:40): 5 findings. Fixed: F1 HIGH (above) and F4 (an interval between the same digests object returns early). Discarded #F2: the doc text, sent with this report, is no code defect. Discarded #F3: the no-op interrupt is the ticket's instruction, and placement is cached per build, so rejudging on each change costs what an interruptible run already pays. Discarded #F5: subjects of vanished workspaces stay bounded by workspaces seen times 1,000 paths, and a workspace that returns does so through a config edit placed inside its inputs, which releases it. Post-fix: lint and both typechecks re-run, clean but for the test files listed.
- **Gates** (20:40): `bun x oxlint` and `bun x prettier --check` over the 12 production files exit 0; `bun run --filter rt-test typecheck` exits 0; `bun run --filter @rt-test/daemon typecheck` exits 1 only in `test/scheduler.test.ts` and `test/query.test.ts`, listed above. `node scripts/check-line-citations.mjs`: clean. Code lines: `scheduler.ts` 464, `lifecycle.ts` 468, `input-tracker.ts` 464, `run-judgment.ts` 380, `run-history.ts` about 245, `change-record.ts` about 90.
- **README**: user-visible. In § Query's answer paragraph, replace "or idle, saying why no run has begun when its results are not current." with "or idle, saying why no run has begun when its results are not current, which for a workspace its own runs and discoveries keep changing names the inputs they changed and the jobs that changed them, since no run of it comes until an edit reaches its inputs." Sent to the orchestrator, which owns the file.
- **Doc text**: the final wording went to the orchestrator with the report; § Doc text's draft stands with two changes from the build. The scheduler sentence says the third run "runs to its end and leaves results to mark", not "is stored", and names the once-more rerun beside the periodic retry and the per-workspace 1,000-path edit.
- **Code bug from create-tests** (rt-t2-3k-tests, 21:18, found by D2642's proof): restoring the attempt whenever the lifecycle returned no report also restored it for a refused unconfirmed workspace at the planned revision, so `ranAlready` no longer stopped it and the plan-run loop spun in microtasks until the heap ran out. Fixed in `Scheduler.#run` at 21:19: the attempt is restored only on a stop or a moved revision, the two ways a run never begins that C167 and the 19:41 decision name, and a refusal at the planned revision keeps it, as before this ticket. The retry re-add stays unconditional, since D2731's stand-in reports a run not begun at an unmoved revision and expects the retry kept. `SchedulerParts.run`'s docblock now names the refusal. Typecheck, oxlint and prettier on `scheduler.ts`: exit 0; every `scheduler.ts` defect anchor still matches once.

### File List

- _agent-docs/tickets/2-3k-hold-self-changing-runs.md (created by create-ticket, 2026-09-29, against `main` at d6ea204, re-read at 65dafd6 after 2.3r landed)
- docs/glossary.md (**Edit** and **Self-changing workspace** added, under the orchestrator's 19:16 grant for exactly those two entries; committed with 2.3r's authoring, ed28fab)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3k: the placement settled by Q1, the pathless-cause and 1,000-path edits, the known limit, the build order after 2.3r and the ticket link, under the orchestrator's 19:16 grant)
- _agent-docs/sprint-status.yaml (2-3k-hold-self-changing-runs to ready-for-dev, under the same grant)
- packages/daemon/src/daemon/change-record.ts (created by dev-ticket, cleared by the orchestrator at 20:20)
- packages/daemon/src/inputs/input-jobs.ts (modified by dev-ticket)
- packages/daemon/src/inputs/input-tracker.ts (modified by dev-ticket)
- packages/daemon/src/daemon/lifecycle.ts (modified by dev-ticket)
- packages/daemon/src/daemon/run-judgment.ts (modified by dev-ticket)
- packages/daemon/src/daemon/run-history.ts (modified by dev-ticket)
- packages/daemon/src/daemon/scheduler.ts (modified by dev-ticket)
- packages/daemon/src/daemon/workspace-schedule.ts (modified by dev-ticket)
- packages/daemon/src/daemon/protocol.ts (modified by dev-ticket)
- packages/daemon/src/query/answer.ts (modified by dev-ticket)
- packages/daemon/src/client.ts (modified by dev-ticket)
- packages/cli/src/answer-text.ts (modified by dev-ticket)
- packages/daemon/test/scheduler.test.ts (modified by create-tests)
- packages/daemon/test/scheduling-harness.ts (modified by create-tests)
- packages/daemon/test/lifecycle.test.ts (modified by create-tests)
- packages/daemon/test/input-tracker.test.ts (modified by create-tests)
- packages/daemon/test/query.test.ts (modified by create-tests)
- packages/daemon/test/defects.json (modified by create-tests)
- packages/cli/test/cli.test.ts (modified by create-tests)
- packages/cli/test/defects.json (modified by create-tests)

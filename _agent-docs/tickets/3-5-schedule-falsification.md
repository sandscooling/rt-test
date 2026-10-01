# Ticket 3.5: Schedule falsification

## Ticket

As a coding agent or a developer working in a started project,
I want the daemon to falsify my waiting defects by itself whenever no ordinary test work is due,
so that `rt-test defects` holds current evidence without my running a falsification, and no ordinary result ever waits for one.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

A definition is **waiting** when the worktree's standings (ticket 3.4c's function) read it eligible and either never verified or holding a verdict whose evidence freshness is not current.

- [ ] AC1: Once a round has planned at an input revision and found no discovery and no workspace due, the daemon looks for waiting definitions and, when it finds one it may take (AC6), starts one falsification job. When that job ends the daemon plans again, so an ordinary job that became due meanwhile goes first and otherwise the next falsification job follows, until no definition it may take is waiting. No job starts while a discovery or a run is due or running, while a round is pending or held, before the first reconciliation has ended, or after a stop. A definition that is invalid, whose anchor is missing, or whose test holds no current pass is never given an experiment, and the other definitions still are. (FR13, FR15)
- [ ] AC2: A job covers one workspace and at most 25 definitions (a target until measured). The definitions the daemon may take are ordered as a `defects` answer lists them (by state, then by file and position), with every definition marked as left without a verdict (AC4, AC5) in this daemon's life after every other; the job's workspace is the first one's, and the job holds that workspace's definitions in that order up to the bound. Each experiment is built from its definition's standing: its id, its resolved test's identity, and its mutation with the file as the one absolute path the definition check gives it. The job is handed the workspace's confirmed config file and the assertion error names the same read returned. (FR10, FR15)
- [ ] AC3: When a job's reply reads `ran`, and from the moment its definitions' standings and its workspace's fingerprint were read to the job's end no input changed and no event named one, each verdict the reply carries is stored as that defect's evidence, in one write for the job's whole reply, bound to the definition digest of the standing its experiment was built from and to that fingerprint's digest, so a `defects` answer then reads each with evidence freshness current. That holds for a job in which no run happened: the no-probe-site and no-module verdicts of experiments decided before any run are stored. Nothing of a job is stored when an input changed or an event named one in that window, also when the workspace's fingerprint at its end equals the one at its start; when its reply does not read `ran`; when its executor ended without a reply or replied with a job that is not an object; or when a stop arrived. A judgement with no verdict stores nothing and leaves the defect's earlier evidence. (FR10, FR15)
- [ ] AC4: A change of the input revision while a job runs ends the job: it is aborted and ends within the executor's bound, nothing of it is stored, and the next round is planned as it would be had no job been running, so no discovery and no run waits for a job's remaining experiments. None of its definitions is marked, with one exception: a definition that was the one running (AC5) when an input change ended its job, in each of the last two jobs that held it, is marked as AC5 marks one, so a mutation that never ends cannot hold the front of the order under an agent that saves more often than the time bound. A stop ends a running job the same way and marks nothing. (FR15)
- [ ] AC5: A job that has not ended 10 minutes (a target until measured) after it was sent to its executor is aborted. The definition that was running when a job was ended is the one a `ran` reply names: the first experiment whose first run or confirming run reads interrupted, and none when the baseline was the run in progress. When the bound ends a job and its reply names one, that definition is marked as left without a verdict: it is not taken again until the input revision or its definition digest changes, and it sorts last (AC2). Every other definition of that job that got no verdict may be taken again at once, and whatever verdicts the reply carries are stored under AC3's conditions. When the reply names none, or no reply comes, the job is one that did not run (AC6). (FR15)
- [ ] AC6: No definition of a job whose reply read `ran`, and that neither an input change nor the time bound ended, is taken again until the input revision changes, whether or not it got a verdict, nor is a definition AC4 or AC5 marks; every other definition of a job the time bound ended may be given a second experiment at that revision (AC5). A workspace whose job did not run (its reply read refused, unsupported, not confirmed or failed, its config is no longer confirmed, its executor ended without a usable reply, or the time bound ended it in its baseline), or whose reply could not be stored (the store failed, or an event named an input while it ran at a revision that did not move), gets no further job until the input revision changes. A periodic reconciliation leads to a look as any plan does, and lifts none of these. A definition whose definition digest changed is one that has had no experiment. (FR15)
- [ ] AC7: Every input change the tracker records while a falsification job runs counts as a change the daemon's own job made, never as an edit, unless a `changes` request names its file as edited: it releases no hold, and it counts toward holding a workspace or the discovery as a run's change does. A change the tracker records after a job has ended, after a look that sent none (it found nothing to take, a stop came, the revision had moved, or its workspace was no longer confirmed), or after a job threw, counts as an edit again. (FR8)
- [ ] AC8: Every answer, and `status`, say what falsification is doing. While a job runs, the daemon's activity reads falsifying, with the workspace and the number of definitions in the job. For each workspace whose job did not run or whose reply could not be stored at the current input revision (AC6), and for each workspace holding a definition that got no verdict at the current input revision or is marked as left without one (AC4, AC5), the list of jobs that ended with nothing stored holds one entry marked as a falsification job. Its reason says what happened (the refusal with its projects and settings, an unsupported or unconfirmed workspace, the failure to load, how the executor ended, the time bound, the store's failure, the input an event named while it ran) or names those definitions by id, each with its reason, up to 20 and the number of the rest, and says what ends the wait: a change of the input revision, and for a definition also a change of the definition or of the declared names. A reason never holds a definition's `old` or `new` text. An entry leaves the list when what it says no longer holds, and a run's entry and a falsification's for one workspace stand side by side. The CLI's text and a query's no-answer reason word the entry as the falsification of its workspace. The protocol version rises. (FR15, FR22)
- [ ] AC9: A falsification job stores no run and no discovery, and neither its verdicts nor the entries of AC8 change a test's state or freshness, a count of any answer but a `defects` answer's, whether a query answers, or a workspace's execution state; a change its own run makes to an input is an input change as any other (AC7): its workspace reads idle while it is falsified, and a `wait` settles or not as it would with no job. (FR10)
- [ ] AC10: The daemon's log names each job as it starts (the workspace, the number of definitions, and the first definition's id and state) and as it ends (how it ended, the number of verdicts stored of each kind, the number of definitions left without one, and its wall time), and names once, for each input revision, a look that found definitions waiting and took none, with why. (FR15)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                                                                               | Why it matters if wrong                                                                                                                                                                                                                                                                                                                                                                                            | How to check                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1  | When a job's worker is stuck in synchronous code, as under a mutation that never ends, does an abort still end the job with a reply that reads `ran` and interrupted, inside the executor's 15 s bound, on Vitest 4.1 and 5? Or does the bound pass, so the executor's tree is ended and no reply comes? | AC5 names the looping definition from the reply. With no reply the job counts as one that did not run, the whole workspace waits for an input change, and the looping definition is never told apart, so it sorts first again at the next revision and costs the time bound each time. AC5 is written for both outcomes; the answer decides which a consumer meets, and whether the known limit below must say so. | Run `Executor.falsify` over a fixture whose mutation turns a loop's condition always true, call `abort` after a few seconds, and read the outcome, then start an ordinary run on the same `Executor` and read whether and how soon it begins, as `packages/daemon/test/falsify/falsify-executor.test.ts` drives the executor. Ticket 3.2's Completion Notes observed that such a mutation "holds the job until it is aborted"; they do not record the reply. |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing.
- [ ] (Support) Make room, changing no behavior. `daemon/lifecycle.ts` holds 498 of lint's 500 code lines and `daemon/scheduler.ts` 495, and each needs about a dozen more. Move `#protectDiscovered` out of the lifecycle into `daemon/job-endings.ts` as a function of the tracked inputs, the stop check, the discovery, its verdict and its start time; move `discoveryInEffect` out of the scheduler into `daemon/discovery-history.ts`, beside `DiscoveryInEffect`, taking the latest results and the inputs so that file imports nothing from the scheduler; and, since those 9 lines do not cover the scheduler's need, move `#selectRound` with the four entry constants only it reads out of the scheduler into `daemon/round-selection.ts`, as a function of what it reads (the log, the narrowing, the previous snapshot, the due and the confirmed workspace paths, the held check) that returns the selection with the snapshot to keep. `query/answer.ts` (492) gains about 2 lines and `packages/cli/src/answer-text.ts` (493) about 2, which fit; ask the orchestrator before any further extraction. Every existing test passes unedited. List each record anchored in moved code under the Dev Handoff, with its new file, for the tests session to re-anchor and prove.
- [ ] (AC1, AC2, AC4, AC5, AC6) Create `packages/daemon/src/daemon/falsification-plan.ts`, with no I/O: from the standings 3.4c's function returns, the input revision and the marks, it gives the definitions the daemon may take in AC2's order, the next job's workspace and definitions with each one's experiment, and why nothing is taken when definitions are waiting. It holds the marks: by definition digest, the revision its experiment ran at and, when it got no verdict, why; by definition digest, whether the last job that held it was ended by an input change while it was the one running, which a second such ending in a row turns into the mark AC5 gives, set at the revision read when that job returned (AC4), and which any other ending of a job that held it clears; by workspace, the revision its job did not run at and why. Name the bound of 25 as a constant with the comment that it is a target until measured. Order by `compareStandings`, the comparison 3.4c exports for the answer's listing, never a second spelling of it.
- [ ] (AC1 to AC8, AC10) Create `packages/daemon/src/daemon/falsification.ts`, the one module the lifecycle calls. One call does a look and at most one job, and resolves true when the scheduler is to plan again: a job began, or the look marked a workspace and sent none. In order: wait for the inputs to settle; call 3.4c's function with a moment that opens the job's window on the tracker (`beginJob`) in the same tick it reads the lifecycle's moment, so no await stands between the fingerprint and the window (AC3); and when it returns, with no await after it, close the window and return false after a stop or when the revision the moment read is not the planned one (C160). A check before the call may stay as a cheap exit, and vouches for nothing. Hand the function the lifecycle's stop signal: it throws when that signal has aborted, before it reads the moment, so its throw after a stop is a look that took nothing with no window to close, and any other throw goes on to the scheduler's step as a discovery's does; it returns a `NoAnswer` only after it read the moment, so a `NoAnswer` is a look that took nothing whose window is closed, and the call resolves false. Close the window on every path that starts no job. Take the workspace's fingerprint digest from the basis the call returned, and its config file from the confirmed start; a workspace the start no longer confirms is marked as one whose job did not run (AC6) and the call resolves true, so the scheduler plans again and the next look takes the next workspace's definitions. On a look that found definitions waiting and took none, write the log entry once for each input revision (AC10), keeping the revision it was last written at beside the marks. Only when a job is about to be sent, tell the change record the job began (AC7), write the log's start entry, set the activity, and send the job on the lifecycle's run `Executor` with the declared names the same call returned as its assertion error names (AC2). End it at a change of the input revision or at the time bound with `abort(ABORT_PURPOSE.interruption)`. When the job returns, on every path, clear the bound's timer and drop the revision wait, so neither calls `abort` on the `Executor` during a later run or job (C157); then close the window, store under AC3, update the marks under AC4, AC5 and AC6, write the log's end entry, and tell the change record how it ended. Hand `writeEvidence` only a reply that carries a verdict, since each call makes the next read of the latest results rebuild every record (§ Measured). Name the time bound as a constant, a target until measured. Read an ended outcome whose value is not an object as one that did not end. Decide what happened from what this module asked for (a stop, a change, the bound), never from an outcome's reason text.
- [ ] (AC1) In `daemon/scheduler.ts`, add the falsification call to `SchedulerParts` and take it where a plan finds nothing due: inside `#schedule.during`, so a round pending at a later revision reads the job in progress. A call that resolved true plans again, and one that resolved false idles as today: true means "plan again", whether a job began or the look only marked a workspace (the `falsification.ts` task), never only "a job began". Mark the round dirty when the call resolved true, so the idle entry is logged again after it.
- [ ] (AC7) In `daemon/run-history.ts`, add the calls that tell the change record, under its workspace's subject as `began` does for a run, that a falsification job began, told only when a job is about to be sent, then that it ended with its window, or that it threw; expose them from the scheduler to the lifecycle as `reportEdits` is. A job the `Executor` did not send returns a not-ended outcome and still ends with its window, as a run's does, so no call says a job never began. A look that sends no job tells the record nothing, so its changes are edits (AC7).
- [ ] (AC8) In `daemon/protocol.ts`, add the falsifying activity (workspace path and number of definitions) and a job kind on `UnstoredJob` that only a falsification entry carries, and raise `PROTOCOL_VERSION`; `CLI_JSON_SCHEMA_VERSION` stays (design decision 12). A definition's reason, in a mark and in an entry, is its judgement's reason, one of the judge's closed set (`falsify/verdict.ts`), or this ticket's own word for the time bound or the repeated input change, never an experiment's error text, which can quote the mutated source (AC8, C147). Give `activityText` in `query/answer.ts` its case. In `query/summary.ts` (`unstoredClause`) and `packages/cli/src/answer-text.ts` (`jobText`), word an entry of that kind as the falsification of its workspace. The lifecycle's `status()` gives the runs' and discovery's entries followed by falsification's, which `falsification.ts` computes from its marks each time it is read, cut as AC8 bounds them.
- [ ] (AC1, AC8, AC9) Wire it in `daemon/lifecycle.ts`: build the module from the lifecycle's parts, its moment, its stop check and its activity; hand the scheduler the call inside `#idleAfter`; add its entries in `status()`. Check that storing evidence calls neither the waits' nor the changes' record of a stored run, since no test's state moved.
- [ ] (AC8) Check every consumer of the changed shapes in the same change (C38): each `switch` over `DaemonActivity`, each reader of `UnstoredJob`, and each defect record whose `new` text builds either; and check that no reader which matches an entry by its workspace path alone takes a falsification entry for a run's: `UnstoredJobs.unlist` filters by it, and `jobText` words a hold's jobs, which `SelfChangedPath.jobs` types from `workspacePath` alone, with the list's entries. List what the typecheck cannot see under the Dev Handoff.
- [ ] (Support) Report to the orchestrator, with the handoff, the text for the files this lane does not edit: `docs/architecture.md` (§ Reconciliation and the round of runs, § Executor processes, crashed runs and process trees, § Execution and falsification isolation, whose "nothing calls it yet" and "falsification does not yet run them" end here, § Query surface, § Falsification jobs' known limit on a mutation that never ends), `docs/adr/0007-reused-instance-per-falsification-job.md` (a job covers at most 25 of a workspace's waiting defects, and yields at any change of the input revision), `docs/glossary.md` (Falsification job, a term for a waiting definition if the build keeps the word, and Held workspace and Held discovery, whose "the daemon's own runs and discoveries" becomes "the daemon's own jobs" as FR8 and `docs/architecture.md` § Holds on self-changing workspaces and discoveries now read), `README.md` (what falsification does and when, the two targets, and that the declared names reach each job), and `_agent-docs/next-session.md`.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- Ticket 3.4c's function in `packages/daemon/src/defects/worktree-standings.ts`: the worktree's declared names, resolved definitions, standings and query basis from one read, taking the moment as a call. As built in Tree 2 at 07:24 on 2026-10-01, before its review, it is `worktreeStandings(read)`: it takes a `WorktreeRead` (`consumerRoot`, `stateDirectory`, `signal`, `moment`) and returns a `WorktreeStandings` (`basis`, `invalidEntries`, `assertionErrors`, `definitions`, and `standings`, one for each definition in the same order) or a `NoAnswer` alone. It throws when its signal has aborted, before it reads the moment, and it returns a `NoAnswer` only after it has read the moment. `assertionErrors` is the list as `rt-test.json` writes it. Each standing gives `definition` (its `id`, `resolved` test, `mutation` and absolute `mutationPath`), `state`, `eligible`, `definitionDigest` and `evidence`. A standing's workspace is `definition.resolved.identity.workspacePath`. `compareStandings(left, right)` in `defects/defect-standings.ts`, the answer's listing comparison, gives AC2's order.
- `Executor.falsify(workspace, configFile, experiments, assertionErrors)` and `ABORT_PURPOSE` in `daemon/executor.ts`; `DefectExperiment` and `FalsificationJob` in `falsify/experiment-record.ts`.
- `store.writeEvidence(bindings, job, definitionDigests)` (`store/open-store.ts`, `EvidenceBindings` in `store/defect-evidence.ts`): the store scope with the fingerprint's digest, the `ran` reply whole, and each defect id's definition digest.
- `TrackedInputs` (`inputs/input-tracker.ts`): `settled`, `beginJob`, `endJob`, whose `JobVerdict` reads `fingerprinted` only when the window held no change and no cause, `changed`, and `current().facts.revision`.
- `confirmedEntry` (`vitest/confirmed-start.ts`) for the workspace's confirmed config file, as `#run` in the lifecycle uses it.
- `threwOutcome` and `storeFailureReason` in `daemon/job-endings.ts`; `namedList` and `MAX_NAMED_CHANGES` (20) in `inputs/input-jobs.ts` for a bounded list of names; `cutReason` in `query/summary.ts`.
- `ChangeRecord` (`daemon/change-record.ts`): `jobBegan`, `jobEnded`, `jobNotBegun`, `jobThrew`, as `RunHistory` calls them for a run and for the discovery.
- `WorkspaceSchedule.during` (`daemon/workspace-schedule.ts`): marks a job planned at a revision in progress until it settles.
- `isRecord` in `packages/daemon/src/json-guards.ts`.

### Must Create

- `packages/daemon/src/daemon/falsification-plan.ts` and `packages/daemon/src/daemon/falsification.ts`, as the tasks describe.
- A named constant for the definitions a job covers (25) and one for the job's time bound (10 minutes), each commented as a target until measured.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### What the criteria rest on

FR10: "Falsify each defect definition by applying its mutation as an in-memory transform in a separate Vitest instance, between a baseline and a restored baseline that both pass its test, without writing any file." FR13: "Report a defect whose mutation anchor is missing as anchor missing, count it in the denominator, and withhold verified while the other defects still run." FR15: "Mark defect evidence stale when its test, mutation, inputs, or execution configuration change, keep it across a daemon restart, and re-verify it at lower priority than ordinary tests." FR8, for AC7, as this ticket amends it from "the daemon's own runs and discoveries" (granted by the orchestrator at 07:09 on 2026-10-01): "a workspace or discovery that keeps becoming due only through changes the daemon's own jobs made to the same file is held until an edit, and every answer says why." FR22, for AC8: "Answer a `defects` query through the CLI with versioned `--json` output, giving each defect definition's evidence state, its freshness and reason, the verified, eligible and total counts, and the gaps, without starting a test."

`docs/plan.md`: "After ordinary tests pass, lower-priority work falsifies the affected named defects in isolation." And: "Prioritize ordinary tests over falsification."

ADR-0007: "An experiment whose inputs moved while it ran stores nothing. The baseline and experiments never become ordinary results. A job starts only while no ordinary job is due or running, and yields when one becomes due." And its measurement: "over 103 of this repository's named defects, a fresh instance per mutation took a median of 8.47 s, and one reused instance 1.33 s". Its sentence "A falsification job covers one Vitest workspace: the defects in it whose evidence is not current and whose test holds a current pass at the workspace's current input fingerprint" is the one AC2 narrows to at most 25 a job; the task list reports the ADR's new text.

`docs/architecture.md` § Falsification jobs: "An abort ends the job at the run in progress, a confirming run included: the reply is marked interrupted and holds only the runs that finished, with no restored baseline. An experiment whose first run the abort ended, and every experiment after it, reads interrupted". The judge (`judgeRan` in `falsify/verdict.ts`) gives an experiment that ran no verdict without a recorded restored baseline (`restored-baseline-unrecorded`), so an aborted job carries a verdict only for an experiment decided before any run or whose baseline did not pass.

§ Holds on self-changing workspaces and discoveries: "A change the tracker records while a run or discovery runs is the daemon's own, whichever workspace it reaches, unless a `changes` request names its file as edited". § Executor processes: "A run's executor that ends after a stop, and a discovery's, a dependency build's or a falsification job's that dies, store nothing", and "When a job has not ended 15 s after a stop, which is the force-stop grace plus a margin, the daemon ends that tree and stores nothing for the job."

Glossary, verbatim: **Falsification job**: "One executor job that runs a Vitest workspace's baseline, each of its defects' experiments and the restored baseline in one Vitest instance." **Eligible defect**: "A defect whose definition is valid, whose anchor matches, and whose test holds a current pass, so it can be falsified now." **Execution state**: "What the daemon is doing with a Vitest workspace: running it, holding it queued to run, holding it interrupted by a change until the next round decides it, or idle. It is independent of every result's outcome and freshness." **Verified**: "Every defect definition in scope has current evidence that its test detects it."

The owner's words that bind the design. 03:25 on 2026-09-30: "I only want you to elevate to me if a design decision that is truly broken needs my attention. I'm not terribly interested in chasing edge cases right now. this is tooling for fleet cooling and others going forward". 04:12 on 2026-10-01: "I think the catalog should go. I like asking the simpler question." 04:43: "the deciding factor on whether we should address it is look at Fleet Cooling's codebase. Would this edge case come up in it? If not leave it."

#### What Fleet Cooling's `scripts/falsify.mjs` does, and what the schedule keeps

Read whole at Fleet Cooling's 9f139b8d (2,226 lines, of which about 650 are the message classifier ADR-0003 and ADR-0008 replace). It validates every anchor before it writes anything. It runs one unmutated baseline for each workspace and test pattern, then each mutation in a fresh `bun run --filter` process, 2.3 s in convex and 3.2 s in ui by its own header, which tells authors to leave `batch:` unset. A shared batch's survivor is run again alone. It restores files and runs no restored baseline. It prints a `COST:` line and flags a mean over 15 s. An agent starts it, for the mutations in the spec it hands over and no others.

The schedule keeps: anchors checked before any run, a baseline first, each mutation alone, and the cost reported (AC10). It changes: the daemon starts it, for every waiting definition, 25 at a time, problems and new ones first; one reused instance for each job (ADR-0007); a restored baseline; run facts in place of the classifier (ADR-0008); and a job that gives way to ordinary work.

#### Design decisions (scope of analysis: when a job starts, what it covers, what it stores, how it ends and what answers say; the canary gate of ticket 3.6, the summary's counts of ticket 3.4b and file-level freshness of M3 are unanalyzed here)

Accepted by the orchestrator at 06:45 on 2026-10-01, each as written with doing nothing and one coarser rule beside it.

1. **A job covers at most 25 definitions of one workspace.** Do nothing (ADR-0007's one job for all a workspace's waiting defects): an aborted job's ran experiments get no verdict, so any input change loses the whole job, and a job over thousands of definitions never finishes under an agent that saves every few minutes. Exact (the job stores as it goes, or runs a restored baseline when aborted): a new executor message and a judge change in `falsify/falsify-workspace.ts`, at 474 of 500 lines. The bound is one rule and costs one instance load and two baselines for each 25, about 27 s of a 95 s job by the estimate below.
2. **The answer's listing order, with a definition left without a verdict last.** Do nothing (file order) puts an agent's new definition behind every stale detection, a wait `falsify.mjs` never had. A finer order by cause of staleness is a list of cases.
3. **Any change of the input revision ends the job.** Coarser than "an ordinary job became due", and the same event that would have left the job's evidence unstorable or started a round.
4. **Moved inputs are judged by the job's window over every input of the project**, as a discovery is, not by a run's placement inside one workspace's inputs. It costs nothing: by decision 3 any change ended the job.
5. **A job time bound.** Fleet Cooling's codebase would meet a mutation that never ends: its production code holds at least 26 loop heads (`git grep` for `while (`, `for (;;` and `do {` outside tests at 9f139b8d), several the guarded loops a named defect mutates, as `while (i < text.length)` in `packages/convex/lib/excelUtils.ts` and `while (depthQueue.length > 0)` in `packages/convex/categories/queries.ts`. Do nothing: such a definition stays never verified, sorts first and stops every other definition of the worktree. The same mark comes from AC4's rule, for the definition that was the one running when an input change ended its job in each of the last two jobs that held it. Do nothing there was refused because Fleet Cooling's agents save more often than the bound, so one mutation that never ends would stop every definition of the worktree while an agent works; marking at the first input change was refused because it blames whichever definition a save happens to land on, and an agent's own new definition is first in the order.
6. **No second experiment for a definition at one revision, but after a job the time bound ended, and no further job for a workspace whose job did not run.** One rule ends every loop of jobs that run to their end: a no-verdict judgement, evidence that still reads unknown, a refused workspace, a store that cannot write. A job its own write ends is not among them: see § Known limits. No periodic retry: a refusal comes from the workspace's configuration, which is an input.
7. **A falsification job is told to the change record under its workspace's subject**, as a run of it is. The exact option gives it a subject of its own, which changes the `Job` type through the answer types and the CLI.
8. **Answers reuse the activity and the list of jobs that ended with nothing stored.** No new answer member. A waiting definition's reason is read from its own row in a `defects` answer (eligible, its freshness and causes) beside the activity, the round and that list.
9. **The daemon keeps nothing of the definition files between queries.** The schedule reads them at each look, as the query does. Ticket 3.4b's summary then reads them for each query, unmeasured, which is 3.4b's to measure. The schedule pays the same read, with every mutation file's anchor count, once for each look, so once for each job, unmeasured here; ticket 3.7 measures it beside the two targets.
10. **Falsification runs on the run `Executor`, as a step of the scheduler's loop.** That loop runs one step at a time, which is the guard `Executor.#job` lacks. An ended outcome whose value is not an object is refused where this module reads it, so `daemon/executor.ts` and the 41 records anchored in it are not edited.
11. **The room is made in this ticket.** Folding the three moves in proves the 71 and 48 records anchored in the lifecycle and the scheduler once, where a make-room ticket ahead of it would prove them twice.

Decided by the orchestrator at 06:48 on 2026-10-01: "keep the plan's rule for M2, re-verify everything stale at lowest priority, with no quiet-period rule".

Decided by the author at the ticket review, 07:05 on 2026-10-01:

12. **The protocol version rises and `CLI_JSON_SCHEMA_VERSION` (`packages/cli/src/output.ts`) stays**, as ticket 3.4 decided for added members ("The protocol version rises ... `CLI_JSON_SCHEMA_VERSION` in `packages/cli/src/output.ts` stays 1"): a new activity state and an optional job kind are additions.

Accepted by the orchestrator at 07:09 on 2026-10-01, the author's three decisions on what the review found open in the queue's protection against a definition that blocks it:

- **AC4's two jobs in a row.** A definition that was the one running when an input change ended its job, in each of the last two jobs that held it, is marked as the bound marks one. Doing nothing and the coarser rule are beside it in decision 5.
- **AC5's reading of the reply.** The reply names the definition whose run was interrupted, and none when the baseline was the run in progress; a bound that ends a job in its baseline counts as a job that did not run (AC6). Do nothing (mark no definition) leaves a mutation that never ends first in the order, at the bound's cost each time. The coarser rule (every definition of the ended job waits for the next revision) gives the other 24 no verdict each time the loop is met. The reply already names the run an abort ended (§ Falsification jobs, quoted above), so reading it adds no executor message.
- **AC6 and AC8's entry for a reply that could not be stored.** Do nothing leaves a workspace whose reply the store refused taking job after job, with no answer saying why. The coarser rule (the run's entry for that workspace) would replace a run's own entry, which AC8 keeps beside it.

These are three rules on one mechanism. The owner at 06:29 on 2026-10-01: "i don't mind letting you make design decisions, I just want to avoid the over engineering branch that happened earlier". A further case that asks for a fourth rule there goes to the orchestrator as a design question, with the simpler alternatives beside it (as bounding one experiment's run where the bound now covers a job), before any rule is written (orchestrator, 07:09).

#### Known limits (each entry says what it reads)

- **At Fleet Cooling's size, while evidence freshness has workspace granularity (ADR-0007).** Every figure here is an estimate from this repository's medians, none is measured on Fleet Cooling. Its [P0] tags, one mutation each by its own gate, counted at its 9f139b8d: convex 7,076 in 609 test files, storefront 1,532, admin 1,297, ui 685, lib 43; it commits no definition today. One job of 25 is about 95 s: 7 s to load an instance (ADR-0007's 8.47 s less 1.33 s), two runs for each definition that reads detected at 1.33 s each, and two baselines put at 10 s each; about 950 definitions an hour. With Fleet Cooling's own 2.3 s for a scoped convex run, a job is about 140 s. So one full re-verification, with nothing else due throughout, takes about 7.5 to 11 hours for convex (284 jobs), 1.6 hours for storefront, 1.4 for admin, 45 minutes for ui, 3 minutes for lib, and 3.4 hours for this repository's 3,195. An edit anywhere in a workspace's inputs reads every definition in it stale, and in each workspace that depends on it; the save ends the job in flight, losing at most that job's work, the ordinary run goes first, and the order starts again. An agent therefore sees its new and its problem definitions answered in the first job after the ordinary run passes, about 1.5 to 2.5 minutes, while the long tail of stale detections in a workspace it keeps saving into is rarely current until M3 narrows freshness, and `verified` there reads far below the total for most of a working day. The machine falsifies whenever no ordinary job is due and a definition is waiting, one job after another, so at full adoption it is rarely idle while an agent works in convex. Gradual adoption scales it in proportion: 500 convex definitions are 20 jobs, about 30 to 45 minutes.
- A change that moves no input revision is seen at the next look. A definition file, or `rt-test.json`'s declared names, in a file the consumer declares a non-input, is read again at the next input change or periodic reconciliation, up to 5 minutes later.
- A transient failure, as an executor that died, is not retried until an input changes or the daemon restarts; the entry of AC8 names the input change.
- A hold that a falsification job's writes cause names it as the run of its workspace. Fleet Cooling's tests write only under `os.tmpdir()`, so its suite does not produce it: `git grep -l -E "writeFileSync|writeFile\(|mkdirSync|appendFileSync|rmSync|mkdtemp" -- '*.test.ts' '*.test.tsx' '**/test/**'` at its 9f139b8d named one file, `packages/convex/test/ai/evalRunner.test.ts`, whose writes go under `mkdtempSync(path.join(tmpdir(), ...))`.
- A workspace whose tests rewrite, on every run, an input that lies outside its own inputs has its falsification job ended by that write each time, and the job starts again at each new revision, at lower priority than every ordinary job. A write inside its own inputs holds the workspace (FR8), whose definitions are then not eligible. Fleet Cooling's tests write only under `os.tmpdir()`, by the search above.
- The job reads each mutation's file with no check that it is a regular file, where the anchor count reads only one (`readMutationFile` in `defects/resolve-definitions.ts`). Both read UTF-8 and keep a byte order mark. A definition whose file is not regular reads anchor missing and is never taken, so the job meets one only if the file is replaced between the look and the job's read.
- The time bound is one figure for every job. A workspace whose 25 experiments honestly take longer has each job ended at the bound, one definition marked each time, until the constant is raised: measure it in ticket 3.7's corpus and in the Fleet Cooling trial.
- The marks are kept in memory only. After a restart every waiting definition may be taken again, a looping one first until its job reaches the bound once.

#### Measured: what a read of the latest results costs

Ticket 3.4's review asked this ticket to measure `readLatestResults` before a job fills the table. Median of 21 reads in one process, warm, over a real `node:sqlite` store filled through `writeEvidence`, on a Ryzen 7 8700F (16 logical cores), 32 GB, Node 24.19.0, Windows 11, at 06:38 on 2026-10-01: 0 records 0.09 ms; 1,000 records 17.6 ms; 3,000 records 49.1 ms; 10,000 records 215.4 ms. Every summary, path status, wait, changes answer and plan pays it. The orchestrator dispatched the store's change as its own inline change in Tree 1 at 06:45 (lane evidence-read): the store keeps each scope's evidence as it last read it and reads the rows again only after its own write. That lane measured 205 ms as the median over 10,812 records (orchestrator, 06:55), which is the count of `[P0]` tags in every test file of Fleet Cooling's tree; its five Vitest workspaces hold 10,633 of them, the per-workspace figures of § Known limits. As built, the first read after each `writeEvidence` call rebuilds every record, 180 ms at 10,812 records (orchestrator, 07:09), so that read still pays the full cost, about 0.2 s at Fleet Cooling's size. That is fine at one write for each job and rules out a write for each experiment: this ticket stores one reply for each job, whole, as `writeEvidence` takes it (AC3), and hands it no reply that carries no verdict, since that call stores nothing and still costs the next read a rebuild (orchestrator, 07:09). Write this ticket against a read that costs what that change leaves it, and do not cache evidence in the schedule.

#### Questions to the orchestrator

Asked at 06:43 on 2026-10-01; decided by the orchestrator at 06:45.

- Sizing, at about 29 raw files and 38 estimated: split. Ticket 3.4c holds the defects side and builds first; this ticket keeps the daemon side "in the 25 to 30 band because a further cut would split one contract".
- The declared names and evidence: ticket 3.4c's digest covers them, on FR15's words.
- The read's cost: its own inline change, as above.
- The eleven decisions: "accepted as written". Every number stays a target until measured.
- A note for the Fleet Cooling trial's preflight, no test asked: four of its five Vitest configs set `experimental.fsModuleCache: true` on Vitest ^4.1.11. Each is its workspace's root config, which the session forces off (`vitest/workspace-session.ts`); the job refuses only a nested project's config (D3649's fixture), so no refusal is expected there, and no test here runs a root config that sets it through a falsification job.

From the orchestrator at 07:09 on 2026-10-01, unasked, to the successor author: the three review decisions above are accepted, with the watch on a fourth rule; a reply with no verdict is not handed to `writeEvidence` (§ Measured); FR8's phrase "the daemon's own runs and discoveries" becomes "the daemon's own jobs", granted to this lane in `docs/requirements.md`; and the clause of the sprint file's ticket 3.5 entry beginning "`readLatestResults` parses, rebuilds and judges again" is the orchestrator's to replace when lane evidence-read lands.

#### Pending siblings

- 3.4c (ready for dev ahead of this ticket) creates `defects/worktree-standings.ts`, returns the declared names from `readDefinitionFiles`, puts them in the definition digest and exports the listing comparison. This ticket builds after it lands and edits none of its files.
- Lane evidence-read (Tree 1, inline) edits the store alone; this ticket calls `writeEvidence` and `readLatestResults` as they are.
- 3.4b (backlog) writes `daemon/lifecycle.ts`, `query/summary.ts` and `packages/cli/src/answer-text.ts`, all of which this ticket writes, so it builds after this ticket and never beside it, as the sprint's order says. The room this ticket makes in the lifecycle is what 3.4b's `summary()` change needs.
- 3.6 (backlog) gates the job this ticket starts on its workspace's canary result. Its seam is the point in `falsification.ts` where a job is about to be sent: a refused workspace is one whose job did not run (AC6), with 3.6's reason, and it is handled as a workspace the start no longer confirms is: marked, with the call resolving true, so the next look takes the next workspace's definitions. This ticket builds no gate.
- 3.7 (backlog) measures the two targets over its corpus; 3.8 (backlog) reads this repository's own defects through the schedule.
- No unbuilt ticket names `daemon/round-selection.ts`: `node scripts/list-unbuilt-work.mjs --except 3.5 packages/daemon/src/daemon/round-selection.ts` at 07:09 on 2026-10-01 found only 3.4c naming the `packages/daemon` area, and 3.4c edits no file under `daemon/`.

#### Current structure of the modified files

Code lines are by `grep -cv '^\s*$\|^\s*//\|^\s*/\?\*' <file>`, and records by `cat packages/daemon/test/defects.json packages/daemon/test/*/defects.json packages/cli/test/defects.json | grep -c '"file": "<path>"'`, both at fb40e5cf (06:52 on 2026-10-01), and `daemon/round-selection.ts` at 0dcf5032 (07:09), which changed no code.

- `daemon/lifecycle.ts` (498 lines, 71 records): `DaemonLifecycle` builds the `Scheduler` with `discover`, `run` and `idle` calls, each job inside `#idleAfter`; `#moment()` gives the latest results, the view and the inputs; `status()` gives the activity and `#unstored.jobs()`; `#discover` calls `#protectDiscovered`, 36 lines that read only the inputs, the stop check and their arguments.
- `daemon/scheduler.ts` (495, 48): `#step` quiesces, plans, and takes a `discover`, `wait`, `run`, `again` or `idle` step; `#plan` is synchronous and starts nothing; `#idle` waits for a change of revision or a periodic reconciliation; `discoveryInEffect` is a module function of 9 lines at its end; `#selectRound` is 43 lines that read the log, the narrowing, `#snapshot` (which it also sets) and `#runs.isHeld`, with the four entry constants `NO_SNAPSHOT_REASON`, `NO_SNAPSHOT_ENTRY`, `FIRST_ROUND_REASON` and `FIRST_ROUND_ENTRY` that only it reads.
- `daemon/round-selection.ts` (171, 15): `explainRound`, `unselectedRound`, `changedPaths`, `NO_SELECTION_CONSEQUENCE` and `RoundSelection`, which `#selectRound` calls.
- `daemon/job-endings.ts` (103, 8): `threwOutcome`, `storeBindings`, `storeFailureReason`, `UnstoredJobs`, keyed by workspace path with the discovery as undefined. This ticket leaves `UnstoredJobs` as it is.
- `daemon/discovery-history.ts` (215, 25): `DiscoveryHistory`, `DiscoveryInEffect`, `DiscoverReport`.
- `daemon/run-history.ts` (271, 25): `RunHistory` owns the `ChangeRecord`; `began(entry, revision)` returns the calls for a run's endings; `discoveryBegan`, `discoveryNotBegun`, `discoveryEnded` and `discoveryThrew` pass through for the discovery.
- `daemon/protocol.ts` (259, 6): `PROTOCOL_VERSION = 5`; `DaemonActivity` (`discovering`, `running` with a workspace path, `idle`); `UnstoredJob` (`workspacePath?`, `reason`).
- `query/answer.ts` (492, 4): `activityText`; `AnswerContext.activity` and `unstoredJobs`; `SelfChangedPath.jobs` is typed from `UnstoredJob`'s `workspacePath` alone and stays so.
- `query/summary.ts` (360, 46): `unstoredClause` words each entry "the discovery" or "the run of" its workspace; `answeredJob` cuts each reason.
- `packages/cli/src/answer-text.ts` (493, 46): `jobText` words an entry the same way, for the list and for a hold's jobs alike; `contextLines` prints the activity and the list.

`inputs.changed()` also resolves when a reconciliation ends or the pending reads drain, so the wait that ends a job compares the revision before it aborts.

#### Tests this change may break

- `packages/daemon/test/scheduler.test.ts` builds `SchedulerParts`, and `lifecycle.test.ts` the lifecycle's parts: each needs the new call, which the typecheck finds.
- `packages/daemon/test/scheduling-harness.ts`: `RecordingStore.writeEvidence` always throws, its latest results hold no evidence, and it gives every discovery the id "discovery" (3.4's review). A lifecycle test cannot see evidence stored until it records the write.
- A test that scripts an answer with `activity` or `unstoredJobs` (`packages/daemon/test/query.test.ts`, `lifecycle.test.ts`, `packages/cli/test/cli.test.ts`) changes only where it enumerates every activity state or asserts the protocol version as a literal.
- Records anchored in moved code are re-anchored, and every record whose mutated file this change edits is proven again by id (`_agent-docs/crew.md` § Gates): the counts are in the section above.
- From 3.4's review, for the tests session: `packages/daemon/test/experiment-facts.ts` imports the harness for one constant, repeats `RanJob` and a `judgementOf` of `test/falsify/job-readings.ts`, and exports three names nothing imports.

#### Sizing

21 raw files and 27 estimated (21 times 1.3); code units 10 (nine criteria that need code, AC9 needing none, and validation). Over 25 and under 30: a further cut between the schedule and what answers say of it would split the one list of jobs that ended with nothing stored, which the daemon keys by job kind and the summary's reason and the CLI word by job kind in the same change (orchestrator, 06:45 on 2026-10-01). Production, modified: `daemon/lifecycle.ts`, `daemon/scheduler.ts`, `daemon/job-endings.ts`, `daemon/discovery-history.ts`, `daemon/round-selection.ts`, `daemon/run-history.ts`, `daemon/protocol.ts`, `query/answer.ts`, `query/summary.ts`, `packages/cli/src/answer-text.ts`. Production, created: `daemon/falsification.ts`, `daemon/falsification-plan.ts`. Tests, for create-tests: `test/scheduling-harness.ts`, `test/lifecycle.test.ts`, `test/scheduler.test.ts`, `test/query.test.ts`, `test/experiment-facts.ts`, `packages/daemon/test/defects.json`, `packages/cli/test/cli.test.ts`, `packages/cli/test/defects.json`. This ticket's file. Over 10 estimated, so dev delegates in groups over disjoint files, in this order: the three moves; the plan module, which has no I/O; the job module with the scheduler, the run history and the lifecycle; then the protocol, the two wordings and the CLI.

#### Ticket review

One review agent, ticket-internal, returned 19 edits and 9 questions at 07:05 on 2026-10-01 (findings F1 to F33, with F6 to F8 unused). Every finding was applied but these. F26's premise was wrong: a held workspace's last run is stored invalidated, so its tests hold no current pass and its definitions are not eligible (`docs/architecture.md` § Holds on self-changing workspaces and discoveries); its narrower case, a job its own write to an input outside its workspace ends, is a known limit and no rule. F33 stands on ticket 3.4's decision (design decision 12). F25 asked what keeps a mutation that never ends from holding the front of the order under frequent saves: the author decided AC4's two jobs in a row (decision 5), which the orchestrator accepted at 07:09 with the two other decisions listed under the design decisions.

### References

- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.5 and § Ticket 3.4c.
- `_agent-docs/tickets/3-4c-declared-assertion-names.md`; `_agent-docs/tickets/3-4-defect-evidence.md` § The interface ticket 3.5 calls and its Review Record § For the tickets that follow; `_agent-docs/tickets/3-2-transform-experiments.md` Completion Notes, on a mutation that never ends.
- `docs/adr/0002-daemon-sole-executor.md`, `docs/adr/0003-transform-falsification.md`, `docs/adr/0007-reused-instance-per-falsification-job.md`, `docs/adr/0008-detection-from-task-facts-and-canaries.md`.
- `docs/architecture.md` § Falsification jobs, § Reconciliation and the round of runs, § Holds on self-changing workspaces and discoveries, § Executor processes, crashed runs and process trees, § Storing a discovery or run under its fingerprint, § Results store, § Defects query, § Execution and falsification isolation, § Query surface.
- Fleet Cooling's checkout at 9f139b8d, read only: `scripts/falsify.mjs`, its five `vitest.config.mts` files, and its test and production trees for the counts above.
- `node scripts/list-open-issues.mjs` printed "0 open issues, complete" at 06:44 on 2026-10-01, so no issue bears on this ticket.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C5,C8,C10,C11,C12,C13,C14,C19,C21,C22,C30,C31,C32,C36,C37,C38,C39,C40,C45,C46,C48,C49,C52,C55,C59,C113,C114,C116,C118,C119,C120,C121,C122,C123,C135,C137,C138,C139,C140,C142,C146,C147,C150,C151,C154,C157,C160,C167,C169,C170,C173,C174 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P18,P19,P21,P31,P32,P36,P37,P39,P40,P41 -->

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
sizing_ac_count: 10
files_to_modify:
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/scheduler.ts
  - packages/daemon/src/daemon/job-endings.ts
  - packages/daemon/src/daemon/discovery-history.ts
  - packages/daemon/src/daemon/round-selection.ts
  - packages/daemon/src/daemon/run-history.ts
  - packages/daemon/src/daemon/protocol.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/query/summary.ts
  - packages/cli/src/answer-text.ts
files_to_create:
  - packages/daemon/src/daemon/falsification.ts
  - packages/daemon/src/daemon/falsification-plan.ts
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

- `_agent-docs/tickets/3-5-schedule-falsification.md` (created by create-ticket)
- `_agent-docs/sprints/sprint-3-falsification.md` (create-ticket: § Ticket 3.5's scope line and ticket link, and this ticket's sizing figures in the paragraph on the cut from 3.4c)
- `docs/requirements.md` (create-ticket: FR8 reads "the daemon's own jobs")

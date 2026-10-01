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

- [x] AC1: Once a round has planned at an input revision and found no discovery and no workspace due, the daemon looks for waiting definitions and, when it finds one it may take (AC6), starts one falsification job. When that job ends the daemon plans again, so an ordinary job that became due meanwhile goes first and otherwise the next falsification job follows, until no definition it may take is waiting. No job starts while a discovery or a run is due or running, while a round is pending or held, before the first reconciliation has ended, or after a stop. A definition that is invalid, whose anchor is missing, or whose test holds no current pass is never given an experiment, and the other definitions still are. (FR13, FR15)
- [x] AC2: A job covers one workspace and at most 25 definitions (a target until measured). The definitions the daemon may take are ordered as a `defects` answer lists them (by state, then by file and position), with every definition marked as left without a verdict (AC4, AC5) in this daemon's life after every other; the job's workspace is the first one's, and the job holds that workspace's definitions in that order up to the bound. Each experiment is built from its definition's standing: its id, its resolved test's identity, and its mutation with the file as the one absolute path the definition check gives it. The job is handed the workspace's confirmed config file and the assertion error names the same read returned. (FR10, FR15)
- [x] AC3: When a job's reply reads `ran`, and from the moment its definitions' standings and its workspace's fingerprint were read to the job's end no input changed and no event named one, each verdict the reply carries is stored as that defect's evidence, in one write for the job's whole reply, bound to the definition digest of the standing its experiment was built from and to that fingerprint's digest, so a `defects` answer then reads each with evidence freshness current. That holds for a job in which no run happened: the no-probe-site and no-module verdicts of experiments decided before any run are stored. Nothing of a job is stored when an input changed or an event named one in that window, also when the workspace's fingerprint at its end equals the one at its start; when its reply does not read `ran`; when its executor ended without a reply or replied with a job that is not an object; or when a stop arrived. A judgement with no verdict stores nothing and leaves the defect's earlier evidence. (FR10, FR15)
- [x] AC4: A change of the input revision while a job runs ends the job: it is aborted and ends within the executor's bound, nothing of it is stored, and the next round is planned as it would be had no job been running, so no discovery and no run waits for a job's remaining experiments. None of its definitions is marked, with one exception: a definition that was the one running (AC5) when an input change ended its job, in each of the last two jobs that held it, is marked as AC5 marks one, so a mutation that never ends cannot hold the front of the order under an agent that saves more often than the time bound. A stop ends a running job the same way and marks nothing. (FR15)
- [x] AC5: A job that has not ended 10 minutes (a target until measured) after it was sent to its executor is aborted. The definition that was running when a job was ended is the one a `ran` reply names: the first experiment whose first run or confirming run reads interrupted, and none when a baseline, the first or the restored one, was the run in progress. When the bound ends a job and its reply names one, that definition is marked as left without a verdict: it is not taken again until the input revision or its definition digest changes, and it sorts last (AC2). Every other definition of that job that got no verdict may be taken again at once, and whatever verdicts the reply carries are stored under AC3's conditions. When the reply names none, or no reply comes, the job is one that did not run (AC6). (FR15)
- [x] AC6: No definition of a job whose reply read `ran`, and that neither an input change nor the time bound ended, is taken again until the input revision changes, whether or not it got a verdict, nor is a definition AC4 or AC5 marks; every other definition of a job the time bound ended may be given a second experiment at that revision (AC5). A workspace whose job did not run (its reply read refused, unsupported, not confirmed or failed, its config is no longer confirmed, its executor ended without a usable reply, or the time bound ended it in a baseline), or whose reply could not be stored (the store failed, or an event named an input while it ran at a revision that did not move), gets no further job until the input revision changes. A periodic reconciliation leads to a look as any plan does, and lifts none of these. A definition whose definition digest changed is one that has had no experiment. (FR15)
- [x] AC7: A change the tracker records while a falsification job runs is an edit, as a change while nothing runs is: it ends the job as AC4 says, it counts toward holding no workspace and not the discovery, and it releases a hold it reaches as any edit does. Nothing of a falsification job, neither its begin nor any way it ends, is told to the change record. (FR8)
- [x] AC8: Every answer, and `status`, say what falsification is doing. While a job runs, the daemon's activity reads falsifying, with the workspace and the number of definitions in the job. For each workspace whose job did not run or whose reply could not be stored at the current input revision (AC6), and for each workspace holding a definition that got no verdict at the current input revision or is marked as left without one (AC4, AC5), the list of jobs that ended with nothing stored holds one entry marked as a falsification job, a single entry also for a workspace of which both are true. Its reason says what happened to the workspace (the refusal with its projects and settings, an unsupported or unconfirmed workspace, the failure to load, how the executor ended, the time bound, the store's failure, the input an event named while it ran), names those definitions by id, each with its reason, up to 20 and the number of the rest, or does both with the workspace's part first. It says what ends each wait (a change of the input revision, and for a definition also a change of the definition or of the declared names) before it names any definition, so a reason an answer cuts for length loses only names, each of which the log holds (AC10). A reason never holds a definition's `old` or `new` text. An entry leaves the list when what it says no longer holds, and a run's entry and a falsification's for one workspace stand side by side. The CLI's text and a query's no-answer reason word the entry as the falsification of its workspace. The protocol version rises. (FR15, FR22)
- [x] AC9: A falsification job stores no run and no discovery, and neither its verdicts nor the entries of AC8 change a test's state or freshness, a count of any answer but a `defects` answer's, whether a query answers, or a workspace's execution state; a change its own run makes to an input is an edit as any other (AC7): its workspace reads idle while it is falsified, and a `wait` settles or not as it would with no job. (FR10)
- [x] AC10: The daemon's log names each job as it starts (the workspace, the number of definitions, and the first definition's id and state) and as it ends (how it ended, the number of verdicts stored of each kind, the number of definitions left without one and each of them by id with its reason, and its wall time), and names once, for each input revision, a look that found definitions waiting and took none, with why. (FR15)

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

**Resolutions (dev, threadId 728d4a9a-f78a-40de-b495-1d4ad06e14ea, 08:45 on 2026-10-01).**

- **U1: CONFIRMED on Windows, on both lines, by observation.** A scratch probe drove the real `Executor.falsify` over a throwaway project of three experiments, the second turning `while (i < limit)` into `while (i < limit || true)`, called `abort(ABORT_PURPOSE.interruption)` 3 s after the worker began to spin, then started an ordinary run on the same `Executor`. Windows 11, Node 24.19.0, run lease free, 08:43 to 08:45. Vitest 5.0.1 with the forks pool: the reply read `ran` and interrupted 10.03 s after the abort, and the ordinary run completed in 1.40 s. Vitest 4.1.11, forks: 10.03 s, then 0.93 s. Vitest 5.0.1, threads: 10.02 s, then 0.53 s. Vitest 4.1.11, threads: 10.02 s, then 0.59 s. Each reply held the baseline and no restored baseline; the first experiment read `ran` with its confirming run and was judged no verdict (`restored-baseline-unrecorded`); the looping experiment and the one after it read `not-run` and interrupted, so the first interrupted experiment is the looping one, as AC5 reads the reply. The 10 s is the force-stop grace: `RunInterruption` in `vitest/run-interruption.ts` issues its second cancel `FORCE_STOP_GRACE_MS` after the abort, which force-stops the worker, and `#run` in `falsify/falsify-workspace.ts` then returns the interrupted step. So a consumer meets AC5's first outcome, and a job on a looping mutation costs that grace after its abort before the next round, 5 s inside `EXECUTOR_BOUND_MS` on a quiet machine. A reply that comes later than the bound is the no-reply outcome AC5 already covers. Fleet Cooling's five Vitest configs all set `pool: "forks"`. The probe is `_agent-docs/.scratch/t3-5-u1/probe.mjs` in Tree 2, with its four reports beside it. Not observed on Linux: the probe needs a Linux install of its own, so Linux is listed as unverified in the Dev Handoff (orchestrator, 08:49). Accepted as observed by the orchestrator at 08:49 on 2026-10-01.
- **Known limit from U1 (orchestrator, 08:49).** A job on a mutation that never ends costs the 10 s force-stop grace after its abort before the next round starts, and under load the 15 s executor bound can pass first, which AC5 reads as a job that did not run.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing.
- [x] (Support) Make room, changing no behavior. `daemon/lifecycle.ts` holds 498 of lint's 500 code lines and `daemon/scheduler.ts` 495, and each needs about a dozen more. Move `#protectDiscovered` out of the lifecycle into `daemon/job-endings.ts` as a function of the tracked inputs, the stop check, the discovery, its verdict and its start time; move `discoveryInEffect` out of the scheduler into `daemon/discovery-history.ts`, beside `DiscoveryInEffect`, taking the latest results and the inputs so that file imports nothing from the scheduler; and, since those 9 lines do not cover the scheduler's need, move `#selectRound` with the four entry constants only it reads out of the scheduler into `daemon/round-selection.ts`, as a function of what it reads (the log, the narrowing, the previous snapshot, the due and the confirmed workspace paths, the held check) that returns the selection with the snapshot to keep. `query/answer.ts` (492) gains about 2 lines and `packages/cli/src/answer-text.ts` (493) about 2, which fit; ask the orchestrator before any further extraction. Every existing test passes unedited. List each record anchored in moved code under the Dev Handoff, with its new file, for the tests session to re-anchor and prove.
- [x] (AC1, AC2, AC4, AC5, AC6) Create `packages/daemon/src/daemon/falsification-plan.ts`, with no I/O: from the standings 3.4c's function returns, the input revision and the marks, it gives the definitions the daemon may take in AC2's order, the next job's workspace and definitions with each one's experiment, and why nothing is taken when definitions are waiting. It holds the marks: by definition digest, the revision its experiment ran at and, when it got no verdict, why; by definition digest, whether the last job that held it was ended by an input change while it was the one running, which a second such ending in a row turns into the mark AC5 gives, set at the revision read when that job returned (AC4), and which any other ending of a job that held it clears; by workspace, the revision its job did not run at, why, and what ends its wait (the protocol task). Name the bound of 25 as a constant with the comment that it is a target until measured. Order by `compareStandings`, the comparison 3.4c exports for the answer's listing, never a second spelling of it.
- [x] (AC1 to AC8, AC10) Create `packages/daemon/src/daemon/falsification.ts`, the one module the lifecycle calls. One call does a look and at most one job, and resolves true when the scheduler is to plan again: a job began, or the look marked a workspace and sent none. In order: wait for the inputs to settle; call 3.4c's function with a moment that opens the job's window on the tracker (`beginJob`) in the same tick it reads the lifecycle's moment, so no await stands between the fingerprint and the window (AC3); and when it returns, with no await after it, close the window and return false after a stop or when the revision the moment read is not the planned one (C160). A check before the call may stay as a cheap exit, and vouches for nothing. Hand the function the lifecycle's stop signal: it throws when that signal has aborted, before it reads the moment, so its throw after a stop is a look that took nothing with no window to close, and any other throw goes on to the scheduler's step as a discovery's does; it returns a `NoAnswer` only after it read the moment, so a `NoAnswer` is a look that took nothing whose window is closed, and the call resolves false. Close the window on every path that starts no job. Take the workspace's fingerprint digest from the basis the call returned, and its config file from the confirmed start; a workspace the start no longer confirms is marked as one whose job did not run (AC6) and the call resolves true, so the scheduler plans again and the next look takes the next workspace's definitions. On a look that found definitions waiting and took none, write the log entry once for each input revision (AC10), keeping the revision it was last written at beside the marks. Tell the change record nothing of a job, at its begin or at any end: the window on the tracker is the job's alone, for AC3, and a change it holds is an edit (AC7). When a job is about to be sent, write the log's start entry, set the activity, and send the job on the lifecycle's run `Executor` with the declared names the same call returned as its assertion error names (AC2). End it at a change of the input revision or at the time bound with `abort(ABORT_PURPOSE.interruption)`. When the job returns, on every path, clear the bound's timer and drop the revision wait, so neither calls `abort` on the `Executor` during a later run or job (C157); then close the window, store under AC3, update the marks under AC4, AC5 and AC6, and write the log's end entry, which names each definition the job left without a verdict with its reason (AC10). Hand `writeEvidence` only a reply that carries a verdict, since each call makes the next read of the latest results rebuild every record (§ Measured). Name the time bound as a constant, a target until measured. Read an ended outcome whose value is not an object as one that did not end. Decide what happened from what this module asked for (a stop, a change, the bound), never from an outcome's reason text.
- [x] (AC1) In `daemon/scheduler.ts`, add the falsification call to `SchedulerParts` and take it where a plan finds nothing due: inside `#schedule.during`, so a round pending at a later revision reads the job in progress. A call that resolved true plans again, and one that resolved false idles as today: true means "plan again", whether a job began or the look only marked a workspace (the `falsification.ts` task), never only "a job began". Mark the round dirty when the call resolved true, so the idle entry is logged again after it.
- [x] (AC8) In `daemon/protocol.ts`, add the falsifying activity (workspace path and number of definitions) and a job kind on `UnstoredJob` that only a falsification entry carries, and raise `PROTOCOL_VERSION`; `CLI_JSON_SCHEMA_VERSION` stays (design decision 12). A definition's reason, in a mark and in an entry, is its judgement's reason, one of the judge's closed set (`falsify/verdict.ts`), or this ticket's own word for the time bound or the repeated input change, never an experiment's error text, which can quote the mutated source (AC8, C147). A workspace's mark holds its reason together with what ends its wait, worded where the mark is made, never one ending appended to every reason. Word an entry with what ends each wait before the names of its definitions (AC8), since `answeredJob` and `unstoredClause` keep only a reason's first 1,000 characters (`cutReason`). Give `activityText` in `query/answer.ts` its case. In `query/summary.ts` (`unstoredClause`) and `packages/cli/src/answer-text.ts` (`jobText`), word an entry of that kind as the falsification of its workspace. The lifecycle's `status()` gives the runs' and discovery's entries followed by falsification's, which `falsification.ts` computes from its marks each time it is read, cut as AC8 bounds them.
- [x] (AC1, AC3, AC8, AC9) Wire it in `daemon/lifecycle.ts`: build the module from the lifecycle's parts, its moment, its stop check and its activity; hand the scheduler the call inside `#idleAfter`; add its entries in `status()`. Hand the module the consumer root and the state directory from the one place the lifecycle's `defects()` and its view take them (`identity`): a root spelled another way gives every stored definition digest a value no `defects` query computes, so all evidence reads stale (AC3; 3.4's and 3.4c's reviews). Check that storing evidence calls neither the waits' nor the changes' record of a stored run, since no test's state moved.
- [x] (AC8) Check every consumer of the changed shapes in the same change (C38): each `switch` over `DaemonActivity`, each reader of `UnstoredJob`, and each defect record whose `new` text builds either; and check that no reader which matches an entry by its workspace path alone takes a falsification entry for a run's: `UnstoredJobs.unlist` filters by it, and `jobText` words a hold's jobs, which `SelfChangedPath.jobs` types from `workspacePath` alone, with the list's entries. List what the typecheck cannot see under the Dev Handoff.
- [x] (Support) Report to the orchestrator, with the handoff, the text for the files this lane does not edit: `docs/architecture.md` (§ Reconciliation and the round of runs, § Executor processes, crashed runs and process trees, § Execution and falsification isolation, whose "nothing calls it yet" and "falsification does not yet run them" end here, § Query surface, § Falsification jobs' known limit on a mutation that never ends), `docs/adr/0007-reused-instance-per-falsification-job.md` (a job covers at most 25 of a workspace's waiting defects, and yields at any change of the input revision), `docs/glossary.md` (Falsification job, and a term for a waiting definition if the build keeps the word), `README.md` (what falsification does and when, the two targets, and that the declared names reach each job), and `_agent-docs/next-session.md`.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- Ticket 3.4c's function in `packages/daemon/src/defects/worktree-standings.ts`: the worktree's declared names, resolved definitions, standings and query basis from one read, taking the moment as a call. As built, and unchanged by its review, it is `worktreeStandings(read)`: it takes a `WorktreeRead` (`consumerRoot`, `stateDirectory`, `signal`, `moment`) and returns a `WorktreeStandings` (`basis`, `invalidEntries`, `assertionErrors`, `definitions`, and `standings`, one for each definition in the same order) or a `NoAnswer` alone. It throws when its signal has aborted, before it reads the moment, and it returns a `NoAnswer` only after it has read the moment. No test pins that guard (3.4c's review), so this ticket's test of a stop during a look is the one that goes red when it is dropped, and the `NoAnswer` is also what a discovery refused as unreadable gives. `assertionErrors` is the list as `rt-test.json` writes it. Each standing gives `definition` (its `id`, `resolved` test, `mutation` and absolute `mutationPath`), `state`, `eligible`, `definitionDigest` and `evidence`. A standing's workspace is `definition.resolved.identity.workspacePath`. `compareStandings(left, right)` in `defects/defect-standings.ts`, the answer's listing comparison, gives AC2's order.
- `Executor.falsify(workspace, configFile, experiments, assertionErrors)` and `ABORT_PURPOSE` in `daemon/executor.ts`; `DefectExperiment` and `FalsificationJob` in `falsify/experiment-record.ts`.
- `store.writeEvidence(bindings, job, definitionDigests)` (`store/open-store.ts`, `EvidenceBindings` in `store/defect-evidence.ts`): the store scope with the fingerprint's digest, the `ran` reply whole, and each defect id's definition digest.
- `TrackedInputs` (`inputs/input-tracker.ts`): `settled`, `beginJob`, `endJob`, whose `JobVerdict` reads `fingerprinted` only when the window held no change and no cause, `changed`, and `current().facts.revision`.
- `confirmedEntry` (`vitest/confirmed-start.ts`) for the workspace's confirmed config file, as `#run` in the lifecycle uses it.
- `threwOutcome` and `storeFailureReason` in `daemon/job-endings.ts`; `namedList` and `MAX_NAMED_CHANGES` (20) in `inputs/input-jobs.ts` for a bounded list of names; `cutReason` in `query/summary.ts`.
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

FR10: "Falsify each defect definition by applying its mutation as an in-memory transform in a separate Vitest instance, between a baseline and a restored baseline that both pass its test, without writing any file." FR13: "Report a defect whose mutation anchor is missing as anchor missing, count it in the denominator, and withhold verified while the other defects still run." FR15: "Mark defect evidence stale when its test, mutation, inputs, or execution configuration change, keep it across a daemon restart, and re-verify it at lower priority than ordinary tests." FR8, for AC7: "a workspace or discovery that keeps becoming due only through changes the daemon's own runs and discoveries made to the same file is held until an edit, and every answer says why." FR22, for AC8: "Answer a `defects` query through the CLI with versioned `--json` output, giving each defect definition's evidence state, its freshness and reason, the verified, eligible and total counts, and the gaps, without starting a test."

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
7. **Nothing of a falsification job is told to the change record**, so a change while one runs is an edit, as a change in idle time is (AC7). Decided by the orchestrator at 08:49 on 2026-10-01 on the dev's sanity finding F4, in place of the decision accepted at 06:45 and of the note from 2.7b's review. The other option, telling the record under the workspace's subject as a run is told: at Fleet Cooling's size a job runs whenever nothing ordinary is due, so a save no `changes` request names (a person's, a formatter's, an agent's without the hook) to one file three times in a row holds its workspace until a change happens to land between two jobs, since `ChangeRecord.jobEnded` adds every unreported path of a job's window to every subject's job-caused set and `RunHistory.#nextCount` counts it. Fleet Cooling meets that every working day. A finer rule (counting only what the job's own process wrote) is a new mechanism on the hold counts. What this gives up is the looping case of § Known limits, which Fleet Cooling does not have. It removes a rule, a task and a file.
8. **Answers reuse the activity and the list of jobs that ended with nothing stored.** No new answer member. A waiting definition's reason is read from its own row in a `defects` answer (eligible, its freshness and causes) beside the activity, the round and that list.
9. **The daemon keeps nothing of the definition files between queries.** The schedule reads them at each look, as the query does. Ticket 3.4b's summary then reads them for each query, unmeasured, which is 3.4b's to measure. The schedule pays the same read, with every mutation file's anchor count, once for each look, so once for each job, unmeasured here; ticket 3.7 measures it beside the two targets. Each definition's digest also serializes the whole set of declared names (3.4c's review), a target until measured; once this ticket stores evidence, a change to the digest's shape reads every stored verdict stale.
10. **Falsification runs on the run `Executor`, as a step of the scheduler's loop.** That loop runs one step at a time, which is the guard `Executor.#job` lacks. An ended outcome whose value is not an object is refused where this module reads it, so `daemon/executor.ts` and the 41 records anchored in it are not edited.
11. **The room is made in this ticket.** Folding the three moves in proves the 71 and 48 records anchored in the lifecycle and the scheduler once, where a make-room ticket ahead of it would prove them twice.

Decided by the orchestrator at 06:48 on 2026-10-01: "keep the plan's rule for M2, re-verify everything stale at lowest priority, with no quiet-period rule".

Decided by the author at the ticket review, 07:05 on 2026-10-01:

12. **The protocol version rises and `CLI_JSON_SCHEMA_VERSION` (`packages/cli/src/output.ts`) stays**, as ticket 3.4 decided for added members ("The protocol version rises ... `CLI_JSON_SCHEMA_VERSION` in `packages/cli/src/output.ts` stays 1"): a new activity state and an optional job kind are additions.

Accepted by the orchestrator at 07:09 on 2026-10-01, the author's three decisions on what the review found open in the queue's protection against a definition that blocks it:

- **AC4's two jobs in a row.** A definition that was the one running when an input change ended its job, in each of the last two jobs that held it, is marked as the bound marks one. Doing nothing and the coarser rule are beside it in decision 5.
- **AC5's reading of the reply.** The reply names the definition whose run was interrupted, and none when a baseline was the run in progress, the first or the restored one (the dev's sanity finding F2); a bound that ends a job in a baseline counts as a job that did not run (AC6). Do nothing (mark no definition) leaves a mutation that never ends first in the order, at the bound's cost each time. The coarser rule (every definition of the ended job waits for the next revision) gives the other 24 no verdict each time the loop is met. The reply already names the run an abort ended (§ Falsification jobs, quoted above), so reading it adds no executor message.
- **AC6 and AC8's entry for a reply that could not be stored.** Do nothing leaves a workspace whose reply the store refused taking job after job, with no answer saying why. The coarser rule (the run's entry for that workspace) would replace a run's own entry, which AC8 keeps beside it.

These are three rules on one mechanism. The owner at 06:29 on 2026-10-01: "i don't mind letting you make design decisions, I just want to avoid the over engineering branch that happened earlier". A further case that asks for a fourth rule there goes to the orchestrator as a design question, with the simpler alternatives beside it (as bounding one experiment's run where the bound now covers a job), before any rule is written (orchestrator, 07:09).

#### Known limits (each entry says what it reads)

- **At Fleet Cooling's size, while evidence freshness has workspace granularity (ADR-0007).** Every figure here is an estimate from this repository's medians, none is measured on Fleet Cooling. Its [P0] tags, one mutation each by its own gate, counted at its 9f139b8d: convex 7,076 in 609 test files, storefront 1,532, admin 1,297, ui 685, lib 43; it commits no definition today. One job of 25 is about 95 s: 7 s to load an instance (ADR-0007's 8.47 s less 1.33 s), two runs for each definition that reads detected at 1.33 s each, and two baselines put at 10 s each; about 950 definitions an hour. With Fleet Cooling's own 2.3 s for a scoped convex run, a job is about 140 s. So one full re-verification, with nothing else due throughout, takes about 7.5 to 11 hours for convex (284 jobs), 1.6 hours for storefront, 1.4 for admin, 45 minutes for ui, 3 minutes for lib, and 3.4 hours for this repository's 3,195. An edit anywhere in a workspace's inputs reads every definition in it stale, and in each workspace that depends on it; the save ends the job in flight, losing at most that job's work, the ordinary run goes first, and the order starts again. An agent therefore sees its new and its problem definitions answered in the first job after the ordinary run passes, about 1.5 to 2.5 minutes, while the long tail of stale detections in a workspace it keeps saving into is rarely current until M3 narrows freshness, and `verified` there reads far below the total for most of a working day. The machine falsifies whenever no ordinary job is due and a definition is waiting, one job after another, so at full adoption it is rarely idle while an agent works in convex. Gradual adoption scales it in proportion: 500 convex definitions are 20 jobs, about 30 to 45 minutes.
- A change that moves no input revision is seen at the next look. A definition file, or `rt-test.json`'s declared names, in a file the consumer declares a non-input, is read again at the next input change or periodic reconciliation, up to 5 minutes later.
- A transient failure, as an executor that died, is not retried until an input changes or the daemon restarts; the entry of AC8 names the input change.
- A workspace whose tests rewrite, on every run, an input that lies outside its own inputs has its falsification job ended by that write each time. The write is an edit (AC7), so the workspace it reaches runs again, a hold it reaches is released, and the job starts again at the new revision: a job and a run in a loop until the tests stop writing it, the job at lower priority than every ordinary job. A write inside its own inputs is met first by the workspace's ordinary run, which is stored invalidated or held (FR8), so its definitions are not eligible. Fleet Cooling's tests write only under `os.tmpdir()`, so its suite does not produce the loop: `git grep -l -E "writeFileSync|writeFile\(|mkdirSync|appendFileSync|rmSync|mkdtemp" -- '*.test.ts' '*.test.tsx' '**/test/**'` at its 9f139b8d named one file, `packages/convex/test/ai/evalRunner.test.ts`, whose writes go under `mkdtempSync(path.join(tmpdir(), ...))`.
- The job reads each mutation's file with no check that it is a regular file, where the anchor count reads only one (`readMutationFile` in `defects/resolve-definitions.ts`). Both read UTF-8 and keep a byte order mark. A definition whose file is not regular reads anchor missing and is never taken, so the job meets one only if the file is replaced between the look and the job's read.
- The time bound is one figure for every job. A workspace whose 25 experiments honestly take longer has each job ended at the bound, one definition marked each time, or, when the bound falls in the restored baseline, gets no further job until the input revision changes, until the constant is raised: measure it in ticket 3.7's corpus and in the Fleet Cooling trial.
- The marks are kept in memory only. After a restart every waiting definition may be taken again, a looping one first until its job reaches the bound once.

#### Measured: what a read of the latest results costs

Ticket 3.4's review asked this ticket to measure `readLatestResults` before a job fills the table. Median of 21 reads in one process, warm, over a real `node:sqlite` store filled through `writeEvidence`, on a Ryzen 7 8700F (16 logical cores), 32 GB, Node 24.19.0, Windows 11, at 06:38 on 2026-10-01: 0 records 0.09 ms; 1,000 records 17.6 ms; 3,000 records 49.1 ms; 10,000 records 215.4 ms. Every summary, path status, wait, changes answer and plan pays it. The orchestrator dispatched the store's change as its own inline change in Tree 1 at 06:45 (lane evidence-read): the store keeps the evidence of the scope it read last and reads the rows again only after its own evidence write or a commit through another connection. That lane measured 205 ms as the median over 10,812 records (orchestrator, 06:55), which is the count of `[P0]` tags in every test file of Fleet Cooling's tree; its five Vitest workspaces hold 10,633 of them, the per-workspace figures of § Known limits. As built, the first read after each `writeEvidence` call rebuilds every record, 180 ms at 10,812 records (orchestrator, 07:09), so that read still pays the full cost, about 0.2 s at Fleet Cooling's size. That is fine at one write for each job and rules out a write for each experiment: this ticket stores one reply for each job, whole, as `writeEvidence` takes it (AC3), and hands it no reply that carries no verdict, since that call stores nothing and still costs the next read a rebuild (orchestrator, 07:09). Write this ticket against a read that costs what that change leaves it, and do not cache evidence in the schedule.

#### Questions to the orchestrator

Asked at 06:43 on 2026-10-01; decided by the orchestrator at 06:45.

- Sizing, at about 29 raw files and 38 estimated: split. Ticket 3.4c holds the defects side and builds first; this ticket keeps the daemon side "in the 25 to 30 band because a further cut would split one contract".
- The declared names and evidence: ticket 3.4c's digest covers them, on FR15's words.
- The read's cost: its own inline change, as above.
- The eleven decisions: "accepted as written". Every number stays a target until measured.
- A note for the Fleet Cooling trial's preflight, no test asked: four of its five Vitest configs set `experimental.fsModuleCache: true` on Vitest ^4.1.11. Each is its workspace's root config, which the session forces off (`vitest/workspace-session.ts`); the job refuses only a nested project's config (D3649's fixture), so no refusal is expected there, and no test here runs a root config that sets it through a falsification job.

From the orchestrator at 07:09 on 2026-10-01, unasked, to the successor author: the three review decisions above are accepted, with the watch on a fourth rule; a reply with no verdict is not handed to `writeEvidence` (§ Measured); FR8's phrase "the daemon's own runs and discoveries" becomes "the daemon's own jobs", granted to this lane in `docs/requirements.md`; and the clause of the sprint file's ticket 3.5 entry beginning "`readLatestResults` parses, rebuilds and judges again" is the orchestrator's to replace when lane evidence-read lands. The orchestrator took FR8's phrase back to "the daemon's own runs and discoveries" at 08:49, with its ruling on AC7 (design decision 7).

#### Pending siblings

- 3.4c (ready for dev ahead of this ticket) creates `defects/worktree-standings.ts`, returns the declared names from `readDefinitionFiles`, puts them in the definition digest and exports the listing comparison. This ticket builds after it lands and edits none of its files.
- Lane evidence-read (Tree 1, inline) edits the store alone; this ticket calls `writeEvidence` and `readLatestResults` as they are.
- 3.4b (backlog) writes `daemon/lifecycle.ts`, `query/summary.ts` and `packages/cli/src/answer-text.ts`, all of which this ticket writes, so it builds after this ticket and never beside it, as the sprint's order says. The room this ticket makes in the lifecycle is what 3.4b's `summary()` change needs.
- 3.6 (backlog) gates the job this ticket starts on its workspace's canary reading, which ticket 3.5b takes (split from 3.6 by the orchestrator at 08:12 on 2026-10-01); 3.5b builds beside this ticket and shares no file with it but `packages/daemon/test/defects.json`. 3.6's seam is the point in `falsification.ts` where a job is about to be sent: a refused workspace is one whose job did not run (AC6), with 3.6's reason, and it is handled as a workspace the start no longer confirms is: marked, with the call resolving true, so the next look takes the next workspace's definitions. When the gate holds no reading yet, the canary job is that call's one job, sent after the look's window is closed, and the call then resolves true so the scheduler plans again. A refusal kept in the daemon's memory ends at the workspace resolving another Vitest install or at a restart of the daemon, not at a change of the input revision, which is why a mark holds what ends its wait (orchestrator, 08:12). This ticket builds no gate.
- 3.7 (backlog) measures the two targets over its corpus; 3.8 (backlog) reads this repository's own defects through the schedule.
- No unbuilt ticket names `daemon/round-selection.ts`: `node scripts/list-unbuilt-work.mjs --except 3.5 packages/daemon/src/daemon/round-selection.ts` at 07:09 on 2026-10-01 found only 3.4c naming the `packages/daemon` area, and 3.4c edits no file under `daemon/`.

#### Current structure of the modified files

Code lines are by `grep -cv '^\s*$\|^\s*//\|^\s*/\?\*' <file>`, and records by `cat packages/daemon/test/defects.json packages/daemon/test/*/defects.json packages/cli/test/defects.json | grep -c '"file": "<path>"'`, both at fb40e5cf (06:52 on 2026-10-01), and `daemon/round-selection.ts` at 0dcf5032 (07:09), which changed no code.

- `daemon/lifecycle.ts` (498 lines, 71 records): `DaemonLifecycle` builds the `Scheduler` with `discover`, `run` and `idle` calls, each job inside `#idleAfter`; `#moment()` gives the latest results, the view and the inputs; `status()` gives the activity and `#unstored.jobs()`; `#discover` calls `#protectDiscovered`, 36 lines that read only the inputs, the stop check and their arguments.
- `daemon/scheduler.ts` (495, 48): `#step` quiesces, plans, and takes a `discover`, `wait`, `run`, `again` or `idle` step; `#plan` is synchronous and starts nothing; `#idle` waits for a change of revision or a periodic reconciliation; `discoveryInEffect` is a module function of 9 lines at its end; `#selectRound` is 43 lines that read the log, the narrowing, `#snapshot` (which it also sets) and `#runs.isHeld`, with the four entry constants `NO_SNAPSHOT_REASON`, `NO_SNAPSHOT_ENTRY`, `FIRST_ROUND_REASON` and `FIRST_ROUND_ENTRY` that only it reads.
- `daemon/round-selection.ts` (171, 15): `explainRound`, `unselectedRound`, `changedPaths`, `NO_SELECTION_CONSEQUENCE` and `RoundSelection`, which `#selectRound` calls.
- `daemon/job-endings.ts` (103, 8): `threwOutcome`, `storeBindings`, `storeFailureReason`, `UnstoredJobs`, keyed by workspace path with the discovery as undefined. This ticket leaves `UnstoredJobs` as it is.
- `daemon/discovery-history.ts` (215, 25): `DiscoveryHistory`, `DiscoveryInEffect`, `DiscoverReport`.
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

20 raw files and 26 estimated (20 times 1.3); code units 9 (eight criteria that need code, AC7 and AC9 needing none, and validation). Over 25 and under 30: a further cut between the schedule and what answers say of it would split the one list of jobs that ended with nothing stored, which the daemon keys by job kind and the summary's reason and the CLI word by job kind in the same change (orchestrator, 06:45 on 2026-10-01). Production, modified: `daemon/lifecycle.ts`, `daemon/scheduler.ts`, `daemon/job-endings.ts`, `daemon/discovery-history.ts`, `daemon/round-selection.ts`, `daemon/protocol.ts`, `query/answer.ts`, `query/summary.ts`, `packages/cli/src/answer-text.ts`. Production, created: `daemon/falsification.ts`, `daemon/falsification-plan.ts`. Tests, for create-tests: `test/scheduling-harness.ts`, `test/lifecycle.test.ts`, `test/scheduler.test.ts`, `test/query.test.ts`, `test/experiment-facts.ts`, `packages/daemon/test/defects.json`, `packages/cli/test/cli.test.ts`, `packages/cli/test/defects.json`. This ticket's file. Over 10 estimated, so dev delegates in groups over disjoint files, in this order: the three moves; the plan module, which has no I/O; the job module with the scheduler and the lifecycle; then the protocol, the two wordings and the CLI.

#### Ticket review

One review agent, ticket-internal, returned 19 edits and 9 questions at 07:05 on 2026-10-01 (findings F1 to F33, with F6 to F8 unused). Every finding was applied but these. F26's premise was wrong: a held workspace's last run is stored invalidated, so its tests hold no current pass and its definitions are not eligible (`docs/architecture.md` § Holds on self-changing workspaces and discoveries); its narrower case, a job its own write to an input outside its workspace ends, is a known limit and no rule. F33 stands on ticket 3.4's decision (design decision 12). F25 asked what keeps a mutation that never ends from holding the front of the order under frequent saves: the author decided AC4's two jobs in a row (decision 5), which the orchestrator accepted at 07:09 with the two other decisions listed under the design decisions.

#### Sanity check

The dev (threadId 728d4a9a-f78a-40de-b495-1d4ad06e14ea) sent four findings at 08:46 on 2026-10-01. F1, CONFIRMED: an answer keeps a reason's first 1,000 characters, so AC8's entry says what ends each wait before it names definitions, and AC10's end entry names each definition left without a verdict. F2, CONFIRMED: the restored baseline is a run an abort can end, with every experiment run and none interrupted, so AC5 and AC6 read "a baseline"; it falls under AC5's sentence on a reply that names none, and adds no rule. F3, CONFIRMED: one workspace can have a job that did not run and definitions left without a verdict at one revision, so AC8 gives it one entry, the workspace's part first. F4, a fork, decided by the orchestrator at 08:49: nothing of a falsification job is told to the change record (AC7, design decision 7). The orchestrator accepted F1 to F3 as exactness edits at 08:51.

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
sizing_ac_count: 9
files_to_modify:
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/scheduler.ts
  - packages/daemon/src/daemon/job-endings.ts
  - packages/daemon/src/daemon/discovery-history.ts
  - packages/daemon/src/daemon/round-selection.ts
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

Dev session: threadId b05be53e-752c-460d-9306-5942d7cd1185

#### Records Anchored In Moved Code

This change moved or reshaped the text 22 records anchor in: 20 in `packages/daemon/test/defects.json` through the make-room task, and 2 in `packages/cli/test/defects.json` through the entry wording. Counted by matching each record's `old` against its file before and after: 269 records anchor in the nine modified files, all matched once before, and these 22 match nothing in their recorded file after. Re-anchor each and prove it by id.

- Now in `packages/daemon/src/daemon/job-endings.ts`, in `protectDiscovered`, which is a function and no longer a method, so its body is indented two spaces less and reads `isStopping()` where it read `this.isStopping()`: D1879, D1988, D1989, D2081, D2083, D2090, D2159, D2163, D3327, D3328. D2163's `old` matches there as it stands.
- Now in `packages/daemon/src/daemon/discovery-history.ts`, in `discoveryInEffect`: D2658, whose `old` matches there as it stands.
- Now in `packages/daemon/src/daemon/round-selection.ts`, in `selectRound`, a function that reads `reading.isHeld(path)` where the method read `this.#runs.isHeld(path)` and returns each `unselectedRound(...)` inside an object: D2668, D2695, D3000, D3001, D3171. D3001's `old` matches there as it stands.
- Still in `packages/daemon/src/daemon/lifecycle.ts`, on the call the move reshaped (`protectDiscovered(inputs, () => this.isStopping(), discovery, verdict, startedAt)` in `#discover`): D1987.
- Still in `packages/daemon/src/daemon/scheduler.ts`, in `#explain`, on the call the move reshaped (`selectRound(revision, { ... })`, whose `now` member holds `view.inputs.snapshot?.comparedDigests`, followed by `this.#snapshot = snapshot` and `this.#selectionOwed = false`): D3107, D3243.
- In `packages/cli/test/defects.json`, still in `packages/cli/src/answer-text.ts`, in `jobText`, which now returns early for the discovery and words a workspace's job by its kind (`KIND_JOBS`) or as a run: D3175, D3183.
- No longer expressible as written: D3108, "the inputs' snapshot advances before the round's selection can throw". `selectRound` returns the snapshot to keep together with the selection, so the scheduler sets `#snapshot` only once the call has returned, and no reordering inside either file advances it before a throw. The tests session decides whether another mutation carries the same guarantee (as returning `snapshot: now` from a `selectRound` that then throws cannot) or the record goes.

#### What The Typecheck Cannot See

Every `switch` over `DaemonActivity` (`activityText` in `query/answer.ts`, the only one) and every reader of `UnstoredJob` compiles against the new shapes. These do not show as type errors:

- A test that asserts `PROTOCOL_VERSION` as the literal 5, or enumerates the activity states, still compiles and fails when run: the version is 6 and the states gain `falsifying`.
- `WorkspaceSchedule.#execution` (`daemon/workspace-schedule.ts`, not edited) reads a workspace as running by comparing `activity.state` with `"running"`. A `falsifying` activity carries a `workspacePath` too, and only that comparison keeps a falsified workspace reading idle (AC9).
- `UnstoredJobs.unlist` (`daemon/job-endings.ts`) filters by workspace path alone. It never sees a falsification entry, since those never enter `UnstoredJobs`: `status()` in the lifecycle appends `Falsification.entries()` to `#unstored.jobs()`. A test that puts a falsification entry and a run's entry for one workspace side by side is what holds that.
- `answeredJob` in `query/summary.ts` spreads the job, so `kind` reaches every answer; a rewrite that builds the entry member by member would drop it with every type satisfied, since `kind` is optional.
- A hold's jobs (`SelfChangedPath.jobs`) carry no `kind`, so `jobText` in the CLI words them as a run or the discovery; `selfChangedList` in `daemon/workspace-schedule.ts` builds them from a workspace path alone.
- The wording "the falsification of" is spelled once in `query/summary.ts` (`jobName`) and once in the CLI (`KIND_JOBS`), as "the run of" is.
- I scanned every record's `new` text for the changed symbols and shapes (28 records name one). Apart from the 22 above, each still builds a valid shape or calls a symbol that exists: none builds an `UnstoredJob` or a `DaemonActivity` the new types reject.

#### Test Files This Change Broke

- `packages/daemon/test/scheduler.test.ts`: it builds `SchedulerParts` without the new `falsify` call (`error TS2741` at its `new Scheduler` call), the one error of the `@rt-test/daemon` typecheck.

#### ACs Owed a Test

No probe and no run reached these, so a test is their only evidence. Each is built, and its code path is named.

- AC5, the time bound. The guarantee: a job not ended `JOB_TIME_BOUND_MS` after it was sent is aborted; the definition its reply names as running is marked `time-bound`, waits until the input revision or its definition digest changes and sorts last; the job's other definitions may be taken again at once; the verdicts the reply carries are stored under AC3's conditions; and a reply that names none, or no reply, is a job that did not run. Built in `#watch`, `#ending`, `#afterBound` and `runningDefinition` (`daemon/falsification.ts`) and `endedByBound` (`daemon/falsification-plan.ts`). The bound is a plain `setTimeout`, which a test can fake.
- AC6, a workspace whose job did not run or whose reply could not be stored. The guarantee: such a workspace gets no further job until the input revision changes, for each cause (a reply that read refused, unsupported, not confirmed or failed; a config no longer confirmed; an executor that ended without a usable reply; the bound ending it in a baseline; the store failing; an event naming an input at a revision that did not move), a periodic reconciliation lifts none of them, and a definition whose digest changed has had no experiment. The probes showed only its first sentence: after a job that ran to its end, no definition of it was taken again at that revision. Built in `#waits`, `#afterReturn`, `#store` and `readReply`, and `workspaceWaits`, `#mayTake` and `#forget` in the plan.
- AC8, what answers say. The probes showed the `falsifying` activity with its workspace and count, and one falsification entry for a definition left without a verdict, in `status()` and in a `defects` answer, its wait clause before its names. Still owed: a workspace's entry for each cause with its reason; one entry for a workspace of which both parts are true, the workspace's part first; the bound of 20 names with the number of the rest; an entry leaving the list when the revision moves; a run's entry and a falsification's side by side for one workspace; the CLI's text (`jobText`) and the no-answer reason (`unstoredClause`) wording the entry as the falsification of its workspace; and the protocol version.

#### Tests Owed

Each names the defect a test would catch. The first five are the adversarial review's findings fixed at 09:33 on 2026-10-01, which no probe exercises.

- An abort that found no job is recorded as what ended the job. When the bound's timer fires after the executor's reply has settled, `Executor.abort` returns false; `#watch` must then record nothing, so the complete reply is stored and its definitions read as a job that ran to its end. The defect: `asked` set whatever `abort` returns, which discards every verdict and marks the workspace as ended in a baseline.
- A `ran` reply that reads not interrupted is treated as ended by the bound. An abort the job's last run had already passed is a no-op in the child, whose reply holds every run; `#ending` must read it as returned (or as a change when the revision moved). The defect: dropping the `interrupted === false` check in `#ending`.
- A long or multi-line error ahead of the wait clause. A workspace's reason must keep what ends the wait, and the definitions' part after it, on its first line and inside the 1,000 characters an answer keeps, whatever the load error, refusal or outcome reason holds, with the whole text in the log. The defect: handing `what` to the mark uncut (`markText` in `daemon/falsification.ts`).
- A reply object of another shape. A value with no known status, or a `ran` value whose `judgements` or `experiments` is no array, must read as a job that did not run and mark the workspace. The defect: no default branch in `readReply`, so the look throws and the same job is sent again.
- A window left open by a throw. When deciding the look throws after the tracker's window was opened, the window must be closed before the throw goes on. The defect: `#begin` called outside the `try` whose `finally` closes it.
- A stop during a look (AC1, AC3): `worktreeStandings` throws on its aborted signal before it reads the moment, and the look resolves false with no window open and no job. No other test pins that guard (3.4c's review).
- A stop during a job (AC4): nothing is stored and nothing is marked.
- The job's contents (AC2): at most `MAX_JOB_DEFINITIONS`; only the first definition's workspace when two workspaces wait; a definition marked `takenLast` after every other; the confirmed config file and the declared names of the same read handed to the executor.
- What is stored (AC3): the verdicts of a job in which no run happened; nothing when an event named an input at an unmoved revision, with the workspace marked; a reply with no verdict never handed to `writeEvidence`; each verdict bound to the digest of the standing its experiment was built from.
- The streak of AC4: one input change marks none; two in a row with the same definition running mark it; any other ending of a job that held it between them clears the streak.
- After a job returns, neither the bound's timer nor the revision wait calls `abort` during a later run or job (C157; `release` in `#watch`).
- AC9: a falsified workspace's execution state reads idle (`WorkspaceSchedule` reads only the `running` activity state), a `wait` settles as with no job, and no count but a `defects` answer's moves.
- AC10: the entry for a look that took none is written once for each input revision.

### Tests Record

Tests session: threadId 106e57e6-ca1f-437b-a517-a6adb807f7fa (rt-t3-5-tests-2, which took the stage over at 13:44 on 2026-10-01 from rt-t3-5-tests, threadId 3fd43c2c-1fb8-42f9-be4b-a0b76058ec5e)

#### Named Defects

69 new records, D4045 to D4114 less D4105, which is unused. D4112 is in `packages/cli/test/defects.json`, the rest in `packages/daemon/test/defects.json`. The review's gap round added five more, D4156 to D4160, at the end of `packages/daemon/test/defects.json`.

- D4045: A falsification look that asks for another plan is followed by the idle wait, so the next falsification job never follows until an input changes. (AC1)
- D4046: A falsification look is taken while a run is due, so the run waits for a falsification job. (AC1)
- D4047: A falsification look is taken while a discovery is due, so the discovery waits for a falsification job. (AC1)
- D4048: A falsification look that asked for another plan leaves the round unmarked, so the log holds no idle entry after the job and reads as if the daemon were still falsifying. (AC1)
- D4049: A falsification job is not marked in progress on the schedule, so an answer at a later revision names a wait the scheduler is not in, where it waits for the job. (AC1, AC8)
- D4050: A definition that cannot be falsified now is given an experiment: one whose anchor is missing, or whose test holds no current pass. (AC1)
- D4051: A definition whose evidence reads current counts as waiting, so every input revision falsifies every definition again. (AC1)
- D4052: An experiment's mutation names its file as the definition spells it, relative to the consumer root, so the executor reads another file or none. (AC2)
- D4053: A falsification job is handed no assertion error names, so a consumer's declared error reads as no assertion and its detections read unclear. (AC2)
- D4054: A job holds every waiting definition of its workspace, so any input change loses the whole job's work. (AC2)
- D4055: A job holds the waiting definitions of every workspace, so one workspace's Vitest instance is asked for another workspace's tests. (AC2)
- D4056: The waiting definitions are taken in the order their files give them, so a survivor whose evidence went stale waits behind every never verified definition before it. (AC2)
- D4057: A verdict is stored bound to something other than its definition's digest, so its evidence reads stale the moment it is stored. (AC3)
- D4058: A job's verdicts are stored bound to something other than the digest of the workspace's input fingerprint its standings were read at. (AC3)
- D4059: A reply of a job in which no run happened reads as a job that did not run, so the verdicts it decided before any run are dropped. (AC3)
- D4060: A job's verdicts are stored although its window does not vouch that no input changed while it ran. (AC3)
- D4061: A workspace whose reply could not be stored for an event that named an input at an unmoved revision is not marked, so its next job begins at once and no answer says why nothing was stored. (AC6, AC8)
- D4062: A reply that carries no verdict is handed to the store, whose every evidence write makes its next read rebuild every record. (AC3)
- D4063: A job a stop ended is read as one that returned by itself, so its verdicts are stored and its definitions marked after the stop. (AC4)
- D4064: A change of the input revision while a falsification job runs does not abort it, so the discovery or run the change made due waits for the job's remaining experiments. (AC4)
- D4065: A job is aborted whenever the tracker signals, a periodic reconciliation's end with the revision unmoved included, so no job outlives the reconciliation interval. (AC4)
- D4066: The first input change that ends a job marks the definition that was running, so an agent's own new definition is left without a verdict by whichever save lands on it. (AC4)
- D4067: A definition running when an input change ended its job is never remembered as such, so a mutation that never ends holds the front of the order under an agent that keeps saving. (AC4)
- D4068: A job that ran to its end leaves a definition's run of input-change endings standing, so one later input change marks it as two in a row would. (AC4)
- D4069: The watch of a job that has returned stays armed, so the next change of the input revision aborts whatever job the executor runs then. (AC4)
- D4070: The time bound on a falsification job is another duration than 10 minutes. (AC5)
- D4071: The definition that was running when the time bound ended its job is not left behind, so a mutation that never ends is taken first again and costs the bound each time. (AC5)
- D4072: A definition a job was ended on keeps its place in the order, so it is taken before every other definition at each new input revision. (AC2, AC5)
- D4073: The verdicts carried by the reply of a job the time bound ended are dropped. (AC5)
- D4074: A job the time bound ended in its first baseline blames its first definition, which never ran, and its workspace is sent another job at once. (AC5)
- D4075: An experiment that ran with no confirming run reads as the one an abort ended, so a job ended in its restored baseline blames a definition whose runs had finished. (AC5)
- D4076: An experiment whose confirming run an abort ended is not read as the one running, so the experiment after it, which never started, is blamed. (AC5)
- D4077: An abort that found no job in progress is recorded as what ended the job, so a reply that settled as the bound fired is read as a job the bound ended. (AC5)
- D4078: A reply that ran and reads not interrupted is treated as ended by the bound whose abort reached it, so every verdict it carries is dropped and its workspace reads as ended in a baseline. (AC5)
- D4079: A definition of a job that ran to its end is not held at that revision, so one that got no verdict is given experiment after experiment with no input changed. (AC6)
- D4080: A refused job's entry does not say what refused it, so an author cannot tell which project's module cache setting to change. (AC6, AC8)
- D4081: The entry of a job refused because its Vitest instance could not be prepared leaves out why it could not. (AC6, AC8)
- D4082: The entry of a workspace whose Vitest is not supported leaves out why it is not. (AC6, AC8)
- D4083: The entry of a job that replied its config is not the one confirmed does not say so. (AC6, AC8)
- D4084: The entry of a workspace that failed to load in its job leaves out the failure. (AC6, AC8)
- D4085: The entry of a workspace whose executor ended without a reply leaves out how the executor ended. (AC6, AC8)
- D4086: A reply whose job is not an object is read as a job, so the look throws, its workspace is never marked and the same job is sent again. (AC6, AC8)
- D4087: A reply of a status no job has is read as nothing at all, so the look throws, its workspace is never marked and the same job is sent again. (AC6, AC8)
- D4088: A reply that reads ran without its lists of judgements and experiments is read as a job that ran, so the look throws on it and its workspace is never marked. (AC6, AC8)
- D4089: A workspace the confirmed start no longer holds is not marked, so no answer says why its waiting definitions are given no experiment. (AC6, AC8)
- D4090: A workspace whose verdicts the store could not write is not marked, so its next job begins at once against the same store and no answer says the verdicts were lost. (AC6, AC8)
- D4091: The entry of a workspace whose job the time bound ended with no usable reply does not name the bound. (AC6, AC8)
- D4092: What happened to a workspace is put in its mark uncut, so a long or multi-line error pushes what ends the wait off the reason's first line and past the 1,000 characters an answer keeps. (AC8)
- D4093: The log holds what happened to a workspace cut as its mark is, so the rest of a long error is nowhere. (AC8, AC10)
- D4094: A look that throws after it opened its window on the tracker leaves the window open, so the tracker goes on recording changes for a job that never began. (AC3)
- D4095: The activity is not set when a falsification job is sent, so status and every answer read the daemon idle while it falsifies. (AC8)
- D4096: The activity stays falsifying once a job has ended, so while the scheduler waits out the next quiet window every answer says a job runs that does not. (AC8)
- D4097: A falsification entry carries no kind, so beside a run's entry for the same workspace it reads as a second run that stored nothing. (AC8)
- D4098: An entry of a workspace of which both are true names its definitions before it says what happened to the workspace, so a reason cut for length loses the workspace's part. (AC8)
- D4099: An entry names every definition left without a verdict, so a workspace of thousands makes every answer carry them all. (AC8)
- D4100: An entry names its definitions before it says what ends their wait, so a reason an answer cuts for length loses what ends the wait. (AC8)
- D4101: A definition left without a verdict at an earlier input revision stays listed after the revision moved, though it may be taken again. (AC8)
- D4102: A workspace whose job did not run at an earlier input revision stays listed after the revision moved, though it gets a job again. (AC8)
- D4103: An answer builds each listed job member by member and drops its kind, so a falsification entry reads in every answer as a run that stored nothing. (AC8)
- D4104: A workspace reads running whenever the activity names it, so a workspace being falsified reads as running its tests. (AC9)
- D4106: The log's entry for a job's start leaves out the first definition's id and state. (AC10)
- D4107: The log's entry for a job's end names every definition of the job as left without a verdict, those whose verdict was stored included. (AC10)
- D4108: The worktree's standings take the daemon's moment after their signal aborted, when nobody waits for them and a stop may have closed the store. (AC1, AC3)
- D4109: A look that found definitions waiting and took none is logged at every look, so each periodic reconciliation adds the same entry again. (AC10)
- D4110: A query's no-answer reason words a falsification entry as the run of its workspace. (AC8)
- D4111: The falsifying activity's text leaves out the number of definitions in the job. (AC8)
- D4112: The CLI words a falsification entry as the run of its workspace. (AC8)
- D4113: The protocol version stays 5, so a version 5 client takes a daemon whose answers carry a falsifying activity and a job kind it does not know for its own. (AC8)
- D4114: Evidence stored under an older falsifier version is read as the current version's, so its reason, detail and facts are parsed under meanings they were not recorded with. (AC3)
- D4156: The idle entry is logged, and the idle call made, before the scheduler checks whether a round is already due, so a look that took nothing because the input revision moved during it leaves 'idle: no confirmed workspace is due' in the log while a workspace is due. (AC1; gap row 1)
- D4157: A stop that lands while a look reads the definition files is rethrown, so the scheduler logs a failed scheduling step and holds the round during the shutdown. (AC1, AC3; gap row 3)
- D4158: The entry for a look that took none counts a definition of a workspace that gets no further job among those given no further experiment, so its why names the wrong cause. (AC10; gap row 4)
- D4159: A look that took nothing leaves its window on the tracker open, so the tracker records every later change into a window no job closes. (AC3; gap row 5. D2080, D2081 and D2082 also go red on its mutation.)
- D4160: What happened to a workspace is kept so long that, in an entry of both parts, what ends its definitions' wait falls past the 1,000 characters an answer keeps. (AC8; gap row 6)

Records re-anchored, each against the text the make-room moves left, and proven again: D1879, D1988, D1989, D2081, D2083, D2090, D2159, D2163, D3327, D3328 (`daemon/job-endings.ts`, `protectDiscovered`); D2658 (`daemon/discovery-history.ts`); D2668, D2695, D3000, D3001, D3171 (`daemon/round-selection.ts`, `selectRound`); D1987 (`daemon/lifecycle.ts`); D3107, D3243 (`daemon/scheduler.ts`); D3175, D3183 (`packages/cli/src/answer-text.ts`). D3108 keeps its defect: its mutation in `daemon/scheduler.ts` advances `#snapshot` before the `selectRound` call and hands the call the earlier snapshot as `before`, so a selection that throws leaves the next plan comparing the inputs with themselves, as the old mutation did.

Stale tests updated: D2080, D2081 and D2082 in `packages/daemon/test/lifecycle.test.ts` count the tracker's job windows after a start, and now pin four where they pinned three. The fourth is the look's: the falsification task says "call 3.4c's function with a moment that opens the job's window on the tracker (`beginJob`)" and "Close the window on every path that starts no job", so a look that takes nothing opens and closes one window once nothing is due.

#### Deliberately Untested

- `packages/daemon/src/daemon/scheduler.ts` and `daemon/falsification.ts`, AC7's "nothing of a falsification job is told to the change record": the scheduler's `falsify` part returns only whether to plan again, and `falsification.ts` holds no reference to the change record, so no edit of an existing line tells the record of a job, and a test of it would need a mutation that adds code. AC7's "it ends the job as AC4 says" is D4064.
- `packages/daemon/src/daemon/falsification-plan.ts`, AC6's "a definition whose definition digest changed is one that has had no experiment": the marks are keyed by definition digest, and `#forget` also drops every mark whose digest no standing holds. Each mechanism alone gives the right answer, so every single mutation is inert and no record can prove a test of it.
- `packages/daemon/src/daemon/waits.ts`, AC9's "a `wait` settles or not as it would with no job": a wait reads the schedule's execution states and round and no activity, which D4104 and D4049 pin. In the lifecycle's stand-in daemon a wait does not settle with no job either (probed at 13:18 on 2026-10-01), so a lifecycle test of it would prove nothing. A test through `waits.test.ts`'s own rig is the review's to weigh.
- `packages/daemon/src/daemon/falsification.ts`, AC9's "no count of any answer but a `defects` answer's": D4104 asserts a job stores no run and no discovery, with no mutation of its own, since no line of the change writes either.
- `packages/daemon/src/daemon/falsification.ts`, `#begin`'s check that the revision the moment read is the planned one, and `look`'s first check: a look that went on at a moved revision would send the job the next look sends, since a definition is eligible only while its test holds a current pass, so no answer differs.
- `packages/daemon/src/daemon/falsification.ts`, the refusal for a workspace whose fingerprint cannot be computed (`NO_FINGERPRINT_REASON`): unreachable, since a definition is eligible only while its test holds a current pass, which needs that fingerprint.
- `packages/daemon/src/daemon/falsification.ts`, `release`'s `clearTimeout`: inert for AC4's claim, since `end` also checks that the watch is still on, which D4069 pins. A consumer would see nothing; the timer of a job that returned fires into a watch that is off.
- `packages/daemon/src/daemon/falsification.ts`, the end entry's wording for a job a change, the bound or a stop ended, or that did not run (`endingText`): D4107 pins the entry for a job that ran to its end. A consumer reading the log of a job ended early would see the wrong ending named; the endings themselves are pinned by what they store and mark (D4063 to D4078).
- `packages/daemon/src/daemon/falsification.ts`, a reply that reads `interrupted-before-load`: the criteria name no such cause; it marks the workspace through the same line as every other reply that did not run.
- AC2's confirmed config file: asserted in D4053, whose recorded mutation is the declared names.

#### Questions and rulings (tests stage)

- **Asked of the orchestrator (threadId 61f4cc16) at 09:58 on 2026-10-01:** 30 more defect ids, the plan coming to about 69 named defects against the 40 dispatched; or a trim of the per-cause AC6 and AC8 tests. **Decided by the orchestrator at 10:01:** D4085 to D4114 granted, and the per-cause tests stay untrimmed, since each cause's reason is its own line and is what an author reads when falsification did not run for a workspace. D2080 to D2082 sorted as stale accepted. No new test waits on a real clock.
- **Decided by the orchestrator (threadId e88c9bb1, successor) at 13:12 on 2026-10-01:** a proof selection of a few hundred records runs without a further word; more than 600 comes back as a question.
- **Reported to the orchestrator at 13:16 on 2026-10-01:** three criterion clauses under Deliberately Untested hold no proven test: AC7's change-record clause, AC6's changed-digest clause and AC9's `wait` clause. **Decided by the orchestrator (threadId e88c9bb1) at 13:45:** all three stand as recorded, and none gains a test or a code change. AC7's "nothing of a falsification job is told to the change record" has no line for a mutation to edit, so a record there would need a mutation that adds code, and its "it ends the job as AC4 says" is D4064. AC6's "a definition whose definition digest changed is one that has had no experiment" is two mechanisms giving one answer (the marks are keyed by digest, and the plan forgets every digest no standing holds), so each single mutation is inert; the orchestrator hands that fact to the review to weigh, and it is no code bug for the dev. AC9's `wait` clause rests on D4104 and D4049, which pin the execution state and the round a wait reads.
- **From the orchestrator (threadId e88c9bb1) at 14:04 on 2026-10-01, unasked:** the green report is accepted and the twelve paths are committed on wt/2 as af76a489. D4156 to D4165 are reserved for the review's gaps, and D4105 is taken back. The dev is settled, so a code bug found now goes to the review (rt-t3-5-review, threadId a8a19733-131d-42e6-b413-328827b02aa2). A gap test that seems to need a fourth queue rule in the code is a question for the orchestrator.

#### Tests stage progress

Files modified: `packages/daemon/test/defects.json`, `packages/cli/test/defects.json`, `packages/daemon/test/scheduling-harness.ts`, `packages/daemon/test/experiment-facts.ts`, `packages/daemon/test/harness.ts`, `packages/daemon/test/scheduler.test.ts`, `packages/daemon/test/lifecycle.test.ts`, `packages/daemon/test/query.test.ts`, `packages/daemon/test/protocol.test.ts`, `packages/daemon/test/store.test.ts`, `packages/cli/test/cli.test.ts`, and this ticket. No file created, no production file edited.

New infrastructure: `RecordingStore` in `scheduling-harness.ts` records each `writeEvidence` call (`evidenceWrites`), reads the evidence back, fails a write on `failingEvidence`, holds seeded evidence (`seedEvidence`) and gives each discovery its own id (`discoveryIdAt`); `DISCOVERED_VITEST_VERSION` is defined there and re-exported by `harness.ts`. `experiment-facts.ts` no longer imports `harness.ts`, takes `RanJob` from `falsify/job-readings.ts`, and no longer exports `COLLECTED` or its judgement builder. `scheduler.test.ts`'s rig takes a scripted `falsified` look, recorded in `calls` as `look@<revision>`. `lifecycle.test.ts` holds the falsification rig: `falsifying` (a consumer with definition files under a temporary directory, a `FalsifyingExecutor`, the recording store), the reply builders `replied`, `aborted` and `decidedBeforeAnyRun`, and the waits `sent`, `idled` and `afterPeriodicReconciliation`.

Gates on Windows 11, Node 24.19.0, 2026-10-01: `bun run typecheck` exit 0 at 13:22; `bun x oxlint` over the nine touched TypeScript files exit 0 with no warning at 13:22; `bun x prettier --check` over them and both catalogs exit 0 at 13:22; `node scripts/check-defects.mjs` exit 0 at 13:22, 3327 named defects; `bun x vitest run` over ten suites (the six touched and four that import the changed helpers) exit 0 at 13:25, 10 files, 1314 tests. Step 3's `vitest related` over the eleven production files ran 28 of 84 test files at 09:48: 27 passed, and the 3 reds were the stale tests above.

Wall time added: `lifecycle.test.ts` runs 241 tests in 11.9 s where it ran 183 in 2.6 s, so the 58 new tests add about 9.3 s on Windows, each writing a consumer under a temporary directory; `scheduler.test.ts` is unchanged at about 2 s.

Proof on Windows, Node 24.19.0, through the run lease, 13:27 to 13:43 on 2026-10-01: `node scripts/verify-defects.mjs --ids <the 540 ids of _agent-docs/.scratch/t3-5-tests/selection-ids.txt>` exit 0, 540 of 540 selected defects detected in 12 sandboxes, baseline green before and after. The selection, counted by `_agent-docs/.scratch/t3-5-tests/count-selection.mjs 24181192^ 24181192 --ids`: the 91 records this lane added or changed (69 new, 22 re-anchored), every record mutating one of the eleven production files the build edited (335, overlapping), and every record of `lifecycle.test.ts` and `scheduler.test.ts`, the two suites whose diff is not add-only and the only two that use `RecordingStore`. `--edited` would select 874, the extra 334 being the other records of the test files this lane only adds to (`query.test.ts`, `store.test.ts`, `protocol.test.ts`, `cli.test.ts`), which owe no re-proof. Log: `_agent-docs/.scratch/t3-5-tests/proof-windows.log`.

**Handed to a successor tests session at 13:44 on 2026-10-01, the first session at 59% of its context.** Owed, in order: (1) the same 540 ids on Linux under Node 24, by `bash _agent-docs/.scratch/t3-5-tests/linux-leg.sh proof <threadId>` from Tree 2, which writes the patch, queues through the lease and logs to `_agent-docs/.scratch/t3-5-tests/linux-proof.log` (`PROOF_EXIT_LINUX:0` and the detected count are the result); (2) U1 on Linux, by `bash _agent-docs/.scratch/t3-5-tests/linux-leg.sh u1 <threadId>`, the dev's probe over the real executor on both Vitest lines and both pools, reporting what each reply read and how long after the abort; (3) the report to the orchestrator, with the wording for `docs/testing.md` in `_agent-docs/.scratch/t3-5-tests/testing-md-wording.md`; (4) the review's gap rounds. AC5, AC6 and AC8 stay unticked until the Linux proof is read. UNVERIFIED until then: every proof and gate above on Linux.

**Linux, by the successor (rt-t3-5-tests-2), 2026-10-01.** WSL, Node 24.19.0, in the lane's own clone `~/rt-test-t3-5` at f05005d2 with the worktree's diff of `packages/` applied (`lane.patch`, SHA-256 e3537c4e, equal to the worktree's diff when the last run ended), each run launched from Windows through the run lease. Every log is under `_agent-docs/.scratch/t3-5-tests/`.

- Proof, 13:48 to 13:54: `node scripts/verify-defects.mjs --ids <the same 540 ids>` exit 0, 540 of 540 selected defects detected in 12 sandboxes, baseline green before and after; `node scripts/check-defects.mjs` exit 0 before it, 3327 named defects. Launched as `bash _agent-docs/.scratch/t3-5-tests/linux-leg.sh proof <threadId>`. Log: `linux-proof.log`. AC5, AC6 and AC8 are ticked on it and on the Windows proof.
- U1, 13:54 to 13:55, the dev's probe over the real `Executor.falsify` (`bash _agent-docs/.scratch/t3-5-tests/linux-leg.sh u1 <threadId>`, log `linux-u1.log`): CONFIRMED on Linux on both lines and both pools, as on Windows. Vitest 5.0.1 with forks: the reply read `ran` and interrupted 10.03 s after the abort, and the ordinary run that followed on the same `Executor` completed in 0.42 s. Vitest 5.0.1 with threads: 10.03 s, then 0.45 s. Vitest 4.1.11 with forks: 10.14 s, then 0.44 s. Vitest 4.1.11 with threads: 10.03 s, then 0.44 s. Each reply held the baseline and no restored baseline; the first experiment ran with its confirming run and was judged no verdict (`restored-baseline-unrecorded`); the looping experiment and the one after it read not run and interrupted, so the first interrupted experiment is the looping one, as AC5 reads the reply. The lane's own tests of a job an abort or the bound ends (D4064 to D4078, D4091) use a scripted executor, so they pass on Linux inside the proof and say nothing of U1; the probe is its only evidence.
- The dev's acceptance probe (`_agent-docs/.scratch/t3-5-dev/e2e-probe.mjs`, the real `DaemonLifecycle` over real executors in one process), 13:59 to 14:01, exit 0 in each of its four cases, log `linux-e2e.log`. Plain, Vitest 5.0.1 and 4.1.11: one job of the 2 eligible definitions stored 1 detected and 1 survived, both read current with verified 1 of eligible 2, the activity read `falsifying` with the workspace and 2 definitions, and after an edit the run went first and a second job took the survived definition first. Loop, both lines: an edit during each of two jobs ended the job with nothing stored (14.0 s from its start, the last 10 s the force-stop grace) and the ordinary run next; after the second, `P0-loop` was listed in one falsification entry as `repeated-input-change`, the third job took the other two and stored both, and the log named once the look that took none. Each matches the Windows reports in the Completion Notes.
- Suites: the proof's baseline ran the ten test files that hold a selected record (`lifecycle`, `scheduler`, `query`, `protocol`, `store`, `daemon`, `server` and `edit-corpus` in the daemon, `cli` and `wait-command` in the CLI). The five other suites that import `scheduling-harness.ts` or `experiment-facts.ts` (`changes.test.ts`, `waits.test.ts`, `windows-job.test.ts`, `defects/definitions.test.ts`, `falsify/verdict.test.ts`) ran by name at 13:58 on Linux and at 13:58 on Windows: exit 0 each, 5 files, 201 tests. Logs: `linux-suites.log`, `windows-suites.log`. The Windows run of 13:25 named ten suites and its log does not say which four of these it held, so this run makes the set exact.
- Static gates on Linux at 13:58: `bun run typecheck` exit 0; `bun x oxlint` over the nine touched TypeScript files exit 0, 0 warnings and 0 errors; `bun x prettier --check` over them and both catalogs exit 0. Log: `linux-static.log`.
- Wall time added on Linux, one run of each suite with the JSON reporter at 13:58 (`linux-time.log`, split by `sum-times.mjs`): `lifecycle.test.ts` runs 241 tests in 1.6 s, the 58 new ones in 0.81 s and the 183 others in 0.78 s; `scheduler.test.ts` runs 184 tests in 0.11 s, its 5 new ones in 2 ms. So the new tests add about 0.8 s on Linux, against about 9.3 s on Windows.

UNVERIFIED: none. Every proof, gate and suite of this stage, U1's probe and the dev's acceptance probe ran on Windows and on Linux under Node 24. Not run by this stage on either platform: `bun run check`, which is the orchestrator's over the merged tree.

**The review's gap round, 14:25 to 15:08 on 2026-10-01**, over HEAD 7d380642 with the review's three production fixes on disk (`daemon/scheduler.ts`, `query/answer.ts`, `daemon/falsification-plan.ts`). Files modified: `packages/daemon/test/scheduler.test.ts`, `packages/daemon/test/query.test.ts`, `packages/daemon/test/lifecycle.test.ts`, `packages/daemon/test/defects.json`, and this ticket. No file created, no production file edited by this stage.

- Row 1: D4156 in `scheduler.test.ts`. A scripted look moves the revision with an edit to `a` and resolves false; the calls read `look@1`, `run:a@2`, `look@2`, `idle`, with one idle entry in the log. Its mutation is the code the review replaced.
- Row 2: D4111 in `query.test.ts` pins `falsifying workspace <path>, with 2 of its defect definitions in the job`, and its record is re-anchored on the new line, with the same defect and the same mutation (the count dropped).
- Row 3: D4157 in `lifecycle.test.ts`. The stand-in inputs hold the look's own wait for the inputs (`heldSettleIf`, armed once the daemon has idled, true only while the round reads planned at the revision the test moves to, since the scheduler's own wait comes while that round is pending). The test registers the stop behind the held wait, so the stop lands once the look has begun its read, and asserts that the wait was held and that no scheduling step was logged as failed. A rethrown stop does not hang the shutdown, so the mutation fails the assertion and no timeout.
- Row 4: D4158 pins the whole entry over two workspaces, one whose job failed to load (2 definitions) and one whose definition got no verdict (1): `waiting 3, of which in a workspace that gets no further falsification job until the input revision changes 2, and given no further experiment at this revision 1`. D4109 is unchanged.
- Row 5: D4159 has its own record: after a job that stored its verdict and a look that found nothing waiting, the tracker reads five windows begun and five ended.
- Row 6: D4160 reads an entry of both parts through `summary()`: 25 definitions left without a verdict by a first job and a second job that failed to load with a 3,000 character error. The answer's cut reason still holds what ends the workspace's wait and what ends the definitions'.
- The review's notes: `Rig.looks` is removed from `scheduler.test.ts`; D4089's title and fragment now both say "the confirmed start does not hold the workspace"; the wording for `docs/testing.md` says D4113 is rewritten at each raise. Not taken: `FalsifyingExecutor.abort` answering false when no job is held. No test observes the difference, since the watch asks only while its job is in flight, and a stand-in that tracked held falsification jobs would answer false during a run, where the real executor answers true.
- **Found by the round's first proof: a wait that returned at its bound let a test pass unseen.** The Windows proof of 14:36 to 14:44 detected 575 of 576: D4062's test passed under its mutation (`gap-proof-windows-1.log`), where the Linux proof of the same tree and the Windows proof of 13:27 detected it. `idled` returned after 3 s whether or not the daemon had got there, and D4062 asserted only that nothing was written, which is also what a daemon that has not yet run its job reads. The fix is in the tests: `reached`, `sent`, `idled` and `afterPeriodicReconciliation` resolve with whether they were reached, the bound is 15 s (the suite's timeout is 120 s and no test chains more than four waits), and the seven tests whose expected value a daemon that did nothing would also give assert that answer: D4051, D4060, D4062, D4063, D4065, D4069 and D4079. No code bug: the mutation is observable and was detected in every other proof.

Gates of the gap round on the final tree. Windows 11, Node 24.19.0: `bun x vitest run` over the three suites exit 0 at 14:57, 3 files, 576 tests; `bun run --filter @rt-test/daemon typecheck` exit 0, `bun x oxlint` over the three test files exit 0 with no warning and `bun x prettier --check` over them and the catalog exit 0, all at 14:56; `node scripts/check-defects.mjs` exit 0 at 14:57, 3332 named defects. Linux, Node 24.19.0, at 15:08: the same typecheck, lint and format check exit 0 each, and `check-defects` exit 0 with 3332.

Proofs of the gap round, through the run lease, over the worktree's diff of `packages/` (SHA-256 f1c16265, equal to the tree when the last run ended): `node scripts/verify-defects.mjs --ids <the 576 ids of _agent-docs/.scratch/t3-5-tests/gap-ids.txt>`, which are every record whose test is in `scheduler.test.ts` (185), `query.test.ts` (146) or `lifecycle.test.ts` (245), since each file's diff changes existing lines and the waits are a shared helper. Windows, 14:57 to 15:05: exit 0, 576 of 576 detected in 12 sandboxes, baseline green before and after (`gap-proof-windows.log`). Linux, 15:05 to 15:08: exit 0, 576 of 576 detected in 12 sandboxes, baseline green before and after (`gap-proof-linux.log`). Launched together as `bash _agent-docs/.scratch/t3-5-tests/gap-proofs.sh <threadId>`.

Ids: D4156 to D4160 used; D4161 to D4165 unused and still reserved until the review closes.

UNVERIFIED after the gap round: none on either platform. The records that mutate the three files the review edited and whose tests live outside these three suites are the review's to prove, as its dispatch says.

### Review Record

Review session: threadId a8a19733-131d-42e6-b413-328827b02aa2 (rt-t3-5-review)

Reviewed on 2026-10-01 from 14:04: `git diff cdffd3e4 7d380642` (the build 24181192, the docs commit f05005d2, the tests af76a489) and the doc lines of the authoring commit 2f3a3534. One checklist pass by the review session over the eleven production files against the ticket's rule contract, and four fresh-eyes agents: the two new modules with the lifecycle and its tests, the scheduler with the two files that took its moves, the protocol and the two daemon wordings with their tests, and the CLI. No doc agent and no assumptions agent ran: the doc batch is four changed lines, checked by the review session, and U1 is the only assumption, ruled on its observation on Windows and on Linux.

#### What the review confirmed

- **No evidence is stored when an input moved while its job ran.** `#store` in `daemon/falsification.ts` is the only evidence write. It is gated on the verdict of the window `look` opens on the tracker in the same tick `worktreeStandings` reads the moment, which that function reads once, after its last await. An input event not yet read when the window opens makes the tracker's view unavailable (`unavailableReason` in `inputs/current-inputs.ts`), so the mark reads unsettled and nothing is stored, and no test holds a current pass, so no definition is eligible.
- **AC9's `wait` clause holds by the code.** `WorkspaceSchedule.round` answers a query at the job's own revision from the plan in effect, with nothing due, and reads pending on the job in progress only at a later revision.
- **The three moves kept their behavior.** `selectRound` now leaves the scheduler's snapshot unset when a log entry or `isHeld` throws inside it, where the method set it first: the direction D3108 asks for. Every re-anchored record matches once and names the same defect.
- Every recorded mutation D4045 to D4114 was traced against its test by the fresh-eyes agents, and each test fails by its assertion under its mutation.

#### Findings fixed

- **`daemon/scheduler.ts`, `#idle` (C160; daemon-state; reach unknown; MEDIUM).** The look stands between the plan that found nothing due and the idle entry that plan vouched for. A look that took nothing because the input revision moved, a periodic reconciliation ended or a stop arrived during it was followed by "idle: no confirmed workspace is due" and the idle call, though a round was due. `#idle` now evaluates its wake condition first and logs only when it has something to wait for. No record anchored in its body.
- **`query/answer.ts`, `activityText` (consumer, cosmetic; LOW).** "falsifying workspace a, defect definitions in the job 2" read as a job numbered 2 to two readers. It now reads "falsifying workspace a, with 2 of its defect definitions in the job". D4111 asserts the old text and its record anchors the old line: row 2 below.
- **`daemon/falsification-plan.ts`, `#noneTaken` (daemon-state, log; LOW).** The third count was labelled "given an experiment at this revision", false of a definition held as `repeated-input-change`, which ran at the revision before. It now reads "given no further experiment at this revision". No record anchored in the line.
- **This ticket's File List** omitted `docs/requirements.md`; added.

#### What the lane asked the review to weigh

- **Heading "Ended with nothing stored" over a falsification entry (candidate 1, the dev's F4): keep.** AC8 puts the entries in that list by name, design decision 8 adds no answer member, and each entry's own text says what was left. Three fresh-eyes readers raised it again. A rewording, if ever wanted, belongs to ticket 3.4b, which rewrites both `packages/cli/src/answer-text.ts` and `query/summary.ts`.
- **`wasInterrupted` twice (candidate 2, F7): not here.** The two functions are the same four lines, under C13's threshold. Sharing one from `falsify/experiment-record.ts` edits three files and owes the proof of 72 records (37, 19 and 16) on two platforms. It folds into the next ticket that edits `falsify/falsify-workspace.ts`, which at 474 of 500 lines must extract first.
- **`INTERRUPTED_BEFORE_SEND_REASON` (candidate 3, F9): leave, with no ticket.** For a falsification job the text reaches no answer and no log line: a job a change ended logs its ending through `endingText` and never its outcome's reason, and the bound cannot fall before a send.
- **The two mechanisms behind AC6's changed-digest clause: both are wanted.** The marks' key, the definition digest, is what makes the clause true. `#forget` bounds the marks over a daemon's life and drops the entry of a changed or deleted definition at the next look (AC8). They are not two spellings of one answer: `#forget` also drops the mark of a definition whose standing carries no digest at one look, the known limit below.

#### Known limits the review adds

- **A periodic retry waits behind a running job.** A reconciliation's end does not abort a job (D4065), and retries are armed only at a plan, so the retry of a run that failed or crashed with no input change waits for the job in progress: about 2 minutes at Fleet Cooling's size, the time bound at most.
- **A job the time bound ends stores nothing of the experiments that ran.** Its reply has no restored baseline, so each such experiment is judged no verdict. A workspace whose 25 experiments outlast the bound therefore stores no verdict of a run at all, and each job marks whichever definition was running. Fleet Cooling's scoped runs of 2.3 to 3.2 s are far inside the bound; ticket 3.7 measures it.
- **A definition whose standing carries no digest at one look loses its place at the end of the order.** `digestSubject` (`defects/defect-standings.ts`) gives none while the definition's test is unresolved, as when its module fails to collect mid-edit, and `#forget` then drops its mark. A mutation that never ends is taken first again and costs one more time bound. Fleet Cooling meets it only when the looping definition's own test module is broken at a look. No verdict is ever wrong. **Asked of the orchestrator at 14:25 on 2026-10-01**, as more handling in one of the three rules, with the alternatives: (a) record it as a known limit, (b) drop a mark only when its id is gone or carries another digest, (c) keep `takenLast` apart from the marks `#forget` clears; the review recommended (a). **Decided by the orchestrator (threadId e88c9bb1) at 14:26: (a) stands**, with neither (b) nor (c), on the owner's words of 06:29 ("i don't mind letting you make design decisions, I just want to avoid the over engineering branch that happened earlier"). AC2's "in this daemon's life" is not literally true of that case, so the architecture's known limits say so.

**Decided by the orchestrator at 14:26 on 2026-10-01, on the review's interim note:** the review's three code fixes are accepted in scope, the first closing a debt item the orchestrator carried for the next ticket to edit `daemon/scheduler.ts`; and the review's answers on the three change-request candidates and on the two mechanisms are accepted as recorded above.

#### Decided, no fix

- A look that throws holds the round (two agents). The falsification task asks for it ("any other throw goes on to the scheduler's step as a discovery's does"), the orchestrator declined handling at 09:47, and the definition reads throw only on their aborted signal.
- A reply of a known status without its members, a `ran` reply whose lists hold a non-object, and a reply naming a definition its job does not hold: only a forged reply (ruled at 09:47).
- A job that returned by itself, not interrupted, after the input revision moved is read as ended by a change (`#ending`). No test pins that line, and none can show a consequence: the tracker's window refuses the store (D4060), and `ranToEnd` would mark at a revision that has passed. The stand-in inputs vouch for a window across `moveRevision()`, so a test of it would prove the stand-in.
- Verdicts decided before any run are dropped when the bound ends a job in a baseline: AC5's last sentence reads that reply as a job that did not run, and they are decided again at the next revision.
- The end entry names a left definition by its judgement's reason where the status entry names it `time-bound` or `repeated-input-change`; the log's ending says which mark applies.
- Each look reads every definition file (design decision 9, measured by 3.7). `protectDiscovered` in `daemon/job-endings.ts` and `selectRound`'s reading are the shapes the make-room task prescribes.
- The answer's separator between jobs is also the separator between an entry's two parts, and an unknown job kind would read "undefined" in the CLI and as a run in the daemon: an entry of both parts is rare, and a client refuses a daemon of another protocol version.
- AC7 cites FR8 while FR8's marker no longer lists this ticket: a marker says where a requirement's work is planned, and this ticket changes none of FR8's behavior.

#### Tech debt, undisposed

- **The job's name is spelled once per package.** `jobName` in `packages/daemon/src/query/summary.ts` and `jobText` with `KIND_JOBS`, `RUN_JOB` and `DISCOVERY_JOB` in `packages/cli/src/answer-text.ts` each map an entry to "the discovery", "the run of" or "the falsification of", while `activityText` and `roundText` are shared through `@rt-test/daemon/client`. D4110 and D4112 each pin their own copy and nothing pins that they agree; the daemon's ternary words any other kind as a run where the CLI's keyed record fails the typecheck. One exported function taking the path's formatter serves both.
- **`markText` in `packages/daemon/src/daemon/falsification.ts` cuts by code point and appends `omittedText`, as `cutReason` with `answeredJob` in `packages/daemon/src/query/summary.ts` does with another bound.** Nothing ties its 400 characters to the 1,000 an answer keeps, and `daemon/falsification-plan.ts` declares a `REASON_SEPARATOR` beside the one of another value in `query/summary.ts`. Ticket 3.4b extracts `cutReason`.
- **`wasInterrupted`** in `packages/daemon/src/daemon/falsification.ts` and in `packages/daemon/src/falsify/falsify-workspace.ts`, as above.
- **Two test stand-ins are more lenient than what they stand for.** `StandInInputs.moveRevision()` in `packages/daemon/test/scheduling-harness.ts` records nothing in the open windows, and `endJob` answers fingerprinted unless scripted, so no lifecycle test can show the window refusing a job across a moved revision. `RecordingStore.writeEvidence` in the same file stores a reply the real store refuses (a verdict with no definition digest handed in).
- **No CLI test asserts the heading above the list of jobs that stored nothing, or the first-line cut of a reason in it** (`contextLines` in `packages/cli/src/answer-text.ts`): D4112 keeps only the lines that name a workspace. Older than this change.
- **`#quietWindow`'s comment in `packages/daemon/src/daemon/scheduler.ts` says the window is timed from the revision's last change;** it is timed from when the scheduler next reads the revision, so after a job a change ended the next round starts one abort latency and a full window after the change. Older than this change.
- **`INTERRUPTED_BEFORE_SEND_REASON`** in `packages/daemon/src/daemon/executor.ts`, as above.

#### Notes for the tests session, no row

- `Rig.looks` in `packages/daemon/test/scheduler.test.ts` is exposed and read by no test.
- `FalsifyingExecutor.abort` in `packages/daemon/test/lifecycle.test.ts` answers that it found a job when none is held, where the real executor answers false once the reply has settled.
- D4089's title says the entry "says its config is not confirmed" and asserts the fragment "confirmed".
- D4113 pins the literal 6, where `docs/testing.md` says the protocol-version tests read `PROTOCOL_VERSION` so that a raise edits no test; say in the wording for `docs/testing.md` that this one is rewritten at each raise.

#### Test Coverage Gaps

Written at 14:24 on 2026-10-01 against the tree with the review's three fixes on disk. `bun x vitest run` over `scheduler.test.ts`, `query.test.ts` and `lifecycle.test.ts` then ran 571 tests, 570 passed, D4111 failed (row 2); `node scripts/check-defects.mjs` stops on D4111's anchor.

1. `packages/daemon/src/daemon/scheduler.ts`, `#idle` (MEDIUM, daemon-state). Defect: "The idle entry is logged, and the idle call made, before the scheduler checks whether a round is already due, so a look that took nothing because the input revision moved during it leaves 'idle: no confirmed workspace is due' in the log while a workspace is due." Expected test: in `scheduler.test.ts`, a scripted look during which the revision moves and which resolves false is followed by no idle entry and no `idle` call before the round at the new revision is planned. D4049's scenario produces it and asserts nothing of it. The mutation is the code the review replaced: the `#dirty` block above the loop.
2. `packages/daemon/src/query/answer.ts`, `activityText` (LOW, consumer). Behavior the review changed on purpose: the text now reads `falsifying workspace <path>, with <n> of its defect definitions in the job`. D4111 in `query.test.ts` asserts the old text and is red, and its record's `old` no longer matches. Pin the new text, re-anchor D4111 and prove it.
3. `packages/daemon/src/daemon/falsification.ts`, `look`'s catch (LOW, internal). Defect: "A stop that lands while a look reads the definition files is rethrown, so the scheduler logs a failed scheduling step and holds the round during the shutdown." The Dev Handoff's Tests Owed asked for it ("the look resolves false with no window open and no job"); D4108 pins that the read throws, not that the look takes it for a look that took nothing. The mutation: drop `if (stopSignal.aborted) return false;`.
4. `packages/daemon/src/daemon/falsification-plan.ts`, `#noneTaken` (LOW, daemon-state). Defect: "The entry for a look that took none counts a definition of a workspace that gets no further job among those given no further experiment, so its why names the wrong cause." D4109 asserts the entry's lead and its revision alone, and AC10 asks for the why. Expected test: the whole entry, for a look with definitions waiting in a workspace that gets no further job and one definition held at the revision.
5. `packages/daemon/src/daemon/falsification.ts`, `look`'s `finally` (LOW, daemon-state). Defect: "A look that took nothing leaves its window on the tracker open, so the tracker records every later change into a window no job closes." D2080, D2081 and D2082 already go red on it, by the windows they count after a start; it has no named test of its own. The mutation: close the window only when the look resolved true.
6. `packages/daemon/src/daemon/falsification.ts`, `MAX_HAPPENED_CHARACTERS` (LOW, consumer). Defect: "What happened to a workspace is kept so long that, in an entry of both parts, what ends its definitions' wait falls past the 1,000 characters an answer keeps." D4092 holds a workspace-only entry, so raising the bound to 750 leaves it green. Expected test: D4092's assertion over an entry of both parts, read through an answer.

**All six rows are closed** by the tests session's reply of 15:09 on 2026-10-01, none refuted: row 1 by D4156, row 2 by D4111 re-anchored, row 3 by D4157, row 4 by D4158, row 5 by D4159, row 6 by D4160. Its detail is in the Tests Record.

#### Validation of the fix round

On the final tree: `wt/2` at 7d380642 with the uncommitted diff of `packages/` whose SHA-256 begins f1c16265, the same before and after every run below, and the one the tests session's gap proof measured. Windows 11 and WSL, Node 24.19.0, 2026-10-01. Logs are under `_agent-docs/.scratch/t3-5-review/`.

- Size and lint, 15:11: `bun x oxlint` over the three fixed files and the three edited test files, exit 0, no diagnostic. Code lines: `daemon/scheduler.ts` 445, `query/answer.ts` 494, `daemon/falsification-plan.ts` 254.
- Typecheck, 15:11: `bun run --filter @rt-test/daemon typecheck` exit 0 and `bun run --filter rt-test typecheck` exit 0, each a workspace compile.
- `node scripts/check-defects.mjs`, 15:11: exit 0, 3332 named defects. `node scripts/check-line-citations.mjs`: exit 0, clean over 6 changed files.
- The suite, scoped from the fix round by `bun x vitest related` over the three fixed files, through the run lease. Windows, 15:11 to 15:16: exit 0, 27 of the repository's 166 test files, 1894 tests passed. Linux, from 15:27: exit 0, 27 test files, 1894 tests passed.
- Named defects. The selection is 75 records: every record whose mutated file is `daemon/scheduler.ts` (48), `query/answer.ts` (5) or `daemon/falsification-plan.ts` (19), and the six the tests session added or re-anchored. The tests session's gap proof of 576 ids, on this tree, holds 71 of them: Windows 14:57 to 15:05 and Linux 15:05 to 15:08, 576 of 576 detected on each. The review proved the other four, whose tests are in other suites, with `node scripts/verify-defects.mjs --ids D2692,D3467,D2605,D2606` through the lease: Windows 15:16 to 15:27, exit 0, 4 of 4 detected in 4 sandboxes, baseline green before and after; Linux 15:27 to 15:33, exit 0, 4 of 4 detected in 4 sandboxes, baseline green before and after.
- The Linux log (`linux.log`) holds the suite and the proof and lost the lines before them: the clone's diff hash and `check-defects`' own exit. The verifier loads the same catalog and counted 3332 defects there, which only the patched catalog holds, and the tests session ran `check-defects` on Linux on this tree at 15:08, exit 0.
- `node scripts/check-sprint-keys.mjs` and `node scripts/check-requirement-markers.mjs`, 15:34: exit 0 each.

UNVERIFIED: none on either platform for the review's gates. Not run by the review: `bun run check` over the merged tree, which is the orchestrator's.

### Completion Notes

#### Questions and rulings

- **Asked of the orchestrator at 08:46 on 2026-10-01, from the Step 4 sanity check (finding F4).** AC7 as written counts every change the tracker records while a falsification job runs as the daemon's own unless a `changes` request names its file. Since jobs run whenever nothing ordinary is due, a change the hook does not report (a person's save, a formatter, an agent without the hook) to the same file three times in a row would hold its workspace, traced through `ChangeRecord.jobEnded` and `RunHistory.#nextCount`, and the hold would lift only at a change landing between two jobs. Options: (a) AC7 as written plus a known limit; (b) tell the change record nothing of a falsification job. Dev recommended (b).
- **Decided by the orchestrator at 08:49 on 2026-10-01: option (b).** A falsification job is not told to the change record at all, its begin or any ending, so a change the tracker records while one runs is an edit, as in idle time. The job's own window on the tracker (`beginJob`, AC3) stays, since it decides what is stored. The `daemon/run-history.ts` task and that file leave the ticket (20 raw files). FR8 reads "the daemon's own runs and discoveries" again. Known limit in its place: a workspace whose tests write another workspace's inputs loops a job and a run, at lowest priority; Fleet Cooling's tests write only under `os.tmpdir()`. The author rewrites the ticket's text; the build follows the ruling.
- **Reported to the orchestrator at 09:42 on 2026-10-01, with the transition to `review`, as known limits and no question:** the review's F2b (a look that coincides with an input event not yet read takes nothing, and the next comes up to 5 minutes later) and a forged reply of a known status without its members (the look throws and the round reads held until the next input event).
- **Decided by the orchestrator at 09:47 on 2026-10-01:** both stand as recorded, and each declines handling. The three change-request candidates go to the review with its dispatch, and the docs text stays in Tree 2's scratch until the docs step.

#### Dev progress at the handoff, 09:28 on 2026-10-01

Written by rt-t3-5-dev (threadId 728d4a9a-f78a-40de-b495-1d4ad06e14ea), which passed 60% of its context and handed the build to a successor at Step 7 of `dev-ticket`, after the adversarial review returned and before its findings were fixed.

**Built, on disk, uncommitted.** Every implementation task is done: the three moves, `daemon/falsification-plan.ts`, `daemon/falsification.ts`, the scheduler's call, the protocol with the activity and the two wordings, the lifecycle's wiring, and the consumer check. The task for `daemon/run-history.ts` was dropped by the 08:49 ruling. Two tasks remain open: the docs text for the orchestrator, and "Lint and typecheck" (the Step 7 gates).

**How it is built, where the ticket leaves a choice.**

- `Falsification.look(plannedRevision)` is the scheduler's call (`SchedulerParts.falsify`), taken in `#step` when a plan is idle, inside `#schedule.during`. `FalsificationPlan` holds the marks and has no I/O. The lifecycle builds `Falsification` from its own parts spread whole, with its stop signal, its moment and an activity setter, and `status()` appends `Falsification.entries()` to `#unstored.jobs()`.
- A definition is marked at a revision only when it is not to be taken again there: every definition of a job that ran to its end, the one the time bound ended, and the one two input changes in a row ended. After a job the time bound ended, the other definitions get no mark, verdict or not, so they may be taken again (AC5, AC6).
- An entry lists only definitions that wait: those marked at the current revision that got no verdict. A definition's reason is its judgement's reason, or `time-bound`, or `repeated-input-change`.
- What ended a job is `stop`, `change`, `bound` or `returned`: the stop signal first, then what the watch asked first, then whether the revision moved. A job that returned by itself while the revision moved is read as ended by a change, since its window holds the change.
- A reply that is not fingerprinted at an unmoved revision, and a store failure, mark the workspace; a job that ran to its end also marks its definitions, so an entry can hold both parts (sanity finding F3).
- The log names a definition left without a verdict by its judgement's reason, or `verdict-not-stored` when it had a verdict that was not stored, or `job-did-not-run` when the job left no reply that ran.
- `JOB_TIME_BOUND_MS` and `MAX_JOB_DEFINITIONS` are exported constants; the bound is a plain `setTimeout`, which a test can fake as `test/input-tracker.test.ts` fakes the reconcile interval.

**Gates, as the tree stood at 09:12, before any fix from the review.**

- `bun run --filter @rt-test/daemon typecheck`: exit 1, one error, in `test/scheduler.test.ts` (listed under the Dev Handoff). No error in `src/`.
- `bun run --filter rt-test typecheck` (the CLI): exit 0.
- `bun x oxlint` over the 11 changed production files: exit 0, no warning.
- `bun x prettier --check` over the same files: exit 0 at 09:04; every later edit went through the Edit tool.
- Code lines: `daemon/lifecycle.ts` 482, `daemon/scheduler.ts` 445, `daemon/falsification.ts` about 414, `daemon/falsification-plan.ts` about 255, `query/answer.ts` 494, `packages/cli/src/answer-text.ts` 494, `query/summary.ts` 366, `daemon/round-selection.ts` 230, `daemon/discovery-history.ts` 231, `daemon/job-endings.ts` 143, `daemon/protocol.ts` 266.

**Acceptance evidence gathered, with no test.** A scratch probe (`_agent-docs/.scratch/t3-5-dev/e2e-probe.mjs`, run as `node --conditions=development --import file:///C:/source/rt-test-wt/wt-2/packages/daemon/src/daemon/source-hooks.ts _agent-docs/.scratch/t3-5-dev/e2e-probe.mjs <vitest|vitest-4> <plain|loop>`) builds the real `DaemonLifecycle` in its own process, with a real tracker, store and executors, over a throwaway project of four or five definitions, and stops it at the end. Its four reports are beside it (`e2e-v5.log`, `e2e-v5-loop.log`, `e2e-v4-plain.log`, `e2e-v4-loop.log`), and `show-e2e.mjs` prints one condensed. Windows 11, Node 24.19.0, between 09:06 and 09:11, the last two after the wording edits.

- Plain, Vitest 5.0.1 and 4.1.11: after the ordinary run the daemon started one job of the 2 eligible definitions (the invalid one and the anchor-missing one got no experiment), stored 1 detected and 1 survived, and a `defects` answer read both with evidence freshness current, verified 1 of eligible 2. The activity read `falsifying` with the workspace and 2 definitions, then idle. After an edit to an input the run went first, then a second job took the survived definition first and both read current again. No entry was listed. This is evidence for AC1, AC2's order and experiments, AC3, AC8's activity, AC9's idle workspace, and AC10's start and end entries.
- Loop, both lines: with a definition whose mutation never ends first in the order, an edit during each of two jobs ended the job 10.0 to 10.1 s later with nothing stored and the ordinary run next; after the second, the looping definition was listed in one falsification entry (`repeated-input-change`), in `status()` and in a `defects` answer, the third job took the other two and stored both, and the log named once the look that took none. This is evidence for AC4, AC6's mark, AC8's entry and AC10's entries.
- Not exercised by any probe: the 10 minute bound (AC5), a workspace whose job did not run (AC6), a reply that could not be stored, a stop during a look or a job, and the text of a query's no-answer reason.

**The adversarial review (Step 7.4) returned 9 findings at 09:27**, after these gates. What became of each is under the next heading.

#### Dev completion, 09:41 on 2026-10-01

Written by rt-t3-5-dev-2 (threadId b05be53e-752c-460d-9306-5942d7cd1185), the successor, which took the build from Step 7.4 to the transition to `review`.

**The adversarial review's 9 findings** (one read-only sub-agent over the 11 changed production files; the findings and the triage are in `_agent-docs/.scratch/t3-5-dev/adversarial-review.md`). Four fixed in `daemon/falsification.ts` at 09:33:

- F1 (HIGH). `#watch` records what it asked only when `Executor.abort` returns true, and `#ending` reads a `ran` reply that is not interrupted as a job no abort ended. Before, a job whose reply settled as the bound fired, or whose last run had finished when the abort reached it, lost every verdict and left its workspace marked as ended in a baseline. `interrupted` is a recorded fact of the reply, so the ending is still decided from what this module asked and never from reason text.
- F3. `#waits` brings what happened to one line and cuts it by code point to `MAX_HAPPENED_CHARACTERS` (400) where the mark is made (`markText`), with the count of what it left out, and logs the whole text. The fixed clauses after it come to 284 characters, so what ends each wait and the lead of the definitions' part end by character 684 of the 1,000 an answer keeps.
- F5. `readReply` has a default branch, and reads a `ran` reply as one only when its `judgements` and `experiments` are arrays; either reads as a reply that held no job.
- F6. `look` closes the tracker's window in a `finally` whenever `#begin` sent no job, a throw included.

Decided, no fix: F2a (the ticket's Known limits hold it) and F8 (the Reuse list names `namedList` for this bound). F2b is a known limit below. F4, F7 and F9 are candidates below.

**Gates on the final tree**, Windows 11, Node 24.19.0, 2026-10-01:

- `bun x oxlint` over the 11 changed production files: exit 0, no diagnostic, 09:33.
- `bun run --filter @rt-test/daemon typecheck`: exit 1 on exactly one error, `test/scheduler.test.ts` (TS2741, the missing `falsify` member, listed under the Dev Handoff), none in `src/`, 09:33.
- `bun run --filter rt-test typecheck` (the CLI): exit 0, 09:33.
- `bun x prettier --check` over the same 11 files: exit 0, 09:40.
- The acceptance probe on Vitest 5.0.1, both scenarios, exit 0 each, 09:34 to 09:35: the plain one stored 1 detected and 1 survived, read both current, and after an edit ran the ordinary run first and then a second job that read both current again; the loop one ended each of two jobs 10.1 s after an edit with nothing stored, listed `P0-loop` as `repeated-input-change` in one falsification entry, and the third job stored the other two. Reports: `e2e-v5-plain-postfix.log` and `e2e-v5-loop-postfix.log` beside the probe.
- The literal check over the 11 files: nothing to name. The fix round's own values are named (`MAX_HAPPENED_CHARACTERS`, `LINE_BREAKS`, `LINE_JOIN`).
- `node scripts/check-line-citations.mjs`: exit 0, clean over 9 changed tracked files, 09:36.
- No test was written or run, and no named defect was added: `create-tests` owns both. The repo-wide `bun run check` is the orchestrator's.
- Code lines: `daemon/falsification.ts` 439, `daemon/falsification-plan.ts` 254; the other nine as listed above.

**Acceptance criteria.** AC1 to AC4, AC7, AC9 and AC10 are ticked on the probes above and on these traces: the look is taken only where a plan is idle, inside `#schedule.during`, after the scheduler's `firstReconciled` and its quiesce (AC1); `FalsificationPlan.next` orders, filters to the first definition's workspace and slices to the bound, and `#send` hands the confirmed config file and the read's declared names (AC2); `#store` writes once, only on a fingerprinted window, and a stop or a change stores nothing (AC3); the two new files name nothing of the change record, by `rg` for its names (AC7); the store is typed to `writeEvidence` alone, and only `WorkspaceSchedule` reads a workspace as running, by the `running` activity state (AC9). AC5, AC6 and AC8 stay open under `#### ACs Owed a Test`, and the clauses of the ticked ones that no probe reached are under `#### Tests Owed`.

**Known limits to carry**, each beside those in the Dev Notes:

- From U1: a job on a mutation that never ends costs the 10 s force-stop grace after its abort before the next round starts, and under load the 15 s executor bound can pass first, which AC5 reads as a job that did not run.
- From the ruling on AC7: a workspace whose tests rewrite, on every run, an input outside its own inputs loops a job and a run at lowest priority until the tests stop writing it.
- From the review's F2b: a look that coincides with an input event not yet read finds no definition eligible and takes nothing, with no log entry, and when that event's read changes no input the next look comes at the next input change or periodic reconciliation, up to 5 minutes later.
- From F5: a reply object that reads a known status other than `ran` without that status's members makes the look throw; the round reads held with the error until the next input event or periodic reconciliation, and the same job is then sent again. Only a process that forges the executor's reply produces one.

**Unverified.** Linux, for U1 and for both probes: each was run on Windows only. The commands, from a Linux checkout with its own install: `node --conditions=development --import <file URL of packages/daemon/src/daemon/source-hooks.ts> _agent-docs/.scratch/t3-5-u1/probe.mjs <vitest|vitest-4> <forks|threads>`, and the same flags with `_agent-docs/.scratch/t3-5-dev/e2e-probe.mjs <vitest|vitest-4> <plain|loop>`.

**Change-request candidates, for `review-changes`.**

- A fork, with a recommendation (review F4). Falsification entries print under the CLI's heading "Ended with nothing stored:" and after "; ended with nothing stored:" in a no-answer reason, which is not literally true of a job that stored verdicts and left one definition without one. Keep: design decision 8 and AC8 put the entries in that list, and each entry's own text says what was left. Or reword the heading for both meanings, which edits `packages/cli/src/answer-text.ts` at 494 of its 500 code lines, `query/summary.ts`, and every test that pins the heading. Recommended: keep.
- `wasInterrupted` in `daemon/falsification.ts` repeats the private function of that name in `falsify/falsify-workspace.ts` (review F7). Export one from `falsify/experiment-record.ts` and import it in both; the daemon process cannot import `falsify-workspace.ts`, which loads the parser. Not fixed here: `falsify/experiment-record.ts` is outside this ticket's File List, a widening, and lane error-kind is editing it in Tree 1. Fix once that lane has landed.
- `INTERRUPTED_BEFORE_SEND_REASON` in `daemon/executor.ts` reads "the run was interrupted by a change before the job was sent to its executor process, so the job was not run", which is wrong of a falsification job its time bound aborted before the send (review F9). Make the text name a job and no cause. Not fixed here: design decision 10 keeps `daemon/executor.ts` and the 41 records anchored in it unedited by this ticket.

**The README and the other files this lane does not edit.** The change is user-visible (the daemon falsifies by itself, a new activity, a new kind of entry, protocol version 6), so `README.md` changes with it. The exact text for it, for `docs/architecture.md` (six sections), ADR-0007, `docs/glossary.md` and `_agent-docs/next-session.md` is in `_agent-docs/.scratch/t3-5-dev/docs-text.md`, reported to the orchestrator with the transition.

**Left undone.** Nothing of the ticket's tasks. The tests, the 22 records to re-anchor and prove, and `test/scheduler.test.ts` are the tests session's.

### File List

- `_agent-docs/tickets/3-5-schedule-falsification.md` (created by create-ticket)
- `_agent-docs/sprints/sprint-3-falsification.md` (create-ticket: § Ticket 3.5's scope line and ticket link, and this ticket's sizing figures in the paragraph on the cut from 3.4c)
- `docs/requirements.md` (create-ticket: FR22's marker gains this ticket; FR8's text and marker read as before it, by the ruling of 08:49)

Created by dev:

- `packages/daemon/src/daemon/falsification.ts`
- `packages/daemon/src/daemon/falsification-plan.ts`

Modified by dev:

- `packages/daemon/src/daemon/lifecycle.ts`
- `packages/daemon/src/daemon/scheduler.ts`
- `packages/daemon/src/daemon/job-endings.ts`
- `packages/daemon/src/daemon/discovery-history.ts`
- `packages/daemon/src/daemon/round-selection.ts`
- `packages/daemon/src/daemon/protocol.ts`
- `packages/daemon/src/query/answer.ts`
- `packages/daemon/src/query/summary.ts`
- `packages/cli/src/answer-text.ts`
- `_agent-docs/tickets/3-5-schedule-falsification.md` (the boxes, the resolutions under the Unverified Assumptions table, the Dev Handoff, the Completion Notes and this list)

No dependency changed: `git status` shows no manifest and no lockfile.

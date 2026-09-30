# Ticket 2.3r: Make room in the lifecycle and the scheduler

## Ticket

As the lanes that build tickets 2.3k, 2.4, 2.4d and 2.4b,
I want the lifecycle's build wait, its list of jobs that stored nothing and its missing-workspace log line, and the scheduler's per-workspace run record, moved into modules of their own with no behavior changed,
so that each of those tickets can add to `daemon/lifecycle.ts` and `daemon/scheduler.ts` under lint's 500-code-line cap, and 2.3k's same-path count has a home beside the run record it reads.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: The wait for the dependency build at the settled revision, which a round and a run's end verdict take today, lives in `DependencyBuilds` and behaves exactly as it does in `daemon/lifecycle.ts` at d6ea204: it waits while a build is pending, through one rebuild, and proceeds once `DISCARDS_A_RUN_WAITS_THROUGH` (2) builds were discarded in a row while it waited, counting only discards since it began, with the same log line. `daemon/lifecycle.ts` no longer declares the wait or the constant.
- [x] AC2: The scheduler's record of the last run it started for each workspace lives in a new module of its own and behaves exactly as it does in `daemon/scheduler.ts` at d6ea204: a run is marked as having stored nothing before its job is awaited, so a run that throws counts as one whose process died; a run that did not begin keeps its periodic retry and leaves the mark set before its job; a workspace already run at this revision and list of test modules is not run again unless a once-more rerun is owed or the periodic retry is running it (`#due`'s `retry`); a run stored not fingerprinted because its inputs changed at a revision the change did not move is owed exactly one rerun, with the same two log lines; and the schedule and the periodic retry read whether the last run stored nothing from this record. `daemon/scheduler.ts` no longer declares the record.
- [x] AC3: No behavior changes: every existing test passes unedited; each named-defect record whose `old` anchor lay in the moved code, or on a line the move rewrites, is re-anchored in `packages/daemon/test/defects.json` on the code as it now stands, naming the file that holds it, keeping its defect sentence and making the same decision wrong; and it is proven again by id, as is every other record whose `file` is one of the edited files.
- [x] AC4: The lifecycle's list of jobs that ended with nothing stored, and its log line naming each confirmed workspace a discovery did not find, live in `daemon/job-endings.ts` and behave exactly as they do in `daemon/lifecycle.ts` at d6ea204: each job is listed once, by its latest ending, with the same log line; a record stored for a job unlists it; status and every answer read the same list; and the missing-workspace line and the `discovery ended` summary read as today. `daemon/lifecycle.ts` no longer declares the list, `#unlist`, `#logMissingConfirmed` or `discoverySummary`.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It moves the daemon's own code.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Before the first edit, re-read `daemon/lifecycle.ts` `#awaitBuild` and its two callers, `#unstored`, `status()`, `#store`, `#nothingStored` and its callers, `#unlist`, `#logMissingConfirmed` and `discoverySummary`, `daemon/job-endings.ts`, `daemon/dependency-builds.ts` (`DependencyBuildParts`, `pending`, `discards`, `ended`), and `daemon/scheduler.ts` (`Attempt`, `#attempts`, `#storedNothing`, `#ranAlready`, `#armRetries`, `#run`), and confirm the names § Current structure gives. Match every record in § Named-defect records the move reaches against its file again, since a later commit may have moved one.
- [x] (AC1) Move `#awaitBuild` and `DISCARDS_A_RUN_WAITS_THROUGH` from `packages/daemon/src/daemon/lifecycle.ts` into `DependencyBuilds` (`packages/daemon/src/daemon/dependency-builds.ts`) as a public method taking the subject, reading `this.#parts.inputs` and `this.#parts.log` where the lifecycle read its own parts, and keeping each line whose text a record anchors (D2518, D2519, D2559) word for word. The lifecycle's two callers (the scheduler part `awaitBuild` and `#settleRun`'s wait before its verdict) call the method, and `SchedulerParts.awaitBuild` keeps its shape. The constant's doc comment moves with it.
- [x] (AC2) Create `packages/daemon/src/daemon/run-history.ts` holding the scheduler's per-workspace run record, keyed by workspace path: the `Attempt` shape; whether the last run attempted stored nothing (`#storedNothing`, which `WorkspaceSchedule`'s `storedNothing` part and `#armRetries`' `retryOwed` call read); whether a workspace already ran at a revision and list of test modules (`#ranAlready`); and the bookkeeping `#run` does around its job: whether this run is the owed rerun, the mark that nothing is stored set before the job is awaited (left in place when the job did not begin, since `#run` restores nothing, unlike `#discover`), and, from the report's `revision`, `stored` and `changedWhileRunning` and the current revision, whether the change left the revision unmoved, the two log lines, the record the run leaves, and whether it is owed once more, which `#run` hands to `WorkspaceSchedule.runEnded`. Read the current revision through a part the scheduler hands the record at construction, at the moment the report arrives, as `this.#revision()` is read today (D2743), rather than having `#run` pass it (P18). Give it a narrow interface over that behavior (P18): the scheduler asks it questions and tells it a run began and ended, and holds no `Attempt` itself. Keep it a leaf that imports nothing from `scheduler.ts`: it declares the report fields it reads, which `RunReport` satisfies structurally, so 2.3k extends it with no import cycle. Keep `#retryWorkspaces` and its two lines in `#run` (D2661, D2731) in the scheduler, word for word, since the periodic retry is not the run record. Export only what the scheduler imports (C59).
- [x] (AC2) In `packages/daemon/src/daemon/scheduler.ts`, construct the record, route each read and write above through it, and delete what moved. Keep the order of every step in `#run` (the retry bookkeeping, the mark before the await, the `next in the queue` line, the job, the report's handling), since D2733 and D2661 rest on it.
- [x] (AC4) Move the unstored-jobs list (`#unstored`, `#nothingStored`'s listing and log line, `#unlist`) from `packages/daemon/src/daemon/lifecycle.ts` into `packages/daemon/src/daemon/job-endings.ts` as a small class holding the list, taking the log, with a method to list a job's ending, one to unlist a job whose record was stored, and a read of the list for `status()`. Keep `#nothingStored` in the lifecycle as a one-line delegate with its signature, so every call site keeps its text and D1456, D1457, D1465, D1987 and D2739 keep their anchors; keep `#store`'s order (write, then unlist) for D2730. Move `#logMissingConfirmed` and `discoverySummary` into the same file as functions taking what they read (the confirmed start's workspaces and the log), keeping `discoverySummary`'s name so D2970's line stays word for word.
- [x] (AC3) In the Dev Handoff, list for create-tests each record in § Named-defect records the move reaches whose `old` no longer matches exactly once in its `file`, with the file and line that now hold its code, so create-tests re-anchors it (its `file`, `old` and `new` quoting the moved line so the mutation makes the same decision wrong, its defect sentence unchanged) and proves it by id with every other record whose `file` is one of the edited files, as 2.3i's lane did. This session edits no test and no `defects.json`.
- [x] (Support) Sweep prose for the old homes (C48): `rg -n "awaitBuild|DISCARDS_A_RUN_WAITS_THROUGH|#attempts|Attempt\b|storedNothing|ranAlready|#unstored|#unlist|logMissingConfirmed|discoverySummary"` over `packages/daemon/src`, `docs/` and `_agent-docs/`. Rewrite each comment in the edited files that places the build wait, the unstored list or the missing-workspace line in the lifecycle, or the run record in the scheduler, verifying the new claim against the code, and report to the orchestrator any doc or pending ticket that still names the old home.
- [x] (Support) Lint and typecheck: `bun x oxlint` and `bun x prettier --check` over the five production files, `bun run --filter @rt-test/daemon typecheck`; report the code lines of `lifecycle.ts`, `scheduler.ts`, `dependency-builds.ts`, `job-endings.ts` and `run-history.ts` after the move.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `DependencyBuilds` `pending`, `discards` and `ended` (`daemon/dependency-builds.ts`), and its parts' `inputs` and `log`: everything the wait reads.
- `testModulesKey` (`daemon/due-workspaces.ts`): the list-of-modules key the record compares.
- `RunReport` (`daemon/scheduler.ts`): what a run's end reports, whose fields the record reads through a shape of its own (task 3), and `WorkspaceSchedule.runEnded` (`daemon/workspace-schedule.ts`), which takes the owed flag.
- `DaemonLog` (`daemon/daemon-log.ts`): the two once-more log lines, which move with the record, and the unstored and missing-workspace lines.
- `UnstoredJob` (`daemon/protocol.ts`): the list's entry, whose workspace path is undefined for the discovery.
- `job-endings.ts`' existing helpers (`threwOutcome`, `interruptedRun`, `runToStore`, `storeFailureReason`): the home the lifecycle's job-ending code already moved to, which the list and the log line join.

### Must Create

- `packages/daemon/src/daemon/run-history.ts`: the per-workspace run record and its narrow interface (AC2).
- The public build-wait method on `DependencyBuilds` (AC1).
- The unstored-jobs class and the missing-workspace log function in `job-endings.ts` (AC4).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Split out of ticket 2.3k by the orchestrator at 19:16 on 2026-09-29, from 2.3k's sizing (20 raw files, 26 estimated, past the 20-file limit). A behavior-neutral move that stands alone and makes room for four tickets: 2.3k, 2.4, 2.4d and 2.4b each write `daemon/lifecycle.ts`, and 2.3k and 2.4b write `daemon/scheduler.ts`. It builds first; the orchestrator has told 2.4 and 2.4b's authors to read the moved code.

Rule clauses the criteria rest on:

- P16: "Keep a production file normally under 500 lines, extracting by responsibility; lint caps code lines at 500." (AC1, AC2, AC4)
- P18: "When extracting or consolidating logic, give the module a narrow interface over significant behavior, and move pre-loading and resolution inside it rather than making callers pass them." (AC2)
- AGENTS.md § Tests and validation: "Invalidate defect evidence when its test, mutation, relevant inputs, or execution configuration changes. Until RT Test's own falsification re-proves what an edit can affect, a lane re-proves every record whose test or mutated file it edits, and the push gate re-proves none." (AC3: every record in an edited file is proven again, moved or not)

#### Why these pieces

Code lines by the lint's count (`max-lines`, blank lines and comments skipped), measured on d6ea204: `lifecycle.ts` 497, `scheduler.ts` 492, `dependency-builds.ts` 336, `job-endings.ts` 31.

- **Q-R1 (AC4), asked 19:23 from the ticket review's F9, decided by the orchestrator at 19:23: both further moves into `job-endings.ts`**, the missing-workspace log line with `discoverySummary`, and the unstored-jobs list as a small class there. Reason: the build wait alone leaves `lifecycle.ts` about 478, and the four tickets' estimated additions (2.3k about 6, 2.4 about 4, 2.4d about 10, 2.4b about 15) would pass the cap; the first move alone leaves about 496 after them, no margin for estimates; both leave about 445 and give 2.4b one signal point for a job that stored nothing. The re-proof stays as AGENTS.md says, every record whose mutated file this lane edits.

- **The build wait belongs to the builds.** `#awaitBuild` reads only `DependencyBuilds`' own `pending()`, `discards()` and `ended()`, the tracker's `settled()` and the log, and `DependencyBuildParts` already holds `inputs` and `log`. Moving it frees about 19 code lines of `lifecycle.ts` and changes no caller's shape.
- **The run record is what 2.3k's count reads.** 2.3k counts, per workspace, the times it becomes due after its last run in this daemon life, from when that run began and how it ended. The scheduler's `Attempt` already holds the last run's revision, list of test modules and whether it stored nothing, so 2.3k extends this module rather than adding a second per-workspace record (C8). Moving it frees about 40 code lines of `scheduler.ts`. This ticket adds nothing for 2.3k: an export or field with no reader is C59's defect.

#### Ticket review

One ticket-internal reviewer, 2026-09-29 19:18 to 19:21, 13 findings, triaged by create-ticket at 19:22. Applied: F1 (AC2's periodic-retry exception to the once-per-revision rule), F2 and F10 (the record reads the current revision through a part the scheduler hands it, and imports nothing from `scheduler.ts`), F3 and F4 (two hedges removed), F6 (the code-line report names every production file), F7 (records on lines the move rewrites, which added D2905), F8 (the lifecycle tests drive the real `DependencyBuilds`, checked), F11 (the prose sweep), F12 and F13 (every record in an edited file is proven again, as AGENTS.md says; the counts include the moved records). F5 settled on 2.3i's precedent: dev lists the moved records in its handoff and create-tests re-anchors and proves them, so dev edits no test and no `defects.json`. F9 went to the orchestrator as Q-R1 (below).

#### Current structure of the moved code

Read on `main` at d6ea204.

- `daemon/lifecycle.ts` (580 lines, 497 code lines): `const DISCARDS_A_RUN_WAITS_THROUGH = 2;` under the doc comment "The build a run waited on and one rebuild; a run waits through no more discards than these."; `#awaitBuild(subject)` records `waitedFrom = builds.discards().total`, and while `builds.pending()` computes `inARow = Math.min(discards.total - waitedFrom, discards.consecutive)`, logs `${subject} proceeds without its dependency build, discarded ${inARow} times in a row while it waited: ${discards.reason}` and returns once `inARow >= DISCARDS_A_RUN_WAITS_THROUGH`, and otherwise awaits `builds.ended()` then `inputs.settled()`. Its callers: the constructor's scheduler part `awaitBuild: (subject) => this.#awaitBuild(subject)`, and `#settleRun`'s `await this.#awaitBuild(\`the verdict on ${job}\`)`.
- `daemon/lifecycle.ts`, the unstored list and the log line: `readonly #unstored: UnstoredJob[] = []`; `status()` returns `unstoredJobs: [...this.#unstored]`; `#store(what, workspacePath, write)` runs `write()` then `this.#unlist(workspacePath)`, and on a throw logs `storing ${what}` and calls `#nothingStored(workspacePath, storeFailureReason(error))`; `#nothingStored(workspacePath, reason)` unlists the job, pushes `{ reason }` or `{ workspacePath, reason }`, and logs `the discovery` or `the run of <path>` `ended with nothing stored: <reason>`; `#unlist(workspacePath)` keeps every other job (undefined names the discovery); `#logMissingConfirmed(discovery)` logs `the confirmed workspace <path> was not found, so nothing of it was loaded` for each confirmed workspace the discovery lacks; the module function `discoverySummary(discovery)` joins `<path> <status>` for the `discovery ended` line. `#nothingStored` is called from `#discover`, `#run`, `#settleRun` and `#store`.
- `daemon/job-endings.ts` (40 lines, 31 code lines): `threwOutcome`, `interruptedRun`, `runToStore`, `storeFailureReason`, each a function the lifecycle imports.
- `daemon/dependency-builds.ts` (394 lines, 336 code lines): `DependencyBuildParts { inputs, executor, consumerRoot, stateDirectory, log, boundMs? }`; `DependencyBuilds` with `use`, `start`, `narrowing`, `pending`, `discards`, `ended`, `stop`.
- `daemon/scheduler.ts` (578 lines, 492 code lines): private `Attempt { revision, modules, nothingStored, rerunOwed }`; `#attempts: Map<string, Attempt>`; the constructor hands `WorkspaceSchedule` `storedNothing: (path) => this.#storedNothing(path)`; `#armRetries` calls `retryOwed(latest, stale, this.#storedNothing(path))`; `#due` skips a workspace when `!retry && this.#ranAlready(path, revision, entry)`; `#storedNothing(path)`; `#ranAlready(path, revision, entry)` (same revision, same `testModulesKey`, no rerun owed); `#run(queued, revision)`: computes `isRerun` from the earlier attempt, moves `#retryWorkspaces`, sets the attempt with `nothingStored: true` before the job, logs `next in the queue`, awaits `#runJob`, keeps the retry and returns when the report is undefined, computes `unmoved` (`report.changedWhileRunning && report.revision === this.#revision()`), logs one of the two once-more lines, sets the attempt from the report, and calls `this.#schedule.runEnded(path, report, unmoved && !isRerun)`.

#### Named-defect records the move reaches

Each record whose `old` anchor lies in the moved code, or on a line the move rewrites (the lifecycle's scheduler part `awaitBuild` and `#settleRun`'s wait, the scheduler constructor's `storedNothing` part, `#due`'s `#ranAlready` guard, `#armRetries`' `retryOwed` call, and `#run`'s lines around the job), found by matching every record's `old` in `packages/daemon/test/defects.json` against its file at d6ea204 and keeping those on those lines. The tests stay where they are.

- `lifecycle.ts` to `dependency-builds.ts`: D2518 (`const DISCARDS_A_RUN_WAITS_THROUGH = 2;`), D2519 (`if (inARow >= DISCARDS_A_RUN_WAITS_THROUGH) {`), D2559 (`const waitedFrom = builds.discards().total;`); tests in `lifecycle.test.ts`.
- Staying in `lifecycle.ts` with a changed line: D2905 (`await this.#awaitBuild(\`the verdict on ${job}\`);`, which now calls the method on `DependencyBuilds`); test in `lifecycle.test.ts`.
- `lifecycle.ts` to `job-endings.ts` (AC4): D2678 (`#unlist`'s filter of the list).
- Staying in `lifecycle.ts` with a changed line (AC4): D2730 (`write();` then `this.#unlist(workspacePath);` in `#store`, which now unlists through the class) and D1464 (`this.#logMissingConfirmed(discovery);`, which now calls the moved function).
- Staying word for word when `#nothingStored` stays a delegate and `discoverySummary` keeps its name (AC4): D1456, D1457, D1465, D1987, D2739 (calls of `#nothingStored`) and D2970 (the `discovery ended` line).
- `scheduler.ts` to `run-history.ts`: D2648 and D2649 (`#ranAlready`'s revision and modules comparisons), D2650 and D2651 (`rerunOwed: unmoved && !isRerun,`), D2733 (`nothingStored: true,` in the mark before the job), D2743 (the `unmoved` expression, which reads the current revision through `this.#revision()` today and reads it through the record's revision part at the same moment after the move); tests in `scheduler.test.ts`.
- Staying in `scheduler.ts` with a changed line: D2693 (`retryOwed(latest, stale, this.#storedNothing(path))`, whose call now goes through the record) and D3097 (`this.#schedule.runEnded(path, report, unmoved && !isRerun);`, whose owed flag now comes from the record while the call stays in `#run`).
- Staying word for word: D2661 (`this.#retryWorkspaces.delete(path);`) and D2731 (`if (retried) this.#retryWorkspaces.add(path);`).

By `file` field at d6ea204, counting the moved records above among them: `lifecycle.ts` holds 71 records, `scheduler.ts` 47, `dependency-builds.ts` 40 and `job-endings.ts` 4. Every one is proven again by id (AC3), since this lane edits its mutated file; the records outside the moved and rewritten lines keep their anchors.

The lifecycle tests behind D2518, D2519, D2559 and D2905 drive the real `DependencyBuilds`, never a stand-in: the lifecycle constructs its own, and `lifecycle.test.ts`' build cases construct `new DependencyBuilds({ inputs, executor, ... })` directly (`rg -n "DependencyBuilds" packages/daemon/test`, 19:22: only `lifecycle.test.ts`' import, `StartedBuilds` and `withBuilds`). So the moved wait still runs under them.

#### Existing tests this change breaks

None expected: no test imports `Attempt`, `#awaitBuild` or `DISCARDS_A_RUN_WAITS_THROUGH`, and `SchedulerParts` and `DependencyBuilds`' existing members keep their shapes, so the scheduler rig and the lifecycle harness compile unchanged. Found by `rg -n "awaitBuild|DISCARDS_A_RUN|Attempt\b|ranAlready|storedNothing|rerunOwed" packages/daemon/test` (2026-09-29 19:17): the scheduler rig's `awaitBuild` option, which feeds `SchedulerParts.awaitBuild`, and the `storedNothing: () => false` parts `query.test.ts` and `scheduler.test.ts` hand `WorkspaceSchedule`, whose shape stays. A red test after the move is a behavior change to fix in the code, never in the test (AC3). `defects.json` changes only where an anchor moved, and create-tests makes that change.

#### Pending siblings and their routing

- **2.3k** (backlog, builds next): extends `run-history.ts` with when a run began and how it ended, and its same-path count and hold. This ticket adds none of it.
- **2.4, 2.4d, 2.4b** (ready-for-dev): write `lifecycle.ts`; 2.4b writes `scheduler.ts` and `workspace-schedule.ts`. The orchestrator gave 2.4 and 2.4b a line naming this move (19:16).
- **2.3q** (building in Tree 1): edits `vitest/load-vitest.ts`, `vitest/selection-facts.ts`, `inputs/env-files.ts`, `store/columns.ts` and `store/schema.ts`, none of which this ticket touches (orchestrator, 19:06 and 19:16).

#### Previous ticket

2.3i (done, 13ede23, with 3276808's fix to `#explain` and `#selectRound`): added `workspace-schedule.ts`, whose `storedNothing` part reads the scheduler's record; the scheduler then sat at 491 code lines, and 3276808 added one. Neither touched `#awaitBuild` or `Attempt`.

#### Sizing

6 raw files, 8 estimated (7.8); 4 code units (3 criteria needing code plus validation). Production: modify `daemon/lifecycle.ts`, `daemon/dependency-builds.ts`, `daemon/job-endings.ts`, `daemon/scheduler.ts`; create `daemon/run-history.ts`. Tests, for create-tests: `packages/daemon/test/defects.json` (re-anchoring only), and the by-id proof of every record in the four edited files, 162. The lifecycle group (`lifecycle.ts`, `dependency-builds.ts`, `job-endings.ts`) and the scheduler group (`scheduler.ts`, `run-history.ts`) touch disjoint files.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3r and § Ticket 2.3k.
- `_agent-docs/tickets/2-3i-schedule-answers.md` (Completion Notes: code lines at its landing).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (2026-09-29 19:12).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C4,C8,C14,C43,C44,C46,C48,C59,C160,C167 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P14,P16,P17,P18,P19 -->

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
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/dependency-builds.ts
  - packages/daemon/src/daemon/job-endings.ts
  - packages/daemon/src/daemon/scheduler.ts
  - packages/daemon/test/defects.json
files_to_create:
  - packages/daemon/src/daemon/run-history.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 52a93e5f-a503-4924-8628-86d7b7d0d0ae

#### Test Files This Change Broke

None. `bun run --filter @rt-test/daemon typecheck` compiles `test/**/*.ts` and exits 0 on the final tree (19:38); no test imports a moved symbol.

#### ACs Owed a Test

- AC3: the suite passing unedited, the re-anchoring below, and the by-id proof. Every record in the four edited files is proven again, 162 by `file` field: `lifecycle.ts` 71 (the ticket's 72 counted a record whose `file` is `test/fixtures/daemon/daemon-lifecycle/packages/a/heartbeat.mjs`), `scheduler.ts` 47, `dependency-builds.ts` 40, `job-endings.ts` 4.

Records whose `old` no longer matches exactly once, checked against every record in the four files at 19:33 and again after the review fixes: exactly the 15 below, and every other record still matches once. Suggested `old` and `new` keep each mutation making the same decision wrong.

| Record | Now in                 | Line    | Suggested `old`                                                                                                               | Suggested `new`                                 |
| ------ | ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| D2518  | `dependency-builds.ts` | 38      | unchanged: `const DISCARDS_A_RUN_WAITS_THROUGH = 2;`                                                                          | unchanged                                       |
| D2519  | `dependency-builds.ts` | 169     | unchanged: `      if (inARow >= DISCARDS_A_RUN_WAITS_THROUGH) {`                                                              | unchanged                                       |
| D2559  | `dependency-builds.ts` | 162     | `    const waitedFrom = this.discards().total;` (was `builds.`: the method reads `this`, so no alias of `this` was kept)      | `    const waitedFrom = 0;`                     |
| D2905  | `lifecycle.ts`         | 407     | `` await this.#builds.awaitBuild(`the verdict on ${job}`);`` with its indent and newline                                      | empty                                           |
| D1464  | `lifecycle.ts`         | 283     | `    logMissingConfirmed(discovery, start.workspaces, log);`                                                                  | empty                                           |
| D2730  | `lifecycle.ts`         | 478-479 | `      write();\n      this.#unstored.unlist(workspacePath);\n`                                                               | `      write();\n`                              |
| D2678  | `job-endings.ts`       | 72-74   | `    this.#jobs = this.#jobs.filter(\n      (job) => job.workspacePath !== workspacePath,\n    );`                            | `    this.#jobs = [...this.#jobs];`             |
| D2648  | `run-history.ts`       | 68      | unchanged: `      attempt.revision === revision &&\n`                                                                         | unchanged                                       |
| D2649  | `run-history.ts`       | 69      | unchanged: `      attempt.modules === testModulesKey(entry) &&\n`                                                             | unchanged                                       |
| D2733  | `run-history.ts`       | 93      | unchanged: `      nothingStored: true,\n`                                                                                     | unchanged                                       |
| D2743  | `run-history.ts`       | 102     | unchanged: `      report.changedWhileRunning && report.revision === this.#revision();` (`#revision` is now the record's part) | unchanged                                       |
| D2650  | `run-history.ts`       | 117     | `      rerunOwed: owedAgain,`                                                                                                 | `      rerunOwed: false,`                       |
| D2651  | `run-history.ts`       | 117     | `      rerunOwed: owedAgain,`                                                                                                 | `      rerunOwed: unmoved,`                     |
| D2693  | `scheduler.ts`         | 318     | `retryOwed(latest, stale, this.#runs.storedNothing(path))`                                                                    | `retryOwed(latest, stale, false)`               |
| D3097  | `scheduler.ts`         | 478     | `this.#schedule.runEnded(path, report, owedAgain);`                                                                           | `this.#schedule.runEnded(path, report, false);` |

`owedAgain` is computed once in `run-history.ts` (`const owedAgain = unmoved && !isRerun;`), stored as `rerunOwed` and returned to `#run`, which hands it to `runEnded`. So D2650 and D2651 mutate only the record and D3097 only the schedule's flag, as before the move.

#### Tests Owed

None: the change moves code and adds no behavior.

### Tests Record

Tests session: threadId cc252b9b-c61d-4df2-9174-fe7e3683dac1

Tested 2026-09-29 19:41 to 19:58 by rt-t2-3r-tests. No test file was written or edited, and no new record was needed, so D3133 through D3137 are unused.

- Suite: `vitest related` over the five production files selected 2 test files (253 tests, exit 0), which misses the tests that start a real daemon in a child process, so the daemon and CLI trees ran whole: `bun x vitest run packages/daemon/test packages/cli/test` through the lease, 30 of 68 test files, 1574 of 1574 tests passed, exit 0 (19:44:24, 164.4 s). No red, so no stale test and no code bug.
- Re-anchoring: the 15 records below take the Dev Handoff's suggested `file`, `old` and `new`, each checked against the moved code to keep its defect sentence and make the same decision wrong. `node scripts/check-defects.mjs` exit 0 (2463 named defects).
- Proof: every record whose `file` is one of the five production files, 162 (`lifecycle.ts` 67, `scheduler.ts` 41, `dependency-builds.ts` 43, `run-history.ts` 6, `job-endings.ts` 5), by `node scripts/verify-defects.mjs --ids <the 162>` through the lease. Windows: 162/162 detected, exit 0 (19:47 to 19:54). WSL clone under `~/`, Node v24.13.1, `TMPDIR=$HOME/.rt-test-runs/wsl-node-12345`: 162/162 detected, exit 0 (19:54 to 19:58); the clone's six changed files were compared byte for byte with the main checkout after the run.

#### Named Defects

Re-anchored and proven again (AC3, beside the criterion each pins):

- D2518: A run proceeds after one discarded build, so a single edit mid-build leaves the run unfingerprinted. (AC1)
- D2519: A run waits for its build however many are discarded, so steady input churn holds the run for good. (AC1)
- D2559: A run counts every discard since the daemon started, so the next workspace's run proceeds at once after the first gave up waiting. (AC1)
- D2905: A run's verdict is taken before its end revision's build has ended, so a run whose inputs moved just before it returned, only by changes outside its workspace's inputs, is stored not fingerprinted. (AC1)
- D2648: A workspace whose run ended with nothing stored is run again at the same input revision, so it runs in a loop with no input change. (AC2)
- D2649: A workspace is not run again when a rediscovery at an unchanged revision lists new test modules for it, so a test added to it stays unrun. (AC2)
- D2650: A run stored not fingerprinted by a change that left the revision unmoved is not run again, so a save of identical bytes leaves the workspace unknown. (AC2)
- D2651: The run repeated for an unmoved change is itself repeated when it is stored not fingerprinted again, so a test that rewrites its own input with identical bytes reruns without end. (AC2)
- D2693: A workspace whose run ended with nothing stored and is still due is not retried when a periodic reconciliation ends, so it stays without a result until an input changes. (AC2)
- D2733: A run whose job throws is not counted as having stored nothing, so a periodic reconciliation does not retry it while it stays due. (AC2)
- D2743: A run stored not fingerprinted by a change that moved the input revision is logged as running once more at its revision, though no rerun is owed. (AC2)
- D3097: A run stored not fingerprinted and owed once more at an unmoved revision leaves the due list, so until the next plan it reads idle with no run coming, although it is about to run again. (AC2)
- D1464: A confirmed workspace the daemon no longer finds goes unmentioned in the log. (AC4)
- D2678: Each ending of a job that stored nothing is appended to the list, so a job retried at every periodic reconciliation grows it without end. (AC4)
- D2730: A job that ended with nothing stored stays listed after a later attempt of it stores its record, so status lists as unstored a workspace, or a discovery, whose latest record was stored. (AC4)

The other 147 records in the five files kept their anchors and were proven again in the same runs (AC3).

#### Deliberately Untested

- packages/daemon/src/daemon/job-endings.ts: `status()` now hands out `UnstoredJobs`' array itself rather than a copy. That yields no nameable defect, since the class replaces the array on each change and never mutates it in place.

### Review Record

Review session: threadId ffc105ae-b834-4ec9-8981-4c070835aa6b

Reviewed 2026-09-29 19:59 to 20:07 by rt-t2-3r-review, with one fresh-eyes batch (the five production files and the `defects.json` diff, 1,420 code lines) and one doc-verify agent over ed28fab's ticket, sprint entry and glossary terms.

- Behavior: no change found. Each moved statement keeps its order against the awaits and reads the same objects (`DependencyBuilds` gets the lifecycle's own `parts.inputs` and `parts.log`; `logMissingConfirmed` gets `this.#parts.start.workspaces` and `this.#parts.log` through `#discover`'s locals; `RunHistory`'s `revision` part is `Scheduler.#revision`). All six moved log lines are byte-identical, and each of the 15 re-anchored records keeps its `new` making the same decision wrong.
- Fixed in this record (doc-verify, ed28fab): total line counts at d6ea204 (580, 578, 394, 40), `DependencyBuildParts`' optional `boundMs`, `lifecycle.ts`' 71 records (162 in all), and the recorded test search, which also finds the `storedNothing` parts two tests hand `WorkspaceSchedule`. AC2's restore clause and the call-site count were already corrected at 19:28.
- Discarded: `#nothingStored` as a delegate (task 5 keeps it so six anchors stay); `UnstoredJobs.list`'s name (task 5's verb, paired with `unlist`); AC3's run evidence (the Tests Record holds it).
- Glossary (ed28fab): **Input** and **Declared non-input** say "edit" for any change, which the new **Edit** term narrows; reported to the orchestrator with replacement text.

Tech debt, for triage once committed:

- TD1, `packages/daemon/src/daemon/run-history.ts:85-88`: `isRerun`'s `before.revision === revision` and `before.modules === modules` guards have no named defect, moved unchanged from `scheduler.ts`. Defect: with the revision guard dropped, a rerun owed at revision R that never ran (the revision moved first) makes the run at R2 read as the rerun, so when that run is also stored not fingerprinted by an unmoved change it is held rather than owed once more, and the workspace stays not fingerprinted until the next input change; the modules guard has the same shape across a rediscovery at R. D2650 and D2651's tests stay at one revision and one list of modules. Coverage unsettled by mutation.
- TD2, `packages/daemon/src/daemon/run-history.ts:90-95` with `scheduler.ts:473-476`: the mark `began` sets (`nothingStored: true`) stays when the job returns undefined (a stop, or a revision moved since the plan), as at d6ea204 (C167: "restored when the job never begins"). Its readers are `retryOwed` at `scheduler.ts:318` and `workspace-schedule.ts:322`; both need `stale`, and a stale workspace is due at the moved revision, where the next `began` overwrites the mark, and the second reads only on a planned round. Reach: no decision found that it changes, read from the code, not measured. The dev's change-request candidate, for 2.3k, which extends `run-history.ts` with how runs ended.

#### Test Coverage Gaps

None.

### Completion Notes

Built 2026-09-29 19:28 to 19:39 by rt-t2-3r-dev.

**Sanity check (Step 4)**, sent to the author rt-t2-3k-create at 19:28, both confirmed and applied by the author at 19:28 (TICKET UPDATED): F1, AC2 and task 3 said a run that did not begin keeps the earlier record, but `#run` at d6ea204 leaves the mark and restores only the retry, so the record has no restore path; F2, `#nothingStored` has six call sites, not five.

**Unverified assumptions:** none in the table.

**Fan-out:** not delegated. `run-history.ts` is the contract `scheduler.ts` calls, so it is wave 0. That leaves a three-file lifecycle group and a one-file consumer, which cost more to hand off than to write.

**What was done:**

- AC1: `DependencyBuilds.awaitBuild(subject)` and `DISCARDS_A_RUN_WAITS_THROUGH` (with its doc comment) in `dependency-builds.ts`. The loop reads `this.pending()`, `this.discards()` and `this.ended()` where the lifecycle read `builds.*`, and `this.#parts.inputs` and `log`, which are the lifecycle's own objects. The scheduler part `awaitBuild` and `#settleRun`'s verdict wait call it.
- AC2: `run-history.ts` holds `RunHistory` over a private `Attempt` map, with `storedNothing(path)`, `ranAlready(path, revision, entry)` and `began(entry, revision)`. `began` computes the rerun flag and sets the mark, and returns the function that records the run's end: it logs one of the two once-more lines, stores the record and returns whether a rerun is owed. It reads the current revision through the `revision` part the scheduler passes at construction, and imports nothing from `scheduler.ts`. `HistoryReport` declares the three fields it reads, and `RunReport` now extends `EndedRun` and `HistoryReport` rather than restating them (C14). In `#run`, the retry bookkeeping comes first, then `began` (the mark), the `next in the queue` line, the job, and on a report, the record's end and `runEnded`, in the order at d6ea204.
- AC4: `job-endings.ts` holds `UnstoredJobs` (`jobs()`, `list(workspacePath, reason)`, `unlist(workspacePath)`), plus `logMissingConfirmed(discovery, confirmed, log)` and `discoverySummary(discovery)`. The list is replaced on each change, never mutated in place, so `status()` hands out the array itself as the snapshot the old copy gave. `#nothingStored` stays as a one-line delegate, and `#store` writes, then unlists.
- Code lines by lint's count, measured with a counter that reproduces the ticket's 497 and 492 at d6ea204: `lifecycle.ts` 451, `scheduler.ts` 444, `dependency-builds.ts` 355, `job-endings.ts` 81, `run-history.ts` 89.

**Validation (19:38, final tree):**

- `bun x oxlint` and `bun x prettier --check` over the five files: 0.
- `bun run --filter @rt-test/daemon typecheck`: 0, tests included.
- `bun run --filter rt-test typecheck` (the CLI, the daemon's one dependent): 0.
- `node scripts/check-line-citations.mjs`: clean.
- Literal check: no new domain literal. The moved constant and log lines are unchanged.

**Acceptance evidence:**

- AC1, AC2 and AC4 were traced line by line against `git show HEAD:` of each file, by this session and independently by the adversarial reviewer, which found no behavior change.
- Two differences were checked as unobservable: `status()` returns the list itself rather than a copy (never mutated, and its readers only map and serialize it); and `#run` computes the modules key and rerun flag after deleting the retry entry (pure reads; `#explain` already computed that key for every due entry in the same plan).
- AC3 is owed to create-tests (Dev Handoff).

**Adversarial review (19:34 to 19:37), 4 LOW:**

- F1 fixed: `RunHistoryParts` is no longer exported (C59).
- F2 fixed: `RunEnding` renamed `HistoryReport` beside `EndedRun`.
- F4 fixed: the moved `awaitBuild` docblock now says the subject "proceeds without the build", which is true for the round's wait too.
- Discarded F3 (`began`'s recorder could overwrite a newer attempt): the scheduler runs one job at a time, `#step` awaits each, and the pre-move code had the same shape, so a guard would be dead code.
- Post-fix re-validation (lint, prettier, both typechecks): 0.

**Prose sweep:** no comment in the edited files places the moved code in its old home. Among pending tickets, 2.4 and 2.4b already say to read the files as 2.3r leaves them. The author's uncommitted 2.3k draft names `#ranAlready` (line 46), now `this.#runs.ranAlready` in `#due`, reported to the orchestrator.

**README:** no user-visible change, so none.

**Change-request candidates (for review-changes):**

- A decision, not a defect, since this ticket is behavior-neutral by the author's 19:28 ruling. C167 says a job's mark is restored when the job never begins, but `RunHistory.began`'s mark (`nothingStored: true`) stays when the run returns undefined (a stop, or a revision that moved since the plan), exactly as at d6ea204. Measured reach, read from the code: `retryOwed` needs `stale` as well, and a stale workspace is due again at the moved revision, where `ranAlready` no longer matches, so the mark is overwritten by the next `began`. After a stop nothing reads it. I found no path where it changes a decision. Recommendation: leave it, or have 2.3k, which extends `run-history.ts`, decide it with the run history's other endings. Ready-to-paste description: "`RunHistory.began` sets `nothingStored: true` before the run job; when the job returns undefined, the scheduler restores the periodic retry but not the earlier record (C167). Decide whether the record should restore its previous attempt, as `#discover` does for the discovery."

### File List

- _agent-docs/tickets/2-3r-make-room.md (created by create-ticket, 2026-09-29, split out of 2.3k at the orchestrator's 19:16 ruling, with Q-R1 at 19:23)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3r added before § Ticket 2.3k, under the orchestrator's 19:16 grant)
- _agent-docs/sprint-status.yaml (2-3r-make-room added, then set to ready-for-dev, under the same grant)
- packages/daemon/src/daemon/run-history.ts (created by dev-ticket: the scheduler's per-workspace run record)
- packages/daemon/src/daemon/lifecycle.ts (modified by dev-ticket: the build wait, unstored list and missing-workspace line moved out)
- packages/daemon/src/daemon/dependency-builds.ts (modified by dev-ticket: `awaitBuild` and `DISCARDS_A_RUN_WAITS_THROUGH`)
- packages/daemon/src/daemon/job-endings.ts (modified by dev-ticket: `UnstoredJobs`, `logMissingConfirmed`, `discoverySummary`)
- packages/daemon/src/daemon/scheduler.ts (modified by dev-ticket: the run record moved out, `RunReport` extends `HistoryReport`)
- packages/daemon/test/defects.json (modified by create-tests: 15 records re-anchored on the moved code)

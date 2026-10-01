# Ticket 3.6: Canary gate on the consumer's Vitest

## Ticket

As a coding agent or a developer reading defect evidence in a started project,
I want the daemon to falsify a workspace only once RT Test's canaries have read as named on the Vitest that workspace installed, and to say so when they have not,
so that a Vitest release that records run facts differently is refused by name instead of crediting a detection that never happened.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

A workspace's **Vitest install** and a **canary reading** (confirmed, disagreed, or no reading) are as the glossary and ticket 3.5b define them. A **canary job** is the one falsification job a reading takes. An install is **unread** while this daemon holds no reading of it.

- [ ] AC1: The daemon sends a workspace's falsification job only while it holds a confirmed reading of that workspace's Vitest install, taken in this daemon's life. When a look has picked a workspace whose install is unread, the canary job is that look's one job in place of the falsification job, and the daemon plans again when it ends, so an ordinary job that became due goes first and the next look sends the workspace's own job once the reading is confirmed. The canaries run for no workspace whose job is not about to be sent. A reading that is confirmed or disagreed is kept until the daemon stops: the canaries run at most once in a daemon's life for each install that gave one, however many workspaces resolve it and however many jobs follow. (FR23)
- [ ] AC2: A workspace whose install's reading disagreed is sent no falsification job while it resolves that install, and nothing is stored for it. At each input revision at which a look picks it, it is a workspace whose job did not run (ticket 3.5's AC6), marked from the kept reading with no canary job, so the next look takes the next workspace's definitions and every workspace on a confirmed install is still falsified. Its reason names the Vitest version, the falsifier version, and the canaries that disagreed by id, each with the judgement it read and the judgement named, bounded as ticket 3.5's AC8 bounds a list of definitions, with the number of the rest, and says what ends the refusal: the workspace resolving another Vitest install, or a restart of the daemon. That reason holds versions, canary ids and judgement names alone. (FR23)
- [ ] AC3: Nothing is kept of a canary job that gave no reading, and no job is sent for a workspace that resolves no supported Vitest. In each case the workspace is one whose job did not run at that input revision, its reason saying what happened and that a change of the input revision ends the wait, and the canaries run again when a look picks a workspace on that install at another revision. A change of the input revision, or a stop, ends a running canary job as ticket 3.5's AC4 ends a falsification job: it is aborted and ends within the executor's bound, no workspace is marked, nothing is kept, and no discovery and no run waits for it. The time bound of ticket 3.5's AC5 ends a canary job as it ends any job, and that job gave no reading. (FR23)
- [ ] AC4: An input change the tracker records while a canary job runs counts as an edit, never as a change the daemon's own job made, as one recorded after a look that sent no job does (ticket 3.5's AC7), since a canary job runs none of the consumer's code: it lies in no job's window, the change record is told of no job, and it counts toward no hold. (FR23)
- [ ] AC5: While a canary job runs, the daemon's activity reads falsifying, with the workspace the look picked and the number of definitions it picked for it. A workspace AC2 or AC3 marks appears in every answer and in `status` as ticket 3.5's AC8 lists a workspace whose job did not run: one entry marked as a falsification job, with the reason of AC2 or AC3, from the look that marked it until the input revision changes, and again from the next look that picks it. The daemon's log names each canary job as it starts (the workspace, the Vitest version and the install's directory) and as it ends (confirmed, or every canary that disagreed with what it read and what is named, or why it gave no reading, and its wall time). The protocol version and the CLI's JSON schema version stay as they are. (FR23)
- [ ] AC6: A canary job stores no run, no discovery and no evidence, and moves no input revision wherever the state directory lies. Neither it nor a reading changes a test's state or freshness, a definition's state, eligibility or evidence freshness, a count of any answer, whether a query answers, or a workspace's execution state, and no test or module of the canary set appears in a discovery or in any answer. (FR23)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It calls ticket 3.5b's reading, ticket 3.5's module and `resolveWorkspaceVitest`, and no library.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Read what tickets 3.5 and 3.5b built before anything else. This ticket was written before `daemon/falsification.ts`, `daemon/falsification-plan.ts` and `daemon/canary-reading.ts` existed, from those tickets' criteria and tasks and from 3.5's author's answers (Dev Notes § The seam). Where the built code differs from what a task below says of it, build this ticket's criterion, and name each difference in Completion Notes; a difference that would change a criterion goes to the orchestrator first.
- [ ] (AC1, AC2, AC3, AC5) Create `packages/daemon/src/daemon/canary-gate.ts`, the one module the falsification module asks, built from the run `Executor`, the state directory, the log and a canary directory. It answers for a workspace, with no await, from `resolveWorkspaceVitest` and from what it keeps under the install's directory and version: confirmed; refused, with AC2's reason and its ending; no supported Vitest, with the resolution's reason; or unread. For an unread install it takes a reading through ticket 3.5b's function, keeps it when it is confirmed or disagreed, logs the start and the end (AC5), and returns what happened. An install whose reading is being taken is unread (C174). Name the canaries of AC2's reason with `namedList`, as ticket 3.5 names definitions.
- [ ] (AC1, AC2, AC3, AC4, AC5) In `daemon/falsification.ts`, at the point where a job is about to be sent and before the change record is told that a job began, ask the gate about the picked workspace. Confirmed: go on as ticket 3.5 built it. Refused, or no supported Vitest: close the look's window, mark the workspace as one whose job did not run, with the gate's reason and its ending, and resolve true, as 3.5 handles a workspace the start no longer confirms. Unread: close the look's window (`inputs.endJob`, which is an await), then, with no await after it, return false after a stop or when the revision is no longer the planned one, as the look's own guard does (C160); set the activity to falsifying with the picked workspace and the number of definitions picked; have the gate take the reading under the wait on the input revision and the time bound a falsification job runs under, both cleared on every path (C157); tell the change record nothing; when it returns, reset the activity on every path (C167), and mark the workspace as one whose job did not run when the reading disagreed, or when it is no reading and neither a change of the input revision nor a stop ended the job; then resolve true, a third reason for the scheduler to plan again beside 3.5's two. Decide what ended the job from what this module asked for (a stop, a change, the bound), never from a reading's reason text, as 3.5's module does. A canary is no definition: no canary id enters a definition mark.
- [ ] (AC1) In `daemon/lifecycle.ts`, add the gate to `LifecycleParts` and hand it to the falsification module. In `daemon/daemon-main.ts`, build it from the run `Executor`, `identity.stateDirectory`, the log and the bundled canary directory `falsify/canary-set.ts` exports. Check every builder of `LifecycleParts` in the same change (C40): `daemon-main.ts`, and the three in `packages/daemon/test/lifecycle.test.ts`, which the typecheck finds and the tests session edits. List them under the Dev Handoff.
- [ ] (Support) Report to the orchestrator, with the handoff, the text for the files this lane does not edit: `docs/architecture.md` (§ Falsification jobs, for the gate, what it keeps and when it refuses; § Reconciliation and the round of runs, for the canary job as a look's one job; § Execution and falsification isolation; § Query surface, if ticket 3.5's text there names the reasons an entry can carry), `README.md` (what the gate does and when, and what a refusal looks like in an answer), and `_agent-docs/next-session.md`.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- Ticket 3.5b's function in `daemon/canary-reading.ts`, which takes a reading of one install and resolves to confirmed, disagreed with each canary's id, what it read and what is named, or no reading with its kind, one of a closed set, and a detail text; it takes no abort signal and never rejects, and its caller takes a reading only while the `Executor` holds no job. This ticket treats every kind of no reading alike and words AC3's reason from the kind and the detail. Also the bundled canary directory `falsify/canary-set.ts` exports.
- `resolveWorkspaceVitest` and `ResolvedVitest` in `vitest/load-vitest.ts`, whose supported member carries the install's directory once 3.5b lands. `inputs/fingerprint.ts` already calls it in the daemon's own process for a workspace's version.
- `FALSIFIER_VERSION` in `falsify/experiment-record.ts`, for AC2's reason.
- `namedList` in `inputs/input-jobs.ts` for a bounded list of names with the number of the rest.
- From ticket 3.5: the mark for a workspace whose job did not run, with its reason and what ends its wait; its entry in the list of jobs that ended with nothing stored; the falsifying activity; the wait on the input revision and the time bound that end a job; and `TrackedInputs.endJob`.
- `DaemonLog.entry` in `daemon/daemon-log.ts`.

### Must Create

- `packages/daemon/src/daemon/canary-gate.ts`, as the task describes.
- The gate as a member of `LifecycleParts`.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this ticket stands

It is at backlog. It was written on 2026-10-01 against ticket 3.5 and ticket 3.5b as their files read, before either was built, and it is corrected against 3.5's built `daemon/falsification.ts` and 3.5b's built `daemon/canary-reading.ts` before it is made ready (orchestrator, 08:12 on 2026-10-01). No ticket review has read it. It builds after 3.5 and 3.5b, and never beside 3.4b, since both write `daemon/lifecycle.ts`.

#### What the criteria rest on

FR23: "Refuse to falsify in a Vitest workspace whose Vitest version RT Test's canary fixtures have not confirmed its run facts against, naming the version and the canary that disagreed." FR11: "Decide each falsification verdict from run facts (failure phase, error kind, whether the intended test reached the step that holds the mutation, the baseline result), counting as a detection only an assertion failure in the intended test after it reached that step, repeated in a confirming run."

ADR-0008: "So RT Test ships canary fixtures, each failing on purpose in one known way, which its own suite checks on both supported Vitest lines. Before a workspace's first falsification in a daemon's life, the daemon runs those canaries under that workspace's Vitest install from its state directory and keeps the reading in memory, one for each install, until it stops; an install whose reading disagrees with any canary is refused falsification, naming the version and the canary." And, rejected there: "trusting these facts on a version no canary has confirmed."

Glossary, verbatim: **Vitest install**: "The Vitest that resolves from a Vitest workspace's directory, told apart by the package's real directory and its version. Several workspaces can resolve one install." **Canary reading**: "What one falsification job over the canary fixtures showed under a Vitest install: confirmed when every canary read the verdict and reason named for it, disagreed with the canaries that did not, or no reading otherwise." **Falsification job**: "One executor job that runs a Vitest workspace's baseline, each of its defects' experiments and the restored baseline in one Vitest instance."

`docs/architecture.md` § What counts as an input: "The inputs are every file under the consumer root except `.git`, `node_modules`, the daemon's state directory and log file", which is why AC6's job moves no input revision.

Ticket 3.5's criteria this ticket builds on, as its file states them: AC4 (a change of the input revision, or a stop, ends a running job, which is aborted and ends within the executor's bound, with nothing stored), AC5 (the job's time bound), AC6 (a workspace whose job did not run gets no further job until the input revision changes), AC7 (a change recorded after a look that sent no job counts as an edit) and AC8 (one entry, marked as a falsification job, for each workspace whose job did not run at the current input revision, its reason saying what happened and what ends the wait). AC4, AC5 and AC6 of this ticket keep requirements 3.5 delivers (FR8, FR15, FR22) and add no marker to them.

The owner's words that bind the design. 03:25 on 2026-09-30: "I only want you to elevate to me if a design decision that is truly broken needs my attention. I'm not terribly interested in chasing edge cases right now. this is tooling for fleet cooling and others going forward". 04:12 on 2026-10-01: "I think the catalog should go. I like asking the simpler question." 04:18: "I like the idea of a trip wire, but if we can do it in a simpler fashion, then let's do it". 04:43: "the deciding factor on whether we should address it is look at Fleet Cooling's codebase. Would this edge case come up in it? If not leave it." 06:29: "i don't mind letting you make design decisions, I just want to avoid the over engineering branch that happened earlier".

#### What a reading costs, measured

From the spike ticket 3.5b records (§ The spike there), at 34d0810f on 2026-10-01: one canary job through a real `Executor` took 13.5 to 18.6 s on Windows, with the executor's start, its close and the removal, and 7.6 to 8.3 s on Linux, on Vitest 5.0.1 and 4.1.11. Fleet Cooling's five workspaces all resolve one install, so one canary job at each daemon start confirms all five.

#### Design decisions (scope of analysis: what the daemon keeps of a reading, when it takes one, when it refuses and what answers say; how the set is placed, run and read is ticket 3.5b's; a store record of a reading is unanalyzed beyond decision 1)

Each stands with doing nothing and one coarser rule beside it.

1. **The reading is kept in the daemon's memory, for its life** (orchestrator, 08:12 on 2026-10-01: "ACCEPTED: the reading is kept in memory, once in a daemon's life for each Vitest install a workspace resolves, and no store record"). Do nothing, the canaries before every job, costs about 10 s on each job for as long as RT Test runs. A store record costs schema version 12, a table, a store module and the composition of `STORE_MIGRATIONS`, to save one canary job at each daemon start, and it would key by a version text, so it would confirm another install, platform or Node line of that version without reading it, and a disagreement stored on a flake would refuse until someone deleted state. In memory, each daemon life reads the install it runs. So this ticket raises no schema version.
2. **Keyed by the install: its real directory and its version.** By workspace would run five canary jobs at Fleet Cooling for one install. By version text alone would let one install's reading stand for another's. The version beside the directory covers an upgrade in place under a layout that keeps one path.
3. **A reading that is confirmed or disagreed is kept; no reading keeps nothing.** Keeping confirmations alone would run the canaries again for each workspace on a refused install at each input revision, five canary jobs a revision at Fleet Cooling's shape, to learn what is already known (C37). A job that gave no reading is tried again at another revision, as every job of ticket 3.5 that did not run is.
4. **The canary job is the look's one job** (ticket 3.5's author, § The seam). An awaited canary job between the look and the send would run inside the window opened for the falsification job, so a change during it would count as that job's own and an event naming an input would waste the job that follows.
5. **Answers name a refusal through ticket 3.5's entry for a workspace whose job did not run** (orchestrator, 08:12: "ACCEPTED ... the lapse is a recorded known limit"). The exact alternative, entries listed from the gate's own memory, adds a second map by workspace, a rule for when an entry leaves, and a dedupe against the mark's entry.
6. **The activity reads falsifying during a canary job.** Do nothing leaves the activity idle while an executor job runs. A state of its own changes `daemon/protocol.ts` and `query/answer.ts` (492 of 500 code lines at f6864910), raises the protocol version a second time in the sprint, and tells a reader nothing it acts on for a job of seconds; the log tells the two apart.
7. **The gate is a part the lifecycle is given.** The lifecycle's tests run a `ScriptedExecutor` over workspaces at paths such as `/consumer/<path>`, where no Vitest resolves, so a gate the lifecycle built for itself would refuse every job those tests send.
8. **A change to the canary set raises `FALSIFIER_VERSION`** (orchestrator, 08:12: "yes"). Evidence stored before the change was confirmed by the set as it was. Ticket 3.5b reports the sentence for `docs/architecture.md`.

#### Known limits (each entry says what a consumer would see and what must coincide)

- While ordinary work is due after an edit, no answer names a refusal until the next look makes the mark again: an author querying in that stretch reads the workspace's definitions as never verified or stale with no entry beside them. It is seen only in a workspace whose Vitest the canaries disagree with, which Fleet Cooling's 4.1.11 is not (orchestrator, 08:12).
- A reading that disagreed through a flake refuses every workspace on that install until the daemon restarts, with the canary named in every entry. It needs a canary to read differently once on an install that reads it as named; this repository's suite runs the set in every gate.
- A Vitest patched in place, at the same directory and version, keeps its reading until the daemon restarts. Fleet Cooling patches no dependency.
- When an install replaces Vitest after a look's gate answered and before the job loads it, that job's evidence is stored under a version with no reading. It needs a Vitest version change to land in `node_modules` in the seconds between the two.
- A workspace on a refused install costs one look at each input revision, to be marked again from memory.
- The readings are kept in memory only, so every daemon start takes one canary job for each install before that install's first falsification job.

#### The seam in ticket 3.5

Ticket 3.5's § Pending siblings, as it read when this ticket was written: "3.6 (backlog) gates the job this ticket starts on its workspace's canary result. Its seam is the point in `falsification.ts` where a job is about to be sent: a refused workspace is one whose job did not run (AC6), with 3.6's reason, and it is handled as a workspace the start no longer confirms is: marked, with the call resolving true, so the next look takes the next workspace's definitions. This ticket builds no gate."

From ticket 3.5's author (rt-t3-5-create-2, threadId 5f016fdc-8e83-4ad6-a530-db07bbde5d27), asked at 08:03 and answered at 08:04 on 2026-10-01, before 3.5 was built:

- The order 3.5 fixes: wait for the inputs to settle; call `worktreeStandings` with a moment that opens the tracker's window (`beginJob`) in the same tick it reads the lifecycle's moment; when it returns, with no await after it, the stop and revision guard; pick the workspace and its definitions; then, only when a job is about to be sent, tell the change record the job began, log, set the activity and send. So the window is already open when the seam is reached.
- The canary job is that call's one job, not an awaited step before the send. As the call's one job, the look's window is closed before the canary job is sent (that close, `inputs.endJob`, is an await, so the stop and the revision are checked again after it), the scheduler plans again after it, and the next look opens a fresh window right before the falsification job.
- The change record is told a job began only when a falsification job is about to be sent, so a canary job tells it nothing, and a change recorded during it lies in no window and is an edit.
- A mark lapses at each change of the input revision, and entries are computed from the marks each time `status()` reads them, so an entry built from a mark is absent from that change until the next look marks the workspace again.
- The module holds the state directory by necessity, since `worktreeStandings` takes it.
- AC4's rule of two jobs in a row is keyed by definition digest, so no canary experiment enters a definition mark. The orchestrator ruled at 07:09 that a case asking for a fourth rule on the queue's protection goes to it as a design question first.

The orchestrator accepted at 08:12 one task sentence for ticket 3.5, a task edit and no criterion, which its author adds: "A workspace's mark holds its reason together with what ends its wait, worded where the mark is made, never one ending appended to every reason." AC2's ending rests on it.

#### Pending siblings

- 3.5 (ready for dev) creates `daemon/falsification.ts` and `daemon/falsification-plan.ts` and writes `daemon/lifecycle.ts`. This ticket builds after it lands and edits the first and the last.
- 3.5b (ready for dev) creates `daemon/canary-reading.ts` and `falsify/canary-set.ts` and gives `ResolvedVitest` the install's directory. This ticket calls all three and edits none.
- 3.4b (backlog) writes `daemon/lifecycle.ts`, `query/summary.ts` and `packages/cli/src/answer-text.ts`, and follows 3.5. It and this ticket both write `daemon/lifecycle.ts`, so they build one after the other.
- 3.7 (backlog) measures the milestone over its corpus on both lines; a daemon that falsifies there takes a canary reading first. 3.8 (backlog) falsifies this repository's own defects through the same gate.

#### Current structure of the modified files

Code lines by `grep -cv '^\s*$\|^\s*//\|^\s*/\?\*' <file>` and records by `grep -c '"file": "packages/daemon/<path>"'` over the `defects.json` files, at f6864910, before ticket 3.5 is built.

- `daemon/daemon-main.ts` (260 lines, 13 records, one of them in `packages/cli/test/defects.json`): builds `new DaemonLifecycle({ identity, scope, start, store, log, executor, buildExecutor, inputs, quietWindowMs, closeEndpoint })`, with `executor: new Executor(log, startEnvironment)`.
- `daemon/lifecycle.ts` (498 lines, 71 records, before ticket 3.5 makes room in it): `LifecycleParts` lists those ten members, each required.
- `daemon/falsification.ts`: created by ticket 3.5.

#### Tests this change may break

- `packages/daemon/test/lifecycle.test.ts` builds `LifecycleParts` in three places, and each needs the gate, which the typecheck finds. Every lifecycle test of ticket 3.5 that expects a falsification job to be sent needs a gate that reads its workspace confirmed.
- A test of a real daemon that falsifies takes a canary job of some seconds before its first falsification job, and needs its workspace to resolve a real Vitest, as `linkVitest` gives one.
- Every record whose mutated file this change edits is proven again by id: the counts are in the section above, and ticket 3.5's records in `daemon/falsification.ts` join them.

#### Sizing

9 raw files and 12 estimated (9 times 1.3, rounded up); code units 6 (five criteria that need code, AC6 needing none, and validation). Under every limit. Production, modified: `daemon/falsification.ts`, `daemon/lifecycle.ts`, `daemon/daemon-main.ts`. Production, created: `daemon/canary-gate.ts`. Tests, for create-tests: `test/lifecycle.test.ts`, `test/scheduling-harness.ts`, `test/defects.json`, and one file for the gate's own tests. This ticket's file. Over 10 estimated, so dev delegates in two groups: the gate; then the seam with the lifecycle and `daemon-main.ts`.

### References

- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.6 and § Ticket 3.5b.
- `_agent-docs/tickets/3-5-schedule-falsification.md`, whose seam this ticket builds on; `_agent-docs/tickets/3-5b-canary-reading.md`, whose reading it keeps, with the spike and Fleet Cooling's facts; `_agent-docs/tickets/3-4-defect-evidence.md` Review Record, on `STORE_MIGRATIONS`.
- `docs/adr/0008-detection-from-task-facts-and-canaries.md`, `docs/adr/0007-reused-instance-per-falsification-job.md`.
- `docs/architecture.md` § Falsification jobs, § Execution and falsification isolation, § Reconciliation and the round of runs, § Holds on self-changing workspaces and discoveries, § What counts as an input, § Query surface.
- `node scripts/list-open-issues.mjs` printed "0 open issues, complete" at 08:03 on 2026-10-01, so no issue bears on this ticket.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C5,C8,C10,C12,C14,C21,C30,C31,C32,C36,C37,C38,C40,C45,C46,C48,C49,C52,C55,C59,C119,C120,C140,C142,C146,C147,C157,C160,C167,C169,C170,C174 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P18,P19,P21,P31,P32,P35,P41 -->

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
sizing_ac_count: 6
files_to_modify:
  - packages/daemon/src/daemon/falsification.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/daemon-main.ts
files_to_create:
  - packages/daemon/src/daemon/canary-gate.ts
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

- `_agent-docs/tickets/3-6-canary-gate.md` (created by create-ticket, a draft at backlog; the planning files that author it and ticket 3.5b are in 3.5b's File List)

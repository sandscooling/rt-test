# Ticket 2.3: Access-time events

## Ticket

As a coding agent querying RT Test instead of running tests,
I want a read that changed nothing about an input to leave a job's result current, and no job to begin while events the daemon has not yet read are queued,
so that a job that ran over unchanged inputs is stored under its fingerprint and reads current, instead of reading unknown until it is rerun for nothing.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: An input event after which the input's content digest, size, modification time and change time all equal what the tracker last read for it, where that read came at least the coarsest timestamp step a supported file system records (`MODIFIED_TIME_RESOLUTION_MS`, 2 s) after both of those times, raises no input revision and marks no running job not fingerprinted. So on Windows, where reading a file whose last-access time is more than an hour old raises a change event that moves only that time, the reads of a reconciliation, of test-module protection and of a job leave every job fingerprinted when nothing else changed. An event after which any of the four differs from the tracker's last read of that input, or that names a path the tracker held no read of (a path test-module protection is reading excepted, per ticket 2.1b), or whose last read came within that step of its modification or change time, marks every running job as ticket 2.1's AC3 states, an edit reverted before the tracker reads the path included.
- [ ] AC2: A job (a discovery, test-module protection's guard, or a run) begins only once every input event the tracker saw before the daemon asked to begin it has been read and no reconciliation is running, so events that turn out to change nothing, such as AC1's, cannot leave it unsettled. The daemon's first discovery after a start on a consumer whose inputs were last read more than an hour earlier is stored fingerprinted when no input changes during it. A job that begins while new events keep arriving is still judged as ticket 2.1's AC3 states, and a stop during the wait still ends the daemon within ticket 1.3's stop bound.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                             | Why it matters if wrong                                                                                                                                | How to check                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| U1  | On Node 22 on Windows, does a last-access update also leave `ctimeMs`, `mtimeMs` and `size` unchanged, as observed under Node 24.19.0? | AC1 compares those four; if Node 22 reported a moved change time, the event would still mark the job there, which is the behavior today and errs safe. | Run the probe in Dev Notes § Settled facts under Node 22.13 on Windows. |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing, and write each answer with the source location or observed output beneath the table.
- [ ] (AC1) In `packages/daemon/src/inputs/input-inventory.ts` `readEntryDigest`, return beside an input's digest the size, modification time and change time of what it hashed (the `lstat` it already takes, or the `stat` through the link for a link to a file), and carry them through `takeInventory`'s result, so a reconciliation and an event read record the same facts.
- [ ] (AC1) In `packages/daemon/src/inputs/input-state.ts`, keep those three beside each input's digest, set by `establish`, `set` and `replaceUnder` alike and dropped with the input by `remove`, without changing when the revision rises (a digest change only), and without adding them to `project()` or to anything the input fingerprint is computed from. Record, per input, when the tracker last read it.
- [ ] (AC1) In `packages/daemon/src/inputs/input-tracker.ts` `#readFile`, record the path against the running jobs only when the input was not held, its digest or one of the three differs from what the state held, or its last read came less than `MODIFIED_TIME_RESOLUTION_MS` after its held modification or change time. That constant has two readers now, so move it from `fingerprint.ts` to `input-inventory.ts`, which both already import (C4). A path protection queued (`#quiet`) keeps recording nothing, as today.
- [ ] (AC2) Give `TrackedInputs` (`input-tracker.ts`) a method that resolves once every event accepted before the call has been read and no reconciliation runs, and at once after a stop (`EventLedger.waitForRead`, which `endJob` already uses), and have `packages/daemon/src/daemon/lifecycle.ts` await it before each `beginJob` (confirm with `rg -n "beginJob\(" packages/*/src` that these three are its only callers): the discovery's in `#startSequence`, the guard's in `#protectDiscovered`, and each run's in `#run`. Keep `#startSequence`'s stop check after the wait, and have `#protectDiscovered` and `#run` likewise return without calling `beginJob` when the wait resolved because of a stop.
- [ ] (Support) Report the exact `docs/architecture.md` text to the orchestrator (orchestrator-owned; C48, C55): in the input tracker paragraph, the sentence "A job is stored under the fingerprint it started from only when no input changed and no event named one while it ran" gains AC1's exception and AC2's wait, and the known limits gain "a write that restores an input's content, modification time and change time while a job runs".
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `readEntryDigest`'s `lstat` (`packages/daemon/src/inputs/input-inventory.ts`): the stat AC1 compares is already taken for every entry it reads.
- `InputState.set` (`packages/daemon/src/inputs/input-state.ts`): already raises the revision only on a digest change.
- `EventLedger.waitForRead` (`packages/daemon/src/inputs/input-jobs.ts`): waits only for events accepted before the call and for a running reconciliation, and `releaseAll` frees it on stop; `endJob` already uses it.
- `JobWindows.open` and `close` (`input-jobs.ts`): unchanged; AC2 only moves when `open` is called.

### Must Create

- The per-input stat facts' type, beside `InputDigests`, and the `TrackedInputs` method AC2 adds.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The owner split the original ticket 2.3 (schedule and run selections) at 18:47 on 2026-09-27, and the orchestrator split its first part again at 19:01, into 2.3 to 2.3f (sprint file, after § Ticket 2.3f). This ticket builds first and alone: it changes only how the input tracker judges an event and when the lifecycle begins a job. 2.3b to 2.3d make discovery report selection facts, protect them from declared patterns and widen selection on aliases; 2.3e narrows each workspace's inputs; 2.3f schedules and runs selections, and its scheduler keeps AC2's wait in whatever begins a job.

Requirement this ticket serves (`docs/requirements.md`):

- FR6: "Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current." AC1 and AC2 narrow what counts as an edit to what changed an input, and keep every edit counted. It also serves NFR3, "Never report a result as current unless its stored input fingerprint matches the current inputs", which AC1 leaves intact, since the digest still decides the fingerprint.

Clauses the criteria rest on:

- Sprint 2 § Ticket 2.3: "an input event that leaves an input's content, size, modification time and change time as the tracker last read them, such as the last-access update Windows raises when a read touches a file untouched for an hour, marks no job and raises no revision, and a job begins only once the events queued before it are read (orchestrator, 2026-09-27 18:46)." (AC1, AC2)
- Ticket 2.1 AC3: "A job during which any input changed, which started before the first reconciliation ended, during which a reconciliation ended unable to establish the input set (AC7), or during which the watcher was unhealthy, is stored not fingerprinted, so none of its results can read current, and the daemon's log names the job and the inputs that changed, or the reason. A reconciliation that runs during a job and finds no change leaves the job fingerprinted". (AC1, AC2)
- Ticket 2.1 § Design notes, "A job's fingerprint": "Any event naming an input during the job also marks it not fingerprinted, even when the rehash finds the content unchanged, since an edit reverted before its rehash leaves the revision equal although the job read the edited file." AC1 keeps this guard: an edit and a revert move the modification and change times even when the content returns (§ Settled facts).
- Ticket 2.1b § Owner rulings, 15:49: "protection must not count as an input change against the discovery's own job." AC1 extends the same outcome to reads whose only effect is an access-time event.
- Ticket 2.1 AC10: "a stop during one ends the daemon within 1.3's stop bound." (AC2's last sentence)
- Glossary: **Input** "A file whose edit RT Test treats as able to change a test's result." **Input revision** "The number naming a worktree's inputs as the daemon last observed them in its current life, raised once for each batch of changes it observes."

#### Owner and orchestrator rulings

Every question went to the orchestrator by `session_wake` (crew.md § Questions).

- The access-time decision, dispatched to this ticket by the orchestrator (dispatch, 18:35): decide whether an event that changes only the access time taints a job. Asked 18:45 with the evidence below; orchestrator ruling 18:46: accepted as recommended. "An event after which the input's content digest, size, mtime and ctime all equal the tracker's last read marks no job and raises no revision. A job, the start sequence's discovery included, begins only after the events queued before it are read. Record the residual (a write restoring content, mtime and ctime) as a named known limit. Reason: an edit then revert still moves ctime, so 2.1's reverted-edit guard holds. Restoring ctime needs a Windows-only API call and is impossible on Linux. Meanwhile today's behavior stores every first discovery after an idle start not fingerprinted, which defeats the freshness the product promises." (AC1, AC2)
- The two-second bar, create-ticket at 19:04 on the ticket review's F8: the review found that an edit and its revert within one timestamp tick of the tracker's last read would leave all four facts equal, a hole in 2.1's reverted-edit guard that the 18:46 ruling's own reason says must hold, on Linux too, where no access-time event exists to justify it. AC1 therefore exempts an event only when the tracker's last read came at least `MODIFIED_TIME_RESOLUTION_MS` (2 s) after the input's modification and change times. That narrows the ruling's exception toward more marking and leaves its case, a file untouched for an hour, exempt. Reported to the orchestrator with this ticket.
- Split, owner 18:47 then orchestrator 19:01: this ticket holds only the access-time criteria; the selection facts, their protection and the alias widening went to 2.3b, 2.3c and 2.3d with their rulings (G1, G2 and G3 at 18:59, the `picomatch` and schema rulings at 18:46), which the sprint file carries under those headings.

#### Settled facts

- **Why a read marks a job today.** `input-tracker.ts` `#readFile(filter, path, digest, record)` calls `this.#state.set(relative, digest)` and then `record([relative])` for every event it reads on an input, and `#readPath` passes every recorded path to `JobWindows.record`, whatever the digest. `InputState.set` marks a change only when the digest differs, so the revision already rises only on a real change; only the job marking is not. `#startSequence` in `lifecycle.ts` calls `inputs.beginJob()` right after `await inputs.firstReconciled()`, and `JobWindows.open` takes the tracker's unavailable reason, which is set while any changed path is unread (`#unavailableReason`: `${pending} changed paths have not been read yet`), so a job begun then closes as "its inputs were unsettled when it started".
- **The 2.1b probes**, quoted from the 2.1b tests session's `d1988-probe.mjs` and `pending-probe.mjs` (run in `wt-1` on 2026-09-27 at 16:06 and 16:42; the D1988 diagnosis in ticket 2.1b's Tests Record explains them):
  - `d1988-probe-1.log`, an edit that set the module's access time 60 s ahead: `"guardJob": { "fingerprinted": false, "reason": "its inputs changed while it ran: src/a.test.ts" }`. Protection's read of the module updated its access time, and Windows raised a change event on the newly protected path during the guard job.
  - `d1988-probe-2-1.log`, `-2-2.log` and `-2-3.log`, an edit moving only the modification time: `"guardJob": { "fingerprinted": true }`, 3 runs of 3.
  - `probe-1.log`, three runs each of a tree whose module's times were set an hour back: with no `rt-test.json`, `{"withDeclaration":false,"pendingAtOnce":2,"pendingLater":0,"entries":["input reconciliation started: the daemon started","input reconciliation ended: 1 inputs, 0 changed, revision 0","non-inputs: none, since there is no rt-test.json"]}`; with `src/**` declared, so the module is not read, `{"withDeclaration":true,"pendingAtOnce":1,"pendingLater":0,...}`. The first reconciliation's own read queued an event, and events were still pending when `firstReconciled()` resolved (`pendingAtOnce`), all read 200 ms later (`pendingLater`). So on this machine the first discovery after a start on a tree idle for over an hour is stored not fingerprinted (AC2).
- **What a last-access update moves**, from this session's `atime-probe.mjs` (18:38 to 18:39 on 2026-09-27). The probe creates a file, sets both its times back with `utimesSync`, opens `fs.watch` on the real path of its directory (recursive on Windows), reads the file once with `readFileSync`, waits 1.5 s, and compares `statSync` before and after; a third case writes new content, writes the old content back, and restores both times with `utimesSync`.
  - Windows 11, Node 24.19.0, libuv 1.52.1; `reg query` gives `NtfsDisableLastAccessUpdate REG_DWORD 0x80000002` and `fsutil behavior query disablelastaccess` gives "DisableLastAccess = 2 (System Managed, Last Access Time Updates ENABLED)": `{"label":"read, atime 2 h old","events":["change a.ts"],"moved":["atimeMs"]}`; `{"label":"read, atime 10 min old","events":[],"moved":["atimeMs"]}`; `{"label":"edit, revert, mtime restored","moved":["ctimeMs"]}`.
  - WSL Ubuntu, Node 24.13.1, libuv 1.51.0, the temporary directory mounted `rw,relatime`: `"events":[]` for both reads, and `"moved":["ctimeMs"]` for the restoring write. Linux raises no event for an access-time update.
  - So the content digest, size, modification time and change time together tell a last-access event from any write that lands in a later timestamp tick than the tracker's last read of the path, a restoring one included. The probes did not measure timestamp granularity: an edit and its revert within one tick of that read would leave all four equal, which is why AC1 applies only to a read at least `MODIFIED_TIME_RESOLUTION_MS` (2 s, `inputs/fingerprint.ts`, FAT's step and the coarsest a supported file system records) after the input's modification and change times. A last-access event on a file untouched for an hour clears that bar by far.

#### Design notes

- **AC1 compares with the tracker's last read, not with the job's start.** A job that read an edited file is still marked when an edit and a revert both land before the tracker reads the path, since both move the modification and change times. The reads that feed the comparison are the reconciliation's inventory and each event read, so both must record the same three facts.
- **A path the tracker held no read of** (a new file, or an input a reconciliation could not read) always marks the jobs running, as today.
- **AC2's wait** is 2.1's `EventLedger.waitForRead`, which waits only for events accepted before it was called and for a running reconciliation, so a continuous writer cannot hold a job's start forever; a job that starts while events keep coming is then judged as today. A stop releases the wait through `EventLedger.releaseAll`, which `InputTracker.stop` already calls.
- **Known limit this ticket adds**, for `docs/architecture.md`: a write that restores an input's content, modification time and change time while a job runs is not seen as a change, once the tracker's last read of it came at least 2 s after those times. An edit and its revert within one timestamp tick are covered by that bar. The change time cannot be set on Linux; on Windows only through `SetFileInformationByHandle`.
- **Unanalyzed:** a file system whose change time does not move on a write (some network and FUSE file systems); there the modification time and the digest still decide, as today's revision does. A directory's access-time event, which `#readPath` already ignores for a directory it holds.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3` over the target files printed "unbuilt-work: clean" (18:57, over the unsplit part's 21 paths, which hold these four).

- **2.3b** to **2.3d** (backlog) build after this ticket and edit `input-tracker.ts` and `lifecycle.ts` too (2.3c); sequential, by the 19:01 ruling.
- **2.3f** (backlog) replaces the start sequence with a scheduler, which keeps AC2's wait before each job it begins.
- **2.4** binds `wait` to the input revision, which AC1 leaves unraised by an access-time event, as today; **2.5** measures NFR1, which AC1 serves by removing reruns for nothing.

#### Sizing

About 9 raw files, about 12 estimated, and 3 code units (2 criteria plus validation). Production: `inputs/input-inventory.ts`, `inputs/fingerprint.ts` (its time-step constant moves out), `inputs/input-state.ts`, `inputs/input-tracker.ts`, `daemon/lifecycle.ts`, plus `docs/architecture.md` as reported text. Tests, for create-tests, as the next section lists. No delegation: the work is one chain through the tracker, which delegation would only split across a shared contract.

#### Current structure of the modified files

- `packages/daemon/src/inputs/input-inventory.ts`: `InputDigests` is `ReadonlyMap<string, string>` (path to digest); `EntryDigest` is `{ kind: "input", digest } | { kind: "directory" } | { kind: "absent" } | { kind: "unreadable", reason }`; `readEntryDigest(path, signal)` `lstat`s the path, then hashes a file, reads a link through `stat`, and gives a FIFO, socket or device a digest of its type; `takeInventory(scope, start)` returns `{ ok: true, inputs, directories, ignoredDirectories } | { ok: false, reason }`.
- `packages/daemon/src/inputs/input-state.ts`: `InputState` holds `#inputs: Map<string, string>`, the directories, the revision and a `#changed` flag; `establish` replaces every input and returns the paths whose digest changed; `set(path, digest)` marks a change only when the digest differs; `remove`, `replaceUnder`, `commit` (raises the revision once when anything changed) and `project()`.
- `packages/daemon/src/inputs/input-tracker.ts`: `TrackedInputs` `{ start, firstReconciled, current, beginJob, endJob, protectTestModules, stop }`; `endJob` awaits `this.#ledger.waitForRead()` unless stopped; `#readPath` builds `record` as a no-op for a path in `#quiet` and otherwise as `#recordAll`; `#readFile` sets the digest and records the path.
- `packages/daemon/src/daemon/lifecycle.ts`: `#startSequence` awaits `inputs.firstReconciled()`, returns when stopping, then calls `inputs.beginJob()` before `executor.discover(start)`; `#protectDiscovered` calls `inputs.beginJob()` for the guard before `protectTestModules`; `#run` calls `inputs.beginJob()` before each `executor.run`.

#### Existing tests this change breaks

Found by `rg -l` over `packages/*/test` and `test` for `TrackedInputs`, `InputState`, `readEntryDigest`, `EntryDigest`, `InputDigests` and `takeInventory` (19:02), each match read by symbol.

- `packages/daemon/test/lifecycle.test.ts`: its stand-in `TrackedInputs` (`StandInInputs`) must implement AC2's method; tests that count or order `beginJob` calls against a held reconciliation may move.
- `packages/daemon/test/input-tracker.test.ts`: it reads `readEntryDigest` or `takeInventory` results, which gain the added facts. No test there asserts that an event with unchanged content marks a job (`grep -i` for "revert", "same content" and "unchanged content" found none), and every edit a test makes through `writeFileSync` moves the modification time, so AC1 changes no verdict a test expects; unanalyzed beyond that until run.
- `packages/daemon/test/defects.json`: any record whose `old` lies on a line this ticket changes; by `file`, records anchor in `lifecycle.ts` (37), `input-tracker.ts` (21), `input-inventory.ts` (4) and `input-state.ts` (2), among them D1888 on `#readFile`'s `this.#state.set(relative, digest)`.

#### Previous ticket

2.2b (done) is the nearest earlier key in the status file; 2.1b (done, landed at 0eeb86e, review debt at 9e29cb9) built the lines this ticket changes. From 2.1: a job is judged by its change window, and every event naming an input marks it, the guard AC1 narrows. From 2.1b: protection's reads mark no job (`#quiet`), and the D1988 diagnosis traced a masked mutant to an access-time event; D1988's edit now moves only the modification time. From 9e29cb9: `readJson` reports a failed read apart from invalid JSON; nothing here reads JSON.

### References

- Ticket 2.1 (`_agent-docs/tickets/2-1-track-inputs.md`) AC3, AC10 and § Design notes "A job's fingerprint".
- Ticket 2.1b (`_agent-docs/tickets/2-1b-declared-non-inputs.md`) § Owner rulings (15:49) and its Tests Record's D1988 diagnosis (16:42).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (18:42).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C8,C10,C30,C38,C41,C46,C48,C55,C113,C115,C116,C157 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P16,P17,P18,P19,P21 -->

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
sizing_ac_count: 3
files_to_modify:
  - packages/daemon/src/inputs/input-inventory.ts
  - packages/daemon/src/inputs/fingerprint.ts
  - packages/daemon/src/inputs/input-state.ts
  - packages/daemon/src/inputs/input-tracker.ts
  - packages/daemon/src/daemon/lifecycle.ts
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

- `_agent-docs/tickets/2-3-access-time-events.md` (create-ticket)
- `_agent-docs/sprints/sprint-2-fresh-runs.md` and `_agent-docs/sprint-status.yaml` (create-ticket, the split into 2.3 to 2.3f under the 18:47 and 19:01 grants)

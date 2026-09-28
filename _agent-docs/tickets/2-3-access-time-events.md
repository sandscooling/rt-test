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

- [x] AC1: An input event after which the input's content digest, size, modification time and change time all equal the tracker's last read of it taken before the event arrived (a read taken while an event naming the path is unread, such as a reconciliation's or a directory walk's, never becomes the one events are compared with, and a whole walk that finds any of the four moved keeps the earlier read), where that read came at least the coarsest timestamp step a supported file system records (`MODIFIED_TIME_RESOLUTION_MS`, 2 s) after both of those times, raises no input revision and marks no running job not fingerprinted. So on Windows, where reading a file whose last-access time is more than an hour old raises a change event that moves only that time, the reads of a reconciliation, of test-module protection and of a job leave every job fingerprinted when nothing else changed. An event after which any of the four differs from that read, or that names a path the tracker held no read of (a path test-module protection is reading excepted, per ticket 2.1b), or whose last read came within that step of its modification or change time, marks every running job as ticket 2.1's AC3 states, an edit reverted before the tracker reads the path included.
- [x] AC2: A job (a discovery, test-module protection's guard, or a run) begins only once every input event the tracker saw before the daemon asked to begin it has been read and no reconciliation is running, so events that turn out to change nothing, such as AC1's, cannot leave it unsettled. The daemon's first discovery after a start on a consumer whose inputs were last read more than an hour earlier is stored fingerprinted when no input changes during it. A job that begins while new events keep arriving is still judged as ticket 2.1's AC3 states, and a stop during the wait still ends the daemon within ticket 1.3's stop bound.

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

**Resolutions (dev, 2026-09-27 19:10):**

- **U1 CONFIRMED.** The official `node-v22.13.0-win-x64.zip` (SHA-256 `b0feb09e...8429`, matching nodejs.org's `SHASUMS256.txt`) ran a rewrite of the Dev Notes probe (`atime-probe.mjs`: `utimesSync` both times back, recursive `fs.watch` on the real temp directory, one `readFileSync`, 1.5 s wait, `statSync` compared on `size`, `atimeMs`, `mtimeMs` and `ctimeMs`) on this Windows 11 machine. Output under `v22.13.0 libuv 1.49.2`, 2 runs of 2: `{"label":"read, atime 2 h old","events":["change a.ts"],"moved":["atimeMs"]}`, `{"label":"read, atime 10 min old","events":[],"moved":["atimeMs"]}`, `{"label":"edit, revert, mtime restored",...,"moved":["ctimeMs"]}`. The Node 24.19.0 (libuv 1.52.1) control printed the same three lines. The binary and probe were deleted after.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing, and write each answer with the source location or observed output beneath the table.
- [x] (AC1) In `packages/daemon/src/inputs/input-inventory.ts` `readEntryDigest`, return beside an input's digest the size, modification time and change time of what it hashed (the `lstat` it already takes, or the `stat` through the link for a link to a file), and carry them through `takeInventory`'s result, so a reconciliation and an event read record the same facts.
- [x] (AC1) In `packages/daemon/src/inputs/input-state.ts`, keep those three beside each input's digest, set by `establish`, `set` and `replaceUnder` alike and dropped with the input by `remove`, without changing when the revision rises (a digest change only), and without adding them to `project()` or to anything the input fingerprint is computed from. Record, per input, when the tracker last read it.
- [x] (AC1) In `packages/daemon/src/inputs/input-tracker.ts` `#readFile`, record the path against the running jobs only when the input was not held, its digest or one of the three differs from what the state held, or its last read came less than `MODIFIED_TIME_RESOLUTION_MS` after its held modification or change time. That constant has two readers now, so move it from `fingerprint.ts` to `input-inventory.ts`, which both already import (C4). A path protection queued (`#quiet`) keeps recording nothing, as today.
- [x] (AC2) Give `TrackedInputs` (`input-tracker.ts`) a method that resolves once every event accepted before the call has been read and no reconciliation runs, and at once after a stop (`EventLedger.waitForRead`, which `endJob` already uses), and have `packages/daemon/src/daemon/lifecycle.ts` await it before each `beginJob` (confirm with `rg -n "beginJob\(" packages/*/src` that these three are its only callers): the discovery's in `#startSequence`, the guard's in `#protectDiscovered`, and each run's in `#run`. Keep `#startSequence`'s stop check after the wait, and have `#protectDiscovered` and `#run` likewise return without calling `beginJob` when the wait resolved because of a stop.
- [x] (Support) Report the exact `docs/architecture.md` text to the orchestrator (orchestrator-owned; C48, C55): in the input tracker paragraph, the sentence "A job is stored under the fingerprint it started from only when no input changed and no event named one while it ran" gains AC1's exception and AC2's wait, and the known limits gain "a write that restores an input's content, modification time and change time while a job runs".
- [x] (Support) Lint and typecheck.

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
- The two-second bar, create-ticket at 19:04 on the ticket review's F8: the review found that an edit and its revert within one timestamp tick of the tracker's last read would leave all four facts equal, a hole in 2.1's reverted-edit guard that the 18:46 ruling's own reason says must hold, on Linux too, where no access-time event exists to justify it. AC1 therefore exempts an event only when the tracker's last read came at least `MODIFIED_TIME_RESOLUTION_MS` (2 s) after the input's modification and change times. That narrows the ruling's exception toward more marking and leaves its case, a file untouched for an hour, exempt. Reported to the orchestrator with this ticket; orchestrator ruling 19:07: accepted.
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

- **AC1 compares with the tracker's last read, not with the job's start.** A job that read an edited file is still marked when an edit and a revert both land before the tracker reads the path, since both move the modification and change times. The reads that feed the comparison are the reconciliation's inventory and each event read, so both must record the same three facts. A read taken while an event on the path is still unread (a reconciliation runs with the queue held, and a directory walk) may postdate a write the queued event reports, so it never replaces the read the event is judged against; a whole walk that finds the content unchanged but the size or a time moved keeps the earlier read too (sanity check, rt-t2-3-dev, 19:21). Keeping a read refreshed by a walk that finds all four unchanged and no event unread is what lets a file edited in this daemon life reach AC1's case an hour later.
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

Dev session: threadId 02e49f18-8776-4df3-8493-f25e6a081ca7

#### Test Files This Change Broke

- `packages/daemon/test/lifecycle.test.ts`: `StandInInputs` no longer implements `TrackedInputs`, which gained `settled(): Promise<void>` (`bun run --filter @rt-test/daemon typecheck`: TS2420 at 316 and TS2741 at 402, the workspace's only 2 errors). A stand-in that resolves at once keeps today's ordering; a test holding a reconciliation may want it to hold too.
- `packages/daemon/test/defects.json`: 4 records whose `old` no longer matches once (checked by string count over all 510 records): D1888 and D1998 in `input-tracker.ts` (`#readFile`'s `this.#state.set(relative, digest)` became `if (this.#state.set(relative, read)) record([relative]);`, and `current()` moved to `inputs/current-inputs.ts`), D1953 and D1988 in `lifecycle.ts` (the `settled()` wait now sits between `testModuleChangedSince` and the guard's `beginJob`, and before each `beginJob`).
- `packages/daemon/test/input-tracker.test.ts`: none by type (it reads only `readEntryDigest(...).kind`), but `EntryDigest`'s input arm is now `{ kind: "input", read: { digest, stamp } }` and `InputState.establish` takes a third argument, so any runtime reading `.digest` off an entry moves.

#### ACs Owed a Test

- AC1: an input event whose read finds digest, size, mtime and ctime equal to the held read, taken at least 2 s after both times, marks no running job and raises no revision; any difference, a path not held, or a held read within 2 s of those times marks every running job. Only a test with a real watcher shows it (a Windows last-access event, or a planted `readEntryDigest` result on either OS).
- AC1, the reverted edit through a whole walk: an edit and revert while a reconciliation runs, read by the inventory at least 2 s after the revert, still marks the running job when its queued event is read (`keptReads` in `input-state.ts`).
- AC1, a link to a file: retargeting a link to another file and back marks the running job (the stamp takes the later of the link's and the file's times).
- AC2: each of the three `beginJob` calls in `lifecycle.ts` runs only after `inputs.settled()` resolves; a stop during that wait ends the sequence without beginning the job; the first discovery after a start on a tree idle over an hour is stored fingerprinted on Windows.

#### Tests Owed

None beyond the criteria above.

### Tests Record

Tests session: threadId 9e49a9fd-0678-4dd3-86af-bb87e07f9f1c

#### Named Defects

- D2065: Every event read of an input marks the running jobs, so a last-access event on a file untouched for an hour leaves a job not fingerprinted. (AC1)
- D2066: A read whose content digest alone differs from the held read counts as unmoved, so an edit on a file system whose times do not move marks no job. (AC1)
- D2067: A read whose modification time alone differs from the held read counts as unmoved, so the job is not marked. (AC1)
- D2068: A read whose change time alone differs from the held read counts as unmoved, so an edit reverted with its modification time restored marks no job. (AC1)
- D2069: A read records the input's modification time as its change time, so an edit reverted with its modification time restored reads as unmoved and marks no job. (AC1)
- D2070: An event naming a path the tracker held no read of marks no job, so a file created during a job leaves it fingerprinted. (AC1)
- D2071: A held read taken 1999 ms after the input's last write counts as clear of the 2 s timestamp step, so an event with nothing moved marks no job. (AC1)
- D2072: A held read taken exactly 2000 ms after the input's last write does not count as clear of the timestamp step, so an event with nothing moved still marks the job. (AC1)
- D2073: The 2 s bar is measured from the modification time alone, so an input whose modification time was restored but whose change time is recent is exempted. (AC1)
- D2074: The 2 s bar is measured from the change time alone, so an input whose modification time lies after the held read is exempted. (AC1)
- D2075: A reconciliation's read replaces the held read while an event naming the input is unread, so that event is judged against a read that may postdate its write. (AC1)
- D2076: A reconciliation that finds an input's times moved and its content unchanged replaces the held read, so a later event is judged against a read taken after the write. (AC1)
- D2077: A directory walk replaces the held reads of the inputs it finds unmoved, though an event on them may be unread, so that event is judged against the walk's read. (AC1)
- D2078: A reconciliation that finds an input's content changed keeps the held read, so the fingerprint is computed from the old digest. (AC1)
- D2079: A link to a file is stamped with its target's times alone, so a retarget to another file and back reads as unmoved and marks no job. (AC1)
- D2080: The discovery's job begins as soon as the first reconciliation ends, before the events it left unread are read. (AC2)
- D2081: The guard around protecting the discovery's test modules begins without waiting for the inputs to settle. (AC2)
- D2082: A run's job begins without waiting for the inputs to settle. (AC2)
- D2083: A stop that arrives while the guard waits for the inputs to settle is followed by the guard's job. (AC2)
- D2084: A stop that arrives while a run waits for the inputs to settle is followed by the run. (AC2)
- D2085: A wait for the inputs to settle begun after the tracker stopped waits on events no one will read, so it never resolves. (AC2)
- D2086: The tracker's wait for the inputs to settle resolves at once, so the discovery begins while the first reconciliation's events are unread and is stored not fingerprinted. (AC2; the Windows hour-idle start, proven on either host by an event the test's `fs.watch` wrapper delivers as the first reconciliation ends)
- D2088: A run sets its activity only after the inputs settle, so a status during that wait does not name the workspace about to run. (AC2)

- D2090: The check for test modules no watch covers runs before the guard's wait for the inputs to settle, so a declared module edited during that wait is read by protection without marking a job, and the discovery is stored under a digest. (AC2, review gap G1)
- D2091: A directory walk counts only a changed digest, so a directory replaced by a copy with the same content and other times marks no running job. (AC1, review gap G2)
- D2092: The start sequence checks for a stop before waiting for the inputs to settle, so a stop arriving during that wait is followed by the discovery. (AC2, review gap G3)
- Review gap G4: D2086 now records whether its change event was delivered through the root's watch and asserts that together with the stored fingerprint kind, so a missing watch fails it rather than passing as a start with no events.
- D2069 and D2079, Linux intermittent (the merged check under Node 24 in WSL failed D2069's baseline once, 21:45): the test's premise, not a product hole. Kernel 6.6 (CONFIG_HZ=250) stamps change times from a 4 ms coarse clock, and back-to-back edit, revert and restore left the change time unmoved in 183 of 200 probe rounds. The tests fake the held read as an hour after the file's last write, while the real edit follows within milliseconds, so one coarse tick can give the revert the held read's change time, which no real read 2 s after that time could see. Each test's edit now repeats until `statSync` or `lstatSync` shows the change time moved; that is an observable, not a timer. Proof: 40 of 40 loaded runs of both tests in WSL under Node 24, and `node scripts/verify-defects.mjs --changed` there, 93 of 93 detected (21:52). Product: a real exemption needs the read 2 s after the change time, while the widest real gap between two writes sharing a change time was 3.1 ms under 32 CPU spinners on 16 cores, so a coarse clock opens no hole (owner timebox, 21:49).
- D1906, Windows intermittent (the merged check on 303c80d, 22:04, reported its mutant as surviving): the test accepted any reconciliation, and the tracker watches the user's global `~/.gitconfig`. On Windows, a git read of a file whose access time is over an hour old raises a change event, and a throwaway test showed one git read of such a `.gitconfig`, with no `.gitignore` edit, starting "…\.gitconfig, which can move HEAD or change what git ignores, changed", which the old wait accepted. D1906 now asserts the reason only its trigger logs, and D1905, D1906, D1922, D1923, D1924, D1949 and D1951 run through `trackingOwnGitHome`, which points HOME and XDG_CONFIG_HOME at an empty directory. Proof: the seven passed 10 of 10 runs on Windows, and `bun run test:defects:changed` detected 93 of 93 (22:10).
- After the review's fixes R1 and R2: D1988 and D2083 re-anchored to `#protectDiscovered`'s new order, with the wait and stop check ahead of the unwatched-module check.

Existing records this change moved or retired, re-proven:

- Re-anchored to the moved code: D1888 (`#readFile`'s conditional record), D1953 (the stop check after `settled()`), D1988 (the settle wait before the guard) and D1998 (now in `current-inputs.ts`).
- D1460: its mutation dropped the start sequence's loop `break`, which `#run`'s new post-wait stop check (D2084) now also guards, so it was re-targeted to `isStopping()` returning false. The test is unchanged. (orchestrator, 19:49)
- D1766 retired, its test and record removed (orchestrator, 19:49). With `isStopping()` false, the start sequence's extra `await inputs.settled()` lets `daemon-main.ts`'s `await lifecycle.stopped(); process.exit()` win the microtask race, so no single mutation makes discovery start after a stop. D1953 proves the start sequence's post-wait stop check. `daemon-main.ts`'s begin guard (`if (!lifecycle.isStopping()) lifecycle.begin();`) now has no named test of its own. The start sequence's check makes it redundant for discovery, and a `begin` after a stop leaves nothing a test can observe deterministically.
- D1897 repaired, not re-targeted: its file is now modified an hour ahead of every read. Under AC1 an event on a file whose last read came 2 s after its write marks nothing, so a loaded run could otherwise pass the job as fingerprinted.
- D1987 and D1988 now run over the real `InputTracker`; `SettledTracker`, which waited out unread events itself, was removed because AC2's wait does that in the lifecycle.
- State at the 19:54 harness pause: D1766's retirement and D1460's re-target are both done. `bun run test:defects:changed` ended before the pause (19:49 to 19:54, exit 0, 233/233 detected, baseline green before and after), so no re-run is owed.
- AC2's clause that a job begun while events keep arriving is still judged as 2.1's AC3 states: D1897 covers it, since `endJob` now waits through `settled()`, whose bound it proves.

#### Deliberately Untested

- `packages/daemon/src/inputs/input-inventory.ts` `readEntryDigest`'s `readAtMs`, taken before the `lstat`: a later instant is observable only through a write landing inside one read, which no seam can place.
- `packages/daemon/src/inputs/input-state.ts` `unmoved`'s size comparison, and `stampOf`'s `size` and `modifiedMs`: inert, since a size cannot differ while the digest matches for a file, a link to a file or a special type, and no file system moves a modification time without the change time.
- `packages/daemon/src/inputs/current-inputs.ts` beyond D1998: a move of `current()`'s body, whose branches the existing tracker and query tests reach unchanged.
- `packages/daemon/src/inputs/fingerprint.ts`: only `MODIFIED_TIME_RESOLUTION_MS` moved out; no behavior changed.

### Review Record

Review session: threadId 009f44c2-1973-4d70-9ce7-f79820445d9c (rt-t2-3-review, 2026-09-27 20:07 to 20:19)

Findings fixed in this review:

- R1 (HIGH, `consumer`, reach unknown) `lifecycle.ts` `#protectDiscovered`: the unwatched test-module check ran before the guard's new `settled()` wait. A declared module no watch covers, edited during that wait, raises no event; protection's quiet read then puts the edited content in the inputs, and the discovery is stored under a digest of content it was not collected from. Fixed: the check now runs after the wait and its stop check, directly before `beginJob`, so nothing but synchronous code lies between it and `protectTestModules`, which D1988 requires.
- R2 (CRITICAL, `consumer`, reach unknown; digest-only counting predates this ticket, AC1 claims the case) `input-state.ts` `replaceUnder`: a directory walk counted only a changed digest. A directory replaced by a rename with identical bytes but moved times, both moves landing before the tracker reads it, marked no running job, though the job may have read the path while it was missing, and no per-file event follows to judge against the kept read. Fixed: the walk also returns each input whose content is unchanged but which the held read cannot rule a write out of (`unrestedPaths`, the same `restedSince` test an event read takes), so the running jobs are marked; the revision still rises on a digest change only.

Orchestrator rulings on this review: R1 and R2 accepted as fixes within the ticket, R2 because AC1 claims the case (20:20); D2090 to D2092 allocated to the tests session (20:20); the seven doc findings applied, 2.3e's scope restored to the 01:27 ruling's wording, the FR3, FR6, FR7 and NFR3 markers relinked to the split's tickets, and the guard rule added as C160 (20:42).

Tech debt, for triage after the commit:

- T1 (pre-existing, 2.1's design) `input-tracker.ts` `endJob`: after its wait it closes with `#unavailableReason()`, which counts events accepted after the call, and `#drainQueue` starts the next batch before `endJob`'s continuation runs. A job whose own reads raise last-access events still arriving at its end is stored not fingerprinted. Errs safe; reach unknown.
- T2 (pre-existing coverage) `fingerprint.ts` `testModuleChangedSince`: no named defect mutates its `since - MODIFIED_TIME_RESOLUTION_MS` margin (D1898 edits after `since`, so it passes without the margin) or its `modified === undefined` branch (a module deleted during the job).
- T3 (pre-existing, left untested by D1766's retirement) `daemon-main.ts`'s begin guard: moving it into `DaemonLifecycle.begin` as its first line would make it testable in `lifecycle.test.ts` (a `begin` after `stop` starts no inputs and reads no store); without the guard, a late `begin` reads a store the stop sequence closed.
- T4 (pre-existing coverage) `lifecycle.ts` `#startSequence`'s loop `break` on a stop: no defect mutates it alone since D1460's re-target; without it, a later workspace missing from the confirmed start is listed unstored as unconfirmed after a stop.
- T5 (pre-existing) `input-inventory.ts` `linkDigest`: a chain of links stamps only the first link and the final file, so retargeting a middle link and restoring it moves no compared time.
- T6 (dev's F3) `fingerprint.ts` `testModuleChangedSince` reads only `mtimeMs`; the fix, `Math.max(mtimeMs, ctimeMs)`, costs a real 2 s wait in the fixtures that backdate a module with `utimesSync`.
- T7 (dev's F5) a writer that keeps requesting reconciliations keeps `#reconcileWhileRequested` looping, so `firstReconciled`, `settled()` and `endJob` wait until a stop.

Discarded: the run's activity reading `running` through its settle wait (deliberate, the dev's F6 and D2088); `#protectDiscovered`'s stop verdict, which its caller re-derives (clarity only); renaming `set`, `keptReads`' predicate or `MODIFIED_TIME_RESOLUTION_MS` (the name is quoted by AC1 and the docs, and its comment carries the wider meaning); a queued event on a directory not protecting its files' reads in a reconciliation (needs a lost per-file event, which the watcher's own failure path reconciles); NTFS's change time on a last-access update (U1, settled by probe).

Tech-debt triage (review, 2026-09-27 22:36, against b1cf25a; triage only, under the owner's one-lane ruling, orchestrator 21:57). `node scripts/list-open-issues.mjs`: 0 open issues, complete, so no item has an issue and the change resolved none.

- T1, fix later. Change request: "Judge a job's end by the events accepted before it ended". Evidence: `input-tracker.ts` `endJob` closes with `this.#jobs.close(mark, this.#unavailableReason())` right after `await this.settled()`, and `#unavailableReason` counts `#pending()`, which includes the queue and in-flight batch of events accepted after the call; `#drainQueue` starts that batch before `endJob`'s continuation runs. It needs a decision (exclude post-call events from the verdict while the end fingerprint still needs them read, or bound a second settle), so it goes to `change-request`, not a mechanical fix.
- T2, folded into F3's queued change request (T6), since both re-author `testModuleChangedSince`'s test set. Add to it: "name a defect for the `since - MODIFIED_TIME_RESOLUTION_MS` margin (a module whose modification time is `since - 1000` is reported) and one for the `modified === undefined` branch (a module deleted after `since` is reported)". Evidence: `fingerprint.ts` `testModuleChangedSince`; no `defects.json` record mutates either, and D1898 edits after `since`.
- T3, fix later. Change request: "Move daemon-main's begin-after-stop guard into DaemonLifecycle.begin and name its defect". Evidence: `daemon-main.ts` `if (!lifecycle.isStopping()) lifecycle.begin();` has no named test since D1766's retirement (orchestrator, 19:49); as `begin`'s first line it is testable over the stand-in tracker (a `begin` after `stop` calls no `inputs.start` and no `readLatestResults`).
- T4, folded into T3's change request, which tests the same stop handling in `lifecycle.test.ts`. Add to it: "name a defect for `#startSequence`'s `if (this.isStopping()) break;`: without it, a later discovered workspace the confirmed start lacks is listed unstored as unconfirmed after a stop". Evidence: D1460 now mutates `isStopping()` itself, and `#run`'s post-wait stop check covers confirmed workspaces only.
- T5, closed by decision, recommended: name it a known limit rather than stat each hop, since it needs a middle link retargeted and restored, content and all, before the tracker reads the path. Proposed `docs/architecture.md` known-limit text for the orchestrator: "a chain of links whose middle link is retargeted and restored while a job runs, since a read stamps only the first link and the file". Evidence: `input-inventory.ts` `linkDigest` stamps the `lstat` of `path` and the `stat` through it.
- T6, no change: already queued as the dev's F3.
- T7, no change: already queued as the dev's F5.

#### Test Coverage Gaps

| #   | Source                                           | Named defect                                                                                                                                                                                                                                                                 | Expected test                                                                                                                                                                                                                                                                                         | Severity |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| G1  | `packages/daemon/src/daemon/lifecycle.ts`        | The check for test modules no watch covers runs before the guard's wait for the inputs to settle, so a declared module edited during that wait is read by protection without marking a job, and the discovery is stored under a digest of content it was not collected from. | `lifecycle.test.ts`, stand-in holding the guard's settle (call 1): a module change the stand-in's `testModuleChangedSince` reports only once the hold is released leaves the discovery not fingerprinted. Mutation: the pre-fix order, the `unwatched` statement above `await inputs.settled();`.     | HIGH     |
| G2  | `packages/daemon/src/inputs/input-state.ts`      | A directory walk counts only a changed digest, so a directory replaced by a rename with the same content but moved times, read after both moves, marks no running job.                                                                                                       | `input-tracker.test.ts`, real tracker: a job open while a held directory is replaced by a same-content copy whose times differ, with only the directory's event delivered, is not fingerprinted. Mutation: `return [...changed, ...unrestedPaths(before, inputs)];` to `return changed;`.             | CRITICAL |
| G3  | `packages/daemon/src/daemon/lifecycle.ts`        | The start sequence checks for a stop before waiting for the inputs to settle, so a stop arriving during that wait is followed by the discovery.                                                                                                                              | `lifecycle.test.ts`, `scripted({ heldSettle: 0 })`: a stop during the discovery's settle wait runs no discovery. Mutation: move `if (this.isStopping()) return;` in `#startSequence` above `await inputs.settled();`. D1953 holds the reconciliation, not the wait, so it passes under this mutation. | MEDIUM   |
| G4  | `packages/daemon/test/lifecycle.test.ts` (D2086) | D2086's injection `listeners[paths.indexOf(realpathSync.native(root))]?.("change", "a.ts")` does nothing when no watch opened on that exact path, so the test would pass as "a discovery with no events is stored fingerprinted" under its own mutation.                     | Record that the event was injected and assert it with the fingerprint kind, keeping one assertion.                                                                                                                                                                                                    | LOW      |

Re-anchor after R1: D1988 and D2083, whose `old` text no longer matches `lifecycle.ts` (both counted 0 matches at 20:18). R2 may move existing verdicts in `input-tracker.test.ts`: a held directory re-read on a rename event whose inputs were written less than 2 s before their last read now marks the running jobs.

### Completion Notes

Dev (rt-t2-3-dev, 2026-09-27 19:07 to 19:22).

- **Sanity check**: no findings. The one detail the ticket hands forward is which instant "when the tracker last read it" means. AC1's reverted-edit guard admits only one: the time taken before the read's `lstat` (`readAtMs` in `InputStamp`), since a later instant could exempt a revert landing during the hash.
- **U1**: CONFIRMED on Node 22.13.0 (resolution under the table).
- **Built**: `readEntryDigest` returns `{ digest, stamp }` with `stamp = { size, modifiedMs, changedMs, readAtMs }`; `takeInventory` returns `InputReads`; `MODIFIED_TIME_RESOLUTION_MS` moved to `input-inventory.ts`, read by `fingerprint.ts` and `input-state.ts`. `InputState` holds one `InputRead` per input, raises the revision on a digest change only, and `project()` still digests paths and content digests alone. `InputState.set` returns whether a write may have landed since the held read (`restedSince`), and `#readFile` records the path only then. `TrackedInputs.settled()` is `EventLedger.waitForRead`, or at once after a stop; `endJob` now calls it too, and `lifecycle.ts` awaits it before each of the three `beginJob` calls, returning without the job on a stop. `current()`'s body moved to `inputs/current-inputs.ts` (new) because `input-tracker.ts` passed the 500-code-line cap at 503.
- **Adversarial review** (19:13 to 19:17, 7 findings), triage:
  - F1 fixed. A whole walk no longer replaces a held read unless content, size and both times are unchanged and no unread event names the path (`keptReads`; `replaceUnder` always keeps it), so a queued event is judged against a read before the write. Asked the author (fc226c90) at 19:21 whether AC1's first sentence should say so; author reply 19:22, CONFIRMED and TICKET UPDATED (AC1 and Dev Notes § Design notes). Where a walk finds an input's content changed, its read replaces the held one whatever is unread, since the fingerprint digests it; that walk reports the path changed and so marks every running job itself, and AC2's wait keeps a new job from beginning before the queued event is read.
  - F2 fixed: a link to a file stamps the later of the link's and the file's times.
  - F6 fixed: `#run` sets its activity before the wait.
  - F7a fixed: `currentInputs`' docblock names `SnapshotReads` rather than claiming every outside read.
  - F7b discarded: the type-only cycle between `current-inputs.ts` and `input-tracker.ts` erases at compile, and moving `CurrentInputs` would ripple into `query/` and two test files.
  - F3, F4 and F5 are listed below.
- **Post-fix re-validation** (19:21): `bun run --filter @rt-test/daemon typecheck` exit 1 with only the 2 `lifecycle.test.ts` errors above; `bun run --filter rt-test typecheck` exit 0; root `bun x tsc --noEmit` exit 0 (19:13); `bun x oxlint` over the 6 source files exit 0, no warnings; `bun x prettier --check` exit 0. `node scripts/check-line-citations.mjs` clean. Literal check: the only new literal is `MODIFIED_TIME_RESOLUTION_MS`, moved and named.
- **README**: no user-visible CLI, configuration or support change; `README.md` untouched.

Change-request candidates, for `review-changes`:

1. **F3, pre-existing, carries a decision.** `testModuleChangedSince` (`fingerprint.ts`) reads only `mtimeMs` of a test module no watch covers, which `cp -p`, `touch -r` or tar extraction can hold still across an edit. The fix is `Math.max(mtimeMs, ctimeMs)` in `modifiedAt`. But a fixture can no longer backdate a module with `utimesSync`, which moves ctime to now (D1898 in `input-tracker.test.ts` and `declaredModuleStart` in `lifecycle.test.ts` do), so those tests would need a real 2 s wait. Recommend the fix, with the test cost stated.
2. **F4, a known limit to name.** The 2 s bar compares the daemon's clock (`readAtMs`) with file times. On a network share whose server clock lags 2 s or more and whose timestamps are coarse, an edit and revert within one step could pass. Recommend naming it in `docs/architecture.md`'s known limits (text in the lane report) rather than anchoring on file-system time.
3. **F5, pre-existing liveness.** A writer that keeps requesting reconciliations (`.gitignore`, `rt-test.json`, a watched git file) keeps `#reconcileWhileRequested` looping. `firstReconciled` then never resolves and every `endJob` waits, so the start sequence stalls until a stop (a stop still ends it). `settled()` adds the same wait before the guard and each run. Fixing it means bounding the wait to the reconciliation running at the call, in `input-jobs.ts` and the tracker, which is outside this ticket's files.

### File List

- `_agent-docs/tickets/2-3-access-time-events.md` (create-ticket; dev wrote the task and assumption records, Dev Handoff and Completion Notes)
- `packages/daemon/src/inputs/input-inventory.ts` (dev)
- `packages/daemon/src/inputs/fingerprint.ts` (dev)
- `packages/daemon/src/inputs/input-state.ts` (dev)
- `packages/daemon/src/inputs/input-tracker.ts` (dev)
- `packages/daemon/src/inputs/current-inputs.ts` (dev, created)
- `packages/daemon/src/daemon/lifecycle.ts` (dev)
- `packages/daemon/test/lifecycle.test.ts`, `packages/daemon/test/input-tracker.test.ts`, `packages/daemon/test/daemon.test.ts` and `packages/daemon/test/defects.json` (tests)
- `_agent-docs/sprints/sprint-2-fresh-runs.md` and `_agent-docs/sprint-status.yaml` (create-ticket, the split into 2.3 to 2.3f under the 18:47 and 19:01 grants)
- `docs/architecture.md` and `docs/testing.md` (orchestrator, from the dev's and the tests session's reported text)
- `packages/daemon/src/daemon/lifecycle.ts` and `packages/daemon/src/inputs/input-state.ts` (review fixes, 20:18)

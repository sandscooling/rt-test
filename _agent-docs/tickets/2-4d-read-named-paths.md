# Ticket 2.4d: Read the paths a query names

## Ticket

As an agent that saves a file and at once asks the daemon about it,
I want `status` to read the file I name before it answers, and to refuse a path it cannot tell apart from another file,
so that I am never told my pre-edit result is current, and the wait (2.4b) and the changes query (2.6) can take my paths the same way.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: A path status for a file first has the daemon read that file as an input event naming it would find it, changing only what it finds changed, and answers once that read, and every input event seen before the request, has been read. A status never waits for a reconciliation: while one runs, whether it ran when the request arrived or began before the reads were read, the status answers at once, as today, with every result unknown and the reconciliation's reason, since the reconciliation reads the file itself. So a file saved before the request, whose change the watcher has not yet reported, is never answered from its pre-edit result as current: its results read stale, or current only through a run stored over its new content. A named read that finds the file's content digest equal to the tracker's last read of it moves no input revision, marks no job and keeps that last read, however soon after the file's last write it came, since a read no event asked for is evidence of no write; the file's own event, when it comes, is judged against the kept read by ticket 2.3's rule. A named read never makes another answer read unknown, and never drops the input set or starts a reconciliation. A named path that names nothing on disk and that the tracker never held is not read, so it moves no input revision and marks no job, since no change to it is there to find.
- [x] AC2: A path status for a folder reads, in the same way and before it answers, each input under the folder that the tracker holds, and walks nothing new: a file under the folder that the tracker does not hold, and whose creation no event has reported, is not read.
- [x] AC3: A path that names an existing file or folder answers for it in any spelling the host resolves to it, as today: on Windows another letter case or an 8.3 short name. On Windows, a path naming nothing that exists is refused, with a reason naming the path and the offending name, when the name of its last part, or of any directory in it that does not exist, ends in `.` or a space, or has an 8.3 short-name form (a `~` followed by digits), since the host may read it as another name; the refusal is the query's nothing-to-answer error, as for a path outside the root. On Linux such a name is an ordinary name and is answered.
- [x] AC4: The CLI's `status` waits for its answer up to a named bound, `PATH_STATUS_BOUND_MS`, a target until measured, so a folder's reads, which for the root hash every input, do not fail it at `RESPONSE_BOUND_MS`; `summary`, which reads nothing, keeps `RESPONSE_BOUND_MS`; past the bound it fails with a reason naming the bound, as any query that gets no answer does.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. How `realpathSync.native` treats each Windows spelling was measured while drafting (§ Measured facts).

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Before the first edit, re-read the landed code of tickets 2.3g (the module extracted from `inputs/input-tracker.ts`, which is near the 500-line cap), 2.3f, 2.3h and 2.4 (`DaemonHandlers.pathStatus` answering a promise, its signal, and `DaemonConnection.request`'s bound), and confirm the names this ticket uses. Add to the tracker only through a module 2.3g's extraction leaves room in (P16).
- [x] (AC3) Create `packages/daemon/src/query/caller-paths.ts`: move `rootRelativePath` and `canonicalPath` out of `query/path-status.ts` into one exported resolution of a caller's absolute path to a root-relative one, or a refusal with its reason, which the wait (2.4b) and changes (2.6) will call too (C8, P18). Add AC3's Windows refusal for each component of the missing tail that `canonicalPath` keeps as given: a name ending in `.` or a space, or matching an 8.3 short-name form, each pattern a named constant (C3), applied only where `process.platform` is `win32`, read at each call rather than at module load, so a test proves both hosts' answers on either through `onPlatform` (`packages/daemon/test/harness.ts`), as `input-filter.test.ts` does (D3). `query/path-status.ts` calls the new module in place of its own two functions.
- [x] (AC1, AC2) Give `TrackedInputs` a read of named root-relative paths that resolves once each has been read as an event naming it would and every event seen before the call is read, or at once while a reconciliation runs or as soon as one begins (D1), unlike `settled()`, which waits a reconciliation out; the ledger's count of accepted events is how "every event seen before the call" is judged, as `settled()` judges it: a path the tracker holds as a directory, or one with held inputs under it, reads each held input under it and walks nothing; any other path that is a file on disk, or a missing path the tracker holds, is read as one event names it, which is how a new or deleted file the watcher has not reported is found; a missing path the tracker never held reads nothing, since the event path counts such a path changed ("came and went before its read", `QueuedReads.#absentChanged`) and would mark every open job window (AC1); a folder with no held inputs under it reads nothing (AC2). On Windows, a named path the tracker does not hold that names nothing on disk is matched, case-folded as `liesInsideOnHost` compares names, to a held input, and that input is read, so a just-deleted file named in another letter case is still found deleted (C42). The declaration file (`rt-test.json` at the root) is never read by name: it is not an input, and its event path asks for a reconciliation, which a status would otherwise start at every call (§ Known limits). An ignore file (`.gitignore`) that is an input is read by name as the input it is, without the reconciliation its event asks for, for the same reason; its rules apply at its event or the next reconciliation (§ Known limits). Route each through the tracker's event path (`#changed`), so exclusions, declared non-inputs and the ledger apply unchanged, leaving out the two reconciliation requests above, as a third queued kind in `QueuedReads` beside quiet and event, which acts only on a change it finds (AC1): a new file, a held input whose content digest differs from its held read, or a held input now absent. It keeps the held read of an unchanged input untouched, rested or not, as `keptReads` does for walks, and marks a job only for a found change; `InputState` gains the lookup of whether an input's held read has a given digest. An entry it cannot read as a file (unreadable, now a directory, a special entry) it leaves to its event, never calling `inputSetLost`, and it reads no listed excluded file (2.3p's listed reads enter no fingerprint, which reads them afresh). A path already queued, by an event or quietly by protection, is not queued again, and the read waits for that queued read through the ledger's count; an event naming a path queued as a named read turns it into an event read, so the event's rule applies. Named reads are counted by the ledger, so a status and a job's `settled()` wait for them, but not among the pending changed paths, so they make no other answer unknown and leave no job unsettled. Resolve at once when the tracker has stopped. The wait is on the ledger's count of accepted events, as `settled()`'s is, but ends also while a reconciliation runs or as soon as one begins: give `EventLedger` (`inputs/input-jobs.ts`) a second wait on the same count, and have the tracker notify the ledger when a reconciliation begins. The tracker is near the 500-line cap, so put the expansion of named paths into `QueuedReads`, not the tracker (P16). While re-authoring the queued reads, move the queue and the quiet set behind `QueuedReads` (enqueue, enqueue quietly, take a batch) so one class owns the rule that an event before a quiet path's read clears it, give `QueuedReads` the tracker's `AbortSignal` rather than its `AbortController`, and use `#label` for every root-relative label it computes. Keep each moved line's anchor text where the move allows, and list every defect record whose anchor the move changes under § Test Files This Change Broke for create-tests to re-anchor and re-prove: at least D1960 and D1961 (`queued-reads.ts`' signal and label lines), the tracker's queue, quiet set and `#changed` records, the ledger's `#hasRead`, `path-status.ts`' resolution records moving to `caller-paths.ts`, and `lifecycle.ts`' `pathStatus` records, found by `rg` over `packages/daemon/test/defects.json` for each edited file.
- [x] (AC1, AC2, AC3) In `packages/daemon/src/daemon/lifecycle.ts`, answer `pathStatus` late (ticket 2.4): resolve the path (AC3), read it through the tracker (AC1, AC2), then compose the answer from the store and `inputs.current()` read after the reads have settled, with no await between that read and the answer (C160). A refused path answers its refusal without reading anything. Abort nothing on the tracker when the request's signal aborts: the reads are the tracker's own and finish for every later reader.
- [x] (AC4) In `packages/daemon/src/query-client.ts`, send the path-status request with `PATH_STATUS_BOUND_MS`, 60 s (D2), as `DaemonConnection.request`'s bound (2.4 AC6), declared beside it and labeled a target (C3); `querySummary` keeps the default.
- [x] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [x] (Support) Lint and typecheck: `bun x oxlint` over the changed files and `bun run typecheck` across the repository, which reports each stand-in `TrackedInputs` and the handlers break (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `rootRelativePath`, `canonicalPath` (`query/path-status.ts`): today's resolution, which the new module takes over whole; `realPath`, `liesInside`, `relativePosixPath`, `ROOT_PATH` (`vitest/find-workspaces.ts`).
- The tracker's event path (`InputTracker.#changed`) and `EventLedger`'s count of accepted and read events (`inputs/input-jobs.ts`): the read AC1 asks for is what an event does, less the two reconciliation requests, and its wait is on the count `settled()` (`EventLedger.waitForRead`) waits on, without waiting a reconciliation out.
- `InputState.hasInput`, `hasDirectory` and the committed inputs (`inputs/input-state.ts`): which inputs the tracker holds under a folder (AC2).
- `absoluteInputPath` (`inputs/input-filter.ts`): a root-relative path in the tracker's spelling of the root.
- Ticket 2.4's late answer (`DaemonHandlers.pathStatus` answering a promise) and `DaemonConnection.request`'s bound.

### Must Create

- `query/caller-paths.ts`: the caller-path resolution and AC3's Windows refusal.
- The tracker's read of named paths (AC1, AC2).
- `PATH_STATUS_BOUND_MS` (AC4).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The second of the four tickets the original 2.4 (wait for files) became: 2.4 lets the daemon answer late; this ticket reads the paths a query names before it answers, and resolves a caller's paths with the Windows refusals; 2.4b is the wait and the `rt-test wait` command, which read its files and resolve its paths through this ticket. Build order: 2.3g, 2.3f, 2.3h, 2.3i, 2.4, 2.4d, 2.4b (orchestrator, 2026-09-28 13:26; the command, once 2.4c, folded into 2.4b at 01:55 on 2026-09-30). `status <path>` is this ticket's production caller, and the first production caller of 2.4's late answer.

Requirements this ticket serves (`docs/requirements.md`):

- "NFR3: Never report a result as current unless its stored input fingerprint matches the current inputs." (AC1, AC2)
- "FR5: Answer summary and `status <path>` queries through a CLI with versioned `--json` output, reporting counts per state for files and folders, without starting a test." (AC1 to AC4: the answer's shape is unchanged, and a read starts no test)

Rule clauses the criteria rest on:

- AGENTS.md § Product guarantees: "Never report historical results as current after a relevant edit or unresolved input change." (AC1, AC2)
- `docs/architecture.md`, the input tracker paragraph: "An event after which an input's content digest, size, modification time and change time all equal the tracker's last read of it from before the event counts as none, when that read came at least 2 s after both times" (AC1: a named read of an unchanged file moves nothing).
- Ticket 2.4 AC6: "A client waits for an answer up to the bound its caller gives, and up to `RESPONSE_BOUND_MS` when the caller gives none, as the hello, status, stop and every existing query do today. When no answer has arrived by then, the request rejects with a reason naming the bound, and the connection is closed, so the daemon drops the request (AC4)." (AC4)
- `docs/architecture.md`, the query paragraph: "A query starts no job and changes no activity." (AC1: the reads are the tracker's; a changed file moves the revision, as the event would have, and the scheduler, not the query, decides what runs.)
- Ticket 2.3d review (2026-09-28 06:20), moved to this ticket by the orchestrator at 13:26: the paths come from the caller, not the tracker, so on Windows a spelling of the same file other than case, such as a trailing dot or space or an 8.3 short name, is resolved or refused (AC3).

Glossary (`docs/glossary.md`), verbatim:

- **Input**: "A file whose edit RT Test treats as able to change a test's result."
- **Input revision**: "The number naming a worktree's inputs as the daemon last observed them in its current life, raised once for each batch of changes it observes."
- **Freshness**: "Whether a result still describes its test's current inputs."

#### Orchestrator rulings

Asked by `session_wake` at 13:25 on 2026-09-28, answered at 13:26; decider the orchestrator. Each reason is the orchestrator's.

- Sizing: 2.4b as first drafted measured about 17 raw files, 22 estimated; split (option b), with this ticket (key 2.4d) holding the named read of given paths and the caller-path resolution with the Windows refusals, built before 2.4b. Reason: it keeps 2.4b and 2.4c, which 47e8d89's pointers already cite, as the 2.3g-before-2.3f precedent did, and `status <path>` uses both, so it has a production caller when it lands.
- Finding, NFR3: `status <path>` could answer a file saved a moment before from its pre-edit result as current, until the watcher's event arrived, since the tracker then has no pending path and fingerprints the old snapshot. Fixed here (AC1, AC2): status first reads its path as an event naming it would and answers once that read and every earlier event are settled; for a folder, it reads each input under it the tracker already holds and walks nothing new. A save to a file the query does not name, not yet reported by the watcher, stays a window summary and status cannot close; architecture's known limits name it (§ Doc text).
- Spike (below): agreed. Refuse a missing tail component ending in `.` or a space or holding an 8.3 form, with a reason; existing-file spellings resolve through the real path as measured (AC3).
- D1 (grill, asked 13:29, answered 13:30; AC1): a status never waits for a reconciliation; while one runs it answers at once, as today, every result unknown with the reconciliation's reason. Reason: that is already correct and never false freshness, status is a call agents make constantly with a sub-100 ms target, and blocking belongs to the wait (2.4b). Outside a reconciliation, status does the named read and answers once it and every earlier event are read.
- D2 (grill, 13:30; AC4): `PATH_STATUS_BOUND_MS`, 60 s, labeled a target, for a folder's reads; `summary` keeps `RESPONSE_BOUND_MS`.
- D3 (grill, 13:30; AC3): the Windows refusals apply on Windows only, proven on either host through `onPlatform`.
- Ticket review (create-ticket 6c, 13:29 to 13:33, begun before D1 was applied): 11 findings, 10 applied. E1 reads nothing for a folder with no held inputs; E2 quotes the access-time rule's 2 s condition in AC1; E3 tags AC3 on the lifecycle task; E4 fixed the sibling heading; E5 and E6 added `server.test.ts` and `cli.test.ts` and widened the search (sizing now 12 raw, 16 estimated); E7 quotes 2.4 AC6. Q1, a stopped tracker, was settled by fact (§ Design notes). Q2, a just-deleted file named in another case on Windows, was settled by create-ticket toward correctness: the named read folds case against the held inputs (C42). Q3, a status naming `rt-test.json`, was settled by create-ticket: the named read skips the declaration file, a known limit. Q4, an unending wait on reconciliations, was rejected as moot: D1 removed that wait. The orchestrator agreed Q2 and Q3 at 13:34.
- Markers (13:30): the orchestrator added 2.4d to FR5's and NFR3's markers; the architecture text in § Doc text lands with the build.
- Refuse whole (2.4b's): a wait naming any refused path is refused whole, naming each refused path; recorded in the sprint file's § 2.4b.
- Sanity check (dev rt-t2-4d-dev, 05:27 on 2026-09-30; answered by create-ticket at 05:29): F1 CONFIRMED, a missing path the tracker never held is not read, since the event path counts it changed and marks every open job window, against "A query starts no job and changes no activity" (AC1, the AC1/AC2 task). F2 CONFIRMED, the event path's second reconciliation trigger, a `.gitignore` event, is left out of the named read, which reads the ignore file as an input; a known limit (the AC1/AC2 task, § Known limits, § Doc text). Reading it rather than skipping it is the dev's recommendation, taken because it moves the digest of every workspace it is an input of, toward staleness. F3 CONFIRMED, `waitForRead` cannot end while a reconciliation runs, so the ledger gains a second wait and `input-jobs.ts` joins the file list (the AC1/AC2 task, § Reusable Code, § Sizing, § Execution Metadata). F4 CONFIRMED, the move re-anchors more records than D1960 and D1961, and § Current structure was written before 2.3p; both refreshed. The dev's choice to resolve the caller's path once in the lifecycle and hand it to `pathStatusAnswer` matches the lifecycle task.
- A read no event asked for (dev rt-t2-4d-dev after its build's adversarial pass and review, 05:45 on 2026-09-30; agreed by create-ticket at 05:46; AC1, the AC1/AC2 task): routed through the event path whole, a named read (E1) marked a job and interrupted the running workspace whenever the held read of a just-saved file was unrested, which it always is within the 1 s quiet window, and replaced that read so a real intermediate write's event later marked nothing; (E2) cleared protection's quiet mark and spoiled the discovery's guard job; (E3) counted as pending changed paths, so every other answer read unknown while a folder hashed and a job could begin unsettled; (E4) dropped the input set on an unreadable file. Agreed: a named read acts only on a change it finds, keeps an unchanged input's held read, re-queues nothing already queued, counts in the ledger but not as pending, and leaves an entry it cannot read as a file to its event; an event naming a path queued as a named read turns it into an event read (create-ticket's condition). Reason: a read no event asked for is evidence of no write, and the event, when it comes, still does all the event path does, so no stale result reads current and a query changes no activity ("A query starts no job and changes no activity"). `input-state.ts` joins the file list.

#### Measured facts

Spike at 13:24 on 2026-09-28, Node 24.19.0 on Windows 11, over a file `...\spell2\LongDirectoryName\SomeLongFileName.test.ts` under the scratch folder, since deleted:

- `realpathSync.native` of the file in lowercase: `C:\source\...\spell\LongDirectoryName\SomeLongFileName.test.ts`, and `statSync(...).isFile()`: `true`. Case resolves.
- Of its 8.3 short name `C:\source\RT-TES~1\wt-1\_AGENT~1\SCRATC~1\CREATE~1\spell2\LONGDI~1\SOMELO~1.TS` (from `Scripting.FileSystemObject`'s `ShortPath`): `C:\source\rt-test-wt\wt-1\_agent-docs\.scratch\create-ticket\spell2\LongDirectoryName\SomeLongFileName.test.ts`, and `isFile()` `true`. An existing 8.3 spelling resolves.
- Of the file with a trailing `.`, a trailing space, or `. .`: `THROWS ENOENT` from both `realpathSync.native` and `statSync`. Node does not strip them (it passes the long-path form), so today's `canonicalPath` keeps such a name as a missing tail and answers for a file that is not the one meant; for `package.json.` selection would not see a manifest.
- Of a missing file `GONE.TS` under the 8.3 directory spelling: `native throws ENOENT`, `stat throws ENOENT`; `canonicalPath`'s climb then resolves the existing 8.3 directories to their long names and keeps only `GONE.TS` as given.

Commands: a scratch `.mjs` creating the file and probing each spelling, and a PowerShell probe taking the short name from `(New-Object -ComObject Scripting.FileSystemObject).GetFile(path).ShortPath` and running `node probe.cjs <path>`, which printed the lines above.

#### Design notes

- **Why read through the event path, acting only on what it finds.** A named read must find what the event it stands in for would have: the same filter and the same declared non-inputs. Routing it through the tracker's event path gives that with no second rule (C8); a separate read would drift. But no write asked for it, so it is evidence only of what it finds changed: an unchanged file keeps its held read and marks no job, rested or not, and the file's own event, when it comes, applies the access-time rule against that kept read (05:45 amendment).
- **Why a status never waits for a reconciliation (D1).** While one runs, no fingerprint can be computed and every result reads unknown with its reason, which is already correct and never false freshness, and the reconciliation reads the named file itself. Status is a call agents make constantly, with a target of 100 ms end to end (`docs/plan.md` § Targets), so it must not block for a reconciliation; blocking until results are current is the wait's job (2.4b). So the named read waits only for its own reads and the events before it, never for a reconciliation.
- **A stopped tracker cannot answer current.** The tracker stops only inside the lifecycle's stop sequence (`lifecycle.ts` `#stopSequence`, the tracker's stop), after 2.4's stop signal has answered every pending request with the stopping error, and a stopped tracker's condition makes every fingerprint unavailable (`current-inputs.ts`: `STOPPED_REASON`), so a named read that resolves at once on a stopped tracker leaves nothing to read as current (review Q1, settled by fact).
- **Why a folder reads only what the tracker holds.** Reading each held input under the folder catches an edit to any of them the watcher has not reported, at the cost of hashing them, which for the root is every input, as a reconciliation reads them. Walking the folder would also find new files, but that is a reconciliation's job, and the orchestrator ruled it out.
- **Why the refusal is Windows only.** On Linux a trailing dot or space, or `~1`, is an ordinary part of a name, and the file it names is that file; on Windows the name is ambiguous: Node keeps a trailing dot or space and finds no such file (§ Measured facts) where the caller most likely meant the name without it, and an 8.3 form may stand for a long name that no longer exists, which no real-path lookup can recover.
- **Scope of the analysis.** Analyzed: a file saved before the request with no event yet, an unchanged file, a folder, a reconciliation running when the request arrives or beginning before its reads are read, the tracker stopped, a stop while the request is pending (2.4 AC3 answers it), and each Windows spelling measured. Not analyzed: `summary`, which names no path and keeps today's window (§ Known limits); the cost of a status of the root on a large consumer, a target for 2.5's corpus to measure.

#### Known limits

- **An edit the watcher has not yet reported, to a file the query does not name**, is not seen by `summary` or by `status` until the event arrives or the next reconciliation reads it (orchestrator, 13:26).
- **A new file under a folder** whose creation no event has reported is not read by a status of the folder (AC2).
- **An unreported edit to `rt-test.json`** is not read by a status naming it: the declaration file is not an input, and reading it by name would start a reconciliation at every such status; its event, or the next reconciliation, reads it.
- **An unreported edit to a `.gitignore`** is read as an input by a status naming it, but its rules apply only once its event or the next reconciliation reads them.
- **A named file that cannot be read as a file** (unreadable mid-save, now a directory, a dangling symbolic link, a FIFO) is left to its event or the next reconciliation, and a held folder replaced by a file before its event is read as its held children, which reads them removed and moves the revision toward stale (dev's review, 05:45; no stale result reads current, the owner's 03:25 ruling).
- **On Windows, a missing long name holding `~` and digits**, such as `notes~2.md`, is refused as an 8.3 form (AC3), since the refusal cannot tell it from a short name.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.4d` over this ticket's files (13:27) named 2.3f, 2.3g, 2.3h and 2.3i (by folder, and 2.3g and 2.3i by `path-status.ts`, which each only reads through `queryBasis`), and 2.4 (`query-client.ts`, whose callers it leaves on the default bound). Each bullet names when it builds relative to this ticket:

- **2.3g** (authored, not built): extracts from `input-tracker.ts` before adding to it; this ticket's named read goes where that extraction leaves room.
- **2.3f, 2.3h, 2.3i** (authored, not built): write `input-tracker.ts`, `lifecycle.ts` and the query files; none reads a named path or resolves a caller's path.
- **2.4** (ready-for-dev): the late answer this ticket's `pathStatus` returns, the request's abort signal, and `DaemonConnection.request`'s bound AC4 passes.
- **2.4b** (backlog, builds after this ticket): the wait, which calls this ticket's resolution for each path it is given (refusing the wait whole when any is refused) and this ticket's named read before it binds.
- **2.6** (backlog): the `changes` query, which resolves its paths through this ticket's module (sprint file § 2.6).

#### Sizing

About 15 raw files and 20 estimated; code units 5 (4 criteria plus validation). Production: `query/caller-paths.ts` (new), `query/path-status.ts`, `inputs/input-tracker.ts`, `inputs/queued-reads.ts` (the queue and quiet set move behind it, 4df0528), `inputs/input-jobs.ts` (the ledger's second wait, sanity check F3), `inputs/input-state.ts` (the held-digest lookup, 05:45 amendment), `daemon/lifecycle.ts`, `query-client.ts`. Tests, for create-tests: `query.test.ts` (the resolution and its refusals), `input-tracker.test.ts` (the named read), `lifecycle.test.ts` (its `StandInInputs` gains the read; path status answers late), `daemon.test.ts` (a real daemon: save, then status at once), `server.test.ts` (a path status expected at once), `packages/cli/test/cli.test.ts` (the CLI's status against a real daemon, and the bound), and `packages/daemon/test/defects.json`. Over 10 estimated, so dev delegates, in two groups on disjoint files: the resolution (`caller-paths.ts`, `path-status.ts`) and the read (`input-tracker.ts`, `queued-reads.ts`, `input-jobs.ts`, `lifecycle.ts`, `query-client.ts`).

#### Current structure of the modified files

As of wt/1 at 83d62af (main, after 2.3g to 2.4, 2.3p, 2.3l and 2.3n landed), refreshed at the sanity check (05:28 on 2026-09-30).

- `packages/daemon/src/query/path-status.ts` (200 lines): `pathStatusAnswer(absolutePath, results, daemon, inputs)` resolves the path with the private `rootRelativePath` (the root's real path, then `canonicalPath`, refusing a path outside the root) and answers through `queryBasis`; `canonicalPath` climbs to the nearest existing ancestor's real path and joins the missing names as given.
- `packages/daemon/src/inputs/input-tracker.ts` (603 lines, about 494 code lines against the 500 cap): `#changed(path, kind)` stays here, dropping the declaration file (asking for a reconciliation), queuing an excluded path only when a discovery lists it (2.3p), asking for a reconciliation on an event naming a `.gitignore`, dropping declared non-inputs, and queuing the rest; a reconciliation begins at `#reconcile` setting `#reconciling`, which notifies nothing; the queue (`#queue`, a `Map` of path to event kind) and the quiet set (`#quiet`) are still tracker fields, handed to the `QueuedReads` it constructs (`#reads`) along with its `AbortController` (`abort: this.#abort`); `settled()` is `this.#ledger.waitForRead()`, which resolves once the events accepted by then are read and no reconciliation runs. The move behind `QueuedReads` (4df0528's amendment to the AC1/AC2 task) starts from this state.
- `packages/daemon/src/inputs/queued-reads.ts` (265 lines): `QueuedReads` reads the paths events named between reconciliations into the input state, and the listed files 2.3p reads, marking each job a change can affect through `JobWindows.recordPath`; `#absentChanged` counts a missing path never held as changed unless the declaration hides it; it holds the tracker's `AbortController` and the quiet set it was handed, and computes root-relative labels itself.
- `packages/daemon/src/inputs/input-jobs.ts` (166 lines): `EventLedger` counts accepted events (`accept`) and read ones (`readUpTo`); `waitForRead` resolves once the events accepted by then are read and no reconciliation runs (`#hasRead`), and `notify` releases waits that can end. D1960 (`filter.check(unknown, this.#abort.signal)`) and D1961 (`this.#jobs.recordCause(this.#label(path))`) in `packages/daemon/test/defects.json` anchor in it.
- `packages/daemon/src/daemon/lifecycle.ts` (570 lines): `pathStatus(path)` answers `pathStatusAnswer(path, this.#latestResults(), this.#view(), this.#parts.inputs.current())` at once.
- `packages/daemon/src/query-client.ts` (90 lines): `queryPathStatus(consumerRoot, path)` sends the request through `query`, which calls `connection.request(request)` with the default bound.

#### Existing tests this change breaks

- `packages/daemon/test/lifecycle.test.ts`: `StandInInputs implements TrackedInputs` gains the named read; tests calling `pathStatus` get a promise.
- `packages/daemon/test/server.test.ts` and `packages/daemon/test/daemon.test.ts`: only where a path status is expected at once while events are unread; a real daemon's status after an edit now reads the file first.
- `packages/daemon/test/query.test.ts`: tests of `pathStatusAnswer`'s resolution, if they reach the moved functions by name.
- `packages/cli/test/cli.test.ts`: the CLI's status against a real daemon; an edit then status now reads the file first, and the client's bound is `PATH_STATUS_BOUND_MS`.
- Found by `rg -ln "pathStatus|queryPathStatus|pathStatusAnswer" packages/*/test` (13:26), then by `rg -ln "pathStatus|queryPathStatus|pathStatusAnswer|\"status\"" $(git ls-files | rg "\.test\.ts$")` over every tracked test file (13:33), which added `cli.test.ts` and, on the bare word "status", `test/scripts/orchestration/lease.test.ts` and `packages/daemon/test/discover-tests.test.ts`, neither of which calls a path status; `bun run typecheck` across the repository reports each hand-built shape (P14), and a behavior change only the test run reports.

#### Doc text

Dev reports this text with the build, and the orchestrator writes it then, since it describes built behavior (orchestrator, 13:30).

- `docs/architecture.md`, the query paragraph, after "A path status counts the tests whose module file lies at or under the path, decided by canonical real path, gives one entry per file for a folder, and names the workspace, project and source entries above the path.": "Before it answers, a path status reads the file at the path, or each input the tracker holds under the folder, as an input event naming it would, and answers once those reads and every earlier event are read, so a file saved just before the query is never answered from its pre-edit result as current; while a reconciliation runs it answers at once, every result unknown with the reconciliation's reason. On Windows a path naming nothing that exists is refused when a name in it ends in a dot or a space or has an 8.3 short-name form."
- `docs/architecture.md`, the input tracker paragraph's known limits, the text the orchestrator named: "an edit the watcher has not yet reported, to a file the query does not name", and beside it: "an edit to `rt-test.json` the watcher has not yet reported, which a status naming it does not read", and "an edit to a `.gitignore` the watcher has not yet reported, which a status naming it reads as an input but whose rules apply only at its event or the next reconciliation".

#### Previous ticket

2.4 (ready-for-dev, authored in this lane at 12:18 to 13:22): the server answers each connection's requests in order through a queue, a handler may answer with a promise and receives an `AbortSignal`, a stop answers every pending request at once with the stopping error, and `DaemonConnection.request` takes an optional bound. Its review found that the stop must begin before its acknowledgement is written. It has no dev notes yet.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.4, § Ticket 2.4d, § Ticket 2.4b, § Ticket 2.6.
- Ticket 2.4 (`_agent-docs/tickets/2-4-late-answers.md`), ticket 2.3 (`_agent-docs/tickets/2-3-access-time-events.md`) for the access-time rule, ticket 1.4 (`_agent-docs/tickets/1-4-query-cli.md`) for path status.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (12:14).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C8,C14,C38,C39,C42,C46,C48,C55,C59,C113,C115,C153,C157,C160 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P18,P19,P21,P32,P34 -->

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
  - packages/daemon/src/query/path-status.ts
  - packages/daemon/src/inputs/input-tracker.ts
  - packages/daemon/src/inputs/queued-reads.ts
  - packages/daemon/src/inputs/input-jobs.ts
  - packages/daemon/src/inputs/input-state.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/query-client.ts
files_to_create:
  - packages/daemon/src/query/caller-paths.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 07cc2990-fefe-45ff-bf2b-fe6e515f5ee9

#### Test Files This Change Broke

`bun run --filter @rt-test/daemon typecheck` at 05:48 reports 11 errors, all in test files:

- `packages/daemon/test/lifecycle.test.ts`: `StandInInputs` lacks `readNamed` (2); `pathStatus` now takes `(path, signal)` and answers a promise (4 calls).
- `packages/daemon/test/scheduling-harness.ts` and `packages/daemon/test/scheduler.test.ts`: their `StandInInputs` lacks `readNamed`.
- `packages/daemon/test/query.test.ts`: `pathStatusAnswer` now takes the resolved `CallerPath` (`resolveCallerPath` in `query/caller-paths.ts`), not an absolute path (3 calls).
- Behavior, not types: `server.test.ts`, `daemon.test.ts` and `packages/cli/test/cli.test.ts` where a path status is expected at once or after an edit; a status now reads its path first.

Defect records whose anchor no longer matches exactly once in their `file` (found by a scratch script over `packages/daemon/test/defects.json` for every edited file), for re-anchoring and re-proof:

- D1826 (`canonicalPath`'s `join(real.path, ...missing)` return) and D1829 (`liesInside(root.path, path.path)`): moved to `query/caller-paths.ts`; D1829's text is intact there, D1826's return now also carries `missing`.
- D1844, D2959 (the `pathStatus` signature and its first store read) and D1872 (`pathStatusAnswer(path, results, this.#view(), ...)`): `lifecycle.ts`, rewritten as the late answer.
- D1891 (`#queue.size === 0` in `#processQueue`), D2164 (the quiet delete before the queue set) and D2170 (`#queueQuietly`'s queue check): the queue moved into `QueuedReads`; D2164's text now matches in `queued-reads.ts` `enqueue`.
- D1960 and D3261 (`this.#abort.signal` in `queued-reads.ts`): now `this.#signal`.

Records whose text still matches but whose code the change touched: D1897 (`#hasRead`, now also reached through `#canEnd`), D1961 and D3222 (`QueuedReads.read`, which gained the named branch), D2085 and D2086 (`settled`).

#### ACs Owed a Test

- AC1, through a real daemon: a file saved and at once named by `status` never reads current from its pre-edit result. The probe saw the watcher's own event for the save land during the named read, so the answer then reads unknown ("1 changed paths have not been read yet") rather than stale; assert "not current", not "stale". Also AC1's D1 arm (a reconciliation running, or beginning before the reads are read, answers at once), which the probe could not catch in the act; it rests on a trace.

#### Tests Owed

None.

### Tests Record

Tests session: threadId 0d75bb14-8613-48f3-8bd4-fc70a5459b38

#### Named Defects

- D3360: On Windows, a missing name ending in a dot is not refused, so a status answers for a file other than the one the caller most likely meant. (AC3)
- D3361: On Windows, a missing name ending in a space is not refused. (AC3)
- D3362: On Windows, a missing name in an 8.3 short-name form is not refused, though it may stand for a long name that no longer exists. (AC3)
- D3363: On Windows, only the last missing name is judged, so a path under a missing directory ending in a dot is answered. (AC3)
- D3364: The Windows refusals apply on Linux, where a name ending in a dot is an ordinary name, so a status of such a file is refused. (AC3)
- D3365: Every name in the path is judged, not only the missing ones, so an existing file whose long name holds a tilde and a digit is refused. (AC3)
- D3366: A named read queues nothing, so a status of a file saved before its event arrives answers from its pre-edit result as current. (AC1)
- D3367: A named read resolves before its reads are read, so a status composes its answer from the inputs before the named file was read. (AC1)
- D3368: A named read of a file whose content is unchanged replaces its held read as an event read would, so a status just after a save marks the running job and interrupts it. (AC1)
- D3369: A named read that finds a held input gone keeps it, so a status of a file deleted before its event arrives answers from its last result as current. (AC1)
- D3370: A named path the tracker does not hold is never read, so a status of a file created before its event arrives does not find it. (AC1)
- D3371: A named folder reads none of the inputs held under it, so a status of a folder answers from the pre-edit result of a file saved in it. (AC2)
- D3372: A named read counts as a changed path not yet read, so every other answer reads unknown while a folder's inputs are read. (AC1)
- D3373: A named read asked while a reconciliation runs waits the reconciliation out, so a status blocks for it instead of answering at once. (AC1, D1)
- D3374: A reconciliation beginning releases no wait, so a status whose named read is still reading when one begins waits it out. (AC1, D1)
- D3375: A named read reads a file the filter excludes, so a status of a git-ignored file makes it an input and moves the revision. (AC1)
- D3376: A named path is matched to the held inputs by exact spelling, so on Windows a file deleted before its event and named in another letter case is not found deleted. (AC1)
- D3377: A path status answers without waiting for its named read, so it answers from the inputs before the named file was read. (AC1)
- D3378: A path status whose request aborted during its named read still reads the store, which a stop may have closed. (AC1)
- D3379: A path status reads nothing before it answers, so a real daemon answers a file saved before the watcher reports the save from its pre-edit result as current. (AC1, through a real daemon whose watches the `test/fixtures/daemon/silent-watch.mjs` preload silences)
- D3380: A path status waits only the connection's default 10000 ms, so a folder's reads fail it before the daemon can answer. (AC4)
- D3381: A summary, which reads nothing, waits the path status bound instead of the connection's default. (AC4)
- Re-anchored to the build and re-proven: D1826 and D1829 (to `query/caller-paths.ts`), D1844, D1872 and D2959 (the late `pathStatus`), D1891 (`#reads.queued`), D2164 and D2170 (to `QueuedReads.enqueue` and `enqueueQuietly`), D1960 and D3261 (`this.#signal`). D2959's test now names a path under a consumer root that exists, since a refused path reads no store.

Proof scope, ruled by the orchestrator (06:09, decider the orchestrator, asked by this session at 06:08 after `--edited` counted 553): prove by `--ids` the union of every record whose mutated file the build edited (196, including the 22 new and 10 re-anchored) and every record in `lifecycle.test.ts` and `query.test.ts`, whose existing lines changed: 376, deduplicated. `input-tracker.test.ts` (+259 -0) and `daemon.test.ts` (+95 -0, its new names imported by added statements) are add-only, adding at top level only imports, declarations and test blocks with no hook, so their other records are not re-proven.

Proofs, all by `node scripts/verify-defects.mjs --ids` through the lease: on Windows, the 22 new and 10 re-anchored, 32/32 detected, exit 0 (06:28 to 06:33), and the other 344, 344/344 detected, exit 0 (06:14 to 06:24); on Linux under Node v24.19.0 in the WSL clone `~/rt-t2-4d-tests` with `TMPDIR` set per crew.md, all 376, 376/376 detected, exit 0 (06:24 to 06:28). A first Windows run of the 32 detected all 32 but exited 1, since an import edit to `daemon.test.ts` landed after its snapshot; it counts for nothing.

#### Deliberately Untested

- packages/daemon/src/inputs/input-state.ts: `holdsDigest` is reached only through the named read, whose unchanged-file rule D3368 pins.
- packages/daemon/src/query/path-status.ts: the resolution moved to `caller-paths.ts`; what remains is a signature change, answered by D1822 to D1831 through the resolution.
- packages/daemon/src/inputs/input-tracker.ts: `readNamed`'s skip of `rt-test.json` is an inert mutation: the filter excludes `rt-test.json`, and a named read of an excluded path reads nothing (D3375).
- packages/daemon/src/inputs/queued-reads.ts: `namedPaths` giving nothing for a missing path never held is an inert mutation alone: a named read that finds such a path absent removes nothing and records nothing.
- packages/daemon/src/inputs/queued-reads.ts: `enqueueQuietly` replacing a queued named read, and `enqueueNamed` skipping a path already queued, are orderings of a query against protection or an event, not chased under the owner's 03:25 ruling.
- packages/daemon/src/daemon/lifecycle.ts: a refused path reading nothing; dropping the refusal is observable only through a crash, which names another defect.
- AC1's D1 arm through a real daemon: a reconciliation cannot be caught in the act there; both arms are pinned at the tracker (D3373, D3374), and the lifecycle answers at once whenever the read resolves (D3377).
- AC2's "walks nothing new": no code walks a named folder, so no mutation exists.

### Review Record

#### Test Coverage Gaps

None.

### Completion Notes

Built in one session, not delegated: the lifecycle calls both the resolution and the named read, so the tasks form one dependency chain. Tasks 2 to 5 were closed as one typecheck-atomic unit, since `pathStatusAnswer`'s new signature breaks its lifecycle caller until task 4 lands.

- `query/caller-paths.ts` (new): `resolveCallerPath` takes over `rootRelativePath` and `canonicalPath`, and on `win32`, read at each call, refuses a missing name ending in `.` or a space (`TRAILING_DOT_OR_SPACE`) or holding `~` and a digit (`SHORT_NAME_FORM`), naming the path and the name. The lifecycle resolves once and hands the resolved `CallerPath` to `pathStatusAnswer`.
- `QueuedReads` owns the queue and the quiet set (`enqueue`, `enqueueQuietly`, `enqueueNamed`, `takeBatch`), takes the tracker's `AbortSignal`, labels through `#label`, expands a named path (`namedPaths`), and reads named paths as a third queued kind (`#readNamed`) that changes only what it finds changed. Precedence: an event replaces a quiet or named read; a quiet read replaces a named one; a named read never replaces anything. Named reads count toward the ledger but not toward pending (`pendingCount`).
- `EventLedger.waitForReadOrReconciliation` ends at the same count as `waitForRead`, or while a reconciliation runs; the tracker notifies the ledger when one begins. `accept` takes a count.
- `InputState.holdsDigest` tells a named read whether a held input's content is unchanged.
- `InputTracker.readNamed`: nothing while stopped, reconciling or not established; skips `rt-test.json`; `#unavailableReason` was inlined to stay under the 500-line cap.
- `lifecycle.pathStatus(path, signal)`: refuses without reading, awaits `readNamed`, answers `NOT_AWAITED_REASON` once the signal aborted (so a stop never reads a closed store), then reads the store and the inputs with no await before the answer.
- `query-client.ts`: `PATH_STATUS_BOUND_MS` = 60 s, a target, for `queryPathStatus`; `querySummary` keeps the default.

Sanity check (05:27): four findings, all CONFIRMED by create-ticket at 05:29 and applied (§ Orchestrator rulings). Unverified assumptions: none in the table.

Adversarial review (05:35 to 05:42), 7 findings: R1 (a named read cleared protection's quiet mark), R2 (named reads counted as pending), R3 (an unreadable named file dropped the input set), plus E1 found while triaging (a named read of a just-saved unchanged file marked and interrupted the run). All four were fixed by the mechanism create-ticket agreed at 05:46, which includes its condition that an event turns a queued named read into an event read. R6 (the `notify` doc) was fixed. R4, R5 and R7 are recorded under § Known limits, since none reports a stale result as current.

Evidence (`_agent-docs/.scratch/2-4d/probe.ts` under Bun 1.3.14, Windows 11, a temp fixture, 05:48; deleted after):

- AC1: an edited file named moves the revision; an unchanged one moves nothing; a missing path never held moves nothing and a job open across it stays fingerprinted; a just-saved unchanged file named during a job leaves it fingerprinted.
- AC1 (E3): a root read shows 0 pending and no unavailable reason while it runs.
- F2: naming `.gitignore`, `rt-test.json` and the root starts no reconciliation. A stopped tracker's named read resolves at once.
- AC2: a folder read moves the revision for an edited file under it; `namedPaths` returns held inputs only, and a folder with none returns nothing (traced).
- AC3: a lower-case spelling of an existing file resolves to its real path. A trailing dot, a trailing space, an 8.3 name and a missing directory with a trailing dot are each refused with the path and the name, and each is answered under a `linux` platform override. An ordinary missing name resolves, and a path outside the root is refused.
- AC4 (traced): `queryPathStatus` passes `PATH_STATUS_BOUND_MS` to `DaemonConnection.request`, whose timeout rejects with "the daemon did not answer within 60000 ms", which `query` wraps as "Cannot get an answer from the daemon for <root>: ...". `querySummary` passes no bound and keeps `RESPONSE_BOUND_MS`.

Gates (05:48): `bun x oxlint` and `bun x prettier --check` over the 8 production files, exit 0. `bun run --filter @rt-test/daemon typecheck` exit 1, with the 11 errors all in test files (above). `bun run --filter rt-test typecheck` (CLI) exit 0. `node scripts/check-line-citations.mjs`: clean.

README: `status` behavior changed, so the exact text for `README.md` goes to the orchestrator with the report.

Change-request candidates: none.

### File List

- packages/daemon/src/query/caller-paths.ts (created)
- packages/daemon/src/query/path-status.ts
- packages/daemon/src/inputs/input-tracker.ts
- packages/daemon/src/inputs/queued-reads.ts
- packages/daemon/src/inputs/input-jobs.ts
- packages/daemon/src/inputs/input-state.ts
- packages/daemon/src/daemon/lifecycle.ts
- packages/daemon/src/query-client.ts

- _agent-docs/tickets/2-4d-read-named-paths.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.4d added; § 2.4b and § 2.6 repointed to it; the split note extended; under the orchestrator's 12:18 grant)
- _agent-docs/sprint-status.yaml (2-4d-read-named-paths added)
- _agent-docs/tickets/2-4-late-answers.md (2.4d named as the first production late answer, and in the build order)
- docs/requirements.md (FR5 and NFR3 markers gain 2.4d): written by the orchestrator at 13:30

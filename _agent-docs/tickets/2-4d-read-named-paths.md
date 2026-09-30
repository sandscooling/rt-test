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

- [ ] AC1: A path status for a file first has the daemon read that file as an input event naming it would, and answers once that read, and every input event seen before the request, has been read. A status never waits for a reconciliation: while one runs, whether it ran when the request arrived or began before the reads were read, the status answers at once, as today, with every result unknown and the reconciliation's reason, since the reconciliation reads the file itself. So a file saved before the request, whose change the watcher has not yet reported, is never answered from its pre-edit result as current: its results read stale, or current only through a run stored over its new content. A read that finds the file's content digest, size, modification time and change time equal to the tracker's last read of it, when that read came at least 2 s after both times, moves no input revision and marks no job, as for any event (ticket 2.3).
- [ ] AC2: A path status for a folder reads, in the same way and before it answers, each input under the folder that the tracker holds, and walks nothing new: a file under the folder that the tracker does not hold, and whose creation no event has reported, is not read.
- [ ] AC3: A path that names an existing file or folder answers for it in any spelling the host resolves to it, as today: on Windows another letter case or an 8.3 short name. On Windows, a path naming nothing that exists is refused, with a reason naming the path and the offending name, when the name of its last part, or of any directory in it that does not exist, ends in `.` or a space, or has an 8.3 short-name form (a `~` followed by digits), since the host may read it as another name; the refusal is the query's nothing-to-answer error, as for a path outside the root. On Linux such a name is an ordinary name and is answered.
- [ ] AC4: The CLI's `status` waits for its answer up to a named bound, `PATH_STATUS_BOUND_MS`, a target until measured, so a folder's reads, which for the root hash every input, do not fail it at `RESPONSE_BOUND_MS`; `summary`, which reads nothing, keeps `RESPONSE_BOUND_MS`; past the bound it fails with a reason naming the bound, as any query that gets no answer does.

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

- [ ] (Support) Before the first edit, re-read the landed code of tickets 2.3g (the module extracted from `inputs/input-tracker.ts`, which is near the 500-line cap), 2.3f, 2.3h and 2.4 (`DaemonHandlers.pathStatus` answering a promise, its signal, and `DaemonConnection.request`'s bound), and confirm the names this ticket uses. Add to the tracker only through a module 2.3g's extraction leaves room in (P16).
- [ ] (AC3) Create `packages/daemon/src/query/caller-paths.ts`: move `rootRelativePath` and `canonicalPath` out of `query/path-status.ts` into one exported resolution of a caller's absolute path to a root-relative one, or a refusal with its reason, which the wait (2.4b) and changes (2.6) will call too (C8, P18). Add AC3's Windows refusal for each component of the missing tail that `canonicalPath` keeps as given: a name ending in `.` or a space, or matching an 8.3 short-name form, each pattern a named constant (C3), applied only where `process.platform` is `win32`, read at each call rather than at module load, so a test proves both hosts' answers on either through `onPlatform` (`packages/daemon/test/harness.ts`), as `input-filter.test.ts` does (D3). `query/path-status.ts` calls the new module in place of its own two functions.
- [ ] (AC1, AC2) Give `TrackedInputs` a read of named root-relative paths that resolves once each has been read as an event naming it would and every event seen before the call is read, or at once while a reconciliation runs or as soon as one begins (D1), unlike `settled()`, which waits a reconciliation out; the ledger's count of accepted events is how "every event seen before the call" is judged, as `settled()` judges it: a path the tracker holds as a directory, or one with held inputs under it, reads each held input under it and walks nothing; any other path that is not a folder on disk is read as one event names it, which is how a new or deleted file the watcher has not reported is found; a folder with no held inputs under it reads nothing (AC2). On Windows, a named path the tracker does not hold that names nothing on disk is matched, case-folded as `liesInsideOnHost` compares names, to a held input, and that input is read, so a just-deleted file named in another letter case is still found deleted (C42). The declaration file (`rt-test.json` at the root) is never read by name: it is not an input, and its event path asks for a reconciliation, which a status would otherwise start at every call (§ Known limits). Route each through the tracker's event path (`#changed`, or what 2.3g's extraction names it), so exclusions, the declaration file, declared non-inputs, the ledger and the access-time rule apply unchanged; resolve at once when the tracker has stopped. While re-authoring the queued reads, move the queue and the quiet set behind `QueuedReads` (enqueue, enqueue quietly, take a batch) so one class owns the rule that an event before a quiet path's read clears it, give `QueuedReads` the tracker's `AbortSignal` rather than its `AbortController`, and use `#label` for every root-relative label it computes; D1960 and D1961 anchor on the signal and label lines, so re-anchor them.
- [ ] (AC1, AC2, AC3) In `packages/daemon/src/daemon/lifecycle.ts`, answer `pathStatus` late (ticket 2.4): resolve the path (AC3), read it through the tracker (AC1, AC2), then compose the answer from the store and `inputs.current()` read after the reads have settled, with no await between that read and the answer (C160). A refused path answers its refusal without reading anything. Abort nothing on the tracker when the request's signal aborts: the reads are the tracker's own and finish for every later reader.
- [ ] (AC4) In `packages/daemon/src/query-client.ts`, send the path-status request with `PATH_STATUS_BOUND_MS`, 60 s (D2), as `DaemonConnection.request`'s bound (2.4 AC6), declared beside it and labeled a target (C3); `querySummary` keeps the default.
- [ ] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files and `bun run typecheck` across the repository, which reports each stand-in `TrackedInputs` and the handlers break (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `rootRelativePath`, `canonicalPath` (`query/path-status.ts`): today's resolution, which the new module takes over whole; `realPath`, `liesInside`, `relativePosixPath`, `ROOT_PATH` (`vitest/find-workspaces.ts`).
- The tracker's event path (`InputTracker.#changed`) and `settled()` (`EventLedger.waitForRead`): the read AC1 asks for is exactly what an event does, and the wait is exactly `settled()`'s.
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

#### Measured facts

Spike at 13:24 on 2026-09-28, Node 24.19.0 on Windows 11, over a file `...\spell2\LongDirectoryName\SomeLongFileName.test.ts` under the scratch folder, since deleted:

- `realpathSync.native` of the file in lowercase: `C:\source\...\spell\LongDirectoryName\SomeLongFileName.test.ts`, and `statSync(...).isFile()`: `true`. Case resolves.
- Of its 8.3 short name `C:\source\RT-TES~1\wt-1\_AGENT~1\SCRATC~1\CREATE~1\spell2\LONGDI~1\SOMELO~1.TS` (from `Scripting.FileSystemObject`'s `ShortPath`): `C:\source\rt-test-wt\wt-1\_agent-docs\.scratch\create-ticket\spell2\LongDirectoryName\SomeLongFileName.test.ts`, and `isFile()` `true`. An existing 8.3 spelling resolves.
- Of the file with a trailing `.`, a trailing space, or `. .`: `THROWS ENOENT` from both `realpathSync.native` and `statSync`. Node does not strip them (it passes the long-path form), so today's `canonicalPath` keeps such a name as a missing tail and answers for a file that is not the one meant; for `package.json.` selection would not see a manifest.
- Of a missing file `GONE.TS` under the 8.3 directory spelling: `native throws ENOENT`, `stat throws ENOENT`; `canonicalPath`'s climb then resolves the existing 8.3 directories to their long names and keeps only `GONE.TS` as given.

Commands: a scratch `.mjs` creating the file and probing each spelling, and a PowerShell probe taking the short name from `(New-Object -ComObject Scripting.FileSystemObject).GetFile(path).ShortPath` and running `node probe.cjs <path>`, which printed the lines above.

#### Design notes

- **Why read through the event path.** A named read must mean exactly what the event it stands in for would have: the same filter, the same declared non-inputs, the same access-time rule, the same job marks and revision. Routing it through the tracker's event path gives that with no second rule (C8); a separate read would drift.
- **Why a status never waits for a reconciliation (D1).** While one runs, no fingerprint can be computed and every result reads unknown with its reason, which is already correct and never false freshness, and the reconciliation reads the named file itself. Status is a call agents make constantly, with a target of 100 ms end to end (`docs/plan.md` § Targets), so it must not block for a reconciliation; blocking until results are current is the wait's job (2.4b). So the named read waits only for its own reads and the events before it, never for a reconciliation.
- **A stopped tracker cannot answer current.** The tracker stops only inside the lifecycle's stop sequence (`lifecycle.ts` `#stopSequence`, the tracker's stop), after 2.4's stop signal has answered every pending request with the stopping error, and a stopped tracker's condition makes every fingerprint unavailable (`current-inputs.ts`: `STOPPED_REASON`), so a named read that resolves at once on a stopped tracker leaves nothing to read as current (review Q1, settled by fact).
- **Why a folder reads only what the tracker holds.** Reading each held input under the folder catches an edit to any of them the watcher has not reported, at the cost of hashing them, which for the root is every input, as a reconciliation reads them. Walking the folder would also find new files, but that is a reconciliation's job, and the orchestrator ruled it out.
- **Why the refusal is Windows only.** On Linux a trailing dot or space, or `~1`, is an ordinary part of a name, and the file it names is that file; on Windows the name is ambiguous: Node keeps a trailing dot or space and finds no such file (§ Measured facts) where the caller most likely meant the name without it, and an 8.3 form may stand for a long name that no longer exists, which no real-path lookup can recover.
- **Scope of the analysis.** Analyzed: a file saved before the request with no event yet, an unchanged file, a folder, a reconciliation running when the request arrives or beginning before its reads are read, the tracker stopped, a stop while the request is pending (2.4 AC3 answers it), and each Windows spelling measured. Not analyzed: `summary`, which names no path and keeps today's window (§ Known limits); the cost of a status of the root on a large consumer, a target for 2.5's corpus to measure.

#### Known limits

- **An edit the watcher has not yet reported, to a file the query does not name**, is not seen by `summary` or by `status` until the event arrives or the next reconciliation reads it (orchestrator, 13:26).
- **A new file under a folder** whose creation no event has reported is not read by a status of the folder (AC2).
- **An unreported edit to `rt-test.json`** is not read by a status naming it: the declaration file is not an input, and reading it by name would start a reconciliation at every such status; its event, or the next reconciliation, reads it.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.4d` over this ticket's files (13:27) named 2.3f, 2.3g, 2.3h and 2.3i (by folder, and 2.3g and 2.3i by `path-status.ts`, which each only reads through `queryBasis`), and 2.4 (`query-client.ts`, whose callers it leaves on the default bound). Each bullet names when it builds relative to this ticket:

- **2.3g** (authored, not built): extracts from `input-tracker.ts` before adding to it; this ticket's named read goes where that extraction leaves room.
- **2.3f, 2.3h, 2.3i** (authored, not built): write `input-tracker.ts`, `lifecycle.ts` and the query files; none reads a named path or resolves a caller's path.
- **2.4** (ready-for-dev): the late answer this ticket's `pathStatus` returns, the request's abort signal, and `DaemonConnection.request`'s bound AC4 passes.
- **2.4b** (backlog, builds after this ticket): the wait, which calls this ticket's resolution for each path it is given (refusing the wait whole when any is refused) and this ticket's named read before it binds.
- **2.6** (backlog): the `changes` query, which resolves its paths through this ticket's module (sprint file § 2.6).

#### Sizing

About 13 raw files and 17 estimated; code units 5 (4 criteria plus validation). Production: `query/caller-paths.ts` (new), `query/path-status.ts`, `inputs/input-tracker.ts`, `inputs/queued-reads.ts` (the queue and quiet set move behind it, 4df0528), `daemon/lifecycle.ts`, `query-client.ts`. Tests, for create-tests: `query.test.ts` (the resolution and its refusals), `input-tracker.test.ts` (the named read), `lifecycle.test.ts` (its `StandInInputs` gains the read; path status answers late), `daemon.test.ts` (a real daemon: save, then status at once), `server.test.ts` (a path status expected at once), `packages/cli/test/cli.test.ts` (the CLI's status against a real daemon, and the bound), and `packages/daemon/test/defects.json`. Over 10 estimated, so dev delegates, in two groups on disjoint files: the resolution (`caller-paths.ts`, `path-status.ts`) and the read (`input-tracker.ts`, `queued-reads.ts`, `lifecycle.ts`, `query-client.ts`).

#### Current structure of the modified files

As of wt/1 at 47e8d89, before 2.3g to 2.4 land.

- `packages/daemon/src/query/path-status.ts` (198 lines): `pathStatusAnswer(absolutePath, results, daemon, inputs)` resolves the path with the private `rootRelativePath` (the root's real path, then `canonicalPath`, refusing a path outside the root) and answers through `queryBasis`; `canonicalPath` climbs to the nearest existing ancestor's real path and joins the missing names as given.
- `packages/daemon/src/inputs/input-tracker.ts` (521 lines on main at 061bae8, after 2.3g): `#changed(path, kind)` stays here, dropping the declaration file (asking for a reconciliation), excluded paths and declared non-inputs, and queuing the rest; the queue (`#queue`, a `Map` of path to event kind) and the quiet set (`#quiet`) are still tracker fields, handed to the `QueuedReads` it constructs (`#reads`) along with its `AbortController` (`abort: this.#abort`); `settled()` is `this.#ledger.waitForRead()`, which resolves once the events accepted by then are read and no reconciliation runs. The move behind `QueuedReads` (4df0528's amendment to the AC1/AC2 task) starts from this state.
- `packages/daemon/src/inputs/queued-reads.ts` (180 lines, extracted by 2.3g): `QueuedReads` reads the paths events named between reconciliations into the input state, marking each job a change can affect; it holds the tracker's `AbortController` and the quiet set it was handed, and computes root-relative labels itself. D1960 (`filter.check(unknown, this.#abort.signal)`) and D1961 (`this.#jobs.recordCause(this.#label(path))`) in `packages/daemon/test/defects.json` anchor in it.
- `packages/daemon/src/daemon/lifecycle.ts` (357 lines before 2.3g): `pathStatus(path)` answers `pathStatusAnswer(path, this.#latestResults(), this.#view(), this.#parts.inputs.current())` at once.
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
- `docs/architecture.md`, the input tracker paragraph's known limits, the text the orchestrator named: "an edit the watcher has not yet reported, to a file the query does not name", and beside it: "an edit to `rt-test.json` the watcher has not yet reported, which a status naming it does not read".

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

- _agent-docs/tickets/2-4d-read-named-paths.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.4d added; § 2.4b and § 2.6 repointed to it; the split note extended; under the orchestrator's 12:18 grant)
- _agent-docs/sprint-status.yaml (2-4d-read-named-paths added)
- _agent-docs/tickets/2-4-late-answers.md (2.4d named as the first production late answer, and in the build order)
- docs/requirements.md (FR5 and NFR3 markers gain 2.4d): written by the orchestrator at 13:30

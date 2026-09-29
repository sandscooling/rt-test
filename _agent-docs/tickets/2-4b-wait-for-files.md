# Ticket 2.4b: Wait for files

## Ticket

As a coding agent that has just saved some files,
I want to ask the daemon once and be answered when the tests covering those files have current results, or cannot get them, or my inputs moved again, or my time ran out,
so that I never run tests myself, never read a pre-edit result as current, and always get an answer before my shell tool gives up on the call.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: A wait first reads each named file through ticket 2.4d's named read, then binds to the input revision the daemon holds once those reads and every input event seen before the request have been read and no reconciliation runs, so a file saved before the request, whose change the watcher has not yet reported, belongs to that revision. Every answer names the bound revision and the revision it was given at.
- [ ] AC2: The tests covering a named file are every test of each Vitest workspace that selection, at the bound revision, selects for a change of that file, over the dependency information built at that revision (ticket 2.3g), so a new or deleted file is covered as its change would select, together with each discovered workspace whose fingerprint lists that file outside selection: a test module or an env file (ticket 2.3m) the discovery in effect lists for it, whatever git ignores, so a file whose edit stales a workspace is never answered as covered by no test. While that revision's dependency build has not ended, the wait keeps waiting. While there is no dependency information for the discovery in effect (the build failed, or the discovery yields no selection input), every discovered workspace covers every named file, and the answer names that widening and what caused it for each file. A named file no workspace covers, such as a declared non-input, is answered as covered by no test, with selection's reason, and never counted as a success; a workspace selection names but cannot run (unsupported, not confirmed) is listed with its reason.
- [ ] AC3: The wait answers settled once, at the input revision current then, each covering workspace either holds results that read current, or has nothing coming: it is idle and ticket 2.3i says why no run is coming (not until the next input change, only at a periodic retry, or only when the daemon tries a held round again at the next input event or reconciliation, which the answer names), its discovery failed, or it cannot run. It never answers settled while the inputs are unsettled, meaning no current fingerprint can be computed for any reason (events unread, a reconciliation or a protection walk running, the watcher unhealthy, or the input set not established), while a round is pending (for any wait 2.3i's schedule names: the first reconciliation, the quiet window, the inputs settling, a dependency build, a rediscovery or a job in progress, or while no discovery is stored yet), or a covering workspace is queued, running or interrupted. Pending waits are judged again whenever the schedule, a stored run or discovery, the input revision, a dependency build, or whether the inputs are settled (a reconciliation ends, the watcher recovers, the input set is established) changes, so a wait answers as soon as the change that settles or supersedes it lands.
- [ ] AC4: The wait answers superseded once, at a revision after the bound one whose dependency build has ended, an input of any workspace covering the named files at the bound revision or at that later one differs from the bound revision's (changed, added or removed); the answer names that revision and the differing paths, up to a named bound, counting the rest. A change only to inputs no covering workspace reads leaves the wait waiting. When the input revision moves before the bound revision's dependency build has ended, the bound revision's covering set cannot be known, so every discovered workspace is taken as covering, and the wait answers superseded at once, naming the newer revision and the paths changed since the bound one. A cause that names no path (a watcher failure, an input set that cannot be established) does not supersede it: it leaves the inputs unsettled, so AC3 keeps it waiting. The wait never rebinds itself.
- [ ] AC5: A wait ends at its time limit, `WAIT_LIMIT_MS`, 100 s by default, a named constant labeled a target, which a caller may set to any whole number of ms from 1 up to a named maximum, `MAX_WAIT_LIMIT_MS`, timed from the request's arrival, with its own answer, unsettled: it names the bound revision, the revision it was given at, and each covering workspace's execution state as ticket 2.3i gives it, so the caller can wait again. A limit that passes before the wait has bound, or before the bound revision's covering set is known, answers unsettled with no bound revision or with the coverage marked not yet known, naming every confirmed workspace's execution state, never an empty coverage (C12). Unsettled is neither superseded nor a failure.
- [ ] AC6: A settled, superseded or unsettled answer carries, for each named file, its covering workspaces with selection's reason, or why none covers it; the counts by state and by freshness of every covering test, each test counted once however many named files it covers; each covering workspace's execution state and, when its results are not current, why; up to `MAX_NAMED_FAILURES`, 20, covering tests that failed or errored and covering modules that failed to load or crashed in their workspace's latest stored run, each with the first line of its first recorded error, counting the rest; and the context every summary and path-status answer carries.
- [ ] AC7: A wait names at least one path and at most `MAX_WAIT_PATHS`, 1,000. Each path is resolved through ticket 2.4d's resolution, and a wait naming any path that is refused (outside the consumer root, a directory, a spelling 2.4d refuses on Windows) or more paths than the bound is refused whole, naming each refused path and why, before anything is read.
- [ ] AC8: `queryWait` in `@rt-test/daemon/client` sends a wait for absolute paths with an optional limit, and resolves with the daemon's answer, waiting for it up to the limit plus `RESPONSE_BOUND_MS`. It rejects with a reason when no daemon serves the worktree, when the daemon predates the wait, when the daemon is stopping or stops while it waits, and when the wait is refused.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It composes selection (`selectTests`), 2.3g's narrowed inputs, 2.3i's schedule, 2.4's late answers and 2.4d's reads, all this repository's own.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read the landed code of tickets 2.3g (`daemon/dependency-builds.ts`, `inputs/narrowed-inputs.ts`, the narrowing state), 2.3f (`daemon/scheduler.ts`, the round), 2.3i (the schedule each answer carries, and its constants), 2.4 (the late answer, the handlers' signal, `DaemonConnection.request`'s bound) and 2.4d (`query/caller-paths.ts`, the tracker's named read), and confirm the names this ticket uses. Check `lifecycle.ts`'s line count: the wait's state goes into modules of its own (P16, P18).
- [ ] (AC5, AC7, AC8) In `packages/daemon/src/daemon/protocol.ts`, add `WAIT_TYPE`, a `WaitRequest` carrying absolute `paths` and an optional `limitMs`, and `WaitResponse` as the wait answer plus type and protocol version; `PROTOCOL_VERSION` stays 2, since an older daemon answers the new type with the unknown-request error. In `packages/daemon/src/daemon/server.ts`, route it to a new `DaemonHandlers.wait(request, signal)`, answered late through 2.4's queue; refuse a request whose paths are not a non-empty array of absolute strings, more than `MAX_WAIT_PATHS`, or whose limit is not a whole number of ms from 1 to `MAX_WAIT_LIMIT_MS`, with the invalid-request error.
- [ ] (AC1, AC2, AC3, AC4, AC5) Create `packages/daemon/src/daemon/waits.ts`, owned by the lifecycle: it resolves each path through 2.4d's resolution and refuses the wait whole on any refusal with the invalid-request error, whose message names each refused path and 2.4d's reason for it, and `queryErrorReason` keeps that message in `queryWait`'s rejection (AC7, AC8); reads the paths through 2.4d's named read, then awaits `settled()`; when the named read resolved without reading because a reconciliation ran (2.4d D1), reads the paths again and awaits `settled()` again, since that reconciliation may have read a file before the caller's save; and binds to the revision read in the same turn `settled()` resolves (AC1, C160); holds each pending wait with its bound revision, the committed input snapshot of that revision, and, once that revision's build has ended, the covering workspaces and each one's narrowed inputs at it (AC2); judges every pending wait again on each change the lifecycle signals, in AC4's order and then AC3's, and answers through the wait's promise; arms one timer per wait for its limit when the request arrives, before the named read (AC5), cleared when it answers; and on the wait's signal (a stop or a client that left, ticket 2.4) forgets it and clears its timer. Name `WAIT_LIMIT_MS` (100 s, a target), `MAX_WAIT_LIMIT_MS` (1 hour) and `MAX_WAIT_PATHS` (1,000) in `protocol.ts` beside `RESPONSE_BOUND_MS`, since `server.ts` validates against two of them and `queryWait` needs the default (C3, C4).
- [ ] (AC2, AC3, AC5, AC6) Create `packages/daemon/src/query/wait-answer.ts`: from the stored latest results, the view, the current inputs, 2.3i's schedule and the selection for the named files, decide whether each covering workspace is settled (AC3) and compose the answer (AC6). Export one coverage function that takes each file's covering workspaces from `selectTests` with the named files as the change; `waits.ts` calls it once per judged revision whose build has ended, and the answer reuses the result for the latest such revision, so AC4's covering set and AC6's are one. It selects over 2.3e's selection input and 2.3g's dependency information for the discovery and revision (the `ChangedPathReport` per path: `selected`, `notRunnable`, `nothingSelected`), never a second rule (C8); while there is no dependency information, every discovered workspace covers every file with the widening reason 2.3g gives (C11, C129). Add to each file's covering workspaces every discovered workspace whose fingerprint lists the file: the test modules the discovery lists for it (`workspaceTestModules`, `inputs/non-inputs.ts`) and the env files it lists (2.3m's listing in `inputs/env-files.ts`), taken from the same listings the fingerprint digests rather than a second rule (C8), each with a reason naming which listing covers it; such a file is never answered as covered by no test, even when selection selects nothing for it (AC2). Take the counts from `queryBasis`' standings filtered to the covering workspaces and `countStandings`; the context from `queryBasis`; the named failures from each covering workspace's latest stored run (its tests' `errors` and its modules' `errors`), cut by `MAX_NAMED_FAILURES` with a count of the rest (C22, C24), each error's first line cut as `cutReason` cuts a reason. Declare `MAX_NAMED_FAILURES` and the bound on AC4's listed paths here, or reuse 2.3i's bound on changed paths if it fits (C14, C23).
- [ ] (AC4) In `waits.ts`, judge superseded at each later revision whose dependency build has ended: for each workspace covering the named files at the bound revision or at that one, compare its narrowed input digests at the two revisions (2.3g's narrowing state; the whole project's inputs wherever there is no dependency information, a failed build or a discovery that yields no selection input, as AC2 states). When the input revision moves before the bound revision's dependency build has ended, which 2.3g allows (a build during which an input changed is discarded, and the next is built at the revision current once the tracker settles), the bound revision's covering set is unknown, so it is taken as every discovered workspace (widening, C126), and the wait answers superseded at once, naming the newer revision and every path whose digest differs from the bound revision's snapshot, and list every path whose digest changed, appeared or disappeared. Keep the bound revision's snapshot referenced only while the wait is pending.
- [ ] (AC3, AC4) Give the waits the change signals they need, without a timer: in `packages/daemon/src/daemon/lifecycle.ts`, signal after each stored run or discovery and each job that stored nothing; take the tracker's revision signal and the dependency builds' end from 2.3g; and, while any wait is held only by unsettled inputs, await `settled()` and judge again when it resolves, which covers a reconciliation that ends with nothing changed and the watcher health and input set it re-establishes, with no change to the tracker; in `packages/daemon/src/daemon/workspace-schedule.ts`, where `WorkspaceSchedule` records the round (`ROUND`: pending with its `ROUND_WAIT`, planned, held) and each workspace's execution, signal whenever that record changes (a round begins, is planned, is held or ends; a workspace is queued, runs or is interrupted). One signal, "the daemon's state moved", is enough: the waits recompute from what they read (C8).
- [ ] (AC1 to AC8) In `packages/daemon/src/daemon/lifecycle.ts`, implement `DaemonHandlers.wait` by handing the request and its signal to the waits; in `packages/daemon/src/query/answer.ts`, declare the wait answer (`WaitAnswer`: its outcome, `settled`, `superseded` or `unsettled`, as exported constants with a members record, as `TEST_STATES` is; the per-file coverage; the counts; the named failures; the workspaces; the revisions; and `AnswerContext`), taking selection's shapes from `selection/selection-types.ts` (`SelectionReason`, `NotRunnableWorkspace`, `NoSelectionKind`) rather than restating them (C14).
- [ ] (AC8) In `packages/daemon/src/query-client.ts`, add `queryWait(consumerRoot, paths, options?)`, sending a `WaitRequest` and passing the limit, or `WAIT_LIMIT_MS` when the caller gives none, plus `RESPONSE_BOUND_MS` as `DaemonConnection.request`'s bound (2.4 AC6); its errors go through `queryErrorReason`, as the other queries' do. Export it and the wait answer's types from `packages/daemon/src/client.ts`.
- [ ] (Support) Send the orchestrator the doc text in § Doc text, with the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files and `bun run typecheck` across the repository (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `selectTests` (`selection/select-tests.ts`) and its `ChangedPathReport` (`selection/selection-types.ts`): each named file's covering workspaces and reasons, the decision 2.3g narrows fingerprints by (AC2, C8).
- 2.3g's dependency builds and narrowing state (`daemon/dependency-builds.ts`, `inputs/narrowed-inputs.ts`, `inputs/current-inputs.ts`): the dependency information at a revision, whether its build has ended, and each workspace's narrowed inputs (AC2, AC4).
- `Narrowing.placement` (`BuildPlacement`, 2.3h, `inputs/narrowed-inputs.ts`): places given paths by one build, and serves only a view whose inputs selection took (`inputsNotNarrowed` unset), since a refusal of a revision's inputs widens every workspace.
- 2.3e's `buildSelectionInput` (`selection/selection-input.ts`): selection's input for the discovery in effect.
- 2.3i's schedule (`ScheduleReader` and `WorkspaceSchedule` in `daemon/workspace-schedule.ts`; `ScheduleFacts`, `EXECUTION_STATE`, `IDLE_REASON` (`retry-pending`, `no-run-until-input-change`, `round-held`), `ROUND` and `ROUND_WAIT` in `query/answer.ts`; every answer's `schedule` and `latestSelection`): each workspace's execution state, why an idle one has no run coming, and what a pending round waits for (AC3, AC5, AC6). Its bound on explained changed paths, `MAX_EXPLAINED` (20), is private to `workspace-schedule.ts`; export it only if AC4's list reuses it (C14, C23).
- `queryBasis`, `countStandings`, `cutReason` (`query/summary.ts`, `query/test-states.ts`): the context, standings and counts every answer shares, and how a reason is cut.
- `ProjectInputs` (`inputs/fingerprint.ts`): a committed snapshot of input digests (AC4).
- 2.4's late answer, handler signal and client bound; 2.4d's caller-path resolution (`query/caller-paths.ts`) and the tracker's named read.
- `queryErrorReason`, `onProvenConnection`, `requireAnswer` (`query-client.ts`, `daemon/proven-connection.ts`): the client path the other queries take.

### Must Create

- `daemon/waits.ts`: the pending waits, their binding, re-judging, superseding and limit (AC1 to AC5).
- `query/wait-answer.ts`: the settle judgment and the answer (AC2, AC3, AC6).
- `WAIT_TYPE`, `WaitRequest`, `WaitResponse`, `DaemonHandlers.wait`, `WaitAnswer`, `queryWait` (AC7, AC8).
- `WAIT_LIMIT_MS`, `MAX_WAIT_LIMIT_MS`, `MAX_WAIT_PATHS`, `MAX_NAMED_FAILURES` and AC4's bound on listed paths.
- The "daemon state moved" signal from the lifecycle and the scheduler (AC3, AC4).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

One of the tickets the original 2.4 (wait for files) became (orchestrator, 2026-09-28 12:18 and 13:26). Ticket 2.4 lets the daemon answer late; 2.4d reads the paths a query names and resolves a caller's paths; this ticket is the wait and its programmatic API; 2.4c is the `rt-test wait` command. Build order: 2.3g, 2.3f, 2.3h, 2.3i, 2.4, 2.4d, 2.4b, 2.4c.

Requirement this ticket delivers with 2.4c (`docs/requirements.md`):

- "FR9: Answer `wait <files>` once every test covering those files has a current result or an explicit non-current state, as superseded when a covering input changes after the call, or as unsettled, naming each covering workspace's execution state, when its time limit passes first." (AC1 to AC8)
- "NFR3: Never report a result as current unless its stored input fingerprint matches the current inputs." (AC1)

Rule clauses the criteria rest on:

- `docs/architecture.md` § Query surface: "A wait binds to the input revision at call time and returns when every test covering the files has a current result or an explicit non-current state, or as superseded, naming the newer revision, as soon as a covering input changes, or as unsettled, naming each covering workspace's execution state, once its time limit passes. The default limit stays under the two minutes a coding agent's shell tool commonly allows a command, so an agent always gets an answer and can wait again." (AC1, AC3, AC4, AC5)
- AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states. A zero-test selection is not proof of success." (AC2, AC6)
- AGENTS.md § Product guarantees: "Widen selection when dependency information is uncertain." (AC2)
- `docs/architecture.md` § Query surface: "Read operations never trigger execution." (the wait starts no job; a named read that finds a changed file moves the revision, as its event would have, and the scheduler decides what runs)
- `project-context.md` P32: "The CLI and programmatic API query results or wait for a revision scoped to given files, and never spawn Vitest."

Glossary (`docs/glossary.md`), verbatim:

- **Wait**: "A query that returns once every test covering the given files has a current result or an explicit non-current state, or earlier as superseded or unsettled."
- **Superseded**: "A wait's answer when a covering input changed after the call, naming the newer input revision to wait on."
- **Unsettled**: "A wait's answer when its time limit passed before every covering test had a current result or an explicit non-current state, naming what each covering workspace is still doing."
- **Input revision**: "The number naming a worktree's inputs as the daemon last observed them in its current life, raised once for each batch of changes it observes."
- **Selection**: "The tests a change requires running, each with its reason."

#### Orchestrator rulings

Asked by `session_wake` at 12:18 on 2026-09-28, answered at 12:18; decider the orchestrator unless marked. Each reason is the orchestrator's where it gave one.

- Q1 (AC1): the wait reads each named file first, and binds once that read and every earlier event are settled (NFR3).
- Q2 (AC2): covering tests are every test of each Vitest workspace selection selects for the file at the bound revision, widening to every discovered workspace while there is no dependency information; a file nothing covers is answered as covered by no test with selection's reason, never as success.
- Q3 (AC3): the settle rule as AC3 states it; waits are judged again on each change of the schedule, the store, the revision or a build, never on a timer; a pending periodic retry does not hold the wait, and the answer names it.
- Q4 (AC4): superseded as AC4 states it; a cause that names no path does not supersede, and leaves the inputs unsettled, so Q3 keeps the wait waiting; no rebind.
- Q5 (AC5; decider: the owner, 12:18, recorded 13:18): the default limit is under 2 minutes, about 100 s, so an agent always gets an answer before its shell tool kills the call at 2 minutes; callers may pass a longer limit; on the limit the wait answers unsettled, naming each covering workspace's execution state, so the agent can wait again. FR9, the glossary and architecture's § Query surface carry it (orchestrator, 13:19).
- Q6 (AC6): up to 20 named failures with the first line of each first error, counting the rest.
- Q7 (2.4c's): exit 0 for every answer, 1 only for no answer; agents read the outcome from the JSON.
- Q8 (AC7): the Windows spellings are resolved by the piece that first takes caller paths; at 13:26 that became 2.4d, which this ticket calls.
- Q9 (AC7): files only; a directory is refused, as are more paths than a named bound.
- Refuse whole (13:26; AC7): a wait naming any refused path is refused whole, naming each refused path.
- W1 (grill, asked 13:35, answered 13:35; AC3): the inputs are unsettled while no current fingerprint can be computed for any reason; a persistently unhealthy watcher runs the wait to its limit, which answers unsettled naming the watcher's reason, a known limit, never a guess that the failure persists.
- W2 (grill, 13:35; AC5): `MAX_WAIT_LIMIT_MS` is 1 hour; a limit outside 1 ms to 1 hour gets the invalid-request error.
- Ticket review (create-ticket 6c, 13:35 to 13:39): 11 findings, all applied. F1 lets a caller set any limit from 1 ms, timed from the request's arrival; F2 carries each refused path's reason to the client; F3 puts the wait's constants in `protocol.ts` so the client has the default; F5 judges waits again when the inputs settle with no new revision, through `settled()`; F6 reads the named paths again after a reconciliation the first read skipped, then binds; F7 and F9 widen, and name the widening, for both kinds of missing dependency information; F8 makes coverage one function; F11 widened the broken-test search and dropped two counts. Two questions were settled by create-ticket toward widening: F4, a limit passing before the wait binds or knows its coverage, answers unsettled with coverage not yet known, naming every confirmed workspace; F10, a bound revision whose build never ends because 2.3g discards a build the revision overtakes (2.3g AC2), answers superseded at once when the revision moves, taking every workspace as covering. The orchestrator agreed F10 and F4 at 13:40.
- 2.3i landed (orchestrator's request, 18:34 on 2026-09-29, from 2.3i's review): `PROTOCOL_VERSION` stays 2, the version 2.3i raised it to; AC3's nothing-coming list gains a round held after a failed scheduling step, which 2.3i retries at the next input event or reconciliation and names with the idle reason `round-held` (ruled 17:57); the schedule's names follow the landed code (`WorkspaceSchedule` in `daemon/workspace-schedule.ts`, which replaces `scheduler.ts` in the signal task and the file lists, and `IDLE_REASON`, `ROUND`, `ROUND_WAIT` in `query/answer.ts`), and AC3's pending round names every `ROUND_WAIT`. Q (asked by the orchestrator at 18:34): does a held round keep a wait from answering settled, as a pending periodic retry does not? A (decider: create-ticket, 18:35, the orchestrator's lean): no, it does not hold the wait. Reason: AC3 settles a workspace with nothing coming now, and Q3 already ruled that a periodic retry does not hold a wait; a held round is retried only at the next input event or reconciliation, which is no nearer. An input event that moves the revision judges the wait again anyway (superseded, or settled at the new revision, AC4), and holding the wait would only run it to its limit to give the same states as unsettled.
- Listed files cover (asked by the orchestrator at 16:41 on 2026-09-29, from 2.3m's authoring; decided by create-ticket at 16:43; AC2): after 2.3m, each env file Vite loads for a workspace is an input of its fingerprint whatever git ignores, as a listed test module is, and selection places no such file, so a wait on `.env.local` would have answered covered by no test although its edit stales that workspace. A workspace whose fingerprint lists a named file (a listed test module or env file) now covers it beside selection's workspaces, since a wait's coverage must never be narrower than staleness (NFR3; "A zero-test selection is not proof of success"). No named read is added for such a file: 2.3m reads it afresh at each fingerprint's composition, so answers see its edit without an event (§ Known limits for what that leaves). The orchestrator agreed at 16:43.
- Q (asked by create-ticket at 16:43 on 2026-09-29): 2.3m is not ordered before this ticket, so does this ticket cover 2.3m's env files, or does 2.3m owe that coverage? A (decider: the orchestrator, 16:43): 2.3m lands before this ticket's dev is dispatched, and the orchestrator holds that dispatch until it does; this ticket covers both listings, the listed test modules and 2.3m's env files, and 2.3m owes nothing in this ticket's code.
- Sizing (13:26): the first draft of this ticket measured about 17 raw files, 22 estimated; the named read and caller-path resolution moved to 2.4d.

#### Design notes

- **Why the wait reads first, then settles.** 2.4d's named read resolves at once while a reconciliation runs, since a status must stay fast (2.4d D1); a wait must bind to a revision whose inputs are read, so after the read it awaits `settled()`, which waits a reconciliation out, and binds then (AC1).
- **Why selection decides coverage.** After 2.3g, a path lies in workspace W's narrowed inputs exactly when selection of that path includes W; using selection's per-path report keeps "covering" and "made stale" one decision (C8), and it answers for a deleted or new file, which no input set holds.
- **Why a later revision is judged only once its build has ended.** Before that build, the later revision's covering set and narrowed inputs are unknown (2.3g AC3), and judging on the bound revision's alone would miss a workspace that now covers a named file through a new import. The one exception is a bound revision whose own build never ended: 2.3g discards a build the revision overtakes, so there is nothing to compare against, and AC4 widens to every workspace and answers superseded as soon as the revision moves.
- **Settled is judged at the current revision, not the bound one.** A later revision that changed no covering input leaves the covering workspaces' fingerprints as they were at the bound revision, so their results are current for both (AC3 after AC4 has said no).
- **Why one signal.** Every settle and supersede decision is recomputed from the store, the tracker and the schedule at the moment of the signal; a signal carrying what changed would be a second record of state that could disagree with the first.
- **Answer size.** The answer lists per named file (at most `MAX_WAIT_PATHS`), per covering workspace, and bounded failures and paths; 2.4's size check turns an answer past the line limit into the nothing-to-answer error, as for every query.
- **Scope of the analysis.** Analyzed: a save not yet reported, a new and a deleted file, a declared non-input, no dependency information, a covering workspace in each execution state, a change inside and outside the covering inputs, a path-less cause, the limit, a stop and a client that leaves (both 2.4's), and a refused path. Not analyzed: the command's text and exit code (2.4c); the cost of re-judging many pending waits at each signal, which a consumer's agents bound by how many waits they hold, a target for 2.5 to measure.

#### Known limits

- **An edit no event reports to a file a workspace's fingerprint lists outside the inputs**, such as a gitignored `.env.local` (2.3m), moves no input revision, so it never supersedes a wait. The covering workspace's results read stale from the next answer on, since the file is read afresh each time a fingerprint is composed, and the wait keeps waiting until a run over the new content lands, which the scheduler starts only at the next input revision or periodic reconciliation (ticket 2.3p owns waking it sooner), or until its limit answers unsettled. No answer reads the edit's pre-edit result as current.

- **A watcher that stays unhealthy, or an input set that stays unestablished,** keeps every wait waiting until its limit, which then answers unsettled with the reason in its context (Q4: a cause that names no path leaves the inputs unsettled).
- **A steady stream of edits to a covering workspace's inputs** keeps superseding waits on it; each answer names the newer revision, and the caller waits again.
- **A save to a file the wait does not name**, not yet reported by the watcher, is seen only when its event arrives; if it lies in a covering workspace's inputs, the wait is then superseded (2.4d's known limit).

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.4b` over this ticket's production files (13:34) named 2.3f, 2.3g, 2.3h, 2.3i, 2.4 and 2.4d, each of which builds before this ticket, so each is a shape it builds on, never a collision. With the backlog tickets that follow it:

- **2.3g** (authored): the dependency information per revision, whether a build has ended, the narrowed inputs, and the tracker's revision signal.
- **2.3f** (authored): the scheduler and its rounds, and the quiet window a pending round includes.
- **2.3h** (authored): an interrupted run, and the interrupted state.
- **2.3i** (authored): each workspace's execution state and why an idle one has no run coming, which AC3, AC5 and AC6 read; its bound on listed changed paths, which AC4 may reuse.
- **2.4** (ready-for-dev): the late answer, the handlers' signal, the stop's answer to a pending request, and the client's bound.
- **2.4d** (ready-for-dev): the caller-path resolution with the Windows refusals, and the tracker's named read.
- **2.4c** (backlog, after this ticket): the command, calling `queryWait`.
- **2.3m** (lands before this ticket's dev is dispatched; orchestrator, 16:43): the env files a discovery lists per workspace (`inputs/env-files.ts`), which AC2's coverage adds beside the listed test modules. This ticket covers both listings; 2.3m owes nothing in this ticket's code.
- **2.3p** (planned): wakes the scheduler for an edit no event reports to a listed file, which shortens the known limit below; it changes nothing here.
- **2.6** (backlog): the `changes` query, whose cursor binds to this ticket's input revision.

#### Sizing

About 14 raw files and 18 estimated; code units 9 (8 criteria plus validation). Production: `daemon/protocol.ts`, `daemon/server.ts`, `daemon/lifecycle.ts`, `daemon/workspace-schedule.ts`, `query/answer.ts`, `query-client.ts`, `client.ts`, and new `daemon/waits.ts` and `query/wait-answer.ts`. Tests, for create-tests: `server.test.ts` (routing and request validation), `lifecycle.test.ts` (the handler and signals), `query.test.ts` (settle and the answer from stand-in state), `daemon.test.ts` (a real daemon: save, wait, settled; an edit mid-wait, superseded), and `packages/daemon/test/defects.json`. Over 10 estimated, so dev delegates, in two groups: the protocol and client (`protocol.ts`, `server.ts`, `query-client.ts`, `client.ts`), then the wait (`waits.ts`, `wait-answer.ts`, `answer.ts`, `lifecycle.ts`, `workspace-schedule.ts`).

#### Current structure of the modified files

As of wt/1 at 47e8d89, before 2.3g to 2.4d land; each is re-read at the first task.

- `packages/daemon/src/daemon/protocol.ts` (280 lines): request and response types per query (`SUMMARY_TYPE`, `PATH_STATUS_TYPE`), `PROTOCOL_VERSION = 2` (raised by 2.3i), `RESPONSE_BOUND_MS`, the error codes.
- `packages/daemon/src/daemon/server.ts` (288 lines, before 2.4): `DaemonHandlers`, `versionedAnswer` routing by type, `pathStatusResponse` validating an absolute path with the invalid-request error, `queryResponse`.
- `packages/daemon/src/query-client.ts` (90 lines, before 2.4d): `querySummary`, `queryPathStatus`, `query`, `queryErrorReason`; `client.ts` re-exports the two queries.
- `packages/daemon/src/query/answer.ts` (245 lines, before 2.3g and 2.3i): `AnswerContext`, `SummaryAnswer`, `PathStatusAnswer`, `TestCounts`, the state constants and members records.
- `packages/daemon/src/daemon/lifecycle.ts` and `daemon/workspace-schedule.ts` (2.3i's schedule record): as 2.3g to 2.4d leave them.

#### Existing tests this change breaks

- `packages/daemon/test/server.test.ts`: `handlers(...)` builds `DaemonHandlers` by hand and gains `wait`.
- `packages/daemon/test/lifecycle.test.ts`: constructs the lifecycle, which gains the waits; stand-ins for the scheduler or the tracker gain what the signal needs.
- Found by `rg -ln "DaemonHandlers|DaemonLifecycle|LifecycleParts|scheduler" packages/*/test` when dev starts, and by `bun run typecheck` across the repository for any hand-built shape (P14).

#### Doc text

Dev reports this text with the build.

- `docs/architecture.md`, the query paragraph: "The daemon also answers a wait for given files: it reads each file as an event naming it would, binds to the input revision once those reads and every earlier event are read and no reconciliation runs, takes the tests covering each file from selection at that revision, widening to every discovered workspace while there is no dependency information, and answers settled once each covering workspace reads current or has nothing coming, superseded once an input a covering workspace reads differs from the bound revision's, naming the newer revision, or unsettled at its time limit, 100 s by default. Each answer names each covering test that failed or errored and each covering module that failed to load or crashed, up to 20, with the first line of its first error. `queryWait` in `@rt-test/daemon/client` sends it."

#### Previous ticket

2.4d (ready-for-dev, authored in this lane at 13:26 to 13:34): `status <path>` reads its path before answering, never waiting for a reconciliation, and a caller's path resolves through `query/caller-paths.ts`, refusing on Windows a missing name ending in a dot or space or in an 8.3 form. 2.4 (ready-for-dev): the late answer.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.4, § Ticket 2.4d, § Ticket 2.4b, § Ticket 2.4c, § Ticket 2.6.
- Tickets 2.3g, 2.3f, 2.3i, 2.4 and 2.4d (`_agent-docs/tickets/`).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (12:14).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C8,C11,C12,C14,C22,C23,C24,C30,C32,C38,C39,C40,C46,C48,C55,C59,C113,C115,C126,C129,C130,C131,C133,C157,C160 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P18,P19,P21,P32,P33 -->

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
sizing_ac_count: 9
files_to_modify:
  - packages/daemon/src/daemon/protocol.ts
  - packages/daemon/src/daemon/server.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/workspace-schedule.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/query-client.ts
  - packages/daemon/src/client.ts
files_to_create:
  - packages/daemon/src/daemon/waits.ts
  - packages/daemon/src/query/wait-answer.ts
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

- _agent-docs/tickets/2-4b-wait-for-files.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.4b written with the rulings at 12:21 to 13:34 and linked, under the orchestrator's 12:18 grant)
- _agent-docs/sprint-status.yaml (2-4b-wait-for-files added at 12:21, set ready-for-dev)
- docs/requirements.md (FR9 amended), docs/glossary.md (Wait amended, Unsettled added), docs/architecture.md (§ Query surface): written by the orchestrator at 13:19 from this lane's drafts

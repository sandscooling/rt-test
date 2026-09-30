# Ticket 2.6: Changes since a cursor

## Ticket

As a coding agent's hook, or an agent asking in its shell,
I want to ask the daemon once, through `queryChanges` in code or `rt-test changes <files> --since <cursor>`, which tests covering the files I edited changed state or freshness since my previous answer, failures and recoveries first, with counts for the rest,
so that I learn at once when my edit broke or fixed a test, never read a pre-edit result as current, never start a test, and any agent harness's hook only has to parse its own payload and print what this answer gives.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: A `changes` request names at least one path and at most `MAX_CHANGES_PATHS`, 1,000, and optionally a cursor, a non-empty string of at most a named number of characters. Each path resolves through ticket 2.4d's resolution (`resolveCallerPath`), and a request naming any path that resolution refuses, or that resolves to a directory, is refused whole, naming each refused path and why, before anything is read. A request past either bound, or with a cursor that is not such a string, is refused.
- [ ] AC2: Before it answers, the daemon reads each named path through ticket 2.4d's named read, as `status <path>` does, so a file saved just before the call is never answered from its pre-edit result as current (NFR3). It answers at once, never waiting for a reconciliation, a dependency build or a run, and starts no job of its own: the named read moves the input revision as the file's own event would, and the daemon schedules from that revision exactly as it would from the event. A named path the read found but could not read leaves the answer not determined (AC3), naming that path and its reason.
- [ ] AC3: An answer is determined when a fingerprint can be computed now (the inputs are not unavailable to every workspace, as they are while the first reconciliation has not ended, a reconciliation or a protection walk runs, changed paths wait to be read, the watcher is unhealthy, or the input set cannot be established), the named read left no path unread, and the dependency build deciding the current input revision's inputs has ended; a build that failed or timed out, dependency builds that stopped working, and a discovery that yields no selection input each count as ended, as ticket 2.3g widens for them. A not-determined answer carries no changes, no coverage and no counts, in scope or outside it, names why, and returns as its cursor the one it was given when that cursor is usable (AC7), otherwise the cursor of the latest moment the daemon recorded (AC7), or no cursor when it has recorded none in its current life. Every answer names the input revision it read.
- [ ] AC4: At a determined moment, the tests in scope are every test of each discovered workspace covering a named file at the current input revision, as ticket 2.4b's coverage decides it for a wait: selection over the dependency information built at that revision, together with each workspace whose fingerprint lists the file and the env-file widening, and every discovered workspace while there is no dependency information, the answer naming that widening and its cause. The answer gives each named file's covering workspaces with selection's reason, or why none covers it; a named file no workspace covers is covered by no test and never counted as a success, and a workspace selection names but cannot run is listed with its reason.
- [ ] AC5: A determined answer given a usable cursor lists each change in scope since that cursor: each test in scope whose state or freshness now differs from its standing at the cursor, including a test with no standing then (a discovery added it) or none now (a discovery dropped it), and each entry RT Test could not discover (the `notDiscovered` entries a summary lists) of a covering workspace that appeared or went away since the cursor. A test is in scope when its workspace covers a named file now, whichever standing it has, so a test a discovery dropped is judged by the workspace it belonged to; an entry is in scope when it names a covering workspace, and one that names no workspace (a workspace source not read) is in scope for every call. Only the net change counts: a test whose standing changed and changed back between the cursor and now is not listed. Each listed change names its test or entry, its standing at the cursor and now, and its kind: `failing` when the test now stands `failed`, `error`, `module-crashed`, `module-failed-to-load`, `run-failed` or `run-crashed` and either its state changed since the cursor or its result now reads current, or an entry of kind `failed-module`, `workspace-discovery-failed` or `workspace-unhandled-errors` appeared; `recovered` when the test now stands a current `passed` and stood in one of those failing states at the cursor, whatever its freshness then, or such an entry went away; `other` otherwise. A failing change carries the first line of the first error recorded for it. Failing changes are listed first, then recovered, then the rest, up to `MAX_LISTED_CHANGES`, 20, and the rest are counted by kind.
- [ ] AC6: A determined answer counts the tests in scope by state and by freshness, each test once however many named files it covers, and the tests outside scope by state and by freshness, with how many of them changed since a usable cursor, so the two sets add up to every discovered test. Every answer, determined or not, carries the context every summary and path-status answer carries, which names a discovery ticket 2.3l holds.
- [ ] AC7: Every determined answer returns a cursor naming the standings it read, which the daemon records, and the next call given that cursor lists the changes since it (AC5). A cursor is usable while this daemon issued it in its current life and fewer than `MAX_RECORDED_CHANGES` (a target) test or entry changes have been recorded after it. A call given no cursor, a cursor this daemon did not issue in its current life (an earlier life's, or any other string), or a cursor past that bound gets a baseline: no change listed, why the cursor was not used (none given, not issued by this daemon life, expired), and a cursor, or none at a moment not determined before this daemon life recorded any (AC3). At a determined moment a baseline's cursor names the answer's own standings. At a moment not determined it names the latest moment the daemon recorded before the call, so a call made just after an edit, before its dependency build ends, takes a cursor from before the edit's effects, and the next determined call lists them. The daemon records its standings, whenever the moment is determined, at each changes answer, each stored run or discovery, and each ended dependency build.
- [ ] AC8: `queryChanges` in `@rt-test/daemon/client` sends a changes request for absolute paths with an optional cursor and resolves with the daemon's answer. It rejects with a reason when no daemon serves the worktree, when the daemon predates the query or is stopping, when it has nothing to answer (no discovery stored), when the connection closes before an answer, when no answer arrives within its bound, and when the request is refused, naming each refused path and why.
- [ ] AC9: `rt-test changes <file>... [--since <cursor>] [--root <dir>] [--json]` sends the request for every named file, each resolved against the current directory, with the cursor `--since` gives, to the daemon serving the root (the current directory by default, never a parent). It starts no daemon, discovery or run. A missing file argument, an empty path, an empty `--root`, an empty `--since` and an unknown option are usage errors: exit 2, the usage on stderr, and nothing on stdout.
- [ ] AC10: Every answer the daemon gives exits 0, determined or not, baseline or not, whatever the tests' states; the command exits 1, with the reason on stderr and, under `--json`, a document with `ok` false and that reason, only when it gets no answer: no daemon serves the root, the daemon predates the query or is stopping, it has nothing to answer, the connection closes first, the request is refused, or no answer arrives within the client's bound. With `--json`, stdout carries exactly one document: `schemaVersion`, `command` (`changes`), `ok`, and the answer's fields. No exit code and no line calls the files' tests passing or failing as a set.
- [ ] AC11: Without `--json`, stdout's first line says whether the answer lists the changes since the given cursor, with how many, is a baseline and why, or is not determined and why (saying too why a given cursor was not used), and names the input revision; the cursor follows on a line of its own, so a person can pass it back, or a line saying there is none; then each listed change with its kind, its test's module and name or its entry, its standing then and now, and a failing change's first error line; how many more changes there are by kind; each named file's covering workspaces or why none covers it; the counts in scope and outside it; and the answer's context lines as `summary` and `status` print them. Every value read from the consumer's tree is printed on one line with unprintable characters escaped.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It composes the stored standings (`queryBasis`, `testStandings`), ticket 2.4b's coverage, ticket 2.4d's resolution and named read, and 2.3g's narrowing, all this repository's own; the command parses its arguments with `node:util` `parseArgs` as the other commands do, and the daemon-life identity comes from `node:crypto` `randomUUID`, which the store already calls.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read the landed code of ticket 2.4b (`query/wait-answer.ts`: its one coverage function and how it reports widening, and how it takes a named failure's first error line; `daemon/waits.ts`: how it resolves and refuses paths, including the directory refusal and the invalid-request error that carries each reason; the per-file coverage shape in `query/answer.ts`; the "daemon state moved" signal in `daemon/lifecycle.ts` and `daemon/workspace-schedule.ts`, and where the dependency builds' end is taken; `queryWait` in `query-client.ts`; `cli/src/commands/wait.ts`; the lines `answer-text.ts` shares, including `firstLine`), 2.4d (`resolveCallerPath`, `TrackedInputs.readNamed`, `withoutFingerprints`, `pathStatus` in `lifecycle.ts`) and 2.3g (`narrowingAt`, `NARROWING` in `inputs/narrowed-inputs.ts`), and confirm the names this ticket uses, and that the failing and no-outcome lists in § Decisions taken here, with `passed`, cover every member of `TEST_STATES`, reporting any state neither names. Check `lifecycle.ts`' line count: the journal and the answer go in modules of their own, and the handler stays as thin as `pathStatus`; if the handler and the recording would take its code lines past 500, move the recording (the determined check, the `queryBasis` read, the record and its failure log) into a module beside the journal (P16, P18).
- [ ] (AC1, AC8) In `packages/daemon/src/daemon/protocol.ts`, add `CHANGES_TYPE`, a `ChangesRequest` carrying absolute `paths` and an optional `since`, and `ChangesResponse` as the changes answer plus type and protocol version; name `MAX_CHANGES_PATHS` (1,000) and the cursor's character bound beside the wait's constants. `PROTOCOL_VERSION` is unchanged by this ticket, since an older daemon answers the new type with the unknown-request error. In `packages/daemon/src/daemon/server.ts`, route it to a new `DaemonHandlers.changes(request, signal)`, answered late as the path status and the wait are; refuse a request whose paths are not a non-empty array of absolute strings, more than `MAX_CHANGES_PATHS`, or whose `since` is present and not a non-empty string within its bound, with the invalid-request error.
- [ ] (AC1, AC2, AC3) In `packages/daemon/src/daemon/lifecycle.ts`, implement `DaemonHandlers.changes`: resolve each path through `resolveCallerPath` and refuse a resolved directory, refusing the request whole with the invalid-request error whose message gives each refused path's reason, as the wait refuses (reuse the wait's resolution and refusal where 2.4b left it callable, rather than a second copy, C8, C13); read the paths through `readNamed`; answer nothing more once the signal has aborted, as `pathStatus` does; then, in one turn: decide whether the moment is determined through the check `changes-answer.ts` exports; when it is, record the moment in the journal first; then take `since(cursor)` (or the latest cursor when not determined) and compose from `#latestResults`, `#view`, `withoutFingerprints(this.#queryInputs(results), unread)` and `unread`. Take `unread` from `TrackedInputs.unreadNamed(paths)` in the same turn the view is built and the determined check runs, never from `readNamed`'s resolved value, since `readNamed` resolves before a read a reconciliation holds has run (C160). The changes call never awaits `settled()`, as it never waits: a reconciliation still running leaves the view unavailable, so the answer is not determined, and once one has ended, its own read of each named file vouches for it, and one it cannot read ends it incomplete (`inputs/input-inventory.ts`), establishing no input set, which also leaves the answer not determined (AC2, AC3). Recording before the comparison is what keeps a change made after the last record from being lost: the returned cursor names standings that include it, so it must be listed now (AC5). Decide whether the build deciding the current revision has ended from `narrowingAt` over the same narrowing value the view was built from, in the same turn, rather than a second reading of the builds (C8, C160).
- [ ] (AC7) Create `packages/daemon/src/daemon/change-journal.ts`, owned by the lifecycle: a daemon-life identity taken once (`randomUUID`), a sequence, the latest recorded standing of each test by `testIdentityKey` and of each not-discovered entry by a key of its kind and its path fields, and each recorded change with its sequence and its standing before; `record` takes a determined moment's standings and entries, adds a sequence only when something differs from the latest record, and returns the cursor naming the latest sequence; `latest()` gives that cursor without recording, or none before this life's first record, for a not-determined answer (AC3, AC7); `since(cursor)` gives, for a usable cursor, each key's standing at it for every key changed after it, or why the cursor is not usable (not issued by this life, expired). A cursor is an opaque string holding the life and the sequence; one that does not parse, names another life or a sequence this life never recorded is not issued by it. Treat a cursor as expired when `MAX_RECORDED_CHANGES` or more changes have been recorded after it, declared here and labeled a target, and drop the oldest whole sequences no usable cursor still needs (C3, C24).
- [ ] (AC7) In `lifecycle.ts`, record in the journal, when the moment is determined (AC3), after each stored run and discovery and each ended dependency build, taking those moments from the signal 2.4b adds and the builds' end it takes, and at each determined changes answer; decide the moment determined through the same check the changes answer uses, and take the standings and entries from `queryBasis`, so the journal records exactly what an answer would read (C8). A recording that fails, such as a store read that throws, is logged at warning level naming the moment it skipped, and never ends the daemon or a job (C30, C32).
- [ ] (AC3, AC4, AC5, AC6, AC7) Create `packages/daemon/src/query/changes-answer.ts`: from the query basis, the view, the current inputs, whether the build has ended, the resolved paths, the paths the named read left unread and what the journal gives for the cursor, compose the answer; a not-determined one names each unread path and its reason (AC2). Export the determined check, which the handler and the recording both use (C8). Take the scope from 2.4b's coverage function at the current revision, never a second rule (C8, C11, C126, C129); place each test in scope by its workspace and each entry by the workspace it names (AC5); count the standings in scope and outside it through `countStandings`, and count the tests outside scope whose standing changed since a usable cursor (AC6, the outline's `outside.changed`); diff each key's standing at the cursor against now for the keys the journal names, filtering to scope before cutting to `MAX_LISTED_CHANGES` (C26); classify each change by the kinds AC5 names, as exported constants with a members record as `TEST_STATES` is; take each failing change's first error line from its workspace's latest stored run (a test's `errors`, a module's `errors`, a failed or crashed run's `error`) or its entry's reason, first line cut as the wait cuts it, and cut every other free-text field a listed change carries, such as an entry's reason, the same way (C170); order failing, recovered, other, and count what the bound leaves out by kind (C22, C24, C170). Declare `MAX_LISTED_CHANGES` here, or reuse 2.4b's `MAX_NAMED_FAILURES` if its value and meaning are one (C23) (module-private in `query/wait-answer.ts`; export it if reused).
- [ ] (AC3 to AC7) In `packages/daemon/src/query/answer.ts`, declare the changes answer (`ChangesAnswer`): the cursor or none, how the given cursor was used, the input revision, determined or why not, the listed changes, the omitted counts by kind, the per-file coverage in 2.4b's shape, the counts in scope and outside, and `AnswerContext`, taking the standing, coverage and selection shapes from their sources rather than restating them (C14). Declare the not-determined reasons (inputs unavailable, a path unread, the build not ended) as constants beside the kinds (C3). Export from `packages/daemon/src/client.ts` only the constants `changes.ts` reads: `changesText` labels each kind, cursor use and not-determined reason through records keyed by them, so each export has a production consumer before 2.7 exists (C59).
- [ ] (AC8) In `packages/daemon/src/query-client.ts`, add `queryChanges(consumerRoot, paths, options?)`, sending a `ChangesRequest` with `since` when the caller gives one, through the private `query()`, widening its request type as 2.4b widened it for the wait; take the path status's bound, since both read their paths before answering (C23); its errors go through `queryErrorReason`. Export it and the answer's types from `client.ts`.
- [ ] (AC9) Create `packages/cli/src/commands/changes.ts`, a `Command` named `changes` shaped like `wait.ts`: parse with `parseArgs` in strict mode, `JSON_OPTION`, `--root` and `--since`; take every positional as a file, requiring at least one and refusing an empty one through `nonEmptyPath`, and refuse an empty `--root` and an empty `--since`; resolve each file and the root with `absolutePath`. More than `MAX_CHANGES_PATHS` files is left to the daemon's refusal, one source for the bound. Register it in `packages/cli/src/main.ts`'s `COMMANDS`.
- [ ] (AC9, AC10) In the command's run, call `queryChanges(root, files, { since })` inside `reported`, with `since` left out when `--since` is not given, and answer `output.succeed(answerFields(answer), changesText(answer))` for every answer and `output.fail(errorText(error), { consumerRoot, requestedPaths })` for every rejection, as `wait.ts` does (C152, C153).
- [ ] (AC11) Write `changesText` in `changes.ts`, adding to `packages/cli/src/answer-text.ts` only lines `changes` shares with another command (the per-file coverage lines the wait prints, if 2.4b left them in `wait.ts`, move to `answer-text.ts` rather than being copied, C13), and widen its `Answer` union to take the changes answer so `contextLines` serves it unchanged (C14, C59). Route every consumer-derived value through `oneLine` and a multi-line value through `firstLine` first; name each heading and phrase as a constant (C3). No line states a verdict on the files' tests as a set (C133).
- [ ] (Support) Send the orchestrator the doc text in § Doc text with the build (C7), plus each hit of `rg -n "five commands|rt-test wait|rt-test changes|changes <files>" README.md docs` that still counts the commands before `changes` or describes it as planned (C48).
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files and `bun run typecheck` across the repository (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- Ticket 2.4b's coverage function (`query/wait-answer.ts`) and its per-file coverage shape (`query/answer.ts`): each named file's covering workspaces with selection's reason, the listed-file coverage, the env-file widening, and the widening while there is no dependency information (AC4, C8).
- Ticket 2.4b's path resolution and refusal in `daemon/waits.ts`, and its way of taking a named failure's first error line in `query/wait-answer.ts` (AC1, AC5).
- `queryBasis`, `countStandings`, `testStandings`, `TestStanding`, `cutReason` (`query/summary.ts`, `query/test-states.ts`): the standings, the not-discovered entries, the context and the counts every answer shares.
- `testIdentityKey` (`@rt-test/core`): a test's stable key across runs and discoveries.
- `TEST_STATES`, `CURRENT`, the state constants and the not-discovered entry kinds (`FAILED_MODULE`, `WORKSPACE_DISCOVERY_FAILED`, `WORKSPACE_UNHANDLED_ERRORS`) in `query/answer.ts` (C3, C14).
- `narrowingAt`, `NARROWING` (`inputs/narrowed-inputs.ts`): whether the current revision's build has ended or widened.
- `resolveCallerPath` (`query/caller-paths.ts`), `TrackedInputs.readNamed` and `UnreadPath` (`inputs/queued-reads.ts`), and `TrackedInputs.unreadNamed`, each path's latest read's unread entry: `readNamed` resolves before a read a reconciliation holds has run, so a caller that must know what its read found asks `unreadNamed` once `settled()` has resolved, `withoutFingerprints` (`query/path-status.ts`), and `lifecycle.ts`' `pathStatus`, the shape the handler follows.
- `query()`, `queryErrorReason` and the path status's bound (`query-client.ts`), `onProvenConnection`, `requireAnswer` (`daemon/proven-connection.ts`).
- `Command`, `JSON_OPTION`, `absolutePath`, `nonEmptyPath`, `UsageError` (`cli/src/command.ts`); `reported`, `oneLine`, `EXIT_*` (`cli/src/output.ts`); `answerFields`, `contextLines`, `countLines`, `notDiscoveredLines`, `INDENT`, `joinLines`, `firstLine` (`cli/src/answer-text.ts`); `errorText` (`@rt-test/daemon/client`); 2.4b's `cli/src/commands/wait.ts`, the command `changes` is shaped like.

### Must Create

- `daemon/change-journal.ts`: the daemon-life identity, the recorded standings, the cursor and its bound (AC7).
- `query/changes-answer.ts`: the determined check, the scope, the diff, the kinds and the counts (AC3 to AC6).
- `CHANGES_TYPE`, `ChangesRequest`, `ChangesResponse`, `DaemonHandlers.changes`, `ChangesAnswer`, `queryChanges`, the change kinds and cursor uses (AC1, AC5, AC7, AC8).
- `MAX_CHANGES_PATHS`, the cursor's character bound, `MAX_LISTED_CHANGES` (unless 2.4b's bound is reused) and `MAX_RECORDED_CHANGES`.
- `cli/src/commands/changes.ts`: the command and `changesText` (AC9 to AC11).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Sprint 2's changes query. Ticket 2.4b (the wait) builds first, then 2.5 (the edit corpus), then this ticket; ticket 2.7 (the agent feedback hook) builds after it and calls `queryChanges` in-process from its hook subcommand, while a hook for another harness can call `rt-test changes --json`. The delta lives here, generic to any agent harness, so a hook only parses its harness's payload (P31).

Requirements this ticket delivers (`docs/requirements.md`):

- "FR21: Answer `changes <files>` with each test covering those files whose state or freshness changed since a cursor an earlier answer returned, failures and recoveries first, with counts for the covering and the other tests, without starting a test." (AC1 to AC11; allocated by the orchestrator at 07:37 on 2026-09-30)
- "FR20: Report to a coding agent, after its tool calls, each change since its previous report in the state or freshness of the tests covering the files it edited, naming each test that failed or recovered, through a hook that only queries the CLI and reports the files the agent edited, starts no test and no daemon, and says when RT Test cannot answer rather than falling silent." (the delta 2.7 reports: AC5, AC7)
- "NFR3: Never report a result as current unless its stored input fingerprint matches the current inputs." (AC2, AC3)

Rule clauses the criteria rest on:

- `docs/architecture.md` § Query surface: "Read operations never trigger execution." (AC2, AC9)
- `docs/architecture.md` § Identity and freshness: "An unknown input set cannot yield a current pass." (AC3)
- AGENTS.md § Product guarantees: "Never report historical results as current after a relevant edit or unresolved input change." (AC2, AC3: the journal is history; no answer reads a recorded standing as a current one, and freshness is computed at the answer, C114)
- AGENTS.md § Product guarantees: "Widen selection when dependency information is uncertain." and "Explain each selection and each broad fallback. Report selected and total test counts." (AC4, AC6)
- AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states. A zero-test selection is not proof of success." (AC4, AC5)
- `project-context.md` P31: "Fleet Cooling is the proving ground, not a dependency. Nothing application- or backend-specific enters the core" (the kinds and the order are generic)
- `project-context.md` P32: "The CLI and programmatic API query results or wait for a revision scoped to given files, and never spawn Vitest" (AC8, AC9)
- `project-context.md` P33: "Expose the product as a CLI with `--json` output in front of the daemon, plus a small programmatic API." (AC8, AC10)
- `README.md` § Query: "Exit codes: 0 when the query answered, whatever the tests' states; 1 when it could not ... and 2 on a usage error." (AC9, AC10)

Glossary (`docs/glossary.md`), verbatim:

- **Cursor** (added by this ticket at 07:39 on 2026-09-30, under the orchestrator's 07:37 grant): "The token a `changes` answer returns, naming the test standings the daemon recorded when it answered, so the next `changes` call reports only what changed since."
- **Freshness**: "Whether a result still describes its test's current inputs."
- **Input revision**: "The number naming a worktree's inputs as the daemon last observed them in its current life, raised once for each batch of changes it observes."
- **Selection**: "The tests a change requires running, each with its reason."
- **Widening**: "Adding tests to a selection because a dependency is uncertain."

#### Orchestrator rulings

Asked by `session_wake` at 07:35 on 2026-09-30, answered at 07:37; decider the orchestrator on each. Reasons are the orchestrator's where it gave them.

- Q1 (AC7; where earlier standings live): an in-memory, bounded journal in the daemon, shared by every caller; the cursor names a point in it. A restart gives a baseline answer that says why, a known limit, and nothing reads current because of it. Rebuilding past standings from stored runs was checked and fails: past fingerprints are never stored, so past freshness cannot be recomputed; a client-held cursor carrying the standings grows with every test in the worktree; a journal persisted in the store adds a schema change for a rare restart. The bound is a named constant labeled a target, and an expired cursor answers a baseline naming the expiry.
- Q2 (AC2, AC3, AC7; the moment after an edit): changes are listed only at a determined moment; otherwise the caller's cursor is handed back unchanged and the answer never waits. It matches the status's answer-at-once rule (2.4d D1), and the wait (2.4b) is where blocking belongs. The journal also records at stored runs, discoveries and build ends, so a session's first report still sees its own edit's rerun.
- Q3 (AC3, AC7; the cursor's binding): the cursor binds to the journal point (daemon life plus sequence), and every answer names the input revision it read. The sprint's earlier binding to 2.4b's input revision was a mechanism, not the owner's goal (the owner's 14:24 rulings on 2026-09-27: the agent learns which tests its own edits changed, the hook names at most five, says once when no daemon answers, and is opt-in); a revision alone cannot name a set of standings, since a stored run changes standings without moving it. The sprint line is reworded under the orchestrator's 07:37 grant.
- Q4 (AC5): net change only, with the kinds `failing`, `recovered` and `other`, failing first, up to 20, each failing change with its first error line.
- Q5 (AC5): a not-discovered entry appearing or going away in a covering workspace is a change, so a syntax error in a test file never reads as "tests removed".
- Q6 (AC1, AC4, AC6): scope is 2.4b's coverage; the counts in scope, outside it and the changed count outside it; 1 to 1,000 files, a directory refused, refused whole, keeping the wait's path rules.
- Q7 (scope): this ticket carries no edit attribution; 2.7 owns the request field that tells the daemon which files a tool call edited.

#### Decisions taken here

- **`--since` names the cursor.** The flag reads as the question the command answers ("changes since"), and the answer's cursor is passed back verbatim; a cursor is opaque to every caller.
- **The same failing states in the kinds and in the order.** `failing` is every state that says the test, its module or its run broke; `interrupted`, `module-not-run`, `not-in-latest-run`, `never-run`, `run-refused`, `run-unsupported-vitest`, `run-interrupted-before-load` and `skipped` say the test has no outcome, not that it broke, so a change into one of them is `other`. A test that stood failing at the cursor and has only gone stale or unknown since is `other` too (grill, 07:40, within Q4): the caller already heard of that failure, and re-listing it at every edit would bury news under repeats; the rerun that follows lists it again as `failing` once it reads current, whether it still fails or not, or as `recovered`. Of the not-discovered kinds only `failed-module`, `workspace-discovery-failed` and `workspace-unhandled-errors` report a break.
- **The client's bound.** `queryChanges` takes the path status's bound, since both read their named paths before answering; a changes answer never waits for anything else. A changes request reads up to `MAX_CHANGES_PATHS` paths where a status reads one, so dev confirms the bound covers that read, or reports a bound of its own.

- **Ticket review (create-ticket 6c, 07:40 to 07:46).** 22 findings, all applied. The three questions were settled here from the ticket's own rules and the code: F6, a changes call starts no job of its own, and the revision its named read moves is scheduled exactly as the file's event would be (AC2); F11, a test is placed in scope by its workspace, so a test a rediscovery dropped is judged by the workspace it belonged to, and an entry naming no workspace is always in scope (widening, AC5); F12, an unhealthy watcher already leaves the inputs unavailable to every workspace (`unavailableReason`, `inputs/current-inputs.ts`), so AC3 names it among the causes. The others: the handler records before it compares (F4), the journal gives the latest cursor without recording (F3), expiry counts the changes recorded after a cursor (F9), the unread paths and the outside changed count got tasks (F1, F2), the file list gained `waits.ts` and `commands/wait.ts` (F5), and the rest tightened wording, bounds and rule compliance.

#### Answer outline 2.7 reads

The field names below are this ticket's contract with ticket 2.7; dev keeps them, or reports each rename to the orchestrator with the build.

- `cursor`: the cursor to pass back, or `null` (a not-determined answer before this daemon life recorded any moment).
- `cursorUse`: `used`, `none-given`, `not-issued` or `expired` (AC7).
- `revision`: the input revision the answer read.
- `determined`: `true`, or `false` with `notDetermined` naming why (AC3).
- On a determined answer: `changes` (each with its test identity or entry, `then` and `now` standings, each absent when the test or entry had or has none, `kind`, and `firstError` on a failing change), `omittedChanges` counted by kind, `coverage` per named file in 2.4b's shape, `counts` in scope, and `outside` with its `counts` and `changed`.
- The `AnswerContext` fields every answer carries.

#### Design notes

- **Why a journal and not a snapshot per cursor.** Each hook session calls after every tool call, so a snapshot of every test per cursor would multiply the worktree's tests by the calls in flight; the journal holds one latest standing per test plus the changes recorded, shared by every caller, and a scope only filters what it reports.
- **Why not-determined answers list nothing.** Right after an edit, until the dependency build at the new revision ends, `narrowedFingerprint` (`inputs/current-inputs.ts`) gives every workspace no fingerprint, so every test reads unknown; a diff at that moment would list the whole worktree going unknown and then back. Handing the cursor back unchanged loses nothing: the next determined call lists the net change.
- **Why the journal records at runs, discoveries and build ends.** A session's first call after its first edit is not determined and has no cursor; the latest recorded moment is then from before the edit's effects, so the edit's rerun, even a failing one, is listed by the next determined call. A journal recorded only at changes answers would have no such moment in a fresh daemon life, or an arbitrarily old one.
- **Freshness is never stored as current.** The journal records what answers read, as history; each answer computes the current standing afresh, and a recorded standing is only ever the "then" side of a change (C114).
- **Scope of the analysis.** Analyzed: a save not yet reported, a file the read could not read, the moment before a build ends, a failed or widened build, a file no workspace covers, a test added or dropped by a rediscovery, a module that fails to load at discovery, a flip and flip back, a cursor from an earlier life, a forged cursor, an expired cursor, a call with no cursor at each kind of moment, a daemon with no discovery stored, each way of getting no answer and each usage error. Not analyzed: the cost of recording at every run and build end in a very large worktree (each record composes the standings as a summary does, a target for 2.7's measurement), and the text's exact layout, which dev sets within AC11.

#### Known limits

- **A daemon restart** loses the journal: a cursor from the earlier life gets a baseline, so a change that happened across the restart is not listed as a change; the counts still show every failure, and nothing reads current because of it (Q1).
- **A cursor older than `MAX_RECORDED_CHANGES` recorded changes** gets a baseline naming the expiry; a worktree with more tests than the bound expires a cursor at every edit that stales all of them, which no realistic consumer reaches.
- **An edit the watcher has not yet reported, to a file the call does not name,** is seen only when its event arrives (2.4d's known limit).
- **More than `MAX_CHANGES_PATHS` files** in one request is refused; a hook that sends every file a long session edited caps the list itself (2.7).
- **A persistently undetermined daemon** (an unhealthy watcher, an input set that cannot be established, a build that never ends because edits keep coming) lists no change while it lasts; each answer says why, so a hook can say RT Test cannot answer yet.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.6` over this ticket's production files (07:32 on 2026-09-30) named 2.3o, 2.4b and 2.5.

- **2.4b** (ready-for-dev, builds first in Tree 1 now): writes `protocol.ts`, `server.ts`, `lifecycle.ts`, `workspace-schedule.ts`, `query/answer.ts`, `query-client.ts`, `client.ts`, `cli/src/main.ts` and `cli/src/answer-text.ts`, and creates `daemon/waits.ts`, `query/wait-answer.ts` and `cli/src/commands/wait.ts`. This ticket is written against the tree as it will be once 2.4b lands, and reuses its coverage, path refusal, failure line, signal and command shape; the first task re-reads them. After 2.4b lands, this ticket writes `waits.ts`, `wait-answer.ts` and `commands/wait.ts` only to export or move what it reuses, never to change the wait's behavior.
- **2.5** (ready-for-dev, builds before this ticket): reads `protocol.ts`, `query/answer.ts`, `query-client.ts` and `client.ts` and writes none of them; it writes `packages/daemon/test/harness.ts` and `packages/daemon/test/defects.json`, to which this ticket's create-tests appends after it.
- **2.3o** (ready-for-dev, lands before 2.4b): names these files only by their folders and writes none of them.
- **2.7** (backlog): calls `queryChanges`, reads § Answer outline 2.7 reads, and owns the edit attribution (Q7).

#### Sizing

About 21 raw files and 27 estimated (21 times 1.3 is 27.3); code units 12 (11 criteria plus validation). That is past 25 estimated files and within 30, taken because a split would cut one behavior in two: the changes query delivered through the daemon, the programmatic API and the CLI, which the orchestrator kept whole for the wait when it folded 2.4c into 2.4b (01:55 on 2026-09-30). Two of the files are touched only if 2.4b left what this ticket reuses private: `daemon/waits.ts` (export the path resolution and refusal) and `cli/src/commands/wait.ts` (move the per-file coverage lines to `answer-text.ts`); without them the ticket is 19 raw and 25 estimated. Production: `daemon/protocol.ts`, `daemon/server.ts`, `daemon/lifecycle.ts`, `query/answer.ts`, `query/wait-answer.ts` (only to export what 2.4b left private), `daemon/waits.ts`, `query-client.ts`, `client.ts`, new `daemon/change-journal.ts` and `query/changes-answer.ts`, `cli/src/main.ts`, `cli/src/answer-text.ts`, `cli/src/commands/wait.ts`, and new `cli/src/commands/changes.ts`. Tests, for create-tests: `packages/daemon/test/server.test.ts` (routing and request validation), `lifecycle.test.ts` (the handler and the recording), `query.test.ts` (the journal, the diff, the kinds and the counts from stand-in state), `daemon.test.ts` (a real daemon: baseline, edit, not determined, then the failing change), `packages/daemon/test/defects.json`, `packages/cli/test/cli.test.ts` (the command against a real daemon, and each usage error) and `packages/cli/test/defects.json`. Over 10 estimated, so dev delegates, in three groups in order: the protocol and client (`protocol.ts`, `server.ts`, `query-client.ts`, `client.ts`); the journal and answer (`change-journal.ts`, `changes-answer.ts`, `answer.ts`, `wait-answer.ts`, `waits.ts`, `lifecycle.ts`); the command (`commands/changes.ts`, `commands/wait.ts`, `main.ts`, `answer-text.ts`).

#### Current structure of the modified files

As of main at 415ab30, read at 07:27 to 07:36 on 2026-09-30, before 2.4b lands; each is re-read at the first task.

- `packages/daemon/src/daemon/protocol.ts` (280 lines): `SUMMARY_TYPE`, `PATH_STATUS_TYPE`, their request and response types, `PROTOCOL_VERSION` (4), `RESPONSE_BOUND_MS`, the error codes; 2.4b adds `WAIT_TYPE`, `WaitRequest`, `WaitResponse` and the wait's bounds.
- `packages/daemon/src/daemon/server.ts` (437 lines): `DaemonHandlers` (`pathStatus(path, signal)` among them), routing by type, `pathStatusResponse` refusing a non-absolute path with the invalid-request error, `queryResponse`; 2.4b adds the wait's route and validation.
- `packages/daemon/src/daemon/lifecycle.ts` (583 lines): `pathStatus` resolves through `resolveCallerPath`, awaits `readNamed`, answers `NOT_AWAITED_REASON` once the signal has aborted, and composes through `#latestResults`, `#view` and `withoutFingerprints(this.#queryInputs(results), unread)`; `#queryInputs` passes `{ ...this.#builds.narrowing(), discoveryId }` to `inputs.current`. 2.4b adds the waits and the "daemon state moved" signal.
- `packages/daemon/src/query/summary.ts` (384 lines, read only): `queryBasis(results, daemon, inputs)` gives the discovery, latest runs, refused runs, `standings`, `notDiscovered` and `context`, or `noAnswer` when no discovery is stored.
- `packages/daemon/src/query/test-states.ts` (233 lines, read only): `TestStanding` (`test`, `state`, `freshness`), `testStandings`, `countStandings`.
- `packages/daemon/src/inputs/current-inputs.ts` (201 lines, read only): `currentInputs` reads `narrowingAt(narrowing, facts.revision)`; while it is `building`, `narrowedFingerprint` gives every workspace `{ ok: false, reason }` naming the build; `CurrentInputs` (`inputs/input-tracker.ts`) exposes `unavailable` and `inputsNotNarrowed` but not the building state, hence the task's `narrowingAt` over the same value.
- `packages/daemon/src/query/answer.ts` (555 lines): the state constants and `TEST_STATES`, `FRESHNESS_VALUES`, `TestCounts`, the not-discovered kinds, `AnswerContext`, `SummaryAnswer`, `PathStatusAnswer`; 2.4b adds `WaitAnswer` and its per-file coverage.
- `packages/daemon/src/query-client.ts` (104 lines): `querySummary`; `queryPathStatus` with its private `PATH_STATUS_BOUND_MS` (60 s); the private `query()`; `queryErrorReason`. 2.4b adds `queryWait` and widens `query()`'s request type.
- `packages/cli/src/main.ts` (45 lines): `COMMANDS` lists start, stop, summary and status; 2.4b adds wait.
- `packages/cli/src/answer-text.ts` (454 lines): `type Answer = SummaryResponse | PathStatusResponse`, which 2.4b widens; `firstLine` is private until 2.4b exports it.
- `packages/cli/src/commands/status.ts` (94 lines, not modified): the shape 2.4b's `wait.ts` and this ticket's `changes.ts` follow.

#### Existing tests this change breaks

- `packages/daemon/test/server.test.ts`: `handlers(...)` builds `DaemonHandlers` by hand and gains `changes`.
- `packages/daemon/test/lifecycle.test.ts`: constructs the lifecycle, which gains the journal and its recording; stand-ins for the store or the tracker may gain what a recording reads.
- `packages/cli/test/cli.test.ts`: a test comparing the whole usage listing printed on an unknown or missing command gains the changes line.
- Found by `rg -ln "DaemonHandlers|DaemonLifecycle|LifecycleParts" packages/*/test` and `rg -n "Unknown command|Missing command|usage|answerFields|contextLines" packages/cli/test` when dev starts, and by `bun run typecheck` across the repository for any hand-built shape or one the widened `Answer` union breaks (P14).

#### Doc text

Dev reports this text with the build; the orchestrator writes it (C7).

- `docs/architecture.md`, the query paragraph: "The daemon also answers `changes` for given files: it reads each file as `status` does, and, once every workspace's inputs at the current input revision are decided, lists each test covering the files, as a wait's coverage decides it, whose state or freshness changed since the cursor an earlier answer returned, and each entry it could not discover in a covering workspace that appeared or went away, failures first, then recoveries, up to 20, with counts in scope and outside it and a new cursor. Its record of earlier standings lives in the daemon's memory, so a cursor from an earlier daemon life, or older than its bound, is answered as a baseline. `queryChanges` in `@rt-test/daemon/client` sends it."
- `docs/architecture.md`, the query paragraph: "None of the five commands" becomes "None of the six commands", and the sentence naming the commands that print counts gains `rt-test changes`.
- `README.md` § Query, the usage block gains `rt-test changes <file>... [--since <cursor>] [--root <dir>] [--json]`, and after the paragraph on `rt-test wait`: "`rt-test changes <file>...` lists each test covering the files whose state or freshness changed since `--since`, a cursor an earlier `changes` answer returned, failures first, then recoveries, up to 20, with each failure's first error line, the covering tests' counts and the other tests' counts, and a new cursor to pass next time. Without `--since`, or with a cursor from an earlier daemon life or too old, it lists nothing and says why. Right after an edit, before the daemon has decided which inputs each workspace reads, it lists nothing, says why and hands back your cursor. It answers at once, starts nothing, and exits 0 for every answer."
- `README.md` line 12 gains "and `changes <files>` lists what changed for the tests covering your files since your last ask".

#### Previous ticket

2.5 (ready-for-dev): the edit corpus drives the daemon through `queryWait` and adds a test harness helper; nothing of it is built yet, and it writes no file this ticket writes besides `packages/daemon/test/defects.json`. 2.4b (ready-for-dev, building): the wait; 2.4d (done, 96c5a9c): `status <path>` reads its path before it answers and never waits for a reconciliation, and `query/caller-paths.ts` resolves a caller's paths.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.4b, § Ticket 2.4d, § Ticket 2.6, § Ticket 2.7.
- Tickets 2.4b, 2.4d, 2.3g and 2.5 (`_agent-docs/tickets/`).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (07:32 on 2026-09-30).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C7,C8,C11,C12,C13,C14,C20,C22,C23,C24,C26,C30,C32,C38,C39,C40,C46,C48,C55,C59,C113,C114,C115,C119,C126,C128,C129,C130,C131,C133,C134,C151,C152,C153,C160,C170 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P18,P19,P21,P31,P32,P33,P34 -->

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
sizing_ac_count: 12
files_to_modify:
  - packages/daemon/src/daemon/protocol.ts
  - packages/daemon/src/daemon/server.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/query/wait-answer.ts
  - packages/daemon/src/daemon/waits.ts
  - packages/cli/src/commands/wait.ts
  - packages/daemon/src/query-client.ts
  - packages/daemon/src/client.ts
  - packages/cli/src/main.ts
  - packages/cli/src/answer-text.ts
files_to_create:
  - packages/daemon/src/daemon/change-journal.ts
  - packages/daemon/src/query/changes-answer.ts
  - packages/cli/src/commands/changes.ts
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

- _agent-docs/tickets/2-6-changes-query.md (created by create-ticket, 07:38 on 2026-09-30)
- docs/requirements.md (FR21 added, marker `[Ticket 2.6]`, 07:39, under the orchestrator's 07:37 grant)
- docs/glossary.md (Cursor added under Results and runs, 07:39, under the 07:37 grant)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.6's scope line: the cursor's binding, Requirements FR21, FR20, and the ticket link, 07:39, under the 07:37 grant)

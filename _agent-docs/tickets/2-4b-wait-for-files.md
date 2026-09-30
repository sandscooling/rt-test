# Ticket 2.4b: Wait for files

## Ticket

As a coding agent that has just saved some files,
I want to ask the daemon once, through `rt-test wait <files>` in my shell or `queryWait` in code, and be answered when the tests covering those files have current results, or cannot get them, or my inputs moved again, or my time ran out,
so that I never run tests myself, never read a pre-edit result as current, always get an answer before my shell tool gives up on the call, and read the outcome from one command whose exit code only says whether RT Test answered.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: A wait first reads each named file through ticket 2.4d's named read, then binds to the input revision the daemon holds once those reads and every input event seen before the request have been read and no reconciliation runs, so a file saved before the request, whose change the watcher has not yet reported, belongs to that revision. Every answer names the bound revision and the revision it was given at.
- [ ] AC2: The tests covering a named file are every test of each Vitest workspace that selection, at the bound revision, selects for a change of that file, over the dependency information built at that revision (ticket 2.3g), so a new or deleted file is covered as its change would select, together with each discovered workspace whose fingerprint lists that file outside selection: a test module or an env file (ticket 2.3m) the discovery in effect lists for it, whatever git ignores, so a file whose edit stales a workspace is never answered as covered by no test. While that revision's dependency build has not ended, the wait keeps waiting. While there is no dependency information for the discovery in effect (the build failed, or the discovery yields no selection input), every discovered workspace covers every named file, and the answer names that widening and what caused it for each file. A named file no workspace covers, such as a declared non-input, is answered as covered by no test, with selection's reason, and never counted as a success; a workspace selection names but cannot run (unsupported, not confirmed) is listed with its reason.
- [ ] AC3: The wait answers settled once, at the input revision current then, each covering workspace either holds results that read current, or has nothing coming: it is idle and ticket 2.3i says why no run is coming (not until the next input change, only at a periodic retry, only when the daemon tries a held round again at the next input event or reconciliation, or not until an edit reaches its inputs or a change the daemon cannot attribute releases it, since its own runs and discoveries keep changing the same input (`self-changing`, ticket 2.3k), which the answer names), its discovery failed, or it cannot run. A covering workspace that alone has no current fingerprint, for a cause of its own that no rediscovery or run at this revision changes (its env files not known, a listed file whose read refuses), has that as its explicit non-current state: once the schedule says nothing is coming for it, it settles, and the answer names the reason, without waiting for a rediscovery that will not change it. It never answers settled while the inputs are unsettled, meaning the tracker can compute no current fingerprint for any workspace (events unread, a reconciliation or a protection walk running, the watcher unhealthy, or the input set not established), while a round is pending (for any wait 2.3i's schedule names: the first reconciliation, the quiet window, the inputs settling, a dependency build, a rediscovery or a job in progress, or while no discovery is stored yet), or a covering workspace is queued, running or interrupted. A discovery held by ticket 2.3l keeps no round pending, so it holds no wait, and the answer names the hold (AC6). A named file the wait's read found but could not read (ticket 2.4d's unread path, such as a file busy mid-save) leaves the wait unable to vouch for it: the wait never answers settled, and ends superseded or unsettled, naming that path and the reason, as unable to get current results. Pending waits are judged again whenever the schedule, a stored run or discovery, the input revision, a dependency build, or whether the inputs are settled (a reconciliation ends, the watcher recovers, the input set is established) changes, so a wait answers as soon as the change that settles or supersedes it lands.
- [ ] AC4: The wait answers superseded once, at a revision after the bound one whose dependency build has ended, an input of any workspace covering the named files at the bound revision or at that later one differs from the bound revision's (changed, added or removed), counting as its inputs the files its fingerprint lists that the inputs leave out (a listed test module, setup, global setup or env file that git ignores or that lies under `node_modules`), whose edits move the revision after ticket 2.3p; the answer names that revision and the differing paths, up to a named bound, counting the rest. A change only to inputs no covering workspace reads leaves the wait waiting. When the input revision moves before the bound revision's dependency build has ended, the bound revision's covering set cannot be known, so every discovered workspace is taken as covering, and the wait answers superseded at once, naming the newer revision and the paths changed since the bound one. A cause that names no path (a watcher failure, an input set that cannot be established) does not supersede it: it leaves the inputs unsettled, so AC3 keeps it waiting. The wait never rebinds itself.
- [ ] AC5: A wait ends at its time limit, `WAIT_LIMIT_MS`, 100 s by default, a named constant labeled a target, which a caller may set to any whole number of ms from 1 up to a named maximum, `MAX_WAIT_LIMIT_MS`, timed from the request's arrival, with its own answer, unsettled: it names the bound revision, the revision it was given at, and each covering workspace's execution state as ticket 2.3i gives it, so the caller can wait again. A limit that passes before the wait has bound, or before the bound revision's covering set is known, answers unsettled with no bound revision or with the coverage marked not yet known, naming every confirmed workspace's execution state, never an empty coverage (C12). Unsettled is neither superseded nor a failure.
- [ ] AC6: A settled, superseded or unsettled answer carries, for each named file, its covering workspaces with selection's reason, or why none covers it, and, for a file the wait could not read, that reason (AC3); the counts by state and by freshness of every covering test, each test counted once however many named files it covers; each covering workspace's execution state and, when its results are not current, why; up to `MAX_NAMED_FAILURES`, 20, covering tests that failed or errored and covering modules that failed to load or crashed in their workspace's latest stored run, each with the first line of its first recorded error, counting the rest; and the context every summary and path-status answer carries, which names a discovery ticket 2.3l holds.
- [ ] AC7: A wait names at least one path and at most `MAX_WAIT_PATHS`, 1,000. Each path is resolved through ticket 2.4d's resolution, and a wait naming any path that is refused (outside the consumer root, a directory, a spelling 2.4d refuses on Windows) or more paths than the bound is refused whole, naming each refused path and why, before anything is read.
- [ ] AC8: `queryWait` in `@rt-test/daemon/client` sends a wait for absolute paths with an optional limit, and resolves with the daemon's answer, waiting for it up to the limit plus `RESPONSE_BOUND_MS`. It rejects with a reason when no daemon serves the worktree, when the daemon predates the wait, when the daemon is stopping or stops while it waits, and when the wait is refused.
- [ ] AC9: `rt-test wait <file>... [--root <dir>] [--limit <seconds>] [--json]` sends the wait for every named file, each resolved against the current directory, to the daemon serving the root (the current directory by default, never a parent), with the limit when `--limit` is given and the daemon's default otherwise. It starts no daemon, discovery or run.
- [ ] AC10: A missing file argument, an empty path, an empty `--root`, an unknown option, and a `--limit` that is not a whole number of seconds written in decimal digits from 1 to the wait's maximum (`MAX_WAIT_LIMIT_MS` in seconds) are usage errors: exit 2, the usage on stderr, and nothing on stdout.
- [ ] AC11: Every answer the daemon gives, settled, superseded or unsettled, exits 0, whatever the covering tests' states; the command exits 1, with the reason on stderr and, under `--json`, a document with `ok` false and that reason, only when it gets no answer: no daemon serves the root, the daemon predates the wait or is stopping, the connection closes before an answer, the wait is refused (naming each refused path and why, or that more files were named than the wait allows), or no answer arrives within the client's bound. No exit code and no line calls the files' tests passing or failing.
- [ ] AC12: With `--json`, stdout carries exactly one document: `schemaVersion`, `command` (`wait`), `ok`, and the wait answer's fields as AC6 gives them, its outcome among them; everything else goes to stderr.
- [ ] AC13: Without `--json`, stdout's first line names the outcome and the revisions: settled at a revision, superseded by a newer revision (naming it), or unsettled when the limit passed; then, per named file, its covering workspaces or why none covers it; the counts by state and by freshness of the covering tests; each named failure with its module, test name and first error line, and how many more there are; each covering workspace's execution state and, when its results are not current, why; for a superseded answer, the changed paths it lists and how many more; and the answer's context lines as `summary` and `status` print them. Every value read from the consumer's tree is printed on one line with unprintable characters escaped.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It composes selection (`selectTests`), 2.3g's narrowed inputs, 2.3i's schedule, 2.4's late answers and 2.4d's reads, all this repository's own, and the command parses its arguments with `node:util` `parseArgs` as the other commands do.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read the landed code of tickets 2.3g (`daemon/dependency-builds.ts`, `inputs/narrowed-inputs.ts`, the narrowing state), 2.3f (`daemon/scheduler.ts`, the round), 2.3i (the schedule each answer carries, its constants, and `contextLines`' schedule lines in `cli/src/answer-text.ts`), 2.3l (the held discovery in the schedule, the answer's context and `contextLines`), 2.4 (the late answer, the handlers' signal, `DaemonConnection.request`'s bound) and 2.4d (`query/caller-paths.ts`, the tracker's named read), and confirm the names this ticket uses. Check `lifecycle.ts`'s line count: the wait's state goes into modules of its own (P16, P18).
- [ ] (AC5, AC7, AC8) In `packages/daemon/src/daemon/protocol.ts`, add `WAIT_TYPE`, a `WaitRequest` carrying absolute `paths` and an optional `limitMs`, and `WaitResponse` as the wait answer plus type and protocol version; `PROTOCOL_VERSION` is unchanged by this ticket, since an older daemon answers the new type with the unknown-request error. In `packages/daemon/src/daemon/server.ts`, route it to a new `DaemonHandlers.wait(request, signal)`, answered late through 2.4's queue; refuse a request whose paths are not a non-empty array of absolute strings, more than `MAX_WAIT_PATHS`, or whose limit is not a whole number of ms from 1 to `MAX_WAIT_LIMIT_MS`, with the invalid-request error.
- [ ] (AC1, AC2, AC3, AC4, AC5) Create `packages/daemon/src/daemon/waits.ts`, owned by the lifecycle: it resolves each path through 2.4d's resolution (`resolveCallerPath`, `query/caller-paths.ts`), and refuses a resolved path that is a directory on disk, which that resolution accepts since a status takes folders (AC7, Q9); it refuses the wait whole on any refusal with the invalid-request error, whose message gives 2.4d's reason for each refused path, which already begins with the path, or the directory reason naming it, and `queryErrorReason` keeps that message in `queryWait`'s rejection (AC7, AC8); reads the paths through 2.4d's named read (`TrackedInputs.readNamed`), then awaits `settled()`, then reads the paths again and awaits `settled()` again, since the first read may have read nothing while a reconciliation ran or before an input set was established, and a second named read of an unchanged file changes nothing; and binds to the revision read in the same turn `settled()` resolves (AC1, C160); keeps the `UnreadPath` entries the second named read resolves with (the paths it found but could not read, each with its reason), which hold the wait from settling for its life (AC3); holds each pending wait with its bound revision, the committed input snapshot of that revision, and, once that revision's build has ended, the covering workspaces and each one's narrowed inputs at it (AC2); judges every pending wait again on each change the lifecycle signals, in AC4's order and then AC3's, and answers through the wait's promise; arms one timer per wait for its limit when the request arrives, before the named read (AC5), cleared when it answers; and on the wait's signal (a stop or a client that left, ticket 2.4) forgets it and clears its timer. Name `WAIT_LIMIT_MS` (100 s, a target), `MAX_WAIT_LIMIT_MS` (1 hour) and `MAX_WAIT_PATHS` (1,000) in `protocol.ts` beside `RESPONSE_BOUND_MS`, since `server.ts` validates against two of them and `queryWait` needs the default (C3, C4).
- [ ] (AC2, AC3, AC5, AC6) Create `packages/daemon/src/query/wait-answer.ts`: from the stored latest results, the view, the current inputs, 2.3i's schedule and the selection for the named files, decide whether each covering workspace is settled (AC3) and compose the answer (AC6). Export one coverage function that takes each file's covering workspaces from `selectTests` with the named files as the change; `waits.ts` calls it once per judged revision whose build has ended, and the answer reuses the result for the latest such revision, so AC4's covering set and AC6's are one. It selects over 2.3e's selection input and 2.3g's dependency information for the discovery and revision (the `ChangedPathReport` per path: `selected`, `notRunnable`, `nothingSelected`), never a second rule (C8); while there is no dependency information, every discovered workspace covers every file with the widening reason 2.3g gives (C11, C129). Add to each file's covering workspaces every discovered workspace whose fingerprint lists the file: every file the discovery lists for it by path, `listedPaths(workspaceListing(entry))` (`inputs/protection.ts`: its test modules, setup and global setup files, and env files), the one listing both fingerprints digest, rather than a second rule (C8), each with a reason naming which listing covers it; such a file is never answered as covered by no test, even when selection selects nothing for it (AC2). A discovered workspace whose env files are not known (`workspaceEnvFilesKnown` answering `known: false`, from an unreported discovery or, after ticket 2.3q, a lasting Vitest 5 container state) covers every named file whose name is `.env` or begins `.env.`, since its listing cannot rule the file out (widening, C126), with that reason. Judge a covering workspace settled (AC3) when the view gives it no fingerprint for its own cause (`unfingerprintedWorkspaces`, the view not `unavailable`) and the schedule shows it idle with nothing coming, and carry that reason as its why (AC6); only the view's `unavailable` (the tracker-wide causes) keeps the wait waiting. A wait holding any `UnreadPath` is never settled, and each such path's entry carries its reason (AC3, AC6). A discovery 2.3l holds is not a pending round, so it adds no wait; the hold reaches the answer through `AnswerContext`, as it reaches summary and status, never through a field of the wait answer's own (C8). Take the counts from `queryBasis`' standings filtered to the covering workspaces and `countStandings`; the context from `queryBasis`; the named failures from each covering workspace's latest stored run (its tests' `errors` and its modules' `errors`), cut by `MAX_NAMED_FAILURES` with a count of the rest (C22, C24), each error's first line cut as `cutReason` cuts a reason. Declare `MAX_NAMED_FAILURES` and the bound on AC4's listed paths here, or reuse 2.3i's bound on changed paths if it fits (C14, C23).
- [ ] (AC4) In `waits.ts`, judge superseded at each later revision whose dependency build has ended: for each workspace covering the named files at the bound revision or at that one, compare its narrowed input digests at the two revisions, together with the held digests of the files its fingerprint lists that the inputs leave out, read through `ProjectInputs`' accessor over both sets (ticket 2.3p) rather than `digests` alone, so an edit to a gitignored listed file supersedes the wait as promptly as an edit to an input does (2.3g's narrowing state; the whole project's inputs wherever there is no dependency information, a failed build or a discovery that yields no selection input, as AC2 states). When the input revision moves before the bound revision's dependency build has ended, which 2.3g allows (a build during which an input changed is discarded, and the next is built at the revision current once the tracker settles), the bound revision's covering set is unknown, so it is taken as every discovered workspace (widening, C126), and the wait answers superseded at once, naming the newer revision and every path whose digest differs from the bound revision's snapshot, and list every path whose digest changed, appeared or disappeared. Keep the bound revision's snapshot referenced only while the wait is pending.
- [ ] (AC3, AC4) Give the waits the change signals they need, without a timer: in `packages/daemon/src/daemon/lifecycle.ts`, signal after each stored run or discovery and each job that stored nothing; take the tracker's revision signal and the dependency builds' end from 2.3g; and, while any wait is held only by unsettled inputs, await `settled()` and judge again when it resolves, which covers a reconciliation that ends with nothing changed and the watcher health and input set it re-establishes, with no change to the tracker; in `packages/daemon/src/daemon/workspace-schedule.ts`, where `WorkspaceSchedule` records the round (`ROUND`: pending with its `ROUND_WAIT`, planned, held) and each workspace's execution, signal whenever that record changes (a round begins, is planned, is held or ends; a workspace is queued, runs or is interrupted; the discovery is held or released, 2.3l). One signal, "the daemon's state moved", is enough: the waits recompute from what they read (C8).
- [ ] (AC1 to AC8) In `packages/daemon/src/daemon/lifecycle.ts`, implement `DaemonHandlers.wait` by handing the request and its signal to the waits; in `packages/daemon/src/query/answer.ts`, declare the wait answer (`WaitAnswer`: its outcome, `settled`, `superseded` or `unsettled`, as exported constants with a members record, as `TEST_STATES` is; the per-file coverage; the counts; the named failures; the workspaces; the revisions; and `AnswerContext`), taking selection's shapes from `selection/selection-types.ts` (`SelectionReason`, `NotRunnableWorkspace`, `NoSelectionKind`) rather than restating them (C14).
- [ ] (AC8) In `packages/daemon/src/query-client.ts`, add `queryWait(consumerRoot, paths, options?)`, sending a `WaitRequest` and passing the limit, or `WAIT_LIMIT_MS` when the caller gives none, plus `RESPONSE_BOUND_MS` as `DaemonConnection.request`'s bound (2.4 AC6), passed as `queryPathStatus` passes its own bound, widening the private `query()`'s request type (`SummaryRequest | PathStatusRequest`) to take a `WaitRequest`; its errors go through `queryErrorReason`, as the other queries' do. Export it, the wait answer's types and outcome constants, and `MAX_WAIT_LIMIT_MS` from `packages/daemon/src/client.ts`, which the command reads.
- [ ] (AC9, AC10) Create `packages/cli/src/commands/wait.ts`, a `Command` named `wait` beside `status.ts`: parse with `parseArgs` in strict mode, `JSON_OPTION`, `--root` and `--limit`; take every positional as a file, requiring at least one and refusing an empty one through `nonEmptyPath`, and refuse an empty `--root` the same way; resolve each and the root with `absolutePath`. More than `MAX_WAIT_PATHS` files is left to the daemon's refusal (AC7), one source for the bound, so it exits 1 (AC11). Parse `--limit` against a decimal-digit pattern before converting it (C155), and refuse a value below 1 or past `MAX_WAIT_LIMIT_MS` in seconds, taken from the daemon's constant rather than a second one (C14, C23). Register the command in `packages/cli/src/main.ts`'s `COMMANDS`, whose usage lines every usage error prints.
- [ ] (AC9, AC11, AC12) In the command's run, call `queryWait(root, files, { limitMs })` inside `reported`, with `limitMs` the `--limit` seconds converted to milliseconds through a named constant (C3) when `--limit` is given and left out otherwise, so the daemon's default applies, answer `output.succeed(answerFields(answer), waitText(answer))` for every answer, and `output.fail(errorText(error), { consumerRoot, requestedPaths })` for every rejection, as `status.ts` does (C152, C153).
- [ ] (AC13) Write `waitText` in `wait.ts`, and add to `packages/cli/src/answer-text.ts` only the lines `wait` shares with `status` or `summary`, and keep lines only `wait` prints in `wait.ts` (C59), widening its `Answer` union to take the wait answer so `contextLines` serves it unchanged (C14). Route every consumer-derived value through `oneLine` (each file, workspace, module, test name, changed path, refused path and failure's first error line), and take a multi-line value's first line with `firstLine`, exporting it from `answer-text.ts`, before `oneLine`; name each heading and phrase as a constant (C3). No heading or line states a verdict on the files' tests as a set: the first line names only settled, superseded or unsettled, and failures appear only as counts and named failures (C133). The covering workspaces' execution states come from the wait answer (AC6, which gives each one's reason when it is not current), and `contextLines` prints every workspace's schedule (2.3i) and a held discovery (2.3l) from the same answer, composed at one moment, so the two cannot disagree; both are printed, rather than giving `contextLines` a mode (P19).
- [ ] (Support) Send the orchestrator the doc text in § Doc text, with the build (C7), plus each hit of `rg -n "four commands|wait <files>|rt-test wait" README.md docs` that still lists four commands or describes the wait command as planned (C48).
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
- 2.3i's schedule (`ScheduleReader` and `WorkspaceSchedule` in `daemon/workspace-schedule.ts`; `ScheduleFacts`, `EXECUTION_STATE`, `IDLE_REASON` (`retry-pending`, `no-run-until-input-change`, `round-held`, and `self-changing` from 2.3k), `ROUND` and `ROUND_WAIT` in `query/answer.ts`; every answer's `schedule` and `latestSelection`): each workspace's execution state, why an idle one has no run coming, and what a pending round waits for (AC3, AC5, AC6). Its bound on explained changed paths, `MAX_EXPLAINED` (20), is private to `workspace-schedule.ts`; export it only if AC4's list reuses it (C14, C23).
- 2.3l's held discovery, carried in `AnswerContext` and printed by `contextLines` (AC3, AC6, AC13).
- `queryBasis`, `countStandings`, `cutReason` (`query/summary.ts`, `query/test-states.ts`): the context, standings and counts every answer shares, and how a reason is cut.
- `ProjectInputs` (`inputs/fingerprint.ts`): a committed snapshot of input digests (AC4).
- 2.4's late answer, handler signal and client bound; 2.4d's `resolveCallerPath` and `CallerPath` (`query/caller-paths.ts`), `TrackedInputs.readNamed` and its `UnreadPath` (`inputs/queued-reads.ts`), and `lifecycle.ts`' `pathStatus`, the shape the wait's handler follows (resolve, read, answer nothing more once the signal aborts).
- `queryErrorReason`, `onProvenConnection`, `requireAnswer` (`query-client.ts`, `daemon/proven-connection.ts`): the client path the other queries take.
- `Command`, `JSON_OPTION`, `absolutePath`, `nonEmptyPath`, `UsageError` (`cli/src/command.ts`) and `reported`, `Output`, `oneLine`, `EXIT_*` (`cli/src/output.ts`): how every command parses, reports and exits.
- `statusCommand` (`cli/src/commands/status.ts`): the command `wait` is shaped like, with `--root` and a required path.
- `answerFields`, `contextLines`, `countLines`, `notDiscoveredLines`, `cutReasonText`, `INDENT`, `joinLines`, and `firstLine` once exported (`cli/src/answer-text.ts`): the answer's JSON fields and its shared text.
- `errorText` (`@rt-test/daemon/client`).

### Must Create

- `daemon/waits.ts`: the pending waits, their binding, re-judging, superseding and limit (AC1 to AC5).
- `query/wait-answer.ts`: the settle judgment and the answer (AC2, AC3, AC6).
- `WAIT_TYPE`, `WaitRequest`, `WaitResponse`, `DaemonHandlers.wait`, `WaitAnswer`, `queryWait` (AC7, AC8).
- `WAIT_LIMIT_MS`, `MAX_WAIT_LIMIT_MS`, `MAX_WAIT_PATHS`, `MAX_NAMED_FAILURES` and AC4's bound on listed paths.
- The "daemon state moved" signal from the lifecycle and the scheduler (AC3, AC4).
- `cli/src/commands/wait.ts`: the command and `waitText` (AC9 to AC13).
- The shared text lines for coverage and named failures in `answer-text.ts` (AC13).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

One of the tickets the original 2.4 (wait for files) became (orchestrator, 2026-09-28 12:18 and 13:26). Ticket 2.4 lets the daemon answer late (landed); 2.4d reads the paths a query names and resolves a caller's paths; this ticket is the wait, its programmatic API and the `rt-test wait` command, and completes FR9. Build order: 2.3l, 2.4d, 2.4b.

Requirements this ticket delivers (`docs/requirements.md`):

- "FR9: Answer `wait <files>` once every test covering those files has a current result or an explicit non-current state, as superseded when a covering input changes after the call, or as unsettled, naming each covering workspace's execution state, when its time limit passes first." (AC1 to AC13)
- "NFR3: Never report a result as current unless its stored input fingerprint matches the current inputs." (AC1)

Rule clauses the criteria rest on:

- `docs/architecture.md` § Query surface: "A wait binds to the input revision at call time and returns when every test covering the files has a current result or an explicit non-current state, or as superseded, naming the newer revision, as soon as a covering input changes, or as unsettled, naming each covering workspace's execution state, once its time limit passes. The default limit stays under the two minutes a coding agent's shell tool commonly allows a command, so an agent always gets an answer and can wait again." (AC1, AC3, AC4, AC5)
- AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states. A zero-test selection is not proof of success." (AC2, AC6)
- AGENTS.md § Product guarantees: "Widen selection when dependency information is uncertain." (AC2)
- `docs/architecture.md` § Query surface: "Read operations never trigger execution." (the wait starts no job; a named read that finds a changed file moves the revision, as its event would have, and the scheduler decides what runs)
- `docs/architecture.md`, the query paragraph: "`rt-test summary` and `rt-test status` print the counts, never a pass or fail for a set." and "None of the four commands loads a Vitest module, consumer config or test file, and each gives one versioned JSON document on stdout under `--json`." (AC11, AC12)
- `project-context.md` P32: "The CLI and programmatic API query results or wait for a revision scoped to given files, and never spawn Vitest." (AC8, AC9)
- `project-context.md` P33: "Expose the product as a CLI with `--json` output in front of the daemon, plus a small programmatic API." (AC8, AC12)
- `README.md` § Query: "Exit codes: 0 when the query answered, whatever the tests' states; 1 when it could not ... and 2 on a usage error." (AC10, AC11)

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
- Q5 (AC5, AC9; decider: the owner, 12:18, recorded 13:18): the default limit is under 2 minutes, about 100 s, so an agent always gets an answer before its shell tool kills the call at 2 minutes; callers may pass a longer limit; on the limit the wait answers unsettled, naming each covering workspace's execution state, so the agent can wait again. FR9, the glossary and architecture's § Query surface carry it (orchestrator, 13:19). The daemon holds the default, so the command passes a limit only when `--limit` is given.
- Q6 (AC6): up to 20 named failures with the first line of each first error, counting the rest.
- Q7 (AC11): exit 0 for every answer, 1 only for no answer; agents read the outcome from the JSON. Reason: summary and status never give a pass or fail for a set (architecture), and an exit code is one.
- Q8 (AC7): the Windows spellings are resolved by the piece that first takes caller paths; at 13:26 that became 2.4d, which this ticket calls.
- Q9 (AC7): files only; a directory is refused, as are more paths than a named bound.
- Refuse whole (13:26; AC7, AC11): a wait naming any refused path is refused whole, naming each refused path; the command reports that refusal as exit 1.
- W1 (grill, asked 13:35, answered 13:35; AC3): the inputs are unsettled while no current fingerprint can be computed for any reason; a persistently unhealthy watcher runs the wait to its limit, which answers unsettled naming the watcher's reason, a known limit, never a guess that the failure persists.
- W2 (grill, 13:35; AC5, AC10): `MAX_WAIT_LIMIT_MS` is 1 hour; a limit outside 1 ms to 1 hour gets the invalid-request error. The command takes whole seconds, so from 1 s to `MAX_WAIT_LIMIT_MS` in seconds.
- Ticket review (create-ticket 6c, 13:35 to 13:39): 11 findings, all applied. F1 lets a caller set any limit from 1 ms, timed from the request's arrival; F2 carries each refused path's reason to the client; F3 puts the wait's constants in `protocol.ts` so the client has the default; F5 judges waits again when the inputs settle with no new revision, through `settled()`; F6 reads the named paths again after a reconciliation the first read skipped, then binds; F7 and F9 widen, and name the widening, for both kinds of missing dependency information; F8 makes coverage one function; F11 widened the broken-test search and dropped two counts. Two questions were settled by create-ticket toward widening: F4, a limit passing before the wait binds or knows its coverage, answers unsettled with coverage not yet known, naming every confirmed workspace; F10, a bound revision whose build never ends because 2.3g discards a build the revision overtakes (2.3g AC2), answers superseded at once when the revision moves, taking every workspace as covering. The orchestrator agreed F10 and F4 at 13:40.
- C1 (grill, asked 13:42, answered 13:42; AC9, AC10): `--limit <seconds>`, whole seconds from 1 to 3,600, parsed by digit pattern; with no flag the daemon's default applies.
- C2 (grill, 13:42; AC13): nothing is written while the command waits.
- Command review (create-ticket 6c, 13:42 to 13:44, over the command's criteria): 13 findings, 12 applied. F1 refuses an empty `--root` and a `--limit` of 0; F2 converts seconds to ms and omits the limit without the flag; F3 bars a verdict line (C133); F4 adds a connection closed mid-wait to the no-answer cases; F7 keeps wait-only lines in `wait.ts`; F8 escapes each first error line; F9 widens the broken-test search; F10's sweep added README line 12 to the doc text; F11 and F12 narrowed two design notes. Two questions were settled by create-ticket: F5, more files than `MAX_WAIT_PATHS`, is the daemon's refusal (one source for the bound), so exit 1; F6, covering workspaces' states printed beside `contextLines`' schedule, prints both, since one answer composes both at one moment and AC6 gives each one's reason. F13 was rejected: 2.3f was unbuilt, and the 13:41 scan named it. The orchestrator agreed F5 and F6 at 13:45.
- Listed files in the superseded check (asked by the orchestrator at 20:55 on 2026-09-29, from ticket 2.3p's author; decided by create-ticket at 20:56, as the orchestrator leaned; AC4): after 2.3p, an edit to a listed test module, setup, global setup or env file that the inputs leave out moves the revision, but never enters a covering workspace's narrowed input digests, so AC4 as written left such a wait waiting for the rerun instead of answering superseded. Decided yes: AC4 counts those listed files among a covering workspace's inputs and compares them through `ProjectInputs`' accessor over both sets. Reason: superseded means "an input a covering workspace reads changed after the call", and a listed file is exactly such an input (its edit stales the workspace, and AC2 already has it cover); an agent waiting on it needs the prompt answer, and the accessor exists. Nothing reads falsely current either way, so this only answers sooner. The § Known limits entry for an edit no event reports still holds for a listed file outside the consumer root, which 2.3p does not watch.
- Self-changing (orchestrator's request at 20:44 on 2026-09-29, from ticket 2.3k's decision (d); AC3): 2.3k adds the idle reason `self-changing`, a workspace held because its own runs and discoveries keep changing the same input, released by an edit reaching its inputs or a change the daemon cannot attribute. Nothing runs it until then, so it joins AC3's nothing-coming list: a wait covering it settles and names it, as for a periodic retry or a held round.
- A lasting per-workspace missing fingerprint (orchestrator's note at 18:57 on 2026-09-29, from ticket 2.3q's authoring; decided by create-ticket at 18:58; AC3, AC2): after 2.3q, a Vitest 5 workspace with a nested `projects` container, or with Vitest's private container record missing, reports its env sources as not known for as long as its config stays so, and a rediscovery does not heal it. AC3's "inputs unsettled" (W1) read "no current fingerprint for any reason", which would have held a wait on such a workspace to its limit even with nothing coming. W1's intent was the tracker-wide causes (its example is the watcher), so "unsettled" is narrowed to those, the view's `unavailable`; a covering workspace whose own fingerprint is missing (env files not known, a listed file whose read refuses, as 2.3m's FIFO or unreadable env file) settles once the schedule shows nothing coming, naming the reason. And since such a workspace's env files cannot be listed, it covers every named `.env` or `.env.*` file (widening, C126), so AC2 never answers such a file as covered by no test.
- 2.3i landed (orchestrator's request, 18:34 on 2026-09-29, from 2.3i's review): `PROTOCOL_VERSION` is unchanged by this ticket (reworded at the orchestrator's request at 19:16, since 2.3k raises it again); AC3's nothing-coming list gains a round held after a failed scheduling step, which 2.3i retries at the next input event or reconciliation and names with the idle reason `round-held` (ruled 17:57); the schedule's names follow the landed code (`WorkspaceSchedule` in `daemon/workspace-schedule.ts`, which replaces `scheduler.ts` in the signal task and the file lists, and `IDLE_REASON`, `ROUND`, `ROUND_WAIT` in `query/answer.ts`), and AC3's pending round names every `ROUND_WAIT`. Q (asked by the orchestrator at 18:34): does a held round keep a wait from answering settled, as a pending periodic retry does not? A (decider: create-ticket, 18:35, the orchestrator's lean): no, it does not hold the wait. Reason: AC3 settles a workspace with nothing coming now, and Q3 already ruled that a periodic retry does not hold a wait; a held round is retried only at the next input event or reconciliation, which is no nearer. An input event that moves the revision judges the wait again anyway (superseded, or settled at the new revision, AC4), and holding the wait would only run it to its limit to give the same states as unsettled.
- Listed files cover (asked by the orchestrator at 16:41 on 2026-09-29, from 2.3m's authoring; decided by create-ticket at 16:43; AC2): after 2.3m, each env file Vite loads for a workspace is an input of its fingerprint whatever git ignores, as a listed test module is, and selection places no such file, so a wait on `.env.local` would have answered covered by no test although its edit stales that workspace. A workspace whose fingerprint lists a named file (a listed test module or env file) now covers it beside selection's workspaces, since a wait's coverage must never be narrower than staleness (NFR3; "A zero-test selection is not proof of success"). No named read is added for such a file: 2.3m reads it afresh at each fingerprint's composition, so answers see its edit without an event (§ Known limits for what that leaves). The orchestrator agreed at 16:43.
- Q (asked by create-ticket at 16:43 on 2026-09-29): 2.3m is not ordered before this ticket, so does this ticket cover 2.3m's env files, or does 2.3m owe that coverage? A (decider: the orchestrator, 16:43): 2.3m lands before this ticket's dev is dispatched, and the orchestrator holds that dispatch until it does; this ticket covers both listings, the listed test modules and 2.3m's env files, and 2.3m owes nothing in this ticket's code.
- Listing names (relayed by the orchestrator at 01:55 on 2026-09-30, from 2.3p's review): the coverage task names `listedPaths(workspaceListing(entry))` and `workspaceEnvFilesKnown`, which landed on main (`inputs/protection.ts`, `inputs/fingerprint.ts`, `inputs/env-files.ts`, confirmed at 7301332).
- Held discovery (relayed by the orchestrator at 01:55 on 2026-09-30 from ticket 2.3l, which builds first; decided by create-ticket at 01:56; AC3, AC6, AC13): 2.3l holds the discovery while its own runs and discoveries keep changing an input every discovery reads. A held discovery keeps no round pending, so no wait hangs on it, and each answer's context and schedule carry the hold (2.3l AC4). Q: does the wait's answer name it? Decided yes, through the `AnswerContext` AC6 already carries, the record summary and status read, and never a field of its own (C8); the command prints it through `contextLines` (AC13). Reason: the wait settles on the discovery in effect, so an agent must see that no rediscovery is coming, as it sees a `self-changing` or `round-held` workspace, and a second field would be a second record of one state.
- Fold (orchestrator, 01:55 on 2026-09-30): the owner raised create-ticket's file limit at 01:51 to 25 estimated files, or up to 30 when a split would cut one behavior in two (skill commit ba663f0), and asked to recombine splits made under the old 20. Ticket 2.4c (the wait command) folds into this ticket, whose key and file stay, so one ticket delivers the wait through the daemon, the programmatic API and the CLI. Its criteria are AC9 to AC13 here.
- 2.4d landed (orchestrator's request at 07:22 on 2026-09-30, from rt-t2-4d-review's doc-verify at 07:18; applied by create-ticket at 07:24; AC1, AC3, AC6, AC7, AC8): (1) the named read gives no report that it read nothing, and also reads nothing before an input set is established, so the wait reads its paths a second time after `settled()` unconditionally; (2) `readNamed` resolves with the `UnreadPath` entries it found but could not read (the orchestrator's 06:55 ruling on 2.4d), and the wait never settles while holding one, answering each as unable to get current results, with its reason; (3) `resolveCallerPath` accepts directories, which status needs, so the wait refuses a resolved directory itself (AC7, Q9); (4) 2.4d's refusal reasons begin with the path, so the wait's refusal gives each reason once; (5) `query-client.ts`' private `query()` widens its request type for `queryWait`; (6) 2.4d is done, and § Current structure is refreshed at 96c5a9c. Sizing unchanged: the tracker, `caller-paths.ts` and `path-status.ts` are read, not edited.
- Sizing (13:26 on 2026-09-28): the first draft of the wait measured about 17 raw files, 22 estimated; the named read and caller-path resolution moved to 2.4d.

#### Decisions taken here

- **`--limit` in seconds.** A person or an agent sets a wait's limit in seconds, as a shell tool's own timeout is set; milliseconds would invite a limit a thousand times shorter than meant. The daemon's range is in ms, so the command's maximum is derived from `MAX_WAIT_LIMIT_MS` rather than restated (C23).
- **No progress line while waiting.** The command writes nothing until the answer, so a caller reading stderr sees either the reason for no answer or nothing; the answer names each covering workspace's execution state when it returns. Not analyzed beyond this: a person at a terminal sees nothing until the answer; the 100 s default bounds that, and a longer `--limit` is the caller's choice.

#### Design notes

- **Why the wait reads first, then settles, then reads again.** 2.4d's named read resolves at once while a reconciliation runs, since a status must stay fast (2.4d D1), and reads nothing then or before an input set is established, without saying so; a wait must bind to a revision whose inputs are read, so after the read it awaits `settled()`, which waits a reconciliation out, and reads again unconditionally, since a second named read of an unchanged file changes nothing (2.4d's amendment at 05:45), then binds (AC1).
- **Why an unread path holds the wait.** 2.4d's status answers every result unknown when its read could not read what it names (`withoutFingerprints`, `query/path-status.ts`), since no read vouches for that file; a wait must never answer settled on the same missing evidence. The file's own event, when its save completes, moves the revision and supersedes the wait, and the caller waits again (AC3, AC4).
- **Why selection decides coverage.** After 2.3g, a path lies in workspace W's narrowed inputs exactly when selection of that path includes W; using selection's per-path report keeps "covering" and "made stale" one decision (C8), and it answers for a deleted or new file, which no input set holds.
- **Why a later revision is judged only once its build has ended.** Before that build, the later revision's covering set and narrowed inputs are unknown (2.3g AC3), and judging on the bound revision's alone would miss a workspace that now covers a named file through a new import. The one exception is a bound revision whose own build never ended: 2.3g discards a build the revision overtakes, so there is nothing to compare against, and AC4 widens to every workspace and answers superseded as soon as the revision moves.
- **Settled is judged at the current revision, not the bound one.** A later revision that changed no covering input leaves the covering workspaces' fingerprints as they were at the bound revision, so their results are current for both (AC3 after AC4 has said no).
- **Why one signal.** Every settle and supersede decision is recomputed from the store, the tracker and the schedule at the moment of the signal; a signal carrying what changed would be a second record of state that could disagree with the first.
- **Why the exit code does not follow the outcome.** An agent that reads only the exit code must still read the answer to know which tests failed, and a non-zero exit for "superseded" or "unsettled" would read like an RT Test failure to a shell tool; the outcome is a top-level field of the answer and the text's first line (Q7).
- **Answer size.** The answer lists per named file (at most `MAX_WAIT_PATHS`), per covering workspace, and bounded failures and paths; 2.4's size check turns an answer past the line limit into the nothing-to-answer error, as for every query.
- **Scope of the analysis.** Analyzed: a save not yet reported, a new and a deleted file, a declared non-input, no dependency information, a covering workspace in each execution state, a held discovery, a change inside and outside the covering inputs, a path-less cause, the limit, a stop and a client that leaves (both 2.4's), a refused path, every answer outcome through the command, each way of getting no answer, each usage error, and the `--json` document's shape. Not analyzed: the text's exact layout, which dev sets within AC13; the cost of re-judging many pending waits at each signal, which a consumer's agents bound by how many waits they hold, a target for 2.5 to measure.

#### Known limits

- **An edit to a listed file outside the consumer root** (an env directory or setup file that climbs out of the root), which ticket 2.3p does not watch, moves no input revision, so it never supersedes a wait. The covering workspace's results read stale from the next answer on, since the file is read afresh each time a fingerprint is composed, and the wait keeps waiting until a run over the new content lands, which the scheduler starts only at the next input revision or periodic reconciliation, or until its limit answers unsettled. No answer reads the edit's pre-edit result as current. A listed file under the root that the inputs leave out, such as a gitignored `.env.local`, raises an event after 2.3p and supersedes the wait (AC4).
- **A watcher that stays unhealthy, or an input set that stays unestablished,** keeps every wait waiting until its limit, which then answers unsettled with the reason in its context (Q4: a cause that names no path leaves the inputs unsettled).
- **A steady stream of edits to a covering workspace's inputs** keeps superseding waits on it; each answer names the newer revision, and the caller waits again.
- **A save to a file the wait does not name**, not yet reported by the watcher, is seen only when its event arrives; if it lies in a covering workspace's inputs, the wait is then superseded (2.4d's known limit).

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.4b --except 2.4c` over this ticket's production files and `cli/src/command.ts` (01:56 on 2026-09-30) named 2.3l, 2.3n and 2.4d. 2.3f, 2.3g, 2.3h, 2.3i, 2.3k, 2.3m, 2.3p, 2.3q and 2.4 have landed, and this ticket builds on their code as the first task re-reads it.

- **2.3l** (done): writes `lifecycle.ts`, `workspace-schedule.ts`, `query/answer.ts`, `protocol.ts` (raising `PROTOCOL_VERSION`), `client.ts` and `cli/src/answer-text.ts`, and holds the discovery; the hold is in `AnswerContext`, the schedule and a `contextLines` line, which AC3, AC6 and AC13 read.
- **2.4d** (done, 96c5a9c): the caller-path resolution with the Windows refusals (`resolveCallerPath`), the tracker's named read (`readNamed`, resolving with the `UnreadPath` entries it could not read), and `pathStatus` answering late in `lifecycle.ts`.
- **2.3n** (done): wrote none of these files.
- **2.6** (backlog): the `changes` query, whose cursor binds to this ticket's input revision.

#### Sizing

About 19 raw files and 25 estimated (19 times 1.3 is 24.7); code units 14 (13 criteria plus validation); within 25 estimated files and 15 code units. Production (12): `daemon/protocol.ts`, `daemon/server.ts`, `daemon/lifecycle.ts`, `daemon/workspace-schedule.ts`, `query/answer.ts`, `query-client.ts`, `client.ts`, new `daemon/waits.ts` and `query/wait-answer.ts`, `cli/src/main.ts`, `cli/src/answer-text.ts`, and new `cli/src/commands/wait.ts`. Tests, for create-tests (7): `packages/daemon/test/server.test.ts` (routing and request validation), `lifecycle.test.ts` (the handler and signals), `query.test.ts` (settle and the answer from stand-in state), `daemon.test.ts` (a real daemon: save, wait, settled; an edit mid-wait, superseded), `packages/daemon/test/defects.json`, `packages/cli/test/cli.test.ts` (the command against a real daemon, and each usage error) and `packages/cli/test/defects.json`. Over 10 estimated, so dev delegates, in three groups in order: the protocol and client (`protocol.ts`, `server.ts`, `query-client.ts`, `client.ts`); the wait (`waits.ts`, `wait-answer.ts`, `answer.ts`, `lifecycle.ts`, `workspace-schedule.ts`); the command (`commands/wait.ts`, `main.ts`, `answer-text.ts`).

#### Current structure of the modified files

The build wait is `DependencyBuilds.awaitBuild` (`daemon/dependency-builds.ts`), the scheduler's per-workspace run record is `RunHistory` (`daemon/run-history.ts`), and the list of jobs that stored nothing is `UnstoredJobs` (`daemon/job-endings.ts`), which `lifecycle.ts`' `#nothingStored` fills; take the dependency builds' end signal (the signal task) from `DependencyBuilds`.

As of wt/1 at 96c5a9c (2.4d as it landed, after 2.3l and 2.3n), read at 07:23 on 2026-09-30; each is re-read at the first task.

- `packages/daemon/src/daemon/protocol.ts` (280 lines): request and response types per query (`SUMMARY_TYPE`, `PATH_STATUS_TYPE`), `PROTOCOL_VERSION` (unchanged by this ticket; tickets before it raise it), `RESPONSE_BOUND_MS`, the error codes.
- `packages/daemon/src/daemon/server.ts` (437 lines): `DaemonHandlers`, `versionedAnswer` routing by type, `pathStatusResponse` validating an absolute path with the invalid-request error, `queryResponse`, and 2.4's late answers.
- `packages/daemon/src/query-client.ts` (104 lines): `querySummary`; `queryPathStatus`, which passes a private `PATH_STATUS_BOUND_MS` (60 s) as its bound; the private `query(…, request: SummaryRequest | PathStatusRequest, …)`; `queryErrorReason`; `client.ts` re-exports the two queries.
- `packages/daemon/src/query/caller-paths.ts` (109 lines, read only): `resolveCallerPath(absolutePath, consumerRoot)` gives `{ ok: true, given, path }` (a `CallerPath`, root-relative) or `{ ok: false, reason }`, whose reason begins with the given path; it accepts an existing directory.
- `packages/daemon/src/inputs/input-tracker.ts` (611 lines, read only): `TrackedInputs.readNamed(paths)` reads the root-relative paths as 2.4d's named read, only while no reconciliation runs and the input set is established, waits on `waitForReadOrReconciliation`, and resolves with the `UnreadPath` entries (`{ path, reason }`, `inputs/queued-reads.ts`) it found but could not read; `settled()` waits a reconciliation out.
- `packages/daemon/src/query/path-status.ts` (read only): `withoutFingerprints(inputs, unread)` drops every fingerprint when `unread` names a path, which the status answer applies.
- `packages/daemon/src/query/answer.ts` (555 lines): `AnswerContext`, `SummaryAnswer`, `PathStatusAnswer`, `TestCounts`, the state constants and members records, 2.3i's schedule shapes and 2.3l's held discovery.
- `packages/daemon/src/daemon/lifecycle.ts` (583 lines): `pathStatus(path, signal)` resolves through `resolveCallerPath`, awaits `readNamed`, answers `NOT_AWAITED_REASON` once the signal has aborted, and composes through `#queryInputs` and `withoutFingerprints`. `daemon/workspace-schedule.ts` (530 lines): 2.3i's schedule record with 2.3l's discovery hold.
- `packages/cli/src/main.ts` (45 lines): `COMMANDS` lists start, stop, summary and status; `main` finds the command, parses, and prints every command's usage on an unknown or missing command.
- `packages/cli/src/answer-text.ts` (454 lines): `type Answer = SummaryResponse | PathStatusResponse`; exports `answerFields`, `countLines`, `contextLines`, `notDiscoveredLines`, `cutReasonText`, `INDENT`, `joinLines`; `firstLine` is private.
- `packages/cli/src/commands/status.ts` (94 lines, not modified): the shape `wait.ts` follows.

#### Existing tests this change breaks

- `packages/daemon/test/server.test.ts`: `handlers(...)` builds `DaemonHandlers` by hand and gains `wait`.
- `packages/daemon/test/lifecycle.test.ts`: constructs the lifecycle, which gains the waits; stand-ins for the scheduler or the tracker gain what the signal needs.
- `packages/cli/test/cli.test.ts`: a test comparing the whole usage listing printed on an unknown or missing command gains the wait line; its `usageOutcome` checks each expected line is included, so only a test asserting the exact listing breaks.
- Found by `rg -ln "DaemonHandlers|DaemonLifecycle|LifecycleParts|scheduler" packages/*/test` and `rg -n "Unknown command|Missing command|usage|answerFields|contextLines|Answer\b" packages` when dev starts, and by `bun run typecheck` across the repository for any hand-built shape or one the widened `Answer` union breaks (P14).

#### Doc text

Dev reports this text with the build; the orchestrator writes it (C7).

- `docs/architecture.md`, the query paragraph: "The daemon also answers a wait for given files: it reads each file as an event naming it would, binds to the input revision once those reads and every earlier event are read and no reconciliation runs, takes the tests covering each file from selection at that revision, widening to every discovered workspace while there is no dependency information, and answers settled once each covering workspace reads current or has nothing coming, superseded once an input a covering workspace reads differs from the bound revision's, naming the newer revision, or unsettled at its time limit, 100 s by default. Each answer names each covering test that failed or errored and each covering module that failed to load or crashed, up to 20, with the first line of its first error. `queryWait` in `@rt-test/daemon/client` sends it."
- `docs/architecture.md`, the query paragraph: "`rt-test summary` and `rt-test status` print the counts" gains `rt-test wait`, and "None of the four commands" becomes "None of the five commands".
- `README.md` § Query, the usage block gains `rt-test wait <file>... [--root <dir>] [--limit <seconds>] [--json]`, and after the paragraph on `rt-test status <path>`: "`rt-test wait <file>...` returns once the tests covering the files have current results or can get none, or earlier as superseded when an input they read changes, naming the newer revision, or as unsettled when its limit passes, 100 s unless `--limit` sets another, up to an hour. Each file resolves against the current directory. Its answer gives each file's covering workspaces, the covering tests' counts, up to 20 failures with their first error line, and what each covering workspace is doing. It exits 0 for every answer; read the outcome from its first line, or `outcome` under `--json`."
- `README.md` line 12's "and `wait <files>` returns once the results covering your files are current" becomes "and `wait <files>` returns once the results covering your files are current or can get none, or sooner as superseded or unsettled".
- Swept by `rg -n "four commands|wait <files>|rt-test wait" README.md docs` (13:44 on 2026-09-28): besides the lines above, `docs/roadmap.md` line 19 (the sprint's plan, still true), `docs/requirements.md` FR9 and `docs/architecture.md` § Query surface (both already describe the wait) need no edit.

#### Previous ticket

2.4d (done): `status <path>` reads its path before answering, never waiting for a reconciliation, and a caller's path resolves through `query/caller-paths.ts`, refusing on Windows a missing name ending in a dot or space or in an 8.3 form. 2.4 (landed): the late answer.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.4, § Ticket 2.4d, § Ticket 2.4b, § Ticket 2.3l, § Ticket 2.6.
- Tickets 2.3g, 2.3f, 2.3i, 2.3l, 2.4 and 2.4d (`_agent-docs/tickets/`), and 1.4 (`_agent-docs/tickets/1-4-query-cli.md`), which built `summary` and `status`.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (12:14 on 2026-09-28).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C7,C8,C11,C12,C14,C22,C23,C24,C30,C32,C38,C39,C40,C46,C48,C55,C59,C113,C115,C126,C129,C130,C131,C133,C151,C152,C153,C155,C157,C160 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P18,P19,P21,P32,P33,P34 -->

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
sizing_ac_count: 14
files_to_modify:
  - packages/daemon/src/daemon/protocol.ts
  - packages/daemon/src/daemon/server.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/workspace-schedule.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/query-client.ts
  - packages/daemon/src/client.ts
  - packages/cli/src/main.ts
  - packages/cli/src/answer-text.ts
files_to_create:
  - packages/daemon/src/daemon/waits.ts
  - packages/daemon/src/query/wait-answer.ts
  - packages/cli/src/commands/wait.ts
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

- _agent-docs/tickets/2-4b-wait-for-files.md (created by create-ticket; 2.4c's ticket folded in at 01:56 on 2026-09-30)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.4b written with the rulings at 12:21 to 13:34 and linked, under the orchestrator's 12:18 grant; § Ticket 2.4c folded into it and the split note reworded at 01:56 on 2026-09-30, under the orchestrator's 01:55 grant)
- _agent-docs/sprint-status.yaml (2-4b-wait-for-files added at 12:21, set ready-for-dev; 2-4c-wait-command removed at 01:56 on 2026-09-30, under the 01:55 grant)
- docs/requirements.md (FR9 amended), docs/glossary.md (Wait amended, Unsettled added), docs/architecture.md (§ Query surface): written by the orchestrator at 13:19 from this lane's drafts

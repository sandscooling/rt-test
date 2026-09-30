# Ticket 2.7: Agent feedback hook

## Ticket

As a coding agent working in a consumer whose RT Test daemon runs its tests, and the person watching that agent,
I want Claude Code to tell the agent, after each batch of its tool calls, which tests covering the files it edited changed state or freshness, failures first, and to say in one line at the end of a turn and with the next prompt while those tests are still failing or not current,
so that the agent learns what its own edits broke or fixed without asking or running a test, and hears once, rather than nothing, when RT Test cannot answer.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: `rt-test hook claude-code [--root <dir>]` reads one Claude Code hook payload from stdin and answers its `PostToolBatch`, `Stop` and `UserPromptSubmit` events; any other event says nothing. The root is `--root`, or the directory the hook runs in. RT Test writes no Claude Code settings file: a consumer opts in by adding the settings block the README gives, three entries that each run this command with `--root "$CLAUDE_PROJECT_DIR"`, and a consumer that adds none gets no hook.
- [ ] AC2: A session's edited files are the file paths of the `Write`, `Edit` and `NotebookEdit` calls in each batch the hook receives for that session (its `session_id`), the main agent's and each subagent's alike, remembered across the hook's runs, most recently edited first, at most `MAX_CHANGES_PATHS` (ticket 2.6); a path outside the consumer root, judged by its real path while the file exists, is left out. A batch whose calls name no file, such as `Bash` or `PowerShell` calls, adds none, and the hook asks about the files edited so far. A session that has edited no file under the root asks nothing and says nothing.
- [ ] AC3: After each batch, when the session has edited files, the hook asks the daemon's `changes` query (ticket 2.6) about them, with the cursor the last answer to the same agent returned: the main agent and each subagent keep a cursor of their own, so each hears every change since its own last report, a subagent's edits included. It adds a report to that agent's context only when the answer is determined and lists or counts at least one change since that cursor; when the answer is a baseline because the agent has no cursor yet, or a cursor the hook gave was not issued by the current daemon life or has expired, and a test in scope is failing or not current, it adds one line saying why and giving those counts. It keeps the cursor each answer returns, so after a not-determined answer, which says nothing, the next call asks from the cursor the daemon handed back.
- [ ] AC4: A report names at most `NAMED_CHANGES` (5) changes, in the order the answer lists them (failing, then recovered, then the rest), each with its test's file and full name, or its not-discovered entry's kind and path, its kind, its standing at the cursor and now (`atCursor` and `now`), and, on a failing change, its first error line cut to `ERROR_LINE_CHARS` (200) characters; it counts the changes it does not name by kind, and adds one line counting the failing tests outside scope when there are any, and one saying how many of the session's edited files it left out when it asked about only the most recent `MAX_CHANGES_PATHS`. It carries no stack, stays within Claude Code's 10,000-character cap on added context, and prints every value read from the consumer's tree on one line with unprintable characters escaped.
- [ ] AC5: At the end of a turn (`Stop`), when the session has edited files and a test in scope is failing or not current, or the answer is not determined, the hook shows the person one line, which never blocks the stop and never makes the agent take another turn: how many tests in scope are failing and how many are not current, or why RT Test has not decided. At the session's next prompt (`UserPromptSubmit`), the same line, asked afresh, is added to the agent's context. Neither event uses or moves the report's cursor, and each says nothing otherwise.
- [ ] AC6: When the hook gets no answer (no daemon serves the root, the daemon predates the query or is stopping, it has nothing to answer, the connection closes first, the request is refused, or no answer arrives within the hook's bound), it tells each agent once, at the first batch or prompt of that agent that meets it, naming the root and the reason, and tells the person once, at the first turn end that meets it; it says nothing more about it until an answer arrives, after which the next loss is told again. A request refused for a path the session edited does not leave every later request of the session refused. The hook starts no daemon, discovery or test.
- [ ] AC7: Every run of the hook ends within `HOOK_BOUND_MS` (a target) of starting to read its payload, plus the process's own start, whatever happens; prints nothing on stdout but one JSON object Claude Code accepts, `{}` when it says nothing; never exits 2, which Claude Code reads as blocking; and exits 0 when it had an answer or nothing to ask, and 1 with the reason on stderr when it had no answer, could not read its payload or its arguments, could not use its user directory, or could not write its memory. A missing memory file is no memory and changes nothing; one that exists but cannot be read or parsed counts as none (AC8), with the reason on stderr. It never blocks a tool call, a stop or a prompt.
- [ ] AC8: The hook keeps each session's memory (the files its agents edited, and for each agent its cursor and whether it has told that agent, and for the main agent the person, that no answer came) for that session and consumer root in the user's own RT Test directory, which only that user can enter, and writes nothing in the consumer's tree (P41). A memory that cannot be read counts as none; a run never reads a torn memory, and no run loses what another run remembered, including runs of one session that overlap, such as a prompt's during a batch's; an agent's memory untouched for `MEMORY_AGE_MS` (7 days) is removed, so an agent's edited files leave the session's memory 7 days after that agent last wrote them.
- [ ] AC9: The hook's end-to-end time for a `PostToolBatch` run against a started daemon, process start included, is measured as a p95 against the 100 ms end-to-end CLI target (`docs/plan.md`), recorded with the hardware, OS, runtime, project size and warm or cold state, and stays labeled a target.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: every Claude Code behavior the criteria rest on was exercised on the installed 2.1.285, and § Measured facts records each with the command that showed it. The daemon behavior the hook calls is ticket 2.6's, this repository's own.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read the landed code of ticket 2.6 (`queryChanges` and `ChangesOptions` in `query-client.ts`, `ChangesAnswer` and its constants in `query/changes-answer.ts`, and what `client.ts` re-exports of them), and confirm the names § The contract, from ticket 2.6 gives. Report any further rename to the orchestrator before building on it.
- [ ] (AC2, AC4) Export what the hook reads and 2.6 left private, rather than restating it (C3, C14): the failing states, `FAILING_STATES` in `packages/daemon/src/query/changes-answer.ts` (or the list derived from it, as `CHANGE_KINDS` is from its members), through `client.ts`; and `MAX_CHANGES_PATHS` from `daemon/protocol.ts` through `client.ts`.
- [ ] (AC3, AC7) In `packages/daemon/src/query-client.ts`, let `queryChanges`' options also carry a bound in milliseconds the caller gives, using the path status's bound when none is given, so the hook's query ends inside its deadline (C40, C166).
- [ ] (AC8) Export through `packages/daemon/src/client.ts` the user's own RT Test directory, as `endpoint.ts` places the daemon's key: `~/AppData/Local/rt-test` on Windows, and on Linux the owner-only runtime directory, created owner-only through `runtimeDirectoryRefusal(directory, true)` and refused when it is not the user's alone. Compute it in one place in `endpoint.ts`, which `endpointOf` then reuses, never a second copy of its constants, and export `identityHash` through `client.ts` for a memory file's name (C3, C4, C13, C59).
- [ ] (AC1, AC7) Create `packages/cli/src/commands/hook.ts`, a `Command` named `hook` taking the harness `claude-code` and `--root`, the root defaulting to the directory the hook runs in, registered in `packages/cli/src/main.ts`. Its `parse` never throws: an argument it cannot parse becomes a run that writes the reason to stderr, prints `{}` and exits 1, since `main` turns a thrown usage error into exit 2 (AC7). Read stdin to its end, take the payload's `session_id`, `hook_event_name` and, for `PostToolBatch`, each `tool_calls` entry's `tool_name` and `tool_input`, and dispatch by event. Start one deadline of `HOOK_BOUND_MS`, a named constant labeled a target, before reading stdin, enforced by a timer that on expiry prints `{}` unless an object was already printed, writes the reason to stderr and exits 1 whatever work is pending; give the daemon's query what is left of it less a named reserve for writing the memory and printing; catch everything, so every path ends in one JSON object on stdout and exit 0 or 1 (C30, C152, C153, C166).
- [ ] (AC2, AC6, AC8) Create `packages/cli/src/hook-memory.ts`: JSON files in the user's RT Test directory, named by a hash of the session, the consumer root and the file's writer, each written by exactly one kind of run, so no two runs ever write one file: each agent's batches (the payload's `agent_id`, absent for the main agent; an agent's batches run one at a time), the session's prompts, and the session's turn ends (C10). An agent's file holds only the paths it edited, each with the time of its last edit, at most `MAX_CHANGES_PATHS` of them with the most recent kept, and its cursor; every file holds when its writer last told of a loss and when it last got an answer (C147). A writer has already told of the current loss when it told after the latest answer any of the session's files records; the main agent counts as told when its batches or the session's prompts told. The session's edited files are the union over its agents' files, ordered by each path's latest edit time, most recent first, without duplicates, cut to `MAX_CHANGES_PATHS` (C22, C23, C32: the report says how many it left out). Read a missing file as no memory, and an unreadable or malformed one as no memory with the reason on stderr (C172); write through a temporary file and a rename, so a reader never sees a torn file; and, when a run creates a file, remove each hook memory file untouched for `MEMORY_AGE_MS`.
- [ ] (AC2, AC3, AC6) On `PostToolBatch`: add the batch's `Write` and `Edit` `file_path` and `NotebookEdit` `notebook_path` values that lie under the root, judged by real path while the file exists, to the batch's agent's memory; with no remembered path in the session, print `{}`; otherwise call `queryChanges(root, paths, { since, boundMs })` with that agent's cursor. On an answer, keep its cursor and the answer's time in that agent's memory, and add context per AC3 as `hookSpecificOutput.additionalContext` with `hookEventName` `PostToolBatch`, which also carries AC6's no-answer line. On a rejection, tell the agent once per AC6; when the request was refused, retry once within the deadline leaving out each path in the session's union that no longer names an existing file or whose real path lies outside the root's, and drop those paths from this agent's own memory only, since another agent's file has its own writer; so a path any agent remembered, one that has ended included, cannot refuse the rest of the session (AC6).
- [ ] (AC5, AC6) On `Stop` and `UserPromptSubmit`: with remembered paths, call `queryChanges` with no cursor, and build the one line from the answer's counts in scope, or its not-determined reason, printing `{}` instead when the answer is determined and no test in scope is failing or not current; `Stop` prints it as `systemMessage`, `UserPromptSubmit` as `hookSpecificOutput.additionalContext` with `hookEventName` `UserPromptSubmit`. Never write that answer's cursor to the memory; on an answer, record its time in the event's own file. A rejection follows AC6, told from the turn ends' file for `Stop` and the prompts' file for `UserPromptSubmit`, and a refused request is retried as on `PostToolBatch`, dropping nothing from any agent's memory.
- [ ] (AC3, AC4, AC5, AC6) Create `packages/cli/src/hook-report.ts`, the text: the report per AC4 from the answer's `changes`, `omittedChanges` and `outside`, cutting each test's full name, each path and each reason to a named character bound so the longest report and every line stay under a named cap below 10,000 characters (C24, C26, C170); the baseline line of AC3; the turn-end line of AC5; the no-answer line of AC6. Read a change's standings from `atCursor` and `now`, and a failing change's `firstError`, which is `null` when no error was recorded for it (say so). Take the kinds, cursor uses, not-determined kinds, failing states and freshness values from the constants `query/changes-answer.ts` and `query/answer.ts` export through the client, never restated (C3, C14); name each phrase and bound as a constant (C3); route every consumer-derived value through `oneLine`, and a multi-line one through `firstLine` first. No line calls the tests passing as a set (C133).
- [ ] (AC9) Measure the hook as AC9 says, with a throwaway driver under `_agent-docs/.scratch/2-7/` that starts a daemon over one of the daemon package's fixtures, runs the built `rt-test hook claude-code` a few hundred times on a `PostToolBatch` payload naming one edited file, and prints p50 and p95; delete the driver afterwards (P11). Record the figures and conditions in § Completion Notes, and report them to the orchestrator with the doc text.
- [ ] (Support) Send the orchestrator the text in § Doc text with the build (C7, C48).
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files and `bun run typecheck` across the repository (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `queryChanges`, `ChangesOptions`, `ChangesResponse`, `CHANGE_KIND`, `CHANGE_KINDS`, `CURSOR_USE`, `NOT_DETERMINED`, `TestChange`, `EntryChange`, `ListedChange`, `NotDeterminedFacts` (ticket 2.6, `query/changes-answer.ts` and `query-client.ts`, through `@rt-test/daemon/client`); `FAILING_STATES` and `MAX_CHANGES_PATHS`, once this ticket exports them; `TestCounts`, `TEST_STATES`, `CURRENT` and `FRESHNESS_VALUES` (`query/answer.ts`).
- `errorText` (`@rt-test/daemon/client`) for a rejection's reason.
- `endpointOf`, `WINDOWS_KEY_DIRECTORY`, `SHARED_TEMPORARY_DIRECTORY`, `RUNTIME_DIRECTORY_PREFIX`, `identityHash` (`daemon/endpoint.ts`), `runtimeDirectoryRefusal` (`daemon/runtime-directory.ts`): the user's directory, and a memory file's name.
- `Command`, `CliIo`, `absolutePath`, `nonEmptyPath` (`cli/src/command.ts`); `oneLine`, `EXIT_SUCCESS`, `EXIT_FAILURE` (`cli/src/output.ts`); `firstLine`, `INDENT` (`cli/src/answer-text.ts`, `firstLine` exported by ticket 2.4b).

### Must Create

- `cli/src/commands/hook.ts`: the command, the payload's fields, the dispatch and the deadline (AC1, AC7).
- `cli/src/hook-memory.ts`: the session memory (AC2, AC8).
- `cli/src/hook-report.ts`: the report and the lines (AC3 to AC6).
- `HOOK_BOUND_MS`, `NAMED_CHANGES`, `ERROR_LINE_CHARS`, `MEMORY_AGE_MS`, and the harness name `claude-code` with its event names.
- `queryChanges`' bound option and the exported user directory (AC7, AC8).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Sprint 2's agent feedback hook. It builds after 2.6 and before 2.7b, which adds the files each batch edited to the hook's request so the daemon counts them as edits (§ Split). It is the first code in this repository that a Claude Code hook runs. It calls ticket 2.6's `queryChanges` in process, so the delta, the kinds and the cursor stay in the daemon, and the hook only parses its harness's payload and prints (P31). This repository wires the hook into one worktree whose daemon the owner starts only after the hook lands, before the Fleet Cooling trial (owner and orchestrator, 2026-09-27 14:24); this ticket wires nothing.

Requirements (`docs/requirements.md`):

- "FR20: Report to a coding agent, after its tool calls, each change since its previous report in the state or freshness of the tests covering the files it edited, naming each test that failed or recovered, through a hook that only queries the CLI and reports the files the agent edited, starts no test and no daemon, and says when RT Test cannot answer rather than falling silent." (AC1 to AC9; its clause "reports the files the agent edited" is 2.7b's)
- "FR21: Answer `changes <files>` with each test covering those files whose state or freshness changed since a cursor an earlier answer returned, failures and recoveries first, with counts for the covering and the other tests, without starting a test." (the query AC3, AC5 and AC6 call)

Rule clauses the criteria rest on:

- `project-context.md` P41: "Only per-user files a client needs before it can reach a daemon, such as the daemon's key and the agent hook's session memory, go in the user's own RT Test directory, which only that user can enter." (AC8; amended by the orchestrator as 6cf1940 at 08:03 on 2026-09-30, for this ticket)
- `project-context.md` P32: "The CLI and programmatic API query results or wait for a revision scoped to given files, and never spawn Vitest" (AC6)
- `project-context.md` P31: "Nothing application- or backend-specific enters the core" (the hook is the harness-specific part)
- AGENTS.md § Product guarantees: "Never report historical results as current after a relevant edit or unresolved input change." (AC3, AC5: every line reads the daemon's answer of the moment, and a not-determined answer is never reported as a result)
- AGENTS.md § Product guarantees: "Keep state and logs local by default." (AC8)
- `docs/plan.md` targets: "End-to-end CLI call, process start included | p95 below 100 ms", under "The following are provisional targets for a warm local project with 10,000 discovered tests. They are not measurements or release claims." (AC9)
- Checklist C153 (a command that could not answer exits non-zero) and C166 (work inside a hook's timeout is bounded): AC7 exits 1 on no answer, which § Measured facts shows Claude Code accepts without blocking or an error notice, and runs everything under one deadline.

Glossary (`docs/glossary.md`), verbatim:

- **Cursor**: "The token a `changes` answer returns, naming the test standings the daemon recorded when it answered, so the next `changes` call reports only what changed since."
- **Freshness**: "Whether a result still describes its test's current inputs."
- **Input revision**: "The number naming a worktree's inputs as the daemon last observed them in its current life, raised once for each batch of changes it observes."

#### Measured facts

Spike on the installed Claude Code 2.1.285 (`claude --version`), Windows 11, 07:53 to 08:09 on 2026-09-30, in a throwaway project `_agent-docs/.scratch/create-ticket/stop-spike/` with its own `git init` and a `.claude/settings.json` whose hooks ran `node "$CLAUDE_PROJECT_DIR/hook.cjs"`, a script that logged each payload and printed a chosen JSON object. Each run was `claude -p "<prompt>" --output-format stream-json --verbose --permission-mode bypassPermissions --max-turns 6`, read from the stream and the payload log; the spike is deleted.

- **PostToolUse payload.** `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort`, `hook_event_name`, `tool_name` (`"Write"`), `tool_input` (`{ "file_path": "<absolute path>", "content": "hello" }`) and `tool_response` (`{ "type": "create", "filePath": ..., ... }`).
- **PostToolUse and PostToolBatch context reaches the model without another turn.** `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"..."}}` was quoted by the model in its next message, and the run took its usual number of turns. The same held for `PostToolBatch`.
- **PostToolBatch fires once per batch, after the batch's PostToolUse hooks, for every batch.** Two parallel `Write` calls fired two `PostToolUse` hooks from different processes about 800 ms apart, then one `PostToolBatch` whose `tool_calls` held both calls, each with `tool_name` and `tool_input`. A lone `Write`, and a lone `Bash` call (`tool_input` `{ "command": "echo hi", ... }`), each fired its own `PostToolBatch`. So registering on `PostToolBatch` gives one hook process per batch, and a session's own batches never run the hook twice at once.
- **A `NotebookEdit` call names its file as `tool_input.notebook_path`** (`{ "notebook_path": "<absolute path>", "cell_id": "cell-0", "new_source": "x = 2", "edit_mode": "replace" }`). The session's tools (the stream's `init` message) held `Write`, `Edit` and `NotebookEdit` as the local tools that edit a file by path, and no `MultiEdit`.
- **A subagent's batches fire the session's hooks with the parent's `session_id`.** A `Write` a `general-purpose` subagent made fired `PostToolUse` and `PostToolBatch` with the parent's `session_id` plus `agent_id` and `agent_type`, which the main agent's payloads lack; the parent's own batch then held the `Agent` call. A subagent's report therefore lands in the subagent's context, which ends with it, so the main agent must keep its own cursor to hear those changes.
- **A Stop hook's `additionalContext` forces another model turn.** With no `decision`, it made the model reply to the injected line at once, and `Stop` fired again with `stop_hook_active: true`. The docs say the same: "This context is added as a system reminder and Claude continues working immediately with another model turn". So it cannot carry a non-blocking turn-end line.
- **A Stop hook's `systemMessage` is non-blocking and reaches only the person.** `{"systemMessage":"..."}` showed as an informational message "Stop says: <line>", `Stop` fired once, and no model turn followed. A resumed session (`claude -p --resume <id> "... quote verbatim every piece of text ... containing ..."`) quoted the PostToolUse line but not the `systemMessage`.
- **UserPromptSubmit `additionalContext` reaches the model with the prompt.** This repository's own sessions run a user-level `UserPromptSubmit` hook whose `additionalContext` (the date stamp) each prompt carries.
- **Exit 1 with a JSON object neither blocks nor shows an error.** A hook that printed a `PostToolBatch` `additionalContext` object, or `{}`, and exited 1 had its context delivered and raised no hook-error notice on `PostToolUse`, `PostToolBatch` or `Stop`; a `UserPromptSubmit` hook that printed an `additionalContext` object and exited 1 let the prompt through, and the model quoted the context, with no notice (08:16); the docs: "With a parsed object that passes schema validation ... Claude Code ignores the exit code". A hook that failed with empty stdout (a `require` in a `.js` file under this repository's `"type": "module"`) raised "Stop hook error occurred". Exit 2 blocks: on `Stop` it "Prevents Claude from stopping", and on `UserPromptSubmit` it blocks the prompt (docs).
- **The hook command runs through a shell that expands `$CLAUDE_PROJECT_DIR`**, on Windows as on Linux, from the session's directory; the docs: "`${CLAUDE_PROJECT_DIR}`: the project root where the session started", and "Handlers run in the current directory with Claude Code's environment", which follows the session's current directory. Hence `--root "$CLAUDE_PROJECT_DIR"` in the settings block, since the current directory may be a subdirectory and a query never looks in a parent.
- **Docs facts the ticket leans on** (https://code.claude.com/docs/en/hooks, read 07:51): "All matching hooks run in parallel"; a command hook's default `timeout` is 600 s, lowered to 30 on `UserPromptSubmit`; "A hook's `additionalContext`, `systemMessage`, and `initialUserMessage` strings, and its plain stdout, are capped at 10,000 characters"; on exit 0 `UserPromptSubmit` "adds plain-text stdout as context", so the hook prints only JSON; "Hook entries merge across settings levels".

#### The contract, from ticket 2.6

As 2.6 built it (50dc810 on `wt/1`, read at 10:57 on 2026-09-30), in `packages/daemon/src/query/changes-answer.ts`, which `@rt-test/daemon/client` re-exports. 2.6's dev renamed three parts of its ticket's § Answer outline 2.7 reads (orchestrator, 10:56): a change's `then` is `atCursor`, since lint forbids a property named `then`; per-file coverage is the wait's two fields, `coverage` and `files`; and `outside.changed` is `null` when no cursor was used. The answer (`ChangesResponse` through the client, `ChangesAnswer` in the module) is `AnswerContext` and:

- `cursor`: `string | null`, "Null when a moment not determined comes before this daemon life recorded any."
- `cursorUse`: one of `CURSOR_USE`, `used`, `none-given`, `not-issued` or `expired`.
- `revision`: the input revision it read.
- `determined: false` with `notDetermined`, one of `{ kind: "inputs-unavailable" | "build-not-ended", reason: CutReason }` or `{ kind: "paths-unread", unread: UnreadFile[] }` (`NOT_DETERMINED`).
- `determined: true` with `changes`, "Failing, then recovered, then the rest, up to `MAX_LISTED_CHANGES`; empty on a baseline", each a `TestChange` (`test`, `atCursor?` and `now?` standings of `state` and `freshness`) or an `EntryChange` (`atCursor?` or `now?`, a `NotDiscoveredEntry`), with its `kind` (`CHANGE_KIND`) and, on a failing change, `firstError: CutReason | null`; `omittedChanges`, counted by kind; `coverage` and `files` (`WaitFile[]`), the wait's per-file coverage; `counts`, "Every test in scope, counted once however many named files it covers"; and `outside: { counts, changed }`, `changed` being "How many tests outside scope changed since the cursor; null when no cursor was used."
- `CutReason` is `{ reason: string, omittedCharacters: number }`.

`MAX_CHANGES_PATHS` (1,000) is declared in `daemon/protocol.ts` and not re-exported through the client, and the failing states are the private `FAILING_STATES` record in `changes-answer.ts`; this ticket exports both (task). AC3's baseline line reads `cursorUse` `none-given`, `not-issued` and `expired`; the not-determined line reads `notDetermined`; this ticket reads neither `coverage`, `files` nor `outside.changed`.

#### Orchestrator rulings

Asked by `session_wake` and answered; decider the orchestrator on each.

- **Turn-end line (asked 07:57, answered 07:58): option C.** At turn end, a `Stop` `systemMessage` to the person: one non-blocking line, as the owner's 14:24 ruling says, which names no recipient. The same line goes into the agent's context with its next prompt, through `UserPromptSubmit` `additionalContext`, once per prompt while covering tests stay stale or failing, since the owner's goal is that the agent learns what its edits changed without asking, and every consumer the orchestrator runs has agents woken by a prompt. The per-batch report stays FR20's main channel. Option B (Stop `additionalContext`) was rejected: it forces an extra model turn at most turn ends, since reruns take minutes. So the settings block has three entries.
- **The hook's memory (asked 08:02, answered 08:03).** One small file per session and consumer root in the per-user RT Test directory, written atomically, pruned once untouched for 7 days, holding only paths, a cursor and flags; P41 amended to allow it (6cf1940). The daemon cannot hold it, since it cannot hold "already said no daemon answers".
- **Split (asked 08:03, answered 08:04).** § Split.

#### Split

Drafted whole, the ticket measured about 20 raw files and 26 estimated, with 10 code units, past the 25 limit with no behavior a split would cut. The orchestrator split it at 08:04 by outcome: this ticket keeps the hook, with every owner ruling on it (the per-batch report, the turn-end and next-prompt line, at most five tests, saying once when no daemon answers, opt-in, failing open, the session memory); ticket 2.7b takes the `edited` field end to end, the hook's sending of it included, so an agent's own edits never hold a workspace or the discovery (tickets 2.3k and 2.3l), and builds after this ticket, since it changes the scheduler's hold logic, daemon state that gets its own review. Until 2.7b lands, a change the agent makes while a job runs is judged by timing, as a person's saves are (ticket 2.3k's known limit).

#### Decisions taken here

- **The command is `rt-test hook claude-code`.** A harness names its payload's shape, so another harness's hook can be added beside it; `changes --json` already serves any harness that runs a shell command.
- **Registered on `PostToolBatch`, not `PostToolUse`.** One run per batch reports once for parallel edits and never races on the session's memory (§ Measured facts). The sprint's "after each tool call" is met: every batch, a lone call included, fires it.
- **Edited files are shared by the session; cursors and told flags belong to each agent.** A subagent's report reaches only the subagent (§ Measured facts), so one shared cursor would let a subagent's report consume changes the main agent never hears. Each agent asks about every file the session edited, from its own cursor, so the main agent hears what its subagents' edits changed at its next batch, a first answer with no cursor included (AC3). Each memory file has a single writer (each agent's batches, the session's prompts, its turn ends), since a prompt's run can overlap a batch's: this very session's `UserPromptSubmit` context arrived mid-turn, beside tool results (07:58, 08:03 and 08:05 on 2026-09-30). Told-once is kept as times rather than flags, so no writer has to clear another's (review F1, F16).
- **It speaks on freshness changes too.** The sprint's scope says it "speaks after a tool call only when a test covering files the session edited changed state or freshness", and FR20 reports "each change ... in the state or freshness". A test that only went stale since the cursor is an `other` change, counted in the report.
- **The no-answer note is told once per loss, not once per session.** The sprint says "says so once per session and never falls silent"; a daemon that answers again and is then stopped would otherwise leave the agent unaware of the second loss, which is falling silent. The agent and the person each hear it once per loss.
- **A baseline for a lost cursor is not silent** when covering tests are failing or not current (AC3), since a daemon restart or an expired cursor would otherwise hide a failure from the agent until something changes again.
- **Exit 1 on no answer, never 2**, per C153 and § Measured facts.
- **`HOOK_BOUND_MS` is 2,000 ms, a target.** `PostToolBatch` holds the agent's next model request until the hook ends, so the bound is what an unresponsive daemon costs each batch; it sits well above the 100 ms target and below any default hook timeout. The README's block sets each entry's `timeout` to 10 s as Claude Code's own backstop.
- **A refused request leaves out vanished and outside paths and retries once.** Ticket 2.6 refuses a request whole for any path its resolution refuses (AC1 of 2.6: a path outside the root, a directory, and on Windows a missing name it cannot tell apart from another). A remembered file the hook checked lies under the root by real path can turn refusable only by vanishing (the Windows missing-name refusal), by a link on its way being retargeted outside the root, or by becoming a directory; the retry leaves out every path that no longer names an existing file or whose real path now lies outside the root's, which covers all three without parsing the refusal's text (review F14).
- **Scope of the analysis.** Analyzed: each event with and without edited files; parallel and lone calls; shell-only batches; determined, not-determined and baseline answers, the baseline for each cursor use; each way of getting no answer, a loss after an answer, and a refused path; a payload, arguments or memory the hook cannot read; a subagent's batches beside the main agent's; a prompt's run overlapping a batch's; a remembered path that vanished or whose link now leads outside the root. Not analyzed: the cost of a query naming 1,000 paths against the bound, which AC9's measurement does not cover and the trial reads.

- **Ticket review (create-ticket 6c, 08:10 to 08:18).** 18 findings; 17 applied, and F11 (the empty metadata block) was already filled when it arrived. F14 (a path that resolves outside the root) widened the retry to paths whose real path left the root; F15 made a first answer with no cursor speak like a lost cursor's baseline; F16's two questions were settled rather than recorded as assumptions: a spike at 08:16 showed a `UserPromptSubmit` hook may exit 1 with a JSON object, and this session's own mid-turn prompts showed a prompt's run can overlap a batch's, which the one-writer-per-file memory answers. F1 to F6 tightened the memory and the deadline; the rest added a cap, a truncation count (C32), the root's default, an export, rule ids and the code-unit count.

#### Known limits

- **A reader of only the agent's final message misses the turn-end line**, since a `systemMessage` shows in Claude Code's interface but never in the transcript's text, such as a lane's report to its orchestrator (orchestrator, 07:58). The agent gets the same line with its next prompt.
- **A file changed only by a shell call is not among the session's edited files**, so its covering tests are reported only when they also cover a file the session edited.
- **A misspelled command name in the settings exits 2 through `main`'s usage error**, which Claude Code reads as blocking; the README's block is to be copied as given.
- **A daemon restart loses 2.6's journal**, so changes across it are not listed; AC3's baseline line gives the counts instead.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.7` over this ticket's files (07:58 on 2026-09-30) named 2.3o, 2.4b, 2.5 and 2.6; 2.3o has since landed (7296b9c).

- **2.4b** (ready-for-dev, building in Tree 1): writes `query-client.ts`, `client.ts`, `cli/src/main.ts`, `answer-text.ts` (exporting `firstLine`). Lands before this ticket.
- **2.5** (ready-for-dev): reads `query-client.ts` and `client.ts`, and writes neither. Lands before this ticket.
- **2.6** (ready-for-dev): creates `queryChanges`, the changes answer and its constants that this ticket calls and reads; § Answer outline 2.7 reads is the contract. Lands just before this ticket, which is written against the tree as 2.6 leaves it; the first task re-reads it.
- **2.7b** (backlog, after this ticket): writes `commands/hook.ts` and `query-client.ts` again, to send the batch's edited files; this ticket leaves the batch's own files at hand in the `PostToolBatch` run for it.

#### Sizing

About 13 raw files and 17 estimated (13 times 1.3 is 16.9); code units 9 (8 criteria needing code, AC9 being a measurement, plus validation). Production: `query-client.ts`, `client.ts`, `daemon/endpoint.ts`, `query/changes-answer.ts` (only to export its failing states, added at 10:57 when 2.6's build left them private), `cli/src/main.ts`, and new `cli/src/commands/hook.ts`, `cli/src/hook-memory.ts` and `cli/src/hook-report.ts`. Tests, for create-tests: new `packages/cli/test/hook.test.ts` (the hook in process against stand-in and real daemons; P42, since no test file covers a hook), `packages/cli/test/cli.test.ts`, `packages/cli/test/defects.json`, `packages/daemon/test/runtime-directory.test.ts` (the exported user directory) and `packages/daemon/test/defects.json`. Over 10 estimated, so dev delegates: the daemon exports (`query-client.ts`, `endpoint.ts`, `changes-answer.ts`, `client.ts`), then the hook (`commands/hook.ts`, `hook-memory.ts`, `hook-report.ts`, `main.ts`).

#### Current structure of the modified files

As of main at 6cf1940, read at 07:49 to 08:02 on 2026-09-30, before 2.4b and 2.6 land; each is re-read at the first task.

- `packages/daemon/src/daemon/endpoint.ts` (270 lines): `endpointOf` places the key under `join(userInfo().homedir, ...WINDOWS_KEY_DIRECTORY)` (`AppData`, `Local`, `rt-test`) on Windows and in `join(SHARED_TEMPORARY_DIRECTORY, RUNTIME_DIRECTORY_PREFIX + uid)` (`/tmp/rt-test-<uid>`) on Linux; `identityHash`; `clientEndpoint` refuses a Linux runtime directory that is not the user's alone.
- `packages/daemon/src/daemon/runtime-directory.ts` (154 lines, read only): `runtimeDirectoryRefusal(directory, create)` makes a missing directory owner-only with `create`, and refuses a link, a non-directory, another user's, or one open to others.
- `packages/daemon/src/query-client.ts` (104 lines): the private `query(target, request, boundMs?)`; `PATH_STATUS_BOUND_MS` (60 s); 2.4b adds `queryWait`, and 2.6 `queryChanges(consumerRoot, paths, options: ChangesOptions = {})`, whose `ChangesOptions` holds only `since` and which takes `READ_FIRST_BOUND_MS` (60 s), the bound shared with the path status (as built at 50dc810).
- `packages/daemon/src/client.ts` (457 lines): the client's exports; 2.4b and 2.6 add theirs.
- `packages/cli/src/main.ts` (45 lines): `COMMANDS`; a thrown usage error returns `EXIT_USAGE` (2) with the usage on stderr.
- `packages/cli/src/command.ts` (62 lines, read only): `CliIo` (`stdin`, `stdout`, `stderr`, `cwd`), `Command` (`name`, `usage`, `parse`), `absolutePath`, `nonEmptyPath`, `UsageError`.
- `packages/cli/src/output.ts` (116 lines, read only): `oneLine`, the exit codes, `Output`, `reported`; the hook does not use `Output`, whose `--json` document is not a Claude Code object.

#### Existing tests this change breaks

- `packages/cli/test/cli.test.ts`: a test comparing the whole usage listing printed on an unknown or missing command gains the hook's line.
- Found by `rg -n "Unknown command|Missing command|usage" packages/cli/test` when dev starts, and by `bun run typecheck` across the repository (P14).

#### Doc text

Dev reports this text with the build; the orchestrator writes it (C7).

- `README.md`, a section `## Agent hook` after § Query: "`rt-test hook claude-code` tells a Claude Code agent, after each batch of its tool calls, which tests covering the files it edited changed state or freshness since its last report, failures first, naming up to five with each failure's first line. At the end of a turn it shows you one line while those tests are failing or not current, and gives the agent the same line with your next prompt. It says once when no daemon answers, starts nothing, and never blocks Claude Code. It is opt-in: add this block to `.claude/settings.json` or `.claude/settings.local.json`, with `node <path to RT Test>/packages/cli/dist/bin.js` in place of `rt-test` until the CLI is published:" followed by the settings block with `PostToolBatch`, `Stop` and `UserPromptSubmit` entries, each `{ "type": "command", "command": "rt-test hook claude-code --root \"$CLAUDE_PROJECT_DIR\"", "timeout": 10 }`, as dev built and tested it.
- `README.md` line 12 gains "and an opt-in Claude Code hook tells the agent what its edits changed".
- `docs/architecture.md`, the query paragraph: "`rt-test hook claude-code` is an opt-in Claude Code hook. After each batch of tool calls it asks `changes` about the files the session's `Write`, `Edit` and `NotebookEdit` calls edited, from the cursor its last answer returned, and adds a report only when a covering test changed; at turn end it shows the person one line, and adds it to the agent's next prompt, while covering tests are failing or not current. It keeps each session's memory in the user's own RT Test directory."
- `docs/architecture.md`'s known limits: the first two of § Known limits.

#### Previous ticket

2.6 (built at 50dc810 on `wt/1`, before review, at 10:56 on 2026-09-30): the changes query; § The contract, from ticket 2.6 gives its answer as built, and its known limits (a restart loses the journal; more than `MAX_CHANGES_PATHS` paths are refused, which the hook caps; a persistently undetermined daemon lists nothing) bound what the hook can report. Recent commits (`git log --oneline -20`) are docs, 2.4d's review and 2.3o's merge; none touches this ticket's files beyond what § Current structure lists.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.7, § Ticket 2.7b, § Ticket 2.6.
- Ticket 2.6 (`_agent-docs/tickets/2-6-changes-query.md`), § Answer outline 2.7 reads.
- Claude Code hooks reference, https://code.claude.com/docs/en/hooks, read at 07:51 and 07:52 on 2026-09-30, against the installed 2.1.285.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (07:58 on 2026-09-30).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C5,C7,C8,C10,C13,C14,C22,C23,C24,C26,C30,C32,C38,C40,C46,C48,C55,C59,C133,C146,C147,C151,C152,C153,C166,C170,C172 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P11,P13,P14,P16,P17,P18,P19,P21,P31,P32,P33,P41,P42 -->

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
  - packages/daemon/src/query-client.ts
  - packages/daemon/src/client.ts
  - packages/daemon/src/daemon/endpoint.ts
  - packages/daemon/src/query/changes-answer.ts
  - packages/cli/src/main.ts
files_to_create:
  - packages/cli/src/commands/hook.ts
  - packages/cli/src/hook-memory.ts
  - packages/cli/src/hook-report.ts
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

- _agent-docs/tickets/2-7-agent-hook.md (created by create-ticket, 08:07 on 2026-09-30)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.7's scope line, its sibling line and ticket link, and the new § Ticket 2.7b with the split's reasoning, 08:08 and 08:18, under the orchestrator's 08:04 grant)
- _agent-docs/sprint-status.yaml (`2-7b-agent-edits-never-hold: backlog` added, 08:08, under the 08:04 grant)
- _agent-docs/project-context.md (P41 amended by the orchestrator as 6cf1940, 08:03, for this ticket's session memory)

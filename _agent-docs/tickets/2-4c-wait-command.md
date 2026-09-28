# Ticket 2.4c: The wait command

## Ticket

As a coding agent working in a shell,
I want `rt-test wait <files>` to block until the tests covering my files have an answer, and to print that answer as text or as one JSON document,
so that I never run tests myself, and I read whether my files' tests pass, are superseded, or are still running from one command whose exit code only says whether RT Test answered.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: `rt-test wait <file>... [--root <dir>] [--limit <seconds>] [--json]` sends ticket 2.4b's wait for every named file, each resolved against the current directory, to the daemon serving the root (the current directory by default, never a parent), with the limit when `--limit` is given and the daemon's default otherwise. It starts no daemon, discovery or run.
- [ ] AC2: A missing file argument, an empty path, an empty `--root`, an unknown option, and a `--limit` that is not a whole number of seconds written in decimal digits from 1 to the wait's maximum (`MAX_WAIT_LIMIT_MS` in seconds) are usage errors: exit 2, the usage on stderr, and nothing on stdout.
- [ ] AC3: Every answer the daemon gives, settled, superseded or unsettled, exits 0, whatever the covering tests' states; the command exits 1, with the reason on stderr and, under `--json`, a document with `ok` false and that reason, only when it gets no answer: no daemon serves the root, the daemon predates the wait or is stopping, the connection closes before an answer, the wait is refused (naming each refused path and why, or that more files were named than the wait allows), or no answer arrives within the client's bound. No exit code and no line calls the files' tests passing or failing.
- [ ] AC4: With `--json`, stdout carries exactly one document: `schemaVersion`, `command` (`wait`), `ok`, and the wait answer's fields as 2.4b gives them, its outcome among them; everything else goes to stderr.
- [ ] AC5: Without `--json`, stdout's first line names the outcome and the revisions: settled at a revision, superseded by a newer revision (naming it), or unsettled when the limit passed; then, per named file, its covering workspaces or why none covers it; the counts by state and by freshness of the covering tests; each named failure with its module, test name and first error line, and how many more there are; each covering workspace's execution state and, when its results are not current, why; for a superseded answer, the changed paths it lists and how many more; and the answer's context lines as `summary` and `status` print them. Every value read from the consumer's tree is printed on one line with unprintable characters escaped.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It parses arguments with `node:util` `parseArgs` as the other commands do.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read the landed code of ticket 2.4b (`queryWait`, `WaitAnswer`, its outcome constants, `MAX_WAIT_LIMIT_MS` in `daemon/protocol.ts`, and what `@rt-test/daemon/client` exports) and ticket 2.3i (`contextLines`' schedule lines in `answer-text.ts`), and confirm the names this ticket uses.
- [ ] (AC1, AC2) Create `packages/cli/src/commands/wait.ts`, a `Command` named `wait` beside `status.ts`: parse with `parseArgs` in strict mode, `JSON_OPTION`, `--root` and `--limit`; take every positional as a file, requiring at least one and refusing an empty one through `nonEmptyPath`, and refuse an empty `--root` the same way; resolve each and the root with `absolutePath`. More than `MAX_WAIT_PATHS` files is left to the daemon's refusal (2.4b AC7), one source for the bound, so it exits 1 (AC3). Parse `--limit` against a decimal-digit pattern before converting it (C155), and refuse a value below 1 or past `MAX_WAIT_LIMIT_MS` in seconds, taken from the daemon's constant rather than a second one (C14, C23). Register the command in `packages/cli/src/main.ts`'s `COMMANDS`, whose usage lines every usage error prints.
- [ ] (AC1, AC3, AC4) In the command's run, call `queryWait(root, files, { limitMs })` inside `reported`, with `limitMs` the `--limit` seconds converted to milliseconds through a named constant (C3) when `--limit` is given and left out otherwise, so the daemon's default applies, answer `output.succeed(answerFields(answer), waitText(answer))` for every answer, and `output.fail(errorText(error), { consumerRoot, requestedPaths })` for every rejection, as `status.ts` does (C152, C153).
- [ ] (AC5) Write `waitText` in `wait.ts`, and add to `packages/cli/src/answer-text.ts` only the lines `wait` shares with `status` or `summary`, and keep lines only `wait` prints in `wait.ts` (C59), widening its `Answer` union to take the wait answer so `contextLines` serves it unchanged (C14). Route every consumer-derived value through `oneLine` (each file, workspace, module, test name, changed path, refused path and failure's first error line), and take a multi-line value's first line with `firstLine` before `oneLine`; name each heading and phrase as a constant (C3). No heading or line states a verdict on the files' tests as a set: the first line names only settled, superseded or unsettled, and failures appear only as counts and named failures (C133). The covering workspaces' execution states come from the wait answer (2.4b AC6, which gives each one's reason when it is not current), and `contextLines` prints every workspace's schedule (2.3i) from the same answer, composed at one moment, so the two cannot disagree; both are printed, rather than giving `contextLines` a mode (P19).
- [ ] (Support) Send the orchestrator the doc text in § Doc text, with the build (C7), plus each hit of `rg -n "four commands|wait <files>|rt-test wait" README.md docs` that still lists four commands or describes the wait command as planned (C48).
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files and `bun run typecheck` across the repository (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `Command`, `JSON_OPTION`, `absolutePath`, `nonEmptyPath`, `UsageError` (`cli/src/command.ts`) and `reported`, `Output`, `oneLine`, `EXIT_*` (`cli/src/output.ts`): how every command parses, reports and exits.
- `statusCommand` (`cli/src/commands/status.ts`): the command this one is shaped like, with `--root` and a required path.
- `answerFields`, `contextLines`, `countLines`, `notDiscoveredLines`, `INDENT`, `joinLines`, `firstLine` (`cli/src/answer-text.ts`): the answer's JSON fields and its shared text.
- `queryWait`, `WaitAnswer` and its outcome constants, `MAX_WAIT_LIMIT_MS` (ticket 2.4b, through `@rt-test/daemon/client`).
- `errorText` (`@rt-test/daemon/client`).

### Must Create

- `commands/wait.ts`: the command and `waitText` (AC1 to AC5).
- The shared text lines for coverage and named failures in `answer-text.ts` (AC5).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The last of the tickets the original 2.4 (wait for files) became (orchestrator, 2026-09-28 12:18 and 13:26). 2.4 lets the daemon answer late, 2.4d reads the paths a query names and resolves a caller's paths, 2.4b is the wait and `queryWait`, and this ticket is the command. Build order: 2.4, 2.4d, 2.4b, 2.4c. It completes FR9 with 2.4b.

Requirement this ticket delivers with 2.4b (`docs/requirements.md`):

- "FR9: Answer `wait <files>` once every test covering those files has a current result or an explicit non-current state, as superseded when a covering input changes after the call, or as unsettled, naming each covering workspace's execution state, when its time limit passes first."

Rule clauses the criteria rest on:

- `docs/architecture.md`, the query paragraph: "`rt-test summary` and `rt-test status` print the counts, never a pass or fail for a set." and "None of the four commands loads a Vitest module, consumer config or test file, and each gives one versioned JSON document on stdout under `--json`." (AC3, AC4)
- `project-context.md` P32: "The CLI and programmatic API query results or wait for a revision scoped to given files, and never spawn Vitest." (AC1)
- `project-context.md` P33: "Expose the product as a CLI with `--json` output in front of the daemon, plus a small programmatic API." (AC4)
- `README.md` § Query: "Exit codes: 0 when the query answered, whatever the tests' states; 1 when it could not ... and 2 on a usage error." (AC2, AC3)

Glossary (`docs/glossary.md`), verbatim:

- **Wait**: "A query that returns once every test covering the given files has a current result or an explicit non-current state, or earlier as superseded or unsettled."
- **Superseded**: "A wait's answer when a covering input changed after the call, naming the newer input revision to wait on."
- **Unsettled**: "A wait's answer when its time limit passed before every covering test had a current result or an explicit non-current state, naming what each covering workspace is still doing."

#### Orchestrator rulings

- Q7 (asked 12:18, answered 12:18; decider the orchestrator; AC3): exit 0 for every answer, and 1 only for no answer. Reason: summary and status never give a pass or fail for a set (architecture), and an exit code is one; agents read the outcome from the JSON.
- Q5 (the owner, 12:18, recorded 13:18; AC1): the wait's default limit is about 100 s, under the 2 minutes after which an agent's shell tool kills a call; a caller may pass a longer one. The daemon holds the default (2.4b), so the command passes a limit only when `--limit` is given.
- W2 (13:35; AC2): a limit runs from 1 ms to 1 hour at the daemon; the command takes whole seconds, so from 1 s to `MAX_WAIT_LIMIT_MS` in seconds.
- C1 (grill, asked 13:42, answered 13:42; AC1, AC2): `--limit <seconds>`, whole seconds from 1 to 3,600, parsed by digit pattern; with no flag the daemon's default applies.
- C2 (grill, 13:42; AC5): nothing is written while the command waits.
- Ticket review (create-ticket 6c, 13:42 to 13:44): 13 findings, 12 applied. F1 refuses an empty `--root` and a `--limit` of 0; F2 converts seconds to ms and omits the limit without the flag; F3 bars a verdict line (C133); F4 adds a connection closed mid-wait to the no-answer cases; F7 keeps wait-only lines in `wait.ts`; F8 escapes each first error line; F9 widens the broken-test search; F10's sweep added README line 12 to the doc text; F11 and F12 narrowed two design notes. Two questions were settled by create-ticket: F5, more files than `MAX_WAIT_PATHS`, is the daemon's refusal (one source for the bound), so exit 1; F6, covering workspaces' states printed beside `contextLines`' schedule, prints both, since one answer composes both at one moment and 2.4b AC6 gives each one's reason. F13 was rejected: 2.3f is unbuilt, and the 13:41 scan named it. The orchestrator agreed F5 and F6 at 13:45.
- Refuse whole (13:26; AC3): a wait naming any refused path is refused whole, naming each; the command reports that refusal as exit 1.

#### Decisions taken here

- **`--limit` in seconds.** A person or an agent sets a wait's limit in seconds, as a shell tool's own timeout is set; milliseconds would invite a limit a thousand times shorter than meant. The daemon's range is in ms, so the command's maximum is derived from `MAX_WAIT_LIMIT_MS` rather than restated (C23).
- **No progress line while waiting.** The command writes nothing until the answer, so a caller reading stderr sees either the reason for no answer or nothing; the answer names each covering workspace's execution state when it returns. Not analyzed beyond this: a person at a terminal sees nothing until the answer; the 100 s default bounds that, and a longer `--limit` is the caller's choice.

#### Design notes

- **Why the exit code does not follow the outcome.** An agent that reads only the exit code must still read the answer to know which tests failed, and a non-zero exit for "superseded" or "unsettled" would read like an RT Test failure to a shell tool; the outcome is a top-level field of the answer and the text's first line (Q7).
- **Scope of the analysis.** Analyzed: every answer outcome, each way of getting no answer, each usage error, and the `--json` document's shape. Not analyzed: the wait's own behavior (2.4b), and the text's exact layout, which dev sets within AC5.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.4c` over `main.ts`, `commands/wait.ts`, `answer-text.ts` and `command.ts` (13:41) named 2.3f, 2.3g and 2.3i, each for `answer-text.ts`: 2.3g adds a warning line for its input fact, 2.3i the schedule and selection lines, and 2.3f names it only among files it reads. All build before this ticket. 2.4b (ready-for-dev) builds before it and gives `queryWait`, the answer and its constants.

#### Sizing

About 5 raw files and 7 estimated; code units 6 (5 criteria plus validation). Production: `cli/src/commands/wait.ts` (new), `cli/src/main.ts`, `cli/src/answer-text.ts`. Tests, for create-tests: `packages/cli/test/cli.test.ts` (the command against a real daemon, and each usage error) and `packages/cli/test/defects.json`. Under 10 estimated, so dev builds it alone.

#### Current structure of the modified files

As of wt/1 at 2da450d, before 2.3g to 2.4b land.

- `packages/cli/src/main.ts` (45 lines): `COMMANDS` lists start, stop, summary and status; `main` finds the command, parses, and prints every command's usage on an unknown or missing command.
- `packages/cli/src/answer-text.ts` (146 lines): `Answer = SummaryResponse | PathStatusResponse`; `answerFields`, `countLines`, `contextLines`, `inputLines`, `notDiscoveredLines`, `joinLines`, `firstLine`.
- `packages/cli/src/commands/status.ts` (94 lines, not modified): the shape `wait.ts` follows.

#### Existing tests this change breaks

- `packages/cli/test/cli.test.ts`: a test comparing the whole usage listing printed on an unknown or missing command gains the wait line; its `usageOutcome` checks each expected line is included, so only a test asserting the exact listing breaks.
- Found by `rg -n "Unknown command|Missing command|usage" packages/cli/test/cli.test.ts` (13:41); dev reruns `rg -n "Unknown command|Missing command|usage|answerFields|contextLines|Answer\b" packages` before the first edit and lists every further test hit; the typecheck reports any shape `answer-text.ts`' widened union breaks (P14).

#### Doc text

Dev reports this text with the build; the orchestrator writes it (C7).

- `README.md` § Query, the usage block gains `rt-test wait <file>... [--root <dir>] [--limit <seconds>] [--json]`, and after the paragraph on `rt-test status <path>`: "`rt-test wait <file>...` returns once the tests covering the files have current results or can get none, or earlier as superseded when an input they read changes, naming the newer revision, or as unsettled when its limit passes, 100 s unless `--limit` sets another, up to an hour. Each file resolves against the current directory. Its answer gives each file's covering workspaces, the covering tests' counts, up to 20 failures with their first error line, and what each covering workspace is doing. It exits 0 for every answer; read the outcome from its first line, or `outcome` under `--json`."
- `docs/architecture.md`, the query paragraph: "`rt-test summary` and `rt-test status` print the counts" gains `rt-test wait`, and "None of the four commands" becomes "None of the five commands".
- `README.md` line 12's "and `wait <files>` returns once the results covering your files are current" becomes "and `wait <files>` returns once the results covering your files are current or can get none, or sooner as superseded or unsettled".
- Swept by `rg -n "four commands|wait <files>|rt-test wait" README.md docs` (13:44): besides the lines above, `docs/roadmap.md` line 19 (the sprint's plan, still true), `docs/requirements.md` FR9 and `docs/architecture.md` § Query surface (both already describe the wait) need no edit.

#### Previous ticket

2.4b (ready-for-dev, authored in this lane at 13:34 to 13:40): the wait and `queryWait`, its outcomes settled, superseded and unsettled, its 100 s default limit and 1 hour maximum, `MAX_WAIT_PATHS`, the named failures, and a refused wait's reasons in `queryWait`'s rejection.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.4c, § Ticket 2.4b.
- Tickets 2.4b (`_agent-docs/tickets/2-4b-wait-for-files.md`) and 1.4 (`_agent-docs/tickets/1-4-query-cli.md`), which built `summary` and `status`.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (12:14).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C7,C14,C23,C38,C46,C48,C55,C59,C130,C133,C151,C152,C153,C155 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P19,P21,P32,P33,P34 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area:
  - packages/cli
is_consolidation: false
sizing_ac_count: 6
files_to_modify:
  - packages/cli/src/main.ts
  - packages/cli/src/answer-text.ts
files_to_create:
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

- _agent-docs/tickets/2-4c-wait-command.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.4c written at 12:21 with Q7 and linked at 13:42, under the orchestrator's 12:18 grant)
- _agent-docs/sprint-status.yaml (2-4c-wait-command added at 12:21, set ready-for-dev)

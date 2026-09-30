# Ticket 3.1: Defect definitions and gaps

## Ticket

As an author, or the coding agent writing tests for one,
I want the daemon to read the defect definitions my repository commits, check each one against the latest discovery and the code as it is now, and answer `rt-test defects` with each definition's state, the counts and the tests no definition names,
so that I see which definitions cannot run and why, and which tests still have no defect, without starting a test, before any falsification runs.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

Every criterion holds on Windows and on Linux. "Now" means when the daemon answers the query.

- [ ] AC1: The definition files are the regular files under the consumer root that a root-relative pattern in `rt-test.json`'s `defects` member matches, in the pattern grammar `nonInputs` uses. With no `rt-test.json`, or one with no `defects` member, there are no definitions and no problem. A `defects` member that is not an array of usable patterns, an `rt-test.json` that cannot be read or parsed, a pattern whose walk passes its depth bound or meets a directory link below which it could match, and each matched entry that is not a regular file, cannot be read, is not JSON, or holds no `defects` array, each count as one invalid entry in the total, with a reason that names the problem and never quotes the file's text, and add no definitions; a file two patterns match is one file; the other files' definitions are still read. Reading them starts no job and loads no consumer module. (FR12, FR24)
- [ ] AC2: A definition is invalid, with a reason that names the problem and never quotes its `old` or `new` text, when it lacks a field the definition format requires or holds one of the wrong kind (the format is in Dev Notes, Q2), its `old` is empty, its `old` equals its `new`, its mutation's file lies outside the consumer root (by its spelling or by its real path), or its `id` repeats: every definition carrying a repeated `id` is invalid, each naming the other definitions' files. A definition missing a usable `id` is named by its file and its position in that file. (FR24)
- [ ] AC3: A definition's test resolves to the one test in the latest stored discovery whose module lies at the definition's root-relative module path (its separators normalized to `/` and resolved against the root, so `src\a.test.ts` and `./src/a.test.ts` name `src/a.test.ts`) and whose name path equals the definition's name path (each enclosing suite's name, then the test's, an `it.each` arm by its reported title), narrowed by its project and its occurrence when the definition gives them. No such test makes the definition invalid as not discovered, the reason saying whether the discovery lists that module at all and whether that discovery is current; more than one makes it invalid as ambiguous, the reason naming how many tests match and the field that would tell them apart, or that no field of the format does (two Vitest workspaces collecting the same module under one project name). A definition whose `test` is well-formed resolves whatever its other AC2 problems, so the test it names is never a gap (AC5). (FR12, FR24)
- [ ] AC4: A definition not invalid under AC2 or AC3 reads anchor missing when its `old` does not occur exactly once in its mutation's file as that file is now, counted as falsification counts it (a newline in `old` matching an LF or a CRLF in the file, occurrences never overlapping), the reason giving the count, or that the file cannot be read and why; otherwise it reads never verified. No definition reads verified, since this ticket stores no evidence. (FR13)
- [ ] AC5: Every test in the latest stored discovery that no definition's test resolves to is a gap, whatever that definition's other state. (FR14)
- [ ] AC6: The daemon answers a `defects` query, for the whole worktree or for a file or folder inside the consumer root, with each definition in scope (its id, its definition file, its test as written and, once resolved, its test identity, marked duplicate when the discovery marks it so, its mutation's file, its state and, when invalid or anchor missing, its reason), each invalid entry AC1 counts, the count of each state and the total, and the gaps in scope, with the count of tests in scope and a gap count for every test module holding a gap. It lists gap tests by module up to a named bound and says how many it did not list. It carries the facts every answer carries, starts no job and no test, and refuses or cannot answer in the cases a summary or path status does, with the reason. A definition is in scope when its test's module path lies at or under the path, and a test when its module does; an invalid entry of AC1, and a definition naming no usable module path, lie in every scope. (FR22)
- [ ] AC7: `rt-test defects [path] [--root <dir>] [--json]` prints the answer's counts, each invalid entry AC1 counts and each definition that is invalid or anchor missing, with its reason, and the gap counts, never a single pass or fail; under `--json` it gives one versioned JSON document on stdout. It loads no Vitest module, consumer config or test file, and a daemon that predates the query is named as needing a restart. (FR22)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question) | Why it matters if wrong | How to check |
| --- | -------------------------- | ----------------------- | ------------ |

None: the ticket calls no third-party behavior this repository has not already exercised. Every behavior it rests on is RT Test's own code, cited in Dev Notes.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (AC1) Create the definition file reader under `packages/daemon/src/defects/`: read `rt-test.json`'s `defects` member, check each pattern with the grammar `nonInputs` uses (export `patternProblem` and `matchesPath` from `inputs/non-inputs.ts` rather than copying them), walk from each pattern's literal directory prefix without following a directory link (a prefix missing by `ENOENT` or `ENOTDIR` matches nothing, C172), skipping `SKIPPED_DIRECTORIES`, the state directory and, when the root lies in a git repository, every path git reports as ignored (as the source scan skips them), under a named depth bound (C28), reporting each directory link it would otherwise have entered where the pattern could match below it, and read each matched regular file once, however many patterns match it, with `readJson`, naming a parse failure by its position and never by the parser's message, which quotes the file's text (C147), checking `rt-test.json` and each matched entry with `presence`'s regular-file rule. Return the definitions found with their file and position, and each file-level problem with its reason: an unusable member or `rt-test.json`, a pattern whose walk passed the depth bound, a directory link the walk declined, and a matched entry that is not a regular file, cannot be read, is not JSON or holds no `defects` array.
- [ ] (AC2) Validate each definition into a typed one: required fields and kinds, a non-empty `old` unequal to `new`, the mutation's file inside the root by its spelling and, when it exists, by its real path (`realPath`, `liesInside`; `ENOENT` and `ENOTDIR` both read as not existing, C172), and repeated ids across every file, each repeat's reason naming the other definitions' files; no reason quotes `old` or `new`.
- [ ] (AC3, AC4) Resolve the test of every definition whose `test` member is well-formed, whatever else AC2 finds, so a repeated id or a bad mutation still leaves its test covered (AC5): match it against the latest stored discovery's tests by root-relative module file (`testModuleFile`), name path, and the project and occurrence it gives. For each definition that passed AC2 and resolved, read its mutation's file now and count `old` with `countAnchor` from 3.2's `packages/daemon/src/falsify/anchor-match.ts`, imported and never copied or re-implemented (orchestrator ruling Q7, C8). Give each definition one state, invalid first, then anchor missing, then never verified, with AC3's and AC4's reasons: not discovered saying whether the discovery lists the module and whether that discovery is current; ambiguous naming how many tests match and the field that tells them apart, or that no field of the format does; anchor missing giving the count, or the read failure. Keep the resolved test identity and the mutation's absolute file on the result, for 3.5 to build a falsification job's experiments from.
- [ ] (AC5, AC6) Create `query/defects-answer.ts`: build the answer over `queryBasis`, scope definitions and tests by the path resolved with `resolveCallerPath`, carry each AC1 invalid entry and each resolved test's duplicate mark, compute the gaps, the count of tests in scope, each state's count and the total, and the per-module gap counts, list gap tests by module up to a named bound with the number not listed, and cut each reason with `cutReason`.
- [ ] (AC6) Add the `defects` request and response to `daemon/protocol.ts`, its handler to `DaemonHandlers` and its route and optional-path check to `daemon/server.ts` (the field checks beside 2.7b's in `daemon/request-fields.ts`), with a too-large answer asking for a narrower path; answer it in `daemon/lifecycle.ts` from the latest results and the view as `summary` does, as a delegation to `query/defects-answer.ts` holding no reading or scoping of its own, since `lifecycle.ts` is already 566 lines (P16).
- [ ] (AC7) Add `queryDefects` to `query-client.ts`, export it and the response types from `client.ts`, and create `packages/cli/src/commands/defects.ts`, registered in `main.ts`, reusing `answerFields`, `contextLines` and the `reported` output as `status` does; add the response to `answer-text.ts`'s `Answer` union.
- [ ] (Support) Report to the orchestrator the `docs/architecture.md` text for the defects query and command (under `Queries and the agent hook`, and the query clients section), and for the definition files under `Execution and falsification isolation`; write none of it yourself.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `readJson`, `objectField`, `realPath`, `liesInside`, `relativePosixPath`, `POSIX_SEPARATOR` (`packages/daemon/src/vitest/find-workspaces.ts`): reading a JSON file with its BOM, and root containment by real path.
- `isRecord`, `isStringArray` (`packages/daemon/src/json-guards.ts`): the kind checks.
- `NON_INPUTS_FILE`, `testModuleFile`, and the private `patternProblem`, `matchesPath` and `presence` (`packages/daemon/src/inputs/non-inputs.ts`): the settings file's name, a test's root-relative module file, the pattern grammar and matcher `nonInputs` uses, and the regular-file check that refuses a link. Export the private ones rather than writing a second grammar (C5, C13).
- `SKIPPED_DIRECTORIES`, `MAX_WALK_DEPTH` (`packages/daemon/src/selection/source-walk.ts`): the directories no walk enters, and a walk depth bound.
- `readIgnoredPaths`, `readCheckedIgnored` (async) and `ignoredPathsReader` (`packages/daemon/src/selection/git-ignored.ts`): git's ignored paths, as the input filter and the source scan read them, so the walk skips what they skip and a link under `node_modules` or an ignored directory is never an invalid entry (orchestrator ruling R1).
- `queryBasis`, `cutReason`, `DaemonView` (`packages/daemon/src/query/summary.ts`): the latest discovery, each test's standing and the answer context every answer carries, and reason cutting.
- `resolveCallerPath` (`packages/daemon/src/query/caller-paths.ts`): a caller's path, resolved inside the root as path status resolves it.
- `testIdentityKey`, `TestIdentity` (`packages/core/src/test-identity.ts`): a resolved test's identity and its key.
- `namedPaths`' neighbours in `packages/daemon/src/daemon/request-fields.ts` (from 2.7b): `error` and `valueShape` for the request's refusals.
- `countAnchor(text, anchor): number` (`packages/daemon/src/falsify/anchor-match.ts`, created by 3.2, importing nothing): counts `anchor` in `text` without overlap, as `split` counts, a line break in the anchor matching LF or CRLF, and an empty anchor counting 0. The same module exports `locateAnchor` (exactly one match, or the count) and `replaceAnchor`, which 3.2's transform applies; AC4 needs only the count. 3.1 changes nothing in this module. Names as the orchestrator relayed them from 3.2's dev at 18:20; confirm them in the file once 3.2 lands.
- `answerFields`, `contextLines`, `countLines`' pattern, `joinLines`, `INDENT`, `firstLine` (`packages/cli/src/answer-text.ts`) and `reported`, `oneLine` (`packages/cli/src/output.ts`): the command's text and JSON output.

### Must Create

- The definition file reader, the definition validator and the resolver, under `packages/daemon/src/defects/`.
- `packages/daemon/src/query/defects-answer.ts`: the answer, its counts, scope and gaps.
- `packages/cli/src/commands/defects.ts`: the command.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### What the criteria rest on

ADR-0009: "`rt-test.json` at the consumer root lists, in a `defects` member, root-relative glob patterns naming the definition files. There is no default: with no member there are no definitions, and every test is a gap. Each file holds JSON with a `defects` array. Each definition has an `id`, unique across every file; the `defect`, the wrong behavior in plain language; the `required` behavior it breaks, in plain language or as a requirement reference; the `test`, as its module's root-relative path, its name path (each enclosing suite's name, then the test's, with an `it.each` arm named by its reported title), and, only where the module alone cannot tell, its Vitest project and its occurrence among tests sharing that name path; and the `mutation`, as a root-relative `file` with the exact `old` text and its `new` replacement. Definition files stay ordinary inputs, since a test may read one."

ADR-0009: "A definition is invalid, and says why, when its file cannot be read or parsed, its id repeats, its test is not discovered or its name matches more than one test, its mutation changes nothing, or its file lies outside the consumer root. Its anchor is missing when `old` does not match exactly once in the file as it is now. An invalid definition and a missing anchor each count in the denominator and withhold verified, and every other defect still runs."

FR12: "Read defect definitions committed at a configurable location in the consumer repository, attribute evidence by stable test identity including each `it.each` arm, and keep evidence in the local state directory." This ticket reads and resolves; 3.4 attributes and stores evidence.

FR13: "Report a defect whose mutation anchor is missing as anchor missing, count it in the denominator, and withhold verified while the other defects still run."

FR14: "Report every test with no defect as a gap."

FR22: "Answer a `defects` query through the CLI with versioned `--json` output, giving each defect definition's evidence state, its freshness and reason, the verified, eligible and total counts, and the gaps, without starting a test." This ticket answers the definition states and the total; 3.4 adds evidence, its freshness, and the verified and eligible counts (sprint file § Ticket 3.4).

FR24: "Report a defect definition that cannot be applied as written as invalid, naming why (an unreadable file, a repeated id, a test not discovered or named ambiguously, a mutation that changes nothing, a file outside the consumer root), count it in the denominator, and withhold verified."

C139 (checklist) is why AC5 reports gaps and AC1 counts an unreadable file: verified requires every defect in the denominator detected, and tests with no defect are reported as a gap rather than left out.

C147 (checklist) is why no reason quotes `old` or `new`: summaries never contain source text.

#### Glossary terms, verbatim

- **Defect definition**: The committed record of a named defect: its id, the behavior, the test identity, and the mutation.
- **Anchor missing**: The state of a defect whose mutation no longer matches the code it names.
- **Invalid definition**: A defect definition RT Test cannot apply as written, such as one naming no discovered test, or a test it shares a name with.
- **Eligible defect**: A defect whose definition is valid, whose anchor matches, and whose test holds a current pass, so it can be falsified now.
- **Gap**: A test with no defect, or code no named defect reaches.
- **Verified**: Every defect definition in scope has current evidence that its test detects it.
- **Test identity**: The stable name RT Test gives one test: its Vitest workspace, Vitest project, module path, suite and test names, and its position among tests sharing those names.

#### Design decisions (scope of analysis: reading, validating and resolving definitions, and answering; evidence, scheduling and falsification are unanalyzed here)

- **Definitions are read when the query is answered**, from disk, so the answer describes the definition files and mutation files as they are now. Nothing is cached across queries in this ticket; 3.5 decides what scheduling keeps.
- **The definition files are found by a walk, never from the tracker's inputs.** The tracker drops a declared non-input, and a consumer may reasonably declare its definition files non-inputs so an edit to one reruns nothing; a lookup in the tracker would then find no definitions.
- **Only definition-time states are this ticket's.** 3.2 takes each mutation's file as an absolute path, re-checks the anchor when its job starts, and decides "no probe site" itself. This ticket's resolved definition carries what 3.5 hands 3.2: the defect id, the resolved test identity, the mutation's absolute file, `old` and `new`.
- **Tests resolve against the latest stored discovery.** A test added since that discovery reads not discovered until the next one is stored; the reason and the answer's discovery facts both say when the discovery is not current, so the invalid state is never presented as settled.
- **Invalid wins over anchor missing.** A definition with both problems reads invalid; its anchor is not read.
- **A test named by its occurrence is a duplicate.** ADR-0009 lets a definition name one of several same-named tests by its occurrence, and the discovery marks each such test duplicate (C125). The answer carries that mark; keeping a positional identity from inheriting another test's detection is 3.4's and 3.7's.
- **The walk follows no directory link and reads only regular files**, as `rt-test.json` itself is read (`presence` in `inputs/non-inputs.ts`). The walk first skips what the repository's other walks skip (`node_modules`, `.git`, git-ignored paths); a directory link it would otherwise have entered, where its pattern could match below it, is an invalid entry naming the link, so a definition file reached only through one withholds verified rather than silently leaving the denominator (orchestrator ruling R1, C139); the author narrows the pattern or moves the file. A matched link or other non-regular entry is reported, not skipped silently.
- **One state per definition, beside no second field.** `docs/architecture.md` § State dimensions defines one "Defect evidence" dimension whose values are "Detected, survived, invalid experiment, unclear, anchor missing, invalid definition, never verified", and "Evidence freshness" as its own dimension (C119). This ticket gives the three it can know; 3.4 adds the rest and the freshness field without reshaping the state (orchestrator ruling R2).
- **The per-query walk is unmeasured.** A `**` pattern walks the whole root on every `defects` query. `docs/plan.md` gives an end-to-end CLI call a p95 target below 100 ms, a target and not a measurement; this ticket holds the walk to that target only as a target, and 3.5 decides what scheduling caches (review F15).
- **The answer carries no `defect` or `required` text and no `old` or `new` text.** The author reads those in the definition file; the answer names the file.
- **The reader runs on the daemon's event loop.** Prefer asynchronous reads for the walk and the files, so a large tree does not hold other connections' answers; the path status query's `readNamed` is the precedent for a query that reads before it answers.

#### Questions to the orchestrator

Asked 2026-09-30 18:17; decided by the orchestrator at 18:18.

- Q1, bounding the gaps: accepted, both. An optional path scopes the answer, and gap tests are listed grouped by module up to a cap of 1,000 (a target), with a gap count for every module holding one and the number not listed. Fleet Cooling has about 10,000 tests and no definitions, so one identity per gap (about 1.1 MB) would pass the protocol's 1 MiB line limit and fail the whole-root answer at the M2 trial.
- Q2, the definition format: accepted. Each definition is `{ "id", "defect", "required", "test": { "module", "name": [...suite names, test name], "project"?, "occurrence"? }, "mutation": { "file", "old", "new" } }`; `occurrence` is 0-based, as every answer prints a test identity, so an author copies it from an answer; unknown members are ignored; `old` must be non-empty.
- Q3, definitions that cannot be listed: accepted. An unusable `defects` member, an `rt-test.json` that cannot be read or parsed, and each matched definition file that cannot be read, is not JSON or holds no `defects` array, count as one invalid entry each, so verified stays withheld.
- Q4, a repeated id: accepted. Every definition carrying it is invalid, since evidence is keyed by id.
- Q5, the mutation's file: accepted. A missing or unreadable one reads anchor missing with the read failure, since ADR-0009's "its file cannot be read" is the definition file and the anchor is checked "in the file as it is now"; one outside the root reads invalid.
- Q6, gaps: accepted. A gap is a discovered test no definition's test resolves to, whatever that definition's other state.
- Q7, line endings: overruled. Fleet Cooling enforces `eol=lf` in `.gitattributes`, yet 201 working-tree files on the owner's Windows machine are CRLF, 11 of them in `packages/convex` (measured by the orchestrator at 18:18), so exact matching would make every multi-line anchor read anchor missing there. A newline in `old` matches LF or CRLF in the file, and the count stays non-overlapping, as the bootstrap verifier's `split` counts. One matcher serves both tickets (C8): 3.2 builds it as a standalone module, `packages/daemon/src/falsify/anchor-match.ts` (path sent at 18:19, exports at 18:20: `countAnchor`, `locateAnchor`, `replaceAnchor`), and 3.1 imports it.
- Q8, scope: accepted. This ticket counts its own states and the total; the verified and eligible counts are 3.4's.

Asked 2026-09-30 18:25, after the ticket review; decided by the orchestrator at 18:26.

- R1, a definition file reachable only through a directory link: accepted, fail-closed, with a condition. The walk first skips what the repository's other walks skip (`node_modules`, `.git`, git-ignored paths; `docs/architecture.md` § Source scan for undeclared dependencies), so only a directory link the walk would otherwise have entered is an invalid entry; otherwise every Bun or pnpm consumer's workspace links under `node_modules` would withhold verified for good. Fail-closed over following links, since the repository's walks follow no directory link and a silently smaller denominator is false verification.
- R2, one state field or two (C119): accepted, one, matching `docs/architecture.md` § State dimensions' Defect evidence dimension; 3.4 adds evidence freshness as its own field.

#### Built after 3.2's matcher lands

3.1's dev starts only once 3.2's build is on `main`, since AC4 counts anchors with 3.2's matcher, and after 2.7b lands, since 3.1 is written against 2.7b's `protocol.ts`, `server.ts`, `request-fields.ts`, `lifecycle.ts` and `query-client.ts`. An empty `old` never reaches the matcher: AC2 makes it invalid first, so `countAnchor`'s 0 for an empty anchor is never read as anchor missing.

#### Decided by this session (within the orchestrator's rulings, no question sent)

The grill's remaining seed turned on no preference the rulings left open, so this session decided it (2026-09-30 18:20), changing no ruled answer: the design decisions above on regular files, invalid over anchor missing, the answer's text and the duplicate mark, and these:

- An invalid entry of AC1 lies in every scope, since the tests of the definitions it holds are unknown; a definition whose test does not resolve is scoped by the module path it names.
- A walk past its depth bound is an invalid entry naming the pattern, never a partial list (C28).
- A test two Vitest workspaces collect under one project name and one name path cannot be told apart by the format's fields; the definition stays invalid as ambiguous and says so (review F7), a known limit that withholds verified and never credits a detection.

#### Pending siblings

- 2.7b (ready-for-dev, building in Tree 2) edits `daemon/protocol.ts`, `daemon/server.ts`, `daemon/lifecycle.ts` and `query-client.ts`, and creates `daemon/request-fields.ts`, which takes `error`, `valueShape` and `namedPaths` out of `server.ts`. This ticket builds after 2.7b lands, in Tree 2, and is written against those files as 2.7b leaves them (its build is `a31ef49` on `wt/2`).
- 3.2 (ready-for-dev, building in Tree 1) writes none of this ticket's files: its list is `vitest/workspace-session.ts`, `daemon/executor-jobs.ts`, `daemon/executor.ts`, `daemon/executor-main.ts` and `packages/daemon/src/falsify/`. Both live in `packages/daemon`, so `list-unbuilt-work` matched it by folder only. 3.2 also creates the anchor matcher this ticket imports (orchestrator ruling Q7); 3.1 reads that module and never edits it.
- 3.4 (backlog) extends this ticket's answer and command with evidence, its freshness, and the verified and eligible counts, and binds evidence to a digest of each definition.
- 3.5 (backlog) builds a falsification job's experiments from this ticket's resolved definitions.
- 3.8 (backlog) converts this repository's `defects.json` records into definition files in this format, so the format this ticket fixes is the one 3.8 writes.

#### Current structure of the modified files

- `packages/daemon/src/daemon/protocol.ts` (346 lines): `PROTOCOL_VERSION = 4`; query types `SUMMARY_TYPE`, `PATH_STATUS_TYPE`, `WAIT_TYPE`, `CHANGES_TYPE`; each request interface and a response type `XAnswer & { type; protocolVersion }`. A new request type needs no version change: an older daemon answers `UNKNOWN_REQUEST_CODE`, which `query-client.ts`'s `queryErrorReason` turns into "predates this query; stop it and start it again".
- `packages/daemon/src/daemon/server.ts` (580 lines, fewer after 2.7b): `DaemonHandlers` (one method per query), `versionedAnswer` routes by type, `pathStatusResponse` checks an absolute path, `queryResponse` and `checkedAnswer` turn refusals, nothing-to-answer and a too-long answer into errors, and `narrowerRequest` picks the advice by type.
- `packages/daemon/src/daemon/lifecycle.ts` (566 lines): `summary()` reads `#latestResults()` and answers `summaryAnswer(results, this.#view(), this.#queryInputs(results))`; `pathStatus` resolves the caller's path first.
- `packages/daemon/src/query-client.ts` (196 lines): one exported function per query over the private `query(target, request, bound?)`.
- `packages/daemon/src/inputs/non-inputs.ts` (360 lines): `readNonInputs` reads only the `nonInputs` and `nonInputVariables` members and ignores every other, so a `defects` member leaves the declared non-inputs as they are, and a bad `defects` member does not make them unusable.
- `packages/cli/src/main.ts`: the `COMMANDS` list. `packages/cli/src/commands/status.ts` is the pattern for an optional-path query command with `--root` and `--json`.

#### Tests this change may break

None by reference expected: the change adds a request type, a handler method and a command. `DaemonHandlers` gains a method, so any test stand-in implementing it (search `packages/daemon/test` for `DaemonHandlers` and `implements DaemonHandlers`) needs the method; the typecheck finds each. A test that lists the CLI's commands or usage lines (`packages/cli/test/cli.test.ts`) may read the new usage line.

#### Previous-ticket intel

3.1 is the first ticket of sprint 3, so there is no earlier sprint-3 ticket. The nearest precedent is 2.6, which added the `changes` query and command through the same files (`protocol.ts`, `server.ts`, `lifecycle.ts`, `query-client.ts`, `client.ts`, `answer-text.ts`, `main.ts`, a new command file and a new answer module).

#### Sizing

About 21 raw files and 27 estimated (21 times 1.3 is 27.3); code units 8 (7 criteria plus validation). Production, modified: `daemon/protocol.ts`, `daemon/server.ts`, `daemon/request-fields.ts`, `daemon/lifecycle.ts`, `query-client.ts`, `client.ts`, `inputs/non-inputs.ts`, `cli/src/main.ts`, `cli/src/answer-text.ts`. Production, created: three modules under `packages/daemon/src/defects/`, `query/defects-answer.ts`, `cli/src/commands/defects.ts`. Tests, for create-tests: a test file and its `defects.json` under `packages/daemon/test/defects/`, additions to an existing daemon query or server test with its `defects.json`, and a CLI command test with `packages/cli/test/defects.json`. Docs: `docs/architecture.md`, as text reported to the orchestrator. Read only, not counted: 3.2's `packages/daemon/src/falsify/anchor-match.ts`. Over 25 estimated and within 30, since a split would cut the reader from its only caller: definitions read with no query answering them are an export with no consumer (C59). Over 10 estimated, so dev delegates in two groups: the reader, validator and resolver (AC1 to AC4); then the answer, protocol and command (AC5 to AC7), which depends on the first.

### References

- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.1 and its objective.
- ADR-0004, ADR-0009; `docs/requirements.md`: FR12, FR13, FR14, FR22, FR24.
- `docs/architecture.md` § Summary and path status queries; § Query clients and CLI query commands; § Protocol, stop and log; § Declared non-inputs and protected files; § Execution and falsification isolation.
- `_agent-docs/tickets/3-2-transform-experiments.md` for the experiment interface 3.5 builds from this ticket's resolved definitions.
- GitHub issues: `node scripts/list-open-issues.mjs` printed "0 open issues, complete" on 2026-09-30.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C12,C13,C14,C19,C24,C26,C28,C29,C30,C32,C38,C42,C45,C48,C59,C170,C172,C119,C123,C125,C131,C139,C140,C147,C151,C152,C153 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P16,P17,P18,P19,P21,P32,P33,P38,P40 -->

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
sizing_ac_count: 8
files_to_modify:
  - packages/daemon/src/daemon/protocol.ts
  - packages/daemon/src/daemon/server.ts
  - packages/daemon/src/daemon/request-fields.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/query-client.ts
  - packages/daemon/src/client.ts
  - packages/daemon/src/inputs/non-inputs.ts
  - packages/cli/src/main.ts
  - packages/cli/src/answer-text.ts
files_to_create:
  - packages/daemon/src/defects/definition-files.ts
  - packages/daemon/src/defects/definitions.ts
  - packages/daemon/src/defects/resolve-definitions.ts
  - packages/daemon/src/query/defects-answer.ts
  - packages/cli/src/commands/defects.ts
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

- `_agent-docs/tickets/3-1-defect-definitions.md` (created by create-ticket, 18:26 on 2026-09-30)
- Read only, never edited by this ticket: `packages/daemon/src/falsify/anchor-match.ts`, created by ticket 3.2, whose `countAnchor` AC4 imports (orchestrator ruling Q7).

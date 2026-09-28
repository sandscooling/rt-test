# Ticket 2.3e: Selection's input and an isolated dependency build

## Ticket

As the daemon that will select tests and narrow each workspace's inputs,
I want selection's input built from the discovery in effect, and the dependency information built in a child process of its own,
so that every selection and every narrowing reads the workspaces as discovery found them, and a consumer file that crashes the source parser fails one build with a reason instead of ending the daemon.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: From the discovery in effect, the consumer root and the consumer's non-inputs declaration, RT Test builds everything `SelectionInput` holds except the change and the dependency information, and a selection over it explains and counts the workspaces as discovery found them:
  - a discovered workspace is selectable, with its discovered tests and, as discovery reports them, every setup file, global setup file and alias of any of its projects;
  - its tests are not known, with a reason naming what failed, when discovery reports a module of it that failed to collect or an unhandled error during its collection; a browser-mode project of it leaves its tests known;
  - a workspace whose config failed to load is selectable with its tests not known, its load error the reason;
  - an unsupported workspace and a not-confirmed workspace are not runnable, each with its reason;
  - the Vitest listing's unread sources are the discovery's;
  - the non-inputs hold the declaration and the protection `protection` builds over that same discovery.
- [x] AC2: With no discovery in effect, or one that lists a discovered workspace whose selection facts it does not report, no selection input is built, and the answer says why, naming that workspace.
- [x] AC3: The dependency information for a selection input is built in a child process of its own that ends with the build. The build answers exactly what `buildDependencyInformation` answers in process over the same consumer root and the selectable workspaces of AC1's input. A consumer file that ends its process inside the source parser fails that build with a reason naming how the process exited, and the process that asked for it keeps running.
- [x] AC4: A stop during a build ends the build's process and every process it started without waiting out the bound a Vitest job is given, and the build ends with no dependency information and a reason.
- [x] AC5: The reason for a build whose process ended inside the parser (AC3) also names the root-relative path of the file it was parsing. When that file cannot be told, because no record of it was written or the record cannot be read, the reason names the exit and says the file is not known. To tell it, a build writes only inside the daemon's state directory its caller names, and only root-relative paths, never file content. No build reads a record an earlier build left, and a build's record is gone once the daemon has seen the build end; a daemon that itself ends during a build leaves that one record behind, which no later build reads.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Question                                                                                                                                                                                                                                                                                                                                                | How to check                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Does a source of about 45,000 `a+` terms (about 100 KB) still end the process inside `oxc-parser` 0.151.0 on Linux under Node 22 and 24, as ticket 2.2b measured on Windows x64 under Node 24.19 (2.2b § F1's residual), and with what exit code or signal on each? AC3's proof needs one consumer file that crashes the parser on every gate platform. | In a child `node` process on each platform, `parseSync("a.ts", "a" + "+a".repeat(45000))` from the installed package, and read the child's exit code and signal. |

**U1: CONFIRMED at 100,000 terms, not at 45,000** (dev, 2026-09-28 08:12 and 08:21). A child `node --input-type=module -e` ran `parseSync("a.ts", "a" + "+a".repeat(N), { sourceType: "module" })` from the installed `oxc-parser` 0.151.0, then read `result.program`:

| Platform                      | 45,000 terms (about 90 KB) | 100,000 terms (about 200 KB)                      | 200,000 terms        |
| ----------------------------- | -------------------------- | ------------------------------------------------- | -------------------- |
| Windows x64, Node 24.19.0     | parses, exit 0             | exit code 3221225725 (0xC00000FD, stack overflow) | exit code 3221225725 |
| Linux x64 (WSL), Node 24.19.0 | parses, exit 0             | signal SIGSEGV                                    | signal SIGSEGV       |
| Linux x64 (WSL), Node 22.23.3 | parses, exit 0             | signal SIGSEGV                                    | signal SIGSEGV       |

The process ends inside `parseSync` itself, before `program` is read. Linux resolved the package from `~/rt-test/packages/daemon` at ae1f4b0 (frozen install), read-only. So AC3's crash fixture needs about 100,000 terms, and its reason reads `exit code 3221225725` on Windows and `signal SIGSEGV` on Linux; a test should match the exit shape per platform, not one code. The design is unchanged.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve U1 first and write its answer, with the command and output, beneath the table. Before the first edit, confirm nothing has moved in this ticket's files since the 08:07 re-verify against 2.3d's landed code (§ Pending siblings and their routing): `SelectableWorkspace.aliases` is `readonly ReportedAlias[]`, and `ResolvedAlias` no longer exists.
- [x] (AC1, AC2) Create `packages/daemon/src/selection/selection-input.ts`, exporting one function that takes the discovery in effect (`TestDiscovery | undefined`), the consumer root's real path and the `NonInputsDeclaration`, and answers either the selection input without its change and dependency information (a type derived from `SelectionInput` with `Omit`, C14) or why none can be built (AC2). Map each `WorkspaceDiscovery` by its status as AC1 lists, and take the Vitest listing's unread sources from the discovery's `notRead`. A browser-mode project leaves its workspace's tests known and contributes no setup file or alias, since discovery reports none for it (§ Design notes, "Browser-mode projects"). For a discovered workspace, union its projects' `setupFiles`, `globalSetupFiles` and `aliases` in project order without repeats, and take `tests` from its `DiscoveredTest`s; a non-empty `failedModules` or `unhandledErrors` makes them not known, with a reason naming the failed module paths or that collection raised an unhandled error. Build `nonInputs.protection` with `protection(discovery, consumerRoot)`, the one producer (2.3c). Name each reason text as a constant (C3).
- [x] (AC3, AC5) In `packages/daemon/src/daemon/executor-jobs.ts`, add a request carrying the consumer root, the selectable workspaces and the absolute path of this build's parse record, and a reply carrying the `DependencyInformation`. Confirm, by reading `DependencyInformation`, `SelectableWorkspace` and the types they hold (`TestIdentity` in `@rt-test/core` among them), that every field of both is plain JSON (no `Map`, `Set`, class instance or `undefined`-valued field), which the executor's channel carries unchanged, and record what you read; if one is not, convert it at the channel and back, so AC3's equality holds.
- [x] (AC5) In `packages/daemon/src/selection/workspace-graph.ts`, let `buildDependencyInformation` take an optional observer that `addSourceFileEdges` calls with the file's root label (`rootLabel(scan, file)`, already computed there) immediately before `readSourceImports`, and again with no label once it returns, so the record is empty whenever no parse is in progress; `readSourceImports` is the one call that reaches `oxc-parser`'s native `parseSync` (`rg -n "parseSync|readSourceImports\(" packages/daemon/src`, 05:50). An in-process caller passes none, and the build is otherwise unchanged (P19: an observer, not a mode flag).
- [x] (AC3, AC5) In `packages/daemon/src/daemon/executor-main.ts`, answer that request with `buildDependencyInformation(findPackageWorkspaces(consumerRoot), workspaces, observer)`, whose observer writes the label to the parse record synchronously (`fs.writeSync` on a descriptor opened once per build), replacing what the record held, so the last label written survives a native abort that drops any queued asynchronous write. A throw answers `job-failed`, as today. Loading `workspace-graph.js` with a dynamic `import()` inside that branch keeps `oxc-parser`'s native binding out of every discovery and run process; dev decides.
- [x] (AC3, AC4, AC5) In `packages/daemon/src/daemon/executor.ts`, add a method that takes the consumer root as discovery was given it (`ConfirmedStart.consumerRoot`, not its real path; § Design notes, "Two spellings of the root"), the selectable workspaces and the state directory, runs the build as one job and answers a `JobOutcome<DependencyInformation>`, through the fork, containment and replaced-child guards every job already has (C157). Name the build's parse record uniquely inside the state directory across daemon lives and across worktrees sharing the directory (a random component, not only a pid or a counter), and create it empty with an exclusive create before the build's process starts, so no build can read another's (AC5), even when its process exits before its first write. An exit during the build settles the job with `the executor process <pid> exited during the job (<exit>)`; for a build, add the record's label to that reason, or say the file is not known when the record is absent, empty or unreadable, each added text a named constant (C3). Remove the record once the build has ended, whatever its outcome. On `abort()` during a build, end the process tree at once rather than after `EXECUTOR_BOUND_MS`, and settle the job with a reason naming the stop, never the exit reason a crash gets (AC4, C131): the build's work is synchronous, so the child cannot read the abort message until it ends, and it writes nothing but its record. Correct the class doc comment, which says it hosts Vitest (C46), and extend `failureReason`'s other-kind message if it no longer reads true.
- [x] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [x] (Support) Lint and typecheck: `bun x oxlint` over the changed files, and `bun run --filter @rt-test/daemon typecheck`.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `Executor` (`daemon/executor.ts`): one child process per job, held with every process it starts (`treeContainment`), ended with the job, its replies taken only from the current child (C157), an exit mid-job turned into a reason (`#exited`), and `JobOutcome<T>`. AC3 and AC4 are a new job kind on it, not a second process host (P18, C5).
- `daemonEntryPoint` (`daemon/entry-point.ts`): the child entry path and flags, from source or from `dist`.
- `buildDependencyInformation(listing, vitestWorkspaces)` (`selection/workspace-graph.ts`) and `findPackageWorkspaces(consumerRoot)` (`vitest/find-workspaces.ts`): the build, run in the child, unchanged but for AC5's observer.
- `rootLabel(scan, path)` (`selection/specifier-edges.ts`): a scanned file's root-relative label, which `addSourceFileEdges` already computes for its uncertainty causes; AC5's record holds the same label.
- `protection(discovery, consumerRoot)` (`inputs/protection.ts`): the one producer of the protection value (2.3c AC5).
- `SelectionInput`, `SelectableWorkspace`, `NotRunnableWorkspace`, `WorkspaceTests`, `DependencyInformation` (`selection/selection-types.ts`): the shapes AC1 and AC3 fill; derive, never restate (C14).
- `TestDiscovery`, `WorkspaceDiscovery`, `DiscoveredTest` (`vitest/discover-tests.ts`) and `SelectionFacts`, `ProjectSelectionFacts` (`vitest/selection-facts.ts`): the discovery AC1 reads.
- `NonInputsDeclaration` (`inputs/non-inputs.ts`): the declaration's type.
- `errorText`, `exitText` (`vitest/error-text.ts`): an error's or an exit's text.

### Must Create

- `selection/selection-input.ts`: the function that builds selection's input from the discovery (AC1, AC2).
- The dependency-build request and reply in `executor-jobs.ts`, its branch in `executor-main.ts`, and its method on `Executor` (AC3, AC4, AC5).
- The build's parse observer in `workspace-graph.ts`, and the parse record's writer, reader and removal (AC5).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The fifth of the tickets the original 2.3 split into, and the first of the two the unsplit 2.3e became (orchestrator ruling Q5, 05:45). This ticket builds selection's input from the discovery and makes the dependency information buildable in a child process. Ticket 2.3g calls both: it builds the dependency information once per input revision and narrows each workspace's fingerprint with it. Ticket 2.3f then schedules selections over them. Build order: 2.3d, 2.3e, 2.3g, 2.3f. Like selection since 2.2, what this ticket adds has no production caller until 2.3g; C59's "every export has a production consumer" is met when 2.3g lands, as it was for `selectTests` (§ Orchestrator rulings, Q5).

Requirement this ticket serves (`docs/requirements.md`): "FR7: Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts." (AC1 to AC4)

Sprint scope, quoted from the unsplit 2.3e: "selection runs in a disposable child process, so a consumer file that crashes the source parser fails that one selection with a reason instead of ending the daemon (orchestrator, 2026-09-27 01:27; ticket 2.2b)"; "It builds selection's input from the discovery ticket 2.3b reports: each workspace that cannot run (not confirmed at start, unsupported) is passed with its reason, so no selection runs it and every explanation and count stays true (orchestrator, 2026-09-26 18:07 and 18:22). SelectionInput's protection is filled with ticket 2.3c's protection value, built by `protection` over the same discovery the tracker reads".

Rule clauses the criteria rest on:

- AGENTS.md § Product guarantees: "Widen selection when dependency information is uncertain." (AC1, AC2)
- AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states. A zero-test selection is not proof of success." (AC1)
- AGENTS.md § Product guarantees: "Explain each selection and each broad fallback. Report selected and total test counts." (AC1)
- `SelectionCounts` (`selection/selection-types.ts`): a count's `complete` "is false while any workspace it covers has tests not known". A workspace with a failed module passed as known would count its tests as complete while the failed module's tests are missing. (AC1)
- Ticket 2.2b § F1's residual: "an operator chain of about 45,000 terms (roughly 100 KB of `a+a+...`) still ends the process inside the native parser, which no catch recovers." (AC3)

Glossary (`docs/glossary.md`), verbatim:

- **Vitest workspace**: "One directory RT Test runs as its own Vitest instance: the consumer root or a package workspace that holds a Vitest configuration."
- **Package workspace**: "One directory RT Test treats as a package: the consumer root, or a directory the root `package.json` `workspaces` field lists, whether or not it holds a `package.json`. Every Vitest workspace is one, and the dependencies between them decide selection."
- **Executor process**: "The daemon's child process that alone hosts Vitest, one discovery or run at a time." This ticket adds a third job kind, so the entry changes (§ Doc text).
- **Widening**: "Adding tests to a selection because a dependency is uncertain."

#### Orchestrator rulings

Asked by `session_wake` at 05:43 on 2026-09-28, answered at 05:45; decider the orchestrator, holding the owner's calls overnight.

- Q1 (2.3g's): while the current revision's build is unfinished, a workspace has no fingerprint and its results read unknown with a reason naming the build, and a job waits for the build. Not narrowed from an older build, which rests on an unproven property.
- Q2 (2.3g's): a failed build widens every workspace to the whole project's inputs, the log names why, the next input change or discovery retries it, never a timer or a loop, and every answer carries the reason as an input fact beside `nonInputsUnusable`.
- Q3 (this ticket's AC1 and AC2): a failed workspace is selectable with its tests not known; a failed module or an unhandled collection error makes the tests not known with the reason, and a browser-mode project adds nothing unknown; unsupported and not-confirmed workspaces are not runnable, each with its reason; a discovery without selection facts builds no dependency information. Reason: uncertainty widens, and a zero or partial count must say it is incomplete. A failed workspace passed as not runnable would never be selected, so 2.3f's retry of it could never run.
- Q4 (2.3f's): a job stays stored not fingerprinted when any input changes while it runs, whether or not the input is in its workspace's narrowed set; 2.3f decides that. Written into § Ticket 2.3f's scope under the 05:45 grant.
- Q5, sizing: the unsplit 2.3e measured about 24 raw files and 31 estimated with 8 code units, over the 20-file limit. Split into this ticket, "Selection's input and an isolated dependency build", and 2.3g, "Narrow each workspace's fingerprint", both authored in this lane. 2.3f keeps its key, since four landed ticket records cite it, and builds after 2.3g.
- Q6 (AC5), asked at 05:49 from the grill, answered at 05:50: a parser crash's reason names the file, through a synchronous record in the daemon's state directory. Reason: the product explains each broad fallback, and here the fallback is the whole project (2.3g); an exit code alone leaves the consumer unable to find, fix or declare the file. Constraints, each in AC5: the record lives in the state directory, never elsewhere in the consumer's tree; it holds only a root-relative path, never content; a crash with no record, or an unreadable one, falls back to the exit and says the file is not known; a stale record from an earlier build is never read as this build's. Its write marks no job and moves no revision, since the daemon's tracker excludes the state directory from the inputs (`daemon-main.ts` passes `exclusions: [directory, log.file]` to `InputTracker`).
- Ticket review (create-ticket 6c, 05:52 to 05:55): 12 findings, 11 applied as edits, including the three questions each settled by a fact. F1 named the listing's unread sources and the browser-mode case in the builder task. F3 clears the record after each parse, so a crash outside a parse never blames a file that parsed. F4 names the record uniquely across daemon lives and worktrees and creates it empty before the process starts. F6 names which root the build takes. F8 and F9 gave the JSON claim and the broken-test claim their methods. F11 and F12 made the new reasons constants and gave an aborted build a stop's reason, not a crash's. F2 was settled from `selectionFacts`: a browser-only workspace reports `projects: []`, and browser-mode facts act only on tests RT Test never runs (§ Design notes). F7 was settled from 2.2's contract: only selectable workspaces enter the build. F10 was settled from `addVitestEdges`, which adds every alias's edges. F5 (a daemon killed mid-build leaves its record) was applied as a narrower AC5: the daemon removes a record once it has seen the build end, and the one a killed daemon leaves is never read, since names are unique. A sweep at start was rejected, since worktrees can share a state directory and a sweep could remove a live daemon's record.
- Grill (create-ticket 6b, 05:49), settled by fact, so not asked: a stop ends a build at once (§ Design notes, "Abort ends a build at once"); a workspace's projects merge by union, which only widens; `closeError` and `typecheckModules` leave the tests known.

#### Design notes

- **The build is a job kind of the executor, not a new process host.** `Executor` already forks one process per job, holds its whole tree, ignores a replaced child's events and turns an exit into a reason, which AC3 and AC4 need entire. 2.3g will hold a second `Executor` for builds, so a build never waits behind a run; one instance takes one job at a time (`#child`, `#settle`).
- **What the child needs.** `buildDependencyInformation` reads only the listing and the selectable workspaces. The declaration and the protection are read by `selectTests`, never by the build, so they stay in the daemon, which also keeps `Protection`'s `protects` closure off the JSON channel.
- **Why the file is named through a record, not the channel.** `process.send` is asynchronous, and a native abort drops what is still queued, so a message naming the file being parsed may never arrive. A `writeSync` has returned before the parse starts, so the record holds the last file begun. Each build writes one short write per parsed source file; a file that parses is cleared from the record once its parse returns, so after a crash the record names the file whose parse did not return, or is empty (the file is not known) when the process ended outside a parse, and never blames a file that parsed. Dev chooses how a shorter label replaces a longer one (truncating, or a terminator the reader stops at).
- **Abort ends a build at once.** A Vitest job gets `EXECUTOR_BOUND_MS` (`FORCE_STOP_GRACE_MS` 10,000 ms plus 5,000 ms) to close Vitest and run teardown. A build hosts no Vitest and writes nothing but its record, which the daemon removes, and its child is busy in synchronous code, so it cannot read the abort message before it finishes. Waiting would only delay the stop.
- **Two spellings of the root.** Discovery lists its workspaces under `ConfirmedStart.consumerRoot` as given (`discoverAll` calls `findVitestWorkspaces(start.consumerRoot)`), so the build takes that same root for `findPackageWorkspaces`, and package and Vitest workspace directories are spelled alike; `vitest-edges.ts` resolves each through `realPath`. `protection` takes the root's real path, as the tracker holds it (`realpathSync.native(consumerRoot)`). The selection harness's `throughLink` case already hands selection a root through a link.
- **Projects merge into their workspace.** Selection works at workspace granularity, so a setup file or alias of any project applies to the workspace. A project-only alias applied to the whole workspace can only add edges, which widens (C126) and never narrows: `addVitestEdges` (`vitest-edges.ts`) calls `addAliasEdges` for every alias in turn, not for the first that matches, so two projects giving one `find` different replacements each add their edges. "Without repeats" compares an alias by all five of its fields.
- **Browser-mode projects.** Discovery reports selection facts only for projects not in browser mode (2.3b; `selectionFacts` filters `usesBrowserMode`), and a workspace whose projects are all in browser mode reports `{ reported: true, projects: [] }`, not `{ reported: false }`, so AC2 never refuses it. A browser-mode project's setup files and aliases act only on its own tests, which RT Test never runs (discovery names the project unsupported), so leaving them out narrows nothing the workspace runs.
- **Which workspaces the build reads.** Only the selectable ones, as 2.2's contract has it (`test/selection/harness.ts` `selectInTree`: "Lists, builds and selects over the tree as the daemon's caller will: not-runnable workspaces passed with their reason"). A not-runnable workspace adds no Vitest edge, and selection reports it as reached and not run wherever its package workspace is reached.
- **Scope of the analysis.** Analyzed: every `WorkspaceDiscovery` status, `failedModules`, `unhandledErrors` and `unsupportedProjects` of a discovered one, and `SelectionFacts.reported`. Not analyzed: `closeError` and `typecheckModules`, which change no test identity selection passes, so they leave the tests known.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3e` over the unsplit ticket's files (05:42) named 2.3d and 2.3f. Re-run at 05:51 over this ticket's final list (`selection/workspace-graph.ts`, `selection/selection-input.ts` and the three `daemon/executor*` files), it named only 2.3d, by folder.

Re-verified at 08:07 against wt/1 at f40d2a1, which merged main's 2.3d (fdb86de), item 11 (1ba4836) and #28 (ae1f4b0): `git diff --stat 20eae03 HEAD` touches none of this ticket's production files (`workspace-graph.ts`, the three `daemon/executor*` files) nor `vitest/discover-tests.ts`, `vitest/selection-facts.ts`, `vitest/find-workspaces.ts` or `inputs/protection.ts`, which it reads.

- **2.3d** (landed at fdb86de): `SelectableWorkspace.aliases` is `readonly ReportedAlias[]` (`selection-types.ts`, type-only import from `vitest/selection-facts.ts`), `ResolvedAlias` is deleted, and `SELECTION_POLICY_VERSION` is 5. AC1 passes each reported alias through whole, with no conversion. `declaredNonInputs` and `projectWideKinds` decide the declaration file through `namesDeclarationFile` (`non-inputs.ts`); the build reads neither.
- **Item 11** (landed at 1ba4836, test code only): `test/scripts/child-end.ts` (`WatchedChild`, `crashError`) reads how a directly spawned child ended. AC3's crash reaches the test through `Executor`'s reason, so it is not this ticket's to reuse, though U1's probe may use it.
- **#28** (landed at ae1f4b0): `InputFilter` excludes `rt-test.json` itself, and `readNonInputs` refuses a linked or non-regular one. Neither is read by this ticket.
- **2.3g** (backlog, authored in this lane) is this ticket's only caller: it builds the dependency information per input revision through AC3's job and narrows each workspace's fingerprint. It owns every change to `fingerprint.ts`, `current-inputs.ts`, `input-tracker.ts`, `lifecycle.ts` and `daemon-main.ts`.
- **2.3f, 2.3h, 2.3i** (authored after this ticket, from the 06:10 split of 2.3f) build after 2.3g and write none of this ticket's files.

#### Sizing

About 10 raw files and 13 estimated; code units 6 (5 criteria plus validation). Production: `selection/selection-input.ts` (new), `selection/workspace-graph.ts`, `daemon/executor-jobs.ts`, `daemon/executor-main.ts`, `daemon/executor.ts`. Tests, for create-tests: tests of the builder beside selection's (`test/selection/select-tests.test.ts` or the harness, which builds a stand-in discovery in `treeDiscovery`), the build in a real child process, `test/selection/defects.json`, `test/defects.json`, and a crash fixture. At 13 estimated, over 10, dev delegates: the builder (`selection-input.ts`) and the job (`workspace-graph.ts`'s observer and the three `daemon/` files) touch disjoint files.

#### Current structure of the modified files

As of wt/1 at 20eae03, and unchanged at f40d2a1 (08:07).

- `packages/daemon/src/daemon/executor-jobs.ts`: `EXECUTOR_BOUND_MS = FORCE_STOP_GRACE_MS + EXECUTOR_MARGIN_MS`; `ExecutorRequest` is `discover` (a `ConfirmedStart`), `run` (a `VitestWorkspace` and its config file) or `abort`; `ExecutorReply` is `discovered`, `ran` or `job-failed`.
- `packages/daemon/src/daemon/executor-main.ts`: one `AbortController` per job; `runJob` answers `discover` with `discoverTests` and `run` with `runWorkspace`, a throw with `job-failed`; a disconnect aborts the job and ends its own tree after `EXECUTOR_BOUND_MS`.
- `packages/daemon/src/daemon/executor.ts`: `Executor` with `discover`, `run`, `abort` (sends `abort`, then ends the tree after `EXECUTOR_BOUND_MS`), `close`, and the private `#job`, `#unsent`, `#startChild` (`fork` of `executor-main` with `stdio` `ignore`, `inherit`, `inherit`, `ipc`), `#lost`, `#exited`; `failureReason` maps `lost` and `job-failed` and names any other reply as another kind of job's. 249 lines.
- `packages/daemon/src/selection/workspace-graph.ts`: `buildDependencyInformation(listing, vitestWorkspaces)` reads manifests, adds dependency and override edges, then `addUndeclaredEdges` walks each package workspace and calls `addSourceFileEdges(scan, dependent, file)` per source file, which computes `label = rootLabel(scan, file)` and then calls `readSourceImports(file)`. 466 lines.

#### Existing tests this change breaks

None found. `rg -n "ExecutorReply|ExecutorRequest|job-failed" packages/daemon/test` (05:47) finds no test that builds an executor message, and `test/executor.test.ts` drives `discover` and `run` through a mocked `node:child_process`, whose shapes this ticket does not change. The typecheck reports a type it missed (P14), not a changed message: if the build changes `failureReason`'s other-kind message or the exit reason's text, dev greps `packages/daemon/test` for the old text.

#### Doc text

A draft for the orchestrator, final wording to follow the build.

- `docs/architecture.md`, the paragraph after the known limits: "A file that overflows the parser's native stack ends the selecting process; 2.3e isolates it. The daemon does not call `buildDependencyInformation` or `selectTests` yet, so selection has no production caller." becomes "The dependency information is built in an executor process of its own, one per build, so a file that ends the process inside the parser fails that build with a reason naming the process's exit and that file's root-relative path, which the build records in the state directory before each parse, and a stop ends a build at once. Selection's input is built from the discovery in effect: a discovered workspace is selectable with the setup files, global setup files and aliases of all its projects, its tests not known when a module failed to collect or collection raised an unhandled error; a workspace whose config failed to load is selectable with its tests not known; an unsupported or not-confirmed workspace is not runnable. A discovery that does not report a discovered workspace's selection facts yields no selection input. The daemon does not build either yet, so selection has no production caller."
- `docs/glossary.md`, **Executor process**: "A child process of the daemon that runs one job, a discovery, a run or a dependency build, and ends with it; only an executor process hosts Vitest."
- `README.md`: no change; nothing user-visible changes until 2.3g.

#### Previous ticket

2.3d (done, fdb86de), the nearest earlier key in the status file, from its Dev Notes and its landed code: `SelectableWorkspace.aliases` carries 2.3b's `ReportedAlias` (`{ find, findKind, flags, replacement, hasCustomResolver }`), so AC1 passes discovery's aliases through without converting them; its Doc text notes that selection has no production caller until 2.3e, which this ticket moves to 2.3g. From 2.3c (done, a3ca5bc), in its Completion Notes: `protection(discovery | undefined, consumerRoot)` is the one producer and takes the consumer root's real path; `input-tracker.ts` sits at about 495 code lines, so an addition there needs an extraction first (2.3g's concern). From 2.3b (done): discovery reports selection facts per project not in browser mode, root-relative and `/`-separated, and a discovery stored before store schema version 3 reads `{ reported: false }`. `git log --oneline -20` (05:45) shows no code commit since 2.3c's a3ca5bc other than c73c075, a defect-verifier fix outside `packages/daemon`.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3e, § Ticket 2.3g, § Ticket 2.3f.
- Ticket 2.1 (`_agent-docs/tickets/2-1-track-inputs.md`) Q3 and AC11: the narrowing 2.3g builds on this ticket's work.
- Ticket 2.2b (`_agent-docs/tickets/2-2b-undeclared-edges.md`) R6 and § F1's residual: the parser crash this ticket isolates.
- Ticket 2.3c (`_agent-docs/tickets/2-3c-protect-selection-inputs.md`) AC5 and § Completion Notes.
- Ticket 2.3d (`_agent-docs/tickets/2-3d-alias-widening.md`) § Where this sits and § Pending siblings.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (05:42).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C12,C14,C30,C38,C46,C48,C55,C59,C126,C128,C131,C140,C147,C157,C158 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P15,P16,P17,P18,P19,P21,P41 -->

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
  - packages/daemon/src/selection/workspace-graph.ts
  - packages/daemon/src/daemon/executor-jobs.ts
  - packages/daemon/src/daemon/executor-main.ts
  - packages/daemon/src/daemon/executor.ts
files_to_create:
  - packages/daemon/src/selection/selection-input.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 894f7ac4-08a7-44e1-961f-dd75b49af2c2

#### Test Files This Change Broke

None. `bun run --filter @rt-test/daemon typecheck` (which includes `packages/daemon/test`) and root `bun x tsc --noEmit` both exit 0 (08:23). No exit-reason or `failureReason` text a test could quote changed for a discovery or run; only a build's reasons are new. No test builds a `Scan` or calls `newScan` (`rg -n "newScan|holders: new Map" packages/daemon/test test`, no hit), so its new `observer` field breaks none.

#### ACs Owed a Test

None: each criterion has non-test evidence (§ Completion Notes, "Acceptance evidence"). Every criterion still earns its tests in create-tests.

#### Tests Owed

- A parser crash inside a tsconfig parse must name the tsconfig: before the review fix, only `readSourceImports` was bracketed, so a walked `tsconfig.json` or an `extends` target that ended the process read "the file it was parsing, if any, is not known". Mutation: in `tsconfig-edges.ts` `addTsconfigEdges`, `observedParse(scan, file, () => readJsonc(file))` becomes `readJsonc(file)`. Fixture: a `tsconfig.json` of `"1" + "+1".repeat(100000)` (AC5).
- `close()` during a build must settle it as a stop, never as a crash naming the file then being parsed: before the review fix, `close()` waited `EXECUTOR_BOUND_MS` and the exit read "exited during the job ... while parsing <label>". Mutation: delete `if (this.#buildRecord !== undefined) this.abort();` from `Executor.close` (AC4, C131).
- The crash fixture needs about 100,000 terms, not 45,000, and the exit reads `exit code 3221225725` on Windows and `signal SIGSEGV` on Linux (U1). A test matches the reason's shape per platform.

### Tests Record

Tests session: threadId 0a7a9459-689c-43c1-9ebf-abc730eeae1a

Step 3 (08:30): `bun x vitest related <the nine production files> --run` exited 0, 15 of 61 test files, 588 tests passed; no red, so no broken test and no code bug. The dev's three Tests Owed are D2236 and D2237 (tsconfig and extends parses, proven in process through the observer, which the crash reason reads through the record, D2239), D2246 (close mid-build), and D2239 (the 100,000-term fixture, its exit matched per platform). Orchestrator rulings: D2240 to D2249 added to the range at 08:29, and D2247 to D2249 returned unused; the proof of every named defect folds into the orchestrator's `bun run check`, since `test:defects:changed` selects 1613 of 1613 (08:37, the orchestrator).

#### Named Defects

- D2220: A discovered workspace's tests are passed as known but empty, so a selection counts none of the tests discovery found and reads the count as complete. (AC1)
- D2221: A workspace takes only its first project's setup files, so a change to a later project's setup file selects nothing. (AC1)
- D2222: A workspace takes only its first project's global setup files, so a change to a later project's global setup file selects nothing. (AC1)
- D2223: Aliases are told apart without their replacement, so a second project's alias of the same find to another target is dropped as a repeat and its edges never added. (AC1)
- D2224: A single module that failed to collect is ignored, so the workspace's tests read as known and complete while that module's tests are missing. (AC1)
- D2225: A single unhandled collection error is ignored, so the workspace's tests read as known and complete. (AC1)
- D2226: A browser-mode project, which RT Test never runs, makes the workspace's tests not known. (AC1)
- D2227: A workspace whose config failed to load is passed as not runnable, so no selection ever selects it and a retry of it can never run. (AC1)
- D2228: An unsupported workspace is left out of the input, so a selection neither reports it as not runnable nor counts it. (AC1)
- D2229: A workspace not confirmed at start is left out of the input, so a selection neither reports it as not runnable nor counts it. (AC1)
- D2230: The Vitest listing's unread sources are dropped, so a selection reads its workspace total as complete while a candidate workspace went unchecked. (AC1)
- D2231: The protection is built without the discovery in effect, so no declared pattern is kept off the discovery's test modules. (AC1)
- D2232: With no discovery in effect, an empty input is built, so a selection over it reads as a complete selection of nothing. (AC2)
- D2233: A discovered workspace whose selection facts are not reported is skipped, so an input is built without it rather than refused. (AC2)
- D2234: The root workspace is named by its path, so the reason ends in a bare "." rather than saying the workspace at the consumer root. (AC2)
- D2235: The end of a parse is never reported, so the parse record keeps the label of a file that parsed and a later crash outside any parse blames it. (AC5)
- D2236: A walked tsconfig is parsed without telling the observer, so a parser crash inside it says the file is not known. (AC5)
- D2237: A config a tsconfig extends is parsed without telling the observer, so a parser crash inside it says the file is not known. (AC5)
- D2238: The build's process ignores the selectable workspaces it is sent, so its dependency information lacks every edge a test module, setup file or alias adds. (AC3)
- D2239: A build whose process ends inside the parser gives only the exit, so the consumer cannot tell which file to fix or declare. (AC3, AC5)
- D2240: An empty parse record is read as a file's label, so a process that ends outside a parse is said to have been parsing a file with no name. (AC5)
- D2241: A parse record that cannot be read is taken for an empty label, so the reason names a file with no name rather than saying the file is not known. (AC5)
- D2242: A build's parse record is never removed, so every build leaves a file behind in the state directory. (AC5)
- D2243: Every build's parse record has one fixed name, so a record a daemon left behind when it ended mid-build stops every later build. (AC5)
- D2244: An abort sends a build's process the abort message and waits out the bound a Vitest job is given, which a build busy in synchronous code can never read. (AC4)
- D2245: A build the abort ended is reported as a process that exited while parsing the file then in progress, so a stop reads as a parser crash in that file. (AC4)
- D2246: Closing the executor mid-build waits out the bound and then reports the build as a process that exited while parsing the file then in progress. (AC4)
- D2247: A source file is parsed without telling the observer, so a parser crash inside a source file says the file is not known. (AC5, review G1)
- D2248: The observer the build is given never reaches the scan, so no parse is recorded and every parser crash says the file is not known. (AC5, review G2)
- D2249: A parse is reported only once it has returned, so a process the parser ends leaves the record empty and the reason says the file is not known. (AC3, AC5, review G3; a real 100,000-term tsconfig crash)
- D2250: A parse record that cannot be created makes the build reject with the raw file-system error rather than end unrun with a reason. (AC5, review G4)
- D2251: A stop marks the build stopped but ends its process only once the bound a Vitest job is given has passed, so the stop waits the bound out. (AC4, review G5)
- D2252: A parse record that cannot be removed fails a build that finished, rather than being logged. (AC5, review G6; the removal fails through an explicit module mock of `removeParseRecord`)

#### Deliberately Untested

- packages/daemon/src/daemon/executor-jobs.ts: message shapes only; the daemon typecheck holds both ends to them, and D2238 proves the channel carries the request and the reply unchanged.
- packages/daemon/src/daemon/parse-record.ts `EXCLUSIVE_CREATE`: with a random name per record, an exclusive create and a plain one behave alike, so no mutation of the flag is observable; D2243 covers the name.
- packages/daemon/src/selection/selection-input.ts `nonInputs.declaration`: passed through unchanged, with no branch a test could drive wrong.
- packages/daemon/src/daemon/executor.ts, ending "every process it started" on a stop (AC4): the stop calls `endProcessTree` on the build's process, whose tree ending `process-tree.test.ts` and `job-tree.test.ts` already prove; D2244 to D2246 prove the stop reaches it at once.
- packages/daemon/src/inputs/protection.ts: only `ROOT_WORKSPACE` became an export; D2234 pins the text a reason takes from it.

### Review Record

Review session: threadId 2f058f5b-3fa2-4e4b-b591-33088b28c59e

Fixed in review: `selection-input.ts` `FAILED_MODULES_REASON` read "discovery could not collect these of its test modules:"; it now reads "discovery could not collect these test modules:". No test quotes the text.

Tech debt, triaged at Step 9 against 224269c. Rulings by the orchestrator, 2026-09-28 09:09: T5 is closed with no change, since `selectInTree` is the seam for protection's not-reported path and `selectFromDiscovery` already covers the builder. F6, T1 to T4, T6 and T7 are queued as change request #30, to run after #26 lands, over the tree #26 leaves. #26 claimed `selection-input.ts` at 09:07. The Step 9 triage sent to the orchestrator at 09:08 is #30's brief. No open GitHub issue bears on any item. The items as found:

- T1: `packages/daemon/test/daemon-harness.ts` `withNodeOptions` appends its argument to `NODE_OPTIONS`, which Node splits on spaces, and sets it for the whole worker while its body runs. Both callers pass a `pathToFileURL` href, which encodes spaces, so both are safe; a later caller passing a raw Windows path with a space would fail the child at startup and read as an executor crash.
- T2: `packages/daemon/test/executor.test.ts` `withBuildHook` repeats `withNodeOptions`' save, set and restore-or-delete of an environment variable for `RT_FIXTURE_BUILD_HOOK`; one shared helper in `daemon-harness.ts` would hold the restore once.
- T3: `packages/daemon/test/daemon.test.ts` D1496 sends the executor a hand-built `run` request with no `satisfies ExecutorRequest`, so a later change to the run request's shape would surface as an executor crash rather than a type error (pre-existing).
- T4: `packages/daemon/test/selection/harness.ts` `treeDiscovery` models a workspace the caller will not run as `status: "failed"`, which `buildSelectionInput` now makes selectable; `selectInTree` is unaffected, since `protection` skips every status but `discovered`, but the harness now encodes the opposite runnability from the production builder.
- T5: `packages/daemon/test/selection/harness.ts` `selectInTree` hand-builds each `SelectableWorkspace` rather than going through `buildSelectionInput`, so only D2220, D2227 and D2230 exercise the production builder end to end, and the two ways of building an input can drift.
- T6: `observedParse(scan, file, read)` computes `rootLabel(scan, file)` again where both `addSourceFileEdges` (`workspace-graph.ts`) and `addTsconfigEdges` (`tsconfig-edges.ts`) computed the same label on the line before; taking the label as its argument answers the question once.
- T7: `tsconfig-edges.ts` walks a tsconfig's `extends` chain twice, once in `addInheritedPathsEdges` for `paths` and again through `pathsBase` for `baseUrl`, so every shared base config is parsed twice per walked tsconfig, and each parse now also costs the record's writes (pre-existing).
- F6 (dev's change-request candidate): `selection-input.ts` `workspaceName` and `protection.ts`'s inline `entry.workspace.path === ROOT_PATH ? ROOT_WORKSPACE : entry.workspace.path` answer the same question.

#### Test Coverage Gaps

| #   | Source                                                                  | Named defect                                                                                                                                                                                                                                                                                                                                                                                                                                             | Expected test                                                                                               | Severity             |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------- |
| G1  | `packages/daemon/src/selection/workspace-graph.ts` `addSourceFileEdges` | A source file is parsed without telling the observer, so a parser crash inside a source file, the case AC3's fixture takes, says the file is not known. Mutation: `observedParse(scan, file, () => readSourceImports(file))` becomes `readSourceImports(file)`. D2235's test likely goes red on it, but no record names it.                                                                                                                              | In `workspace-graph.test.ts` through `parsesInTree`, beside D2236 and D2237.                                | MEDIUM, daemon-state |
| G2  | `packages/daemon/src/selection/workspace-graph.ts` `addUndeclaredEdges` | The observer `buildDependencyInformation` is given never reaches the scan, so no parse is recorded and every crash says the file is not known. Mutation: `newScan(graph, root.directory, observer)` becomes `newScan(graph, root.directory, undefined)`.                                                                                                                                                                                                 | In `workspace-graph.test.ts` through `parsesInTree`.                                                        | MEDIUM, daemon-state |
| G3  | `packages/daemon/src/selection/specifier-edges.ts` `observedParse`      | A parse is reported only once it has returned, so a process the parser ends leaves the record empty and the reason says the file is not known. Mutation: move `scan.observer?.parsing(rootLabel(scan, file));` from before the `try` to after `read()` returns. `parsesInTree` records only the order of observer calls, so only a real crash (D2239's fixture) or a test that reads the observer's state at the moment the parser is called can see it. | In `executor.test.ts` beside D2239, or in process with the parse call observed.                             | MEDIUM, daemon-state |
| G4  | `packages/daemon/src/daemon/executor.ts` `buildDependencies`            | A parse record that cannot be created (a state directory that does not exist) makes `buildDependencies` reject with the raw file-system error rather than answer `{ ended: false, reason }` naming `NO_PARSE_RECORD_REASON`, and no process should be forked. Mutation: remove the `try`/`catch` around `createParseRecord(stateDirectory)`, leaving `const parseRecord = createParseRecord(stateDirectory);`.                                           | In `executor.test.ts`, with a state directory that does not exist.                                          | MEDIUM, daemon-state |
| G5  | `packages/daemon/src/daemon/executor.ts` `abort`                        | A stop marks the build stopped but ends its process only once `EXECUTOR_BOUND_MS` has passed, so the reason reads as a stop while AC4's "without waiting out the bound" is broken. D2244 and D2245 assert only the reason text, so neither pins the time. Mutation: `endProcessTree(child);` inside the build branch becomes `setTimeout(() => endProcessTree(child), EXECUTOR_BOUND_MS);`.                                                              | In `executor.test.ts` through `stoppedMidBuild`, asserting the stop settles well under `EXECUTOR_BOUND_MS`. | LOW, daemon-state    |
| G6  | `packages/daemon/src/daemon/executor.ts` `#removeRecord`                | A parse record that cannot be removed fails a build that finished, rather than being logged. Mutation: the `catch` in `#removeRecord` rethrows. Reach unknown: `rmSync` with `force` throws only on errors such as EPERM or EBUSY, so a test may need `removeParseRecord` replaced; record it as deliberately untested with that reason if no honest fixture reaches it.                                                                                 | In `executor.test.ts`.                                                                                      | LOW, daemon-state    |

Denominator: 27 named-defect tests (D2220 to D2246) in the touched test files, against the behaviors AC1 to AC5 name; the six rows above are the behaviors with no named test of their own.

### Completion Notes

**Built.** `buildSelectionInput(discovery, consumerRoot, declaration)` in `selection/selection-input.ts` answers `{ built: true, input }` (a `DiscoveredSelectionInput`, `Omit<SelectionInput, "change" | "dependencies">`) or `{ built: false, reason }`. `Executor.buildDependencies(consumerRoot, workspaces, stateDirectory)` runs the build as a `build-dependencies` job and answers `JobOutcome<DependencyInformation>`. `daemon/parse-record.ts` holds the record's one format: `createParseRecord` (a `dependency-build-<uuid>.parsing` file created empty with `wx` before the fork), `openParseRecord` (the child's synchronous writer: truncate, then `writeSync` at 0; cleared after each parse), `parsingLabel` (the daemon's reader: `undefined` when absent, empty or unreadable) and `removeParseRecord` (in a `finally` after the job settles, so after the tree and the process have ended). `executor-main.ts` loads `workspace-graph.js` by dynamic `import()` in the build branch alone. The parse observer (`ParseObserver`, with `parsing(label)` and `parsed()`) rides on `Scan`, and `observedParse` in `specifier-edges.ts` brackets every parse the build makes.

**U1**: resolved above the task list: CONFIRMED at 100,000 terms on every gate platform, not at 45,000. No re-plan.

**JSON check (task 3)**: `DependencyInformation` holds `PackageWorkspace` (`path`, `directory`), `UnreadWorkspaceSource` (strings), string arrays, `DependencyEdge` and `DependencyUncertainty` (strings); `SelectableWorkspace` holds `VitestWorkspace`, `WorkspaceTests` (a boolean with a string or `TestIdentity[]`; `TestIdentity` is strings, a string array and a number, `packages/core/src/test-identity.ts`), string arrays and `ReportedAlias` (strings and a boolean). No `Map`, `Set`, class or optional field, so `fork`'s default JSON channel carries both unchanged; the smoke run's deep equality confirms it.

**Delegation.** Task 2 went to one implementer agent (partition impl-daemon-selection-input, file-disjoint from the executor group); tasks 3 to 6 ran in the main loop as one typecheck-atomic unit, since a new request variant breaks `runJob`'s two-way branch until `executor-main.ts` answers it.

**Beyond the ticket's file list**, each claimed under t2-3e:

- `daemon/parse-record.ts` (new): the record's writer and reader share one format in one module, which the child and the daemon both import.
- `inputs/protection.ts`: `ROOT_WORKSPACE` is exported, so `selection-input.ts` names the root workspace with the same text rather than a copy. The declaration line only; the two `defects.json` records anchored on line 89's expression are untouched.
- `selection/specifier-edges.ts` and `selection/tsconfig-edges.ts` (review F1): `Scan` carries the observer and `observedParse` brackets the two tsconfig parses as well as the source parse.

**Correction to task 4's text, from the adversarial review (F1).** Task 4 says `readSourceImports` is "the one call that reaches `oxc-parser`'s native `parseSync`". It is not: `readJsonc` (`jsonc.ts`) calls `parseGuarded`, and so `parseSync`, for every walked tsconfig (`addTsconfigEdges`) and every `extends` target. All three parse sites are now bracketed, and the smoke run names `packages/b/tsconfig.json` for a tsconfig crash. The task text is left as authored, since this surfaced at Step 7.

**Adversarial review (08:20), 6 findings.**

- F1 (MEDIUM, tsconfig parses not recorded): fixed, above.
- F3 (MEDIUM, `close()` mid-build reported as a crash naming a file): fixed. `close()` stops a build in progress through `abort()`, so it ends at once with the stop's reason.
- Discarded F2 (a failed record write fails the build): a write error throws out of the build, which answers `job-failed` with the error, loud and retried at the next input change (Q2), and a failed build widens rather than narrows. A writer that went on after a failed clear could leave the label of a file that parsed, which is the misattribution the ticket review's F3 forbids.
- Discarded F4 (the reason omits the error texts): AC1 asks for a reason naming what failed; it names the failed module paths, or that collection raised an unhandled error, and the errors stay in the discovery record. An unbounded stack in every selection reason is not wanted.
- Discarded F5 (an empty record and an unreadable one read alike): AC5 words both as "the file is not known", and "if any" covers a crash outside a parse.
- F6 (LOW, the root-workspace naming ternary is written twice): a change-request candidate, below.

**Acceptance evidence** (Windows x64, Node 24.19.0, 08:23): `_agent-docs/.scratch/2-3e/smoke.ts`, a one-off script run from source, over a two-workspace fixture with 400 extra source files:

- AC3: the child's answer deep-equals `buildDependencyInformation(findPackageWorkspaces(root), [])` in process; a 100,000-term `crash.ts` settles `the executor process <pid> exited during the job (exit code 3221225725) while parsing packages/b/src/crash.ts`, and the asking process carries on.
- AC4: `abort()` 700 ms in settles at about 900 ms with `the dependency build was stopped, so its executor process was ended before the build finished (process <pid>)`; `close()` 700 ms in settles the same way.
- AC5: the crash reasons above name `packages/b/src/crash.ts` and `packages/b/tsconfig.json`; no record remained in the state directory after any of the five builds. The not-known wording is traced: `parsingLabel` answers `undefined` for an absent, empty or unreadable record, and `#exitReason` then appends `PARSED_FILE_NOT_KNOWN`.
- AC1, AC2: traced in `buildSelectionInput`: each of the four statuses maps as AC1 lists; `failedModules` or `unhandledErrors` make the tests not known with a reason; `vitestListingNotRead` is `discovery.notRead`; `protection(discovery, consumerRoot)` fills the non-inputs; no discovery, or a discovered workspace with `selectionFacts.reported` false, answers `built: false`, naming that workspace.
- Linux: not run for AC3 to AC5; U1 shows the crash there ends the child with `SIGSEGV`.

**A label outside the root.** `rootLabel` climbs with `..` for an `extends` target outside the consumer root, and on Windows gives an absolute path for one on another drive, as every other cause the build writes does. Walked sources and tsconfigs lie inside a listed workspace, which is inside the root.

**Change-request candidates** (for review-changes):

- F6: one helper for naming a workspace in a reason. `selection-input.ts` `workspaceName` and `protection.ts`'s inline `entry.workspace.path === ROOT_PATH ? ROOT_WORKSPACE : entry.workspace.path` answer the same question. Export `workspaceName` from beside `ROOT_WORKSPACE` and call it in both; the protection line is the `old` anchor of two records in `packages/daemon/test/defects.json`, so its re-anchor belongs to the tests session.

**README**: no change; nothing user-visible changes until 2.3g.

### File List

- _agent-docs/tickets/2-3e-dependency-build.md (created by create-ticket; dev: checkboxes, U1 resolution, Dev Agent Record)
- packages/daemon/src/selection/selection-input.ts (new)
- packages/daemon/src/daemon/parse-record.ts (new)
- packages/daemon/src/selection/workspace-graph.ts
- packages/daemon/src/selection/specifier-edges.ts
- packages/daemon/src/selection/tsconfig-edges.ts
- packages/daemon/src/daemon/executor-jobs.ts
- packages/daemon/src/daemon/executor-main.ts
- packages/daemon/src/daemon/executor.ts
- packages/daemon/src/inputs/protection.ts
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3d's caller, § Ticket 2.3e rewritten, § Ticket 2.3g added, § Ticket 2.3f's build order and Q4 clause, and the split note, under the orchestrator's 05:45 grant)

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

- [ ] AC1: From the discovery in effect, the consumer root and the consumer's non-inputs declaration, RT Test builds everything `SelectionInput` holds except the change and the dependency information, and a selection over it explains and counts the workspaces as discovery found them:
  - a discovered workspace is selectable, with its discovered tests and, as discovery reports them, every setup file, global setup file and alias of any of its projects;
  - its tests are not known, with a reason naming what failed, when discovery reports a module of it that failed to collect or an unhandled error during its collection; a browser-mode project of it leaves its tests known;
  - a workspace whose config failed to load is selectable with its tests not known, its load error the reason;
  - an unsupported workspace and a not-confirmed workspace are not runnable, each with its reason;
  - the Vitest listing's unread sources are the discovery's;
  - the non-inputs hold the declaration and the protection `protection` builds over that same discovery.
- [ ] AC2: With no discovery in effect, or one that lists a discovered workspace whose selection facts it does not report, no selection input is built, and the answer says why, naming that workspace.
- [ ] AC3: The dependency information for a selection input is built in a child process of its own that ends with the build. The build answers exactly what `buildDependencyInformation` answers in process over the same consumer root and the selectable workspaces of AC1's input. A consumer file that ends its process inside the source parser fails that build with a reason naming how the process exited, and the process that asked for it keeps running.
- [ ] AC4: A stop during a build ends the build's process and every process it started without waiting out the bound a Vitest job is given, and the build ends with no dependency information and a reason.
- [ ] AC5: The reason for a build whose process ended inside the parser (AC3) also names the root-relative path of the file it was parsing. When that file cannot be told, because no record of it was written or the record cannot be read, the reason names the exit and says the file is not known. To tell it, a build writes only inside the daemon's state directory its caller names, and only root-relative paths, never file content. No build reads a record an earlier build left, and a build's record is gone once the daemon has seen the build end; a daemon that itself ends during a build leaves that one record behind, which no later build reads.

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

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve U1 first and write its answer, with the command and output, beneath the table. Before the first edit, confirm nothing has moved in this ticket's files since the 08:07 re-verify against 2.3d's landed code (§ Pending siblings and their routing): `SelectableWorkspace.aliases` is `readonly ReportedAlias[]`, and `ResolvedAlias` no longer exists.
- [ ] (AC1, AC2) Create `packages/daemon/src/selection/selection-input.ts`, exporting one function that takes the discovery in effect (`TestDiscovery | undefined`), the consumer root's real path and the `NonInputsDeclaration`, and answers either the selection input without its change and dependency information (a type derived from `SelectionInput` with `Omit`, C14) or why none can be built (AC2). Map each `WorkspaceDiscovery` by its status as AC1 lists, and take the Vitest listing's unread sources from the discovery's `notRead`. A browser-mode project leaves its workspace's tests known and contributes no setup file or alias, since discovery reports none for it (§ Design notes, "Browser-mode projects"). For a discovered workspace, union its projects' `setupFiles`, `globalSetupFiles` and `aliases` in project order without repeats, and take `tests` from its `DiscoveredTest`s; a non-empty `failedModules` or `unhandledErrors` makes them not known, with a reason naming the failed module paths or that collection raised an unhandled error. Build `nonInputs.protection` with `protection(discovery, consumerRoot)`, the one producer (2.3c). Name each reason text as a constant (C3).
- [ ] (AC3, AC5) In `packages/daemon/src/daemon/executor-jobs.ts`, add a request carrying the consumer root, the selectable workspaces and the absolute path of this build's parse record, and a reply carrying the `DependencyInformation`. Confirm, by reading `DependencyInformation`, `SelectableWorkspace` and the types they hold (`TestIdentity` in `@rt-test/core` among them), that every field of both is plain JSON (no `Map`, `Set`, class instance or `undefined`-valued field), which the executor's channel carries unchanged, and record what you read; if one is not, convert it at the channel and back, so AC3's equality holds.
- [ ] (AC5) In `packages/daemon/src/selection/workspace-graph.ts`, let `buildDependencyInformation` take an optional observer that `addSourceFileEdges` calls with the file's root label (`rootLabel(scan, file)`, already computed there) immediately before `readSourceImports`, and again with no label once it returns, so the record is empty whenever no parse is in progress; `readSourceImports` is the one call that reaches `oxc-parser`'s native `parseSync` (`rg -n "parseSync|readSourceImports\(" packages/daemon/src`, 05:50). An in-process caller passes none, and the build is otherwise unchanged (P19: an observer, not a mode flag).
- [ ] (AC3, AC5) In `packages/daemon/src/daemon/executor-main.ts`, answer that request with `buildDependencyInformation(findPackageWorkspaces(consumerRoot), workspaces, observer)`, whose observer writes the label to the parse record synchronously (`fs.writeSync` on a descriptor opened once per build), replacing what the record held, so the last label written survives a native abort that drops any queued asynchronous write. A throw answers `job-failed`, as today. Loading `workspace-graph.js` with a dynamic `import()` inside that branch keeps `oxc-parser`'s native binding out of every discovery and run process; dev decides.
- [ ] (AC3, AC4, AC5) In `packages/daemon/src/daemon/executor.ts`, add a method that takes the consumer root as discovery was given it (`ConfirmedStart.consumerRoot`, not its real path; § Design notes, "Two spellings of the root"), the selectable workspaces and the state directory, runs the build as one job and answers a `JobOutcome<DependencyInformation>`, through the fork, containment and replaced-child guards every job already has (C157). Name the build's parse record uniquely inside the state directory across daemon lives and across worktrees sharing the directory (a random component, not only a pid or a counter), and create it empty with an exclusive create before the build's process starts, so no build can read another's (AC5), even when its process exits before its first write. An exit during the build settles the job with `the executor process <pid> exited during the job (<exit>)`; for a build, add the record's label to that reason, or say the file is not known when the record is absent, empty or unreadable, each added text a named constant (C3). Remove the record once the build has ended, whatever its outcome. On `abort()` during a build, end the process tree at once rather than after `EXECUTOR_BOUND_MS`, and settle the job with a reason naming the stop, never the exit reason a crash gets (AC4, C131): the build's work is synchronous, so the child cannot read the abort message until it ends, and it writes nothing but its record. Correct the class doc comment, which says it hosts Vitest (C46), and extend `failureReason`'s other-kind message if it no longer reads true.
- [ ] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files, and `bun run --filter @rt-test/daemon typecheck`.

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

- _agent-docs/tickets/2-3e-dependency-build.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3d's caller, § Ticket 2.3e rewritten, § Ticket 2.3g added, § Ticket 2.3f's build order and Q4 clause, and the split note, under the orchestrator's 05:45 grant)

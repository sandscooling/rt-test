# Ticket 2.3g: Narrow each workspace's fingerprint

## Ticket

As an agent editing one workspace of a multi-workspace consumer,
I want each Vitest workspace's results to go stale only when an input its selection reads changes,
so that an edit leaves every other workspace's results current, while staleness and selection never disagree, and the answer says whenever it cannot narrow.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: Once dependency information has been built over the discovery an answer reads, from the inputs at the current input revision, each discovered workspace's fingerprint covers exactly the inputs whose selection includes it (a change of that one path, as `selectTests` decides it over that dependency information and ticket 2.3e's selection input), and every test module that discovery lists for it, whatever git ignores. Once the build at the edit's input revision has finished, an edit to an input no selection of a workspace includes has left that workspace's results as current as they were, and an edit to one that does has made them stale; until then AC3 holds.
- [ ] AC2: The daemon builds the dependency information over the discovery in effect, and a consumer file that ends the build's process leaves the daemon answering, with AC4's reason naming that file (2.3e AC3, AC5). It builds over the stored discovery once the first reconciliation has ended, over each new discovery once it is stored, and again after each change of the input revision, whenever that discovery yields a selection input (AC4). Dependency information is used only for the revision whose inputs it was built from: a build during which an input changed, or an event named one, is followed by another and never used.
- [ ] AC3: While the discovery an answer reads yields a selection input and no build over it has ended, finished or failed, at the current input revision, each discovered workspace has no fingerprint, so its results read unknown, and the answer names that build as the reason. A run's fingerprint is not taken until that build has finished or failed.
- [ ] AC4: A build that fails, and a discovery that yields no selection input (ticket 2.3e AC2), leave each discovered workspace's fingerprint over every input of the project and its own test modules, as before this ticket. The log names why, at warning level, and every answer carries the reason as an input fact beside `nonInputsUnusable`, in `--json` and in the CLI's text, until a later build succeeds. Only the next change of the input revision or a new discovery starts another build: never a timer, and never a retry of the same revision.
- [ ] AC5: A stop ends a build in progress without waiting for it, releases every run waiting for a build, and no build starts after a stop.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. The child process, the parser and the executor channel are ticket 2.3e's.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read ticket 2.3e's landed code (`selection/selection-input.ts`, the build method on `Executor`) and change request #26's changes to `selection/vitest-edges.ts`, and confirm the names this ticket uses (§ Pending siblings and their routing). `input-tracker.ts` holds about 495 code lines (2.3c § Completion Notes): extract before adding to it (P16).
- [ ] (AC1) Create `packages/daemon/src/inputs/narrowed-inputs.ts`: from the project's inputs at one revision, 2.3e's selection input and the dependency information, compute once which inputs each discovered workspace's selection includes, by one `selectTests` call whose change is every input path and whose per-path reports (`paths[].selected`) name the workspaces each path selects. Answer, per workspace path, a `ProjectInputs` over those inputs, whose digest is computed once. Reusing `selectTests` keeps one decision for staleness and selection (C8); declare no second per-path rule.
- [ ] (AC1) In `packages/daemon/src/inputs/fingerprint.ts`, give the seam `workspaceInputs` its narrowing: the workspace's narrowed inputs when a narrowing is given, every input of the project otherwise (AC4). Keep its invariant that every test module the discovery lists for the workspace is among its inputs, and take a listed module the project's inputs hold from the snapshot rather than reading it again, since the narrowed set may leave it out. Rewrite the seam's doc comment, which says narrowing "replaces this body" (C46).
- [ ] (AC1, AC3, AC4) In `packages/daemon/src/inputs/current-inputs.ts` and `packages/daemon/src/inputs/input-tracker.ts`, let a query's view of the inputs take the narrowing state for the discovery it reads, reading a narrowing as narrowed only when its build's `discoveryId` is that discovery's and its revision is the moment's revision, and as building otherwise (AC2): narrowed (AC1), building (no workspace fingerprint, the reason naming the build: AC3), or not narrowed with a reason (AC4), and expose the reason AC4's input fact carries, which the building state keeps while the last build over that discovery failed, since AC4 keeps the fact until a later build succeeds. The discovery fingerprint keeps covering every input of the project, so it stays computable while a build runs: AC3's state is a per-workspace fingerprint failure, listed in `unfingerprintedWorkspaces` with the build as its reason, never the view's `unavailable`, which would also void the discovery's fingerprint. Rewrite `unfingerprintedWorkspaces`' doc comment in `answer.ts` ("Only those whose own inputs failed"), which the building state no longer fits (C46). Whatever carries the narrowing, a tracker given none answers as today, since `input-tracker.test.ts` fingerprints through `tracker.current()` with no build in play.
- [ ] (AC2, AC3, AC5) Create `packages/daemon/src/daemon/dependency-builds.ts`, owned by the lifecycle: it holds the discovery in effect (its `discoveryId`), 2.3e's selection input for it, and the latest build's revision and outcome. At each build it builds 2.3e's selection input from the discovery, the consumer root's real path and the `NonInputsDeclaration` in effect then (the tracker's, not a second read of `rt-test.json`), and passes the build `ConfirmedStart.consumerRoot` as discovery was given it (2.3e § Design notes, "Two spellings of the root"). A build still running when the revision moves runs to its end and is discarded by its verdict, never aborted, since 2.3e gives an abort a stop's reason, which must never read as AC4's failure. It starts a build when the discovery in effect changes or the input revision moves past the last build's, while that discovery yields a selection input, one at a time, never retrying a revision it has built or failed. A build begins once the tracker has settled, opens a job mark with `beginJob` and closes it with `endJob`; a verdict other than fingerprinted discards the build and starts another at the revision current once the tracker settles, whether or not it differs from the discarded build's (AC2). It resolves a wait once the build for the current revision has finished or failed (AC3), and on stop aborts its executor, resolves every pending wait without a build, and starts nothing more (AC5). Learning that the revision moved needs a signal from the tracker; add the smallest one (C160: read the revision where the build begins).
- [ ] (AC2, AC3, AC5) In `packages/daemon/src/daemon/lifecycle.ts`, hand the dependency builds the stored discovery after the first reconciliation (`#protectStoredDiscovery` reads it) and each new discovery once `writeDiscovery` has stored it, with the `discoveryId` it returns; in `#run`, wait for the build at the settled revision in this order: await the builds' wait, then `settled()`, and go round again while the revision settled at has no ended build; then open `beginJob` and take `started` with no await between them, as today (AC3, C160); in `#stopSequence`, stop the builds and close their executor beside the run executor (AC5).
- [ ] (AC2) In `packages/daemon/src/daemon/daemon-main.ts`, construct a second `Executor` for builds, so a build never waits behind a run, and pass the state directory (`directory`) the tracker already excludes from the inputs.
- [ ] (AC4) In `packages/daemon/src/query/answer.ts`, add an optional input fact beside `nonInputsUnusable`, documented like it, carrying its kind (a failed build, or a discovery that yields no selection input), each kind an exported constant, and its reason; ticket 2.3i takes those kinds from this fact rather than declaring a second enumeration (2.3i's `answer.ts` task, C14); set it in `query/summary.ts` `queryBasis` from the view of the inputs; render it in `packages/cli/src/answer-text.ts` as a warning line, as `nonInputsUnusable` is. An optional field is not a breaking change (C151), as `nonInputsUnusable` was added. Log the reason at warning level once per failed build and once per discovery that yields no selection input (C32).
- [ ] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files, `bun run --filter @rt-test/daemon typecheck` and `bun run --filter rt-test typecheck`, which also report each test stand-in the shape changes break (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `selectTests(input)` (`selection/select-tests.ts`): its per-path reports decide which workspaces each input path selects; AC1's narrowing is that decision (C8).
- Ticket 2.3e's selection-input builder (`selection/selection-input.ts`) and `Executor`'s dependency-build method: the input and the build, with the build's parse record in the state directory.
- `ProjectInputs` (`inputs/fingerprint.ts`): a set of input digests whose digest is computed once; the narrowed sets are instances of it.
- `workspaceInputs`, `unselectedModuleDigests`, `SnapshotReads` (`inputs/fingerprint.ts`): the seam ticket 2.1 left for this narrowing, and the reads of listed test modules the inputs leave out.
- `TrackedInputs.beginJob`, `endJob`, `settled` (`inputs/input-tracker.ts`): a build is judged as a run is, so a build during which an input moved is never used (AC2).
- `currentInputs`, `InputsMoment`, `unavailableReason` (`inputs/current-inputs.ts`): a query's view of the inputs at one moment.
- `nonInputsUnusable` in `QueryContext` (`query/answer.ts`), `queryBasis` (`query/summary.ts`) and `answer-text.ts`'s warning line: the pattern AC4's input fact follows.
- `UnfingerprintedWorkspace` and `unfingerprintedWorkspaces` (`query/answer.ts`, `query/summary.ts`): where a workspace's missing fingerprint and its reason already reach every answer (AC3).

### Must Create

- `inputs/narrowed-inputs.ts`: each discovered workspace's narrowed inputs (AC1).
- `daemon/dependency-builds.ts`: the per-revision build state the lifecycle owns (AC2, AC3, AC5).
- AC4's input fact in `answer.ts`, its producer in `summary.ts`, and its line in `answer-text.ts`.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The second of the two tickets the unsplit 2.3e became (orchestrator ruling Q5, 2026-09-28 05:45); ticket 2.3e builds selection's input and the isolated dependency build, and this ticket is their first production caller. Ticket 2.3f builds after it and schedules selections over the same dependency information. Build order: 2.3d, 2.3e, 2.3g, 2.3f.

Requirements this ticket serves (`docs/requirements.md`):

- "FR6: Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current." (AC1, AC3, AC4)
- "NFR3: Never report a result as current unless its stored input fingerprint matches the current inputs." (AC1, AC2, AC3)

Sprint scope, quoted: "this ticket narrows each workspace's fingerprint to the inputs whose selection includes it, from the same dependency information its selection uses, so staleness and selection never disagree, and each workspace's narrowed inputs always include its own test modules (ticket 2.1 AC11; orchestrator, 2026-09-27 10:44)."

Rule clauses the criteria rest on:

- AGENTS.md § Product guarantees: "Never report historical results as current after a relevant edit or unresolved input change." (AC1, AC2, AC3)
- AGENTS.md § Product guarantees: "Widen selection when dependency information is uncertain." (AC4)
- AGENTS.md § Product guarantees: "Explain each selection and each broad fallback." (AC3, AC4)
- Ticket 2.1 AC11: "A Vitest workspace's inputs always include each of its own test modules, whatever narrowing replaces the whole-project input set." (AC1)
- `docs/architecture.md`: "An unknown input set cannot yield a current pass." (AC3)

Glossary (`docs/glossary.md`), verbatim:

- **Input fingerprint**: "A digest of every input, the environment, and the runtime and tool versions that can change a test's result."
- **Selection**: "The tests a change requires running, each with its reason."
- **Widening**: "Adding tests to a selection because a dependency is uncertain."
- **Broad fallback**: "A widening to a whole workspace or project, named with the input that triggered it."

#### Orchestrator rulings

Asked by `session_wake` at 05:43 on 2026-09-28, answered at 05:45; decider the orchestrator, holding the owner's calls overnight.

- Q1 (AC3): while the current revision's build is unfinished, a workspace has no fingerprint and its results read unknown, with a reason naming the build; a job waits for the build, as it waits for unread events. Reason: narrowing from an older build rests on an unproven property, and a wrong narrowing is false freshness; a few seconds of unknown costs nothing the product promises.
- Q2 (AC4): a failed build widens every workspace to the whole project's inputs, the log names why, and the next input change or discovery retries it, never a timer or a loop; every answer carries the reason as an input fact beside `nonInputsUnusable`. Reason: a widened state must not read like a narrowed one.
- Q3 (AC4, through 2.3e AC2): a discovery without selection facts builds no dependency information, and every workspace widens to the whole project.
- Q4: a job stays stored not fingerprinted when any input changes while it runs, whether or not the input is in its workspace's narrowed set; ticket 2.3f decides that. This ticket keeps `JobWindows` as it is. Since the orchestrator's 06:10 split of 2.3f, ticket 2.3h owns that decision (2.3h Q1).
- Q5, sizing: this ticket carries Q1, Q2 with the answer fact, and the per-revision build; recount once drafted, and ask again past 22 estimated files or 15 code units.
- Q6 (ticket 2.3e AC5, 05:50): a parser crash's reason names the file through a record in the daemon's state directory; this ticket passes that directory, which the tracker already excludes from the inputs (`daemon-main.ts`: `exclusions: [directory, log.file]`), so the record's writes mark no job and move no revision.

- Sizing (05:58): proceed as-is at about 18 raw files and 23 estimated (§ Sizing).
- Ticket review (create-ticket 6c, 05:58 to 06:01): 15 findings, 14 applied. F1 and F2 reconciled AC1 and AC4 with AC3 (unknown until the edit's build ends; no "building" state over a failed build or a discovery without a selection input). F3 starts no build without a selection input. F4 keeps AC4's reason through the next build. F5 makes a query use a narrowing only at its own revision and `discoveryId`. F6 and F7 gave AC5's release of waiting runs and AC4's second log cause their tasks. F8 names the root and declaration 2.3e's calls take. F10 rebuilds at the settled revision, so a build discarded with the revision unmoved never stalls. F13 widened the broken-tests method to behavior. F15 restated AC2 as its outcome. Three questions were settled by fact: F9, the declaration, which is taken at each build, since the tracker's declaration in effect changes the inputs only by moving the revision; F11, a build the revision overtakes, which runs to its end and is discarded, since an abort would carry a stop's reason; F12, the wait's place in `#run`, named in the lifecycle task. F14 was rejected: the 05:58 sizing already counts the extraction.

#### Design notes

- **Why one `selectTests` call.** The sprint promises that staleness and selection never disagree, so the narrowing is selection's own per-path decision, not a second rule beside it (C8). One call with every input path as the change builds the selection context once, and its walk cache (`walks`) serves every path of one workspace. Each `ChangedPathReport` names what one path alone selects: `selected` lists the runnable workspaces it reaches, and discovered workspaces are runnable. Selection explains per path, which is also how 2.6's `changes` query will scope a path.
- **A path the narrowing leaves out.** A path whose selection includes no workspace, such as one in a package workspace nothing depends on, is in no workspace's inputs, so its edit stales nothing, and selection selects nothing for it; the two agree by construction. A declared non-input is in no workspace's inputs, as today, since it is not an input.
- **Why a build is a job.** A build reads the consumer's files from disk while the tracker reads them too. `beginJob` and `endJob` already decide whether any input changed or an event named one between two moments, including an edit and its revert, so a build that ends fingerprinted describes exactly the revision it began at (AC2). A build is not a job of the lifecycle's activity or its unstored list.
- **Why a second executor.** One `Executor` takes one job at a time (`#child`, `#settle`). A run can take minutes; a build must finish between edits for any answer to read current (AC3), so it cannot wait behind one.
- **No selection input, no build.** A discovery that yields no selection input (2.3e AC2) has nothing to build over, and a change of the input revision cannot give it the facts it lacks, so only a new discovery ends that state; AC4's retry on a revision change applies to a failed build.
- **Scenarios walked in the grill (05:58).** An edit in workspace A that adds an import of package B stales A through the edited file, which A's own selection includes, and the next build adds B's inputs to A's set. A new file in B lies in B's set through its owner. A root-owned file, a lockfile or a `package.json` selects every workspace, so it lies in every set. `pathReport` (`select-tests.ts`) lists in `selected` every runnable workspace a path's reasons reach, the project-wide fallbacks included, and a not-runnable one only in `notRunnable`; every discovered workspace is runnable (2.3e AC1).
- **Waiting and edits.** An edit stream that never pauses keeps every build discarded, and every workspace unknown, until it pauses; that is the same as today's "changed paths have not been read yet" while events keep arriving (Q1).
- **Results stored before this ticket.** A run stored under the whole-project fingerprint reads stale once its workspace narrows, unless its narrowed set is every input; a narrowed digest equals a whole-project one only over the same inputs, so the comparison stays sound in both directions (C113).
- **Scope of the analysis.** Analyzed: when the dependency information is current (its revision and its discovery), what a workspace's fingerprint covers in each build state, and the stop. Not analyzed here: whether a job's change window narrows (Q4, now 2.3h's), scheduling selections and reruns (2.3f), and the cost of building per revision on a large consumer, which is a target to measure in 2.5's corpus, not a promise.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3g` over this ticket's ten production files (05:57) named 2.3d (reads `fingerprint.ts` and `input-tracker.ts`, writes neither), 2.3e (names this ticket's files as 2.3g's) and 2.3f (writes `input-tracker.ts` and `lifecycle.ts` after this ticket).

Re-run at 08:07 over the same files, after main's 2.3d, item 11 and #28 merged into wt/1 (f40d2a1): it named 2.3e (names these files as 2.3g's), 2.3f (reads `dependency-builds.ts`, the build wait and the narrowing state; writes `lifecycle.ts`, `input-tracker.ts`, `daemon-main.ts` and `summary.ts` after this ticket), 2.3h (reads the narrowing state and the build wait; writes `input-tracker.ts`, `current-inputs.ts` and `lifecycle.ts` after this ticket) and 2.3i (writes `answer.ts`, `summary.ts` and `answer-text.ts` after this ticket). Each builds after this ticket, so each is a shape built on, never a collision.

- **2.3e** (done): the selection-input builder and the dependency-build method this ticket calls, the parse record in the state directory, and a stop that ends a build at once. They landed as `buildSelectionInput(discovery, consumerRoot, declaration)` (`selection/selection-input.ts`, answering `SelectionInputBuild`) and `Executor.buildDependencies(consumerRoot, workspaces, stateDirectory)` (answering `JobOutcome<DependencyInformation>`), with the record's helpers in `daemon/parse-record.ts`.
- **Change request #26** (built before this ticket): a root-relative alias replacement such as `"/src"` reaches its workspaces under its project's Vite root and on the file system, and a RegExp `find` not anchored at the import's start widens. It changes what `selectTests` selects through `vitest-edges.ts`, which this ticket only calls, so each narrowed set follows it with no change here; re-read its landed code before the first edit.
- **Change request #31** (queued before this ticket): an alias keeps the rest of an import, which can climb out of the replacement's directory with `..`, so prefix analysis misses that edge; the fix applies each workspace's aliases to the specifiers the source scan reads. Like #26 it changes only what `selectTests` selects, so each narrowed set follows it with no change here.
- **2.3d** (landed at fdb86de): `SelectableWorkspace.aliases` is `readonly SelectionAlias[]` (each alias with its project's absolute Vite root, from change request #26), `SELECTION_POLICY_VERSION` is 6, which the fingerprint already covers, and `namesDeclarationFile` (`non-inputs.ts`) decides the declaration file for `declaredNonInputs` and `projectWideKinds` alike, so the narrowing reads it through `selectTests` with no change here.
- **#28** (landed at ae1f4b0): `InputFilter` excludes `rt-test.json` itself unless a directory stands there, and the tracker's constructor no longer appends it to the exclusions (`this.#exclusions = exclusions;`). The state directory stays excluded through `daemon-main.ts`'s `exclusions: [directory, log.file]`, so Q6's record still marks no job. It moves no criterion here: a path under a directory named `rt-test.json` is an input whose selection raises the project-wide non-inputs-file trigger (`namesDeclarationFile`), so it lies in every workspace's set, and an event on it still asks the tracker for a reconciliation (`#changed`), which moves the revision when it changes an input.
- **Item 11** (landed at 1ba4836, test code only): it rewrote tests in `daemon.test.ts`, `input-tracker.test.ts` and `cli.test.ts`; D1914 and D1915 and the `current-inputs.ts` anchor in `test/defects.json` that § Existing tests this change breaks names still stand (08:07).
- **2.3f** (backlog, builds after this ticket): the scheduler, which waits for this ticket's build at the settled revision before any run and selects over this ticket's dependency information.
- **2.3h** (backlog, builds after 2.3f): judges and interrupts a run by its workspace's narrowed inputs at the start and end revisions, reading this ticket's narrowing state and build wait; it owns Q4.
- **2.3i** (backlog, builds after 2.3h): puts the schedule into every answer, taking the failed-build and no-selection-input kinds from this ticket's input fact.

#### Sizing

About 18 raw files and 23 estimated, counting the new module `input-tracker.ts`'s extraction needs; code units 6 (5 criteria plus validation). Orchestrator ruling, asked at 05:58 and answered at 05:58 on 2026-09-28, holding the owner's calls: proceed as-is, with dev delegating the three groups below in order, since the only split left (the answer fact alone) would land a widened state that reads like a narrowed one (Q2), and moving the builds into 2.3e would reopen a reviewed ticket; ask again only past 25 estimated or 15 code units. Production, 10: `inputs/narrowed-inputs.ts` (new), `inputs/fingerprint.ts`, `inputs/current-inputs.ts`, `inputs/input-tracker.ts`, `daemon/dependency-builds.ts` (new), `daemon/lifecycle.ts`, `daemon/daemon-main.ts`, `query/answer.ts`, `query/summary.ts`, `cli/src/answer-text.ts`; and the new module the extraction `input-tracker.ts` needs, counted in the 18. Tests, 7, for create-tests: `lifecycle.test.ts`, `query.test.ts`, `input-tracker.test.ts`, `daemon.test.ts` (a real daemon over a two-workspace consumer), `packages/cli/test/cli.test.ts`, and the two `defects.json` beside them. Over 10 estimated, so dev delegates, in three groups on disjoint files: the narrowing (`narrowed-inputs.ts`, `fingerprint.ts`, `current-inputs.ts`, `input-tracker.ts`), the builds (`dependency-builds.ts`, `lifecycle.ts`, `daemon-main.ts`), and the input fact (`answer.ts`, `summary.ts`, `answer-text.ts`), in that order, since each later group reads the one before.

#### Current structure of the modified files

As of wt/1 at 20eae03, re-verified at f40d2a1 (08:07): only `input-tracker.ts` changed among these files, its constructor now setting `this.#exclusions = exclusions;` (#28), which leaves its line count and everything below as described.

- `packages/daemon/src/inputs/fingerprint.ts`: `ProjectInputs { root, digests, digest() }`; `WorkspaceInputs { selected: ProjectInputs; testModules }`; `workspaceInputs(project, testModules)` returns `{ selected: project, testModules }`, documented as the seam whose narrowing "replaces this body"; `workspaceFingerprint(project, entry, reads)` and `discoveryFingerprint(project, discovery, reads)` digest `sharedParts()`, `inputs.selected.digest()`, `unselectedModuleDigests` and the Vitest version(s); `unselectedModuleDigests` reads each listed module `inputs.selected.digests` does not hold.
- `packages/daemon/src/inputs/current-inputs.ts`: `TrackerCondition`, `inputFacts`, `unavailableReason`, `InputsMoment { facts, unavailable, nonInputsUnusable, project }`, and `currentInputs(moment)`, which answers `CurrentInputs` with every fingerprint `none` while `unavailable`, and otherwise closures over one `ProjectInputs` and one `SnapshotReads`.
- `packages/daemon/src/inputs/input-tracker.ts`: `CurrentInputs { facts, unavailable?, nonInputsUnusable?, workspaceFingerprint(entry), discoveryFingerprint(discovery), protectedFileChangedSince(discovery, since) }`; `TrackedInputs { start, firstReconciled, current, settled, beginJob, endJob, protectInputs, stop }`; `InputTracker.current()` passes `this.#state.project()` to `currentInputs`. About 495 code lines.
- `packages/daemon/src/daemon/lifecycle.ts`: `LifecycleParts { identity, scope, start, store, log, executor, inputs, closeEndpoint }`; `begin` calls `#protectStoredDiscovery`, `inputs.start()` and `#startSequence`; `#startSequence` waits `firstReconciled` and `settled`, discovers, protects, stores the discovery (`writeDiscovery`), then `#run`s each confirmed workspace; `#run` waits `settled`, opens `beginJob`, takes `started = inputs.current().workspaceFingerprint(entry)`, runs, and binds the run through `unmoved(started, ended)`; `#stopSequence` aborts the executor, stops the tracker, awaits the sequence and closes the executor, the store and the endpoint. 357 lines.
- `packages/daemon/src/daemon/daemon-main.ts`: `serve` builds the `InputTracker` with `exclusions: [directory, log.file]` and the `DaemonLifecycle` with `executor: new Executor(log)`.
- `packages/daemon/src/query/answer.ts`: the answer context holds `unfingerprintedWorkspaces` ("Only those whose own inputs failed; `inputs` says when none can be computed") and the optional `nonInputsUnusable`.
- `packages/daemon/src/query/summary.ts`: `queryBasis` composes each discovered workspace's fingerprint once per answer (`workspaceFingerprints`), lists the failures in `unfingerprintedWorkspaces` while `inputs.unavailable` is undefined, and copies `nonInputsUnusable`; `path-status.ts` answers through the same `queryBasis`.
- `packages/cli/src/answer-text.ts`: prints `Warning: <first line of nonInputsUnusable>` after the input lines, then the unfingerprinted workspaces.

#### Existing tests this change breaks

- `packages/daemon/test/lifecycle.test.ts`: `StandInInputs implements TrackedInputs` and its `current()` build `CurrentInputs` by hand, and three tests construct `DaemonLifecycle` with `LifecycleParts`; both shapes gain what the builds need.
- `packages/daemon/test/query.test.ts`: the `UNSETTLED` stand-in and the `CurrentInputs` factory near line 86 build the view by hand.
- `packages/daemon/test/input-tracker.test.ts`: fingerprints through `tracker.current().workspaceFingerprint(entry)` and calls `workspaceFingerprint(project, entry)` directly (D1914, D1915); these break only if those signatures change, and keep today's whole-project answer when no narrowing is given.
- `packages/daemon/test/defects.json`: a record anchored in `current-inputs.ts` (`    facts,\n    ...declaration,\n    workspaceFingerprint: (entry) =>`) loses its anchor if that object changes.
- Found by `rg -n "workspaceFingerprint|CurrentInputs|TrackedInputs|LifecycleParts|new Executor|DaemonLifecycle|currentInputs\(" packages/daemon/test` (05:43). The typecheck reports any shape it missed (P14). That search finds shapes only, in `packages/daemon/test` only; the behavior changes too (an edit reads unknown until its build ends, AC3; a run waits for a build), so any test in `packages/daemon/test` or `packages/cli/test` that expects `stale` straight after an edit, or a current result with no build in play, breaks without a type error.

#### Doc text

A draft for the orchestrator, final wording to follow the build.

- `docs/architecture.md`, the input tracker paragraph: "Every workspace covers the whole project's inputs until selection narrows it." becomes "Each discovered workspace's inputs are the inputs whose selection, by `selectTests` over the dependency information built at the current input revision, includes it, and every test module the discovery lists for it. The daemon builds that information in its own executor process over the discovery in effect, after the first reconciliation, after each new discovery and after each change of the input revision; a build during which an input changed is discarded and followed by another. While the current revision's build is unfinished, no workspace has a fingerprint and the answer names the build. A build that fails, or a discovery that does not report every discovered workspace's selection facts, leaves every workspace over the whole project's inputs, the log and every answer say why, and only the next change of the input revision or a new discovery builds again."
- The paragraph ending "so selection has no production caller": "The daemon does not build either yet" becomes "The daemon builds both to narrow each workspace's inputs; it does not yet select or run tests from them."
- `README.md`: a user-visible change; the sentence that says an edit stales every workspace's results, if any, becomes that an edit stales the results of the workspaces whose selection it reaches. Dev confirms the sentence.

#### Previous ticket

2.3e (authored in this lane, 05:43 to 05:57), the nearest earlier key: it builds selection's input from the discovery in effect (a failed workspace selectable with tests not known, a failed module or unhandled collection error making tests not known, unsupported and not-confirmed not runnable, no input for a discovery without selection facts), and runs `buildDependencyInformation` as a job of `Executor` in a child process of its own, whose crash names the file being parsed from a record in the state directory, and whose abort ends it at once. From 2.1 (done): the seam `workspaceInputs`, AC11's test-module invariant, and the job fingerprint check (`beginJob`, `endJob`, `unmoved`). From 2.3c (done): `input-tracker.ts` holds about 495 code lines, so an addition there needs an extraction first; one protection producer. `git log --oneline -20` (05:45) shows no code commit since 2.3c's a3ca5bc outside the defect verifier.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3e, § Ticket 2.3g, § Ticket 2.3f, § Ticket 2.3h, § Ticket 2.3i.
- Ticket 2.1 (`_agent-docs/tickets/2-1-track-inputs.md`) Q3, AC2, AC11 and § What 2.3 inherits.
- Ticket 2.3e (`_agent-docs/tickets/2-3e-dependency-build.md`).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (05:42).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C8,C11,C12,C14,C30,C32,C38,C39,C40,C46,C48,C55,C59,C113,C114,C115,C126,C129,C151,C157,C160 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P18,P19,P21,P41 -->

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
sizing_ac_count: 6
files_to_modify:
  - packages/daemon/src/inputs/fingerprint.ts
  - packages/daemon/src/inputs/current-inputs.ts
  - packages/daemon/src/inputs/input-tracker.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/daemon-main.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/query/summary.ts
  - packages/cli/src/answer-text.ts
files_to_create:
  - packages/daemon/src/inputs/narrowed-inputs.ts
  - packages/daemon/src/daemon/dependency-builds.ts
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

- _agent-docs/tickets/2-3g-narrow-fingerprints.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3g added and linked, under the orchestrator's 05:45 grant)

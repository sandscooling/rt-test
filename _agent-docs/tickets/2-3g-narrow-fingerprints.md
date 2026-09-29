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

- [x] AC1: Once dependency information has been built over the discovery an answer reads, from the inputs at the current input revision, each discovered workspace's fingerprint covers exactly the inputs whose selection includes it (a change of that one path, as `selectTests` decides it over that dependency information and ticket 2.3e's selection input), and every test module that discovery lists for it, whatever git ignores. Once the build at the edit's input revision has finished, an edit to an input no selection of a workspace includes has left that workspace's results as current as they were, and an edit to one that does has made them stale; until then AC3 holds.
- [x] AC2: The daemon builds the dependency information over the discovery in effect, and a consumer file that ends the build's process leaves the daemon answering, with AC4's reason naming that file (2.3e AC3, AC5). It builds over the stored discovery once the first reconciliation has ended, over each new discovery once it is stored, and again after each change of the input revision, whenever that discovery yields a selection input (AC4). Dependency information is used only for the revision whose inputs it was built from: a build during which an input changed, or an event named one, is followed by another and never used.
- [x] AC3: While the discovery an answer reads yields a selection input and no build over it has ended, finished or failed, at the current input revision, each discovered workspace has no fingerprint, so its results read unknown, and the answer names that build as the reason. A run's fingerprint is not taken until that build has finished or failed.
- [x] AC4: A build that fails, and a discovery that yields no selection input (ticket 2.3e AC2), leave each discovered workspace's fingerprint over every input of the project and its own test modules, as before this ticket. The log names why, at warning level, and every answer carries the reason as an input fact beside `nonInputsUnusable`, in `--json` and in the CLI's text, until a later build succeeds. Only the next change of the input revision or a new discovery starts another build: never a timer, and never a retry of the same revision.
- [x] AC5: A stop ends a build in progress without waiting for it, releases every run waiting for a build, and no build starts after a stop.

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

- [x] (Support) Before the first edit, re-read ticket 2.3e's landed code (`selection/selection-input.ts`, `Executor.buildDependencies`, `daemon/parse-record.ts`, with change request #30's debt settled over them) and the selection changes of change requests #26, #31 and its debt, #35 and #38 (`selection/vitest-edges.ts`, `alias-specifiers.ts`, `specifier-edges.ts`, `extends-lookup.ts`), and confirm the names this ticket uses (§ Pending siblings and their routing). `input-tracker.ts` holds about 495 code lines (2.3c § Completion Notes): extract before adding to it (P16).
- [x] (AC1) Create `packages/daemon/src/inputs/narrowed-inputs.ts`: from the project's inputs at one revision, 2.3e's selection input and the dependency information, compute once which inputs each discovered workspace's selection includes, by one `selectTests` call whose change is every input path and whose per-path reports (`paths[].selected`) name the workspaces each path selects. Answer, per workspace path, a `ProjectInputs` over those inputs, whose digest is computed once. An input path whose report says `declared-non-input` lies in every workspace's set, since the tracker holds it as an input (F4). Reusing `selectTests` keeps one decision for staleness and selection (C8); declare no second per-path rule.
- [x] (AC1) In `packages/daemon/src/inputs/fingerprint.ts`, give the seam `workspaceInputs` its narrowing: the workspace's narrowed inputs when a narrowing is given, every input of the project otherwise (AC4). Keep its invariant that every test module the discovery lists for the workspace is among its inputs, and take a listed module the project's inputs hold from the snapshot rather than reading it again, since the narrowed set may leave it out. Rewrite the seam's doc comment, which says narrowing "replaces this body" (C46).
- [x] (AC1, AC3, AC4) In `packages/daemon/src/inputs/current-inputs.ts` and `packages/daemon/src/inputs/input-tracker.ts`, let a query's view of the inputs take the narrowing state for the discovery it reads, reading a narrowing as narrowed only when its build's `discoveryId` is that discovery's and its revision is the moment's revision, and as building otherwise (AC2): narrowed (AC1), building (no workspace fingerprint, the reason naming the build: AC3), or not narrowed with a reason (AC4), and expose the reason AC4's input fact carries, which the building state keeps while the last build over that discovery failed, since AC4 keeps the fact until a later build succeeds. The discovery fingerprint keeps covering every input of the project, so it stays computable while a build runs: AC3's state is a per-workspace fingerprint failure, listed in `unfingerprintedWorkspaces` with the build as its reason, never the view's `unavailable`, which would also void the discovery's fingerprint. Rewrite `unfingerprintedWorkspaces`' doc comment in `answer.ts` ("Only those whose own inputs failed"), which the building state no longer fits (C46). Whatever carries the narrowing, a tracker given none answers as today, since `input-tracker.test.ts` fingerprints through `tracker.current()` with no build in play.
- [x] (AC2, AC3, AC5) Create `packages/daemon/src/daemon/dependency-builds.ts`, owned by the lifecycle: it holds the discovery in effect (its `discoveryId`), 2.3e's selection input for it, and the latest build's revision and outcome. At each build it builds 2.3e's selection input from the discovery, the consumer root's real path and the `NonInputsDeclaration` in effect then (the tracker's, not a second read of `rt-test.json`), and passes the build `ConfirmedStart.consumerRoot` as discovery was given it (2.3e § Design notes, "Two spellings of the root"). A build still running when the revision moves runs to its end and is discarded by its verdict, never aborted, since 2.3e gives an abort a stop's reason, which must never read as AC4's failure. It starts a build when the discovery in effect changes or the input revision moves past the last build's, while that discovery yields a selection input, one at a time, never retrying a revision it has built or failed. A build begins once the tracker has settled and only while it can vouch for its inputs (no unavailable reason), opens a job mark with `beginJob` and closes it with `endJob`; a verdict other than fingerprinted discards the build and starts another at the revision current once the tracker settles, whether or not it differs from the discarded build's (AC2). While the tracker is unavailable no build starts, and the next attempt waits for the tracker's next observable change (a revision move, a reconciliation ending, pending reads draining), never a timer or a loop (17:42 ruling, F1). It resolves a wait once the build for the current revision has finished or failed, or at once while the tracker is unavailable, so a run proceeds as before this ticket (AC3), and on stop aborts its executor, resolves every pending wait without a build, and starts nothing more (AC5). Learning of that change needs a signal from the tracker; add the smallest one (C160: read the revision and whether the tracker can vouch for its inputs where the build begins).
- [x] (AC1, AC2, AC3, AC5) In `packages/daemon/src/daemon/lifecycle.ts`, hand the dependency builds the stored discovery after the first reconciliation (`#protectStoredDiscovery` reads it) and each new discovery once `writeDiscovery` has stored it, with the `discoveryId` it returns; in `#run`, wait for the build at the settled revision in this order: await the builds' wait, then `settled()`, and go round again while the revision settled at has no ended build and the tracker is available, leaving the loop once it is unavailable (17:42 ruling, F1) or once a second build in a row is discarded while the run waits (18:03 ruling); then open `beginJob` and take `started` with no await between them, as today (AC3, C160); read `started` and the end fingerprint in `#bindings` through the builds' narrowing for the discovery in effect, and give `summary` and `pathStatus` the narrowing for the stored discovery they read (F3); in `#stopSequence`, stop the builds and close their executor beside the run executor (AC5).
- [x] (AC2) In `packages/daemon/src/daemon/daemon-main.ts`, construct a second `Executor` for builds, so a build never waits behind a run, and pass the state directory (`directory`) the tracker already excludes from the inputs.
- [x] (AC4) In `packages/daemon/src/query/answer.ts`, add an optional input fact beside `nonInputsUnusable`, documented like it, carrying its kind (a failed build, or a discovery that yields no selection input), each kind an exported constant, and its reason; ticket 2.3i takes those kinds from this fact rather than declaring a second enumeration (2.3i's `answer.ts` task, C14); set it in `query/summary.ts` `queryBasis` from the view of the inputs; render it in `packages/cli/src/answer-text.ts` as a warning line, as `nonInputsUnusable` is. An optional field is not a breaking change (C151), as `nonInputsUnusable` was added. Log the reason at warning level once per failed build and once per discovery that yields no selection input (C32).
- [x] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [x] (Support) Lint and typecheck: `bun x oxlint` over the changed files, `bun run --filter @rt-test/daemon typecheck` and `bun run --filter rt-test typecheck`, which also report each test stand-in the shape changes break (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `selectTests(input)` (`selection/select-tests.ts`): its per-path reports decide which workspaces each input path selects; AC1's narrowing is that decision (C8).
- Ticket 2.3e's selection-input builder (`selection/selection-input.ts`) and `Executor`'s dependency-build method: the input and the build, with the build's parse record in the state directory.
- `ProjectInputs` (`inputs/fingerprint.ts`): a set of input digests whose digest is computed once; the narrowed sets are instances of it.
- `workspaceInputs`, `unselectedModuleDigests` (module-private) and `SnapshotReads` (`inputs/fingerprint.ts`): the seam ticket 2.1 left for this narrowing, and the reads of listed test modules the inputs leave out.
- `TrackedInputs.beginJob`, `endJob`, `settled` (`inputs/input-tracker.ts`): a build is judged as a run is, so a build during which an input moved is never used (AC2).
- `currentInputs`, `InputsMoment`, `unavailableReason` (`inputs/current-inputs.ts`): a query's view of the inputs at one moment.
- `nonInputsUnusable` in `AnswerContext` (`query/answer.ts`), `queryBasis` (`query/summary.ts`) and `answer-text.ts`'s warning line: the pattern AC4's input fact follows.
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
- Dev sanity check (asked by `session_wake` at 17:42 on 2026-09-28, answered at 17:42; decider the orchestrator). F1: start no dependency build while the tracker cannot vouch for its inputs, and build again only on the tracker's next observable change (a revision move, a reconciliation ending, pending reads draining), never a timer or a loop (Q2); while the tracker is unavailable a run proceeds as before this ticket, stored not fingerprinted, and answers read unknown. Blocking every run on a watcher that stays broken is refused. Reason: a discarded build rebuilt at once, with `settled()` resolving at once and every `beginJob` unsettled, forks builds back to back. F2: README.md's list of what every answer gives gains AC4's fact. F3: a run's own start and end fingerprints read the narrowing, so a run is stored under the digest queries compare against. F4: an input path that selection reports as a declared non-input lies in every workspace's set, since the tracker and selection then disagree. The one `selectTests` call measured 0.75 s at 20k inputs and 2.2 s at 50k, synchronous on the daemon thread; it stays on that thread in this ticket, and the orchestrator queues moving it as a performance follow-up after 2.5 measures real cost, since a query waiting behind it costs latency, never a wrong answer.
- Dev adversarial review F1 (asked by `session_wake` at 18:03 on 2026-09-28, answered at 18:03; decider the orchestrator). A waiting run waits through one rebuild: if the build it waited on is discarded and the rebuild is discarded too, a second consecutive discard while that run waits, the run stops waiting and proceeds unfingerprinted, as under an unavailable tracker (17:42), and answers read unknown until a build is recorded; each proceed is logged with its reason. A count, never a timer. Reason: a single edit mid-build keeps its run fingerprinted after a few seconds, while sustained churn delays a run by at most two builds instead of halting it; the owner's aim is feedback to agents, and runs that never start give none. Out of this ticket: a build with no time bound holds the next run until the daemon stops; the orchestrator queues it HIGH for 2.3f, where a build past a named bound ends as a failure of its own kind, never AC4's, which widens and names itself.
- Ticket review (create-ticket 6c, 05:58 to 06:01): 15 findings, 14 applied. F1 and F2 reconciled AC1 and AC4 with AC3 (unknown until the edit's build ends; no "building" state over a failed build or a discovery without a selection input). F3 starts no build without a selection input. F4 keeps AC4's reason through the next build. F5 makes a query use a narrowing only at its own revision and `discoveryId`. F6 and F7 gave AC5's release of waiting runs and AC4's second log cause their tasks. F8 names the root and declaration 2.3e's calls take. F10 rebuilds at the settled revision, so a build discarded with the revision unmoved never stalls. F13 widened the broken-tests method to behavior. F15 restated AC2 as its outcome. Three questions were settled by fact: F9, the declaration, which is taken at each build, since the tracker's declaration in effect changes the inputs only by moving the revision; F11, a build the revision overtakes, which runs to its end and is discarded, since an abort would carry a stop's reason; F12, the wait's place in `#run`, named in the lifecycle task. F14 was rejected: the 05:58 sizing already counts the extraction.

#### Design notes

- **Why one `selectTests` call.** The sprint promises that staleness and selection never disagree, so the narrowing is selection's own per-path decision, not a second rule beside it (C8). One call with every input path as the change builds the selection context once, and its walk cache (`walks`) serves every path of one workspace. Each `ChangedPathReport` names what one path alone selects: `selected` lists the runnable workspaces it reaches, and discovered workspaces are runnable. Selection explains per path, which is also how 2.6's `changes` query will scope a path.
- **A path the narrowing leaves out.** A path whose selection includes no workspace, such as one in a package workspace nothing depends on, is in no workspace's inputs, so its edit stales nothing, and selection selects nothing for it; the two agree by construction. A declared non-input is in no workspace's inputs, as today, since it is not an input; an input the tracker holds that selection reports as a declared non-input lies in every set (F4).
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
- **Change request #31** (built before this ticket): an alias keeps the rest of an import, which can climb out of the replacement's directory with `..`, so prefix analysis misses that edge; the fix applies each workspace's aliases to the specifiers the source scan reads (landed at 1f6b86e, `selection/alias-specifiers.ts`). Its debt (landed at 521eebc) makes a glob beginning with `**` reach every package workspace, ends a glob's literal directory at its first `\` escape, and resolves a driveless absolute path on the consumer root's drive. Like #26 they change only what `selectTests` selects, so each narrowed set follows them with no change here.
- **Change requests #35 and #38** (built before this ticket): a bare tsconfig `extends` is located as TypeScript's config lookup locates it, through `exports`, the `tsconfig` field and a linked package's real path, and an alias replacement that is a `file:` URL reaches the workspaces its path does (landed at fcb1af7, `selection/extends-lookup.ts`). A `file:` URL specifier that cannot be converted to a path, written in a source or reached through an alias, widens its dependent workspace through the new uncertainty kind `unresolvable-specifier` (`UNCERTAINTY.unresolvableSpecifier`, `selection-types.ts`; raised by `addSpecifierEdges` in `specifier-edges.ts`), so that workspace depends on every package workspace and its narrowed set widens to match. Like #31 they change only what `selectTests` selects, so each narrowed set follows them with no change here.
- **Change request #30** (landed at 572ef86): 2.3e's review debt. `workspaceName` moved into `inputs/protection.ts`, which both `protection` and `buildSelectionInput` call; the build caches each extended config's read per scan. It changes none of this ticket's files and none of the names it calls.
- **Change request #32** (landed at 890e9a6 and d755d84, test code only): the daemon tests' connection handling in `test/daemon-harness.ts` and `test/daemon.test.ts`. A lane working in the Fixes tree (t-pid-kills) holds `daemon-harness.ts`, `daemon.test.ts` and `job-tree.test.ts` while this ticket is built; `daemon.test.ts` is one of this ticket's test files (§ Existing tests this change breaks), so create-tests coordinates its edits there with that lane through the orchestrator.
- **2.3d** (landed at fdb86de): `SelectableWorkspace.aliases` is `readonly SelectionAlias[]` (each alias with its project's absolute Vite root, from change request #26), `SELECTION_POLICY_VERSION` is 9 (change requests #35 and #38), which the fingerprint already covers, and `namesDeclarationFile` (`non-inputs.ts`) decides the declaration file for `declaredNonInputs` and `projectWideKinds` alike, so the narrowing reads it through `selectTests` with no change here.
- **#28** (landed at ae1f4b0): `InputFilter` excludes `rt-test.json` itself unless a directory stands there, and the tracker's constructor no longer appends it to the exclusions (`this.#exclusions = exclusions;`). The state directory stays excluded through `daemon-main.ts`'s `exclusions: [directory, log.file]`, so Q6's record still marks no job. It moves no criterion here: a path under a directory named `rt-test.json` is an input whose selection raises the project-wide non-inputs-file trigger (`namesDeclarationFile`), so it lies in every workspace's set, and an event on it still asks the tracker for a reconciliation (`#changed`), which moves the revision when it changes an input.
- **Item 11** (landed at 1ba4836, test code only): it rewrote tests in `daemon.test.ts`, `input-tracker.test.ts` and `cli.test.ts`; D1914 and D1915 and the `current-inputs.ts` anchor in `test/defects.json` that § Existing tests this change breaks names still stand (08:07).
- **2.3f** (backlog, builds after this ticket): the scheduler, which waits for this ticket's build at the settled revision before any run and selects over this ticket's dependency information.
- **2.3h** (backlog, builds after 2.3f): judges and interrupts a run by its workspace's narrowed inputs at the start and end revisions, reading this ticket's narrowing state and build wait; it owns Q4.
- **2.3i** (backlog, builds after 2.3h): puts the schedule into every answer, taking the failed-build and no-selection-input kinds from this ticket's input fact.
- **2.4, 2.4d, 2.4b and 2.4c** (ready-for-dev, build in that order after 2.3i): the re-run at 17:24 over this ticket's ten production files names them. 2.4 writes `lifecycle.ts`; 2.4d writes `input-tracker.ts` and `lifecycle.ts`; 2.4b writes `lifecycle.ts` and `answer.ts` and reads `fingerprint.ts`, `current-inputs.ts` and `summary.ts`; 2.4c writes `answer-text.ts`. Each writes after this ticket lands, so each builds on its shapes, never a collision.

#### Sizing

About 18 raw files and 23 estimated, counting the new module `input-tracker.ts`'s extraction needs; code units 6 (5 criteria plus validation). Orchestrator ruling, asked at 05:58 and answered at 05:58 on 2026-09-28, holding the owner's calls: proceed as-is, with dev delegating the three groups below in order, since the only split left (the answer fact alone) would land a widened state that reads like a narrowed one (Q2), and moving the builds into 2.3e would reopen a reviewed ticket; ask again only past 25 estimated or 15 code units. Production, 10: `inputs/narrowed-inputs.ts` (new), `inputs/fingerprint.ts`, `inputs/current-inputs.ts`, `inputs/input-tracker.ts`, `daemon/dependency-builds.ts` (new), `daemon/lifecycle.ts`, `daemon/daemon-main.ts`, `query/answer.ts`, `query/summary.ts`, `cli/src/answer-text.ts`; and the new module the extraction `input-tracker.ts` needs, counted in the 18. Tests, 7, for create-tests: `lifecycle.test.ts`, `query.test.ts`, `input-tracker.test.ts`, `daemon.test.ts` (a real daemon over a two-workspace consumer), `packages/cli/test/cli.test.ts`, and the two `defects.json` beside them. Over 10 estimated, so dev delegates, in three groups on disjoint files: the narrowing (`narrowed-inputs.ts`, `fingerprint.ts`, `current-inputs.ts`, `input-tracker.ts`), the builds (`dependency-builds.ts`, `lifecycle.ts`, `daemon-main.ts`), and the input fact (`answer.ts`, `summary.ts`, `answer-text.ts`), in that order, since each later group reads the one before.

#### Current structure of the modified files

As of wt/1 at 20eae03, re-verified at f40d2a1 (08:07): only `input-tracker.ts` changed among these files, its constructor now setting `this.#exclusions = exclusions;` (#28), which leaves its line count and everything below as described. Re-verified at 19e5a04 (17:23): `git diff --stat 888b44e HEAD` touches none of the eight files below; `lifecycle.ts` is 357 lines and `input-tracker.ts` 582 lines, 495 of them code.

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
- `packages/daemon/test/defects.json` and `packages/cli/test/defects.json`: D1998, anchored in `current-inputs.ts` (`    facts,\n    ...declaration,\n    workspaceFingerprint: (entry) =>`), loses its anchor if that object changes. Every record anchored in a file this ticket modifies must keep its `old` text or be re-anchored, and `test:defects:changed` re-proves them. By a scan of each record's `file` (17:22): daemon `fingerprint.ts` 8, `current-inputs.ts` 5, `input-tracker.ts` 23, `lifecycle.ts` 46, `daemon-main.ts` 11, `summary.ts` 24; CLI `daemon-main.ts` 1, `summary.ts` 1, `answer-text.ts` 8; none in `answer.ts`.
- Found by `rg -n "workspaceFingerprint|CurrentInputs|TrackedInputs|LifecycleParts|new Executor|DaemonLifecycle|currentInputs\(" packages/daemon/test` (05:43). The typecheck reports any shape it missed (P14). That search finds shapes only, in `packages/daemon/test` only; the behavior changes too (an edit reads unknown until its build ends, AC3; a run waits for a build), so any test in `packages/daemon/test` or `packages/cli/test` that expects `stale` straight after an edit, or a current result with no build in play, breaks without a type error.

#### Doc text

A draft for the orchestrator, final wording to follow the build.

- `docs/architecture.md`, the input tracker paragraph: "Every workspace covers the whole project's inputs until selection narrows it." becomes "Each discovered workspace's inputs are the inputs whose selection, by `selectTests` over the dependency information built at the current input revision, includes it, and every test module the discovery lists for it. The daemon builds that information in its own executor process over the discovery in effect, after the first reconciliation, after each new discovery and after each change of the input revision; a build during which an input changed is discarded and followed by another. While the current revision's build is unfinished, no workspace has a fingerprint and the answer names the build. A build that fails, or a discovery that does not report every discovered workspace's selection facts, leaves every workspace over the whole project's inputs, the log and every answer say why, and only the next change of the input revision or a new discovery builds again."
- The paragraph ending "so selection has no production caller": "The daemon does not build either yet" becomes "The daemon builds both to narrow each workspace's inputs; it does not yet select or run tests from them."
- `README.md`: a user-visible change; the sentence that says an edit stales every workspace's results, if any, becomes that an edit stales the results of the workspaces whose selection it reaches. Dev confirms the sentence.
- `README.md` line 68, "Every answer gives ...": add AC4's input fact beside `nonInputsUnusable`, under its `--json` name. Dev reports the exact text.

#### Previous ticket

2.3e (done, landed at 224269c with its debt at 572ef86), the nearest earlier key: it builds selection's input from the discovery in effect (a failed workspace selectable with tests not known, a failed module or unhandled collection error making tests not known, unsupported and not-confirmed not runnable, no input for a discovery without selection facts), and runs `buildDependencyInformation` as a job of `Executor` in a child process of its own, whose crash names the file being parsed from a record in the state directory, and whose abort ends it at once. From 2.1 (done): the seam `workspaceInputs`, AC11's test-module invariant, and the job fingerprint check (`beginJob`, `endJob`, `unmoved`). From 2.3c (done): `input-tracker.ts` holds about 495 code lines, so an addition there needs an extraction first; one protection producer. `git log --oneline -20` (05:45) shows no code commit since 2.3c's a3ca5bc outside the defect verifier.

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

Dev session: threadId 59845d7e-0c40-4bd0-b03f-0fd0390271f4

#### Test Files This Change Broke

- `packages/daemon/test/lifecycle.test.ts`: `StandInInputs implements TrackedInputs` lacks `changed()` and `nonInputsDeclaration()`, and its `current()` takes no narrowing; the three `new DaemonLifecycle` calls (near lines 429, 554, 626) lack `LifecycleParts.buildExecutor`. These are the typecheck's only 4 errors. Behavior: a run now waits for the dependency build at its settled revision (through one rebuild), and a stand-in whose `settled`/`changed` resolve at once must still let the builds round end.
- `packages/daemon/test/defects.json`: 14 records no longer match in their `file`. D1888, D1918, D1960, D1961, D1991, D1992 and D2065 moved verbatim with the queued-path reads into `packages/daemon/src/inputs/queued-reads.ts`, where each `old` matches exactly once, so only their `file` changes. D1843, D1844, D1871, D1872 (`summary`/`pathStatus` now read results once, through `#queryInputs`), D2052 (`#protectStoredDiscovery` reads a `StoredDiscovery` and hands it to the builds) and D2082, D2084 (the build wait `#awaitBuild` now sits between `#run`'s `settled()` and its stop check) sit on code the tasks changed, and need re-anchoring by meaning. Every other record anchored in a modified file still matches exactly once (script check, 18:06).
- Behavior without a type error (§ Existing tests this change breaks): any test in `packages/daemon/test` or `packages/cli/test` that drives a real daemon and expects `stale` straight after an edit, or `current` before a build in play has ended, now reads `unknown` until the build at the new revision ends; `daemon.test.ts` is held by lane t-pid-kills until #39 lands.

#### ACs Owed a Test

- AC1: after the build at the edit's revision ends, an edit to an input outside a workspace's narrowed set leaves its results current, and one inside makes them stale; a listed test module stays among its inputs, whatever git ignores. Only a real two-workspace daemon (or `currentInputs` over a stand-in narrowing) shows it; a scratch probe of `Narrowing` (18:06) showed each workspace keeps its own files, `package.json` lies in both, a dependency edge adds its target's files, and a refused path widens.
- AC2: a build during which an input changed, or whose discovery was replaced, is never used; a parser crash's reason names the file in the input fact; builds start after the first reconciliation, on a new discovery and on each revision move.
- AC3: while the build at the current revision has not ended, each discovered workspace reads unknown with the build as its reason in `unfingerprintedWorkspaces`, the discovery's freshness is unaffected, and a run's fingerprint is not taken before the build ends or fails.
- AC4: a failed build and a discovery with no selection input widen every workspace and carry `inputsNotNarrowed` (`dependency-build-failed`, `no-selection-input`, or `selection-refused`) in `--json` and as the CLI's warning line, until a later build succeeds; no timer and no retry of a built revision.
- AC5: a stop ends a build in progress at once, releases a run waiting for a build, and starts no build after.

#### Tests Owed

- The 17:42 ruling: while the tracker is unavailable (an unhealthy watcher that stays so), no build starts and a waiting run proceeds, stored not fingerprinted; defect: a build loop that forks back to back, or a run that never starts.
- The 18:03 ruling: a run released after two consecutive discards while it waits, logged with the reason; defect: a run held for good by input churn, or released after one discard.
- A throw in `buildSelectionInput` or in the executor's build call records a failed build (widened, logged) and closes its job mark; defect: the builds ending for the daemon's life with a false building reason.
- An input path selection reports as a declared non-input lies in every workspace's set; defect: an input dropped from every set, so its edit stales nothing.
- A query whose stored discovery the builds were never given (a failed read at start) hands it to them; defect: a false building reason for good.

### Tests Record

Tests session: threadId 65493d69-0315-41fd-b74e-267f9a1335bb

Written 18:13 to 19:04 on 2026-09-28 (paused 18:20 to 18:34 for a harness restart).

- **Broken tests repaired.** `lifecycle.test.ts`: `StandInInputs` gains `changed()` (resolving only when the test moves the revision or at the stop, so the builds' loop never spins), `nonInputsDeclaration()`, `current(narrowing)`, an `unavailable` script and `moveRevision()`; `ScriptedBuilds` stands in for the build executor, answering on the next event-loop turn and ending a held build at an abort; every `DaemonLifecycle` construction passes `buildExecutor`. The start's `/consumer` root does not exist, so the existing tests' builds fail before their job and leave the verdict and settle orders as they were; the two real-tracker helpers get builds that fail, as before this ticket. D2082 is stale by design: a pending build waits for the inputs itself, so the run's own wait now shows only with no build pending, and its test runs under a tracker that cannot vouch (17:42 ruling).
- **Records re-anchored.** D1888, D1918, D1960, D1961, D1991, D1992 and D2065 name `queued-reads.ts` (only `file` changed); D1843, D1844, D1871, D1872, D2052, D2082 and D2084 re-anchored by meaning in `lifecycle.ts`. Every record in the three changed `defects.json` files matches once.
- **A spec correction of my own.** D2532 first expected a workspace's set to leave out the other workspace's `package.json`; § Design notes says any `package.json` selects every workspace, so it lies in every set, and the expectation follows the ticket.
- **D1889 still reads both results stale** after its edit, since the fixture's `packages/a` and `packages/b` have no `package.json` (selection's rule, not this ticket's); D2536 gives both a manifest and shows the narrowing.
- No code bug was found; nothing went to the dev session.
- **Gates**, over the final tree: `bun x oxlint` over the six changed test files, exit 0, no warning; `bun run --filter @rt-test/daemon typecheck` exit 0 and `bun run --filter rt-test typecheck` exit 0; `bun x prettier --check` over the three `defects.json` files, exit 0; `bun run test:defects:changed` 814 of 814 detected in 12 sandboxes, baseline green before and after, exit 0 (19:28). An earlier round (19:03) found D2538 failing by timeout, not by assertion: its wait outlasted the default 5 s, and it now takes the daemon tests' timeout.

- **Review round (19:45 to 19:55).** G2 to G13 each got a named test (D2551 to D2553, D2555 to D2564; D2535 re-anchored and strengthened). G1 is an inert mutation (§ Deliberately Untested), so D2554 went unused, and so did D2565 and D2566. G14: the stand-in start's root is a name under the temp directory no test creates, not `/consumer`. `test/selection/harness.ts` passes `Narrowing` its refusal listener (TS2554). Clarity notes taken: D2538 moved to its own describe with D2555 to D2557, the real-`Narrowing` describe names `Narrowing`, the `TWO_APART_INPUTS` comment says what the declared guide stands for, and D2536 shares `freshnessOf` with `nonZeroFreshness`. Gates: oxlint over the six test files exit 0, no warning; daemon and cli typechecks exit 0; prettier over the three `defects.json` exit 0; the four other touched files run whole, 344 passed, and `lifecycle.test.ts` 68 passed; `verify-mine.mjs` over 90 ids (the new and re-anchored ones, D2536, D1889, D2538, D2523 to D2531, and every record in `lifecycle.test.ts`), 90 of 90 detected, exit 0 (19:55).

#### Named Defects

- D2504: The dependency builds start before the first reconciliation has ended. (AC2)
- D2505: A build during which an input event arrived, with the revision unmoved, is recorded and used. (AC2)
- D2506: A build over a discovery replaced while it ran is recorded, so the new discovery never gets its own build. (AC2)
- D2507: A failed build is logged below warning level. (AC4)
- D2508: A failed build is retried at the same revision back to back. (AC4)
- D2509: A revision move after a failed build never builds again. (AC4)
- D2510: A failed build's reason is dropped once the next build begins, before any later build succeeds. (AC4)
- D2511: A build starts while the tracker cannot vouch for its inputs. (17:42 ruling)
- D2512: A stop leaves the build in progress running. (AC5)
- D2513: A run waits for a build while the tracker cannot vouch, though none can begin. (17:42 ruling)
- D2514: A stop while a build waits for the inputs to settle is followed by the build. (AC5)
- D2515: A throw from the executor's build call ends the builds for good with a false building reason and an open job mark. (AC4)
- D2516: A discovery that yields no selection input reads as a failed build. (AC4)
- D2517: A run begins without waiting for the build at its settled revision. (AC3)
- D2518: A run proceeds after one discarded build. (18:03 ruling)
- D2519: A run waits through any number of discarded builds; the release is stored not fingerprinted and logged with its reason. (18:03 ruling)
- D2520: The stop sequence never stops the builds, so a run waiting for one holds the stop. (AC5)
- D2521: A query never hands the builds its stored discovery after a failed read at start. (AC2)
- D2522: A run is fingerprinted over every input, never matching the narrowed digest queries compare. (AC1, F3)
- D2523: While the build has not ended, a workspace is fingerprinted anyway; the discovery's freshness stays unaffected. (AC3)
- D2524: A narrowing built at an earlier revision is used at the current one. (AC2, AC3)
- D2525: A narrowing built over another discovery is used for the one the answer reads. (AC2, AC3)
- D2526: A summary and a path status leave out `inputsNotNarrowed`. (AC4)
- D2527: A failed build at the current revision reads as building instead of widened. (AC4)
- D2528: While the build after a failed one runs, answers drop the failure. (AC4)
- D2529: A discovery that yields no selection input is reported as a failed build. (AC4)
- D2530: A narrowing whose selection refuses a path is used as if it had selected. (AC4)
- D2531: A narrowed view fingerprints each workspace over every input, so an edit outside its set stales it. (AC1)
- D2532: Each workspace's narrowed inputs are every input of the project. (AC1)
- D2533: An input the tracker holds that selection calls declared lies in no workspace's set. (AC1, F4)
- D2534: A listed test module the narrowed set leaves out is digested from disk rather than the snapshot. (AC1)
- D2535: The CLI's warning after a failed build says neither that no workspace's inputs are narrowed nor the cause. (AC4; re-anchored and strengthened in the review round, G11)
- D2536: A real daemon's queries ignore the narrowing, so an edit to b's own test stales a's result. (AC1)
- D2537: A stop never closes the build executor. (AC5)
- D2538: The tracker's change signal never resolves while it runs, so a failed build is never followed by another. (AC4, 17:42 ruling)
- D2551: A workspace a path reaches only through a dependency edge is left out of that path's sets. (AC1, G2)
- D2552: A discovered workspace selection will not run gets no inputs at all. (AC1, AC4, G3)
- D2553: A real narrowing never reports its selection's refusal. (AC4, G4)
- D2555: The tracker's change signal resolves at once rather than at the next change. (17:42 ruling, G5)
- D2556: Pending reads that drain without moving a digest never signal. (17:42 ruling, G6)
- D2557: A protection walk's end never signals. (17:42 ruling, G7)
- D2558: A recorded build leaves the count of discards in a row as it was. (18:03 ruling, G8)
- D2559: A run counts every discard since the daemon started, not since its own wait began. (18:03 ruling, G9)
- D2560: A build discarded by its discovery's replacement counts toward the new discovery's discards in a row. (18:03 ruling, G10)
- D2561: A selection refusal is never logged. (AC4, C32, G13)
- D2562: A discovery with no selection input is named in the CLI's warning as a failed build. (AC4, G11)
- D2563: A selection refusal is named in the CLI's warning as a failed build. (AC4, G11)
- D2564: The `--json` answer leaves out `inputsNotNarrowed`. (AC4, G12)
- A parser crash's reason naming the file (AC2) is 2.3e's executor reason (D2239 through D2246); D2526 and D2535 prove the failed build's reason reaches both answers unchanged.

#### Deliberately Untested

- packages/daemon/src/daemon/daemon-main.ts: the second `Executor` for builds; sharing the run executor would queue a build behind a run, which costs latency and changes no answer.
- packages/daemon/src/inputs/declared-non-inputs.ts: the `declaration` getter's default before the first read; builds begin only after the first reconciliation, which reads `rt-test.json` first.
- packages/daemon/src/daemon/dependency-builds.ts: the catches around `realpathSync.native` and `buildSelectionInput`; no stored discovery makes the builder throw, and both record a failed build through the path D2515 proves.
- packages/daemon/src/inputs/current-inputs.ts: fingerprinting through the unrefused narrowing under a selection refusal (review G1) is an inert mutation, since `Narrowing.workspaceInputs` returns every input of the project once its sets are refused, and `refusal` and the sets come from one cached computation; each of the two guards masks the other's mutation, so no test can fail on one alone. `query.test.ts`'s stand-in now returns every input under a refusal, as the class does.
- packages/daemon/src/inputs/queued-reads.ts: moved verbatim; its seven records moved with it.
- packages/daemon/src/query/answer.ts: types and the three kind constants; D2526, D2529 and D2530 pin their values.

### Review Record

Review session: threadId 91423e88-a3b1-49d3-880c-98a149f0900e

Reviewed 19:29 to 19:44 on 2026-09-28: the checklist pass and five fresh-eyes batches (lifecycle, input-tracker, narrowing, query, cli). No path narrows without a finished, trusted build: `narrowingAt` narrows only from a `built` build whose `discoveryId` and revision match the view's, a build is recorded only after a fingerprinted job verdict over an unreplaced discovery, and the revision is monotonic and moves on every committed digest change.

Fixed in the review:

- M1 (MEDIUM, 18:03 ruling): a build its discovery's replacement discarded counted toward `consecutive`, so at a restart with a stored discovery a run proceeded after one discard of its own build. It now counts in `total` only (`dependency-builds.ts`).
- M2 (MEDIUM, C32): a selection refusal widened every workspace unlogged, reachable on Linux from one legal root file name (`a:b.txt`, `..\x`; measured with a probe of `refusalReason`'s rules). `Narrowing` takes a listener it calls once when its sets are refused, and the builds log it at warning level.
- M3 (MEDIUM, consumer): the CLI's warning dropped `kind`, so a failed build read as a bare executor exit, and its heading ("every workspace covers the whole project's inputs") was false while the build after a failed one runs. It now reads "no workspace's inputs are narrowed to those its selection includes, since <cause>: <reason>"; `client.ts` exports the three kinds and `InputsNotNarrowed`.
- M4 (LOW, C46): the `InputsNotNarrowed`, `AnswerContext.inputsNotNarrowed` and `CurrentInputs.inputsNotNarrowed` docs now hold in the rebuild-after-failure state, and say a refusal is known only while a fingerprint can be computed.
- M5 (LOW, C46): `Narrowing`'s doc states that every `project` it is given must be the inputs at the build's revision, since its sets come from the first.
- M6 (LOW): `#stopSequence` records that the builds stop before the tracker.

Tech debt, undisposed:

- T1 (pre-existing) `input-tracker.ts` `#reconcileWhileRequested`: `await this.#processing` sits outside its `try`, so a throw in `#drainQueue` past the read (in `#commit`, `readUpTo` or the logging) leaves `#reconciling` true for good; every later request returns early, the tracker reads "a reconciliation of the inputs is running" forever, and no `changed()` waiter wakes.
- T2 `protection-walk.ts` `keepReleasedFiles` commits `InputState` itself, bypassing the tracker's `#commit` and its signal; the walk's revision move is observable only through `#walkReleased`'s `finally`. Leave the commit to the caller's `#commit`.
- T3 `queued-reads.ts` (moved verbatim): it holds the tracker's whole `AbortController` though it reads only `.signal`; the tracker and `QueuedReads` both mutate the quiet set, so its invariant spans two files; `#label` sits beside inline `relativePosixPath(this.#root, path)` computing the same value. Ticket 2.4d writes `input-tracker.ts` next.
- T4 `daemon-main.ts`: the run and build executors share the log with no role, so an executor process exit names only a pid.
- T5 `narrowed-inputs.ts`: `NarrowingState.lastFailure` is always derivable from `latest`, since every writer sets both together; folding it into `narrowingAt` changes the states `query.test.ts` builds by hand.
- T6 `narrowed-inputs.ts`: one tracked path selection refuses widens every workspace for as long as it exists; narrowing the rest needs a per-path refusal from `selectTests`.
- T7 `dependency-builds.ts` `start()`: a throw out of the builds' loop marks them stopped while the state keeps `selectionInput: true` with no build at the revision, so every later answer names a build "that has not ended" though none will run. It belongs with the bounded build queued for 2.3f (#43), a terminal failure of its own kind.

The recorded exclusion for `input-tracker.ts` (each `#signalChange` site unobservable) is refuted by G6 and G7: `#commit` signals only on a revision move, and the protection walk commits without it.

Denominator: 35 named-defect tests in the touched test files (D2504 to D2538) against the behaviors AC1 to AC5 and the 17:42 and 18:03 rulings name.

#### Test Coverage Gaps

- G1 (CRITICAL class, AC1, AC4) `packages/daemon/src/inputs/current-inputs.ts`: under a selection refusal, `workspaceFingerprint` fingerprints through the unrefused `workspaces` instead of `selected` (`narrowedFingerprint(workspaces, inputs, entry, reads)`), so the answer says not narrowed while every workspace is still fingerprinted over its narrowed set, and an edit outside that set, the refused path included, leaves its results current. D2530 checks only the fact. Expected: in `query.test.ts`, a result stored under the narrowed fingerprint reads stale under the refused narrowing after an edit outside the set, or one stored under the whole project's fingerprint reads current.
- G2 (CRITICAL class, AC1) `packages/daemon/src/inputs/narrowed-inputs.ts` `includingWorkspaces`: a workspace a path reaches only through a dependency edge or a widening is left out of that path's sets (for example `report.selected.filter(({ reasons }) => reasons.some(({ steps }) => steps.length === 0))`), so an edit to a dependency leaves its dependent current. The only real-`Narrowing` tests (D2532, D2533) use two workspaces with no edge. Expected: a `narrowedInTree` case where `packages/a` depends on `packages/b`: b's source lies in a's set, a's source not in b's.
- G3 (CRITICAL class, AC1, AC4) `packages/daemon/src/inputs/narrowed-inputs.ts` `workspaceInputs`: a discovered workspace missing from the selection input (unsupported or not confirmed, so not runnable) gets an empty set instead of every input (`?? project` becoming `?? new ProjectInputs(project.root, new Map())`), so an edit to its sources stales nothing. Expected: a `narrowedInTree` case with a not-runnable workspace, expecting every input.
- G4 (LOW, AC4) `packages/daemon/src/inputs/narrowed-inputs.ts` `refusal`: returning undefined always drops `selection-refused` from every answer while the fingerprints still widen; D2530 uses a stand-in. Expected: a `narrowedInTree` case with a refused input path.
- G5 (MEDIUM, 17:42 ruling) `packages/daemon/src/inputs/input-tracker.ts` `changed()`: resolving at once instead of at the next change makes the builds' rounds spin on microtasks while the tracker cannot vouch, starving the event loop so nothing ends the unavailability. D2538 checks only that it resolves. Expected: `changed()` still pending after a real turn with no change, then resolved by one.
- G6 (MEDIUM, 17:42 ruling) `packages/daemon/src/inputs/input-tracker.ts` `#drainQueue`: with the `#signalChange()` after `readUpTo` dropped, a batch whose reads move no digest (a same-bytes rewrite) never signals the pending reads draining, so a build waiting on them sleeps until an unrelated event or the periodic reconciliation. Expected: `changed()` taken while `current().unavailable` names pending paths from a same-content write resolves with the revision unchanged.
- G7 (MEDIUM, 17:42 ruling) `packages/daemon/src/inputs/input-tracker.ts` `#walkReleased`: with the `finally`'s `#signalChange()` dropped, a waiter blocked on a protection walk is never woken, since `keepReleasedFiles` commits without `#commit`'s signal. Expected: `changed()` taken while `current().unavailable` names the walk resolves when it ends.
- G8 (LOW, 18:03 ruling) `packages/daemon/src/daemon/dependency-builds.ts` `#record`: with its `consecutive: 0` dropped, a run proceeds after two discards a recorded build separated. Expected: builds discarded, built then the revision moved, discarded again, then held: no run yet.
- G9 (LOW, 18:03 ruling) `packages/daemon/src/daemon/lifecycle.ts` `#awaitBuild`: with `waitedFrom` 0 instead of the total at the wait's start, the second workspace's run proceeds at once after the first's gave up. Expected: a two-workspace test where a proceeds after two discards and b waits through one more.
- G10 (MEDIUM, 18:03 ruling, review fix M1) `packages/daemon/src/daemon/dependency-builds.ts` `#build`: a build its discovery's replacement discarded counts toward `consecutive` (`+ (replaced ? 0 : 1)` becoming `+ 1`), so the new discovery's run proceeds after one discard of its own build. Expected: builds over the stored discovery held, a new discovery stored, the held build ending replaced, then one discard of the new discovery's build: no run yet.
- G11 (MEDIUM, AC4, review fix M3) `packages/cli/src/answer-text.ts`: M3 moved D2535's anchored line, so D2535 needs re-anchoring; and a warning line without the not-narrowed statement or the cause survives it, since it checks only a `warning:` prefix and the reason. Expected: the line says the inputs are not narrowed and names the cause per kind ("the last dependency build failed", "the discovery yields no selection input", "selection refused an input's path").
- G12 (LOW, AC4) `packages/cli/src/answer-text.ts` `answerFields`: dropping `inputsNotNarrowed` from `--json` fails no test (D2536 checks only its absence). Expected: D1944's shape with the field present.
- G13 (MEDIUM, C32, review fix M2) `packages/daemon/src/inputs/narrowed-inputs.ts` `#setsFor` and `dependency-builds.ts` `#narrowing`: a selection refusal is never logged at warning level (dropping `if (this.#sets.refused) this.#refused(this.#sets.reason);`). `narrowedInTree`'s `new Narrowing(` in `test/selection/harness.ts` now needs the listener (TS2554, the daemon typecheck's only error).
- G14 (LOW) `packages/daemon/test/lifecycle.test.ts`: its builds fail only because `/consumer` does not exist; on Windows that is `<drive>:\consumer`, so on a host where it exists the builds take the stand-in's job verdicts and D1877 and D1989 pass or fail for the wrong reason. Expected: a root under a fresh temporary directory never created, or builds' job ends on their own verdict queue.

Test clarity, the tests session's call: D2538 sits under the describe "the fingerprint's parts"; the `TWO_APART_INPUTS` comment (`select-tests.test.ts`) says the tracker holds `docs/guide.md`, which `input-inventory.ts` drops as declared, so it stands for the disagreement F4 covers; the describe of the real-`Narrowing` tests does not name `Narrowing`; D2536 repeats `nonZeroFreshness`'s filter inline.

Tests session's reply (19:55): G2 to G14 worked (D2551 to D2553, D2555 to D2564; D2535 re-anchored and strengthened; G14 through a never-created root under the temporary directory) and every clarity note taken. G1 is refuted as inert, and the review agrees: `Narrowing.workspaceInputs` answers every input of the project once its sets are refused, so fingerprinting through the unrefused narrowing still covers the whole project; it is recorded under § Deliberately Untested.

### Completion Notes

Built by rt-t2-3g-dev, 17:38 to 18:07 on 2026-09-28, on main at 7612cb1.

- **Sanity check (17:42).** Four findings (F1 a build loop with no exit while the tracker is unavailable, F2 README line 68, F3 a run's own fingerprints, F4 a declared-non-input disagreement), ruled by the orchestrator at 17:42 and confirmed by the author at 17:44 and 17:45; the tasks and notes they corrected are amended in place, and the rulings are under § Orchestrator rulings.
- **Unverified assumptions.** None to resolve.
- **Delegation.** Wave 0 (the contracts), built in the main loop: `narrowed-inputs.ts` whole, the `TrackedInputs` and `CurrentInputs` members, and `answer.ts`'s input fact. Then two agents on disjoint files: impl-daemon-inputs (`fingerprint.ts`, `current-inputs.ts`, `input-tracker.ts`, `declared-non-inputs.ts`, new `queued-reads.ts`) and impl-daemon-builds (`dependency-builds.ts`, `lifecycle.ts`, `daemon-main.ts`); `summary.ts` and `answer-text.ts` in the main loop.
- **What was built.** Each discovered workspace's fingerprint covers the inputs one `selectTests` call over every input path selects it for, plus its listed test modules (from the snapshot when held); the discovery's fingerprint stays whole. A query's view reads the builds' state for the stored discovery it answers from: narrowed only from a build over that discovery at the view's revision, building (a per-workspace fingerprint failure naming the build) otherwise, widened with `inputsNotNarrowed` over a failed build, a discovery with no selection input, or a selection that refuses an input's path. The builds run in a second executor, one at a time, after the first reconciliation, only while the tracker can vouch for its inputs, paced by the tracker's `changed()` signal (a revision move, a reconciliation ending, reads draining, a protection walk ending, a stop), never a timer. A run waits for its revision's build, through one rebuild (18:03 ruling), and is fingerprinted through the same narrowing as queries. `input-tracker.ts` went from 499 to about 432 code lines by moving the queued-path reads to `queued-reads.ts` unchanged.
- **Adversarial review (17:56 to 18:02).** Seven findings. Fixed: F2 (a throw in a build ended the builds for good; now a failed build at that revision, with its job mark closed), F3 (a selection refusal widened silently; now kind `selection-refused`, carried in every answer), F4 (a failed read of the stored discovery at start left a false building reason; a query now hands its stored discovery to the builds), F6 (a duplicate `state()` accessor, removed). F1 went to the orchestrator (18:03 ruling). Discarded: F5 (a spin if the tracker stopped before the builds; unreachable, since `#stopSequence` stops the builds synchronously first), F7 (`current()` for the revision: `project()` is cached per revision, and one `realpath` per build is negligible). Post-fix re-validation: lint and both typechecks, below.
- **Validation (18:05).** `bun x oxlint` over the 12 changed production files: exit 0, no warning. `bun run --filter @rt-test/daemon typecheck`: exit 1, 4 errors, all in `test/lifecycle.test.ts` (§ Test Files This Change Broke), none in production. `bun run --filter rt-test typecheck`: exit 0. `node scripts/check-line-citations.mjs`: clean. No test run, as dev-ticket directs.
- **Measured (sanity check, 17:40).** The one `selectTests` call over every input path: 182 ms at 5k inputs, 755 ms at 20k, 2.2 s at 50k (10 workspaces, synchronous on the daemon thread, Windows 11, Bun, warm). It runs once per recorded build, on the first view that reads it; it stays on that thread here, and the orchestrator queues moving it after 2.5 measures real cost.
- **Known limit.** A dependency build that never ends holds the next run until the daemon stops (no time bound; F11 forbids aborting it). The orchestrator queued a bounded build, ending as a failure of its own kind, HIGH for 2.3f (18:03).
- **Left undone.** A selection refusal is carried in every answer but not written to the log (the view that detects it holds no log), a partial of C32. The narrowing is computed on the first view that reads a recorded build, so that view's answer takes its latency.
- **README.** User-visible: README.md lines 67 and 68 change; the exact text went to the orchestrator in the report (orchestrator-owned file).

#### Change request candidates

- **`selectTests` accumulates reasons by copying.** `assemble` in `selection/select-tests.ts` rebuilds each workspace's reason array per path (`[...(reasons.get(workspace) ?? []), ...workspaceReasons]`), which grows with the square of a workspace's paths once the narrowing passes every input path as the change; appending in place gives the same output. Ready to paste: "select-tests.ts `assemble` copies each workspace's accumulated reasons once per path; the narrowing's one call over every input path makes that quadratic in a workspace's input count. Append in place instead; no output changes." Out of this lane's files; part of the queued performance follow-up.

### File List

- _agent-docs/tickets/2-3g-narrow-fingerprints.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3g added and linked, under the orchestrator's 05:45 grant)
- _agent-docs/tickets/2-3g-narrow-fingerprints.md (re-verified at build start by create-ticket, 17:23, against #26, #30, #31 and its debt, #32, #35 and #38)
- _agent-docs/tickets/2-3g-narrow-fingerprints.md (dev: sanity rulings, amended tasks, Dev Agent Record)
- packages/daemon/src/inputs/narrowed-inputs.ts (created)
- packages/daemon/src/inputs/queued-reads.ts (created, extracted from input-tracker.ts)
- packages/daemon/src/daemon/dependency-builds.ts (created)
- packages/daemon/src/inputs/fingerprint.ts
- packages/daemon/src/inputs/current-inputs.ts
- packages/daemon/src/inputs/input-tracker.ts
- packages/daemon/src/inputs/declared-non-inputs.ts
- packages/daemon/src/daemon/lifecycle.ts
- packages/daemon/src/daemon/daemon-main.ts
- packages/daemon/src/query/answer.ts
- packages/daemon/src/query/summary.ts
- packages/cli/src/answer-text.ts
- packages/daemon/src/client.ts (review: exports the three kinds and `InputsNotNarrowed`)
- packages/cli/test/cli.test.ts, packages/cli/test/defects.json, packages/daemon/test/defects.json, packages/daemon/test/input-tracker.test.ts, packages/daemon/test/lifecycle.test.ts, packages/daemon/test/query.test.ts, packages/daemon/test/selection/defects.json, packages/daemon/test/selection/harness.ts, packages/daemon/test/selection/select-tests.test.ts (create-tests)

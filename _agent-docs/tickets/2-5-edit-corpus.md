# Ticket 2.5: Controlled edit corpus

## Ticket

As the owner reading RT Test's correctness targets,
I want a committed corpus of the edits a consumer like Fleet Cooling makes, each replayed against RT Test's own daemon beside a full run by plain Vitest over the same files,
so that no duplicate execution (NFR1) and no selection miss (NFR2) are read from evidence at every push, and a selection or scheduler change that would miss a failure, rerun a current workspace, or quietly run every workspace on every edit fails the gate.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: A synthetic consumer committed under `test/fixtures/daemon/edit-corpus/` is shaped like Fleet Cooling: a root `package.json` whose `workspaces` lists `apps/*` and `packages/*`; four Vitest workspaces, a shared library, two packages that each depend on it, and an app that depends on all three, every dependency declared in the dependent's `package.json` and imported by package name; tests that pass and one that is skipped; docs at the root and in a workspace, which the consumer's `rt-test.json` declares non-inputs. Its tests are deterministic, finish in well under a second each, and write nothing into its tree. The corpus runs it on Vitest 4.1, the version Fleet Cooling runs.
- [x] AC2: The corpus's edits are these (§ Edit mix gives their basis in Fleet Cooling's history): a source edit to the shared library that breaks tests in each workspace depending on it, and its fix; a source edit to a mid-level package; a test module added, and one deleted; a rename of a library source file whose importers are updated in the same burst of saves except one, whose module then fails to load, and the fix of that import; a docs edit; a save that leaves a file's bytes unchanged; an edit in two parts, the second saved while the daemon is running the first part's selection whenever the check sees it running (AC4); and one Vitest config edit. They are grouped into sequences, each replayed from the committed fixture in a daemon life of its own (the second half of a split sequence starts from the fixture with the first half's edits applied, AC10).
- [x] AC3: Each edit declares the exact set of Vitest workspaces the daemon must run for it, the set `docs/architecture.md`'s selection rule gives for its paths: the package workspace holding each changed path and every workspace depending on it; for a config file in a Vitest workspace's directory, that workspace and its dependents; nothing for a declared non-input or a save that changes no bytes. After each edit, a workspace the daemon ran that the edit does not declare, and a declared workspace it did not run, are each a finding naming the edit and the workspace. At the baseline before a sequence's first edit, the declared set is every confirmed workspace, each run once.
- [x] AC4: Before the first edit and after each one, the check waits as a coding agent does: it asks the daemon, through ticket 2.4b's `queryWait`, to wait on the files the edit changed (at the baseline, every test module of the fixture), and compares nothing until that wait answers settled and the daemon's schedule shows no round pending and every confirmed workspace idle. For the edit whose second part is saved while a run is going, the check saves that part once it sees a declared workspace running, or once the first part's wait has answered if it sees none first, so it never waits for a run that has already ended; the first part's wait may then answer superseded, and the check waits on both parts' files at the newer revision. The baseline's wait may answer superseded once, only when every changed path its answer names is a file `rt-test.json` declares a non-input, since the declaration first applies when the first discovery lands; the check then waits again at the newer revision, and a baseline superseded by any other path is a finding. Any other superseded answer, an unsettled answer, and a daemon that does not go idle within the check's bound are each a finding naming the edit. After an edit that declares no runs (the docs edit, the unchanged save), the input revision the daemon answers with once the wait has settled must equal the one it answered with before the save; a moved revision is a finding, since such an edit moves none, and a run a daemon wrongly began for it would otherwise store after the check's last read.
- [x] AC5: Once the daemon has settled, a full run by plain Vitest 4.1, run through Vitest's own command line in every Vitest workspace and never through RT Test's executor, over the same input snapshot, is compared with the daemon's answers test by test, by workspace, module path and suite and test names: every test the full run reports is one the daemon holds, with the same outcome (passed, failed, or skipped, a todo counting as skipped); every module the full run fails to load, the daemon reports failed to load; the daemon holds no test the full run does not report, other than a test of a module the full run fails to load, which the daemon may hold in that module's failed-to-load state; and every result compared reads current. A failure the full run finds that the daemon's current results do not is a selection miss (NFR2); each other disagreement is a finding too; each names the edit, the test or module, and what each side reported.
- [x] AC6: A run the daemon stores for a workspace under the same input fingerprint and adapter version as that workspace's previous stored run, while that previous run was stored under its fingerprint, is a duplicate execution (NFR1), a finding naming the workspace and the edit. A rerun after a run stored not fingerprinted is not one, and neither is a run at a fingerprint only an older, superseded run of the workspace held, as when an edit is reverted.
- [x] AC7: The check proves it looked. Each edit also declares the tests and modules the full run fails after it, those an earlier edit of its sequence left failing included, and a full run whose failures differ is a finding, so an edit that no longer breaks what it declares cannot pass as a clean comparison. A full run that writes no report, reports no test for a workspace, or ends other than with Vitest's own exit code for a run that passed or one that failed, is a finding carrying its exit status and output, and nothing is compared for that edit.
- [x] AC8: The check returns one report per sequence listing every finding by kind (selection miss, other disagreement, duplicate execution, run outside the declared set, declared run missing, wait not settled, daemon not idle, full run unusable, declared failures not matched, input revision moved), each naming the edit and the tests, modules or workspaces involved, and a sequence with no finding returns exactly one clean value, so a test asserts a whole sequence with one assertion and no hook.
- [x] AC9: Each sequence runs in a temporary copy of the fixture made a git repository, with Vitest 4.1 and the workspace packages linked under `node_modules` as a package manager links them, starts the daemon with every workspace confirmed, and ends that daemon and every process it started however the sequence ends; nothing is written into this repository's tree, and the full run writes nothing the daemon counts as an input. The corpus runs in the ordinary suite, so the gate runs it on Windows and on Linux.
- [x] AC10: Each sequence, its baseline included, completes on an idle Windows machine in at most half of `DAEMON_TEST_TIMEOUT_MS`, measured and recorded in the Completion Notes with the Linux figure; a sequence that does not fit is split into two, never shortened by dropping an edit; the second half's copy applies the first half's edits before its daemon starts, so each edit changes what it changed in the whole sequence.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: create-ticket settled each third-party claim this ticket rests on in installed source or by a spike (§ Settled facts): Vitest 4.1.11's JSON reporter shape, its report of a module that fails to load, package-name resolution through a `node_modules` junction, a missing file behind an `exports` subpath pattern failing to load, and what a plain run writes. The ticket otherwise drives only this repository's own daemon, client and store.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Before the first edit, re-read the landed code of ticket 2.4b (`queryWait` and its options in `packages/daemon/src/query-client.ts`, re-exported from `packages/daemon/src/client.ts`; the wait answer's outcome constants in `packages/daemon/src/query/answer.ts`) and 2.4d, and confirm the names this ticket uses; read `packages/daemon/test/harness.ts` and `packages/daemon/test/daemon-harness.ts` for the helpers under § Reuse.
- [x] (AC1) Create the fixture under `test/fixtures/daemon/edit-corpus/` by § Fixture shape: the root `package.json`, `rt-test.json` declaring `**/*.md`, `README.md`; `packages/lib`, `packages/ui`, `packages/backend` and `apps/web`, each with a `package.json` naming it `@corpus/<name>` with `type` `module`, an `exports` map, and a `dependencies` entry (`workspace:*`) for each `@corpus` package it imports, a `vitest.config.mjs` exporting a plain object as the other daemon fixtures do, its source and its tests; `apps/web` with a setup file its config names; `packages/lib/README.md`. Write each test so the edits in § Sequences break exactly the tests they declare, and write the fixture's modules as `.mjs`, as every other daemon fixture is.
- [x] (AC9) In `packages/daemon/test/harness.ts`, add a helper beside `linkVitest` that links each workspace package under the copy's `node_modules` by its package name, through a directory link as `linkVitest` makes one, so a package-name import resolves as it does after `bun install`.
- [x] (AC2, AC3, AC7) Create `packages/daemon/test/edit-corpus-sequences.ts`: the sequences of § Sequences as data. Each edit gives the files it writes, renames or deletes (a rename is a delete and a write in one burst), whether its second part is saved while a run is going, its declared run set, and its declared full-run failures (tests by workspace, module path and names; modules that fail to load), every failure the full run should find after it, an earlier edit's included. Derive each run set from the selection rule quoted in § Rule clauses, never from a run.
- [x] (AC4, AC9) Create `packages/daemon/test/edit-corpus.ts`, the check. For one sequence: copy the fixture with `inConsumerCopy` on `vitest-4`, link the packages, make it a repository with `fixtureRepository`, and run inside `withDaemons`, starting the daemon with `started(root, pids, confirmEvery(root))`. At the baseline, call `queryWait` on every test module of the fixture, and after each edit on the edit's files (a renamed file's old and new paths both), with a limit named as a constant; then poll `querySummary` until `schedule.round.state` is not `ROUND.pending` and every `schedule.workspaces` entry is `EXECUTION_STATE.idle`, within a named bound. For the edit saved during a run, save its first part and start its wait, poll the schedule until a declared workspace is `EXECUTION_STATE.running` or that wait has answered, whichever comes first, save the second part, wait on both parts' files, and accept a superseded first answer only there. After an edit that declares no runs, read the answer's `inputs.revision` and compare it with the one read before the save (AC4).
- [x] (AC5, AC7) In `edit-corpus.ts`, run the full run: spawn Node on the linked Vitest 4.1's `bin.vitest` entry with `run --reporter=json --outputFile <file>` in each Vitest workspace's directory, the report file in the run's temp root (`runTempRoot`), outside the consumer's copy and this repository's tree, removed with it (C106), with an argument array (P15), the workspaces in parallel. Treat an exit other than Vitest's passed and failed exit codes (named constants, C3), a signal, a missing or unparsable report, or a workspace with no reported test as full run unusable, keeping its exit status, stderr and stdout (C141, C161), and compare nothing else for that edit. Otherwise compare the full run's failed tests and modules with the edit's declared failures, reporting each declared and not produced and each produced and not declared. Map each report entry to the daemon's test identity: module path relative to the workspace's real directory with `/` separators, names from `ancestorTitles` then `title`. Read an entry with `status` `failed`, a non-empty `message` and an empty `assertionResults` as a module that failed to load (§ Settled facts). Type the report from Vitest 4.1's exported JSON reporter types where the package exports them (C14), declaring only the fields read otherwise.
- [x] (AC5) In `edit-corpus.ts`, read the daemon's side after settling: each workspace's latest stored run from the store (as `storedRuns` in `daemon-harness.ts` opens it) for each test's outcome and each module's state, and the answers' freshness (`queryPathStatus` of each test module, or `querySummary`'s counts) for currency. Compare by AC5, and classify a failure the full run finds that the daemon does not hold as a current failure as a selection miss.
- [x] (AC3, AC6) In `edit-corpus.ts`, read the stored runs added during each step, in sequence order, and report each run outside the declared set, each declared workspace with no run, and each duplicate execution by AC6's rule, comparing each run with its workspace's previous stored run only.
- [x] (AC7, AC8) Declare the report: each finding kind as a named constant (C3), each finding naming its edit, and the clean report as one exported value; `edit-corpus.ts` exports one function that runs a sequence and resolves with its report, throwing only when the harness itself cannot run (a failed copy, a daemon that does not start), never turning a failure into a clean report (C30, C32).
- [x] (AC10) Run each sequence once through a stand-in test body on Windows and on Linux, record each duration in the Completion Notes, and split any sequence over half of `DAEMON_TEST_TIMEOUT_MS` on Windows. Delete the stand-in before handing off; create-tests writes `packages/daemon/test/edit-corpus.test.ts`.
- [x] (Support) Send the orchestrator the doc text in § Doc text with the build (C7).
- [x] (Support) Lint and typecheck: `bun x oxlint` over the new and changed files and `bun run --filter @rt-test/daemon typecheck`.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `inConsumerCopy`, `linkVitest`, `fixtureRepository`, `confirmEvery`, `runTempRoot`, `REPO` (`packages/daemon/test/harness.ts`): a fixture copy in the run's temp root with a Vitest install linked, a git repository with the fixture git settings (P44's reason applies), and the start that confirms every workspace.
- `withDaemons`, `started`, `settled`, `eventually`, `until`, `DAEMON_TEST_TIMEOUT_MS`, `DAEMON_WAIT_MS` (`packages/daemon/test/daemon-harness.ts`): ends every daemon and executor however a body ends, starts a trusted daemon recording its process, and the daemon tests' time bounds (P45 is covered by `DAEMON_TEST_TIMEOUT_MS`).
- `storedRuns` (`daemon-harness.ts`) as the pattern for reading the store while the daemon runs: `openStore(stateDirectory)`, `readRuns(consumerIdentity(root))`, which returns runs in store sequence order with each run's `inputFingerprint` and `adapterVersion` (`packages/daemon/src/store/read-runs.ts`).
- `querySummary`, `queryPathStatus`, and 2.4b's `queryWait` (`@rt-test/daemon/client`); `ROUND`, `EXECUTION_STATE`, `TEST_STATES`, `CURRENT`, `MODULE_FAILED_TO_LOAD` and the other state constants (`packages/daemon/src/query/answer.ts`) (C14, C95).
- The daemon fixture's `vitest.config.mjs` files (`test/fixtures/daemon/daemon-lifecycle/packages/*/vitest.config.mjs`): a config that exports a plain object and imports nothing.

### Must Create

- The fixture under `test/fixtures/daemon/edit-corpus/` (AC1).
- The package-link helper in `harness.ts` (AC9).
- `packages/daemon/test/edit-corpus-sequences.ts`, the edits as data (AC2, AC3, AC7).
- `packages/daemon/test/edit-corpus.ts`, the check, its finding kinds and its clean report (AC4 to AC9).
- The Vitest bin lookup for the full run: `scripts/lib/defects/vitest.mjs`' `vitestEntry` reads `bin.vitest` from the manifest, but it is private to a frozen script (P11) and resolves the repository's Vitest 5, so the check reads the linked `vitest-4` manifest the same way.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The sprint's correctness targets are requirements measured over this corpus (`_agent-docs/sprints/sprint-2-fresh-runs.md`, the sprint objective): "no duplicate execution (NFR1) and no failure a full run finds that the selected run misses (NFR2)". It builds after 2.4b, whose `queryWait` the check waits with, and 2.4d, which 2.4b builds on; 2.3f and 2.3h, the scheduler it measures, have landed. The standing note from the owner's plan, relayed by the orchestrator: the corpus drives RT Test's own daemon against plain Vitest.

This ticket changes no production file. Dev builds the fixture, the check and the sequences; create-tests writes `packages/daemon/test/edit-corpus.test.ts` (a new file under P42: no daemon test file sets up a four-workspace consumer with linked packages), one `D###` test per sequence asserting its clean report, each with a record in `packages/daemon/test/defects.json` whose mutation, in selection or scheduler code, its sequence detects (orchestrator, Q1).

Requirements (`docs/requirements.md`):

- "NFR1: Never execute a test while it holds a current result for the same input fingerprint, except to falsify it or to rerun an invalidated run." (AC6)
- "NFR2: Find in every selected run each failure that a full run over the same input snapshot finds, across the controlled edit corpus." (AC5, AC7)
- "FR7: Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts." (AC3, the declared run sets)

#### Rule clauses the criteria rest on

- `docs/testing.md` § Selection validation: "For each controlled edit, run the selected tests and an independent full baseline against the same input snapshot. Compare discovered failures and invalidated states, not just exit codes. Keep negative controls where unrelated changes should retain evidence." (AC2, AC5, the docs edit and the unchanged save)
- `docs/testing.md` § Performance validation: "Keep repeatable benchmarks out of correctness tests where machine timing would cause flakes." (Q5; the corpus measures no cost)
- `docs/plan.md` § Targets: "Duplicate execution | A test run again while it holds a current result for the same input fingerprint (NFR1) | 0" and "Selection miss | A failure a full run over the same input snapshot finds that the selected run did not (NFR2) | 0". (AC5, AC6)
- `docs/architecture.md`, the selection paragraph: "`selectTests` maps a change, a set of root-relative paths, to Vitest workspaces: each path selects the deepest package workspace holding it and every workspace that depends on it, each through one shortest chain of edges and widenings. A path `rt-test.json` declares a non-input ... selects nothing" and "a config file in a Vitest workspace's directory and a setup or global setup file select their Vitest workspaces and those workspaces' dependents." (AC3)
- `docs/architecture.md`, the tracker paragraph: "An event naming only a declared non-input is dropped before it is queued, so it moves no revision and no job." (AC3, the docs edit)
- `docs/architecture.md`, the query paragraph: a test's state is "its outcome when it finished; interrupted; its module not run, crashed or failed to load; ...", and "it is current only when the digest it was stored under equals that fingerprint". (AC5)
- AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states. A zero-test selection is not proof of success." (AC5, AC7)
- `docs/roadmap.md` § M1 acceptance: "Selected-run outcomes match full-run outcomes across the edit corpus with no duplicate execution." (AC5, AC6)

Glossary (`docs/glossary.md`), verbatim:

- **Duplicate execution**: "Running a test again while it holds a current result for the same input fingerprint."
- **Selection**: "The tests a change requires running, each with its reason."
- **Broad fallback**: "A widening to a whole workspace or project, named with the input that triggered it."
- **Declared non-input**: "A file the consumer lists in `rt-test.json` as read by no test, so a change to it changes no input fingerprint and selects nothing."
- **Edit**: "A change to an input that the daemon does not attribute to one of its own runs or discoveries."
- **Wait**: "A query that returns once every test covering the given files has a current result or an explicit non-current state, or earlier as superseded or unsettled."

In this ticket, "an edit" names one entry of the corpus: a change the check saves into the consumer's copy. Not every entry is an **Edit** in the glossary's sense: the docs edit changes a declared non-input, the unchanged save changes nothing, and the second part saved while a run is going is a change the daemon attributes to that run (ticket 2.3k). That is why the proposed **Edit corpus** entry speaks of changes saved, not edits.

#### Orchestrator rulings

Asked by `session_wake` at 04:51 on 2026-09-30, answered at 04:53; decider the orchestrator.

- Q1 (process split): dev builds the fixture, the check and the sequences as data; create-tests writes one `D###` test per sequence, each asserting a clean report, with a record in selection or scheduler code the sequence detects. The orchestrator allocates the ids at the tests dispatch.
- Q2 (the edits, AC2): the edit mix is weighted by Fleet Cooling's measured history (§ Edit mix); in: a shared-library source edit that breaks dependents and its fix, a mid-level source edit, a test module added and one deleted, a rename with one importer missed and then fixed, a docs edit, an unchanged save, an edit saved while a run is going, one Vitest config edit standing for the broad fallbacks; out, by the owner's ruling at 03:25 that RT Test chases no edge cases: env files, tsconfig, lockfile and manifest edits, branch switches, and a restart, which `daemon.test.ts`' D2691 covers.
- Q3 (precision, AC3): each edit declares the exact workspaces it must run, derived from architecture's selection rule, and a run outside that set is a finding. It is load-bearing: a daemon that reruns every workspace on every edit passes both targets, since ticket 2.3g widens each workspace's fingerprint with its selection, so this check is what stops it.
- Q4 (AC1): Vitest 4.1 only; 5.x is a known limit (§ Known limits).
- Q5: 2.5 measures NFR1 and NFR2 only. The costs earlier tickets left "for 2.5 to measure" (the dependency build against its 120 s bound, 2.3j; the rediscovery and protection walk each round, 2.3f; re-judging many pending waits, 2.4b; the accepted-path narrowing, 2.3g T6) are read on the Fleet Cooling trial, since a four-workspace synthetic fixture cannot measure a large consumer and `docs/testing.md` keeps benchmarks out of correctness tests. The sprint's § Ticket 2.3f says so (create-ticket, under the orchestrator's grant).
- Q6: a finding against unmodified code is reported to the orchestrator as a suspected product defect, with the sequence's report, and never fixed inside this ticket; the edit and its sequence stay as written.
- Baseline supersede (dev's finding, rt-t2-5-dev at 10:30 on 2026-09-30; ruled at 10:31; decider the orchestrator; AC4): Q: the baseline `queryWait`, sent right after the start, answered superseded at revision 1 in 8 of 8 runs. Before the first discovery no declared pattern applies, so the fixture's `README.md` files are inputs; once the discovery lands they drop out and the revision moves, which the wait correctly reports, and nothing reads current meanwhile. Does the check treat that as a finding? A: option (b). The baseline's wait may answer superseded once, only when every changed path it names is a declared non-input, and the check then waits again at the newer revision; any other baseline supersede stays a finding. With one re-wait, all four sequences reported clean (dev, 10:30).

#### Edit mix

Fleet Cooling's last 400 non-merge commits (2026-09-18 to 2026-09-29, `git log -400 --no-merges --name-only`, read-only at `C:/source/fleetcooling`, 04:47): workspace source files changed 2208 times, test modules 1333 (301 of them added), docs `.md` 875, root scripts 39, `package.json` 6, Vitest configs 5, the lockfile 4, setup files 3, tsconfig 1, env files 1; 288 workspace files were deleted, and renames were common. Its five Vitest 4.1 workspaces form the graph the fixture copies: `packages/lib` under `packages/ui` and `packages/convex`, all three under `apps/admin` and `apps/storefront`, each dependency declared as `workspace:*` and imported by package name. Its busiest workspace by far is `packages/convex` (2308 file changes), a depended-on package, so most real edits select that package and its dependents.

#### Fixture shape

A design for dev, who may change names and contents while keeping the criteria:

- Root: `package.json` (`private`, `workspaces: ["apps/*", "packages/*"]`), `rt-test.json` (`{ "nonInputs": ["**/*.md"] }`, as Fleet Cooling would declare its docs), `README.md`.
- `packages/lib` (`@corpus/lib`): a pricing module and an index re-exporting it, with an `exports` map whose subpath pattern (`"./*": "./src/*.mjs"`) serves each source file, so a dependent can import a file of it directly and the rename changes no manifest (§ Settled facts); lib's own tests import through its index; its tests, one of them skipped; `README.md`.
- `packages/ui` (`@corpus/ui`, depends on `@corpus/lib`): a label formatter importing lib's pricing file by subpath; its test.
- `packages/backend` (`@corpus/backend`, depends on `@corpus/lib`): a quote builder using lib; its tests; it stands in for Fleet Cooling's Convex package, run as plain Vitest, since the Convex adapter is M3.
- `apps/web` (`@corpus/web`, depends on all three): a checkout module importing lib by package name, and ui and backend; two test modules, exactly one of which, not the one holding the label test, imports lib's pricing file by subpath; a setup file its config names.

The harness writes nothing into the fixture; it links `node_modules/vitest` to `vitest-4` and `node_modules/@corpus/<name>` to each package in the copy.

#### Sequences

A design for dev. Each run set follows § Rule clauses: a path selects its package workspace and every dependent, a config file its workspace and dependents, a declared non-input or an unchanged file nothing. Each sequence starts from the committed fixture, with a baseline that runs all four workspaces once.

| Sequence                     | Edit                                                                                                                    | Declared runs         | Declared full-run failures                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------- |
| Shared library               | lib's pricing source changes a value every dependent asserts                                                            | lib, ui, backend, web | a test in each of the four                           |
|                              | the same file restored                                                                                                  | lib, ui, backend, web | none                                                 |
|                              | the same file saved again with its bytes unchanged                                                                      | none                  | none                                                 |
| Inside packages              | ui's source changes a label web's test asserts                                                                          | ui, web               | ui's and web's label tests                           |
|                              | a test module added to backend, holding a failing test                                                                  | backend, web          | ui's and web's label tests, and the new test         |
|                              | one of web's test modules deleted, not the one holding its label test                                                   | web                   | ui's and web's label tests, and the new test         |
| Rename                       | lib's pricing file renamed, lib's index and ui's import updated in one burst, web's subpath import of the old name left | lib, ui, backend, web | web's module that imports the old name fails to load |
|                              | web's import fixed                                                                                                      | web                   | none                                                 |
|                              | the root `README.md` and `packages/lib/README.md` edited                                                                | none                  | none                                                 |
| Config and a run in progress | backend's `vitest.config.mjs` changes a setting no test's outcome depends on                                            | backend, web          | none                                                 |
|                              | backend's source changes a value a web test asserts; once backend or web is running, that web test is updated to it     | backend, web          | none                                                 |

Declared failures are every failure the full run finds after the edit, those an earlier edit of the sequence left included.

The last edit's second part lands while a run is going only when the check sees one running first; if the runs end before it lands, the two parts run in sequence instead. It changes only web's test, which lies in web's inputs and outside backend's, so backend's run is never interrupted by it and web runs at the final content either way: the settled state and the declared run set are the same whatever the timing, and only the daemon's path to them differs. A second part that restored backend's own file would not be: whether backend's interrupted run stored anything would decide its run set.

Each sequence should be detectable by at least one mutation in selection or scheduler code, which create-tests picks and proves: for example, a selection that stops at the changed path's own workspace (a selection miss in the shared library sequence), a rediscovery skipped for a new test module (a disagreement in the inside-packages sequence), a deleted path that selects nothing (the rename sequence), and a scheduler that reruns a workspace whose result is current (a duplicate execution or a run outside the declared set). A sequence no such mutation fails measures nothing; tell the orchestrator if one cannot be made detectable.

#### Settled facts

Settled by create-ticket on 2026-09-30.

- Vitest 4.1.11's JSON reporter (`node_modules/.bun/vitest@4.1.11+4a7f3e615f259300/node_modules/vitest/dist/chunks/index.UpGiHP7g.js`, `JsonReporter.onTestRunEnd`, lines 3538 to 3614; types in `dist/chunks/reporters.d.DtoKVV2s.d.ts`, `JsonTestResult` and `JsonAssertionResult`, lines 2297 to 2331): one `testResults` entry per module, `name` its absolute file path, `status` `failed` when the module has a file error or a failed test, `message` the first file error's message, and `assertionResults` with `ancestorTitles`, `title` and `status`, which maps Vitest's `pass`, `fail`, `skip` and `todo` to `passed`, `failed`, `skipped` and `todo`. The report goes to `outputFile` resolved against the config root.
- Spike (a scratch Node script, deleted once answered, 04:56, Windows, Node 24, Vitest 4.1.11 via `vitest-4`, spawning `node <vitest-4 bin.vitest> run --reporter=json --outputFile <file outside the tree>` in each workspace's directory): a two-workspace consumer with `node_modules/@corpus/lib` a junction to `packages/lib` resolved `import { price } from "@corpus/lib"` from `apps/web`; a module importing a missing file was reported as `{"status":"failed","message":"Cannot find module '../src/missing.mjs' imported from ...","tests":[]}`; a skipped test read `skipped` and a todo `todo`; `vitest run` exited 0 for a passing workspace and 1 for a failing one, in 719 ms and 910 ms; and the only files it wrote into the tree were `<workspace>/node_modules/.vite/vitest/<hash>/results.json`.
- Second spike (a scratch Node script, deleted once answered, 05:10, the same setup): `packages/lib/package.json` with `"exports": { ".": "./src/index.mjs", "./*": "./src/*.mjs" }` and `node_modules/@corpus/lib` a junction to it; `apps/web`'s test importing `@corpus/lib/pricing` passed (exit 0); after `src/pricing.mjs` was renamed to `src/prices.mjs` and the index updated, with no manifest edit, the full run reported `{"status":"failed","message":"Cannot find package '@corpus/lib/pricing' imported from .../deep.test.mjs","tests":[]}` and exited 1. So the rename sequence needs no manifest edit, and its miss is a module that fails to load.
- Those writes are never inputs: `InputFilter` (`packages/daemon/src/inputs/input-filter.ts`) excludes "a path ... when a segment of it is a skipped directory name", from `SKIPPED_DIRECTORIES` in `selection/source-walk.ts`, which holds `node_modules`.
- The daemon's test identity takes its module path relative to the workspace's real directory with `/` separators (`relativePosixPath(realDirectory, realPath(moduleId))`, `packages/daemon/src/vitest/module-tests.ts`), so the full run's absolute `name` maps onto it through the workspace directory's real path.
- The daemon records a test Vitest declares `skip` or `todo` as skipped alike (`DECLARED_SKIP_MODES` in `packages/daemon/src/vitest/run-states.ts`), so AC5 counts the full run's `todo` as skipped.
- The store returns a worktree's runs in sequence order (`SELECT_RUNS ... ORDER BY sequence`, `packages/daemon/src/store/read-runs.ts`), each with `inputFingerprint` (a digest, or not fingerprinted) and `adapterVersion`, which AC6 compares.
- This repository already runs the Vitest command line with `--reporter=json` and `--outputFile` (`scripts/lib/defects/vitest.mjs`, `vitestArgs`), so the full run is not a first call to a third-party API.
- Timing: `daemon.test.ts`' D2691 and D2692 (a two-workspace daemon started, run once, and one edit rerun) took 11.8 s and 12.1 s on an idle Windows machine (04:50, `bun x vitest run packages/daemon/test/daemon.test.ts -t "D2692|D2691" --reporter=verbose`). Every edit also rediscovers every confirmed workspace, since the discovery's fingerprint covers every input (ticket 2.3f), so a four-workspace step costs more; AC10 bounds each sequence.

#### Contracts this ticket relies on

- **2.4b's wait on the corpus's paths** (its AC1, AC2 and AC7, quoted): "A wait first reads each named file through ticket 2.4d's named read, then binds to the input revision the daemon holds once those reads and every input event seen before the request have been read ... so a file saved before the request, whose change the watcher has not yet reported, belongs to that revision"; "a new or deleted file is covered as its change would select"; "A named file no workspace covers, such as a declared non-input, is answered as covered by no test, with selection's reason"; and a wait is refused only for a path "outside the consumer root, a directory, a spelling 2.4d refuses on Windows" or more paths than the bound. So a wait naming every file of a burst (the rename's old and new paths included) binds after the whole burst, a deleted path and a declared non-input settle, and none is refused. The first task confirms this in the landed code.
- **No-op edits move no revision.** `docs/architecture.md`: "An event naming only a declared non-input is dropped before it is queued, so it moves no revision and no job." Sprint § Ticket 2.3f names "a save of identical bytes" as a change that does not move the input revision. AC4's revision check rests on both.
- **A save the daemon attributes to a run still reruns its workspace once.** `docs/architecture.md`: "A workspace that becomes due three times in a row only through changes the daemon's own runs and discoveries made to the same input is held"; attribution changes nothing else. The last edit's second part changes web's inputs, so web becomes due at the new revision and runs, whether or not that save is attributed to backend's run; one attributed change cannot make three dues in a row, so nothing holds web.

#### Decisions taken here

- **A duplicate compares a run with its workspace's previous stored run only.** The shared library sequence's restore returns lib's inputs to the baseline's fingerprint; the result at that fingerprint was superseded by the edit's run, so running it again is required, not a duplicate (the query paragraph: "No older run answers for a test").
- **Declared failures make the oracle's comparison non-vacuous** (C60). Without them, an edit that drifted into breaking nothing would compare clean against a daemon that selects nothing.
- **The daemon's side is read from the store for outcomes and from the answers for freshness**, since no answer lists each test's outcome by name; the wait's named failures are bounded and cover only its covering workspaces, which is exactly what AC3's precision check must see past.
- **The check waits for the whole daemon to go idle after the wait settles**, so a workspace run outside the declared set is counted rather than missed because it had not started yet.
- **Grill (create-ticket, 05:01 to 05:04 on 2026-09-30; each settled from a rule, a doc or the code, so none went to the orchestrator).** (1) Declared failures stay (C60). (2) Every disagreement between the daemon and the full run is a finding, not only a selection miss, since `docs/roadmap.md` § M1 asks that "Selected-run outcomes match full-run outcomes". (3) Half of `DAEMON_TEST_TIMEOUT_MS` is an assumption, not a measurement of the gate's load: D2692 runs at a tenth of the cap idle and `docs/testing.md` § Known flakes lists no daemon test timeout; a sequence that times out under the gate is split (AC10). (4) The baseline had no files to wait on, so it waits on every test module (AC4). (5) The during-run edit could poll forever for a run that had already ended, so it saves its second part once its first wait answers too (AC4). (6) Declared failures are cumulative across a sequence (AC7, § Sequences). (7) The last edit's second part changes web's test rather than restoring backend's file, since a restore mid-run would make backend's run set depend on whether its interrupted run stored anything. (8) The docs edit, the unchanged save and a save during a run are not glossary **Edits**, so the proposed **Edit corpus** entry reads "changes saved to it" (§ Doc text).
- **Ticket review (create-ticket 6c, 05:03 to 05:12 on 2026-09-30): 16 findings, all applied.** F1 declares each dependency in the fixture task; F2 says how to read a module that failed to load in the report; F3 compares declared failures both ways, names the kind "declared failures not matched", and compares nothing after an unusable full run; F4 waits on both parts' files; F5 drops process wording from AC2, AC3 and AC7; F6 puts the report file in the run's temp root; F7 lets the daemon hold a failed-to-load module's tests; F8 serves lib's files through an `exports` pattern, settled by the second spike, so the rename needs no manifest edit; F9 moves the subpath import to one web test and to ui, so exactly one web module fails to load; F10 starts a split sequence's second half with the first half's edits applied; F11 was settled from 2.4b's criteria (§ Contracts); F12 widened the sibling scan; F13 was closed by AC4's revision check rather than a quiet interval, since the revision is an observable outcome and a sleep is not; F14 stands on architecture's hold rule (§ Contracts); F15 lists root scripts among the edits not measured; F16 gives the new test file its P42 reason.
- **Scope of the analysis.** Analyzed: each edit kind in § Sequences, a revert, an unchanged save, a declared non-input, a module that fails to load, a new and a deleted test module, an edit during a run, and how duplicates, misses and runs outside the declared set are read. Not analyzed: Vitest 5, the other edit kinds Q2 left out, and every cost target (Q5).

#### Known limits

- The corpus runs Vitest 4.1 only; Vitest 5 selection and runs are covered by the existing discovery and run tests, not measured here (Q4).
- The edit kinds Q2 left out (env files, tsconfig, lockfile and manifest edits, branch switches, a restart) are not measured by the corpus; the tests that built each of them cover them. Root script edits (39 of Fleet Cooling's 400 commits' changes), which Q2 neither included nor ruled out, are not measured either, since a root-owned path selects every workspace, the case the shared library sequence already reaches; the Vitest config edit stands for setup files.
- A run the daemon interrupts stores nothing, so a duplicate execution that a later edit interrupts before it stores is not seen by AC6; the run set check (AC3) still sees the rerun that follows.
- The corpus's fixture has no Convex adapter; file-level selection and the adapter are M3, whose acceptance extends this corpus.
- A wait sent before a consumer's first discovery answers superseded once when `rt-test.json` declares non-inputs, as the declaration first applies: until a discovery is stored no declared pattern applies, so the declared files count as inputs, and they drop out, moving the revision, when it lands (orchestrator, 10:31).

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.5` over `packages/daemon/test/daemon-harness.ts`, `packages/daemon/test/harness.ts`, `packages/daemon/test/defects.json`, `test/fixtures/daemon`, `packages/daemon/src/query-client.ts`, `packages/daemon/src/client.ts` and `packages/daemon/src/store/open-store.ts` (04:52) named 2.3n, 2.3o, 2.4b and 2.4d. Rerun at 05:10 with `packages/daemon/src/query/answer.ts`, `daemon/protocol.ts`, `store/read-runs.ts`, `vitest/run-states.ts`, `vitest/module-tests.ts` and `inputs/input-filter.ts` added: 2.4b names `answer.ts` and `protocol.ts` (it writes both); 2.4d names `input-filter.ts` only to reuse `absoluteInputPath`, and changes none of the exclusion § Settled facts relies on; 2.3o names them by folder.

- **2.4b** (ready-for-dev, builds before this ticket): delivers `queryWait`, which AC4 calls, and writes `query-client.ts`, `client.ts`, `query/answer.ts`, `protocol.ts` and `packages/daemon/test/defects.json`; this ticket reads the first four and create-tests appends to the last after it.
- **2.4d** (ready-for-dev, builds before 2.4b): writes `query-client.ts`; its line naming `harness.ts` is about query code, and it writes neither harness.
- **2.3n** (ready-for-dev): reads `daemon-harness.ts`' `withEnvironment` and `withPreload` and edits neither; it gives each executor process the daemon's environment snapshot, which changes nothing the corpus observes.
- **2.3o** (ready-for-dev): names these files only by folder and writes none of them.

#### Sizing

Raw 28 files: the fixture (23 new files of one repeated per-workspace shape: manifest, config, source, test; web holds two test modules, since the inside-packages sequence deletes one), `edit-corpus.ts` and `edit-corpus-sequences.ts` (new), `harness.ts`, and for create-tests `edit-corpus.test.ts` (new) and `packages/daemon/test/defects.json`; 36 estimated (28 times 1.3 is 36.4), past the 30-file limit. Sized on the decision-bearing files alone, 5 raw and 7 estimated (6.5), with the fixture a separate figure of 23; the ruling below was asked at 22 fixture files, before the grill found web's second test module. Code units 11 (10 criteria plus validation), within 15. One dependency chain (fixture, sequences, check), so dev builds it without delegating.

Ruling (asked by `session_wake` at 04:58 on 2026-09-30, answered at 04:59; decider the orchestrator): proceed as-is. The fixture is 22 files of one repeated per-workspace shape, sized apart as the skill allows, and the 5 decision-bearing files hold every choice; the check, the fixture and the edits are designed together, so a split would cut one behavior in two.

#### Current structure of the modified file

- `packages/daemon/test/harness.ts` (438 lines): `REPO`, `runTempRoot`, `inTempDir`, `copyFixture`, `linkVitest(dir, install)` (a `junction` from `dir/node_modules/vitest` to the resolved install), `inConsumerCopy(fixture, install, body)`, `fixtureRepository(root)`, `confirmEvery(consumerRoot)`, and the run and selection-fact helpers other daemon tests use.

#### Existing tests this change breaks

None: every file but `harness.ts` is new, and `harness.ts` only gains an export.

#### Doc text

Dev reports this text with the build; the orchestrator writes it (C7).

- `docs/testing.md` § Selection validation, after its first paragraph: "The edit corpus (`test/fixtures/daemon/edit-corpus/`, checked by `packages/daemon/test/edit-corpus.ts`) does this for a consumer shaped like Fleet Cooling, on Vitest 4.1: each sequence of edits is replayed against RT Test's own daemon from the committed fixture, and after each edit, once a wait on its files has settled and the daemon is idle, a full run by plain Vitest's command line over the same files is compared with the daemon's answers test by test. The check reports a selection miss (NFR2), a duplicate execution (NFR1), a workspace run outside the set the edit declares, a declared run that did not happen, and an edit whose full run no longer fails what it declares. Vitest 5 is not in the corpus."
- `docs/glossary.md` § Results and runs, after **Duplicate execution** (accepted by the orchestrator at 04:59, which writes them at this ticket's authoring commit):
  - **Edit corpus**: "The committed synthetic consumer and the sequences of changes saved to it, each replayed against RT Test's own daemon beside a full run by plain Vitest, over which duplicate execution and selection misses are measured." _Avoid_: test corpus, benchmark
  - **Selection miss**: "A failure that a full run of plain Vitest over the same input snapshot finds and the daemon's current results do not." _Avoid_: missed test

#### Previous ticket

2.4b (ready-for-dev, not yet built): `queryWait(consumerRoot, paths, options?)` with an optional `limitMs`, resolving with the wait answer, whose outcome is settled, superseded or unsettled, as exported constants in `query/answer.ts`; `WAIT_LIMIT_MS` (100 s) and `MAX_WAIT_LIMIT_MS` (1 hour) in `protocol.ts`. The names are its ticket's; the first task confirms them in the landed code.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md`, the objective and § Ticket 2.5, § Ticket 2.3f, § Ticket 2.4b.
- `docs/testing.md` § Selection validation and § Performance validation; `docs/plan.md` § Targets; `docs/roadmap.md` § M1.
- Tickets 2.4b, 2.3f, 2.3g, 2.3h and 2.3j (`_agent-docs/tickets/`).
- GitHub issues: none open (`node scripts/list-open-issues.mjs`, 04:52: "0 open issues, complete").

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C7,C8,C13,C14,C30,C32,C60,C93,C94,C95,C106,C131,C132,C141,C154,C161 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P4,P10,P11,P13,P15,P21,P23,P24,P27,P28,P31,P35,P42,P44,P45 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area:
  - packages/daemon
  - test
is_consolidation: false
sizing_ac_count: 11
files_to_modify:
  - packages/daemon/test/harness.ts
  - packages/daemon/test/defects.json
files_to_create:
  - packages/daemon/test/edit-corpus.ts
  - packages/daemon/test/edit-corpus-sequences.ts
  - packages/daemon/test/edit-corpus.test.ts
  - test/fixtures/daemon/edit-corpus/package.json
  - test/fixtures/daemon/edit-corpus/rt-test.json
  - test/fixtures/daemon/edit-corpus/README.md
  - test/fixtures/daemon/edit-corpus/packages/lib/package.json
  - test/fixtures/daemon/edit-corpus/packages/lib/vitest.config.mjs
  - test/fixtures/daemon/edit-corpus/packages/lib/README.md
  - test/fixtures/daemon/edit-corpus/packages/lib/src/pricing.mjs
  - test/fixtures/daemon/edit-corpus/packages/lib/src/index.mjs
  - test/fixtures/daemon/edit-corpus/packages/lib/test/pricing.test.mjs
  - test/fixtures/daemon/edit-corpus/packages/ui/package.json
  - test/fixtures/daemon/edit-corpus/packages/ui/vitest.config.mjs
  - test/fixtures/daemon/edit-corpus/packages/ui/src/label.mjs
  - test/fixtures/daemon/edit-corpus/packages/ui/test/label.test.mjs
  - test/fixtures/daemon/edit-corpus/packages/backend/package.json
  - test/fixtures/daemon/edit-corpus/packages/backend/vitest.config.mjs
  - test/fixtures/daemon/edit-corpus/packages/backend/src/quote.mjs
  - test/fixtures/daemon/edit-corpus/packages/backend/test/quote.test.mjs
  - test/fixtures/daemon/edit-corpus/apps/web/package.json
  - test/fixtures/daemon/edit-corpus/apps/web/vitest.config.mjs
  - test/fixtures/daemon/edit-corpus/apps/web/src/checkout.mjs
  - test/fixtures/daemon/edit-corpus/apps/web/test/checkout.test.mjs
  - test/fixtures/daemon/edit-corpus/apps/web/test/cart.test.mjs
  - test/fixtures/daemon/edit-corpus/apps/web/test/setup.mjs
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 83d79fdd-44ba-4fdb-a225-da5d98b03268

#### Test Files This Change Broke

None. `harness.ts` only gains `linkWorkspacePackages`; no existing test changed behavior.

#### ACs Owed a Test

- AC3: a workspace run outside an edit's declared set, or a declared workspace with no run, is reported. Only a mutation in selection or scheduler code proves the check sees it; every run so far was clean.
- AC5: a failure the full run finds that the daemon's current results do not hold is reported as a selection miss. That needs a selection mutation, such as a selection that stops at the changed path's own workspace.
- AC6: a run stored under the fingerprint and adapter version of its workspace's previous fingerprinted run is reported as a duplicate execution. That needs a scheduler mutation that reruns a current workspace.

#### Tests Owed

- Per Q1, `packages/daemon/test/edit-corpus.test.ts` (new) holds one `D###` test per sequence of `EDIT_CORPUS` (`edit-corpus-sequences.ts`). Each asserts `expect(await checkSequence(SEQUENCE)).toBe(CLEAN)` (`edit-corpus.ts`) with `DAEMON_TEST_TIMEOUT_MS` as its timeout, plus a record whose mutation in selection or scheduler code that sequence detects. Measured cost: about 26 s per sequence on Windows and 15 s on Linux, so four tests add about 100 s of daemon time to the Windows suite.

### Tests Record

Tests session: threadId 6ab805a3-d546-41d0-866b-231fc841bfd5

#### Named Defects

`packages/daemon/test/edit-corpus.test.ts` holds one test per sequence, each asserting `checkSequence(<sequence>)` is `CLEAN` under `DAEMON_TEST_TIMEOUT_MS`; the records are in `packages/daemon/test/defects.json`.

- D3466: Selection follows no dependency edge, so a change to the shared library selects lib alone, and the shared library sequence reports the failures the full run finds in ui, backend and web as selection misses and those workspaces as declared runs missing (AC5, AC3).
- D3467: The scheduler reads every workspace as having no stored run, so each new input revision reruns every confirmed workspace, and the inside packages sequence reports each workspace an edit did not reach as a duplicate execution and a run outside the declared set (AC6, AC3).
- D3468: The tracker's declared non-input match never matches, so the rename sequence's docs edit moves the input revision and runs every workspace, reported as an input revision moved and runs outside the declared set (AC4, AC3).
- D3469: Selection reads every changed path as owned by the root, so every edit runs every workspace, and the config and run in progress sequence reports runs outside the declared set (AC3).
- D3470: The daemon records a test that failed as passed, so after the shared library edit it runs exactly the declared workspaces yet holds each test the full run fails as a current pass, which the shared library sequence reports only as selection misses (AC5; review gap, NFR2's comparator).
- D3471: The corpus's duplicate execution comparison never reports, so a run stored under its workspace's previous fingerprint and adapter version reads clean; a test of `storedRunFindings` over runs shaped as the store returns them (AC6; review gap, NFR1's detector).
- D3472: The corpus compares a run with its workspace's first stored run rather than its previous one, so a run at a fingerprint only an older, superseded run held, as after a revert, reads as a duplicate execution; the same test also pins that a run after one stored not fingerprinted is none (AC6).
- D3473: The baseline's run-once check lets a workspace run twice, so a daemon that runs a workspace twice at its start, under two fingerprints, reads clean (AC3; review gap, the baseline run-once rule).

NFR1 has no product mutation that yields a duplicate execution alone: a second run of a workspace needs its stored result to read stale and `ranAlready` to pass at the same revision, two guards, and any one-edit mutation that reruns a current workspace also runs it outside an edit's declared set, as D3467 does. So D3471 and D3472 prove the check's own detector.

The verifier confirms each mutated sequence's report is not clean; it prints no report, so the finding kinds D3466 to D3469 name are traced through the code, not observed. D3470's were observed: in a disposable WSL clone with its record applied, its report held exactly four findings, each a selection miss at "lib's unit price raised", one per declared failure (11:33). The ticket's example of a deleted path that selects nothing is not observable here: the rename's new path and lib's index select the same workspaces, and a workspace's fingerprint is taken over the inputs that exist.

#### Deliberately Untested

- `packages/daemon/test/edit-corpus.ts`, `edit-corpus-findings.ts`, `edit-corpus-full-run.ts`, `edit-corpus-sequences.ts`: the check is test infrastructure the sequence tests run; D3466 to D3470 prove it reports the finding kinds a selection, scheduler or run-recording defect produces, and D3471 to D3473 prove its duplicate and run-once detectors directly. Its full run unusable, wait not settled and daemon not idle branches fire only on a harness or daemon failure no stable mutation makes (owner ruling, 03:25).
- The baseline's single supersede by declared non-inputs (orchestrator, 10:31): a wrongly accepted supersede is followed by a second wait and the full-run comparison, so it cannot report a stale result as current.
- `packages/daemon/test/harness.ts` `linkWorkspacePackages`: every sequence runs it, and a missing link fails the dependents' modules to load in the full run, which each test reports as undeclared failures or a full run unusable.

### Review Record

Review session: threadId 3ce153d2-2869-4261-8434-f660294989d6

Fixed in review (2026-09-30, 11:17):

- `edit-corpus-full-run.ts`: a workspace whose Vitest exit disagrees with its report (exit 1 with no failed module entry, as on an unhandled error; exit 0 with one) is full run unusable, so a full run cannot fail unnoticed.
- `edit-corpus.ts`: the during-run edit's first wait may answer superseded only when its second part was saved before that wait answered, and only naming the second part's paths (AC4).
- `edit-corpus.ts`, `edit-corpus-findings.ts`, `edit-corpus-sequences.ts`: the baseline declares each workspace run once, and a second stored run of one is a run outside the declared set (AC3).
- `edit-corpus.ts`: idle also requires no unread change (`inputs.pendingChanges` 0), since while any remain no result is current.
- `edit-corpus.ts`: a daemon-not-idle finding with no summary read says so rather than "undefined"; unused exports removed (`EDIT_CORPUS`, `BASELINE`, the workspace constants, the `FINDING` re-export).

Recorded, not fixed (owner ruling 03:25; none can read CLEAN over a failure the fixture produces):

- A workspace whose every module fails to load reads as full run unusable rather than as failed modules (AC7's wording); no corpus edit does this.
- A module failure beside reported tests (a file-level hook error, an empty `describe`) is compared on neither side; no fixture module has a hook.
- A duplicate reported after a crashed or failed run's retry at one fingerprint would be a false finding, not a false CLEAN; no sequence produces one.
- The full run inherits the outer Vitest worker's environment, and the linked Vitest's version is fixed by the `vitest-4` install name only.
- Outcomes come from the store and freshness from the answers (§ Decisions taken here), so a query-layer defect answering a wrong state is not measured; AC5's "the daemon's answers" reads as that pair.

#### Test Coverage Gaps

| Source                                                                        | Defect                                                                                                                                                                                                                                                                                                                                                         | Expected test                                                                                                                                                                                                                                                                                                                     | Severity |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `packages/daemon/test/edit-corpus-findings.ts` `daemonFindings`               | The comparison of the daemon's results with the full run reports nothing (for example `reportedTestFindings` returns `[]`), so a daemon that runs the right workspaces but stores or reads a wrong outcome reads CLEAN; D3466 to D3469 all still go red through declared-run-missing or run-outside-declared-set, so no test proves NFR2's own detector fires. | A proof whose only finding is a selection miss or disagreement: for example a record in `packages/daemon/src/vitest/run-states.ts` recording a failed test as passed, detected by the shared library sequence with its run sets unchanged.                                                                                        | HIGH     |
| `packages/daemon/test/edit-corpus-findings.ts` `duplicateFinding`             | The duplicate execution comparison never reports (an inverted digest or adapter comparison), so a daemon that runs a declared workspace a second time at the same fingerprint within an edit reads CLEAN; D3467's mutation still goes red through run-outside-declared-set, so no test proves NFR1's detector fires.                                           | A proof whose only finding is a duplicate execution, from a scheduler or store mutation if one exists, or otherwise a test of `storedRunFindings` over stored runs built as the store returns them (same digest and adapter version: one finding; a revert to an older digest, or a previous run stored not fingerprinted: none). | HIGH     |
| `packages/daemon/test/edit-corpus-findings.ts` `storedRunFindings` (baseline) | The baseline's run-once check never fires, so a daemon that runs a workspace twice at its start under two fingerprints (the declared non-inputs dropping out mid-run) reads CLEAN.                                                                                                                                                                             | Decide against the deliberately untested reasons: a proof if a stable mutation makes a baseline double run, otherwise record it untested with its reason.                                                                                                                                                                         | MEDIUM   |

Denominator: 4 named-defect tests in `edit-corpus.test.ts` against the check's finding kinds AC3 to AC8 name; the four proofs reach run-outside-declared-set, declared-run-missing and input-revision-moved observably, and selection-miss and duplicate-execution only alongside them.

### Completion Notes

Dev, rt-t2-5-dev, 2026-09-30 10:08 to 10:49, Tree 2 (`wt/2` at `638a3ab`).

**Built.**

- The fixture is under `test/fixtures/daemon/edit-corpus/`: 23 files, laid out by § Fixture shape.
  - lib's tests import through its index; one lib test is skipped.
  - ui imports `@corpus/lib/pricing` by subpath, and web's `cart.test.mjs` does too, which is what the rename breaks.
  - web's `checkout.test.mjs` holds the label test, the currency test and a test that reads what `setup.mjs` sets.
- `harness.ts` gains `linkWorkspacePackages`, which junctions each package workspace under `node_modules/<name>`.
- `edit-corpus-sequences.ts` holds the four sequences as data. Each change is typed (replace, create, delete, rename, resave), and a change that does not match the fixture throws.
- The check is split across three files:
  - `edit-corpus.ts` holds the replay: saves, waits, idle reads, the full run's call, and `checkSequence`.
  - `edit-corpus-findings.ts` holds the finding kinds and every comparison as pure functions.
  - `edit-corpus-full-run.ts` holds the plain Vitest 4.1 run through its command line, typed from `vitest-4/reporters`' `JsonTestResults`.
- The two files past the ticket's list come from `max-lines` (500 code lines). The single `edit-corpus.ts` came to 660.

**Sanity check.** No findings. One task offered `queryPathStatus` of each test module or `querySummary`'s counts for currency. Only per-file counts let a finding name its module (AC5), so the check reads `queryPathStatus` on the consumer root once and uses its `files`. A module's currency comes from its workspace being idle with no `notRunning`, since a failed module has no tests to count.

**Assumptions.** The table had none. The first task confirmed the 2.4b names in the landed code: `queryWait(root, paths, { limitMs })`, `WAIT_OUTCOME`, `ROUND`, `EXECUTION_STATE`, `CURRENT`, and `StoredRun`'s `inputFingerprint` and `adapterVersion`.

**Baseline supersede (Q6).** The first run of every sequence stopped at its baseline: superseded at revision 1 by `README.md` and `packages/lib/README.md`, 8 of 8 times. Reported to the orchestrator at 10:30; ruled (b) at 10:31 (§ Orchestrator rulings). The check follows it through `readNonInputs` and `declaredNonInputs`, with a protection that protects nothing. It accepts one supersede whose named paths are all declared non-inputs, none left unnamed, and waits again.

**Timings (AC10).** Each sequence including its baseline, on the final code:

| Sequence                     | Windows | Linux (WSL, Node 24.13.1) |
| ---------------------------- | ------- | ------------------------- |
| shared library               | 25.6 s  | 14.8 s                    |
| inside packages              | 26.6 s  | 15.5 s                    |
| rename                       | 24.6 s  | 13.6 s                    |
| config and a run in progress | 25.3 s  | 14.6 s                    |

- Windows ran at 10:45 with no leased run active. Linux ran through the run lease.
- Every figure is under 60 s, half of `DAEMON_TEST_TIMEOUT_MS`, so no sequence is split.
- The Windows run before the review's fixes read 26.1, 27.3, 24.4 and 26.0 s.
- Every run on the final code reported `clean` on both platforms.
- The stand-in test is deleted.

**Adversarial review** (10:34 to 10:43, 12 findings):

- F1 (HIGH) fixed: runs stored during the full run were uncounted, or charged to the next edit. Each step now reads the daemon again after the full run: a second idle read, then one store read for the run sets, the duplicates and the daemon side, with the path status and schedule taken at that moment.
- F3 fixed: the docblock now names every cause of a throw, including a summary, path status or store read that fails. Each fails loudly and never reads clean.
- F5 fixed: a start that confirms other than the fixture's four workspaces throws.
- F6 fixed: only a planned round counts as settled, so a held round is `daemon-not-idle`, with `roundText`'s reason.
- F8 fixed: a rename refuses an existing destination and makes its directory.
- F9 fixed: module subjects join with `posix.join`.
- F10 fixed: the store's failed module state is its own typed literal.
- F11 fixed: runs are read once per step, and `#find` uses the shared `finding`.
- F12 fixed: the docblock says `.test.mjs`.
- F2 discarded: AC4 and § Sequences let the second part land after the runs end, and let it trigger on backend running. The settled state and run set are the same either way.
- F4 discarded: `DeclaredFailures` covers failing tests and modules that fail to load. A module whose hook fails while its tests pass is compared on neither side, and no fixture test has a hook.
- F7 recorded: a full run that hangs past `FULL_RUN_BOUND_MS` is killed at its own process only. It fires only on a hang, per the 03:25 ruling.

**Validation.**

- `bun run --filter @rt-test/daemon typecheck` exit 0 (10:45).
- `bun x oxlint` over the four check files and `harness.ts` exit 0.
- `bun x prettier --check` over them and the fixture exit 0.
- `node scripts/check-line-citations.mjs` clean.

**README.** No user-visible behavior changed.

**Left for the orchestrator.**

- The doc text in § Doc text.
- The known-limit sentence for `docs/architecture.md`'s wait text (orchestrator, 10:31).

**Scratch, kept until the orchestrator closes the lane:**

- `_agent-docs/.scratch/2-5/`: each stand-in log and `linux.sh`.
- The WSL clone `~/rt-test-t2-5-dev`.
- The logs `~/.rt-test-runs/install-2-5-dev.log` and `~/.rt-test-runs/linux-2-5-dev-standin.log`.

**Change-request candidates.** None.

### File List

Dev, rt-t2-5-dev (2026-09-30):

- `packages/daemon/test/harness.ts` (modified: `linkWorkspacePackages`)
- `packages/daemon/test/edit-corpus.ts` (new)
- `packages/daemon/test/edit-corpus-findings.ts` (new)
- `packages/daemon/test/edit-corpus-full-run.ts` (new)
- `packages/daemon/test/edit-corpus-sequences.ts` (new)
- `test/fixtures/daemon/edit-corpus/` (new, 23 files): `package.json`, `rt-test.json`, `README.md`; `packages/lib/{package.json,vitest.config.mjs,README.md,src/pricing.mjs,src/index.mjs,test/pricing.test.mjs}`; `packages/ui/{package.json,vitest.config.mjs,src/label.mjs,test/label.test.mjs}`; `packages/backend/{package.json,vitest.config.mjs,src/quote.mjs,test/quote.test.mjs}`; `apps/web/{package.json,vitest.config.mjs,src/checkout.mjs,test/checkout.test.mjs,test/cart.test.mjs,test/setup.mjs}`
- `_agent-docs/tickets/2-5-edit-corpus.md` (modified: task and criterion boxes, Dev Handoff, Completion Notes, File List)

Tests, rt-t2-5-tests (2026-09-30):

- `packages/daemon/test/edit-corpus.test.ts` (new: D3466 to D3469)
- `packages/daemon/test/defects.json` (modified: D3466 to D3469)

Review, rt-t2-5-review (2026-09-30): `edit-corpus.ts`, `edit-corpus-findings.ts`, `edit-corpus-full-run.ts`, `edit-corpus-sequences.ts` (modified, § Review Record).

Planning files create-ticket wrote (2026-09-30):

- `_agent-docs/tickets/2-5-edit-corpus.md` (new)
- `_agent-docs/sprints/sprint-2-fresh-runs.md` (§ Ticket 2.5's scope line and ticket link; § Ticket 2.3f's cost sentence, under the orchestrator's 04:53 grant)
- `_agent-docs/sprint-status.yaml` (`2-5-edit-corpus` to `ready-for-dev`)

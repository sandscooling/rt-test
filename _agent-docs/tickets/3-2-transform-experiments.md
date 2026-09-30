# Ticket 3.2: Transform experiments in a reused instance

## Ticket

As the daemon, which falsifies a consumer's named defects in place of its coding agents,
I want a falsification job that runs one workspace's defect experiments in one reused Vitest instance, each mutation applied only in memory and each mutated site probed for which test executed it,
so that ticket 3.3 can judge every experiment from raw run facts alone, and no consumer file is ever written.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

Every criterion holds on Vitest 4.1.x and 5.x, on Windows and on Linux.

- [ ] AC1: Given a workspace, its confirmed config file and a list of defect experiments (each a defect id, its intended test's identity, and its mutation's absolute file with the exact `old` text and its `new` replacement), a falsification job loads that workspace's Vitest once and, in that one instance, runs the baseline over the intended tests' modules, then each defect's experiment alone (its intended test's whole module, the same specification the baseline ran for that module, with only its own mutation applied, so the mutation is the only difference between the two runs), then, when at least one experiment ran, the restored baseline over the same modules as the baseline. The workspace's `globalSetup` runs once for the whole job. A workspace whose config file is no longer the confirmed one loads nothing, and a Vitest that is unsupported or fails to load runs nothing; the job's record says which, with the reason. (FR10)
- [ ] AC2: An experiment runs only when the baseline passed its intended test, found by its full test identity. Otherwise its record says it was not run and why: the baseline did not pass that test (naming the state it had, or that the baseline did not report it), or no module of the workspace's resolved test modules holds that test, or the mutation's file cannot be read or `old` does not occur exactly once in its text when the job starts (naming the count; occurrences are counted as AC3 counts them), or the mutated site has no probe site (AC5). The restored baseline runs whenever at least one experiment ran. (FR10)
- [ ] AC3: During an experiment, and only then, the module its mutation names is served to every project of the workspace (the root project and each project `test.projects` lists) with `old` replaced by `new`, when `old` occurs exactly once in the text Vitest transforms for that module. Occurrences are counted without overlap, and a line break in `old` matches either LF or CRLF in the file; the replacement keeps the line endings the match used, so a file checked out with CRLF matches and mutates as one with LF does. The experiment's record says whether the mutation was applied, and when it was not, whether the mutated module was never loaded during the run or how many times `old` occurred in it. (FR10, NFR6)
- [ ] AC4: No run reads a module transformed for an earlier run of the job, or transformed from source text that was no longer the file's text on disk when the run began: an experiment runs with no other experiment's mutation, the baseline and the restored baseline run with none, and a source file edited while the job runs is served from its new text at the next run. Every run of the job (the baseline, each experiment and the restored baseline alike) runs each test file isolated, whatever isolation or worker reuse the workspace configures, so a test that passes only through another file's side effects fails the baseline and its experiment is recorded not run with that reason. When the job cannot establish that for a run, that run does not happen, and the record names the module or the reason. (FR10, ADR-0007)
- [ ] AC5: The mutated module carries a reach probe at the mutated site only where the probe firing means the changed code began executing: at the smallest syntax node enclosing the changed text, around an expression whose meaning a comma expression keeps, or before a statement in a statement list. Where no probe can be placed (the change sits in a callee, an assignment target, a type or any other position a call would alter, or the mutated module does not parse), the experiment is decided before the job's runs start, like an anchor that does not match: it never runs, and its record says "no probe site" and names the position (line, column and the kind of syntax node) or where the parse failed, never quoting source text, so the author can move the mutation. Should the text Vitest transforms still leave no probe site once the experiment runs, its record says reach is unknown and why. A probe never changes what the module does apart from recording reach, and never throws. (FR11, ADR-0008)
- [ ] AC6: For each test that ran in an experiment, the record says whether the mutated site executed for that test, and where. A site executed in a test (its body, or a `beforeEach` or `afterEach` run for it) marks that test. A site executed outside any test (while the file loaded, or in a suite's `beforeAll`) marks each test that runs in that file or suite and says it was outside the test, since each can read what that code set. A test in the same file that failed an assertion without executing the site is not marked. A site executed while tests run concurrently, where Vitest cannot say which one was running, reads reach unknown for each of those tests. A test the reach recorder did not observe reads reach unknown, never not executed. A site reached only in an `afterAll`, after the test's result is final, reads not executed: a known limit that makes the experiment invalid, never a detection. No mark carries from one test file to another, or from one run to the next. (FR11, ADR-0008)
- [ ] AC7: Each run's record (the baseline, every experiment, the restored baseline) holds facts only from the test modules that run executed: each module's state and its module and suite errors; each test's identity, state and the hook states Vitest recorded on its result; each error as the fields Vitest serialized for it (its name, its constructor marker, its assertion context and its message), never reduced to text alone; the run's unhandled errors in the same form; and whether the run ended cleanly (whether it was interrupted, whether Vitest force-stopped its workers, and any error cancelling it). The job's record carries the workspace's Vitest version, the falsifier version, and any error closing the instance. (FR11)
- [ ] AC8: Through a falsification job, neither RT Test nor the Vitest it loads writes, creates or changes a file in the consumer's tree, and no mutated text is written anywhere on disk; a job over a fixture whose own tests write nothing leaves every file in its tree byte-identical and creates none. A workspace in which a loaded project keeps an on-disk module cache on despite the session's override runs no experiment, and the job's record names the project and the setting. (NFR6)
- [ ] AC9: The daemon's executor runs a falsification job in an executor process of its own, as it runs every other job. A job whose executor process ends before it replies returns nothing to store and the reason. An abort ends the job at the run in progress, and the job's reply says it was interrupted and holds only the runs that finished. (FR10)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                                                                                                             | Why it matters if wrong                                                                                                                                                 | How to check                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1  | How does each Vitest line spell, on Windows, the module id a transform receives for a source file (drive letter case, separators, a `/@fs/` prefix, a query suffix), and does it name a file reached through a workspace package link by its real path?                                                                                | The mutation is matched to its module by that id. A spelling the match misses leaves the mutation unapplied, so every experiment on Windows reads "never loaded" (AC3). | Log the `id` of every transform call in a two-module fixture, with one module reached through a linked workspace package, on 4.1.11 and 5.0.1 on Windows.                                              |
| U2  | Does the stale-transform guard FINDINGS describes (each environment's `pluginContainer.transform` wrapped to record the input hash by module id, every still-cached module compared with its source before each run) work on Vitest 4.1.11 as it did on 5.0.1, where it alone was measured?                                            | Without it on 4.1, a run could read a transform an earlier run left or a stale source, and a leftover mutation could be credited to the next defect (AC4).              | Rerun FINDINGS' check on 4.1.11: switch the explicit invalidation off, and confirm the guard stops the run naming the stale module.                                                                    |
| U3  | Does Vitest 5.0.1 give a project `test.projects` lists, which has its own Vite config, a Vite server that does not carry the plugins passed through `createVitest`'s Vite overrides, as 4.1.11 does?                                                                                                                                   | Informational only: the mutation is applied inside the guard's per-environment wrap on every project's server, not through the overrides (dev's sanity check F4).       | Create a two-project fixture, pass a logging plugin through the overrides, and list which project servers call it; or read `createClusterServer` in 5.0.1's `dist/chunks/index.DzobfTyw.js`.           |
| U4  | Under `isolate: false`, or any pool that reuses a worker across `runTestSpecifications` calls, does the worker drop a module the main process invalidated before the next run?                                                                                                                                                         | Informational only: the orchestrator's Q1 ruling forces isolation in every job, so no criterion depends on the answer. Record it if you check it.                       | Run an experiment and then the restored baseline under `isolate: false` in one instance, and check the restored baseline's module text through its reach mark or a sentinel export.                    |
| U5  | Does the on-disk module cache a Vitest 4.1 project config can keep on (`experimental.fsModuleCache`, which the session's override does not reach there) store a module's transformed text, and can the job read, after load, whether each project has it on? Does any other on-disk cache of either line hold transformed source text? | A cache left on writes the mutated transform under the consumer's `node_modules`, breaking AC8 and NFR6; a flag the job cannot read leaves AC8's refusal blind.         | Search each line's `dist/` for the cache's write path and the resolved flag on a project's config; run an experiment in a fixture whose project config turns the cache on, and list the files created. |
| U6  | Does the guard's wrap of each environment's `pluginContainer.transform` see every transform on Vite 6 and 7, which Vitest 4.1 and 5 also accept, as it does on the installed Vite 8.3.1?                                                                                                                                               | A Vite line whose transforms bypass the wrapped method leaves the guard installed but blind, so AC4's refusal never fires.                                              | Read each Vite line's `transformRequest` path to the plugin container, or rerun U2's check with Vite 6.4 and 7 installed in the fixture.                                                               |

Resolutions (dev, 2026-09-30 18:23). The spike was `_agent-docs/.scratch/3-2/spike.mjs`, run on Windows 11 under Node 24.19 against the repository's 4.1.11 and 5.0.1 installs. Its fixture was a root config with an inline project (`isolate: false`), a second project with its own config file, and a workspace package reached through a junction under `node_modules`.

- **U1, CONFIRMED.** Both lines hand the transform the same id: an absolute path with `/` separators, an upper-case drive letter and long names, with no `/@fs/` prefix and no query (for example `C:/Users/<user>/AppData/Local/Temp/rt32-spike-xnGdgu/real/src/math.ts`). A module reached through the linked package is named by its real path (`real/packages/lib/src/index.ts`), never the `node_modules` link. The transform still compares by real path after dropping any `?` or `#` suffix, so a short-name or link spelling on another machine cannot miss.
- **U2, CONFIRMED on 4.1.11, and re-observed on 5.0.1.** After a mutated run with no invalidation, the next run served the mutated transform: its tests failed with the probe's mark. Comparing each cached module's recorded input hash with its file's text named `src/math.ts` in both project servers. Invalidating those modules cleared the comparison. An on-disk edit made between runs, with no invalidation, was served from the old transform, and the comparison named that file. Vite 8.3.1 `dist/node/chunks/node.js`: `doTransform` and `loadAndTransform` read `environment.pluginContainer` and call `pluginContainer.transform(code, id, ...)`, then cache with `moduleGraph.updateModuleTransformResult`. No watcher invalidates anything while `watch` is false.
- **U3, informational.** On 4.1.11, `instance.vite` is a server of its own beside the two project servers (3 in all). On 5.0.1 the root server is the inline project's (2 in all). The mutation applied in both project servers on both lines through the per-environment wrap. In 5.0.1 the CLI options reach projects for `isolate` and `fsModuleCache` (the overridable option list in `dist/chunks/index.DzobfTyw.js`, which holds both).
- **U4, informational, not checked.** Isolation is forced on every project, so no run shares a worker across files. The spike saw a different worker pid for each test file on both lines despite `isolate: false` in the config.
- **U5, CONFIRMED, with a second cache found.** 4.1.11 reads `project.config.experimental.fsModuleCache` (inherited from the root when unset, `cli-api.CnMVyzaz.js` in `initializeProject`'s `fsModuleCache` inheritance). The fetcher fixes `fsCacheEnabled` when it is built (`ModuleFetcher` constructor), so the flag is readable after load but cannot be turned off there. The cache saves the transformed `code` under `node_modules/.experimental-vitest-cache` (`fsCache.saveCachedModule`). 5.0.1 reads `project.config.fsModuleCache`. The second cache: on both lines the forks pool (`ForksPoolWorker.cacheFs = true`, the default pool) makes `ModuleFetcher.fetch` write every transformed module to `os.tmpdir()/<nanoid>/<environment>/<sha1 of id>`. Without a wrap the spike found 6 and 5 files in the two projects' temp directories on each line; with each project's `_fetcher` wrapped to pass `cacheFs` false it found none. The job therefore wraps `_fetcher` on every project, and refuses its runs where the wrap cannot be installed (orchestrator, 18:20: accepted as dev's).
- **U6, CONFIRMED for Vite 7, UNRESOLVABLE for Vite 6 (not installed anywhere on this machine).** Vite 7.3.1 (`dist/node/chunks/config.js` in the bun cache) has the same path: `doTransform` and `loadAndTransform` destructure `pluginContainer` from the environment and call `pluginContainer.transform`. Should a Vite line bypass the wrap, the design still fails safe. The mutation lives inside the wrap, so it reads "never loaded", never a detection. The guard treats a cached module with no recorded input as stale and invalidates it before the run, so nothing cached can pass unchecked.
- **Setup-file metadata round trip, CONFIRMED on both lines.** Metadata set in a setup file's `globalThis.__vitest_index__.beforeEach` hook, and set on `__vitest_worker__.current.meta` by a probe firing in a test body, came back through `TestCase.meta()`. A firing while the file loaded found `current` to be the file, not a test.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing, U1 and U2 first: they are the sprint's two open spike questions. Write each answer, with its observed output or source location, under the table.
- [x] (AC1, AC3, AC6) Let a workspace session take the mutation's transform for every project and a second setup file placed first in every project, beside the snapshot guard, without a mode flag (P19): discovery and ordinary runs stay as they are.
- [x] (AC3, AC5) Create the mutation transform: it matches the mutated module by the id spelling U1 settles, replaces `old` with `new` only when `old` occurs exactly once in the text it receives, places the reach probe in the mutated text through `parseGuarded`, and records per run whether it applied, how many times `old` occurred, and whether a probe was placed or why not. Apply it inside the per-environment `pluginContainer.transform` wrap the stale-transform guard installs on every project's server (the root's and each `test.projects` entry's), so it depends on no `createVitest` override on either line (dev's sanity check F4); U3 is informational. The probe calls a recorder the setup file defines, guarded so an absent recorder does nothing; the setup file marks each test it ran for as observed, so a test without that mark reads reach unknown rather than not executed (AC6).
- [x] (AC5) Create the probe placement: parse the mutated text, find the smallest node enclosing the changed text, and place the call only around an expression a comma expression keeps the meaning of, or before a statement in a statement list that is not a directive (such as `"use strict"`); return the reason for every other position, including a directive, and for a parse failure, as a line, a column and a node kind, never the source text. Before the job's first run, read each mutation's file and, in memory only, apply the mutation to that text and place its probe, so a defect with no probe site is recorded "no probe site" and never runs, and one whose file cannot be read or whose `old` does not occur exactly once is recorded not run with that reason (AC2, AC5).
- [x] (AC6) Create the reach setup file: it imports nothing, marks each test it runs for as observed, marks the running test's metadata when the probe fires during the test or its `beforeEach` or `afterEach`, marks each test that then runs in the suite or file current when the probe fired as reached outside the test, when it fires while no test is running (the file loading, or a suite's `beforeAll`), marks reach unknown for the tests running concurrently when it cannot attribute a firing, and clears that outside mark for each file. Confirm, on both lines, that metadata set in the setup file's hooks reaches the main process.
- [x] (AC2, AC3) Create the anchor matcher, `packages/daemon/src/falsify/anchor-match.ts`, standalone, with no executor or Vitest dependency. It counts `old`'s occurrences without overlap (split semantics, as `scripts/verify-defects.mjs` counts: `old.split` length minus one), where a line break in `old` matches LF or CRLF in the text. It locates the unique match and applies `new` with the line ending the match used. The job's start-time anchor check and the mutation transform both use it, and ticket 3.1 imports it for its anchor-missing state, so keep its exports stable (orchestrator ruling, 18:18).
- [x] (AC4) Create the stale-transform guard FINDINGS describes, and before each run invalidate the mutated files of the previous and next run and every module the guard finds cached from text other than its file's text on disk. When the guard cannot be installed or a stale module stays cached, the run does not happen and the record says why. Force isolation per test file in the falsification session over the workspace's config: `isolate: false`, and every equivalent worker-reuse setting you find on either line (orchestrator ruling Q1).
- [x] (AC1, AC2, AC7) Create the falsification job: one instance per job; the baseline, each experiment alone when its intended test passed the baseline and its probe has a site, running the intended test's whole module through the same specification the baseline ran for it (orchestrator ruling, 18:13), and, when any experiment ran, the restored baseline; each experiment that does not run recorded with its AC2 reason; each run's facts read only from the modules of the specifications that run executed, with each module's and suite's errors and each test's hook states; errors kept as Vitest serialized them; each run's interruption, force-stop and cancel error, and the instance's close error, on the record; a config that is no longer confirmed, or a Vitest that is unsupported or fails to load, on the job's record with its reason. Define the falsifier version beside the adapter version's pattern, and put it and the workspace's Vitest version on the job's record.
- [x] (AC9) Add the falsification job to the executor: its request and reply in `executor-jobs.ts`, its answer in `executor-main.ts` (loading the parser in that job alone, as the dependency build does), and an `Executor` method that returns nothing to store, with the reason, when the process ends before replying. Honor the abort signal between runs, checked with no await before the run starts (C160), and interrupt the run in progress as ordinary runs do, but leave the interrupted run out of the reply: it is marked interrupted and holds only the runs that finished.
- [x] (AC8) Confirm the session's no-write options and snapshot guard apply to the falsification session unchanged, and that nothing the job adds writes a file. After the instance loads, refuse the experiments of a workspace in which any project still has an on-disk module cache on (the documented Vitest 4.1 exception, a project config that sets `experimental.fsModuleCache` itself), naming the project and the setting (U5).
- [x] (Support) Report to the orchestrator the `docs/architecture.md` text for the falsification job (a new section under Vitest discovery and runs, and the executor's job list), since a docs lane is restructuring that file; write none of it yourself.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `inWorkspaceSession`, `queueSessionJob`, `SNAPSHOT_GUARD_FILE` and its built-extension pattern (`packages/daemon/src/vitest/workspace-session.ts`): the confirmed-config gate, host state restore, no-write options, and a setup file placed first in every project.
- `RunInterruption` (`packages/daemon/src/vitest/run-interruption.ts`) and its use in `runSession` (`run-workspace.ts`): abort handling and Vitest's force-stop during a run.
- `identifyTests`, `wasCollected`, `specificationsWithoutModule`, `moduleLocator` (`packages/daemon/src/vitest/module-tests.ts`): test identity for each recorded test, the placeholder-module check, and the missing-module check.
- `testIdentityKey`, `TestIdentity` (`packages/core/src/test-identity.ts`): matching the intended test by its full identity.
- `parseGuarded` (`packages/daemon/src/selection/source-imports.ts`), extended additively: its failure arm gains the first error label's offset, and its parser options are exported, so the probe reports where a parse failed without quoting oxc's message, which can quote tokens (dev's sanity check F2). It is the parser the dependency build uses, with the bracket-depth guard against the native stack overflow.
- `recordingHostRejections` (`packages/daemon/src/vitest/host-rejections.ts`), through `inWorkspaceSession`: host-thread rejections join the run's unhandled errors.
- `JobOutcome`, the `Executor` job plumbing, and `isExecutorReply`'s reply table (`packages/daemon/src/daemon/executor.ts`, `executor-jobs.ts`).
- `errorText` (`packages/daemon/src/vitest/error-text.ts`): only for the session-level failure reasons, never for a test's or run's errors in the record.
- The `VITEST_ADAPTER_VERSION` pattern (`packages/daemon/src/vitest/adapter-version.ts`) for the falsifier version.

### Must Create

- The falsification job, its request and its raw record types, under `packages/daemon/src/falsify/`.
- The mutation transform, the probe placement, the reach setup file and the stale-transform guard, under the same folder.
- The falsifier version constant.
- The anchor matcher, `packages/daemon/src/falsify/anchor-match.ts`, which ticket 3.1 also imports. Its stable exports, as dev reported them at 18:19: `countAnchor(text, anchor)`, `locateAnchor(text, anchor)`, `replaceAnchor(text, anchor, replacement)`, and the types `LineEnding`, `AnchorMatch` (`{ start, end, lineEnding }`), `AnchorLocation` (`{ found: true, match } | { found: false, count }`) and `AnchorReplacement` (`{ applied: true, text, match, replacementEnd } | { applied: false, count }`). An empty anchor counts 0.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### What the criteria rest on

FR10: "Falsify each defect definition by applying its mutation as an in-memory transform in a separate Vitest instance, between a baseline and a restored baseline that both pass its test, without writing any file."

FR11: "Decide each falsification verdict from run facts (failure phase, error kind, whether the mutated site executed during the intended test, the baseline result), counting as a detection only an assertion failure in the intended test after the mutated site executed, repeated in a confirming run." This ticket records the facts; 3.3 decides.

NFR6: "Leave every consumer file byte-identical through falsification, writing no mutation anywhere on disk."

ADR-0007: "Its executor loads one Vitest instance with RT Test's mutation plugin and runs the tests' modules unmutated (the baseline), then each defect's experiment alone, repeating once any experiment that would be a detection (ADR-0008), then the baseline again (the restored baseline). Before each run it invalidates the mutated file and every module a stale-transform guard finds cached from another source, so no run reads a transform an earlier run left. Each run's facts are read only from the modules of the specifications that run executed, since `runTestSpecifications` also returns the modules earlier runs left, with their old results. Global setup runs once per instance, so once per job."

ADR-0007, known limit: "code a test runs in a child process it spawns is read from disk, so a mutation there is never reached and the experiment is invalid, never a detection or a survivor."

ADR-0008: "The transform parses the mutated module with the parser the dependency build uses and places a call to a recorder at the smallest syntax node enclosing the changed text, only where the call firing means the changed code began executing: around an expression whose meaning a comma expression keeps, or before a statement in a statement list. A setup file RT Test places first in every project marks the test Vitest reports as running when the probe fires, through the test's metadata, which Vitest returns to the main process. Code that runs while the module loads marks every test of that test file, since each can read what it set, and the setup file clears that mark for each file. Where no probe can be placed, because the change sits in a callee, an assignment target, a type or any other position the call would alter, or the mutated module does not parse, reach is unknown and the experiment is invalid."

ADR-0008, the facts 3.3 reads from this ticket's record: "its state; the kind of each of its errors, which is an assertion when Vitest serializes it as an `AssertionError` or as a matcher failure it marks with the `JestExtendError` constructor and an assertion name (the form `expect.extend` matchers such as jest-dom's take), or when its name is one the consumer declares in `rt-test.json`, and otherwise another kind; the hook states Vitest records on the test's result; the module and suite errors; the run's unhandled errors; whether the mutated site executed during that test (reach); and the intended test's result in the baseline and the restored baseline."

ADR-0008, known limit: "Under `isolate: false`, a module a previous test file loaded runs no load-time code again, so its load-time site reads as not reached and the experiment is invalid rather than detected." The orchestrator's Q1 ruling forces isolation in every falsification job (AC4), so this limit no longer arises; the ADR text change is reported to the orchestrator.

C137 (checklist) is the reason AC2 skips an experiment whose baseline did not pass its test: a mutation experiment runs only after the unmutated baseline passes.

C138 (checklist) is the reason AC7 records how each run ended: "A detection or baseline also needs a run that ended cleanly: a missing run end, an unhandled error the runner reports or the runner's own process records, a forced exit (such as a close timeout) or a missing exit record makes it invalid, whatever the report says."

#### Facts settled in installed source (2026-09-30)

- **Error fields survive serialization.** `serializeValue` in `@vitest/utils@4.1.11` `dist/serialize.js` copies every own property name up the prototype chain into a plain object, so a `JestExtendError` (`@vitest/expect@4.1.11` `dist/index.js`, class at its `JestExtendError` declaration; 5.0.1 `dist/chunks/index.m3L2HgmY.js`) arrives with `name: "Error"`, a `constructor` field of `"Function<JestExtendError>"`, and `__vitest_error_context__: { assertionName, meta }`. Today's `RecordedTest.errors` are strings from `errorText`, which drops these fields, so the raw record needs its own error shape (AC7).
- **Hook states.** `TaskResult.hooks?: Partial<Record<keyof SuiteHooks, TaskState>>` (`@vitest/runner@4.1.11` `dist/tasks.d-DEYaIMIu.d.ts`). The public `TestCase.result()` does not expose it; `run-states.ts` already reads the runner task through a cast in `skippedItself`.
- **Test metadata reaches the main process.** `TestCase.meta(): TaskMeta` exists on 4.1.11 (`dist/chunks/reporters.d.DtoKVV2s.d.ts`) and 5.0.1 (`dist/chunks/plugin.d.CN87HSxv.d.ts`), and `TaskResultPack` carries `meta`.
- **The setup file can find the running test without an import.** The runner sets `__vitest_worker__.current` to the test in `onBeforeRunTask` (before its `beforeEach` hooks), back to its suite or file in `onAfterRunTask`, and to the file in `onCollectStart` (4.1.11 `dist/chunks/test.DNmyFkvJ.js`, 5.0.1 `dist/chunks/index.m3L2HgmY.js`, both at `this.workerState.current =`). Both lines define `globalThis.__vitest_index__`, the running Vitest's index with `beforeEach`, in `setupGlobalEnv` (4.1.11 `dist/chunks/base.B6Opl8PE.js`, 5.0.1 `dist/chunks/base.Cc3oda2V.js`). The setup file must import nothing, for the snapshot guard's reason: it runs in the consumer's worker, and from an installed RT Test it sits under `node_modules`, where an `import "vitest"` would reach RT Test's copy or none.
- **`createVitest`'s overrides reach the root project only on 4.1.11.** `createVitest` merges `viteOverrides` into the root server's config, and `initializeProject` builds each other project's server from its own options, passing on only `configLoader` (4.1.11 `dist/chunks/cli-api.CnMVyzaz.js`). 5.0.1 is U3.
- **Signatures.** 4.1.11: `createVitest(mode, options, viteOverrides?, vitestOptions?)`. 5.0.1: `createVitest(options, viteOverrides?, vitestOptions?)`, with the four-argument form deprecated but present (`dist/node.d.ts` of each).
- **Vite range.** Vitest 4.1.11 accepts Vite `^6.0.0 || ^7.0.0 || ^8.0.0`, and 5.0.1 `^6.4.0 || ^7.0.0 || ^8.0.0`; this repository installs Vite 8.3.1 for both, so U2 is checked on Vite 8 only.

#### Design decisions (scope of analysis: this ticket's job; scheduling, storing and verdicts are unanalyzed here)

- **The raw record is this ticket's contract with 3.3.** It carries facts, never a verdict, and every test of each executed module rather than the intended test alone, since 3.3 finds the intended test by identity and its hook states and errors. AC2's baseline check is the one place this ticket reads the intended test, as C137 requires.
- **The confirming run is 3.3's.** ADR-0007 repeats a would-be detection in the same instance; the sprint file gives that to 3.3. Until 3.3 lands the job runs each experiment once. Keep one experiment callable again in the same instance between the experiments and the restored baseline, so 3.3 adds the repeat without reshaping the loop.
- **An experiment with no probe site never runs.** Its verdict is already decided (invalid, reach unknown) and its facts could prove nothing, so it is decided before the job's runs start, like an anchor that does not match, and its record names the position so the author moves the mutation (orchestrator ruling F3).
- **An experiment runs its intended test's whole module, the baseline's specification** (orchestrator ruling, 18:13, reversing F4). A one-test experiment against a whole-module baseline can fail an order-dependent test from isolation alone and credit a detection the mutation never caused, and falsification is background work that yields to ordinary runs, so the whole file's time buys exactness. Known limit for 3.3: a sibling test's unhandled error sits beside the intended test's result and reads unclear, never a false detection. Running one test is a later optimization that needs a matching one-test baseline and restored baseline, not planned now. The source facts that would support it: `TestCase.toTestSpecification()` returns `project.createSpecification(moduleId, { testIds: [this.id] })` (4.1.11 `dist/chunks/cli-api.CnMVyzaz.js`; 5.0.1 `dist/chunks/index.DzobfTyw.js`, in `TestCase`). The runner's `interpretTaskModes` sets every test outside `testIds` to `skip` and a suite to `skip` only when every task in it is skipped, so the intended test's enclosing suites stay `run` and their `beforeAll` and `beforeEach` run, and the whole file still loads (4.1.11 `@vitest/runner` `dist/chunk-artifact.js`; 5.0.1 `dist/task-utils.js`). A test's id is its parent's id and its position (`${parent.id}_${idx}`), so a one-test run would also need the id re-read after any edit to the test file.
- **An executor crash stores nothing.** Unlike an ordinary run, a falsification job whose executor process ends before replying returns no record, since no experiment in it can be judged without its restored baseline.
- **An aborted job returns what finished, marked interrupted,** with no restored baseline. What to store is 3.5's, and ADR-0008 makes an experiment without a passing restored baseline invalid.
- **Anchors match across line endings** (orchestrator ruling, 18:18). Measured by the orchestrator: Fleet Cooling has 201 working-tree files with CRLF on Windows (11 in `packages/convex`) despite `eol=lf`, so exact matching would read every multi-line anchor there as missing. One standalone matcher serves this ticket's start-time check, its transform, and 3.1's anchor-missing state, so the three can never disagree on whether an anchor matches (C8).
- **The forks pool's transform cache is switched off** (dev, reported to the orchestrator at 18:19, a mechanism under AC8). On both lines Vitest's default forks pool writes every transformed module to `os.tmpdir()` (`ForksPoolWorker.cacheFs`), which would put mutated text on disk. The job wraps each project's `_fetcher` to pass `cacheFs` false, and refuses its runs where that wrap cannot be installed. This answers U5's "any other on-disk cache".
- **The mutation's file comes absolute.** ADR-0009 names it root-relative; 3.5 builds the job's request from 3.1's resolved definitions and resolves it.
- **The falsifier version is this ticket's,** since what the transform, probe and record mean is built here. 3.4 binds evidence to it, and 3.6 keeps canary results per it.
- **Where a mutation cannot reach:** code a test runs in a child process, a module served outside Vite's transform pipeline (externalized dependencies, or Vitest's native module runner where a consumer turns Vite's off), and a file the parser cannot read (such as a Vue or Svelte single-file component). The first two record the mutation as never loaded, and the third records "no probe site" without a run (AC5). Each is a known limit that makes the experiment invalid, never a detection.
- **Reach outside the test counts for the test.** ADR-0008 counts a site run while the module loads for every test of the file, "since each can read what it set". A suite's `beforeAll` is the same case for the tests of that suite, and AC6 marks each of them and says the site ran outside the test. During a `beforeAll`, `__vitest_worker__.current` is the suite, or the file for a top-level hook, not a test, so the setup file marks the tests under whichever was current. During concurrent tests `current` cannot attribute a firing, so AC6 reads reach unknown there. A site reached only in an `afterAll` fires after the test's result is final, reads not executed, and so makes the experiment invalid: a known limit, never a detection. Decided by this session; accepted by the orchestrator at 18:09.
- **Isolation is forced** in every falsification job, whatever the workspace configures (orchestrator ruling Q1). The baseline, each experiment and the restored baseline run alike, and a leftover mutation can never reach a later run through a reused worker, whatever a later Vitest release does.
- **The record keeps error messages raw.** It crosses only IPC to the daemon, and 3.3 reads error names, constructor markers and assertion context, not messages. Code frames in messages can quote source, mutated text included, so 3.4 strips source text before anything is stored (orchestrator ruling Q2; C147, NFR6). This ticket's own "no probe site" reason quotes no source (AC5).

#### Questions to the orchestrator

Asked 2026-09-30 17:57; decided by the orchestrator at 17:58.

- F1, abort: accepted. The job stops at the run in progress and replies interrupted with the finished runs and no restored baseline. Ordinary work becomes due through a change, and a change inside the workspace stales the finished experiments' evidence anyway (3.5 stores nothing for moved inputs), so saving them buys little, and delaying ordinary work breaks its priority.
- F2, executor crash: accepted. Nothing to store, with the reason, as discovery does.
- F3, no probe site: overruled. The experiment does not run; it is recorded "no probe site" with the position, decided before the job's runs start.
- F4, whole module or one test: to be checked in both lines' source; if both can restrict a run to one test with its own hooks, the experiment runs only that test. Checked at 17:58: both can. Reversed at 18:13 (below): the experiment runs the whole module.
- F5, the falsifier version: accepted, owned here.
- F6, `createVitest` overrides reach only the root project on 4.1.11: noted; AC3 stands.
- F7, the confirming run: accepted. This ticket runs each experiment once and keeps one experiment callable again in the same instance; 3.3 adds the confirming run.
- F8, test files: accepted. No shared file with 2.7b; tests under `packages/daemon/test/falsify/` with their own `defects.json`; 3.2 builds in Tree 1 beside 2.7b.
- Sizing: accepted at 27 estimated. The review's recount found no existing test that references the changed session or reply types, so the count fell to 26 (Sizing below), below the figure already accepted.

Asked 2026-09-30 18:05, after the ticket review; decided by the orchestrator at 18:05.

- Q1, reused workers: force isolation in every falsification job, unconditionally rather than gated on U4, since a leftover mutation reaching a later run is false evidence and a later Vitest release could reopen it unseen. U4 is informational.
- Q2, source text in records: this ticket's record stays raw across IPC; 3.4 strips source text before anything is stored, and the orchestrator adds that to § Ticket 3.4.
- AC8's module-cache refusal: accepted as fail-closed; U5 stays for dev.
- Glossary: the orchestrator writes the amended "Executor process" and the new "Falsification job" with the authoring commit.

Raised by dev's sanity check at 18:13; decided by the orchestrator at 18:13.

- F1, a one-test experiment against a whole-module baseline: the orchestrator reversed its F4 ruling. Each experiment runs the intended test's whole module, the same specification as the baseline and the restored baseline, so the mutation is the only difference (design decisions above).
- F2, `parseGuarded` quotes oxc's message: `source-imports.ts` joins the file list, extended additively (Reusable Code).
- F3, the tests this change may break: corrected below.
- F4, the mutation reaches every project through the guard's per-environment wrap rather than `createVitest`'s overrides: accepted; U3 is informational.

Widening relayed by dev at 18:18; decided by the orchestrator at 18:18, cleared at about 28 estimated. Verbatim: "Anchor matching must tolerate line endings. Measured: Fleet Cooling has 201 CRLF working-tree files on Windows (11 in packages/convex) despite eol=lf, so exact matching would read multi-line anchors as missing there. Build ONE standalone matcher module under packages/daemon/src/falsify/ with no executor or Vitest dependency: it counts an anchor's occurrences non-overlapping (split semantics, as scripts/verify-defects.mjs counts, `old.split` length minus one), where a newline in `old` matches LF or CRLF in the file; locates the unique match; and applies `new` using the line ending the match used. Your job's anchor check (AC2's "an anchor count other than one") and the transform both use it, and ticket 3.1 (authored now, built later in Tree 2) imports it for its anchor-missing state, so keep its exports stable."

#### Pending siblings

- 3.1 (backlog, built later in Tree 2) reads and validates definitions, resolves each test against the latest discovery and each anchor against the file now, importing this ticket's anchor matcher for its anchor-missing state. This ticket takes already resolved experiments and re-checks the anchor in the file's text when the job starts (AC2) and in the text Vitest transforms (AC3).
- 3.3 (backlog) judges this ticket's records and adds the confirming run.
- 3.4 (backlog) stores verdicts and their facts, and strips source text from error messages before storing (orchestrator ruling Q2).
- 3.5 (backlog) schedules the job, builds its request, yields by aborting it, and stores nothing for an experiment whose inputs moved.
- 3.6 (backlog) runs canaries under the consumer's Vitest, keyed by the falsifier version this ticket defines.
- 2.7b (ready-for-dev, Tree 2) writes none of this ticket's production files. Its tests write `packages/daemon/test/defects.json`; keep this ticket's tests and records under `packages/daemon/test/falsify/` with a `defects.json` of their own, as `packages/daemon/test/selection/` does, so the two never edit one file.

#### Current structure of the modified files

- `packages/daemon/src/vitest/workspace-session.ts`: `inWorkspaceSession(workspace, confirmedConfigFile, reporters, step)` gates on `confirmedConfig`, resolves the workspace's Vitest, captures host state, and calls `openAndClose`, which runs `createVitest("test", {...noWriteOptions, config, configLoader, reporters})` with no Vite overrides, then `openSession`, which unshifts `SNAPSHOT_GUARD_FILE` into every project's `config.setupFiles` and resolves the specifications. Callers, from `rg -n inWorkspaceSession packages --glob '!**/dist/**'` outside tests: `discover-tests.ts` and `run-workspace.ts`.
- `packages/daemon/src/daemon/executor-jobs.ts`: the `ExecutorRequest` union (`discover`, `run`, `build-dependencies`, `abort`), the `ExecutorReply` union, and `REPLY_TYPES`, which `isExecutorReply` checks.
- `packages/daemon/src/daemon/executor-main.ts`: `answer(request, signal)` switches on the job type; `buildDependencies` imports `workspace-graph.js` lazily so the parser's native binding stays out of discovery and run processes.
- `packages/daemon/src/daemon/executor.ts`: `Executor.discover`, `run` and `buildDependencies` each call `#job` and map the reply to a `JobOutcome`; `failureReason` names a reply of the wrong kind.

#### Tests this change may break

By import: `grep -rln "queueSessionJob\|inWorkspaceSession" packages/*/test` names `packages/daemon/test/discover-tests.test.ts`, which imports `queueSessionJob` and needs no change while that export stays. By behavior: `discover-tests.test.ts` and `executor.test.ts` exercise the session and the executor through discovery and ordinary runs, which this ticket leaves as they are, so a red there is a regression to fix in the code. By anchor, counted with `grep -c` on each `"file"` path (2026-09-30 18:14): `packages/daemon/test/defects.json` holds 35 records anchored in `vitest/workspace-session.ts`, 40 in `daemon/executor.ts`, 12 in `daemon/executor-main.ts` and 1 in `daemon/executor-jobs.ts`, and `packages/daemon/test/selection/defects.json` holds 23 in `selection/source-imports.ts`. Edit around their anchored text, and list any record whose anchor an edit breaks under the Dev Handoff for create-tests. Fixtures live under `test/fixtures/daemon/`, placed through `inConsumerCopy(fixture, install, fn)` in `packages/daemon/test/harness.ts` with `install` `"vitest"` (5.0.1) or `"vitest-4"` (4.1.11); `test/fixtures/daemon/no-writes` already checks that runs write nothing.

#### Sizing

About 22 raw files and 29 estimated (22 times 1.3 is 28.6, the orchestrator's "about 28"); code units 10 (9 criteria plus validation). Production, modified: `vitest/workspace-session.ts`, `daemon/executor-jobs.ts`, `daemon/executor.ts`, `daemon/executor-main.ts`, `selection/source-imports.ts`. Production, created under `packages/daemon/src/falsify/`: the job, the record, the mutation transform, the probe placement, the reach setup file, the stale-transform guard and the anchor matcher, the falsifier version inside one of them. Docs: `docs/architecture.md`, as text reported to the orchestrator. Tests, for create-tests: `packages/daemon/test/falsify/` (a job test, a probe placement test, a test of the job through `Executor`, and its own `defects.json`), and a fixture of about five files under `test/fixtures/daemon/falsify/` (a config with two projects that sets `isolate: false`, a source module, and test files covering an in-test site, a load-time site, a suite `beforeAll` site and a test that fails without executing the site). Over 25 estimated and within 30, since a split would cut the raw record 3.3 judges in two: reach is a field of each experiment's record. Over 10 estimated, so dev delegates in three groups: the transform, probe and setup file (AC3, AC5, AC6); the guard and session change (AC4); then the job and executor (AC1, AC2, AC7, AC8, AC9), which depends on both.

#### Glossary terms, verbatim

- **Experiment**: One run of a defect's test with its mutation applied, inside a falsification job.
- **Baseline**: The unmutated run of a falsification job's tests before its experiments; the restored baseline repeats it after them.
- **Confirming run**: A second run of an experiment that would be a detection, which must fail the same way before the detection counts.
- **Reach probe**: The recorder call a mutation's transform places at the mutated site, so an experiment records which tests executed the mutated code.
- **Run facts**: What the daemon records during a falsification run: failure phase, error kind, whether the mutated code was reached, and the baseline result.
- **Executor process**: A child process of the daemon that runs one job, a discovery, a run or a dependency build, and ends with it; only an executor process hosts Vitest. This definition gains the falsification job; the text is reported to the orchestrator.

#### Previous-ticket intel

3.1 is the nearest earlier sprint-3 ticket and is still backlog, so there is none. The last commit to touch the session or the executor files is `f528b312` (2.3n, the start environment); later work (2.4 through 2.7) left them alone.

### References

- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.2 and its objective.
- ADR-0003, ADR-0007, ADR-0008, ADR-0009; `docs/design-decisions/falsification-instance-reuse/FINDINGS.md`.
- `docs/requirements.md`: FR10, FR11, NFR6.
- `docs/architecture.md` § Workspace runs, interruption and force-stop; § Host and consumer isolation during discovery and runs; § Executor processes, crashed runs and process trees; § Execution and falsification isolation.
- GitHub issues: `node scripts/list-open-issues.mjs` printed "0 open issues, complete" on 2026-09-30.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C10,C12,C13,C14,C19,C28,C30,C32,C45,C48,C59,C160,C167,C171,C125,C131,C132,C134,C135,C137,C138,C140,C142,C147,C157 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P16,P17,P18,P19,P21,P32,P35,P36,P37,P41 -->

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
sizing_ac_count: 10
files_to_modify:
  - packages/daemon/src/vitest/workspace-session.ts
  - packages/daemon/src/daemon/executor-jobs.ts
  - packages/daemon/src/daemon/executor.ts
  - packages/daemon/src/daemon/executor-main.ts
  - packages/daemon/src/selection/source-imports.ts
files_to_create:
  - packages/daemon/src/falsify/falsify-workspace.ts
  - packages/daemon/src/falsify/experiment-record.ts
  - packages/daemon/src/falsify/mutation-transform.ts
  - packages/daemon/src/falsify/reach-probe.ts
  - packages/daemon/src/falsify/reach-setup.ts
  - packages/daemon/src/falsify/stale-transform-guard.ts
  - packages/daemon/src/falsify/anchor-match.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 8b9e2153-ccfc-4838-b5d7-fee955be7fe8

#### Test Files This Change Broke

None. The daemon workspace typechecks with its tests. A script counted every record in `packages/daemon/test/defects.json` and `packages/daemon/test/selection/defects.json` anchored in `workspace-session.ts`, `executor.ts`, `executor-main.ts`, `executor-jobs.ts` and `source-imports.ts`: 111 checked, 0 broken (2026-09-30 19:05). `discover-tests.test.ts` imports `queueSessionJob`, which is unchanged.

#### ACs Owed a Test

Every criterion is owed a test, since each must hold on Linux as well as Windows and no Linux run was made. The dev evidence below comes from scratch drivers on Windows 11, Node 24.19, against both installs (`_agent-docs/.scratch/3-2/smoke.ts` and `probe-cases.ts`, run 18:40 to 19:06; not tests).

- AC1: one instance runs the baseline over the intended tests' modules, each experiment over its test's whole module, then the restored baseline. Observed on 4.1.11 and 5.0.1. Not observed: `globalSetup` running once per job.
- AC2: each not-run reason is recorded. Observed: baseline failed (state `failed`), no module, anchor count 0, and no probe site with its position. Not observed: an unreadable file, and a test the baseline did not report.
- AC3: the mutation is served in every project, and only during its experiment. Observed: applied to a CRLF file through a multi-line anchor, with one load per environment that loaded the module. Not observed: "never loaded", or a count other than one in the text Vitest transforms.
- AC4: no run reads an earlier run's transform or a stale source, and isolation is forced. The spike observed both the stale serving and the guard naming it, on both lines. The product's guard ran on every smoke run, but no smoke run edited a file mid-job.
- AC5: probe placement and "no probe site" before any run. Observed on 13 constructed cases (TS wrappers, ambient blocks, chains, callee, `typeof`, `delete`) and on the fixture.
- AC6: reach. Observed: `in-test`; `outside-test` for a load-time site and for a suite `beforeAll` site; `no` for a failing sibling that never reached the site. Not observed: concurrent tests, or a test the recorder never observed.
- AC7: the raw record, with hook states, serialized errors, execution, force-stop and close error. Observed in shape. Not observed: unhandled errors, or a force-stop.
- AC8: the fixture tree stays byte-identical, no mutated text lands in `os.tmpdir()`, and the module-cache refusal names project and setting on 4.1.11. Observed. One empty GUID-named `.tmp` file appeared in `os.tmpdir()` during a 4.1.11 executor run. Nothing in Vitest or RT Test creates such a file, so a no-write test should search for the mutated text rather than for any new entry.
- AC9: the job runs through `Executor.falsify` in its own process, and an abort during the restored baseline replies interrupted with the finished runs. Observed. Not observed: a crash before the reply.

#### Tests Owed

Defects this session found or fixed, each a candidate for a named test:

- NFR6 (orchestrator, 18:20): a job writes the mutated text nowhere on disk, `os.tmpdir()` included, and not only the consumer's tree. The forks pool's temp copies (`serveWithoutTempCopies` in `mutation-transform.ts`) are the path that would break this.
- A probe under a TypeScript `as`, `satisfies`, `!`, `<T>` or instantiation wrapper is judged at the outermost wrapper's position. Without that, a callee, a tag, a `delete` or `typeof` operand, or a target is probed and changes behavior.
- A probe inside `declare namespace`, `declare module` or `declare global` has no site. So does a probed text the parser rejects (re-parse in `mutateWithProbe`).
- A run whose worker fails before collection must not report the previous run's module. Only modules queued during the run count (`queued` in `recordRun`).
- On 4.1, the module-cache refusal reads `experimental.fsModuleCache` and ignores a top-level `fsModuleCache: false`. On 5, it reads the top-level setting, so a deprecated `experimental` spelling the override has turned off is not refused.
- A consumer's `bail` does not turn a detection into "interrupted": bail is forced off, and only the job's own abort interrupts a run.
- An error field holding a bigint, or a cycle, still crosses IPC. A reply that cannot be sent answers `job-failed` (`sendReply` in `executor-main.ts`).
- A query variant of the mutated file (such as `?raw`) is never mutated.
- One run that throws leaves the other runs' records, with that run recorded `run-failed`.
- A soft-invalidated importer's old transform counts as cached for the stale check (`cachedResult` in `stale-transform-guard.ts`).
- The reach setup file removes a test from its running set in `onTestFinished` and in `afterEach`, so a throwing consumer `afterEach` cannot leave it marked running.

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

Built by dev (threadId 8b9e2153-ccfc-4838-b5d7-fee955be7fe8) on 2026-09-30, 18:15 to 19:08. Two implementer agents built the probe placement and the reach setup file (IMPL-AGENTS, one wave); the rest was built in the main loop.

- **Job** (`falsify/falsify-workspace.ts`): `falsifyWorkspace(workspace, configFile, experiments, signal)` runs in one session through `queueSessionJob` and `inWorkspaceSession`. It checks each experiment's file, anchor and probe site before any run, and reads each file once per job. Then it runs the baseline over the intended tests' modules, each experiment over its test's whole module when the baseline passed that test, and the restored baseline once any experiment ran. A relay reporter hands each run a fresh `RunInterruption` and collects the modules Vitest queued during that run. `FalsificationRuns.experiment` can be called again for a confirming run.
- **Record** (`falsify/experiment-record.ts`): the raw record types, `recordRun`, `testResultIn` and `FALSIFIER_VERSION = 1`. Errors keep every field, made JSON-safe for IPC. Hook states are read from the runner task.
- **Transform** (`falsify/mutation-transform.ts`): `MutationTransform.install` prepares the loaded instance. It forces isolation, turns bail off, wraps each project's `_fetcher` to request no temp copies, places the reach setup file first, and installs the guard. A mutation is active only between `activate` and `deactivate`, and applies only to the module's plain id. The job refuses a workspace that keeps an on-disk module cache on (`onDiskModuleCaches`).
- **Guard** (`falsify/stale-transform-guard.ts`): wraps `pluginContainer.transform` in every environment of every server, the root's included, and records each input's digest. `freshen` invalidates the named files and every stale or unseen cached module, soft-invalidated ones included, and returns what stays stale.
- **Probe** (`falsify/reach-probe.ts`, `falsify/probe-slots.ts`): `mutateWithProbe` uses the anchor matcher, narrows the changed text, and places the probe by an allowlist of positions. TypeScript value wrappers are transparent, ambient blocks are refused, and the probed text is re-parsed.
- **Reach setup** (`falsify/reach-setup.ts`) and **names** (`falsify/reach-names.ts`).
- **Anchor matcher** (`falsify/anchor-match.ts`): per the orchestrator's 18:18 ruling. Its exports were reported at 18:19. It stays unchanged unless a bug turns up (19:05), and the orchestrator commits it to main for 3.1.
- **Executor**: `falsify` request and `falsified` reply (`executor-jobs.ts`); `answer` loads the job module lazily and `sendReply` catches an unsendable reply (`executor-main.ts`); `Executor.falsify` (`executor.ts`).
- `source-imports.ts`: `GuardedParse` failure gains `offset` and `nesting`; `parserOptions` is exported. `workspace-session.ts`: `TOP_LEVEL_MODULE_CACHE_MAJOR` is exported, one constant for both readers.

Decisions made in dev, each changing code only:

- The task "Let a workspace session take the mutation's transform ... and a second setup file" needed no session change. The job's step receives the loaded instance before any run transforms a module, so `MutationTransform.install` does it there. Discovery and ordinary runs are untouched, and none of `workspace-session.ts`'s 35 anchored records moved.
- The reach setup file imports exactly one sibling, the constants module `reach-names.ts`. It imports no package, which was the reason for "imports nothing". The recorder's name and the metadata key are one constant for the writer and the reader (C3).
- `probe-slots.ts` was split from `reach-probe.ts` by the implementer to keep each file focused.
- When the text Vitest transforms still leaves no probe site at run time, the mutation is served without a probe, and every test's reach reads unknown (`no-probe`), as AC5 asks.
- Sanity check F1 to F4 were answered by the author and the orchestrator at 18:13, and are recorded under Questions to the orchestrator. U1 to U6 are resolved under the table.

Adversarial review (18:59): 9 findings, all fixed in this change. Post-fix lint and typecheck passed.

- R1 (CRITICAL): a probe under a TS wrapper could change behavior.
- R2 (CRITICAL): a run failing before collection could report the previous run's modules.
- R3 (CRITICAL): the module-cache setting was chosen by key rather than by Vitest line.
- R4 (HIGH): a consumer's `bail` read as an abort.
- R5 (HIGH): a bigint in an error could hang the reply.
- R6 (MEDIUM): probes were placed in ambient blocks.
- R7 (MEDIUM): query variants of the file were mutated.
- R8 (MEDIUM): one throwing run discarded the finished records.
- R9 (LOW): each run repeated reads.

The reach-setup implementer also found that a throwing consumer `afterEach` could leave a test marked running. It is fixed with `onTestFinished`.

Known limits, each making an experiment invalid or refused, never detected:

- A project on a vm pool runs with isolation forced on. That is untested.
- Vite 6 was not available to check, and the design fails safe there (U6).
- Host-thread rejections are recorded on the job as text.
- Vitest 4.1 writes `node_modules/.experimental-vitest-cache/_metadata.json` at load for a project that turns its cache on, even though the job then refuses. This is the documented 4.1 exception, and it holds no module text.

Validation (Windows, Node 24.19):

- `bun run --filter @rt-test/daemon typecheck`: exit 0 (19:05).
- `bun run --filter rt-test typecheck`: exit 0 (18:42).
- `bun x oxlint` over every changed file: exit 0 (19:05).
- `bun x prettier --check` over every changed file: exit 0 (19:07).
- `node scripts/check-line-citations.mjs`: clean (19:07).
- Pre-done literal check: every domain literal in the diff is a named constant.

README: no user-visible change. The job has no CLI or API surface until 3.5 schedules it.

### File List

- `_agent-docs/tickets/3-2-transform-experiments.md` (created by create-ticket)
- `packages/daemon/src/falsify/anchor-match.ts` (created)
- `packages/daemon/src/falsify/reach-names.ts` (created)
- `packages/daemon/src/falsify/reach-probe.ts` (created)
- `packages/daemon/src/falsify/probe-slots.ts` (created)
- `packages/daemon/src/falsify/reach-setup.ts` (created)
- `packages/daemon/src/falsify/mutation-transform.ts` (created)
- `packages/daemon/src/falsify/stale-transform-guard.ts` (created)
- `packages/daemon/src/falsify/experiment-record.ts` (created)
- `packages/daemon/src/falsify/falsify-workspace.ts` (created)
- `packages/daemon/src/daemon/executor-jobs.ts` (modified)
- `packages/daemon/src/daemon/executor.ts` (modified)
- `packages/daemon/src/daemon/executor-main.ts` (modified)
- `packages/daemon/src/selection/source-imports.ts` (modified)
- `packages/daemon/src/vitest/workspace-session.ts` (modified: one `export`)

# Ticket 1.1b: Record Vitest run states

## Ticket

As the RT Test daemon (started in ticket 1.3, scheduling in ticket 2.3) acting for a started consumer,
I want to run a Vitest workspace on its own Vitest 4.1.x or 5.x and record each test's outcome, each module and run-level error, each worker crash and each interruption as distinct states under the test identities discovery gives,
so that no later result, summary or wait ever reads a test as passed that failed, errored, crashed, was skipped or never finished.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: Running a Vitest workspace whose Vitest is 4.1.x or 5.x records every test the run reports under the same test identity and duplicate mark that discovery (ticket 1.1) gives that test, and gives each test that finished one outcome: passed, failed, skipped or error (a test left unfinished by an interruption or a crash gets none, AC5 and AC6). A test declared `skip` or `todo`, or inside a skipped suite, is recorded as skipped, never passed or failed, and so is a test skipped at run time outside an interrupted run (AC5). A failed test keeps its error text, and a test that timed out is recorded as failed with its error text.
- [x] AC2: Outside an interrupted run (AC5), a test that never ran because a `beforeAll` hook of an enclosing suite or of its module failed is recorded with the error outcome and the errors of the suite (or module) whose `beforeAll` failed, never as skipped or passed. Every error a suite hook raised is recorded on its module apart from test outcomes, so a failing `afterAll` leaves the outcomes of the tests that ran unchanged while the module carries the error.
- [x] AC3: A module whose file or setup file fails before its tests run is recorded as failed with its error, and none of its tests is recorded with any outcome.
- [x] AC4: An error no test owns (an unhandled error or rejection during the run) is recorded on the run with its text, apart from every test outcome and every module, and changes no test's outcome.
- [x] AC5: A run is recorded as interrupted when its caller interrupts it before it ends, or when Vitest itself stops it early (for example under the consumer's `bail`). In an interrupted run, each test that did not run to a pass or a failure is recorded as interrupted with no outcome, including a test that skipped itself at run time and one whose `beforeAll` failed, and each module the run never started is recorded as not run. A test that passed or failed before the interruption keeps its outcome, and a declared `skip` or `todo` stays skipped. A run interrupted before any module started records no test outcome. An interruption that arrives after Vitest has finished the run does not make it interrupted.
- [x] AC6: In a run that is not interrupted, a module whose test worker crashed is recorded as crashed, and none of its tests is recorded with any outcome, including tests that finished before the crash. The other modules keep their states, the crash never makes the run interrupted, and the crash's error is among the run-level errors (AC4). In an interrupted run, the tests of a module whose worker crashed are recorded as interrupted (AC5), since the two leave the same shape.
- [x] AC7: Every test module the workspace's Vitest resolves for the run appears in its record exactly once: with its tests' states, as failed, crashed or not run, or as AC8 records a typecheck module or a browser-mode project. No module is dropped, and a run in which no test was recorded passed or failed records that nothing ran and why, never a passing run.
- [x] AC8: A workspace discovery would report as unsupported (with the version found and the supported range) or as failed to load is recorded the same way by a run, with no test outcome. A typecheck module and a browser-mode project are never run and yield no test outcome; each is recorded as discovery reports it (a typecheck module as not discovered, a browser-mode project as unsupported, and on 5.x with no browser provider the workspace as failed to load).
- [x] AC9: A run sets `NODE_ENV` to `test` when the host has none, and restores the host's `process.env` and `process.exitCode` afterwards, as discovery does. A run never overlaps a discovery or another run: each starts only after the previous one has ended, and a run interrupted while it waits never loads the workspace and is recorded as interrupted with no test outcome.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                                       | Why it matters if wrong                                                            | How to check                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | On 4.1.11 and 5.0.1, does a worker that dies under `pool: "threads"`, `"vmThreads"` or `"vmForks"` (a consumer's non-default pools) leave the module `pending` with `pending` tests and a run-level error, as a killed fork does under the default `forks` pool? | AC6 would miss a threads-pool crash, and those tests would read as never reported. | In a `pool: "threads"` project, end one worker thread without ending the host (for example an allocation loop under a small worker heap limit), and compare module and test states; if no probe does, record AC6 as proven under `forks` only. |

**U1: CONFIRMED** (dev, 2026-09-26). A probe that calls `createVitest`, `getRelevantTestSpecifications()` and `runTestSpecifications` over a two-module fixture (`maxWorkers: 2`) ended one worker through `process.reallyExit(3)` under `threads` and `vmThreads`, and through `process.kill(process.pid, "SIGKILL")` under `vmForks`. Vitest replaces `process.exit` in its workers with a throw (5.0.1 `dist/chunks/base.Cc3oda2V.js`, the `process.exit = (code = ...)` override), so `reallyExit` is what ends only the thread. On 5.0.1 and 4.1.11 alike, under each of the three pools: the crashed module `state()` `pending` with internal mode `run` and no `errors()`, all three of its tests `pending` (the one that finished before the exit included), the healthy module `passed`, `onTestRunEnd` reason `passed`, one unhandled error `[vitest-pool]: Worker <pool> emitted error.`, and the host process alive after `close()`. So AC6 holds under every pool, as it does under `forks`.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing.
- [x] (AC8, AC9) Extract from `packages/daemon/src/vitest/discover-tests.ts` the steps discovery and a run share into one module (for example `packages/daemon/src/vitest/workspace-session.ts`): resolving the workspace's Vitest and reporting it unsupported, the one queue that serializes every discovery and run, the host-state capture and restore, `NODE_ENV`, creating the instance with `watch: false`, `api: false`, `ui: false` and no reporter but the one the calling step supplies (discovery supplies none; the run supplies its own), turning a thrown setup error into a failed workspace, closing the instance on success and error, and the browser-mode and typecheck filters over specifications. Discovery and the run each pass only their own step (collect, or run), per P18 and P19. Discovery's output must not change, except that it no longer collects typecheck specifications (pool `typescript`), and so no longer starts Vitest's tsc typecheck pool. A typecheck module whose collection would have failed is now reported only as not discovered, with no error.
- [x] (AC1) Move the building of a module's test identities (module location from the real workspace directory and real module id, the name path, `identifyModuleTests`) out of `discover-tests.ts` into a module both discovery and the run call, so a test's identity cannot differ between them.
- [x] (AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC9) Create the run module (for example `packages/daemon/src/vitest/run-workspace.ts`): take one `VitestWorkspace` and an `AbortSignal`, run the workspace's remaining specifications with `runTestSpecifications` inside the shared session, and on abort call `cancelCurrentRun`. Check the signal when the shared queue reaches the run, before resolving or loading the workspace, and never start a run whose signal has already aborted (AC9). Vitest drops a cancel issued before its run resets its cancel state (Dev Notes § Spike facts, An early cancel is lost), so an abort that arrives while the run is starting is issued again from the run's reporter at `onTestModuleQueued`, which takes effect (§ Spike facts, Cancel from the first module events). Record the run as interrupted when the signal aborted before `runTestSpecifications` was called, or when the run's reporter saw `onTestRunEnd` with reason `interrupted`; otherwise as completed, including when the signal aborts after Vitest ended the run (a crash ends with reason `passed`; Dev Notes § State mapping).
- [x] (AC1, AC2, AC3, AC5, AC6, AC7) Map each finished `TestModule` to recorded states by Dev Notes § State mapping, keeping outcome and execution state in separate fields (C119) and reusing `TestOutcome` from `@rt-test/core`. Account for every specification the workspace's Vitest resolved, as 1.1's `uncollectedModules` does for discovery, and give a run that executed no test the reason nothing ran (AC7).
- [x] (AC4) Record the run's `unhandledErrors` through `errorText` on the run, apart from modules and tests.
- [x] (Support) Export the run function and its record types from `packages/daemon/src/index.ts`.
- [x] (Support) Send the orchestrator the `docs/architecture.md` § Current implementation text for the run, per P21, and the approved FR2 amendment and glossary entries (Dev Notes § Grill record).
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `packages/daemon/src/vitest/discover-tests.ts`: `captureHostState`, `closeInstance`, `discoveryQueue`, `TEST_NODE_ENV`, `usesBrowserMode`, `realPath`, `namePath`, the location building in `sortModule`, `wasCollected` with `PLACEHOLDER_MODULE_MODE`, `uncollectedModules` and `moduleKey`. Each is private today; the extraction tasks move them rather than copying them (C13).
- `packages/daemon/src/vitest/load-vitest.ts`: `resolveWorkspaceVitest`, `importVitestNode`, `ResolvedVitest` for the per-workspace Vitest and its unsupported report.
- `packages/daemon/src/vitest/error-text.ts`: `errorText`, which already reads Vitest's serialized worker errors, `cause` chains and `AggregateError` members.
- `packages/daemon/src/vitest/find-workspaces.ts`: `VitestWorkspace` (the run's input) and `relativePosixPath`.
- `@rt-test/core`: `identifyModuleTests`, `IdentifiedTest`, `TestModuleLocation` (`packages/core/src/test-identity.ts`) and `TestOutcome` (`packages/core/src/evidence.ts`, `"passed" | "failed" | "skipped" | "error"`), which is exactly the outcome set AC1 records.
- `vitest` 5.0.1 root devDependency: type-only imports from `vitest/node` (`TestModule`, `TestCase`, `TestSuite`, `TestSpecification`, `Vitest`).
- For create-tests: `packages/daemon/test/harness.ts` (`inTempDir`, `copyFixture`, `linkVitest` for both installs), and `test/fixtures/daemon/crash` (a module that kills its worker at load, beside `ok.test.mjs`).

### Must Create

- The shared session module and the module-tests module the extraction tasks name, since discovery's steps are private to `discover-tests.ts`.
- The run module and its state mapping (for example `run-workspace.ts` and `run-states.ts` under `packages/daemon/src/vitest/`). `rg -n "runTestSpecifications|cancelCurrentRun|onTestRunEnd" packages scripts lint` finds only two `defects.json` mutations that swap `collectTests` for `runTestSpecifications`; no run code exists.
- The run record types. `rg -n "(interface|type) \w*(Run|Interrupt|Crash|ModuleState)\w*" packages --glob '*.ts'` found only `ConsumerRun`, local to `packages/daemon/test/discover-tests.test.ts`: `TestOutcome` covers only the finished outcomes, and `WorkspaceDiscovery` has no outcome field.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Ticket 1.1 (826725a) built discovery in `packages/daemon`: `discoverTests` loads each workspace's own Vitest through `load-vitest.ts`, collects without running, and identifies each test through `@rt-test/core`'s `identifyModuleTests`. This ticket runs one workspace and records what happened, on the same identities. It writes nothing to disk.

FR2 (`docs/requirements.md`): "Record each run's test outcomes, skips, collection errors, module and run-level errors, and interruptions as distinct states." The owner's crash ruling widens it with worker crashes, in the amended text § Grill record gives. The ticket's "interrupted run" and "crashed module" are the glossary terms approved there.

AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states. A zero-test selection is not proof of success." AC5 and AC6 rest on C142's clause "never at its previous outcome as if current" and C131's "none is coerced to passed or folded into a generic failed"; AC4 on C134's "Module-level and unhandled run-level errors are recorded on the run, not dropped because no single test failed"; AC7 on C130's "A selection or run that executed no tests reports that nothing ran and why, never success."

Pending siblings and their routing:

- **1.2** (backlog) persists what a run records, and assigns and binds the run identity, input fingerprint and adapter version (FR3). This ticket returns one run's record in memory and assigns no run identity.
- **1.3** (backlog) owns the explicit start and is the only production caller of both discovery and runs; its shutdown interrupts a running run through the same signal AC5 uses. Until 1.3 lands the run has no caller outside tests, as 1.1's discovery had none. The run executes the workspace it is given without checking trust: C140 ("No code path runs a project's tests, loads its Vitest config or imports its files unless that project was explicitly started and trusted") is enforced by 1.3's explicit start, as the run's only production caller. Rule deviations follow, as in 1.1, accepted by the owner (§ Grill record): **C59** ("Every export has a production consumer. A reference from test code ... is not a consumer") for the run export until 1.3, and **C32** ("A truncated, partial or fallback result is reported at warning level or stronger and says what was dropped, to the caller and to the log alike") for the log half, since no daemon log exists until 1.3; the run returns every dropped or unsupported item to its caller.
- **1.4** (backlog) counts states per path. Comparing a run's tests with a discovery's, so a known test the run never reported reads as unknown (C132), happens where results are stored and queried (1.2, 1.4); this ticket records what the run itself reported, and accounts for every module it was given (AC7).
- **2.3** (backlog) schedules selections and interrupts a run whose inputs moved. This ticket runs a whole workspace; 2.3 narrows a run to a selection and decides when to interrupt.

`node scripts/list-unbuilt-work.mjs --except 1.1b` over the six files in § Execution Metadata plus `packages/daemon/test/defects.json`, `docs/glossary.md`, `docs/requirements.md` and `docs/architecture.md` printed `unbuilt-work: clean. No unbuilt ticket names any of 10 path(s).`

#### Spike facts (observed on Vitest 4.1.11 and 5.0.1)

Run on 2026-09-26 with `_agent-docs/.scratch/create-ticket/run/probe.mjs <root> <all|cancel|early|onqueued|oncollected|hooks|crash|tc>` (with `MAXW=1` for one worker) (removed when this ticket was finalized), which calls `createVitest("test", { root, watch: false, reporters: [reporter], api: false, ui: false, project })`, then `getRelevantTestSpecifications()` and `runTestSpecifications(specs)`, over a `globals: true` fixture whose `node_modules/vitest` links to the root `vitest` (5.0.1) or `vitest-4` (4.1.11). Both versions gave the same states for every test and module; only the order of `testModules` differed.

- **Outcomes.** `TestCase.result().state` is `passed`, `failed`, `skipped` or `pending` (typed `TestResult` in both `.d.ts`). `it.skip` and a test in `describe.skip` give `skipped` with `options.mode` `skip`; `it.todo` gives `skipped` with mode `todo`; `ctx.skip("note here")` gives `skipped` with mode `run` and `note` `"note here"`. `it.fails` that throws gives `passed`. A failed assertion gives `failed` with the assertion message in `errors`.
- **Timeouts.** A test past its timeout gives `failed` with the message `Test timed out in 50ms.` and nothing else to mark it: `makeTimeoutError` builds a plain `new Error(message)` (5.0.1 `dist/chunks/run.C5UmxDPh.js`).
- **Hooks.** A throwing `beforeAll` gives its tests `skipped` with mode `run` and no note, and its suite `state()` `failed` with `errors()` holding `beforeAll boom`. A throwing `afterAll` leaves its test `passed` and its suite `failed` with `afterAll boom`. A throwing `beforeEach` gives its test `failed` with the hook's error in the test's own `errors`.
- **Module errors.** A module that registers a test and then throws at load gives the module `state()` `failed`, `errors()` `load boom`, and no tests at all. A project whose `setupFiles` entry throws gives each of its modules `failed` with `setup boom` and no tests.
- **Unhandled errors.** A `setTimeout` that throws inside a test leaves both tests of its module `passed` and the module `passed`; the error reaches only `TestRunResult.unhandledErrors` (`unhandled boom`), and `onTestRunEnd` gets reason `failed`.
- **Interruption.** `cancelCurrentRun(reason)` from `onTestCaseResult`: the test running at that moment finished `passed`; every test not yet finished came back `skipped` with mode `run` and `note` `"The test run was aborted by the user."`; their modules came back `passed`; `onTestRunEnd` got reason `interrupted` and `vitest.isCancelling` was `true`. With `maxWorkers: 1` and `fileParallelism: false`, each module not yet started stayed a placeholder: `state()` `pending`, internal task mode `queued`, no tests. The runner marks the unfinished tests through `markPendingTasksAsSkipped` with a `TestRunAbortError` note (`run.C5UmxDPh.js` `startTests`), so the note text is the only per-test marker; the daemon knows it interrupted because it made the call.
- **An early cancel is lost.** `cancelCurrentRun` awaited straight after calling `runTestSpecifications` (probe mode `early`, one worker) changed nothing: every test `passed` and `onTestRunEnd` got reason `passed`, on both versions. `runFiles` fires `onTestRunStart` (through `_testRun.start`), then sets `isCancelling = false` and clears `_onCancelListeners` before scheduling the run (5.0.1 `index.DzobfTyw.js` `async runFiles`; 4.1.11 `cli-api.CnMVyzaz.js` the same reset), so a cancel issued before that reset, including one from `onTestRunStart`, is dropped. A cancel issued from `onTestCaseResult` took effect (above).
- **Cancel from the first module events.** With one worker and three slow modules, `cancelCurrentRun` from a reporter's `onTestModuleQueued` (modes `onqueued`) and from `onTestModuleCollected` (`oncollected`) each ended the run `interrupted` on both versions. The started module came back with every test `pending` (under `onqueued` the module `state()` was `skipped`; under `oncollected`, `passed`), and the others stayed `queued` placeholders. So in an interrupted run a `pending` test is an unfinished one, the same shape a crash leaves.
- **Runtime skip against a blocked test.** In a suite whose `afterAll` throws, a `ctx.skip()` test came back `skipped` with the internal `task.result.pending` `true`; in a suite whose `beforeAll` throws, the blocked test came back `skipped` with `pending` unset; a module-level `beforeAll` that throws put its error on the module's `errors()` and left its test `skipped` with `pending` unset (mode `hooks`, both versions). 5.0.1 sets `pending` only in `context.skip` and in `failTask`'s `PendingError` branch (`run.C5UmxDPh.js`). `task` is outside Vitest's public types, as 1.1's `wasCollected` already relies on.
- **Crash.** A test that calls `process.kill(process.pid, "SIGKILL")` under the default `forks` pool left its module `state()` `pending` and every test of that module `pending`, including one that had finished before the crash. A healthy module beside it kept `passed`. The run resolved normally with reason `passed` and one unhandled error, `[vitest-pool]: Worker forks emitted error.`
- **Exit code.** Every probe mode left `process.exitCode` at `1`, so a run needs the same restore discovery has.
- **Typecheck.** A `TestSpecification` carries `pool`; both versions route pool `"typescript"` to `TypecheckPoolWorker` (4.1.11 `cli-api.CnMVyzaz.js`, 5.0.1 `index.DzobfTyw.js`). A project with `typecheck: { enabled: true, include: ["tc/*.test-d.ts"] }` gave the specifications `forks:tc/r.test.mjs` and `typescript:tc/t.test-d.ts`; with the `typescript` one dropped, the run returned only `r.test.mjs`, `passed`, on both versions (probe mode `tc`).
- `runTestSpecifications`, `cancelCurrentRun`, `TestRunEndReason` (`"passed" | "interrupted" | "failed"`) and `TestRunResult` (`testModules`, `unhandledErrors`) are declared alike in 4.1.11 `dist/chunks/reporters.d.DtoKVV2s.d.ts` and 5.0.1 `dist/chunks/plugin.d.CN87HSxv.d.ts`.

These facts rest on `vitest` 5.0.1 and the `vitest-4` alias at 4.1.11 in the root `package.json`; no unbuilt ticket changes either.

#### State mapping

The recorded state follows from the facts above, never from Vitest's end reason alone, since a crash ends `passed`. The run is interrupted when the daemon's signal aborted before `runTestSpecifications` was called (checked when the queue reaches the run and again once the instance exists), or when the run's reporter saw `onTestRunEnd` with reason `interrupted`. `cancelCurrentRun` sets `isCancelling` synchronously and Vitest computes that reason from it in `_testRun.end`, so every abort that reaches Vitest before the run ends shows up as `interrupted`, a Vitest-initiated cancel such as a consumer's `bail` does too (owner ruling, § Grill record), and an abort after `_testRun.end` does not (AC5).

First, per module: when the run was not interrupted and any test of a collected module is `pending`, the module is crashed and records no test state at all, a declared `skip` or `todo` included (AC6). Otherwise, in order, for each test:

1. A declared `skip` or `todo` (`options.mode`): skipped (AC1).
2. The run was interrupted, and the test came back `skipped` with mode `run`, or `pending`: interrupted, no outcome (AC5). This covers a `ctx.skip()` test and a `beforeAll`-blocked one, since in an interrupted run only the cancel's note text tells them from a cancelled test (owner rulings, § Grill record: the `ctx.skip()` ruling and its accepted extension to the blocked test).
3. The test came back `skipped` with mode `run`, `task.result.pending` unset, and an enclosing suite or the module itself carries `errors()`: the error outcome with the `errors()` of the nearest such suite or module (AC2). Those may include that suite's `afterAll` error beside the `beforeAll` one, since only text would separate them. A runtime skip has `pending` set and falls through to rule 4.
4. Otherwise `passed`, `failed` or `skipped` as Vitest reports it (AC1).

A run executed a test when at least one test is recorded passed or failed. Otherwise its record carries the reason nothing ran (AC7): no module; every module failed, crashed or not run; no test declared (at least one module ran, and together they declared no test, as under a consumer's `passWithNoTests`); every test skipped; every test blocked by a failing hook; or interrupted before any test finished.

A module with `errors()` and no tests is failed (AC3); a module with `errors()` and tests had a module-level `beforeAll` fail, and its tests go through the rules above. A placeholder module (internal task mode `queued`) or a specification with no module is not run in an interrupted run and crashed otherwise, matching 1.1's finding that a worker crashing before collection leaves exactly that shape (`discover-tests.ts` `wasCollected`). Suite and module hook errors go on the module whatever its tests' states (AC2).

A timeout stays failed. A distinct timeout state is deferred to M2 falsification, which classifies timeouts (FR11, `docs/architecture.md` § Execution and falsification isolation); until then this is a recorded C131 deviation on the clause "Collection errors, crashes, timeouts, interruptions, skips and unknown tests each keep their own state". A `beforeEach` failure stays failed, as Vitest reports it (owner ruling, § Grill record): the hook's error sits in the test's own errors with nothing structural to tell it from a body failure.

#### Grill record

The owner answered in this lane's create thread (threadId 0529b8fc-3178-49eb-9004-d72e08540824), 2026-09-26 at about 11:16 -0400:

- Sizing: about 20 raw / 26 estimated files against the 20-file limit, one dependency chain through `packages/daemon/src/vitest`, with about 9 of the files few-line fixture modules. Answer: proceed as-is.
- Worker crash (spike: tests `pending`, run reason `passed`). Answer: record the module as crashed, with no test outcome from it, and the run not as passed (AC6). FR2 gains worker crashes.
- Timeout (spike: plain `failed`, message text only). Answer: record as failed with its error text; a distinct timeout state waits for M2, and the C131 gap is recorded as a deviation (§ State mapping).
- Tests under a failing `beforeAll` (spike: `skipped`, mode `run`). Answer: the error outcome with the hook's error, and every suite hook error recorded on its module apart from test outcomes (AC2).

Grill, same thread, 2026-09-26 between about 11:20 and 11:28 -0400:

- A `ctx.skip()` in an interrupted run, indistinguishable from a cancel skip but for note text. Answer: record it as interrupted (§ State mapping, rule 2).
- A throwing `beforeEach` (spike: `failed`, hook error in the test's errors). Answer: failed, as Vitest reports it; no text matching.
- FR2 amendment. Answer: approved, for the orchestrator to write: "FR2: Record each run's test outcomes, skips, collection errors, module and run-level errors, worker crashes, and interruptions as distinct states."
- Glossary, § Results and runs. Answer: approved, for the orchestrator to write: **Interrupted run**: "A run stopped before it finished, so each test it had not finished gets no outcome from it." _Avoid_: cancelled run, aborted run. **Crashed module**: "A test module whose worker exited during a run, so none of its tests gets an outcome from that run." _Avoid_: failed module.
- Sequencing: the run has no production caller or log until 1.3 (C59, C32). Answer: accept, as for 1.1.

Ticket review, same thread, 2026-09-26 at about 11:32 -0400:

- A consumer's `bail`, which makes Vitest cancel the rest of the run itself. Answer: record that run as interrupted, honoring the consumer's configuration (AC5), rather than overriding `bail`.

Extended by create from the `ctx.skip()` ruling, on the same ground (only note text separates them from a cancelled test): in an interrupted run, a `beforeAll`-blocked test is recorded as interrupted, not error (§ State mapping, rule 2). The owner accepted this extension in the orchestrator's thread (threadId c69b35aa-87e0-4755-b618-81ae537fa756), 2026-09-26 at 11:36 -0400, relayed by the orchestrator.

Dev's adversarial review, raised by rt-t1-1b-dev (threadId aed99b63-6f0d-4702-8258-f108f32ac3b4) and answered in the orchestrator's thread, 2026-09-26 at 12:03 -0400, relayed by the orchestrator:

- Discovery drops typecheck specifications (pool `typescript`) before collecting, as the extraction task moves the filter into the shared session, so it no longer starts Vitest's tsc typecheck pool. A typecheck module whose collection fails is still reported as not discovered, but without its error. Answer: accepted.

#### Current structure of the modified files

- `packages/daemon/src/vitest/discover-tests.ts` (308 lines): exports `discoverTests(consumerRoot)` and the types `DiscoveredTest`, `ModuleReport`, `FailedModule`, `UnsupportedProject`, `WorkspaceDiscovery` (`discovered`, `unsupported`, `failed`), `TestDiscovery`. `discoverTests` chains onto the module-level `discoveryQueue`; `discoverAll` finds workspaces and calls `discoverWorkspace` for each in turn; `discoverWorkspace` resolves Vitest, calls `captureHostState`, sets `NODE_ENV`, creates the instance, calls `collectWorkspace`, and closes and restores in that order. `collectWorkspace` filters browser-mode specifications, calls `collectTests`, and sorts each module with `sortModule` (typecheck, failed, uncollected, or identified tests) before adding `uncollectedModules`.
- `packages/daemon/src/index.ts`: re-exports `discoverTests`, `findVitestWorkspaces` and their types, and the `ResolvedVitest` type.

#### Existing tests this change breaks

- `packages/daemon/test/defects.json`: the extraction moves code that the `file` and `old` of D1051-D1053, D1060, D1062, D1063, D1065-D1074, D1076, D1077, D1080 and D1083 anchor in `discover-tests.ts`. Each record's `file` (and its `old`, where the moved code is reworded) must follow the code, or `bun run test:defects` reports the anchor missing. Those are the records whose code the extraction tasks name; after the extraction, list the records naming `discover-tests.ts` again and move every one whose anchor left the file, whether listed here or not.
- `packages/daemon/test/discover-tests.test.ts` imports `discoverTests` and its types from `../src/vitest/discover-tests.js`; it keeps passing as long as discovery's exports and output are unchanged.

Fixture placement: follow 1.1's § Fixtures. Fixtures sit under `test/fixtures/daemon/`, where `.oxlintrc.json` already turns `vitest/no-disabled-tests` off for `test/fixtures/**`, with `globals: true` and `*.test.mjs` names so one fixture serves 4.1.11 and 5.0.1.

#### Previous ticket

1.1 (`done`, 826725a, 1.1's Dev Agent Record): discovery serializes calls on `discoveryQueue` because it restores host state per workspace; it sets `NODE_ENV` inside the restored window; `collectTests` sets `process.exitCode = 1` when a module fails; Vitest realpaths `TestModule.moduleId`, so module paths are computed from real paths on both sides; a crashed worker leaves a placeholder module with internal task mode `queued`, which only `task` exposes. Open tech debt there (two readers of the root `workspaces` field, `relativePosixPath`'s home) is outside this ticket. The sandbox's failure to resolve `@rt-test/core` from a daemon test (1.1 § Tests Owed) was fixed in a77103c, which recreates workspace links in each defect sandbox.

### References

- FR2 (`docs/requirements.md`), quoted in § Where this sits; FR3 (sibling 1.2); FR11 (the timeout deferral).
- `docs/architecture.md` § State dimensions: outcome "Passed, failed, skipped, error, never run" and execution "Idle, queued, running, interrupted" are separate dimensions; "Collect module-level errors and run-level unhandled errors independently of individual test outcomes." § Execution and falsification isolation: "Cancellation must leave explicit interrupted or stale states."
- `docs/glossary.md`: **Run** "One execution of a selection by the daemon, under its own run identity."; **Outcome** "What a test did in its last run: passed, failed, skipped, error, or never run."; **Invalidated run** (2.3's, not this ticket's).
- `docs/roadmap.md` § M1 acceptance: "run a synthetic multi-workspace project containing passing, failing, skipped, and setup-error cases; query exact counts".
- Ticket 1.1 (`_agent-docs/tickets/1-1-capture-vitest-runs.md`) § Spike facts and its Review Record corrections.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete`.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C12,C13,C14,C19,C30,C32,C38,C39,C48,C57,C59,C119,C120,C125,C130,C131,C132,C134,C140,C142 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P1,P10,P13,P14,P16,P17,P18,P19,P20,P21,P27,P32,P35,P42 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area: packages/daemon
is_consolidation: false
sizing_ac_count: 10
files_to_modify:
  - packages/daemon/src/vitest/discover-tests.ts
  - packages/daemon/src/index.ts
files_to_create:
  - packages/daemon/src/vitest/workspace-session.ts
  - packages/daemon/src/vitest/module-tests.ts
  - packages/daemon/src/vitest/run-workspace.ts
  - packages/daemon/src/vitest/run-states.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId aed99b63-6f0d-4702-8258-f108f32ac3b4

#### Test Files This Change Broke

- `packages/daemon/test/defects.json`: the extraction moved or reworded the anchors of 22 records whose `file` is `packages/daemon/src/vitest/discover-tests.ts` (checked by counting each record's `old` in each source file after the change). Still anchored in place: D1050, D1054, D1055, D1057, D1058, D1075, D1076.
  - `old` unchanged, now in `packages/daemon/src/vitest/module-tests.ts`: D1051, D1052, D1067, D1069, D1070, D1071, D1083.
  - `old` unchanged, now in `packages/daemon/src/vitest/workspace-session.ts`: D1059, D1063, D1065, D1066, D1073, D1074, D1077.
  - Reworded, so `old` matches nowhere: D1053 (`modeOf` is gone; discovery reads `test.options.mode` inline in `sortModule`), D1056 (typecheck modules are now split off by specification pool in `workspace-session.ts` `openSession`, never collected), D1060 (the setup-error `catch` is in `inWorkspaceSession`), D1061 (the unsupported return is in `inWorkspaceSession`), D1062 (browser projects are filtered in `openSession`), D1068, D1072 (module location is built by `moduleLocator` in `module-tests.ts`), D1080 (the queue is `queueSessionJob` in `workspace-session.ts`).
- `packages/daemon/test/discover-tests.test.ts` imports only `discoverTests`, `DiscoveredTest`, `TestDiscovery` and `WorkspaceDiscovery` from `discover-tests.ts`, which all stay there; it compiles unchanged under the daemon typecheck.

#### ACs Owed a Test

None.

#### Tests Owed

Every criterion has probe evidence (§ Completion Notes), but none is pinned yet. These defect classes are the ones a later edit could reintroduce silently:

- A cancel issued straight from the abort listener before the first `onTestModuleQueued` is dropped by Vitest's reset, so a run aborted as it starts completes with every test passed (AC5). `RunInterruption` defers that cancel to the first queued module. A fixture of 3 slow modules under `maxWorkers: 1`, aborted at about 250 ms (after instance creation, before the first module), showed the deferral working on 5.0.1.
- A second `cancelCurrentRun` while the first is in progress makes Vitest force-stop workers and skip the consumer's teardown; `RunInterruption` issues at most one.
- A declared `skip` or `todo` in a crashed module must record no state (crash is decided per module first, AC6); a crashed module's other tests likewise, including one that finished before the crash.
- Each `nothingRan` reason: `no-module`, `no-module-ran`, `no-test-declared` (a module under `passWithNoTests` that declares no test), `every-test-skipped`, `tests-blocked-by-hook`, `interrupted-before-any-test-finished`.
- An abort after `runWorkspace`'s Vitest run ended must leave the run `completed` with its `ctx.skip()` tests skipped (AC5's last sentence).
- `test/fixtures/daemon/crash` covers the `forks` crash; U1 found the same shape under `threads`, `vmThreads` (ended by `process.reallyExit`) and `vmForks`.

### Tests Record

Tests session: threadId 2497d74d-f44e-476a-a798-b329eeda94b0

Re-pointed the 22 records the handoff listed; D1053, D1056, D1060, D1061, D1062, D1068, D1072 and D1080 got new anchors for the moved code, and all were re-proven. Library fact found while writing D1175: a cancel does not wait for the test in flight. The runner aborts that test's context signal and records it `skipped` with the abort note (5.0.1 `dist/chunks/run.C5UmxDPh.js`, `startTests`' `runner.cancel` and `failTask`'s `TestRunAbortError` branch), so a slow test running at the abort is recorded interrupted, as AC5 requires. § Spike facts' "finished `passed`" held only for a test that ended before the cancel reached its worker.

The `run-interrupt` fixture's config appends a reporter through `configureVitest` and `onAfterSetServer`, which run after Vitest builds its reporters on both versions, and reports `configure`, `global-setup`, `run-start`, `ready:<test>` and `run-end` to a host global. A test aborts at an exact point with it, including inside the window where Vitest drops an early cancel (`onTestRunStart` runs before `runFiles` resets `isCancelling`).

#### Named Defects

- D1160: A run locates its modules without their Vitest project, so a run's test identity differs from the one discovery gives the same test. (AC1)
- D1161: A failed or timed-out test is recorded without its error text. (AC1)
- D1162: A passing test, including an expected failure, is recorded failed. (AC1)
- D1163: A module that throws at load reads as a module that ran with no tests instead of a failed module. (AC3)
- D1164: A test its suite's failing beforeAll blocked is recorded skipped instead of an error. (AC2)
- D1165: Only a test's own suite is searched for a failing hook, so a test in a nested suite under a failing beforeAll is recorded skipped. (AC2)
- D1166: The module's own errors are never consulted, so a test a module-level beforeAll blocked is recorded skipped. (AC2)
- D1167: Suite hook errors are dropped from the module, so a failing beforeAll or afterAll leaves no error on the run. (AC2)
- D1168: A test that skipped itself in a suite whose afterAll failed is recorded as an error with the hook's text. (AC1, AC2)
- D1169: A failing module-level hook's error is dropped from a module that ran. (AC2)
- D1170: Unhandled errors are dropped from the run, so an error no test owns leaves no trace. (AC4)
- D1171: A run leaves the host process's exit code at the 1 Vitest sets. (AC9)
- D1172: A run that executed tests is still given a reason that nothing ran. (AC7)
- D1173: A crashed module's finished tests keep their outcomes, so a test from a worker that died reads as passed. (AC6)
- D1174: A module whose worker crashed at load in a completed run is recorded not run instead of crashed. (AC6, AC7)
- D1175: An interrupted run's unfinished and cancelled tests are recorded skipped or as errors instead of interrupted. (AC5)
- D1176: A declared skip in an interrupted run is recorded interrupted instead of skipped. (AC5)
- D1177: A test that skipped itself before an interruption is recorded skipped, though only note text tells it from a cancelled test. (AC5)
- D1178: A test a failing beforeAll blocked before an interruption is recorded as an error, though only note text tells it from a cancelled test. (AC5)
- D1179: A module an interrupted run never started is recorded crashed instead of not run. (AC5)
- D1180: An abort as Vitest starts the run is issued at once and dropped by Vitest's cancel reset, so the run completes as if never interrupted. (AC5)
- D1181: A test an interruption left pending is recorded skipped instead of interrupted. (AC5)
- D1182: A run interrupted before any test finished is given a skip or module reason instead of the interruption. (AC5, AC7)
- D1183: An abort that arrives before the first module is queued is never issued, so every test runs to its outcome. (AC5)
- D1184: An abort while the workspace loads is not checked once the instance exists, so the run starts executing modules. (AC5)
- D1185: A run aborted while it waits in the queue loads the workspace anyway. (AC9)
- D1186: A run is recorded interrupted whenever its signal aborted, even after Vitest ended the run. (AC5)
- D1187: Only the daemon's own cancel marks a run interrupted, so a run Vitest stopped under the consumer's bail reads as completed. (AC5)
- D1188: Runs skip the shared session queue, so two overlapping runs restore each other's host snapshots and leave a workspace's environment values in the host. (AC9)
- D1189: A workspace with no test module is given a reason other than having none. (AC7)
- D1190: A run whose every module failed is given a reason other than that no module ran. (AC3, AC7)
- D1191: A run whose modules declared no test reads as every test skipped. (AC7)
- D1192: A run whose every test was skipped reads as blocked by a hook. (AC7)
- D1193: A run whose every test a failing hook blocked reads as every test skipped. (AC7)
- D1194: Only a passed test counts as executed, so a run whose tests all failed reads as a run where nothing ran. (AC7)
- D1195: A run over a workspace on an unsupported Vitest reads as a run that ran instead of unsupported. (AC8)
- D1196: A run over a workspace whose configuration fails to load reads as a run that ran instead of failed. (AC8)
- D1197: A run drops the workspace's typecheck modules without reporting them. (AC8)
- D1198: A run drops a browser-mode project without reporting it unsupported. (AC8)
- D1199: A declared todo in an interrupted run is recorded interrupted instead of skipped. (AC5; review gap G1)
- D1206: A run aborted while its workspace loads is given a module reason instead of the interruption. (AC5, AC7; review gap G2)
- D1207: A placeholder module the run never collected reads as a module that ran with no tests. (AC6, AC7; review gap G3)
- D1208: An abort withheld until the first queued module, in a run where Vitest never queues one, leaves the run completed. (AC5; review gap G5, through the `run-unqueued` fixture, whose `// @module-tag` names a tag the config never declares, so `validateTags` fails the module before `onCollectStart` on both versions)
- Review gap G6: D1183 now asserts the whole record an issued cancel produces (every unfinished test interrupted, the unstarted module not run), so its mutation survives no longer.

#### Deliberately Untested

- `packages/daemon/src/vitest/run-states.ts` `recordModules`' `missing` modules (review gap G4): no fixture makes Vitest return no module for a specification. A module failing tag validation, one throwing at load, a failing setup file and a worker killed at load each come back as a module, and a forks worker given an unknown `execArgv` flag still started.

- `packages/daemon/src/vitest/run-workspace.ts` `RunInterruption` at-most-one-cancel guards (`this.cancelled !== undefined` in `cancel`, `if (this.queued) return;` in `onTestModuleQueued`): each is inert alone, since the abort listener is `once` and `onTestModuleQueued` cancels only on the first module, so neither mutation issues a second cancel while the other stands.
- `packages/daemon/src/vitest/run-workspace.ts` `specifications.length === 0` early return: inert, since a run over no specifications records the same `no-module` result through `recordModules` (D1189 pins the reason).
- `packages/daemon/src/vitest/run-workspace.ts` `cancelError`: no fixture can make Vitest's `cancelCurrentRun` reject, so no nameable defect is reachable.
- `packages/daemon/src/vitest/run-states.ts` a `beforeEach` failure stays failed: Vitest reports it so and no daemon branch handles it (owner ruling), so there is nothing to mutate.
- AC6 under `threads`, `vmThreads` and `vmForks`: U1 found the same shape as `forks`, and the mapping reads no pool, so a per-pool test would pin Vitest rather than daemon code.
- AC8's 5.x browser failure, AC9's `NODE_ENV` and env restore for runs: the shared session module owns them, and D1064, D1077, D1066 and D1073 already prove its lines.
- `packages/daemon/src/index.ts`: re-exports only.

### Review Record

Review session: threadId 5ae31154-f521-4aa0-b14e-65efe92a0958

Review fixes:

- `run-workspace.ts` `RunInterruption.execution`: an abort that arrives before the first queued module is withheld, and Vitest can end a run without queueing any module (a module failing tag validation, a worker that never starts; 5.0.1 `run.C5UmxDPh.js` `validateTags` before `onCollectStart`, `index.DzobfTyw.js` `cancelFiles`), so that abort was never issued and the run read completed. The run is now interrupted when an abort arrived before the run ended and no cancel was issued (AC5).
- `RunEvidence`, `IdentifiedTestCase` and `SessionResult` are no longer exported: no other file imports them (C59).
- File List: added the tests session's files.

Library facts found by this review (installed 5.0.1 and 4.1.11 source): `task.result.pending` is also set on a test the cancel aborted mid-run (`run.C5UmxDPh.js` `runTest`'s skip branch), so it separates `ctx.skip()` only outside an interrupted run, which is the only place the mapping reads it. `createVitest` plus `runTestSpecifications` creates no coverage provider, so a run writes no coverage report; missing snapshots are written outside CI, and Vitest writes its results cache under the consumer's `node_modules`. A crash in `afterAll` records the module crashed on both versions (review probe).

Tech debt (not in this change's reach):

- `packages/daemon/src/vitest/discover-tests.ts` `collectWorkspace`: the failed-module entries built from `specificationsWithoutModule` (a specification Vitest returned no module for) have no defect record, so dropping them survives every discovery test. The run's copy of the same path is gap G4 below.

#### Test Coverage Gaps

Denominator: 39 named-defect run tests (D1160 through D1198) against the behaviors AC1 through AC9 name.

| #   | Source                                                                  | Named defect                                                                                                                                                               | Expected test                                                                                                                                                                                                                 | Severity |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| G1  | `packages/daemon/src/vitest/run-states.ts` `DECLARED_SKIP_MODES`        | A declared `todo` in an interrupted run is recorded interrupted instead of skipped. (AC5)                                                                                  | Add an `it.todo` to `run-interrupt/a.test.mjs` and assert it `finished` `skipped` after the mid-run abort; mutation drops `"todo"` from the set.                                                                              | MEDIUM   |
| G2  | `packages/daemon/src/vitest/run-workspace.ts` `runSession` abort branch | A run aborted while its workspace loads is given a module reason instead of the interruption. (AC5, AC7)                                                                   | Assert `nothingRan` is `interrupted-before-any-test-finished` for the `configure` abort; mutation `...nothingRan("interrupted", modules),` to `...nothingRan("completed", modules),`.                                         | LOW      |
| G3  | `packages/daemon/src/vitest/run-states.ts` `recordModule`               | A placeholder module the run never collected reads as a module that ran with no tests. (AC6, AC7)                                                                          | Mutation removes `if (!wasCollected(testModule)) return unstartedModule(location, interrupted);`. D1174 and D1179 also go red on it; both fixtures reach the placeholder path (review probe, 5.0.1).                          | MEDIUM   |
| G4  | `packages/daemon/src/vitest/run-states.ts` `recordModules`              | A specification Vitest returned no module for is dropped from the run record. (AC7)                                                                                        | Mutation `return [...recorded, ...missing];` to `return recorded;`. No run fixture reaches this path (review probe); Vitest reaches it when a worker fails to start. Record it deliberately untested if no fixture can.       | LOW      |
| G5  | `packages/daemon/src/vitest/run-workspace.ts` `execution`               | An abort withheld until the first queued module, in a run where Vitest never queues one, leaves the run completed. (AC5)                                                   | A run whose every module fails before it is queued (tag validation), aborted during global setup, is recorded interrupted; mutation removes `\|\| withheldAbort`. Record it deliberately untested if no fixture can reach it. | MEDIUM   |
| G6  | `packages/daemon/src/vitest/run-workspace.ts` `onTestModuleQueued`      | An abort that arrives before the first module is queued is never issued, so every test runs to its outcome. (AC5) D1183 now survives its mutation after the G5 review fix. | Extend D1183 to assert a test state that only the issued cancel produces (for example `never finishes` recorded interrupted), not only `execution`.                                                                           | MEDIUM   |

### Completion Notes

Built as one dependency chain in the dev session, with no implementer agents: no two task groups were file-disjoint and unordered (dev-ticket Step 5b).

- `workspace-session.ts`: the shared steps. `queueSessionJob` is the one queue for discovery and runs. `inWorkspaceSession(workspace, reporters, step)` resolves Vitest (unsupported), captures and restores host state, sets `NODE_ENV`, creates the instance with the caller's reporters, splits the resolved specifications into runnable ones, typecheck modules (pool `typescript`) and browser-mode projects, turns a thrown error into a failed workspace, and closes the instance.
- `module-tests.ts`: `moduleLocator` (real workspace directory and real module id), `identifyTests` (name path and `identifyModuleTests`), `wasCollected`, `specificationsWithoutModule`, and the `ModuleReport` and `FailedModule` types.
- `discover-tests.ts` is now a thin collect step over both.
- `run-states.ts` maps modules and tests by § State mapping, crash per module first. Outcome and execution are separate fields (`TestRunState`), and `nothingRanReason` gives the reason.
- `run-workspace.ts`: `runWorkspace(workspace, signal)` and `WorkspaceRun`.

Sanity check (Step 4), sent to the author and confirmed with the ticket updated: F1 interruption is read from the `onTestRunEnd` reason or a pre-run abort, never from whether `runTestSpecifications` had resolved; F2 crash is decided per module before the per-test rules; F3 AC7 became a rule rather than a list; F4 a blocked test takes the errors of its nearest erroring suite or module.

U1 CONFIRMED (resolution beneath the table).

Acceptance evidence. A scratch probe drove the built `runWorkspace` over fixtures in temp directories on 5.0.1 and 4.1.11, with identical states on both:

- AC1: passed, failed (assertion text), timed out as failed with `Test timed out in 50ms.`, `it.skip`, `it.todo`, a test in `describe.skip`, and a `ctx.skip()` test recorded skipped; `it.fails` passed. Duplicate names got `#0` and `#1` marked duplicate. All 18 recorded tests matched a discovered identity (the fixture's other 3 discovered tests sat in the crashed module).
- AC2: tests under a failing suite `beforeAll` (nested ones included) and under a module-level `beforeAll` recorded error with the hook's error. `afterAll boom` sat on the module while its suite's test stayed passed. A `beforeEach` failure recorded failed.
- AC3: a module throwing at load, and a project whose setup file throws, were recorded failed with their error and no tests.
- AC4: `unhandled boom` appeared only in the run's `unhandledErrors`, and both tests of its module passed.
- AC5: an abort before the call, or while queued behind another run, gave `interrupted-before-load`. An abort during load or before the first module gave `interrupted`: every module not run, or the first module's tests interrupted, with reason `interrupted-before-any-test-finished`. An abort mid-module kept finished outcomes and the declared skip, and marked unfinished and `ctx.skip()` tests interrupted and unstarted modules not run. An abort after the run gave `completed`. `bail: 1` gave `interrupted`.
- AC6: a SIGKILLed module was recorded `crashed` with no test states (its declared skip included), its sibling module ran, and the run stayed `completed` with the pool error in `unhandledErrors`.
- AC7: each nothing-ran reason was produced by its own fixture.
- AC8: over every workspace of `test/fixtures/daemon/consumer`, `runWorkspace` reported the same status as `discoverTests`: unsupported 3.2.4, `config boom` failed, the browser project failed on 5.x with no provider and unsupported by name on 4.1.11. The typecheck module was listed in `typecheckModules` with no test.
- AC9: host `process.env` and `process.exitCode` were identical before and after every probe, and a run aborted while waiting behind another run never loaded.

Discovery unchanged: `discoverTests` over all seven daemon fixtures on both versions, snapshotted before and after the extraction, compared equal with arrays sorted (module order already varies from run to run), apart from a temp-dir name inside a crash message. The one intended difference, typecheck specifications no longer collected, stands by owner ruling (§ Grill record, 12:03).

Adversarial review (Step 7), triaged:

- Fixed: a cancel promise with no rejection handler until the run resolved (a throwing `globalSetup` after an abort would have left an unhandled rejection, which Vitest's logger answers with `process.exit`); a second `cancelCurrentRun` issued while the first was in progress (Vitest's force-stop); the `ran` module's `errors` docblock, which claimed only hook errors.
- Fixed after the author confirmed it: a module that ran and declared no test (`passWithNoTests`) no longer reads as `no-module-ran`; the new reason is `no-test-declared`.
- Stands by ruling: discovery's typecheck edge case.
- Two findings remain as candidates below.

Post-fix re-validation: daemon typecheck exit 0, oxlint exit 0, and Prettier clean over the changed files. The probes were re-run on the fixed build.

Other decisions:

- `cancelCurrentRun` gets `"keyboard-input"`, the reason Vitest's CLI gives a user-initiated cancel; its type admits only that and `"test-failure"` (bail).
- Rule deviations accepted by the owner (§ Grill record): C59 (`runWorkspace` has no production caller until 1.3), C32 (no daemon log until 1.3), and C131 (a timeout stays failed).
- README: `README.md` Status says the daemon package only discovers tests, which this change makes false. The replacement text went to the orchestrator, since the file is outside this lane's grant.

Change-request candidates, each a fork for the owner:

1. **A stuck test makes an interrupt hang.** Vitest's graceful cancel waits for the running test to finish, so a test in a synchronous infinite loop keeps an interrupted run from ending. The shared session queue then blocks every later run and discovery. Option (a): after a named grace period, issue a second `cancelCurrentRun`, which force-stops the workers and skips the consumer's `afterAll` and teardown, and record that on the run. Option (b): leave it unbounded. Recommendation: (a), owned by 1.3 (shutdown) or 2.3 (interrupting runs), which set interruption policy; not in this ticket's criteria. Surface `daemon-state`, reach unknown.
2. **Runs inherit the consumer's coverage and snapshot settings.** A consumer config with `coverage.enabled` makes every daemon run clean and rewrite its coverage directory in the working tree, and the default snapshot update mode writes new snapshot files. Recommendation: daemon runs pass coverage disabled and snapshot update `none`, so a background executor never writes into the consumer's tree and a missing snapshot fails. It is a one-file change in `workspace-session.ts`'s run path, but it decides what a daemon run may write, so the owner rules. Surface `daemon-state`, reach unknown.

### File List

- `packages/daemon/src/vitest/workspace-session.ts` (created)
- `packages/daemon/src/vitest/module-tests.ts` (created)
- `packages/daemon/src/vitest/run-states.ts` (created)
- `packages/daemon/src/vitest/run-workspace.ts` (created)
- `packages/daemon/src/vitest/discover-tests.ts` (modified)
- `packages/daemon/src/index.ts` (modified)
- `packages/daemon/test/discover-tests.test.ts` (modified, tests session)
- `packages/daemon/test/defects.json` (modified, tests session)
- `test/fixtures/daemon/run/`, `test/fixtures/daemon/run-bail/`, `test/fixtures/daemon/run-crash/`, `test/fixtures/daemon/run-interrupt/`, `test/fixtures/daemon/run-nothing/` (created, tests session)
- `_agent-docs/tickets/1-1b-record-run-states.md` (modified: task and criterion boxes, U1 resolution, Dev Agent Record)
- No dependency change.

Planning files the create-ticket run wrote:

- `_agent-docs/tickets/1-1b-record-run-states.md` (created)
- Sent to the orchestrator as exact text: the FR2 amendment and its `[Ticket 1.1b]` marker (`docs/requirements.md`), the **Interrupted run** and **Crashed module** entries (`docs/glossary.md`), the sprint file's 1.1b section, and the status transition to `ready-for-dev`.

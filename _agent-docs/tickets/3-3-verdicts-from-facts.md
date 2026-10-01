# Ticket 3.3: Verdicts from run facts

## Ticket

As the daemon, which falsifies a consumer's named defects in place of its coding agents,
I want each experiment's raw record turned into the run facts ADR-0008 names and one verdict decided from those facts alone, with every would-be detection repeated once in the same instance, proven over canary fixtures that each fail in one known way,
so that no detection is ever credited to a setup, collection, compile, timeout, unhandled or unrelated failure, and ticket 3.4 can store each verdict with the facts behind it.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

Every criterion holds on Vitest 4.1.x and 5.x, on Windows and on Linux. "The intended test" is the test an experiment names, found by its full test identity. A run "ended cleanly" when it was not interrupted, Vitest did not force-stop its workers, and cancelling it raised no error. A run the job's own abort interrupted leaves no record, so a recorded run reads interrupted only when something else ended it. A baseline's unhandled error "counts against" an experiment when it names the experiment's test module, as the module the worker that raised it was running, or when it names no test module of that baseline.

- [ ] AC1: For every experiment of a job that read `ran`, the job's reply carries one judgement: a verdict (detected, survived, invalid experiment or unclear) or no verdict; for every judgement but detected and survived, its one reason as a value from a closed set, never a sentence; and the facts it rests on. Each condition that AC6, AC8 and AC9 list between semicolons is one reason of that set, and what a parenthesis adds travels with the reason as detail. The facts are read from the intended test in the experiment's run, in its confirming run when one ran, and in both baselines: its state and mode; each of its errors as a kind, with the name Vitest serialized; its hook states; and its reach. For each of those runs they give the count of module errors, each failing suite's name path with its error count, the count of unhandled errors (for a baseline, of those that count against the experiment, and how many of those named no test module), and how the run ended. They also give what the mutation's transforms did in its run and in its confirming run, and whether the run the job started next left a record, with its count of unhandled errors. A fact Vitest did not record is absent, never zero, empty or false. The facts hold no error message, stack or source text, and every judgement is decided from them alone. A job that did not read `ran` carries no judgement. The reply's falsifier version is higher than the one ticket 3.2 built, since what a record means has changed. (FR11, NFR6)
- [ ] AC2: An error is an assertion when Vitest serialized it with the name `AssertionError`, or with the `JestExtendError` constructor marker and an assertion name, or when its name is exactly one of the assertion error names the job was given. Every other error is another kind: a `TypeError`, a timeout, an `expect.assertions` count failure and a snapshot matcher's mismatch among them. The names reach the judge as an input of the job: an argument of `Executor.falsify`, a field of the `falsify` request, and a parameter of `falsifyWorkspace`. With no names given, only the first two forms are assertions. (FR11)
- [ ] AC3: A run of an experiment is a would-be detection when, in that run, all of these hold: the run ended cleanly and recorded no module error, no suite error and no unhandled error; the intended test ran and failed; every hook state Vitest recorded on it is `pass` (a state of `run` on the finished test is a hook that did not end in pass); it holds at least one error, and every error it holds is an assertion; and its reach reads executed, in the test or outside it. (FR11, NFR7)
- [ ] AC4: An experiment whose run is a would-be detection runs once more, at once, as a confirming run: in the same instance, over the same specification, with its own mutation alone, behind the same stale-transform guard and abort check as its first run, before any other experiment and before the restored baseline. No other experiment runs twice, and no experiment runs a third time. Since only an experiment the baseline passed has a first run, no confirming run happens for a test the baseline did not pass. An abort during a confirming run ends the job there, as an abort during any run does. (FR10, FR11)
- [ ] AC5: An experiment reads detected only when all of these hold: the baseline and the restored baseline each passed the intended test, ended cleanly and recorded no unhandled error that counts against the experiment; its run and its confirming run are each a would-be detection; the run the job started next after its confirming run left a record that holds no unhandled error; and the job's own process recorded no unhandled error and closed the instance without error. Nothing else reads detected. (FR11, NFR7)
- [ ] AC6: An experiment reads invalid experiment, with the first reason that holds, in this order: its change has no probe site (the record's position travels with the reason); no test module of the workspace holds the test; the baseline did not pass the test (with the state the baseline gave it, or that it did not report it, and the test's mode, so a test declared with `it.skip` or `it.todo` reads as one); the baseline did not end cleanly, or recorded an unhandled error that counts against the experiment; the restored baseline did not pass the test; the restored baseline did not end cleanly, or recorded an unhandled error that counts against the experiment; the experiment's run did not end cleanly; its module recorded a module error, was not collected or is missing; a suite of its module recorded an error (naming the suite); the intended test did not run (it is absent from the run, skipped or pending); a hook did not end in pass (naming the hook); its reach reads not executed, neither in the test nor outside it; or its reach is unknown (with the record's reason). Reach is read only from the intended test's reach mark. What the mutation's transforms did only words the reason of a site that did not execute (the mutated module was never transformed, or `old` occurred other than once in the text transformed, naming the count), and never stands in for a mark. (FR11, NFR7)
- [ ] AC7: An experiment reads survived when no reason of AC6 holds and the intended test passed, so the mutated site executed, in the test or outside it, and the test did not reject the mutation. A survivor stays survived beside an unhandled error in its own run. (FR11)
- [ ] AC8: An experiment reads unclear when no reason of AC6 holds, the intended test failed, and one of these holds, the first in this order giving the reason: the test holds no error or an error that is not an assertion; its run recorded an unhandled error; its run was a would-be detection and its confirming run was not (naming what the confirming run alone would have read); the run the job started next after its confirming run recorded an unhandled error or left no record; or the job's own process recorded an unhandled error or failed to close the instance. (FR11, NFR7)
- [ ] AC9: An experiment has no verdict, with its reason, when the job did not finish its runs or the job's own check before any run decided it: its record reads interrupted; its mutation's file could not be read; `old` did not occur exactly once in that file when the job started (the count travels with the reason); the baseline left no record; its run left no record; its confirming run left no record or was interrupted; or the restored baseline is absent or left no record. Whether an experiment has a verdict is decided before which verdict it has, except that the reasons of AC6 a job decides without a run of the experiment (no probe site, no module, baseline did not pass) hold whether or not a restored baseline ran. Every experiment a job that read `ran` was given reads exactly one judgement. (FR11)
- [ ] AC10: `packages/daemon/canaries/` holds RT Test's canary fixtures: a Vitest project of plain `.mjs` files that import no package but `vitest`, whose test modules this repository's own suite does not collect, and `canaries.json`, which names for each canary its intended test, its mutation and the one judgement (the verdict, and the reason where the verdict has one) it must read, and for the set the assertion error names its job is given. Every canary's test passes unmutated. A falsification job over the set, on Vitest 4.1.x and on 5.x, reads for each canary exactly the judgement the file names. The set holds a canary for each of these. Detected: an `expect` failure in the test body; a failing matcher added by `expect.extend`; an error whose name the set declares; an assertion after a site that executes while its module loads. Survived: a test that passes after executing the site. Invalid experiment: an assertion that fails in a `beforeEach`; an `afterEach` that throws; a `beforeAll` that throws; a mutated module that throws while it loads; a mutation that does not parse, which reads as a change with no probe site, decided before any run; a test that passes without executing the site; a test that fails an assertion without executing the site; a mutated module the test never loads; a site executed while tests run concurrently. Unclear: a `TypeError` thrown in the body; a test that times out; an `expect.assertions` count failure; a snapshot matcher's mismatch; a thrown error of a name the set does not declare; an assertion failure beside an unhandled rejection; an assertion error beside an error of another kind. (FR11, NFR7)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                  | Why it matters if wrong                                                                                                                                                                                        | How to check                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | When a mutated module throws while it loads, does the experiment's record on each line show a module error, an uncollected module, or a collected module with the intended test absent?                                                     | Each reads invalid experiment: a module error or an uncollected module by AC6's module reason, an absent test by its did-not-run reason. The answer fixes the judgement `canaries.json` names for that canary. | Run that canary through a job on 4.1.11 and 5.0.1 and read its module in the experiment's record.                                           |
| U2  | Does a test that times out after the mutated site executed still return its reach mark, so its reach reads executed in the test, on both lines?                                                                                             | Without the mark the timeout canary reads invalid experiment (reach unknown or not executed) rather than unclear. Neither is a detection; the canary's judgement differs.                                      | Run the timeout canary through a job on both lines and read the intended test's reach.                                                      |
| U3  | In a falsification session (the no-write options and the snapshot guard), does a `toMatchInlineSnapshot` whose value differs fail the test with the plain mismatch error on both lines, rather than rewrite the snapshot or fail elsewhere? | The snapshot canary's reading (unclear, an error that is not an assertion) rests on it.                                                                                                                        | Run the snapshot canary through a job on both lines and read the intended test's errors and the canary file's bytes.                        |
| U4  | Does an `expect.soft` failure followed by a thrown `TypeError` leave both errors on the test's result, on both lines?                                                                                                                       | The mixed-kinds canary needs one assertion and one error of another kind on one result; if only one error arrives, build the mix another way.                                                                  | Run that canary through a job on both lines and read the names of the intended test's errors.                                               |
| U5  | On Vitest 5 with a vm pool, does a mutated module the main process prewarmed, but no worker loaded, leave a non-empty transform list beside a reach of not executed?                                                                        | Informational: AC6 never reads the list as reach. The answer only confirms the wording of the "did not execute" reason.                                                                                        | Run one experiment whose test never imports the mutated module in a `vmThreads` project on 5.0.1 and read its transform list and reach.     |
| U6  | Is the test file path a worker stamps on an unhandled error spelled as the specification's module id is, on both lines, on Windows and on Linux (drive letter case, separators, a linked root)?                                             | A spelling the job cannot match reads as naming no module, so the error counts against every experiment of the job: safe, but wider than the ruling intends.                                                   | Leak a rejection from one of two test modules in a baseline on both lines and compare the stamped path with that specification's module id. |
| U7  | Does the leaked-rejection canary's rejection reach its own run's record every time, on both lines, rather than the run after it?                                                                                                            | Late, the canary reads unclear by another reason of AC8, and as the last canary it would land in the restored baseline and mark every canary of its module invalid.                                            | Run that canary through a job ten times on both lines and read which run's record holds the error.                                          |
| U8  | Does a pair of concurrent tests in a canary module leave the reach of that module's sequential tests known, on both lines?                                                                                                                  | If concurrency makes other tests' reach unknown, the concurrent canary needs a module of its own, as the `falsify` fixture gives its concurrent tests.                                                         | Run a sequential canary of the module that holds the concurrent pair through a job and read its reach.                                      |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing. Write each answer, with its observed output, under the table.
- [ ] (AC1, AC2) Create the run facts: from one run's record, a test identity and the assertion error names, the intended test's state, mode, hook states and reach, each of its errors as a kind with its serialized name and the marker that made it an assertion, the module error count, each failing suite's name path and error count, the unhandled error count, and how the run ended. Read error fields off `RawError` by name with the JSON guards, never by matching a message. The facts hold no message, stack or source text. Beside the per-run facts, an experiment's facts give what its mutation's transforms did in its run and in its confirming run, and whether the run the job started next left a record, with its unhandled error count. A run that left no record gives no facts, and a fact Vitest did not record is absent, never zero, empty or false (C12).
- [ ] (AC1, AC5, AC6) Record, for each unhandled error of a run, the test modules of that run it names: resolve the path the worker stamped on it (`VITEST_TEST_PATH`) against the run's specifications where `recordRun` holds them, comparing files as the stale-transform guard does (`moduleFileKey`). Record every specification whose file matches, since one file can run under several projects, and record none when no specification matches. A baseline's unhandled error then counts against an experiment whose intended test is in a named module, and against every experiment when it names none.
- [ ] (AC1) Raise `FALSIFIER_VERSION` in `falsify/experiment-record.ts` by one, once, for this ticket and for 3.2b, which leaves that file alone.
- [ ] (AC3, AC5, AC6, AC7, AC8, AC9) Create the judge as a pure module with no Vitest, executor or file dependency: one predicate for a would-be detection, used for the first run and the confirming run alike (C8), and one function that gives an experiment its one judgement from run facts alone: those of its run, its confirming run, both baselines and the run the job started next, what its transforms did, its not-run reason when it has one, the job's own unhandled error count and whether the instance closed. Neither takes a raw record or a `RawError`, so no message is in the judge's reach (AC1); the assertion error names go to the run facts, which give each error its kind. Check AC9's reasons first, except that its restored-baseline reason does not outrank the reasons of AC6 a job decides without a run of the experiment (no probe site, no module, baseline did not pass); then AC6's in its order, then AC7, AC8 in its order, and AC5 last. Spell each verdict and each reason as a named constant in kebab-case, as `DEFECT_STATE` spells states.
- [ ] (AC4) Add the confirming run to the job: after an experiment's run that the judge reads as a would-be detection, run it once more through the same gated path and the same run step, and keep the confirming run's record and its transform list beside the first run's. Reach the confirming run only from the path the baseline gate guards, so `experiment()` gains no caller that skips the gate. Keep `falsify/falsify-workspace.ts` under the line cap (P16), extracting by responsibility if the change needs the room.
- [ ] (AC2) Carry the assertion error names through the job: a parameter of `Executor.falsify`, a field of the `falsify` request in `executor-jobs.ts`, the call in `executor-main.ts`, and a parameter of `falsifyWorkspace`. Edit around the anchored text of the defect records those files hold.
- [ ] (AC1, AC9) Put each experiment's judgement and facts on the job's reply, decided once the instance has closed, so the close error and the job's own unhandled errors are in hand. A job that did not read `ran` carries none. The run that follows an experiment is the next run the job started: another experiment's first run, or the restored baseline. A run the stale-transform guard refused never started and is passed over; a started run that left no record is not, and the detection before it reads unclear (AC8).
- [ ] (AC10) Create the canary set under `packages/daemon/canaries/`: a config that includes only its `*.canary.mjs` modules, source modules whose one-line mutations each switch on one failure, the canary modules, and `canaries.json`. Assert in hooks with `assert` from `vitest`, since lint refuses an `expect` outside a test. Order the canaries so the one that leaks an unhandled rejection is followed by a canary that need not read detected, and is never the last before the restored baseline.
- [ ] (Support) Report to the orchestrator the `docs/architecture.md` text for § Falsification jobs (the confirming run, the judgement and facts on the reply, the canary directory) and for § Execution and falsification isolation, and each known limit the build confirms or adds; write none of it yourself. The ADR-0008, glossary, sprint and README text the rulings changed went to the orchestrator with this ticket (Dev Notes § Doc text reported at authoring); report only what the build makes differ from it.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `testResultIn(record, identity)` (`packages/daemon/src/falsify/experiment-record.ts`): the intended test's result in a run, by its full identity, or undefined when the run recorded none.
- The raw record types of the same file: `RunRecord`, `RecordedRunTest` (with `mode`, `state`, `errors`, `hooks`, `reach`), `RecordedRunModule`, `RecordedSuiteErrors`, `Reach`, `ReachUnknownReason`, `RawError`, `RunOutcome`, `UnrecordedRun`, `ExperimentNotRun`, `ExperimentRecord`, `JobRuns`, `FalsificationJob`. Derive the facts' types from these rather than restating a shape (C14).
- `MutationLoad` (`packages/daemon/src/falsify/mutation-transform.ts`) and `NoProbeSite` (`packages/daemon/src/falsify/reach-probe.ts`): what each transform did, and the position a "no probe site" reason carries.
- `FalsificationRuns` in `packages/daemon/src/falsify/falsify-workspace.ts`: `#experimentAfter` holds the baseline gate, `experiment(plan)` runs one experiment and is callable again for the same plan, and `#run` invalidates the mutated files, checks the abort with no await before the run starts, and records the run.
- `isRecord` and `isStringArray` (`packages/daemon/src/json-guards.ts`): reading a `RawError`'s fields, which are `unknown`.
- `moduleFileKey` (`packages/daemon/src/falsify/stale-transform-guard.ts`): a file's path resolved through links, with `/` separators and case-folded on Windows, for matching the path a worker stamped on an unhandled error to a specification's module.
- `testIdentityKey` and `TestIdentity` (`packages/core/src/test-identity.ts`).
- `DEFECT_STATE` (`packages/daemon/src/defects/resolve-definitions.ts`): the spelling the verdict values follow. Ticket 3.4 extends it with the evidence states and moves it; this ticket does not edit it.
- `Executor.falsify`, the `falsify` request and the `falsified` reply (`packages/daemon/src/daemon/executor.ts`, `executor-jobs.ts`, `executor-main.ts`).
- For create-tests: `inTempDir`, `linkVitest` and `VitestInstall` (`packages/daemon/test/harness.ts`). `inConsumerCopy` and `copyFixture` copy only from `test/fixtures/daemon`, so the canary test copies `packages/daemon/canaries/` itself.

### Must Create

- The run facts and the error kinds, under `packages/daemon/src/falsify/`.
- The judge, its verdict and reason constants and its judgement type, under the same folder.
- The canary set: `packages/daemon/canaries/` with its config, source modules, `*.canary.mjs` modules and `canaries.json`.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### The record's reasons, mapped

Each member of the raw record's reason types, as `packages/daemon/src/falsify/experiment-record.ts` declares them (read at 21:45), beside the criterion that reads it. The implementing session's sanity check fails on a member with no line.

- `ExperimentNotRun`: `no-probe-site`, `no-module` and `baseline-not-passed` read invalid experiment (AC6's first three reasons); `interrupted`, `unreadable`, `anchor-count`, `baseline-not-run` and `run-unrecorded` read no verdict (AC9).
- `NoProbeSite` (`falsify/reach-probe.ts`): `position` and `unparsed` both travel as the detail of AC6's no-probe-site reason. A mutation that does not parse is `unparsed`.
- `UnrecordedRun`: `stale-modules` (the run never started) and `run-failed` (it started and left no record) are both "left no record" for AC9. Only `run-failed` is a started run for the run the job started next (AC5, AC8).
- `ReachUnknownReason`: `not-observed`, `unattributed` and `no-probe` travel as the detail of AC6's reach-unknown reason.
- `Reach`: `in-test` and `outside-test` read executed; `no` reads not executed.
- A job's status: only `ran` carries judgements; `refused`, `failed`, `unsupported`, `not-confirmed` and `interrupted-before-load` carry none (AC1).

#### What the criteria rest on

FR10: "Falsify each defect definition by applying its mutation as an in-memory transform in a separate Vitest instance, between a baseline and a restored baseline that both pass its test, without writing any file."

NFR6: "Leave every consumer file byte-identical through falsification, writing no mutation anywhere on disk." C147 is why the facts, which 3.4 stores, hold no message or source text.

ADR-0008, reach outside the test: "Code that runs while the module loads marks every test of that test file, since each can read what it set", and among its known limits, "a site run while its module loads counts for every test of that file."

FR11: "Decide each falsification verdict from run facts (failure phase, error kind, whether the mutated site executed during the intended test, the baseline result), counting as a detection only an assertion failure in the intended test after the mutated site executed, repeated in a confirming run."

NFR7: "Credit no detection to a setup, collection, compile, timeout, unhandled, or unrelated failure, across the canary fixtures and the falsification corpus on every supported Vitest line."

ADR-0008, the facts: "its state; the kind of each of its errors, which is an assertion when Vitest serializes it as an `AssertionError` or as a matcher failure it marks with the `JestExtendError` constructor and an assertion name (the form `expect.extend` matchers such as jest-dom's take), or when its name is one the consumer declares in `rt-test.json`, and otherwise another kind; the hook states Vitest records on the test's result; the module and suite errors; the run's unhandled errors; whether the mutated site executed during that test (reach); and the intended test's result in the baseline and the restored baseline."

ADR-0008, the decision: "An experiment would be detected when the baseline and the restored baseline passed the intended test, the mutated site executed during it, and it failed with every hook it ran ending in pass, at least one assertion error, and no module, suite or unhandled error. A would-be detection is run once more, as a confirming run in the same instance, and is detected only when that run meets the same conditions; otherwise it is unclear, naming the instability. It survived when the intended test passed after the site executed. It is an invalid experiment when either baseline did not pass, a hook did not end in pass, a module or suite error was recorded, the site did not execute during the intended test or its reach is unknown, or the intended test did not run. It is unclear when the intended test failed in its body with no assertion error, as a thrown `TypeError` or a timeout does, or beside an unhandled error. Anchor missing and an invalid definition are decided before any run."

ADR-0008, the canaries: "These facts are Vitest's internals, and a release that stopped recording hook states would credit an `expect` failing in a `beforeEach` as a detection. So RT Test ships canary fixtures, each failing on purpose in one known way, which its own suite checks on both supported Vitest lines."

ADR-0007: "runs the tests' modules unmutated (the baseline), then each defect's experiment alone, repeating once any experiment that would be a detection (ADR-0008), then the baseline again (the restored baseline)."

C138 (checklist) is why a baseline, a detection's own run and the job itself must each have ended cleanly, and C137 why no confirming run can happen for a test the baseline did not pass.

#### Facts settled in installed source (2026-09-30)

Each was read in the repository's installs of Vitest 4.1.11 (`@vitest/runner@4.1.11` `dist/chunk-artifact.js`, `@vitest/expect@4.1.11` `dist/index.js`, `vitest@4.1.11` `dist/chunks/`) and Vitest 5.0.1 (`dist/chunks/run.C5UmxDPh.js`, `dist/chunks/index.m3L2HgmY.js`, `dist/chunks/index.DzobfTyw.js`).

- **Hook states.** `callSuiteHook` writes a hook's state `run` before a suite level's hooks and `pass` after them, only for a level that has such hooks, and a throw leaves `run` (`updateSuiteHookState`, both lines). It runs the parents' `beforeEach` hooks first and the parents' `afterEach` hooks last, each level in its own `run` then `pass` step on the same key. The reach setup file registers a `beforeEach` of its own on every file, so every test of a falsification run holds a `beforeEach` state: 3.2's D3639 reads `{ beforeEach: "pass", afterEach: "run" }` on a test whose suite has only a throwing `afterEach`.
- **A hook's error lands on the test.** A throw in `beforeEach` or `afterEach` goes through `failTask(test.result, ...)`, so the test fails and holds that error, an `AssertionError` included (`runTest`, both lines). Only the hook state tells it from a body failure.
- **A retry keeps the earlier attempts' errors.** Before a retry, `runTest` sets the state back to `run` and adds one to `retryCount`; it never clears `result.errors`, and `failTask` appends. Each attempt overwrites the hook states. So a retried test's errors are those of every attempt, and its hook states are the last attempt's.
- **A failing `beforeAll`** fails the suite (`failTask(suite.result, ...)`) and marks every task under it skipped (`markTasksAsSkipped`), so the intended test reads skipped and its suite holds the error (`runSuite`, both lines).
- **`it.fails` flips the result.** A passing body becomes a failure with a plain `Error` ("Expect test to fail"), and a failing body becomes a pass with no errors (`runTest`, both lines).
- **A timeout is a plain `Error`.** `makeTimeoutError` builds `new Error("Test timed out in ...")`, with no assertion marker (4.1.11 `chunk-artifact.js`; 5.0.1 `dist/chunks/run.C5UmxDPh.js`).
- **An `expect.assertions` count failure is a plain `Error`** ("expected number of assertions to be ...", 4.1.11 `dist/chunks/test.DNmyFkvJ.js`; 5.0.1 `dist/chunks/index.m3L2HgmY.js`).
- **A snapshot matcher's mismatch is a plain `Error`.** `toMatchSnapshot`, `toMatchInlineSnapshot` and the two `toThrowErrorMatching...` matchers throw `Object.assign(new Error(message), { actual, expected, diffOptions })` (`assertMatchResult`, 4.1.11 `dist/chunks/test.DNmyFkvJ.js`, 5.0.1 `dist/chunks/index.m3L2HgmY.js`): the name is `Error` and there is no `JestExtendError` marker.
- **The two assertion forms.** chai 6.2.2's `AssertionError` gives its name through a getter (`get name()` returning `"AssertionError"`), and `assert` from `vitest` fails through the same `Assertion.assert` as `expect`. A `JestExtendError` (`@vitest/expect@4.1.11` `dist/index.js`; 5.0.1 `dist/chunks/index.m3L2HgmY.js`) carries `__vitest_error_context__` with `assertionName`; 3.2's D3638 reads it serialized as the constructor field `"Function<JestExtendError>"` with the assertion name, and 3.2's review found a chai `AssertionError` serialized with no constructor field.
- **Unhandled errors.** A worker stamps each one with `VITEST_TEST_PATH`, the test file it was running (the worker state's `filepath`, set from the file task's `filepath` in 4.1.11 `dist/chunks/base.B6Opl8PE.js`), and `VITEST_TEST_NAME` (`listenForErrors`, 4.1.11 `dist/chunks/init.k9zZ9sLh.js`, 5.0.1 `dist/chunks/init.3UJvPvQg.js`). An error the main process raises itself carries neither. A run clears the instance's errors when it starts (`this.state.clearErrors()` in `runFiles`, 4.1.11 `dist/chunks/cli-api.CnMVyzaz.js`; the same call in 5.0.1 `dist/chunks/index.DzobfTyw.js`) and returns them as soon as the pool's tests end, so one a stopping worker reports late joins the next run's errors, or is cleared when it arrives between two runs.
- **Vitest 5 vm pools prewarm.** The vm worker asks the main process to prewarm a file's module graph (`rpc.prewarmModuleGraph` in 5.0.1 `dist/chunks/vm.W4G5WMTl.js`, unless the environment sets `prewarmModules: false`), so a module can be transformed with no worker loading it.
- **Lint.** `bun x oxlint` on a scratch `*.canary.mjs` file holding an `expect` inside a `beforeEach` reported `vitest(no-standalone-expect)` and exited 1 (22:02). The same file's `it.concurrent` test and its leaked rejection drew no finding.

#### Design decisions (scope of analysis: the judge, the confirming run and the canary set; storing, scheduling and the canary gate are unanalyzed here)

- **The judge is pure and lives in the executor's reach.** The job needs it between runs, to decide whether an experiment repeats, and again once the instance has closed. One predicate answers "is this run a would-be detection" for both uses (C8).
- **The judgements ride in the job's reply.** The executor process decides them, since only there are the raw records, the close error and the job's own unhandled errors all in hand. 3.4 stores what it receives.
- **The facts carry no message.** They hold kinds, names, states and counts. The raw records, messages included, stay on the reply as 3.2 built them, and what 3.4 strips before storing is unchanged by this ticket.
- **Every error must be an assertion.** ADR-0008 asks for "at least one assertion error". Since a retried test keeps every attempt's errors while its hook states are the last attempt's, an assertion thrown by a `beforeEach` on a first attempt and a `TypeError` in the body on a second would read as a failed test with every hook `pass` and one assertion error: a detection credited to a setup failure. Requiring every error to be an assertion closes that without any retry fact on the record. The cost is that an `expect.soft` failure followed by a throw reads unclear.
- **Any module or suite error in the experiment's run reads invalid experiment,** as ADR-0008 words it, not only one in a suite that encloses the intended test. A module holding a suite whose `beforeAll` always fails can have no detection until that suite is fixed.
- **Reach comes from the mark alone.** The transform list never proves a worker loaded the module (Vitest 5 vm pools prewarm), so it only words the reason of a site that did not execute.
- **A reach of "outside the test" counts as executed,** as ADR-0008 counts a site run while its module loads for every test of the file.
- **The run that follows a confirming run counts against it,** since a late unhandled error joins the next run's record. A started run clears the instance's errors, so when the next started run left no record, a late error may be lost with it and the detection reads unclear. A run the guard refused never started and cleared nothing, so the run after it is the one read. Decided by this session at 22:26 after the ticket review; reported to the orchestrator.
- **The judge trusts the names it is given.** With `Error` among them, every throw would read as an assertion. Refusing that name is 3.5's, where the member is read (orchestrator, Q4); nothing in production calls the job before 3.5. Whether the job should also refuse it is put to the orchestrator with the handoff.
- **A baseline's unhandled error counts by the module it names.** One job covers a whole workspace, so on a large one a single late error from one mutation's worker, landing in the restored baseline, would otherwise mark every defect of the workspace invalid. The worker stamps each unhandled error with the test file it was running when the error fired, on both lines. A falsification job runs every test file isolated, so a worker runs one file and the stamp names the file that leaked it. Neither rule credits a detection to an unhandled error. A baseline that did not end cleanly still covers every experiment of the job. This attribution serves the two baselines only: in an experiment's own run, its confirming run and the run that follows, any unhandled error counts.
- **An unhandled error reads unclear beside a failed test and invalid experiment in a baseline.** ADR-0008 words the first and C138 the second.
- **A survivor stays survived beside an unhandled error in its own run,** as ADR-0008 words it: only a failed test reads unclear beside one.
- **The confirming run comes at once,** before the next experiment, so a late unhandled error from the first run lands in the confirming run and the experiment reads unclear.
- **An invalid experiment reports baseline trouble before its own run's facts,** since a baseline that did not pass or did not end cleanly taints all of them.
- **`FALSIFIER_VERSION` rises once, here.** The record gains the confirming run and the judgements, and 3.2b changes what a reach mark means. Two build lanes may not share a production file, and both land before 3.5, the first ticket to run a job that stores evidence, so this ticket owns `falsify/experiment-record.ts` and its one raise covers both.
- **No verdict is not invalid experiment.** Invalid experiment is for what the author can act on. An abort, a run Vitest threw from, or a stale module says nothing about the test. What the defect's stored state then reads is 3.4's and 3.5's to decide.
- **The canaries are data plus plain modules, inside the daemon package.** `canaries.json` is read by this repository's test now and by 3.6 in production, so no export waits for a caller (C59). `packages/daemon/canaries/` sits two levels above both `src/falsify/` and `dist/falsify/`, so one relative URL finds it from source and from a build. Getting it into a published package's `files` is 3.6's. The `*.canary.mjs` name keeps the modules out of this repository's own suite: the root config's projects are `packages/*`, the daemon project sets no `include`, and the canary config sits a level below what that pattern names. Confirm with a run of the daemon project that no canary is collected. Keeping them out of a consumer's suite, whose `include` may be its own, is 3.6's.
- **A confirming run that differs is not a canary.** A test that fails once and then passes needs state that outlives a worker, which the fixture's main-process plugin has and a canary does not. It is proven over the `falsify` fixture.

#### Questions to the orchestrator

Asked at 22:00 on 2026-09-30; decided by the orchestrator at 22:02 and restated at 22:10.

- Q1, an experiment the job did not finish: accepted. No verdict, with the reason; invalid experiment stays for what the author can act on (AC9).
- Q2, "at least one assertion error" or "every error an assertion": accepted. A would-be detection needs at least one error and every error on the intended test an assertion; a mix reads unclear (AC3). ADR-0008's sentence changes to match.
- Q3, how wide a baseline's unhandled error reaches: the recommendation (every experiment of the job) was overruled for its alternative. It counts against the experiments whose test module it names, and against all only when it names none; a baseline that did not end cleanly covers the whole job (AC5, AC6). The orchestrator amends C138 to say invalid or unclear, never detected.
- Q4, the declared assertion error names: accepted. An `assertionErrors` member of `rt-test.json`, exact names, carried by this ticket as a job input (AC2); 3.5 reads and validates the member and refuses `Error`.
- Q5, a snapshot matcher's mismatch: accepted. It reads unclear, a recorded known limit in ADR-0008 pinned by a canary (AC10), with no reading of an error's shape.
- Q6, where the canaries live: accepted. `packages/daemon/canaries/`, plain `.mjs`, `*.canary.mjs` test modules, `canaries.json` as data (AC10).
- Q7, `FALSIFIER_VERSION`: changed. This ticket owns `falsify/experiment-record.ts` and raises the version; 3.2b does not touch that file (AC1).
- Sizing: accepted at 29 estimated.
- Accepted as this session decided them: any module or suite error in the experiment's run reads invalid experiment; the run after a confirming run counts against it; the judgements ride in the reply and reach is read only from the intended test's mark; a skipped intended test reads invalid experiment as baseline did not pass.

Asked at 22:09; decided by the orchestrator at 22:10.

- The order of AC6's reasons, baseline trouble before the experiment's own facts: accepted.
- A survivor stays survived beside an unhandled error in its own run: accepted (AC7).
- The confirming run comes at once after its first run, before the next experiment: accepted (AC4).
- The canary set as AC10 lists it, and a confirming run that differs proven over the existing `falsify` fixture: accepted.

Put to the orchestrator with the handoff at 22:30; each line's assumed answer is what this ticket builds until a ruling says otherwise.

- An assertion failing in a fixture's setup or an `onTestFinished` callback can read detected: assumed a recorded known limit in ADR-0008, since no recorded fact tells it from the body.
- Whether the job itself refuses `Error` among the assertion error names, beside 3.5's reader: assumed no, the reader is the one place.
- A started run that left no record after a confirming run makes that detection read unclear: decided by this session, the safe direction.
- C138's amended wording must allow a detection whose baseline held an unhandled error naming another module, and no verdict for a job cut short, or a review will read AC5 and AC9 as breaking it.

#### Ticket review

One review agent read the ticket and its bound rules at 22:13 and returned 33 findings; 29 changed the ticket. Not applied as worded: the reply mapping (F4), since `Executor.falsify` returns the job whole; the interrupted-baseline edit (F9), settled by the criteria's preface instead, since a run the job's abort interrupted leaves no record; the Vitest 5 error names (F20), read in installed source instead of left as an assumption; and the sizing recount (F16), where the list was completed to match the count. Four findings were questions for the orchestrator, listed above.

#### Doc text reported at authoring

Sent to the orchestrator with the handoff, for files this lane does not edit: ADR-0008's decision paragraph (every error an assertion, the confirming run at once and the run after it, a baseline's unhandled error by module, no verdict for a job cut short) and its known limits (a snapshot matcher's mismatch, an `expect.soft` failure followed by a throw, an `it.fails` test, a baseline that passed only on a retry, a detection before an experiment that leaks, a module holding a failing `beforeAll`, an assertion in a fixture's setup); the `assertionErrors` member in ADR-0008's facts paragraph; the glossary's Unclear experiment; a sentence each for § Ticket 3.4, § Ticket 3.5 and § Ticket 3.6; the README line 3.5 owes; and the ticket file link under § Ticket 3.3.

#### Known limits (each entry says what it reads)

- A test whose only failing assertion is a snapshot matcher reads unclear, and so does an `expect.assertions` count failure and a Testing Library query error whose name is not declared.
- A defect on an `it.fails` test reads unclear: its mutation makes the body pass, which Vitest reports as a failure with a plain `Error`.
- An assertion that fails in a `test.extend` fixture's setup or in an `onTestFinished` callback has no hook state, since Vitest records one only for `beforeEach`, `afterEach`, `beforeAll` and `afterAll` (`updateSuiteHookState`'s callers, both lines). It reads as a body failure and can read detected, in the intended test, after the site executed and confirmed. No recorded fact tells it from the body. Put to the orchestrator with the handoff as a known limit for ADR-0008; this ticket adds no fact for it.
- A baseline that passed only on a retry reads as a pass. A reach mark carries across a test's retries, so a retried test can read as having executed the site on an attempt other than the one that failed (3.2's review).
- When the experiment that runs next leaks an unhandled error of its own, the detection before it reads unclear. Defects of one module usually run next to each other.
- An unhandled error in a baseline reads invalid experiment for every experiment whose test is in the module it names, and for every experiment of the job when it names no module the job can match.
- A module holding a suite whose `beforeAll` always fails has no detection.
- A test that executes the mutated site and fails an assertion by chance in both its run and its confirming run reads detected (ADR-0008).

#### Pending siblings

- 3.2b (backlog, being authored) reworks probe placement in `packages/daemon/src/falsify/reach-probe.ts` and `probe-slots.ts`, which this ticket does not edit. It leaves `falsify/experiment-record.ts` alone and does not change the record's shape; this ticket's raise of `FALSIFIER_VERSION` covers it. This ticket reads reach as the record gives it, so a pure deletion's probe on an ancestor is 3.2b's to fix. The two share no production file and build side by side. Both append records to `packages/daemon/test/falsify/defects.json` and may add tests to `falsify-workspace.test.ts`; the second to land merges main in and proves the shared files' records.
- 3.4 (backlog) stores each judgement with its facts, strips source text from whatever messages it stores, and extends and moves `DEFECT_STATE`. It reads this ticket's verdict and reason constants.
- 3.5 (backlog) builds the job's request, reads and validates the `assertionErrors` member of `rt-test.json` for it, and stores nothing for an experiment with no verdict or whose inputs moved.
- 3.6 (backlog) bundles `packages/daemon/canaries/`, runs it under the consumer's Vitest from the state directory, and compares each reading with `canaries.json`.
- 3.7 (backlog) replays the milestone's acceptance over its own corpus.

#### Current structure of the modified files

- `packages/daemon/src/falsify/falsify-workspace.ts` (about 417 of the cap's code lines, by `grep -v` of blank and comment lines): `falsifyWorkspace(workspace, confirmedConfigFile, experiments, signal)` queues the job and returns the `FalsificationJob`, spreading the session's result after `inWorkspaceSession` has closed the instance. `FalsificationRuns.all` plans, runs the baseline, calls `#experimentsAfter`, then the restored baseline when any experiment ran. `#experimentAfter` is the baseline gate and calls `experiment(plan)`, which calls `#run([specification], mutation)` and maps its step to an `ExperimentRecord`. `#run` freshens the guard, returns interrupted when the signal is aborted, activates the mutation, runs, deactivates and calls `recordRun`.
- `packages/daemon/src/falsify/experiment-record.ts` (about 351 code lines): the record types, `FALSIFIER_VERSION = 1`, `recordRun`, `testResultIn`, and the JSON-safe error copying. `recordRun` receives the run's specifications and their locator, and copies each unhandled error with every field Vitest serialized. `ExperimentRecord` is `{ defectId, status: "ran", run, mutation }` or `{ defectId, status: "not-run", reason }`; `JobRuns` holds `interrupted`, `baseline?`, `experiments` and `restoredBaseline?`; a loaded job adds `falsifierVersion`, `unhandledErrors` (the host thread's, as text), `vitestVersion` and `closeError?`.
- `packages/daemon/src/daemon/executor-jobs.ts`: the `falsify` request is `{ type, workspace, configFile, experiments }`.
- `packages/daemon/src/daemon/executor.ts`: `Executor.falsify(workspace, configFile, experiments)` sends that request and maps the reply.
- `packages/daemon/src/daemon/executor-main.ts`: `falsify(request, signal)` imports `falsify-workspace.js` lazily and passes the request's three fields and the signal.

A search of `packages/**/*.ts` for `falsifyWorkspace(`, `.falsify(`, `FalsificationJob`, `ExperimentRecord`, `JobRuns`, `DefectExperiment`, `FALSIFIER_VERSION` and `testResultIn` (22:04) finds them only in the files above and the two test files below. Nothing in the daemon's store, queries or CLI reads the record yet. A defect record's `new` text that calls a changed signature is a consumer too (C38): the same search over every tracked `defects.json`, for `falsifyWorkspace(`, `.falsify(`, `experiment(` and `testResultIn(`, found none (22:25). `Executor.falsify` returns the `falsified` reply's job whole, so nothing picks fields off it. The host thread's rejections join the job's `unhandledErrors`, and `closeError` is set, only after the session's step has returned (`withHostRejections` and `openAndClose` in `packages/daemon/src/vitest/workspace-session.ts`), so the judgements are decided in `falsifyWorkspace`, after `inWorkspaceSession` returns.

#### Tests this change may break

- `packages/daemon/test/falsify/falsify-executor.test.ts` calls `executor.falsify(` with three arguments and reads `job.restoredBaseline`.
- `packages/daemon/test/falsify/falsify-workspace.test.ts` calls `falsifyWorkspace(` in three places and reads the job through helpers (`experimentOf`, `experimentRun`, `baselineRun`, `restoredRun`) by field, so added fields break none of them. Its fixture hook edits a file at the math module's first mutated transform; a confirming run adds mutated transforms after that one. Any assertion over the whole sequence of run events, or over how many runs a job made, changes once a would-be detection runs twice.
- Defect records anchored in the modified files, counted with `grep -c` on each `"file"` path across `packages/daemon/test/defects.json` and `packages/daemon/test/*/defects.json` (21:57): 9 in `falsify/falsify-workspace.ts`, 11 in `falsify/experiment-record.ts`, 41 in `daemon/executor.ts`, 12 in `daemon/executor-main.ts` and 1 in `daemon/executor-jobs.ts`. Edit around their anchored text, and list any record whose anchor an edit breaks under the Dev Handoff for create-tests.
- The `falsify` fixture already holds a case for most verdicts: `math` an in-test site with a chai failure and an always-failing extended matcher beside it, `loaded` a load-time site, `suite` failing `beforeAll` suites, a throwing `afterEach` and a leaked rejection in one module, `concurrent` two concurrent tests.

#### Sizing

About 22 raw files and 29 estimated (22 times 1.3 is 28.6); code units 11 (10 criteria plus validation). The raw count is this ticket's file; the modified production files above; under `packages/daemon/src/falsify/`, the run facts, the judge, and one module split from `falsify-workspace.ts` if the confirming run needs the room; the canary set, about six files (a config, `canaries.json`, source modules and canary modules); and, for create-tests, a judge test over hand-built facts, a canary test that runs one job per Vitest line, `falsify-workspace.test.ts` and `falsify-executor.test.ts` modified, `packages/daemon/test/falsify/defects.json`, and two `falsify` fixture files for a confirming run that differs (its config's plugin and a test module). Over 25 estimated and within 30: a split would cut the verdict rules from the canaries that prove each reading on both Vitest lines, which is NFR7's "across the canary fixtures". Over 10 estimated, so dev delegates in three groups: the named modules of each unhandled error and the version raise in `experiment-record.ts`, then the facts and the judge, which read that field and otherwise touch only new files; the confirming run, the reply and the names through the executor, which depend on the judge's types; and the canary set, whose files are its own and whose readings need both.

#### Glossary terms, verbatim

- **Experiment**: One run of a defect's test with its mutation applied, inside a falsification job.
- **Baseline**: The unmutated run of a falsification job's tests before its experiments; the restored baseline repeats it after them.
- **Invalid experiment**: An experiment whose run cannot say whether the test rejects the mutation, such as one whose test failed in a hook or never executed the mutated site.
- **Unclear experiment**: An experiment whose test failed in its own body but not at an assertion, or failed at an assertion and then passed its confirming run.
- **Confirming run**: A second run of an experiment that would be a detection, which must fail the same way before the detection counts.
- **Reach probe**: The recorder call a mutation's transform places at the mutated site, so an experiment records which tests executed the mutated code.
- **Canary fixture**: A test that fails on purpose in one known way, so RT Test can check that it reads that failure's facts correctly on a Vitest version.
- **Run facts**: What the daemon records during a falsification run: failure phase, error kind, whether the mutated code was reached, and the baseline result.
- **Survivor**: A mutation its intended test did not reject.

#### Previous-ticket intel

3.2 (done, merged at 57e56d28) built the job and the raw record this ticket judges. From its Tests Record and Review Record: a hook that threw stays `run`; an unhandled error a stopping worker reports late appears in the next run's record; the record carries no retry facts; `experiment()` has no baseline gate of its own; a job's `status: "ran"` means its workspace loaded and its experiments were planned, also when no run happened; the run an abort interrupted leaves no record. 3.2b, the nearest earlier ticket in the status file, is still backlog. Since the merge, no commit on main touches `packages/daemon/src/falsify/` or the executor files: `git log --oneline 57e56d28..HEAD -- packages/daemon/src/falsify packages/daemon/src/daemon` printed nothing at f05d30e6 (22:25).

### References

- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.3 and its objective.
- `_agent-docs/tickets/3-2-transform-experiments.md`: the record's shape, the reach values, the not-run reasons, and its Review Record.
- ADR-0003, ADR-0007, ADR-0008, ADR-0009.
- `docs/requirements.md`: FR10, FR11, NFR6, NFR7.
- `docs/architecture.md` § Falsification jobs; § Execution and falsification isolation; § State dimensions.
- `docs/testing.md` § Falsification jobs, mutation transforms and reach.
- GitHub issues: `node scripts/list-open-issues.mjs` printed "0 open issues, complete" on 2026-09-30 at 21:46.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C10,C12,C13,C14,C19,C30,C32,C38,C40,C45,C48,C51,C59,C160,C119,C125,C131,C132,C134,C135,C137,C138,C142,C147 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P16,P17,P18,P19,P21,P35,P36,P37,P39 -->

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
sizing_ac_count: 11
files_to_modify:
  - packages/daemon/src/falsify/falsify-workspace.ts
  - packages/daemon/src/falsify/experiment-record.ts
  - packages/daemon/src/daemon/executor-jobs.ts
  - packages/daemon/src/daemon/executor.ts
  - packages/daemon/src/daemon/executor-main.ts
files_to_create:
  - packages/daemon/src/falsify/run-facts.ts
  - packages/daemon/src/falsify/verdict.ts
  - packages/daemon/canaries/vitest.config.mjs
  - packages/daemon/canaries/canaries.json
  - packages/daemon/canaries/src/subject.mjs
  - packages/daemon/canaries/src/loaded.mjs
  - packages/daemon/canaries/body.canary.mjs
  - packages/daemon/canaries/hooks.canary.mjs
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

- `_agent-docs/tickets/3-3-verdicts-from-facts.md` (created by create-ticket)

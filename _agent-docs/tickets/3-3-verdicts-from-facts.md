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

- [x] AC1: For every experiment of a job that read `ran`, the job's reply carries one judgement: a verdict (detected, survived, invalid experiment or unclear) or no verdict; for every judgement but detected and survived, its one reason as a value from a closed set, never a sentence; and the facts it rests on. Each condition that AC6, AC8 and AC9 list between semicolons is one reason of that set, and what a parenthesis adds travels with the reason as detail. The facts are read from the intended test in the experiment's run, in its confirming run when one ran, and in both baselines: its state and mode; the repeats Vitest was told to give it, by its own options, a suite's or the project's, when it has any; each of its errors as a kind, with the name Vitest serialized; its hook states; and its reach. For each of those runs they give, of the intended test's module alone, whether it was collected (collected, not collected with the state the record gives, or missing), its count of module errors, and each of its failing suites by name path with its error count; and, of the run as a whole, the count of unhandled errors (for a baseline, of those that count against the experiment, and how many of those named no test module) and how the run ended. They also give what the mutation's transforms did in its run and in its confirming run, and, only for an experiment whose confirming run left a record, whether the run the job started next left a record, with its count of unhandled errors. A fact Vitest did not record is absent, never zero, empty or false. The facts hold no error message, stack or source text, and every judgement is decided from them alone. A job that did not read `ran` carries no judgement. The reply's falsifier version is higher than the one ticket 3.2 built, since what a record means has changed. (FR11, NFR6)
- [x] AC2: An error is an assertion when Vitest serialized it with the name `AssertionError`, or with the `JestExtendError` constructor marker and an assertion name, or when its name is exactly one of the assertion error names the job was given. Every other error is another kind: a `TypeError`, a timeout, an `expect.assertions` count failure and a snapshot matcher's mismatch among them. The names reach the judge as an input of the job: an argument of `Executor.falsify`, a field of the `falsify` request, and a parameter of `falsifyWorkspace`. With no names given, only the first two forms are assertions. (FR11)
- [x] AC3: A run of an experiment is a would-be detection when, in that run, all of these hold: the run ended cleanly and recorded no module error, no suite error and no unhandled error; the intended test ran and failed; it holds a `beforeEach` state, and every hook state Vitest recorded on it is `pass` (a state of `run` on the finished test is a hook that did not end in pass, and a test with no `beforeEach` state is one whose hook states were not recorded, since the reach setup file's own hook gives every test that ran one); it declares no repeats, its own, a suite's or the project's (a repeated test stays failed once any repeat failed and keeps that repeat's errors, while the hook states it holds are its last repeat's alone, so an assertion that failed in a hook on an earlier repeat would read as the body's); it holds at least one error, and every error it holds is an assertion; and its reach reads executed, in the test or outside it. (FR11, NFR7)
- [x] AC4: An experiment whose run is a would-be detection runs once more, at once, as a confirming run: in the same instance, over the same specification, with its own mutation alone, behind the same stale-transform guard and abort check as its first run, before any other experiment and before the restored baseline. No other experiment runs twice, and no experiment runs a third time. Since only an experiment the baseline passed has a first run, no confirming run happens for a test the baseline did not pass. An abort during a confirming run ends the job there, as an abort during any run does. (FR10, FR11)
- [x] AC5: An experiment reads detected only when all of these hold: the baseline and the restored baseline each passed the intended test, ended cleanly and recorded no unhandled error that counts against the experiment; its run and its confirming run are each a would-be detection; the run the job started next after its confirming run left a record that holds no unhandled error; and the job's own process recorded no unhandled error and closed the instance without error. Nothing else reads detected. (FR11, NFR7)
- [x] AC6: An experiment reads invalid experiment, with the first reason that holds, in this order: its change has no probe site (the record's position travels with the reason); no test module of the workspace holds the test; the baseline did not pass the test (with the state the baseline gave it, or that it did not report it, and the test's mode, so a test declared with `it.skip` or `it.todo` reads as one); the baseline did not end cleanly, or recorded an unhandled error that counts against the experiment; the restored baseline did not pass the test; the restored baseline did not end cleanly, or recorded an unhandled error that counts against the experiment; the experiment's run did not end cleanly; its module recorded a module error, was not collected or is missing; a suite of its module recorded an error (naming the suite); the intended test did not run (it is absent from the run, skipped or pending); a hook did not end in pass, or the test holds no `beforeEach` state (naming the hook, and whether its state was `run` or not recorded); the intended test failed and declares repeats (naming how many); its reach reads not executed, neither in the test nor outside it; or its reach is unknown (with the record's reason). Reach is read only from the intended test's reach mark. What the mutation's transforms did only words the reason of a site that did not execute (the mutated module was never transformed, or `old` occurred other than once in the text transformed, naming the count), and never stands in for a mark. (FR11, NFR7)
- [x] AC7: An experiment reads survived when no reason of AC6 holds and the intended test passed, so the mutated site executed, in the test or outside it, and the test did not reject the mutation. A survivor stays survived beside an unhandled error in its own run. (FR11)
- [x] AC8: An experiment reads unclear when no reason of AC6 holds, the intended test failed, and one of these holds, the first in this order giving the reason: the test holds no error or an error that is not an assertion; its run recorded an unhandled error; its run was a would-be detection and its confirming run was not (naming what the confirming run alone would have read); the run the job started next after its confirming run recorded an unhandled error or left no record; or the job's own process recorded an unhandled error or failed to close the instance. (FR11, NFR7)
- [x] AC9: An experiment has no verdict, with its reason, when the job did not finish its runs or the job's own check before any run decided it: its record reads interrupted; its mutation's file could not be read; `old` did not occur exactly once in that file when the job started (the count travels with the reason); the baseline left no record; its run left no record; its confirming run left no record or was interrupted; or the restored baseline is absent or left no record. Whether an experiment has a verdict is decided before which verdict it has, except that the reasons of AC6 a job decides without a run of the experiment (no probe site, no module, baseline did not pass) hold whether or not a restored baseline ran. Every experiment a job that read `ran` was given reads exactly one judgement. (FR11)
- [x] AC10: `packages/daemon/canaries/` holds RT Test's canary fixtures: a Vitest project of plain `.mjs` files that import no package but `vitest`, whose test modules this repository's own suite does not collect, and `canaries.json`, which names for each canary its intended test, its mutation and the one judgement (the verdict, and the reason where the verdict has one) it must read, and for the set the assertion error names its job is given. Every canary's test passes unmutated. A falsification job over the set, on Vitest 4.1.x and on 5.x, reads for each canary exactly the judgement the file names. The set holds a canary for each of these. Detected: an `expect` failure in the test body; a failing matcher added by `expect.extend`; an error whose name the set declares; an assertion after a site that executes while its module loads. Survived: a test that passes after executing the site. Invalid experiment: an assertion that fails in a `beforeEach`; an `afterEach` that throws; a test given repeats whose setup assertion fails on an earlier repeat alone; a `beforeAll` that throws; a mutated module that throws while it loads; a mutation that does not parse, which reads as a change with no probe site, decided before any run; a test that passes without executing the site; a test that fails an assertion without executing the site; a mutated module the test never loads; a site executed while tests run concurrently. Unclear: a `TypeError` thrown in the body; a test that times out; an `expect.assertions` count failure; a snapshot matcher's mismatch; a thrown error of a name the set does not declare; an assertion failure beside an unhandled rejection; an assertion error beside an error of another kind. (FR11, NFR7)

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

### Resolutions

Settled by the dev session on 2026-09-30 between 22:43 and 22:47, by running the canary set through `falsifyWorkspace` as 3.2 built it (a scratch driver over the built daemon, each run through the run lease), on Vitest 4.1.11 and 5.0.1, on Windows 11 and on Linux (WSL, a clone at 799c43e8), Node 24.19 on both. The four readings of every canary were identical.

- U1, CONFIRMED as a module error: the mutated module's throw leaves the test module collected, in state `failed`, holding one module error (name `Error`, constructor `Function<Error>`), no suite error and no test, so the intended test is absent. AC6 reads it by its module reason, which comes before the did-not-run reason. Each transform of the mutated module was applied with its probe placed.
- U2, CONFIRMED: the timed-out test reads `failed`, hook states `{ beforeEach: "pass" }`, reach executed in the test, with one error named `Error` and constructor `Function<Error>`. It reads unclear by AC8's first reason.
- U3, CONFIRMED: the inline snapshot canary's test reads `failed` with one error named `Error`, constructor `Function<Error>` and no assertion marker, reach executed in the test, and both canary modules' bytes were unchanged after the job.
- U4, CONFIRMED: the test's result holds both errors in order, an `AssertionError` from `expect.soft` and then a `TypeError` with constructor `Function<TypeError>`.
- U5, CONFIRMED as informational: under `pool: "vmThreads"` on 5.0.1, an experiment whose test never imports the mutated module left an empty transform list and a reach of not executed, and one whose test loads the module without calling the site left one applied transform with its probe placed and a reach of not executed. `prewarmModuleGraph` (5.0.1 `dist/chunks/index.DzobfTyw.js`) walks only the test file's static imports, skipping a dynamic-only import and a module an inline `vi.mock` factory replaces, so the list never proves a worker ran the site. AC6's wording stands: the list only words the reason.
- U6, CONFIRMED: a rejection leaked from one of two test modules in a run carried a `VITEST_TEST_PATH` equal, character for character, to that specification's `moduleId`, through the real root and through a linked root (both spell the resolved path), with `/` separators and the drive letter's case on Windows. `VITEST_TEST_NAME` was absent. `moduleFileKey` matched the same one specification in all eight runs.
- U7, CONFIRMED: in ten jobs on each line on Windows and ten on each line on Linux, the leaked rejection was in its own run's record every time, and never in the next experiment's run, the restored baseline or the job's own unhandled errors.
- U8, CONFIRMED: with the concurrent pair in `hooks.canary.mjs`, the module's sequential canaries read a known reach (executed in the test for the `beforeEach` and `afterEach` canaries, executed outside the test for the load-time site), and the concurrent canary reads unknown, unattributed. The pair needs no module of its own.

Also observed in the same runs:

- Every intended test that ran holds a `beforeEach` state on every line and platform: `pass`, or `run` for the canary whose `beforeEach` assertion fails. The `afterEach` canary reads `{ beforeEach: "pass", afterEach: "run" }`. The `beforeAll` canary's test reads `skipped` with no hook state and a reach of unknown, not observed, and its suite holds one error, so AC6 reads it by its suite reason.
- A chai `AssertionError` crosses as a plain object with no `constructor` field of its own, so reading `error.constructor` on it finds the inherited `Object` function. The facts read an error's fields as own properties and accept only a string.
- An `expect.extend` failure is named `Error`, with constructor `Function<JestExtendError>` and `__vitest_error_context__.assertionName` holding the matcher's name. An error class that sets `this.name` crosses with that name.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing. Write each answer, with its observed output, under the table.
- [x] (AC1, AC2) Create the run facts: from one run's record, a test identity and the assertion error names, the intended test's state, mode, hook states and reach, each of its errors as a kind with its serialized name and the marker that made it an assertion; of the intended test's module alone, whether it was collected, not collected (with the state the record gives) or missing, its module error count, and each of its failing suites' name path and error count; and of the whole run, the unhandled error count and how the run ended. Read error fields off `RawError` by name with the JSON guards, never by matching a message. The facts hold no message, stack or source text. Beside the per-run facts, an experiment's facts give what its mutation's transforms did in its run and in its confirming run, and, only for an experiment whose confirming run left a record, whether the run the job started next left a record, with its unhandled error count. A run that left no record gives no facts, and a fact Vitest did not record is absent, never zero, empty or false (C12).
- [x] (AC1, AC5, AC6) Record, for each unhandled error of a run, the test modules of that run it names: resolve the path the worker stamped on it (`VITEST_TEST_PATH`) against the run's specifications where `recordRun` holds them, comparing files as the stale-transform guard does (`moduleFileKey`). Record every specification whose file matches, since one file can run under several projects, and record none when no specification matches. A baseline's unhandled error then counts against an experiment whose intended test is in a named module, and against every experiment when it names none.
- [x] (AC1) Raise `FALSIFIER_VERSION` in `falsify/experiment-record.ts` by one, once, for this ticket and for 3.2b, which leaves that file alone.
- [x] (AC3, AC5, AC6, AC7, AC8, AC9) Create the judge as a pure module with no Vitest, executor or file dependency: one predicate for a would-be detection, used for the first run and the confirming run alike (C8), and one function that gives an experiment its one judgement from run facts alone: those of its run, its confirming run, both baselines and the run the job started next, what its transforms did, its not-run reason when it has one, the job's own unhandled error count and whether the instance closed. Neither takes a raw record or a `RawError`, so no message is in the judge's reach (AC1); the assertion error names go to the run facts, which give each error its kind. Check AC9's reasons first, except that its restored-baseline reason does not outrank the reasons of AC6 a job decides without a run of the experiment (no probe site, no module, baseline did not pass); then AC6's in its order, then AC7, AC8 in its order, and AC5 last. Spell each verdict and each reason as a named constant in kebab-case, as `DEFECT_STATE` spells states.
- [x] (AC4) Add the confirming run to the job: after an experiment's run that the judge reads as a would-be detection, run it once more through the same gated path and the same run step, and keep the confirming run's record and its transform list beside the first run's. Reach the confirming run only from the path the baseline gate guards, so `experiment()` gains no caller that skips the gate. Keep `falsify/falsify-workspace.ts` under the line cap (P16), extracting by responsibility if the change needs the room.
- [x] (AC2) Carry the assertion error names through the job: a parameter of `Executor.falsify`, a field of the `falsify` request in `executor-jobs.ts`, the call in `executor-main.ts`, and a parameter of `falsifyWorkspace`. Edit around the anchored text of the defect records those files hold.
- [x] (AC1, AC9) Put each experiment's judgement and facts on the job's reply, decided once the instance has closed, so the close error and the job's own unhandled errors are in hand. A job that did not read `ran` carries none. The run that follows an experiment is the next run the job started: another experiment's first run, or the restored baseline. A run the stale-transform guard refused never started and is passed over; a started run that left no record is not, and the detection before it reads unclear (AC8).
- [x] (AC10) Create the canary set under `packages/daemon/canaries/`: a config that includes only its `*.canary.mjs` modules, source modules whose one-line mutations each switch on one failure, the canary modules, and `canaries.json`. Assert in hooks with `assert` from `vitest`, since lint refuses an `expect` outside a test. Order the canaries so the one that leaks an unhandled rejection is followed by a canary that need not read detected, and is never the last before the restored baseline.
- [x] (Support) Report to the orchestrator the `docs/architecture.md` text for § Falsification jobs (the confirming run, the judgement and facts on the reply, the canary directory) and for § Execution and falsification isolation, and each known limit the build confirms or adds; write none of it yourself. The ADR-0008, glossary, sprint and README text the rulings changed went to the orchestrator with this ticket (Dev Notes § Doc text reported at authoring); report only what the build makes differ from it.
- [x] (Support) Lint and typecheck.

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
- `RecordedRunTest.repeats`: present on a failed intended test, it reads invalid experiment by AC6's repeated-test reason; on a passed one it changes nothing, since a repeated test passes only when every repeat passed. Absent means Vitest runs the test once.
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
- **The judge trusts the names it is given.** With `Error` among them, every throw would read as an assertion. Refusing that name is 3.5's, where the member is read (orchestrator, Q4); nothing in production calls the job before 3.5. The job does not refuse it a second time (orchestrator, 22:34).
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

Asked with the handoff at 22:31; decided by the orchestrator at 22:34.

- An assertion failing in a fixture's setup or an `onTestFinished` callback can read detected: accepted as a recorded known limit, written into ADR-0008.
- Whether the job itself refuses `Error` among the assertion error names: accepted, no second refusal; 3.5's reader is the one place.
- A detection reads unclear when the run started next after its confirming run left no record, and a run the guard refused is passed over: accepted (AC5, AC8).
- C138 now says an unhandled error makes an experiment invalid or unclear, never detected; that a baseline's unhandled error naming a test module counts against that module's experiments alone; and that an experiment whose job never finished its runs gets no verdict. AC5 and AC9 follow it.

#### Sanity check

From the dev session (threadId 587300be-5553-4116-abe2-dcffc3b4dd04) at 22:39; answered by this session at 22:40. All five findings confirmed.

- F1: the facts carry whether the intended test's module was collected, since AC6's module reason is read from it (AC1, the run facts task).
- F2: the module error count and the failing suites are those of the intended test's module, in every run; the unhandled error count and how the run ended stay run-wide (AC1, the run facts task).
- F3: a would-be detection needs a `beforeEach` state on the intended test, and a test that ran with none reads invalid experiment by AC6's hook reason (AC3, AC6). ADR-0008 names the hazard: "a release that stopped recording hook states would credit an `expect` failing in a `beforeEach` as a detection." The reach setup file's own hook gives every test that ran a state, so no real consumer pays for the check. Decided by this session in the safe direction; accepted by the orchestrator at 22:42.
- F4: the fact about the run the job started next is present only for an experiment whose confirming run left a record (AC1, the run facts task).
- F5: dev builds the ticket alone as one chain, since its groups depend on each other (Sizing).

#### Ticket review

One review agent read the ticket and its bound rules at 22:13 and returned 33 findings; 29 changed the ticket. Not applied as worded: the reply mapping (F4), since `Executor.falsify` returns the job whole; the interrupted-baseline edit (F9), settled by the criteria's preface instead, since a run the job's abort interrupted leaves no record; the Vitest 5 error names (F20), read in installed source instead of left as an assumption; and the sizing recount (F16), where the list was completed to match the count. Four findings were questions for the orchestrator, listed above.

#### Doc text reported at authoring

Sent to the orchestrator with the handoff, for files this lane does not edit: ADR-0008's decision paragraph (every error an assertion, the confirming run at once and the run after it, a baseline's unhandled error by module, no verdict for a job cut short) and its known limits (a snapshot matcher's mismatch, an `expect.soft` failure followed by a throw, an `it.fails` test, a baseline that passed only on a retry, a detection before an experiment that leaks, a module holding a failing `beforeAll`, an assertion in a fixture's setup); the `assertionErrors` member in ADR-0008's facts paragraph; the glossary's Unclear experiment; a sentence each for § Ticket 3.4, § Ticket 3.5 and § Ticket 3.6; the README line 3.5 owes; and the ticket file link under § Ticket 3.3.

#### Known limits (each entry says what it reads)

- A test whose only failing assertion is a snapshot matcher reads unclear, and so does an `expect.assertions` count failure and a Testing Library query error whose name is not declared.
- A defect on an `it.fails` test reads unclear: its mutation makes the body pass, which Vitest reports as a failure with a plain `Error`.
- An assertion that fails in a `test.extend` fixture's setup or in an `onTestFinished` callback has no hook state, since Vitest records one only for `beforeEach`, `afterEach`, `beforeAll` and `afterAll` (`updateSuiteHookState`'s callers, both lines). It reads as a body failure and can read detected, in the intended test, after the site executed and confirmed. No recorded fact tells it from the body. A recorded known limit in ADR-0008 (orchestrator, 22:34); this ticket adds no fact for it.
- A baseline that passed only on a retry reads as a pass. A reach mark carries across a test's retries, so a retried test can read as having executed the site on an attempt other than the one that failed (3.2's review).
- When the experiment that runs next leaks an unhandled error of its own, the detection before it reads unclear. Defects of one module usually run next to each other.
- An unhandled error in a baseline reads invalid experiment for every experiment whose test is in the module it names, and for every experiment of the job when it names no module the job can match.
- A module holding a suite whose `beforeAll` always fails has no detection.
- A test that executes the mutated site and fails an assertion by chance in both its run and its confirming run reads detected (ADR-0008).
- A defect on a test that declares repeats, its own, a suite's or the project's, can read survived but never detected: a failed repeated test reads invalid experiment (review, orchestrator ruling of 00:34 on 2026-10-01).

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

About 22 raw files and 29 estimated (22 times 1.3 is 28.6); code units 11 (10 criteria plus validation). The raw count is this ticket's file; the modified production files above; under `packages/daemon/src/falsify/`, the run facts, the judge, and one module split from `falsify-workspace.ts` if the confirming run needs the room; the canary set, about six files (a config, `canaries.json`, source modules and canary modules); and, for create-tests, a judge test over hand-built facts, a canary test that runs one job per Vitest line, `falsify-workspace.test.ts` and `falsify-executor.test.ts` modified, `packages/daemon/test/falsify/defects.json`, and two `falsify` fixture files for a confirming run that differs (its config's plugin and a test module). Over 25 estimated and within 30: a split would cut the verdict rules from the canaries that prove each reading on both Vitest lines, which is NFR7's "across the canary fixtures". The work is one dependency chain, so dev builds it alone, in this order: the named modules of each unhandled error and the version raise in `experiment-record.ts`; the facts and the judge, which read that field and otherwise touch only new files; the confirming run, the reply and the names through the executor, which depend on the judge's types; and the canary set, whose readings need all of it.

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

Dev session: threadId 587300be-5553-4116-abe2-dcffc3b4dd04

#### Test Files This Change Broke

- `packages/daemon/test/falsify/falsify-executor.test.ts`: `executor.falsify(` takes a fourth argument, the assertion error names (tsc: expected 4 arguments, at its one call).
- `packages/daemon/test/falsify/falsify-workspace.test.ts`: `falsifyWorkspace(` takes the assertion error names as its fourth argument, before the signal (tsc: expected 5 arguments, at its three calls). At run time, every experiment of the `falsify` fixture whose run is a would-be detection now runs twice (the `add` experiment first of all), so any assertion over the sequence or count of run events or of mutated transforms moves; a job's `falsifierVersion` reads 2; a run record gains `unhandledErrorModules`; a detection's experiment record gains `confirming`; a job that ran gains `judgements`; and a run now checks the abort before it asks the stale-transform guard.

No defect record's anchor moved: `node scripts/check-defects.mjs` exits 0 over all 3,064 records on the final tree (23:28), and no record's `new` text calls a changed signature (`PASSED` and `NOT_REPORTED`, which D3642 names, are both still in scope in `falsify-workspace.ts`).

#### ACs Owed a Test

- AC4: "An abort during a confirming run ends the job there." Its other outcomes were observed (see Completion Notes); this one is traced in code only (`wasInterrupted` reads a confirming run's `interrupted` status, and `#experimentsAfter` then gives every later experiment no run), since no scratch run can land an abort inside a confirming run. The `falsify` fixture's `RUN_HOOK` events can.

#### Tests Owed

Each names the guarantee and the defect a test would catch. Scratch evidence for most is under Completion Notes; none of it is a committed test.

- The canary test (AC10): one job per Vitest line over `packages/daemon/canaries/`, each canary reading exactly the judgement `canaries.json` names. The set holds 22 canaries, one more than AC10 lists: `returned-cleanup-assertion` pins a known limit and reads detected (orchestrator, 23:23).
- The judge over hand-built facts (AC3, AC5 to AC9): the order of reasons above all. Defects worth naming: a survivor read before a failed hook; an unhandled error in a baseline counted whatever module it names; the next-run check skipped; a non-assertion error read after the run's unhandled error.
- A confirming run that differs reads unclear, naming what the confirming run alone read (AC8), over the `falsify` fixture as the ticket plans.
- The assertion error names reach the judge through `Executor.falsify` and the `falsify` request (AC2): traced only, three lines. Defect: the executor process drops the names, so a declared error reads unclear.
- A job that did not read `ran` carries no judgement (AC1): traced only (`judgedJob` returns a refused job as it is).
- `unhandledErrorModules`: a rejection leaked from one of two modules names that module alone; one file run under two projects names both; an error with no stamp names none. Defect: every baseline error counted against every experiment.
- The pairing guard in `experimentFacts`: records that do not pair one for one with the experiments make the job fail rather than judge a record against another experiment's test.
- The abort is read before the stale-transform guard in `#run`: an abort that came first reads interrupted even when a module is stale.
- The facts hold no message: a job's judgements, serialized, hold no error message, stack or source text (AC1).

### Tests Record

Tests session: threadId a23af9e8-d0c2-44d4-8f5e-0841941dfc71

Written by the tests session on 2026-09-30 and 2026-10-01, in Tree 1 on `wt/1` at fea8b888. The suite scoped to the build's nine production files (`bun x vitest related`, 23 of 82 test files) held 35 reds in the two test files the handoff named, every one stale: the call sites that lost the assertion error names. No red was a code bug and none was pre-existing. Every expected value below was written from the criteria before its test first ran, and each test passed against the build unchanged, so no suspected defect went to the dev session.

#### Named Defects

`packages/daemon/test/falsify/verdict.test.ts` (new), the judge over hand-built facts and the facts over hand-built job records, with no Vitest load:

- D3750: A baseline's unhandled error that counts against the experiment is not read, so a detection stands though the baseline its test passed in leaked an error. (AC5, AC6)
- D3751: How a baseline ended is not read, so a detection stands on a baseline whose workers were force-stopped. (AC5, AC6)
- D3752: The judge does not read whether the baseline passed the test, so an experiment that ran against a test the baseline failed is credited as a detection. (AC5, AC6)
- D3753: The baseline-not-passed reason carries the test's state without its mode, so a test declared with `it.skip` cannot be told from one skipped at run time. (AC6)
- D3754: The restored baseline's result for the test is not read, so a detection stands though the test no longer passes unmutated. (AC5, AC6)
- D3755: The restored baseline's unhandled errors and ending are not read, so a detection stands though the restored baseline leaked an error that counts against it. (AC5, AC6)
- D3756: A restored baseline that started and left no record is read as one that failed the test, so an experiment its job did not finish reads invalid experiment where it has no verdict. (AC9)
- D3757: A confirming run that left no record is passed over and the first run judged in its place, so a would-be detection that never repeated gets a verdict. (AC9)
- D3758: How an experiment's run ended is not read, so a run that was interrupted, force-stopped or failed to cancel is judged as a whole run. (AC3, AC6)
- D3759: A test with no recorded `beforeEach` state reads as one whose hooks all passed, so a Vitest that stopped recording hook states would credit a failure in a `beforeEach` as a detection. (AC3, AC6)
- D3760: A passed test reads survived before its hook states are read, so a test whose hook states were not recorded reads as a survivor. (AC6, AC7)
- D3761: A failed test that holds no error counts as holding only assertion errors, so a failure with no assertion behind it is a would-be detection. (AC3, AC8)
- D3762: A passed test beside an unhandled error in its own run is not read as a survivor, so a mutation the test let through reads unclear. (AC7)
- D3763: A run started next that left no record is read as a clean one, so a detection stands though a late unhandled error may have been lost with that run. (AC5, AC8)
- D3764: The job's own unhandled errors and its close are not read, so a detection stands though the executor's thread raised an error or the instance failed to close. (AC5, AC8)
- D3765: Reach is read before the hook states, so a test whose `beforeEach` failed before the site could execute reads site not executed, hiding the hook that failed. Its one assertion pins the whole order of AC6's reasons for an experiment that ran. (AC6)
- D3766: The run's unhandled error is read before the kind of the test's errors, so a test that threw a `TypeError` beside a leaked rejection reads unhandled error where its own error is no assertion. Its one assertion pins the whole order of AC8's reasons. (AC8)
- D3767: A mutated module that was transformed with the anchor occurring other than once reads as never transformed, so the reason loses the count that tells the author the anchor went stale. (AC6)
- D3768: A baseline's unhandled error that names no test module counts against no experiment, so a detection stands beside an error no module can be blamed for. (AC1, AC5)
- D3769: An experiment whose run started and left no record is passed over as the run started next, so the detection before it is read against a later run though a late error may have been lost. (AC1, AC8)
- D3770: A run the stale-transform guard refused counts as a started run that left no record, so the detection before it reads unclear though no run started. (AC1, AC5)
- D3771: A record is judged against the experiment at its position whatever defect it names, so one defect's run is read with another defect's test. (AC1)
- D3772: A declared assertion error name matches any error whose name contains it, so an error of another name is credited as an assertion. (AC2)
- D3799: An experiment whose run left no record reads invalid experiment, as a change with no probe site, so the author is told to fix a definition a failed run says nothing about. (AC9)

`packages/daemon/test/falsify/falsify-executor.test.ts`, over the `executor-crash` fixture:

- D3773: The executor process drops the assertion error names its request carries, so an error the consumer declared as an assertion reads as another kind and its experiment as unclear. (AC2)

`packages/daemon/test/falsify/falsify-workspace.test.ts`, over the `falsify` fixture, each on Vitest 5 and 4.1 in one assertion:

- D3774: Every unhandled error of a baseline counts against every experiment, whatever test module it names, so one module's leak makes every defect of the workspace an invalid experiment. (AC5)
- D3775: A baseline's unhandled error that names the experiment's own test module is not counted against it, so the experiment is judged as though its baseline were clean. (AC6)
- D3776: The unhandled errors of the run started next are not read, so a detection stands though a late error of its own run may have landed in the run after it. (AC5, AC8)
- D3777: The confirming run's reading is not compared, so a failure that did not repeat is credited as a detection. (AC5, AC8)
- D3778: Every experiment that ran is run a second time, not only one whose run would be a detection, so a job runs its survivors and invalid experiments twice. (AC4)
- D3779: An unhandled error is recorded as naming every test module of its run, so one module's leak counts against every experiment of the job. (AC1)
- D3780: An unhandled error names only the first project that runs its file, so the same file's experiments under another project read the baseline as clean. (AC1)
- D3781: An error's fact carries its message, so the text of an assertion, which can quote source and values, reaches the facts a judgement is stored with. (AC1)
- D3782: The falsifier version is not raised, so evidence recorded before a confirming run and a judgement existed is kept as current. (AC1)
- D3783: A job that ran nothing carries an empty list of judgements, so it reads as a job that judged every experiment it was given. (AC1)
- D3784: A confirming run an abort interrupted is kept as a run that finished, so the reply holds the record of a run cut short, and the experiment's missing verdict is put down to the restored baseline where its confirming run is what did not finish. (AC4, AC9)
- D3785: The anchor-count reason carries a count of zero whatever the anchor's count was, so an anchor that occurs twice reads as one that is missing. (AC6, AC9)

`packages/daemon/test/falsify/canaries.test.ts` (new), one job per Vitest line over a copy of `packages/daemon/canaries/`, each on both lines in one assertion:

- D3786: The canary file names detected for the canary whose test passes after executing the site, so the set vouches for a Vitest on which a passing test is credited. (AC10)
- D3787: An error Vitest serialized with the name `AssertionError` is not read as an assertion, so a plain `expect` failure reads unclear. (AC2, AC10)
- D3788: The failure of a matcher added by `expect.extend` is not read as an assertion, so a jest-dom style matcher's rejection reads unclear. (AC2, AC10)
- D3789: The assertion error names the job was given are not read, so an error the consumer declared as an assertion reads as another kind. (AC2, AC10)
- D3790: A site executed outside the test, while its module loaded, reads not executed, so a test that rejects what load-time code built can never detect its mutation. (AC3, AC10)
- D3791: A hook state other than pass is not read, so an assertion that failed in a `beforeEach` is credited as a detection and a thrown `afterEach` reads as a failure of the body. (AC3, AC6, AC10)
- D3792: A suite's error is not read, so a test its failing `beforeAll` skipped reads as a test that did not run, with no suite named. (AC6, AC10)
- D3793: A module's own errors are not read, so a mutated module that threw while it loaded reads as a test absent from the run. (AC6, AC10)
- D3794: A reach of not executed is read as executed, so a test that failed an assertion without running the mutated site is credited as a detection and one that passed reads as a survivor. (AC3, AC6, AC7, AC10)
- D3795: A reach that is unknown is read as executed, so the failure of a test that ran beside others is credited though no probe says it ran the site. (AC3, AC6, AC10)
- D3796: The kind of a failed test's errors is not read, so a thrown `TypeError`, a timeout, an assertion count failure, a snapshot mismatch or an undeclared error is credited as a detection. (AC3, AC8, AC10)
- D3797: One assertion error is enough for a detection, so a test that also threw an error of another kind is credited though its failure may be a setup failure carried over a retry. (AC3, AC8, AC10)
- D3798: An unhandled error in the experiment's own run is not read, so an assertion failure beside a leaked rejection is credited as a detection. (AC3, AC8, AC10)

Repaired, not new: the 34 tests of `falsify-workspace.test.ts` and D3651 of `falsify-executor.test.ts` that the build's new argument broke now pass the assertion error names; none of their assertions changed.

**Review round** (gap rows G1 to G5 of the Review Record, worked from 00:45 on 2026-10-01 over the review's uncommitted fix). Every expected value was written from the amended criteria and each test passed against the fix unchanged.

`packages/daemon/test/falsify/verdict.test.ts`:

- D3800: A failed test that declares repeats is read as any failed test, so an assertion that failed in a `beforeEach` or `afterEach` on an earlier repeat, its last repeat's hooks and body passing, is credited as a detection. (G4; AC3, AC6)
- D3801: A passed test that declares repeats reads invalid experiment, so a mutation that every repeat let through is not reported as a survivor. (G4; AC7)
- D3802: The repeats a test declares are not carried from the record to the facts, so the judge reads a failed repeated test as any failed test. (G4; AC1)
- D3803: The job's own unhandled errors count as none in the facts, so a detection stands though the executor's thread raised an error. (G1; AC5, AC8)
- D3804: The instance reads closed in the facts whatever its close error, so a detection stands though the instance failed to close. (G1; AC5, AC8)
- D3805: A run's force-stop is not carried from the record to the facts, so a run whose workers Vitest force-stopped is judged as one that ended cleanly. (G2; AC3, AC5)
- D3806: A run's cancel error is not carried from the record to the facts, so a run whose cancel raised an error is judged as one that ended cleanly. (G2; AC3, AC5)
- D3807: How a run's execution ended is not carried from the record to the facts, so a run something interrupted is judged as one that completed. (G2; AC3, AC5)
- D3808: Baseline trouble is read before whether the experiment has a verdict, so an experiment of a job that left no restored baseline, or whose confirming run left no record, reads invalid experiment where it has no verdict. (G3; AC9)
- D3760 and D3765 re-anchored over the reading the fix put between the hook states and reach; each keeps its defect, and D3765's one assertion now holds `test-repeated` directly after `hook-not-passed`. (G4; AC6)

`packages/daemon/test/falsify/canaries.test.ts`, over a set that now holds 24 canaries:

- D3809: The repeats Vitest was told to give a test are not recorded, so a test its suite repeats, whose setup assertion failed on an earlier repeat alone, is credited as a detection. (G4; AC1, AC10)
- D3810: A test told to run once more than once is recorded as a test Vitest runs once, so the fewest repeats a test can declare escape the reading and its hook failure is credited as a detection. (G4; AC1, AC10)

`packages/daemon/test/falsify/falsify-executor.test.ts`, over the `host-rejection` fixture:

- D3811: The unhandled errors the job's own thread recorded are not handed to the judging, so a detection stands though the executor's thread raised an error while the instance was open. (G1; AC5, AC8)

G5: D3784's and D3785's sentences reworded to what their mutants do, here and in `defects.json`; no test changed.

Taken from the review's offers: the `once` fixture test reads its marker's path from `RT_FIXTURE_ONCE_MARKER`, which `falsifiedOn` sets to a file under the job's temp directory, and throws on a mutated value when it is unset; D3781 also asserts that the runs held error text to compare; `body.canary.mjs` says that "reads the value another test stored" relies on the test before it.

#### Deliberately Untested

- `packages/daemon/src/falsify/fact-types.ts`: types and three constants, with no branch.
- `packages/daemon/src/falsify/run-relay.ts`: moved out of `falsify-workspace.ts` unchanged; every job test runs through it, and D3637 already pins the queued modules it collects.
- `packages/daemon/src/daemon/executor-jobs.ts`: one field of a type.
- `packages/daemon/src/daemon/executor.ts`, the `assertionErrors` field of the request: D3773 goes red when the field is dropped there too. Its record sits on the executor process's side, the one the handoff named.
- `packages/daemon/src/falsify/falsify-workspace.ts`, the abort read before the stale-transform guard in `#run`: reaching it needs an abort that lands between two runs while a module is stale, and either order reads no verdict, so it can neither credit a detection nor report a stale result (owner ruling of 03:25 on 2026-09-30).
- `packages/daemon/src/falsify/falsify-workspace.ts`, the confirming clause of `wasInterrupted`: inert. Once the signal is aborted every later `#run` returns interrupted before it starts, so the job ends the same way with the clause removed. D3784 pins the outcome.
- `packages/daemon/src/falsify/falsify-workspace.ts`, the confirming run behind the same stale-transform guard: it has one path to a run, `#mutatedRun`, shared with the first run, so no one-line defect separates them.
- `packages/daemon/src/falsify/run-facts.ts`, `ownField`: inert. An inherited `constructor` is a function, never the marker string, so reading fields without the own-property check gives the same kinds.
- `packages/daemon/src/falsify/run-facts.ts`, a fact that is absent rather than empty (hook states, reach, the test, the module, the next run only after a recorded confirming run): no judgement reads the difference, so no test of a judgement can go red. What 3.4 stores is its to pin.
- `packages/daemon/src/falsify/run-facts.ts`, a `JestExtendError` marker with no assertion name: no supported Vitest serializes one, and it is a matcher failure either way.
- `packages/daemon/src/falsify/run-facts.ts`, the length operand of the pairing guard: D3771 drives the guard through a record that names another defect, the case that judges one defect's run with another's test.
- `packages/daemon/src/falsify/verdict.ts`, a module that was not collected or is missing, and a test absent from the run: dropping either check throws rather than misreads, and such a run holds no failed test to credit. D3765's ladder pins `module-failed` and `test-not-run` in the order, without a record of their own.
- `packages/daemon/src/falsify/verdict.ts`, a run with no reach recorded, and a would-be detection with no confirming run at all: no production caller builds either, since `recordRun` gives every test of a mutated run a reach and the job confirms every would-be detection.
- `packages/daemon/src/falsify/verdict.ts`, that AC6's three reasons decided without a run hold with no restored baseline: `judgeNotRun` never reads the restored baseline, so no one-line defect breaks it. D3785 reads all three kinds from a real job.
- `packages/daemon/canaries/vitest.config.mjs` and the root config's project list: configuration no code branches on. `bun x vitest list --filesOnly` lists no `*.canary.mjs` module (23:57 on 2026-09-30).
- The `survivor`, `unparsed-mutation` and `returned-cleanup-assertion` canaries: read by D3786 against the canary file, with no test of their own. The last pins a ruled known limit, so no test asks it to read anything but detected.
- `packages/daemon/src/falsify/falsify-workspace.ts`, the close error `judgedJob` hands to the judging (gap G1): no fixture makes an instance fail to close. Vitest 5.0.1 and 4.1.11 both collect a global teardown's throw and every rejected close promise and log them as "error during close" (`close` in 5.0.1 `dist/chunks/index.DzobfTyw.js` and 4.1.11 `dist/chunks/cli-api.CnMVyzaz.js`, read at 00:47 on 2026-10-01), so `close()` rejects for nothing a consumer's hook does. D3804 pins the close error from the job's end to the judgement, and D3811 pins `judgedJob`'s other arm through a real executor.
- `packages/daemon/src/falsify/experiment-record.ts`, a project-level `repeats` (Vitest 5 only): it reaches the same `TestCase.options.repeats` member the suite-level and test-level canaries read, and a canary config that sets it would give every canary of the set repeats.

### Review Record

Review session: threadId f706a6d7-1f31-4048-9c33-68e1a0313cdc

Reviewed `git diff 6468eed6 wt/1` (the main commit merged into `wt/1`; build c6c2bb83, tests 234a9c14, 25 files), the doc changes of the authoring commit 799c43e8, and the dev's and the tests session's doc text, from 00:16 on 2026-10-01 in Tree 1. Three fresh-eyes batches (the job, the judge with the canaries, the executor with the lane's defect records), two doc checks and a check of installed Vitest 4.1.11 and 5.0.1 ran beside the checklist pass. None of the six found a path to a false detection in the judge as written; the review's own measurement found one in what the record held (below), and the installed-source check named it and two more.

**Rulings during the review.**

- A repeated test credits a hook failure as a detection (asked at 00:33, decided by the orchestrator at 00:34). Measured at 00:31 on Vitest 5.0.1 and 4.1.11, through the built daemon and the run lease, over a scratch canary set: a `beforeEach` assertion that fails on the first repeat alone, the body passing on every repeat, read state failed, hooks `{ beforeEach: "pass" }`, one `AssertionError`, reach in the test, the confirming run the same, and so `detected`; an `afterEach` assertion read the same; the same hook assertion with no repeats read `hook-not-passed`. Vitest keeps a repeated test failed once any repeat failed and keeps that repeat's errors, while each repeat overwrites the hook states (`runTest`, both lines); a retry resets the state, a repeat does not. Ruling: fix it in this ticket. Record the test's declared repeats on `RecordedRunTest` and `TestFacts` when above zero; a failed intended test that declares repeats reads invalid experiment with the new reason `test-repeated`, detail `repeats`, directly after `hook-not-passed` in AC6's order; a passed repeated test still reads survived; `FALSIFIER_VERSION` stays 2. A known limit was refused, since a recorded fact tells this case apart.
- Which member carries a suite's repeats (the ruling's first item, measured at 00:39 with the fix built, both lines): `TestCase.options.repeats` carries a test's own repeats, a suite's (`describe(..., { repeats: 2 }, ...)` read detail 2 on a test that declares none) and, on 5.0.1, the project config's; 4.1.11 has no config-level repeats and runs the test once. It is the member built, and the result's `repeatCount` is not read.
- An `expect.soft` that fails in a hook (asked at 00:40, decided by the orchestrator at 00:41). Measured at 00:36 on both lines: a soft assertion failing in a `beforeEach`, the body passing, reads `detected`, since a soft failure fails the test without throwing and the hook's state stays `pass`. Ruling: a known limit, added to the one sentence for the places Vitest records no failed hook state, with no canary. No recorded fact tells it from the body and Vitest gives no hook point between the last `beforeEach` and the body; the test's error count when the probe first fires would close nothing, since the baseline passes and a hook failure the mutation causes comes after the site executed. The hook is an input of the workspace, so editing it stales the evidence.
- An `AssertionError` the code under test raises itself (asked at 00:40, decided by the orchestrator at 00:41). Measured at 00:36 on both lines: a `node:assert` invariant in the mutated source, tripped by the mutation under a test that only calls the function, reads `detected`, since Node's error crosses with the name `AssertionError`. Ruling: a known limit, its sentence carrying its consequence. It is none of NFR7's classes: an assertion, in the intended test, after the site executed, repeated. Reading `code: "ERR_ASSERTION"` as another kind stays refused: every test written with `node:assert` would read unclear, and whose `assert` fired still could not be told without stack text, which ADR-0003 rejects. No canary, since `body-expect` pins the reading of the name.

**Fixes applied by the review.**

- `falsify/experiment-record.ts`: `RecordedRunTest.repeats`, read by `declaredRepeats` from `TestCase.options.repeats` and present only when above zero. `falsify/fact-types.ts` and `falsify/run-facts.ts`: `TestFacts.repeats`, carried from the record. `falsify/verdict.ts`: the reason `test-repeated` and `readRepeats`, between the hook reading and the reach reading of `readRun`, so the one reading that serves the first run and the confirming run refuses a failed repeated test and no confirming run starts for one. AC1, AC3, AC6 and AC10 gained their clauses, and Dev Notes § The record's reasons, mapped, § Known limits and Completion Notes § Names the build chose their lines.
- `falsify/fact-types.ts`: the comment on `restoredBaseline` said it is absent when the job started no restored baseline; it is also absent when an abort interrupted one. `falsify/experiment-record.ts`: `JudgedJobFacts`'s comment now says why the type takes a parameter no caller passes (the condition applies to each member of the job's union alone).
- Anchors the fix broke, for the tests session to re-anchor: D3760 and D3765, whose `old` text spans the two lines `readRepeats(test) ??` now sits between. Every other record of the four files still matches once (57 of 59, read with a scratch script at 00:38).

**Corrections to answers this ticket records about installed Vitest** (read in `@vitest/runner@4.1.11`, `@vitest/expect@4.1.11`, `@vitest/utils@4.1.11`, Vitest 5.0.1's `dist/chunks` and chai 6.2.2).

- Dev Notes § Facts settled, "Only the hook state tells it from a body failure": not a guarantee. A hook's failure leaves every recorded hook state `pass` when the test is repeated (fixed above), when the failure is an `expect.soft`, and in the places Vitest records no hook state (the 23:23 ruling).
- U5: the built-in `node` environment sets `prewarmModules: false` on 5.0.1, so a `vmThreads` run on the default environment prewarms nothing, and the recorded run may not have exercised prewarm. Where it runs, `prewarmModuleGraph` walks the whole transitive graph and the setup files, and skips a dynamic-only import only in a file with no hoisted `vi.mock`. The conclusion stands: a transform list never proves a worker ran the site.
- U6: the stamp is the specification's `moduleId` by construction, and the worker's file path is never cleared, so the stamp names the leaking file only because the job forces one test file per worker. U7: Vitest starts a worker's stop without awaiting it inside a run, so ten of ten is an observation and not a guarantee, which the next-run check exists for.
- "A chai `AssertionError` crosses with no `constructor` field": because chai's error has `toJSON`; every other class instance crosses with one, `node:assert`'s error included (`Function<AssertionError>`, with `code: "ERR_ASSERTION"`).
- `it.fails` on 5.0.1: a failure holding a `TestSyntaxError` (a snapshot matcher under `test.fails`) is not flipped.
- A project that registers its own `unhandledRejection` listener keeps its unhandled errors from Vitest (`listenForErrors` reports only while it is the sole listener), and so from the record. Read in installed source on both lines, not measured.

**Measured beside the rulings, and recorded as known limits** (00:36, both lines, same scratch runs; neither credits a detection).

- A test that fails its assertion and passes on a `retry` reads survived, with the failed attempt's error still on the passed test's facts.
- A test that fails an assertion before it reaches a file snapshot assertion (`toMatchSnapshot`) reads invalid experiment, `module-failed`: the session's no-update snapshot mode makes Vitest report the unchecked snapshot as a module error ("Obsolete snapshots found when no snapshot update is expected."). Measured at 00:44 on both lines: it strikes as well when the intended test holds no snapshot and another test of its module is the one that misses its snapshot under the mutation. Realistic suites will meet this one, and it can only hide a detection. A change-request candidate the orchestrator holds for after this ticket (00:41): tell that module error from a load failure, or keep an unchecked snapshot from failing a falsification run.

**Not fixed, with the reason** (owner ruling of 03:25 on 2026-09-30; none credits a detection or reports a stale result as current).

- `run-facts.ts` reads each baseline's tests once per experiment (`testResultIn` in `baselineFacts` and `restoredFacts`). The dev's own review weighed it; it is an in-memory walk beside an experiment's run, which takes about a second.
- `RunRecord.unhandledErrors` and `unhandledErrorModules` are two lists aligned by index, and `baselineFacts` counts from the second. `recordRun` is their one builder and makes both from one list, so they cannot differ in production; a shorter second list would read a baseline cleaner than it is, which ticket 3.4 must know if it ever rebuilds facts from a stored record.
- `readReach` in `verdict.ts` reads a reach value it does not name as executed. The four values are a closed union the compiler checks today; a ticket that adds a fifth must add its case there.
- `ConfirmingRun`'s `run` member holds a record or an unrecorded run by its status, as `ExperimentNotRun`'s `run-unrecorded` member does; `baselineNotPassed` gives no detail when the baseline did not report the test; `errors` is an empty list on a test Vitest gave none. Each is the shape ticket 3.4 was written against.
- An experiment whose baseline is already known not clean still runs, and a `falsify` request with no `assertionErrors` fails the job with a type error's text. The first is the dev's change-request candidate; nothing in production builds the second.

**Tech debt, triaged at Step 9** against main's merge 45f92eb6 by the review session at 01:58 on 2026-10-01. No production file, test or defect record changed; 0 open issues. Each item was scoped at both of its sites and held to the owner's 03:25 ruling: none can store evidence, credit a detection or report a stale result as current, so each is recorded and none is fixed.

- `packages/daemon/src/daemon/executor-jobs.ts` `isExecutorReply` (existing code) checks only a message's `type`. A `{ type: "falsified" }` message with no `job`, which only the consumer's own code calling `process.send` inside the executor process could send, settles the job, and `Executor.falsify` in `packages/daemon/src/daemon/executor.ts` returns `{ ended: true, value: undefined }`, an outcome shaped like success with nothing in it, which ticket 3.4 would be handed. **Recorded for 3.5**: an undefined job throws a TypeError in 3.4's write before its first refusal and stores nothing.
- `packages/daemon/src/falsify/run-facts.ts` `isTestModule` and `packages/daemon/src/falsify/falsify-workspace.ts` `holdsTest` both answer whether a module is the one holding a test, the first over a module report (project name and module path), the second over a located specification (workspace path as well). Two helpers that could come to disagree. **No change**: a deliberate difference, a module report holds no workspace path.
- `packages/daemon/src/falsify/falsify-workspace.ts` `#run` (existing code; this ticket moved the line): no test goes red when the abort check at its top is dropped altogether, since a run started after an abort is cancelled at its first queued module and reads interrupted the same way. The job would then start one more run of project code after its abort. **Recorded**, unmeasured.
- `packages/daemon/src/falsify/falsify-workspace.ts` `all` (existing code) keys its records by the experiment object, so one object given twice is run twice and read once. A request crosses the executor's channel as JSON, which yields distinct objects; only an in-process caller could do it. **Recorded**.
- `packages/daemon/src/falsify/falsify-workspace.ts` `all` (existing code): a job given no experiment, or whose every experiment was decided before any run, reads `ran` with no baseline, and now with an empty list of judgements. For ticket 3.5, which reads the job's status. **Recorded on main**, sprint file § Ticket 3.5.

**Doc text, final** (for the orchestrator to apply; it replaces `C:/source/rt-test/_agent-docs/.scratch/3-3-doc-text.md`, corrected against the code as built at 00:40 on 2026-10-01).

ADR-0008, the decision paragraph (the paragraph that begins "An experiment would be detected when"), whole:

"An experiment would be detected when the baseline and the restored baseline passed the intended test, its run ended cleanly, the mutated site executed during the intended test, and that test failed holding a recorded `beforeEach` state with every hook state Vitest recorded on it `pass`, declaring no repeats, with at least one error and every error an assertion error, and with no module, suite or unhandled error in the run. A would-be detection is run once more, at once, as a confirming run in the same instance, and is detected only when that run meets the same conditions, the run the job starts next leaves a record that holds no unhandled error, and the job's own process recorded no unhandled error and closed the instance; otherwise it is unclear, naming the instability. It survived when the intended test passed after the site executed. It is an invalid experiment for the first of these that holds: its change has no probe site; no test module holds its test; the baseline, and then the restored baseline, did not pass the intended test, did not end cleanly, or recorded an unhandled error that names the intended test's module or names none; its own run did not end cleanly; a module or suite error was recorded; the intended test did not run; a hook did not end in pass or the test holds no `beforeEach` state; the test failed and declares repeats; or the site did not execute during the intended test or its reach is unknown. It is unclear when the intended test failed with no error or with an error that is not an assertion, as a thrown `TypeError` or a timeout is, or beside an unhandled error. An experiment the job did not finish has no verdict: its own run, its confirming run or a baseline left no record, or the job could not read its mutation's file or find its anchor exactly once when it started. Anchor missing and an invalid definition are decided before any run."

ADR-0008, the canary paragraph, its first sentence ("These facts are Vitest's internals, and a release that stopped recording hook states would credit an `expect` failing in a `beforeEach` as a detection.") becomes:

"These facts are Vitest's internals: a release that recorded a hook's state differently would credit an `expect` failing in a `beforeEach` as a detection, and one that stopped recording hook states would leave every experiment invalid."

ADR-0008, known limits:

- Replace "When the experiment that runs next leaks an unhandled error, the detection before it reads as unclear." with "A detection reads as unclear when the run the job starts next records any unhandled error, the restored baseline included, even one that names another test module, so a test module of the job that leaks in every run leaves the job's last detection unclear."
- Replace "An assertion that fails in a fixture's setup or in an `onTestFinished` callback has no hook state and reads as a failure in the test's body." with "An assertion that fails outside the test's body where Vitest records no failed hook state (a fixture's setup or teardown, a cleanup a `beforeEach` returns, an `aroundEach` hook, an `onTestFinished` callback, an `expect.soft` in a `beforeEach` or `afterEach`) reads as a failure in the test's body and can read detected."
- Add "A defect on a test that declares repeats, its own, a suite's or the project's, can read survived but never detected: a repeated test that failed reads as an invalid experiment, since the hook states it holds are its last repeat's alone."
- Add "A test that fails under the mutation and passes on a retry reads as survived."
- Add "A mutated module that throws while it loads leaves its test module collected with a module error, and reads as an invalid experiment."
- Add "A test that fails before it reaches a file snapshot assertion leaves that snapshot unchecked, which Vitest reports as a module error while no snapshot may be written, so every experiment whose test is in that module reads as invalid in that run."
- Add "An `AssertionError` the code under test raises itself, as an invariant checked with `node:assert` does, reads as the test's assertion, so a defect can read detected by a test whose own assertions do not check it."

`docs/glossary.md`, Unclear experiment: "An experiment whose test failed in its own body with no error or one that is not an assertion, failed beside an unhandled error, or failed at an assertion that its confirming run, the run the job started next or the job's own end did not bear out."

Checklist C138, its last clause ("and an experiment whose job never finished its runs gets no verdict") becomes: "and an experiment the job did not finish, whose own run, confirming run or baseline left no record, gets no verdict." An experiment decided without a run (no probe site, no module, a baseline that did not pass) reads invalid in an aborted job too, which the present clause denies.

`docs/architecture.md`, the section menu line for `Falsification jobs`: "`falsifyWorkspace`: one workspace's experiments in one reused instance, the checks made before any run, the instance preparation and the stale-transform guard, the reach probe and its setup file, the confirming run, what each run's record and the job's record hold, the judgement and facts on the reply, the canary directory, and the known limits. Load it when you change the falsification job, its mutation transform, reach, its record, the judge or the canary set."

`docs/architecture.md` § Falsification jobs:

1. First paragraph, first sentence becomes: "`falsifyWorkspace` runs one workspace's defect experiments in one Vitest instance, and is given the error names that count as assertions beside the two forms Vitest marks itself (the `assertionErrors` the `falsify` request carries)."
2. First paragraph, after "...or that the baseline left no record." insert: "An experiment whose run would be a detection ([ADR-0008](adr/0008-detection-from-task-facts-and-canaries.md)) runs once more at once, as its confirming run: over the same specification, with its own mutation alone, behind the same guard and abort check, before any other experiment and before the restored baseline. No other experiment runs twice, and none runs a third time."
3. In the list "Each run's record holds facts only from...", the bullet "each test's identity, mode, state, hook states, and errors as Vitest serialized them, ..." gains, after "state,": "the repeats Vitest was told to give it when it has any,". After "the run's unhandled errors;" add the bullet: "- for each unhandled error, the run's modules whose file the worker that raised it was running, read from the test file path Vitest stamps on the error and matched to the run's specifications by file as Vite keys a module's file: several when one file runs under several projects, and none when the error names no file of the run;"
4. The paragraph that begins "An experiment's record also lists each transform of its mutated module": after "An empty list means the module was never loaded." insert: "The record of an experiment whose run would be a detection also holds its confirming run: its record and transform list, or that it left no record, or that an abort interrupted it." In the same paragraph replace "An abort ends the job at the run in progress: the reply is marked interrupted and holds only the runs that finished, with no restored baseline, and every experiment not yet finished reads interrupted." with: "Each run reads the abort before it asks the guard, so an abort that came first reads interrupted whatever the guard would find. An abort ends the job at the run in progress, a confirming run included: the reply is marked interrupted and holds only the runs that finished, with no restored baseline. An experiment whose first run the abort ended, and every experiment after it, reads interrupted; one aborted in its confirming run keeps its first run's record beside a confirming run marked interrupted."
5. New paragraphs, before "Known limits" (the sentence "Known limits, each making..." becomes a paragraph of its own):

"Once the instance has closed, so the host thread's rejections and the close error are known, a job that read `ran` judges every experiment it was given and carries one judgement per experiment, in the order given: a verdict (`detected`, `survived`, `invalid-experiment` or `unclear`) or none, one reason from a closed set for every judgement but detected and survived, a detail where the reason has one, and the facts it was decided from. A job that did not read `ran` carries none. The facts (`falsify/fact-types.ts`, built from the raw records by `falsify/run-facts.ts`) hold states, kinds, names and counts, and never an error's message, its stack or source text; a fact a run did not record is absent. For the experiment's run, its confirming run and both baselines they give the intended test's state, mode, the repeats it declares, hook states, and each of its errors as a kind with the name Vitest serialized: an assertion, with what made it one (the name `AssertionError`, the `JestExtendError` constructor with an assertion name, or a declared name), or another kind. For the experiment's runs they also give its reach. Of the intended test's module alone they give whether it was collected, its module error count and its failing suites by name path; of the run, its unhandled error count and how it ended. A baseline's facts also count the unhandled errors that count against the experiment, those naming its test's module and those naming no test module of the baseline, and how many of those named none. The facts also give what each transform of the mutated module did in each of the experiment's runs, why the job gave an experiment no run, the job's own unhandled error count and whether the instance closed, and, for an experiment whose confirming run left a record, whether the run the job started next left a record, with its unhandled error count; a run the guard refused never started and is passed over. The judge (`falsify/verdict.ts`) is a pure function of those facts that loads neither Vitest nor a file, and reads an experiment's first run and its confirming run by one reading. It decides whether an experiment has a verdict before which, except that no probe site, no module and a baseline that did not pass read invalid experiment whether or not a restored baseline ran; then baseline trouble before the experiment's own runs; then the experiment's run, in the order that follows. No verdict: `interrupted`, `mutation-file-unreadable`, `anchor-count`, `baseline-unrecorded`, `run-unrecorded`, `confirming-run-unrecorded`, `restored-baseline-unrecorded`. Invalid experiment, the first that holds: `no-probe-site`, `no-module`, `baseline-not-passed`, `baseline-not-clean`, `restored-baseline-not-passed`, `restored-baseline-not-clean`, `run-not-clean`, `module-failed`, `suite-error`, `test-not-run`, `hook-not-passed`, `test-repeated`, `site-not-executed`, `reach-unknown`. Unclear, the first that holds: `not-an-assertion`, `unhandled-error`, `confirming-run-differed`, `next-run-unclean`, `job-unclean`.

`packages/daemon/canaries/` holds RT Test's canary fixtures: a Vitest project named `canaries` whose config includes only its `*.canary.mjs` modules, plain `.mjs` files that import no package but `vitest`, and `canaries.json`, which names the project, the assertion error names the set's job is given, and for each canary its intended test, its mutation and the judgement it must read (the verdict, and the reason where it has one), in the order the job runs them. That order carries a case: the canary that leaks an unhandled rejection comes directly after a canary that does not read detected, which its run's error would otherwise make unclear, and is not the last, so a late report of its error cannot land in the restored baseline. Every canary's test passes unmutated, and this repository's own suite does not collect the canary modules."

6. In the known-limits list, replace "an unhandled error a stopping worker reports after its run returned appears in the next run's record;" with "- an unhandled error a stopping worker reports after its run returned appears in the next run's record, so a detection reads unclear whenever the run started next records any unhandled error, the restored baseline included, even one that names another test module;" and add:
   - "- an assertion that fails outside the test's body where Vitest records no failed hook state (a fixture's setup or teardown, a cleanup a `beforeEach` returns, an `aroundEach` hook, an `onTestFinished` callback, an `expect.soft` in a `beforeEach` or `afterEach`) reads as a failure in the body and can read detected;"
   - "- a suite error anywhere in the experiment's test module makes the experiment invalid, whichever suite holds the intended test;"
   - "- a failed test that declares repeats, its own, a suite's or the project's, reads invalid, so a defect on it can read survived but never detected;"
   - "- a test that fails before it reaches a file snapshot assertion makes every experiment whose test is in its module read invalid in that run, since Vitest reports the unchecked snapshot as a module error while no snapshot may be written;"
   - "- a test that fails under the mutation and passes on a retry reads survived;"
   - "- an `AssertionError` the code under test raises itself reads as the test's assertion, so a defect can read detected by a test whose own assertions do not check it;"

`docs/architecture.md` § Execution and falsification isolation: "Canary fixtures exercise the fact collector." becomes "Canary fixtures (`packages/daemon/canaries/`) exercise the fact collector and the judge." After "...falsification does not yet run them." add: "A falsification job's reply carries each experiment's judgement with its facts, and nothing stores them yet."

`docs/testing.md` § Falsification jobs, mutation transforms and reach, the tests session's final text of 01:22 on 2026-10-01, which takes the review's corrections (the records' sources in (a), only what a test pins in (b), positions for (c) and (e), `besideDetection` named in (d)):

- (a) The first sentence becomes: "D3604 through D3653, D3709, D3735 through D3745 and D3750 through D3811, in `packages/daemon/test/falsify/defects.json`, cover a falsification job (`packages/daemon/src/falsify/`, the executor's `falsify` job in `packages/daemon/src/daemon/executor.ts` and `executor-main.ts`, the parse offset `parseGuarded` reports in `packages/daemon/src/selection/source-imports.ts`, and the canary file `packages/daemon/canaries/canaries.json`), in `packages/daemon/test/falsify/`."
- (b) In the fixture paragraph, after the sentence ending "the last to run, mutates it again before the restored baseline.", add: "The `once` experiment's test fails the first time it meets a mutated value and passes every time after, through a marker file whose path `falsifiedOn` names in `RT_FIXTURE_ONCE_MARKER`, under the job's temp directory, so its confirming run differs; with the variable unset a mutated value throws. The hook also records each `mutated:` event as `mutatedServes`, one entry per run in which the root's server served a mutated module; the `lib` project has a config of its own with no plugin and reports none. D3784 runs a job of its own over `add`, `greet` and `lib` and aborts at the greet module's second mutated serve, which is inside that experiment's confirming run. The suite module leaks a rejection in every run, so `loaded` and `lib`, whose next started run is that module's experiment or the restored baseline, read unclear (D3776), and `add`, whose next started run is `loaded`'s, reads detected (D3774)."
- (c) In the same paragraph, after "`concurrent` two concurrent tests;" add: "`once` a test that fails once and then passes;".
- (d) New paragraph after the fixture paragraph: "The judge and the facts it reads are covered in `verdict.test.ts`, which loads no Vitest: it calls `judge` on hand-built facts and `experimentFacts` on hand-built job records. `detection()` builds facts that hold every condition of a detection and `ranOnce()` an experiment with one run; where a test reads through `besideDetection`, its assertion holds the detection beside the facts it changed, so one fact alone accounts for the reading. `reasonsAsEachIsRemoved` pins an order of reasons: it reads facts that hold every trouble at once, then takes each away from the front. `detectingJob()` builds the records of a job whose one experiment reads detected, and `firstJudgement` reads that experiment through `experimentFacts` and `judge` as the job does, so a fact dropped between the record and the judge shows as a wrong judgement. The canary set is covered in `canaries.test.ts`, which copies `packages/daemon/canaries/` into a temp directory, links each Vitest install, and runs one job per line with the experiments and assertion error names read from `canaries.json`. D3786 compares every canary's verdict and reason with that file; the other tests pin a literal judgement, with its detail, for the canaries whose guard a mutation drops. `job-readings.ts` holds the readings the job test files share: `onEachLine`, `ranJob`, `judgementOf` and `errorMarkersOf`."
- (e) At the end of the executor paragraph, add: "D3773 sends a declared error name through `Executor.falsify` and reads its experiment as detected. D3811 falsifies over the `host-rejection` fixture with its plugin site leaking on the executor's own thread, and reads the experiment as job unclean beside the same job with no leak."
- The section menu line becomes: "`Falsification jobs, mutation transforms and reach`: The falsify records, the `falsify` fixture with its run hook, directory link and temp directory override, the one job per Vitest line, the judge over hand-built facts, the canary set's job over `packages/daemon/canaries/`, and the executor-crash holds. Load it when you test `packages/daemon/src/falsify/`, the canary set or the executor's falsification job."

**For the tickets that follow.**

- 3.4: the invalid reasons gained `test-repeated` (detail `repeats`, a number) directly after `hook-not-passed`, so its list of reasons a stored judgement can carry is one short; `TestFacts` and `RecordedRunTest` gained the optional `repeats`. The verdict and reason constants stay unexported. No verdict is a judgement with no `verdict` member. Each experiment's facts hold both baselines' reading of its own test, so a job's judgements repeat nothing between experiments but carry two baseline readings each. The facts pass `MutationLoad`, `NoProbeSite`, hook states and reach through as the record holds them, so a text-bearing member added to one of those types would enter the stored facts. A `ran` job given no experiment carries an empty list of judgements. Facts are built once, in the executor; rebuild none from a stored record (see the two aligned lists above).
- 3.3b: D3782 pins `FALSIFIER_VERSION` at the literal 2, in its test's expected value and in its record's anchor (`export const FALSIFIER_VERSION = 2;`), so the raise moves both. `experiment-record.ts` holds 406 code lines after this round.
- 3.6: `canaries.json` holds `projectName`, `assertionErrors` and `canaries`, each `{ id, test: { modulePath, namePath }, mutation: { file, old, new }, judgement: { verdict, reason? } }`; `mutation.file` is relative to the directory, and the reader supplies the workspace path and occurrence 0. `body.canary.mjs` imports `canaries.json` for the declared error name, so the two travel together. The list's order is load-bearing (the paragraph above). The set holds 24 canaries, three more than AC10 named when it was written: `returned-cleanup-assertion`, which pins the known limit and reads detected, and the two repeated-test canaries, `suite-repeats-setup-assertion` (the suite declares the repeats) and `test-repeats-setup-assertion` (the test does), which sit directly after `after-each-throw`.

**Gap rows, worked** by the tests session (sent at 00:45, reply at 01:22 on 2026-10-01): G1 by D3803, D3804 and D3811, with the close-error arm of `judgedJob` a recorded exclusion; G2 by D3805 to D3807; G3 by D3808; G4 by D3800 to D3802, D3809 and D3810 and two canaries, with D3760 and D3765 re-anchored; G5 by rewording. Its Tests Record holds each.

**Validation of the final tree** (Tree 1, `wt/1` at 8cc6e9a8 plus the review's and the tests session's uncommitted files; Windows 11, Node 24.19, and WSL Node 24.19 for the proofs).

- `bun x oxlint` over `packages/daemon/src/falsify`, `packages/daemon/canaries`, `packages/daemon/test/falsify` and the `once` fixture test: exit 0, no output. `bun run --filter @rt-test/daemon typecheck`: exit 0. `bun x prettier --check` over the same paths and this ticket: exit 0. `node scripts/check-defects.mjs`: exit 0, 3,126 named defects, each anchor once. `node scripts/check-line-citations.mjs`: clean. All at 01:23, after the last edit to a production or test file (00:53). The four production files hold 431, 301, 104 and 406 code lines (`verdict.ts`, `run-facts.ts`, `fact-types.ts`, `experiment-record.ts`).
- `bun x vitest related` over the review's four production files, through the lease: exit 0, 3 test files (of 84 tracked) and 96 tests, 01:50 to 01:51. The graph walk does not follow the executor's dynamic import of the job, so `falsify-executor.test.ts` is not among them; the tests session ran it by name, 6 of 6, at 00:52, after the review's last production edit (00:38).
- Named defects, by id through the lease, by the tests session: 102 records, every one that mutates `experiment-record.ts`, `run-facts.ts`, `verdict.ts` or `canaries.json` and every record of the four test files; 102 of 102 detected on Windows (ended 01:19) and on WSL (01:19 to 01:22), baseline green before and after.
- `node scripts/check-sprint-keys.mjs` and `node scripts/check-requirement-markers.mjs`: exit 0 (00:45).
- Not run here: Linux under Node 22, and `bun run check` over the merged tree, both the orchestrator's.

#### Test Coverage Gaps

Denominator: 50 named-defect tests the lane added in four test files (D3750 to D3799) against the behaviors AC1 to AC10 name. Each row below is a defect no test turns red on, traced against the code; G4 is the defect the review's fix closes, which needs its own named tests.

| #   | Source                                                                                                                                                                               | Named defect                                                                                                                                                                                                                                                                         | Expected test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Severity                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| G1  | `packages/daemon/src/falsify/run-facts.ts` `experimentFacts` (the `job` facts); `packages/daemon/src/falsify/falsify-workspace.ts` `judgedJob`                                       | The job's own end does not reach the facts: the instance reads closed whatever its close error, or the job's own unhandled errors count as none, so a detection stands though the instance failed to close or the executor's thread raised an error. (AC5, AC8)                      | `verdict.test.ts`: `experimentFacts` over a job whose one experiment is confirmed, with a `JobEnd` holding one unhandled error and with one holding a `closeError`, each read through `judge` as `job-unclean` beside the same job with a clean end. Mutations: `closed: end.closeError === undefined` to `closed: true`, and `unhandledErrorCount: end.unhandledErrors.length` to `0`. `judgedJob`'s own four lines need a job whose host thread rejects (the `falsify` fixture's run hook runs in the host process and can leak one in a job of its own) or an instance that fails to close; if neither is practical, record the exclusion with that reason. D3764 pins only the judge.                                                                                                                                                                                                                                                                                                        | HIGH, daemon-state, reach unknown                     |
| G2  | `packages/daemon/src/falsify/run-facts.ts` `runFacts` (the `ending`)                                                                                                                 | How a run ended is not carried from the record to the facts, so a run Vitest force-stopped, that something interrupted, or whose cancel raised an error is judged as a run that ended cleanly and can read detected. (AC3, AC5)                                                      | `verdict.test.ts`: `experimentFacts` over a run record holding `forceStopped: true`, one holding `execution: "interrupted"` and one holding a `cancelError`, each read through `judge` as `run-not-clean` (or `baseline-not-clean` for a baseline's record). Mutations, one per named test: `forceStopped: record.forceStopped` to `false`; `cancelFailed: record.cancelError !== undefined` to `false`; `execution: record.execution` to `"completed"`. D3751 and D3758 pin only the judge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | HIGH, daemon-state, reach unknown                     |
| G3  | `packages/daemon/src/falsify/verdict.ts` `judgeRan`                                                                                                                                  | Baseline trouble is read before whether the experiment has a verdict, so an experiment of a job that left no restored baseline, or whose confirming run left no record, reads invalid experiment where it has no verdict. (AC9)                                                      | `verdict.test.ts`: facts holding a baseline with a counted unhandled error beside a restored baseline that left no record, and beside an interrupted confirming run, each reading its no-verdict reason. Mutation: the `baselineTrouble` reading moved above the two no-verdict checks. D3756 and D3757 use clean baselines, and D3784's job has a clean baseline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | MEDIUM, daemon-state                                  |
| G4  | `packages/daemon/src/falsify/verdict.ts` `readRepeats`; `packages/daemon/src/falsify/experiment-record.ts` `declaredRepeats`; `packages/daemon/src/falsify/run-facts.ts` `testFacts` | A failed test that declares repeats is read as any failed test, so an assertion that failed in a `beforeEach` or `afterEach` on an earlier repeat, its last repeat's hooks and body passing, is credited as a detection. (AC3, AC6, AC10)                                            | Orchestrator ruling of 00:34 on 2026-10-01. The judge in `verdict.test.ts`: a rejecting test with `repeats` reads `test-repeated` with detail `repeats` beside the detection; a passed test with `repeats` reads survived; D3765's order gains the reason between `hook-not-passed` and `site-not-executed`. The canary set: one more canary, a test whose suite declares the repeats and whose `beforeEach` assertion fails on the first repeat alone (a one-time initializer in `src/subject.mjs`), reading `invalid-experiment`, `test-repeated` with its detail on both lines; and the test-level declaration pinned as well, in the set or in the `falsify` fixture. Place the canary before `leaked-rejection`, which stays directly after a canary that does not read detected and is never last. Mutations: `readRepeats(test) ??` dropped; the record's `repeats` dropped in `recordTest`; the facts' `repeats` dropped in `testFacts`. Re-anchor D3760 and D3765, which the fix broke. | CRITICAL, daemon-state, measured on both Vitest lines |
| G5  | `packages/daemon/test/falsify/defects.json`, records D3784 and D3785                                                                                                                 | The record's sentence does not say what its mutant does: under D3784's mutant the experiment still has no verdict, with the restored baseline's reason where the confirming run's belongs; D3785's mutant carries a count of zero, where the sentence says the count is not carried. | Reword each sentence to its mutant. No test changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | LOW, internal                                         |

### Completion Notes

Built by the dev session (threadId 587300be-5553-4116-abe2-dcffc3b4dd04) on 2026-09-30 between 22:33 and 23:30, in Tree 1 on `wt/1` from 799c43e8.

#### What was built

- `falsify/experiment-record.ts`: `FALSIFIER_VERSION` is 2. A run record holds, for each unhandled error, the run's modules whose file the worker that raised it was running (`unhandledErrorModules`, in the order of `unhandledErrors`). A detection's experiment record holds its confirming run. A job that ran holds one judgement per experiment, in the order given.
- `falsify/fact-types.ts` (new, not in the ticket's list): the fact types and their constants, with no runtime import, so the judge loads neither Vitest nor a file. Cleared by the orchestrator at 23:23.
- `falsify/run-facts.ts` (new): builds each experiment's facts from the job's raw records. It reads an error's fields as own properties, since a chai `AssertionError` crosses with no `constructor` of its own.
- `falsify/verdict.ts` (new): the judge. One reading of a run, `readRun`, serves the job's would-be detection check, the first run and the confirming run. The verdict and reason constants are not exported, since nothing in production reads them yet (C59); 3.4 exports what it reads.
- `falsify/falsify-workspace.ts`: the assertion error names as a parameter, the confirming run inside the gated `#experiment`, and `judgedJob`, which judges once the session has closed the instance. `#run` now reads the abort before it asks the stale-transform guard.
- `falsify/run-relay.ts` (new): the `RunRelay` reporter moved out of `falsify-workspace.ts` unchanged, which the confirming run and the judging had brought to about 490 of its 500 code lines. It holds 461 now.
- `daemon/executor-jobs.ts`, `daemon/executor.ts`, `daemon/executor-main.ts`: the `assertionErrors` field of the `falsify` request, the fourth argument of `Executor.falsify`, and the call.
- `packages/daemon/canaries/`: the config, `canaries.json`, two source modules and two canary modules, 22 canaries.

#### Names the build chose

Verdicts: `detected`, `survived`, `invalid-experiment`, `unclear`. No verdict is a judgement with no `verdict` member.

- No verdict (AC9): `interrupted`, `mutation-file-unreadable`, `anchor-count` (detail `count`), `baseline-unrecorded`, `run-unrecorded`, `confirming-run-unrecorded`, `restored-baseline-unrecorded`.
- Invalid experiment (AC6, in order): `no-probe-site` (detail `site`), `no-module`, `baseline-not-passed` (detail `state` and `mode`, absent when the baseline did not report the test), `baseline-not-clean`, `restored-baseline-not-passed`, `restored-baseline-not-clean`, `run-not-clean`, `module-failed`, `suite-error` (detail `suite`), `test-not-run` (detail `state`: `absent`, `skipped` or `pending`), `hook-not-passed` (detail `hook` and `state`, which is the recorded state or `not-recorded`), `test-repeated` (detail `repeats`; added by the review, orchestrator ruling of 00:34 on 2026-10-01), `site-not-executed` (detail `mutation`: `never-transformed`, or `not-applied` with `occurrences`; none when a transform applied), `reach-unknown` (detail `cause`).
- Unclear (AC8, in order): `not-an-assertion`, `unhandled-error`, `confirming-run-differed` (detail `confirming`, the reading of the confirming run alone), `next-run-unclean`, `job-unclean`.
- An error's kind is `assertion` (with a marker: `assertion-error-name`, `extended-matcher` or `declared-name`) or `other`.
- `canaries.json` holds `projectName` (the config names its project `canaries`), `assertionErrors`, and `canaries`: each an `id`, a `test` (`modulePath`, `namePath`), a `mutation` (`file` relative to the directory, `old`, `new`) and a `judgement` (`verdict`, and `reason` where it has one). Its order is the order the job runs them.

#### Decisions and answers

- Sanity check: five findings, all confirmed by the author at 22:40 and applied to the ticket by the author (Dev Notes § Sanity check). Built as the corrected ticket reads.
- A baseline's facts keep the run-wide `unhandledErrorCount` and add `countedUnhandledErrorCount` (those that count against the experiment) and `unnamedUnhandledErrorCount`, so one field name never means two things. The judge reads the counted one. AC1 asks for the counted count and the unnamed count; the run-wide one is extra.
- Question to the orchestrator at 23:21, from the adversarial review: an assertion that fails in a cleanup a `beforeEach` returns, in a fixture's teardown or in an `aroundEach` hook's teardown reads detected, as the fixture setup and `onTestFinished` cases the ticket already records do. Measured on a scratch set on 4.1.11 and 5.0.1: returned cleanup, fixture teardown, `onTestFinished` and fixture setup each read detected (hook states `{ beforeEach: "pass" }`, reach in the test, every error an `AssertionError`, confirmed). Ruling (orchestrator, 23:23): one known limit in ADR-0008 covering all five, no code. Not planned, recorded as the way to make it uniform if ever wanted: the reach setup file marks the test's error count at its `afterEach` phase, and a would-be detection needs the final count to equal it; a file-level `afterEach` runs first, not last, under `sequence.hooks: "list"`, and a fixture setup assertion would still read detected. The `returned-cleanup-assertion` canary pins the limit, so a Vitest release that starts recording a state there disagrees with the set.
- The ticket's three delegable groups were built alone as one chain (sanity F5).

#### Adversarial review (23:18)

One agent, the fourteen changed files, 12 findings.

- Fixed: the baseline's counted unhandled errors renamed (F2); the pairing guard in `experimentFacts` (F4); `Executor.falsify`'s docblock (F7); `#experiment` made private (F8); the header of `fact-types.ts`, the `InvalidOutsideRun` name, `PASSED` shared from `fact-types.ts`, `isTestModule` (F10 a to d); the header of `canaries/src/subject.mjs` and the declared name read from `canaries.json` (F11); the abort read before the stale-transform guard (F12). F1 went to the orchestrator, above.
- Discarded F3 (`errors: []` on a test Vitest gave no error list): the result was recorded and held no error, so an empty list states what the run held; absent stays for a result, a hook state or a reach the run did not record.
- Discarded F5 (an interrupted confirming run and an absent restored baseline should read `interrupted`): AC9 words each as one reason, and the facts carry the difference.
- Discarded F6 (do not run an experiment whose baseline did not end cleanly): AC4 keeps the gate at "the baseline passed the test", and a wider gate needs a new not-run reason on the record.
- Discarded F9 (each experiment walks the baseline's tests again): an in-memory walk bounded by the job's own baseline, small beside one experiment's run.
- Discarded F10 e (`unhandledErrors` and `unhandledErrorModules` are two lists to zip): one entry per error would reshape 3.2's `unhandledErrors` and break D3641's anchor.

Post-fix re-validation at 23:28 on the final tree: `bun x oxlint` over the changed files exit 0 with no warning, `bun x prettier --check` exit 0, `bun run typecheck` exit 1 with only the four test-file errors above (`@rt-test/core` and `rt-test` exit 0), `node scripts/check-defects.mjs` exit 0, `node scripts/check-line-citations.mjs` clean.

#### Acceptance evidence

Scratch drivers under `_agent-docs/.scratch/t3-3/` over the built daemon, every run through the run lease. Windows 11 and Linux (WSL clone `~/rt-test-t3-3` at 799c43e8 with the changed files copied in), Node 24.19, Vitest 4.1.11 and 5.0.1.

- AC1: on the final tree (23:29) each job's reply held 22 judgements for 22 experiments, `falsifierVersion` 2, and facts whose every key is a state, kind, name or count; a search of the serialized judgements for a message or stack found none. Traced: a job that did not read `ran` is returned unjudged.
- AC2: the `body-expect`, `extended-matcher` and `declared-error-name` canaries read detected by the three forms, and `undeclared-error-name` reads unclear. Traced: the names through `Executor.falsify`.
- AC3, AC5 to AC9: 68 hand-built fact cases through the built judge (`judge-cases.mjs`), each expected judgement derived from the criteria, 68 of 68 on the final tree. A baseline that leaks from one of two modules, on both lines: the error names the leaking module, that module's experiment reads `baseline-not-clean`, and the other module's detection reads detected with a counted count of 0 beside a run-wide count of 1.
- AC4: the five canaries whose run is a would-be detection each hold a confirming run, and no other experiment does. The abort outcome is owed a test.
- AC10: 22 of 22 canaries read the judgement `canaries.json` names, on 4.1.11 and 5.0.1, on Windows and on Linux, on the final tree (23:29). `bun x vitest list --filesOnly` lists 82 test files and no canary module (23:04). `bun x oxlint` and `bun x prettier --check` pass on the directory.

#### Known limits the build confirms or adds

- An assertion that fails outside the test's body where Vitest records no hook state (a fixture's setup or teardown, a cleanup a `beforeEach` returns, an `aroundEach` hook, an `onTestFinished` callback) reads as a failure in the body and can read detected (orchestrator, 23:23).
- A detection reads unclear when the run the job started next records any unhandled error, the restored baseline included, even one naming another module. Measured: in a workspace where one test module leaks in every run, the job's last detection reads `next-run-unclean`, and the same detection placed before another experiment of its own module reads detected.
- A module that throws while it loads reads `module-failed` (U1), and so does a module the record does not name at all.
- A suite error anywhere in the experiment's module reads `suite-error`, naming the first failing suite.

#### Change request candidates

None is a defect; each is a fork, with a recommendation.

- The next-run check counts every unhandled error, where a baseline's counts by the module it names. Making the next-run check count by module too would let the job's last detection stand beside an unrelated leak. Recommendation: leave it; the ticket rules that any unhandled error in the run that follows counts, and a suite that leaks in every run is already red under Vitest.
- An experiment whose baseline did not end cleanly, or holds a counted unhandled error, still runs, though it can only read invalid experiment. Recommendation: leave it until a job is slow enough to measure.
- The error-count mark described under Decisions, which would make a teardown assertion read invalid experiment. Not planned (orchestrator, 23:23).

#### Left for others

- README: no change. Nothing in production calls the job before 3.5, so no user-visible behavior moved; the `assertionErrors` member is 3.5's to document.
- The architecture text for § Falsification jobs and § Execution and falsification isolation, and ADR-0008's known-limit sentence, went to the orchestrator with the review transition.
- `_agent-docs/.scratch/t3-3/` (drivers, logs, summaries) and the WSL clone `~/rt-test-t3-3` stay until the orchestrator closes the lane.

### File List

- `_agent-docs/tickets/3-3-verdicts-from-facts.md` (created by create-ticket; edited by the author and by dev within its write scope)
- `packages/daemon/src/falsify/experiment-record.ts` (modified)
- `packages/daemon/src/falsify/falsify-workspace.ts` (modified)
- `packages/daemon/src/daemon/executor-jobs.ts` (modified)
- `packages/daemon/src/daemon/executor.ts` (modified)
- `packages/daemon/src/daemon/executor-main.ts` (modified)
- `packages/daemon/src/falsify/fact-types.ts` (created)
- `packages/daemon/src/falsify/run-facts.ts` (created)
- `packages/daemon/src/falsify/verdict.ts` (created)
- `packages/daemon/src/falsify/run-relay.ts` (created)
- `packages/daemon/canaries/vitest.config.mjs` (created)
- `packages/daemon/canaries/canaries.json` (created)
- `packages/daemon/canaries/body.canary.mjs` (created)
- `packages/daemon/canaries/hooks.canary.mjs` (created)
- `packages/daemon/canaries/src/subject.mjs` (created)
- `packages/daemon/canaries/src/loaded.mjs` (created)

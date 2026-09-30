# RT Test

RT Test runs a consumer's Vitest tests and falsifies them in place of coding agents, and answers queries about the results. These terms name what it tracks, so every plan doc, ticket, and rule uses the same word for the same thing.

## Language

### Results and runs

**Vitest workspace**:
One directory RT Test runs as its own Vitest instance: the consumer root or a package workspace that holds a Vitest configuration.
_Avoid_: project, package

**Package workspace**:
One directory RT Test treats as a package: the consumer root, or a directory the root `package.json` `workspaces` field lists, whether or not it holds a `package.json`. Every Vitest workspace is one, and the dependencies between them decide selection.
_Avoid_: package, project

**Test identity**:
The stable name RT Test gives one test: its Vitest workspace, Vitest project, module path, suite and test names, and its position among tests sharing those names.
_Avoid_: test id, test name

**Consumer**:
A project whose tests RT Test runs.
_Avoid_: target, host project

**Daemon**:
The local process that alone executes a started consumer's tests and answers queries about them.
_Avoid_: server, watcher

**Executor process**:
A child process of the daemon that runs one job, a discovery, a run or a dependency build, and ends with it; only an executor process hosts Vitest.
_Avoid_: worker, runner

**Confirmed start**:
The consumer root and each Vitest workspace, with the config file shown for it, that the user confirmed before a start. The daemon loads nothing outside it.
_Avoid_: trusted list, allowlist

**Input fingerprint**:
A digest of every input, the environment, and the runtime and tool versions that can change a test's result.
_Avoid_: hash, cache key

**Input**:
A file whose content RT Test treats as able to change a test's result.
_Avoid_: source, dependency

**Declared non-input**:
A file the consumer lists in `rt-test.json` as read by no test, so a change to it changes no input fingerprint and selects nothing.
_Avoid_: ignored file, excluded file

**Non-input variable**:
An environment variable whose value the input fingerprint leaves out, counting only whether it is set and whether it is empty: a session or process identifier on RT Test's fixed list, or one `rt-test.json` declares in `nonInputVariables`. A discovered workspace whose tests Vite can hand one to, through an env file's expansion or an env prefix, counts it by value.
_Avoid_: ignored variable, session variable

**Start environment**:
The copy of its environment the daemon takes as it begins serving: the input fingerprint counts it, and every executor process starts with it.
_Avoid_: live environment, environment snapshot

**Input revision**:
The number naming a worktree's inputs as the daemon last observed them in its current life, raised once for each batch of changes it observes.
_Avoid_: version, generation

**Reconciliation**:
Reading every input again to establish the current input fingerprints, without relying on change events.
_Avoid_: rescan, resync

**Edit**:
A change to an input that the daemon does not attribute to one of its own runs or discoveries.
_Avoid_: user change, manual change

**Run**:
One execution of a selection by the daemon, under its own run identity.
_Avoid_: job, pass

**Invalidated run**:
A run whose inputs changed while it ran, so none of its results become current.
_Avoid_: cancelled run

**Interrupted run**:
A run stopped before it finished, so each test it had not finished gets no outcome from it.
_Avoid_: cancelled run, aborted run

**Execution state**:
What the daemon is doing with a Vitest workspace: running it, holding it queued to run, holding it interrupted by a change until the next round decides it, or idle. It is independent of every result's outcome and freshness.
_Avoid_: status, activity

**Round**:
The daemon's decision, once the input revision has held still, its inputs have settled, its dependency build has ended, any rediscovery it needs has ended and no job begun at an earlier revision is in progress, of what to run at that revision; the selection over the paths changed since the previous round orders what it runs first and explains it. A round is pending until that decision is made, and held after a scheduling step fails until the daemon tries again.
_Avoid_: cycle, pass, tick

**Self-changing workspace**:
A Vitest workspace that became due three times in a row only through changes the daemon's own runs and discoveries made to the same input, which the daemon holds, running it no more until an edit reaches its inputs.
_Avoid_: looping workspace, flapping workspace

**Self-changing discovery**:
The discovery, when it became due three times in a row only through changes the daemon's own runs and discoveries made to the same input, which the daemon holds, discovering no more until an edit, while runs are planned from the discovery in effect.
_Avoid_: looping discovery

**Force-stopped run**:
An interrupted run whose Vitest workers were stopped without waiting, because the grace period after the interrupt passed with the run still going, so the project's `afterAll` hooks and teardown did not run.
_Avoid_: killed run

**Crashed module**:
A test module whose worker exited during a run, so none of its tests gets an outcome from that run.
_Avoid_: failed module

**Project**:
A consumer's repository, shared by every worktree checked out from it; outside a git repository, the consumer root itself.
_Avoid_: repo, package

**Worktree**:
One checked-out consumer root, to which results are scoped, so two worktrees of one project never answer for each other.
_Avoid_: checkout, clone

**Outcome**:
What a test did in its last run: passed, failed, skipped, error, or never run.
_Avoid_: result, status

**Result**:
A test's outcome bound to the run and input fingerprint that produced it.
_Avoid_: status

**Freshness**:
Whether a result still describes its test's current inputs.
_Avoid_: staleness, validity

**Current pass**:
A passed outcome whose freshness is current.
_Avoid_: green

**Selection**:
The tests a change requires running, each with its reason.
_Avoid_: affected tests, blast radius

**Widening**:
Adding tests to a selection because a dependency is uncertain.
_Avoid_: over-selection

**Broad fallback**:
A widening to a whole workspace or project, named with the input that triggered it.
_Avoid_: full run

**Duplicate execution**:
Running a test again while it holds a current result for the same input fingerprint.
_Avoid_: rerun

**Edit corpus**:
The committed synthetic consumer and the sequences of changes saved to it, each replayed against RT Test's own daemon beside a full run by plain Vitest, over which duplicate execution and selection misses are measured.
_Avoid_: test corpus, benchmark

**Selection miss**:
A failure that a full run of plain Vitest over the same input snapshot finds and the daemon's current results do not.
_Avoid_: missed test

**Wait**:
A query that returns once every test covering the given files has a current result or an explicit non-current state, or earlier as superseded or unsettled.
_Avoid_: block, poll

**Superseded**:
A wait's answer when a covering input changed after the call, naming the newer input revision to wait on.
_Avoid_: cancelled, timed out

**Unsettled**:
A wait's answer when its time limit passed before every covering test had a current result or an explicit non-current state, naming what each covering workspace is still doing.
_Avoid_: timed out, failed

**Cursor**:
The token a `changes` answer returns, naming a moment whose test standings the daemon recorded, so the next `changes` call reports only what changed since.
_Avoid_: checkpoint, bookmark, since-id

### Falsification

**Named defect**:
A specific wrong behavior a test is written to reject.
_Avoid_: bug id, test target

**Defect definition**:
The committed record of a named defect: its id, the behavior, the test identity, and the mutation.
_Avoid_: defect spec, manifest entry

**Author**:
The person or coding agent who writes tests and defect definitions and diagnoses survivors.
_Avoid_: user, developer

**Falsification**:
Running a test against its defect's mutation to prove the test rejects it.
_Avoid_: mutation testing, defect check

**Run facts**:
What the daemon records during a falsification run: failure phase, error kind, whether the mutated code was reached, and the baseline result.
_Avoid_: classification, message match

**Defect evidence**:
A falsification verdict bound to its test, mutation, inputs, and configuration.
_Avoid_: proof, kill record

**Survivor**:
A mutation its intended test did not reject.
_Avoid_: live mutant

**Anchor missing**:
The state of a defect whose mutation no longer matches the code it names.
_Avoid_: stale anchor, skipped defect

**Invalid definition**:
A defect definition RT Test cannot apply as written, such as one naming no discovered test, or a test it shares a name with.
_Avoid_: bad defect, broken spec

**Experiment**:
One run of a defect's test with its mutation applied, inside a falsification job.
_Avoid_: mutant run, trial

**Baseline**:
The unmutated run of a falsification job's tests before its experiments; the restored baseline repeats it after them.
_Avoid_: control run, clean run

**Confirming run**:
A second run of an experiment that would be a detection, which must fail the same way before the detection counts.
_Avoid_: retry, rerun check

**Reach probe**:
The recorder call a mutation's transform places at the mutated site, so an experiment records which tests executed the mutated code.
_Avoid_: coverage marker, reach flag

**Invalid experiment**:
An experiment whose run cannot say whether the test rejects the mutation, such as one whose test failed in a hook or never executed the mutated site.
_Avoid_: void, setup kill

**Unclear experiment**:
An experiment whose test failed in its own body but not at an assertion, or failed at an assertion and then passed its confirming run.
_Avoid_: unclassified, maybe-kill

**Eligible defect**:
A defect whose definition is valid, whose anchor matches, and whose test holds a current pass, so it can be falsified now.
_Avoid_: runnable defect, pending defect

**Canary fixture**:
A test that fails on purpose in one known way, so RT Test can check that it reads that failure's facts correctly on a Vitest version.
_Avoid_: selftest, probe

**Gap**:
A test with no defect, or code no named defect reaches.
_Avoid_: coverage hole

**Verified**:
Every defect definition in scope has current evidence that its test detects it.
_Avoid_: green, fully covered

### Suggestions

**Mechanical suggestion**:
A candidate mutation RT Test proposes for a gap, already checked against the current tests.
_Avoid_: auto-defect

**Agent suggestion**:
A defect and test a coding agent proposes from RT Test's gap report, then verified by RT Test.
_Avoid_: LLM defect, AI suggestion

**Accepted suggestion**:
A suggestion the author has added to the defect definitions; only this makes it a named defect.
_Avoid_: adopted, applied

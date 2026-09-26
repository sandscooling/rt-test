# RT Test

RT Test runs a consumer's Vitest tests and falsifies them in place of coding agents, and answers queries about the results. These terms name what it tracks, so every plan doc, ticket, and rule uses the same word for the same thing.

## Language

### Results and runs

**Vitest workspace**:
One directory RT Test runs as its own Vitest instance: the consumer root or a package workspace that holds a Vitest configuration.
_Avoid_: project, package

**Test identity**:
The stable name RT Test gives one test: its Vitest workspace, Vitest project, module path, suite and test names, and its position among tests sharing those names.
_Avoid_: test id, test name

**Consumer**:
A project whose tests RT Test runs.
_Avoid_: target, host project

**Daemon**:
The local process that alone executes a started consumer's tests and answers queries about them.
_Avoid_: server, watcher

**Input fingerprint**:
A digest of every input that can change a test's result.
_Avoid_: hash, cache key

**Run**:
One execution of a selection by the daemon, under its own run identity.
_Avoid_: job, pass

**Invalidated run**:
A run whose inputs changed while it ran, so none of its results become current.
_Avoid_: cancelled run

**Interrupted run**:
A run stopped before it finished, so each test it had not finished gets no outcome from it.
_Avoid_: cancelled run, aborted run

**Crashed module**:
A test module whose worker exited during a run, so none of its tests gets an outcome from that run.
_Avoid_: failed module

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

**Wait**:
A query that returns once every test covering the given files has a current result or an explicit non-current state.
_Avoid_: block, poll

**Superseded**:
A wait's answer when a covering input changed after the call, naming the newer input revision to wait on.
_Avoid_: cancelled, timed out

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

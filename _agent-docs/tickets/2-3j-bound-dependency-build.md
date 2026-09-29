# Ticket 2.3j: Bound the dependency build

## Ticket

As an agent whose runs wait for the daemon's dependency build,
I want a build that never ends, and a builds loop that stops working, each to end as a named failure that widens every workspace,
so that no run waits for a build forever, and no answer says a build is still running when none ever will.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: A dependency build that has not ended `DEPENDENCY_BUILD_BOUND_MS` after it began (a named bound, a target until measured) is ended, with every process it started, and recorded at the revision it began at as a failure of its own kind, `dependency-build-timed-out`, never as `dependency-build-failed`. While it is the latest build over the discovery in effect, every discovered workspace's fingerprint covers every input of the project and its own test modules, the log names the bound at warning level, and every answer carries the kind and its reason as its `inputsNotNarrowed` fact, in `--json` and in the CLI's text. A run waiting for that build proceeds once it is recorded. Only the next change of the input revision or a new discovery starts another build, never a retry of the same revision.
- [x] AC2: When the dependency builds stop working for any cause other than a stop (their rounds end by throwing), every discovered workspace's fingerprint covers every input of the project and its own test modules for the rest of the daemon's life, whatever discovery is in effect then, the log names the cause at warning level, and every answer carries the kind `dependency-builds-ended` and its reason as its `inputsNotNarrowed` fact, in `--json` and in the CLI's text. No answer then reads a workspace as waiting for a build, and no run waits for one.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. Ending a build's process tree is `Executor.abort`, which a stop already uses on a build (ticket 2.3e AC4).

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Before the first edit, re-read `daemon/dependency-builds.ts` (`DependencyBuilds.#build`, `start`, `#record`, `#endedAt`, `pending`), `inputs/narrowed-inputs.ts` (`EndedBuild`, `NarrowingState`, `QueryNarrowing`, `narrowingAt`), `query/answer.ts` (`InputsNotNarrowed` and its three kinds) and `Executor.abort` (`daemon/executor.ts`), as 2.3g landed them at 5b0a006.
- [x] (AC1, AC2) In `packages/daemon/src/query/answer.ts`, add the kinds `dependency-build-timed-out` and `dependency-builds-ended` to `InputsNotNarrowed`, each an exported constant beside `DEPENDENCY_BUILD_FAILED` (C3, C131); re-export both from `packages/daemon/src/client.ts` as the other three are. In `packages/cli/src/answer-text.ts`, give each its cause text in `NOT_NARROWED_CAUSES`, whose `Record` type already requires one per kind.
- [x] (AC1) In `packages/daemon/src/daemon/dependency-builds.ts`, bound each build: name `DEPENDENCY_BUILD_BOUND_MS` (a target, C3), take the bound as a `DependencyBuilds` option defaulting to it so a test can set a short one, and when a build has not ended by then, end it through `Executor.abort`, await its outcome, and record it at its revision as timed out with a reason naming the bound, whatever its job verdict: a timed-out build is recorded, never discarded, so the lifecycle's `#awaitBuild` stops waiting (`pending()` turns false at that revision) and the next round begins only at a new revision or discovery (`#endedAt`). A timed-out build whose job verdict is not fingerprinted (its inputs moved while it ran) still counts as a discard toward `discards().consecutive`, rather than resetting it as `#record` does, so a run waiting while the revision keeps moving proceeds after `DISCARDS_A_RUN_WAITS_THROUGH`, as under 2.3g's 18:03 ruling. The abort's own outcome, whose reason names a stop (2.3e AC4), is never what the record carries. Clear the timer when the build ends first and on stop, so a stop's abort is never read as a timeout.
- [x] (AC1) In `packages/daemon/src/inputs/narrowed-inputs.ts`, let an ended build that failed carry its kind, failed or timed out, and let `narrowingAt` map it, and a `lastFailure` it keeps while `building`, to the matching `inputsNotNarrowed` kind rather than always `DEPENDENCY_BUILD_FAILED`.
- [x] (AC2) In `dependency-builds.ts` `start()`, when the rounds reject, record that the builds ended with the error's text, so the builds' narrowing reports it for every discovery from then on, including one `use` hands them later, and resolve every wait (it already does); in `narrowed-inputs.ts`, let `QueryNarrowing` carry that and `narrowingAt` answer `widened` with `dependency-builds-ended` ahead of every other state. A stop that ends the rounds is not this: a stop sets `#stopped` before they end.
- [x] (AC1, AC2) Log each at warning level once, as `#record` logs a failed build: the timed-out build with its revision and the bound, and the ended builds with the cause (C32), replacing the log `start()`'s catch already writes rather than adding a second.
- [x] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [x] (Support) Lint and typecheck: `bun x oxlint` over the changed files, `bun run --filter @rt-test/daemon typecheck` and `bun run --filter rt-test typecheck` (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `DependencyBuilds` (`daemon/dependency-builds.ts`): `#build`, `#record` (which already logs a failure and resolves every wait), `#endedAt` and `pending()`, so a recorded timeout releases the lifecycle's `#awaitBuild` with no change to the lifecycle.
- `Executor.abort` (`daemon/executor.ts`): ends a build's process tree at once (ticket 2.3e AC4).
- `EndedBuild`, `NarrowingState`, `QueryNarrowing`, `narrowingAt` (`inputs/narrowed-inputs.ts`): where a build's outcome becomes each workspace's narrowed, building or widened inputs.
- `InputsNotNarrowed` and `DEPENDENCY_BUILD_FAILED`, `NO_SELECTION_INPUT`, `SELECTION_REFUSED` (`query/answer.ts`), their re-exports in `client.ts`, and `NOT_NARROWED_CAUSES` (`cli/src/answer-text.ts`): the fact every answer already carries and its CLI line.

### Must Create

- `DEPENDENCY_BUILD_BOUND_MS` and the build's timer (AC1).
- The kinds `dependency-build-timed-out` and `dependency-builds-ended`, and the narrowing state that carries each (AC1, AC2).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Ticket 2.3g (done at 5b0a006) makes a run wait for the dependency build at its revision. A build has no time bound, so one that never ends (a parser loop) holds the next run until the daemon stops, and a builds loop that throws leaves every answer reading "building" for the rest of the daemon's life (2.3g review T7). This ticket closes both. It builds before 2.3f, whose scheduler waits on the builds each round (orchestrator, 20:41). It retires change request #43 and 2.3g review T7.

Requirements this ticket serves (`docs/requirements.md`):

- "FR6: Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current." (AC1, AC2: a widened workspace stales on any edit)
- "NFR3: Never report a result as current unless its stored input fingerprint matches the current inputs." (AC1, AC2)

Rule clauses the criteria rest on:

- AGENTS.md § Product guarantees: "Widen selection when dependency information is uncertain." (AC1, AC2)
- AGENTS.md § Product guarantees: "Explain each selection and each broad fallback." (AC1, AC2: each widening names its kind and reason)
- AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states." (AC1, AC2: two kinds, apart from a failed build)
- 2.3g Q2 (orchestrator, 05:45): "a failed build widens every workspace to the whole project's inputs, the log names why, and the next input change or discovery retries it, never a timer or a loop". AC1's bound is a bound on one build, not a retry timer: the retry stays on the next revision or discovery.

Glossary (`docs/glossary.md`), verbatim:

- **Widening**: "Adding tests to a selection because a dependency is uncertain."
- **Broad fallback**: "A widening to a whole workspace or project, named with the input that triggered it."

#### Orchestrator rulings

- 20:38 dispatch: fold #43 (a build with no time bound holds the next run until the daemon stops) and 2.3g review T7 (a builds loop that throws leaves a false "building" reason) into 2.3f, a build past a named bound ending as a failure of its own kind, never 2.3g's build failure, widening to the whole project and named in the log and every answer.
- Ticket review (create-ticket 6c, 20:44 to 20:45): 5 findings, all applied. F1 gave the bound a test seam; F2 replaces the rejection's existing log line; F5 widened the broken-tests method; F3 and F4, questions, were settled by create-ticket from the evidence (§ Decisions taken here).
- 20:41, on create-ticket's sizing (with the fold-in, 2.3f measured about 20 raw files and 26 estimated): a new ticket, 2.3j "Bound the dependency build", built before 2.3f, with two kinds, `dependency-build-timed-out` (retried on the next revision change or new discovery) and `dependency-builds-ended` (terminal for the daemon's life), each widening every workspace and named in the log and every answer (C131); the bound a named constant labeled a target. Reason: 2.3f's scheduler waits on the builds each round, so this must land first, and it keeps 2.3f within the limits.

#### Decisions taken here

- **The bound's value is 120,000 ms, a target.** A real build parses every source file of the consumer once; the 2.3g dev measured the one `selectTests` call at 2.2 s over 50k inputs, and parsing costs more, so the bound sits well above a large consumer's build and far below a stop. 2.5's corpus measures it; a consumer whose builds pass it widens, never narrows wrongly.
- **A timed-out build is recorded, never discarded.** A discarded build is rebuilt at the current revision at once, so a build that never ends would cost the bound again at once, forever. Recorded at its revision, it lets `#awaitBuild` release and waits for the next revision or discovery, as a failed build does.
- **A timed-out build at a moved revision counts toward a run's wait limit** (review F3, 20:45). Recording it resets the consecutive discards in `#record`, so a revision that moves about once per bound would chain timed-out builds with no limit on a run's wait; counting it keeps 2.3g's 18:03 limit of two in a row.
- **Two kinds added to `inputsNotNarrowed.kind` do not raise `CLI_JSON_SCHEMA_VERSION`** (review F4, 20:45; C151, C38). The fact's presence says the inputs are not narrowed, and `kind` only names why, so a consumer reading an unknown kind still reads the widening right; no existing value changes meaning. JSON consumers checked: `rg -n inputsNotNarrowed packages` finds only the daemon's producers and the CLI's text, whose `Record` over the kinds fails to typecheck until both are given; the agent hook (2.7) that will read `--json` is unbuilt.
- **The ended builds widen every discovery.** After the rounds end nothing builds again in the daemon's life, so no later discovery can narrow either; a new discovery must not read as building.

#### Design notes

- **Why the lifecycle needs no change.** `#awaitBuild` waits while `pending()`, which turns false once a build is recorded at the current revision (`#endedAt`) or the builds are stopped (`#stopped`, which `start()`'s rejection already sets). AC1 and AC2 only change what is recorded and what `narrowingAt` answers.
- **The abort's reason.** `Executor.abort` during a build settles the job with a stop's reason (2.3e AC4, C131). A timeout records its own reason, so no answer reads a timed-out build as a stop.
- **Scope of the analysis.** Analyzed: a build that never ends, one that ends just before the bound, a stop during a build, a timeout while the revision moves, and rounds that throw. Not analyzed: the bound's cost on a real large consumer (2.5's corpus), and scheduling rounds around a timed-out build (2.3f).

#### Pending siblings and their routing

- **2.3f** (backlog, builds after this ticket): its scheduler waits on the builds each round and reads `inputsNotNarrowed`'s kinds for its logged selection; it writes `narrowed-inputs.ts` (a method on `Narrowing`) after this ticket.
- **2.3i** (backlog): shows the schedule in every answer and takes the not-narrowed kinds from this fact, both new kinds included.
- **2.4b** (ready-for-dev, builds after 2.3i): reads `narrowed-inputs.ts`.

#### Sizing

About 10 raw files and 13 estimated; code units 3 (2 criteria plus validation). Production: `daemon/dependency-builds.ts`, `inputs/narrowed-inputs.ts`, `query/answer.ts`, `client.ts`, `cli/src/answer-text.ts`. Tests, for create-tests: `packages/daemon/test/lifecycle.test.ts` (2.3g's build tests and their stand-in build executor), `packages/daemon/test/query.test.ts`, `packages/cli/test/cli.test.ts`, and the two `defects.json` beside them. Over 10 estimated, so dev delegates in two groups: the daemon side (`dependency-builds.ts`, `narrowed-inputs.ts`, `answer.ts`, `client.ts`), then the CLI text.

#### Current structure of the modified files

As of 5b0a006.

- `packages/daemon/src/daemon/dependency-builds.ts` (300 lines): `DependencyBuilds` with `use`, `start` (runs `#run`, whose rejection is caught and logged, then sets `#stopped` and resolves every wait), `narrowing()`, `pending()`, `discards()`, `ended()`, `stop()`; `#build` awaits `executor.buildDependencies(...)` with no bound, then `endJob`, then discards or `#record`s; `#record` sets `#state.latest` and `lastFailure` and logs a failure at warning level.
- `packages/daemon/src/inputs/narrowed-inputs.ts` (227 lines): `EndedBuild` (`built: true` with a `Narrowing`, or `built: false` with a `reason`), `NarrowingState`, `QueryNarrowing { discoveryId, state }`, and `narrowingAt`, which answers `building` for a state with no build at the revision, `widened` with `NO_SELECTION_INPUT` or `DEPENDENCY_BUILD_FAILED`, or `narrowed`.
- `packages/daemon/src/query/answer.ts`: `DEPENDENCY_BUILD_FAILED`, `NO_SELECTION_INPUT`, `SELECTION_REFUSED` and `InputsNotNarrowed { kind, reason }`.
- `packages/cli/src/answer-text.ts`: `NOT_NARROWED_WARNING` and `NOT_NARROWED_CAUSES: Record<InputsNotNarrowed["kind"], string>`.
- `packages/daemon/src/client.ts`: re-exports the three kinds.

#### Existing tests this change breaks

- `packages/daemon/test/lifecycle.test.ts`: 2.3g's build tests drive a stand-in build executor; one whose build never settles now ends at the bound, so a test that relied on a build hanging until a stop needs the bound shortened or the stop to come first.
- `packages/daemon/test/query.test.ts` and `packages/cli/test/cli.test.ts`: only where they enumerate the not-narrowed kinds.
- Records in `packages/daemon/test/defects.json` anchored in `dependency-builds.ts` and `narrowed-inputs.ts`, and in `packages/cli/test/defects.json` anchored in `answer-text.ts`, keep their `old` text or are re-anchored; `test:defects:changed` re-proves them. `packages/daemon/test/defects.json` is held by the Fixes-tree lane t-bare-waits for one record, free before this ticket's tests stage (orchestrator, 20:41).
- The typecheck reports each place that builds an `EndedBuild` or `QueryNarrowing` by hand (P14).
- Any test asserting the log line `start()`'s catch writes when the rounds reject; dev confirms the list with `rg` over `packages/*/test` for the three existing kind constants and that log text.

#### Doc text

A draft for the orchestrator, final wording to follow the build.

- `docs/architecture.md`, the input tracker paragraph's build sentences: add "A build that has not ended 120 s after it began (a target) is ended and recorded as timed out, which widens every workspace as a failed build does, and the next change of the input revision or a new discovery builds again. If the builds stop working for any cause other than a stop, every workspace covers the whole project's inputs for the rest of the daemon's life, and every answer says so."
- `README.md`, the line listing what every answer gives: the not-narrowed fact gains its two new causes, a build that timed out and builds that ended. Dev reports the exact text.

#### Previous ticket

2.3g (done at 5b0a006): the per-revision dependency builds, `#awaitBuild` through at most two discards (18:03), no build while the tracker cannot vouch for its inputs (17:42), `inputsNotNarrowed` with three kinds, and `Narrowing`, which decides each workspace's inputs with one `selectTests` call.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3j, § Ticket 2.3g, § Ticket 2.3f.
- Ticket 2.3g (`_agent-docs/tickets/2-3g-narrow-fingerprints.md`), its review's T7, and change request #43.
- Ticket 2.3e (`_agent-docs/tickets/2-3e-dependency-build.md`) AC4: an abort ends a build at once, with a stop's reason.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C14,C30,C32,C38,C39,C46,C48,C55,C113,C126,C131,C151,C157,C160 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P14,P16,P17,P18,P19,P21 -->

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
sizing_ac_count: 3
files_to_modify:
  - packages/daemon/src/daemon/dependency-builds.ts
  - packages/daemon/src/inputs/narrowed-inputs.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/client.ts
  - packages/cli/src/answer-text.ts
files_to_create: []
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 67c2e8e0-826e-4bbf-9c8a-52da2839e4fa

#### Test Files This Change Broke

- `packages/daemon/test/query.test.ts` (typecheck): `narrowingOf` (line 815) builds a `QueryNarrowing` with no `buildsEnded`; `failedAt` (lines 835 and 836) and the case at lines 970 and 971 build a failed `EndedBuild` with no `kind` and a `lastFailure` as a string, where it is now an `InputsNotNarrowed`.
- `packages/daemon/test/lifecycle.test.ts`: `rg` over `lastFailure` finds no hand-built state there, and it typechecks, but 2.3g's build tests use a stand-in build executor: one whose build never settles now ends at the bound (120,000 ms unless the test passes `boundMs`).
- `packages/daemon/test/defects.json` mentions `lastFailure` in a record anchored in `narrowed-inputs.ts` (line 4703 to 4718, the `latest.reason` line): its `old` text still matches, since only the `kind` in the object changed, so confirm it by id.
- No test asserts the old log text `the dependency builds failed`: `rg` finds it only in the source.

#### ACs Owed a Test

- [x] AC1: a build that never ends is ended at `boundMs`, recorded as `dependency-build-timed-out` at its revision, releases a waiting run, and starts no second build at the same revision; a timed-out build whose inputs moved counts as a discard.
- [x] AC2: rounds that throw give `dependency-builds-ended` for every discovery, including one `use` hands the builds later, and no wait outlasts them; a stop is not read as this.

#### Tests Owed

- The abort's own outcome, which names a stop, is never the record's reason (`#recordTimedOut` writes the bound's reason).
- A build that ends with `ended: true` just as the timer fires records as an ordinary build, not a timeout (`timedOut && !outcome.ended`, review F1).
- `lifecycle.ts` `#queryInputs` passes `buildsEnded` through with the stored discovery's id: an answer read with a stored discovery still says `dependency-builds-ended`.
- The CLI's text for both new kinds (`NOT_NARROWED_CAUSES`) and `--json` `inputsNotNarrowed.kind` for both.

### Tests Record

Tests session: threadId b3763bc5-e189-4a2a-8379-5987770acd3e

#### Named Defects

- D2579: a build that timed out is recorded as a failed build (AC1)
- D2580: the default bound is 120000 ms, pinned at 119999 and 120000 (AC1)
- D2581: the bound records a timeout without ending the build's processes (AC1)
- D2582: a run waiting for a build that never ends begins once the bound has ended it (AC1)
- D2583: a timed-out build is recorded at another revision, so the same revision is built again (AC1)
- D2584: a timed-out build stays ended after the revision moves, so no later change starts a build (AC1)
- D2585: a timeout with moved inputs restarts the discards in a row instead of extending them (AC1)
- D2586: a timeout with moved inputs counts as no discard (AC1)
- D2587: a timeout with steady inputs counts as a discard (AC1)
- D2588: the recorded reason does not name the bound (AC1)
- D2589: the abort's own stop reason is what the record carries (AC1)
- D2590: a build that produced its dependencies as the timer fired is recorded as a timeout (AC1)
- D2591: the bound's timer is left running after its build ends (AC1)
- D2592: a timeout over a replaced discovery is recorded under the old discovery, so the new one never builds (AC1)
- D2593: a timeout is logged as a failed build (AC1)
- D2594: while the build after a timeout runs, answers name the last build as failed (AC1)
- D2595: builds whose rounds threw record nothing, so answers read building (AC2)
- D2596: the reason recorded for the builds' end leaves out the error's text (AC2)
- D2597: a discovery handed to the builds after their end clears it, so it reads building (AC2)
- D2598: a run already waiting is left waiting when the rounds threw (AC2)
- D2599: a stop that ends the rounds is read as the builds ending (AC2)
- D2600: the builds' end is logged as an error entry, not at warning level (AC2)
- D2601: a query drops the builds' end when it builds its view with the stored discovery's id (AC2)
- D2602: a narrowing built at the current revision is still used once the builds ended (AC2)
- D2603: the human warning names a timed-out build as a failed build (AC1)
- D2604: the human warning names the ended builds as a failed build (AC2)
- D2605: the kind of a timed-out build is spelled other than `dependency-build-timed-out` in `--json` (AC1)
- D2606: the kind of the ended builds is spelled other than `dependency-builds-ended` in `--json` (AC2)
- D2607: the builds do not read as stopped once their rounds threw before any build was recorded, so a run that begins waiting afterward waits for good (AC2, review G1)
- D2609: an error the rounds throw after a stop is dropped with no log entry (AC2, review G3)
- D2610: a timed-out build whose inputs moved counts as discarded with no log entry naming it (AC1, review G4)
- Re-anchored to the source the bound changed and proven by id: D2510, D2512, D2515, D2516 (its mutation now records a failed build with its kind), D2527 (its mutation now returns `building(revision, state.lastFailure)`, since the local it named is gone), D2528, D2536.
- Re-anchored after the review's fixes, keeping each defect sentence: D2580 (F6), D2583, D2585, D2586, D2587 (F3, into the rewritten `#recordTimedOut`), D2599 (F2, now removes the whole stopped branch), D2604 (F1, its expected line and `old` take the new cause text), and 2.3g's D2558 (F3 moved the reset of the discards in a row into `#record`'s default parameter).
- `#### Tests Owed`, all covered: the abort's outcome never the record's reason (D2589), a build ending as the timer fires (D2590), `#queryInputs` passing `buildsEnded` through (D2601), the CLI text for both kinds (D2603, D2604) and `--json` for both (D2605, D2606).

#### Deliberately Untested

- `packages/daemon/src/daemon/dependency-builds.ts` `stop()`'s `clearTimeout(this.#boundTimer)`: a stop's abort settles the build, whose `.finally` clears the same timer before any timer can fire, so no test can observe its removal.
- `packages/daemon/src/client.ts` re-exports of the two kinds: D2605 and D2606 import them from `@rt-test/daemon/client`, so a dropped export fails there.

### Review Record

Review session: threadId d582f90b-6b71-4184-816d-5139d2fc3552

Rulings taken in review (rt-t2-3j-review, 21:39):

- CLI cause wording, asked by the tests session: `dependency-build-timed-out` keeps "the last dependency build timed out". `dependency-builds-ended` becomes "the dependency builds stopped working for the rest of the daemon's life", since "ended" reads as a build finishing normally and the state lasts until the daemon restarts.
- AC1's "while it is the latest build over the discovery in effect" reads at the current input revision, as 2.3g AC3 has it: after a timeout at revision N, revision N+1 has no fingerprint while its build runs, carrying the timed-out fact, exactly as after a failed build (D2594). Not a defect.

Fixes applied in review:

- F1 `packages/cli/src/answer-text.ts`: the ended builds' cause text, per the ruling above.
- F2 `packages/daemon/src/daemon/dependency-builds.ts` `start()`: an error the rounds throw after a stop is logged through `log.error` instead of dropped (C30); the tracker resolves `settled()` and `changed()` on stop, so such a throw is a bug.
- F3 `dependency-builds.ts` `#recordTimedOut`, `#record`: a timed-out build's discards are passed into `#record` and set before any wait resolves, and a timed-out build whose inputs moved logs that it counts as discarded.
- F4 `packages/daemon/src/inputs/narrowed-inputs.ts`: `lastFailure` takes only a build failure kind.
- F5 docblocks: `DependencyBuilds` (an overtaken build is discarded unless the bound ends it first), `#endedBy` and `QueryNarrowing.buildsEnded` (undefined when a stop ended the rounds), `AnswerContext.inputsNotNarrowed` shortened.
- F6 `DEPENDENCY_BUILD_BOUND_MS` is no longer exported; nothing imported it.

Tech debt, undisposed:

- T1 `packages/daemon/src/inputs/narrowed-inputs.ts` `BuildFailureKind` and `packages/daemon/src/query/answer.ts` `InputsNotNarrowed["kind"]` each list `DEPENDENCY_BUILD_FAILED` and `DEPENDENCY_BUILD_TIMED_OUT`. The typecheck ties them (a build kind missing from the answer's union fails `#record`), but the pair is spelled twice; declaring `BuildFailureKind` in `answer.ts` and using it in the union would state it once.
- T2 `packages/cli/test/cli.test.ts` `freshnessOf` carries two stacked docblocks; only the second attaches.

#### Test Coverage Gaps

- G1 (AC2, MEDIUM) `packages/daemon/src/daemon/dependency-builds.ts` `start()`'s `.finally`: "After the builds' rounds end by throwing with no build recorded at the current revision, `pending()` stays true, so a run that begins waiting after the end waits for good." Mutation: drop `this.#stopped = true;` from the `.finally`. D2598 checks only a wait registered before the end. Expected test: rounds throw before any build at the current revision, then a fresh `builds.ended()` resolves at once (or a lifecycle run begins).
- G2 (F1, fix-caused) D2604: the cause text is now "the dependency builds stopped working for the rest of the daemon's life"; update the test's expected line and the record's `old`.
- G3 (F2, LOW): "An error the builds' rounds throw after a stop is dropped with no log entry." Mutation: remove the `log.error` call in `start()`'s stopped branch. Re-anchor D2599, whose `old` was `if (this.#stopped) return;`.
- G4 (F3, LOW): "A timed-out build whose inputs moved counts as a discard with no log entry naming it." Mutation: remove the `timed out while its inputs moved` log entry in `#recordTimedOut`. Re-anchor D2583, D2585, D2586 and D2587 to the rewritten `#recordTimedOut`, keeping each defect sentence.
- G5 (F6, fix-caused) D2580: re-anchor `old` to `const DEPENDENCY_BUILD_BOUND_MS = 120_000;`.

Test-file clarity, optional: `packages/daemon/test/query.test.ts` `failedAt`'s and `rebuildingAfter`'s `kind` parameters are only ever given `dependency-build-failed`; D2602 repeats `builtAt`'s defaults to reach its fourth positional `buildsEnded`, where `{ ...builtAt(3), buildsEnded: reason }` would read plainer.

### Completion Notes

Built 2026-09-28 by the dev session, as one typecheck-atomic group (a required field on `QueryNarrowing` and `EndedBuild` leaves the tree uncompilable until every producer is updated), no delegation.

- Unverified assumptions: none listed; `Executor.abort` on a build ends its process tree at once (`packages/daemon/src/daemon/executor.ts` `abort`, the `#buildRecord` branch).
- Ticket sanity check: no findings.
- `DEPENDENCY_BUILD_BOUND_MS = 120_000` is exported from `dependency-builds.ts`, and `DependencyBuildParts.boundMs` is the test seam.
- A file the ticket did not list: `packages/daemon/src/daemon/lifecycle.ts` `#queryInputs` built a `QueryNarrowing` by hand from the stored discovery, which would have dropped `buildsEnded`; it now spreads `builds.narrowing()` and overrides only `discoveryId`. Without it AC2 would fail for any answer read with a stored discovery.
- `lastFailure` is now an `InputsNotNarrowed` (kind and reason) rather than a string, and a failed `EndedBuild` carries `kind` (`BuildFailureKind`), so both map to the matching answer kind.
- A timed-out build whose discovery was replaced while it ran is discarded, as any build is (recording it would overwrite the new discovery's state).
- Adversarial review: 4 findings (F1 a build that produced dependencies just as the timer fired was recorded as a timeout, now only `!outcome.ended`; F2 to F4 docblocks and a duplicated bound expression). All fixed.
- Gates: `bun x oxlint` over the six changed files exit 0; `bun run lint` exit 0; `bun x prettier --check` exit 0; `bun run --filter rt-test typecheck` exit 0; `bun run --filter @rt-test/daemon typecheck` exit 1 with five errors, all in `test/query.test.ts` (listed under Test Files This Change Broke); `node scripts/check-line-citations.mjs` clean.
- README: the not-narrowed sentence (line 68) needs its two new causes; text reported to the orchestrator, who owns the file.
- Out-of-scope candidates: none.

### File List

- packages/daemon/src/daemon/dependency-builds.ts (modified)
- packages/daemon/src/inputs/narrowed-inputs.ts (modified)
- packages/daemon/src/query/answer.ts (modified)
- packages/daemon/src/client.ts (modified)
- packages/daemon/src/daemon/lifecycle.ts (modified)
- packages/cli/src/answer-text.ts (modified)
- packages/daemon/test/lifecycle.test.ts (modified by create-tests)
- packages/daemon/test/query.test.ts (modified by create-tests)
- packages/daemon/test/defects.json (modified by create-tests)
- packages/cli/test/cli.test.ts (modified by create-tests)
- packages/cli/test/defects.json (modified by create-tests)

- _agent-docs/tickets/2-3j-bound-dependency-build.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3j added, § Ticket 2.3f's order, under the orchestrator's 20:41 grant)
- _agent-docs/sprint-status.yaml (2-3j-bound-dependency-build added, under the orchestrator's 20:41 grant)

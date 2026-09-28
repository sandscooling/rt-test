# Ticket 2.3i: Show the schedule in every answer

## Ticket

As an agent, or the hook and `wait` that answer for one, asking the daemon about my tests,
I want every answer to say what the daemon is doing with each workspace and why, and what the latest selection chose and why,
so that I can tell a stale result whose rerun is on its way from one nothing will run, and trust why a workspace was or was not run.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: Every summary and path-status answer, in `--json` and in the CLI's text, carries each confirmed workspace the discovery in effect lists, with exactly one execution state: `running`; `queued`, with every reason it is due, in this order (changed paths selected it, naming them up to the bound AC2 names and counting the rest, or a broad fallback, naming its trigger; its last run was interrupted by a change, naming the paths up to the same bound and counting the rest; its latest run is invalidated; it was never run; its latest run was stored in an earlier daemon life or under another adapter version; it is retried after a failure or a job that stored nothing; or its latest run was stored not fingerprinted for another reason, naming it); `interrupted`, from the moment a change interrupts its run until a round queues it again; or `idle`. An idle workspace whose results are not current says why: a round is pending (the quiet window, the settling of the inputs, a dependency build or a rediscovery has not ended), a retry is pending (ticket 2.3f's periodic retry of a `failed` or nothing-stored job), or no run is coming until the next input change (ticket 2.3f AC2: it already ran at this revision and list of test modules); one whose results are current says nothing more. A workspace's execution state never changes its outcome or freshness counts.
- [ ] AC2: Every answer also carries the explanation of the latest round's selection, as ticket 2.3f logs it: the input revision it was made at; for each changed path, the workspaces it selected, each with one chain of reasons, or why it selected none; each broad fallback with its trigger and scope; and the selected and total test and workspace counts, each saying whether it is complete. When the latest round made no selection, the answer says why instead: the dependency build failed, the discovery yields no selection input, selection refused the change, the round followed a start, or the round had no changed path (a retry or a rediscovery alone); and before any round has ended in this daemon life, it says so. An answer lists at most a bounded number of changed paths, a named constant, and counts the rest; the counts always cover every changed path.
- [ ] AC3: A workspace whose latest stored run was stored not fingerprinted because an input changed, or an event named one, while it ran reads as invalidated in every answer's latest-run facts for it, with the reason the verdict gave, from the moment it is stored until a later run of that workspace is stored or the daemon stops. A run stored not fingerprinted for another reason (its inputs were unsettled when it started, a cause that names no path such as a watcher failure or an input set that could not be established, a stop) is not called invalidated. The label is held in memory only and nothing new is written to the store; after a restart the run reads as not current, as today, and ticket 2.3f runs it again.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read the landed code of tickets 2.3f and 2.3h (`daemon/scheduler.ts`: its queue, the reason each workspace is due, the round's selection, the interruption) and 2.3g's answer fact beside `nonInputsUnusable`, and confirm the names this ticket uses.
- [ ] (AC1, AC2) In `packages/daemon/src/query/answer.ts`, add to `AnswerContext` the schedule: one entry per confirmed workspace with its execution state and, for `queued`, its due reason's kind and detail, and for an idle workspace that is not current, why no run is coming; and the latest round's selection explanation or why it made none, taking the failed-build and no-selection-input kinds from 2.3g's input fact rather than declaring a second enumeration of them (C14). Name each state and reason kind as an exported constant with a members record, as `TEST_STATES` is (C3, C14). Take the explanation's shapes from `selection/selection-types.ts` (`ChangedPathReport`, `BroadFallback`, `SelectionCounts`) rather than restating them (C14), bounding the changed-path list by a named constant with a count of the rest (C22, C24). Keep `activity`, whose meaning does not change, so the additions are optional or new fields and `CLI_JSON_SCHEMA_VERSION` stays (C151); a field whose meaning changes would raise it.
- [ ] (AC1, AC2, AC3) In `packages/daemon/src/daemon/scheduler.ts` (2.3f, 2.3h), expose the schedule the answers read: each confirmed workspace's execution state and due reason, the interrupted state from 2.3h's interruption until a round queues the workspace again, each idle workspace's pending-round, pending-retry or no-run reason (AC1), the latest round's selection or why none, and the invalidated label per workspace (AC3), held in memory and cleared when a later run of the workspace is stored. The invalidated label comes from the verdict at storage, only for a verdict whose reason is a change while the run ran (2.3h AC1), never for an unsettled start, a non-path cause or a stop (C131). Reading the schedule starts nothing and changes nothing (a query starts no job, `server.ts` `DaemonHandlers`).
- [ ] (AC1, AC2, AC3) In `packages/daemon/src/daemon/lifecycle.ts`, pass the schedule into the view the answers read (`DaemonView`, `#view()`), and in `packages/daemon/src/query/summary.ts` `queryBasis`, copy it into every answer's context; add `invalidated` with its reason to `LatestRunFacts` for the workspace the label names. `path-status.ts` answers through the same `queryBasis`. The schedule and the invalidated label sit beside the counts and feed no outcome or freshness count (C119, C120).
- [ ] (AC1, AC2, AC3) In `packages/cli/src/answer-text.ts` `contextLines`, render each workspace's execution state and reason, one line each, and the latest selection: the input revision it was made at, its changed paths with what each selected or why it selected none, the fallbacks, and the counts with their completeness, bounded as the answer is, or why the round made no selection; in `packages/cli/src/commands/summary.ts`, show a latest run's invalidated label and reason beside its status. Every reason goes through `firstLine`, as today.
- [ ] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files, `bun run --filter @rt-test/daemon typecheck` and `bun run --filter rt-test typecheck` (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `AnswerContext`, `LatestRunFacts`, `activityText`, the state constants and their members records (`query/answer.ts`): where every answer's context lives and how its enumerations are named.
- `queryBasis` (`query/summary.ts`), which composes every summary and path-status context once; `DaemonView` and `#view()` (`daemon/lifecycle.ts`), which carry the daemon's side into it.
- `ChangedPathReport`, `PathSelection`, `SelectionReason`, `BroadFallback`, `SelectionCounts`, `TestCount` (`selection/selection-types.ts`): the explanation's shapes (C14).
- `contextLines`, `firstLine`, `oneLine`, `INDENT` (`cli/src/answer-text.ts`): the text renderer and its reason cutting.
- 2.3f's and 2.3h's scheduler state (`daemon/scheduler.ts`): the queue, each due reason, the interruption, the round's selection.

### Must Create

- The schedule and selection-explanation fields of `AnswerContext`, their constants, and the invalidated field of `LatestRunFacts` (AC1 to AC3).
- The scheduler's read of its own state, and the in-memory invalidated label (AC3).
- Their text lines in the CLI.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The third of the three tickets the unsplit 2.3f became (orchestrator, 2026-09-28 06:10). Ticket 2.3f schedules discoveries and runs of what is not current and logs each round's selection; ticket 2.3h judges a run by its workspace's inputs and interrupts one a change inside them touched; this ticket puts both into every answer. Build order: 2.3d, 2.3e, 2.3g, 2.3f, 2.3h, 2.3i. Tickets 2.4b (`wait`) and 2.7 (the agent hook) read what it adds.

Requirements this ticket serves (`docs/requirements.md`):

- "FR5: Answer summary and `status <path>` queries through a CLI with versioned `--json` output, reporting counts per state for files and folders, without starting a test." (AC1, AC2, AC3)
- "FR7: Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts." (AC2)

Rule clauses the criteria rest on:

- AGENTS.md § Product guarantees: "Keep outcome, freshness, execution state, and falsification evidence independent." (AC1: the execution state is its own field, and changes no count)
- AGENTS.md § Product guarantees: "Explain each selection and each broad fallback. Report selected and total test counts." (AC2)
- AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states." (AC1, AC3)
- `docs/architecture.md` § State dimensions: "Execution | Idle, queued, running, interrupted" (AC1)

Glossary (`docs/glossary.md`), verbatim:

- **Invalidated run**: "A run whose inputs changed while it ran, so none of its results become current."
- **Interrupted run**: "A run stopped before it finished, so each test it had not finished gets no outcome from it."
- **Selection**: "The tests a change requires running, each with its reason."
- **Broad fallback**: "A widening to a whole workspace or project, named with the input that triggered it."

#### Orchestrator rulings

Asked by `session_wake` at 06:07 on 2026-09-28, answered at 06:09; decider the orchestrator, holding the owner's calls overnight. Each reason is the orchestrator's.

- Q6 (AC1, AC2): every answer carries each workspace's execution state with its queue reason, and the latest selection's explanation (the reason per changed path, broad fallbacks, selected and total counts), in `--json`, the CLI text and the log. Reason: AGENTS.md requires explaining each selection and each broad fallback and reporting selected and total counts, and 2.4b and 2.7 need queued told apart from idle.
- Q7 (AC3): the invalidated state lives in memory for the daemon's life, with no schema change. Reason: after a restart the run is not current and reruns at start, so a stored reason would carry nothing a user could act on.
- Q2 (2.3h's, AC1 here): the workspace a change interrupted shows interrupted, then queued.
- H2 (06:18): Q7's in-memory state lives in this ticket, beside its only reader (C59).
- Split (06:10): 2.3f, 2.3h, then this ticket.
- Ticket review (create-ticket 6c, 06:23 to 06:25): 10 findings, all applied, the four questions settled by create-ticket from the rulings above. F1 bounded the paths in AC1's reasons as AC2's list is; F2 gave an idle, not-current workspace its pending-round and pending-retry reasons beside 2.3f AC2's; F3 added a refused selection, a round with no changed path, and no round yet to AC2's reasons; F4 lists every due reason that applies, in AC1's order; F5 excludes a cause that names no path from the invalidated label, as 2.3h H1 keeps such a run from being called changed; F6 ends `interrupted` when a round queues the workspace; F7 takes the build-failure kinds from 2.3g's input fact (C14); F8 and F9 gave the CLI text and AC1's last sentence their tasks; F10 widened the broken-tests search to whole-answer comparisons.

#### Decisions taken here

- **Reasons per workspace, not per test.** Selection is at workspace granularity, so every test of a selected workspace shares its workspace's reasons (`SelectedWorkspace.reasons`); the answer carries them once per workspace and the counts per test, never `Selection.tests`, which would repeat the same reasons for every test and could pass the protocol's 1 MiB line limit on a large consumer.
- **A bounded changed-path list.** A branch switch can change thousands of paths; the answer names a bounded number and counts the rest, while the counts and fallbacks cover them all (C24: the flag derives from the bound that cut).
- **`activity` stays.** It keeps meaning what the daemon is doing now; the schedule adds per workspace what it will do. Removing it would change the `--json` schema.
- **The status response is unchanged.** `status` reports the daemon's identities, activity and unstored jobs; the schedule belongs to answers about results, which 2.4b and 2.7 read.

#### Design notes

- **Why an idle workspace says why.** A workspace that is stale and idle, because 2.3f AC2 already ran it at this revision and list of test modules (a run that could not be fingerprinted), would otherwise look like one whose rerun was forgotten; the reason tells `wait` and the hook that nothing will change until the next input change.
- **Scope of the analysis.** Analyzed: each execution state and each due reason 2.3f and 2.3h produce, the label's life, and the answer's size. Not analyzed: what `wait` (2.4b) and `changes` (2.6) do with these fields.

#### Pending siblings and their routing

- **2.3f and 2.3h** (build before this ticket): the scheduler and interruption whose state this ticket shows.
- **2.3g** (builds before them): adds an input fact beside `nonInputsUnusable` to `answer.ts`, `summary.ts` and `answer-text.ts`, the same files this ticket writes later.
- **2.4b, 2.6, 2.7** (backlog): read these fields; they name no file here.

#### Sizing

About 12 raw files and 16 estimated; code units 4 (3 criteria plus validation). Production: `query/answer.ts`, `query/summary.ts`, `daemon/lifecycle.ts`, `daemon/scheduler.ts`, `cli/src/answer-text.ts`, `cli/src/commands/summary.ts`. Tests, for create-tests: `query.test.ts`, `lifecycle.test.ts`, `packages/cli/test/cli.test.ts`, `server.test.ts` if its stand-ins build a view, and the two `defects.json` beside them. Over 10 estimated, so dev delegates, in two groups on disjoint files: the daemon side (`scheduler.ts`, `lifecycle.ts`, `answer.ts`, `summary.ts`), then the CLI text (`answer-text.ts`, `commands/summary.ts`).

#### Existing tests this change breaks

- `packages/daemon/test/query.test.ts`: builds answers through `queryBasis` with a hand-made `DaemonView`, which gains the schedule, and compares whole answers with `toStrictEqual`, which the new fields break.
- `packages/cli/test/cli.test.ts`: compares the CLI's text and `--json` output, which gain lines and fields.
- `packages/daemon/test/lifecycle.test.ts`: answers read through `summary()` and `pathStatus()`.
- `packages/daemon/test/server.test.ts`: only if its stand-in handlers build a `DaemonView`.
- Found by `rg -n "DaemonView|AnswerContext|contextLines|LatestRunFacts|queryBasis|summary\(|pathStatus\(|--json" packages/daemon/test packages/cli/test` when dev starts; the typecheck reports each place that constructs a changed shape (P14), but not a whole-answer equality, which only the test run reports.

#### Doc text

A draft for the orchestrator, final wording to follow the build.

- `docs/architecture.md`, after "Every answer also carries the input revision, whether reconciliation is complete, when the last one ended, the watcher's health, and whether the discovery it counts from is current.": "Every answer also carries each confirmed workspace's execution state (running; queued, with why it is due; interrupted by a change until it is queued again; or idle, saying why no run is coming when its results are not current), the latest round's selection (each changed path with what it selected, up to a bound, the broad fallbacks, and the selected and total counts), and, on a workspace's latest run, whether it was invalidated in this daemon life, with the reason."
- `README.md`: a user-visible change; the query section gains the execution state and the selection. Dev confirms the sentence.

#### Previous ticket

2.3h (authored in this lane): a run is kept under its fingerprint when only paths outside its workspace's inputs changed, and a change inside them interrupts it once the newer revision's build has ended; the interrupted run stores nothing and is listed with its reason. 2.3f (authored in this lane): the scheduler, its due reasons, its once-per-revision rule, its order, and its logged selection per round.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3i, § Ticket 2.3h, § Ticket 2.3f.
- Tickets 2.3f and 2.3h (`_agent-docs/tickets/2-3f-schedule-runs.md`, `_agent-docs/tickets/2-3h-judge-runs.md`).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (06:07).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C14,C22,C24,C38,C40,C46,C48,C55,C59,C119,C120,C128,C129,C131,C151,C152 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P14,P16,P17,P18,P21,P33 -->

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
sizing_ac_count: 4
files_to_modify:
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/query/summary.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/scheduler.ts
  - packages/cli/src/answer-text.ts
  - packages/cli/src/commands/summary.ts
files_to_create: []
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

- _agent-docs/tickets/2-3i-schedule-answers.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3i added and linked, under the orchestrator's 06:10 grant)

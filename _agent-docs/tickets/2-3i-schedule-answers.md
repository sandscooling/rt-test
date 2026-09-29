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

- [ ] AC1: Every summary and path-status answer, in `--json` and in the CLI's text, carries the daemon's round, either pending, naming what it waits for (the first reconciliation, the quiet window, the settling of the inputs, a dependency build, or a rediscovery), planned at an input revision, or held after a failed scheduling step with no round coming until the next input change, and each confirmed workspace the discovery in effect lists with exactly one execution state. `running` holds exactly while the answer's `activity` names that workspace's run. `queued` holds while the latest round, planned at the answer's input revision, found the workspace due and its run has not begun, with the one reason the daemon found it due: it was never run; its latest run was stored under another adapter version; its latest run is invalidated, with AC3's reason; its latest run was stored not fingerprinted for another reason, naming it, or in an earlier daemon life, whose reason this life does not hold; its inputs differ from those of its latest run; its current input fingerprint cannot be computed, naming why; or it is retried after a `failed` or `crashed` run. Besides that reason, a queued workspace names, when they apply, the changed paths by which the latest round's selection chose it, up to AC2's bound with a count of the rest, or the broad fallbacks that chose it with their triggers, up to the same bound with a count of the rest, and that its last run was interrupted by a change, naming the paths inside its inputs up to ticket 2.3h's bound with a count of the rest. `interrupted` holds from when a run a change interrupted (ticket 2.3h AC2) returns until the next round decides the workspace, naming those paths the same way. Any other workspace is `idle`. While no round is pending, an idle workspace whose latest run is not bound to its current fingerprint, or that is due a periodic retry, says why no run has begun, with its due reason as `queued` names it: a retry is pending (ticket 2.3f AC5's periodic retry of a `failed` or `crashed` run or of a run that stored nothing), or no run is coming until the next input change (ticket 2.3f AC2: it already ran at this revision and list of test modules, or the round is held after a failed step). An idle workspace whose latest run is bound to its current fingerprint and not due a retry says nothing more. A workspace's execution state never changes its outcome or freshness counts.
- [ ] AC2: Every answer also carries the explanation of the selection made at the latest input revision a round planned at, as ticket 2.3f AC6 logs it: the input revision; for each changed path, its owner, the workspaces it selected, each with its reasons, and the workspaces it reached that cannot run, or why it selected none; each broad fallback with its trigger and scope; and the selected and total test and workspace counts, each saying whether it is complete. When that round made no selection, the answer says why instead, with the reason the log gives: 2.3g's dependency build failed or timed out, the dependency builds stopped working, the discovery yields no selection input, selection refused the change, no build ended at the round's revision, the inputs' digests could not be read, or it was the first round of this daemon life, which has no earlier round to compare with; and before any round has planned in this daemon life, it says so. An answer lists at most a bounded number of changed paths and at most that many broad fallbacks, the bound a named constant, and counts the rest of each; the counts always cover every changed path.
- [ ] AC3: A workspace whose latest stored run was stored not fingerprinted because its inputs changed while it ran (ticket 2.3h's verdict: a changed path inside its workspace's inputs, or its fingerprint at its end differing from the one at its start) reads as invalidated, with the reason that verdict gave, in the summary's latest-run facts for it, and as its due or idle reason in every answer's schedule, from the moment it is stored until a later run of that workspace is stored or the daemon stops. A run stored not fingerprinted for another reason (it started with no fingerprint, a cause that names no path such as a watcher failure or an input set that could not be established, an end fingerprint that could not be taken, a stop) is not called invalidated. The label is held in memory only and nothing new is written to the store; after a restart the run reads as stored not fingerprinted in an earlier daemon life, as AC1 names it, and ticket 2.3f runs it again.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It reads the scheduler's, the lifecycle's and selection's own state and renders it.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read the landed code of ticket 2.3h (`daemon/run-judgment.ts`: the predicate's answer, its kinds and the paths it carries; `lifecycle.ts` `#run`: the interruption, `#nothingStored` and the `RunReport` it returns) and confirm the names § Current structure of the modified files gives, since 2.3h edits `lifecycle.ts` first. Re-run the broken-tests search in § Existing tests this change breaks, over the two packages' test directories and every other tracked file (`git ls-files`), since a `--json` consumer can sit outside them (C38).
- [ ] (AC1, AC3) In `packages/daemon/src/daemon/due-workspaces.ts`, give each due reason a kind, one exported constant with a members record as `TEST_STATES` has, declared in `query/answer.ts`, which `due-workspaces.ts` already imports from and the answer and the CLI read (C3, C4, C14), and have `staleReason` and `retryReason` answer the kind; `DUE_REASON`'s text stays the log's, keyed by the kind, so the log's `due:` line and the answer read one decision (C8).
- [ ] (AC2) In `packages/daemon/src/daemon/round-selection.ts`, have `explainRound` return, beside `directTargets` and `selected`, the explanation it logs: the revision, and the `Selection`'s `paths`, `fallbacks` and `counts`, or the no-selection kind and reason, built from the same values its log lines are (C8). The no-selection kinds are 2.3g's `InputsNotNarrowed["kind"]` members (`SELECTION_REFUSED` among them) plus the build wait released with no build (`NO_BUILD_ENDED_KIND` today, a local string), and the scheduler's two rounds without a selection (`NO_SNAPSHOT_ENTRY`, `FIRST_ROUND_ENTRY`): name the three new kinds as exported constants beside 2.3g's, never a second enumeration of 2.3g's (C3, C4, C14).
- [ ] (AC1, AC2, AC3) Create `packages/daemon/src/daemon/workspace-schedule.ts`, the scheduler's record of what it is doing and one read of it: the round (pending with what it waits for, planned at a revision, or held after a failed step until the next input change); per workspace, the due reason kind and text of the latest plan, whether its run has begun, its last run's interruption with the changed paths inside (kept until its next run begins), the verdict of each run stored in this daemon life, keyed by the stored run's id (its not-fingerprinted kind and reason, or none when it was fingerprinted), and whether a periodic retry is owed; and the latest selection's explanation, why none was made, or that no round has planned in this daemon life. A workspace's latest stored run reads invalidated, or stored not fingerprinted for a named reason, only when its run id matches a verdict held here; a not-fingerprinted latest run with no matching verdict was stored in an earlier daemon life (C12). The read gives each confirmed workspace its execution state and reason, and the explanation, bounding the changed paths and fallbacks by a named constant declared here, 20 (G3), and counting the rest (C22, C23, C24), and the interruption's paths by `MAX_NAMED_CHANGES`, the bound 2.3h's reason text uses (C23). Reading starts nothing and changes nothing (a query starts no job, `server.ts` `DaemonHandlers`). Keep the idle-reason kinds and the invalidated label open sets that one more member extends by adding an entry, never a closed switch that would need restructuring, since ticket 2.3k adds one idle reason and reuses the label; add nothing for it.
- [ ] (AC1, AC2, AC3) In `packages/daemon/src/daemon/scheduler.ts`, record into the schedule as the scheduler already decides, changing no decision: each wait of `#quiesce` and the first reconciliation in `start` as the round pending, `#plan` as the round planned with its due list, each not-current workspace `#ranAlready` held back with its due reason, and its retries, or as pending on a rediscovery when it returns one, `#selectRound` the explanation `explainRound` returns, or the `NO_SNAPSHOT_ENTRY` or `FIRST_ROUND_ENTRY` kind it decides without calling `explainRound`, `#run` the run begun and, from the `RunReport`, the stored run's id, its verdict and the interruption, and a step that throws as the round held until the next input change. Clear each mark on every way a job ends (C167): when the run returns or throws, the workspace leaves the latest plan's due list, so it never reads queued for a run that has ended before the next round decides it again; when the run never begins, it stays queued. The scheduler has 427 of lint's 500 code lines (P16), so the state lives in the new module and the scheduler only records.
- [ ] (AC1, AC3) In `packages/daemon/src/daemon/lifecycle.ts`, add to `RunReport` (declared in `scheduler.ts`) three optional fields beside `changedWhileRunning`: the stored run's id when a run was stored (`#store` discards the `StoredRun` that `writeRun` returns today), the not-fingerprinted verdict's kind and reason from 2.3h's predicate when the run was stored not fingerprinted, and the interruption's changed paths inside when a change interrupted the run, read as data from the predicate's answer, never by matching its reason text (C3, C14). Keep `changedWhileRunning` as 2.3h leaves it. Pass the schedule's read into `DaemonView` through `#view()`. After 2.3h, `lifecycle.ts` sits near lint's cap, so keep the additions to fields and one read.
- [ ] (AC1, AC2, AC3) In `packages/daemon/src/query/answer.ts`, add to `AnswerContext` the schedule (the round and each confirmed workspace's execution state and reason) and the selection explanation, with each execution state, pending wait, idle reason and no-selection kind as an exported constant with a members record, each declared once where the answer and the daemon both read it (C3, C4); the queued reasons derive from the due-reason kinds, `notFingerprinted` refined into invalidated, another reason named and an earlier daemon life, never restated (C14); take the explanation's shapes from `selection/selection-types.ts` (`ChangedPathReport`, `BroadFallback`, `SelectionCounts`) and the no-selection kinds from `InputsNotNarrowed["kind"]` rather than restating them (C14). Add to `LatestRunFacts` an optional `invalidated` with its reason. Every addition is a new field and `activity` keeps its meaning, so `CLI_JSON_SCHEMA_VERSION` stays (C151). Export from `packages/daemon/src/client.ts` each new constant and type the CLI reads, and nothing it does not (C59).
- [ ] (AC1, AC2, AC3) In `packages/daemon/src/query/summary.ts`, add the schedule to `DaemonView` beside its `Pick` of `StatusResponse`, leaving `StatusResponse` unchanged; in `queryBasis`, copy the round, the explanation and each confirmed workspace's execution state into every answer's context, taking `running` from the view's `activity`, never from a second record (C8); in `latestRunFacts`, set `invalidated` only when the latest stored run's id is the one the label was held for. `path-status.ts` answers through the same `queryBasis` and needs no edit. The schedule and the label sit beside the counts and feed no outcome or freshness count (C119, C120).
- [ ] (AC1, AC2, AC3) In `packages/cli/src/answer-text.ts` `contextLines`, render the round, each workspace's execution state and reason on one line, and the latest selection: its revision, its changed paths with what each selected or why it selected none, its fallbacks, and its counts with their completeness, bounded as the answer is, or why no selection was made. In `packages/cli/src/commands/summary.ts` `runFacts`, show a latest run's invalidated label and reason beside its status. Every reason goes through `firstLine` or `cutReasonText`, as today.
- [ ] (Support) Send the orchestrator the doc text in § Doc text, its final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files, `bun run --filter @rt-test/daemon typecheck` and `bun run --filter rt-test typecheck` (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `AnswerContext`, `LatestRunFacts`, `activityText`, `InputsNotNarrowed` and its kinds, `CutReason`, and the state constants with their members records (`query/answer.ts`): where every answer's context lives, and how its enumerations are named.
- `queryBasis`, `DaemonView`, `latestRunFacts` and `cutReason` (`query/summary.ts`), which compose every summary and path-status context once; `DaemonLifecycle` `#view()` (`daemon/lifecycle.ts`), which carries the daemon's side into it.
- `ChangedPathReport`, `PathSelection`, `SelectionReason`, `BroadFallback`, `SelectionCounts`, `TestCount` (`selection/selection-types.ts`): the explanation's shapes (C14).
- `explainRound`, `RoundSelection`, `NO_SELECTION_CONSEQUENCE` and the log line builders (`daemon/round-selection.ts`): the explanation the log already gives.
- `DUE_REASON`, `staleReason`, `retryReason`, `QUEUE_GROUP`, `testModulesKey` (`daemon/due-workspaces.ts`): the scheduler's due decision.
- `Scheduler` `#quiesce`, `#plan`, `#due`, `#armRetries`, `#ranAlready`, `#selectRound`, `#run`, `#idle` and `RunReport` (`daemon/scheduler.ts`): where each decision the schedule records is made.
- 2.3h's predicate answer (`daemon/run-judgment.ts`): the verdict kind and the changed paths inside, as data; `MAX_NAMED_CHANGES` (`inputs/input-jobs.ts`): the bound 2.3h's reason text names paths by.
- `contextLines`, `firstLine`, `cutReasonText`, `oneLine`, `INDENT` (`cli/src/answer-text.ts`) and `runFacts` (`cli/src/commands/summary.ts`): the text renderer and its reason cutting.

### Must Create

- `packages/daemon/src/daemon/workspace-schedule.ts`: the schedule's state and its read (AC1 to AC3), with the bound on listed changed paths and fallbacks (AC2).
- The due-reason kinds, the three new no-selection kinds, the execution states, the round's pending kinds and the idle reasons, each an exported constant with a members record, and the schedule and explanation fields of `AnswerContext` and the `invalidated` field of `LatestRunFacts` (AC1 to AC3).
- The three optional `RunReport` fields (AC1, AC3).
- Their text lines in the CLI.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The third of the three tickets the unsplit 2.3f became (orchestrator, 2026-09-28 06:10). Ticket 2.3f schedules discoveries and runs of what is not current and logs each round's selection; ticket 2.3h judges a run by its workspace's inputs and interrupts one a change inside them touched; this ticket puts both into every answer. Build order: 2.3d, 2.3e, 2.3g, 2.3j, 2.3f, 2.3h, 2.3i, then 2.3k. Tickets 2.4b (`wait`) and 2.7 (the agent hook) read what it adds.

Requirements this ticket serves (`docs/requirements.md`):

- "FR5: Answer summary and `status <path>` queries through a CLI with versioned `--json` output, reporting counts per state for files and folders, without starting a test." (AC1, AC2, AC3)
- "FR7: Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts." (AC2)
- "FR8: Execute every selection in the daemon, and record a run whose inputs changed while it ran as invalidated and rerun it from stable inputs." (AC3)

Rule clauses the criteria rest on:

- AGENTS.md § Product guarantees: "Keep outcome, freshness, execution state, and falsification evidence independent." (AC1: the execution state is its own field and changes no count)
- AGENTS.md § Product guarantees: "Explain each selection and each broad fallback. Report selected and total test counts." (AC2)
- AGENTS.md § Product guarantees: "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states." (AC1, AC3)
- `docs/architecture.md` § State dimensions: "Execution | Idle, queued, running, interrupted" (AC1)
- Ticket 2.3f AC2: "Each confirmed workspace is run at most once for one input revision and one list of test modules the discovery in effect gives it, apart from AC5's retry". (AC1: no run is coming until the next input change)
- Ticket 2.3f AC5: "it runs a workspace again while its latest stored run's status is `failed`, or while its last run attempted ended with nothing stored (its executor process died or could not start) and it is still due by AC1." (AC1: a retry is pending; #14b added `crashed` to `retryReason`)
- Ticket 2.3f AC6: "for each changed path, the workspaces it selected or why it selected none; each broad fallback with the input or uncertainty that triggered it; and the selected and total test and workspace counts, saying when they are incomplete." (AC2)
- Ticket 2.3h AC2: "Nothing is stored for it: the daemon lists it among the jobs that ended with nothing stored, with a reason naming those paths and never a stop". (AC1: `interrupted`, and `unstoredJobs` keeps the listing)

Glossary (`docs/glossary.md`), verbatim:

- **Invalidated run**: "A run whose inputs changed while it ran, so none of its results become current."
- **Interrupted run**: "A run stopped before it finished, so each test it had not finished gets no outcome from it."
- **Selection**: "The tests a change requires running, each with its reason."
- **Broad fallback**: "A widening to a whole workspace or project, named with the input that triggered it."
- **Execution state** (added by this ticket, G1): "What the daemon is doing with a Vitest workspace: running it, holding it queued to run, holding it interrupted by a change until the next round decides it, or idle. It is independent of every result's outcome and freshness."
- **Round** (added by this ticket, G1, reworded after review Q3): "The daemon's decision, once the input revision has held still, its inputs have settled, its dependency build has ended and any rediscovery it needs has ended, of what to run at that revision, made with the selection over the paths changed since the previous round. A round is pending until that decision is made."

#### Orchestrator rulings

Decider the orchestrator, holding the owner's calls, unless a line says otherwise. Each reason is the decider's.

- Q6 (AC1, AC2), 2026-09-28 06:09: every answer carries each workspace's execution state with its queue reason, and the latest selection's explanation (the reason per changed path, broad fallbacks, selected and total counts), in `--json`, the CLI text and the log. Reason: AGENTS.md requires explaining each selection and each broad fallback and reporting selected and total counts, and 2.4b and 2.7 need queued told apart from idle.
- Q7 (AC3), 06:09: the invalidated state lives in memory for the daemon's life, with no schema change. Reason: after a restart the run is not current and reruns at start, so a stored reason would carry nothing a user could act on.
- Q2 (2.3h's, AC1 here), 06:09: the workspace a change interrupted shows interrupted, then queued.
- H2, 06:18: Q7's in-memory state lives in this ticket, beside its only reader (C59).
- The split, 06:10: 2.3f, 2.3h, then this ticket.
- 2.3k, 2026-09-29 09:05, for information: a later ticket holds a workspace whose tests change their own inputs, adding one idle reason and reusing AC3's label. Keep both open to one more member; add nothing for it.
- S1 (sizing), 2026-09-29 09:07, asked 09:06: proceed as-is, no split. Reason: 20.8 is 16 raw files times a multiplier the skill calls unfitted to this project; the CLI group renders the JSON the daemon group defines, so reviewing them apart would split one contract across two reviews; and a four-file ticket would pay a full tests-and-review cycle for little. Dev delegates, as over 10 estimated requires.
- S2 (AC1), 09:07: a queued workspace carries the scheduler's one due reason, refined (not fingerprinted splits into invalidated, another reason named, or an earlier daemon life), plus the latest round's changed paths or broad fallbacks and its last run's interruption with the paths, when they apply. Reason: the answer names what actually decided the scheduler, never a reason it did not act on; when two hold, naming the first is true, not a false explanation.
- S3 (AC1), 09:07: the paths a queued workspace names come from the latest round's selection only, the same record AC2 shows (C8). Reason: one source; an accumulation across rounds needs its own bound and state for an explanation the due reason already gives truthfully.
- S4 (AC3), 09:07: label invalidated both "changed paths inside" and "fingerprint moved", and not the other three kinds. Reason: the glossary's invalidated run is one whose inputs changed while it ran, and a moved fingerprint is exactly that.
- S5 (AC1), 09:07: `running` until the interrupted run returns, `interrupted` from then until the next round decides it.
- G1 (glossary), 2026-09-29 09:12, asked 09:11: **Execution state** and **Round** added to `docs/glossary.md` as worded below, under the orchestrator's grant for exactly those two entries.
- G2 (AC1), 09:12, decided by create-ticket at 09:11 and not vetoed: `queued` holds only while the latest round was planned at the answer's input revision; when the revision moves, every workspace not running or interrupted reads idle with the round pending until the new round plans. Reason: a plan made at an older revision is a reason RT Test no longer acts on, and "a round is pending" says truthfully that a decision is coming.
- G3 (AC1, AC2), 09:12, decided by create-ticket at 09:11 and not vetoed: after a scheduling step throws, each not-current idle workspace reads no run coming until the next input change, naming its due reason; the changed-path and fallback bound is 20, its own named constant (C23), the same value as `MAX_NAMED_CHANGES` and 2.4b's `MAX_NAMED_FAILURES`.
- Facts settled by create-ticket and confirmed at 09:07: only the summary carries latest-run facts, so AC3's label lands there and every answer's schedule carries "invalidated" as a due or idle reason; AC2's no-selection kinds follow the code (2.3g's kinds, no build ended, digests unreadable, the first round of a life, no round yet), and "a round with no changed path (a retry or a rediscovery alone)" goes, since a retry or rediscovery at the same revision keeps that revision's selection; the broad fallbacks are bounded with the changed paths; `running` holds exactly when the answer's activity names the workspace.
- Ticket review, 2026-09-28 06:23 to 06:25, on the first draft: Findings applied (bounded paths in the reasons; pending-round and pending-retry reasons for an idle workspace; a refused selection and no round yet among AC2's reasons; the path-less causes kept from the label; `interrupted` ending when a round decides; the build-failure kinds taken from 2.3g's fact; the CLI text and AC1's last sentence given tasks; the broken-tests search widened to whole-answer comparisons). S2 replaced the finding that listed every due reason in a fixed order.
- Ticket review, 2026-09-29 09:12 to 09:16, on the re-verified draft, triaged by create-ticket at 09:17: applied E1 (a round held after a failed step), E2 (a queued workspace's fallbacks bounded), E3 (no round yet among the schedule's explanation states), E4 (`#selectRound`'s two kinds decided without `explainRound`), E5 (a workspace `#ranAlready` holds back keeps its due reason), E6 (a workspace whose run has ended leaves the due list), E7 (`StatusResponse` unchanged), E8 (one set of due-reason kinds, in `answer.ts`), E9 (the broken-tests search widened, see below) and E10. Q1 and Q2 settled on a fact: `writeRun` returns the `StoredRun` (`store/open-store.ts`), so `RunReport` carries the stored run's id and the label applies only to that run. Q3 applied: the glossary's Round decides what to run, and a rediscovery is one of its pending waits, as AC1 says; the wording change stays inside G1's grant.

From 2.3h's author (threadId 0929fbce), 2026-09-29 09:07, pinned in 2.3h's ticket at 97619a8: `RunReport` keeps its shape in 2.3h; `changedWhileRunning` is true exactly when the predicate's kind is changed paths inside or fingerprint moved, and false for causes naming no path, no start fingerprint and an end fingerprint unavailable; an interrupted run reports `stored: false` and `changedWhileRunning: true`, and never reaches 2.3f's once-more rule. The predicate's answer is a discriminated kind (kept; changed paths inside; fingerprint moved; causes naming no path; no start fingerprint; end fingerprint unavailable) carrying every changed path inside and each cause as data, unbounded; its reason text names up to `MAX_NAMED_CHANGES` paths. An interruption's paths are the changed paths inside that a narrowed build placed there (2.3h QA).

#### Decisions taken here

- **Reasons per workspace, not per test.** Selection is at workspace granularity, so every test of a selected workspace shares its workspace's reasons (`SelectedWorkspace.reasons`); the answer carries them once per workspace and the counts per test, never `Selection.tests`, which repeats the same reasons for every test and could pass the protocol's 1 MiB line limit (`MAX_LINE_BYTES`) on a large consumer.
- **A bounded changed-path list.** A branch switch can change thousands of paths, and each can give a broad fallback; the answer names a bounded number of each and counts the rest, while the counts cover them all (C24: the count derives from the bound that cut). The interruption's paths are a different dataset, the job window's, and take 2.3h's bound (C23).
- **`activity` stays.** It keeps meaning what the daemon is doing now; the schedule adds per workspace what it will do. `running` is read from it, so the two never disagree (C8).
- **The status response is unchanged.** `status` reports the daemon's identities, activity and unstored jobs; the schedule belongs to answers about results, which 2.4b and 2.7 read.
- **A round pending is one fact for every workspace.** Until the scheduler plans at the answer's revision it has decided nothing for it, so no workspace reads queued from an older plan; the round's pending wait says why for each idle workspace, and 2.4b reads it as its "a round is pending".
- **A failed scheduling step.** After a step throws, the scheduler waits for the next input change (`Scheduler.start`), so the round reads held until then, never pending, and each not-current idle workspace reads no run coming until the next input change, naming its due reason (G3; review E1).
- **The label is keyed by the stored run's id.** A verdict held for a workspace applies only while the latest stored run is the run it was held for, so a later stored run never carries an older run's label and a run stored in this life never reads as from an earlier one (C12). After 2.3h every run the daemon stores passes through the predicate, a stop included (its end fingerprint is unavailable), so each has a held verdict.
- **The interruption's mark lasts until the workspace's next run begins**, so a queued workspace names it; the label (AC3) lasts until a later run of the workspace is stored, so a later interrupted run, which stores nothing, leaves the label on the older run.

#### Design notes

- **Why an idle workspace says why.** A workspace that is stale and idle, because 2.3f AC2 already ran it at this revision and list of test modules (a run that could not be fingerprinted), would otherwise look like one whose rerun was forgotten; the reason tells `wait` and the hook that nothing will change until the next input change.
- **The label and 2.3h's report agree.** The invalidated label covers exactly the verdicts for which 2.3h sets `changedWhileRunning`, so 2.3f's once-more rule and the label read one classification (C8).
- **Scope of the analysis.** Analyzed: each execution state; each due reason `staleReason` and `retryReason` give; each wait of `#quiesce` and the first reconciliation; each no-selection cause `explainRound` and `#selectRound` log; the interruption and verdict kinds 2.3h's predicate gives; the label's life across a later stored run, a later interrupted run and a restart; and the answer's size. Not analyzed: what `wait` (2.4b) and `changes` (2.6) do with these fields; the held state 2.3k adds.

#### Pending siblings and their routing

- **2.3h** (ready-for-dev, builds before this ticket): the interruption and the predicate whose kinds and paths this ticket reads. Its file list is `input-jobs.ts`, `input-tracker.ts`, `queued-reads.ts`, `reconcile-schedule.ts`, `narrowed-inputs.ts`, `lifecycle.ts`, `executor.ts` and `run-judgment.ts` (new); this ticket writes `lifecycle.ts` after it and reads `run-judgment.ts` and `input-jobs.ts`.
- **2.3k** (to be drafted, builds after this ticket): adds one idle reason and reuses AC3's label; this ticket keeps both open (orchestrator, 09:05).
- **2.4, 2.4d, 2.4b, 2.4c** (ready-for-dev, build after this ticket): 2.4b reads the round, the execution states and the idle reasons (its AC3, AC5, AC6), may reuse the changed-path bound, and signals from `scheduler.ts` whenever the schedule changes; 2.4c renders beside `answer-text.ts`. **2.6** and **2.7** (backlog) read these fields.
- **Live lanes, per the dispatch**: #36 edits `windows-job.ts` (and, in the working tree at 09:07, `executor.ts`, `process-tree.ts` and a new `child-exit.ts`); #19 edits `selection-facts.ts`, `protection.ts`, `store/columns.ts` and `store/schema.ts` on wt/2. This ticket's file list shares none of them.

#### Current structure of the modified files

Read on `main` at 97619a8 (code unchanged since 00a1a96); 2.3h edits `lifecycle.ts` before this ticket builds.

- `daemon/scheduler.ts` (502 lines, 427 code lines): `QUIET_WINDOW_MS`; `DiscoverReport { stored }`; `RunReport { revision, stored, changedWhileRunning }`; `ScheduleView`, `SchedulerParts`; private `Attempt { revision, modules, nothingStored, rerunOwed }`, `EligibleWorkspace`, `DueWorkspace { entry, latest, reason }`; `Scheduler` with `start` (awaits `firstReconciled`, catches a failed step and waits for a change), `stop`, `#quiesce` (quiet window, `settled`, `awaitBuild("the round")`), `#plan` (returns discover, run of the first queued, idle or again), `#armRetries`, `#discoveryDue`, `#eligible`, `#due`, `#ranAlready`, `#explain` (logs `due:` once per revision and module list), `#selectRound` (logs `NO_SNAPSHOT_ENTRY` or `FIRST_ROUND_ENTRY`, or calls `explainRound`, keeping only `directTargets`), `#discover`, `#run`, `#idle`.
- `daemon/due-workspaces.ts` (125 lines): `DUE_REASON` (noRun, anotherAdapterVersion, notFingerprinted, noCurrentFingerprint, inputsChanged, failedRun, crashedRun), text only; `retryReason`, `staleReason` return that text; `QUEUE_GROUP`, `GROUP_REASON`, `QueuedWorkspace { entry, reason, group }`, `holdsFailingTest`, `queueGroup`, `orderQueue`, `testModulesKey`.
- `daemon/round-selection.ts` (161 lines): `NO_SELECTION_CONSEQUENCE`; local `NO_BUILD_ENDED_KIND = "no-build-ended"` and its reason; `RoundSelection { directTargets, selected }`; `changedPaths`; `explainRound(log, narrowing, revision, changed)` logs and returns `RoundSelection`; `noSelection` logs `warning: no selection was made (<kind>)`; `pathText`, `fallbackText`, `countsText`.
- `daemon/lifecycle.ts` (512 lines, 435 code lines, before 2.3h): `DaemonLifecycle` builds the `Scheduler` in its constructor; `status()`; `summary()` and `pathStatus()` pass `#view()`; `#view()` returns `{ consumerRoot, activity, unstoredJobs }`; `#run` returns `RunReport` through `report(stored)`; `#nothingStored`.
- `query/answer.ts` (295 lines): the state constants and members records, `InputsNotNarrowed` (kinds `dependency-build-failed`, `dependency-build-timed-out`, `dependency-builds-ended`, `no-selection-input`, `selection-refused`), `CutReason`, `LatestRunFacts` (ran, crashed with a cut reason, other statuses), `WorkspaceFacts`, `AnswerContext`, `SummaryAnswer` (with `workspaces`), `PathStatusAnswer` (no latest-run facts), `activityText`.
- `query/summary.ts` (294 lines): `DaemonView = Pick<StatusResponse, "consumerRoot" | "activity" | "unstoredJobs">`; `summaryAnswer`; `queryBasis` composes `context`; `latestRunFacts`; `cutReason` (`MAX_REASON_CHARACTERS = 1000`).
- `client.ts`: re-exports the answer constants and types the CLI reads from `query/answer.js`.
- `cli/src/answer-text.ts` (173 lines): `NOT_NARROWED_CAUSES` keyed by `InputsNotNarrowed["kind"]`; `contextLines` (adapter version, discovery freshness, inputs, warnings, unfingerprinted workspaces, `Daemon: <activity>`, `Ended with nothing stored:`); `firstLine`, `cutReasonText`.
- `cli/src/commands/summary.ts` (98 lines): `RUN_STATUS_PHRASES`, `summaryText`, `workspaceLine`, `runFacts`.
- `CLI_JSON_SCHEMA_VERSION = 1` (`cli/src/output.ts`), unchanged.

#### Sizing

16 raw files and 21 estimated (20.8); code units 4 (3 criteria plus validation). Production: modify `daemon/scheduler.ts`, `daemon/due-workspaces.ts`, `daemon/round-selection.ts`, `daemon/lifecycle.ts`, `query/answer.ts`, `query/summary.ts`, `client.ts`, `cli/src/answer-text.ts`, `cli/src/commands/summary.ts`; create `daemon/workspace-schedule.ts`. Tests, for create-tests: `query.test.ts`, `scheduler.test.ts`, `lifecycle.test.ts`, `packages/cli/test/cli.test.ts`, and the two `defects.json` beside them. Over the 20-file limit by one; the orchestrator ruled to proceed (S1). Over 10 estimated, so dev delegates, in two groups on disjoint files: the daemon side (`due-workspaces.ts`, `round-selection.ts`, `workspace-schedule.ts`, `scheduler.ts`, `lifecycle.ts`, `answer.ts`, `summary.ts`, `client.ts`), a chain, then the CLI text (`answer-text.ts`, `commands/summary.ts`), which reads its shapes.

#### Named-defect records the edits reach

A lane re-proves every record whose test or mutated file it edits. Records whose mutated file this ticket edits, counted on 97619a8 by each record's `file` field: `lifecycle.ts` 60 (2.3h changes this first), `scheduler.ts` 35, `query/summary.ts` 30, `answer-text.ts` 15, `due-workspaces.ts` 13, `client.ts` 12, `round-selection.ts` 11, `commands/summary.ts` 7, `query/answer.ts` 3. Count the `--changed` selection before proving, and prove by `--ids`.

#### Existing tests this change breaks

- `packages/daemon/test/query.test.ts`: builds answers through `queryBasis` with a hand-made `DaemonView`, which gains the schedule, and compares whole answers with `toStrictEqual`, which the new fields break.
- `packages/daemon/test/scheduler.test.ts`: its stand-in `run` part builds `RunReport`s (`{ revision, stored, changedWhileRunning }`); the new fields are optional, so it breaks only where a test compares a whole report or reads the log's `due:` text if its wording moves.
- `packages/cli/test/cli.test.ts`: `humanAnswer` builds a stand-in answer, which gains required fields, and `contextLines` tests compare its lines, which gain the schedule and selection.
- `packages/daemon/test/lifecycle.test.ts`: reads answers field by field (`activity`, `unstoredJobs`), so none breaks; it is where the end-to-end tests of AC1 and AC3 go.
- `packages/daemon/test/daemon.test.ts` compares a `latestRun` whole, which breaks only if its scenario leaves an invalidated run; `server.test.ts`' stand-in `status()` is unchanged.
- Found by `rg -c "DaemonView|AnswerContext|contextLines|LatestRunFacts|queryBasis|summaryAnswer|pathStatusAnswer|RunReport|explainRound|RoundSelection|DUE_REASON|staleReason|retryReason|changedWhileRunning|latestRun|Daemon: |activity" packages/daemon/test packages/cli/test` (2026-09-29 09:04), then reading each hit. Widened at 09:17 to every other tracked file (`git ls-files` outside the two test directories, less the packages' own sources and the docs, piped to `rg -l "unstoredJobs|activityText|querySummary|queryPathStatus|contextLines|latestRun\b"`): no hit, so no reader outside the two packages. The typecheck reports each place that constructs a changed shape (P14), but not a whole-answer equality, which only the test run reports.

#### Doc text

A draft for the orchestrator, its final wording to follow the build.

- `docs/architecture.md`, the query paragraph beside § Query surface: "Every answer also carries the daemon's round (pending, naming what it waits for; planned at an input revision; or held after a failed scheduling step until the next input change); each confirmed workspace's execution state (running; queued, with why it is due; interrupted by a change until the next round decides it; or idle, saying why no run is coming when its results are not current); the latest selection (each changed path with what it selected, up to a bound, the broad fallbacks, and the selected and total counts, or why no selection was made); and, on a workspace's latest run, whether it was invalidated in this daemon life, with the reason."
- `README.md`: user-visible; the query section gains the schedule and the selection, and `summary`'s workspace line the invalidated label. Dev confirms the sentence.

#### Previous ticket

2.3h (ready-for-dev, builds just before this ticket): a run is kept under its fingerprint when only paths outside its workspace's inputs changed; a change inside them, once the newer revision's build has ended, interrupts it; the interrupted run stores nothing, is listed among the jobs that ended with nothing stored with a reason naming the paths, and `RunReport` keeps its shape. Until this ticket lands, an interrupted run shows only in `unstoredJobs` and the log. 2.3f (done): the scheduler, its due reasons, its once-per-revision rule, its order and its logged selection per round; its completion notes keep `activity` reading `idle` during a quiet window, which this ticket's round fact answers. #14b (done, 2295e92) added `crashed` to the retried runs and to AC1's text here.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3i, § Ticket 2.3h, § Ticket 2.3f, § Ticket 2.4b.
- Tickets 2.3f (`_agent-docs/tickets/2-3f-schedule-runs.md`, its criteria and Completion Notes), 2.3h (`_agent-docs/tickets/2-3h-judge-runs.md`, at 97619a8) and 2.4b (`_agent-docs/tickets/2-4b-wait-for-files.md`, its AC3, AC5 and AC6).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (2026-09-29 09:02).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C8,C12,C14,C22,C23,C24,C38,C39,C40,C46,C48,C55,C59,C119,C120,C128,C129,C131,C142,C151,C152,C167 -->

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
  - packages/daemon/src/daemon/due-workspaces.ts
  - packages/daemon/src/daemon/round-selection.ts
  - packages/daemon/src/daemon/scheduler.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/query/summary.ts
  - packages/daemon/src/client.ts
  - packages/cli/src/answer-text.ts
  - packages/cli/src/commands/summary.ts
files_to_create:
  - packages/daemon/src/daemon/workspace-schedule.ts
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
- _agent-docs/tickets/2-3i-schedule-answers.md (re-verified and rewritten by create-ticket, 2026-09-29, against `main` at 97619a8, with the 09:07 and 09:12 rulings and the 09:17 review)
- docs/glossary.md (**Execution state** and **Round** added, under the orchestrator's 09:12 grant for exactly those two entries)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3i scope, under the 2026-09-29 dispatch's grant)
- _agent-docs/sprint-status.yaml (2-3i-schedule-answers to ready-for-dev, under the same grant)

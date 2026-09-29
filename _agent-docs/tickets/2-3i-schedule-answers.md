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

- [x] AC1: Every summary and path-status answer, in `--json` and in the CLI's text, carries the daemon's round, either pending, naming what it waits for (the first reconciliation, the quiet window, the settling of the inputs, a dependency build, a rediscovery, or the job in progress, a run or discovery begun at an earlier input revision), planned at an input revision, or held after a failed scheduling step until the daemon tries again at the next input event or reconciliation, naming the failure, and each confirmed workspace the discovery in effect lists with exactly one execution state. `running` holds exactly while the answer's `activity` names that workspace's run. `queued` holds while the latest round, planned at the answer's input revision, found the workspace due and its run has not begun, with the one reason the daemon found it due: it has no stored run; its latest run was stored under another adapter version; its latest run is invalidated, with AC3's reason; its latest run was stored not fingerprinted for another reason, naming it, or in an earlier daemon life, whose reason this life does not hold; its inputs differ from those of its latest run; its current input fingerprint cannot be computed, naming why; or it is retried after a `failed` or `crashed` run. Besides that reason, a queued workspace names, when they apply, at most a small bounded number of the changed paths and broad fallbacks (with their triggers) by which the latest round's selection chose it, a named constant of its own, drawn from those AC2's explanation names, and counts the rest, and that its last run was interrupted by a change, naming the paths inside its inputs up to ticket 2.3h's bound with a count of the rest. `interrupted` holds from when a run a change interrupted (ticket 2.3h AC2) returns until the next round decides the workspace, naming those paths the same way. Any other workspace is `idle`. While no round is pending, an idle workspace whose latest run is not bound to its current fingerprint, or that is due a periodic retry, says why no run has begun, with its due reason as `queued` names it: a retry is pending (ticket 2.3f AC5's periodic retry of a `failed` or `crashed` run or of a run that stored nothing), no run is coming until the next input change (ticket 2.3f AC2: it already ran at this revision and list of test modules), or the round is held after a failed step, so no run comes until the daemon tries the round again. An idle workspace whose latest run is bound to its current fingerprint and not due a retry says nothing more. A workspace's execution state never changes its outcome or freshness counts.
- [x] AC2: Every answer also carries the explanation of the selection made at the latest input revision a round planned at, as ticket 2.3f AC6 logs it: the input revision; for each changed path, its owner, the workspaces it selected, each with its reasons, and the workspaces it reached that cannot run, or why it selected none; each broad fallback with its trigger and scope; and the selected and total test and workspace counts, each saying whether it is complete. When that round made no selection, the answer says why instead, with the reason the log gives: 2.3g's dependency build failed or timed out, the dependency builds stopped working, the discovery yields no selection input, selection refused the change, no build ended at the round's revision, the inputs' digests could not be read, or it was the first round of this daemon life, which has no earlier round to compare with; and before any round has planned in this daemon life, it says so. An answer lists at most a bounded number of changed paths and at most that many broad fallbacks, the bound a named constant, and, within each changed path's selected and not-runnable workspaces and each fallback's workspaces, at most that many workspaces, and counts the rest of each; the counts always cover every changed path.
- [x] AC3: A workspace whose latest stored run was stored not fingerprinted because its inputs changed while it ran (ticket 2.3h's verdict: a changed path inside its workspace's inputs, or its fingerprint at its end differing from the one at its start) reads as invalidated, with the reason that verdict gave, in the summary's latest-run facts for it, and in every answer's schedule as its due reason while it is queued and as its idle reason while no round is pending, from the moment it is stored until a later run of that workspace is stored or the daemon stops. A run stored not fingerprinted for another reason (it started with no fingerprint; or, with no changed path inside its workspace's inputs, a cause that names no path such as a watcher failure or an input set that could not be established, or an end fingerprint that could not be taken, as after a stop) is not called invalidated; a run with a changed path inside its inputs is invalidated whether or not its end fingerprint could be taken. The label is held in memory only and nothing new is written to the store; after a restart the run reads as stored not fingerprinted in an earlier daemon life, as AC1 names it, and ticket 2.3f runs it again.
- [x] AC4: When the daemon has no discovery to answer a summary or path-status query from (none is stored, or the latest stored one was refused as unreadable), its nothing-to-answer reason, in `--json` and the CLI's text alike, also says what the daemon is doing about it: its round as AC1 gives it (pending, naming what it waits for; planned at an input revision; or held after a failed scheduling step, naming the failure) and up to a bounded number of the jobs that ended with nothing stored, a named constant, each with its reason cut as an answer's reasons are, counting the rest. It stays one reason text, since a nothing-to-answer answer travels as the protocol's error, which carries its message and no other field.

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

- [x] (Support) Before the first edit, re-read the landed code of ticket 2.3h (`daemon/run-judgment.ts`: the predicate's answer, its kinds and the paths it carries; `lifecycle.ts` `#run`: the interruption, `#nothingStored` and the `RunReport` it returns) and confirm the names § Current structure of the modified files gives, since 2.3h edits `lifecycle.ts` first. Re-run the broken-tests search in § Existing tests this change breaks, over the two packages' test directories and every other tracked file (`git ls-files`), since a `--json` consumer can sit outside them (C38).
- [x] (AC1, AC3) In `packages/daemon/src/daemon/due-workspaces.ts`, give each due reason a kind, one exported constant with a members record as `TEST_STATES` has, declared in `query/answer.ts`, which `due-workspaces.ts` already imports from and the answer and the CLI read (C3, C4, C14), and have `staleReason` and `retryReason` answer the kind; `DUE_REASON`'s text stays the log's, keyed by the kind, so the log's `due:` line and the answer read one decision (C8).
- [x] (AC2) In `packages/daemon/src/daemon/round-selection.ts`, have `explainRound` return, beside `directTargets` and `selected`, the explanation it logs: the revision, and the `Selection`'s `paths`, `fallbacks` and `counts`, or the no-selection kind and reason, built from the same values its log lines are (C8). The no-selection kinds are 2.3g's `InputsNotNarrowed["kind"]` members (`SELECTION_REFUSED` among them) plus the build wait released with no build (`NO_BUILD_ENDED_KIND` today, a local string), and the scheduler's two rounds without a selection (`NO_SNAPSHOT_ENTRY`, `FIRST_ROUND_ENTRY`): name the three new kinds as exported constants beside 2.3g's, never a second enumeration of 2.3g's (C3, C4, C14).
- [x] (AC1, AC2, AC3) Create `packages/daemon/src/daemon/workspace-schedule.ts`, the scheduler's record of what it is doing and one read of it: the round (pending with what it waits for, planned at a revision, or held after a failed step until the next input change); per workspace, the due reason kind and text of the latest plan, whether its run has begun, its last run's interruption with the changed paths inside (kept until its next run begins), the verdict of each run stored in this daemon life, keyed by the stored run's id (its not-fingerprinted kind and reason, or none when it was fingerprinted), and whether a periodic retry is owed; and the latest selection's explanation, why none was made, or that no round has planned in this daemon life. A workspace's latest stored run reads invalidated, or stored not fingerprinted for a named reason, only when its run id matches a verdict held here; a not-fingerprinted latest run with no matching verdict was stored in an earlier daemon life (C12). The read gives each confirmed workspace its execution state and reason, and the explanation, bounding the changed paths and fallbacks, each changed path's selected and not-runnable workspaces, and each fallback's workspaces by a named constant declared here, 20 (G3, F3), and counting the rest, and each queued workspace's own paths and fallbacks by a second named constant, 3 (F3), drawn from those the explanation names, counting the rest (C22, C23, C24), and the interruption's paths by `MAX_NAMED_CHANGES`, the bound 2.3h's reason text uses (C23). Reading starts nothing and changes nothing (a query starts no job, `server.ts` `DaemonHandlers`). Keep the idle-reason kinds and the invalidated label open sets that one more member extends by adding an entry, never a closed switch that would need restructuring, since ticket 2.3k adds one idle reason and reuses the label; add nothing for it.
- [x] (AC1, AC2, AC3) In `packages/daemon/src/daemon/scheduler.ts`, record into the schedule as the scheduler already decides, changing no decision: each wait of `#quiesce` and the first reconciliation in `start` as the round pending, and, since `#step` awaits `#run` or `#discover` before `#quiesce` comes round again, a job in progress while the revision has moved past the latest plan's as the round pending on that job, `#plan` as the round planned with its due list, each not-current workspace `#ranAlready` held back with its due reason, and its retries, or as pending on a rediscovery when it returns one, `#selectRound` the explanation `explainRound` returns, or the `NO_SNAPSHOT_ENTRY` or `FIRST_ROUND_ENTRY` kind it decides without calling `explainRound`, `#run` the run begun and, from the `RunReport`, the stored run's id, its verdict and the interruption, and a step that throws as the round held until the next input change, with the failure's text as `Scheduler.start` logs it (AC4). Clear each mark on every way a job ends (C167): when the run returns or throws, the workspace leaves the latest plan's due list, so it never reads queued for a run that has ended before the next round decides it again; when the run never begins, it stays queued. The scheduler has 427 of lint's 500 code lines (P16), so the state lives in the new module and the scheduler only records.
- [x] (AC1, AC3) Make 2.3h's facts readable as data: in `packages/daemon/src/inputs/input-jobs.ts`, export `MAX_NAMED_CHANGES`; in `packages/daemon/src/daemon/run-judgment.ts`, export the verdict kinds (`JUDGMENT`, module-private at 90b0649) and have `RunWatch` keep the interrupting paths beside `#interruption`, whose getter gives only the reason string today (C3, C14, C59: each export gains its production reader in this ticket).
- [x] (AC1, AC3) In `packages/daemon/src/daemon/lifecycle.ts`, add to `RunReport` (declared in `scheduler.ts`) three optional fields beside `changedWhileRunning`: the stored run's id when a run was stored (`#store` discards the `StoredRun` that `writeRun` returns today), the not-fingerprinted verdict's kind and reason from 2.3h's predicate when the run was stored not fingerprinted, and the interruption's changed paths inside when a change interrupted the run, read as data from the predicate's answer, never by matching its reason text (C3, C14). The label (AC3) reads this kind, never `changedWhileRunning`, which 2.3h keeps for 2.3f's once-more rule and which is false for a run with changed paths inside and no end fingerprint (S4, as restated at 11:19). Keep `changedWhileRunning` as 2.3h leaves it. Pass the schedule's read into `DaemonView` through `#view()`. After 2.3h, `lifecycle.ts` sits near lint's cap, so keep the additions to fields and one read.
- [x] (AC1, AC2, AC3) In `packages/daemon/src/query/answer.ts`, add to `AnswerContext` the schedule (the round and each confirmed workspace's execution state and reason) and the selection explanation, with each execution state, pending wait, idle reason and no-selection kind as an exported constant with a members record, each declared once where the answer and the daemon both read it (C3, C4); the queued reasons derive from the due-reason kinds, `notFingerprinted` refined into invalidated, another reason named and an earlier daemon life, never restated (C14); take the explanation's shapes from `selection/selection-types.ts` (`ChangedPathReport`, `BroadFallback`, `SelectionCounts`) and the no-selection kinds from `InputsNotNarrowed["kind"]` rather than restating them (C14). Add to `LatestRunFacts` an optional `invalidated` with its reason. Every addition is a new field and `activity` keeps its meaning, so `CLI_JSON_SCHEMA_VERSION` stays (C151). Export from `packages/daemon/src/client.ts` each new constant and type the CLI reads, and nothing it does not (C59).
- [x] (AC1, AC2, AC3) In `packages/daemon/src/query/summary.ts`, add the schedule to `DaemonView` beside its `Pick` of `StatusResponse`, leaving `StatusResponse` unchanged; in `queryBasis`, copy the round, the explanation and each confirmed workspace's execution state into every answer's context, taking `running` from the view's `activity`, never from a second record (C8); in `latestRunFacts`, set `invalidated` only when the latest stored run's id is the one the label was held for. `path-status.ts` answers through the same `queryBasis` and needs no edit. The schedule and the label sit beside the counts and feed no outcome or freshness count (C119, C120).
- [x] (AC4) In `packages/daemon/src/query/answer.ts`, add a `roundText` beside `activityText` that phrases the round from its kind and detail; in `packages/daemon/src/query/summary.ts` `queryBasis`, append to both nothing-to-answer reasons (the no-discovery one and `refusedDiscoveryReason`) the round through `roundText` and each unstored job with its reason cut by `cutReason`, from the same `DaemonView` the answers read. The job list holds one entry per workspace and one for the discovery (`#nothingStored` lists each job once), each reason up to `MAX_REASON_CHARACTERS`, and a nothing-to-answer reason skips `queryResponse`'s size check, so name at most 20 jobs under a named constant of their own (C22, C24) and count the rest. Export `roundText` from `client.ts` for the CLI.
- [x] (AC1, AC2, AC3) In `packages/cli/src/answer-text.ts` `contextLines`, render the round through `roundText` (C8: one phrasing for the daemon's reason text and the CLI's lines), each workspace's execution state and reason on one line, and the latest selection: its revision, its changed paths with what each selected or why it selected none, its fallbacks, and its counts with their completeness, bounded as the answer is, or why no selection was made. In `packages/cli/src/commands/summary.ts` `runFacts`, show a latest run's invalidated label and reason beside its status. Every reason goes through `firstLine` or `cutReasonText`, as today.
- [x] (Support) Send the orchestrator the doc text in § Doc text, its final wording to follow the build.
- [x] (Support) Lint and typecheck: `bun x oxlint` over the changed files, `bun run --filter @rt-test/daemon typecheck` and `bun run --filter rt-test typecheck` (P14).

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
- 2.3h's predicate answer (`daemon/run-judgment.ts`): the verdict kind and the changed paths inside, as data; `MAX_NAMED_CHANGES` (`inputs/input-jobs.ts`, module-private at 90b0649, exported by this ticket): the bound 2.3h's reason text names paths by.
- `contextLines`, `firstLine`, `cutReasonText`, `INDENT` (`cli/src/answer-text.ts`), `oneLine` (`cli/src/output.ts`) and `runFacts` (`cli/src/commands/summary.ts`): the text renderer and its reason cutting.

### Must Create

- `packages/daemon/src/daemon/workspace-schedule.ts`: the schedule's state and its read (AC1 to AC3), with the bound on listed changed paths and fallbacks (AC2).
- The due-reason kinds, the three new no-selection kinds, the execution states, the round's pending kinds and the idle reasons, each an exported constant with a members record, and the schedule and explanation fields of `AnswerContext` and the `invalidated` field of `LatestRunFacts` (AC1 to AC3).
- The three optional `RunReport` fields (AC1, AC3).
- `roundText` in `query/answer.ts`, the one phrasing of the round for the daemon's nothing-to-answer reasons and the CLI (AC1, AC4).
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

- "FR5: Answer summary and `status <path>` queries through a CLI with versioned `--json` output, reporting counts per state for files and folders, without starting a test." (AC1, AC2, AC3, AC4)
- "FR7: Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts." (AC2)
- "FR8: Execute every selection in the daemon, and record a run whose inputs changed while it ran as invalidated and rerun it from stable inputs; ..." (AC3; the rest of FR8 is 2.3k's and 2.3l's)

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
- **Round** (added by this ticket, G1, reworded after review Q3, by the orchestrator at 16:15 after sanity check F1, and at 17:57 after review W2): "The daemon's decision, once the input revision has held still, its inputs have settled, its dependency build has ended, any rediscovery it needs has ended and no job begun at an earlier revision is in progress, of what to run at that revision; the selection over the paths changed since the previous round orders what it runs first and explains it. A round is pending until that decision is made, and held after a scheduling step fails until the daemon tries again."

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
- G3 (AC1, AC2), 09:12, decided by create-ticket at 09:11 and not vetoed, its held clause superseded by Q-R1 at 17:57: after a scheduling step throws, each not-current idle workspace reads no run coming until the daemon tries the held round again (`round-held`), naming its due reason; the changed-path and fallback bound is 20, its own named constant (C23), the same value as `MAX_NAMED_CHANGES` and 2.4b's `MAX_NAMED_FAILURES`.
- Facts settled by create-ticket and confirmed at 09:07: only the summary carries latest-run facts, so AC3's label lands there and every answer's schedule carries "invalidated" as a due or idle reason; AC2's no-selection kinds follow the code (2.3g's kinds, no build ended, digests unreadable, the first round of a life, no round yet), and "a round with no changed path (a retry or a rediscovery alone)" goes, since a retry or rediscovery at the same revision keeps that revision's selection; the broad fallbacks are bounded with the changed paths; `running` holds exactly when the answer's activity names the workspace.
- Ticket review, 2026-09-28 06:23 to 06:25, on the first draft: Findings applied (bounded paths in the reasons; pending-round and pending-retry reasons for an idle workspace; a refused selection and no round yet among AC2's reasons; the path-less causes kept from the label; `interrupted` ending when a round decides; the build-failure kinds taken from 2.3g's fact; the CLI text and AC1's last sentence given tasks; the broken-tests search widened to whole-answer comparisons). S2 replaced the finding that listed every due reason in a fixed order.
- Ticket review, 2026-09-29 09:12 to 09:16, on the re-verified draft, triaged by create-ticket at 09:17: applied E1 (a round held after a failed step), E2 (a queued workspace's fallbacks bounded), E3 (no round yet among the schedule's explanation states), E4 (`#selectRound`'s two kinds decided without `explainRound`), E5 (a workspace `#ranAlready` holds back keeps its due reason), E6 (a workspace whose run has ended leaves the due list), E7 (`StatusResponse` unchanged), E8 (one set of due-reason kinds, in `answer.ts`), E9 (the broken-tests search widened, see below) and E10. Q1 and Q2 settled on a fact: `writeRun` returns the `StoredRun` (`store/open-store.ts`), so `RunReport` carries the stored run's id and the label applies only to that run. Q3 applied: the glossary's Round decides what to run, and a rediscovery is one of its pending waits, as AC1 says; the wording change stays inside G1's grant.

Review questions (rt-t2-3i-review, threadId 5d6661dd), asked 17:56, decided by the orchestrator at 17:57:

- Q-R1 (AC1, G3): a held round is retried at the tracker's next change signal, which every input event read and every reconciliation give (`input-tracker.ts` `#signalChange`), not only at an input change. Answer: option (b), keep 2.3f's retry and make the answer name it: `roundText`'s held text says the daemon tries again at the next input event or reconciliation, a not-current idle workspace under a held round reads the new open-set `IDLE_REASON.roundHeld`, and `no-run-until-input-change` stays for 2.3f AC2's ran-already case. Reason: the retry is the daemon's only recovery from a transient failure. AC1's held clauses and G3 are amended to match; rejected, option (a), waiting for a moved revision, which matched the old text but left a transient failure waiting for an edit.
- W1 (AC3): the schedule carries the label as a due reason while the workspace is queued and as an idle reason while no round is pending, as AC1 gives idle reasons; AC3 is reworded to say so. Approved.
- W2 (glossary Round): the held state added, and the selection said to order and explain what runs rather than decide it. Applied to `docs/glossary.md` by the orchestrator, and quoted above.

AC1 wording, 2026-09-29 16:44, the orchestrator's correction from dev's report: the first due reason reads "it has no stored run", not "it was never run", since a first run that stored nothing or was interrupted has run; the CLI and the log already say "it has no stored run" (`DUE_REASON.noRun`).

Dev's sanity check (rt-t2-3i-dev, threadId c8361aae), 2026-09-29 16:13, answered 16:15:

- F1 CONFIRMED (AC1): `Scheduler.#step` awaits `#run` or `#discover` before `#quiesce` comes round again, so a revision that moves during a job leaves the round pending on the job in progress; AC1's pending waits and the scheduler task gain it.
- F2 CONFIRMED: `MAX_NAMED_CHANGES` (`input-jobs.ts`) and `JUDGMENT` (`run-judgment.ts`) were module-private, and `RunWatch` gave the interruption only as a reason string; a task now exports them and keeps the interrupting paths, adding two files. The orchestrator cleared the widening at 16:13.
- F3 (AC1, AC2), asked 16:14, decided by the orchestrator at 16:14, option (a): bound each changed path's selected and not-runnable workspace lists and each fallback's workspace list by the same 20, with counts of the rest; a queued workspace names at most 3 of the paths or fallbacks that chose it, drawn from those the explanation names, and counts the rest, under its own named constant. Reason: a refused answer is no answer at all, so a bound is required; (a) keeps a per-workspace reason an agent can read at a glance (what 2.4b and 2.7 show), and what remains grows only with the workspace count, which every answer already does. Rejected: leaving it as ruled, which breaks every query on a large project; counts only per workspace, which makes the agent cross-reference to learn why.
- F4 CONFIRMED (AC4): a nothing-to-answer reason skips `queryResponse`'s size check, so AC4 names at most 20 unstored jobs under its own constant and counts the rest.

AC4, 2026-09-29 15:43, asked by the orchestrator from t-store-refusal's review with the steer "yes, where 2.3i's schedule already exists", settled by create-ticket at 15:44: both nothing-to-answer reasons (no discovery stored; the latest refused as unreadable) also carry the round and the unstored jobs, as text inside the reason. Reason: with no discovery there is no confirmed workspace to give an execution state, so what explains the wait is the round (a rediscovery pending, or a step held after a failure such as a store a newer RT Test migrated) and the jobs that stored nothing (a replacement discovery that keeps failing). Structured fields were weighed and not taken: the reason travels as the protocol's nothing-to-answer error (`server.ts` `queryResponse`), which the client turns into a message (`query-client.ts` `queryErrorReason`), so fields would widen `protocol.ts`, `server.ts`, `query-client.ts` and the CLI's failure output past the file limit for facts the text already names.

S4 restated (AC3), 2026-09-29 11:19, decided by the orchestrator on 2.3h's correction (its author, 11:18, from 2.3h dev's sanity check at 11:17): the label comes from the verdict's kind (changed paths inside, or fingerprint moved), never from `changedWhileRunning`. After the correction, `changedWhileRunning` is true for changed paths inside only when an end fingerprint was taken, and for fingerprint moved; the predicate's kinds take a fixed precedence (no start fingerprint, changed paths inside, causes naming no path, end fingerprint unavailable, fingerprint moved, kept), so a run with changed paths inside and no end fingerprint has that kind and reads invalidated. The kind reaches 2.3i through the `RunReport` verdict field the lifecycle task adds.

From 2.3h's author (threadId 0929fbce), 2026-09-29 09:07, pinned in 2.3h's ticket at 97619a8: `RunReport` keeps its shape in 2.3h; an interrupted run reports `stored: false` and `changedWhileRunning: true`, and never reaches 2.3f's once-more rule. The predicate's answer is a discriminated kind (kept; changed paths inside; fingerprint moved; causes naming no path; no start fingerprint; end fingerprint unavailable) carrying every changed path inside and each cause as data, unbounded; its reason text names up to `MAX_NAMED_CHANGES` paths. An interruption's paths are the changed paths inside that a narrowed build placed there (2.3h QA).

#### Decisions taken here

- **Reasons per workspace, not per test.** Selection is at workspace granularity, so every test of a selected workspace shares its workspace's reasons (`SelectedWorkspace.reasons`); the answer carries them once per workspace and the counts per test, never `Selection.tests`, which repeats the same reasons for every test and could pass the protocol's 1 MiB line limit (`MAX_LINE_BYTES`) on a large consumer.
- **A bounded changed-path list.** A branch switch can change thousands of paths, and each can give a broad fallback; the answer names a bounded number of each and counts the rest, while the counts cover them all (C24: the count derives from the bound that cut). The interruption's paths are a different dataset, the job window's, and take 2.3h's bound (C23).
- **`activity` stays.** It keeps meaning what the daemon is doing now; the schedule adds per workspace what it will do. `running` is read from it, so the two never disagree (C8).
- **The status response is unchanged.** `status` reports the daemon's identities, activity and unstored jobs; the schedule belongs to answers about results, which 2.4b and 2.7 read.
- **A round pending is one fact for every workspace.** Until the scheduler plans at the answer's revision it has decided nothing for it, so no workspace reads queued from an older plan; the round's pending wait says why for each idle workspace, and 2.4b reads it as its "a round is pending".
- **A failed scheduling step.** After a step throws, the scheduler waits for the tracker's next change signal (`Scheduler.start`), which every input event read and every reconciliation give, so the round reads held until then, never pending, and each not-current idle workspace reads no run coming until the held round is tried again, naming its due reason (G3, Q-R1; review E1).
- **The label is keyed by the stored run's id.** A verdict held for a workspace applies only while the latest stored run is the run it was held for, so a later stored run never carries an older run's label and a run stored in this life never reads as from an earlier one (C12). After 2.3h every run the daemon stores passes through the predicate, a stop included (its end fingerprint is unavailable), so each has a held verdict.
- **The interruption's mark lasts until the workspace's next run ends or throws**, so a queued workspace names it, and a running one reads `running` before the mark is read; the label (AC3) lasts until a later run of the workspace is stored, so a later interrupted run, which stores nothing, leaves the label on the older run.

#### Design notes

- **Why an idle workspace says why.** A workspace that is stale and idle, because 2.3f AC2 already ran it at this revision and list of test modules (a run that could not be fingerprinted), would otherwise look like one whose rerun was forgotten; the reason tells `wait` and the hook that nothing will change until the next input change.
- **The label and `changedWhileRunning` answer different questions.** The label says the run's inputs changed while it ran (the verdict's kind, S4); `changedWhileRunning` says the run's inputs moved and a rerun can be bound to a fingerprint, since an end fingerprint was taken or a change interrupted it (2.3f's once-more rule). They differ for a run with changed paths inside and no end fingerprint, which is invalidated and not owed a once-more rerun. Each reads its own question once (C8).
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
- Read at 90b0649, since they landed after 97619a8 (3f14957, merged at feb139a): `daemon/job-endings.ts` holds `threwOutcome`, `interruptedRun` and `runToStore`, moved out of `lifecycle.ts`, and the new `storeFailureReason`. `lifecycle.ts` `#latestResults` also logs a refused latest discovery once (`#noteRefusal`). `query/summary.ts` `queryBasis` answers a refused latest discovery with its own nothing-to-answer reason (`refusedDiscoveryReason`) beside the no-discovery one, and neither nothing-to-answer reason carries the context 2.3i adds the schedule to.
- `client.ts`: re-exports the answer constants and types the CLI reads from `query/answer.js`.
- `cli/src/answer-text.ts` (173 lines): `NOT_NARROWED_CAUSES` keyed by `InputsNotNarrowed["kind"]`; `contextLines` (adapter version, discovery freshness, inputs, warnings, unfingerprinted workspaces, `Daemon: <activity>`, `Ended with nothing stored:`); `firstLine`, `cutReasonText`.
- `cli/src/commands/summary.ts` (98 lines): `RUN_STATUS_PHRASES`, `summaryText`, `workspaceLine`, `runFacts`.
- `CLI_JSON_SCHEMA_VERSION = 1` (`cli/src/output.ts`), unchanged.

#### Sizing

18 raw files and 23 estimated (23.4), after dev's sanity check (F2, 16:13) added `inputs/input-jobs.ts` and `daemon/run-judgment.ts`, whose facts were module-private; the size event is the orchestrator cleared the widening at 16:13. Code units 5 (4 criteria plus validation). AC4 added no file: it writes `answer.ts`, `summary.ts`, `scheduler.ts` and `client.ts`, all already listed. Production: modify `inputs/input-jobs.ts`, `daemon/run-judgment.ts`, `daemon/scheduler.ts`, `daemon/due-workspaces.ts`, `daemon/round-selection.ts`, `daemon/lifecycle.ts`, `query/answer.ts`, `query/summary.ts`, `client.ts`, `cli/src/answer-text.ts`, `cli/src/commands/summary.ts`; create `daemon/workspace-schedule.ts`. Tests, for create-tests: `query.test.ts`, `scheduler.test.ts`, `lifecycle.test.ts`, `packages/cli/test/cli.test.ts`, and the two `defects.json` beside them. Over the 20-file limit by one; the orchestrator ruled to proceed (S1). Over 10 estimated, so dev delegates, in two groups on disjoint files: the daemon side (`due-workspaces.ts`, `round-selection.ts`, `workspace-schedule.ts`, `scheduler.ts`, `lifecycle.ts`, `answer.ts`, `summary.ts`, `client.ts`), a chain, then the CLI text (`answer-text.ts`, `commands/summary.ts`), which reads its shapes.

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

- `docs/architecture.md`, the query paragraph beside § Query surface: "Every answer also carries the daemon's round (pending, naming what it waits for; planned at an input revision; or held after a failed scheduling step until the daemon tries again at the next input event or reconciliation); each confirmed workspace's execution state (running; queued, with why it is due; interrupted by a change until the next round decides it; or idle, saying why no run is coming when its results are not current); the latest selection (each changed path with what it selected, up to a bound, the broad fallbacks, and the selected and total counts, or why no selection was made); and, on a workspace's latest run, whether it was invalidated in this daemon life, with the reason. A query the daemon cannot answer because no discovery is stored, or the latest was refused as unreadable, says in its reason what the round is doing and up to 20 of the jobs that ended with nothing stored, counting the rest."
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
sizing_ac_count: 5
files_to_modify:
  - packages/daemon/src/daemon/due-workspaces.ts
  - packages/daemon/src/daemon/round-selection.ts
  - packages/daemon/src/daemon/scheduler.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/run-judgment.ts
  - packages/daemon/src/inputs/input-jobs.ts
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

Dev session: threadId c8361aae-bfb7-4c83-a186-5d0862901487

#### Test Files This Change Broke

- `packages/daemon/test/query.test.ts`: fails the daemon typecheck (line 66 and every hand-made `DaemonView`), since `DaemonView` gains a required `schedule: ScheduleReader`. Its whole-answer `toStrictEqual` comparisons gain `schedule` and `latestSelection`. Both nothing-to-answer reasons now continue after "it is <activity>" with "; <round text>" and, when any job stored nothing, "; ended with nothing stored: ...".
- `packages/cli/test/cli.test.ts`: fails the CLI typecheck (line 1373, `humanAnswer`), since `AnswerContext` gains the required `schedule` and `latestSelection`. The `contextLines` expectations gain a `Round:` line after `Daemon:`, an `Execution:` block, and a `Latest selection` line or block last.
- `packages/daemon/test/scheduler.test.ts` and `scheduling-harness.ts`: no expected break. `RunReport`'s new fields are optional, and every log line (`due:`, the two rounds without a selection, `next in the queue:`) keeps its text.
- Named-defect records whose `old` anchor no longer matches, each moved by an edit this ticket needs: D1841, D1842, D1845 (`lifecycle.ts` `#view()` now returns `schedule`), D2740 (`lifecycle.ts` `report(...)` takes the ended run), D2655 (`scheduler.ts` `#quiesce` records each wait between `settled()` and `awaitBuild`), D2693 (`scheduler.ts` `#armRetries` now calls `retryOwed` in `due-workspaces.ts`), D2734 and D2741 (`round-selection.ts` `noSelection` takes the revision, and `NO_BUILD_ENDED` replaced the local `NO_BUILD_ENDED_KIND`), D2933 (`summary.ts` `refusedDiscoveryReason` takes the daemon clause). Checked by matching every record's `old` against its file at 16:42; every other record in the edited files still matches once. The re-proof list in § Named-defect records the edits reach also gains `run-judgment.ts` and `input-jobs.ts`, whose records all still match.
- `PROTOCOL_VERSION` moves from 1 to 2 (`packages/daemon/src/daemon/protocol.ts`, ordered by the orchestrator at 16:44), since answers gain required fields and an older daemon must be refused with the version mismatch message. No defect record anchors on that line. Found by a search over every tracked file for a literal `protocolVersion` value, `protocol version <n>` or arithmetic on `PROTOCOL_VERSION` (16:44). No hit is outside the test files. The hits fall into two groups:
  - **Pinned to 1, the old current version**, which now reads as a mismatch: `packages/cli/test/cli.test.ts` 931, 1007, 1375; `packages/daemon/test/lifecycle.test.ts` 119; `packages/daemon/test/server.test.ts` 40, 42, 43, 165, 191, 209, 216, 348, 457, 480; `packages/daemon/test/daemon.test.ts` 209, 214, 431, 587 (the start log's text "protocol version 1"), 859.
  - **Using 2 as the deliberately mismatched version**, which now equals the current version, so the case stops testing a mismatch: `packages/daemon/test/server.test.ts` 371, 489, 502; `packages/daemon/test/daemon.test.ts` 890 (`/process 4242\b.*protocol version 2\b.*can be stopped/`, D1503's test per ticket 1.3c). These want a version derived from `PROTOCOL_VERSION` (such as `PROTOCOL_VERSION + 1`), so the next bump does not break them again.

#### ACs Owed a Test

- AC1: each answer's `schedule` gives exactly one execution state per confirmed workspace. It gives `running` exactly while `activity` names the run; `queued` only while the plan made at the answer's revision holds it due, with its one refined due reason, at most 3 choosing reasons and its interruption; `interrupted` from an interrupted run's return until the next plan; and otherwise `idle`, saying `retry-pending` or `no-run-until-input-change` only when no round is pending. The round is pending on the right wait, including `job-in-progress` once the revision moves during a run or discovery, planned, or held with the failure. Its evidence here is a traced path and a throwaway probe of `WorkspaceSchedule`; the joins through `Scheduler` and `DaemonLifecycle` into an answer need a test.
- AC2: `latestSelection` carries the explanation of the latest round's selection, with paths, fallbacks and each inner workspace list bounded at 20 and counted, and the counts. When no selection was made it names the no-selection kind and reason (including `first-round` and `input-digests-unread`), and `no-round-yet` before any plan.
- AC3: a run stored not fingerprinted with a `changed-inside` or `moved` verdict reads `invalidated` in `summary`'s `latestRun` and as its due or idle reason, keyed by run id. The other three verdict kinds read `not-fingerprinted` with their reason, and a run with no held verdict reads `earlier-daemon-life`.
- AC4: both nothing-to-answer reasons carry the round text and up to 20 unstored jobs, each reason cut, with a count of the rest.

#### Tests Owed

- The orchestrator's 17:05 addition, taking a named defect from the tests member's range. The defect: a discovery is stored bound to its fingerprint although a protected file no watch covers (a gitignored listed test module or setup file) was edited between the first `protectedFileChangedSince` check in `#protectDiscovered` and the composition of the fingerprint in `#discover`, so it reads as current under content it never collected. The guarantee: such a discovery is stored not fingerprinted, with the reason naming the file. Its mutation is to return `print` whatever `moved` holds in the `#discover` fingerprint closure (`lifecycle.ts`).
- D1987's `old` anchor (`lifecycle.ts`, the fingerprint taken after protection) no longer matches, since the fingerprint closure in `#discover` it quoted now also checks again. Re-anchor it on the new closure and re-prove it.

### Tests Record

Tests session: threadId d599b63d-e165-46ef-812e-bcae2f15df8d

#### Named Defects

- D2971: A daemon still reconciling its inputs for the first time reports its round as waiting out the quiet window, so an answer names a wait that has not begun. (AC1)
- D2972: The scheduler records no quiet-window wait, so while the input revision is still moving the round keeps naming the wait before it. (AC1)
- D2973: The scheduler records no wait for the unread input events, so while they are read the round names the quiet window it already waited out. (AC1)
- D2974: The scheduler records no wait for the dependency build, so while the build runs the round names the settling of the inputs instead. (AC1)
- D2975: A plan that returns a rediscovery leaves the round naming the dependency build it already waited for, so an answer never says a rediscovery is what the round waits on. (AC1)
- D2976: Once the revision moves while a run begun at an earlier one is still in progress, the round names the last wait the scheduler passed instead of the job it now waits on. (AC1)
- D2977: A plan is recorded at the wrong revision, so an answer at the revision the round planned at reads the round as still pending. (AC1)
- D2978: A scheduling step that throws leaves the round reading planned, so an answer never says no round comes until the next input change, nor names the failure. (AC1)
- D2979: A workspace whose run the answer's activity names is not read as running, so it reads queued while its run is in progress. (AC1)
- D2980: A workspace the latest plan found due, whose run has not begun, reads idle rather than queued. (AC1)
- D2981: A workspace an older plan found due still reads queued after the input revision moves past that plan, a reason RT Test no longer acts on. (AC1)
- D2982: While a round is pending, an idle workspace that is not current claims no run comes until the next input change, although the pending round is about to decide it. (AC1)
- D2983: A workspace whose run has returned stays on the plan's due list, so it reads queued for a run that has already ended. (AC1)
- D2984: A workspace whose run a change interrupted is never marked interrupted, so after its run returns it reads idle rather than interrupted. (AC1)
- D2985: An interrupted workspace keeps reading interrupted after the next round has found it due, instead of queued. (AC1)
- D2986: An interruption names more paths than the bound its reason text uses, so an answer's interruption list grows past 20. (AC1)
- D2987: An idle workspace whose latest run failed says no run comes until the next input change, although the periodic reconciliation retries it. (AC1)
- D2988: An idle workspace whose results are not current but owe no retry says nothing about why no run has begun, so it looks like a forgotten rerun. (AC1)
- D2989: After a scheduling step fails, an idle workspace that is not current says nothing, so an answer never says no run comes until the next input change. (AC1)
- D2990: A run stored not fingerprinted because a path inside its inputs changed while it ran reads only as stored not fingerprinted, never as invalidated. (AC1, AC3)
- D2991: A run stored not fingerprinted because its workspace's fingerprint moved while it ran is not called invalidated. (AC1, AC3)
- D2992: A run stored not fingerprinted for a cause that names no path, such as a watcher failure, is called invalidated although no input is known to have changed. (AC1, AC3)
- D2993: A run stored not fingerprinted in an earlier daemon life, whose verdict this daemon does not hold, reads as stored not fingerprinted with no word that its reason is unknown. (AC1, AC3)
- D2994: A verdict held for a workspace's earlier run labels whatever run of it is latest, so a later run stored under its fingerprint reads invalidated. (AC3)
- D2995: The scheduler never hands the schedule the round's selection, so a queued workspace names no changed path that chose it. (AC1)
- D2996: A queued workspace names more than 3 of the reasons that chose it. (AC1)
- D2997: A reason that chose a workspace through a broad fallback does not name the fallback's scope, so it reads like a direct selection. (AC1)
- D2998: A queued workspace names a changed path that the answer's explanation leaves out past its 20, so the reason points at a path the answer never shows. (AC1)
- D2999: Before any round has planned in this daemon life, the answer reads as though a selection was made rather than saying no round has planned. (AC2)
- D3000: The first round of a daemon life, which has no earlier round to compare with, is explained as one whose inputs' digests could not be read. (AC2)
- D3001: A round whose inputs' digests could not be read is explained as a first round, hiding that the inputs were unreadable. (AC2)
- D3002: A round's selection is explained at the wrong input revision, so an answer cannot tell which change the explanation is for. (AC2)
- D3003: A round with no selection because the dependency build failed is explained as one whose build wait was released, losing the build's kind. (AC2)
- D3004: A round whose selection refused the change is explained as one whose build wait was released. (AC2)
- D3005: A round whose build wait was released with no build ended is explained as a refused selection. (AC2)
- D3006: An answer names more than 20 changed paths, so a branch switch's thousands of paths grow every answer past its bound. (AC2)
- D3007: An answer names more than 20 broad fallbacks. (AC2)
- D3008: A changed path names more than 20 of the workspaces it selected. (AC2)
- D3009: A changed path names more than 20 of the workspaces it reached that cannot run. (AC2)
- D3010: A broad fallback names more than 20 of its workspaces. (AC2)
- D3011: Why a round made no selection is carried whole, so a reason quoting a long path list is not cut to 1,000 characters. (AC2)
- D3012: Why a workspace a changed path reached cannot run is carried whole, so the bound on the list no longer bounds its bytes. (AC2)
- D3013: A summary never reads the invalidated label the daemon holds, so a workspace's latest run stored not fingerprinted by a change inside its inputs reads like any other run stored not fingerprinted. (AC3)
- D3014: A query with no stored discovery to answer from says only the daemon's activity, never what its round waits for, so an agent cannot tell a rediscovery on its way from none. (AC4)
- D3015: A query whose latest discovery was refused as unreadable says only the daemon's activity, never that the round is held after a failed step nor the failure. (AC4)
- D3016: A nothing-to-answer reason names more than 20 of the jobs that ended with nothing stored, so it grows without bound, unchecked by the answer's size check. (AC4)
- D3017: A nothing-to-answer reason quotes each unstored job's reason whole, so one long reason grows it without bound. (AC4)
- D3018: The invalidated label is read from whether a rerun could be bound to a fingerprint rather than from the verdict's kind, so a run with a changed path inside its inputs and no end fingerprint is not called invalidated. (AC3)
- D3019: The lifecycle's report of an interrupted run leaves out the paths that interrupted it, so an answer reads the workspace idle rather than interrupted by a change. (AC1)
- D3020: The schedule is read against an activity other than the answer's own, so a workspace whose run the answer's activity names reads queued rather than running. (AC1)
- D3021: The CLI's text answer leaves out the daemon's round, so a person reading it cannot tell a pending round from a held one. (AC1)
- D3022: The CLI's text phrases an invalidated latest run as merely stored not fingerprinted, so the text never says the run is invalidated. (AC3)
- D3023: The CLI's line for a queued workspace leaves out the changed paths and fallbacks that chose it. (AC1)
- D3024: The CLI's line for an idle workspace that is not current says only idle, never why no run has begun. (AC1)
- D3025: The CLI's text names a bounded list's items without counting those it left out, so an interruption's path list reads as complete. (AC1)
- D3026: The CLI's latest selection leaves out how many changed paths the answer did not name, so a cut list reads as every changed path. (AC2)
- D3027: The CLI's latest selection prints an incomplete total count as though it were complete. (AC2)
- D3028: The CLI phrases why a round made no selection from the inputs' not-narrowed causes alone, so a cause only a round has, such as unreadable digests, reads as undefined. (AC2)
- D3029: A human summary's workspace line leaves out its latest run's invalidated label and reason. (AC3)
- D3030: A discovery is stored bound to its fingerprint although a listed file no watch covers was edited after protection's check and before the fingerprint was composed, so it reads current under content it never collected. (Tests Owed, the orchestrator's 17:05 addition)
- D3031: A workspace's interruption is kept after a later run of it has ended, so when it is next queued it still names paths that interrupted a run before its last. (AC1)
- D3032: The CLI's line for a changed path that selected no workspace leaves out why, so a path no workspace depends on reads like an unexplained gap. (AC2)
- D3033: The CLI's line for a changed path leaves out the workspaces it reached that cannot run, so a broken workspace the change affects goes unmentioned. (AC2)
- D3034: The CLI's selection reason leaves out the chain of workspaces it passed through, so a workspace selected through a dependency reads as though its own file changed. (AC2)
- D3035: A workspace's interruption is kept after a later run of it threw, so when it is next queued it still names paths that interrupted a run before its last. (AC1)
- Re-anchored onto the code this ticket moved, each keeping its defect: D1841, D1842, D1845 (`#view()` returns the schedule), D2740 (`report` takes the ended run), D2655 (`#quiesce` records its waits), D2693 (`#armRetries` calls `retryOwed`, mutated to pass that nothing was stored as false), D2734 and D2741 (`noSelection` takes the revision; `NO_BUILD_ENDED` is the answer's constant), D2933 (`refusedDiscoveryReason` takes the daemon clause), and D1987 (the `#discover` fingerprint closure now checks again; its mutation still composes the fingerprint before protection, with no re-check).
- Rewritten as vacuous after dev's 17:07 re-check: D1879 and D2090. Their stand-in reported the listed module changed before and after protection, so the re-check also caught it and their mutations of the first check survived. They now model a module a declared pattern kept unwatched, changed until protection reads it into the inputs and unseen by any later check, which is how the tracker answers (`protectedFileChangedSince` skips paths already in the digests). The orchestrator ruled at 17:21 to keep both checks.
- Re-pointed to the moved protocol version, with no record change: the mismatch cases (`server.test.ts` D1449, D1569, D1570; `daemon.test.ts` D1502, D1503) take `PROTOCOL_VERSION + 1`, and every current-version pin reads `PROTOCOL_VERSION`, so the next bump cannot turn a mismatch test into a match.

- D3086: The CLI's selection reason leaves out a chain step's detail, so why a workspace was reached through a dependency goes unsaid. (AC2, review row 1)
- D3087: A chain step's detail is carried whole, so one long widening cause repeated across the named paths and workspaces grows an answer past its bound. (AC2, review row 2)
- D3088: A changed path that selected no workspace because every workspace it reached cannot run lists none of them, so those workspaces vanish uncounted. (AC2, review row 3)
- D3089: Under a held round, an idle workspace that is not current says no run comes until the next input change, although the daemon tries the round again at the next input event or reconciliation. (AC1, review row 4)
- D3090: A queued workspace whose current input fingerprint cannot be computed does not say why. (AC1, review row 5)
- D3095: Between two runs of one round at an unmoved revision, the round flips to pending and every workspace still due reads idle instead of queued. (AC1, review row 6)
- D3096: A discovery begun at an earlier revision leaves the round naming a rediscovery rather than the job in progress once the revision moves. (AC1, review row 7)
- D3097: A run stored not fingerprinted and owed once more at an unmoved revision leaves the due list, so until the next plan it reads idle with no run coming, although it is about to run again. (AC1, review row 8)
- D3098: A run that stored nothing, though its inputs changed at an unmoved revision, is requeued as stored not fingerprinted, so its due reason is read from an older run. (AC1, review row 8)
- D3099: A query reads the schedule at a revision other than the answer's, so a round planned at the answer's revision reads pending and every queued workspace reads idle. (AC1, review row 9)
- D3100: The discovery's re-check measures from when the fingerprint is composed rather than from the job's start, so an edit during the job more than 2 s before the fingerprint escapes it. (the orchestrator's 17:05 addition, review row 10)
- D3101: The CLI's latest selection drops how many broad fallbacks it did not name. (AC2, review row 11)
- D3102: The CLI's latest selection prints an incomplete workspace total as complete. (AC2, review row 11)
- D3103: The CLI's line for a queued workspace leaves out that its last run was interrupted and by which paths. (AC1, review row 12)
- D3104: The CLI's line for a queued workspace every reason of which the answer leaves unnamed says nothing of them. (AC1, review row 12)
- D3105: After a failed step, the round stays held once the scheduler tries again, so an answer names a failure the daemon has moved past. (AC1, review row 13)
- The review's gap round also repaired D2989 (a held round's idle reason is now `round-held`), D3015 (the held round's new text) and D3034 (a chain step's detail is a cut reason, now shown), re-anchored D3008 (`explainedSelection`), D3032 (the nothing-selected detail's new condition) and D3033 (the not-runnable list shown whatever was selected), reworded D2978's defect sentence to the held round's new meaning, and gave D3026 and D3027's shared fixture two unnamed fallbacks and an incomplete workspace total for D3101 and D3102.

#### Deliberately Untested

- packages/daemon/src/client.ts: re-exports only.
- packages/daemon/src/inputs/input-jobs.ts: the export of `MAX_NAMED_CHANGES` only; its use as the interruption's bound is pinned by D2986.
- packages/daemon/src/daemon/protocol.ts: the version constant only; every test that pins a version now derives it, as listed above.
- packages/daemon/src/query/answer.ts: constants and types, and `roundText`, whose phrasing D3014, D3015 and D3021 pin through their readers.
- packages/daemon/src/daemon/workspace-schedule.ts `runThrew`'s `#leaveDue`: unobservable, since a thrown run holds the round and a held round reads no workspace queued until the next plan replaces the due list.
- packages/daemon/src/daemon/workspace-schedule.ts `explainedPath`'s cut of a nothing-selected detail: the same `cutReason` call and bound D3012 proves for a not-runnable reason; left without its own record when the range ran out.
- AC1's last sentence (an execution state never changes outcome or freshness counts): no code path joins the schedule to the counts, so no single edit produces the defect; the counts' own tests in `query.test.ts` pass with the schedule present.

### Review Record

Review session: threadId 5d6661dd-2a11-4b6a-9b56-fad25e9f18c1

Reviewed 2026-09-29 17:47 to 18:01 against the working tree on `main` at 90b0649, with five fresh-eyes batches (scheduling, lifecycle, query, protocol, CLI) and two doc-verify agents over the authoring commits b212700, 9f79848 and beac0fc and the uncommitted glossary Round edit.

#### Fixes applied

- The answer's selection cuts each chain step's `detail` (`workspace-schedule.ts` `explainedSelection`, types derived in `answer.ts`), so the bound on each list bounds its bytes but for each chain's length; the CLI renders the detail as the log does.
- The CLI's chosen-by count says "reasons", since `choosingIndex` counts one per path and trigger, fallbacks included, not paths.
- The CLI lists a changed path's not-runnable workspaces, bounded and counted, whether or not it selected any; a path that selected none only because its workspaces cannot run gives its kind beside that list instead of the joined reason cut to one line.
- The CLI's failed and crashed due phrases state the cause only, so the idle frame no longer says "retried" twice.
- Q-R1 (b): `roundText`'s held text, the new `IDLE_REASON.roundHeld` and its CLI phrase, and the `RoundFacts` and `Scheduler.start` doc comments.
- Doc comments: `CutReason` (the full text is in the store or the daemon log) and `DaemonView`.
- This record: AC1's held clauses, AC3 (W1), G3, the Round quote (W2), the FR8 excerpt, the interruption mark's end, `changedWhileRunning`'s description, the job-endings bullet's commit, `oneLine`'s file, the Doc text's held round and unstored-job bound, and the File List's test files.

#### Tech debt, undisposed

Worked after the commit, by the review's Step 9.

- (Pre-existing, Guarantee) A gitignored setup or global setup file is mtime-checked during a discovery (`protectedFiles`), but neither `discoveryFingerprint` nor the workspace fingerprint digests it: among files outside the project digests they digest only `inputs.testModules`. An edit to one after a discovery or run is stored leaves both reading current, although setup files run during collection and every test. Suggested: digest protected setup and global setup files outside the project digests in both fingerprints, as unselected test modules are.
- (Pre-existing, extended by the orchestrator's 17:05 re-check) A discovery stored not fingerprinted is not discovered again until the input revision moves: `#discoveryDue` refuses a revision already tried, `#armRetries` retries only a discovery that stored nothing, and an edit to a gitignored file moves no revision. A gitignored generated test module written up to 2 s before a discovery started trips the re-check's mtime tolerance, so a codegen step can leave the test list not current with no job coming. No stale result reads current. Ask whether 2.3l owns it; otherwise give `DiscoverReport` a once-more rule like runs'.
- (Pre-existing) The run's `#activity` reads running before `inputs.settled()` and `#beginsNothing`, so a run that never begins reads `running` rather than `queued`; and it stays running through `endJob` after the executor returns, so an interrupted run reads `running` until then. AC1 defines `running` by the activity, so this is consistent, and 2.4b reads these states.
- (Pre-existing) A protected file that cannot be statted (`modifiedAt` returns undefined) fails every discovery's fingerprint, while the fingerprint itself digests a missing module as absent.
- (Pre-existing, now feeds the answer) `#explain` clears `#selectionOwed`, and `#selectRound` advances `#snapshot`, before selection can throw; a replan at the same revision then records no explanation for it, and the next comparison starts from that snapshot, so its changed paths are never explained.
- (Duplication) The CLI's selection text (`answer-text.ts` `pathText`, `selectedText`, `reasonText`, `fallbackText`, `countsText`, `NO_OWNER`) and `DUE_PHRASES` restate the log's phrasing (`round-selection.ts` `pathText` to `countText`; `due-workspaces.ts` `DUE_REASON_TEXT`), and the copies already differ (the workspace total's incomplete mark). 2.4c will render beside `answer-text.ts`.
- (Pre-existing) A full answer carries `unstoredJobs` uncut, while a nothing-to-answer reason names at most 20 and cuts each.
- (Pre-existing, Guarantee) `proven-connection.ts` `requireAnswer` checks an answer's type, never its `protocolVersion`, so a proven daemon answering a hello with another version would have its answers used; `server.ts`'s check of a request's version after a matched hello is untested past a missing version (D1539); and every mismatch test sends only `PROTOCOL_VERSION + 1`, so a daemon accepting older clients (`<=`) passes them.
- (Pre-existing) `lifecycle.ts`'s class doc says a discovery is stored under the fingerprint it started from; the fingerprint is composed after protection.
- (Pre-existing) The discovery re-check rests on mtime with a 2 s tolerance: a write that keeps an older mtime (`cp -p`, archive extraction) or a filesystem clock more than 2 s behind escapes both checks.

#### Test Coverage Gaps

Denominator: 65 named-defect tests this lane added (D2971 to D3035) against the four criteria and the 17:05 addition; the rows below are the behaviors none of them pins, and the tests this review's fixes changed.

| #   | Source                                                                     | Named defect                                                                                                                                                                                                                                                                                                                 | Expected test                                                                                                                                                                                                                                                                                                                                                                                             | Severity                                           |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | `cli/src/answer-text.ts` `reasonText`                                      | The CLI's selection reason leaves out a chain step's detail, so why a workspace was reached through a dependency (an unresolved override, an alias rewrite) goes unsaid.                                                                                                                                                     | D3034's fixture gives the step `detail` as a `CutReason` (its step fixture fails the CLI typecheck) and its expected line gains ` (the override cannot be resolved)`; a new record mutates the detail clause to `""`.                                                                                                                                                                                     | HIGH (consumer text drops a fact the JSON carries) |
| 2   | `daemon/workspace-schedule.ts` `explainedSelection`                        | A chain step's detail is carried whole, so one long widening cause repeated across 20 paths and 20 workspaces grows every answer past its bound.                                                                                                                                                                             | A schedule test with a step detail over 1,000 characters expecting it cut; mutation `detail: cutReason(step.detail)` to `detail: { reason: step.detail, omittedCharacters: 0 }`. Re-anchor D3008 on `selected: mappedList(report.selected, MAX_EXPLAINED, explainedSelection),` and re-prove it.                                                                                                          | MEDIUM                                             |
| 3   | `cli/src/answer-text.ts` `pathText`, `selectedText`                        | A changed path that selected no workspace because every workspace it reached cannot run names only the first line of the joined reason, so the rest of those workspaces vanish uncounted.                                                                                                                                    | A human answer with `nothingSelected` of kind `only-not-runnable` and two not-runnable workspaces, one with a multi-line reason, expecting both listed; mutation restores `isEmpty(path.selected) \|\| isEmpty(path.notRunnable)` in `pathText`. Re-anchor D3032 (its `none.detail` line moved into `const detail = ...`) and D3033 (`const notRunnable = isEmpty(path.notRunnable)`), and re-prove both. | MEDIUM                                             |
| 4   | `daemon/workspace-schedule.ts` `idleReason`, `query/answer.ts` `roundText` | Under a held round, an idle workspace that is not current says no run comes until the next input change, although the daemon tries the round again at the next input event or reconciliation.                                                                                                                                | D2989 now expects `why: "round-held"`; a new record mutates `if (round.state === ROUND.held) return IDLE_REASON.roundHeld;` away. Update every expectation pinning the held round's old text ("no round comes until the next input change"), which D3015's expected reason in `query.test.ts` does, and D2978's defect sentence. Ids from the orchestrator.                                               | HIGH                                               |
| 5   | `daemon/workspace-schedule.ts` `#dueFacts`                                 | A queued workspace whose current input fingerprint cannot be computed does not say why, although AC1 requires naming it.                                                                                                                                                                                                     | A schedule test with `fingerprintOf` failing with a reason, expecting `due: { kind: "no-current-fingerprint", detail: { reason, ... } }`; mutation drops the detail.                                                                                                                                                                                                                                      | HIGH                                               |
| 6   | `daemon/workspace-schedule.ts` `waiting`                                   | Between two runs of one round at an unmoved revision, the round flips to pending and every workspace still due reads idle instead of queued.                                                                                                                                                                                 | In D2983's setup, assert the round is `{ state: "planned", revision: 1 }` and `b` reads queued; a new record removes the keep-plan branch of `waiting`.                                                                                                                                                                                                                                                   | HIGH                                               |
| 7   | `daemon/scheduler.ts` `#discover`                                          | A discovery begun at an earlier revision leaves the round naming a rediscovery rather than the job in progress once the revision moves.                                                                                                                                                                                      | Like D2976, hold the discovery (`discoveryHeld`), move the revision, expect `waitsFor: "job-in-progress"`; mutation unwraps `this.#schedule.during(...)` in `#discover`.                                                                                                                                                                                                                                  | MEDIUM                                             |
| 8   | `daemon/workspace-schedule.ts` `runEnded`                                  | A run stored not fingerprinted and owed once more at an unmoved revision leaves the due list, so until the next plan it reads idle with no run coming, although it is about to run again; and without the `runId` guard an interrupted run that stored nothing is requeued as stored not fingerprinted against an older run. | Read the execution while the post-run quiesce is held (`heldFrom(2)` on `awaitBuild`) after a `changedWhileRunning` run at an unmoved revision, once stored and once not stored with `interruptedBy`; records for the requeue and the guard.                                                                                                                                                              | MEDIUM                                             |
| 9   | `query/summary.ts` `queryBasis`                                            | A query reads the schedule at a revision other than the answer's, so a planned round reads pending and every queued workspace reads idle.                                                                                                                                                                                    | A query test through `summaryAnswer` with a planned round, expecting a queued and an idle not-running workspace; mutation `revision: inputs.facts.revision - 1`.                                                                                                                                                                                                                                          | HIGH                                               |
| 10  | `daemon/lifecycle.ts` `#discover`                                          | The discovery's re-check measures from the wrong time, so an edit more than 2 s before the fingerprint is composed escapes it.                                                                                                                                                                                               | The stand-in's `protectedFileChangedSince` records each `since`; D3030 (or a new record) asserts the re-check received the discovery's start (`jobStarts`); mutation passes `Date.now()`.                                                                                                                                                                                                                 | MEDIUM                                             |
| 11  | `cli/src/answer-text.ts` `selectionLines`, `countsText`                    | The CLI's latest selection drops how many broad fallbacks it did not name, or prints an incomplete workspace total as complete.                                                                                                                                                                                              | Set `fallbacks.more` to 2 and `totalWorkspaces.complete` to false in the made-selection fixture; one record per mutation (delete the fallbacks' `moreLines`; drop `INCOMPLETE_MARK` from the workspace total).                                                                                                                                                                                            | HIGH                                               |
| 12  | `cli/src/answer-text.ts` `executionText`, `chosenText`                     | The CLI's line for a queued workspace leaves out that its last run was interrupted and by which paths, or, when every reason that chose it is unnamed, says nothing of them.                                                                                                                                                 | Queued fixtures with `interruptedBy` set, and with `chosenBy: { named: [], more: 2 }` expecting "chosen for 2 reasons the latest selection does not name"; one record per branch.                                                                                                                                                                                                                         | HIGH                                               |
| 13  | `daemon/workspace-schedule.ts` `waiting`, `pending`                        | After a failed step, the round stays held once the scheduler tries again, so an answer names a failure the daemon has moved past.                                                                                                                                                                                            | Throw once, then signal a change, expecting the round pending; mutation keeps a held round in `waiting`.                                                                                                                                                                                                                                                                                                  | MEDIUM                                             |

### Completion Notes

Built on `main` at 90b0649 in the main checkout by rt-t2-3i-dev, 2026-09-29 16:07 to 16:42, as one dependency chain with no delegation: the CLI renders the shapes the daemon defines, so no two task groups were independent.

- **Sanity check** (sent 16:13; the author replied 16:15 and applied every correction to this ticket). F1: AC1 gains the job-in-progress wait. F2: the file list gains `input-jobs.ts` and `run-judgment.ts`, and the orchestrator cleared the widening at 16:13. F3: the orchestrator ruled option (a) at 16:14, bounding the inner workspace lists at 20 and a queued workspace's choosing reasons at 3. F4: AC4 names up to 20 unstored jobs.
- **Unverified assumptions**: none; the ticket calls no third-party behavior.
- **What was built.**
  - The due reasons are kinds (`DUE_REASON` in `answer.ts`); the log's text is `DUE_REASON_TEXT` in `due-workspaces.ts`, which keeps every `return DUE_REASON.<kind>;` anchor.
  - `retryOwed` answers the periodic-retry question once, for the scheduler and the schedule's read.
  - `explainRound` returns the `RoundExplanation` it logs.
  - `workspace-schedule.ts` holds the round, the current wait, the job's revision, the plan's due list, the interruptions, the stored runs' verdicts and a per-selection index of choosing reasons, and gives one read.
  - The scheduler records into it and changes no decision.
  - The lifecycle reports the stored run's id, its not-kept verdict and the interrupting paths, and passes the schedule reader through `#view()`.
  - `queryBasis` reads the schedule into every answer, and both nothing-to-answer reasons.
  - The CLI renders the round, one execution line per workspace, the latest selection and the invalidated label.
- **Choices within the ticket.**
  - A held round names no revision: the scheduler's catch would have had to read the inputs to learn it, and a throw there would stop the scheduler.
  - A wait at the revision the latest plan read leaves that plan in effect, so the other due workspaces do not flicker to idle between the runs of one round.
  - A run owed once more at an unmoved revision stays queued as stored not fingerprinted rather than leaving the due list (adversarial R1).
  - The explanation's not-runnable reasons and nothing-selected detail are cut, so the 20 bound bounds bytes (R2).
  - A choosing reason is named only when the explanation names its path and, for a broad fallback, the fallback (R6).
- **Adversarial review** (general-purpose agent, 16:29 to 16:38): 10 findings.
  - Fixed: R1 to R8, and R10's lazy fingerprint and the helper rename.
  - Discarded R9 (the CLI keeps its own phrasing of the log's selection text): the CLI renders human text itself, as `NOT_NARROWED_CAUSES` already does, the JSON carries the kinds, and the ticket applies one phrasing to the round only.
  - Discarded R10's layering note: daemon modules already import query modules, and `cutReason` stays in `summary.ts` because D1816 anchors `MAX_REASON_CHARACTERS` there.
  - R7's finding that "it was never run" is false for a first run that stored nothing also applies to AC1's wording. The CLI says "it has no stored run", as the log does.
- **Validation** (16:41 to 16:42): `bun x oxlint` and `bun x prettier --check` over the 13 production files exit 0 with no warning. Both workspace typechecks report errors only in `test/query.test.ts` and `test/cli.test.ts`, listed above. `node scripts/check-line-citations.mjs` is clean. Code lines: `scheduler.ts` 491 and `lifecycle.ts` 490, of lint's 500.
- **Residual, not fixed**: each workspace an interruption marked names up to 20 paths until its next run ends, so answers grow by about 1 KB per marked workspace. Marks do not accumulate in practice, since the interrupted workspace is due first in the next round; the reach is not measured.
- **README**: the change is user-visible; the exact text went to the orchestrator in the dev report, since the dispatch does not grant the file.
- **The orchestrator's 17:05 addition** (found by 2.3m dev's R1, verified by the orchestrator; no file added):
  - The false freshness: `#protectDiscovered` read `protectedFileChangedSince` before awaiting `protectInputs`, and the discovery's fingerprint was composed only later in `#bindings`. So a protected file no watch covers, edited between the two, entered the stored digest with content the discovery never collected.
  - The fix: `#discover`'s fingerprint closure now composes the fingerprint, then runs `protectedFileChangedSince(discovery, startedAt)` again on the same view. When that names a file, it returns a failed fingerprint with that reason, so `#bindings` stores the discovery not fingerprinted and logs why.
  - Why the check runs again rather than moving: the later check stats exactly the protected files outside the view's digests, which are the ones the fingerprint reads directly. The first check stays, since it covers the files protection moves into the inputs, which the later one skips.
  - Gates at 17:06: `bun x oxlint` and `bun x prettier --check` on `lifecycle.ts` exit 0. `bun run --filter @rt-test/daemon typecheck` shows no source error; its one error is in `test/lifecycle.test.ts` line 3259, which the tests member is editing. `lifecycle.ts` has 497 of lint's 500 code lines.

### File List

- packages/daemon/src/daemon/workspace-schedule.ts (created)
- packages/daemon/src/daemon/protocol.ts (`PROTOCOL_VERSION` 1 to 2, under the orchestrator's 16:44 grant)
- packages/daemon/src/daemon/due-workspaces.ts
- packages/daemon/src/daemon/round-selection.ts
- packages/daemon/src/daemon/scheduler.ts
- packages/daemon/src/daemon/lifecycle.ts
- packages/daemon/src/daemon/run-judgment.ts
- packages/daemon/src/inputs/input-jobs.ts
- packages/daemon/src/query/answer.ts
- packages/daemon/src/query/summary.ts
- packages/daemon/src/client.ts
- packages/cli/src/answer-text.ts
- packages/cli/src/commands/summary.ts
- _agent-docs/tickets/2-3i-schedule-answers.md (task boxes, Dev Handoff, Completion Notes, File List)
- packages/daemon/test/scheduler.test.ts, packages/daemon/test/scheduling-harness.ts, packages/daemon/test/lifecycle.test.ts, packages/daemon/test/query.test.ts, packages/daemon/test/server.test.ts, packages/daemon/test/daemon.test.ts, packages/daemon/test/defects.json, packages/cli/test/cli.test.ts, packages/cli/test/defects.json (create-tests)
- docs/glossary.md (Round reworded by the orchestrator at 16:15 and 17:57; rides this lane)
- packages/daemon/src/daemon/workspace-schedule.ts, packages/daemon/src/daemon/scheduler.ts, packages/daemon/src/query/answer.ts, packages/daemon/src/query/summary.ts, packages/cli/src/answer-text.ts, _agent-docs/tickets/2-3i-schedule-answers.md (review fixes)

- _agent-docs/tickets/2-3i-schedule-answers.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3i added and linked, under the orchestrator's 06:10 grant)
- _agent-docs/tickets/2-3i-schedule-answers.md (re-verified and rewritten by create-ticket, 2026-09-29, against `main` at 97619a8, with the 09:07 and 09:12 rulings and the 09:17 review)
- docs/glossary.md (**Execution state** and **Round** added, under the orchestrator's 09:12 grant for exactly those two entries)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3i scope, under the 2026-09-29 dispatch's grant)
- _agent-docs/sprint-status.yaml (2-3i-schedule-answers to ready-for-dev, under the same grant)
- _agent-docs/tickets/2-3i-schedule-answers.md (AC3, the lifecycle task and the notes amended to the orchestrator's 11:19 restatement of S4)
- _agent-docs/tickets/2-3i-schedule-answers.md (AC4 and its task added, and § Current structure gains `job-endings.ts` and the refused discovery, at the orchestrator's 15:43 request)
- _agent-docs/tickets/2-3i-schedule-answers.md (dev's sanity check, 16:13: F1, F2 and F4 applied, F3 applied as ruled at 16:14; two files added to `files_to_modify`)

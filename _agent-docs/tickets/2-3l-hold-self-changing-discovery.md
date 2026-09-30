# Ticket 2.3l: Hold a discovery that keeps changing the inputs

## Ticket

As an agent, or the hook and `wait` that answer for one, working in a project whose test modules or tests change the inputs every discovery reads,
I want the daemon to stop rediscovering while the discovery keeps becoming due only through changes its own jobs made to the same file, to rediscover once more when a discovery was stored not fingerprinted by a change that left the revision where it was, and to say so in every answer, naming that file,
so that one module that writes an input when it is loaded never keeps the daemon discovering forever with no workspace run, and a test list left not current by a codegen step is discovered again without waiting for an unrelated edit.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: The daemon decides the discovery's count each time a plan finds the discovery in effect not current (ticket 2.3f AC4) while the discovery is not held, from what happened since the last discovery begun in this daemon life began, by ticket 2.3k's record of job-caused changes and edits (2.3k AC1). Since a discovery reads every input, every edit and every job-caused path reaches it, with no placement. The count is one more than the count that discovery began at when every one of these holds: a current fingerprint over every input can be computed; that discovery stored a record, under its fingerprint or not; no edit has come since it began; and at least one path a run or discovery changed while it ran since then also changed in every earlier counted time. When every other condition holds and the time has at least one job-caused path but none that every earlier counted time shares, the count starts again at 1; anything else sets it to 0, including a last discovery that stored nothing or threw, none begun in this daemon life, and a plan that finds no discovery in effect (AC2). A discovery begins at the count decided for it, and at 0 when it begins while the discovery in effect reads current (ticket 2.3f AC5's periodic retry); one that never begins (a stop, or a revision that moved since its plan) leaves the last discovery begun as it was. A change that names no path while a run or discovery runs, an interval whose digests cannot be read, and more than `MAX_COUNTED_CHANGES`, 1,000, distinct paths changed since the last discovery began each count as an edit. The counts and the record are kept in memory only: a restart holds nothing and starts the count at 0.
- [ ] AC2: At `SELF_CHANGE_HOLD_COUNT`, 3, the discovery is held; and a discovery held earlier in this daemon life is held again when its count is decided at 1 and that time's job-caused paths include a path its latest hold named. While held, no discovery begins, whatever makes one due: not the rediscovery ticket 2.3f AC4 starts before any due run, not its periodic retry (AC5), and not AC3's once-more discovery; the discovery in effect stays in effect, each round plans its runs from it, and ticket 2.3k's workspace counts and holds apply to those runs as to any. The hold is released, and the count starts again from 0, when an edit has come since the last discovery began, or a plan finds no discovery in effect; a discovery is then due as ticket 2.3f decides. So a module that writes an input each time it is loaded costs three discoveries before its first hold and one after each edit batch. The log says once when the hold begins that the discovery is held and why, naming each path that changed in all of its counted times (after a re-hold, each path its latest hold named that the re-holding time also changed, decision (g)) and the jobs it changed during, up to `MAX_NAMED_CHANGES` each with a count of the rest, and once when the hold is released; the periodic reconciliation's log line does not count a held discovery among what it retries.
- [ ] AC3: A discovery stored not fingerprinted because an input or a listed file changed while it ran (its job window named a change, protection's check found one, or the check once its fingerprint is composed did), at an input revision the change did not move, is attempted once more at that revision, beginning no sooner than the end check's modification-time tolerance (`MODIFIED_TIME_RESOLUTION_MS`, 2 s) after the first one ended, a wait an input change starts again as it starts the quiet window again; the log says so. If that discovery is also stored not fingerprinted for such a change at the unmoved revision, no discovery begins at that revision again, apart from ticket 2.3f AC5's retry, until the revision moves, and the log says so. So a codegen step that writes a gitignored test module or setup file the discovery lists, just before a discovery begins or while it runs, leaves the test list current once the once-more discovery is stored, since that write's modification time falls outside the once-more discovery's tolerance. A held discovery takes no once-more discovery (AC2).
- [ ] AC4: While the discovery is held and no round is pending, every summary and path-status answer, in `--json` and the CLI's text, says the discovery is held: no rediscovery comes until an edit or a change the daemon cannot attribute (AC1), because the daemon's own runs and discoveries keep changing the inputs. It names each path that changed in all of the discovery's counted times (after a re-hold, each path its latest hold named that the re-holding time also changed, decision (g)), each with the jobs it changed during (the run of a named workspace, or the discovery), both lists up to `MAX_NAMED_CHANGES` with a count of the rest. While the round is held after a failed step, the CLI's text also names the daemon trying the held round again at the next input event or reconciliation, which may release it. The discovery's freshness, every result's freshness and label, every count and each workspace's execution state read as they do without the hold; while the discovery is not held, or a round is pending, the answer says nothing of it.
- [ ] AC5: A workspace whose latest stored run was refused as unreadable, whose tests the refused-run fix gives the state `run-refused` and whose workspace facts it gives `refusedRun`, is due in every answer's schedule for the reason `run-refused`, never `no-run`, whether queued or idle, in `--json` and in the CLI's text; and the log's due line for it says its latest stored run was refused as unreadable. `no-run` stays the reason for a workspace with no run stored. When and how often the workspace runs does not change: the scheduler plans it as it plans a workspace with no run stored, and the run it stores replaces the refused row as its latest, which clears the reason.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It reads the tracker's job windows and digests, the lifecycle's discovery verdicts and the scheduler's own state.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, confirm the names § Current structure gives on the tree the refused-run fix leaves: `snapshot?.comparedDigests`, which the plan hands `RunHistory.observed` and the round compares, and which `beginJob` and `endJob` take as the window's edges, so the interval after a discovery spans protection with every compared file in it (decision (c)); `discoveryFingerprint`'s listed digests (decision (b)); `LatestResults.runRefusals` and `QueryBasis.refusedRuns` (AC5). Measure the code lines of every production file this ticket edits (P16), against the figures § Current structure gives. Re-run the broken-tests search in § Existing tests this change breaks.
- [ ] (AC3) In `packages/daemon/src/daemon/lifecycle.ts`, have the discovery's report say whether it was stored not fingerprinted because an input or a listed file changed while it ran: the `changedWhileRunning` of the verdict `#protectDiscovered` returns, which is the job window's own verdict from `endJob(mark)` when that named a change and otherwise protection's check (`unwatched ?? released`); or the check `#discover` makes once the fingerprint is composed (`protectedFileChangedSince` returning a reason). Derive the report's shape from `HistoryReport` (C14). A discovery that did not begin still reports none; one that ended with nothing stored reports it stored nothing and no such change. Keep the `discovery started` and `discovery ended:` lines' text, which tests read. Add only a field and a line or two: the file's room is small.
- [ ] (AC1, AC2, AC3) Create `packages/daemon/src/daemon/discovery-history.ts` with the discovery's record, as 2.3r made `run-history.ts` for runs: the revision the last discovery was tried at, whether it stored nothing, whether it is owed once more, the count it began at and whether its ending qualifies, the count decided, the hold, and the paths the latest hold named. Move `#discoveryTriedAt`, `#discoveryNothingStored` and the decision `#discoveryDue` makes out of `scheduler.ts` into it, so `scheduler.ts` stays under lint's cap after 2.3p. Mark a discovery begun, restore its record when it never begins (C167, as `BegunRun.notBegun` does for a run), record its report or its throw, decide the count, hold at `SELF_CHANGE_HOLD_COUNT`, re-hold at 1 by the same-path rule applied with the latest hold's paths as the base, release on an edit or when no discovery is in effect, and log the hold, the release and the once-more lines. Share the same-path rule (`followOn`, `SelfChangeCount`, `NO_COUNT`, the paths-and-jobs text) and `SELF_CHANGE_HOLD_COUNT` with `run-history.ts` rather than restating them (C8).
- [ ] (AC1) In `packages/daemon/src/daemon/run-history.ts` and `packages/daemon/src/daemon/change-record.ts`, let the discovery be a subject of the one change record, fed once per plan and once per job as today (C8): the discovery's sets start afresh when its report is recorded, as a run's do (`jobEnded`'s `begins`), and a discovery that throws starts them afresh too, as `BegunRun.threw` does. Key the discovery's subject so no workspace path can equal it, in the type rather than by a sentinel string. Hand the discovery's record the one `ChangeRecord`, or give `RunHistory` the discovery's reads, whichever keeps one owner of the record.
- [ ] (AC1, AC2, AC3) In `packages/daemon/src/daemon/scheduler.ts`, with no await between each read and the step it vouches for (C160): in `#plan`, release a held discovery or decide its count through the new record before the retry, the tried-at refusal and the once-more check; begin a discovery that starts while the discovery in effect reads current (the periodic retry) at count 0 (decision (d)); and start no discovery while it is held; in `#armRetries`, leave a held discovery's retry unarmed and out of the log line's count, and drop an armed one when the hold begins (2.3k's F2); in `#discover`, record the report, or the plan's revision and a discovery that never began, through the new record; and before a once-more discovery begins, wait until `MODIFIED_TIME_RESOLUTION_MS` (`inputs/input-inventory.ts`) has passed since the first one ended, through the waits `#quiesce` already uses, so an input change or a stop ends the wait as it ends the quiet window (AC3, Q-F13). Change no other decision.
- [ ] (AC4) In `packages/daemon/src/query/answer.ts`, give `ScheduleFacts` an optional member present only while the discovery is held and no round is pending, naming the shared paths as a `NamedList<SelfChangedPath>` (C14). In `packages/daemon/src/daemon/workspace-schedule.ts`, read the hold through a new `ScheduleParts` member, as `heldBy` reads a workspace's, bounding both lists with `selfChangedList` (C8, C23, C24). Export from `packages/daemon/src/client.ts` only a type the CLI names (C59).
- [ ] (AC4) In `packages/cli/src/answer-text.ts`, render the held discovery beside `Discovery freshness`: the phrase, its held-round variant as `SELF_CHANGING_IN_HELD_ROUND` has one, and the paths and jobs through `selfChangedText` and `jobText`, each through `oneLine` or `firstLine` as today.
- [ ] (AC5) Give the refused workspace its own due reason, answered in one place (C8): add `DUE_REASON.runRefused`, `"run-refused"`, in `packages/daemon/src/query/answer.ts`, its log text in `DUE_REASON_TEXT` and the reason `staleReason` gives in `packages/daemon/src/daemon/due-workspaces.ts`, and its phrase in `DUE_PHRASES` in `packages/cli/src/answer-text.ts`. Carry the refusal to each caller of `staleReason`: the scheduler's `#due` and `#armRetries` from the view's `results.runRefusals`, and `WorkspaceSchedule.#notRunning` through a new `ScheduleQuery` member that `queryBasis` in `packages/daemon/src/query/summary.ts` fills from its `refusedRuns`. Change no decision the reason feeds: a refused workspace is due, queued and retried exactly as one with no run stored.
- [ ] (Support) In `packages/daemon/src/daemon/scheduler.ts` `#run`, settle whether the refused-at-plan branch can be reached in production: `#eligible` filters with `#confirmed`, which runs `confirmedEntry` over the same `ConfirmedStart` the lifecycle's refusal in `#run` checks, since the lifecycle hands the scheduler its own `parts.start`. Then correct the comment above `if (refusedAtPlan) return;`, which says a refused workspace "waits for the revision to move": its attempt stays marked as having stored nothing, so `#armRetries` re-arms its retry at every periodic reconciliation, and it is refused again once per reconciliation. State what is true, including whether the branch is only defensive. Record the finding in the Dev Handoff for create-tests, which corrects D3184's title the same way (§ Existing tests this change breaks).
- [ ] (Support) In `packages/daemon/src/daemon/protocol.ts`, raise `PROTOCOL_VERSION` from 3 to 4 (decision (h)): a 2.3k CLI would render the new member as nothing and has no phrase for the new due reason. `CLI_JSON_SCHEMA_VERSION` stays, since the change adds a field (C151).
- [ ] (Support) Send the orchestrator the doc text in § Doc text, its final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` and `bun x prettier --check` over the changed files, `bun run --filter @rt-test/daemon typecheck` and `bun run --filter rt-test typecheck` (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `ChangeRecord`, `SubjectChanges`, `JobsByPath`, `MAX_COUNTED_CHANGES` (`daemon/change-record.ts`): the per-subject record of job-caused paths, edits and the edit-everywhere flag, and its bound.
- `SELF_CHANGE_HOLD_COUNT`, `SelfChangeCount`, `NO_COUNT`, `followOn`, `changesText`, `BegunRun` (`daemon/run-history.ts`): the hold's constant, the same-path rule, the log's paths-and-jobs text and the shape of a begun job's end; export what the discovery's record needs rather than restating it (C8).
- `JobWindow`, `JobVerdict`, `MAX_NAMED_CHANGES`, `namedList` (`inputs/input-jobs.ts`): the window a discovery's report carries, its verdict's `changedWhileRunning`, and the bound on named paths.
- `HistoryReport`, `DiscoverReport` (`daemon/run-history.ts`, `daemon/scheduler.ts`): the report shapes the discovery's report extends (C14).
- `recordFreshness`, `fingerprintDigest`, `CURRENT` (`query/test-states.js`, `query/answer.ts`): how `#discoveryDue` reads the discovery in effect not current today.
- `IDLE_REASON`, `NamedList`, `SelfChangedPath`, `ScheduleFacts` (`query/answer.ts`), `selfChangedList` and `ScheduleParts.heldBy` (`daemon/workspace-schedule.ts`): the answer's bounded paths-and-jobs list and the way the schedule reads a hold.
- `DUE_REASON`, `DUE_REASON_TEXT`, `staleReason` (`query/answer.ts`, `daemon/due-workspaces.ts`), `DUE_PHRASES` (`cli/src/answer-text.ts`), and the refused-run fix's `LatestResults.runRefusals` and `QueryBasis.refusedRuns` (`store/open-store.ts`, `query/summary.ts`): the due reasons, their two texts, the one function that answers why a workspace is due, and where a refusal is already read (AC5, C8).
- `SELF_CHANGING_CAUSE`, `SELF_CHANGING_IN_HELD_ROUND`, `SELF_CHANGED_LEAD`, `selfChangedText`, `jobText`, `oneLine`, `firstLine` (`cli/src/answer-text.ts`, `cli/src/output.ts`): the CLI's phrasing of a hold and its bounded lists.

### Must Create

- `daemon/discovery-history.ts`: the discovery's record, count, hold and once-more rule (AC1 to AC3).
- The discovery report's field saying it was stored not fingerprinted by a change while it ran (AC3).
- The schedule's held-discovery member and its CLI line (AC4).
- `DUE_REASON.runRefused` with its log text and CLI phrase, and the schedule query's refused runs (AC5).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Drafted in the main checkout at 7bd5957, after 2.3k landed (492b587, its debt 7bd5957); amended at 01:45 on 2026-09-30 against `main` at 3cda5f2, which holds 2.4 and 2.3p, and the refused-run fix on `wt/2`, which lands first. This ticket counts the discovery by 2.3k's change record and same-path rule, which 2.3k left for it (its decision (c): "The change record also feeds 2.3l; this ticket builds the workspace count only and leaves `#discoveryDue` alone"), and adds the once-more rule for a discovery that 2.3i's review found (2.3i's tech debt, ruled 2.3l's by the orchestrator at 18:32). Build order: after 2.3p and 2.4, before 2.4b (O1, orchestrator, 23:46).

Requirement this ticket serves (`docs/requirements.md`):

- "FR8: Execute every selection in the daemon, and record a run whose inputs changed while it ran as invalidated and rerun it from stable inputs; a workspace or discovery that keeps becoming due only through changes the daemon's own runs and discoveries made to the same file is held until an edit, and every answer says why." (AC1, AC2, AC4: the discovery's part; AC3: "rerun it from stable inputs", for a discovery)
- "FR5: Answer summary and `status <path>` queries through a CLI with versioned `--json` output, reporting counts per state for files and folders, without starting a test." (AC5: the schedule each answer carries names a refused workspace's due reason as its tests' state does)

Rule clauses the criteria rest on:

- AGENTS.md § Product guarantees: "Keep outcome, freshness, execution state, and falsification evidence independent." (AC4: the hold is an execution state and changes no freshness or count)
- AGENTS.md § Product guarantees: "Treat test execution as execution of project code." (AC1: a discovery loads the consumer's config and test modules, so a change while it runs is job-caused, as 2.3k AC1 says)
- C169: "An answer that says a state lasts until an event names every source that can end it." (AC4: an edit, a change the daemon cannot attribute, and, while the round is held, the held round's retry)
- C115: "A watcher overflow, missed event, branch switch or startup before reconciliation marks every result it could affect as unconfirmed or stale, never none." (AC1: a change naming no path is an edit, so it releases, never holds)
- C167: "An activity, a one-shot retry or a failure listing set for a job is reset when the job returns, restored when the job never begins, and dropped when a later attempt succeeds." (AC1, AC3: a discovery that never begins leaves the record as it was, and a once-more owed is dropped when used)
- C160: "A check whose answer vouches for state until an action relies on it ... runs with no await between it and that action." (AC1, AC2: the plan decides the count and starts the discovery with no await between)
- C8: "Two expressions in one scope must not answer the same question differently." (AC1: one change record, one same-path rule, one hold constant for runs and the discovery)
- Ticket 2.3k AC1: "A change is job-caused when the tracker records it inside the window of a run or a discovery that does not throw, from the job's start to its end ...; a change recorded only while a dependency build runs, or while a discovery protects its files after its executor has ended, is not job-caused. An edit is a path whose digest differs between the end of one run or discovery and the start of the next, or between the end of the latest and now while none runs." (AC1: what the discovery's count reads)
- Ticket 2.3f AC4: "Whenever the discovery in effect is not current at a settled revision (none stored, or stored under another digest, not fingerprinted, or under another adapter version, or no current fingerprint over every input can be computed), the daemon discovers every confirmed workspace again before any due run ... The discovery is attempted at most once for one input revision, apart from AC5's retry." (AC1: when a count is decided; AC2 and AC3: the two exceptions this ticket makes)
- Ticket 2.3f AC2's once-more rule for runs: "a run stored not fingerprinted because its inputs changed or an event named one while it ran, at a revision the change did not move (a save of identical bytes), is run once more at that revision, and if that run is also stored not fingerprinted the workspace is held until the revision or the list changes, and the log says so." (AC3 applies it to the discovery)

Glossary (`docs/glossary.md`), verbatim:

- **Edit**: "A change to an input that the daemon does not attribute to one of its own runs or discoveries."
- **Self-changing workspace**: "A Vitest workspace that became due three times in a row only through changes the daemon's own runs and discoveries made to the same input, which the daemon holds, running it no more until an edit reaches its inputs."
- **Round**: "... A round is pending until that decision is made, and held after a scheduling step fails until the daemon tries again." A held discovery is not a held round; the answer's member says `self-changing`, never "held round".

#### Owner and orchestrator rulings

Decider and time on each line; the reasons are the decider's.

- Owner, 2026-09-29 01:12: a test that rewrites or recreates its own inputs on every run is stopped and explained, not rerun without end; folded into the discovery by the orchestrator at 09:05.
- Owner, 09:13, "Same file 3x": the same file must change in all three counted jobs; a time sharing none starts the count again at 1.
- Orchestrator, 09:13 (sprint § Ticket 2.3l): a discovery already held once is held again at a count of 1 when that time's job-caused paths include a path its earlier hold named; while held, no discovery starts, the periodic retry included; the stored discovery stays in effect and runs are planned from it, "since holding runs too would stop every workspace for one module's write"; a test module an agent adds is an edit, which releases it.
- Orchestrator, 18:32 (2.3i's tech-debt disposition): the discovery stored not fingerprinted with no rediscovery coming at an unmoved revision is this ticket's subject: "a once-more rule for discoveries as runs have, bounded by this ticket's hold".
- 2.3k's decisions (a) to (c), 19:14, not vetoed at 19:16: (a) only the last job begun counts as the earlier one; (b) "A change during a discovery's protection, after its executor has ended, or during a dependency build, is an edit when its digest differs, never job-caused"; (c) this ticket counts the discovery.
- Orchestrator, 21:45, 2.3k's Q-R1 and Q-R2: while the round is held after a failed step, the CLI's text names the held round's retry, which may release a hold; and the cause reads "because the daemon's own runs and discoveries keep changing its inputs", since another job's change can drive a count.
- Owner, 22:42, 2.3k's person-edits limit: a person's saves that land during jobs can hold as an agent's can; the hold always shows and lifts at the next edit that lands while no job runs.
- S1 (sizing), asked by create-ticket at 23:46, decided by the orchestrator at 23:46: 16 raw files, 21 estimated (20.8), over the 20-file limit. Q: proceed or split? A: proceed, dev delegating, as 2.3i's S1 did. Reason: the splits either save one file (the once-more rule alone) or leave a held discovery no answer names (C169).
- O1 (build order), asked 23:46, decided by the orchestrator at 23:46: this ticket builds after 2.3p (which shares `scheduler.ts` and lets an edit to a gitignored listed file release a hold) and after 2.4 (which shares `lifecycle.ts`), and before 2.4b. § Current structure describes the tree both leave, and dev re-verifies it at its sanity check.
- Veto window, asked 23:46, answered by the orchestrator at 23:46: no veto on decisions (e), (f), (h) and (i); decision (c), the protection window, confirmed. The sprint entry's cause wording is reworded to (i) under create-ticket's grant.
- Q-F13 (AC3, C10), asked by create-ticket at 23:54 from the ticket review, decided by the orchestrator at 23:55. Q: should the once-more discovery wait out the end check's modification-time tolerance before it begins? A: yes; it begins no sooner than `MODIFIED_TIME_RESOLUTION_MS` after the first discovery ended, and an input change during that wait starts it again as any change does. Reason: it makes the codegen failure unreachable (C10) for at most 2 s on that one path; the once-more rule stays for the no-event cases (a listed file outside the root, a Linux watch that cannot open).
- Amendment, decided by the orchestrator at 00:02 on 2026-09-30 and relayed at 01:42, with a grant for this ticket and its sprint entry: (1) AC5, since the refused-run fix leaves a refused workspace's schedule due reason reading `no-run` beside its named refusal, and this ticket is the next to edit `scheduler.ts`; (2) from 2.3p's review, the refused-at-plan comment in `#run` and D3184's title say a refused workspace waits for the revision to move, though `#armRetries` re-arms its retry at each periodic reconciliation, so both are corrected, and dev settles whether the branch can be reached in production (the reviewer's suspicion, unverified; create-ticket read at 01:44 that the lifecycle hands the scheduler its own `parts.start`, so both `confirmedEntry` checks read one start); (3) § Current structure and § Pending siblings re-read after 2.4, 2.3p and the refused-run fix.
- S2 (sizing after the amendment), 18 raw files and 24 estimated (23.4): the orchestrator ruled at 01:48 to split AC5 and the refused-at-plan task into a new ticket 2.3s, since the overrun was past about one file and AC5 shares nothing with the discovery's hold; the owner ruled at 01:48, "i don't mind larger tickets", relayed by the orchestrator at 01:49, which cancelled the split. Decided by the owner: AC5 and the refused-at-plan task stay in this ticket, and it proceeds at 18 raw and 24 estimated. No ticket 2.3s was written.
- Ticket review, one ticket-internal reviewer, 23:47 to 23:54, 13 findings, triaged by create-ticket at 23:54, all applied: the scheduler task decides the count before the retry and begins a retry-at-current discovery at 0 (F1); the lifecycle task names the window's verdict inside `#protectDiscovered`'s (F2); the first task says what confirming `#vouchedDigests` decides (F3); AC1 sets the count to 0 when no discovery is in effect, agreeing with AC2 (F4); AC3's codegen sentence, made unconditional by Q-F13 (F5, F13); AC2 and AC4 name a re-hold's paths as decision (g) does (F6); a count beside its list removed (F7); § Doc text extends 2.3k's known limits to the discovery (F8); the protocol-version pin search, run at 23:54 (F9); records reached through edited test files (F10); decision (b)'s reason covers listed files (F11); every edited file measured after 2.3p and 2.4 (F12).

#### Decisions taken here

Each is create-ticket's, not vetoed by the orchestrator at 23:46.

- **(a) The earlier discovery qualifies when it stored a record, under its fingerprint or not.** A module that writes an input while it loads leaves every discovery stored not fingerprinted, since its window names the write, so requiring a fingerprinted one would never count the loop. A discovery that stored nothing (its executor failed, a stop, a failed store write) or threw sets the count to 0, as a run that stored nothing does in 2.3k.
- **(b) No placement.** The discovery's fingerprint is composed over every input unnarrowed (`discoveryFingerprint` passes `undefined` narrowing to `workspaceInputs`, `inputs/fingerprint.ts`), and it also digests every file the discovery lists (`listedDigests`), so every edit and job-caused path the change record compares bears on it, including a listed file the inputs leave out that 2.3p's accessor adds; the count reads the subject's sets whole. The first task confirms this against 2.3p's `fingerprint.ts`.
- **(c) Protection stays outside the discovery's window.** The discovery's reported window closes at `endJob(mark)` right after its executor returns, before `#protectDiscovered` opens the guard window, which no report carries. Protection's reads, including the quiet ones that record no path in any window (`QueuedReads`, `#quiet`), change only the committed digests, and the interval the change record measures next runs from that window's end digests to the next plan's, so it spans protection and counts each such change as an edit by digest (2.3k's decision (b)). No reported window spans protection, so none needs its start and end digests diffed. If a later change reports a window spanning protection, that window must count each path whose digest differs between its start and end, since protection's quiet reads record none, or those changes would count as neither (the orchestrator's note, relayed with the dispatch at 23:33).
- **(d) Retry-only discoveries begin at 0.** A discovery that begins while the discovery in effect reads current is the periodic retry (a failed workspace listed, or the last one stored nothing), which no change of the discovery's own drove; runs due only for a retry take count 0 in 2.3k the same way.
- **(e) The hold shows while held and no round is pending, whatever the discovery's freshness.** A pending round may be the edit that releases it (2.3k's Q3). Unlike a workspace's idle reason, which sits in the slot for a workspace that is not current, the discovery's hold has its own member, so it can say what is true: no rediscovery begins while held.
- **(f) No discovery in effect releases the hold.** With none stored, or the latest refused, the daemon has nothing to plan runs from, so a discovery is due as 2.3f decides; the answers then carry no discovery to hold (a missing discovery is answered with an error).
- **(g) The re-hold is the same-path rule with the latest hold as the base.** Its shared paths are the latest hold's paths this time also changed, each with the jobs of both, as `followOn` merges them; the re-hold names those.
- **(h) `PROTOCOL_VERSION` rises from 3 to 4**, by 2.3k's Q4 (orchestrator, 19:16): an older CLI would render the new member as nothing. Tickets 2.4 and 2.4b leave the version unchanged.
- **(i) The answer's cause reads "because the daemon's own runs and discoveries keep changing the inputs"**, not the sprint entry's "because loading the test modules changes the inputs", by 2.3k's Q-R2 (orchestrator, 21:45): a run of a workspace whose test writes an input every run also makes the discovery not current each time, so a run, not a module's load, can be the job that drives the count (§ Scenarios).
- **Scope of the analysis.** Analyzed: every way `#discoveryDue` makes a discovery due (none stored, not current, the retry) against the hold and the once-more rule; each way a discovery ends (stored under its fingerprint, stored not fingerprinted by a change, stored not fingerprinted for another cause, stored nothing, threw, never began); the count's three outcomes and the re-hold; the protection window against 2.3k's record (decision (c)); the answer's precedence against a pending and a held round. Not analyzed: 2.4b's wait beyond § Pending siblings; the agent hook's attribution (2.7).

#### Scenarios, traced against the rule

For create-tests; each from a fresh daemon.

- **A test module writes `gen/stamp.json`, an input, with new content each time it is loaded.** Discovery 1 begins at count 0 and is stored not fingerprinted, its window naming the stamp; the revision moved, so the discovery in effect is not current. Count 1 (discovery 1 stored, no edit, the stamp job-caused): discovery 2. Count 2: discovery 3. Count 3: held, logged once. Runs are planned from discovery 3's record; each run loads the module and writes the stamp, so a workspace whose inputs hold it is held by 2.3k after three runs.
- **The agent then saves `src/x.ts` while no job runs.** An edit: the hold is released, logged, count 0, and discovery 4 begins before any due run. It writes the stamp again: count 1, and the stamp was named by the latest hold, so the discovery is held again, having cost one rediscovery.
- **The agent adds a test module while no job runs.** An edit: released; the rediscovery lists it; held again after it; its workspace's fingerprint changed, so the new module runs.
- **A test in workspace `a` rewrites its fixture `a/f.json` on every run; no module writes on load.** Each run of `a` leaves the discovery not current, since it reads every input. Discovery counts 1, 2, 3 follow runs 1, 2, 3 of `a`, the answer naming `a/f.json` during the run of `a`; `a` is held by 2.3k after its third run. Both holds show.
- **A codegen step writes a gitignored listed test module 1 s before a discovery begins.** The check once the fingerprint is composed finds its modification time inside the 2 s tolerance: stored not fingerprinted, revision unmoved. Once more at that revision, no sooner than 2 s after the first one ended, so the write's modification time lies outside its tolerance: it is stored under its fingerprint and reads current. A codegen write while the first discovery runs is caught the same way. Had it failed the same way, no discovery at that revision again until the revision moves, and the log says so.
- **A watcher failure while a discovery runs.** Its cause names no path: an edit everywhere, count 0, any hold released.
- **A restart** holds nothing and counts from 0.

#### Current structure of the modified files

Read on `main` at 3cda5f2, which holds 2.4 (074dc69, its debt 25bbc60) and 2.3p (merged at 3cda5f2), and, for the refused-run fix that lands before this ticket, on `wt/2` at 7b05449 (017b8b2). Code lines are counted as lint's cap counts them, blank and comment lines skipped, at 01:43 on 2026-09-30.

- `daemon/scheduler.ts` (548 lines, 468 code lines): `DiscoverReport extends Pick<HistoryReport, "window"> { stored }`; fields `#discoveryTriedAt`, `#discoveryNothingStored`, `#retryDiscovery`, `#retryWorkspaces`, `#runs: RunHistory`; `#plan` reads the view, calls `this.#runs.observed(view.inputs.snapshot?.comparedDigests)` (2.3p's map over the inputs and the held listed files, which `#selectRound` compares too), `#armRetries`, then `#discoveryDue(revision, view)` (retry, then the tried-at refusal, then none stored, then `recordFreshness(stored, current) !== CURRENT`), setting `#discoveryTriedAt` and pending `ROUND_WAIT.rediscovery`; `#armRetries` sets `#retryDiscovery` from `#discoveryNothingStored` or a `failed` workspace and logs "retrying the discovery and N workspaces"; `#discover` sets `#discoveryNothingStored` true, awaits `#schedule.during(this.#parts.discover(revision), revision)`, then records `!report.stored` and `this.#runs.discoveryEnded(report.window)`, or restores both marks when the discovery did not begin. `#due` and `#armRetries` here, and `WorkspaceSchedule.#notRunning`, each call `staleReason(latest, digest)` over the latest runs, where a refused workspace has none. `#run` returns early when the lifecycle refused the run at its planned revision (`refusedAtPlan`), keeping the attempt and dropping the retry, under the comment "A refused workspace keeps its attempt and drops its retry, so it waits for the revision to move", which `#armRetries` contradicts by re-arming the retry at each periodic reconciliation while the attempt reads as having stored nothing.
- `daemon/due-workspaces.ts` (145 lines, 115 code lines): `DUE_REASON_TEXT: Record<DueReason, string>`, the log's due text; `staleReason(latest, currentDigest)` returns `DUE_REASON.noRun` for an undefined latest run, then undefined when current, then the adapter, not-fingerprinted, no-current-fingerprint and inputs-changed reasons; `retryReason`, `retryOwed`.
- `query/summary.ts` (360 lines, 332 code lines; 378 and 348 after the refused-run fix): `queryBasis` reads the latest results, and after the fix builds `refusedRuns` (a map of workspace path to reason from `results.runRefusals`) beside `latestRuns`, then calls `daemon.schedule.read({ revision, activity, workspaces, latestRuns, fingerprint })`, the one caller of `read`.
- `daemon/run-history.ts` (322 lines, 244 code lines): `SELF_CHANGE_HOLD_COUNT = 3`; `HistoryReport { revision, stored, changedWhileRunning, window, notKept, interruptedBy }`; private `SelfChangeCount { count, shared }`, `NO_COUNT`, `Attempt`, `followOn(base, caused)`, `changesText`, `jobText`; `RunHistory` owns `#changes = new ChangeRecord()` and has `observed`, `discoveryEnded(window)` (`jobEnded(window, undefined, undefined)`), `decide`, `began` returning `BegunRun { ended, notBegun, threw }`, `#ended` with the two once-more log lines, `#nextCount`, `#edited`, `#inside`.
- `daemon/change-record.ts` (126 lines, 89 code lines): `MAX_COUNTED_CHANGES = 1_000`; `JobsByPath` (a path's jobs, `undefined` naming the discovery); `ChangeRecord` keyed by `string` subject with `of`, `observed`, `jobEnded(window, job, begins)`, `begun`; `ChangeSets` with `addJob`, `addEdits`, `editedEverywhere` and the per-subject bound.
- `daemon/lifecycle.ts` (568 lines, 486 code lines after 2.4; 559 and 479 after the refused-run fix, which moves the refusal logging into `daemon/refusal-notes.ts`): `#discover` opens `mark = inputs.beginJob()`, builds `report(stored) => ({ stored, window: mark.window })`, awaits `executor.discover`, then `inputs.endJob(mark)`, then `#protectDiscovered` (a guard window around `protectInputs`, unreported, returning the final verdict), then `#bindings` with a fingerprint callback that fails with `protectedFileChangedSince`'s reason once composed, then stores and returns `report(stored)`.
- `daemon/workspace-schedule.ts` (514 lines, 430 code lines): `ScheduleParts { confirmed, storedNothing, heldBy }`; `ScheduleQuery { revision, activity, workspaces, latestRuns, fingerprint }`; `read(query)` returns `{ schedule: { round, workspaces }, latestSelection }`; `selfChangedList(held)` bounds paths and jobs by `MAX_NAMED_CHANGES`.
- `query/answer.ts` (536 lines, 408 code lines; 544 and 414 after the refused-run fix, which adds the test state `RUN_REFUSED`, `"run-refused"`, and makes `WorkspaceFacts` a union whose null `latestRun` may carry `refusedRun: CutReason`): `DUE_REASON { noRun, anotherAdapterVersion, notFingerprinted, noCurrentFingerprint, inputsChanged, failedRun, crashedRun }`; `ScheduleFacts { round, workspaces }`; `IDLE_REASON` with `selfChanging`; `SelfChangedPath { path, jobs }`; `AnswerContext.discovery: DiscoveryFacts { discoveryId, freshness, ... }`.
- `cli/src/answer-text.ts` (431 lines, 383 code lines): `DUE_PHRASES: Record<DueReason, string>`, keyed exhaustively; `contextLines` prints `Discovery freshness: ...`, the inputs, `Daemon:`, `Round:`, the execution lines; `SELF_CHANGING_CAUSE`, `IDLE_PHRASES`, `SELF_CHANGING_IN_HELD_ROUND`, `SELF_CHANGED_LEAD`, `selfChangedText`, `jobText`.
- `daemon/protocol.ts`: `PROTOCOL_VERSION = 3`.
- `inputs/input-jobs.ts` (read, not edited): `JobVerdict`'s not-fingerprinted arm carries `changedWhileRunning`; `JobWindow { paths, causes, startDigests, endDigests }`.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3l` over this ticket's file list named 2.4, 2.4b, 2.4c and 2.4d (23:38), and over `due-workspaces.ts` and `query/summary.ts`, added by AC5, 2.3n and 2.4d by folder only and 2.4b by `query/summary.ts` (01:44 on 2026-09-30).

- **2.3p** (landed, merged at 3cda5f2): the round and 2.3k's `observed` compare `snapshot?.comparedDigests`, which counts the held listed files, and the window's edges take the same map, so an edit to a gitignored listed file between jobs is an edit and releases a hold. Its decision (a) moves the revision when a new discovery comes to list or stops listing such a file, which leaves AC3's once-more rule for the cases the end check still catches at an unmoved revision (the 2 s tolerance, a listed file outside the root, a Linux watch that cannot open).
- **2.4** (landed, 074dc69): the stop signal in `lifecycle.ts`' `stop()`; no region this ticket edits.
- **The refused-run fix** (lane t-run-refusal, `wt/2` at 7b05449, change record `_agent-docs/.scratch/change-requests/refused-latest-run.md` there; lands before this ticket, orchestrator, 01:42): `readLatestResults` returns `runRefusals` beside `latestRuns`, which leaves the refused workspace out; its tests read `run-refused`; its workspace facts give `latestRun: null` and `refusedRun`; the CLI's summary line reads "latest run refused as unreadable:"; the refusal logging moves from `lifecycle.ts` into `daemon/refusal-notes.ts`. Its known limit, that the schedule's due reason reads `no-run`, is this ticket's AC5. Its change adds no `scheduler.ts` edit.
- **2.3n** (ready-for-dev): names `daemon/` by folder only.
- **2.4b** (ready-for-dev, builds after): writes `lifecycle.ts`, `workspace-schedule.ts`, `answer.ts`, `protocol.ts` and `client.ts`, reads `queryBasis` in `query/summary.ts`, and settles a wait once no round is pending and each covering workspace reads current or has nothing coming. A held discovery keeps no round pending, so no wait hangs on it; each answer's schedule carries the hold. 2.4b's answer names the hold through the `AnswerContext` it carries, never a field of its own (its author, 01:56 on 2026-09-30). It also writes `answer-text.ts` for the wait command (ticket 2.4c's, folded into 2.4b at 01:55); this ticket's line sits in `contextLines`, which the command prints unchanged.
- **2.4d** (ready-for-dev): names `daemon/` by folder only; it writes `input-tracker.ts` and `lifecycle.ts` (`pathStatus`), none of the regions here.
- **2.7** (backlog): the agent hook's edits are always edits, which release a hold; nothing here.

#### Existing tests this change breaks

- `packages/daemon/test/scheduler.test.ts`: its rig's `discover` stand-in returns `{ stored, window }`, which gains the new field; the typecheck finds it. Its two `new WorkspaceSchedule({` calls in the schedule tests gain the new `ScheduleParts` member. D3147 ("a workspace whose inputs each discovery changes is held, the answer naming the discovery as the job") drives rediscoveries that each change a path, whose sequence the discovery's own count now also holds; re-run it and re-prove it. D2659 ("a discovery whose record stays not current is attempted once at an input revision") uses a discovery fingerprint that cannot be computed, which is no change while it ran, so it keeps passing; re-run it.
- `packages/daemon/test/scheduler.test.ts` D3184: its title, "a retried workspace the lifecycle refuses at its planned revision drops its retry, so it runs into no further refusal until the revision moves", claims more than the code does, since `#armRetries` re-arms the retry at each periodic reconciliation. create-tests corrects the title to what dev's settled comment states and re-proves D3184 (its record in `packages/daemon/test/defects.json`).
- `packages/daemon/test/query.test.ts`: its `new WorkspaceSchedule({` helper gains the new member, and the schedule query gains the refused runs (AC5). A refused-run test the refused-run fix's tests session adds that reads the schedule's due reason as `no-run` for a refused workspace flips to `run-refused`: create-tests updates it, since the reason changed by design.
- `packages/daemon/test/lifecycle.test.ts`: D3182 ("a workspace whose inputs each discovery changes is held through the discoveries' own reports") drives the same sequence through the lifecycle; re-run it. Its discovery tests read `discovery started` and `discovery ended:`, which keep their text. The end-to-end tests of AC1 to AC5 go here.
- `packages/cli/test/cli.test.ts`: the new line, and `DUE_PHRASES`' new key (keyed exhaustively, so the typecheck requires it); existing expectations are unaffected where the member is absent.
- Found by `rg -n "new WorkspaceSchedule\(|new RunHistory\(|new ChangeRecord\(|ScheduleParts|DiscoverReport|discover: |discoveryEnded|heldBy:" packages/daemon/test packages/cli/test` (23:38), then reading each hit; `rg -n "protocolVersion\"?:\s*3|PROTOCOL_VERSION = 3|protocol version 3"` over `git ls-files` outside the tickets and `docs/` (23:54), which found nothing, so no test pins the version this ticket raises; and the D-titled discovery tests of `scheduler.test.ts` and `lifecycle.test.ts` (`rg -n 'it\(\s*"D[0-9]+: .*(discover|rediscover)'`, 23:42).

#### Named-defect records the edits reach

A lane re-proves every record whose test or mutated file it edits. Mutated files, by each record's `file` field at 3cda5f2, before the refused-run fix (records whose test sits in a test file create-tests edits are reached too, counted once it has edited them): `lifecycle.ts` 77, `scheduler.ts` 49, `workspace-schedule.ts` 41, `query/summary.ts` 40, `answer-text.ts` 39, `run-history.ts` 24, `due-workspaces.ts` 13, `client.ts` 12, `change-record.ts` 6, `protocol.ts` 5, `answer.ts` 3. D3184, whose title create-tests corrects, is re-proven with them. The `scheduler.ts` records that anchor on code the new module takes (`if (this.#discoveryTriedAt === revision) return false;`, `this.#discoveryNothingStored ||`, `this.#retryDiscovery ||= retry;`), and one on `this.#runs.discoveryEnded(report.window);`: re-anchor each on the moved code, keeping its defect. Count the `--changed` selection before proving, and prove by `--ids`.

#### Sizing

18 raw files, 24 estimated (23.4); 6 code units (five criteria plus validation). Production: modify `daemon/scheduler.ts`, `daemon/run-history.ts`, `daemon/change-record.ts`, `daemon/lifecycle.ts`, `daemon/workspace-schedule.ts`, `daemon/due-workspaces.ts`, `query/answer.ts`, `query/summary.ts`, `daemon/protocol.ts`, `client.ts`, `cli/src/answer-text.ts`; create `daemon/discovery-history.ts`. Tests, for create-tests: `scheduler.test.ts`, `lifecycle.test.ts`, `query.test.ts`, `packages/cli/test/cli.test.ts`, and the two `defects.json`. One chain (the record and count, the scheduler, the answer, the CLI text), with AC5's due reason a separate strand across `due-workspaces.ts`, `summary.ts`, `workspace-schedule.ts`, `scheduler.ts` and `answer-text.ts`; over 10 estimated, dev delegates in that order, on disjoint files. Over 20 estimated: proceed as-is (S1, orchestrator, 23:46); the amendment of 01:42 adds AC5's two files, recounted at 01:45, and the owner kept it whole at that size (S2, 01:48).

#### Known limits

For `docs/architecture.md`'s list, § Doc text words them.

- While a module that writes an input on load stays, each edit batch costs one rediscovery after the first hold, and three before it.
- A test module or config an agent adds while a job runs is job-caused, not an edit (2.3k's known limit), so it does not release a held discovery; the discovery in effect does not list it until the next edit that lands while no job runs.
- A module that writes a different path each time it is loaded, or more than 1,000 paths, is never held.
- A write a discovery makes that the tracker reads only after the discovery's window closes, including one read during protection, counts as an edit, so a loop driven by such writes is not held.
- A once-more discovery that is again stored not fingerprinted leaves the test list not current until the revision moves.
- Ticket 2.3k's limits apply.

#### Doc text

A draft for the orchestrator, its final wording to follow the build.

- `docs/architecture.md`, the scheduler paragraph, after the self-changing workspace's sentences: "The discovery is held the same way when it becomes due three times in a row only through changes the daemon's own runs and discoveries made to the same input: no discovery begins, the rediscovery before due runs, the periodic retry and the once-more discovery included, until an edit or a change the daemon cannot attribute, and runs are planned from the discovery in effect meanwhile. A discovery held once is held again after the one rediscovery an edit allows when that rediscovery changes a path the hold named. A discovery stored not fingerprinted because an input or a listed file changed while it ran, at a revision the change did not move, is discovered once more at that revision, no sooner than 2 s after it ended; every answer names a held discovery's paths and the jobs that changed them."
- `docs/architecture.md`, the known limits: replace "until ticket 2.3l, a test module that writes an input when it is loaded, which keeps discoveries repeating, so no workspace runs;" with "a test module that writes an input when it is loaded, which costs three discoveries before the discovery is held and one after each later edit; a discovery the once-more rule stores not fingerprinted again, whose test list stays not current until the input revision moves;", and extend the known limits 2.3k wrote for a workspace (an agent or a person that saves the same input while a job runs; a test that writes a different input each run, or more than 1,000; a write read only after its job's window closes) to name the discovery beside the workspace, since each applies to it: a test module or config added while a job runs does not release a held discovery, a module that writes a different path each load or more than 1,000 paths never holds it, and a discovery's write read after its window closes, protection included, counts as an edit.
- `docs/glossary.md`, after **Self-changing workspace**: "**Self-changing discovery**: The discovery, when it became due three times in a row only through changes the daemon's own runs and discoveries made to the same input, which the daemon holds, discovering no more until an edit, while runs are planned from the discovery in effect." `_Avoid_: looping discovery`.
- `README.md`: user-visible; the summary gains a line for a held discovery. Dev confirms the sentence.

#### Previous ticket

2.3k (done, 492b587; debt 7bd5957): the change record (`daemon/change-record.ts`), the count and hold (`daemon/run-history.ts`), `IDLE_REASON.selfChanging` and `notRunning.selfChanged`, the CLI's phrase and its held-round variant, `PROTOCOL_VERSION` 3. Its build differs from two of its task texts, as its Completion Notes say: the placement rule is the private `placeFor` behind `roundPlacement` and `pathsInside`; and `#run` restores the attempt only on a stop or a moved revision, a refusal at the planned revision keeping it (7bd5957). Its Deliberately Untested notes that no code path reports a dependency build's or protection's window to the change record, which decision (c) keeps. Its code lines at landing: `scheduler.ts` 464 then about 467, `lifecycle.ts` 468 then about 455 (orchestrator's figures).

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3l, § Ticket 2.3k, § Ticket 2.3p, § Ticket 2.3f.
- Tickets 2.3k (`_agent-docs/tickets/2-3k-hold-self-changing-runs.md`: decisions (a) to (d), Q-R1, Q-R2, the Deliberately Untested notes), 2.3i (`_agent-docs/tickets/2-3i-schedule-answers.md`: the tech debt on a discovery stored not fingerprinted), 2.3f (`_agent-docs/tickets/2-3f-schedule-runs.md`: AC2, AC4, AC5), 2.3p (Tree 1, `_agent-docs/tickets/2-3p-listed-ignored-events.md`: AC2, AC3, decisions (a), (b), (f)) and 2.4b (`_agent-docs/tickets/2-4b-wait-for-files.md` AC3).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (2026-09-29 23:38).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C8,C10,C14,C23,C24,C170,C38,C39,C40,C46,C48,C55,C59,C115,C119,C120,C151,C154,C160,C167,C169 -->

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
sizing_ac_count: 6
files_to_modify:
  - packages/daemon/src/daemon/scheduler.ts
  - packages/daemon/src/daemon/run-history.ts
  - packages/daemon/src/daemon/change-record.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/workspace-schedule.ts
  - packages/daemon/src/daemon/due-workspaces.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/query/summary.ts
  - packages/daemon/src/daemon/protocol.ts
  - packages/daemon/src/client.ts
  - packages/cli/src/answer-text.ts
files_to_create:
  - packages/daemon/src/daemon/discovery-history.ts
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

- _agent-docs/tickets/2-3l-hold-self-changing-discovery.md (created by create-ticket, 2026-09-29, against `main` at 7bd5957; amended 2026-09-30 01:45 against `main` at 3cda5f2 under the orchestrator's 01:42 grant)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3l: the cause wording (i), the build order after 2.3p and 2.4, the ticket link, under the dispatch's grant; the once-more wait, AC5 and the refused-at-plan correction, under the 01:42 grant)

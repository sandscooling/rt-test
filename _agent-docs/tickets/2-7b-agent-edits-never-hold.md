# Ticket 2.7b: An agent's edits never hold a workspace

## Ticket

As a coding agent working in a project whose tests change their own inputs,
I want the agent hook to tell the daemon which files each batch of my tool calls edited, and the daemon to count those changes as edits,
so that my own edits never hold a workspace or the discovery as self-changing, even when I save a file while one of the daemon's runs or discoveries is going.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: A `changes` request (ticket 2.6) may name, as edited, files that are among its paths. A request whose edited files are not a list of strings each equal to one of its paths is refused whole as invalid, with a reason, before any path is read. A request naming no edited file is answered exactly as before.
- [ ] AC2: The daemon counts each change it records to a file a request names as edited as an edit, never as a change its own run or discovery made, whether the tracker recorded it while a job ran or between jobs, and whether it recorded it before the request arrived or, during the job running then, after; this holds when the request reaches the daemon before the round that follows the change decides its counts. So such a change never adds to ticket 2.3k's count of a workspace whose inputs hold the file, nor to ticket 2.3l's count of the discovery, and, like any edit, it sets those counts back to 0. Naming a file that no change reached counts nothing.
- [ ] AC3: A workspace held as self-changing (ticket 2.3k) is released at the next round when a change to a file a request named as edited reaches its inputs, and a held discovery (ticket 2.3l) is released at the next round by such a change to any input; the log says so as it does for any edit.
- [ ] AC4: After each batch, the agent hook's `changes` request (ticket 2.7) names as edited the batch's own `Write`, `Edit` and `NotebookEdit` files that it sends, and none for a batch whose calls name no file; its `Stop` and `UserPromptSubmit` requests name none. A change a shell call made, or a person's save, is named by no request and stays judged by when it happened, as today.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It extends ticket 2.6's request and ticket 2.3k's change record, both this repository's own, and the hook's payload fields it reads are ticket 2.7's, measured there on Claude Code 2.1.285.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read the landed code of ticket 2.6 (`ChangesRequest` in `daemon/protocol.ts`; `changesResponse` and `ChangesQuery` in `server.ts`; `Changes.answer` and `ChangesParts` in `daemon/changes.ts`, which `lifecycle.ts`' `changes` delegates to and whose parts it builds; `queryChanges` and `ChangesOptions` in `query-client.ts`) and ticket 2.7 (`commands/hook.ts`'s `PostToolBatch` run and its retry of a refused request), and confirm the names this ticket uses. As built at 50dc810, `changesResponse` reads only `paths` and `since` into the `ChangesQuery` it hands on, so an older daemon ignores `edited` (§ Known limits' daemon started before this ticket rests on it). Report each rename, and any refusal of an unknown member, to the orchestrator before building on it.
- [ ] (AC1) In `packages/daemon/src/daemon/protocol.ts`, give `ChangesRequest` an optional `edited`, absolute paths. In `server.ts`' `changesResponse`, refuse a request whose `edited` is present and is not an array of strings each equal to one of its `paths`, with the invalid-request error, and carry it in `ChangesQuery` as `edited`; the paths' own bound and resolution then cover it (C8). `PROTOCOL_VERSION` is unchanged, as for 2.6's request.
- [ ] (AC2, AC3) In `packages/daemon/src/daemon/change-record.ts`, let `ChangeRecord` take the input keys a caller reports as edited: a reported key already among a subject's job-caused paths moves to that subject's edits, for every subject, the discovery's included; and a reported key that any job records, running at the report or beginning before the request's named read has read that key, before or after the report, becomes an edit, never the job's, when that job ends. Hold each such job's reported keys only until it ends, whichever way it ends: stored, interrupted, threw or never began (C167). Jobs run one at a time today (ticket 2.3f), but the rule is stated per job so it holds either way. A reported key no change reached adds nothing (AC2).
- [ ] (AC2, AC3) Pass the reported keys through `RunHistory` (`daemon/run-history.ts`) and `Scheduler` (`daemon/scheduler.ts`) as one method each, into the one `ChangeRecord` the run history owns, never a second record (C8). `RunHistory.decide` and `DiscoveryHistory.decide` then release a hold and reset a count from the record as they already do, with no change of their own.
- [ ] (AC2) In `Changes.answer` (`daemon/changes.ts`), after `resolveFiles` and before `inputs.readNamed(paths)`, hand the scheduler the input keys of the edited paths through a new member of `ChangesParts`, which `lifecycle.ts` wires to the scheduler's method (C40), taken from the same resolution and the same conversion to an input key the named read uses (`#label`, `inputs/queued-reads.ts`), never a second conversion (C8, C42), with no await between the handoff and the named read's start (C160). A request refused whole attributes nothing: ticket 2.6 decides every whole refusal, the invalid `edited` of AC1 included, in `changesResponse` or in `resolveFiles`, before any path is read (its AC1), and the named read's failures only leave the answer not determined.
- [ ] (AC4) In `packages/daemon/src/query-client.ts`, let `queryChanges`' options also carry `edited`, sent only when given (C40). In `packages/cli/src/commands/hook.ts`, pass the batch's own files that the request sends as `edited` on `PostToolBatch`, leaving out any the retry leaves out, and pass none on `Stop` and `UserPromptSubmit`.
- [ ] (Support) Send the orchestrator the text in § Doc text with the build (C7, C48).
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files and `bun run typecheck` across the repository (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `ChangeRecord`, `SubjectChanges`, `Job` (`daemon/change-record.ts`): the job-caused and edit sets the report corrects.
- `RunHistory` and its `decide`, `#edited` and `#nextCount` (`daemon/run-history.ts`), and `DiscoveryHistory.decide` with `releaseCause` and `unedited` (`daemon/discovery-history.ts`): the holds and counts, which read the record unchanged.
- `Scheduler`'s `#runs` (`daemon/scheduler.ts`).
- `resolveCallerPath` (`query/caller-paths.ts`) and the named read's conversion of an absolute path to an input key (`#label` in `inputs/queued-reads.ts`), which the changes handler already runs for its paths.
- `ChangesRequest`, `changesResponse` and `ChangesQuery`, `Changes.answer` and `ChangesParts` (`daemon/changes.ts`), `queryChanges` and `ChangesOptions` (ticket 2.6, built at 50dc810); the hook's `PostToolBatch` run (ticket 2.7).

### Must Create

- `ChangesRequest.edited` and its validation (AC1).
- `ChangeRecord`'s reported edits, with one method each on `RunHistory` and `Scheduler` (AC2, AC3).
- `queryChanges`' `edited` option (AC4).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Sprint 2's last ticket, split from ticket 2.7 by the orchestrator at 08:04 on 2026-09-30 (§ Split). It builds after 2.7, whose hook sends the request this ticket widens, and changes the scheduler's hold logic, which gets its own review.

Requirements (`docs/requirements.md`):

- "FR8: Execute every selection in the daemon, and record a run whose inputs changed while it ran as invalidated and rerun it from stable inputs; a workspace or discovery that keeps becoming due only through changes the daemon's own runs and discoveries made to the same file is held until an edit, and every answer says why." (AC2, AC3)
- "FR20: Report to a coding agent, after its tool calls, each change since its previous report in the state or freshness of the tests covering the files it edited, naming each test that failed or recovered, through a hook that only queries the CLI and reports the files the agent edited, starts no test and no daemon, and says when RT Test cannot answer rather than falling silent." (AC1, AC4: its clause "reports the files the agent edited")

The owner's ruling the criteria rest on, quoted from ticket 2.3k's record: "Owner, 09:16, 'Same file + hook': from ticket 2.7, the agent hook tells the daemon which files the agent edited, and a change to them is always an edit, so an agent's own edits never cause a hold." And its scope, the owner at 22:42 on 2026-09-29: "Ticket 2.7's hook will vouch only for an agent's edits, so the person case stays a documented known limit." The split moved that work to this ticket.

Glossary (`docs/glossary.md`), verbatim:

- **Edit**: "A change to an input that the daemon does not attribute to one of its own runs or discoveries."
- **Self-changing workspace**: "A Vitest workspace that became due three times in a row only through changes the daemon's own runs and discoveries made to the same input, which the daemon holds, running it no more until an edit reaches its inputs."
- **Self-changing discovery**: "The discovery, when it became due three times in a row only through changes the daemon's own runs and discoveries made to the same input, which the daemon holds, discovering no more until an edit, while runs are planned from the discovery in effect."

A change the hook names as edited is one the daemon does not attribute to its own jobs, so the glossary's **Edit** holds unchanged.

#### Split

The orchestrator split the original ticket 2.7 at 08:04 by outcome: 2.7 keeps the hook and every owner ruling on it, and this ticket takes the edited files end to end, the hook's sending of them included. Until this ticket lands, a change the agent makes while a job runs is judged by timing, as a person's saves are (ticket 2.3k's known limit).

#### How the report meets the record

- **Timing.** A `Write` or `Edit` saves the file; Claude Code runs the `PostToolBatch` hook right after the batch (ticket 2.7 § Measured facts), and the hook's request resolves and reads the named paths at once. The round that counts a change waits for the input revision to hold still for the 1,000 ms quiet window (a target) and for the dependency build to end, so the report normally arrives before that round.
- **Where the change sits when the report arrives.** Recorded during a job that has since ended: it is among each subject's job-caused paths (`ChangeRecord.jobEnded`), and moves to its edits. Recorded, or still to be recorded, during the job running now: it lands in that job's window (`JobWindow.paths`), and becomes an edit when the job ends. Recorded between jobs: it is already an edit (`ChangeRecord.observed`), and the report changes nothing. The named read of the same request records the file's change at once when the watcher has not yet, inside the running job's window if one runs, which is why the handoff comes before the read.
- **Why every subject.** The record keeps changes per subject since that subject's last job began, unplaced; `RunHistory` places them in a workspace's inputs only when it counts that workspace, and `DiscoveryHistory` treats any edit as reaching the discovery. So moving a key to every subject's edits reaches exactly the workspaces whose inputs hold it.
- **Scope of the analysis.** Analyzed: a report before and after the job that recorded the change ends; a report while no job runs; a report of a file no change reached; a report for a held workspace and for the held discovery; a refused request; a key reported during a job that throws or never begins; a job that begins after the report but before the named read has read the key. Not analyzed: a report arriving after the round that follows the change has counted (a known limit below).

- **Ticket review (create-ticket 6c, 08:21 to 08:24).** 8 findings, all applied. The doc text now promises only what § Known limits allows (F1, F2); a whole refusal is shown to come before the handoff, from 2.6's AC1 (F3); the hold covers each job running at the report or beginning before the named read has read the key (F6, F7); `hook.test.ts` may assert the request's whole body (F4); the first task confirms 2.6 ignores an unknown member, as `server.ts` does today (F5); and `scheduler.ts`' size is named (F8).

#### Known limits

- **A report that reaches the daemon after the round following the change has counted it** lets that one count rise; the change's later edits then reset it, so a hold would need three such late reports in a row. The hook sends it within its 2,000 ms bound (ticket 2.7), and a round first waits the 1,000 ms quiet window.
- **A person's own saves are still judged by timing** (ticket 2.3k's known limit, owner, 22:42 on 2026-09-29): the hook vouches only for its agent's edits.
- **A change a shell call made is judged by timing** (owner, 2026-09-29 09:16), since a shell call names no file.
- **A daemon started before this ticket** ignores the edited files, since `PROTOCOL_VERSION` is unchanged, until it is restarted; a hold it places still shows in every answer and never reads a result current.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.7b` over this ticket's files (08:19 on 2026-09-30) named 2.4b, 2.5, 2.6 and 2.7.

- **2.4b** (ready-for-dev, building in Tree 1): reads `scheduler.ts` and `run-history.ts` and writes `protocol.ts`, `server.ts`, `lifecycle.ts` and `query-client.ts`. Lands first.
- **2.5** (ready-for-dev): reads `protocol.ts` and `query-client.ts`. Lands first.
- **2.6** (built at 50dc810 on `wt/1`, before review, 10:56 on 2026-09-30): creates `ChangesRequest`, its route and validation (`changesResponse`, `ChangesQuery`), the changes handler (`Changes.answer` in `daemon/changes.ts`, wired by `lifecycle.ts`) and `queryChanges`, and leaves edit attribution to this ticket (its Q7). Lands first.
- **2.7** (done): created `commands/hook.ts`, whose `PostToolBatch` request this ticket widens. Landed before this ticket.

#### Sizing

About 15 raw files and 20 estimated (15 times 1.3 is 19.5); code units 5 (4 criteria plus validation). Production: `daemon/protocol.ts`, `daemon/server.ts`, `daemon/changes.ts` (the handler, as 2.6 built it), `daemon/lifecycle.ts` (wiring its parts), `daemon/scheduler.ts`, `daemon/run-history.ts`, `daemon/change-record.ts`, `query-client.ts` and `cli/src/commands/hook.ts`. Tests, for create-tests: `packages/daemon/test/scheduler.test.ts` (the record, the counts and the holds), `server.test.ts` (the refusal), `daemon.test.ts` (a real daemon: an edit named during a run does not count), `packages/daemon/test/defects.json`, `packages/cli/test/hook.test.ts` (the request names the batch's files) and `packages/cli/test/defects.json`. Over 10 estimated, so dev delegates: the daemon (`change-record.ts`, `run-history.ts`, `scheduler.ts`, then `protocol.ts`, `server.ts`, `changes.ts` and `lifecycle.ts`), then the clients (`query-client.ts`, `commands/hook.ts`). The daemon part is one dependency chain through the scheduler, so it stays with one implementer.

#### Current structure of the modified files

As of main at a697fa4, read at 07:57 to 08:19 on 2026-09-30, before 2.4b, 2.6 and 2.7 land; each is re-read at the first task.

- `packages/daemon/src/daemon/change-record.ts` (124 lines): `MAX_COUNTED_CHANGES` (1,000); `Job` (a workspace path, or `undefined` for the discovery); `SubjectChanges` with `byJobs` (path to the jobs that changed it), `edits` and `everywhere`; `ChangeSets.addJob`, `addEdits` and `editedEverywhere`, counting distinct paths against the bound; `ChangeRecord` with `of(subject)`, `observed(digests)` (every path that differs from the last reading is an edit for every subject), `jobEnded(window, job)` (the window's `paths` become job-caused for every subject; a cause naming no path, or more paths than the bound, is an edit everywhere), and `begun(subject)`, which starts that subject's sets afresh. Keys are "the input state's own root-relative key" (`JobWindow.paths`, `inputs/input-jobs.ts`).
- `packages/daemon/src/daemon/run-history.ts` (341 lines): `RunHistory` owns the one `ChangeRecord`; `decide(due)` releases a held workspace when `#edited` finds an edit placed inside its inputs, logging `RELEASED_ENTRY`, then counts through `#nextCount`, which returns `NO_COUNT` on any edit inside; `began` returns `ended` (calls `jobEnded`), `notBegun` and `threw` (calls `begun`); `discoveryEnded`, `discoveryThrew` and `discoveryChanges` serve `discovery-history.ts`.
- `packages/daemon/src/daemon/discovery-history.ts` (274 lines, read only): `decide` releases a held discovery through `releaseCause`, which reads any edit (`unedited`: no record, `everywhere`, or `edits.size` above 0) as the release.
- `packages/daemon/src/daemon/scheduler.ts` (567 lines, already over P16's normal 500): holds `#runs: RunHistory`, built in its constructor, and passes it to the discovery history as `changes`. Its new method stays a one-line delegate to `#runs`, and dev confirms lint's 500-code-line cap still passes.
- `packages/daemon/src/inputs/queued-reads.ts` (read only): `#readNamed(filter, path)` labels the absolute path with `#label` to its input key before reading it.
- As 2.6 built them (50dc810 on `wt/1`, read at 10:58): `daemon/protocol.ts` declares `ChangesRequest` (`type`, `protocolVersion`, `paths`, `since?`) and `MAX_CHANGES_PATHS`; `server.ts`' `changesResponse` validates `paths` and `since` and hands `ChangesQuery` (`paths`, `since`) to `handlers.changes`; `daemon/changes.ts` (181 lines) holds `Changes`, whose `answer(query, signal)` runs `resolveFiles` (from `waits.ts`), returns a refusal, then awaits `inputs.readNamed(paths)` and answers in one turn, and `ChangesParts` (`consumerRoot`, `inputs`, `builds`, `stopSignal`, `log`, `moment`); `lifecycle.ts` (566 lines) builds `Changes` and delegates `changes(query, signal)` to it; `query-client.ts`' `queryChanges(consumerRoot, paths, options: ChangesOptions = {})` sends `since` when given. `cli/src/commands/hook.ts` is as ticket 2.7 creates it.

#### Existing tests this change breaks

- Possibly `packages/cli/test/hook.test.ts`: ticket 2.7's tests of the `PostToolBatch` request may assert its whole body, which now also carries `edited`. Every other change adds an optional field or a method. Found when dev starts by `rg -ln "ChangesRequest|ChangeRecord|queryChanges" packages/*/test`, by reading `hook.test.ts`'s assertions on the request it sends, and by `bun run typecheck` across the repository (P14).

#### Doc text

Dev reports this text with the build; the orchestrator writes it (C7).

- `docs/architecture.md`, the hook paragraph 2.7 adds: "It names the files each batch's `Write`, `Edit` and `NotebookEdit` calls edited, and the daemon counts a change to them as an edit, never as one its own runs or discoveries made, so those edits never hold a workspace or the discovery as self-changing when the request arrives before the round that counts them. A change a shell call makes is still judged by when it happened."
- `docs/architecture.md`'s known limits: the self-changing hold's limit that names the hook keeps its wording, and gains the first of § Known limits.
- `README.md`'s agent hook section gains: "It also tells the daemon which files the agent's `Write`, `Edit` and `NotebookEdit` calls edited, so such a save made while a run is going does not count as the run's own change. A file a shell command changed, or one you save yourself, is still judged by when the change happened."

#### Previous ticket

2.7 (ready-for-dev, a697fa4): the hook, which remembers each batch's own files in its `PostToolBatch` run and retries a refused request without the paths that vanished or left the root; this ticket adds those files to its request. Recent commits are docs and ticket authoring; none touches this ticket's files.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.7b, § Ticket 2.7, § Ticket 2.3k, § Ticket 2.3l.
- Tickets 2.7, 2.6, 2.3k and 2.3l (`_agent-docs/tickets/`).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (07:58 on 2026-09-30).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C7,C8,C10,C14,C38,C39,C40,C42,C46,C48,C55,C59,C115,C116,C160,C167 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P18,P19,P21,P31,P32 -->

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
  - packages/daemon/src/daemon/protocol.ts
  - packages/daemon/src/daemon/server.ts
  - packages/daemon/src/daemon/changes.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/scheduler.ts
  - packages/daemon/src/daemon/run-history.ts
  - packages/daemon/src/daemon/change-record.ts
  - packages/daemon/src/query-client.ts
  - packages/cli/src/commands/hook.ts
files_to_create:
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

- _agent-docs/tickets/2-7b-agent-edits-never-hold.md (created by create-ticket, 08:20 on 2026-09-30)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.7b: its scope line and sibling line at 08:08, the late-report limit and the ticket link at 08:21, under the orchestrator's 08:04 grant)
- _agent-docs/sprint-status.yaml (`2-7b-agent-edits-never-hold: backlog` added, 08:08, under the 08:04 grant)

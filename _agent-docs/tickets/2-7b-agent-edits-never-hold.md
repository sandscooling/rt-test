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

- [x] AC1: A `changes` request (ticket 2.6) may name, as edited, files that are among its paths. A request whose edited files are not a list of strings each equal to one of its paths is refused whole as invalid, with a reason, before any path is read. A request naming no edited file is answered exactly as before.
- [x] AC2: The daemon counts each change it records to a file a request names as edited as an edit, never as a change its own run or discovery made, whether the tracker recorded it while a job ran or between jobs, and whether it recorded it before the request arrived or, during the job running then, after; this holds when the request reaches the daemon before the round that follows the change decides its counts. So such a change never adds to ticket 2.3k's count of a workspace whose inputs hold the file, nor to ticket 2.3l's count of the discovery, and, like any edit, it sets those counts back to 0. Naming a file that no change reached counts nothing.
- [x] AC3: A workspace held as self-changing (ticket 2.3k) is released at the next round when a change to a file a request named as edited reaches its inputs, and a held discovery (ticket 2.3l) is released at the next round by such a change to any input; the log says so as it does for any edit.
- [x] AC4: After each batch, the agent hook's `changes` request (ticket 2.7) names as edited the files among those it sends that the batch's own `Write`, `Edit` and `NotebookEdit` calls saved: every such call counts as saved unless its result says it failed or was rejected, and a call with no result counts as saved (orchestrator's ruling, 17:36 on 2026-09-30). It names none for a batch whose calls name no file; its `Stop` and `UserPromptSubmit` requests name none. A change a shell call made, or a person's save, is named by no request and stays judged by when it happened, as today.

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

- [x] (Support) Before the first edit, re-read the landed code of ticket 2.6 (`ChangesRequest` in `daemon/protocol.ts`; `changesResponse` and `ChangesQuery` in `server.ts`; `Changes.answer` and `ChangesParts` in `daemon/changes.ts`, which `lifecycle.ts`' `changes` delegates to and whose parts it builds; `queryChanges` and `ChangesOptions` in `query-client.ts`) and ticket 2.7 (`commands/hook.ts`'s `PostToolBatch` run and its retry of a refused request), and confirm the names this ticket uses. As built at 50dc810, `changesResponse` reads only `paths` and `since` into the `ChangesQuery` it hands on, so an older daemon ignores `edited` (§ Known limits' daemon started before this ticket rests on it). Report each rename, and any refusal of an unknown member, to the orchestrator before building on it.
- [x] (AC1) In `packages/daemon/src/daemon/protocol.ts`, give `ChangesRequest` an optional `edited`, absolute paths. In `server.ts`' `changesResponse`, refuse a request whose `edited` is present and is not an array of strings each equal to one of its `paths`, with the invalid-request error, and carry it in `ChangesQuery` as `edited`; the paths' own bound and resolution then cover it (C8). `PROTOCOL_VERSION` is unchanged, as for 2.6's request.
- [x] (AC2, AC3) In `packages/daemon/src/daemon/change-record.ts`, let `ChangeRecord` take the input keys a caller reports as edited: a reported key already among a subject's job-caused paths moves to that subject's edits, for every subject, the discovery's included; and a reported key that any job records, running at the report or beginning before the request's named read has read that key, before or after the report, becomes an edit, never the job's, when that job ends. To know which jobs run, `ChangeRecord` learns when each subject's job begins, and holds reported keys per running subject from that begin until the job ends, whichever way it ends: stored, interrupted, threw, never began, or refused at its plan (C167; sanity check F1, 17:15). Jobs run one at a time today (ticket 2.3f), but the rule is stated per job so it holds either way. A reported key no change reached adds nothing (AC2).
- [x] (AC2, AC3) Pass the reported keys through `RunHistory` (`daemon/run-history.ts`) and `Scheduler` (`daemon/scheduler.ts`) as one method each, into the one `ChangeRecord` the run history owns, never a second record (C8). Tell the record of every begin and every way a job is abandoned: `RunHistory.began` and its `BegunRun`, which gains a call for `Scheduler#run`'s refused-at-plan exit (today `if (refusedAtPlan) return;` calls no `BegunRun` method); and `DiscoveryHistory.began` and its `notBegun` (`daemon/discovery-history.ts`), through a begin and a not-begun member added to its `DiscoveryChanges` interface beside `discoveryEnded` and `discoveryThrew` (sanity check F1, 17:15). `RunHistory.decide` and `DiscoveryHistory.decide` then release a hold and reset a count from the record as they already do, with no change of their own.
- [x] (AC2) In `Changes.answer` (`daemon/changes.ts`), after `resolveFiles` and before `inputs.readNamed(paths)`, hand the scheduler the input keys of the edited paths through a new member of `ChangesParts`, which `lifecycle.ts` wires to the scheduler's method (C40), taken from the same resolution the named read reads: `resolveFiles` (`daemon/waits.ts`) already returns each path's root-relative key (`resolveCallerPath`'s `path`), which `inputs.readNamed` takes, but collapses them into a set, so extend it to also return the key for each given path (`Waits` reads only `.paths`), and hand over the keys of the edited paths, the same strings `readNamed` reads next, never a second resolution or conversion (C8, C42; sanity check F2, 17:15). A missing file spelled in another case on Windows can yield a key that differs from the change's, which fails safe: the change goes unattributed and is judged by timing, as today. with no await between the handoff and the named read's start (C160). A request refused whole attributes nothing: ticket 2.6 decides every whole refusal, the invalid `edited` of AC1 included, in `changesResponse` or in `resolveFiles`, before any path is read (its AC1), and the named read's failures only leave the answer not determined.
- [x] (AC4) In `packages/daemon/src/query-client.ts`, let `queryChanges`' options also carry `edited`, sent only when given (C40). In `packages/cli/src/commands/hook.ts`, pass the batch's own files that the request sends as `edited` on `PostToolBatch`, leaving out any the retry leaves out, and pass none on `Stop` and `UserPromptSubmit`.
- [x] (Support) Send the orchestrator the text in § Doc text with the build (C7, C48).
- [x] (Support) Lint and typecheck: `bun x oxlint` over the changed files and `bun run typecheck` across the repository (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `ChangeRecord`, `SubjectChanges`, `Job` (`daemon/change-record.ts`): the job-caused and edit sets the report corrects.
- `RunHistory` and its `decide`, `#edited` and `#nextCount` (`daemon/run-history.ts`), and `DiscoveryHistory.decide` with `releaseCause` and `unedited` (`daemon/discovery-history.ts`): the holds and counts, which read the record unchanged.
- `Scheduler`'s `#runs` (`daemon/scheduler.ts`).
- `resolveFiles` (`daemon/waits.ts`), which already resolves each path through `resolveCallerPath` (`query/caller-paths.ts`) to the root-relative key `inputs.readNamed` takes.
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

- **A failed or rejected call is told apart by its result's text.** In Claude Code 2.1.286 a `PostToolBatch` entry's `tool_response` carries the result's content without `is_error`, so the hook leaves out a call whose result begins `<tool_use_error>` or "The user doesn't want to proceed with this tool use" (§ Completion Notes). A Claude Code release that rewords either sends such a call as edited again, which can release a hold or reset a count wrongly: a rerun too many, never a result read current. The hook fails toward vouching when unsure, since missing a real save could hold the agent's own workspace (orchestrator's ruling, 17:36 on 2026-09-30, on the dev's adversarial review F1).
- **A batch whose request the hook never sends** (no time left in its deadline, or no answer from the daemon) names none of its files as edited, so their changes are judged by timing. That costs at most one count, like a late report, and three in a row would hold (dev's adversarial review F2).
- **A call a `PreToolUse` hook denied** is vouched for unless its result uses one of the two forms above, which was not measured.
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

About 17 raw files and 22 estimated (17 times 1.3 is 22.1); code units 5 (4 criteria plus validation). Production: `daemon/protocol.ts`, `daemon/server.ts`, `daemon/changes.ts` (the handler, as 2.6 built it), `daemon/waits.ts` (`resolveFiles`' key per path, sanity check F2), `daemon/lifecycle.ts` (wiring its parts), `daemon/scheduler.ts`, `daemon/run-history.ts`, `daemon/discovery-history.ts` (the discovery's begin and not-begun, sanity check F1), `daemon/change-record.ts`, `query-client.ts` and `cli/src/commands/hook.ts`. Tests, for create-tests: `packages/daemon/test/scheduler.test.ts` (the record, the counts and the holds), `server.test.ts` (the refusal), `daemon.test.ts` (a real daemon: an edit named during a run does not count), `packages/daemon/test/defects.json`, `packages/cli/test/hook.test.ts` (the request names the batch's files) and `packages/cli/test/defects.json`. Over 10 estimated, so dev delegates: the daemon (`change-record.ts`, `run-history.ts`, `discovery-history.ts`, `scheduler.ts`, then `protocol.ts`, `server.ts`, `waits.ts`, `changes.ts` and `lifecycle.ts`), then the clients (`query-client.ts`, `commands/hook.ts`). The daemon part is one dependency chain through the scheduler, so it stays with one implementer.

#### Current structure of the modified files

As of main at a697fa4, read at 07:57 to 08:19 on 2026-09-30, before 2.4b, 2.6 and 2.7 land; each is re-read at the first task.

- `packages/daemon/src/daemon/change-record.ts` (124 lines): `MAX_COUNTED_CHANGES` (1,000); `Job` (a workspace path, or `undefined` for the discovery); `SubjectChanges` with `byJobs` (path to the jobs that changed it), `edits` and `everywhere`; `ChangeSets.addJob`, `addEdits` and `editedEverywhere`, counting distinct paths against the bound; `ChangeRecord` with `of(subject)`, `observed(digests)` (every path that differs from the last reading is an edit for every subject), `jobEnded(window, job)` (the window's `paths` become job-caused for every subject; a cause naming no path, or more paths than the bound, is an edit everywhere), and `begun(subject)`, which starts that subject's sets afresh. Keys are "the input state's own root-relative key" (`JobWindow.paths`, `inputs/input-jobs.ts`).
- `packages/daemon/src/daemon/run-history.ts` (341 lines): `RunHistory` owns the one `ChangeRecord`; `decide(due)` releases a held workspace when `#edited` finds an edit placed inside its inputs, logging `RELEASED_ENTRY`, then counts through `#nextCount`, which returns `NO_COUNT` on any edit inside; `began` returns `ended` (calls `jobEnded`), `notBegun` and `threw` (calls `begun`); `discoveryEnded`, `discoveryThrew` and `discoveryChanges` serve `discovery-history.ts`.
- `packages/daemon/src/daemon/discovery-history.ts` (274 lines): its `DiscoveryChanges` interface holds `discoveryChanges`, `discoveryEnded` and `discoveryThrew`, and `began(revision)` returns a `BegunDiscovery` with `notBegun`; this ticket adds the begin and not-begun members (sanity check F1). `decide` releases a held discovery through `releaseCause`, which reads any edit (`unedited`: no record, `everywhere`, or `edits.size` above 0) as the release.
- `packages/daemon/src/daemon/scheduler.ts` (567 lines, already over P16's normal 500): holds `#runs: RunHistory`, built in its constructor, and passes it to the discovery history as `changes`. Its new method stays a one-line delegate to `#runs`, and dev confirms lint's 500-code-line cap still passes.
- `packages/daemon/src/daemon/waits.ts`: `resolveFiles(paths, consumerRoot, query)` resolves each path through `resolveCallerPath`, refuses a directory or any refused path whole, and returns `{ paths }`, the root-relative keys collapsed into a set; this ticket also returns each given path's key (sanity check F2). `inputs.readNamed` takes those keys; inside the tracker, `#readNamed` gives an existing file's key back unchanged (`#label`, `inputs/queued-reads.ts`, read only).
- As 2.6 built them (50dc810 on `wt/1`, read at 10:58): `daemon/protocol.ts` declares `ChangesRequest` (`type`, `protocolVersion`, `paths`, `since?`) and `MAX_CHANGES_PATHS`; `server.ts`' `changesResponse` validates `paths` and `since` and hands `ChangesQuery` (`paths`, `since`) to `handlers.changes`; `daemon/changes.ts` (181 lines) holds `Changes`, whose `answer(query, signal)` runs `resolveFiles` (from `waits.ts`), returns a refusal, then awaits `inputs.readNamed(paths)` and answers in one turn, and `ChangesParts` (`consumerRoot`, `inputs`, `builds`, `stopSignal`, `log`, `moment`); `lifecycle.ts` (566 lines) builds `Changes` and delegates `changes(query, signal)` to it; `query-client.ts`' `queryChanges(consumerRoot, paths, options: ChangesOptions = {})` sends `since` when given. `cli/src/commands/hook.ts` is as ticket 2.7 creates it.

#### Existing tests this change breaks

- `packages/cli/test/hook.test.ts`: D3550 asserts `Object.keys(options)` equals `["boundMs"]` on a batch that wrote `a.ts`, which breaks once `edited` is sent (found by the dev at 17:15). Every other change adds an optional field or a method. Found when dev starts by `rg -ln "ChangesRequest|ChangeRecord|queryChanges" packages/*/test`, by reading `hook.test.ts`'s assertions on the request it sends, and by `bun run typecheck` across the repository (P14).

#### Doc text

Dev reports this text with the build; the orchestrator writes it (C7).

- `docs/architecture.md`, the hook paragraph 2.7 adds: "It names the files each batch's `Write`, `Edit` and `NotebookEdit` calls saved, and the daemon counts a change to them as an edit, never as one its own runs or discoveries made, so those edits never hold a workspace or the discovery as self-changing when the request arrives before the round that counts them. A call that failed or was rejected names nothing. A change a shell call makes is still judged by when it happened."
- `docs/architecture.md`'s known limits: the self-changing hold's limit that names the hook keeps its wording, and gains: "A report that reaches the daemon after the round following the change has counted it, or one the hook could not send, lets that one count rise, so a hold would need three such reports in a row."
- `README.md`'s agent hook section gains: "It also tells the daemon which files the agent's `Write`, `Edit` and `NotebookEdit` calls saved, so such a save made while a run is going does not count as the run's own change. A call that failed or was rejected names nothing. A file a shell command changed, or one you save yourself, is still judged by when the change happened."

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
  - packages/daemon/src/daemon/waits.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/scheduler.ts
  - packages/daemon/src/daemon/run-history.ts
  - packages/daemon/src/daemon/discovery-history.ts
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

Dev session: threadId d03e8244-075a-47e0-85f6-bd9db5715f69

#### Test Files This Change Broke

- `packages/daemon/test/changes.test.ts`: the daemon typecheck fails at lines 204, 231 and 311, since `ChangesParts` now requires `reportEdits` and `ChangesQuery` requires `edited` (empty for none). Give the stand-in parts a `reportEdits` and the query literals `edited: []`.
- `packages/cli/test/hook.test.ts`: D3550 asserts `Object.keys(options)` equals `["boundMs"]` on a batch that wrote `a.ts`; the options now also carry `edited`.
- `packages/daemon/test/defects.json`, anchors that no longer match (each record whose mutated file this change edited is re-proved anyway):
  - D3184 (`scheduler.ts`): the refused-at-plan exit is now `if (refusedAtPlan) {\n        begun.refused();\n        return;\n      }\n      begun.notBegun();`.
  - D3438 and D3449 (`waits.ts`): `resolveFiles` now builds `byGiven` (`else byGiven.set(path, target.path);`) and returns inside `if (refusals.length === 0) {`.
  - D3460: `namedPaths` moved from `server.ts` to `packages/daemon/src/daemon/request-fields.ts`, same text.
  - D3476 and D3477 (`changes.ts`): `const { paths, byGiven } = resolved;`, and the named read now sits in `try { await inputs.readNamed(paths); } finally { report?.read(); }`.
- `packages/cli/test/defects.json`, anchors that no longer match:
  - D3529 and D3564 (`hook.ts`): `askSession` takes a third argument (`NONE_EDITED` on a turn end or prompt, `edits.saved` on a batch).
  - D3550 (`hook.ts`): the options are now built as `{ ...(since === undefined ? {} : { since }), boundMs, ...(edited.length === 0 ? {} : { edited }) }`.
  - D3554: the root check moved to `packages/cli/src/hook-edits.ts` as `if (!resolveCallerPath(file, root).ok) continue;`.
  - D3556 (`hook.ts`): `withEdits(memory.of(agent), edits.named, Date.now())`.

#### ACs Owed a Test

- AC2: the record logic is traced (below), but the end-to-end guarantee, a named edit landing in a running job's window counting as an edit on a real daemon when the request beats the round, is observable only by `daemon.test.ts`, and each arm of the record (a report after the job ended, during it before and after the change, a job beginning before the named read resolves, a key no change reached, a job that threw, never began or was refused) by `scheduler.test.ts`.
- AC4: the request's body (`edited` is the batch's saved files among the paths sent, the retry's included, none on `Stop` and `UserPromptSubmit`, none for a failed or rejected call) is observable only by `hook.test.ts`.

#### Tests Owed

- `packages/daemon/src/daemon/request-fields.ts`: `editedPaths` refuses a non-array `edited` and one naming a file outside `paths`, before `handlers.changes` runs (server.test.ts, AC1).
- `packages/cli/src/hook-edits.ts`: a `Write` or `Edit` call whose `tool_response` begins `<tool_use_error>` or "The user doesn't want to proceed with this tool use" is remembered but never sent as edited; a call with no `tool_response` is sent (hook.test.ts). The test pins both prefixes, as the author asked at 17:35.

### Tests Record

Tests session: threadId 7308bf78-b554-492a-9370-75a85ae73ea9

#### Named Defects

- D3573: A changes query hands over its edited files only once its named read has resolved, so a job that began while the read ran records the agent's change as its own. (AC2)
- D3574: A changes query never closes its report of edited files, so every job that begins later holds them and the daemon's own later changes to those files count as edits. (AC2)
- D3575: A changes query reports every file it names as edited, not only the ones named as edited, so a daemon job's change to a file the agent did not save counts as an edit. (AC2)
- D3576: A changes query reports the edited files as the caller spelled them, absolute, which match no key the tracker records, so the agent's change still counts as the job's. (AC2)
- D3577: Every request names every file the session edited as edited, so a daemon job's later change to a file an earlier batch saved counts as the agent's edit. (AC4)
- D3578: The hook no longer recognizes Claude Code's `<tool_use_error>` result, so a call that failed and saved nothing is named as edited. (AC4)
- D3579: The hook no longer recognizes Claude Code's rejection result ("The user doesn't want to proceed with this tool use"), so a call the user rejected, which saved nothing, is named as edited. (AC4)
- D3580: A result given as a list of text blocks is never read, so a failed call reported that way is named as edited. (AC4)
- D3581: A call with no result counts as having saved nothing, so the agent's real save goes unnamed and its change is judged by timing. (AC4)
- D3582: A turn end's and a prompt's requests name the session's files as edited, though no call saved them then, so a daemon job's change to them counts as an edit. (AC4)
- D3583: The request asked again without a vanished file still names that file as edited, which the daemon refuses whole, so the retry never gets an answer. (AC4, AC1)
- D3584: A changes request whose edited is not a list is taken as naming none rather than refused, so a malformed report is silently dropped. (AC1)
- D3585: A changes request naming as edited a file it does not name among its paths is taken, so a file no named read reads is counted as edited. (AC1)
- D3586: The daemon drops a changes request's edited files before its query, so the agent's reported edits are never counted as edits. (AC1, AC2)
- D3587: A changes request naming no edited file is refused as invalid, so every client that names none, and every daemon client from before, gets no answer. (AC1)
- D3588: A report of edited keys never reaches the jobs running at it, so a change the running job then records to a reported key counts as the job's own. (AC2)
- D3589: A job that begins while a report's named read is still open holds none of its keys, so the change that read records inside the job counts as the job's own. (AC2)
- D3590: A report stays open after its named read resolved, so every job beginning later holds its keys and the daemon's own later changes to them count as edits. (AC2)
- D3591: A job that held any report counts every path it changed as an edit, so the daemon's own change to a file the agent did not report never counts toward a hold. (AC2)
- D3592: The run history never tells the change record that a run began, so an agent's reported edit during the run counts as the run's own change and its own saves hold the workspace. (AC2)
- D3593: The discovery history never tells the change record that a discovery began, so an agent's reported edit during the discovery counts as the discovery's own change and its own saves hold the discovery. (AC2)
- D3594: A report arriving after the job that changed the file ended leaves the change as the job's, so the agent's save still counts toward a hold of the workspace. (AC2)
- D3595: A report of a file a job changed drops the change rather than counting it as an edit, so it never releases a workspace held as self-changing. (AC3)
- D3596: A report moves a job's change to the workspaces' edits but never the discovery's, so an agent's save never releases a held discovery. (AC3)
- D3597: A report counts a named file as an edit though no change reached it, so a request naming an unchanged file releases a held workspace. (AC2)
- D3598: The lifecycle never hands a changes request's edited files to the scheduler, so an agent's saves during a run count as the run's own changes and hold its workspace. (AC2)
- D3599: `queryChanges` never sends the files named as edited, so the daemon never hears of the agent's saves. (AC4)
- D3550 (existing, 2.7): its test now expects the options `boundMs` and `edited` for a batch that wrote a file, since the batch's saved file is now named; its record keeps its own defect (no bound), re-anchored to the options as built now.

Where the tests differ from the handoff: AC2's end-to-end guarantee is pinned in `lifecycle.test.ts` (D3598), which drives the real `DaemonLifecycle`, `Changes`, scheduler and change record over a scripted executor and inputs, rather than on a real daemon in `daemon.test.ts`, which has no fixture whose runs rewrite their own inputs. The join to the tracker is pinned by D3576: the key reported is the key the named read reads, which the tracker records unchanged. The record's arms for a job that threw, never began or was refused are inert (below).

Proof, by id through the run lease, of the 359 records that mutate a file this build edited or whose test file this round edited other than by adding: 359/359 detected on Windows under Node 24.19.0 (18:05 to 18:18) and on WSL Ubuntu under Node 24.19.0 (18:18 to 18:24), baseline green before and after on both. `scheduler.test.ts`, `lifecycle.test.ts` and `daemon.test.ts` only gained lines, so their other records were not re-proved.

Re-anchored, defect unchanged: D3184, D3438, D3449, D3460 (now `request-fields.ts`), D3476, D3477, D3529, D3550, D3554 (now `hook-edits.ts`), D3556, D3564. `changes.test.ts`' stand-in parts gained `reportEdits` and its query literal `edited: []`, which repaired D3476 to D3485, D3509 and D3518.

#### Deliberately Untested

- packages/daemon/src/daemon/scheduler.ts: `Scheduler.reportEdits` is a one-line delegate to `RunHistory.reportEdits`, itself one to the record; breaking either is the defect D3592 and D3594 name, and both go red.
- packages/daemon/src/daemon/change-record.ts: the `#running.delete` in `jobNotBegun` and `jobThrew` is inert: a subject's stale running entry is replaced whole by its next `jobBegan` and read only at its own `jobEnded`, so no count changes without it.
- packages/daemon/src/daemon/run-history.ts: `BegunRun.refused` and `notBegun`'s call of `jobNotBegun`, and `scheduler.ts`' `begun.refused()`, are inert for the same reason.
- packages/daemon/src/daemon/discovery-history.ts: `notBegun`'s call of `discoveryNotBegun` is inert for the same reason.
- packages/daemon/src/daemon/changes.ts: `#reportEdits`' early return for no edited file is inert, since an empty report changes nothing.
- packages/daemon/src/daemon/request-fields.ts: `editedPaths`' `typeof path !== "string"` operand is redundant, since a non-string is never among `paths` and `named.has` refuses it; the refusal's wording is static copy.
- packages/cli/src/hook-edits.ts: the `trimStart()` before the prefix check guards leading whitespace no Claude Code result was observed to carry, an edge case not chased.
- packages/daemon/src/daemon/protocol.ts, packages/daemon/src/query-client.ts `ChangesOptions.edited`, packages/daemon/src/daemon/server.ts `ChangesQuery.edited`: type-only.

### Review Record

#### Test Coverage Gaps

None.

### Completion Notes

Dev, 17:16 to 17:35 on 2026-09-30, Tree 2 (`wt/2` at 14a7e32).

**Sanity check (17:15).** F1 (the discovery's begin and not-begun, and the refused-at-plan exit, were outside the file list) and F2 (`resolveFiles` already returns the keys `readNamed` takes, but loses each given path's key) went to the author, which confirmed both and updated the ticket at 17:16. Unverified Assumptions: none to resolve.

**What was built.**

- `ChangesRequest.edited` (`protocol.ts`) is checked by `editedPaths` before any work: absent reads as none; a non-array, or any entry that is not one of `paths`, is refused whole as invalid, with a reason that never echoes the value. `ChangesQuery.edited` carries the files, empty for none.
- `ChangeRecord` learns each subject's job begin (`jobBegan`) and every way it ends (`jobEnded`, `jobThrew`, `jobNotBegun`), and takes `reportEdits(keys)`, which returns an `EditReport`:
  - a reported key among any subject's job-caused paths moves to that subject's edits now;
  - every running job holds the keys, and so does a job that begins while the report is open, until the caller's named read resolves (`read()`);
  - at `jobEnded`, a window path the job holds is added as an edit for every subject, never as job-caused;
  - a key no change reached adds nothing.
- `RunHistory.reportEdits` and `Scheduler.reportEdits` delegate to the one record. `RunHistory.began` tells it of the begin, and `BegunRun` gains `refused`, which `Scheduler#run`'s refused-at-plan exit now calls. `DiscoveryChanges` gains `discoveryBegan` and `discoveryNotBegun`, called from `DiscoveryHistory.began` and its `notBegun`. Neither `decide` changed.
- `resolveFiles` also returns `byGiven`. `Changes.answer` hands `ChangesParts.reportEdits` the edited paths' keys synchronously before `inputs.readNamed(paths)` and closes the report in a `finally`. `lifecycle.ts` wires `reportEdits` to the scheduler.
- `queryChanges` sends `edited` when given. The hook sends the batch's saved files among the paths each attempt sends, the retry's included, and passes `NONE_EDITED` on `Stop` and `UserPromptSubmit`.

**Size splits.**

- `server.ts` went past the 500-code-line cap, so its request field checks (`error`, `valueShape`, `namedPaths`, the new `editedPaths`) moved to `daemon/request-fields.ts`.
- `hook.ts` reached the cap, so the batch-edit parsing (`FILE_PATH_INPUTS`, `editedPath`, the root check) moved to `cli/src/hook-edits.ts`.
- Code lines after the change: `hook.ts` under the cap, `scheduler.ts` 495, `lifecycle.ts` 493.

**Adversarial review (17:23 to 17:31), 5 findings.**

- **F1, HIGH, fixed.** The hook vouched for every `Write`, `Edit` and `NotebookEdit` call, even a failed or rejected one. So a daemon job's rewrite of X, followed by the agent's Edit of X refused "modified since read", would release a hold with no edit. That costs a rerun too many and never reads a result current, so it is not the 03:25 risk; the fix stands on AC4's meaning (the author, 17:35).
  - Verified in the installed Claude Code 2.1.286 bundle (`~/.local/bin/claude.exe`): each `PostToolBatch` `tool_calls` entry is `{tool_name, tool_input, tool_use_id, tool_response}`, where `tool_response` is the tool result's `content`, without `is_error`.
  - A failed call's content is wrapped in `<tool_use_error>` (for example "...has been modified since read, either by the user or by a linter..."). A rejected call's content begins "The user doesn't want to proceed with this tool use".
  - `batchEdits` now remembers every named file, as 2.7 does, but sends as `edited` only a call whose result begins with neither. A call with no `tool_response` counts as saved.
  - This narrows AC4's "the batch's own `Write`, `Edit` and `NotebookEdit` files" to the files those calls saved. Asked the author at 17:35, which accepted it as AC4's correct meaning and amended AC4 and § Known limits at 17:35. It asked that the two prefixes stay named constants (`UNSAVED_RESULT_STARTS`) pinned by a test (§ Tests Owed).
- **F2, MEDIUM, recorded.** A batch whose request the hook never sends (no time left, or no answer from the daemon) never names its files as edited. That costs one count, like a late report, and three in a row would hold. It is recorded as a known limit below, per the owner's 03:25 ruling: it cannot report a stale result as current.
- **F3, F4 and F5, LOW, fixed.** The `EditReport.read` docs, the `ChangesQuery.edited` doc and `ChangeRecord`'s class doc.
- Post-fix re-validation: lint and both workspace typechecks, below.

**Known limits beyond the ticket's.**

- A batch whose request never reaches the daemon names nothing as edited (F2).
- A call a `PreToolUse` hook denied is vouched for unless its result uses one of the two forms above, which was not measured.
- A write through the `Write` tool whose content equals the file's current content, to a file a job changed, moves that job change to the edits. This costs at most one extra run.
- The report's keys come from `resolveCallerPath`. A missing file spelled in another case on Windows can yield a key that differs from the change's, which fails safe (sanity check F2).

**Validation (17:33 to 17:34).**

- `bun x oxlint` over all 14 changed source files: exit 0.
- `bun x prettier --check`: clean.
- `bun run --filter rt-test typecheck`: exit 0.
- `bun run --filter @rt-test/daemon typecheck`: exit 1, only at `test/changes.test.ts` 204, 231 and 311 (§ Test Files This Change Broke).
- `node scripts/check-line-citations.mjs`: clean.
- The repo-wide typecheck and `bun run check` are the orchestrator's.

**Acceptance evidence.**

- AC1 is traced: `changesResponse` runs `editedPaths` before `queryResponse` calls `handlers.changes`. An absent `edited` gives `[]`, and `#reportEdits` then returns undefined, so the flow is unchanged.
- AC3 is traced: a reported key lands in each subject's `edits`. `RunHistory.decide`'s `#edited` then places it inside a held workspace's inputs and releases it with `RELEASED_ENTRY`, and `DiscoveryHistory`'s `releaseCause` reads any edit as `EDITED_CAUSE`.
- AC2 and AC4 are traced but owed a test (§ ACs Owed a Test).

**README.** The hook's behavior changed for users: § Doc text's README and architecture lines go to the orchestrator. The README line should say the calls' saved files, per F1 above.

**GitHub issues.** None filed; `review-changes` runs the closing scan.

### File List

- _agent-docs/tickets/2-7b-agent-edits-never-hold.md (created by create-ticket, 08:20 on 2026-09-30)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.7b: its scope line and sibling line at 08:08, the late-report limit and the ticket link at 08:21, under the orchestrator's 08:04 grant)
- _agent-docs/sprint-status.yaml (`2-7b-agent-edits-never-hold: backlog` added, 08:08, under the 08:04 grant)
- packages/daemon/src/daemon/protocol.ts (modified, dev)
- packages/daemon/src/daemon/server.ts (modified, dev)
- packages/daemon/src/daemon/request-fields.ts (created, dev: the request field checks moved out of server.ts)
- packages/daemon/src/daemon/change-record.ts (modified, dev)
- packages/daemon/src/daemon/run-history.ts (modified, dev)
- packages/daemon/src/daemon/discovery-history.ts (modified, dev)
- packages/daemon/src/daemon/scheduler.ts (modified, dev)
- packages/daemon/src/daemon/waits.ts (modified, dev)
- packages/daemon/src/daemon/changes.ts (modified, dev)
- packages/daemon/src/daemon/lifecycle.ts (modified, dev)
- packages/daemon/src/query-client.ts (modified, dev)
- packages/cli/src/commands/hook.ts (modified, dev)
- packages/cli/src/hook-edits.ts (created, dev: the batch-edit parsing moved out of hook.ts, with the saved-call check)
- _agent-docs/tickets/2-7b-agent-edits-never-hold.md (dev: checkboxes, Dev Handoff, Completion Notes, File List)
- packages/daemon/test/changes.test.ts (modified, tests: repaired, D3573 to D3576)
- packages/daemon/test/server.test.ts (modified, tests: D3584 to D3587)
- packages/daemon/test/scheduler.test.ts (modified, tests: add-only, D3588 to D3597)
- packages/daemon/test/lifecycle.test.ts (modified, tests: add-only, D3598)
- packages/daemon/test/daemon.test.ts (modified, tests: add-only, D3599)
- packages/daemon/test/defects.json (modified, tests: 20 records added, 6 re-anchored)
- packages/cli/test/hook.test.ts (modified, tests: D3550 updated, D3577 to D3583)
- packages/cli/test/defects.json (modified, tests: 7 records added, 5 re-anchored)
- _agent-docs/tickets/2-7b-agent-edits-never-hold.md (tests: AC2 and AC4 ticked, Tests Record, File List)

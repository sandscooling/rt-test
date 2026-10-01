# Ticket 3.3b: Mutation file digest on the experiment record

## Ticket

As the daemon, which keeps each falsification verdict as evidence (ticket 3.4),
I want each experiment record of a job's reply to carry a digest of its mutation file's text as the job read it,
so that evidence can be bound to the text that was mutated, and read stale once that file changes even when the file is in no input fingerprint.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

Every criterion holds on Vitest 4.1.x and 5.x, on Windows and on Linux.

- [ ] AC1: Each experiment record of a falsification job's reply whose mutation's file the job read carries a digest of that file's text as the job read it when it started, whatever the record's status and whatever its not-run reason; a record whose file could not be read carries none (C12). The reply's falsifier version is one higher than ticket 3.3 left it, and nothing else of the reply differs from what ticket 3.3 built. (FR15)
- [ ] AC2: The digest is the value `wholeDigest` gives for the text, the value ticket 3.4's query computes from the file, and so a function of the text alone: two experiments that mutate the same file carry equal digests, the text of a file with a byte order mark or CRLF line endings digests as the text of that file read whole as UTF-8, mark and line endings kept, and a file that differs in any character digests differently. The member holds the digest and no part of the text, and this ticket adds no other member to the record (C147). (FR15)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question) | Why it matters if wrong | How to check |
| --- | -------------------------- | ----------------------- | ------------ |

None: the ticket calls no third-party behavior this repository has not already exercised. The digest is `node:crypto`'s SHA-256 through `wholeDigest`, which `packages/daemon/src/inputs/fingerprint.ts` and `inputs/env-files.ts` already call.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing; the table holds none.
- [ ] (AC1, AC2) In `falsify/experiment-record.ts`, give both members of `ExperimentRecord` one optional member for the mutation file digest, a string, and raise `FALSIFIER_VERSION` by one, since a record now holds more: ticket 3.4 binds evidence to that version and ticket 3.6 keeps a canary result for each.
- [ ] (AC1, AC2) In `falsify/falsify-workspace.ts`, set the digest on every record whose mutation's file `#textOf` read, from the text `FalsificationRuns` already holds in `#texts`, with `wholeDigest` from `inputs/input-inventory.ts`, the function ticket 3.4 calls on the query side (C5, C8). Read no file a second time. Set it in one place for every record, so no path that builds a record (a run, a not-run reason, an interruption) can leave it out. Count the defect records anchored in these two files again once ticket 3.3 has landed, edit around their anchored text, and list any record whose anchor an edit breaks under Dev Handoff, Test Files This Change Broke. `falsify-workspace.ts` holds 461 of its 500 code lines after ticket 3.3, by that ticket's Completion Notes (P16).
- [ ] (AC1) Check every reader of `ExperimentRecord` and of the reply once ticket 3.3 has landed (C38): at c6c2bb83 the type is read only in `falsify/falsify-workspace.ts` and `falsify/run-facts.ts`, each by named member, and the reply crosses the executor's channel whole (`{ type: "falsified", job }` in `daemon/executor-main.ts`, returned as `reply.job` by `Executor.falsify`), so nothing rebuilds a record. Search the `defects.json` files for a record whose `new` text builds an experiment record as a literal or replaces the place the digest is set. Stop and report any reader that copies a record member by member, since its file is not in this ticket's list.
- [ ] (Support) Report to the orchestrator the sentence for `docs/architecture.md` § Falsification jobs (an experiment's record carries a digest of its mutation file's text as the job read it); write none of it yourself.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `wholeDigest(content)` (`packages/daemon/src/inputs/input-inventory.ts`): SHA-256 as hex over a string or bytes held in memory. Exported. Its module imports Node built-ins, `vitest/error-text.js` and `vitest/find-workspaces.js` at run time; `find-workspaces.ts` imports Node built-ins, `json-guards.js` and `error-text.js`, and `error-text.ts` imports nothing (read at 00:17 on 2026-10-01). `daemon/executor-main.ts` already imports both at run time, so the executor process loads nothing new, and the chain reaches neither the store nor the daemon's server.
- In ticket 3.3's build (commit c6c2bb83 on `wt/1`, read at 23:47 on 2026-09-30): `FalsificationRuns.#textOf(file)` and its `#texts` map, which hold each mutated file's text read once when the job starts, through `readText` (`readFileSync(file, "utf8")`); `FalsificationRuns.all`, whose `ordered()` returns the job's records in the order given; `ExperimentRecord`, `FALSIFIER_VERSION` (`falsify/experiment-record.ts`).
- The private `digestOf(text)` in `packages/daemon/src/falsify/stale-transform-guard.ts` gives the same value for a string. Do not export it for this: one exported function already answers the question (C5).

### Must Create

Nothing: one member of an existing type and its value.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### What the criteria rest on

FR15: "Mark defect evidence stale when its test, mutation, inputs, or execution configuration change, keep it across a daemon restart, and re-verify it at lower priority than ordinary tests."

The orchestrator's ruling at 23:45 on 2026-09-30, on ticket 3.4's question F9: "Evidence is also bound to a digest of the mutation file's text as the job read it. 3.4 adds that digest to the job's experiment record (it builds after 3.3 lands, so it may edit falsify/experiment-record.ts and falsify-workspace.ts for this one additive field and raise FALSIFIER_VERSION), stores it, and the defects query reads evidence stale with the cause "mutation file changed" when the file's text digest differs. Reason: a detected verdict reading current after the mutated file was edited is stale evidence reported as current, and that exception is absolute." At 00:09 on 2026-10-01 the orchestrator cut the record's member out of 3.4 into this ticket, since 3.4 had reached 33 estimated files: "A record field with no reader yet is acceptable here, as 3.2's record was."

`FALSIFIER_VERSION`'s own comment, in `falsify/experiment-record.ts`: "Raise it whenever what a falsification record, its mutation transform, its reach probe or a judgement means changes, so evidence recorded under the old meaning can be retired."

#### Design decisions (scope of analysis: the record's member and its digest; storing it and comparing it are ticket 3.4's and unanalyzed here)

- **The digest is of the text read when the job started.** `FalsificationRuns` reads each mutated file once, in `#textOf`, before any run, and plans every experiment from that text. A file edited later in the job is served from its new text at the next run (a known limit `docs/architecture.md` § Falsification jobs records); its record still carries the digest of the start text, so ticket 3.4's query reads the evidence stale for as long as the edit stands, the safe direction. A file edited during the job and restored to the same text before the query reads current though a run was served other text. For a file in the workspace's inputs, ticket 3.5 stores nothing, since it decides moved inputs from the change events during the job; for a declared non-input no event comes, and that case is not closed here (put to the orchestrator with the handoff at 00:17 on 2026-10-01).
- **Every record whose file was read carries it.** A verdict can come from a run or from a reason decided with the text in hand (no probe site, no module, baseline did not pass), and ticket 3.4 refuses to store a verdict whose record has no digest. Only the unreadable file leaves none, and that reason reads no verdict. No record is built before its file is read: `FalsificationRuns.all` plans every experiment first, synchronously and whatever the abort signal says, and `#plan` reads the file before anything else; a job aborted before its workspace loads reads `interrupted-before-load` and holds no record at all.
- **One digest function on both sides.** The job digests the string `readFileSync(file, "utf8")` returns, and ticket 3.4's query the string `readFile(path, "utf8")` returns in `readMutationFile`; both keep a byte order mark. `wholeDigest` over the string gives equal digests for an unedited file; a second function on either side would have to be kept equal to it by hand (C8).
- **The member is optional on both members of the record,** so the type says a record may hold none, and absent means the file was not read (C12).
- **The member has no production reader until ticket 3.4 lands** (C59), accepted by the orchestrator at 00:09 on 2026-10-01. Its tests read it from the job's reply.

#### Ticket review

One review agent read the ticket and its bound rules at 00:12 on 2026-10-01 and returned 10 findings, all applied. Three were settled by reading ticket 3.3's build: the executor process already loads every module `wholeDigest`'s module reaches (finding 6); nothing rebuilds a record member by member (finding 1); and no record is built before its file is read (finding 8). One went to the orchestrator: a file edited during the job and restored before the query (finding 7).

#### Pending siblings

- 3.3 (built at c6c2bb83 on `wt/1`, not yet tested or reviewed) writes both files this ticket edits. This ticket builds only after 3.3 lands on `main`. If 3.3's review changes the record or where the job reads a file, the orchestrator tells this ticket's author, who amends it.
- 3.2b (ready-for-dev, building in Tree 2) writes `falsify/reach-probe.ts` and `falsify/probe-slots.ts` and neither of this ticket's files. Both may append records to `packages/daemon/test/falsify/defects.json` and tests to `falsify-workspace.test.ts`; the second to land merges `main` in and proves the shared files' records.
- 3.4 (backlog) stores the digest with each verdict and compares it with the file's text when it answers `defects`. It edits neither of this ticket's files.
- 3.6 (backlog) keeps a canary result per Vitest and falsifier version; the raise reaches it only as a number.

#### Current structure of the modified files

As ticket 3.3's build leaves them on `wt/1`.

- `packages/daemon/src/falsify/experiment-record.ts`: `FALSIFIER_VERSION = 2`; `ExperimentRecord` is a `ran` member (`defectId`, `run`, `mutation`, an optional `confirming`) or a `not-run` member (`defectId`, `reason`). The record crosses the executor's channel as JSON.
- `packages/daemon/src/falsify/falsify-workspace.ts`: `FalsificationRuns.#plan` calls `startCheck(experiment, this.#textOf(experiment.mutation.file))` for every experiment before any run; `#textOf` reads through `readText` and keeps the result in `#texts`; records are built by `notRun(experiment, reason)` and in `#experiment`, and collected in `all`, whose `ordered()` returns them in the order given.

#### Tests this change may break

- A test that reads a job's `falsifierVersion` as 2, or compares a whole experiment record with a literal, changes: `packages/daemon/test/falsify/falsify-workspace.test.ts`, `falsify-executor.test.ts`, and the tests ticket 3.3's tests session is writing now.
- Records anchored in the two files, counted with `grep -c` on each `"file"` path across the daemon's `defects.json` files at 25514fe6, before ticket 3.3's tests (23:47 on 2026-09-30): `falsify/experiment-record.ts` 11 and `falsify/falsify-workspace.ts` 9. Count again once 3.3 has landed, edit around their anchored text, and list any record whose anchor an edit breaks under the Dev Handoff.

#### Previous-ticket intel

3.3 (built, on `wt/1`): "`falsify/experiment-record.ts`: `FALSIFIER_VERSION` is 2." "`falsify/run-relay.ts` (new): the `RunRelay` reporter moved out of `falsify-workspace.ts` unchanged, which the confirming run and the judging had brought to about 490 of its 500 code lines. It holds 461 now." Its `experimentFacts` refuses a reply whose records do not pair one for one, in order, with its experiments, so every experiment given has a record to carry the digest.

#### Sizing

6 raw files and 8 estimated (6 times 1.3 is 7.8), before the test files ticket 3.3's tests session adds; code units 3 (2 criteria plus validation). Production, modified: `falsify/experiment-record.ts`, `falsify/falsify-workspace.ts`. Tests, for create-tests: `packages/daemon/test/falsify/falsify-workspace.test.ts`, `packages/daemon/test/falsify/falsify-executor.test.ts` and `packages/daemon/test/falsify/defects.json`. This ticket's file. One chain through one subsystem, built by one session.

### References

- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.3b and § Ticket 3.4.
- `_agent-docs/tickets/3-4-defect-evidence.md` (the store and the query that read the digest) and `_agent-docs/tickets/3-3-verdicts-from-facts.md` (the record and the job).
- ADR-0007; `docs/requirements.md`: FR15.
- `docs/architecture.md` § Falsification jobs. `docs/testing.md` § Falsification jobs, mutation transforms and reach.
- GitHub issues: `node scripts/list-open-issues.mjs` printed "0 open issues, complete" on 2026-09-30 at 23:34.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C12,C14,C38,C45,C48,C59,C118,C147 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P16,P17,P36,P37 -->

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
sizing_ac_count: 3
files_to_modify:
  - packages/daemon/src/falsify/experiment-record.ts
  - packages/daemon/src/falsify/falsify-workspace.ts
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

- `_agent-docs/tickets/3-3b-mutation-file-digest.md` (created by create-ticket, 00:10 on 2026-10-01, cut from ticket 3.4)

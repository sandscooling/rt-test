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

Resolution (dev, 02:11 on 2026-10-01): no row to resolve. CONFIRMED in this repository's own source that `wholeDigest` is `createHash("sha256").update(content).digest("hex")` over a string or bytes (`wholeDigest` in `packages/daemon/src/inputs/input-inventory.ts`), and that its module imports only Node built-ins, `vitest/error-text.js` and `vitest/find-workspaces.js` at run time, with `inputs/input-filter.js` as a type alone.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing; the table holds none.
- [x] (AC1, AC2) In `falsify/experiment-record.ts`, give both members of `ExperimentRecord` one optional member for the mutation file digest, a string, and raise `FALSIFIER_VERSION` by one, from 2 to 3, since a record now holds more: ticket 3.4 binds evidence to that version and ticket 3.6 keeps a canary result for each. D3782 pins the literal 2 twice, in its record's anchor (`export const FALSIFIER_VERSION = 2;`, in `packages/daemon/test/falsify/defects.json`) and in its test's expected value (`packages/daemon/test/falsify/falsify-workspace.test.ts`), so the raise breaks both: list D3782 under Dev Handoff, Test Files This Change Broke, and edit neither, since create-tests owns them. Until create-tests moves the anchor, `node scripts/check-defects.mjs` fails on it, since every anchor must match its file exactly once.
- [x] (AC1, AC2) In `falsify/falsify-workspace.ts`, set the digest on every record whose mutation's file `#textOf` read, from the text `FalsificationRuns` already holds in `#texts`, with `wholeDigest` from `inputs/input-inventory.ts`, the function ticket 3.4 calls on the query side (C5, C8). Read no file a second time. Set it in one place for every record, so no path that builds a record (a run, a not-run reason, an interruption) can leave it out. Edit around the anchored text of the records these two files hold (Dev Notes § Tests this change may break counts and names them), and list any record whose anchor an edit breaks under Dev Handoff, Test Files This Change Broke. `falsify-workspace.ts` holds 461 of its 500 code lines and `experiment-record.ts` 406 (Dev Notes § Current structure of the modified files gives the command) (P16).
- [x] (AC1) Check every reader of `ExperimentRecord` and of the reply (C38): at 45f92eb6 the type is read only in `falsify/falsify-workspace.ts` and `falsify/run-facts.ts`, each by named member (`git grep -n --untracked "ExperimentRecord" -- packages/daemon/src packages/cli/src` printed those two files and the type's own at 02:00 on 2026-10-01), and the reply crosses the executor's channel whole (`{ type: "falsified", job }` in `daemon/executor-main.ts`, returned as `reply.job` by `Executor.falsify`), so nothing rebuilds a record. Search the `defects.json` files for a record whose `new` text builds an experiment record as a literal or replaces the place the digest is set: at 45f92eb6 none does (Dev Notes § Tests this change may break), so the search is for a record that lands after that commit. Stop and report any reader that copies a record member by member, since its file is not in this ticket's list.
- [x] (Support) Report to the orchestrator the sentence for `docs/architecture.md` § Falsification jobs (an experiment's record carries a digest of its mutation file's text as the job read it); write none of it yourself.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `wholeDigest(content)` (`packages/daemon/src/inputs/input-inventory.ts`): SHA-256 as hex over a string or bytes held in memory. Exported. Its module imports Node built-ins, `vitest/error-text.js` and `vitest/find-workspaces.js` at run time; `find-workspaces.ts` imports Node built-ins, `json-guards.js` and `error-text.js`, and `error-text.ts` imports nothing (read at 45f92eb6, 02:02 on 2026-10-01). `daemon/executor-main.ts` already imports both at run time, so the executor process loads nothing new, and the chain reaches neither the store nor the daemon's server.
- In ticket 3.3 as landed (`main` at 45f92eb6, read at 02:00 on 2026-10-01): `FalsificationRuns.#textOf(file)` and its `#texts` map, which hold each mutated file's text read once when the job starts, through `readText` (`readFileSync(file, "utf8")`), as a `FileText` that is the text or the read's error; `FalsificationRuns.all`, whose `ordered()` returns the job's records in the order given, and every return of `all` takes its records from it; `ExperimentRecord`, `FALSIFIER_VERSION` (`falsify/experiment-record.ts`).
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

- **The digest is of the text read when the job started.** `FalsificationRuns` reads each mutated file once, in `#textOf`, before any run, and plans every experiment from that text. A file edited later in the job is served from its new text at the next run (a known limit `docs/architecture.md` § Falsification jobs records); its record still carries the digest of the start text, so ticket 3.4's query reads the evidence stale for as long as the edit stands, the safe direction. A file edited during the job and restored to the same text before the query reads current though a run was served other text. For a file in the workspace's inputs, ticket 3.5 stores nothing, since it decides moved inputs from the change events during the job; for a declared non-input no event comes. That case is a known limit, decided by the orchestrator at 02:20 on 2026-10-01: "a declared non-input file a defect mutates, edited while a job runs and restored to the same text before the query, reads current though a run was served other text." It covers the restore inside the job and the restore after it. It needs a consumer's false declaration, and the standing hole of that declaration for any other file is a recorded limit until M3's file-level dependencies. The fix weighed and refused: comparing the text each run was served with the start digest and giving the experiment no verdict when they differ.
- **What ticket 3.3 built is ticket 3.3 as landed on `main` at 45f92eb6,** its review's fix included: a recorded test (`RecordedRunTest`) and its facts (`TestFacts`) carry an optional `repeats`, present only when above zero, and a judgement can read invalid experiment with the reason `test-repeated`. AC1's "nothing else of the reply differs" covers them, so a recorded test's `repeats`, each judgement and each judgement's facts read after this ticket as they do at that commit.
- **Every record whose file was read carries it.** A verdict can come from a run or from a reason decided with the text in hand (no probe site, no module, baseline did not pass), and ticket 3.4 refuses to store a verdict whose record has no digest. Only the unreadable file leaves none, and that reason reads no verdict. No record is built before its file is read: `FalsificationRuns.all` plans every experiment first, through `#planAll`, synchronously and whatever the abort signal says, and `#plan` reads the file before anything else; a job aborted before its workspace loads reads `interrupted-before-load` and holds no record at all.
- **One digest function on both sides.** The job digests the string `readFileSync(file, "utf8")` returns, and ticket 3.4's query the string `readFile(path, "utf8")` returns in `readMutationFile`; both keep a byte order mark. `wholeDigest` over the string gives equal digests for an unedited file; a second function on either side would have to be kept equal to it by hand (C8).
- **The member is optional on both members of the record,** so the type says a record may hold none, and absent means the file was not read (C12).
- **The member has no production reader until ticket 3.4 lands** (C59), accepted by the orchestrator at 00:09 on 2026-10-01. Its tests read it from the job's reply.

#### Ticket review

One review agent read the ticket and its bound rules at 00:12 on 2026-10-01 and returned 10 findings, all applied. Three were settled by reading ticket 3.3's build: the executor process already loads every module `wholeDigest`'s module reaches (finding 6); nothing rebuilds a record member by member (finding 1); and no record is built before its file is read (finding 8). One went to the orchestrator: a file edited during the job and restored before the query (finding 7), ruled a known limit (§ Questions to the orchestrator).

#### Questions to the orchestrator

Asked at 00:17 on 2026-10-01, with the handoff; decided by the orchestrator at 00:20.

- A declared non-input file a defect mutates, edited and restored byte for byte inside one job's run: a known limit. The ruling of 02:20 below widens its wording.

Asked by the dev at 02:19 on 2026-10-01 (Completion Notes § Change request candidates); decided by the orchestrator at 02:20, amending the wording of the 00:20 ruling.

- The limit as worded at 00:20 left out a file edited inside the job and restored after it. Ruling: the known limit is "a declared non-input file a defect mutates, edited while a job runs and restored to the same text before the query, reads current though a run was served other text." It covers the restore inside the job and the restore after it. The reason is unchanged: it needs a consumer's false declaration, and the standing hole of that declaration for any other file is a recorded limit until M3. The fix weighed and refused: comparing the text each run was served with the start digest and giving the experiment no verdict when they differ. The first design decision and ticket 3.4's Known limits carry this wording. No criterion changed.

Asked by the orchestrator at 01:57 on 2026-10-01, once ticket 3.3 had merged at 45f92eb6; amended by the author at 02:06.

- Ticket 3.3's review changed the record this ticket was written against: `repeats` on a recorded test and on its facts, the invalid reason `test-repeated`, and D3782, which pins `FALSIFIER_VERSION` at 2. The tasks, the counts and the notes on ticket 3.3 are restated for 45f92eb6. No criterion changed, and the sizing stands at 6 raw files and 8 estimated.

#### Pending siblings

- 3.3 (done, on `main` at 45f92eb6) wrote both files this ticket edits, and left `FALSIFIER_VERSION` at 2. This ticket is written against that commit.
- 3.2b (ready-for-dev, building in Tree 2) writes `falsify/reach-probe.ts` and `falsify/probe-slots.ts` and neither of this ticket's files. Both may append records to `packages/daemon/test/falsify/defects.json` and tests to `falsify-workspace.test.ts`; the second to land merges `main` in and proves the shared files' records.
- 3.4 (ready-for-dev) stores the digest with each verdict and compares it with the file's text when it answers `defects`. It edits neither of this ticket's files.
- 3.6 (backlog) keeps a canary result per Vitest and falsifier version; the raise reaches it only as a number.

#### Current structure of the modified files

On `main` at 45f92eb6, read at 02:00 on 2026-10-01. Code lines are by `grep -cv '^\s*$\|^\s*//\|^\s*/\?\*' <file>`, which leaves out blank and comment lines.

- `packages/daemon/src/falsify/experiment-record.ts` (406 code lines): `FALSIFIER_VERSION = 2`; `ExperimentRecord` is a `ran` member (`defectId`, `run`, `mutation`, an optional `confirming`) or a `not-run` member (`defectId`, `reason`); `RecordedRunTest` holds an optional `repeats`, which `recordTest` sets from `declaredRepeats`. The record crosses the executor's channel as JSON.
- `packages/daemon/src/falsify/falsify-workspace.ts` (461 code lines): `FalsificationRuns.all` calls `#planAll`, which calls `#plan` for every experiment before any run, and `#plan` starts with `startCheck(experiment, this.#textOf(experiment.mutation.file))`; `#textOf` reads through `readText` and keeps the result in `#texts`, keyed by the mutation's file; records are built by `notRun(experiment, reason)` and in `#experiment`, which spreads its `ran` record into a second literal when it adds `confirming`; they are kept in a map by experiment and collected by `ordered()` in `all`, which returns them in the order given. `judgedJob` adds the judgements once the session has closed the instance.

#### Tests this change may break

- D3782 changes. Its test, in `packages/daemon/test/falsify/falsify-workspace.test.ts`, expects `[2, 2]` and names version 2 in its title; its record, in `packages/daemon/test/falsify/defects.json`, anchors `export const FALSIFIER_VERSION = 2;` with the mutant `= 1`. That test holds the only line of test code that reads `falsifierVersion` (`git grep -n "falsifierVersion" -- packages/daemon/test packages/cli/test` printed that line alone at 45f92eb6, 02:06 on 2026-10-01).
- A test that compares a whole experiment record of a job's reply with a literal would change too. `git grep -c 'status: "not-run"'` over the same paths printed two hits. The one in `verdict.test.ts` is a hand-built record a test hands in, which the optional member leaves compiling. The one in `falsify-workspace.test.ts` is the `notRun(reason)` literal of `describe("experiments decided without running")`, which D3642, D3643, D3644, D3646 and D3647 each compare with a whole not-run record of the job's reply through `toEqual`; each of those records gains the digest, so those five tests change.
- Records anchored in the two files, at 45f92eb6 (02:00 on 2026-10-01), each count by `cat packages/daemon/test/defects.json packages/daemon/test/*/defects.json packages/cli/test/defects.json | grep -c '"file": "packages/daemon/src/falsify/<file>"'`: `falsify/experiment-record.ts` 16 (D3623, D3627, D3637 to D3641, D3643, D3651, D3743, D3744, D3779, D3780, D3782, D3809, D3810) and `falsify/falsify-workspace.ts` 13 (D3633, D3642, D3644 to D3647, D3653, D3741, D3742, D3778, D3783, D3784, D3811). Of the 29, only D3782 anchors a line this ticket must change. None anchors the `ExperimentRecord` type, `notRun`, `ordered` or `#textOf`, and no record's `new` text builds an experiment record. Two anchor a line beside where a record is built or collected: D3778 the `return record;` line of `#experiment`, and D3741 the `markAll` call in `all`. Edit around their anchored text, and list any record whose anchor an edit breaks under the Dev Handoff.

#### Previous-ticket intel

3.3 (done, on `main` at 45f92eb6), Completion Notes: "`falsify/experiment-record.ts`: `FALSIFIER_VERSION` is 2." "`falsify/run-relay.ts` (new): the `RunRelay` reporter moved out of `falsify-workspace.ts` unchanged, which the confirming run and the judging had brought to about 490 of its 500 code lines. It holds 461 now." Its Review Record, § For the tickets that follow: "3.3b: D3782 pins `FALSIFIER_VERSION` at the literal 2, in its test's expected value and in its record's anchor (`export const FALSIFIER_VERSION = 2;`), so the raise moves both. `experiment-record.ts` holds 406 code lines after this round." Its `experimentFacts` refuses a reply whose records do not pair one for one, in order, with its experiments, so every experiment given has a record to carry the digest.

#### Sizing

6 raw files and 8 estimated (6 times 1.3 is 7.8), recounted at 45f92eb6 with ticket 3.3's test files landed, which adds none: `verdict.test.ts`, `canaries.test.ts` and `job-readings.ts` read no `falsifierVersion`. Code units 3 (2 criteria plus validation). Production, modified: `falsify/experiment-record.ts`, `falsify/falsify-workspace.ts`. Tests, for create-tests: `packages/daemon/test/falsify/falsify-workspace.test.ts`, `packages/daemon/test/falsify/falsify-executor.test.ts` and `packages/daemon/test/falsify/defects.json`. This ticket's file. One chain through one subsystem, built by one session.

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

Dev session: threadId b7f47c7a-004b-4932-bdb3-3e86c004ae85

#### Test Files This Change Broke

Dev ran no test; each entry is read from the test's text against the change.

- `packages/daemon/test/falsify/defects.json`: D3782's anchor `export const FALSIFIER_VERSION = 2;` matches nothing now that the line reads `= 3`, so `node scripts/check-defects.mjs` exits 1 on it ("D3782: mutation anchor must match exactly once.", 02:12 on 2026-10-01). Of the 29 records anchored in the two edited files it is the only one whose anchor no longer matches exactly once (counted over all 19 tracked `defects.json` files at 02:12).
- `packages/daemon/test/falsify/falsify-workspace.test.ts`, D3782: its test expects `[2, 2]` and its title names version 2; the reply now reads 3.
- `packages/daemon/test/falsify/falsify-workspace.test.ts`, D3642, D3643, D3644, D3646 and D3647, in `describe("experiments decided without running")`: each compares a whole not-run record with `toEqual` against the local `notRun(reason)` literal of three members (`defectId`, `status`, `reason`). Each of those records now also carries `mutationFileDigest`, since its file was read, so each comparison is expected to fail on the extra member. The behavior changed on purpose (AC1); their records' anchors in `defects.json` still match. D3645, beside them, reads named members and is not affected.

#### ACs Owed a Test

- AC1: every experiment record of a job's reply whose file the job read carries `mutationFileDigest`, whatever its status and not-run reason (a run, `baseline-not-passed`, `baseline-not-run`, `no-module`, `anchor-count`, `no-probe-site`, `run-unrecorded`, `interrupted`); a record whose reason is `unreadable` carries none; and the reply's `falsifierVersion` reads 3.
- AC2: the member's value is `wholeDigest` of the file's text read whole as UTF-8, so two experiments on one file carry equal digests, a file with a byte order mark or CRLF line endings digests with them kept, a file that differs in one character digests differently, and the member holds no part of the text.

#### Tests Owed

None.

### Tests Record

Tests session: threadId f081927f-fb38-484a-aaf1-5bf32055d3dc

All tests are in `packages/daemon/test/falsify/falsify-workspace.test.ts`, with their records in `packages/daemon/test/falsify/defects.json`. Proof, by id through the run lease, over 6a7a3332 with those two files as edited: 60 of 60 detected on Windows (02:28 to 02:32 on 2026-10-01) and 60 of 60 on Linux under Node 24.19.0 (ended 02:34), baseline green before and after on each. The 60 are the 6 new records, the 29 anchored in `falsify/experiment-record.ts` and `falsify/falsify-workspace.ts`, and every other record whose test is in the edited test file.

Review gap G1: the test file's `BYTE_ORDER_MARK` is built with `String.fromCharCode(0xfeff)`, so the file holds no invisible character a tool could drop. Its value at run time is unchanged, and no record or expected value moved. Proof, by id through the run lease, over c1d2aca9 with the test file as edited, of the 54 records whose test is in that file: 54 of 54 detected on Windows (ended 02:59 on 2026-10-01) and 54 of 54 on Linux under Node 24.19.0 (02:59 to 03:01), baseline green before and after on each.

#### Named Defects

- D3870: The record of an experiment that ran carries no digest of its mutation file's text, so a detection has nothing to bind to and cannot be stored as evidence. (AC1)
- D3871: The record of an experiment decided without a run carries no digest though the job read its file, so a verdict such as invalid experiment for no probe site or no module has nothing to bind to and cannot be stored. Read over `baseline-not-passed` (failed and not reported), `no-module`, `anchor-count` and `no-probe-site`, each with its reason beside the digest. (AC1)
- D3872: The record of an experiment whose mutation file could not be read carries a digest, so it reads as bound to a text the job never read. (AC1)
- D3873: The digest is taken from the mutation file as it reads when the job's records are collected, so a file edited mid-job carries the digest of the edited text, and evidence planned from the old text reads current. Read on the label module, which the test rewrites while the baseline runs. (AC1, AC2)
- D3874: The digest is taken of the text with its byte order mark dropped, so a file that starts with one never digests as a query reads it and its evidence reads stale forever. (AC2)
- D3875: The digest is taken of the text with its carriage returns dropped, so a file with CRLF line endings never digests as a query reads it and its evidence reads stale forever. The test writes the CRLF text itself, so the host's line endings decide nothing. (AC2)
- D3782, repaired: The falsifier version is not raised, so evidence recorded before an experiment record held its mutation file's digest is kept as current. Its test expects 3 and its record mutates 3 to 2. The defect it named before, a version left at 1, is still rejected by this test, which expects 3. (AC1)
- D3642, D3643, D3644, D3646 and D3647, repaired with their records unchanged: each compares a whole not-run record, which now holds four members, the fourth the math module's digest. They pin that this ticket adds no other member to a not-run record. (AC1, AC2)

Each expected digest is what `wholeDigest` gives the text read whole as UTF-8, the call ticket 3.4's query makes: the fixture's module as committed, or the literal text the test wrote. D3870, D3871 and the five repaired tests read experiments that all mutate the math module and expect one digest, so a digest that varies with anything but the text fails them, and an exact 64-character value leaves no room for a part of the text.

#### Deliberately Untested

- `packages/daemon/src/falsify/falsify-workspace.ts`, the not-run reasons `interrupted`, `baseline-not-run` and `run-unrecorded`: each reads no verdict, so ticket 3.4 stores nothing for them and a missing digest there can neither report stale evidence as current nor refuse good evidence. The digest is set in the one place every return of `all` collects its records through, which D3870 and D3871 pin for both statuses. Asked of the orchestrator at 02:35 on 2026-10-01 whether to test them anyway; decided by the orchestrator at 02:37: leave them untested, and a gap row from the review naming a defect there that could store a wrong digest reopens it.
- `packages/daemon/src/daemon/executor-main.ts` and `executor.ts`: the reply crosses the executor's channel whole, as JSON, and no branch there reads a record's members, so no defect is nameable for the digest. `falsify-executor.test.ts` passes unedited.
- A digest of the file's bytes in place of its text read as UTF-8: the two are equal for every file that is valid UTF-8, a byte order mark included, so no mutation is observable short of an invalid encoding no realistic consumer's source holds.
- A declared non-input file a defect mutates, edited while a job runs and restored to the same text before the query: the known limit the orchestrator ruled at 02:20 on 2026-10-01.

### Review Record

Review session: threadId 757706d6-30ee-4701-89f6-efda7312059c

Reviewed cold at 02:37 to 02:46 on 2026-10-01, in Tree 1 on `wt/1` at c1d2aca9: `git diff main...wt/1` (seven files), and the authoring text of commits 0f6eb4b3 and e473c80b. One fresh-eyes agent read the two production files, the test file and the seven records; two doc-verify agents read ticket 3.4's amendment and this ticket's authoring text; the checklist pass ran the ticket's bound rules (C3, C5, C8, C12, C14, C38, C45, C48, C59, C118, C147, P13, P16, P17, P36, P37) over both production files.

**Verdict: no code finding.** Both criteria hold by reading and by the tests session's proof. What the dispatch asked to stress, each traced:

- The digest is of the start text. `readText` digests the string its one `readFileSync(file, "utf8")` returned, in the same statement, and `#withFileDigest` takes it from the `#texts` map, never from the file. `#planAll` fills that map synchronously, before any run and before any await of `all`. D3873 pins it against a file edited mid-job.
- Every record that can carry a verdict carries it. All five returns of `all` take their records from `ordered()`, which hands each to `#withFileDigest`. `judgeNotRun` and `judgeRan` (`falsify/verdict.ts`) give a verdict only to a record that ran, or whose reason is `no-probe-site`, `no-module` or `baseline-not-passed`, each decided with the text in hand. D3870 and D3871 pin both statuses.
- It equals what the query computes. The job reads with `readFileSync(file, "utf8")` and today's `readMutationFile` (`defects/resolve-definitions.ts`) with `readFile(path, "utf8")` after a `stat`. Measured at 02:44 on Node 24.19.0 on Windows with a scratch probe, 4 of 4 texts (plain, a byte order mark, CRLF, both): the SHA-256 of the two strings is equal, and equal to that of the text written and of the file's bytes. D3874 and D3875 prove the job's half on both platforms.
- The record holds the digest and no part of the text. `#withFileDigest` spreads one member, and the text stays in `FileText`, which never leaves the executor's job. The five repaired whole-record tests pin four members on a not-run record.

**The three no-verdict reasons left untested** (`interrupted`, `baseline-not-run`, `run-unrecorded`): agreed. `judgeNotRun` gives each no verdict, so ticket 3.4 stores nothing for them. The digest a record gets depends on its experiment's `mutation.file` alone, read from the map the tested reasons read, so a defect there can only leave the digest out and never store a wrong one. The fresh-eyes agent looked for a wrong-digest defect there and found none.

**Fixes applied by the review** (this ticket's authoring text only; no production file, test or defect record changed).

- Dev Notes § Tests this change may break read the `falsify-workspace.test.ts` hit of its `status: "not-run"` search as a record a test hands in. It is the expected literal D3642, D3643, D3644, D3646 and D3647 compare with a whole record of the reply, the case the sentence before it warned of. The dev's handoff named the five and the tests session repaired them; the sentence now says what the hit is.
- § Reusable Code said `ordered()` is called at every return of `all`. It is called at three sites and every return takes its records from it; reworded.

**Discarded, with the reason.**

- The optional chain in `fileText?.read === true` could hide a broken invariant: the dev's adversarial pass weighed it (Completion Notes, F2). A missing entry is unreachable, absence fails safe since ticket 3.4 refuses a verdict whose record has no digest, and a throw would add a branch no test reaches.
- `mutationFileDigest` required on the record that ran: this ticket's design decision makes it optional on both members, ticket 3.4 is written against that, and the record crosses the executor's channel as JSON, which no type checks, so its reader handles an absent member either way.
- D3870 does not read the record's status, and D3873 does not itself show the label module was edited: each input is pinned by a test of the same shared job that goes red when it drifts. D3621 reads `add` as a record that ran, and D3631 reads the `label` experiment's anchor as occurring zero times, which only the mid-job edit produces.

**Tech debt, recorded for Step 9** (none can report a stale result as current or credit a detection; each is in `packages/daemon/src/falsify/`).

- `falsify-workspace.ts` holds 474 of its 500 code lines after this ticket, and neither ticket 3.2b nor ticket 3.4 edits it, so nothing planned relieves it. The start-of-job planning (`FileText`, `readText`, `startCheck`, `#plan`, `#planAll`, `#textOf`, `#withFileDigest`) is the responsibility to extract when a ticket next needs room there.
- `FileText` keeps each mutated file's whole text in `#texts` until the job ends, though only `startCheck` reads it, during `#planAll`; after planning only the digest is read.
- `#texts` is keyed by `mutation.file` as given, so two spellings of one file are read twice, in one synchronous loop. Each record's digest is of the text its own start check read, so no wrong evidence follows.
- `digestOf` in `stale-transform-guard.ts` and `wholeDigest` in `inputs/input-inventory.ts` are the same SHA-256 over a string. The guard compares its digests only with each other, never with a record's.

**Doc text, final** (for the orchestrator to apply; it replaces `C:/source/rt-test/_agent-docs/.scratch/3-3b-doc-text.md`, checked against the code and written against the files as this tree holds them).

`docs/architecture.md` § Falsification jobs, in the paragraph that starts "An experiment's record also lists each transform of its mutated module", after the sentence that ends "or that an abort interrupted it." and before "A run that throws is recorded as failed", insert:

> An experiment's record also carries `mutationFileDigest`, a digest of its mutation file's text as the job read it when it started: `wholeDigest` of the file read whole as UTF-8, a byte order mark and its line endings kept. Every record carries it, whatever its status and its reason, except one whose file the job could not read. A file edited later in the job keeps the start text's digest on its record, and the record holds no part of the text.

Same section, the last entry of Known limits, replace "a source file edited while the job runs is served from its new text at the next run, and the record does not say that a file changed between its runs." with:

> a source file edited while the job runs is served from its new text at the next run, and the record does not say that a file changed between its runs: the digest it carries is of the text the job read when it started.

The limit the orchestrator ruled at 02:20 (a declared non-input file a defect mutates, edited while a job runs and restored to the same text before the query, reads current) is not architecture text at this ticket's landing: nothing stores or reads evidence until ticket 3.4, so no evidence reads current yet. Ticket 3.4's § Known limits carries it, and that ticket's build reports it with its own doc text.

`docs/testing.md` § Falsification jobs, mutation transforms and reach, first sentence: the id list reads "D3604 through D3653, D3709, D3735 through D3745, D3750 through D3811 and D3870 through D3875" (beside whatever lane t3-2b adds; the second lane to land adds its ranges to the list the first one left).

Same section, after the paragraph that ends "and D3742 passes a signal already aborted.", add this paragraph:

> D3870 through D3875 read the digest of its mutation file's text that each experiment record carries. `startDigest` gives the expected value: `wholeDigest` of the fixture's module as committed, read whole as UTF-8 as a query reads the file, which is the module's text when a job over a copy starts. D3870 and D3871 read experiments of the shared job that all mutate the math module, one that ran and five decided without a run, each of the five with its reason beside the digest. D3872 reads the `unreadable` experiment, whose record must hold no such member. D3873 reads the `label` experiment, whose module the test rewrites while the baseline runs, so its record must carry the digest of the text the job read. D3874 and D3875 each run a job of their own per Vitest line through `digestCarriedOver`, which writes `src/written.mjs` into a copy of the fixture with the test's exact text, a byte order mark or CRLF line endings, and names a test in no module, so the job decides the experiment from the text it read and runs nothing. The whole not-run records D3642, D3643, D3644, D3646 and D3647 compare hold four members, the fourth the math module's digest.

README: no change, since nothing a user sees changes until ticket 3.4 reads the member. `docs/plan.md` and `docs/roadmap.md`: no line this change made false.

**For the tickets that follow.**

- 3.4: the member is `mutationFileDigest`, an optional string on both members of `ExperimentRecord`, absent exactly when the record's reason is `unreadable`, which reads no verdict; so the refusal of a verdict without one guards a broken reply. Compute the query's side as `wholeDigest` of the string `readFile(path, "utf8")` returns, with nothing stripped or normalized: the probe above measured that equal to the job's for a byte order mark and for CRLF. `FALSIFIER_VERSION` is 3. A test that compares a whole record of a job's reply expects the member (four members on a not-run record). D3782 anchors `export const FALSIFIER_VERSION = 3;` with the mutant `= 2`, so the next raise moves its record and its test. Pair a verdict with its record by defect id: a record's digest follows its experiment's `mutation.file` as the job was given it. `falsify-workspace.ts` has 26 code lines of room and `experiment-record.ts` 92.
- 3.4, its own text: § Pending siblings still reads "3.3b (built at 6a7a3332 on `wt/1`, not yet tested or reviewed)"; it is tested at c1d2aca9 and reviewed here, and the entry should name the merge on `main` once this lane lands.
- 3.5: the digest covers an edit that still stands at the query and nothing else. A file in the workspace's inputs that is edited while the job runs and restored is 3.5's to refuse from its change events, as its scope says. The job reads each mutation's file inside `FalsificationRuns.all`, after the Vitest instance has loaded, so the window in which 3.5 must count a moved input runs from the fingerprint it hands the store to the job's end, the load included, and not only from the job's first run.

**Gap rows, worked** by the tests session (sent at 02:46, reply at 03:01 on 2026-10-01): G1, with one deviation the review accepts. `BYTE_ORDER_MARK` is `String.fromCharCode(0xfeff)` and not the escape sequence, since the edit tool decodes a typed escape into the raw character, which is how the raw mark got there. The review read the edit at 03:01: the test file holds no raw U+FEFF (a byte search for EF BB BF counts 0), the value at run time is unchanged, and no record or expected value moved.

**Validation of the final tree** (Tree 1, `wt/1` at c1d2aca9 plus this ticket file and `falsify-workspace.test.ts` uncommitted; Windows 11, Node 24.19.0).

- The review's own fixes are all in this ticket file, so the typecheck and the suite are inert for them under the outside-the-graph exemption. Its own tools, at 03:01: `bun x prettier --check` over the ticket and the test file exit 0; `node scripts/check-sprint-keys.mjs` exit 0 (3 sprints, 47 tickets); `node scripts/check-requirement-markers.mjs` exit 0 (31 requirements); `node scripts/check-line-citations.mjs` clean; `node scripts/check-defects.mjs` exit 0 (3132 named defects, each anchor matches once).
- `bun x oxlint` over `experiment-record.ts`, `falsify-workspace.ts` and `falsify-workspace.test.ts` exit 0 (02:39), and over the test file as edited exit 0 (03:01). Code lines: 408 and 474 of 500.
- The tests session's round for G1, read from its reply and its logs: `bun x vitest run packages/daemon/test/falsify/falsify-workspace.test.ts` exit 0, 1 file, 54 of 54 tests (02:47); by-id proof through the run lease of the 54 records whose test is in that file, 54 of 54 detected on Windows (ended 02:59) and 54 of 54 on Linux under Node 24.19.0 (02:59 to 03:01), baseline green before and after on each.
- The review ran no suite of its own: no production file changed after the tests session's first proof, and the one test edit was run and proven by its owner.

#### Test Coverage Gaps

Denominator: 6 named-defect tests the lane added (D3870 to D3875), 1 repaired with its record (D3782) and 5 repaired with their records unchanged, against the behaviors AC1 and AC2 name. Every behavior of both criteria has a test that goes red, the three no-verdict reasons recorded under Deliberately Untested apart. The one row is a test whose input can stop exercising its defect without a sign. Severity LOW; surface `internal`; reach unknown.

| #   | Source                                                                                   | Named defect                                                                                                                                                                                                                                                                                                                                               | Expected test                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | `packages/daemon/test/falsify/falsify-workspace.test.ts`, the constant `BYTE_ORDER_MARK` | The constant holds a raw, invisible U+FEFF between its quotes. An editor or a tool that drops it leaves an empty string with no visible change, D3874 then writes a file with no mark, and the test passes with and without its record's mutation, which strips only a mark that is present; nothing else in the file reads the mark, so nothing goes red. | No new test and no new id. Write the constant as the escape sequence for U+FEFF, so the mark is visible in the source and survives any tool. The value at run time is unchanged, so D3874's record and expected digest stand; prove what `_agent-docs/crew.md` § Gates asks of the edit. |

### Completion Notes

Dev, 02:18 on 2026-10-01, in Tree 1 on `wt/1` over e473c80b.

- `falsify/experiment-record.ts`: `FALSIFIER_VERSION` is 3, and both members of `ExperimentRecord` hold an optional `mutationFileDigest`, a string. The ticket left the member's name open; ticket 3.4 reads it by this name. 408 code lines.
- `falsify/falsify-workspace.ts`: `readText` digests the text it read with `wholeDigest`, once for each file, and keeps the digest beside the text in `FileText`. `FalsificationRuns.all`'s `ordered()`, which every return of `all` collects its records through, hands each record to `#withFileDigest`, which adds the digest when the file was read and nothing when it was not. It reads the `#texts` map and never the file, so no path reads a file a second time. 474 code lines.
- Readers (C38): in production the record is read in `falsify/falsify-workspace.ts` and `falsify/run-facts.ts`, each by named member, and the reply crosses the executor's channel whole (`daemon/executor-main.ts`, `daemon/executor.ts`). No `defects.json` record's `new` text builds an experiment record or replaces `ordered`, `notRun`, `readText` or `#textOf`.
- Assumptions: the table held none; the resolution beneath it records what was read.
- Ticket sanity check: no findings.
- Gates, each against the tree as it stands at 02:17: `bun run --filter @rt-test/daemon typecheck` exit 0 (02:12, before a comment-only edit); `bun run --filter rt-test typecheck` exit 0 (02:12), the one workspace that depends on the daemon; `bun x oxlint` over both files exit 0 (02:17); `bun x prettier --check` over both files exit 0 (02:17); `node scripts/check-line-citations.mjs` clean (02:17). `node scripts/check-defects.mjs` exits 1 on D3782 alone, as the ticket expects. The repo-wide gate is the orchestrator's.
- Acceptance evidence, by reading: every one of the five returns of `all` takes its records from `ordered()`; `#planAll` reads each experiment's file through `#textOf` before `ordered()` can run, so `#texts` holds an entry for every experiment given; an unreadable file is `read: false` and adds no member; `falsifySession` sets `falsifierVersion` from `FALSIFIER_VERSION`; and the spread in `#withFileDigest` adds one member and changes no other. Both criteria state what a job's reply holds on each Vitest line and platform, which only a test observes, so both stay unticked under ACs Owed a Test.
- Adversarial review (one agent, 02:13 to 02:16): 4 findings. Fixed: the member's comment now names `wholeDigest` and the kept byte order mark (F3). Discarded F2 (a missing `#texts` entry read as an unread file): unreachable by construction, absence fails safe since ticket 3.4 refuses a verdict whose record has no digest, and a throw would add a branch no test reaches. Discarded F4 (`#texts` keyed by the path as given): it predates this change, each mutation's file arrives as one absolute path, and both reads would fall in the synchronous `#planAll`. F1 is the candidate below. Re-validation after the fix was lint alone, under the comment-only exemption.
- README: no line changes, since nothing a user sees changes until ticket 3.4 reads the member.
- `docs/architecture.md` § Falsification jobs: the sentence was sent to the orchestrator, which owns the file.
- Left on disk until the lane is settled: `_agent-docs/.scratch/3-3b/anchors.mjs` (the anchor count above) and the gate logs `_agent-docs/.scratch/3-3b-*.log`, all ignored by git.

#### Change request candidates

- A fork, not a defect in this ticket's code, sent to the orchestrator at 02:19 on 2026-10-01. The ruling of 00:20 names the known limit as a declared non-input file "edited and restored byte for byte inside one job's run". The first design decision above states the case wider: "restored to the same text before the query". The gap is a file edited inside the job and restored after it: its run was served the edited text, its record carries the start text's digest, and once the file is restored the evidence reads current. It needs the same false declaration as the ruled case, since ticket 3.5 stores nothing for a file in the workspace's inputs that moved during the job. Recommendation: keep it as the same known limit and word ticket 3.4's Known limits as "restored before the query". Closing it instead means comparing the text a run was served with the start digest and storing nothing when they differ, which changes shipped behavior and edits `falsify/stale-transform-guard.ts` or `falsify/mutation-transform.ts`, outside this ticket's files.
  - Decided by the orchestrator at 02:20 on 2026-10-01: a known limit, worded as wide as the case, with no source change. "A declared non-input file a defect mutates, edited while a job runs and restored to the same text before the query, reads current though a run was served other text." It needs a consumer's false declaration, and under that declaration an edit to any other declared file the test reads already stales nothing until M3's file-level dependencies. Comparing the text each run was served with the start digest is refused for this ticket and recorded as the way to close it if M3 does not. The ticket's author writes the wording into the design decision and into ticket 3.4's Known limits.

### File List

- `packages/daemon/src/falsify/experiment-record.ts` (modified by dev)
- `packages/daemon/src/falsify/falsify-workspace.ts` (modified by dev)

- `_agent-docs/tickets/3-3b-mutation-file-digest.md` (created by create-ticket, 00:10 on 2026-10-01, cut from ticket 3.4; amended by its author at 02:06 for ticket 3.3 as landed)

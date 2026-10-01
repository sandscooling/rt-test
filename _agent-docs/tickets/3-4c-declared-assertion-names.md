# Ticket 3.4c: Declared assertion names and the worktree's standings

## Ticket

As a consumer whose tests fail by errors Vitest does not mark as assertions (a Testing Library query error, a helper that throws),
I want to declare those error names in `rt-test.json` and have every verdict judged under one list read stale when the list changes,
so that no verdict rests on a list of names I have since changed, and naming an error has the experiments that read unclear judged again.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: The `assertionErrors` member of `rt-test.json` declares the error names that count as assertions beside the two forms Vitest marks itself: an array of at most 256 strings, each a non-empty name other than `Error`. With no `rt-test.json`, or no such member, no name is declared. The names are read from the same read of `rt-test.json` that gives the `defects` member's patterns, every time the definition files are read, and nothing of them is kept between two reads. (FR11)
- [ ] AC2: A member that is not such an array declares no names and is one invalid entry of the `defects` answer, of the kind an unusable `defects` member has (`settings-unusable`), at the path `rt-test.json`, with a reason that says `rt-test.json` declares no assertion error names and names the problem: that the member is not an array of strings, how many names it holds past the 256 allowed, or the name that is empty or is `Error`. It counts in the total and lies in every scope, as every invalid entry does. A problem in each member is two entries, the `defects` member's first. The two members are checked apart: a problem in `assertionErrors` leaves every definition file read and every definition answered, a problem in `defects` leaves the declared names read, and a `rt-test.json` that cannot be read at all is one entry, never two. (FR22)
- [ ] AC3: The definition digest of every valid, resolved definition also covers the declared names, as a set: the same names in another order, or with one repeated, give the same digest, and a list that gains or loses a name gives another for every definition of the worktree. So stored evidence whose digest was computed under another set of names reads stale, naming the cause `definition-changed`, and is not counted verified; evidence stored under the set in effect reads as it did. A member that cannot be used is the empty set. (FR15)
- [ ] AC4: One function gives a caller the worktree's definition file problems, its declared names, every definition resolved, and every definition's standing, from one read of `rt-test.json`, the definition files and each mutation's file, taking the daemon's moment only once its last awaited read has ended and returning from it without awaiting again. It hands the consumer root it was given to the definition checks and to the standings alike, so a caller of it cannot spell it two ways. `rt-test defects` answers from it, and for every scope its answer holds what it held before this ticket, but for AC2's entry and AC3's digest: the same counts, listing, order, gaps, errors and bounds. (FR22)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It reads a JSON file, digests text and moves calls between this repository's own modules.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (AC1, AC2) In `packages/daemon/src/defects/definition-files.ts`, read the `assertionErrors` member from the settings value `declaredPatterns` already parses, so `rt-test.json` is read once for both members. Check it with `listProblem` and a `ListMember` rule of its own (member `assertionErrors`, a named maximum of 256, the nouns "names" and "name", and a problem function that refuses the empty name and the name `Error`). `readDefinitionFiles` returns the names beside `definitions` and `invalidEntries`, and for a member with a problem returns no names and one `settings-unusable` entry whose reason begins by saying `rt-test.json` declares no assertion error names. Give each member its own problem. Today a problem in the `defects` member returns before anything else is read: read and check `assertionErrors` before that return, so a problem in `defects` still returns the names, or the names' own entry after the `defects` entry. A problem in `assertionErrors` returns its entry beside every definition and every other entry. An absent `rt-test.json` returns no entry and no names, and one that cannot be read at all (a link, not a regular file, unreadable, not JSON, not an object) returns the one entry it returns today and no names. The early return for an empty pattern list must still return the names. The file has 54 lines of room under lint's cap; if the change does not fit, ask the orchestrator before adding a file the sizing does not count.
- [ ] (AC3) In `packages/daemon/src/defects/defect-standings.ts`, add the declared names to `StandingFacts` and to what `definitionDigest` digests, as one more element after the mutation's `new`: the array of the distinct names, sorted (code unit order, no locale), present and empty when no name is declared. Nothing else about a standing changes.
- [ ] (AC4) Create `packages/daemon/src/defects/worktree-standings.ts` with the one function: it takes the consumer root, the state directory, the abort signal and the moment as a call; awaits `readDefinitionFiles`, runs `checkDefinitions`, awaits `readAnchors`, checks the signal, then takes the moment, builds the query basis, resolves the definitions and computes `defectStandings` over every one of them, with no await after the moment. It returns the basis (or its no-answer), the invalid entries, the declared names, the resolved definitions and the standings. Make `defectsAnswer` in `packages/daemon/src/query/defects-answer.ts` call it and keep only what is the answer's own: the scope, resolved before the call as today, so a refused path still answers before any file is read; the no-answer for an empty scope; the gaps; the counts over the standings in scope; the listing; and the invalid entries as the answer orders, cuts and counts them today. Export the listing's order (`listedDefinitions` sorts by state, then evidence that is not current before current, then file and position) as one comparison of two standings from `defects/defect-standings.ts`, and have the answer sort by it, so ticket 3.5 orders by the same comparison. Filter the standings by scope after they are computed, since a definition's standing depends on no other definition.
- [ ] (AC1, AC3, AC4) Check each consumer of the changed shapes in the same change: every caller of `readDefinitionFiles`, `defectStandings` and `definitionDigest`, every literal of `DefinitionFiles` and `StandingFacts`, and each defect record whose `new` text builds one or calls one (search every catalog, `packages/daemon/test/defects.json`, `packages/daemon/test/*/defects.json` and `packages/cli/test/defects.json`, for `readDefinitionFiles(`, `defectStandings(`, `definitionDigest(`, and for the members a literal carries without naming its type, `invalidEntries` and `discoveryCurrent`; authoring's search of one catalog for three of those names found two records), and list what you find under the Dev Handoff for the tests session.
- [ ] (Support) Report to the orchestrator, with the handoff, the text for the files this lane does not edit: `README.md` (the `assertionErrors` member beside `nonInputs` and `defects`: what it declares, its bound, that `Error` is refused, what a member that cannot be used reads as in `rt-test defects`, and that changing the list reads every verdict stale; the sentence "other members are ignored" stays true of every other member) and `docs/architecture.md` § Defects query (the member, the invalid entry, and the definition digest's sentence, which lists what the digest covers), with each sentence of § Results store and § Falsification jobs that says what the definition digest covers or what evidence is bound to, and ADR-0008's sentence on the declared names (the bound of 256, and that `Error` is refused).
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `listProblem`, `ListMember` and `NON_INPUTS_FILE` from `packages/daemon/src/inputs/non-inputs.ts`: the check every list member of `rt-test.json` gets (an array of strings, a maximum, a problem for each item), and the words its refusal uses. `DEFECTS_RULE` in `definition-files.ts` is the shape to follow.
- `declaredPatterns`, `readJsonFile`, `settingsEntry` and `INVALID_ENTRY.settingsUnusable` in `packages/daemon/src/defects/definition-files.ts`: the one read of `rt-test.json` and the entry an unusable member gets. `settingsEntry` words its reason for the `defects` member ("names no definition files"); give the names' entry its own words from the same kind and path.
- `wholeDigest` from `packages/daemon/src/inputs/input-inventory.ts`, as `definitionDigest` already calls it.
- `readDefinitionFiles`, `checkDefinitions` (`defects/definitions.ts`), `readAnchors` and `resolveDefinitions` (`defects/resolve-definitions.ts`), `queryBasis` (`query/summary.ts`) and `defectStandings` (`defects/defect-standings.ts`): the calls `defectsAnswer` makes today. The AC4 task states the order the new function keeps them in.
- `WaitMoment` from `packages/daemon/src/daemon/waits.ts`: the moment's type, as `DefectsQuery` names it.

### Must Create

- `packages/daemon/src/defects/worktree-standings.ts`: the one function of AC4 and the type of what it returns.
- The `ListMember` rule and the name problem function for `assertionErrors`, in `definition-files.ts` beside `DEFECTS_RULE`.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### What the criteria rest on

FR15: "Mark defect evidence stale when its test, mutation, inputs, or execution configuration change, keep it across a daemon restart, and re-verify it at lower priority than ordinary tests." The declared names are execution configuration: they decide whether a failing test's error is an assertion, and so whether an experiment reads detected or unclear. AC3 stands on those words (orchestrator, 06:45 on 2026-10-01).

FR11: "Decide each falsification verdict from run facts (failure phase, error kind, whether the intended test reached the step that holds the mutation, the baseline result), counting as a detection only an assertion failure in the intended test after it reached that step, repeated in a confirming run."

FR22: "Answer a `defects` query through the CLI with versioned `--json` output, giving each defect definition's evidence state, its freshness and reason, the verified, eligible and total counts, and the gaps, without starting a test."

ADR-0008, the error kinds: "the kind of each of its errors, which is an assertion when Vitest serializes it as an `AssertionError` or as a matcher failure it marks with the `JestExtendError` constructor and an assertion name (the form `expect.extend` matchers such as jest-dom's take), or when its name is one the consumer declares in the `assertionErrors` member of `rt-test.json`, and otherwise another kind". Its known limits: "A Testing Library query error reads as unclear unless the consumer declares its name." And: "a custom matcher's failure serializes with the name `Error`, the `JestExtendError` constructor and its assertion name", which is why a declared `Error` would count every thrown plain error, a setup failure included, as an assertion.

ADR-0007, as this ticket leaves it: "An experiment's evidence is bound to the definition's digest (its id, test identity and mutation, with the assertion error names the consumer declares), a digest of the mutation file's text as the job read it, the workspace's input fingerprint the experiment ran at (the one its ordinary results use), the Vitest version, the falsifier version and the Vitest adapter version; a change to any of them makes it stale."

`docs/architecture.md` § Defects query, on an unusable `defects` member: "Each of these problems is one invalid entry, which counts in the total and lies in every scope: an `rt-test.json` that is a link or not a regular file, cannot be read or parsed, is not a JSON object, or whose `defects` member is not an array of at most 256 usable patterns". And on the moment: "It reads the definition files and each mutation's file as they are when it answers, caches nothing across queries, and takes the store's latest results, its view and its inputs only once those reads have ended".

Glossary, verbatim, as this ticket leaves it: **Definition digest**: "A digest of a defect definition's id, test identity and mutation and of the assertion error names `rt-test.json` declares, to which its evidence is bound." **Evidence freshness**: "Whether a defect's evidence still describes its definition, its mutation's file, its workspace's inputs and the versions it was produced under." **Unclear experiment**: "An experiment whose test failed in its own body with no error or one that is not an assertion, failed beside an unhandled error, or failed at an assertion that its confirming run, the run the job started next or the job's own end did not bear out."

#### Why this ticket exists

Nothing binds evidence to the names it was judged under. `definitionDigest` in `defects/defect-standings.ts` covers the id, the resolved test's identity, the mutation's root-relative file, `old` and `new`; `StoredEvidence` (`store/defect-evidence.ts`) holds six bindings and none is the names; and `rt-test.json` is never an input, so a change to it moves no workspace's fingerprint. Without AC3 a name taken off the list leaves each detection that rested on it reading detected and current, and a name added, which is the remedy an unclear verdict's listed error names point an author at, has nothing judged again until an unrelated edit.

Fleet Cooling meets this on its main path, which is the owner's test for whether a case is addressed (04:43 on 2026-10-01: "the deciding factor on whether we should address it is look at Fleet Cooling's codebase. Would this edge case come up in it? If not leave it."). Its `scripts/falsify.mjs` holds a classifier arm for each such shape: Testing Library's `TestingLibraryElementError`, and its own `assertThrowsConvexError` helper, which that script calls "MANDATORY for every business-logic error assertion in the backend suite" (read at its 9f139b8d). Under RT Test each of those reads unclear until its error's name is declared.

#### Design decisions (scope of analysis: reading the names, binding evidence to them, and one read of the standings; scheduling, what a job is handed and the canary set's own names are unanalyzed here)

Each decision has doing nothing and one coarser rule beside the option chosen.

- **The digest covers the names** (orchestrator, 06:45 on 2026-10-01). Do nothing: a removed name leaves stale detections reading current, against FR15. Exact: a seventh binding and a cause of its own in the store, which raises the schema to 12, edits every entry of `STORE_MIGRATIONS` and re-anchors 17 records, for a list that changes a few times in a project's life. The coarser rule needs no store change: one digest answers "was this judged as it would be judged now" for the definition and the names together.
- **A set, sorted.** Reordering the list or repeating a name changes no judgement, so it changes no digest. Do nothing (digest the list as written) would stale a worktree's evidence on a reordering.
- **An unusable member declares no names and is reported.** Do nothing (ignore it silently) leaves an author's typo unreported while every verdict that needed a name reads unclear. Refusing every job while the member is unusable is a second way to say the same thing, and it would stop the definitions that need no name. One rule serves: the member reads as the empty set, the entry says why, and the entry counts in the total, so nothing reads verified while it stands.
- **Only `Error` is refused.** A name such as `TypeError` would credit a setup failure too, but which errors a consumer's tests raise as assertions is the author's to say, as the mutation is. A list of refused names would grow with every library.
- **The answer does not carry the names.** They are the author's own file, and a member that cannot be used is reported. Carrying them costs a protocol raise, an answer member and a CLI line for something `rt-test.json` already shows.
- **One function, standings over every definition.** `defectsAnswer` computes standings for the definitions in scope today. The function computes them for all and the answer filters, since a standing depends on no other definition (`standingOf` in `defects/defect-standings.ts` reads one definition and the index). Ticket 3.5's schedule needs the whole worktree's. Do nothing leaves 3.5 to repeat those calls in order, and 3.4's review found the failure that invites: "hand `defectStandings` the consumer root exactly as `checkDefinitions` was given it, or every digest it stores differs from the one the query computes and all evidence reads stale". Taking the root once makes that state unreachable for a caller of the function. `checkDefinitions` and `defectStandings` stay exported for the function to call, so a caller that goes around it can still reach that state, and only ticket 3.5 calling the function prevents it. The basis the standings are computed from does not depend on the query's path: `queryBasis(results, daemon, inputs)` in `query/summary.ts` takes none, and the store's read is for one project and worktree. A query for one folder already reads every definition file and every mutation's file today, so computing every definition's standing, which reads no file, adds no read.
- **Nothing is kept between reads.** Every query and every look of ticket 3.5's schedule reads `rt-test.json` and the definition files afresh, as the query does today.

#### Known limits (each entry says what it reads)

- A change to the list reads every stored verdict of the worktree stale and has each definition verified again, whether or not its verdict turned on a name. At Fleet Cooling's size that is hours of falsification for each workspace (ticket 3.5's known limits give the figures); the list changes when an author meets a new error shape.
- A member that cannot be used is a change to the list like any other: a typo in it reads every verdict stale under the empty set, ticket 3.5's schedule verifies each definition again under no names, and mending the typo reads them stale once more. The invalid entry says the member cannot be used while it stands.
- The cause reads `definition-changed` when it was the names that changed. The answer names no cause of its own for them.
- A name is matched exactly as Vitest serialized the error's name, so a subclass is declared by its own name (ADR-0008). A declared name that matches no error, as a misspelled one or one written with a space around it, is not reported: its verdicts stay unclear, and each lists the error names it met, which the author compares with the list.
- No job is scheduled until ticket 3.5 lands, so until then the names decide no verdict: this ticket reads them, reports a member that cannot be used, and binds the digest.
- Evidence stored before this ticket's digest would read stale. None exists outside tests, since `writeEvidence` has no production caller until ticket 3.5.

#### Questions to the orchestrator

Asked at 06:43 on 2026-10-01; decided by the orchestrator at 06:45.

- Sizing: ticket 3.5 as scoped measured about 29 raw files, 38 estimated, past the 30-file limit. Ruling: split. This ticket, 3.4c, holds the defects side and builds after 3.4 and before 3.5.
- The declared names and evidence: the coarser rule, accepted: "the definition digest also covers the declared assertion error names, sorted, so a change to the list reads every record stale as definition-changed." With the ground it stands on: "This binding stands on FR15's own words", since the declared names are execution configuration and Fleet Cooling meets the case on its main path.

#### Ticket review

One review agent read the ticket and its bound rules at 06:52 on 2026-10-01 and returned 12 edits and 5 questions. Eleven edits are applied; the twelfth, an empty Execution Metadata block, was filled while the review ran. The questions were settled by fact and none went to the orchestrator: the query basis takes no path (`queryBasis` in `query/summary.ts`), so standings over every definition read the same facts a scoped answer does; ticket 3.5 schedules under the empty set while the member cannot be used, which § Known limits now prices; the import direction with ticket 3.4b is under § Pending siblings; a problem in each member is two entries, the `defects` member's first (AC2); and the room in `definition-files.ts` is in the first task. The grill before it asked nothing: every seeded choice was ruled by the orchestrator at 06:45, fixed by the sprint entry, or changes no shipped behavior, and it added the known limit on a name that matches no error.

#### Pending siblings

- 3.5 (backlog) calls this ticket's function for the worktree's standings, hands its job the names the same call returned, and stores each verdict under the digest of the standing its experiment was built from, so the names a job judged under are the names its evidence is bound to. It edits none of this ticket's files.
- 3.4b (backlog) puts the defect counts in the summary from the same standings, after 3.5; it takes them from this ticket's function. That function imports `queryBasis` from `query/summary.ts`, as `query/defects-answer.ts` does today, so a summary that imports the function back would close a cycle: 3.4b's sprint entry already has it extract `queryBasis` and `cutReason` from `query/summary.ts` before adding to that file, which removes it.
- 3.6 (backlog) reads `packages/daemon/canaries/canaries.json`, which holds an `assertionErrors` list of its own for the canary set's job. That list is not `rt-test.json`'s and this ticket reads neither that file nor that member.
- An inline change in Tree 1 keeps each scope's evidence in the store between reads (dispatched by the orchestrator at 06:45 on 2026-10-01). It edits the store alone and shares no file with this ticket.

#### Current structure of the modified files

Code lines are by `grep -cv '^\s*$\|^\s*//\|^\s*/\?\*' <file>` at fe1fb800 (06:50 on 2026-10-01). Lint caps a production file at 500.

- `packages/daemon/src/defects/definition-files.ts` (446): `readDefinitionFiles(consumerRoot, stateDirectory, signal)` returns `DefinitionFiles` (`definitions`, `invalidEntries`). `declaredPatterns` reads `rt-test.json` through `readJsonFile` and returns the patterns or one `settings-unusable` entry; `readDefinitionFiles` returns early on that entry and on an empty pattern list. `DEFECTS_RULE` is the `ListMember` for the `defects` member. It has 54 lines of room.
- `packages/daemon/src/defects/defect-standings.ts` (358): `defectStandings(definitions, facts)`; `StandingFacts` (`consumerRoot`, `evidence`, `discovery`, `discoveryCurrent`, `currentFingerprint`, `testStandings`); `definitionDigest(subject, consumerRoot)` digests `JSON.stringify([id, testIdentityKey, relative file, old, new])`.
- `packages/daemon/src/query/defects-answer.ts` (330): `defectsAnswer(query)` resolves the scope first, makes those calls and then scopes, counts and lists; `listedDefinitions` holds the listing's order as an inline comparison; `DefectsQuery` holds `path`, `consumerRoot`, `stateDirectory`, `signal` and `moment`.

#### Tests this change may break

- Records anchored in the files this ticket edits, each count by `cat packages/daemon/test/defects.json packages/daemon/test/*/defects.json packages/cli/test/defects.json | grep -c '"file": "packages/daemon/src/<path>"'` at fe1fb800 (06:50): `defects/definition-files.ts` 22, `defects/defect-standings.ts` 21, `query/defects-answer.ts` 23. A record anchored in code that moves to the new module is re-anchored there, and every record whose mutated file this ticket edits is proven again by id (`_agent-docs/crew.md` § Gates).
- A hand-built `StandingFacts` needs the names, and a hand-built `DefinitionFiles` its names member: `packages/daemon/test/defects/definitions.test.ts`, `packages/daemon/test/query.test.ts` and `packages/daemon/test/experiment-facts.ts` name `defectStandings(`, `StandingFacts` or `definitionDigest` (`rg -c` over the test tree at 06:41). That search did not cover `readDefinitionFiles` or `DefinitionFiles`: a test that compares what `readDefinitionFiles` returns with a whole literal fails at run time on the new member, where no typecheck reads it. The typecheck finds each hand-built value.
- Two records in `packages/daemon/test/defects/defects.json` name one of those three in their text, which no typecheck reads.
- A test that pins a digest as a literal, rather than comparing two standings, changes with AC3.

#### Sizing

10 raw files and 13 estimated (10 times 1.3); code units 5 (four criteria and validation). Production, modified: `defects/definition-files.ts`, `defects/defect-standings.ts`, `query/defects-answer.ts`. Production, created: `defects/worktree-standings.ts`. Tests, for create-tests: `test/defects/definitions.test.ts`, `test/query.test.ts`, `test/experiment-facts.ts`, and the `defects.json` beside the first two (`packages/daemon/test/defects/`, `packages/daemon/test/`). This ticket's file. Over 10 estimated, so dev delegates to implementer agents: one group for the names and the digest (AC1 to AC3), then the function and the answer (AC4), which reads what the first returns. Docs are text reported to the orchestrator, but for the glossary's Definition digest and ADR-0007's binding sentence, which authoring wrote under the orchestrator's grant of 06:45.

### References

- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.4c, and the split's paragraph under it.
- `_agent-docs/tickets/3-4-defect-evidence.md`: § The interface ticket 3.5 calls, and its Review Record § For the tickets that follow.
- `docs/adr/0007-reused-instance-per-falsification-job.md`, `docs/adr/0008-detection-from-task-facts-and-canaries.md`, `docs/adr/0009-defect-definition-files.md`.
- `docs/architecture.md` § Defects query, § Results store, § Falsification jobs.
- Fleet Cooling's checkout at 9f139b8d, read only: `scripts/falsify.mjs`, for the error shapes its tests die by.
- `node scripts/list-open-issues.mjs` printed "0 open issues, complete" at 06:44 on 2026-10-01, so no issue bears on this ticket.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C5,C7,C8,C10,C12,C13,C14,C30,C38,C39,C40,C45,C46,C48,C49,C52,C55,C59,C113,C114,C118,C119,C139,C147,C170,C173 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P14,P16,P17,P18,P19,P21,P31,P39,P40 -->

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
sizing_ac_count: 5
files_to_modify:
  - packages/daemon/src/defects/definition-files.ts
  - packages/daemon/src/defects/defect-standings.ts
  - packages/daemon/src/query/defects-answer.ts
files_to_create:
  - packages/daemon/src/defects/worktree-standings.ts
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

- `_agent-docs/tickets/3-4c-declared-assertion-names.md` (created by create-ticket, 06:58 on 2026-10-01, cut from ticket 3.5)
- `_agent-docs/sprints/sprint-3-falsification.md` (create-ticket: § Ticket 3.4c with the split's paragraph, the order paragraph, and two sentences of § Ticket 3.5)
- `_agent-docs/sprint-status.yaml` (create-ticket: the `3-4c-declared-assertion-names` key)
- `docs/glossary.md` (create-ticket: Definition digest)
- `docs/adr/0007-reused-instance-per-falsification-job.md` (create-ticket: the binding sentence)
- `docs/requirements.md` (create-ticket: ticket 3.4c on the markers of FR11, FR15 and FR22)

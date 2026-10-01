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

- [x] AC1: The `assertionErrors` member of `rt-test.json` declares the error names that count as assertions beside the two forms Vitest marks itself: an array of at most 256 strings, each a non-empty name other than `Error`. With no `rt-test.json`, or no such member, no name is declared. The names are read from the same read of `rt-test.json` that gives the `defects` member's patterns, every time the definition files are read, and nothing of them is kept between two reads. (FR11)
- [x] AC2: A member that is not such an array declares no names and is one invalid entry of the `defects` answer, of the kind an unusable `defects` member has (`settings-unusable`), at the path `rt-test.json`, with a reason that says `rt-test.json` declares no assertion error names and names the problem: that the member is not an array of strings, how many names it holds past the 256 allowed, or the name that is empty or is `Error`, for which it says that an error must carry a name of its own to be declared. It counts in the total and lies in every scope, as every invalid entry does. A problem in each member is two entries. The entries for `rt-test.json` come before every entry the walk finds, the `defects` member's before the names'. The two members are checked apart: a problem in `assertionErrors` leaves every definition file read and every definition answered, a problem in `defects` leaves the declared names read, and a `rt-test.json` that cannot be read at all is one entry, never two. (FR22)
- [x] AC3: The definition digest of every valid, resolved definition also covers the declared names, as a set: the same names in another order, or with one repeated, give the same digest, and a list that gains or loses a name gives another for every definition of the worktree. So stored evidence whose digest was computed under another set of names reads stale, naming the cause `definition-changed`, and is not counted verified; evidence stored under the set in effect reads as it did. A member that cannot be used is the empty set. (FR15)
- [x] AC4: One function gives a caller the worktree's definition file problems, its declared names, every definition resolved, and every definition's standing, from one read of `rt-test.json`, the definition files and each mutation's file, taking the daemon's moment only once its last awaited read has ended and returning from it without awaiting again. It hands the consumer root it was given to the definition checks and to the standings alike, so a caller of it cannot spell it two ways. `rt-test defects` answers from it, and for every scope its answer holds what it held before this ticket, but for AC2's entry and AC3's digest: the same counts, listing, order, gaps, errors and bounds. (FR22)

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

- [x] (AC1, AC2) In `packages/daemon/src/defects/definition-files.ts`, read the `assertionErrors` member from the settings value `declaredPatterns` already parses, so `rt-test.json` is read once for both members. Check it with `listProblem` and a `ListMember` rule of its own (member `assertionErrors`, a named maximum of 256, the nouns "names" and "name", and a problem function that refuses the empty name and the name `Error`). `readDefinitionFiles` returns the names beside `definitions` and `invalidEntries`, and for a member with a problem returns no names and one `settings-unusable` entry whose reason begins by saying `rt-test.json` declares no assertion error names. Give each member its own problem. Today a problem in the `defects` member returns before anything else is read: read and check `assertionErrors` before that return, so a problem in `defects` still returns the names, or the names' own entry after the `defects` entry. A problem in `assertionErrors` returns its entry beside every definition and every other entry. An absent `rt-test.json` returns no entry and no names, and one that cannot be read at all (a link, not a regular file, unreadable, not JSON, not an object) returns the one entry it returns today and no names. The early return for an empty pattern list must still return the names. The file has 54 lines of room under lint's cap; if the change does not fit, ask the orchestrator before adding a file the sizing does not count.
- [x] (AC3) In `packages/daemon/src/defects/defect-standings.ts`, add the declared names to `StandingFacts` and to what `definitionDigest` digests, as one more element after the mutation's `new`: the array of the distinct names, sorted (code unit order, no locale), present and empty when no name is declared. Nothing else about a standing changes.
- [x] (AC4) Create `packages/daemon/src/defects/worktree-standings.ts` with the one function: it takes the consumer root, the state directory, the abort signal and the moment as a call; awaits `readDefinitionFiles`, runs `checkDefinitions`, awaits `readAnchors`, checks the signal, then takes the moment, builds the query basis, resolves the definitions and computes `defectStandings` over every one of them, with no await after the moment. It returns either the basis's no-answer alone, or the basis, the invalid entries, the declared names, the resolved definitions and the standings together. With no discovery stored nothing is resolved, `rt-test defects` answers that no-answer as today, and ticket 3.5 starts no job, so neither needs the names or the entries beside it. Make `defectsAnswer` in `packages/daemon/src/query/defects-answer.ts` call it and keep only what is the answer's own: the scope, resolved before the call as today, so a refused path still answers before any file is read; the no-answer for an empty scope; the gaps; the counts over the standings in scope; the listing; and the invalid entries as the answer orders, cuts and counts them today. Export the listing's order (`listedDefinitions` sorts by state, then evidence that is not current before current, then file and position) as one comparison of two standings from `defects/defect-standings.ts`, and have the answer sort by it, so ticket 3.5 orders by the same comparison. Filter the standings by scope after they are computed, since a definition's standing depends on no other definition.
- [x] (AC1, AC3, AC4) Check each consumer of the changed shapes in the same change: every caller of `readDefinitionFiles`, `defectStandings` and `definitionDigest`, every literal of `DefinitionFiles` and `StandingFacts`, and each defect record whose `new` text builds one or calls one (search every catalog, `packages/daemon/test/defects.json`, `packages/daemon/test/*/defects.json` and `packages/cli/test/defects.json`, for `readDefinitionFiles(`, `defectStandings(`, `definitionDigest(`, and for the members a literal carries without naming its type, `invalidEntries` and `discoveryCurrent`; authoring's search of one catalog for three of those names found two records), and list what you find under the Dev Handoff for the tests session.
- [x] (Support) Report to the orchestrator, with the handoff, the text for the files this lane does not edit: `README.md` (the `assertionErrors` member beside `nonInputs` and `defects`: what it declares, its bound, that `Error` is refused, what a member that cannot be used reads as in `rt-test defects`, and that changing the list reads every verdict stale; the sentence "other members are ignored" stays true of every other member) and `docs/architecture.md` § Defects query (the member, the invalid entry, and the definition digest's sentence, which lists what the digest covers), with each sentence of § Results store and § Falsification jobs that says what the definition digest covers or what evidence is bound to, and ADR-0008's sentence on the declared names (the bound of 256, and that `Error` is refused).
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `listProblem`, `ListMember` and `NON_INPUTS_FILE` from `packages/daemon/src/inputs/non-inputs.ts`: the check every list member of `rt-test.json` gets (an array of strings, a maximum, a problem for each item), and the words its refusal uses. `DEFECTS_RULE`, which moves from `definition-files.ts` into `defects/declared-settings.ts`, is the shape to follow.
- `declaredPatterns`, `readJsonFile`, `settingsEntry` and `INVALID_ENTRY.settingsUnusable` in `packages/daemon/src/defects/definition-files.ts`: the one read of `rt-test.json` and the entry an unusable member gets. `settingsEntry` words its reason for the `defects` member ("names no definition files"); give the names' entry its own words from the same kind and path.
- `wholeDigest` from `packages/daemon/src/inputs/input-inventory.ts`, as `definitionDigest` already calls it.
- `readDefinitionFiles`, `checkDefinitions` (`defects/definitions.ts`), `readAnchors` and `resolveDefinitions` (`defects/resolve-definitions.ts`), `queryBasis` (`query/summary.ts`) and `defectStandings` (`defects/defect-standings.ts`): the calls `defectsAnswer` makes today. The AC4 task states the order the new function keeps them in.
- `WaitMoment` from `packages/daemon/src/daemon/waits.ts`: the moment's type, as `DefectsQuery` names it.

### Must Create

- `packages/daemon/src/defects/worktree-standings.ts`: the one function of AC4 and the type of what it returns.
- `packages/daemon/src/defects/declared-settings.ts` (orchestrator, 07:08 on 2026-10-01, under Dev Notes § Questions to the orchestrator), with no I/O: the `ListMember` rule and the name problem function for `assertionErrors` beside `DEFECTS_RULE`, which moves there, and one function from the parsed `rt-test.json` value to its patterns, its declared names and each member's problem. `definition-files.ts` keeps the file read and the entries.

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

Fleet Cooling meets this on its main path, which is the owner's test for whether a case is addressed (04:43 on 2026-10-01: "the deciding factor on whether we should address it is look at Fleet Cooling's codebase. Would this edge case come up in it? If not leave it."). Its `scripts/falsify.mjs` holds a classifier arm for Testing Library's `TestingLibraryElementError`, the error its frontend suites' queries die by (read at its 9f139b8d). Under RT Test such a failure reads unclear until that name is declared. Its backend helper `assertThrowsConvexError` throws a plain `Error`, which declaring cannot serve: § Known limits says what a consumer does instead.

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
- An error whose name is `Error` cannot be declared, so a failure raised as `throw new Error(...)` reads unclear whatever the list holds. Fleet Cooling's backend helper `assertThrowsConvexError` is one: it throws a plain `Error` (`packages/convex/test/helpers.test.ts` at its 9f139b8d; `scripts/falsify.mjs` there says it "raises a plain `Error` rather than going through `expect`" and calls it "MANDATORY for every business-logic error assertion in the backend suite"), and the dev counted 644 calls of it in 144 files at 07:03 on 2026-10-01. The remedy is the consumer's: the helper throws an error with a name of its own, which is then declared, or fails through `expect`, which Vitest marks itself. RT Test does no more: admitting `Error` would count every thrown plain error as an assertion, a setup failure included (ADR-0008), and telling the helper's error from another by its message is what verdicts from recorded facts rule out (P37). The refusal's reason names that remedy.
- A name is matched exactly as Vitest serialized the error's name, so a subclass is declared by its own name (ADR-0008). A declared name that matches no error, as a misspelled one or one written with a space around it, is not reported: its verdicts stay unclear, and each lists the error names it met, which the author compares with the list.
- No job is scheduled until ticket 3.5 lands, so until then the names decide no verdict: this ticket reads them, reports a member that cannot be used, and binds the digest.
- Evidence stored before this ticket's digest would read stale. None exists outside tests, since `writeEvidence` has no production caller until ticket 3.5.

#### Questions to the orchestrator

Asked at 06:43 on 2026-10-01; decided by the orchestrator at 06:45.

- Sizing: ticket 3.5 as scoped measured about 29 raw files, 38 estimated, past the 30-file limit. Ruling: split. This ticket, 3.4c, holds the defects side and builds after 3.4 and before 3.5.
- The declared names and evidence: the coarser rule, accepted: "the definition digest also covers the declared assertion error names, sorted, so a change to the list reads every record stale as definition-changed." With the ground it stands on: "This binding stands on FR15's own words", since the declared names are execution configuration and Fleet Cooling meets the case on its main path.

Asked by the dev (threadId 3e086469-a6f5-4b43-9c5f-55efd35181b9) at 07:07 on 2026-10-01; decided by the orchestrator at 07:08.

- A new file for the settings check: the first task's change, tallied line by line, was 53 code lines against the 54 of room in `defects/definition-files.ts`, so the file would land at 499 or 500 of 500. Ruling: "create packages/daemon/src/defects/declared-settings.ts as you describe (pure, the two members' rules and bounds, the name check, one function from the parsed value to patterns, names and each member's problem), with definition-files.ts keeping the file read and the entries. A file landing at 499 or 500 of 500 is not a place to squeeze into, and the cost is one file: the ticket touches 11 against the owner's limit of 25." `readDefinitionFiles` keeps the signature and return the first task gives. As built, `defects/definition-files.ts` holds 426 code lines and the new module 81.

Asked by the tests session (threadId 062b3144-42d8-47be-8ce8-7c2447f54200) at 07:37 on 2026-10-01; decided by the orchestrator at 07:38.

- More defect ids: the plan held 22 named tests against a range of 20 (D4006 to D4025). The two past the range are clauses of AC4 at the answer: the moment taken only once the last awaited read has ended, which D3710 does not catch for a moment taken between the two reads, and the no-answer of a worktree with no stored discovery, which no test covered for `defects`. Ruling: "Granted: D4026, D4027, D4028, D4029", and "Both tests you name are clauses of AC4 at the layer it names, so write them".

#### Ticket review

One review agent read the ticket and its bound rules at 06:52 on 2026-10-01 and returned 12 edits and 5 questions. Eleven edits are applied; the twelfth, an empty Execution Metadata block, was filled while the review ran. The questions were settled by fact and none went to the orchestrator: the query basis takes no path (`queryBasis` in `query/summary.ts`), so standings over every definition read the same facts a scoped answer does; ticket 3.5 schedules under the empty set while the member cannot be used, which § Known limits now prices; the import direction with ticket 3.4b is under § Pending siblings; a problem in each member is two entries, the `defects` member's first (AC2); and the room in `definition-files.ts` is in the first task. The grill before it asked nothing: every seeded choice was ruled by the orchestrator at 06:45, fixed by the sprint entry, or changes no shipped behavior, and it added the known limit on a name that matches no error.

#### Sanity check

From the dev (threadId 3e086469-a6f5-4b43-9c5f-55efd35181b9) at 07:03 on 2026-10-01, before any edit; answered by the author at 07:05. Four findings, all confirmed and applied.

- F1, a Dev Note against AC1: confirmed. Authoring read that Fleet Cooling's `assertThrowsConvexError` raises a plain `Error` and still wrote that declaring serves it. § Why this ticket exists now names Testing Library's error alone, § Known limits carries the helper's case and the consumer's remedy, and AC2's reason for the name `Error` says an error must carry a name of its own. AC1 stands as written, and `Error` stays refused: the remedy is an edit to Fleet Cooling's own helper, three throw sites in one file (orchestrator, 07:04 on 2026-10-01).
- F2, the sizing's delegation: confirmed. § Sizing says the dev builds one dependency chain alone.
- F3, what the function returns beside a no-answer: confirmed as a gap. The AC4 task says either the no-answer alone or the five together.
- F4, the place of the names' entry: confirmed as a gap. AC2 puts the entries for `rt-test.json` before the walk's, the `defects` member's first.

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

11 raw files and 14 estimated (11 times 1.3); code units 5 (four criteria and validation). Production, modified: `defects/definition-files.ts`, `defects/defect-standings.ts`, `query/defects-answer.ts`. Production, created: `defects/worktree-standings.ts`, and `defects/declared-settings.ts` by the orchestrator's ruling of 07:08. Tests, for create-tests: `test/defects/definitions.test.ts`, `test/query.test.ts`, `test/experiment-facts.ts`, and the `defects.json` beside the first two (`packages/daemon/test/defects/`, `packages/daemon/test/`). This ticket's file. The work is one dependency chain over five production files, so dev builds it alone, in this order: the names and the digest (AC1 to AC3), then the function and the answer (AC4), which reads what the first returns. Docs are text reported to the orchestrator, but for the glossary's Definition digest and ADR-0007's binding sentence, which authoring wrote under the orchestrator's grant of 06:45.

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
  - packages/daemon/src/defects/declared-settings.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 3e086469-a6f5-4b43-9c5f-55efd35181b9

#### Test Files This Change Broke

Typecheck (`bun run --filter @rt-test/daemon typecheck`, 07:22 on 2026-10-01, exit 1 with these two errors and no other):

- `packages/daemon/test/defects/definitions.test.ts`: `standingsIn` hand-builds a `StandingFacts` with no `assertionErrors` (TS2345 at its `defectStandings(` call).
- `packages/daemon/test/query.test.ts`: the `StandingFacts` built beside its `readDefinitionFiles` call has no `assertionErrors` (TS2741).

Records, which no typecheck reads. `node scripts/check-defects.mjs` exits 1 at D3694, the first of these, until they are re-anchored. Fifteen records lost their anchor, found by matching every record's `old` against its file in every catalog:

| Record       | Was in                        | Its code now                    | What moved or changed                                                                                                    |
| ------------ | ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D3694        | `query/defects-answer.ts`     | same file                       | `total: definitions.length + invalidEntries.length,` reads `standings.length`                                            |
| D3699, D3725 | `query/defects-answer.ts`     | same file                       | `definitions.length === 0 &&` reads `standings.length === 0 &&`                                                          |
| D3695        | `query/defects-answer.ts`     | `defects/defect-standings.ts`   | the state line of the listing's order, now in `compareStandings`, indented by four                                       |
| D3953        | `query/defects-answer.ts`     | `defects/defect-standings.ts`   | the `currentRank` line of the same comparison                                                                            |
| D3710        | `query/defects-answer.ts`     | `defects/worktree-standings.ts` | `const { consumerRoot, signal } = read;`, and its `new` text names `query`, which is `read` there                        |
| D3721        | `query/defects-answer.ts`     | `defects/worktree-standings.ts` | `const discoveryCurrent = ...` moved verbatim                                                                            |
| D3955        | `query/defects-answer.ts`     | `defects/worktree-standings.ts` | `discoveryCurrent,` and `currentFingerprint:` in the `defectStandings` literal, indented by six                          |
| D3654        | `defects/definition-files.ts` | same file                       | the absent arm of `readSettings`, which returns `NOTHING_DECLARED`                                                       |
| D3655        | `defects/definition-files.ts` | same file                       | the invalid arm of `readSettings`, which returns `unreadSettings(read.entry.reason)`                                     |
| D3656        | `defects/definition-files.ts` | `defects/declared-settings.ts`  | `problem: patternProblem,` in `DEFECTS_RULE`, verbatim                                                                   |
| D3720        | `defects/definition-files.ts` | `defects/declared-settings.ts`  | the not-an-object arm, now `if (!isRecord(value)) return unreadSettings(NOT_AN_OBJECT);`                                 |
| D3932        | `defects/defect-standings.ts` | same file                       | `mutation.new,` is now followed by `index.assertionErrors,`                                                              |
| D3933        | `defects/defect-standings.ts` | same file                       | `relativePosixPath(index.consumerRoot, mutationPath),`                                                                   |
| D4000        | `defects/defect-standings.ts` | same file                       | `definitionDigest(subject, index)`: its `new` text passes `index.consumerRoot`, and the second argument is now the index |

One record keeps its anchor and breaks in its `new` text: D3952 (`query/defects-answer.ts`) writes `definitions.length`, a variable `defectsAnswer` no longer holds; the count is `standings.length`.

Checked and not broken: no test compares what `readDefinitionFiles` returns with a whole literal (`outline` in `test/defects/definitions.test.ts` projects it), `test/experiment-facts.ts` reads a standing's `definitionDigest` and builds none, and D3958 in `packages/cli/test/defects.json` names `counts.invalidEntries`, whose shape is unchanged. The other 51 records anchored in the three edited files match once and name nothing that moved.

#### ACs Owed a Test

- AC4: the guarantee that `rt-test defects` answers from the one function with the same counts, listing, order, gaps, errors and bounds as before. Its evidence here is a traced path (Completion Notes § Acceptance evidence), and only the answer's own tests can show an answer unchanged for every scope.

#### Tests Owed

Each is a defect this change makes possible, named for the tests session to weigh.

- The names are dropped when the `defects` member has a problem, or the walk stops when the names have one (AC2, the two members checked apart).
- A `rt-test.json` that cannot be read at all gives two entries, or gives names (AC2).
- The names' entry stands before the `defects` member's, or after an entry the walk makes (AC2, the order).
- `Error`, the empty name or a 257th name is admitted, or a 256th refused (AC1, AC2).
- The digest leaves the names out, depends on their order, or counts a repeated name (AC3).
- `worktreeStandings` hands `defectStandings` no names, or other names than it returns, so a caller's job would judge under names its evidence is not bound to (AC3, AC4).
- `worktreeStandings` takes the moment before its last awaited read (AC4; D3710 is this defect at its old place).
- The answer computes standings for a scope and misses the rest, or a names problem is left out of a scope's total (AC2, AC4).

### Tests Record

Tests session: threadId 062b3144-42d8-47be-8ce8-7c2447f54200

#### Named Defects

D4006 to D4020 and D4028 are in `packages/daemon/test/defects/defects.json`, their tests in `test/defects/definitions.test.ts`; D4021 to D4027 and D4029 to D4031 are in `packages/daemon/test/defects.json`, their tests in `test/query.test.ts`.

- D4006: The names `rt-test.json` declares are read and dropped, so no caller is handed a name and a Testing Library failure reads unclear whatever the list holds. (AC1)
- D4007: What `rt-test.json` declared at the first read is kept and answered for every later read, so a name added to the list is never declared until the daemon restarts. Its test also pins that no file and no member declare no name. (AC1)
- D4008: The bound on declared names is 255, so a list of exactly 256 names, which is allowed, declares none. (AC1)
- D4009: A 257th declared name is admitted. Its test pins the entry's reason, which says how many names the list holds past the 256 allowed. (AC1, AC2)
- D4010: A problem in the `assertionErrors` member makes no invalid entry, so an author's typo is unreported. Its test pins the kind `settings-unusable`, the path `rt-test.json` and the reason for a member that is not an array of strings. (AC2)
- D4011: An empty name is admitted as a declared assertion error name. (AC1, AC2)
- D4012: The name `Error` is admitted, so every plain thrown error, a setup failure among them, counts as an assertion. Its test pins the reason's sentence that an error must carry a name of its own to be declared. (AC1, AC2)
- D4013: The entry for the names stands before the entry for the `defects` member. Its test pins that a problem in each member is two entries. (AC2)
- D4014: A problem in the names stops the walk, so no definition file is read and every definition leaves the answer. (AC2)
- D4015: The invalid entries are returned latest first, so a problem in the names stands after the entries the walk makes. (AC2)
- D4016: A problem in the `defects` member drops the declared names. (AC2)
- D4017: An `rt-test.json` that cannot be read at all is two invalid entries, one for each member. Its test covers a file that is not JSON and one whose top level is not an object, and pins that neither declares a name. (AC2)
- D4018: The definition digest leaves the declared names out, so a detection that rested on a name since taken off the list still reads current. Its test pins another digest for every definition when the list gains a name, loses one, or loses all. (AC3)
- D4019: The definition digest covers the names in the order `rt-test.json` writes them, so reordering the list reads every verdict stale. (AC3)
- D4020: The definition digest counts a repeated name, so writing a name twice reads every verdict stale. (AC3)
- D4021: The invalid entries are scoped by their path, so a problem in the declared names, which sits at `rt-test.json`, is left out of a folder's total and listing. Its test answers for two workspaces and pins every definition answered beside the entry. (AC2, AC4)
- D4022: The worktree's standings are computed under no names whatever `rt-test.json` declares, so evidence a job binds under the declared names reads stale as soon as it is stored. Its test pins, through the answer, current and verified under the same set in another order with a repeat, and stale as `definition-changed` with verified 0 once the list gains or loses a name. (AC3, AC4)
- D4023: A list refused for one name still declares its names, so `Error` is among the names verdicts are bound to. Its test pins the empty set through the answer: a detection stored under no names reads current under a refused list, and the refusal counts in the total. (AC2, AC3)
- D4024: A path's counts are taken over every definition of the worktree, so a folder's answer counts states, detections and verified definitions that lie outside it. (AC4)
- D4025: The worktree's standings return no names though every standing's digest covers the declared ones. Its test calls `worktreeStandings` as a caller that is not the answer and pins the names, the definition file problems, and every definition with its standing in both workspaces. (AC4)
- D4026: The daemon's moment is taken after the definition files are read and before the mutation files are. Its test rewrites the mutation's file from the moment's own callback, so an anchor read after the moment reads anchor missing. D3710 catches a moment taken before any read. (AC4)
- D4027: The answer does not pass on the no-answer of a worktree with no stored discovery, so the query throws rather than saying no discovery is stored. (AC4)
- D4028: The names are taken from a second read of `rt-test.json`, so a file rewritten between the two reads gives the patterns of one version beside the names of another. (AC1, AC4)
- D4029: The standings digest each mutation's file relative to another directory than the consumer root the definition checks were given, so all evidence reads stale. Its test binds a detection under the root with `defectStandings` directly, as a job would, and reads it through the answer asked under the same root. (AC4)
- D4030: The answer lists the invalid entries in another order than the read gives them, so a problem in the declared names stands after an entry the walk makes, or before the `defects` member's. Its test answers a problem in each member and a names problem beside a definition file that is not JSON, and pins two counted in each. (AC2)
- D4031: Definitions of one state are listed in another order than by file, so past the bound of 500 the wrong file's definitions are the ones left unlisted. Its test holds two definition files the walk reads in the other order than their names sort. (AC4)

Re-anchored, each keeping its defect sentence and its test: D3654 and D3655 (the two arms of `readSettings`), D3656 and D3720 (now in `defects/declared-settings.ts`), D3932, D3933 and D4000 (the digest takes the index), D3694, D3699 and D3725 (`standings.length`), D3695 and D3953 (now `compareStandings` in `defects/defect-standings.ts`), D3710, D3721 and D3955 (now in `defects/worktree-standings.ts`). D3952 keeps its anchor and its `new` text names `standings.length`.

AC4's guarantee that the answer holds what it held before, for every scope, rests on the answer's existing tests proven again over the built code (D3691 to D3699, D3710, D3713, D3721 to D3725, D3733, D3734, D3951 to D3955, D3997, D3998) beside D4024 for the one defect the move made possible: counts taken over the unscoped standings.

#### Deliberately Untested

- `packages/daemon/src/defects/worktree-standings.ts`: an awaited step after the moment that reads no file (AC4, returning without awaiting again). D4026 goes red for any mutation file read after the moment; a step that reads nothing would show a consumer daemon facts one turn older than the answer's return, and only when a result is stored or an input changes within that same turn.
- `packages/daemon/src/defects/worktree-standings.ts`: a second call of `readDefinitionFiles` within one answer (AC4, one read). D4028 pins one read of `rt-test.json` inside the reader; a second call would show a consumer the entries of one version of a file beside the definitions of another, and only when the file is rewritten between the two calls of one query.
- `packages/daemon/src/defects/defect-standings.ts`: the names sorted by code unit rather than by locale. A locale's order would give another digest only for names that differ in case or hold a character outside ASCII, and only when the daemon's locale changes between the job that stored a verdict and the query that reads it, on the one machine that holds the evidence. Fleet Cooling's error classes are ASCII names in one case pattern (read at its 20f77f5c).
- `packages/daemon/src/defects/declared-settings.ts`: a list holding a value that is not a string. D4010 proves the refusal for a member that is a bare string, the one check decides both, and a consumer would see the same entry.
- `packages/cli/src/commands/defects.ts`: unchanged by this ticket. The names' entry is of a kind the command already prints (`settings-unusable`), and the answer carries no names to print.

### Review Record

Review session: threadId cc865cd7-0a22-4e72-b993-08ae0d3a613a

#### What the review ran

On Windows in Tree 2 at ee784b05 (the build e7818ef5, the tests cf0434e8, main merged after each), from 07:54 on 2026-10-01. The reviewed set is `git diff main...wt/2` and the doc lines of the authoring commit 0dcf5032. Lane evidence-read's files (`store/kept-evidence.ts`, `store/open-store.ts`, `test/store.test.ts`, D3990 to D3995 and D3931) are outside it.

- The rules are the ticket's own: 28 checklist rules and 9 project-context rules, by `expand-rules.mjs --from-ticket`.
- Three fresh-eyes batches read the code cold: settings (`declared-settings.ts`, `definition-files.ts`, `definitions.test.ts` and its records, 2,486 code lines), answer (`defects-answer.ts`, `query.test.ts` and its records, 3,653) and standings (`defect-standings.ts`, `worktree-standings.ts`, 444). None returned a High finding, each confirmed the criteria its files reach, and each of the 24 new tests was read against its record's `new` text and fails at its own assertion.
- One doc agent checked the changed lines of 0dcf5032 (no discrepancy) and the two texts not yet applied. One agent read installed Vitest 4.1.11 and 5.0.1, chai 6.2.2 and, in Fleet Cooling's checkout, `@testing-library/dom` 10.4.1 and `@testing-library/jest-dom` 6.9.1.
- The reviewer ran the checklist pass, the criteria sweep and the ADR check (ADR-0007, ADR-0008 and ADR-0009; the diff contradicts none), and compared `defectsAnswer` with main's line by line: rating every definition and then filtering lists, counts and orders as filtering first did.
- `bun x oxlint` over the five production files exits 0 (07:55); the largest holds 426 of 500 code lines. `check-sprint-keys`, `check-requirement-markers` and `check-line-citations --base main` are clean (08:02). The five production files anchor 90 records (25, 11, 26, 7 and 21), which is the count the tests session proved.

#### Findings fixed

- This record's File List left out the four files the tests session changed. They are listed now.

No finding asks for a change to the built code.

#### Doc text for files the orchestrator owns

Corrections to the text under Completion Notes § Doc text reported to the orchestrator and to `_agent-docs/.scratch/t3-4c-doc-text.md`. Every sentence those hold and this list does not name was checked against the code and stands, and each sentence they replace is in its file verbatim.

`README.md`, the new block:

- Where it goes. Placed after the `rt-test defects` paragraph, its four bullets run into the bullets that follow that paragraph, which apply to every query. Place it after the last bullet of the `rt-test.json` list (the one that begins "Until the daemon holds a discovery"), where its opening paragraph keeps the two lists apart.
- Replace "A name is matched exactly against the name Vitest reports for the error, so a subclass is declared by its own name." with: "A name is matched exactly against the name Vitest reports for the error, which is the error's own `name`: a subclass that sets a name of its own is declared by that name, and one that sets none carries its parent's." A subclass that sets no name serializes under its parent's name (`@vitest/utils/dist/serialize.js`, the prototype walk, on 4.1.11 and the same code in 5.0.1).
- Add a fifth bullet, since the README says of `rt-test defects` that no falsification runs yet: "No falsification runs yet, so the names decide no verdict yet: `rt-test defects` reads them, reports a member that cannot be used, and binds each definition's digest to them."

`docs/architecture.md` § Defects query, the added paragraph:

- Replace "or the no-answer of a worktree with no stored discovery" with "or the query basis's no-answer when the store holds no discovery it can read". `queryBasis` in `query/summary.ts` gives a no-answer for a discovery refused as unreadable as well.
- Replace "and the answer filters the standings by scope, since a definition's standing depends on no other definition" with "and the answer filters the standings by scope once every definition of the worktree is checked and rated, so an id repeated outside the scope still reads invalid inside it". A repeated id makes a definition's state depend on another (`checkDefinitions` in `defects/definitions.ts`); only the rating reads one definition.

`docs/architecture.md` § Defects query, the invalid entry sentence:

- Replace "and the entries for `rt-test.json` come before those the walk finds, the `defects` member's first" with "and a member's entry comes before every other entry, the `defects` member's first". A `pattern-matched-nothing` entry is at the path `rt-test.json` too and stands after the walk's entries.

`docs/testing.md`:

- Item 4: replace "through `settingsDeclaring`, which writes an `rt-test.json` declaring names with a `defects` member only when patterns are given" with "through `settingsDeclaring`, which gives the text of an `rt-test.json` declaring names, with a `defects` member only when patterns are given". The helper returns text and `definitionFilesIn` writes it.
- Item 6: the sentence's list of files names neither file two of the ids it gains mutate. After "`packages/daemon/src/defects/defect-standings.ts`," add "the names and the consumer root `worktreeStandings` hands the standings in `packages/daemon/src/defects/worktree-standings.ts`,". D4022 and D4029 mutate that file, and D4023 mutates `defects/declared-settings.ts`, which the other section's list covers.

`_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.4c: "so that a change to the list reads every stored verdict stale" is loose, since a reordered list or a repeated name stales nothing. Exact: "so that a list that gains or loses a name reads every stored verdict stale".

#### Questions and rulings

Given with the review's dispatch by the orchestrator at 07:54 on 2026-10-01, none asked by the review:

- The listing of invalid entries and gap modules with no bound is a recorded known limit, since Fleet Cooling tracks 32 JSON files (orchestrator, 07:27).
- Ticket 3.4's two folded debt items are weighed and left (orchestrator, 07:26); § Tech debt holds the note.
- The orchestrator's reading of the owner's rulings: the four criteria bind as written, so a clause with no test that goes red when it breaks, at the layer the criterion names, is a gap to send; a finding beyond the criteria is fixed or sent when Fleet Cooling's codebase would meet it, and is otherwise recorded and left.

#### Findings left

Each was raised by a reviewer and is answered by the record or by the code.

- Names such as `TypeError` are admitted: Dev Notes § Design decisions, "Only `Error` is refused".
- A name with a space around it is admitted and never matches: § Known limits.
- The one entry of an `rt-test.json` that cannot be read says it names no definition files and nothing of the names: AC2 and the first task ask for the one entry it returned before, and the entry gives the reason the file cannot be read.
- `NOTHING_DECLARED` hands every caller one array: the arrays are typed `readonly`, so changing one takes a cast.
- An edit to `rt-test.json` was thought to read every verdict stale as `inputs-changed`, which would empty AC3's set rule. It does not: `rt-test.json` is excluded from the inputs (`inputs/input-filter.ts`), and its change starts a reconciliation after which results read as before.
- Rating every definition of the worktree for a scoped query, and `definitions` returned beside `standings`: AC4 and Dev Notes § Design decisions.
- `StandingIndex.assertionErrors` holds the sorted set under the name `StandingFacts` gives the list as written: each member's comment says which it is, and D4019 and D4020 go red if the digest is handed the list.
- Three sentences read loosely and none contradicts its code: the comment on `DefinitionFiles.invalidEntries` (a `pattern-matched-nothing` entry is not a member's problem, and D4015 pins the order), the comment on `StandingFacts` (its clause on `rt-test.json` is about the names), and the no-answer text "no problem reading the definition files", which D3699 pins and AC4 keeps as it was. `standings` names a list of defect standings beside test standings in `defectsAnswer`. A consumer reads nothing different, and an edit to any of the three files owes its records' proofs on both platforms.
- D4028 counts reads through the test file's own mock, and D4029's assertion repeats the first read of D3951: each fails at its assertion under its record, and the orchestrator granted both ids (07:38).

#### Tech debt

- **Ticket 3.4's two folded items, left again.** Its Review Record folds the duplicate `PASSED` constant (`query/changes-answer.ts` and `defects/defect-standings.ts`) and `zeroTally` against `zeroCounts` (`defects/defect-standings.ts` and `query/test-states.ts`) into "the next ticket that edits either file", which this ticket meets literally for `defects/defect-standings.ts`. They were weighed and left (orchestrator, 07:26 on 2026-10-01): each fix opens query-side files this ticket does not touch (`query/answer.ts`, `query/changes-answer.ts`, `query/test-states.ts`) and owes about forty records' proofs on both platforms, and a consumer reads nothing different. They go to the next ticket that edits the query-side file of each pair.
- `NOT_AN_OBJECT` in `defects/declared-settings.ts` holds the text `declarationProblem` in `inputs/non-inputs.ts` writes inline, for the same file. Fix: export one from `inputs/non-inputs.ts`. The text was inline in `defects/definition-files.ts` before this ticket. Scoped: two production files, mechanical. A record anchors on the inline line in `inputs/non-inputs.ts` and holds the text in its `old` and `new`, so the fix re-anchors it and owes the proofs of the 31 records in that file and the 11 in `defects/declared-settings.ts` on both platforms. Left: a consumer reads the same sentence either way. It goes with the next ticket that edits `inputs/non-inputs.ts`.
- `readMutationFile` in `defects/resolve-definitions.ts` reads a mutation's file whole with no size bound, once for each distinct file at every call of `worktreeStandings`. It predates this ticket and the file is unchanged. Scoped: one file with 17 records, and a decision before any code, since a bound needs a size and a wording for the file that passes it. Left: Fleet Cooling's mutation files are source files, so it would not meet one.
- No test goes red when `MAX_DEFECT_PATTERNS` in `defects/declared-settings.ts` is raised: the `defects` member's bound of 256 has no test on either side, where D4008 and D4009 pin the names' bound. It predates this ticket, which moved the constant. Scoped: no source change, two tests and two records in `test/defects/definitions.test.ts` for the tests session. Left: Fleet Cooling would not write 257 patterns.

Scoped at Step 9 against f6864910, at 08:16 on 2026-10-01, and accepted as left by the orchestrator in its message dated 08:17. `node scripts/list-open-issues.mjs` printed "0 open issues, complete", so no item has an issue and no open issue matched this change. The pass changed no code.

Dropped on scoping, since it is no copy: `readJsonFile` in `defects/definition-files.ts` words each `presence` state itself, beside `presenceDeclaration` in `inputs/non-inputs.ts`. The two share `presence` and diverge on purpose. `readJsonFile` reads every definition file as well as `rt-test.json` and turns a state into an invalid entry of its own kind, and the other's wording, "only a regular file at the consumer root is read", is false of a definition file.

#### For the tickets that follow

- 3.5: no test goes red when `signal.throwIfAborted()` before `read.moment()` in `worktreeStandings` is dropped, and `readAnchors` checks the signal only at the top of each turn. The guard and its gap predate this ticket (main's `defectsAnswer` held both). A stop that lands between the last anchor read and the moment would read a store the stop may have closed. 3.5's schedule calls the function at every look, so its stop tests are where the guard earns a named test.
- 3.5: `worktreeStandings` takes the consumer root as a member while the basis's context and the no-answer text name the root of the moment's view. Hand it both from one place, as `daemon/lifecycle.ts` does.
- 3.5: with no discovery stored the function reads every definition file and every mutation's file before it returns the no-answer, since the moment is taken last. A schedule that looks before the first discovery repeats those reads at each look.
- 3.5 and 3.4b: each definition's digest serializes the whole set of names again, and every query rates every definition of the worktree. Both are targets until measured. No production code stores evidence yet, so the digest's shape can still change at no cost.

#### Out of scope, reported to the orchestrator

A jest-dom matcher handed a value that is not an element throws from inside itself, before Vitest's `expect.extend` wrapper can mark it: `toBeInTheDocument` calls `checkHtmlElement`, which throws an `HtmlElementTypeError` (`@testing-library/jest-dom` 6.9.1, `dist/matchers-98b869c1.js`). That class sets no name, so Vitest serializes it as `Error` with no assertion name, it reads unclear, and its name cannot be declared. `expect(screen.queryByText(...)).toBeInTheDocument()` fails this way when a mutation removes the element. Fleet Cooling at 20f77f5c holds 4 such calls on a query or `querySelector` result and 45 on a variable, against 2,211 on a `getBy` or `findBy` call, which fail by the declarable `TestingLibraryElementError`. ADR-0008's known limits do not name it. It bears on the judge (ticket 3.3's `falsify/run-facts.ts`), not on this ticket's files.

#### Validation

On Windows, over the tree at ee784b05 with the gap round's two test-side files and this record uncommitted.

- The review's own round edited this ticket file alone, so it takes the outside-the-graph exemption: the typecheck and the suite are inert for it, and the doc's tools ran instead at 08:11 on 2026-10-01. `bun x prettier --check` over this file, `check-sprint-keys` (47 tickets), `check-requirement-markers` (31 requirements), `check-line-citations` and `fill-ticket --check` each exit 0.
- No production file was edited by the review or the gap round, so the 90 records the tests session proved on both platforms keep their proofs.
- The gap round's gates are the tests session's, at 08:09: `verify-defects --ids D4030,D4031` through the lease, 2 of 2 detected on Windows and on Linux under Node 24.19.0, each exit 0; `check-defects` exit 0 over 3,251 records; `bun x vitest run packages/daemon/test/query.test.ts`, 1 of 1 file and 143 tests, exit 0; `bun x oxlint` and `bun x prettier --check` over its two files exit 0; the daemon typecheck exit 0. The records already in `query.test.ts` are not proven again: the round's diff of that file removes no line and adds two `it` blocks inside one `describe`, with no hook and no helper change. The review read the diff and both proof logs' ends and ran none of these again.
- Not run by this lane: `bun run check` over the merged tree on either platform, and the two new tests under Node 22 on Linux, which are the orchestrator's gate.

#### Test Coverage Gaps

Answered by the tests session at 08:09 on 2026-10-01, each row closed by a named test proved by id on Windows and on Linux under Node 24: row 1 by D4030, row 2 by D4031. The review read both tests and their records against the tree: D4030 goes red when the answer reverses the entries, and D4031 when the file arm is dropped, since the walk reads `defects/b.json` before `defects/a/x.json`. D4032 to D4034 of the reserve are unused and go back to the orchestrator.

Sent to the tests session at 08:07 on 2026-10-01. Each row is a clause of a criterion with no test that goes red at the layer the criterion names; neither defect is in the code today. The denominator: 24 named tests (D4006 to D4029) against the clauses of four criteria, of which these two had none.

| #   | Source                                                                                     | Defect                                                                                                                                                                                     | Expected test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Severity                                                |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | `packages/daemon/src/query/defects-answer.ts` (`defectsAnswer`, the entries it lists), AC2 | The answer lists the invalid entries in another order than the read gives them, so a problem in the declared names stands after an entry the walk makes, or before the `defects` member's. | `query.test.ts`, through `defectsOver` with `settings`: an `rt-test.json` with a problem in each member answers two `settings-unusable` entries, the `defects` member's first, and counts two invalid entries; and a names problem beside a definition file that is not JSON lists the names' entry before the `not-json` entry. Every answer-level test holds one invalid entry today (D3694, D3723, D3724, D4021). D4013 and D4015 pin the order at `readDefinitionFiles`, beneath the layer AC2 names.                                                   | MEDIUM, consumer, the order of a listing; reach unknown |
| 2   | `packages/daemon/src/defects/defect-standings.ts` (`compareStandings`, its file arm), AC4  | Definitions of one state are listed in another order than by file, so past the bound of 500 the wrong file's definitions are the ones left unlisted.                                       | `query.test.ts`: same-state definitions in two definition files, two in each, are listed file by file, each file's in position order. Every answer-level test keeps its definitions in `a.json`: D3695 pins the state arm and D3953 the not-current arm, and neither goes red when `compareFiles` is inverted or its line dropped. This ticket moved the comparison, and ticket 3.5 takes its work in this order. The position arm cannot be seen through the answer, since the sort is stable over standings already in position order, and needs no test. | MEDIUM, consumer; reach unknown                         |

### Completion Notes

Built by the dev session (threadId 3e086469-a6f5-4b43-9c5f-55efd35181b9) on 2026-10-01, in Tree 2 on `wt/2` over 0dcf5032, alone as one dependency chain. No test was written, edited or run.

#### What was built

- `defects/declared-settings.ts` (new, pure): the `defects` and `assertionErrors` rules and bounds, the name check, and `declaredSettings`, from the parsed `rt-test.json` value to its patterns, its declared names and each member's problem as a whole reason, the `defects` member's first. `unreadSettings` is the one problem of a file that cannot be read at all.
- `defects/definition-files.ts`: `readDefinitionFiles` reads `rt-test.json` once through `readSettings`, turns each problem into a `settings-unusable` entry ahead of the walk's entries, and returns `assertionErrors` beside `definitions` and `invalidEntries` on every path, the empty-pattern return included.
- `defects/defect-standings.ts`: `StandingFacts` takes `assertionErrors`; the index holds them once as a sorted set, and `definitionDigest` digests that array after the mutation's `new`. `compareStandings` is the listing's order, with `currentRank` and `compareFiles` moved beside it.
- `defects/worktree-standings.ts` (new): `worktreeStandings` and its `WorktreeRead` and `WorktreeStandings` types.
- `query/defects-answer.ts`: `DefectsQuery` extends `WorktreeRead`; `defectsAnswer` resolves the scope, calls `worktreeStandings`, filters the standings by scope and sorts by `compareStandings`.

#### Decisions and their record

- Sanity check, four findings, all confirmed by the author at 07:05 and ruled by the orchestrator at 07:04 (Dev Notes § Sanity check).
- The settings check in its own file: asked at 07:07, decided at 07:08 (Dev Notes § Questions to the orchestrator).
- The refusal of `Error` reads: "the name "Error" is carried by every plain thrown error, a setup failure among them, and an error must carry a name of its own to be declared; throw an error with a name of its own and declare that name, or fail through expect". It names no helper, since the thrower may be any code.
- The `defects` member's constant is two constants now, `DEFINITION_FILES_MEMBER` for `rt-test.json`'s member and `DEFECTS_MEMBER` for a definition file's array: two keys in two files that share a spelling, each beside its one reader.
- Unverified assumptions: none in the ticket, and the change calls no third-party behavior.

#### Acceptance evidence

A scratch probe ran the built code under `bun --conditions development` at 07:21 (its output is `_agent-docs/.scratch/t3-4c/probe.log`, kept until the lane closes). It is a probe, not a test.

- AC1: with no file and with no member, no name and no entry; three names with one repeated come back as written; 256 names come back and 257 are refused. One `readJsonFile` call in `readSettings` gives both members, and the module holds no state between calls.
- AC2: each refusal reads as the criterion words it (not an array of strings; "holds 257 names, more than the 256 allowed"; the empty name; `Error` with the sentence on a name of its own). Both members bad gives two entries, the `defects` member's first. `defects` bad with names good returns the names beside one entry. Names bad with `defects` good reads both definitions of the fixture file and puts the names' entry before the walk's `pattern-matched-nothing` entry. A top level that is not an object, and text that is not JSON, each give the one entry worded as before and no names. The count in the total and in every scope is traced: `defectsAnswer` adds `invalidEntries.length` to `total` and never filters the entries by scope.
- AC3: over one hand-built definition, the digest is equal under a reordering and under a repeated name, and differs when the list gains or loses a name and between no name and one. A detection stored under the names A and B reads current and verified under B, A, A, and reads stale with `definition-changed` alone and verified 0 under A and under no name.
- AC4, traced and owed a test (Dev Handoff): `worktreeStandings` awaits `readDefinitionFiles` and `readAnchors`, checks the signal, calls the moment and holds no `await` after it; the one `consumerRoot` goes to `readDefinitionFiles`, `checkDefinitions` and `defectStandings`; `defectsAnswer` resolves its scope before the call. The reviewer confirmed independently that computing every standing and then filtering equals filtering first, since `standingOf` reads one definition.

#### Adversarial review

One hostile reviewer read the five files cold at 07:14 and returned six findings, none critical or high, and confirmed the rulings are met.

- Fixed: F1 (the comment on `invalidEntries` claimed more than the order delivers: a `pattern-matched-nothing` entry also has the path `rt-test.json` and stands after the walk's, as before this ticket; the comment now says a member's problem comes first), F3 (three docblocks defined an invalid entry as a definition file problem only), F4 and F5 (two docblocks said every fact is of the moment, where the names and the files are as read before it), F6 (the remedy's wording).
- Recorded and left, F2: `invalidEntries` and `gapModules` are listed whole in the answer, with no bound, so a consumer whose `defects` pattern matches several thousand JSON files that are not definition files gets the whole answer refused as too large at every path, and cannot read which files to fix. It predates this ticket, which adds at most two entries. Fleet Cooling would not meet it: it tracks 32 JSON files (`git ls-files '*.json'` at 9f139b8d, 07:21), so by the owner's test it is a known limit. Bounding the two lists as `definitions` is bounded is the fix if a consumer ever meets it.

#### Validation, on Windows, over the tree after the review's fixes

- `bun x oxlint` over the five production files, 07:22: exit 0, no warning.
- `bun x prettier --check` over the five files and this ticket, 07:22: exit 0.
- `bun run --filter @rt-test/daemon typecheck`, 07:22: exit 1, with the two test-file errors under Dev Handoff and no error in production code. It is a workspace compile and takes 2 seconds.
- `bun run --filter rt-test typecheck` (the CLI, which depends on the daemon), 07:22: exit 0.
- `node scripts/check-line-citations.mjs`, 07:22: clean.
- Code lines: `declared-settings.ts` 81, `definition-files.ts` 426, `defect-standings.ts` 380, `worktree-standings.ts` 64, `defects-answer.ts` 277.
- Not run by this session: the suite, any defect proof, the repo-wide `bun run check`, and anything on Linux.

#### README

The change is user-visible (a new `rt-test.json` member and a new invalid entry). `README.md` is the orchestrator's file, so its exact text is below.

#### Doc text reported to the orchestrator

For the files this lane does not edit. Each item names the sentence it replaces or follows.

`README.md`, the bullet under the `nonInputs` example. Replace "Its `defects` member names the defect definition files (`rt-test defects`), and other members are ignored." with:

> Its `defects` member names the defect definition files and its `assertionErrors` member declares the error names that count as assertions (both under `rt-test defects`), and other members are ignored.

`README.md`, the `rt-test defects` paragraph. In the sentence "Each of these counts in the total as a definition file problem: an `rt-test.json` whose `defects` member cannot be used, ...", replace "whose `defects` member cannot be used" with "whose `defects` or `assertionErrors` member cannot be used". Then add after that paragraph:

> Vitest marks two kinds of failure as assertions itself: an `AssertionError`, and a failure of an `expect.extend` matcher such as jest-dom's. A test that fails by any other error, as a Testing Library query does (`TestingLibraryElementError`), reads unclear rather than detected until its error's name is declared in `rt-test.json`:
>
> ```json
> { "assertionErrors": ["TestingLibraryElementError"] }
> ```
>
> - `assertionErrors` is an array of at most 256 names. A name is matched exactly against the name Vitest reports for the error, so a subclass is declared by its own name.
> - `Error` cannot be declared: every plain thrown error carries that name, a setup failure among them, so an error must carry a name of its own to be declared. A helper that fails by `throw new Error(...)` gives its error its own name, which is then declared, or fails through `expect`.
> - A member that is not an array of strings, holds more than 256 names, or holds an empty name or `Error` declares no names, and `rt-test defects` counts it in the total as a definition file problem that says why. The `defects` member is still read, and a problem in the `defects` member leaves the names read.
> - Changing the declared names reads every stored verdict stale (`definition-changed`), whether or not it turned on a name. Reordering the list or repeating a name changes nothing.

`docs/architecture.md` § Defects query. After the sentence that ends "so the facts the answer carries are the ones that hold when it answers.", add:

> `worktreeStandings` in `defects/worktree-standings.ts` makes those reads and takes that moment for the query: from one read of `rt-test.json`, the definition files and each mutation's file it returns the invalid entries, the declared assertion error names, every definition resolved and every definition's standing, or the no-answer of a worktree with no stored discovery. It hands the one consumer root it was given to the definition checks and to the standings, and the answer filters the standings by scope, since a definition's standing depends on no other definition. The same read of `rt-test.json` gives the `assertionErrors` member, the error names that count as assertions beside the two forms Vitest marks itself: `declaredSettings` in `defects/declared-settings.ts` checks the two members apart from the parsed value, reading no file, and nothing of the names is kept between two reads. The answer does not carry the names.

In the sentence that begins "Each of these problems is one invalid entry", replace "or whose `defects` member is not an array of at most 256 usable patterns;" with:

> or whose `defects` member is not an array of at most 256 usable patterns; an `assertionErrors` member that is not an array of at most 256 names, each non-empty and none of them `Error`, which declares no names and leaves every definition file read (a problem in each member is two entries, and the entries for `rt-test.json` come before those the walk finds, the `defects` member's first);

In the freshness sentence, replace "`definition-changed` (the definition digest, a digest of the definition's id, its resolved test's whole identity and its mutation's root-relative file, `old` and `new`, differs from the record's)" with:

> `definition-changed` (the definition digest, a digest of the definition's id, its resolved test's whole identity, its mutation's root-relative file, `old` and `new`, and the declared assertion error names as a sorted set, differs from the record's, so a list that gains or loses a name reads every verdict of the worktree stale under this cause, and a reordered list or a repeated name reads none stale)

Where § Defects query gives the listing's order, add: "`compareStandings` in `defects/defect-standings.ts` is that order."

`docs/architecture.md` § Results store. Replace "the definition digest handed in for the defect," with:

> the definition digest handed in for the defect, which covers the assertion error names declared when its standing was read,

`docs/architecture.md` § Falsification jobs. Replace "(the `assertionErrors` the `falsify` request carries)" with:

> (the `assertionErrors` the `falsify` request carries; `readDefinitionFiles` reads the consumer's from `rt-test.json`, and no caller hands them to a job)

`docs/adr/0008-detection-from-task-facts-and-canaries.md`. Replace "or when its name is one the consumer declares in the `assertionErrors` member of `rt-test.json`, and otherwise another kind" with:

> or when its name is one of the at most 256 the consumer declares in the `assertionErrors` member of `rt-test.json`, which refuses the name `Error`, and otherwise another kind

and after its known limit "A Testing Library query error reads as unclear unless the consumer declares its name." add:

> An error named `Error` cannot be declared, so a helper that fails by throwing a plain `Error` reads as unclear until it throws an error with a name of its own, which is then declared, or fails through `expect`.

### File List

- `_agent-docs/tickets/3-4c-declared-assertion-names.md` (created by create-ticket, 06:58 on 2026-10-01, cut from ticket 3.5)
- `_agent-docs/sprints/sprint-3-falsification.md` (create-ticket: § Ticket 3.4c with the split's paragraph, the order paragraph, and two sentences of § Ticket 3.5)
- `_agent-docs/sprint-status.yaml` (create-ticket: the `3-4c-declared-assertion-names` key)
- `docs/glossary.md` (create-ticket: Definition digest)
- `docs/adr/0007-reused-instance-per-falsification-job.md` (create-ticket: the binding sentence)
- `docs/requirements.md` (create-ticket: ticket 3.4c on the markers of FR11, FR15 and FR22)
- `packages/daemon/src/defects/declared-settings.ts` (dev: created)
- `packages/daemon/src/defects/worktree-standings.ts` (dev: created)
- `packages/daemon/src/defects/definition-files.ts` (dev: modified)
- `packages/daemon/src/defects/defect-standings.ts` (dev: modified)
- `packages/daemon/src/query/defects-answer.ts` (dev: modified)
- `_agent-docs/tickets/3-4c-declared-assertion-names.md` (dev: task and criterion boxes, the 07:07 question, Dev Handoff, Completion Notes, File List)
- `packages/daemon/test/defects/definitions.test.ts` (create-tests: modified)
- `packages/daemon/test/query.test.ts` (create-tests: modified)
- `packages/daemon/test/defects/defects.json` (create-tests: modified)
- `packages/daemon/test/defects.json` (create-tests: modified)
- `_agent-docs/tickets/3-4c-declared-assertion-names.md` (create-tests: the 07:37 question and the Tests Record; review-changes: the Review Record and these lines)

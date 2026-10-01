# Ticket 3.4: Defect evidence

## Ticket

As an author, or the coding agent writing tests for one,
I want each falsification verdict kept in the local store, bound to exactly what it was decided from, and `rt-test defects` to say for each definition which verdict it holds, whether that verdict is still current and why not, with the verified, eligible and total counts,
so that I read which defects have current evidence that their test detects them without running a proof, and never take evidence from before an edit, a restart or a version change for current evidence.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

Every criterion holds on Windows and on Linux. "Now" means when the daemon answers the query. A "verdict" is one of detected, survived, invalid experiment and unclear, as ticket 3.3's judgement names them. A defect's "stored evidence" is the one evidence record the store holds for its id in the query's project and worktree. The "mutation file digest" is the one ticket 3.3b puts on each experiment record of a job's reply: a digest of the mutation file's text as the job read it. This ticket changes no summary answer: ticket 3.4b adds the summary's defect counts.

- [ ] AC1: Storing a falsification job's reply (Dev Notes § The interface ticket 3.5 calls) keeps one evidence record for each of its judgements that has a verdict: the defect's id, the verdict, its reason and detail where the verdict has one, and its facts, bound to the project identity, the worktree identity, an identity the store gives the stored reply, the definition digest handed in for the defect, the mutation file digest its experiment record carries, the workspace's input fingerprint handed in, the reply's Vitest version and falsifier version, and the Vitest adapter version of the store that writes it, as a stored run carries it. The record becomes that defect's only evidence in that project and worktree, replacing an earlier one, and changes no other defect's and no other worktree's evidence. A judgement with no verdict stores nothing and leaves the defect's earlier evidence as it was. A reply's records become visible together or not at all (C150). Each of these stores nothing and throws, naming what is missing (C122): a reply that does not read `ran`, or that carries no Vitest version or no falsifier version; an empty or missing project identity, worktree identity or fingerprint digest; a verdict whose defect has no definition digest handed in; a verdict whose defect id names no experiment record of the reply, or more than one; and a verdict whose experiment record carries no mutation file digest. Storing starts no job and changes no stored run or discovery. (FR12, FR15)
- [ ] AC2: No evidence record holds an error message, a stack, a code frame, a definition's `old` or `new` text or a file's text: the reply's raw run records, which keep messages, and the texts of the job's own unhandled errors are never stored, and neither is any member of a judgement or of its facts that their types do not name. Every string a record holds is an identity or a digest the store was handed, a version, a value of a closed set, a module path, a project name, a suite or test name, a hook's name, a syntax node's kind and role, or an error's name, which the consumer's code chooses and which is stored as Vitest serialized it. (NFR6)
- [ ] AC3: A store at any schema version the opener migrates today opens migrated in place, holds evidence from then on, and reads its runs and discoveries as before. A new store holds evidence from its creation. The migrated store reads schema version 11, so an opener built for version 10 refuses it as it refuses any newer schema. Evidence one daemon life stored is read by the next. (FR15)
- [ ] AC4: A definition's digest changes when its id, any member of its resolved test identity (workspace path, project name, module path, name path, occurrence), its mutation's file, its `old` or its `new` changes, and with nothing else: not with the definition file it sits in, its position there, its `defect` or `required` text, or another spelling of the same module or mutation file. It is computed only for a definition that is valid and resolved, and holds none of the text it digests. (FR12, FR15)
- [ ] AC5: Evidence freshness is decided now and never stored (C114). A definition's stored evidence reads stale, naming each cause that holds, when: the definition's digest now differs from the record's; the digest of its mutation file's text now, as the anchor count reads that file, differs from the record's; the record's Vitest adapter version is not the current one; its falsifier version is not the current one; its Vitest version is not the one the latest stored discovery reports for the workspace of the definition's resolved test; or that workspace's current input fingerprint differs from the record's. The fingerprint's cause holds only when a current fingerprint can be computed. When no cause holds, it reads unknown, naming each reason that applies, when no current input fingerprint can be computed for that workspace, or when the resolved test is marked duplicate and the latest discovery is not current (C125); and current otherwise. For a file the anchor read accepts and nobody edited since the job read it, with a byte order mark or CRLF line endings as much as without, the job's digest and the query's are equal, so the mutation file's cause does not hold. So after a daemon restart no evidence reads current before that life's first reconciliation has ended. (FR15)
- [ ] AC6: Every definition in scope reads exactly one state. Invalid definition and anchor missing are decided as ticket 3.1 decides them, from the files as they are now, and win over any stored evidence. Every other definition reads the verdict of its stored evidence, with its evidence freshness as a field of its own that is present only beside a verdict (C119), or never verified when the store holds no evidence for its id. Stored evidence the store cannot read back whole reads as none: the definition reads never verified with a reason naming the refusal, and every other defect's evidence still reads (C30). Evidence stored under another falsifier version gives its verdict, its freshness and its causes, and nothing else of the record: no reason, detail or error names (C149). The stored evidence, the latest discovery and the latest runs an answer decides from are read from the store together, and only once the answer's file reads have ended (C150, C173). (FR13, FR22, FR24)
- [ ] AC7: The answer's counts give, over the definitions in scope: each state; each evidence freshness, over the definitions that read a verdict; each cause of staleness and each reason for unknown, a definition counted under every one that holds for it; how many definitions hold stored evidence the store could not read back, each such refusal also logged once while it stands (C32); eligible, the definitions that are neither invalid nor anchor missing and whose resolved test holds a current pass as the answer's own test standings rate it; and verified, the definitions that read detected with evidence freshness current. The total stays ticket 3.1's, every definition in scope plus every definition file problem, so an invalid entry and an invalid definition stay in what verified is read against (C139). Every count is complete whatever the listing bounds. An answer over a scope whose every definition reads detected with current evidence carries the same fields as one over a scope where none does: no field states a scope verified. (FR22)
- [ ] AC8: The answer lists the definitions in scope up to ticket 3.1's bound in this order: invalid definition, anchor missing, survived, invalid experiment, unclear, never verified, detected; within a state, evidence that is not current before current; then by file and position. It gives, for each state, how many it did not list. Each listed definition says whether it is eligible. Each listed definition that reads a verdict carries its evidence freshness; each cause when it is stale; each reason that applies when it is unknown; and, unless AC6 withholds them for a record of another falsifier version, its verdict's reason and detail where the verdict has one, and, for an unclear verdict whose reason is that an error is not an assertion, the kind and name of each error the intended test held in the experiment's run, up to a named bound, with the number not listed. (FR22)
- [ ] AC9: A client and a daemon on opposite sides of this change refuse each other with the protocol's existing version mismatch, so neither side reads the other's `defects` answer. `--json` documents keep their schema version, since fields and state values are only added. (FR22)
- [ ] AC10: `rt-test defects [path] [--root <dir>] [--json]` prints: the total and how many of it are definition file problems, worded correctly for a count of one; verified against the total, and eligible; each state's count; each evidence freshness count, with the count of each cause of staleness and of each reason for unknown, so a stale detection the text does not list is still explained; how many definitions hold evidence that could not be read; each definition file problem; each listed definition that is invalid or anchor missing, with its reason; each listed definition that reads survived, invalid experiment or unclear, with its reason, its detail, each listed error's kind and name and the number of errors not listed, its freshness, each cause when it is stale and each reason when it is unknown; each listed never verified definition that carries a reason, with it; for each state, how many the answer did not list; and the gap counts as before. For a scope whose every definition is verified it prints the same lines as for any other scope, differing only in their numbers and listed definitions: no line sums the scope up as passed or failed. A listed detected definition and a definition's eligibility are given under `--json`, which carries every field of the answer. (FR22)
- [ ] AC11: A definition whose test names a module the latest discovery lists as failed to collect reads invalid as not discovered, and its reason says that the module failed to collect in that discovery, so none of its tests is discovered. (FR24)
- [ ] AC12: `rt-test defects` loads neither `defects/resolve-definitions.ts` nor `falsify/anchor-match.ts`, and still loads no Vitest module, consumer config or test file: the state names and their order come from a module that reads no file. (FR22)

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

None: the ticket calls no third-party behavior this repository has not already exercised. The store's new table uses only what `packages/daemon/src/store/schema.ts` already uses (`STRICT` tables, a composite primary key, `CHECK` constraints), and replacing a defect's record is a `DELETE` and an `INSERT` inside the write transaction `inRecordWrite` opens. A build that chooses an upsert instead (`INSERT ... ON CONFLICT` or `INSERT OR REPLACE`) is the first use of that statement here: read it in the SQLite that Node 22.13 and Node 24 bundle first (P10), and record the answer under this table.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing; the table holds none unless the build chooses an upsert.
- [ ] (AC12) Create `defects/defect-states.ts`, importing nothing that reads a file: `DEFECT_STATE` (the evidence values taken from the verdict constants, not retyped, C3), `DEFECT_STATES` in AC8's order, `DefectState`, and the two sets `rt-test defects` prints as sections (AC10): the states of a definition that cannot run (invalid definition, anchor missing) and the verdicts that are not a detection (survived, invalid experiment, unclear). Export from `falsify/verdict.ts`, in place, only what this ticket reads in production (C59): the verdict constants, and the unclear reason constants, which the standings read to find a not-an-assertion verdict. Delete `DEFECT_STATE`, `DEFECT_STATES` and `DefectState` from `defects/resolve-definitions.ts` and repoint every reader: `resolve-definitions.ts` itself, `query/defects-answer.ts`, and the re-export in `client.ts`, through which `packages/cli/src/commands/defects.ts` reads them. Closure, two searches run at authoring (00:04 on 2026-10-01, at 25514fe6) and a floor to re-run. `git grep --untracked -c "DEFECT_STATE" -- packages docs README.md _agent-docs/sprints` printed `packages/cli/src/commands/defects.ts:5`, `packages/cli/test/defects.json:3`, `packages/daemon/src/client.ts:2`, `packages/daemon/src/defects/resolve-definitions.ts:9`, `packages/daemon/src/query/defects-answer.ts:4`, `packages/daemon/test/defects.json:3` and `_agent-docs/sprints/sprint-3-falsification.md:1`. The same command for `DefectState`, which the first pattern does not match, printed `packages/cli/src/commands/defects.ts:2`, `packages/daemon/src/client.ts:1`, `packages/daemon/src/defects/resolve-definitions.ts:3` and `packages/daemon/src/query/defects-answer.ts:9`. Classify every hit (C50): each production file is a reader repointed above, the sprint line names the move itself, and the `defects.json` hits are create-tests' (Dev Notes § Tests this change may break).
- [ ] (AC4, AC5, AC6, AC7, AC8) Create `defects/defect-standings.ts`: the definition digest, and one function that gives every resolved definition its standing (its state, its reason, its evidence freshness with its causes or its unknown reason, the judgement's reason and detail, the error names AC8 lists, whether it is eligible, and its definition digest when it is valid and resolved) from the resolved definitions, each definition's anchor read with the digest of the text it read, the stored evidence and its refusals, each workspace's current fingerprint digest, the Vitest version the latest discovery reports for each workspace, whether that discovery is current, and the test standings; and one function that counts standings as AC7 lists the counts, the causes, the unknown reasons and the unreadable records among them. Rate a fingerprint with `assessFreshness` from `@rt-test/core`, never a second comparison (C8). Keep every cause, every unknown reason and the error-name bound as named constants (C3). It reads no file and no store.
- [ ] (AC5) In `defects/resolve-definitions.ts`, make each anchor read carry the digest of the text it read, taken with `wholeDigest`, the function ticket 3.3b's job digests it with (C8), reading the file exactly as today (`readMutationFile`: UTF-8, a byte order mark kept, only a regular file), so a scoped query still reads each mutation's file once.
- [ ] (AC11) In `defects/resolve-definitions.ts`, make the not-discovered reason say when the latest discovery lists the definition's module among a workspace's `failedModules`. Edit around the anchored text of the defect records that file holds (Dev Notes § Tests this change may break counts them).
- [ ] (AC1, AC2, AC3, AC6) Add the evidence table to `store/schema.ts`, raise `STORE_SCHEMA_VERSION` to 11, and give every version in `STORE_MIGRATIONS` and version 10 a path that creates the table, each ending in `SET_SCHEMA_VERSION` as the others do. Create `store/defect-evidence.ts`: the write (bindings checked at run time as `requireBindings` checks a run's; one transaction through `inRecordWrite`; each record read back before commit, as `writeRun` reads its run back) and the read (every evidence record of a scope by defect id, and a refusal for each row it cannot rebuild, thrown as `UnreadableRecordError` and caught per row as `selectLatestRuns` catches a run's). A row whose falsifier version is not the current one is rebuilt from its bindings and its verdict alone: its reason, detail and facts are left unparsed, so a shape written under another version is never a refusal (AC6). Store each judgement by rebuilding the members its type names (the verdict, the reason, the detail and each member of the facts), never by serializing the object as handed, so a member the type does not name reaches no row (AC2). Rebuild down to the leaves: the facts hand on, as the job's record holds them, each `MutationLoad` with its `ProbeSite` or `NoProbeSite`, a not-run fact's `NoProbeSite`, the hook states and the `Reach`, so rebuild each of those by its own named members too (the hook states entry by entry, each a hook's name and its state), and a text-bearing member one of those types gains later reaches no row. Store the facts' optional `repeats`, a number, when it is present. Take the facts from the reply alone: build none from the reply's raw run records or from a stored record (Dev Notes § Design decisions). Pair each verdict with its experiment record by defect id, never by position. Store nothing of the reply's `experiments`, `baseline` or `restoredBaseline` beyond each record's mutation file digest. Stamp the adapter version from `VITEST_ADAPTER_VERSION`, as `writeRun` stamps a run's. Add `writeEvidence` to `RtTestStore`, and add the evidence and its refusals to `LatestResults`, read inside `readLatestResults`' one read transaction.
- [ ] (AC7) In `daemon/refusal-notes.ts`, log each evidence refusal once while it stands, as `RefusalNotes` logs a run's: `note` already receives the `LatestResults` the lifecycle reads, so `daemon/lifecycle.ts` does not change.
- [ ] (AC5, AC6) In `query/summary.ts`, give `QueryBasis` each workspace's current fingerprint digest from the `fingerprints` map `queryBasis` already composes, so the defects answer composes no second one. Change nothing a summary answer carries.
- [ ] (AC6, AC7, AC8) In `query/defects-answer.ts`, take the standings from `defects/defect-standings.ts` over the definitions in scope: the counts of AC7, the listing of AC8 in `DEFECT_STATES` order with the per-state numbers not listed, and each listed definition's evidence fields, every free-text field cut with `cutReason` (C170). Set the error-name bound so that a listing at `MAX_LISTED_DEFINITIONS`, every definition at its largest detail and at the bound, stays under the protocol's line limit, and record that arithmetic in the Completion Notes. Sort a copy (C20). Keep the moment where it is, after the last awaited read (C173).
- [ ] (AC9) Raise `PROTOCOL_VERSION` in `daemon/protocol.ts` by one, and export the new answer types and the state constants from `client.ts`.
- [ ] (AC10) Extend `packages/cli/src/commands/defects.ts`: the counts lines, worded for a count of one; the verified, eligible and freshness lines, with the count of each cause and each unknown reason and of the unreadable records; a section for the listed definitions that read survived, invalid experiment or unclear, each with its reason, its detail, its listed errors and the number not listed, its freshness, each cause when it is stale and each reason when it is unknown; a never verified definition's reason; and the not-listed line over every state. Print a reason's detail by naming each of its members, so a new reason needs no new wording.
- [ ] (Support) Report to the orchestrator the `docs/architecture.md` text for § Results store (the evidence record, its bindings, schema version 11 and its migration), § Defects query (the states, evidence freshness and its causes, the counts, the order) and § Execution and falsification isolation (falsification's evidence is stored, and by which call), the README text for `rt-test defects`, and each known limit the build confirms or adds; write none of it yourself. The ADR-0007 sentence, the glossary terms and the sprint text for ticket 3.5 went to the orchestrator with this ticket (Dev Notes § Doc text reported at authoring); report only what the build makes differ from them.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `assessFreshness(fingerprint, currentFingerprint)` (`packages/core/src/evidence.ts`): current, stale or unknown for a stored digest against a current one, unknown when either is absent or empty. The one comparison ordinary results use (`recordFreshness` and `storedFreshness` in `packages/daemon/src/query/test-states.ts`).
- `isCurrentAdapterVersion`, `fingerprintDigest`, `CurrentFingerprints` and `TestStanding` (`packages/daemon/src/query/test-states.ts`): the adapter version check, a computed fingerprint's digest, the by-workspace reader of current fingerprints, and a test's state and freshness, from which a current pass is read (`state` passed, `freshness` current).
- `CURRENT`, `STALE`, `UNKNOWN`, `FRESHNESS_VALUES`, `FreshnessCounts`, `CutReason`, `AnswerContext`, `NoAnswer` (`packages/daemon/src/query/answer.ts`).
- `queryBasis`, `cutReason`, `QueryBasis` (`packages/daemon/src/query/summary.ts`): the basis already holds `standings`, `discovery` and the context; its `fingerprints` map is local to `queryBasis` today.
- `VITEST_ADAPTER_VERSION` (`packages/daemon/src/vitest/adapter-version.ts`) and `FALSIFIER_VERSION` (`packages/daemon/src/falsify/experiment-record.ts`).
- From ticket 3.3 as landed (`main` at 45f92eb6, read at 02:00 on 2026-10-01): `Judgement` and the private `VERDICT`, `INVALID_REASON`, `UNCLEAR_REASON` and `NO_VERDICT_REASON` (`falsify/verdict.ts`); `ExperimentFacts`, `TestFacts`, `ErrorFact`, `ERROR_KIND` (`falsify/fact-types.ts`); `ExperimentJudgement`, `ExperimentRecord`, `FalsificationJob` (`falsify/experiment-record.ts`); and the types the facts hand on, `MutationLoad` (`falsify/mutation-transform.ts`), `ProbeSite` and `NoProbeSite` (`falsify/reach-probe.ts`) and `Reach` (`falsify/experiment-record.ts`). Derive the stored judgement's type from `Judgement` (C14).
- `wholeDigest(content)` (`packages/daemon/src/inputs/input-inventory.ts`, exported, SHA-256 as hex): the function ticket 3.3b's job digests each mutation file's text with. Digest the anchor read's text with the same function and no other (C5, C8).
- `testIdentityKey`, `TestIdentity` (`packages/core/src/test-identity.ts`): the five members AC4 names, and their one key.
- `relativePosixPath`, `POSIX_SEPARATOR` (`packages/daemon/src/vitest/find-workspaces.ts`): a root-relative `/`-separated path for the mutation's file in the digest. `CheckedDefinition.mutationPath` is absolute and `modulePath` is already root-relative.
- `readAnchors`, `AnchorReads`, `ResolvedDefinition`, `resolveDefinitions`, the private `readMutationFile` and `notDiscoveredReason` (`packages/daemon/src/defects/resolve-definitions.ts`); `workspaceTestModules`, `testModuleFile` (`packages/daemon/src/inputs/non-inputs.ts`), which already names a failed module by the same root-relative path.
- The store's own pieces: `inRecordWrite`, `inRecordRead` (`store/transaction.ts`); `requireScope`, `StoreScope`, `fingerprintColumns` (`store/stored-records.ts`); `Row`, `text`, `optionalText`, `integer`, `json`, `member`, `UnreadableRecordError`, `unreadable` (`store/columns.ts`); `STORE_MIGRATIONS`, `SET_SCHEMA_VERSION`'s pattern (`store/schema.ts`); the read-back in `writeRun` (`store/write-run.ts`) and the per-record refusal in `selectLatestRuns` (`store/read-runs.ts`).
- `answerFields`, `contextLines`, `cutReasonText`, `joinLines`, `INDENT`, `LIST_SEPARATOR` (`packages/cli/src/answer-text.ts`) and `oneLine`, `reported` (`packages/cli/src/output.ts`).
- For create-tests: `RecordingStore` (`packages/daemon/test/scheduling-harness.ts`), `defectsOver` and the hand-built `LatestResults` builders in `packages/daemon/test/query.test.ts`, and the real-store helpers in `packages/daemon/test/store.test.ts`.

### Must Create

- `packages/daemon/src/defects/defect-states.ts`: the seven state names, their order, and the problem states.
- `packages/daemon/src/defects/defect-standings.ts`: the definition digest, the standing of each definition, and the counts.
- `packages/daemon/src/store/defect-evidence.ts`: the evidence record's write and read.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### What the criteria rest on

FR12: "Read defect definitions committed at a configurable location in the consumer repository, attribute evidence by stable test identity including each `it.each` arm, and keep evidence in the local state directory." The digest of AC4 covers the whole test identity, so evidence for one `it.each` arm never serves another.

FR15: "Mark defect evidence stale when its test, mutation, inputs, or execution configuration change, keep it across a daemon restart, and re-verify it at lower priority than ordinary tests." This ticket marks and keeps; ticket 3.5 re-verifies.

FR22: "Answer a `defects` query through the CLI with versioned `--json` output, giving each defect definition's evidence state, its freshness and reason, the verified, eligible and total counts, and the gaps, without starting a test."

FR13: "Report a defect whose mutation anchor is missing as anchor missing, count it in the denominator, and withhold verified while the other defects still run." FR24: "Report a defect definition that cannot be applied as written as invalid, naming why (an unreadable file, a repeated id, a test not discovered or named ambiguously, a mutation that changes nothing, a file outside the consumer root), count it in the denominator, and withhold verified."

NFR6: "Leave every consumer file byte-identical through falsification, writing no mutation anywhere on disk." A stored `old`, `new`, code frame or diff would write the mutation to disk in the store.

ADR-0007: "An experiment's evidence is bound to the definition's digest (its id, test identity and mutation), the workspace's input fingerprint the experiment ran at (the one its ordinary results use), the Vitest version and the falsifier version; a change to any of them makes it stale. An experiment whose inputs moved while it ran stores nothing." And its known limit: "Evidence freshness has workspace granularity, so any change to a workspace's inputs stales every defect in it until file-level dependencies (M3) narrow it." The orchestrator added two bindings to these four at 23:45 on 2026-09-30: the mutation file's text and the Vitest adapter version (§ Questions to the orchestrator).

ADR-0004: "Commit defect definitions in the consumer repository at a configurable location, and keep defect evidence in the local state directory, `.rt-test/` by default". Its rejected alternative: "committed evidence, which is machine-bound, churns on every run, and would read as current on a checkout whose inputs differ."

`docs/architecture.md` § State dimensions gives "Defect evidence" the values "Detected, survived, invalid experiment, unclear, anchor missing, invalid definition, never verified" and "Evidence freshness" the values "Current, stale, unknown", as separate dimensions. § Identity and freshness: "On startup, mark old results unconfirmed until reconciliation finishes. An unknown input set cannot yield a current pass."

Glossary, verbatim: **Defect evidence**: "A falsification verdict bound to its test, mutation, inputs, and configuration." **Eligible defect**: "A defect whose definition is valid, whose anchor matches, and whose test holds a current pass, so it can be falsified now." **Verified**: "Every defect definition in scope has current evidence that its test detects it." **Current pass**: "A passed outcome whose freshness is current." **Freshness**: "Whether a result still describes its test's current inputs." **Survivor**: "A mutation its intended test did not reject." **Invalid experiment**: "An experiment whose run cannot say whether the test rejects the mutation, such as one whose test failed in a hook or never executed the mutated site." **Unclear experiment**: "An experiment whose test failed in its own body with an error that is not an assertion, failed beside an unhandled error, or failed at an assertion and then did not fail the same way in its confirming run." **Test identity**: "The stable name RT Test gives one test: its Vitest workspace, Vitest project, module path, suite and test names, and its position among tests sharing those names."

#### The interface ticket 3.5 calls

Ticket 3.5 schedules the job; this ticket gives it the write, the definition digest and the standings, and nothing else. The orchestrator accepted this interface at 23:45 on 2026-09-30 (F1).

- **The write**: `writeEvidence(bindings, job, definitionDigests)` on `RtTestStore`. `bindings` is the store scope (`projectIdentity`, `worktreeIdentity`) and the digest of the workspace's input fingerprint the job ran at. A digest is required: ticket 3.5 calls nothing when the inputs moved, since ADR-0007 stores nothing then. `job` is the reply `Executor.falsify` returns as its `value`, whole, when it reads `ran`; the store takes from it the Vitest version, the falsifier version, each judgement and each experiment record's mutation file digest, and nothing else. It stores no workspace path: a record's workspace is the one in its definition's resolved test identity, which the definition digest covers. The store stamps the adapter version itself, as `writeRun` does (`adapterVersion: VITEST_ADAPTER_VERSION` in `store/write-run.ts`), since the daemon and its executor process are one build. `definitionDigests` maps each defect id to the definition digest of the definition its experiment was built from.
- **The definition digest**, from `defects/defect-standings.ts`: ticket 3.5 takes each digest from the standing of the definition it builds an experiment from, so the digest stored is the digest of what ran.
- **The standings**, from the same module: per definition, its state, its evidence freshness and whether it is eligible. Ticket 3.5 picks, per workspace, the eligible definitions that read never verified or whose evidence freshness is not current from them, so "eligible" and "current" are each answered once (C8).

The write has no production caller until ticket 3.5 lands, as ticket 3.2's `Executor.falsify` has none today (`git grep -n "\.falsify(" -- packages/daemon/src packages/cli/src` printed nothing and exited 1 at 45f92eb6, 02:05 on 2026-10-01). Until then it is exercised by this ticket's tests over a real `node:sqlite` store, and every test that needs stored evidence in a real store seeds it through the write and never through SQL, so the writer and the reader of one record are proven together (C9, C59); a query test over a hand-built `LatestResults` hand-builds its evidence members as it does the others. The digest and the standings are called in production by the `defects` answer from this ticket on.

#### Design decisions (scope of analysis: storing, binding and answering evidence; scheduling, the canary gate and the summary are unanalyzed here)

- **One record per defect id per worktree, replaced.** This repository's own catalog holds about 2,480 defects, and a judgement's facts are about 1.5 KB as JSON (estimated from `fact-types.ts`; unmeasured). Workspace granularity re-verifies a whole workspace after each edit, so appending would grow the store by megabytes per round. A new verdict replaces the old one; a judgement with no verdict leaves it, and the old record reads whatever its bindings give now: stale when one changed, and current again when none differs.
- **Stale evidence shows its last verdict.** FR15 marks evidence stale; it does not erase it. Verified counts only detected with freshness current, so a stale detection never counts.
- **The bindings are compared at read time.** Every cause that holds is named. Five need no fingerprint (definition digest, mutation file digest, adapter version, falsifier version, Vitest version); the fingerprint's holds only when a current one can be computed and differs. Only when no cause holds can the evidence read unknown, so an unavailable fingerprint never hides a cause that is certain, as `storedFreshness` reads a run under another adapter version stale whatever its fingerprint. A resolved test always lies in a workspace the discovery reports as `discovered`, whose entry always carries `vitestVersion` (`WorkspaceDiscovery` in `packages/daemon/src/vitest/discover-tests.ts`), so the Vitest version cause never compares with an absent value. The workspace's fingerprint already digests the workspace's resolved Vitest version, the adapter version, the runtime and the environment (`workspaceFingerprint` and `sharedParts` in `packages/daemon/src/inputs/fingerprint.ts`), so the explicit version comparisons only name a cause the fingerprint would also catch.
- **The mutation file digest closes what the fingerprint leaves out.** A file the consumer declares a non-input in `rt-test.json` is in no fingerprint. Edited so that `old` still occurs once, it would leave a detection reading current. The job records a digest of the text it read (ticket 3.3b), this ticket stores it, and the query, which already reads that file for the anchor count, compares it. It costs no extra staleness where the fingerprint covers the file, since both then change together.
- **The digest is of the text read when the job started.** Ticket 3.3b takes it from the one read `FalsificationRuns` makes of each mutated file before any run. A file edited later in the job reads stale for as long as the edit stands, the safe direction; one edited and restored byte for byte within the job reads current, a known limit (§ Known limits). Every judgement that has a verdict comes from an experiment whose file was read: a run, or a reason decided with the text in hand (no probe site, in `startCheck`; no module and baseline did not pass, after it); the unreadable file reads no verdict. So AC1's refusal of a verdict without a mutation file digest guards a broken reply, not a case a job produces. The job reads with `readFileSync(file, "utf8")` and the query with `readFile(path, "utf8")`, both keeping a byte order mark, so `wholeDigest` over the string, which ticket 3.3b's job calls, gives equal digests for an unedited file.
- **Restart needs no code of its own.** Before a life's first reconciliation ends, `currentInputs` answers every `workspaceFingerprint` with not ok (`unavailableReason` in `packages/daemon/src/inputs/current-inputs.ts`), so `assessFreshness` gives unknown. Evidence is in SQLite and survives the process.
- **A positional test.** A definition that names one of several same-named tests by its occurrence resolves against the latest stored discovery. While that discovery is not current its positions are not vouched for, so the evidence reads unknown, as an ordinary result does (`positionUnvouched` in `query/test-states.ts`).
- **Counts only.** The answer never carries a flag that says a scope is verified; a reader compares verified with the total, which holds every invalid entry and invalid definition. A scope with no definition has a total of 0 and a verified of 0.
- **Eligible is independent of evidence.** A defect that reads detected and current is still eligible by the glossary; the job ticket 3.5 schedules covers the eligible defects whose evidence is not current.
- **Facts are stored whole and answered in part.** The answer carries a verdict's reason and detail, and for a not-an-assertion reason the errors of the intended test in the experiment's run (`facts.run.test.errors`, each a kind and an optional name), since ticket 3.3's judgement gives that reason no detail and a consumer must learn the name to declare it in `assertionErrors`. Carrying the facts whole would add about 750 KB to a 500-definition listing (500 times the 1.5 KB estimated above), against the protocol's 1 MiB line limit. What the answer does carry for each listed definition is unmeasured; the error-name bound is set from that arithmetic at build time.
- **The facts are the reply's, built once in the executor.** `experimentFacts` builds them from the job's raw run records before the reply leaves the executor process, and the store keeps what the reply carries. Nothing rebuilds a fact from a stored record: the store keeps no run record, and a run record's `unhandledErrors` and `unhandledErrorModules` are two lists aligned by index, the second of which `baselineFacts` counts from, so a record kept with a shorter second list would read a baseline cleaner than it was. The facts hand on `MutationLoad`, `NoProbeSite`, the hook states and the reach as the record holds them, so a text-bearing member added to one of those types would enter the stored facts unless the store rebuilds them by their named members too, which the store task requires (AC2). `TestFacts` holds an optional `repeats`, present only when above zero; it is a number, so AC2's classes of stored strings are as they were.
- **A `ran` job given no experiment carries an empty `judgements` list.** The write stores nothing for it and throws nothing, since AC1 refuses none of what it holds. A job that does not read `ran` carries no `judgements` member at all, so the write reads that member only once it has checked the status.
- **The text lists problems, and counts the rest.** After one edit every detection of a workspace reads stale, so the human output lists no detected definition; it prints the count of each cause of staleness and each reason for unknown instead, and `--json` carries each listed definition whole, its eligibility included (decided by this session at 00:05 on 2026-10-01 after the ticket review, reported to the orchestrator).
- **Another falsifier version's record is not interpreted.** Its verdict is one of the four evidence values `docs/architecture.md` § State dimensions fixes (quoted under § What the criteria rest on), and a value that is none of them makes the record unreadable; its reason, detail and facts were written under another meaning, so they are not read (C149). It always reads stale.
- **An unreadable record is never a verdict.** It reads as no evidence, with the refusal as the definition's reason, and the next verdict replaces it. Never verified sorts late in the listing, so the refusal is also counted in the answer and logged, as a refused run is.
- **Evidence rides in `LatestResults`.** The defects answer already takes its moment after its last awaited read, and the moment's `results` are one read transaction. The lifecycle's `defects()` and `#moment()` stay as they are, which matters because `daemon/lifecycle.ts` holds 498 of its 500 code lines. Every other query then reads the evidence rows too; that read is unmeasured.
- **The protocol version rises** rather than `queryDefects` checking fields. A mismatched hello gets `VERSION_MISMATCH_CODE` from `daemon/server.ts`, which already names both versions. `CLI_JSON_SCHEMA_VERSION` in `packages/cli/src/output.ts` stays 1.
- **The store schema goes from 10 to 11.** No evidence exists before this ticket, so every migration only creates the table.
- **AC11 names one cause.** The reason names a module the discovery lists as failed to collect. A typecheck module is also listed without tests; it keeps today's reason, since the note this criterion comes from names only the failed module. Ticket 3.1's Review Record: "A definition naming a test in a module that failed to collect reads invalid as not discovered, the reason saying the discovery lists the module and not that it failed to collect". The sprint file at 25514fe6, § Ticket 3.4: "A definition naming a test in a module that failed to collect reads invalid as not discovered; name that cause in the reason when extending the answer (3.1's review)."

#### Known limits (each entry says what it reads)

- Evidence freshness has workspace granularity (ADR-0007): an edit anywhere in a workspace's inputs reads every defect of that workspace stale.
- Any edit to a mutation's file, a comment included, reads its defects stale by the mutation file digest.
- Evidence for a definition since removed stays in the store, bounded by the ids ever stored. It answers nothing, since only a definition in scope reads evidence.
- An error's name is stored as Vitest serialized it, uncut. A name is the consumer's own identifier; no realistic one carries source text.
- A query other than `defects` also reads the evidence rows with the latest results. Unmeasured; ticket 3.5 decides what the daemon keeps between queries.
- A file other than the mutation's own that the workspace's fingerprint leaves out, such as a test helper the consumer declared a non-input, stales neither the test's ordinary result nor its evidence when it is edited. The test's own module is never such a file: `workspaceFingerprint` digests every test module the discovery lists, whatever is declared or ignored. The orchestrator ruled the ordinary result's hole outside this ticket (23:45 on 2026-09-30), and that evidence shares it for such a file until M3's file-level dependencies is this recorded limit (00:09 on 2026-10-01).
- A declared non-input file a defect mutates, edited and restored byte for byte inside one job's run, reads current, though a run of that job was served other text: the digest is of the text the job read when it started, and no change event comes for a file outside the workspace's inputs. It needs a consumer's false declaration, and the wider hole of that declaration is the limit above, recorded until M3's file-level dependencies (the orchestrator, 00:20 on 2026-10-01).

#### Questions to the orchestrator

Asked at 23:42 on 2026-09-30; decided by the orchestrator at 23:45, restated at 23:47.

- Sizing: split. This ticket keeps the number; ticket 3.4b (`3-4b-summary-defect-counts`) carries the summary's defect counts, after 3.5 and before 3.7.
- F1, the store's write with no production caller before 3.5: accepted as written above.
- F2, one record per defect id per worktree, replaced, no history: accepted.
- F3, stale evidence shows its last verdict with its causes; verified counts only detected with freshness current; invalid definition and anchor missing win over a stored verdict: accepted.
- F4, the Vitest adapter version as a binding (C122, C124): accepted.
- F5, counts only, no verified flag: accepted.
- F6, answers carry the reason and detail, and the error kinds and names for not-an-assertion: accepted.
- F7, the listing order of AC8: accepted.
- F8, a duplicate-marked test's evidence reads unknown while the discovery is not current: accepted.
- F9, evidence as wide as the fingerprint, recorded as a known limit: overruled. "Evidence is also bound to a digest of the mutation file's text as the job read it. 3.4 adds that digest to the job's experiment record (it builds after 3.3 lands, so it may edit falsify/experiment-record.ts and falsify-workspace.ts for this one additive field and raise FALSIFIER_VERSION), stores it, and the defects query reads evidence stale with the cause "mutation file changed" when the file's text digest differs. Reason: a detected verdict reading current after the mutated file was edited is stale evidence reported as current, and that exception is absolute."
- Accepted as this session decided them: protocol version raised, CLI schema version kept; the Vitest version compared with the latest discovery's; an unreadable record reads never verified; a record under another falsifier version shows its verdict stale with no reason or detail; schema 10 to 11 with a migration; removed definitions' evidence kept; evidence read in the same transaction as the latest discovery and runs.

Asked at 00:07 on 2026-10-01, after the ticket review; decided by the orchestrator at 00:09.

- Sizing at 33 estimated, past the 30-file limit: split. The record's digest and the `FALSIFIER_VERSION` raise became ticket 3.3b (`3-3b-mutation-file-digest`), landing after 3.3 and before this ticket: "A record field with no reader yet is acceptable here, as 3.2's record was." This ticket stores the digest 3.3b's record carries and compares it.
- Accepted as this session decided them after the review: the counts carry each cause of staleness and each unknown reason, with listed detections and `eligible` in `--json` only; the store pairs a verdict with its record by defect id; the store stamps the adapter version itself; an unreadable evidence record is counted and logged through `RefusalNotes`; the unknown reasons are a list.
- Evidence for a test whose helper file the fingerprint leaves out: recorded as the known limit above, with no amendment.

Asked at 00:17 on 2026-10-01, with ticket 3.3b's handoff; decided by the orchestrator at 00:20.

- A declared non-input file a defect mutates, edited and restored byte for byte inside one job's run: a known limit, named under § Known limits and in ticket 3.3b's design decisions.

Asked by the orchestrator at 01:57 on 2026-10-01, once ticket 3.3 had merged at 45f92eb6; amended by the author at 02:06.

- Ticket 3.3's review changed the judgement and the facts this ticket was written against: the invalid reason `test-repeated` (detail `repeats`, a number) directly after `hook-not-passed`, and the optional `repeats` on a recorded test and on `TestFacts`. The reasons a stored judgement can carry, the store task, the notes on ticket 3.3 and the counts are restated for 45f92eb6. No criterion changed, and the sizing stands at 21 raw files and 28 estimated.

#### Ticket review

One review agent read the ticket and its bound rules at 23:54 on 2026-09-30 and returned 30 findings, applied except as listed here. Not applied as worded:

- The adapter version handed in with the bindings (finding 27): the store stamps `VITEST_ADAPTER_VERSION` itself, as `writeRun` does for a run, since the daemon and its executor process are one build. AC1 and AC2 now say where the version comes from.
- A missing adapter version as a refused write (part of finding 18): for the same reason, there is none to be missing; a reply without a Vitest version or a falsifier version is refused.
- The fingerprint compared only when no other cause holds (finding 10): AC5 stood, and the Dev Note was corrected instead, so every cause that holds is named.
- A pairing check by position (finding 26): the store pairs a verdict with its record by defect id, and refuses an id that names no record or several.

Settled by fact: a resolved test's workspace always reports a Vitest version (finding 5); every verdict comes from an experiment whose file was read (finding 25); the Execution Metadata block is filled at finalize (finding 30). One finding went to the orchestrator, who kept it a known limit: evidence for a test whose helper file the fingerprint leaves out (finding 23).

#### Pending siblings

- 3.3 (done, on `main` at 45f92eb6) created `falsify/verdict.ts`, `falsify/fact-types.ts` and `falsify/run-facts.ts` and wrote `falsify/experiment-record.ts` and `falsify/falsify-workspace.ts`. Its review's fix is in that commit: the invalid reasons hold `test-repeated`, a recorded test and `TestFacts` hold the optional `repeats`, and `FALSIFIER_VERSION` is 2. This ticket is written against that commit.
- 3.3b (ready-for-dev) gives each experiment record its mutation file digest and raises `FALSIFIER_VERSION` from 2 to 3. This ticket builds only after it lands, reads that member and the version from the reply, and edits neither `falsify/experiment-record.ts` nor `falsify/falsify-workspace.ts`.
- 3.2b (ready-for-dev, building in Tree 2) writes `falsify/reach-probe.ts` and `falsify/probe-slots.ts` and creates `falsify/change-pair.ts` and `falsify/probe-placements.ts`. It writes none of this ticket's files. `falsify/reach-probe.ts` holds `ProbeSite` and `NoProbeSite`, which the stored facts carry: read both as `main` holds them when this ticket builds, and rebuild only the members AC2's classes of strings allow.
- 3.5 (backlog) calls the write, the digest and the standings above, reads `readMutationFile`'s way of reading a file, and writes `daemon/lifecycle.ts`, which this ticket does not edit.
- 3.4b (backlog) puts the counts of AC7 in the summary, from `defects/defect-standings.ts`, after 3.5.
- 3.6 (backlog) keeps a canary result per Vitest and falsifier version, in a record of its own; it reads and writes no evidence record.
- 3.7 (backlog) replays the milestone's acceptance, a weakened assertion retiring earlier evidence and the exact verified and eligible counts among them, over this ticket's store and answer.
- 3.8 (backlog) reads `defects` answers in place of proofs, so the states, the freshness field and the counts this ticket fixes are the ones a lane reads.

#### Current structure of the modified files

Code lines are by `grep -cv '^\s*$\|^\s*//\|^\s*/\?\*' <file>`, which leaves out blank and comment lines, at 45f92eb6 (02:01 on 2026-10-01).

- `packages/daemon/src/store/schema.ts` (165 code lines): `STORE_SCHEMA_VERSION = 10`; `STORE_SCHEMA` creates `runs`, `run_modules`, `run_tests`, `discoveries`, `discovery_workspaces` and `discovered_tests`, each `STRICT`; `STORE_MIGRATIONS` maps versions 1 to 9 to statements ending in `SET_SCHEMA_VERSION`.
- `packages/daemon/src/store/open-store.ts` (198): `RtTestStore` (`writeRun`, `writeDiscovery`, `readRuns`, `readRun`, `readLatestDiscovery`, `readLatestResults`, `close`); `LatestResults extends LatestRuns` with `discovery` and `discoveryRefusal`; `readLatestResults` reads inside one `inRecordRead`; the store handle delegates each method to a module of its own.
- `packages/daemon/src/defects/resolve-definitions.ts` (239): `DEFECT_STATE` (three values), `DEFECT_STATES`, `readAnchors` (one read of each mutation's file, through `readMutationFile`), `resolveDefinitions` and `notDiscoveredReason`, whose `index.modules` already holds failed and typecheck modules but not which is which.
- `packages/daemon/src/query/defects-answer.ts` (253): `defectsAnswer` awaits `readDefinitionFiles` and `readAnchors`, then takes `query.moment()` and resolves without awaiting again; `DefectCounts` (`total`, `states`, `invalidEntries`); `ListedDefinition`; `listedDefinitions` sorts by `DEFECT_STATES.indexOf`, then file, then position, and slices to `MAX_LISTED_DEFINITIONS` (500).
- `packages/daemon/src/query/summary.ts` (355): `queryBasis` composes `fingerprints` once and hands `testStandings` a reader over it; `QueryBasis` holds `discovery`, `latestRuns`, `refusedRuns`, `standings`, `notDiscovered` and `context`.
- `packages/daemon/src/daemon/refusal-notes.ts` (36): `RefusalNotes.note(results)` logs the latest discovery's refusal once, and each workspace's run refusal once per reason; the lifecycle's `#latestResults` calls it on every read.
- `packages/daemon/src/daemon/protocol.ts` (259): `PROTOCOL_VERSION = 4`; `DefectsResponse = DefectsAnswer & { type; protocolVersion }`.
- `packages/daemon/src/client.ts` (458): re-exports `DEFECT_STATE`, `DEFECT_STATES` and `DefectState` from `./defects/resolve-definitions.js`, and four types from `./query/defects-answer.js`.
- `packages/cli/src/commands/defects.ts` (139): `PROBLEM_STATES` is every state but never verified; `defectCountLines` prints "of which N are definition file problems"; `notRunnableLines` prints the listed problem states under "Definitions that cannot run:" and the per-state numbers not listed.
- `packages/daemon/src/falsify/verdict.ts` (431): holds `VERDICT`, `NO_VERDICT_REASON`, `INVALID_REASON` (14 reasons, `test-repeated` among them) and `UNCLEAR_REASON` as private constants and exports `Judgement`, `judge` and `isWouldBeDetection`; it imports only `./fact-types.js` at run time, and that module imports only types.
- Not edited by this ticket, read by it: `packages/daemon/src/falsify/experiment-record.ts` holds `FALSIFIER_VERSION = 2`, `ExperimentRecord` (a `ran` member and a `not-run` member), `ExperimentJudgement` (`Judgement & { defectId; facts }`) and `JudgedJobFacts`, which gives a `ran` job its `judgements` and a job of any other status none. Ticket 3.3b adds the mutation file digest to both members of `ExperimentRecord` and raises the version to 3.

#### Tests this change may break

- A hand-built `LatestResults` needs the evidence members wherever a test builds one: `packages/daemon/test/query.test.ts`, `changes.test.ts`, `waits.test.ts`, `lifecycle.test.ts` and `RecordingStore.readLatestResults` in `scheduling-harness.ts`, which also needs `writeEvidence`. Found with `git grep -c "discoveryRefusal" -- packages` over the test tree (23:40). The typecheck finds each (P14).
- D2691 (`packages/daemon/test/defects.json`) builds a `LatestResults` literal in its `new` text, which no typecheck reads (C38): it needs the evidence members, and re-proving.
- D3732 (`packages/daemon/test/defects.json`) anchors the `DEFECT_STATES` list in `defects/resolve-definitions.ts`, which moves and grows; D3695 anchors the listing's sort in `query/defects-answer.ts`; D3704 anchors `PROBLEM_STATES` and D3730 calls `defectCountLines` in `packages/cli/src/commands/defects.ts`. Each needs re-anchoring or rewriting, and re-proving.
- Records anchored in the files this ticket edits, at 45f92eb6 (02:01 on 2026-10-01), each count by `cat packages/daemon/test/defects.json packages/daemon/test/*/defects.json packages/cli/test/defects.json | grep -c '"file": "<path>"'`: `store/schema.ts` 22, `store/open-store.ts` 17, `defects/resolve-definitions.ts` 16, `query/defects-answer.ts` 18, `query/summary.ts` 46 (44 in the daemon's file and 2 in the CLI's), `daemon/protocol.ts` 6, `packages/cli/src/commands/defects.ts` 5, `client.ts` 12, `daemon/refusal-notes.ts` 9 and `falsify/verdict.ts` 34. None of the 34 anchors the declaration line of `VERDICT` or of `UNCLEAR_REASON`, or a member line of either, so exporting the two in place breaks no anchor at that commit. Edit around their anchored text, and list any record whose anchor an edit breaks under the Dev Handoff.
- `packages/daemon/test/store.test.ts` names `STORE_SCHEMA_VERSION` 10 times and `lifecycle.test.ts` 2 times (`grep -o 'STORE_SCHEMA_VERSION' <file> | wc -l` at 45f92eb6, 02:05 on 2026-10-01); a test that writes a literal 10 as "the current version" or opens a version-10 store as current changes.
- The protocol-version tests read `PROTOCOL_VERSION` and send `PROTOCOL_VERSION + 1` or `- 1` (`docs/testing.md` § What the daemon is doing in every answer), so the raise breaks none.
- `packages/cli/test/defects-command.test.ts` scripts whole `defects` answers; each needs the new counts and fields.

#### Previous-ticket intel

3.3 (done, on `main` at 45f92eb6), Completion Notes: "The verdict and reason constants are not exported, since nothing in production reads them yet (C59); 3.4 exports what it reads." "No verdict is a judgement with no `verdict` member." The reasons a stored judgement can carry are, for invalid experiment, `no-probe-site` (detail `site`), `no-module`, `baseline-not-passed` (detail `state` and `mode`, absent when the baseline did not report the test), `baseline-not-clean`, `restored-baseline-not-passed`, `restored-baseline-not-clean`, `run-not-clean`, `module-failed`, `suite-error` (detail `suite`), `test-not-run` (detail `state`), `hook-not-passed` (detail `hook` and `state`), `test-repeated` (detail `repeats`, a number), `site-not-executed` (detail `mutation`, and `occurrences` when not applied), `reach-unknown` (detail `cause`); and for unclear, `not-an-assertion`, `unhandled-error`, `confirming-run-differed` (detail `confirming`, a nested reading), `next-run-unclean`, `job-unclean`. A failed test that declares repeats, its own, a suite's or the project's, reads invalid experiment as `test-repeated`; a passed one still reads survived. Its build measured that a job's serialized judgements hold no message or stack. `experimentFacts` already refuses a reply whose records do not pair one for one, in order, with its experiments. The store does not lean on that order: it pairs a verdict with its record by defect id (AC1).

3.3's Review Record, § For the tickets that follow: "Each experiment's facts hold both baselines' reading of its own test, so a job's judgements repeat nothing between experiments but carry two baseline readings each. The facts pass `MutationLoad`, `NoProbeSite`, hook states and reach through as the record holds them, so a text-bearing member added to one of those types would enter the stored facts. A `ran` job given no experiment carries an empty list of judgements. Facts are built once, in the executor; rebuild none from a stored record (see the two aligned lists above)." Among its tech debt: "A `{ type: "falsified" }` message with no `job`, which only the consumer's own code calling `process.send` inside the executor process could send, settles the job, and `Executor.falsify` in `packages/daemon/src/daemon/executor.ts` returns `{ ended: true, value: undefined }`, an outcome shaped like success with nothing in it, which ticket 3.4 would be handed." AC1 refuses a reply that does not read `ran` and names what is missing, so the write's run-time check holds for a value that is no object at all.

3.1 (done): the `defects` answer takes its moment only after its file reads (review fix, C173); a definition whose module the latest discovery does not list lies in every scope (ruling Q-B); each usable pattern that matches nothing is an invalid entry (ruling Q-A); `lifecycle.ts` holds 498 code lines.

Since 3.2's merge the only commit on `main` under `packages/daemon/src/store`, `packages/daemon/src/query`, `packages/daemon/src/defects` or on `packages/cli/src/commands/defects.ts` is 3.1's debt change: `git log --oneline 57e56d28..HEAD` over those four paths printed f8a16ec9 alone at 45f92eb6 (02:05 on 2026-10-01).

#### Doc text reported at authoring

Sent to the orchestrator with the handoff, for files this lane does not edit: ADR-0007's binding sentence with the mutation file's text and the adapter version; the glossary's Evidence freshness and Definition digest; the write interface for the sprint file's § Ticket 3.5; and the marker of FR5 for ticket 3.4b.

#### Sizing

21 raw files and 28 estimated (21 times 1.3 is 27.3), unchanged by ticket 3.3 as landed at 45f92eb6; code units 13 (12 criteria plus validation). Production, modified: `store/schema.ts`, `store/open-store.ts`, `defects/resolve-definitions.ts`, `query/defects-answer.ts`, `query/summary.ts`, `falsify/verdict.ts`, `daemon/protocol.ts`, `daemon/refusal-notes.ts`, `client.ts`, and `packages/cli/src/commands/defects.ts`. Production, created: `defects/defect-states.ts`, `defects/defect-standings.ts`, `store/defect-evidence.ts`. Tests, for create-tests: `store.test.ts`, `query.test.ts`, `defects/definitions.test.ts`, `packages/cli/test/defects-command.test.ts`, and the `defects.json` beside each (`packages/daemon/test/`, `packages/daemon/test/defects/`, `packages/cli/test/`). This ticket's file. Beside that count, one mechanical sweep: the evidence members on each hand-built `LatestResults` in `changes.test.ts`, `waits.test.ts`, `lifecycle.test.ts` and `scheduling-harness.ts`; the tests of `daemon/refusal-notes.ts` sit in `lifecycle.test.ts`. Docs are text reported to the orchestrator. Over 25 estimated and within 30: a further split would cut the store from the only query that reads it (C59). The orchestrator cut the job's record out as ticket 3.3b at 00:09 on 2026-10-01, when this ticket had reached 33 estimated. Over 10 estimated, so dev delegates in two groups over disjoint files, in this order: the store (AC1 to AC3); then the states, the standings, the answer, the protocol, the refusal log and the command (AC4 to AC12), which reads what the first stores.

### References

- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.3b, § Ticket 3.4, § Ticket 3.4b, § Ticket 3.5 and its objective.
- `_agent-docs/tickets/3-1-defect-definitions.md` (the answer this ticket extends, its rulings and its Review Record), `_agent-docs/tickets/3-3-verdicts-from-facts.md` (the judgement and the facts) and `_agent-docs/tickets/3-3b-mutation-file-digest.md` (the record's digest).
- ADR-0004, ADR-0007, ADR-0008, ADR-0009; `docs/requirements.md`: FR12, FR13, FR15, FR22, FR24, NFR6.
- `docs/architecture.md` § Results store; § Defects query; § Summary and path status queries; § Falsification jobs; § State dimensions; § Identity and freshness; § Execution and falsification isolation.
- `docs/testing.md` § Results store and refused records; § Defect definitions and the defects query; § Falsification jobs, mutation transforms and reach; § What the daemon is doing in every answer.
- GitHub issues: `node scripts/list-open-issues.mjs` printed "0 open issues, complete" on 2026-09-30 at 23:34.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C5,C8,C9,C12,C13,C14,C19,C20,C24,C26,C29,C30,C32,C38,C41,C42,C45,C48,C49,C50,C59,C170,C113,C114,C115,C118,C119,C120,C122,C123,C124,C125,C133,C139,C147,C149,C150,C151,C152,C153,C173 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P14,P16,P17,P18,P19,P21,P32,P33,P37,P38,P40,P41 -->

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
sizing_ac_count: 13
files_to_modify:
  - packages/daemon/src/falsify/verdict.ts
  - packages/daemon/src/store/schema.ts
  - packages/daemon/src/store/open-store.ts
  - packages/daemon/src/defects/resolve-definitions.ts
  - packages/daemon/src/query/defects-answer.ts
  - packages/daemon/src/query/summary.ts
  - packages/daemon/src/daemon/protocol.ts
  - packages/daemon/src/daemon/refusal-notes.ts
  - packages/daemon/src/client.ts
  - packages/cli/src/commands/defects.ts
files_to_create:
  - packages/daemon/src/defects/defect-states.ts
  - packages/daemon/src/defects/defect-standings.ts
  - packages/daemon/src/store/defect-evidence.ts
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

- `_agent-docs/tickets/3-4-defect-evidence.md` (created by create-ticket, 00:07 on 2026-10-01; amended by its author at 02:06 for ticket 3.3 as landed)
- `_agent-docs/tickets/3-3b-mutation-file-digest.md` (created by create-ticket, cut from this ticket)
- `_agent-docs/sprints/sprint-3-falsification.md` (modified by create-ticket: both splits, § Ticket 3.4's scope and link, § Ticket 3.3b, § Ticket 3.4b, the order paragraph)
- `_agent-docs/sprint-status.yaml` (modified by create-ticket: the `3-3b-mutation-file-digest` and `3-4b-summary-defect-counts` lines)

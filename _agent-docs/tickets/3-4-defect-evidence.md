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

- [x] AC1: Storing a falsification job's reply (Dev Notes § The interface ticket 3.5 calls) keeps one evidence record for each of its judgements that has a verdict: the defect's id, the verdict, its reason and detail where the verdict has one, and its facts, bound to the project identity, the worktree identity, an identity the store gives the stored reply, the definition digest handed in for the defect, the mutation file digest its experiment record carries, the workspace's input fingerprint handed in, the reply's Vitest version and falsifier version, and the Vitest adapter version of the store that writes it, as a stored run carries it. The record becomes that defect's only evidence in that project and worktree, replacing an earlier one, and changes no other defect's and no other worktree's evidence. A judgement with no verdict stores nothing and leaves the defect's earlier evidence as it was. A reply's records become visible together or not at all (C150). Each of these stores nothing and throws, naming what is missing (C122): a reply that does not read `ran`, or that carries no Vitest version or no falsifier version; an empty or missing project identity, worktree identity or fingerprint digest; a verdict whose defect has no definition digest handed in; a verdict whose defect id names no experiment record of the reply, or more than one; a defect id that more than one verdict of the reply names; and a verdict whose experiment record carries no mutation file digest. Storing starts no job and changes no stored run or discovery. (FR12, FR15)
- [x] AC2: No evidence record holds an error message, a stack, a code frame, a definition's `old` or `new` text or a file's text: the reply's raw run records, which keep messages, and the texts of the job's own unhandled errors are never stored, and neither is any member of a judgement or of its facts that their types do not name. Every string a record holds is an identity or a digest the store was handed, a version, a value of a closed set, a module path, a project name, a suite or test name, a hook's name, a syntax node's kind and role, or an error's name, which the consumer's code chooses and which is stored as Vitest serialized it. (NFR6)
- [x] AC3: A store at any schema version the opener migrates today opens migrated in place, holds evidence from then on, and reads its runs and discoveries as before. A new store holds evidence from its creation. The migrated store reads schema version 11, so an opener built for version 10 refuses it as it refuses any newer schema. Evidence one daemon life stored is read by the next. (FR15)
- [x] AC4: A definition's digest changes when its id, any member of its resolved test identity (workspace path, project name, module path, name path, occurrence), its mutation's file, its `old` or its `new` changes, and with nothing else: not with the definition file it sits in, its position there, its `defect` or `required` text, or another spelling of the same module or mutation file. It is computed only for a definition that is valid and resolved, and holds none of the text it digests. (FR12, FR15)
- [x] AC5: Evidence freshness is decided now and never stored (C114). A definition's stored evidence reads stale, naming each cause that holds, when: the definition's digest now differs from the record's; the digest of its mutation file's text now, as the anchor count reads that file, differs from the record's; the record's Vitest adapter version is not the current one; its falsifier version is not the current one; its Vitest version is not the one the latest stored discovery reports for the workspace of the definition's resolved test; or that workspace's current input fingerprint differs from the record's. The fingerprint's cause holds only when a current fingerprint can be computed. When no cause holds, it reads unknown, naming each reason that applies, when no current input fingerprint can be computed for that workspace, or when the resolved test is marked duplicate and the latest discovery is not current (C125); and current otherwise. For a file the anchor read accepts and nobody edited since the job read it, with a byte order mark or CRLF line endings as much as without, the job's digest and the query's are equal, so the mutation file's cause does not hold. So after a daemon restart no evidence reads current before that life's first reconciliation has ended. (FR15)
- [x] AC6: Every definition in scope reads exactly one state. Invalid definition and anchor missing are decided as ticket 3.1 decides them, from the files as they are now, and win over any stored evidence. Every other definition reads the verdict of its stored evidence, with its evidence freshness as a field of its own that is present only beside a verdict (C119), or never verified when the store holds no evidence for its id. Stored evidence the store cannot read back whole reads as none: the definition reads never verified with a reason naming the refusal, and every other defect's evidence still reads (C30). Evidence stored under another falsifier version gives its verdict, its freshness and its causes, and nothing else of the record: no reason, detail or error names (C149). The stored evidence, the latest discovery and the latest runs an answer decides from are read from the store together, and only once the answer's file reads have ended (C150, C173). (FR13, FR22, FR24)
- [x] AC7: The answer's counts give, over the definitions in scope: each state; each evidence freshness, over the definitions that read a verdict; each cause of staleness and each reason for unknown, a definition counted under every one that holds for it; how many definitions hold stored evidence the store could not read back, a definition counted only when that refusal is what it reads (never verified, with the refusal as its reason), so an invalid or anchor missing definition is not among them, and each refusal also logged once while it stands, whatever its definition reads (C32); eligible, the definitions that are neither invalid nor anchor missing and whose resolved test holds a current pass as the answer's own test standings rate it; and verified, the definitions that read detected with evidence freshness current. The total stays ticket 3.1's, every definition in scope plus every definition file problem, so an invalid entry and an invalid definition stay in what verified is read against (C139). Every count is complete whatever the listing bounds. An answer over a scope whose every definition reads detected with current evidence carries the same fields as one over a scope where none does: no field states a scope verified. (FR22)
- [x] AC8: The answer lists the definitions in scope up to ticket 3.1's bound in this order: invalid definition, anchor missing, survived, invalid experiment, unclear, never verified, detected; within a state, evidence that is not current before current; then by file and position. It gives, for each state, how many it did not list. Each listed definition says whether it is eligible. Each listed definition that reads a verdict carries its evidence freshness; each cause when it is stale; each reason that applies when it is unknown; and, unless AC6 withholds them for a record of another falsifier version, its verdict's reason and detail where the verdict has one, and, for an unclear verdict whose reason is that an error is not an assertion, the kind and name of each error the intended test held in the experiment's run, up to a named bound, with the number not listed. (FR22)
- [x] AC9: A client and a daemon on opposite sides of this change refuse each other with the protocol's existing version mismatch, so neither side reads the other's `defects` answer. `--json` documents keep their schema version, since fields and state values are only added. (FR22)
- [x] AC10: `rt-test defects [path] [--root <dir>] [--json]` prints: the total and how many of it are definition file problems, worded correctly for a count of one; verified against the total, and eligible; each state's count; each evidence freshness count, with the count of each cause of staleness and of each reason for unknown, so a stale detection the text does not list is still explained; how many definitions hold evidence that could not be read; each definition file problem; each listed definition that is invalid or anchor missing, with its reason; each listed definition that reads survived, invalid experiment or unclear, with its reason, its detail, each listed error's kind and name and the number of errors not listed, its freshness, each cause when it is stale and each reason when it is unknown; each listed never verified definition that carries a reason, with it; for each state, how many the answer did not list; and the gap counts as before. For a scope whose every definition is verified it prints the same lines as for any other scope, differing only in their numbers and listed definitions: no line sums the scope up as passed or failed. A listed detected definition and a definition's eligibility are given under `--json`, which carries every field of the answer. (FR22)
- [x] AC11: A definition whose test names a module the latest discovery lists as failed to collect reads invalid as not discovered, and its reason says that the module failed to collect in that discovery, so none of its tests is discovered. (FR24)
- [x] AC12: `rt-test defects` loads neither `defects/resolve-definitions.ts` nor `falsify/anchor-match.ts`, and still loads no Vitest module, consumer config or test file: the state names and their order come from a module that reads no file. (FR22)

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

**Resolutions (dev, 03:16 on 2026-10-01).**

- The upsert question does not arise: the build replaces a defect's record with a `DELETE` and an `INSERT` inside the write transaction `inRecordWrite` opens, so it uses no statement this repository has not already exercised.
- CONFIRMED, a fact the build leans on beyond the table. The store rebuilds a stored fact's test state, test mode, module state, hook state and hook name through closed-set tables typed from the fact types, which holds for both supported Vitest lines only if they declare the same unions. They do. Vitest 4.1.11: `node_modules/.bun/vitest@4.1.11+4a7f3e615f259300/node_modules/vitest/dist/chunks/reporters.d.DtoKVV2s.d.ts:349` (a test's `mode`: run, only, skip, todo), `:351` to `:354` (`TestSuiteState`, `TestModuleState` adding queued, `TestState` as the four result states pending, passed, failed, skipped), and `node_modules/.bun/@vitest+runner@4.1.11/node_modules/@vitest/runner/dist/tasks.d-DEYaIMIu.d.ts:417` and `:418` (`RunMode`, `TaskState`), `:579` (`hooks?: Partial<Record<keyof SuiteHooks, TaskState>>`) and `:1236` (`SuiteHooks`: beforeAll, afterAll, aroundAll, beforeEach, afterEach, aroundEach). Vitest 5.0.1: `node_modules/.bun/vitest@5.0.1+2809c141fc59fc1d/node_modules/vitest/dist/chunks/plugin.d.CN87HSxv.d.ts:307` and `:309` to `:312`, and `dist/chunks/config.d.CU_b-wJj.d.ts:2286`, `:2287`, `:2453` and `:3165`, each with the same members.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing; the table holds none unless the build chooses an upsert.
- [x] (AC12) Create `defects/defect-states.ts`, importing nothing that reads a file: `DEFECT_STATE` (the evidence values taken from the verdict constants, not retyped, C3), `DEFECT_STATES` in AC8's order, `DefectState`, and the two sets `rt-test defects` prints as sections (AC10): the states of a definition that cannot run (invalid definition, anchor missing) and the verdicts that are not a detection (survived, invalid experiment, unclear). Export from `falsify/verdict.ts`, in place, only what this ticket reads in production (C59): the verdict constants, and the unclear reason constants, which the standings read to find a not-an-assertion verdict. Delete `DEFECT_STATE`, `DEFECT_STATES` and `DefectState` from `defects/resolve-definitions.ts` and repoint every reader: `resolve-definitions.ts` itself, `query/defects-answer.ts`, and the re-export in `client.ts`, through which `packages/cli/src/commands/defects.ts` reads them. Closure, two searches run at authoring (00:04 on 2026-10-01, at 25514fe6) and a floor to re-run. `git grep --untracked -c "DEFECT_STATE" -- packages docs README.md _agent-docs/sprints` printed `packages/cli/src/commands/defects.ts:5`, `packages/cli/test/defects.json:3`, `packages/daemon/src/client.ts:2`, `packages/daemon/src/defects/resolve-definitions.ts:9`, `packages/daemon/src/query/defects-answer.ts:4`, `packages/daemon/test/defects.json:3` and `_agent-docs/sprints/sprint-3-falsification.md:1`. The same command for `DefectState`, which the first pattern does not match, printed `packages/cli/src/commands/defects.ts:2`, `packages/daemon/src/client.ts:1`, `packages/daemon/src/defects/resolve-definitions.ts:3` and `packages/daemon/src/query/defects-answer.ts:9`. Classify every hit (C50): each production file is a reader repointed above, the sprint line names the move itself, and the `defects.json` hits are create-tests' (Dev Notes § Tests this change may break).
- [x] (AC4, AC5, AC6, AC7, AC8) Create `defects/defect-standings.ts`: the definition digest, and one function that gives every resolved definition its standing (its state, its reason, its evidence freshness with its causes or its unknown reason, the judgement's reason and detail, the error names AC8 lists, whether it is eligible, and its definition digest when it is valid and resolved) from the resolved definitions, each definition's anchor read with the digest of the text it read, the stored evidence and its refusals, each workspace's current fingerprint digest, the Vitest version the latest discovery reports for each workspace, whether that discovery is current, the test standings, and the consumer root, which the digest needs to name the mutation's file relative to the root (`relativePosixPath`), since a definition keeps only the absolute `mutationPath`; and one function that counts standings as AC7 lists the counts, the causes, the unknown reasons and the unreadable records among them, a definition counted under the unreadable records only when the refusal is the reason it reads never verified. Rate a fingerprint with `assessFreshness` from `@rt-test/core`, never a second comparison (C8). Keep every cause, every unknown reason and the error-name bound as named constants (C3). It reads no file and no store.
- [x] (AC5) In `defects/resolve-definitions.ts`, make each anchor read carry the digest of the text it read, taken with `wholeDigest`, the function ticket 3.3b's job digests it with (C8), reading the file exactly as today (`readMutationFile`: UTF-8, a byte order mark kept, only a regular file), so a scoped query still reads each mutation's file once.
- [x] (AC11) In `defects/resolve-definitions.ts`, make the not-discovered reason say when the latest discovery lists the definition's module among a workspace's `failedModules`. Edit around the anchored text of the defect records that file holds (Dev Notes § Tests this change may break counts them).
- [x] (AC1, AC2, AC3, AC6) Add the evidence table to `store/schema.ts`, raise `STORE_SCHEMA_VERSION` to 11, and give every version in `STORE_MIGRATIONS` and version 10 a path that creates the table, each ending in `SET_SCHEMA_VERSION` as the others do. Create two files: `store/defect-evidence.ts`, which holds the SQL, the write and the read, and `store/evidence-facts.ts`, which holds the rebuild of a judgement and its facts by named members, on the way into a row and on the way out of one. For that rebuild, export from `store/columns.ts`, in place, its typed JSON field readers (`jsonText`, `jsonBoolean`, `jsonArray`, `jsonStrings`, `jsonRecord`), which are private there. In `store/defect-evidence.ts`: the write (bindings checked at run time as `requireBindings` checks a run's; one transaction through `inRecordWrite`; each record read back before commit, as `writeRun` reads its run back) and the read (every evidence record of a scope by defect id, and a refusal for each row it cannot rebuild, thrown as `UnreadableRecordError` and caught per row as `selectLatestRuns` catches a run's). A row whose falsifier version is not the current one is rebuilt from its bindings and its verdict alone: its reason, detail and facts are left unparsed, so a shape written under another version is never a refusal (AC6). Store each judgement by rebuilding the members its type names (the verdict, the reason, the detail and each member of the facts), never by serializing the object as handed, so a member the type does not name reaches no row (AC2). Rebuild down to the leaves: the facts hand on, as the job's record holds them, each `MutationLoad` with its `ProbeSite` or `NoProbeSite`, a not-run fact's `NoProbeSite`, the hook states and the `Reach`, so rebuild each of those by its own named members too (the hook states entry by entry, each a hook's name and its state), and a text-bearing member one of those types gains later reaches no row. Store the facts' optional `repeats`, a number, when it is present. Take the facts from the reply alone: build none from the reply's raw run records or from a stored record (Dev Notes § Design decisions). Pair each verdict with its experiment record by defect id, never by position, and refuse a reply in which more than one verdict names one defect id, storing nothing and naming the id, so no verdict replaces another of the same reply by its order (AC1). Store nothing of the reply's `experiments`, `baseline` or `restoredBaseline` beyond each record's mutation file digest, which is its optional member `mutationFileDigest`. Stamp the adapter version from `VITEST_ADAPTER_VERSION`, as `writeRun` stamps a run's. Add `writeEvidence` to `RtTestStore`, and add the evidence and its refusals to `LatestResults`, read inside `readLatestResults`' one read transaction.
- [x] (AC7) In `daemon/refusal-notes.ts`, log each evidence refusal once while it stands, as `RefusalNotes` logs a run's: `note` already receives the `LatestResults` the lifecycle reads, so `daemon/lifecycle.ts` does not change.
- [x] (AC5, AC6) In `query/summary.ts`, give `QueryBasis` each workspace's current fingerprint digest from the `fingerprints` map `queryBasis` already composes, so the defects answer composes no second one. Change nothing a summary answer carries.
- [x] (AC6, AC7, AC8) In `query/defects-answer.ts`, take the standings from `defects/defect-standings.ts` over the definitions in scope: the counts of AC7, the listing of AC8 in `DEFECT_STATES` order with the per-state numbers not listed, and each listed definition's evidence fields. Cut every free text the answer carries for a listed definition with `cutReason` (C170), an error's name and each entry of a suite's name path included; the store still keeps a name as Vitest serialized it. Set the error-name bound from stated realistic sizes (a name's length, a name path's depth), so that a listing at `MAX_LISTED_DEFINITIONS` of definitions at those sizes sits well under the protocol's line limit, and record in the Completion Notes those sizes, that arithmetic and the worst case beside it. No bound holds the worst case under the limit, since each cut text may hold 1,000 characters and a name path has no ceiling of entries: an answer past the limit is refused whole by the server's size check, which names its size and asks for a narrower path, as a `defects` answer has been since ticket 3.1 (Dev Notes § Known limits). Sort a copy (C20). Keep the moment where it is, after the last awaited read (C173).
- [x] (AC9) Raise `PROTOCOL_VERSION` in `daemon/protocol.ts` by one, and export the new answer types and the state constants from `client.ts`.
- [x] (AC10) Extend `packages/cli/src/commands/defects.ts`: the counts lines, worded for a count of one; the verified, eligible and freshness lines, with the count of each cause and each unknown reason and of the unreadable records; a section for the listed definitions that read survived, invalid experiment or unclear, each with its reason, its detail, its listed errors and the number not listed, its freshness, each cause when it is stale and each reason when it is unknown; a never verified definition's reason; and the not-listed line over every state. Print a reason's detail by naming each of its members, so a new reason needs no new wording.
- [x] (Support) Report to the orchestrator the `docs/architecture.md` text for § Results store (the evidence record, its bindings, schema version 11 and its migration), § Defects query (the states, evidence freshness and its causes, the counts, the order) and § Execution and falsification isolation (falsification's evidence is stored, and by which call), the README text for `rt-test defects`, and each known limit the build confirms or adds; write none of it yourself. The ADR-0007 sentence, the glossary terms and the sprint text for ticket 3.5 went to the orchestrator with this ticket (Dev Notes § Doc text reported at authoring); report only what the build makes differ from them.
- [x] (Support) Lint and typecheck.

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
- The store's own pieces: `inRecordWrite`, `inRecordRead` (`store/transaction.ts`); `requireScope`, `StoreScope`, `fingerprintColumns` (`store/stored-records.ts`); `Row`, `text`, `optionalText`, `integer`, `json`, `member`, `UnreadableRecordError`, `unreadable` and, once exported, the typed JSON field readers `jsonText`, `jsonBoolean`, `jsonArray`, `jsonStrings` and `jsonRecord` (`store/columns.ts`); `STORE_MIGRATIONS`, `SET_SCHEMA_VERSION`'s pattern (`store/schema.ts`); the read-back in `writeRun` (`store/write-run.ts`) and the per-record refusal in `selectLatestRuns` (`store/read-runs.ts`).
- `answerFields`, `contextLines`, `cutReasonText`, `joinLines`, `INDENT`, `LIST_SEPARATOR` (`packages/cli/src/answer-text.ts`) and `oneLine`, `reported` (`packages/cli/src/output.ts`).
- For create-tests: `RecordingStore` (`packages/daemon/test/scheduling-harness.ts`), `defectsOver` and the hand-built `LatestResults` builders in `packages/daemon/test/query.test.ts`, and the real-store helpers in `packages/daemon/test/store.test.ts`.

### Must Create

- `packages/daemon/src/defects/defect-states.ts`: the seven state names, their order, and the problem states.
- `packages/daemon/src/defects/defect-standings.ts`: the definition digest, the standing of each definition, and the counts.
- `packages/daemon/src/store/defect-evidence.ts`: the evidence record's SQL, its write and its read.
- `packages/daemon/src/store/evidence-facts.ts`: the rebuild of a judgement and its facts by named members, into a row and out of one.

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

- **The write**: `writeEvidence(bindings, job, definitionDigests)` on `RtTestStore`. `bindings` is the store scope (`projectIdentity`, `worktreeIdentity`) and the digest of the workspace's input fingerprint the job ran at. A digest is required: ticket 3.5 calls nothing when the inputs moved, since ADR-0007 stores nothing then. `job` is the reply `Executor.falsify` returns as its `value`, whole, when it reads `ran`; the store takes from it the Vitest version, the falsifier version, each judgement and each experiment record's mutation file digest (`mutationFileDigest`, an optional string on both members of `ExperimentRecord`), and nothing else. It stores no workspace path: a record's workspace is the one in its definition's resolved test identity, which the definition digest covers. The store stamps the adapter version itself, as `writeRun` does (`adapterVersion: VITEST_ADAPTER_VERSION` in `store/write-run.ts`), since the daemon and its executor process are one build. `definitionDigests` maps each defect id to the definition digest of the definition its experiment was built from.
- **The definition digest**, from `defects/defect-standings.ts`: ticket 3.5 takes each digest from the standing of the definition it builds an experiment from, so the digest stored is the digest of what ran.
- **The standings**, from the same module: per definition, its state, its evidence freshness and whether it is eligible. Ticket 3.5 picks, per workspace, the eligible definitions that read never verified or whose evidence freshness is not current from them, so "eligible" and "current" are each answered once (C8).

The write has no production caller until ticket 3.5 lands, as ticket 3.2's `Executor.falsify` has none today (`git grep -n "\.falsify(" -- packages/daemon/src packages/cli/src` printed nothing and exited 1 at 45f92eb6, 02:05 on 2026-10-01). Until then it is exercised by this ticket's tests over a real `node:sqlite` store, and every test that needs stored evidence in a real store seeds it through the write and never through SQL, so the writer and the reader of one record are proven together (C9, C59); a query test over a hand-built `LatestResults` hand-builds its evidence members as it does the others. The digest and the standings are called in production by the `defects` answer from this ticket on.

#### Design decisions (scope of analysis: storing, binding and answering evidence; scheduling, the canary gate and the summary are unanalyzed here)

- **One record per defect id per worktree, replaced.** This repository's own catalog holds about 2,480 defects, and a judgement's facts are about 1.5 KB as JSON (estimated from `fact-types.ts`; unmeasured). Workspace granularity re-verifies a whole workspace after each edit, so appending would grow the store by megabytes per round. A new verdict replaces the old one; a judgement with no verdict leaves it, and the old record reads whatever its bindings give now: stale when one changed, and current again when none differs.
- **Stale evidence shows its last verdict.** FR15 marks evidence stale; it does not erase it. Verified counts only detected with freshness current, so a stale detection never counts.
- **The bindings are compared at read time.** Every cause that holds is named. Five need no fingerprint (definition digest, mutation file digest, adapter version, falsifier version, Vitest version); the fingerprint's holds only when a current one can be computed and differs. Only when no cause holds can the evidence read unknown, so an unavailable fingerprint never hides a cause that is certain, as `storedFreshness` reads a run under another adapter version stale whatever its fingerprint. A resolved test always lies in a workspace the discovery reports as `discovered`, whose entry always carries `vitestVersion` (`WorkspaceDiscovery` in `packages/daemon/src/vitest/discover-tests.ts`), so the Vitest version cause never compares with an absent value. The workspace's fingerprint already digests the workspace's resolved Vitest version, the adapter version, the runtime and the environment (`workspaceFingerprint` and `sharedParts` in `packages/daemon/src/inputs/fingerprint.ts`), so the explicit version comparisons only name a cause the fingerprint would also catch.
- **The mutation file digest closes what the fingerprint leaves out.** A file the consumer declares a non-input in `rt-test.json` is in no fingerprint. Edited so that `old` still occurs once, it would leave a detection reading current. The job records a digest of the text it read (ticket 3.3b), this ticket stores it, and the query, which already reads that file for the anchor count, compares it. It costs no extra staleness where the fingerprint covers the file, since both then change together.
- **The digest is of the text read when the job started.** Ticket 3.3b takes it from the one read `FalsificationRuns` makes of each mutated file before any run. A file edited later in the job reads stale for as long as the edit stands, the safe direction; one edited while the job runs and restored to the same text before the query reads current, a known limit (§ Known limits). Every judgement that has a verdict comes from an experiment whose file was read: a run, or a reason decided with the text in hand (no probe site, in `startCheck`; no module and baseline did not pass, after it); the unreadable file reads no verdict. So AC1's refusal of a verdict without a mutation file digest guards a broken reply, not a case a job produces. The job reads with `readFileSync(file, "utf8")` and the query with `readFile(path, "utf8")`, both keeping a byte order mark, so `wholeDigest` over the string, which ticket 3.3b's job calls, gives equal digests for an unedited file.
- **Restart needs no code of its own.** Before a life's first reconciliation ends, `currentInputs` answers every `workspaceFingerprint` with not ok (`unavailableReason` in `packages/daemon/src/inputs/current-inputs.ts`), so `assessFreshness` gives unknown. Evidence is in SQLite and survives the process.
- **A positional test.** A definition that names one of several same-named tests by its occurrence resolves against the latest stored discovery. While that discovery is not current its positions are not vouched for, so the evidence reads unknown, as an ordinary result does (`positionUnvouched` in `query/test-states.ts`).
- **Counts only.** The answer never carries a flag that says a scope is verified; a reader compares verified with the total, which holds every invalid entry and invalid definition. A scope with no definition has a total of 0 and a verified of 0.
- **Eligible is independent of evidence.** A defect that reads detected and current is still eligible by the glossary; the job ticket 3.5 schedules covers the eligible defects whose evidence is not current.
- **Facts are stored whole and answered in part.** The answer carries a verdict's reason and detail, and for a not-an-assertion reason the errors of the intended test in the experiment's run (`facts.run.test.errors`, each a kind and an optional name), since ticket 3.3's judgement gives that reason no detail and a consumer must learn the name to declare it in `assertionErrors`. Carrying the facts whole would add about 750 KB to a 500-definition listing (500 times the 1.5 KB estimated above), against the protocol's 1 MiB line limit. What the answer does carry for each listed definition is unmeasured; the error-name bound is set at build time from stated realistic sizes, and each free text it carries is cut with `cutReason`. No bound holds the worst case under the line limit: 500 listed definitions with one error name each at the 1,000-character cut are already half the line, and a suite's name path has no ceiling of entries. An answer past the limit is refused whole (§ Known limits).
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
- A `defects` answer past the protocol's line limit is refused whole: the server's size check replies with an error that names the answer's size and the limit and asks for a narrower path, as it has since ticket 3.1. The listing's bounds are set for realistic sizes and not for the worst case, so a scope whose listed definitions carry very long names, name paths or reasons reads no answer until a narrower path is asked. It is loud and never stale: no count and no state is reported from a cut answer.
- A file other than the mutation's own that the workspace's fingerprint leaves out, such as a test helper the consumer declared a non-input, stales neither the test's ordinary result nor its evidence when it is edited. The test's own module is never such a file: `workspaceFingerprint` digests every test module the discovery lists, whatever is declared or ignored. The orchestrator ruled the ordinary result's hole outside this ticket (23:45 on 2026-09-30), and that evidence shares it for such a file until M3's file-level dependencies is this recorded limit (00:09 on 2026-10-01).
- A declared non-input file a defect mutates, edited while a job runs and restored to the same text before the query, reads current though a run was served other text, whether it was restored inside the job or after it: the digest is of the text the job read when it started, and no change event comes for a file outside the workspace's inputs. It needs a consumer's false declaration, and the standing hole of that declaration for any other file is the limit above, recorded until M3's file-level dependencies. The fix weighed and refused: comparing the text each run was served with the start digest and giving the experiment no verdict when they differ (the orchestrator, 02:20 on 2026-10-01).
- The Vitest version's cause is rated against the latest stored discovery (AC5). Between a Vitest upgrade and the rediscovery, evidence stored under the old version reads stale naming `inputs-changed` alone, since the workspace's fingerprint digests the installed version, and evidence stored under the new version in that window reads stale naming `another-vitest-version` until the rediscovery is stored. Freshness is stale in both cases and never falsely current: only the list of causes lags the discovery (the orchestrator, 04:25 on 2026-10-01).
- A definition's id, its test as written, its mutation's file and the resolved test identity are carried whole, as every answer carries an identity: only the evidence's free texts are cut. One very long id or test name can take a `defects` answer past the line limit, where the server refuses it whole, and a narrower path does not shed a definition that lies in every scope: the remedy is the definition itself. It is loud and never stale (the orchestrator, 04:25 on 2026-10-01).

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

- A declared non-input file a defect mutates, edited and restored byte for byte inside one job's run: a known limit. The ruling of 02:20 below widens its wording.

Asked by ticket 3.3b's dev at 02:19 on 2026-10-01; decided by the orchestrator at 02:20, amending the wording of the 00:20 ruling.

- The known limit is "a declared non-input file a defect mutates, edited while a job runs and restored to the same text before the query, reads current though a run was served other text." It covers the restore inside the job and the restore after it. The reason is unchanged, and the fix weighed and refused is comparing the text each run was served with the start digest and giving the experiment no verdict when they differ. § Known limits and ticket 3.3b's first design decision carry this wording.
- Ticket 3.3b's build (6a7a3332 on `wt/1`) names the record's member `mutationFileDigest`, and `FALSIFIER_VERSION` is 3 there. The store task, the interface and the notes on ticket 3.3b name the member. No criterion changed.

Asked by the orchestrator at 01:57 on 2026-10-01, once ticket 3.3 had merged at 45f92eb6; amended by the author at 02:06.

- Ticket 3.3's review changed the judgement and the facts this ticket was written against: the invalid reason `test-repeated` (detail `repeats`, a number) directly after `hook-not-passed`, and the optional `repeats` on a recorded test and on `TestFacts`. The reasons a stored judgement can carry, the store task, the notes on ticket 3.3 and the counts are restated for 45f92eb6. No criterion changed, and the sizing stands at 21 raw files and 28 estimated.

Asked by the dev at 03:13 on 2026-10-01, beside its sanity check; decided by the orchestrator at 03:13.

- The store's rebuild of a judgement and its facts does not fit `store/defect-evidence.ts` under the 500-line cap. Ruling: the file list grows by two, both cleared: create `store/evidence-facts.ts`, the rebuild by named members, apart from `store/defect-evidence.ts`'s SQL, write and read; and edit `store/columns.ts`, exporting its JSON field readers for that rebuild. The ticket touches 25 files against the owner's 30: the 23 listed under § Sizing, plus `packages/daemon/test/experiment-facts.ts` and `packages/daemon/test/falsify/verdict.test.ts`, cleared at 04:32, with the four-file sweep beside that count. A further file outside the list goes to the orchestrator with its reason.
- The error-name bound (sanity finding F1). Ruling: the answer task's sentence that a full listing stays under the protocol's line limit cannot be made true, so the bound is set from stated realistic sizes, with the arithmetic and the worst case in the Completion Notes; an answer past the line limit is refused whole by the server with its size and a request for a narrower path, as a `defects` answer has been since ticket 3.1, a known limit that is loud and never stale; and every free text the answer carries for a listed definition is cut with `cutReason`, an error's name and a suite's name path included, while the store keeps a name as Vitest serialized it.

Asked by the dev during the build; decided by the orchestrator at the times given, all on 2026-10-01.

- Which of `store/columns.ts`'s private JSON readers to export (03:17): whichever the rebuild reuses, and no more, named in the record. Exported in place: `jsonText`, `jsonBoolean`, `jsonArray`, `jsonStrings`, `jsonRecord`. Added: `jsonCount`, `jsonMember`, `jsonOptional`. `jsonField` stays private.
- The owner paused all lanes from 03:47 to 04:18; the orchestrator's threadId changed to 327be982-6b25-48f6-86e6-3a9901e3712a in that window.
- The store's rebuild across two files (04:20): accepted. The rebuild measured 592 code lines as one file, so `store/evidence-facts.ts` holds the facts and an invalid experiment's reason and detail, and `store/defect-evidence.ts` holds the SQL, the write, the read and the verdict layer. No file was added; a third store file, like any file outside the list, goes to the orchestrator first with its reason.
- The adversarial review's F1 and F2 (04:20): fix both in this ticket as refusals of the reply, since each is a detection credited falsely, the owner's absolute exception.
- A record of another falsifier version whose verdict is none of the four (04:25): keep. It reads unreadable, so never verified, counted and logged, as the design decision "Another falsifier version's record is not interpreted" says; "never a refusal" covers its reason, detail and facts, which stay unparsed.
- The Vitest version's cause against the latest stored discovery (04:25): keep, as the known limit above.
- Cutting a listed definition's identifying fields (04:25): keep them whole. The 03:13 ruling's words narrow to what they meant: every free text of the evidence is cut (a detail's suite names, each error's name, a reason), and an identity is not free text. The known limit above names the case.

#### Sanity check

From the dev (threadId 3e0f5d99-272c-4221-813f-6e3d7b4380ab) at 03:13 on 2026-10-01, before any edit; answered by the author at 03:16. Four findings, all confirmed and applied.

- F1, a bound never multiplied against its ceiling: confirmed, by the orchestrator's ruling above. Authoring set a worst-case target without multiplying the 500 listed definitions by the 1,000-character cut. The answer task, the design decision "Facts are stored whole and answered in part" and § Known limits carry the fix.
- F2, two verdicts of one reply naming one defect id: confirmed. AC1 keeps one record for each judgement and makes it the defect's only evidence, which two such verdicts cannot both satisfy, and the listed refusals left the case out. AC1 and the store task now refuse it. A job cannot produce it, since `experimentFacts` pairs records and experiments one for one, so it guards a broken reply.
- F3, the standings function's inputs left out the consumer root: confirmed. The definition digest names the mutation's file relative to the root (AC4), and `CheckedDefinition` keeps only the absolute `mutationPath`. The standings task now lists the root.
- F4, the population of AC7's count of unreadable records: confirmed. A definition is counted only when the refusal is what it reads, never verified with the refusal as its reason; an invalid or anchor missing definition reads no stored evidence (AC6) and is not counted, and every refusal is still logged. AC7 and the standings task say so.

#### Ticket review

One review agent read the ticket and its bound rules at 23:54 on 2026-09-30 and returned 30 findings, applied except as listed here. Not applied as worded:

- The adapter version handed in with the bindings (finding 27): the store stamps `VITEST_ADAPTER_VERSION` itself, as `writeRun` does for a run, since the daemon and its executor process are one build. AC1 and AC2 now say where the version comes from.
- A missing adapter version as a refused write (part of finding 18): for the same reason, there is none to be missing; a reply without a Vitest version or a falsifier version is refused.
- The fingerprint compared only when no other cause holds (finding 10): AC5 stood, and the Dev Note was corrected instead, so every cause that holds is named.
- A pairing check by position (finding 26): the store pairs a verdict with its record by defect id, and refuses an id that names no record or several.

Settled by fact: a resolved test's workspace always reports a Vitest version (finding 5); every verdict comes from an experiment whose file was read (finding 25); the Execution Metadata block is filled at finalize (finding 30). One finding went to the orchestrator, who kept it a known limit: evidence for a test whose helper file the fingerprint leaves out (finding 23).

#### Pending siblings

- 3.3 (done, on `main` at 45f92eb6) created `falsify/verdict.ts`, `falsify/fact-types.ts` and `falsify/run-facts.ts` and wrote `falsify/experiment-record.ts` and `falsify/falsify-workspace.ts`. Its review's fix is in that commit: the invalid reasons hold `test-repeated`, a recorded test and `TestFacts` hold the optional `repeats`, and `FALSIFIER_VERSION` is 2. This ticket is written against that commit.
- 3.3b (done, landed on `main` with its build 6a7a3332 and its tests c1d2aca9) gives each experiment record its mutation file digest as the optional member `mutationFileDigest`, a string, on both members of `ExperimentRecord`, and raises `FALSIFIER_VERSION` from 2 to 3. This ticket reads that member and the version from the reply, and edits neither `falsify/experiment-record.ts` nor `falsify/falsify-workspace.ts`.
- An inline change in Tree 2 (lane step-probe) rewrites `falsify/reach-probe.ts`, deletes `falsify/probe-slots.ts` and creates `falsify/probe-step.ts`. `mutateWithProbe`'s parameters and the fields of `ProbedMutation`, `ProbeSite` and `NoProbeSite` are unchanged, and a `position` refusal's `nodeKind` and `role` stay open strings; it raises no `FALSIFIER_VERSION`. It shares no file with this ticket. `falsify/reach-probe.ts` holds `ProbeSite` and `NoProbeSite`, which the stored facts carry: read both as `main` holds them when this ticket builds, and rebuild only the members AC2's classes of strings allow.
- 3.5 (backlog) calls the write, the digest and the standings above, reads `readMutationFile`'s way of reading a file, and writes `daemon/lifecycle.ts`, which this ticket does not edit.
- 3.4b (backlog) puts the counts of AC7 in the summary, from `defects/defect-standings.ts`, after 3.5.
- 3.6 (backlog) keeps a canary result per Vitest and falsifier version, in a record of its own; it reads and writes no evidence record.
- 3.7 (backlog) replays the milestone's acceptance, a weakened assertion retiring earlier evidence and the exact verified and eligible counts among them, over this ticket's store and answer.
- 3.8 (backlog) reads `defects` answers in place of proofs, so the states, the freshness field and the counts this ticket fixes are the ones a lane reads.

#### Current structure of the modified files

Code lines are by `grep -cv '^\s*$\|^\s*//\|^\s*/\?\*' <file>`, which leaves out blank and comment lines, at 45f92eb6 (02:01 on 2026-10-01).

- `packages/daemon/src/store/schema.ts` (165 code lines): `STORE_SCHEMA_VERSION = 10`; `STORE_SCHEMA` creates `runs`, `run_modules`, `run_tests`, `discoveries`, `discovery_workspaces` and `discovered_tests`, each `STRICT`; `STORE_MIGRATIONS` maps versions 1 to 9 to statements ending in `SET_SCHEMA_VERSION`.
- `packages/daemon/src/store/open-store.ts` (198): `RtTestStore` (`writeRun`, `writeDiscovery`, `readRuns`, `readRun`, `readLatestDiscovery`, `readLatestResults`, `close`); `LatestResults extends LatestRuns` with `discovery` and `discoveryRefusal`; `readLatestResults` reads inside one `inRecordRead`; the store handle delegates each method to a module of its own.
- `packages/daemon/src/store/columns.ts` (291, at 7b5b11d6, 03:14 on 2026-10-01): exports the column readers (`text`, `optionalText`, `integer`, `json`, `member`, `arrayOf`, `stringArray`), `UnreadableRecordError` and `unreadable`; its JSON field readers `jsonText`, `jsonBoolean`, `jsonArray`, `jsonStrings` and `jsonRecord` are private, each reading through the private `jsonField` and throwing `unreadable` on a field of another type.
- `packages/daemon/src/defects/resolve-definitions.ts` (239): `DEFECT_STATE` (three values), `DEFECT_STATES`, `readAnchors` (one read of each mutation's file, through `readMutationFile`), `resolveDefinitions` and `notDiscoveredReason`, whose `index.modules` already holds failed and typecheck modules but not which is which.
- `packages/daemon/src/query/defects-answer.ts` (253): `defectsAnswer` awaits `readDefinitionFiles` and `readAnchors`, then takes `query.moment()` and resolves without awaiting again; `DefectCounts` (`total`, `states`, `invalidEntries`); `ListedDefinition`; `listedDefinitions` sorts by `DEFECT_STATES.indexOf`, then file, then position, and slices to `MAX_LISTED_DEFINITIONS` (500).
- `packages/daemon/src/query/summary.ts` (355): `queryBasis` composes `fingerprints` once and hands `testStandings` a reader over it; `QueryBasis` holds `discovery`, `latestRuns`, `refusedRuns`, `standings`, `notDiscovered` and `context`.
- `packages/daemon/src/daemon/refusal-notes.ts` (36): `RefusalNotes.note(results)` logs the latest discovery's refusal once, and each workspace's run refusal once per reason; the lifecycle's `#latestResults` calls it on every read.
- `packages/daemon/src/daemon/protocol.ts` (259): `PROTOCOL_VERSION = 4`; `DefectsResponse = DefectsAnswer & { type; protocolVersion }`.
- `packages/daemon/src/client.ts` (458): re-exports `DEFECT_STATE`, `DEFECT_STATES` and `DefectState` from `./defects/resolve-definitions.js`, and four types from `./query/defects-answer.js`.
- `packages/cli/src/commands/defects.ts` (139): `PROBLEM_STATES` is every state but never verified; `defectCountLines` prints "of which N are definition file problems"; `notRunnableLines` prints the listed problem states under "Definitions that cannot run:" and the per-state numbers not listed.
- `packages/daemon/src/falsify/verdict.ts` (431): holds `VERDICT`, `NO_VERDICT_REASON`, `INVALID_REASON` (14 reasons, `test-repeated` among them) and `UNCLEAR_REASON` as private constants and exports `Judgement`, `judge` and `isWouldBeDetection`; it imports only `./fact-types.js` at run time, and that module imports only types.
- Not edited by this ticket, read by it: `packages/daemon/src/falsify/experiment-record.ts` holds `FALSIFIER_VERSION = 2`, `ExperimentRecord` (a `ran` member and a `not-run` member), `ExperimentJudgement` (`Judgement & { defectId; facts }`) and `JudgedJobFacts`, which gives a `ran` job its `judgements` and a job of any other status none. Ticket 3.3b's build (6a7a3332 on `wt/1`, read at 02:21 on 2026-10-01) adds the mutation file digest to both members of `ExperimentRecord`, as `readonly mutationFileDigest?: string`, and makes the version 3.

#### Tests this change may break

- A hand-built `LatestResults` needs the evidence members wherever a test builds one: `packages/daemon/test/query.test.ts`, `changes.test.ts`, `waits.test.ts`, `lifecycle.test.ts` and `RecordingStore.readLatestResults` in `scheduling-harness.ts`, which also needs `writeEvidence`. Found with `git grep -c "discoveryRefusal" -- packages` over the test tree (23:40). The typecheck finds each (P14).
- D2691 (`packages/daemon/test/defects.json`) builds a `LatestResults` literal in its `new` text, which no typecheck reads (C38): it needs the evidence members, and re-proving.
- D3732 (`packages/daemon/test/defects.json`) anchors the `DEFECT_STATES` list in `defects/resolve-definitions.ts`, which moves and grows; D3695 anchors the listing's sort in `query/defects-answer.ts`; D3704 anchors `PROBLEM_STATES` and D3730 calls `defectCountLines` in `packages/cli/src/commands/defects.ts`. Each needs re-anchoring or rewriting, and re-proving.
- Records anchored in the files this ticket edits, at 45f92eb6 (02:01 on 2026-10-01), each count by `cat packages/daemon/test/defects.json packages/daemon/test/*/defects.json packages/cli/test/defects.json | grep -c '"file": "<path>"'`: `store/schema.ts` 22, `store/open-store.ts` 17, `defects/resolve-definitions.ts` 16, `query/defects-answer.ts` 18, `query/summary.ts` 46 (44 in the daemon's file and 2 in the CLI's), `daemon/protocol.ts` 6, `packages/cli/src/commands/defects.ts` 5, `client.ts` 12, `daemon/refusal-notes.ts` 9 and `falsify/verdict.ts` 34. None of the 34 anchors the declaration line of `VERDICT` or of `UNCLEAR_REASON`, or a member line of either, so exporting the two in place breaks no anchor at that commit. `store/columns.ts` holds 24, by the same command at 7b5b11d6 (03:14 on 2026-10-01): none anchors the declaration line of a JSON field reader, and 19 anchor a line that calls one, which the export leaves as it is. Edit around their anchored text, and list any record whose anchor an edit breaks under the Dev Handoff.
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

23 raw files and 30 estimated (23 times 1.3 is 29.9); code units 13 (12 criteria plus validation). The ticket touches 25 files against the owner's 30, a limit read against the files a ticket actually touches: the 23 listed here, plus `packages/daemon/test/experiment-facts.ts` and `packages/daemon/test/falsify/verdict.test.ts`, which the orchestrator cleared at 04:32 on 2026-10-01, with the four-file sweep named below beside that count. A further file outside the list goes to the orchestrator with its reason. Production, modified: `store/schema.ts`, `store/open-store.ts`, `store/columns.ts`, `defects/resolve-definitions.ts`, `query/defects-answer.ts`, `query/summary.ts`, `falsify/verdict.ts`, `daemon/protocol.ts`, `daemon/refusal-notes.ts`, `client.ts`, and `packages/cli/src/commands/defects.ts`. Production, created: `defects/defect-states.ts`, `defects/defect-standings.ts`, `store/defect-evidence.ts`, `store/evidence-facts.ts`. Tests, for create-tests: `store.test.ts`, `query.test.ts`, `defects/definitions.test.ts`, `packages/cli/test/defects-command.test.ts`, and the `defects.json` beside each (`packages/daemon/test/`, `packages/daemon/test/defects/`, `packages/cli/test/`). This ticket's file. Beside that count, one mechanical sweep: the evidence members on each hand-built `LatestResults` in `changes.test.ts`, `waits.test.ts`, `lifecycle.test.ts` and `scheduling-harness.ts`; the tests of `daemon/refusal-notes.ts` sit in `lifecycle.test.ts`. Docs are text reported to the orchestrator. Over 25 estimated and at 30, allowed because a split would cut the store from the only query that reads it (C59). The orchestrator cut the job's record out as ticket 3.3b at 00:09 on 2026-10-01, when this ticket had reached 33 estimated. Over 10 estimated, so dev delegates in two groups over disjoint files, in this order: the store, with `store/evidence-facts.ts` and `store/columns.ts` (AC1 to AC3); then the states, the standings, the answer, the protocol, the refusal log and the command (AC4 to AC12), which reads what the first stores.

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
  - packages/daemon/src/store/columns.ts
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
  - packages/daemon/src/store/evidence-facts.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId f99e93ce-9843-4302-ae20-e5d8e0e2530f (rt-t3-4-dev-2, which took over from rt-t3-4-dev by handoff once the ticket was in review; send code bugs here)

#### Test Files This Change Broke

By the typecheck at 04:22 on 2026-10-01 (`bun run --filter @rt-test/daemon typecheck` and `bun run --filter rt-test typecheck`; no error in `src`):

- `packages/daemon/test/lifecycle.test.ts` (28 errors), `packages/daemon/test/scheduling-harness.ts` (2), `packages/daemon/test/waits.test.ts` (2), `packages/daemon/test/changes.test.ts` (1), `packages/daemon/test/query.test.ts` (1): each a hand-built `LatestResults` missing `evidence` and `evidenceRefusals`, or a store stand-in (`RecordingStore` and the two beside it) missing `writeEvidence`.
- `packages/cli/test/defects-command.test.ts` (6): scripted `defects` answers whose `counts` lack the four new states and the new counts, and whose listed definitions lack `eligible`.

Not found by a typecheck, to expect at run time: `packages/daemon/test/store.test.ts` and `lifecycle.test.ts` wherever they hold schema version 10 as the current one; the `defects` text assertions in `packages/cli/test/defects-command.test.ts` (new count lines, sections and the not-listed line); D2691, whose `new` text builds a `LatestResults` literal (C38).

Defect records whose anchor no longer matches exactly once (22, by a scratch count of each record's `old` in its file at 04:24):

- `packages/daemon/src/store/schema.ts`: D2097, D2098, D2122, D2260, D2791, D2792, D2829, D2830, D2831, D2846, D2859, D3040, D3041, D3128, D3129, D3351. Each anchors the version line or a whole migration line, and every one of those lines changed.
- `packages/daemon/src/defects/resolve-definitions.ts`: D3732 (the states list, which moved to `defects/defect-states.ts` and is now `Object.values(DEFECT_STATE)`).
- `packages/daemon/src/query/summary.ts`: D1883, D3273 (the fingerprint reader is defined once as `currentFingerprint` and handed to the test standings and the basis).
- `packages/daemon/src/query/defects-answer.ts`: D3721 (the discovery's currency is one `discoveryCurrent` for the resolution and the standings).
- `packages/cli/src/commands/defects.ts`: D3704 (`PROBLEM_STATES` is gone; the sections read `NOT_RUNNABLE_STATES` and `UNDETECTED_VERDICTS`), D3729 (the not-listed line is `notListedLine`, printed always).

Records whose anchor still matches and whose mutation now sits in changed code, worth re-reading before re-proving: D3695 (the sort gained a freshness rank between state and file), D3694, D3722, D3733 and D3734 (the answer's body), D3679 and D3680 (the listing ternary now calls `listedModuleText`), D3687, D3688, D3689, D3728 (`anchorProblem` is synchronous and takes the file's text), D3714 (`AnchorRead` gained the optional `fileDigest`), D3730 (`defectCountLines` prints seven lines), and the nine records of `daemon/refusal-notes.ts`, whose lines are untouched.

#### ACs Owed a Test

- AC1: a reply's verdicts become each defect's one record, replacing only that defect's in that worktree, all or none; each listed refusal stores nothing and names what is missing.
- AC2: no member the judgement and fact types do not name reaches a row.
- AC3: a store of each migratable version opens at version 11 holding the evidence table, reads its runs and discoveries as before, and keeps evidence across a reopening.
- AC4: the definition digest changes with each named member and with nothing else.
- AC5: each cause of staleness is named when it holds; unknown is read only when none holds; current otherwise; a byte order mark or CRLF file reads the same digest as the job's.
- AC6: one state per definition; invalid and anchor missing win over stored evidence; unreadable evidence reads never verified with the refusal while the others still read; another falsifier version gives verdict, freshness and causes only.
- AC7: every count, complete whatever the listing bounds, with the unreadable count's population and each refusal logged once while it stands.
- AC8: the listing's order, the per-state numbers not listed, eligibility, and the evidence fields with the error bound.
- AC10: every line the text prints, the wording for a count of one, and the same lines for a fully verified scope.
- AC11: the reason for a module that failed to collect.

AC9 and AC12 are ticked on evidence that needs no test (Completion Notes § Acceptance evidence); a test of each is still welcome.

#### Tests Owed

Defects this build met or that its review named, each a behavior the criteria above do not spell out:

- A reply whose verdict, reason or detail is not the one the judge gives its facts is refused whole, and a row whose columns disagree with its facts reads as a refusal (`storedJudgement` in `store/defect-evidence.ts`).
- A reply holding a judgement or an experiment record that is not an object naming a defect id is refused whole; so is a defect two judgements name, one with a verdict and one without.
- A count or position in the facts that is negative or fractional is refused (`jsonCount`).
- A `ran` reply whose `experiments` is not a list is refused.
- The errors listed for a not-an-assertion verdict put those that are not assertions first, so three soft assertion errors do not hide the thrown error behind the bound of 3.
- A fingerprint that cannot be computed hides no certain cause: evidence with a changed definition digest reads stale, naming it, before the first reconciliation ends.
- An anchor-missing definition reads anchor missing though the store holds a detected record for its id, and is neither eligible nor counted under unreadable evidence.
- A module that failed to collect in one project and holds discovered tests in another gets the reason worded for a project (`FAILED_IN_A_PROJECT` in `defects/resolve-definitions.ts`).
- A detail's text and an error's name longer than 1,000 characters are cut in the answer, with `omittedCharacters` giving the total, while the store keeps them whole.
- `DEFECT_STATES` holds every state of `DEFECT_STATE` in AC8's order.

### Tests Record

Tests session: threadId c7b940f8-b0ba-4fd2-993e-b26b847ad896 (rt-t3-4-tests)

By create-tests on 2026-10-01, from 04:28. The suite ran first, scoped to the 15 production files by `vitest related`: 27 of 84 test files, 130 of 1,579 tests red, every one stale infrastructure and none a code bug (a stand-in store and three hand-built `LatestResults` without the evidence members, the migration helper leaving the new table in place, the CLI's scripted answers without the new counts).

#### What bound this session, with who decided it and when

- Size (the orchestrator, 04:32): the ticket touches 25 files against the owner's 30, the 23 listed plus `packages/daemon/test/experiment-facts.ts` (created) and `packages/daemon/test/falsify/verdict.test.ts` (its private fact builders moved there unchanged, one import added), with the four-file sweep beside it. A further file outside the list goes to the orchestrator first.
- What earns a test (the orchestrator, 04:45, correcting its dispatch of 04:28): the dispatch's three "absolute" exceptions are withdrawn, as they were the orchestrator's additions and not the owner's. The owner's words, 03:25 on 2026-09-30: "I only want you to elevate to me if a design decision that is truly broken needs my attention. I'm not terribly interested in chasing edge cases right now. this is tooling for fleet cooling and others going forward"; and 04:43 on 2026-10-01: "the deciding factor on whether we should address it is look at Fleet Cooling's codebase. Would this edge case come up in it? If not leave it." The orchestrator's reading: the criteria bind as written and each gets its test and proof; a case beyond them is tested when Fleet Cooling's checkout (`C:/source/fleetcooling`, read only) would meet it, and is otherwise listed under Deliberately Untested with what a consumer would see and what must coincide.
- Defect ids (the orchestrator, 04:28 and 04:48): D3910 to D3965. Used: D3910 to D3962. Unused: D3963, D3964, D3965, kept for the review's gaps.
- The proof's size (asked 05:03, approved by the orchestrator 05:03): 943 records, each platform as one run. The shared stand-in `RecordingStore` changed behavior, so every record whose test reads the latest results through `scheduling-harness.ts` is re-proved beside the records added, re-anchored, in an edited test file, or mutating a file the build edited.

#### Named Defects

The store, in `packages/daemon/test/store.test.ts`, each over a real `node:sqlite` store seeded only through `writeEvidence`:

- D3910: Each verdict takes the mutation file digest of the reply's first experiment record, not of the record naming its defect. (AC1)
- D3911: A record's definition digest and mutation file digest are stored in each other's column. (AC1)
- D3912: A new verdict erases every record of its worktree and that defect's record in every other worktree. (AC1)
- D3913: A judgement with no verdict refuses the whole reply, so the verdicts beside it are never stored. (AC1)
- D3914: A reply's records are written outside one transaction, so a reader sees some before the rest. (AC1)
- D3915: A reply with no Vitest version is not refused by name; the test also drives a reply that does not read `ran` and one with no falsifier version. (AC1)
- D3916: An empty fingerprint digest is not refused by name; the test also drives an empty project identity and worktree identity. (AC1)
- D3917: A verdict whose defect has no definition digest handed in is stored under a made-up digest. (AC1)
- D3918: A verdict whose defect two experiment records name takes the first record's digest; the test also drives no record. (AC1)
- D3919: A defect two judgements of one reply name is not refused, one of them with no verdict included. (AC1)
- D3920: A verdict whose experiment record carries no mutation file digest is stored under a made-up digest. (AC1)
- D3921: A reply's verdict is stored as handed, whatever the judge gives its facts. (Tests Owed)
- D3922: A stored row's verdict is read as its column holds it, whatever the judge gives its facts. (Tests Owed)
- D3923: One evidence record that cannot be rebuilt fails the whole read. (AC6)
- D3924: A record stored under another falsifier version has its reason, detail and facts parsed as the current version's. (AC6)
- D3925: A reply with no list of experiment records is not refused by name; the test also drives a judgement naming no defect id and an experiment record that is no object. (Tests Owed)
- D3926: A negative count in a reply's facts is stored; the test also drives a fractional one. (Tests Owed)
- D3927: A judgement's facts are serialized as the reply handed them, so an error's message and stack reach the row. (AC2)
- D3928: A probe site is stored as the reply handed it, so a member its type does not name reaches the row. (AC2)
- D3929: The version 10 migration never creates the evidence table. The test opens a store at each of versions 1 to 10 and stores and reads evidence in each; its one mutation is version 10's line, so the other nine lines are asserted and not mutated. (AC3)
- D3930: A new store is created without the evidence table; the test reads each record back whole through a store opened again. (AC3)
- D3931: The evidence is read before the snapshot the latest discovery and runs are read from. (AC6)

The digest, the standings and the resolver, in `packages/daemon/test/defects/definitions.test.ts`, over definitions resolved from real files:

- D3932: The definition digest leaves out the mutation's new text; the test varies the id, each member of the test identity, and the mutation's file, old and new. (AC4)
- D3933: The definition digest takes the mutation's file as the definition spells it. (AC4)
- D3934: A changed definition digest never makes evidence stale. (AC5)
- D3935: An edit to the mutation's file never makes evidence stale. (AC5)
- D3936: Evidence stored under another Vitest adapter version never reads stale for it. (AC5)
- D3937: Evidence stored under another falsifier version never reads stale for it; the test also pins that it carries no reason, detail or errors. (AC5, AC6)
- D3938: Evidence stored under another Vitest version than the workspace's never reads stale for it. (AC5)
- D3939: A changed input fingerprint never makes evidence stale. (AC5)
- D3940: Stale evidence names only the first cause that holds. (AC5)
- D3941: Evidence a certain cause makes stale reads unknown while no current fingerprint can be computed. (AC5, Tests Owed)
- D3942: Evidence for a test told apart only by its position reads current while the latest discovery is not current. (AC5)
- D3943: The anchor read digests its file with CRLF folded to LF, so its digest never equals the job's. (AC5)
- D3944: A definition whose anchor is missing reads the verdict stored for its id, eligible and verified. (AC6, AC7, Tests Owed)
- D3945: A definition whose stored evidence was refused reads never verified with no reason and is not counted. (AC6, AC7)
- D3946: A module that failed to collect is said only to be listed by the discovery. (AC11)
- D3947: A standing lists every error of the intended test, with no bound. (AC8)
- D3948: Detected definitions are listed before the verdicts that are not a detection. (AC8, Tests Owed)
- D3949: Verified counts every detection whatever its evidence's freshness; the test pins every count. (AC7)
- D3950: A definition whose test passed under inputs since changed is eligible. (AC7)

The answer, in `packages/daemon/test/query.test.ts`, evidence bound as a scheduled job binds it (each definition's digest from its standing over the same files):

- D3951: Evidence nothing made stale reads current while no current fingerprint can be computed, as before a life's first reconciliation ends. (AC5)
- D3952: An answer over a scope whose every definition is verified carries a field saying so. (AC7)
- D3953: Within a state, definitions are listed by file and position alone. (AC8)
- D3954: A verdict's detail is left out of its standing; the test also pins the listed definition's eligibility. (AC8)
- D3955: The answer tells the standings the discovery is current whatever its freshness. (AC5)

The refusal log, in `packages/daemon/test/lifecycle.test.ts`, over a real store:

- D3956: The daemon never logs a refused evidence record. (AC7)
- D3957: A refused evidence record is logged at every read of the latest results. (AC7)

The command's text, in `packages/cli/test/defects-command.test.ts`:

- D3958: One definition file problem is worded as several. (AC10)
- D3959: The text leaves out the count of each cause of staleness; the test pins the verified, freshness, reason and unreadable lines beside it. (AC10)
- D3960: The text lists no verdict that is not a detection. (AC10)
- D3961: The text leaves out a never verified definition whose stored evidence was refused. (AC10)
- D3962: The text adds a line saying every defect is verified when verified equals the total. (AC10)

Records re-anchored or repaired, each re-proved, with the defect each still names:

- The 16 migration records of `store/schema.ts` (D2097, D2098, D2122, D2260, D2791, D2792, D2829, D2830, D2831, D2846, D2859, D3040, D3041, D3128, D3129, D3351): each anchor and mutation now holds the evidence table's statement, and their tests pin version 11. D2792's sentence names version 10, the version its mutation now creates; its test pins the literal 11, so it still detects a store created at any other version.
- D1883 and D3273 (`query/summary.ts`): anchored on the one `currentFingerprint` reader.
- D3721 (`query/defects-answer.ts`): anchored on the one `discoveryCurrent`. The standings read the same value, which D3955 detects on its own.
- D3732: mutates `defects/defect-states.ts`, where the states' order now lives, and still lists anchor missing after never verified.
- D3704 and D3729 (`packages/cli/src/commands/defects.ts`): D3704 drops anchor missing from the section of definitions that cannot run; D3729 drops the not-listed line, which is now always printed, and its sentence speaks of every state.
- D2691: its `new` text builds a `LatestResults` literal, now with the evidence members.
- D3695, D3705, D3730: tests updated for the seven states, the new counts and a listed detection; mutations unchanged.

Logged or expected gaps that turned out covered:

- AC9: the protocol-version tests in `server.test.ts`, `daemon.test.ts`, `lifecycle.test.ts` and `cli.test.ts` read `PROTOCOL_VERSION` and send it plus and minus 1 (`docs/testing.md` § What the daemon is doing in every answer), so the raise to 5 is refused on both sides by tests that already existed.
- AC3, reading runs and discoveries as before: the per-version tests listed above, once repaired.
- AC6 and C173, the moment taken after the file reads: D3710, since the evidence rides the same `results` the moment hands over, and D3931 for the store's one snapshot.
- AC7, every count complete whatever the listing bounds: D3695 over 503 definitions, since the new counts come from the same pass over every standing.

#### Deliberately Untested

- `packages/daemon/src/defects/resolve-definitions.ts` (`FAILED_IN_A_PROJECT`): a consumer would read that none of a module's tests is discovered though another project discovered some; it needs one module collected under two Vitest projects and failing in one, and Fleet Cooling's five Vitest configs declare no projects.
- `packages/daemon/src/defects/defect-standings.ts` (non-assertion errors listed first): a consumer would see three assertion errors listed and the thrown error only counted as not listed; it needs a test holding more than three errors with the thrown one after three assertion errors, and Fleet Cooling uses no `expect.soft`.
- `packages/daemon/src/query/defects-answer.ts` (`cutTexts`): a consumer would get the answer refused whole by the server's size check, which is loud, instead of a cut name; it needs a suite or error name over 1,000 characters.
- `packages/daemon/src/store/defect-evidence.ts` (a record of another falsifier version whose verdict is none of the four): a consumer would see a state outside the seven in the counts; it needs a later falsifier version that adds a verdict, then a downgrade over the same store.
- `packages/daemon/src/defects/defect-standings.ts` (no digest on an invalid definition): no answer reads the digest of an invalid definition, so nothing a consumer sees would differ.
- `packages/daemon/src/store/schema.ts` (the table's `CHECK` constraints and primary key): the write refuses every empty binding before any SQL runs (D3916) and replaces by delete and insert (D3912), so a consumer would see a difference only if those checks were removed too.
- `packages/cli/src/commands/defects.ts` (AC12, what the command loads): ticked on the dev's static import walk; a test would need a module-graph harness, which is repository tooling, and a wrong import changes no answer.
- `packages/daemon/src/client.ts`, `packages/daemon/src/daemon/protocol.ts`, `packages/daemon/src/falsify/verdict.ts`: re-exports, one version literal and two exports in place; no branch to break.
- `packages/daemon/src/store/defect-evidence.ts` (AC1's last sentence, storing starts no job and changes no stored run or discovery): the write is synchronous over one table and holds no executor, so no one-edit mutation produces the defect; D3912 pins that a write leaves every other evidence record alone.

#### Proof

Every record this lane added, re-anchored, holds in an edited test file, mutates in a file the build edited, or reaches through the changed stand-in store: 943 of the catalog's 3,185, each platform as one run through the run lease, over the tree at dfe58a34 with this session's 13 test files.

- Windows, Node 24.19.0, 05:04 to 05:24 on 2026-10-01: `node scripts/verify-defects.mjs --ids <943 ids>`, 943 of 943 detected, baseline green before and after, exit 0. D3932's test gained its id case at 05:25, and D3932 and D3933, the two tests its helper serves, were proved again at 05:29: 2 of 2, exit 0.
- Linux (WSL clone `~/rt-test-t3-4-tests`), Node 24.13.1, 05:30 to 05:37: the same command over the same ids, 943 of 943 detected, baseline green before and after, exit 0.
- The touched suites on Windows: `store.test.ts` 155 of 155, `defects/definitions.test.ts` 69 of 69, `query.test.ts` 131 of 131, `lifecycle.test.ts` 182 of 182, `defects-command.test.ts` 11 of 11, and `waits.test.ts`, `changes.test.ts` and `falsify/verdict.test.ts` 80 of 80. `bun x oxlint` and `bun x prettier --check` over the touched files, `bun run --filter @rt-test/daemon typecheck`, `bun run --filter rt-test typecheck` and `node scripts/check-defects.mjs` (3,185 named defects) each exit 0.
- Not run by this session: `bun run check`, the repo-wide suite, and any run under Node 22.

#### State for the review's gap rounds

The orchestrator accepted the green report at 05:40 on 2026-10-01 and committed the tests on `wt/1` at d1ee3480, with `main` merged in at d5d092ec; the tree was clean then. The tests session handed off at 05:41 to its successor `rt-t3-4-tests-2`, threadId 99a15760-1848-46fc-9e73-099e2c7add9a, which answers the review's `#### Test Coverage Gaps` rows: wake that threadId with a gap round.

- Reserve ids for gap tests: D4003, D4004 and D4005. The first gap round used D3963, D3964, D3965 and D3996 to D4002.
- A gap test's helpers: `ranReply`, `judgementOf` and `detectionFor` in `packages/daemon/test/experiment-facts.ts`; `storeReply`, `refusalsOf` and `evidenceAfter` in `store.test.ts`; `standingsIn`, `besideCurrent` and `lastDigests` in `defects/definitions.test.ts`; `withDetections` in `query.test.ts`; `afterEvidenceStored` in `lifecycle.test.ts`; `printedLines` in `defects-command.test.ts`.
- Proving: the verifier refuses a run if any file under `packages/` changes while it runs, and checks every anchor in the catalog before it proves one. A round proves its own ids with `--ids` through the run lease (`--lane t3-4`), on Windows and then in the WSL clone `~/rt-test-t3-4-tests` (clone of `/mnt/c/source/rt-test`, last at d5d092ec with the first gap round's 9 files copied in, so it needs `git fetch` and a checkout of the lane's HEAD first). Node 24 in WSL is `~/.nvm/versions/node/v24.13.1/bin`, off the login PATH, and bun is `~/.bun/bin`.
- Scratch, kept until the orchestrator closes the run: `_agent-docs/.scratch/t3-4-tests/` holds `proof-ids.txt` (the 943 ids), `proof-selection.mjs` (recomputes that selection), `show-records.mjs` (prints records and stale anchors), `wsl-clone.sh` and `wsl-prove.sh`, and every run's log.

#### Gap round 1: the review's nine rows

By `rt-t3-4-tests-2`, threadId 99a15760-1848-46fc-9e73-099e2c7add9a, on 2026-10-01 from 05:56 to 06:09, over the tree at d5d092ec, which the review left with no production edit. The orchestrator ruled at 05:53 that all nine rows are worked as one round. Each row was checked against the test files first and is a real gap: no test stored facts holding `notRun`, read a version 10 store's discovery back, counted a reason for unknown above zero, read two reasons, read listed errors or `eligible: false` from the answer, printed a detail holding a list, or took a digest from a second definition file.

Named defects, each proven, by the review's row:

- Row 1, D3963: A verdict decided without a run cannot be stored: the facts' not-run branch is dropped, so a no-probe-site or no-module verdict is refused and takes its whole reply with it. (AC1) In `store.test.ts`, over a reply whose two experiments decided before any run carry `not-run` records, as the job leaves them.
- Row 1, D4002: An unclear verdict whose confirming run differed is rebuilt without what its confirming run read, so the store refuses it and its whole reply. (AC1) The row offered this shape as a further case of D3963's test. It has a test and a mutation of its own instead, so no title claims more than its record proves. Decided by this session.
- Row 2, D3964: The version 10 migration drops every workspace's stored selection facts, as the migrations of versions 3 to 8 do. (AC3) A new test beside D3929, whose test is unedited.
- Row 3, D3965: The count of each reason for unknown is never incremented. (AC7) Its standings hold one definition under one reason and one under both, so it also pins that a definition is counted under every reason that applies.
- Row 4, D3996: Evidence that reads unknown names only the first reason that applies. (AC5)
- Row 5, D3997: The answer leaves out the errors of a not-an-assertion verdict, or the number of them it did not list. (AC8) Its mutation leaves out both. Its five errors read the same three first whichever kind is listed first, so it does not pin the order left under Deliberately Untested.
- Row 6, D3998: Every listed definition says it is eligible. (AC8)
- Row 7, D3999: A verdict's detail that holds a list prints each entry under its index. (AC10)
- Row 8, D4000: The definition digest covers the definition file it sits in. (AC4)
- Row 9, D4001: The logged-once guard keys on the refusal's reason alone, so a second defect refused for the same reason is never logged. (AC7) D3957's test goes red on its mutation too.

Deliberately Untested gains nothing.

Files, each modified and none created:

- Add-only, so the records already in them were not proved again (`_agent-docs/crew.md` § Gates): `packages/daemon/test/store.test.ts`, `packages/daemon/test/query.test.ts`, `packages/daemon/test/lifecycle.test.ts` and `packages/cli/test/defects-command.test.ts`. Each diff deletes no line and adds only imports, declarations and test blocks.
- `packages/daemon/test/defects/definitions.test.ts`: not add-only. `checked`, `resolvedIn` and `standingsIn` now take the definition file a case names, defaulting to the one they always used, which D4000 needs. Every record whose test is in the file was proved again, 72 with the three new ones.
- `packages/daemon/test/experiment-facts.ts`: `ReplyExperiment.facts` reads `ExperimentFacts` where it read `RanFacts`, a type alone, so no record whose test calls `ranReply` was proved again.
- `packages/daemon/test/defects.json` (D3963, D3964, D3997, D3998, D4001, D4002), `packages/daemon/test/defects/defects.json` (D3965, D3996, D4000) and `packages/cli/test/defects.json` (D3999): records appended.

Proof, 79 records (the 72 of `definitions.test.ts` and the seven new ones elsewhere), each platform as one run through the run lease:

- Windows, Node 24.19.0, 06:06 to 06:07: `node scripts/verify-defects.mjs --ids <79 ids>`, 79 of 79 detected, baseline green before and after, exit 0.
- Linux (WSL clone `~/rt-test-t3-4-tests` at d5d092ec with the 9 files copied in), Node 24.13.1, 06:08: the same command over the same ids, 79 of 79 detected, baseline green before and after, exit 0.
- The touched suites on Windows, 06:09: `store.test.ts`, `query.test.ts`, `lifecycle.test.ts`, `defects/definitions.test.ts`, `falsify/verdict.test.ts` and `defects-command.test.ts`, 6 of 6 files, 591 of 591 tests, exit 0. `bun x oxlint` and `bun x prettier --check` over the touched files, `bun run --filter @rt-test/daemon typecheck`, `bun run --filter rt-test typecheck` and `node scripts/check-defects.mjs` (3,195 named defects) each exit 0.
- Not run by this session: `bun run check`, the repo-wide suite, and any run under Node 22.
- Scratch: `gap-proof-ids.txt` (the 79 ids), `gap-prove-windows-1.log`, `gap-prove-linux-1.log`, `gap-suites-1.log` and `gap-testing-doc-text.md` (the `docs/testing.md` text sent to the orchestrator).

### Review Record

Review session: threadId 3bbe47c2-8c7e-4f5e-b07a-7f5748b3d2fa (rt-t3-4-review)

By review-changes on 2026-10-01, from 05:40, over `git diff main...wt/1` at d5d092ec (30 files) and the doc lines of the authoring commits 0f6eb4b3 and e473c80b.

#### What the review ran

- Six fresh-eyes batches (store, defects, query, lifecycle, the falsify exports with the protocol and the client, the CLI), one doc verification and one check of installed third-party behavior, beside the reviewer's own pass over the 15 production files against the ticket's 43 checklist rules and 14 project-context rules. `changes.test.ts` and `waits.test.ts`, six added lines between them, were read by the reviewer and not batched.
- No product guarantee is broken and every criterion holds in the code. The store's rebuild names every member of every fact type and of every judgement that has a verdict, and nothing else. ADR-0004 and ADR-0007 are met: evidence stays in the local store, and the six bindings ADR-0007 names are the six causes of staleness.
- Third-party behavior, on Vitest 4.1.11 and 5.0.1, read in `node_modules/.bun/`: the resolution under § Unverified Assumptions is confirmed line for line, and each closed set in `store/evidence-facts.ts` (test states and modes, module states, hook names and states) holds every member either line declares or can produce. An error's serialized `name` can be absent or not a string; `errorFact` in `falsify/run-facts.ts` keeps a name only when it is a string, so none reaches a reply's facts as anything else.
- Size: every production file is under the cap, the closest `store/evidence-facts.ts` at 470 code lines and `client.ts` at 463.

#### Findings fixed

No code finding needed a production edit. The discrepancies in this record, each fixed here:

- The doc text's replacement for "and every other one is never verified." began mid-sentence after a comma, so applying it as written ran two sentences together. It now takes the comma with it.
- The Results store text listed the write's refusals and left out a reply with no list of judgements or of experiment records (`ranReply` in `store/defect-evidence.ts`).
- The Results store text was to go "after the sentence on a refused run", of which there are two, and before a sentence whose "It" would then name the wrong subject. The insertion point is now exact.
- "Fourth paragraph" named the fifth once the third is replaced by two. It now names the paragraph by its opening words.
- The README text said every valid definition reads `never-verified`; one whose anchor is missing reads `anchor-missing`.
- The README text gave `unknown` one cause; the standings give two (`no-current-fingerprint`, `duplicate-test-discovery-not-current`).
- The README text's list of what the command prints left out the section of never verified definitions whose stored evidence could not be read.
- The File List left out the 13 test files of d1ee3480.

#### Doc text for files the orchestrator owns

- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.5. "A job given no experiment, or whose every experiment was decided before any run, reads `ran` with no baseline and an empty list of judgements (3.3's review)." is false in its second case: `all()` in `falsify/falsify-workspace.ts` returns every record decided before a run when nothing was planned, the judge gives each a judgement, and `no-probe-site` and `no-module` are verdicts. Replace with: "A job given no experiment reads `ran` with no baseline and an empty list of judgements. A job whose every experiment was decided before any run reads `ran` with no baseline and one judgement for each, of which a no-probe-site and a no-module judgement are invalid experiment verdicts that `writeEvidence` stores (3.3's review, corrected by 3.4's)."
- `docs/architecture.md`, the Section menu's `Defects query` entry still says "the three states"; the replacement is the first item under § Doc text for the orchestrator.
- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.4b cites "Requirements: FR5, FR22." and FR22's marker in `docs/requirements.md` lists only tickets 3.1 and 3.4. Ticket 3.4 completes the `defects` query FR22 names and 3.4b moves its counts into the summary, which is FR5: drop FR22 from the 3.4b line.
- The same file, the paragraph under § Ticket 3.3b, says "a file the consumer declares a non-input is in no input fingerprint". That holds for a mutation's file and not in general: `workspaceFingerprint` digests every listed test module, setup file and global setup file the inputs leave out. Replace "a file" with "a source file".
- `docs/testing.md` holds a paragraph for each ticket's named defects and none for D3910 to D3962, the records re-anchored beside them, or this review's gap round. The tests session owns the wording.

#### Questions and rulings

- Asked of the orchestrator at 05:52; decided by the orchestrator at 05:53. Nine criterion clauses hold in the code with no test that goes red when they break, each a join between a proven function and the layer its criterion names, past the dispatch's line of a third finding of one kind. Ruling: send all nine to the tests session as one gap round. "This is no design question. The kind is a coverage habit, proving the function and not the layer the criterion names, and it ends with this round." Each is the main path of its clause in Fleet Cooling's checkout: refused placements, a version 10 store, `it.each` in 92 of 988 test files, suite hooks in 10, an ordinary `TypeError`.
- Decided by this session, accepted by the orchestrator at 05:53. AC10's "the number of errors not listed": the text leaves the clause out when the number is zero, and absence reads as zero. Printing it costs an edit to `packages/cli/src/commands/defects.ts` and a proof of each record that mutates it on both platforms.
- Decided by this session, accepted by the orchestrator at 05:53. `ListedEvidence` carries `reason`, a verdict's reason from a closed set, beside `omittedCharacters`, the characters cut from its detail and errors: the two keys that elsewhere form a cut free text. No number is wrong and each member's type says what it is, so it stays.
- Decided by this session. The dev's fork on a write refusal's `cause`, which quotes the offending value: keep the value. It reaches an error's text and the local log, never a row, and AC2 speaks of records.
- Decided by this session. `client.ts` re-exports `StaleCause` and `UnknownReason`, which no file under `packages/cli/src` names. Nine other names it re-exported before this ticket have none either, so that entry is the package's programmatic surface and the two follow it.

#### Findings left

Each says what a consumer would see and what must coincide. None is one Fleet Cooling's checkout meets, by the owner's rule of 04:43 on 2026-10-01.

Unproven clauses, not sent as gaps:

- `daemon/refusal-notes.ts`: a defect refused again for a different reason, or again after a read that did not refuse it, is not logged, so the log lacks the text an answer points to. It needs a refused evidence record, then a second refusal of the same defect in one daemon life.
- `query/defects-answer.ts` (`listedDefinition`): a listed never verified definition loses the refusal as its reason while the count says one record is unreadable. It needs a refused evidence record.
- `packages/cli/src/commands/defects.ts` (`evidenceText`): the clause saying characters were cut is printed wrongly or not at all. It needs a suite or error name over 1,000 characters.
- `packages/cli/src/commands/defects.ts` (`notListedLine`): the hint to ask for a narrower path is tied to the wrong condition. It needs a regression in that one comparison; the per-state numbers beside it are proven (D3729).
- `store/defect-evidence.ts` (`evidenceId`): each record of one reply gets its own identity, or every reply shares one. No answer and no production code reads the member.
- `defects/defect-standings.ts`: evidence in one workspace is rated by another's Vitest version or fingerprint. Every standings test holds one workspace; ticket 3.7's corpus holds two.
- Tests whose title claims more than their record proves, each still detected: D3937 (the record it reads is a detection, which carries no reason under any version; D3924 proves the store withholds them), D3943 (its byte order mark is a literal character in the test's source), D3960 (the error with no name is not asserted), D3962 (it compares two outputs and would pass on two empty ones), D3959 (the unreadable count equals three other counts in its fixture).

Behavior, each loud or in the safe direction:

- `store/evidence-facts.ts` (the closed sets): a Vitest release that records a hook name or a state outside them has every reply holding one refused whole, so that workspace's defects stay never verified. Both supported lines declare exactly the sets held.
- `store/defect-evidence.ts` (`ranReply`): a reply of another falsifier version is stored with a reason and facts no read interprets. It needs an executor and a daemon of different builds.
- `store/defect-evidence.ts` (`definitionDigest`): a caller handing in something other than a map gets a `TypeError` and not a named refusal. Ticket 3.5's caller is typed.
- `defects/defect-standings.ts` (`definitionDigest`): the digest is stable only while every caller hands in the consumer root as `checkDefinitions` was given it, and a file respelled in another letter case reads stale. Stale is the safe direction.
- `defects/defect-standings.ts` (`judgementParts`): the standings withhold a reason for another falsifier version only because the store hands them no judgement. `StoredEvidence` allows one beside any version.
- `defects/resolve-definitions.ts` (`listedModuleText`): a definition naming one Vitest project is told its module failed to collect when it failed in another. It needs a module collected under two projects.
- `defects/resolve-definitions.ts` (`readMutationFile`): the file is read and digested whole with no size bound. It needs a definition naming a very large file.
- `daemon/refusal-notes.ts` (`EVIDENCE_REFUSED_ENTRY`): the log says the defect reads never verified when its definition is invalid, lost its anchor or was removed. It needs a refused record for such a definition.
- `packages/cli/src/commands/defects.ts` (`detailText`): a suite name holding a comma and a space reads as two. The heading of the unreadable section names the only reason a never verified definition carries today.
- `falsify/verdict.ts`: `rt-test defects` loads the judge for four names. AC12 holds, since that module's one run-time import is `fact-types.ts`, which imports types alone.

#### Tech debt

Undisposed, triaged against the committed change.

- `PASSED` is declared at `query/changes-answer.ts:87` and again at `defects/defect-standings.ts:65`. Fix: export one from `query/answer.ts`.
- `RUN_EXECUTIONS` at `store/evidence-facts.ts:161` equals the private table at `store/read-runs.ts:75`, and `isNonEmptyText` at `store/defect-evidence.ts:367` mirrors the private `requireNonEmpty` at `store/stored-records.ts:85`. Fix: export each from its first home.
- A zero-filled tally is built by `zeroCounts` at `query/test-states.ts:231`, by `zeroTally` at `defects/defect-standings.ts:227`, and a per-state record again in `listedDefinitions` in `query/defects-answer.ts`, where `DefectStateCounts` restates the type of `DefectStandingCounts.states`. Fix: one exported tally helper and type.
- `#noteEvidenceRefusals` in `daemon/refusal-notes.ts` is a copy of `#noteRunRefusals` beside it, differing in the key and the entry text, so the run path's five records guard one copy only. Fix: one keyed helper and two thin callers. It moves nine anchored records.
- `packages/cli/src/commands/defects.ts`: `keyedCounts` over the freshness values repeats half of `countLines` at `packages/cli/src/answer-text.ts:159`; `sectionLines` is the shape `notDiscoveredLines` (`:518`) and `executionLines` (`:304`) write by hand, as `invalidEntryLines` and `gapLines` in the command still do; `errorsText` rebuilds `namedText` (`:399`). Fix: move `keyedCounts` and `sectionLines` to `answer-text.ts`.
- `packages/daemon/test/experiment-facts.ts`: it imports `./harness.js` (`:24`) for one constant, so `falsify/verdict.test.ts`, which loaded only the judge, now loads the harness with Vitest and the run and fingerprint modules; `RanJob` (`:27`) repeats `test/falsify/job-readings.ts:4`, `judgementOf` (`:167`) shares a name with the different function at `job-readings.ts:22`, and `COLLECTED`, `judgementOf` and `RanJob` are exported with no importer.
- Before this ticket, `store/schema.ts`: each entry of `STORE_MIGRATIONS` spells its whole path to the current version, so this bump edited nine entries and re-anchored sixteen records. Fix: compose each entry from one step per version.
- Before this ticket, `packages/cli/src/commands/defects.ts`: "of which 1 are gaps" (`:105`); an empty path argument prints "The path path is empty." (`:62`); and no test prints a definition whose id is null.
- Before this ticket, `packages/daemon/test/scheduling-harness.ts:199` and `:269`: the stand-in store gives every discovery the id "discovery", where production code keys on that id changing.
- Before this ticket, `query/summary.ts` holds `queryBasis` and `cutReason`, which every answer and `daemon/workspace-schedule.ts` read.

#### For the tickets that follow

- 3.5: hand `defectStandings` the consumer root exactly as `checkDefinitions` was given it, or every digest it stores differs from the one the query computes and all evidence reads stale. `RecordingStore.writeEvidence` in `test/scheduling-harness.ts` always throws and its latest results hold no evidence, so a lifecycle test over the stand-in cannot see evidence stored: give it a recording write first. `readLatestResults` now parses, rebuilds and judges again every evidence record of the scope on every read (summary, path status, waits, changes and each plan); measure it over a few thousand records before a job fills the table. A job whose every experiment was decided before a run still carries verdicts to store (the sprint text above).
- 3.7: the two-workspace fixture is the first test of the standings' lookups by workspace.
- 3.8: a whole-worktree answer at both listing bounds is unmeasured with evidence on every listed definition.

#### Validation

Over the tree at d5d092ec with the gap round's ten changed test files and this record, on Windows, 2026-10-01. This review's own fix round is this file alone, outside every compiled graph, so its typecheck is skipped for that reason; the gap round's files were typechecked by the tests session at 06:09 over the same tree (Tests Record § Gap round 1).

- The suite, 06:10, through the run lease: `bun x vitest related` over the six test and helper files the gap round edited selected 6 of 84 test files; 591 of 591 tests passed, exit 0.
- `bun x oxlint` over those six files and `bun x prettier --check` over the ten changed files, 06:10: each exit 0.
- `node scripts/check-defects.mjs`, 06:10: 3,195 named defects, each test with one record and each anchor matching once, exit 0.
- `node scripts/check-line-citations.mjs`, 06:10: clean.
- `node scripts/check-sprint-keys.mjs` and `node scripts/check-requirement-markers.mjs`, 06:11: each exit 0.
- Named defects: the tests session proved the gap round's 79 records by id on Windows and on Linux Node 24, 79 of 79 on each (Tests Record § Gap round 1). The reviewer read each new test and record against its row.
- Not run by this session: `bun run check`, the repo-wide suite and typecheck, and any run on Linux or under Node 22.

#### Test Coverage Gaps

Answered by the tests session at 06:09 on 2026-10-01, every row closed by a named test proved on both platforms: row 1 by D3963, with D4002 for the unclear verdict whose confirming run differed; row 2 by D3964; row 3 by D3965; row 4 by D3996; row 5 by D3997; row 6 by D3998; row 7 by D3999; row 8 by D4000; row 9 by D4001.

Sent to the tests session at 05:55 on 2026-10-01 by the orchestrator's ruling of 05:53. Each severity is what the defect would cost if it landed; none is present in the code today. A gap test that only adds lines to its file leaves the records already there unproved again (`_agent-docs/crew.md` § Gates).

| #   | Source                                                                                  | Defect                                                                                                                                                                        | Expected test                                                                                                                                                                                                                                                                                                                                                                                                      | Severity                                               |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1   | `packages/daemon/src/store/evidence-facts.ts` (`storedFacts`), AC1                      | A verdict decided without a run cannot be stored: the facts' not-run branch is dropped, so a no-probe-site or no-module verdict is refused and takes its whole reply with it. | `store.test.ts`, over a real store through `writeEvidence`: a reply holding a no-probe-site verdict and a no-module verdict beside a detection reads each record back whole, the site's members included. No test stores facts holding `notRun` today, and the reply helper types its facts as `RanFacts`. The test may also drive an unclear verdict whose confirming run differed, the other shape never stored. | MEDIUM, daemon-state, fails loudly                     |
| 2   | `packages/daemon/src/store/schema.ts` (the version 10 entry of `STORE_MIGRATIONS`), AC3 | The version 10 migration drops every workspace's stored selection facts, as the migrations of versions 3 to 8 do.                                                             | `store.test.ts`: a store written at version 10 reads its run and its discovery back after the migration as they were stored. D3929 opens each version and asserts the header and the evidence alone.                                                                                                                                                                                                               | HIGH, daemon-state, loses stored state without failing |
| 3   | `packages/daemon/src/defects/defect-standings.ts` (`countDefectStandings`), AC7         | The count of each reason for unknown is never incremented.                                                                                                                    | `defects/definitions.test.ts`, over real standings holding one that reads unknown: the counts give that reason 1 and unknown freshness 1. D3949 expects zero under every reason.                                                                                                                                                                                                                                   | HIGH, consumer                                         |
| 4   | `packages/daemon/src/defects/defect-standings.ts` (`evidenceFreshness`), AC5            | Evidence that reads unknown names only the first reason that applies.                                                                                                         | `defects/definitions.test.ts`: a test told apart only by its position, the discovery not current and no current fingerprint, reads unknown naming both reasons.                                                                                                                                                                                                                                                    | HIGH, consumer                                         |
| 5   | `packages/daemon/src/query/defects-answer.ts` (`listedEvidence`), AC8                   | The answer leaves out the errors of a not-an-assertion verdict, or the number of them it did not list.                                                                        | `query.test.ts`, beside D3954: a stored unclear verdict whose intended test held five errors is listed with three, each a kind and a name alone, and 2 not listed.                                                                                                                                                                                                                                                 | HIGH, consumer                                         |
| 6   | `packages/daemon/src/query/defects-answer.ts` (`listedDefinition`), AC8                 | Every listed definition says it is eligible.                                                                                                                                  | `query.test.ts`: a listed definition whose test holds no current pass reads `eligible: false`. D3954 asserts only `true`.                                                                                                                                                                                                                                                                                          | HIGH, consumer                                         |
| 7   | `packages/cli/src/commands/defects.ts` (`detailText`), AC10                             | A verdict's detail that holds a list prints each entry under its index.                                                                                                       | `defects-command.test.ts`: a listed invalid experiment whose detail is a suite error's name path prints the names as a list. The only detail any test prints is flat.                                                                                                                                                                                                                                              | MEDIUM, consumer, cosmetic                             |
| 8   | `packages/daemon/src/defects/defect-standings.ts` (`definitionDigest`), AC4             | The definition digest covers the definition file it sits in.                                                                                                                  | `defects/definitions.test.ts`: one definition read from a second definition file digests as it does from the first. D3933 varies the position, the texts and the spellings, never the file.                                                                                                                                                                                                                        | MEDIUM, consumer, the safe direction                   |
| 9   | `packages/daemon/src/daemon/refusal-notes.ts` (`#noteEvidenceRefusals`), AC7            | The logged-once guard keys on the refusal's reason alone, so a second defect refused for the same reason is never logged.                                                     | `lifecycle.test.ts`: D3957's test already asserts it and goes red on it; the defect needs a named test and record of its own.                                                                                                                                                                                                                                                                                      | MEDIUM, daemon-state                                   |

### Completion Notes

Built by rt-t3-4-dev on 2026-10-01, from 03:05 to 04:30, with the owner's pause from 03:47 to 04:18. Every task is done; no test was written or run.

#### What was built

- `defects/defect-states.ts` holds the seven states in AC8's order, taking the four verdict values from `VERDICT`, and the two printed sets. It loads only `falsify/verdict.ts` and, through it, `falsify/fact-types.ts`.
- `defects/defect-standings.ts` holds the definition digest, `defectStandings` and `countDefectStandings`. A definition that is invalid or anchor missing reads that and no stored evidence. Evidence freshness is computed there and nowhere stored: six causes of staleness, each named when it holds, the fingerprint's rated by `assessFreshness`; unknown only when none holds.
- `defects/resolve-definitions.ts`: each anchor read carries `wholeDigest` of the text it read, handed on as the resolved definition's `mutationFileDigest`; the not-discovered reason names a module that failed to collect.
- The store (`store/schema.ts`, `columns.ts`, `evidence-facts.ts`, `defect-evidence.ts`, `open-store.ts`): the `defect_evidence` table, schema version 11 with a path from each of versions 1 to 10, `writeEvidence`, and the evidence read inside `readLatestResults`' one read transaction.
- `query/summary.ts` hands `QueryBasis` the one fingerprint reader; `query/defects-answer.ts` takes the standings, counts and listing; `daemon/refusal-notes.ts` logs each evidence refusal once while it stands; `PROTOCOL_VERSION` is 5; the CLI prints the new counts and sections.

#### How it was built

- Assumptions: none in the table; the resolutions beneath it record the `DELETE` and `INSERT` choice and the Vitest unions the store's closed-set tables rest on.
- Sanity check: four findings, all confirmed by the author and applied to the ticket before any edit (Dev Notes § Sanity check).
- Delegation: I built the contract first (the states module, the two exports of `falsify/verdict.ts`, the stored record's types), then one background agent built the store's five files while I built the answer group in the main loop, over disjoint files. One wave gate over the union.
- The store's rebuild sits in two files, by the orchestrator's ruling of 04:20 (Dev Notes § Questions to the orchestrator). Margin is thin, 470 and 413 code lines: the next member a fact type gains likely needs a third store file.
- `ResolvedDefinition.state` is narrowed to the three states the files and the discovery alone give; the standing carries the state an answer reads.
- The CLI reads the names of the causes and of the unknown reasons from the answer's own counts, in the answer's order, so it loads neither `defects/defect-standings.ts` nor `falsify/experiment-record.ts`.
- In `daemon/refusal-notes.ts` the new method parallels `#noteRunRefusals` and shares no helper with it, to leave the nine anchored records of that file untouched.

#### The error-name bound

`MAX_LISTED_ERRORS` is 3, in `defects/defect-standings.ts`. Stated sizes: a suite, test or error name of 30 characters, a name path 3 deep, root-relative paths of 50 characters, a 12-character id, and all six causes of staleness. Measured with `JSON.stringify` on a listed definition of those sizes: 1,126 bytes for an unclear definition with 3 errors, 1,131 for one whose detail is a confirming run's suite error, 941 for an invalid one with a 200-character reason. A listing of 500 at the largest is 565,500 bytes, 53.9% of the 1,048,576-byte line; the 3 errors are 172 bytes of each definition, 86,000 of the listing. At a bound of 5 the same listing measured 620,000 bytes, 59.1%, before the gap lists, which at their own bound of 1,000 tests take about a quarter of the line. Worst case: 500 definitions with 3 names each at the 1,000-character cut are 1,500,000 characters, past the line, and a name path has no ceiling of entries; the server's size check refuses such an answer whole.

#### Adversarial review

One cold reviewer over the 15 files returned 11 findings (2 high, 6 medium, 3 low). Fixed: F1 (a verdict, reason or detail the judge does not give the facts beside it is refused, both ways), F2 (every judgement and experiment record of a reply must be an object naming a defect id, a defect two judgements name refuses the reply, and a reply without a list of experiment records is refused), F3 (the errors that are not assertions are listed first), F8 (the binding's docblock says an unvouched job stores nothing), F9 (`jsonCount`: a whole number from 0), F10 (`DEFECT_STATES` is `Object.values(DEFECT_STATE)`), F11 (the write's refusal says the cause speaks of the row the reply would make). Discarded F4, a text section for stale detections: the design decision "The text lists problems, and counts the rest" stands. F5, F6 and F7 went to the orchestrator, which kept all three at 04:25. A disposable probe over the real `writeEvidence` and `judge`, with a map standing in for the database and since deleted, stored and read back nine reply shapes (survived, three invalid reasons from a run, not-an-assertion, confirming run differed, detected, baseline not passed, no probe site) with no refusal and no stray member in a row, and saw five broken replies refused with the rows unchanged.

#### Gates

At 04:22 on 2026-10-01, over the tree as it stands, on Windows: `bun run --filter @rt-test/daemon typecheck` exit 1 with no error in `src` and 34 in five test files; `bun run --filter rt-test typecheck` exit 1 with no error in `src` and 6 in one test file; `bun x oxlint` over the 15 files exit 0 with no warning; `bun x prettier --check` over the 15 files exit 0. `node scripts/check-line-citations.mjs` named two hits in this ticket's states task, both `grep -c` counts and not line citations, so nothing was re-pointed. Not run by this session: any test, `bun run check`, the repo-wide typecheck and lint, and every gate on Linux.

#### Acceptance evidence

- AC9: `PROTOCOL_VERSION` rose from 4 to 5 in `daemon/protocol.ts`; `daemon/server.ts` and the client's `provenRequest` are unchanged, so a hello of the other version still gets `VERSION_MISMATCH_CODE`; `CLI_JSON_SCHEMA_VERSION` in `packages/cli/src/output.ts` is untouched.
- AC12: a static walk of the run-time imports from `packages/cli/src/commands/defects.ts` reached 64 modules: `defects/defect-states.ts`, `falsify/verdict.ts` and `falsify/fact-types.ts` among them, and neither `defects/resolve-definitions.ts`, `falsify/anchor-match.ts`, `defects/defect-standings.ts`, `falsify/experiment-record.ts` nor any Vitest package.
- Every other criterion is owed a test (Dev Handoff).

#### Known limits the build confirms or adds

Confirmed as the Dev Notes list them. Added by the build, both in Dev Notes § Known limits: the Vitest version's cause lags the rediscovery, and identifying fields are carried whole. One more, in the safe direction: the definition digest names the mutation's file as the definition spells it once normalized, so on a file system that folds case, respelling the file in another letter case changes the digest and the evidence reads stale until it is verified again.

#### Doc text for the orchestrator

`docs/architecture.md`, the Section menu's `Defects query` entry. Replace "the anchor count, the three states, the gaps" with "the anchor count, each definition's state and stored evidence, evidence freshness and its causes, the counts, the gaps".

§ Results store. Insert before the sentence "It refuses, leaving the file unchanged, a store of any other schema version or a file that is not an RT Test store.", and open that sentence with "`openStore` refuses" in place of "It refuses", since the text inserted before it would change what "It" names:

> The store also keeps defect evidence, one record for each defect id in a project and worktree, in the table `defect_evidence`. `writeEvidence` stores a `ran` falsification reply's judgements that have a verdict, each replacing that defect's earlier record, all in one transaction and each read back before it commits. A record holds the verdict, its reason and detail, and its facts, each rebuilt member by member from what its type names, so no error message, stack, code frame or source text reaches a row, and it is bound to the project and worktree identities, an identity the store gives the reply, the definition digest handed in for the defect, the mutation file digest the reply's experiment record carries, the digest of the workspace's input fingerprint handed in, the reply's Vitest and falsifier versions, and the store's Vitest adapter version. The write stores nothing and throws, naming what is wrong, for a reply that does not read `ran`, lacks a version, or carries no list of judgements or of experiment records; a missing identity or fingerprint digest; a judgement or experiment record that is not an object naming a defect id; a defect two judgements name; a verdict with no definition digest, with no experiment record or several, or whose record carries no mutation file digest; and a verdict, reason or detail that is not the one the judge gives the facts beside it. A judgement with no verdict stores nothing and leaves the earlier record. Evidence is read with the latest discovery and runs in one read transaction. A record of another falsifier version is read as its bindings and its verdict alone. A record of the current version that cannot be rebuilt, or whose verdict its facts do not give, is refused alone: its defect reads never verified with the refusal, every other record still reads, and the log names the refusal whole, once while it stands. Schema version 11 adds the table: a store of any earlier version the opener migrates gains it empty, and version 10's code refuses the migrated store.

§ Defects query, third paragraph. Replace "No match is invalid as not discovered: the reason says whether the discovery lists that module, and says so when that discovery is not current." with:

> No match is invalid as not discovered: the reason says whether the discovery lists that module, says that the module failed to collect in that discovery, so none of its tests is discovered, when the discovery lists it as failed (or failed in one project, when it holds discovered tests in another), and says so when that discovery is not current.

Replace from ", and every other one is never verified." to the paragraph's end, the comma included, with a full stop followed by:

> Invalid wins over anchor missing, and both win over any stored evidence. Every other definition reads the verdict of its stored evidence (`detected`, `survived`, `invalid-experiment`, `unclear`), or `never-verified` when the store holds none for its id; a record the store refuses as unreadable reads as none, with the refusal as the definition's reason. Each state is one value of the Defect evidence dimension.
>
> Evidence freshness is a field of its own, present only beside a verdict, decided when the query answers and never stored. It reads stale under every cause that holds: `definition-changed` (the definition digest, a digest of the definition's id, its resolved test's whole identity and its mutation's root-relative file, `old` and `new`, differs from the record's), `mutation-file-changed` (the digest of the mutation file's text, as the anchor count just read it, differs from the one the job recorded), `another-adapter-version`, `another-falsifier-version`, `another-vitest-version` (the record's Vitest version is not the one the latest stored discovery reports for the resolved test's workspace), and `inputs-changed` (that workspace's current input fingerprint, the one its ordinary results are rated against, differs from the record's). When no cause holds it reads unknown with each reason that applies: `no-current-fingerprint`, as before a daemon life's first reconciliation has ended, and `duplicate-test-discovery-not-current`, when the resolved test is told apart only by its position and the latest discovery is not current. Otherwise it reads current. A record stored under another falsifier version gives its verdict, its freshness and its causes and nothing else. A definition is eligible when it is neither invalid nor anchor missing and its resolved test holds a current pass in the answer's own test standings, whatever its evidence. Verified counts the definitions that read detected with evidence freshness current; no field says a scope is verified, so a reader compares it with the total, which keeps every invalid entry and invalid definition.

The paragraph that begins "A definition whose test's module the latest discovery lists is in scope". Replace "the count of each state, the invalid entries and the total;" with:

> the total and the invalid entries; the count of each state, of each evidence freshness over the definitions that read a verdict, of each cause of staleness and each reason for unknown (a definition counted under every one that holds for it), of the definitions that read never verified because their stored evidence could not be read, of the eligible and of the verified, every count complete whatever the listing leaves out;

and replace "invalid first, then anchor missing, then never verified, each with its id, file, position, test as written, the resolved test identity and its duplicate mark, its mutation's file, its state and, when invalid or anchor missing, its reason cut to 1,000 characters, and the number of each state not listed;" with:

> in the order invalid definition, anchor missing, survived, invalid experiment, unclear, never verified, detected, within a state those whose evidence is not current first, then by file and position, each with its id, file, position, test as written, the resolved test identity and its duplicate mark, its mutation's file, its state, whether it is eligible, its reason cut to 1,000 characters when it is invalid, anchor missing or holds unreadable evidence, and, beside a verdict, its evidence: the freshness with its causes or its reasons, the verdict's reason and detail, and, for a verdict that is unclear because an error is not an assertion, the kind and name of up to 3 (a target) of the errors the intended test held in the experiment's run, those that are not assertions first, with the number not listed, every text in the detail and every error's name cut to 1,000 characters with the number of characters cut; and the number of each state not listed;

and add to the same paragraph: "An id, a test as written, a mutation's file and a test identity are carried whole, so one very long id or test name can take the answer past the line limit, where a narrower path does not shed a definition that lies in every scope."

§ Execution and falsification isolation. Replace "The `defects` query reads, checks and resolves them now (`Defects query`); falsification does not yet run them. A falsification job's reply carries each experiment's judgement with its facts, and nothing stores them yet." with:

> The `defects` query reads, checks and resolves them now and reads each one's stored evidence (`Defects query`); falsification does not yet run them. A falsification job's reply carries each experiment's judgement with its facts, and the store's `writeEvidence` keeps each verdict as that defect's evidence (`Results store`); nothing calls it yet, since no job is scheduled.

`README.md`, the `rt-test defects [path]` paragraph. Replace "or `never-verified`." with:

> or reads the verdict of its stored falsification evidence (`detected`, `survived`, `invalid-experiment`, `unclear`), or `never-verified` when none is stored. Beside a verdict it gives the evidence's freshness: `stale`, naming each cause (the definition, the mutation's file, the workspace's inputs, or the Vitest, falsifier or adapter version changed since the verdict), `unknown` when nothing it compares has changed but it cannot vouch for the workspace's inputs now, or for the position of a test told apart from same-named tests only by it, or `current`. No falsification runs yet, so every definition that is neither invalid nor anchor missing reads `never-verified` until a later release schedules it.

and replace "It prints the total, each state's count, each definition file problem, each definition that is invalid or anchor missing with its reason and how many more the answer did not list," with:

> It prints the total; how many are verified (detected with current evidence) against that total, and how many are eligible; each state's count; each evidence freshness count with the count of each cause and reason; how many definitions hold evidence that could not be read; each definition file problem; each definition that is invalid or anchor missing with its reason; each verdict that is not a detection with its reason, detail, listed errors and freshness; each never verified definition whose stored evidence could not be read, with why; how many definitions of each state the answer did not list;

and replace "Under `--json` it lists up to 500 definitions, problems first," with "Under `--json` it lists up to 500 definitions, problems first and detections last, each with whether it is eligible and its evidence,". No line and no field says a path passed or is verified: compare the verified count with the total.

README Status: this change adds no falsification run, so the Status list gains only that `defects` reads stored evidence.

#### Out-of-scope findings for review-changes

The first three findings are duplicates whose first homes lie outside this ticket's file list. Removing them edits five production files this ticket does not otherwise touch (`query/answer.ts`, `query/changes-answer.ts`, `store/read-runs.ts`, `store/stored-records.ts`, `query/test-states.ts`), and a round that edits a file owes a proof of every record that mutates it, on both platforms. A duplicated constant or helper can drift, which is the whole harm. They stay with review-changes. The orchestrator's recommendation (04:39 on 2026-10-01): record each as debt and fold it into the next ticket that edits its file, unless the review finds one that costs no proof.

- `PASSED` is declared privately in `query/changes-answer.ts` and again in `defects/defect-standings.ts` (C4). Fix: export one from `query/answer.ts` and import it in both. Left here: `query/changes-answer.ts` and `query/answer.ts` are outside this ticket's file list.
- `RUN_EXECUTIONS` in `store/evidence-facts.ts` equals the private table of that name in `store/read-runs.ts`, and `isNonEmptyText` in `store/defect-evidence.ts` mirrors the private `requireNonEmpty` in `store/stored-records.ts` (C5). Fix: export each from its first home. Left here: `store/read-runs.ts` and `store/stored-records.ts` are outside this ticket's file list.
- A zero-filled tally helper now exists in `query/test-states.ts` (`zeroCounts`, private) and `defects/defect-standings.ts` (`zeroTally`). Fix: export the first and import it. Left here: `query/test-states.ts` is outside this ticket's file list.
- A write refusal's `cause` quotes the offending value as the reply handed it, which for a broken reply may hold a member the types do not name. It reaches an error's text and the daemon's local log, never a row. A fork, not a defect: keep the value for diagnosis (my recommendation, since the log is local and AC2 speaks of records), or name the member alone.

### File List

- `_agent-docs/tickets/3-4-defect-evidence.md` (created by create-ticket, 00:07 on 2026-10-01; amended by its author at 02:06 for ticket 3.3 as landed, at 02:22 for the member's name and the widened known limit, and at 03:16 for the dev's sanity check and the orchestrator's rulings of 03:13)
- `_agent-docs/tickets/3-3b-mutation-file-digest.md` (created by create-ticket, cut from this ticket)
- `_agent-docs/sprints/sprint-3-falsification.md` (modified by create-ticket: both splits, § Ticket 3.4's scope and link, § Ticket 3.3b, § Ticket 3.4b, the order paragraph)
- `_agent-docs/sprint-status.yaml` (modified by create-ticket: the `3-3b-mutation-file-digest` and `3-4b-summary-defect-counts` lines)

By dev-ticket, 2026-10-01. Created:

- `packages/daemon/src/defects/defect-states.ts`
- `packages/daemon/src/defects/defect-standings.ts`
- `packages/daemon/src/store/defect-evidence.ts`
- `packages/daemon/src/store/evidence-facts.ts`

Modified:

- `packages/daemon/src/falsify/verdict.ts` (`VERDICT` and `UNCLEAR_REASON` exported in place)
- `packages/daemon/src/defects/resolve-definitions.ts`
- `packages/daemon/src/store/schema.ts`
- `packages/daemon/src/store/columns.ts`
- `packages/daemon/src/store/open-store.ts`
- `packages/daemon/src/query/defects-answer.ts`
- `packages/daemon/src/query/summary.ts`
- `packages/daemon/src/daemon/protocol.ts`
- `packages/daemon/src/daemon/refusal-notes.ts`
- `packages/daemon/src/client.ts`
- `packages/cli/src/commands/defects.ts`
- `_agent-docs/tickets/3-4-defect-evidence.md` (the task and criterion boxes, the resolutions, the two known limits and the rulings the orchestrator had recorded here, the Dev Handoff, the Completion Notes, this list)

By create-tests, 2026-10-01. Created:

- `packages/daemon/test/experiment-facts.ts`

Modified:

- `packages/daemon/test/store.test.ts`
- `packages/daemon/test/query.test.ts`
- `packages/daemon/test/lifecycle.test.ts`
- `packages/daemon/test/defects/definitions.test.ts`
- `packages/daemon/test/falsify/verdict.test.ts`
- `packages/daemon/test/changes.test.ts`
- `packages/daemon/test/waits.test.ts`
- `packages/daemon/test/scheduling-harness.ts`
- `packages/daemon/test/defects.json`
- `packages/daemon/test/defects/defects.json`
- `packages/cli/test/defects-command.test.ts`
- `packages/cli/test/defects.json`

By review-changes, 2026-10-01. Modified:

- `_agent-docs/tickets/3-4-defect-evidence.md` (the doc text for the orchestrator, this list, the Review Record)

No dependency changed: `package.json` files and `bun.lock` are untouched.

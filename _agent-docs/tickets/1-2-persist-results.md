# Ticket 1.2: Persist runs and results

## Ticket

As the RT Test daemon (started in ticket 1.3) acting for a started consumer,
I want to store each workspace run and each discovery in a local `node:sqlite` store under the consumer's state directory, bound to its project, worktree, run identity, input fingerprint and adapter version,
so that results survive a daemon restart, are never read under another worktree's or another schema's meaning, and later queries (ticket 1.4) and freshness (Sprint 2) have one durable source.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: Storing a workspace run (every status `runWorkspace` returns: ran, unsupported, failed, interrupted before load) records it under a new run identity the store assigns, bound to the project identity, the worktree identity, the input fingerprint the caller gives, and the adapter version the store stamps, and reading that run back returns every field of the `WorkspaceRun` unchanged, including its status and the workspace it ran, an unsupported or failed run's report, each test's identity, duplicate mark, execution state, outcome and errors; each module's path, state and errors; the run's unhandled errors, nothing-ran reason, typecheck modules, unsupported projects, cancel and close errors; and the Vitest version found or loaded. A write whose project identity, worktree identity or input fingerprint is absent or empty is rejected and stores nothing.
- [ ] AC2: Storing a discovery (what `discoverTests` returns for a consumer) records it whole under the same project, worktree and input-fingerprint bindings and the adapter version, and reading back the worktree's latest discovery returns every field of the `TestDiscovery` unchanged, including each workspace's status, and for a discovered workspace its tests with identity, duplicate mark and declared mode, its failed modules, typecheck modules, unsupported projects, unhandled errors and close error; each unsupported or failed workspace's report; and each workspace source that was not read. A discovery write whose project identity, worktree identity or input fingerprint is absent or empty is rejected and stores nothing.
- [ ] AC3: A stored run or discovery becomes visible whole. A write that fails part way leaves no trace of that run or discovery, and a reader never sees part of one without the rest.
- [ ] AC4: The store never supplies a value that was not recorded, and stores no freshness. A test recorded interrupted reads back with no outcome, a crashed or not-run module reads back with no tests, and outcome and execution state read back as separate values.
- [ ] AC5: The input fingerprint is stored exactly as the caller gives it. A run or discovery whose inputs were not fingerprinted (every one until Sprint 2) is stored as not fingerprinted, never as an empty or invented digest, and reads back as not fingerprinted, distinct from every digest.
- [ ] AC6: A consumer's worktree identity is its root's canonical real path, the same however that root is spelled (separators, a trailing separator, a link or junction, and on Windows letter case). Two worktrees of one git repository share a project identity and have different worktree identities; a consumer outside any git repository has its worktree identity as its project identity. Every read answers for one project and worktree only, so runs and discoveries stored for another never answer it, even when both share one state directory. Two stores open on one state directory at once, as two worktrees' daemons would be, each store and read back their own runs.
- [ ] AC7: After the store is closed and opened again, as across a daemon restart, every stored run and each worktree's latest discovery read back unchanged, and a worktree's runs read back in the order they were stored.
- [ ] AC8: Every file the store leaves on disk lies inside the state directory it was opened with, which is `.rt-test` under the consumer root unless the caller names another. Opening creates that directory when it is missing.
- [ ] AC9: The store records its schema version and that the file is an RT Test store. Opening a new store creates the current schema; opening a store with a newer schema version than the code's, or a file that is not an RT Test store (another SQLite database, or not a database at all), fails with a reason naming the file and the versions found and expected, and leaves the file unchanged.
- [ ] AC10: The workspace's supported Node range is `^22.13.0 || ^24.0.0 || >=26.0.0`, the README's Develop line states that floor, and the store stores and reads back a run on Node 22.13.0 with no flag.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                                                                                                          | Why it matters if wrong                                                                                                                             | How to check                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Does every `node:sqlite` call the finished store makes behave on Node 22.13.0 as on 22.23.3, the oldest Node the repository's gates run? The probes (Dev Notes § Spike facts) covered opening, WAL, `user_version`, `STRICT`, a transaction seen by a second connection, and constraint errors, but not the store's own statements. | A call absent or different at the floor (Dev Notes § Node 22.13 API floor) passes every gate and fails for a user on 22.13 to 22.22, breaking AC10. | Run the store's test file under the Node 22.13.0 binary (`npm install --prefix <scratch> node@22.13.0`, then that binary with Vitest's entry point) and compare with the 24.19 run. |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing; U1 can only be answered once the store and its tests exist, so answer it before handing off to review.
- [ ] (AC6, AC8) Create the consumer-identity module (for example `packages/daemon/src/store/consumer-identity.ts`): the worktree identity as the consumer root's `realpathSync.native` path with `/` separators, failing with a reason when the root cannot be resolved rather than falling back to the spelling given; the project identity as the canonical git common directory found by walking up from the root (Dev Notes § Spike facts, Git layout), resolving a relative `gitdir:` or `commondir` against the directory of the file holding it and canonicalizing the result the same way as the worktree identity, or the worktree identity outside git; and the default state directory, `.rt-test` under the root (P41). Read the git files directly; spawn no process.
- [ ] (AC3, AC6, AC8, AC9) Create the store opener (for example `packages/daemon/src/store/open-store.ts`): create the state directory, open the database file inside it, set `PRAGMA busy_timeout` to a named bound so a write waits for another process's write on the same file (Dev Notes § Grill record), then check `PRAGMA application_id` and `PRAGMA user_version` against named constants before writing anything. Treat the file as new only when it holds no schema objects and both values are 0; create the current schema in one `BEGIN IMMEDIATE` transaction that re-reads both, so two openers of one new file create it once. Refuse a newer version, another SQLite database, or a file that is not a database at all (it opens, then throws `file is not a database` at the first statement) with the reason AC9 names. Use WAL journaling. Use only `node:sqlite` APIs that exist on Node 22.13.0 (Dev Notes § Node 22.13 API floor).
- [ ] (AC1, AC2, AC4, AC5, AC7) Define the schema (for example `packages/daemon/src/store/schema.ts`) with outcome and execution state in separate columns (C119), no freshness column (C114), a column per value 1.4 will count by (workspace path, project name, module path, module state, execution, outcome), and an explicit not-fingerprinted value distinct from any digest.
- [ ] (AC1, AC3, AC4, AC5) Create the run writer (for example `packages/daemon/src/store/write-run.ts`): take one `WorkspaceRun` and its bindings (project identity, worktree identity, input fingerprint), reject an absent or empty binding before opening a transaction (C122), stamp the adapter version constant, assign the run identity, and write every row inside one `BEGIN IMMEDIATE` transaction that rolls back on any throw, so a concurrent writer waits on `busy_timeout` instead of failing on a read-to-write upgrade.
- [ ] (AC2, AC3, AC5) Create the discovery writer the same way, over one `TestDiscovery`.
- [ ] (AC1, AC2, AC4, AC5, AC6, AC7) Create the readers (for example `packages/daemon/src/store/read-store.ts`): a worktree's runs in stored order, one run by identity, and a worktree's latest discovery, each rebuilding the recorded types unchanged and each filtered on project and worktree identity (C123). Absent values stay absent (C12). Read each fingerprint back as the caller gave it: a digest as that digest, and the not-fingerprinted value as itself (AC5).
- [ ] (Support) Export the store's open, write and read functions and their types from `packages/daemon/src/index.ts`.
- [ ] (AC10) Send the orchestrator the root `package.json` `engines.node` value `^22.13.0 || ^24.0.0 || >=26.0.0` and the README Develop line's new floor, and check the store against Node 22.13.0 by U1, since the repository's gates run Node 22.23.3 at the oldest (Dev Notes § Grill record).
- [ ] (Support) Send the orchestrator the `docs/architecture.md` § Current implementation text for the store, replacing only "or stores history; a run's record lives only in memory", so the sentence still says nothing builds fingerprints or selects tests (P21, C48). The **Project** and **Worktree** glossary entries in Dev Notes § Grill record, and the `docs/architecture.md` § Identity and freshness correction of "Identify a project by canonical root and configuration" to the owner's identity ruling, go to the orchestrator from create-ticket, not from dev (P21).
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `packages/daemon/src/vitest/run-workspace.ts` `WorkspaceRun`, and `packages/daemon/src/vitest/run-states.ts` `RecordedModule`, `RecordedTest`, `TestRunState`, `RunExecution`, `NothingRanReason`: the run shape the store writes and reads back (C14). Ticket 1.1b owns them; import, never redeclare.
- `packages/daemon/src/vitest/discover-tests.ts` `TestDiscovery`, `WorkspaceDiscovery`, `DiscoveredTest`: the discovery shape.
- `packages/daemon/src/vitest/find-workspaces.ts` `VitestWorkspace`, `UnreadWorkspaceSource`; `packages/daemon/src/vitest/module-tests.ts` `ModuleReport`, `FailedModule`; `packages/daemon/src/vitest/workspace-session.ts` `UnsupportedProject`, `UnsupportedVitest`.
- `@rt-test/core`: `TestIdentity`, `IdentifiedTest`, `TestOutcome`, and `assessEvidence`, which reads a missing or empty fingerprint as unknown freshness. The store keeps the explicit not-fingerprinted value (AC5); the query that builds a `TestEvidence` (1.4, then 2.1) maps it to an absent fingerprint, so core holds one representation of "none" and the store another only on its write-and-read boundary.
- For create-tests: `packages/daemon/test/harness.ts` `inTempDir` for a real temporary state directory.

### Must Create

- The store modules the tasks name. `rg -n "node:sqlite|DatabaseSync|better-sqlite3" packages scripts lint` finds nothing: no store exists.
- The identity module. `rg -n "worktree|git-common-dir|commondir|gitdir" packages --glob '*.ts'` finds nothing. `module-tests.ts` has a private `realPath` that falls back to the given spelling when `realpathSync.native` throws; that fallback suits a module path and is wrong for an identity (AC6), so the identity module resolves strictly rather than reusing it.
- The binding and record types for a stored run and discovery (run identity, project identity, worktree identity, fingerprint, adapter version), which no type declares today.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Ticket 1.1 (826725a) built discovery and ticket 1.1b built `runWorkspace` in `packages/daemon`, both returning in-memory records. This ticket stores those records in `node:sqlite` so they outlive the daemon, and reads them back. It runs no test and loads no Vitest: it takes the records as values.

Requirements this ticket delivers (`docs/requirements.md`):

- FR3: "Persist results bound to project, worktree, run identity, input fingerprint, and adapter version, and keep them available across a daemon restart." (AC1, AC2, AC5, AC6, AC7)
- NFR4: "Keep state, logs, and results on the machine under the configured state directory, and send nothing off it." (AC8)
- NFR5: "Run on Node `^22.13.0`, `^24`, and `>=26`, on Windows and Linux." (AC10)

Rule clauses the criteria rest on: C122 "A persisted result carries project identity, run identity, input fingerprint and adapter version; a write missing one is rejected, never defaulted" (AC1); C150 "A run's results become visible together; a reader never sees a partial run presented as complete" (AC3); C119 "Outcome, freshness, execution state, defect evidence and evidence freshness are separate fields" and C114 "no record stores a current or fresh flag" (AC4); C12 "Absent stays absent: an unrecorded outcome is unknown, not passed, false or zero" (AC4); C123 "A query joins on project identity and worktree, so results from another project or checkout never answer it" (AC6); C149 "A change to the persisted state schema ships a migration or invalidates the old records; old records are never read under the new meaning" (AC9); P41 "Write runtime state and logs only under the configured local state directory, `.rt-test/` by default" (AC8). `docs/architecture.md` § Identity and freshness: "Identify a project by canonical root and configuration, not package name alone. ... Scope state to a worktree; two worktrees must not overwrite each other's results." (AC6)

The sprint objective: "Nothing runs on edits yet and no input is fingerprinted, so every result's freshness is honestly unknown; Sprint 2 makes results current." (AC5)

#### Owner rulings

Asked in this lane's create thread (threadId 6d5a2cf7-292c-48f9-977a-18b7b1b26952), answered 2026-09-26 at about 12:15 -0400:

- One stored run covers one workspace: each `runWorkspace` result gets its own run identity and is visible as soon as that workspace ends. A selection spanning workspaces (2.3) can group runs later.
- The store also persists discoveries (AC2), so 1.4 counts never-run and unknown tests (C132) from the store, and the known tests survive a restart before rediscovery ends.
- Project identity is the git repository's common directory, shared by every worktree of one repository; worktree identity is the consumer root. Outside git, the project identity is the root.
- Keep every run. No pruning; retention stays open in `docs/roadmap.md` § Open decisions until real Fleet Cooling sizes are measured.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 1.2` over the store files, `packages/daemon/src/index.ts`, `run-workspace.ts`, `run-states.ts`, `package.json`, `README.md`, `.github/workflows/ci.yml`, `docs/architecture.md` and `packages/daemon/package.json` named only ticket 1.1b (review).

- **1.1b** (review, uncommitted in the checkout) owns `WorkspaceRun` and the recorded-state types, and writes `packages/daemon/src/index.ts` (and, from its tests session, `packages/daemon/test/defects.json`). This ticket reads those types and writes both files, so dev-ticket starts only after 1.1b lands, and stores the shape that landed: if 1.1b's review changes `WorkspaceRun`, the store follows it. This ticket never edits 1.1b's files.
- **1.3** (backlog) owns the explicit start: it chooses the configured state directory (and how a user configures it), opens the store, calls discovery and runs, and stores their results. Until then the store has no production caller, as 1.1's discovery and 1.1b's run had none (C59, accepted in § Grill record). Keeping one daemon per worktree is 1.3's too; daemons for different worktrees may share a state directory, which AC6 covers.
- **1.4** (backlog) answers `summary` and `status <path>` from this store. The latest result per test, counts per state per path, and comparing a run with the latest discovery so a known test the run never reported reads as unknown (C132) are 1.4's queries; it adds them beside this ticket's readers.
- **2.1** (backlog) computes input fingerprints and replaces the not-fingerprinted value; if it binds fingerprints per test rather than per run, it migrates the schema (C149).
- **2.3** (backlog) adds invalidated runs and the generation token (C116) on top of this store.

#### Spike facts

Observed 2026-09-26 with `_agent-docs/.scratch/create-ticket/sqlite/probe22.mjs` (run by the Node 22.13.0 binary from the npm `node@22.13.0` package, installed into that scratch folder, and by the host Node 24.19.0), `sqlite/probe2.mjs` on the same two, `sqlite/store.test.ts` under the root Vitest 5.0.1, and `rp.cjs`, all removed when this ticket was finalized:

- **No flag, one warning.** On 22.13.0, `import { DatabaseSync } from "node:sqlite"` loads with no flag and prints `ExperimentalWarning: SQLite is an experimental feature and might change at any time` once to stderr; 24.19.0 prints nothing. The bundled SQLite is 3.47.2 on 22.13.0 and 3.53.3 on 24.19.0.
- **Atomic commit.** On both, with `PRAGMA journal_mode = WAL` (returns `wal`), a second `DatabaseSync` on the same file counted 0 rows while the first held an open `BEGIN IMMEDIATE` with one row inserted, and 1 after `COMMIT`.
- **Version survives reopen.** `PRAGMA user_version = 2` read back `2` after `close()` and a new `DatabaseSync` on the file. A `STRICT` table was accepted on both.
- **Errors.** A `NOT NULL` violation threw `NOT NULL constraint failed: t.v` with `code` `ERR_SQLITE_ERROR` and `errcode` `1299` on both. Opening a file whose parent directory is missing threw `unable to open database file`, so the opener creates the state directory first (AC8).
- **Under Vitest.** A test file importing `node:sqlite` ran and passed under the root Vitest 5.0.1 on Node 24.19.0, so create-tests can drive a real store.
- **Canonical paths (Windows 11).** `realpathSync.native` returned `C:\source\...\rp\Real` for `...\rp\Real`, for the whole path in upper case, for a `/`-separated lower-case spelling with a trailing `/`, and for a junction `rp\jn` pointing at `rp\Real`. `realpathSync` (not `.native`) kept the caller's upper case, so only `.native` gives AC6 its one spelling.
- **Git layout.** In a throwaway repository with `git worktree add ../wt2`: the main worktree's `.git` is a directory; `wt2/.git` is a file holding `gitdir: C:/.../main/.git/worktrees/wt2` (absolute, `/`-separated); that directory's `commondir` file holds `../..`, which resolves to `main/.git`. `git rev-parse --path-format=absolute --git-common-dir` gave `main/.git` from `wt2` and from a subdirectory of `main`, so a root below a repository's top also resolves by walking up to the first `.git`. A `.git` file whose git directory has no `commondir` (a submodule's) is its own common directory. With `git -c worktree.useRelativePaths=true worktree add ../wt3` (git 2.55.0.windows.5), `wt3/.git` held the relative `gitdir: ../main/.git/worktrees/wt3`, so a `gitdir:` or `commondir` path resolves against the directory of the file that holds it.
- **Store identity and refusal** (`sqlite/probe2.mjs`, same output on 22.13.0 and 24.19.0). `PRAGMA application_id = 1381258324` read back after close and reopen. A new file read `application_id` 0, `user_version` 0 and 0 rows in `sqlite_schema`. A text file opened with no error in the `DatabaseSync` constructor, and its first statement threw `file is not a database` with `errcode` 26.
- **Waiting on another process's write.** While a child process held `BEGIN IMMEDIATE` for 600 ms, a second process's `BEGIN IMMEDIATE` with no busy timeout failed at once with `database is locked`, `errcode` 5; with `PRAGMA busy_timeout = 3000` it waited about 650 ms and committed.
- **Vitest on the floor.** The Node 22.13.0 binary running the root Vitest 5.0.1 entry point (`vitest.mjs run`) over the `node:sqlite` test file printed the ExperimentalWarning, passed its test, and exited 0.

#### Node 22.13 API floor

`@types/node` is 22.20.4, which declares `node:sqlite` members newer than the floor, so the typecheck will not catch them, and the Node 22.23.3 gate has them all. From its `@since` tags: `DatabaseSync` `isOpen` (22.15), `isTransaction`, `location`, `aggregate` (22.16), `StatementSync` `columns`, `setReturnArrays` (22.16), `setAllowUnknownNamedParameters` (22.15), the `backup` function (22.16), and the constructor options `timeout` (22.16), `readBigInts`, `returnArrays`, `allowBareNamedParameters`, `allowUnknownNamedParameters` (22.18). Probe 22.13.0 showed `isTransaction` and `isOpen` absent. Use none of them: track the transaction in code, and set pragmas with `exec`. Available at 22.13: `DatabaseSync` with `open`, `enableForeignKeyConstraints`, `readOnly`, `exec`, `prepare`, `close`, `function`; `StatementSync` `all`, `get`, `iterate`, `run`, `setReadBigInts`, `setAllowBareNamedParameters`.

#### Design notes

- **Run identity.** The store assigns it (for example `randomUUID` from `node:crypto`) when it stores the run, and orders a worktree's runs by the order they were stored (AC7). No start or end time is stored: no criterion reads one.
- **Adapter version.** Stored as the Vitest integration's version, a named constant in the daemon (C3) that changes whenever the recorded meaning of a run or discovery changes, beside the Vitest version the record already carries. The store stamps it on every write rather than taking it from the caller: the integration and the store ship in one package, so only the constant can be true, and a caller-supplied value could only be wrong. C122's "rejected, never defaulted" therefore binds the three values a caller supplies. A framework adapter (M3) adds its own version when it exists (§ Grill record).
- **Input fingerprint.** One value per stored run and per stored discovery, which the caller must pass: either a digest or an explicit not-fingerprinted value. The store never fills it in (C122, C12). Scope: per-test fingerprints are unanalyzed here and are 2.1's.
- **State directory.** The opener takes the directory; `.rt-test` under the consumer root is the default (P41). SQLite's `-wal` and `-shm` files sit beside the database, inside it. Transient temporary files SQLite may create while sorting are not state and are left out of AC8.
- **Stored error text.** Errors are stored as 1.1b records them: `errorText` keeps each message and its `cause` and `AggregateError` chain, with no stack and no code frame (`packages/daemon/src/vitest/error-text.ts`). A message the consumer's own test builds from an environment value is stored as written; the store reads no environment value itself (C147).
- **The ExperimentalWarning** on Node 22 goes to stderr once per process that opens the store. Left alone: suppressing it would mean removing the process's warning listeners. Since it goes to stderr, the stdout of any process that opens the store, the daemon or a 1.4 CLI, stays clean (C152). Vitest 5.0.1 under Node 22.13.0 printed it and still passed and exited 0 (§ Spike facts), so it fails no gate.
- **Testing AC3.** The writer is synchronous, so a reader in the same process cannot interleave with it. For create-tests, two seams exist: a partial write, as a record whose late row the store cannot write (for example an invalid value placed by a cast in the test's input), after which nothing of that run reads back; and a concurrent reader, as a second connection in a worker thread or child process reading while a large run is written, which sees either none of the run or all of it.
- **Refusing a store never repairs it.** AC9's refusal leaves the file for the user; nothing deletes or recreates a store.

#### Grill record

The owner answered in this lane's create thread, 2026-09-26 between about 12:18 and 12:25 -0400:

- Adapter version. Answer: the Vitest integration's version, a daemon constant changed whenever what a stored run or discovery means changes, stored beside the Vitest version, so C124 can retire results after an RT Test upgrade. Framework adapters add their own versions in M3.
- A run the daemon never finished (killed mid-run). Answer: no record. Only finished runs are stored, each whole (AC3); the tests keep their earlier results, unconfirmed after a restart until Sprint 2's reconciliation.
- CI. The owner first chose to add Node 22.13.0 and 26 to the CI matrix, then ruled at 12:24 (relayed by the orchestrator, threadId c69b35aa-87e0-4755-b618-81ae537fa756): the project retires hosted CI and deletes `.github/workflows/ci.yml`. The only pre-push validation is `bun run check` on Windows under Node 24 and on Linux in WSL under Node 24 and Node 22.23.3, all three green before every push. This ticket does no CI work, and Node 22 support is proven by the Linux Node 22 gate. The gate's 22.23.3 is above the `^22.13.0` floor, so the floor itself is U1's manual check.
- A store with a newer schema version, or a database that is not an RT Test store. Answer: refuse and leave the file (AC9); never discard and recreate.
- C59. Answer: accepted as for 1.1 and 1.1b; the store's exports have no production caller until 1.3.
- Glossary, § Results and runs. Answer: approved, for the orchestrator to write: **Project**: "A consumer's repository, shared by every worktree checked out from it; outside a git repository, the consumer root itself." _Avoid_: repo, package. **Worktree**: "One checked-out consumer root, to which results are scoped, so two worktrees of one project never answer for each other." _Avoid_: checkout, clone.

Settled by create, not asked: the identity ruling lets two worktrees' daemons share one state directory, so two processes can write one database at once. The writer waits on SQLite's lock for a named bound (`PRAGMA busy_timeout`, since the constructor's `timeout` option is newer than the floor), and a write that still cannot proceed fails whole under AC3 (AC6).

#### Current structure of the modified files

- `packages/daemon/src/index.ts` (after 1.1b): re-exports `discoverTests`, `findVitestWorkspaces`, `runWorkspace` and their types, `FailedModule`, `ModuleReport`, the recorded-state types from `run-states.ts`, `ResolvedVitest` and `UnsupportedProject`.
- `package.json` (root, orchestrator-owned): `"engines": { "node": "^22.12.0 || ^24.0.0 || >=26.0.0" }`.
- `README.md` § Develop (orchestrator-owned): "Use Node 22.12+ within the supported Node 22, 24, or 26+ release lines, and Bun 1.3.14 for dependency installation and project scripts."
- `docs/architecture.md` § Current implementation (orchestrator-owned): ends "Nothing yet builds fingerprints, selects tests, or stores history; a run's record lives only in memory."

#### Existing tests this change breaks

None found. `rg -n "22\.12" packages test scripts lint package.json README.md` finds only `package.json` and `README.md`; `rg -n "engines|node-version" packages test scripts lint` finds nothing; and `rg -n "src/index|@rt-test/daemon" packages test` finds only the daemon's own `package.json` name and the defect verifier's own sandbox fixtures (`test/scripts/defects/`), so no test asserts the daemon's export list.

#### Previous ticket

1.1b (`review`, its § Completion Notes): `runWorkspace(workspace, signal)` returns a `WorkspaceRun` with status `ran`, `unsupported`, `failed` or `interrupted-before-load`; a `ran` run's modules are `ran` (with tests and hook errors), `failed`, `crashed` or `not-run`; each recorded test carries `execution` `finished` (with `outcome` and `errors`) or `interrupted` (with neither); `nothingRan` is present exactly when no test passed or failed. Discovery and runs share one queue; the daemon's code writes nothing to disk, though Vitest itself writes its results cache and, outside CI, missing snapshots until 1.3 turns them off. Its open change-request candidates (a stuck test hanging an interrupt, coverage and snapshot writes) were ruled into ticket 1.3's scope, which also turns off Vitest's results cache (owner ruling, 12:49) and do not touch the store.

### References

- `docs/architecture.md` § Components (Evidence store: "Persist inputs, runs, results, graph versions, and defect evidence"), and "The store is SQLite through `node:sqlite`, which needs no flag from Node 22.13, the supported floor."
- ADR-0001 (`docs/adr/0001-typescript-on-node.md`): "SQLite through `node:sqlite`, with `better-sqlite3` as the fallback if the built-in module needs a flag on the supported Node floor." Probe 22.13.0 needs no flag, so the fallback is not taken.
- ADR-0004: evidence "in the local state directory, `.rt-test/` by default, which the consumer excludes from version control".
- `docs/roadmap.md` § M1 acceptance: "stop and restart, and historical results stay available but are not current until reconciliation"; § Open decisions: "State schema migrations, retention, and recovery from partial writes."
- `docs/glossary.md`: **Run**, **Result** ("A test's outcome bound to the run and input fingerprint that produced it."), **Input fingerprint**, **Freshness**, **Interrupted run**, **Crashed module**.
- Ticket 1.1b (`_agent-docs/tickets/1-1b-record-run-states.md`) § State mapping and § Grill record.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete`.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C12,C14,C19,C30,C38,C48,C59,C114,C116,C119,C120,C122,C123,C124,C125,C131,C132,C134,C143,C146,C147,C149,C150,C152 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P1,P10,P13,P14,P16,P17,P18,P19,P20,P21,P41,P42 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area: packages/daemon
is_consolidation: false
sizing_ac_count: 11
files_to_modify:
  - packages/daemon/src/index.ts
  - package.json
  - README.md
  - docs/architecture.md
files_to_create:
  - packages/daemon/src/store/consumer-identity.ts
  - packages/daemon/src/store/open-store.ts
  - packages/daemon/src/store/schema.ts
  - packages/daemon/src/store/write-run.ts
  - packages/daemon/src/store/write-discovery.ts
  - packages/daemon/src/store/read-store.ts
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

Planning files the create-ticket run wrote:

- `_agent-docs/tickets/1-2-persist-results.md` (created)
- Sent to the orchestrator as exact text: the **Project** and **Worktree** glossary entries (`docs/glossary.md`), the `docs/architecture.md` § Identity and freshness correction of the project-identity clause, the sprint file's 1.2 section and objective sentence, the FR3 and NFR5 marker relinks (`docs/requirements.md`), and the status transition to `ready-for-dev`.

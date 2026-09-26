# Ticket 1.3b: Run safety

## Ticket

As a user or coding agent who has started RT Test's daemon on a trusted consumer worktree,
I want the daemon's Vitest runs and discoveries to leave the consumer's tree exactly as they found it, and to end within a bounded time after an interrupt even when a test hangs,
so that starting RT Test never dirties a worktree, writes or rewrites a snapshot, or fills `node_modules` with caches, and a stop (ticket 1.3) never waits forever on a stuck test.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: A `runWorkspace` or a `discoverTests` of a consumer leaves every file and directory under the consumer root, `node_modules` included, as it found it, on Vitest 4.1.x and 5.x: nothing added, changed or removed. This holds whatever the workspace's config sets for coverage, snapshot updates, Vitest's results cache and Vitest's module cache, and for a config file Vite loads as ESM as well as one it loads as CommonJS. Writes made by the consumer's own code are outside this criterion: its test bodies, hooks, setup files, `globalSetup`, plugins and config code. The five documented exceptions in Dev Notes § Known limits, all under `node_modules`, are outside it too.
- [x] AC2: A run checks each snapshot assertion only against the snapshot already stored. A `toMatchSnapshot` or `toMatchInlineSnapshot` with no stored snapshot records its test failed, and so does a mismatch. No snapshot file or test file is written, updated or removed, whatever the workspace's config or the `UPDATE_SNAPSHOT` environment variable asks for.
- [x] AC3: `discoverTests` takes an abort signal. A discovery whose signal aborted before its turn in the shared session queue loads no workspace. One aborted while it runs loads no further workspace and interrupts the workspace in progress. Either way it settles by rejecting with the signal's reason, and only after the Vitest instance it opened has closed and the host's environment and exit code are restored, so there is no discovery result to store. A discovery whose signal never aborts returns the same result it returns today.
- [x] AC4: When a run or a discovery has not ended once the grace period, `FORCE_STOP_GRACE_MS` (10 s), has passed since its signal aborted, Vitest is force-stopped and the job ends. A run with a test stuck in a synchronous loop ends as an interrupted run: every test it had not finished is recorded interrupted, and no Vitest worker process remains. A discovery stuck in a test module that loops at load settles as AC3 says. This holds on Vitest 4.1 and 5, on the `forks` and `threads` pools. A run or a discovery that ends within the grace period is never force-stopped, so the consumer's `afterAll` hooks and teardown run as they do today. A synchronous loop on the Vitest host's own thread (config load, `globalSetup`) is out of this criterion's reach; ticket 1.3's executor bound ends it.
- [x] AC5: Every run that loaded its workspace (`status: "ran"`) records whether Vitest was force-stopped, in a field of its own beside its execution state. A force-stopped run says it was. A run that completed, or was interrupted and ended within the grace period, says it was not.
- [x] AC6: The store keeps the force-stop fact. A run written reads back with it unchanged. A store written at ticket 1.2's schema version opens, reads back each of its runs as not force-stopped, and is from then on at the new version. A store of a newer schema version, another SQLite database, or a file that is not a database is still refused and left unchanged.
- [x] AC7: Every run and discovery stored after this change carries a Vitest adapter version different from the one stored before it, since a missing snapshot now fails its test (AC2).
- [x] AC8: A workspace that a root `package.json` `workspaces` pattern resolves outside the consumer root, whether through `..` or through a link, is never loaded, discovered or run: `findVitestWorkspaces` does not list it, and reports it in `notRead` under that pattern with a reason naming the path it resolves to, so it is never silently dropped. Inside and outside are decided on canonical real paths, so a link inside the root that leads out is outside, and a pattern that leaves the root and comes back into it is inside. A workspace a pattern resolves inside the root is listed as before.
- [x] AC9: Two workspace entries that resolve to one canonical real path are listed once, so no directory is loaded, discovered or run twice. The entry kept is the first in pattern order, the consumer root first, and each later one is reported in `notRead` with a reason naming the workspace it duplicates, never silently dropped.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                                                                                                                                                                                                                            | Why it matters if wrong                                                                                                                                                                     | How to check                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1  | Does a first `cancelCurrentRun` issued while `collectTests` is collecting (no module stuck) end the collection on Vitest 4.1 and 5, and does `collectTests` then resolve rather than reject? `collectTests` clears its cancel state as it starts (§ Vitest facts), so a cancel issued before that is dropped, as it is for a run.                                                                                                                     | AC3's interrupt of the workspace in progress rests on it. If the first cancel is ignored during collection, a normal discovery runs to its end and only the force-stop ends it, 10 s later. | Hold collection open with a test module whose top-level `await` waits on a promise the probe controls, issue one `cancelCurrentRun`, release the promise, and record whether and how `collectTests` settles, on both installs. |
| U2  | Does `configLoader: "runner"` load a config on Vite 6.1 to 7.2 without a temp file, as on Vite 8.3.1 (probed) and 7.3.1 (read: the same three loaders, `runnerImport` through Vite's module runner, and `.vite-temp` only on the bundle path, in the Bun cache's `vite@7.3.1` `dist/node/chunks/config.js`)? Vitest 4.1 accepts `vite ^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0`.                                                                                | AC1 for a Vitest 4.1 consumer on an older Vite. The owner ruled exactly four exceptions, so a difference goes to the orchestrator as a question rather than becoming a fifth.               | Read the loader dispatch in the `vite@6.1.0` and `vite@7.0.0` npm tarballs' `dist/node` chunks.                                                                                                                                |
| U3  | Does `collectTests` emit `onTestModuleQueued`, or another reporter event after it clears its cancel state, on Vitest 4.1 and 5?                                                                                                                                                                                                                                                                                                                       | Without one, a discovery's first cancel can be dropped, and the grace-time cancel is then a first cancel that cannot force-stop (AC3, AC4).                                                 | Collect a two-module fixture with a recording reporter on both installs.                                                                                                                                                       |
| U4  | Does a second `cancelCurrentRun` issued immediately after the first, with the first's promise still pending, force-stop a stuck test on Vitest 4.1 and 5, as one issued 3 s later does? The source says yes: the pool's `cancel()` computes `force = this._isCancelling` and sets the flag before its first `await` (5.0 `index.DzobfTyw.js:11495`, 4.1 `cli-api.CnMVyzaz.js:3561`). The listener chain from `cancelCurrentRun` to it was not traced. | § Design notes issues the force-stop at once when the withheld first cancel comes after the grace. If back-to-back cancels do not force, that job never ends (AC4).                         | Run a `for (;;) {}` test, issue both cancels in one tick, on both pools and both installs.                                                                                                                                     |

Resolutions (dev, 2026-09-26, probes on Windows 11, Node 24.19.0, over vitest 5.0.1 and 4.1.11 with Vite 8.3.1, removed after use):

- **U1 CONFIRMED.** Source: `collectTests` runs the pool inside a `try` that routes a pool error to `state.catchError`, and each queued task checks `ctx.isCancelling` before it starts (5.0 `index.DzobfTyw.js:21162` and `:11710`, 4.1 `cli-api.CnMVyzaz.js:3765`). Probe: two modules each holding their top level for 3 s, one `cancelCurrentRun` issued 800 ms after `collectTests` was called. `collectTests` resolved at about 3.5 s, when the held modules released, with both modules uncollected (`pending`) and no unhandled error, on both installs.
- **U2 CONFIRMED.** The `vite@6.1.0` and `vite@7.0.0` tarballs' `dist/node/chunks` (`dep-CfG9u7Cn.js:54296` and `dep-Bsx9IwL8.js:36304`) dispatch `configLoader` to the same three loaders. `runnerImportConfigFile` loads through `runnerImport`'s module runner and writes no file; `.vite-temp` is created only in `loadConfigFromBundledFile`, on the bundle path.
- **U3 FALSE.** `collectTests` emits no reporter event at all. Its pool's `onQueued` and `onCollected` only call `state.collectFiles` when collecting (5.0 `index.DzobfTyw.js:10607`, 4.1 `cli-api.CnMVyzaz.js:2787`), and `collectTests` never calls `_testRun.start`. A recording reporter that saw `onTestRunStart`, `onTestModuleQueued` and `onTestRunEnd` on a run saw nothing during a collect, on both installs. Re-plan, mechanism only: `collectTests` clears its cancel state after awaiting `cancelPromise` and `runningPromise`, both unset on a session's fresh instance, so the reset is done within the microtasks after the call. Discovery withholds its first cancel until one macrotask after it calls `collectTests`, then issues it; the force-stop follows the same rule as a run's. What AC3 and AC4 promise is unchanged.
- **U4 CONFIRMED.** Source: `cancelCurrentRun` calls each listener synchronously, `executeTests` registers `pool.cancel` as one (5.0 `:11621`, 4.1 `:3686`), and `pool.cancel` sets `_isCancelling` before its first `await`. Probe: a `for (;;) {}` test, both cancels issued in one tick 1.5 s in: the run ended 4 to 11 ms later with end reason `interrupted` and `close()` returned, on 5.0.1 and 4.1.11, `forks` and `threads`. A module looping at top level under `collectTests` ended 7 to 8 ms after a second cancel issued 1.5 s after the first, on both installs.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing.
- [x] (AC4) Create `packages/daemon/src/vitest/force-stop.ts` holding `FORCE_STOP_GRACE_MS = 10_000` alone, exported, so ticket 1.3's executor bound imports it (C8) and a test can mock the module down (C97).
- [x] (AC1, AC2) In `workspace-session.ts`'s `createVitest` options, force coverage off (`coverage: { enabled: false }`), snapshot update `"none"`, the results cache off (`cache: false`) and the module cache off, spelled for the loaded version: top-level `fsModuleCache: false` on 5.x, `experimental: { fsModuleCache: false }` on 4.1.x, since 5.x logs a deprecation for the `experimental` spelling (§ Vitest facts). Name each override (C3).
- [x] (AC1) Create `packages/daemon/src/vitest/config-loader.ts` to choose the config loader: `"runner"` for a config file Vite treats as ESM, Vite's default `"bundle"` for one it treats as CommonJS (§ Config loading). Pass the config file RT Test chose as `config`, so the loader choice and the file Vitest loads are one decision. Export `CONFIG_EXTENSIONS`, `VITEST_CONFIG_FILES` and `VITE_CONFIG_FILES` from `find-workspaces.ts` for it rather than restating them (C8).
- [x] (AC3) Give `discoverTests` a required `signal: AbortSignal`, as `runWorkspace` has. Skip the whole discovery when the signal aborted before its queue turn; stop before each next workspace once it aborts; interrupt the `collectTests` in progress through the interruption the run uses (`RunInterruption`, exported or moved where both callers reach it), withholding its first cancel until `collectTests` has reset its cancel state (U3); and reject with `signal.reason` after `inWorkspaceSession` has closed the instance and restored the host.
- [x] (AC4) Force-stop both job kinds from one place (C8): once the grace period since the abort has passed and the job has not ended, issue the second `cancelCurrentRun`. When the first cancel was withheld until Vitest queued a module (`RunInterruption.onTestModuleQueued`), issue the second as soon as the grace has passed. Clear the timer when the job ends. Rewrite `RunInterruption`'s docblock, which says at most one cancel is issued (C46).
- [x] (AC5) Add the force-stop field to `WorkspaceRun`'s `ran` variant, set from whether the second cancel was issued before the job ended, the same event that clears the force-stop timer.
- [x] (AC6) Raise `STORE_SCHEMA_VERSION` to 2 and add the force-stop column to `runs`, NULL for every status but `ran`. Make `openStore` migrate a version-1 store under the write lock, re-reading the header there as `createSchema` does, and setting the column to not force-stopped on each `ran` row and the header's schema version to 2, in the same transaction. Write the column in `write-run.ts`, and read it back, refusing an unreadable value, in `read-runs.ts`. Keep the refusal of every other version.
- [x] (AC7) Raise `VITEST_ADAPTER_VERSION` to 2.
- [x] (AC8) In `find-workspaces.ts`, check each directory a `workspaces` pattern expands to against the consumer root by canonical real path, and report each one outside the root, or whose real path cannot be read, in `notRead` under its pattern with a reason naming the path, instead of listing it.
- [x] (AC9) In `find-workspaces.ts`, key each listed workspace by its canonical real path, and report a later entry resolving to a real path already listed in `notRead`, under its workspace path, with a reason naming the listed workspace.
- [x] (Support) Send the orchestrator the `docs/architecture.md` § Current implementation sentences for the overrides, the loader, the discovery signal, the force-stop and the four exceptions (Dev Notes § Known limits), the glossary text for a force-stopped run, and the FR4 marker (§ Requirements).
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `packages/daemon/src/vitest/workspace-session.ts`: `inWorkspaceSession`, which already closes the instance and restores the host after every step, and `queueSessionJob`.
- `packages/daemon/src/vitest/run-workspace.ts`: `RunInterruption`, which already withholds a cancel until Vitest queues a module and records the end reason; the force-stop extends it rather than adding a second interrupt path.
- `packages/daemon/src/vitest/load-vitest.ts`: `resolveWorkspaceVitest`, whose `version` picks the module-cache spelling.
- `packages/daemon/src/vitest/find-workspaces.ts`: `CONFIG_EXTENSIONS`, `VITEST_CONFIG_FILES` and `VITE_CONFIG_FILES`, the config names RT Test already recognizes, in Vitest's own lookup order (§ Vitest facts). They are module-private today: export them rather than restate them (C8).
- `packages/daemon/src/store/`: `inWriteTransaction`, `checkedHeader` and `isNew` in `open-store.ts` for the migration; `optionalText`, `integer` and `unreadable` in `columns.ts`; `NO_RUN_COLUMNS` and `ranColumns` in `write-run.ts`.
- For create-tests: `packages/daemon/test/harness.ts` (`inTempDir`, `copyFixture`, `linkVitest`), the `run-interrupt` fixture and its run hooks (mid-run holds at `running:<test>`), and the no-writes probe's tree walk (Dev Notes § Spike facts), which records directories and does not follow the `node_modules/vitest` link.

### Must Create

- `packages/daemon/src/vitest/force-stop.ts`: no grace or force-stop constant exists (`rg -n "GRACE|FORCE" packages/daemon/src` finds none).
- The config-loader choice: nothing in `packages/daemon/src/vitest` passes `configLoader` or a `config:` key to `createVitest` (`rg -n "configLoader|config:" packages/daemon/src/vitest`).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Tickets 1.1 and 1.1b built `discoverTests` and `runWorkspace` in `packages/daemon/src/vitest/`, and 1.2 stores their records in `packages/daemon/src/store/`. Nothing calls them in production yet. Ticket 1.3, next, builds the daemon that does, hosting both in an executor child. This ticket lands first, so the daemon's first runs already leave the consumer's tree unwritten and a stop can always end Vitest (orchestrator, 2026-09-26 13:55).

Requirements this ticket delivers (`docs/requirements.md`):

- FR2: "Record each run's test outcomes, skips, collection errors, module and run-level errors, worker crashes, and interruptions as distinct states." (AC2, AC4, AC5)
- NFR4: "Keep state, logs, and results on the machine under the configured state directory, and send nothing off it." (AC1, AC2)
- FR3: "Persist results bound to project, worktree, run identity, input fingerprint, and adapter version, and keep them available across a daemon restart." (AC6, AC7)
- FR4: "Start and stop the daemon explicitly for one trusted project, and execute no project code before that start." (AC3, AC4: a stop can end every job; AC8: only the started project's own directories execute)

Clauses the criteria rest on:

- The sprint file's 1.3b section: "daemon runs and discovery write nothing into the consumer's tree, with coverage off, snapshot update set to none and Vitest's results cache off whatever the consumer's config says. A named-defect test proves this on Vitest 4.1 and 5 over a consumer fixture, `node_modules` included. Discovery can be interrupted, and 10 s after an interrupt (a named constant) Vitest is force-stopped, which the run records and the store keeps." (AC1 to AC6)
- The same section: "The force-stop skips the consumer's `afterAll` and teardown, so the run records that it happened." (AC4, AC5)
- AGENTS.md § Product guarantees: "Never inject defects into a consumer's working tree." and "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states." (AC1, AC5)
- AGENTS.md § Product guarantees: "Treat test execution as execution of project code. Require an explicit start for a selected trusted project; do not auto-execute discovered repositories." (AC8)
- P41: "Write runtime state and logs only under the configured local state directory, `.rt-test/` by default, never elsewhere in the consumer's tree." (AC1)
- C119: "Outcome, freshness, execution state, defect evidence and evidence freshness are separate fields; no value encodes two of them." (AC5: the force-stop is its own field, never a new execution value)
- C142: "Cancelling or interrupting a run leaves each affected test interrupted or stale, never at its previous outcome as if current." (AC4)
- C149: "A change to the persisted state schema ships a migration or invalidates the old records; old records are never read under the new meaning." And `schema.ts`: "A change to the tables below raises it and ships the opener a migration from the previous version, since the opener refuses every other version." (AC6)
- C124: "Results produced by an older adapter or runner version are not reported current under a newer one." And `adapter-version.ts`: "Raise it whenever what a stored run or discovery means changes, so results recorded under the old meaning can be retired." (AC7)
- Glossary: **Interrupted run** "A run stopped before it finished, so each test it had not finished gets no outcome from it." **Run** "One execution of a selection by the daemon, under its own run identity."

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 1.3b` over `workspace-session.ts`, `run-workspace.ts`, `discover-tests.ts`, `adapter-version.ts`, the four store files, both daemon test files and `docs/architecture.md` named ticket 1.3 (ready-for-dev) and 1.3c (backlog).

- **1.3** (ready-for-dev, after this ticket) reads these files and writes none of them. Its executor calls `discoverTests` and `runWorkspace`, and its executor bound is derived from `FORCE_STOP_GRACE_MS` plus a margin. So `discoverTests`'s new required signal and the new run field are the API 1.3 builds on. The sprint file's 1.3b section, citing 1.3's spike, says "The overrides were observed to write nothing on both versions". This ticket's probe corrects that (§ Spike facts), and the corrected sentence went to the orchestrator, which owns the sprint file. 1.3's own routing note for this ticket lists only the three overrides; its lane owns that file.
- **1.3c** (backlog): a false hit. The sprint file's paragraph under 1.3c names this ticket's files as 1.3b's.
- **1.4** (backlog) reads 1.2's store and treats a record of another adapter version as not current (sprint file, 1.4 section). AC7's bump retires 1.2-era records there, and the new run field is one more field 1.4 may read.

#### Owner rulings and grill record

The sprint rulings (orchestrator, 2026-09-26 13:45 and 13:55): coverage off, snapshot update none and the results cache off; a named-defect test, not a runtime check (Q8 of ticket 1.3); a fixed named 10 s grace constant (Q9); the force-stop recorded on the run, with the store change (Q7); 1.3b before 1.3 (R1).

Questions sent to the orchestrator between about 15:48 and 15:55 on 2026-09-26 (crew.md § Questions):

- Exceptions, owner ruling at 16:00 and 16:05, asked by the orchestrator in plain terms. The no-write guarantee has exactly four documented exceptions, all under `node_modules` and all from the project's own setup or an old Vite (§ Known limits). They are named in `docs/architecture.md` and, as fits, in the no-writes test's Deliberately Untested entry or its fixture coverage. Everything else writes nothing (AC1).
- Q1 Config loader, decided by the orchestrator at 16:05: choose the loader by the root config file, `"runner"` for a config Vite treats as ESM and the bundle loader otherwise, restating Vite's `isFilePathESM` rule. Pass the chosen file as `config`, so the file and the loader are one decision. A test pins the restated rule's cases: `.mts`, `.cts`, and `.js` under `"type": "module"` and without it (§ Config loading).
- Q2 Module cache, decided by the orchestrator at 16:05: force it off at the root on both versions. The 4.1 per-project case is exception 4. The deps optimizer is exception 2 and is not forced off.
- Q3 Adapter version, decided by the orchestrator at 16:05: raise `VITEST_ADAPTER_VERSION` from 1 to 2 in this ticket, since update `"none"` changes what a stored run means (AC7).
- Q4 Sizing, decided by the orchestrator at 16:05: proceed at about 23 raw files, 30 estimated. The overage is fixtures and the orchestrator's two docs (§ Sizing).
- The FYIs stand (orchestrator, 16:05): an aborted discovery rejects after the host is restored and stores nothing (AC3); the force-stop fires at `FORCE_STOP_GRACE_MS` from the abort (§ Design notes); schema v2 with a v1-to-v2 migration (AC6); 1.3b is added to FR4's marker.
- Fixture fact (orchestrator, 16:05): lane `interrupt-races` is changing the `run-interrupt` fixture's mid-run hold event from `ready:<test>` to `running:<test>`, an annotate-based event, because Vitest throttles per-test ready events. Every hold this ticket's tests place mid-run uses `running:<test>`.

Rulings after dev (owner, 2026-09-26 17:17, relayed by the orchestrator), on the dev session's two FYIs:

- Obsolete snapshots (dev adversarial review F3): keep as built. A file with unused snapshot entries is recorded with its module error, and the tests' own outcomes are unchanged, which matches what CI reports. No code change.
- Workspaces outside the consumer root: refuse them, in this ticket's scope, since `find-workspaces.ts` is already in its set and it is the same run-safety guarantee (orchestrator added it, 17:17). Any workspace a pattern resolves outside the consumer root, by `..` or by a link, is never loaded; it is reported in `notRead` with its own reason naming the path, never silently dropped; the comparison uses canonical real paths so a link cannot escape. The mechanism was left to dev. Added as AC8. Ticket 1.3's confirmed start builds from `findVitestWorkspaces`, so it inherits this with no change.
- Duplicate workspaces (orchestrator decision, 2026-09-26 17:19, no owner question, applying NFR1's zero-duplicate-execution target): fix the dev session's dedup change-request candidate in this ticket, as AC9. Two entries resolving to one canonical real path are listed once, the first in pattern order kept, and the duplicate reported in `notRead` with a reason naming the entry it duplicates. Dev reading: a pattern repeating the same workspace path is one entry with one identity, so it is still skipped without a report; only a different path to the same real directory is a duplicate. The orchestrator confirmed this reading (2026-09-26 17:28): skipping a repeated identical path loses nothing, so it reports nothing.

Rulings during review (2026-09-26 18:11, relayed by the orchestrator), on the review session's question and FYIs:

- Snapshot rewrite (review finding, CRITICAL): under update `none`, Vitest still saves a snapshot file that holds an unchecked entry, and rewrites it whenever its bytes differ from Vitest's own serialization, a CRLF checkout included (5.0.1 `index.m3L2HgmY.js` `SnapshotState.save` and `saveSnapshotFile`; 4.1.11 `@vitest/snapshot`). Orchestrator decision: build RT Test's no-save snapshot environment in this ticket, since it keeps the owner's no-write ruling as ruled. Reads behave as the consumer's config would, including through a consumer's own `snapshotEnvironment`; saves and removals are never written; it reaches every project on 4.1 and 5, `forks` and `threads`. Built as `snapshot-guard.ts`, a setup file `workspace-session.ts` puts first in every resolved project, which replaces the save and remove methods of the environment Vitest has already resolved. Spike (review session, 18:13, Windows 11, Node 24.19.0): over a two-project consumer, one project on Vitest's environment and one on its own, each with a CRLF snapshot file holding an obsolete entry, a run changed nothing on 5.0.1 and 4.1.11, `forks` and `threads`, and each stored snapshot still passed; plain Vitest under update `none` rewrote both files.
- API token fallback: owner ruling, accepted as the fifth exception in § Known limits.
- The coverage override stays (review evidence: without it every worker starts the consumer's coverage provider). The tests session corrects its Deliberately Untested reason.

The ticket review (create-ticket Step 6c, 16:08) returned 10 findings, and 9 were applied: the discovery's withheld first cancel (U3 added), one end event for the timer and the field, the migration writing version 2, the export of the config names, U4 (a second cancel issued back-to-back), the `.ts` config under the bundle loader (probed, § Spike facts), the C105 deviation stated, and two claims and a list narrowed to their evidence. The tenth, whether the owner accepted a CommonJS project config failing under an ESM root, was answered from the ruling's own words, now cited in § Known limits exception 3.

#### Spike facts

Observed 2026-09-26 by `_agent-docs/.scratch/create-ticket/writes/probe.mjs` and `cjs.mjs` on Windows 11 with Node 24.19.0, over Vitest 5.0.1 and 4.1.11 with Vite 8.3.1. Each consumer had a `package.json`, a config, and `snap.test.ts` holding a `toMatchSnapshot`, a `toMatchInlineSnapshot` with no stored snapshot, and a plain test. Its `node_modules/vitest` was a junction to the repository's install. The probe diffed every file (by hash) and directory under the consumer before and after, not following the junction. `createVitest` got `reporters: [{}]`; an empty list crashed 4.1's run in `MinimalReporter.printErrorsSummary`.

- **Without the overrides** (positive control), a run on both versions added `node_modules/.vite/vitest/<hash>/results.json`, `__snapshots__/snap.test.ts.snap` and `node_modules/.vite-temp/`, and changed `snap.test.ts` (the inline snapshot). All three tests passed.
- **With `coverage: { enabled: false }`, `update: "none"`, `cache: false` and the module cache off**, over a config setting `update: true`, coverage enabled with no provider installed, and the module cache on: the file and inline snapshot tests failed, the plain test passed, and the only change was an added, empty `node_modules/.vite-temp/`. That held for a run and a `collectTests`, on both versions, for `.ts` and `.mjs` configs.
- **With `configLoader: "runner"` added**, the tree was unchanged after a run on both versions, for `.ts` and `.mjs` configs.
- **The runner loader on a CommonJS config** (`vitest.config.cjs` using `module.exports` and `require`) failed with `ReferenceError: module is not defined` on both versions. A `.mts` config importing a local `.ts` helper loaded.
- **The default loader on CommonJS-format configs** (`vitest.config.cjs`, an ESM-syntax `vitest.config.js` in a package without `"type": "module"`, and, probed at 16:10 after the ticket review, an ESM-syntax `vitest.config.ts` with a type annotation in such a package) loaded and left the consumer directory and its `node_modules` unchanged, on both versions. A `.cts` config was not probed.

The probes were removed when this ticket was finalized. Linux was not probed; the named-defect test runs on both gated platforms.

#### Vitest facts

Read in `vitest@4.1.11` (`dist/chunks/coverage.DM_a_rWm.js`, `cli-api.CnMVyzaz.js`) and `vitest@5.0.1` (`dist/chunks/index.DzobfTyw.js`):

- **Options win over the config.** `createVitest(mode, options)` keeps `options` as Vitest's CLI options (4.1 `new Vitest(mode, deepClone(options))`), deep-merged over the config, with arrays replaced (`deepMerge`). `update` is in both versions' list of CLI options applied to every project (4.1's `cliOverrides`, 5.0's `PROJECT_CLI_OVERRIDES`); `coverage` and `cache` are read from the root config only (`this.cache.results.setConfig(resolved.root, resolved.cache)`).
- **Snapshot update.** Both resolve `updateSnapshot` from `resolved.update || process.env.UPDATE_SNAPSHOT`, accepting `"all"`, `"new"` and `"none"` as given (4.1 `coverage.DM_a_rWm.js:365`, 5.0 `index.DzobfTyw.js:14493`), so `update: "none"` beats the environment variable and `CI`.
- **Module cache.** 4.1 spells it `experimental.fsModuleCache` and writes `node_modules/.experimental-vitest-cache`; 5.0 spells it `fsModuleCache`, writes `node_modules/.vitest-cache`, and logs a deprecation for the `experimental` spelling (`index.DzobfTyw.js:14709`). On 5.0 the option is in `PROJECT_CLI_OVERRIDES`. On 4.1 a project inherits the root's value only when its own config leaves it unset (`cli-api.CnMVyzaz.js:10372`), and `createVitest` itself runs `ensureCacheIntegrity()` (`:13245`), which creates the cache directory and a metadata file when any project has it on (`:803`). So a 4.1 project config that turns it on writes before RT Test sees the project.
- **Config file order.** Both look up `vitest.config` then `vite.config`, each in `.ts .mts .cts .js .mjs .cjs` order (`constants` chunk, `configFiles`), the order `find-workspaces.ts`'s `CONFIG_EXTENSIONS` holds.
- **Config loader.** `createVitest` passes `options.configLoader` to Vite (4.1 `:14283`, 5.0 `:14767`), and each project config inherits the root's (4.1 `:11121`, 5.0 `:12847`). Vite 8.3.1 bundles a config it treats as ESM into `node_modules/.vite-temp/<name>.timestamp-*.mjs`, creating that directory, or beside the config when no `node_modules` exists, and unlinks only the file (`vite/dist/node/chunks/node.js`, `loadConfigFromBundledFile`). A config it treats as CommonJS is `require`d through an extension hook, with no file written. Vite decides by `isFilePathESM` (`.m[jt]s` ESM, `.c[jt]s` CommonJS, else the nearest `package.json` `type`), which it does not export.
- **Cancel.** `cancelCurrentRun` calls every cancel listener and then awaits the running promise (4.1 `:13798`, 5.0 `:21202`), so the first cancel's promise does not settle while a test is stuck. `collectTests` clears the cancel listeners and `isCancelling` as it starts (5.0 `:21162`), as a run does, so a cancel issued before that is dropped (U1).
- **Second cancel** (ticket 1.3 § Spike facts, "A stuck test"): "For a test in `for (;;) {}`, the first `cancelCurrentRun` did not end the run within 3 s. A second one ended it within about 10 ms with end reason `interrupted`, on 5.0.1 and 4.1.11 and on both the `forks` and `threads` pools. After that, `close()` returned and no worker process remained. `collectTests` over a module that loops at top level also ended on the second cancel, on both versions. A synchronous loop in `globalSetup` runs on the Vitest host's own thread, where no cancel reaches it."

#### Config loading

The three overrides the sprint names leave `node_modules/.vite-temp/` behind, so AC1 also needs the config loaded without a temp file (Q1). RT Test picks the config file Vitest would load, in Vitest's order, passes it as `config`, and passes `configLoader: "runner"` when Vite would treat it as ESM, leaving Vite's default otherwise. The runner loader writes nothing but cannot load CommonJS syntax; the default loader writes nothing for a CommonJS-format config. The ESM test restates Vite's unexported `isFilePathESM` rule, so it lives in one function with the Vite source it mirrors named once. A test pins that function's cases (Q1): `.mts` ESM, `.cts` CommonJS, and `.js` ESM under `"type": "module"` and CommonJS without it.

#### Known limits

The no-write guarantee's exactly five exceptions (owner, 16:00 and 16:05 for the first four, 18:11 for the fifth). All lie under `node_modules`, and each comes from the project's own setup, an old Vite, or a machine whose user data directory cannot be written. They are outside AC1, and each is named in `docs/architecture.md`:

1. Vitest 4.1 on Vite 6.0.x, which has no `configLoader` option, leaves an empty `node_modules/.vite-temp/`. Vitest 5 requires Vite `^6.4.0`.
2. A consumer that turns on Vite's dependency optimizer (off by default) gets its cache written under `node_modules/.vite/vitest`. `deps` is in neither version's per-project override list, and it is not forced off.
3. A workspace whose project config files differ in format from its root config. An ESM project config under a CommonJS root is loaded by the bundle loader and leaves `node_modules/.vite-temp/`. A CommonJS project config under an ESM root fails to load under the runner, which is recorded as a failed workspace. That half is not a write: the bundle loader loads such a workspace today, so it is a load regression. The owner's ruling names it in these words ("or the runner failing a CJS project config, which surfaces as a failed workspace", 16:00 and 16:05), so it is accepted as part of this exception.
4. A Vitest 4.1 project config that itself sets `experimental.fsModuleCache` gets the module cache written (§ Vitest facts).
5. Vitest 5 creates its API token file whatever `api: false` says, in the user data directory (`%LOCALAPPDATA%\vitest` on Windows, `XDG_DATA_HOME` or `~/.local/share` on Linux). Only when that cannot be written does it fall back to `<workspace root>/node_modules/.vitest/.vitest-secret-token` (5.0.1 `index.DzobfTyw.js` `resolveApiToken`).

#### Design notes

- **One grace constant.** `FORCE_STOP_GRACE_MS` lives alone in `force-stop.ts`: ticket 1.3 derives its executor bound from it (C8), and a test mocks the module down rather than waiting 10 s per case (C97). That test waits in real time for the mocked-down grace, a deviation from C105: `createVitest` runs in the test's own process, so fake timers would also freeze the Vitest host's timers.
- **When the force-stop fires.** Once the grace has passed since the signal aborted and the job has not ended. The first cancel stays as 1.1b built it: withheld until Vitest queues a module, since Vitest drops a cancel issued before it resets its cancel state. When that withheld cancel is issued after the grace has passed, the force-stop follows it at once: the stop has already waited the grace. No force-stop is issued after the job ended.
- **The force-stop fact.** A field on the `ran` run, set exactly when the second cancel was issued before the run ended. It is not a new `execution` value (C119): a force-stopped run is still an interrupted run, and its tests are still interrupted or finished as Vitest reports them.
- **An aborted discovery.** It rejects with `signal.reason`, the `AbortSignal` convention, after `inWorkspaceSession` has closed the instance and restored the host. 1.3 stores nothing for it (1.3 AC5), so no discovery shape or discovery table changes. Errors inside a workspace stay recorded in the discovery as today; a discovery that was not aborted never rejects for an interrupt.
- **The migration.** Version 1 has only 1.2's tables, and 1.2's code never issued a second cancel, so every version-1 `ran` row reads back as not force-stopped, which is true. That is a fact about 1.2's code, which could not force-stop, not a default for a value the record never held (C12). The migration runs under `BEGIN IMMEDIATE`, re-reads the header there, and migrates only a version-1 store, so two openers of one old store migrate it once.
- **Unanalyzed.** Linux behavior of the config loaders (the gate runs the test there). Vite 6.1 to 7.2 (U2). Whether a force-stopped Windows `forks` worker leaves an orphan when Vitest's own process is killed, which is 1.3's executor-bound territory.

#### Sizing

About 23 raw files, 30 estimated: the 9 production files to modify and 2 to create that Execution Metadata lists; the test files (`discover-tests.test.ts`, `store.test.ts`, a new test file for the mocked grace, a home for Q1's config-loader cases, `defects.json`); about 6 small fixture files; and `docs/architecture.md` and `docs/glossary.md`, which the orchestrator writes. Code units: 7 criteria plus validation. The work splits into three disjoint groups: the overrides and loader, the interrupt and force-stop, and the store. The orchestrator ruled to proceed at this size (Q4, 16:05). Implementation is delegated to implementer agents, since the estimate is over 10.

#### Current structure of the modified files

- `workspace-session.ts`: `queueSessionJob(job)`, the one queue every discovery and run joins; `inWorkspaceSession(workspace, reporters, step)`, which resolves the workspace's Vitest, captures the host's env and exit code, calls `createVitest("test", { root, watch: false, reporters, api: false, ui: false })`, runs `step`, then closes the instance and restores the host whatever happened; `openSession` filters browser-mode projects (`BROWSER_MODE_REASON`) and typecheck specifications.
- `run-workspace.ts`: `runWorkspace(workspace, signal)`; `WorkspaceRun` with statuses `ran`, `unsupported`, `failed`, `interrupted-before-load`; `RunInterruption`, a reporter that withholds its one cancel (`INTERRUPT_REASON` `"keyboard-input"`) until `onTestModuleQueued`, records `onTestRunEnd`'s reason, and reports `execution` and `cancelError`. Its docblock says "A second cancel would make Vitest force-stop its workers and skip the project's teardown, so at most one is issued."
- `discover-tests.ts`: `discoverTests(consumerRoot)` queues `discoverAll`, which runs `inWorkspaceSession(workspace, [], collectWorkspace)` for each workspace in turn; `collectWorkspace` calls `instance.collectTests(specifications)`.
- `adapter-version.ts`: `VITEST_ADAPTER_VERSION = 1`.
- `store/schema.ts`: `STORE_SCHEMA_VERSION = 1` and `STORE_SCHEMA`, whose `runs` table holds `execution`, `nothing_ran`, `cancel_error` and `close_error` among its columns.
- `store/open-store.ts`: `openStore(stateDirectory)` sets `busy_timeout`, runs `checkedHeader` (refusing another application id, a newer version, and an older one as "its schema version is not one this RT Test reads"), sets WAL, and creates the schema for a new file through `createSchema` under `inWriteTransaction` with a header re-check.
- `store/write-run.ts`: `RunColumns`, `NO_RUN_COLUMNS`, `INSERT_RUN` (19 placeholders), `runColumns` by status, `ranColumns`; the run is read back inside the write transaction.
- `store/read-runs.ts`: `RUN_COLUMNS`, `ranRun(row, workspace, modules)` rebuilding the `ran` variant with `optionalText` for its optional columns.

#### Existing tests this change breaks

- `packages/daemon/test/discover-tests.test.ts`: `discoverConsumer` and `settledDiscovery` call `discoverTests(root)` with no signal (2 sites, `rg -n "discoverTests\(" packages/daemon/test`), a typecheck error once the signal is required. The `consumer` fixture's discovery writes marker files into `unit/` from its own code, which AC1 excludes.
- `packages/daemon/test/store.test.ts`: `RAN_RUN` and `NOTHING_RAN_RUN` are typed `RanRun` and lack the new field. `CREATE_SCHEMA_WORKER` creates `STORE_SCHEMA` at `STORE_SCHEMA_VERSION` and follows both constants. No test in `store.test.ts` names an older schema version (`rg -n "STORE_SCHEMA_VERSION - 1|older" packages/daemon/test/store.test.ts` finds none).
- Unanalyzed: a repository-wide test that scans production files or `docs/architecture.md`; create-tests runs the suite.

#### Previous ticket

1.3 (ready-for-dev, the nearest earlier key): its Dev Notes hold the second-cancel and globalSetup facts quoted above, and its executor imports this ticket's grace constant. 1.2 (done): `openStore` refuses every version but its own, and its read-back inside the write transaction rejects a record the readers cannot rebuild, so the new column must be read back too. Its Completion Notes route the adapter-version comparison to 1.4. 1.1b (done): `RunInterruption` withholds the cancel until Vitest queues a module (D1180, D1183 and D1208 cover it), and the `run-interrupt` fixture's run hooks can hold a run at `configure`, `global-setup`, `run-start` or, mid-run, at `running:<test>` (the event lane `interrupt-races` is moving the mid-run hold to).

### References

- `node scripts/list-open-issues.mjs` printed `0 open issues, complete`.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C8,C10,C12,C30,C32,C38,C39,C41,C46,C48,C52,C55,C59,C60,C72,C76,C77,C80,C84,C94,C95,C97,C105,C106,C119,C124,C131,C140,C142,C149,C150,C156 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P16,P17,P18,P19,P21,P22,P23,P24,P25,P27,P35,P41,P42 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area: packages/daemon
is_consolidation: false
sizing_ac_count: 8
files_to_modify:
  - packages/daemon/src/vitest/workspace-session.ts
  - packages/daemon/src/vitest/run-workspace.ts
  - packages/daemon/src/vitest/discover-tests.ts
  - packages/daemon/src/vitest/find-workspaces.ts
  - packages/daemon/src/vitest/adapter-version.ts
  - packages/daemon/src/store/schema.ts
  - packages/daemon/src/store/open-store.ts
  - packages/daemon/src/store/write-run.ts
  - packages/daemon/src/store/read-runs.ts
files_to_create:
  - packages/daemon/src/vitest/force-stop.ts
  - packages/daemon/src/vitest/config-loader.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 2c35e81e-9845-4ea6-ad4e-a38534cafc2e

#### Test Files This Change Broke

- `packages/daemon/test/discover-tests.test.ts`: `discoverConsumer` and `settledDiscovery` call `discoverTests(root)` with no signal (typecheck errors at lines 49 and 85). Pass a never-aborted signal.
- `packages/daemon/test/store.test.ts`: `RAN_RUN` and `NOTHING_RAN_RUN` lack the required `forceStopped` (typecheck errors at lines 180 and 196). `CREATE_SCHEMA_WORKER` follows `STORE_SCHEMA` and `STORE_SCHEMA_VERSION` and needs no edit.
- `packages/daemon/test/defects.json`: eight records whose `old` text no longer matches exactly once. D1050, D1054 and D1055 anchor `: await instance.collectTests(specifications);` in `discover-tests.ts`, which now reads `instance.collectTests(specifications),` inside `interruption.duringCollect`. D1180, D1183, D1186, D1187 and D1208 anchor `RunInterruption` code in `run-workspace.ts`, which moved to `packages/daemon/src/vitest/run-interruption.ts`: `if (this.queued) this.cancel();` is now `if (this.ready) this.cancel();` in `during`'s `onAbort`, `if (this.signal.aborted) this.cancel();` is now `if (!this.signal.aborted) return;` followed by `this.cancel();` in `markReady`, and the `execution()` lines moved unchanged.

#### ACs Owed a Test

- AC4, its clause "no Vitest worker process remains": the dev evidence saw the stuck runs end and `close()` return, but did not enumerate worker processes afterwards. Ticket 1.3's spike is the only observation of it.

#### Tests Owed

- AC1, AC2 (the sprint's named-defect test): a run and a discovery over a consumer whose config sets `update: true`, coverage enabled, the module cache on (`fsModuleCache` on 5.x, `experimental.fsModuleCache` on 4.1), with `UPDATE_SNAPSHOT=all`, leave every file and directory under the consumer unchanged, `node_modules` included, on both installs, for an ESM config and a CommonJS-format config. The file and inline snapshot tests record failed and a plain test passed. Defects: any one override dropped; the loader choice inverted.
- AC1 (Q1): `workspaceConfig`'s ESM rule over `.mts`, `.cts`, and `.js` under `"type": "module"` and without it, plus a `package.json` that does not parse being passed over for the next one up, and the `vitest.config` before `vite.config` order.
- AC3: aborted before its turn loads nothing and rejects with the reason; aborted mid-collection of a multi-workspace consumer loads no further workspace and rejects with the reason only after the host env and exit code are restored; never aborted returns what it returns today.
- AC3, AC4 (U3 re-plan): a discovery aborted while its only module holds collection open ends when the module releases rather than at the grace, which proves the withheld first cancel is issued after `collectTests` resets (`duringCollect`'s `setImmediate`).
- AC4, AC5: with `FORCE_STOP_GRACE_MS` mocked down (C97, with a literal pin of 10000 through `vi.importActual`), a `for (;;) {}` test ends as an interrupted run with `forceStopped: true` and every unfinished test interrupted, on `forks` and `threads`, both installs; a discovery of a module looping at load rejects with the reason; a run interrupted mid-test that ends inside the grace has `forceStopped: false` and its `afterAll` ran.
- AC6: a written run reads back `forceStopped` unchanged for both values; a version-1 store (build it with the migration's inverse, as the dev evidence did) opens, reads its `ran` runs as not force-stopped and is at version 2 after; a newer version, another SQLite database and a non-database file are still refused unchanged; a `ran` row holding NULL or 2 in `force_stopped` is refused as unreadable.
- AC7: `VITEST_ADAPTER_VERSION` is 2 on a stored run and a stored discovery.
- AC8: over a fixture root whose `workspaces` holds a `..` pattern to a sibling workspace, a `parent/*` pattern with a link inside leading out, and an inside workspace, only the inside workspace is listed, and each escape is in `notRead` under its pattern with its real path in the reason. Defects: the check compares lexical paths, so the link escapes; a refused directory is dropped with no `notRead` entry. A link that stays inside the root still lists, so the check is not a blanket link refusal. Build the links as junctions, so the test runs on Windows as well as Linux (P13).
- AC9: two entries reaching one directory, one through a junction, list the first in pattern order once and report the second in `notRead` naming the first; a junction back to the root reports as a duplicate of `.`. Defects: dedup keyed on the workspace path, so both entries list; the duplicate dropped with no `notRead` entry; the later entry kept instead of the first.

### Tests Record

Tests session: threadId 4655dce9-b7cd-41b4-b9b3-ff97cd0750bc

Step 3's scoped suite (`bun x vitest related <the production files> --run`, 4 of 39 test files) found only the stale breaks the Dev Handoff lists: 22 reds in `discover-tests.test.ts` and 3 in `store.test.ts`. Both were repaired: a never-aborted signal at the two `discoverTests` call sites, and `forceStopped` on `RAN_RUN` (true, an interrupted run) and `NOTHING_RAN_RUN` (false, a completed one). The 8 stale records were re-anchored with their meaning unchanged: D1050, D1054 and D1055 to `instance.collectTests(specifications),` in `discover-tests.ts`, and D1180, D1183, D1186, D1187 and D1208 to `run-interruption.ts`. All 8 are detected. No code bug was found.

Survivors diagnosed (C65):

- `workspace-session.ts` `coverage: COVERAGE_OFF`: a mutation no AC1 test can observe. On the `runTestSpecifications` path, neither version starts the host-side coverage provider that writes reports; only `start`, `standalone` and `createCoverageProvider` do. A probe with the override dropped wrote nothing on either install. The override still protects the run. Without it, the consumer's `coverage.enabled` is serialized to every worker, which then starts coverage collection (5.0.1 `index.DzobfTyw.js:9811-9822`, 4.1.11 `cli-api.CnMVyzaz.js:9261-9269`), and 5.0 also keeps Node's compile cache off there (`:11658-11661`). No file is written either way. D1309's test stands, and its record mutates the results cache instead.
- `workspace-session.ts` `await instance?.close()` after a force-stop: unobservable. Vitest's force-cancel stops each fork and awaits its `exit` (5.0 `ForksPoolWorker.stop`), so the stuck worker is gone before `close()` runs. No single edit to RT Test's code leaves a worker alive after the run returns. The AC4 clause "no Vitest worker process remains" is observed in D1319 and D1321's assertions, on the forks pool of both installs.
- `run-interruption.ts` `duringCollect`'s `setImmediate`, turned into a synchronous `markReady`: unobservable. The first cancel it withholds could be dropped only by an abort landing in the microtasks between `collectTests` starting and its reset, and no caller's abort can land there. D1302 and D1304 prove that the withheld cancel is issued mid-collection by deleting it.

Evidence (Windows 11, Node 24.19.0): the 4 touched daemon test files pass, 189 tests. The same 4 files pass on Linux (WSL, Node 24.19.0), 189 tests. `bun run test:defects` on Windows (17:46 to 17:50) exits 0, 766 of 766 detected, with the whole suite green as its baseline before and after. On Linux (WSL clone at 78d5b60 plus this tree, Node 24.19.0, 17:51 to 17:54) it also exits 0, 766 of 766. After the review's gap rows G1 to G9, and over the review's snapshot guard: `bun run test:defects` on Windows (18:22 to 18:26) exits 0, 777 of 777 detected, and on Linux (WSL, 18:27 to 18:30) exits 0, 777 of 777.

#### Named Defects

- D1050, D1054, D1055, D1180, D1183, D1186, D1187, D1208: re-anchored to the moved code, meaning unchanged.
- D1276: A run is stored not force-stopped whatever it recorded, so a force-stopped run reads back as one whose afterAll hooks ran. (AC6)
- D1277: A stored run that was not force-stopped reads back force-stopped. (AC6)
- D1278: The migration adds the force-stop column but never marks the version-1 ran runs, so each reads back unreadable. (AC6)
- D1279: The opener refuses a version-1 store as an older schema instead of migrating it. (AC6)
- D1280: The migration leaves the header at version 1, so the migrated store still claims the old schema. (AC6)
- D1281: The migration marks every run not force-stopped, giving runs that never loaded their workspace a force-stop value they never held. (AC6)
- D1282: An opener that read the version-1 header before another opener migrated the file migrates it again and fails on the column that already exists. (AC6)
- D1283: The opener migrates an RT Test store of any schema version up to 1, so a version-0 store is changed rather than refused. (AC6)
- D1284: A ran run with no recorded force-stop fact is coerced to not force-stopped rather than refused. (AC6)
- D1285: The Vitest adapter version stays 1, so a run stored under update none looks current beside runs stored when missing snapshots were written. (AC7)
- D1286: The Vitest adapter version stays 1, so a discovery stored under the new overrides looks current beside ones stored before them. (AC7)
- D1287: A .mts config is not read as ESM by its extension, so in a package with no type it goes to the bundle loader, which writes node_modules/.vite-temp. (AC1)
- D1288: A .cts config is not read as CommonJS by its extension, so in a package of type module it goes to the runner, which cannot load CommonJS. (AC1)
- D1289: A .js config is never read as ESM, so in a package of type module it goes to the bundle loader, which writes node_modules/.vite-temp. (AC1)
- D1290: A .js config in a package with no type is read as ESM, so it goes to the runner, which cannot load CommonJS. (AC1)
- D1291: A package.json that does not parse ends the search as a package with no type, where Vite passes over it to the next one up. (AC1)
- D1292: A nearest package.json with no type is passed over for an ancestor's type, where Vite lets the nearest one decide. (AC1)
- D1293: A vite.config file is chosen over a vitest.config file, the reverse of Vitest's own lookup. (AC1)
- D1294: A workspace outside the consumer root is dropped with no notRead entry, so its pattern silently finds nothing. (AC8)
- D1295: The outside check compares lexical paths, so a link inside the root that leads out is listed and loaded. (AC8)
- D1296: Every directory reached through a link is refused as outside the root, even one whose real path lies inside it. (AC8)
- D1297: Duplicates are keyed on the workspace path, so two entries reaching one directory are both listed and it loads twice. (AC9)
- D1298: A later entry resolving to a listed directory is dropped with no notRead entry. (AC9)
- D1299: The consumer root is checked after the pattern entries, so a link back to it is kept and the root itself is reported as the duplicate. (AC9)
- D1300: A discovery whose signal aborted before its turn still loads its first workspace's config before rejecting. (AC3)
- D1301: A discovery aborted mid-collection goes on to load the next workspace and resolves with a result instead of rejecting. (AC3)
- D1302: Discovery never marks collection ready for its withheld first cancel, so an abort mid-collection lets Vitest collect every remaining module. (AC3)
- D1303: An aborted discovery rejects as soon as its signal aborts, while the Vitest instance is still open and the host still holds the workspace's environment and exit code. (AC3)
- D1304: On Vitest 4.1, discovery never marks collection ready for its withheld first cancel, so an abort mid-collection lets Vitest collect every remaining module. (AC3)
- D1305: Every run that loaded its workspace records Vitest as force-stopped, even one that completed. (AC5)
- D1306: An abort mid-run force-stops Vitest at once rather than after the grace, skipping the project's afterAll hooks for a run that would have ended in time. (AC4, AC5)
- D1307: A run aborted while its workspace loaded, which issued no cancel at all, records Vitest as force-stopped. (AC5)
- D1308: The loader choice is inverted on a run, so an ESM config goes through the bundle loader and leaves node_modules/.vite-temp behind. (AC1) Its earlier mutation, `update: "none"` dropped, is now unobservable as a write: the snapshot guard keeps every save from reaching disk. D1317 still sees update: true through the recorded outcomes.
- D1309: Vitest 4.1's results cache is left on, so a run writes its results under node_modules/.vite/vitest. (AC1)
- D1310: Vitest's results cache is left on, so a run writes its results under node_modules/.vite/vitest. (AC1)
- D1311: The module cache is not turned off in the experimental spelling Vitest 4.1 reads, so a run with it on writes node_modules/.experimental-vitest-cache. (AC1)
- D1312: The loader choice is inverted, so a config Vite treats as ESM goes through the bundle loader and leaves node_modules/.vite-temp behind. (AC1)
- D1313: The loader choice is inverted, so a CommonJS config goes through the runner, which cannot load it, and the workspace fails. (AC1)
- D1314: The module cache is not turned off in the top-level spelling Vitest 5 reads, so a job with it on writes node_modules/.vitest-cache. (AC1)
- D1315: The chosen config file and loader are never passed, so Vitest loads an ESM config through Vite's default bundle loader and leaves node_modules/.vite-temp behind. (AC1)
- D1316: Snapshot update is set to new, so a snapshot with none stored is written and recorded passed rather than failed. (AC2)
- D1317: On Vitest 4.1, snapshot update is left to the consumer's update: true, so every snapshot test is rewritten and recorded passed. (AC2)
- D1318: The force-stop grace is 1 second rather than 10, so a run or discovery that would end cleanly within 10 seconds of a stop is force-stopped and skips its afterAll hooks. (AC4)
- D1319: The grace timer passes without issuing the second cancel, so on Vitest 5's forks pool a run stuck in a synchronous loop is never force-stopped. The test also pins that no worker process remains. (AC4, AC5)
- D1320: The grace timer passes without issuing the second cancel, so on Vitest 5's threads pool a run stuck in a synchronous loop is never force-stopped. (AC4, AC5)
- D1321: The grace timer passes without issuing the second cancel, so on Vitest 4.1's forks pool a run stuck in a synchronous loop is never force-stopped. The test also pins that no worker process remains. (AC4, AC5)
- D1322: The grace timer passes without issuing the second cancel, so on Vitest 4.1's threads pool a run stuck in a synchronous loop is never force-stopped. (AC4, AC5)
- D1323: The grace timer passes without issuing the second cancel, so on Vitest 5's forks pool a discovery stuck loading a looping module is never force-stopped. (AC4)
- D1324: The grace timer passes without issuing the second cancel, so on Vitest 4.1's threads pool a discovery stuck loading a looping module is never force-stopped. (AC4)
- D1325: A run aborted before Vitest queued its first module, and still unqueued when the grace passes, gets its withheld first cancel at the queue but never the force-stop. (AC4, AC5; review G1)
- Review G2 refuted: with `collectWorkspace`'s `throwIfAborted` deleted, a discovery aborted at the `configure` hook still issues its withheld first cancel from `markReady` one macrotask after `collectTests` starts. That is before Vitest's pool starts any module, and each queued task checks `isCancelling` first (U1). A module looping at load therefore never begins. The mutation survived `bun run test:defects` against a test that aborts at `configure` over the `force-stop` fixture's looping module, so the test and D1326 were withdrawn. The line only saves the collection's start.
- D1327: The migration restamps every version-1 run with the current adapter version, so results recorded before update none read back as current. (AC6, AC7; review G3)
- D1328: A nearest package.json that starts with a byte order mark fails to parse and is passed over, so an ESM .js config in a package of type module goes to the bundle loader, which writes node_modules/.vite-temp. (AC1; review G4)
- D1329: A nearest package.json holding null is read as a package with no type, where Vite passes over it to the next one up. (AC1; review G5) Deleting the `null` check alone is masked, since `null.type` then throws inside the same `try` and the `catch` also passes the file over.
- D1330: Every pattern through .. is refused, so a pattern that leaves the root and comes back into it is not listed. (AC8; review G6)
- D1331: Snapshot saving is left to Vitest, so on Vitest 5 under update none a CRLF snapshot file holding an unchecked entry is rewritten on every run. (AC1, AC2; review G8) Every `no-writes` job now writes that trigger into its snapshot file before measuring the tree, so D1308 to D1317 run over it too.
- D1332: Snapshot saving is left to Vitest, so on Vitest 4.1 under update none a CRLF snapshot file holding an unchecked entry is rewritten on every run. (AC1, AC2; review G8)
- D1333: The snapshot guard reaches only the first project, so on Vitest 5's forks pool another project's snapshot file is rewritten. (AC1; review G9)
- D1334: The snapshot guard reaches only the first project, so on Vitest 5's threads pool another project's snapshot file is rewritten. (AC1; review G9)
- D1335: The snapshot guard reaches only the first project, so on Vitest 4.1's forks pool another project's snapshot file is rewritten. (AC1; review G9)
- D1336: The snapshot guard reaches only the first project, so on Vitest 4.1's threads pool another project's snapshot file is rewritten. (AC1; review G9)
- AC3's "a discovery whose signal never aborts returns the same result it returns today" has no record of its own. D1050 to D1083 cover it, over discoveries that now pass a never-aborted signal.

#### Deliberately Untested

- `packages/daemon/src/store/read-runs.ts` `forceStopped`'s final `throw unreadable(...)`: it is reached only by a `force_stopped` value other than 0, 1 or NULL. The column's `CHECK (force_stopped IN (0, 1))` refuses such a write, and `integer()` refuses NULL first (D1284).
- `packages/daemon/src/vitest/workspace-session.ts` `coverage: COVERAGE_OFF`: the override protects the run. It keeps workers from starting coverage collection, and on 5.0 it keeps Node's compile cache available to them. Dropping it is observable in the workers, but no file is written, so no AC-level defect follows (see the survivors above). The `no-writes` fixtures still enable coverage through a custom provider, so the no-writes tests would see a write if one followed.
- AC4 on a stuck discovery covers two of the four install and pool pairs: 5 on `forks` and 4.1 on `threads`. The run covers all four.
- AC4's "no Vitest worker process remains" is checked on the `forks` pool only. On `threads`, a worker is a thread of the host process, so there is no worker process.
- A snapshot file holding an entry no test checks (owner, 17:17: a module error, with test outcomes unchanged): Vitest behavior under update `none`, which the fixtures do not exercise.

### Review Record

Review session: threadId c5d00c8d-0703-4e4a-92fb-b1128aa79953

Tech debt (undisposed):

- `packages/daemon/src/vitest/workspace-session.ts` `noWriteOptions` parses the Vitest major with `Number.parseInt(vitestVersion, 10)`, which `load-vitest.ts` `isSupported` already parses from the same version. The supported `ResolvedVitest` could carry `major`, so one expression answers it.

Denominator: 49 new named-defect tests (D1276 to D1324) and 8 re-anchored, against 9 criteria. The rows below are behaviors those criteria name that no test catches.

#### Test Coverage Gaps

| #   | Source                                                                                                                             | Named defect                                                                                                                                                                                                                                                                                                                                                                                         | Expected test                                                                                                                                                                                                                                                                                                                                                                                                     | Severity                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| G1  | `packages/daemon/src/vitest/run-interruption.ts` `markReady`'s `this.forceStopIfDue();`                                            | A run aborted before Vitest queued its first module, and still unqueued when the grace passes (an async `globalSetup` held past the grace), gets its withheld first cancel at the queue but never the force-stop, so a test then stuck in a synchronous loop is never force-stopped. (AC4, AC5)                                                                                                      | Mocked grace; abort while `globalSetup` awaits past it, then release into a `for (;;) {}` test; the run ends interrupted with `forceStopped: true`. Mutation: delete that call.                                                                                                                                                                                                                                   | MEDIUM, daemon-state    |
| G2  | `packages/daemon/src/vitest/discover-tests.ts` `collectWorkspace`'s `interruption.signal.throwIfAborted();`                        | A discovery aborted while its workspace loads (the `configure` hook) still starts collecting; its abort listener joins an already-aborted signal, so no grace timer starts and a module looping at load is never force-stopped. (AC3, AC4)                                                                                                                                                           | Abort a discovery at the `configure` hook over a workspace whose module loops at load; it rejects with the reason before the loop ends, with the host restored. Mutation: delete that line.                                                                                                                                                                                                                       | MEDIUM, daemon-state    |
| G3  | `packages/daemon/src/store/schema.ts` `STORE_MIGRATION`                                                                            | The migration restamps every version-1 run and discovery with the current adapter version, so results recorded before `update: "none"` read back as current. (AC6, AC7)                                                                                                                                                                                                                              | Build the version-1 store with `adapter_version = 1` on its runs and discoveries (today's fixture carries 2), migrate, and read back adapter version 1. Mutation: append an `UPDATE runs SET adapter_version = 2` to the migration.                                                                                                                                                                               | MEDIUM, daemon-state    |
| G4  | `packages/daemon/src/vitest/config-loader.ts` `readManifest`'s byte order mark strip (review fix)                                  | A nearest `package.json` that starts with a byte order mark is passed over, so an ESM `.js` config in a `"type": "module"` package whose manifest has a BOM goes to the bundle loader, which writes `node_modules/.vite-temp`. Vite strips the mark (`vite@8.3.1` `dist/node/chunks/node.js` `loadPackageData`). (AC1)                                                                               | `workspaceConfig` over a BOM-prefixed `{"type":"module"}` manifest picks `runner`. Mutation: parse `text` unstripped.                                                                                                                                                                                                                                                                                             | MEDIUM, daemon-state    |
| G5  | `packages/daemon/src/vitest/config-loader.ts` `readManifest`'s `if (manifest === null) return { found: false };` (review fix)      | A nearest `package.json` holding `null` is read as a package with no type, where Vite passes over it to the next one up. (AC1)                                                                                                                                                                                                                                                                       | A `.js` config under a `null` manifest inside a `"type": "module"` package picks `runner`. Mutation: delete that line.                                                                                                                                                                                                                                                                                            | LOW, daemon-state       |
| G6  | `packages/daemon/src/vitest/find-workspaces.ts` `outsideRootReason`                                                                | Any pattern through `..` is refused, so a pattern that leaves the root and comes back into it (`../<root name>/inner`) is not listed, against AC8's last clause.                                                                                                                                                                                                                                     | Such a pattern lists `inner`. Mutation: refuse every pattern starting with `..` before the real-path check.                                                                                                                                                                                                                                                                                                       | LOW, daemon-state       |
| G7  | Deliberately Untested, `workspace-session.ts` `coverage: COVERAGE_OFF`                                                             | The recorded reason says no mutation of the override is observable. Installed source says otherwise: without it the consumer's `coverage.enabled` is serialized to every worker, which starts the coverage provider (5.0.1 `index.DzobfTyw.js:9811-9822`, 4.1.11 `cli-api.CnMVyzaz.js:9261-9269`), and 5.0 also disables Node's compile cache there (`:11658-11661`). No file is written either way. | Correct the reason to that: observable, but no AC1 write follows. Add a test only if you can name an AC-level defect.                                                                                                                                                                                                                                                                                             | LOW, internal           |
| G8  | `packages/daemon/src/vitest/workspace-session.ts` `openSession`'s `guardSnapshots(instance);` and `snapshot-guard.ts` (review fix) | RT Test leaves snapshot saving to Vitest, so under update `none` a snapshot file checked out with CRLF line endings and holding an unchecked entry is rewritten on every run. (AC1, AC2; orchestrator 18:11: the exact trigger goes into the `no-writes` fixtures)                                                                                                                                   | Add to each `no-writes` fixture a CRLF `.snap` holding an entry no test checks, and assert the tree unchanged on both installs. Write the CRLF bytes from the test, or keep them out of git's newline conversion, so the trigger survives a checkout on either platform. Mutation: delete that call.                                                                                                              | CRITICAL, consumer tree |
| G9  | `workspace-session.ts` `guardSnapshots`                                                                                            | The guard reaches only the root project, so a snapshot file of a project that a workspace's `projects` config names is rewritten. Each project resolves its own setup files and `snapshotEnvironment`, and neither is a per-project CLI override. (AC1)                                                                                                                                              | A workspace with two projects, one on Vitest's own snapshot environment and one naming its own `snapshotEnvironment`, each with a CRLF `.snap` holding an unchecked entry: the tree is unchanged, and each project's stored snapshot still passes, which proves reads still go through the consumer's environment. On both installs, `forks` and `threads`. Mutation: guard only `instance.projects.slice(0, 1)`. | CRITICAL, consumer tree |

### Completion Notes

Ticket sanity check: no findings.

What was built:

- `force-stop.ts` holds `FORCE_STOP_GRACE_MS = 10_000` alone. Its docblock names what it does not reach: work on Vitest's own thread, such as config loading or `globalSetup`.
- `RunInterruption` moved from `run-workspace.ts` to `run-interruption.ts`, so the run and the discovery share it. `duringRun` takes the reset from `onTestModuleQueued`. `duringCollect` takes it one macrotask after calling `collectTests` (U3 re-plan). On abort it starts the grace timer. Once the grace has passed with the first cancel issued, the job still going and no `onTestRunEnd` seen, it issues the second cancel, and `forceStopped()` reports whether it did. The timer is cleared when the job ends.
- `workspace-session.ts` passes `coverage: { enabled: false }`, `update: "none"`, `cache: false`, and the module cache off, spelled by the loaded major: top-level on 5 and up, `experimental` below. It also passes `config` and `configLoader` from `config-loader.ts`'s `workspaceConfig`.
- `config-loader.ts` imports only `node:fs`, `node:path` and `find-workspaces.ts` (orchestrator ruling, 16:38). `workspaceConfig(directory)` returns the absolute config file Vitest would load, in its `vitest.config` then `vite.config` order, and the loader: `runner` when Vite's `isFilePathESM` rule reads it as ESM, `bundle` otherwise. Tickets 1.3 and 1.3c reuse it for the config-file choice.
- AC8 (owner ruling 17:17): `findVitestWorkspaces` resolves each directory a `workspaces` pattern expands to with `realpathSync.native`, compares it with the consumer root's real path through `path.relative`, and reports one outside the root in `notRead` under its pattern, with the reason "`<directory>` resolves to `<real path>`, outside the consumer root `<real root>`, so it was not searched". A directory or root whose real path cannot be read is refused the same way with the read error. The root itself is not checked, since it is the project that was started.
- AC9 (orchestrator decision 17:19): `findVitestWorkspaces` keys each listed workspace by `realpathSync.native` of its directory (the directory itself when that cannot be read) and reports a later workspace resolving to a listed real path in `notRead` under its own path, with the reason "resolves to `<real path>`, the directory of workspace `<kept path>`, which is listed in its place".
- `discoverTests(consumerRoot, signal)`: it throws the signal's reason before its turn's work, fails the in-progress step before collecting when the signal has aborted, interrupts `collectTests` through `duringCollect`, and throws the reason after each workspace's session has closed and restored the host.
- `WorkspaceRun`'s `ran` variant carries `forceStopped: boolean`. The store (built by implementer partition `impl-daemon-store`) is at schema version 2, with a `force_stopped` column that is NULL except on `ran` rows. `openStore` migrates exactly version 1 under `BEGIN IMMEDIATE`, re-reading the header. `VITEST_ADAPTER_VERSION` is 2.

Deviations from the task text:

- `find-workspaces.ts` exports `VITEST_CONFIG_FILES` and `VITE_CONFIG_FILES` but not `CONFIG_EXTENSIONS`: no module outside it reads the extensions, and an unread export fails C59. The column definition `FORCE_STOPPED_COLUMN` in `schema.ts` stays private for the same reason.
- U3 was FALSE, so discovery's first cancel is withheld until `collectTests` has reset its cancel state rather than until a module is queued (the resolution beneath the Unverified Assumptions table). What AC3 and AC4 promise is unchanged.

Acceptance evidence (dev probe over the built package, Windows 11, Node 24.19.0, Vitest 5.0.1 and 4.1.11, 2026-09-26 16:56 to 17:12, probe removed):

- AC1, AC2: a discovery and then a run over a consumer whose config sets `update: true`, coverage enabled and the module cache on, with `UPDATE_SNAPSHOT=all`, changed nothing under the consumer. The tree was walked by hash, `node_modules` included, the `vitest` junction not followed. That held on both installs, for an ESM `.mjs` config under `"type": "module"` and a CommonJS `.js` config (`module.exports`) without it. `file snapshot` and `inline snapshot` recorded failed, and `plain` passed.
- AC3: aborted before its turn, it rejected with the reason. Aborted 1 s into a 3 s held collection, it rejected with the reason at about 3.5 s, when the held module released. Never aborted, it resolved with its one test. The ordering of the rejection after close and restore is traced: `inWorkspaceSession` closes and restores before it returns, and `discoverAll` throws after that return.
- AC4: a `for (;;) {}` test aborted at 1.5 s ended at about 11.5 s as `execution: "interrupted"`, with every test interrupted, on `forks` and `threads` and both installs. A discovery of a module looping at load, aborted at 1.5 s, rejected with the reason at about 11.5 s on both installs. A run aborted 2 s into a 4 s test ended at about 2 s, not force-stopped, with its `afterAll` run. Worker processes were not enumerated afterwards (ACs Owed a Test).
- AC5: `forceStopped` was true on the stuck runs and false on the completed and the graceful runs.
- AC6: a `ran` run written with `forceStopped: true` read back true. A store rebuilt at version 1 (column dropped, header set to 1) opened, read its `ran` run as not force-stopped and its `interrupted-before-load` run without the field, and held `user_version` 2 with rows `ran: 0` and `interrupted-before-load: NULL`. The header set to 3 was refused.
- AC7: `VITEST_ADAPTER_VERSION` is 2, and `writeRun` and `writeDiscovery` stamp it on every stored run and discovery.
- AC8 (17:24): a root with `workspaces: ["../sibling", "links/*", "ext/*", "packages/*", "../repo/tools/real"]`, where `links/out` is a junction to the sibling, `links/in` a junction to `tools/real`, and `ext` a junction to a directory beside the root, listed `links/in`, `packages/inside` and `tools/real`, and reported `../sibling`, `links/*` (for `links/out`) and `ext/*` (for `ext/x`) in `notRead`, each reason naming the real path it resolves to and the root.
- AC9 (17:21): a root holding a config, with `workspaces: ["links/*", "tools/real", "packages/*", "packages/a"]`, `links/in` a junction to `tools/real` and `links/root` a junction to the root, listed `.`, `links/in` and `packages/a`, and reported `links/root` (duplicating `.`) and `tools/real` (duplicating `links/in`) in `notRead`.

Adversarial review (2026-09-26 17:03), 6 findings:

- F1 HIGH: a version-1 process still holding the store open after another migrates it would write a `ran` row with a NULL `force_stopped`, which the new reader refuses for the whole scope. Discarded: no version-1 writer has run in production, since `openStore` had no production caller before this change and ticket 1.3's daemon is the first. A status-tied CHECK fails the ADD COLUMN on version-1 rows, and a trigger is machinery for an unreachable state (C10).
- F2 MEDIUM: the grace does not bound an abort during `globalSetup` or config load. Fixed as a doc correction in `force-stop.ts`. AC4 puts work on Vitest's host thread out of reach, and ticket 1.3's executor bound ends it.
- F3 MEDIUM: under `update: "none"`, Vitest adds "Obsolete snapshots found when no snapshot update is expected" to a module holding unchecked snapshot entries and fails the file (5.0.1 `index.m3L2HgmY.js` `onAfterRunSuite`). RT Test records that as a module error beside the tests' own outcomes, which are unchanged. This follows from the owner's `none` ruling. No code change; sent to the orchestrator as an FYI.
- F4 LOW: the `forceStopped` docblock claimed more than is recorded, and a second cancel could follow `onTestRunEnd`. Fixed: the docblock states what is recorded, and `forceStopIfDue` issues nothing once `onTestRunEnd` has fired.
- F5 LOW: discovery never reads the cancel calls' errors. Discarded: the ruling fixes an aborted discovery's rejection to `signal.reason`, and nothing is stored for it that could carry them.
- F6 LOW, pre-existing: `findVitestWorkspaces` expands a `workspaces` pattern such as `../sibling` outside the consumer root. The owner ruled to refuse it (17:17), built as AC8.

Change-request candidates:

None open: the dedup candidate was built as AC9 (orchestrator decision 17:19).

README: no change. The daemon has no user-visible surface yet: nothing calls `runWorkspace` or `discoverTests` in production, and the README's status describes no run or discovery behavior this changes.

AC9 gates (2026-09-26 17:22): lint clean, the daemon typecheck showing only the four test-file errors, and every `find-workspaces.ts` defects.json anchor matching once. AC9 went to the tests member and its architecture.md clause to the orchestrator at 17:27.

Gates (2026-09-26 17:08, this tree): `bun x oxlint` over the 12 production files exit 0 with no warning. `bun x prettier --check` over them and this ticket exit 0. `bun run --filter @rt-test/daemon typecheck` exit 1, only the four errors in the two test files listed under Test Files This Change Broke. `node scripts/check-line-citations.mjs` clean. No other workspace depends on `@rt-test/daemon`.

### File List

Dev (this session and partition `impl-daemon-store`):

- `packages/daemon/src/vitest/force-stop.ts` (created)
- `packages/daemon/src/vitest/run-interruption.ts` (created)
- `packages/daemon/src/vitest/config-loader.ts` (created)
- `packages/daemon/src/vitest/run-workspace.ts` (modified)
- `packages/daemon/src/vitest/discover-tests.ts` (modified)
- `packages/daemon/src/vitest/workspace-session.ts` (modified)
- `packages/daemon/src/vitest/find-workspaces.ts` (modified)
- `packages/daemon/src/vitest/adapter-version.ts` (modified)
- `packages/daemon/src/store/schema.ts` (modified)
- `packages/daemon/src/store/open-store.ts` (modified)
- `packages/daemon/src/store/write-run.ts` (modified)
- `packages/daemon/src/store/read-runs.ts` (modified)
- `_agent-docs/tickets/1-3b-run-safety.md` (modified: checkboxes, assumption resolutions, Dev Agent Record)
- Held for the orchestrator, as exact text: `docs/architecture.md` § Current implementation and `docs/glossary.md`. FR4's marker in `docs/requirements.md` already lists 1.3b, so it needs no change.

Tests (session 4655dce9-b7cd-41b4-b9b3-ff97cd0750bc):

- `packages/daemon/test/force-stop.test.ts` (created)
- `packages/daemon/test/discover-tests.test.ts`, `find-workspaces.test.ts`, `store.test.ts`, `harness.ts`, `defects.json` (modified)
- `test/fixtures/daemon/discover-interrupt/`, `test/fixtures/daemon/force-stop/`, `test/fixtures/daemon/no-writes/` (created)
- Written by the orchestrator: `docs/testing.md` (D1276 to D1324) and `.oxlintrc.json` (`vitest/no-restricted-matchers` off for `test/fixtures/**`)

Review (session c5d00c8d-0703-4e4a-92fb-b1128aa79953): `packages/daemon/src/vitest/snapshot-guard.ts` (created); `packages/daemon/src/vitest/config-loader.ts` and `workspace-session.ts` (modified).

Planning files the create-ticket run wrote:

- `_agent-docs/tickets/1-3b-run-safety.md` (created)
- Held for the orchestrator, as exact text: `_agent-docs/sprint-status.yaml` (1.3b to `ready-for-dev`), the sprint file's 1.3b section (scope line, ticket link and the corrected no-write sentence), and FR4's marker in `docs/requirements.md`. `docs/architecture.md` and `docs/glossary.md` text follows from dev-ticket's Support task.

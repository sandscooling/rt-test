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

- [ ] AC1: A `runWorkspace` or a `discoverTests` of a consumer leaves every file and directory under the consumer root, `node_modules` included, as it found it, on Vitest 4.1.x and 5.x: nothing added, changed or removed. This holds whatever the workspace's config sets for coverage, snapshot updates, Vitest's results cache and Vitest's module cache, and for a config file Vite loads as ESM as well as one it loads as CommonJS. Writes made by the consumer's own code are outside this criterion: its test bodies, hooks, setup files, `globalSetup`, plugins and config code. The four documented exceptions in Dev Notes § Known limits, all under `node_modules`, are outside it too.
- [ ] AC2: A run checks each snapshot assertion only against the snapshot already stored. A `toMatchSnapshot` or `toMatchInlineSnapshot` with no stored snapshot records its test failed, and so does a mismatch. No snapshot file or test file is written, updated or removed, whatever the workspace's config or the `UPDATE_SNAPSHOT` environment variable asks for.
- [ ] AC3: `discoverTests` takes an abort signal. A discovery whose signal aborted before its turn in the shared session queue loads no workspace. One aborted while it runs loads no further workspace and interrupts the workspace in progress. Either way it settles by rejecting with the signal's reason, and only after the Vitest instance it opened has closed and the host's environment and exit code are restored, so there is no discovery result to store. A discovery whose signal never aborts returns the same result it returns today.
- [ ] AC4: When a run or a discovery has not ended once the grace period, `FORCE_STOP_GRACE_MS` (10 s), has passed since its signal aborted, Vitest is force-stopped and the job ends. A run with a test stuck in a synchronous loop ends as an interrupted run: every test it had not finished is recorded interrupted, and no Vitest worker process remains. A discovery stuck in a test module that loops at load settles as AC3 says. This holds on Vitest 4.1 and 5, on the `forks` and `threads` pools. A run or a discovery that ends within the grace period is never force-stopped, so the consumer's `afterAll` hooks and teardown run as they do today. A synchronous loop on the Vitest host's own thread (config load, `globalSetup`) is out of this criterion's reach; ticket 1.3's executor bound ends it.
- [ ] AC5: Every run that loaded its workspace (`status: "ran"`) records whether Vitest was force-stopped, in a field of its own beside its execution state. A force-stopped run says it was. A run that completed, or was interrupted and ended within the grace period, says it was not.
- [ ] AC6: The store keeps the force-stop fact. A run written reads back with it unchanged. A store written at ticket 1.2's schema version opens, reads back each of its runs as not force-stopped, and is from then on at the new version. A store of a newer schema version, another SQLite database, or a file that is not a database is still refused and left unchanged.
- [ ] AC7: Every run and discovery stored after this change carries a Vitest adapter version different from the one stored before it, since a missing snapshot now fails its test (AC2).

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

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing.
- [ ] (AC4) Create `packages/daemon/src/vitest/force-stop.ts` holding `FORCE_STOP_GRACE_MS = 10_000` alone, exported, so ticket 1.3's executor bound imports it (C8) and a test can mock the module down (C97).
- [ ] (AC1, AC2) In `workspace-session.ts`'s `createVitest` options, force coverage off (`coverage: { enabled: false }`), snapshot update `"none"`, the results cache off (`cache: false`) and the module cache off, spelled for the loaded version: top-level `fsModuleCache: false` on 5.x, `experimental: { fsModuleCache: false }` on 4.1.x, since 5.x logs a deprecation for the `experimental` spelling (§ Vitest facts). Name each override (C3).
- [ ] (AC1) Create `packages/daemon/src/vitest/config-loader.ts` to choose the config loader: `"runner"` for a config file Vite treats as ESM, Vite's default `"bundle"` for one it treats as CommonJS (§ Config loading). Pass the config file RT Test chose as `config`, so the loader choice and the file Vitest loads are one decision. Export `CONFIG_EXTENSIONS`, `VITEST_CONFIG_FILES` and `VITE_CONFIG_FILES` from `find-workspaces.ts` for it rather than restating them (C8).
- [ ] (AC3) Give `discoverTests` a required `signal: AbortSignal`, as `runWorkspace` has. Skip the whole discovery when the signal aborted before its queue turn; stop before each next workspace once it aborts; interrupt the `collectTests` in progress through the interruption the run uses (`RunInterruption`, exported or moved where both callers reach it), withholding its first cancel until `collectTests` has reset its cancel state (U3); and reject with `signal.reason` after `inWorkspaceSession` has closed the instance and restored the host.
- [ ] (AC4) Force-stop both job kinds from one place (C8): once the grace period since the abort has passed and the job has not ended, issue the second `cancelCurrentRun`. When the first cancel was withheld until Vitest queued a module (`RunInterruption.onTestModuleQueued`), issue the second as soon as the grace has passed. Clear the timer when the job ends. Rewrite `RunInterruption`'s docblock, which says at most one cancel is issued (C46).
- [ ] (AC5) Add the force-stop field to `WorkspaceRun`'s `ran` variant, set from whether the second cancel was issued before the job ended, the same event that clears the force-stop timer.
- [ ] (AC6) Raise `STORE_SCHEMA_VERSION` to 2 and add the force-stop column to `runs`, NULL for every status but `ran`. Make `openStore` migrate a version-1 store under the write lock, re-reading the header there as `createSchema` does, and setting the column to not force-stopped on each `ran` row and the header's schema version to 2, in the same transaction. Write the column in `write-run.ts`, and read it back, refusing an unreadable value, in `read-runs.ts`. Keep the refusal of every other version.
- [ ] (AC7) Raise `VITEST_ADAPTER_VERSION` to 2.
- [ ] (Support) Send the orchestrator the `docs/architecture.md` § Current implementation sentences for the overrides, the loader, the discovery signal, the force-stop and the four exceptions (Dev Notes § Known limits), the glossary text for a force-stopped run, and the FR4 marker (§ Requirements).
- [ ] (Support) Lint and typecheck.

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
- FR4: "Start and stop the daemon explicitly for one trusted project, and execute no project code before that start." (AC3, AC4: a stop can end every job)

Clauses the criteria rest on:

- The sprint file's 1.3b section: "daemon runs and discovery write nothing into the consumer's tree, with coverage off, snapshot update set to none and Vitest's results cache off whatever the consumer's config says. A named-defect test proves this on Vitest 4.1 and 5 over a consumer fixture, `node_modules` included. Discovery can be interrupted, and 10 s after an interrupt (a named constant) Vitest is force-stopped, which the run records and the store keeps." (AC1 to AC6)
- The same section: "The force-stop skips the consumer's `afterAll` and teardown, so the run records that it happened." (AC4, AC5)
- AGENTS.md § Product guarantees: "Never inject defects into a consumer's working tree." and "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states." (AC1, AC5)
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

The no-write guarantee's exactly four exceptions (owner, 16:00 and 16:05). All lie under `node_modules`, and each comes from the project's own setup or an old Vite. They are outside AC1, and each is named in `docs/architecture.md`:

1. Vitest 4.1 on Vite 6.0.x, which has no `configLoader` option, leaves an empty `node_modules/.vite-temp/`. Vitest 5 requires Vite `^6.4.0`.
2. A consumer that turns on Vite's dependency optimizer (off by default) gets its cache written under `node_modules/.vite/vitest`. `deps` is in neither version's per-project override list, and it is not forced off.
3. A workspace whose project config files differ in format from its root config. An ESM project config under a CommonJS root is loaded by the bundle loader and leaves `node_modules/.vite-temp/`. A CommonJS project config under an ESM root fails to load under the runner, which is recorded as a failed workspace. That half is not a write: the bundle loader loads such a workspace today, so it is a load regression. The owner's ruling names it in these words ("or the runner failing a CJS project config, which surfaces as a failed workspace", 16:00 and 16:05), so it is accepted as part of this exception.
4. A Vitest 4.1 project config that itself sets `experimental.fsModuleCache` gets the module cache written (§ Vitest facts).

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

- `_agent-docs/tickets/1-3b-run-safety.md` (created)
- Held for the orchestrator, as exact text: `_agent-docs/sprint-status.yaml` (1.3b to `ready-for-dev`), the sprint file's 1.3b section (scope line, ticket link and the corrected no-write sentence), and FR4's marker in `docs/requirements.md`. `docs/architecture.md` and `docs/glossary.md` text follows from dev-ticket's Support task.

# Ticket 2.3b: Discovery reports selection facts

## Ticket

As a coding agent querying RT Test instead of running tests,
I want each discovery to report, and the store to keep across a restart, the setup files, global setup files, config aliases and test file patterns Vitest resolved for each workspace,
so that selection and the protection of selection inputs build from what Vitest actually loads, and a discovery that never reported them is known not to have.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: For each workspace a discovery reports as discovered, the discovery reports, per Vitest project that is not in browser mode (discovery already names each browser-mode project as unsupported), the setup files and the global setup files that Vitest 4.1 and 5 resolved, as `/`-separated paths that name a file exactly as the discovery's test module paths do, a linked consumer root included: root-relative for a file inside the consumer root, and `..`-climbing (or, on Windows, on another drive) for one outside it. RT Test's own snapshot guard is never among them. The root project's global setup files (the root config's `globalSetup`) are reported for every reported project of the workspace, since both versions run them on every run whichever projects run; so a Vitest 5 project that extends the root config, whose own resolved config drops them, still reports them. A project with none reports empty lists.
- [x] AC2: The same report gives, per project, each config alias of the project's resolved config, in that config's order: its replacement as the resolved config holds it; its `find` as written when a string, or as its source text and flags when a RegExp (a string `find` carries empty flags), marked with which of the two it was; and whether it has a `customResolver`. The report the daemon receives from the executor equals the one the executor built, so the channel neither drops nor reshapes an alias (a RegExp arriving as `{}`, a `customResolver` function vanishing).
- [x] AC3: The same report gives, per project, the test file patterns that Vitest resolved: `include`, `exclude` and `includeSource`, and the directory they are matched from (the project's `dir`, else its root), as a root-relative `/`-separated path, the consumer root itself being `.` as it is for a workspace's path.
- [x] AC4: The store keeps each discovered workspace's report (AC1 to AC3) with its discovery, so the latest discovery read back, after a daemon restart included, reports exactly what was written. A store at schema version 1 or 2 opens and is migrated in place to version 3, only once when two openers race, and keeps every run and discovery it held: a version 1 store's `ran` runs read as not force-stopped, as today, and each discovered workspace of a discovery stored before the migration reads as not reporting these facts, a state distinct from reporting empty lists. A store at any other schema version, or a file that is not an RT Test store, is still refused and left unchanged.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None open. Every third-party behavior this ticket relies on was read in installed or published source; Dev Notes § Settled facts gives each with its location.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (AC1, AC2, AC3) Create `packages/daemon/src/vitest/selection-facts.ts`: from a loaded workspace session, report each project in `instance.projects` that is not in browser mode (the test `openSession`'s `usesBrowserMode` applies; reuse it), with its name, setup files, global setup files, aliases and test file patterns. Setup files come from `project.config.setupFiles` less the snapshot guard file (`SNAPSHOT_GUARD_FILE` in `workspace-session.ts`, which `guardSnapshots` puts first); global setup files are `project.config.globalSetup` followed by those of `instance.getRootProject().config.globalSetup` it lacks; aliases come from `project.vite.config.resolve.alias`; the patterns from `project.config.include`, `exclude` and `includeSource`, matched from `project.config.dir || project.config.root`, as `globTestFiles` reads it, with the consumer root reported as `.`. Convert each absolute path as `moduleLocator` and `testModuleFile` convert a module id, so both name one file alike, and a path whose real path cannot be read still converts against the workspace directory Vitest resolved it from. Turn a RegExp `find` into its `source` and a string kind marker, and a `customResolver` into a boolean, before the report leaves the executor. Keep every value the report carries JSON-safe (C38: the executor's IPC channel serializes JSON).
- [x] (AC1, AC2, AC3) In `packages/daemon/src/vitest/discover-tests.ts`, give the `discovered` arm of `WorkspaceDiscovery` a required member carrying either the report or an explicit not-reported state, and have `collectWorkspace` fill it with the report. Keep the snapshot guard out, whether the report is read before `guardSnapshots` runs or filtered after; export the guard constant or move it only as C4 places it. Confirm that no production reader of `WorkspaceDiscovery` emits the new member into a query answer, a `--json` payload or a log (C38): at drafting, `query/summary.ts`, `query/test-states.ts` and `inputs/non-inputs.ts` read the discovered arm's fields by name, and none spreads it whole (create-ticket, `rg`, 23:13).
- [x] (AC4) In `packages/daemon/src/store/schema.ts`, raise `STORE_SCHEMA_VERSION` to 3 and add one nullable JSON column for the report, last in `discovery_workspaces`, in `STORE_SCHEMA` and in the migration alike, so a new store and a migrated one hold the same columns in the same order. Give the opener a migration from version 1 (today's force-stop step, then the new column) and from version 2 (the new column), each ending at version 3. Rewrite the doc comments on the version constants and the migration to the new truth (C46, C55).
- [x] (AC4) In `packages/daemon/src/store/open-store.ts`, migrate a store at version 1 or 2 under the write lock `inWriteTransaction` takes, in one transaction, re-reading the header there as `migrateSchema` does today, and keep refusing version 0, any version above 3, and a foreign application id with the file unchanged.
- [x] (AC4) In `packages/daemon/src/store/write-discovery.ts`, write the report as JSON for a discovered workspace that reports it, and NULL for one that does not and for every other status. In `packages/daemon/src/store/read-discovery.ts`, read NULL on a discovered workspace as not reported and parse anything else strictly, refusing a malformed value as `unreadable` and a report on a workspace that is not discovered as the reader refuses tests under one today, so the reader and writer agree on every edge case (C9, C12). Put the JSON parsers beside their reader, or in `store/columns.ts` where they reuse its private `jsonText` and `isRecord` (C4, C5).
- [x] (Support) Report the exact `docs/architecture.md` text to the orchestrator (orchestrator-owned; C48, C55): the discovery paragraph gains what AC1 to AC3 report, and the store sentence "the store migrates a store of the previous schema version in place, reading each of its runs as not force-stopped, since that version's code never force-stopped a run" becomes one naming both earlier versions and a discovery from before version 3 reading as not reporting the facts. Dev Notes § Architecture text holds a draft.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `moduleLocator` (`packages/daemon/src/vitest/module-tests.ts`) and `testModuleFile` (`packages/daemon/src/inputs/non-inputs.ts`): the conversion AC1 and AC3 require, a path relative to the workspace's real directory joined onto the workspace path. `relativePosixPath` (`vitest/find-workspaces.ts`) does the separator step. For the real path, `find-workspaces.ts` exports `realPath` (an `{ ok, path }` result), and `module-tests.ts` holds a private one that falls back to the path as given; reuse one of them rather than writing a third.
- `SNAPSHOT_GUARD_FILE` and `guardSnapshots` (`vitest/workspace-session.ts`): the one file AC1 leaves out.
- `WorkspaceSession.instance` (`workspace-session.ts`): the loaded `Vitest`, whose `projects` and `getRootProject()` both versions type publicly.
- `json`, `arrayOf`, `stringArray`, `unreadable` and the private `jsonText` and `isRecord` (`store/columns.ts`): the strict JSON readers every stored report uses.
- `FORCE_STOPPED_COLUMN`'s pattern (`store/schema.ts`): one column definition shared by `STORE_SCHEMA` and the migration.
- `createSchema` and `migrateSchema`'s re-read of the header under the write lock (`store/open-store.ts`): keeps a racing opener from migrating twice.

### Must Create

- `packages/daemon/src/vitest/selection-facts.ts` and the report's types (per project: name, setup files, global setup files, aliases, test file patterns), exported only as far as `discover-tests.ts` and the store read them (C59).
- The report column, its version 2 migration step, and the reader's not-reported state.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The owner split the original ticket 2.3 at 18:47 on 2026-09-27, and the orchestrator split its first part again at 19:01, into 2.3 to 2.3f (sprint file, after § Ticket 2.3f). This ticket only adds stored facts: no production code reads them until 2.3c (protection) and 2.3e (selection's input). It builds after 2.3, which is done.

Requirements this ticket serves (`docs/requirements.md`):

- FR7: "Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts." AC1 to AC3 produce the setup files and aliases 2.2's selection takes as required inputs, and the patterns 2.3c protects.
- FR3: "Persist results bound to project, worktree, run identity, input fingerprint, and adapter version, and keep them available across a daemon restart." (AC4)

Clauses the criteria rest on:

- Sprint 2 § Ticket 2.3b: "discovery reports each workspace's resolved setup files and config aliases, which ticket 2.2's selection takes as required inputs (orchestrator, 2026-09-26 18:07 and 18:22), and each workspace's test include patterns, and the store keeps them with the discovery across a restart: store schema version 3 migrates versions 1 and 2, and a discovery stored before the migration reads as not reporting them (orchestrator, 2026-09-27 18:46). Discovery converts Vitest's absolute setup and global setup paths to root-relative ones, [...] and passes a RegExp alias `find` as its source text and whether an alias has a `customResolver`, since the executor's channel carries the report as JSON." (AC1 to AC4)
- `SelectableWorkspace` (`selection/selection-types.ts`), 2.2's selection input: `setupFiles` and `globalSetupFiles` are each "Root-relative and `/`-separated", and `aliases` are `ResolvedAlias` values, "A config alias as Vite's resolved config holds it: the replacement is an absolute path or a bare package name." (AC1, AC2)
- Ticket 2.2 R2 (orchestrator, 18:07): "this ticket takes each Vitest workspace's resolved setup files and resolved config aliases as required inputs. Making discovery report them is routed to ticket 2.3". (AC1, AC2)
- Checklist C12 and C149 (rendered by `expand-rules.mjs`) bind AC4's not-reported state and its migration.

#### Orchestrator rulings

Every question went to the orchestrator by `session_wake` (crew.md § Questions), asked 23:05, answered 23:05, decider the orchestrator.

- Q1, the root config's global setup. The sprint's 18:46 wording credited it "to each Vitest 5 project that extends the root config". Discovery cannot tell which project extends the root: in 5.0.1 `extendsTrueRootConfig` is only a config-time option (`dist/chunks/index.DzobfTyw.js` lines 12814, 12843, read at 9475) and is never stored on the `TestProject`. Both versions run the root project's global setup on every run whichever projects run (`initializeGlobalSetup` adds `getRootProject()`: 4.1.11 `dist/chunks/cli-api.CnMVyzaz.js` lines 13808 to 13813, 5.0.1 `index.DzobfTyw.js` lines 21208 to 21213). Ruling: "Credit the root project's config.globalSetup to every project of the workspace. Vitest runs it on every run, whichever projects run, so this is the true rule, and it only widens." The sprint line is corrected to match. (AC1)
- Q2: the Vitest adapter version does not rise. "No stored run's meaning changes, a discovery from before the migration reads as not reporting the facts, and each start discovers afresh." (AC4)
- Q3: the report carries `include`, `exclude` and `includeSource` only, not `typecheck.include` or `typecheck.exclude`. "RT Test never runs a typecheck module, and the product plan leaves typecheck with agents, so their patterns protect no result." (AC3)
- Q4: proceed as one ticket (§ Sizing).
- G1 (grill, asked 23:09, answered 23:10): browser-mode projects are left out of the report. "Protection exists to keep RT Test's own results honest, and a browser-mode project holds none: it is never discovered or run, and unsupportedProjects already names it." The omission is no gap: a setup file a browser-mode project shares with a node project is still reported through the node project, so nothing RT Test runs loses protection. (AC1 to AC3)
- Ticket review (create-ticket 6c, 23:13): 9 findings, 8 applied (AC1's path wording, AC3's root directory as `.`, the C38 reader audit, the sibling rerun, P13's alias-separator deviation argued, the `resolve.alias` own-server fact, the Vite version scope, a count beside its list). F7 (empty execution metadata) was rejected: the block was filled while the review ran, with 5 code units.
- RegExp flags (dev's question, orchestrator ruling 23:50, holding the owner's calls): "yes, store the RegExp alias's flags now. A matcher rebuilt without `i` narrows selection, and narrowing is the one direction selection must never take. Adding the field later means a reader change on stored JSON. Use `flags: string` ("" for a string find), with the strict parser line." (AC2)
- Accepted as reported: the report is per project, since each project's patterns match from its own directory; a RegExp `find` carries a kind marker beside its source text; Vite's two built-in client aliases are reported as Vite holds them.

#### Settled facts

Read in installed source (P10) on 2026-09-27 between 22:59 and 23:05; each would flip a criterion if false.

- **Setup and global setup paths are absolute.** `resolved.setupFiles` and `resolved.globalSetup` map through `resolvePath(file, resolved.root)`: 4.1.11 `dist/chunks/coverage.DM_a_rWm.js` lines 340 and 341, 5.0.1 `index.DzobfTyw.js` lines 14463 and 14464. The session passes `root: workspace.directory` to `createVitest` (`workspace-session.ts` `inWorkspaceSession`).
- **Vitest 5 strips the root's global setup from a project extending it.** `NON_INHERITED_ROOT_OPTIONS = [...NON_INHERITED_OPTIONS, "globalSetup"]` (5.0.1 `index.DzobfTyw.js` line 9440), applied when `project.extendsTrueRootConfig` (line 9475). The root project runs it instead (Q1's sources).
- **Where a project's patterns match from.** `globTestFiles` reads `const dir = this.config.dir || this.config.root; const { include, exclude, includeSource } = this.config;` (4.1.11 `cli-api.CnMVyzaz.js` lines 10831 to 10834; 5.0.1 `index.DzobfTyw.js` lines 12131 to 12134). With typecheck enabled it also globs `typecheck.include` and `typecheck.exclude` (5.0.1 line 12144), which Q3 leaves out.
- **Where a project's aliases are.** Both versions move `test.alias` into Vite's `resolve.alias` (4.1.11 `cli-api.CnMVyzaz.js` lines 10402 and 14171; 5.0.1 `index.DzobfTyw.js` lines 7914 to 7923). Vite 8.3.1 normalizes it to an array of `{ find, replacement, customResolver? }` with its two client aliases after the config's own, since `mergeAlias(a, b)` returns `[...normalizeAlias(b), ...normalizeAlias(a)]` (`dist/node/chunks/node.js` `mergeAlias`, lines 2906 to 2914; `normalizeAlias` and `normalizeSingleAlias`, lines 2915 to 2931; `clientAlias`, lines 37153 to 37159, `find` RegExps `/^\/?@vite\/env/` and `/^\/?@vite\/client/`, each replaced by a `/@fs/` path; line 37177). Vite's typings declare `alias: Alias[]` on the resolved config (`dist/node/index.d.ts` line 3796). `TestProject.vite` is typed on both versions (4.1.11 `reporters.d.DtoKVV2s.d.ts` line 1292, a getter; 5.0.1 `plugin.d.CN87HSxv.d.ts` line 1034, a field). 4.1.11 gives each project its own Vite server (no `sharedViteServer` in `cli-api.CnMVyzaz.js`); 5.0.1 shares the declaring config's server only with a project whose options change nothing that affects Vite, and `alias` is among those options (`VITE_AFFECTING_TEST_OPTIONS`, lines 12670 to 12676; `getOwnServerReason`, lines 12685 to 12700), so a shared server holds the project's own aliases. A project setting Vite's own `resolve.alias` gets its own server too: `getOwnServerReason` returns "`${key}` changes the Vite config" for every option key but `test`, `extends`, `define` and an empty `plugins`.
- **Each Vite major these Vitest versions accept holds that array, read at 6.0.0, 7.0.0 and 8.3.1**; a minor between them is unread, and a fixture on the installed Vite pins the behavior (P10). Vitest 4.1.11 depends on `vite` `^6.0.0 || ^7.0.0 || ^8.0.0` and 5.0.1 on `^6.4.0 || ^7.0.0 || ^8.0.0` (their `package.json`). The published `vite@6.0.0` and `vite@7.0.0` tarballs (`npm pack`, 23:08, deleted after) define the same `normalizeAlias` and `normalizeSingleAlias`, keeping a `customResolver` when set, and `resolveResolveOptions` normalizes `mergeAlias(clientAlias, resolve?.alias ...)` (6.0.0 `dist/node/chunks/dep-C6qYk3zB.js` line 52875; 7.0.0 `dist/node/chunks/dep-Bsx9IwL8.js` line 35946); both typings declare `alias: Alias[]` (6.0.0 `dist/node/index.d.ts` line 3924, 7.0.0 line 3368).
- **The root project is public on both versions.** `getRootProject(): TestProject` (4.1.11 `reporters.d.DtoKVV2s.d.ts` line 1328; 5.0.1 `plugin.d.CN87HSxv.d.ts` line 2414). With no `projects` in the root config, the root project is also in `instance.projects` (5.0.1 lines 13234 and 13235), so the root's global setup files must not repeat in a project's list.
- **The snapshot guard.** `guardSnapshots` runs `project.config.setupFiles.unshift(SNAPSHOT_GUARD_FILE)` for each project in `instance.projects`, inside `openSession`, before any step (`workspace-session.ts`).
- **The channel is JSON.** `Executor.#startChild` forks with no `serialization` option (`daemon/executor.ts`), and `executor-main.ts` replies with `process.send(reply)`, so the reply crosses as JSON, which is why the report converts a RegExp and a function before it leaves.

#### Design notes

- **Per project, flattened later.** 2.2's `SelectableWorkspace` holds one flat list each per workspace; 2.3e builds it from this report's projects. The report keeps projects apart because AC3's patterns match from each project's own directory.
- **Not reported is a state, not empty lists** (C12). Only the store's read of a discovery from before version 3 produces it; a discovery run by this code always reports. 2.3c switches declared patterns off while the discovery in effect has a discovered workspace that does not report (sprint § Ticket 2.3c).
- **A file outside the consumer root** converts like a module path, to a `..` path (or, on Windows, a path on another drive). It is not an input either way (a named known limit). 2.2's `holdsRelativePath` (`selection/graph-state.ts`) never lets the root hold a path that climbs out, so such a path adds no edge and no widening when 2.3e passes it on; a path on another Windows drive is unanalyzed here.
- **An alias replacement keeps its separators** (a deviation from P13's "normalize separators to `/` before comparing or storing them", argued): a replacement is a string Vite substitutes into an import, possibly holding `$1` references or a bare package name, not a path this report compares; 2.2's `aliasResolution` normalizes separators itself when it compares one (`comparable` in `selection/vitest-edges.ts`), and `ResolvedAlias` is documented as "as Vite's resolved config holds it" (create-ticket, 23:13, on the ticket review's F4).
- **Vite's client aliases** reach no workspace: their `/@fs/` replacements lie under no workspace directory, so 2.2's `aliasPathTargets` adds no edge and no widening. Nothing filters them, so the report stays what Vite resolved.
- **Reading the report cannot fail on its own.** It reads resolved config fields only; a throw there fails the workspace as any other session step's error does (`inWorkspaceSession`'s catch), never a success-shaped empty report (C30). Keeping the tests and marking the report not reported instead was weighed and not taken, since the path is not realistically reachable (create-ticket, 23:09).
- **Schema.** The report goes in one nullable JSON column on `discovery_workspaces`, since the store keeps other array-valued facts (`failed_modules`, `typecheck_modules`) the same way (`schema.ts`: "JSON columns hold arrays and objects the record carries whole").

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3b` over nine target paths printed "unbuilt-work: clean. No unbuilt ticket names any of 9 path(s)." (23:02). Sprint 2's tickets not done, routed per Step 2:

- **2.3c** (backlog) reads AC1's setup files and AC3's patterns to protect them from declared patterns, and reads AC4's not-reported state to switch declared patterns off. It owns the `picomatch` dependency and every use of the patterns; this ticket adds no matcher.
- **2.3d** (backlog) owns selection's alias handling: widening on a `customResolver` or a `find` of `/`, and showing a RegExp `find` as its source text. `ResolvedAlias` in `selection-types.ts` stays as it is here; declare the report's alias type so 2.3d can derive `ResolvedAlias` from it (C14).
- **2.3e** (backlog) builds `SelectionInput` from the stored discovery, flattening each workspace's projects.
- **2.3f** (backlog) rediscovers, and so replaces a not-reported discovery within one daemon life. Until then, every daemon start discovers afresh.
- **2.4** to **2.7**: the rerun over every path this ticket edits (the production files, `docs/architecture.md`, the test files and `defects.json` of § Existing tests, and `test/fixtures/daemon`) printed "unbuilt-work: clean. No unbuilt ticket names any of 16 path(s)." (23:13).

#### Sizing

About 17 raw files and 22 estimated, over the 20-file limit; the orchestrator ruled to proceed (Q4). The files `lifecycle.test.ts`, `query.test.ts` and `input-tracker.test.ts` each take one mechanical edit: one discovered-workspace factory gains the new member. On the decision-bearing files alone that is 14 raw and about 18 estimated, with that 3-file sweep reported beside it. Code units: 5 (4 criteria plus validation). Over 10 estimated, so dev delegates to implementer agents along two groups that share only the report's type: the Vitest side (`selection-facts.ts`, `discover-tests.ts`, `workspace-session.ts`) and the store side (`schema.ts`, `open-store.ts`, `write-discovery.ts`, `read-discovery.ts`, `columns.ts`).

Production: the files of both groups above, and `docs/architecture.md` as reported text. Tests, for create-tests: the next section, plus new fixture files under `test/fixtures/daemon/` for a Vitest 4.1 and a Vitest 5 workspace with projects, setup files, a root `globalSetup` and aliases (about 2).

#### Current structure of the modified files

- `packages/daemon/src/vitest/discover-tests.ts`: `WorkspaceDiscovery` is a union on `status`: `discovered` (`workspace`, `vitestVersion`, `tests`, `failedModules`, `typecheckModules`, `unsupportedProjects`, `unhandledErrors`, optional `closeError`), `unsupported`, `failed` and `not-confirmed`. `discoverWorkspace` spreads the session's `CollectedWorkspace` value into the `discovered` arm; `collectWorkspace(session, interruption)` builds that value from `session.instance.collectTests(session.specifications)`.
- `packages/daemon/src/vitest/workspace-session.ts`: `WorkspaceSession` is `{ instance, locate, specifications, typecheckModules, unsupportedProjects }`; `openSession` calls `guardSnapshots(instance)` before resolving specifications; `SNAPSHOT_GUARD_FILE` is module-private.
- `packages/daemon/src/store/schema.ts`: `STORE_SCHEMA_VERSION = 2`, `MIGRATED_SCHEMA_VERSION = 1`, `STORE_SCHEMA` (tables `runs`, `run_modules`, `run_tests`, `discoveries`, `discovery_workspaces`, `discovered_tests`), `STORE_MIGRATION` (adds `force_stopped`, marks each `ran` run not force-stopped, sets `user_version`); `FORCE_STOPPED_COLUMN` is shared by both.
- `packages/daemon/src/store/open-store.ts`: `openStore` checks the header, creates a new schema or migrates one whose `isMigratable(header)` (`userVersion === MIGRATED_SCHEMA_VERSION`); `refusalReason` refuses a foreign id, a newer version, and any older one not migratable.
- `packages/daemon/src/store/write-discovery.ts`: `INSERT_WORKSPACE` names 13 columns; `workspaceColumns(entry)` maps each status to `WorkspaceColumns`, JSON-encoding the discovered arm's arrays.
- `packages/daemon/src/store/read-discovery.ts`: `SELECT_WORKSPACES` lists the columns; `workspaceDiscovery` refuses tests under a workspace that is not discovered; `discoveredWorkspace` parses each JSON column with `columns.ts` readers.
- `packages/daemon/src/store/columns.ts`: shared strict readers (`json`, `arrayOf`, `stringArray`, `moduleReport`, `failedModule`, `unsupportedProject`, `unreadable`), with `jsonText` and `isRecord` private.

#### Existing tests this change breaks

Found by `rg` over `packages/daemon/test` for `status: "discovered"`, `STORE_SCHEMA_VERSION`, `STORE_MIGRATION` and `user_version` (22:59), each match read.

- `packages/daemon/test/store.test.ts`: D1280 expects schema version 2 after migrating a version 1 store. `writeForceStopUnawareStore` rebuilds a version 1 store from a current one by dropping `force_stopped` alone, so it must also drop the report column. D1282 holds the write lock with `STORE_MIGRATION` whole, which may change shape. Its harness `whileWriteHeld` (rewritten by the flake lane, landed at 8c7ba58) releases the held write only when the store under test calls `DatabaseSync.prototype.exec("BEGIN IMMEDIATE")`, so D1264 and D1282 hold only while creation and every migration step run inside `inWriteTransaction` (`store/transaction.ts`), as `createSchema` and `migrateSchema` do today. The `DISCOVERY` constant lacks the new member. Version 2 stores need a builder of their own for AC4.
- `packages/daemon/test/discover-tests.test.ts`: new assertions for AC1 to AC3; its existing assertions compare `status` alone (`statusAndChanges`), so none breaks by value; unanalyzed beyond typecheck.
- `packages/daemon/test/lifecycle.test.ts`, `query.test.ts`, `input-tracker.test.ts`: one factory each builds a `discovered` workspace and lacks the required member (the sweep).
- `packages/daemon/test/defects.json`: records whose `old` lies on a changed line, among those anchored by `file` in `workspace-session.ts` (31), `open-store.ts` (12), `discover-tests.ts` (11), `write-discovery.ts` (7), `schema.ts` (4), `read-discovery.ts` (4) and `columns.ts` (1); among them D1283 on `isMigratable`'s `return header.userVersion === MIGRATED_SCHEMA_VERSION;`.

#### Architecture text

A draft for the orchestrator, final wording to follow the build.

- In the discovery paragraph, after "it never collects a typecheck module.": "For each workspace it discovers, it also reports, for each project not in browser mode, the project's setup files and global setup files as root-relative paths, leaving out RT Test's snapshot guard and crediting the root project's global setup to every such project, since Vitest runs it on every run; each alias of the project's resolved config, with a RegExp `find` as its source text and whether it has a `customResolver`; and the project's `include`, `exclude` and `includeSource` patterns with the directory they match from."
- In the store sentences: "the store migrates a store of the previous schema version in place, reading each of its runs as not force-stopped, since that version's code never force-stopped a run" becomes "the store keeps each discovered workspace's reported setup files, aliases and patterns with its discovery, and migrates a store of either earlier schema version in place: a version 1 store's runs read as not force-stopped, since that version's code never force-stopped a run, and each discovery stored before version 3 reads as not reporting them".

#### Previous ticket

2.3 (done, landed at b1cf25a) changed how the input tracker judges an event and when the lifecycle begins a job; it touched none of this ticket's files. Its Review Record's triage queued change requests (T1, T3 with T4, and the dev's F3 and F5), none of which is this ticket's. From its build: `lifecycle.ts` awaits `inputs.settled()` before each `beginJob`, and the discovery is written by `#startSequence` through `store.writeDiscovery`, whose signature this ticket keeps. From 1.3b (the store's first migration): a migration re-reads the header under the write lock, the migrated column sits last so new and migrated stores match, and a version older than the migrated one stays refused.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3b, § Ticket 2.3c, § Ticket 2.3d, § Ticket 2.3e.
- Ticket 2.2 (`_agent-docs/tickets/2-2-workspace-selection.md`) R2 and § Design notes "Aliases and setup files arrive resolved".
- Ticket 1.3b (`_agent-docs/tickets/1-3b-run-safety.md`): the version 1 to 2 migration and its tests.
- Ticket 2.3 (`_agent-docs/tickets/2-3-access-time-events.md`): previous-ticket intel.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (23:02).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C5,C9,C12,C14,C30,C38,C41,C46,C48,C55,C59,C122,C140,C149,C150 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P14,P16,P17,P18,P21,P35 -->

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
  - packages/daemon/src/vitest/discover-tests.ts
  - packages/daemon/src/vitest/workspace-session.ts
  - packages/daemon/src/store/schema.ts
  - packages/daemon/src/store/open-store.ts
  - packages/daemon/src/store/write-discovery.ts
  - packages/daemon/src/store/read-discovery.ts
  - packages/daemon/src/store/columns.ts
files_to_create:
  - packages/daemon/src/vitest/selection-facts.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId c394e70a-c4c8-47e7-8007-7f4c085e3f23

#### Test Files This Change Broke

`bun run --filter @rt-test/daemon typecheck` (23:50) exits 1 on exactly these five errors, every one in a test file; production compiles clean.

- `packages/daemon/test/store.test.ts`: line 23 imports `STORE_MIGRATION`, which is now `STORE_MIGRATIONS: ReadonlyMap<number, string>` keyed by source schema version (1: force-stop step, report column, version 3; 2: report column, version 3), and D1282 passes it to `whileWriteHeld` (use `STORE_MIGRATIONS.get(1)`). Line 252's `DISCOVERY` lacks the required `selectionFacts` member. D1280 expects version 2 (now 3). `writeForceStopUnawareStore` must also drop `discovery_workspaces.selection_facts`, and version 2 stores need a builder of their own (drop only `selection_facts`, set `user_version` 2). Migration still runs inside the one `inWriteTransaction`, so `whileWriteHeld`'s release on `BEGIN IMMEDIATE` holds.
- `packages/daemon/test/lifecycle.test.ts:112`, `packages/daemon/test/query.test.ts:135`, `packages/daemon/test/input-tracker.test.ts:200`: each discovered-workspace factory lacks `selectionFacts`.
- `packages/daemon/test/defects.json`: D1278's `old` (schema.ts, the force-stop `UPDATE` line followed by the version pragma) no longer matches, since the step is now the `ADD_FORCE_STOPPED` fragment; D1282's `old` (open-store.ts `if (!isMigratable(checkedHeader(database, file))) return;`) is now `STORE_MIGRATIONS.get(...)` returning undefined; D1283's `old` (`return header.userVersion === MIGRATED_SCHEMA_VERSION;`) is now `return STORE_MIGRATIONS.has(header.userVersion);`. The record at `defects.json` line 2659 (`testModuleFile`'s join) still matches once.

#### ACs Owed a Test

- AC1: setup and global setup files reported per non-browser project on Vitest 4.1 and 5, root-relative (`..` outside the root, the absolute path on another Windows drive), without the snapshot guard, the root's global setup credited to every project including a Vitest 5 project extending the root config, empty lists for a project with none. Evidence so far is a traced path only: `selectionFacts` (`vitest/selection-facts.ts`) reads `config.setupFiles` less `SNAPSHOT_GUARD_FILE` after `guardSnapshots`, merges own then root `globalSetup` and dedupes after conversion, and converts through `session.locate` and `testModuleFile`.
- AC2: aliases in resolved order with `find`, `findKind`, `flags`, `replacement` and `hasCustomResolver`, and the report arriving through the executor's JSON channel equal to the one built (a RegExp not arriving as `{}`, a `customResolver` not vanishing). Traced: `reportedAlias` emits strings and booleans only; `Executor.#startChild` forks with default JSON serialization and passes the reply through unparsed.
- AC3: `include`, `exclude`, `includeSource` and the directory (`dir`, else `root`), with the consumer root as `.`. Traced: `testModuleFile(".", "")` is `.`.
- AC4: round trip across a restart; version 1 and version 2 stores migrate once under racing openers and keep every run and discovery; a pre-migration discovered workspace reads `{ reported: false }`, distinct from `{ reported: true, projects: [] }`; version 0, above 3 and a foreign id stay refused and unchanged.

#### Tests Owed

- `testModuleFile` (`inputs/non-inputs.ts`) returned `pkg/D:/shared/setup.ts` for a file on another Windows drive under a nested workspace; it now returns the absolute path as given. Windows-only defect, found by the adversarial review (F1).
- `realPath` in `vitest/module-tests.ts`: a path not on disk (a pattern directory not yet created, say) resolved as given against the workspace's real directory, so under a linked workspace it converted across the link, and a case differing from disk was kept for the part that exists. It now resolves through its nearest ancestor on disk. A test on a linked or case-differing workspace with a missing `dir` catches it.
- A global setup file named twice through different spellings (a link and its real path) is reported once (review F3).
- `json()` (`store/columns.ts`) now refuses unparseable JSON text in any column as `unreadable`, with the parse error as its cause, instead of a bare `SyntaxError`.
- The strict report parser refuses a malformed report (a missing field, a `findKind` outside `string`/`regexp`, a non-boolean `hasCustomResolver`, a non-string `flags`) as unreadable, and `read-discovery.ts` refuses a non-NULL `selection_facts` under a workspace that is not discovered.

### Tests Record

Tests session: threadId 07e149e1-bd61-4efe-87cf-44ac421aa2f7

Code bug found and fixed (sent to dev 23:57, fixed 23:58): `projectFacts` spread `config.includeSource`, which Vitest leaves undefined when a config sets none (it reads `includeSource?.length`: 4.1.11 `cli-api.CnMVyzaz.js` line 10854, 5.0.1 `index.DzobfTyw.js` line 11891), so every workspace setting no `includeSource` failed discovery with "config.includeSource is not iterable". D2117 pins it.

Fixture: `test/fixtures/daemon/selection-facts`, a root workspace with a project extending the root config (own setup, global setup, three aliases, a `dir`, all three patterns), a bare project naming the root's global setup through a directory link the test creates, and a project whose `dir` is not on disk; `packages/solo`, one project with setup files inside its directory, elsewhere in the root and outside the root; `packages/browser`, a node and a browser-mode project, which only Vitest 4.1 loads without a provider.

#### Named Defects

- D1278: The migration adds the force-stop column but never marks the version-1 ran runs, so each reads back unreadable. (AC4, re-anchored on `ADD_FORCE_STOPPED`)
- D1280: The migration leaves the header at its old version; the test now expects version 3. (AC4, stale, updated)
- D1282: An opener picks its migration from the version-1 header it read before the write lock, so it migrates a store another opener already migrated. (AC4, re-anchored on `migrateSchema`'s re-read)
- D1283: The opener accepts an RT Test store of any schema version up to 2, so a version-0 store is opened rather than refused. (AC4, re-anchored on `isMigratable`)
- D2093: The discovery writer never stores a workspace's selection facts, so every discovered workspace reads back as not reporting them (read after a reopen). (AC4)
- D2094: The discovery writer stores a report of no projects as NULL, so it reads back as not reporting. (AC4)
- D2095: The discovery writer stores a workspace that never reported as an empty list, so it reads back as reporting no projects. (AC4)
- D2096: The migration gives the new column a default of an empty list, so a workspace stored before it reads as reporting no projects rather than as not reporting. (AC4)
- D2097: The version 2 migration never raises the header to version 3. (AC4)
- D2098: The version 1 migration never adds the selection facts column, so a version 1 store's discoveries cannot be read once migrated. (AC4)
- D2099: A JSON column holding text that does not parse escapes as a bare SyntaxError naming neither the store nor the column. (AC4)
- D2100: The alias reader takes any find kind as written. (AC4)
- D2101: The alias reader coerces the customResolver mark to a boolean. (AC4)
- D2102: The alias reader reads missing flags as none. (AC4)
- D2103: The project reader reads a missing global setup list as empty. (AC4)
- D2104: The discovery reader ignores selection facts under a workspace that is not discovered. (AC4)
- D2105: The report keeps RT Test's snapshot guard among a project's setup files, so a project with none reports RT Test's own file. (AC1, Vitest 5)
- D2106: A setup file is reported relative to its workspace's directory rather than the consumer root. (AC1, Vitest 4.1)
- D2107: Setup files are made relative to the workspace's directory as spelled rather than its real path, so under a linked consumer root every setup file, which Vitest resolves to its real path, climbs out through the link. (AC1, Vitest 5)
- D2108: The report lists only a project's own global setup, so a Vitest 5 project extending the root config loses the root's global setup. (AC1)
- D2109: The report never removes a repeated global setup file, so a workspace whose one project is the root project lists it twice. (AC1, Vitest 4.1)
- D2110: The report never removes a repeated global setup file, so a project whose own global setup names the root's file lists that file twice. (AC1, Vitest 5)
- D2111: The report includes browser-mode projects. (AC1 to AC3, Vitest 4.1)
- D2112: A RegExp alias loses its flags. (AC2, Vitest 5, the aliases in config order)
- D2113: An alias's customResolver is never marked. (AC2, Vitest 4.1, the aliases in config order)
- D2114: A RegExp find is carried as the RegExp itself, which a JSON round trip turns into an empty object. (AC2; the test proves the report survives JSON, the executor channel's format, not the channel itself)
- D2115: The pattern directory ignores a project's dir and reports its root. (AC3, Vitest 5)
- D2116: A path not on disk is converted as given, so under a linked consumer root a project dir not yet created climbs out through the link. (AC3, the dev's owed `realPath` test)
- D2117: The report spreads includeSource as though Vitest always set it, so a workspace that sets none fails discovery. (AC3, Vitest 4.1, the consumer root reported as `.`)
- D2118: A module path already absolute, as one on another Windows drive is, is joined under its workspace path. (AC1, review F1, proven on either host through a `node:path` mock whose `isAbsolute` is Windows')
- D2119: Global setup files are deduplicated before conversion, so a project naming the root's global setup file by an absolute path through a directory link lists that file twice. (AC1, Vitest 5; review gap 1, the review's F3 case)
- D2120: A module id is made relative as given rather than through its real path, so a setup file named by an absolute path through a directory link reports the link's path. (AC1, Vitest 4.1; review gap 2)
- D2121: The alias reader accepts flags on a string find, a record the writer never makes. (AC4; review gap 3, the review's `aliasFlags` fix)
- D2122: The version 2 migration marks each ran run not force-stopped, so a force-stopped run stored at version 2 reads back not force-stopped; every run and both discoveries read back. (AC4; review gap 4)
- D2123: A test module path that is already absolute, as one on another Windows drive is, is joined under the consumer root, so its digest reads absent and an edit to it never changes the fingerprint. (review gap 8, `absoluteInputPath`; `test-module-file.test.ts`, whose `node:path` mock is Windows' whole module, so either host runs it)
- D2124: The input filter counts a path on another Windows drive as under the consumer root, so a protected test module there enters the inventory. (review gap 9, `InputFilter.excludes`; same file and seam)
- Review round repairs: D2100 and D2102 re-anchored on `reportedAlias`'s new `findKind` and `aliasFlags` lines; D2114 retitled "a workspace's report survives a JSON round trip unchanged".

C65 ruling (orchestrator, 00:13, decider the orchestrator): D2107's first mutation (`realPath(moduleId)` to `moduleId`) and D2110's first mutation (dedupe before conversion) survived `test:defects:changed` (00:03 to 00:11, 1489/1491), diagnosed as unobservable over relative setup paths, which Vitest resolves through links itself. Ruled: re-anchor both (D2107 on `realPath(workspace.directory)`, D2110 on no deduplication) and prove them alone through the verifier's pool (00:13, both detected). The review (00:22) refuted the diagnosis's scope: Vitest keeps the link spelling of an absolute setup path, so both first mutations are observable after all, now proven as D2120 and D2119 over the fixture's `absolute` project.

#### Deliberately Untested

- `packages/daemon/src/daemon/executor.ts`, `executor-main.ts`: unchanged; they pass the discovery through the JSON channel untouched. D2114 proves the report survives a JSON round trip, the channel's format; no test drives the channel itself, since this change did not touch it.
- `packages/daemon/src/store/schema.ts` `SELECTION_FACTS_COLUMN` placed last: every reader selects columns by name, so column order yields no observable defect.
- `packages/daemon/src/inputs/input-filter.ts` `declares`, its `liesInside` guard (review gap 10): an unobservable mutation. Both callers ask `excludes` first, which already refuses a path outside the root: `input-inventory.ts` filters `!excluded(path) && walk.filter.declares(path) === undefined`, and the tracker's batch loop skips `filter.excludes(path)` before `#readPath` reaches `#readFile`'s `declares`. D2125 returned unused.
- A version 2 store's racing openers: the same header re-read under the write lock serves both versions, and D1282 proves it.
- `packages/daemon/src/vitest/workspace-session.ts`: only two exports added.
- `packages/daemon/src/vitest/discover-tests.ts`: `collectWorkspace` fills `selectionFacts`; every D2105 to D2117 reads it through a real discovery.

### Review Record

Review session: threadId 382933c6-c2a0-48fc-a46d-0575f85bab83

Ticket-mode review, 2026-09-28 00:15 to 00:24: three fresh-eyes batches (discovery, paths, store), one doc-verify agent, one installed-source agent, and the checklist pass against this ticket's rule set. AC1 to AC4 hold in the code.

#### Fixes

- `store/columns.ts` `reportedAlias`: a string `find` carrying non-empty `flags` is now refused as unreadable (new `aliasFlags`), as the reader already refuses every other record the writer never makes (C9). This was dev's change-request candidate; it lands here because AC4 asks the reader to parse strictly. `STRING_FIND_FLAGS` is now exported from `vitest/selection-facts.ts`, so writer and reader share one constant (C3).
- `vitest/selection-facts.ts`: the path comments said only "Root-relative". They now state the shape AC1 gives once: `/`-separated, relative to the consumer root, `..` for a file outside it, absolute on another Windows drive.
- `inputs/input-filter.ts` `absoluteInputPath` (orchestrator ruling 00:25: fix in this lane): it joined every path under the root, so a test module on another Windows drive, which `testModuleFile` names `D:/...`, became `C:\root\D:\...`. Measured on Windows at 00:18: `readFileSync` of that path fails `ENOENT`, which `fingerprint.ts` `moduleDigest` records as the constant `absent` digest, so edits to that module never moved the fingerprint and a stale result read as current. It now takes an absolute path as given. Its readers: `fingerprint.ts` `SnapshotReads.moduleDigest` and `testModuleChangedSince`, and `input-tracker.ts` `protectTestModules`.
- `inputs/input-filter.ts` `excludes` and `declares`, the same class: each treated a path as outside the root only when `relative()` climbed with `..`, but `relative()` across Windows drives returns an absolute path, so a path on another drive counted as inside. With `absoluteInputPath` fixed, `protectTestModules` queues that path, and `excludes` would have let it into the inventory, where no watch refreshes it and `unselectedModuleDigests` skips its fresh read. Both now use `liesInside`, which already checks `isAbsolute` as `liesInsideOnHost` does.
- Comments naming these paths "root-relative" now name them as `testModuleFile` does: `fingerprint.ts` `SnapshotReads`, `non-inputs.ts` `discoveredTestModules` and `workspaceTestModules`.

Class sweep (00:26), `rg` over `packages/daemon/src` for `absoluteInputPath`, joins and `resolve`s against a root, and `climbsOut(`: every other root join takes a fixed file name (`package.json`, `rt-test.json`, the state directory, pnpm's workspace file). Two more sites accept a `D:/...` path as inside the root and were left alone: `selection/graph-state.ts` `holdsRelativePath` lets the root workspace hold it, and its one live effect (`vitest-edges.ts` setup-file edges, read from 2.3e) adds an edge to the root workspace, which only widens, so a change there would narrow selection; `selection/specifier-edges.ts` `rootLabel` can pick it as a message label only. `select-tests.ts` `refusalReason` already refuses an absolute changed path. A read that fails otherwise never yields a constant digest: `input-inventory.ts` `failedRead` gives `absent` only for `ENOENT` and an explicit `unreadable` otherwise, `fingerprint.ts` `moduleDigest` returns `ok: false` for any error but `ENOENT`, and `modifiedAt` returns undefined, which `testModuleChangedSince` reads as possibly changed. `absent` for `ENOENT` is a real, known state once the path is right.

#### Installed-source corrections

Read in Vitest 4.1.11 and 5.0.1, Vite 8.3.1, 00:22:

- **Links are followed only for a relative or bare setup path.** `resolvePath` calls mlly's `resolveModule`, which returns an absolute path to an existing file without a realpath (5.0.1 `dist/chunks/nativeModuleRunner.J0QLzNtK.js` lines 2046 to 2050; 4.1.11 `dist/chunks/index.BCY_7LL2.js` lines 2014 to 2018). A relative path goes through `finalizeResolution`'s `realpathSync` (5.0.1 line 1137; 4.1.11 line 1109). pathe's `normalize` upper-cases only the drive letter. So § Deliberately Untested's reasons for the dedupe after conversion and for `realPath` on a module id are refuted: a project naming the root's global setup, or any setup file, by an absolute path through a link hands the report the link spelling, and only the conversion unifies it. The code is correct; the gaps below cover it.
- **`config.dir` is the raw configured string**, never resolved by either version, so it can be relative; `globFiles` resolves it against `process.cwd()` (4.1.11 `cli-api.CnMVyzaz.js` lines 10896 to 10903; 5.0.1 `index.DzobfTyw.js` lines 11873 to 11879). `inWorkspaceSession` chdirs to the workspace directory (`workspace-session.ts`), so `realPath` resolves a relative `dir` as Vitest does.
- **4.1 has no root global setup stripping.** A project with `extends: true` gets the root's entries concatenated into its own (Vite `mergeConfig`), so the dedupe is needed on 4.1 as well as for 5's root project in `instance.projects`.

#### Judgments on open items

- Dev's change-request candidate (flags on a string `find`): fixed here, above.
- The tests member's note that the dedupe after conversion (F3) is inert: refuted by the first correction above. Gap row 1 below.
- The 00:13 ruling (D2107 and D2110 re-anchored as C65 unobservable) is not yet in § Tests Record; the tests session records it, with the refutation above.

#### Technical Debt

Pre-existing, found by this review, for triage once the change is committed:

- **LOW** (`query/path-status.ts` `liesAtOrUnder`): a query on the consumer root `.` counts a `..`-climbing or absolute module path as lying under it.
- **LOW, duplication** (`vitest/module-tests.ts` `realPath`, `inputs/input-filter.ts` `canonicalPath`, `query/path-status.ts` `canonicalPath`): three "real path of the nearest existing ancestor" helpers that disagree on a relative input and on nothing resolving; `module-tests.ts`'s private name also shadows `find-workspaces.ts`'s exported `realPath`.
- **LOW** (`store/read-discovery.ts` `refuseDiscoveredDetails`): refuses tests and selection facts under a workspace that is not discovered, but accepts a non-NULL `failed_modules`, `typecheck_modules`, `unsupported_projects` or `unhandled_errors` there, and a discovered workspace with a non-NULL `error` or `unsupported_vitest`.
- **LOW** (`store/columns.ts` `stringArray`, `arrayOf`): an unreadable list inside a JSON record names no field ("JSON string array: undefined").
- **LOW** (`store/open-store.ts`): an older daemon holding the store open while a newer one migrates it keeps writing under the old schema; a version 1 process's later `ran` runs get `force_stopped` NULL and read as unreadable.

#### Test Coverage Gaps

Denominator: 26 named-defect tests (D2093 to D2118) and 4 re-anchored (D1278 to D1283) against the behaviors AC1 to AC4 name; four gaps and three repairs below.

| #   | Source                                       | Named defect                                                                                                                                                                                                  | Expected test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Severity         | Id    |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----- |
| 1   | `vitest/selection-facts.ts` `projectFacts`   | Global setup files are deduplicated before conversion, so a project naming the root's global setup file by an absolute path through a directory link lists that file twice.                                   | A project whose config names the root's global setup by an absolute path through the fixture's `setup-link` (absolute, so Vitest keeps the link spelling) reports it once. Mutation: the line becomes `...[...new Set([...ownGlobalSetup, ...rootGlobalSetup])].map(rootRelative),`, deduping the raw strings.                                                                                                                                                                                                                                                                                            | MEDIUM           | D2119 |
| 2   | `vitest/module-tests.ts` `moduleLocator`     | A module id is made relative as given rather than through its real path, so a setup file named by an absolute path through a directory link reports the link's path instead of the file's.                    | A setup file named by an absolute path through `setup-link` reports as `setup/<file>`. Mutation: `realPath(moduleId)` becomes `moduleId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | MEDIUM           | D2120 |
| 3   | `store/columns.ts` `aliasFlags`              | The alias reader accepts flags on a string find, a record the writer never makes.                                                                                                                             | A stored alias `{ findKind: "string", flags: "i" }` reads as unreadable. Mutation: drop the `findKind === STRING_FIND && flags !== STRING_FIND_FLAGS` throw.                                                                                                                                                                                                                                                                                                                                                                                                                                              | LOW              | D2121 |
| 4   | `store/schema.ts` `STORE_MIGRATIONS`         | The version 2 migration marks each `ran` run not force-stopped, so a force-stopped run stored at version 2 reads back not force-stopped.                                                                      | Build a version 2 store with a force-stopped `ran` run, another run and two discoveries (`writeSelectionFactsUnawareStore` takes `runs`, but no test passes any); after opening, every run reads back unchanged and both discoveries read. Mutation: the version 2 entry becomes `` `${ADD_SELECTION_FACTS}\nUPDATE runs SET force_stopped = ${NOT_FORCE_STOPPED} WHERE status = 'ran';${SET_SCHEMA_VERSION}` ``.                                                                                                                                                                                         | MEDIUM           | D2122 |
| 5   | `packages/daemon/test/defects.json` D2100    | Stale anchor after the `aliasFlags` fix: its `old` matches nothing.                                                                                                                                           | Re-anchor on `  const findKind = member(\n    ALIAS_FIND_KINDS,\n    jsonText(value, "findKind"),\n    "JSON field findKind",\n  );` with new `  const findKind = jsonText(value, "findKind") as AliasFindKind;`.                                                                                                                                                                                                                                                                                                                                                                                         | repair           | D2100 |
| 6   | `packages/daemon/test/defects.json` D2102    | Stale anchor after the `aliasFlags` fix: its `old` matches nothing.                                                                                                                                           | Re-anchor on `  const flags = jsonText(value, "flags");` with new `  const flags = String(jsonField(value, "flags") ?? "");`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | repair           | D2102 |
| 7   | `discover-tests.test.ts` D2114               | The title claims the report crosses the executor's JSON channel, but the test runs an in-process JSON round trip.                                                                                             | Retitle to what it proves, e.g. "a workspace's report survives a JSON round trip unchanged", and update § Deliberately Untested's executor entry to match.                                                                                                                                                                                                                                                                                                                                                                                                                                                | LOW              | D2114 |
| 8   | `inputs/input-filter.ts` `absoluteInputPath` | A test module path that is already absolute, as one on another Windows drive is, is joined under the consumer root, so its digest reads absent and an edit to it never changes the fingerprint.               | Through the `node:path` seam (C156) or an absolute temporary path on either host: `absoluteInputPath` (or `SnapshotReads.moduleDigest`) reads the named file itself, and an edit to it changes the digest. Mutation: delete `  if (isAbsolute(path)) return path;\n`.                                                                                                                                                                                                                                                                                                                                     | CRITICAL surface | D2123 |
| 9   | `inputs/input-filter.ts` `excludes`          | The input filter counts a path on another Windows drive as under the consumer root, so a protected test module there enters the inventory, which no watch refreshes, and the fingerprint stops re-reading it. | Through the `node:path` seam with `win32` semantics: `excludes` is true for `D:\shared\x.test.ts` under root `C:\root`. Mutation: `    if (!liesInside(this.#root, path)) return true;\n    const fromRoot = relative(this.#root, path);` becomes `    const fromRoot = relative(this.#root, path);\n    if (climbsOut(fromRoot, sep)) return true;`.                                                                                                                                                                                                                                                     | HIGH             | D2124 |
| 10  | `inputs/input-filter.ts` `declares`          | A path on another Windows drive is matched against the declared non-input patterns as though it lay under the consumer root.                                                                                  | Same seam: `declares` is undefined for a `D:` path a declared pattern would match by its segments. Judge observability first (C65): every current caller filters by `excludes` before `declares`, so this may be unobservable; if so, record it under § Deliberately Untested and return the id. Mutation: `    if (!liesInside(this.#root, path)) return undefined;\n    const fromRoot = relative(this.#root, path);\n    if (fromRoot === "") return undefined;` becomes `    const fromRoot = relative(this.#root, path);\n    if (fromRoot === "" \|\| climbsOut(fromRoot, sep)) return undefined;`. | LOW              | D2125 |

### Completion Notes

- Built in two implementer partitions (vitest side; store side) after a wave 0 that put the report's types in `vitest/selection-facts.ts` and the `selectionFacts: SelectionFacts` member on the discovered arm. The report is `{ reported: true, projects }` or `{ reported: false }`; each project is `{ projectName, setupFiles, globalSetupFiles, aliases, testFilePatterns }`, each alias `{ find, findKind, flags, replacement, hasCustomResolver }`, the patterns `{ directory, include, exclude, includeSource }`. The store column is `discovery_workspaces.selection_facts`, holding the projects array as JSON, NULL for not reported.
- Sanity check (Step 4): no findings. The task's C38 reader list was a drafting-time sample; `rg` also finds `inputs/fingerprint.ts`, `inputs/input-tracker.ts`, `daemon/lifecycle.ts`, the executor files and `index.ts`, and none emits the discovered arm whole (fingerprint reads module paths and `workspace.directory`; lifecycle logs path and status). The only whole send is the executor's JSON channel, the intended one.
- Unverified assumptions: none open. Re-checked by the vitest partition in installed source: Vitest 4.1.11 `reporters.d.DtoKVV2s.d.ts` (`ResolvedConfig`, `setupFiles`, `vite` getter, `getRootProject`), 5.0.1 `plugin.d.CN87HSxv.d.ts` (the same), runtime absolute paths at 4.1.11 `coverage.DM_a_rWm.js` and 5.0.1 `index.DzobfTyw.js` `resolvePath` mapping, Vite 8.3.1 `dist/node/index.d.ts` `interface Alias` and `resolve.alias: Alias[]`. `ResolvedConfig.globalSetup` is typed `string | string[]` though resolved to an array; `asList` handles both.
- Question and ruling: RegExp alias flags (asked by dev 23:49, answered 23:50, decider: the orchestrator holding the owner's calls): store them as `flags: string`, empty for a string `find`. The author amended AC2 and § Orchestrator rulings in this file at 23:50.
- Adversarial review (23:49): F1 HIGH fixed (`testModuleFile` returns a module path that is already absolute unchanged, so a file on another Windows drive converts to its absolute path under any workspace, test modules included); F2 MEDIUM became the flags ruling and was built; F3 LOW fixed (global setup files deduped after conversion); F4 discarded, since `{ reported: false }` round-trips as NULL, which is the writer and reader agreement C9 asks for, and the live and stored discovery share one type by design. Post-fix re-validation: daemon typecheck (production clean, the five test-file errors above), `rt-test` typecheck exit 0, `bun x oxlint` over every changed file exit 0, `prettier --check` exit 0, `check-line-citations` clean.
- 2.3c build-start check (orchestrator, 23:56): a readable pattern directory already converted through `realpathSync.native`, so on Windows it arrives in on-disk case. A path whose real path cannot be read fell back to the path as given and was made relative to the workspace's real directory, so under a linked workspace a directory not yet on disk converted across the link. `realPath` in `vitest/module-tests.ts` now resolves such a path through its nearest ancestor on disk and appends the rest, keeping links and on-disk case for every part that exists (probe on Windows, 23:56: `C:/SOURCE/RT-TEST/PACKAGES/DAEMON/NotThere/x.ts` against `packages` gave `daemon\NotThere\x.ts`). Module ids, setup files and the pattern directory all convert through it. Daemon typecheck: production clean; `bun x oxlint` exit 0.
- Code bug from rt-t2-3b-tests (23:57): `projectFacts` spread `config.includeSource`, which Vitest leaves unset for a test config with none (`configDefaults` gives only `benchmark.includeSource` a default; 4.1.11 `cli-api.CnMVyzaz.js` line 10854 and 5.0.1 `index.DzobfTyw.js` line 11891 read it as `includeSource?.length`), so discovery of nearly every workspace failed with "config.includeSource is not iterable". Fixed: an unset `includeSource` reports `[]`, which is what Vitest reads it as. `include` and `exclude` always carry `configDefaults` (4.1.11 `defaults.9aQKnqFk.js` lines 56 and 57, 5.0.1 `defaults.D2ip7f-X.js` lines 62 and 63), and `dir` is read with `||` as `globTestFiles` reads it. Daemon typecheck production clean, `bun x oxlint` and `prettier --check` exit 0 (23:58).
- Pre-existing fix beside the change: `json()` in `store/columns.ts` now reports unparseable JSON as `unreadable` with its cause.
- Placement: `testModuleFile` is imported from `inputs/non-inputs.ts` into the vitest side rather than moved; it pulls only `node:fs`/`node:path` modules and forms no runtime cycle. `SNAPSHOT_GUARD_FILE` and `usesBrowserMode` are now exported from `workspace-session.ts`.
- README: no change. Nothing user-visible changes; the report is stored and read by no production code until 2.3c and 2.3e.
- `docs/architecture.md` text sent to the orchestrator in the dev report (orchestrator-owned).
- Change-request candidates, for `review-changes`:
  - The report parser accepts non-empty `flags` on a string `find`, a record the writer never makes. A one-line check in `store/columns.ts` `reportedAlias` would refuse it; left because it tightens only a hand-edited store.
- Tests were not run (dev runs no tests).

### File List

- `packages/daemon/src/vitest/selection-facts.ts` (created)
- `packages/daemon/src/vitest/discover-tests.ts`
- `packages/daemon/src/vitest/workspace-session.ts`
- `packages/daemon/src/store/schema.ts`
- `packages/daemon/src/store/open-store.ts`
- `packages/daemon/src/store/write-discovery.ts`
- `packages/daemon/src/store/read-discovery.ts`
- `packages/daemon/src/store/columns.ts`
- `packages/daemon/src/inputs/non-inputs.ts` (review F1 fix)
- `packages/daemon/src/vitest/module-tests.ts` (2.3c build-start check, 23:56)
- `_agent-docs/tickets/2-3b-selection-facts.md` (create-ticket)
- `_agent-docs/sprints/sprint-2-fresh-runs.md` (create-ticket, under the 23:05 grant: § Ticket 2.3b's global setup mechanism corrected per Q1, G1's browser-mode ruling added, and the ticket link)
- `_agent-docs/sprint-status.yaml` (create-ticket, under the 23:05 grant: `2-3b-selection-facts` to `ready-for-dev`)

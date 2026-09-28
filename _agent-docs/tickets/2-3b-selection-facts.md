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

- [ ] AC1: For each workspace a discovery reports as discovered, the discovery reports, per Vitest project that is not in browser mode (discovery already names each browser-mode project as unsupported), the setup files and the global setup files that Vitest 4.1 and 5 resolved, as `/`-separated paths that name a file exactly as the discovery's test module paths do, a linked consumer root included: root-relative for a file inside the consumer root, and `..`-climbing (or, on Windows, on another drive) for one outside it. RT Test's own snapshot guard is never among them. The root project's global setup files (the root config's `globalSetup`) are reported for every reported project of the workspace, since both versions run them on every run whichever projects run; so a Vitest 5 project that extends the root config, whose own resolved config drops them, still reports them. A project with none reports empty lists.
- [ ] AC2: The same report gives, per project, each config alias of the project's resolved config, in that config's order: its replacement as the resolved config holds it; its `find` as written when a string, or as its source text when a RegExp, marked with which of the two it was; and whether it has a `customResolver`. The report the daemon receives from the executor equals the one the executor built, so the channel neither drops nor reshapes an alias (a RegExp arriving as `{}`, a `customResolver` function vanishing).
- [ ] AC3: The same report gives, per project, the test file patterns that Vitest resolved: `include`, `exclude` and `includeSource`, and the directory they are matched from (the project's `dir`, else its root), as a root-relative `/`-separated path, the consumer root itself being `.` as it is for a workspace's path.
- [ ] AC4: The store keeps each discovered workspace's report (AC1 to AC3) with its discovery, so the latest discovery read back, after a daemon restart included, reports exactly what was written. A store at schema version 1 or 2 opens and is migrated in place to version 3, only once when two openers race, and keeps every run and discovery it held: a version 1 store's `ran` runs read as not force-stopped, as today, and each discovered workspace of a discovery stored before the migration reads as not reporting these facts, a state distinct from reporting empty lists. A store at any other schema version, or a file that is not an RT Test store, is still refused and left unchanged.

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

- [ ] (AC1, AC2, AC3) Create `packages/daemon/src/vitest/selection-facts.ts`: from a loaded workspace session, report each project in `instance.projects` that is not in browser mode (the test `openSession`'s `usesBrowserMode` applies; reuse it), with its name, setup files, global setup files, aliases and test file patterns. Setup files come from `project.config.setupFiles` less the snapshot guard file (`SNAPSHOT_GUARD_FILE` in `workspace-session.ts`, which `guardSnapshots` puts first); global setup files are `project.config.globalSetup` followed by those of `instance.getRootProject().config.globalSetup` it lacks; aliases come from `project.vite.config.resolve.alias`; the patterns from `project.config.include`, `exclude` and `includeSource`, matched from `project.config.dir || project.config.root`, as `globTestFiles` reads it, with the consumer root reported as `.`. Convert each absolute path as `moduleLocator` and `testModuleFile` convert a module id, so both name one file alike, and a path whose real path cannot be read still converts against the workspace directory Vitest resolved it from. Turn a RegExp `find` into its `source` and a string kind marker, and a `customResolver` into a boolean, before the report leaves the executor. Keep every value the report carries JSON-safe (C38: the executor's IPC channel serializes JSON).
- [ ] (AC1, AC2, AC3) In `packages/daemon/src/vitest/discover-tests.ts`, give the `discovered` arm of `WorkspaceDiscovery` a required member carrying either the report or an explicit not-reported state, and have `collectWorkspace` fill it with the report. Keep the snapshot guard out, whether the report is read before `guardSnapshots` runs or filtered after; export the guard constant or move it only as C4 places it. Confirm that no production reader of `WorkspaceDiscovery` emits the new member into a query answer, a `--json` payload or a log (C38): at drafting, `query/summary.ts`, `query/test-states.ts` and `inputs/non-inputs.ts` read the discovered arm's fields by name, and none spreads it whole (create-ticket, `rg`, 23:13).
- [ ] (AC4) In `packages/daemon/src/store/schema.ts`, raise `STORE_SCHEMA_VERSION` to 3 and add one nullable JSON column for the report, last in `discovery_workspaces`, in `STORE_SCHEMA` and in the migration alike, so a new store and a migrated one hold the same columns in the same order. Give the opener a migration from version 1 (today's force-stop step, then the new column) and from version 2 (the new column), each ending at version 3. Rewrite the doc comments on the version constants and the migration to the new truth (C46, C55).
- [ ] (AC4) In `packages/daemon/src/store/open-store.ts`, migrate a store at version 1 or 2 under the write lock `inWriteTransaction` takes, in one transaction, re-reading the header there as `migrateSchema` does today, and keep refusing version 0, any version above 3, and a foreign application id with the file unchanged.
- [ ] (AC4) In `packages/daemon/src/store/write-discovery.ts`, write the report as JSON for a discovered workspace that reports it, and NULL for one that does not and for every other status. In `packages/daemon/src/store/read-discovery.ts`, read NULL on a discovered workspace as not reported and parse anything else strictly, refusing a malformed value as `unreadable` and a report on a workspace that is not discovered as the reader refuses tests under one today, so the reader and writer agree on every edge case (C9, C12). Put the JSON parsers beside their reader, or in `store/columns.ts` where they reuse its private `jsonText` and `isRecord` (C4, C5).
- [ ] (Support) Report the exact `docs/architecture.md` text to the orchestrator (orchestrator-owned; C48, C55): the discovery paragraph gains what AC1 to AC3 report, and the store sentence "the store migrates a store of the previous schema version in place, reading each of its runs as not force-stopped, since that version's code never force-stopped a run" becomes one naming both earlier versions and a discovery from before version 3 reading as not reporting the facts. Dev Notes § Architecture text holds a draft.
- [ ] (Support) Lint and typecheck.

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

- `_agent-docs/tickets/2-3b-selection-facts.md` (create-ticket)
- `_agent-docs/sprints/sprint-2-fresh-runs.md` (create-ticket, under the 23:05 grant: § Ticket 2.3b's global setup mechanism corrected per Q1, G1's browser-mode ruling added, and the ticket link)
- `_agent-docs/sprint-status.yaml` (create-ticket, under the 23:05 grant: `2-3b-selection-facts` to `ready-for-dev`)

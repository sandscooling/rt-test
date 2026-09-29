# Ticket 2.3m: Each workspace's env files

## Ticket

As an agent editing a consumer project whose tests read values from its env files,
I want every env file Vite loads for a workspace's tests to count as an input of that workspace, whatever git ignores,
so that an edit to a gitignored `.env.local` stales that workspace's results instead of leaving an old result reading current.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: For each discovered workspace, the discovery reports, for every project not in browser mode, each env source whose files Vite loads for that project's tests: the project's own config and the workspace's root config. Each source carries its resolved env directory (named as a test module's path is named: root-relative, climbing with `..` outside the root, absolute on another Windows drive), or none when the config turns env files off; its env prefix list, which is `VITE_` alone when the config sets none; and the mode Vite resolved for it, which is `test` for the root config even when that config sets its own `mode`, since Vitest passes one, while a project that sets its own mode reports that mode. This holds under Vitest 4.1 and 5.0.
- [x] AC2: Each env file a reported source names (`.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local` in its env directory; none for a source with no env directory) is an input of that project's workspace whatever git ignores: creating, editing or deleting one changes that workspace's fingerprint, and the discovery's fingerprint, which counts every env file its discovered workspaces list. An edit to one the inputs leave out, such as one git ignores, changes the fingerprint the next answer composes, though no event reports it.
- [x] AC3: No `rt-test.json` pattern removes from the inputs an env file the discovery in effect lists.
- [x] AC4: A discovery during which an env file it lists was created or modified is stored not fingerprinted, and the log names that file. A listed env file that does not exist when the discovery ends does not by itself keep the discovery from being stored under its fingerprint.
- [x] AC5: A discovered workspace whose env sources are not reported, such as one in a discovery stored before this version, has no fingerprint, and every answer lists it among the unfingerprinted workspaces with a reason saying its env files are not known. The discovery holding it has no fingerprint either, so it is not current, and the daemon rediscovers before it runs any workspace.
- [x] AC6: An env file whose read could block the daemon (a FIFO) is never read: its workspace, and the discovery listing it, have no fingerprint, and the reason names the file. A path Vite skips because it is neither a file nor a FIFO (a directory) counts as absent, as Vite reads it. An env file that cannot be read leaves no fingerprint, with a reason naming it, as an unreadable test module does.
- [x] AC7: The store keeps each project's env sources with the discovery across a restart. A store at schema version 7 opens at version 8 with every stored selection-facts report dropped, so each discovered workspace in it reads as not reporting (AC5); stores at versions 1 to 6 still migrate.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None open: every third-party behavior this ticket rests on was read in installed source or run in the spike, each recorded with its source under Dev Notes § Settled facts.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (AC1) In `vitest/selection-facts.ts`, add an exported `EnvSource` type (env directory or `null`, prefix list, mode) and a required `envSources` member on `ProjectSelectionFacts`. Fill it in `projectFacts` with the project's own source from `project.vite.config` and the root config's from `session.instance.vite.config` (the same object as `getRootProject().vite.config` on both lines), always both, own first, even when they name the same directory, since `inputs/env-files.ts` deduplicates the files. Name the env directory through the existing `rootRelative`; map Vite's `false` to `null`; take `envPrefix` as Vite leaves it on the resolved config (unset, a string or a list) and normalize it to a list, defaulting to a named `VITE_` constant.
- [x] (AC2, AC5, AC6) Create `inputs/env-files.ts`: from a `WorkspaceDiscovery`, the env files its reported projects name (the four file names per source, mirroring Vite's `getEnvFilesForMode`, deduplicated and root-relative), or why they are not known (a discovered workspace whose facts are not reported). A workspace that is not discovered names none. Give it the one reader of an env file's digest, which opens the file without blocking where the platform has FIFOs, checks the open handle's type, and reads only a regular file, from that same handle, so a file swapped for a FIFO between a check and a read is never read: absent, or neither file nor FIFO, digests as absent; a FIFO refuses with a reason and is never read; any other open or read failure refuses with its reason.
- [x] (AC2, AC5, AC6) In `inputs/fingerprint.ts`, make `workspaceFingerprint` and `discoveryFingerprint` digest each listed env file beside the listed test modules, under a named part of the digest. A listed env file the inputs hold as a regular file's content (the `file` kind `readEntryDigest` gives a file or a link to one) is taken from the held digest, and skipped when the selected inputs already count it. Every other listed env file is read afresh through the env file reader, through `SnapshotReads`, which caches env file reads per snapshot as it does modules. That includes one the inputs leave out, such as one git ignores, and one they hold by type or link target (a FIFO, socket or device git does not ignore, or a link to anything but a file), whose held digest cannot change with what Vite would read. Export from `inputs/input-inventory.ts` the one predicate saying whether a held digest is of the `file` kind, built on its own `FILE_KIND` and `KIND_SEPARATOR`; return no fingerprint with the reason when env files are not known or one refuses. The discovery fingerprint takes the union over its discovered workspaces.
- [x] (AC3, AC4) In `inputs/protection.ts`, add every env file `inputs/env-files.ts` lists for the discovery to `protectedFiles`, so protection and the fingerprint read one list. In `inputs/fingerprint.ts`, keep `protectedFileChangedSince` reporting a listed test module, setup file or global setup file it cannot stat as possibly changed, but treat a listed env file that does not exist as unchanged.
- [x] (AC7) In `store/columns.ts`, parse `envSources` inside `projectSelectionFacts`, accepting `null` or a string env directory, a list of strings and a string mode, and refusing anything else as the other fields do. In `store/schema.ts`, raise `STORE_SCHEMA_VERSION` to 8, name version 7 as the version whose code kept selection facts without env sources, and give it the `DROP_INCOMPLETE_FACTS` migration, as versions 3 to 6 have.
- [x] (AC1, AC2, AC3, AC4, AC5, AC6) In `docs/architecture.md`'s input tracker paragraph, state that every env file the discovery lists for a workspace is an input of it whatever git ignores, read afresh when the inputs leave it out and protected from every pattern, and add the known limits under Dev Notes § Known limits to its list.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `rootRelative` inside `projectFacts` (`vitest/selection-facts.ts`): names a path as a test module's path is named, through `session.locate` and `testModuleFile`; `moduleLocator`'s `realPath` falls back to the nearest existing parent, so an env directory that does not exist is still named (`vitest/module-tests.ts`).
- `usesBrowserMode` (`vitest/workspace-session.ts`): the existing browser-mode filter `selectionFacts` already applies.
- `SnapshotReads` (`inputs/fingerprint.ts`): the per-snapshot read cache every fingerprint of one moment shares; extend it rather than add a second cache.
- `heldDigest` and `unselectedModuleDigests` (`inputs/fingerprint.ts`): the pattern for a listed file the selected inputs leave out.
- `protectedFiles` (`inputs/protection.ts`): the one producer of the files protection names, which the tracker's `protect` already turns into flipped paths (`inputs/declared-non-inputs.ts`), and which `protectedFileChangedSince` walks.
- `absoluteInputPath` (`inputs/input-filter.ts`): resolves a root-relative, climbing or absolute path to an absolute one.
- `DROP_INCOMPLETE_FACTS` and `SET_SCHEMA_VERSION` (`store/schema.ts`): the migration an incomplete report already gets.
- `jsonText`, `jsonStrings`, `jsonArray`, `jsonRecord` and `unreadable` (`store/columns.ts`): the parsers `projectSelectionFacts` uses.
- `workspaceTestModules` and `discoveredTestModules` (`inputs/non-inputs.ts`): the shape a per-workspace and per-discovery listing already takes.
- `projectFacts` in `packages/daemon/test/harness.ts`: the test helper whose defaults every hand-built project in the tracker, protection, crawl-link and selection tests goes through.

### Must Create

- `EnvSource` and the `envSources` member of `ProjectSelectionFacts` (`vitest/selection-facts.ts`), with a named constant for Vite's default prefix.
- `inputs/env-files.ts`: the env file names per source, a workspace's and a discovery's listed env files or why they are not known, and the env file digest read.
- The version 7 constant and its migration entry (`store/schema.ts`).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

### Scope, quoted

Sprint 2's § Ticket 2.3m (orchestrator, 2026-09-29 16:11): "Each env file those sources load (`.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local` in each resolved `envDir`) becomes an input of that workspace whatever git ignores, as a listed test module is: read afresh each time the fingerprint is composed when the inputs leave it out, protected from every `rt-test.json` pattern, and checked for a change while a job runs." And: "A workspace whose env files are not known has no fingerprint, and every answer says why. The facts are kept among the selection facts, and the store's schema moves from 7 to 8, dropping each older report so it reads as never made, as versions 3, 5 and 6 did; after the upgrade every result reads stale once and a discovery runs again before any workspace runs, which only reruns."

Requirements: FR6, "Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current." NFR3, "Never report a result as current unless its stored input fingerprint matches the current inputs." AC7 also rests on FR3, "Persist results bound to project, worktree, run identity, input fingerprint, and adapter version, and keep them available across a daemon restart."

`docs/architecture.md`, input tracker paragraph, the pattern this ticket extends: "Every test module the latest discovery lists is also an input of its own workspace, whatever git ignores; one the inputs leave out, such as one git ignores, is read afresh each time the fingerprint is composed."

Glossary (`docs/glossary.md`), verbatim:

- **Input**: "A file whose edit RT Test treats as able to change a test's result."
- **Input fingerprint**: "A digest of every input, the environment, and the runtime and tool versions that can change a test's result."
- **Freshness**: "Whether a result still describes its test's current inputs."

### Settled facts

Each settled while drafting (create-ticket, 2026-09-29 16:18 to 16:23), from installed source or the spike below. The change request `rt-t-env-expansion-cr` read the same lines statically first (16:18, corrected 16:19).

- **Which files Vite loads.** Vite 8.3.1 `dist/node/chunks/node.js` `getEnvFilesForMode` (lines 6023 to 6031) returns `.env`, `.env.local`, `.env.${mode}` and `.env.${mode}.local` joined to `envDir`, and none when `envDir === false`. `loadEnv` (6036 to 6064) stats each and skips a path that is neither a file nor a FIFO, so it reads a FIFO; it throws on mode `local`; only keys starting with a prefix enter the returned env (6059). Git is never consulted: a gitignored `.env.local` loads as any other.
- **How `envDir`, `envPrefix` and `mode` resolve.** `resolveConfig` (37392 to 37395): `envFile === false`, deprecated, means `envDir` false; otherwise `envDir` is `path.resolve(resolvedRoot, config.envDir)` when set, else the resolved root, normalized to `/`. The resolved config is `{ ...config, ...resolved }` (about 37570), holding `envDir` resolved (string or `false`), `mode`, `env` (`{ ...userEnv, BASE_URL, MODE, DEV, PROD }`, 37514 to 37520) and `envPrefix` as the user wrote it, unset when unwritten; `resolveEnvPrefix` (6065 to 6070) defaults it to `VITE_`, arrayifies it, and throws on `""`, so a config that resolved never holds an empty prefix. `mode` is `inlineConfig.mode || config.mode || defaultMode` (37278). Vitest 4.1.11 passes an inline mode: `createVitest` sets `mode: options.mode || mode` for the root (`dist/chunks/cli-api.CnMVyzaz.js` 14284), and `initializeProject` sets `mode: options.test?.mode || options.mode || ctx.config.mode` for a project (11122). RT Test calls `createVitest("test", ...)` (`vitest/workspace-session.ts`), so a root config's own `mode` never applies; read the resolved `mode`, never the written one.
- **What reaches the worker.** Vitest 4.1.11: the root plugin's `configResolved` copies the root Vite config's env into the host's `process.env` with `??=` (cli-api 14226 to 14240); a project's serialized config carries `env: { ...viteConfig?.env, ...config.env }` (9299 to 9301); each worker's env is `{ ...process.env, ...options.env, ...ctx.config.env, ...project.config.env }` (3718 to 3721); `setupEnv` fills `import.meta.env` from `config.env` (`setup-common.DYx3LtFI.js` 34 to 41). Vitest 5.0.1 (`dist/chunks/index.DzobfTyw.js` 9856 to 9858 and 11651 to 11657) has the same serialized env and worker env, and no root copy into `process.env`; the spike shows it merges the root config's env into each project's Vite env instead.
- **The spike** (`_agent-docs/.scratch/create-ticket/env-spike/spike.mjs`, Node 24.19.0, Windows, run 16:20 with `node spike.mjs vitest-4` then `node spike.mjs vitest`, both exit 0; removed at finalize). A consumer with a root `.gitignore` listing `.env.local`; root `.env`, `.env.local` (`VITE_ROOT_LOCAL`, `NOT_PREFIXED`), `.env.test` and `.env.staging`; a root config setting `mode: "staging"`; project `a` inline; project `b` with `envDir: "b-env"` and `envPrefix: ["VITE_", "APP_"]`; project `c` with `root: "c"` and its own `c/.env.local`. Driven as `workspace-session.ts` drives it: `createVitest("test", { root, watch: false, config })`, then `start()`. Observed on both lines alike:
  - Resolved `mode` is `test` for the root and every project; `VITE_STAGING` reached no test.
  - `instance.vite.config === instance.getRootProject().vite.config`.
  - Project `b`'s `vite.config.envDir` is `<root>/b-env` and its `envPrefix` `["VITE_", "APP_"]`; `c`'s `envDir` is `<root>/c`; every unset `envPrefix` reads unset on the resolved config.
  - Each test read the gitignored root `.env.local`'s `VITE_ROOT_LOCAL=root-local` in both `process.env` and `import.meta.env`, project `c`'s included, whose own env directory is `c`; `b` also read `APP_B`, `VITE_B_LOCAL` and `VITE_B_TEST_LOCAL`; `c` read `VITE_C_LOCAL`; no test read `NOT_PREFIXED`.
  - Under 4.1.11 the host's `process.env` gained `VITE_ROOT_*`, `MODE`, `DEV`, `PROD`, `BASE_URL` and `NODE_ENV`; under 5.0.1 only `NODE_ENV`, and each project's Vite env held the root's `VITE_ROOT_*` keys.
- So every project's tests see its own source's files and the root config's, which is why AC1 reports both per project. Not reached: a `vitest.workspace` file, a project config file of its own (`projects: ["packages/*"]`), and Linux; each is resolved by the same `resolveConfig`, which the spike does not vary.

### Decisions

- **Where the facts live** (create-ticket, 16:27; only the code differs). `envSources` is a member of each `ProjectSelectionFacts`, not of the reported object. A root config's env reaches tests only through a project, so a report with no project (every project in browser mode) runs no test and needs no env file. It also keeps the store column an array: `store/write-discovery.ts` and `store/read-discovery.ts` stay unchanged, and the literal sweep follows the project literals (§ Test files this change breaks), none of which ticket 2.3i edits, where a member on the reported object would break every `reported: true` literal, `query.test.ts` and `scheduling-harness.ts` among them.
- **The discovery's fingerprint counts env files** (create-ticket, 16:22). A discovery imports every test module, which reads the env too. It is also what makes AC5's rediscovery happen: `Scheduler.#discoveryDue` rediscovers when `recordFreshness(stored, current)` is not `current`, and a discovery with no fingerprint rates unknown.
- **An absent env file is unchanged at a discovery's end** (AC4). `protectedFileChangedSince` reads a path it cannot stat as possibly changed, and most listed env files never exist (a `.env.test.local`), so without this every discovery would be stored not fingerprinted.
- **A FIFO leaves no fingerprint** (AC6), as the owner ruled for 2.3o's counting, where an env file that is not a regular file "(a FIFO, whose read could block)" fails toward staleness (sprint 2 § Ticket 2.3o, owner 14:42). A directory digests as absent, since Vite skips it.
- **No answer-side code.** Every answer already carries `unfingerprintedWorkspaces` (`AnswerContext`, `query/answer.ts`), each with the reason `workspaceFingerprint` returns, in `--json` and the CLI text (`packages/cli/src/answer-text.ts`). AC5's and AC6's reasons ride on it. `AnswerContext`'s docblock ("its own inputs could not be read, or the dependency build its inputs wait for has not ended") stays, since 2.3i edits `answer.ts`.
- **No event handling.** An edit to a gitignored env file raises no event today: the input filter drops it before it is queued. Answers still read the workspace stale, since the file is read afresh at each composition, and a run spanning the edit is caught by its end fingerprint, but the scheduler wakes only on a new input revision or the periodic reconciliation, so the rerun can wait up to 5 minutes. Ticket 2.3p owns that.
- **A lasting refusal costs one discovery per input revision, never a loop** (ticket review Q1, settled by create-ticket at 16:39 from code). A FIFO or unreadable env file that stays leaves the discovery with no fingerprint at every revision, but `Scheduler.#discoveryDue` returns false once `#discoveryTriedAt` equals the settled revision, and `#ranAlready` holds each unfingerprinted workspace to the runs 2.3f allows at one revision (a run, and one rerun when it was stored not fingerprinted with the revision unmoved, `rerunOwed`), as an unreadable test module does today. Each edit then costs a rediscovery and at most those runs of that workspace, both failing toward staleness.
- **AC5's downstream effects are existing behavior** (ticket review Q2, 16:39). A discovery with no fingerprint is rediscovered before due runs by 2.3f's rule, and an unfingerprinted workspace is listed in every answer by `unfingerprintedWorkspaces`. Ticket 2.3i's scheduler task records the schedule "changing no decision". So AC5 owes tests of the fingerprint's absence and its reason, at the fingerprint level in `input-tracker.test.ts`, and no scheduler or query test, keeping this ticket off 2.3i's `scheduler.test.ts` and `query.test.ts`.

#### Questions and answers

Asked by create-ticket at 16:32, answered by the orchestrator at 16:33.

- **G1. Do failed, unsupported and not-confirmed workspaces list env files?** No: they list none and keep today's fingerprint, so AC5's "not known" covers only a discovered workspace whose facts are unreported. Vite loads env files only after the config file loads (`resolveConfig`: `loadConfigFromFile`, then `loadEnv`), and such an entry reports no selection facts. Accepted on the condition that no answer counts such a workspace's tests, verified at 16:33: `summary` and `status <path>` both count tests only through `queryBasis` (`query/summary.ts`), whose `testStandings` (`query/test-states.ts`) takes tests only from entries whose status is `discovered`. So a run stored under a fingerprint without its env files shows no test as current, and the only effect is a rerun that waits for the periodic rediscovery (§ Known limits).
- **G2. Does an env file edited while a run reads it interrupt the run?** Not in this ticket. The run finishes, its end fingerprint differs, and it is stored not fingerprinted and rerun, which never reads current. Run judgment places a listed test module inside its workspace (`placedInside`, `daemon/run-judgment.ts`), and doing the same for env files edits `run-judgment.ts`, which 2.3i edits. Ticket 2.3p takes it.
- **G3. Is an env file deleted while a discovery runs a documented limit?** Yes (§ Known limits). The orchestrator rejected the cheap alternative, reading the env directory's modification time, since an unrelated write in the root during a discovery would leave discoveries unfingerprinted and risk a rediscovery loop. Ticket 2.3p narrows the limit for env files an earlier discovery listed, since their deletion then raises an event the discovery's store check sees.
- **Placement of `envSources` on `ProjectSelectionFacts`** (§ Decisions): agreed by the orchestrator at 16:33.
- **Ticket review**, 16:34 to 16:38, triaged by create-ticket at 16:39. Applied E2 (a project's own mode is reported, not `test`), E4 (the env file reader checks the open handle it reads from), E5 (protection takes its env files from `inputs/env-files.ts`) and E6 (AC2 states the outcome, not the read). E1 was resolved by always reporting both sources and deduplicating files, not by an equality rule. E3 was rejected, since `sizing_ac_count` counts the criteria that need code plus one for validation. Q1 and Q2 were settled from code (§ Decisions), and Q3 by stating the readers' search.
- **Sanity check F1**, asked by rt-t2-3m-dev at 16:48, ruled by create-ticket at 16:49, CONFIRMED. Task 3 took a held digest for any env file the inputs hold, but `readEntryDigest` (`inputs/input-inventory.ts`) holds a FIFO, socket or device git does not ignore by its type alone (`special:<type>`), and a link to anything but a file by its target path (`link:<digest>`). So a tracked FIFO `.env` kept a fingerprint, against AC6. Now only a held `file` digest is taken, and every other listed env file goes through the env file reader. The reader refuses a FIFO and counts a link to a missing file or a directory as absent, as AC6 and Vite do. Refusing every non-file held digest, the dev's proposal, would have contradicted AC6's "counts as absent". `input-inventory.ts` joined the file list for the predicate's export.

### Known limits

For `docs/architecture.md`'s list:

- A listed env file that exists when a discovery begins and is deleted before it ends: the discovery is stored under a fingerprint that reads it absent, though its modules may have read it (G3).
- An env file a config, setup file or test loads itself (with `dotenv`, or by calling `loadEnv`), and an `envDir` a config computes from a value outside the inputs: only the directories and modes Vite resolved for Vitest are listed.
- A listed env file outside the consumer root is read afresh but never watched (2.3p names this too).
- A workspace whose discovery failed, is unsupported or was not confirmed lists no env file, so a run of it that succeeds is stored under a fingerprint without them. An env edit then reruns it only after the periodic rediscovery, up to 5 minutes later. No answer reads that run's tests current meanwhile, since answers count only a discovered workspace's tests (G1).

### Current structure of the files this ticket changes

- `vitest/selection-facts.ts` (195 lines): `ProjectSelectionFacts` (`projectName`, `viteRoot`, `setupFiles`, `globalSetupFiles`, `aliases`, `testFilePatterns`); `SelectionFacts` is `{ reported: true; projects } | { reported: false }`; `selectionFacts(session, signal)` skips browser-mode projects; `projectFacts` builds each project's facts with a local `rootRelative`.
- `store/schema.ts` (172 lines): `STORE_SCHEMA_VERSION = 7`; version constants 1 to 6; `DROP_INCOMPLETE_FACTS` is `UPDATE discovery_workspaces SET selection_facts = NULL;`; `STORE_MIGRATIONS` maps versions 1 to 6.
- `store/columns.ts` (318 lines): `projectSelectionFacts(value)` parses one project with `jsonText`, `jsonStrings`, `jsonArray` and `jsonRecord`.
- `inputs/protection.ts` (260 lines): `protection(discovery, consumerRoot)`; `protectedFiles(discovery)` returns every listed test module and each reported project's setup and global setup files.
- `inputs/fingerprint.ts` (282 lines): `SnapshotReads` (environment digest, a module digest cache, a Vitest version cache); `workspaceFingerprint` and `discoveryFingerprint`, each digesting `sharedParts`, the selected inputs' digest, `unselectedModuleDigests` and Vitest versions; `moduleDigest` reads a file whole and digests a missing one as `absent`; `protectedFileChangedSince(project, discovery, since)` stats each protected file the inputs leave out and reports one it cannot stat, or modified at or after `since` less `MODIFIED_TIME_RESOLUTION_MS`.
- Readers of the changed shape, which need no edit, found by `rg -n "projectSelectionFacts|selectionFacts\b|SelectionFacts\b" packages/daemon/src packages/cli/src` (16:23; the CLI has no hit, so no `--json` output carries selection facts): `store/write-discovery.ts` stores `JSON.stringify(entry.selectionFacts.projects)`; `store/read-discovery.ts` parses it with `arrayOf(row, SELECTION_FACTS, projectSelectionFacts)`; `selection/selection-input.ts` and `inputs/protection.ts` read the projects' other members.

### Test files this change breaks

For create-tests. The new required member breaks each hand-built `ProjectSelectionFacts` literal: `packages/daemon/test/harness.ts` (`projectFacts`, whose default covers `input-tracker.test.ts`, `protection.test.ts`, `crawl-links.test.ts`, `selection/harness.ts` and `selection/select-tests.test.ts`), `protection-win32.test.ts` and `store.test.ts`. The other files a `viteRoot` search finds (`executor.test.ts`, `selection/workspace-graph.test.ts`, and the alias expectations in `selection/select-tests.test.ts` and `selection/harness.ts`) spell a selection alias's `viteRoot`, not a project's facts. `discover-tests.test.ts` also compares reported facts from real Vitest, which now carry env sources.

Named-defect anchors this change moves, in `packages/daemon/test/defects.json`: D2792 (`export const STORE_SCHEMA_VERSION = 7;`) certainly; D1899, D2534, D1900 and D2160 in `fingerprint.ts` and D2103, D2259 and D2261 in `columns.ts` if the lines they anchor are edited. Tests are expected to need the selection-facts fixture (`test/fixtures/daemon/selection-facts/vitest.config.mjs`) to set an `envDir` or `envPrefix`; env files themselves match this repository's `.gitignore` (`.env`, `.env.*`), so a test writes them into its temporary copy.

### Pending siblings

- 2.3i (ready-for-dev, building in the main checkout): its production files and test files (`query.test.ts`, `scheduler.test.ts`, `lifecycle.test.ts`, `cli.test.ts`) are disjoint from this ticket's, by § Decisions' placement. It edits `docs/architecture.md`'s query paragraph; this ticket edits the input tracker paragraph, so the two meet only in one file.
- 2.3p (backlog, next): makes an event on a listed file git ignores reach the tracker, and reads env files through `inputs/env-files.ts`. It also places each listed env file inside its workspace for run judgment (G2) and narrows G3's limit, per its sprint scope.
- 2.3n and 2.3o (backlog): 2.3o counts variables by value from the env sources and files this ticket reports; it names `docs/architecture.md`'s known limits.
- 2.4b (ready-for-dev) reads `ProjectInputs` only. 2.4, 2.4d and 2.4c name only the `packages/daemon/src` folder or other paragraphs of `docs/architecture.md`.

### Previous-ticket intel

The nearest earlier tickets, 2.3l and 2.3k, are in backlog, and 2.3i has no completion notes yet. The latest product fixes: 202ae14 (a restart from a new terminal no longer stales every result), which wrote the environment digest's known limit that 2.3o closes; a53426c (a discovery whose store write failed is no longer logged as ended).

### References

- Change request `rt-t-env-expansion-cr` (threadId 0ed925fc-d4a0-4d83-960b-8fe5de84aefa), findings 16:18 and correction 16:19: Fleet Cooling loads gitignored `.env.local` files at its root, `apps/admin`, `apps/storefront` and `packages/convex`, none with a `VITE_` key and no config setting `envPrefix`, so nothing in them reaches a Fleet Cooling test through Vite today. This ticket's gap is real there as soon as one of them gains a `VITE_` key.
- GitHub issues: none open (`node scripts/list-open-issues.mjs`, 16:29).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C9,C12,C14,C30,C38,C39,C46,C48,C53,C113,C117,C147,C149,C160 -->

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
  - docs
is_consolidation: false
sizing_ac_count: 8
files_to_modify:
  - packages/daemon/src/vitest/selection-facts.ts
  - packages/daemon/src/store/columns.ts
  - packages/daemon/src/store/schema.ts
  - packages/daemon/src/inputs/protection.ts
  - packages/daemon/src/inputs/fingerprint.ts
  - packages/daemon/src/inputs/input-inventory.ts
  - docs/architecture.md
  - packages/daemon/test/discover-tests.test.ts
  - packages/daemon/test/store.test.ts
  - packages/daemon/test/input-tracker.test.ts
  - packages/daemon/test/protection.test.ts
  - packages/daemon/test/defects.json
  - test/fixtures/daemon/selection-facts/vitest.config.mjs
  - packages/daemon/test/harness.ts
  - packages/daemon/test/protection-win32.test.ts
files_to_create:
  - packages/daemon/src/inputs/env-files.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 3fcf7275-2d7d-46d7-8491-11130372d1f7

#### Test Files This Change Broke

- Typecheck (`bun run --filter @rt-test/daemon typecheck`, 17:02; the CLI's typecheck reports the same `harness.ts` error): each literal lacking `envSources`, in `packages/daemon/test/harness.ts`'s `projectFacts` (which covers `input-tracker.test.ts`, `protection.test.ts`, `crawl-links.test.ts`, `selection/harness.ts` and `selection/select-tests.test.ts`), `packages/daemon/test/protection-win32.test.ts`'s `discoveryIncluding`, and `packages/daemon/test/store.test.ts`'s `CART_PROJECT_FACTS` and `EMPTY_PROJECT_FACTS`.
- Expected at runtime, per Dev Notes: `discover-tests.test.ts` compares reported facts from real Vitest, which now carry `envSources`; `store.test.ts` also reads the schema version, now 8.
- Defect records whose `old` no longer matches exactly once (checked 17:03 with a scratch script over both `defects.json` files): D1898 (`fingerprint.ts`, the held-path skip is now `if (watched(path)) continue;`), D1900 (`ABSENT_MODULE` is now `ABSENT_FILE`), D2792 (`STORE_SCHEMA_VERSION = 8`), and `selection/defects.json` D2128 and D2129 (the setup and global setup loops moved into `protectedModules`, two spaces shallower). D1899, D2534, D2160, D1915, D2103, D2259 and D2261 still match once.

#### ACs Owed a Test

Every criterion. Its evidence at dev is a traced code path, plus probes of the env file reader's logic (below), not an observation of the product code:

- AC1: a discovery reports, per project not in browser mode, its own and the root config's env source: directory named root-relative (climbing, other-drive absolute), `null` when off, prefixes defaulting to `VITE_`, mode `test` for the root and a project's own mode when it sets one, under Vitest 4.1 and 5.0.
- AC2: creating, editing or deleting a listed env file (gitignored or not) changes the workspace's and the discovery's fingerprint; a gitignored edit changes the next composition without an event.
- AC3: no `rt-test.json` pattern removes a listed env file from the inputs.
- AC4: an env file created or modified during a discovery stores it not fingerprinted with the log naming the file; a listed env file absent at the end does not by itself.
- AC5: a discovered workspace with unreported facts has no fingerprint, the reason says its env files are not known, and the discovery has none either.
- AC6: a FIFO env file (or a link to one) refuses without being read and names the file; a directory, a socket, a dangling link and a path below a file count as absent; an unreadable env file refuses with its reason. A FIFO git does not ignore (held as `special:fifo`) refuses too (F1).
- AC7: env sources survive a store round trip; a version 7 store opens at 8 with every selection-facts report dropped; versions 1 to 6 still migrate.

#### Tests Owed

Defects the adversarial review found and this change fixed (17:02), each nameable:

- A held env file whose digest is not of a file's content (a link to a missing file or a directory, held as `link:`) was skipped by `protectedFileChangedSince` though the fingerprint reads it afresh, so its target edited during a discovery went unseen (`fingerprint.ts`, `heldEnvDigest` in `watched`).
- A Unix socket at a listed env path refused the fingerprint (its open fails with ENXIO), where Vite skips it; the reader now stats before opening (`env-files.ts`, `envFileDigest`).
- A JavaScript config with `envPrefix: null`, or a prefix list holding a non-string, threw out of discovery or stored a record the store refuses on read; prefixes are now coerced with `String` as Vite's `startsWith` coerces them (`selection-facts.ts`, `envPrefixes`).

### Tests Record

Tests session: threadId aaa28f49-d1d1-4f30-a221-ffd75812ec49

#### Named Defects

- D3036: The store reads every env source's mode back as test, so a project that sets its own mode names another mode's env files once its discovery is read back. (AC7)
- D3037: The store refuses an env source whose env directory is null, so every discovery holding a config that turns env files off is unreadable after a restart. (AC7)
- D3038: A stored project with no env sources reads back as having none, so a malformed record reads as a project naming no env file instead of being refused. (AC7)
- D3039: A stored env directory that is false or empty reads back as env files turned off, so a malformed record lists no env file instead of being refused. (AC7)
- D3040: The version 7 migration keeps the stored selection facts, which lack env sources, so reading any discovery stored before it fails. (AC7)
- D3041: A version 7 store has no migration to the current version, so every existing store is refused once the daemon is upgraded. (AC7)
- D3042: A project's env directory is reported as Vite's absolute path, so the env files listed for it are named unlike every other input and never match one. (AC1)
- D3043: A project's own env source is read from the root config, so the env files in a directory its own config names are never listed. (AC1)
- D3044: A config that turns env files off is reported with the consumer root as its env directory, so files Vite never loads are listed in place of none. (AC1)
- D3045: A config that sets no env prefix reports none, where Vite passes every VITE_ variable to its tests. (AC1)
- D3046: An env prefix written as a string is split into its characters, so the report names one-character prefixes Vite never tests. (AC1)
- D3047: An env prefix a JavaScript config writes as null or a number is carried as written, so the stored report is refused as unreadable once read back. (AC1)
- D3048: The root config's env source is read from the project's own config, so a root .env.local every project's tests read is never listed for a project with its own env directory. (AC1)
- D3049: Every env source is reported in mode test, so a project that sets its own mode lists .env.test in place of the .env.<mode> files Vite loads for it. (AC1)
- D3050: A project reports the root config's env source before its own, so a reader taking the project's own source first reads the root's. (AC1)
- D3051: A project reports only its own env source, so the root config's env files, which Vitest gives every project's tests, are never listed. (AC1)
- D3052: A source names no .env.<mode>.local file, so an edit to the mode's local env file, which Vite loads last, never stales its workspace. (AC2)
- D3053: A source whose config turns env files off still names the consumer root's env files, so edits to files Vite never loads stale its workspace. (AC2)
- D3054: A FIFO at a listed env path digests as nothing there, so its workspace keeps a fingerprint though Vite reads whatever the FIFO carries. (AC6)
- D3055: The reader opens whatever is at a listed env path before checking its kind, so a FIFO is opened, releasing a writer waiting on it. (AC6)
- D3056: The reader reads an opened env file without checking the open handle, so a FIFO swapped in after the check is read. (AC6)
- D3057: The reader reads any entry that exists as a file, so a directory at a listed env path, which Vite skips, refuses its workspace's fingerprint. (AC6)
- D3058: A socket at a listed env path refuses the fingerprint, where Vite skips it, so the workspace is never current. (AC6)
- D3059: An env file that cannot be opened digests as nothing there, so its workspace gets a fingerprint without the content Vite reads. (AC6)
- D3060: A failed read of an env file throws out of the fingerprint and leaves its descriptor open, where it should refuse with the error. (AC6)
- D3061: A failed close of an env file throws out of the fingerprint, where it should refuse with the error. (AC6)
- D3062: An env file removed between its check and its open refuses the fingerprint, where Vite would read nothing there. (AC6)
- D3063: An env file replaced by a socket or a device with no driver between its check and its open refuses the fingerprint, where Vite skips such an entry. (AC6)
- D3064: A listed env file with nothing at its path refuses the fingerprint, so a workspace whose .env.test.local was never written is never current. (AC2)
- D3065: A workspace's fingerprint leaves out its env files, so an edit to a gitignored .env.local leaves its results current. (AC2)
- D3066: The discovery's fingerprint leaves out the env files it lists, so a discovery whose modules read an env file since edited stays current and is never run again. (AC2)
- D3067: The discovery's env files are those of its first workspace alone, so an edit to another workspace's env file leaves the discovery current. (AC2)
- D3068: An env file's digest does not depend on its content, so an edit that keeps it in place leaves its workspace's results current. (AC2)
- D3069: A listed env file with nothing at its path refuses the fingerprint, so a workspace whose .env.local does not exist yet, or was deleted, is never current. (AC2)
- D3070: A project's env files are those of its own source alone, so an edit to the root config's .env.local, which Vitest gives every project's tests, leaves a project with its own env directory current. (AC2)
- D3071: A workspace's env files are those of its first project alone, so an edit to an env file only another project names leaves the workspace current. (AC2)
- D3072: A listed env file the snapshot holds is read from disk instead, so answers from one snapshot can disagree and an edit the tracker has read is not the one fingerprinted. (AC2)
- D3073: A listed env file the inputs hold by type or link target is taken from that held digest, which does not change with what Vite reads there, so an edit to it leaves its workspace current. (AC6)
- D3074: A discovered workspace whose selection facts are not reported reads as naming no env file, so it gets a fingerprint without the env files its tests read. (AC5)
- D3075: A discovery holding a workspace whose env files are not known takes the other workspaces' env files, so it gets a fingerprint and is not rediscovered after the upgrade. (AC5)
- D3076: A workspace whose discovery failed reads as one whose env files are not known, so it loses the fingerprint it had and every run of it is stored not fingerprinted. (AC5)
- D3077: The time check before protection covers no env file, so a gitignored env file created or edited during the discovery's job leaves the discovery stored under its digest. (AC4)
- D3078: A listed env file with nothing at its path is reported as possibly changed, so almost every discovery, whose .env.test.local never exists, is stored not fingerprinted. (AC4)
- D3079: A listed test module the time check cannot find is taken as unchanged, as an env file is, so a module deleted during the discovery's job leaves the discovery stored under its digest. (AC4)
- D3080: The time check skips every env file the inputs hold, a link to a missing file or a directory included, whose held digest the fingerprint does not take, so its target edited during the discovery's job goes unseen. (AC4)
- D3081: Protection names no env file, so a declared rt-test.json pattern covering an env directory removes its env files from the inputs, and an edit to one no longer raises the input revision. (AC3)
- Stale tests re-pinned at schema version 8, each keeping its own mutation (AC7): D1280, D2097, D2846, D2791, D2831, D2859, and D2792, re-anchored to mutate `STORE_SCHEMA_VERSION = 8` to 7.
- Re-anchored to the source this change moved, each keeping its defect: D1898 and D1900 (`fingerprint.ts`), and D2128 and D2129 (`protection.ts`, in `packages/daemon/test/selection/defects.json`).
- The review's gaps (18:01), each confirmed absent before its test was written:
  - D3082: A stat of a listed env path that fails with anything but no entry digests as nothing there, so its workspace gets a fingerprint without the content Vite may read. (AC6)
  - D3083: The reader leaves an env file's descriptor open after reading it, so the daemon leaks one descriptor per listed env file per answer until opens fail. (AC6)
  - D3084: The reader's check of the opened handle refuses only a FIFO and reads anything else, so a socket or directory swapped in after the stat is read rather than skipped as Vite skips it. (AC6)
  - D3085: A mode a JavaScript config writes as a number is reported as written, so the stored report is refused as unreadable once read back. (AC1)
  - D3091: A stored env source with no envDirectory key reads back as env files turned off, so a malformed record lists no env file instead of being refused. (AC7)
  - D3092: A stored env source whose mode is missing reads back without refusal, so a malformed record names .env.undefined files in place of its mode's. (AC7)
  - D3049 re-anchored to the review's `mode: String(mode),`, keeping its defect. D3060's test now also asserts the failed read closes its descriptor, which its defect sentence names.

#### Deliberately Untested

- `packages/daemon/src/inputs/env-files.ts` (`OPEN_WITHOUT_BLOCKING`): the only effect of opening without `O_NONBLOCK` is that a FIFO swapped in after the stat blocks the open, which blocks the test's own thread in a synchronous call, so no assertion can observe it; Windows defines no `O_NONBLOCK`.
- `packages/daemon/src/inputs/env-files.ts` (`ABSENT_CODES`' `ENOTDIR` and `EISDIR`): an open for reading of a path a stat just found to be a regular file returns them on neither host short of a parent swapped for a file mid-call; the branch they share is proven through `ENOENT` (D3062) and `ENXIO` (D3063).
- `packages/daemon/src/inputs/fingerprint.ts` (`envFileDigests`' skip of a held env file the selected inputs count): dropping it counts the file twice in one digest, which changes no fingerprint's response to any edit.
- AC1's env directory on another Windows drive: it is named through the same `rootRelative` as every test module, whose other-drive spelling D2118 covers in `test-module-file.test.ts`; a report that bypasses it is D3042.
- AC4's log line, AC5's answer listing and AC5's rediscovery: existing behavior that carries the reason `protectedFileChangedSince` and `workspaceFingerprint` return (§ Decisions, Q2), in `lifecycle.ts`, `query/answer.ts` and `scheduler.ts`, which ticket 2.3i owns; this ticket's tests pin the reasons (D3074, D3075, D3077).
- AC6's FIFO, socket and link cases on a real FIFO or socket: `env-files.test.ts` injects each entry kind through a pass-through `node:fs` mock, so every case runs on Windows and Linux alike; a dangling link reads through the same stat as a missing path (D3064).

#### Notes

- On Vitest 5, an inline project inherits the root config unless it sets `extends: false` (`resolveSingleProjectEntry`'s `inheritsParentConfig`, `vitest@5.0.1` `dist/chunks/index.DzobfTyw.js`), so the fixture's `rooted` project resolves `envPrefix` to the root's list followed by its own. The report reads the resolved config, which is what Vite loads with, so it is right; the tests pinning a project's own prefixes run on Vitest 4.1, whose inline projects inherit only under `extends: true`. Reported to the orchestrator at 17:22.
- Proof scope, asked by rt-t2-3m-tests at 17:28. The orchestrator first decided every record `--edited` selects (480), then revised it at 17:47 on the owner's question. The revised set is the 130 records that are new, re-anchored or re-pinned, or mutate a file this ticket changed, plus every record in `store.test.ts`. The reason: `discover-tests.test.ts`, `protection.test.ts` and `input-tracker.test.ts` only gained imports, declarations and new describe blocks, so every existing test in them is byte-identical and runs the same code, while `store.test.ts` changed existing lines (the re-pins and the shared unaware-store helper). The `harness.ts` change adds only `envSources: []` as `projectFacts`' default, which names no env file, so its readers run the inputs they ran before this ticket and join no set. The Windows `--edited` run over all 480, a superset of the revised set, had already finished at 17:42. The Linux run over the 480 then held the lease and was left to finish, as the orchestrator directed.
- Proof, over the tree whose test and production files are unchanged since 17:30: `node scripts/verify-defects.mjs --edited` through the run lease on Windows (Node 24, about 17:36 to 17:42) and in the WSL clone `~/rt-test-2-3m` under Node 24.19.0 with `TMPDIR` set (about 17:44 to 17:48). Each run detected 480 of 480 selected defects in 12 sandboxes, with the baseline green before and after and exit 0.
- Review round (18:01 gaps): `env-files.test.ts`, `store.test.ts` and `discover-tests.test.ts` ran 272 of 272 green (18:03); lint, prettier and the daemon typecheck exit 0 (18:04). The fixture's new env options moved below each project's `test` block with comments of their own, and `absolute` gained `mode: 2`. The proof set is 51 records: the 6 new ones and re-anchored D3049; every record in `env-files.test.ts`, whose shared helper changed; every test that discovers the selection-facts fixture, which changed; and every record mutating `selection-facts.ts`, which the review's fix changed. `store.test.ts` and `discover-tests.test.ts` otherwise only gained tests, by the orchestrator's 17:47 rule. `verify-defects --ids` over the 51, through the run lease, detected 51 of 51 with the baseline green before and after, exit 0: on Windows (about 18:04 to 18:06) and in the refreshed WSL clone under Node 24.19.0 with `TMPDIR` set (about 18:06 to 18:07).
- Suite: `bun x vitest related` over the seven changed production files and `harness.ts`, through the run lease (17:33:24, 150.6 s), selected 30 of the 32 product test files; 1526 of 1526 tests passed, exit 0.

### Review Record

Review session: threadId 62658e54-5b85-4649-89ce-836e7d8b69bd

Review fixes (18:00): `selection-facts.ts` reports a source's mode as `String(mode)`, since Vite leaves a JavaScript config's `mode` as written (Vite 8.3.1 `node.js` 37278, Vitest 4.1.11 `cli-api` 11122) and names the files by its string form (`getEnvFilesForMode`, 6023 to 6031), where a numeric mode reached the store and was refused on read; `DEFAULT_ENV_PREFIX` is no longer exported, since nothing imports it. The record's broken-test-file lists and File List were corrected.

#### Questions and answers

- **Q1. Vitest 5 nested project containers**, asked by review at 18:01, decided by the orchestrator at 18:02 as review recommended. Vitest 5.0.1 gives a project that a container config declares the container's resolved env as defaults: `for (const key in parentViteConfig.env) projectViteConfig.env[key] ??= parentViteConfig.env[key];` (`node_modules/.bun/vitest@5.0.1+2809c141fc59fc1d/node_modules/vitest/dist/chunks/index.DzobfTyw.js` 12864), where `parentViteConfig` is the declaring container's config: a container "doesn't run tests itself" and resolves its children with itself as parent (12615 to 12628, `resolveDeclaredProjectEntries`). A container is no reported project, and this ticket lists only each project's own source and the root config's, so an edit to a gitignored env file in a nested container's env directory changes what its projects' tests see with no fingerprint change. Vitest 4.1.11 copies only the root's env into `process.env` (`cli-api.CnMVyzaz.js` 14235 to 14240). Ruling: a known limit in `docs/architecture.md` for this ticket, and a follow-up ticket 2.3q, after 2.3m and before 2.3p, that lists the declaring container's env source for each Vitest 5 project, or reports that project's env sources as not known where the container cannot be learned; its authoring spikes how to reach the container. This ticket does not wait for it.

#### Tech debt found

- `inputs/fingerprint.ts` `modifiedAt` compares only the target's modification time through `statSync`. A listed file no watch covers that is replaced with its time kept (`cp -p`, an archive extract) or reached through a link retargeted to an older file while a job runs goes unseen, where `readEntryDigest` (`inputs/input-inventory.ts`) takes the later of the link's and the target's times and the change time. It predates this ticket for test modules and now covers env files.
- `inputs/fingerprint.ts` `heldEnvDigest` and `heldDigest` take a held `file` digest reached through a link whose target lies outside the consumer root, which no watch covers, so an edit to that target leaves the digest unchanged. It predates this ticket for every input linked outside the root.
- The whole-file digest is spelled twice: `moduleDigest` (`inputs/fingerprint.ts`) and `contentDigest` (`inputs/env-files.ts`) each run `createHash(DIGEST_ALGORITHM).update(readFileSync(...)).digest(DIGEST_ENCODING)`, beside `textDigest` (`inputs/input-inventory.ts`) for text.
- The "discovered and reporting" filter is spelled three times: `protection` and `reportedProjects` (`inputs/protection.ts`) and `workspaceEnvFiles` (`inputs/env-files.ts`). `reportedProjects` skips an unreported workspace silently where the other two refuse, so `protectedFileChangedSince` relies on the discovery fingerprint refusing first.
- Every listed file the inputs leave out is read whole and synchronously at each composition (`moduleDigest`, `envFileDigest`), so a large one or a slow mount blocks every answer. It predates this ticket for test modules.
- A protected file named from configuration rather than from disk (an env file, from Vite's lowercase names; a setup file, as its config spells it) misses an on-disk spelling in another case on a case-insensitive file system, so a declared pattern can remove `.ENV.local` from the inputs. The fingerprint still reads it afresh, so only the event path is lost.

#### Test Coverage Gaps

Denominator: 46 named-defect tests (D3036 to D3081) in the touched test files, against the seven criteria's behaviors.

| Source                                                                              | Named defect                                                                                                                                                                            | Expected test                                                                                                                                                                                                                                                                                                                                       | Severity                                                                                                                              |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/daemon/src/inputs/env-files.ts` (`envFileDigest`, the stat's `catch`)     | A stat of a listed env path that fails with anything but no entry (EIO, EACCES, ELOOP) digests as nothing there, so its workspace gets a fingerprint without the content Vite may read. | `env-files.test.ts`: make `statSync` throw an EIO-coded error for the file and assert a refusal naming the error (`refusalOf`, as D3060). No test injects a stat failure today.                                                                                                                                                                     | CRITICAL class (a result current against content Vite reads), reach unknown                                                           |
| `packages/daemon/src/inputs/env-files.ts` (`envFileDigest`, the `closeSync`)        | The reader leaves an env file's descriptor open after reading it, so the daemon leaks one descriptor per listed env file per answer until opens fail.                                   | `env-files.test.ts`: assert that no descriptor the reader opened is left unclosed, on a successful read and after D3060's failed read, before `closeLeftOpen` cleans up. `closeLeftOpen` closes leaked descriptors silently, so a dropped `closeSync` passes every test; D3060's defect sentence claims an open descriptor its test cannot observe. | MEDIUM (daemon-state, fails loudly once descriptors run out), reach unknown                                                           |
| `packages/daemon/src/vitest/selection-facts.ts` (`envSource`, `mode: String(mode)`) | A mode a JavaScript config writes as a number is reported as written, so the stored report is refused as unreadable once read back.                                                     | `discover-tests.test.ts`: an inline project in the selection-facts fixture setting a numeric `mode` reports its string form. Also re-anchor D3049, whose `old` was `    mode,\n  };` and is now `    mode: String(mode),\n  };`.                                                                                                                    | MEDIUM (consumer: the discovery cannot be read back), reach unknown                                                                   |
| `packages/daemon/src/inputs/env-files.ts` (`readableKind(fstatSync(descriptor))`)   | The reader's check of the opened handle refuses only a FIFO, so a directory or socket swapped in after the stat refuses the fingerprint where Vite skips it.                            | `env-files.test.ts`: `openedAs("socket")` (or a directory) digests as nothing there.                                                                                                                                                                                                                                                                | LOW (fails toward staleness)                                                                                                          |
| `packages/daemon/src/store/columns.ts` (`envSource`, `envDirectory`)                | A stored env source with no `envDirectory` key reads back as env files turned off, so a malformed record lists no env file instead of being refused.                                    | `store.test.ts`: beside D3039, a stored source with `envDirectory` deleted is refused naming the field.                                                                                                                                                                                                                                             | LOW (unreachable from the store's own writer, which stores `null` explicitly: `store/write-discovery.ts` stringifies the typed facts) |
| `packages/daemon/src/store/columns.ts` (`envSource`, `mode`)                        | A stored env source whose mode is missing or not a string reads back without refusal, so a malformed record names `.env.undefined` files in place of its mode's.                        | `store.test.ts`: a stored source with no `mode` is refused naming the field, as each neighbouring field is (D2261, D2103).                                                                                                                                                                                                                          | LOW (unreachable from the store's own writer)                                                                                         |

Not a gap, for the tests session: in `test/fixtures/daemon/selection-facts/vitest.config.mjs` the new env options sit between existing comments and the lines they describe ("Absolute, so it is resolved through setup-link" now sits above `envDir: false`; "Its Vite root is its own folder" above `mode: "custom"`; "Vitest follows a link only in a relative setup path" above `envPrefix: ["APP_", 7]`). Move each new option below its project's `test` block or give it its own comment.

### Completion Notes

Built by rt-t2-3m-dev, 2026-09-29 16:45 to 17:04, in Tree 1 (wt/1).

- **What was done.** `selection-facts.ts` reports `envSources` per project (own config, then root config). `inputs/env-files.ts` lists each source's four files, a workspace's and a discovery's env files or the unreported workspace, and reads an env file's digest: it stats first and opens only a regular file, without blocking where `O_NONBLOCK` exists, then reads only if the open handle is still a regular file. So no FIFO or device is ever opened except in a swap after the stat, and none is read. `fingerprint.ts` digests the listed env files under an `envFiles` part. It takes a held `file`-kind digest, skipping it when the selected inputs count it, and reads every other listed env file afresh through `SnapshotReads`, which caches env file reads per snapshot. A workspace whose env files are not known gets no fingerprint. `protection.ts` adds each reported project's env files to `protectedFiles` (split into `protectedModules` plus env files). `protectedFileChangedSince` treats a listed env file with nothing there as unchanged, and skips only a path whose held digest the fingerprint takes. `input-inventory.ts` exports `holdsFileContent`. `columns.ts` parses `envSources`; `schema.ts` is at version 8 with version 7's `DROP_INCOMPLETE_FACTS` migration.
- **Assumptions.** None were open. Vite 8.3.1's `getEnvFilesForMode`, `loadEnv`, `tryStatSync` and `resolveEnvPrefix` (`node_modules/.bun/vite@8.3.1+4a7f3e615f259300/node_modules/vite/dist/node/chunks/node.js` 6023 to 6070 and 2232) and the `envDir`/`envPrefix` types (`dist/node/index.d.ts` 3601, 3606, 3793) match the Settled facts. `Vitest.vite` exists in 4.1.11 (a getter) and 5.0.1 (a member).
- **Probes** (`_agent-docs/.scratch/2-3m/`, removed at finalize). Windows, Node 24.19.0, 16:43: `constants.O_NONBLOCK` is undefined, `openSync` on a directory succeeds and `fstat` says directory, a path below a file fails with ENOENT, and `statSync(..., { throwIfNoEntry: false })` returns undefined there. Linux (WSL Ubuntu 24.04, Node 24.13.1), 17:02, with a script mirroring `envFileDigest`, exit 0 inside a 20 s timeout: a file reads; a FIFO and a link to one refuse; a directory, a missing path, a dangling link, a path below a file and a Unix socket count as absent; opening the socket directly fails with ENXIO.
- **Sanity check** (16:45): no findings. **F1** (asked 16:48, ruled by create-ticket 16:49, CONFIRMED and narrowed; widening to `input-inventory.ts` cleared by the orchestrator 16:49): see Dev Notes § Questions and answers.
- **Grouped tasks.** The `selection-facts.ts` task and the `columns.ts`/`schema.ts` task were one typecheck-atomic unit, since the new required member leaves `projectSelectionFacts` uncompilable until it parses it.
- **Adversarial review** (17:01, 8 findings). Fixed: R2 (the change check skipped a held env file the fingerprint reads afresh), R3 and R4 (a socket refused; opening a FIFO releases its writer: now stat first), R5 (a `closeSync` failure threw instead of refusing), R6 (`envPrefix: null` or a non-string prefix), R8a (`ModuleDigests` renamed `PathDigests`). Discarded R7: G1 keeps today's mechanism for those workspaces, not today's digest value, and the schema bump stales every result once as the ticket states. Discarded R8b: `protectedModules` runs twice once per discovery end, linearly. R1 goes to review as a change-request candidate below. Post-fix re-validation: lint and typecheck (the implementer's arm).
- **Mechanism note.** Task 2 describes the reader as opening non-blocking and checking the open handle. It still does both, and now stats first (R3, R4), so the common FIFO case is never opened. Behavior is as AC6 states.
- **Gates** (17:02, over the tree after the review's fixes): `bun x oxlint` over the 7 source files exit 0, no warnings; `bun x prettier --check` over them and this ticket exit 0; `bun run --filter @rt-test/daemon typecheck` exit 1 with only the 4 test-file errors listed above; `node scripts/check-line-citations.mjs` clean. No test run, by the workflow.
- **Doc text.** `docs/architecture.md` and `README.md` are orchestrator-owned under this lane, so their exact text went to the orchestrator in the dev report (17:04) rather than into the files.

#### Change-request candidates

- **R1, CRITICAL (consumer, reach unknown), `daemon/lifecycle.ts` `#protectDiscovered`.** The unwatched-file check (`protectedFileChangedSince(discovery, startedAt)`) runs before `await inputs.protectInputs(...)`, and the discovery's fingerprint is composed after it, in `#bindings`. An edit to a listed file no watch covers (a gitignored env file, test module or setup file) after the check and before the fingerprint's read is caught by neither, so the discovery is stored under a fingerprint of content it never read. The window predates this ticket for test modules; env files widen its reach. Not fixed here: `lifecycle.ts` is ticket 2.3i's file. Suggested fix: run the unwatched check again after the fingerprint is composed (still against `startedAt`), or compose the fingerprint before the check, keeping the existing pre-protection read for files protection moves into the inputs.

### File List

Built by dev-ticket:

- `packages/daemon/src/inputs/env-files.ts` (new)
- `packages/daemon/src/vitest/selection-facts.ts`
- `packages/daemon/src/inputs/fingerprint.ts`
- `packages/daemon/src/inputs/protection.ts`
- `packages/daemon/src/inputs/input-inventory.ts`
- `packages/daemon/src/store/columns.ts`
- `packages/daemon/src/store/schema.ts`
- `_agent-docs/tickets/2-3m-env-files.md` (task and record sections)

Tests, by create-tests:

- `packages/daemon/test/env-files.test.ts` (new)
- `packages/daemon/test/discover-tests.test.ts`
- `packages/daemon/test/input-tracker.test.ts`
- `packages/daemon/test/protection.test.ts`
- `packages/daemon/test/protection-win32.test.ts`
- `packages/daemon/test/store.test.ts`
- `packages/daemon/test/harness.ts`
- `packages/daemon/test/defects.json`
- `packages/daemon/test/selection/defects.json`
- `test/fixtures/daemon/selection-facts/vitest.config.mjs`

Review, by review-changes:

- `packages/daemon/src/vitest/selection-facts.ts`
- `_agent-docs/tickets/2-3m-env-files.md` (record sections)

Orchestrator-owned text, sent in reports: `docs/architecture.md` and `README.md`.

Planning, by create-ticket:

- `_agent-docs/tickets/2-3m-env-files.md` (this ticket)
- `_agent-docs/sprints/sprint-2-fresh-runs.md` (§ Ticket 2.3m's scope line and ticket link; § Ticket 2.3p's scope, G2 and G3)

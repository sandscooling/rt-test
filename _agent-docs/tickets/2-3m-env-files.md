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

- [ ] AC1: For each discovered workspace, the discovery reports, for every project not in browser mode, each env source whose files Vite loads for that project's tests: the project's own config and the workspace's root config. Each source carries its resolved env directory (named as a test module's path is named: root-relative, climbing with `..` outside the root, absolute on another Windows drive), or none when the config turns env files off; its env prefix list, which is `VITE_` alone when the config sets none; and the mode Vite resolved for it, which is `test` for the root config even when that config sets its own `mode`, since Vitest passes one, while a project that sets its own mode reports that mode. This holds under Vitest 4.1 and 5.0.
- [ ] AC2: Each env file a reported source names (`.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local` in its env directory; none for a source with no env directory) is an input of that project's workspace whatever git ignores: creating, editing or deleting one changes that workspace's fingerprint, and the discovery's fingerprint, which counts every env file its discovered workspaces list. An edit to one the inputs leave out, such as one git ignores, changes the fingerprint the next answer composes, though no event reports it.
- [ ] AC3: No `rt-test.json` pattern removes from the inputs an env file the discovery in effect lists.
- [ ] AC4: A discovery during which an env file it lists was created or modified is stored not fingerprinted, and the log names that file. A listed env file that does not exist when the discovery ends does not by itself keep the discovery from being stored under its fingerprint.
- [ ] AC5: A discovered workspace whose env sources are not reported, such as one in a discovery stored before this version, has no fingerprint, and every answer lists it among the unfingerprinted workspaces with a reason saying its env files are not known. The discovery holding it has no fingerprint either, so it is not current, and the daemon rediscovers before it runs any workspace.
- [ ] AC6: An env file whose read could block the daemon (a FIFO) is never read: its workspace, and the discovery listing it, have no fingerprint, and the reason names the file. A path Vite skips because it is neither a file nor a FIFO (a directory) counts as absent, as Vite reads it. An env file that cannot be read leaves no fingerprint, with a reason naming it, as an unreadable test module does.
- [ ] AC7: The store keeps each project's env sources with the discovery across a restart. A store at schema version 7 opens at version 8 with every stored selection-facts report dropped, so each discovered workspace in it reads as not reporting (AC5); stores at versions 1 to 6 still migrate.

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

- [ ] (AC1) In `vitest/selection-facts.ts`, add an exported `EnvSource` type (env directory or `null`, prefix list, mode) and a required `envSources` member on `ProjectSelectionFacts`. Fill it in `projectFacts` with the project's own source from `project.vite.config` and the root config's from `session.instance.vite.config` (the same object as `getRootProject().vite.config` on both lines), always both, own first, even when they name the same directory, since `inputs/env-files.ts` deduplicates the files. Name the env directory through the existing `rootRelative`; map Vite's `false` to `null`; take `envPrefix` as Vite leaves it on the resolved config (unset, a string or a list) and normalize it to a list, defaulting to a named `VITE_` constant.
- [ ] (AC2, AC5, AC6) Create `inputs/env-files.ts`: from a `WorkspaceDiscovery`, the env files its reported projects name (the four file names per source, mirroring Vite's `getEnvFilesForMode`, deduplicated and root-relative), or why they are not known (a discovered workspace whose facts are not reported). A workspace that is not discovered names none. Give it the one reader of an env file's digest, which opens the file without blocking where the platform has FIFOs, checks the open handle's type, and reads only a regular file, from that same handle, so a file swapped for a FIFO between a check and a read is never read: absent, or neither file nor FIFO, digests as absent; a FIFO refuses with a reason and is never read; any other open or read failure refuses with its reason.
- [ ] (AC2, AC5, AC6) In `inputs/fingerprint.ts`, make `workspaceFingerprint` and `discoveryFingerprint` digest each listed env file the selected inputs leave out beside the listed test modules (from the project's held digest when the inputs hold it, otherwise afresh through `SnapshotReads`, which caches env file reads per snapshot as it does modules), under a named part of the digest; return no fingerprint with the reason when env files are not known or one refuses. The discovery fingerprint takes the union over its discovered workspaces.
- [ ] (AC3, AC4) In `inputs/protection.ts`, add every env file `inputs/env-files.ts` lists for the discovery to `protectedFiles`, so protection and the fingerprint read one list. In `inputs/fingerprint.ts`, keep `protectedFileChangedSince` reporting a listed test module, setup file or global setup file it cannot stat as possibly changed, but treat a listed env file that does not exist as unchanged.
- [ ] (AC7) In `store/columns.ts`, parse `envSources` inside `projectSelectionFacts`, accepting `null` or a string env directory, a list of strings and a string mode, and refusing anything else as the other fields do. In `store/schema.ts`, raise `STORE_SCHEMA_VERSION` to 8, name version 7 as the version whose code kept selection facts without env sources, and give it the `DROP_INCOMPLETE_FACTS` migration, as versions 3, 5 and 6 have.
- [ ] (AC1, AC2, AC3, AC4, AC5, AC6) In `docs/architecture.md`'s input tracker paragraph, state that every env file the discovery lists for a workspace is an input of it whatever git ignores, read afresh when the inputs leave it out and protected from every pattern, and add the known limits under Dev Notes § Known limits to its list.
- [ ] (Support) Lint and typecheck.

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
- `projectFacts` in `packages/daemon/test/harness.ts`: the test helper whose defaults every hand-built project in the tracker, protection, query and scheduling tests goes through.

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

For create-tests. The new required member breaks each hand-built `ProjectSelectionFacts` literal (every site spells `viteRoot`, 16:27): `packages/daemon/test/executor.test.ts`, `discover-tests.test.ts`, `harness.ts` (`projectFacts`, whose default covers `input-tracker.test.ts`, `protection.test.ts`, `crawl-links.test.ts`, `query.test.ts` and `scheduling-harness.ts`), `protection-win32.test.ts`, `store.test.ts`, `selection/harness.ts`, `selection/select-tests.test.ts` and `selection/workspace-graph.test.ts`. `discover-tests.test.ts` also compares reported facts from real Vitest, which now carry env sources.

Named-defect anchors this change moves, in `packages/daemon/test/defects.json`: D2792 (`export const STORE_SCHEMA_VERSION = 7;`) certainly; D1899, D2534, D1900 and D2160 in `fingerprint.ts` and D2103, D2259 and D2261 in `columns.ts` if the lines they anchor are edited. Tests are expected to need the selection-facts fixture (`test/fixtures/daemon/selection-facts/vitest.config.mjs`) to set an `envDir` or `envPrefix`; env files themselves match this repository's `.gitignore` (`.env`, `.env.*`), so a test writes them into its temporary copy.

### Pending siblings

- 2.3i (ready-for-dev, building in the main checkout): its production files and test files (`query.test.ts`, `scheduler.test.ts`, `lifecycle.test.ts`, `cli.test.ts`) are disjoint from this ticket's, by § Decisions' placement. It edits `docs/architecture.md`'s query paragraph and § State dimensions; this ticket edits the input tracker paragraph, so the two meet only in one file.
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
  - docs/architecture.md
  - packages/daemon/test/discover-tests.test.ts
  - packages/daemon/test/store.test.ts
  - packages/daemon/test/input-tracker.test.ts
  - packages/daemon/test/protection.test.ts
  - packages/daemon/test/defects.json
  - test/fixtures/daemon/selection-facts/vitest.config.mjs
  - packages/daemon/test/executor.test.ts
  - packages/daemon/test/harness.ts
  - packages/daemon/test/protection-win32.test.ts
  - packages/daemon/test/selection/harness.ts
  - packages/daemon/test/selection/select-tests.test.ts
  - packages/daemon/test/selection/workspace-graph.test.ts
files_to_create:
  - packages/daemon/src/inputs/env-files.ts
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

Planning, by create-ticket:

- `_agent-docs/tickets/2-3m-env-files.md` (this ticket)
- `_agent-docs/sprints/sprint-2-fresh-runs.md` (§ Ticket 2.3m's scope line and ticket link; § Ticket 2.3p's scope, G2 and G3)

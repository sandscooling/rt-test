# Ticket 2.3q: Env files of a nested projects container

## Ticket

As an agent editing a consumer project whose Vitest 5 config nests one `projects` container inside another,
I want a workspace whose tests read a nested container's env files never to read current against an edit to one of them,
so that an edit to a gitignored `.env.local` in a container's env directory cannot leave an old result reading current.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

A **nested projects container** is a config file that a `projects` entry names and that itself declares `projects`, at any depth below the workspace's root config (Dev Notes § Settled facts).

- [ ] AC1: Under Vitest 5, wherever Vitest has recorded its nested projects containers where 5.0 records them (AC4 covers a later minor that has not), and apart from the cases Dev Notes § Known limits names, a discovered workspace in which a nested projects container declares projects has no fingerprint, and neither has the discovery holding it. Every answer lists that workspace among the unfingerprinted workspaces with a reason saying its env files are not known because a nested projects container declares its projects, naming each container's config file. So no result of that workspace reads current after an edit to an env file in a container's env directory, a gitignored `.env.local` included.
- [ ] AC2: A workspace in which no nested projects container declares projects reports its env sources, and keeps its fingerprint, as ticket 2.3m gives them, under Vitest 4.1 and under each Vitest 5 minor RT Test has verified (5.0). That includes a Vitest 5.0 workspace whose projects are config files or directories that declare no `projects`, one beside a nested workspace in the same discovery (whose own fingerprint is gone by AC1), and a Vitest 4.1 workspace whose project config declares `projects`, which 4.1 ignores, running that project's own tests with its own env.
- [ ] AC3: The store keeps, across a restart, a discovery whose projects' env sources are not known, with the reason. A store at schema version 8 opens at version 9 with every stored selection-facts report dropped, so each discovered workspace in it reads as not reporting (ticket 2.3m's AC5) until the next discovery; stores at versions 1 to 7 still migrate.
- [ ] AC4: Under a Vitest 5 minor later than the newest one RT Test has verified (5.0), where Vitest has not recorded nested projects containers where 5.0 records them, a discovered workspace whose root config declares a `projects` entry by path (a config file, a directory or a glob) has no fingerprint, and neither has the discovery holding it; the reason names the missing record and the workspace's Vitest version. Under that minor a workspace whose root config declares only inline projects, or none, keeps its fingerprint as AC2 gives it. Under any Vitest 5 minor, a record present in any shape but a list of paths leaves the workspace with no fingerprint, with a reason naming the record.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None open: every third-party behavior this ticket rests on was read in the installed Vitest 5.0.1 and 4.1.11 source or run in the spike, each recorded with its source under Dev Notes § Settled facts. A Vitest 5 minor later than 5.0.1 is not installed, so where it records container config files is unknowable here; Dev Notes § Known limits holds what that leaves.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (AC1, AC2, AC4) In `vitest/selection-facts.ts`, let a project's `envSources` be either the list it is today or an object holding why its env sources are not known (`{ notKnown: <reason> }`, which keeps every hand-built list assignable), and say so in the member's docblock. In `selectionFacts`, decide once per session, from the resolved root config (`session.instance.config`) and the session's Vitest version (`session.instance.version`, public on both lines), whether the workspace's env sources are known. When not known, report that reason as every reported project's `envSources`; when known, report both sources as today. Name the member and the minor below with constants; the minor's comment says that raising it is the step a Vitest 5 minor upgrade owes, once that minor's source is checked for where it records containers. Vitest 5.0.1 records each container's config file in the untyped `_containerConfigFiles` and leaves it absent when there is none, so read it as `unknown` without a widening cast:
  - On Vitest 4.1, known, whatever the member holds.
  - Present as a list of strings on Vitest 5: not known when non-empty, with a reason naming each listed container config file, named as a test module's path is; known when empty.
  - Present with any other value on Vitest 5: not known, with a reason naming the member.
  - Absent on a Vitest 5 minor at or below a named constant for the newest minor whose container record RT Test verified (0): known.
  - Absent on a later Vitest 5 minor: not known when `session.instance.config.projects` (the definitions as written) holds a string entry, with a reason naming the missing member and the Vitest version; known otherwise.
- [ ] (AC1, AC4) In `inputs/env-files.ts`, make `workspaceEnvFiles` return not known for a discovered workspace any of whose reported projects' env sources are not known, carrying that project's stored reason, apart from the unreported workspace's case; keep the `known` discriminant of `ListedEnvFiles`, which ticket 2.4b's coverage reads. Keep `discoveryEnvFiles` returning the first not-known workspace as it does. Make `projectEnvFiles` list none for a project whose sources are not known, and state in its docblock that its empty list for such a project is safe only because the discovery's fingerprint refuses the workspace before any caller (today `protectedFiles`) acts on it.
- [ ] (AC1, AC4) In `inputs/fingerprint.ts`, make `envFilesUnknown` say the workspace's env files are not known followed by the stored reason for a workspace whose projects carry one, keeping the `ENV_FILES_UNKNOWN` text for an unreported workspace.
- [ ] (AC3) In `store/columns.ts`, parse `envSources` as the list it parses today or the not-known object with its reason string, refusing anything else as the other fields do. In `store/schema.ts`, raise `STORE_SCHEMA_VERSION` to 9, name version 8 as the version whose code never reported env sources as not known, and give it the `DROP_INCOMPLETE_FACTS` migration (`UPDATE discovery_workspaces SET selection_facts = NULL;`, which drops every report), as versions 3 to 7 have; each older entry already ends at `STORE_SCHEMA_VERSION` through `SET_SCHEMA_VERSION`, so versions 1 to 7 reach 9 unchanged.
- [ ] (AC1, AC4) Send the orchestrator exact text for `docs/architecture.md`'s input tracker paragraph (orchestrator-owned under this lane): after "a discovered workspace whose env sources are not reported, such as one in a discovery stored before they were", add a Vitest 5 workspace in which a nested projects container declares projects, and one on an unverified Vitest 5 minor that declares projects by path where Vitest recorded no containers; and in the known limits, replace "a Vitest 5 project that a nested `projects` container declares, whose container's env files are not listed, though Vitest gives its tests the container's env" with the limits under Dev Notes § Known limits.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `EnvSource`, `ProjectSelectionFacts` and `selectionFacts` (`vitest/selection-facts.ts`): the report this ticket narrows; `selectionFacts` already walks the session's projects once.
- `ListedEnvFiles`, `workspaceEnvFiles`, `discoveryEnvFiles` and `projectEnvFiles` (`inputs/env-files.ts`): the one place a workspace's env files become known or not known.
- `envFilesUnknown` and `ENV_FILES_UNKNOWN` (`inputs/fingerprint.ts`): the reason an answer carries in `unfingerprintedWorkspaces`, which needs no answer-side change (ticket 2.3m § Decisions, "No answer-side code").
- `DROP_INCOMPLETE_FACTS` and `SET_SCHEMA_VERSION` (`store/schema.ts`): the migration an incomplete report already gets.
- `jsonArray`, `jsonField` and `jsonText` (`store/columns.ts`): `envSource` already tells a field's kinds apart through `jsonField`.
- `rootRelative`'s naming (`session.locate` and `testModuleFile`, `vitest/selection-facts.ts`): names a container config file as a test module's path is named.
- `projectFacts` in `packages/daemon/test/harness.ts`, for create-tests: its `envSources: facts.envSources ?? []` default passes a not-known object through unchanged once its parameter type allows one.

### Must Create

- The not-known shape of `envSources` and the constants naming Vitest's container record member and the newest verified Vitest 5 minor (`vitest/selection-facts.ts`).
- The stored reason on `ListedEnvFiles`' not-known case (`inputs/env-files.ts`).
- The version 8 constant and its migration entry (`store/schema.ts`).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

### Scope, quoted

Sprint 2's § Ticket 2.3q (orchestrator, 2026-09-29 18:02, on 2.3m's review Q1): "Each such project's env sources also list the declaring container's, or, where the container cannot be learned, the project's env sources are reported as not known, so its workspace has no fingerprint and fails toward staleness, as 2.3m's AC5 does." And: "Authoring first finds how discovery can learn a project's declaring container, since `TestProject` exposes no parent config publicly. Vitest 4.1 copies only the root's env and is unaffected."

Requirements: FR6, "Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current." NFR3, "Never report a result as current unless its stored input fingerprint matches the current inputs." AC3 also rests on FR3, "Persist results bound to project, worktree, run identity, input fingerprint, and adapter version, and keep them available across a daemon restart."

Ticket 2.3m's AC5, the state AC1, AC3 and AC4 give a workspace: "A discovered workspace whose env sources are not reported, such as one in a discovery stored before this version, has no fingerprint, and every answer lists it among the unfingerprinted workspaces with a reason saying its env files are not known. The discovery holding it has no fingerprint either, so it is not current, and the daemon rediscovers before it runs any workspace."

`AGENTS.md` § Product guarantees, which the fallback follows: "Widen selection when dependency information is uncertain."

`store/schema.ts`, `STORE_SCHEMA_VERSION`'s docblock, which AC3's bump follows: "A change to the tables below, or a stored value an older version's code cannot read, raises it and gives each older version in `STORE_MIGRATIONS` a path to it, since the opener refuses every version it cannot migrate."

Glossary (`docs/glossary.md`), verbatim:

- **Input fingerprint**: "A digest of every input, the environment, and the runtime and tool versions that can change a test's result."
- **Freshness**: "Whether a result still describes its test's current inputs."

### Settled facts

Each settled by create-ticket on 2026-09-29 between 18:43 and 18:50, from the installed source under `node_modules/.bun/vitest@5.0.1+2809c141fc59fc1d/node_modules/vitest/dist/` and `node_modules/.bun/vitest@4.1.11+4a7f3e615f259300/node_modules/vitest/dist/`, or from the spike below.

- **What a nested project inherits** (5.0.1 `chunks/index.DzobfTyw.js`). `resolveSingleProjectEntry` (about 12831 to 12887) resolves each inline project that needs its own server and each file project, then runs `for (const key in parentViteConfig.env) projectViteConfig.env[key] ??= parentViteConfig.env[key];` (12864) for every one of them, whatever its `extends`. `parentViteConfig` is the declaring config: the root for a top-level project, and for a container's projects the container's resolved config, since `flattenContainerEntries` (about 12598 to 12640) resolves them with `parentViteConfig: entry.viteConfig`. The container resolved its own env the same way from its parent, so a project two containers deep inherits from both and the root. An inline project that shares its declaring config's server gets that config as its own (`resolveSharedServerEntry`, `viteConfig: parentViteConfig`, about 12824). The worker's env is `{ ...viteConfig?.env, ...config.env }` with `viteConfig` taken from `project.viteConfig` (`serializeConfig`, 9767 to 9858).
- **What a container is.** `flattenContainerEntries` treats as a container every entry that is not inline and whose resolved `projectConfig.projects` is defined, other than the declaring config's own entry; inline projects cannot declare `projects`. It "doesn't run tests itself" and gets no project of its own. A container whose `projects` resolve to none fails the config load (`No projects were found in ...`, 12640), so every recorded container declares at least one project.
- **Nothing public or private names a project's container.** The public `TestProject` (`chunks/plugin.d.CN87HSxv.d.ts` 1014) has `vitest`, `globalConfig`, `config`, `viteConfig`, `vite` and no parent or ancestor member; its internal `_parent` (12227, set in `_spawnSibling` 12330) is a browser or benchmark sibling's primary. An entry's `ancestors` feed only the project filter and the name prefix (`resolveProjectName` 13184 to 13199, `"app (unit)"`). A container's resolved config stays reachable only through closures in its projects' Vite plugins (`WorkspaceVitestPlugin(harness, parentViteConfig)`, 9636) or, when one exists, a project sharing its server. No hook RT Test can pass reaches a container's resolution: root `viteOverrides` lose their plugins (`inheritRootViteOverrides`, 12654), and CLI overrides are data merged into `test` (`TestConfigPlugin`, 9451 onwards).
- **What is recorded.** Each container's config file is pushed to `context.containerConfigFiles` (12626), which `resolveProjectEntries` appends to `globalConfig._containerConfigFiles` only when non-empty (12422 to 12437), appending so `injectTestProjects` containers join; Vitest reads it to watch those files (20561, 20565). It is absent from the `.d.ts`.
- **Vitest 4.1.11 has no containers.** `chunks/cli-api.CnMVyzaz.js` has no container handling; the spike shows a project config's own `projects` ignored.
- **The spike** (`_agent-docs/.scratch/create-ticket/nested-env-spike/`, Node 24.19.0, Windows; `node make.mjs`, then `node spike.mjs vitest` at 18:46 and `node spike.mjs vitest-4` at 18:48, each exit 0; removed at finalize). The consumer: a root config declaring the container `app/vitest.config.mjs` and an inline `top`; `.env` with `VITE_ROOT`; `app` setting `envDir: "envs"` and `envPrefix: ["VITE_", "CONT_"]`, with `app/envs/.env.local` (`VITE_CONTAINER`, `CONT_X`), declaring an inline `inline`, an inline `rooted` with `root: "rooted"`, an inline `noext` with `extends: false`, a file project `file/vitest.config.mjs`, and a second container `inner/vitest.config.mjs` (`envDir: "ienv"`, `ienv/.env` with `VITE_INNER`) declaring an inline `deep` with `root: "deep"`. Driven as `workspace-session.ts` drives it: `createVitest("test", { root, watch: false, api: false, ui: false, config })`, then `start()`. Observed:
  - Vitest 5.0.1: `_containerConfigFiles` held `app/vitest.config.mjs` and `app/inner/vitest.config.mjs`. Every project `app` declares, `noext` and the file project included, saw `VITE_CONTAINER` and `CONT_X` in both `process.env` and `import.meta.env`, though only `inline` lists `app/envs` as its own env directory (`app (inline)` shares the container's server); `app (inner) (deep)` also saw `VITE_INNER`, though its own env directory is `app/inner/deep/ienv`; `top` saw only `VITE_ROOT`. So ticket 2.3m's two sources miss `app/envs` for every nested project but `inline`, and `app/inner/ienv` for `deep`. The container's `CONT_` prefix admitted `CONT_X` for projects whose own prefix is `VITE_` alone, since they inherit the container's loaded values. For each project `project.vite.config === project.viteConfig`.
  - Vitest 4.1.11: `_containerConfigFiles` was unset; `app` ran as one project with env directory `app/envs`, which 2.3m reports as its own source, and no test saw `VITE_INNER`.
- **The field is absent when there is no container** (`flat.mjs` in the same folder, `node flat.mjs vitest` and `node flat.mjs vitest-4` at 18:57, each exit 0). A root declaring `projects: ["pkg/vitest.config.mjs", "dir/", { test: { name: "inl" } }]`, where `pkg`'s config declares no `projects`: on 5.0.1 and 4.1.11 alike, `"_containerConfigFiles" in instance.config` is `false`; `instance.config.projects` holds the definitions as written (`["pkg/vitest.config.mjs","dir/",{"test":{"name":"inl"}}]`); `vitest/node` exports `version` (`5.0.1`, `4.1.11`), and the `Vitest` class declares `readonly version: string` on both lines (5.0.1 `chunks/plugin.d.CN87HSxv.d.ts` 2305, 4.1.11 `chunks/reporters.d.DtoKVV2s.d.ts` 1228).
- **Fleet Cooling is unaffected today**: `C:\source\fleetcooling` pins `vitest` `^4.1.11` and has one flat config per workspace (`apps/admin`, `apps/storefront`, `packages/convex`, `packages/lib`, `packages/ui`; `git ls-files`, 18:48).
- **RT Test accepts every Vitest 5 minor**: `SUPPORTED_VITEST_LINES` is `{ major: 4, minor: 1 }` and `{ major: 5 }` (`vitest/load-vitest.ts`).

### Decisions

- **Not known, rather than listing the container's source** (create-ticket, 18:50). No reference from a project to its declaring container survives resolution (§ Settled facts), so the sprint's fallback applies. Rejected: re-resolving each recorded container file through Vite, which runs the consumer's config code a second time and has to mirror how Vitest resolved the container (the parent's mode, `test.root`, the config loader, plugins that set `envDir`), so a divergence lists the wrong directory and reads current, where the fallback reads stale; instrumenting `fs` while Vitest resolves configs, which cannot attribute a read when resolutions run concurrently (`limitConcurrency`) and patches a shared module; and comparing the env values a project received with its own and the root's, which misses a container with no env file yet, the very case a later `.env.local` creates. A Vitest API naming a project's declaring config would let a later ticket list the container's source instead.
- **Every project of such a workspace, not only the nested ones** (create-ticket, 18:51; only the code differs). Vitest records which containers exist, not which projects they declare, and a fingerprint is per workspace, so a workspace with one nested project has none either way. A top-level project beside a container in the same workspace is reported not known too. A workspace whose every project is in browser mode reports no project to carry the reason, so it keeps a fingerprint; RT Test runs none of its tests (`selectionFacts` and the session skip browser-mode projects), so no result of it can read current (ticket review F3, 19:01).
- **Detection by the recorded member alone** (create-ticket, 19:01, ticket review F9). The version gate (Q2) covers a later minor. Rejected as a cross-check: a root `projects` file entry whose config file no resolved project has, since an inline project extending its container reports the container's file as its own `configFile` (the spike's `app (inline)`, `app (rooted)`), so a container with such a child reads as not a container.
- **A stored reason, not `null`** (create-ticket, 19:00, replacing its 18:53 choice of `null` after Q2's ruling; only the code differs). The answer's reason names a cause only the discovery sees (the recorded container files, or the unverified Vitest version), and it must stay right after a later release raises the verified minor, so it is stored with the facts, as `CrawledLinks` stores its reason. Holding it as the list or a `{ notKnown }` object, rather than wrapping the list, keeps every hand-built `envSources: [...]` literal valid, so create-tests repairs readers only.
- **Schema 9** (AC3). New code stores a not-known object, which version 8's code cannot read, so `STORE_SCHEMA_VERSION`'s docblock (quoted above) raises it. The migration drops every version 8 report, not only the unreadable-to-8 ones, because a version 8 report of a Vitest 5 workspace with a nested container lists only each project's own source and the root's and would read complete; after the upgrade every result reads stale once and a discovery runs before any workspace runs, as ticket 2.3m's upgrade did. The orchestrator named a bump to 9 acceptable in the dispatch (18:42).
- **No answer-side, scheduler, log or protection code.** The reason rides on `unfingerprintedWorkspaces`, and a discovery with no fingerprint is rediscovered before due runs, both existing behavior (ticket 2.3m § Decisions). The log already names it: each discovery and run stored with no fingerprint logs `<job> is stored not fingerprinted: <reason>` (`daemon/lifecycle.ts` `#bindings`), which meets C32 for this fallback: the daemon log has one level, `DaemonLog.entry` (`daemon/daemon-log.ts`). `protectedFiles` names no env file for a not-known project, which changes nothing observable, since the discovery's fingerprint refuses first and `protectedFileChangedSince` relies on that (ticket 2.3m § Tech debt dispositions, "three questions").

#### Questions and answers

Asked by create-ticket at 18:56, decided by the orchestrator at 18:57 within the owner's rule that the fingerprint fails toward staleness.

- **Q1. The fallback, or the container's own source?** The fallback: a Vitest 5 workspace in which Vitest recorded any nested container reports every project's env sources as not known, so it has no fingerprint and reruns at each revision. Slower, but never falsely current, where each rejected alternative (§ Decisions) can read a stale result as current or miss an env file not yet created. The cost is named in § Known limits.
- **Q2. The private field's absence** (ruled 18:57, correction asked 18:58). Ruling: on Vitest 5, when `_containerConfigFiles` is not present as a list, report env sources as not known for a workspace whose root config declares a `projects` entry naming a config file or directory; present and empty means no container. Correction asked by create-ticket at 18:58: 5.0.1 never writes an empty list (§ Settled facts, the `flat.mjs` spike), so absence is its normal no-container state, and the ruling would leave every 5.0.1 workspace declaring file projects unfingerprinted. **Answer (orchestrator, 18:58), superseding the 18:57 wording**: a minor gate. Present as a list of strings: containers when non-empty. Present with any other value: not known. Absent on a verified Vitest 5 minor (a named constant, 0 today): no container. Absent on a later 5 minor: not known for a workspace whose root `config.projects` holds a string entry, with a reason naming the missing field and the unverified Vitest version (AC4). Minor over exact version, because an exact gate makes nearly every Vitest 5 monorepo over-rerun on each patch until verified, while a patch moving a private field is the rarer event and stays a documented limit. Raising the constant is the step a Vitest 5 minor upgrade owes, named in the constant's comment and in § Known limits.
- **Q3. Sizing** (about 16 raw files, 21 estimated, 3 code units at the time): proceed as-is. The extra is tests and a fixture, and a split would cut the store's parsing of the not-known shape from the detection that writes it.
- **Decided by create-ticket, agreed at 18:57**: schema 8 to 9 with `DROP_INCOMPLETE_FACTS`, and `envSources: null`, since replaced by a stored reason (§ Decisions), which Q2's answer requires.
- **Ticket review**, 18:57 to 19:00, over the draft before Q2's answer; triaged by create-ticket at 19:01. Applied: F1 as a settled fact (a container resolving no project fails the load, so "declares projects" and "is recorded" coincide), F2 reworded for the minor gate (AC1 excepts the one remaining known limit), F3 as a scoped decision (a workspace of browser-mode projects only), F4 (the function name left the criteria), F5 (AC2 names the mixed discovery), F6 (task 4 states what the migration drops and why versions 1 to 7 still reach 9), F7 (the docblock's reasoning), F8 (the log's one level), F9 (the version gate answers it; the cross-check it proposed is rejected in § Decisions), F10, F12 (the migration anchors and their fate) and F13 (2.3m's AC5 quoted). Rejected: F11, since no test reads `unreportedWorkspace`. Moot after Q2's answer: the `null` shape the review read. The reviewer's revision over the 19:00 text (19:02) added two, both applied: AC1 is scoped to where Vitest records its containers, since AC4's reason applies on an unverified minor with no record; and a known limit names a container a plugin injects, which `config.projects` never shows.
- **For 2.4b** (orchestrator, 18:57): the orchestrator tells 2.4b's author that a wait on a nested container's env file sees an unreported workspace for as long as the config holds.

### Known limits

For `docs/architecture.md`'s list:

- A Vitest 5 workspace in which a nested projects container declares projects has no fingerprint, so its results never read current, and while it stays so every settled input revision costs a rediscovery and a run of it (ticket 2.3m § Decisions, "A lasting refusal costs one discovery per input revision, never a loop").
- Such a workspace's top-level projects, and one whose nested projects are all in browser mode, are reported not known too, since Vitest records which containers exist, not which projects each declares. A workspace whose every project is in browser mode keeps its fingerprint, since it reports no project to carry the reason; RT Test runs none of its tests.
- On a Vitest 5 minor later than the newest RT Test verified (5.0), a workspace whose root config declares projects by path has no fingerprint while Vitest records no containers where 5.0 does, even when none is nested, until RT Test checks that minor's source and raises its verified minor, the step a Vitest 5 minor upgrade owes.
- Discovery learns of a container from the config files Vitest records on its resolved root config, an internal member; a later patch of a verified minor that records them elsewhere reads as having none, so its nested projects' container env files go unlisted, as before this ticket, and so does a member that keeps its name and shape but changes meaning. On a later minor with no record, the check reads the root's `config.projects` as written, so a container a plugin adds through `injectTestProjects`, or a minor that stops keeping the definitions as written, reads as no container and its env files go unlisted.

### Current structure of the files this ticket changes

- `vitest/selection-facts.ts` (243 lines): `EnvSource` (`envDirectory`, `envPrefixes`, `mode`); `ProjectSelectionFacts.envSources: readonly EnvSource[]`, documented "The project's own config's, then the root config's"; `selectionFacts(session, signal)` loops `session.instance.projects`, skipping `usesBrowserMode`, calling `projectFacts`; `projectFacts` sets `envSources: [envSource(project.vite.config, rootRelative), envSource(session.instance.vite.config, rootRelative)]`.
- `inputs/env-files.ts`: `ListedEnvFiles` is `{ known: true; files } | { known: false; unreportedWorkspace }`; `projectEnvFiles(project)` flat-maps `project.envSources`; `workspaceEnvFiles(entry)` names none for an entry not discovered and returns not known for `!entry.selectionFacts.reported`; `discoveryEnvFiles` returns the first not-known result.
- `inputs/fingerprint.ts`: `ENV_FILES_UNKNOWN = "are not known: its discovery does not report the env sources of its projects"`; `workspaceFingerprint` and `discoveryFingerprint` return `envFilesUnknown(envFiles)` when not known, whose reason is `` `the env files of the workspace ${workspaceName(listed.unreportedWorkspace)} ${ENV_FILES_UNKNOWN}` ``.
- `store/columns.ts`: `projectSelectionFacts` parses `envSources: jsonArray(value, "envSources", envSource)`; `envSource` parses one source.
- `store/schema.ts`: `STORE_SCHEMA_VERSION = 8`; version constants 1 to 7, the last `ENV_SOURCES_UNAWARE_SCHEMA_VERSION = 7`; `STORE_MIGRATIONS` maps 1 to 7, 3 to 7 through `DROP_INCOMPLETE_FACTS`.
- Readers of `envSources` in `packages/daemon/src`, by `rg -n "envSources" packages/ test/` (18:49): `store/columns.ts` and `inputs/env-files.ts` only, besides its producer. `inputs/protection.ts` reaches it through `projectEnvFiles`.

### Test files this change breaks

For create-tests. Widening `envSources` to allow a not-known object breaks each reader that indexes or maps it: `packages/daemon/test/discover-tests.test.ts` (the `facts.envSources[...]` and `facts.envSources` readers in the env source tests) and `packages/daemon/test/store.test.ts` (the `envSources` map and index readers in its env source tests). Hand-built literals stay valid. `packages/daemon/test/harness.ts`'s `projectFacts` types its `envSources` parameter as a list. AC4's unverified-minor branch needs the session's Vitest version faked, since the repository installs only 5.0.1. The schema bump breaks the version pins `store.test.ts` re-pinned at 8 (D1280, D2097, D2846, D2791, D2831, D2859, D2792).

Named-defect anchors this change moves or may move, in `packages/daemon/test/defects.json`: D2792 (`export const STORE_SCHEMA_VERSION = 8;`) certainly; D3038 (`columns.ts`, `envSources: jsonArray(...)`), D3070 (`env-files.ts`, `projectEnvFiles`' return), D3074 (`env-files.ts`, the unreported return) and D3043, D3048, D3050 and D3051 (`selection-facts.ts`, the `envSources` array) if the lines they anchor are edited. The `STORE_MIGRATIONS` anchors (D2260, D2791, D2829, D2830, D2831, D2846, D2859, D3040, D3041) cover the version 3 to 7 entries, which appending a version 8 entry leaves as they are; no anchor names `envFilesUnknown` or `ENV_FILES_UNKNOWN` (`node` over `defects.json`, 19:01). No test reads `ListedEnvFiles`' `unreportedWorkspace` (`rg -n "unreportedWorkspace" packages/daemon/test`, 19:01: `defects.json` only). A test of AC1 and AC2 needs a fixture with a nested container, run under both installs through `linkVitest` (`harness.ts`), and apart from `test/fixtures/daemon/selection-facts`, whose env source tests would read not known under Vitest 5 if it gained a container; env files match this repository's `.gitignore`, so a test writes them into its temporary copy.

### Pending siblings

- 2.3p (backlog, next): reads env files through `inputs/env-files.ts` for events and run judgment. A not-known workspace lists none, so it places none; its workspace has no fingerprint anyway.
- 2.3o (backlog): counts every listed and declared variable by value for "a workspace whose env sources are not reported", which a not-known source list falls under.
- 2.4b (ready-for-dev) reads `workspaceEnvFiles` for a wait's coverage and keys on `known`. This ticket adds a second not-known cause behind the same discriminant, so a wait on a nested container's env file gets whatever 2.4b gives an unreported workspace; 2.4b's author should know a Vitest 5 nested workspace stays not known, not only until the next discovery.
- 2.3i (building its debt round in the main checkout): `scheduler.ts`, `query/summary.ts` and their tests; disjoint from this ticket.
- 2.4, 2.4c and 2.4d name only the `packages/daemon/src` folder or other paragraphs of `docs/architecture.md`; 2.3o names its known limits.

### Previous-ticket intel

Ticket 2.3m (done), from its Completion Notes and Review Record: `envSources` lives on each `ProjectSelectionFacts` to keep the store column an array and the `reported: true` literals untouched; its schema bump to 8 used `DROP_INCOMPLETE_FACTS`; its tests prove each env source through the selection-facts fixture on both installs, with Vitest 5's inline-project inheritance noted in its Tests Record. Ticket 2.3l, the nearest earlier key, is in backlog. Recent commits: 38c2c0d (a declared pattern no longer removes an env file named in another case on Windows), 2.3m's debt round.

### References

- Ticket 2.3m's Review Record, Q1 (review 18:01, orchestrator 18:02): the finding this ticket closes.
- GitHub issues: none open (`node scripts/list-open-issues.mjs`, 18:51).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C8,C12,C14,C19,C21,C30,C32,C34,C38,C39,C46,C48,C53,C55,C57,C113,C117,C144,C149 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P14,P17,P19,P21,P35 -->

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
sizing_ac_count: 4
files_to_modify:
  - packages/daemon/src/vitest/selection-facts.ts
  - packages/daemon/src/inputs/env-files.ts
  - packages/daemon/src/inputs/fingerprint.ts
  - packages/daemon/src/store/columns.ts
  - packages/daemon/src/store/schema.ts
  - docs/architecture.md
  - packages/daemon/test/discover-tests.test.ts
  - packages/daemon/test/store.test.ts
  - packages/daemon/test/env-files.test.ts
  - packages/daemon/test/input-tracker.test.ts
  - packages/daemon/test/harness.ts
  - packages/daemon/test/defects.json
files_to_create:
  - test/fixtures/daemon/nested-projects/
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

- `_agent-docs/tickets/2-3q-nested-container-env.md` (this ticket)
- `_agent-docs/sprints/sprint-2-fresh-runs.md` (§ Ticket 2.3q's scope line and ticket link)
- `_agent-docs/sprint-status.yaml` (2.3q to `ready-for-dev`)

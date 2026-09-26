# Ticket 1.1: Discover tests across Vitest workspaces

## Ticket

As the RT Test daemon (built in ticket 1.3) acting for a started consumer,
I want to find every Vitest workspace of the consumer, load each one's own Vitest 4.1.x or 5.x, and list every test it holds under a stable identity,
so that every later result, selection and defect record names the same test the same way on both Vitest versions and never loses a test it could not load.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: Given a consumer root, RT Test lists the consumer's Vitest workspaces as defined in Dev Notes § Vitest workspace, and reports a root `pnpm-workspace.yaml` and each `workspaces` pattern it cannot expand as not read, reading files only: it executes no project file and loads no Vitest configuration to find them.
- [x] AC2: Each workspace is discovered with the Vitest installed for that workspace. A workspace whose Vitest is 4.1.x or 5.x is discovered; a workspace with no resolvable Vitest, or any other version (a prerelease included), is reported as unsupported with the version found and the supported range, and the other workspaces are still discovered. A Vitest project with browser mode enabled is reported as unsupported, and the other projects of its workspace are still discovered wherever Vitest sets up that workspace's projects; where it cannot (Vitest 5 with no browser provider installed), the workspace is reported as failed to load under AC4.
- [x] AC3: Discovery lists every test of every discovered workspace and each of its Vitest projects, including skipped and todo tests and each arm of a parameterized test or suite (the `.each` and `.for` forms) as its own test, and runs no test body or hook. Typecheck test modules are reported as not discovered, apart from test results, and are never listed as tests.
- [x] AC4: A test module that fails to load during discovery, and a workspace whose configuration fails to load, are each reported with the error, as not discovered. Neither is reported as holding zero tests, and the other modules and workspaces are still discovered.
- [x] AC5: A test's identity (`TestIdentity`, Dev Notes § Test identity) is the same across repeated discoveries, is equal for one test whether discovered under Vitest 4.1 or 5 and on Windows or Linux, and stays the same when a test with a different name path is added, removed or moved elsewhere in its module. Renaming a test, or one of its enclosing suites, gives it a new identity.
- [x] AC6: Tests that share a display name get distinct identities: duplicates in one module, `it.each` arms that format to the same name, and the same module and name in two workspaces or two projects. Each test whose name path occurs more than once in its module is marked as a duplicate.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                                                | Why it matters if wrong                                                                                                                                                                                  | How to check                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| U3  | On 5.0.1, does `collect()` with `staticParse: false` report a `describe.each` arm and a module that throws at load exactly as 4.1.11 does, when the workspace's `test.projects` are inline objects rather than directory names?                                           | AC3 and AC4 would need a version branch.                                                                                                                                                                 | The spike observed it for one root config with `projects: ["a", "b"]`; re-run `probe.mjs` against a fixture whose projects are inline objects.     |
| U7  | Do TypeScript 7.0.2 (`customConditions` under `moduleResolution: NodeNext`) and Vitest 5.0.1's module resolution for tests (`resolve.conditions`, or `ssr.resolve.conditions` for the server-side runner) both honor a custom export condition such as `@rt-test/source`? | Without it, the source condition fixes neither typecheck nor test runs, and the fallback is a `paths` mapping in each dependent's `tsconfig.json` plus a `resolve.alias` in the root `vitest.config.ts`. | Delete `packages/core/dist`, then run `bun run --filter @rt-test/daemon typecheck` and one daemon test importing `@rt-test/core`.                  |
| U6  | With a browser provider installed, how do 4.1.11 and 5.0.1 expose that a project has browser mode enabled, before any browser starts?                                                                                                                                     | AC2's browser rejection needs a signal read before collection, or collection launches a browser.                                                                                                         | Read `TestProject.config.browser.enabled` in each installed `.d.ts`, and check that `createVitest` does not start the provider before `collect()`. |

Resolutions (dev, 2026-09-26; probes under `_agent-docs/.scratch/t1-1-dev/`):

- **U3 CONFIRMED.** Inline-object `test.projects` (`a`, `b`), collected with `staticParse: false`: 4.1.11 and 5.0.1 both listed `suite x > inner`, `suite y > inner`, `arm 1`, `arm 1`, `arm 2`, `for 3`, `for 4`, and both reported `b.test.mjs` `failed` with `Error: collection boom` and no tests (`u3/`). Only the order of `testModules` differed, which the identity does not use. Side effect found: both versions set `process.exitCode = 1` in the host process when a collected module fails (5.0.1 `index.DzobfTyw.js` `collect`, `hasFailed(...)`; 4.1.11 `cli-api.CnMVyzaz.js` `if (state !== "passed") process.exitCode = 1`), so discovery saves and restores `process.exitCode`.
- **U6 CONFIRMED, with a mechanism correction.** With `@vitest/browser-playwright` installed (5.0.1 and 4.1.11, `u6v5/`, `u6v4/`), `createVitest` succeeded and `project.config.browser.enabled` was `true` for the browser project (named `br (chromium)`) on both, typed `ResolvedConfig.browser.enabled: boolean`. `createVitest` launched no browser. Plain `collect(undefined, { staticParse: false })` did: both returned the unhandled error `browserType.launch: Executable doesn't exist ...`. Both versions' `collect` is `getRelevantTestSpecifications(filters)` then `collectTests(specifications)` (4.1.11 `cli-api.CnMVyzaz.js` `async collect`; 5.0.1 `index.DzobfTyw.js` `async collect`), and both methods are public (`Vitest.getRelevantTestSpecifications`, `Vitest.collectTests` in each `.d.ts`). Dropping the specifications whose `project.config.browser.enabled` is `true` and calling `collectTests` launched nothing and returned no unhandled error on either version, with a provider and (4.1.11, `u6v4np/`) without one. So discovery collects that way, the same non-static path `collect` takes, and 4.1's no-provider unhandled error never arises.
- **U7 FALSE as specified, sent to the author.** TypeScript 7.0.2 honors `customConditions: ["@rt-test/source"]`: with no `dist` anywhere, the daemon typechecked (exit 0), and without the condition it failed TS2307. A daemon `tsconfig.build.json` with `customConditions: []` built against core's `dist`. Vitest 5.0.1: `resolve.conditions` did not reach test resolution, `ssr.resolve.conditions` did, and Vite replaces its default server conditions with the given array (`mergeWithDefaultsRecursively` assigns arrays). But a root `ssr` key reached only the inline `tooling` project: the `packages/*` directory project failed with `Failed to resolve entry for package "@rt-test/core"` (`u7/vt-projects.log`). The standard `development` condition, which Vite's default server conditions already hold (`DEFAULT_CONDITIONS$1` includes `development|production`), resolved core's source in both projects with no Vitest config change, typechecked, and built with `customConditions: []` (`u7/vt-dev.log`).

Corrections (review, 2026-09-26, installed source; `I5` is 5.0.1 `dist/chunks/index.DzobfTyw.js`, `C5` its `cli-api.DcLieX4F.js`, `C4` 4.1.11 `dist/chunks/cli-api.CnMVyzaz.js`):

- **U3 exit code.** `collectTests` itself sets `process.exitCode = 1` when a module fails, on both versions (`I5:21186`, `C4:13782`). The sites cited above are `collect`'s static-parse branch (5.0.1) and `TestRun.end` (4.1.11), which discovery never reaches. The save and restore stands.
- **U6 on 5.0.1.** `createVitest` does work for a browser project before any collection: it calls the provider's `serverFactory()` (`I5:7611-7619`), calls its `prewarm` hook (`I5:7680-7693`), and listens on a port even with `api: false` (`I5:7696`, `I5:14228-14233`). Whether `prewarm` spawns a browser is provider code, not installed here. 4.1.11 defers the provider to the browser pool (`C4:11065-11068`). Dropping browser specifications before `collectTests` still keeps the browser pool from starting on both.
- **U7 host `NODE_ENV`.** Programmatic `createVitest` skips the CLI's `NODE_ENV ??= "test"` (`C5:414-416`, `C4:14648-14650`), so Vite writes `development` into the host and workers inherit it. Discovery sets `test` inside its restored host-state window, as a CLI run would.
- **Also observed.** `collectTests` runs the workspace's `globalSetup`, the root project's included (`I5:21178`, `C4:13775`), and a throwing one fails the workspace. While an instance is open, Vitest's logger holds `SIGINT`, `SIGTERM`, `exit` and `unhandledRejection` handlers that exit the process (`I5:14086-14120`, `C4:2050-2085`), removed at `close()`. After a worker crash, a specification gets no module, and its error reaches only `unhandledErrors` (`I5:21180-21182`); discovery now reports such a specification as a failed module.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing.
- [x] (Support) Before building AC3, confirm the orchestrator has written the approved C140 and C125 texts and the two glossary entries (Dev Notes § Rule conflict: C140, § Test identity, § Glossary); stop and report if it has not.
- [x] (Support) Create the `@rt-test/daemon` workspace in `packages/daemon`, with `build` and `typecheck` scripts, its `tsconfig.json` and `tsconfig.build.json` extending `tsconfig.base.json`, and `src/index.ts`, following `packages/core`. Add `@rt-test/core` as a workspace dependency.
- [x] (Support) Make `@rt-test/core` resolve from its source on a clean checkout, per Dev Notes § Workspace dependency resolution: add the `development` condition to `packages/core/package.json`'s export, set `"customConditions": []` in `packages/daemon/tsconfig.build.json`, and send the orchestrator the exact `tsconfig.base.json` text.
- [x] (Support) Ask the orchestrator to add the root devDependency `"vitest-4": "npm:vitest@4.1.11"` with `bun add --exact --dev vitest-4@npm:vitest@4.1.11` and to commit `bun.lock`; the lane edits neither file.
- [x] (AC5, AC6) In `packages/core/src/test-identity.ts`, define `TestIdentity` (workspace path, project name, module path, name path, occurrence index) and a pure function that assigns identities to one module's tests in collection order, returning each with a duplicate mark held beside the identity, never inside it. Export both from `packages/core/src/index.ts`.
- [x] (AC1) In `packages/daemon/src/vitest/find-workspaces.ts`, list the workspaces by Dev Notes § Vitest workspace (a `vitest.config.*`, or a `vite.config.*` with a `vitest` dependency in that directory's `package.json`), and report a root `pnpm-workspace.yaml` as not read. Read the `workspaces` field in both its array and `{ "packages": [...] }` forms; expand a literal directory and a `parent/*` pattern, and report every other pattern (`**`, a negation, a `*` inside a segment) as not read, naming it. Read `package.json` files and directory listings only, and normalize every stored path to `/`.
- [x] (AC2) In `packages/daemon/src/vitest/load-vitest.ts`, resolve `vitest/package.json` and `vitest/node` from each workspace directory, check the version against the supported range, and report an unsupported or missing Vitest with the version found and the range. Hold the supported range as one named constant.
- [x] (AC2, AC3, AC4) In `packages/daemon/src/vitest/discover-tests.ts`, create one Vitest instance per supported workspace with that workspace's Vitest, drop each specification whose project has browser mode enabled, collect the remaining specifications with `collectTests` (the non-static path `collect` takes with `staticParse: false`), walk every project's modules, and return the workspace's tests with their identities, each module and workspace that failed to load with its error, each browser-mode project as unsupported (on 5.x with no provider installed, the project setup failure is the workspace's load failure), each typecheck module (`meta().typecheck === true`) as not discovered, and the unsupported workspaces from `load-vitest.ts`. One workspace's rejection or failure never stops the others. Close every instance it creates, on success and on error.
- [x] (AC5, AC6) Build each `TestIdentity` in `discover-tests.ts` from the workspace path, project name, module path relative to the workspace normalized to `/`, and the name path as the list of suite and test names (never the `>`-joined `fullName`), through the core function; never from Vitest's own test id.
- [x] (Support) Send the orchestrator the `docs/architecture.md` § Current implementation text for the new discovery and identity code, per P21.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `@rt-test/core` (`packages/core/src/index.ts`): the workspace dependency the daemon package takes; `TestIdentity` joins its exports.
- `packages/core/package.json`, `tsconfig.json` and `tsconfig.build.json`: the shape of a workspace package to copy for `@rt-test/daemon` (P2).
- `vitest` 5.0.1 (root devDependency): type-only imports from `vitest/node` (`Vitest`, `TestModule`, `TestCase`, `TestProject`) for typing the loaded instance. Its runtime copy is never the one discovery runs.
- `node:module` `createRequire`: resolves `vitest/node` and `vitest/package.json` from a workspace directory (spike: it resolved 4.1.11 under `v41/` and 5.0.1 under the repository from the same script). `scripts/lib/defects/vitest.mjs` `vitestEntry()` already resolves `vitest/package.json` this way for the repository's own Vitest.
- `scripts/lib/standards/workspace-scripts.mjs` (`patternsOf`, `expand`): the repository's reader of the root `workspaces` field, accepting the array and `{ "packages": [...] }` forms, expanding a literal directory and `parent/*`, and rejecting any other pattern by name. Product code cannot import repository tooling (P1, P11), so `find-workspaces.ts` follows the same pattern rules rather than importing it (C5). The two agree on both field forms, literal directories, `parent/*`, and rejecting `**` and an in-segment `*`. They differ on a negation: `expand` treats `!x` as a literal directory, finds no `package.json` and returns `[]` silently, while `find-workspaces.ts` reports it as not read, per its task. The repository reader's silent drop is outside this ticket; dev records it as a change-request candidate.

### Must Create

- `packages/core/src/test-identity.ts`: `TestIdentity` and the identity assignment function. `rg -n "interface Test|type Test[A-Z]" packages scripts lint --glob '*.{ts,mts,d.mts}'` found only `TestOutcome` and `TestEvidence` in `packages/core/src/evidence.ts`, neither of which names a test.
- `packages/daemon/` (package, `src/index.ts`, `src/vitest/find-workspaces.ts`, `src/vitest/load-vitest.ts`, `src/vitest/discover-tests.ts`): no daemon package exists yet.
- The supported Vitest range constant, in `load-vitest.ts`, its one reader.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

`packages/core` is the only product code: `packages/core/src/evidence.ts` assesses a result against a caller-supplied fingerprint (`TestOutcome` is `"passed" | "failed" | "skipped" | "error"`). No daemon, store, runner integration or workspace exists yet. This ticket creates `@rt-test/daemon` because P32 names the daemon package as the only place Vitest's node API may be used, and its lint-hardening candidate bans `vitest/node` imports outside it. Ticket 1.3 adds the lifecycle to the same package.

Pending siblings and their routing:

- **1.1b** (backlog) runs a workspace and records outcomes, skips, module and run-level errors and interruption on the identities this ticket defines. It reuses `load-vitest.ts` and the identity function; nothing here records an outcome.
- **1.2** (backlog) persists results and raises the Node floor to `^22.13.0` in `package.json`. This ticket writes nothing to disk.
- **1.3** (backlog) owns the explicit start of a trusted project. Discovery executes project code (it loads Vitest configurations and imports test modules), so the only caller of `discover-tests.ts` must be the daemon after that start. Until 1.3 lands the module has no caller outside tests. Workspace finding (AC1) reads files only and may run before a start.

Two recorded rule deviations follow from that sequencing. The owner accepted the C59 gap when answering the sequencing question (§ Grill record); the C32 log gap is this ticket's own call on the same sequencing:

- **C59** ("Every export has a production consumer. A reference from test code ... is not a consumer"): the exports of `discover-tests.ts`, `find-workspaces.ts`, `load-vitest.ts` and the daemon's `src/index.ts` have no production consumer until 1.3 (and 1.1b, for `load-vitest.ts` and the identity function).
- **C32** ("A truncated, partial or fallback result is reported at warning level or stronger and says what was dropped, to the caller and to the log alike"): discovery returns every partial item to the caller (an unread `pnpm-workspace.yaml` or workspace pattern, an unsupported workspace or project, a module or workspace that failed to load, an undiscovered typecheck module), naming what was dropped. No daemon log exists until 1.3, which writes these reports to its log.
- **1.4** (backlog) answers queries; it reads what 1.2 stores.

`node scripts/list-unbuilt-work.mjs` over the target files found no other unbuilt ticket naming them. It matches the root `package.json` by its bare name wherever no folder `/` precedes it.

#### Vitest workspace

A Vitest workspace is one directory RT Test runs as its own Vitest instance. The candidates are the consumer root and each directory the root `package.json` `workspaces` globs match. A candidate is a workspace when it holds a `vitest.config.*` file, or holds a `vite.config.*` file while its `package.json` lists `vitest` in `dependencies` or `devDependencies`. A Vitest configuration's `test.projects` are projects inside its workspace, not workspaces of their own.

- A test file that a root configuration and a package's own configuration both cover is discovered in both workspaces, under two identities, as running each configuration would. Neither copy is dropped.
- A `pnpm-workspace.yaml` at the consumer root is not read: discovery reports that it exists and its packages were not searched, so no workspace goes missing without a report.
- A candidate whose `package.json` lists `vitest` in `dependencies` or `devDependencies` but that holds neither a `vitest.config.*` nor a `vite.config.*` file is not a workspace. Discovery reports it as not read, so its absence is visible.

Fleet Cooling, the proving ground, has no root Vitest configuration and package workspaces with their own `vitest.config.mts` (`apps/admin`, `apps/storefront`, `packages/convex`, `packages/lib`, `packages/ui`), with root `workspaces` `["apps/*", "packages/*"]`, each pinning `vitest ^4.1.11`. This repository has one root configuration with `test.projects`.

#### Grill record

The owner answered in lane t1-1's create thread (threadId c4c8a111-6f33-474b-aa41-96a79fc97c27), 2026-09-26, between 03:05 and 03:22 -0400:

- Sizing: 1.1 at about 31 raw / 40 estimated files. Answer: split by requirement into 1.1 (FR1) and 1.1b (FR2). After the split, 1.1 was about 27 raw / 35 estimated with 7 code units. Answer: proceed as-is.
- Novelty (first use of Vitest's programmatic API, a new devDependency). Answer: proceed on the spike's facts.
- Overlap: a file covered by a root and a package configuration. Answer: discover it under both.
- A `vite.config.*`-only directory. Answer: a workspace when its `package.json` depends on `vitest`.
- `pnpm-workspace.yaml`. Answer: report it as not read.
- An unsupported or missing Vitest. Answer: reject that workspace only; the others are still discovered.
- Telling same-named tests apart. Answer: occurrence index plus a duplicate mark.
- C125 rewrite (§ Test identity). Answer: approved.
- C140 scoping (§ Rule conflict: C140). Answer: approved.
- Sequencing: discovery has no production caller until 1.3. Answer: accept, recorded here and under 1.3's sprint heading.
- Glossary entries (§ Glossary). Answer: approved.
- Browser-mode and typecheck projects, raised by the ticket review, 2026-09-26 at about 03:35 -0400. The owner first asked whether it could be spiked; the spike (§ Spike facts) settled typecheck and browser mode without a provider, and not browser mode with one. Answer: exclude typecheck modules as not discovered, and reject browser-mode projects as unsupported.
- Browser project in a multi-project workspace on 5.x, raised by the dev sanity check (F1), 2026-09-26 at about 03:45 -0400. Asked whether to report the workspace as failed or to spike a project filter; the owner chose the spike, which showed no filter form avoids the throw. Answer: on 5.x with no provider, report the workspace as failed to load (AC4); elsewhere reject only the browser project.
- `@rt-test/core` resolution on a clean checkout (dev sanity check F2). Ruled by create, since it changes no shipped behavior: in scope for 1.1, which adds the first cross-workspace dependency, through a source export condition (§ Workspace dependency resolution).
- A directory that depends on Vitest but holds no config file, raised by dev as a decision fork after the adversarial review, 2026-09-26. Owner, 04:06 -0400, relayed by the orchestrator: keep the workspace definition, and report such a directory as a not-read entry instead of skipping it silently.

#### Test identity

Vitest's own `TestCase.id` cannot serve. Its docblock says "The ID is based on the project name, module url and test order" (`vitest/dist/chunks/plugin.d.CN87HSxv.d.ts`, `ReportedTaskImplementation.id`), and `calculateSuiteHash` in `vitest/dist/task-utils.js` sets ``t.id = `${parent.id}_${idx}` ``, a positional index, so inserting a test shifts every later id. The spike also saw 4.1.11 and 5.0.1 give different ids to the same file in the same directory (`-1526580954_0` against `1466878106_0` for `fixture-noname/n.test.mjs`, project `""`).

The identity is:

- the workspace directory relative to the consumer root, `/`-separated, `.` for the root;
- the Vitest project name (`""` when the configuration sets none, as Fleet Cooling's do; observed on both versions);
- the module path relative to the workspace directory, `/`-separated;
- the name path: each enclosing suite's name, then the test's name, as Vitest formats them;
- the occurrence index: how many earlier tests in the same module share that name path, in collection order.

A test whose name path occurs more than once in its module is marked duplicate, so a later reader (M2's defect attribution) can refuse to attribute to it. Inserting a same-named test above existing duplicates shifts their occurrence indexes. That edit changes the module, so from Sprint 2 every result in it is stale regardless, and a uniquely named test never shifts. In Sprint 1 no result is ever current: the sprint objective reads "Nothing runs on edits yet and no input is fingerprinted, so every result's freshness is honestly unknown", so a shifted duplicate's stored result cannot be shown as current before Sprint 2 either. Requirement FR1: "give each a stable identity that distinguishes parameterized arms and duplicate display names."

C125 as approved by the owner, sent to the orchestrator to write: "C125. **Keep test identity stable and distinct**: A test's identity does not depend only on its display name, and each parameterized arm has its own identity. A renamed test never inherits another test's result. A test told apart from same-named tests only by its position is marked duplicate, and never inherits another test's result as current."

#### Spike facts (observed on Vitest 4.1.11 and 5.0.1)

Run with `_agent-docs/.scratch/create-ticket/spike/probe.mjs <vitest/dist/node.js> <root> <collect|run|cancel>`, which calls `createVitest("test", { root, watch: false, reporters: [reporter] })`, over a fixture with a root `test.projects: ["a", "b"]` config, 4.1.11 installed with npm under `spike/v41/`:

- `createVitest(mode, options)` exists on both; 5.0.1 adds an overload without `mode`. Both expose `collect(filters?, { staticParse?, staticParseConcurrency? })`, `projects`, `close()`.
- **`collect()` differs by default.** 4.1.11 imports each test file: `it.each([1, 1, 2])("arm %i")` lists `arm 1`, `arm 1`, `arm 2`; a module that throws at load is `failed` with `Error: collection boom`; a project whose setup file throws has its module `failed` with `Error: setup boom`. 5.0.1 parses statically by default (`index.DzobfTyw.js`: `if (options.staticParse !== false)`): the same `it.each` is one test named `arm %i` with id suffix `-dynamic`, `describe.each` is one suite `suite %s`, and neither load error appears. With `collect(undefined, { staticParse: false })`, 5.0.1 matched 4.1.11 test for test and error for error.
- Each arm and each duplicate is its own `TestCase`: `group > same name` appeared three times (two in one `describe("group")`, one in a second `describe("group")`), with only positional ids to tell them apart. `fullName` joins names with `>`; `name` is the test's own name and the suite chain is reachable through `parent`.
- `TestCase.options.mode` is `skip` for `it.skip`, `todo` for `it.todo`, `run` otherwise; `result().state` is `skipped` for both at collection. `location` is `undefined` unless configured, so the identity must not use it.
- Both versions resolve per directory: `createRequire(<dir>/package.json).resolve("vitest/node")` returned 4.1.11's `dist/node.js` under `v41/` and 5.0.1's under the repository. 4.1.11's `exports["./node"]` is `{"types":"./dist/node.d.ts","default":"./dist/node.js"}`, with `engines.node` `^20.0.0 || ^22.0.0 || >=24.0.0`.
- The 4.1.11 runner ran a `globals: true` fixture with no `import "vitest"` inside this repository, where `vitest` resolves to 5.0.1, with the same events as 5.0.1, so one fixture set can serve both versions if its test files use globals.
- Bun installs both versions in one package: in a scratch package holding `vitest` 5.0.1 and a copy of this repository's `bunfig.toml`, `bun add --exact --dev vitest-4@npm:vitest@4.1.11` exited 0 and wrote `"vitest-4": "npm:vitest@4.1.11"`, with `node_modules/vitest` at 5.0.1 and `node_modules/vitest-4` at 4.1.11. The probe loaded `node_modules/vitest-4/dist/node.js` and ran the `globals: true` fixture as 4.1.11 with the same events. The product resolves `vitest` by that name from a workspace directory (AC2), so a test that drives 4.1 through the product must make `vitest` resolve to the aliased install from its fixture workspace, for example with a `node_modules/vitest` directory link in a temporary workspace. That link is not yet exercised.
- **Collection runs no test body or hook.** A fixture whose `beforeAll`, `beforeEach`, test bodies, an `it.for` arm and a `describe.for` arm each write a marker file was collected with `staticParse: false` on both versions: no marker was written, and both listed `body`, `for arm 1` and `dfor s > inner`.
- Both versions export `./package.json` (`exports["./package.json"]` is `"./package.json"` in 4.1.11 and 5.0.1), so `vitest/package.json` resolves.
- **Typecheck modules are marked.** A project with `typecheck: { enabled: true, include: ["*.test-d.ts"] }` collected with `staticParse: false` listed the `test-d` module and its test beside the runtime module, on both versions. The typecheck module's `meta()` is `{"typecheck":true}` and the runtime module's is `{}`, on both.
- **Browser mode without a provider fails the whole workspace on 5.0.1.** A single-project configuration with `browser: { enabled: true, instances: [{ browser: "chromium" }] }` and no provider installed made `createVitest` throw `Browser Mode was enabled, but provider was not specified anywhere` (`index.DzobfTyw.js`). With two inline projects, one plain (`node`) and one browser (`br`), 5.0.1's `createVitest` threw `AggregateError: Failed to initialize projects` with that cause, so the `node` project is never discovered (dev's probe, `_agent-docs/.scratch/t1-1-dev/br-mixed/probe2.mjs`). The `project` filter does not avoid it: with `project` unset, `["node"]`, `["!br"]` and `["!br*"]`, 5.0.1 threw the same error every time (`spike/filter-probe.mjs`), since every project is set up before filtering. Passing `browser: { enabled: false }` to `createVitest` avoids the throw but sets `config.browser.enabled === false` on every project and collects browser tests under Node, so it erases the signal AC2 needs. On 4.1.11 the same two-project configuration set up both projects (`node` and `br (chromium)`, the instance suffix in the name), `br`'s `config.browser.enabled` was `true`, `node`'s module was collected, and a plain `collect()` returned the unhandled error `Provider was not specified in the browser.provider setting`. U6's resolution (beneath the Unverified Assumptions table) shows that a plain `collect()` launches the browser once a provider is installed, and that dropping browser-mode specifications before `collectTests` launches nothing and raises no unhandled error on either version.

These facts rest on `vitest` 5.0.1 (root devDependency) and on Fleet Cooling's `vitest ^4.1.11`; no unbuilt ticket changes either: 1.2 edits the root `package.json` only to raise the Node floor, per its sprint entry.

#### Rule conflict: C140

C140's first sentence, "No code path runs a project's tests, loads its Vitest config or imports its files unless that project was explicitly started and trusted", permits discovery after a start. Its last sentence, "Discovery reads files without executing them", read literally forbids AC3: static parsing cannot enumerate `it.each` arms (spike, above), and every Vitest discovery loads the configuration. The sentence guards the time before a start (AGENTS.md: "do not auto-execute discovered repositories"). The owner approved scoping it: "Before that start, discovery reads files without executing them." The orchestrator, which owns the checklist, writes it (`_agent-docs/rules/blocking-rule.md`). AC1's workspace finding is discovery before a start and reads files only; AC3's test discovery runs only after 1.3's start.

#### Fixtures

- Every file under root `test/**` falls under `.oxlintrc.json`'s override, which sets `vitest/no-disabled-tests` to `error`, so a fixture holding `it.skip` or `it.todo` there fails lint whatever its name. The `packages/*` Vitest project uses Vitest's default include inside each package, so a `*.test.mjs` fixture under `packages/daemon/` would run as a real test. P27 reads "Put fixtures under `test/fixtures/`", and AC3 needs skipped and todo fixture tests, so keep P27's placement and narrow the ban instead: create-tests asks the orchestrator, which owns `.oxlintrc.json`, to exclude `test/fixtures/**` from that override's `vitest/no-disabled-tests`, since a fixture's disabled test is the input under test, not a disabled repository test. Name fixture test files outside the root `vitest.config.ts` `tooling` project's `test/**/*.test.ts` include (for example `*.test.mjs`), with the fixture's own configuration including them. Moving the fixtures outside `test/**` instead would depart from P27, and this ticket does not take that route.
- Fixture test files that use `globals: true` and never import `vitest` serve 4.1.11 and 5.0.1 alike (spike, above).

#### Glossary

"Consumer": "A project whose tests RT Test runs." The owner approved two new entries for `docs/glossary.md` § Results and runs, which the orchestrator writes:

- **Vitest workspace**: "One directory RT Test runs as its own Vitest instance: the consumer root or a package workspace that holds a Vitest configuration." _Avoid_: project, package.
- **Test identity**: "The stable name RT Test gives one test: its Vitest workspace, Vitest project, module path, suite and test names, and its position among tests sharing those names." _Avoid_: test id, test name.

"Project" means a `test.projects` entry inside a Vitest workspace, and "test id" means Vitest's own positional id, which this ticket does not use.

#### Previous ticket

None: 1.1 is the first ticket of sprint 1, and `packages/core` is the starter's freshness core.

#### Existing tests this change breaks

None expected. `rg -l "core/src/index|packages/\*|readdirSync\([^)]*packages|package\.json" test packages scripts lint` lists the readers of the export list, the workspace list and `package.json`:

- `test/scripts/standards/workspace-scripts.test.ts` builds its own throwaway trees.
- `scripts/lib/standards/workspace-scripts.mjs` runs over the real repository at `bun run typecheck` and fails on a workspace without `build` and `typecheck` scripts, which the package task gives `@rt-test/daemon`.
- `scripts/lib/defects/changed.mjs` treats the root `package.json` and `bun.lock` as root inputs, so the orchestrator's devDependency edit widens the next defect run rather than breaking a test.
- `scripts/lib/defects/vitest.mjs` resolves the repository's own `vitest`, which the `vitest-4` alias leaves at 5.0.1.
- `test/lint/no-nonlocal-comment.test.ts` resolves `oxlint/package.json`, and `scripts/lib/orchestration/paths.mjs` lists the root `package.json` as an orchestrator-owned path; neither reads the workspace list.

The root `vitest.config.ts` picks up `packages/daemon` through its `packages/*` project glob.

#### Workspace dependency resolution

`@rt-test/daemon` is the first workspace to depend on another. `packages/core/package.json` exports only `"types": "./dist/index.d.ts"` and `"default": "./dist/index.js"`, while `dist/` is gitignored (`.gitignore`: `dist/`), the root `check` script runs `typecheck` and `test:run` before `build`, CI runs `bun install --frozen-lockfile` then `bun run check` on a fresh checkout, and `scripts/lib/defects/catalog.mjs` skips `dist` (`SKIPPED_DIRS`). On a clean checkout the daemon's typecheck and every daemon test importing core would fail; they pass locally only because a stale `packages/core/dist` exists.

Resolve the source during development and keep `dist` for the build:

- `packages/core/package.json` export `"."` gains `"development": "./src/index.ts"` as its first condition.
- `tsconfig.base.json` gains `"customConditions": ["development"]` (orchestrator-owned).
- Each `tsconfig.build.json` of a dependent package sets `"customConditions": []`, so its build compiles against `dist` and keeps core's source outside its `rootDir`. Core's own build imports no workspace and needs none.
- The root `vitest.config.ts` needs no change: Vite's default server conditions already hold `development` (U7's resolution).

The standard `development` condition replaces a custom `@rt-test/source` one because a root `ssr.resolve.conditions` reached only the inline `tooling` project, not the `packages/*` directory project (U7). A Vitest run under `NODE_ENV=production` resolves core's `dist` instead of its source; plain `node` without `--conditions=development` resolves `dist`, as a built daemon should. This adds `packages/core/package.json` to the files to modify and one orchestrator-owned edit.

### References

- FR1 (`docs/requirements.md`): "Discover every test in each Vitest workspace of a consumer on Vitest 4.1.x and 5.x, and give each a stable identity that distinguishes parameterized arms and duplicate display names."
- FR4 (sibling 1.3): "execute no project code before that start."
- `docs/architecture.md` § Identity and freshness: "Distinguish Vitest workspaces, parameterized test cases, duplicate display names, file paths, and run identities." § Dependency index: "Stable test IDs must not depend only on a mutable display name."
- ADR-0002 (daemon is the sole executor); P32, P35, P13, P10, P20; C125, C140.
- `docs/roadmap.md` § M1 acceptance: "Reject unsupported versions with an actionable message."
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete`.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C12,C14,C22,C28,C30,C32,C48,C59,C125,C131,C140 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P1,P2,P3,P7,P9,P10,P11,P13,P14,P16,P17,P18,P20,P21,P27,P32,P35 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test).
-->

```yaml
area: packages/core, packages/daemon
is_consolidation: false
sizing_ac_count: 7
files_to_modify:
  - packages/core/src/index.ts
  - packages/core/package.json
files_to_create:
  - packages/core/src/test-identity.ts
  - packages/daemon/package.json
  - packages/daemon/tsconfig.json
  - packages/daemon/tsconfig.build.json
  - packages/daemon/src/index.ts
  - packages/daemon/src/vitest/find-workspaces.ts
  - packages/daemon/src/vitest/load-vitest.ts
  - packages/daemon/src/vitest/discover-tests.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 90e3f55b-6862-4d07-9ed5-94735ce52088

#### Test Files This Change Broke

None. No existing test imports the changed exports. The root `vitest.config.ts` `packages/*` project now also picks up `packages/daemon`, which holds no test file yet.

#### ACs Owed a Test

- AC5: a test's identity is equal on Windows and Linux, and stays the same when a test with a different name path is added, removed or moved in its module, while a rename gives a new identity. Observed on Windows only: repeat runs and 4.1.11 against 5.0.1 gave identical identities for 16 tests (`_agent-docs/.scratch/t1-1-dev/`, `i4`, `i4b`, `i5`). The Linux half needs CI, and the edit-stability half is traced in `identifyModuleTests` but never observed.

#### Tests Owed

- **Blocker for daemon named defects:** `bun run test:defects` cannot resolve `@rt-test/core` from a daemon test. Bun links workspace dependencies per workspace (`packages/daemon/node_modules/@rt-test/core -> ../../../core`; the root has no `node_modules/@rt-test`), and the defect sandbox (`_agent-docs/.scratch/defects-*`, `scripts/lib/defects/verify.mjs` `scratch`) copies `packages/` without `node_modules` (`catalog.mjs` `SKIPPED_DIRS`). `require.resolve("@rt-test/core")` from a sandbox-shaped path gave `MODULE_NOT_FOUND`. A daemon `D###` test importing daemon source therefore fails its baseline. `scripts/lib/defects/` belongs to another lane, so the orchestrator routes the fix. Core's own tests import by relative path and are unaffected.
- Fixture needs, all observed in the scratch consumer: a 4.1 workspace needs a real `vitest` 4.1.11 under its own `node_modules` (the root `vitest-4` alias is not named `vitest`, so a fixture must link or copy it); a fake unsupported Vitest is a `node_modules/vitest/package.json` with `version` and `exports["./package.json"]`; a `pnpm-workspace.yaml`, `**`, negation and in-segment `*` pattern each produce a `notRead` entry, as does a candidate that depends on Vitest with no Vitest or Vite config file (owner ruling, 04:06 -0400).
- Guarantees worth a named defect: `process.exitCode` and `process.env` are restored after discovery (a module that fails to collect sets the exit code; a `define` of `process.env.X` writes the env); a browser-mode project's files never reach `collectTests` (with a provider installed, plain `collect` launches the browser); a failed module lists no tests; an `AggregateError` and a serialized `{ message }` error keep their text through `errorText`; `SUPPORTED_VITEST_LINES` rejects `5.1.0-beta.1` and `3.2.4` and accepts `4.1.11` and `5.0.1`.

### Tests Record

Tests session: threadId ff94f907-794d-46af-9ee1-c155c2938e1b

Discovery tests run the real `discoverTests` inside a Vitest 5 worker against a temporary copy of a fixture under `test/fixtures/daemon/` (`consumer`, `single`, `stray`, `crash`, `nodeenv`, or `consumer/packages/envdef`), whose `node_modules/vitest` is a directory link to the root `vitest` (5.0.1) or `vitest-4` (4.1.11) install (`packages/daemon/test/harness.ts`). Every record was proven by applying its exact `old`/`new` in memory through a Vite transform plugin (no file written), requiring only the named test to run and fail with an `AssertionError`, then a passing restored baseline; `bun run test:defects` is the gate over the final tree.

#### Named Defects

- D1000: Same-named tests in one module all get occurrence 0, so their identities collide. (AC6)
- D1001: A uniquely named test is marked duplicate. (AC6)
- D1002: Only the later copies of a repeated name path are marked duplicate, so the first copy reads as unique. (AC6)
- D1003: Name paths are keyed by their joined text, so ["a b", "c"] and ["a", "b c"] count as the same test. (AC6)
- D1004: The occurrence index counts earlier tests of any name, so adding, removing or moving another test shifts the identity. (AC5)
- D1005: The identity keeps only the test's own name, so renaming an enclosing suite keeps the old identity. (AC5)
- D1010: An aggregate error loses its members, so a browser project's setup failure reads only as "Failed to initialize projects". (AC2, AC4)
- D1011: A serialized worker error is printed as JSON instead of its message. (AC4)
- D1012: An error's cause is dropped, so a wrapped configuration failure loses the consumer's own message. (AC4)
- D1013: A cause chain that loops back is formatted round the loop until the depth ceiling instead of once. (AC4; the test pins the exact text, since the ceiling stops the overflow)
- D1020: A prerelease of a supported line is accepted as that line. (AC2)
- D1021: Any 4.x minor is accepted, not only 4.1. (AC2)
- D1022: A major below a supported line is accepted. (AC2)
- D1023: A major above a supported line is accepted. (AC2)
- D1024: Vitest is resolved from the daemon's own location, so a 4.1 workspace is discovered with the daemon's Vitest. (AC2)
- D1025: The 5.x line is limited to one minor, so 5.0 is rejected. (AC2)
- D1026: A workspace with no resolvable Vitest throws instead of being reported unsupported. (AC2)
- D1028: A Vitest whose vitest/node entry does not resolve throws out of resolution instead of reporting the workspace unsupported. (AC2)
- D1030: A vitest.config file does not make its directory a workspace. (AC1)
- D1031: A vitest devDependency is not read, so a vite.config package testing with Vitest is missed. (AC1)
- D1032: A vitest dependency is not read, so a vite.config package listing Vitest in dependencies is missed. (AC1)
- D1033: Any vite.config directory is taken for a Vitest workspace, whatever its dependencies. (AC1)
- D1034: A directory depending on Vitest with no config file vanishes without a report. (AC1, owner's ruling of 04:06)
- D1036: A root pnpm-workspace.yaml is ignored silently, so its packages go missing without a report. (AC1)
- D1037: A pattern with a wildcard beyond parent/\* is dropped silently. (AC1)
- D1038: A negation pattern is treated as a literal directory and dropped silently. (AC1)
- D1039: A literal directory pattern is never searched. (AC1)
- D1040: The { packages: [...] } form of workspaces is not read. (AC1)
- D1041: The consumer root's workspace path is empty instead of ".". (AC1, AC5)
- D1042: Workspace paths keep the platform separator, so Windows and Linux store different paths. (AC5; `posix-path.test.ts` runs `relativePosixPath` under a `node:path` mocked to `path.win32`, so the mutation is observable on Linux too, G4)
- D1043: An unreadable package.json beside a vite.config is skipped silently. (AC1)
- D1044: An unreadable root package.json is skipped silently, so no workspace pattern is searched and none is reported. (AC1)
- D1045: A workspaces field that is neither an array nor { packages } is not reported. (AC1)
- D1050: Discovery collects with Vitest's default collect, which on 5.x parses statically and lists a parameterized test as one unformatted test. (AC3)
- D1051: Only a module's top-level tests are listed, so every test inside a suite is lost. (AC3, on 4.1)
- D1052: Only tests pending a run are listed, so skipped and todo tests are dropped. (AC3)
- D1053: Every test is reported with mode run, so a skipped or todo test reads as one that will run. (AC3, on 4.1)
- D1054: Discovery runs the tests it lists on Vitest 5, executing test bodies and hooks. (AC3)
- D1055: Discovery runs the tests it lists on Vitest 4.1, executing test bodies and hooks. (AC3)
- D1056: A typecheck module's tests are listed as tests beside being reported as not discovered. (AC3)
- D1057: A module with one load error reads as a module holding zero tests. (AC4)
- D1058: A failed module is reported without its errors. (AC4, on 4.1)
- D1059: A workspace whose configuration fails to load is reported without its error. (AC4)
- D1060: One workspace's load failure aborts discovery of every other workspace. (AC2, AC4)
- D1061: A workspace on an unsupported Vitest is loaded anyway instead of being reported unsupported with its version. (AC2)
- D1062: A browser-mode project is dropped without being reported unsupported. (AC2, on 4.1)
- D1063: A browser-mode project's modules are collected, which launches or fails to launch a browser. (AC2, on 4.1)
- D1064: A 5.x workspace failing on a browser project without a provider is reported only as "Failed to initialize projects", hiding the cause. (AC2, AC4)
- D1065: A module that fails to collect leaves the host process's exit code set. (AC4)
- D1066: Environment values a workspace's configuration wrote stay in the host process after discovery. (AC3)
- D1067: The identity is built from Vitest's own test id, which differs between 4.1 and 5 for the same test. (AC5)
- D1068: The module path is absolute, so the same test gets a new identity wherever the consumer sits. (AC5)
- D1069: Module paths are made relative to the unresolved workspace directory, so a consumer root reached through a link gives paths that climb out of the workspace. (AC5; found by this session, fixed by dev at 04:11)
- D1070: The name path drops the enclosing suites, so renaming a suite keeps the old identity and same-named tests in different suites collide. (AC5, AC6)
- D1071: The identity omits the workspace, so the same module and test name in two workspaces collide. (AC6)
- D1072: The identity omits the Vitest project, so one module run by two projects gives colliding identities. (AC6)
- D1073: A host environment value a workspace's configuration overwrote keeps the workspace's value after discovery. (AC3, G1)
- D1074: Discovery never closes the Vitest instance it created, so its server, workers and process handlers outlive discovery. (AC3, G2)
- D1075: Unhandled errors raised during collection are dropped, so the workspace reads as cleanly discovered. (AC4, G3)
- D1076: A module whose worker crashed during collection reads as a module holding zero tests on Vitest 5, so the file vanishes from the report. (AC4, G5; found by this session, fixed by review at about 04:44)
- D1077: Discovery collects under Vite's NODE_ENV=development, so a test registered only under NODE_ENV=test is missing though a run would hold it. (AC3, G6)
- D1078: A candidate directory that cannot be stat'ed (a link loop) aborts discovery of every workspace instead of being reported as not read. (AC1, G7)
- D1079: A cause chain deeper than the stack overflows while formatting, so the failure it describes escapes as a RangeError. (AC4, G8)
- D1080: Two overlapping discoveries restore each other's host snapshots, leaving a workspace's environment values in the host. (AC3, G9)
- D1081: A non-string entry in workspaces is dropped without a notRead report. (AC1, G10)
- D1082: A plain file under a parent/\* directory is taken as a candidate and reported as unreadable. (AC1, G11)
- D1083: A module whose worker crashed during collection reads as a module holding zero tests on Vitest 4.1, so the file vanishes from the report. (AC4, G5)

#### Deliberately Untested

- `packages/core/src/index.ts`, `packages/daemon/src/index.ts`: re-export barrels, no defect of their own.
- `packages/daemon/src/vitest/find-workspaces.ts` (AC1 "reads files only"): the guarantee is structural (the module imports only `node:fs`, `node:path` and `error-text`), and no one-edit mutation adds a module load or execution for a test to observe; review holds it.
- `packages/daemon/src/vitest/find-workspaces.ts` `holdsVitestConfig`, a `vitest.config.*` directory never reading its `package.json`: the early return is ordering, and no one-edit mutation moves it.
- `packages/daemon/src/vitest/load-vitest.ts` `readVersion` failure branch (`cannot read ${manifestPath}`): inert. Node's resolver parses the manifest while resolving `vitest/package.json`, so an unparseable manifest takes the `no Vitest resolves` branch first (a D1027 attempt survived its mutation for that reason). A `version`-less manifest is inert too: `isSupported` rejects it on the same path.
- `packages/daemon/src/vitest/load-vitest.ts` `importVitestNode`: importing the workspace's `nodeEntry` versus the daemon's own `vitest/node` yields identical discovery output on the fixtures, so no test observes it; `D1024` pins the resolution it depends on.
- `packages/daemon/src/vitest/discover-tests.ts` `closeInstance` error path (`closeError`): a real Vitest instance cannot be made to fail `close()` from a fixture, and the instance is created inside `discoverWorkspace`, so a stub would need a module mock of the consumer's Vitest entry.

### Review Record

Review session: threadId dbd9026e-4218-4b77-82e0-6361521f362f

Review fixes (source only; each new behavior has a gap row below):

- `load-vitest.ts`: `VitestNodeModule` is no longer exported; nothing outside the file read it.
- `error-text.ts`: `errorLines` stops at `MAX_ERROR_DEPTH` (32) and ends with a line saying deeper errors are not shown. Throwing there would escape the catch that formats a workspace failure and abort every workspace.
- `find-workspaces.ts`: a `statSync` failure other than a missing entry (`ELOOP`, `EACCES`) is reported in `notRead` under the pattern that reached it, instead of aborting discovery. D1039's anchor text is unchanged.
- `discover-tests.ts`: `discoverTests` calls run one at a time, so no two discoveries interleave their host env and exit-code snapshots; `NODE_ENV` is set to `test` inside the restored window, as the Vitest CLI does; a module whose worker crashed before collecting it is reported as a failed module. A crashed file keeps the placeholder task a worker queues (`mode: "queued"`), which collection alone turns into `run`, `skip` or `todo` (4.1.11 `@vitest/runner` `chunk-artifact.js:2498-2500`, 5.0.1 `run.C5UmxDPh.js:3480`); `task` is outside Vitest's public types, and collection calls no reporter hook, so no public signal exists. A specification with no module at all is reported the same way.

Owner rulings on the review's questions (owner, 2026-09-26 04:54 -0400, relayed by the orchestrator, threadId c69b35aa-87e0-4755-b618-81ae537fa756):

- `collectTests` runs each workspace's `globalSetup`, the root project's included, as `vitest list` does, while AC3 says discovery runs no test body or hook. Asked whether to accept it. Answer: accepted as AC3's known exception, recorded under the sprint's Ticket 1.3 entry for the daemon start.
- A directory holding a `vite.config.*` whose `package.json` does not list Vitest (for example, one relying on a root-hoisted Vitest) is skipped with no `notRead` entry. Asked whether to report it. Answer: it stays skipped, with no `notRead` entry.

Tech debt (not fixed here, triaged after the commit):

- The root `workspaces` field has two readers: `packages/daemon/src/vitest/find-workspaces.ts` `workspacePatterns` and `expandPattern`, and `scripts/lib/standards/workspace-scripts.mjs` `patternsOf` and `expand`. They disagree on a negation (the script treats `!x` as a literal directory and drops it silently) and on an unknown field shape (the script throws; the daemon reports `notRead`). P11 keeps the script from importing the package.
- `relativePosixPath` in `find-workspaces.ts` repeats `scripts/lib/rules/hygiene.mjs` `posix` (`path.split(sep).join("/")`), and `find-workspaces.ts` is an odd home for a path helper `discover-tests.ts` also uses.

Named defects in 1.1's touched test files: 56 records (core D1000-D1005, daemon 50) against the six criteria. Every criterion has a named test that goes red when it breaks; the rows below are defects no current test catches.

#### Test Coverage Gaps

| #   | Source                                                                                                | Defect                                                                                                                                                            | Expected test                                                                                                                                                                                                                                      | Severity                                        |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| G1  | `packages/daemon/src/vitest/discover-tests.ts` `captureHostState` (`Object.assign(process.env, env)`) | A host environment value a workspace's configuration overwrote keeps the workspace's value after discovery.                                                       | Set a host variable before discovery that the `envdef` fixture's `test.env` or `define` overwrites; assert it reads the host value afterwards. D1066 seeds only keys the host lacked.                                                              | MEDIUM (daemon-state, silent)                   |
| G2  | `discover-tests.ts` `closeInstance` (`await instance?.close()`)                                       | Discovery never closes the Vitest instance it created, so its server, workers and process handlers outlive discovery.                                             | Vitest's logger adds `SIGINT`, `SIGTERM`, `exit` and `unhandledRejection` listeners and removes them at `close()`: assert `process.listenerCount(...)` is unchanged across one discovery, or have a fixture plugin's `closeBundle` write a marker. | MEDIUM (daemon-state, silent)                   |
| G3  | `discover-tests.ts` `collectWorkspace` (`unhandledErrors: unhandledErrors.map(errorText)`)            | Unhandled errors raised during collection are dropped, so the workspace reads as cleanly discovered.                                                              | A fixture module that raises an unhandled error at import time; assert its text appears in the workspace's `unhandledErrors`.                                                                                                                      | MEDIUM (consumer, error hidden)                 |
| G4  | `packages/daemon/test/defects.json` D1042 (`split(sep)` to `split("/")`)                              | D1042's mutation changes nothing where `path.sep` is `/`, so `bun run test:defects` inside `bun run check` reports it undetected on the Ubuntu CI leg.            | Rework the record or test so the defect is observable on Linux and Windows alike, or name the platform limit to the orchestrator if the verifier must support it.                                                                                  | MEDIUM (internal, fails loudly on CI)           |
| G5  | `discover-tests.ts` `wasCollected` and `uncollectedModules` (review fix)                              | A test file whose worker crashed before reporting it vanishes from the report, so the workspace reads as discovered without it.                                   | A fixture module that kills its worker during collection (not `process.exit`, which Vitest turns into a module error); assert the module appears in `failedModules`.                                                                               | MEDIUM (consumer, lost module)                  |
| G6  | `discover-tests.ts` `discoverWorkspace` (`process.env["NODE_ENV"] ??= TEST_NODE_ENV`, review fix)     | Discovery collects under Vite's `NODE_ENV=development`, so a test registered only when `NODE_ENV` is `test` is missing from discovery though a run would hold it. | A fixture test registered under `if (process.env.NODE_ENV === "test")`; delete the host's `NODE_ENV` before discovery (the Vitest worker running the test already holds `test`), assert the test is listed, and restore it.                        | HIGH (consumer, wrong test set)                 |
| G7  | `packages/daemon/src/vitest/find-workspaces.ts` `isReadableDirectory` (review fix)                    | A candidate directory that cannot be stat'ed (a link loop) aborts discovery of every workspace instead of being reported as not read.                             | A link loop under a `parent/*` directory; assert `findVitestWorkspaces` returns the other workspaces and a `notRead` entry naming the pattern.                                                                                                     | MEDIUM (daemon-state, fails loudly)             |
| G8  | `packages/daemon/src/vitest/error-text.ts` `errorLines` depth ceiling (review fix)                    | A cause chain deeper than the stack overflows while formatting, so the workspace failure it describes escapes as a `RangeError`.                                  | Format an error with a cause chain of some thousands of levels; assert the text ends with the depth-cut line.                                                                                                                                      | LOW (daemon-state, fails loudly; reach unknown) |
| G9  | `discover-tests.ts` `discoverTests` queue (review fix)                                                | Two overlapping discoveries restore each other's host snapshots, leaving a workspace's environment values in the host.                                            | Start two `discoverTests` calls without awaiting the first; after both settle, assert the fixture env keys are unset.                                                                                                                              | MEDIUM (daemon-state, silent)                   |
| G10 | `find-workspaces.ts` `workspacePatterns` (non-string pattern)                                         | A non-string entry in `workspaces` is dropped without a `notRead` report.                                                                                         | Add a number to a fixture's `workspaces` array; assert its `notRead` entry. D1045 covers only a non-array field.                                                                                                                                   | LOW (daemon-state, silent)                      |
| G11 | `find-workspaces.ts` `expandPattern` (`.filter(isDirectory)`)                                         | A plain file under a `parent/*` directory is taken as a candidate and reported as unreadable.                                                                     | A plain file beside the fixture's packages; assert it yields neither a workspace nor a `notRead` entry.                                                                                                                                            | LOW (daemon-state, noise)                       |

### Completion Notes

Built `TestIdentity` and `identifyModuleTests` in `@rt-test/core`, and the `@rt-test/daemon` workspace with workspace finding (`find-workspaces.ts`), per-workspace Vitest resolution (`load-vitest.ts`) and discovery (`discover-tests.ts`). The daemon exports `discoverTests`, `findVitestWorkspaces` and their result types.

Sanity check (Step 4): three findings, all settled by the author (rt-t1-1-create), F1 with the owner's ruling of about 03:48 -0400. F1: on 5.x, a providerless browser project fails the whole workspace; AC2 narrowed. F2: the daemon could not resolve `@rt-test/core` on a clean checkout; source export condition added. F3: the Reusable Code agreement claim was corrected for negations. Step 5a: U3 CONFIRMED, U6 CONFIRMED with the `collectTests` mechanism, U7 FALSE as specified and replaced by the `development` condition (author's ruling). Details in the resolution block under the Unverified Assumptions table.

Implementation facts beyond the ticket:

- `error-text.ts` was added (not in files_to_create). It formats errors for both find-workspaces and discover-tests, following `cause` chains and `AggregateError` members, and reading the `message` of the plain objects Vitest serializes worker errors into.
- Discovery saves and restores `process.exitCode` and `process.env` around each workspace, since `createVitest` writes a workspace's `define` and env values into the host env and `collect` sets the exit code. It passes `api: false, ui: false`, so a consumer's `test.api` never opens a server (both versions then resolve `api` to middleware mode).
- A negation pattern is reported as not applied, and the directories it excludes are still searched, which widens discovery rather than narrowing it.
- Workspaces are discovered one at a time, so there is no fan-out to bound (C22).
- Code bug from the tests session (2026-09-26, about 04:10 -0400): Vitest realpaths `TestModule.moduleId`, while the module path was computed against the unresolved workspace directory. A consumer root reached through a junction gave `../rt-probe-X/a.test.mjs`, and an 8.3 short-name root gave a different path on 4.1.11 than on 5.0.1. `discover-tests.ts` now resolves both the workspace directory and each module id with `realpathSync.native` before `relativePosixPath`. Re-probed with the built daemon: a junction root and a short-name root each gave `a.test.mjs` and `x.test.mjs` on 4.1.11 and 5.0.1.

Acceptance evidence (built daemon, plain `node`, scratch consumer under `_agent-docs/.scratch/t1-1-dev/consumer`, 2026-09-26 about 04:05 -0400, Windows 11, Node 24):

- AC1: `pnpm-workspace.yaml`, `tools/**`, `!packages/skip` and `a*b/*` were reported as not read. A config-less package, a `vite.config` package without a Vitest dependency, and an empty literal directory were not listed. A `vite.config` package with a `vitest` devDependency was listed. `find-workspaces.ts` calls only `existsSync`, `readdirSync`, `readFileSync` and `statSync`.
- AC2: root 5.0.1 and `packages/v4` 4.1.11 were discovered. 3.2.4 and 5.1.0-beta.1 were unsupported with the version and `4.1.x || 5.x`. A directory with no Vitest was unsupported with no version. On 4.1.11, `br (chromium)` was rejected alone while its sibling project was discovered. On 5.0.1, the providerless browser workspace failed with the `AggregateError` and its member.
- AC3: skip and todo tests, three `it.each` arms, two `it.for` arms and two `describe.each` arms were listed. The typecheck module was reported apart. The `beforeAll` and body marker files were never written.
- AC4: `unit/b.test.mjs` failed with `collection boom` and listed no tests. `packages/cfgfail` failed with `config boom`. Other modules and workspaces were still discovered.
- AC6: two `arm 1` arms and three `group > same` tests got occurrences 0..n and the duplicate mark. The workspace and project are part of the identity.
- AC5: see `#### ACs Owed a Test`.

Gates (lane, main checkout): `bun run --filter @rt-test/core typecheck` and `bun run --filter @rt-test/daemon typecheck` exit 0; `bun x oxlint packages/core packages/daemon` exit 0 with no warning; `bun run build` exit 0 from a deleted `dist` (core built before daemon); `node scripts/check-workspace-scripts.mjs` exit 0; `node scripts/check-line-citations.mjs` clean; prettier clean. No test run (create-tests).

Adversarial review: 11 findings. Fixed F1 (serialized errors), F2 (env restore), F5 (symlinked children), F6 (negation message), F7 (unreadable directory), F8 (API server), F9 (cause chain), F11 (root exports narrowed). Discarded F3: the owner ruled a file covered by a root and a package config is discovered in both. Discarded F4: the workspace definition is the owner's ruling. Discarded F10: the daemon never runs its own Vitest, and a peer range would wrongly pin one Vitest for the consumer. Post-fix lint, typecheck and build exit 0, and discovery output was unchanged by the literal pass.

README: no user-visible change. The daemon has no CLI or entry point yet, and discovery has no production caller until the daemon start is built.

Change-request candidates:

- `scripts/lib/standards/workspace-scripts.mjs` `expand` treats a negation pattern (`!x`) as a literal directory and drops it silently. Report it as unsupported, as other patterns are.
- The defect sandbox cannot resolve workspace dependencies under Bun's per-workspace linking (see `#### Tests Owed`). `_agent-docs/code-change-standards.md` § Test Coverage Recommendation says "A module the test imports by package name resolves to the live tree", which is false for `@rt-test/core` from the daemon.
- Resolved (owner, 04:06 -0400): a directory that depends on Vitest but holds no config file stays outside the workspace definition and is now reported in `notRead` (`find-workspaces.ts` `holdsVitestConfig`). Its `package.json` is now read for every candidate without a `vitest.config.*`, so an unreadable one there is reported too. Evidence: `packages/noconf2` (a `vitest` devDependency, no config) gave that entry, `packages/noconfig` and `packages/viteonly` (no Vitest dependency) gave none, and the workspace list was unchanged (`disc4.json`). Lint, the daemon typecheck and build exit 0.

### File List

- `packages/core/src/test-identity.ts` (created)
- `packages/core/src/index.ts` (modified)
- `packages/core/package.json` (modified: `development` export condition)
- `packages/daemon/package.json` (created)
- `packages/daemon/tsconfig.json` (created)
- `packages/daemon/tsconfig.build.json` (created)
- `packages/daemon/src/index.ts` (created)
- `packages/daemon/src/vitest/error-text.ts` (created)
- `packages/daemon/src/vitest/find-workspaces.ts` (created)
- `packages/daemon/src/vitest/load-vitest.ts` (created)
- `packages/daemon/src/vitest/discover-tests.ts` (created)
- Orchestrator-written for this lane: root `package.json` and `bun.lock` (`vitest-4` devDependency, `packages/daemon` workspace), `tsconfig.base.json` (`customConditions`), `.oxlintrc.json` (`test/fixtures/**` override), `docs/architecture.md` § Current implementation, `_agent-docs/sprint-status.yaml` (1.1 to `review`).

Tests the create-tests run wrote:

- `packages/core/test/test-identity.test.ts` (created)
- `packages/core/test/defects.json` (modified: D1000-D1005)
- `packages/daemon/test/harness.ts`, `discover-tests.test.ts`, `error-text.test.ts`, `find-workspaces.test.ts`, `load-vitest.test.ts` (created)
- `packages/daemon/test/defects.json` (created)
- `test/fixtures/daemon/` (created: `consumer`, `single`, `workspaces`, `workspaces-object`)

Planning files the create-ticket run wrote:

- `_agent-docs/tickets/1-1-capture-vitest-runs.md` (created)
- `_agent-docs/sprints/sprint-1-queryable-results.md` (split heading for 1.1b, 1.1 scope and link, sequencing line under 1.3)
- `_agent-docs/sprint-status.yaml` (`1-1b-record-run-states` key)
- Sent to the orchestrator as exact text: C125 and C140 rewrites, two `docs/glossary.md` entries, and the FR1 marker `[Ticket 1.1]`.

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

- [ ] AC1: Given a consumer root, RT Test lists the consumer's Vitest workspaces as defined in Dev Notes § Vitest workspace, and reports a root `pnpm-workspace.yaml` and each `workspaces` pattern it cannot expand as not read, reading files only: it executes no project file and loads no Vitest configuration to find them.
- [ ] AC2: Each workspace is discovered with the Vitest installed for that workspace. A workspace whose Vitest is 4.1.x or 5.x is discovered; a workspace with no resolvable Vitest, or any other version (a prerelease included), is reported as unsupported with the version found and the supported range, and the other workspaces are still discovered. A Vitest project with browser mode enabled is reported as unsupported, and the other projects of its workspace are still discovered.
- [ ] AC3: Discovery lists every test of every discovered workspace and each of its Vitest projects, including skipped and todo tests and each arm of a parameterized test or suite (the `.each` and `.for` forms) as its own test, and runs no test body or hook. Typecheck test modules are reported as not discovered, apart from test results, and are never listed as tests.
- [ ] AC4: A test module that fails to load during discovery, and a workspace whose configuration fails to load, are each reported with the error, as not discovered. Neither is reported as holding zero tests, and the other modules and workspaces are still discovered.
- [ ] AC5: A test's identity (`TestIdentity`, Dev Notes § Test identity) is the same across repeated discoveries, is equal for one test whether discovered under Vitest 4.1 or 5 and on Windows or Linux, and stays the same when a test with a different name path is added, removed or moved elsewhere in its module. Renaming a test, or one of its enclosing suites, gives it a new identity.
- [ ] AC6: Tests that share a display name get distinct identities: duplicates in one module, `it.each` arms that format to the same name, and the same module and name in two workspaces or two projects. Each test whose name path occurs more than once in its module is marked as a duplicate.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                      | Why it matters if wrong                                                                          | How to check                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| U3  | On 5.0.1, does `collect()` with `staticParse: false` report a `describe.each` arm and a module that throws at load exactly as 4.1.11 does, when the workspace's `test.projects` are inline objects rather than directory names? | AC3 and AC4 would need a version branch.                                                         | The spike observed it for one root config with `projects: ["a", "b"]`; re-run `probe.mjs` against a fixture whose projects are inline objects.     |
| U6  | With a browser provider installed, how do 4.1.11 and 5.0.1 expose that a project has browser mode enabled, before any browser starts?                                                                                           | AC2's browser rejection needs a signal read before collection, or collection launches a browser. | Read `TestProject.config.browser.enabled` in each installed `.d.ts`, and check that `createVitest` does not start the provider before `collect()`. |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing.
- [ ] (Support) Before building AC3, confirm the orchestrator has written the approved C140 and C125 texts and the two glossary entries (Dev Notes § Rule conflict: C140, § Test identity, § Glossary); stop and report if it has not.
- [ ] (Support) Create the `@rt-test/daemon` workspace in `packages/daemon`, with `build` and `typecheck` scripts, its `tsconfig.json` and `tsconfig.build.json` extending `tsconfig.base.json`, and `src/index.ts`, following `packages/core`. Add `@rt-test/core` as a workspace dependency.
- [ ] (Support) Ask the orchestrator to add the root devDependency `"vitest-4": "npm:vitest@4.1.11"` with `bun add --exact --dev vitest-4@npm:vitest@4.1.11` and to commit `bun.lock`; the lane edits neither file.
- [ ] (AC5, AC6) In `packages/core/src/test-identity.ts`, define `TestIdentity` (workspace path, project name, module path, name path, occurrence index) and a pure function that assigns identities to one module's tests in collection order, returning each with a duplicate mark held beside the identity, never inside it. Export both from `packages/core/src/index.ts`.
- [ ] (AC1) In `packages/daemon/src/vitest/find-workspaces.ts`, list the workspaces by Dev Notes § Vitest workspace (a `vitest.config.*`, or a `vite.config.*` with a `vitest` dependency in that directory's `package.json`), and report a root `pnpm-workspace.yaml` as not read. Read the `workspaces` field in both its array and `{ "packages": [...] }` forms; expand a literal directory and a `parent/*` pattern, and report every other pattern (`**`, a negation, a `*` inside a segment) as not read, naming it. Read `package.json` files and directory listings only, and normalize every stored path to `/`.
- [ ] (AC2) In `packages/daemon/src/vitest/load-vitest.ts`, resolve `vitest/package.json` and `vitest/node` from each workspace directory, check the version against the supported range, and report an unsupported or missing Vitest with the version found and the range. Hold the supported range as one named constant.
- [ ] (AC2, AC3, AC4) In `packages/daemon/src/vitest/discover-tests.ts`, create one Vitest instance per supported workspace with that workspace's Vitest, collect with static parsing off, walk every project's modules, and return the workspace's tests with their identities, each module and workspace that failed to load with its error, each browser-mode project as unsupported, each typecheck module (`meta().typecheck === true`) as not discovered, and the unsupported workspaces from `load-vitest.ts`. One workspace's rejection or failure never stops the others. Close every instance it creates, on success and on error.
- [ ] (AC5, AC6) Build each `TestIdentity` in `discover-tests.ts` from the workspace path, project name, module path relative to the workspace normalized to `/`, and the name path as the list of suite and test names (never the `>`-joined `fullName`), through the core function; never from Vitest's own test id.
- [ ] (Support) Send the orchestrator the `docs/architecture.md` § Current implementation text for the new discovery and identity code, per P21.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `@rt-test/core` (`packages/core/src/index.ts`): the workspace dependency the daemon package takes; `TestIdentity` joins its exports.
- `packages/core/package.json`, `tsconfig.json` and `tsconfig.build.json`: the shape of a workspace package to copy for `@rt-test/daemon` (P2).
- `vitest` 5.0.1 (root devDependency): type-only imports from `vitest/node` (`Vitest`, `TestModule`, `TestCase`, `TestProject`) for typing the loaded instance. Its runtime copy is never the one discovery runs.
- `node:module` `createRequire`: resolves `vitest/node` and `vitest/package.json` from a workspace directory (spike: it resolved 4.1.11 under `v41/` and 5.0.1 under the repository from the same script). `scripts/lib/defects/vitest.mjs` `vitestEntry()` already resolves `vitest/package.json` this way for the repository's own Vitest.
- `scripts/lib/standards/workspace-scripts.mjs` (`patternsOf`, `expand`): the repository's reader of the root `workspaces` field, accepting the array and `{ "packages": [...] }` forms, expanding a literal directory and `parent/*`, and rejecting any other pattern by name. Product code cannot import repository tooling (P1, P11), so `find-workspaces.ts` follows the same pattern rules rather than importing it, keeping the two readers in agreement on each edge case (C5).

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

`node scripts/list-unbuilt-work.mjs` over the target files found no other unbuilt ticket naming them. It cannot search the root `package.json` by that path, since a bare file name matches nothing unless it is unique among tracked files.

#### Vitest workspace

A Vitest workspace is one directory RT Test runs as its own Vitest instance. The candidates are the consumer root and each directory the root `package.json` `workspaces` globs match. A candidate is a workspace when it holds a `vitest.config.*` file, or holds a `vite.config.*` file while its `package.json` lists `vitest` in `dependencies` or `devDependencies`. A Vitest configuration's `test.projects` are projects inside its workspace, not workspaces of their own.

- A test file that a root configuration and a package's own configuration both cover is discovered in both workspaces, under two identities, as running each configuration would. Neither copy is dropped.
- A `pnpm-workspace.yaml` at the consumer root is not read: discovery reports that it exists and its packages were not searched, so no workspace goes missing without a report.

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
- **Browser mode without a provider fails the workspace.** On 5.0.1, a configuration with `browser: { enabled: true, instances: [{ browser: "chromium" }] }` and no provider installed made `createVitest` throw `Browser Mode was enabled, but provider was not specified anywhere` (`index.DzobfTyw.js`), so AC4 reports that workspace. Browser mode with a provider installed was not exercised (U6).

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

- `_agent-docs/tickets/1-1-capture-vitest-runs.md` (created)
- `_agent-docs/sprints/sprint-1-queryable-results.md` (split heading for 1.1b, 1.1 scope and link, sequencing line under 1.3)
- `_agent-docs/sprint-status.yaml` (`1-1b-record-run-states` key)
- Sent to the orchestrator as exact text: C125 and C140 rewrites, two `docs/glossary.md` entries, and the FR1 marker `[Ticket 1.1]`.

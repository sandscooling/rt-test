# Ticket 2.2: Workspace-level selection

## Ticket

As a coding agent editing a trusted consumer worktree whose daemon is running,
I want each change mapped to the Vitest workspaces it can affect, the edited workspace plus every workspace that depends on it, widened whenever that dependency information is uncertain and explained test by test,
so that the daemon (ticket 2.3) runs only what a change requires, never misses a failure a full run would find (NFR2), and tells me why each test was chosen and which input forced a broad fallback.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: A changed path belongs to the deepest package workspace whose directory holds it. A changed path whose package workspace is a Vitest workspace selects that Vitest workspace, and each of its tests carries a reason naming the path.
- [x] AC2: A changed path also selects every Vitest workspace that depends on its package workspace, directly or through a chain of package workspaces, whether or not the package workspaces along the chain hold a Vitest config. The reason names the path and each workspace along the chain.
- [x] AC3: A package workspace depends on another when its `package.json` `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies` names the other's package name, as the dependency's key or as the package an alias installs, or points into the other's directory by a local path. The root `package.json` `overrides`, `resolutions` and `pnpm.overrides` (nested entries included) can replace a package anywhere in the tree. So an entry whose value is a local path (`file:`, `link:`, `portal:` or a `workspace:` path, or a bare relative or absolute path), a `workspace:` spec, an `npm:` alias naming a listed package workspace's name, or a `$name` reference to a root dependency that is one of these makes every package workspace depend on the package workspace it points into. An entry of these forms that resolves to no listed package workspace makes every package workspace depend on every package workspace (AC4). A Vitest workspace also depends on every package workspace that holds one of its discovered test modules or one of its setup or global setup files, and on every package workspace one of its resolved config aliases points into by path or names as a package. Each dependency records its producer (the manifest field and key, test module, setup file or alias that produced it), and the selection reason quotes it.
- [x] AC4: Uncertain dependency information widens and never narrows. A package workspace whose `package.json` is missing or cannot be read or parsed, and a dependency whose local path or workspace-protocol spec resolves to no listed package workspace, make that workspace depend on every package workspace. A Vitest workspace whose tests are not known depends on every package workspace, since its test modules may lie in any of them. So does one with an alias replacement that is neither an absolute path nor a bare package name. While the package workspace listing is incomplete (any source it reports as not read), a dependency or alias naming no listed package workspace does the same; while the listing is complete, such a name is an external package and adds no edge. Each widening names its cause, and the selection reason of every test it adds quotes it.
- [x] AC5: Each of these changed paths is a project-wide broad fallback that selects every Vitest workspace and names the path and its trigger kind: a lockfile of a supported package manager, in any directory; any `package.json`; a path whose package workspace is the consumer root while the listing holds another package workspace; a path whose package workspace has no `package.json` and is not a Vitest workspace, since no package manager treats that directory as a package (its trigger kind names the missing `package.json`); and a Vitest or Vite config file name in a directory that is not a Vitest workspace.
- [x] AC6: A changed Vitest or Vite config file name in a Vitest workspace's directory is a broad fallback that selects that Vitest workspace and its dependents (AC2). A changed path that is a setup file or global setup file of a Vitest workspace is a broad fallback that selects every Vitest workspace naming it, wherever the file lies, and their dependents (AC2). Each names the path and its trigger kind.
- [x] AC7: Every selected test carries every reason that selected it, not only the first: one reason per changed path or broad fallback that selected its workspace, each with one shortest dependency chain. Every changed path is reported with the Vitest workspaces it selected and why, including a path that selected none, with the reason it selected none.
- [x] AC8: A selection reports its selected and total test counts and its selected and total Vitest workspace counts. A selected Vitest workspace whose tests are not known is reported with an unknown test count, and the selected test count then says it is incomplete; any Vitest workspace whose tests are not known makes the total test count say it is incomplete. Neither count treats that workspace as zero tests. While the package workspace listing or the Vitest workspace listing reports any source not read, the selection names each such source, and its total Vitest workspace count says it is incomplete. A Vitest workspace the caller passes as not runnable, with its reason, is never selected: a changed path that would select it reports it with that reason, and the counts report it apart from the runnable ones.
- [x] AC9: A change that selects no test and no Vitest workspace whose tests are not known yields a selection that states nothing was selected and names each changed path's reason, never a result shaped like a successful empty selection.
- [x] AC10: A selection depends only on the change, the package workspace listing, the package manifests, and each Vitest workspace's discovered tests, setup files and resolved config aliases: the same inputs always select the same tests, and no stored result, prior run or coverage removes a test. Building the dependency information reads files only; it loads no Vitest, no config and no test module.
- [x] AC11: Every selection carries the selection policy version.
- [x] AC12: A changed path that is absolute, or that leaves the consumer root, is refused with an error naming the path, and no selection is returned for that change.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                                                                                                                                 | Why it matters if wrong                                                                                                                                                       | How to check                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| U1  | Do Bun, npm, pnpm and Yarn link a local workspace only through the dependency fields AC3 names (not `overrides`, `resolutions` or `pnpm.overrides`), and for a dependency only when the dependency's key, an `npm:`/`workspace:` alias target, or a `file:`/`link:`/`portal:`/`workspace:` path names that workspace's `package.json` `name` or directory? | A linking form outside these makes a real edge invisible (a selection miss, NFR2); AC4's "resolves to no listed package workspace" widening then covers only the forms named. | Each manager's documentation for the workspace protocol and aliases, for its current major. |
| U2  | Is the lockfile set `bun.lock`, `bun.lockb`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml` and `yarn.lock` complete for the managers RT Test supports?                                                                                                                                                                                      | A missing name makes a dependency change a plain path, which selects only one workspace.                                                                                      | Each manager's documentation for its lockfile names.                                        |

Resolutions (dev session, 2026-09-26, from each manager's current documentation as the rows direct; no package manager source is installed in this repository):

- **U1: FALSE, re-planned with the author.** The dependency-field half holds: npm symlinks a workspace a dependency names by a plain range (docs.npmjs.com/cli/v11/using-npm/workspaces: "npm will detect that **b** is a workspace and automatically symlink it"); Yarn "will only ever care about the dependency name" (yarnpkg.com/features/workspaces); pnpm accepts `workspace:*`, `workspace:^`, `workspace:~`, `workspace:<range>`, `workspace:foo@*` and `workspace:../foo` (pnpm.io/workspaces); Bun documents `workspace:*`, `workspace:^`, `workspace:~` and `workspace:<version>` (bun.sh/docs/install/workspaces); npm documents `npm:@scope/pkg@version` aliases and `file:` local paths (docs.npmjs.com/cli/v11/configuring-npm/package-json). The override half is false: npm `overrides` values "can use any specifier that npm accepts for dependencies, including ... `npm:`, `file:`" and `$name` references (same page), and Yarn `resolutions` take `file:` and `portal:` paths (yarnpkg.com/configuration/manifest). The author accepted reading the root `overrides`, `resolutions` and `pnpm.overrides` with an `npm:` alias and a `$name` reference added (SANITY CHECK REPLY U1, 18:46); AC3 now carries the rule.
- **U2: CONFIRMED.** Bun reads `bun.lock` and the legacy binary `bun.lockb` (bun.sh/docs/install/lockfile); npm writes `package-lock.json` and honors `npm-shrinkwrap.json`; pnpm writes `pnpm-lock.yaml`; Yarn writes `yarn.lock`.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing.
- [x] (AC1, AC2, AC4, AC5) In `packages/daemon/src/vitest/find-workspaces.ts`, export a listing of every package workspace, not only the Vitest ones: the consumer root first, then each directory the root `package.json` `workspaces` patterns expand to, each with its `/`-separated root-relative path (`.` for the root) and its directory, typed by the `{ path, directory }` shape `VitestWorkspace` already declares (C14). Build it from the helpers `findVitestWorkspaces` already uses (`workspaceDirectories`, with its outside-root refusal, and `duplicateReason`'s first-listed real-path dedup), so the two listings expand, refuse and deduplicate by one rule (C8). It reports every source it could not read, as `findVitestWorkspaces` does. Leave `findVitestWorkspaces`'s result unchanged, entries and `notRead` order included; the existing find-workspaces tests stay green.
- [x] (AC3, AC4, AC10) Create the dependency information in `packages/daemon/src/selection/` (for example `workspace-graph.ts`). From the consumer root, the package workspace listing, and each Vitest workspace's discovered test identities (or none known), setup and global setup files and resolved config aliases, read each package workspace's `package.json` (its `name` and the dependency fields AC3 names) and record each dependency with the field that produced it: a key or alias target matching a listed package workspace's `name`, or a local path resolving into a listed package workspace's directory. Add a test-module dependency from each Vitest workspace to every package workspace holding one of its test modules, resolving `modulePath` against the workspace's real directory as `module-tests.ts` computed it, and match it, and each local dependency path, against each package workspace's real directory, so a symlinked consumer root or workspace still yields the edge. Add a setup-file dependency for each setup or global setup file, and an alias dependency for each resolved config alias whose replacement is a path into another package workspace or a bare name of a listed package (a replacement holding a capture reference such as `$1` resolves by its text before the reference). Record each AC4 uncertainty with its cause. Keep the edge set open to more producers: ticket 2.2b adds source-import and tsconfig edges through the same edge and uncertainty types. Read files only through `node:fs`: no runtime import from `vitest` or `vite`, and no `import()`, `require` or config loader applied to a consumer file (AC10).
- [x] (AC1, AC2, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12) Create the selection in `packages/daemon/src/selection/` (for example `select-tests.ts`): a pure function over the change (root-relative `/`-separated paths), the dependency information, and the selectable Vitest workspaces, each with its discovered tests or none known, its setup and global setup files as root-relative paths, and its resolved config aliases (each a find and a replacement, the replacement an absolute path or a bare package name as Vite's resolved config holds it). The setup files and aliases are required inputs, never optional. The caller also passes each Vitest workspace it will not run (not confirmed at start, unsupported) with its reason, so AC8 reports it truthfully, and the Vitest workspace listing's `notRead` (`WorkspaceListing.notRead` from `findVitestWorkspaces`) as a required field, since that listing drops candidates the package listing never sees: a directory it cannot list, a `package.json` it cannot read, and a Vitest dependent with no config file (AC8). Refuse an absolute or root-escaping path first (AC12). Find each path's deepest package workspace by path-segment prefix, never by bare string prefix (`packages/a` never holds `packages/ab/x`). Apply the broad fallbacks (AC5, AC6), then the dependents closure (AC2) as a breadth-first walk with a visited set, so a dependency cycle ends, recording for each reached Vitest workspace one shortest chain of workspaces from the changed path and each edge's producer along it (AC2, AC3, AC7). The walk follows every edge kind, test-module, setup-file and alias edges included, so a workspace depending on a Vitest workspace's package is reached through it too; that over-selects and never narrows. Return the selection with each selected test and all its reasons, each changed path with what it selected, the counts (AC8), an explicit nothing-selected state (AC9), the widenings and fallbacks it used (C11), and the policy version (AC11). Name every trigger kind, reason kind and lockfile name as a constant (C3).
- [x] (Support) Report to the orchestrator, as exact text, the `docs/architecture.md` § Current implementation sentences that replace "Nothing yet builds fingerprints or selects tests", and any glossary entry the grill settled; do not edit either file.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `packages/daemon/src/vitest/find-workspaces.ts`: `findVitestWorkspaces(consumerRoot): WorkspaceListing` (the Vitest workspaces, each `VitestWorkspace` `{ path, directory }`, `path` `/`-separated and `.` for the root); `UnreadWorkspaceSource` `{ source, reason }`; `relativePosixPath(from, to)`; `VITEST_CONFIG_FILES` and `VITE_CONFIG_FILES`, the config file names for AC5 and AC6. Its private `workspaceDirectories`, `outsideRootReason`, `realPath`, `duplicateReason`, `readJson`, `objectField` and `workspacePath` serve the new listing inside the same file.
- `@rt-test/core` `TestIdentity` (`workspacePath`, `projectName`, `modulePath`, `namePath`, `occurrence`): the identity each selected test carries. `modulePath` is relative to the workspace's real directory (`moduleLocator` in `packages/daemon/src/vitest/module-tests.ts`), so it can begin with `..` for a test module outside the workspace.
- `packages/daemon/src/vitest/error-text.ts` `errorText(error)`: the reason text of an unreadable manifest.

### Must Create

- The package workspace listing export in `find-workspaces.ts`.
- The dependency information builder and its types (edges with their producer, uncertainties with their cause).
- The selection function, its input and output types, the trigger kinds, the lockfile names and the selection policy version constant.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

- FR7: "Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts."
- NFR2: "Find in every selected run each failure that a full run over the same input snapshot finds, across the controlled edit corpus."
- `docs/plan.md` § Selection strategy: "Start at workspace granularity: an edit selects every test in its workspace and in the workspaces that depend on it, and a configuration, setup, or lockfile change is a broad fallback that names its trigger. That selection is coarse but correct, since it only widens." And: "A new test must be discovered even if the old graph has no edge to it."
- `docs/architecture.md` § Dependency index: "Store dependency edges separately from observed execution and defect-detection edges. Preserve the reason and producer of each edge." And: "Never remove a possible dependency solely because one prior test run did not execute it."
- `AGENTS.md` § Product guarantees: "Widen selection when dependency information is uncertain. Do not use historical coverage alone to exclude tests." "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states. A zero-test selection is not proof of success." "Explain each selection and each broad fallback. Report selected and total test counts."
- Glossary, verbatim: **Selection** "The tests a change requires running, each with its reason." **Widening** "Adding tests to a selection because a dependency is uncertain." **Broad fallback** "A widening to a whole workspace or project, named with the input that triggered it." **Vitest workspace** "One directory RT Test runs as its own Vitest instance: the consumer root or a package workspace that holds a Vitest configuration."
- This ticket's input is what selection needs and nothing about how a change was detected: the change is a set of paths relative to the consumer root, `/`-separated, each a path added, edited or deleted (a rename is its old and its new path). Ticket 2.1 produces that set; this ticket never watches, fingerprints or compares files.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.2` over `find-workspaces.ts`, `packages/daemon/src/selection`, `packages/daemon/test/selection`, `test/fixtures/daemon`, `packages/daemon/src/index.ts`, `docs/architecture.md`, `docs/glossary.md`, `packages/daemon/test/defects.json` and `packages/daemon/test/find-workspaces.test.ts` named tickets 1.3, 1.3b and 1.3c. The folder hits are their mentions of `packages/daemon/`; the file-level hits follow.

- **1.3** (ready-for-dev, building in the main checkout in parallel with this ticket's dev in wt-1) reads `find-workspaces.ts` and never writes it. It writes `discover-tests.ts`, adding a `WorkspaceDiscovery` status for a workspace not confirmed at start (its AC11), which must never be run. This ticket therefore never maps a `TestDiscovery` into its input: its caller passes only runnable Vitest workspaces. It writes no file of 1.3's list.
- **1.3b** (review, landing now) writes `find-workspaces.ts` (outside-root refusal, real-path dedup) and several files this ticket only reads. This ticket's dev starts from a `main` that holds 1.3b's commit, so the listing task edits the file as 1.3b left it.
- **1.3c** (ready-for-dev, after 1.3) writes `find-workspaces.ts` for its start plan. This ticket's edit there is one added export; whichever lands second merges over an additive hunk.
- **2.1** (backlog) owns change detection: which paths count as inputs (the state directory and ignored files among them), the change set, reconciliation, and fingerprints, including folding in AC11's policy version (C117). Until 2.1 lands, this ticket's change set comes from its tests alone.
- **2.2b** (`2-2b-undeclared-edges`, builds after this ticket lands) detects dependencies no `package.json` declares: relative and bare source imports and tsconfig `extends`, `references` and `paths` into another package workspace, widening on a file it cannot read or parse. It adds its edges through this ticket's edge and uncertainty types and needs the `oxc-parser` dependency, which this ticket does not add. Selection is not complete, per the owner's ruling (R3), until 2.2b lands.
- **2.3** (backlog) is the production caller: it builds this ticket's input from discovery (runnable workspaces only), and makes discovery report each Vitest workspace's resolved setup files and config aliases (R2), runs the selection, and skips tests holding a current result (NFR1). Until then selection has no production caller, as 1.1's, 1.1b's and 1.2's exports had none (C59).
- **2.3 also owns post-change discovery.** Selection trusts the discovered tests it is given. 2.3 passes discovery taken after the change and runs each selected workspace whole, so a new test file in a selected workspace runs (plan: "A new test must be discovered even if the old graph has no edge to it"). A workspace whose rediscovery fails arrives with its tests not known, which AC4 widens.
- **1.4** (ready-for-dev) adds an exported whole-identity key to `packages/core/src/test-identity.ts`. This ticket reads `TestIdentity` only and groups tests by workspace, so the change is additive to it.
- **2.1** decides which files are inputs. Until it excludes non-inputs, a root `README.md` edit selecting every workspace (AC5) is expected behavior (R4).
- **2.4** (backlog) waits on the tests covering given files; AC7's per-path report is the covering set it can read.
- **M3, FR16** refines to file granularity.

#### Owner rulings and grill record

- R1, find-workspaces.ts export (orchestrator, 18:07): accepted. Add the exported listing of all package workspace directories beside `findVitestWorkspaces`, sharing its helpers, with `findVitestWorkspaces` unchanged. wt-1 branches from `main` after 1.3b commits. 1.3c's dev comes after 1.3 and builds on this additive hunk once 2.2 merges, or merges over it.
- R2, setup files and aliases (orchestrator, 18:07): this ticket takes each Vitest workspace's resolved setup files and resolved config aliases as required inputs. Making discovery report them is routed to ticket 2.3, which wires selection into the daemon. This ticket does not map `TestDiscovery` itself.
- R3, undeclared cross-workspace dependencies (owner, 18:07, relayed by the orchestrator): detect and widen, never a documented limit. Relative imports resolving outside the importing workspace, tsconfig `paths`, `extends` and `references` into another workspace, and config aliases or setup files resolving into another workspace each add an edge with its reason and producer. A source file selection cannot read or parse widens. Kinds that cannot be seen statically are named known limits for M3. Explanations name each edge's producer (manifest, relative import, tsconfig, alias). This ticket covers the alias and setup-file producers (AC3); 2.2b covers the source and tsconfig producers.
- R4, root-owned paths (orchestrator, 18:07): a path owned by no package workspace but the root is a project-wide broad fallback while another package workspace exists (AC5). Which files count as inputs is 2.1's.
- R5, manifests (orchestrator, 18:07): any `package.json` edit is a project-wide broad fallback, in place of keeping the previous graph to find old and new dependents (AC5).
- R6, lockfiles and config names (orchestrator, 18:07): lockfiles anywhere are project-wide; a Vitest or Vite config file name in a Vitest workspace's directory selects that workspace and its dependents, and elsewhere is project-wide, since it may create a workspace; a setup file selects every workspace naming it (AC5, AC6).
- R7, incomplete listings and unreadable manifests (orchestrator, 18:07): while the listing is incomplete, a dependency naming no listed package is uncertain; an unreadable manifest, or a Vitest workspace with no `package.json`, depends on everything (AC4).
- R8, split (orchestrator, 18:15): R3 took the ticket past both size limits (about 19 raw files, 25 estimated, 18 code units), so it split by outcome. This ticket keeps selection over known dependency information and runs in wt-1 beside 1.3. Ticket 2.2b (`2-2b-undeclared-edges`) takes source-import and tsconfig detection with the `oxc-parser` 0.151.0 dependency (approved, orchestrator, 18:15), and builds after this ticket lands. 2.3 waits for 2.2b, so selection never ships without detection (R3).
- Ticket review (create-ticket 6c, 18:16): applied edits on the graph task's inputs, the chain recording, AC9 against unknown-test workspaces, widening a workspace with unknown tests (AC4), incomplete totals and listings (AC8), the file-read rule (AC10), real-path matching, U1's override fields, and reuse of the `VitestWorkspace` shape. AC11 was narrowed to the version being carried (see Design notes). Author's answers: one shortest chain per reason (AC7); the closure follows every edge kind; the setup fallback takes dependents (AC6); alias replacements arrive absolute or bare, and anything else widens (AC4); not-runnable workspaces are passed and reported (AC8); post-change discovery is 2.3's.
- C59: accepted until 2.3, as for 1.1, 1.1b and 1.2. This ticket's selection has no production caller until 2.3 wires it into the daemon.

#### Design notes

- **Package workspace versus Vitest workspace.** Every Vitest workspace is a package workspace (the root, or a directory the root `workspaces` patterns list), but not every package workspace is a Vitest workspace. Dependencies run through package workspaces; only Vitest workspaces are selected.
- **Path ownership.** Compare `/`-separated root-relative paths by whole segments. The consumer root `.` holds every path, so it is the owner only when no deeper package workspace holds the path. A deleted package's paths fall to the root and hence to AC5.
- **The change set is taken as given.** An edit under `.rt-test/` would be a root-owned path; excluding it is 2.1's, not a filter here.
- **Deterministic output.** Order workspaces and tests stably (listing order, then discovery order), so AC10's same-inputs-same-selection holds and a reader can diff two selections.
- **Scope of the uncertainty analysis.** This ticket analyzes manifests, the listing, discovered test modules, setup files and aliases. Source imports and tsconfig files are unanalyzed here; 2.2b analyzes them (R3).
- **The policy version is raised by hand.** Any change to a rule in this ticket or 2.2b that can select a different set for the same inputs raises the constant in the same diff; 2.2b raises it. A pinned corpus enforcing that was proposed at review and not taken, as scope beyond this ticket.
- **Aliases and setup files arrive resolved.** Their resolution needs the loaded Vitest config, so this ticket never loads one (AC10); 2.3 produces them (R2).

#### Sizing

About 11 raw files, 14 estimated: the four production files Execution Metadata lists; for create-tests, a selection test file with its own `defects.json` under `packages/daemon/test/selection/` (kept apart from the `packages/daemon/test/defects.json` 1.3's tests write), `find-workspaces.test.ts` for the new listing, and a fixture tree or two under `test/fixtures/daemon/`; and the `docs/architecture.md` and `docs/glossary.md` text the orchestrator writes. Code units: 12 criteria plus validation, 13. The work is one chain (listing, then graph, then selection), so dev-ticket's delegation rule, not the estimate, decides whether to delegate.

#### Current structure of the modified files

- `packages/daemon/src/vitest/find-workspaces.ts` (as 1.3b leaves it): exports `VITEST_CONFIG_FILES`, `VITE_CONFIG_FILES`, `VitestWorkspace`, `UnreadWorkspaceSource`, `WorkspaceListing`, `findVitestWorkspaces` and `relativePosixPath`. `findVitestWorkspaces` records a not-read `pnpm-workspace.yaml`, walks `[consumerRoot, ...workspaceDirectories(root, notRead)]`, skips a path already seen, keeps a directory only when `holdsVitestConfig` passes, then drops a real-path duplicate through `duplicateReason`. `workspaceDirectories` expands each pattern (a literal directory or `parent/*`; negations and other wildcards are reported not read) and refuses one resolving outside the root through `outsideRootReason`.

#### Existing tests this change breaks

None expected: the listing is a new export and `findVitestWorkspaces` keeps its result. `packages/daemon/test/find-workspaces.test.ts` asserts `findVitestWorkspaces`'s listings and must stay green unchanged.

#### Previous ticket

None built in this sprint: 2.1 is in backlog. The nearest built work is sprint 1's 1.3b (review), which gives `find-workspaces.ts` its outside-root refusal and real-path dedup, so selection sees each workspace once.

### References

- `docs/plan.md` § Selection strategy; `docs/architecture.md` § Dependency index and § Current implementation; `docs/requirements.md` FR7, NFR2.
- `_agent-docs/tickets/1-3-daemon-lifecycle.md`, `1-3b-run-safety.md`, `1-3c-start-stop-cli.md`: file lists checked for collisions.
- GitHub issues: `node scripts/list-open-issues.mjs` reported 0 open issues, complete.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C11,C12,C13,C14,C19,C20,C21,C28,C29,C30,C32,C38,C42,C46,C48,C49,C59,C126,C127,C128,C129,C130,C140,C143 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P16,P17,P18,P19,P21,P27,P31,P35,P42 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area: packages/daemon
is_consolidation: false
sizing_ac_count: 13
files_to_modify:
  - packages/daemon/src/vitest/find-workspaces.ts
files_to_create:
  - packages/daemon/src/selection/selection-types.ts
  - packages/daemon/src/selection/workspace-graph.ts
  - packages/daemon/src/selection/select-tests.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 19542fae-3395-4822-921a-f8d789606042

#### Test Files This Change Broke

- `packages/daemon/test/defects.json` D1296: its `old` anchor `  const outside =\n` in `find-workspaces.ts` no longer exists, since `outsideRootReason` now asks the shared `liesInside` (the graph's containment test uses the same rule). The defect ("every directory reached through a link is refused as outside the root") still applies; re-anchor it on `  return liesInside(realRoot.path, real.path)` with `new` `  return real.path === directory && liesInside(realRoot.path, real.path)`. The other 24 records anchored in `find-workspaces.ts` still match exactly once (checked by script).

#### ACs Owed a Test

- AC3, the alias clause: a resolved config alias whose replacement is an absolute path into another package workspace, a bare name of a listed package, or one holding a capture reference (`$1`) whose text before the reference begins a workspace's directory or package name, adds an alias edge. Manifest, override, test-module and setup-file edges were observed on a scratch fixture; alias edges only by reading `vitest-edges.ts`.
- AC4, the alias clause: an alias replacement that is neither an absolute path nor a bare package name (`./x`, empty, `$1` alone) makes the Vitest workspace depend on every package workspace.

#### Tests Owed

Defects the adversarial review found and this session fixed, each a regression a test can pin:

- A dependency named by the key and by its `workspace:*` spec yields one edge, not two.
- `workspace:other@*` naming no listed workspace widens (unresolved-local-dependency), whatever the listing's completeness.
- A `$name` override resolves through the referenced root dependency's name, not the override key.
- A listed workspace whose `package.json` cannot be read makes the name set incomplete, so another workspace's plain-range dependency naming no listed workspace widens (a change in the unreadable workspace then selects its dependents).
- A setup file given unnormalized (`./packages/b/setup.ts`) still produces the setup edge to `packages/b`.
- A capture alias's directory match ignores case on Windows.
- The total test count is incomplete while either listing reports a source not read.
- A path owned by a listed directory with no `package.json` that is not a Vitest workspace is a project-wide `owner-without-manifest` fallback (AC5).
- A drive-relative change path (`C:foo`) is refused (AC12).
- Widenings reached only through not-runnable workspaces are not reported as used.

### Tests Record

Tests session: threadId 457192c5-c592-45f6-b494-c12f44d185e9

All in `packages/daemon/test/selection/` (`workspace-graph.test.ts` D1346-D1383, D1433, D1511-D1515 and D1522-D1524, `select-tests.test.ts` D1384-D1432 and D1516-D1521, records in its `defects.json`), each over a consumer tree `harness.ts` writes to a temporary directory and runs through `findPackageWorkspaces`, `buildDependencyInformation` and `selectTests` as 2.3's caller will. D1296 in `packages/daemon/test/defects.json` is re-anchored on `  return liesInside(realRoot.path, real.path)`. `bun run test:defects:changed` detected all 102 and D1296 over the review's fixed tree (316/316 changed defects, 19:44). Gap round: D1356, D1361, D1362, D1363, D1371, D1372, D1378 and D1392 re-anchored as the Review Record's table gives; D1377 rewritten to assert the reason's `unresolvable-alias`, since the review's prefix rule makes an empty prefix reach every package, so its selected set no longer shows the missing widening.

#### Named Defects

- D1346: The package workspace listing keeps only Vitest workspaces (AC1, AC2)
- D1347: peerDependencies is not read (AC3)
- D1348: An npm: alias is read as a registry package (AC3)
- D1349: A file: dependency is read as a registry package (AC3)
- D1350: A dependency named by its key and by its workspace:* spec records the same edge twice (AC3)
- D1351: A manifest edge's producer drops the field and key (AC3)
- D1352: The root resolutions field is not read (AC3)
- D1353: A nested override object is not walked (AC3)
- D1354: A $name override resolves through its own key, not the referenced root dependency (AC3)
- D1355: An override resolving to no listed workspace widens nothing (AC3, AC4)
- D1356: A test module in another package workspace adds no edge (AC3)
- D1357: Through a linked consumer root a test module's real path matches no workspace (AC3)
- D1358: Setup files add no edge (AC3)
- D1359: Global setup files add no edge (AC3)
- D1360: An unnormalized setup file path adds no edge to its workspace (AC3)
- D1361: An alias replaced by an absolute path adds no edge (AC3)
- D1362: An alias replaced by a package subpath names no package (AC3)
- D1363: A capture alias's path prefix does not reach the workspaces below it (AC3)
- D1364: A capture alias's name prefix must equal a package name (AC3)
- D1365: On Windows a capture alias's directory match is case-sensitive (AC3)
- D1366: A missing package.json reads as an empty manifest (AC4)
- D1367: An unparseable package.json reads as an empty manifest (AC4)
- D1368: A package.json holding a JSON array reads as a manifest (AC4)
- D1369: A dependency field holding an array is read by index (AC4)
- D1370: A non-string dependency spec is read as external (AC4)
- D1371: A local path resolving outside every listed workspace is taken as resolved (AC4)
- D1372: A ~/ path lands in the declaring workspace and widens nothing (AC4)
- D1373: workspace:other@* resolves through the key, so an unlisted other widens nothing (AC4)
- D1374: A Vitest workspace whose tests are not known depends on nothing extra (AC4)
- D1375: The tests-not-known widening's cause drops discovery's reason (AC4)
- D1376: An alias replaced by a relative path widens nothing (AC4)
- D1377: An alias replaced by an empty string widens nothing (AC4)
- D1378: An alias replaced by a bare $1 widens nothing (AC4)
- D1379: An incomplete listing still counts the package names as complete (AC4)
- D1380: A dependency naming no listed workspace widens while the listing is complete (AC4)
- D1381: An unreadable listed manifest leaves the package names counted as complete (AC4)
- D1382: While the listing is incomplete, an alias naming no listed package widens nothing (AC4)
- D1383: While the listing is incomplete, an override naming no listed package widens nothing (AC4)
- D1384: Ownership compares by bare string prefix (AC1)
- D1385: The first holding workspace owns a path instead of the deepest (AC1)
- D1386: Selected tests carry no reason naming the path (AC1)
- D1387: The dependents walk stops after direct dependents (AC2)
- D1388: A reason does not name the workspaces along its chain (AC2)
- D1389: A longer path replaces a workspace's shortest chain (AC7)
- D1390: A workspace keeps only the last changed path's reasons (AC7)
- D1391: A path's later trigger replaces its earlier reason (AC7)
- D1392: A path that selected nothing carries no reason (AC7)
- D1393: bun.lockb is not a lockfile name (AC5)
- D1394: A project-wide fallback selects only the path's dependents (AC5)
- D1395: A package.json change is a plain path (AC5)
- D1396: A root-owned path is a plain change while other workspaces are listed (AC5)
- D1397: A root-owned path is project-wide when the root is the only workspace (AC5)
- D1398: A path owned by a non-Vitest directory with no package.json selects nothing (AC5)
- D1399: A Vitest workspace with no package.json is a missing-manifest fallback (AC5)
- D1400: A config file name outside every Vitest workspace is a plain path (AC5)
- D1401: A config file in a Vitest workspace's subdirectory counts as inside it (AC5)
- D1402: A config file in a Vitest workspace's directory is project-wide (AC6)
- D1403: A workspace config fallback does not name its trigger (AC6)
- D1404: Vite config file names are not config files (AC6)
- D1405: A setup file change is not a fallback (AC6)
- D1406: A workspace-scoped fallback does not select its dependents (AC6)
- D1407: A global setup file change is not a fallback (AC6)
- D1408: A setup file named unnormalized never matches the changed path (AC6)
- D1409: The selected Vitest workspace count reports every runnable workspace (AC8)
- D1410: The total test count reports only the selected tests (AC8)
- D1411: The selected test count is complete while a selected workspace's tests are not known (AC8)
- D1412: The total test count is complete while a workspace's tests are not known (AC8)
- D1413: The total test count is complete while a listing reports a source not read (AC8)
- D1414: The Vitest listing's unread sources leave the total workspace count complete (AC8)
- D1415: The package listing's unread sources leave the total workspace count complete (AC8)
- D1416: A selection drops the Vitest listing's unread sources (AC8)
- D1417: A not-runnable workspace is reported among a path's selected workspaces (AC8)
- D1418: A path's report drops the not-runnable workspaces it reached (AC8)
- D1419: The counts report no not-runnable workspaces (AC8)
- D1420: A path reaching only not-runnable workspaces says none depends on it (AC8, AC9)
- D1421: A widening reached only through a not-runnable workspace is reported as used (AC8)
- D1422: A widening that selected a workspace is not reported as used (AC4)
- D1423: A change selecting no test is shaped like a successful selection (AC9)
- D1424: A selection of only tests-not-known workspaces is reported as nothing selected (AC9)
- D1425: A selected workspace with no known tests counts as a selection (AC9)
- D1426: A selection does not carry the policy version (AC11)
- D1427: A refused change does not carry the policy version (AC11)
- D1428: An absolute path is not refused (AC12)
- D1429: A drive-relative path such as C:foo is not refused (AC12)
- D1430: A path is checked for leaving the root before normalization (AC12)
- D1431: A path leaving the root through a backslash is not refused (AC12)
- D1432: A refused path after a valid one still yields a selection (AC12)
- D1433: An override key's parent chain is not split off, so its workspace:* edge becomes a widening (AC3)
- D1511: An alias replaced by a directory holding several workspaces reaches only its own holder (AC3)
- D1512: An alias replaced by a partial bare name reaches no package it begins (AC3)
- D1513: A $<name> reference is read as literal text (AC3)
- D1514: An alias path prefix holding .. is compared as written (AC3)
- D1515: A local path whose link carries it into another workspace yields only its listed holder (AC3)
- D1516: The dependents walk cache keys every start set alike (AC2, AC7)
- D1517: A path that selected nothing does not name the listing's unread sources (AC8, AC9)
- D1518: A changed path normalizing to exactly .. is not refused (AC12)
- D1519: Change paths are not normalized, so one path given two ways is two paths (AC1, AC7)
- D1520: A widening reached only by a plain package workspace is reported as used (AC4)
- D1521: The selection-level not-runnable list drops the caller's not-runnable workspaces (AC8)
- D1522: A $name override referencing an undeclared root dependency adds no widening (AC4)
- D1523: An override value neither a string nor an object adds no widening (AC4)
- D1524: A bare .. dependency adds no edge to the parent workspace (AC3)

#### Deliberately Untested

- AC10 (`packages/daemon/src/selection/workspace-graph.ts`, `select-tests.ts`): selection keeps no state between calls and builds from `node:fs` reads alone; no line exists whose mutation breaks either, since a defect would have to add a cache, stored input or module load.
- `packages/daemon/src/selection/select-tests.ts` `if (context.notRunnable.has(workspace)) continue;` in `assemble`: inert, since `selectedWorkspaces` and `selectedTests` iterate only the runnable workspaces; D1417 pins the per-path report.
- `packages/daemon/src/selection/select-tests.ts` `posix.isAbsolute(path) ||` in `refusalReason`: inert, since `win32.parse` gives `/etc` a root too; D1428 pins the refusal.
- `packages/daemon/src/selection/select-tests.ts` the visited check in `walkDependents` on a cycle: removing it never terminates, which the defect checker counts as a timeout, not a detection; D1389 pins the same check on an acyclic graph.
- `packages/daemon/src/selection/selection-types.ts`: types and constants only.
- `packages/daemon/src/selection/package-specs.ts` the `**/` strip in `overrideKeyPackage`: inert, since taking the last one or two `/` segments already drops a Yarn `**/` prefix.
- `packages/daemon/src/selection/package-specs.ts` `|| isAbsolute(spec)` in `isLocalPath`: on POSIX every absolute path begins with `/`, which `RELATIVE_PATH_PREFIXES` already matches, so the mutation is observable only on Windows and would survive the Linux gate (C156).
- `packages/daemon/src/selection/workspace-graph.ts` the catch in `isAbsent`: no portable fixture denies a stat on a `package.json` whose directory still lists, on Windows or Linux, so the unreadable-not-missing branch cannot be driven.

### Review Record

Review session: threadId 7d1933d2-d06a-45ce-a388-3f9fa78a79dd

Fixes (review, 19:40), each verified against installed Vite 8.3.1, Vitest 4.1.11 and 5.0.1:

- **Every alias reaches by prefix.** Vite applies an alias with `importee.replace(find, replacement)` (`vite/dist/node/chunks/node.js` 3452), which keeps the unmatched rest of the import, so an alias with no replacement reference reaches every workspace under its replacement directory, and `@s` to `@scope` reaches every `@scope/` package. `aliasResolution` now treats every replacement as the prefix before its first reference; the reference pattern adds `$<name>`, `` $` `` and `$'`; and a path prefix is normalized before the directory match, since Vite keeps `..` as written (2921-2932). `packageOfSpecifier` lost its last caller and was removed (C59).
- **`holdersOf`** returns the nearest holder of a path and of its real path, so a link from one workspace into another yields both edges.
- **A `package.json` that cannot be stat'ed** is unreadable, not missing, so its workspace's name counts as not read.
- **The nothing-selected detail** says "no listed Vitest workspace" and names each source either listing did not read.
- Changed paths deduplicate through a `Set`, and each dependents walk is reused by its start set within one call.

Tech debt, not fixed here:

- The root-escape test is written three times: `liesInside` in `packages/daemon/src/vitest/find-workspaces.ts`, the root clause of `holdsRelativePath` in `packages/daemon/src/selection/graph-state.ts` (with its own `PARENT_PATH`), and `refusalReason` in `packages/daemon/src/selection/select-tests.ts` (with its own `PARENT_SEGMENT`), beside the private `PARENT_SEGMENT` in `find-workspaces.ts`.

#### Test Coverage Gaps

Re-anchors (the fix round moved each record's `old` text; the defect sentence stands):

| Record | File                                            | New `old`                                                                                                       | New `new`                                                                     |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| D1356  | `packages/daemon/src/selection/vitest-edges.ts` | `    for (const holder of holdersOf(graph, resolve(base, directory))) {`                                        | `    for (const holder of holdersOf(graph, base)) {`                          |
| D1361  | `packages/daemon/src/selection/vitest-edges.ts` | `    return { ok: true, paths: aliasPathTargets(graph, prefix) };`                                              | `    return { ok: true, paths: [] };`                                         |
| D1362  | `packages/daemon/src/selection/vitest-edges.ts` | ``        prefix.startsWith(`${name}${POSIX_SEPARATOR}`),``                                                     | `        false,`                                                              |
| D1363  | `packages/daemon/src/selection/vitest-edges.ts` | `    if (begun && !paths.includes(path)) paths.push(path);`                                                     | (empty)                                                                       |
| D1371  | `packages/daemon/src/selection/graph-state.ts`  | `  return holders.length === 0\n    ? {`                                                                        | `  return holders.length === 0 && path.startsWith(HOME_PATH_PREFIX)\n    ? {` |
| D1372  | `packages/daemon/src/selection/graph-state.ts`  | `  const holders = path.startsWith(HOME_PATH_PREFIX)`                                                           | `  const holders = false`                                                     |
| D1378  | `packages/daemon/src/selection/vitest-edges.ts` | ``const REPLACEMENT_REFERENCE = /\$(?:\d                                                                        | &                                                                             | <   | `   | ')/;`` | `const REPLACEMENT_REFERENCE = /\$(?:never)/;` |
| D1392  | `packages/daemon/src/selection/select-tests.ts` | `      selected.length > 0\n        ? undefined\n        : nothingSelectedReason(context, owner, notRunnable),` | `      undefined,`                                                            |

New gaps, each a defect no named test catches:

| Source                                     | Defect                                                                                                                                                                                                                                                   | Expected test                                                                                                                                                                                                                            | Severity |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `vitest-edges.ts` `aliasPathTargets`       | An alias with no replacement reference, replaced by a directory holding several workspaces (`/root/packages`), reaches only the directory's own holder, so a change in `packages/b` misses the Vitest workspace that imports it through the alias (AC3). | Alias `@lib` to `<root>/packages`: a change in `packages/b` selects `app`. Mutation: `    if (begun && !paths.includes(path)) paths.push(path);` to empty.                                                                               | HIGH     |
| `vitest-edges.ts` `namesBegunBy`           | An alias with no replacement reference replaced by a partial bare name (`@x`) reaches no package it begins, so a change in `@x/b`'s workspace misses the dependent (AC3).                                                                                | Alias `@s` to `@x`: a change in `packages/b` (`@x/b`) selects `app`. Mutation: `        name.startsWith(prefix) \|\|` to `        name === prefix \|\|`.                                                                                 | HIGH     |
| `vitest-edges.ts` `REPLACEMENT_REFERENCE`  | A `$<name>` reference is read as literal text, so `<root>/packages/$<pkg>/src` reaches only the root (AC3).                                                                                                                                              | Alias to `<root>/packages/$<pkg>/src`: a change in `packages/b` selects `app`. Mutation: drop `\|<` from the pattern.                                                                                                                    | HIGH     |
| `vitest-edges.ts` `aliasPathTargets`       | A path prefix holding `..` (`<root>/app/../packages/$1`) is compared as written and reaches no workspace below it (AC3).                                                                                                                                 | That alias: a change in `packages/b` selects `app`. Mutation: `comparable(normalize(prefix))` to `comparable(prefix)`.                                                                                                                   | HIGH     |
| `graph-state.ts` `holdersOf`               | A local path or test-module directory whose listed spelling lies in one workspace and whose real path, through a link, lies in another yields only the nearer holder, so a change in the other misses the dependent (AC3).                               | `file:../b/l` where `packages/b/l` is a junction into `packages/c/deep`: a change in `packages/c` selects the dependent. Mutation: `  const targets = real.ok ? [absolute, real.path] : [absolute];` to `  const targets = [absolute];`. | HIGH     |
| `select-tests.ts` `walkDependents`         | The walk cache keys every start set alike, so a second changed path reuses the first path's dependents (AC2, AC7).                                                                                                                                       | Two paths in unrelated workspaces each select their own dependents. Mutation: `  const key = starts.join(WALK_KEY_SEPARATOR);` to `  const key = "";`.                                                                                   | HIGH     |
| `select-tests.ts` `unlistedNote`           | While a listing reports a source not read, a path that selected nothing says as fact that no Vitest workspace depends on it (AC8, AC9).                                                                                                                  | Tree with `pnpm-workspace.yaml`; a path selecting nothing names `pnpm-workspace.yaml` in its `nothingSelected.detail`. Mutation: `  return sources.length === 0` to `  return true`.                                                     | MEDIUM   |
| `select-tests.ts` `refusalReason`          | A changed path of `..` (or `a/../..`) is not refused, and yields a nothing-selected selection instead (AC12).                                                                                                                                            | Change `["a/../.."]` is refused. Mutation: `      normalized === PARENT_SEGMENT \|\|` to empty.                                                                                                                                          | MEDIUM   |
| `select-tests.ts` `selectTests`            | A change path given as `./packages/app/x.ts` is not normalized, so it is root-owned and becomes a project-wide fallback; or a path given twice doubles its reasons (AC1, AC7).                                                                           | Change `["./packages/app/x.ts", "packages/app/x.ts"]` yields one path report, `packages/app/x.ts`, with one reason per workspace. Mutation: `    paths.add(normalizeRelativePath(raw));` to `    paths.add(raw);`.                       | MEDIUM   |
| `select-tests.ts` `triggerReasons`         | A widening reached only by a plain package workspace, selecting no Vitest workspace, is reported as used (AC4).                                                                                                                                          | A change reaching only a plain package with an unreadable manifest and no Vitest dependent reports `widenings` as `[]`. Mutation: `      .filter(([workspace]) => context.vitestPaths.includes(workspace))` removed.                     | LOW      |
| `select-tests.ts` `assemble`               | The selection-level `notRunnable` list drops the caller's not-runnable workspaces and their reasons (AC8).                                                                                                                                               | Assert the top-level `notRunnable` paths and reasons. Mutation: `    notRunnable: input.notRunnable,` to `    notRunnable: [],`.                                                                                                         | LOW      |
| `workspace-graph.ts` `overrideResolutions` | A `$name` override naming a root dependency the root does not declare adds no edge and no widening (AC4).                                                                                                                                                | `overrides: { "b": "$missing" }`: a change in any workspace selects `app`. Mutation: `  if (specs.length === 0) {` to `  if (false) {`.                                                                                                  | MEDIUM   |
| `workspace-graph.ts` `overrideResolutions` | An override value that is neither a string nor an object (`1`, `[]`) adds no widening (AC4).                                                                                                                                                             | `overrides: { "b": 1 }`: a change in any workspace selects `app`. Mutation: `  if (typeof entry.value !== "string") {` to `  if (false) {`.                                                                                              | MEDIUM   |
| `package-specs.ts` `isLocalPath`           | A dependency spec of bare `..` or `.`, or a bare absolute path, parses as a registry range and adds no edge (AC3).                                                                                                                                       | A dependency on `..` from `packages/app/sub` resolves to its parent workspace; an absolute path spec to `packages/b` adds the edge. Mutations: drop `RELATIVE_PATH_NAMES.includes(spec) \|\|`; drop `\|\| isAbsolute(spec)`.             | LOW      |
| `workspace-graph.ts` `isAbsent`            | A `package.json` that exists but cannot be stat'ed reads as missing, so its workspace's name counts as read and a dependency on it counts as external (AC4).                                                                                             | If no portable fixture can deny a stat, record it as deliberately untested with that reason. Mutation: `    return false;` in `isAbsent`'s catch to `    return true;`.                                                                  | LOW      |

### Completion Notes

- **Built.** `findPackageWorkspaces` beside `findVitestWorkspaces`, both through one `listWorkspaces` (same expansion, outside-root refusal and real-path dedup; `findVitestWorkspaces`'s result unchanged). `buildDependencyInformation` (`workspace-graph.ts`) reads each package workspace's `package.json` into edges with producers (manifest, override, test module, setup file, alias) and widenings with causes; `graph-state.ts` holds the shared graph record, containment lookup and spec resolution, `vitest-edges.ts` the Vitest-only producers, `package-specs.ts` the dependency-spec and override-key parsing. `selectTests` (`select-tests.ts`) is pure over its input. `find-workspaces.ts` now exports `liesInside`, `joinPath`, `realPath`, `readJson`, `objectField`, `PACKAGE_JSON`, `ROOT_PATH`, `POSIX_SEPARATOR` and the `PackageWorkspace` alias for the graph (C5, C8). The graph split into four files because one file passed the 500-code-line cap.
- **Sanity check (dev, 18:40).** F1: AC8 keyed workspace-total completeness on the package listing only; the author amended AC8 and the selection task to take `findVitestWorkspaces`' `notRead` too (TICKET UPDATED). F2: the Sizing note's delegation line; the author reworded it. No delegation: one chain.
- **Assumptions.** U1 FALSE for overrides and resolutions, re-planned with the author (AC3 amended, 18:46, adding `npm:` aliases and `$name` references); U2 CONFIRMED. Sources beneath the table.
- **Adversarial review (19:01).** 11 findings. Fixed inline: F1 unreadable manifests make the name set incomplete; F2 `workspace:other@*` gets its own target kind and widens when unresolved; F3 `$name` overrides key on the referenced name; F4 one shared root-relative normalizer for change paths and setup files; F5 capture-alias directory match ignores case on Windows; F6 total test count incomplete while a listing is; F8 widenings recorded only for runnable workspaces; F9 drive-relative paths refused; F10 test-module holders resolved once per module directory and one edge per holder; F11 `holderDirectories` rename. F7 (a listed directory with no `package.json` owned its paths, skipping AC5) went to the author, who ACCEPTED a new project-wide `owner-without-manifest` fallback and amended AC5 (19:02); built, with `DependencyInformation.withoutManifest` carrying the list so selection stays pure. My own probe also found and fixed a duplicate edge when a dependency's key and its `workspace:*` spec both name the workspace. Post-fix: prettier, daemon typecheck and oxlint exit 0.
- **Evidence.** A scratch fixture under `_agent-docs/.scratch/2-2/` (removed) drove `findPackageWorkspaces`, `buildDependencyInformation` and `selectTests` through segment ownership (`packages/ab` never owned by `packages/a`), manifest, override, test-module and setup edges, unknown-test and missing/unreadable-manifest widenings, every trigger kind but `manifest`, not-runnable reporting, both nothing-selected reasons, incomplete counts, the policy version and both refusals. `manifest` and AC10's file-reads-only rule are traced in code: the graph reads only through `existsSync`, `readJson` and `realpathSync`, and nothing imports `vitest` or `vite`.
- **Open.** Selection has no production caller until 2.3 (C59, accepted). Source imports and tsconfig links are 2.2b's.
- **README.** No change: nothing user-visible changed, since selection is not wired into the daemon or CLI.
- **Change-request candidates.** None.

### File List

Dev session (2.2):

- `packages/daemon/src/vitest/find-workspaces.ts` (modified)
- `packages/daemon/src/selection/selection-types.ts` (created)
- `packages/daemon/src/selection/package-specs.ts` (created)
- `packages/daemon/src/selection/graph-state.ts` (created)
- `packages/daemon/src/selection/vitest-edges.ts` (created)
- `packages/daemon/src/selection/workspace-graph.ts` (created)
- `packages/daemon/src/selection/select-tests.ts` (created)
- `_agent-docs/tickets/2-2-workspace-selection.md` (modified: tasks, criteria, assumption resolutions, Dev Agent Record)

Planning files the create-ticket run wrote:

- `_agent-docs/tickets/2-2-workspace-selection.md` (created)
- `_agent-docs/tickets/2-2b-undeclared-edges.md` (created, the split's second part)
- Held for the orchestrator, as exact text: the sprint-2 file's 2.2 scope line and new 2.2b section, `_agent-docs/sprint-status.yaml` (2.2 to `ready-for-dev`, the new `2-2b-undeclared-edges` key), FR7's marker in `docs/requirements.md`, and the `docs/architecture.md` and `docs/glossary.md` text.

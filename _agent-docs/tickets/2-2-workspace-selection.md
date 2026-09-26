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

- [ ] AC1: A changed path belongs to the deepest package workspace whose directory holds it. A changed path whose package workspace is a Vitest workspace selects that Vitest workspace, and each of its tests carries a reason naming the path.
- [ ] AC2: A changed path also selects every Vitest workspace that depends on its package workspace, directly or through a chain of package workspaces, whether or not the package workspaces along the chain hold a Vitest config. The reason names the path and each workspace along the chain.
- [ ] AC3: A package workspace depends on another when its `package.json` `dependencies`, `devDependencies`, `peerDependencies` or `optionalDependencies` names the other's package name, as the dependency's key or as the package an alias installs, or points into the other's directory by a local path. A Vitest workspace also depends on every package workspace that holds one of its discovered test modules or one of its setup or global setup files, and on every package workspace one of its resolved config aliases points into by path or names as a package. Each dependency records its producer (the manifest field, test module, setup file or alias that produced it), and the selection reason quotes it.
- [ ] AC4: Uncertain dependency information widens and never narrows. A package workspace whose `package.json` is missing or cannot be read or parsed, and a dependency whose local path or workspace-protocol spec resolves to no listed package workspace, make that workspace depend on every package workspace. A Vitest workspace whose tests are not known depends on every package workspace, since its test modules may lie in any of them. So does one with an alias replacement that is neither an absolute path nor a bare package name. While the package workspace listing is incomplete (any source it reports as not read), a dependency or alias naming no listed package workspace does the same; while the listing is complete, such a name is an external package and adds no edge. Each widening names its cause, and the selection reason of every test it adds quotes it.
- [ ] AC5: Each of these changed paths is a project-wide broad fallback that selects every Vitest workspace and names the path and its trigger kind: a lockfile of a supported package manager, in any directory; any `package.json`; a path whose package workspace is the consumer root while the listing holds another package workspace; and a Vitest or Vite config file name in a directory that is not a Vitest workspace.
- [ ] AC6: A changed Vitest or Vite config file name in a Vitest workspace's directory is a broad fallback that selects that Vitest workspace and its dependents (AC2). A changed path that is a setup file or global setup file of a Vitest workspace is a broad fallback that selects every Vitest workspace naming it, wherever the file lies, and their dependents (AC2). Each names the path and its trigger kind.
- [ ] AC7: Every selected test carries every reason that selected it, not only the first: one reason per changed path or broad fallback that selected its workspace, each with one shortest dependency chain. Every changed path is reported with the Vitest workspaces it selected and why, including a path that selected none, with the reason it selected none.
- [ ] AC8: A selection reports its selected and total test counts and its selected and total Vitest workspace counts. A selected Vitest workspace whose tests are not known is reported with an unknown test count, and the selected test count then says it is incomplete; any Vitest workspace whose tests are not known makes the total test count say it is incomplete. Neither count treats that workspace as zero tests. While the package workspace listing is incomplete, the selection names each source not read, and its total Vitest workspace count says it is incomplete. A Vitest workspace the caller passes as not runnable, with its reason, is never selected: a changed path that would select it reports it with that reason, and the counts report it apart from the runnable ones.
- [ ] AC9: A change that selects no test and no Vitest workspace whose tests are not known yields a selection that states nothing was selected and names each changed path's reason, never a result shaped like a successful empty selection.
- [ ] AC10: A selection depends only on the change, the package workspace listing, the package manifests, and each Vitest workspace's discovered tests, setup files and resolved config aliases: the same inputs always select the same tests, and no stored result, prior run or coverage removes a test. Building the dependency information reads files only; it loads no Vitest, no config and no test module.
- [ ] AC11: Every selection carries the selection policy version.
- [ ] AC12: A changed path that is absolute, or that leaves the consumer root, is refused with an error naming the path, and no selection is returned for that change.

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

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing.
- [ ] (AC1, AC2, AC4, AC5) In `packages/daemon/src/vitest/find-workspaces.ts`, export a listing of every package workspace, not only the Vitest ones: the consumer root first, then each directory the root `package.json` `workspaces` patterns expand to, each with its `/`-separated root-relative path (`.` for the root) and its directory, typed by the `{ path, directory }` shape `VitestWorkspace` already declares (C14). Build it from the helpers `findVitestWorkspaces` already uses (`workspaceDirectories`, with its outside-root refusal, and `duplicateReason`'s first-listed real-path dedup), so the two listings expand, refuse and deduplicate by one rule (C8). It reports every source it could not read, as `findVitestWorkspaces` does. Leave `findVitestWorkspaces`'s result unchanged, entries and `notRead` order included; the existing find-workspaces tests stay green.
- [ ] (AC3, AC4, AC10) Create the dependency information in `packages/daemon/src/selection/` (for example `workspace-graph.ts`). From the consumer root, the package workspace listing, and each Vitest workspace's discovered test identities (or none known), setup and global setup files and resolved config aliases, read each package workspace's `package.json` (its `name` and the dependency fields AC3 names) and record each dependency with the field that produced it: a key or alias target matching a listed package workspace's `name`, or a local path resolving into a listed package workspace's directory. Add a test-module dependency from each Vitest workspace to every package workspace holding one of its test modules, resolving `modulePath` against the workspace's real directory as `module-tests.ts` computed it, and match it, and each local dependency path, against each package workspace's real directory, so a symlinked consumer root or workspace still yields the edge. Add a setup-file dependency for each setup or global setup file, and an alias dependency for each resolved config alias whose replacement is a path into another package workspace or a bare name of a listed package (a replacement holding a capture reference such as `$1` resolves by its text before the reference). Record each AC4 uncertainty with its cause. Keep the edge set open to more producers: ticket 2.2b adds source-import and tsconfig edges through the same edge and uncertainty types. Read files only through `node:fs`: no runtime import from `vitest` or `vite`, and no `import()`, `require` or config loader applied to a consumer file (AC10).
- [ ] (AC1, AC2, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12) Create the selection in `packages/daemon/src/selection/` (for example `select-tests.ts`): a pure function over the change (root-relative `/`-separated paths), the dependency information, and the selectable Vitest workspaces, each with its discovered tests or none known, its setup and global setup files as root-relative paths, and its resolved config aliases (each a find and a replacement, the replacement an absolute path or a bare package name as Vite's resolved config holds it). The setup files and aliases are required inputs, never optional. The caller also passes each Vitest workspace it will not run (not confirmed at start, unsupported) with its reason, so AC8 reports it truthfully. Refuse an absolute or root-escaping path first (AC12). Find each path's deepest package workspace by path-segment prefix, never by bare string prefix (`packages/a` never holds `packages/ab/x`). Apply the broad fallbacks (AC5, AC6), then the dependents closure (AC2) as a breadth-first walk with a visited set, so a dependency cycle ends, recording for each reached Vitest workspace one shortest chain of workspaces from the changed path and each edge's producer along it (AC2, AC3, AC7). The walk follows every edge kind, test-module, setup-file and alias edges included, so a workspace depending on a Vitest workspace's package is reached through it too; that over-selects and never narrows. Return the selection with each selected test and all its reasons, each changed path with what it selected, the counts (AC8), an explicit nothing-selected state (AC9), the widenings and fallbacks it used (C11), and the policy version (AC11). Name every trigger kind, reason kind and lockfile name as a constant (C3).
- [ ] (Support) Report to the orchestrator, as exact text, the `docs/architecture.md` § Current implementation sentences that replace "Nothing yet builds fingerprints or selects tests", and any glossary entry the grill settled; do not edit either file.
- [ ] (Support) Lint and typecheck.

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

About 11 raw files, 14 estimated: the four production files Execution Metadata lists; for create-tests, a selection test file with its own `defects.json` under `packages/daemon/test/selection/` (kept apart from the `packages/daemon/test/defects.json` 1.3's tests write), `find-workspaces.test.ts` for the new listing, and a fixture tree or two under `test/fixtures/daemon/`; and the `docs/architecture.md` and `docs/glossary.md` text the orchestrator writes. Code units: 12 criteria plus validation, 13. Implementation is delegated to implementer agents, since the estimate is above 10.

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

- `_agent-docs/tickets/2-2-workspace-selection.md` (created)
- `_agent-docs/tickets/2-2b-undeclared-edges.md` (created, the split's second part)
- Held for the orchestrator, as exact text: the sprint-2 file's 2.2 scope line and new 2.2b section, `_agent-docs/sprint-status.yaml` (2.2 to `ready-for-dev`, the new `2-2b-undeclared-edges` key), FR7's marker in `docs/requirements.md`, and the `docs/architecture.md` and `docs/glossary.md` text.

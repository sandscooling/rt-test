# Ticket 4.1: Kept dependency graph

## Ticket

As a coding agent saving edits in a consumer the daemon serves,
I want the daemon to keep its dependency graph for its life and read again only the files my save changed,
so that a run starts seconds sooner after each save, and the later tickets select by test module from records the daemon already holds.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: A scan of the consumer yields one record for each source file it walks. The record answers, for that file: each path specifier with the root-relative path it names, its query or hash suffix left off, and the package workspaces holding that path, or that the path lies outside the consumer root; each specifier that is a package name, an alias's rewrite or a tsconfig `paths` key with the package workspaces it resolves into; each glob with its pattern and the root-relative directory it is globbed from; whether the file holds a module path computed at run time; each of Node's own built-in modules it imports, named with the `node:` prefix whether or not the file wrote it; or, for a file that could not be read or parsed, the kind and the reason. A module path computed at run time is the specifier argument of any call form the scan reads (quoted in Dev Notes) that is neither a string literal nor a template with no substitution. A specifier is a tsconfig `paths` key when a key matches it in a tsconfig or jsconfig, own or inherited, of the file's own package workspace or of a package workspace its directory lies under. (FR27)
- [ ] AC2: After a change in which every changed input path is a source file and the discovery in effect reports the aliases the records were read under, the dependency build reads and parses only these source files: each whose content changed since the kept records were read, each the walk finds that the records do not hold, and each the tracker holds no digest for. The record of a file the walk no longer finds is dropped. (FR27)
- [ ] AC3: After every recorded build, the records the daemon keeps and the dependency information it selects by equal, record for record, edge for edge and widening for widening, each list in the same order, what a build that reads every file yields over the consumer as it then stands and the same discovery. The exceptions are the two Dev Notes name under `Known limits`: a link to a file that was given another target, and a file the scan reads that is neither an input nor a source file. (FR27, NFR2)
- [ ] AC4: A build reads every file when the daemon keeps no records, when any input path that changed since the kept records were read is not a source file by the walk's own list of extensions (such as a manifest, a tsconfig or jsconfig, a lockfile, an ignore file or a link to a directory), and when the discovery in effect reports, for any selectable workspace, other aliases than the records were read under, or the same aliases under another Vitest workspace. (FR27)
- [ ] AC5: A newly stored discovery whose selection input gives the build the same things to read as the discovery it replaces (each selectable workspace's path and directory, its test module paths or why its tests are not known, its setup files, its global setup files and its aliases) starts no dependency build, while the latest build over the replaced discovery ended built or a build over it is still running. Every workspace then keeps the fingerprint it had, at the revision of the build it came from, every answer and the round's selection read the new discovery's tests and protection over the dependency information already kept, and a build running when the discovery arrives is recorded when it ends, never discarded for that arrival. (FR27)
- [ ] AC6: A newly stored discovery that gives the build something else to read starts one build at the current input revision. That build carries every record whose file is unchanged, and reads every file only under AC4. A build running when such a discovery arrives is discarded, as it is today. (FR27)
- [ ] AC7: A build that fails, times out or is discarded changes no kept record, so the next build still reads every source file changed since the kept records were read. While no build over the discovery in effect ended built and none is running, a new discovery starts a build as it does today, whatever it gives the build to read. (FR27)
- [ ] AC8: The dependency information derived from the records selects exactly what today's does, on every tree, with the one exception of the link AC3 names: every existing test of the scan, of selection and of the edit corpus passes with no expectation changed; this ticket does not raise `SELECTION_POLICY_VERSION`; the edges a tsconfig's `paths` targets produce for its package workspace stay as they are, whether or not any file uses the key; and the edit corpus reports no duplicate execution and no selection miss. No existing test's expectation changes except a lifecycle test that rests on a new discovery starting a build; Dev Notes name the ones found and how they were found. (NFR1, NFR2)
- [ ] AC9: In a build that reads only some files, a file that ends the executor process inside the parser fails the build with a reason naming the process's exit and that file's root-relative path, and a stop ends the build at once, as in a build that reads every file. (FR27)
- [ ] AC10: The log's entry for a build's start, which still begins `dependency build started at input revision <n>`, says whether the build reads every file and why, or how many records it carries. The entry for a recorded build's end, which still begins `dependency build ended at input revision <n>`, says how many source files it read, how many records it carried and how many it dropped, beside the build's wall time in milliseconds. A build that failed, timed out or was discarded keeps the entry it has today. A newly stored discovery that starts no build is logged once, with that reason. (FR27)
- [ ] AC11: No sentence in `docs/architecture.md`, in a code comment or in a test title still says that a dependency build runs after each new discovery, that a build reads or parses every source file, or that a discovery stored with a run's lists starts a build, and `docs/architecture.md` states what is now true. Every line the sweep in Dev Notes (`The prose sweep`) prints after the change is still true. The sweep is a floor and not the proof: the sections of `docs/architecture.md` listed under References and every comment of `daemon/dependency-builds.ts` are read in full. (FR27)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                    | Why it matters if wrong                                                                          | How to check                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Under `resolve: { tsconfigPaths: true }`, can a tsconfig outside the importer's own package workspace and the package workspaces above it give that importer a path mapping (a `references` target, an `include` reaching another directory)? | AC1 would leave such a specifier unplaced, and ticket 4.7 would read it as an installed package. | Read how Vite 8 picks the tsconfig for an importer in its documentation for `resolve.tsconfigPaths` and in the installed source, or import through such a mapping in a two-workspace fixture. |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing. A yes to U1 changes AC1's definition of a tsconfig `paths` key: stop and bring it to the orchestrator before any edit.
- [ ] (Support) Before the first edit, read lane scan-widening's landed change in `selection/workspace-graph.ts` (`addSourceFileEdges` and `inputLabel`) and `selection/graph-state.ts` (`uncertain` and its `file`), and build on it: a failed read or parse keeps naming its file on the widening it raises, by the same rule. If the landed code differs from Dev Notes, `Sequencing with lane scan-widening`, bring the difference to the orchestrator before the first edit.

The scan, in `packages/daemon/src/selection/`. No file below is shared with the second group.

- [ ] (AC1) `source-imports.ts`: `readSourceImports` also reports whether any call form it reads carried a specifier argument that is not a literal, a glob array's elements included.
- [ ] (AC1, AC3) Create `source-records.ts`: the record's type, plain data that crosses the executor's channel as JSON, and the making of one file's record. A record holds the file's root-relative label and either why it was not read, or its specifiers in order, each with what the scan resolved it into (the root-relative path it names and the package workspaces holding it, the package workspaces a name resolves into, a glob's pattern and directory), the computed flag, and the built-ins by `isBuiltin`. It also holds every edge and widening the file contributes, in the order the scan adds them today and before any is dropped as a repeat, each with the key `once` is asked for it, so a replay through `once` in walk order yields what a read yields. Move the body of `addSourceFileEdges` here, with `inputLabel`, since `workspace-graph.ts` stands at 461 of 500 code lines. A record also holds its file's input label, the label `inputLabel` gives, or that it has none.
- [ ] (AC1) `tsconfig-edges.ts`: give the scan each walked config's `paths` keys, own or inherited, with the package workspaces their targets reach, read before the workspace's source files are and without changing the order its own edges and widenings are added in. A bare specifier that a key of the file's package workspace, or of one above it, matches takes those workspaces in its record. A key matches as TypeScript matches one: exactly, or by the text before and after its one `*`. This placement lives in the record alone: it adds no edge and no widening, so the dependency information stays what it is today.
- [ ] (AC2, AC3, AC8, AC9) `workspace-graph.ts`, `specifier-edges.ts`, `alias-specifiers.ts`: `buildDependencyInformation` takes the carried records and returns, beside the dependency information, the record of each source file it read and the root-relative path of every source file it walked. A walked file with a carried record is not read: its contributions are replayed from the record. A walked file without one is read through `observedParse`, as every read is today. Everything else the scan reads (manifests, tsconfigs, links, the walk, git's ignored paths, the Vitest edges) runs in every build as it does today. Called with nothing carried it yields today's dependency information, so the scan's tests call it as they do.
- [ ] (AC4) `source-walk.ts`: export the question "is this root-relative path a source file", answered from `SOURCE_EXTENSIONS`, so the daemon and the walk read one list.
- [ ] (AC8) Leave `selection-types.ts`, `graph-state.ts` and `select-tests.ts` as lane scan-widening leaves them, and `selection-input.ts` and `SELECTION_POLICY_VERSION` as they are. If an existing test of the scan or of selection would need an expectation changed, stop and bring it to the orchestrator before changing anything: that is a selection policy version raise.

The daemon's builds, in `packages/daemon/src/daemon/`. This group starts once the scan's new signature exists.

- [ ] (AC2, AC9) `executor-jobs.ts`, `executor-main.ts`, `executor.ts`: the changes Dev Notes list under `Hazard files`, and no other line of those files.
- [ ] (AC2, AC3, AC4, AC7) Create `kept-graph.ts`: it holds the records with the input digests of the revision they were read at and the aliases, by Vitest workspace, they were read under. Given the digests at a build's revision and the aliases of the discovery in effect, it answers either the records to carry (each whose file has a digest equal to the one it was read under, the digest looked up by the record's input label) or that the build reads every file, with the reason. A record with no input label is never carried. Given a recorded build's reply it takes each record the build read in place of the one it held for that file, keeps every other record whose file the walk found, drops each whose file the walk did not find, and takes that build's digests and aliases. Nothing else changes it.
- [ ] (AC2, AC4, AC7, AC10) `dependency-builds.ts`, `#build`: read the snapshot's digests in the same tick as the revision, with no await between; ask the kept graph what to carry; send the build; hand a recorded build's reply to the kept graph, and leave it untouched by a build that failed, timed out or was discarded; write the log entries of AC10.
- [ ] (AC5, AC6, AC7, AC10) `dependency-builds.ts`, `use`: a discovery whose id is the one in effect changes nothing and logs nothing, as today. For a new id, build the new discovery's selection input and compare what the build reads of it with the one in effect. When it is the same and the latest build ended built, record that build's revision over the new discovery with a `Narrowing` made from the new selection input and the dependency information already kept, start nothing, and log why. When it is the same and a build is running, let it end and record it over the discovery then in effect. When it differs, or no build over the discovery in effect ended built and none is running (the latest failed, timed out, was discarded, or none has started), do as today.
- [ ] (AC11) Run the prose sweep of Dev Notes. Rewrite each hit in production code under `packages/`. List each hit in a test file or a `defects.json` under `Test Files This Change Broke` for create-tests. Send the orchestrator the exact old and new text of each hit in `docs/architecture.md` and `.claude/skills/orchestrator/SKILL.md`, which are project-wide files, together with the text `docs/architecture.md` needs to state what is now true (the source file record, the kept records, when a build reads every file, when a stored discovery starts no build, the known limits) and the part of `Dependency index` under `Intended architecture` this ticket makes implemented.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `changedPaths(before, after)` in `daemon/round-selection.ts`: the paths whose digest changed, appeared or disappeared between two `InputDigests`. The kept graph asks this of the digests its records were read at and the digests at the build's revision.
- `InputDigests` in `inputs/input-inventory.ts`, read from `inputs.current().snapshot.digests` (`ProjectInputs` in `inputs/fingerprint.ts`).
- `readSourceImports`, `FoundSpecifier`, `SPECIFIER_FORM` and `SourceImports` in `selection/source-imports.ts`.
- `observedParse`, `rootLabel`, `addSpecifierEdges`, `addPathEdges`, `addPatternEdges`, `addPackageEdges`, `widenOnce`, `once`, `Scan` and `Reference` in `selection/specifier-edges.ts`.
- `addAliasedSpecifierEdges` and `scanAliases` in `selection/alias-specifiers.ts`.
- `holdersOf`, `edge` and `uncertain` in `selection/graph-state.ts`.
- `pathTargets` and `nearestAlongExtends` in `selection/tsconfig-edges.ts`, both private there today.
- `walkWorkspace`, `WalkedFiles` and `SOURCE_EXTENSIONS` in `selection/source-walk.ts`; the list is private there today.
- `buildSelectionInput` and `DiscoveredSelectionInput` in `selection/selection-input.ts`.
- `Narrowing`, `EndedBuild` and `NarrowingState` in `inputs/narrowed-inputs.ts`.
- `createParseRecord`, `openParseRecord` and `parsingLabel` in `daemon/parse-record.ts`, unchanged.
- `isBuiltin` from `node:module`.
- The name `carried`: the `discover` request in `daemon/executor-jobs.ts` already carries lists a job keeps in place of collecting them.

### Must Create

- The source file record's type and its module, `selection/source-records.ts`.
- The kept graph's module, `daemon/kept-graph.ts`.
- The comparison of what the build reads of two selection inputs.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### What the criteria rest on

The sprint's scope for this ticket, which binds (`_agent-docs/sprints/sprint-4-file-level-results.md`): "the source scan yields one record for each source file (each specifier kept as the path it names where it is a path, resolved to a package workspace where it is a name, an alias or a tsconfig path, kept as its pattern where it is a glob; whether it holds a module path computed at run time; which Node built-ins it imports; or why it could not be read); the daemon keeps the records for its life and, after a change, sends a build that re-reads only the files that changed, appeared or went away; the workspace-level dependency information every existing rule reads is derived from the records and selects what it selects today; a newly stored discovery starts no build unless the selection input changed; a change to an input that is no source file, or to the aliases a discovery reports, scans whole again. A parse still runs in an executor process of its own behind the parse record."

FR27: "Keep a dependency graph of the consumer's source files, scanned once in a daemon's life and updated by re-reading only the files a change names, and rediscover only when a change can alter which test modules exist." This ticket delivers the first half; ticket 4.4 the second.

NFR1: "Never execute a test while it holds a current result for the same input fingerprint, except to falsify it or to rerun an invalidated run." NFR2: "Find in every selected run each failure that a full run over the same input snapshot finds, across the controlled edit corpus." This ticket delivers neither; AC3 and AC8 keep both measured as they are.

ADR-0011, the dependency graph: "**The dependency graph** holds each source file's imports: a file-to-file edge where a specifier is a path, an edge to a whole package workspace where it is a package name, an alias or a tsconfig path, and the pattern itself where it is a glob. The daemon scans it once in its life and afterwards re-reads only the files a change names, in memory [...] It stays coarse wherever a name is not a path, because it never narrows a selection by itself: its work is to miss nothing."

The glossary's term, verbatim: "**Dependency graph**: The daemon's record of the files and package workspaces each source file names in its imports, read whole at the daemon's first dependency build and again when a changed input is not a source file or the aliases a discovery reports change, and otherwise updated for the files a change names."

The call forms the scan reads, from `docs/architecture.md`, `Source scan for undeclared dependencies`: "a static import or re-export, a dynamic `import()`, `require()` or `require.resolve()`, a `vi.mock`, `vi.doMock`, `vi.importActual`, `vi.importMock`, `vi.unmock` or `vi.doUnmock` call, `import.meta.resolve()`, a TypeScript `import x = require()`, a `/// <reference path>`, an `import.meta.glob` pattern, or a `new URL(specifier, import.meta.url)`". The same section: "A query or hash suffix does not change where a specifier resolves" and "A specifier resolving outside the consumer root, any other URL-scheme specifier such as `node:fs`, and a `#` subpath import add no edge."

The orchestrator's rulings that bind this ticket (12:20 on 2026-10-02): the graph never narrows a selection by itself in this ticket; the workspace-level dependency information every existing rule reads is derived from the kept records and selects exactly what it selects today, so NFR1 and NFR2 are measured by the edit corpus as strongly as now; the graph stays coarse wherever a name is not a path.

The product guarantee AC4 and AC2's third case apply (`AGENTS.md`): "Widen selection when dependency information is uncertain."

The owner's idea this ticket builds, verbatim (10:56 on 2026-10-02): "What if, when an RT test is first run on a repo, it does a scan of the codebase and creates a graph that it can query and maintain, and therefore have quick access to what needs to be run?"

#### What is measured and what is computed

The evidence is `_agent-docs/.scratch/file-select/findings.md`: section 1 (`The floor today`, `What one dependency build is made of`, `Why a save pays two builds`, and the computed floors) and the addendum's rows on the kept graph. Every figure this ticket quotes from it is that document's, on its machine and versions. The time from a save to a run starting after this ticket is computed there and stays labeled computed until ticket 4.11 measures it. Two things that document's computed build did not hold: the carried records cross the executor's channel in every build, and the scan still reads the manifests, tsconfigs and Vitest edges in every build. How large the carried records are for Fleet Cooling's 2,450 source files is not measured; a rough guess from about 7 static specifiers a file, each with its edges, is a few megabytes. AC10's end entry gives the trial's own log the figures to measure it by.

Fleet Cooling's tree was read from git's object store at its HEAD b265b01f, never by a walk: 3,228 tracked files, 2,450 of them source files by the walk's extensions, 9 tsconfig files, 7 manifests, no link (`git ls-tree -r HEAD` holds no mode 120000 entry), no `.vue`, `.svelte`, `.astro` or `.mdx` file. Of its static specifiers, 10,657 are relative (8,429 extensionless, 559 ending in a JavaScript extension), 2,317 name one of its package workspaces, 622 begin `@/`, and 113 begin `node:`. Its apps and `packages/ui` set `resolve: { tsconfigPaths: true }` and report no alias, so each `@/` specifier resolves through a tsconfig `paths` key. It writes no `import()` or `require()` with a computed argument and no `vi.mock(import(...))` (0 of 697 `vi.mock` and `vi.doMock` calls). Lane scan-widening counted 8 tracked source files under its declared non-input directories (its record, 12:30 on 2026-10-02).

#### Design choices, each with do nothing and one coarser rule

| Choice                                   | Chosen                                                                                             | Do nothing                                                                       | Coarser                                                                                                                  | Why chosen                                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the records live                   | The daemon keeps them; a build is sent the records to carry and returns the ones it read           | Two builds that read every file at each save                                     | The build process keeps a file of its own and tells what changed by size and modification time                           | The tracker's content digests are the product's authority on what changed, and tickets 4.5 and 4.7 read the records in the daemon                                                                                                                                   |
| What a build carries                     | A record whose file has the digest it was read under; a file with no digest is read by every build | n/a, the scope                                                                   | Read again every source file of a package workspace that holds a changed file                                            | A digest for each input exists already; a declared non-input has none                                                                                                                                                                                               |
| How an appeared or deleted file is found | Every build asks git and walks the tree, and reads what it holds no record for                     | n/a                                                                              | A file that appears or goes away makes the build read every file                                                         | The walk and git's answer are the smallest parts of a build, and one walk decides which files exist for both kinds of build                                                                                                                                         |
| When a build reads every file            | Whenever a changed path is not a source file, or the aliases differ                                | Never after the first, so a manifest edit leaves every name stale                | The chosen one is the coarser; the exact one lists the manifest, the tsconfig, the listing's sources and the ignore file | One question of each changed path. Its cost is the first known limit below                                                                                                                                                                                          |
| A newly stored discovery                 | No build while the build would read the same; otherwise one build that carries                     | Every stored discovery starts a build, the second of each save today             | Any difference makes the build read every file                                                                           | A new test module or a refreshed list must not cost a whole read                                                                                                                                                                                                    |
| A specifier that is a tsconfig path      | A key of a config of the file's package workspace, or of one above it, matches the specifier       | `@/x` is placed nowhere, and ticket 4.7 cannot tell it from an installed package | Every bare name in a package workspace that sets `paths` takes every target                                              | Fleet Cooling meets it 622 times; matching one key is a prefix and a suffix                                                                                                                                                                                         |
| What a path specifier's record holds     | The path it names and the package workspaces holding it, with no check of what file is there       | n/a                                                                              | Ask the file system which file the path names when the record is made, so a new file makes every importer read again     | A record then depends on no other source file: beside its own file it rests on the manifests, the configs, the links and the aliases, and AC4 answers a change to each with a build that reads every file. Which source file the path names is ticket 4.7's (ruled) |
| A computed module path                   | Any non-literal argument of a form the scan reads                                                  | It stays a silent known limit of the scan                                        | The chosen one is the coarser; the exact one follows constants                                                           | Fleet Cooling writes none                                                                                                                                                                                                                                           |

#### Known limits, each with its cost

- An edit to an input that is not a source file (a manifest, a config in JSON, a stylesheet, a Markdown file) makes the build read every file: on Fleet Cooling a build of about 4.6 s (its log) in place of the partial build's computed 0.17 s, a figure that leaves out the two costs named under `What is measured and what is computed`. Such an edit selects its whole workspace or every workspace today.
- A file the scan reads that is neither an input nor a source file, such as a tsconfig under `node_modules` that an `extends` reaches, is read again by every build, but its change starts no build, and a carried record keeps what it took from that file (the package workspaces of a `paths` key) until a build reads every file. An install changes the lockfile, which is such a build. The dependency information is not affected, since a `paths` placement adds no edge.
- A link to a file, named as a source file, that is given another target is read again itself, but after it is given a target in another package workspace, a file in a third workspace that imports through it keeps the earlier target's workspace until a build reads every file (any change to an input that is no source file, or a restart), so an edit in the new target's workspace can leave that importer's workspace unselected until then. A link to a directory is an input that is no source file, so its change is such a build. Fleet Cooling tracks no link.
- `vi.mock(import("./x"))` reads as a computed module path, since its argument is not a literal. Fleet Cooling writes none.
- A build that carries records still reads every manifest and tsconfig and asks git, so its time grows with the number of package workspaces and directories, not with the number of source files.

#### A rule this ticket departs from, and why

C126 asks that a dynamic import widen a selection. This ticket records a computed module path without widening on it, since the ruling keeps selection exactly as it is today; the scan drops such a specifier silently now, and the ticket that first reads the flag, 4.7, decides the widening.

#### Verified in installed source

`isBuiltin` from `node:module` on Node 24.19.0 answers true for `fs`, `node:fs`, `fs/promises`, `node:fs/promises`, `child_process`, `node:worker_threads` and `node:sqlite`, and false for `sqlite`, `test`, `react` and `./fs` (`node -e` over those names, 2026-10-02). A built-in that exists only under the prefix is why the record names every one with it.

For ticket 4.7's author, which owns the lookup of the source file a path names: `vite@8.3.1`, `dist/node/chunks/node.js`, `tryCleanFsResolve` (read 2026-10-02) returns the file at the path; for `.js`, `.mjs`, `.cjs` or `.jsx` the same name with `js` replaced by `ts` in the extension, and for `.js` also `.tsx`; then the path with each of `resolve.extensions` added (default `.mjs`, `.js`, `.mts`, `.ts`, `.jsx`, `.tsx`, `.json`); then a directory's `package.json` entry and its `index` with each extension. Whether the native resolver a Vitest run uses agrees was not verified.

#### Hazard files

`daemon/executor-jobs.ts`, `daemon/executor-main.ts` and `daemon/executor.ts` are edited only as written here, and the orchestrator is told before any other line of them changes. Fleet Cooling's guard keys on `packages/daemon/dist/daemon/executor-main.js` keeping its path and its two-entry argv: neither moves. The records travel in the request and reply messages only, never in argv or the environment. `REPLY_TYPES`, `isExecutorReply`, `EXECUTOR_BOUND_MS`, `#job`, `abort`, `close`, the containment, the parse record and every other job's request and reply stay untouched. No change is ever made to `daemon/canary-reading.ts`.

- `executor-jobs.ts`: the `build-dependencies` request gains the carried records. The `dependencies-built` reply gains, beside `dependencies`, the record of each source file the build read and the root-relative path of every source file the walk found.
- `executor-main.ts`: its `buildDependencies` function passes the carried records to `buildDependencyInformation` and returns what it yields; the `build-dependencies` case of `answer` puts that in the reply.
- `executor.ts`: the `buildDependencies` method takes the carried records as a fourth parameter and resolves with the dependency information, the record of each source file the build read and the root-relative path of every source file the walk found.

Sent to the orchestrator at 13:04 on 2026-10-02 with the alternative that leaves the files alone (the build keeps a file of its own and trusts size and modification time). The ruling is under `Questions and rulings`.

For the tests stage, by that ruling: every named-defect record that mutates `executor.ts`, `executor-jobs.ts` or `executor-main.ts` is sent to the orchestrator, with what its mutated code would do when run, before any is proven, and none is ever written on `daemon/canary-reading.ts`.

#### The current structure of each file to modify

- `selection/workspace-graph.ts` (461 code lines at 27e9da9d): `buildDependencyInformation(listing, vitestWorkspaces, observer?)` reads the manifests, adds the declared and override edges, prepares the aliases, then `addUndeclaredEdges` walks each package workspace in listing order through `addWorkspaceSourceEdges` (the walk's widenings, then each link, then each source file through `addSourceFileEdges`, then each config through `addTsconfigEdges`) and adds its manifest's `imports` edges; last come the Vitest edges. `addSourceFileEdges` reads one file through `observedParse` and `readSourceImports`, widens on a failed read, naming the file by `inputLabel` when it has one, and adds each specifier's edges and its aliased edges against the file's real directory.
- `selection/specifier-edges.ts` (320): `Scan` holds the graph, the keys `once` has met (`added`), the roots, a cache of the holders of each resolved path, and the observer. `addEdge` keeps the first quote for each dependent, dependency and producer through `once`; `widenOnce` and `addPackageEdges` ask `once` with keys of their own. A carried record must pass through the same keys in the same order for AC3 to hold.
- `selection/alias-specifiers.ts` (177): `addAliasedSpecifierEdges` adds, for each alias whose find matches a specifier, the edges of the rewritten specifier with the alias's Vitest workspace as the dependent, which is why AC4 compares the aliases by Vitest workspace.
- `selection/source-imports.ts` (265): `readSourceImports` returns the specifiers or why the file was not read. `addLiteral` drops a specifier that is not a literal without a trace, which is where the computed flag is found.
- `selection/tsconfig-edges.ts` (401): `addTsconfigEdges` reads one config and adds its `extends`, `references` and `paths` edges, the `paths` its own or the nearest along its `extends` chain (`nearestAlongExtends`).
- `selection/source-walk.ts` (187): `walkWorkspace` returns the sources, configs, links and widenings of one package workspace, in walk order.
- `daemon/dependency-builds.ts` (356): `use` compares the discovery's id alone, and a new id clears the latest build. `#round` builds whenever no build has ended at the current revision, and only while the tracker can vouch for its inputs. `#build` makes the selection input, logs the start, sends the build, and records it, discards it when a new discovery replaced its own or an input moved, or records it as timed out.
- `daemon/executor-jobs.ts`, `daemon/executor-main.ts`, `daemon/executor.ts`: under `Hazard files`.

Code lines were counted with `node _agent-docs/.scratch/create-ticket/code-lines.mjs <file>`: `workspace-graph.ts` on wt/1 at 27e9da9d, which lane scan-widening changed; every other file on main at e65fec95, which that lane leaves alone.

`daemon/lifecycle.ts` is not edited. It stands at 494 of 500 code lines, and this ticket adds nothing to it: each of its calls of `this.#builds.use(...)` keeps its meaning under the new `use`.

#### What the build reads of a selection input

`buildDependencyInformation` is given `selection.input.workspaces`. The list of what it reads of each one was made by reading every use of that parameter, which are `scanAliases` in `alias-specifiers.ts` and `addVitestEdges` with its helpers in `vitest-edges.ts`: `workspace.path` and `workspace.directory`; `tests.known`, and then each test's `modulePath` or else `tests.reason`; `setupFiles`; `globalSetupFiles`; and `aliases`. Two selection inputs give the build the same things to read when those are equal, the module paths compared as the ordered list of distinct paths. A discovery stored again with a run's lists changes the tests inside modules it already lists, so it compares equal; a new test module does not. Nothing but this list keeps the comparison complete: a member the scan starts reading joins the comparison in the same change, and create-tests is owed a test for each member that a difference in it starts a build.

The `Narrowing` AC5 records is made from the new discovery's selection input, since the round's counts read its tests and selection reads its protection, and from the dependency information the kept records yield.

#### What a carried record rests on in the tracker

A record is carried on the tracker's word that its file's digest is the one it was read under. That word holds after an edit the tracker could not attribute: a build starts only while the tracker can vouch for its inputs (`#round` and `pending` read `current().unavailable`), and a watcher failure, a missed event or a git move leads to a reconciliation, which the glossary defines as "Reading every input again to establish the current input fingerprints, without relying on change events".

The tracker names a file by its real path, root-relative and `/`-separated (`InputDigests` in `inputs/input-inventory.ts`). The scan's label is root-relative and `/`-separated too (`rootLabel` in `specifier-edges.ts`), but it spells the path the walk reached, which differs from the real path's for a file reached through a link or listed in another letter case. Lane scan-widening met the same question and answered it with `inputLabel`: the label when the file's real path has the same one, and none otherwise. A record is carried only by its input label, so a file with none is read by every build: safe and slow. That `inputLabel` gives the tracker's own key for every other file on both platforms is that lane's tested claim, not this ticket's; create-tests asserts AC2 through a real daemon, where a mismatch shows as a file read that should have been carried.

#### Sequencing with lane scan-widening

This ticket was drafted against main at e65fec95 and corrected against lane scan-widening's build and tests, committed on wt/1 as 27e9da9d, whose review was still open at 13:32 on 2026-10-02. This ticket's dev starts after that lane has landed. At 27e9da9d the lane:

- gives `DependencyUncertainty` an optional `file`, the root-relative label of the one source file whose failed read or parse is the whole cause, absent for any other cause and for a file the scan reached by a path that is not its real one; `uncertain` in `graph-state.ts` takes it as a fifth parameter and writes the field only when it is given;
- sets it in one place, `addSourceFileEdges` in `workspace-graph.ts`, through the new `inputLabel`;
- has selection leave such a widening out while `rt-test.json` declares its file a non-input that protection does not keep (`followedWidenings` in the new `selection/widening-links.ts`), report it in the selection's new `wideningsLeftOut`, and log one line for each in `daemon/round-selection.ts`;
- moves `DependentLink` into `selection-types.ts`, adds `LeftOutWidening` there, and raises `SELECTION_POLICY_VERSION` from 9 to 10.

Of that lane's production files this ticket edits `selection/workspace-graph.ts` alone, and reads `changedPaths` from `daemon/round-selection.ts` unchanged. A record of a file that was not read carries the widening's `file` as the read set it, present or absent, so a replayed record raises exactly the widening a read raises and selection leaves out exactly what it leaves out today (AC3, AC8).

#### Files ticket 4.2 also writes

Ticket 4.2 builds in Tree 2 at the same time. It edits no production file of this ticket. Its tests stage also writes `packages/daemon/test/lifecycle.test.ts`, `packages/daemon/test/daemon.test.ts` and `packages/daemon/test/defects.json`, and its text for `docs/architecture.md` goes to the orchestrator as this ticket's does. Each lane adds tests and records to those files in its own tree, and the orchestrator merges the two branches; a record id comes only from the range the orchestrator allocates each lane.

#### Debt on the files this ticket edits

- Taken: the second dependency build a newly stored discovery starts, and the wait that cannot settle until the build a list refresh starts has ended. AC5 removes both.
- Left: the `dependency build started` entry is written before a build the executor then reports as not run. Fixing it needs the executor to say when a job was sent, inside `#job` in `daemon/executor.ts`, which every job kind shares; each of the not-run cases writes its own entry directly after.
- Left: the `this.#builds.use(refreshed)` call in `daemon/lifecycle.ts` that `#queryNarrowing` repeats at the next read. Removing it changes no behavior, and the file is not otherwise edited.
- Left, since this ticket opens none of their files: the private `moduleKey` in `query/test-states.ts` against `moduleListKey` in `vitest/test-lists.ts`, the `DiscoveredWorkspace` alias declared in several modules, and `moduleReport(session.locate(...))` written more than once.

#### The prose sweep

`git grep -n -E "after each new discovery|has the dependency builds build over it|starts a dependency build|one per build|parses each remaining|once per build of the dependency information|a new discovery builds again|parses every source file|at each input revision, one build at a time|new discovery (took effect|gets its own build)|as any new discovery does" -- docs README.md packages apps scripts test lint .claude _agent-docs/project-context.md _agent-docs/code-review-checklist _agent-docs/rules`

Its output on main at e65fec95 is recorded under `Existing tests the change breaks` and in the task: the hits lie in `docs/architecture.md`, `.claude/skills/orchestrator/SKILL.md`, `packages/daemon/src/daemon/dependency-builds.ts`, `packages/daemon/test/lifecycle.test.ts` and `packages/daemon/test/defects.json`. The implementer re-runs it and classifies each line it prints as rewritten, as handed on, or as still true. Tickets and records under `_agent-docs` are dated and are not swept.

#### Existing tests the change breaks, for create-tests

- `packages/daemon/test/lifecycle.test.ts`: `ScriptedBuilds.buildDependencies`, `BuildOutcome` and `NO_DEPENDENCIES` follow the executor method's new parameter and result. D2506, D2560 and D2592 rest on a replaced discovery getting its own build; each now needs a discovery that gives the build something else to read, or its claim restated by AC5. D2592's title is one of the sweep's hits. They were found by listing every test title of that file's dependency-build blocks and searching the daemon's test titles for a new, replaced or refreshed discovery; a test that rests on it without saying so in its title would not have been found, and AC8 covers it.
- `packages/daemon/test/executor.test.ts`: its calls of `executor.buildDependencies(` and its one call of `buildDependencyInformation(` follow the new parameter and result.
- `packages/daemon/test/selection/harness.ts`: its calls of `buildDependencyInformation(` read the dependency information out of the larger result. Those calls carry nothing, so they never run a build that carries records.
- `packages/daemon/test/defects.json` and `packages/daemon/test/selection/defects.json`: every record anchored in an edited file is re-anchored where its anchor moved and proved again, and a record whose `new` text calls `buildDependencies` or builds a `dependencies-built` reply follows the new shape. One record of `packages/daemon/test/defects.json` is a hit of the sweep. `packages/daemon/test/falsify/defects.json` holds one record each in `source-imports.ts`, `executor-main.ts` and `executor.ts`.

Records anchored in the files this ticket edits, counted on wt/1 at 27e9da9d by reading each `defects.json` and matching each record's `file` (`node _agent-docs/.scratch/create-ticket/4-1-record-counts.mjs`, run in that tree): `source-imports.ts` 24, `specifier-edges.ts` 30, `alias-specifiers.ts` 24, `workspace-graph.ts` 29, `tsconfig-edges.ts` 31, `source-walk.ts` 18, `dependency-builds.ts` 43, `executor-jobs.ts` 1, `executor-main.ts` 14, `executor.ts` 45. A later round of that lane's review can change them.

The edit corpus replays its sequences through `daemon-harness.ts` against RT Test's own daemon, and its sequences (`packages/daemon/test/edit-corpus-sequences.ts`) already replace, create, delete, rename and resave files, so they run builds that carry records as they stand. For AC3, the check create-tests is owed compares a build that carried records with a build over the same tree and discovery that carried none.

#### Scope of these notes

The analysis covers the scan's source files, the daemon's builds and their executor job. It does not cover what a file edge selects or which source file a path names, which are ticket 4.7's, or how a load record is read, which is tickets 4.5 and 4.9. Linux, a cold file cache and Vitest 5 were not measured by the evidence.

#### Questions and rulings

| Time                | Question                                                                                                                                                     | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Decided by                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 13:04 on 2026-10-02 | The hazard files, the exact change to each, and the alternative that leaves them alone                                                                       | The direct change is approved as described and no wider; the file-based alternative is declined, since it rates a file unchanged by size and modification time where the tracker's content digests are the authority. Its conditions, each carried above: the records travel in the messages only and the listed symbols stay untouched; the tests stage sends each record on those files before proving it; no existing selection or graph test's expectation changes, and one that must change stops the dev; the build's end entry names files read and records carried beside its time | The orchestrator, 13:08 on 2026-10-02                            |
| 13:04 on 2026-10-02 | The design choices on what a build carries, how an appeared or deleted file is found, when a build reads every file, and a newly stored discovery            | Accepted as inside the scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The orchestrator, 13:08 on 2026-10-02                            |
| 13:04 on 2026-10-02 | Size: 21 raw files, 28 estimated                                                                                                                             | Cleared under the limit of 30 where a split would cut a behavior, the save that re-reads only what changed. A running count: a file found while building is measured against 30                                                                                                                                                                                                                                                                                                                                                                                                            | The orchestrator, 13:08 on 2026-10-02                            |
| 13:04 on 2026-10-02 | The `dependency build started` entry written before a build reported as not run                                                                              | Stays left                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The orchestrator, 13:08 on 2026-10-02                            |
| 13:13 on 2026-10-02 | While no build over the discovery in effect ended built, does a new discovery that gives the build the same things to read build again?                      | Yes, as today (AC7): only the log and the time differ, and a failure that would not repeat is retried as it is now                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | The create member at the grill; taken by the orchestrator, 13:15 |
| 13:13 on 2026-10-02 | The glossary's `Dependency graph` said "scanned once in the daemon's life", and AC4 has a build read every file again when a changed input is no source file | FR27 stays as written. The orchestrator rewrote the glossary's entry, as quoted above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The orchestrator, 13:15 on 2026-10-02                            |
| 13:13 on 2026-10-02 | The lookup of the source files a path specifier names would ship with no production consumer until ticket 4.7 (C59)                                          | The lookup moves to ticket 4.7, and this ticket's record keeps the path a specifier names. C59 holds as written: nothing in this ticket's own result reads the lookup, and the owner stops the sprint after ticket 4.6, so its consumer may not be built                                                                                                                                                                                                                                                                                                                                   | The orchestrator, 13:15 on 2026-10-02                            |
| 13:13 on 2026-10-02 | A link to a file given another target leaves its importers' records with the earlier target's package workspace until a build reads every file               | A named known limit, and AC3 names it as an exception; the fix is declined. By the owner's test of 04:43 on 2026-10-01, verbatim: "the deciding factor on whether we should address it is look at Fleet Cooling's codebase. Would this edge case come up in it? If not leave it." Fleet Cooling tracks no link. "Selects exactly what it selects today" holds with that one exception                                                                                                                                                                                                      | The orchestrator, 13:15 on 2026-10-02                            |

### References

- `_agent-docs/sprints/sprint-4-file-level-results.md`: the scope, the order and the computed figures.
- `docs/adr/0011-load-record-beside-dependency-graph.md`: the dependency graph's half.
- `_agent-docs/.scratch/m3-plan/proposal.md`: the planning record, its design-choice table, guarantees and rulings.
- `_agent-docs/.scratch/file-select/findings.md`: the spike's evidence, with its driver and results in that folder.
- `docs/architecture.md`: `Source scan for undeclared dependencies`, `Widenings`, `Dependency build process and selection input`, `Workspace fingerprints and narrowed inputs`, `Reconciliation and the round of runs`, and `Dependency index` under `Intended architecture`.
- `C:/source/rt-test-wt/wt-1/_agent-docs/.scratch/change-requests/scan-widening.md`: lane scan-widening's record.
- GitHub issues: `node scripts/list-open-issues.mjs` printed 0 open issues on 2026-10-02, so none was read.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C5,C8,C10,C11,C12,C14,C20,C28,C30,C31,C32,C38,C39,C40,C48,C49,C52,C55,C57,C58,C59,C115,C126,C129,C157,C160,C163,C167,C174 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P14,P16,P17,P18,P19,P21,P31,P32,P41 -->

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
sizing_ac_count: 9
files_to_modify:
  - packages/daemon/src/selection/source-imports.ts
  - packages/daemon/src/selection/specifier-edges.ts
  - packages/daemon/src/selection/alias-specifiers.ts
  - packages/daemon/src/selection/workspace-graph.ts
  - packages/daemon/src/selection/tsconfig-edges.ts
  - packages/daemon/src/selection/source-walk.ts
  - packages/daemon/src/daemon/dependency-builds.ts
  - packages/daemon/src/daemon/executor-jobs.ts
  - packages/daemon/src/daemon/executor-main.ts
  - packages/daemon/src/daemon/executor.ts
  - packages/daemon/test/selection/workspace-graph.test.ts
  - packages/daemon/test/selection/source-scan.test.ts
  - packages/daemon/test/selection/harness.ts
  - packages/daemon/test/selection/defects.json
  - packages/daemon/test/executor.test.ts
  - packages/daemon/test/lifecycle.test.ts
  - packages/daemon/test/daemon.test.ts
  - packages/daemon/test/defects.json
  - docs/architecture.md
files_to_create:
  - packages/daemon/src/selection/source-records.ts
  - packages/daemon/src/daemon/kept-graph.ts
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

Planning files written while this ticket was authored:

- `_agent-docs/sprints/sprint-4-file-level-results.md`: this ticket's Size sentence, by the create member under a grant of that sentence; its Scope, and ticket 4.7's, by the orchestrator at 13:15 on 2026-10-02; its Scope's clause on when a build reads every file, and the link to this ticket, by the orchestrator at 13:31 on 2026-10-02.
- `docs/glossary.md`: the `Dependency graph` entry, by the orchestrator at 13:15 on 2026-10-02.

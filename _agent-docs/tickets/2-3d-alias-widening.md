# Ticket 2.3d: Alias widening and the declaration file's case

## Ticket

As an agent whose consumer's Vitest configs use aliases and whose checkout may sit on Windows,
I want selection to widen on every alias whose replacement does not tell where an import ends up, to quote a RegExp alias as the regular expression it is, and to treat an edit to `rt-test.json` as the change to the declaration it is however the file's name is cased,
so that no selection misses a workspace an alias or a changed declaration can reach, and every explanation names the alias a reader will find in the config.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: A Vitest workspace depends on every package workspace when one of its aliases has a `customResolver`, or has a string `find` of `/` or of the empty string (the form Vite gives a `/` find whose replacement ends in `/`), whatever that alias's replacement is. The widening names the alias and why it widens (its `customResolver`, or its `/` or empty find), and the selection reason of each test it adds quotes that cause. An alias with neither, a RegExp `find` included (Vite's own client aliases among them), reaches the workspaces it reaches today.
- [ ] AC2: Every explanation that quotes an alias, an alias edge's detail and a widening's cause alike, shows a RegExp `find` as a regular expression literal of its source text and flags (such as `/^~icons\/(.*)$/i`), and a string `find` quoted as today, so a RegExp and a string of the same text never read alike.
- [ ] AC3: A changed path that names `rt-test.json` at the consumer root, or a path under it, as the tracker recognizes the declaration file (case-folded on Windows, exact on other hosts), raises the project-wide non-inputs-file fallback in selection, and is never a declared non-input, in selection and in the tracker's inventory alike, whatever patterns `rt-test.json` declares. On a host that compares names exactly, a differently cased name is an ordinary path.
- [ ] AC4: The selection policy version rises to 5, so every result stored under version 4 reads stale once.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None open. Every third-party behavior the criteria rest on was read in installed Vite 8.3.1 and Node 24.19.0, with the source locations in Dev Notes § Settled facts.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read `non-inputs.ts`, `selection-types.ts` and `select-tests.ts` as 2.3c left them (landed a3ca5bc; § Pending siblings and their routing) and confirm nothing has moved since the 04:21 re-verify.
- [ ] (AC1, AC2) In `packages/daemon/src/selection/selection-types.ts`, make `SelectableWorkspace.aliases` carry ticket 2.3b's `ReportedAlias` (`vitest/selection-facts.ts`, a type-only import), deriving `ResolvedAlias` from it or replacing it, so selection and the report declare one alias shape (C14). Rewrite the doc comment, which says a replacement "is an absolute path or a bare package name", to what the shape now holds (C46).
- [ ] (AC1) In `packages/daemon/src/selection/vitest-edges.ts` `addAliasEdges`, before the replacement's prefix is resolved, widen the dependent through `uncertain(graph, dependent, UNCERTAINTY.unresolvableAlias, cause)` when the alias has a `customResolver`, or its `findKind` is `STRING_FIND` and its `find` is `/` or empty, and add no alias edge for it. The cause quotes the alias (AC2) and says why: a `customResolver` picks the module after the replacement; an empty find rewrites every import that begins with `/`; a `/` find is the form Vite warns maps `/`, and rewrites `/` and every import that begins with `//`. Name the two finds as constants (C3). Every other alias, RegExp finds included, keeps today's prefix analysis.
- [ ] (AC2) In `vitest-edges.ts`, render an alias's `find` for every explanation through one function: `/${find}/${flags}` for a `REGEXP_FIND`, `JSON.stringify(find)` for a string. The edge detail, today's `unresolvable-alias` causes and AC1's causes all quote the alias through it. `addAliasEdges`'s `detail` is today the only production site that quotes an alias's `find` (`rg -n "alias\.find|JSON.stringify" packages/daemon/src/selection`, 02:11).
- [ ] (AC3) In `packages/daemon/src/inputs/non-inputs.ts`, export one predicate that says whether a root-relative `/`-separated path names the declaration file or a path under it, comparing as `liesInsideOnHost` (`inputs/input-filter.ts`) compares, and use it in `declaredNonInputs` in place of `path === NON_INPUTS_FILE`. In `select-tests.ts` `projectWideKinds`, use it in place of `path === NON_INPUTS_FILE`, so a root-relative path is recognized as the declaration file in one place (C8). Keep `InputTracker.#changed`'s absolute check as it is; it already calls `liesInsideOnHost`. `declaredNonInputs` has two production callers (`rg -n "declaredNonInputs\(" packages/daemon/src`, 02:11): `DeclaredNonInputs` (`inputs/declared-non-inputs.ts`), whose decision backs the tracker's `namesFile` and the inventory's `declares`, and `select-tests.ts` `selectionContext`; both want the new exemption, and `query/path-status.ts` imports only `testModuleFile` (C39).
- [ ] (AC4) Raise `SELECTION_POLICY_VERSION` in `selection-types.ts` from 2.3c's 4 to 5.
- [ ] (Support) Keep `select-tests.ts` under the 500 code-line cap (P16); 2.3d's change there is one comparison in `projectWideKinds` and its import.
- [ ] (Support) Send the orchestrator the `docs/architecture.md` text in § Doc text, final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files, and `bun run --filter @rt-test/daemon typecheck`, which also reports every test helper the alias shape change breaks (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `ReportedAlias`, `STRING_FIND`, `REGEXP_FIND` and `AliasFindKind` (`vitest/selection-facts.ts`): the alias shape discovery reports, `{ find, findKind, flags, replacement, hasCustomResolver }`. 2.3b declared it so this ticket could derive selection's alias from it (2.3b § Pending siblings). Import; declare no second shape (C14).
- `uncertain(graph, dependent, kind, cause)` (`selection/graph-state.ts`): records a widening; `addAliasEdges` already calls it for an unresolvable replacement.
- `UNCERTAINTY.unresolvableAlias` (`selection/selection-types.ts`): the widening kind AC1 reuses (ruling Q3).
- `liesInsideOnHost(directory, path)` (`inputs/input-filter.ts`): whether `path` is `directory` or lies under it, case-folded on Windows, choosing the path module when called; the tracker's declaration-file check and the exclusions use it.
- `NON_INPUTS_FILE` (`inputs/non-inputs.ts`): `"rt-test.json"`.
- `TRIGGER.nonInputsFile` and `FALLBACK_SCOPE.project` (`selection/selection-types.ts`): the fallback AC3 raises, already produced by `projectWideKinds`.

### Must Create

- The declaration-file predicate in `inputs/non-inputs.ts` (AC3).
- The alias-quoting function and the widening check in `selection/vitest-edges.ts` (AC1, AC2).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The fourth of the six tickets the original 2.3 split into (sprint file, after § Ticket 2.3f). Selection has no production caller until 2.3e, as for 2.2 and 2.2b, so this ticket changes only what `selectTests` and `buildDependencyInformation` answer for a given input. 2.3e builds selection's input from 2.3b's report, and after this ticket its aliases pass through unchanged.

Requirement this ticket serves (`docs/requirements.md`): "FR7: Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts." (AC1 to AC4)

Sprint scope, quoted: "selection widens on an alias with a `customResolver` or a `find` of `/`, whose replacement is not the final import, and shows a RegExp `find` as its source text in every explanation; the selection policy version rises. When selection receives the tracker's changed paths, it recognizes a change to rt-test.json as the tracker does, case-folded on Windows through liesInsideOnHost, since projectWideKinds compares the path to NON_INPUTS_FILE exactly, and never takes it as a declared non-input (ticket 2.1b review, 2026-09-27 18:06)."

Rule clauses the criteria rest on:

- AGENTS.md § Product guarantees: "Widen selection when dependency information is uncertain." (AC1)
- AGENTS.md § Product guarantees: "Explain each selection and each broad fallback." (AC2, AC3)
- `SELECTION_POLICY_VERSION`'s doc comment (`selection/selection-types.ts`): "Raise whenever a rule change can select a different set for the same inputs." AC1 and AC3 each select a different set for some input. (AC4)

Glossary (`docs/glossary.md`), verbatim:

- **Widening**: "Adding tests to a selection because a dependency is uncertain."
- **Broad fallback**: "A widening to a whole workspace or project, named with the input that triggered it."
- **Declared non-input**: "A file the consumer lists in `rt-test.json` as read by no test, so its edit changes no input fingerprint and selects nothing."

#### Orchestrator rulings

Asked by `session_wake` at 02:05 on 2026-09-28, answered at 02:06; decider the orchestrator, holding the owner's calls.

- Settled facts accepted: widening covers a string find of `/` or `""`; a RegExp keeps the replacement-prefix analysis. (AC1)
- Q1, scope: 2.3d fixes only `rt-test.json`'s case, per 18:06. The wider class, other special names compared exactly, is reported to the orchestrator as an out-of-scope finding, queued as its own change request (§ Out of scope). (AC3)
- Q2: a RegExp `find` shows as `/source/flags`; a string stays JSON-quoted. (AC2)
- Q3: both new cases reuse `unresolvable-alias`, with a cause naming why. (AC1)
- Grill (create-ticket 6b, 02:08), each settled by fact or standing ruling, so none went to the orchestrator:
  - A path under `rt-test.json` counts as the declaration file, since the sprint says selection recognizes it "as the tracker does", and `InputTracker.#changed` tests `liesInsideOnHost(this.#declarationFile, path)`, which holds for a path under it. (AC3)
  - AC3 changes the tracker's inventory too: `takeInventory` (`inputs/input-inventory.ts`) keeps a walked path only when `walk.filter.declares(path) === undefined`, so today a Windows `RT-Test.json` under a `*.json` pattern is left out of the inputs, and after this ticket it is one. That fingerprint change is one of those AC4 already brings: `SELECTION_POLICY_VERSION` is in the fingerprint's environment (`inputs/fingerprint.ts`, `selectionPolicyVersion`), so every result reads stale once anyway. (AC3, AC4)
  - A workspace with a `customResolver` alias widens on every change for as long as the alias stays. That cost is what the sprint's ruling accepts, and Vite 8.3.1 deprecates the option (line 37180). (AC1)
- Ticket review (create-ticket 6c, 02:11): 7 edits and 2 questions, all applied. F1 and F2 corrected the `/` find's cause and rationale (only the empty find rewrites every import beginning with `/`); F3 recorded a consumer RegExp matching every root-absolute import as unanalyzed; F4 scoped AC3's fallback to selection; F5 corrected the `select-tests.ts` count; F6 recorded the method behind the alias-quote site and the `declaredNonInputs` caller audit (C39); F7 scoped the out-of-scope list to the files read. Q1 was settled from `reportedAlias` (§ Previous ticket), Q2 by rewording the C8 clause to root-relative paths.

#### Settled facts

Read in installed source (P10) at 02:01 to 02:06 on 2026-09-28, under `node_modules/.bun/vite@8.3.1+4a7f3e615f259300/node_modules/vite/dist/node/chunks/node.js`. Each would flip a criterion if false.

- **The two warnings the sprint cites.** Lines 37179 and 37180 in `resolveResolveOptions`: `if (alias.some((a) => a.find === "/")) logger.warn(... "`resolve.alias`contains an alias that maps`/`. ...")` and `if (alias.some((a) => a.customResolver)) logger.warn(... "... with `customResolver` option. This is deprecated and will be removed in Vite 9. ...")`.
- **A `/` find with a `/`-ending replacement becomes `""`.** `normalizeSingleAlias` (lines 2921 to 2932): `if (typeof find === "string" && find.endsWith("/") && replacement.endsWith("/")) { find = find.slice(0, find.length - 1); replacement = replacement.slice(0, replacement.length - 1); }`. `resolveResolveOptions` runs it on every alias before the warning, so the resolved config, which 2.3b reports, holds `find: ""`, and Vite's own `=== "/"` check misses that form.
- **A string find matches the import itself or any import beginning with it and `/`.** `matches$1` in the bundled `@rollup/plugin-alias` 6.0.0 (lines 3409 to 3414): `if (importee === pattern) return true; return importee.startsWith(pattern + "/");`. So `""` matches every import that begins with `/`, and `/` matches `/` and every import beginning with `//`.
- **A `customResolver` decides the module after the replacement.** The plugin's `resolveId` (lines 3451 to 3460) computes `updatedId = importee.replace(matchedEntry.find, matchedEntry.replacement)` and, when the entry has a resolver, returns `matchedEntry.resolverFunction.call(this, updatedId, importer, resolveOptions)`, whose answer can be any module.
- **Vite adds RegExp aliases to every project.** `clientAlias` (lines 37153 to 37159) is `[{ find: /^\/?@vite\/env/, ... }, { find: /^\/?@vite\/client/, ... }]`, merged into every resolved alias list by `resolveResolveOptions` (line 37177). Both can match an import beginning with `/`, so treating every RegExp that can match a leading `/` as the `/` case would widen every workspace on every change. That is why AC1 limits the `/` case to string finds.
- **A RegExp's `source` escapes `/`.** `node -e` on Node 24.19.0 (02:06): `new RegExp("a/b","i")` printed `a\/b i /a\/b/i`; `/^\/?@vite\/env/.source` printed `^\/?@vite\/env`; `new RegExp("").source` printed `(?:)`. So `/${source}/${flags}` is always a well-formed literal. (AC2)
- **Scope of the reading.** Only Vite 8.3.1 is installed. An older Vite that did not normalize would leave the find as `/`, which AC1 covers too, so no criterion rests on the normalization's version.

#### Design notes

- **Why these aliases widen.** Every other alias is analyzed by its replacement's fixed prefix (2.2's "Every alias reaches by prefix"): the import that results begins with it. A `customResolver` receives that import and may return any module. An empty find, which Vite makes of a `/` find whose replacement ends in `/`, rewrites every root-absolute import, which on Linux includes every absolute file path Vite itself resolved, so the resulting import no longer stands for what the consumer wrote. In those cases the replacement bounds nothing, and uncertainty widens (C126). A `/` find left as `/` rewrites only `/` and imports beginning with `//`; it widens because Vite warns against it and the ruling covers both forms, a conservative choice rather than one its replacement forces.
- **Widening replaces the edges.** A widened workspace already depends on every package workspace, so AC1's aliases add no alias edge; the reason quotes the widening.
- **The declaration file is decided once.** `declaredNonInputs` is the decision both selection and the tracker's inventory make, so moving its exemption to the predicate keeps them agreeing (2.3c AC5). The tracker's event path already returns early through `liesInsideOnHost(this.#declarationFile, path)` before it asks. `liesInsideOnHost` takes the path module at call time, so a test can stub `process.platform`, as D1365 does for the capture-alias match. Since 2.3c, `declaredNonInputs` returns no match for any path while `!protection.applies`, so AC3's "never a declared non-input" is observable only over a protection that applies: `harness.ts` builds one through `protection(treeDiscovery(root, tree), root)`, as D2013 already relies on.
- **Relative arguments.** `liesInsideOnHost("rt-test.json", path)` with root-relative arguments resolves both against the current directory, which cancels out; the predicate may instead join both to one base. Dev chooses, and the predicate's doc comment states which.
- **Import direction.** `input-filter.ts` imports `non-inputs.ts` for a type only (`NonInputMatch`), and `non-inputs.ts` imports `protection.ts` for a type only (`Protection`), so a runtime import from `non-inputs.ts` to `input-filter.ts` forms no cycle; `inputs/protection.ts` already imports both at runtime (`absoluteInputPath`, and `discoveredTestModules` and `NON_INPUTS_FILE`). It does bring `input-filter.ts`'s imports (`daemon/endpoint.js`, `selection/git-ignored.js`) into every module that loads `non-inputs.ts`: `start-plan.ts`, `vitest/selection-facts.ts`, `query/path-status.ts`. If that is unwanted, move `liesInsideOnHost` to a module both can import and re-point its callers (C57).
- **Scope of the analysis.** Analyzed: the two alias cases the sprint names, and the declaration file's name as selection and the tracker compare it. Unanalyzed: other special names compared exactly, which is the orchestrator's change request (§ Out of scope); and a consumer's RegExp `find` that matches every root-absolute import (such as `/^\/(.*)/`), which by the ruling keeps prefix analysis though the empty-find rationale applies to it too. The Settled facts line on RegExps rests on Vite's two client aliases only.

#### Out of scope, reported to the orchestrator

Selection and the tracker compare these other special names exactly, as read in `non-inputs.ts` and `select-tests.ts` (a repository-wide search is the change request's): `PROTECTED_NAMES` and `TYPESCRIPT_CONFIG_NAME` in `declaredNonInputs` (`non-inputs.ts`), and `LOCKFILES`, `PACKAGE_JSON` and `CONFIG_FILES` in `select-tests.ts` `projectWideKinds` and `pathTriggers`. So on Windows a `PACKAGE.JSON` or `BUN.LOCK` gets no trigger, and a declared pattern can take it out of the inputs. Discovery's config-name matching (`vitest/find-workspaces.ts`) compares exactly too. The two callers agree with each other, unlike the 18:06 case. The orchestrator queues it as its own change request (Q1).

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3d` over `selection/selection-types.ts`, `selection/vitest-edges.ts`, `selection/select-tests.ts`, `inputs/non-inputs.ts`, `inputs/input-filter.ts`, `vitest/selection-facts.ts` and `inputs/protection.ts` (2026-09-28 04:21, after 2.3c landed) named only 2.3f, through the sprint's split note.

- **2.3c** (done, a3ca5bc, merged into wt/1 at e058bb1): re-verified at 04:21 against its landed code. It changed `declaredNonInputs(declaration, protection: Protection)` (no match for any path while `!protection.applies`, and `protection.protects(path)` checked after a pattern matches), `SelectionNonInputs.protection`, `SELECTION_POLICY_VERSION = 4`, and the one `declaredNonInputs` call in `select-tests.ts` `selectionContext`. It left `path === NON_INPUTS_FILE ||` in `declaredNonInputs`, `projectWideKinds`, `vitest-edges.ts`, `ResolvedAlias` and `SelectableWorkspace.aliases` as they were, so every line this ticket changes is where the ticket says. D2012 and D2013 keep their anchors; D2014 now reads `= 4` (§ Existing tests this change breaks). 2.3c's AC5 promises the two callers agree for every path; this ticket keeps that true for the declaration file.
- **2.3e** (backlog) fills `SelectionInput` from the discovery; the alias shape this ticket gives `SelectableWorkspace` is the one it passes through.
- **2.3f** (backlog): named by the sprint's split note, which lists the files 2.3, 2.3c and 2.3d share; it writes none of this ticket's files.

#### Sizing

About 10 raw files and 13 estimated; code units 5 (4 criteria plus validation). Production: `selection/selection-types.ts`, `selection/vitest-edges.ts`, `selection/select-tests.ts`, `inputs/non-inputs.ts`. Tests, for create-tests: § Existing tests this change breaks, plus `docs/testing.md`. `docs/architecture.md` is the orchestrator's write. Over 10 estimated, so dev delegates to implementer agents: the alias group (`selection-types.ts` alias shape, `vitest-edges.ts`) and the declaration group (`non-inputs.ts`, `select-tests.ts`) touch disjoint files; the policy version goes with either.

#### Current structure of the modified files

As of wt/1 at e058bb1, with 2.3c landed.

- `packages/daemon/src/selection/selection-types.ts`: `SELECTION_POLICY_VERSION = 4`; `UNCERTAINTY` (with `unresolvableAlias: "unresolvable-alias"`); `ResolvedAlias { find: string; replacement: string }`, documented "the replacement is an absolute path or a bare package name"; `SelectableWorkspace { workspace, tests, setupFiles, globalSetupFiles, aliases: readonly ResolvedAlias[] }`; `TRIGGER` with `nonInputsFile: "non-inputs-file"`; `SelectionNonInputs { declaration, protection: Protection }`, with a type-only import of `Protection` from `inputs/protection.ts`. 193 code lines.
- `packages/daemon/src/selection/vitest-edges.ts`: `addVitestEdges` calls `addAliasEdges(graph, workspace.path, alias)` per alias. `addAliasEdges` builds `detail` as `` `config alias ${JSON.stringify(alias.find)} to ${JSON.stringify(alias.replacement)}` ``, cuts the replacement at `REPLACEMENT_REFERENCE`, and calls `aliasResolution(graph, prefix)`; on `!ok` it calls `uncertain(graph, dependent, resolution.kind, `${detail} ${resolution.cause}`)`, otherwise it adds an `EDGE_PRODUCER.alias` edge per path with `detail`. `aliasResolution` returns `unresolvableAlias` with cause "is neither an absolute path nor a bare package name" for an empty or local prefix. 158 code lines.
- `packages/daemon/src/selection/select-tests.ts`: `projectWideKinds(context, path, owner)` pushes `TRIGGER.nonInputsFile` on `if (path === NON_INPUTS_FILE)`; `selectForPath` asks `context.declared(path)` first and returns `declaredOutcome` on a match. 489 of the 500 code lines.
- `packages/daemon/src/inputs/non-inputs.ts`: `NON_INPUTS_FILE = "rt-test.json"`; `declaredNonInputs(declaration, protection)` returns `() => undefined` unless the declaration is declared with patterns and `protection.applies`; otherwise it returns no match when `path === NON_INPUTS_FILE ||` a `tsconfig*`/`jsconfig*` name or a `PROTECTED_NAMES` name, and a matching pattern only when `protection.protects(path)` is false. Runtime imports: `node:fs`, `node:path`, `selection/source-walk.js`, `vitest/error-text.js`, `vitest/find-workspaces.js`; type-only `Protection` from `./protection.js`. 245 code lines.
- `packages/daemon/src/inputs/input-filter.ts` (read only): `liesInsideOnHost(directory, path)` picks `win32` or `posix` by `process.platform` at call time and tests `host.relative(directory, path)` for climbing out or being absolute.
- `packages/daemon/src/inputs/input-tracker.ts` (read only): `#changed` requests a reconciliation with `NON_INPUTS_CHANGED_REASON` when `liesInsideOnHost(this.#declarationFile, path)`, where `#declarationFile` is `join(root, NON_INPUTS_FILE)`, before any other check.

#### Existing tests this change breaks

Found by `rg` over `packages/daemon/test` for `ResolvedAlias`, `aliases`, `config alias`, `unresolvable-alias`, `SELECTION_POLICY_VERSION`, `D2012`, `D2013` and `D2014`, and by reading each `defects.json` record anchored in the four production files (02:03; re-run at 04:21 after 2.3c, each anchor checked to resolve in the current file).

- `packages/daemon/test/selection/harness.ts`: `aliases?: (root) => readonly ResolvedAlias[]` builds the old shape. (Since 2.3c it builds `nonInputs.protection` through `protection(...)`, which this ticket does not change.)
- `packages/daemon/test/selection/workspace-graph.test.ts`: its `aliases()` helper returns `[{ find: "@alias", replacement }]`, which lacks `findKind`, `flags` and `hasCustomResolver`; D1361 to D1365, D1376 to D1378, D1382 and D1511 to D1514 build through it.
- `packages/daemon/test/selection/select-tests.test.ts`: D2014 ("a selection carries policy version 4") asserts the literal 4.
- `packages/daemon/test/selection/defects.json`: D2014 (`export const SELECTION_POLICY_VERSION = 4;`), D2012 (`  if (path === NON_INPUTS_FILE) kinds.push(TRIGGER.nonInputsFile);\n`) and D2013 (`      path === NON_INPUTS_FILE ||\n`) lose their anchors.
- `select-tests.test.ts` D1426 and D1427 read `SELECTION_POLICY_VERSION` by name and stay green.

#### Doc text

A draft for the orchestrator, final wording to follow the build.

- `docs/architecture.md`, the dependency-information paragraph: in the list of widenings, "an alias replacement that is neither an absolute path nor a bare package name" becomes "an alias replacement that is neither an absolute path nor a bare package name, and an alias with a `customResolver` or a string `find` of `/` (or the empty string Vite makes of it), which Vite warns against". In the `selectTests` paragraph, "and `rt-test.json` at the root each select every Vitest workspace" becomes "and `rt-test.json` at the root, or a path under it, its name compared as the host compares names (case-folded on Windows), each select every Vitest workspace".
- `README.md`: no change; selection has no production caller until 2.3e.

#### Previous ticket

2.3c (done, a3ca5bc), the nearest earlier key in the status file, from its Dev Notes and its landed code: one protection value, built by one producer from the discovery in effect, is what `declaredNonInputs` consults for both callers (its § Design notes); its Q4 ruling raised the policy version to 4 and foresaw this ticket's raise to 5; its "Case" note keeps pattern matching case-sensitive on every platform, which this ticket does not touch, since AC3 concerns only the declaration file's own name. From 2.3b (done), whose shipped code this ticket reads: each alias is reported as `{ find, findKind, flags, replacement, hasCustomResolver }`, a RegExp `find` as its `source` and a string as written (`vitest/selection-facts.ts` `reportedAlias`: `find: isString ? find : find.source`), a project's own aliases first in config order, then those Vite adds; `flags` is empty for a string `find` (the 23:50 ruling); `hasCustomResolver` is `customResolver !== undefined && customResolver !== null`. `git log --oneline -12` shows no code commit since 2.3b's (73788aa, and the test fix b1b0152).

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3b, § Ticket 2.3c, § Ticket 2.3d, § Ticket 2.3e.
- Ticket 2.2 (`_agent-docs/tickets/2-2-workspace-selection.md`) AC4, and its review note "Every alias reaches by prefix".
- Ticket 2.3b (`_agent-docs/tickets/2-3b-selection-facts.md`) § Pending siblings (2.3d derives `ResolvedAlias` from the report) and § Completion Notes.
- Ticket 2.3c (`_agent-docs/tickets/2-3c-protect-selection-inputs.md`) AC5, Q4, § Design notes.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (02:05).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C14,C38,C39,C46,C48,C55,C57,C59,C117,C126,C129 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P14,P16,P17,P21 -->

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
  - packages/daemon/src/selection/selection-types.ts
  - packages/daemon/src/selection/vitest-edges.ts
  - packages/daemon/src/selection/select-tests.ts
  - packages/daemon/src/inputs/non-inputs.ts
files_to_create:
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

- _agent-docs/tickets/2-3d-alias-widening.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3d scope line and ticket link, under the orchestrator's 02:12 grant)

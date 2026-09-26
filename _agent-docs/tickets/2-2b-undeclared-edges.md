# Ticket 2.2b: Undeclared cross-workspace edges

## Ticket

As a coding agent editing a consumer whose packages reach each other by relative import, tsconfig mapping or an undeclared package name,
I want workspace selection to find those dependencies statically, without running anything, and to widen wherever it cannot read a file,
so that a dependency no `package.json` declares never hides a failure from a selected run (NFR2), and each selection names which kind of edge chose each test.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: A relative module specifier in a source file makes the file's package workspace depend on the package workspace it resolves into, when that is another one; a specifier resolving outside the consumer root adds no edge. This covers a specifier written as a string literal, or a template literal with no substitution, in a static import or re-export, a dynamic `import()`, a `require()` or `require.resolve()` call, a `vi.mock`, `vi.doMock`, `vi.importActual`, `vi.importMock`, `vi.unmock` or `vi.doUnmock` call, an `import.meta.resolve()` call, a TypeScript `import x = require()` declaration, a `/// <reference path>` directive, an `import.meta.glob` pattern, or each element of an array of them, ignoring a `!` negation (depending on the package workspace owning the directory before its first wildcard and on every package workspace nested under that directory), or a `new URL(specifier, import.meta.url)`. A query or hash suffix on the specifier does not change where it resolves. The dependency's producer names its kind (relative import), the file and the specifier, and the selection reason quotes it.
- [ ] AC2: A bare module specifier in a source file, in any form AC1 lists apart from `new URL` (whose specifier without a scheme always resolves relative to the file, as in AC1), whose package name (its first segment, or first two for a scoped name) is a listed package workspace's `name` makes the file's package workspace depend on that one, whether or not a `package.json` declares it, when that is another one. While the package workspace listing is incomplete, a bare specifier naming no listed package workspace makes the file's package workspace depend on every package workspace, as 2.2's AC4 does for a manifest dependency. The producer names its kind (bare import), the file and the specifier.
- [ ] AC3: A `tsconfig*.json` or `jsconfig*.json` file in a package workspace makes that workspace depend on each other package workspace its `extends` (a string or each entry of an array; a path, or a package name of a listed package workspace, with AC2's incomplete-listing rule), a `references` entry's `path`, or a `compilerOptions.paths` target resolves into. A `paths` target resolves against the nearest `baseUrl` along the file's `extends` chain, else the file's own directory; a file with `paths` whose `extends` chain cannot be followed makes its workspace depend on every package workspace. A target holding a wildcard depends, as AC1's glob pattern does, on the package workspace owning the directory before the wildcard and every package workspace nested under it. Each string target of a `package.json` `imports` entry, including one nested under conditions or in an array, does the same when it resolves into another package workspace: a relative target by path from the package directory, a bare target by AC2's name rule. The producer names its kind (tsconfig or manifest imports), the file and the field.
- [ ] AC4: A file or directory selection cannot read, a source file, tsconfig or jsconfig file that does not parse, and a file named `*.vue`, `*.svelte`, `*.astro` or `*.mdx` each make their package workspace depend on every package workspace, naming the file and the cause. A walk that reaches its depth bound or its file limit does the same, naming the directory or the workspace.
- [ ] AC5: The source files scanned are the files ending `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts` or `.tsx` (declaration files included) under each package workspace's directory, apart from the directories of package workspaces nested inside it (scanned as their own), `node_modules` and `.git`. The walk follows no directory link, but a link it finds that resolves into another package workspace makes the walked workspace depend on that one, with a producer naming its kind (link) and the link.
- [ ] AC6: Finding these dependencies reads and parses files only: it loads no Vitest, no config and no project module, and executes no project code: a scan over a fixture whose source files, Vitest config and tsconfig `extends` target each write a marker file when executed leaves no marker.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                         | Why it matters if wrong                                                                                                                                               | How to check                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| U1  | Does `oxc-parser` 0.151.0 load its native binding on Linux x64 under Node 22 and 24, the other gated platform? The spike exercised Windows x64 on Node 24.19 only. | A missing binding throws when the module loads, before any per-file parse, so no AC4 widening applies: selection fails outright on Linux, and so does the Linux gate. | Run the scan's tests in the Linux gate, or `node -e "require('oxc-parser').parseSync('a.ts','')"` on Linux under Node 22. |
| U2  | Does `parseSync` report a syntax error in `.d.ts`, `.cts` and `.mts` files as it does in `.ts`, choosing the language from the file name?                          | A file parsed under the wrong language either widens needlessly or, if it drops a specifier silently, misses an edge.                                                 | Read `ParserOptions.lang` handling in `oxc-parser`'s `src-js/index.d.ts` and parse one of each in a scratch script.       |
| U3  | Does `parseSync` accept JSX in a `.js` or `.mjs` file?                                                                                                             | If not, every such file is a parse failure that widens its workspace to every package workspace (AC4), so a React consumer selects everything on every change.        | Parse `export const a = <div/>;` as `a.js` in a scratch script.                                                           |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing. Confirm with the orchestrator that `oxc-parser` 0.151.0 is in `packages/daemon/package.json` `dependencies` and `bun.lock` before the first import; the orchestrator adds it at dispatch.
- [ ] (AC4, AC5, AC6) Create the walk in `packages/daemon/src/selection/` (for example `source-walk.ts`): for each package workspace from ticket 2.2's listing, list its files without following directory links, skipping nested package workspace directories, `node_modules` and `.git`, under a named depth bound (C28) and a named per-workspace file limit (C22), a workspace past the limit being an uncertainty like a reached depth bound. Return the JavaScript and TypeScript source files, the tsconfig and jsconfig files, each link's resolved target, and each unreadable path, bound-reached directory and plugin-format file as an uncertainty with its cause.
- [ ] (AC1, AC2, AC4, AC6) Create the specifier extraction (for example `source-imports.ts`): parse one file with `oxc-parser`'s `parseSync`, returning its literal specifiers from the module record (static imports, re-exports, literal dynamic imports) and from a visit of the calls and constructions AC1 lists. A result with any error is a parse failure (AC4), never a partial list of specifiers. A computed argument yields no specifier and no widening (§ Known limits).
- [ ] (AC3, AC4, AC6) Create the tsconfig and `imports` reading (for example `tsconfig-edges.ts`): parse each tsconfig or jsconfig as JSONC with the same parser, wrapping the text as an expression with `preserveParens: false` (§ Spike facts), and read `extends`, `references[].path`, `compilerOptions.baseUrl` and `compilerOptions.paths`. Read each package workspace's `package.json` `imports` targets.
- [ ] (AC1, AC2, AC3, AC4, AC5) In 2.2's `packages/daemon/src/selection/workspace-graph.ts` and `selection-types.ts`, add the producer kinds (relative import, bare import, tsconfig, manifest imports, link) and feed the new edges and uncertainties through 2.2's edge and uncertainty types. Strip a specifier's query or hash suffix and cut a glob pattern or `paths` target to the directory before its first wildcard (AC1, AC3). Resolve it against the importing file's real directory, by its real path where it exists, else lexically, and own it by 2.2's deepest-package-workspace rule compared against each package workspace's real directory; a target outside the consumer root adds no edge. Raise 2.2's selection policy version, since the same inputs can now select more (2.2's AC11).
- [ ] (Support) Report to the orchestrator, as exact text, the `docs/architecture.md` sentences naming the producers and the known limits in § Known limits; do not edit it.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- Ticket 2.2's package workspace listing in `packages/daemon/src/vitest/find-workspaces.ts`, its dependency information builder (`workspace-graph.ts`), its edge, uncertainty and producer types and its selection policy version (`selection-types.ts`), and its deepest-package-workspace ownership rule. Import them as 2.2 lands them; never a second ownership or listing rule (C8).
- `find-workspaces.ts` `relativePosixPath(from, to)` for root-relative `/`-separated paths.
- `packages/daemon/src/vitest/error-text.ts` `errorText(error)` for the cause of an unreadable file.
- `oxc-parser` 0.151.0: `parseSync(filename, sourceText, options)` returning `program`, `module` (`staticImports`, `staticExports`, `dynamicImports`) and `errors`, and `Visitor` for calls and `new` expressions (§ Spike facts).

### Must Create

- The source walk, the specifier extraction, and the tsconfig and `imports` reading, each returning edges and uncertainties in 2.2's types.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

- The owner's ruling (18:07, relayed by the orchestrator), which this ticket delivers: "Cross-workspace dependencies that no package.json declares must widen selection in 2.2, not ship as a documented limit. The common kinds are found statically without running anything: relative import specifiers that resolve outside the importing workspace, tsconfig `paths`, `extends` and `references` pointing into another workspace, and config aliases or setup files resolving into another workspace." "A source file selection cannot read or parse is uncertainty, so widen." "Kinds it cannot see statically (a computed dynamic import path, say) are a named known limit for M3; list them explicitly. Explanations name each edge's producer (manifest, relative import, tsconfig, alias)."
- FR7: "Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts."
- NFR2: "Find in every selected run each failure that a full run over the same input snapshot finds, across the controlled edit corpus."
- `docs/architecture.md` § Dependency index: "Preserve the reason and producer of each edge." "File granularity then comes from static module dependencies, conservatively widened for unresolved behavior."
- `AGENTS.md` § Product guarantees: "Widen selection when dependency information is uncertain."
- Glossary, verbatim: **Widening** "Adding tests to a selection because a dependency is uncertain."
- Ticket 2.2 selects over declared dependency information: manifests, discovered test modules, and the setup-file and alias inputs. This ticket adds the edges no `package.json` declares, at the same workspace granularity. Import analysis here only decides which package workspaces depend on which; file-level selection stays M3's (FR16).

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.2b` over `packages/daemon/src/selection`, `packages/daemon/package.json`, `bun.lock`, `docs/architecture.md` and `packages/daemon/test/selection` named 2.2 (the selection folder, its test folder, `docs/architecture.md`), 1.3 and 1.3c (`packages/daemon/package.json`, `bun.lock`, `docs/architecture.md`), 1.4 (`packages/daemon/package.json`, in its search list only) and 1.3b (`docs/architecture.md`).

- **2.2** must land first: this ticket edits its `workspace-graph.ts` and `selection-types.ts` and reuses its listing and ownership rule. It builds after 2.2 (R1).
- **1.3** writes `packages/daemon/package.json` (its `./client` export). The orchestrator adds `oxc-parser` to the same file and `bun.lock` at this ticket's dispatch, once 1.3's hunk has landed (R2). This ticket's session writes neither.
- **1.3c** writes `bun.lock` for the CLI workspace; the orchestrator sequences the two lock writes.
- **2.3** wires selection into the daemon and waits for this ticket, so selection never ships without detection (R1).
- **2.1** decides which files are inputs; this ticket scans what exists on disk and never decides freshness.
- **M3, FR16** takes file granularity and the known limits below.

#### Owner rulings and grill record

- R1, split (orchestrator, 18:15): the owner's 18:07 ruling (detect and widen) took ticket 2.2 past both size limits, so it split by outcome. 2.2 keeps selection over declared dependency information; this ticket, `2-2b-undeclared-edges`, takes source-import and tsconfig detection and builds after 2.2 lands. 2.3 waits for both.
- R2, parser (orchestrator, 18:15): `oxc-parser` 0.151.0 approved: the same toolchain family as the repository's oxlint, it passes P9, and its engines cover Node 22.13. The orchestrator adds it to `packages/daemon/package.json` and `bun.lock` at this ticket's dev dispatch, once 1.3's `package.json` hunk has landed.
- R3, framework component files (orchestrator, 18:15): a workspace holding a file the parser cannot read, such as `.vue` or `.svelte`, selects on every change until M3. Accepted, since it widens, which the owner's ruling requires (AC4).
- R4, computed specifiers (owner, 18:07): a specifier the scan cannot see statically is a named known limit for M3, not a widening (§ Known limits).
- Ticket review (create-ticket 6c, 18:19): all 17 edits applied, covering the task's suffix, glob and real-path rules, producer kinds in every criterion, AC6's marker test, AC2's incomplete-listing and self-edge rules, wildcard directory segments and glob arrays, a closed plugin-format list, `new URL` kept relative, closed extension and form lists, `extends` arrays, conditional `imports`, U1's failure mode, the new U3, computed forms in the known limits, and the depth and file bounds widening. Author's answer on an inherited `baseUrl`: follow the `extends` chain, and widen where it cannot be followed (AC3).

#### Spike facts

A read-only spike in a temporary directory outside the repository (deleted afterwards) installed `oxc-parser@0.151.0` with npm and ran it on Node 24.19.0, Windows x64:

- `npm view oxc-parser`: version 0.151.0, published 2026-09-21T12:33:39Z; `engines` `^20.19.0 || >=22.12.0`; one dependency, `@oxc-project/types` `^0.151.0`, plus optional native bindings per platform, `@oxc-parser/binding-win32-x64-msvc` and `@oxc-parser/binding-linux-x64-gnu` among them.
- `src-js/index.d.ts`: `parseSync(filename, sourceText, options?)` returns a `ParseResult` with `program`, `module: EcmaScriptModule` (`staticImports[].moduleRequest.value`, `staticExports[].entries[].moduleRequest`, `dynamicImports[].moduleRequest` as a `Span`), `comments` and `errors: OxcError[]`; `class Visitor { constructor(visitor: VisitorObject); visit(program) }`; `ParserOptions` `lang`, `sourceType`, `astType`, `range`, `preserveParens` (default true), `showSemanticErrors`.
- On a `.tsx` source, `staticImports` gave `../other/t` (an `import type`, reported like any import) and `../../pkg-b/src/x`; `staticExports` gave `./y`; `dynamicImports` spans sliced to `"../c/lazy"` (quotes included) and `name` (a computed argument, told apart only by its source text); a `Visitor` on `CallExpression` and `NewExpression` saw `vi.mock` with literal `../mocked/m`, `import.meta.glob` (callee object a `MetaProperty`) with literal `../other/*.ts`, and `new URL` with literal `../assets/f.json`. On a `.cjs` source it saw `require` and `require.resolve` with literals and `require` with an `Identifier` argument. A template literal with no substitution, ``import(`../tpl/no-expr`)``, appears in `dynamicImports`.
- A syntax error (`import { from "../x";`) returned one error, reading "Expected , or } but found string" (backticks dropped here), and a `staticImports` entry with an empty specifier, so a result with errors must be treated as unparsed (AC4), never read for specifiers.
- A JSONC tsconfig with line and block comments and trailing commas, wrapped as `(<text>)` and parsed as `tsconfig.js` with `preserveParens: false`, returned no errors and an `ObjectExpression` whose keys were `extends`, `compilerOptions`, `references`. With the default `preserveParens` the object sits inside a `ParenthesizedExpression`.

#### Known limits

These are not seen statically and do not widen, until M3 (R4). Each goes into `docs/architecture.md` as the Support task reports:

- A computed module path in any form AC1 lists, such as `import(expr)`, `require(expr)`, `vi.mock(expr)`, or a template literal with a substitution.
- A file read by a built path, such as a fixture read with `fs` from `path.join(__dirname, "../../other")`.
- CSS `@import` and other asset references resolved by Vite plugins.
- Vite root-absolute specifiers (`/src/x`) and `file:` URL specifiers.
- Code generated at build time, which is not on disk to scan.
- A file the parser accepts whose imports a Vite plugin rewrites.

#### Design notes

- **Per-file facts.** Return edges and uncertainties per scanned file, so a later caller can rescan only the changed files; this ticket rescans on every call and measures nothing. No performance figure is claimed.
- **Scope of the analysis.** It decides dependency between package workspaces only. Which test inside a workspace an edge reaches is unanalyzed (M3).
- **The depth bound and file limit widen instead of throwing (C28, C22).** Reaching either makes the workspace depend on every package workspace, a complete conservative answer rather than a partial one; a throw would fail every selection over one deep or large directory, and dropping files past a limit would narrow (C126).
- **Parse errors widen whole.** A file with any error contributes no specifiers and one uncertainty, since the spike showed a partial record carries empty specifiers.

#### Sizing

About 11 raw files, 14 estimated: 3 production files created and 2 of 2.2's modified, with `packages/daemon/package.json` and `bun.lock` written by the orchestrator; for create-tests, a test file and its `defects.json` under `packages/daemon/test/selection/` and a fixture tree under `test/fixtures/daemon/`; and the `docs/architecture.md` text. Code units: 6 criteria plus validation, 7. Implementation is delegated to implementer agents, since the estimate is above 10.

#### Current structure of the modified files

`workspace-graph.ts` and `selection-types.ts` do not exist until 2.2 lands. Read them as 2.2 leaves them before the first edit.

#### Existing tests this change breaks

A 2.2 test that pins the selection policy version changes value when the last graph task raises it; create-tests updates that expectation, since the intended behavior changed. Read 2.2's test files once it lands to confirm. No other test is expected to break.

#### Previous ticket

2.2 (ready-for-dev when this was written, unbuilt): read its Dev Agent Record once it lands for the shape of its listing, edges and uncertainties.

### References

- `_agent-docs/tickets/2-2-workspace-selection.md`: the selection this ticket extends.
- `docs/architecture.md` § Dependency index; `docs/requirements.md` FR7, NFR2.
- GitHub issues: `node scripts/list-open-issues.mjs` reported 0 open issues, complete.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C11,C12,C13,C14,C19,C22,C26,C28,C29,C30,C32,C42,C46,C48,C59,C126,C129,C140,C143 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P8,P9,P10,P13,P16,P17,P18,P21,P27,P31,P42 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area: packages/daemon
is_consolidation: false
sizing_ac_count: 7
files_to_modify:
  - packages/daemon/src/selection/workspace-graph.ts
  - packages/daemon/src/selection/selection-types.ts
files_to_create:
  - packages/daemon/src/selection/source-walk.ts
  - packages/daemon/src/selection/source-imports.ts
  - packages/daemon/src/selection/tsconfig-edges.ts
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

- `_agent-docs/tickets/2-2b-undeclared-edges.md` (created, the second part of 2.2's split)
- Held for the orchestrator, as exact text: the sprint-2 file's 2.2b section, the `2-2b-undeclared-edges` status key, and FR7's marker in `docs/requirements.md`.

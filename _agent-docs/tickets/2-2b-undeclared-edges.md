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

- [x] AC1: A relative module specifier in a source file makes the file's package workspace depend on the package workspace it resolves into, when that is another one; a specifier resolving outside the consumer root adds no edge. This covers a specifier written as a string literal, or a template literal with no substitution, in a static import or re-export, a dynamic `import()`, a `require()` or `require.resolve()` call, a `vi.mock`, `vi.doMock`, `vi.importActual`, `vi.importMock`, `vi.unmock` or `vi.doUnmock` call, an `import.meta.resolve()` call, a TypeScript `import x = require()` declaration, a `/// <reference path>` directive, an `import.meta.glob` pattern, or each element of an array of them, ignoring a `!` negation (depending on the package workspace owning the directory before its first wildcard and on every package workspace nested under that directory), or a `new URL(specifier, import.meta.url)`. A query or hash suffix on the specifier does not change where it resolves. The dependency's producer names its kind (relative import), the file and the specifier, and the selection reason quotes it.
- [x] AC2: A bare module specifier in a source file, in any form AC1 lists apart from `new URL` and `/// <reference path>` (whose specifier without a scheme always resolves relative to the file, as in AC1), whose package name (its first segment, or first two for a scoped name) is a listed package workspace's `name` makes the file's package workspace depend on that one, whether or not a `package.json` declares it, when that is another one. While the package workspace listing is incomplete, a bare specifier naming no listed package workspace makes the file's package workspace depend on every package workspace, as 2.2's AC4 does for a manifest dependency. A specifier with a URL scheme (two or more letters then a colon, such as `node:`, `data:` or `virtual:`, so a Windows drive letter never matches), or starting with `#` (a subpath import, which AC3's manifest-imports edges cover), is not bare: it adds no edge and no widening. The producer names its kind (bare import), the file and the specifier.
- [x] AC3: A `tsconfig*.json` or `jsconfig*.json` file in a package workspace makes that workspace depend on each other package workspace its `extends` (a string or each entry of an array; a path, or a package name of a listed package workspace, with AC2's incomplete-listing rule), a `references` entry's `path`, or a `compilerOptions.paths` target resolves into. A `paths` target resolves against the nearest `baseUrl` along the file's `extends` chain, else the file's own directory; a file with `paths` whose `extends` chain cannot be followed makes its workspace depend on every package workspace. A target holding a wildcard depends, as AC1's glob pattern does, on the package workspace owning the directory before the wildcard and every package workspace nested under it. Each string target of a `package.json` `imports` entry, including one nested under conditions or in an array, does the same when it resolves into another package workspace: a relative target by path from the package directory, a bare target by AC2's name rule. The producer names its kind (tsconfig or manifest imports), the file and the field.
- [x] AC4: A file or directory selection cannot read, a source file, tsconfig or jsconfig file that does not parse, and a file named `*.vue`, `*.svelte`, `*.astro` or `*.mdx` each make their package workspace depend on every package workspace, naming the file and the cause. A walk that reaches its depth bound or its file limit does the same, naming the directory or the workspace.
- [x] AC5: The source files scanned are the files ending `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts` or `.tsx` (declaration files included) under each package workspace's directory, apart from the directories of package workspaces nested inside it (scanned as their own), `node_modules` and `.git`. The walk follows no directory link, but a link it finds that resolves into another package workspace makes the walked workspace depend on that one, with a producer naming its kind (link) and the link.
- [x] AC6: Finding these dependencies reads and parses files only: it loads no Vitest, no config and no project module, and executes no project code: a scan over a fixture whose source files, Vitest config and tsconfig `extends` target each write a marker file when executed leaves no marker.
- [x] AC7: When the consumer root lies in a git repository, the walk skips every path git itself reports as ignored, never a re-implementation of `.gitignore` matching: a gitignored file or directory is neither scanned nor counted toward the walk's file limit. Git runs with no inherited `GIT_*` environment. Outside a git repository, or when git cannot be run or its output read, the walk proceeds as AC5 describes and widens nothing extra.

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

Resolutions (dev, 2026-09-26, probes run inside `packages/daemon` on Node 24.19.0, Windows x64, deleted afterwards):

- **U1: UNRESOLVABLE here, pending the Linux gate.** `bun.lock:95` locks `@oxc-parser/binding-linux-x64-gnu@0.151.0` (with `-musl` at `bun.lock:97`) as an optional dependency of `oxc-parser` (`bun.lock:399`), so the binding installs on Linux x64. Whether it loads under Node 22 and 24 needs a Linux run, and WSL is reserved for another gate until 22:10. The orchestrator is asked to run the scan's tests in the Linux gate. The code imports `oxc-parser` at module load, so a missing binding fails loudly and never narrows.
- **U2: CONFIRMED.** `node_modules/.bun/oxc-parser@0.151.0/node_modules/oxc-parser/src-js/index.d.ts:169-181`: `lang` and `astType` default from the file name's extension. A syntax error in `b.d.ts`, `d.cts`, `f.mts` and `i.d.cts` each returned one error ("Unexpected token"), and valid `.d.ts`, `.d.mts`, `.cts` (with `import x = require()`) and `.mts` sources returned none.
- **U3: FALSE.** `export const a = <div/>;` as `j.js`, `k.mjs` and `l.cjs` each returned "Unexpected JSX expression". Re-plan, code only: `.js`, `.mjs` and `.cjs` parse with `lang: "jsx"`, which accepted JSX and plain JS alike. `.cjs` also passes `sourceType: "commonjs"`, since `lang: "jsx"` alone rejected a top-level `return` that the extension default accepts. A `.js` or `.ts` file with a top-level `return` is a parse error under the extension default (and under `sourceType: "unambiguous"`), so it widens by AC4.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing. Confirm with the orchestrator that `oxc-parser` 0.151.0 is in `packages/daemon/package.json` `dependencies` and `bun.lock` before the first import; the orchestrator adds it at dispatch.
- [x] (AC4, AC5, AC6) Create the walk in `packages/daemon/src/selection/` (for example `source-walk.ts`): for each package workspace from ticket 2.2's listing, list its files without following directory links, skipping nested package workspace directories, `node_modules` and `.git`, under a named depth bound (C28) and a named per-workspace file limit (C22), a workspace past the limit being an uncertainty like a reached depth bound. Return the JavaScript and TypeScript source files, the tsconfig and jsconfig files, each link's resolved target, and each unreadable path, bound-reached directory and plugin-format file as an uncertainty with its cause.
- [x] (AC1, AC2, AC4, AC6) Create the specifier extraction (for example `source-imports.ts`): parse one file with `oxc-parser`'s `parseSync` (with U3's resolved language options for `.js`, `.mjs` and `.cjs`), returning its literal specifiers from the module record (static imports, re-exports, literal dynamic imports) and from a visit of the calls and constructions AC1 lists. A result with any error is a parse failure (AC4), never a partial list of specifiers. A computed argument yields no specifier and no widening (§ Known limits).
- [x] (AC3, AC4, AC6) Create the tsconfig and `imports` reading (for example `tsconfig-edges.ts`): parse each tsconfig or jsconfig as JSONC with the same parser, wrapping the text as an expression with `preserveParens: false` (§ Spike facts), and read `extends`, `references[].path`, `compilerOptions.baseUrl` and `compilerOptions.paths`. Read each package workspace's `package.json` `imports` targets.
- [x] (AC1, AC2, AC3, AC4, AC5) In 2.2's `packages/daemon/src/selection/workspace-graph.ts` and `selection-types.ts`, add the producer kinds (relative import, bare import, tsconfig, manifest imports, link) and feed the new edges and uncertainties through 2.2's edge and uncertainty types. Strip a specifier's query or hash suffix and cut a glob pattern or `paths` target to the directory before its first wildcard (AC1, AC3). Resolve it against the importing file's real directory, by its real path where it exists, else lexically, and own it by 2.2's deepest-package-workspace rule compared against each package workspace's real directory; a target outside the consumer root adds no edge. Raise 2.2's selection policy version, since the same inputs can now select more (2.2's AC11).
- [x] (AC7) Read the consumer root's gitignored paths once per scan from git (a daemon-side helper, since `scripts/lib/git.mjs` is tooling-only), with `GIT_*` scrubbed from its environment, and have the walk skip them before counting. Any failure to run or read git skips nothing and widens nothing.
- [x] (Support) Report to the orchestrator, as exact text, the `docs/architecture.md` sentences naming the producers and the known limits in § Known limits; do not edit it.
- [x] (Support) Lint and typecheck.

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
- Sanity check (dev, 21:56; author d63260c0, 21:58): the author confirmed F1 and F2 and updated AC2. `/// <reference path>` resolves relative to the file, like `new URL`. A URL-scheme specifier and a `#` subpath import are not bare, and add no edge and no widening.
- R5, U1 (orchestrator, 2026-09-27 01:27): the tests member proves the Linux native binding on WSL under Node 24 and 22. Nothing is owed from dev.
- R6, native stack overflow (orchestrator, 01:27): accepted as the dev session recommended. 2.3's sprint scope runs selection in a disposable child process, so a file that overflows the parser's native stack fails that one selection loudly instead of ending the daemon. It is named in § Known limits.
- R7, build output (orchestrator, 01:27): fixed in this ticket as AC7. A Next.js app's `.next/` directories can pass the 50,000-entry limit, which would widen every selection on the owner's proving ground. Inside git, the walk skips every path git reports as ignored, taken from git itself and never by re-implementing `.gitignore` matching. Outside git, or when git cannot be run or read, it walks as before and widens nothing extra. Running git is not running project code, but its `GIT_*` environment is scrubbed. A gitignored file is a named known limit.

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
- A gitignored file, such as build output or generated code, which is not scanned (AC7, R7).
- A file that overflows the parser's native stack ends the selecting process; 2.3 isolates it (R6).
- Type-level references (`/// <reference types>`, `import()` types), which cannot change a test's runtime result.

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

Dev session: threadId bf9cfc1f-b6b0-4e44-b808-abeb5b9b06bb

#### Test Files This Change Broke

No test was run (dev-ticket runs none). Two files are at risk:

- `packages/daemon/test/selection/workspace-graph.test.ts`: `buildDependencyInformation` now walks and parses every fixture tree, and the harness's `links` option makes the walk add a link edge. D1515 links `packages/b/l` to `packages/c/deep`, so `packages/b` gains a link edge to `packages/c`. Its expected selection (`[APP]`) should still hold, since `b` is not a Vitest workspace. Any test asserting an exact `edges` or `uncertainties` list over a tree holding a link, a source file with imports, or a tsconfig may now see more records.
- `packages/daemon/test/selection/select-tests.test.ts`: `SELECTION_POLICY_VERSION` is now 2. The tests compare against the imported constant, and the two `defects.json` mutations anchor on the constant's name, so neither should change.

#### ACs Owed a Test

None. Every criterion has command evidence from the scratch runs listed in Completion Notes. create-tests still owns proving each one.

#### Tests Owed

Defects met while building, each fixed in source and each earning a named test:

- A bare specifier with a query or hash suffix (`"b?worker"`, `"@s/c#frag"`) kept the suffix in its package name, matched no workspace and dropped the edge (AC1, AC2).
- A `package.json` `imports` target with a URL scheme (`"node:fs"`) widened while the listing was incomplete (AC2, AC3).
- Two `extends` entries sharing a base config were reported as an `extends` cycle, so a file with `paths` widened (AC3).
- A dangling link widened its workspace. It now depends on the workspace its link text names (AC5).
- A source file nested past 1,000 brackets reached the native parser, which ends the process at about 4,500 levels. It now widens before the parse (AC4).
- A `RangeError` thrown while walking the AST escaped `buildDependencyInformation`. It now widens the file (AC4).
- A root spelled through a Windows short name labelled a link target `../../../Kevin Lingofelter/...` (AC5 detail).
- AC7: inside a git repository, a gitignored directory holding an unparsable file and a cross-workspace import adds neither a widening nor an edge, while a tracked file in an ignored directory is still scanned. An inherited `GIT_DIR` does not change that. Outside git, the same tree walks as AC5 describes. A test fixture needs a real git repository, built from the shared git fixture settings (P44).

### Tests Record

Tests session: threadId 209c6f46-4207-4e14-96e3-b77be9152b86

Tests live in `packages/daemon/test/selection/workspace-graph.test.ts` (D1581 to D1641, D1654, D1655) and the new `source-scan.test.ts` (D1642 to D1653), whose `node:fs` stand-in pads a `pad-<n>` directory to `<n>` entries and refuses reads of paths named `unreadable.ts`, `unlistable` and `unreadable-link`. The AC7 tests build real git repositories with `writeFixtureGitConfig` under a global config holding a failing hook, commit signing and `user.useConfigOnly`. The app-tree helpers moved from `workspace-graph.test.ts` into `harness.ts`, which also gained `prepare` and `inspectTree`.

U1 (R5): CONFIRMED on Linux. In the WSL gate clone (clean at 69d9a58 plus this tree, `bun install --frozen-lockfile`, 2026-09-27 01:57), `@oxc-parser/binding-linux-x64-gnu@0.151.0` loaded and `parseSync("a.ts", ...)` returned its import with no errors under Node 22.23.3 and 24.19.0, and `packages/daemon/test/selection` passed under both, 3 files and 177 tests, exit 0. `bun run test:defects` in the same clone under Node 24.19.0 (01:58 to 02:01) exited 0, 1032 of 1032 detected, so every mutation here is observable on Linux as well as Windows (C156). The clone was then returned clean and detached at 69d9a58.

Stale test updated: D1515 asserted the selection `[APP]`. The new link edge from `packages/b` to `packages/c` selects the app through `b`, so the selection no longer isolated its mutation (verify-defects: "exit 0; passed 1; failed: none"). It now asserts the app's own edges, `manifest packages/b` and `manifest packages/c`, with its mutation unchanged.

#### Named Defects

- D1581: Static imports are not read, so a file importing another workspace adds no edge (AC1).
- D1582: Re-exports are not read (AC1).
- D1583: A literal dynamic `import()` is not read (AC1).
- D1584: A template literal with no substitution is treated as computed (AC1).
- D1585: A `require()` call is not read (AC1).
- D1586: A `require.resolve()` call is not read (AC1).
- D1587: `vi.importMock` is missing from the Vitest module methods; the test covers all six (AC1).
- D1588: An `import.meta.resolve()` call is not read (AC1).
- D1589: A TypeScript `import x = require()` is not read (AC1).
- D1590: A `/// <reference path>` directive is not read (AC1).
- D1591: A reference path without `./` resolves as a module request, so it widens as a bare name while the listing is incomplete (AC1, AC2).
- D1592: A glob pattern misses the workspaces nested under the directory before its wildcard (AC1).
- D1593: A glob pattern misses the workspace owning the directory before its wildcard (AC1).
- D1594: An `import.meta.glob` array is treated as computed (AC1).
- D1595: A negated glob pattern keeps its `!` and depends on nothing (AC1).
- D1596: A `new URL(specifier, import.meta.url)` is not read (AC1).
- D1597: A relative specifier keeps its query suffix and resolves to the wrong workspace (AC1).
- D1598: A specifier resolving outside the consumer root depends on the root workspace (AC1).
- D1654: An absolute specifier is read as a bare name, so an absolute import adds no edge (AC1).
- D1599: A relative import's detail drops the specifier, so the selection reason cannot name it (AC1).
- D1600: A bare specifier naming a listed workspace no manifest declares adds no edge (AC2).
- D1601: A scoped specifier's package name is cut to one segment (AC2).
- D1602: While the listing is incomplete, an unlisted bare name adds nothing instead of widening (AC2).
- D1603: A URL scheme is not recognized, so `node:fs` widens while the listing is incomplete (AC2).
- D1604: A `#` subpath import widens as a bare name (AC2).
- D1605: A bare specifier keeps its query suffix in its package name and drops the edge (AC1, AC2).
- D1606: A tsconfig `extends` path adds no edge (AC3).
- D1607: Only the first `extends` array entry is read (AC3).
- D1608: An `extends` naming a listed workspace's package adds no edge (AC3).
- D1609: A `references` path adds no edge (AC3).
- D1617: A `jsconfig.json` is not read (AC3).
- D1610: With no `baseUrl`, a `paths` target resolves against the wrong directory (AC3).
- D1611: A config's own `baseUrl` is ignored (AC3).
- D1612: A `baseUrl` inherited through `extends` is ignored (AC3).
- D1613: An earlier `extends` entry's `baseUrl` wins over the later one (AC3).
- D1614: Two `extends` entries sharing a base read as a cycle, so `paths` widens (AC3).
- D1615: A `paths` config whose `extends` chain cannot be followed does not widen (AC3).
- D1616: A wildcard `paths` target misses the workspaces nested under it (AC3).
- D1622: A malformed `references` field is dropped without a widening (AC3, AC4).
- D1623: A config ending in a line comment fails to parse, so its edge becomes a widening (AC3).
- D1624: A tsconfig that does not parse is skipped without a widening (AC4).
- D1618: A relative `imports` target adds no edge (AC3).
- D1619: Conditional and array `imports` values are not descended into (AC3).
- D1620: A bare `imports` target naming a listed workspace adds no edge (AC3).
- D1621: A URL-scheme `imports` target widens while the listing is incomplete (AC2, AC3).
- D1625: A source file with parse errors is read for specifiers instead of widening (AC4).
- D1626: `.astro` is missing from the plugin formats; the test covers all four (AC4).
- D1629: The bracket guard admits 1,001 levels (AC4).
- D1630: The bracket guard refuses exactly 1,000 levels (AC4).
- D1631: A `RangeError` from the syntax tree walk escapes the scan (AC4).
- D1627: The depth bound admits a directory 41 levels down (AC4).
- D1628: The depth bound refuses a directory exactly 40 levels down (AC4).
- D1642: A source file that cannot be read is taken as importing nothing (AC4).
- D1643: A directory that cannot be listed is skipped without a widening (AC4).
- D1644: A link that can be neither resolved nor read is skipped without a widening (AC4).
- D1645: The entry limit admits 50,001 entries (AC4).
- D1646: The entry limit refuses exactly 50,000 entries (AC4).
- D1632: `.mts` is not scanned; the test covers all eight extensions and `.d.ts` (AC5).
- D1633: `.js` parses without JSX, so a React `.js` file widens (AC5).
- D1634: `.cjs` parses as a module, so a top-level `return` widens (AC5).
- D1635: `node_modules` is walked (AC5).
- D1655: `.git` is walked (AC5).
- D1636: A walk descends into nested package workspaces (AC5).
- D1637: The walk follows a directory link (AC5).
- D1638: A link edge is recorded as a relative import, so the reason misnames it (AC5).
- D1639: A dangling link widens instead of depending on where its text points (AC5).
- D1640: A link target under a linked root is labelled through `../`, the portable form of the Windows short-name label (AC5).
- D1641: The scan runs a source file, so a source file, a Vitest config and a tsconfig `extends` target leave markers (AC6).
- D1653: The AC7 fixture repository stops applying the shared fixture git config, so its commit fails under a failing hook, signing and a config-only identity (AC7).
- D1648: The walk ignores what git reports as ignored (AC7).
- D1647: A gitignored entry counts toward the entry limit (AC7).
- D1649: A tracked file inside a gitignored directory is skipped (AC7).
- D1650: An inherited `GIT_DIR` decides what the walk skips (AC7).
- D1651: A repository's `core.fsmonitor` program runs while ignored paths are listed (AC7).
- D1652: Outside git, the walk falls back to reading `.gitignore` itself (AC7).
- D1515 (updated, 2.2): A local path whose link carries it into another workspace yields only its listed holder (AC5 changed what the old assertion observed).

Review gap rows 1 to 12 (review c8368897, 2026-09-27 02:16), all proven by `bun run test:defects` exit 0, 1044 of 1044 detected, 02:20:35 to 02:26:05:

- D1666 (row 1): Only a query suffix is stripped, so a bare `"@x/b#frag"` and a relative `"../../c#x"` lose their workspace (AC1, AC2).
- D1667 (row 2): A file-relative specifier keeps its query suffix, so `new URL("../../b?url", import.meta.url)` resolves to a sibling the root owns (AC1).
- D1668 (row 3): A `tsconfig.build.json` is not read (AC3).
- D1669 (row 4): A dangling link's relative text resolves against the process's working directory (AC5). The `node:fs` stand-in returns the text of a link named `relative-link` relative to its directory.
- D1670 (row 5): A config with no `paths` ignores a base config's `paths` (AC3).
- D1671 (row 6): Inherited `paths` resolve against the walked config's directory instead of the setter's (AC3).
- D1672 (row 7): A config with no `paths` whose `extends` cannot be read does not widen (AC3, AC4).
- D1673 (row 8): A non-string `baseUrl` is ignored instead of widening (AC3, AC4).
- D1674 (row 9): The consumer root's label is empty in a walk-bound cause (AC4).
- D1675 (row 10): Git runs from the consumer root, so an executable named `git` there runs in its place (AC6). The test plants a copy of Node as `git` (`git.exe` on Windows) at the root and puts `.` first on `PATH`, since Linux searches the working directory only through a relative `PATH` entry; proven on Windows.
- D1676 (row 11): A `Visitor` is built per file and the parser keeps each one. `source-scan.test.ts` wraps `oxc-parser`'s `Visitor` to count constructions, and a scan of three files must build none.
- D1677 (row 12): A regular-expression literal the engine cannot build (`/(/`, which `oxc-parser` accepts with a `null` value) is read as JSON `null` (AC4).

Step 9 round (review c8368897, 2026-09-27 06:49), proven by `bun run test:defects` exit 0, 1048 of 1048 detected, 06:53:51 to 07:01:27:

- The `node:fs` stand-in in `source-scan.test.ts` now serves `opendirSync`, since the walk streams directories: a `pad-<n>` directory yields its real entries then plain files up to `<n>`, a `skipped-<n>` directory yields `<n>` `node_modules` entries before its real ones, `unlistable` is refused, and each stand-in directory records how many entries were read. D1643, D1645 and D1674 pass again, unchanged.
- Re-anchored: D1635, D1655 (`GIT_DIRECTORY`), D1648 (`isSkipped`), D1647 (now counts an ignored entry inside the `keep` callback).
- D1678 (row 13): Skipped entries read from a directory use up the remaining budget, so a directory whose `node_modules` entries pass it stops before its kept file (AC5, AC7).
- D1679 (row 14): A directory is read whole before the bound applies; a `pad-60000` directory must widen without all 60,000 entries being read (AC4).
- D1680 (row 15): A nested repository's own gitignored directory is walked (AC7). Real nested repository, committed under the shared fixture settings.
- D1700 (row 16): Only a `.git` directory marks a repository, so a submodule's gitignored directory is walked (AC7). Real submodule added with `protocol.file.allow=always`.

Re-anchored after the review's fix round and re-proven in the same run: D1611 and D1614 (new text in `tsconfig-edges.ts`), D1612 (its replacement now uses the `Nearest<T>` shape), D1623 (now `jsonc.ts`).

#### Deliberately Untested

- `packages/daemon/src/selection/selection-types.ts`: constants and types only; each new producer and uncertainty kind is asserted by the tests above.
- `packages/daemon/src/selection/git-ignored.ts` `environmentWithoutGit`'s case-insensitive compare: a lowercase `git_dir` reaches git only on Windows, so the mutation is invisible on Linux (C156).
- `packages/daemon/src/selection/git-ignored.ts` `listed.error !== undefined`: inert, since a spawn error or timeout leaves `status` null and `status !== 0` already skips nothing.
- `packages/daemon/src/selection/tsconfig-edges.ts` byte-order-mark strip: inert, since U+FEFF is ECMAScript whitespace and the wrapped text parses either way.
- `packages/daemon/src/selection/tsconfig-edges.ts` `extends` cycle check: the `MAX_EXTENDS_DEPTH` bound widens a cycle anyway, so dropping the check changes only the cause text.
- `packages/daemon/src/selection/tsconfig-edges.ts` `MAX_JSON_DEPTH`, `MAX_EXTENDS_DEPTH` and malformed `extends` and `paths`: the same widening paths as D1615 and D1622; no id was left in the allocation.
- `packages/daemon/src/selection/specifier-edges.ts` `.\` and `..\` relative prefixes and the two-letter URL scheme rule: both distinguish only Windows spellings, so their mutations are invisible on Linux (C156).
- `packages/daemon/src/selection/source-walk.ts` a link to a file: creating a file symlink on Windows needs a privilege the gate does not hold.

### Review Record

Review session: threadId c8368897-f5e2-43a8-bc69-05e884b3bc33

Fixed in review (2026-09-27, about 02:15):

- `git-ignored.ts`: git ran by bare name from the daemon's working directory, which `client.ts` sets to the consumer root, and Windows looks a bare command up in the working directory before PATH, so a `git.exe` committed at the root would run during the scan (AC6). Git now runs from the OS temp directory with an absolute `-C` root. The trailing-`/` strip and empty-entry filter were inert (`path.resolve` normalizes both) and are gone.
- `source-imports.ts`: `oxc-parser` 0.151.0 keeps every `Visitor` it builds in a module-level cache that nothing resets (`src-js/visit/visitor.js`, `enterExitObjectCache`; `initCompiledVisitor` is never called), so one `Visitor` per file held each file's specifiers for the life of the process. One module-level `Visitor` now writes into the file being walked.
- `source-imports.ts` `parseGuarded`: the parser builds `program` lazily on first access (`src-js/wrap.js`), and `readJsonc` read it outside any `try`. It is now read inside the guard and returned with the result.
- `tsconfig-edges.ts`: a config with no `compilerOptions.paths` of its own now takes the nearest `paths` along its `extends` chain, as TypeScript does, resolved against the nearest `baseUrl` along the walked config's chain, else the directory of the config that sets the `paths`. A base config not named `tsconfig*.json` (such as `configs/base.json`) was never read, so its `paths` into another workspace added no edge and no widening (AC3). A chain that cannot be followed while inherited `paths` are sought widens as `extends-unfollowed`. A `baseUrl` that is present but not a string now widens instead of being ignored. The `baseUrl` search and the `paths` search share one `extends` traversal, `nearestAlongExtends`.
- `jsonc.ts` (created): the JSONC reader moved out of `tsconfig-edges.ts`, which the fix above took past the 500-line cap. A regular-expression or BigInt literal is refused explicitly rather than read through its `value`.
- `specifier-edges.ts`: `rootLabel` returned an empty label for the consumer root itself, so a root walk-bound cause read " holds more than 50000 …"; it now reads `.`. The hash-suffix search started at index 1 for a case the function never receives, and now starts at 0.
- `source-imports.ts` comments: the guard refuses bracket nesting only; nesting without brackets still reaches the parser (the native-overflow known limit).

Considered and not fixed: a gitignored generated file carrying the only cross-workspace import is R7's named known limit; a relative import or link resolving outside the consumer root adds no edge by AC1; `.js` CommonJS with a top-level `return` widens, as U3's resolution accepts; the `nested` filter in `addWorkspaceSourceEdges` only narrows a lookup set; every specifier's detail says "imports", matching the relative-import kind AC1 names.

Third-party answers (assumptions agent, installed `oxc-parser` 0.151.0 and git 2.55.0.windows.5): U1, U2 and U3 CONFIRMED. `import x = require()` appears only as a `TSImportEqualsDeclaration`, never in `staticImports`. A `/// <reference path>` is a `Line` comment whose value keeps the third slash. Without `-c core.fsmonitor=false`, `ls-files --others --ignored` runs a hook the repository's config names; with it, nothing runs. An unknown `lang` or `sourceType` is silently ignored.

Tech debt, fixed in Step 9 against ba87f9e (2026-09-27, about 06:55; no open GitHub issue matched):

- `source-walk.ts` `listEntries`: one directory was read and sorted whole before `MAX_WALKED_ENTRIES` applied. It now streams the directory through `opendirSync`, drops skipped entries while reading, and stops once more entries are kept than the walk's remaining budget, sorting only what it kept. Node 24.19's `Dir#readSync` resolves an unknown entry type with `lstatSync`, as `readdirSync` does (`internal/fs/dir` `processReadResult` and `internal/fs/utils` `getDirent`, read with `--expose-internals`).
- `git-ignored.ts` and `source-walk.ts`: `ls-files --others` does not descend into a nested repository or submodule, and `--recurse-submodules` supports only `--cached` and `--stage` (git 2.55 `git-ls-files.html`). The walk now asks git once per scan for the ignored paths of each directory holding a `.git` entry, through `ignoredPathsReader`.

Defect records this fix round moved (anchors re-checked against the tree; each fails to match):

- D1611: `old` `  if (own === undefined) return { ok: true, value: undefined };` → `new` `  if (true) return { ok: true, value: undefined };` in `tsconfig-edges.ts` (every `baseUrl` ignored).
- D1614: `old` `      if (searched.has(next.file)) continue;\n      chain.add(next.file);\n      const found = seek(next.value, next.file, depth + 1);\n      chain.delete(next.file);\n` → `new` `      chain.add(next.file);\n      const found = seek(next.value, next.file, depth + 1);\n`.
- D1623: unchanged text; `file` is now `packages/daemon/src/selection/jsonc.ts`.

Defect records the Step 9 round moved, in `source-walk.ts`:

- D1635: `old` `const SKIPPED_DIRECTORIES = ["node_modules", GIT_DIRECTORY];` → `new` `const SKIPPED_DIRECTORIES = [GIT_DIRECTORY];`
- D1655: the same `old` → `new` `const SKIPPED_DIRECTORIES = ["node_modules"];`
- D1648: `old` `    walk.ignored.has(path) ||\n` (now in `isSkipped`) → `new` empty.
- D1647: the skip now runs while the directory is read, in the `keep` callback `    (entry) => !isSkipped(walk, join(directory, entry.name), entry.name),`; the mutation must count an ignored entry toward `walk.visited` there.

Tests the Step 9 round broke: D1643, D1645 and D1674 in `source-scan.test.ts` fail because its `node:fs` stand-in replaces `readdirSync`, which the walk no longer calls; the stand-in must serve `opendirSync` (a `Dir` whose `readSync` yields the padded, refused or real entries). Not a regression: the listing failure, the bound and the root label behave as before.

#### Test Coverage Gaps

Denominator: 75 named-defect tests (D1581 to D1655) against the behaviors AC1 to AC7 name.

| #   | Source                                                        | Named defect                                                                                                                                                                                                                                                                                                                             | Expected test                                     | Severity                   |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------- |
| 1   | `specifier-edges.ts` `withoutSuffix`                          | Only the query suffix is stripped, so a hash suffix stays: a bare `"@x/b#frag"` names no listed workspace and the edge is dropped, and a relative `"../../b#x"` resolves to a sibling the root owns (AC1, AC2).                                                                                                                          | `workspace-graph.test.ts`, beside D1597 and D1605 | HIGH (consumer, narrows)   |
| 2   | `specifier-edges.ts` `addSpecifierEdges` file-relative branch | A file-relative specifier keeps its suffix, so `new URL("../../b?url", import.meta.url)` resolves to a sibling the root owns instead of `packages/b` (AC1).                                                                                                                                                                              | `workspace-graph.test.ts`                         | HIGH (consumer, narrows)   |
| 3   | `source-walk.ts` `CONFIG_FILE_NAME`                           | Only `tsconfig.json` and `jsconfig.json` are read, so a `tsconfig.build.json` whose `references` points into another workspace adds no edge (AC3).                                                                                                                                                                                       | `workspace-graph.test.ts`                         | HIGH (consumer, narrows)   |
| 4   | `workspace-graph.ts` `linkTarget`                             | A dangling link's relative text resolves against the process's working directory instead of the link's directory, so it lands outside the root and adds no edge (AC5). The harness writes only absolute link targets; `source-scan.test.ts`'s `node:fs` stand-in can return a relative `readlinkSync` text.                              | `source-scan.test.ts`                             | MEDIUM                     |
| 5   | `tsconfig-edges.ts` `addInheritedPathsEdges`                  | A config with no `paths` of its own ignores the `paths` of a `base.json` it extends, so a target in another workspace adds no edge (AC3).                                                                                                                                                                                                | `workspace-graph.test.ts`                         | HIGH (consumer, narrows)   |
| 6   | `tsconfig-edges.ts` `addPathsEdges`                           | Inherited `paths` resolve against the walked config's directory instead of the directory of the config that sets them (AC3).                                                                                                                                                                                                             | `workspace-graph.test.ts`                         | HIGH (consumer, narrows)   |
| 7   | `tsconfig-edges.ts` `addInheritedPathsEdges`                  | A config with no `paths` of its own whose `extends` target cannot be read skips the inherited `paths` without widening (AC3, AC4).                                                                                                                                                                                                       | `workspace-graph.test.ts`                         | HIGH (consumer, narrows)   |
| 8   | `tsconfig-edges.ts` `baseUrlOf`                               | A `baseUrl` that is not a string is ignored, so `paths` targets resolve against the config's directory with no widening (AC3, AC4).                                                                                                                                                                                                      | `workspace-graph.test.ts`                         | MEDIUM                     |
| 9   | `specifier-edges.ts` `rootLabel`                              | The consumer root's own label is empty, so a walk-bound widening of the root workspace names no directory (AC4).                                                                                                                                                                                                                         | `source-scan.test.ts`, a root `pad-<n>`           | MEDIUM (cosmetic consumer) |
| 10  | `git-ignored.ts` `gitIgnoredPaths`                            | Git runs from the daemon's working directory, the consumer root, so on Windows a `git.exe` there runs while ignored paths are listed (AC6). Linux `execvp` does not search the working directory unless `PATH` holds a relative entry; decide whether a `PATH` entry of `.` makes it observable on both hosts, or record it as untested. | `source-scan.test.ts`                             | HIGH (daemon-state)        |
| 11  | `source-imports.ts` `visitCalls`                              | A `Visitor` is built per file, and the parser keeps every one for the life of the process, so memory grows with every file scanned. Decide whether a bounded observation exists or record it as untested.                                                                                                                                | `source-scan.test.ts`                             | MEDIUM (daemon-state)      |
| 12  | `jsonc.ts` `jsonValue`                                        | A regular-expression literal the engine cannot build is read as JSON `null`. Likely inert on Node 22 and 24 (the parser rejects an invalid pattern first); record it as untested if no input reaches it.                                                                                                                                 | `workspace-graph.test.ts`                         | LOW                        |
| 13  | `source-walk.ts` `listEntries`                                | The bound counts skipped entries while the directory is read, so a directory whose gitignored or `node_modules` entries pass the remaining budget stops before its kept entries and their imports add no edge (AC5, AC7).                                                                                                                | `source-scan.test.ts`                             | HIGH (consumer, narrows)   |
| 14  | `source-walk.ts` `listEntries`                                | The whole directory is read before the bound applies, so a directory of millions of entries is held in memory. Observable through the stand-in `Dir`: reading stops at the remaining budget plus one kept entry.                                                                                                                         | `source-scan.test.ts`                             | MEDIUM (daemon-state)      |
| 15  | `source-walk.ts` `walkDirectory`                              | A nested repository's own gitignored paths are walked, so its ignored build output widens or adds edges (AC7).                                                                                                                                                                                                                           | `source-scan.test.ts`, a real nested repository   | MEDIUM                     |
| 16  | `source-walk.ts` `holdsRepository`                            | A submodule, whose `.git` is a file, is not recognized as a repository, so its gitignored paths are walked (AC7).                                                                                                                                                                                                                        | `source-scan.test.ts`                             | MEDIUM                     |

### Completion Notes

**Built.** Four modules in `packages/daemon/src/selection/`, all read-and-parse only:

- `source-walk.ts` walks one workspace breadth-first. It skips nested workspaces, `node_modules` and `.git`, and follows no directory link. `MAX_WALK_DEPTH` (40) and `MAX_WALKED_ENTRIES` (50,000) each widen when reached.
- `source-imports.ts` parses one file and returns its literal specifiers. `parseGuarded`, which tsconfig reading shares, turns a thrown, reported or too-deeply-nested parse into a reason.
- `specifier-edges.ts` resolves a specifier, path, pattern or package name into edges and widenings. It was not in the ticket's file list: source imports, tsconfig targets and `imports` targets share one resolution rule (C8, C13).
- `tsconfig-edges.ts` covers `extends`, `references`, `paths` (with the `baseUrl` search along `extends`) and `package.json` `imports`.

`workspace-graph.ts` runs the scan from `buildDependencyInformation`. `selection-types.ts` adds five producer kinds and six uncertainty kinds (`unreadable-source`, `unparsed-source`, `plugin-format-file`, `walk-bound-reached`, `extends-unfollowed`, `malformed-config`), and raises `SELECTION_POLICY_VERSION` to 2.

**Sanity check (Step 4).** Three findings went to the author (d63260c0) at 21:56. F1 and F2 were confirmed and the author updated AC2 at 21:58: `/// <reference path>` is always file-relative, and URL-scheme and `#` specifiers are not bare. F3 (the new uncertainty kinds) was built here.

**Assumptions.** U1 is pending the Linux gate. U2 is confirmed. U3 was false, and `.js`, `.mjs` and `.cjs` now parse as JSX (resolutions under the table).

**Adversarial review (Step 7.4).** 15 findings.

- Fixed:
  - F1: parse and walk failures widen, and bracket nesting past 1,000 widens before the parse.
  - F2: a bare specifier's query or hash suffix is stripped.
  - F3: `.\` and `..\` count as relative.
  - F4: a URL-scheme `imports` target adds nothing.
  - F5: an absolute specifier resolves, and adds an edge only inside the consumer root.
  - F6: a config two `extends` entries share is searched once, and only the current chain is a cycle.
  - F7: a dangling link depends on where its text points, and only an unreadable link widens.
  - F9: resolved holders are cached per scan.
  - F10: the entry count skips skipped entries.
  - F11 and F12: malformed `extends`, `references` and `paths` widen under `malformed-config`.
  - F13: one `isFile` and one parse-error join.
  - F14: the byte-order mark is built from its code point.
- Discarded:
  - F8 (widening records pile up): `walkDependents` in `select-tests.ts` keeps only the first link to reach each workspace, so extra records never reach a selection's `widenings`.
- Named as known limits:
  - F15 (type-level references): `/// <reference types>` and `import()` types cannot change a test's runtime result.
- Open for the orchestrator:
  - F1's residual: an operator chain of about 45,000 terms (roughly 100 KB of `a+a+...`) still ends the process inside the native parser, which no catch recovers. Measured on Node 24.19, Windows x64. Recommendation: 2.3 runs selection in a disposable child process, so a native crash fails that selection loudly instead of taking the daemon down.
  - The reviewer's observation: the walk also parses build output (`dist/`, `.next/`, `coverage/`), which can push a large root past 50,000 entries and widen every selection. The skip set is AC5's.

**Validation.** Run in wt-1 after the fix round, 2026-09-27 about 01:40:

- `bun run --filter @rt-test/daemon typecheck`: exit 0.
- `bun x oxlint packages/daemon/src/selection`: exit 0, no warnings.
- prettier: clean.
- `node scripts/check-line-citations.mjs`: clean.

Acceptance evidence came from two scratch fixture runs through `buildDependencyInformation` (removed at handoff):

- AC1: every listed form produced a relative-import edge, and a specifier outside the root produced none.
- AC2: bare and scoped names produced edges. With the listing incomplete, `node:fs` and `#internal` added nothing, and `fs` and `vitest` widened.
- AC3: `references`, `paths` with an inherited `baseUrl`, and `imports` conditions all produced edges, and an unfollowable `extends` widened.
- AC4: a parse error, a `.vue` file, a directory 41 levels deep, and 1,500-deep nesting each widened.
- AC5: a junction produced a link edge.
- AC6: a source file and a Vitest config that write a marker when executed left no marker. A tsconfig `extends` target is only ever read as JSONC (traced through `readJsonc` and `parseGuarded`).

**AC7 (orchestrator rulings R5 to R7, 01:27).** `git-ignored.ts` runs `git -C <root> -c core.fsmonitor=false ls-files --others --ignored --exclude-standard --directory -z` once per scan. `GIT_*` is scrubbed from its environment, with names compared without case, and a timeout and output cap apply. `core.fsmonitor` is forced off because a repository's config can name a program for git to run while reading the index. Any non-zero exit, spawn error, timeout or oversized output yields no ignored paths, so the walk proceeds as AC5 describes. The walk skips an ignored path before counting it toward `MAX_WALKED_ENTRIES`.

A git 2.55 probe confirmed three behaviors:

- Paths come back relative to the `-C` directory.
- A wholly ignored directory collapses to `dir/`, while one holding a tracked file lists only its untracked files.
- Outside a repository, git exits 128.

Evidence came from a scratch run, removed afterwards: the fixture described under Tests Owed. Gates after AC7, 2026-09-27 about 01:55:

- `bun run --filter @rt-test/daemon typecheck`: exit 0.
- `bun x oxlint packages/daemon/src/selection`: exit 0.
- prettier: clean.
- check-line-citations: clean.

**README.** Unchanged: selection has no production caller, and the README states only the goal.

### File List

Planning files the create-ticket run wrote:

- `_agent-docs/tickets/2-2b-undeclared-edges.md` (created, the second part of 2.2's split)
- Held for the orchestrator, as exact text: the sprint-2 file's 2.2b section, the `2-2b-undeclared-edges` status key, and FR7's marker in `docs/requirements.md`.

Dev session (2.2b build):

- `packages/daemon/src/selection/source-walk.ts` (created)
- `packages/daemon/src/selection/source-imports.ts` (created)
- `packages/daemon/src/selection/specifier-edges.ts` (created)
- `packages/daemon/src/selection/tsconfig-edges.ts` (created)
- `packages/daemon/src/selection/git-ignored.ts` (created, AC7)
- `packages/daemon/src/selection/workspace-graph.ts` (modified)
- `packages/daemon/src/selection/selection-types.ts` (modified)
- `_agent-docs/tickets/2-2b-undeclared-edges.md` (modified: assumption resolutions, the U3 task correction, checkboxes, Dev Agent Record)
- Written by the orchestrator: `packages/daemon/package.json` and `bun.lock` (`oxc-parser` 0.151.0)

Review session (fix round):

- `packages/daemon/src/selection/jsonc.ts` (created)
- `packages/daemon/src/selection/git-ignored.ts`, `source-imports.ts`, `specifier-edges.ts`, `tsconfig-edges.ts` (modified)
- `_agent-docs/tickets/2-2b-undeclared-edges.md` (modified: Review Record, File List)

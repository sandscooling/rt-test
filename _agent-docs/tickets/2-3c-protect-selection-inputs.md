# Ticket 2.3c: Protect selection inputs from declared patterns

## Ticket

As a consumer whose `rt-test.json` declares broad patterns such as `docs/**` or `**/*.md`,
I want the files Vitest loads for my tests, and every file Vitest would discover as a test module, to stay inputs whatever my patterns say, and no pattern to apply until RT Test knows which files those are,
so that a careless pattern can never hide a setup file edit or a new test module, and a result never reads current after a change that could alter it.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: For every workspace the discovery in effect (AC3) lists as discovered, each setup file and each global setup file it reports (ticket 2.3b AC1) is never a declared non-input, whatever `rt-test.json` declares: an edit to one changes the fingerprints an edit to any input changes, and a selection over it selects as it would with no `rt-test.json`.
- [x] AC2: Likewise, a file is never a declared non-input when, for some project such a workspace reports, its path relative to the directory the project's patterns are matched from (ticket 2.3b AC3) is matched, as is every directory discovery crawls to reach it (outside that directory too, for a file reached through `..`), by none of the project's `exclude` patterns and matches one of its `include` or `includeSource` patterns, each matched as Vitest 4.1's and 5's glob of a project's test files matches it: names beginning with a dot included, case-sensitive except, on Windows, in the directories the glob's crawl starts from (the static leading segments every match pattern of that glob shares), which match the file's on-disk directories in any case, as the case-folding file system opens them, and an absolute pattern taken relative to that directory. A file an `includeSource` pattern matches is protected whether or not it holds in-source tests. So adding a file both a declared pattern and a workspace's `include` patterns match adds an input, and the discovery reads stale.
- [x] AC3: While a usable `rt-test.json` declares at least one pattern and the discovery in effect is absent, or lists a discovered workspace that does not report these facts (a discovery stored before the store's schema version 3, ticket 2.3b AC4), or reports a pattern the matcher still refuses once normalized as discovery normalizes it (such as one longer than picomatch's 65536-character limit), no declared pattern applies: every file stays an input, and a selection treats every path as it would with no `rt-test.json`. The daemon's log gives the reason at warning level whenever patterns do not apply, from the start when no discovery is in effect and whenever they stop applying, and says when they apply again, and every summary and path status answer carries the reason as a whole sentence in the field that carries an unusable declaration's reason (`nonInputsUnusable`), under the unchanged `schemaVersion`. A workspace the discovery lists as failed, unsupported or not confirmed neither stops patterns applying nor protects any file. The discovery in effect is the one the lifecycle last gave the tracker: the store's latest discovery before the first reconciliation, then each new discovery before its fingerprint is taken.
- [x] AC4: When a new discovery in effect changes which files are protected, or stops or starts patterns applying, every file whose declared state flips joins or leaves the inputs before that discovery's fingerprint is taken, a file the tracker never read because a pattern declared it included, and no result reads current until it has. Those reads mark no running job, while any other input event during them still fails the discovery's fingerprint. A file that becomes an input this way and was modified after the discovery's job began fails the discovery's fingerprint, as a newly protected test module does today.
- [x] AC5: For the same `rt-test.json` and the same discovery in effect, selection and the tracker answer identically, for every root-relative path, whether it is a declared non-input and through which pattern, AC1 to AC3 included. The selection policy version rises to 4, so every result stored under version 3 reads stale once.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Question                                                                                                                                                                                                                                      | How to check                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Does `@types/picomatch` 4.0.3 type the default export as callable with an array of patterns and an options object holding `dot`, `nocase`, `nobrace`, `noextglob`, `noglobstar` and `posix`, returning a `(path: string) => boolean` matcher? | Once the orchestrator has installed it, read `node_modules/.bun/@types+picomatch@4.0.3/node_modules/@types/picomatch/index.d.ts` and `lib/picomatch.d.ts`. |

Resolutions (dev, 2026-09-28 02:04):

- U1: CONFIRMED. `packages/daemon/node_modules/@types/picomatch/index.d.ts:1-3` re-exports `lib/picomatch.d.ts`, whose default export (lines 24-28) takes `Glob = string | string[]` and `PicomatchOptions` (`dot` :78, `nobrace` :121, `nocase` :129, `noextglob` :137, `noglobstar` :141, `posix` :161, `windows` :185) and returns `Matcher`, callable as `(test: string) => boolean` (:33-36).

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every row of Unverified Assumptions first, writing each answer with the source location read.
- [x] (Support) Before the build begins, confirm the orchestrator has added `picomatch` at exactly `4.0.7` to `@rt-test/daemon`'s `dependencies` and `@types/picomatch` at exactly `4.0.3` to its `devDependencies`, with `bun.lock` (orchestrator-owned; P9, C1: picomatch 4.0.7 declares no peer). The lines, for the orchestrator: `"picomatch": "4.0.7"` and `"@types/picomatch": "4.0.3"`.
- [x] (AC1, AC2, AC3, AC5) Create `packages/daemon/src/inputs/protection.ts`, the one producer of protection: from the discovery in effect, or none, it returns the protection value both callers take. That value is either "no pattern applies", with the reason sentence (AC3), or the protected files: every test module `discoveredTestModules` lists, every setup and global setup file each discovered workspace's projects report, and each reported project's patterns compiled once. Compile them with picomatch's default export and the options tinyglobby 0.2.17 passes (Dev Notes § Settled facts), leaving `windows` to picomatch's host default as tinyglobby does, and process the patterns as tinyglobby's `processPatterns` and `normalizePattern` do before compiling, whole (Dev Notes § Settled facts: an empty pattern skipped, a `!` exclude dropped, a `!` include turned into an exclude, a trailing `/` dropped, an absolute pattern made relative to the pattern directory, otherwise `posix.normalize`, and leading `..` segments collapsed against the directory). Treat a file as excluded when the exclude patterns match it or any directory discovery crawls to reach it, each formatted relative to the pattern directory as the crawl formats it (so `../b` for a directory outside it), since the crawl prunes such a directory. A path is protected by a project when its path relative to the project's pattern directory is matched by no `exclude` pattern and by an `include` or `includeSource` one. A workspace that is not `discovered` contributes nothing; a `discovered` one whose `selectionFacts` is `{ reported: false }` makes the value "no pattern applies". A reported path (a setup file, a global setup file, a pattern directory) is named as a test module's path is (`TestFilePatterns`' doc comment): root-relative, `..`-climbing for a file outside the root, or absolute on another Windows drive. A path outside the root protects no input, and a pattern directory outside it can still match inputs under the root only through a `..` relative path; a pattern directory on another drive matches no input, so relate paths to it without resolving against the process's working directory. A pattern picomatch refuses to compile after that processing (one past its 65536-character `MAX_LENGTH` throws) also makes it "no pattern applies", with a reason naming the project and the pattern, never a throw out of the producer (C30, C126). Name the reason sentences as constants (C3). Keep picomatch out of `non-inputs.ts`, which the client's module graph loads through the start plan: `non-inputs.ts` imports only the value's type.
- [x] (AC1, AC2, AC3, AC5) In `packages/daemon/src/inputs/non-inputs.ts`, make `declaredNonInputs(declaration, protection)` take the protection value in place of `protectedTestModules`, return no match for any path while no pattern applies, and consult the value's protected files and patterns beside the protected names it checks today, so it stays the one decision both callers make (C8). Rewrite its doc comment to the new protected set (C46).
- [x] (AC5) In `packages/daemon/src/selection/selection-types.ts`, replace `SelectionNonInputs.protectedTestModules` with the protection value, documented as built by the producer over the discovery the tracker reads, and raise `SELECTION_POLICY_VERSION` to 4. In `select-tests.ts`, pass it to `declaredNonInputs`; `select-tests.ts` holds 489 of its 500 code lines, so keep the change inside the decision call (P16).
- [x] (AC3, AC4) In `packages/daemon/src/inputs/declared-non-inputs.ts`, make `protect` take the protection value and return the flips it can see: every path the old or new value names by exact path (test modules, setup and global setup files) whose match changed, as 2.1b's `protect` does, and every path the tracker holds whose match changed, and expose the "no pattern applies" reason through `unusable` only while a usable declaration declares at least one pattern, so an absent, empty or unusable declaration carries only what it carries today. Check every reader of `unusable` for the new case, a usable declaration that carries a reason (C39); at drafting its one production reader is `InputTracker.current()`, which passes it to the answers as `nonInputsUnusable` (`rg -n "\.unusable\b" packages/daemon/src`, 23:54). Log the reason at warning level (C32) with `report`'s declaration line while no pattern applies and whenever patterns stop applying, and a line when they apply again; while no pattern applies, that declaration line names the patterns without calling them in effect (C46). Start in the "no pattern applies" state, since no discovery is in effect until the lifecycle gives one, so a stored discovery whose read throws (lifecycle's `#protectStoredTestModules` catch) leaves every file an input rather than applying patterns with nothing protected.
- [x] (AC3, AC4) In `packages/daemon/src/inputs/input-tracker.ts`, make `TrackedInputs.protectTestModules` build the protection through the producer and flip every path whose declared state changes: the paths the tracker holds, and, whenever any discovered project's patterns or pattern directory changed, a project joined or left the protected set, or patterns stopped applying, every file under the root the new decision makes an input that the tracker never read, which only a walk under the rebuilt filter can find. Read every flipped path without marking a job (the `#quiet` set's rule), keep an event arriving meanwhile marking jobs as it does today, and keep every result from reading current until the flips are read, as queued paths do today. Rename the method to what it now does, and update its doc comment and the class comment (C46, C48). The file holds 477 of its 500 code lines: extract the protection walk by responsibility, beside `declared-non-inputs.ts` or into a module of its own (P16, P18).
- [x] (AC4) Widen the time check `#protectDiscovered` in `packages/daemon/src/daemon/lifecycle.ts` runs before protection (today `testModuleChangedSince`, `inputs/fingerprint.ts` through `current-inputs.ts`) to every file protection moves into the inputs, not only listed test modules. A file found only by the protection walk is known only during it, so its time is read there, against the discovery job's start, and only after the rebuilt decision governs `namesFile`: an edit then either precedes the read and fails the time check, or follows the rebuild and arrives as an event that marks the job. C160's no-await rule binds the exact-path check before protection; the walk's reads are vouched for by this order instead. Keep no await between a check and the protection step it vouches for (C160), and keep the guard job's verdict as today. Update `#protectStoredTestModules`, `#protectDiscovered` and the class's doc comments to the new names (C46).
- [x] (Support) Report the exact `docs/architecture.md` and `README.md` text to the orchestrator (orchestrator-owned; C48, C55). Dev Notes § Doc text holds a draft.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `discoveredTestModules`, `workspaceTestModules` and `testModuleFile` (`inputs/non-inputs.ts`): the protected test modules and the root-relative conversion. `discoveredTestModules` stays the only producer of the test-module part (ticket 2.1b), and `fingerprint.ts` keeps calling it.
- `declaredNonInputs` (`inputs/non-inputs.ts`): the one decision, extended here rather than joined by a second.
- `DeclaredNonInputs.protect`, `unusable`, `report` and `#rebuild` (`inputs/declared-non-inputs.ts`): the flip computation, the reason getter and the declaration log line this ticket extends.
- `InputTracker`'s `#quiet` set, `#queue`, `#ledger` and `#processQueue` (`inputs/input-tracker.ts`): reading a flipped path without marking a job, and holding every result from reading current while paths are pending.
- `InputFilter.open` and `takeInventory` (`inputs/input-filter.ts`, `inputs/input-inventory.ts`): the walk under a filter whose `declares` reads the rebuilt decision, which a reconciliation already runs.
- `testModuleChangedSince`, its private `modifiedAt`, and `MODIFIED_TIME_RESOLUTION_MS` (`inputs/fingerprint.ts`, `inputs/input-inventory.ts`): the time check this ticket widens.
- `relativePosixPath` and `POSIX_SEPARATOR` (`vitest/find-workspaces.ts`): root-relative, `/`-separated paths.
- Ticket 2.3b's report (`vitest/selection-facts.ts`): `SelectionFacts` (`{ reported: true, projects }` or `{ reported: false }`), `ProjectSelectionFacts` (`projectName`, `setupFiles`, `globalSetupFiles`, `aliases`, `testFilePatterns`) and `TestFilePatterns` (`directory`, `include`, `exclude`, `includeSource`), carried as the required `selectionFacts` member of the `discovered` arm of `WorkspaceDiscovery` (`vitest/discover-tests.ts`). The store reads NULL as `{ reported: false }` (`store/read-discovery.ts` `selectionFacts`). Import them; declare no second shape (C14).
- `picomatch` 4.0.7's default export: the matcher tinyglobby, and so Vitest's discovery, uses.

### Must Create

- `packages/daemon/src/inputs/protection.ts`: the producer, the protection value's type, the pattern normalization, and the reason sentences as named constants.
- The extracted protection walk, wherever P16 puts it.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The original ticket 2.3 was split into 2.3 to 2.3f (sprint file, after § Ticket 2.3f). 2.3b (done, landed at 73788aa and b1b0152, merged into wt/1 at 074bd9f) makes discovery report each discovered workspace's setup files, global setup files and test file patterns per project, and the store keep them; this ticket is the first production reader of those facts. It was re-verified against 2.3b's landed code on 2026-09-28 at 01:58 (§ Pending siblings). It closes two of 2.1b's known limits (a setup file a pattern matches; a new test module a pattern matches). Selection still has no production caller until 2.3e.

Requirements (`docs/requirements.md`):

- FR6: "Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current." (AC1 to AC4)
- FR7: "Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts." (AC1, AC3, AC5)

Clauses the criteria rest on:

- Sprint 2 § Ticket 2.3c: "it adds each workspace's setup and global setup files, as discovery reports them (ticket 2.3b), to the files a declared non-input pattern cannot remove from the inputs (ticket 2.1b AC4; owner, 2026-09-27 11:10), and every file matching a workspace's test include patterns, as discovery reports them, so a new test module under a declared pattern is still discovered (orchestrator, 2026-09-27 11:24)." (AC1, AC2)
- The same: "a file `includeSource` matches is protected on the pattern alone, without Vitest's content check". (AC2)
- The same: "While the discovery in effect does not report setup files and include patterns for every workspace it lists as discovered, no declared pattern applies, and the log and every answer say why; with no discovery stored, none applies until the first discovery that reports them is stored; a workspace that failed to load, is unsupported or was not confirmed does not switch the declaration off (orchestrator, 2026-09-27 18:46 and 18:59)." (AC3)
- The same: "Selection and the tracker keep one producer of the protection and one decision (ticket 2.1b AC4), and protection's reads still mark no job (ticket 2.1b; orchestrator, 2026-09-27 15:49)." (AC4, AC5)
- Ticket 2.1b AC4: "Selection and the fingerprint answer whether a path is a declared non-input identically for the same declaration and discovery." (AC5)
- Ticket 2.1b, dev adversarial review F2, orchestrator at 15:49: "protection must not count as an input change against the discovery's own job." (AC4)
- Ticket 2.1b AC8: "While no `rt-test.json` exists, or it is usable, no answer carries a reason." AC3 here narrows it by Q3: a usable declaration whose patterns cannot yet apply carries its reason.
- Ticket 2.3b AC3: the report gives "the test file patterns that Vitest resolved: `include`, `exclude` and `includeSource`, and the directory they are matched from (the project's `dir`, else its root), as a root-relative `/`-separated path, the consumer root itself being `.`". (AC2)
- `SELECTION_POLICY_VERSION`'s doc comment (`selection/selection-types.ts`): "Raise whenever a rule change can select a different set for the same inputs." (AC5)
- AGENTS.md § Product guarantees: "Never report historical results as current after a relevant edit or unresolved input change." and "Widen selection when dependency information is uncertain." (AC3, AC4)
- Checklist C160 (rendered by `expand-rules.mjs`) binds AC4's time check.
- Glossary: **Declared non-input** "A file the consumer lists in `rt-test.json` as read by no test, so its edit changes no input fingerprint and selects nothing."

#### Orchestrator rulings

Every question went to the orchestrator by `session_wake` (crew.md § Questions), asked 23:44, answered 23:45, decider the orchestrator, holding the owner's calls.

- Q1, the matcher (AC2). The sprint's 18:59 wording named `matchesTestGlob`'s matcher. Discovery never finds test files through `matchesTestGlob`: it globs through tinyglobby with `dot: true` (§ Settled facts), and `matchesTestGlob` calls `pm.isMatch` with no options, so dot names are off and an absolute pattern never matches. Ruling: "match as discovery's glob does [...] The aim of the 11:24 ruling is that a new test module discovery WOULD find is never hidden, so the true matcher is discovery's glob, not matchesTestGlob." The sprint clause is reworded to match.
- Q2, scope: this ticket swaps `SelectionInput`'s protected test-module set for the protection value, "so the decision is shared the day it lands"; 2.3e only fills it. The 2.3e sprint line is reworded. (AC5)
- Q3: the "no pattern applies" reason travels in `nonInputsUnusable` with its own sentence; `schemaVersion` stays 1, so `answer.ts`, `summary.ts`, `path-status.ts` and the CLI are unchanged. (AC3)
- Q4: `SELECTION_POLICY_VERSION` rises to 4 here: "A rule change that selects a different set must raise it, and 2.3d raises it again when it lands." A setup file under a declared pattern selected nothing under version 3 and selects its workspaces now. (AC5)
- Q5: "the discovery in effect is the one lifecycle last handed the tracker, consistent with 2.1b's 15:49 ruling." One case differs from the sprint's "stored": a new discovery whose store write fails has already been handed to the tracker, so patterns apply from it for the rest of that daemon life, as 2.1b already leaves such a discovery's test modules protected. The next start reads the store's latest, which may stop patterns applying again. (AC3)
- Q6: proceed as one ticket (§ Sizing): "A split would put producer and consumer in different tickets, the disagreement Q2 exists to avoid." Dev delegates by its two groups.
- Grill (asked 23:49, answered 23:49, decider the orchestrator):
  - G1: a pattern picomatch refuses makes "no pattern applies" for that discovery, with a reason naming the project and the pattern: "Uncertainty widens and never narrows (AGENTS.md; C126). Name the defect for it." The defect: a pattern picomatch refuses after normalization, such as one past its 65536-character `MAX_LENGTH`, throws out of the producer, or protects nothing for its project, so a new test module there stays hidden. (AC3) Amended by the 02:05 ruling on dev's sanity check: an empty pattern is not refused but skipped, as discovery's glob skips it (§ Settled facts), so it finds and hides nothing.
  - G2: the reason is carried "only while a usable rt-test.json declares at least one pattern, which keeps 2.1b AC8's silent cases silent." (AC3)
  - G3: the start listing adds nothing, "since the start plan reads files only and cannot see the store."
  - Settled by create-ticket and confirmed: while no pattern applies, the daemon's declaration log line names the patterns without calling them in effect.

- Ticket review (create-ticket 6c, 23:53): 11 findings: 9 applied, 1 routed, 1 rejected. F1 (exact-path flips include paths the tracker never read), F2 (the walk's trigger covers a moved pattern directory and a project joining or leaving), F3 (AC4's wording), F4 (patterns change within one daemon life), F5 (the sibling search names its tickets), F6 (the broken-tests search widened and re-run), F9 (the reason logged at warning level from the start), F10 (the `unusable` reader audit), F11 (the walk's read order) applied as proposed; F8 routed to 2.3b as a build-start check (§ Design notes). F7 rejected on the tinyglobby spike (§ Settled facts).

#### Settled facts

Read in installed source (P10) between 23:39 and 23:54 on 2026-09-27; each would flip a criterion or a task if false.

- **Discovery globs a project's test files through tinyglobby with `dot: true`.** Vitest 4.1.11 `globFiles` (`dist/chunks/cli-api.CnMVyzaz.js` lines 10893 to 10902) and 5.0.1 `globProjectFiles` (`dist/chunks/index.DzobfTyw.js` lines 11873 to 11879) both call `glob(include, { dot: true, cwd, ignore: exclude, expandDirectories: false })`, where `cwd` is `this.config.dir || this.config.root`. `includeSource` is globbed the same way, with the same `exclude`, and then kept only when the file's text includes `import.meta.vitest` (4.1.11 `globAllTestFiles`, from line 10851; 5.0.1 `globProjectTestFiles`, from line 11889). Protection skips that content check by ruling.
- **tinyglobby 0.2.17's options.** `dist/index.mjs` line 5 is `import picomatch from "picomatch";`, and lines 209 to 218 build `const matchOptions = { dot, nobrace: options.braceExpansion === false, nocase: !caseSensitiveMatch, noextglob: options.extglob === false, noglobstar: options.globstar === false, posix: true };` then `picomatch(processed.match, matchOptions)` and `picomatch(processed.ignore, matchOptions)`; its defaults set `caseSensitiveMatch: true` (line 268). Vitest passes none of those, so the options are `dot: true`, case-sensitive, with braces, extglobs and globstars on.
- **tinyglobby rewrites patterns before matching.** `normalizePattern` (from line 136) drops a trailing `/` and, at line 143, `result = isAbsolute(result.replace(ESCAPING_BACKSLASHES, "")) ? posix.relative(escapedCwd, result) : posix.normalize(result);`. A pattern climbing out with `../` moves the glob's root (the lines after 143).
- **`posix` is not path style in picomatch 4.0.7, and `windows` follows the host.** `index.js` sets `options = { ...options, windows: utils.isWindows() }` when options are given with no `windows`; `lib/parse.js` reads `opts.posix` only for POSIX bracket classes (lines 719 and 751) and `opts.windows` for the separator characters (lines 377 and 1360, `constants.globChars`). So discovery's glob matches with Windows separators on Windows. For the `/`-separated paths this ticket matches, that differs only for a pattern holding `\`. Matching as discovery does means calling the same default export with the same options and no `windows`. (This corrects the "POSIX on every platform" wording of the 23:44 question, whose aim, matching as discovery does, the 23:45 ruling adopted.)
- **`matchesTestGlob` matches with no options.** Both versions run `pm.isMatch(relativeId, this.config.exclude)` then `include` then `includeSource` (4.1.11 lines 10907 to 10922; 5.0.1 lines 12188 to 12203), and picomatch's static `isMatch` (`lib/picomatch.js` line 194) calls the library's own `picomatch`, not the wrapper, so `dot` is off and `windows` unset.
- **The probe** (`_agent-docs/.scratch/create-ticket-2-3c/probe.cjs` and `probe2.cjs`, run with node at 23:40 and 23:43 against installed picomatch 4.0.7, deleted after): `.storybook/a.test.ts` against Vitest's default include `**/*.{test,spec}.?(c|m)[jt]s?(x)` printed `default: false dot: true`; `.cache/node_modules/b.test.ts` against `**/node_modules/**` printed `default: false dot: true`; `Src/A.test.ts` against `src/**/*.test.ts` printed false both ways; `src/a.test.ts` against `./src/**/*.test.ts` printed true both ways; `../other/a.test.ts` matched `../other/**/*.test.ts` and not `**/*.test.ts`; `src/a.test.ts` against `C:/proj/src/**/*.test.ts` printed false.
- **An array of patterns matches when any does** (`lib/picomatch.js` lines 44 to 53), and an empty array gives a matcher that is always false; an empty-string pattern throws `TypeError('Expected pattern to be a non-empty string')` (lines 58 to 60). The probe (`probe3.cjs`, 23:47) printed `empty array: false` and `empty string: Expected pattern to be a non-empty string`.
- **A pattern that climbs out and back in finds only what it names outside.** A spike (`spike.mjs`, 23:54, deleted after) ran tinyglobby 0.2.17's `glob` with Vitest's options from cwd `tree/packages/a`, over `packages/a/x.test.ts`, `packages/b/y.test.ts` and `other/z.test.ts`: `"../**/*.test.ts" -> ["../b/y.test.ts"]`, `"../b/*.test.ts" -> ["../b/y.test.ts"]`, `"**/*.test.ts" -> ["x.test.ts"]`. So discovery does not find `packages/a/x.test.ts` through `../**/*.test.ts`, and matching the path relative to the pattern directory agrees with it (ticket review F7, rejected on this evidence).
- **Normalization mirrors tinyglobby 0.2.17's `processPatterns` and `normalizePattern` whole** (dev's sanity check, orchestrator ruling 02:05; lines re-read by create-ticket at 02:05). An empty pattern is skipped, in `exclude` and `include` alike (`if (!pattern) continue;`, lines 184 and 188), so it never reaches picomatch. An `exclude` pattern beginning with `!` (and not `!(`) is dropped (line 185). An `include` pattern beginning with `!` (and not `!(`) becomes an ignore pattern with the `!` removed, and one beginning with `!!` (and not `!!(`) is dropped (lines 189 and 190). After the absolute-to-relative step at line 143, a pattern starting with `../` segments has each leading `..` collapsed while the segment after it names the matching part of the escaped cwd (lines 144 to 153), so `../a/*.test.ts` from `packages/a` becomes `*.test.ts`. The crawl prunes every directory the ignore matcher matches, so no file under such a directory is found, whatever the file's own path matches (`excludePredicate`, lines 222 to 225); the partial-matcher half of that predicate only skips directories no include can reach. picomatch 4.0.7 throws `SyntaxError('Input length: ..., exceeds maximum allowed length: 65536')` for a pattern longer than `MAX_LENGTH` (`lib/constants.js` line 93, `lib/parse.js` lines 364 to 368), which is still refused after normalization.
- **Checked forward:** `rg -n "picomatch|tinyglobby|matchesTestGlob"` over `_agent-docs/sprints` and `_agent-docs/tickets` (23:47) matched only the 2.3c sprint line, 2.3b's routing note that 2.3c owns the dependency, and 2.3's split note; no unbuilt ticket changes the package.

#### Design notes

- **The protection value.** One value, built by one producer from the discovery in effect, carries either "no pattern applies" with its reason, or the protected files (test modules, setup and global setup files) and each project's compiled patterns. `declaredNonInputs` consults it; the tracker holds the one it was last given, and selection gets its own copy from 2.3e over the same discovery. Neither caller holds protection logic of its own (C8).
- **Why a walk.** The tracker drops every event naming a declared file before queuing it (`DeclaredNonInputs.namesFile`) and never reads one, so a file a pattern hid is unknown to it. Protection by exact path (test modules, setup files) names its files, as 2.1b's `protect` does. Protection by pattern does not: when a project's patterns or pattern directory change, a project joins or leaves the protected set, or patterns stop applying, only a walk under the rebuilt decision finds every file that now counts. When only exact paths change, or patterns start applying (which only removes files the tracker holds), no walk is needed. In this ticket's world the patterns change at most once after a daemon's first reconciliation, from the stored discovery's to the new discovery's (a refused pattern in either also counts); 2.3f's rediscovery makes it happen repeatedly.
- **Why the time check moves.** A file a pattern hid had no watch through the discovery's job, so an edit to it then went unseen. 2.1b reads each listed test module's modification time before protection moves it (D1988). A file found only by the walk is not known before the walk, so its time is read in the walk, against the job's start.
- **When no pattern applies.** Every file stays an input, so the first reconciliation after a start with no stored discovery, or with one stored before version 3, reads the declared files too. The new discovery then turns patterns on, flipping only files the tracker holds, which need no walk.
- **The reason in answers.** `nonInputsUnusable` reads "why every file stays an input", which holds here too. Its sentence names the cause: no discovery yet, or a discovery that does not report the files patterns may not remove. It appears only while a usable declaration declares at least one pattern, since a declaration that declares nothing has nothing to switch off.
- **Paths outside the pattern directory.** A pattern climbing out with `../` is matched against the path relative to the pattern directory, which then begins with `../` too; the probe shows picomatch matching it, and the tinyglobby spike below shows discovery's glob finding exactly those files. A file outside the consumer root is not an input either way.
- **The pattern directory's case on Windows.** Matching relative to the pattern directory needs that directory in its on-disk case, or on Windows every relative path would climb out and match nothing. Confirmed in 2.3b's landed code (01:58): `selection-facts.ts` converts `config.dir || config.root` through `session.locate`, which is `moduleLocator` (`vitest/module-tests.ts`), whose `realPath` calls `realpathSync.native` and, for a path not on disk, resolves its nearest ancestor that is and appends the rest (2.3b's 23:56 fix for this check). D2116 in `discover-tests.test.ts` proves the not-on-disk case through a directory link (ticket review F8).
- **A pattern that cannot compile.** An empty pattern is skipped, as discovery skips it, and so is not such a pattern. The producer must still return a value for one picomatch refuses after normalization. Treating it as "no pattern applies" keeps every file an input, the widening direction C126 requires ("uncertainty never narrows it"); protecting nothing for that project would narrow (G1). What Vitest's own glob does with such a pattern is unread.
- **Case.** picomatch matches case-sensitively on every platform, as discovery's glob does, but on Windows the glob's crawl first opens its root, `cwd` joined with the static leading segments every match pattern of that glob call shares, by the patterns' spelling, and the case-folding file system opens an on-disk directory of any case there. The crawl then names each file with the root's segments as the patterns spell them and every entry below as it is on disk. So on Windows, `src/**/*.test.ts` finds `Src/A.test.ts` (as `src/A.test.ts`), while `src/a/**` beside `src/b/**` (root `src`) does not find `Src/A/x.test.ts`, and `A.TEST.TS` never matches `*.test.ts` (orchestrator ruling 02:37, from the tests member's probe; tinyglobby 0.2.17 re-probed by dev on Windows at 02:38: `["src/**/*.test.ts"]` over `Src/y.test.ts` and `Src/A/x.test.ts` gave `src/y.test.ts` and `src/A/x.test.ts`, `["src/a/**/*.test.ts", "src/b/**/*.test.ts"]` gave none, and `["src/A/**/*.test.ts", "src/b/**/*.test.ts"]` gave `src/A/x.test.ts`). Protection respells those root segments of a path in the patterns' case before matching when `process.platform` is `win32`, read at the call as `liesInsideOnHost` reads it, and matches every other segment case-sensitively. On Linux nothing folds.
- **Known limits:** a project whose `typecheck.include` finds a new typecheck module under a declared pattern (2.3b Q3 leaves those patterns out; a listed typecheck module is still protected by path); a browser-mode project's files (2.3b G1); a new test module under a declared pattern in a workspace that failed, is unsupported or was not confirmed.
- **Unanalyzed:** links under the pattern directory, which tinyglobby follows by default.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3c` over the 10 target paths (2026-09-28 01:58, after 2.3b landed) named only 2.3f, through the sprint's split note; no unbuilt ticket writes a file of this ticket's. 2.3d and 2.3e come from the sprint file; 2.3d edits `select-tests.ts` after this ticket lands.

- **2.3b** (done): re-verified at 01:58 against its landed code. The facts' names and shapes are those § Reusable Code gives; this ticket reads no alias, so `ReportedAlias`'s `flags` and `STRING_FIND_FLAGS` do not bear on it. Its review changed three things this ticket protects through: `testModuleFile` and `absoluteInputPath` (`inputs/input-filter.ts`) keep an absolute path (a file on another Windows drive) as given, and `InputFilter.excludes` and `declares` now test `liesInside(root, path)` first, so a path outside the root is excluded and never declared. So an exact protected path outside the root (a `..` or other-drive setup file or test module) can flip in `DeclaredNonInputs.protect` (a `**` segment of the consumer's own matcher also matches `..` segments) but is dropped by `excludes` when read; leave such paths out of the flips rather than queue reads that count for nothing.
- **2.3d** (backlog) edits `select-tests.ts` and raises the policy version again; it builds after this ticket.
- **2.3e** (backlog) fills `SelectionInput`'s protection value from the discovery the tracker reads (Q2).
- **2.3f** (backlog): named by the sprint's split note, which lists the files 2.3, 2.3c and 2.3d share. Its rediscovery is what makes a new test module this ticket keeps as an input a discovered and run one, and makes pattern changes within one daemon life.

#### Sizing

About 17 raw files and 22 estimated on the files this ticket builds, over the 20-file limit; the orchestrator ruled to proceed (Q6). Code units: 6 (5 criteria plus validation). Production: `inputs/protection.ts` (new), the extracted walk (new), `inputs/non-inputs.ts`, `inputs/declared-non-inputs.ts`, `inputs/input-tracker.ts`, `inputs/fingerprint.ts`, `inputs/current-inputs.ts`, `daemon/lifecycle.ts`, `selection/selection-types.ts`, `selection/select-tests.ts`, and `packages/daemon/package.json` (the orchestrator's install). Tests, for create-tests: § Existing tests this change breaks. `docs/architecture.md` and `README.md` are the orchestrator's writes, reported as text. Over 10 estimated, so dev delegates to implementer agents along two groups sharing only the protection value's type: the producer and selection (`protection.ts`, `non-inputs.ts`, `selection-types.ts`, `select-tests.ts`), and the tracker and lifecycle (`declared-non-inputs.ts`, `input-tracker.ts` and its extraction, `fingerprint.ts`, `current-inputs.ts`, `lifecycle.ts`). The second group is one dependency chain.

#### Current structure of the modified files

- `packages/daemon/src/inputs/non-inputs.ts`: `NON_INPUTS_FILE`, `NonInputsDeclaration` (absent, declared with `patterns`, unusable with `reason`), `NonInputMatch`, private `PROTECTED_NAMES`; `readNonInputs`, `sameDeclaration`, `unusableReason`, `declaredNonInputs(declaration, protectedTestModules: ReadonlySet<string>)`, which returns `() => undefined` unless declared with patterns, and otherwise skips `rt-test.json`, `tsconfig*.json` and `jsconfig*.json`, `PROTECTED_NAMES` and `protectedTestModules.has(path)` before matching; `discoveredTestModules`, `workspaceTestModules`, `testModuleFile`, which since 2.3b returns an absolute module path (another Windows drive) as given. Its runtime imports are `node:fs`, `node:path`, `selection/source-walk.js`, `vitest/error-text.js` and `vitest/find-workspaces.js`; it is loaded by `start-plan.ts`, which `client.ts` exports, and by `vitest/selection-facts.ts` for `testModuleFile`, so it must not import that module at runtime (a type-only import of the facts is fine).
- `packages/daemon/src/inputs/input-filter.ts` (read, not modified): since 2.3b, `excludes` and `declares` return early for a path `liesInside(root, path)` refuses, and `absoluteInputPath` returns an absolute path as given.
- `packages/daemon/src/inputs/declared-non-inputs.ts`: `DeclaredNonInputs` holds `#declaration`, `#logged`, `#protected: ReadonlySet<string>` and `#match`; `match`, `namesFile`, `unusable`, `read`, `report` and `protect(testModules)`, which returns each path in the symmetric difference whose match changed.
- `packages/daemon/src/inputs/input-tracker.ts`: `TrackedInputs` (`start`, `firstReconciled`, `current`, `settled`, `beginJob`, `endJob`, `protectTestModules(discovery)`, `stop`); `InputTracker.protectTestModules` calls `this.#declared.protect(discoveredTestModules(discovery))`, returns early when nothing flipped or the tracker has not started, queues each flipped path in `#quiet` and `#queue`, and awaits `#ledger.waitForRead()`. `#reconcileOnce` calls `this.#declared.read()` then `InputFilter.open(..., this.#declared.match, ...)` and `takeInventory`.
- `packages/daemon/src/daemon/lifecycle.ts`: `begin` calls `#protectStoredTestModules` (the store's latest discovery) before `inputs.start()`; `#protectDiscovered` awaits `settled()`, reads `testModuleChangedSince(discovery, startedAt)`, opens a guard job, awaits `protectTestModules(discovery)`, closes the guard, and returns the first failing verdict of the discovery's, the time check's and the guard's.
- `packages/daemon/src/inputs/fingerprint.ts` and `current-inputs.ts`: `testModuleChangedSince(project, discovery, since)` checks each listed test module outside the inputs by `statSync(...).mtimeMs`, exposed through `CurrentInputs.testModuleChangedSince`.
- `packages/daemon/src/selection/selection-types.ts`: `SELECTION_POLICY_VERSION = 3`; `SelectionNonInputs { declaration, protectedTestModules }`.
- `packages/daemon/src/selection/select-tests.ts`: `selectionContext` builds `declared: declaredNonInputs(input.nonInputs.declaration, input.nonInputs.protectedTestModules)`; `selectForPath` checks it first.

#### Existing tests this change breaks

Found by `rg` over `packages/*/test` and `test` for `protectTestModules`, `protectedTestModules`, `declaredNonInputs`, `DeclaredNonInputs`, `.protect(`, `discoveredTestModules`, `testModuleChangedSince`, `SELECTION_POLICY_VERSION`, `unusable`, `nonInputs` and `rt-test.json` (23:54), each match read, and by reading the records `defects.json` anchors in the modified files (23:45).

- `packages/daemon/test/input-tracker.test.ts`: every test that writes `rt-test.json` with a pattern and gives the tracker no discovery (D1992 to D1997, D2040, D2044, D2050, D2051 among them) now sees no pattern apply (AC3), as the sprint foresaw: each needs a stand-in discovery that reports the facts. Its helper calling `declaredNonInputs(` with a set, and its `protectTestModules` calls, change with the signatures.
- `packages/daemon/test/lifecycle.test.ts`: `StandInInputs.protectTestModules` follows the renamed method; the real-tracker case whose `rt-test.json` declares `src/**` starts with no stored discovery, so no pattern applies until the discovery is protected (D1987 to D1990 read that order).
- `packages/daemon/test/selection/harness.ts`: builds `nonInputs.protectedTestModules` from `listedTestModules`; it must build the protection value through the producer instead. `select-tests.test.ts` D2009 to D2013 and D2045 to D2049 declare patterns through it.
- `packages/daemon/test/defects.json`: D2010 (`protectedTestModules.has(path)` in `non-inputs.ts`), D1988 (the time check in `#protectDiscovered`), and records in `declared-non-inputs.ts` (3), `input-tracker.ts` (23), `lifecycle.ts` (44), `fingerprint.ts` (6) and `current-inputs.ts` (1) wherever their `old` lies on a changed line.
- `packages/daemon/test/selection/defects.json`: D2014 (`SELECTION_POLICY_VERSION = 3`), and the `non-inputs.ts` records D2010, D2011, D2013, D2045 and D2046 where their anchors move.
- 2.3b's sweep gave each discovered-workspace factory `selectionFacts: { reported: true, projects: [] }` (`input-tracker.test.ts`, `lifecycle.test.ts`, `query.test.ts`), so a test that hands the tracker such a discovery still sees its patterns apply, with only the listed test modules protected; a test that hands none sees no pattern apply. `store.test.ts` and `discover-tests.test.ts` match the widened search only on 2.3b's own `selectionFacts` and are not broken by this ticket (01:58).
- `input-tracker.test.ts` also calls `testModuleChangedSince` on the current inputs directly, and `lifecycle.test.ts` and `query.test.ts` build `CurrentInputs` stand-ins holding `testModuleChangedSince`: each changes if task 7 changes that member's shape.
- `packages/daemon/test/selection/select-tests.test.ts` reads `SELECTION_POLICY_VERSION` by name, so the raise to 4 breaks no assertion there.
- Not broken, checked: `query.test.ts` D2019 and `packages/cli/test/cli.test.ts` read `nonInputsUnusable` through a stand-in, whose shape Q3 keeps.

#### Doc text

A draft for the orchestrator, final wording to follow the build.

- `docs/architecture.md`, the tracker paragraph: "No pattern removes a `package.json`, [...] or a test module of the latest stored discovery, as `discoveredTestModules` lists them." becomes "No pattern removes a `package.json`, a `pnpm-workspace.yaml`, a lockfile, a Vitest or Vite config file, a `tsconfig*.json` or `jsconfig*.json` file, a test module, setup file or global setup file the discovery in effect lists, or a file a discovered project's `include` or `includeSource` patterns match and its `exclude` patterns do not, matched as Vitest's discovery globs them. While a declaration holds patterns and the discovery in effect is absent or does not report those files for every discovered workspace, no pattern applies, and every answer says why." In the known limits, "a setup file a pattern matches" and "and a new test module a pattern matches, which no discovery lists until the discovery is next stale" are deleted, and "a new test module a pattern matches in a workspace that failed, is unsupported or was not confirmed" is added.
- `README.md`: the protected-files bullet gains "each setup and global setup file of the latest discovery, and every file a workspace's test file patterns match"; the bullet "A setup or global setup file a pattern matches is a non-input, and a new test file a pattern matches is not discovered until the discovery is next stale." becomes "Until the daemon holds a discovery that reports which files the patterns may not remove, no pattern applies: every file stays an input, and every query answer says why."; and the answers bullet's "while `rt-test.json` cannot be used, why every file stays an input" becomes "while `rt-test.json` cannot be used or its patterns cannot yet apply, why every file stays an input".

#### Previous ticket

2.3b (done), the nearest earlier key in the status file, from its Completion Notes and its landed code: the report is `{ reported: true, projects }` or `{ reported: false }`, per project not in browser mode; the root project's global setup is credited to every project and deduplicated after conversion; the store keeps the projects array in `discovery_workspaces.selection_facts`, NULL for not reported, which only a discovery stored before schema version 3 produces; an unset `includeSource` is reported as `[]`, and `include` and `exclude` always carry Vitest's defaults; the pattern directory is `config.dir || config.root`, converted through `moduleLocator`'s `realPath`, which resolves a path not on disk through its nearest ancestor that is. From 2.3 (done): `lifecycle.ts` awaits `inputs.settled()` before each `beginJob`. From 2.1b (done): protection runs before the discovery's fingerprint under a guard job, its reads mark no job, and the unwatched-module time check runs before it (D1987 to D1991).

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3b, § Ticket 2.3c, § Ticket 2.3d, § Ticket 2.3e, § Ticket 2.3f.
- Ticket 2.1b (`_agent-docs/tickets/2-1b-declared-non-inputs.md`) AC4, AC8, § Owner rulings and grill record (Q2, the 15:49 ruling), § Design notes "Protected test modules and the first discovery" and "Known limits".
- Ticket 2.3b (`_agent-docs/tickets/2-3b-selection-facts.md`) AC1, AC3, AC4 and § Design notes "Not reported is a state, not empty lists".
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (23:42).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C1,C3,C4,C5,C8,C12,C14,C30,C32,C38,C39,C46,C48,C55,C59,C113,C115,C117,C126,C129,C151,C160 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P9,P10,P13,P16,P17,P18,P21,P35 -->

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
sizing_ac_count: 6
files_to_modify:
  - packages/daemon/src/inputs/non-inputs.ts
  - packages/daemon/src/inputs/declared-non-inputs.ts
  - packages/daemon/src/inputs/input-tracker.ts
  - packages/daemon/src/inputs/fingerprint.ts
  - packages/daemon/src/inputs/current-inputs.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/selection/selection-types.ts
  - packages/daemon/src/selection/select-tests.ts
files_to_create:
  - packages/daemon/src/inputs/protection.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 6b7c4b3f-9f2b-4b26-a849-827c920b65d5

#### Test Files This Change Broke

Typecheck errors (`bun run --filter @rt-test/daemon typecheck`, 02:24, 12 errors, every one in a test file):

- `packages/daemon/test/input-tracker.test.ts` (6): the helper calling `declaredNonInputs(` with a set now takes the protection value (build it with `protection(discovery, root)` from `inputs/protection.ts`); `testModuleChangedSince` is now `protectedFileChangedSince` on `CurrentInputs`; `protectTestModules` is now `protectInputs(discovery, jobStart?)`, which resolves with a reason string or undefined. Behavior: every test that writes `rt-test.json` with a pattern and gives the tracker no discovery now sees no pattern apply (AC3), and the log carries the new warning line.
- `packages/daemon/test/lifecycle.test.ts` (3): `StandInInputs` implements `protectInputs` (returning `Promise<string | undefined>`) and `protectedFileChangedSince`.
- `packages/daemon/test/query.test.ts` (2): the `CurrentInputs` stand-ins rename `testModuleChangedSince` to `protectedFileChangedSince`.
- `packages/daemon/test/selection/harness.ts` (1): `nonInputs.protectedTestModules` becomes `nonInputs.protection`, built through `protection(discovery, root)`.

Changed messages a test may assert: the unwatched-file reason is now `<path>, which the discovery protects and no watch covers, may have changed while the job ran` (was `the test module <path>, which no watch covers, ...`); the declaration log line while no pattern applies is `warning: <reason>; the patterns rt-test.json declares: "a", "b"`.

Named-defect records whose `old` no longer matches exactly once (script over both `defects.json` files, 02:24):

- `packages/daemon/test/defects.json`: D1879, D1988, D1990, D2052, D2090 (`lifecycle.ts`: the renamed `protectInputs`/`protectedFileChangedSince` calls and `#protectStoredDiscovery`); D1898 (`fingerprint.ts`: `testModuleChangedSince` became `protectedFileChangedSince`, which iterates `protectedFiles(discovery)` and checks `project.digests`); D1910, D1912 (`input-tracker.ts` to `current-inputs.ts`: `#incompleteReason` moved into the pure `incompleteReason(condition)`, reading `condition.reconciling` and `condition.lastReconciledAt`); D1997 (`declared-non-inputs.ts`: `sameDeclaration` is deleted; `report` now compares the logged text, `if (text === this.#logged) return;`).
- `packages/daemon/test/selection/defects.json`: D2010, D2011 (`non-inputs.ts`: `protectedTestModules.has(path)` is gone; protection is consulted as `pattern === undefined || protection.protects(path)` after the pattern match); D2014 (`SELECTION_POLICY_VERSION = 3` is now `4`).

#### ACs Owed a Test

- AC4: when a new discovery changes protection, every flipped file joins or leaves the inputs before the discovery's fingerprint is taken, with no job marked by those reads; an input event during them still fails the fingerprint; a walk-found file modified after the job began fails it. The ordering and concurrency can only be observed by running the tracker and lifecycle.

#### Tests Owed

None beyond the criteria. Defects the build makes possible, for create-tests to weigh: the producer mirrors tinyglobby 0.2.17's `processPatterns`/`normalizePattern` (empty skip, `!` sorting, parent collapse, crawl root) and its directory pruning below the crawl root only (adversarial F1, measured: include `e2e/**/*.spec.ts` with exclude `**/e2e` protects `e2e/deep/a.spec.ts`, as discovery finds it); a pattern over 65536 characters stops patterns applying with a truncated quote; a root workspace that does not report its facts is named "at the consumer root"; the walk's reads are kept without marking a job unless a queued event supersedes them; a walk failure or a stop during the walk resolves `protectInputs` with a reason instead of rejecting; `#protecting` keeps every result unavailable during the walk.

### Tests Record

Tests session: threadId 92c74b29-3752-4422-a481-11cba9db9ff4

Questions (crew.md § Questions), each decided by the orchestrator, holding the owner's calls: more defect ids, asked 02:31 and 02:40, answered 02:31 (D2153 to D2160) and 02:40 (D2161, D2162). A probe of tinyglobby 0.2.17 found that on Windows discovery's glob opens `Src` for `src/**/*.test.ts` (sent 02:37). Ruled at 02:37: fix it in this lane. Dev made the crawl root's segments match in any case on win32 (`rootRespelling`, 02:38), pinned by D2158 and D2161.

Expected values for the producer come from tinyglobby 0.2.17's `glob`, run as Vitest calls it (`dot: true`, `expandDirectories: false`) over temporary trees, and, for the linux branch, from its source (`isWin`, `escapePath`).

#### Named Defects

- D2128: A setup file the discovery reports is not protected, so a declared pattern covering it makes its edit select nothing. (AC1, AC5)
- D2129: A global setup file the discovery reports is not protected, so a declared pattern covering it makes its edit select nothing. (AC1, AC5)
- D2130: Only listed files are protected, so a new test module a workspace's include pattern matches stays a declared non-input and its change selects nothing. (AC2, AC5)
- D2131: A discovered workspace that does not report its selection facts is skipped, so declared patterns still apply with its files unprotected. (AC3, AC5)
- D2132: The test file patterns are matched without dot names. (AC2)
- D2133: The test file patterns are matched without regard to case. (AC2)
- D2134: A file an exclude pattern matches is protected whenever an include matches it. (AC2)
- D2135: A directory an exclude pattern matches is not pruned. (AC2)
- D2136: An excluded directory name also prunes the directories the crawl starts from. (AC2)
- D2137: An absolute include pattern is not made relative to the pattern directory. (AC2)
- D2138: A leading climb that re-enters the pattern directory by name is kept. (AC2)
- D2139: A climbing pattern leaves the crawl's start at the pattern directory, so an excluded directory outside it is not pruned. (AC2)
- D2140: The includeSource patterns are never compiled. (AC2)
- D2141: An include pattern beginning with ! is dropped instead of excluding. (AC2)
- D2142: An exclude pattern beginning with ! is compiled as a negation instead of dropped. (AC2)
- D2143: An empty include pattern is normalized to "." and resets the crawl's start, so an excluded name prunes the directory the other patterns start from. (AC2)
- D2144: The pattern directory is escaped as on Windows on every platform (linux arm through `onPlatform`). (AC2)
- D2145: A pattern picomatch refuses throws out of the producer instead of stopping patterns applying with a reason. (AC3)
- D2146: A refused pattern is quoted whole in the reason. (AC3)
- D2147: A root workspace that does not report its facts is named "." instead of the one at the consumer root. (AC3)
- D2148: A workspace that failed, is unsupported or was not confirmed stops the declared patterns applying. (AC3)
- D2149: The tracker starts with patterns applying and nothing protected, so before any discovery a matched file is hidden and no answer says why. (AC3)
- D2150: The reason no pattern applies is carried while rt-test.json declares no pattern. (AC3)
- D2151: The declaration's log line calls the patterns in effect while none applies. (AC3)
- D2152: A change of protection is not logged until a later reconciliation. (AC3)
- D2153: No walk runs when the patterns stop applying, so a file one hid stays out of the inputs. (AC4)
- D2154: No walk runs when a project's test file patterns change. (AC4)
- D2155: A file only the walk finds is never checked against the job's start. (AC4)
- D2156: A fingerprint can be computed while protection walks. (AC4)
- D2157: A file the new protection names by path is flipped only if the tracker holds it. (AC4)
- D2158: On Windows a path is matched in its on-disk case, so a test module under `Src/` stays hidden though the glob of `src/**` finds it (win32 arm through `onPlatform`). (AC2)
- D2159: The reason protection's walk resolves with is dropped, so the discovery is stored under its digest. (AC4)
- D2160: The time check before protection covers only listed test modules, not setup files. (AC4)
- D2161: The crawl root's segments match in any case on every platform (linux arm through `onPlatform`). (AC2)
- D2162 (review G1): After a stop during protection's walk, protection waits on the ledger, so it never resolves and the daemon's stop hangs. The test races protection against a bound and asserts which settled first. (AC4)
- D2163 (review G2): The lifecycle gives protection no job start, so a file only the walk finds, edited during the discovery's job, is stored fingerprinted. (AC4)
- D2164 (review G3): An input event on a flipped path that arrives before its quiet read leaves the read quiet, so the guard job stays fingerprinted. (AC4)
- D2165 (review G4): While protection walks, the answers' facts read the reconciliation complete. (AC4)
- D2166 (review G5): An include pattern opening with the extglob `!(` is sorted as a negation. (AC2)
- D2167 (review G6): A trailing `**` leaves its directory in the crawl's start, so an exclude naming it no longer prunes it. (AC2)
- D2168 (review G7): A workspace below the root that does not report its facts is named as the one at the consumer root. (AC3)
- D2169 (review G8): A pattern directory at a Windows drive root builds its prefix as `C://`, so the crawl start never folds case. Proven on Windows; the win32 arm runs through `onPlatform`, but the drive-root path is handled by the host's `node:path`, so its Linux proof is unverified. (AC2)
- D2170 (review G9): A flipped path an event had already queued is made quiet, so its real change marks no job. (AC4)
- Re-anchored to the changed code and re-proven: D1879, D1898, D1910, D1912, D1988, D1990, D1997, D2010, D2011, D2014, D2052, D2090. D2014 now pins version 4 (AC5). D1988 and D1987 now start from a stored discovery whose patterns hide the module through the job, since with no discovery no pattern applies (AC3), so neither mutation could otherwise be observed.

#### Deliberately Untested

- `packages/daemon/src/inputs/non-inputs.ts`: the `!protection.applies` guard in `declaredNonInputs`. Removing it fails to compile, since `protects` exists only while patterns apply, and D2131 and D2149 pin "no pattern applies" through the producer.
- `packages/daemon/src/inputs/declared-non-inputs.ts`: `liesUnderRoot(path) &&` in the flips. An out-of-root flip is dropped by `InputFilter.excludes` when read, so removing it changes no fingerprint and no verdict.
- `packages/daemon/src/inputs/protection-walk.ts`: a walk read superseded by a queued event. It differs only when the queued read completes between the inventory's read and its commit, which no test can schedule without replacing the inventory.
- `packages/daemon/src/inputs/input-tracker.ts`: `#walkReleased`'s `.catch`, which turns a throw from the walk into a reason. `takeInventory` reports a failed read as `{ ok: false }`, so only a throw from inside the state or the inventory reaches it, and no seam injects one.
- `packages/daemon/src/inputs/input-tracker.ts`: the quiet flag cleared for an excluded path. A stale flag matters only if that path stops being excluded and changes before its next queued read, within one daemon life.
- `packages/daemon/src/inputs/protection.ts`: a pattern directory on another Windows drive. `node:path` is chosen when the module loads, so `onPlatform` cannot make the path absolute on Linux.

### Review Record

Review session: threadId 2fde7734-4b17-4b31-a3f7-916f7e9b19c8

Reviewed 2026-09-28 03:03 to 03:15: the uncommitted changeset, and the doc changes of 9e987ee, 2c90e27 and ed700dc. The matcher was judged against installed tinyglobby 0.2.17, picomatch 4.0.7, fdir 6.5.0 and Vitest 4.1.11 and 5.0.1, with a win32 probe of tinyglobby's `glob` as Vitest calls it. It mirrors `processPatterns`, `normalizePattern`, the per-call crawl root and the directory pruning, with include and includeSource globbed as separate calls. One settled fact reads wrong without changing the code: picomatch 4.0.7 enables POSIX bracket classes unless `posix === false` (`lib/parse.js` line 719), and `posix: true` only turns `[!` into `[^` (line 751). The mirror passes the same options as tinyglobby, so nothing differs.

Fixed:

- `inputs/input-tracker.ts` `protectInputs`: after the walk's await it waited on the ledger directly. A stop during the walk had already released every waiter, and nothing drains the quiet-queued flips once stopped, so `protectInputs` never resolved and the lifecycle's stop hung on the start sequence. It now awaits `settled()`. Its doc comment now says that the walk does not wait for a running reconciliation.
- `inputs/current-inputs.ts`: while protection walked, the facts read reconciliation complete with nothing pending, and summary drops `unfingerprintedWorkspaces` while unavailable, so an answer whose results all read unknown gave no reason. The walk now counts as an incomplete reconciliation with its reason (the D2156 line moved into `incompleteReason` unchanged).
- `inputs/protection.ts` `rootRespelling`: for a pattern directory at a Windows drive root, the prefix was `C://`, so the crawl root's segments never folded. `directoryPrefix` now builds that prefix and `globCall`'s `below`.
- Doc comments: `DeclaredNonInputs.protect` now says it logs; `#protectDiscovered` says the tracker dropped a covered file's events rather than that no watch covered it.

Tech debt, triaged against a3ca5bc on 2026-09-28 at 04:21 (triage only, by the orchestrator's 04:20 instruction; `node scripts/list-open-issues.mjs` printed `0 open issues, complete`). The dispositions follow the list:

- `inputs/protection-walk.ts` `keepReleasedFiles` calls `takeInventory(scope, scope.root)`, which reads and hashes every input under the root (`input-inventory.ts` `hashFiles`), then keeps only those `state.hasInput` lacks. A walk costs a full reconciliation's reads to find a few files. It runs at most once per daemon life today; 2.3f's rediscovery makes it recur.
- `daemon/lifecycle.ts` `#protectDiscovered`: nothing catches deleting or reordering `if (!verdict.fingerprinted) return verdict;` (every lifecycle test scripts the discovery's own verdict as fingerprinted; no record mutates the line). Without it, a discovery whose watched inputs changed while Vitest collected is stored under a digest.
- `daemon/lifecycle.ts`: nothing catches `startedAt` being taken after `executor.discover` returns. D1988 sets the edited module's time 60 s ahead, and the stand-in's `protectedFileChangedSince` ignores `since`.
- `daemon/lifecycle.ts` `#startSequence`: a rejection from `protectInputs` or `endJob(guard)` escapes to the start sequence's catch; nothing joins `#unstored`, and the guard job never closes.
- `daemon/lifecycle.ts` `#protectStoredDiscovery` reads every workspace's latest run through `#latestResults()` to use only `.discovery`; `store.readLatestDiscovery` answers it.
- `inputs/input-tracker.ts` `protectInputs` takes `held` from the committed `project()` snapshot. An input set but not committed when `protect` runs, then declared by the new protection, never flips. It cannot be reached today, because lifecycle awaits `settled()` first; 2.3f's repeated protection can reach it.
- `selection/select-tests.ts` `normalizeRelativePath`: a change path holding `\` is neither refused nor converted, so under `**` it reaches `protects` as one segment, and the answer differs by platform. A change naming the root (`""`, `.`) normalizes to `.`, which `**` declares, so it selects nothing where it would select widely.

Dispositions:

1. The walk hashes every input. Fix later. Change request: "perf: let protection's walk read only the files the tracker does not hold". Evidence: `input-inventory.ts` `takeInventory` passes every listed file to `hashFiles` before `keepReleasedFiles` filters by `state.hasInput`. Scope: a skip predicate on the inventory, applied before `hashFiles`; two files, mechanical. Sprint 2.3f's scope already names the recurrence.
2. and 3. The lifecycle verdict order and the job start. Fix later, as one change request: "test: pin #protectDiscovered's own-verdict return and the time its job start is taken". Evidence: no record in `test/defects.json` mutates `if (!verdict.fingerprinted) return verdict;`, and every lifecycle test scripts the discovery's verdict as fingerprinted; D1988 edits its module 60 s ahead of now, so a `startedAt` taken after `executor.discover` still flags it. Scope: `lifecycle.test.ts` and `defects.json` only (the stand-in records `jobStart` since D2163, but not the `since` that `protectedFileChangedSince` receives).
3. A rejection in the protection step. No change. Every rejection source inside it is already turned into a reason: `protection` catches a refused pattern, `#walkReleased` catches the walk, `#drainQueue` catches a failed read, `settled()` never rejects, and `InputJobs.close` is pure. Only a programming error reaches the start sequence's catch, which logs it at error level.
4. The start reads every latest run. Fix later. Change request: "perf: read only the latest discovery when protecting the stored one at start". Evidence: `#protectStoredDiscovery` uses only `this.#latestResults().discovery`, while `RtTestStore.readLatestDiscovery(scope)` (`store/open-store.ts`) answers that alone. Scope: one line in `lifecycle.ts`, mechanical, once per start.
5. `held` from the committed snapshot. Closed by decision: it cannot be reached until protection runs within one daemon life, and sprint 2.3f's scope now carries it (amended at a3ca5bc), so 2.3f's author meets it with the repeated protection that makes it reachable.
6. A backslash or root change path. Fix later. Change request: "fix: refuse a change path holding a backslash or naming the root". Evidence: `select-tests.ts` `normalizeRelativePath` runs `posix.normalize` only, and `refusalReason` refuses only absolute and climbing paths. `SelectionInput.change` is documented as `/`-separated root-relative files, and selection has no production caller until 2.3e. Scope: `refusalReason` in `select-tests.ts`, which holds 489 of its 500 code lines and which 2.3d edits next, so the change request should land after 2.3d or extract first.

#### Test Coverage Gaps

Denominator: 34 new named-defect tests (D2128 to D2161) and 12 re-anchored, in the touched test files, against the five criteria's behaviors. Each row below is a defect no current test goes red on.

| #   | Source                                     | Named defect                                                                                                                                                                            | Expected test                                                                                                                                                                                                                                                                                                                                         | Severity |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| G1  | `inputs/input-tracker.ts` `protectInputs`  | After a stop during protection's walk, `protectInputs` waits on the ledger instead of `settled()`, so while a flipped path stays queued it never resolves, and the daemon's stop hangs. | A pattern change that both flips a held path and walks (include narrowed from `**/*.test.ts` to `src/**`); stop the tracker mid-walk; `protectInputs` resolves. Mutation: `    await this.settled();\n    return changed;` to `    await this.#ledger.waitForRead();\n    return changed;`.                                                           | HIGH     |
| G2  | `daemon/lifecycle.ts` `#protectDiscovered` | The lifecycle gives protection no job start, so a file only the walk finds, edited during the discovery's job, is stored fingerprinted.                                                 | The stand-in records the `jobStart` it receives and the test asserts it is the discovery's start, or a real-tracker case edits a file only an include pattern finds during the job. Mutation: `inputs.protectInputs(discovery, startedAt)` to `inputs.protectInputs(discovery)`. The stand-in ignores the argument today, so D2159 passes without it. | MEDIUM   |
| G3  | `inputs/input-tracker.ts` `#changed` (AC4) | An input event on a flipped path that arrives before its quiet read is read quietly, so the guard job stays fingerprinted and the discovery is stored under a digest taken mid-edit.    | Hold the quiet read, deliver an event on the flipped path, and assert the guard job is not fingerprinted. Mutation: delete `    this.#quiet.delete(path);\n    if (this.#queue.get(path)`'s first line.                                                                                                                                               | MEDIUM   |
| G4  | `inputs/current-inputs.ts` `inputFacts`    | While protection walks, the answers' facts read reconciliation complete, so an answer whose results all read unknown gives no reason.                                                   | Facts taken mid-walk read `incomplete` with the protecting reason. Mutation in `inputFacts` only: `const incomplete = incompleteReason(condition);\n  const { lastReconciledAt` to `const incomplete = incompleteReason({ ...condition, protecting: false });\n  const { lastReconciledAt`.                                                           | MEDIUM   |
| G5  | `inputs/protection.ts` `isNegated`         | An include pattern opening with the extglob `!(` is sorted as a negation and becomes an ignore pattern, so the test modules it finds are unprotected.                                   | Include `["!(skip)/*.test.ts"]` protects `src/a.test.ts` and not `skip/a.test.ts` (confirm with tinyglobby as Vitest calls it). Mutation: drop `&& pattern[1] !== EXTGLOB_OPEN`.                                                                                                                                                                      | LOW      |
| G6  | `inputs/protection.ts` `narrowCrawl`       | A trailing `**` leaves its directory in the crawl root, so an exclude naming that directory no longer prunes it and its files are protected though discovery finds none.                | Include `["e2e/**"]` with exclude `["**/e2e"]`: `e2e/a.ts` is not protected (confirm with tinyglobby). Mutation: delete `      shared.pop();`.                                                                                                                                                                                                        | LOW      |
| G7  | `inputs/protection.ts` `protection`        | A discovered workspace below the root that does not report its facts is named "at the consumer root" in the reason.                                                                     | A non-root unreported workspace's reason names its path. Mutation: `entry.workspace.path === ROOT_PATH ? ROOT_WORKSPACE : entry.workspace.path` to `ROOT_WORKSPACE`.                                                                                                                                                                                  | LOW      |
| G8  | `inputs/protection.ts` `rootRespelling`    | A pattern directory at a Windows drive root builds its prefix as `C://`, so the crawl root's segments never fold and a test module under `Src/` stays hidden.                           | win32: consumer root `C:\`, directory `.`, include `["src/**/*.test.ts"]`, path `Src/a.test.ts` is protected. Mutation: `const prefix = directoryPrefix(cwd);` to ``const prefix = `${cwd}/`;``. It needs a win32 `node:path`, so it may prove only on Windows (the recorded other-drive exclusion names the same limit).                             | LOW      |
| G9  | `inputs/input-tracker.ts` `#queueQuietly`  | A flipped path an event had already queued is made quiet, so its real change marks no job.                                                                                              | Queue an event on a path, protect so that path flips in the same tick, and assert an open job is not fingerprinted. Mutation: drop the `if (!this.#queue.has(absolute))` guard, keeping its body.                                                                                                                                                     | LOW      |

### Completion Notes

Built by dev (threadId 6b7c4b3f-9f2b-4b26-a849-827c920b65d5), 2026-09-28 02:04 to 02:25, both groups built in this session (orchestrator, 02:05).

- U1 CONFIRMED (resolution block under the table).
- Sanity check (sent 02:04, answered 02:05 by the orchestrator, holding the owner's calls): F1 ruled (a), empty patterns skipped as discovery skips them; F2 and F3 STAND, so the producer mirrors `processPatterns` and `normalizePattern` whole and prunes directories the exclude list matches. The author amended AC2, AC3, the producer task, G1 and the Settled facts at 02:05-02:06; checked consistent at 02:08. At 02:09 the orchestrator confirmed pruning the crawled directories outside the pattern directory for a `..` pattern, as discovery does, and asked the author to widen AC2's wording.
- `inputs/protection.ts`: `protection(discovery | undefined, consumerRoot)` is the one producer; `protectedFiles(discovery)` is its exact-path part, which `fingerprint.ts` also reads. Paths relate to the pattern directory by absolute paths; a pattern directory on another drive protects nothing. The per-glob-call crawl root is computed as tinyglobby's `normalizePattern` moves it (`collapseClimb`, `narrowCrawl`), and a directory is pruned only strictly below that root (adversarial F1).
- `inputs/protection-walk.ts`: `keepReleasedFiles` walks under the rebuilt decision, keeps each read no queued event supersedes without marking a job, and reads each kept file's time against the job's start.
- `input-tracker.ts` went over the 500-line cap (518); `facts`, the unavailable reason and the incomplete reason moved as pure functions (`inputFacts`, `unavailableReason`, `TrackerCondition`) into `current-inputs.ts`, which builds a query's view of the inputs. The tracker holds about 495 code lines now, so a later addition there needs an extraction first.
- `sameDeclaration` deleted: `report` compares the logged text, which also changes when patterns stop or start applying (C59).
- `protectedFileChangedSince` also checks a setup or global setup file the inputs leave out for another reason (git ignores it, or it lies outside the root). Protection does not move such a file into the inputs, so a recent edit to it fails the discovery's fingerprint needlessly; that errs toward not fingerprinted.
- Adversarial review (02:13-02:20, 7 findings): F1 fixed (crawl-root pruning, measured by the reviewer and re-probed at 02:23); F4 fixed (a walk failure or a stop during it resolves with a reason, and the guard job closes); F5 fixed (the walk's reads are kept instead of read twice; the whole-tree hash per walk remains, at most once per daemon life); F6 fixed (the root workspace is named "at the consumer root"); F7 fixed (a quiet flag clears when its path is excluded, and the walk's reason no longer claims a pattern hid the file). Discarded F2: typecheck patterns are the ticket's known limit (2.3b Q3). Discarded F3: a gitignored or out-of-root setup file is the documented known limit "a gitignored file a test reads" and "a file outside the consumer root". Post-fix re-validation: lint exit 0, daemon typecheck with errors only in the four test files above, CLI typecheck exit 0.
- Windows case of the crawl root (orchestrator ruling 02:37, from rt-t2-3c-tests' probe): `rootRespelling` in `protection.ts` respells the crawl root's segments in the patterns' case on win32 before matching. The ruling said "each pattern's static prefix"; a tinyglobby probe at 02:38 showed the crawl folds only the root every match pattern of one glob call shares, so protection mirrors that (§ Design notes "Case"; AC2 amended). Lint exit 0 at 02:38; the daemon typecheck's errors were in test files only (`input-tracker.test.ts` 8, `lifecycle.test.ts` 3, mid-repair by the tests session).
- README.md and docs/architecture.md: user-visible behavior changed; the exact text went to the orchestrator (orchestrator-owned).
- Change-request candidates:
  1. Absolute test file patterns under a linked consumer root (adversarial lead, unverified). Vitest makes an absolute `include` relative to `config.dir || config.root` as Vitest names it, but 2.3b reports the pattern directory through `realPath`, so under a symlinked or `subst` root an absolute pattern written from the unresolved path climbs out of the real directory and protects nothing (narrowing). Fix: 2.3b's report carries the directory as Vitest names it beside the real one, and the producer normalizes absolute patterns against the former. Touches `vitest/selection-facts.ts`, the store column and `protection.ts`, so it belongs with the selection-facts owner. Recommendation: fix, since it narrows.

### File List

- `packages/daemon/package.json` (dev: `picomatch` 4.0.7, `@types/picomatch` 4.0.3)
- `bun.lock` (orchestrator's install, 02:01)
- `packages/daemon/src/inputs/protection.ts` (new)
- `packages/daemon/src/inputs/protection-walk.ts` (new)
- `packages/daemon/src/inputs/non-inputs.ts`
- `packages/daemon/src/inputs/declared-non-inputs.ts`
- `packages/daemon/src/inputs/input-tracker.ts`
- `packages/daemon/src/inputs/fingerprint.ts`
- `packages/daemon/src/inputs/current-inputs.ts`
- `packages/daemon/src/daemon/lifecycle.ts`
- `packages/daemon/src/selection/selection-types.ts`
- `packages/daemon/src/selection/select-tests.ts`
- `_agent-docs/tickets/2-3c-protect-selection-inputs.md` (create-ticket)
- `_agent-docs/sprints/sprint-2-fresh-runs.md` (create-ticket, under the 23:55 grant: § Ticket 2.3c's matcher clause per Q1, FR7 and the ticket link; § Ticket 2.3e's protection sentence per Q2)
- `docs/requirements.md` (orchestrator, 23:55: FR7's marker gains 2.3c)

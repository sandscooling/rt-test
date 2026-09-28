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

- [ ] AC1: For every workspace the discovery in effect (AC3) lists as discovered, each setup file and each global setup file it reports (ticket 2.3b AC1) is never a declared non-input, whatever `rt-test.json` declares: an edit to one changes the fingerprints an edit to any input changes, and a selection over it selects as it would with no `rt-test.json`.
- [ ] AC2: Likewise, a file is never a declared non-input when, for some project such a workspace reports, its path relative to the directory the project's patterns are matched from (ticket 2.3b AC3) matches none of the project's `exclude` patterns and matches one of its `include` or `includeSource` patterns, each matched as Vitest 4.1's and 5's glob of a project's test files matches it: names beginning with a dot included, case-sensitive, and an absolute pattern taken relative to that directory. A file an `includeSource` pattern matches is protected whether or not it holds in-source tests. So adding a file both a declared pattern and a workspace's `include` patterns match adds an input, and the discovery reads stale.
- [ ] AC3: While a usable `rt-test.json` declares at least one pattern and the discovery in effect is absent, or lists a discovered workspace that does not report these facts (a discovery stored before the store's schema version 3, ticket 2.3b AC4), or reports a pattern the matcher refuses (such as an empty string), no declared pattern applies: every file stays an input, and a selection treats every path as it would with no `rt-test.json`. The daemon's log gives the reason at warning level whenever patterns do not apply, from the start when no discovery is in effect and whenever they stop applying, and says when they apply again, and every summary and path status answer carries the reason as a whole sentence in the field that carries an unusable declaration's reason (`nonInputsUnusable`), under the unchanged `schemaVersion`. A workspace the discovery lists as failed, unsupported or not confirmed neither stops patterns applying nor protects any file. The discovery in effect is the one the lifecycle last gave the tracker: the store's latest discovery before the first reconciliation, then each new discovery before its fingerprint is taken.
- [ ] AC4: When a new discovery in effect changes which files are protected, or stops or starts patterns applying, every file whose declared state flips joins or leaves the inputs before that discovery's fingerprint is taken, a file the tracker never read because a pattern declared it included, and no result reads current until it has. Those reads mark no running job, while any other input event during them still fails the discovery's fingerprint. A file that becomes an input this way and was modified after the discovery's job began fails the discovery's fingerprint, as a newly protected test module does today.
- [ ] AC5: For the same `rt-test.json` and the same discovery in effect, selection and the tracker answer identically, for every root-relative path, whether it is a declared non-input and through which pattern, AC1 to AC3 included. The selection policy version rises to 4, so every result stored under version 3 reads stale once.

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

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every row of Unverified Assumptions first, writing each answer with the source location read.
- [ ] (Support) Before the build begins, confirm the orchestrator has added `picomatch` at exactly `4.0.7` to `@rt-test/daemon`'s `dependencies` and `@types/picomatch` at exactly `4.0.3` to its `devDependencies`, with `bun.lock` (orchestrator-owned; P9, C1: picomatch 4.0.7 declares no peer). The lines, for the orchestrator: `"picomatch": "4.0.7"` and `"@types/picomatch": "4.0.3"`.
- [ ] (AC1, AC2, AC3, AC5) Create `packages/daemon/src/inputs/protection.ts`, the one producer of protection: from the discovery in effect, or none, it returns the protection value both callers take. That value is either "no pattern applies", with the reason sentence (AC3), or the protected files: every test module `discoveredTestModules` lists, every setup and global setup file each discovered workspace's projects report, and each reported project's patterns compiled once. Compile them with picomatch's default export and the options tinyglobby 0.2.17 passes (Dev Notes § Settled facts), leaving `windows` to picomatch's host default as tinyglobby does, and normalize each pattern as tinyglobby's `normalizePattern` does before compiling (a trailing `/` dropped, an absolute pattern made relative to the pattern directory, otherwise `posix.normalize`). A path is protected by a project when its path relative to the project's pattern directory is matched by no `exclude` pattern and by an `include` or `includeSource` one. A workspace that is not `discovered` contributes nothing; a `discovered` one in 2.3b's not-reported state makes the value "no pattern applies". A pattern picomatch refuses to compile (an empty string throws) also makes it "no pattern applies", with a reason naming the project and the pattern, never a throw out of the producer (C30, C126). Name the reason sentences as constants (C3). Keep picomatch out of `non-inputs.ts`, which the client's module graph loads through the start plan: `non-inputs.ts` imports only the value's type.
- [ ] (AC1, AC2, AC3, AC5) In `packages/daemon/src/inputs/non-inputs.ts`, make `declaredNonInputs(declaration, protection)` take the protection value in place of `protectedTestModules`, return no match for any path while no pattern applies, and consult the value's protected files and patterns beside the protected names it checks today, so it stays the one decision both callers make (C8). Rewrite its doc comment to the new protected set (C46).
- [ ] (AC5) In `packages/daemon/src/selection/selection-types.ts`, replace `SelectionNonInputs.protectedTestModules` with the protection value, documented as built by the producer over the discovery the tracker reads, and raise `SELECTION_POLICY_VERSION` to 4. In `select-tests.ts`, pass it to `declaredNonInputs`; `select-tests.ts` holds 489 of its 500 code lines, so keep the change inside the decision call (P16).
- [ ] (AC3, AC4) In `packages/daemon/src/inputs/declared-non-inputs.ts`, make `protect` take the protection value and return the flips it can see: every path the old or new value names by exact path (test modules, setup and global setup files) whose match changed, as 2.1b's `protect` does, and every path the tracker holds whose match changed, and expose the "no pattern applies" reason through `unusable` only while a usable declaration declares at least one pattern, so an absent, empty or unusable declaration carries only what it carries today. Check every reader of `unusable` for the new case, a usable declaration that carries a reason (C39); at drafting its one production reader is `InputTracker.current()`, which passes it to the answers as `nonInputsUnusable` (`rg -n "\.unusable\b" packages/daemon/src`, 23:54). Log the reason at warning level (C32) with `report`'s declaration line while no pattern applies and whenever patterns stop applying, and a line when they apply again; while no pattern applies, that declaration line names the patterns without calling them in effect (C46). Start in the "no pattern applies" state, since no discovery is in effect until the lifecycle gives one, so a stored discovery whose read throws (lifecycle's `#protectStoredTestModules` catch) leaves every file an input rather than applying patterns with nothing protected.
- [ ] (AC3, AC4) In `packages/daemon/src/inputs/input-tracker.ts`, make `TrackedInputs.protectTestModules` build the protection through the producer and flip every path whose declared state changes: the paths the tracker holds, and, whenever any discovered project's patterns or pattern directory changed, a project joined or left the protected set, or patterns stopped applying, every file under the root the new decision makes an input that the tracker never read, which only a walk under the rebuilt filter can find. Read every flipped path without marking a job (the `#quiet` set's rule), keep an event arriving meanwhile marking jobs as it does today, and keep every result from reading current until the flips are read, as queued paths do today. Rename the method to what it now does, and update its doc comment and the class comment (C46, C48). The file holds 477 of its 500 code lines: extract the protection walk by responsibility, beside `declared-non-inputs.ts` or into a module of its own (P16, P18).
- [ ] (AC4) Widen the time check `#protectDiscovered` in `packages/daemon/src/daemon/lifecycle.ts` runs before protection (today `testModuleChangedSince`, `inputs/fingerprint.ts` through `current-inputs.ts`) to every file protection moves into the inputs, not only listed test modules. A file found only by the protection walk is known only during it, so its time is read there, against the discovery job's start, and only after the rebuilt decision governs `namesFile`: an edit then either precedes the read and fails the time check, or follows the rebuild and arrives as an event that marks the job. C160's no-await rule binds the exact-path check before protection; the walk's reads are vouched for by this order instead. Keep no await between a check and the protection step it vouches for (C160), and keep the guard job's verdict as today. Update `#protectStoredTestModules`, `#protectDiscovered` and the class's doc comments to the new names (C46).
- [ ] (Support) Report the exact `docs/architecture.md` and `README.md` text to the orchestrator (orchestrator-owned; C48, C55). Dev Notes § Doc text holds a draft.
- [ ] (Support) Lint and typecheck.

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
- Ticket 2.3b's report types (`vitest/selection-facts.ts`, pending) and its not-reported state on the `discovered` arm of `WorkspaceDiscovery` (`vitest/discover-tests.ts`): the facts this ticket reads. Import them; declare no second shape (C14).
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

The original ticket 2.3 was split into 2.3 to 2.3f (sprint file, after § Ticket 2.3f). 2.3b (ready-for-dev, building now) makes discovery report each discovered workspace's setup files, global setup files and test file patterns per project, and the store keep them; this ticket is the first production reader of those facts. It is written against the tree as it will be once 2.3b lands, and builds after it. It closes two of 2.1b's known limits (a setup file a pattern matches; a new test module a pattern matches). Selection still has no production caller until 2.3e.

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
  - G1: a pattern picomatch refuses makes "no pattern applies" for that discovery, with a reason naming the project and the pattern: "Uncertainty widens and never narrows (AGENTS.md; C126). Name the defect for it." The defect: a refused pattern throws out of the producer, or protects nothing for its project, so a new test module there stays hidden. (AC3)
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
- **Checked forward:** `rg -n "picomatch|tinyglobby|matchesTestGlob"` over `_agent-docs/sprints` and `_agent-docs/tickets` (23:47) matched only the 2.3c sprint line, 2.3b's routing note that 2.3c owns the dependency, and 2.3's split note; no unbuilt ticket changes the package.

#### Design notes

- **The protection value.** One value, built by one producer from the discovery in effect, carries either "no pattern applies" with its reason, or the protected files (test modules, setup and global setup files) and each project's compiled patterns. `declaredNonInputs` consults it; the tracker holds the one it was last given, and selection gets its own copy from 2.3e over the same discovery. Neither caller holds protection logic of its own (C8).
- **Why a walk.** The tracker drops every event naming a declared file before queuing it (`DeclaredNonInputs.namesFile`) and never reads one, so a file a pattern hid is unknown to it. Protection by exact path (test modules, setup files) names its files, as 2.1b's `protect` does. Protection by pattern does not: when a project's patterns or pattern directory change, a project joins or leaves the protected set, or patterns stop applying, only a walk under the rebuilt decision finds every file that now counts. When only exact paths change, or patterns start applying (which only removes files the tracker holds), no walk is needed. In this ticket's world the patterns change at most once after a daemon's first reconciliation, from the stored discovery's to the new discovery's (a refused pattern in either also counts); 2.3f's rediscovery makes it happen repeatedly.
- **Why the time check moves.** A file a pattern hid had no watch through the discovery's job, so an edit to it then went unseen. 2.1b reads each listed test module's modification time before protection moves it (D1988). A file found only by the walk is not known before the walk, so its time is read in the walk, against the job's start.
- **When no pattern applies.** Every file stays an input, so the first reconciliation after a start with no stored discovery, or with one stored before version 3, reads the declared files too. The new discovery then turns patterns on, flipping only files the tracker holds, which need no walk.
- **The reason in answers.** `nonInputsUnusable` reads "why every file stays an input", which holds here too. Its sentence names the cause: no discovery yet, or a discovery that does not report the files patterns may not remove. It appears only while a usable declaration declares at least one pattern, since a declaration that declares nothing has nothing to switch off.
- **Paths outside the pattern directory.** A pattern climbing out with `../` is matched against the path relative to the pattern directory, which then begins with `../` too; the probe shows picomatch matching it, and the tinyglobby spike below shows discovery's glob finding exactly those files. A file outside the consumer root is not an input either way.
- **The pattern directory's case on Windows.** Matching relative to the pattern directory assumes 2.3b reports that directory in its on-disk case, as its task converts each absolute path through the real path, which on Windows yields the on-disk case. A reported directory in another case would make every relative path climb out and match nothing, narrowing protection on Windows only. Re-verify at build start that 2.3b's landed code converts the pattern directory that way (ticket review F8, routed to 2.3b).
- **A pattern that cannot compile.** The producer must still return a value. Treating it as "no pattern applies" keeps every file an input, the widening direction C126 requires ("uncertainty never narrows it"); protecting nothing for that project would narrow (G1). What Vitest's own glob does with such a pattern is unread.
- **Case.** Matching is case-sensitive on every platform, as discovery's glob is. A Windows file whose case differs from the pattern is not protected by that pattern; discovery would not find it either.
- **Known limits:** a project whose `typecheck.include` finds a new typecheck module under a declared pattern (2.3b Q3 leaves those patterns out; a listed typecheck module is still protected by path); a browser-mode project's files (2.3b G1); a new test module under a declared pattern in a workspace that failed, is unsupported or was not confirmed.
- **Unanalyzed:** links under the pattern directory, which tinyglobby follows by default.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3c` over the 15 target paths (23:42) named 2.3b and 2.3f, neither of which writes a file of this ticket's. 2.3d and 2.3e come from the sprint file; 2.3d edits `select-tests.ts` after this ticket lands.

- **2.3b** (ready-for-dev, building): named only by its `packages/daemon` area line and by reads (`non-inputs.ts` for its C38 audit and its reuse of `testModuleFile`; `lifecycle.ts` in its previous-ticket notes). It owns the report, its types and the not-reported state this ticket reads. Route 1: until it lands, the report does not exist; write against it. Re-verify this ticket's type names and the not-reported state's shape against 2.3b's landed code at build start. This ticket reads no alias, so 2.3b's alias shape (its RegExp flags, ruled 23:50) does not bear on it.
- **2.3d** (backlog) edits `select-tests.ts` and raises the policy version again; it builds after this ticket.
- **2.3e** (backlog) fills `SelectionInput`'s protection value from the discovery the tracker reads (Q2).
- **2.3f** (backlog): named by the sprint's split note, which lists the files 2.3, 2.3c and 2.3d share. Its rediscovery is what makes a new test module this ticket keeps as an input a discovered and run one, and makes pattern changes within one daemon life.

#### Sizing

About 17 raw files and 22 estimated on the files this ticket builds, over the 20-file limit; the orchestrator ruled to proceed (Q6). Code units: 6 (5 criteria plus validation). Production: `inputs/protection.ts` (new), the extracted walk (new), `inputs/non-inputs.ts`, `inputs/declared-non-inputs.ts`, `inputs/input-tracker.ts`, `inputs/fingerprint.ts`, `inputs/current-inputs.ts`, `daemon/lifecycle.ts`, `selection/selection-types.ts`, `selection/select-tests.ts`, and `packages/daemon/package.json` (the orchestrator's install). Tests, for create-tests: § Existing tests this change breaks. `docs/architecture.md` and `README.md` are the orchestrator's writes, reported as text. Over 10 estimated, so dev delegates to implementer agents along two groups sharing only the protection value's type: the producer and selection (`protection.ts`, `non-inputs.ts`, `selection-types.ts`, `select-tests.ts`), and the tracker and lifecycle (`declared-non-inputs.ts`, `input-tracker.ts` and its extraction, `fingerprint.ts`, `current-inputs.ts`, `lifecycle.ts`). The second group is one dependency chain.

#### Current structure of the modified files

- `packages/daemon/src/inputs/non-inputs.ts`: `NON_INPUTS_FILE`, `NonInputsDeclaration` (absent, declared with `patterns`, unusable with `reason`), `NonInputMatch`, private `PROTECTED_NAMES`; `readNonInputs`, `sameDeclaration`, `unusableReason`, `declaredNonInputs(declaration, protectedTestModules: ReadonlySet<string>)`, which returns `() => undefined` unless declared with patterns, and otherwise skips `rt-test.json`, `tsconfig*.json` and `jsconfig*.json`, `PROTECTED_NAMES` and `protectedTestModules.has(path)` before matching; `discoveredTestModules`, `workspaceTestModules`, `testModuleFile`. Its runtime imports are `node:fs`, `node:path`, `selection/source-walk.js`, `vitest/error-text.js` and `vitest/find-workspaces.js`, and it is loaded by `start-plan.ts`, which `client.ts` exports.
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
- `input-tracker.test.ts` also calls `testModuleChangedSince` on the current inputs directly, and `lifecycle.test.ts` and `query.test.ts` build `CurrentInputs` stand-ins holding `testModuleChangedSince`: each changes if task 7 changes that member's shape.
- `packages/daemon/test/selection/select-tests.test.ts` reads `SELECTION_POLICY_VERSION` by name, so the raise to 4 breaks no assertion there.
- Not broken, checked: `query.test.ts` D2019 and `packages/cli/test/cli.test.ts` read `nonInputsUnusable` through a stand-in, whose shape Q3 keeps.

#### Doc text

A draft for the orchestrator, final wording to follow the build.

- `docs/architecture.md`, the tracker paragraph: "No pattern removes a `package.json`, [...] or a test module of the latest stored discovery, as `discoveredTestModules` lists them." becomes "No pattern removes a `package.json`, a `pnpm-workspace.yaml`, a lockfile, a Vitest or Vite config file, a `tsconfig*.json` or `jsconfig*.json` file, a test module, setup file or global setup file the discovery in effect lists, or a file a discovered project's `include` or `includeSource` patterns match and its `exclude` patterns do not, matched as Vitest's discovery globs them. While a declaration holds patterns and the discovery in effect is absent or does not report those files for every discovered workspace, no pattern applies, and every answer says why." In the known limits, "a setup file a pattern matches" and "and a new test module a pattern matches, which no discovery lists until the discovery is next stale" are deleted, and "a new test module a pattern matches in a workspace that failed, is unsupported or was not confirmed" is added.
- `README.md`: the protected-files bullet gains "each setup and global setup file of the latest discovery, and every file a workspace's test file patterns match"; the bullet "A setup or global setup file a pattern matches is a non-input, and a new test file a pattern matches is not discovered until the discovery is next stale." becomes "Until the daemon holds a discovery that reports which files the patterns may not remove, no pattern applies: every file stays an input, and every query answer says why."; and the answers bullet's "while `rt-test.json` cannot be used, why every file stays an input" becomes "while `rt-test.json` cannot be used or its patterns cannot yet apply, why every file stays an input".

#### Previous ticket

2.3b (ready-for-dev, building now), the nearest earlier key in the status file. From its Dev Notes, which its shipped code will beat: the report is per project (name, setup files, global setup files, aliases, test file patterns), root-relative and `/`-separated; the root project's global setup is credited to every project of the workspace; browser-mode projects are left out; the `discovered` arm of `WorkspaceDiscovery` gains a required member holding the report or an explicit not-reported state, produced only by the store's read of a discovery from before schema version 3; the patterns come with the directory they match from, the consumer root being `.`. From 2.3 (done): `lifecycle.ts` awaits `inputs.settled()` before each `beginJob`. From 2.1b (done): protection runs before the discovery's fingerprint under a guard job, its reads mark no job, and the unwatched-module time check runs before it (D1987 to D1991).

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

- `_agent-docs/tickets/2-3c-protect-selection-inputs.md` (create-ticket)
- `_agent-docs/sprints/sprint-2-fresh-runs.md` (create-ticket, under the 23:55 grant: § Ticket 2.3c's matcher clause per Q1, FR7 and the ticket link; § Ticket 2.3e's protection sentence per Q2)
- `docs/requirements.md` (orchestrator, 23:55: FR7's marker gains 2.3c)

# Ticket 2.1b: Declared non-inputs

## Ticket

As a consumer running RT Test on a project whose documentation and other unread files change often,
I want to commit a list of the files no test reads, shown to me before I trust a start,
so that editing a README or a design note leaves every result as current as it was and selects no test.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: The consumer declares non-input files in `rt-test.json` at the consumer root, a JSON object whose `nonInputs` member is an array of patterns. A pattern is a root-relative `/`-separated path matched against a file's whole root-relative path: `*` matches any run of characters within one path segment, `?` one character within a segment, and a segment that is exactly `**` matches any number of whole segments, none included. `*`, `?` and `**` match names that begin with a dot. Every other character matches only itself, case included, on Windows and Linux alike. A missing `rt-test.json`, or one with no `nonInputs` member, declares nothing, and members other than `nonInputs` are ignored.
- [x] AC2: A declaration that cannot be used declares nothing, so every file stays an input, and the start plan, the daemon's log and every summary and path status answer (AC8) give the reason. It cannot be used when `rt-test.json` exists but cannot be read or is not valid JSON; when its top level is not an object; when `nonInputs` is not an array of strings; when it holds more patterns than a named bound; or when any pattern is empty, begins with `/`, contains `\`, `[`, `]`, `{`, `}` or `!`, has an empty, `.` or `..` segment, or uses `**` inside a segment rather than as a whole one.
- [x] AC3: Before the trust question, the start plan shows the declaration's root-relative file name and each pattern it declares, or that no `rt-test.json` exists, or the reason it declares nothing (AC2). `rt-test start --json` carries the same under the unchanged `schemaVersion`. Building the plan reads files only and executes nothing.
- [x] AC4: A file is a declared non-input when a declared pattern matches it and it is not protected. `rt-test.json` itself is never a declared non-input; AC6 and AC7 say how it is treated. Protected files stay inputs whatever the patterns: every `package.json`, every `pnpm-workspace.yaml`, every lockfile name selection recognizes, every Vitest or Vite config file name, every tsconfig or jsconfig file name selection reads edges from (`tsconfig*.json`, `jsconfig*.json`), and every test module of a Vitest workspace's latest stored discovery. Selection and the fingerprint answer whether a path is a declared non-input identically for the same declaration and discovery.
- [x] AC5: Adding, editing, deleting or renaming a declared non-input changes no Vitest workspace's fingerprint and no discovery's fingerprint, raises no input revision, and leaves a job running at the time fingerprinted; the log line ticket 2.1's AC3 writes never names it as an input that changed. Renaming an input to a declared name is a deletion of that input, and the reverse an addition.
- [x] AC6: `rt-test.json` is not an input. Adding, editing, deleting or renaming it runs a full reconciliation, with every result reading unknown until it ends as ticket 2.1's AC6 states, which applies the declaration as it then stands: a file it no longer declares becomes an input and a file it newly declares stops being one. Once that reconciliation ends, an edit that leaves the set of declared non-inputs unchanged leaves every result reading as it did before the edit. The daemon logs the patterns in effect, or the reason it declares nothing, after the first reconciliation and after every later one that finds the declaration different from the one in effect before it, whatever started that reconciliation.
- [x] AC7: In a selection, a changed path that is a declared non-input selects nothing, and its path report names no trigger and gives a nothing-selected reason naming `rt-test.json` and a pattern that matches the path. A protected path selects exactly as it does with no declaration. A change to `rt-test.json` is a project-wide broad fallback with its own named trigger. The selection policy version rises.
- [x] AC8: While the declaration in effect in the daemon cannot be used (AC2), every summary and path status answer carries the reason, and `rt-test summary` and `rt-test status` print it; `--json` carries it as a named field under the unchanged `schemaVersion`. While no `rt-test.json` exists, or it is usable, no answer carries a reason.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. Node's `path.matchesGlob` was considered and rejected on a settled fact (Dev Notes § Settled facts); the matcher is this repository's own.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (AC1, AC2, AC4) Create `packages/daemon/src/inputs/non-inputs.ts`: the declaration file name `NON_INPUTS_FILE` (`rt-test.json`) and member name as named constants (C3); a reader that returns the declaration read from the consumer root as one of: no file, the validated patterns, or the reason it declares nothing (AC2), reusing `readJson` and `objectField` from `find-workspaces.ts` (C5, C11); the pattern bound as a named constant beside the reader, `MAX_NON_INPUT_PATTERNS` = 256 (C3, C4), sized against 2.1's `MAX_INVENTORY_ENTRIES` since every file of a full reconciliation is tested against every pattern; a matcher written here over `/`-separated segments, without `path.matchesGlob` (§ Settled facts), whose `**` matching cannot backtrack without bound; and one exported function that decides whether a root-relative path is a declared non-input, returning the pattern that matched, and never a match for `NON_INPUTS_FILE` at the root or for a protected path (every `PACKAGE_JSON`, every `LOCKFILES` name, every Vitest or Vite config file name, each protected test module), given the declaration and the protected test modules, which both selection and the tracker call (AC4, C8). Move `listedTestModules` and `testModuleFile` from `fingerprint.ts` here as one exported `discoveredTestModules(discovery)`, which lists each workspace's test, failed and typecheck modules and is the only producer of the protected test-module set: `fingerprint.ts` and the tracker call it, and 2.3 calls it to fill selection's set (AC4, C8). Keep the module's runtime imports to `node:fs`, `node:path`, `find-workspaces.ts` and `error-text.ts`, and import the discovery type as a type only, since the client's module graph loads it through the start plan.
- [x] (AC4) Move `LOCKFILES` out of `select-tests.ts` to one exported constant that `select-tests.ts` and `non-inputs.ts` both import, beside `PACKAGE_JSON` in `find-workspaces.ts` (C4, C8).
- [x] (AC3) Change `packages/daemon/src/start-plan.ts`: `StartPlan` gains the declaration from the reader, as a named field. Change `packages/cli/src/trust-prompt.ts` `listing` to print it before the executes sentence (the file and each pattern, or none, or a `warning:` line with the reason), and `packages/cli/src/commands/start.ts` `planFields` to carry it in `--json` (C38, C151).
- [x] (AC4, AC5, AC6) Change ticket 2.1's inputs module (`input-filter.ts`, `input-inventory.ts`, `input-tracker.ts`, and `fingerprint.ts` where the workspace-to-inputs seam needs it) and `packages/daemon/src/daemon/lifecycle.ts`: read the declaration at each full reconciliation. Give the tracker (`TrackedInputs`) one method taking a discovery, which sets the protected test modules through `discoveredTestModules`, reads the newly protected paths and drops the newly unprotected ones without a full reconciliation, raising the revision only when that changes the input set. Lifecycle calls it with the store's latest discovery (`store.readLatestResults(scope).discovery`, from an earlier life) before `inputs.start()`, and awaits it after each successful `writeDiscovery`, before the first run's job begins. Leave every declared non-input out of the input set, the revision and a job's changed-inputs judgment, so an event naming only declared non-inputs changes nothing a job or an answer reads. Add an event naming `NON_INPUTS_FILE` at the root to the full-reconciliation triggers, and log the declaration in effect after the first reconciliation and after every later full reconciliation that finds it changed, whatever started it (C32 for the reason), and expose the reason while the declaration in effect cannot be used, for AC8. Extend `InputFilter.excludes` (`input-filter.ts`, the one exclusions list 2.1 left) with the declaration, and put `NON_INPUTS_FILE` at the root on that list, checking the reconciliation trigger for it before the exclusion check in the tracker's event handling, so `rt-test.json` never enters the input set, the revision or a job's changed-inputs judgment (AC6).
- [x] (AC7) Change `packages/daemon/src/selection/selection-types.ts` and `select-tests.ts`: `SelectionInput` gains one required field holding the declaration and the protected test-module set, which 2.3 fills from `discoveredTestModules` over the same discovery the tracker reads; selection derives nothing from its `workspaces`' known tests, which omit failed and typecheck modules; add a `NO_SELECTION` kind for a declared non-input and a `TRIGGER` kind for a change to `NON_INPUTS_FILE`, a project-wide fallback; check every changed path through the shared function before any other trigger, relying on it to return no match for a protected path or `NON_INPUTS_FILE`, so selection holds no protected-path check of its own; raise `SELECTION_POLICY_VERSION` to 3 (C129, C130).
- [x] (AC8) Change `packages/daemon/src/query/answer.ts`, `summary.ts` and `path-status.ts` to carry the tracker's reason as a named field of `AnswerContext`, present only while the declaration cannot be used, beside ticket 2.1's AC8 fields; change `packages/cli/src/answer-text.ts` to print it as a `warning:` line in the human answer, with `--json` carrying it through `answerFields` and `CLI_JSON_SCHEMA_VERSION` unchanged (C38, C151).
- [x] (Support) Document `rt-test.json` in `README.md`'s Start and stop section: its place, its `nonInputs` syntax, the protected files, what a malformed one does, that a change to it reconciles every input, and that it is committed with the project (C7). Replace the Query section's sentence that no result is current until inputs are tracked only if ticket 2.1's sweep has not already.
- [x] (Support) Report the exact `docs/architecture.md` text for the orchestrator (orchestrator-owned; C48, C55): the start plan sentence in § Current implementation names the declaration, and the input tracker's description names declared non-inputs and the protected files.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `readJson`, `objectField`, `PACKAGE_JSON`, `VITEST_CONFIG_FILES`, `VITE_CONFIG_FILES`, `relativePosixPath`, `POSIX_SEPARATOR` (`packages/daemon/src/vitest/find-workspaces.ts`): plain JSON reading without executing anything, and the manifest and config file names AC4 protects. `readJson` returns a read-or-reason result.
- `LOCKFILES` (`packages/daemon/src/selection/select-tests.ts`, private today): the lockfile names AC4 protects, moved to a shared export.
- `normalizeRelativePath` (`packages/daemon/src/selection/graph-state.ts`): the root-relative normalizer selection applies to changed paths, so a change path is matched in the form the tracker stores.
- `errorText` (`packages/daemon/src/vitest/error-text.ts`) for AC2's unreadable-file reason.
- `unreadWarnings`'s `warning:` line shape in `packages/cli/src/trust-prompt.ts` for AC3's reason line.
- Ticket 2.1's inputs module (`packages/daemon/src/inputs/`): the inventory's one exclusions list, the full-reconciliation triggers, the revision, the job judgment and the workspace-to-inputs seam with its AC11 invariant. 2.1 creates them; this ticket extends them.

### Must Create

- `packages/daemon/src/inputs/non-inputs.ts`: the reader, the validator, the matcher and the shared decision.
- `NON_INPUTS_FILE`, the `nonInputs` member name, the pattern bound, and the new `NO_SELECTION` and `TRIGGER` kinds, as named constants.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Ticket 2.1 (ready-for-dev at c6a82b1, dev starting in worktree `wt-1`) creates `packages/daemon/src/inputs/` and wires the tracker into `lifecycle.ts` and `daemon-main.ts`. This ticket is written against the tree as it will be once 2.1 lands, and builds after it. 2.1 counts every file git does not ignore as an input (its AC1), so a README edit stales every result; its Q2 ruling scheduled this ticket for that. Selection (`selectTests`, tickets 2.2 and 2.2b) has no production caller until 2.3; this ticket adds the declaration to `SelectionInput` and 2.3 passes it.

Requirements this ticket delivers (`docs/requirements.md`):

- FR6: "Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current." A declared non-input is an edit the consumer states cannot affect a result (AC1, AC4 to AC6).
- NFR3: "Never report a result as current unless its stored input fingerprint matches the current inputs." (AC5, AC6)
- FR7: "Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts." (AC7)
- FR4: "Start and stop the daemon explicitly for one trusted project, and execute no project code before that start." (AC3)
- FR5: "Answer summary and `status <path>` queries through a CLI with versioned `--json` output, reporting counts per state for files and folders, without starting a test." (AC8)

Clauses the criteria rest on:

- Sprint 2 § Ticket 2.1b: "let the consumer declare files no test reads, such as documentation, in a list committed in the consumer and shown in the start plan. An edit to a declared file then changes no fingerprint and selects nothing, and a change to the list itself reconciles every input." (AC1, AC3, AC5 to AC7)
- Ticket 2.1 AC3: "The daemon stores every discovery and every run bound to the digest of the inputs the job started from. A job during which any input changed, which started before the first reconciliation ended, during which a reconciliation ended unable to establish the input set (AC7), or during which the watcher was unhealthy, is stored not fingerprinted, so none of its results can read current, and the daemon's log names the job and the inputs that changed, or the reason." (AC5)
- Ticket 2.1 AC6: "A full reconciliation runs, and every result not stale under another adapter version reads unknown until it ends, at start, when the watcher reports an error or lost events, when HEAD or the ref it names moves (a checkout, reset, rebase, pull or commit), when a file git reads ignore rules from changes, and every `RECONCILE_INTERVAL_MS` (5 minutes) while the daemon runs." (AC6)
- Ticket 2.1 AC11: "A Vitest workspace's inputs always include each of its own test modules, whatever narrowing replaces the whole-project input set." A declaration is such a narrowing, so test modules are protected (AC4).
- AGENTS.md § Product guarantees: "Never report historical results as current after a relevant edit or unresolved input change." "Explain each selection and each broad fallback." "Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states. A zero-test selection is not proof of success." (AC2, AC4, AC7)
- P41: "Write runtime state and logs only under the configured local state directory, `.rt-test/` by default [...] The consumer excludes that directory from version control." So the committed list cannot live in `.rt-test/`, and sits at the root (AC1).
- C126: "An unresolved import, dynamic import, generated file, framework registry or adapter gap widens the affected selection; uncertainty never narrows it." A declaration is the consumer's stated fact, not an uncertainty, and a declaration that cannot be used narrows nothing (AC2).
- C129: "Each selected test carries its reason, and each broad fallback names the input or uncertainty that triggered it." (AC7)
- C151: "Every `--json` payload carries a schema version, and a breaking field change bumps it." AC3's field is additive, so the version stays.
- Glossary: **Input** "A file whose edit RT Test treats as able to change a test's result." **Input fingerprint** "A digest of every input that can change a test's result." **Reconciliation** "Reading every input again to establish the current input fingerprints, without relying on change events." **Broad fallback** "A widening to a whole workspace or project, named with the input that triggered it."

#### Owner rulings and grill record

The questions went to the orchestrator at about 11:08 on 2026-09-27 (crew.md § Questions), with the sizing question and the Q2 correction at about 11:10.

- Q1 Declaration file, owner ruling at 11:10; format by the orchestrator at 11:11. A general RT Test settings file at the consumer root, `rt-test.json`, holding `nonInputs` now and later settings such as FR12's defect location. Plain JSON with no comments, so the CLI's start plan never loads `oxc-parser`, which the JSONC reader uses. The matcher is this repository's own code with no new dependency: `*`, `**` and `?` only, root-relative `/` patterns, case-sensitive on every platform, dot-names matched as gitignore matches them (AC1).
- Q2 Guard rails, owner ruling at 11:10; scope corrected by create-ticket at about 11:10 and accepted by the orchestrator at 11:13. A declared pattern never removes a protected file from the inputs or from selection, and the lists come from the code that already keeps them (selection's lockfile names, the config file names). 2.1b protects every `package.json`, every lockfile, every Vitest or Vite config file name, each test module of the latest stored discovery, and a pattern never makes `rt-test.json` itself a declared non-input (nor is it an input: AC4, AC6). The owner's ruling also names setup and global setup files: those join in 2.3, whose sprint scope the orchestrator amended to say so, citing this ticket's AC4. The tracker cannot know them before 2.3's discovery reports them, and protecting them in selection alone would let selection and the fingerprint disagree. This weakens the ruling for no user: selection has no production caller until 2.3, and the Fleet Cooling trial follows the whole milestone, 2.3 included (AC4).
- Q3 An unusable list, orchestrator at 11:11. A missing file declares nothing, with no warning. An unreadable or malformed list declares nothing at all, so every file stays an input, and the start plan, the log and every summary and status answer name the reason, as 2.1's AC7 does for git: AGENTS.md requires explaining each broad fallback, and a silently dropped list would read as RT Test ignoring the consumer's declarations (AC2, AC8).
- Q4 A live list, orchestrator at 11:11. Accepted as proposed: the daemon reads the list live, a change to it reconciles every input, and `rt-test.json` is not itself an input. The start plan shows the list as read at start, so the log line for a later change gives the new patterns (AC6).
- Q5 Policy version, orchestrator at 11:11. `SELECTION_POLICY_VERSION` goes from 2 to 3; results stored under 2 read stale once, since the policy version is part of 2.1's fingerprint (AC7).
- Q6 Sequencing, orchestrator at 11:11. This ticket builds after 2.1 lands; 2.3 passes selection's new required field.
- Sizing, orchestrator at 11:13: proceed as-is, no split (§ Sizing).

Ticket review (create-ticket Step 6c, about 11:17), 12 findings, all applied: `rt-test.json` put on the inventory's exclusions list; the shared decision never matches `rt-test.json` or a protected path, and selection holds no protected-path check of its own; the tracker refreshes its protected test modules when a stored discovery changes them; the Q2 record's wording of `rt-test.json`; the declaration logged after any reconciliation that finds it changed, whatever started it; the count beside the sizing list; the broken-tests search stated; a new test module under a declared pattern named a known limit; an unchanged-set edit to `rt-test.json` over-selecting noted; the groups' shared parts; 2.1's AC3 and AC6 quoted.

Dev sanity check (rt-t2-1b-dev, 15:22), against the tree with 2.1 landed at 9e95c94, all three confirmed by create-ticket at 15:23: F1, one producer of the protected test-module set, `discoveredTestModules`, since 2.1's fingerprint also lists failed and typecheck modules, which selection's tests omit; F2, `input-filter.ts` holds the exclusions and lifecycle feeds the tracker each discovery, so both files join; F3, `MAX_NON_INPUT_PATTERNS` = 256.

Dev adversarial review F2 (rt-t2-1b-dev, asked 15:49), orchestrator ruling at 15:49: swap the order sanity F2 recorded. After the discovery's job ends, lifecycle awaits `protectTestModules(discovery)` first, then computes the bindings and writes, so the discovery no longer reads stale once protection moves a covered module into the inputs. Condition, from the same ruling: protection must not count as an input change against the discovery's own job. Built so: the unwatched-module time check runs before protection, a guard job window spans protection, and the reads protection queues mark no job unless an event names the same path.

Tests session question on review F1 (rt-t2-1b-tests), orchestrator ruling at 16:03: the `rt-test.json` trigger and `InputFilter.excludes` folded case only through the host's `node:path`, so the case-variant defect could be proven on a Windows host alone. Built so, at 16:04: `liesInsideOnHost` in `inputs/input-filter.ts` chooses `path.win32` or `path.posix` by `process.platform` at call time, as `vitest-edges.ts` does for D1365, and both the exclusions and the tracker's trigger compare through it. `find-workspaces.ts` `liesInside` and its other callers are unchanged, so behavior on a real host is the same.

Review question (rt-t2-1b-review, asked 17:21), orchestrator ruling at 17:21 under the owner's 11:10 guard-rail aim ("a careless broad entry such as 'all .json files' then can't make a result look up to date after a real change"): `pnpm-workspace.yaml` and every tsconfig or jsconfig file join AC4's protected names, reusing the names the code keeps: `PNPM_WORKSPACE_FILE` (`vitest/find-workspaces.ts`) and `CONFIG_FILE_NAME` (`selection/source-walk.ts`, `/^(?:ts|js)config.*\.json$/`), both now exported. A file an `extends` chain reaches under another name is resolved by path, not by name, so it is not protected by name (§ Known limits).

#### Settled facts

- **Node's glob matcher differs across the supported versions.** Node v22.13.0's `lib/path.js` `glob()` (behind `path.matchesGlob`) calls `emitExperimentalWarning('glob')` on every call and passes minimatch `nocase: isMacOS || isWindows` (read from `https://raw.githubusercontent.com/nodejs/node/v22.13.0/lib/path.js`, lines 167 to 181). On Node 24.19.0 on this Windows machine, `path.win32.matchesGlob('Docs/x.md', 'docs/**')` printed `false`. So the same pattern would match a file on Windows under Node 22 and not under Node 24, and every match under Node 22 writes a warning. The ticket writes its own matcher (NFR5, P13).
- **Existing selection behavior this ticket changes.** A root-owned path while another package workspace exists is a project-wide `root-owned-path` fallback (ticket 2.2 AC5 and its R4: "Until it excludes non-inputs, a root `README.md` edit selecting every workspace (AC5) is expected behavior"). A declared `README.md` now selects nothing (AC7).

#### Design notes

- **Why the list file is not an input.** Its effect reaches every fingerprint through the input set it leaves: a changed set changes each workspace's digest, since 2.1 digests the sorted `(path, content digest)` list. Were the file an input too, a reformatting edit would stale everything for no change in what tests read. Any edit that does change the set stales every result once, because every workspace's fingerprint covers the whole project's inputs until 2.3 narrows it.
- **Why a change to it is a project-wide fallback in selection.** It can change every workspace's inputs, so the results it stales must be reselected, or staleness and selection disagree (sprint § Ticket 2.3: "so staleness and selection never disagree"). An edit that leaves the declared set unchanged still selects every workspace while staling nothing, since selection does not compare declarations; that over-selects and never misses, and 2.3's rule never to re-execute a test holding a current result keeps it from rerunning anything. The orchestrator ruled at 11:25 that this is allowed: "staleness and selection never disagree" forbids selecting less than what went stale, never selecting more, and the fallback is an explained broad fallback (review F10).
- **One decision, two callers.** Selection and the tracker call one function in `non-inputs.ts` with the same declaration and the same protected test modules (AC4, C8). Both take the protected test modules from `discoveredTestModules(discovery)` (each workspace's test, failed and typecheck modules, as 2.1's fingerprint lists them): the tracker over the discovery lifecycle hands it, selection over the set its caller passes in `SelectionInput`, which 2.3 fills from the same discovery. Selection's own `WorkspaceTests` holds only identified tests, so it would miss a module whose collection failed, which is the edit that fixes it (sanity check F1, 15:22).
- **Protected test modules and the first discovery.** The tracker learns test modules from a discovery: the store's latest before the first reconciliation, then each new one, which lifecycle protects before taking that discovery's fingerprint. So the stored digest already counts every module the discovery protects, and the discovery reads current. The time check for modules no watch covers runs before protection moves them into the inputs, since a declared module's edits during the job were dropped; protection's own reads mark no job, and any other input event during them fails the discovery's fingerprint. A write that fails leaves the unstored discovery's modules protected, which errs toward more inputs until the next stored discovery. A new test module a pattern matches changes no discovery fingerprint (AC5), so no discovery lists it until something else stales discovery, and it goes unrun meanwhile (a known limit below, which 2.3 closes).
- **Setup files are protected from 2.3 on.** The tracker does not know a workspace's setup files until 2.3's discovery reports them, and protecting them in selection alone would break AC4's agreement. 2.3 adds each workspace's setup and global setup files to the protected set (sprint § Ticket 2.3, citing AC4 here; Q2).
- **Known limits:** a config an `extends` chain names whose file name does not match `tsconfig*.json` or `jsconfig*.json` is a declared non-input when a pattern matches it (review, 17:21 ruling); until 2.3 lands, a setup or global setup file a declared pattern matches is a declared non-input, so its edit stales nothing (Q2); a declared file that a test does read, which is the consumer's error, lets a result read current after an edit that changed it; until 2.3 lands, a new test module added under a declared pattern starts no rediscovery, so it goes undiscovered and unrun until something else stales the discovery. 2.3 closes it: every file matching a workspace's test include patterns, as discovery reports them, joins the files a declared pattern cannot remove, as the setup files do (sprint § Ticket 2.3; orchestrator, 11:25, review F9; `docs/plan.md` requires a new test to be discovered without a prior edge).
- **Case.** Matching is exact on every platform, so on Windows a pattern `docs/**` does not match `Docs/x.md` and that file stays an input: the safe direction.
- **Validation is all or nothing.** One unusable pattern makes the whole declaration unusable (AC2), so a typo never half-applies a list; every file stays an input until it is fixed.
- **The daemon reads the list live.** The start plan shows the list as read at plan time; the daemon reads it at every full reconciliation, so a later edit takes effect without a restart, logged (AC6). Declaring a file a non-input never executes anything, so a list the user did not see at start cannot run code; it can only make an edit read as irrelevant, which the log records.
- **Selection order.** Check the declaration first, since a declared `README.md` at the root would otherwise also raise `root-owned-path`. A protected path skips the check and gets its usual triggers.
- **Unanalyzed:** hard links and case-variant spellings on Windows.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.1b` over the target files and folders named ticket 2.1 (ready-for-dev) and ticket 2.3 (backlog).

- **2.1** creates the inputs module, the tracker wiring and the answer fields this ticket extends; builds first, sequential, not a collision. 2.1 leaves the inventory's exclusions one list 2.1b extends (its § Pending siblings).
- **2.3** passes the declaration into `SelectionInput` when it wires selection, narrows each workspace's inputs (the narrowing keeps 2.1 AC11's test modules and this ticket's protected files), and reports setup files and each workspace's test include patterns, whose matching files it adds to AC4's protected set.
- **2.4** and **2.5** read the revision and freshness; a declared non-input moves neither.

#### Sizing

About 25 raw files, 33 estimated, and 9 code units (8 criteria plus validation); the dev sanity check (15:22) added `input-filter.ts` and `lifecycle.ts`. Production: `non-inputs.ts` to create, and to modify (`start-plan.ts`, `trust-prompt.ts`, `commands/start.ts`, `find-workspaces.ts`, `selection-types.ts`, `select-tests.ts`, `input-filter.ts`, `lifecycle.ts`, `input-inventory.ts`, `input-tracker.ts`, `fingerprint.ts`, `answer.ts`, `summary.ts`, `path-status.ts`, `answer-text.ts`, `README.md`); `docs/architecture.md` is reported text. Tests, for create-tests: `packages/daemon/test/selection/select-tests.test.ts`, `selection/harness.ts`, `selection/defects.json`, 2.1's inputs test file, `packages/daemon/test/query.test.ts`, `packages/daemon/test/defects.json`, `packages/cli/test/cli.test.ts` and `packages/cli/test/defects.json`. The work splits into four groups sharing `non-inputs.ts` and the moved `LOCKFILES`, with the answers group reading the reason the tracker exposes: the start plan and CLI start; selection; the tracker; the answers and their CLI text. The estimate is over 20. The orchestrator ruled at 11:13 to proceed with no split, since a split would let the tracker and selection disagree on what a declared file is, and 1.4 and 2.1 proceeded at a similar size. Implementation is delegated to implementer agents, since the estimate is over 10.

#### Current structure of the modified files

- `packages/daemon/src/start-plan.ts`: `StartPlan` `{ start: ConfirmedStart, stateDirectory, notRead }`; `startPlan(consumerRoot, stateDirectory?)` reads files only and returns it; exported through `packages/daemon/src/client.ts` (`export { startPlan, type StartPlan }`).
- `packages/cli/src/trust-prompt.ts`: `listing(plan)` prints the consumer root, the state directory, each workspace with its config file, `EXECUTES_SENTENCE`, then `unreadWarnings(plan)`, whose lines read `warning: <source> was not read: <reason>`.
- `packages/cli/src/commands/start.ts`: `planFields(plan)` returns `{ consumerRoot, stateDirectory, workspaces, notRead }` for `--json` on success and on failure.
- `packages/daemon/src/selection/selection-types.ts`: `SELECTION_POLICY_VERSION = 2`; `TRIGGER`, `NO_SELECTION` and `SelectionInput` `{ change, dependencies, workspaces, notRunnable, vitestListingNotRead }`; `ChangedPathReport.nothingSelected` `{ kind: NoSelectionKind, detail }`.
- `packages/daemon/src/selection/select-tests.ts`: private `LOCKFILES`; `selectForPath` builds `pathTriggers` (project-wide kinds from `projectWideKinds`, then workspace config, setup files and the plain `changed-path`) and `pathReport`, whose `nothingSelectedReason` returns `only-not-runnable` or `no-dependent-vitest-workspace`.
- `packages/daemon/src/vitest/find-workspaces.ts`: exports `PACKAGE_JSON`, `VITEST_CONFIG_FILES`, `VITE_CONFIG_FILES`, `readJson`, `objectField`.
- `packages/daemon/src/inputs/*`, and `answer.ts`, `summary.ts`, `path-status.ts` and `answer-text.ts` as 2.1 leaves them: read their final shape when 2.1 lands. Today `AnswerContext` is `{ consumerRoot, currentAdapterVersion, discovery, activity, unstoredJobs }` and `answerFields` spreads the answer into `--json` minus the protocol's own fields; 2.1's AC8 adds its fields beside them.

#### Existing tests this change breaks

Found by `rg -l` over `packages/*/test` (no untracked test files at 11:17) for `StartPlan`, `startPlan(`, `SelectionInput`, `AnswerContext`, `LOCKFILES`, `SELECTION_POLICY_VERSION`, `planFields`, `summaryAnswer` and `pathStatusAnswer`, which matched `cli.test.ts`, `query.test.ts`, `select-tests.test.ts` and the three `defects.json` files; the selection harness builds `SelectionInput` by field.

- `packages/cli/test/cli.test.ts`: the `StartPlan` literal near its "listing" tests lacks the new field; D1711 and its neighbours read the listing text.
- `packages/daemon/test/selection/harness.ts`: builds `SelectionInput` without the declaration. `select-tests.test.ts` asserts `policyVersion` against `SELECTION_POLICY_VERSION` (unaffected by the value) and root-owned `README.md` fallbacks (unaffected without a declaration).
- `packages/daemon/test/selection/defects.json`: any record whose `old` anchors on `LOCKFILES` in `select-tests.ts` loses its anchor when it moves.
- `packages/daemon/test/query.test.ts` and `packages/cli/test/cli.test.ts`, wherever they build an answer context without AC8's field.
- 2.1's tests and `packages/daemon/test/defects.json`, wherever they build the tracker without a declaration. Unanalyzed until 2.1 lands.

#### Previous ticket

2.1 (ready-for-dev), the nearest earlier key in the status file, not yet built: its Dev Notes are its design, and its shipped code will beat them. From 2.1: the inventory's exclusions are one list; a full reconciliation runs on start, watcher loss, HEAD moves, ignore-rule changes and every `RECONCILE_INTERVAL_MS`; a job is stored not fingerprinted when any event named an input during it; the workspace-to-inputs seam keeps each workspace's test modules (AC11). From 2.2 and 2.2b: selection is pure over `SelectionInput`, every trigger and reason kind is a named constant, and the policy version is part of 2.1's fingerprint.

### References

- Ticket 2.1 (`_agent-docs/tickets/2-1-track-inputs.md`) § Owner rulings Q1 and Q2, § Design notes "A test that writes into the consumer's tree", § Pending siblings.
- Ticket 2.2 (`_agent-docs/tickets/2-2-workspace-selection.md`) AC5 and R4.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete`.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C5,C7,C8,C11,C14,C22,C28,C30,C32,C38,C48,C55,C59,C113,C115,C117,C126,C127,C129,C130,C140,C151,C152 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P16,P17,P18,P19,P21,P31,P41 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area:
  - packages/daemon
  - packages/cli
is_consolidation: false
sizing_ac_count: 9
files_to_modify:
  - packages/daemon/src/start-plan.ts
  - packages/daemon/src/vitest/find-workspaces.ts
  - packages/daemon/src/selection/selection-types.ts
  - packages/daemon/src/selection/select-tests.ts
  - packages/daemon/src/inputs/input-filter.ts
  - packages/daemon/src/inputs/input-inventory.ts
  - packages/daemon/src/inputs/input-tracker.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/inputs/fingerprint.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/query/summary.ts
  - packages/daemon/src/query/path-status.ts
  - packages/cli/src/trust-prompt.ts
  - packages/cli/src/commands/start.ts
  - packages/cli/src/answer-text.ts
  - README.md
files_to_create:
  - packages/daemon/src/inputs/non-inputs.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 364fbfa9-3997-4f07-aa68-2370bf80e4f4

#### Test Files This Change Broke

- `packages/cli/test/cli.test.ts`: the `StartPlan` literal near line 234 lacks the required `nonInputs` field (TS2741). The listing now prints a non-inputs line before the executes sentence, so listing assertions that read line positions may move.
- `packages/daemon/test/lifecycle.test.ts`: `StandInInputs` does not implement `TrackedInputs.protectTestModules` (TS2420 at 275, TS2741 at 354). Lifecycle now calls it before `inputs.start()` and, around a guard job, before fingerprinting the discovery.
- `packages/daemon/test/selection/harness.ts`: builds `SelectionInput` without the required `nonInputs` field (TS2741 at 155).
- `packages/daemon/test/defects.json`: anchors that no longer match. D1825 (`testModuleFile` moved to `inputs/non-inputs.ts`); D1879 (the discovery's changed-module check moved from the bindings closure to `#protectDiscovered` in `lifecycle.ts`); D1888 (`this.#state.set(relative, entry.digest)` is now `this.#state.set(relative, digest)` in `#readFile`); D1907 (`RECONCILE_INTERVAL_MS` moved to `inputs/reconcile-schedule.ts`); D1960 (`this.#reportGitUnread(filter)` is now `this.#git.report(filter)`); D1962 (the retry delay moved to `inputs/reconcile-schedule.ts`).
- `packages/daemon/test/selection/defects.json`: D1393 anchors on `"bun.lockb",` in `select-tests.ts`; `LOCKFILES` moved to `vitest/find-workspaces.ts`.
- Any test reading `SELECTION_POLICY_VERSION` as 2, or asserting the daemon log's exact lines at a reconciliation's end: the tracker now logs the declaration in effect after the first reconciliation.

#### ACs Owed a Test

None.

#### Tests Owed

- Lifecycle order (orchestrator ruling 15:49): with `rt-test.json` declaring `src/**` and a discovery listing `src/a.test.ts`, the stored discovery reads current once the start sequence ends (discovery freshness `current`). The defect: protecting after the fingerprint, which makes the discovery read stale.
- The guard around protection: a job window opened before `protectTestModules` and closed after it stays fingerprinted when only the flipped paths are read (defect: protection's reads marking the job), and goes not fingerprinted when an event names another input during it.
- A newly protected module edited during the discovery's job, while it was still declared, fails the discovery's fingerprint (defect: the unwatched-module time check taken after protection, which then skips the module).
- On Windows, an event naming the declaration file in another case (`RT-Test.json`) starts a full reconciliation (defect: comparing the event path to `rt-test.json` exactly, which the case-insensitive exclusion then drops).
- A path vanishing between `readNonInputs`' existence check and its read declares nothing silently rather than as unusable.

### Tests Record

Tests session: threadId caeb761d-f7e2-464c-8492-d3c6d41075ad

#### Named Defects

- D1987: The discovery's fingerprint is taken before its test modules are protected, so a module a declared pattern covered is missing from the stored digest and the discovery reads unknown or stale from then on. (AC5)
- D1988: The check for test modules no watch covered runs after protection has moved them into the inputs, so a declared module edited during the discovery's job is skipped and the discovery is stored under a digest. (AC5)
- D1989: The verdict of the job window around protection is dropped, so an input event while the discovery's test modules are protected leaves the discovery stored under a digest. (AC5)
- D1990: The start sequence never protects the test modules of the discovery an earlier life stored, so the first reconciliation leaves a declared test module out of the inputs. (AC4)
- D1991: Protection's own reads of the paths it moves into the inputs are recorded against every open job, so the discovery's guard window is never fingerprinted. (AC5)
- D1992: A file read after it became a declared non-input is kept in the input set, so a test module the next discovery no longer lists stays an input. (AC4)
- D1993: An event naming rt-test.json starts no reconciliation, so a new or deleted declaration is not applied until something else reconciles. (AC6)
- D1994: rt-test.json is not on the tracker's exclusions, so it is itself an input and a reformatting edit that declares the same patterns changes every fingerprint. (AC6)
- D1995: A reconciliation never reads rt-test.json, so a declared file stays an input and its edit changes the fingerprint. (AC5)
- D1996: The inventory keeps declared files among the inputs a reconciliation reads. (AC5)
- D1997: The declaration is logged after every reconciliation, not only after one that finds it different from the one in effect. (AC6)
- D1998: The current inputs drop the reason an unusable rt-test.json declares nothing, so no answer can carry it. (AC8)
- D1999: An rt-test.json deleted between the existence check and the read is reported as unusable, with a reason, rather than as absent. (AC1)
- D2000: ? matches only a literal question mark, so a pattern using it matches no file. (AC1)
- D2001: A pattern's plain segment matches a path segment in any case, so docs/** makes Docs/a.md a declared non-input. (AC1)
- D2002: A segment that is exactly * matches any number of segments, as ** does, so docs/* declares files in docs' subdirectories. (AC1)
- D2003: The pattern bound refuses a declaration holding exactly 256 patterns. (AC2)
- D2004: A pattern with a .. segment is accepted. (AC2)
- D2005: A pattern using ** inside a segment is accepted. (AC2)
- D2006: A pattern beginning with ! is accepted, and reads as a plain name rather than the negation a consumer may mean. (AC2)
- D2007: A nonInputs array holding a non-string is not refused, so reading the declaration throws rather than declaring nothing with the reason. (AC2)
- D2021: An rt-test.json whose top level is an array is read as an object declaring no pattern, rather than as unusable. (AC2)
- D2008: The tracker compares an event's path to rt-test.json exactly, while the exclusion folds case on Windows, so an event naming RT-Test.json is dropped with no reconciliation. Proven under `onPlatform("win32")` through the `liesInsideOnHost` seam. (AC6)
- D2009: Selection never consults the declaration, so a declared root README.md is a root-owned-path fallback selecting every Vitest workspace. (AC7)
- D2010: A test module the discovery lists is not protected, so a declared pattern covering it lets its edit select nothing. (AC4)
- D2011: Manifests, lockfiles and Vitest or Vite config files are not protected, so a declared pattern covering them turns their project-wide fallbacks into nothing selected. (AC4)
- D2012: A change to rt-test.json raises no trigger of its own, so the results a changed declaration stales are not reselected by an explained fallback. (AC7)
- D2013: A declared pattern can make rt-test.json itself a declared non-input, so a change to it selects nothing. (AC4)
- D2014: The selection policy version stays at 2, so results stored under the earlier selection rules are not staled once. (AC7)
- D2015: The start listing leaves out the declaration, so the consumer trusts a start without seeing which files it declares no test reads. (AC3)
- D2016: start --json leaves out the declaration. (AC3)
- D2017: The start listing says nothing when rt-test.json cannot be used, so a consumer trusts a start believing their declaration applies. (AC3)
- D2018: A human summary or status never prints why the daemon's rt-test.json cannot be used. (AC8)
- D2019: A summary and a path status drop the reason the daemon's rt-test.json cannot be used, so a consumer reads every declared file staling results with no explanation. (AC8)
- D2040 (G1): An rt-test.json saved with a UTF-8 byte-order mark is read as not valid JSON, so it declares nothing and every declared file stays an input. (AC1)
- D2041 (G2): The listing prints a pattern bare, so a pattern with a trailing space reads exactly as the pattern without it. The row's `"docs/** "` is itself refused by AC2, so the test uses `"docs/a.md "`. (AC3)
- D2042 (G3): With no rt-test.json the listing says nothing about non-inputs, though the start plan must say none exists. (AC3)
- D2043 (G4): An rt-test.json declaring no pattern leaves no non-inputs line in the listing. (AC3)
- D2044 (G5): Once an unusable rt-test.json is fixed and a reconciliation ends, the declaration in effect stays the unusable one, so answers still carry the old reason. (AC8)
- D2045 (G6): Vite config names are not protected, so a declared vite.config.ts selects nothing. (AC4)
- D2046 (G7): pnpm-workspace.yaml is not protected, so a pattern such as \*.yaml makes an edit to the workspace list select nothing. (AC4)
- D2047 (G8): A tsconfig\*.json file is not protected, so \*\*/\*.json makes an edit that changes import resolution a declared non-input. (AC4)
- D2048 (G9): A jsconfig\*.json file is not protected, so \*\*/\*.json makes it a declared non-input. (AC4)
- D2049 (G10): A trailing \*\* or \* fails to match nothing at the end, so docs/\*\* does not declare a file named docs and README\* does not declare README. (AC1)
- D2050 (G11): An event for a new directory a declared pattern matches is dropped, so on Linux a package.json created inside it is never watched or read. Proven under `onPlatform("linux")` over the inotify model, since Windows' recursive watch reports the file itself. (AC4, AC5)
- D2051 (G12): An event for a known directory a declared pattern matches is dropped, so moving a directory holding a package.json out of the root leaves that input in the set. (AC4)
- D2052 (G13): A throwing read of the earlier life's stored discovery escapes begin, so the daemon never runs its start sequence.

D2015 re-pinned to the JSON-quoted pattern the review's G2 change prints. D2053 and D2054 retired unused (17:30). Proof: `bun run test:defects:changed`, 17:33:51 to 17:42:10, exit 0, 789 of 789 selected defects detected (D2040 to D2052, D2015, D1988 and D1767 among them), baseline green before and after (logs/defects-changed-3.log).

Repaired and re-anchored: D1877's scripted verdicts gain the guard job's verdict (stale: the discovery now opens a job window around protection). D1825, D1879, D1888, D1907, D1960, D1962 (`packages/daemon/test/defects.json`) and D1393 (`packages/daemon/test/selection/defects.json`) re-anchored where 2.1b moved their lines; D1879's mutation now drops the unwatched-module verdict in `#protectDiscovered`.

#### Deliberately Untested

- `packages/daemon/src/inputs/non-inputs.ts` `patternProblem`, the leading-`/` check: inert. A pattern beginning with `/` has an empty first segment, which the segment check refuses, so only the reason's wording would change.
- `packages/daemon/src/inputs/non-inputs.ts` `patternProblem`, the empty-pattern check: inert for the same reason, since `""` is one empty segment.
- `packages/daemon/src/inputs/non-inputs.ts` `FORBIDDEN_CHARACTERS` and `INVALID_SEGMENTS`, their other entries (`\`, `[`, `]`, `{`, `}`, and the empty and `.` segments): each is one more entry of a list whose use D2006 and D2004 prove.
- `packages/daemon/src/inputs/non-inputs.ts`, dot-names (AC1): the matcher has no branch for a leading dot, so no mutation could remove one; the defect would be adding one.
- `packages/daemon/src/inputs/non-inputs.ts`, members other than `nonInputs` (AC1): no code reads another member.
- `packages/daemon/src/inputs/input-tracker.ts` `protectTestModules`, keeping an event already queued for a flipped path: the event and the protection must fall in one turn of the tracker's queue, which a test cannot order through the file system.
- AC5's renames: the tracker sees a rename as a removal and an addition, each on the paths D1995 and D1993 prove; neither has a branch of its own.
- AC4's agreement between selection and the fingerprint: both call `declaredNonInputs`; D2010, D2011 and D2013 prove it in selection, and D1990, D1992 and D1996 in the tracker.
- `packages/cli/src/answer-text.ts` `answerFields`, `--json` carrying `nonInputsUnusable`: it spreads the whole answer and holds no code for the field; D1944 guards the spread.

Questions, all to the orchestrator: a heavy slot for the Step 3 related run (asked 15:59, granted 15:59); more defect ids (asked 16:02, D2002 to D2021 allocated 16:02); F1 has no platform seam, since the trigger and the exclusion fold case only through the host's `node:path` (asked 16:03, orchestrator ruled at 16:03 that dev adds a shared seam; rt-t2-1b-dev built `liesInsideOnHost` in `input-filter.ts` at 16:04); a slot for the full `test:defects` (asked 16:14, granted 16:14). Orchestrator, 16:24: D1988's first fix, a 500 ms hold, is refused; hold on an observable instead, which the sentinel-event hold does (accepted 16:25). D2020 retired unused (16:24).

Proof runs: full `bun run test:defects`, 16:15:08 to 16:23:16, exit 1, 1393 of 1394 detected, D1988 survived (logs/defects-1.log). `bun run test:defects:changed` after D1988's sentinel-event hold, 16:26:01 to 16:32:38, exit 1, 775 of 776 selected defects detected, D1988 survived again ("exit 0; passed 1"), so D1988 is still unproven (logs/defects-changed-1.log, under `_agent-docs/.scratch/2-1b-tests/`).

D1988 diagnosis (16:42, after the harness resume): the edit set the module's access time ahead, so protection's read updated it and Windows raised a change event on the newly protected path, which marked the guard job and masked the mutant. D1988's edit now moves only the modification time; a probe replaying the mutant's order showed only the time check before protection catching the edit, 3 runs of 3. `bun run test:defects:changed`, 16:52:34 to 16:58:56, exit 1: 775 of 776 selected defects detected, D1988 detected. The one failure is D1767 (not this lane's test; `startDaemon`'s acceptance in `client.ts`), whose mutated run ended "exit 1; passed 0; failed: none", a run failure rather than a detection; D1767 was detected in both earlier runs (logs/defects-changed-2.log). Its failure line carries no stderr or stdout, since the verifier's `detectionProblem` verdict attaches no output evidence, so the log names no cause. Orchestrator ruling, 17:00: a change-request lane adds `outputEvidence(run)` to that verdict; once it is in wt-1, this session re-runs D1767 to capture the evidence, and 2.1b does not land until it is read. Evidence pointing at `lifecycle.ts` or the tracker returns to this lane and dev.

### Review Record

Review session: threadId 5f4e4dbd-b0bd-4b93-933e-9b20b55e264b

Review fixes (17:22 to 17:24): `readJson` strips a leading UTF-8 byte-order mark (`vitest/find-workspaces.ts`); the start listing prints each pattern JSON-quoted, as the log and the unusable reason do (`trust-prompt.ts`); `pnpm-workspace.yaml` and every tsconfig or jsconfig file are protected (17:21 ruling; `non-inputs.ts`, with `PNPM_WORKSPACE_FILE` and `CONFIG_FILE_NAME` exported); `MAX_NON_INPUT_PATTERNS` and `NON_INPUTS_DECLARED` are no longer exported, since nothing imports them; three comments reworded (`input-filter.ts`, `input-tracker.ts`).

Tech debt, undisposed:

- `readJson` (`vitest/find-workspaces.ts`) prefixes every failure with `cannot read:`, so a JSON syntax error in `rt-test.json` reads "it is not readable JSON (cannot read: Unexpected token ...)" in the start listing, the log and every answer, blurring AC2's unreadable and not-valid-JSON causes. Pre-existing in `readJson`, which the workspace listing also uses.
- `RECONCILE_INTERVAL_MS` (`inputs/reconcile-schedule.ts`) is exported and nothing imports it; moved as-is from `input-tracker.ts`, and D1907 anchors on the `export` line.
- `BYTE_ORDER_MARK` is declared three times: `selection/jsonc.ts` (`String.fromCodePoint(0xfeff)`), `vitest/config-loader.ts` and `vitest/find-workspaces.ts` (the review's copy for `readJson`; both of the last hold the character as an invisible literal, which the save formatter writes for `﻿`). One exported constant in `find-workspaces.ts`, written as `String.fromCodePoint(0xfeff)`, would serve all three, since `jsonc.ts` and `config-loader.ts` can import it without pulling a parser into the client's module graph.
- `liesInsideOnHost` (`inputs/input-filter.ts`) and `liesInside` (`vitest/find-workspaces.ts`) compute the same answer on a real host; the first differs only by choosing the path module at call time (the 16:03 seam).

#### Test Coverage Gaps

Denominator: 35 named-defect tests in the touched test files (D1987 to D2019, D2021) against the 8 criteria.

| #   | Source file                                                                                  | Named defect                                                                                                                                                                                                                                                                          | Expected test                                                                                                                                                                                                                                                         | Severity |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| G1  | `packages/daemon/src/vitest/find-workspaces.ts` `readJson`                                   | An `rt-test.json` saved with a UTF-8 byte-order mark is read as not valid JSON, so it declares nothing and every declared file stays an input. (AC1)                                                                                                                                  | `readNonInputs` over a file whose bytes are U+FEFF then `{"nonInputs":["docs/**"]}` reads as declared with `docs/**`. Mutation: the byte-order-mark strip removed (`text.startsWith(BYTE_ORDER_MARK)` to `false`).                                                    | MEDIUM   |
| G2  | `packages/cli/src/trust-prompt.ts` `nonInputLines`                                           | The listing prints a pattern bare, so a pattern with a trailing space reads exactly as the pattern without it. (AC3) Behavior deliberately changed by the review: each pattern now prints JSON-quoted, so D2015's `line.trim() === pattern` must re-pin to `JSON.stringify(pattern)`. | D2015 re-pinned; a new test with a pattern `"docs/** "` finds the line `"docs/** "` (quoted) before the executes sentence. Mutation: `JSON.stringify(pattern)` back to `oneLine(pattern)`.                                                                            | MEDIUM   |
| G3  | `packages/cli/src/trust-prompt.ts` `nonInputLines`                                           | With no `rt-test.json` the listing says nothing about non-inputs, though AC3 requires it to say none exists. (AC3)                                                                                                                                                                    | A start listing on a consumer with no `rt-test.json` has a line naming `rt-test.json` before the executes sentence. Mutation: the `NON_INPUTS_ABSENT` case returns `[]`.                                                                                              | MEDIUM   |
| G4  | `packages/cli/src/trust-prompt.ts` `nonInputLines`                                           | An `rt-test.json` declaring no pattern leaves no non-inputs line in the listing. (AC3)                                                                                                                                                                                                | `{"nonInputs": []}` gives a line naming `rt-test.json` before the executes sentence. Mutation: the `patterns.length === 0` branch returns `[]`.                                                                                                                       | LOW      |
| G5  | `packages/daemon/src/inputs/declared-non-inputs.ts` `unusable`, `input-tracker.ts` `current` | Once an unusable `rt-test.json` is fixed and a reconciliation ends, answers still carry the old reason. (AC8, its second sentence)                                                                                                                                                    | Tracker: write invalid JSON, reconcile, rewrite it valid, reconcile, and `current().nonInputsUnusable` is undefined. Mutation: `read()` keeps the previous declaration when the new one is usable.                                                                    | MEDIUM   |
| G6  | `packages/daemon/src/inputs/non-inputs.ts` `PROTECTED_NAMES`                                 | Vite config names are not protected, so a declared `vite.config.ts` changes no fingerprint and selects nothing. (AC4)                                                                                                                                                                 | A declared `packages/lib/vite.config.ts` still raises its config trigger (selection) or moves the fingerprint (tracker). Mutation: `...VITE_CONFIG_FILES,` removed from `PROTECTED_NAMES`.                                                                            | CRITICAL |
| G7  | `packages/daemon/src/inputs/non-inputs.ts` `PROTECTED_NAMES`                                 | `pnpm-workspace.yaml` is not protected, so a pattern such as `*.yaml` makes an edit to the workspace list change no fingerprint and select nothing. (AC4, 17:21 ruling)                                                                                                               | With `*.yaml` declared, a change to `pnpm-workspace.yaml` is not a declared non-input (selection selects as with no declaration; the tracker counts it). Mutation: `PNPM_WORKSPACE_FILE,` removed from `PROTECTED_NAMES`.                                             | CRITICAL |
| G8  | `packages/daemon/src/inputs/non-inputs.ts` `declaredNonInputs`                               | A `tsconfig*.json` file is not protected, so `**/*.json` makes an edit that changes import resolution stale nothing. (AC4, 17:21 ruling)                                                                                                                                              | With `**/*.json` declared, `packages/lib/tsconfig.base.json` is not a declared non-input. Mutation: the `TYPESCRIPT_CONFIG_NAME.test(posix.basename(path)) \|\|` line removed.                                                                                        | CRITICAL |
| G9  | `packages/daemon/src/inputs/non-inputs.ts` `declaredNonInputs`                               | A `jsconfig*.json` file is not protected. (AC4, 17:21 ruling)                                                                                                                                                                                                                         | With `**/*.json` declared, `jsconfig.json` is not a declared non-input. Mutation: on the protection line, `TYPESCRIPT_CONFIG_NAME.test(` replaced by `/^tsconfig.*\.json$/.test(`, leaving `CONFIG_FILE_NAME` itself to the selection records already anchored on it. | CRITICAL |
| G10 | `packages/daemon/src/inputs/non-inputs.ts` `matchesSequence`                                 | A trailing `**` or `*` fails to match nothing at the end, so `docs/**` does not declare a file named `docs` and `README*` does not declare `README`. (AC1, "none included")                                                                                                           | `docs/**` matches `docs`, and `README*` matches `README`. Mutation: the trailing `while (pattern[patternIndex] === run) patternIndex += 1;` removed.                                                                                                                  | MEDIUM   |
| G11 | `packages/daemon/src/inputs/declared-non-inputs.ts` `namesFile`                              | An event for a new directory a pattern matches is dropped, so on Linux a `package.json` created inside it is never watched or read and its edits stale nothing until the periodic reconciliation. (AC4, AC5)                                                                          | With `docs/**` declared, create `docs/pkg/package.json` in a new directory; the fingerprint moves, and moves again on an edit. Mutation: the `lstatSync(...)?.isDirectory() !== true` check replaced by `true`.                                                       | CRITICAL |
| G12 | `packages/daemon/src/inputs/input-tracker.ts` `#changed`                                     | An event for a known directory a pattern matches is dropped, so moving `docs/pkg` holding a `package.json` out of the root leaves that input in the set. (AC4)                                                                                                                        | With `docs/**` declared and `docs/pkg/package.json` an input, move `docs/pkg` out of the root; the fingerprint moves. Mutation: `knownDirectory` passed as `false`.                                                                                                   | HIGH     |
| G13 | `packages/daemon/src/daemon/lifecycle.ts` `#protectStoredTestModules`                        | A throwing read of the stored discovery escapes `begin()`, so the daemon never runs its start sequence.                                                                                                                                                                               | A store whose `readLatestResults` throws once: `begin()` returns, the error is logged, and the start sequence reaches idle. Mutation: the `try`/`catch` removed.                                                                                                      | MEDIUM   |

Note, not a gap: `packages/daemon/test/selection/harness.ts` `TreeCase.protectedTestModules` has no caller; every test takes the default from `listedTestModules`.

### Completion Notes

Built by rt-t2-1b-dev in worktree `wt-1` on `wt/1` from 9e95c94, 15:23 to 15:56.

- **Sanity check** (15:22): three findings sent to rt-t2-1b-create, all confirmed and applied by it at 15:23 (§ Owner rulings and grill record).
- **Unverified assumptions:** none in the table. `readJson` folds a missing file into "cannot read", so `readNonInputs` checks presence with `lstatSync` before and again after a failed read (`vitest/find-workspaces.ts` `readJson`).
- **Delegation:** none. Once `non-inputs.ts`, the `StartPlan` field and the answer field existed, the file-disjoint groups were 2 or 3 files each, which IMPL-AGENTS.md prices above writing them.
- **Choices inside the tasks:**
  - `InputFilter.excludes` keeps pruning directories only. Declared files go through `InputFilter.declares`, which the inventory's file filter and the tracker's reads call. A pattern such as `docs/**` also matches the directory `docs`, and pruning it would lose a protected `package.json` under it.
  - The tracker drops an event naming a declared file before it is queued (`DeclaredNonInputs.namesFile`), so it never shows as pending. A directory, or a path whose kind cannot be told, is read as usual.
  - `rt-test.json` is on the tracker's exclusions, and its reconciliation trigger is tested first with `liesInside`, which compares as the exclusion does (case-insensitively on Windows).
  - To keep `input-tracker.ts` under the code-line cap, the reconciliation timer moved to `inputs/reconcile-schedule.ts` (`ReconcileSchedule`, with `RECONCILE_INTERVAL_MS`) and git's file watches and unread reasons to `inputs/git-files.ts` (`GitFiles`), both unchanged in behavior. The tracker-side declaration state is `inputs/declared-non-inputs.ts`.
  - The answer's reason prints as `Warning: <reason>`, matching the `Warning:` lines `answer-text.ts` already prints for git; the start listing prints `warning: <reason>` like its other warnings.
  - `SelectionInput.change` is now documented as file paths, since selection cannot know what a named directory held (review F4). 2.3 passes the tracker's changed input paths, which are files.
- **Adversarial review** (15:48, 9 findings):
  - Fixed: F1 (the case-variant trigger), F2 (by the 15:49 ruling), F6 (a file vanishing mid-read reads as absent), F7 (patterns logged JSON-quoted), F8 (protection keeps an event already queued) and F9a (the `InputFilter` comment).
  - Discarded: F3, since `change` is `/`-separated by contract, and a Linux file name holding `\` is decided identically by the tracker and selection today, so converting separators would break AC4. F5, since a no-answer is an error sent instead of an answer, and the start plan and the log carry the reason.
  - F9b is a change-request candidate below.
  - Re-validated with lint, typecheck and prettier.
- **Acceptance evidence**, from throwaway probes under `_agent-docs/.scratch/2-1b/`, with logs kept in `logs/`:
  - AC1, AC2 and AC4: the matcher and validator over every AC2 case, 256 and 257 patterns, case, dot-names, protected names, `rt-test.json` and a protected module. The worst-case matcher ran 1,000 matches in 9 ms.
  - AC3: `rt-test start` without `--trust` on a fixture printed the declared, malformed and missing states before the executes sentence, and `--json` carried `nonInputs` under `schemaVersion` 1, with nothing executed.
  - AC5 and AC6: an `InputTracker` probe. A declared edit moved no revision and a job across it stayed fingerprinted; an input edit raised the revision. A same-set `rt-test.json` edit changed nothing and logged nothing. A malformed one exposed and logged the reason and made README an input.
  - Protection: a probe raised the revision once on protect, left a declared sibling's edit silent, counted the protected module's edit, and undid it once. A guard job across protection stayed fingerprinted, and a job across a protected module's edit did not.
  - AC7: a `selectTests` probe.
  - AC8: traced from `InputTracker.current().nonInputsUnusable`, which the probe shows set, through `queryBasis` to `contextLines`.
- **Validation** (15:53 to 15:55): targeted typecheck of `@rt-test/daemon` and `rt-test`, where every error is in the test files listed above; `bun x oxlint` over every changed file, clean with no warning; `bun x prettier --check` over every changed file, clean; `node scripts/check-line-citations.mjs`, clean. No test run, per the workflow.
- **README and docs:** `README.md` and `docs/architecture.md` are the orchestrator's; their exact text went to it in the report.
- **Change-request candidate:** `readJson` (`vitest/find-workspaces.ts`) does not strip a UTF-8 byte-order mark, so an `rt-test.json` or `package.json` saved with one by a Windows editor reads as invalid JSON. For `rt-test.json` that fails safe: it declares nothing, with the reason. Fix: strip a leading U+FEFF before `JSON.parse` in `readJson`, which also serves the workspace listing.

### File List

- `_agent-docs/tickets/2-1b-declared-non-inputs.md` (create-ticket; dev record)
- `packages/daemon/src/inputs/non-inputs.ts` (created)
- `packages/daemon/src/inputs/declared-non-inputs.ts` (created)
- `packages/daemon/src/inputs/git-files.ts` (created)
- `packages/daemon/src/inputs/reconcile-schedule.ts` (created)
- `packages/daemon/src/inputs/input-tracker.ts`
- `packages/daemon/src/inputs/input-filter.ts`
- `packages/daemon/src/inputs/input-inventory.ts`
- `packages/daemon/src/inputs/fingerprint.ts`
- `packages/daemon/src/daemon/lifecycle.ts`
- `packages/daemon/src/start-plan.ts`
- `packages/daemon/src/client.ts`
- `packages/daemon/src/vitest/find-workspaces.ts`
- `packages/daemon/src/selection/selection-types.ts`
- `packages/daemon/src/selection/select-tests.ts`
- `packages/daemon/src/query/answer.ts`
- `packages/daemon/src/query/summary.ts`
- `packages/daemon/src/query/path-status.ts`
- `packages/cli/src/trust-prompt.ts`
- `packages/cli/src/commands/start.ts`
- `packages/cli/src/answer-text.ts`

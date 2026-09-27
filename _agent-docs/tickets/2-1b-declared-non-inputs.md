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

- [ ] AC1: The consumer declares non-input files in `rt-test.json` at the consumer root, a JSON object whose `nonInputs` member is an array of patterns. A pattern is a root-relative `/`-separated path matched against a file's whole root-relative path: `*` matches any run of characters within one path segment, `?` one character within a segment, and a segment that is exactly `**` matches any number of whole segments, none included. `*`, `?` and `**` match names that begin with a dot. Every other character matches only itself, case included, on Windows and Linux alike. A missing `rt-test.json`, or one with no `nonInputs` member, declares nothing, and members other than `nonInputs` are ignored.
- [ ] AC2: A declaration that cannot be used declares nothing, so every file stays an input, and the start plan, the daemon's log and every summary and path status answer (AC8) give the reason. It cannot be used when `rt-test.json` exists but cannot be read or is not valid JSON; when its top level is not an object; when `nonInputs` is not an array of strings; when it holds more patterns than a named bound; or when any pattern is empty, begins with `/`, contains `\`, `[`, `]`, `{`, `}` or `!`, has an empty, `.` or `..` segment, or uses `**` inside a segment rather than as a whole one.
- [ ] AC3: Before the trust question, the start plan shows the declaration's root-relative file name and each pattern it declares, or that no `rt-test.json` exists, or the reason it declares nothing (AC2). `rt-test start --json` carries the same under the unchanged `schemaVersion`. Building the plan reads files only and executes nothing.
- [ ] AC4: A file is a declared non-input when a declared pattern matches it and it is not protected. `rt-test.json` itself is never a declared non-input; AC6 and AC7 say how it is treated. Protected files stay inputs whatever the patterns: every `package.json`, every lockfile name selection recognizes, every Vitest or Vite config file name, and every test module of a Vitest workspace's latest stored discovery. Selection and the fingerprint answer whether a path is a declared non-input identically for the same declaration and discovery.
- [ ] AC5: Adding, editing, deleting or renaming a declared non-input changes no Vitest workspace's fingerprint and no discovery's fingerprint, raises no input revision, and leaves a job running at the time fingerprinted; the log line ticket 2.1's AC3 writes never names it as an input that changed. Renaming an input to a declared name is a deletion of that input, and the reverse an addition.
- [ ] AC6: `rt-test.json` is not an input. Adding, editing, deleting or renaming it runs a full reconciliation, with every result reading unknown until it ends as ticket 2.1's AC6 states, which applies the declaration as it then stands: a file it no longer declares becomes an input and a file it newly declares stops being one. Once that reconciliation ends, an edit that leaves the set of declared non-inputs unchanged leaves every result reading as it did before the edit. The daemon logs the patterns in effect, or the reason it declares nothing, after the first reconciliation and after every later one that finds the declaration different from the one in effect before it, whatever started that reconciliation.
- [ ] AC7: In a selection, a changed path that is a declared non-input selects nothing, and its path report names no trigger and gives a nothing-selected reason naming `rt-test.json` and a pattern that matches the path. A protected path selects exactly as it does with no declaration. A change to `rt-test.json` is a project-wide broad fallback with its own named trigger. The selection policy version rises.
- [ ] AC8: While the declaration in effect in the daemon cannot be used (AC2), every summary and path status answer carries the reason, and `rt-test summary` and `rt-test status` print it; `--json` carries it as a named field under the unchanged `schemaVersion`. While no `rt-test.json` exists, or it is usable, no answer carries a reason.

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

- [ ] (AC1, AC2, AC4) Create `packages/daemon/src/inputs/non-inputs.ts`: the declaration file name `NON_INPUTS_FILE` (`rt-test.json`) and member name as named constants (C3); a reader that returns the declaration read from the consumer root as one of: no file, the validated patterns, or the reason it declares nothing (AC2), reusing `readJson` and `objectField` from `find-workspaces.ts` (C5, C11); the pattern bound as a named constant beside the reader (C3, C4); a matcher written here over `/`-separated segments, without `path.matchesGlob` (§ Settled facts), whose `**` matching cannot backtrack without bound; and one exported function that decides whether a root-relative path is a declared non-input, returning the pattern that matched, and never a match for `NON_INPUTS_FILE` at the root or for a protected path (every `PACKAGE_JSON`, every `LOCKFILES` name, every Vitest or Vite config file name, each protected test module), given the declaration and the protected test modules, which both selection and the tracker call (AC4, C8). Keep the module's imports to `node:fs`, `node:path`, `find-workspaces.ts` and `error-text.ts`, since the client's module graph loads it through the start plan.
- [ ] (AC4) Move `LOCKFILES` out of `select-tests.ts` to one exported constant that `select-tests.ts` and `non-inputs.ts` both import, beside `PACKAGE_JSON` in `find-workspaces.ts` (C4, C8).
- [ ] (AC3) Change `packages/daemon/src/start-plan.ts`: `StartPlan` gains the declaration from the reader, as a named field. Change `packages/cli/src/trust-prompt.ts` `listing` to print it before the executes sentence (the file and each pattern, or none, or a `warning:` line with the reason), and `packages/cli/src/commands/start.ts` `planFields` to carry it in `--json` (C38, C151).
- [ ] (AC4, AC5, AC6) Change ticket 2.1's inputs module (`input-inventory.ts`, `input-tracker.ts`, and `fingerprint.ts` where the workspace-to-inputs seam needs it): read the declaration at each full reconciliation, take the protected test modules from the latest stored discovery, and recompute the input set and raise the revision whenever a stored discovery changes the protected set, and leave every declared non-input out of the input set, the revision and a job's changed-inputs judgment, so an event naming only declared non-inputs changes nothing a job or an answer reads. Add an event naming `NON_INPUTS_FILE` at the root to the full-reconciliation triggers, and log the declaration in effect after the first reconciliation and after every later full reconciliation that finds it changed, whatever started it (C32 for the reason), and expose the reason while the declaration in effect cannot be used, for AC8. Keep the inventory's exclusions one list that the declaration extends, as 2.1 left it, and put `NON_INPUTS_FILE` at the root on that list, so `rt-test.json` never enters the input set, the revision or a job's changed-inputs judgment (AC6).
- [ ] (AC7) Change `packages/daemon/src/selection/selection-types.ts` and `select-tests.ts`: `SelectionInput` gains the declaration as a required field and the protected test modules come from its `workspaces`' known tests (root-relative, since `TestIdentity.modulePath` is relative to its workspace); add a `NO_SELECTION` kind for a declared non-input and a `TRIGGER` kind for a change to `NON_INPUTS_FILE`, a project-wide fallback; check every changed path through the shared function before any other trigger, relying on it to return no match for a protected path or `NON_INPUTS_FILE`, so selection holds no protected-path check of its own; raise `SELECTION_POLICY_VERSION` to 3 (C129, C130).
- [ ] (AC8) Change `packages/daemon/src/query/answer.ts`, `summary.ts` and `path-status.ts` to carry the tracker's reason as a named field of `AnswerContext`, present only while the declaration cannot be used, beside ticket 2.1's AC8 fields; change `packages/cli/src/answer-text.ts` to print it as a `warning:` line in the human answer, with `--json` carrying it through `answerFields` and `CLI_JSON_SCHEMA_VERSION` unchanged (C38, C151).
- [ ] (Support) Document `rt-test.json` in `README.md`'s Start and stop section: its place, its `nonInputs` syntax, the protected files, what a malformed one does, that a change to it reconciles every input, and that it is committed with the project (C7). Replace the Query section's sentence that no result is current until inputs are tracked only if ticket 2.1's sweep has not already.
- [ ] (Support) Report the exact `docs/architecture.md` text for the orchestrator (orchestrator-owned; C48, C55): the start plan sentence in § Current implementation names the declaration, and the input tracker's description names declared non-inputs and the protected files.
- [ ] (Support) Lint and typecheck.

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

#### Settled facts

- **Node's glob matcher differs across the supported versions.** Node v22.13.0's `lib/path.js` `glob()` (behind `path.matchesGlob`) calls `emitExperimentalWarning('glob')` on every call and passes minimatch `nocase: isMacOS || isWindows` (read from `https://raw.githubusercontent.com/nodejs/node/v22.13.0/lib/path.js`, lines 167 to 181). On Node 24.19.0 on this Windows machine, `path.win32.matchesGlob('Docs/x.md', 'docs/**')` printed `false`. So the same pattern would match a file on Windows under Node 22 and not under Node 24, and every match under Node 22 writes a warning. The ticket writes its own matcher (NFR5, P13).
- **Existing selection behavior this ticket changes.** A root-owned path while another package workspace exists is a project-wide `root-owned-path` fallback (ticket 2.2 AC5 and its R4: "Until it excludes non-inputs, a root `README.md` edit selecting every workspace (AC5) is expected behavior"). A declared `README.md` now selects nothing (AC7).

#### Design notes

- **Why the list file is not an input.** Its effect reaches every fingerprint through the input set it leaves: a changed set changes each workspace's digest, since 2.1 digests the sorted `(path, content digest)` list. Were the file an input too, a reformatting edit would stale everything for no change in what tests read. Any edit that does change the set stales every result once, because every workspace's fingerprint covers the whole project's inputs until 2.3 narrows it.
- **Why a change to it is a project-wide fallback in selection.** It can change every workspace's inputs, so the results it stales must be reselected, or staleness and selection disagree (sprint § Ticket 2.3: "so staleness and selection never disagree"). An edit that leaves the declared set unchanged still selects every workspace while staling nothing, since selection does not compare declarations; that over-selects and never misses, and 2.3's rule never to re-execute a test holding a current result keeps it from rerunning anything. The orchestrator ruled at 11:25 that this is allowed: "staleness and selection never disagree" forbids selecting less than what went stale, never selecting more, and the fallback is an explained broad fallback (review F10).
- **One decision, two callers.** Selection and the tracker call one function in `non-inputs.ts` with the same declaration and the same protected test modules (AC4, C8). Selection takes the protected test modules from `SelectionInput.workspaces`' known tests, joined as `posix.join(workspace.path, modulePath)`; the tracker takes them from the latest stored discovery. Given the same discovery, both yield the same set.
- **Protected test modules and the first discovery.** The tracker learns test modules from a stored discovery. A test module a pattern matches is therefore unprotected until the discovery listing it is stored, and becoming protected then changes the input set, so that discovery reads stale until a later one is stored. That affects only a declaration that covers a test module. For a module already discovered it errs toward stale; a new test module a pattern matches changes no discovery fingerprint (AC5), so no discovery lists it until something else stales discovery, and it goes unrun meanwhile (a known limit below, which 2.3 closes).
- **Setup files are protected from 2.3 on.** The tracker does not know a workspace's setup files until 2.3's discovery reports them, and protecting them in selection alone would break AC4's agreement. 2.3 adds each workspace's setup and global setup files to the protected set (sprint § Ticket 2.3, citing AC4 here; Q2).
- **Known limits:** until 2.3 lands, a setup or global setup file a declared pattern matches is a declared non-input, so its edit stales nothing (Q2); a declared file that a test does read, which is the consumer's error, lets a result read current after an edit that changed it; until 2.3 lands, a new test module added under a declared pattern starts no rediscovery, so it goes undiscovered and unrun until something else stales the discovery. 2.3 closes it: every file matching a workspace's test include patterns, as discovery reports them, joins the files a declared pattern cannot remove, as the setup files do (sprint § Ticket 2.3; orchestrator, 11:25, review F9; `docs/plan.md` requires a new test to be discovered without a prior edge).
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

About 23 raw files, 30 estimated, and 9 code units (8 criteria plus validation). Production: `non-inputs.ts` to create, and to modify (`start-plan.ts`, `trust-prompt.ts`, `commands/start.ts`, `find-workspaces.ts`, `selection-types.ts`, `select-tests.ts`, `input-inventory.ts`, `input-tracker.ts`, `fingerprint.ts`, `answer.ts`, `summary.ts`, `path-status.ts`, `answer-text.ts`, `README.md`); `docs/architecture.md` is reported text. Tests, for create-tests: `packages/daemon/test/selection/select-tests.test.ts`, `selection/harness.ts`, `selection/defects.json`, 2.1's inputs test file, `packages/daemon/test/query.test.ts`, `packages/daemon/test/defects.json`, `packages/cli/test/cli.test.ts` and `packages/cli/test/defects.json`. The work splits into four groups sharing `non-inputs.ts` and the moved `LOCKFILES`, with the answers group reading the reason the tracker exposes: the start plan and CLI start; selection; the tracker; the answers and their CLI text. The estimate is over 20. The orchestrator ruled at 11:13 to proceed with no split, since a split would let the tracker and selection disagree on what a declared file is, and 1.4 and 2.1 proceeded at a similar size. Implementation is delegated to implementer agents, since the estimate is over 10.

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
  - packages/daemon/src/inputs/input-inventory.ts
  - packages/daemon/src/inputs/input-tracker.ts
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

- `_agent-docs/tickets/2-1b-declared-non-inputs.md` (create-ticket)

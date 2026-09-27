# Ticket 2.1: Track inputs and invalidate

## Ticket

As a coding agent querying RT Test instead of running tests,
I want every result an input edit could affect to stop reading current the moment the daemon sees the edit, and no result to read current until the daemon has checked the inputs it was produced from,
so that a current result always describes the files and environment as they are now, across edits, restarts, branch changes and missed events.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [x] AC1: The inputs are every file under the consumer root except `.git`, `node_modules`, the daemon's state directory and log file, and, inside git, every path git reports as ignored, in the consumer's repository and in each nested repository under the root. A path whose ignored status the daemon does not know is an input. Every test module the latest discovery lists is also an input of its own Vitest workspace, whatever git ignores. Adding, editing, deleting or renaming an input changes the fingerprint of every Vitest workspace; editing a test module git ignores changes its workspace's fingerprint, so that workspace's results read stale (or unknown under AC4); the same operations on any other excluded path change none.
- [x] AC2: Each Vitest workspace's current input fingerprint is one digest over: the root-relative path and content of every input (every input of the project, until ticket 2.3 narrows it); a digest of the daemon's whole environment, names and values; the Node version, platform and architecture; the Vitest version that workspace resolves; the Vitest adapter version; and the selection policy version. Changing any one of them changes the digest. Computing it twice over the same inputs gives the same digest, on each of Windows and Linux, whatever the order the files are read in. No environment value or file content is stored, logged or answered, and no inventory of input paths is stored or answered; only digests. A planted environment variable value and a planted file's content appear in no stored record, log line or answer. AC3's log line and AC7's reasons may name individual paths.
- [x] AC3: The daemon stores every discovery and every run bound to the digest of the inputs the job started from. A job during which any input changed, which started before the first reconciliation ended, during which a reconciliation ended unable to establish the input set (AC7), or during which the watcher was unhealthy, is stored not fingerprinted, so none of its results can read current, and the daemon's log names the job and the inputs that changed, or the reason. A reconciliation that runs during a job and finds no change leaves the job fingerprinted; a job ending while a reconciliation runs is judged when it ends.
- [x] AC4: A finished result stored under another adapter version is stale, as today, whatever the inputs. Any other finished result is unknown when its run is not fingerprinted, when no current fingerprint can be computed, while a reconciliation is running, while the watcher is unhealthy, and, for a duplicate-marked test, while the discovery it is counted from is not current (AC11); otherwise it is current when its run's stored digest equals its workspace's current fingerprint, and stale when they differ. A test with no finished result stays unknown. A saved edit to an input makes every result it covers stale, or unknown while one of those conditions holds, in every answer given after the daemon has handled the edit's event.
- [x] AC5: After a daemon start, every stored result not stale under another adapter version reads unknown until the first reconciliation ends. Then a result whose inputs are unchanged since it was stored, in an earlier daemon life or this one, reads current, and one whose inputs changed reads stale.
- [x] AC6: A full reconciliation runs, and every result not stale under another adapter version reads unknown until it ends, at start, when the watcher reports an error or lost events, when HEAD or the ref it names moves (a checkout, reset, rebase, pull or commit), when a file git reads ignore rules from changes, and every `RECONCILE_INTERVAL_MS` (5 minutes) while the daemon runs. An input change the reconciliation finds that no event reported changes the fingerprint exactly as an observed edit does. A reconciliation that ends with every watch open and the input set established returns the watcher to healthy and reconciliation to complete; until one does, results stay unknown.
- [x] AC7: An input set the daemon cannot establish in full (an input file or directory it cannot read, a listed test module git ignores that it cannot read, a directory watch it cannot open, a walk past a named bound) leaves every result it covers unknown, and every answer names the reason. It is never answered from a partial fingerprint as if complete. A git listing that cannot be run or read leaves no path ignored, as selection does, so every file counts as an input, and every answer and the log say git's ignored paths could not be read.
- [x] AC8: Every summary and path status answer carries the input revision it was answered from, which rises each time the daemon observes an input change or a reconciliation finds one; whether reconciliation is complete, with its reason when it is not; the time the last reconciliation ended, absent before the first one ends; the watcher's health, with its reason when unhealthy; and whether the discovery it counts from is current, which it is only when its stored digest equals the discovery's current fingerprint under AC4's conditions for a result. `rt-test summary` and `rt-test status` print each of them, and `--json` carries each under the unchanged schema version.
- [x] AC9: Tracking and reconciliation read files and run git only: they load no Vitest module, consumer config or test file, start no executor job, and begin only after the confirmed start is accepted. A query still starts nothing.
- [x] AC10: While a reconciliation runs, the daemon still answers status and queries within `RESPONSE_BOUND_MS`, and a stop during one ends the daemon within 1.3's stop bound. The watchers and any git process the tracker started end with the daemon.
- [x] AC11: After an edit that adds, removes or reorders a test sharing its names with another test of the same module, no duplicate-marked test of that module reads current from a result stored before the edit: it reads stale, or unknown while AC4's conditions for unknown hold. A Vitest workspace's inputs always include each of its own test modules, whatever narrowing replaces the whole-project input set. A duplicate-marked test reads current only when the discovery it is counted from is current (AC8's discovery currency); otherwise its finished result reads unknown, and the answer says the discovery is not current. A test with a unique name is unaffected, since its identity does not rest on its position.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                                       | Why it matters if wrong                                                                                                                                 | How to check                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | How does Node's `fs.watch` surface events it lost? On Windows, is a `ReadDirectoryChangesW` buffer overflow reported (an event with a null filename, an `error`, or nothing)? On Linux, does libuv report an inotify `IN_Q_OVERFLOW` at all?                     | AC6 reconciles on a reported loss. If Linux never reports one, the periodic reconciliation is the only net there, and the known-limit text must say so. | Read libuv's `src/win/fs-event.c` and `src/unix/linux.c` at the version Node 22.13 and 24 bundle (`process.versions.uv`); on Linux, overflow a queue with a low `fs.inotify.max_queued_events` in WSL and watch what the listener receives. |
| U2  | On Windows, does one recursive `fs.watch` of the root report adds, edits, deletes and renames in subdirectories created after the watch began, and name the path relative to the root?                                                                           | Q7's Windows design rests on it.                                                                                                                        | A timed exercise in a temp directory on Windows under Node 22.13 and 24.                                                                                                                                                                    |
| U3  | On Linux, does a non-recursive `fs.watch` on a directory report a file created, written, deleted or renamed inside it, including a rename into or out of it, and a subdirectory's creation? What error does opening one past `fs.inotify.max_user_watches` give? | Q7's Linux design adds a watch per directory as directories appear, and turns a failed watch into an unhealthy watcher (AC7).                           | The same exercise in WSL under Node 22.13 and 24, then with a lowered `max_user_watches`.                                                                                                                                                   |
| U4  | For a linked worktree, which files move on a checkout, reset, commit or rebase, and does `git rev-parse --git-dir --git-common-dir` name where HEAD, the refs and `packed-refs` live?                                                                            | AC6's HEAD trigger must watch the right files, which for a linked worktree lie outside the consumer root.                                               | Create a linked worktree in a temp repository and run `git rev-parse --git-dir --git-common-dir --git-path HEAD` from it; watch which files each operation writes.                                                                          |
| U5  | Which files does git read ignore rules from for a repository (every `.gitignore`, `.git/info/exclude`, `core.excludesFile`), and does `git ls-files --others --ignored --exclude-standard` honour each?                                                          | AC6 reconciles when one of them changes. A rules source outside the watched tree, such as a global excludes file, would change the ignored set unseen.  | `git help gitignore` for the installed git, and `git config --get core.excludesFile`.                                                                                                                                                       |

Resolutions (dev, 2026-09-27; Windows 11, Node 24.19.0 bundling libuv 1.52.1, git 2.55.0.windows.5; Node 22.13 is not installed on this Windows host):

- U1 CONFIRMED. Windows: a recursive watch flooded with 20,000 file creations in one synchronous loop delivered one event whose filename was `null` and no `error` event, which is libuv 1.52.1 `src/win/fs-event.c` line 572, `handle->cb(handle, NULL, UV_CHANGE, 0)` when `ReadDirectoryChangesW` returns no entries. So the watcher treats a `null` filename as lost events and reconciles. Linux (WSL Ubuntu 24.04, Node 24.19.0 with libuv 1.52.1 and Node 22.23.3 with libuv 1.51.0; Node 22.13 is not installed there): a burst of 49,152 creations into a watched directory while the listener stalled, against the default `max_queued_events` of 16384, delivered exactly 16,384 events, no `null` filename and no `error`. libuv 1.52.1 `src/unix/linux.c` lines 2617 to 2619 look the event's watch descriptor up and `continue` when none matches, and `IN_Q_OVERFLOW` carries descriptor -1, so the overflow is dropped silently. On Linux the periodic reconciliation is the only net for a lost event, which is the Q5 known limit. Found beside it: a watch opened on an 8.3 short path (`os.tmpdir()` here is `C:\Users\KEVINL~1\...`) aborts the whole process on its first event with `Assertion failed: !_wcsnicmp(filename, dir, dirlen), file src\win\fs-event.c, line 72`. The watcher therefore opens every watch on `realpathSync.native` of its directory.
- U2 CONFIRMED by observation, Node 24.19.0 only: in a directory created after a recursive watch of the root began, a create, an append, a rename and a delete each raised events named relative to the root with `\` (`rename late\a.txt`, `change late\a.txt`, `rename late\a.txt` then `rename late\b.txt`, `rename late\b.txt`). A rename raises one event per name and a delete a `rename`, so the tracker rehashes every named path and reads a missing one as a deletion.
- U3 CONFIRMED. Observed in the same WSL runs under both Nodes: a non-recursive watch on a directory reported a create (`rename` then `change`), a write (`change`), a rename within it (`rename` for each name), a rename out of it and into it (`rename` with the name on its side), a delete (`rename`) and a subdirectory's creation (`rename sub`), each named by its bare file name, and nothing for a file created inside that subdirectory, which has no watch of its own. Opening a watch past `max_user_watches` (524288 there, not lowered, by the orchestrator's ruling) is read from source: `src/unix/linux.c` line 2692 returns `UV__ERR(errno)` when `inotify_add_watch` fails, which is `ENOSPC` for the watch limit, and Node 24.19.0's `internal/fs/watchers` `FSWatcher.prototype[kFSWatchStart]` throws a `UVException` from `fs.watch` synchronously, with code `ENOSPC` and the message "System limit for number of file watchers reached". So the watcher catches the throw of every `fs.watch` call and marks itself unhealthy with the error's text, whatever its code (AC7).
- U4 CONFIRMED by observation in a temp repository with a linked worktree: `git rev-parse --git-dir --git-common-dir --git-path HEAD --git-path packed-refs --git-path info/exclude` names `main/.git/worktrees/linked` as the git dir, `main/.git` as the common dir, `worktrees/linked/HEAD` as HEAD, and `packed-refs` and `info/exclude` in the common dir. A commit in the linked worktree rewrote `main/.git/refs/heads/side` (the ref HEAD names), not HEAD; `checkout -b` rewrote `worktrees/linked/HEAD` and created `refs/heads/other`. So the watcher watches HEAD's directory (the git dir), the named ref's directory and `packed-refs`' directory (the common dir), filtered by name, and re-arms the ref watch when HEAD names another ref.
- U5 CONFIRMED in the installed `gitignore.adoc` (lines 26 to 40 and 58 to 60) and `git-ls-files.adoc` line 127: git reads a `.gitignore` in the path's directory and every parent up to the working tree's top level (which can lie above the consumer root), `$GIT_COMMON_DIR/info/exclude`, and `core.excludesFile`, whose default is `$XDG_CONFIG_HOME/git/ignore`, or `$HOME/.config/git/ignore` when that is unset or empty; `--exclude-standard` adds all three. `core.excludesFile` is unset on this host. `git-check-ignore.adoc`: `--stdin -z` reads NUL-separated paths, exit 0 means one or more is ignored and 1 means none, and without `--no-index` a tracked path is never reported ignored, which matches `ls-files --others`.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing, and write each answer with the source location or observed output beneath the table.
- [x] (AC1, AC7) Create `packages/daemon/src/inputs/input-inventory.ts`: list the inputs under the consumer root by AC1's exclusions, reusing `ignoredPathsReader` for git's ignored paths, without following a directory link, and bounded by named depth and entry limits whose breach ends the walk with no partial list and makes the inventory incomplete with a reason (C28, C25). Read and hash each input's content without blocking the daemon's event loop for long, and report every file or directory it could not read as incompleteness, never as a missing input, except a path that no longer exists when read, which is a deletion. Read no FIFO, socket or device file: count it as an input by its path and type.
- [x] (AC2) Create `packages/daemon/src/inputs/fingerprint.ts`: compose each Vitest workspace's digest from the per-input digests (sorted by root-relative `/`-separated path, P13), a digest of `process.env`, `process.version`, `process.platform`, `process.arch`, the workspace's Vitest version from `resolveWorkspaceVitest`, `VITEST_ADAPTER_VERSION` and `SELECTION_POLICY_VERSION`. Compose the discovery's digest from the same parts as a workspace's (project inputs, environment digest, runtime, adapter and policy versions) with every listed workspace's Vitest version, computed at the discovery's end when the revision is unchanged since its start, since the workspace list is its output. Keep the function that narrows a workspace's input set a single seam 2.3 can replace, without building 2.3's narrowing.
- [x] (AC1, AC7, AC11) In `fingerprint.ts`, make the seam that maps a Vitest workspace to its inputs always return each test module the latest discovery lists for that workspace, whatever set it narrows to and whatever git ignores, and state that invariant where the seam is declared, since 2.3 replaces its body. Read and hash a listed module the inventory excluded each time that workspace's fingerprint is composed (every answer, and each job's start and end), so it needs no watch; a module that cannot be read is AC7's incompleteness, so the workspace's results read unknown with the reason, never a missing input.
- [x] (AC4, AC8, AC11) In `test-states.ts`, rate a duplicate-marked test's finished result unknown whenever the discovery it is counted from is not current, using the same discovery currency AC8 answers (one predicate, C8), after the adapter-version check and before the digest comparison, in AC4's order. The answer's discovery freshness is the reason it carries; a test with a unique name keeps AC4's rule unchanged.
- [x] (AC1, AC6, AC7, AC10) Create `packages/daemon/src/inputs/input-watcher.ts`: on Linux, one non-recursive `fs.watch` per included directory, added and dropped as directories appear and vanish, with none on excluded directories; on Windows, one recursive watch of the root with excluded paths filtered (Q7). Watch HEAD, the ref it names and `packed-refs` through git's own directories, which for a linked worktree lie outside the root (U4), and each ignore-rule source (U5). Report a watch it cannot open, a watcher error or a reported loss as unhealthy with its reason. Close every watch on stop.
- [x] (AC4, AC5, AC6, AC7, AC8, AC10) Create `packages/daemon/src/inputs/input-tracker.ts`: hold the per-input digests, the input revision, the reconciliation state, the last reconciliation end time and the watcher's health. Rehash only the paths an event names; run a full reconciliation on AC6's triggers and on the `RECONCILE_INTERVAL_MS` timer; raise the revision only when a digest actually changes. Expose the current fingerprint of each workspace and of the discovery (or none, with the reason, when AC4 or AC7 says unknown) and a way for a job to learn whether any input changed, or any event named an input, between its start and its end. Stop its timer, watchers and any git child on stop.
- [x] (AC3, AC5, AC9) Change `packages/daemon/src/daemon/lifecycle.ts`: start the tracker in `begin()`, after the confirmed start is accepted; make the start sequence wait for the first reconciliation; take each job's bindings from the tracker at its start, and store it under that digest only when, from the job's start to its end, the tracker reports no input change and no event naming an input, no reconciliation ending unable to establish the input set, and the watcher healthy (a reconciliation that finds no change does not count against it), else not fingerprinted with a log entry naming the job and the inputs that changed (Q6). Stop the tracker in the stop sequence before the store closes.
- [x] (AC9, AC10) Change `packages/daemon/src/daemon/daemon-main.ts` to build the tracker into `LifecycleParts` with the consumer root, the state directory and the daemon's log file as exclusions.
- [x] (AC4, AC5) Change `packages/daemon/src/query/test-states.ts`: replace `CURRENT_FINGERPRINT` with each workspace's current fingerprint from the tracker, passed through `assessEvidence`, keeping the adapter-version check first and the unknown for a test with no finished result, in AC4's order. Build the workspace-path-to-latest-run map once in `summary.ts` `queryBasis` and pass it to `testStandings` and to `summaryAnswer`'s `latestRunFacts`, which today each build their own from the same `latestRuns`.
- [x] (AC8) Change `packages/daemon/src/query/answer.ts`, `summary.ts` and `path-status.ts`: add the input revision, reconciliation completeness with its reason when incomplete, the last reconciliation time (absent before the first), the watcher's health with its reason, and the discovery's freshness to `AnswerContext` and `DiscoveryFacts`, each a named field.
- [x] (AC8) Change `packages/cli/src/answer-text.ts` to print each new field in the human answer; `--json` carries them through `answerFields` with `CLI_JSON_SCHEMA_VERSION` unchanged.
- [x] (Support) Sweep the prose this ticket makes false, found by `rg` over tracked and untracked files for `not fingerprinted`, `NOT_FINGERPRINTED`, `CURRENT_FINGERPRINT`, `inputs are tracked` and `no result is current`, including at least: `README.md`'s freshness paragraph, `stored-records.ts`'s `InputFingerprint` docblock, and `docs/architecture.md` § Current implementation ("no result is current until inputs are tracked", "Nothing yet builds fingerprints", "stores each run as not fingerprinted") and § Identity and freshness where it now describes built behavior (C48, C55). `docs/architecture.md` is orchestrator-owned: edit it only under a grant `node scripts/file-claims.mjs grant-status` shows, otherwise report the exact text.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `ignoredPathsReader` and `IgnoredPaths` (`packages/daemon/src/selection/git-ignored.ts`): git's ignored paths for the root and each nested repository, with `core.fsmonitor` off, `GIT_*` removed and git run from outside the consumer (C158). Its `spawnSync` blocks the event loop for up to `GIT_TIMEOUT_MS` (30 s), three times `RESPONSE_BOUND_MS` (10 s), once for the root and once per nested repository, and a synchronous child cannot be killed on stop. So add an asynchronous, killable reader beside it sharing the arguments and the environment filter, rather than a second copy, and have the tracker kill it on stop (AC10).
- `walkWorkspace` (`packages/daemon/src/selection/source-walk.ts`) for the walk's rules only (no directory link followed, `node_modules` and `.git` skipped, `MAX_WALK_DEPTH`, `MAX_WALKED_ENTRIES`). It lists sources and configs of one package workspace and is synchronous, so the inventory walks the whole root itself; share its skip constants rather than restating them (C3, C4), exporting `SKIPPED_DIRECTORIES`, which is module-private today.
- `packages/daemon/src/client.ts`: the CLI imports `answer.ts` only through `@rt-test/daemon/client`, so each new answer constant the CLI reads is re-exported there.
- `resolveWorkspaceVitest` (`packages/daemon/src/vitest/load-vitest.ts`): reads the workspace's resolved Vitest `package.json` without importing Vitest, for AC2's Vitest version (AC9).
- `assessEvidence` (`packages/core/src/evidence.ts`), called from `finishedFreshness` in `test-states.ts`: already rates a missing or empty fingerprint unknown and a mismatch stale.
- `VITEST_ADAPTER_VERSION` (`packages/daemon/src/vitest/adapter-version.ts`), `SELECTION_POLICY_VERSION` (`packages/daemon/src/selection/selection-types.ts`).
- `InputFingerprint`, `StoreBindings`, `FINGERPRINT_DIGEST` and `NOT_FINGERPRINTED` (`packages/daemon/src/store/stored-records.ts`, `schema.ts`): the store already keeps a digest per run and per discovery, so no schema change and no migration (C149).
- `consumerIdentity` and `defaultStateDirectory` (`packages/daemon/src/store/consumer-identity.ts`), `daemonLogFile` (`packages/daemon/src/daemon/daemon-log.ts`), for AC1's exclusions.
- `RESPONSE_BOUND_MS` (`packages/daemon/src/daemon/protocol.ts`) for AC10.
- `errorText` (`packages/daemon/src/vitest/error-text.ts`) for the reasons AC7 and AC8 name.

### Must Create

- `packages/daemon/src/inputs/input-inventory.ts`, `fingerprint.ts`, `input-watcher.ts` and `input-tracker.ts`.
- `RECONCILE_INTERVAL_MS` (5 minutes) and the inventory's bounds, as named constants beside their one reader (C3, C4).
- The answer fields of AC8 and the watcher-health values, as named constants in `answer.ts`, which the CLI imports.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Ticket 1.4 (the summary and status queries) is in test and lands before this ticket; this ticket is written against the tree as it will be once it lands. 1.4 counts every result unknown or stale because `test-states.ts` passes `CURRENT_FINGERPRINT = undefined` to `assessEvidence`; this ticket supplies the current fingerprint. Selection (`findPackageWorkspaces`, `buildDependencyInformation`, `selectTests`, tickets 2.2 and 2.2b) is on main with no production caller.

Requirements this ticket delivers (`docs/requirements.md`):

- FR6: "Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current." (AC1, AC4 to AC7)
- NFR3: "Never report a result as current unless its stored input fingerprint matches the current inputs." (AC2 to AC5)
- It also serves FR3 ("Persist results bound to project, worktree, run identity, input fingerprint, and adapter version, and keep them available across a daemon restart", AC3, AC5), FR4's "execute no project code before that start" (AC9) and FR5's answers (AC8).

Clauses the criteria rest on:

- AGENTS.md § Product guarantees: "Never report historical results as current after a relevant edit or unresolved input change." "Bind results to project identity, run identity, input fingerprints, and adapter versions." "Keep the daemon and state store independent of the project backend." "Treat test execution as execution of project code. Require an explicit start for a selected trusted project". (AC3 to AC5, AC9)
- `docs/plan.md` § Selection strategy: "Watch additions, deletions, renames, test edits, snapshots, configuration, setup files, dependency lockfiles, and generated inputs as well as source files. Reconcile content fingerprints after restart or a branch change. Missing events must not preserve false freshness." (AC1, AC5, AC6) Generated inputs that git ignores are the owner's known limit (Q1).
- `docs/architecture.md` § Identity and freshness: "Fingerprint relevant source and test content, fixtures, setup, configuration, declared environment inputs, dependency lockfiles, runtime, runner version, adapter version, and selection policy version. Persist digests rather than secret environment values. Content hashes alone cannot establish that the input set is complete; record completeness and reasons for uncertainty." "Publish query snapshots with a sequence number, observed revision, last reconciliation time, and watcher health. On startup, mark old results unconfirmed until reconciliation finishes. An unknown input set cannot yield a current pass." (AC2, AC5, AC7, AC8)
- `docs/roadmap.md` § M1 acceptance: "stop and restart, and historical results stay available but are not current until reconciliation. An edit during a run cannot restore a stale green result; new tests appear; deleted inputs cannot escape invalidation." (AC3, AC5; new tests appearing is 2.3's rediscovery)
- C113: "Every path that labels a result current compares its stored input fingerprint with the current one at read time. A missing, empty or unreadable fingerprint yields unknown, never current." C114: "Freshness is derived at query time from current inputs; no record stores a current or fresh flag that a later edit could leave true." (AC4)
- C115: "A watcher overflow, missed event, branch switch or startup before reconciliation marks every result it could affect as unconfirmed or stale, never none." (AC5, AC6)
- C116: "A run whose inputs changed while it ran is recorded as invalidated and rerun from stable inputs". This ticket delivers only the never-current half (AC3); the invalidated state and the rerun are 2.3's (Q6).
- C117: "A new input kind (config, setup file, fixture, lockfile, declared environment input, runtime or runner version) joins the fingerprint in the change that starts depending on it." C147: "Environment inputs are fingerprinted as digests; state, logs and summaries never contain raw environment values or source text." (AC2)
- C125: "A test told apart from same-named tests only by its position is marked duplicate, and never inherits another test's result as current." (AC11)
- C140: "No code path runs a project's tests, loads its Vitest config or imports its files unless that project was explicitly started and trusted." ADR-0002: "The daemon is the sole executor of tests and falsification for a started project." (AC9)
- C151: "Every `--json` payload carries a schema version, and a breaking field change bumps it." AC8's fields are additive, so the version stays.
- Glossary: **Input fingerprint** "A digest of every input that can change a test's result." **Freshness** "Whether a result still describes its test's current inputs." **Result** "A test's outcome bound to the run and input fingerprint that produced it." **Current pass** "A passed outcome whose freshness is current."

#### Owner rulings and grill record

The questions went to the orchestrator at about 10:05 on 2026-09-27 (crew.md § Questions), and Q7 at about 10:07.

- Q1 Inputs, owner ruling at 10:08, asked in plain terms by the orchestrator. Gitignored files are not inputs. A test that reads generated or built files that change with no source edit is a named known limit. A path whose ignored status is unknown counts as an input (AC1, AC7).
- Q2 Non-inputs, owner ruling at 10:08. Ticket 2.1 excludes nothing by file type, so a README edit stales every result. Ticket 2.1b (key `2-1b-declared-non-inputs`) lets the consumer declare non-input files, committed in the consumer and shown in the start plan, before the Fleet Cooling trial; it is authored after this ticket (AC1).
- Q3 Sequencing with 2.3, orchestrator at 10:08. Every Vitest workspace's fingerprint covers the whole project's inputs until 2.3 narrows each to the inputs whose selection includes it, from the same dependency information its selection uses, so staleness and selection never disagree. This ticket does not call `buildDependencyInformation`, since discovery does not yet report the setup files and aliases it needs (2.3's), and a parser crash in the daemon is what 2.3's child process isolates (AC2).
- Q4 Environment, orchestrator at 10:08. A digest of the whole environment, never raw values, plus Node version, platform, architecture, the workspace's Vitest version, the adapter version and the selection policy version. Restarting from a shell whose environment differs in any variable stales every result (AC2).
- Q5 Missed events, orchestrator at 10:08. A full reconciliation at start, on a watcher error or loss, on a HEAD move and on an ignore-rule change, plus a periodic one every 5 minutes (`RECONCILE_INTERVAL_MS`). Answers carry the revision, completeness, the last reconciliation time and watcher health. An input change no event reports, between two reconciliations, is a named known limit, whose window is that interval (AC6, AC8, U1).
- Q6 Edits during a job, orchestrator at 10:08. A discovery or run during which any input changed is stored not fingerprinted, so it never reads current; 2.3 turns that into its invalidated state and reruns it. This ticket keeps 1.3's start sequence (discover, then run each confirmed workspace once), which 2.3 replaces, and only makes it wait for the first reconciliation (AC3).
- Q7 Watcher, orchestrator at 10:10. No new dependency. On Linux a non-recursive watch per included directory, added and dropped as directories come and go; on Windows one recursive watch of the root with excluded paths filtered. A watch it cannot open makes the watcher unhealthy, and every result reads unknown with that reason. HEAD, the refs and `packed-refs` are watched through git's own directories, the common directory for a linked worktree. A native watcher comes back to the orchestrator first; `oxc-parser` is already a native dependency, so one would not be the first, and the decision stands on its merits (AC6, AC7).
- FYIs agreed by the orchestrator at 10:08: the CLI's `schemaVersion` and the protocol version stay unchanged, since AC8's fields are additive (1.4's precedent). The input-set decision has no design-decision record; `docs/architecture.md`, which the sweep task updates, is its durable home (orchestrator, 10:18).
- Sizing, orchestrator at 10:08: proceed as-is, no split (§ Sizing).
- Stale or unknown, create-ticket at about 10:17, on the ticket review's question. A result stored under another adapter version reads stale whatever the inputs, since that fact needs no input (C124); every other finished result reads unknown while inputs are unsettled (a reconciliation running, the watcher unhealthy, no current fingerprint). Only the check order differs from the alternative, never whether a result reads current (AC4 to AC6).
- Gitignored test modules, orchestrator ruling at 11:19, on dev's sanity check F3. Vitest does not read `.gitignore`, so a gitignored test module (generated tests, for example) is discovered and run while AC1 kept it out of the inputs, which broke the 10:44 reasoning for that module. Ruled Option A: every test module the latest discovery lists is an input of its workspace whatever git ignores (AC1), read and hashed at each fingerprint composition when the inventory excluded it, and a read failure is AC7's incompleteness. Reason: a test module Vitest discovers and runs can change its tests' results by definition. The owner's Q1 ruling aimed to keep build output and generated noise from staling results, never to leave a test's own file out of its fingerprint, and Option A narrows that ruling's reach only in the direction that strengthens NFR3 and C125, so it needs no owner call. Rejected: scoping AC11 to test modules that are inputs, which lets a duplicate in a generated test file inherit another test's result as current.
- Dev sanity check, answered at about 11:18: F1 (asynchronous, killable git reader), F2 (`git check-ignore` before a new path counts) and F4 (`git-ignored.ts`, `source-walk.ts` and `client.ts` added to files_to_modify) confirmed and applied; F3 ruled above. The orchestrator accepted all three and the recount at 11:19.
- Duplicates counted from a stale discovery, orchestrator ruling at 12:14, on dev's review finding F9. A discovery stored not fingerprinted, because an input changed while it ran, can list a module's tests from pre-edit content; a later fingerprinted run then answers a duplicate-marked test by position with a post-edit result, which read current and broke C125 although AC11 held as worded. Ruled: fix it in 2.1. A duplicate-marked test reads current only when the discovery it is counted from is current, and otherwise reads unknown with that reason (AC4, AC11); a test with a unique name is unaffected, since its full identity key is its own. Rejected: leaving it to 2.3's rediscovery, which narrows the window but never closes it, since any discovery can be out of date.
- Duplicate tests and positions, orchestrator ruling at 10:44, on a finding from ticket 1.4's review. A test's occurrence is its position among same-named tests in its module (`identifyModuleTests` in `packages/core/src/test-identity.ts`, matched by `runAnswerer` in `packages/daemon/src/query/test-states.ts`), so after an edit removes the first of two same-named tests, the survivor's stored result answers the discovered first one. That is harmless while nothing reads current; once this ticket supplies fingerprints, C125 applies. A result reads current only when its stored digest equals the current fingerprint, and every workspace's fingerprint covers its test modules' content, so a match implies the positions are unchanged since the run. The ruling makes that outcome AC11, which also binds 2.3's narrowing to keep each workspace's own test modules among its inputs.

Ticket review (create-ticket Step 6c, about 10:15), 18 findings, all applied: discovery currency defined and exposed; recovery to healthy and complete; AC2's no-leak claim made observable and reconciled with AC3's and AC7's path-naming; a job judged by change, events and failed reconciliations, never by a clean periodic one; the same-digest claim scoped per platform; the stale-or-unknown order (above); `server.test.ts` in the sizing; AC7's reason and an absent first reconciliation time in AC8; the sweep's `rg` basis; vanished files and FIFOs; an observed-and-reverted edit; triggers during a reconciliation; the recursive-watch note's scope; the discovery digest's parts and timing (C117); the git fallback reported (C32); no partial inventory (C28).

#### Design notes

- **Settled fact: Node's recursive watch on Linux.** Node 24.19.0's bundled `lib/fs.js` `watch` sends `recursive: true` on Linux to `lib/internal/fs/recursive_watch.js` ("libuv does not support recursive file watch on all platforms, e.g. Linux due to the limitations of inotify"). That emulation walks the tree with `readdirSync`, calls `#watchFile` (one `fs.watch`, so one inotify watch) for every file and every directory, emits a `rename` for every entry already present, and emits `error` for a non-`ENOENT` failure. Only its `ignore` option skips a directory. Read with `node -e "process.binding('natives')['internal/fs/recursive_watch']"` on Node 24.19.0, Windows. So a recursive watch of the root would block the daemon during the walk and spend a watch per file (of `node_modules` too, unless the `ignore` option skips it), which is why Q7 watches per directory. Node 22.13's `ignore` option was not checked, and Q7's design does not need it.
- **Settled fact: Vitest's manifest is exported.** `vitest@4.1.11` and `vitest@5.0.1` both export `./package.json` (read from `node_modules/.bun/vitest@*/node_modules/vitest/package.json` `exports`), which `resolveWorkspaceVitest` resolves.
- **The fingerprint's parts.** A workspace's digest is a digest of its parts, each named, so no two part lists can collide by concatenation: the sorted `(path, content digest)` list, the environment digest, the runtime, the Vitest version, the adapter version and the policy version. Normalize separators to `/` before sorting (P13). An input that is a link to a file is read through the link; a directory link is not followed (as `walkWorkspace` does), and the link itself is an input by its target path.
- **Content, not timestamps.** Every reconciliation reads and hashes content. A stat-based shortcut (size and mtime) is out of scope: a write within the timestamp's granularity after a hash would leave a changed file unseen.
- **Revision.** One number for the worktree, starting at a fixed value each daemon life and raised whenever a per-input digest changes, whether an event or a reconciliation found it. Ticket 2.4's `wait` binds to it; this ticket only publishes it. A reconciliation that finds nothing changed does not raise it.
- **A job's fingerprint.** Take the revision and the digest at the job's start, and at its end compare the revision after the tracker has handled every event already queued. Equal revisions, reconciliation complete and a healthy watcher throughout mean the job ran over the inputs it is stored under; otherwise it is stored not fingerprinted (Q6). Any event naming an input during the job also marks it not fingerprinted, even when the rehash finds the content unchanged, since an edit reverted before its rehash leaves the revision equal although the job read the edited file. The residual case, an input changed during the job and changed back with every event missed, is the Q5 known limit.
- **Events during a reconciliation.** An event that arrives while a reconciliation runs is applied after that reconciliation's read of the same path, never overwritten by it, so the newer content wins. A trigger that arrives while a reconciliation runs starts another once it ends; only the latest one's end marks reconciliation complete, and a late event from a closed watch is ignored (C157).
- **A directory that appears.** On Linux, files created in a new directory before its watch opens raise no event, so the watcher lists the directory once its watch is open and treats each entry found as changed.
- **A new path of unknown ignored status.** The cached ignored listing predates a new path, so a new file an ignore pattern covers, outside every listed ignored directory (a first `coverage/`, a `*.log` a test writes), would otherwise count as an input and break AC1. For each new path no listed ignored ancestor covers, the tracker must run an asynchronous `git check-ignore` (the same environment filter and `core.fsmonitor=false` as `ignoredPathsReader`) before counting it. While that check is pending, the affected results read unknown (AC4's "no current fingerprint can be computed"). If git fails, the path is an input (Q1, AC7).
- **A test that writes into the consumer's tree.** A file a test writes under the root that git does not ignore is an input changed during the run, so that workspace's runs are stored not fingerprinted and never read current. That is NFR3 working. AC3's log line names the paths, and ticket 2.1b's declared non-inputs are the consumer's remedy.
- **A commit.** A commit moves HEAD, so it starts a full reconciliation (AC6), and every result reads unknown for its length, although nothing in the tree changed.
- **Discovery freshness.** The discovery is bound to the project's inputs and every listed workspace's Vitest version, so a test file added or deleted makes it stale. Rediscovery on such an edit is 2.3's scheduling; until then a new test is missing from the counts, and AC8's discovery freshness says the counts may be incomplete.
- **Responsiveness.** The daemon answers on one thread. Hashing tens of thousands of files, walking the tree and a synchronous git spawn must yield to the event loop so status, queries and stop stay within their bounds (AC10). Nothing here runs in the executor, which hosts Vitest only.
- **What 2.3 inherits.** A seam that maps a Vitest workspace to its inputs (the whole project here), the revision, and the job fingerprint check. 2.3 narrows the seam with the dependency information its selection uses, turns a not-fingerprinted job into its invalidated state, and replaces the start sequence, which today reruns every workspace at start even when its results read current (NFR1 is 2.3's). Its narrowing keeps each workspace's own test modules among its inputs (AC11).
- **Known limits, each to be named in `docs/architecture.md`:** a gitignored file a test reads (build output, generated code), other than a test module discovery lists, that changes with no input edit (Q1, and the 11:19 ruling); a file outside the consumer root a test reads; `node_modules` changed without a lockfile or manifest edit, beyond the resolved Vitest version; an input change no event reports, for up to `RECONCILE_INTERVAL_MS` (Q5, U1); unsaved editor buffers (plan.md § Core experience).
- **Unanalyzed:** case-insensitive path collisions on Windows (two spellings of one file); hard links; a consumer root on a network drive, where watch events are unreliable; the CPU cost of a full reconciliation against plan.md's idle target of below 1% averaged over one idle minute, which M1's benchmarks measure.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.1` over the target files and folders named ticket 1.4 (review) and ticket 2.3 (backlog). The 2.3 hit is its sprint scope's substring "inputs", not a file it names.

- **1.4** creates `packages/daemon/src/query/`, `packages/cli/src/answer-text.ts`, `query-client.ts` and the query parts of the protocol, server and lifecycle, which this ticket edits after 1.4 lands: sequential, not a collision.
- **2.1b** (declared non-inputs, Q2) adds a consumer's list of non-input files to AC1's exclusions. This ticket leaves the inventory's exclusions one list 2.1b can extend.
- **2.3** narrows each workspace's inputs (Q3), records an invalidated run and reruns it (Q6), replaces the start sequence, reports setup files and aliases from discovery, and runs selection in a child process. This ticket builds none of them. 2.3's narrowing must keep each workspace's own test modules among its inputs (AC11).
- **2.4** binds `wait` to the input revision AC8 publishes.
- **2.5** measures NFR1 and NFR2 over an edit corpus, reading the freshness this ticket computes.

#### Sizing

About 25 raw files, 33 estimated, and 12 code units (11 criteria plus validation). Production: 13 to modify (`lifecycle.ts`, `daemon-main.ts`, `test-states.ts`, `answer.ts`, `summary.ts`, `path-status.ts`, `stored-records.ts`'s docblock, `answer-text.ts`, `README.md`, `docs/architecture.md`, and, from dev's sanity check, `git-ignored.ts`'s asynchronous reader, `source-walk.ts`'s exported skip list and `client.ts`'s re-exports) and 4 to create (the inputs module). Tests, for create-tests: `lifecycle.test.ts`, `daemon.test.ts`, `server.test.ts`, `query.test.ts`, a new inputs test file, the daemon `defects.json`, `cli.test.ts` and the CLI `defects.json`. The work splits into three disjoint groups: the inputs module; the lifecycle wiring; the answers and the CLI text. The orchestrator ruled to proceed with no split at 10:08, and kept that ruling at 11:19 after the sanity check's recount from 29 to 33 estimated: the growth is support and test files, and a split would divide one fingerprint between two lanes. Implementation is delegated to implementer agents, since the estimate is over 10.

#### Current structure of the modified files

- `packages/daemon/src/daemon/lifecycle.ts`: `DaemonLifecycle` takes `LifecycleParts` `{ identity, scope, start, store, log, executor, closeEndpoint }`. Its constructor fixes `#bindings` as `{ ...scope, inputFingerprint: { kind: NOT_FINGERPRINTED } }`, used by every `writeDiscovery` and `writeRun`. `begin()` runs `#startSequence` (discover, store, run each confirmed workspace once), then idles. `summary()` and `pathStatus()` read `store.readLatestResults(scope)` and answer through `summaryAnswer` and `pathStatusAnswer` with a `DaemonView`. `#stopSequence` aborts the executor, awaits the sequence, closes the executor, the store, then the endpoint.
- `packages/daemon/src/daemon/daemon-main.ts`: `serve()` builds `LifecycleParts` after `holdStore` opens the store; `consumerRoot` and `stateDirectory` come from `process.argv`; the log is `DaemonLog(daemonLogFile(stateDirectory, worktreeIdentity))`.
- `packages/daemon/src/query/test-states.ts`: `testStandings(discovery, latestRuns)` gives each discovered test one `TestStanding` `{ test, state, freshness }`; `finishedFreshness` returns stale for another adapter version, else `assessEvidence({ fingerprint, outcome }, CURRENT_FINGERPRINT).freshness`, where `NO_FINGERPRINT = ""` stands for not fingerprinted.
- `packages/daemon/src/query/answer.ts`: `AnswerContext` `{ consumerRoot, currentAdapterVersion, discovery: DiscoveryFacts, activity, unstoredJobs }`, `DiscoveryFacts` `{ discoveryId, adapterVersion, adapterVersionCurrent }`, `SummaryAnswer`, `PathStatusAnswer`, the state and freshness constants; it imports only types so the CLI loads it without `node:sqlite`.
- `packages/daemon/src/query/summary.ts`: `summaryAnswer(results, daemon)` and `queryBasis`, which builds the standings through `testStandings(discovery, latestRuns)` and the `AnswerContext`; `summaryAnswer` then builds its own workspace-path-to-latest-run map from `results.latestRuns` for `latestRunFacts`, as `testStandings` does inside; `DaemonView` picks `consumerRoot`, `activity` and `unstoredJobs` from `StatusResponse`.
- `packages/cli/src/answer-text.ts`: `answerFields` spreads the answer into `--json` minus the protocol's own fields, so AC8's fields reach JSON with no change there; `countLines` and the answer renderers write the human text.
- `packages/daemon/src/store/stored-records.ts`: `InputFingerprint`'s docblock says "until inputs are tracked every caller passes the not-fingerprinted value".

#### Existing tests this change breaks

- `packages/daemon/test/lifecycle.test.ts`, D1453 ("the discovery and each run are stored under the worktree's project and worktree, not fingerprinted"): records are now stored under a digest.
- `packages/daemon/test/defects.json`: the record whose `old` is `      inputFingerprint: { kind: NOT_FINGERPRINTED },` (lifecycle) and the one whose `old` is `    CURRENT_FINGERPRINT,\n  ).freshness;` (test-states) lose their anchors when those lines change.
- `packages/daemon/test/query.test.ts` and `packages/cli/test/cli.test.ts`, wherever they assert that no result is current or build an answer context without AC8's fields.
- `packages/daemon/test/daemon.test.ts` and `server.test.ts`, wherever a started daemon's first answer is read before reconciliation or a stand-in `LifecycleParts` is built.
- Unanalyzed: 1.4's tests as they land; run the suite.

#### Previous ticket

1.4 (review), the nearest earlier key in the status file; 2.2b and 2.2 (done) precede it in this sprint. From 1.4: each test is answered only by its workspace's latest stored run; freshness is counted beside the states; a test with no finished result is unknown and one under another adapter version stale; queries read one snapshot (C150), carry the daemon's activity, and are bounded by `MAX_LINE_BYTES`; the protocol version and the CLI's `schemaVersion` stayed unchanged for additive fields. From 2.2b: `ignoredPathsReader` reads git's ignored paths once per build, git run from `tmpdir()` with `GIT_*` removed and `core.fsmonitor` off; `walkWorkspace` bounds a walk at `MAX_WALK_DEPTH` and `MAX_WALKED_ENTRIES`.

### References

- `docs/plan.md` § Targets: "Saved edit to stale-state publication: p95 below 100 ms after event receipt" and "Idle daemon CPU: Below 1% averaged over one idle minute", both targets, not measured here.
- `docs/architecture.md` § Components: "Input tracker: Watch saved inputs, reconcile content, assign project revisions".
- Sprint 2 (`_agent-docs/sprints/sprint-2-fresh-runs.md`) § Ticket 2.1 and § Ticket 2.3.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete`.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C8,C10,C12,C25,C28,C30,C32,C38,C41,C48,C55,C57,C59,C113,C114,C115,C116,C117,C119,C120,C122,C124,C125,C140,C147,C149,C150,C151,C157,C158 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P15,P16,P17,P18,P19,P21,P31,P32,P41 -->

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
sizing_ac_count: 12
files_to_modify:
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/daemon-main.ts
  - packages/daemon/src/query/test-states.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/query/summary.ts
  - packages/daemon/src/query/path-status.ts
  - packages/daemon/src/store/stored-records.ts
  - packages/daemon/src/selection/git-ignored.ts
  - packages/daemon/src/selection/source-walk.ts
  - packages/daemon/src/client.ts
  - packages/cli/src/answer-text.ts
  - README.md
  - docs/architecture.md
files_to_create:
  - packages/daemon/src/inputs/input-inventory.ts
  - packages/daemon/src/inputs/fingerprint.ts
  - packages/daemon/src/inputs/input-watcher.ts
  - packages/daemon/src/inputs/input-tracker.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 87527621-b24e-4e81-8609-c37908934c49

#### Test Files This Change Broke

- `packages/daemon/test/lifecycle.test.ts`: fails to typecheck (line 247, `LifecycleParts` now requires `inputs: TrackedInputs`); D1453 asserts every record not fingerprinted, which now holds only when inputs moved.
- `packages/daemon/test/query.test.ts`: fails to typecheck (lines 179, 766, 774, 864): `summaryAnswer`, `queryBasis` and `pathStatusAnswer` take a third or fourth argument, `CurrentInputs`; answers now carry `inputs`, `unfingerprintedWorkspaces` and `discovery.freshness`.
- `packages/daemon/test/defects.json`: the record whose `old` is `      inputFingerprint: { kind: NOT_FINGERPRINTED },` (lifecycle; that line is gone) and the one whose `old` is `    CURRENT_FINGERPRINT,\n  ).freshness;` (test-states; gone) lose their anchors.
- `packages/daemon/test/daemon.test.ts`, `server.test.ts`: not compiled against yet; a started daemon now reconciles before it discovers, and every answer carries the new fields. Unanalyzed until run.
- `packages/cli/test/cli.test.ts`: compiles, but the human text of `summary` and `status` gains `Discovery freshness:`, `Input revision:`, `Reconciliation:` and `Watcher:` lines, and `--json` gains `inputs`, `unfingerprintedWorkspaces` and `discovery.freshness`; any exact-text or key-set assertion moves.
- `packages/daemon/test/selection/**`: `ignoredPathsReader` now leaves out a directory `git ls-files --directory` names but `git check-ignore` denies (every present entry ignored, the directory itself not), so the selection walk enters it; a test pinning that such a directory is skipped moves. Unanalyzed until run.

#### ACs Owed a Test

- AC3: a discovery and each run are stored under the digest they started from, and a job during which an input changed, an event named one, a reconciliation failed or the watcher was unhealthy is stored not fingerprinted with a log line naming the changes.
- AC4: freshness order through a query: another adapter version stale; not fingerprinted, no current fingerprint, reconciling or unhealthy unknown; equal digest current; different digest stale; a saved input edit turns current results stale.
- AC5: after a restart every result reads unknown until the first reconciliation ends, then current when its inputs are unchanged and stale when they changed.
- AC6: each trigger (start, a watcher error or lost events, a HEAD or ref move, an ignore-rule file change, the interval) runs a reconciliation, during which results read unknown; a change no event reported is found by it.
- AC7: an unreadable input, a watch that cannot open, a walk past a bound, and an unreadable gitignored listed test module each leave results unknown with the reason; a git listing that cannot run leaves every file an input and `gitUnread` says so.
- AC8: `rt-test summary` and `rt-test status` print, and `--json` carries, the revision, reconciliation state and reason, the last reconciliation time (absent before the first), the watcher's health and reason, and the discovery's freshness, under `schemaVersion` 1.
- AC11: after an edit adds, removes or reorders a same-named test, no duplicate-marked test of that module reads current from a result stored before the edit, including in a gitignored test module.

#### Tests Owed

Each names the defect it catches; the Linux ones reach their path only on Linux (the orchestrator's WSL gate) and pass on Windows without reaching it.

- Linux: a directory deleted and re-created within one reconciliation round gets no new watch. Sequence: start the tracker on a root holding `x/y.ts`; after the first reconciliation, `rm -rf x`; wait for the change to be read; recreate `x/y.ts`; wait; append to `x/y.ts`. The workspace fingerprint must change on the append. (Defect: `watchDirectory` refused a directory it had already opened once this round.)
- Linux: a fast `rm -rf` then `mkdir` keeps a dead inotify watch. Sequence: start on a root holding `src/a.ts`; after the first reconciliation, in one synchronous step remove `src` and write `src/c.ts`; wait; append to `src/c.ts`. The fingerprint must change on the append. (Defect: a directory re-read on a `rename` event kept its old watch, on the deleted inode.)
- Windows: an edit in a subdirectory changes the fingerprint (the root watch must be recursive; it was opened non-recursive and saw only top-level entries).
- The tracker answers while no path is queued: an idle tracker's event loop stays free (a timer fires) after the first reconciliation. (Defect: an empty-queue drain re-scheduled itself as a microtask forever.)
- A new non-ignored file created in a directory git's listing named only because every entry in it was ignored (`.gitignore` `*.log`, `newdir/only.log`) is an input; a new ignored file there is not.
- A new file an ignore pattern covers, in a directory no listed ignored directory covers (`src/new.log`), changes no fingerprint; a write to a listed ignored directory, to the state directory, and to `node_modules` change none.
- A job's end returns promptly while a file is written continuously, stored not fingerprinted naming it (it waited for the stream to stop).
- An edit to a gitignored listed test module during a discovery stores the discovery not fingerprinted.
- A consumer root passed as a Windows 8.3 short path is watched through its real path (a watch on the short spelling aborts the process on its first event).
- A watch that cannot open (for example `ENOSPC` past `max_user_watches`) leaves the watcher unhealthy and the first reconciliation still ends, rather than re-requesting reconciliations forever.
- The state directory and log file stay excluded when the consumer root is given through a symbolic link or short name.
- A duplicate-marked test reads unknown, not current, when the discovery it is counted from is not current (AC11, AC4). Sequence: a module holds two tests named `t`; a run of its workspace is stored fingerprinted; the discovery stored for it is not current (stored not fingerprinted because an input changed while it ran, or stale after an edit). The summary counts both `t` tests unknown while a unique-named test in the same run reads current, and the answer's `discovery.freshness` is not `current`. (Defect: a duplicate matched to a result by position read current from a discovery whose positions nothing vouches for.) Mutation to prove it: drop `positionUnvouched`'s check from `workspaceStandings` in `test-states.ts`.

### Tests Record

Tests session: threadId 16951106-efaf-475e-8f06-1bc2c4081057

#### Named Defects

- D1877: A job's verdict is ignored, so a run during which an input changed is stored under its digest and can read current. (AC3)
- D1878: A run is stored under its start fingerprint even when its workspace's fingerprint at its end differs. (AC3)
- D1879: A discovery is stored under its digest although a listed test module no watch covers may have changed while it ran. (AC3, AC11)
- D1880: The discovery starts before the first reconciliation of the inputs has ended. (AC3, AC5)
- D1881: The stop sequence never stops the input tracker, so a job's end waiting on the inputs holds the stop forever. (AC10)
- D1882: The input tracker starts when the daemon is built, before the confirmed start is accepted. (AC9)
- D1883: A query never passes a workspace's current fingerprint to the comparison, so a result whose inputs are unchanged reads unknown, never current. (AC4)
- D1884: Every result is compared with the first workspace's current fingerprint, so a result stored under that workspace's digest reads current in another workspace whose inputs differ. (AC4)
- D1885: The discovery's freshness is decided with no current fingerprint, so a discovery whose inputs are unchanged never reads current. (AC8)
- D1886: A workspace whose own fingerprint cannot be computed is left out of the answer, so nothing says why its results read unknown. (AC7)
- D1887: A duplicate-marked test is matched to a result by its position even while the discovery is not current, so it can read current from another test's result. (AC11, AC4)
- D1888: An event naming an edited input is read but its new digest is never kept, so the fingerprint and the revision stay as they were. (AC1, AC4, AC8)
- D1889: The daemon's tracker is given no exclusions, so the store and log writes under its state directory move its inputs during every job and no result ever reads current. (AC1, AC4, AC5)
- D1890: A human answer leaves out the input revision, the reconciliation and watcher states with their reasons, and what of git was unread. (AC8, AC7)
- D1891: Reading the queue of changed paths re-schedules itself when the queue is empty, so an idle tracker holds the event loop and no timer fires. (AC10)
- D1892: A directory git's listing names only because every entry in it was ignored is taken as ignored itself, so a new file git does not ignore there is never an input. (AC1)
- D1893: A path created after git's listing is counted without asking git, so a new file an ignore pattern covers changes the fingerprint. (AC1)
- D1894: A path under a directory git lists as ignored is not excluded, so a write there changes the fingerprint. (AC1)
- D1895: A path under node_modules is not excluded, so installing a package changes the fingerprint. (AC1)
- D1896: The exclusions are compared as the caller spelled them, so the state directory given through a link to the consumer root is not excluded and the daemon's own writes change the fingerprint. (AC1)
- D1897: A job's end waits for every event accepted by the time it checks, not those seen before its end, so events naming a file that never stop arriving hold the job's end forever. (AC3)
- D1898: A listed test module no watch covers is never checked for an edit during a job, so a discovery that read it mid-edit is stored under its digest. (AC3, AC11)
- D1899: A listed test module git ignores is left out of its workspace's fingerprint, so an edit to it leaves the workspace's results current. (AC1, AC11)
- D1900: A listed test module that cannot be read is taken as deleted, so its workspace gets a fingerprint from an input set it could not establish. (AC7)
- D1901: The inventory's depth bound is never applied, so a walk past 64 levels completes as if the input set were bounded. (AC7)
- D1902: The inventory's depth bound refuses a directory exactly 64 levels below the root. (AC7)
- D1903: A watch that cannot open asks for another reconciliation while one runs, whose walk fails the same way, so the first reconciliation never ends. (AC7)
- D1904: A git listing that cannot be run is not reported, so nothing says every file there counted as an input. (AC7)
- D1905: A change to a watched git file is dropped, so a commit or checkout that moves HEAD runs no reconciliation. (AC6)
- D1906: An edit to a .gitignore under the root is read as an ordinary input edit, so what git ignores is not read again. (AC6)
- D1907: The periodic reconciliation runs 10 minutes after the last one ended, not 5, doubling how long an unreported change goes unseen. (AC6)
- D1908: A reconciliation that finds a changed input does not raise the input revision. (AC6, AC8)
- D1909: A watch event reporting lost events is ignored, so the watcher stays healthy and no reconciliation looks for the changes it missed. (AC6)
- D1910: A fingerprint is computed while a reconciliation runs, so a result can read current before the reconciliation has checked its inputs. (AC6, AC4)
- D1911: A reconciliation keeps the watch failures of the rounds before it, so a watcher once unhealthy never returns to healthy. (AC6)
- D1912: A fingerprint is computed before the first reconciliation has ended, over no inputs at all. (AC5)
- D1913: The project's digest is taken over its inputs in the order they were read, so two reconciliations of the same tree can disagree. (AC2)
- D1914: The environment is left out of the fingerprint, so a daemon restarted under another environment keeps its results current. (AC2)
- D1915: The Vitest version a workspace resolves is left out of its fingerprint, so upgrading Vitest keeps its results current. (AC2)
- D1916: The one watch of the root that Windows takes is opened non-recursive, so an edit below the root's own entries goes unseen. (AC1, AC6)
- D1917: A closed directory watch stays on the Linux watch list, so a directory deleted and re-created is refused a new watch and an edit in it goes unseen; proven over the test's inotify model. (AC6)
- D1918: A directory re-read on a rename keeps its old Linux watch, which is bound to the deleted directory, so an edit in the directory now there goes unseen; proven over the test's inotify model. (AC6)
- D1919: A watch is opened on the path as spelled, not its real path, so on Windows a directory reached through a short (8.3) name aborts the process on its first event; a directory link stands in for the short name. (AC6, AC10)
- D1920: A watcher that went unhealthy during a job is not recorded against it, so a job that spanned lost events is stored under its digest once a reconciliation has made the watcher healthy again. (AC3)
- D1921: Every reconciliation request is recorded against the running jobs, so a job during which a reconciliation found no change is stored not fingerprinted. (AC3)
- D1922: The repository's info/exclude is not watched, so a change to what it ignores runs no reconciliation. (AC6)
- D1923: A .gitignore between the repository's top level and the consumer root is not watched, so a change to what it ignores runs no reconciliation. (AC6)
- D1924: packed-refs is not watched, so a ref moved only there, as a pack or a fetch can, runs no reconciliation. (AC6)
- Re-pointed because this change made their mutation unobservable or moved their anchor: D1766 (now: the daemon never reads itself as stopping; the lifecycle's own stop check after the first reconciliation duplicates `daemon-main.ts`'s guard, so each guard alone is inert) and D1675 (the synchronous git reader's working directory; its old anchor matched the new asynchronous reader, which its test never reaches).
- Re-anchored to the changed source and re-proven under their existing ids: D1453 (now: the daemon stores every job not fingerprinted, even one whose inputs held still; AC3), D1806 (now: a fingerprinted result reads current when no current fingerprint can be computed; AC4), D1500, D1825, D1872 (daemon), D1650, D1651, D1652 (selection's git reader) and D002, D003, D007, D008 (core's `assessFreshness`). D1807 keeps its record and now pins the discovery's `freshness` field.
- Proof: `bun run test:defects:changed` on Windows (full selection, 1308 defects, ended 12:55:49) detected every record above except D1897, D1675 and D1766, each since fixed. `node scripts/verify-defects.mjs --changed` in a WSL clone (full selection, 1311 defects) under Node 24.19.0 and 22.23.3 detected every record except D1918, whose inotify model was then corrected and re-proven on Linux under both Node lines (13:11). Windows detection still owed to the review's `bun run check`: D1897, D1675, D1766, D1918 (corrected model), D1922, D1923 and D1924.
- Discovery refuted: "a not-fingerprinted run reads unknown while a current fingerprint exists" has no daemon-side mutation, since core's empty-fingerprint guard decides it; D008 covers it.
- From the review's gaps (G1 to G23):
- D1935: Only the discovery's duplicate mark is read, so a test the discovery lists once but the run records twice reads current by position from the new test's result while the discovery is not current. (AC11, G1)
- D1936: A duplicate-marked test never reads current, even while the discovery that marks it is current. (AC11, G2)
- D1937: A stale discovery vouches for a duplicate's position as a current one does, so its duplicates read current. (AC11, AC8, G2)
- D1938: An answer carries input facts other than those of the inputs it was answered from. (AC8, G3)
- D1939: While no fingerprint can be computed, every workspace is listed as unfingerprinted with the reason that is the whole answer's. (AC7, G4)
- D1940: A human answer never prints when the last reconciliation ended. (AC8, G5)
- D1941: A human answer leaves out how many changed paths the daemon has not yet read. (AC8, G5)
- D1942: A human answer leaves out the workspaces with no current fingerprint and their reasons. (AC7, G5)
- D1943: A human answer leaves out the discovery's freshness. (AC8, G5)
- D1944: --json drops the input facts from the answer. (AC8, G6)
- D1945: A job that starts while its inputs are unsettled is judged only by what changed while it ran, so one started during a lost-events reconciliation that then found no change is stored under its digest. (AC3, G7)
- D1946: A re-walk of the consumer root compares against no earlier input, so it reports every input changed and raises the revision; proven over the test's inotify model. (AC8, G9)
- D1947: A batch read that throws never marks its events read, so a job's end waits for an event that may never come. (AC3, G10)
- D1948: A git file whose watch cannot open makes the input watcher unhealthy, so every result reads unknown for the daemon's life. (AC6, AC7, G11)
- D1949: With the consumer root outside git, no git file is watched even for a nested repository, so an edit to its info/exclude runs no reconciliation. (AC6, G12)
- D1950: A nested repository's ignored paths are never read, so a write to a path its .gitignore ignores changes the fingerprint. (AC1, G13)
- D1951: A git file whose directory does not exist yet is watched for its own name in the nearest directory, so creating its directory runs no reconciliation. (AC6, G19)
- D1952: A content hash ignores the stop signal, so a stop waits for a file's whole read. (AC10, G21)
- D1953: A stop that arrives during the first reconciliation of the inputs is followed by the discovery once the reconciliation ends. (AC10, G14)
- D1954: The synchronous git reader keeps a directory git listed only because every entry in it was ignored, so the selection walk skips what may be read. (G17)
- D1955: A record stored with an empty digest is compared as a present one, so it reads stale against a present current fingerprint. (AC4, G20)
- D1960: A check-ignore that fails for a path created after a reconciliation is never named in git's unread reasons or the log, though the path counts as an input. (AC7, G24)
- Re-anchored after the review's fix round: D1792 and D1887 (`recordedAnswer` and `positionUnvouched` in `test-states.ts`), D1909 and D1916 (`input-watcher.ts`'s reflowed `#open` call), D1650 (now the shared `gitSpawnOptions()` `env:` line, so it breaks both readers; G16) and D1675 (the synchronous reader's call site, overriding the shared working directory, since `gitSpawnOptions()` takes no directory; G16). The `drained` helper now throws at its deadline with the pending count (G23).
- Proof of the gap round: targeted on Windows only (13:34, five files, 155/155; D1960 at 13:38, baseline 44/44 in `input-tracker.test.ts`, its mutant failing the intended assertion). Windows detection of D1935 to D1955, D1960 and of the six re-anchored records is owed to the review's `bun run check`, and Linux detection to the orchestrator's landing gate.

#### Deliberately Untested

- `packages/daemon/src/inputs/fingerprint.ts` (`sharedParts`): the Node version, platform, architecture, adapter version and selection policy version parts of AC2. Each is a process or build constant that a test can vary only by re-declaring a module constant (C100) or rewriting a process property the whole worker reads. The environment part (D1914) and the Vitest version part (D1915) are proven.
- AC2's no-leak clause: every value the tracker stores, logs or answers is a SHA-256 digest or a path, and no single-edit mutation of the production code puts an environment value or file content into one, so a test would have no mutation to reject.
- `packages/daemon/src/inputs/input-inventory.ts` (`HASH_CONCURRENCY`) and AC10's answer bound during a reconciliation: the event-loop delay over a large tree is a benchmark, which `docs/testing.md` keeps out of correctness tests.
- `packages/daemon/src/selection/git-ignored.ts` (`runGit`'s signal): ending a git child on stop needs a git that hangs, which only a stand-in executable per platform on `PATH` could provide.
- The real inotify path of D1917 and D1918 (orchestrator ruling, 12:47): both are proven over the test's inotify model on every host, since P28 admits no unrecorded test. The WSL run with the model switched off is the evidence that the model matches inotify.
- `packages/daemon/src/inputs/git-sources.ts`: the repository config, the reftable list, the user's global git config files and `core.excludesFile`. Each is an entry of the same list whose watching D1905, D1922, D1923, D1924 and D1949 prove for HEAD's ref, `info/exclude`, a `.gitignore` above the root, `packed-refs` and a nested repository's `info/exclude` (orchestrator ruling).
- `packages/daemon/src/selection/git-ignored.ts` (`gitSpawnOptions()`'s `cwd: tmpdir()`): the function takes no directory, so no single edit of it runs git from the consumer's tree. D1675 proves the synchronous reader's call site, and the asynchronous reader spreads the same options.
- `packages/daemon/src/inputs/input-tracker.ts` (`#changed`, G8): a later `change` overwriting a queued `rename` for a replaced directory. Every host reports a replacement as `rename` (Windows' recursive watch, real inotify and the test's model alike), and on Windows the recursive watch also names each entry inside, so no event sequence a host raises reaches the overwrite.
- `packages/daemon/src/daemon/lifecycle.ts` (`#startSequence`'s `startedAt`, `unmoved`, G15): `unmoved`'s `if (!started.ok) return started;` is inert, since a failed start fingerprint has no digest to equal the end's, so the run is stored not fingerprinted either way. Taking the discovery's start time after it ends is not one edit of the source.
- `packages/daemon/src/inputs/input-inventory.ts` (`linkDigest`, G18): a link to a file needs a file symbolic link, which Windows creates only with developer mode or elevation, so the test could not run on every gated host.
- `packages/daemon/src/inputs/input-tracker.ts` (`#readPath`, a file replaced by a directory under a `change` event, G22): as for G8, every host reports that replacement as `rename`, so no host reaches the `change` branch the fix added.
- `packages/daemon/src/inputs/input-filter.ts` (`check` failing, second half of G13): a `check-ignore` that fails during a reconciliation needs git to fail on one input after its listing succeeded (a path inside a submodule), and one that fails for a path created later lands only in that reconciliation's filter, which the next reconciliation replaces, so it never reaches `gitUnread` at all (reported to the review as an observation).
- `packages/daemon/src/inputs/input-tracker.ts` (the constructor's `realpathSync.native(consumerRoot)`): no watch observes it, since `#open` takes the real path of every directory it watches (D1919). Its other effect, exclusions spelled differently from the walked paths, is what D1896's test catches.

### Review Record

Review session: threadId 59c47370-6d9d-4323-a52d-a47073ad1c69

Review (2026-09-27, about 13:12 to 13:30): six fresh-eyes batches, two doc-verify agents, one third-party assumptions agent and the checklist pass. Fixed in the source (the review's fix round):

- F1 (critical): `test-states.ts` read only the discovery's duplicate mark, so after an edit added a second same-named test, a unique discovered test matched the new test's recorded result by position and read current while the discovery was stale. A result is now unvouched when the discovery or the run marks the test duplicate (`RunAnswer.positional`).
- F5 (critical): `git-sources.ts` watched no git file when the consumer root lies outside git, even with nested repositories, so a nested `info/exclude` or global excludes change ran no reconciliation.
- F2: a batch read that threw never marked its events read, so a job's end waited for the next event; the input set is now marked lost first, then the events read.
- F3: the root's relative path `""` matched no input in `input-state.ts`, so a re-walk of the root kept vanished inputs and reported every input changed; `replaceUnder` now removes exactly what it compares.
- F4: a git-file watch that could not open left the watcher unhealthy for the daemon's life; it is now a `gitUnread` reason.
- F6: a content hash now ends on the stop signal (AC10).
- F7: a file replaced by a directory is re-walked on a `change` event, not only on a `rename`.
- F8: the two git readers share one set of spawn options, so the environment and working-directory defects prove both.
- F9, F10, F11: unused `InputState` members removed; contract comments corrected in `answer.ts`, `test-states.ts`, `input-jobs.ts`, `input-inventory.ts` and `evidence.ts`; the CLI's unfingerprinted heading no longer claims every result reads unknown, and the last reconciliation prints on its own line.

- F12, from the tests session's observation (about 13:35): a `check-ignore` that failed for a path created after a reconciliation reached only that filter's unread list, never `gitUnread` or the log (AC7, C32). `input-tracker.ts` now re-reports git's unread reasons after each check.

The tests session's declines of G8, G15, G18, G22 and G13's check-failure half are accepted on their recorded reasons; G24 below covers that half through F12.

Correction to the Completion Notes' `git check-ignore` claim (assumptions agent, git 2.55.0.windows.5, observed): a bare directory path matching a `dir/` pattern is reported ignored only while that directory exists on disk; a file of that name, or a path not yet created or already deleted, exits 1.

Owner ruling that covers a finding: the environment digest covers every inherited variable, so a restart from a new terminal (Windows Terminal's per-tab `WT_SESSION`, for example) stales every result; Q4 (10:08) ruled exactly that.

Tech debt, for triage once committed:

- Each query re-reads every gitignored listed test module and re-resolves each workspace's Vitest twice, synchronously on the answer path (`summary.ts` `queryBasis` through `fingerprint.ts` `workspaceFingerprint` and `discoveryFingerprint`); path status pays it for every workspace.
- `input-state.ts` `remove` scans every tracked directory, and `input-watcher.ts` `dropDirectory` every watch, for each event.
- The Linux watcher reads an event named like the watched directory as its own removal (`input-watcher.ts` `watchDirectory`), so a child sharing its parent's name (`lib/lib`, or the root's name) re-walks the parent on each event on that child: correct since F3, but costly.
- `git-sources.ts`: one nested repository whose `rev-parse` fails leaves every git file unwatched; a relative `core.excludesFile` is resolved against the consumer root, not the top level; on Windows, `os.homedir()` follows `USERPROFILE` while Git for Windows prefers `HOME`; the system config and `include.path` targets are not watched.
- The first reconciliation runs before any git watch is open (`input-tracker.ts` `#reconcileOnce`), so a HEAD or `info/exclude` change during it is seen only by the periodic reconciliation.
- After a reconciliation that cannot establish the input set, an event reporting the fix requests no reconciliation, so results stay unknown up to `RECONCILE_INTERVAL_MS`.
- `input-filter.ts` `#dropRepository`: a nested repository whose check failed is then answered for by the enclosing repository's `check-ignore`.
- `git check-ignore` exits 128 for a path inside a submodule, which drops the whole repository to ignoring nothing (`input-filter.ts` `check`).
- `git-ignored.ts` `runGit`: an abort is reported as "git could not be run", a timeout does not name its bound; on Windows a bare `git` is also looked up in `%TEMP%` (the spawn's working directory) before `PATH`, and killing Git for Windows' `cmd\git.exe` launcher may leave the real git running.
- `daemon-main.ts` `serve`: `new InputTracker` (its `realpathSync.native`) can throw after `holdStore` succeeded, leaving the endpoint, key and lock to process exit.
- The `GIT_*` environment filter has copies in `packages/daemon/test/harness.ts` `fixtureRepository` and `test/scripts/git/git.test.ts`, the latter case-sensitive.

#### Test Coverage Gaps

Defect anchors the fix round moved, to re-anchor and re-prove: D1792 and D1887 (`test-states.ts`), D1909 and D1916 (`input-watcher.ts`, whose `#open` call gained an argument and reflowed), and D1650 and D1675 (`git-ignored.ts`). Every other record's `old` still matches exactly once.

| #   | Source                                                                                             | Defect                                                                                                                                                                                                                | Expected test                                                                                                                                                                                                     | Severity |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| G1  | `packages/daemon/src/query/test-states.ts` `positionUnvouched`                                     | A test the discovery lists as unique, answered by a run that marks it duplicate (an edit added a same-named test before the run), reads current while the discovery is not current, inheriting the new test's result. | query.test.ts: stored discovery lists `twin` once and is stale; the fingerprinted current run records two `twin` tests; the discovered `twin` counts unknown. Mutation: drop `recordedPositional` from the check. | CRITICAL |
| G2  | `test-states.ts` `positionUnvouched`, `summary.ts` `queryBasis`                                    | A duplicate-marked test never reads current even under a current discovery (`return test.isDuplicate`), or a stale discovery vouches for positions (`freshness !== UNKNOWN` for `=== CURRENT`).                       | query.test.ts: duplicates read current with a current discovery; duplicates read unknown with a discovery stored under a different digest (stale, not unfingerprinted).                                           | MEDIUM   |
| G3  | `summary.ts` `queryBasis` (`inputs: inputs.facts`)                                                 | An answer carries fixed input facts rather than those of the inputs it was answered from (AC8).                                                                                                                       | query.test.ts: a summary and a path status under settled inputs carry exactly those facts.                                                                                                                        | MEDIUM   |
| G4  | `summary.ts` `queryBasis`                                                                          | While no fingerprint can be computed, every workspace is listed unfingerprinted with the global reason.                                                                                                               | query.test.ts: `unfingerprintedWorkspaces` is empty under unsettled inputs.                                                                                                                                       | LOW      |
| G5  | `packages/cli/src/answer-text.ts` `inputLines`, `contextLines`                                     | The human answer drops the last reconciliation time (always "none has ended yet"), the changed-paths-not-read line, the unfingerprinted workspaces with their reasons, or the discovery freshness line.               | cli.test.ts: an answer with `lastReconciledAt`, `pendingChanges` > 0 and one unfingerprinted workspace prints each; a record for the discovery freshness line.                                                    | MEDIUM   |
| G6  | `answer-text.ts` `answerFields`                                                                    | `--json` loses `inputs`, `discovery.freshness` or `unfingerprintedWorkspaces`, under `schemaVersion` 1 (AC8).                                                                                                         | cli.test.ts: `summary --json` and `status --json` carry each field.                                                                                                                                               | MEDIUM   |
| G7  | `packages/daemon/src/inputs/input-tracker.ts` `beginJob`, `input-jobs.ts` `close`                  | A job started while the watcher is unhealthy or before the first reconciliation ended is stored fingerprinted once a no-change reconciliation restores health (AC3).                                                  | input-tracker.test.ts: lost events, `beginJob` before the reconciliation ends, `endJob` after it is not fingerprinted with the unsettled reason.                                                                  | MEDIUM   |
| G8  | `input-tracker.ts` `#changed`                                                                      | A later `change` overwrites a queued `rename` for the same path, so a replaced directory is not re-walked and keeps a dead Linux watch.                                                                               | input-tracker.test.ts over the inotify model: rename then change for a replaced directory in one batch; an edit inside moves the fingerprint.                                                                     | LOW      |
| G9  | `packages/daemon/src/inputs/input-state.ts` `liesUnder`, `replaceUnder`                            | A re-walk of the root keeps inputs that vanished and reports every input changed, raising the revision.                                                                                                               | input-tracker.test.ts: a re-walk of the root (a root child named like the root, on the model) changes no revision when nothing changed and drops a deleted input.                                                 | MEDIUM   |
| G10 | `input-tracker.ts` `#drainQueue`                                                                   | A batch read that throws leaves a job's end waiting until the next event.                                                                                                                                             | input-tracker.test.ts: a read that throws; `endJob` resolves not fingerprinted.                                                                                                                                   | MEDIUM   |
| G11 | `packages/daemon/src/inputs/input-watcher.ts` `watchGitFiles`, `input-tracker.ts` `#reconcileOnce` | A git-file watch that cannot open leaves the watcher unhealthy and every result unknown for the daemon's life.                                                                                                        | input-tracker.test.ts: a git-file watch failing with EACCES leaves the watcher healthy and names the file in `gitUnread`.                                                                                         | MEDIUM   |
| G12 | `packages/daemon/src/inputs/git-sources.ts` `gitSources`                                           | With the root outside git and a nested repository, a change to its `info/exclude` runs no reconciliation.                                                                                                             | input-tracker.test.ts: root not in git, nested repository; an `info/exclude` edit starts a reconciliation.                                                                                                        | CRITICAL |
| G13 | `packages/daemon/src/inputs/input-filter.ts` `enter`, `check`                                      | A nested repository's ignored paths are not read, so its build output counts as input; a failed `check-ignore` is not reported in `gitUnread` (AC1, AC7).                                                             | input-tracker.test.ts: a nested repository's `.gitignore` excludes a path; a check that fails names git in `gitUnread`.                                                                                           | MEDIUM   |
| G14 | `packages/daemon/src/daemon/lifecycle.ts` `#startSequence`                                         | A stop during the first reconciliation still launches the discovery.                                                                                                                                                  | lifecycle.test.ts: held reconciliation, stop, no discovery started.                                                                                                                                               | MEDIUM   |
| G15 | `lifecycle.ts` `#startSequence`, `unmoved`                                                         | The discovery's start time is taken after it ends; a run whose start fingerprint failed is bound to its end one.                                                                                                      | lifecycle.test.ts: the stand-in records `since` before the discovery; a failing start fingerprint then a good end one stores not fingerprinted.                                                                   | LOW      |
| G16 | `packages/daemon/src/selection/git-ignored.ts` `gitSpawnOptions`                                   | The asynchronous reader inherits `GIT_*` or runs git from the consumer's directory.                                                                                                                                   | Re-anchor D1650 and D1675 to the shared options; they now prove both readers.                                                                                                                                     | MEDIUM   |
| G17 | `git-ignored.ts` `gitIgnoredPaths`                                                                 | The synchronous reader keeps a listed directory git does not itself ignore, so selection skips it.                                                                                                                    | source-scan or workspace-graph test: `newdir/only.log` under `*.log`; the reader does not report `newdir`.                                                                                                        | LOW      |
| G18 | `packages/daemon/src/inputs/input-inventory.ts` `linkDigest`                                       | A link to a file is hashed by its target path, not its content, so an edit through it changes nothing.                                                                                                                | input-tracker.test.ts: an edit to a linked file's target under the root moves the fingerprint.                                                                                                                    | LOW      |
| G19 | `input-watcher.ts` `nearestDirectories`                                                            | A git file whose directory does not exist yet is watched by its own name, never matched when the directory appears.                                                                                                   | input-tracker.test.ts: HEAD names a ref in a missing directory; creating it starts a reconciliation.                                                                                                              | LOW      |
| G20 | `packages/core/src/evidence.ts` `assessFreshness`                                                  | A record stored with an empty digest reads stale against a present current fingerprint (`fingerprint === undefined`).                                                                                                 | core evidence test: `assessFreshness("", "revision-a")` is unknown.                                                                                                                                               | LOW      |
| G21 | `input-inventory.ts` `contentDigest`                                                               | A content hash ignores the stop signal, so a stop waits for a large file's whole read.                                                                                                                                | input-tracker.test.ts or a unit test: `readEntryDigest` with an aborted signal returns promptly, not a digest.                                                                                                    | LOW      |
| G22 | `input-tracker.ts` `#readPath`                                                                     | A file replaced by a directory under a `change` event is not walked, so the old file's digest stays.                                                                                                                  | input-tracker.test.ts: replace a file by a directory holding a file; the fingerprint drops the old file and counts the new one.                                                                                   | LOW      |
| G23 | `packages/daemon/test/input-tracker.test.ts` `drained`                                             | The helper returns silently at its deadline with changes pending, so a not-fingerprinted assertion after it can pass vacuously.                                                                                       | Make `drained` throw at its deadline with the pending count.                                                                                                                                                      | LOW      |
| G24 | `input-tracker.ts` `#readBatch`                                                                    | A `check-ignore` that fails for a path created after a reconciliation is never named in `gitUnread` or the log, though the path counts as an input.                                                                   | input-tracker.test.ts with a vi.mock of `readCheckedIgnored` returning a failure, or record it under Deliberately Untested.                                                                                       | LOW      |

Denominator: the touched test files hold 48 named-defect tests for 2.1 (D1877 to D1924) against the behaviors AC1 to AC11 name; the rows above are the behaviors none of them catches.

### Completion Notes

Built as the tasks say, delegating nothing: the inputs module is one dependency chain, and the answers group consumes its contract. Tasks 6, 7, 8, 9 and 10 were one typecheck unit (the `answer.ts` contract, its producer and its consumers) and were gated together.

- **Sanity check** (dev, about 11:14): F1, F2 and F4 confirmed by the author and applied to the ticket; F3 ruled Option A by the orchestrator at 11:19. The WSL runs were cleared by the orchestrator at 11:24, 11:48 and 12:07.
- **Inputs module** (`packages/daemon/src/inputs/`): `input-filter.ts` holds the one exclusions list (skipped names, the daemon's state directory and log file canonicalized to real paths, git's listed and checked ignored paths per repository), which 2.1b extends; `input-inventory.ts` walks and hashes (bounds 64 levels, 200,000 entries, 16 concurrent hashes); `fingerprint.ts` composes the digests and holds the AC11 seam `workspaceInputs`; `input-watcher.ts`, `git-sources.ts`, `input-state.ts`, `input-jobs.ts` and `input-tracker.ts` watch, locate git's files, hold the digests and revision, judge jobs and orchestrate. Files the ticket did not name: `input-filter.ts`, `git-sources.ts`, `input-state.ts`, `input-jobs.ts` (by responsibility, to stay under P16), and `packages/core/src/evidence.ts` and `index.ts`, which now export `assessFreshness`, the half of `assessEvidence` the discovery's freshness needs without an outcome.
- **Git's `--directory` listing** names an untracked directory whose every present entry is ignored even when `git check-ignore` denies the directory (reproduced on git 2.55). Both readers now confirm each listed directory: the tracker asks git about everything under an unconfirmed one, and the synchronous selection reader leaves it out, so selection enters it (which only widens). The synchronous reader also no longer lists the root itself from the trailing empty entry (pre-existing, harmless there).
- **`git check-ignore`** reports a file under an ignored directory, and a bare directory path matching a `dir/` pattern, as ignored (checked in a temp repository), so one check of a new directory's paths settles its subtree.
- **Windows**: a git operation in a `.git` inside the root can overflow the recursive watch's buffer (observed on a commit), which reads as lost events: the watcher goes unhealthy, a reconciliation runs, and a job spanning it is stored not fingerprinted (AC3).
- **Evidence without tests**, from a throwaway probe driving `InputTracker` against a temp git repository, run on Windows (Node 24.19.0) and in WSL (Node 24.19.0 and 22.23.3), deleted afterwards: an input edit changes the fingerprint and raises the revision; writes to a listed ignored directory, a new file matching an ignore pattern, the state directory and `node_modules` change nothing; an edit to a gitignored listed test module changes its workspace's fingerprint and not the revision; a directory tree created then deleted returns the prior digest; a second tracker over the same tree computes the same digest; a planted environment value and file content appear in no log line or fact; a job with an edit, or under a continuous writer, is not fingerprinted and names the path, and one with no edit or only an ignored write is. The probe caught and I fixed two defects before review: the Windows root watch was opened non-recursive, and an empty-queue drain looped as microtasks, starving timers. Reconciling this worktree took 251 ms with at most 20 ms of event-loop delay (Windows), and a stop took under 2 ms.
- **Adversarial review** (17 findings), triaged: fixed F1 (the listing quirk above), F2 and F3 (Linux watches of re-created directories), F4 (repository and global git config files and nested repositories' `info/exclude` watched), F5 (a discovery is not fingerprinted when a gitignored listed test module changed since it started, judged by modification time with a 2 s allowance), F6 (a watch that cannot open no longer re-requests reconciliations forever), F7 (the periodic reconciliation is timed from the last one's end), F8 (exclusions canonicalized), F10 (a job's end waits only for events seen before it), F11 (the Linux silent overflow stated in the watcher's contract), F12 (the answer field renamed `gitUnread` and documented for both of git's failures), F13, F14, F15 (the environment digest computed once per daemon life) and F16. F9 (a duplicate-marked test matched by position to a result from a discovery not current) went to the orchestrator as a fork with "leave it to 2.3"; ruled at 12:14 to fix it here, and built as the added AC11 task: `test-states.ts` rates a duplicate-marked test's finished result unknown while the discovery is not current, after the adapter-version check and before the digest comparison, from the same `discoveryFreshness` value AC8 answers. Discarded F17: core's rating of an empty fingerprint as unknown is pinned by `packages/core/test/evidence.test.ts`. Post-fix re-validation: lint and the targeted typecheck of core, daemon and cli, below, and the probe re-run on both platforms.
- **Validation**, final tree: `bun x oxlint` over every changed file exit 0, no warnings; `bun x prettier --check` clean; `bun run --filter @rt-test/core typecheck` 0, `--filter rt-test` (cli) 0, `--filter @rt-test/daemon` 1 with errors only in `test/lifecycle.test.ts` and `test/query.test.ts` (listed above); `node scripts/check-line-citations.mjs` clean. No test run.
- **Activity**: the daemon's activity stays `discovering` while it waits for the first reconciliation, which the answer's reconciliation state reports; a distinct activity would change the protocol's activity union.
- **Known limits** now built (for `docs/architecture.md`): a gitignored file a test reads that changes with no input edit (Q1); a file outside the root; `node_modules` changed without a lockfile or manifest edit, beyond the resolved Vitest version; unsaved editor buffers; an input change no event reports, seen by the next reconciliation up to 5 minutes after the last ended, which on Linux includes every inotify queue overflow (U1); a submodule whose `.git` is a file is watched for `info/exclude` through `rev-parse`, but its HEAD moves are seen only through the files they change.
- **README and `docs/architecture.md`** are orchestrator-owned: their exact replacement text went to the orchestrator in the dev report.

Change-request candidates, for `review-changes`:

- None. The orchestrator wrote the 8.3 short-path rule as C159. It is not cited in a comment at the watch, since `rt-test/no-nonlocal-comment` rejects a rule id in a comment; the `InputWatcher` docblock states the fact.

### File List

- `_agent-docs/tickets/2-1-track-inputs.md` (create-ticket; dev: resolutions, task and criterion boxes, record)
- `packages/daemon/src/inputs/input-filter.ts` (created)
- `packages/daemon/src/inputs/input-inventory.ts` (created)
- `packages/daemon/src/inputs/fingerprint.ts` (created)
- `packages/daemon/src/inputs/input-watcher.ts` (created)
- `packages/daemon/src/inputs/git-sources.ts` (created)
- `packages/daemon/src/inputs/input-state.ts` (created)
- `packages/daemon/src/inputs/input-jobs.ts` (created)
- `packages/daemon/src/inputs/input-tracker.ts` (created)
- `packages/daemon/src/selection/git-ignored.ts`
- `packages/daemon/src/selection/source-walk.ts`
- `packages/daemon/src/daemon/lifecycle.ts`
- `packages/daemon/src/daemon/daemon-main.ts`
- `packages/daemon/src/query/answer.ts`
- `packages/daemon/src/query/summary.ts`
- `packages/daemon/src/query/path-status.ts`
- `packages/daemon/src/query/test-states.ts`
- `packages/daemon/src/store/stored-records.ts`
- `packages/daemon/src/client.ts`
- `packages/core/src/evidence.ts`
- `packages/core/src/index.ts`
- `packages/cli/src/answer-text.ts`
- `README.md`, `docs/architecture.md`, `_agent-docs/code-review-checklist/daemon-cli-state.md` (C159) (orchestrator, from dev's text)
- No dependency change.

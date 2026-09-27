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

- [ ] AC1: The inputs are every file under the consumer root except `.git`, `node_modules`, the daemon's state directory and log file, and, inside git, every path git reports as ignored, in the consumer's repository and in each nested repository under the root. A path whose ignored status the daemon does not know is an input. Adding, editing, deleting or renaming an input changes the fingerprint of every Vitest workspace; the same operations on an excluded path change none.
- [ ] AC2: Each Vitest workspace's current input fingerprint is one digest over: the root-relative path and content of every input (every input of the project, until ticket 2.3 narrows it); a digest of the daemon's whole environment, names and values; the Node version, platform and architecture; the Vitest version that workspace resolves; the Vitest adapter version; and the selection policy version. Changing any one of them changes the digest. Computing it twice over the same inputs gives the same digest, on each of Windows and Linux, whatever the order the files are read in. No environment value or file content is stored, logged or answered, and no inventory of input paths is stored or answered; only digests. A planted environment variable value and a planted file's content appear in no stored record, log line or answer. AC3's log line and AC7's reasons may name individual paths.
- [ ] AC3: The daemon stores every discovery and every run bound to the digest of the inputs the job started from. A job during which any input changed, which started before the first reconciliation ended, during which a reconciliation ended unable to establish the input set (AC7), or during which the watcher was unhealthy, is stored not fingerprinted, so none of its results can read current, and the daemon's log names the job and the inputs that changed, or the reason. A reconciliation that runs during a job and finds no change leaves the job fingerprinted; a job ending while a reconciliation runs is judged when it ends.
- [ ] AC4: A finished result stored under another adapter version is stale, as today, whatever the inputs. Any other finished result is unknown when its run is not fingerprinted, when no current fingerprint can be computed, while a reconciliation is running, and while the watcher is unhealthy; otherwise it is current when its run's stored digest equals its workspace's current fingerprint, and stale when they differ. A test with no finished result stays unknown. A saved edit to an input makes every result it covers stale, or unknown while one of those conditions holds, in every answer given after the daemon has handled the edit's event.
- [ ] AC5: After a daemon start, every stored result not stale under another adapter version reads unknown until the first reconciliation ends. Then a result whose inputs are unchanged since it was stored, in an earlier daemon life or this one, reads current, and one whose inputs changed reads stale.
- [ ] AC6: A full reconciliation runs, and every result not stale under another adapter version reads unknown until it ends, at start, when the watcher reports an error or lost events, when HEAD or the ref it names moves (a checkout, reset, rebase, pull or commit), when a file git reads ignore rules from changes, and every `RECONCILE_INTERVAL_MS` (5 minutes) while the daemon runs. An input change the reconciliation finds that no event reported changes the fingerprint exactly as an observed edit does. A reconciliation that ends with every watch open and the input set established returns the watcher to healthy and reconciliation to complete; until one does, results stay unknown.
- [ ] AC7: An input set the daemon cannot establish in full (an input file or directory it cannot read, a directory watch it cannot open, a walk past a named bound) leaves every result it covers unknown, and every answer names the reason. It is never answered from a partial fingerprint as if complete. A git listing that cannot be run or read leaves no path ignored, as selection does, so every file counts as an input, and every answer and the log say git's ignored paths could not be read.
- [ ] AC8: Every summary and path status answer carries the input revision it was answered from, which rises each time the daemon observes an input change or a reconciliation finds one; whether reconciliation is complete, with its reason when it is not; the time the last reconciliation ended, absent before the first one ends; the watcher's health, with its reason when unhealthy; and whether the discovery it counts from is current, which it is only when its stored digest equals the discovery's current fingerprint under AC4's conditions for a result. `rt-test summary` and `rt-test status` print each of them, and `--json` carries each under the unchanged schema version.
- [ ] AC9: Tracking and reconciliation read files and run git only: they load no Vitest module, consumer config or test file, start no executor job, and begin only after the confirmed start is accepted. A query still starts nothing.
- [ ] AC10: While a reconciliation runs, the daemon still answers status and queries within `RESPONSE_BOUND_MS`, and a stop during one ends the daemon within 1.3's stop bound. The watchers and any git process the tracker started end with the daemon.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question) | Why it matters if wrong | How to check |
| --- | -------------------------- | ----------------------- | ------------ |
| U1  | How does Node's `fs.watch` surface events it lost? On Windows, is a `ReadDirectoryChangesW` buffer overflow reported (an event with a null filename, an `error`, or nothing)? On Linux, does libuv report an inotify `IN_Q_OVERFLOW` at all? | AC6 reconciles on a reported loss. If Linux never reports one, the periodic reconciliation is the only net there, and the known-limit text must say so. | Read libuv's `src/win/fs-event.c` and `src/unix/linux.c` at the version Node 22.13 and 24 bundle (`process.versions.uv`); on Linux, overflow a queue with a low `fs.inotify.max_queued_events` in WSL and watch what the listener receives. |
| U2  | On Windows, does one recursive `fs.watch` of the root report adds, edits, deletes and renames in subdirectories created after the watch began, and name the path relative to the root? | Q7's Windows design rests on it. | A timed exercise in a temp directory on Windows under Node 22.13 and 24. |
| U3  | On Linux, does a non-recursive `fs.watch` on a directory report a file created, written, deleted or renamed inside it, including a rename into or out of it, and a subdirectory's creation? What error does opening one past `fs.inotify.max_user_watches` give? | Q7's Linux design adds a watch per directory as directories appear, and turns a failed watch into an unhealthy watcher (AC7). | The same exercise in WSL under Node 22.13 and 24, then with a lowered `max_user_watches`. |
| U4  | For a linked worktree, which files move on a checkout, reset, commit or rebase, and does `git rev-parse --git-dir --git-common-dir` name where HEAD, the refs and `packed-refs` live? | AC6's HEAD trigger must watch the right files, which for a linked worktree lie outside the consumer root. | Create a linked worktree in a temp repository and run `git rev-parse --git-dir --git-common-dir --git-path HEAD` from it; watch which files each operation writes. |
| U5  | Which files does git read ignore rules from for a repository (every `.gitignore`, `.git/info/exclude`, `core.excludesFile`), and does `git ls-files --others --ignored --exclude-standard` honour each? | AC6 reconciles when one of them changes. A rules source outside the watched tree, such as a global excludes file, would change the ignored set unseen. | `git help gitignore` for the installed git, and `git config --get core.excludesFile`. |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing, and write each answer with the source location or observed output beneath the table.
- [ ] (AC1, AC7) Create `packages/daemon/src/inputs/input-inventory.ts`: list the inputs under the consumer root by AC1's exclusions, reusing `ignoredPathsReader` for git's ignored paths, without following a directory link, and bounded by named depth and entry limits whose breach ends the walk with no partial list and makes the inventory incomplete with a reason (C28, C25). Read and hash each input's content without blocking the daemon's event loop for long, and report every file or directory it could not read as incompleteness, never as a missing input, except a path that no longer exists when read, which is a deletion. Read no FIFO, socket or device file: count it as an input by its path and type.
- [ ] (AC2) Create `packages/daemon/src/inputs/fingerprint.ts`: compose each Vitest workspace's digest from the per-input digests (sorted by root-relative `/`-separated path, P13), a digest of `process.env`, `process.version`, `process.platform`, `process.arch`, the workspace's Vitest version from `resolveWorkspaceVitest`, `VITEST_ADAPTER_VERSION` and `SELECTION_POLICY_VERSION`. Compose the discovery's digest from the same parts as a workspace's (project inputs, environment digest, runtime, adapter and policy versions) with every listed workspace's Vitest version, computed at the discovery's end when the revision is unchanged since its start, since the workspace list is its output. Keep the function that narrows a workspace's input set a single seam 2.3 can replace, without building 2.3's narrowing.
- [ ] (AC1, AC6, AC7, AC10) Create `packages/daemon/src/inputs/input-watcher.ts`: on Linux, one non-recursive `fs.watch` per included directory, added and dropped as directories appear and vanish, with none on excluded directories; on Windows, one recursive watch of the root with excluded paths filtered (Q7). Watch HEAD, the ref it names and `packed-refs` through git's own directories, which for a linked worktree lie outside the root (U4), and each ignore-rule source (U5). Report a watch it cannot open, a watcher error or a reported loss as unhealthy with its reason. Close every watch on stop.
- [ ] (AC4, AC5, AC6, AC7, AC8, AC10) Create `packages/daemon/src/inputs/input-tracker.ts`: hold the per-input digests, the input revision, the reconciliation state, the last reconciliation end time and the watcher's health. Rehash only the paths an event names; run a full reconciliation on AC6's triggers and on the `RECONCILE_INTERVAL_MS` timer; raise the revision only when a digest actually changes. Expose the current fingerprint of each workspace and of the discovery (or none, with the reason, when AC4 or AC7 says unknown) and a way for a job to learn whether any input changed, or any event named an input, between its start and its end. Stop its timer, watchers and any git child on stop.
- [ ] (AC3, AC5, AC9) Change `packages/daemon/src/daemon/lifecycle.ts`: start the tracker in `begin()`, after the confirmed start is accepted; make the start sequence wait for the first reconciliation; take each job's bindings from the tracker at its start, and store it under that digest only when, from the job's start to its end, the tracker reports no input change and no event naming an input, no reconciliation ending unable to establish the input set, and the watcher healthy (a reconciliation that finds no change does not count against it), else not fingerprinted with a log entry naming the job and the inputs that changed (Q6). Stop the tracker in the stop sequence before the store closes.
- [ ] (AC9, AC10) Change `packages/daemon/src/daemon/daemon-main.ts` to build the tracker into `LifecycleParts` with the consumer root, the state directory and the daemon's log file as exclusions.
- [ ] (AC4, AC5) Change `packages/daemon/src/query/test-states.ts`: replace `CURRENT_FINGERPRINT` with each workspace's current fingerprint from the tracker, passed through `assessEvidence`, keeping the adapter-version check first and the unknown for a test with no finished result, in AC4's order.
- [ ] (AC8) Change `packages/daemon/src/query/answer.ts`, `summary.ts` and `path-status.ts`: add the input revision, reconciliation completeness with its reason when incomplete, the last reconciliation time (absent before the first), the watcher's health with its reason, and the discovery's freshness to `AnswerContext` and `DiscoveryFacts`, each a named field.
- [ ] (AC8) Change `packages/cli/src/answer-text.ts` to print each new field in the human answer; `--json` carries them through `answerFields` with `CLI_JSON_SCHEMA_VERSION` unchanged.
- [ ] (Support) Sweep the prose this ticket makes false, found by `rg` over tracked and untracked files for `not fingerprinted`, `NOT_FINGERPRINTED`, `CURRENT_FINGERPRINT`, `inputs are tracked` and `no result is current`, including at least: `README.md`'s freshness paragraph, `stored-records.ts`'s `InputFingerprint` docblock, and `docs/architecture.md` § Current implementation ("no result is current until inputs are tracked", "Nothing yet builds fingerprints", "stores each run as not fingerprinted") and § Identity and freshness where it now describes built behavior (C48, C55). `docs/architecture.md` is orchestrator-owned: edit it only under a grant `node scripts/file-claims.mjs grant-status` shows, otherwise report the exact text.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `ignoredPathsReader` and `IgnoredPaths` (`packages/daemon/src/selection/git-ignored.ts`): git's ignored paths for the root and each nested repository, with `core.fsmonitor` off, `GIT_*` removed and git run from outside the consumer (C158). Its `spawnSync` blocks the event loop for up to `GIT_TIMEOUT_MS`; if that holds the daemon past `RESPONSE_BOUND_MS` (AC10), add an asynchronous reader beside it sharing the arguments and environment, rather than a second copy.
- `walkWorkspace` (`packages/daemon/src/selection/source-walk.ts`) for the walk's rules only (no directory link followed, `node_modules` and `.git` skipped, `MAX_WALK_DEPTH`, `MAX_WALKED_ENTRIES`). It lists sources and configs of one package workspace and is synchronous, so the inventory walks the whole root itself; share its skip constants rather than restating them (C3, C4).
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
- FYIs agreed by the orchestrator at 10:08: the CLI's `schemaVersion` and the protocol version stay unchanged, since AC8's fields are additive (1.4's precedent). The input-set decision is reported as design-decision text, which the orchestrator places under `docs/design-decisions/`.
- Sizing, orchestrator at 10:08: proceed as-is, no split (§ Sizing).
- Stale or unknown, create-ticket at about 10:17, on the ticket review's question. A result stored under another adapter version reads stale whatever the inputs, since that fact needs no input (C124); every other finished result reads unknown while inputs are unsettled (a reconciliation running, the watcher unhealthy, no current fingerprint). Only the check order differs from the alternative, never whether a result reads current (AC4 to AC6).

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
- **A new path of unknown ignored status.** It counts as an input (Q1). The tracker may ask git whether it is ignored (`git check-ignore`, run as `ignoredPathsReader` runs git) before counting it; the next reconciliation settles it either way.
- **A test that writes into the consumer's tree.** A file a test writes under the root that git does not ignore is an input changed during the run, so that workspace's runs are stored not fingerprinted and never read current. That is NFR3 working. AC3's log line names the paths, and ticket 2.1b's declared non-inputs are the consumer's remedy.
- **A commit.** A commit moves HEAD, so it starts a full reconciliation (AC6), and every result reads unknown for its length, although nothing in the tree changed.
- **Discovery freshness.** The discovery is bound to the project's inputs and every listed workspace's Vitest version, so a test file added or deleted makes it stale. Rediscovery on such an edit is 2.3's scheduling; until then a new test is missing from the counts, and AC8's discovery freshness says the counts may be incomplete.
- **Responsiveness.** The daemon answers on one thread. Hashing tens of thousands of files, walking the tree and a synchronous git spawn must yield to the event loop so status, queries and stop stay within their bounds (AC10). Nothing here runs in the executor, which hosts Vitest only.
- **What 2.3 inherits.** A seam that maps a Vitest workspace to its inputs (the whole project here), the revision, and the job fingerprint check. 2.3 narrows the seam with the dependency information its selection uses, turns a not-fingerprinted job into its invalidated state, and replaces the start sequence, which today reruns every workspace at start even when its results read current (NFR1 is 2.3's).
- **Known limits, each to be named in `docs/architecture.md`:** a gitignored file a test reads (build output, generated code) that changes with no input edit (Q1); a file outside the consumer root a test reads; `node_modules` changed without a lockfile or manifest edit, beyond the resolved Vitest version; an input change no event reports, for up to `RECONCILE_INTERVAL_MS` (Q5, U1); unsaved editor buffers (plan.md § Core experience).
- **Unanalyzed:** case-insensitive path collisions on Windows (two spellings of one file); hard links; a consumer root on a network drive, where watch events are unreliable; the CPU cost of a full reconciliation against plan.md's idle target of below 1% averaged over one idle minute, which M1's benchmarks measure.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.1` over the target files and folders named ticket 1.4 (review) and ticket 2.3 (backlog). The 2.3 hit is its sprint scope's substring "inputs", not a file it names.

- **1.4** creates `packages/daemon/src/query/`, `packages/cli/src/answer-text.ts`, `query-client.ts` and the query parts of the protocol, server and lifecycle, which this ticket edits after 1.4 lands: sequential, not a collision.
- **2.1b** (declared non-inputs, Q2) adds a consumer's list of non-input files to AC1's exclusions. This ticket leaves the inventory's exclusions one list 2.1b can extend.
- **2.3** narrows each workspace's inputs (Q3), records an invalidated run and reruns it (Q6), replaces the start sequence, reports setup files and aliases from discovery, and runs selection in a child process. This ticket builds none of them.
- **2.4** binds `wait` to the input revision AC8 publishes.
- **2.5** measures NFR1 and NFR2 over an edit corpus, reading the freshness this ticket computes.

#### Sizing

About 22 raw files, 29 estimated, and 11 code units (10 criteria plus validation). Production: 10 to modify (`lifecycle.ts`, `daemon-main.ts`, `test-states.ts`, `answer.ts`, `summary.ts`, `path-status.ts`, `stored-records.ts`'s docblock, `answer-text.ts`, `README.md`, `docs/architecture.md`) and 4 to create (the inputs module). Tests, for create-tests: `lifecycle.test.ts`, `daemon.test.ts`, `server.test.ts`, `query.test.ts`, a new inputs test file, the daemon `defects.json`, `cli.test.ts` and the CLI `defects.json`. `git-ignored.ts` joins if AC10 needs its asynchronous reader. The work splits into three disjoint groups: the inputs module; the lifecycle wiring; the answers and the CLI text. The orchestrator ruled to proceed with no split at 10:08. Implementation is delegated to implementer agents, since the estimate is over 10.

#### Current structure of the modified files

- `packages/daemon/src/daemon/lifecycle.ts`: `DaemonLifecycle` takes `LifecycleParts` `{ identity, scope, start, store, log, executor, closeEndpoint }`. Its constructor fixes `#bindings` as `{ ...scope, inputFingerprint: { kind: NOT_FINGERPRINTED } }`, used by every `writeDiscovery` and `writeRun`. `begin()` runs `#startSequence` (discover, store, run each confirmed workspace once), then idles. `summary()` and `pathStatus()` read `store.readLatestResults(scope)` and answer through `summaryAnswer` and `pathStatusAnswer` with a `DaemonView`. `#stopSequence` aborts the executor, awaits the sequence, closes the executor, the store, then the endpoint.
- `packages/daemon/src/daemon/daemon-main.ts`: `serve()` builds `LifecycleParts` after `holdStore` opens the store; `consumerRoot` and `stateDirectory` come from `process.argv`; the log is `DaemonLog(daemonLogFile(stateDirectory, worktreeIdentity))`.
- `packages/daemon/src/query/test-states.ts`: `testStandings(discovery, latestRuns)` gives each discovered test one `TestStanding` `{ test, state, freshness }`; `finishedFreshness` returns stale for another adapter version, else `assessEvidence({ fingerprint, outcome }, CURRENT_FINGERPRINT).freshness`, where `NO_FINGERPRINT = ""` stands for not fingerprinted.
- `packages/daemon/src/query/answer.ts`: `AnswerContext` `{ consumerRoot, currentAdapterVersion, discovery: DiscoveryFacts, activity, unstoredJobs }`, `DiscoveryFacts` `{ discoveryId, adapterVersion, adapterVersionCurrent }`, `SummaryAnswer`, `PathStatusAnswer`, the state and freshness constants; it imports only types so the CLI loads it without `node:sqlite`.
- `packages/daemon/src/query/summary.ts`: `summaryAnswer(results, daemon)` and `queryBasis`, which builds the `AnswerContext`; `DaemonView` picks `consumerRoot`, `activity` and `unstoredJobs` from `StatusResponse`.
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

<!-- CHECKLIST_RULE_IDS: C3,C4,C8,C10,C12,C25,C28,C30,C32,C38,C41,C48,C55,C57,C59,C113,C114,C115,C116,C117,C119,C120,C122,C124,C140,C147,C149,C150,C151,C157,C158 -->

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
sizing_ac_count: 11
files_to_modify:
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/daemon-main.ts
  - packages/daemon/src/query/test-states.ts
  - packages/daemon/src/query/answer.ts
  - packages/daemon/src/query/summary.ts
  - packages/daemon/src/query/path-status.ts
  - packages/daemon/src/store/stored-records.ts
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

- `_agent-docs/tickets/2-1-track-inputs.md` (create-ticket)

# Ticket 2.3p: Events on listed files git ignores

## Ticket

As an agent editing a file the discovery lists that the inputs leave out (a generated test module git ignores, a `.env.local`, a setup file a package ships),
I want the daemon to see that edit as it sees an edit to any input, and to count every listed setup file as an input of its workspace,
so that its rerun starts at once rather than at the next periodic reconciliation, and no result reads current over a setup file that changed.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: A file the discovery in effect lists by path (a test module, a setup file, a global setup file, or an env file ticket 2.3m lists) that lies under the consumer root, when the inputs leave it out for any reason (git ignores it, or it lies under `node_modules`), has its changes observed as an input's are, on Windows and on Linux: creating, editing, deleting or replacing the file, retargeting a link at its path, and deleting, creating, renaming or replacing a directory it lies under. Each such change is read as an event on an input is read: when the file's digest changed, the input revision rises; each job running then is marked as an input change marks it, unless the read finds the file's content digest, size, modification time and change time equal to the tracker's last read of it, taken at least 2 s after both times (ticket 2.3's rule), which counts as no change; and the next round's selection names it among the changed paths and explains what it selected. A reconciliation reads each such file again, as it reads every input. On Linux, a file whose watch cannot open has its changes observed only by that reconciliation (decision (e)). None of this changes a fingerprint: every fingerprint still reads such a file afresh when it is composed, and a workspace that does not list the file does not count it.
- [ ] AC2: For ticket 2.3k's hold, a change to such a file is a change to an input: one the tracker records in a running run's or discovery's window is job-caused, and any other, a file a new discovery comes to list or stops listing included (decision (a)), is an edit, which reaches each workspace whose inputs it lies in (AC4) and releases a hold on it. An edit to such a file between jobs reaches the change record as an edit to an input does, though no fingerprint holds the file's digest: the digests the record compares at each job's edges and at each round count such a file by the tracker's read of it, so a changed read is a path that differs between them. So a test that writes new content to its workspace's gitignored setup file on every run is held after three runs, and an edit to that file releases the hold.
- [ ] AC3: A discovery during which such a file, listed by the discovery in effect when it began and, on Linux, with its watch open (decision (e)), is replaced by content that keeps the file's modification time, has a link at its path retargeted to an older file, or is deleted, is stored not fingerprinted, and the log names the file. A file only the new discovery lists is checked at the discovery's end by its modification time, as today.
- [ ] AC4: Each setup file, global setup file and env file the discovery lists for a workspace lies inside that workspace's inputs wherever a listed test module does: in judging a run of it (ticket 2.3h), so a change to one while the run runs keeps the run from being stored under its fingerprint and, once a newer revision's narrowed dependency build has ended, interrupts it; and in ticket 2.3k's count.
- [ ] AC5: Each setup file and global setup file the discovery lists for a discovered workspace is an input of that workspace, whatever git ignores and wherever it lies: an edit to one the inputs leave out changes that workspace's fingerprint and the discovery's at the next composition; one with nothing at its path digests as absent, so creating or deleting it changes both; and one that cannot be read leaves the workspace and the discovery with no fingerprint, the reason naming the file, as for a listed test module. A workspace whose setup and global setup files the selected inputs all count keeps the fingerprint it had before this change.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It relies on `fs.watch` reporting events under a directory git ignores on Windows, which the tracker already receives and drops (`InputTracker.#changed`), and on a Linux directory watch reporting its own entries and its own removal, which the tracker's per-directory watches already rely on (`InputWatcher.watchDirectory`, § Settled from the code).

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read the landed code of ticket 2.3k and confirm the names § Current structure gives as it lands: the job window's `startDigests` and `endDigests` and the tracker's `#vouchedDigests` (`inputs/input-jobs.ts`, `inputs/input-tracker.ts`), `ChangeRecord.observed` and `jobEnded` (`daemon/change-record.ts`), the scheduler's `observed(view.inputs.snapshot?.digests)` call, and `placeFor`, `pathsInside` and `roundPlacement` (`daemon/run-judgment.ts`). Check whether ticket 2.4d has landed: its named read routes through the tracker's event path, which this ticket extends. Measure the code lines of `input-tracker.ts`, `scheduler.ts` and `run-judgment.ts` (P16), and re-run the searches in § Existing tests this change breaks. After this ticket the revision can rise while `digests` holds still, so list every reader of `ProjectInputs.digests`, `snapshot` and the input revision (`rg -n "\.digests\b|\.snapshot\b|facts\.revision|\.revision\b" packages/daemon/src`) and confirm each either reads the accessor over both or stays right when the revision rises with `digests` unchanged (C38, C39); report any other through the sanity check. Confirm too that selection explains a changed path the inputs leave out as decision (d) says.
- [ ] (AC4, AC5) In `packages/daemon/src/inputs/protection.ts`, export one listing of the files the discovery lists by path for one workspace: its test modules (`workspaceTestModules`), each reported project's setup and global setup files, and its env files (`workspaceEnvFiles` while known, none otherwise), keeping the env files apart, since `protectedFileChangedSince` reads an absent one as unchanged. Build `protectedModules` and `protectedFiles` as the union of it over the discovered workspaces, so protection, the fingerprint, run judgment, ticket 2.3k's count and the tracker read one list (C8).
- [ ] (AC5) In `packages/daemon/src/inputs/fingerprint.ts`, digest in `workspaceFingerprint` each setup and global setup file that listing gives the workspace, and in `discoveryFingerprint` those of every discovered workspace, by the rule `unselectedModuleDigests` applies to a listed test module (skipped when the selected inputs count it, the held digest when the project's inputs hold it, otherwise read afresh, absent when nothing is there) and under the part of the digest the test modules use, so a workspace whose setup files the selected inputs all count keeps its digest (AC5's last sentence). A setup file that cannot be read gives a reason naming it as a setup file.
- [ ] (AC4) In `packages/daemon/src/daemon/run-judgment.ts`, take the listed files of the workspace from the listing in place of every `workspaceTestModules(entry)` that builds the set `placeFor` places inside whatever selection says, found by `rg -n "workspaceTestModules" packages/daemon/src` (as 2.3k landed: `RunWatch`'s `#testModules` and `pathsInside`, both handed to the one private `placeFor`; `roundPlacement` only chooses the `ChangePlacement`), so run judgment and the count place one set (C8). Rename `placeFor`'s `testModules` parameter and `RunFacts.testModules` to say listed files, and its docblock's "a listed test module". Keep the rule as it is: a listed file lies inside whatever selection says, and joins the paths that interrupt only under a narrowed build's placement.
- [ ] (AC1) In `packages/daemon/src/inputs/fingerprint.ts`, give `ProjectInputs` the held digests of the listed files the inputs leave out, apart from `digests` (an optional constructor argument, so every existing construction still compiles), and one accessor over both, the digests a comparison of two moments reads. `digest()`, `digests`, every narrowing and fingerprint, `heldDigest` and `heldEnvDigest`, and `protectedFileChangedSince`'s check of what the inputs hold stay over the inputs alone (AC1's last sentence, decision (b)): a fingerprint that took the tracker's held read would let a missed event leave a result reading current, and an end check that skipped a held listed file would drop decision (b)'s backstop.
- [ ] (AC1) In `packages/daemon/src/inputs/input-state.ts`, hold an `InputRead` for each listed file the inputs leave out, apart from the inputs, set, removed and replaced by the rule `set` applies to an input: a changed digest makes `commit` raise the revision, and the returned flag says whether a write may have landed, which decides the mark. `project()` passes them to `ProjectInputs` as the task above adds.
- [ ] (AC1, AC2, AC3) Create `packages/daemon/src/inputs/listed-files.ts`, so the tracker stays under lint's cap (P16, P18): the set of files the discovery in effect lists (the listing, over every discovered workspace) that lie under the consumer root (`liesUnderRoot`) and that the current `InputFilter` excludes; whether an absolute event path names one of them or a directory above one, compared as protection compares a listed file (case-folded on Windows, `caseComparable`, exported rather than restated, C8); and the listed spelling of each, which is the key its held read and every job-window path use, so run judgment's and the count's exact comparison with the listing finds it (C42).
- [ ] (AC1, AC2, AC3) In `packages/daemon/src/inputs/input-tracker.ts` and `packages/daemon/src/inputs/queued-reads.ts`, through that module: in `#changed`, queue an event on an excluded path that names such a file or a directory above one, as any event is queued (the ledger, the pending count), where today it returns; the declaration file and a declared non-input keep their branches. In `QueuedReads.read`, read each such file at or under the path through `readEntryDigest` into the input state's held reads, in place of skipping the path, and record each one whose read can ride a write in every open window by its listed spelling. At each reconciliation, recompute the set under that reconciliation's filter, since an ignore-rule change moves a file between the inputs and the set, drop each held read of a file the inputs now count, so no path is held twice, then read every such file again beside the inventory and record each changed one as `establish` records a changed input. When `protectInputs` gives a discovery, before the first reconciliation included, recompute the set, read each file that became listed quietly, as protection's flipped paths are read (marking no job), and drop each held read no longer listed; either change moves the revision (decision (a)). The digests ticket 2.3k's window keeps at its edges (`#vouchedDigests`, taken in `beginJob` and in `endJob` after `settled()`) read `ProjectInputs`' accessor over both (AC2, decision (f)). `#vouchedDigests` repeats the gate `currentInputs` applies to `snapshot` (no digests while `#unavailableReason()` gives a reason, else `project()`'s); keep the two one rule, a shared function or `#vouchedDigests` reading the view's snapshot, so the window's edges and the round's `observed` compare the same map and no interval shows every listed path as changed.
- [ ] (AC1) In `packages/daemon/src/inputs/input-watcher.ts`, on Linux, keep a set of watches for those files apart from the tree's, as `watchGitFiles` keeps the git files' apart, so neither `keepDirectories` nor `dropDirectory` closes one: each file through its nearest existing directory, filtered to the entries leading to it (`nearestDirectories`), each event reported through the listener's `changed`; replaced at each reconciliation, whenever the listed set changes, and whenever an event names an entry on the way to a listed file, opening the new watch before the files under it are read so nothing created between goes unseen. Open each on its real path (C159) and drop a replaced watch's late events (C157). A directory the tree watches needs no second watch only while the tree keeps it: recompute the set whenever `keepDirectories` or `dropDirectory` closes a tree watch it relied on. A listed file's watch that cannot open is logged once at warning level and leaves the watcher healthy, so that file's change waits for the next reconciliation (decision (e)). On Windows the recursive watch covers them and this is a no-op.
- [ ] (AC1, AC2) In `packages/daemon/src/daemon/scheduler.ts`, have the round's `changedPaths(before, now)` and ticket 2.3k's `this.#runs.observed(...)` read `ProjectInputs`' accessor over both, in place of `snapshot?.digests`, so a round explains such a change and the change record measures an edit to such a file between jobs (AC2, decision (f)).
- [ ] (Support) Send the orchestrator the doc text in § Doc text, its final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` and `bun x prettier --check` over the changed files, and `bun run --filter @rt-test/daemon typecheck` (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `protectedFiles`, `protectedModules`, `reportedProjects` and `caseComparable` (`inputs/protection.ts`): the discovery's listed files, and how a listed name is compared on each host; the new per-workspace listing replaces their private assembly (C8).
- `workspaceTestModules` (`inputs/non-inputs.ts`) and `workspaceEnvFiles` (`inputs/env-files.ts`): a workspace's listed test modules and env files.
- `unselectedModuleDigests`, `heldDigest`, `SnapshotReads.moduleDigest` (`inputs/fingerprint.ts`): the rule a listed test module is digested by, which setup files take.
- `readEntryDigest`, `InputRead`, `MODIFIED_TIME_RESOLUTION_MS` (`inputs/input-inventory.ts`): a read that follows a link to a file, moves its stamp on a retarget, and holds a FIFO by its type without opening it.
- `InputState.set`, `restedSince` and `commit` (`inputs/input-state.ts`): the access-time rule and the revision's rise, which the held reads take.
- `QueuedReads` and `#queueQuietly` (`inputs/queued-reads.ts`, `inputs/input-tracker.ts`): an event's read and a read that marks no job.
- `nearestDirectories` and `watchGitFiles` (`inputs/input-watcher.ts`): watching a file through its nearest existing directory, filtered to the entries leading to it, as a set apart from the tree's.
- `liesUnderRoot` (`inputs/protection.ts`), `absoluteInputPath` (`inputs/input-filter.ts`), `relativePosixPath` (`vitest/find-workspaces.ts`).
- `changedPaths` (`daemon/round-selection.ts`), and ticket 2.3k's `ChangeRecord` (`daemon/change-record.ts`) and `pathsInside` (`daemon/run-judgment.ts`).

### Must Create

- `inputs/listed-files.ts`: the listed files the inputs leave out, the lookup of an event path, and their listed spellings (AC1 to AC3).
- The per-workspace listing in `inputs/protection.ts` (AC4, AC5).
- `ProjectInputs`' held listed digests and its accessor over both (AC1).
- The Linux watch set for listed files in `inputs/input-watcher.ts` (AC1).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Drafted in Tree 1 (`wt/1` at 345b57e, `main`'s latest committed tree) on 2026-09-29, while ticket 2.3k builds in the main checkout and writes `inputs/input-jobs.ts`, `inputs/input-tracker.ts`, `daemon/run-judgment.ts`, `daemon/scheduler.ts`, `daemon/run-history.ts`, `daemon/lifecycle.ts` and a new `daemon/change-record.ts`. This ticket builds only after 2.3k lands, so its tasks and § Current structure describe the tree 2.3k leaves; the names taken from 2.3k were read in its reviewed working tree in the main checkout at 23:03, as it lands, and are re-verified by the first task. Build order: 2.3m, 2.3q (landed), 2.3k, then this ticket, then 2.3n and 2.3o.

Sprint scope, quoted (§ Ticket 2.3p): "an event naming a file the discovery lists by path (a test module, setup file, global setup file, or an env file from ticket 2.3m) moves the input revision and reaches running jobs as an event on an input does, even when git ignores the file, so the edit is rerun promptly". "It also closes what the modification-time check at a discovery's end misses for such a file: a replacement that keeps the file's modification time, and a link at the listed path retargeted to an older file". "And it makes each listed setup and global setup file an input of its workspace whatever git ignores, digested into both fingerprints as a listed test module is". "One rule covers every listed file; for a gitignored test module the change is intended: a prompt rerun, with no change to any freshness". "It also places each env file 2.3m lists inside its workspace for run judgment, as a listed test module is". "A listed file outside the consumer root stays unwatched, a known limit."

Requirements (`docs/requirements.md`):

- FR6: "Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current." (AC1, AC3, AC5)
- FR8: "Execute every selection in the daemon, and record a run whose inputs changed while it ran as invalidated and rerun it from stable inputs; a workspace or discovery that keeps becoming due only through changes the daemon's own runs and discoveries made to the same file is held until an edit, and every answer says why." (AC1, AC2, AC4)
- NFR3: "Never report a result as current unless its stored input fingerprint matches the current inputs." (AC5: today an edit to a gitignored setup file after a run is stored leaves that run reading current)

Rule clauses the criteria rest on:

- C117: "A new input kind (config, setup file, fixture, lockfile, declared environment input, runtime or runner version) joins the fingerprint in the change that starts depending on it." (AC5)
- C115: "A watcher overflow, missed event, branch switch or startup before reconciliation marks every result it could affect as unconfirmed or stale, never none." (AC1: a reconciliation reads each listed file again; AC2 and decision (a): a newly listed file is an edit, which never holds)
- C116: "A run whose inputs changed while it ran is recorded as invalidated and rerun from stable inputs". (AC3, AC4)
- C129: "Each selected test carries its reason, and each broad fallback names the input or uncertainty that triggered it." (AC1: the round explains the change)
- C8: "Two expressions in one scope must not answer the same question differently". (one listing for protection, the fingerprint, run judgment, the count and the tracker)
- C42: "A read that normalizes an identifier (case, trimming, aliasing) returns a key the matching write or lookup side accepts unchanged." (the listed spelling as the window's key)
- C159 and C157: every new watch opens a real path, and a replaced watch's late events are dropped.

Glossary (`docs/glossary.md`), verbatim:

- **Input**: "A file whose content RT Test treats as able to change a test's result."
- **Input revision**: "The number naming a worktree's inputs as the daemon last observed them in its current life, raised once for each batch of changes it observes."
- **Reconciliation**: "Reading every input again to establish the current input fingerprints, without relying on change events."
- **Edit**: "A change to an input that the daemon does not attribute to one of its own runs or discoveries."

A listed file the inputs leave out is an input of its own workspace (architecture.md: "Every test module the latest discovery lists is also an input of its own workspace, whatever git ignores"), so each term applies to it unchanged; this ticket adds no term.

#### Settled from the code

Read on `wt/1` at 345b57e, 20:31 to 20:40.

- **Where the event is dropped.** `InputTracker.#changed` returns on `this.#filter?.excludes(path) === true`, before the path is queued, and `QueuedReads.read` skips an excluded path (`if (filter.excludes(path)) { ... continue; }`). `InputFilter.excludes` excludes a path under a skipped directory name (`SKIPPED_DIRECTORIES`: `node_modules`, `.git`), under an exclusion (the state directory and log), `rt-test.json` at the root, and a path git ignores or lies under one git ignores. So on Windows, whose one recursive watch covers the root, the event arrives and is dropped; on Linux no watch covers a directory git ignores.
- **Why the rerun waits today.** The input revision rises only in `InputState.commit`, when a held input's digest changed; an excluded file is held nowhere, so its edit moves no revision. The scheduler plans at a new revision or a periodic reconciliation, and ticket 2.3f's `ranAlready` refuses a second run at a revision already run, so a stale workspace whose revision holds waits up to 5 minutes (`RECONCILE_INTERVAL_MS`).
- **Answers already read it stale.** `unselectedModuleDigests` and `envFileDigests` (`inputs/fingerprint.ts`) read a listed test module or env file the inputs leave out afresh at each composition, through `SnapshotReads`, so AC1 changes no answer's freshness.
- **Linux watches.** `InputWatcher` opens one watch per included directory before listing it (`watchDirectory`), closes each directory the latest inventory did not walk (`keepDirectories`), and closes a directory's watches when it is replaced, removed, or found ignored (`dropDirectory`). The git files are watched as a set apart (`watchGitFiles`), each through its nearest existing directory filtered to the entry leading to it (`nearestDirectories`), replaced at each reconciliation. A removed watched directory is reported under its own path (`watchDirectory`'s handler).
- **The discovery's end check.** `protectedFileChangedSince` stats each listed file the project's inputs do not hold and fails the discovery's fingerprint when its modification time is at or after the discovery's start less `MODIFIED_TIME_RESOLUTION_MS`; a missing test module or setup file counts as changed and a missing env file as unchanged. `lifecycle.ts` runs it before `protectInputs` in `#protectDiscovered` and again once the fingerprint is composed in `#discover`. `statSync` follows a link, so a link retargeted to an older file, or content replaced with its modification time kept, passes it. A path recorded in the discovery's own window already stores it not fingerprinted with the path named: `JobWindows.close` gives the reason `its inputs changed while it ran: <paths>` (`CHANGED_WHILE_RUNNING_REASON` and `namedList`, `inputs/input-jobs.ts`), `#protectDiscovered` returns that verdict unchanged, and `#bindings` logs `the discovery is stored not fingerprinted: <reason>`. So AC3 needs no edit to `lifecycle.ts`.
- **Every listed path's directories are real.** `rootRelativeTo` (`vitest/selection-facts.ts`) names each setup file, global setup file and env directory through `session.locate`, whose `moduleLocator` takes `realpathSync.native` of the path (`vitest/module-tests.ts`), as a test module's path is named. So a watch opened on a real directory (C159) reports an event under the listed spelling of every directory above the file; only an env file's own name, which `projectEnvFiles` joins to the real env directory, can be a link (§ Known limits).
- **Setup files today.** `protectedModules` lists them and `protectedFileChangedSince` checks them, but `workspaceFingerprint` and `discoveryFingerprint` digest only listed test modules and env files beside the inputs, so a setup file the inputs leave out enters no fingerprint (2.3i's review debt, dispositioned by the orchestrator at 18:35 into this ticket).
- **Run judgment's listed rule.** `placedInside` (`daemon/run-judgment.ts`) puts every changed path in `RunWatch`'s `#testModules` (`workspaceTestModules(entry)`) inside, and adds it to the interrupting paths only under a narrowed placement. Env files and setup files are placed only by selection today.
- **The reads that fit.** `readEntryDigest` (`inputs/input-inventory.ts`) digests a file's content through a link to a file, stamps a link to a file with the later of the link's and the file's times so a retarget moves the stamp, holds a FIFO, socket or device by its type without opening it, and a link to anything else by its target. `InputState.set` applies ticket 2.3's access-time rule (`restedSince`).
- **What 2.3k compares.** Its window keeps `this.#state.project().digests` at each edge (`#vouchedDigests`), and its scheduler hands `view.inputs.snapshot?.digests` to the change record at each plan, which measures an edit as `changedPaths` between two such maps. The round's selection compares `snapshot?.digests` too. A listed file held apart from `digests` is in none of them until the scheduler and tracker tasks point them at `ProjectInputs`' accessor.

#### Questions and answers

- Q1 (AC1), asked by create-ticket at 20:41, answered by the orchestrator at 20:41: which listed files get events. Every listed file under the consumer root that the inputs leave out, whatever excludes it (git, or a skipped directory such as `node_modules`), one rule. Reason: it matches how `fingerprint.ts` already reads an unselected listed test module, and a package's setup file that changes on a reinstall then reruns promptly. What stays a known limit: a listed file outside the root.
- Q2 (AC1), 20:41, orchestrator: on Linux, watch each such file through its nearest existing directory, filtered to the entries leading to it, re-armed as events name those entries or the listed set changes, reusing the git files' pattern; an event naming a directory above a listed file reads every listed file under it, on both platforms. Reason: a codegen step that deletes and regenerates its gitignored output directory is the common way such a file changes, and a watch on the file's directory alone dies with it.
- Decided by create-ticket at 20:41, not vetoed by the orchestrator at 20:41, each failing toward an extra round or staleness only:
  - (a) When a new discovery comes to list, or stops listing, such a file, the held reads change and the input revision moves, which costs one more round and dependency build; ticket 2.3k's change record sees the change as an edit, which resets counts and never holds (C115). The revision then moves exactly when the digests the rounds and the change record compare change.
  - (b) The discovery's modification-time check at its end stays for every listed file, as the backstop for a file only the new discovery lists and for an event missed; the events close the kept-time replacement and the older-link retarget for a file the discovery in effect when it began listed (AC3).
  - (c) Setup files are digested under the part listed test modules use, so a workspace whose setup files the selected inputs already count keeps its fingerprint across the upgrade, and a workspace with a package's setup file (under `node_modules`) reads stale once and reruns once. The doc text says so (orchestrator, 20:41).
  - (d) The round's selection explains such a change as it explains any changed path, since selection places a path by where it lies, never by whether it is an input: its owning package workspace is a direct target, and a path the root owns while other package workspaces are listed, such as one under the root's `node_modules`, takes the root's broad fallback, which the explanation names (architecture.md, the selection paragraph: "a path owned by the root while another package workspace is listed ... select every Vitest workspace"). The first task confirms it on the landed code and reports any other outcome through the sanity check (ticket review F8).

- Ticket review, one ticket-internal reviewer, 20:46 to 20:51, 14 findings, triaged by create-ticket at 20:53. Applied: F1 as a settled fact (a path in the discovery's window already stores it not fingerprinted and logs the path, so `lifecycle.ts` stays off the list); F2 (AC2 attributes by window, a newly listed file an edit); F3 (AC2's example writes new content); F4, the question, answered by keeping decision (e) and stating its limit, since a run's end fingerprint catches the change and only a discovery can store over it (AC1, AC3, § Known limits, § Doc text), which the orchestrator kept at 20:55; F5 (the fingerprint's held digests and the end check stay over the inputs alone); F6 (the set is recomputed at each reconciliation); F7 (every placing call site, by search); F8 (decision (d) states the root's broad fallback, and the first task confirms it); F9 (wider searches, run at 20:52); F10 (the doc text states current truth); F11 (a listed file outside the root still does not interrupt a run); F13 (the first task audits every reader of the revision and the digests); F14 (the tree watch a listed file relies on is re-checked when it closes). Rejected: F12, since every listed path's directories are real paths (§ Settled from the code), so a real-path watch reports the listed spelling, and only an env file's own name can be a link, which § Known limits already states.

- 2.3k's review notes, relayed by the orchestrator at 23:03 as 2.3k lands: the job window carries `startDigests` and `endDigests`; placement is the one private `placeFor`, typed `ChangePlacement`; `#vouchedDigests` repeats `currentInputs`' gate; a window ends in `endJob` after `settled()`. And a required behavior: a listed file the inputs leave out is read afresh and held in no committed digest, so once its events reach job windows a run that rewrites it raises 2.3k's count, but a later edit to it between jobs would never appear in `changedPaths(from, to)` and never release the hold. Applied by create-ticket at 23:04 as AC2's second sentence and decision (f); § Current structure and the tasks now read 2.3k as landed (re-read in the main checkout at 23:03).

#### Decisions taken here

- **(f) A between-jobs edit to a listed file reaches 2.3k's record through the digests it diffs** (create-ticket, 23:04; not vetoed by the orchestrator at 23:05, for the three reasons below; its 23:03 note offered this or recording an event outside any window as an edit). The tracker's held read of each such file joins the map `ProjectInputs`' accessor gives, which the window's edges (`#vouchedDigests`) and the round's `observed` both read, so `changedPaths(from, to)` names the file when its digest moved between jobs. Chosen over an event-recorded edit for three reasons. It keeps one measure of an edit, a digest difference, as 2.3k defines it (C8). It also counts an edit an event missed, since a reconciliation's re-read changes the held digest. And an event whose read finds the digest unchanged (a last-access event, a save of identical bytes) is no edit, as for an input, where an event-recorded edit would release a hold on it.

- **(e) A listed file's watch that cannot open leaves the watcher healthy** (create-ticket, 20:45; with the limit ticket review F4 found, decided by the orchestrator at 20:55: marking every job while such a watch is down would leave every discovery unfingerprinted for as long as the inotify limit is spent, and (e) leaves that one file where today's behavior already leaves it). A tree watch that cannot open makes the watcher unhealthy, so no result reads current, because an input edit it misses would leave a stale fingerprint; a listed file's edit between jobs cannot, since every fingerprint reads the file afresh, so only its rerun waits, for the next reconciliation. A run spanning the edit is caught too, since its end fingerprint reads the file afresh and differs from its start. A discovery spanning it is caught only by the modification-time check, so while the watch is down the gap AC3 closes stays open for that file (§ Known limits; ticket review F4, kept by create-ticket at 20:53 and by the orchestrator at 20:55). It is logged once at warning level; no answer names it, unlike a git file that cannot be watched, which answers name among git's unread reasons because a missed git change can leave a stale fingerprint. Reached, for example, when Linux's inotify watch limit is spent.
- **The fingerprint keeps reading a listed file afresh.** The tracker's held read decides the revision, the job marks and the digests compared; it never feeds a fingerprint, so an event the watcher misses can delay a rerun but never make a result read current.
- **Placement reaches past the fingerprint, as today.** A round, a run's judgment and 2.3k's count place a listed file by selection too, so a change to a workspace's gitignored test module can interrupt, or select, a workspace depending on it, whose fingerprint does not count that file. That only reruns; it is the same over-selection a setup file already has (selection selects a setup file's workspaces and their dependents).
- **Scope of the analysis.** Analyzed: each path by which an event reaches the tracker (`#changed`, `QueuedReads.read`, a reconciliation, protection's quiet reads) and each reader of the digests the revision guards (the round, 2.3k's window edges and `observed`); the Linux watch lifecycle (`keepDirectories`, `dropDirectory`, a removed watched directory); the discovery's two end checks; run judgment's listed rule and 2.3k's `pathsInside`; the fingerprints' listed parts. The readers of the digests were found by `rg -n "\.digests\b|snapshot"` over `packages/daemon/src` (20:35: the scheduler's round, besides 2.3k's two); the readers of the revision alone were not searched, which the first task does. Not analyzed: ticket 2.4d's named read, which reaches this ticket's branch through `#changed` once both land (§ Pending siblings); a listed file outside the consumer root (a known limit).

#### Known limits

For `docs/architecture.md`'s list, § Doc text words them.

- A listed file outside the consumer root is read afresh at each composition but never watched, so its edit is rerun only at the next reconciliation and does not interrupt a run reading it (the run is stored not fingerprinted, since its end fingerprint differs).
- A file only the new discovery lists, replaced while that discovery runs by content that keeps its modification time, or a link at its path retargeted to an older file then, leaves the discovery stored under its fingerprint.
- An event the watcher never delivers on such a file is seen at the next reconciliation, as for any input.
- On Linux, while a listed file's watch cannot open (decision (e)), its changes are seen only at the next reconciliation, and a discovery during which it is replaced by content that keeps its modification time, or through a link retargeted to an older file, is stored under its fingerprint.
- A listed env file that is a link to a file in another directory: an edit to the target raises an event naming only the target's path, so it is seen at the next reconciliation unless the target is itself a listed file or an input. Test modules and setup files are listed by their real paths (`moduleLocator`'s `realPath`, `vitest/module-tests.ts`), so this reaches only env files, whose names discovery keeps as Vite forms them.

#### Current structure of the modified files

Read on `wt/1` at 345b57e; the files 2.3k changes were re-read as 2.3k lands, in the main checkout at 23:03 (its reviewed working tree on f98fa2b). Code lines by lint's count (blank and comment lines skipped).

- `inputs/input-jobs.ts` (read, not edited; 166 lines, 122 code lines as 2.3k lands): `JobWindow { paths, causes, startDigests, endDigests }`, the digests from `JobWindows.open(unsettled, digests?)` and `close(mark, unavailable, digests?)`. 2.3k's change record (`daemon/change-record.ts`) reads every reported window's paths as job-caused, and its digests as the edges of the intervals between jobs, in which a path whose digest differs is an edit.
- `inputs/input-tracker.ts` (566 lines, 464 code lines as 2.3k lands): `beginJob` and `endJob` hand `#vouchedDigests(unavailable)` (`project().digests`, or none while `#unavailableReason()` gives a reason, the gate `currentInputs` applies to `snapshot`) to the window's open and close; `endJob` closes after `settled()`, so a change read before the close, an agent's save included, is job-caused. `#changed(path, kind)` checks the declaration file, returns on `#filter?.excludes(path)`, asks a reconciliation on `.gitignore`, drops a declared non-input (`#declared.namesFile`), then queues. `protectInputs(discovery, jobStart)` computes `protection(discovery, root)`, flips paths through `#declared.protect`, returns early before the first reconciliation, and reads flips quietly (`#queueQuietly`). `#settleReconciliation` calls `#watcher.keepDirectories`, `#state.establish`, `#commit` and records each changed path in every window.
- `inputs/queued-reads.ts` (198 lines, 166 code lines): `read(batch, filter)` git-checks unknown paths, skips excluded ones, and reads each other path (`#readPath`) through `readEntryDigest`, recording in every window unless the path is quiet.
- `inputs/input-state.ts` (221 lines, 165 code lines): `#inputs` of `InputRead`, `establish`, `set` (returns whether a write may have landed), `remove`, `replaceUnder`, `commit` (raises the revision once when a digest changed), `project()` (a `ProjectInputs` over the inputs' digests, once per revision).
- `inputs/input-watcher.ts` (230 lines, 182 code lines): `watchDirectory`, `keepDirectories`, `dropDirectory`, `watchGitFiles`, `close`; private `#open(directory, recursive, onEvent, cannotOpen)` opening on `realpathSync.native` and dropping events from a watch no longer live; module-private `nearestDirectories(files)`.
- `inputs/fingerprint.ts` (408 lines, 325 code lines): `ProjectInputs { root, digests, digest() }`; `SnapshotReads` (module, env file and Vitest version reads, once each); `workspaceFingerprint`, `discoveryFingerprint`, `listedDigests`, `unselectedModuleDigests`, `envFileDigests`, `protectedFileChangedSince`.
- `inputs/protection.ts` (291 lines, 232 code lines): `protection`, exported `protectedFiles` (modules plus env files) and `protectedModules` (test modules plus setup and global setup files), private `reportedProjects` and `caseComparable`, exported `liesUnderRoot` and `workspaceName`.
- `daemon/run-judgment.ts` (477 lines, 380 code lines as 2.3k lands): placement is one private rule, `placeFor(paths, workspacePath, testModules, placements)`, typed by the exported `ChangePlacement`, shared by run judgment (`placedInside` over `RunFacts`) and the count (the exported `pathsInside(paths, entry, placement)`, over the placement `roundPlacement(view, query)` chooses); `labelsInvalidated` lives here too. The set placed inside whatever selection says is built from `workspaceTestModules(entry)` in two places, `RunWatch`'s `#testModules` and `pathsInside`.
- `daemon/scheduler.ts` (546 lines, 467 code lines as 2.3k lands): `#snapshot: InputDigests | undefined`; the plan calls `this.#runs.observed(view.inputs.snapshot?.digests)`, and the round reads `view.inputs.snapshot?.digests` and calls `explainRound(..., changedPaths(before, now))`.
- Created: `inputs/listed-files.ts`.

`lifecycle.ts` needs no edit: the stored discovery and each new one already reach the tracker through `protectInputs` (`#protectStoredDiscovery`, `#protectDiscovered`), and the end checks stay (decision (b)).

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3p` over the file list (20:37) named 2.3k, 2.3l, 2.4, 2.4b and 2.4d.

- **2.3k** (ready-for-dev, building now in the main checkout): writes `input-jobs.ts`, `input-tracker.ts`, `run-judgment.ts`, `scheduler.ts`, `run-history.ts`, `lifecycle.ts` and creates `change-record.ts`. This ticket builds after it and extends its window digests, `observed` and `pathsInside` (AC2, AC4).
- **2.4d** (ready-for-dev): writes `input-tracker.ts` (a read of named paths routed through `#changed`), `queued-reads.ts`, `input-state.ts` and `current-inputs.ts`. Both write `input-tracker.ts`; the orchestrator orders them. Whichever lands second inherits the other: a named read of a listed file the inputs leave out reads it through this ticket's branch.
- **2.3l** (backlog, after 2.3k): counts and holds the discovery by 2.3k's record; this ticket's events reach it as they reach runs. It also owns the once-more rediscovery of a discovery stored not fingerprinted, which decision (b) keeps producing for a file only the new discovery lists.
- **2.4, 2.4b** (ready-for-dev): write files in `inputs/` and `daemon/` by folder only; neither touches a listed file's events. 2.4b builds after this ticket and reads its accessor: its AC4 answers a wait superseded when a covering workspace's inputs differ between two revisions, counting the listed files its fingerprint lists that the inputs leave out, compared through `ProjectInputs`' accessor over both sets (2.4b's author, 20:56, f98fa2b, on this ticket's grill note). Keep the accessor's meaning as this ticket states it.
- **2.3n, 2.3o** (backlog, after this ticket): the environment snapshot and the counting of variables Vite carries; neither is on this ticket's file list.

#### Existing tests this change breaks

- No existing test pins the dropped event, the delayed rerun, or an env file change that does not interrupt a run. `rg -n "it\(\"D[0-9]+:[^\"]*(ignor|setup file|env file|unwatched|no watch|interrupt)"` over all of `packages/daemon/test` (20:52; there is no separate run-judgment, watcher or fingerprint test file: those behaviors are tested in `input-tracker.test.ts`, `lifecycle.test.ts` and `scheduler.test.ts`) found the lifecycle tests of the end check (D1879, D3030, D3100), the env file reader tests, and `input-tracker.test.ts`'s ignore-rule, env file and end-check tests. Each keeps its behavior: D1894 (a write inside a directory git lists as ignored changes no fingerprint) and D2894 (a file git ignores that a job saw come and go is not recorded in its window) name files no discovery lists; D1898, D3077 and D3080 test `protectedFileChangedSince`, which stays (decision (b)).
- `rg -ln "setupFiles" packages/daemon/test` (20:52) finds `discover-tests.test.ts`, `executor.test.ts`, `harness.ts`, `input-tracker.test.ts`, `protection-win32.test.ts`, `store.test.ts`, the selection tests and both `defects.json`. Of these, only `input-tracker.test.ts` and `discover-tests.test.ts` compute a fingerprint. `input-tracker.test.ts`'s setup file tests (D2157, D2160) test protection and the end check, which keep their behavior. `discover-tests.test.ts`'s `fingerprintRefusals` fingerprints real fixture discoveries over empty inputs and asserts only fingerprinted or the refusal reason, which a setup file read afresh (present or absent) leaves unchanged unless one cannot be read; re-run it.
- `ProjectInputs` is constructed in about 30 test sites (`rg -n "new ProjectInputs\("`); an optional argument keeps each compiling.
- The typecheck finds any stand-in `TrackedInputs` or `CurrentInputs` a shape change breaks (`scheduling-harness.ts`'s `StandInInputs`).

#### Named-defect records the edits reach

A lane re-proves every record whose test or mutated file it edits. By each record's `file` field at 345b57e, before 2.3k: `scheduler.ts` 41, `input-tracker.ts` 26, `run-judgment.ts` 24, `protection.ts` 21, `fingerprint.ts` 19, `input-state.ts` 15, `queued-reads.ts` 11, `input-watcher.ts` 7, and whatever 2.3k adds. Count the `--changed` selection before proving, and prove by `--ids`. The Linux watch behavior needs its proof on Linux.

#### Sizing

13 raw files, 17 estimated (16.9); 6 code units (five criteria plus validation). Production: modify `inputs/input-tracker.ts`, `inputs/queued-reads.ts`, `inputs/input-state.ts`, `inputs/input-watcher.ts`, `inputs/fingerprint.ts`, `inputs/protection.ts`, `daemon/run-judgment.ts`, `daemon/scheduler.ts`; create `inputs/listed-files.ts`. Tests, for create-tests: `input-tracker.test.ts`, `lifecycle.test.ts`, `scheduler.test.ts`, `defects.json`. Over 10 estimated, so dev delegates, in two groups on disjoint files, in order: the listing and its readers (`protection.ts`, `fingerprint.ts`, `run-judgment.ts`), then the tracker chain (`listed-files.ts`, `input-state.ts`, `queued-reads.ts`, `input-tracker.ts`, `input-watcher.ts`, `scheduler.ts`), which reads the first group's listing and `ProjectInputs` accessor.

#### Doc text

A draft for the orchestrator, its final wording to follow the build.

- `docs/architecture.md`, the input tracker paragraph: replace "Every test module the latest discovery lists is also an input of its own workspace, whatever git ignores; one the inputs leave out, such as one git ignores, is read afresh each time the fingerprint is composed." with "Every test module, setup file and global setup file the latest discovery lists is also an input of its own workspace, whatever git ignores; one the inputs leave out, such as one git ignores or one under `node_modules`, is read afresh each time the fingerprint is composed. So a result stored under a fingerprint that did not count its workspace's setup files reads stale when that workspace has a setup file the inputs leave out, such as a package's, and the workspace runs once more." (The upgrade's one rerun of such a workspace, which the orchestrator asked to state at 20:41, is what this sentence describes; README can say it as an upgrade note if the orchestrator prefers.)
- The same paragraph, after "Between reconciliations it re-reads only the paths events name.": "A file the discovery in effect lists under the consumer root that the inputs leave out is watched and read as an input is, whatever leaves it out: an event naming it, or a directory above it, reads it, a changed digest raises the input revision, a job running then is marked as for an input, and a reconciliation reads it again. On Linux each such file is watched through its nearest existing directory, re-armed as that directory's entries change. Its fingerprint still reads it afresh."
- The same paragraph: replace "A listed test module, setup file, global setup file or env file that no watch covers and that was modified after the discovery began also stores it not fingerprinted" with "A listed test module, setup file, global setup file or env file that the discovery in effect when it began did not list, or that lies outside the consumer root, and that was modified after the discovery began also stores it not fingerprinted", and in the run's sentence "every test module the discovery lists for the workspace lies inside" with "every test module, setup file, global setup file and env file the discovery lists for the workspace lies inside".
- The known limits: delete "an edit to a listed env file git ignores, which raises no event, so answers read its workspace stale at once, but its rerun waits for the next reconciliation, up to 5 minutes later;" and "an env file edited while a run reads it, which does not interrupt the run, though the run is then stored not fingerprinted and runs again;"; replace "a listed env file that exists when a discovery begins and is deleted before it ends" with "a listed env file no earlier discovery listed that exists when a discovery begins and is deleted before it ends"; replace "a listed env file outside the consumer root, read afresh but never watched;" with "a listed file outside the consumer root, read afresh but never watched, so its edit is rerun only at the next reconciliation and does not interrupt a run reading it; a file only the new discovery lists, replaced while that discovery runs by content that keeps its modification time or through a link retargeted to an older file, whose discovery is stored under its fingerprint; a listed env file that is a link to a file elsewhere, whose target's edit, when the target is neither listed nor an input, is rerun only at the next reconciliation; on Linux, a listed file whose watch cannot open, such as once the inotify watch limit is spent, whose changes are seen only at the next reconciliation, and a discovery during which it was replaced keeping its modification time, or through a link retargeted to an older file, is stored under its fingerprint;".
- `README.md`: user-visible only as prompter reruns and the one-time rerun above; dev confirms whether a sentence is owed.

#### Previous ticket

2.3q (done, c1d4545, merged 65dafd6): a Vitest 5 workspace with a nested `projects` container reports its env sources not known, so `workspaceEnvFiles` is not known and the workspace has no fingerprint. This ticket's listing takes a workspace's env files only while they are known, and such a workspace has no fingerprint either way. 2.3q's change-request candidate (one string-list guard) landed as 0bd70c9. The 2.3i review's debt round (13ede23 onward) placed the setup-file fingerprint in this ticket (orchestrator, 18:35) and left the rediscovery of a discovery stored not fingerprinted to 2.3l.

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.3p, § Ticket 2.3m, § Ticket 2.3k, § Ticket 2.3l, § Ticket 2.4d.
- Tickets 2.3m (`_agent-docs/tickets/2-3m-env-files.md`: G2, G3 and § Decisions "No event handling"), 2.3i (`_agent-docs/tickets/2-3i-schedule-answers.md` § Review Record, tech debt and its dispositions), 2.3k (`_agent-docs/tickets/2-3k-hold-self-changing-runs.md`, committed at ffd345f) and 2.4d (`_agent-docs/tickets/2-4d-read-named-paths.md`).
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (2026-09-29 20:39).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C8,C14,C38,C39,C42,C48,C55,C113,C115,C116,C117,C129,C157,C159,C160 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P18,P19,P21 -->

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
  - packages/daemon/src/inputs/protection.ts
  - packages/daemon/src/inputs/fingerprint.ts
  - packages/daemon/src/daemon/run-judgment.ts
  - packages/daemon/src/inputs/input-state.ts
  - packages/daemon/src/inputs/queued-reads.ts
  - packages/daemon/src/inputs/input-tracker.ts
  - packages/daemon/src/inputs/input-watcher.ts
  - packages/daemon/src/daemon/scheduler.ts
files_to_create:
  - packages/daemon/src/inputs/listed-files.ts
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

- _agent-docs/tickets/2-3p-listed-ignored-events.md (created by create-ticket, 2026-09-29, in Tree 1 against `wt/1` at 345b57e, written against the tree ticket 2.3k's tasks leave)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.3p: the Q1 and Q2 rulings, the build order after 2.3k, NFR3 and the ticket link, under the dispatch's grant)
- _agent-docs/sprint-status.yaml (2-3p-listed-ignored-events to ready-for-dev, under the same grant)

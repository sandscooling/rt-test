# Ticket 3.5b: Canary reading under a workspace's Vitest

## Ticket

As the daemon about to falsify a workspace's defects,
I want one call that runs RT Test's bundled canaries under the Vitest that workspace installed, from the state directory, and says whether every canary read as named,
so that the canary gate of ticket 3.6 can refuse a Vitest whose run facts RT Test reads differently, before a single verdict is stored there.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

A workspace's **Vitest install** is the Vitest that resolves from its directory, told apart by the package's real directory and its version. A **canary reading** of an install is what one falsification job over the canary set showed under it: **confirmed** when the job's reply read `ran`, was not interrupted, carried the install's version, and gave every canary the verdict and the reason `canaries.json` names for it; **disagreed**, with each canary that read otherwise, when such a reply did not; and otherwise **no reading**, with why.

- [x] AC1: Resolving a workspace's Vitest gives, beside its version, the install's directory: the real directory of the package whose version it reports, also when the workspace reaches that package through a directory link. An unsupported resolution is as it was. (FR23)
- [x] AC2: A reading taken through an `Executor`, over the bundled set, of each Vitest install this repository holds (4.1 and 5) is confirmed, on Windows and on Linux, with the state directory under a root whose nearest Vitest is the other line: the job runs under the install it was given and no other. The job's experiments are the canaries in the order the file lists them, with the file's project name and assertion error names. (FR11, FR23)
- [x] AC3: A reply that read `ran`, was not interrupted and carried the install's version reads disagreed when, for any canary, it holds no judgement whose `defectId` is the canary's id, or that judgement's verdict or reason is not exactly what `canaries.json` names for it: another verdict, no verdict, another reason, no reason where one is named, or a reason where none is named. The reading names each such canary by id, in the file's order, with the verdict and reason the reply read, each absent when the reply gave none, and the verdict and reason named. A detail or a fact that differs changes no reading. (FR23)
- [x] AC4: A reading is no reading, of one kind from a closed set, with a detail where the kind has one. The kinds, the first that holds: the canary directory's `canaries.json` cannot be read or does not hold the members § The canary file names; the set cannot be placed in the state directory; the job did not end with a reply, which a call that throws also is; the reply does not read `ran`; the reply was interrupted; the reply carries another Vitest version than the install's. In the first two no job is sent. (FR23)
- [x] AC5: A reading's files lie only in the state directory it was given, in a directory of its own whose name no other reading, daemon or worktree shares: a copy of the canary directory and one directory link to the install. When the reading has been taken, however it ended (confirmed, disagreed, an aborted job, an executor that died, a set that could not be placed), that directory is gone, and the install and every file outside the state directory but the log the reading was given are byte-identical to what they were before it. A directory that cannot be removed is named in that log, and the reading is what it would have been. (FR23, NFR6)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. The copy (`cpSync`), the directory link (`symlinkSync` with `junction`) and the real path (`realpathSync.native`) are what `packages/daemon/test/harness.ts` does for every fixture; removing a directory link with `unlinkSync`, which removes the entry and never what it points to, is what `test/scripts/defects/pool.test.ts` does to a `junction`; the recursive removal, `rmSync` with `recursive`, then walks a tree that holds no link, as it does for every fixture without one; the resolution is `resolveWorkspaceVitest`'s own. The built removal ran on Windows under Node 24.19.0 with both installs hashed identical before and after, and on Linux under 22.23.3 and 24.19.0 (dev, 10:16 on 2026-10-01). Removing the placed directory while the `Executor` that ran its job is still open was run on Windows and held (§ The spike). Two behaviors no machine at hand can run: a Windows link across volumes, which no criterion relies on (§ Known limits), and the removal on Windows under Node 22, where a link that cannot be unlinked removes nothing and leaves the directory with a log entry, as AC5's last sentence says.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (AC1) In `vitest/load-vitest.ts`, give the supported member of `ResolvedVitest` the install's directory, the directory of the manifest `resolveWorkspaceVitest` already resolves, so the reading here and the gate of ticket 3.6 ask the one resolution every job asks (C8) and no second module resolves Vitest. Check every reader of `ResolvedVitest` in the same change (C38), found by `bun run typecheck` (P14) and by `rg -l "ResolvedVitest|resolveWorkspaceVitest" --glob '!**/dist/**'` from the root, which at f6864910 printed, outside the ticket files: `vitest/workspace-session.ts` and `inputs/fingerprint.ts`, which read it, `src/index.ts`, which exports its type, and `packages/daemon/test/load-vitest.test.ts`. No `defects.json` names either symbol, and no file builds the supported member as a literal but `load-vitest.ts` itself (`rg "supported: true"`).
- [x] (AC2, AC3, AC4) Create `packages/daemon/src/falsify/canary-set.ts`, which loads no Vitest and imports nothing from `daemon/`. It declares the canary reading's type and, as named constants of one closed set (C3), the six kinds of AC4: it produces four of them and may not import the module that produces the other two, so `daemon/canary-reading.ts` imports both from it (C4). It holds the bundled set's directory, two levels above the module, so one relative URL finds it from `src/` and from `dist/`. It reads a canary directory's `canaries.json` and returns the project name, the assertion error names and the canaries in the file's order, or why the file cannot be used (§ The canary file). It builds the experiments for a copy of the set at a given root: workspace path `.`, the file's project name, occurrence 0, each `mutation.file` joined to the root as an absolute path, in the file's order and never sorted, since that order carries a case (§ What the criteria rest on). It reads a job's reply against the set and an install's version: confirmed, disagreed with each canary of AC3, or no reading of AC4's last three kinds. Each of those has this detail: for a reply that does not read `ran`, the reply's status, followed by its own text where it has one (`failed`: its `error`; `refused`: the refusal's kind, and its `error` when that kind is `not-prepared`; `unsupported`: the resolution's `reason`; `not-confirmed`: its `reason`; `interrupted-before-load`: the status alone); for an interrupted reply, none; for another Vitest version, the version the reply carried. The detail of a file that cannot be used is why. It matches a judgement to its canary by `defectId`, which is the canary's id, and compares the verdict and the reason for exact equality, an absent one equal only to an absent one, which is how D3786's test compares each judgement of a job with the file's; it never compares a detail or a fact.
- [x] (AC2, AC4, AC5) Create `packages/daemon/src/daemon/canary-reading.ts`, with one exported function that takes a reading (§ The interface ticket 3.6 calls). Given what sends a falsification job (`Executor.falsify`), a state directory, the log and a canary directory, and an install, it: reads the set, returning no reading when it cannot; places a copy under the state directory in a directory named with a prefix and a random identifier, as `createParseRecord` names its record, with one directory link `node_modules/vitest` to the install's directory (link type `junction`, which Linux ignores): it takes the state directory's real path (`realpathSync.native`), makes the directory beneath it, and hands the job that built path as its workspace directory; sends one job over the placed copy as its workspace (path `.`, and the config file `chosenConfigFile` gives for it, or the empty name when it gives none, as `falsifiedOn` in `packages/daemon/test/falsify/canaries.test.ts` sends it), with the set's experiments and assertion error names; reads the outcome, a call that throws reading as a job that did not end with a reply, and an ended outcome whose value is not an object (`isRecord`) too, since `Executor.falsify` accepts a reply by its type alone; and removes the placed directory in a `finally`, on every path that made one. A copy that holds no Vitest config gets no guard and no kind of its own: the job sent with the empty name replies `not-confirmed`, which is a reply that does not read `ran`, and the bundled set always holds `vitest.config.mjs`. The kinds and the reading's type come from `falsify/canary-set.ts`, and this module declares neither. The detail of the two kinds it produces: for a set that cannot be placed, the error's text; for a job that did not end with a reply, the outcome's `reason` or the thrown error's text. The path built beneath the state directory's real path, of which no second real path is taken, is the one string the job gets as its workspace directory and both removals are given: the `finally`'s, and a failed placement's, which removes what it made. The copy's `node_modules` is made without `recursive`, so a canary directory that already holds one is a set that cannot be placed, with the error's text, and no link is written into a directory the set brought. The removal has no retry, since the executor's whole process tree has ended when `Executor.falsify` resolves (§ The spike), and goes in this order (design decision 9). First it takes the placed path's real path again, at that moment, and removes nothing unless that is the very path the reading placed (C136): the placed path was built beneath the state directory's real path, so an equal fresh real path holds no link in any component, and an entry replaced right after it was made is refused, never adopted. Then it removes the link `node_modules/vitest` with `unlinkSync`, a call that cannot recurse, a link already gone being no failure. Then one `rmSync` with `recursive` walks a tree that holds no link. A real path that cannot be taken because the directory is gone (`ENOENT` or `ENOTDIR`) is no failure and removes nothing (C34, C172). A real path that differs, any other failure to take it, a link that cannot be unlinked, and a recursive removal that fails each end the removal there, are logged with the path and the error, are never thrown (C30, C36), and leave the reading what it was. The function neither aborts a job nor decides what an abort was for: its caller holds the `Executor`.
- [x] (Support) Report to the orchestrator, with the handoff, the text for the files this lane does not edit: `docs/architecture.md` (§ Falsification jobs, whose paragraph on `packages/daemon/canaries/` gains the reading: the placed copy, the link, what confirmed, disagreed and no reading mean, that nothing calls it until ticket 3.6, and the sentence that a change to the canary set raises `FALSIFIER_VERSION`, since evidence stored before it was confirmed by the set as it was, and that resolving a workspace's Vitest gives the install's directory, which no section names today; § Host and consumer isolation during discovery and runs, for what a reading writes and where; and the known limits list that ends § Falsification jobs, which gains the entries of § Known limits here), `docs/testing.md` (§ Falsification jobs, mutation transforms and reach), `docs/roadmap.md` (M6: a `files` member of `packages/daemon/package.json`, when a release adds one, lists `canaries`), and `_agent-docs/next-session.md`.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `Executor.falsify(workspace, configFile, experiments, assertionErrors)` in `daemon/executor.ts`, which returns a `JobOutcome<FalsificationJob>`: `{ ended: true, value }` or `{ ended: false, reason }`. The canary job is that call, unchanged, over the placed copy as its workspace.
- `DefectExperiment` and `FalsificationJob` in `falsify/experiment-record.ts`, and `Judgement` in `falsify/verdict.ts`. A `ran` reply carries `vitestVersion`, `interrupted`, and `judgements`, one for each experiment in the order given, each with its `defectId`, a `verdict` or none, and a `reason` where it has one.
- `resolveWorkspaceVitest` and `ResolvedVitest` in `vitest/load-vitest.ts`: the one resolution of a workspace's Vitest, which every job asks.
- `chosenConfigFile` in `vitest/confirmed-start.ts` for the placed copy's config file; `VitestWorkspace` and `ROOT_PATH` in `vitest/find-workspaces.ts`.
- `createParseRecord` in `daemon/parse-record.ts`, as the shape of a name of its own in the state directory: a prefix and `randomUUID()`.
- `errorText` in `vitest/error-text.ts`, `isRecord` in `json-guards.ts`, and `DaemonLog.entry` in `daemon/daemon-log.ts`.
- For the tests session: `linkVitest`, `inTempDir` and `VitestInstall` in `packages/daemon/test/harness.ts`; `memoryLog` in `packages/daemon/test/daemon-harness.ts`; `onEachLine`, `ranJob` and `judgementOf` in `packages/daemon/test/falsify/job-readings.ts`; `falsifiedOn` in `packages/daemon/test/falsify/canaries.test.ts`, which already runs one job over a copy of the set for each Vitest install; and, as the shape of a real `Executor` in a test, `falsifiedThroughExecutor` in `packages/daemon/test/falsify/falsify-executor.test.ts`, which builds one with `memoryLog()` and `takeStartEnvironment()` and closes it in a `finally`.

### Must Create

- `packages/daemon/src/falsify/canary-set.ts` and `packages/daemon/src/daemon/canary-reading.ts`, as the tasks describe.
- The install's directory on the supported member of `ResolvedVitest`.
- The guarded removal of the placed directory, inside `daemon/canary-reading.ts`: the placed path's fresh real path checked equal to the placed path, the link removed with `unlinkSync`, then `rmSync(directory, { recursive: true })` over a tree that holds no link (design decision 9). No production module holds one: `rg "rmSync" packages/*/src` at f6864910 finds single files removed, and one recursive removal, in `daemon/windows-acl.ts`. The spike measured that last call over a tree with its link still in it, under Node 24 on Windows and under Node 22 and 24 on Linux.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### What the criteria rest on

FR23: "Refuse to falsify in a Vitest workspace whose Vitest version RT Test's canary fixtures have not confirmed its run facts against, naming the version and the canary that disagreed." FR11: "Decide each falsification verdict from run facts (failure phase, error kind, whether the intended test reached the step that holds the mutation, the baseline result), counting as a detection only an assertion failure in the intended test after it reached that step, repeated in a confirming run."

ADR-0008: "These facts are Vitest's internals: a release that recorded a hook's state differently would credit an `expect` failing in a `beforeEach` as a detection, and one that stopped recording hook states would leave every experiment invalid. So RT Test ships canary fixtures, each failing on purpose in one known way, which its own suite checks on both supported Vitest lines." Its next sentence, as this lane amended it (orchestrator, 08:12 on 2026-10-01): "Before a workspace's first falsification in a daemon's life, the daemon runs those canaries under that workspace's Vitest install from its state directory and keeps the reading in memory, one for each install, until it stops; an install whose reading disagrees with any canary is refused falsification, naming the version and the canary." And, rejected there: "trusting these facts on a version no canary has confirmed."

`docs/architecture.md` § Falsification jobs: "`packages/daemon/canaries/` holds RT Test's canary fixtures: a Vitest project named `canaries` whose config includes only its `*.canary.mjs` modules, plain `.mjs` files that import no package but `vitest`, and `canaries.json`, which names the project, the assertion error names the set's job is given, and for each canary its intended test, its mutation and the judgement it must read (the verdict, and the reason where it has one), in the order the job runs them. That order carries a case: the canary that leaks an unhandled rejection comes directly after a canary that does not read detected, which its run's error would otherwise make unclear, and is not the last, so a late report of its error cannot land in the restored baseline." `body.canary.mjs` imports `canaries.json` for the declared error name, so the directory is copied whole.

§ What counts as an input: "The inputs are every file under the consumer root except `.git`, `node_modules`, the daemon's state directory and log file", so a reading's copy changes no input wherever the state directory lies.

AC5 delivers NFR6 for a reading, whose marker names this ticket (orchestrator, 08:43 on 2026-10-01): "Leave every consumer file byte-identical through falsification, writing no mutation anywhere on disk." It also keeps NFR4, which earlier tickets deliver: "Keep state, logs, and results on the machine under the configured state directory, and send nothing off it."

Glossary, verbatim: **Canary fixture**: "A test that fails on purpose in one known way, so RT Test can check that it reads that failure's facts correctly on a Vitest version." **Falsification job**: "One executor job that runs a Vitest workspace's baseline, each of its defects' experiments and the restored baseline in one Vitest instance." As this lane added them: **Vitest install**: "The Vitest that resolves from a Vitest workspace's directory, told apart by the package's real directory and its version. Several workspaces can resolve one install." **Canary reading**: "What one falsification job over the canary fixtures showed under a Vitest install: confirmed when every canary read the verdict and reason named for it, disagreed with the canaries that did not, or no reading otherwise."

The owner's words that bind the design. 03:25 on 2026-09-30: "I only want you to elevate to me if a design decision that is truly broken needs my attention. I'm not terribly interested in chasing edge cases right now. this is tooling for fleet cooling and others going forward". 04:12 on 2026-10-01: "I think the catalog should go. I like asking the simpler question." 04:18: "I like the idea of a trip wire, but if we can do it in a simpler fashion, then let's do it". 04:43: "the deciding factor on whether we should address it is look at Fleet Cooling's codebase. Would this edge case come up in it? If not leave it." 06:29: "i don't mind letting you make design decisions, I just want to avoid the over engineering branch that happened earlier".

#### The canary file

`packages/daemon/canaries/canaries.json`, as ticket 3.3 built it: `{ "projectName": string, "assertionErrors": string[], "canaries": [{ "id": string, "test": { "modulePath": string, "namePath": string[] }, "mutation": { "file": string, "old": string, "new": string }, "judgement": { "verdict": string, "reason"?: string } }] }`. `mutation.file` is relative to the directory. The reader supplies the workspace path and occurrence 0. A file that cannot be read or parsed, or in which a member above is missing or of another type, or whose `canaries` is empty, is one that cannot be used (AC4).

#### The interface ticket 3.6 calls

Names are the dev's; the shape is what 3.6 is written against. One function in `daemon/canary-reading.ts` takes the parts (the `Executor`'s `falsify`, the state directory, the log, a canary directory) and an install (the supported member of `ResolvedVitest`, which carries the directory and the version), and resolves to a canary reading: confirmed with the Vitest version; disagreed with the Vitest version and each canary's id, what it read and what is named; or no reading with its kind, one of AC4's closed set, and a detail text where the kind has one. The reading's type and the kinds are exported by `falsify/canary-set.ts`, which ticket 3.6 imports them from. Ticket 3.6 treats every kind alike (the workspace's job did not run at that input revision, and the reading is taken again at another), so the kind is there for the reason an answer gives and for a test to assert, never for 3.6 to branch on. It never rejects for a failure of the job, the set or the placement. It takes no abort signal: ticket 3.6's module aborts through the `Executor` it holds, and the reading then sees an outcome that did not end, or a reply that was interrupted, and is no reading. `Executor.#job` has no guard against a second job on a busy `Executor`, so its caller takes a reading only while that `Executor` holds no job, as the scheduler's one step at a time ensures in 3.6. The job loads the consumer's Vitest, which is the consumer's code, so the function is called only inside a daemon started for that project, as every job is (C140). `falsify/canary-set.ts` exports the bundled directory, which `daemon-main.ts` hands the gate in 3.6. The canary directory is a part, where P18 would resolve it inside, so that a set that cannot be used (AC4) and a set that names another judgement than the job reads (AC3) can be handed to the function by a test without replacing a module.

Nothing in production calls the function until ticket 3.6 lands, as the store's evidence write of ticket 3.4 had no caller until 3.5. Until then its exports rest on this sentence (C59), and no answer, activity, log line or stored record changes.

#### The spike: how the bundled canaries run under a workspace's Vitest from the state directory

The sprint's opening names this question for the canary work to open with. It was run before a criterion was written, at 34d0810f, through the run lease. The merge of ticket 3.4c that followed (f6864910) changed nothing under `packages/daemon/src/falsify/`, `src/vitest/`, `src/daemon/` or `packages/daemon/canaries/` (`git diff --stat 34d0810f f6864910 -- packages/daemon/src packages/daemon/canaries packages/cli/src`).

What ran: the real job over a copy of `packages/daemon/canaries/` with the experiments and assertion error names of its `canaries.json`, once for each of this repository's Vitest installs (5.0.1 and 4.1.11). Six placements for each install: the copy with a `node_modules/vitest` directory link to the install, and the copy with no link (Vitest resolved from a workspace directory instead, by changing one expression of `load-vitest.ts` in memory as Node loaded it), each in `.rt-test` under a consumer root that resolves no Vitest, in a directory outside any tree, and in `.rt-test` under a root whose own `node_modules` holds the other line.

Command, from the repository root: `node scripts/run-lease.mjs run --lane t3-6 --thread <threadId> -- node --conditions=development --import ./packages/daemon/src/daemon/source-hooks.ts --import ./_agent-docs/.scratch/create-ticket-3-6/spike-hooks.mjs _agent-docs/.scratch/create-ticket-3-6/spike.mjs`, with `SPIKE_MODE=executor` to send each job to a real `Executor`'s process, `SPIKE_REMOVE=before-close` to remove each copy while that `Executor` is still open, and `SPIKE_BASE` to name where the placements are made. On Linux the same runs in a clone of the lane's own at `~/rt-test-t3-6`, through `wsl.exe -e bash -lc 'bash /mnt/c/source/rt-test/_agent-docs/.scratch/create-ticket-3-6/spike-linux.sh'` and `spike-linux-legs.sh`.

Observed, every job line counted by `node _agent-docs/.scratch/create-ticket-3-6/summarize-logs.mjs`: every job of every run read `status: ran`, its install's own version, and every canary (24 at 34d0810f) with the verdict and reason the file names, and every run exited 0.

| Run                                                                     | Platform and Node    | Jobs | Time for a job                                                       |
| ----------------------------------------------------------------------- | -------------------- | ---- | -------------------------------------------------------------------- |
| In process, the six placements for each install                         | Windows, 24.19.0     | 12   | 8.4 to 13.0 s                                                        |
| The same                                                                | Linux (WSL), 24.19.0 | 12   | 7.0 to 7.9 s                                                         |
| The same                                                                | Linux (WSL), 22.23.3 | 12   | 7.0 to 7.7 s                                                         |
| The same, placements on tmpfs (`/dev/shm`) and the installs on ext4     | Linux (WSL), 24.19.0 | 12   | 7.1 to 7.7 s                                                         |
| Through a real `Executor`, the three linked placements for each install | Windows, 24.19.0     | 6    | 13.5 to 18.6 s, with the executor's start, its close and the removal |
| The same                                                                | Linux (WSL), 24.19.0 | 6    | 7.6 to 8.1 s                                                         |
| The same                                                                | Linux (WSL), 22.23.3 | 6    | 7.6 to 8.3 s                                                         |
| The same, each copy removed before the `Executor` was closed            | Windows, 24.19.0     | 6    | 9.0 to 12.2 s, the job with its executor's start                     |

The runs ended at 08:01, 08:19 and 08:38 on Windows and at 08:04 and 08:26 on Linux, on 2026-10-01. In every `Executor` run the placed directory was removed at once, by one `rmSync` with `recursive` and no retry, on both platforms: in the first three once `Executor.falsify` and `close` had resolved, and in the last, on Windows, once `Executor.falsify` alone had resolved and with the `Executor` still open, as the reading removes it. So no process still stood in it: an `Executor` settles a job once its whole process tree has ended. With the link, the only entry a job left under the copy's root was the link's `node_modules`; with no link, the job wrote nothing under the root. After the copies were removed, both installs still held their `package.json` and `dist`, on both platforms. The Windows placements lay under a path that holds a space.

Not reached: Node 22 on Windows, which this machine does not hold and the pre-push gate does not run; a Windows link across volumes, since this machine has one local volume; an install laid out by npm or pnpm.

`require.resolve("vitest/package.json")` from a workspace gives the install's real path under Bun's layout on both platforms, in this repository and from Fleet Cooling's `packages/convex` (`node _agent-docs/.scratch/create-ticket-3-6/resolve-raw.mjs`), so the manifest's directory is the install's real directory (AC1).

Which placement stands for what: "link, outside any tree" is the state directory the roadmap gives every Fleet Cooling trial ("with RT Test's state directory kept outside its tree"); "link, `.rt-test` under the root" is the default state directory in a consumer shaped as Fleet Cooling is, whose root resolves no Vitest; "link, under a root nearest to the other line" is a consumer whose root holds another Vitest than its workspace's. AC2 asks for the last alone: it is the one placement in which a reading that did not take its Vitest from the link would read another install, and each placement costs one job for each install in every run of the suite. The other two take the same code and stand on the runs above.

The scripts and logs named here are untracked and lie in the Main tree, at `C:/source/rt-test/_agent-docs/.scratch/create-ticket-3-6/`, where the authoring session keeps them until the orchestrator closes lane t3-6. After that the table above is the record.

Fleet Cooling's facts, read only, at its 20f77f5c: a Vitest config in each of `apps/admin`, `apps/storefront`, `packages/convex`, `packages/lib` and `packages/ui`, each declaring `vitest ^4.1.11`; all resolve one install, 4.1.11, at `node_modules/.bun/vitest@4.1.11+b4a7bbe147835220/node_modules/vitest`; its root resolves no Vitest; it patches no dependency and overrides nothing of Vitest; no config lies at its root, and no `include` of theirs matches `*.canary.mjs`. Its checkout and this machine's only local volume are C: (`Get-Volume` at 08:14 on 2026-10-01), so a state directory outside its tree here shares the install's volume.

#### Design decisions (scope of analysis: how the canary set is placed, run and read under one Vitest install; what the daemon keeps of a reading, when it refuses and what answers say are ticket 3.6's; an npm or pnpm layout and a published package's `files` list are unanalyzed here)

Where one exists, a decision names doing nothing and a coarser rule beside it. The orchestrator at 08:12 on 2026-10-01: the link, and the copy's place and life, "stand as yours".

1. **The canaries run in the consumer, under its own Vitest.** ADR-0008 decides it. Do nothing: a Vitest release that records a hook's state differently credits a detection that never happened, silently. The coarser rule, a list of the exact versions RT Test's own suite ran, refuses every Vitest patch release until RT Test ships one, for every consumer.
2. **The copy gets its Vitest by one directory link.** The job then runs unchanged, with the copy as its workspace, as `canaries.test.ts` has run it since ticket 3.3, and rests on Node's resolution alone. The other way that ran, no link and a second directory for the job to resolve Vitest from, changes `daemon/executor.ts`, `daemon/executor-jobs.ts`, `daemon/executor-main.ts`, `falsify/falsify-workspace.ts` (474 of lint's 500 code lines) and `vitest/workspace-session.ts`, which hold 109 anchored records between them (`grep -c '"file": "packages/daemon/<path>"'` over the `defects.json` files, at 34d0810f), and rests on how Vitest resolves a bare `vitest` import. Running the set where it is bundled was not run: the link would be written into RT Test's own install, which every daemon on the machine shares and which may not be writable, and ADR-0008 names the state directory.
3. **A directory of its own for each reading, removed when the reading is taken.** A fixed name collides when two worktrees share a state directory, and one daemon's removal would then end the other's canaries as a disagreement. Doing nothing about what a killed daemon leaves is a known limit.
4. **Keyed by nothing here.** This ticket takes one reading of the install it is handed. What is kept, for how long and under what key is ticket 3.6's (the orchestrator at 08:12: in the daemon's memory, once in its life for each install, and no store record).
5. **A reading compares each canary's verdict and reason, in the file's order, and nothing else.** That is the question this repository's own suite asks of the set (D3786). Comparing details and facts as well would refuse a Vitest whose detail text moved while its verdicts hold. Comparing the verdict alone would pass a Vitest under which a hook failure reads as a site not executed.
6. **A reply of another Vitest version is no reading.** It is one comparison, and without it a link that resolved a package of another version than the one it was made to would be read as the install. A package of the same version at another directory still reads as the install: the reply carries no directory and the reading asks for none. Doing nothing trusts the link; nothing coarser exists.
7. **The resolution carries the install's directory.** A second resolution inside the reading would answer one question twice (C8). The directory comes from the manifest path the resolution already holds.
8. **One function takes a reading, and it takes no abort signal.** Its caller holds the `Executor` and aborts through it, as ticket 3.5's module does for a falsification job, so the reading needs no second way to end a job.
9. **The link is removed first, then one recursive removal of a tree that holds no link, with no retry.** One recursive removal over the tree with its link still in it is not safe on every Node line `engines` admits (`^22.13.0 || ^24.0.0 || >=26.0.0`). Node 24's `rmSync` is one native call, which is what the spike measured. Node 22's is the JavaScript `rimrafSync`: on Windows, when unlinking an entry throws `EPERM`, it stats through the link, sees a directory, and can list and remove its children, which are the install (read from Node 22.23.3's `lib/internal/fs/rimraf.js`, the functions `rimrafSync`, `fixWinEPERMSync` and `_rmdirSync`, as the dev printed them from the installed binary, which `process.binding("natives")["internal/fs/rimraf"]` prints again under that Node; Windows under Node 22 was never run, since this machine holds none). `unlinkSync` cannot recurse. Doing nothing leaves AC5's byte-identical install resting on which Node runs the daemon. One question guards the removal: is the placed path's real path, read now, the very path the reading placed? Equality stands in place of a check that it lies strictly inside the state directory: the placed path was built beneath the state directory's real path, so equality implies containment at the place the reading made, and it needs no second real path. The author looked for a case containment catches and equality does not, and found none; a state directory whose own path was pointed elsewhere after the placement is one equality still cleans up and containment would refuse. Decided by the orchestrator (threadId e88c9bb1-bd61-4792-a533-a28c842bc9a7) at 10:13 on 2026-10-01, on the dev's question of 10:11 from the adversarial review. The placed path is the path the reading built, and no second real path is taken of it once it is made: a real path taken there would adopt wherever an entry replaced right after the `mkdirSync` leads, and the equality check would then pass over a directory the reading never made. Decided by the orchestrator at 14:17 on 2026-10-01, on the review's question of 14:15 (§ Review Record), replacing that part of the 10:13 reading. A retry is recovery for a directory some process still holds, and the spike shows none does once `Executor.falsify` has resolved, on Windows with the `Executor` still open (C10). A bounded retry would add a count and an interval for a state not reached; a removal that is refused or fails is logged and leaves a directory never read again.
10. **The copy's `node_modules` is made without `recursive`.** A canary directory that already holds one is then a set that cannot be placed, with the error's text. Made with `recursive`, the link would be written into a directory the set brought, and the removal would unlink whatever stood at `node_modules/vitest` there. The bundled set holds none. The dev's decision from the same review, accepted by the orchestrator.

#### Known limits (each entry says what a consumer would see and what must coincide)

- A daemon killed while a reading is taken, or a removal that is refused or fails, a link that cannot be unlinked among them, leaves that reading's directory in the state directory: the set's files and a link, under a name never used again.
- On Windows, a state directory on another volume than the install was not run: this machine has one local volume. If the link cannot be made there, the reading is no reading and says that the set could not be placed, so no workspace is falsified from that state directory and every answer says why once ticket 3.6 lands.
- A consumer's own `vitest` run collects the canary modules when a config at an ancestor of the state directory includes `*.canary.mjs` there, the state directory lies inside the tree, and the run falls in the seconds a reading takes, or at any time after a reading's directory was left behind. Fleet Cooling has no such config.
- RT Test's own workspace listing names a placed copy as a Vitest workspace only when the root `package.json`'s `workspaces` lists the state directory's children, as `.rt-test/*`, or the copy's own directory: `expandPattern` in `vitest/find-workspaces.ts` expands a literal directory or a `parent/*` pattern and nothing else, and the daemon loads only the workspaces its start confirmed. Fleet Cooling's `workspaces` are `apps/*` and `packages/*`.
- `packages/daemon/package.json` has no `files` member, so nothing excludes `canaries/` from a package today. When a release adds one (M6), `canaries` joins it, or every reading is no reading with the set unreadable.
- An install laid out by npm or pnpm was not run; this repository and Fleet Cooling use Bun.
- A canary directory that itself holds a directory link has that link copied as a link, and only the link the reading made is removed before the recursive removal, so decision 9's tree that holds no link is true of a set that brings none. Under Node 22 on Windows that removal can follow such a link and remove what it leads to when the link's unlink and its `rmdir` both fail. The bundled set holds no link, and no consumer supplies a canary directory.
- If `node_modules` in a reading's directory is replaced by a link while its job runs, the removal's unlink resolves through it and removes the entry named `vitest` in the directory it leads to, which under Bun's layout is a consumer's own link to its Vitest. It takes another process, or the job itself, relinking inside the state directory in the seconds a reading takes: the removal's real-path check covers the reading's directory, not what lies beneath it.
- A reading's directory replaced by a link whose target is missing reads as gone, so the link stays in the state directory and nothing is logged, which takes another process acting there. And a canary directory that brings `node_modules/vitest` as a real directory is left after its failed placement, with a log entry that names a link never made, which takes RT Test's own set to be wrong.

#### Questions to the orchestrator

Asked at 08:07 on 2026-10-01 with the spike's result; decided by the orchestrator at 08:12.

- Keeping the reading: "ACCEPTED: the reading is kept in memory, once in a daemon's life for each Vitest install a workspace resolves, and no store record." So no ticket raises the schema here, and the composition of `STORE_MIGRATIONS` from one step per version waits for the next ticket that does. "The FALSIFIER_VERSION sentence for a changed canary set: yes."
- What answers say: a refused workspace is ticket 3.5's workspace whose job did not run, with the lapse at each change of the input revision a recorded known limit. It is ticket 3.6's.
- Sizing: as one ticket, 15 raw files and 20 estimated. "SPLIT, by the outcome you cut it at ... The split is for the tree, not for size." This ticket, the reading, shares no file with ticket 3.5 but `packages/daemon/test/defects.json`, and builds in the free tree beside it. Ticket 3.6 keeps the gate and waits for 3.5.
- The three cases the first run did not reach "each either get settled by you now or go in the table as the dev's first task": the job through an `Executor` and Node 22 are settled by the runs above, and a link across mounts on Linux with them. A Windows link across volumes cannot be run on this machine by this lane or its dev, so it is a known limit and no row.

#### Pending siblings

- 3.5 (ready for dev) creates `daemon/falsification.ts` and `daemon/falsification-plan.ts` and writes ten files of the daemon, the queries and the CLI. This ticket edits none of them and builds beside it; both tickets' tests add records to `packages/daemon/test/defects.json`.
- 3.6 (backlog) keeps a reading for each install, refuses a workspace whose install's reading disagreed, and says so in answers, calling this ticket's function at 3.5's seam. It builds after 3.5 and after this ticket.
- 3.4b (backlog), 3.7 (backlog) and 3.8 (backlog) name none of this ticket's files.
- Lane error-kind (a change-request, on main at d095063a since 09:43 on 2026-10-01) lets a consumer declare an assertion error by its class as well as its name: `falsify/run-facts.ts` names an error by its class when its own name is the plain `Error`, and `FALSIFIER_VERSION` is 4. It added no canary and changed nothing under `packages/daemon/canaries/`, in `daemon/executor.ts`, `daemon/executor-jobs.ts` or `vitest/load-vitest.ts` (`git diff --stat 411d6f0b d095063a` over those paths prints nothing), so the set holds the 24 canaries of § The spike and the reading hands the job what `canaries.json` declares, as `canaries.test.ts` does. It added records to `packages/daemon/test/falsify/defects.json`, which this ticket's tests also write, and `errorFactsOf` to `packages/daemon/test/falsify/job-readings.ts`, whose `onEachLine`, `ranJob` and `judgementOf` stand as § Reusable Code names them. The sentence this ticket reports for `docs/architecture.md` (a change to the canary set raises `FALSIFIER_VERSION`) binds no lane until the orchestrator writes it.
- `node scripts/list-unbuilt-work.mjs --except 3.5b` over this ticket's production and test files, at 08:21 on 2026-10-01, named one ticket for one file: 3.5, whose assumption row cites `packages/daemon/test/falsify/falsify-executor.test.ts` as how to drive an executor, and which writes no file of this ticket's.

#### Current structure of the modified files

Code lines by `grep -cv '^\s*$\|^\s*//\|^\s*/\?\*' <file>` and records by `grep -c '"file": "packages/daemon/<path>"'` over the `defects.json` files, at f6864910.

- `vitest/load-vitest.ts` (114 lines, 8 records, all in `packages/daemon/test/defects.json`): `resolveWorkspaceVitest(directory)` resolves `vitest/package.json` through `createRequire(join(directory, PACKAGE_JSON))`, reads its version, and returns `{ supported: true, version, major, nodeEntry }` or the unsupported member with its reason. `vitest/workspace-session.ts` reads the supported member's `version`, `major` and `nodeEntry`, `inputs/fingerprint.ts` reads `version` for a workspace's fingerprint, and `src/index.ts` exports the type.
- `packages/daemon/canaries/` (read, not modified): `vitest.config.mjs` (a project named `canaries` that includes `*.canary.mjs`), `body.canary.mjs`, `hooks.canary.mjs`, `src/subject.mjs`, `src/loaded.mjs` and `canaries.json`.

#### Tests this change may break

- `packages/daemon/test/load-vitest.test.ts` is the one test file that names `ResolvedVitest` or `resolveWorkspaceVitest` (the search in the first task), and it reads resolutions with `toMatchObject`, so a new member breaks none of its tests.
- `packages/daemon/test/falsify/canaries.test.ts` holds its own reader of the set (`Canary`, `CanarySet`, `canarySet`, `experiments`), which `falsify/canary-set.ts` now holds for production. The tests session decides whether that file reads through the production module; a change to what a helper there does calls for proving every record whose test calls it (`_agent-docs/crew.md` § Gates).
- Every record whose mutated file this change edits is proven again by id: the 8 anchored in `vitest/load-vitest.ts`.

#### Sizing

8 raw files and 11 estimated (8 times 1.3, rounded up); code units 6 (five criteria that need code, and validation). Under every limit. Production, modified: `vitest/load-vitest.ts`. Production, created: `falsify/canary-set.ts`, `daemon/canary-reading.ts`. Tests, for create-tests: `test/falsify/canaries.test.ts`, the file for the canary set, where a reading belongs before a new file does (P42); `test/load-vitest.test.ts`; `test/falsify/defects.json`; `test/defects.json`. This ticket's file. Over 10 estimated, and built by one session: the two groups with no order between them, the resolution's directory and the set's reader, span 2 files, where dev-ticket's Step 5b delegates only when such groups together span more than 4. Build those two first, then the reading, which calls both. AC2's two jobs through an `Executor` add about half a minute to a run of the suite on Windows and a quarter on Linux, by the table in § The spike.

#### Ticket review

One review agent, ticket-internal, returned 14 edits and 7 questions at 08:36 on 2026-10-01 (E1 to E14, Q1 to Q7). Every finding was applied but these, each settled another way. E2 asked for a bound on the removal's retry: the retry is gone, since the run Q1 asked for showed the directory removable at once on Windows with the `Executor` still open (decision 9). Q6 asked what AC2's matrix of placements costs the suite: AC2 now asks for one placement, the one a wrong resolution would fail in. Q4 asked whether a no reading's reason is a kind or free text: a kind from a closed set, which ticket 3.6 reads for its reason and never branches on.

#### Sanity check

The dev (rt-t3-5b-dev, threadId 0d91c9b9-7410-4492-bf23-fd56a4d2e00b) sent six findings at 09:49 on 2026-10-01, in Tree 1 at d095063a. The author (threadId 9bc62d23-f837-45cc-bdac-8d470a048bb6) confirmed all six at 09:52, each as the dev resolved it and each read against that tree's code first. F1: two tasks placed one closed set in two modules, so `falsify/canary-set.ts` declares the kinds and the reading's type and `daemon/canary-reading.ts` imports them. F2: `chosenConfigFile` gives no name for a copy that holds no config, so the job is sent with the empty name and its `not-confirmed` reply is a reply that does not read `ran`, with no guard and no seventh kind (`inWorkspaceSession` returns `not-confirmed` when `confirmedConfig` finds none). F3: the detail of each kind is named in the tasks. F4: the containment check as written compared two paths that pass by construction, so the placed path's real path is taken again at the removal; what it is compared with and the order of the removal are design decision 9's, by the orchestrator's ruling of 10:13 after the adversarial review, which the author wrote into the task, § Must Create and that decision at 10:18. F5: § Sizing told the dev to delegate where dev-ticket's Step 5b does not. F6: the bullet on lane error-kind states what landed. One correction no finding asked for, the author's: an ended outcome whose value is not an object reads as a job that did not end with a reply, since `Executor.falsify` returns `reply.job` by the reply's type alone and the function never rejects. No criterion changed.

### References

- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.5b, § Ticket 3.6 and the sprint's opening paragraphs.
- `_agent-docs/tickets/3-5-schedule-falsification.md`, beside which this ticket builds; `_agent-docs/tickets/3-3-verdicts-from-facts.md`, which built the canary set and left its run in a consumer to the canary work; `_agent-docs/tickets/3-6-canary-gate.md`, the caller.
- `docs/adr/0008-detection-from-task-facts-and-canaries.md`, `docs/adr/0007-reused-instance-per-falsification-job.md`, `docs/adr/0003-transform-falsification.md`.
- `docs/architecture.md` § Falsification jobs, § Execution and falsification isolation, § What counts as an input, § Host and consumer isolation during discovery and runs, § Executor processes, crashed runs and process trees.
- `docs/testing.md` § Falsification jobs, mutation transforms and reach.
- Fleet Cooling's checkout at 20f77f5c, read only: its five `vitest.config.mts` files, its `package.json` files, and where Vitest resolves from each workspace.
- `_agent-docs/.scratch/create-ticket-3-6/`: `spike.mjs`, `spike-hooks.mjs`, `spike-linux.sh`, `spike-linux-legs.sh`, `resolve-vitest.mjs`, `resolve-raw.mjs`, and the logs `spike-windows.log`, `spike-linux.log`, `spike-windows-executor.log` and `spike-linux-legs.log`.
- `node scripts/list-open-issues.mjs` printed "0 open issues, complete" at 08:03 on 2026-10-01, so no issue bears on this ticket.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C5,C8,C10,C12,C14,C21,C30,C31,C32,C34,C36,C38,C45,C46,C48,C49,C52,C55,C59,C135,C136,C138,C140,C146,C147,C172 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P14,P16,P17,P18,P21,P31,P32,P35,P36,P37,P41,P42 -->

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
  - packages/daemon/src/vitest/load-vitest.ts
files_to_create:
  - packages/daemon/src/falsify/canary-set.ts
  - packages/daemon/src/daemon/canary-reading.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId 0d91c9b9-7410-4492-bf23-fd56a4d2e00b

#### Test Files This Change Broke

None. The dev ran no test. `bun run --filter @rt-test/daemon typecheck`, which compiles the workspace's test files, exits 0, and `packages/daemon/test/load-vitest.test.ts` reads resolutions with `toMatchObject`, so the new `directory` member breaks none of its assertions by type.

To prove again by id, since their mutated file was edited: the 8 records anchored in `packages/daemon/src/vitest/load-vitest.ts` (D1020 through D1026 and D1028, in `packages/daemon/test/defects.json`). Each record's `old` still matches exactly once in the edited file (counted at 09:53 on 2026-10-01), and no record's `new` builds the supported member as a literal.

#### ACs Owed a Test

- AC2: a reading of each install through a real `Executor` is confirmed under that install's own version, with the state directory under a root whose nearest Vitest is the other line, and the job's experiments are the file's canaries in the file's order with its project name and assertion error names. Observed on Windows under Node 24.19.0 by the scratch probe (5.0.1 and 4.1.11, both confirmed); not run on Linux, where a real job needs a Linux install.
- AC3: a `ran` reply reads disagreed for each of the five ways a judgement can differ from the file's (another verdict, no verdict, another reason, no reason where one is named, a reason where none is named) and for a canary with no judgement, naming each such canary in the file's order with what was read and what is named, while a detail or a fact that differs changes nothing. No observation was made: `readCanaryJob` in `falsify/canary-set.ts` is the pure function to drive.
- AC4: each of the six kinds, the first that holds, with its detail, and no job sent in the first two. Observed by the probe: `set-unusable` (no `canaries.json`), `set-not-placed` (a missing state directory, and a canary directory that already holds `node_modules`), and `no-reply` three ways (an outcome that did not end, a call that throws, an ended value that is no object). Not observed: `not-ran` with each reply status's detail, `interrupted`, `other-vitest-version`, and the order between them.
- AC5: the reading's files lie only in a directory of its own in the state directory, that directory is gone however the reading ended, the install and every file outside the state directory are byte-identical, and a directory that cannot be removed is named in the log with the reading unchanged. Observed by the probe on Windows under Node 24.19.0 with real jobs, and on Linux under Node 22.23.3 and 24.19.0 with a stand-in job (Completion Notes § What was observed). An aborted job was not observed.

#### Tests Owed

Each is a defect met while building, with the place a mutation would sit.

- The removal runs with the link still in the tree: dropping the `unlinkInstall` call in `removePlaced` (`daemon/canary-reading.ts`). On Node 24 the install stays intact either way, so the observable is the refusal: when a real directory stands where the link was, nothing is removed and the log names the path; with the call dropped the whole directory goes.
- The removal follows a placed path that now resolves elsewhere: dropping the `directory !== placed` refusal. Observable with a link to a sibling inside the state directory, which containment would pass: the sibling's files survive and the log names both paths.
- A missing placed directory is logged as a failure, or a real failure is swallowed: `isMissing` in `removePlaced` and in `unlinkInstall`.
- A link is written into a `node_modules` the canary directory brought: `mkdirSync(modules)` given `recursive` again. Observable as a reading that is no longer `set-not-placed`.
- A failed placement leaves what it made: dropping `removePlaced` in `placeSet`'s `catch`.
- An ended outcome whose value is no object makes the function reject: dropping the `isRecord` guard in `readJob`.
- The reply's version is not compared, or is compared before the interruption: the two guards at the head of `readCanaryJob`.
- The experiments are sorted, or carry another project name or occurrence: `canaryExperiments`.
- A canary file with a member missing or of another type is read as usable: `checkedSet`, `checkedCanary` and the three `checked` functions beneath it, each of whose members § The canary file names.

Two facts a test of AC5 should know. Vitest 5 writes its API token file to the user data directory, outside the state directory, whatever `api: false` says (`docs/architecture.md` § Host and consumer isolation during discovery and runs), so "every file outside the state directory" is best asserted over the consumer root and the install, as the probe did. And the scratch probe at `_agent-docs/.scratch/t3-5b/probe.mjs` shows each arm as a stand-in `falsify`, a fingerprint of a tree, and what the log holds; it is disposable and is no test.

### Tests Record

Tests session: threadId ce15dd52-8233-4f43-9ae8-45b532f83151

#### Named Defects

D4115 is in `packages/daemon/test/load-vitest.test.ts` with its record in `packages/daemon/test/defects.json`; D4116 through D4148 are in `packages/daemon/test/falsify/canaries.test.ts` with their records in `packages/daemon/test/falsify/defects.json`.

- D4115: The resolution gives the path the workspace reaches Vitest by, a link's own path, in place of the package's real directory, so two workspaces that link one install read as two installs. (AC1)
- D4116: The reading's job is sent no config file name, so it loads no workspace and replies not confirmed, and no install this repository holds is ever confirmed. (AC2; the one test that links the real installs, and its assertion also holds AC5 for a real job: the directory gone with the executor still open, both installs and the consumer's files as they were, nothing logged)
- D4117: The copy gets no directory link to the install, so its job runs under whichever Vitest lies nearest above the state directory. (AC2)
- D4118: The job's experiments are sorted by canary id, so the canary that leaks a rejection no longer follows one that does not read detected, and a canary before it reads unclear. (AC2)
- D4119: Each experiment names its test under no project, so the job finds no module that holds it and every canary reads no module. (AC2; the same assertion holds occurrence 0 and the workspace path)
- D4120: Each mutation keeps its file relative to the canary directory, so the job reads it from the daemon's working directory and no canary's file is found. (AC2)
- D4121: The job is sent no assertion error names, so the canary whose error the set declares reads not an assertion. (AC2; the same assertion holds the config file the copy holds)
- D4122: A canary's verdict is not compared, so a Vitest under which a detection reads survived is confirmed. (AC3)
- D4123: A canary's reason is not compared, so a Vitest under which a hook failure reads as a site not executed is confirmed. (AC3)
- D4124: An absent reason agrees with any reason, so a judgement that lost its reason, or gained one the canary file does not name, is confirmed. (AC3)
- D4125: A canary the reply holds no judgement of agrees, so a job that judged no canary confirms the install. (AC3)
- D4126: The canaries that disagree are named in the order the reply holds its judgements, not the canary file's. (AC3; one of its canaries reads no verdict)
- D4127: A judgement that carries a detail disagrees, so a Vitest whose every verdict and reason holds is refused for a detail the canary file never names. (AC3)
- D4128: A canary file that cannot be read is not checked for, so the set is placed anyway and the reading says its job gave no reply. (AC4)
- D4129: A canary file that lists no canary is read as usable, so its job judges nothing and every install is confirmed. (AC4; the same assertion holds a missing or mistyped project name, assertion error names and canary list, beside a whole file that is used)
- D4130: A canary whose judgement names no verdict is read as usable, so the set is run and that canary agrees with any reply that gives it no verdict. (AC4; the same assertion holds each member of a canary missing or of another type, eleven cases beside a whole canary that is used)
- D4131: A state directory in which the reading's directory cannot be made rejects the reading, where it is to read as a set that could not be placed. (AC4)
- D4132: The copy's node_modules is made over one the canary directory brought, so the link is written into a directory the set holds and the job is sent. (AC4)
- D4133: A placement that fails leaves the directory it made in the state directory. (AC5)
- D4134: An outcome that did not end is read on as a reply, so the reason the executor gave for its end is lost. (AC4)
- D4135: A call that throws rejects the reading, where it is to read as a job that ended with no reply. (AC4)
- D4136: An ended outcome whose value is no object is read as a reply, so it reads as a reply that did not run, with no status. (AC4)
- D4137: A reply that was not confirmed reads with its status alone, so the reading cannot say why the job loaded nothing. (AC4; the same assertion holds the detail of a failed, a refused, an unsupported and an interrupted-before-load reply)
- D4138: The reply's Vitest version is compared before whether it ran, so a reply that failed under another version reads as another Vitest version and its error is lost. (AC4)
- D4139: The reply's Vitest version is compared before its interruption, so an interrupted reply under another version reads as another Vitest version. (AC4)
- D4140: The reply's Vitest version is not compared, so a job that ran under another Vitest than the install's confirms the install. (AC4)
- D4141: The reading's directory is made beside the state directory, in the consumer root, so its files lie outside the state directory. (AC5; the same assertion holds the copy, the one link and where it leads)
- D4142: Every reading's directory has one fixed name, so a second reading from the same state directory cannot be placed while the first runs. (AC5)
- D4143: The reading's directory is not removed when the reading has been taken, so every reading leaves a copy and a link in the state directory. (AC5; a confirmed, a disagreed and an interrupted reply, an executor that died and a call that throws)
- D4144: The removal does not check that the directory still resolves to the path the reading placed, so it follows a path that now leads elsewhere and logs nothing. (AC5)
- D4145: The removal goes on though the link to the install could not be unlinked, so the directory is removed with whatever stands where the link was. (AC5)
- D4146: A reading's directory that is already gone is logged as a removal that failed. (AC5)
- D4147: A link to the install that is already gone is logged as a failure and ends the removal, so the directory is left. (AC5)
- D4148: The reading's directory is built beneath the state directory's path as given, not its real path, so from a state directory reached through a directory link the removal's real-path check never matches and every reading leaves its directory and a log entry. (AC5; the review's gap, over the review's fix to `makeOwnDirectory`)

Every test but D4116 takes its reading of a stand-in install under the test's own temp directory, with a stand-in job, so no weakened placement or removal ever has one of this repository's installs as its link's target. D4116's mutation leaves placement and removal as written.

Proven by id with `node scripts/verify-defects.mjs --ids`, through the run lease, on 2026-10-01, over the tree at e88ef0ac with this lane's four test paths: the 33 records above and the 8 anchored in `vitest/load-vitest.ts`, whose mutated file the build edited (D1020 through D1026 and D1028). Windows, Node 24.19.0: 24 of 24 detected, exit 0, ended 13:46, and 17 of 17 detected, exit 0, ended 13:48. Linux (WSL, a clone at `~/rt-test-t3-5b-tests`), Node 24.19.0: 41 of 41 detected, exit 0, 13:55 to 13:57. Each run's baseline was green before and after. The two test files pass whole, 56 tests: on Windows under Node 24.19.0 at 13:38, on Linux under Node 24.19.0 at 13:55 and under Node 22.23.3 at 13:57. AC2's real reading of each install is confirmed on both platforms. Both Vitest installs hash the same before the first proof and after the last on each platform (107 and 118 entries).

The review's gap round, over the tree at 1996c2e2 with the review's fix to `makeOwnDirectory`: D4148 proven by id through the run lease, 1 of 1 detected, exit 0, on Windows under Node 24.19.0 (ended 14:24) and on Linux under Node 24.19.0 (14:25 to 14:26), each baseline green before and after. `canaries.test.ts` passes whole on Windows, 48 tests, exit 0, at 14:21, and the two files on Linux, 57 tests, exit 0, at 14:25. The test file again gained lines only. The review proves the 17 records that mutate `daemon/canary-reading.ts` again, since its fix edited that file.

The step's scoped suite ran first: `bun x vitest related` over the three production files selected 43 of 84 test files, 2365 tests passed, exit 0, 13:19 to 13:25 on Windows. No test was stale and none was a code bug.

`packages/daemon/test/falsify/canaries.test.ts` and `packages/daemon/test/load-vitest.test.ts` gained lines only (imports, declarations and new test blocks), so the 15 records already in the first keep running the same code and were not proven again. `canaries.test.ts` keeps its own reader of the canary file (`canarySet`, `experiments`), which is what the new tests' expected values are read from.

#### Deliberately Untested

- `packages/daemon/src/daemon/canary-reading.ts`: a recursive removal that fails once the link is gone (the `catch` around `rmSync` in `removePlaced`). No stand-in makes `rmSync` fail on both platforms without replacing `node:fs`; the cost is that a reading which rejected there, in place of logging, would go unseen.
- `packages/daemon/src/daemon/canary-reading.ts`: a real path that cannot be read for another reason than a missing directory (the `log.error` arm of `removePlaced`'s first `catch`). The same: nothing but a permission the test cannot set on Windows makes `realpathSync.native` fail there; the cost is an unlogged refusal.
- `packages/daemon/src/daemon/canary-reading.ts`: the removal on Windows under Node 22. This machine holds no Node 22 for Windows and the pre-push gate runs none, so no test claims it.
- `packages/daemon/src/falsify/canary-set.ts`: each member check of `checkedSet`, `checkedCanary`, `checkedTest`, `checkedMutation` and `checkedJudgement` is asserted (D4129, D4130) and two of them are proven by mutation. A proof for each of the other guards would need a record and a test apiece for a file that is RT Test's own and that D3786 and D4116 read whole; the cost is that a guard dropped from one member would be caught only when that member is next wrong.
- `packages/daemon/src/falsify/canary-set.ts`: `BUNDLED_CANARY_DIRECTORY` from `dist`. Tests run from `src`, where D4116 and D4118 to D4121 read the bundled set through it.

#### Questions to the orchestrator

- 13:25 on 2026-10-01, asked: six more defect ids, and whether AC2's real reading may carry a record that mutates only the config file name its job is sent, with the link proven over a stand-in. Answered by the orchestrator (threadId e88c9bb1-bd61-4792-a533-a28c842bc9a7) at 13:26: D4145 to D4150 allocated; no objection, "the real installs are linked only by code whose placement and removal are unmutated".
- 13:40, sent: the 17 records that mutate `daemon/canary-reading.ts`, each with its old and new text and what its mutated code removes. Answered by the orchestrator at 13:42: 16 approved as listed; D4145 changed from deleting the statement `if (!unlinkInstall(log, placed)) return;` to `unlinkInstall(log, placed);`, so the mutated code still unlinks first and only the refusal is skipped, and no mutated path removes a tree that still holds a link. Applied before any proof ran.

### Review Record

Review session: threadId c1cce782-5ccc-43ee-a981-bd453833fd3b

Reviewed on 2026-10-01 in Tree 1 at 1996c2e2: `git diff cdffd3e4 1996c2e2` (three production files, two test files, two defect catalogs) and the doc changes of cf1c586a to the sprint file, the glossary, ADR-0008 and the requirements. Three passes: the reviewer's own checklist pass and criteria sweep, one fresh-eyes agent over the whole change in one batch (1,904 code lines), and one doc-verify agent. No assumptions agent ran: the diff adds no dependency, and its runtime claims are about Node's own `fs`, which the reviewer read from each binary's source. No finding is CRITICAL or HIGH.

#### Findings fixed

1. MEDIUM, surface `daemon-state`, reach unknown (it takes an entry replaced between two calls). `makeOwnDirectory` in `daemon/canary-reading.ts` returned `realpathSync.native` of the directory it had just made. The parent is already real and the name is fresh, so that real path equals the built path unless the entry was replaced between `mkdirSync` and the call, and in that one case the code adopted wherever the entry led as the placed path: the set was copied into it and the removal's equality check passed over a directory the reading never made. Fixed: the built path is returned. The removal's order and its one check are as they were. The same fix retires the Completion Notes' limit of an empty directory left when that call fails.
2. LOW, surface `internal` (C45). The docblock above `removePlaced` said the recursive removal "walks a tree that holds no link", which the code establishes only for the link the reading made. Fixed: it says the removal meets no link the reading made.

The task text, design decision 9, the Completion Notes' second limit and § Known limits above say what is built.

#### The safety line

The verifier runs each record's named test alone (`-t "<id>:"` in `scripts/lib/defects/vitest.mjs`), so no test runs under another record's mutation. Of the 17 records that mutate `daemon/canary-reading.ts`, only D4116 links this repository's installs, and its mutation changes the config file name the job is sent and leaves placement and removal as written. D4144 and D4145 are the only mutated removals: under D4144 the unlink resolves through the test's own link into a directory of the test's that holds no such entry, and the removal then acts on that link or on what it leads to, all beneath the test's temp directory; under D4145 the test has already put a real directory where the link was, so the tree removed holds no link. D4133, D4143 and D4147 remove less than the code as written, D4131 and D4146 remove nothing, and the rest leave the removal as written over a stand-in install. The reviewer and the fresh-eyes agent traced all 17 apart and agree. The fix above keeps the line: the new record's mutation makes the removal refuse, over a stand-in.

#### Platform claims, checked against the kept logs

- Windows, Node 24.19.0: real readings of both installs through a real `Executor` in the dev's probe (13:13), in the two test files (13:36 and 13:38, 56 tests) and in the by-id proofs (24 of 24 at 13:46, 17 of 17 at 13:48); both installs hash the same before and after (107 and 118 entries).
- Linux, Node 24.19.0: the two test files (56 tests) and the by-id proof (41 of 41), 13:55 to 13:57, in a clone whose four test files hash equal to the committed ones.
- Linux, Node 22.23.3: the two test files (56 tests, D4116's real readings among them) at 13:57, and no proof, as the rule is. The Linux installs were hashed before the Node 24 run and again after the Node 22 run, equal.
- Windows, Node 22: never run, and nothing claims it. The dev's Linux probe runs used a stand-in install; the real readings on Linux are the tests session's.
- Node's source, read from each binary by the reviewer: 24.19.0's `fs.rmSync` is one native call (`binding.rmSync`); 22.23.3's is `rimrafSync`, whose `epermHandlerSync` is `fixWinEPERMSync` on Windows and whose `notEmptyErrorCodes` hold `EPERM`, so decision 9's reading of it stands.

#### Question to the orchestrator

Asked at 14:15 on 2026-10-01, decided by the orchestrator (threadId e88c9bb1-bd61-4792-a533-a28c842bc9a7) at 14:17, with no owner sentence in it beyond the 04:43 test it cites.

- Q1, return the path the reading built in place of a second real path: "YES. Return the path the reading built." It replaces that part of the 10:13 reading. The orchestrator ran a scratch script first, on Windows under Node 24.19.0 and on Linux under 22.23.3 and 24.19.0: with the first real path taken, the built path equals its own real path for a state directory given plainly, through a directory link, in another letter case, with a trailing separator and with dot segments; without it, the built path differs through a link on every platform and in another letter case on Windows only. The one new record, a state directory given through a directory link with the mutation `realpathSync.native(stateDirectory)` to `stateDirectory`, is approved as described.
- Q2, three states in which the code could act outside its directory: "LEAVE all three, recorded as known limits. No code change for any of them." Each needs RT Test's own set to be wrong or another process acting inside the state directory during a reading. They are the last three entries of § Known limits.

#### Weighed and left

- A reply that is an object but no falsification job reads `not-ran` with no detail, or `no-reply` with a `TypeError`'s text; a canary id listed twice is compared against one judgement; a mutation file that climbs out of the canary directory is read from outside the copy. Each needs RT Test's own executor or its own canary file to be wrong, as the orchestrator accepted of the dev's F5 to F7 at 10:13.
- AC5's "every file outside the state directory" is wider than what was observed and than NFR6 asks. The tests hold the consumer's files and both installs byte-identical. A job under Vitest 5 also creates Vitest's API token file in the user's data directory, as every job does (`docs/architecture.md` § Host and consumer isolation during discovery and runs); it is no consumer file and a reading adds nothing to that exception.
- Under `--preserve-symlinks` the resolution's `directory` is the link's own path, so one install reads as one for each workspace, at the cost of one more canary job each. Fleet Cooling sets no `NODE_OPTIONS` and no such flag (searched at its checkout, read only).
- No sweep removes a reading's directory that a killed daemon or a refused removal left, and the removal has no retry (decision 9): the first entry of § Known limits holds the cost.
- A `set-unusable` detail is asserted only as some string (D4128 to D4130), so a detail that named the wrong member would go unseen until RT Test's own canary file is wrong.
- The deliberately untested entries stand as recorded. `BUNDLED_CANARY_DIRECTORY` from `dist` was read against `packages/daemon/tsconfig.build.json` (`rootDir` `src`, `outDir` `dist`): two levels above `dist/falsify/` is `packages/daemon/`.
- Refuted: that D4142 would pass if two readings shared one directory. The second reading's placement then fails, it reads `set-not-placed`, and the test's one assertion expects `no-reply` of both.
- `canaries.test.ts` imports `node:fs`, `node:path` and two harness modules in two blocks, which keeps the file's diff add-only; merging them would call for proving the 15 records already in it again, for no behavior.

#### Doc discrepancies, reported to the orchestrator

- `_agent-docs/sprints/sprint-3-falsification.md`, § Ticket 3.5b: "Requirements: FR11, FR23." omits NFR6, which AC5 cites and whose marker in `docs/requirements.md` names 3.5b.
- `docs/requirements.md`, FR11's marker, and the sprint's § Ticket 3.6 name 3.6 for FR11, while each of ticket 3.6's six criteria cites FR23 alone; the FR11 work moved to this ticket's AC2 in the split.
- The glossary's Canary reading reads loosely beside AC3 and AC4 (it does not name the three replies that are no reading before any canary is compared) and is left: "under a Vitest install" covers them, and the criteria hold the exact conditions.
- The lane's doc text for `docs/architecture.md` and `docs/testing.md` repeats "a tree that holds no link" without its condition; the corrected sentences go with the review's report.

#### Validation of the fix round

Over the tree at 1996c2e2 with the review's two edits to `daemon/canary-reading.ts` and the tests session's D4148, on 2026-10-01. Scoped from the fix round, whose one code file has one importer.

- Windows, Node 24.19.0. `bun x oxlint` over `daemon/canary-reading.ts` and `canaries.test.ts`, `bun x prettier --check` over the four edited files, `bun run --filter @rt-test/daemon typecheck` (a whole-workspace compile), `bun run check:defects` (3292 records, each anchor once) and `node scripts/check-line-citations.mjs`: exit 0 each, at 14:28. No edit changed a type, an export or a signature, so the CLI's typecheck was not run. `bun x vitest related` over the two edited code files, through the run lease: 1 of 84 test files, 48 tests passed, exit 0, 14:28 to 14:29. `node scripts/verify-defects.mjs --ids` over the 17 records that mutate `daemon/canary-reading.ts` and D4148, through the run lease: 18 of 18 detected, baseline green before and after, exit 0, ended 14:33.
- Linux (WSL, a clone of the review's own at 1996c2e2 with the three changed files hash-checked against Windows), through the run lease. Node 24.19.0: the two test files, 57 tests passed, exit 0, at 14:29; the same 18 records by id, 18 of 18 detected, exit 0, 14:29 to 14:31. Node 22.23.3: the two test files, 57 tests passed, exit 0, at 14:31.
- Both Vitest installs hash the same before the first of these runs and after the last, on each platform (107 and 118 entries).

#### Tech debt

- The set of codes that mean nothing is at a path, `ENOENT` and `ENOTDIR`, is declared privately in five modules, each agreeing: `packages/daemon/src/daemon/canary-reading.ts` (`MISSING_CODES`, this change's copy), `packages/daemon/src/inputs/fingerprint.ts`, `packages/daemon/src/inputs/input-inventory.ts`, `packages/daemon/src/defects/definition-files.ts` (an array) and `packages/cli/src/hook-memory.ts`, with an `isMissing` beside four of them. The dev's change-request candidate; its recommendation is to leave it.
- The directory name `node_modules` is a private constant in `packages/daemon/src/daemon/canary-reading.ts` (`MODULES_DIRECTORY`) and in `packages/daemon/src/selection/extends-lookup.ts` (`NODE_MODULES`), and the package name `vitest` in `canary-reading.ts` (`VITEST_PACKAGE`) and in `packages/daemon/src/vitest/find-workspaces.ts`.

#### Test Coverage Gaps

- `packages/daemon/src/daemon/canary-reading.ts` (`makeOwnDirectory`), MEDIUM, surface `daemon-state`. Defect: "The reading's directory is built beneath the state directory's path as given, not its real path, so from a state directory reached through a directory link the removal's real-path check never matches and every reading leaves its directory and a log entry." Expected test: in `packages/daemon/test/falsify/canaries.test.ts`, a reading whose state directory is given through a directory link to the real one, with a stand-in install and a stand-in job, asserting that the state directory holds what it held and nothing is logged. Its record mutates `realpathSync.native(stateDirectory),` to `stateDirectory,` in `makeOwnDirectory`, approved by the orchestrator at 14:17; under it the removal refuses and the directory stays, over a stand-in. Since the review's fix this real path is the only one the placement takes, and no test gives a state directory by any path but its real one. The daemon hands the state directory as given, never as a real path, so a state directory through a link, or in another letter case on Windows, reaches here. Closed by D4148 (the tests session, 14:27 on 2026-10-01), which the review read against this row and proved again with the 17 records that mutate the file.

### Completion Notes

Dev, 2026-10-01, in Tree 1 on `wt/1` at main's d095063a. No test was written or run. No file outside the ticket's three was edited.

**What was built.** `vitest/load-vitest.ts`: the supported member of `ResolvedVitest` carries `directory`, the directory of the manifest the resolution already holds; its two readers and the type's export needed no change. `falsify/canary-set.ts`: `BUNDLED_CANARY_DIRECTORY`, `CANARY_READING` (confirmed, disagreed, no reading), `NO_READING_KIND` (the six kinds), the `CanaryReading` type, `readCanarySet`, `canaryExperiments`, `readCanaryJob` and `noReading`. `daemon/canary-reading.ts`: `takeCanaryReading(parts, install)` and `CanaryReadingParts` (`falsify`, `stateDirectory`, `log`, `canaryDirectory`); the install is the `directory` and `version` of the supported resolution. The returned shape is § The interface ticket 3.6 calls: `status`, then `vitestVersion`, and for a disagreed reading `canaries` (each with `id`, `read` and `named`, a verdict and a reason each absent where there is none), or for no reading `kind` and, for every kind but an interrupted reply, `detail`.

**Reused, not created.** `readJson`, `objectField` and `ROOT_PATH` from `vitest/find-workspaces.ts`, `isStringArray` and `isRecord` from `json-guards.ts`, `errorText`, `chosenConfigFile`, and the `Mutation` and `TestIdentity` types. `BUNDLED_CANARY_DIRECTORY`, `CANARY_READING` and `takeCanaryReading` have no production caller until ticket 3.6 (§ The interface ticket 3.6 calls).

**Unverified assumptions.** The table held none. One behavior met while building was verified in the runtime's own source: see the removal question below.

**Sanity check.** Six findings sent to the author at 09:49, all six confirmed and written into the ticket at 09:52 (§ Sanity check). No criterion changed.

**Question to the orchestrator: the removal.** Asked at 10:11 on 2026-10-01, answered at 10:13, decided by the orchestrator (threadId e88c9bb1-bd61-4792-a533-a28c842bc9a7), with no owner sentence in it. The adversarial review found that one recursive `rmSync` over a tree still holding the link does not keep AC5 on every Node `engines` admits. Read from the Node 22.23.3 binary's own `internal/fs/rimraf`: `fs.rmSync` is `rimrafSync`, and on Windows, when unlinking a link entry throws `EPERM`, `fixWinEPERMSync` stats through the link, sees a directory, and `_rmdirSync` can list the target with `readdirSync` and remove each child. Node 24.19.0's `fs.rmSync` is one native call (`binding.rmSync`). Q1, take the link out first with `unlinkSync`: YES. Q2, refuse unless the fresh real path is the very path the reading placed: YES, in place of the containment check, since the placed path was built beneath the state directory's real path and returned by `realpathSync.native`. Both are built; the author rewrote task 3 and design decision 9 to match at 10:18. Neither the author nor I found a case containment catches and equality does not.

**Adversarial review.** One `general-purpose` agent over the three files, 9 findings, at 10:08. Fixed: F1 and F2 by the ruling above; F3, the function's docblock no longer says the copy is always gone; F4, the copy's `node_modules` is made without `recursive` (design decision 10); F9, the comment on `directory` says what Node does. Discarded F5 (a repeated canary id), F6 (a mutation file that climbs out of the canary directory), F7 (a malformed `ran` reply reads as no reply with the error's text) and F8 (the canary file edited between its read and the copy): each needs RT Test's own bundled file or its own executor to be wrong, which Fleet Cooling's codebase cannot bring about, and the orchestrator accepted the discards at 10:13. Post-fix re-validation, the implementer's arm: lint and typecheck, below.

**Gates, all at 13:12 on 2026-10-01 against the final tree** (`daemon/canary-reading.ts` last written at 10:14, `vitest/load-vitest.ts` at 10:12, `falsify/canary-set.ts` at 09:59). `bun run --filter @rt-test/daemon typecheck` exit 0 and `bun run --filter rt-test typecheck` (the CLI, which depends on the daemon) exit 0, each a whole-workspace compile. `bun x oxlint` over the three files exit 0, no warning. `bun x prettier --check` over the three files and this ticket exit 0. `node scripts/check-line-citations.mjs`: clean. The repo-wide `bun run check` is the orchestrator's.

**What was observed, with a scratch probe that is no test.** The probe took readings with the built function, fingerprinted trees (every entry's path, kind, size and content digest) before and after, and read the log.

- Windows, Node 24.19.0, through the run lease, 13:13, exit 0, 41 checks (and the same at 10:15). A real reading of each install through a real `Executor`, the state directory under a root whose nearest Vitest is the other line: 5.0.1 confirmed in 12.8 s and 4.1.11 confirmed in 11.2 s; the placed directory gone with the `Executor` still open; each install's whole tree identical before and after (107 and 118 entries); the other install and the consumer file beside the state directory identical; nothing logged. The resolution through a directory link gave each install's real directory (AC1).
- The same run, with a stand-in job and a stand-in install: a placed path swapped for a link outside the state directory, and one swapped for a link to a sibling inside it, each refused and logged with both paths and the target untouched; a real directory standing where the link was, logged with nothing removed; a placed directory already gone, nothing logged; a call that throws, an outcome that did not end, a value that is no object, a missing `canaries.json`, a missing state directory, an install directory that does not exist, and a canary directory that already holds `node_modules`, each leaving the state directory holding only what it held.
- Linux (WSL), Node 22.23.3 and Node 24.19.0, through the run lease, 13:13, exit 0 each, 27 checks each (and the same at 10:16): the stand-in arms above. No real job ran on Linux.
- `unlinkSync` on a directory link, 10:11, on Windows Node 24.19.0 and Linux Node 22.23.3 and 24.19.0: the entry gone, dangling or not, its target intact, and a real directory refused (`EPERM` on Windows, `EISDIR` on Linux).
- Never run: Windows under Node 22, which this machine does not hold. What the removal does there is reasoned from Node's source.

**Acceptance criteria.** AC1 is ticked on the probe's observation and on the diff, which leaves the unsupported member and its three reasons untouched. AC2 through AC5 stay open under #### ACs Owed a Test.

**README.** No change: nothing calls the function until ticket 3.6, so no command, answer, log line or stored record differs.

**Known limits met while building, beyond § Known limits.** `directory` is what Node's resolver gives: links resolved, and a Windows short name or letter case in the workspace's own path kept as given, so two spellings of one workspace directory would give two strings for one install. Workspaces of one project are spelled from one root, so a consumer sees it only by starting the daemon from two spellings of its root. The reading's directory is handed on as the path it was built at, with no real path taken of it once it is made (the review's fix, § Review Record), so no call stands between making it and placing the set whose failure would leave it empty.

**Change-request candidates, for `review-changes`.**

1. A fork, not a defect: `MISSING_CODES` (`ENOENT`, `ENOTDIR`) is now declared privately in four modules (`defects/definition-files.ts`, `inputs/fingerprint.ts`, `inputs/input-inventory.ts`, `daemon/canary-reading.ts`), each agreeing. Sharing one constant edits three files outside this ticket. Recommendation: leave it; the copies cannot disagree on an edge case while each is the same two codes, and C4 places a one-reader constant beside its reader.

### File List

- `packages/daemon/src/vitest/load-vitest.ts` (dev, modified: the install's directory on the supported resolution)
- `packages/daemon/src/falsify/canary-set.ts` (dev, created)
- `packages/daemon/src/daemon/canary-reading.ts` (dev, created)
- `_agent-docs/tickets/3-5b-canary-reading.md` (dev: task and criterion boxes, Dev Handoff, Completion Notes, File List; the author: the sanity-check and removal corrections)
- `packages/daemon/test/falsify/canaries.test.ts` (tests, modified: D4116 through D4147 and their helpers, lines added only)
- `packages/daemon/test/load-vitest.test.ts` (tests, modified: D4115, lines added only)
- `packages/daemon/test/falsify/defects.json` (tests, modified: 32 records appended)
- `packages/daemon/test/defects.json` (tests, modified: one record appended)
- `_agent-docs/tickets/3-5b-canary-reading.md` (tests: the boxes of AC2 to AC5, Tests Record, File List)

- `_agent-docs/tickets/3-5b-canary-reading.md` (created by create-ticket)
- `_agent-docs/tickets/3-6-canary-gate.md` (created by create-ticket: the gate's draft, at backlog)
- `_agent-docs/sprints/sprint-3-falsification.md` (create-ticket: the order paragraph, the new § Ticket 3.5b with the split's reasoning, and § Ticket 3.6 rescoped to the gate)
- `_agent-docs/sprint-status.yaml` (create-ticket: the key `3-5b-canary-reading`)
- `docs/requirements.md` (create-ticket: FR11's and FR23's markers name 3.5b)
- `docs/glossary.md` (create-ticket: Vitest install and Canary reading)
- `docs/adr/0008-detection-from-task-facts-and-canaries.md` (create-ticket: the sentence on what the daemon keeps of the canaries' reading)

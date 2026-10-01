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

- [ ] AC1: Resolving a workspace's Vitest gives, beside its version, the install's directory: the real directory of the package whose version it reports, also when the workspace reaches that package through a directory link. An unsupported resolution is as it was. (FR23)
- [ ] AC2: A reading taken through an `Executor`, over the bundled set, of each Vitest install this repository holds (4.1 and 5) is confirmed, on Windows and on Linux, with the state directory under a root whose nearest Vitest is the other line: the job runs under the install it was given and no other. The job's experiments are the canaries in the order the file lists them, with the file's project name and assertion error names. (FR11, FR23)
- [ ] AC3: A reply that read `ran`, was not interrupted and carried the install's version reads disagreed when, for any canary, it holds no judgement whose `defectId` is the canary's id, or that judgement's verdict or reason is not exactly what `canaries.json` names for it: another verdict, no verdict, another reason, no reason where one is named, or a reason where none is named. The reading names each such canary by id, in the file's order, with the verdict and reason the reply read, each absent when the reply gave none, and the verdict and reason named. A detail or a fact that differs changes no reading. (FR23)
- [ ] AC4: A reading is no reading, of one kind from a closed set, with a detail where the kind has one. The kinds, the first that holds: the canary directory's `canaries.json` cannot be read or does not hold the members § The canary file names; the set cannot be placed in the state directory; the job did not end with a reply, which a call that throws also is; the reply does not read `ran`; the reply was interrupted; the reply carries another Vitest version than the install's. In the first two no job is sent. (FR23)
- [ ] AC5: A reading's files lie only in the state directory it was given, in a directory of its own whose name no other reading, daemon or worktree shares: a copy of the canary directory and one directory link to the install. When the reading has been taken, however it ended (confirmed, disagreed, an aborted job, an executor that died, a set that could not be placed), that directory is gone, and the install and every file outside the state directory but the log the reading was given are byte-identical to what they were before it. A directory that cannot be removed is named in that log, and the reading is what it would have been. (FR23)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. The copy (`cpSync`), the directory link (`symlinkSync` with `junction`) and the real path (`realpathSync.native`) are what `packages/daemon/test/harness.ts` does for every fixture; the recursive removal of a directory that holds such a link, `rmSync` with `recursive`, is what `removeDirectory` in `test/scripts/run-cleanup.mjs` calls for every such fixture, and what the spike called with both installs checked intact after it; the resolution is `resolveWorkspaceVitest`'s own. Removing the placed directory while the `Executor` that ran its job is still open was run on Windows and held (§ The spike). The one behavior no machine at hand can run, a Windows link across volumes, is relied on by no criterion (§ Known limits).

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (AC1) In `vitest/load-vitest.ts`, give the supported member of `ResolvedVitest` the install's directory, the directory of the manifest `resolveWorkspaceVitest` already resolves, so the reading here and the gate of ticket 3.6 ask the one resolution every job asks (C8) and no second module resolves Vitest. Check every reader of `ResolvedVitest` in the same change (C38), found by `bun run typecheck` (P14) and by `rg -l "ResolvedVitest|resolveWorkspaceVitest" --glob '!**/dist/**'` from the root, which at f6864910 printed, outside the ticket files: `vitest/workspace-session.ts` and `inputs/fingerprint.ts`, which read it, `src/index.ts`, which exports its type, and `packages/daemon/test/load-vitest.test.ts`. No `defects.json` names either symbol, and no file builds the supported member as a literal but `load-vitest.ts` itself (`rg "supported: true"`).
- [ ] (AC2, AC3, AC4) Create `packages/daemon/src/falsify/canary-set.ts`, which loads no Vitest and imports nothing from `daemon/`. It holds the bundled set's directory, two levels above the module, so one relative URL finds it from `src/` and from `dist/`. It reads a canary directory's `canaries.json` and returns the project name, the assertion error names and the canaries in the file's order, or why the file cannot be used (§ The canary file). It builds the experiments for a copy of the set at a given root: workspace path `.`, the file's project name, occurrence 0, each `mutation.file` joined to the root as an absolute path, in the file's order and never sorted, since that order carries a case (§ What the criteria rest on). It reads a job's reply against the set and an install's version: confirmed, disagreed with each canary of AC3, or no reading of AC4's last three kinds. It matches a judgement to its canary by `defectId`, which is the canary's id, and compares the verdict and the reason for exact equality, an absent one equal only to an absent one, which is how D3786's test compares each judgement of a job with the file's; it never compares a detail or a fact.
- [ ] (AC2, AC4, AC5) Create `packages/daemon/src/daemon/canary-reading.ts`, with one exported function that takes a reading (§ The interface ticket 3.6 calls). Given what sends a falsification job (`Executor.falsify`), a state directory, the log and a canary directory, and an install, it: reads the set, returning no reading when it cannot; places a copy under the state directory in a directory named with a prefix and a random identifier, as `createParseRecord` names its record, with one directory link `node_modules/vitest` to the install's directory (link type `junction`, which Linux ignores), taking the state directory and the placed directory each by its real path (`realpathSync.native`); sends one job over the placed copy as its workspace (path `.`, the config file `chosenConfigFile` gives for it), with the set's experiments and assertion error names; reads the outcome, a call that throws reading as a job that did not end with a reply; and removes the placed directory in a `finally`, on every path that made one. Each kind of AC4 is a named constant of one closed set (C3), and its detail is the error's or the outcome's text. The removal is one `rmSync` with `recursive`, which removes the link as an entry and never enters it, with no retry, since the executor's whole process tree has ended when `Executor.falsify` resolves (§ The spike). Before it, the function checks that the placed directory's real path lies inside the state directory's real path (C136), both taken the same way, since a state directory handed over through a link or under a Windows short name is otherwise never its prefix. A check that refuses removes nothing, and it and a removal that fails are logged with the path and the error and never thrown (C30, C36); a directory already gone is no failure (C34, C172). A failure to place removes what it made. The function neither aborts a job nor decides what an abort was for: its caller holds the `Executor`.
- [ ] (Support) Report to the orchestrator, with the handoff, the text for the files this lane does not edit: `docs/architecture.md` (§ Falsification jobs, whose paragraph on `packages/daemon/canaries/` gains the reading: the placed copy, the link, what confirmed, disagreed and no reading mean, that nothing calls it until ticket 3.6, and the sentence that a change to the canary set raises `FALSIFIER_VERSION`, since evidence stored before it was confirmed by the set as it was, and that resolving a workspace's Vitest gives the install's directory, which no section names today; § Host and consumer isolation during discovery and runs, for what a reading writes and where; and the known limits list that ends § Falsification jobs, which gains the entries of § Known limits here), `docs/testing.md` (§ Falsification jobs, mutation transforms and reach), `docs/roadmap.md` (M6: a `files` member of `packages/daemon/package.json`, when a release adds one, lists `canaries`), and `_agent-docs/next-session.md`.
- [ ] (Support) Lint and typecheck.

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
- The contained removal of the placed directory, inside `daemon/canary-reading.ts`. No production module holds one: `rg "rmSync" packages/*/src` at f6864910 finds single files removed, and one recursive removal, in `daemon/windows-acl.ts`. The call the spike measured is `rmSync(directory, { recursive: true })`.

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

AC5 keeps two requirements other tickets deliver. NFR6: "Leave every consumer file byte-identical through falsification, writing no mutation anywhere on disk." NFR4: "Keep state, logs, and results on the machine under the configured state directory, and send nothing off it."

Glossary, verbatim: **Canary fixture**: "A test that fails on purpose in one known way, so RT Test can check that it reads that failure's facts correctly on a Vitest version." **Falsification job**: "One executor job that runs a Vitest workspace's baseline, each of its defects' experiments and the restored baseline in one Vitest instance." As this lane added them: **Vitest install**: "The Vitest that resolves from a Vitest workspace's directory, told apart by the package's real directory and its version. Several workspaces can resolve one install." **Canary reading**: "What one falsification job over the canary fixtures showed under a Vitest install: confirmed when every canary read the verdict and reason named for it, disagreed with the canaries that did not, or no reading otherwise."

The owner's words that bind the design. 03:25 on 2026-09-30: "I only want you to elevate to me if a design decision that is truly broken needs my attention. I'm not terribly interested in chasing edge cases right now. this is tooling for fleet cooling and others going forward". 04:12 on 2026-10-01: "I think the catalog should go. I like asking the simpler question." 04:18: "I like the idea of a trip wire, but if we can do it in a simpler fashion, then let's do it". 04:43: "the deciding factor on whether we should address it is look at Fleet Cooling's codebase. Would this edge case come up in it? If not leave it." 06:29: "i don't mind letting you make design decisions, I just want to avoid the over engineering branch that happened earlier".

#### The canary file

`packages/daemon/canaries/canaries.json`, as ticket 3.3 built it: `{ "projectName": string, "assertionErrors": string[], "canaries": [{ "id": string, "test": { "modulePath": string, "namePath": string[] }, "mutation": { "file": string, "old": string, "new": string }, "judgement": { "verdict": string, "reason"?: string } }] }`. `mutation.file` is relative to the directory. The reader supplies the workspace path and occurrence 0. A file that cannot be read or parsed, or in which a member above is missing or of another type, or whose `canaries` is empty, is one that cannot be used (AC4).

#### The interface ticket 3.6 calls

Names are the dev's; the shape is what 3.6 is written against. One function in `daemon/canary-reading.ts` takes the parts (the `Executor`'s `falsify`, the state directory, the log, a canary directory) and an install (the supported member of `ResolvedVitest`, which carries the directory and the version), and resolves to a canary reading: confirmed with the Vitest version; disagreed with the Vitest version and each canary's id, what it read and what is named; or no reading with its kind, one of AC4's closed set, and a detail text where the kind has one. Ticket 3.6 treats every kind alike (the workspace's job did not run at that input revision, and the reading is taken again at another), so the kind is there for the reason an answer gives and for a test to assert, never for 3.6 to branch on. It never rejects for a failure of the job, the set or the placement. It takes no abort signal: ticket 3.6's module aborts through the `Executor` it holds, and the reading then sees an outcome that did not end, or a reply that was interrupted, and is no reading. `Executor.#job` has no guard against a second job on a busy `Executor`, so its caller takes a reading only while that `Executor` holds no job, as the scheduler's one step at a time ensures in 3.6. The job loads the consumer's Vitest, which is the consumer's code, so the function is called only inside a daemon started for that project, as every job is (C140). `falsify/canary-set.ts` exports the bundled directory, which `daemon-main.ts` hands the gate in 3.6. The canary directory is a part, where P18 would resolve it inside, so that a set that cannot be used (AC4) and a set that names another judgement than the job reads (AC3) can be handed to the function by a test without replacing a module.

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
9. **One removal, with no retry.** A retry is recovery for a directory some process still holds, and the spike shows none does once `Executor.falsify` has resolved, on Windows with the `Executor` still open (C10). A bounded retry would add a count and an interval for a state not reached; a removal that does fail is logged and leaves a directory never read again.

#### Known limits (each entry says what a consumer would see and what must coincide)

- A daemon killed while a reading is taken, or a removal that fails, leaves that reading's directory in the state directory: the set's files and a link, under a name never used again.
- On Windows, a state directory on another volume than the install was not run: this machine has one local volume. If the link cannot be made there, the reading is no reading and says that the set could not be placed, so no workspace is falsified from that state directory and every answer says why once ticket 3.6 lands.
- A consumer's own `vitest` run collects the canary modules when a config at an ancestor of the state directory includes `*.canary.mjs` there, the state directory lies inside the tree, and the run falls in the seconds a reading takes, or at any time after a reading's directory was left behind. Fleet Cooling has no such config.
- RT Test's own workspace listing names a placed copy as a Vitest workspace only when the root `package.json`'s `workspaces` lists the state directory's children, as `.rt-test/*`, or the copy's own directory: `expandPattern` in `vitest/find-workspaces.ts` expands a literal directory or a `parent/*` pattern and nothing else, and the daemon loads only the workspaces its start confirmed. Fleet Cooling's `workspaces` are `apps/*` and `packages/*`.
- `packages/daemon/package.json` has no `files` member, so nothing excludes `canaries/` from a package today. When a release adds one (M6), `canaries` joins it, or every reading is no reading with the set unreadable.
- An install laid out by npm or pnpm was not run; this repository and Fleet Cooling use Bun.

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
- Lane error-kind (a change-request begun at 08:19 on 2026-10-01 in Tree 1, rt-error-kind-cr, threadId 4eb139e2-c18e-4943-a240-2884118569c6) lets a consumer declare an assertion error by its class as well as its name. It changes the judge's reading of an error in `falsify/run-facts.ts` and may add a canary to `packages/daemon/canaries/`. This ticket reads the set from `canaries.json` and holds its size in no criterion and no task, so a canary added there needs no change here; the sizes in § The spike are what was observed at 34d0810f. If that lane changes what `canaries.json` declares for the set's job, or what `Executor.falsify` takes, the reading hands the job what the file declares, as `canaries.test.ts` does, and whichever of the two builds second takes the other's shape. That lane changes what a judgement means, so it raises `FALSIFIER_VERSION` by the rule written beside that constant, whatever it adds to the set; the sentence this ticket reports for `docs/architecture.md` (a change to the canary set raises it) binds no lane until the orchestrator writes it, and the orchestrator carries it to that lane meanwhile. The two share `packages/daemon/canaries/canaries.json` (read here, perhaps written there) and likely `packages/daemon/test/falsify/canaries.test.ts` and `packages/daemon/test/falsify/defects.json`, so the orchestrator decides which builds first in Tree 1 (orchestrator, 08:20).
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

8 raw files and 11 estimated (8 times 1.3, rounded up); code units 6 (five criteria that need code, and validation). Under every limit. Production, modified: `vitest/load-vitest.ts`. Production, created: `falsify/canary-set.ts`, `daemon/canary-reading.ts`. Tests, for create-tests: `test/falsify/canaries.test.ts`, the file for the canary set, where a reading belongs before a new file does (P42); `test/load-vitest.test.ts`; `test/falsify/defects.json`; `test/defects.json`. This ticket's file. Over 10 estimated, so dev delegates in groups over disjoint files, in this order: the resolution's directory and the set's reader, which share no file; then the reading, which calls both. AC2's two jobs through an `Executor` add about half a minute to a run of the suite on Windows and a quarter on Linux, by the table in § The spike.

#### Ticket review

One review agent, ticket-internal, returned 14 edits and 7 questions at 08:36 on 2026-10-01 (E1 to E14, Q1 to Q7). Every finding was applied but these, each settled another way. E2 asked for a bound on the removal's retry: the retry is gone, since the run Q1 asked for showed the directory removable at once on Windows with the `Executor` still open (decision 9). Q6 asked what AC2's matrix of placements costs the suite: AC2 now asks for one placement, the one a wrong resolution would fail in. Q4 asked whether a no reading's reason is a kind or free text: a kind from a closed set, which ticket 3.6 reads for its reason and never branches on.

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

- `_agent-docs/tickets/3-5b-canary-reading.md` (created by create-ticket)
- `_agent-docs/tickets/3-6-canary-gate.md` (created by create-ticket: the gate's draft, at backlog)
- `_agent-docs/sprints/sprint-3-falsification.md` (create-ticket: the order paragraph, the new § Ticket 3.5b with the split's reasoning, and § Ticket 3.6 rescoped to the gate)
- `_agent-docs/sprint-status.yaml` (create-ticket: the key `3-5b-canary-reading`)
- `docs/requirements.md` (create-ticket: FR11's and FR23's markers name 3.5b)
- `docs/glossary.md` (create-ticket: Vitest install and Canary reading)
- `docs/adr/0008-detection-from-task-facts-and-canaries.md` (create-ticket: the sentence on what the daemon keeps of the canaries' reading)

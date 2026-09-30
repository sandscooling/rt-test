# Ticket 2.3n: One environment snapshot

## Ticket

As an agent reading RT Test's answers,
I want the environment the fingerprint counts and the environment every test process starts with to be one copy the daemon took as it began serving,
so that a result read as current was produced under exactly the environment its fingerprint vouches for, whatever later writes the daemon's own `process.env`.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: The start environment is the daemon's environment as it begins serving. The environment part of every fingerprint, and the environment digest every answer composes, counts the start environment under the declaration in effect: a variable set before the daemon begins serving is counted, and a variable the daemon's `process.env` gains, loses or changes afterwards moves no fingerprint, before or after a reconciliation that reads `rt-test.json` again. (NFR3)
- [ ] AC2: Every executor process, the job executor's (discoveries and runs) and the dependency build executor's alike, starts with the start environment as its whole environment: each variable the start environment holds, with its value (on Windows, names differing only in case reach the child as one variable carrying one of their values), and no change the daemon's `process.env` undergoes after the daemon begins serving: a variable it gains, `NODE_V8_COVERAGE` included, is absent from the child, and one it loses or changes reaches the child as the start environment holds it. On Windows the digest counts every value the start environment holds under names differing only in case, so a change to any of them stales results. (NFR3)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                                                                                                                                | Why it matters if wrong                                                                                                                                 | How to check                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | On Node 26 (the project's engines allow `>=26.0.0`), does `normalizeSpawnArguments` in `child_process` still use `options.env` as given, copy a live `NODE_V8_COVERAGE` into it only when it is not an own key, and on Windows keep the first of the names that fold together in sort order, as Node 24.19.0 and the `v22.x` branch do (§ Settled facts)? | AC2's handling of `NODE_V8_COVERAGE` and of names that fold together rests on it; a Node 26 that copies other live variables would let one reach a job. | On a Node 26 install: `node -e "const l=process.binding('natives').child_process.split('\n'); l.forEach((x,i)=>{ if(/const env = options.env\|copyProcessEnvToEnv\(env\|sawKey/.test(x)) console.log(i+1, x) })"`. The pre-push gate runs Node 22 and 24 only, so this row may stay open. |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing, or record why it stays open.
- [ ] (Support) Before the first edit, re-read the landed code of tickets 2.4, 2.3p and 2.3l, and of 2.4d if it has landed, in the files below and confirm § Current structure of the modified files still holds: `InputTrackerOptions` and the tracker's constructor (`inputs/input-tracker.ts`, where 2.3p adds `#listed` beside the `DeclaredNonInputs` construction), the `SnapshotReads` constructor and the `reads` parameters of `workspaceFingerprint` and `discoveryFingerprint` (`inputs/fingerprint.ts`), and `serve` in `daemon/daemon-main.ts`.
- [ ] (AC1, AC2) In `packages/daemon/src/inputs/environment-digest.ts`, add the start environment's type (a read-only environment, as `NodeJS.ProcessEnv` holds one), the function that copies `process.env` into it, which becomes the daemon's one read of its whole environment for the digest and for tests, and the function that builds, for each executor process, a fresh object holding every variable of a start environment plus an own `NODE_V8_COVERAGE` key holding the value a child would see from the copy alone (undefined when the copy holds none), per § Settled facts, so Node neither carries a live value into the child nor writes into the shared copy.
- [ ] (AC1, AC2) In `packages/daemon/src/daemon/daemon-main.ts`, in `serve`, take the start environment once before `new InputTracker(...)` and hand the same copy to the tracker's options and to both `new Executor(...)` constructions.
- [ ] (AC1) In `packages/daemon/src/inputs/input-tracker.ts`, give `InputTrackerOptions` a required member carrying the start environment, and hand it to `new DeclaredNonInputs(...)`.
- [ ] (AC1) In `packages/daemon/src/inputs/declared-non-inputs.ts`, take the start environment through the constructor in place of the field's own `{ ...process.env }` copy, count it in both `countEnvironment` calls, and rewrite the field's docblock, which today says every executor process inherits it, to the new truth.
- [ ] (AC1) In `packages/daemon/src/inputs/fingerprint.ts`, make `SnapshotReads`' `environment` argument required and the `reads` argument of `workspaceFingerprint` and `discoveryFingerprint` required, so no fingerprint counts the live environment by omission; delete `NO_DECLARED_VARIABLES` and the `countEnvironment` import once nothing reads them, and keep the `SnapshotReads.environment` docblock true.
- [ ] (AC2) In `packages/daemon/src/daemon/executor.ts`, give `Executor`'s constructor a required start environment, and in `#startChild` pass `fork` the per-process object the environment-digest function builds from it.
- [ ] (AC2) Sweep `packages/daemon/src`, `docs/` and `README.md` for prose saying an executor process inherits or reads the daemon's live environment (`rg -n -i "inherit|live environment" packages/daemon/src docs README.md`). At drafting (00:12) that found only the `declared-non-inputs.ts` docblock and the `docs/architecture.md` and `README.md` sentences § Doc text already covers. Rewrite each comment found in this change, and add each doc line found to § Doc text.
- [ ] (Support) Send the orchestrator the text in § Doc text, its final wording to follow the build.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `countEnvironment`, `SESSION_VARIABLES`, and the private `comparable` and `FOLDS_CASE` (`inputs/environment-digest.ts`): the count the digest already makes, and the Windows fold rule the per-process object needs to find `NODE_V8_COVERAGE` under any spelling.
- `DeclaredNonInputs` (`inputs/declared-non-inputs.ts`): already counts a start copy under the declaration in effect and logs the `environment:` line; it now receives the copy instead of taking its own.
- `roleLog`, `DaemonLog` (`daemon/daemon-log.ts`) and `daemonEntryPoint` (`daemon/entry-point.ts`): unchanged at both `Executor` constructions and in `#startChild`.

### Must Create

- The start environment's type, the function that copies `process.env` into it, and the function that builds each executor process's environment from it, all in `inputs/environment-digest.ts`, beside the fold rule they share with `countEnvironment`.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Drafted in the main checkout on 2026-09-30 at `19ba5cd`, with ticket 2.4 building there uncommitted (`daemon/server.ts`, `daemon/lifecycle.ts`, `daemon/daemon-connection.ts`, `test/daemon-harness.ts`) and ticket 2.3p built in Tree 1 (`C:/source/rt-test-wt/wt-1`, read there). Written against the tree as it will be once 2.4, 2.3p and 2.3l have landed. It builds after 2.3p and before 2.3o (sprint file § Ticket 2.3n).

Scope clause (sprint file, § Ticket 2.3n, owner 2026-09-29 15:29 and orchestrator 16:11): "the daemon takes one copy of its environment as it begins serving and hands it to the input tracker, whose environment digest counts it, and to both executors, which start each executor process with it as that process's environment, where today each executor process inherits the daemon's live `process.env`". "Git's own reads of the live environment (`HOME`, `XDG_CONFIG_HOME`, and the variables `selection/git-ignored.ts` passes git) stay outside it, since they decide what git ignores rather than what a test sees."

Requirement NFR3: "Never report a result as current unless its stored input fingerprint matches the current inputs."

`docs/architecture.md`, the input tracker paragraph, states both halves this ticket joins: "A workspace's fingerprint is one digest over each input's root-relative path and content digest, a digest of the daemon's environment as it started, ..." and "Each executor process inherits the daemon's whole environment, so a test can read any variable."

Glossary, verbatim: **Input fingerprint**: "A digest of every input, the environment, and the runtime and tool versions that can change a test's result." **Non-input variable**: "An environment variable whose value the input fingerprint leaves out, counting only whether it is set and whether it is empty: a session or process identifier on RT Test's fixed list, or one `rt-test.json` declares in `nonInputVariables`."

This ticket calls the copy the **start environment**, matching the existing field `#startEnvironment` and README's "the daemon's environment, as it started". It avoids "snapshot" in code, since `SnapshotReads` and `CurrentInputs.snapshot` already name one moment's input reads. A glossary entry is proposed in § Doc text.

#### Settled facts

- **Today the digest already counts a start copy, and the executors read the live environment.** `DeclaredNonInputs` holds `readonly #startEnvironment: NodeJS.ProcessEnv = { ...process.env }`, taken when `InputTracker`'s constructor builds it, and both `countEnvironment` calls count it; D2943 proves a later write moves no fingerprint. `Executor.#startChild` calls `fork(entry.file, [], { execArgv, stdio, detached, windowsHide })` with no `env`, so each executor process gets Node's default. Production composes every fingerprint through `currentInputs` (`inputs/current-inputs.ts`: `new SnapshotReads(inputs.root, environment)`, the tracker's `#declared.environment`); only tests reach (`rg -n "new SnapshotReads\(|countEnvironment\(" packages -g '*.ts'` and `rg -n "workspaceFingerprint\(|discoveryFingerprint\(" packages/daemon/src`, 00:03, each production call checked for its `environment` and `reads` arguments; the other calls are the tracker interface's methods) `SnapshotReads`' live default (`countEnvironment(process.env, NO_DECLARED_VARIABLES)`) and the `reads = new SnapshotReads(project.root)` defaults.
- **Node's default child environment is a spread copy of the live one, and Node writes into a given one.** Read in the installed runtime, Node v24.19.0, `node -e "...process.binding('natives').child_process..."` (00:02), `normalizeSpawnArguments`, lines 700 to 755: `const env = options.env || { ...process.env };`, then `copyProcessEnvToEnv(env, 'NODE_V8_COVERAGE', options.env);`, where `copyProcessEnvToEnv` does `env[name] = process.env[name]` when the live value is set and `optionEnv` lacks the name as an own key; then, on `win32`, "On Windows env keys are case insensitive. Filter out duplicates, keeping only the first one (in lexicographic order)" over `ArrayPrototypeSort(envKeys)`; then a key whose value is `undefined` is skipped. The `v22.x` branch's `lib/child_process.js` (fetched from the Node repository, 00:02) has the same three steps (lines 675, 680, 706). So: handing `fork` the shared copy would let Node write a live `NODE_V8_COVERAGE` into it, which the digest counts at the next `read()`; an own `NODE_V8_COVERAGE` key stops the carry, and one holding `undefined` passes nothing.
- **A copy changes nothing a child sees today.** A throwaway probe on Windows under Node 24.19.0 (00:02, deleted once answered; each child sent its `process.env` back over IPC) forked a child with no `env` and one with `{ ...copy }`: identical 75 variables (`same: true`), no hidden `=`-prefixed names; after the parent set a new variable, the child forked from the copy did not see it (`snapshotChildSeesWrite: false`) and a default fork did (`defaultChildSeesWrite: true`).
- **The digest does not move on upgrade.** The copy is taken at the same point of startup as today's (`serve`, before the tracker, which today builds `DeclaredNonInputs` in its constructor), with the same variables, so every stored fingerprint still matches and no result reads stale from this change.

#### Decisions taken here

Each changes the code only, never what an answer says while nothing the daemon process runs writes `process.env`. Nothing in `packages/*/src` does outside the executor process (`rg -n "process\.env" packages/daemon/src`, 23:59, and a search for assignments, `??=`, `delete` and `Object.assign` on `process.env` over `packages/core/src`, `packages/daemon/src` and `packages/cli/src`, 00:12: the only writes are in `vitest/workspace-session.ts`, which runs inside the executor process). Dependencies the daemon loads were not searched.

- **Required, not defaulted.** The start environment is a required member of `InputTrackerOptions`, a required constructor argument of `DeclaredNonInputs` and `Executor`, and `SnapshotReads`' `environment` and the fingerprint functions' `reads` become required, so no code path can fingerprint or start an executor process from the live environment by omission (C6, C8).
- **A fresh object per executor process.** Node writes into the object it is given (§ Settled facts), so the shared copy is never handed to `fork`.
- **`NODE_V8_COVERAGE` is set as an own key on every per-process object**, holding the value the child would get from the copy alone. On Windows that is the value of the first name in sort order among the copy's names that fold to `NODE_V8_COVERAGE`, the one Node's filter keeps without the added key. The all-upper-case spelling sorts before every other spelling that folds to it, so Node's filter keeps the added key, and giving it that value leaves the child's value unchanged. Scope: this covers the one variable Node 22 and 24 carry on Windows and Linux; the z/OS list (`_BPXK_AUTOCVT` and the rest) is not analyzed, since RT Test does not support z/OS.
- **Names that fold together on Windows.** Node passes the child one of them; `countEnvironment` keeps every value under the folded key. The digest then counts a value no test sees, which fails toward staleness, as the owner's standing ruling requires ("the environment fingerprint fails toward staleness (unknown facts, and a missing private third-party field, read as stale)", relayed in the orchestrator's dispatch of this lane, 2026-09-29 23:58).
- **Other processes the daemon starts stay on the live environment** (every `spawn`, `fork`, `execFile` and `exec` call in `packages/daemon/src`, by `rg -n "\b(spawn|fork|execFile|exec)(Sync)?\(" packages/daemon/src`, 00:12, whose other hits are SQLite's `database.exec` and `RegExp.exec`): git (`selection/git-ignored.ts`, the orchestrator's ruling above); the Windows job helper, which `daemon/windows-job.ts` spawns through PowerShell at `systemToolPath`; and the Windows system tools `runSystemTool` spawns (`daemon/windows-system-tool.ts`, which reads `SystemRoot`). None runs a test or the consumer's code. The CLI's spawn of the daemon (`client.ts`) runs in the CLI process, before any copy exists.
- **Where the copy lives.** `DeclaredNonInputs` keeps it for the digest, as today; 2.3o, which counts some variables by value per workspace, reads it there.

#### Current structure of the modified files

Read on `main` at `19ba5cd` (2.3p's versions read in Tree 1, 00:00). Line counts by `wc -l`; code lines are lint's count (`max-lines` 500, blank and comment lines skipped).

- `daemon/daemon-main.ts` (288 lines): `serve(request, scope, log, directory)` builds `new InputTracker({ consumerRoot: request.start.consumerRoot, exclusions: [directory, log.file], log })` first, then takes the endpoint, the key and the store, then `new DaemonLifecycle({ ..., executor: new Executor(log), buildExecutor: new Executor(roleLog(log, BUILD_EXECUTOR_ROLE)), inputs, ... })`. 2.4 leaves it unmodified (its ticket, § Current structure).
- `daemon/executor.ts` (389 lines): `class Executor`, `constructor(log: DaemonLog)`; `#startChild()` forks `daemonEntryPoint(EXECUTOR_ENTRY).file` with `execArgv: [...entry.execArgv, UNHANDLED_REJECTIONS_THROW]`, `stdio: ["ignore", "inherit", "inherit", "ipc"]`, `detached: ownsProcessGroup()`, `windowsHide: true`.
- `inputs/input-tracker.ts` (586 lines, 484 code lines after 2.3p, per its completion notes): `InputTrackerOptions { consumerRoot, exclusions, log }`; the constructor builds `this.#declared = new DeclaredNonInputs(this.#root, log)`, and after 2.3p `this.#listed = new ListedFiles(this.#root)` two lines below. `current()` passes `environment: this.#declared.environment` to `currentInputs`.
- `inputs/declared-non-inputs.ts` (241 lines): `readonly #startEnvironment: NodeJS.ProcessEnv = { ...process.env }`, docblock "The daemon's environment as it started, which every executor process inherits."; `#environment` initialized with `countEnvironment(this.#startEnvironment, declaredVariables(NO_DECLARATION))`; `read()` recounts it under `declaredVariables(this.#declaration)`; `constructor(root, log)`.
- `inputs/fingerprint.ts` (423 lines after 2.3p): `NO_DECLARED_VARIABLES`; `SnapshotReads` `constructor(root, environment = countEnvironment(process.env, NO_DECLARED_VARIABLES).digest)`; `workspaceFingerprint(project, entry, reads = new SnapshotReads(project.root), narrowed?)`; `discoveryFingerprint(project, discovery, reads = new SnapshotReads(project.root))`. 2.3p does not change these signatures.
- `inputs/environment-digest.ts` (126 lines): `FOLDS_CASE`, `SESSION_VARIABLES`, `EnvironmentCount`, `countEnvironment(environment: NodeJS.ProcessEnv, declared)`, `variableEntryProblem`, private `comparable` and `names`.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3n` over the file list (00:00) named 2.3l, 2.3p, 2.4, 2.4b and 2.4d; 2.3o names no file yet.

- **2.4** (review, building in the main checkout): writes `daemon/server.ts`, `daemon/lifecycle.ts`, `daemon/daemon-connection.ts` and `test/daemon-harness.ts`. It leaves `daemon-main.ts` unmodified, and this ticket writes none of its files; `daemon-harness.ts`'s `withEnvironment` and `withPreload` are read by the tests this change breaks, not edited by this ticket.
- **2.3p** (built in Tree 1, landing before this ticket): writes `inputs/fingerprint.ts` (`ProjectInputs`' constructor, `listedDigests`, the setup-file digests inside `workspaceFingerprint` and `discoveryFingerprint`, `protectedFileChangedSince`) and `inputs/input-tracker.ts` (the `#listed` field and its construction beside `new DeclaredNonInputs`, a `cannotWatchListed` watcher callback, `#changed`, the reads). This ticket writes the same two files in other regions: `InputTrackerOptions` and the `DeclaredNonInputs` construction line in the tracker, and the `SnapshotReads` constructor, the two functions' `reads` parameters and `NO_DECLARED_VARIABLES` in the fingerprint module. It adds about two code lines to the tracker's 484.
- **2.3l** (ready-for-dev, landing before this ticket): writes `daemon/scheduler.ts`, `run-history.ts`, `change-record.ts`, `lifecycle.ts`, `workspace-schedule.ts`, `query/answer.ts`, `daemon/protocol.ts`, `client.ts` and `cli/src/answer-text.ts`, and creates `daemon/discovery-history.ts`. No file is shared; `client.ts` is not on this ticket's list.
- **2.4d** (ready-for-dev, order against this ticket not set): writes `inputs/input-tracker.ts` (a named read routed through `#changed`), `inputs/queued-reads.ts`, `daemon/lifecycle.ts`, `query/path-status.ts` and `query-client.ts`, and creates `query/caller-paths.ts`. Both write `input-tracker.ts` in different regions; whichever lands second checks the tracker's code lines against the 500 cap.
- **2.4b** (ready-for-dev): reads `ProjectInputs` in `inputs/fingerprint.ts` and `inputs/current-inputs.ts`, and calls neither fingerprint function nor `SnapshotReads` directly (its ticket, 00:05), so the required `reads` does not reach it.
- **2.3o** (backlog, after this ticket): counts some listed and declared variables by value per workspace; it reads the start environment where `DeclaredNonInputs` keeps it (sprint file: "It builds last, after 2.3m's facts and 2.3n's snapshot").

#### Existing tests this change breaks

Each fails to compile or changes behavior; create-tests repairs them. Found by `rg -l "new (InputTracker|DeclaredNonInputs|Executor|SnapshotReads)\(|(workspace|discovery)Fingerprint\(" packages/daemon/test` (00:12), whose other hits, `query.test.ts` and `scheduler.test.ts`, call the tracker interface's `workspaceFingerprint` and `discoveryFingerprint` methods, which keep their shape. No test constructs `DeclaredNonInputs`; its records' tests reach it through `InputTracker`. Re-run the search on the landed tree, then `bun run typecheck`; a construction inside a script string escapes the typecheck, as the idle-tracker one below does.

- `packages/daemon/test/executor.test.ts`: 15 `new Executor(log)` constructions (`rg -c "new Executor\(" packages/daemon/test/executor.test.ts`, 23:59). Where a test sets a variable the executor process must see (`withEnvironment`, `withPreload`, `withBuildHook`), it mostly builds the executor inside that helper's body, so a copy taken there still holds the variable. Four tests do not: each of `stoppedWhileHeld`'s four callers builds its executor in `inCrashingConsumer` and only then sets `HOLD_VARIABLE` around the held run, and one of them, D2780, also sets `CRASH_VARIABLE` around a second job afterwards. Under this ticket those variables no longer reach the job.
- `packages/daemon/test/input-tracker.test.ts`: six `new InputTracker(...)` constructions, one inside the idle-tracker script string the test spawns, and two `new SnapshotReads(root)` calls in `workspaceFingerprint(...)` calls.
- `packages/daemon/test/lifecycle.test.ts`: two `new InputTracker(...)` constructions.
- `packages/daemon/test/env-files.test.ts`: `rootFingerprint` calls `workspaceFingerprint` without `reads`.
- `packages/daemon/test/discover-tests.test.ts`: `workspaceFingerprint(inputs, entry)` and `discoveryFingerprint(inputs, discovery)` without `reads`.

#### Named-defect records the edits reach

A lane re-proves every record whose test or mutated file it edits. By each record's `file` in `packages/daemon/test/defects.json` at `19ba5cd`: `executor.ts` 39, `input-tracker.ts` 27, `fingerprint.ts` 19, `environment-digest.ts` 17, `declared-non-inputs.ts` 14, `daemon-main.ts` 11. Recount on the landed tree, since 2.3p adds records on `fingerprint.ts` and `input-tracker.ts`. Every record whose test sits in a test file create-tests edits (`executor.test.ts`, `input-tracker.test.ts`, `lifecycle.test.ts`, `env-files.test.ts`, `discover-tests.test.ts`) is re-proved too, unless that file's diff only adds lines as `_agent-docs/crew.md` § Gates allows. D2943's mutation replaces `this.#startEnvironment,` in `read()`'s `countEnvironment` call with `process.env,`, so renaming or re-sourcing that field breaks its anchor. D2759 and D2771 anchor on the `execArgv` and `stdio` lines of `#startChild`'s `fork` options, which an added `env` line leaves whole.

#### Sizing

Raw 15 files, estimated 19.5; code units 3 (two criteria plus validation). The estimate sits just under the file limit. The test-file edits are mostly one repeated edit (a start environment passed at each construction), so the decision-bearing files are the six production ones. Production: modify `daemon/daemon-main.ts`, `daemon/executor.ts`, `inputs/input-tracker.ts`, `inputs/declared-non-inputs.ts`, `inputs/fingerprint.ts` and `inputs/environment-digest.ts`. Tests, for create-tests: `executor.test.ts`, `input-tracker.test.ts`, `lifecycle.test.ts`, `env-files.test.ts`, `discover-tests.test.ts` and `defects.json`. Docs, through the orchestrator: `docs/architecture.md`, `README.md`, and the glossary entry below.

#### Doc text

A draft for the orchestrator, its final wording to follow the build.

- `docs/architecture.md`, the input tracker paragraph: replace "Each executor process inherits the daemon's whole environment, so a test can read any variable." with "Each executor process starts with the environment the daemon copied as it began serving, the one the digest counts, so a test can read any variable, and a later change to the daemon's own environment reaches neither a test nor a fingerprint. Git and the Windows job helper read the daemon's live environment, since neither runs a test."
- `README.md`: replace "Tests still see every variable the daemon inherited." with "Tests see every variable of the daemon's environment as it started, the environment the fingerprint counts."
- `docs/glossary.md`, a new entry after **Non-input variable**: "**Start environment**: The copy of its environment the daemon takes as it begins serving: the input fingerprint counts it, and every process that runs tests starts with it. _Avoid_: live environment, environment snapshot."

#### Previous ticket

2.3p (built in Tree 1, not yet landed): makes each listed setup and global setup file an input of its workspace and moves events on listed files the inputs leave out; it reworded the tracker's and fingerprint module's "no watch covers" prose and left `SnapshotReads` and both fingerprint functions' signatures as they were. It adds `ListedFiles` to the tracker's constructor, two lines below the `DeclaredNonInputs` construction this ticket edits.

### References

- Sprint file § Ticket 2.3n, § Ticket 2.3o and the split note after § Ticket 2.3o.
- `docs/architecture.md`, the input tracker paragraph; `README.md`, the environment section.
- Open GitHub issues: none (`node scripts/list-open-issues.mjs`, 00:04: "0 open issues, complete").
- Grill, 00:08: no question reached the orchestrator or the owner. Every choice the inventory found changes only the code, or was settled by the orchestrator's 16:11 ruling or the standing ruling above.
- Ticket review, one ticket-internal reviewer, 00:08 to 00:11, 11 findings, all applied by create-ticket at 00:12: AC2's clauses on a lost variable and on folded names made consistent (F1); AC1 states the outcome, not the construction order (F2); the fingerprint task claims "by omission" only (F3); sizing recounted to 15 raw files (F4); records on `input-tracker.ts` and in the edited test files added (F5); the method behind each completeness claim recorded (F6 to F9); a prose sweep task added (F10); 2.4d added to the re-read task (F11). AC1 also drops FR6, which this ticket adds nothing to, matching the sprint entry's NFR3.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C6,C8,C39,C40,C45,C46,C48,C55,C57,C58,C117,C147 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P14,P16,P17,P21 -->

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
sizing_ac_count: 3
files_to_modify:
  - packages/daemon/src/daemon/daemon-main.ts
  - packages/daemon/src/daemon/executor.ts
  - packages/daemon/src/inputs/input-tracker.ts
  - packages/daemon/src/inputs/declared-non-inputs.ts
  - packages/daemon/src/inputs/fingerprint.ts
  - packages/daemon/src/inputs/environment-digest.ts
files_to_create:
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

- _agent-docs/tickets/2-3n-env-snapshot.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (modified by create-ticket: § Ticket 2.3n's scope line and ticket link)
- _agent-docs/sprint-status.yaml (modified by create-ticket: the 2-3n line)

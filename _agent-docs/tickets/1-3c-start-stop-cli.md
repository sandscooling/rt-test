# Ticket 1.3c: Start and stop CLI

## Ticket

As a user or coding agent about to let RT Test execute a consumer's tests,
I want `rt-test start` to show me exactly which Vitest configs will execute and ask me, every time, before anything runs, and `rt-test stop` to stop that worktree's daemon, both with versioned `--json` output,
so that no project code runs without an explicit, informed start (FR4), and an agent can drive both commands and read their results without parsing prose.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: Before anything executes, `rt-test start [root]` names the consumer root, the state directory it will use, and each Vitest workspace it found with the config file the daemon will load for it. `root` defaults to the current directory. The state directory is `--state-dir <path>`, a relative path resolved against the current directory, else `.rt-test` under the root. It says in plain words that starting executes each listed config and everything it loads: its plugins, the further project configs and modules it names (which are not listed), `globalSetup`, setup files and test modules. It also names every workspace source it could not read, with the reason.
- [ ] AC2: When stdin and stderr are both terminals, `rt-test start` asks a y/N question on stderr at every start and reads the answer from stdin. Only `y` or `yes`, in any case and with surrounding whitespace ignored, starts the daemon. Any other answer, an empty answer, input that ends, and Ctrl-C each start nothing and exit 1 with the reason "not started: not trusted". When `--trust` is passed on a terminal, the question is still asked, and one line says that `--trust` applies only without a terminal.
- [ ] AC3: When stdin or stderr is not a terminal, `rt-test start` without `--trust` starts nothing and exits 1 with a reason that names the root and says to review the listed configs and pass `--trust`. The listing of AC1 is still given. With `--trust`, it starts without asking.
- [ ] AC4: Trust holds for one invocation only. After a trusted start and a stop, a start of the same root with no terminal and no `--trust` is refused as AC3 says. That refusal holds with every file the trusted start and the stop left in the consumer's tree and the state directory still present, and with the environment as it was for the trusted start.
- [ ] AC5: A trusted start starts that worktree's daemon for exactly the workspaces and config files AC1 listed, and never loads a workspace that was not listed, such as one added after the listing. It exits 0 only after the daemon answers, and reports the daemon's process id, the consumer root, the worktree and project identities, the state directory, the protocol version and the confirmed workspaces. When a daemon already serves the worktree, the start asks nothing, starts nothing and exits 1, naming that daemon's process id. When the daemon cannot start, the command exits 1 with the reason ticket 1.3's client gives.
- [ ] AC6: When no Vitest workspace is found under the root, `rt-test start` asks nothing, starts nothing, and exits 1 with a reason naming the root and every workspace source it could not read.
- [ ] AC7: `rt-test stop [root]` exits 0 only after that worktree's daemon has exited, and names the root and the process id that stopped. With no daemon serving that worktree it exits 1 with a reason naming the root. `root` defaults to the current directory.
- [ ] AC8: With `--json`, stdout carries exactly one JSON document per invocation, whatever the outcome, except a usage error, which writes nothing to stdout. It carries the CLI's `schemaVersion` and the command, and on a failure the reason, which is also written to stderr. The question, the listing and warnings go to stderr. Without `--json`, a success is reported on stdout and a failure's reason on stderr. A missing or unknown command, an unknown option, a missing option value, an extra argument, and `--state-dir` or `--trust` given to `stop` each exit 2 with the usage on stderr and start or stop nothing.
- [ ] AC9: `rt-test start` and `rt-test stop` load no Vitest module, no consumer config and no test file in the CLI's own process, whatever the outcome. A declined, refused or failed start executes no project code in any process.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                                        | Why it matters if wrong                                                                                                                                                                                                                                                 | How to check                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| U1  | In Git for Windows' Git Bash (mintty, without ConPTY), does Node report `process.stdin.isTTY` and `process.stderr.isTTY` as not `true`, so a start there counts as having no terminal (AC3)?                                                                      | If Node reports a terminal where reading the answer fails or hangs, the prompt of AC2 is unusable in that shell. If it reports none, an interactive Git Bash user must pass `--trust`, which is the fail-safe the orchestrator accepted (Q4); the README should say so. | Run `node -p "[process.stdin.isTTY, process.stderr.isTTY]"` in Git Bash's mintty window, in Windows Terminal and in PowerShell. |
| U2  | On a terminal, does Ctrl-C at a pending `readline/promises` `question` leave the question pending? The Node documentation says the interface emits `pause` when it has no `SIGINT` listener, and the raw-mode terminal keeps the process from receiving `SIGINT`. | If it stays pending with no listener, the CLI hangs at Ctrl-C instead of refusing (AC2).                                                                                                                                                                                | In a real terminal, run a probe that awaits `question` with and without an `rl.on("SIGINT")` listener, and press Ctrl-C.        |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing.
- [ ] (AC1, AC5, AC6, AC9) Add a start-plan function to `@rt-test/daemon`'s client (`packages/daemon/src/client.ts`, as ticket 1.3 lands it), exported from `./client`. Given a consumer root and an optional state directory, it returns the absolute root, the state directory `startDaemon` would use, the workspaces from `findVitestWorkspaces`, each with the config file 1.3b's config-file choice picks, and the listing's `notRead` sources. Resolve the state directory through the same code `startDaemon` uses (C8). Build the entries as ticket 1.3's confirmed-start type (1.3 AC11), declared beside `discoverTests` in `discover-tests.ts`: each workspace's path as `VitestWorkspace.path` spells it, and its config file root-relative and `/`-separated. The plan shown is then the value passed (C14). Import that type with `import type` only, since `discover-tests.ts` loads Vitest at run time. It reads files only (C140). Import 1.3b's config-file choice from a module that loads neither Vitest nor `node:sqlite` at run time. If `config-loader.ts` imports Vitest at run time, move the choice beside `find-workspaces.ts`'s config-name lists and have `config-loader.ts` and 1.3's `discoverTests` import it from there. Otherwise export it from `config-loader.ts` if it lands private. The client's module graph still loads neither Vitest nor `node:sqlite` (1.3's client task).
- [ ] (Support) Add a `development` condition pointing at `./src/client.ts` to the `./client` entry of `packages/daemon/package.json` `exports`, as `@rt-test/core`'s `.` entry has, so the CLI typechecks and tests against the daemon's source.
- [ ] (Support) Create the `packages/cli` workspace: `package.json` named `rt-test` (P3), `private: true`, `type: module`, `bin` `{ "rt-test": "./dist/bin.js" }`, the `build` and `typecheck` scripts (P2), and `dependencies` `{ "@rt-test/daemon": "workspace:*" }`. Add `tsconfig.json` and `tsconfig.build.json` shaped as `packages/daemon`'s. Add no third-party dependency: argument parsing is `node:util` `parseArgs` and the question is `node:readline/promises` (§ Spike facts). The orchestrator runs `bun install` once this `package.json` exists, which writes `bun.lock` and links `@rt-test/daemon`. Dev never edits or stages `bun.lock`: it is listed in Execution Metadata because the change alters it, and the orchestrator owns it.
- [ ] (AC8) Create `packages/cli/src/output.ts`: the one `CLI_JSON_SCHEMA_VERSION` constant (1), the exit codes as named constants (0 success, 1 failed or refused, 2 usage), and a writer that puts one JSON document on stdout under `--json` and human text otherwise, with every question, listing line and warning on stderr (C151, C152, C153). Ticket 1.4 adds `summary` and `status` through the same writer.
- [ ] (AC8) Create `packages/cli/src/main.ts` and `packages/cli/src/bin.ts`. `main(argv, io)` takes the arguments and the streams (stdin, stdout, stderr, whether each is a terminal, the current directory) and returns the exit code, so a test drives it in process. It dispatches through a table of commands, each giving its name, options, usage and run function, so 1.4 adds `summary` and `status` as entries. Parse each command's options with `parseArgs` in strict mode with positionals allowed, and turn a missing or unknown command, every `ERR_PARSE_ARGS_*` error and an extra positional into exit 2 with the usage on stderr and nothing on stdout, since a strict parse that throws never reads `--json`. `bin.ts` is the `#!/usr/bin/env node` entry that calls `main` with `process`'s values and sets `process.exitCode`.
- [ ] (AC1, AC2, AC3, AC4) Create `packages/cli/src/trust-prompt.ts`. It renders the listing of AC1 and decides trust for this invocation only. On a terminal (stdin and stderr both), it asks y/N on stderr, adds the `--trust` note when the flag was passed, accepts only `y` or `yes` after trimming and case folding, and treats input that ends and Ctrl-C as no. `question` never settles when stdin ends (§ Spike facts), so settle on the interface's `close` as well. Without a terminal, it returns trusted only for `--trust`. It reads no file and no environment variable and writes nothing.
- [ ] (AC1, AC2, AC3, AC5, AC6) Create `packages/cli/src/commands/start.ts`. In order: resolve the root and any `--state-dir` to absolute paths against `io`'s current directory (never `process.cwd()`), and pass only absolute paths on to the client, so the directory listed is the one `startDaemon` uses (C8). Refuse when `daemonStatus` answers (naming its process id), take the start plan, refuse when it lists no workspace (AC6), render the listing and decide trust, then call `startDaemon` with the plan as the confirmed start, stating trust as 1.3's options type requires. Report its result (AC5). The listing's unread sources are the warning for each `notRead` source (C32); print each once. Report success only after `startDaemon` has resolved (C31).
- [ ] (AC7) Create `packages/cli/src/commands/stop.ts`: resolve the root, call `stopDaemon`, and report the root and the stopped process id once it resolves. Take the id from `stopDaemon`'s result if it carries one, else from a `daemonStatus` answer taken just before the stop. A rejection is exit 1 with its reason.
- [ ] (Support) Send the orchestrator the README text (the `rt-test start` and `stop` usage, `--state-dir`, `--trust`, `--json`, the exit codes, and the U1 outcome for Git Bash; C7) and the `docs/architecture.md` § Current implementation sentence for the CLI.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- Ticket 1.3's client (`@rt-test/daemon/client`, `packages/daemon/src/client.ts`, unbuilt): `startDaemon`, `stopDaemon`, `daemonStatus`, the options type that makes a caller state trust and carry the confirmed start, the confirmed-start type declared beside `discoverTests` (1.3 AC11), and the protocol types it exports. Use the names that land.
- `packages/daemon/src/vitest/find-workspaces.ts` `findVitestWorkspaces(consumerRoot)`, returning `{ workspaces, notRead }`: it imports only `node:fs`, `node:path` and `error-text.ts`, and reads files without executing them.
- 1.3b's config-file choice in `packages/daemon/src/vitest/config-loader.ts` (unbuilt): the one decision of which config file a workspace loads, in Vitest's lookup order over `find-workspaces.ts`'s `VITEST_CONFIG_FILES` and `VITE_CONFIG_FILES`.
- `packages/daemon/src/store/consumer-identity.ts` `defaultStateDirectory`, through 1.3's state-directory resolution in `startDaemon`, never a second rule.
- `packages/daemon/src/vitest/error-text.ts` `errorText` for a rejection's reason and its causes.
- `node:util` `parseArgs` and `node:readline/promises` `createInterface`, both in Node's standard library.
- For create-tests: `packages/daemon/test/harness.ts` `inTempDir`, `copyFixture` and `linkVitest`; the consumer fixtures under `test/fixtures/daemon/`; and whatever 1.3's tests use to start and stop a real daemon.

### Must Create

- The `packages/cli` workspace: `rg -n "\"bin\"|parseArgs|readline" packages --glob '!**/node_modules/**'` finds nothing, and `packages/` holds only `core` and `daemon`.
- The start-plan function: nothing returns a workspace's config file today. `VitestWorkspace` is `{ path, directory }`.
- The `development` condition on `./client`: `packages/daemon/package.json` has none on any entry.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Ticket 1.3 was split three ways (orchestrator, 2026-09-26 13:45): 1.3 is the daemon and its client, 1.3b keeps runs from writing into the consumer, and this ticket is the user's explicit, trusted start. The build order is 1.3b, then 1.3, then 1.3c. This ticket is written against the tree as it will be once both have landed. It creates `packages/cli`, the first production caller of 1.3's `startDaemon`, `stopDaemon` and `daemonStatus`. Ticket 1.4 then adds `summary` and `status <path>` to the same CLI.

Requirements this ticket delivers (`docs/requirements.md`):

- FR4: "Start and stop the daemon explicitly for one trusted project, and execute no project code before that start." (AC1 to AC7, AC9. The daemon lifecycle is 1.3's; the explicit, trusted start is this ticket's.)

Clauses the criteria rest on:

- The sprint file's 1.3c section: "On a TTY, the start names the root and every Vitest config it will load, says that each workspace's config, `globalSetup`, setup files and test modules will execute, and asks y/N every time. Without a TTY it refuses unless `--trust` is passed. Trust is never persisted and never read from the consumer tree (owner ruling 2026-09-26 13:44)." (AC1 to AC4)
- C140: "No code path runs a project's tests, loads its Vitest config or imports its files unless that project was explicitly started and trusted. Before that start, discovery reads files without executing them." (AC1, AC9)
- P32: "The daemon is the sole test executor. The CLI and programmatic API query results or wait for a revision scoped to given files, and never spawn Vitest". ADR-0002: "The CLI and the programmatic API query results, or wait for the results covering given files, and never spawn Vitest." (AC9)
- `docs/architecture.md` § Query surface: "Every `--json` payload carries a schema version". C151: "Every `--json` payload carries a schema version, and a breaking field change bumps it." C152: "`--json` output goes to stdout alone; diagnostics and warnings go to stderr." (AC8)
- C153: "A CLI command that could not answer exits non-zero with a reason; it never prints an empty success-shaped result." (AC2, AC3, AC5, AC6, AC7)
- C130: "A selection or run that executed no tests reports that nothing ran and why, never success." And AGENTS.md: "A zero-test selection is not proof of success." (AC6)
- C31: "A success event, log line or message is emitted only after the operation completed, never before." (AC5, AC7)
- P3: "`rt-test` is the published CLI's name. Name internal packages `@rt-test/<name>`." P33: "Expose the product as a CLI with `--json` output in front of the daemon".
- Glossary: **Consumer** "A project whose tests RT Test runs." **Daemon** "The local process that alone executes a started consumer's tests and answers queries about them." **Worktree** "One checked-out consumer root, to which results are scoped".

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 1.3c` over `packages/cli`, `packages/daemon/package.json`, `packages/daemon/src/client.ts`, `find-workspaces.ts`, `config-loader.ts`, `package.json`, `bun.lock`, `README.md` and `docs/architecture.md` named tickets 1.3 and 1.3b, both ready-for-dev.

- **1.3** creates `client.ts` and the `./client` export, and writes `packages/daemon/package.json`. This ticket builds after it and edits both after it lands. Under Q5, 1.3's AC11 has `startDaemon` take the confirmed start and send it to the daemon over the startup channel. It also has `discoverTests` load only a workspace whose path and chosen config file both match a confirmed entry, and record every other one as not discovered with the reason "not confirmed at start". Under T1, 1.3's client task now states the outcome: "The client's module graph loads neither `node:sqlite` nor Vitest, nor any consumer config or test module, at run time". It allows the client to import `find-workspaces.ts` and 1.3b's config-file choice. Both amendments were relayed from 1.3's author at 16:26.
- **1.3b** creates `config-loader.ts`, with the config-file choice this ticket reuses, and exports the config-name lists from `find-workspaces.ts`. This ticket only reads them and may export the choice.
- **1.4** (backlog) adds `summary` and `status` to this CLI through `main.ts`'s command table and `output.ts`'s writer and schema version.
- **Sprint 2**: a workspace that appears after the start is outside this ticket (orchestrator, Q5).

#### Owner rulings and grill record

Owner ruling, 2026-09-26 13:44, relayed by the orchestrator: on a TTY, ask y/N at every start. Off a TTY, refuse unless `--trust` is passed. Never persist trust, and never read it from the consumer tree.

The questions went to the orchestrator at about 16:20 on 2026-09-26 (crew.md § Questions). The orchestrator decided every one at 16:24, applying the owner's 13:44 ruling; none went to the owner.

- Sizing: proceed as-is, with no split, at about 20 raw files and 26 estimated, with 10 code units (§ Sizing). That is the same basis 1.3b was cleared on.
- T1, the client's module graph. The start plan lives in 1.3's client and reuses `find-workspaces.ts` and 1.3b's config-file choice, so the listing and the loading are one decision. This ticket's criterion is the outcome: the CLI process loads no Vitest module, consumer config or test file (AC9). 1.3's author restated 1.3's client sentence as that outcome instead of naming a directory (§ Pending siblings).
- Q1, configs that cannot be listed. The prompt lists each workspace's config file. It then says in plain words that each config may load further project configs and modules it names, which are not listed. There is no static parse of config code (AC1).
- Q2, `--trust` on a TTY. The question is still asked, as the ruling's words say. The flag is not ignored silently: one line says that `--trust` applies only without a terminal (AC2).
- Q3, no Vitest workspace found. Start refuses, names the root and every source it could not read, and starts nothing. A daemon started over nothing would read as a healthy start (AC6).
- Q4, what counts as a TTY. Both stdin and stderr must be terminals. The question goes to stderr and the answer is read from stdin. Anything else counts as no TTY, which fails safe. The mintty case stays an unverified assumption (U1).
- Q5, the gap between the question and discovery: closed, not accepted. The daemon executes only the workspaces the user confirmed. `startDaemon` takes the confirmed list: the root, and each workspace with the config file shown. A workspace the daemon finds that is not on the list is never loaded, and is recorded as not discovered with its own reason ("not confirmed at start"). That recording is 1.3's AC11, added at about 16:26 (AC5).
- Decided by create and confirmed by the orchestrator: a declined question exits 1 with "not started: not trusted"; a usage error exits 2; start refuses before asking when a daemon already answers; `stop` takes no `--state-dir`; there is one `schemaVersion` constant; a failure under `--json` prints an error document on stdout, with the reason also on stderr.

Ticket review (create-ticket Step 6c, 16:28): 11 edits and 4 questions, all applied. The edits:

- The config-file choice is imported from a module free of Vitest.
- `--state-dir` resolves against `io`'s directory.
- A usage error writes nothing to stdout, and a missing or unknown command exits 2.
- AC5's already-running refusal gets exit 1, and AC5 states its outcome.
- AC4 names its falsifiable case.
- AC9 is observed in a child process.
- The `development` task is Support.
- Unread sources print once.
- The workspace-enumeration search is widened.

The four questions are answered in § Design notes: finding a daemon by root, a config file for every listed workspace, `bun.lock` ownership, and root tooling.

#### Spike facts

Observed 2026-09-26 by probes under `_agent-docs/.scratch/create-ticket-1-3c/`, which were removed when this ticket was finalized.

- **`question` and input that ends.** A `readline/promises` interface on `process.stdin` with a pending `rl.question(...)` emitted `close` when stdin ended, and the question's promise was still pending 2 s later. This held for an empty stdin and for `y` with no newline, on Windows 11 with Node 24.19.0 and in WSL with Node 24.19.0. Node 22 was not probed. So the prompt must settle on `close` (AC2).
- **`parseArgs` errors.** With `strict: true` and `allowPositionals: true`, on Node 24.19.0: `--bogus` threw `ERR_PARSE_ARGS_UNKNOWN_OPTION`. `--state-dir` with no value, `--state-dir --json` and `--trust=yes` threw `ERR_PARSE_ARGS_INVALID_OPTION_VALUE`. `a b` parsed as two positionals, so the command checks the count itself. `-- --json` gave the positional `--json`.
- **The lockfile.** `bun install --lockfile-only` (bun 1.3.14) over a temporary copy of the root manifests, `bun.lock` and a `packages/cli/package.json` named `rt-test` exited 0. It added only a `packages/cli` workspace entry and the line `"rt-test": ["rt-test@workspace:packages/cli"]`. The root `package.json` `workspaces` (`["packages/*", "apps/*"]`) already covers `packages/cli`, so it needs no change.

#### Design notes

- **The start, in order.** Parse the arguments, resolve the root, and refuse if a daemon already answers. Take the plan (files read only), and refuse on no workspace. Render the listing and decide trust. Then call `startDaemon` with the plan and report. No project code runs before `startDaemon`, and `startDaemon` receives only what was shown (Q5).
- **The listing.** Name the root, the state directory, and each confirmed-start entry: the workspace's path and its config file, both as the entry spells them. Then give the fixed sentence of AC1 and each unread source with its reason. Under `--json` the same data sits in the payload, so an agent reviewing a refusal (AC3) reads what it would trust.
- **Streams.** Human success text goes to stdout. The question, the listing, warnings and failure reasons go to stderr. Under `--json`, stdout carries one document, and stderr carries the rest (C152).
- **Payload shape.** Every document carries `schemaVersion`, `command` and `ok`. A failure adds `reason`. A start adds the daemon's fields and the confirmed workspaces. The field names are dev's within these criteria. 1.4 adds its commands under the same version.
- **Command layout for 1.4.** Each command is one module under `src/commands/` and one entry in `main.ts`'s table. Options are parsed per command, so `--state-dir` and `--trust` exist only on `start`.
- **Trust state.** None. The decision is a value inside one `start` invocation, handed to `startDaemon` and dropped. No flag file, environment variable or config key exists to find (AC4).
- **A daemon is found by its root alone.** 1.3 AC9: "Each endpoint's name is derived from the worktree identity", and its Linux socket lives in the runtime directory, not the state directory. So `stop` and start's `daemonStatus` check need no `--state-dir`, whatever state directory the daemon was started with.
- **Every listed workspace has a config file.** `findVitestWorkspaces` lists a directory only when it holds a `vitest.config.*`, or a `vite.config.*` beside a `package.json` depending on Vitest (`holdsVitestConfig` in `find-workspaces.ts`). So 1.3b's choice always finds a file for a listed workspace. A project defined inline in a config is not a workspace. It loads through its workspace's config, which the listing's fixed sentence covers (Q1).
- **Root tooling needs no edit.** The root `build` and `typecheck` scripts run `bun run --filter '*'`, the root `vitest.config.ts` projects `packages/*`, the root `tsconfig.json` includes only `test/**/*.ts` and `vitest.config.ts`, and `.oxlintrc.json` names no workspace. All were read at authoring.
- **Known limits.** Git Bash under mintty may count as no terminal (U1). A daemon's later discovery of a new workspace is Sprint 2's question (Q5).
- **Unanalyzed.** The CLI's start-up time against `docs/plan.md`'s CLI target, which is 1.4's and M1's measurement to make. A consumer root that is a symbolic link: identities come from 1.2's `consumerIdentity`, which resolves the real path.

#### Sizing

About 20 raw files, 26 estimated: the production files Execution Metadata lists. `config-loader.ts` and `find-workspaces.ts` change only as the start-plan task says, depending on how 1.3b lands its config-file choice. The orchestrator writes `bun.lock`, `README.md` and `docs/architecture.md`. There are about five test files. Code units: 9 criteria plus validation. The work splits into two disjoint groups: the CLI package, and the start plan in the daemon package. The orchestrator ruled to proceed (§ Grill record). Implementation is delegated to implementer agents, since the estimate is over 10.

#### Current structure of the modified files

- `packages/daemon/package.json` (before 1.3): `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`, with no `development` condition. 1.3 adds `./client`. `packages/core/package.json`'s `.` entry is `{ "development": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }`. Ticket 1.1 added that condition when the daemon first imported core (commit 826725a), which is the pattern for `./client`.
- `packages/daemon/src/client.ts`: created by 1.3. Read it as landed before editing.
- `packages/daemon/src/vitest/find-workspaces.ts`: `findVitestWorkspaces(consumerRoot): WorkspaceListing`, where `WorkspaceListing` is `{ workspaces: VitestWorkspace[]; notRead: UnreadWorkspaceSource[] }`, `VitestWorkspace` is `{ path, directory }` (`path` is `/`-separated and `.` for the root), and `UnreadWorkspaceSource` is `{ source, reason }`. 1.3b exports its config-name lists.
- The root `tsconfig.base.json` sets `customConditions: ["development"]`, and each workspace's `tsconfig.build.json` resets it to `[]`, so a build reads the daemon's `dist`. The root `vitest.config.ts` projects `packages/*`, so `packages/cli` becomes a test project with no config change.

#### Existing tests this change breaks

None expected. The change adds a workspace, a client export and a package-export condition. No test asserts the daemon's exports (1.3's Dev Notes, § Existing tests). No test enumerates the real workspaces. `rg -n "packages/(core|daemon|\*)|readdir[A-Za-z]*\([^)]*packages|\"packages\"|'packages'" test scripts lint packages/*/test --glob '*.{ts,mjs,mts,js}' --glob '!**/fixtures/**'` hits only paths inside fixtures each test builds (`catalog.test.ts`, `workspace-scripts.test.ts`, `find-workspaces.test.ts`, `store.test.ts`, `list-unbuilt-work.test.ts`, `defects/harness.ts`). It also hits two scripts, `scripts/lib/defects/catalog.mjs` and `scripts/lib/standards/citation-scope.mjs`, which name the top-level `packages` directory, not a workspace. `scripts/check-workspace-scripts.mjs` checks the real root in `bun run typecheck`, not in a test, and requires `build` and `typecheck` in the new `package.json` (P2). The defect sandbox walks every symbolic link under the copied `packages/` (`scripts/lib/defects/catalog.mjs`), so it picks up `packages/cli/node_modules/@rt-test/daemon` unchanged. Unanalyzed: 1.3's own client tests after Q5's API change, which 1.3 owns. For create-tests: AC9's first sentence is observable only in a process that has not loaded Vitest, so run the CLI entry as a child process and record the modules it loads. An in-process `main` test cannot fail it.

#### Previous ticket

1.3b (ready-for-dev, the nearest earlier key): its config-file choice picks the file Vitest would load, in Vitest's order, and passes it as `config`, so the file and the loader are one decision. This ticket's listing reuses that decision. 1.3 (ready-for-dev): `startDaemon` resolves a relative state directory against the caller's working directory and creates it, requires the caller to state trust, and refuses a second daemon and an overlong socket path. `daemonStatus` and `stopDaemon` reject with a reason naming the root when no daemon answers. `stopDaemon` resolves only after the process has exited. On Windows a stop goes through the protocol, never a signal: there, `process.kill(pid, "SIGTERM")` ended the child with neither its `SIGTERM` handler nor its `exit` event running (1.3 § Spike facts, Signals).

### References

- `docs/architecture.md` § Components: "CLI and API: Query and wait through versioned `--json` output or a small programmatic API; never execute".
- `docs/plan.md`: "1. A user explicitly starts RT Test for a trusted project." And "explicit start/stop, a CLI with versioned `--json` output".
- Ticket 1.3 (`_agent-docs/tickets/1-3-daemon-lifecycle.md`) § Tasks (the client entry) and § Owner rulings (Q2, Q6). Ticket 1.3b (`_agent-docs/tickets/1-3b-run-safety.md`) § Config loading.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete`.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C4,C5,C7,C8,C14,C30,C31,C32,C36,C38,C48,C52,C59,C130,C140,C146,C151,C152,C153 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P1,P2,P3,P9,P13,P16,P17,P18,P19,P20,P21,P32,P33,P41,P42 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area: packages/cli, packages/daemon
is_consolidation: false
sizing_ac_count: 10
files_to_modify:
  - packages/daemon/package.json
  - packages/daemon/src/client.ts
  - packages/daemon/src/vitest/config-loader.ts
  - packages/daemon/src/vitest/find-workspaces.ts
  - bun.lock
files_to_create:
  - packages/cli/package.json
  - packages/cli/tsconfig.json
  - packages/cli/tsconfig.build.json
  - packages/cli/src/bin.ts
  - packages/cli/src/main.ts
  - packages/cli/src/output.ts
  - packages/cli/src/trust-prompt.ts
  - packages/cli/src/commands/start.ts
  - packages/cli/src/commands/stop.ts
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

Planning files the create-ticket run wrote:

- `_agent-docs/tickets/1-3c-start-stop-cli.md` (created)
- Held for the orchestrator, as exact text: `_agent-docs/sprint-status.yaml` (1.3c to `ready-for-dev`), and the sprint file's 1.3c section (the ticket-file link). `README.md` and `docs/architecture.md` text follows from dev-ticket's Support task. `docs/requirements.md` needs no change, since FR4's marker already names 1.3c.

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

- [x] AC1: Before anything executes, `rt-test start [root]` names the consumer root, the state directory it will use, and each Vitest workspace it found with the config file the daemon will load for it. `root` defaults to the current directory. The state directory is `--state-dir <path>`, a relative path resolved against the current directory, else `.rt-test` under the root. It says in plain words that starting executes each listed config and everything it loads: its plugins, the further project configs (such as those in `test.projects`) and modules it names, which are not listed, `globalSetup`, setup files and test modules. It also names every workspace source it could not read, with the reason.
- [x] AC2: When stdin and stderr are both terminals, `rt-test start` asks a y/N question on stderr at every start and reads the answer from stdin. Only `y` or `yes`, in any case and with surrounding whitespace ignored, starts the daemon. Any other answer, an empty answer, input that ends, and Ctrl-C each start nothing and exit 1 with the reason "not started: not trusted". When `--trust` is passed on a terminal, the question is still asked, and one line says that `--trust` applies only without a terminal.
- [x] AC3: When stdin or stderr is not a terminal, `rt-test start` without `--trust` starts nothing and exits 1 with a reason that names the root and says to review the listed configs and pass `--trust`. The listing of AC1 is still given. With `--trust`, it starts without asking.
- [x] AC4: Trust holds for one invocation only. After a trusted start and a stop, a start of the same root with no terminal and no `--trust` is refused as AC3 says. That refusal holds with every file the trusted start and the stop left in the consumer's tree and the state directory still present, and with the environment as it was for the trusted start.
- [x] AC5: A trusted start starts that worktree's daemon for exactly the workspaces and config files AC1 listed, and never loads a workspace that was not listed, such as one added after the listing. It exits 0 only after the daemon answers, and reports the daemon's process id, the consumer root, the worktree and project identities, the state directory, the protocol version and the confirmed workspaces. When a daemon already serves the worktree, the start asks nothing, starts nothing and exits 1, naming that daemon's process id. When something holds the worktree's endpoint that the client cannot confirm as this user's daemon of this protocol version, the start likewise asks nothing, starts nothing and exits 1 with the client's reason. When the daemon cannot start, the command exits 1 with the reason ticket 1.3's client gives.
- [x] AC6: When no Vitest workspace is found under the root, `rt-test start` asks nothing, starts nothing, and exits 1 with a reason naming the root and every workspace source it could not read.
- [x] AC7: `rt-test stop [root]` exits 0 only after that worktree's daemon has exited, and names the root and the process id that stopped. With no daemon serving that worktree it exits 1 with a reason naming the root. `root` defaults to the current directory.
- [x] AC8: With `--json`, stdout carries exactly one JSON document per invocation, whatever the outcome, except a usage error, which writes nothing to stdout. It carries the CLI's `schemaVersion` and the command, and on a failure the reason, which is also written to stderr. The question, the listing and warnings go to stderr. Without `--json`, a success is reported on stdout and a failure's reason on stderr. A missing or unknown command, an unknown option, a missing option value, an extra argument, and `--state-dir` or `--trust` given to `stop` each exit 2 with the usage on stderr and start or stop nothing.
- [x] AC9: `rt-test start` and `rt-test stop` load no Vitest module, no consumer config and no test file in the CLI's own process, whatever the outcome. A declined, refused or failed start executes no project code in any process.

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

Resolutions (dev, 2026-09-27, Node 24.19.0 on Windows 11):

- **U1: FALSE for the Git Bash this machine has.** Git for Windows 2.55.0's mintty runs through ConPTY: a probe launched in a mintty window (`mintty.exe -e bash -lc "node -e ..."`, writing its result to a file so stdin and stderr stayed the window's) read `[true, true]` for `process.stdin.isTTY` and `process.stderr.isTTY`. So Git Bash counts as a terminal and gets the question. Nothing in the criteria rested on the premise; the code is the same `isTTY` check either way, and a shell that reports no terminal still fails safe to AC3. Windows Terminal and PowerShell were not probed interactively: this session has no interactive console. Both are Windows consoles, the same ConPTY path mintty now uses.
- **U2: CONFIRMED in part, and settled by the design.** Node's embedded source (`process.binding('natives')['internal/readline/interface']`, the `case 'c':` branch of the ctrl-key switch) emits `SIGINT` on the interface when it has a listener; with none it closes the interface and rejects the pending question with `AbortError('Aborted with Ctrl+C')`, and Ctrl-D on an empty line does the same. A probe feeding `\x03` to a `terminal: true` interface observed: no listener, the question rejected and `close` fired; with a listener that closes the interface, `SIGINT` then `close` fired and the question stayed pending. So the prompt registers a `SIGINT` listener that closes the interface, settles "no" on `close`, and treats a rejected question as "no". It never hangs on either path. Node 22 was not probed; the listener path does not depend on the no-listener branch that changed.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing.
- [x] (AC1, AC5, AC6, AC9) Create the start plan in `packages/daemon/src/start-plan.ts`, re-exported from `client.ts` and so from `./client`. Given a consumer root and an optional state directory, it returns the absolute root, the state directory `startDaemon` would use, a `ConfirmedStart` (`packages/daemon/src/vitest/confirmed-start.ts`), and the listing's `notRead` sources. Build each `ConfirmedWorkspace` from `findVitestWorkspaces` and `chosenConfigFile(workspace)`, which already spells the file root-relative and `/`-separated, so the plan shown is the value passed (C14). Move the state-directory resolution (the default `.rt-test` under the root, and a relative path made absolute) into this module, and have `startDaemon` import it, so there is one resolution (C8). It reads files only (C140). `confirmed-start.ts` imports only `config-loader.ts`, which imports only `node:fs`, `node:path` and `find-workspaces.ts`, so neither `config-loader.ts` nor `find-workspaces.ts` changes. The client's module graph still loads neither Vitest nor `node:sqlite` (1.3's client task).
- [x] (AC5) Export `servingDaemon(consumerRoot)` from `client.ts`, wrapping its existing `statusIfServing`. It resolves undefined when nothing listens on the worktree's endpoint and the status when this user's daemon answers. It rejects with the client's named reason otherwise: an endpoint holder that cannot prove it is this user's daemon, an unreachable endpoint, or a daemon of another protocol version.
- [x] (AC7) Make `stopDaemon` resolve `{ pid }`, the process id from the stop acknowledgement it already reads and proves, in place of `void`.
- [x] (Support) Add a `development` condition pointing at `./src/client.ts` to the `./client` entry of `packages/daemon/package.json` `exports`, as `@rt-test/core`'s `.` entry has, so the CLI typechecks and tests against the daemon's source.
- [x] (Support) Create the `packages/cli` workspace: `package.json` named `rt-test` (P3), `private: true`, `type: module`, `bin` `{ "rt-test": "./dist/bin.js" }`, the `build` and `typecheck` scripts (P2), and `dependencies` `{ "@rt-test/daemon": "workspace:*" }`. Add `tsconfig.json` and `tsconfig.build.json` shaped as `packages/daemon`'s. Add no third-party dependency: argument parsing is `node:util` `parseArgs` and the question is `node:readline/promises` (§ Spike facts). The orchestrator runs `bun install` once this `package.json` exists, which writes `bun.lock` and links `@rt-test/daemon`. Dev never edits or stages `bun.lock`: it is listed in Execution Metadata because the change alters it, and the orchestrator owns it.
- [x] (AC8) Create `packages/cli/src/output.ts`: the one `CLI_JSON_SCHEMA_VERSION` constant (1), the exit codes as named constants (0 success, 1 failed or refused, 2 usage), and a writer that puts one JSON document on stdout under `--json` and human text otherwise, with every question, listing line and warning on stderr (C151, C152, C153). Ticket 1.4 adds `summary` and `status` through the same writer.
- [x] (AC8) Create `packages/cli/src/main.ts` and `packages/cli/src/bin.ts`. `main(argv, io)` takes the arguments and the streams (stdin, stdout, stderr, whether each is a terminal, the current directory) and returns the exit code, so a test drives it in process. It dispatches through a table of commands, each giving its name, options, usage and run function, so 1.4 adds `summary` and `status` as entries. Parse each command's options with `parseArgs` in strict mode with positionals allowed, and turn a missing or unknown command, every `ERR_PARSE_ARGS_*` error and an extra positional into exit 2 with the usage on stderr and nothing on stdout, since a strict parse that throws never reads `--json`. `bin.ts` is the `#!/usr/bin/env node` entry that calls `main` with `process`'s values and sets `process.exitCode`.
- [x] (AC1, AC2, AC3, AC4) Create `packages/cli/src/trust-prompt.ts`. It renders the listing of AC1 and decides trust for this invocation only. On a terminal (stdin and stderr both), it asks y/N on stderr, adds the `--trust` note when the flag was passed, accepts only `y` or `yes` after trimming and case folding, and treats input that ends and Ctrl-C as no. `question` never settles when stdin ends (§ Spike facts), so settle on the interface's `close` as well. Without a terminal, it returns trusted only for `--trust`. It reads no file and no environment variable and writes nothing.
- [x] (AC1, AC2, AC3, AC5, AC6) Create `packages/cli/src/commands/start.ts`. In order: resolve the root and any `--state-dir` to absolute paths against `io`'s current directory (never `process.cwd()`), and pass only absolute paths on to the client, so the directory listed is the one `startDaemon` uses (C8). Ask `servingDaemon`: on a status, refuse naming its process id; on a rejection, exit 1 with its reason. Either way, ask nothing and never retry. Then take the start plan, refuse when it lists no workspace (AC6), render the listing and decide trust, then call `startDaemon` with the plan as the confirmed start, stating trust as 1.3's options type requires. Report its result (AC5). The listing's unread sources are the warning for each `notRead` source (C32); print each once. Report success only after `startDaemon` has resolved (C31).
- [x] (AC7) Create `packages/cli/src/commands/stop.ts`: resolve the root, call `stopDaemon`, and report the root and the process id `stopDaemon` resolves with. Take no `daemonStatus` answer for it: that rejects on a daemon of another protocol version, which `stopDaemon` stops. A rejection is exit 1 with its reason.
- [x] (Support) Send the orchestrator the README text (the `rt-test start` and `stop` usage, `--state-dir`, `--trust`, `--json`, the exit codes, and the U1 outcome for Git Bash; C7) and the `docs/architecture.md` § Current implementation sentence for the CLI.
- [x] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- Ticket 1.3's client (`@rt-test/daemon/client`, `packages/daemon/src/client.ts`, landed in 7f76212 and 127caee): `startDaemon(options)` with `StartDaemonOptions` (`trusted: true`, `start: ConfirmedStart`, optional `stateDirectory`), `stopDaemon`, `daemonStatus`, the private `statusIfServing` that `servingDaemon` wraps, and the re-exported `ConfirmedStart`, `ConfirmedWorkspace`, `DaemonIdentity`, `StatusResponse` and `PROTOCOL_VERSION`.
- `packages/daemon/src/vitest/confirmed-start.ts`: `ConfirmedStart`, `ConfirmedWorkspace` and `chosenConfigFile(workspace)`, the one decision of which config file a workspace loads, spelled root-relative and `/`-separated. Its only consumers today are tests (`packages/daemon/test/harness.ts`), so the start plan is its production consumer (C59).
- `packages/daemon/src/vitest/find-workspaces.ts` `findVitestWorkspaces(consumerRoot)`, returning `{ workspaces, notRead }`: it imports only `node:fs`, `node:path` and `error-text.ts`, and reads files without executing them.
- `packages/daemon/src/store/consumer-identity.ts` `defaultStateDirectory`, through 1.3's state-directory resolution in `startDaemon`, never a second rule.
- `packages/daemon/src/vitest/error-text.ts` `errorText` for a rejection's reason and its causes.
- `node:util` `parseArgs` and `node:readline/promises` `createInterface`, both in Node's standard library.
- For create-tests: `packages/daemon/test/harness.ts` `inTempDir`, `copyFixture` and `linkVitest`; the consumer fixtures under `test/fixtures/daemon/`; and whatever 1.3's tests use to start and stop a real daemon.

### Must Create

- The `packages/cli` workspace: `rg -n "\"bin\"|parseArgs|readline" packages --glob '!**/node_modules/**'` finds nothing, and `packages/` holds only `core` and `daemon`.
- The start plan: nothing in production builds a `ConfirmedStart` from the listing today.
- `servingDaemon`: `statusIfServing` is private, and `daemonStatus` rejects alike for nothing listening and for an endpoint it cannot trust.
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
- **1.3b** creates `config-loader.ts`, with the config-file choice this ticket reuses, and exports the config-name lists from `find-workspaces.ts`. This ticket only reads them, through `confirmed-start.ts`'s `chosenConfigFile`.
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

Dev sanity check (2026-09-27, from rt-t1-3c-dev against `client.ts` as landed in 7f76212 and 127caee): three findings, all confirmed by create against the landed code.

- F1: the confirmed-start type and `chosenConfigFile` live in `vitest/confirmed-start.ts`, which is free of Vitest. So the plan goes in a new `start-plan.ts` that also holds the one state-directory resolution, and `config-loader.ts` and `find-workspaces.ts` are untouched.
- F2: `stopDaemon` resolved `void`, and `daemonStatus` rejects on a daemon of another protocol version that `stopDaemon` can stop. So `stopDaemon` resolves `{ pid }` from its proven acknowledgement, and D1491's `stop: undefined` breaks.
- F3: `daemonStatus` rejects alike for nothing listening and for an endpoint it cannot trust. So `servingDaemon` exposes `statusIfServing`, and start refuses on either a status or a rejection, asking nothing (AC5).

AC1 names `test.projects` per the orchestrator's note from 1.3's review.

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
- **A daemon is found by its root alone.** 1.3 AC9: "Each endpoint's name is derived from the worktree identity", and its Linux socket lives in the runtime directory, not the state directory. So `stop` and start's `servingDaemon` check need no `--state-dir`, whatever state directory the daemon was started with.
- **Every listed workspace has a config file.** `findVitestWorkspaces` lists a directory only when it holds a `vitest.config.*`, or a `vite.config.*` beside a `package.json` depending on Vitest (`holdsVitestConfig` in `find-workspaces.ts`). So 1.3b's choice always finds a file for a listed workspace. A project defined inline in a config is not a workspace. It loads through its workspace's config, which the listing's fixed sentence covers (Q1).
- **Root tooling needs no edit.** The root `build` and `typecheck` scripts run `bun run --filter '*'`, the root `vitest.config.ts` projects `packages/*`, the root `tsconfig.json` includes only `test/**/*.ts` and `vitest.config.ts`, and `.oxlintrc.json` names no workspace. All were read at authoring.
- **Known limits.** A shell that reports no terminal on stdin or stderr gets the no-terminal path of AC3; Git for Windows 2.55's mintty reports both (U1's resolution). A daemon's later discovery of a new workspace is Sprint 2's question (Q5).
- **Unanalyzed.** The CLI's start-up time against `docs/plan.md`'s CLI target, which is 1.4's and M1's measurement to make. A consumer root that is a symbolic link: identities come from 1.2's `consumerIdentity`, which resolves the real path.

#### Sizing

About 20 raw files, 26 estimated: the production files Execution Metadata lists. The orchestrator writes `bun.lock`, `README.md` and `docs/architecture.md`. There are about five test files. Code units: 9 criteria plus validation. The work splits into two disjoint groups: the CLI package, and the start plan in the daemon package. The orchestrator ruled to proceed (§ Grill record). Implementation is delegated to implementer agents, since the estimate is over 10.

#### Current structure of the modified files

- `packages/daemon/package.json` (before 1.3): `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`, with no `development` condition. 1.3 adds `./client`. `packages/core/package.json`'s `.` entry is `{ "development": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }`. Ticket 1.1 added that condition when the daemon first imported core (commit 826725a), which is the pattern for `./client`.
- `packages/daemon/src/client.ts`: created by 1.3. Read it as landed before editing.
- `packages/daemon/src/vitest/find-workspaces.ts`: `findVitestWorkspaces(consumerRoot): WorkspaceListing`, where `WorkspaceListing` is `{ workspaces: VitestWorkspace[]; notRead: UnreadWorkspaceSource[] }`, `VitestWorkspace` is `{ path, directory }` (`path` is `/`-separated and `.` for the root), and `UnreadWorkspaceSource` is `{ source, reason }`. 1.3b exports its config-name lists.
- The root `tsconfig.base.json` sets `customConditions: ["development"]`, and each workspace's `tsconfig.build.json` resets it to `[]`, so a build reads the daemon's `dist`. The root `vitest.config.ts` projects `packages/*`, so `packages/cli` becomes a test project with no config change.

#### Existing tests this change breaks

`packages/daemon/test/daemon.test.ts` D1491 ("a stop resolves only once the daemon's process has exited and its endpoint accepts no connection") pins `stop: undefined` in its `toStrictEqual`, which `stopDaemon`'s new `{ pid }` breaks. Otherwise the change adds a workspace, client exports and a package-export condition. No test asserts the daemon's exports (1.3's Dev Notes, § Existing tests). No test enumerates the real workspaces. `rg -n "packages/(core|daemon|\*)|readdir[A-Za-z]*\([^)]*packages|\"packages\"|'packages'" test scripts lint packages/*/test --glob '*.{ts,mjs,mts,js}' --glob '!**/fixtures/**'` hits only paths inside fixtures each test builds (`catalog.test.ts`, `workspace-scripts.test.ts`, `find-workspaces.test.ts`, `store.test.ts`, `list-unbuilt-work.test.ts`, `defects/harness.ts`). It also hits two scripts, `scripts/lib/defects/catalog.mjs` and `scripts/lib/standards/citation-scope.mjs`, which name the top-level `packages` directory, not a workspace. `scripts/check-workspace-scripts.mjs` checks the real root in `bun run typecheck`, not in a test, and requires `build` and `typecheck` in the new `package.json` (P2). The defect sandbox walks every symbolic link under the copied `packages/` (`scripts/lib/defects/catalog.mjs`), so it picks up `packages/cli/node_modules/@rt-test/daemon` unchanged. Unanalyzed: 1.3's own client tests after Q5's API change, which 1.3 owns. For create-tests: AC9's first sentence is observable only in a process that has not loaded Vitest, so run the CLI entry as a child process and record the modules it loads. An in-process `main` test cannot fail it.

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
  - bun.lock
files_to_create:
  - packages/daemon/src/start-plan.ts
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

Dev session: threadId 1e481bae-d2cc-44b5-af52-4afd06eeaa63

#### Test Files This Change Broke

- `packages/daemon/test/daemon.test.ts` D1491 pins `stop: undefined` in its `toStrictEqual`; `stopDaemon` now resolves `{ pid }` with the process that acknowledged the stop (sanity check F2, confirmed by the author). The repair pins that pid, which the test already holds as `identity.pid`.
- `packages/daemon/test/daemon.test.ts` D1503 matches `/process 4242\b.*protocol version 2\b.*can be stopped/`. The mismatch message now ends "It can be stopped, and then started again." in place of naming `stopDaemon`, so it still matches; no repair expected. Listed because its subject text changed.

#### ACs Owed a Test

- AC4: after a trusted start and a stop, a start of the same root with no terminal and no `--trust` is refused as AC3 says, with every file the start and stop left in place. The code keeps no trust state (`decideTrust` reads no file or environment), but the guarantee is about a real start and stop, which this session did not run (AGENTS.md: no daemon without authorization).
- AC5: a trusted start (`--trust` without a terminal) exits 0 only after the daemon answers, and reports pid, root, both identities, state directory, protocol version and the confirmed workspaces; a start with a daemon already serving asks nothing and exits 1 naming its pid; an endpoint holder the client cannot confirm exits 1 with the client's reason, asking nothing.
- AC7: a stop of a serving daemon exits 0 only once it has exited, naming the root and the stopped pid. The no-daemon half was observed (exit 1, "No daemon serves the worktree at <root>.").

#### Tests Owed

- Terminal injection (adversarial F1): a consumer value holding control characters, such as a `package.json` `workspaces` pattern `"!\u001b[1A\u001b[2KHIDDEN"`, must reach stderr escaped (`\u001b`), never as a raw ESC byte, so a project cannot rewrite the listing the user confirms. Mutation: `oneLine` or `terminalText` in `packages/cli/src/output.ts` returning its input.
- Empty paths (adversarial F3): `--state-dir=` and an empty `root` exit 2 with usage and nothing on stdout, since an empty path would resolve to the current directory and put state into the consumer's tree. Mutation: `nonEmptyPath` in `packages/cli/src/command.ts` returning its input.
- The prompt settles on close: input that ends, Ctrl-C and Ctrl-D at the question each give "not started: not trusted" and never hang. Mutation: drop `closed` from the `Promise.race` in `trust-prompt.ts` `ask`. The dev probe drove `decideTrust` with a `PassThrough` stdin marked `isTTY` and `setRawMode` stubbed, writing `\x03` and `\x04`.
- A startDaemon failure is one `--json` document with `ok: false`, the "not started:" prefix and the plan fields, never an uncaught error.

### Tests Record

Tests session: threadId f382905b-a636-4597-b256-180bd74ab102

#### Named Defects

New, in `packages/cli/test/cli.test.ts`, recorded in `packages/cli/test/defects.json`:

- D1711: A relative root or --state-dir resolves against the process's directory instead of the command's, so the listing names a directory the start does not use. (AC1)
- D1712: With no --state-dir, the state directory is the consumer root itself rather than .rt-test under it. (AC1)
- D1713: With no root argument, the root is the process's directory instead of the command's current directory. (AC1)
- D1714: The listing omits the sentence saying what starting executes beyond the listed configs. (AC1)
- D1715: The listing leaves out the workspace sources it could not read. (AC1)
- D1716: Control characters reach the terminal raw, so a consumer's workspace pattern can move the cursor and rewrite the listing the user confirms. (AC1)
- D1717: A consumer value keeps its line breaks, so a workspace pattern can print a forged line in the listing. (AC1)
- D1718: The answer is not case folded, so YES is read as no. (AC2)
- D1719: The answer is not trimmed, so a y typed with surrounding spaces is read as no. (AC2)
- D1720: Only y is accepted, so yes spelled out is read as no. (AC2)
- D1721: Any typed answer is taken as trust, so an answer other than y or yes starts the daemon. (AC2)
- D1722: The prompt waits only on the question, which never settles when stdin ends, so the start hangs. (AC2)
- D1723: The Ctrl-C listener swallows the signal without closing the prompt, so the start hangs at Ctrl-C. (AC2)
- D1724: The prompt waits only on the question, which Ctrl-D rejects instead of answering, so Ctrl-D fails the start with an error rather than reading as no. (AC2)
- D1725: --trust on a terminal skips the question and starts the daemon. (AC2)
- D1726: A terminal on either stream counts as a terminal, so the question goes to a stderr no one sees. (AC2)
- D1727: Without a terminal, a start is trusted with no --trust. (AC3, AC8)
- D1728: Trust is read back from the state directory an earlier trusted start left, so a later start without --trust is trusted. (AC4)
- D1729: A trusted start's report leaves out the daemon it started. (AC5)
- D1730: The start re-reads the workspaces after the question, so the daemon loads a workspace the user was never shown. (AC5)
- D1731: A start with a daemon already serving lists and asks before the client refuses it. (AC5)
- D1732: An endpoint holder the client cannot confirm is taken as nothing listening, so the start goes on to ask. (AC5)
- D1733: A daemon that cannot start is reported without the not started: prefix or the plan it would have started. (AC5, AC8)
- D1734: A root with no Vitest workspace is listed and asked about instead of refused. (AC6)
- D1735: A stop reports a process other than the daemon that acknowledged the stop. (AC7)
- D1736: A command's rejection escapes as an uncaught error instead of exit 1 with its reason. (AC7, AC8)
- D1737: A parseArgs error is not taken as a usage error, so it escapes instead of exiting 2 with the usage. (AC8)
- D1738: A second positional is accepted and ignored instead of being a usage error. (AC8)
- D1739: An empty path is accepted and resolves to the current directory, so an unset shell variable puts state into the consumer's tree. (AC8)
- D1740: The start command imports the daemon's main entry, so the CLI process loads node:sqlite and the daemon's Vitest code. (AC9)
- D1741: A missing or unknown command exits 2 without printing the usage. (AC8)
- D1742: A --json document leaves out the CLI's schema version. (AC8)
- D1743: A human-mode success is written to stderr instead of stdout. (AC7, AC8)
- D1744: A declined start goes on to start the daemon, which loads the consumer's config. (AC9)

Repaired, stale because `stopDaemon` now resolves `{ pid }` (AC7): D1491, D1493, D1537 and D1571 in `packages/daemon/test/daemon.test.ts`, and D1665 in `packages/daemon/test/job-tree.test.ts`, each now pin the stopped process's id in place of `undefined`. Re-anchored, since the state-directory resolution moved to `start-plan.ts`: D1487 on `client.ts`'s `resolvedStateDirectory` call, D1488 on `start-plan.ts`'s `resolve`.

`bun run test:defects`: exit 0, 1133/1133 detected, about 08:19 to 08:23 on 2026-09-27.

From the review's Test Coverage Gaps:

- D1764: The daemon begins its start sequence without the starter's acceptance, so a starter killed after the serving report leaves a daemon running the project's tests while the command reported nothing. (G1, F2; `packages/daemon/test/daemon.test.ts`, forking `daemon-main` and closing the startup channel, on Windows and Linux alike)
- D1765: Any message after the serving report is taken as the acceptance, so a starter that sends something else still gets a daemon executing. (G2)
- D1766: A stop that arrives between the serving report and the acceptance is followed by the start sequence, so discovery starts after the stop. (G4)
- D1767: startDaemon never sends the acceptance, so every start resolves as started while the daemon it reports runs nothing. (G3)
- D1745: An empty answer is taken as yes, so a reflexive Enter executes the project. (G5, AC2; `packages/cli/test/cli.test.ts`)
- D1768: The start passes the daemon only some of the listed workspaces, so a workspace the user confirmed never runs while the report still names it. (G6, AC5)
- D1769: A human-mode start's success leaves out the daemon's process id. (G7, AC5, AC8)
- D1770: stop resolves an explicit relative root against the process's directory instead of the command's. (G8, AC7)

Re-anchored after the handshake: D1489 now runs the start sequence to idle before the handshake, so serving is reported only once it has ended; D1534's guard line, which `isStartupAcceptance` now repeats, is widened with the next line of `isStartupRequest`.

`bun run test:defects`: exit 0, 1141/1141 detected, about 08:43 to 08:49 on 2026-09-27.

#### Deliberately Untested

- `packages/cli/src/bin.ts`: wiring of `process` streams into `main` with a catch-all; D1740 runs it as a child process, and no further defect is nameable without faking `process`.
- `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/tsconfig.build.json`, `packages/daemon/package.json`: configuration no code branches on; the typecheck and every test resolving `@rt-test/daemon/client` exercise them.
- `packages/cli/src/output.ts` `Output.#report`'s double-report guard: no command path reports twice, so no caller can reach it.

### Review Record

Review session: threadId 3b746d80-9873-431b-88c0-567305590676

**F2 built here (orchestrator 08:05, in this lane).** A start now completes in a handshake over the spawn-time channel. The daemon reports serving, then waits for the client's `begin` (`BEGIN_TYPE`, `StartupAcceptance` in `protocol.ts`), which `startDaemon` sends only after it has proven the daemon's status and matched its pid (`acceptStart` in `client.ts`). The daemon begins its start sequence only on that message, and not when a stop has already arrived. When the channel closes first, or carries anything else, the daemon logs "start abandoned", stops (releasing its endpoint, key, lock and store), and exits 1, having run nothing (`startAccepted` in `daemon-main.ts`). A report-then-begin order alone was not enough: Node's IPC send callback reports success for an asynchronous write whatever its outcome (`internal/child_process` `req.oncomplete`, Node 24.19.0), so it cannot show that the starter read the report. The handshake also closes the pre-existing case of a start that fails after the serving report (status deadline, unproven status, pid mismatch), in which discovery had already begun. Probed on Windows 11, Node 24.19.0, from source: a starter killed with SIGKILL after the serving report left a daemon that exited 56 ms later with "start abandoned", no "discovery started" and no lock file; a dropped channel and a non-`begin` message each did the same. Linux was not probed (WSL runs need the owner's approval).

**The CLI and an interrupt.** `rt-test start` reports nothing when Ctrl-C ends it during `startDaemon`, and exits by the signal. No handler was added: before `begin` is sent the daemon abandons on its own, and a handler could not tell whether `begin` had already gone out, so a "not started" line could be false. The orchestrator agreed at 08:35 (asked by this review at about 08:34): a report that may be false is worse than none.

**Linux and the frozen set.** The orchestrator ruled at 08:35: no separate WSL probe. G1's named test runs on both platforms and proves the abandon path on Linux at the pre-push gate. The handshake is additive and travels over the spawn-time channel only. `BEGIN_TYPE` and `StartupAcceptance` are new, and no frozen constant or endpoint message changed (ADR-0006).

Tech debt, left for triage against the commit:

- `packages/cli/src/commands/start.ts:106-123` `runningDaemonRefusal` repeats the client's private `refuseRunningDaemon` (`packages/daemon/src/client.ts`) with different wording ("a daemon, process N, already serves" against "A daemon, process N, already serves"), and `startDaemon` then probes the endpoint again. One client function returning the refusal reason would serve both.
- `packages/daemon/src/client.ts` `abandon` disconnects and then kills the child at once. On Windows the kill ends the daemon before it can run its own abandon, so its key file stays behind (the lock is recovered by pid). With the handshake, a disconnect alone ends a daemon that is not stuck; the kill could wait for a bound.
- `packages/daemon/src/daemon/daemon-main.ts` `serve`: a throw after `holdStore` succeeded (`new Executor`, `connectionServer`) reaches `main().catch`, which exits without closing the endpoint or removing the key and lock.
- `packages/daemon/src/daemon/lifecycle.ts:86` `stop`: a rejected `#stopSequence` (for example `executor.close()` rejecting) is never handled, and the daemon can end before `closeEndpoint` runs.

Tech-debt triage against 045758a (Step 9; `node scripts/list-open-issues.mjs`: 0 open issues). Rulings by the orchestrator, 09:05:

- The duplicated refusal: 1.4's dev applies it, since 1.4 edits both files. It exports one reason builder from `client.ts`, used by `refuseRunningDaemon` and by `start.ts`, and the tests session re-anchors D1731 then.
- `abandon`'s immediate kill: left as is. It leaves one key file per worktree in a user-only directory, which the next start overwrites and which cannot vouch for an impostor (ADR-0006). Nothing runs, since the daemon executes nothing before `begin`, and the store lock is recovered by pid.
- `serve` after `holdStore`: closed, unreachable. What follows `holdStore` only assigns fields (`DaemonLifecycle`), builds `WindowsJobs` without starting its helper (`treeContainment`), returns an object literal (`connectionServer`), or catches its own errors (`DaemonLog.entry`).
- `#stopSequence` rejecting: closed, unreachable. `#sequence` carries a catch from `begin`. `executor.close()` only resolves, through `#childEnded` and `WindowsJobs.close`. `store.close()` and `closeEndpoint()` are each caught.

#### Test Coverage Gaps

| #   | Source                                                              | Defect                                                                                                                                                                                                                                                                                                                                                                                        | Expected test                                                                                                                                                                                                                                                                                                         | Severity |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| G1  | `packages/daemon/src/daemon/daemon-main.ts` `main`, `startAccepted` | The daemon begins its start sequence without the starter's acceptance, so a starter killed after the serving report (Ctrl-C during `startDaemon`) leaves a daemon running the project's tests while the command reported nothing. Mutation: `if (await startAccepted())` to `if ((await startAccepted()) \|\| true)`.                                                                         | Fork `daemon-main` over a consumer, take the serving report, then close the channel without `begin`: the daemon exits, its log has "start abandoned" and no "discovery started", and its store lock is gone. It must run on Windows and Linux alike: it is the Linux proof of the abandon path (orchestrator, 08:35). | HIGH     |
| G2  | `packages/daemon/src/daemon/daemon-main.ts` `isStartupAcceptance`   | Any message after the serving report is taken as acceptance, so a starter that sends something else still gets a daemon executing. Mutation: return `true`.                                                                                                                                                                                                                                   | As G1, sending `{ type: "not-begin" }` in place of closing the channel.                                                                                                                                                                                                                                               | MEDIUM   |
| G3  | `packages/daemon/src/client.ts` `startedDaemon`                     | `startDaemon` never sends `begin`, so every start resolves as started and the daemon then abandons it and exits. Mutation: delete `await acceptStart(child, report.pid, logFile);`. Existing start tests (D1490, D1491) go red on it; it needs its own named test.                                                                                                                            | A started daemon's status reports an activity other than an abandoned start after the start resolves (for example it reaches `idle` with its runs stored), and its process is still running.                                                                                                                          | MEDIUM   |
| G4  | `packages/daemon/src/daemon/daemon-main.ts` `main`                  | A stop that arrives between the serving report and the acceptance is followed by `begin`, so discovery starts after the stop closed the store and endpoint. Mutation: drop `if (!lifecycle.isStopping())`. Needs a way to hold the daemon between report and acceptance, which a test that forks `daemon-main` and withholds `begin` has: send a proven stop over the endpoint, then `begin`. | The daemon exits with no "discovery started" in its log.                                                                                                                                                                                                                                                              | MEDIUM   |
| G5  | `packages/cli/src/trust-prompt.ts:69`                               | An empty answer (Enter alone) is taken as yes, so a reflexive Enter executes the project. AC2 names "an empty answer" as no; D1721 types "yep", not an empty line. Mutation: `answer !== undefined && (answer.trim() === "" \|\| YES_ANSWERS.has(answer.trim().toLowerCase()))`.                                                                                                              | `decideTrust` on a terminal with Enter alone gives "not started: not trusted".                                                                                                                                                                                                                                        | MEDIUM   |
| G6  | `packages/cli/src/commands/start.ts:86-90`                          | The start passes only some of the listed workspaces to the daemon, and the report still names them all, since `workspaces` comes from the plan. Mutation: `start: { ...plan.start, workspaces: plan.start.workspaces.slice(0, 1) }`. D1729 compares the plan-sourced field and D1730 covers only an added workspace.                                                                          | A trusted start over a consumer with two listed workspaces runs both (each workspace's run is stored, or each marks that its config loaded).                                                                                                                                                                          | MEDIUM   |
| G7  | `packages/cli/src/commands/start.ts:142-151`                        | A human-mode start success goes to stderr, or leaves out the pid or the root. D1743 covers only stop. Mutation: `startedText` omitting `process ${daemon.pid}`.                                                                                                                                                                                                                               | A trusted start without `--json` exits 0 with stdout naming the pid and the root.                                                                                                                                                                                                                                     | LOW      |
| G8  | `packages/cli/src/commands/stop.ts:26`                              | `stop` resolves an explicit relative root against the process's directory. Every stop test passes no root, and D1711 covers only start. Mutation: `absolutePath(io, rootArgument)` to `resolve(rootArgument ?? io.cwd)`.                                                                                                                                                                      | `stop <basename>` run with `cwd` set to the root's parent stops that daemon and names its pid.                                                                                                                                                                                                                        | LOW      |

Broken by this review's fix, for repair: D1489 in `packages/daemon/test/defects.json` mutates `  lifecycle.begin();\n  void report({ type: SERVING_TYPE, pid: process.pid });`, which no longer exists. Its defect (the daemon reports serving only once its start sequence has ended) still holds; the serving report now goes out in `startAccepted`, before `begin`.

Denominator: 34 named-defect tests in `packages/cli/test/cli.test.ts` and the five repaired in `packages/daemon/test/`, against the nine criteria and the F2 guarantee.

### Completion Notes

Built by dev session 1e481bae-d2cc-44b5-af52-4afd06eeaa63, 2026-09-27, alone: the work is one chain (the daemon contract, then the CLI calling it), so no implementer agents.

**Sanity check (Step 4).** Three findings, sent to the author (5aa94df9) at about 07:44; the author replied CONFIRMED to all three and updated the ticket. F1: `ConfirmedStart` and `chosenConfigFile` live in `confirmed-start.ts`, so `config-loader.ts` and `find-workspaces.ts` are untouched and the plan is `start-plan.ts`. F2: `stopDaemon` resolves `{ pid }`. F3: `servingDaemon` tells "nothing listens" from "cannot confirm".

**Assumptions.** U1 FALSE for Git for Windows 2.55 (mintty reports both streams as terminals); U2 settled by settling on `close`. Both are recorded beneath the table.

**What was built.**

- `packages/daemon/src/start-plan.ts`: `startPlan(root, stateDirectory?)` returns the `ConfirmedStart` from `findVitestWorkspaces` plus `chosenConfigFile`, the absolute state directory and the unread sources. A listed workspace whose config file does not resolve (a dangling link) goes to `notRead` rather than into the plan. `resolvedStateDirectory` is the one state-directory rule, which `startDaemon` now imports (C8).
- `client.ts`: re-exports `startPlan`, `StartPlan`, `UnreadWorkspaceSource` and `errorText` (the CLI's reason text, so there is one error formatter, C5), adds `StoppedDaemon` and `servingDaemon`, and `stopDaemon` resolves `{ pid }`. The version-mismatch message now says "It can be stopped, and then started again." in place of naming the `stopDaemon` function, which a CLI user cannot run (adversarial F4).
- `packages/cli`: `command.ts` (the command shape, `CliIo`, usage errors, `absolutePath`, `optionalRoot`, `nonEmptyPath`), `output.ts` (schema version, exit codes, the one-outcome writer, terminal escaping), `trust-prompt.ts`, `main.ts` (the command table), `bin.ts`, `commands/start.ts`, `commands/stop.ts`. `command.ts` is a file the ticket did not list: each command parses its own options so `parseArgs` infers their types, and the shared shape needs a module both `main.ts` and the commands import without a cycle. It was claimed before its first edit.

**Adversarial review (Step 7).** 10 findings; 7 fixed inline, 1 left as a change-request candidate, 2 discarded.

- Fixed: F1 (HIGH) consumer text reached the terminal unescaped; every stderr and human stdout line now escapes control and format characters, and consumer values also escape line breaks. F3 an empty `--state-dir` or `root` resolved to the current directory; now a usage error. F4 the client's `stopDaemon` hint. F5 start's JSON fields varied by outcome; every start outcome now carries the plan fields, and a `startDaemon` rejection is reported with the "not started:" prefix. F7 `bin.ts` now catches anything unexpected. F8 the AbortError branch could not fire, since Node closes the interface (settling the race) before it rejects the question on Ctrl-C or Ctrl-D; removed. F9 the `listing` docblock over-claimed. F10 the envelope keys now come after the fields, a `NOT_STARTED` constant names the prefix, and the `--trust` note goes through `Output`.
- Discarded F6 (type-ahead "y" buffered before the question): the keystroke is the user's own, and F1's escaping closes the injected-reply route.
- Candidate F2, below.

**Validation (all after the review fixes, about 08:10).** `bun run --filter rt-test typecheck` exit 0; `bun run --filter @rt-test/daemon typecheck` exit 0; `bun x oxlint packages/cli/src packages/daemon/src/client.ts packages/daemon/src/start-plan.ts` exit 0 with no warning; `node scripts/check-line-citations.mjs` clean. Builds of core, daemon and cli exit 0. No test was run (create-tests owns them).

**Acceptance evidence.** Run against the built `packages/cli/dist/bin.js` with stdin from `/dev/null` (no terminal):

- AC1, AC3: `start ws --state-dir custom-state --json` from a temp copy of `test/fixtures/daemon/workspaces` listed the root, `<cwd>/custom-state`, the four workspaces with their config files, the executes sentence (naming `test.projects`) and five unread-source warnings, then exited 1 with the no-terminal reason naming the root and `--trust`; stdout held one document with the same data. Neither state directory was created.
- AC2: `decideTrust` driven with a simulated terminal: `y` (with `--trust`, which printed the note first) and ` YES` trusted; `n`, empty, ended input, Ctrl-C and Ctrl-D each gave "not started: not trusted", none hung.
- AC6: an empty temp directory exited 1 with "not started: no Vitest workspace was found under <root>" and one `ok: false` document.
- AC8: no command, an unknown command, `--bogus`, an extra positional, `--state-dir` with no value, `--trust=yes`, `stop --trust`, `stop --state-dir x`, `--state-dir=` and an empty root each exited 2 with the usage on stderr and empty stdout.
- AC9: the refusal run above, preloaded with `test/fixtures/daemon/list-modules.mjs`, resolved 36 modules and none under `node_modules/vitest`, no `node:sqlite` and no consumer file. Every import in the CLI graph is static, so a start that proceeds loads no further module in the CLI process; `startDaemon`, the only spawn, is reached only after trust.
- AC4, AC5, AC7 (serving halves) need a real daemon and are under `#### ACs Owed a Test`.

**Change-request candidates.**

- Adversarial F2 (MEDIUM, consumer, reach unknown): after the user confirms, Ctrl-C while `startDaemon` waits for the daemon's report ends the CLI with no report, and the detached daemon, already sent its confirmed start, carries on. The user did trust the start, so nothing untrusted runs, but the invocation reports nothing and a daemon keeps running. Fix: have the daemon abandon a start whose startup channel disconnects before it reports serving, in `packages/daemon/src/daemon/daemon-main.ts` (1.3's lifecycle, outside this ticket's files), or trap the signal in `runStart` and stop the daemon once it answers. Recommendation: the daemon-side fix, since it covers every client.

**README.** `README.md` and `docs/architecture.md` are the orchestrator's; the exact text went with the report.

### File List

Created:

- `packages/daemon/src/start-plan.ts`
- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/tsconfig.build.json`
- `packages/cli/vitest.config.ts` (tests session)
- `packages/cli/src/command.ts`
- `packages/cli/src/output.ts`
- `packages/cli/src/trust-prompt.ts`
- `packages/cli/src/main.ts`
- `packages/cli/src/bin.ts`
- `packages/cli/src/commands/start.ts`
- `packages/cli/src/commands/stop.ts`

Modified:

- `packages/daemon/src/client.ts`
- `packages/daemon/package.json`
- `packages/daemon/src/daemon/daemon-main.ts` (review, F2)
- `packages/daemon/src/daemon/protocol.ts` (review, F2)
- `_agent-docs/tickets/1-3c-start-stop-cli.md` (this record)
- `bun.lock` (written by the orchestrator's `bun install`)

Planning files the create-ticket run wrote:

- `_agent-docs/tickets/1-3c-start-stop-cli.md` (created)
- Held for the orchestrator, as exact text: `_agent-docs/sprint-status.yaml` (1.3c to `ready-for-dev`), and the sprint file's 1.3c section (the ticket-file link). `README.md` and `docs/architecture.md` text follows from dev-ticket's Support task. `docs/requirements.md` needs no change, since FR4's marker already names 1.3c.

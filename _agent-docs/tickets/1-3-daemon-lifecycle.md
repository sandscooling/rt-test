# Ticket 1.3: Daemon lifecycle and local protocol

## Ticket

As a user or coding agent who has chosen to trust one consumer worktree (the choice itself is ticket 1.3c's CLI),
I want `@rt-test/daemon` to start one background daemon for that worktree that discovers, runs and stores its tests, serves a versioned local protocol only to me, and stops cleanly on request,
so that test execution runs in one place, never before an explicit start, and every later query (1.3c, 1.4) has a live daemon and a filled store to ask.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: No project code executes except after `startDaemon` is called for that consumer's root. Importing `@rt-test/daemon` or its client entry point, calling `daemonStatus` or `stopDaemon`, and a `startDaemon` that is refused (AC7, AC9) load no Vitest config, run no `globalSetup` and import no test file.
- [ ] AC2: `startDaemon` for a consumer root starts a daemon process for that worktree that outlives the process that called it, and resolves once the daemon answers on its endpoint, before discovery has finished. It resolves with the daemon's process id, the worktree identity, the project identity, the state directory, and the protocol version. The state directory is the one the caller gives, else `.rt-test` under the consumer root.
- [ ] AC3: Once started, the daemon discovers the consumer's Vitest workspaces confirmed at start (AC11) and stores that discovery. It then runs each confirmed workspace the discovery lists once, in the order discovery lists them, and stores each run as it ends, whatever its status. Every stored record is bound to the worktree's project and worktree identities and stored as not fingerprinted. After the last run the daemon stays idle and keeps serving until it is stopped.
- [ ] AC4: A status request answers with the daemon's process id, worktree identity, project identity, state directory and protocol version, and its activity: discovering, running (naming the workspace), or idle. It also lists each job since the start that ended with nothing stored (a killed or crashed executor, a failed store write), naming the workspace or the discovery and the reason. The daemon answers status and stop requests within a named bound longer than the store's busy timeout while a discovery or a run holds Vitest open, including when a test is stuck in a synchronous loop.
- [ ] AC5: `stopDaemon` for a consumer root resolves only after that worktree's daemon process has exited and its endpoint accepts no connection. A run in progress when the stop arrives is interrupted, and stored when it ends within the executor bound. A discovery in progress stores nothing. Workspaces not yet run are neither run nor stored. When the job in progress has not ended within the named executor bound, the daemon ends the process hosting Vitest, stores nothing for that job, and still exits. With no daemon serving that worktree, `stopDaemon` fails with a reason naming the consumer root.
- [ ] AC6: On Linux, a `SIGTERM` or `SIGINT` sent to the daemon process stops it as `stopDaemon` does (AC5), including while a discovery or a run holds Vitest open. When the process hosting Vitest exits during a job without a stop, the daemon logs the exit, stores nothing for that job, and goes on with the next workspace while it keeps serving. When the daemon process ends without a stop, the process hosting Vitest ends within the executor bound unless it is stuck in synchronous code.
- [ ] AC7: While a daemon serves a worktree, a second `startDaemon` for that worktree is refused with a reason naming the running daemon's process id, and starts nothing. A `startDaemon` after that worktree's daemon was killed without a stop, which on Linux leaves its socket file behind, starts a daemon. The daemons of two worktrees of one project serve at the same time on one shared state directory, and each stores and reads back only its own worktree's runs.
- [ ] AC8: Every protocol message is one line of JSON. Each carries the protocol version, apart from the version-independent stop and its acknowledgement (AC12). A connection's first request is a hello, or the version-independent stop (AC12). A hello carrying another protocol version gets an error naming both versions and the daemon's process id; the daemon then accepts only that stop on the connection, and closes it on anything else. A line that is not valid JSON, an unknown request, a request other than that stop before the hello, and a line longer than a named limit each get an error response naming the problem, and the daemon keeps serving that client and every other one.
- [ ] AC9: Apart from the operating system's administrators (`SYSTEM` and Administrators on Windows, root on Linux), only the user who started the daemon can send it a request, and nobody else receives anything from it: another user can at most open the Windows pipe read-only, and the daemon writes only in answer to a request on the same connection. On Windows the endpoint is a named pipe, and on Linux a Unix socket in a directory only that user can enter: `$XDG_RUNTIME_DIR` when set, else `rt-test-<uid>` under the system temporary directory. Each endpoint's name is derived from the worktree identity. When the Linux socket path would be longer than the platform's limit, `startDaemon` is refused with a reason naming the path and the limit, and nothing listens on a shortened path.
- [ ] AC10: The daemon writes a log for its worktree inside the state directory. The log records the start (consumer root, state directory, process id, protocol version), the start and end of each discovery and run with its status, each error, and the stop. The daemon's own stdout and stderr, Node's warnings included, go to that log. Every file the daemon process writes lies inside the state directory, apart from the Linux socket, its lock file and their runtime directory, and the daemon opens no network connection. What Vitest writes in the executor child is ticket 1.3b's.
- [ ] AC11: `startDaemon` takes the confirmed start: the consumer root, and each workspace the user was shown, with the config file shown for it. The daemon loads, discovers and runs only a workspace whose path and chosen config file both match a confirmed entry. Any other workspace it finds is never loaded and never run. That covers a workspace added after the prompt, and one whose chosen config file is no longer the one shown. The stored discovery lists each such workspace as not discovered, with the reason "not confirmed at start", distinct from unsupported, failed and every other state, and never leaves it out. A confirmed workspace the daemon no longer finds loads nothing, and the log names it.
- [ ] AC12: A client of any protocol version can stop a daemon of any other, and can name it. A version-independent stop request stops the daemon exactly as `stopDaemon` does (AC5), whether a connection sends it as its first line or after its hello was refused for another version. So does `stopDaemon`, whatever version the daemon speaks. A `startDaemon` that finds a daemon of another protocol version serving the worktree is refused with a reason naming that daemon's process id and protocol version, and saying it can be stopped. This holds for every protocol version from this ticket's first on: no later version may change the stop request, its acknowledgement, the version-mismatch error's fields, or the line framing.

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                                                                                                                                                                 | Why it matters if wrong                                                                                                                  | How to check                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Does `child_process.fork` with the default JSON serialization carry a `WorkspaceRun` and a `TestDiscovery` from the executor to the daemon unchanged? Their fields are strings, numbers, booleans, arrays and optional members, with no `undefined` values present, `Map` or `Date`, by their declarations in `run-workspace.ts`, `run-states.ts` and `discover-tests.ts`. | A field lost or changed in transit is stored changed, breaking 1.2's read-back guarantee for records the daemon stores.                  | Round-trip one record of each status from the existing daemon fixtures through a forked child and compare with `deepStrictEqual`.                                           |
| U2  | Does a child spawned with `detached: true`, stdio `["ignore", <log fd>, <log fd>, "ipc"]` and `windowsHide`, then `unref()`ed, keep running after it calls `process.disconnect()` and its starter exits, on Windows and Linux? The spike (Dev Notes § Spike facts, Detached daemon) showed it without the IPC channel only.                                                | If the channel ties the daemon to its starter, the daemon dies with 1.3c's CLI process (AC2), or the startup report needs another route. | Extend `detach/probe.mjs`'s shape: add `"ipc"`, have the child send one message and disconnect, exit the starter, and check the child is alive 3 s later on both platforms. |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing.
- [ ] (AC8, AC12) Create the protocol module (for example `packages/daemon/src/daemon/protocol.ts`): the protocol version constant, the line-length limit constant, the request and response shapes (hello, status, stop, error), and a line decoder that splits on `\n` across chunk boundaries and reports a line past the limit without buffering the rest of it. Frame by line (ADR-0001). Keep the frozen part (Dev Notes § Design notes, Frozen for every version) apart from the versioned shapes, in constants and types marked as never to change: the stop request, its acknowledgement, and the version-mismatch error's fields.
- [ ] (AC9, AC7) Create the endpoint module (for example `packages/daemon/src/daemon/endpoint.ts`): the endpoint for a worktree identity, as `\\.\pipe\rt-test-<hash>` on Windows and `<runtime dir>/<hash>.sock` on Linux. On Windows the pipe namespace is machine-wide, so include the user name in the hashed input. On Linux, create the runtime directory with mode `0700` when missing, and refuse a directory another user owns or others can enter. Read `XDG_RUNTIME_DIR` in this module only (C6). Refuse a socket path whose UTF-8 encoding is longer than 108 bytes, a named constant (Q5, § Spike facts), before `listen`. Hold an exclusive lock file in the runtime directory (created with the `wx` flag, holding the process id) across the stale check, the unlink and the `listen`, and remove it once listening. Treat a lock whose process id is no longer running as stale, so two starts racing after a kill cannot each unlink the other's live socket (AC7). On `EADDRINUSE`, connect to the endpoint: when a daemon answers, report it; when the connection is refused (Linux, stale file), unlink the socket file and listen once more.
- [ ] (AC4, AC5, AC8, AC12) Create the server (for example `packages/daemon/src/daemon/server.ts`): accept connections on the endpoint, write nothing to a connection until it has sent a line (no greeting or banner, Dev Notes § Design notes), require the hello first except for the frozen stop, answer status and stop, and answer every bad line with an error response while the connection stays open. The exception is a hello carrying another protocol version: it gets the frozen version-mismatch error (both versions and the daemon's process id), after which the connection accepts only the frozen stop and is closed on any other line (AC8, AC12). Accept the frozen stop at any point on any connection, before or after a hello, and answer it with the frozen acknowledgement before stopping (AC12). A `node:net` server on the endpoint path, as the spike's probe did.
- [ ] (AC11, AC3) Bind discovery to the confirmed start, in `packages/daemon/src/vitest/discover-tests.ts` as ticket 1.3b leaves it. `discoverTests` takes the confirmed start in place of the bare consumer root, keeping 1.3b's abort signal. It lists the workspaces with `findVitestWorkspaces`, chooses each one's config file as 1.3b's `config-loader.ts` does, and loads only a workspace whose path and chosen config file match a confirmed entry. Every other workspace becomes a `WorkspaceDiscovery` of a new status of its own (for example `not-confirmed`), carrying the reason "not confirmed at start" as a named constant (C3). The filter sits inside discovery (P18), so no caller can load an unconfirmed workspace. Declare the confirmed-start type beside it, with each workspace's path as `VitestWorkspace.path` spells it and its config file root-relative and `/`-separated (P13), so ticket 1.3c's start plan builds it from the same functions. Add the new status to 1.2's `write-discovery.ts` and `read-discovery.ts`. The `status` column is unconstrained text, so no schema change is needed, and a reader that finds an unknown status already refuses it. Raise `VITEST_ADAPTER_VERSION` in `adapter-version.ts`, since what a stored discovery can say changes (C124).
- [ ] (AC3, AC5, AC6) Create the executor host (for example `packages/daemon/src/daemon/executor.ts`) and its child entry (for example `packages/daemon/src/daemon/executor-main.ts`). The daemon forks one child that runs `discoverTests` and `runWorkspace` one job at a time and sends each result back. It forwards a stop as an abort of the job in progress. When the job has not ended within the executor bound, it kills the child, and it reports a child that exits during a job as that job's failure, logs the exit, and forks a new child for the next job (AC6). When its channel to the daemon closes, the child aborts its job and exits once the job ends or the executor bound passes, whichever comes first (AC6).
- [ ] (AC2, AC3, AC4, AC5, AC6, AC10) Create the daemon entry (for example `packages/daemon/src/daemon/daemon-main.ts`) and its lifecycle (for example `packages/daemon/src/daemon/lifecycle.ts`). Take the consumer root and state directory from its arguments, compute identities with 1.2's `consumerIdentity`, take the endpoint (refusing on AC7 or AC9), open the log and 1.2's store, start serving, and send `startDaemon` its startup report over the spawn-time channel (serving, or the refusal and its reason), then disconnect that channel (U2). Take the confirmed start (AC11) over that same channel before reporting, not from the arguments, since it can outgrow a Windows command line. Then run the start sequence of AC3 through the executor: discovery with the confirmed start, then a run for each workspace the discovery lists under a status other than the not-confirmed one. Log each confirmed workspace the discovery did not find (AC11). Write each record with 1.2's `writeDiscovery` and `writeRun` and `NOT_FINGERPRINTED`, and track the activity status reports and each job that ended with nothing stored, with its reason (AC4). Log and go on after a failed store write (C30). On stop, or on Linux `SIGTERM` and `SIGINT`: stop taking requests other than hello and status, answer a stop request with an acknowledgement that the stop has begun (never that it has completed, C31), abort the job in progress, skip the workspaces not yet run, wait for the executor within its bound, store the run in progress when it ended within the bound whatever its status, store nothing for a discovery, close the store, close the server, and exit.
- [ ] (AC10) Create the daemon log (for example `packages/daemon/src/daemon/daemon-log.ts`): one append-only file per worktree inside the state directory, named from the worktree identity hash, since worktrees may share a state directory. `startDaemon` opens it for the child's stdout and stderr. The daemon writes to it the entries AC10 lists: the start (consumer root, state directory, process id, protocol version), the start and end of each discovery and run with its status, each error (through `errorText`), an executor child's exit during a job (AC6), each job that ended with nothing stored (AC4), and the stop.
- [ ] (AC1, AC2, AC4, AC5, AC7, AC9, AC11, AC12) Create the client entry (for example `packages/daemon/src/client.ts`): `startDaemon`, `daemonStatus` and `stopDaemon` for a consumer root. `startDaemon` resolves the state directory to an absolute path (a relative one against the caller's working directory) and creates it before opening the log, so the detached daemon and every other worktree see the same directory. Before spawning, it refuses a worktree whose endpoint already answers, naming the process id from that daemon's status (AC7), or, when that daemon refuses the hello for another protocol version, the process id and version from the frozen mismatch error, and saying it can be stopped (AC12), and a socket path over the limit (AC9). It then spawns the daemon entry detached with an argument array (P15), its stdout and stderr going to the log and one IPC channel open for startup only. The daemon reports over that channel that it is serving, or its refusal with its reason (the endpoint taken in a race, a store `openStore` refuses), then disconnects it. `startDaemon` resolves after that report and a hello and status answer, and otherwise rejects with the reported reason or, when the daemon exits first, its exit code and a pointer to the log. The options type requires the caller to state that the project is trusted, and it carries the confirmed start (AC11), which `startDaemon` sends over the startup channel. So no caller starts a daemon without stating trust and naming what it confirmed; ticket 1.3c's prompt is the only production caller that does. `stopDaemon` sends the frozen stop as its connection's first line, with no hello, so it stops a daemon of any protocol version (AC12). It resolves after the endpoint stops accepting connections and the process id is gone. `stopDaemon` and `daemonStatus` reject with a reason naming the consumer root when no daemon answers on that worktree's endpoint (AC4, AC5, C153). The client's module graph loads neither `node:sqlite` nor Vitest, nor any consumer config or test module, at run time, so the CLI (1.3c, 1.4) loads none of them (orchestrator, 16:24). The client may import modules under `src/store/` and `src/vitest/` that meet this. 1.2's `consumer-identity.ts` imports only `node:fs`, `node:path` and a type. `find-workspaces.ts` imports only `node:fs`, `node:path` and `error-text.ts`, which imports nothing. Ticket 1.3c's start plan reuses it and 1.3b's config-file choice.
- [ ] (Support) Export the client from a `./client` subpath in `packages/daemon/package.json` `exports`, beside `.`, and export the protocol types the CLI needs from it.
- [ ] (Support) Send the orchestrator the `docs/architecture.md` § Current implementation and § Components text for the daemon process, the executor child and the endpoint (P21, C48), and the README Status sentence.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- 1.2's store (`packages/daemon/src/store/`, landing from worktree wt-1): `consumerIdentity(consumerRoot)` for the project and worktree identities, `defaultStateDirectory(consumerRoot)` for `.rt-test`, `openStore(stateDirectory)`, `writeDiscovery`, `writeRun`, and `NOT_FINGERPRINTED` from `schema.ts`. These are the names on wt-1 at 13:45 and may change in 1.2's review: use what lands, never a second identity or state-directory rule.
- `packages/daemon/src/vitest/discover-tests.ts` `discoverTests(consumerRoot)` and `TestDiscovery`; `packages/daemon/src/vitest/run-workspace.ts` `runWorkspace(workspace, signal)` and `WorkspaceRun`; `packages/daemon/src/vitest/find-workspaces.ts` `findVitestWorkspaces` and `VitestWorkspace`. The executor child calls these, and they already share one queue.
- For AC11: `findVitestWorkspaces` and `VitestWorkspace.path` for each workspace's path, and ticket 1.3b's `packages/daemon/src/vitest/config-loader.ts` choice of the config file Vitest would load, in Vitest's order. Match against these; never a second workspace or config-file rule (C8).
- `packages/daemon/src/vitest/error-text.ts` `errorText` for every error the log or an error response carries.
- For create-tests: `packages/daemon/test/harness.ts` `inTempDir`, `copyFixture` and `linkVitest`, and the `test/fixtures/daemon/run-interrupt` fixture, whose run can be held open at an exact point: mid-run, at its `running:<test>` event, which the fixture reports from the running test's annotation; a promise the hook returns for it holds that test running until the promise settles, so settle it in a `finally`, and never await `cancelCurrentRun` inside the hook.

### Must Create

- The daemon process, executor, endpoint, protocol, server, log and client modules the tasks name. `rg -n "node:net|createServer|child_process|fork\(|spawn\(" packages` finds nothing: the daemon package opens no socket and spawns no process today.
- The `./client` subpath export: `packages/daemon/package.json` exports only `.`.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Tickets 1.1 and 1.1b built discovery and runs in `packages/daemon`, and 1.2 (in progress in worktree wt-1) stores their records. Nothing calls any of them yet. This ticket builds the daemon process that does. Ticket 1.3 was split three ways on 2026-09-26 (§ Grill record, Q1): this ticket is the daemon process and its local protocol. **1.3b** (run safety) makes daemon runs and discoveries leave the consumer's tree unchanged, apart from five documented exceptions under `node_modules` (1.3b § Known limits), and force-stops Vitest after a grace period. **1.3c** (the CLI) adds `rt-test start` with the trust prompt, `--state-dir`, `rt-test stop`, and versioned `--json` output.

Requirements this ticket delivers (`docs/requirements.md`):

- FR4: "Start and stop the daemon explicitly for one trusted project, and execute no project code before that start." (AC1, AC2, AC5, AC6, AC7; the trust prompt is 1.3c's)
- NFR4: "Keep state, logs, and results on the machine under the configured state directory, and send nothing off it." (AC9, AC10)

Clauses the criteria rest on:

- ADR-0001: "Frame the CLI-to-daemon protocol by line or by length, never by end of stream, and version it, so a client in another language can replace the CLI without daemon changes." (AC8)
- ADR-0002: "The daemon is the sole executor of tests and falsification for a started project." (AC1, AC3)
- C140: "No code path runs a project's tests, loads its Vitest config or imports its files unless that project was explicitly started and trusted. Before that start, discovery reads files without executing them." (AC1)
- C148: "A daemon endpoint binds to loopback or a local socket, serves only the explicitly started project, and requires authentication when it speaks HTTP." (AC9) The protocol is not HTTP.
- P41: "Write runtime state and logs only under the configured local state directory, `.rt-test/` by default, never elsewhere in the consumer's tree." (AC10)
- C31: "A success event, log line or message is emitted only after the operation completed, never before." (AC2 resolves after the endpoint answers; AC5 after the process exits)
- C153: "A CLI command that could not answer exits non-zero with a reason; it never prints an empty success-shaped result." (AC5's no-daemon case, which 1.3c turns into an exit code)
- The sprint file's 1.3 section: "While a discovery holds a Vitest instance open, Vitest's logger holds `SIGINT`, `SIGTERM`, `exit` and `unhandledRejection` handlers that exit the process, and discovery rewrites the host's `process.env` until it restores it; the start runs discovery where neither reaches other daemon work." (AC4, AC6) And: "A run aborted while it waits in the session queue resolves only when the job ahead of it finishes, so shutdown does not await it alone." (AC5)
- Glossary: **Daemon** "The local process that alone executes a started consumer's tests and answers queries about them." **Project** and **Worktree** as ticket 1.2 defines them. **Run**, **Interrupted run**.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 1.3` over `workspace-session.ts`, `packages/daemon/src/index.ts`, `packages/daemon/package.json`, `packages/daemon/src/store`, `package.json`, `README.md`, `docs/architecture.md` and `bun.lock` named ticket 1.2 (in progress) and 1.4 (backlog, the store folder).

- **1.2** (in progress, wt-1) writes `packages/daemon/src/index.ts` and creates `packages/daemon/src/store/`. This ticket calls the store and writes `package.json`, leaving `index.ts` as 1.2 lands it (the client goes out through `./client`, and the daemon entry is spawned by path), so dev-ticket starts after 1.2 lands (orchestrator, Q1). It never edits 1.2's files. 1.2's Dev Notes route "chooses the configured state directory (and how a user configures it)" to 1.3: under the split, this ticket takes the state directory as a `startDaemon` option and 1.3c owns the `--state-dir` flag.
- **1.3b** (backlog, after 1.2 and before this ticket, R1) changes `runWorkspace` and `discoverTests` in `packages/daemon/src/vitest/`. This ticket's AC11 then writes three files in 1.3b's set: `discover-tests.ts` (the confirmed-start filter and the new status), `adapter-version.ts` (the raised version), and a read of `config-loader.ts`. Since 1.3b is done before this ticket's dev starts (R1), that is sequential work, not a collision. 1.3b forces coverage off, snapshot update `none` and the results cache off, gives discovery an abort signal, and force-stops Vitest 10 s after an interrupt, recording the force-stop on the run. Since 1.3b lands first, this ticket's stop aborts the job and 1.3b ends it inside the grace period: an interrupted run is stored and a discovery stores nothing. The executor bound (AC5) remains for what 1.3b cannot reach, a synchronous loop in `globalSetup`. It is derived from 1.3b's grace constant (C3, C8), and this ticket imports that constant rather than restating 10 s. The daemon's first runs already leave the consumer's tree unchanged, apart from 1.3b's five documented `node_modules` exceptions (owner rulings 16:00, 16:05 and 18:11, 1.3b § Known limits). This ticket's own spike saw the three overrides write nothing with Vitest's `api` off. 1.3b found that a run and a collect still leave an empty `node_modules/.vite-temp/` from Vite's bundle config loader. 1.3b loads ESM root configs through Vite's runner loader to avoid that, and records the cases it cannot avoid.
- **1.3c** (backlog, after 1.3) creates `packages/cli` and is the production caller of `startDaemon`, `daemonStatus` and `stopDaemon`. Until then they have none, as 1.1's, 1.1b's and 1.2's exports had none (C59).
- **1.4** (backlog) answers `summary` and `status <path>` from 1.2's store, finding the state directory through this ticket's status response or 1.3c's option.
- **2.1 and 2.3** (Sprint 2) add the watcher, fingerprints and the scheduler. This ticket's fixed start sequence (discover, then run each workspace once) is Sprint 1's only runs, and 2.3 replaces it with selections.

#### Owner rulings and grill record

The questions went to the orchestrator (crew.md § Questions) at about 13:40 on 2026-09-26. Its answers came back at 13:45:

- Q1 Sizing, decided by the orchestrator at 13:45. The ticket was about 36 raw files (47 estimated) and 13 code units, over the 20-file limit, so it was split three ways: 1.3 `1-3-daemon-lifecycle` (this ticket), 1.3b `1-3b-run-safety`, and 1.3c `1-3c-start-stop-cli`. Order: 1.3b and 1.3 after 1.2 lands, and 1.3c after 1.3. R1 (13:55, below) then placed 1.3b before 1.3.
- Q2 Trust, owner ruling at 13:44. Trust is never persisted. On a TTY, start names the root and every Vitest config it will load, says what will execute, and asks y/N every time. Without a TTY it refuses unless `--trust` is passed. Trust is never read from the consumer tree. This is 1.3c's; here the options type makes a caller state it (task).
- Q3 What start does, owner ruling at 13:44. Discover every workspace and store the discovery, then run each workspace once and store each run, then idle and serve until stop (AC3).
- Q4 Process model, owner ruling at 13:44. Start spawns a detached daemon and returns once it serves the endpoint, without waiting for discovery. Stop returns once the daemon has exited. SIGTERM or SIGINT act as stop. Stop with no daemon exits non-zero with a reason (AC2, AC5, AC6). AC6 limits signals to Linux, since Windows cannot deliver them (§ Spike facts). That limit was reported to the orchestrator.
- Q5 Transport, owner ruling at 13:44. A named pipe on Windows. On Linux, a Unix socket in a user-only (0700) runtime directory: `$XDG_RUNTIME_DIR`, else `<tmpdir>/rt-test-<uid>`. Each is named by a hash of the worktree identity and relies on OS per-user permissions. The pipe's DACL was to be verified, with a per-start secret in the hello as the fallback if it did not block another user or a remote client. A start that finds a stale Linux socket it cannot connect to unlinks it. The 108-byte path limit is checked and refused (AC7, AC9).
- Q6 State directory, decided by the orchestrator at 13:45. `--state-dir <path>` on start (1.3c), defaulting to `<root>/.rt-test`, with no environment variable or config file in M1. The protocol's status reports the state directory (AC2, AC4).
- Q7 Force-stop record, decided by the orchestrator at 13:45: a field on the run, in 1.3b, including the store change.
- Q8 Write check, decided by the orchestrator at 13:45: 1.3b proves it with a named-defect test over a consumer fixture on both Vitest versions, plus a docs sentence. It is not a runtime check.
- Q9 Grace period, decided by the orchestrator at 13:45: a fixed named constant of 10 s, in 1.3b.
- Q5 follow-up, the secret, decided by the orchestrator at 13:48, applying the owner's 13:44 ruling: no secret. The DACL (§ Spike facts) gives every other principal read-only access, so none can send a request. The daemon never writes to a connection that has sent it nothing, so the ruling's aim, that only the user who started the daemon can use it, is met (AC9). The orchestrator asked that the no-unprompted-write property be stated as the one AC9 rests on (§ Design notes).
- Isolation, confirmed by the orchestrator at 13:45: the executor child process is the mechanism for the sprint text's outcome (AC4, AC6).

The grill ran through the orchestrator: every question above that would change shipped behavior went to it (crew.md § Questions, updated 13:37). Settled by create, not asked: the executor bound (AC5) is this ticket's, since the executor is, derived from 1.3b's grace constant plus a named 5 s margin (the force-stop itself took about 10 ms in the spike), since 1.3b lands first (R1). The line limit (AC8) is a named constant of 1 MiB, far above any request 1.3 to 1.4 define. A failed store write is logged as an error, and the start sequence goes on with the next workspace (C30).

Ticket review (create-ticket Step 6c, 13:52), 23 findings. Applied:

- The stop sequence and the executor-child restart.
- The no-daemon rejections.
- The log entries.
- AC9's administrators caveat.
- AC10 scoped to the daemon process.
- The named 108-byte limit and the lock file against racing starts.
- The startup report channel (U2).
- AC4's bound, derived from the store's busy timeout, and its list of jobs that ended with nothing stored.
- `index.ts` and `docs/architecture.md` dropped from the file lists.

Rejected: lowering `sizing_ac_count` to 10, since it counts code units, which are the criteria plus one for validation. Two review questions went to the orchestrator, which decided them at 13:55:

- R1 Order. 1.3b lands before 1.3, and the order is 1.2, then 1.3b, then 1.3, then 1.3c. The orchestrator's reason: the guarantee must hold from the daemon's first run, and nothing is released, so the order costs nothing. AC10 stays scoped to the daemon process.
- R2 Pipe squatting on Windows, accepted as a known M1 limit. Another local Windows user can create this worktree's pipe name first. That user can then deny a start or a stop, and can fake the process id a stop waits on. There is no data exposure, no test runs, and no store access. Node exposes no way to check the pipe server's owner. Revisit when a multi-user Windows host becomes a supported setup. This is consistent with the owner's 13:44 transport ruling and the 13:48 no-secret decision.
- The orchestrator confirmed the no-write property's wording at 13:55: "writes nothing to a connection until that connection has sent a line" keeps AC8's error responses. The Windows pipe name hashes the user name with the worktree identity, because the pipe namespace is shared by every user of the machine. The log is one file per worktree, because worktrees may share a state directory (1.2 AC6).

Amendment from ticket 1.3c's authoring, decided by the orchestrator at 16:24 on 2026-09-26, applying the owner's 13:44 trust ruling:

- A1, bind the daemon to the workspaces the user confirmed. 1.3c's prompt shows the root and each workspace's config file, and the daemon's own discovery follows about a second later. Without a binding, a workspace added in that gap would execute without ever having been shown. So `startDaemon` takes the confirmed start. The daemon loads, discovers and runs only confirmed workspaces, and records every other one as not discovered with the reason "not confirmed at start", never silently skipped (AC11). The orchestrator left the mechanism to create. Create put the filter inside `discoverTests` (P18), matched on workspace path plus chosen config file, carried the confirmed start over the startup channel, stored the new status through 1.2's discovery writer and reader with no schema change, and raised the adapter version.
- A1's size, cleared by the orchestrator at 16:27 with no split. The ticket stands at about 19 raw files, 25 estimated, and 12 code units, over the 20-file limit. It divides into three disjoint groups: the discovery filter with its store status, the daemon process, and the client. That is the basis 1.3b was cleared on.
- A3, stop across protocol versions, from ticket 1.4's review, decided by the orchestrator at 18:09. Under AC8 as first written, a hello of another version was refused and its connection closed. So after a breaking bump, a daemon started by the previous build would refuse the new client's stop, and start would refuse while that daemon answered. The only way out would be killing the process by hand, and Windows has no deliverable `SIGTERM`. The orchestrator ruled that a stop must work across versions (AC12) and left the mechanism to create. Create froze four things for good (§ Design notes, Frozen for every version): the line framing, a stop request any connection may send without a hello, its acknowledgement, and the version-mismatch error's fields, which carry the daemon's process id. A mismatched hello's connection stays open for that stop. No file is added, and code units go from 12 to 13.
- A2, restate the client's import rule as an outcome: "The client's module graph loads neither `node:sqlite` nor Vitest, nor any consumer config or test module, at run time." A rule naming `src/vitest/` would break when 1.3c's start plan reuses `find-workspaces.ts` and 1.3b's config-file choice.

#### Spike facts

Observed 2026-09-26 by probes under `_agent-docs/.scratch/create-ticket/` (`ipc/probe.mjs`, `ipc/remote.mjs`, `ipc/hold.mjs`, `stuck/probe.mjs`, `stuck/collect.mjs`, `writes/probe.mjs`, `detach/probe.mjs`), run on Windows 11 with Node 24.19.0 and in WSL with Node 24.19.0 and 22.23.3, over Vitest 5.0.1 and 4.1.11. The probes were removed when this ticket was finalized.

- **Line framing.** Three JSON lines, one split across two writes 50 ms apart, round-tripped over a named pipe (`\\.\pipe\rt-test-probe-a`) and a Unix socket (`/tmp/rtipc/a.sock`) on all three Nodes.
- **One listener per name.** A second `listen` on a name already held gave `EADDRINUSE` on both platforms, whether it came from the same process or another.
- **After a kill.** After `SIGKILL` of the listener, on Windows `connect` gave `ENOENT` and a new `listen` succeeded. On Linux the socket file remained: `connect` gave `ECONNREFUSED` and `listen` gave `EADDRINUSE` until the file was unlinked, after which `listen` succeeded. A clean `close()` removed the Linux file.
- **Linux path limit.** A 108-byte socket path listened and connected on both Nodes. At 120 bytes, Node 24.19.0 refused with `EINVAL`. Node 22.23.3 listened and connected on the path truncated to 108 bytes, so two long paths sharing a 108-byte prefix would reach one socket. Refuse before `listen` (AC9).
- **Not on drvfs.** `listen` on a socket under `/mnt/c/...` in WSL failed with `ENOTSUP`, so the socket cannot live in a state directory on a Windows drive. That is one reason it sits in the runtime directory.
- **Socket mode.** Under umask `022`, the socket file was mode `755`. Another user needs write permission on a socket to connect, and the `0700` directory keeps others out of it anyway.
- **Named pipe via the redirector.** A pipe created as `\\.\pipe\rt-test-probe-remote` also accepted connections, and served data, at `\\127.0.0.1\pipe\...`, `\\localhost\pipe\...` and `\\<COMPUTERNAME>\pipe\...`. Node exposes no way to set `PIPE_REJECT_REMOTE_CLIENTS` or its own DACL.
- **The pipe's DACL.** Read at about 13:47 by PowerShell 7 through `[System.IO.Pipes.NamedPipeClientStream]` and `PipesAclExtensions.GetAccessControl`, on a pipe that a Node 24.19.0 `net.Server` created (`ipc/hold.mjs`). The SDDL was `O:<user SID>G:<user SID>D:(A;;FR;;;WD)(A;;FR;;;AN)(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;<user SID>)`. Full access goes to the creating user, `SYSTEM` and Administrators. Everyone and `ANONYMOUS LOGON` get `FILE_GENERIC_READ` only. So another user, local or through the redirector, can open the pipe read-only and can never send a request. `Get-Acl -LiteralPath '\\.\pipe\<name>'` failed with error 87.
- **Detached daemon.** A child spawned with `detached: true`, `stdio: ["ignore", fd, fd]` on a log file and `windowsHide`, then `unref()`, kept running and writing its stdout and stderr to the file after its starter exited, on both platforms.
- **Signals.** On Linux, `process.kill(pid, "SIGTERM")` ran the child's `SIGTERM` handler and its `exit` event. On Windows the same call ended the child with neither, as Node documents for `SIGTERM` on Windows, so Windows gets a clean stop only through the protocol (AC5, AC6).
- **Vitest ends the process on a signal.** Vitest 5.0.1's logger, while an instance is open, registers `process.once("SIGINT" | "SIGTERM" | "exit", onExit)`, which sets the exit code and calls `process.exit()` 1 ms later (`dist/chunks/index.DzobfTyw.js`, `addCleanupListeners`). It also exits on `unhandledRejection` (`registerUnhandledRejection`, same file). Hosting Vitest in the daemon's own process would skip the daemon's stop, so Vitest runs in the executor child (AC4, AC6).
- **A stuck test, for 1.3b and the executor bound.** For a test in `for (;;) {}`, the first `cancelCurrentRun` did not end the run within 3 s. A second one ended it within about 10 ms with end reason `interrupted`, on 5.0.1 and 4.1.11 and on both the `forks` and `threads` pools. After that, `close()` returned and no worker process remained. `collectTests` over a module that loops at top level also ended on the second cancel, on both versions. A synchronous loop in `globalSetup` runs on the Vitest host's own thread, where no cancel reaches it. Only ending the executor child ends it, which the executor bound does (AC5).

#### Design notes

- **Processes.** The caller (1.3c's CLI), the detached daemon (server, store, log, lifecycle), and the daemon's executor child (Vitest). Only the executor child loads Vitest, so a workspace's `process.env` changes, Vitest's signal and rejection handlers, and a stuck `globalSetup` stay out of the daemon. The daemon writes the store: one writer per worktree daemon, which 1.2's `busy_timeout` coordinates with other worktrees' daemons.
- **Start sequence.** Discover, write the discovery, then call `runWorkspace` for each workspace in the discovery's order and write each run as it returns. A workspace discovery reported unsupported or failed is still run, and its run record says the same (1.1b AC8). Runs are not fingerprinted (the sprint objective: "no input is fingerprinted, so every result's freshness is honestly unknown").
- **Stop order.** Mark the daemon stopping so no new job starts, abort the job in progress, and wait for the executor within its bound. Store the run in progress when it ended within the bound, whatever its status, store nothing for a discovery, and kill the child when the bound passes. Then close the store and the server, and exit. A run queued behind the job in progress is never started, so the stop does not await its abort (the sprint text).
- **Executor bound.** 1.3b's grace constant plus a named margin, computed from that constant (§ Grill record). When the child is killed, its record is never produced and nothing is stored, as 1.2 rules for a run the daemon never finished ("Only finished runs are stored, each whole").
- **Refusals before anything executes.** The endpoint is taken before the executor is forked. A second daemon (AC7) or an overlong socket path (AC9) is refused before any Vitest loads (AC1).
- **Frozen for every version (AC12).** Four things never change in any protocol version, from this ticket's first on. (1) The line framing: one UTF-8 JSON object per `\n`-terminated line, under the line limit's floor of 1 MiB, which no version may lower. (2) The stop request: one fixed JSON object with no version field, accepted as a connection's first line or at any point after. (3) Its acknowledgement: one fixed JSON object saying the stop has begun, with the daemon's process id. (4) The version-mismatch error: a fixed field naming it as that error, plus the daemon's protocol version, the version the client sent, and the daemon's process id. Everything else, the hello, status and every later request included, is versioned and may change with a bump. A later version may add fields to the three frozen objects, and a reader of any version ignores fields it does not know, but none may be removed or renamed. `stopDaemon` then waits on the process id and the endpoint, which need no protocol. Test owed (for create-tests): a client speaking a protocol version other than the daemon's stops it both ways. (a) The frozen stop sent as the first line, with no hello: the daemon acknowledges, exits, and its endpoint closes. (b) A hello with the version plus one, which gets the mismatch error naming both versions and the process id, then the frozen stop on the same connection, which stops it. Also owed: a `startDaemon` against a daemon answering with that mismatch is refused, naming its process id and version. The test can speak another version by writing raw lines to the endpoint; it needs no second build.
- **No write before the client writes (AC9).** The daemon writes nothing to a connection until that connection has sent it a line: no greeting, banner, version notice or unsolicited event. AC9 rests on this. On Windows, any user can open the pipe read-only (§ Spike facts, the pipe's DACL), and a read-only client can never send a line, so it receives nothing. A future push message (for example 2.4's `wait` answers) goes only to a connection that has sent its hello. An error response to a bad line (AC8) keeps the property, since only a client that can write can send one.
- **Status during a run.** The daemon's event loop runs no Vitest code, so it answers while the executor is busy or stuck (AC4). It does run 1.2's `node:sqlite` writes, which are synchronous and wait up to 1.2's `BUSY_TIMEOUT_MS` (5000 ms on wt-1 at 13:52) while another worktree's daemon writes the shared store (AC7). So AC4's response bound is a named constant of 10 s, derived from that timeout rather than set beside it (C8). It is the bound a test holds the daemon to, not a timeout in the server.
- **Jobs that end with nothing stored (AC4).** A job whose executor was killed or crashed, or whose store write failed, leaves no record, as 1.2 rules for a run the daemon never finished. Status names it, and so does the log, so no caller reads an idle daemon as a complete start (C32). C131 and C142 are unaffected in Sprint 1: every stored result's freshness is unknown until 2.1, so an earlier run's outcome is never presented as current. 2.3 owns recording interrupted and invalidated runs once results can be current.
- **No network.** `endpoint.ts` is the daemon's only `node:net` use, and it listens and connects only on the endpoint path; no daemon module imports `node:http`, `node:https` or `node:dgram`, or calls `fetch` (AC10, C146).
- **Unanalyzed.** Log rotation and size are unanalyzed, and so is a daemon that outlives a deleted worktree. So is the Windows executor child's own Vitest workers when the child is killed. The spike showed none left after a second cancel, not after a kill.

#### Current structure of the modified files

- `packages/daemon/src/index.ts` (after 1.2, on wt-1): re-exports `consumerIdentity`, `defaultStateDirectory`, `openStore`, `RtTestStore`, the stored-record types, `discoverTests`, `findVitestWorkspaces`, `runWorkspace` and their types.
- `packages/daemon/package.json`: `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`, `"dependencies": { "@rt-test/core": "workspace:*" }`, and the scripts `build` (`tsc -p tsconfig.build.json`) and `typecheck` (`tsc --noEmit`).
- `docs/architecture.md` § Current implementation (orchestrator-owned) ends: "Both load Vitest configs and import test files, so only the daemon calls them, after an explicit start; that start is not built yet, so neither has a production caller." 1.2 changes the next sentence.

#### Existing tests this change breaks

No test asserts the daemon package's exports: `rg -n "exports|src/index|@rt-test/daemon" packages/daemon/test test --glob '*.ts'` hits only a stand-in Vitest manifest (`load-vitest.test.ts`, `harness.ts`), the defect verifier's sandbox links (`test/scripts/defects/`), and fixture prose (`list-unbuilt-work.test.ts`). AC11 changes `discoverTests`'s parameters, which breaks `packages/daemon/test/discover-tests.test.ts`. Its two helpers call `discoverTests(dir)` and `discoverTests(root)` (`rg -n "discoverTests\(" packages test --glob '*.ts'`), so each builds a confirmed start instead, for example one confirming every listed workspace. The change alters no other signature of 1.1, 1.1b or 1.2. Unanalyzed: a repository-wide test that scans every production file or `docs/architecture.md`; create-tests runs the suite.

#### Previous ticket

1.2 (in progress, wt-1): `openStore(stateDirectory)` creates the state directory and refuses a store of a newer schema or a file that is not an RT Test store. Its writers reject an absent or empty project identity, worktree identity or fingerprint. Two stores open on one state directory, as two worktrees' daemons would be, each store and read back their own runs. On Node 22 the first `node:sqlite` import prints an `ExperimentalWarning` to stderr, which in this ticket's daemon goes to the log (AC10). 1.1b's Completion Notes name the two candidates the owner ruled into the sprint's 1.3 text, both now 1.3b's.

### References

- `docs/architecture.md` § Components: "The CLI and API talk to it over a local socket or loopback transport framed by line or by length and versioned (ADR-0001); the transport itself is an M1 spike on Windows and Linux." § Query surface: "Keep local endpoints scoped to an explicitly started project, authenticate access if using HTTP, and avoid binding to external interfaces by default."
- `docs/roadmap.md` § M1: "First spikes: ... and the IPC transport on Windows and Linux." § M6 acceptance: "stop it, and uninstall ... without ... leaving a process running."
- `docs/plan.md`: "1. A user explicitly starts RT Test for a trusted project."
- Ticket 1.1 (`_agent-docs/tickets/1-1-capture-vitest-runs.md`) § Dev Notes, "Also observed": `collectTests` runs `globalSetup`, and the logger's process handlers.
- Ticket 1.1b § Completion Notes, change-request candidates 1 and 2.
- Ticket 1.2 (`_agent-docs/tickets/1-2-persist-results.md`) § Pending siblings, § Grill record.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete`.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C6,C8,C10,C12,C22,C24,C30,C31,C32,C34,C36,C38,C46,C48,C52,C59,C122,C123,C131,C140,C141,C142,C143,C146,C147,C148,C150,C153 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P1,P10,P13,P15,P16,P17,P18,P19,P20,P21,P32,P41,P42 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area: packages/daemon
is_consolidation: false
sizing_ac_count: 13
files_to_modify:
  - packages/daemon/package.json
  - packages/daemon/src/vitest/discover-tests.ts
  - packages/daemon/src/vitest/adapter-version.ts
  - packages/daemon/src/store/write-discovery.ts
  - packages/daemon/src/store/read-discovery.ts
files_to_create:
  - packages/daemon/src/daemon/protocol.ts
  - packages/daemon/src/daemon/endpoint.ts
  - packages/daemon/src/daemon/server.ts
  - packages/daemon/src/daemon/executor.ts
  - packages/daemon/src/daemon/executor-main.ts
  - packages/daemon/src/daemon/daemon-main.ts
  - packages/daemon/src/daemon/lifecycle.ts
  - packages/daemon/src/daemon/daemon-log.ts
  - packages/daemon/src/client.ts
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

- `_agent-docs/tickets/1-3-daemon-lifecycle.md` (created)
- Held for the orchestrator's go, as exact text: `_agent-docs/sprint-status.yaml` (the split's three keys, 1.3 at `ready-for-dev`), the sprint file's objective sentence and its 1.3, 1.3b and 1.3c sections, and the FR2, FR4 and NFR4 marker relinks (`docs/requirements.md`).

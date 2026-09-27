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

- [x] AC1: No project code executes except after `startDaemon` is called for that consumer's root. Importing `@rt-test/daemon` or its client entry point, calling `daemonStatus` or `stopDaemon`, and a `startDaemon` that is refused (AC7, AC9) load no Vitest config, run no `globalSetup` and import no test file.
- [x] AC2: `startDaemon` for a consumer root starts a daemon process for that worktree that outlives the process that called it, and resolves once the daemon answers on its endpoint, before discovery has finished. It resolves with the daemon's process id, the worktree identity, the project identity, the state directory, and the protocol version. The state directory is the one the caller gives, else `.rt-test` under the consumer root. When the daemon has not answered within a named startup deadline, `startDaemon` rejects with the daemon's process id and the log path, and never waits without end.
- [x] AC3: Once started, the daemon discovers the consumer's Vitest workspaces confirmed at start (AC11) and stores that discovery. It then runs each confirmed workspace the discovery lists once, in the order discovery lists them, and stores each run as it ends, whatever its status. Every stored record is bound to the worktree's project and worktree identities and stored as not fingerprinted. After the last run the daemon stays idle and keeps serving until it is stopped.
- [x] AC4: A status request answers with the daemon's process id, worktree identity, project identity, state directory and protocol version, and its activity: discovering, running (naming the workspace), or idle. It also lists each job since the start that ended with nothing stored (a killed or crashed executor, a failed store write), naming the workspace or the discovery and the reason. The daemon answers status and stop requests within a named bound longer than the store's busy timeout while a discovery or a run holds Vitest open, including when a test is stuck in a synchronous loop.
- [x] AC5: `stopDaemon` for a consumer root resolves only after that worktree's daemon process has exited and its endpoint accepts no connection. A run in progress when the stop arrives is interrupted, and stored when it ends within the executor bound. A discovery in progress stores nothing. Workspaces not yet run are neither run nor stored. When the job in progress has not ended within the named executor bound, the daemon ends the process hosting Vitest, stores nothing for that job, and still exits. With no daemon serving that worktree, `stopDaemon` fails with a reason naming the consumer root. A second `stopDaemon` while a stop is under way joins it and resolves on the same exit. When the daemon has not exited within a named stop deadline, `stopDaemon` rejects with the process id and the log path, and never waits without end.
- [x] AC6: On Linux, a `SIGTERM` or `SIGINT` sent to the daemon process stops it as `stopDaemon` does (AC5), including while a discovery or a run holds Vitest open. When the process hosting Vitest exits during a job without a stop, the daemon logs the exit, stores nothing for that job, and goes on with the next workspace while it keeps serving. When the daemon process ends without a stop, the process hosting Vitest ends within the executor bound unless it is stuck in synchronous code.
- [x] AC7: While a daemon serves a worktree, a second `startDaemon` for that worktree is refused with a reason naming the running daemon's process id, and starts nothing. A `startDaemon` after that worktree's daemon was killed without a stop, which on Linux leaves its socket file behind, starts a daemon. The daemons of two worktrees of one project serve at the same time on one shared state directory, and each stores and reads back only its own worktree's runs.
- [x] AC8: Every protocol message is one line of JSON. Each carries the protocol version, apart from the version-independent stop and its acknowledgement (AC12). A connection's first request is a hello, or the version-independent stop (AC12). A hello carrying another protocol version gets an error naming both versions and the daemon's process id; the daemon then accepts only that stop on the connection, and closes it on anything else. A line that is not valid JSON, an unknown request, a request other than that stop before the hello, and a line longer than a named limit each get an error response naming the problem, and the daemon keeps serving that client and every other one.
- [x] AC9: Apart from the operating system's administrators (`SYSTEM` and Administrators on Windows, root on Linux), only the user who started the daemon can send it a request, and nobody else receives anything from it: another user can at most open the Windows pipe read-only, and the daemon writes only in answer to a request on the same connection. On Windows the endpoint is a named pipe, and on Linux a Unix socket in a directory only that user can enter: `$XDG_RUNTIME_DIR` when set, else `rt-test-<uid>` under the system temporary directory. Each endpoint's name is derived from the worktree identity. When the Linux socket path would be longer than the platform's limit, `startDaemon` is refused with a reason naming the path and the limit, and nothing listens on a shortened path.
- [x] AC10: The daemon writes a log for its worktree inside the state directory. The log records the start (consumer root, state directory, process id, protocol version), the start and end of each discovery and run with its status, each error, and the stop. The daemon's own stdout and stderr, Node's warnings included, go to that log. Every file the daemon process writes lies inside the state directory, apart from the Linux socket, its lock file and their runtime directory, and the daemon opens no network connection. What Vitest writes in the executor child is ticket 1.3b's.
- [x] AC11: `startDaemon` takes the confirmed start: the consumer root, and each workspace the user was shown, with the config file shown for it. The daemon loads, discovers and runs only a workspace whose path and chosen config file both match a confirmed entry. Any other workspace it finds is never loaded and never run. That covers a workspace added after the prompt, and one whose chosen config file is no longer the one shown. The stored discovery lists each such workspace as not discovered, with the reason "not confirmed at start", distinct from unsupported, failed and every other state, and never leaves it out. A confirmed workspace the daemon no longer finds loads nothing, and the log names it. The match is made again at the moment each workspace is loaded, for each run as well as for the discovery, so a config file added or swapped at any time after the prompt is never loaded. A run whose workspace no longer matches loads nothing and stores nothing, and status (AC4) and the log name it with the reason that its config file is no longer the one confirmed at start.
- [x] AC12: A client of any protocol version can stop a daemon of any other, and can name it. A version-independent stop request stops the daemon exactly as `stopDaemon` does (AC5), whether a connection sends it as its first line or after its hello was refused for another version. So does `stopDaemon`, whatever version the daemon speaks. A `startDaemon` that finds a daemon of another protocol version serving the worktree is refused with a reason naming that daemon's process id and protocol version, and saying it can be stopped. This holds for every protocol version from this ticket's first on: no later version may change the stop request, its acknowledgement, the version-mismatch error's fields, or the line framing.
- [x] AC13: Each workspace's discovery and run execute with that workspace's directory as the process cwd, and the executor's cwd is restored after each job.

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

Resolutions (dev, 2026-09-26, probes under `_agent-docs/.scratch/1-3-dev/`, removed on completion):

- U1 CONFIRMED on Windows, Node 24.19.0, Vitest 5.0.1. The `consumer` fixture, with a stand-in Vitest 3.2.4 in `packages/old`, gave one discovery holding `discovered`, `failed` and `unsupported` workspaces, then a run of each workspace (`ran`, `failed`, `unsupported`) and one `interrupted-before-load` run. Each of the 9 records went through a `fork` child with the default serialization and came back `deepStrictEqual` to the original. The records hold only strings, numbers, booleans, arrays and plain objects (`run-states.ts` `TestRunState` and `RecordedModule`, `module-tests.ts` `ModuleReport`, `packages/core/src/test-identity.ts` `TestIdentity`), and JSON is the same on Linux.
- U2 CONFIRMED on Windows, Node 24.19.0: the child spawned `detached` with stdio `["ignore", fd, fd, "ipc"]` and `windowsHide` got its message, replied, called `process.disconnect()`, and was still alive and writing to its log 3 s after the starter exited. The same held on Linux (WSL Ubuntu 24.04) under Node 24.19.0 and 22.23.3.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [x] (Support) Resolve every Unverified Assumption above before implementing.
- [x] (AC8, AC12) Create the protocol module (for example `packages/daemon/src/daemon/protocol.ts`): the protocol version constant, the line-length limit constant, the request and response shapes (hello, status, stop, error), and a line decoder that splits on `\n` across chunk boundaries and reports a line past the limit without buffering the rest of it. Frame by line (ADR-0001). Keep the frozen part (Dev Notes § Design notes, Frozen for every version) apart from the versioned shapes, in constants and types marked as never to change: the stop request, its acknowledgement, and the version-mismatch error's fields.
- [x] (AC9, AC7) Create the endpoint module (for example `packages/daemon/src/daemon/endpoint.ts`): the endpoint for a worktree identity, as `\\.\pipe\rt-test-<hash>` on Windows and `<runtime dir>/<hash>.sock` on Linux. On Windows the pipe namespace is machine-wide, so include the user name in the hashed input. On Linux, create the runtime directory with mode `0700` when missing, and refuse a directory another user owns or others can enter. Read `XDG_RUNTIME_DIR` in this module only (C6). Refuse a socket path whose UTF-8 encoding is longer than 108 bytes, a named constant (Q5, § Spike facts), before `listen`. Hold an exclusive lock file in the runtime directory (created with the `wx` flag, holding the process id) across the stale check, the unlink and the `listen`, and remove it once listening. Treat a lock whose process id is no longer running as stale, so two starts racing after a kill cannot each unlink the other's live socket (AC7). On `EADDRINUSE`, connect to the endpoint: when a daemon answers, report it; when the connection is refused (Linux, stale file), unlink the socket file and listen once more.
- [x] (AC4, AC5, AC8, AC12) Create the server (for example `packages/daemon/src/daemon/server.ts`): accept connections on the endpoint, write nothing to a connection until it has sent a line (no greeting or banner, Dev Notes § Design notes), require the hello first except for the frozen stop, answer status and stop, and answer every bad line with an error response while the connection stays open. The exception is a hello carrying another protocol version: it gets the frozen version-mismatch error (both versions and the daemon's process id), after which the connection accepts only the frozen stop and is closed on any other line (AC8, AC12). Accept the frozen stop at any point on any connection, before or after a hello, and answer it with the frozen acknowledgement before stopping (AC12). A `node:net` server on the endpoint path, as the spike's probe did.
- [x] (AC11, AC3, AC4) Bind discovery and runs to the confirmed start, in `packages/daemon/src/vitest/discover-tests.ts`, `workspace-session.ts` and `run-workspace.ts` as ticket 1.3b leaves them. `discoverTests` takes the confirmed start in place of the bare consumer root, keeping 1.3b's abort signal. It lists the workspaces with `findVitestWorkspaces`, chooses each one's config file as 1.3b's `config-loader.ts` does, and loads only a workspace whose path and chosen config file match a confirmed entry. Every other workspace becomes a `WorkspaceDiscovery` of a new status of its own (for example `not-confirmed`), carrying the reason "not confirmed at start" as a named constant (C3). A workspace's config is chosen afresh at every load, in `workspace-session.ts` `configOptions` (`workspaceConfig(workspace.directory)`). A run's load comes minutes after the prompt, and a discovery's load of a later workspace comes after earlier workspaces have collected. So a filter applied only at listing time leaves a window at both. Put the match at the one point every load passes through: `inWorkspaceSession` takes the confirmed config file for its workspace. Before it imports Vitest, it compares the config `workspaceConfig` chooses (made root-relative, `/`-separated) with that file, and on a mismatch it loads nothing and returns a session result of its own (for example `not-confirmed`). Discovery maps that result to its not-confirmed status. `runWorkspace` takes the workspace with its confirmed config file, and on that result it returns a separate not-confirmed result outside `WorkspaceRun` (for example `NotConfirmedRun`). The executor reports that job as ended with nothing stored, with the reason "its config file is no longer the one confirmed at start" as a named constant, so the store and `writeRun` are unchanged (AC11, AC4). Because every load passes through this point, no caller can load an unconfirmed workspace or config (P18). Declare the confirmed-start type beside it, with each workspace's path as `VitestWorkspace.path` spells it and its config file root-relative and `/`-separated (P13), so ticket 1.3c's start plan builds it from the same functions. Add the new status to 1.2's `write-discovery.ts` and `read-discovery.ts`. The `status` column is unconstrained text, so no schema change is needed, and a reader that finds an unknown status already refuses it. Raise `VITEST_ADAPTER_VERSION` in `adapter-version.ts`, since what a stored discovery can say changes (C124).
- [x] (AC3, AC5, AC6) Create the executor host (for example `packages/daemon/src/daemon/executor.ts`) and its child entry (for example `packages/daemon/src/daemon/executor-main.ts`). The daemon forks one child that runs `discoverTests` and `runWorkspace` one job at a time and sends each result back. It forwards a stop as an abort of the job in progress. When the job has not ended within the executor bound, it kills the child, and it reports a child that exits during a job as that job's failure, logs the exit, and forks a new child for the next job (AC6). When its channel to the daemon closes, the child aborts its job and exits once the job ends or the executor bound passes, whichever comes first (AC6).
- [x] (AC2, AC3, AC4, AC5, AC6, AC10) Create the daemon entry (for example `packages/daemon/src/daemon/daemon-main.ts`) and its lifecycle (for example `packages/daemon/src/daemon/lifecycle.ts`). Take the consumer root and state directory from its arguments, compute identities with 1.2's `consumerIdentity`, take the endpoint (refusing on AC7 or AC9), open the log and 1.2's store, start serving, and send `startDaemon` its startup report over the spawn-time channel (serving, or the refusal and its reason), then disconnect that channel (U2). Take the confirmed start (AC11) over that same channel before reporting, not from the arguments, since it can outgrow a Windows command line. Then run the start sequence of AC3 through the executor: discovery with the confirmed start, then a run for each workspace the discovery lists under a status other than the not-confirmed one. Log each confirmed workspace the discovery did not find (AC11). Write each record with 1.2's `writeDiscovery` and `writeRun` and `NOT_FINGERPRINTED`, and track the activity status reports and each job that ended with nothing stored, with its reason (AC4). Log and go on after a failed store write (C30). On stop, or on Linux `SIGTERM` and `SIGINT`: keep answering hello and status. Answer a stop request with the frozen acknowledgement that the stop has begun (never that it has completed, C31); a stop that arrives while a stop is under way gets that same acknowledgement and joins it, starting no second sequence (AC5, AC12). Answer any other request with an error saying the daemon is stopping. Then abort the job in progress, skip the workspaces not yet run, wait for the executor within its bound, store the run in progress when it ended within the bound whatever its status, store nothing for a discovery, close the store, close the server, and exit.
- [x] (AC10) Create the daemon log (for example `packages/daemon/src/daemon/daemon-log.ts`): one append-only file per worktree inside the state directory, named from the worktree identity hash, since worktrees may share a state directory. `startDaemon` opens it for the child's stdout and stderr. The daemon writes to it the entries AC10 lists: the start (consumer root, state directory, process id, protocol version), the start and end of each discovery and run with its status, each error (through `errorText`), an executor child's exit during a job (AC6), each job that ended with nothing stored (AC4), and the stop.
- [x] (AC1, AC2, AC4, AC5, AC7, AC9, AC11, AC12) Create the client entry (for example `packages/daemon/src/client.ts`): `startDaemon`, `daemonStatus` and `stopDaemon` for a consumer root. `startDaemon` resolves the state directory to an absolute path (a relative one against the caller's working directory) and creates it before opening the log, so the detached daemon and every other worktree see the same directory. Before spawning, it refuses a worktree whose endpoint already answers, naming the process id from that daemon's status (AC7), or, when that daemon refuses the hello for another protocol version, the process id and version from the frozen mismatch error, and saying it can be stopped (AC12), and a socket path over the limit (AC9). It then spawns the daemon entry detached with an argument array (P15), its stdout and stderr going to the log and one IPC channel open for startup only. The daemon reports over that channel that it is serving, or its refusal with its reason (the endpoint taken in a race, a store `openStore` refuses), then disconnects it. `startDaemon` resolves after that report and a hello and status answer, and otherwise rejects with the reported reason or, when the daemon exits first, its exit code and a pointer to the log. The options type requires the caller to state that the project is trusted, and it carries the confirmed start (AC11), which `startDaemon` sends over the startup channel. So no caller starts a daemon without stating trust and naming what it confirmed; ticket 1.3c's prompt is the only production caller that does. `stopDaemon` sends the frozen stop as its connection's first line, with no hello, so it stops a daemon of any protocol version (AC12). It resolves after the endpoint stops accepting connections and the process id is gone. Both calls wait under named deadlines derived from existing constants (C8). The stop deadline is the executor bound plus 1.2's `BUSY_TIMEOUT_MS` plus a named margin. The startup deadline covers the startup report and the first hello and status, as a small multiple of `BUSY_TIMEOUT_MS` (since `openStore` may wait on it) plus a margin. Past a deadline, the call rejects with the daemon's process id and the log path (AC2, AC5, C153). `stopDaemon` and `daemonStatus` reject with a reason naming the consumer root when no daemon answers on that worktree's endpoint (AC4, AC5, C153). The client's module graph loads neither `node:sqlite` nor Vitest, nor any consumer config or test module, at run time, so the CLI (1.3c, 1.4) loads none of them (orchestrator, 16:24). The client may import modules under `src/store/` and `src/vitest/` that meet this. 1.2's `consumer-identity.ts` imports only `node:fs`, `node:path` and a type. `find-workspaces.ts` imports only `node:fs`, `node:path` and `error-text.ts`, which imports nothing. Ticket 1.3c's start plan reuses it and 1.3b's config-file choice.
- [x] (Support) Export the client from a `./client` subpath in `packages/daemon/package.json` `exports`, beside `.`, and export the protocol types the CLI needs from it.
- [x] (AC13) In `packages/daemon/src/vitest/workspace-session.ts` `inWorkspaceSession`, change the process cwd to `workspace.directory` before loading Vitest, and restore it with the env and exit code in `captureHostState`, so every discovery and run passes through it (A4).
- [x] (Support) Send the orchestrator the `docs/architecture.md` § Current implementation and § Components text for the daemon process, the executor child and the endpoint (P21, C48), and the README Status sentence.
- [x] (Support) Lint and typecheck.

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
- Dev sanity check from rt-t1-3-dev (threadId 08571045-d0bc-485e-8cd6-cc91035c1d55), answered by create at about 18:50, all four CONFIRMED:
  - F1: AC11's confirmed-config match was placed only in discovery's listing, while every run, and every later workspace in a discovery, chooses its config again at load. The match now sits in `inWorkspaceSession`, before Vitest is imported. A mismatched run loads and stores nothing, with a named reason in status and the log. This is stricter than dev's proposed check in the executor, which left a window between the check and the load.
  - F2: a stop during a stop joins the one under way.
  - F3: `startDaemon` and `stopDaemon` wait under named deadlines derived from the executor bound and `BUSY_TIMEOUT_MS`.
  - F4: `BUSY_TIMEOUT_MS` is exported from `open-store.ts`.
  - The additions are 3 production files (`open-store.ts`, `workspace-session.ts`, `run-workspace.ts`) and 1 broken test helper (`harness.ts`). There is no new criterion, and code units stay 13.
- A2, restate the client's import rule as an outcome: "The client's module graph loads neither `node:sqlite` nor Vitest, nor any consumer config or test module, at run time." A rule naming `src/vitest/` would break when 1.3c's start plan reuses `find-workspaces.ts` and 1.3b's config-file choice.
- A4, the working directory Vitest sees, decided by the orchestrator at 19:26 on 2026-09-26, on dev's fork from its adversarial pass. Dev asked whether Vitest should see the consumer root, the daemon's working directory, or each workspace's directory, and recommended the workspace's. Ruling: chdir to `workspace.directory` inside `inWorkspaceSession`, restored as the env and exit code are restored. The reason: a Vitest workspace's own `vitest` runs from its package directory, so results a consumer test derives from `process.cwd()` must match the run the user would make, which is NFR2's full-run agreement. Added as AC13.

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
- **Status during a run.** The daemon's event loop runs no Vitest code, so it answers while the executor is busy or stuck (AC4). It does run 1.2's `node:sqlite` writes, which are synchronous and wait up to 1.2's `BUSY_TIMEOUT_MS` (5000 ms on wt-1 at 13:52) while another worktree's daemon writes the shared store (AC7). So AC4's response bound is a named constant of 10 s, derived from that timeout rather than set beside it (C8). `BUSY_TIMEOUT_MS` is module-private in `packages/daemon/src/store/open-store.ts` today (`const BUSY_TIMEOUT_MS = 5000;`), so export it there. That one-word change is the only edit to that file. It is the bound a test holds the daemon to, not a timeout in the server.
- **Jobs that end with nothing stored (AC4).** A job whose executor was killed or crashed, or whose store write failed, leaves no record, as 1.2 rules for a run the daemon never finished. Status names it, and so does the log, so no caller reads an idle daemon as a complete start (C32). C131 and C142 are unaffected in Sprint 1: every stored result's freshness is unknown until 2.1, so an earlier run's outcome is never presented as current. 2.3 owns recording interrupted and invalidated runs once results can be current.
- **No network.** `endpoint.ts` is the daemon's only `node:net` use, and it listens and connects only on the endpoint path; no daemon module imports `node:http`, `node:https` or `node:dgram`, or calls `fetch` (AC10, C146).
- **Unanalyzed.** Log rotation and size are unanalyzed, and so is a daemon that outlives a deleted worktree. So is the Windows executor child's own Vitest workers when the child is killed. The spike showed none left after a second cancel, not after a kill.

#### Current structure of the modified files

- `packages/daemon/src/index.ts` (after 1.2, on wt-1): re-exports `consumerIdentity`, `defaultStateDirectory`, `openStore`, `RtTestStore`, the stored-record types, `discoverTests`, `findVitestWorkspaces`, `runWorkspace` and their types.
- `packages/daemon/package.json`: `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`, `"dependencies": { "@rt-test/core": "workspace:*" }`, and the scripts `build` (`tsc -p tsconfig.build.json`) and `typecheck` (`tsc --noEmit`).
- `docs/architecture.md` § Current implementation (orchestrator-owned) ends: "Both load Vitest configs and import test files, so only the daemon calls them, after an explicit start; that start is not built yet, so neither has a production caller." 1.2 changes the next sentence.

#### Existing tests this change breaks

No test asserts the daemon package's exports: `rg -n "exports|src/index|@rt-test/daemon" packages/daemon/test test --glob '*.ts'` hits only a stand-in Vitest manifest (`load-vitest.test.ts`, `harness.ts`), the defect verifier's sandbox links (`test/scripts/defects/`), and fixture prose (`list-unbuilt-work.test.ts`). AC11 changes `discoverTests`'s parameters, which breaks `packages/daemon/test/discover-tests.test.ts`. Its two helpers call `discoverTests(dir)` and `discoverTests(root)` (`rg -n "discoverTests\(" packages test --glob '*.ts'`), so each builds a confirmed start instead, for example one confirming every listed workspace. `runWorkspace` now takes the workspace with its confirmed config file (AC11), which breaks its single test caller, the run helper in `packages/daemon/test/harness.ts` (`rg -c "runWorkspace\(" packages/daemon/test test` counts 1 there). The change alters no other signature of 1.1, 1.1b or 1.2. Unanalyzed: a repository-wide test that scans every production file or `docs/architecture.md`; create-tests runs the suite.

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
  - packages/daemon/src/store/open-store.ts
  - packages/daemon/src/vitest/workspace-session.ts
  - packages/daemon/src/vitest/run-workspace.ts
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

Dev session: threadId 08571045-d0bc-485e-8cd6-cc91035c1d55

#### Test Files This Change Broke

- `packages/daemon/test/discover-tests.test.ts`: `discoverTests` takes a `ConfirmedStart` (`vitest/confirmed-start.ts`) in place of the consumer root (lines 64 and 84). Build one that confirms every listed workspace: `{ consumerRoot, workspaces: findVitestWorkspaces(root).workspaces.map((w) => ({ path: w.path, configFile: chosenConfigFile(w)! })) }`.
- `packages/daemon/test/force-stop.test.ts`: the same `discoverTests` change (line 87).
- `packages/daemon/test/harness.ts`: `runWorkspace(workspace, confirmedConfigFile, signal)` takes the confirmed config file, and returns `WorkspaceRun | NotConfirmedRun` (line 147). `chosenConfigFile({ path, directory })` gives the file to pass.

#### ACs Owed a Test

- AC7, the shared state directory: two worktrees of one project (two git worktrees of one repository) each run a daemon at the same time on one state directory, and each stores and reads back only its own worktree's runs. Not observed by dev; the second-start refusal and the restart after a kill were.

#### Tests Owed

Each named with the defect it catches. The smoke evidence for each is in Completion Notes.

- AC12 (a): the frozen `{"type":"stop"}` sent as a connection's first line, with no hello, stops the daemon (`stopDaemon` does this). Defect: the server requires a hello before the stop.
- AC12 (b): a hello with protocol version plus one gets the mismatch error naming both versions and the pid; the frozen stop on that same connection then stops the daemon; any other line closes the connection. Defect: a mismatched connection is closed before the stop, or answers other requests.
- AC12: `startDaemon` against a daemon answering the mismatch error is refused, naming its pid and version and saying it can be stopped. A test can speak another version with raw lines on a fake endpoint.
- AC8: invalid JSON, a request before hello, an unknown request and a line over `MAX_LINE_BYTES` each get an error with its code, and the next valid request on that connection is answered. `LineDecoder` across chunk boundaries and a split UTF-8 character. Defect: an error closes the connection, or a split line is lost.
- AC9: no write to a connection that has sent nothing (connect, wait, read nothing). Linux: a runtime directory with mode 755, one owned by another user, or a symbolic link refuses the start and every client call; a socket path over `MAX_SOCKET_PATH_BYTES` refuses the start before spawning.
- AC7 / AC9, `takeLock` (`daemon/runtime-directory.ts`): a live holder refuses naming its pid; a lock naming a dead pid is taken over; an empty lock refuses; release removes only this process's lock.
- AC11: a config file added to a confirmed workspace after discovery, before its run, makes the run load nothing and list `{ workspacePath, reason: CONFIG_NOT_CONFIRMED_REASON }` in status; a workspace absent from the confirmed start is stored as `not-confirmed` with `NOT_CONFIRMED_REASON`, and its config is never loaded (a config that throws when loaded shows it).
- AC5: two concurrent `stopDaemon` calls both resolve on the same exit; `stopDaemon` and `daemonStatus` with no daemon reject naming the consumer root; a run in progress at the stop is stored `interrupted`.
- AC5 / AC6: a stuck synchronous `globalSetup` at the stop ends the executor at `EXECUTOR_BOUND_MS`, stores nothing, lists the job, and the daemon exits. An executor killed mid-run is logged, stores nothing for that job, and the next workspace still runs. The daemon killed without a stop takes its executor with it.
- AC6 (Linux): `SIGTERM` mid-run stops the daemon as `stopDaemon` does, and the socket file is removed.
- AC4: status names the activity (discovering, running with the workspace, idle) and lists unstored jobs; after a discovery that ended with nothing stored, activity is idle. Status answers within `RESPONSE_BOUND_MS` while a job holds Vitest in a synchronous loop.
- AC1: the client entry's module graph loads neither `node:sqlite` nor any `vitest` module (a resolve hook listing loaded URLs, as dev's probe did); `startDaemon` without `trusted: true` spawns nothing.
- AC2: `startDaemon` resolves before discovery has finished, with pid, identities, absolute state directory, log file and protocol version; a relative consumer root and state directory resolve against the working directory; the daemon's working directory is the consumer root.
- AC13: a workspace whose config and test read `process.cwd()` see that workspace's directory, in discovery and in its run, for a workspace other than the root. After the session, `process.cwd()` is what it was before, including after a failed load. Defect: the chdir is dropped, or the restore is. Note that `process.chdir` throws inside a worker thread, so a test that calls `inWorkspaceSession`, `discoverTests` or `runWorkspace` in-process needs a forks-pool worker, which is Vitest's default and the repository's.
- Running the daemon from source: tests spawn `daemon-main.ts` and `executor-main.ts` through `daemon/entry-point.ts`, which adds `--conditions=development --import daemon/source-hooks.ts`. No build is needed.

### Tests Record

Tests session: threadId 84301d91-99ce-4a10-a7d8-2b51a079de93

#### Named Defects

- D1436: The part of a line that ends a chunk is dropped, so a request split across two chunks arrives as its tail alone. (AC8)
- D1437: Each chunk of a line is decoded on its own, so a character whose UTF-8 bytes straddle two chunks is garbled. (AC8)
- D1438: The decoder keeps discarding after an overlong line ends, so every later line on that connection is lost. (AC8)
- D1439: A line of exactly the 1 MiB limit is reported as too long. (AC8, AC12)
- D1440: A stopping daemon answers another request as unknown instead of saying it is stopping. (AC5)
- D1441: The response bound is no longer than the store's busy timeout, so a status held behind another worktree's store write reads as no answer. (AC4)
- D1442: The executor bound leaves Vitest's force-stop no margin, so a job that force-stops in time is killed and stores nothing. (AC5)
- D1443: The stop deadline leaves out the store's busy timeout, so a stop whose last run waits on another worktree's write is reported as not finishing. (AC5)
- D1444: A line that is not JSON closes the connection, so the client's next request goes unanswered. (AC8)
- D1445: A request before the hello is answered, so a client of another protocol version reads a reply shaped for this one. (AC8)
- D1446: An unknown request is answered with a status instead of an unknown-request error. (AC8)
- D1447: A line past the limit is reported as invalid JSON, not as too long. (AC8)
- D1448: The daemon greets a connection before it has sent anything, so a read-only client of another user receives data. (AC9)
- D1449: A connection whose hello was refused for another version still answers requests other than the stop. (AC8, AC12)
- D1450: A stop sent while a stop is under way is not acknowledged, so a second stopDaemon rejects instead of joining the first. (AC5)
- D1451: The start sequence runs the workspaces in an order other than the discovery's. (AC3)
- D1452: A workspace whose discovery failed or was unsupported is skipped, so no run record says it could not run. (AC3)
- D1453: The daemon stores its records under a fingerprint, so a result whose inputs were never fingerprinted can read as current. (AC3)
- D1454: The activity is not set to running when a run starts, so status names no workspace while one runs. (AC4)
- D1455: The activity is left at the last job when the start sequence ends, so a daemon whose discovery stored nothing reads as discovering forever. (AC4)
- D1456: A discovery that ended with nothing stored is not listed, so an idle daemon reads as a complete start. (AC4)
- D1457: A failed store write ends the start sequence, so the workspaces after it never run. (AC4)
- D1458: A run that loaded nothing because its config changed is handed to the store instead of being listed with its reason. (AC11, AC4)
- D1459: A stop does not abort the job in progress, so it waits out a run to its end. (AC5)
- D1460: The workspaces not yet run when the stop arrives are still run. (AC5)
- D1461: A run that ends after the stop arrived is dropped instead of stored. (AC5)
- D1462: The stop closes the store without waiting for the run in progress, so that run's write fails and it is lost. (AC5)
- D1463: A stop during a stop starts a second stop sequence instead of joining the first. (AC5)
- D1464: A confirmed workspace the daemon no longer finds goes unmentioned in the log. (AC11)
- D1465: A discovery that returns after the stop arrived is stored. (AC5)
- D1466: A runtime directory other users can enter is accepted, so another user can reach the socket. (AC9)
- D1467: The owner's own permission bits are counted as open to others, so a mode 700 runtime directory is refused. (AC9)
- D1468: A runtime directory owned by another user is accepted, so that user's socket could answer in the daemon's place. (AC9)
- D1469: A runtime directory that is a symbolic link is not refused as one. (AC9)
- D1470: A client connects through a runtime directory other users can enter, where another user's socket could answer. (AC9)
- D1471: A socket path one byte past the 108-byte limit is accepted, so a Node that truncates it listens on a shortened path. (AC9)
- D1472: A socket path of exactly 108 bytes is refused, though it listens and connects. (AC9)
- D1473: A lock held by a running start is taken over, so two starts can each unlink the other's live socket. (AC7)
- D1474: A lock left by a start that was killed is never taken over, so no daemon can start for that worktree again. (AC7)
- D1475: A lock that names no process is read as a dead holder's and taken over. (AC7)
- D1476: Releasing a lock removes it even after another start has taken it. (AC7)
- D1477: A workspace missing from the confirmed start is loaded through the config it holds now. (AC11, AC1)
- D1478: A confirmed workspace is loaded through whatever config it holds now, so a config added after the prompt executes. (AC11)
- D1479: A run that loaded nothing because its config changed carries no reason, so status and the log cannot say why. (AC11)
- D1480: A workspace's run keeps the daemon's working directory, so a test that resolves paths against process.cwd() sees the consumer root. (AC13)
- D1481: The host's working directory is left in the last workspace after its run. (AC13)
- D1482: The discovery reader drops a not-confirmed workspace's reason, so a stored discovery no longer says why the workspace was not loaded. (AC11)
- D1483: A status request with no daemon serving the worktree resolves with nothing instead of rejecting. (AC4, AC5)
- D1484: A stop with no daemon serving the worktree rejects without naming the consumer root. (AC5)
- D1485: The client's module graph loads the store, so the CLI loads node:sqlite before any start. (AC1)
- D1486: A start that does not state the project is trusted still spawns a daemon that executes the project. (AC1)
- D1487: The default state directory is the consumer root itself rather than .rt-test under it. (AC2)
- D1488: A relative state directory is passed on unresolved, so the daemon resolves it against the consumer root instead of the caller's working directory. (AC2)
- D1489: The daemon reports that it serves only once its start sequence has ended, so a start waits out the whole discovery and every run. (AC2)
- D1490: The starter keeps a reference to the daemon's process, so the CLI that started it never exits. (AC2)
- D1491: A stop resolves on the acknowledgement, while the daemon's process is still running. (AC5)
- D1492: The executor does not pass a stop on to the job in progress, so a run at the stop is killed at the executor bound and stores nothing. (AC5)
- D1493: A job stuck past the executor bound after a stop is never ended, so the daemon never exits. (AC5, AC6)
- D1494: Discovery runs in the daemon's own process, so a synchronous loop in a global setup stops the daemon answering status. (AC4)
- D1495: An executor that exits during a job is kept as the executor, so every later job is sent to a dead process and stores nothing. (AC6, AC4)
- D1496: The executor ignores the loss of its channel to the daemon, so a daemon killed without a stop leaves Vitest running. (AC6)
- D1497: The daemon has no SIGTERM handler, so a SIGTERM does not stop it as a stop request does. (AC6)
- D1498: A second start does not ask the running daemon first, so its refusal cannot name that daemon's process. (AC7)
- D1500: The daemon stores its records under the project's identity for the worktree's, so two worktrees on one state directory read back each other's runs. (AC7)
- D1501: The daemon accepts a stop only after a hello, so a client of another protocol version cannot stop it. (AC12)
- D1502: A connection whose hello was refused for another version is closed on the stop, so that client cannot stop the daemon. (AC12)
- D1503: A start that meets a daemon of another protocol version does not read the mismatch error, so it neither names that daemon's version nor says it can be stopped. (AC12)
- D1504: The log's start entry names only the process, not the consumer root, state directory and protocol version. (AC10)
- D1531: A start that finds its endpoint path held by a stale socket file never removes it, so no daemon starts for that worktree again after a kill. (AC7, G1)
- D1532: A refused connection to the endpoint is read as nothing there, so a stale socket file is never unlinked. (AC7, G1)
- D1533: A relative XDG_RUNTIME_DIR is used as the runtime directory, so a client and a daemon whose working directories differ look for the socket in different places. (AC7, G6)
- D1534: A first startup message that is not a confirmed start crashes the daemon with a raw TypeError instead of a refusal naming the message. (AC2, G7)
- D1535: A confirmed start whose config file is written root-relative with /, as 1.3c will send it, is read as not confirmed, so the workspace never runs. (AC11, G9)
- D1536: A runtime directory path that is a regular file is accepted. (AC9, G10)
- D1537: A stop resolves while the endpoint still accepts connections, because another listener took it after the daemon exited. (AC5, G12)
- D1538: A workspace the discovery lists as not confirmed is run, or listed as unstored. (AC11, AC4, G13)
- D1539: A request after the hello that carries no protocol version is answered. (AC8, G14)
- D1540: A client that stops reading holds the stop past the close grace. (AC5, G15)
- G11: D1485 now also asserts the child's exit status and that the client's own URL was loaded, so an import that throws partway fails it; same mutation, re-proved.
- G5: D1463 and D1495 re-anchored on the review's text and re-proved.
- G2, test infrastructure, by the review's ruling (option 1, 21:11): each daemon test's temp directory lives under one parent per run, which `packages/daemon/test/temp-root.ts` creates as the daemon project's global setup (`packages/daemon/vitest.config.ts`) and removes at teardown; the setup also removes the parents of runs that have since ended, leaving on Windows one a straggling process still holds for a later run. Every removal Windows refuses as held (`EPERM`, `EBUSY`) is retried every 200 ms for up to 11 s, at the test's end and again at teardown; Node 24's `rmSync` does not retry `EPERM` itself (measured: it fails in 1 ms with `maxRetries: 10`). A directory still held at its test's end is recorded with the test's name. The teardown, which runs once every worker has exited, removes it and prints one warning line naming the directory and the test when it is free by then, and fails the run naming both when it is not. A failing test body keeps its own error. On Linux any removal failure throws. Probed on Windows: a detached child holding a file open in the directory for 13 s gave the warning and a passing run; one holding it for 60 s failed the run with "A process still held a test's temp directory at the end of the run: <dir> (<test>)".
- G2 measurement, before the ruling: 5 full `bun run test:defects` runs on Windows 11 with Node 24.19.0, 12 sandboxes each, detected every mutation, and 3 of them failed a baseline (twice the first, once the one after the mutations) on test-end holds alone, with all 855 tests passing. The failing baseline named D1498 and D1502, whose daemons confirm no workspace, so no Vitest was loaded; the daemon had exited and its stop awaits the executor's exit. The directories were refused with `EPERM` at once, not after 11 s as first reported, since `rmSync` did not retry. The held directories of mutated runs were one per mutation that skips Vitest's close or a daemon's stop: D1060, D1074, D1080, D1188, D1196, D1206, D1300, D1307, D1313, D1489, D1491, D1494, D1501, D1502.
- G3, test infrastructure: `withDaemons` fails a test whose body passed when a daemon or executor is still running after its bounded wait, naming the process ids, and the `daemon-lifecycle` fixture's `packages/b` records its executor through a global setup of its own.
- Stale tests updated and re-proved: D1285 and D1286 pin adapter version 3, with version 2 as the mutation. D1301, D1303, D1308, D1312, D1313 and D1315 re-anchored on the same behavior after `discover-tests.ts` and `workspace-session.ts` moved.

#### Deliberately Untested

- `packages/daemon/src/daemon/endpoint.ts` (`removeStaleSocket`'s own `unlink`): only a Linux socket file reaches it. On Windows 11 with Node 24.19.0, `listen` on a leftover file fails with `EACCES` and `connect` with `ENOTSOCK`, so no mutation of the unlink is detected on both gated platforms (C156). Dev's WSL smoke is the evidence. The stale branch around it is D1531 and D1532, through the `HeldEndpoint` seam.
- `packages/daemon/src/client.ts` (`STARTUP_DEADLINE_MS` and the startup rejection; `startedDaemon` and `abandon` ending a daemon whose start failed after the spawn; `isStartupReport` refusing a report of another shape; a start resolving with the identity of a daemon other than the one it spawned): each is reached only by a daemon that misreports its start or outlives the startup deadline, which the daemon entry cannot be made to do without a production seam; holding `openStore` past its 20 s of busy waits is the only natural route, and the ticket gives the deadline as a formula, not a requirement value.
- `packages/daemon/src/daemon/executor.ts` (`#exited`, `#lost` and the reply handler acting only for the current child, G4): the stale child exists only after a job was lost through a failed `send` or an `error` event on the child, and neither can be caused from outside `Executor`, whose child is private and forked from its own entry; a test needs a seam that injects the fork or the child.
- `packages/daemon/src/client.ts` (`waitForExit`'s rejection past `STOP_DEADLINE_MS`): needs a daemon that acknowledges a stop and then outlives 25 s; the deadline's size is pinned by D1443, and D1493's mutation shows the rejection firing.
- `packages/daemon/src/daemon/daemon-connection.ts` (the response timeout): a request that goes unanswered for 10 s needs a daemon that reads and never answers; D1494's mutation exercises it.
- `packages/daemon/src/daemon/daemon-main.ts` (the daemon's own stdout and stderr in the log, AC10): Node 24 prints no warning a test can provoke without a production change; `spawn`'s stdio array is a declaration.
- `packages/daemon/src/daemon/entry-point.ts`, `packages/daemon/src/daemon/source-hooks.ts`: every test that spawns a daemon runs through them, so a break fails all of those; no defect of their own.
- `packages/daemon/src/daemon/protocol.ts` types, `packages/daemon/src/daemon/executor-jobs.ts` types, `packages/daemon/package.json` (`./client` export): type-only or configuration no test code branches on.
- AC9's Windows pipe DACL and remote access: an operating-system property of the pipe, read in the spike (§ Spike facts); no code in this repository sets it.

### Review Record

Review session: threadId 5f4aaf57-b89f-417e-8745-b06fc16269e8

Decisions the orchestrator asked the review to take (2026-09-26, 20:25):

- **The stale-socket seam: built.** `listenOnEndpoint` takes an optional `HeldEndpoint` (`holder(path)`, `removeStale(path)`, awaited), defaulting to the Linux socket file's probe and unlink, and `holderAfterConnectError(code)` is exported as the pure classification the probe uses. A test on either platform holds a worktree's endpoint with a first `listenOnEndpoint`, then calls it again for the same identity with an injected `HeldEndpoint` whose `holder` answers `"stale-file"` and whose `removeStale` closes the first listener. The second listen succeeds only if the stale branch removes and retries. The deliberately-untested line for `endpoint.ts` then narrows to `removeStaleSocket`'s own `unlink`, which only Linux reaches.
- **`inTempDir` leaving held directories: not right as written.** Measured on Windows (Node 24.19.0, Vitest 5.0.1) at 20:16: an unmutated `bun x vitest run packages/daemon/test` (12 files, 282 tests, exit 0) left no `rt-test-daemon-*` directory in the temp directory and no RT Test process. The 35 leftovers were created in three bursts (19:45, 19:57, 20:07). Each was emptied but not removed, which is what a mutated run leaves when a process still holds the directory as its working directory. The swallow is wrong for two reasons. It hides a leak from a passing test, so a regression that leaves an executor or Vitest worker alive (AC5, AC6) passes silently. And it lets mutated runs pile directories up across runs. Gap rows G2 and G3 below.

Tech debt (not fixed here, since each fix reaches a copy this change did not open):

- The exit wording `signal === null ? exit code ${code} : signal ${signal}` is written out twice: `packages/daemon/src/daemon/executor.ts` `exitText` and `packages/daemon/src/client.ts` `startupReport`.
- `type Message = Readonly<Record<string, unknown>>` is declared three times: `packages/daemon/src/daemon/server.ts`, `packages/daemon/src/daemon/daemon-connection.ts` and `packages/daemon/src/client.ts`.

#### Test Coverage Gaps

Each row names the defect verbatim, the source it lives in, and the test it needs.

- G1 (MEDIUM, `packages/daemon/src/daemon/endpoint.ts`, AC7): "A start that finds its endpoint path held by a stale socket file never removes it, so no daemon starts for that worktree again after a kill." Test through the new seam, on both platforms, as the decision above describes. Also: "A refused connection to the endpoint is read as nothing there, so a stale socket file is never unlinked." `holderAfterConnectError("ECONNREFUSED")` is `"stale-file"`, and `"ENOENT"` is `"gone"`. Rewrite the `endpoint.ts` line under Deliberately Untested to cover only `removeStaleSocket`'s unlink.
- G2 (MEDIUM, `packages/daemon/test/harness.ts` `inTempDir`, AC5, AC6): "A test whose body passed but left a process holding its temp directory passes, and the directory stays in the system temp directory." Required: a passing body whose directory cannot be removed fails, naming the directory. A failing body keeps its own error, never masked by the cleanup's, so detections stay at the assertion. No run, baseline or mutated, leaves an `rt-test-daemon-*` directory once it ends: remove the ones a held process kept after the holder is gone, for example from a global teardown of the daemon project, or create them under one per-run parent that the teardown removes. Swallow nothing on Linux.
- G3 (LOW, `packages/daemon/test/daemon-harness.ts` `withDaemons`): "A daemon or executor still alive after the harness's final wait goes unreported." Fail when the final bounded wait returns false. Record workspace `b`'s executors as well as `a`'s, since a SIGKILLed daemon leaves them unwaited on Linux.
- G4 (MEDIUM, `packages/daemon/src/daemon/executor.ts`, AC4): "A lost executor's late exit settles the next job as lost, so a stored run is listed as unstored, each later reply settles the job after it, and the last is dropped." Fixed in review: `#exited`, `#lost` and the reply handler now act only for the current child. A test needs a job lost through a failed send or an `error` event, then the old child's exit while the next job runs. If no test can reach it without a production seam, record it under Deliberately Untested with that reason.
- G5 (re-anchor, `packages/daemon/test/defects.json`): the review's fixes moved two anchors. D1463: `old` `    this.#stopping ??= this.#stopSequence().finally(() => this.#markStopped());`, `new` `    this.#stopping = this.#stopSequence().finally(() => this.#markStopped());`. D1495: `old` `    if (this.#child !== child) return;\n    this.#child = undefined;\n    const settle = this.#settle;`, `new` `    if (this.#child !== child) return;\n    const settle = this.#settle;`. Re-prove both.
- G6 (LOW, `packages/daemon/src/daemon/endpoint.ts` `linuxRuntimeDirectory`, AC7): "A relative XDG_RUNTIME_DIR is used as the runtime directory, so a client and a daemon whose working directories differ look for the socket in different places." `clientEndpoint` with `XDG_RUNTIME_DIR` set to a relative path uses `<tmpdir>/rt-test-<uid>`.
- G7 (LOW, `packages/daemon/src/daemon/daemon-main.ts` `isStartupRequest`, AC2): "A first startup message that is not a confirmed start crashes the daemon with a raw TypeError instead of a refusal naming the message." Spawn the daemon entry with an IPC channel, send `{ "type": "start" }`, and expect a `refused` report whose reason says it is not a confirmed start.
- G8 (LOW, `packages/daemon/src/client.ts` `startedDaemon`, `abandon`, `isStartupReport`, AC2): "A start that fails after the spawn leaves the daemon running and executing tests its caller was told never started"; "A startup report of another shape is taken for a serving one"; "A start resolves with the identity of a daemon other than the one it spawned." Every route to these needs a daemon that misreports or outlives the startup deadline, as the `STARTUP_DEADLINE_MS` line under Deliberately Untested says. Extend that line to name them, or test them if a route exists.
- G9 (MEDIUM, `packages/daemon/src/vitest/confirmed-start.ts` `rootRelative`, AC11): "A confirmed start whose config file is written root-relative with `/`, as 1.3c will send it, is read as not confirmed, so the workspace never runs." Every test that expects a load builds its entry with `chosenConfigFile` itself. Assert that a hand-written `"packages/shown/vitest.config.mjs"` entry is `discovered` and loads (D1477's fixture has the marker).
- G10 (LOW, `packages/daemon/src/daemon/runtime-directory.ts` `runtimeDirectoryRefusal`, AC9): "A runtime directory path that is a regular file is accepted." There is no case with `isDirectory: false, link: false`.
- G11 (LOW, `packages/daemon/test/daemon.test.ts` D1485, AC1): the test passes when the client import throws partway, since `list-modules.mjs` prints what loaded on any exit. Assert the child's exit status and that the client's URL is listed.
- G12 (LOW, `packages/daemon/src/client.ts` `waitForExit`, AC5): "A stop resolves while the endpoint still accepts connections, because another listener took it after the daemon exited." Listen on the endpoint after the stop is acknowledged, and expect the stop to keep waiting (the stop deadline's rejection may stay untested).
- G13 (LOW, `packages/daemon/src/daemon/lifecycle.ts` `#startSequence`, AC11, AC4): "A workspace the discovery lists as not confirmed is run, or listed as unstored." Script a discovery of `discovered(a)` and a not-confirmed `b`, with only `a` confirmed. Expect runs `["a"]` and no unstored job.
- G14 (LOW, `packages/daemon/src/daemon/server.ts` `versionedAnswer`, AC8): "A request after the hello that carries no protocol version is answered." Send a hello, then `{"type":"status"}`, and expect `invalid-request`.
- G15 (LOW, `packages/daemon/src/daemon/server.ts` `closeConnections`, AC5): "A client that stops reading holds the stop past the close grace." A client that never reads while the daemon writes to it, then `closeConnections`, and its socket is closed within about `CLOSE_GRACE_MS`.

### Completion Notes

Built by dev (threadId 08571045-d0bc-485e-8cd6-cc91035c1d55) on 2026-09-26, after 1.3b's b1be8cb.

**Sanity check.** Four findings went to the author (rt-t1-3-create), which confirmed all four and updated the ticket before any code: F1, the confirmed-config match at every load; F2, a stop during a stop joins it; F3, the startup and stop deadlines; F4, `BUSY_TIMEOUT_MS` exported. **Assumptions.** U1 and U2 were confirmed (see the resolutions under the table).

**Decisions recorded here, code-only:**

- `BUSY_TIMEOUT_MS` moved to `store/schema.ts`, and `open-store.ts` imports it, in place of the one-word export F4 named. The client's deadlines and `RESPONSE_BOUND_MS` need it, and `open-store.ts` imports `node:sqlite`, which the client's module graph must not load.
- Files beyond the ticket's list, each by responsibility:
  - `vitest/confirmed-start.ts`: the `ConfirmedStart` types, `chosenConfigFile` (for 1.3c's start plan) and the match every load passes through. It is declared beside discovery and loads no Vitest, so the client can use it.
  - `daemon/executor-jobs.ts`: the daemon-to-executor messages and `EXECUTOR_BOUND_MS`.
  - `daemon/daemon-connection.ts`: the client's line-reading request helper.
  - `daemon/runtime-directory.ts`: the Linux runtime-directory check and the lock.
  - `daemon/entry-point.ts` and `daemon/source-hooks.ts`: a daemon or executor entry runs from `dist` as `.js`. From source, as in tests, it runs as `.ts` with `--conditions=development` and a resolve hook that maps this repository's relative `.js` imports to `.ts`. The hook uses `registerHooks`, Node 22.15 and later.
- The frozen stop acknowledgement carries `logFile` beside `pid`, so a `stopDaemon` of any version can name the log when its deadline passes. Frozen objects may gain fields, never lose them.
- The daemon's and the executor's working directory is the consumer root, whoever called `startDaemon`. The client resolves a relative consumer root first. Each discovery and run of a workspace then runs in that workspace's directory (AC13).
- AC13 evidence (Windows, Node 24.19.0, Vitest 5.0.1): a root workspace and `packages/b`, each with a config that throws at load unless `process.cwd()` is its own directory, and a test asserting the same. Both were discovered, and both runs were stored with the test passed. Under the consumer-root cwd, `packages/b` would have failed. `bun x oxlint` and the daemon typecheck (no error outside `test/`) re-ran after the change.
- The Linux lock file is created by hard-linking a fully written temporary file, so it never exists empty. A stale lock is moved aside under the taking process's own name and checked, so of two racing starts only one takes it. The runtime-directory check (`lstat`, owner, mode 0700, no symbolic link) runs in the client before it connects, as well as in the daemon before it listens.
- The endpoint is taken before the store is opened, the ticket's order.

**Evidence (Step 7).** Smokes ran from source, with probes under `_agent-docs/.scratch/1-3-dev/` (since removed), on Windows 11 with Node 24.19.0 and in WSL Ubuntu 24.04 with Node 24.19.0 and 22.23.3, over Vitest 5.0.1, after the adversarial fixes:

- On the `consumer` fixture:
  - A start without `trusted` was refused.
  - A start resolved in 150 to 460 ms, before discovery ended, with pid, identities, state directory, log file and protocol version.
  - A second start was refused, naming the pid.
  - Discovery stored an unconfirmed workspace as `not-confirmed` ("not confirmed at start"), and the log named a confirmed workspace that was not found.
  - Every run was stored with adapter version 3, not fingerprinted.
  - Two concurrent stops both resolved in about 105 to 120 ms.
  - Status and stop afterwards were refused, naming the root.
- Raw lines: invalid JSON, a status before the hello, a line over 1 MiB and an unknown request each got their error code, and a valid hello on the same connection was answered.
- Cross-version: a hello of another version got the frozen mismatch error, with both versions and the pid. The next non-stop line closed the connection, and the frozen stop on it stopped the daemon.
- Interruptions:
  - A stop mid-run stored the run `interrupted` in about 110 ms.
  - A config file added to a confirmed workspace during an earlier run made that run load nothing, listed in status with its reason.
  - An executor killed mid-run was logged and nothing was stored for that job, and the next workspace ran.
  - A synchronous loop in `globalSetup` was ended at 15 000 ms after the stop, stored nothing, and the daemon exited; status still answered while it was stuck.
  - A daemon killed without a stop took its executor with it within 121 ms.
- Linux:
  - `SIGTERM` mid-run stopped the daemon and removed the socket.
  - After `SIGKILL` the socket file remained, status and stop reported no daemon, and a new start succeeded.
  - An overlong runtime-directory path and a mode-755 runtime directory were refused before spawning.
  - The lock: a live holder refused naming its pid, a dead pid's lock was taken over, and an empty lock refused.
- Module graph: the client entry loads neither `node:sqlite` nor any Vitest module. The package index loads `node:sqlite` and no Vitest module.
- Network: only `daemon/endpoint.ts` imports `node:net` at run time, and no daemon module imports `http`, `https`, `dgram` or `tls`, or calls `fetch`.

**Gates.**

- `bun x oxlint` over all 25 changed or created files exits 0 with no warning, and `bun x prettier --check` is clean.
- `bun run --filter @rt-test/daemon typecheck` has no error outside `packages/daemon/test/`. Its five errors are in the three test files listed under Test Files This Change Broke.
- The root `bun x tsc --noEmit` exits 0.
- `node scripts/check-line-citations.mjs` is clean.

**Adversarial review.** 17 findings. 14 were fixed:

- The lock race.
- The client-side runtime-directory check.
- The daemon's working directory.
- Activity left `discovering` after a failed discovery.
- The executor's `error` listener and send callback.
- A catch in the daemon entry that reports a refusal, and endpoint-before-store.
- The stop-timeout wording.
- A close grace for connections.
- A mismatched connection closed on any non-stop line.
- The response-bound comment.
- A timed-out client connection closed.
- A skipped workspace listed as unstored.
- A start whose root disagrees with the daemon's argument refused.
- Named startup-channel constants.

Discarded:

- F7, 108 bytes off by one: the spike measured a 108-byte path listening and connecting on Node 22 and 24, and Linux fills `sun_path` without a NUL.
- F8, the discovery reason for a changed config: AC11 prescribes "not confirmed at start" for each such workspace.
- F17, the reason kept in the `error` column: the ticket rules no schema change, and the adapter version was raised.

**Change-request candidates** (for review-changes):

1. Resolved (orchestrator, 19:26): which working directory Vitest sees. Built as AC13; see the grill record, A4.
2. `consumerRoot` in status and in the result of `startDaemon` is the absolute root the client resolved, in platform separators, while the identities are `/`-separated real paths. 1.3c may want one form for display.

**README.** User-visible behavior changed: a daemon now starts and stops through a programmatic client. The Status sentence and the `docs/architecture.md` text went to the orchestrator as exact text, since those files are the orchestrator's.

### File List

Created:

- `packages/daemon/src/client.ts`
- `packages/daemon/src/daemon/daemon-connection.ts`
- `packages/daemon/src/daemon/daemon-log.ts`
- `packages/daemon/src/daemon/daemon-main.ts`
- `packages/daemon/src/daemon/endpoint.ts`
- `packages/daemon/src/daemon/entry-point.ts`
- `packages/daemon/src/daemon/executor-jobs.ts`
- `packages/daemon/src/daemon/executor-main.ts`
- `packages/daemon/src/daemon/executor.ts`
- `packages/daemon/src/daemon/lifecycle.ts`
- `packages/daemon/src/daemon/protocol.ts`
- `packages/daemon/src/daemon/runtime-directory.ts`
- `packages/daemon/src/daemon/server.ts`
- `packages/daemon/src/daemon/source-hooks.ts`
- `packages/daemon/src/vitest/confirmed-start.ts`

Modified:

- `packages/daemon/package.json`
- `packages/daemon/src/store/open-store.ts`
- `packages/daemon/src/store/read-discovery.ts`
- `packages/daemon/src/store/schema.ts`
- `packages/daemon/src/store/write-discovery.ts`
- `packages/daemon/src/vitest/adapter-version.ts`
- `packages/daemon/src/vitest/discover-tests.ts`
- `packages/daemon/src/vitest/run-workspace.ts`
- `packages/daemon/src/vitest/workspace-session.ts`
- `_agent-docs/tickets/1-3-daemon-lifecycle.md` (dev's sections)

No dependency changed.

Planning files the create-ticket run wrote:

- `_agent-docs/tickets/1-3-daemon-lifecycle.md` (created)
- Held for the orchestrator's go, as exact text: `_agent-docs/sprint-status.yaml` (the split's three keys, 1.3 at `ready-for-dev`), the sprint file's objective sentence and its 1.3, 1.3b and 1.3c sections, and the FR2, FR4 and NFR4 marker relinks (`docs/requirements.md`).

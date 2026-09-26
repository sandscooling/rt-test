# Sprint 1: Queryable results

**Milestone:** M1

Capture Vitest runs from every workspace of a consumer, persist them, and answer queries about them from a daemon the user starts explicitly. Nothing runs on edits yet and no input is fingerprinted, so every result's freshness is honestly unknown; Sprint 2 makes results current. The sprint comes first because every later milestone, falsification included, reads the test identities, states, and store it builds, and those must hold on Fleet Cooling's Vitest 4.1 as well as 5.x.

The local IPC transport spike on Windows and Linux, a named pipe and a Unix socket in a user-only runtime directory, is recorded in ticket 1.3's Dev Notes. The observed Vitest 4.1 and 5 API facts that tickets 1.1 and 1.1b rest on are recorded in ticket 1.1's Dev Notes. Ticket 1.2 raises the Node floor to `^22.13.0`, where `node:sqlite` needs no flag (observed on Node 22.13.0 in ticket 1.2's Dev Notes), and updates the README's Develop line with it.

## Ticket 1.1: Discover tests across Vitest workspaces

Scope: find every Vitest workspace of a consumer, load each one's own Vitest 4.1.x or 5.x, and discover every test, each `it.each` arm included, with a stable identity. Requirements: FR1. Ticket file: [1-1-capture-vitest-runs](../tickets/1-1-capture-vitest-runs.md)

## Ticket 1.1b: Record Vitest run states

Scope: run a Vitest workspace and record each test's outcome, skips, collection and module errors, unhandled run-level errors, worker crashes, and interruptions as distinct states, on Vitest 4.1.x and 5.x. Requirements: FR2. Ticket file: [1-1b-record-run-states](../tickets/1-1b-record-run-states.md)

Ticket 1.1 was estimated at 40 files against the 20-file limit, so it was split by requirement: 1.1 delivers FR1's discovery and identity, and 1.1b delivers FR2's run states on top of them. 1.1b therefore follows 1.1 and reuses its workspace loading, version gate, and identity. Neither part's files are named by another unbuilt ticket; ticket 1.2 persists what 1.1b records.

## Ticket 1.2: Persist runs and results

Scope: store runs and discoveries in `node:sqlite` bound to project, worktree, run identity, input fingerprint, and adapter version, each visible atomically, with a versioned schema and state only under the local state directory; raise the Node floor to `^22.13.0`. Requirements: FR3, NFR4, NFR5. Ticket file: [1-2-persist-results](../tickets/1-2-persist-results.md)

## Ticket 1.3: Daemon lifecycle and local protocol

Scope: start one background daemon per worktree through `@rt-test/daemon`'s client. The daemon discovers, runs and stores every workspace once, hosts Vitest in an executor child process, serves a versioned, line-framed protocol only to the user who started it, and stops cleanly. Requirements: FR4, NFR4. Ticket file: [1-3-daemon-lifecycle](../tickets/1-3-daemon-lifecycle.md)

## Ticket 1.3b: Run safety

Scope: daemon runs and discovery write nothing into the consumer's tree, with coverage off, snapshot update set to none and Vitest's results and module caches off whatever the consumer's config says, and each workspace's config loaded without a temporary file, apart from four documented exceptions under `node_modules` (ticket 1.3b's Dev Notes § Known limits). A named-defect test proves this on Vitest 4.1 and 5 over a consumer fixture, `node_modules` included. Discovery can be interrupted, and 10 s after an interrupt (a named constant) Vitest is force-stopped, which the run records and the store keeps. Requirements: FR2, NFR4. Ticket file: [1-3b-run-safety](../tickets/1-3b-run-safety.md)

A test stuck in a synchronous loop keeps an interrupted run from ending, since Vitest's graceful cancel waits for the running test, and discovery and runs share one queue. A second cancel ends such a run, or a discovery stuck at module load, within about 10 ms on both Vitest versions and both pools (ticket 1.3's Dev Notes § Spike facts). The force-stop skips the consumer's `afterAll` and teardown, so the run records that it happened (orchestrator, 2026-09-26 13:45). Without the overrides a run writes Vitest's results cache under `node_modules`, writes snapshot files, and rewrites a test file for an inline snapshot (same spike). With them, Vite's default config loader still leaves an empty `node_modules/.vite-temp/`, so the config is loaded without a temporary file (ticket 1.3b's Dev Notes § Spike facts). The spike found no API token file with the API off; the named-defect test keeps checking (orchestrator, 13:45).

## Ticket 1.3c: Start and stop CLI

Scope: `packages/cli` with `rt-test start [root]` and `rt-test stop [root]` through ticket 1.3's client, with `--state-dir` (default `.rt-test` under the root) and versioned `--json` output. On a TTY, the start names the root and every Vitest config it will load, says that each workspace's config, `globalSetup`, setup files and test modules will execute, and asks y/N every time. Without a TTY it refuses unless `--trust` is passed. Trust is never persisted and never read from the consumer tree (owner ruling 2026-09-26 13:44). The start passes exactly the workspaces and config files it showed to `startDaemon`, and the daemon loads no other (orchestrator, 2026-09-26 16:24; ticket 1.3 AC11). Requirements: FR4. Ticket file: [1-3c-start-stop-cli](../tickets/1-3c-start-stop-cli.md)

Ticket 1.3 was estimated at about 36 raw files, 47 estimated, against the 20-file limit. It was split by outcome (orchestrator, 2026-09-26 13:45): 1.3 is a daemon that starts, serves, runs and stops; 1.3b is runs that never write into the consumer and never hang a stop; 1.3c is the user's explicit, trusted start. 1.3b and 1.3 follow ticket 1.2, whose store both use, and 1.3b adds its force-stop field to that store. 1.3b lands before 1.3, so the daemon's first runs already keep the consumer's tree unwritten (orchestrator, 13:55). 1.3's executor bound derives from 1.3b's grace constant. 1.3c follows 1.3, whose client it calls. Ticket 1.4 adds `summary` and `status` to 1.3c's CLI.

Ticket 1.3 (unbuilt) names `packages/daemon/src/index.ts` and `packages/daemon/package.json`, which 1.2 also writes: 1.2 landing first makes 1.3 safer. 1.3b writes `packages/daemon/src/vitest/workspace-session.ts`, `run-workspace.ts` and `discover-tests.ts`, which no other unbuilt ticket writes, and 1.2's store files after 1.2 lands.

## Ticket 1.4: Query CLI

Scope: `summary` and `status <path>` with counts per state for files and folders through versioned `--json` output on stdout, failing with a reason rather than answering empty, and never starting a test. Requirements: FR5. Ticket file: [1-4-query-cli](../tickets/1-4-query-cli.md)

This ticket counts from ticket 1.2's store: stored runs, and the worktree's latest discovery for never-run and unknown tests (C132). The store keeps an explicit not-fingerprinted value, which this ticket's queries map to an absent fingerprint before `assessEvidence`. A stored run or discovery whose adapter version differs from the daemon's current Vitest adapter version is reported as not current, since it was recorded under another meaning (C124).

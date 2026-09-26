# Sprint 1: Queryable results

**Milestone:** M1

Capture Vitest runs from every workspace of a consumer, persist them, and answer queries about them from a daemon the user starts explicitly. Nothing runs on edits yet and no input is fingerprinted, so every result's freshness is honestly unknown; Sprint 2 makes results current. The sprint comes first because every later milestone, falsification included, reads the test identities, states, and store it builds, and those must hold on Fleet Cooling's Vitest 4.1 as well as 5.x.

Ticket 1.3 opens with a spike on the local IPC transport on Windows and Linux, since its design rests on facts nobody has observed. The observed Vitest 4.1 and 5 API facts that tickets 1.1 and 1.1b rest on are recorded in ticket 1.1's Dev Notes. Ticket 1.2 raises the Node floor to `^22.13.0`, where `node:sqlite` needs no flag (per the Node documentation's module history), and updates the README's Develop line with it.

## Ticket 1.1: Discover tests across Vitest workspaces

Scope: find every Vitest workspace of a consumer, load each one's own Vitest 4.1.x or 5.x, and discover every test, each `it.each` arm included, with a stable identity. Requirements: FR1. Ticket file: [1-1-capture-vitest-runs](../tickets/1-1-capture-vitest-runs.md)

## Ticket 1.1b: Record Vitest run states

Scope: run a Vitest workspace and record each test's outcome, skips, collection and module errors, unhandled run-level errors, worker crashes, and interruptions as distinct states, on Vitest 4.1.x and 5.x. Requirements: FR2. Ticket file: [1-1b-record-run-states](../tickets/1-1b-record-run-states.md)

Ticket 1.1 was estimated at 40 files against the 20-file limit, so it was split by requirement: 1.1 delivers FR1's discovery and identity, and 1.1b delivers FR2's run states on top of them. 1.1b therefore follows 1.1 and reuses its workspace loading, version gate, and identity. Neither part's files are named by another unbuilt ticket; ticket 1.2 persists what 1.1b records.

## Ticket 1.2: Persist runs and results

Scope: store runs and results in `node:sqlite` bound to project, worktree, run identity, input fingerprint, and adapter version, with runs visible atomically, a versioned schema, and state only under the local state directory; raise the Node floor to `^22.13.0`. Requirements: FR3, NFR4, NFR5.

## Ticket 1.3: Daemon lifecycle and local protocol

Scope: start and stop the daemon explicitly for one trusted project, executing no project code before that start, and serve a versioned, framed local protocol bound to loopback or a local socket. Requirements: FR4, NFR4.

Ticket 1.1's test discovery executes project code, so this ticket's start is its only production caller: the daemon discovers tests only after the explicit start of a trusted project. Discovery runs each workspace's Vitest `globalSetup`, as `vitest list` does, so the start's trust prompt covers that setup code as well as config loading (owner ruling 2026-09-26). Ticket 1.1b's run executes project code the same way, with no trust check of its own, so this start is its only production caller too, and its shutdown interrupts a running run.

While a discovery holds a Vitest instance open, Vitest's logger holds `SIGINT`, `SIGTERM`, `exit` and `unhandledRejection` handlers that exit the process, and discovery rewrites the host's `process.env` until it restores it; the start runs discovery where neither reaches other daemon work. On Vitest 5, a browser-mode project makes `createVitest` listen on a port and call the provider's prewarm before discovery rejects the project.

## Ticket 1.4: Query CLI

Scope: `summary` and `status <path>` with counts per state for files and folders through versioned `--json` output on stdout, failing with a reason rather than answering empty, and never starting a test. Requirements: FR5.

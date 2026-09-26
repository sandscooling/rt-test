# Sprint 1: Queryable results

**Milestone:** M1

Capture Vitest runs from every workspace of a consumer, persist them, and answer queries about them from a daemon the user starts explicitly. Nothing runs on edits yet and no input is fingerprinted, so every result's freshness is honestly unknown; Sprint 2 makes results current. The sprint comes first because every later milestone, falsification included, reads the test identities, states, and store it builds, and those must hold on Fleet Cooling's Vitest 4.1 as well as 5.x.

Tickets 1.1 and 1.3 each open with a spike, since their design rests on facts nobody has observed: the installed Vitest reporter and programmatic APIs on 4.1 and 5 and how they identify `it.each` arms (1.1), and the local IPC transport on Windows and Linux (1.3). Ticket 1.2 raises the Node floor to `^22.13.0`, where `node:sqlite` needs no flag (per the Node documentation's module history), and updates the README's Develop line with it.

## Ticket 1.1: Capture Vitest runs across workspaces

Scope: discover every test of each Vitest workspace on Vitest 4.1.x and 5.x with a stable identity, and record each run's outcomes, skips, collection, module and run-level errors, and interruptions as distinct states. Requirements: FR1, FR2.

## Ticket 1.2: Persist runs and results

Scope: store runs and results in `node:sqlite` bound to project, worktree, run identity, input fingerprint, and adapter version, with runs visible atomically, a versioned schema, and state only under the local state directory; raise the Node floor to `^22.13.0`. Requirements: FR3, NFR4, NFR5.

## Ticket 1.3: Daemon lifecycle and local protocol

Scope: start and stop the daemon explicitly for one trusted project, executing no project code before that start, and serve a versioned, framed local protocol bound to loopback or a local socket. Requirements: FR4, NFR4.

## Ticket 1.4: Query CLI

Scope: `summary` and `status <path>` with counts per state for files and folders through versioned `--json` output on stdout, failing with a reason rather than answering empty, and never starting a test. Requirements: FR5.

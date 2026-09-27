# Sprint 2: Fresh results and runs

**Milestone:** M1

Make the daemon run tests on edits and answer with current results, so agents on Fleet Cooling stop running tests themselves. Selection stays at workspace granularity: the edited workspace plus every workspace that depends on it, with configuration, setup, and lockfile edits as named broad fallbacks. That is coarse but correct, since it only widens, and a Convex edit then costs about its three-minute workspace run instead of the seven-minute chain an agent runs today. File-level selection and the Convex adapter wait for M3, after falsification, because falsification offloads a whole agent loop sooner.

The sprint's correctness targets are requirements measured over a controlled edit corpus: no duplicate execution (NFR1) and no failure a full run finds that the selected run misses (NFR2). The Fleet Cooling trial follows the sprint, started by the owner with RT Test's state directory outside that checkout.

## Ticket 2.1: Track inputs and invalidate

Scope: watch saved inputs, fingerprint them, and mark every result an edit could affect as stale, reconciling after start, missed events, and branch changes before any result is reported current. Requirements: FR6, NFR3. Ticket file: [2-1-track-inputs](../tickets/2-1-track-inputs.md)

## Ticket 2.1b: Declared non-inputs

Scope: let the consumer declare files no test reads, such as documentation, in a list committed in the consumer and shown in the start plan. An edit to a declared file then changes no fingerprint and selects nothing, and a change to the list itself reconciles every input. Ticket 2.1 counts every file git does not ignore as an input, so until this lands a README edit stales every result (owner, 2026-09-27 10:08). It follows 2.1 and lands before the Fleet Cooling trial. Requirements: FR6. Ticket file: [2-1b-declared-non-inputs](../tickets/2-1b-declared-non-inputs.md)

## Ticket 2.2: Workspace-level selection

Scope: select each change's tests at workspace granularity from declared dependency information (package manifests, discovered test modules, setup files and config aliases), widening on uncertainty, with a reason per test, each broad fallback's trigger, and selected and total counts. Requirements: FR7, NFR2. Ticket file: [2-2-workspace-selection](../tickets/2-2-workspace-selection.md)

## Ticket 2.2b: Undeclared cross-workspace edges

Scope: find statically the cross-workspace dependencies no `package.json` declares (relative and bare source imports, tsconfig `extends`, `references` and `paths`, and `package.json` `imports`), widening on any file it cannot read or parse and naming the kinds it cannot see as known limits until M3. It builds after 2.2, and 2.3 waits for it, so selection never runs without it (owner, 2026-09-26 18:07). Requirements: FR7, NFR2. Ticket file: [2-2b-undeclared-edges](../tickets/2-2b-undeclared-edges.md)

## Ticket 2.3: Schedule and run selections

Scope: run every selection in the daemon with debounce and deduplication, never re-executing a test that holds a current result, and invalidate and rerun a run whose inputs changed while it ran, leaving explicit interrupted states. Discovery reports each workspace's resolved setup files and config aliases, which ticket 2.2's selection takes as required inputs, and each workspace that cannot run (not confirmed at start, unsupported) is passed with its reason, so no selection runs it and every explanation and count stays true (orchestrator, 2026-09-26 18:07 and 18:22). It builds after 2.2 and 2.2b. Discovery converts Vitest's absolute setup and global setup paths to root-relative ones, credits the root config's `globalSetup` to each Vitest 5 project that extends the root config (Vitest 5 drops it from that project's resolved config), passes a RegExp alias `find` as its source text, and makes selection widen on an alias with a `customResolver` or a `find` of `/`, whose replacement is not the final import. Selection runs in a disposable child process, so a consumer file that crashes the source parser fails that one selection with a reason instead of ending the daemon (orchestrator, 2026-09-27 01:27; ticket 2.2b). Ticket 2.1 fingerprints every Vitest workspace over the whole project's inputs; this ticket narrows each workspace's fingerprint to the inputs whose selection includes it, from the same dependency information its selection uses, so staleness and selection never disagree, and each workspace's narrowed inputs always include its own test modules (ticket 2.1 AC11; orchestrator, 2026-09-27 10:44). It adds each workspace's setup and global setup files, as discovery reports them, to the files a declared non-input pattern cannot remove from the inputs (ticket 2.1b AC4; owner, 2026-09-27 11:10), and every file matching a workspace's test include patterns, as discovery reports them, so a new test module under a declared pattern is still discovered (orchestrator, 2026-09-27 11:24). It fills SelectionInput's protected test-module set from `discoveredTestModules` over the same discovery the tracker reads (ticket 2.1b; orchestrator, 2026-09-27 15:23). It turns a job 2.1 stores not fingerprinted, because an input changed or an event named one while it ran, into its invalidated state and reruns it (orchestrator, 2026-09-27 10:08). Requirements: FR8, NFR1.

## Ticket 2.4: Wait for files

Scope: `wait <files>` binds to the input revision at the call and returns once every covering test has a current result or an explicit non-current state, or as superseded, naming the newer revision, when a covering input changes after the call. Requirements: FR9.

## Ticket 2.5: Controlled edit corpus

Scope: a committed synthetic multi-workspace fixture and a set of edits to it, with a check that runs each edit's selection and a full run over the same input snapshot, and fails on any failure the full run finds that the selection missed (NFR2) or any test run again while it held a current result (NFR1). It is the measure the sprint's correctness targets are read from, so it follows 2.3 and 2.4 (orchestrator, 2026-09-26 18:22). Requirements: NFR1, NFR2.

## Ticket 2.6: Changes since a cursor

Scope: a `changes` query through the JSON CLI that names each test whose state or freshness changed since a cursor the previous answer returned, scoped to given paths by the dependency information selection uses, with counts for what it leaves out, answering from the store without starting a test. The delta logic lives here, generic to any agent harness, so the hook only parses its harness's payload (P31). It builds after 2.4, whose input revision the cursor binds to (owner, 2026-09-27 14:19; orchestrator, 2026-09-27 14:24). Requirements: FR20.

## Ticket 2.7: Agent feedback hook

Scope: a CLI subcommand a consumer installs as a Claude Code hook, running after each tool call, that collects the files the session edited, asks `changes` for the tests covering them since its last report, and adds only what changed to the agent's context, failing open within a time bound. It speaks after a tool call only when a test covering files the session edited changed state or freshness since the last report, and at turn end adds one non-blocking line while tests covering its edits are still stale or failing. It names at most 5 tests, each with its file, test name and first failure line capped at about 200 characters, gives counts for the rest and one count line for failures elsewhere in the worktree, and prints no stacks. When no daemon answers for the worktree it says so once per session and never falls silent. After a Bash call, which names no file, it uses the paths the session has edited so far. It is opt-in: the consumer adds one settings line, and RT Test never installs it. It measures its end-to-end p95 against the 100 ms CLI target, labeled a target until measured. This repository wires it only after this ticket lands, in one worktree whose daemon the owner starts, before the Fleet Cooling trial (owner and orchestrator, 2026-09-27 14:24). It builds after 2.6. Requirements: FR20.

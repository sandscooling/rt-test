# Sprint 2: Fresh results and runs

**Milestone:** M1

Make the daemon run tests on edits and answer with current results, so agents on Fleet Cooling stop running tests themselves. Selection stays at workspace granularity: the edited workspace plus every workspace that depends on it, with configuration, setup, and lockfile edits as named broad fallbacks. That is coarse but correct, since it only widens, and a Convex edit then costs about its three-minute workspace run instead of the seven-minute chain an agent runs today. File-level selection and the Convex adapter wait for M3, after falsification, because falsification offloads a whole agent loop sooner.

The sprint's correctness targets are requirements measured over a controlled edit corpus: no duplicate execution (NFR1) and no failure a full run finds that the selected run misses (NFR2). The Fleet Cooling trial follows the sprint, started by the owner with RT Test's state directory outside that checkout.

## Ticket 2.1: Track inputs and invalidate

Scope: watch saved inputs, fingerprint them, and mark every result an edit could affect as stale, reconciling after start, missed events, and branch changes before any result is reported current. Requirements: FR6, NFR3.

## Ticket 2.2: Workspace-level selection

Scope: select each change's tests at workspace granularity from declared dependency information (package manifests, discovered test modules, setup files and config aliases), widening on uncertainty, with a reason per test, each broad fallback's trigger, and selected and total counts. Requirements: FR7, NFR2. Ticket file: [2-2-workspace-selection](../tickets/2-2-workspace-selection.md)

## Ticket 2.2b: Undeclared cross-workspace edges

Scope: find statically the cross-workspace dependencies no `package.json` declares (relative and bare source imports, tsconfig `extends`, `references` and `paths`, and `package.json` `imports`), widening on any file it cannot read or parse and naming the kinds it cannot see as known limits until M3. It builds after 2.2, and 2.3 waits for it, so selection never runs without it (owner, 2026-09-26 18:07). Requirements: FR7, NFR2. Ticket file: [2-2b-undeclared-edges](../tickets/2-2b-undeclared-edges.md)

## Ticket 2.3: Schedule and run selections

Scope: run every selection in the daemon with debounce and deduplication, never re-executing a test that holds a current result, and invalidate and rerun a run whose inputs changed while it ran, leaving explicit interrupted states. Discovery reports each workspace's resolved setup files and config aliases, which ticket 2.2's selection takes as required inputs, and each workspace that cannot run (not confirmed at start, unsupported) is passed with its reason, so no selection runs it and every explanation and count stays true (orchestrator, 2026-09-26 18:07 and 18:22). It builds after 2.2 and 2.2b. Discovery converts Vitest's absolute setup and global setup paths to root-relative ones, credits the root config's `globalSetup` to each Vitest 5 project that extends the root config (Vitest 5 drops it from that project's resolved config), passes a RegExp alias `find` as its source text, and makes selection widen on an alias with a `customResolver` or a `find` of `/`, whose replacement is not the final import. Selection runs in a disposable child process, so a consumer file that crashes the source parser fails that one selection with a reason instead of ending the daemon (orchestrator, 2026-09-27 01:27; ticket 2.2b). Requirements: FR8, NFR1.

## Ticket 2.4: Wait for files

Scope: `wait <files>` binds to the input revision at the call and returns once every covering test has a current result or an explicit non-current state, or as superseded, naming the newer revision, when a covering input changes after the call. Requirements: FR9.

## Ticket 2.5: Controlled edit corpus

Scope: a committed synthetic multi-workspace fixture and a set of edits to it, with a check that runs each edit's selection and a full run over the same input snapshot, and fails on any failure the full run finds that the selection missed (NFR2) or any test run again while it held a current result (NFR1). It is the measure the sprint's correctness targets are read from, so it follows 2.3 and 2.4 (orchestrator, 2026-09-26 18:22). Requirements: NFR1, NFR2.

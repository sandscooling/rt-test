# Sprint 2: Fresh results and runs

**Milestone:** M1

Make the daemon run tests on edits and answer with current results, so agents on Fleet Cooling stop running tests themselves. Selection stays at workspace granularity: the edited workspace plus every workspace that depends on it, with configuration, setup, and lockfile edits as named broad fallbacks. That is coarse but correct, since it only widens, and a Convex edit then costs about its three-minute workspace run instead of the seven-minute chain an agent runs today. File-level selection and the Convex adapter wait for M3, after falsification, because falsification offloads a whole agent loop sooner.

The sprint's correctness targets are requirements measured over a controlled edit corpus: no duplicate execution (NFR1) and no failure a full run finds that the selected run misses (NFR2). The Fleet Cooling trial follows the sprint, started by the owner with RT Test's state directory outside that checkout.

## Ticket 2.1: Track inputs and invalidate

Scope: watch saved inputs, fingerprint them, and mark every result an edit could affect as stale, reconciling after start, missed events, and branch changes before any result is reported current. Requirements: FR6, NFR3.

## Ticket 2.2: Workspace-level selection

Scope: select each change's tests at workspace granularity across dependent workspaces, widening on uncertainty, with a reason per test, each broad fallback's trigger, and selected and total counts. Requirements: FR7, NFR2.

## Ticket 2.3: Schedule and run selections

Scope: run every selection in the daemon with debounce and deduplication, never re-executing a test that holds a current result, and invalidate and rerun a run whose inputs changed while it ran, leaving explicit interrupted states. Requirements: FR8, NFR1.

## Ticket 2.4: Wait for files

Scope: `wait <files>` binds to the input revision at the call and returns once every covering test has a current result or an explicit non-current state, or as superseded, naming the newer revision, when a covering input changes after the call. Requirements: FR9.

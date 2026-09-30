# Sprint 3: Falsification

**Milestone:** M2

Take falsification off coding agents. The daemon reads the defect definitions a consumer commits, falsifies each defect whose test currently passes, and answers which defects have current evidence that their test detects them, which cannot run and why, and which tests have no defect. Today an agent on Fleet Cooling writes a mutation spec, runs `scripts/falsify.mjs`, reads its verdicts and repeats that for every test it adds; after this sprint the daemon does it at lower priority than ordinary tests and re-verifies a defect whenever its inputs change. It ports `falsify.mjs` with its file writes replaced by in-memory transforms in one reused Vitest instance per job (ADR-0003, ADR-0007), its message classifier replaced by Vitest's recorded task facts confirmed per Vitest version by canary fixtures (ADR-0008), and its per-run spec replaced by definitions committed in the consumer (ADR-0004, ADR-0009).

The roadmap's first spike, plugin transforms under Vitest 4.1, held on 4.1.11 and 5.0.1 on 2026-09-30 (ADR-0007, ADR-0008). A second spike that day showed a reach probe recording, on both lines, exactly which test executed the mutated site, so a test that fails an assertion without executing it is never credited (orchestrator, 17:43, on module-level reach). Two spike questions remain and open the tickets that rest on them: 3.2 checks the module id spelling a transform receives on Windows under each Vitest line, and the stale-transform guard on 4.1, which was measured only on 5.0.1; 3.6 checks how the bundled canaries run under a workspace's Vitest from the state directory.

Evidence freshness has workspace granularity (ADR-0007): an edit anywhere in a workspace's inputs stales every defect in it, and M3's file-level dependencies narrow that. Fleet Cooling commits no defect definitions today (its mutation specs live in change records), so the M2 trial there needs definitions written in its repository first, in ADR-0009's format.

Order: 3.1 and 3.2 build in parallel, since 3.1 works in the daemon's query, protocol and CLI and 3.2 in its Vitest session and executor. 3.3 follows 3.2, whose experiment records it judges. 3.4 follows 3.1 and 3.3, storing 3.3's verdicts against 3.1's definitions. 3.5 follows 3.4, since a scheduled job stores evidence. 3.6 follows 3.5, gating the job 3.5 starts. 3.7 comes last and measures the milestone's acceptance. Each ticket is estimated at 25 files or fewer.

## Ticket 3.1: Defect definitions and gaps

Scope: read the definition files `rt-test.json`'s `defects` member lists, validate each definition, resolve its test against the latest discovery and its anchor against the file as it is now, and answer `rt-test defects` with each definition's state (never verified, anchor missing, or invalid with its reason), the counts, and the tests no definition names as gaps, bounded like the other answers and without starting a test. Requirements: FR12, FR13, FR14, FR22, FR24.

## Ticket 3.2: Transform experiments in a reused instance

Scope: a falsification job in the daemon's executor loads one Vitest instance for a workspace with RT Test's mutation plugin, runs the intended tests' modules as a baseline, each defect's experiment alone, and the restored baseline, behind the stale-transform guard; the plugin places a reach probe at each mutated site, or records that none can be placed, and a setup file RT Test places first marks each test that executed it; the job reads each run's facts only from the modules it executed and returns one raw record per experiment, on Vitest 4.1 and 5, leaving every consumer file byte-identical. Requirements: FR10, FR11, NFR6.

## Ticket 3.3: Verdicts from run facts

Scope: turn each experiment record into the facts ADR-0008 names (the intended test's state by stable identity, its error kinds including declared ones, hook states, module, suite and unhandled errors, whether the mutated site executed during that test, and both baselines), decide detected, survived, invalid experiment or unclear from them alone, and confirm each would-be detection by one confirming run in the same instance, over canary fixtures committed for both Vitest lines that each fail in one known way, including a test that fails an assertion without executing the mutated site. Requirements: FR11, NFR7.

## Ticket 3.4: Defect evidence

Scope: store each verdict with its facts in the local store, bound to the definition's digest, the workspace's input fingerprint, the Vitest version and the falsifier version, keep it across a restart as unconfirmed until reconciliation, and extend `rt-test defects` and the summary with each defect's evidence state, its freshness, and the verified, eligible and total counts. Requirements: FR12, FR15, FR22.

## Ticket 3.5: Schedule falsification

Scope: once no ordinary job is due or running, the daemon runs a falsification job for each workspace holding eligible defects whose evidence is not current, yields to ordinary work when it becomes due, stores nothing for an experiment whose inputs moved, and says in every answer what falsification is doing and why a defect is waiting. Requirements: FR10, FR13, FR15.

## Ticket 3.6: Canary gate on the consumer's Vitest

Scope: before a workspace's first falsification on a Vitest version, run RT Test's bundled canaries under that workspace's Vitest from the state directory, keep the result per Vitest and falsifier version, and refuse falsification on a version whose reading disagrees, naming the version and the canary in every answer. Requirements: FR11, FR23.

## Ticket 3.7: Falsification corpus

Scope: replay the M2 acceptance against RT Test's daemon on a synthetic two-workspace fixture on Vitest 4.1 and 5: a weakened assertion retires earlier evidence, a setup failure is never a detection, a moved anchor is reported while the other defects run, duplicate test names cannot misattribute a detection, the verified and eligible counts are exact, and every consumer file stays byte-identical. Requirements: NFR6, NFR7.

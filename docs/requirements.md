# Requirements

RT Test's product requirements. Each is one list line with an id, its text, and a marker linking the work that delivers it:

```md
- FR1: <what the product does> [Sprint 1]
- NFR1: <a quality the product keeps> [Unscheduled: <why>]
```

- Functional requirements use `FR<n>` and non-functional ones `NFR<n>`, numbered from 1 without leading zeros. `node scripts/requirements-index.mjs --next` prints the next free one, and the orchestrator allocates it.
- Delete a requirement that is no longer wanted. `--next` never reissues a deleted id: it counts every id this file has held in its git history, across merges and the renames git detects, and fails outside a git repository, in a shallow clone, or when that history cannot be read. Rename this file in a commit of its own, so git links its earlier history.
- The marker grammar and its derived states live in `_agent-docs/rules/requirement-markers.md`.
- `node scripts/requirements-index.mjs` renders the index with each requirement's current state.

## Functional requirements

- FR1: Discover every test in each Vitest workspace of a consumer on Vitest 4.1.x and 5.x, and give each a stable identity that distinguishes parameterized arms and duplicate display names. [Ticket 1.1]
- FR2: Record each run's test outcomes, skips, collection errors, module and run-level errors, worker crashes, executor crashes, and interruptions as distinct states. [Tickets 1.1b, 1.3b]
- FR3: Persist results bound to project, worktree, run identity, input fingerprint, and adapter version, and keep them available across a daemon restart. [Tickets 1.2, 2.3b]
- FR4: Start and stop the daemon explicitly for one trusted project, and execute no project code before that start. [Tickets 1.3, 1.3b, 1.3c]
- FR5: Answer summary and `status <path>` queries through a CLI with versioned `--json` output, reporting counts per state for files and folders, without starting a test. [Tickets 1.4, 2.3i, 2.3l, 2.4d, 3.4b]
- FR6: Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current. [Tickets 2.1, 2.1b, 2.3, 2.3c, 2.3g, 2.3j, 2.3m, 2.3q, 2.3p, 2.3o]
- FR7: Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts. [Tickets 2.2, 2.2b, 2.3b, 2.3c, 2.3d, 2.3e, 2.3i]
- FR8: Execute every selection in the daemon, and record a run whose inputs changed while it ran as invalidated and rerun it from stable inputs; a workspace or discovery that keeps becoming due only through changes the daemon's own runs and discoveries made to the same file is held until an edit, and every answer says why. [Tickets 2.3f, 2.3h, 2.3i, 2.3k, 2.3l, 2.3p, 2.7b]
- FR9: Answer `wait <files>` once every test covering those files has a current result or an explicit non-current state, as superseded when a covering input changes after the call, or as unsettled, naming each covering workspace's execution state, when its time limit passes first. [Ticket 2.4b]
- FR10: Falsify each defect definition by applying its mutation as an in-memory transform in a separate Vitest instance, between a baseline and a restored baseline that both pass its test, without writing any file. [Tickets 3.2, 3.5]
- FR11: Decide each falsification verdict from run facts (failure phase, error kind, whether the intended test reached the step that holds the mutation, the baseline result), counting as a detection only an assertion failure in the intended test after it reached that step, repeated in a confirming run. [Tickets 3.2, 3.3, 3.4c, 3.6]
- FR12: Read defect definitions committed at a configurable location in the consumer repository, attribute evidence by stable test identity including each `it.each` arm, and keep evidence in the local state directory. [Tickets 3.1, 3.4]
- FR13: Report a defect whose mutation anchor is missing as anchor missing, count it in the denominator, and withhold verified while the other defects still run. [Tickets 3.1, 3.5]
- FR14: Report every test with no defect as a gap. [Ticket 3.1]
- FR15: Mark defect evidence stale when its test, mutation, inputs, or execution configuration change, keep it across a daemon restart, and re-verify it at lower priority than ordinary tests. [Tickets 3.3b, 3.4, 3.4c, 3.5]
- FR16: Select tests at file granularity from static module dependencies and adapter edges, including a Convex adapter that resolves `api` and `internal` function references, widening on any reference it cannot resolve. [Unscheduled: M3 file-level selection, planned after M2]
- FR17: Report code no named defect covers and branches reached but never proven, with mechanical suggestions each checked against the current tests: one a test catches names that attribution, and one that survives names a test owed. [Unscheduled: M4 mechanical suggestions, planned after M3]
- FR18: Emit the gap report through the JSON CLI for a coding agent, and verify the defects and tests it proposes, without calling any model or sending source off the machine. [Unscheduled: M5 agent suggestions, planned after M4]
- FR19: Make a suggestion a named defect only when the author accepts it into the defect definitions, and never let a suggestion weaken an existing test. [Unscheduled: M4 and M5 suggestion add-ons, planned after M3]
- FR20: Report to a coding agent, after its tool calls, each change since its previous report in the state or freshness of the tests covering the files it edited, naming each test that failed or recovered, through a hook that only queries the CLI and reports the files the agent edited, starts no test and no daemon, and says when RT Test cannot answer rather than falling silent. [Tickets 2.7, 2.7b]
- FR21: Answer `changes <files>` with each test covering those files whose state or freshness changed since a cursor an earlier answer returned, failures and recoveries first, with counts for the covering and the other tests, without starting a test. [Ticket 2.6]
- FR22: Answer a `defects` query through the CLI with versioned `--json` output, giving each defect definition's evidence state, its freshness and reason, the verified, eligible and total counts, and the gaps, without starting a test. [Tickets 3.1, 3.4, 3.4c]
- FR23: Refuse to falsify in a Vitest workspace whose Vitest version RT Test's canary fixtures have not confirmed its run facts against, naming the version and the canary that disagreed. [Ticket 3.6]
- FR24: Report a defect definition that cannot be applied as written as invalid, naming why (an unreadable file, a repeated id, a test not discovered or named ambiguously, a mutation that changes nothing, a file outside the consumer root), count it in the denominator, and withhold verified. [Ticket 3.1]

## Non-functional requirements

- NFR1: Never execute a test while it holds a current result for the same input fingerprint, except to falsify it or to rerun an invalidated run. [Tickets 2.3f, 2.3h, 2.5]
- NFR2: Find in every selected run each failure that a full run over the same input snapshot finds, across the controlled edit corpus. [Ticket 2.5]
- NFR3: Never report a result as current unless its stored input fingerprint matches the current inputs. [Tickets 2.1, 2.3g, 2.3j, 2.3m, 2.3q, 2.3n, 2.3o, 2.3p, 2.4d]
- NFR4: Keep state, logs, and results on the machine under the configured state directory, and send nothing off it. [Tickets 1.2, 1.3, 1.3b]
- NFR5: Run on Node `^22.13.0`, `^24`, and `>=26`, on Windows and Linux. [Ticket 1.2]
- NFR6: Leave every consumer file byte-identical through falsification, writing no mutation anywhere on disk. [Tickets 3.2, 3.7]
- NFR7: Credit no detection to a setup, collection, compile, timeout, unhandled, or unrelated failure, across the canary fixtures and the falsification corpus on every supported Vitest line. [Tickets 3.3, 3.7]

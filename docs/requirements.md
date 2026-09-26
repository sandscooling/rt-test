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

- FR1: Discover every test in each Vitest workspace of a consumer on Vitest 4.1.x and 5.x, and give each a stable identity that distinguishes parameterized arms and duplicate display names. [Sprint 1]
- FR2: Record each run's test outcomes, skips, collection errors, module and run-level errors, and interruptions as distinct states. [Sprint 1]
- FR3: Persist results bound to project, worktree, run identity, input fingerprint, and adapter version, and keep them available across a daemon restart. [Sprint 1]
- FR4: Start and stop the daemon explicitly for one trusted project, and execute no project code before that start. [Sprint 1]
- FR5: Answer summary and `status <path>` queries through a CLI with versioned `--json` output, reporting counts per state for files and folders, without starting a test. [Sprint 1]
- FR6: Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current. [Sprint 2]
- FR7: Select the tests each change requires at workspace granularity, widening on uncertain dependencies, with a reason for each selected test, the trigger of each broad fallback, and selected and total counts. [Sprint 2]
- FR8: Execute every selection in the daemon, and record a run whose inputs changed while it ran as invalidated and rerun it from stable inputs. [Sprint 2]
- FR9: Answer `wait <files>` once every test covering those files has a current result or an explicit non-current state, or as superseded when a covering input changes after the call. [Sprint 2]
- FR10: Falsify each defect definition by applying its mutation as an in-memory transform in a separate Vitest instance after a passing baseline, without writing any file. [Unscheduled: M2 falsification, planned when M1 closes]
- FR11: Decide each falsification verdict from run facts (failure phase, error kind, whether the mutated code was reached, the baseline result), counting only an assertion failure in the intended test as a detection. [Unscheduled: M2 falsification, planned when M1 closes]
- FR12: Read defect definitions committed at a configurable location in the consumer repository, attribute evidence by stable test identity including each `it.each` arm, and keep evidence in the local state directory. [Unscheduled: M2 falsification, planned when M1 closes]
- FR13: Report a defect whose mutation anchor is missing as anchor missing, count it in the denominator, and withhold verified while the other defects still run. [Unscheduled: M2 falsification, planned when M1 closes]
- FR14: Report every test with no defect as a gap. [Unscheduled: M2 falsification, planned when M1 closes]
- FR15: Mark defect evidence stale when its test, mutation, inputs, or execution configuration change, and re-verify it at lower priority than ordinary tests. [Unscheduled: M2 falsification, planned when M1 closes]
- FR16: Select tests at file granularity from static module dependencies and adapter edges, including a Convex adapter that resolves `api` and `internal` function references, widening on any reference it cannot resolve. [Unscheduled: M3 file-level selection, planned after M2]
- FR17: Report code no named defect covers and branches reached but never proven, with mechanical suggestions each checked against the current tests: one a test catches names that attribution, and one that survives names a test owed. [Unscheduled: M4 mechanical suggestions, planned after M3]
- FR18: Emit the gap report through the JSON CLI for a coding agent, and verify the defects and tests it proposes, without calling any model or sending source off the machine. [Unscheduled: M5 agent suggestions, planned after M4]
- FR19: Make a suggestion a named defect only when the author accepts it into the defect definitions, and never let a suggestion weaken an existing test. [Unscheduled: M4 and M5 suggestion add-ons, planned after M3]

## Non-functional requirements

- NFR1: Never execute a test while it holds a current result for the same input fingerprint, except to falsify it or to rerun an invalidated run. [Sprint 2]
- NFR2: Find in every selected run each failure that a full run over the same input snapshot finds, across the controlled edit corpus. [Sprint 2]
- NFR3: Never report a result as current unless its stored input fingerprint matches the current inputs. [Sprint 2]
- NFR4: Keep state, logs, and results on the machine under the configured state directory, and send nothing off it. [Sprint 1]
- NFR5: Run on Node `^22.13.0`, `^24`, and `>=26`, on Windows and Linux. [Sprint 1]

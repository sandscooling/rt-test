# Roadmap

## M0: Repository foundation

Delivered in the starter:

- Product plan, architecture, testing conventions, and agent handoff.
- Strict TypeScript and Vitest development configuration.
- Result-freshness assessment with eight named-defect tests.
- Isolated bootstrap verification for those eight defects.
- Formatting, typechecking, build, and CI configuration.

## M1: Queryable results from one Vitest project

Build a thin integration around the installed Vitest version, then document a supported version range. Capture discovery, outcomes, skips, hook/collection errors, interruption, and run completion into a persistent local store. Deliver an explicit start/stop mechanism and a read-only JSON status command.

Acceptance: run a synthetic project containing passing, failing, skipped, and setup-error cases; query exact counts; stop and restart; historical results remain available but cannot be called current until reconciliation. A status query starts no test process. Reject unsupported versions with an actionable message. Measure query overhead.

Decide: SQLite driver, IPC transport, test identity, error schema, and process ownership. Avoid adding a dashboard yet.

## M2: Incremental invalidation and selective runs

Track source/test/config/fixture changes and compute reverse module dependencies. Reconcile after missed events. Handle untracked files, renames, deletions, branch changes, and configuration changes. Add explainable broad fallbacks, debounce, deduplication, and late-result guards.

Acceptance: selected-run outcomes match full-run outcomes across the edit corpus; editing during a run cannot restore a stale green result; new tests appear; deleted inputs cannot escape invalidation. Measure selection latency and total warm feedback time against native Vitest.

## M3: Named-defect evidence

Design a versioned manifest with stable defect and test IDs, expected behavior, explicit mutations, and input identity. Run baseline/mutation/restoration in isolation. Persist detected, survived, invalid, and unclear outcomes separately from ordinary test results. Schedule affected checks after ordinary tests pass.

Acceptance: a weakened assertion retires earlier evidence; setup failure cannot count as a detection; a moved mutation anchor fails explicitly; consumer files never change; duplicate test names cannot misattribute a detection. Query verified/eligible counts.

Evaluate Stryker against explicit authored defects before deciding whether to reuse it, write a narrow engine, or support both. Automatic mutation suggestions are outside this milestone.

## M4: Precision and framework adapters

Add validated function-level refinements and optional observed per-test execution edges. Introduce an adapter contract. Build a synthetic Convex fixture covering function references, dynamic dispatch, schema changes, and module registry behavior.

Acceptance: precision reduces work without losing failures in the edit corpus. Unknown behavior widens selection. Measure instrumentation overhead and document unsupported cases. Test fixtures must be shareable without private project data.

## M5: Public consumer release

Package a consumer CLI/integration, validate fresh installation in npm, pnpm, and Bun projects, document compatibility, and add agent-facing query examples. Benchmark Windows, Linux, and macOS. Add clean CI comparison and release checks.

Acceptance: a user can install into a supported project, explicitly start it, query current evidence, stop it, and uninstall without modifying their tests or leaving a process running. Remove `private: true` and publish only after explicit release authorization.

## Open decisions

- Minimum and maximum supported Vitest versions; handling advanced API changes.
- Runtime support beyond the starter's Node release lines.
- Durable test identity across parameterization and renames.
- State schema migrations, retention, and recovery from partial writes.
- Declared external inputs and handling nondeterministic/live-service tests.
- How to verify mutation attribution beyond simple hook-free fixtures.
- Performance budgets for cold indexing, memory, and function-level instrumentation.
- Whether an MCP interface is useful after the JSON query contract is stable.

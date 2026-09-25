# Testing RT Test

## Commands

Use `bun run test:run` for Vitest, `bun run test:defects` for the bootstrap defect checks, and `bun run check` for all current gates. Use `bun run test` only when you intend to leave a watcher running. The project does not use Bun's built-in test runner.

## Name the defect

Give every behavior test a concrete wrong behavior to reject. Record expected behavior independently from the implementation. Prefer examples that distinguish the intended behavior from a plausible mistake.

The starter's `test/defects.json` associates D001 through D008 with explicit source mutations. `test/evidence.test.ts` contains the corresponding cases. Each test currently has one assertion, so a targeted assertion failure has a clear scope.

## Bootstrap falsification

`scripts/verify-defects.mjs` copies the core and test fixture into a task-owned directory under `_agent-docs/.scratch/`. It resolves Vitest through its package manifest and executes its Node entry point with argument arrays.

The check requires a passing baseline, applies one exact mutation at a time, selects its named test, requires that test to fail with an assertion failure, restores the copied source, and verifies the complete baseline again. It checks that every bootstrap test has exactly one defect and removes the disposable copy on exit.

This is deliberately limited to the core's known hook-free tests. It does not classify arbitrary project failures or implement the product's general mutation engine. It does not establish that a mutation kills only one test in the whole suite. Preserve that distinction in claims and reports.

Changing source formatting may invalidate an exact mutation anchor. Update it deliberately; do not silently skip or fuzzy-match missing anchors. A changed test or mutation requires fresh evidence.

## Future integration fixtures

Build synthetic projects for plain TypeScript, mocked imports, shared setup, parameterized tests, dynamic imports, generated files, and framework registries. Add fixtures for setup errors, collection errors, unhandled errors, timeouts, runner crashes, and interrupted runs.

Exercise missed watcher events, edits during runs, branch switches, renamed tests, duplicate names, new untracked files, and deleted dependencies. Check that defects in the selection system cannot produce false current passes.

## Selection validation

For each controlled edit, run the selected tests and an independent full baseline against the same input snapshot. Compare discovered failures and invalidated states, not just exit codes. Keep negative controls where unrelated changes should retain evidence.

Use observed execution to improve explanations and prioritization before trusting it to narrow selection. Any narrowing rule must have fixtures showing both its precision and its conservative fallback.

## Performance validation

Report cold and warm measurements separately. Include runner-only baselines, hardware, OS, runtime versions, file/test counts, and the edit class. Query latency, invalidation latency, selection time, execution time, and instrumentation overhead are separate metrics.

Keep repeatable benchmarks out of correctness tests where machine timing would cause flakes. Never label provisional budgets as achieved measurements.

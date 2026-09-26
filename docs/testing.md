# Testing RT Test

## Commands

Use `bun run test:run` for Vitest, `bun run test:defects` for the bootstrap defect checks, `bun run lint` for oxlint, and `bun run check` for all current gates. Use `bun run test` only when you intend to leave a watcher running. The project does not use Bun's built-in test runner.

## Name the defect

Give every behavior test a concrete wrong behavior to reject. Record expected behavior independently from the implementation. Prefer examples that distinguish the intended behavior from a plausible mistake.

Each workspace keeps a `defects.json` beside its tests, associating each named test with one explicit mutation and the file it mutates; separate files let lanes in different workspaces add defects without sharing a file. Defect ids are unique across the repository. D001 through D008, in `packages/core/test/defects.json`, cover the freshness core in `packages/core/test/evidence.test.ts`. D009 through D020, in `test/defects.json`, cover the `no-nonlocal-comment` lint rule in `test/lint/no-nonlocal-comment.test.ts`, which runs the real oxlint binary over temporary fixtures. D021 through D049, in `test/scripts/config/defects.json`, cover the flow config reader `scripts/lib/flow-config.mjs` in `test/scripts/config/flow-config.test.ts`, as does D151. D100 through D155 (except D151) and D805 through D807, in `test/scripts/rules/defects.json`, cover the rule tooling (`scripts/expand-rules.mjs`, `scripts/check-rule-hygiene.mjs`, `scripts/lib/rules/`) in `test/scripts/rules/`, against the sharded fixture corpus in `test/fixtures/rules/sharded/`. D200 through D245, D800 through D804, and D808 through D811, in `test/scripts/planning/defects.json`, cover the planning scripts in `scripts/lib/planning/`, run against the fixture tree in `test/fixtures/planning/base/`; D800 through D804 and D808 through D811 build temporary git repositories for `--next`'s history. D300 through D367, in `test/scripts/orchestration/defects.json`, cover the orchestration scripts (`scripts/file-claims.mjs`, `scripts/stage-lane.mjs`, `scripts/lib/orchestration/`), the hook entries in `.claude/hooks/`, and their wiring in `.claude/settings.json`, in `test/scripts/orchestration/`. D400 through D448, in `test/scripts/standards/defects.json`, cover the shared-step scripts (`scripts/check-workspace-scripts.mjs`, `scripts/list-open-issues.mjs`, `scripts/doc-section.mjs`, `scripts/check-line-citations.mjs`, `scripts/lib/standards/`) in `test/scripts/standards/`; the line-citation tests build throwaway git repositories from `test/fixtures/standards/citations/`. D500 through D572, in `test/scripts/skills/defects.json`, cover the skill tooling (`scripts/fill-ticket.mjs`, `scripts/check-sprint-context.mjs`, `scripts/check-skill-wiring.mjs`, `scripts/lib/skills/`) in `test/scripts/skills/`, which build throwaway trees around the committed flow config. The orchestrator allocates each lane a range of defect ids so parallel lanes never pick the same one. Each test has one assertion, so a targeted assertion failure has a clear scope.

## Bootstrap falsification

`scripts/verify-defects.mjs` copies `packages/`, `lint/`, `scripts/`, `test/`, `.claude/hooks/`, the root tsconfigs, `_agent-docs/_flow-config.yaml`, and `.claude/settings.json` into a task-owned directory under `_agent-docs/.scratch/`, skipping `node_modules` and `dist`. It resolves Vitest through its package manifest and executes its Node entry point with argument arrays.

The check requires a passing baseline, applies one exact mutation at a time to the file its record names, selects its named test, requires that test to fail with an assertion failure, restores the copied file, and verifies the complete baseline again. It requires every `D###` test under `test/` to have exactly one defect record and removes the disposable copy on exit.

Keep bootstrap tests hook-free: do shared setup lazily inside the test body, so a setup failure fails the test with a non-assertion error rather than passing as a detection. This check is deliberately limited to those known hook-free tests. It does not classify arbitrary project failures or implement the product's general mutation engine. It does not establish that a mutation kills only one test in the whole suite. Preserve that distinction in claims and reports.

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

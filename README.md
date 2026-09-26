# RT Test

Test execution and falsification for Vitest projects, taken off coding agents.

Coding agents spend most of their time running and falsifying the tests they write. RT Test is meant to do that work for them: a local daemon runs each edit's tests and proves them against their named defects, and agents query the answers instead of running anything. It answers three questions: does the code pass, are the results still current, and have the tests shown that they detect their intended defects?

**Status: foundation only.** This repository contains the product plan, architecture, requirements, decision records, the agent workflow that builds it, and a small tested result-freshness core. It does not yet run a daemon, execute or watch a project's tests, build a dependency graph, persist results, falsify defects, or expose a product CLI. It is not published to npm.

## Intended experience

- Start RT Test explicitly for a trusted project; from then on its daemon is the only thing that runs tests, and agents never start a run.
- Ask through a CLI with versioned `--json` output: `status <path>` gives counts per state for a file or folder, and `wait <files>` returns once the results covering your files are current.
- Mark affected results stale as soon as saved inputs change, and never run a test again while its result is current.
- Select the tests each edit needs, widening when a dependency is uncertain and explaining every broad fallback, with a Convex adapter for function-reference edges.
- Falsify each test against its named defect as an in-memory transform, without touching a developer's working files, and report tests with no defect as gaps.
- Later, suggest defects for uncovered code: mechanically first, then through the coding agent. RT Test calls no model itself.

These are planned capabilities. See the [plan](docs/plan.md) and [milestones](docs/roadmap.md).

## Develop

Use Node 22.12+ within the supported Node 22, 24, or 26+ release lines, and Bun 1.3.14 for dependency installation and project scripts. The future consumer integration should not require Bun.

```sh
bun install --frozen-lockfile
bun run check
```

Useful individual commands:

```sh
bun run test:run
bun run test:defects
bun run lint
bun run typecheck
bun run build
```

The repository is a Bun workspace. Root scripts run across every workspace, and the root Vitest config runs each workspace as a project.

| Path                | Contents                                                      |
| ------------------- | ------------------------------------------------------------- |
| `packages/core`     | `@rt-test/core`: the result-freshness and evidence model      |
| `packages/*`        | Future libraries, the daemon, and the `rt-test` CLI           |
| `apps/*`            | Future editor integrations, such as a VS Code extension       |
| `lint/`, `scripts/` | Repository tooling: custom oxlint rules and development gates |
| `test/`             | Tests for repository tooling, and `defects.json`              |

Use `bun run test` to opt into Vitest watch mode. `bun test` invokes a different runner; use the scripts above.

The bootstrap core compares caller-supplied input fingerprints. It does not compute fingerprints or establish dependency completeness. The defect-check script verifies explicit mutations of that core and of the custom lint rule in disposable copies. It is a development check, not the planned general-purpose falsification engine.

## Start here

- [Product plan](docs/plan.md)
- [Architecture and evidence model](docs/architecture.md)
- [Implementation roadmap](docs/roadmap.md)
- [Requirements](docs/requirements.md) and [glossary](docs/glossary.md)
- [Named-defect testing](docs/testing.md)
- [Next-session handoff](_agent-docs/next-session.md)
- [Agent conventions](AGENTS.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).

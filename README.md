# RT Test

Queryable test state and named-defect evidence for Vitest projects.

RT Test is an early project exploring three questions: does the code pass, are the results still current, and have the tests demonstrated that they detect their intended defects?

**Status: foundation only.** This repository contains the product plan, architecture, contributor conventions, and a small tested result-freshness core. It does not yet watch projects, run a daemon, build a dependency graph, persist results, or expose a product CLI. It is not published to npm.

## Intended experience

- Query results immediately, without starting another run.
- Mark affected evidence stale as soon as saved inputs change.
- Schedule the smallest defensible set of tests and explain broader fallbacks.
- Track dependency, execution, and named-defect evidence separately.
- Verify named defects in isolation, without mutating a developer's working files.
- Support ordinary Vitest projects first, with adapters for frameworks such as Convex.

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
bun run typecheck
bun run build
```

Use `bun run test` to opt into Vitest watch mode. `bun test` invokes a different runner; use the scripts above.

The bootstrap core compares caller-supplied input fingerprints. It does not compute fingerprints or establish dependency completeness. The defect-check script verifies eight explicit mutations of that core in disposable copies. It is a development check, not the planned general-purpose falsification engine.

## Start here

- [Product plan](docs/plan.md)
- [Architecture and evidence model](docs/architecture.md)
- [Implementation roadmap](docs/roadmap.md)
- [Named-defect testing](docs/testing.md)
- [Next-session handoff](_agent-docs/next-session.md)
- [Agent conventions](AGENTS.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).

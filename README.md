# RT Test

Test execution and falsification for Vitest projects, taken off coding agents.

Coding agents spend most of their time running and falsifying the tests they write. RT Test is meant to do that work for them: a local daemon runs each edit's tests and proves them against their named defects, and agents query the answers instead of running anything. It answers three questions: does the code pass, are the results still current, and have the tests shown that they detect their intended defects?

**Status: foundation only.** This repository contains the product plan, architecture, requirements, decision records, the agent workflow that builds it, a small tested core that assesses result freshness and gives each test a stable identity, a daemon package that discovers and runs a consumer's Vitest tests, records each test's state, stores runs and discoveries in a local `node:sqlite` store, and runs them in a background daemon for one trusted worktree, and an `rt-test` CLI that starts and stops that daemon. It does not yet watch a project's inputs, build a dependency graph, falsify defects, or answer queries through the CLI. It is not published to npm.

## Intended experience

- Start RT Test explicitly for a trusted project; from then on its daemon is the only thing that runs tests, and agents never start a run.
- Ask through a CLI with versioned `--json` output: `status <path>` gives counts per state for a file or folder, and `wait <files>` returns once the results covering your files are current.
- Mark affected results stale as soon as saved inputs change, and never run a test again while its result is current.
- Select the tests each edit needs, widening when a dependency is uncertain and explaining every broad fallback, with a Convex adapter for function-reference edges.
- Falsify each test against its named defect as an in-memory transform, without touching a developer's working files, and report tests with no defect as gaps.
- Later, suggest defects for uncovered code: mechanically first, then through the coding agent. RT Test calls no model itself.

These are planned capabilities. See the [plan](docs/plan.md) and [milestones](docs/roadmap.md).

## Start and stop

The CLI is not published yet. Build it with `bun run build` and run it as `node packages/cli/dist/bin.js`, shown below as `rt-test`.

```sh
rt-test start [root] [--state-dir <path>] [--trust] [--json]
rt-test stop [root] [--json]
```

`rt-test start` starts RT Test's daemon for the consumer at `root`, the current directory by default. Before anything executes, it lists on stderr the consumer root, the state directory, each Vitest workspace with the config file the daemon will load for it, and each workspace source it could not read. Starting executes each listed config file and everything it loads: its plugins, further project configs it names (such as those in `test.projects`) and the modules it imports, which are not listed, and each workspace's `globalSetup`, setup files and test modules.

- On a terminal (stdin and stderr both), it asks `[y/N]` at every start, and only `y` or `yes`, in any case, starts the daemon. Git Bash counts as a terminal on Git for Windows 2.55.
- Without a terminal it starts nothing unless `--trust` is passed, so review the listing it prints before passing it. On a terminal the question is asked even with `--trust`.
- Trust is never saved: every start asks again, or needs `--trust` again.
- `--state-dir <path>` keeps the store and the log somewhere other than `.rt-test` under the root. A relative path resolves against the current directory.
- It starts nothing when a daemon already serves the worktree, when something holds the worktree's endpoint that cannot prove it is your daemon, or when no Vitest workspace is found.

`rt-test stop` stops the daemon serving `root` and returns once its process has exited.

With `--json`, stdout carries exactly one JSON document holding `schemaVersion` (1), `command`, `ok` and, on a failure, `reason`; the listing, the question and warnings go to stderr. Exit codes: 0 on success, 1 when the command failed or refused (a declined start included), and 2 on a usage error, which writes nothing to stdout.

## Develop

Use Node 22.18+ within the supported Node 22, 24, or 26+ release lines (the daemon's tests start it from its TypeScript source, which needs Node's type stripping; consumers need only Node 22.13+), and Bun 1.3.14 for dependency installation and project scripts. The future consumer integration should not require Bun.

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

| Path                | Contents                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| `packages/core`     | `@rt-test/core`: the result-freshness and evidence model                           |
| `packages/daemon`   | `@rt-test/daemon`: Vitest discovery and runs, the store, the daemon and its client |
| `packages/cli`      | `rt-test`: the command line that starts and stops the daemon                       |
| `packages/*`        | Future libraries                                                                   |
| `apps/*`            | Future editor integrations, such as a VS Code extension                            |
| `lint/`, `scripts/` | Repository tooling: custom oxlint rules and development gates                      |
| `test/`             | Tests for repository tooling, and `defects.json`                                   |

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

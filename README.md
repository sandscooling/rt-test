# RT Test

Test execution and falsification for Vitest projects, taken off coding agents.

Coding agents spend most of their time running and falsifying the tests they write. RT Test is meant to do that work for them: a local daemon runs each edit's tests and proves them against their named defects, and agents query the answers instead of running anything. It answers three questions: does the code pass, are the results still current, and have the tests shown that they detect their intended defects?

**Status: foundation only.** This repository contains the product plan, architecture, requirements, decision records, the agent workflow that builds it, a small tested core that assesses result freshness and gives each test a stable identity, a daemon package that discovers and runs a consumer's Vitest tests, records each test's state, stores runs and discoveries in a local `node:sqlite` store, and runs them in a background daemon for one trusted worktree, and an `rt-test` CLI that starts and stops that daemon and asks it what its stored runs say about the worktree or a path. The daemon watches the worktree's inputs, leaving out the files the consumer declares no test reads, and reports a result current only while the inputs its run started from are unchanged. After an edit it waits until the inputs have held still for 1,000 ms (a target), discovers again when its stored discovery is no longer current, and reruns each workspace whose latest run is no longer bound to its current input fingerprint; a restart reruns nothing that still reads current. It does not yet interrupt a run an edit touches, show its schedule in every answer, or falsify defects. It is not published to npm.

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

`rt-test start` starts RT Test's daemon for the consumer at `root`, the current directory by default. Before anything executes, it lists on stderr the consumer root, the state directory, each Vitest workspace with the config file the daemon will load for it, each workspace source it could not read, and the non-inputs `rt-test.json` declares, or that there is no `rt-test.json`, or why it declares nothing. Starting executes each listed config file and everything it loads: its plugins, further project configs it names (such as those in `test.projects`) and the modules it imports, which are not listed, and each workspace's `globalSetup`, setup files and test modules.

- On a terminal (stdin and stderr both), it asks `[y/N]` at every start, and only `y` or `yes`, in any case, starts the daemon. Git Bash counts as a terminal on Git for Windows 2.55.
- Without a terminal it starts nothing unless `--trust` is passed, so review the listing it prints before passing it. On a terminal the question is asked even with `--trust`.
- Trust is never saved: every start asks again, or needs `--trust` again.
- `--state-dir <path>` keeps the store and the log somewhere other than `.rt-test` under the root. A relative path resolves against the current directory.
- It starts nothing when a daemon already serves the worktree, when something holds the worktree's endpoint that cannot prove it is your daemon, or when no Vitest workspace is found.

Files no test reads, such as documentation, can be declared in `rt-test.json` at the consumer root, committed with the project:

```json
{ "nonInputs": ["README.md", "docs/**", "**/*.md"] }
```

Adding, editing or deleting a declared non-input, or renaming it to another declared name, leaves every result as it was and selects no test; renaming it to a name no pattern matches adds an input. A pattern is a `/`-separated path relative to the root, matched against a file's whole path: `*` matches any run of characters within one path segment, `?` one character within a segment, and a segment that is exactly `**` any number of whole segments, none included. They match names that begin with a dot. Every other character matches only itself, case included, on Windows and Linux alike. A file may hold at most 256 patterns.

- Whatever the patterns say, every `package.json`, `pnpm-workspace.yaml`, lockfile (`bun.lock`, `bun.lockb`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`), file named `vitest.config.*` or `vite.config.*`, file named `tsconfig*.json` or `jsconfig*.json`, test module, setup file and global setup file of the latest discovery, and file a discovered workspace's test file patterns find (its `include` and `includeSource` patterns, less its `exclude` patterns, as Vitest's own glob finds them, including through the spelling of the project root you started RT Test from, such as a link, a `subst` drive, another drive-letter case or an 8.3 short name), stays an input, and `rt-test.json` itself is never a non-input. A config with another name, such as a project config named in `test.projects` or a base config an `extends` names, is not protected, so keep it out of your patterns.
- A file with no `nonInputs` member declares nothing, and other members are ignored.
- If `rt-test.json` is a symbolic link or not a regular file, cannot be read, is not a JSON object, has a `nonInputs` member that is not an array of strings or that holds more than 256 patterns, or holds an invalid pattern (empty, beginning with `/`, containing `\`, `[`, `]`, `{`, `}` or `!`, with an empty, `.` or `..` segment, or with `**` inside a segment), it declares nothing, so every file stays an input, and the start listing, the daemon's log and every query answer say why.
- The daemon reads `rt-test.json` again whenever it changes. Every result reads unknown while it reconciles every input, then reads as before unless the change altered which files are declared.
- Until the daemon holds a discovery that reports which files the patterns may not remove, and whose test file patterns all compile, no pattern applies: every file stays an input, and the daemon's log and every query answer say why. After an upgrade whose store keeps more about each discovery, the discovery stored before it is such a case until the daemon discovers again. A new test file a pattern matches is still not protected in a browser-mode project, in a workspace whose discovery failed, is unsupported or was not confirmed, when only a `typecheck.include` pattern finds it, or when the pattern reaches it through a directory link below its first glob segment.

`rt-test stop` stops the daemon serving `root` and returns once its process has exited.

With `--json`, stdout carries exactly one JSON document holding `schemaVersion` (1), `command`, `ok` and, on a failure, `reason`; the listing, the question and warnings go to stderr. Exit codes: 0 on success, 1 when the command failed or refused (a declined start included), and 2 on a usage error, which writes nothing to stdout.

## Query

```sh
rt-test summary [root] [--json]
rt-test status <path> [--root <dir>] [--json]
```

Both ask the daemon serving `root` (the current directory by default, never a parent) what its stored runs say. Neither starts a daemon, a discovery or a run. A query needs a running daemon: with none, it exits 1 and says to run `rt-test start`. A daemon started by an older RT Test answers that it predates the query; stop it and start it again.

`rt-test summary` counts every test of the latest discovery. `rt-test status <path>` counts the tests whose file is `path` or lies under it, and for a folder gives each test file's own counts. `path` resolves against the current directory and must lie inside the root.

- Each test is in exactly one state, from its workspace's latest stored run: `passed`, `failed`, `skipped` or `error` when it finished; `interrupted`; `module-not-run`, `module-crashed` or `module-failed-to-load`; `run-failed`, `run-unsupported-vitest`, `run-interrupted-before-load` or `run-crashed`; `not-in-latest-run`; or `never-run` when no run of its workspace is stored.
- Beside the states, each test is `current`, `stale` or `unknown`. A finished result is current only while the inputs its run started from are unchanged: every file under the root except `.git`, `node_modules`, the state directory, `rt-test.json`, the non-inputs it declares and, inside git, what git ignores, plus each test module the latest discovery lists, the daemon's environment, and the Node and Vitest versions. An input edit makes stale the fingerprinted results of each workspace whose selection the edited path reaches, by the same dependency information selection uses; an edit to a test module git ignores stales only its own workspace's results. While a dependency build has failed or timed out, the dependency builds have stopped working, the discovery does not report every workspace's selection facts, or selection refuses an input's path, any input edit stales every workspace's results. A result recorded under another version of RT Test's Vitest adapter is stale. A result is unknown when it has no finished outcome, when its run's inputs changed while it ran, while the dependency build at the current input revision has not ended, and while the daemon is reconciling its inputs (at start, after a branch change, a lost event or a change to `rt-test.json`, and 5 minutes after the last reconciliation), has changed paths it has not yet read, or cannot watch or read its inputs. A test told apart from a same-named test only by its position is also unknown while the discovery is not current.
- Every answer gives the input revision, whether reconciliation is complete and why not, when the last one ended, the file watcher's health, and whether the discovery the counts come from is current, and, while `rt-test.json` cannot be used or its patterns do not apply, why every file stays an input (`nonInputsUnusable` under `--json`), and, while the last dependency build failed or timed out, the dependency builds have stopped working, the discovery yields no selection input or selection refuses an input's path, why no workspace's inputs are narrowed (`inputsNotNarrowed` under `--json`, with its `kind`). A discovery that is not current may miss tests added since.
- The answer lists what was not discovered, each with its reason: workspaces with no supported Vitest, a failed discovery or no confirmed start; modules that failed to load; typecheck modules; unsupported projects; and workspace sources not read. `summary` also gives each workspace's latest run, with how its executor process ended when that run crashed, and every answer gives the daemon's activity and each job that ended with nothing stored.
- No answer calls a worktree, folder or file passing or failing; read the counts.

With `--json`, stdout carries one document with `schemaVersion` (1), `command`, `ok` and the answer's fields, such as `counts.states`, `counts.freshness`, `notDiscovered` and `inputs`. Exit codes: 0 when the query answered, whatever the tests' states; 1 when it could not, such as no daemon, a stopping or older daemon, no stored discovery, a discovery holding nothing to count, a path outside the root or with nothing at or under it, a query that failed inside the daemon, or an answer longer than the protocol allows, when you should ask `status` for a narrower path; and 2 on a usage error.

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

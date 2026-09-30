<!--
Directions where an agent's default instinct is wrong for this project. Read it whole before writing
code, so the work is right the first time. Constraints a reviewer checks against a diff live in
_agent-docs/code-review-checklist/ instead; a rule lives in exactly one of the two.
Ids are P<n>, digits only, never renumbered. Maintenance: _agent-docs/rule-maintenance-guide.md.
Expand chosen ids with: node scripts/expand-rules.mjs --doc project-context <ids>
-->

# Project Context

## Repository and tooling

P1. **Lay out the Bun workspace by role**: Put product libraries, the daemon and the CLI in `packages/*`, and editor integrations such as a VS Code extension in `apps/*`. Keep repository tooling (`lint/`, `scripts/`, the root `test/`) at the root, outside every workspace.

P2. **Give every workspace build and typecheck scripts**: Each workspace defines `build` and `typecheck` scripts and extends `tsconfig.base.json`; root scripts fan out to every workspace rather than naming them.

P3. **Reserve the package name `rt-test`**: `rt-test` is the published CLI's name. Name internal packages `@rt-test/<name>`.

P4. **Run Vitest through `bun run test:run`**: `bun test` starts Bun's own test runner, not Vitest, and `bun run test` leaves a Vitest watcher running. Target a subset with `bun x vitest run <paths>`.

P5. **Lint with oxlint, never ESLint**: Lint with `bun run lint` and configure rules in `.oxlintrc.json`. Do not add ESLint or typescript-eslint: they need the classic TypeScript compiler API, which TypeScript 7 does not ship. Write no new custom lint rule; a construct oxlint's built-in rules cannot see stays a review check.

P6. **Fix a lint finding at its cause**: Extract a function to reduce complexity. Never raise a threshold, disable a rule, or add an inline suppression to make lint pass.

P7. **Keep TypeScript strict**: Never relax a compiler option from `tsconfig.base.json` in a workspace or root tsconfig to make code compile; fix the code or the type.

P8. **Expect tools that load TypeScript to break**: TypeScript 7 ships no classic compiler API, so a package that imports `typescript` programmatically may fail or resolve the wrong copy. Check such a dependency's entry point before adopting it, and deep-import a single rule module when the package index pulls the compiler in.

P9. **Add dependencies at exact versions at least three days old**: Add with `bun add --exact`. `bunfig.toml` enforces the release-age gate; keep `minimumReleaseAgeExcludes` empty except for an urgent security patch. Declare and test the supported version range.

P10. **Verify third-party behavior in its installed source**: Read the dependency's `.d.ts`, then its `.js`, under `node_modules/.bun/`, or its official documentation for the installed version, before relying on a behavior. Pin a behavior the product depends on in a test.

P11. **Keep repository scripts dependency-free Node ESM, and change them only to fix them**: Scripts under `scripts/` are plain `.mjs` run with `node`, add no dependency, and keep a `.d.mts` beside any module a TypeScript test imports. Change a script only to fix a defect that blocks work or could produce a false result; add no new script, check or helper.

P12. **Read workflow paths through the flow config**: A script reads every workflow path (tickets, sprints, rule docs, requirements, ADRs) through `scripts/lib/flow-config.mjs`, never a hardcoded string.

P13. **Support Windows and Linux alike**: Build paths with `node:path`, normalize separators to `/` before comparing or storing them, and never assume a POSIX shell in product code. The pre-push gate runs on Windows under Node 24 and on Linux under Node 22 and 24.

P14. **Let the typecheck find call sites**: No language server is configured. After changing a shared symbol's name or shape, run `bun run typecheck` to report the call sites a text search missed.

P15. **Use argument arrays for child processes**: Spawn with an executable and an argument array (`spawnSync(cmd, args)`); never assemble a shell command from project paths, test names or user input.

## Code shape

P16. **Keep production files focused**: Keep a production file normally under 500 lines, extracting by responsibility; lint caps code lines at 500. Never split a test file to satisfy a line count.

P17. **Comment only a fact the code cannot state**: Rename, extract a function, name a constant or encode the constraint in a type before writing a comment. A surviving comment states only that fact, kept short; history and rationale belong in docs or git.

P18. **Prefer deep modules**: When extracting or consolidating logic, give the module a narrow interface over significant behavior, and move pre-loading and resolution inside it rather than making callers pass them.

P19. **Do not merge divergent callers behind a mode flag**: A function that grows a discriminator, mode flag or options bag to serve callers that genuinely diverge is shallow. Share the invariant-bearing steps as a module and keep the divergent parts in thin callers.

P20. **Put shared logic in a package from the start**: Logic more than one package or app will need goes into a `packages/*` library when first written, never into one consumer to migrate later.

P21. **Follow the documented design, and fix the doc when it blocks you**: Use the pattern `docs/architecture.md` and the ADRs describe, and never build a second way beside it. If the pattern blocks the design, or disagrees with lint, installed source or a newer ADR, stop and correct the doc in the same change.

## Tests and defect evidence

P22. **Title a defect-backed test with its id**: Under `packages/`, write `it("D123: <behavior>", ...)`; `scripts/verify-defects.mjs` finds defect tests by `it(` followed by the double-quoted `D<digits>:` title, on the same line or the next, and any other form (`it.each`, `test(`, another quote) is invisible to it.

P23. **Keep a defect-backed test hook-free**: Do setup inside the test body, with no `beforeEach`, `afterEach` or shared fixture hook, so a setup failure fails the test instead of passing as a detection.

P24. **Give a defect-backed test one assertion**: One `expect` per `D###` test, so the failure the defect verifier requires points at the named defect.

P25. **Prove a test with the defect verifier, never by editing live code**: Record the mutation in the `defects.json` beside the test (`id`, `defect`, `file`, exact `old` and `new`) and prove it with `node scripts/verify-defects.mjs --ids <ids>`, or `--edited` in a worktree, which applies it in a disposable copy. Never hand-edit a production file to watch a test fail.

P26. **Take defect ids from the allocated range**: The orchestrator allocates each lane a range of `D###` ids; use only ids from yours.

P27. **Read only inputs the defect sandbox copies**: A `D###` test may read only what `scripts/verify-defects.mjs` copies (`packages/`, `lint/`, `scripts/`, `test/`, the root tsconfigs and `_agent-docs/_flow-config.yaml`). Put fixtures under `test/fixtures/`.

P28. **Make every product test a named-defect test**: Every test under `packages/` is a `D###` test with one record. `bun run check:defects` fails on a `D###` test without a record, a record without a test, or an anchor that does not match exactly once, but not on an untitled test, so review catches that. A new test of the repository tooling under the root `test/` carries no `D###` title and no record.

P29. **Assert before restoring a spy**: In Vitest, `mockRestore()` resets the mock, which clears its recorded calls. Assert on calls first, then restore.

P42. **Add a test to an existing test file before creating one**: Put a new test in the existing test file for the module or area it covers. Create a test file only when none covers that area, or when the tests need a different environment, config, or fixture setup than that file provides. Vitest builds each test file's module graph separately, so the number of test files, not their length, drives suite time.

P43. **Give a root test that spawns a process the shared budget**: A `describe` in the root `test/` tree whose tests spawn git, node, oxlint or any other process, directly or through a helper, passes `PROCESS_SCENARIO` from `test/scripts/timeouts.ts`, and a child-process `timeout` inside it uses `PROCESS_SCENARIO_TIMEOUT_MS`; Vitest's 5000 ms default fails such a test under a loaded run.

P44. **Build fixture git repositories from the shared settings**: A root test that commits in a fixture repository applies `test/scripts/git-fixture.ts` (`writeFixtureGitConfig` or `FIXTURE_GIT_FLAGS`) or builds it with `initRepo` from `test/scripts/orchestration/harness.ts`, so a developer's global hooks, signing and identity never reach it.

P45. **Give a daemon test that writes or checks a key the key budget**: A test under `packages/daemon/test/` that writes a daemon key, or points a client at a listener on an endpoint, with the real system tools unmocked, runs under `KEY_TEST_OPTIONS` on its `describe` or with `KEY_TEST_TIMEOUT_MS` as its own timeout, both from `test/daemon-key.ts`, unless a longer timeout such as `DAEMON_TEST_TIMEOUT_MS` already covers it. On Windows each key write runs `whoami` and `icacls` and each check runs `icacls`, and Vitest's 5000 ms default fails such a test under a loaded run.

## Product direction

P31. **Keep RT Test generic**: Fleet Cooling is the proving ground, not a dependency. Nothing application- or backend-specific enters the core; Convex support lives in an adapter.

P32. **Let only the daemon execute tests**: The daemon is the sole test executor. The CLI and programmatic API query results or wait for a revision scoped to given files, and never spawn Vitest; lint and typecheck stay with agents.

P33. **Give agent-facing tooling a JSON CLI, never an MCP server**: Expose the product as a CLI with `--json` output in front of the daemon, plus a small programmatic API.

P34. **Report path status as counts per state**: `status <path>` answers for files and folders with counts per state, never a single pass or fail, so an editor folder view can show mixed states.

P35. **Support Vitest 4.1 and 5 across workspaces**: Target the consumer's Vitest 4.1.x as well as 5.x, and support several Vitest workspaces in one project from the first milestone.

P36. **Apply mutations as transforms in a separate Vitest instance**: Defect verification transforms modules in memory in its own Vitest instance; it never writes a mutated file, even in a copy, when a transform can do it.

P37. **Classify a defect experiment from recorded facts**: Decide an experiment's verdict from facts collected during the run (failure phase, error kind, whether the mutated code was reached, the baseline result), never by matching error message text.

P38. **Mark a missing anchor per defect**: A defect whose mutation anchor is missing gets an `anchor-missing` state that names the gap in the denominator and blocks "verified"; the other defects still run.

P39. **Leave mutation choice and survivor diagnosis to the author**: RT Test runs the mutations the author defines and reports survivors; it never chooses mutations or explains why one survived.

P40. **Keep defect definitions in the consumer's repository and evidence local**: Defect definitions are committed at a configurable location in the consumer repository; evidence stays in the local state directory, attributed by stable test id including each `it.each` arm.

P41. **Keep consumer state under `.rt-test/`**: Write runtime state and logs only under the configured local state directory, `.rt-test/` by default, never elsewhere in the consumer's tree. The consumer excludes that directory from version control.

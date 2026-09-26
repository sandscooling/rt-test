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

P5. **Lint with oxlint, never ESLint**: Lint with `bun run lint`, configure rules in `.oxlintrc.json`, and write custom rules in `lint/` as oxlint JS plugins. Do not add ESLint or typescript-eslint: they need the classic TypeScript compiler API, which TypeScript 7 does not ship. oxlint has no `no-restricted-syntax`, so a syntax ban is a custom rule.

P6. **Fix a lint finding at its cause**: Extract a function to reduce complexity. Never raise a threshold, disable a rule, or add an inline suppression to make lint pass.

P7. **Keep TypeScript strict**: Never relax a compiler option from `tsconfig.base.json` in a workspace or root tsconfig to make code compile; fix the code or the type.

P8. **Expect tools that load TypeScript to break**: TypeScript 7 ships no classic compiler API, so a package that imports `typescript` programmatically may fail or resolve the wrong copy. Check such a dependency's entry point before adopting it, and deep-import a single rule module when the package index pulls the compiler in.

P9. **Add dependencies at exact versions at least three days old**: Add with `bun add --exact`. `bunfig.toml` enforces the release-age gate; keep `minimumReleaseAgeExcludes` empty except for an urgent security patch. Declare and test the supported version range.

P10. **Verify third-party behavior in its installed source**: Read the dependency's `.d.ts`, then its `.js`, under `node_modules/.bun/`, or its official documentation for the installed version, before relying on a behavior. Pin a behavior the product depends on in a test.

P11. **Write repository scripts as dependency-free Node ESM**: Scripts under `scripts/` are plain `.mjs` run with `node`, add no dependency, put shared helpers in `scripts/lib/`, and export their logic as a function a test can call with a root and captured output. Give a module that TypeScript tests import a `.d.mts` beside it.

P12. **Read workflow paths through the flow config**: A script reads every workflow path (tickets, sprints, rule docs, requirements, ADRs) through `scripts/lib/flow-config.mjs`, never a hardcoded string. A new path is a new `_agent-docs/_flow-config.yaml` key.

P13. **Support Windows and Linux alike**: Build paths with `node:path`, normalize separators to `/` before comparing or storing them, and never assume a POSIX shell in product code. CI runs both on Node 22 and 24.

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

P22. **Title a defect-backed test with its id**: Write `it("D123: <behavior>", ...)`; `scripts/verify-defects.mjs` finds defect tests by that exact `it("D<digits>:` prefix, and any other form is invisible to it.

P23. **Keep a defect-backed test hook-free**: Do setup inside the test body, with no `beforeEach`, `afterEach` or shared fixture hook, so a setup failure fails the test instead of passing as a detection.

P24. **Give a defect-backed test one assertion**: One `expect` per `D###` test, so the failure `bun run test:defects` requires points at the named defect.

P25. **Prove a test through `bun run test:defects`, never by editing live code**: Record the mutation in the `defects.json` beside the test (`id`, `defect`, `file`, exact `old` and `new`) and run `bun run test:defects`, which applies it in a disposable copy. Never hand-edit a production file to watch a test fail.

P26. **Take defect ids from the allocated range**: The orchestrator allocates each lane a range of `D###` ids; use only ids from yours.

P27. **Read only inputs the defect sandbox copies**: A `D###` test may read only what `scripts/verify-defects.mjs` copies (`packages/`, `lint/`, `scripts/`, `test/`, the root tsconfigs and `_agent-docs/_flow-config.yaml`). Put fixtures under `test/fixtures/`.

P28. **Make every suite test a named-defect test**: `bun run test:defects` requires every test it runs to be a passing `D###` test with a record, so a test without a defect fails the check.

P29. **Assert before restoring a spy**: In Vitest, `mockRestore()` resets the mock, which clears its recorded calls. Assert on calls first, then restore.

P30. **Keep every switched-off path tested**: A mode kept off by a `scale` switch in the flow config keeps a fixture test that exercises it, so the dormant path works when the switch turns on.

## Product direction

P31. **Keep RT Test generic**: Fleet Cooling is the proving ground, not a dependency. Nothing application- or backend-specific enters the core; Convex support lives in an adapter.

P32. **Let only the daemon execute tests**: The daemon is the sole test executor. The CLI and programmatic API query results or wait for a revision scoped to given files, and never spawn Vitest; lint and typecheck stay with agents. → lint-hardening candidate (config-expressible and custom-plugin: `no-restricted-imports` on `vitest/node` outside the daemon package, and a custom rule banning a Vitest child process there, once that package exists)

P33. **Give agent-facing tooling a JSON CLI, never an MCP server**: Expose the product as a CLI with `--json` output in front of the daemon, plus a small programmatic API.

P34. **Report path status as counts per state**: `status <path>` answers for files and folders with counts per state, never a single pass or fail, so an editor folder view can show mixed states.

P35. **Support Vitest 4.1 and 5 across workspaces**: Target the consumer's Vitest 4.1.x as well as 5.x, and support several Vitest workspaces in one project from the first milestone.

P36. **Apply mutations as transforms in a separate Vitest instance**: Defect verification transforms modules in memory in its own Vitest instance; it never writes a mutated file, even in a copy, when a transform can do it.

P37. **Classify a defect experiment from recorded facts**: Decide an experiment's verdict from facts collected during the run (failure phase, error kind, whether the mutated code was reached, the baseline result), never by matching error message text.

P38. **Mark a missing anchor per defect**: A defect whose mutation anchor is missing gets an `anchor-missing` state that names the gap in the denominator and blocks "verified"; the other defects still run.

P39. **Leave mutation choice and survivor diagnosis to the author**: RT Test runs the mutations the author defines and reports survivors; it never chooses mutations or explains why one survived.

P40. **Keep defect definitions in the consumer's repository and evidence local**: Defect definitions are committed at a configurable location in the consumer repository; evidence stays in the local state directory, attributed by stable test id including each `it.each` arm.

P41. **Keep consumer state under `.rt-test/`**: Write runtime state and logs only under the configured local state directory, `.rt-test/` by default, never elsewhere in the consumer's tree. The consumer excludes that directory from version control.

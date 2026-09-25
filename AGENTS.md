# AGENTS.md

## Project

Build RT Test as a standalone, local-first developer tool for Vitest projects. Read `docs/plan.md`, `docs/architecture.md`, `docs/roadmap.md`, and `_agent-docs/next-session.md` before substantial work. Keep implemented behavior distinct from planned capabilities.

Use this file as the shared agent entry point. Do not create a separate Claude instructions file.

The repository is a Bun workspace. Put product libraries, the daemon, and the CLI in `packages/*`, and editor integrations such as a VS Code extension in `apps/*`. Keep repository tooling (`lint/`, `scripts/`, root `test/`) at the root. Give each workspace `build` and `typecheck` scripts and extend `tsconfig.base.json`; root scripts fan out to every workspace. Reserve the package name `rt-test` for the published CLI.

## Sessions and lanes

Run `session_list` at the start of a session and read your own row. If your `group` is set and is not `orchestrator`, you are a lane member: follow `_agent-docs/crew.md`. Otherwise you are the owner's discussion session: follow `.claude/skills/orchestrator/SKILL.md`, and delegate each agreed change to a lane of child sessions rather than building it in the discussion thread.

## Working conventions

- Inspect the working tree before editing. Preserve changes made by users and other sessions.
- Read all existing target files before the first edit of a multi-file change.
- Use `rg` for content searches. Include untracked files when checking references. Enumerate tracked files with `git ls-files`; avoid recursive scans through dependency directories.
- Make direct changes for explicitly requested work within your role. Do not introduce a ticket workflow or subagent fan-out unless requested; lanes of sessions are the delegation mechanism.
- When asked for thoughts or an audit, give findings before implementing changes.
- If a rule blocks the requested outcome, check its factual basis and intended scope. Surface a real product tradeoff rather than silently working around it.
- Write durable instructions as actions. Keep historical justification in commits or decision records.
- Do not use U+2014 in added or changed text. Do not rewrite untouched lines solely to remove it.
- Use short comments only when they explain a fact the code cannot express. Prefer clear names and small functions. Keep comment blocks below 12 lines.
- Keep production files focused, normally below 500 lines. Extract by responsibility; do not split tests merely to satisfy a line count.
- Use strict TypeScript. Avoid explicit `any`, unused exports, suppressions, and silent error handling.
- Check installed dependency source or official documentation before relying on third-party behavior. Declare and test supported versions.
- Lint with oxlint through `bun run lint`. Configure rules in `.oxlintrc.json` and write custom rules in `lint/`, each with named-defect tests. Do not add ESLint or typescript-eslint: they need the classic TypeScript compiler API, which TypeScript 7 does not ship.
- Fix a lint finding at its cause. Extract a function to reduce complexity; never raise a threshold or disable a rule to pass.
- Add dependencies at exact versions published at least three days earlier. `bunfig.toml` enforces the age gate; keep `minimumReleaseAgeExcludes` empty except for an urgent security patch.

## Product guarantees

- Never report historical results as current after a relevant edit or unresolved input change.
- Keep outcome, freshness, execution state, and falsification evidence independent.
- Bind results to project identity, run identity, input fingerprints, and adapter versions.
- Widen selection when dependency information is uncertain. Do not use historical coverage alone to exclude tests.
- Preserve collection errors, crashes, interruptions, skipped tests, and unknown tests as distinct states. A zero-test selection is not proof of success.
- Explain each selection and each broad fallback. Report selected and total test counts.
- Keep the daemon and state store independent of the project backend.
- Never inject defects into a consumer's working tree. Use isolated snapshots or isolated transforms.
- Treat test execution as execution of project code. Require an explicit start for a selected trusted project; do not auto-execute discovered repositories.
- Separate local test results, typecheck status, backend synchronization, and live integration results.
- Keep state and logs local by default. Do not introduce telemetry or upload source, results, or environment values without explicit product approval.

## Tests and validation

- Name the concrete defect before writing a test. Derive expected behavior from requirements, not observed implementation output.
- Prove behavior tests reject their named defect. Use an isolated mutation, verify the intended assertion fails, and verify the restored baseline passes.
- Do not count compilation failures, setup failures, unrelated failures, or timeouts as a successful defect detection.
- Invalidate defect evidence when its test, mutation, relevant inputs, or execution configuration changes.
- Run targeted checks while iterating. Broaden to affected dependents when a change is ready; use a full run when impact is uncertain.
- Run `bun run check` before handing off code changes while the starter suite remains small. Read actual process exit codes and test counts.
- Use `bun run test:run`, not `bun test`. The latter selects Bun's runner rather than Vitest.
- Preserve failures and fix their causes. Update expectations only when intended behavior changed.
- Do not rerun an unchanged passing suite merely for reassurance. Investigate failures before repeating broad runs.
- Keep performance targets labeled as targets until measured. Record hardware, runtime, project size, and warm/cold state with benchmarks.

## Git and public repository

- Work and commit on `main` until the owner introduces a branch workflow.
- Stage only files created or edited for the current task. Inspect the staged diff before committing.
- Use concise conventional commit subjects such as `feat:`, `fix:`, `docs:`, `test:`, and `chore:`. Explain meaningful behavior and validation in the body.
- When asked to publish work, push its branch and report the repository URL and commit.
- Keep credentials, local environment files, generated reports, private customer data, and code copied from unrelated private repositories out of commits.
- Keep `private: true` until an npm release is explicitly authorized. Public GitHub hosting does not authorize a package release.

## Files and processes

- Put disposable task files under `_agent-docs/.scratch/<task>/` and remove task-owned files on completion. Keep durable plans in `docs/` and handoffs in `_agent-docs/`.
- Put future consumer runtime state under the configured local state directory, initially `.rt-test/`, and exclude it from version control.
- Use targeted patches to undo your own edits. Ask before discarding other uncommitted work.
- Do not start persistent watchers, daemons, or dev servers without user authorization. One-shot tests and builds are normal validation.
- Use explicit working directories. In Bash, wrap directory changes in subshells.
- On Windows, use `-LiteralPath` for repository paths. Verify resolved paths before recursive deletion; use one shell or filesystem API end-to-end.
- Use argument arrays for child processes. Do not assemble shell commands from project paths or test names.
- Preserve stdout/stderr and exit codes for failed runs. Do not let a trailing output filter mask the runner's exit status.
- Before ending a multi-step session, update `_agent-docs/next-session.md` with completed work, validation, open decisions, and the next concrete step.
- Never let the context compact. When the user asks, or the context passes about 60% of its window, hand off to a successor session by following `_agent-docs/handoff.md` (the `/handoff` skill in Claude Code).

# Bun workspaces

Read this before any `bun run --filter` command, and before adding a workspace.

**A filter names a workspace by the `name` in its `package.json`, not by its folder.** Read the name from the manifest rather than guessing: `packages/core` is `@rt-test/core`, so its typecheck is `bun run --filter @rt-test/core typecheck`. A filter that matches nothing runs nothing.

**`--filter '*'` skips a workspace that lacks the script, and says nothing.** The root `build` and `typecheck` reach every workspace that way, so a missing script reads exactly like a passing one. `bun run typecheck` therefore runs `node scripts/check-workspace-scripts.mjs` first, which lists every workspace it examined and fails naming any without a `build` or `typecheck` script.

**Tests do not go through `--filter`.** The root `vitest.config.ts` lists Vitest projects, so `bun run test:run` and `bun x vitest run <paths>` run from the repository root with repository-relative paths. A workspace outside that config's project globs, such as the first one under `apps/`, runs no tests under `bun run test:run` until the config names it; confirm its test file count after adding one.

# Falsification by one reused Vitest instance per run group

**For:** Ticket 3.2 (FR10, ADR-0003, ADR-0007)

## The question

How much of a falsification run's cost is starting Vitest, and can one Vitest instance run many mutations and still give each the verdict a fresh instance would? Measured on 2026-09-29 against this repository's own named defects, with Vitest 5.0.1 on Node 24.19, on Windows 11 (16 threads) and in WSL Ubuntu, over a sample of 103 of the 1232 product records (every twelfth). The mutations were written to disk in isolated copies, not applied as transforms; the reuse findings still bear on ADR-0003.

## The verdict

Reuse one long-lived `createVitest` instance per isolated run group, and rerun it for each mutation with `invalidateFile` and then `runTestSpecifications`, behind a stale-transform guard. It gave the same verdict as a fresh instance for every sampled record (103 of 103 on Windows, 3 of 3 core records on Linux). The median cost of one mutated run at 12 parallel instances fell from 8.47 s to 1.33 s, and the time outside the named test's body from a mean of 8.17 s to 2.79 s.

- **Isolation holds per file.** With `isolate: true` each run forks a fresh worker, so only the main process (the transform cache and global setup) is shared.
- **Global setup is per instance.** It runs once per instance, and its teardown only at `close()`, so a verdict that needs teardown evidence of its own needs an instance per run group.
- **The stale-transform guard is required.** Wrap each environment's `pluginContainer.transform` to record the input hash by module id, and before each run compare every still-cached module with its source. With invalidation switched off, the guard stopped the run naming the stale module. A no-op mutation read as "expected one named assertion failure", never as a detection. Its cost per run was a median of 56 ms, at most 519 ms.

## What surprised us

- **Transforms do not reach child processes.** Code a test runs in a child it spawns from source (here the daemon and its executor, loaded through `--conditions=development --import source-hooks.ts`) is read from disk. An in-memory mutation of that code is never exercised and reads as undetected. This is ADR-0003's revisit condition, for any consumer whose tests spawn their own source.
- **Selecting defects by import closure barely narrows here.** Of the last 50 commits on main, the 16 that touched product inputs reselected a mean of 953 of the 1232 product records, 11 of them 1195 or more. Incremental re-proof needs finer dependency information than relative imports (M3) before it saves much on a codebase shaped like this one.
- **Cold start dominates the first run of a test file in a new instance:** 9 to 16 s under load (about 70 transforms), against 0.4 to 2 s warm. An instance starts in 0.5 to 1.2 s and holds 167 to 214 MB.
- **The work is CPU-bound:** throughput was flat from 8 to 16 instances.

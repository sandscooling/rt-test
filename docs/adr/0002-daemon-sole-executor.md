# Let the daemon alone execute tests

Status: accepted

Coding agents today run and falsify every test themselves, which costs most of their time, and on Fleet Cooling a run lock serializes them so two sessions do not collide. RT Test exists to take that work off them, so it must own execution rather than record what agents ran.

The daemon is the sole executor of tests and falsification for a started project. The CLI and the programmatic API query results, or wait for the results covering given files, and never spawn Vitest. A run whose inputs change while it runs is recorded as invalidated and rerun from stable inputs, which replaces the run lock: there is one executor, so there is nothing to lock. Lint and typecheck stay with agents.

Rejected: recording the runs agents start, which keeps every agent paying for execution, lets two sessions run the same tests on the same inputs, and keeps the lock. Rejected: an agent-facing `run` command, which reintroduces runs racing the daemon's own and makes "never run a test twice" unenforceable. Revisit only if a consumer needs a run the daemon cannot schedule, such as a live integration suite, which stays outside RT Test's results.

Enforcement: the project-context direction that only the daemon executes tests, carrying a lint-hardening candidate for a ban on Vitest's node API outside the daemon package, and the duplicate-execution requirement pinned by named-defect tests.

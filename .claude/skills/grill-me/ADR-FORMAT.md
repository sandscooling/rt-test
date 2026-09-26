# ADRs from a grill

`{cfg.adr_dir}/README.md` owns the file format, the numbering and the supersession rule; follow it for every
ADR. The index is generated (`node scripts/adr-index.mjs`), so writing the file is the whole job. This file
owns when a grill offers an ADR and what each must answer before it is written.

## When to offer one

All three must hold:

1. **Hard to reverse**: changing course later costs something real.
2. **Surprising without context**: a future reader would ask why it was done this way.
3. **The result of a real trade-off**: there were genuine alternatives, and one won for specific reasons.

What qualifies:

- **Architectural shape**: the daemon as the sole executor, a local SQLite store, the CLI and its `--json`
  contract in front of the daemon.
- **Technology choices with lock-in**: a runtime floor, a storage driver, an IPC transport.
- **Boundaries**: what the core may know about a backend, what an adapter owns.
- **Deliberate deviations from the obvious path**: anything a reasonable reader would assume the opposite of.
- **Constraints the code cannot show**: a latency budget, a supported version range.
- **A rejected alternative whose rejection is not obvious**, so nobody proposes it again unaware.

## Check the external assumptions first

An ADR's external premises rot: a library's behavior, a platform limit, a version. Verify each against its
source (installed code under `node_modules`, or the vendor's current documentation) before the decision rests
on it, as `{cfg.rule_maintenance_guide}` § Procedure directs for a rule's premise. Two failures: the decision is
now wrong, which is loud; or the decision is still right on an obsolete rationale, which is silent and passes
the bad premise to the next decision.

**A rejected alternative is a load-bearing claim.** Record why it lost in checkable terms, and when the
rejection rests on a figure, name what would have to change for the option to return.

## Enforcement: every ADR answers this before it is written

Nothing reads ADRs at review time, so a constraint that lives only in an ADR is advisory. Answer, in one line
in the ADR's own text, and act on it this session: **what makes this decision fail loudly if someone violates
it later?**

- **A custom lint rule in `lint/`**, when the decision bans a code shape: route it through the lint-hardening
  candidate check in `{cfg.rule_maintenance_guide}`.
- **A named-defect test**, when the decision is one specific behavior: note it as a test owed for
  `create-tests`.
- **A rule**: a checklist rule when a reviewer can check it against a diff, a project-context rule when it is
  a direction an agent would otherwise get wrong. State the decision as the rule and cite no ADR.
- **Nothing**, for a pure choice record. Say so in the ADR, so the absence reads as a decision.

An ADR that bans or replaces an existing pattern also triggers the reverse sweep in
`{cfg.rule_maintenance_guide}` § Procedure, in the same session.

---
name: prototype
description: Build a throwaway prototype to answer one design question, as a drivable terminal app for a state model or rule, or as switchable layouts of the CLI's human output. Use when a design question cannot be settled by talking, when the owner wants to feel out whether a state model or rule behaves right, or when create-ticket or change-request raise an unsettled design question.
---

# Prototype

A prototype is **throwaway code that answers one question**. The question decides its shape.

Read `_agent-docs/_flow-config.yaml`. Keys used: `{cfg.design_decisions_dir}` and the switch
`scale.prototype_ui`.

This is not a ticket. No tests, no validation suite, no review, no requirement tracing: those protect
production code, and prototype code is deleted before it can become any.

## Pick a branch

Identify the question from the prompt or the surrounding code, or ask via `AskUserQuestion` (header `Branch`),
one option per live branch:

- **"Does this model or rule behave right?"** → [LOGIC.md](LOGIC.md): a drivable terminal app over a pure
  model. Natural targets here: selection with widening and broad fallback; the freshness state machine, kept
  independent of outcome and execution state; evidence invalidation when a test, mutation, input or
  configuration changes; binding results to run identity and input fingerprints.
- **"What should the CLI show a person?"** → [OUTPUT.md](OUTPUT.md): several layouts of the human output for
  one fixture state, switched by a key.
- **"What should this view look like?"** → [UI.md](UI.md), offered only while `scale.prototype_ui` is on.

If an ADR, `docs/architecture.md` or an existing pattern already settles the question, say so and stop.

**A question of fact is a spike, not a prototype.** A prototype answers whether something feels right, which
only a person can judge. A spike answers what is true, which the machine reports in minutes: `grill-me`
§ Settle it, don't ask it owns that. **The `--json` contract is a compatibility decision** for a spike or an
ADR, never a prototype.

## Rules for every branch

1. **Throwaway from the start.** The code lives in `_agent-docs/.scratch/prototypes/<slug>/`, which is
   gitignored, and nowhere else. The one artifact that outlives it is the record in
   `{cfg.design_decisions_dir}`.
2. **One command to run**: `bun _agent-docs/.scratch/prototypes/<slug>/tui.ts`. Start no daemon, watcher or
   server, and run no project's tests.
3. **No persistence and no side effects.** State lives in memory; nothing reads or writes a real project,
   store or `.rt-test/` directory.
4. **Skip the polish**: no tests, no error handling beyond what runs, no abstraction, no extraction into a
   package.
5. **Surface the state** after every action.
6. **Capture the answer, then delete the prototype.**

## Capture and clean up

**1. Write the record** to `{cfg.design_decisions_dir}/<slug>/FINDINGS.md`, in the format that directory's
`README.md` gives: the question verbatim, the verdict and why, and every "that should not be possible" moment,
which are bugs in the idea and the reason the prototype existed.

**2. Fold the answer into the caller's artifact:**

- `create-ticket`: sharpened acceptance criteria, plus a Dev Note citing the `FINDINGS.md`.
- `change-request`, inline: the specification of the fix about to be written.
- `change-request`, proposal: the grounds of the proposal and its design-doc edits.
- Standalone: summarize the verdict and ask the owner what to do with it.

**3. Delete the workspace**, `_agent-docs/.scratch/prototypes/<slug>/`, and check for code the prototype left
elsewhere by searching every source file for its slug:

```sh
rg -l -i -F "<slug>" --type ts --type js
```

`rg` skips the gitignored scratch folder, so any hit is residue: delete it. Exit 1 means none. Docs citing
the record are not residue. A winning model is never promoted as written: `dev-ticket` or
the `change-request` inline path rewrites it under the full rule set, with tests from `create-tests`.

**4. Report**:

```text
Prototype complete: <slug>
Question: <question>
Verdict:  <verdict>
Record:   {cfg.design_decisions_dir}/<slug>/FINDINGS.md
Residue:  none
```

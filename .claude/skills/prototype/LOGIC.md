# Logic prototype

A small terminal app that lets the owner drive a state model by hand. Use it when the question is about
state, transitions or a rule whose edge cases look fine on paper and feel wrong once pushed through real
cases: "can a result stay current after its fixture file changes mid-run?", "which fallback wins when the
dependency graph is partial and the edit touches a config file?", "does an interrupted run leave any test
reading as passed?"

A question about what the output looks like is [OUTPUT.md](OUTPUT.md).

## 1. State the question

Write it as one paragraph at the top of `tui.ts` before any code. The record restates it verbatim, so it must
be checkable later by someone picking it up cold.

## 2. Location and runtime

Everything lives in `_agent-docs/.scratch/prototypes/<slug>/`: TypeScript run with
`bun _agent-docs/.scratch/prototypes/<slug>/tui.ts`, with no dependency, no package and no `package.json`
entry.

Strict types still apply and `any` is still banned: the point is to learn whether the model holds together,
and `any` is how a model hides its holes. A discriminated union that is awkward to write is a finding; record
it.

## 3. A pure model in its own module

Put the logic in `model.ts` behind a small pure interface that could move into a `packages/*` library. Pick
the shape that fits the question:

- **A reducer**, `(state, event) => state`, when events are discrete and state is one value.
- **A state machine** with explicit states and legal transitions, when which events are allowed now is part of
  the question.
- **Pure functions over plain data**, when there is no current state, only a resolution:
  `selectTests(inputs) => { selected, reasons, fallback }`.

`model.ts` does no I/O, imports nothing from the terminal code and never logs. The terminal imports the model;
nothing flows back. That one-way rule is what makes the model liftable once the question is answered.

**Keep the product's separations in the model.** Outcome, freshness, execution state and defect evidence are
independent fields, and collection errors, crashes, interruptions, skips and unknowns are distinct states
(`AGENTS.md` § Product guarantees). A prototype that merges two of them answers a different question.

## 4. The smallest terminal that shows the state

On every action, clear the screen and redraw the whole frame, never appending:

1. **Current state**, one field per line. Bold (`\x1b[1m`) for names, dim (`\x1b[2m`) for secondary values,
   `\x1b[0m` to reset.
2. **Derived values, every candidate and which one won**: every rule that could decide the answer and the one
   that did. The interesting bug is almost always in which rule won.
3. **The keys**, on one line: `[e] edit file  [r] run  [i] interrupt  [x] reset  [q] quit`.

Read a line at a time (type the key, then Enter): line input works in every Windows terminal, while raw
single-key mode is unreliable there.

## 5. Hand it over

**Draw the model first.** Render its legal transitions as a Mermaid diagram (`stateDiagram-v2` for a machine,
`flowchart` for a resolution's rule order) and let the owner check it before driving. A drawing shows the
whole graph at once, which the terminal cannot. Skip it for pure functions with nothing to draw.

Then give the one command. The owner drives it; add actions they ask for.

## 6. Capture

Follow `SKILL.md` § Capture and clean up. The model is rewritten into its real module by the ticket or fix
that follows; the terminal shell is never promoted.

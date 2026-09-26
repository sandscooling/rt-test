# Output prototype

Several radically different layouts of the CLI's human output for one fixture state, switched by a key. Use it
when the question is what a person should see: how `status <path>` presents counts per state, how a
selection explains itself and its fallback, how a stale result is set apart from a current one.

The `--json` output is a versioned contract, not a layout: a question about it is a spike or an ADR.

## 1. State the question and pick the variants

Write the question and the fixture state at the top of `tui.ts`. Default to three variants; beyond five they
stop being radically different.

**Variants differ on the axis the question asks and nowhere else.** For a layout question that is structure:
grouping, ordering, what leads, what is folded away. Three tables with different column widths are one
variant.

## 2. Build it

In `_agent-docs/.scratch/prototypes/<slug>/`:

- `fixture.ts`: one plain-data state holding every case the question turns on (mixed states in one folder, a
  zero-test selection, an interrupted run).
- `variant-a.ts`, `variant-b.ts`, `variant-c.ts`: each a pure function from the fixture to lines of text.
- `tui.ts`: prints the current variant with its label, then `[n] next  [p] previous  [w] width  [q] quit`,
  reading a line at a time. `[w]` cycles 80, 120 and 160 columns, since a layout that works at one width only
  is not an option.

Every variant carries the selected and total test counts and never shows a zero-test selection as success
(`AGENTS.md` § Product guarantees).

## 3. Hand it over

Give `bun _agent-docs/.scratch/prototypes/<slug>/tui.ts`. The owner's answer is usually a composite ("the
grouping from B, the header from C"); record it that specifically.

## 4. Capture

Follow `SKILL.md` § Capture and clean up. The record carries each variant the verdict cites as a fenced text
block at the width it was judged, captioned with **Take** and **Ignore** lines, per the design-decisions
`README.md`.

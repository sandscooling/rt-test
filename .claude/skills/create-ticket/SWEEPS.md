# Sweeps: enumerating a deletion, a move or a prose correction

Read this when a criterion removes or moves a symbol, or corrects prose describing one. Step 4 runs the
greps, so the sizing counts include every site; Step 5 writes the result into the criterion.

`{cfg.code_change_standards}` § Deleting an Exported Symbol owns the grep forms; read it first. What
is yours is that authoring has no typecheck to fall back on: the implementer finds a missed site by building,
and you find it only by grepping. A list assembled from the files the change already opens is circular.

## Enumerate by running the sweep

Two greps, and the second is the one that gets skipped. First the names the ticket deletes. Then the names
it stops referring to: the callee it stops calling, the helper it stops using, the concept a comment names by
role. **A site naming a survivor is invisible to the first grep**: a docblock listing a function's callers
goes stale by losing one, without a character of the deleted name in it.

A grep for the observable a reader sees and a grep for the claim a comment makes answer different questions.
Widen the grep rather than narrowing the claim; the survivors usually sit in the file being edited, not the
file defining the symbol.

## What goes in the criterion

**The command, with its count stated as that command's output and as a floor the implementer re-runs.** A
count and a method written separately drift, and the pair then reads as verified both ways. Write the closure
command with `git grep`, and keep any path filter your discovery grep used, since a dropped filter changes
the answer.

**Open the file before writing a site down.** Never transcribe an agent's line citation: which docblock a line
sits in decides whose contract changes, and an earlier sweep may already have fixed it.

## Classify by the symbol a reference names, never by its position

- **A move.** A reference breaks only when it and its target land on opposite sides of the move. Grep the
  whole source file for every moved name, including references in unrelated docblocks.
- **A deletion.** Enumerate any comment block you are about to cut passage by passage, state the count, and
  say which passages die and which survive. A survivor documenting a member it is no longer beside moves with
  that member.
- **Fixtures.** When one deleted member breaks fixtures in several test files, write the fixture clause on
  every file's line in Dev Notes, not only the first.

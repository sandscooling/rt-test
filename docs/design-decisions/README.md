# Design decisions

One folder per prototype that produced a decision, written by the `prototype` skill and read by the session
that implements the decision. Each folder holds a `FINDINGS.md`.

```text
design-decisions/
└── selection-fallback/
    └── FINDINGS.md
```

A record describes one decision about something that does not exist yet. It is not a specification: the
requirements, `docs/architecture.md` and the ADRs say what the product always is.

## Rules

1. **`FINDINGS.md` is the entry point.** A ticket cites the record's `FINDINGS.md`, never a capture inside it,
   so the prose qualifies each capture before a reader forms an impression.
2. **Every capture is captioned with Take and Ignore.** An uncaptioned capture reads as a whole-design claim.
   Three captioned variants beat prose alone; three uncaptioned ones are worse than prose alone.
3. **Keep only the captures the verdict cites.** The rest are deleted with the prototype's workspace.
4. **A record is deleted when its implementing work is done.** The shipped product then answers the question
   better than the record, which would otherwise read as current. The review that completes the implementing
   ticket or change deletes the folder.

## `FINDINGS.md` format

```markdown
# <Title>

**For:** Ticket 3.2 (or: change request "<title>")

## The question

<verbatim, as the prototype was asked it>

## The verdict

<what was decided and why; for variants, which won and exactly which pieces were taken from the others>

## What surprised us

<every "that should not be possible" moment: bugs in the idea, and the reason the prototype existed>

## Captures

### variant-b, 120 columns

    <the variant's output, as judged>

**Take:** the grouping by state, since mixed folders read at a glance.
**Ignore:** the footer. Rejected, it hides the selected and total counts.
```

Omit `## Captures` for a prototype whose verdict rests on no capture; an empty section invites filling.

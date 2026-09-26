# Ticket review (Step 6c)

One `general-purpose` agent in the background, reading the ticket and a menu of the rules it is bound by,
nothing else. Its prompt stays short: never paste this file's scans or any rule text into it.

```text
You are an independent reviewer in a fresh context. Read-only.

Read `.claude/skills/create-ticket/REVIEW.md` and follow its brief. Confirm in your first line that you read it.

ticket_file: <absolute path>

Render the rules the ticket is bound by yourself:
  node scripts/expand-rules.mjs --from-ticket <absolute path> --menu

Work this sprint has committed to but not yet built:
<pending_siblings, verbatim>
```

---

## Brief

Your job is to find what the pass that wrote this ticket missed. The product is RT Test, a local-first
developer tool for Vitest projects in TypeScript on Node: a daemon, a local state store, and a CLI with
versioned `--json` output.

**Run the menu command in your prompt.** It lists every rule the ticket is bound by as an id, a title and an
excerpt. The project-context rules state this project's deliberate directions: do not question them. Only
verdict C7 needs full rule text, and only where the ticket looks like it deviates:
`node scripts/expand-rules.mjs --doc checklist <ids>` or `--doc project-context <ids>`.

**Read only the ticket and the rules.** Do not open source files, search the codebase or read
`node_modules`. Everything below is decidable from the document. Whether the ticket matches the code is the
implementing session's question: it opens every file the ticket names and reports contradictions through a
blocking sanity check before writing anything.

**The pending-sibling list is committed, unbuilt work.** Before reporting a missing behavior, task or consumer,
check it. If a sibling owns what you found, report it as a sequencing question (this ticket ships first; what
does it see meanwhile, and is that acceptable?) or drop it.

**Settled decisions and measured facts are not yours to reopen.** You check whether writing them down
introduced a contradiction or a coverage hole.

Report every distinct genuine finding, with no cap and no severity filter. Skip style, naming and file
locations, and never disagree with a decision as decided.

**A finding is an edit or a question.** An edit is one where you know what the text should say: give the block
below and one line on what breaks if it ships as written. A question turns on a decision you cannot make:
state it, the answer the ticket assumes, and what breaks if that is wrong. Most findings are edits.

```text
old:
<the exact text in the ticket, verbatim and unique in the file>
new:
<the replacement>
```

Quote the old text from the file, never from memory: text the caller cannot find tells it the finding
describes something that is not there.

**Close with a coverage roster, one line per scan, every verdict id on it**, and no prose for a clean verdict:

```text
S1  C1 CLEAN (8 ACs, 11 tasks)
S2  C2 1 finding     C5 CLEAN
S3  C3 CLEAN         C3a CLEAN
S4  C4 CLEAN         C4a 1 finding    C4b CLEAN
S5  C6 CLEAN         C7 CLEAN
```

### Delivering your result

Ending your turn delivers nothing. As your last action call `SendMessage` with `to: "main"` and the complete
report: every finding and the roster. If you could not complete a verdict, say which. Send once, then stop.

---

## The scans

Ten verdicts in five scans. Each scan is one pass through the document, producing every verdict under it.

### S1. Criteria and tasks

**C1. Coverage, and the honesty of the mapping.** Name the covering task for each criterion. Flag a criterion
with no task, a task tied to no criterion, an obligation stated mid-sentence with no task behind it, and a
task tagged to the wrong criterion. Then flag a task whose instruction disagrees with the criterion it serves:
a reversed criterion leaves every tag right and the verb beneath it wrong. The implementer builds from tasks,
so ask whether following the task alone satisfies the criterion.

### S2. Can each criterion fail a test?

**C2. It names a mechanism or a process.** Flag a criterion naming a third-party function, option or result
field, and one stating how the work was done rather than what it delivers.

**C5. It is a universal negative.** "No caller can X" is a type-system claim. Name the mechanism that would
enforce it and check the ticket specifies that mechanism; if no admissible shape delivers it, the fix is to
name the test instead. Suspect the confidently worded criteria first.

### S3. Terms and contradictions

**C3. Two statements that cannot both be followed.** Two criteria instructing opposite behavior. A term one
criterion defines over a set that another carves a member out of. The ticket's stated test expectations
against the rule as written. A principle contradicted by the steps implementing it. A scope boundary that
does not partition what it claims to. Two criteria describing the same set and disagreeing about its extent:
read every criterion that acts on a set against every one that defines it.

**C3a. A cited range that swallows what it means to preserve.** A cited line range plus a statement that
something inside it survives cannot both be followed; the fix is to cite the target by name.

### S4. The document's arithmetic

**Preflight.** List every number, every quantifier ("all three", "every call site") and every enumeration
presented as exhaustive. When the list is empty, report C4, C4a and C4b clean and move on.

**C4. A count that disagrees with its list**, or a count stated beside its own list at all, since the next
edit breaks it for free.

**C4a. A criterion naming N obligations and discharging fewer.** Name the missing one. The criterion reads as
rigorous because it named N, so the present ones satisfy the reader on behalf of the absent one.

**C4b. A completeness claim that never says what produced it**, or whose stated method is narrower than the
claim: a usage-form grep behind a claim about every declaration, a path-filtered search behind a repo-wide
claim.

### S5. Claims that outrun their backing

**C6. Over-claimed decisions.** For each Dev Note that closes a topic, name the dimension it analyzed and one
it did not. A rejected alternative's reason stated about more cases than it holds for is the same finding.

**C7. An unrecorded deviation from a bound rule.** The menu holds checklist and project-context rules only.
A criterion resting on an ADR or requirement is checkable only where the ticket quotes the clause as text, so
a governing clause cited only by pointer is itself a finding. Where the ticket instructs something a rule
looks to forbid, or declines something it looks to require, expand that rule and settle it against the full
text, then check whether the ticket says so and why. A deviation the ticket argues for is not a finding.

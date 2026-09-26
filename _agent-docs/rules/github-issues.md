# GitHub issues

Two directions of one job, and every workflow that commits code owes the second. **Filing** asks whether a finding you are not acting on has a durable home. **Closing** asks whether the commit you just made resolved an issue nobody linked to it.

**This repository is public.** An issue, comment or label is published the moment it is posted, and may be cached or indexed after deletion. Never post source from another repository, local paths outside this one, environment values, logs, or results from a consumer project. **Show the owner the exact text before posting anything**; under a lane, send it to the orchestrator, which posts it.

## Reading the open issues

**Read them with `node scripts/list-open-issues.mjs`, never a hand-written `gh issue list`.** `gh` returns 30 rows by default and reports no truncation, and the rows it drops are the oldest, the end most likely to hold the issue you are about to duplicate. The script requests up to `--cap` rows (default 1000) and prints the count first.

| Exit | Means                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0    | A complete list, or one `SKIP:` line: no GitHub remote, or `gh auth status` failed. Say so and carry on; never try to authenticate. |
| 1    | Truncated: the result filled the cap. Raise `--cap` or narrow with `--search` or `--label`, and re-run before acting.               |
| 2    | `gh` itself failed, or the arguments were invalid. The error is on stderr.                                                          |

Flags: `--search "<query>"` (best-match first), `--label <name>` (repeatable), `--json`, `--cap <n>`.

## Verify an existing issue before acting on it

An issue ages against a moving codebase. Check in this order, since the last costs most:

1. Do its cited files, symbols and lines still resolve?
2. Is the described defect still present?
3. **Is the prescribed fix still possible?** "Give this the same treatment its sibling has" is dead once a change removes the sibling's mechanism, and still reads as actionable.
4. Is the blocking decision still open?

A defect can be live while its write-up is unusable: comment what changed rather than closing. Before merging or cross-referencing two issues, confirm they are the same defect and not the same shape.

## Filing deferred work

**Filing is rare, and it is the owner's call.** The default for a finding is to fix it in the pass that found it. An issue is a promise to do the work later, which is where a defect goes to be forgotten, and filing feels like handling the finding. Size, "pre-existing" and "out of scope" never select this route.

So present the finding with its evidence and fix it. Bring a real design decision as a discussion with your recommendation. If it cannot be fixed in this session, say in one sentence what it is blocked on and let the owner direct it. **Do not open an issue, and do not offer to.** The ban is on opening, never on reading: the scan above stays mandatory for every workflow that commits code.

When the owner directs a filing:

- **Search for a duplicate first** with `--search "<distinctive symbol or path>"`. A recurring finding comments on the existing issue.
- **The body is the whole handoff.** It states what is wrong with evidence a reader can open, why it matters with `surface` and `reach` from `_agent-docs/rules/review-shared.md` (write an unmeasured reach as `not measured`), the commit that surfaced it, and a suggested fix plus any decision the fix needs first.
- **Labels and titles:** use labels the repository already has (`gh label list`), and never create one unasked. Follow the title prefixes existing issues use; with none, use `Fix:`, `Refactor:` or `Decide:`. A finding carrying an open decision is marked as needing triage, never as ready for an agent.
- **Record the issue number** in whatever the workflow keeps: the ticket record or the completion report.

## Closing issues your change resolved

**Run this once per changeset.** A workflow whose commit goes to `review-changes` leaves it to the review; run it yourself when no review will see the commit.

- **Search by symbol:** `--search` each file the changeset touched and each exported symbol it deleted or renamed. A deletion closes issues in bulk this way.
- **Verify against the tree before closing**, by the four checks above. An issue whose defect you can no longer find may have been fixed earlier; closing it against this commit records the wrong cause.
- **A partial fix comments, it does not close.** Say what the commit addressed and what remains.
- **Attribute a closure to what fixed it**, citing that commit.
- **Post after the commit exists and cite its sha.** A comment that runs ahead of its commit asserts a state no pushed commit carries.

State the result either way, including "no open issue matched this changeset": a pass that reports nothing is indistinguishable from one that never ran.

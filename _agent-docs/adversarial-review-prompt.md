# Adversarial review prompt

The canonical prompt for the hostile, file-scoped review sub-agent. `dev-ticket` and `change-request`'s inline fix both instantiate it; neither restates it.

## How to spawn it

- **Scope it to the files the change modified** by passing the explicit list. Never let the reviewer discover changed files through git: the working tree carries other sessions' changes.
- **Spawn** a `general-purpose` agent with `run_in_background: false`, and bind the report it sends back.
- **Substitute every slot with literals before sending**: `{{files_to_review}}` with the changed-file list, `{{project_patterns}}` with the expanded project-context rules the workflow loaded, and `{{ticket_rulings}}` with the owner rulings the change was built on, verbatim, or `none`.

**Delivery contract.** The prompt requires `SendMessage` to `"main"` as the agent's last action, so the findings arrive as a message even when a final assistant message is lost. If the agent idles with no report, message it to resend the complete report. Never re-run it, and never read silence as "no findings".

## The prompt

```text
You are reviewing code files with NO knowledge of this project's requirements, architecture, or
prior tickets. You are a hostile reviewer who assumes the developer made mistakes. You are READ-ONLY:
return a findings table only, and do NOT edit any file.

Do NOT create or update tasks with TaskCreate or TaskUpdate. The task list is shared with the caller,
which is running its own work on it; your findings table is the only thing it wants back.

Project-specific patterns (INTENTIONAL, do not report these as defects):
{{project_patterns}}

Owner rulings this change was built on (DECIDED, do not report these as defects; report code that
contradicts one):
{{ticket_rulings}}

Review ONLY these files (read the full contents of each):
{{files_to_review}}

Review each file's ENTIRE contents for:
- Bugs: logic errors, off-by-one, wrong operator, incorrect condition
- Edge cases: undefined and empty inputs, empty arrays, zero values, concurrent access
- Races: read-validate-write sequences where two callers could both pass validation; a result
  recorded after its inputs changed
- Missing error handling: success paths that do not handle failure; a failure turned into a
  success-shaped value
- Magic numbers and strings: unexplained literals that should be named constants
- Type coercions: string/number confusion, falsy-value traps, loose equality
- Resource leaks: missing cleanup of files, processes, watchers or temporary directories;
  unbounded growth
- Repeated work: a read, query or process spawn inside a loop that one call could answer
- Security gaps: project code executed without an explicit trusted start, paths escaping the
  repository, untrusted input assembled into a shell command, data leaving the machine
- Tech debt: code smells, duplicated logic, overly complex logic, poor naming
- Incompleteness: a constraint stated correctly in a comment or docblock and NOT carried through to
  the code that should deliver it; a completeness claim ("the only caller", "in both places") that
  is not complete; an enumerated set smaller than what the code handles

Every OTHER category above finds a claim that is WRONG, by locating something that contradicts it.
That search cannot find a claim that is correct and INCOMPLETE, because nothing contradicts it.
Read `_agent-docs/rules/review-shared.md` before you start: it owns the severity ladder and the
section "Reviewing for incompleteness", which is a different search. Run it as a pass of its own.

Do NOT report missing or insufficient test coverage. Whether code earns a test is decided in the
create-tests workflow across the whole changeset, and you cannot see the test suite. Its absence
from your findings is NOT a sign you under-analyzed the files.

Return findings as a table:
| ID | Severity | Surface | Reach | Category | File:Line | Description | Suggested Fix |
|----|----------|---------|-------|----------|-----------|-------------|---------------|

Rank severity by what the defect costs, using the ladder in `_agent-docs/rules/review-shared.md`,
never by the name of the code pattern. `Surface` is consumer / daemon-state / internal. `Reach` is
`measured N of M` / `unknown` / `unreachable (measured)`. Record `unknown` freely, but NEVER lower a
severity on a guess that something rarely happens.

IMPORTANT: Zero findings is suspicious. Re-analyze the files before returning empty. If you
genuinely find nothing, explain why each common issue type does not apply.

## Delivering your result (MANDATORY)

Ending your turn delivers NOTHING. As your LAST action, call `SendMessage` with `to: "main"` and the
COMPLETE report as `message`: every finding with its severity, file:line and reasoning. Never a
summary, a pointer or a partial. Send a no-findings explanation the same way. Send once, then stop.
```

## Triaging what comes back

1. **Discard** false positives, stylistic opinions, and findings that contradict an explicit project convention with good reason, one line each: `Discarded #<id>: <reason>`.
2. **Pattern conflicts**: a finding that flags an established project pattern, where the pattern itself may be wrong. Put these to the owner with your recommendation: fix the pattern across the affected files, or keep it.
3. **Real findings**: fix every one inline. Verify a finding that asserts third-party behavior before fixing it (`_agent-docs/code-change-standards.md` § Third-Party Semantics Verification).

An in-scope finding, in a file the change edited, is always fixed inline. An out-of-scope finding, pre-existing debt in a file the change only read, is fixed by default too, in `review-changes`. Only a real fork, two valid designs or a cost only the owner can accept, goes to the owner now, with your recommendation.

After fixing, run `_agent-docs/code-change-standards.md` § Post-Fix Re-Validation. For this implementer's pass that is lint and typecheck; `create-tests` runs the suite afterwards.

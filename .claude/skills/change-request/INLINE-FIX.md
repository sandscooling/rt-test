# Change request: inline fix

Reached from `SKILL.md` Step 3 when the change fits one ticket. **Inline means no ticket file and no approval
gate ahead of the work; it does not mean code only, and it does not mean skipping gates.** This path runs
`dev-ticket`'s rigor: gates, an adversarial review, and every documentation update the change implies. It
writes and edits no test and runs no test: `create-tests` runs next, then `review-changes`, which commits (under a lane, the orchestrator commits from its report).
Everything the preamble bound is in hand.

Read `{cfg.code_change_standards}` whole, whatever `scale.doc_sections` says: this path implements, so it needs
all of it. Then read `{cfg.rules_dir}/task-lists.md`, `{cfg.rules_dir}/review-shared.md` and
`{cfg.rules_dir}/github-issues.md`. Those documents, `{{project_patterns}}` and `{{checklist_rules}}` bind
every line you write.

Initialize: `{{files_changed}}` = [], `{{owner_decisions}}` = [], `{{change_request_candidates}}` = [].

## Escalation: re-size at every widening

Scope keeps arriving after Step 3: a grill answer, a finding you fix, a better route through a new file.
**Re-count both sizing figures the moment you add scope**, before you touch the new files. Within both limits,
carry on. Over either:

- **Before the first edit**, switching is free: load `PROPOSAL.md`, carrying the shared state across.
- **After the first edit**, do not switch, since the proposal path has no step for uncommitted source edits.
  Stop and report what is changed, what the widening adds, both new counts, and a split: the contained part
  finishes here and the rest becomes another change request. Under a lane, report to the orchestrator; alone,
  ask the owner. Never finish a small fix that papers over the larger problem you just found.

## 1. Prototype gate

Runs before the fix, since a prototype can change which files the fix touches. It fires when
`{{prototype_candidates}}` is not empty, or when the trigger changes a state model, transition or precedence
rule without saying what right looks like. When neither holds, the normal case, skip it silently.

Otherwise state the open question, then ask via `AskUserQuestion` (header `Prototype`): **Build a throwaway
prototype** (drive the model in a terminal app, about 15 minutes) or **Implement my best interpretation**,
stating it. On a build, invoke the `prototype` skill; its `FINDINGS.md` becomes the specification for the fix.
Never keep the prototype's code: rewrite it under the full rule set. Add the record under
`{cfg.design_decisions_dir}` to `{{files_changed}}`.

## 2. Implement

Follow `{cfg.code_change_standards}` § Pre-Edit Requirements. Break the fix into the code units you counted;
with three or more, run them on a task list per `{cfg.rules_dir}/task-lists.md`, and append later work
(review findings, doc edits) to the same list. Check `{{reusable_code}}` or search before creating any
constant, helper or type. Find the callers of a changed symbol with `rg` and then the typecheck (P14). Track
every file you create or modify in `{{files_changed}}`.

## 3. Gates

Run them by `{cfg.code_change_standards}`, which owns each command and skip condition:

1. § Targeted Typecheck after each unit.
2. § Lint over `{{files_changed}}`, including the cognitive-complexity warning you may not leave.
3. § Full Typecheck.
4. § File Size & Extraction Strategies for every file in `{{files_changed}}`, the ones you created included.
5. The acceptance-evidence pass: for each guarantee of the change, what would you observe if it were false?
   Build the evidence that needs no test. **A guarantee whose only evidence is a test goes in the handoff**
   under `#### ACs Owed a Test`.
6. § Pre-Done Literal Check.

An error confined to a test file is not yours to fix: list the file under `#### Test Files This Change Broke`.

## 4. Adversarial review

Every inline fix gets this review now and a full `review-changes` later; they find different things. State
`Fix touches <n> file(s): <files>`, then read `{cfg.adversarial_review_prompt}` and follow it. Substitute its
slots with literals: the files to review are `{{files_changed}}`, never a list discovered from git, which
carries other sessions' work; the project patterns are `{{project_patterns}}`.

Fix every in-scope finding. For an out-of-scope finding, fix it by default; ask the owner via
`AskUserQuestion` only for a real fork (two valid designs, a cross-cutting change), recording the fork, your
recommendation and the answer in `{{owner_decisions}}`. Work the owner sends to another change request goes to
`{{change_request_candidates}}`. Then run § Post-Fix Re-Validation, whose implementer arm is lint and
typecheck only.

## 5. Documentation

Walk every home the change could touch and either update it or state in one line why it is unaffected; a
silent skip and a considered one look the same afterwards. With three or more edits, add them to the task
list.

- **Design docs** (`docs/architecture.md`, `docs/plan.md`, `docs/roadmap.md`): the section describing any
  design this fix changed.
- **ADRs** (`{cfg.adr_dir}`): a fix that contradicts an ADR is reconciled explicitly, with a new ADR
  superseding it, never shipped silently against it. A new or superseding ADR that bans a pattern triggers
  the reverse sweep in `{cfg.rule_maintenance_guide}` § Procedure, in this change.
- **Requirements** (`{cfg.requirements}`): amend the requirement whose behavior changed, or add one with an id
  the orchestrator allocated. An inline fix has no ticket, so its marker is `[Unscheduled: <why>]` unless an
  existing ticket or sprint owns the requirement (`{cfg.rules_dir}/requirement-markers.md`). Run
  `node scripts/check-requirement-markers.mjs`.
- **Unbuilt tickets**: a ticket not yet built is a future instruction, and a stale one gets built as written.
  For each ticket not `done`, ask whether this fix did its work, removed a subject its criteria name, or
  reversed an approach they prescribe. Amend a `backlog` or `ready-for-dev` ticket in place; surface an
  `in-progress` one to the owner; leave `review` and `done` alone. Cancelling planned work is a plan change:
  put it to the owner.
- **Rules**: per `{cfg.rule_maintenance_guide}`, with its lint-hardening candidate check.
- **`{cfg.sprint_status}`**: an inline fix adds no ticket key.

Work the walk reveals but this fix did not do goes to the owner as a decision, never into a ticket written here.

## 6. The change record

Write it to `_agent-docs/.scratch/change-requests/<slug>.md`, where `<slug>` is two to four lowercase words
joined by hyphens. It stands in for a ticket for `create-tests` and `review-changes`, which read it exactly as
they read a ticket, and `review-changes` deletes it once the change is committed. It is a handoff, not a
record: every durable decision already lives in the ADR, requirement, rule or design-decision record you wrote.

```md
# Change request: <title>

## Change

<one paragraph in the consumer's terms: what was wrong and what is now true; the Step 0.5 verdict when one ran>

## Acceptance Criteria

- [x] AC1: <each guarantee of the change, as an outcome>

## Decisions

<one line per owner decision, lint-hardening candidate or deferred change request, each pointing at the
file that now holds it; write None. when there are none>

## Dev Agent Record

### Dev Handoff

Dev session: threadId <your session's threadId>

#### Test Files This Change Broke

None.

#### ACs Owed a Test

None.

#### Tests Owed

None.

### Tests Record

### Review Record

### Completion Notes

### File List

<every path in {{files_changed}}>
```

Write every `#### ` heading under `### Dev Handoff`, with `None.` under an empty one: an absent heading reads
to `create-tests` as a change that broke nothing. The later sessions add their own headings, as the ticket
template names them.

## 7. Hand off

Lead with the outstanding actions:

```text
TESTS OWED: run `create-tests` on <change record path> in a new session, and keep this session open for
the code bugs it sends back.
REVIEW OWED after the tests: run `review-changes` on the change record in its own session. It commits, or under a lane the orchestrator commits from its report.
```

Then list `{{files_changed}}`, the gates and their results, the adversarial review's outcome, and any
`{{owner_decisions}}` still unanswered, `{{change_request_candidates}}` and `{{lint_hardening_candidates}}` as
tables. This path does not commit.

**When the tests session sends a code bug**, fix the source, never the test; re-run the Step 3 gates over what
you changed, and `session_wake` its threadId with the paths.

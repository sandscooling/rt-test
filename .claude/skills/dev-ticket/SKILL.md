---
name: dev-ticket
description: Build a ready-for-dev ticket, validate it, and hand it to create-tests. Use when the owner asks to build or implement a ticket ("implement the next ticket", "build 3.2", "code up that one"). This is the building step; writing the ticket first is create-ticket. Resumes an in-progress ticket.
---

# Dev ticket

Implement a ready-for-dev ticket task by task, validate it, and move it to `review`. **Never `done`**, and never a
test: `create-tests` owns every test change and runs after you.

Read `_agent-docs/_flow-config.yaml` first. `{cfg.KEY}` below means that key's path and `scale.KEY` its switch.
Substitute every `{cfg.KEY}` and `{{variable}}` with its literal value before it reaches a spawned agent, which
reads neither the config nor `AGENTS.md`.

Companion files: [`SANITY.md`](SANITY.md), read at Step 4; [`IMPL-AGENTS.md`](IMPL-AGENTS.md), read at Step 5b
when the tasks split into independent groups.

Optional input: a ticket path or key (`3.2`, `3-2`, `3-2b`), which overrides selection.

## Operating rules

- **Check whether you are a lane member before your first edit.** Run `session_list` and read your own row: a
  `group` other than `null` or `orchestrator` means `_agent-docs/crew.md` and `{cfg.code_change_standards}`
  § Orchestrated Gate Delegation bind you. Claim every file before its first edit, report every status
  transition instead of writing `{cfg.sprint_status}`, and leave `bun run check`, staging and the commit to the
  orchestrator.
- **Ticket-file write scope.** You write only: task checkboxes, acceptance-criterion checkboxes, the resolution
  block beneath the Unverified Assumptions table, `### Dev Handoff`, `### Completion Notes` and `### File List`.
  The table has four columns and no resolution column, so a resolution goes under it, never into it. The one
  carve-out is Steps 4 and 5a, where a falsified assumption or a confirmed sanity finding corrects the task,
  Dev Note or criterion that rested on it.
- **Real fixes only.** A comment describing the problem, a TODO or a log line is not a fix. What you cannot
  resolve, you surface.
- **Select no rules.** The ticket carries curated rule ids and Step 5c expands them; never re-derive the set.
- **Write and edit no test file, and run no test.** A defect you meet that earns a test goes under
  `#### Tests Owed`; a test file your change breaks goes under `#### Test Files This Change Broke`.
- **Tick acceptance criteria at Step 8 only.**
- **A question only the ticket's author can settle goes to that session first.** Steps 4 and 5a surface these.
  The author is the session your dispatch names, or your lane's `create` member in `session_list`. Wake it with
  `session_wake` on its threadId, never its name, putting your own threadId in the message so the reply comes
  back to you. Ask, say what you wait on, then keep working every task the answer cannot change; end the turn
  only when nothing else remains, since the reply arrives as a new turn. With no author session, ask the owner.
- **When you delegate, four things never leave this loop**: the ticket file, the task list, the contract layer
  every delegated task calls, and every validation gate. `IMPL-AGENTS.md` owns the rest.
- **Bounded decisions go through `AskUserQuestion`; open-ended ones stay in prose.**

## 1. Locate

**A path or key given**: a path loads directly; a key resolves by globbing `{cfg.ticket_dir}/<N>-<M>-*.md`
(dots become dashes). Bind `{{ticket_file}}` and `{{ticket_key}}` (the file name without `.md`), set
`{{is_resume}}` false, and go to Step 2. **An argument you cannot resolve stops the run**; never fall through to
selection, which would build a different ticket than the one named.

**Otherwise** read `{cfg.sprint_status}` whole, in order:

- **Resume**: a ticket key in state `in-progress`. Load it and set `{{is_resume}}` true. Count the checkboxes
  under `## Tasks / Subtasks` only, and parse `### File List` into `{{files_changed}}`. Output
  `Resuming {{ticket_key}}, {{completed}}/{{total}} tasks done.`
- **Fresh**: otherwise the first ticket key in state `ready-for-dev`.
- **Neither**: ask whether to run `create-ticket`, take a path, or show the status file.

## 2. Load

**Check the ticket first**: `node scripts/fill-ticket.mjs --check {{ticket_file}}`. A non-zero exit means
authoring never finished (a `PENDING` marker, a placeholder, a lost section): stop and name what it printed.

Parse by exact heading:

- `## Unverified Assumptions` rows → `{{unverified_assumptions}}`. These are open questions, not facts.
- `## Execution Metadata`, its one yaml block → `{{area}}`, `{{is_consolidation}}`, `{{files_to_modify}}`,
  `{{files_to_create}}`. Each file list may be a flow list (`[a, b]`) or a block list (`- a` lines). A missing
  or unparseable key stops the run: the ticket needs `create-ticket` again.
- A `{cfg.design_decisions_dir}/<slug>/FINDINGS.md` cited in Dev Notes → `{{design_decision_record}}`. Bind
  the path and read it at Step 5c.

**Bind `{{pending_siblings}}` in two halves.** From the status file: every other ticket in this sprint not
`done`, each with its one-line scope from `{cfg.sprints_dir}/sprint-<N>-*.md`. Then
`node scripts/list-unbuilt-work.mjs --except <this ticket's id> <every file in files_to_modify and files_to_create>`: every other ticket not
`done` in any sprint whose ticket file or sprint section names one of those files or a folder holding one. Bind the union.

**Mid-sprint, the code is not the design**: it lacks what pending siblings add and still carries what they
delete. The by-file half finds work in other sprints, which a sprint-scoped list cannot see. Every gate below
that reasons from current code clears this list first.

**Read `{cfg.code_change_standards}` whole, whatever `scale.doc_sections` says**: this skill implements and
validates, so it uses nearly every section. Then read `{cfg.rules_dir}/task-lists.md`,
`{cfg.rules_dir}/review-shared.md` and `{cfg.rules_dir}/github-issues.md`.

On a fresh run set `{{files_changed}}` to []. Initialize `{{change_request_candidates}}` and `{{files_by_ac}}`.

**Do not set the status yet**: Step 4 can end the turn, and a ticket left `in-progress` with nothing built
tells every reader that work is underway.

## 3. File-size check

Measure each file in `{{files_to_modify}}` with `bun x oxlint <file>`, which applies the code-line cap
(`{cfg.code_change_standards}` § File Size & Extraction Strategies). Never count raw lines. A file already over
the cap: stop and say the file needs splitting first.

## 4. Sanity-check the ticket

Read `SANITY.md` and run it. It is a blocking gate.

## 5. Prepare to implement

**Set the status first**: `in-progress` in `{cfg.sprint_status}`, or under a lane, report the transition to the
orchestrator. It goes here because 5a is the first step that writes the ticket, and a run that dies after 5a
with the ticket still `ready-for-dev` resumes as a fresh one.

### 5a. Resolve unverified assumptions

Skip when `{{unverified_assumptions}}` is empty. Otherwise resolve every row before any implementation, by its
"How to check" and `{cfg.code_change_standards}` § Third-Party Semantics Verification: installed source under
`node_modules`, `.d.ts` first. A docs page or your recollection is not verification.

Write each outcome in the resolution block beneath the table, with the `file:line` you read:

- **CONFIRMED**: proceed, citing the source.
- **FALSE**: stop and re-plan before writing code. Correct every task, Dev Note and criterion that rested on it,
  and say what changed. When the re-plan swaps a mechanism the ticket chose, you propose the replacement with
  the evidence; one that changes shipped behavior goes to the author as a question before code, and one that
  changes only the code is yours to record and build.
- **UNRESOLVABLE**: say so, implement the path that fails safest, and flag it for review. Silence is never a
  confirmation.

**Before you record FALSE on the evidence of our own code, check `{{pending_siblings}}`.** A claim about the
sprint's end state reads as false against today's tree whenever an unbuilt sibling owns the code it rests on:

1. A sibling makes it true and lands before this ticket matters: not FALSE. Record it as pending on that
   ticket and build against the end state.
2. This ticket ships first: a sequencing question for the author ("ticket N owns X, so until it lands this
   sees `<state>`; acceptable?"). Never re-plan it away or absorb the sibling's scope.
3. No sibling owns it: FALSE. Re-plan as above.

A row about installed source settles on the source alone. A row you did not check is not a row you may skip;
say which and why.

### 5b. Plan the run

Read `## Tasks / Subtasks` now, after the gates that could rewrite it → `{{implementation_tasks}}`. No task
writes a test.

**Create the task list before Step 6 opens a file**, one task per entry, and work it by
`{cfg.rules_dir}/task-lists.md`.

**Then decide whether to delegate.** Group the tasks by the files each touches. When two or more groups are
file-disjoint, have no ordering between them, and together span more than 4 files, read `IMPL-AGENTS.md` and
follow it. Otherwise work Step 6 alone, the common case: a ticket that is one dependency chain delegates
nothing however many files it spans.

### 5c. Expand the rules and read the design

Insert no other work between this and the first edit, so the rules are in front of you when writing starts.

```sh
node scripts/expand-rules.mjs --from-ticket {{ticket_file}}
```

Bind its checklist block → `{{checklist_rules}}` and its project-context block → `{{project_context_rules}}`.
It must exit 0. A marker holding `none` selects nothing, which is valid; a marker holding ids that expands to
no rules means the gate is missing, so stop.

When `{{design_decision_record}}` is set, read that `FINDINGS.md` now, captions included: a capture read
without its Take and Ignore captions reads as a whole design, and you build the parts it rejected.

## 6. Implement

**One-piece flow**: each task runs the whole loop below and finishes before the next starts.

**Some tasks cannot close alone.** A required field added to a shared type or a renamed export leaves the tree
uncompilable until every site is updated, so tasks split across a contract, its producers and its consumers
form one typecheck-atomic unit: implement the group, gate it once, then mark every task in it with one `Edit`
and a `TaskUpdate` each. Say which you grouped and why; the test is whether the tree compiles with one done and the other not.

**When Step 5b delegated**, this loop is what you run for wave 0 and for every task that comes back
`UNAPPLIED`; `IMPL-AGENTS.md`'s wave gate replaces the per-task typecheck and size gates for the rest.

For each task:

**Name the rules binding it** before writing code, as ids with their own titles, verbatim:

```text
Binding for task 3: C3 Name every magic value · P17 Comment only a fact the code cannot state
```

Scope by relevance, never by whether lint enforces the rule. Unsure how one applies? Expand that single id
(`node scripts/expand-rules.mjs --doc checklist <id>`) rather than reasoning from its title. A task binding
nothing emits `none beyond code-change-standards`.

**Implement it** against the Dev Notes, `{{checklist_rules}}`, `{{project_context_rules}}` and
`{cfg.code_change_standards}`. Before creating any constant, helper or type, check `## Reusable Code`, then
search: the ban is on duplication, never on the new file a size split needs or on a constants module that names
a magic value. After renaming or reshaping a shared symbol, find its sites with `rg` and then the typecheck
(P14). Track every file you create or modify in `{{files_changed}}`.

**Then, still inside the task:**

1. **Targeted typecheck** by `{cfg.code_change_standards}` § Targeted Typecheck, naming any skip condition
   that applied. Fix and re-run until clean.
2. **File size**: `bun x oxlint` over every file the task touched, created ones included. Over the cap, extract
   now, while the boundaries are fresh.
3. **Mark it complete**: one `Edit` turning the task block's boxes to `[x]`, then `TaskUpdate` to
   `completed`. A task you could not finish stays `in_progress`.
4. **Per-criterion gate**, when this task closes out a criterion: append its files to `{{files_by_ac}}[AC]`.
   Once every task tagged with that criterion is `[x]`, run the targeted typecheck and `bun x oxlint` over the
   criterion's files together, which catches what a per-task check cannot.

After the last task, the `[x]` task blocks and the `completed` updates each equal the task count. Reconcile a
mismatch now.

**Consolidation sweep**, only when `{{is_consolidation}}`: for each pattern the ticket replaced, `rg` the whole
repository, fix every instance outside `{{files_changed}}`, and search again until it returns nothing. Record
anything genuinely unsweepable in `### Completion Notes` with its location and why.

## 7. Validate

**You run no test.** `create-tests` runs the suite on the tree you hand over, so every gate here is one that can
still change code. `{cfg.code_change_standards}` § Post-Change Validation owns the gates; this is the
implementer's order:

1. **Lint** by § Lint: `bun x oxlint` over `{{files_changed}}`, then `bun run lint` outside a lane. Leave no
   cognitive-complexity warning your change authored.
2. **Typecheck** by § Full Typecheck: `bun run typecheck` outside a lane; under a lane, the targeted typecheck
   of every workspace you touched, reporting the repo-wide one. An error confined to a test file is not yours:
   list the file under `#### Test Files This Change Broke`.
3. **Acceptance evidence.** For each criterion, ask what you would observe if it were false, and whether you
   looked for that. Build the evidence that needs no test: a traced code path, a command's output on a fixture,
   an exit code you read. **A criterion whose only evidence is a test goes under `#### ACs Owed a Test`**,
   naming the guarantee, for `create-tests`. Step 8 marks the criteria; this step builds the evidence.
4. **Adversarial review.** Read `{cfg.adversarial_review_prompt}` and follow it: it owns the spawn, the prompt,
   the delivery and the triage. Its files to review are `{{files_changed}}`, never a list from git, which holds
   other sessions' work; its project patterns are `{{project_context_rules}}`; its ticket rulings are every owner ruling and grill
   resolution the ticket records, verbatim, or `none`. Then run
   § Post-Fix Re-Validation, whose implementer arm is lint and typecheck. A self-review is no substitute: if the
   spawn cannot run, say so and name the skipped gate.
5. **Literal check** by § Pre-Done Literal Check over `{{files_changed}}`.
6. **Citations** by § Citation Shift Check: `node scripts/check-line-citations.mjs`, re-pointing each hit by
   name.

**Out-of-scope findings.** Anything real you do not fix here goes to `{{change_request_candidates}}` with a
ready-to-paste description, for `review-changes`, whose default is to fix it. Leave a finding to that pass only
when fixing it here needs a migration of stored state, touches more than 3 files outside `{{files_changed}}`,
changes a shared symbol with more than 5 call sites (count them with `rg`), or belongs to another sprint's
scope. Name the condition and the evidence. A small contained bug in a file you edited is fixed here.

## 8. Finalize

**Tasks.** Every task is `[x]`. An open task stops the workflow.

**Acceptance criteria, ticked here and nowhere else.** Completed tasks prove the work was done, not that the
guarantee holds. Tick a criterion only when every task tagged with it is `[x]` and you can name the Step 7
evidence. A criterion whose only evidence is a test stays `[ ]` under `#### ACs Owed a Test`; `create-tests`
ticks it once its test is proven. Toggle the box only, never the text.

**The record.** Fill `### File List` from `{{files_changed}}`, plus any dependency change `git status` shows.
Write what was done, each assumption resolution and anything left undone to `### Completion Notes`. Append
`{{change_request_candidates}}` in full and present them: `review-changes` works that list and fixes by default.
A candidate that carries a decision rather than a defect is named as the fork it is, with your recommendation.
Never file a GitHub issue or offer to; `review-changes` runs the closing scan.

**The README.** A change to user-visible behavior (the CLI, configuration, supported versions, what is
implemented) updates `README.md` in this change: correct each line it made false, touched or not, and keep its
Status to what is built. Under a lane, report the exact text unless your dispatch grants the file. No such change:
say so in one line in `### Completion Notes`.

**The handoff.** Under `### Dev Handoff`, write `Dev session: threadId <your self row's threadId>` and fill each
`####` heading, with `None.` under an empty one: `create-tests` binds them, and an absent heading reads as a
change that broke nothing.

**Status.** Set the ticket to `review` in `{cfg.sprint_status}`, or under a lane report the transition and your
created and modified paths to the orchestrator.

Output a summary, then name the whole remaining path:

> Next: `create-tests`, in its own session. It runs the suite, repairs and writes the tests, and sends code bugs
> back to this session, so keep this one open. Then `review-changes`, which sends its test gaps to the tests
> session.

## 9. Answer the tests session

`create-tests` wakes this session with a test that fails because the code is wrong: the test, the failure and
the guarantee it protects. Fix the source, never the test. Run the targeted typecheck and `bun x oxlint` over
what you changed, add the files to `### File List`, then `session_wake` the tests session's threadId with the
paths and one line on the fix. **A report you disagree with gets a reply, never a silent pass**: say why the
test is wrong, and the tests session decides.

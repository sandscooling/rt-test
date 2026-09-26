---
name: review-changes
description: The code review workflow for this repository; prefer it over the built-in /review, /code-review, /security-review and /simplify, which skip the rule expansion this project's review depends on. Reviews a ticket's implementation, an inline change record, or the uncommitted changeset. Use when the owner asks to review the code, review my changes, check my work, or names a ticket ("review 3.2"). The one exception is a GitHub pull request by number, which is the built-in /review.
---

# Review changes

A rule-driven review with an independent outside pass, which fixes what it finds and hands test gaps to the
tests session. Three modes: a ticket, an inline change record, or the uncommitted changeset.

Read `_agent-docs/_flow-config.yaml` first. `{cfg.KEY}` below means that key's path and `scale.KEY` its switch.
Substitute every `{cfg.KEY}` and `{{variable}}` with its literal value before it reaches a spawned agent, which
reads neither the config nor `AGENTS.md`.

Companion files: [`FRESH-EYES.md`](FRESH-EYES.md), read at Step 4 when you spawn; [`FIX-AGENTS.md`](FIX-AGENTS.md),
read at Step 7 when the fix manifest spans more than 5 files; [`TECH-DEBT.md`](TECH-DEBT.md), read at Step 9 once
the change is committed.

Optional input: `{{record}}`, a ticket path or key (`3.2`, `3-2b`) or a change record under
`_agent-docs/.scratch/change-requests/`.

## Operating rules

- **Check whether you are a lane member before your first edit.** Run `session_list` and read your own row: a
  `group` other than `null` or `orchestrator` means `_agent-docs/crew.md` and `{cfg.code_change_standards}`
  § Orchestrated Gate Delegation bind you. Claim every file before its first edit. Status transitions, the
  commit, and every project-wide file (rule docs, `docs/`, the status file, other tickets) are the
  orchestrator's: report the exact transition or text. The record under review is your lane's.
- **Under a lane, never commit.** Step 8 reports the change to the orchestrator, which stages and commits it;
  Step 9 runs against the sha it sends back. Outside a lane you are the owner's discussion session, and you
  commit by `{cfg.rules_dir}/git-commits.md`.
- **Evidence only.** Flag nothing you cannot prove with `file:line`.
- **Real fixes only.** A comment, TODO or log line describing a problem is not a fix.
- **Write and edit no test file.** Coverage gaps and broken tests go to the tests session (Step 7).
- **Rule edits follow `{cfg.rule_maintenance_guide}`**; the orchestrator allocates every new rule id.
- **Bounded decisions go through `AskUserQuestion`; open-ended ones stay in prose.**

## 1. Mode and files

**`{{record}}` given**: a ticket path or key resolves by globbing `{cfg.ticket_dir}/<N>-<M>-*.md`; a change
record path loads directly. **An argument you cannot resolve stops the run**, never a fall-through to scanning.
Otherwise read `{cfg.sprint_status}`: exactly one ticket in `review` is ticket mode, several means ask which, and
none means uncommitted mode.

A change record is read exactly as a ticket; never run `fill-ticket.mjs` on one. From the record read only the
sections named here: `## Acceptance Criteria` → `{{acceptance_criteria}}`; the `## Unverified Assumptions` table
and the resolutions beneath it → `{{unverified_assumptions}}` (a change record has none); the lines under
`#### Deliberately Untested` → `{{recorded_exclusions}}`; `Tests session: threadId` → `{{tests_session}}`; and
`### File List`. **Bind all of them in every mode**, `(none recorded)` where there is nothing: a spawned agent
reads an unbound variable as text it cannot parse and re-derives every exclusion as a finding.

**Uncommitted mode has no record, so two things come from elsewhere.** `{{tests_session}}` and `{{review_home}}`,
the file whose `### Review Record` Step 7 writes, come from your dispatch. Where no dispatch names one,
`{{tests_session}}` is `(none recorded)` and `{{review_home}}` is a change record Step 7 creates. Also bind
`{{change_summary}}`, what the changeset does in two or three sentences, and `{{owner_rulings}}`, each ruling the
owner or your dispatch gave on this change with its source and time, or `(none recorded)`. In the other modes
`{{review_home}}` is `{{record}}`.

**Bind `{{pending_siblings}}`, the unbuilt work bearing on this change, in two halves:**

- **By sprint**, ticket mode only: every other ticket in this sprint not `done`, with its one-line scope.
- **By file**, every mode: `node scripts/list-unbuilt-work.mjs <changed paths>`, every ticket not `done` in any
  sprint that names a changed file or a folder holding one.

Bind the union, each entry with its ticket id, state, scope line and the file it names; say `(none)` aloud when
both come back empty. The by-file half is the one a sprint-scoped list cannot produce: work sharing a file with
this change often sits in another sprint, and its criteria were written against the code before this diff.

**Discover the changed files** from `git status --porcelain --untracked-files=all`, which lists each new file
rather than its new folder, unioned with the record's File List. **Under a lane, keep only the paths your lane
holds in the claims store**, `node scripts/file-claims.mjs list --lane <your group>` (a folder entry covers what
is under it): the checkout holds other lanes' work. **The reviewed set is these changed files**, and that binds
every later step: an agent's search can reach a gitignored file that reads like live guidance, so run
`git ls-files --error-unmatch <path>` on any finding outside the set and drop it when that fails.

**Split the changed files:**

- `{{doc_batch}}`: every changed Markdown file, except the record under review and anything under
  `test/fixtures/`, which are deliberate inputs.
- **Code by area**: one group per workspace (`packages/<name>`, `apps/<name>`) and one for root tooling
  (`scripts/`, `lint/`). **A source file travels with its own tests**: a module is the source plus the test files
  that exercise it, and a changed test whose source did not change is a module of its own.

All empty: stop.

## 2. Load context

Read `{cfg.code_change_standards}` by its **Loading** paragraph: whole while `scale.doc_sections` is off. With it
on:

```sh
node scripts/doc-section.mjs {cfg.code_change_standards} "Universal gates" "File Size & Extraction Strategies" "Deleting an Exported Symbol" "Lint" "Targeted Typecheck" "Full Typecheck" "Full-Suite Validation" "Post-Fix Re-Validation" "Test Coverage Recommendation" "Citation Shift Check" "Writing Tests Outside create-tests"
```

Then read `{cfg.rules_dir}/review-shared.md` (the severity ladder and the incompleteness search),
`{cfg.rules_dir}/task-lists.md` (the fix loop) and `{cfg.rules_dir}/github-issues.md` (Step 9).

**Bind the rules**, a blocking gate:

- **Ticket mode**: review against the contract the dev built to:
  `node scripts/expand-rules.mjs --from-ticket {{record}}`. Never re-derive a fresh set.
- **Change record and uncommitted modes**: select from the diff. Read `{cfg.project_context}` whole and pick the
  project-context ids. For the checklist, follow `{cfg.rules_dir}/context-fanout.md`: while
  `scale.rule_selection` is `whole`, read the shards `{cfg.checklist_dir}/_index.md` names for the changed areas
  and pick ids inline; while it is `menu`, spawn the `ctx-checklist` agents it describes, with `git diff --stat`
  and a characterization of the diff as `code_facts:` (the diff is the code, so there is no wave 1). Then expand
  both: `node scripts/expand-rules.mjs --ids checklist=<ids> --ids project-context=<ids>`.

Bind `{{checklist_rules}}` and `{{project_context_rules}}` verbatim for this thread. Bind two commands for agents
to run themselves, never their output:

- `{{rules_command}}` for fresh-eyes agents: `node scripts/expand-rules.mjs --doc project-context <ids>`, the
  ticket's project-context marker ids or the ones you selected. It leaves the checklist out on purpose, so a
  fresh-eyes pass is not steered by it.
- `{{fix_rules_command}}` for fixers: `--from-ticket {{record}}` in ticket mode, otherwise the `--ids` call above.
  A fixer writes code this review judges, so it needs both docs.

**ADR constraints** → `{{adr_constraints}}`, collected at Step 5. While `scale.ctx_agents` is on, spawn `ctx-docs`
in the background for them; otherwise render `node scripts/adr-index.mjs` and read each ADR in `{cfg.adr_dir}`
whose decision touches a changed area. An ADR records a path deliberately not taken, and nothing else in this
review reads them.

**Build `{{file_review_plan}}`**: map checklist rules to files. `engineering-core` rules apply to every code file,
`testing` rules to test files and `defects.json` records, `daemon-cli-state` rules to the daemon, CLI, store,
adapters and defect verifier. Then drop each rule the file's code cannot exercise.

## 3. Size and coverage gates

**File sizes**: `bun x oxlint` over each changed production file reports the code-line cap by
§ File Size & Extraction Strategies. For batching, count each file's code lines, blank and comment lines excluded:
`rg -c -v "^\s*($|//|/?\*)" <file>`. Store the counts.

**Coverage**, skipped in uncommitted mode:

1. **Read `{{recorded_exclusions}}` first.** A file deliberately left untested is an answered question. An
   exclusion whose reason the diff contradicts is an ordinary finding.
2. **Name the defect or move on**, by § Test Coverage Recommendation. A gap is a specific defect (an inverted
   comparison, a dropped guard, a write that never happens) no current test catches. Before recording one, find
   the covering test: list the module's test directory and `rg` the symbol, since coverage lives under other
   names. Where "already covered" is in doubt, settle it by mutation, with the mechanics that section gives.
3. **Sweep the criteria**, which a file walk cannot: for each, state its guarantee, follow the code that makes it
   true across files, and name the test that goes red if it breaks. None is a gap even when every file reads as
   covered.

Record each gap with its source file, the named defect verbatim, the expected test, and severity by
`{cfg.rules_dir}/review-shared.md` § Finding severity. **A defect this change makes possible stays a gap until
its own named test exists**, by § Test Coverage Recommendation, even when an existing test goes red on it: the
row names that test, so the tests session can decide where the new one lives. State the denominator as well:
the named-defect tests in the touched test files against the behaviors the criteria name.

## 4. Three passes at once, plus the checklist pass

**Compute every batch first, then announce them, then spawn them all in one message**, each in the background. A
batch worked out at the moment of its spawn produces a serial launch.

**Fresh-eyes batches.** Read `FRESH-EYES.md` for the prompt. Batch by module within an area, a hard boundary.
Split an area until every batch holds at most **2,500 code lines**, repeatedly: by package or folder, then
subfolder, then module. **A single module over the cap is its own batch** and is never divided. Bin-pack the
remainder by code lines, largest first, into the batch with the most headroom. **Write the batch table (label,
modules, code lines) before spawning.** Past six batches, say so and ask the owner rather than spawning more.

**Doc-verify**, when `{{doc_batch}}` is not empty: a `general-purpose` agent with the prompt below. Measure each
doc's change with `git diff -U0 -- <file> | wc -c`, and while a batch exceeds **40,000 characters**, split it into
`doc-verify-1`, `doc-verify-2`, bin-packing whole files largest first; a file over the cap is its own agent. Past
three doc agents, say so and ask.

> Verify these documentation changes against the source: `{{doc_batch}}`.
>
> Run `git diff -U0 -- <file>` on each, all in one message as parallel calls, and work only the changed lines.
> Where a changed line's meaning depends on its surroundings, open that one file at that line.
>
> **Every claim you check comes off a changed line.** An id, path or count you meet in unchanged text belongs to
> text this change never touched. Check every claim the new text makes that can be checked: a named file, path,
> symbol, export, flow config key, script or flag resolves; quoted code matches the source; a stated count
> recomputes; a cited rule, ADR or requirement id exists; a described behavior matches what the named symbol
> does. Prove each with `file:line` on both sides.
>
> **List the claims first, then check them in rounds** of up to eight parallel calls, reading the answers
> together. Only a check whose input is another's output waits for it.
>
> **A claim about a third-party library's behavior is not yours**, and you must not read `node_modules`: list
> the claim, the package and symbol it rests on, and mark it DEFERRED. A claim about work that does not exist yet
> (a planned ticket, an unbuilt criterion, an ADR's rationale) is not a discrepancy.
>
> For each discrepancy give the doc quote, the source evidence, and which side you believe is wrong, with your
> reason. Give a verified claim one line.
>
> Edit nothing, run no lint, typecheck, test or build, and create or update no tasks: other agents run beside
> you and the task list belongs to the caller.
>
> You run in the background, so your final message is not reliably delivered. Load SendMessage in your first
> message: `ToolSearch({query: "select:SendMessage", max_results: 1})`. As your last action send the complete
> report with `SendMessage(to: "main")`, saying "no discrepancies" explicitly when there are none.

**Assumptions**: one `general-purpose` agent owns every question about installed third-party behavior for the
whole wave, so no other agent reads `node_modules`. Spawn it when any trigger holds: `{{unverified_assumptions}}`
has rows or resolutions; the diff adds or bumps a dependency in a `package.json` or `bun.lock`; or the diff or its
comments make a checkable claim about a library (a named option, a callback contract, an ordering or cleanup
semantic). **A table reading None is a claim to check**: feed the agent the answers recorded in Dev Notes and
comments, and ask whether each is correct.

> Settle these questions about installed third-party behavior. Read the installed source under `node_modules`
> and nothing else; this project's own code is other agents' work.
>
> {{unverified_assumptions}}
>
> Pin the version first: resolve the installed path (under `node_modules/.bun/<pkg>@<version>/` or a workspace
> copy) and read its `package.json`. For each row: was it resolved, and is the recorded answer correct? Answer
> CONFIRMED, WRONG or UNRESOLVED with `package/file:line` evidence, and where it is WRONG say what the source
> does. Then add the questions the rows do not ask: a default, a required option, a cleanup or ordering semantic
> the diff would break on.
>
> Batch your reads in rounds of up to eight parallel calls. Edit nothing, run no validation, and create or update
> no tasks. Load SendMessage in your first message: `ToolSearch({query: "select:SendMessage", max_results: 1})`.
> As your last action send the complete report with `SendMessage(to: "main")`.

**In ticket mode, check one claim yourself**: the record's File List against the actual diff. A changed file the
List omits is a discrepancy in the record every later gate reads.

**In every mode, check the product docs yourself for lines this change made false**, since doc-verify reads only
changed lines. When the diff changes user-visible behavior (the CLI, configuration, supported versions, what is
implemented), read `README.md`, `docs/plan.md`, `docs/architecture.md` and `docs/roadmap.md` for what they say
about it, touched or not. Each line now false is a doc discrepancy, and so is a README Status that claims what is
not built or omits what now is.

**Then run the checklist pass without waiting.** Read each file and review it against its rules in
`{{file_review_plan}}`. Record each violation with the rule id, `file:line`, the issue, the fix, and severity,
surface and reach by `{cfg.rules_dir}/review-shared.md` § Finding severity. Then run that doc's incompleteness
search as a pass of its own.

## 5. Collect and triage

Reports arrive as messages. An agent idle without sending had its message dropped: ask it to resend, never re-run
the batch, and never read silence as clean.

**Filter each finding** against `{{project_context_rules}}`: a documented direction is discarded; a genuine
issue in new code joins `{{findings}}`; one in existing code joins `{{tech_debt}}` with its full text, never a
topic label.

**A duplication finding goes to `{{tech_debt}}`** even when the change created the second copy: its fix reaches
the first copy in a file this change never opened, growing the change past what this review measured. Record a
`file:line` on each copy. The new copy's own defects (a comment misdescribing it, an input its sibling does not
take) stay in `{{findings}}`.

**Check every finding against `{{pending_siblings}}`**, reading each candidate's criteria, not its title:

- **The sibling's criteria re-author the same function or signature**: drop it from the manifest as
  `folded into <ticket>`.
- **Otherwise fix it here**, naming the criterion you checked.
- **The finding invalidates the sibling**: carry it to Step 8's reconciliation.

**A finding resting on an absence** ("nothing imports this", "no helper exists") is verified before it is
accepted: the agent saw one batch and asserted a repository-wide negative. Re-run the search unscoped.

**A testing finding** is discarded when its file is a recorded exclusion and the finding names no defect the
reason misses; merged into an existing gap when it names the same defect; and otherwise moved to the gap log,
out of the findings count. Uncovered behavior and a defective test (asserts nothing, mocks the code under test,
survives its own mutation) both go to the tests session.

**ADR conformance.** For each binding constraint in `{{adr_constraints}}`: does the diff do what the ADR decided
against? Three outcomes:

- **The code contradicts an accepted ADR**: a HIGH finding, CRITICAL where the ADR protects a product guarantee.
- **The code is right and the decision is genuinely open**: a supersession item, recommending `change-request`.
- **The decision was already reversed elsewhere** (a later ADR, a sprint file) and this artifact is a citation the
  earlier sweep missed: correct it in place, cite the reversal, and sweep the remaining citations in live docs and
  unbuilt tickets only.

**Third-party assumptions.** A row the assumptions agent marks WRONG is a finding ranked by the severity ladder.
A fresh-eyes finding that assumed a library default is confirmed or discarded against its report, and so is each
DEFERRED doc claim. **A deferred claim its report does not reach is yours to settle** here.

**Doc discrepancies: which side is wrong is your call, never the agent's.**

- **The doc is stale**: correct the prose.
- **The doc is right and the code is wrong**: a code finding, ranked by the ladder. A change that edited a doc to
  match what it built has documented its own defect.
- **Neither**: the claim is about planned work. Discard it.

Never default to making the sentence match the code; in the diff the second case looks exactly like the first. A
corrected doc takes the citation sweep: search the identifier and update live docs and unbuilt tickets.

**Rule gaps.** For each valid finding, ask whether a rule would have prevented it: generalizable beyond this file,
not already covered, statable as a check or a direction, and likely to recur. Record NEW or STRENGTHEN, the target
doc by the guide's routing test, and whether it is a lint-hardening candidate.

## 6. Present, then fix

`{{grand_total}}` counts what Step 7 fixes: findings, checklist violations, size violations and doc discrepancies.
Coverage gaps, tech debt and rule proposals are listed below the total, since each is handed off rather than
fixed here.

**Present tech debt in full now, and triage it at Step 9**, against the committed change. Ask no disposition yet:
every disposition turns on a scope nobody has measured.

**Fixing is the default.** Do not ask permission to fix what this review found; present it, so the owner can stop
you, and go straight to Step 7. A finding goes to the owner only when its fix needs a decision nobody here can
make (a product fork, a new requirement, a design with more than one defensible answer): bring it as a
discussion with your recommendation. Never file a GitHub issue or offer to.

With `{{grand_total}}` at 0, say so, run Step 7's gap handoff if there are gaps, then go to Step 8.

## 7. Fix and validate

**Compile the fix manifest** from the findings, violations and doc discrepancies. Tech debt stays out of it. Mark
each `is_doc_fix` only when the edit is confined to comments, whitespace or Markdown prose; a doc discrepancy
resolved against the code, a rename, or an import reorder is a code fix.

**A finding's rationale goes in the record, never a code comment** (P17). No test file enters the manifest.

**The gap handoff**, once the manifest's fixes are on disk and before validation: under `{{review_home}}`'s
`### Review Record`, write `Review session: threadId <your self row's threadId>`, the undisposed tech-debt items in
full, and then the gap block under **exactly** `#### Test Coverage Gaps`, on its own line, one row per gap with
its defect sentence verbatim, and `None.` when there are none. `create-tests` searches for that heading, so a
reworded one drops the whole log without a word. Then `session_wake` `{{tests_session}}` with `{{review_home}}`,
the instruction to work those rows, and your threadId for the reply. **Wait for the reply before validating**,
since its tests are part of the tree the suite measures. Under a lane, tell the orchestrator when you send it. No
tests session reachable: ask the owner to run `create-tests` on the record, and wait. **When Step 1 fell back to
a created `{{review_home}}`**, create it first as `_agent-docs/.scratch/change-requests/review-<YYYY-MM-DD-HHMM>.md`,
holding `## Change` (`{{change_summary}}` and `{{owner_rulings}}`), `### File List` (the reviewed set) and
`### Review Record`; it is a change record from then on.

**A test your fix round breaks** is triaged by § Full-Suite Validation: a regression is fixed in the source here,
and a test asserting behavior your fix deliberately changed goes to the tests session as a gap row.

**Create one task per manifest item** and work them by `{cfg.rules_dir}/task-lists.md`. For each: mark it
`in_progress`, read the file whole, apply the fix, then the targeted typecheck unless the edit was comment-only by
§ Targeted Typecheck's definition. A fix that no longer applies is marked `completed` with the reason.

**When the manifest spans more than 5 files, delegate by `FIX-AGENTS.md`.** The task list, the record and every
validation gate stay here.

**Re-verify every gap row against the tree you hold now.** The fix round may have closed one; drop a row a test
now catches and say it was refuted.

**Validate, in this order**, by § Post-Fix Re-Validation, scoping every gate from the fix round:

1. **File size**: `bun x oxlint` over every file this step edited, unless the round was documentation-only. A file
   now over the cap gets its own task and an extraction.
2. **Lint and typecheck**: under a lane, `bun x oxlint` over the edited files and the targeted typecheck of each
   touched workspace; outside a lane, `bun run lint` and `bun run typecheck` scoped by § Full Typecheck. Never
   both pairs.
3. **The suite, last, once the tree is final**, by § Full-Suite Validation, scoped from the fix manifest and
   stating `<selected> of <total>`. Mandatory whenever a code fix landed.
4. **Named defects**: `bun run test:defects` when a fix touched a named-defect test or a line a defect record
   mutates.
5. **Citations**: `node scripts/check-line-citations.mjs` whenever a fix inserted lines; re-point each hit by
   name.

Take § Post-Fix Re-Validation's comment-only or outside-the-graph exemption only when every fix qualifies, and name
it.

## 8. Complete

Validation must pass first.

**Ticket mode.** The ticket becomes `done` when the review is clean or its fixes validated, and `in-progress`
otherwise. Write it to `{cfg.sprint_status}`, or under a lane report the transition. **Close the sprint when this
ticket was its last open one**: a ticket holds its sprint open while `backlog`, `ready-for-dev`, `in-progress` or
`review`. When none remains, the sprint becomes `done` (report it under a lane), and say which tickets closed on
something other than `done`, since `deferred` work left the sprint rather than shipped. Then run
`node scripts/check-sprint-keys.mjs` and `node scripts/check-requirement-markers.mjs`; each must exit 0. Read
`{cfg.rules_dir}/requirement-markers.md` before correcting a marker either names.

**A design-decision record expires with its implementing work** (`{cfg.design_decisions_dir}/README.md` rule 4).
When this review completes the ticket or change a record's `**For:**` line names, delete that record's folder, or
under a lane report the path for the orchestrator to delete.

**Every mode:**

- **Rule proposals**: apply each by `{cfg.rule_maintenance_guide}`, with its lint-hardening candidate check. Ask
  the orchestrator for each new id; under a lane, report the exact rule text.
- **Reconcile unbuilt work** against what this change did. Re-run
  `node scripts/list-unbuilt-work.mjs <changed paths>` first, since the fix round moved files, and read each hit's
  ticket file or sprint section. Ask only what the diff can answer: did this change already do the ticket's work,
  remove its subject, or move ground under a criterion? Act by state: amend a `backlog` or `ready-for-dev` ticket
  in place (under a lane, report the exact edit); surface an `in-progress` one to the owner; leave `review` and
  `done` alone. A ticket this change cancelled goes to the owner. Nothing found gets one line.
- **Gaps sent**: one line with the count and the paths the tests session replied with.

**Report to the orchestrator** (`_agent-docs/crew.md` § Your report): the created and modified paths as separate
lists, covering the dev's code, the tests session's tests and your fixes; each gate with its exit code, counts and
window; the named defects and whether `test:defects` detected them; and every transition, rule text and deletion
it must apply. Then wait for the commit sha. Outside a lane, commit by `{cfg.rules_dir}/git-commits.md`.

**A change record is deleted once its change is committed**: remove it when the sha arrives.

## 9. Tech debt

Read `TECH-DEBT.md` and work the debt this review collected, against the commit Step 8 produced. Nothing in this
step starts before that sha exists.

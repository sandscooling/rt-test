---
name: create-ticket
description: Draft the next ready-for-dev ticket from the sprint backlog. Use when the user asks to create, draft, write up, or spec a ticket ("create the next ticket", "write up ticket 3.2", "get the next one ready"). This is the authoring step; building an existing ticket is dev-ticket. Produces a self-contained ticket file the implementing session consumes.
---

# Create ticket

Draft the next backlog ticket into a self-contained file, settle its open decisions with the owner, and mark
it ready for dev.

Read `_agent-docs/_flow-config.yaml` first. `{cfg.KEY}` below means that key's path, and `scale.KEY` its
switch. Substitute every `{cfg.KEY}` and `{{variable}}` with its literal value before it reaches a spawned
agent, which reads neither the config nor `AGENTS.md`.

Companion files, read only when their trigger fires:

| File              | Read when                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `SWEEPS.md`       | An acceptance criterion removes or moves a symbol, or corrects prose describing one              |
| `GATES.md`        | The sizing gate ends in a split, the ticket is novel, or the grill leaves a design question open |
| `REVIEW.md`       | Step 6c, when you spawn the reviewer                                                             |
| `FINALIZE.md`     | Step 7                                                                                           |
| `SANITY-CHECK.md` | Step 7 before the handoff line, and whenever a `TICKET SANITY CHECK` block arrives               |

## One-ticket size limits

One ticket is at most **20 estimated files** and **15 code units**. Every workflow that sizes work against a
ticket uses these two limits.

- **Code units** (`sizing_ac_count`): the acceptance criteria that need a code change, plus one for
  validation. Rewording or splitting a criterion for clarity adds none; the count measures scope.
- **Estimated files**: the raw file count times **1.3**, which covers scope found only while implementing.
  The multiplier is a target, not yet fitted to this project; refit it against the commits of done tickets,
  counting tests on both sides, once a sprint's worth exist.
- **The raw file count already includes test files**: every file to modify or create, every existing test
  file the change breaks, and every file a sweep criterion touches. Never apply a second multiplier for tests.
- **Repetition moves the file limit.** A mechanical sweep (the same edit at every site) may run past 20
  files; name the one repeated edit and size the ticket on its decision-bearing files alone, reporting the
  sweep as a separate figure.
- **The file limit assumes decomposition.** 20 applies when the work splits into task groups touching
  disjoint files; a single dependency chain through one subsystem wants 10 whatever the count says.

## Operating rules

- **Check whether you are a lane member before your first shared-file write.** Run `session_list` and read
  your own row: a `group` other than `null` or `orchestrator` means you are, and `_agent-docs/crew.md` plus
  `{cfg.code_change_standards}` § Orchestrated Gate Delegation bind you. Under a lane the status
  file, the sprint file and the requirements are the orchestrator's: report the exact text you need unless
  your dispatch granted the path. The ticket file is yours.
- **Ask for every id; never take the next free one.** The orchestrator allocates ticket keys, requirement
  ids, ADR numbers and rule ids, because two sessions taking the next free id take the same one. A split or a
  new requirement starts with one message asking for the ids and any grant it needs.
- **Rule text never passes through you.** The ticket stores rule ids; `scripts/expand-rules.mjs` renders the
  text. Never copy, paraphrase or retype a rule into a file.
- **The ticket is read as already verified, so verify what a reader will act on.** Before you run a check,
  say what result would falsify the claim, and go get that. A fenced command must have run; a stated count
  sits beside the command that produced it; a named symbol is one you opened. A claim that closes a door
  ("none of these is reusable", "all N do X") gets the hardest check, whether an agent or you made it.
- **A claim about third-party behavior you did not read in installed source is a question** for
  `## Unverified Assumptions`, never an acceptance criterion.
- **Never restate a figure another doc owns.** Cite the rule, requirement or ADR that holds it.
- **Spawned agents only read and report.** You perform every file write.
- **Bounded decisions go through `AskUserQuestion`; open-ended ones stay in prose.**

Optional input: a ticket key or number (`3-2`, `3.2`) or a ticket path.

## 1. Target ticket

Given a number or path, parse `sprint_num`, `ticket_num` and `ticket_key`. Otherwise read
`{cfg.sprint_status}` whole and take the first ticket key in state `backlog`. With none, stop and tell the
owner that `change-request` plans new work. The key names the file: `{cfg.ticket_dir}/<ticket_key>.md`.

## 2. Scope

Read the sprint file `{cfg.sprints_dir}/sprint-{{sprint_num}}-*.md`: its objective, and this ticket's heading,
scope line and any acceptance criteria still under it → `{{ticket_requirements}}`. Store the sprint objective
as `{{sprint_context}}`.

**Bind `{{pending_siblings}}`**: every ticket not `done` in this sprint, plus every ticket not `done` in any
sprint whose section or ticket file names one of this ticket's target files or a folder holding one:
`node scripts/list-unbuilt-work.mjs <each file in {{files_to_modify}} and {{files_to_create}}>`. It searches both
homes, since a drafted ticket file names paths its one-line sprint scope does not, and prints each hit under the
ticket heading or ticket file that holds it, with its state from `{cfg.sprint_status}`. Re-run it whenever the
file list widens.

**Mid-sprint, the code is not the design**: it lacks what pending siblings add and still carries what they
delete. Route every finding that rests on something a sibling owns:

1. A sibling owns it and its absence does not affect this ticket until then: one Dev Note naming the owner.
2. This ticket ships first: a sequencing question ("ticket N owns X, so until it lands this ticket sees
   `<state>`; acceptable?"), never "should this ticket build X?"
3. No sibling owns it: handle it normally.

Never resolve any of them by absorbing a sibling's scope.

**Check open GitHub issues once**: `node scripts/list-open-issues.mjs`, then read the ones that bear on this
ticket. A `SKIP:` line with exit 0 means GitHub was unreachable, so continue. A non-zero exit means the list
was truncated: raise `--cap` and re-run. Verify an issue's claims against the current tree before leaning on
them (`{cfg.rules_dir}/github-issues.md`). Record each issue you read under `### References` as
`#N: <what it gives this ticket>`, including the ones you rejected and why.

Store `{{area}}` (the workspaces or root tooling the ticket touches), `{{ticket_features}}` (short noun
phrases), `{{files_to_modify}}` and `{{files_to_create}}`. Both lists are rough until Step 3 corrects them.

## 3. Discovery

Read `{cfg.rules_dir}/context-fanout.md` first: it owns whether context comes from your own reads or from
`ctx-*` agents, the wave order, the checklist split and the merge.

**While `scale.ctx_agents` is off**, gather each dimension inline as that doc directs: impact and callers with
`rg`, the docs and glossary the ticket touches, and the checklist shards `_index.md` names for this area.

**While it is on**, run the fan-out with this subject in every prompt, varying only the `Return:` line:

```text
subject:
  description: {{ticket_requirements}}
  area: {{area}}
  features: {{ticket_features}}
  target_files: {{files_to_modify}}
  sprint_num: {{sprint_num}}
  ticket_num: {{ticket_num}}
  sprint_candidates: {{sprint_candidate_block}}
  outputs: ids
```

| Agent                    | `Return:` line                                    |
| ------------------------ | ------------------------------------------------- |
| `ctx-impact` (wave 1)    | blast radius and breaking consumers               |
| `ctx-reuse` (wave 1)     | the REUSE and CREATE list                         |
| `ctx-docs` (wave 1)      | the documentation extract, plus `=== DOC_IDS ===` |
| `ctx-files` (wave 1)     | current-structure tables for `target_files`       |
| `ctx-checklist` (wave 2) | the ids of the relevant checklist rules           |

**While `scale.sprint_context` is on**, load the sprint's bundle first, per the `sprint-context` skill's
`BUNDLES.md` § Reading a bundle, and bind `{{sprint_candidate_block}}` from it; while it is off, bind `""`.

**Either way, do these yourself:**

- **Project-context ids.** Read `{cfg.project_context}` whole and note the id of every rule bearing on this
  ticket → `{{project_context_ids}}`. Keep rules that encode a project decision or a non-obvious direction.
- **Previous-ticket intel.** Walk `{cfg.sprint_status}` upward to the nearest earlier ticket in this sprint;
  never compute its number, since split tickets carry letter suffixes. When it is past `backlog`, read its
  `## Dev Notes` and `### Completion Notes` and `git log --oneline -20` → `{{prev_ticket_intel}}`. Where
  its notes disagree, the later section wins, and the shipped code beats both.

**Bind the results**: impact → `{{blast_radius}}` and `{{breaking_consumers}}`; reuse → `{{reusable_code}}`;
docs → `{{documentation_extract}}` and `{{doc_ids}}`; structures → `{{target_file_structures}}`; checklist
ids → `{{checklist_ids}}`, or `none` when nothing applies.

**Every agent report is an input to verify, not a conclusion to embed.** Before a claim about our code
becomes a criterion, a Dev Note or a rejected alternative, open the file it names. A claim that becomes a
write instruction ("that comment cites the function by line range") is as dangerous as one that closes a door.
Cite a site by name once you have opened it; the line number is the part that rots.

**Absorb every production file discovery named** that is not already in `{{files_to_modify}}`, after checking
it against `{{pending_siblings}}`.

**Render the requirements index**: `node scripts/requirements-index.mjs` → `{{requirements_index}}`. Map each
criterion to a requirement at Step 5 against it, and cite only ids it printed.

## 4. Sizing gate

Compute both counts by § One-ticket size limits, running every sweep grep the counts need now (`SWEEPS.md`),
so a stale-prose site lands in the count before the owner answers against it. Find the test files a change
breaks by grepping the observable the tests read, never only the test blocks whose subject you changed.
Show the owner both the raw and the estimated count.

- **Estimated files above 10**: report both counts and say the implementation will be delegated to
  implementer agents. A report, not a question.
- **Estimated files above 20, or code units above 15**: name which limit was crossed and ask via
  `AskUserQuestion` (header `Sizing`): **Proceed as-is** or **Split**. On a split, read `GATES.md` § Split.
- **Over the file limit with no decomposition**: say so, since the limit's price assumed disjoint groups.

**Before proposing any split, re-read `{{pending_siblings}}`**: a split line most often falls on a boundary a
planned ticket already owns. For each proposed piece, say whether an unbuilt ticket names its files.

**Novelty is a separate axis that splitting does not reduce**: a new dependency, a major version bump, or the
first call in this repository to a third-party API. Read `GATES.md` § Novelty.

Recompute both counts whenever a later step adds files.

## 5. Write the ticket

`{{ticket_file}}` = `{cfg.ticket_dir}/{{ticket_key}}.md`. Copy `template.md` from this skill's folder to it,
never assembling it with a wholesale `Write`, then fill it:

```sh
node scripts/fill-ticket.mjs --scaffold {{ticket_file}}
node scripts/fill-ticket.mjs --fill {{ticket_file}} <sections-file>
node scripts/fill-ticket.mjs --ids {{ticket_file}} "checklist={{checklist_ids}}" "project-context={{project_context_ids}}"
node scripts/fill-ticket.mjs --check {{ticket_file}}
```

**Author against exactly what `--scaffold` prints**: one block per `##` section, child headings already inside
their parent's block, and the rule-id, metadata and Dev Agent Record sections left out. Write the sections
file with the `Write` tool, under `_agent-docs/.scratch/create-ticket/`. The title line is an `Edit`. `--fill`
aborts the whole batch on a heading it cannot find; `--check` must pass before you move on.

Fill in order:

1. **Ticket**: the user story, from `{{ticket_requirements}}`.
2. **Acceptance criteria**: numbered `AC1`, `AC2`, from `{{ticket_requirements}}`. **A criterion states an
   outcome, never a mechanism.** Test it: if the library works differently than assumed, does it survive? A
   mechanism in a criterion gets implemented instead of evaluated. A criterion may name one of our own
   verified symbols. Map each criterion to a requirement in `{{requirements_index}}`; where none covers it,
   draft a new requirement or an amendment → `{{requirement_proposals}}`, which `FINALIZE.md` applies.
3. **Unverified assumptions**: one row per third-party claim you inferred rather than read, as a question
   with a one-line way to check it. A question that is not about a third party (two of our docs disagreeing,
   a bound nobody owns) goes in Dev Notes under `#### Open, for the grill`, with its assumed answer.
4. **Tasks**: from the criteria, each tagged `(AC1)`, `(AC1, AC3)` or `(Support)`. Keep the template's
   assumption task first while the table has rows. No task writes a test.
5. **Reusable code**: from `{{reusable_code}}`.
6. **Dev Notes**: patterns with their sources, the current structure of each modified file, glossary terms
   verbatim, `{{prev_ticket_intel}}`, and each existing test file the change breaks.
   - **Quote the clause a criterion rests on**; cite everything else. The reviewer at 6c reads only this
     ticket, so an ADR, requirement or rule clause a criterion is built on must appear as text.
   - **A decision note names the scope of its analysis** ("no guard needed for X; Y is unanalyzed").
   - **A code block shows only a shape that already exists here**, quoted from the file you verified.
7. **Rule ids**: the `--ids` call, with `none` for an empty selection. Never hand-edit a marker line.

If any criterion removes or moves a symbol, or corrects prose describing one, read `SWEEPS.md` before
writing it.

Then expand the ids once for this session: `node scripts/expand-rules.mjs --from-ticket {{ticket_file}}`. It
must exit 0, and a warning that an id no longer resolves is fatal here: the ids were chosen minutes ago, so a
missing one is a typo to re-select, never to drop. Bind the output as `{{bound_rules}}`; never write it into
a file.

Output: `Draft saved to {{ticket_file}}.`

## 6. Settle, grill, review

### 6a. Settle facts

Every Unverified Assumptions row is a candidate. Climb the cheapest rung first: installed source under
`node_modules` (`.d.ts`, then `.js`), then the planning docs, then the smallest real exercise in
`_agent-docs/.scratch/`. A row earns a spike only when its answer would flip a criterion, add or remove a
task, move a REUSE to a CREATE, or change a stated bound. Timebox about ten minutes and name what you did not
reach. For each fact settled, record it in Dev Notes with the observed output and the command or source
location that produced it, delete the row, and fix what the ticket drafted against the old belief →
`{{spiked_facts}}`. A spike that falsifies a documented rule is a finding: follow
`{cfg.rules_dir}/blocking-rule.md` and record each file you touch in `{{grill_doc_edits}}`.

**Check every settled fact forward**: grep the backlog for the package, constant or rule it rests on, since
an unbuilt ticket that changes it makes the fact temporary.

**Build `{{grill_seed}}` by inventory.** Read the draft start to finish and list every place a choice was made
or deferred: a chosen behavior, a closed topic, a bound and what happens when it engages, a REUSE-versus-CREATE
call. For each ask: **if the owner answered the other way, would the shipped behavior differ?** Yes means it
is the owner's call and goes in the seed, even when the ticket presents it as settled. No means only the code
would differ: decide it yourself. Settle every seed entry that turns on a fact before asking it
(`grill-me` § Settle it, don't ask it), and phrase each survivor as a concrete question with its assumed
answer and what breaks if that is wrong.

### 6b. Grill

Invoke the `grill-me` skill for its grilling portion only. Hand it the saved ticket; `{{grill_seed}}`, worked
first; `{{pending_siblings}}` with Step 2's routing; `{{documentation_extract}}`, `{{reusable_code}}` and
`{{bound_rules}}`; `{{spiked_facts}}` as settled facts; and `git log --oneline --name-only -10`. Resume this
skill in the same turn the grill ends.

Apply every resolution, and record each glossary, ADR, design doc or rule file the grill edited in
`{{grill_doc_edits}}`. **Write a design answer as the outcome it was chosen to produce**, and put the
mechanism in Dev Notes or a task. If the grill leaves a design question talking cannot settle, read
`GATES.md` § Prototype.

### 6b.5. Reconcile what the grill changed

The grill mutated a document that was consistent before it ran. Walk every axis before 6c:

| Axis                          | Check                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Criterion and criterion       | Two criteria describing one thing describe it the same way. When one was reversed or narrowed, find every criterion that rested on the old answer.                                                                                  |
| Criterion and task            | Both directions, on the instruction and not only the tag: a reversed criterion leaves every tag right and the verb beneath it wrong. For an added or widened criterion, walk the whole task list.                                   |
| Prose and criterion           | No Dev Note still frames an answered question as open, or forbids what a criterion now requires. Delete `#### Open, for the grill` once empty.                                                                                      |
| Count and its list            | A count stated beside its own list is deleted, not maintained. Recompute both sizing counts.                                                                                                                                        |
| Widened list and its siblings | A file list that grew re-opens every sibling question: re-run the Step 2 search over the widened list. Say whether a shared file is read or written by the sibling, since only a write collides.                                    |
| Citation and marker           | A rule the grill cited in prose but not in a marker renders as nothing: add it with `--ids`.                                                                                                                                        |
| Variable and its carrier      | A criterion that varies something names the argument, field or flag that carries it to the code under test, never only where the value lives. Trace each hop; a missing hop is unbuildable scope or a dependency on another ticket. |
| Term and its definition       | A resolution that changed what a term means updates `{cfg.glossary}`, its only definition, and every sentence that uses the term in the ticket, the sprint file and the requirements.                                               |

Sweep by grepping the claim that changed, in its own words, never only the passages you just edited.

### 6c. Review

`REVIEW.md` owns the prompt and the scans. Announce `Spawning 1 review agent: ticket-internal.`, then issue one
`general-purpose` agent in the background with the short prompt that file gives. The reviewer reads the
ticket and the rule menu and nothing else; the code-versus-ticket axis belongs to the implementing session's
sanity check (`SANITY-CHECK.md`).

The report arrives by `SendMessage`. An agent that goes idle without sending had its message dropped: ask it
to resend, and never read silence as clean. Triage, then apply with `Edit`, reading the sections around each
change, since two findings each correct alone can contradict once both land. Reject a finding that
contradicts something the grill settled, and record why. A finding whose fix is a task change gets the task
change. Then walk 6b.5's axes once more over what the apply touched. There is no second review pass.

Output: `Review complete: {{fix_count}} fix(es) from {{finding_count}} finding(s).`

## 7. Finalize

Read `FINALIZE.md` and follow it. It owns the metadata, every write-back, the status transition and the
handoff line.

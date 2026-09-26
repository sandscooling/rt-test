---
name: change-request
description: Handle a change that belongs to no active ticket, sized on evidence into an inline fix or a planning proposal. Use when the owner wants to change course or adjust the plan ("we need to change how X works", "that approach won't work, let's do Y"), or reports a defect found outside a ticket. The invoking message is the change description. Codebase and product-plan work only; edits to skills, rule docs or the workflow itself are made directly.
---

# Change request

Gather context, optionally grill the change, then choose a path on measured evidence:

- **[Inline fix](INLINE-FIX.md)**: the change fits one ticket. Implement it now with `dev-ticket`'s rigor, and
  apply every documentation update it implies in the same session. It writes a change record carrying the
  test handoff, then hands off to `create-tests` and `review-changes`, which commits it.
- **[Proposal](PROPOSAL.md)**: the change spans several tickets and needs planning. It edits the planning docs
  (requirements, design docs, ADRs, sprints, status) and defers the code to `create-ticket`.

**The fork is size, never documentation weight.** A one-ticket change that rewrites a design section and
supersedes an ADR is still an inline fix: a proposal would write a ticket a fresh session must re-read to
recover context this session already holds.

This file is the shared preamble up to the path decision. Load exactly one path file at Step 3.

Read `_agent-docs/_flow-config.yaml` first. `{cfg.KEY}` below means that key's path and `scale.KEY` its switch.
Substitute every `{cfg.KEY}` and `{{variable}}` with its literal value before it reaches a spawned agent.

## Operating rules

- **Check whether you are a lane member before your first edit.** Run `session_list` and read your own row: a
  `group` other than `null` or `orchestrator` means `_agent-docs/crew.md` and
  `{cfg.code_change_standards}` § Orchestrated Gate Delegation bind you, on both paths. The inline
  path edits code; the proposal path writes the status file, sprint files and requirements, which are the
  orchestrator's unless your dispatch grants them.
- **Ask for every id; never take the next free one.** The orchestrator allocates sprint numbers, ticket keys,
  requirement ids, ADR numbers and rule ids. Ask for the ids and any document grant in one message before you
  write. A planning proposal may be granted `{cfg.requirements}` and `{cfg.adr_dir}`.
- **Real fixes only.** A comment documenting a problem, a TODO or a note for later is not a fix. When you
  cannot resolve something, present it for triage.
- **Reuse before creating** (`{cfg.code_change_standards}` § Universal gates).
- **Rule edits follow `{cfg.rule_maintenance_guide}`**, including its lint-hardening candidate check. Record
  each rule the owner keeps as a manual gate in `{{lint_hardening_candidates}}`.
- **Placement safety.** Never add a ticket to a `done` sprint and never amend a `done` ticket; read
  `{cfg.sprint_status}` before any placement.
- **Point at artifacts rather than restating them.** The reasoning lives in the ADR, requirement, sprint file
  or design-decision record you wrote, which can be corrected and cited. A commit body or summary repeating it
  is a second copy that can be neither.
- **Bounded decisions go through `AskUserQuestion`**, with the evidence in the message; open-ended answers stay
  in prose. The grill asks its own questions its own way.

## 0. Understand the change

The invoking message is `{{change_trigger}}`: parse it, and never ask the owner to restate it. Stop and ask
only when it has no discernible subject.

Initialize the shared state here and nowhere else, since both path files append to it:
`{{grill_doc_edits}}` = [], `{{lint_hardening_candidates}}` = [], `{{prototype_candidates}}` = [].

Fold in what is already in this session: files the trigger names, and findings an earlier `review-changes`
surfaced. Store `{{area}}`: the workspaces and root tooling the change touches.

## 0.5. Is it worth fixing?

Only for a defect-shaped trigger (a bug report, a review finding, a limit someone hit). Skip it for a feature
or work the owner already scoped. Every later step answers how to build it; this is the one place that can
conclude not to.

**Check open GitHub issues first**: `node scripts/list-open-issues.mjs --search "<symbol, file or behavior>"`.
An issue may already carry the measurement or the verdict; verify its claims against the current tree
(`{cfg.rules_dir}/github-issues.md`). When an issue already covers the trigger, this change request is that
issue's fix: link it and close it when the change lands. Skip this when `gh` is unavailable.

Answer three questions in order, each with its evidence:

1. **What goes wrong, in the consumer's terms?** A behavior (a stale result reported as current, a test run
   the owner did not start, a lost interrupted state), not a mechanism. Say so if there is no visible
   consequence.
2. **How often does it happen, measured?** A declared bound is not an answer. Measure it with the smallest
   exercise in `_agent-docs/.scratch/`; when you cannot, say the number is unknown.
3. **Does it touch a product guarantee?** A breach of a guarantee in `AGENTS.md` (false freshness, lost
   states, unsafe execution, data leaving the machine) outranks any internal tooling defect.

State a verdict (fix it now, fix it cheaply, or do not fix it) and confirm it with `AskUserQuestion`. Watch for
a fix whose blast radius exceeds the defect's, and for a derived figure in the trigger that nobody divided
back out: re-derive it before designing on it. Record the verdict in the change record or the proposal.

## 1. Gather context

Gather before the fork: the path decision rests on the blast radius and the docs this step finds.

Read `{cfg.code_change_standards}` by its **Loading** paragraph: whole while `scale.doc_sections` is off. With
it on, load what this step needs:

```sh
node scripts/doc-section.mjs {cfg.code_change_standards} "Third-Party Semantics Verification"
```

Read `{cfg.rules_dir}/context-fanout.md`: it owns whether context comes from your reads or from agents.

**While `scale.ctx_agents` is off**, gather inline: impact and callers with `rg`, the relevant parts of
`docs/`, `{cfg.glossary}` and the ADRs, and the checklist shards `_index.md` names for `{{area}}`.

**While it is on**, run the fan-out with this subject, varying only the `Return:` line:

```text
subject:
  description: {{change_trigger}}
  area: {{area}}
  features: <keywords from the trigger>
  sprint_scope: {{change_trigger}}. Judge SPRINT_CANDIDATES against the whole change, which may become a sprint.
  outputs: both
```

| Agent                    | `Return:` line                                                                |
| ------------------------ | ----------------------------------------------------------------------------- |
| `ctx-impact` (wave 1)    | blast radius and breaking consumers                                           |
| `ctx-reuse` (wave 1)     | the REUSE and CREATE list                                                     |
| `ctx-docs` (wave 1)      | the documentation extract, plus `=== DOC_IDS ===`                             |
| `ctx-checklist` (wave 2) | the ids of the relevant checklist rules, plus a generous `SPRINT_CANDIDATES:` |

`sprint_scope` is what makes `SPRINT_CANDIDATES:` obtainable: if the change creates a sprint while
`scale.sprint_context` is on, that list becomes its bundle.

**Either way, while you gather:**

- `node scripts/requirements-index.mjs` → `{{requirements_index}}`.
- Read `{cfg.project_context}` whole and note the ids bearing on the change; expand them with
  `node scripts/expand-rules.mjs --doc project-context <ids>` → `{{project_patterns}}`. These are the
  deliberate directions the grill holds the change against rather than reopening.
- Expand the checklist ids you selected with `node scripts/expand-rules.mjs --doc checklist <ids>` →
  `{{checklist_rules}}`.

Bind the impact findings as `{{codebase_context}}` (`file:line - what it does and how it relates`) and the
touched files as `{{blast_radius_files}}`; bind the doc findings as `{{doc_context}}`, quoting every ADR the
change touches, since contradicting an ADR needs explicit reconciliation.

**Then bind `{{pending_siblings}}`**: every ticket not `done` whose sprint section or ticket file names a file
in `{{blast_radius_files}}` (`rg -n "<file name>" {cfg.sprints_dir} {cfg.ticket_dir}`, state from
`{cfg.sprint_status}`). Read each hit's criteria, not its title. `(none)` is the common answer; say it.

## 2. Grill the change?

Ask via `AskUserQuestion` (header `Grill`): **Grill this change first** to pin down scope, or **Skip the grill**.

On a grill, invoke the `grill-me` skill for its grilling portion only, and hand it everything bound so far so
it gathers nothing again: the change and the approach it implies, `{{doc_context}}`, `{{requirements_index}}`,
`{{codebase_context}}` with any blast-radius file recent commits touched, `{{checklist_rules}}`,
`{{project_patterns}}`, and the unbuilt tickets of the `in-progress` sprint with their scope lines. Tell it:

- **Spike facts rather than ask them.** A trigger is often a claim about how things behave; a spike answers it
  with observed output, and a spike that falsifies a documented rule fixes that rule in this session.
- **A prototype is on the table** for a state model, transition or precedence question nobody can predict on
  paper, or for the layout of the CLI's human output. It is an offer, never a default.
- **Frame a conflict with a pending ticket as sequencing**, never by pulling that ticket's scope into this
  change.

Resume in the same turn the grill ends. Append to `{{prototype_candidates}}` every design question the owner
could not settle by talking (`{question, assumed_answer}`), and append every file the grill edited to
`{{grill_doc_edits}}`. Fold each resolved decision into your understanding of the change.

## 3. Choose the path

### Ownership first

Read the criteria of each ticket in `{{pending_siblings}}`, not its title:

- **A ticket owns the whole change**: neither path. Name it and stop.
- **A ticket owns part of it**: fold that part into its criteria (a `backlog` or `ready-for-dev` ticket is
  amended in place; an `in-progress` one is never edited, so surface it to the owner). Size the rest.
- **Adjacent, and its criteria do not reach this**: size it, naming the criterion you read.

### Then size

Apply `create-ticket`'s § One-ticket size limits to the code this change implies:

- `{{cr_units}}`: distinct code-change units, plus one for validation.
- `{{cr_files}}`: files modified and created, including every test file a behavior change breaks, times the
  multiplier. Documentation files do not count.

Route to a proposal only when a limit is exceeded on the code side, or the work splits into workstreams with
an order between them. State what the change reaches, both counts against their limits, and the planning docs
it implicates, then ask via `AskUserQuestion` (header `Path`):

> **Inline fix**: the code plus every doc update it implies, in this session.
> **Proposal**: only when this becomes several tickets with an order between them.

Load the chosen file and follow it to completion. Never cram a multi-ticket change into an inline fix, and
never pad a one-ticket change into a proposal.

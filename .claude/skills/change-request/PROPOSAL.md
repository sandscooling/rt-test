# Change request: proposal path

Reached from `SKILL.md` Step 3 when the change needs planning. This path edits planning documents only; the
code is built later through `create-ticket` and `dev-ticket`. Everything the preamble bound is in hand: do
not gather it again.

While `scale.doc_sections` is on, load the sections this path's criterion guard needs:

```sh
node scripts/doc-section.mjs {cfg.code_change_standards} "Universal gates" "File Size & Extraction Strategies" "Deleting an Exported Symbol"
```

Read `{cfg.rules_dir}/github-issues.md` for filing deferred work.

**Escalation.** If the evidence turns out to fit one ticket after all, both counts within the limits and no
ordered workstreams, switch to `INLINE-FIX.md` before Step 4 drafts anything. A heavy documentation footprint
is never a reason to stay here.

## 1. The planning homes this change touches

Each planning fact has one home; edit the home, and link from elsewhere:

| Fact                                                    | Home                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The product, its intended experience, and what is built | `README.md`: the product description, the intended experience, and a Status that says only what is built |
| What the product must do or keep                        | `{cfg.requirements}`, one line per requirement with its marker                                           |
| A hard-to-reverse decision                              | one ADR in `{cfg.adr_dir}`, in the format its `README.md` gives                                          |
| Current design                                          | `docs/architecture.md`, which links `ADR-NNNN` rather than restating it                                  |
| Milestones and their order                              | `docs/roadmap.md`                                                                                        |
| A sprint and its tickets' scope                         | the sprint file in `{cfg.sprints_dir}`, per its `README.md`                                              |
| A spike a design rests on                               | the opening task of the ticket whose design rests on it                                                  |
| Every sprint and ticket state                           | `{cfg.sprint_status}`                                                                                    |
| A term                                                  | `{cfg.glossary}`, in `grill-me`'s `GLOSSARY-FORMAT.md` format                                            |
| The owner's answers during this path                    | the ADRs and sprint prose they settle; under a lane, also the lane's final report                        |

Infer which homes the change touches from its substance, include every plausible one, and announce them.
Ask the owner only when the target is genuinely indeterminate.

## 2. Placement context

Read `{cfg.sprint_status}` whole: the `done` sprints and tickets are off-limits, and the `in-progress` and
`backlog` sprints are candidates. Read the sprint files the change names or touches.

**New technology.** When the change adopts a dependency, library or tool the project does not use, research
its current documentation for the version you would add, its compatibility with Node 22 and 24, Bun,
TypeScript 7 and Windows, and its known breaking changes. A blocker goes to the owner before any proposal
(`AskUserQuestion`: an alternative, accept the risk, or cancel). A dependency whose entry point imports
`typescript` needs its entry point checked first (`{cfg.project_context}` P8).

## 3. Review mode

Ask via `AskUserQuestion` (header `Review mode`): **Incremental**, refining each proposal with the owner
(recommended), or **Batch**, presenting them together.

## 4. Draft the proposals

Every gate below runs before a proposal is presented.

**Gate 1: placement.**

1. The natural sprint is `done`: a new sprint in the same milestone.
2. Else an `in-progress` sprint fits: add the ticket there.
3. Else a `backlog` sprint fits: add it there.
4. Else a new `backlog` sprint.

A `backlog` or `ready-for-dev` ticket may be amended; an `in-progress` one gets an addendum the owner
approves; a `review` or `done` one is never modified, and a follow-up ticket carries the change.

**Gate 2: no documentation-only tickets.** This path applies every documentation edit itself, so a ticket
whose only work is a doc edit is always redundant. A doc edit that is a side effect of code is a task in that
code's ticket.

**Gate 3: criterion guard.** Hold every drafted criterion against `{cfg.code_change_standards}` and
`{{checklist_rules}}`, and rewrite one that prescribes a pattern they forbid. A criterion states an outcome,
never a mechanism.

**Gate 4: requirement traceability.** Every new or changed ticket traces to a requirement in
`{{requirements_index}}`. Draft a new requirement or an amendment for each gap, using ids the orchestrator
allocated. Each drafted requirement ends with the marker `{cfg.rules_dir}/requirement-markers.md`
prescribes: `[Sprint N]` for the sprint Gate 1 chose, or `[Unscheduled: <why>]` when nothing is scheduled to
build it. Never invent a sprint to host a marker.

**Prototype gate.** A proposal that must commit to a state model, a transition rule or a precedence scheme
nobody has driven, or one in `{{prototype_candidates}}`, asks via `AskUserQuestion` (header `Prototype`):
**Build a prototype** or **Proceed without one**. On yes, invoke the `prototype` skill; its verdict grounds the
proposal, which cites `{cfg.design_decisions_dir}/{{slug}}/FINDINGS.md`. A prototype guessed wrong here
becomes a criterion in every ticket this proposal produces, so an entry in `{{prototype_candidates}}` always
fires the gate.

Group the proposals: **ticket changes** (sprint, key, old and new scope, target sprint and its state), which
become tickets, and **document edits** to each home in Step 1, which this path applies itself. Review them in
the chosen mode, each with **Approve**, **Edit** or **Skip**.

## 5. The change manifest

Before asking for approval, present the numbered list of every file Step 6 will create or modify, one line
each, and the ids you will ask for. Then ask via `AskUserQuestion` (header `Proposal`): **Approve and apply**,
**Edit proposals**, or **Cancel**, which summarizes what was analyzed and goes to Step 7.

## 6. Apply

Ask the orchestrator for the ids and grants the manifest needs in one message, then write every file
yourself: you hold the reasoning, and a document rewritten from a relay loses what nobody thought to send.

- **Requirements**: the drafted lines with their markers. Run `node scripts/check-requirement-markers.mjs`.
- **ADRs**: a new ADR per decision, and a superseded ADR marked as its `README.md` directs. Run
  `node scripts/adr-index.mjs`. When an ADR bans or replaces a pattern, run the reverse sweep in
  `{cfg.rule_maintenance_guide}` § Procedure across every checklist shard, `{cfg.project_context}` and the
  sprint files, and retire what still mandates the old pattern in this same change.
- **Design docs**: the sections of `docs/architecture.md`, `docs/plan.md` and `docs/roadmap.md` whose current
  design the change alters, linking any ADR rather than restating it, and each line of `README.md` the change
  makes false. A plan change moves the intended experience; its Status moves only when code lands.
- **Glossary**: a term the proposal review settled after the grill, under your grant, in the format
  `grill-me`'s `GLOSSARY-FORMAT.md` gives.
- **Rules**: per `{cfg.rule_maintenance_guide}`.
- **Sprints and status**: each new sprint file and ticket heading in the format `{cfg.sprints_dir}/README.md`
  gives, with **the reasoning for the plan in prose under the sprint's objective or the ticket's scope line**;
  one `backlog` key per new sprint and ticket in `{cfg.sprint_status}`; a removed ticket's heading and key
  removed together. Run `node scripts/check-sprint-keys.mjs`.
- **Sprint-context bundle**, only while `scale.sprint_context` is on: when this change created a sprint or
  replaced an existing sprint's scope, write its bundle per the `sprint-context` skill's `BUNDLES.md`
  § Writing a bundle, from the fan-out's `SPRINT_CANDIDATES:` and `DOC_IDS` lines. Adding a ticket to a sprint
  writes no bundle.

Every checker named above must exit 0 before you report, and so must these, over the tree you wrote:
`bun run rules:check`, `node scripts/check-skill-wiring.mjs`, `node scripts/check-line-citations.mjs`, and
`bun x prettier --check <every file you wrote>`. Then ask via `AskUserQuestion` (header `Applied`):
**Confirm** or **Review changes**, showing each file's key change and re-applying adjustments.

**Commit.** Under a lane, report the exact list of paths you wrote; the orchestrator stages and commits them.
Outside a lane, commit them as `docs:` per `{cfg.rules_dir}/git-commits.md` as soon as the owner confirms,
with a body naming the sprint file or ADR that carries the reasoning. A source file in the staged diff means
the stage is wrong.

## 7. Report

List the files written, the ids used, and each checker's result. If ticket changes were approved, list the
new or changed tickets and say: _Run `create-ticket` to draft them, then `dev-ticket` to build._ Otherwise say
that every change was a document edit and no tickets are needed. When `{{lint_hardening_candidates}}` is not
empty, present it as a table: rule id, bucket, proposed mechanism.

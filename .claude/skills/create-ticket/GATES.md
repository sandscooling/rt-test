# Conditional gates

Each fires on a trigger from `SKILL.md`. Read only the section whose trigger fired.

## Split

Trigger: the owner chose **Split** at the sizing gate.

Output `Ticket will be split. No ticket file has been created yet.` Then ask in prose, since the answer is a
description: _Describe how to split this ticket: for each part, a short title and the criteria that belong to
it._

**Split by outcome, never by layer.** "All the store changes, then all the CLI" produces parts whose criteria
state mechanisms, because no outcome is reachable until the last part lands. Each part carries at least one
criterion a failing test could be written for. If no cut does, the ticket changes a shared contract, which is
horizontal by nature: say so and take the sizing warning instead.

**Number the parts by letter suffix.** The first part keeps the parent's number, then `b`, `c` (`3.2` splits
into `3.2` and `3.2b`). Never renumber the tickets after it: a suffix leaves every existing citation correct.

Ask the orchestrator for the new keys and for a grant on the sprint file and `{cfg.sprint_status}` in one
message, or, outside a lane, write them yourself:

1. `{cfg.sprint_status}`: replace the parent's key with one `backlog` key per part, in the form
   `{cfg.sprints_dir}/README.md` gives.
2. The sprint file: one `## Ticket` heading per part, each with its scope line and criteria. **The split's
   reasoning goes here**, in prose under the parts: what was measured, where the cut fell and why, and any
   order the parts require.

Then run two searches for every part, not only the one you are about to write, since the parts you are not
writing have no other reader until someone drafts them:

- **The files.** Step 2's sibling search per part. Record each ticket not `done` that names the same file, as
  one line in that part's section, stating which ticket's change makes the other's safer or riskier.
- **The forward-looking citations.** A citation of what a ticket did survives any split. One naming a ticket
  as the future owner of work ("owned by Ticket N.M", "Ticket N.M (backlog) will") is a promise about scope,
  and the split moves scope. Grep those forms, never the bare id, across `packages/`, `apps/`, `docs/` and
  `{cfg.sprints_dir}`, and record each stale site in the owning part's file list rather than editing it here.
  A requirement marker `[Ticket N.M]` is the same kind of citation: re-point it at the part that delivers
  the requirement.

Run `node scripts/check-sprint-keys.mjs` and `node scripts/check-requirement-markers.mjs`; both must exit 0.
Output `{{ticket_key}} split into {{split_count}} tickets. Now creating the first.`, set the target to the
first part, and return to Step 2.

## Novelty

Trigger: the ticket adds a dependency, crosses a major version of one, is the first code here to call a given
third-party API (grep the package name across `packages/` and `apps/`), or integrates an external service
this project has not used.

Novelty is risk that splitting does not reduce. Say so beside the sizing result, then ask via
`AskUserQuestion` (header `Novelty`): **Proceed**, with the implementing session resolving the assumptions
first, or **Spike first**. On **Spike first**, run the smallest real exercise in `_agent-docs/.scratch/`,
fold what you observe into Dev Notes as verified facts with their output, and delete the rows it settles. A
spike that adds a dependency writes `package.json` and `bun.lock`, which a lane reports rather than edits
(`{cfg.code_change_standards}` § Lock File Check).

A read-only spike that finishes in minutes gets no gate: offering a choice about a two-minute measurement
turns a fact into a decision.

## Prototype

Trigger: the grill left a design question the owner could not settle by talking ("I don't know until I see
it", or a hesitant pick), and a wrong answer means rework rather than a tweak. The question is a state model,
a transition rule or a precedence scheme whose edge cases nobody can predict on paper, or the layout of the
CLI's human output.

When none qualifies, the normal case, say so and continue. Otherwise state the question, then ask via
`AskUserQuestion` (header `Prototype`):

> **Build a throwaway prototype**: drive the model in a terminal app, about 15 minutes, deleted afterwards.
> **Proceed with the current assumption**: `{{assumed_answer}}`.

- **Proceed**: record it in Dev Notes as a choice, not a conclusion.
- **Build**: invoke the `prototype` skill with the question, `{{area}}` and the target files. Fold its verdict
  into the ticket as sharpened criteria plus a Dev Note citing
  `{cfg.design_decisions_dir}/{{slug}}/FINDINGS.md`. If the criteria still leave the question open, the fold-in
  failed. Confirm the skill reported no residue, and add the record to the ticket's File List.

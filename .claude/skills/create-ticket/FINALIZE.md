# Finalize (Step 7)

Read this once the review's findings are applied and the ticket is final. Everything here writes. Under a
lane, a write to a file your dispatch did not grant is a report of the exact text instead.

**Execution metadata.** Fill the ticket's yaml block with `Edit`: `area`, `is_consolidation` (true when the
tasks replace a pattern across the codebase), `sizing_ac_count`, and `files_to_modify` and `files_to_create`
as they now stand.

**Rule-id markers, compared with the prose.** Add to the markers every rule id the ticket's prose cites that
neither marker carries, with `fill-ticket.mjs --ids`: a rule a criterion defers to but never binds renders as
nothing. Then re-run `node scripts/fill-ticket.mjs --check {{ticket_file}}`.

**The sprint file.** Move any criteria still under this ticket's heading into the ticket, leaving the scope
line and a link to the ticket file, as `{cfg.sprints_dir}/README.md` describes. Correct the scope line only
where the finished ticket's outcome or scope materially differs; elaboration is not a difference. A decision
that constrains a sibling ticket goes under that sibling's heading.

**Requirements.** Follow `{cfg.rules_dir}/requirement-markers.md`, which owns the marker grammar:

- When this ticket delivers a requirement, relink its marker to `[Ticket {{sprint_num}}.{{ticket_num}}]`, or
  add this ticket to an existing `Tickets` marker. A `[Sprint N]` marker is claimed by the whole sprint, so
  relink it only when this ticket delivers the whole requirement; otherwise leave it and note which tickets
  it waits on.
- Apply `{{requirement_proposals}}`: an amendment edits the existing requirement; a new one uses an id the
  orchestrator allocated.
- Run `node scripts/check-requirement-markers.mjs`; it must exit 0.

**Sprint-context bundle**, only while `scale.sprint_context` is on: add every id on the final markers that the
bundle's `checklist` list lacks, per the `sprint-context` skill's `BUNDLES.md` § Widening a bundle.

**File List.** Append to `### File List` every planning file this run wrote: split artifacts, requirement
edits, and `{{grill_doc_edits}}`.

**Status.** Set the ticket's key to `ready-for-dev` in `{cfg.sprint_status}`, and set the sprint to
`in-progress` if it was `backlog`. The status file is the only home of state: the ticket and sprint files
carry none. Run `node scripts/check-sprint-keys.mjs`; it must exit 0. Under a lane, report both transitions to
the orchestrator instead of writing them.

**Then read `SANITY-CHECK.md`**, before the handoff line, and add any citation a `STANDS` would need.

Output the ticket key, file, area and task count, then: _Review the ticket, then run `dev-ticket` in a new
session, and keep this one open: it answers the sanity check._

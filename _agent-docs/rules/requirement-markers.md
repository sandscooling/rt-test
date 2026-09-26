# Requirement markers

Read this whenever you write a requirement or change what it links to. Every requirement in `docs/requirements.md` ends with one bracketed marker that says **where its work is planned, never what state it is in**. State lives only in `_agent-docs/sprint-status.yaml`; `node scripts/requirements-index.mjs` derives each requirement's state from it.

## Grammar

| Marker                                | Means                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `[Sprint N]`                          | Sprint N will deliver it; no ticket has claimed it yet.                             |
| `[Ticket N.M]`                        | One ticket delivers it.                                                             |
| `[Tickets N.M, N.K]`                  | Every listed ticket is needed. Join ids with a comma and a space.                   |
| `[Unscheduled: <reason>]`             | No sprint owns it. The reason says why, and may name a GitHub issue.                |
| `[Partial: <link>; remainder: <why>]` | The linked work delivers part; the remainder is unscheduled, for the stated reason. |

`<link>` is one of the first three forms without its brackets. Sprint numbers and ticket ids follow `_agent-docs/sprints/README.md`. Write nothing else inside the brackets: no state words, no second link.

## Derived state

`requirements-index` reads each linked key from the status file:

- `planned`: the linked sprint has not closed, or no linked ticket has started (`backlog`, `ready-for-dev`, `deferred`).
- `in-progress`: some linked ticket is `in-progress`, `review`, or `done`, but not all are `done`.
- `implemented`: every linked ticket is `done`.
- `partial`: a `Partial` marker whose linked tickets are all `done`.
- `unclaimed`: a `[Sprint N]` marker whose sprint is `done`. Link the ticket that delivered it, or mark the requirement `Unscheduled` or `Partial`.
- `unscheduled`: an `Unscheduled` marker.

## Changing a marker

- When a ticket takes on a requirement, replace `[Sprint N]` with the ticket link. Do not touch the marker again when the ticket's state changes.
- When scheduled work covers only part of a requirement, write a `Partial` marker naming the remainder, or link the ticket that owns it.
- Amend an existing requirement rather than minting a second id for the same property, and relink its marker to the new work.

`node scripts/check-requirement-markers.mjs` fails on a malformed requirement line or marker, a duplicate id, a link to a sprint or ticket with no status key, and a sprint or ticket file that cites an unknown requirement id.

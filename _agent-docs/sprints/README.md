# Sprints

Plan work as sprints, one file each in this folder (`sprints_dir` in `_agent-docs/_flow-config.yaml`). Each sprint delivers part of one milestone in `docs/roadmap.md`; a milestone may take several sprints.

Keep each planning fact in one home:

- **The sprint file** owns the sprint's title, milestone, and each ticket's title and one-line scope.
- **The ticket file** (`ticket_dir`) owns a ticket's acceptance criteria once it exists. Until then they may sit under the ticket heading here; when `create-ticket` writes the ticket file, move them there and leave the scope line plus a link.
- **`_agent-docs/sprint-status.yaml`** (`sprint_status`) owns every sprint and ticket state. Never write a state into a sprint file, a ticket file, or a requirement marker.

## Sprint file format

Name the file `sprint-<N>-<slug>.md`, where `<N>` is the sprint number (a positive integer, no leading zero) and `<slug>` is lowercase words joined by hyphens.

```md
# Sprint 3: Queryable results

**Milestone:** M1

One paragraph: what the sprint delivers and why.

## Ticket 3.1: Parse Vitest reporter events

Scope: one line saying what the ticket delivers. Ticket file: [3-1-parse-events](../tickets/3-1-parse-events.md)

## Ticket 3.2: Persist results locally

Scope: one line.

Acceptance criteria stay here only until the ticket file exists.
```

- The first heading is `# Sprint <N>: <title>`, and `<N>` matches the file name.
- One `**Milestone:** M<k>` line names the roadmap milestone.
- Each ticket heading is exactly `## Ticket <N>.<M>: <title>`: `<N>` is this sprint's number, `<M>` is a positive integer with an optional lowercase letter for a split (`3.2a`). Every heading that starts with `Ticket` must follow this form.
- Cite requirements by id (`FR4`, `NFR2`); every cited id must exist in `docs/requirements.md`.
- Remove a dropped ticket's heading and its status key together. Git keeps the history.

## Status file format

`_agent-docs/sprint-status.yaml` is a flat list of `key: state` lines. Comments and blank lines may group them; a trailing `# note` is allowed.

```yaml
sprint-3: in-progress
3-1-parse-events: done
3-2-persist-results: backlog
```

- A sprint key is `sprint-<N>`. Its state is `backlog`, `in-progress`, or `done`.
- A ticket key is `<N>-<M>-<slug>`, matching the heading `## Ticket <N>.<M>`. The slug names the ticket file (`<key>.md` in `ticket_dir`). Its state is `backlog`, `ready-for-dev`, `in-progress`, `review`, `done`, or `deferred`.
- Each ticket id appears once.

`node scripts/check-sprint-keys.mjs` fails when a status key has no matching heading or sprint file, when a sprint file or ticket heading has no status key, and on any malformed file name, heading, key, or state.

# Requirements

RT Test's product requirements. Each is one list line with an id, its text, and a marker linking the work that delivers it:

```md
- FR1: <what the product does> [Sprint 1]
- NFR1: <a quality the product keeps> [Unscheduled: <why>]
```

- Functional requirements use `FR<n>` and non-functional ones `NFR<n>`, numbered from 1 without leading zeros. `node scripts/requirements-index.mjs --next` prints the next free one.
- Never delete a requirement line: `--next` counts only the ids present, so a deleted id would be offered again. Retire a requirement by changing its marker to `[Unscheduled: retired, <why>]`.
- The marker grammar and its derived states live in `_agent-docs/rules/requirement-markers.md`.
- `node scripts/requirements-index.mjs` renders the index with each requirement's current state.

## Functional requirements

## Non-functional requirements

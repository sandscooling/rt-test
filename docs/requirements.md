# Requirements

RT Test's product requirements. Each is one list line with an id, its text, and a marker linking the work that delivers it:

```md
- FR1: <what the product does> [Sprint 1]
- NFR1: <a quality the product keeps> [Unscheduled: <why>]
```

- Functional requirements use `FR<n>` and non-functional ones `NFR<n>`, numbered from 1 without leading zeros. `node scripts/requirements-index.mjs --next` prints the next free one, and the orchestrator allocates it.
- Delete a requirement that is no longer wanted. `--next` never reissues a deleted id: it counts every id this file has held in its git history, across merges and the renames git detects, and fails outside a git repository, in a shallow clone, or when that history cannot be read. Rename this file in a commit of its own, so git links its earlier history.
- The marker grammar and its derived states live in `_agent-docs/rules/requirement-markers.md`.
- `node scripts/requirements-index.mjs` renders the index with each requirement's current state.

## Functional requirements

## Non-functional requirements

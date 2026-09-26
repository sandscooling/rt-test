# Architecture decision records

Record each hard-to-reverse, surprising decision with real alternatives as one ADR in this folder (`adr_dir` in `_agent-docs/_flow-config.yaml`). ADRs are the only home for decisions: other docs link `ADR-NNNN` rather than restating one.

## File format

Name the file `NNNN-<slug>.md`: the next unused four-digit number, then lowercase words joined by hyphens. Never renumber or reuse a number.

```md
# Store results in SQLite

Status: accepted

Context, the decision, and why, in a few sentences. Add considered options or consequences only when a future reader needs them.
```

- The first line is `# <title>`.
- One `Status:` line holds `proposed`, `accepted`, `deprecated`, or `superseded by ADR-NNNN`.
- Record supersession once, on the superseded ADR, naming a current ADR. The successor does not repeat it; the index derives "supersedes" from it.
- When a decision changes, write a new ADR and mark the old one superseded rather than rewriting its decision.

## Index

Never keep an index by hand. Generate it on demand:

```sh
node scripts/adr-index.mjs
```

It lists every ADR in number order with its title and status, and fails on a malformed file name, title, or status, a repeated number, and a supersession naming a missing, superseded, or self ADR.

# Glossary format

The glossary lives at `{cfg.glossary}`. `grill-me` writes it, one term at a time, as each term resolves with the
owner's agreement; every other skill and document links to it rather than defining a term again.

## Structure

```md
# RT Test

One or two sentences on what the product is and why these terms matter.

## Language

**Freshness**:
Whether a recorded result still describes the current inputs of its test.
_Avoid_: staleness, validity

**Named defect**:
A specific wrong behavior a test is written to reject, recorded with the mutation that introduces it.
_Avoid_: bug id, test target
```

## Rules

- **Be opinionated.** When several words exist for one concept, pick the best and list the rest under `_Avoid_:`.
  The `_Avoid_:` line is the only place a disambiguation lives.
- **Keep definitions tight**: one or two sentences saying what the term is, not what it does or how it is built.
- **Only terms specific to this product.** A general programming concept (a timeout, an error type) does not
  belong, however often the code uses it.
- **Group terms under `###` subheadings** when natural clusters appear; a flat list is fine otherwise.
- **Never copy a table or list that lives in code.** Define the concept and name where the values live.

<!--
The shard map for the review checklist. Maintenance: _agent-docs/rule-maintenance-guide.md.
-->

# Code review checklist

The checklist holds constraints a reviewer checks against a diff. Directions an agent needs before writing live in `_agent-docs/project-context.md` instead; a rule lives in exactly one of the two.

While `scale.rule_selection` is `whole`, read every shard the change touches in full and pick ids inline. Always include `engineering-core`; add `testing` for any change to tests or defect records, and `daemon-cli-state` for the daemon, CLI, state store, adapters or defect verifier. Expand chosen ids with `node scripts/expand-rules.mjs --doc checklist <ids>`.

| Shard                                       | Load when                           | Holds                                                                                                       |
| ------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`engineering-core`](./engineering-core.md) | always                              | Dependencies, constants, design, bounds, errors, consumers, comments, living docs, gates                    |
| [`testing`](./testing.md)                   | tests or `defects.json` change      | Named defects, assertions, fixtures and mocks, suite hygiene                                                |
| [`daemon-cli-state`](./daemon-cli-state.md) | daemon, CLI, store or verifier work | Checks of the product guarantees: freshness, identity, selection, states, isolation, trust, privacy, output |

Rule ids are `C<n>`, flat and unique across every shard, so an id resolves wherever its rule lives.

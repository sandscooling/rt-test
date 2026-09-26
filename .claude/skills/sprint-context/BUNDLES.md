# Sprint-context bundles

The one home of the bundle format and of every operation on a bundle. Bundles exist only while
`scale.sprint_context` is on; while it is off, no skill reads, writes or widens one, and
`node scripts/check-sprint-context.mjs` passes on an absent `{cfg.sprint_context_dir}`.

A bundle caches, for one sprint, a **generous shortlist**: the checklist ids any of its tickets could need, the
docs they rest on, the requirements it delivers, and the test helpers its tests import. A ticket's rule
selection judges the shortlist instead of the whole menu. **It holds ids and pointers only, never rule or doc
text**, so a sharpened rule or an edited doc reaches every ticket current.

**It covers the checklist, never project context.** Every skill reads `{cfg.project_context}` whole and selects
inline.

## Format

`{cfg.sprint_context_dir}/sprint-<N>.yaml`, one per sprint, where `<N>` is the sprint number. The checker
parses exactly this shape: flat keys and inline lists.

```yaml
sprint: 3
checklist_rule_count: 42
checklist_ids_sha: 0123456789ab
checklist: [C1, C4, C9]
doc_ids: [FR3, ADR-0001, docs/architecture.md]
requirements: [FR3, NFR1]
test_infra: [test/scripts/rules/harness.ts#expand]
```

- `checklist_rule_count` and `checklist_ids_sha` are the **stamp**, a fingerprint of the checklist's id set when
  the bundle last considered it. Only `check-sprint-context.mjs --restamp` writes them.
- `checklist`: the candidate checklist ids, never empty.
- `doc_ids`: requirement ids, `ADR-NNNN`, or repo-relative paths.
- `requirements`: the requirement ids the sprint delivers.
- `test_infra`: optional. Each anchor is a path or `path#name`; a bundle without it is valid.
- `partial: true`: optional, when a dimension failed during writing.

## Writing a bundle

A bundle is written when a sprint's scope is established: when a sprint is created, when a change replaces an
existing sprint's scope, and when the `sprint-context` skill runs. Adding a ticket to a sprint does not rewrite
it; the ticket widens it instead. A re-scoped sprint that keeps its old bundle is worse off than one without,
since every ticket trusts a shortlist chosen for work nobody is doing.

1. **Gather against the whole sprint**: the checklist agents and `ctx-docs` with `sprint_scope` set to the
   objective plus every ticket, per `{cfg.rules_dir}/context-fanout.md`.
2. **Take the generous lists**: `checklist` from the merged `SPRINT_CANDIDATES:` line, never `IDS:`; `doc_ids`
   from `=== DOC_IDS ===`; `requirements` from the requirement ids the sprint's tickets deliver, read from
   `node scripts/requirements-index.mjs`.
3. **Write the file with both stamp keys present** at any placeholder value, since restamping fills keys and
   never creates them.
4. **Stamp last**, after every rule edit this session made is on disk:
   `node scripts/check-sprint-context.mjs --restamp <N>`. Read its exit code directly, never through a pipe.
5. **Verify** (below).

## Reading a bundle

A ticket's discovery uses its sprint's bundle as a **hit** when the file exists, the check exits 0, and it
printed no `STALE` warning for the sprint. On a hit, pass `checklist`, `doc_ids` and `requirements` to the
selection agents as `sprint_candidates`. Anything else is a miss: select from the full menu and say so. A
missing file is a plain miss; only the `sprint-context` skill creates one.

**A stale stamp is repaired, not worked around.** A miss caused by `STALE` gets the Appending procedure below,
since every sibling ticket would otherwise pay the same full scan. Under a lane, report the stale stamp to the
orchestrator instead: the repair rewrites the whole file.

## Widening a bundle

When a ticket reaches outside the shortlist (an agent's `RULE_COUNT:` carries `+outside-shortlist`, `ctx-docs`
returns `OUTSIDE_SHORTLIST:`, or the ticket's final rule-id markers carry an id `checklist` lacks), append those
ids to the bundle, whether or not it was a hit. **Do not restamp**: widening adds ids that already existed, so
the rule set is unchanged. Then verify. Under a lane, report the ids to append instead.

## Appending after a new rule

When a checklist rule is added or removed, every bundle's stamp goes stale. For each bundle of a sprint not
`done`: judge each new rule against the sprint's scope, append the ids that belong, then restamp. Restamping
asserts the bundle considered every rule now in the checklist; never restamp a bundle you did not judge.

## Verifying

`node scripts/check-sprint-context.mjs` must exit 0. It fails on an unknown checklist id, a doc pointer or
requirement that resolves to nothing, a dead test-infrastructure anchor, a malformed file, and a bundle whose
sprint has no status key. It warns, without failing, on a stale stamp, a thin shortlist (fewer than 15 ids, or
`partial: true`), and a wide one (above 30% of the checklist). Fix a failure while the agents' returns are still
in hand: drop or repoint the id, and say which.

---
name: sprint-context
description: Build or rebuild a sprint's context bundle, the shortlist of checklist rule ids, doc pointers and test-infrastructure anchors its tickets pre-filter against. Use when the owner asks to generate, build or refresh a sprint's context bundle. Works only while scale.sprint_context is on.
---

# Sprint context

Build one sprint's bundle: a generous shortlist of checklist ids, doc pointers and test-infrastructure anchors
that each ticket in the sprint judges instead of the whole rule menu. [BUNDLES.md](BUNDLES.md) owns the file
format and every operation on a bundle; this skill builds one from scratch.

Read `_agent-docs/_flow-config.yaml`. Keys used: `{cfg.sprint_status}`, `{cfg.sprints_dir}`,
`{cfg.sprint_context_dir}`, `{cfg.rules_dir}`, and the switches `scale.sprint_context` and `scale.rule_selection`.

**While `scale.sprint_context` is off, write nothing.** Say that bundles are switched off, name the switch, and
stop: every skill then reads the rule shards and docs directly, which is the normal path. Turn it on only with
`scale.rule_selection` at `menu` and `scale.checklist_fanout` at `4`, when per-ticket rule selection is the
measured cost; the owner decides.

Input: a sprint number. Without one, list the sprints in `{cfg.sprint_status}` that are `in-progress` or
`backlog`, noting which have a bundle, and ask which.

## 1. Load the sprint

Read `{cfg.sprint_status}` and confirm the sprint exists and is not `done`; refuse a `done` sprint, since no
ticket would read its bundle. Read `{cfg.sprints_dir}/sprint-{{sprint_num}}-*.md` → `{{sprint_scope}}`: the
objective and every ticket with its scope and any criteria. The shortlist is judged against this and nothing
else, so a sprint reduced to its theme produces a bundle that strands its tickets.

When `{cfg.sprint_context_dir}/sprint-{{sprint_num}}.yaml` exists, ask whether to rebuild it: a rebuild replaces
the file and discards what tickets widened into it, which is right after the rule corpus changed substantially
and wrong otherwise.

## 2. Gather against the sprint

Read `{cfg.rules_dir}/context-fanout.md`: the subject is a sprint, not code, so it takes that doc's one-wave
form with no `code_facts`. Announce the batch, then issue it as one message: the `ctx-checklist` agents split by
shard group, and `ctx-docs`. Every prompt carries this subject, varying only the `Return:` line:

```text
subject:
  description: {{sprint_scope}}
  area: every area the sprint's tickets touch
  features: <features across the sprint's tickets>
  sprint_num: {{sprint_num}}
  sprint_scope: {{sprint_scope}}
  outputs: sprint_candidates
```

| Agent           | `Return:` line                                             |
| --------------- | ---------------------------------------------------------- |
| `ctx-checklist` | the sprint-level `SPRINT_CANDIDATES:` ids from your shards |
| `ctx-docs`      | the documentation extract and the `=== DOC_IDS ===` line   |

`outputs: sprint_candidates` suppresses `IDS:`: here the subject is the sprint, so the two lines would be the
same list. Never pass an existing shortlist as `sprint_candidates`; this skill builds it.

**Every id line must be literal ids, and `=== DOC_IDS ===` one line.** A cross-reference or a bulleted block in
their place goes back to that agent for a full resend; never reconstruct it. A fabricated pointer enters a cache
every remaining ticket trusts.

Leave `test_infra` out: `create-tests` fills it on the sprint's first ticket, per `BUNDLES.md`.

## 3. Write and verify

Merge the checklist returns per the fan-out doc, then follow `BUNDLES.md` § Writing a bundle, including its
stamp and verify steps. If an agent fails twice, write what you have with `partial: true` and name the missing
dimension.

Report one line:
`Sprint context bundle written: <path>, <n> checklist ids, <n> doc pointers, <n> requirements, check-sprint-context: <pass | pass with warnings | failed>`,
then any ids you dropped to make the check pass and any warning it printed.

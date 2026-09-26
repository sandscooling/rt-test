# Context fan-out

Read this before a skill gathers context for a ticket, change request or review. The `scale` switches in `_agent-docs/_flow-config.yaml` decide whether that context comes from your own reads or from spawned `ctx-*` agents; this file owns the order, the checklist split and the merge. Each calling skill owns which dimensions it needs and what it binds from them.

## While the switches are off

With `scale.ctx_agents: off` and `scale.rule_selection: whole`, the defaults, **spawn no context agent.** Gather each dimension inline:

- **Impact**: find the code the change touches and its callers with `rg`, and read the files.
- **Docs**: read the relevant parts of `docs/` whole, the glossary (`glossary`), and the ADRs the change touches.
- **Test infrastructure**: read the tests beside the changed code, their `defects.json`, and `docs/testing.md`.
- **Rules**: read `_agent-docs/project-context.md` whole and the checklist shards the change touches, as `_agent-docs/code-review-checklist/_index.md` directs, and pick ids inline.

## When `scale.ctx_agents` is on: two waves

**Wave 1** is `ctx-impact` plus every other dimension agent your skill runs except `ctx-checklist`, all in one message, each in the background.

**Wave 2** starts the moment `ctx-impact` returns, without waiting for the rest of wave 1: the checklist agents, in one message, each with `ctx-impact`'s whole report in its subject as `code_facts:`. A rule is often relevant only because of a fact in the code, and a checklist agent holding only the request cannot see it. With `scale.rule_selection: whole`, wave 2 spawns no checklist agent: pick checklist ids inline from the shards, as the off path does.

- **No `ctx-impact` in your skill** (the subject is a sprint, not code): run one wave with no `code_facts`.
- **`ctx-impact` returned `EMPTY` or `FAILED` after its retry**: start wave 2 with `code_facts: none`, and say so.

The agents' models live in their own frontmatter under `.claude/agents/`. Never override one at the spawn.

## When `scale.rule_selection` is `menu`: the checklist split

With `scale.checklist_fanout: 1`, spawn one `ctx-checklist` agent over the whole menu.

With `scale.checklist_fanout: 4`, spawn one agent per shard group, each subject carrying a `shards:` line. **Build the groups from the directory, never from a hand-typed list**: list `checklist_dir`, drop `_index.md` and `testing.md`, and deal the remaining shards across at most four agents in directory order. A hand-typed list silently stops covering a shard added later. `testing.md` goes to no agent: `create-tests` selects testing rules itself.

**A sprint shortlist replaces the split.** With `scale.sprint_context: on` and a subject carrying `sprint_candidates`, spawn one checklist agent: the shortlist is small enough to judge whole. It still gets `code_facts`.

## Merging the returns

- `IDS:` is the union of every agent's `IDS:` line, deduplicated.
- `SPRINT_CANDIDATES:` is the union, when your skill asked for it.
- `RULE_COUNT:` is the size of the merged `IDS:` set; carry `+outside-shortlist` if any agent flagged it.
- `UNRESOLVED:` is the union.
- An `EMPTY` return contributes nothing and is a valid answer for one shard group.
- A `FAILED` return, or an agent that ends without sending, is re-spawned alone with the same subject. Never merge the rest and proceed: the missing group reads as rules that do not apply.

**Every id line is literal comma-separated ids.** A return carrying prose or "same as above" is a delivery failure: ask that agent for a full resend rather than reconstructing the ids yourself.

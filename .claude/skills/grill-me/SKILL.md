---
name: grill-me
description: Grilling session that challenges a plan against RT Test's domain language, documented decisions and rules, sharpens terminology, and updates the glossary, ADRs, design docs and rule files inline as decisions crystallize. Use when the owner wants to stress-test a plan, or when create-ticket or change-request invoke it.
---

<what-to-do>

Interview the owner relentlessly about every aspect of the plan until you reach a shared understanding. Walk
each branch of the design tree, resolving dependencies between decisions one at a time. Give your recommended
answer with every question, and probe the edge cases and regressions each decision could cause.

Ask one question at a time and wait for the answer. A question with a small set of real answers goes through
`AskUserQuestion`; an open-ended one stays in prose (§ How to ask).

**Before asking, check whether the question is yours to answer.** The owner's turn is for preferences and
priorities. A question that turns on a fact is yours: read the code, read the planning docs, or spike it
(§ Settle it, don't ask it).

</what-to-do>

<supporting-info>

## Configuration

Read `_agent-docs/_flow-config.yaml`. Keys used: `{cfg.glossary}`, `{cfg.adr_dir}`, `{cfg.requirements}`,
`{cfg.project_context}`, `{cfg.checklist_dir}`, `{cfg.rule_maintenance_guide}`, `{cfg.design_decisions_dir}`,
`{cfg.rules_dir}`.
Create the glossary only when the first term resolves.

## Load the standards the plan must meet

A plan sound against the domain can still fail review because it breaks the project's own rules, so hold it
to them throughout.

**When a calling skill handed you its context** (`create-ticket` and `change-request` do), use it and gather
nothing again.

**Standalone**, gather it yourself as `{cfg.rules_dir}/context-fanout.md` directs. While `scale.ctx_agents`
is off, read inline: `{cfg.project_context}` whole, the checklist shards `{cfg.checklist_dir}/_index.md` names
for the plan's area, `{cfg.glossary}`, the ADR list (`node scripts/adr-index.mjs`), the requirements index
(`node scripts/requirements-index.mjs`), and the code the plan touches. While it is on, run that doc's fan-out
with the plan as the subject. **Ask nothing until every agent has returned**: name the count when you spawn
and again when all are in, since the last report often reframes every question asked before it. While you
wait, read and measure; reporting a finding is fine, asking a question is not.

When the grill moves into new territory, read the relevant shard or doc directly rather than spawning again.

Hold the plan against the rules as you do the glossary: when a decision would break a documented rule, say
so at once and make the owner reconcile it. A rule the plan must break is itself a decision: either the plan
changes, or the rule is wrong or out of scope, per `{cfg.rules_dir}/blocking-rule.md`.

## During the session

### Challenge against the glossary

When the owner uses a term that conflicts with `{cfg.glossary}`, say so at once: "The glossary defines
freshness as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When a term is vague or overloaded, propose a precise canonical one. "You said result: do you mean the
outcome of one test, or a run's summary? Those differ."

### Discuss concrete scenarios

Stress-test relationships with specific invented scenarios that force a precise boundary between concepts:
an edit during a run, a renamed test, an interrupted run, a test with no defect.

### Draw the state model

For a state machine, a lifecycle or a relationship between entities, put a Mermaid diagram in the question
instead of a paragraph: an illegal arrow is visible in a drawing. Use `stateDiagram-v2` for lifecycles,
`erDiagram` for relationships, and `flowchart` for rule order where several inputs collapse into one answer.
Draw what you believe and ask what is wrong with it. One diagram per question, small enough to fit a screen.
The diagram replaces the prose, never the turn-taking.

### Cross-reference with code

When the owner states how something works, check whether the code agrees, and surface a contradiction.

**When the caller handed you unbuilt work**, check each contradiction against it first. The code is a
snapshot of a plan mid-execution: it lacks what pending tickets add and still carries what they delete. A
contradiction the plan already accounts for is not a finding; the sequencing (which lands first, and what the
earlier one sees meanwhile) is. Never let the answer be that this plan does a pending ticket's work.

### Settle it, don't ask it

Four ways to settle a question of fact, cheapest first, and all four are yours:

1. **Read the code.**
2. **Read the planning docs**: the sprint files, unbuilt tickets, ADRs, requirements and `docs/`.
3. **Spike it**: run the smallest real thing that produces the fact (what a library does, what an API
   returns, what a run costs), and answer with the measurement.
4. **Offer a prototype**, when the question is whether a model feels right and only driving it can tell.
   That is the `prototype` skill's job, and the callers gate it after the grill.

**The sharpest trigger is a question you are about to ask with options.** When two options differ on
something checkable, check it first: the measurement often deletes an option.

**Spiking, in practice:**

- Say what the spike will decide, run it, and report the observed output verbatim with the command that
  produced it.
- The smallest real exercise, never a partial implementation. When it starts to resemble the feature, stop.
- It lives in `_agent-docs/.scratch/` and is deleted once answered. It never runs a consumer's tests, writes
  outside the scratch folder, or starts a persistent process.
- Timebox it out loud. If it overruns, the question was bigger than a spike: offer a prototype or hand it back
  as a genuine unknown.
- Spike when the measurement is cheaper than the mistake; ask when checking is expensive and the choice is
  cheap to reverse, and record the answer as an assumption.

**Every fact goes somewhere durable**: the calling skill's artifact (a ticket's Dev Notes, the fix about to be
applied) or the standalone handoff. **A spike that falsifies a documented rule is a finding**: fix the rule in
this session with the evidence, per `{cfg.rules_dir}/blocking-rule.md`, and sweep its citations.

### Update the glossary inline

When a term resolves and the owner agrees the wording, write it to `{cfg.glossary}` at once, in the format
[GLOSSARY-FORMAT.md](GLOSSARY-FORMAT.md) gives. This skill is the glossary's only writer. The glossary defines
terms and nothing else: no implementation detail, no specification.

### Offer ADRs sparingly

Offer one only when the decision is hard to reverse, surprising without context, and the result of a real
trade-off. [ADR-FORMAT.md](ADR-FORMAT.md) owns when to offer one and the enforcement question each must answer;
`{cfg.adr_dir}/README.md` owns the file format. **Ask the orchestrator for the ADR's number**, or the owner when no
orchestrator is running; never take the next free one.

### Propagate decisions to the living docs

The standards are an input the plan must meet and an output its decisions feed. When a decision
crystallizes, update each home it touches, and only those:

- **`{cfg.glossary}`**: a term introduced or sharpened.
- **An ADR**: the decision and why, per above.
- **`docs/architecture.md`**: the current design, when the decision changes it. It links `ADR-NNNN` rather than
  restating the decision.
- **`{cfg.requirements}`**: a behavior the product must have, as a requirement with an id the orchestrator
  allocated and its marker.
- **A rule**, routed by `{cfg.rule_maintenance_guide}`'s routing test to exactly one of `{cfg.project_context}`
  (a direction an agent would otherwise get wrong) and the checklist (a check a reviewer runs against a diff).
  Never both, and never a cross-reference between them.

**Draft the text during the grill and get the owner's nod before writing.** Before adding a rule, search for
one that already governs the item and sharpen it in place instead. Rule ids come from the orchestrator.

## How to ask

**A question with two to four real, mutually exclusive answers goes through `AskUserQuestion`**, one question
per call.

- **Your recommendation is the first option, labeled `(Recommended)`.**
- **Each option's description carries its consequence**: what it commits the design to and what it costs.
- **Evidence stays in the message**: a diagram, a `file:line` finding, a quoted rule or a measurement goes in
  plain text in the same turn, since the tool renders none of it.
- The owner can always type another answer, so an imperfect option list costs nothing.

Stay in prose when the answer is a sentence the owner writes ("what should this be called?", "why does that
constraint exist?"). A yes-or-no follow-up is a choice, and the commonest one in a grill.

## Closing

**When a calling skill invoked you**, run no closing sequence, write no handoff and offer no workflow. Stop
grilling once every live branch is resolved and continue the caller's next step in the same turn: announcing
the handoff and ending the turn strands the workflow until the owner types. Write at most one line naming
what the grill settled, in the same message as the caller's next action.

**Standalone**, when every branch is resolved or the owner is done, summarize the decisions and offer a handoff
to a fresh session: write `_agent-docs/.scratch/grill-handoff.md`, overwriting any earlier one. It is a full
record of conclusions, not a summary, since the next session has none of this conversation:

- **The plan**: its original framing, complete.
- **The resolved decision tree**: each question, the options weighed, the conclusion and why.
- **Codebase findings**: with `file:line` references, patterns to follow and contradictions found.
- **Measured facts**: each spike's question, command and verbatim output, apart from the findings, since the
  spike code is gone.
- **Standards reconciliation**: each rule that bore on the plan and how the plan meets it.
- **Docs already written**: every glossary term, ADR, design-doc, requirement and rule edit this session made,
  so the next session does not redo them.
- **Open branches**: anything still undecided.
- **Next step**: run `change-request` with this document as the change.

Then tell the owner the path.

</supporting-info>

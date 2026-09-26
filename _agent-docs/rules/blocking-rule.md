# A rule is blocking you

Read this when documented guidance forbids the thing you are trying to build: a rule in `_agent-docs/project-context.md` or `_agent-docs/code-review-checklist/`, an ADR, a requirement, or a doc under `docs/`. `AGENTS.md` carries the trip-wire and project context P21 the direction; this file is the procedure.

## Ask three questions before designing around it

1. **Is it true?** Settle a claim about a library against the installed source under `node_modules` (P10). Search the web when the question is current recommended practice rather than what the code does.
2. **Was it decided about this?** An ADR decides a question in a scope. Applying it outside that scope is not obedience but a category error, and it is the more common failure, because a policy decision does not look checkable the way a factual claim does.
3. **Is what blocks you the guarantee, or an illustration of how it used to be met?** A requirement often carries an example of a mechanism that would violate it, and the example ages with the architecture while the guarantee does not. Strike the example and re-read the rule. If it still forbids the design, the constraint is real. If it does not, one clause needs fixing, not the design.

## Then fix it, in this session

A rule that proves wrong, or wrongly scoped, is fixed with the evidence recorded: never worked around quietly, never left for later. Route the edit by `_agent-docs/rule-maintenance-guide.md`; under a lane, report the exact text to the orchestrator, which owns the rule docs.

**Fixing it means sweeping every citation, not just the rule.** Search the identifier (the `P` or `C` id, the ADR number, the requirement id) across tracked and untracked files, and update whatever repeats it: code comments, docs, tickets, and the ADR index source.

**Sweep unbuilt sprints and tickets hardest.** A stale comment is read by someone already looking at its code, but a backlog ticket citing a superseded rule is a future implementation instruction, and an agent will build the reversed pattern from it. A done ticket records what was decided then; leave it.

**A measurement settles question 1.** Run the installed library, or a throwaway script under `_agent-docs/.scratch/`, against a real input. If you cannot measure it, say the answer is unknown rather than inferring one.

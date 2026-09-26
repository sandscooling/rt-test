# Rule maintenance guide

Follow this guide whenever you add, refine, move or remove a rule in `_agent-docs/project-context.md` or `_agent-docs/code-review-checklist/`. Skills that surface a candidate rule bring the what; this guide owns the how. Write a rule when it surfaces, never as a ticket task.

## Two homes, one rule each

| Home                              | Holds                                                                                        | Read                                |
| --------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| `project-context.md`              | Directions where an agent's default instinct is wrong for this project                       | Whole, before writing code          |
| `code-review-checklist/` (shards) | Constraints a reviewer checks against a diff, including checks of the `AGENTS.md` guarantees | The relevant shards, when reviewing |

**The routing test.** Ask the two questions in order and stop at the first yes:

1. Would an agent, told only what `AGENTS.md` says, write it the default way without being told? If it would get it wrong, the rule is a direction: **project context**.
2. Is it a check a reviewer can run against a diff and call pass or fail? **Checklist.**

If neither holds, it is not a rule: put a long-form behavior in the design docs and pin it with a test. **Never both homes, and never a cross-reference from one to the other.** The implementing agent sees checklist rules too, because a ticket expands both docs.

**Nothing here repeats `AGENTS.md` or lint.** `AGENTS.md` holds working conventions and product guarantees; the `daemon-cli-state` shard holds reviewable checks of those guarantees, not restatements. A rule oxlint fully enforces is retired, since the lint message carries it; a rule lint enforces in part keeps only the unenforced part.

## Ids

- Checklist ids are `C<n>` and project-context ids are `P<n>`: a prefix and digits only, flat across the whole doc, so an id resolves in whichever shard its rule lives. There are no letter suffixes and no bullet forms.
- The orchestrator allocates a new rule's id: the next unused number in its doc, found with `node scripts/expand-rules.mjs --doc <checklist|project-context> --list`.
- Never renumber. A gap left by a removal is fine; tickets and other rules cite ids.
- A rule starts at column 0 as `C12. **Title**: text` and runs until the next rule, heading, `---` divider or HTML comment. Separate rules with a blank line.
- Every line of guidance sits inside a rule block. Prose between a heading and the next rule can never be selected, and `--list` fails on it. The one exemption is a `>` blockquote signpost addressed to maintainers.
- Tickets store ids, never rule text. `scripts/expand-rules.mjs` renders current text at read time, so an edit here reaches every ticket that cites the rule. Never paste rule prose into a ticket.

## Procedure

1. **Does it earn a place?** Left to its defaults, would an agent reliably get this right here? If yes, write nothing.
2. **Fact check.** Only when the rule rests on an external premise (a library behavior, a platform limit, a version): verify it in the installed source (`.d.ts`, then `.js`) or the vendor's current documentation. Pin the fact in a test and have the rule describe the behavior rather than quote the figure. A premise you cannot settle in a couple of reads is not written as an assertion. If the rule bans or bounds something, say what the ban forecloses, so a later session can reopen it on evidence.
3. **Refine before adding.** Search both docs for a rule on the same item. Sharpen a weak rule in place, merge near-duplicates, replace a wrong rule, remove an obsolete one, and add only when nothing governs the item.
4. **One obligation per rule.** An edit that adds a second thing a diff must separately satisfy is an add: give it a new id. A split keeps the original id on the original obligation.
5. **Route it** with the routing test above, and put it under the heading whose concern matches. Move a misplaced rule verbatim with its id rather than copying it.
6. **Generalize.** Delete the specific name from the rule; if a general rule remains, state it for the whole class and keep the name as an example. Never copy a value (a limit, a version) that lives in its source. A check that fires in one specific scenario is a spec: document it and pin it with a test instead.
7. **Settle enforcement** with the lint-hardening candidate check below.
8. **Sweep the blast radius.** When a rule's prescription for code changes, grep for existing code it now condemns and raise a change request for it. When a decision bans or supersedes a pattern, grep every shard and project context for rules that still mandate the old pattern and retire them in the same edit.

## Applying the edit

- Checklist: open `_index.md`, pick the shard whose concern matches, and add the rule under the matching `##` heading. A new whole shard also gets a row in `_index.md` and a `./<shard>.md` link, which sets its read order.
- Project context: add the rule under the matching `##` heading.
- Run `node scripts/expand-rules.mjs --doc checklist --list` and `--doc project-context --list`, and believe the exit code: it fails on a duplicate id, a line shaped like an id that parses to none, or content outside every rule block.
- Run `node scripts/check-rule-hygiene.mjs`. It must exit 0. It fails on a new provenance note or a citation of an id that does not resolve, against `scripts/rule-hygiene-baseline.json`. A fixed baselined violation is reported; shrink the baseline with `--update-baseline`, and never grow it to admit a new one.

## Writing a rule

- **The rule is the rule, and nothing about where it came from.** Never append a date, a ticket, sprint or ADR citation, a foreign rule id, an origin note such as "ported from" or "found in review", a rationale heading, or a revision note. Git holds history. Causal detail stays only when it changes what the reader does.
- If an ADR is the reason for a rule, state the ADR's decision as the rule and cite nothing.
- Keep it lean: a bold title, then one to three sentences in the imperative. No multi-line code; at most one short example.
- A checklist rule names what fails, so a reviewer can say pass or fail. A project-context rule names which way to go and, when it is not obvious, why.

## Lint-hardening candidate check

Run it whenever a rule is added or strengthened.

1. **Classify** whether oxlint could enforce the rule:
   - **config-expressible**: a built-in oxlint rule, a rule from an enabled plugin (`typescript`, `unicorn`, `vitest`), or an option such as `no-restricted-imports` or `no-restricted-globals`, set in `.oxlintrc.json`. oxlint has no `no-restricted-syntax`, so a syntax ban is not config-expressible.
   - **custom-plugin**: needs AST, cross-file or absence logic, written as a rule in `lint/` with named-defect tests that run the real oxlint binary.
   - **not lintable**: naming, clarity, design or correctness judgment. Stop here.
2. **Route by bucket.**
   - custom-plugin: ask the owner whether to run `lint-harden` now (recommended) or keep a manual gate. Never write a custom rule inside another workflow's steps.
   - config-expressible: spike it. Write a violating probe, run `bun x oxlint <probe>`, and confirm the output names your rule, not just a problem count. Then enable it, run `bun run lint`, and count the backlog. A zero count has three causes: clean code, a wrong option, or a rule that never became active (for example an `overrides` block that sets the same rule for those files). Only a fired probe rules out the last two. Fix a small backlog and land the rule now; otherwise ask the owner. When the target the rule names does not exist yet (a package, a file, an API not yet built), there is nothing to probe: record it as a candidate by step 3 until the target lands.
3. **Record a kept manual gate** by appending `→ lint-hardening candidate (<bucket>: <proposed mechanism>)` to the end of the rule, naming the mechanism. `lint-harden` finds its backlog with `rg "lint-hardening candidate" _agent-docs/code-review-checklist _agent-docs/project-context.md`.
4. **When lint lands**, retire the rule, or cut it to the part lint does not cover.

## Scale

`scale.rule_selection` in `_agent-docs/_flow-config.yaml` decides how skills select rules.

- `whole` (the default): read project context whole and the relevant shards whole, and pick ids inline.
- `menu`: render `node scripts/expand-rules.mjs --doc checklist --menu` (optionally `--shard <name>`), pick from the menu, then expand the chosen ids. With `scale.checklist_fanout: 4`, the menu is split across four selection agents by shard.

`node scripts/check-rule-hygiene.mjs` prints the corpus's rule count, rule-doc size and shard count, and warns without failing when a signal passes its threshold while the matching switch is off. Turning a switch on is the owner's decision.

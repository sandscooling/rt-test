---
name: lint-harden
description: Promote documented rules into oxlint enforcement, clearing each rule's existing violations as it lands. Use when the owner asks to harden lint coverage or turn a documented rule into an enforced one ("make C12 a lint rule", "harden P5"). Naming a rule id promotes just that rule and skips discovery. A whole-codebase campaign, never part of a per-change review.
---

# Lint harden

Take rules the project documents but enforces only by review, find the ones a linter can enforce, and promote
each to an oxlint error with its existing violations fixed, so `bun run lint` stays green and review stops
carrying them.

**Both rule homes are in scope.** A checklist rule is a pass-or-fail check; a project-context rule is a direction
("do it this way, not that way"), and where the way not taken is a construct a linter can see, banning it is the
strongest check that the direction is followed.

Read `_agent-docs/_flow-config.yaml` first. `{cfg.KEY}` below means that key's path and `scale.KEY` its switch.
Substitute every `{cfg.KEY}` and `{{variable}}` with its literal value before it reaches a spawned agent. oxlint
is configured in `.oxlintrc.json`; custom rules are oxlint JS plugin rules in `lint/`, registered in
`lint/plugin.mjs`.

## Operating rules

- **Check whether you are a lane member before your first edit.** Run `session_list` and read your own row: a
  `group` other than `null` or `orchestrator` means `_agent-docs/crew.md` and `{cfg.code_change_standards}`
  § Orchestrated Gate Delegation bind you. `.oxlintrc.json` and the rule docs are project-wide, so your dispatch
  must grant them by path; without a grant, report the exact text.
- **Real fixes only.** Fixing a violation means resolving what the rule flags. Never add an inline suppression,
  disable a rule for a file, raise a threshold, or narrow a rule's reach to dodge its backlog (P6).
- **A large backlog is cleared, or the promotion is declined.** There is no suppression ratchet. When a backlog is
  too large or too risky to clear in this campaign, say so and let the owner decide whether to promote the rule
  now.
- **No regressions.** Each rule's cleanup is a code change, gated by lint, typecheck and the affected tests before
  it is reported.
- **One rule per commit.** Each promoted rule is its own reported change, which the orchestrator commits: the
  revert unit and the resume boundary. Never commit, stage or switch branches yourself.
- **Rule doc edits follow `{cfg.rule_maintenance_guide}`.**
- **Bounded decisions go through `AskUserQuestion`; the candidate tables behind them stay in prose.** An answer
  that is a list (which rules to promote) is free-form: offer the common choices and let the owner type a subset.

## 1. Setup

- Read `{cfg.code_change_standards}` by its **Loading** paragraph: whole while `scale.doc_sections` is off. With
  it on:

  ```sh
  node scripts/doc-section.mjs {cfg.code_change_standards} "Pre-Edit Requirements" "Universal gates" "File Size & Extraction Strategies" "Lint" "Full Typecheck" "Full-Suite Validation" "Zero Technical Debt" "Writing Tests Outside create-tests"
  ```

- Read `{cfg.rule_maintenance_guide}`, whose § Lint-hardening candidate check owns the buckets, and
  `{cfg.rules_dir}/github-issues.md`, since no review reads this campaign's changes.
- Read `.oxlintrc.json` and `lint/plugin.mjs` whole → `{{current_lint}}`: every rule already enforced, so
  discovery never proposes one again, and the `overrides` blocks that scope rules by path.
- Read one custom rule and its test as the pattern for a new one: `lint/no-nonlocal-comment.mjs` and
  `test/lint/no-nonlocal-comment.test.ts`, which runs the real oxlint binary over temporary fixtures.
- **Resume log**: `_agent-docs/.scratch/lint-harden/progress.md`, listing each approved rule with its state
  (`pending`, `added`, `fixed`, `reported`, `declined`, `deferred`). When it exists, read it and resume at the
  first rule not `reported`, skipping discovery.

## 2. Mode

**Targeted, when the invocation names a rule** (`C12`, `P5`, or a concrete rule description). Skip discovery.

- Expand it: `node scripts/expand-rules.mjs --doc checklist C12` or `--doc project-context P5`. An id that does
  not resolve stops the run: ask which rule was meant.
- Classify it by the guide's buckets, name its target files, and measure its backlog with `rg` for the banned
  construct.
- Present the plan in prose (mechanism, target files, measured backlog, risk), then ask via `AskUserQuestion`
  (header `Promote`): **Promote it** or **Cancel**. Go to Step 4.

Output: `Lint-harden (targeted): promoting {{rule_id}}. Measuring the backlog.`

**Discovery, when no rule is named.** Run Step 3. Output: `Lint-harden campaign: classifying the rule docs.`

## 3. Discovery (read-only)

Start from the kept manual gates, `rg "lint-hardening candidate" {cfg.checklist_dir} {cfg.project_context}`, which
already carry a proposed mechanism; then classify every other rule in `{cfg.project_context}` and each shard
`{cfg.checklist_dir}/_index.md` lists.

**While `scale.ctx_agents` is off**, classify inline. **While it is on**, spawn one read-only `general-purpose`
classifier per shard file (and one for `{cfg.project_context}`), all in one message, each with the prompt below,
`{{rule_file}}` set to its file and `{{current_lint}}` to the literal list of enforced rules.

```text
You are a read-only classifier of lint-expressibility. You have no project context beyond this prompt.

Read {{rule_file}} whole. For each rule in it, decide whether oxlint could enforce it, and how:
- config: a built-in oxlint rule, a rule from an enabled plugin (typescript, unicorn, vitest), or an option such
  as no-restricted-imports or no-restricted-globals, set in .oxlintrc.json. oxlint has no no-restricted-syntax,
  so a syntax ban is not config.
- custom: needs AST, cross-file or absence logic, written as an oxlint JS plugin rule.
- none: naming, clarity, design or correctness judgment. Count these only.

A project-context rule is usually a direction, "use X, not Y": ask whether Y is a construct a linter can
recognize. If it is, ban Y.

Rules already enforced, which you never propose:
{{current_lint}}

For each config or custom candidate, give: the rule id and a short summary; the bucket; the mechanism (the
oxlint rule and options, or a one-paragraph sketch of the custom rule and why config cannot express it); the
target files as globs, with any test-file exemption; the estimated backlog from an rg search, stating the
search; and the false-positive risk. Estimate with rg, never by running oxlint: other classifiers run beside
you. Finish with one line: NOT_LINTABLE_COUNT: <n>.

Edit nothing, and create or update no tasks. Load SendMessage in your first message with
ToolSearch({query: "select:SendMessage", max_results: 1}), and as your last action send the complete table with
SendMessage(to: "main").
```

Rank the config candidates cheapest and safest first (smallest backlog, then lowest risk), which orders the
campaign and gates nothing. Present, in prose: the config candidates, the custom candidates with their sketches,
and one line with the not-lintable count. Then ask via `AskUserQuestion` (header `Promote`): **All of them**,
**Config only**, or **None**, noting that a subset can be typed by id. Record the approved rules as `pending` in
the resume log. With none approved, go to Step 5.

## 4. One rule at a time

The loop is sequential: rules share `.oxlintrc.json`, so each rule's breakage is resolved before the next is added.

### 4.1 Add the rule

- **Config**: add it to `.oxlintrc.json` as `"error"`, in the block whose `files` match its targets, honoring the
  existing test-file overrides.
- **Custom**: write `lint/<rule-name>.mjs` (kebab-case), register it in `lint/plugin.mjs`, and enable
  `rt-test/<rule-name>` in `.oxlintrc.json`. Write its tests in `test/lint/<rule-name>.test.ts` on the pattern of
  the existing lint test, running the real oxlint binary: each a named-defect test with an id from a range the
  orchestrator allocates, its record in the `defects.json` `docs/testing.md` names for the lint tests, proven by
  `bun run test:defects`.

**Prove it fires**: write a violating probe at a path the rule's block matches, run `bun x oxlint <probe>`,
confirm the output names your rule rather than only a count, and delete the probe. A rule that reports zero
violations may be clean code, a wrong option, or a rule that never became active; only a fired probe rules out
the last two. Mark it `added`.

### 4.2 Surface the violations

Run `bun run lint > <log> 2>&1; echo "EXIT:$?"` and collect the violations the new rule produced → `{{violations}}`
(file, line, detail) and their files → `{{violating_files}}`. None: go to 4.4.

### 4.3 Fix them

Fix each violation at its cause, by `{cfg.code_change_standards}`. Inline when `{{violating_files}}` holds 8 or
fewer. Beyond that, partition by file and spawn one `general-purpose` fixer per partition in one message, each
running `node scripts/expand-rules.mjs --doc <doc> <id>` and the standards sections from Step 1 itself, and
handed its file's violations by value. Every fixer prompt states: fix at the cause and never suppress, run no
lint, typecheck or test, create or update no tasks, never write an em dash, and report each violation as FIXED or
UNCERTAIN (with why) through `SendMessage(to: "main")` as its last action, loading the tool first with
`ToolSearch({query: "select:SendMessage", max_results: 1})`.

Put each uncertain item to the owner via `AskUserQuestion`: **Fix as flagged**, **Leave it and decline the
rule**, or a typed correction. There is no disable option. Re-run `bun run lint` until the rule reports nothing and
no other rule regressed. Mark it `fixed`.

### 4.4 Validate

All must pass, in order:

1. `bun run lint`, exit 0.
2. `bun run typecheck`, exit 0.
3. The tests beside every fixed file and their dependents, by § Full-Suite Validation, stating
   `<selected> of <total>`; the whole suite when the fixes span workspaces.
4. `bun run test:defects`, exit 0, when the rule brought tests or a fix touched an anchored line.

After 3 failed attempts, stop: leave the tree as it is, mark the rule `deferred` with the failure, and ask the
owner how to proceed. Never report a red rule.

### 4.5 Settle the rule text and report

Follow the guide's § Lint-hardening candidate check, step 4: **retire the rule when lint fully enforces it, or
cut it to the part lint does not cover**, removing its `lint-hardening candidate` marker either way. Then run
`node scripts/expand-rules.mjs --doc checklist --list --quiet`,
`node scripts/expand-rules.mjs --doc project-context --list --quiet` and `node scripts/check-rule-hygiene.mjs`;
each must exit 0. A retired id still cited by an unbuilt ticket's marker is swept: `rg` the id across
`{cfg.ticket_dir}` and `{cfg.sprints_dir}` and update each backlog ticket's marker with
`node scripts/fill-ticket.mjs --ids`, or under a lane report each edit.

**Report the rule to the orchestrator as one change**: its created and modified paths, the violations fixed and
files touched, and each gate with its exit code and window. Once the sha arrives, check whether the promotion
closed an open issue, by `{cfg.rules_dir}/github-issues.md` § Closing issues your change resolved, searching the
rule id and each fixed file; send any post's text to the orchestrator under a lane. Mark the rule `reported`.

Output: `[<k>/<total>] <rule>: <n> violations fixed, validated, reported.` Continue with the next rule.

## 5. Completion

- **A summary table**: per reported rule, its id, the oxlint mechanism, violations fixed and files touched.
- **Custom candidates the owner excluded**, with their sketches, so a later campaign can take them up.
- **Declined and deferred rules**, each with its reason.

Delete the resume log only after the owner confirms the campaign is complete; it is the resume anchor.

Output: `Lint-harden complete: <n> rules promoted to lint, <n> violations fixed.`

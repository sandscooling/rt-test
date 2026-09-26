---
name: create-tests
description: Write Vitest tests that each name and prove the defect they catch. Use when the owner asks to write, add or create tests, or to get something covered ("write tests for the rule expander", "add tests for 3.2"). Owns every test change for a ticket or inline change record: runs after dev-ticket or change-request and before review-changes, runs the suite, repairs the tests the change broke, and writes the new ones.
---

# Create tests

Write Vitest tests, reusing the test infrastructure that exists, each one titled with a named defect and proven
by `bun run test:defects` to fail against it.

Read `_agent-docs/_flow-config.yaml` first. `{cfg.KEY}` below means that key's path and `scale.KEY` its switch.
Substitute every `{cfg.KEY}` and `{{variable}}` with its literal value before it reaches a spawned agent.

Inputs, one of:

- **Ticket mode**: `{{record}}` is a ticket path or key (`3.2`, `3-2b`), resolved by globbing
  `{cfg.ticket_dir}/<N>-<M>-*.md`, or an inline change record under `_agent-docs/.scratch/change-requests/`.
  A change record is read exactly as a ticket. Never run `fill-ticket.mjs` on one.
- **Standalone mode**: `{{target_files}}` or a feature to cover, with no record.

**An argument you cannot resolve stops the run**; never demote it to standalone mode, which would test the
whole repository instead of the change. No argument and no ticket in `review`: ask which mode.

## Operating rules

- **Check whether you are a lane member before your first edit.** Run `session_list` and read your own row: a
  `group` other than `null` or `orchestrator` means `_agent-docs/crew.md` and `{cfg.code_change_standards}`
  § Orchestrated Gate Delegation bind you. Claim every file before its first edit; a production file you edit
  widens your blast radius to that file's, so name it in your report.
- **The falsification gate is the whole point of this skill.** `{cfg.code_change_standards}` § Writing Tests
  Outside create-tests is the gate: name the defect before writing, derive the expected value from the
  requirement, record one mutation, prove it with `bun run test:defects`. **Expected values come from the
  criterion or the spec, never from running the code and copying its output.** A spec-derived test that fails
  is a bug finding, never a test to bend.
- **Take defect ids only from your allocated range** (P26). The orchestrator allocates it; under a lane the
  dispatch names it. Ask before writing the first test when you hold none.
- **In ticket mode you are the only session that edits a test file.** Sort every red by
  `{cfg.code_change_standards}` § Full-Suite Validation: **pre-existing** (report it, under a lane to the
  orchestrator); **stale**, a test asserting behavior the criteria set out to change, which you update and
  re-prove; or a **code bug**, a test asserting behavior the change did not set out to change, which you never
  edit. Send a code bug to the dev session (`Dev session: threadId` in the record) with `session_wake`: the test,
  the failure, the guarantee it protects, and your threadId for the reply. Wait for the reply, then re-run that
  test. No dev session reachable: ask the owner.
- **Stay reachable until `review-changes` finishes its tech-debt step.** It sends coverage gaps and broken tests
  as `#### Test Coverage Gaps` rows in the record, and a debt fix after its main report can break a test. Work
  each row through Steps 4 to 7 like any target, then `session_wake` the review's threadId with the paths.
- **Author tests yourself.** Never delegate writing or the run-and-fix loop to an agent.
- **Reuse test infrastructure.** Search existing harnesses, fixtures and helpers before creating one; import
  what exists and extract what two files would share. Never copy a helper between test files.
- **Narrate as you go**: emit each `Output:` line when its step reaches it, without pausing for a reply.
- **Bounded decisions go through `AskUserQuestion`; the evidence stays in prose.**

## 1. Preflight

Confirm `vitest.config.ts` exists at the root. Output:
`create-tests: <ticket mode {{record}}|standalone <target>>. Loading context.`

## 2. Load context

### 2a. Standards and rule docs

Read `{cfg.code_change_standards}` by its **Loading** paragraph: whole while `scale.doc_sections` is off. With it
on:

```sh
node scripts/doc-section.mjs {cfg.code_change_standards} "Universal gates" "File Size & Extraction Strategies" "Targeted Test Validation" "Full-Suite Validation" "Test Coverage Recommendation" "Writing Tests Outside create-tests"
```

Then read `docs/testing.md` (the defect checker's mechanics and limits), `{cfg.rules_dir}/task-lists.md`, and in
standalone mode `{cfg.rules_dir}/github-issues.md`.

### 2b. Select the rules

Test authoring selects its own rules; the ticket's markers are scoped to implementation.

- **While `scale.rule_selection` is `whole`**: read `{cfg.checklist_dir}/testing.md` whole, plus any other shard
  whose rules the tests will exercise, and pick checklist ids inline.
- **While it is `menu`**: render `node scripts/expand-rules.mjs --doc checklist --menu --shard testing`, plus
  `node scripts/expand-rules.mjs --doc checklist --menu <ids>` over the sprint bundle's `checklist` list while
  `scale.sprint_context` is on. Select from the union.

Read `{cfg.project_context}` whole and pick the project-context ids; its test and defect-evidence rules always
apply. Bind `{{checklist_ids}}` and `{{project_context_ids}}`. **Both must be non-empty before Step 4**: an empty
selection means it did not happen.

### 2c. Test infrastructure

- **While `scale.sprint_context` is on and the sprint bundle has `test_infra`**: bind its anchors →
  `{{test_infra}}`, and open an anchored file only when you need a signature.
- **While `scale.ctx_agents` is on and no anchors are bound**: say so, then spawn `ctx-testinfra` once in the
  background with a subject whose `description` is the authoring task, `area` the workspaces under test and
  `target_files` the files to cover. Do 2d while it runs. On return, bind its inventory; while
  `scale.sprint_context` is on, append its anchors to the bundle's `test_infra` and run
  `node scripts/check-sprint-context.mjs`, or under a lane report the anchors to the orchestrator.
- **Otherwise, the normal path**: gather it yourself, as `{cfg.rules_dir}/context-fanout.md` directs. Read the
  test files beside the code under test, the `defects.json` beside them, and the harness and fixture modules
  they import (`rg -l "export function" test packages --glob "*.ts" --glob "!*.test.ts"`).

### 2d. The record

In ticket mode, read the record's `## Acceptance Criteria` → `{{acceptance_criteria}}`, and its
`### Dev Handoff`: `Dev session: threadId`, `#### Test Files This Change Broke`, `#### ACs Owed a Test` and
`#### Tests Owed` → `{{dev_handoff}}`. **An absent handoff heading stops the run**: ask the dev session for it,
since a missing list reads exactly like a change that broke nothing.

On the round the review sends, bind the rows under `#### Test Coverage Gaps` → `{{review_gaps}}`; on the first
round bind `(none logged)`.

Output: `Context: <n> checklist and <n> project-context rules, <n> infrastructure modules, gap log <n rows|none
logged>. Discovering targets.`

## 3. Discover targets

**In ticket mode, run the suite first**, by § Full-Suite Validation, scoped to the change's production files:
`bun x vitest related <production paths> --run`, stating `<selected> of <total>` test files. The dev ran none.
Sort every red by the operating rules. Every broken test file in the handoff and every stale red becomes a
target; every `ACs Owed a Test` and `Tests Owed` entry becomes a target whose guarantee is its named defect.

Then discover the rest, over the record's `### File List` in ticket mode or `{{target_files}}` standalone:

- **Each logged gap is a prior finding, not the output.** Confirm the covering test really is absent: list the
  module's test directory and `rg` the symbol, since coverage lives under other file names. Carry its defect
  sentence verbatim. A gap that turns out covered is said to be covered, naming the test; never omit it.
- **Scan every file the gap log does not name**: the review saw only its diff.
- **Skip what yields no defect**: barrels and re-exports, type-only files, static copy, configuration no code
  branches on.
- **Run the criterion join**: for each criterion, name the test that goes red if its guarantee breaks. A
  guarantee spanning files is where a file-by-file scan finds nothing.

**The dev's handoff is an input, never a ceiling.** Scan in full however narrowly it scoped things, and say
where your targets differ.

Output: `Discovery: <n> targets, <n> already covered, <n> excluded. Planning.`

## 4. Plan

For each target, **state the defect a test would catch, in one sentence.** No nameable defect, no target: record
it in `{{deliberately_untested}}` as `<path>: <reason>`. § Test Coverage Recommendation owns what does and does
not yield one.

Plan each target: its test file (append to the suite that covers the module; a new test folder gets its own
`defects.json`), its named defects, and the id each takes from your range. **Print the plan**, one line per
target (`<test file>  <n> named defects`), then keep going unless the owner interjects.

Output: `Plan: <n> files, <n> named defects, <n> deliberately untested.`

Create one task per target file and work them by `{cfg.rules_dir}/task-lists.md`.

## 5. Expand the rules

Immediately before the first test file:

```sh
node scripts/expand-rules.mjs --ids checklist={{checklist_ids}} --ids project-context={{project_context_ids}}
```

It is strict: an id that does not resolve is a typo from minutes ago, so fix the selection. In ticket mode also
run `node scripts/expand-rules.mjs --from-ticket {{record}}` for a ticket, never for a change record, which has
no markers. Bind the text for this session only.

Before creating any helper, fixture or harness, check `{{test_infra}}` and open the file for the signature.
Anything you extract for two files to share is new infrastructure → `{{new_infrastructure}}`.

## 6. Write and prove

Narrate one line per event: `[<i>/<n>] <test file>: writing <n> tests.` when you open a file,
`  D<id>: detected|survived|not run, <one clause>` per proof, and `[<i>/<n>] <file>: <n>/<n> detected` when it
closes.

**Write each test from the spec.** Follow a criterion to the requirement, ADR or doc it cites and take the
expected value from there verbatim; a paraphrase in the ticket that drifted from its source is the bug this test
exists to catch. Each test meets § Writing Tests Outside create-tests step 2: titled `it("D<id>: <behavior>",
...)`, hook-free, one assertion, inputs under what the defect sandbox copies (fixtures in `test/fixtures/`), and
one `it` per `it.each` arm.

**Record each mutation** in the `defects.json` beside the test: `id`, a `defect` sentence, the `file` it mutates,
and the exact `old` and `new` text, where `old` matches once. The named defect is the mutation: break exactly that
behavior with one minimal edit (invert a comparison, drop a guard, return a constant, skip a write). Write the
file with the `Write` or `Edit` tool, since the anchors are source text.

**Prove it**: `bun run test:defects > <log> 2>&1; echo "EXIT:$?"`. It needs a passing baseline, applies each
mutation in a disposable copy, requires the named test to fail at an assertion, and re-verifies the restored
baseline. It never touches the live tree, so never hand-edit a production file to watch a test fail (P25).
Read its exit code and detected count. A setup, compile or timeout failure is not a detection.

**Diagnose a survivor before touching anything** (C65):

- **Vacuous test**: the mutation is observable and this test does not notice. Rewrite it → `{{vacuous_rewrites}}`.
- **Unobservable mutation**: the behavior is guaranteed again downstream, so the test is fine. Pick a mutation
  that is observable; when none exists, record the production line in `{{inert_mutations}}` and move on.

**A type-level guard** is proven with a `@ts-expect-error` fixture that `bun x tsc --noEmit` checks (C92).

**A spec-derived test failing against unmutated code is a suspected defect** → `{{suspected_defects}}`, with its
criterion and the observed behavior. Say it aloud when you find it. In ticket mode it is a code bug for the dev
session; standalone, fix the source, or put a real fork to the owner with your recommendation. Never adjust the
test.

Mark each file's task complete as it lands.

## 7. Validate

- **Rule compliance** against the expanded rules, and every accepted test named and proven.
- **Lint**: `bun x oxlint` over every file you wrote or edited, production files included. Leave no
  cognitive-complexity warning you authored.
- **Typecheck** by § Targeted Typecheck: `bun x tsc --noEmit` for `test/**`, the workspace's typecheck for a
  workspace's tests.
- **The suite**, by § Targeted Test Validation over the files you touched. In ticket mode the suite already ran
  at Step 3: re-run only what changed since (a dev fix, shared test infrastructure you touched, and the suites
  importing it).
- **Named defects**: `bun run test:defects` exits 0 over the final tree.
- **Reconcile files touched against files run**: `<run> of <touched>`, accounting for every difference. A scoped
  run reports what it selected, never what it skipped.

Test files carry no size limit, and a test file is never split for one.

## 8. Report and record

**Suspected defects first.** Each with its criterion, the expected behavior, what the code does, and where it
went: fixed (name the change), sent to the dev session, or put to the owner.

**In ticket mode, write the record's `### Tests Record`** (a change record's starts empty, so add the headings):

- `Tests session: threadId <your self row's threadId>`.
- `#### Named Defects`: one line per proven test, `D<id>: <defect sentence> (AC<n>)`, tagged with the criterion
  it pins. Add one line per logged gap discovery refuted, naming the test that covers it.
- `#### Deliberately Untested`: each `{{deliberately_untested}}` entry as `<path>: <reason>`.
- Write `None.` under an empty heading.

Tick each criterion from `#### ACs Owed a Test` once its test is proven.

**Standalone, check whether the tests closed an open issue**, by `{cfg.rules_dir}/github-issues.md` § Closing
issues your change resolved. In ticket mode the review owns that scan.

**Summarize**: files written, named defects detected of written, `{{vacuous_rewrites}}`, `{{inert_mutations}}`,
`{{suspected_defects}}`, `{{new_infrastructure}}`, and the suite totals. Say plainly if any target was dropped
and why.

**This skill never commits.** Report your created and modified paths, each gate with its exit code and window,
and the named defects to the orchestrator (`_agent-docs/crew.md` § Your report); it stages and commits. In ticket
mode, stay reachable for `review-changes`.

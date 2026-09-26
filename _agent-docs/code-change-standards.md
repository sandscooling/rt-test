# Code change standards

The procedure every workflow that changes code runs around an edit: `dev-ticket`, `change-request`'s inline fix, `create-tests`, `review-changes`, `lint-harden`, and an ad-hoc change with no workflow running. The rules the code itself must meet live in `_agent-docs/project-context.md` (`P` ids) and `_agent-docs/code-review-checklist/` (`C` ids); this document cites them by id and never restates them. Expand an id with `node scripts/expand-rules.mjs --doc <project-context|checklist> <ids>`. `AGENTS.md` owns the working conventions and product guarantees.

Steps below speak of **the rule set** (the rule ids your workflow expanded) and **the files in scope** (the files the change edits). Read them as roles and substitute your workflow's own names.

**Loading.** While `scale.doc_sections` is `off` in `_agent-docs/_flow-config.yaml`, read this document whole. With it `on`, load the sections a step needs with `node scripts/doc-section.mjs <code_change_standards> "<heading>" ...`: a heading matches exactly or by unique prefix, and an unmatched or ambiguous one exits 1. Run it bare; a `head` or `tail` on its output cuts the last sections named after the script has already exited 0. **The headings are an interface**: rename one only together with every call that names it.

## Pre-Edit Requirements

- **Read the whole changeset before the first edit, with the `Read` tool.** Then issue independent edits together:
  - New files through `Write`: batch freely.
  - Edits to files already read: batch a handful of similar edits; split unlike edits into smaller groups.
  - When one edit decides another's shape (a signature, an export), apply them in order.
- **Pick the tool by the payload.** Content you authored, landing in one place, goes through `Write` or `Edit`; a heredoc adds a way to lose it. A transform over many files (the same replacement across N paths, a computed edit) goes through a script. A script writes behind the read-before-write check, so re-read every file it touched before editing it again.
- **A batch that partly fails leaves its successful edits applied.** Re-read the failed file and fix forward; never re-issue the whole batch.
- **Scan each file in scope whole against the rule set** before implementing, and fix what you find. Record those fixes apart from the change's own, as pre-existing fixes.
- **Apply the rules to legacy code too.** Match a file's structure and naming, never its violations.

## Universal gates

These apply to every code edit. The marker says what enforces each: a `[lint]` or `[tsc]` gate cannot ship broken, because the completion gates turn it red; a `[you]` gate has nothing mechanical behind it, so hold it while you edit. If a marker and a lint run disagree, believe the run and report the discrepancy.

Mechanically enforced (`.oxlintrc.json` and `tsconfig.base.json` hold the settings):

- `[tsc]` **Strict TypeScript** with no relaxed option (P7).
- `[lint]` **No `any`, no unused binding, no warning-word comment, no `@ts-ignore`.** Fix each at its cause (P6); never suppress a rule.
- `[lint]` **Production files stay under the code-line cap** (P16; § File Size & Extraction Strategies).
- `[lint]` **Cognitive complexity.** `rt-test/cognitive-complexity` fails a function past its threshold, and `rt-test/cognitive-warn` warns below that. **You may not finish with a warning you authored**: a function your change creates, raises past the warn threshold, or moves comes back under it before handoff. A pre-existing warning elsewhere in a file you touched is reported, not fixed by default. The remedy is extraction and guard clauses, since the metric charges for nesting and breaks in flow; it charges nothing for `?.` or `??`, so deleting null-safety moves nothing. A missing check that you add raises the score correctly; bring it down by extraction, never by removing the check.
- `[lint]` **A comment carries no rule or issue reference, ADR or ticket reference, date or `file:line` citation, and a block comment stays short** (`rt-test/no-nonlocal-comment`). Write the local consequence the first time, since each rejected form costs a lint round trip.
- `[lint]` **Test files carry no focused or skipped test and no snapshot matcher.**

Yours to hold:

- `[you]` **Reuse before creating** (C5, P20).
- `[you]` **A comment states one fact the code cannot state** (P17). Rename, extract, name a constant or narrow a type first. Delete a comment that merely restates its code; the test is whether deleting it loses anything a reader could not recover from the code and a good name. A comment that contradicts its code (C46) is worse than none.
- `[you]` **Name every magic value** (C3), and sweep the whole category once you extract any of it (§ Pre-Done Literal Check).
- `[you]` **Deleting or narrowing an exported symbol is a sweep, not an edit** (§ Deleting an Exported Symbol).
- `[you]` **A gitignored path is out of scope: never review it, never edit it.** `git status` and `git diff` exclude it, so it only reaches you through a search you ran, looking like an ordinary hit. `_agent-docs/.scratch/` holds prose naming source files. Confirm with `git ls-files --error-unmatch <path>` before editing a file the change did not already touch.
- `[you]` **Every test names the defect it catches and is proven against it** (§ Writing Tests Outside create-tests). In a workflow only `create-tests` writes tests.
- `[you]` **Find call sites with the typecheck** after changing a shared symbol's name or shape (P14), and with `rg` for text.
- `[you]` **Verify third-party behavior in its installed source** (P10; § Third-Party Semantics Verification). A wrong belief that compiles ships.

## Third-Party Semantics Verification

Before you read a field off a library result, implement a callback the library invokes, or rely on the library cleaning up for you, confirm what it does in the installed source (P10): the `.d.ts` first, then the `.js`.

**Why it is a gate.** Verification is otherwise triggered by the compiler: a wrong assumption that produces a type error gets investigated, and one that compiles ships. Self-review cannot catch a belief you still hold, so code that typechecks and passes its own review can still be wrong about the library.

**Check for each of the four shapes by name:**

1. **A field that means less than it says.** Confirm whether a value is per item, per file, per attempt or cumulative, and whether that changed in the major you are on. A reporter callback's task list, for example, may cover one file rather than the run.
2. **A callback whose throw is not yours to own.** If the library awaits your handler inside its own pipeline, a throw can fail an operation that already completed. Find where it invokes the callback before deciding whether the handler needs its own `try`.
3. **Cleanup the library already did.** Before writing a compensating close, kill or release, confirm the library does not already do it. A duplicate scoped wider than the failed operation can damage a concurrent healthy one.
4. **A filter or default you never set.** Read the constructor's options type and the predicate it filters on, not just the method you call.

**Where the questions come from.** A ticket's unverified-assumptions table is the worklist: resolve every row against installed source before implementing. It is a floor, not a ceiling; anything you meet mid-change that fits a shape above gets verified whether or not a row exists.

**A wrong assumption written as a requirement is the expensive version.** An acceptance criterion or dev note telling you to call an API a certain way was written by an agent that could not run it. When the source contradicts it, the source wins: fix the code, correct the ticket text you may edit, and record the correction.

**A review finding that asserts third-party behavior is a hypothesis.** Run the same check on the reviewer's claim before writing a fix, a comment or a test for it. When the source refutes it, close the finding and say why; a fix built on a false premise ships dead code and a comment asserting the premise.

**The project's own docs are claims too.** An ADR, a rule or a docblock asserting what a library does is as unverified as your own belief, and more trusted. When one blocks a design, follow `_agent-docs/rules/blocking-rule.md`.

**Record what you find**: the correction and the source location you verified against, in the ticket's record, so the next session does not re-derive it.

## Deleting an Exported Symbol

The removal is the safe part; the sweep is the work.

**Drive the sweep with `bun run typecheck`**: remove the export, re-export entries in each `index.ts`, and private helpers whose last consumer just left, then re-run, since removing an entry point exposes the next layer. Two things the typecheck will not tell you: a test, mock or barrel is not a consumer (C59, C58), and prose counts as usage (C48).

**Narrowing takes the same sweep and fails silently.** Splitting one constant into two, or giving one caller its own copy of a shared helper, starts the sibling at the same value, so every output and every test is unchanged. The miss surfaces on the day the two values diverge.

- **The unit of the sweep is the meaning, not the file.** One file often holds both meanings; say in the ticket which lines carry which.
- **Every site that states a value moves with the site that uses it.** A limit and the message quoting that limit are one unit.
- **A list handed to you is a starting point, never an inventory.** Grep the file for every reference before finishing.
- **State that the values are deliberately identical**, or the next reader tunes one.

**Grep the bare name, never a usage form.** `\.foo\b` and `foo(` find readers and miss declarations, re-exports and mirrors. Then run a second, compound pattern, because a word-boundary pattern misses `fooText` and `autocompleteFoo`: `rg -n '(^|[^A-Za-z])foo[A-Za-z]|[a-z]Foo'`. Write multi-word patterns separator-tolerant (`selection[- ]fallback`), and parenthesize an inner alternation so it does not bind at the top level.

**Grep the symbols that survive, too.** Removing one role of a constant or one field of a result leaves the symbol's name in place while every sentence enumerating its roles becomes false.

**A move breaks references inside the file the symbol left.** Grep the whole source file for each moved name, and classify each hit by the symbol it names, not the function it sits in: a reference breaks only when it and its target land on opposite sides of the move.

**Scope the search by where a claim can live.** `rg` searches tracked and untracked files and skips ignored ones, which is the scope `AGENTS.md` asks for. Beyond `packages/`, `apps/`, `scripts/`, `lint/` and `test/`, include the setup files a fresh clone follows: `package.json` files, `*.config.*`, `.github/workflows/`, `_agent-docs/_flow-config.yaml`, and each workspace's `README`. Record the command beside any hit count you report. A closure check enumerates and classifies its hits (C50).

**Trim test files by `describe` subject, never by line range**, and delete a block only when the thing it tests is the thing you deleted.

## File Size & Extraction Strategies

**The limit is P16's**, and lint's `max-lines` enforces it on code lines, not raw lines: blanks and comments do not count, so deleting comments never buys room. It covers production code, `scripts/` and `lint/`; test files have no cap, and a test file is never split to satisfy one. Measure a borderline file with `bun x oxlint <file>` rather than a line count.

**Extracting to satisfy cognitive complexity grows the file, and the two limits then fight.** Each extracted function adds a signature and parameters. The resolution is a **sibling module**, never a smaller extraction: move the helpers beside the original, leave the original holding its entry points and flow, and aim well under the cap. Check both numbers, for both files, before calling an extraction done.

**An extraction manufactures justifying prose, and no gate reads a sentence.** A moved helper gets a header saying why it exists, usually by lifting a true claim from a doc and dropping the clause that made it true. When a comment restates a doc, diff it against the source sentence clause by clause, and review the sentences as well as the code.

**Extraction strategies, in order:**

1. **Pure logic into a module beside its caller**, with a narrow interface (P18). Keep divergent callers thin rather than merging them behind a mode flag (P19).
2. **Logic a second package needs into a `packages/*` library** (P20).
3. **Script helpers into `scripts/lib/<area>/`**, each with a `.d.mts` a test can import (P11).
4. **Types imported or derived from their source** (C14), declared beside their readers.

## Lock File Check

Add a dependency only as P9 directs. After any `bun install` or `bun add`, run `git diff bun.lock`. If it shows version changes for packages the task did not require, output a LOCK FILE WARNING and stop for the owner. Under a lane, `package.json` and `bun.lock` are the orchestrator's: report the exact dependency and version instead of installing.

## Post-Change Validation

**These are gates, not a running order; your workflow owns the sequence.** Per-unit gates fire inside the implementation loop: § Targeted Typecheck and § Targeted Test Validation. Completion gates fire once the change is done, in this order: § Lint, § Full Typecheck, the acceptance-evidence pass (what would be observed if each criterion were false; `dev-ticket` Step 7), § Full-Suite Validation, named defects (§ Writing Tests Outside create-tests), § Pre-Done Literal Check, § Citation Shift Check, § Test Coverage Recommendation.

**In a workflow the list splits by session.** The implementer (`dev-ticket`, `change-request`'s inline fix) runs every gate except the test gates, and writes no test. `create-tests` runs next and owns § Targeted Test Validation, § Full-Suite Validation, the named defects and § Test Coverage Recommendation. `review-changes` runs § Post-Fix Re-Validation after its own fixes.

**Every gate that can still change code comes before the suite**, so a finding after a green suite never invalidates a run already paid for.

**A gate is evidence about the tree it ran against, and nothing else.** A review fix, a sibling lane's edit or a doc write replaces the measured tree. Re-run what a later edit invalidated, and quote every result with the window it measured.

**Gate a dependency bump on a tree with no other code change**, so a red is attributable to the bump.

**Read exit codes with the Bash tool**, redirecting a gate's whole output to a log and printing its status after: `bun run test:run > <log> 2>&1; echo "EXIT:$?"`. PowerShell does not set `$?` the same way, and a piped filter's status replaces the runner's.

### Orchestrated Gate Delegation

`_agent-docs/crew.md` decides whether you are a lane member and owns your file set, your report and where questions go. This section maps this document's gates onto a lane, and it is inert when you are not in one.

A lane shares one checkout with its siblings, so a repo-wide gate reads every lane's code at once. The gates split by scope:

| Gate                                                                                                                                                                   | Owner            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| § Targeted Typecheck, § Targeted Test Validation, targeted lint over the files you touched, `bun run test:defects` to prove your named defects, § Citation Shift Check | the member       |
| `bun run check` (repo-wide lint, typecheck, suite, named defects, build), staging, the commit, status transitions, and every project-wide file                         | the orchestrator |

`bun run test:defects` mutates only a disposable copy and never the live tree, so it may run while siblings edit. A suite or defect run can still read a sibling's half-finished file, so a red can belong to another lane; `_agent-docs/crew.md` says what to do with one outside your file set.

#### Claim a file before you touch it

- **Claim every file before your first edit to it**: `node scripts/file-claims.mjs claim --lane <your group> --thread <your threadId> <paths>`. `CLAIMED` or `HELD` means the path is your lane's. Claim a file a tool writes for you the same way.
- **`CONFLICT` means another lane holds the path: edit nothing in the set.** Send the orchestrator the `CONFLICT` lines and wait. Never merge, edit around, revert or check out the other lane's file.
- **`REFUSED` means the path is orchestrator-owned and no grant covers it for your lane.** Report the exact text you need, and the orchestrator writes it or grants the path to your lane (`grant --lane <lane> --thread <threadId> <path>...`, one lane per path).
- **A claim cannot see an edit nobody claimed.** Before your first edit to a `CLAIMED` path, run `git status --porcelain -- <path>`; a path already dirty is another session's unclaimed edit, so report it as a conflict.
- **Re-claim when your file set widens**, above all after a change of approach, where the new file feels like part of a set you already claimed. A widening is also a size event: re-count your lane's files and tasks against the one-ticket size limits `create-ticket` applies, and if either is over, claim nothing new and send the orchestrator what is on disk, what the widening adds and a proposed split.
- **Never release another lane's claim.** The orchestrator releases yours when the lane's last commit lands.

**Reaching an orchestrator-owned gate is a report, not a run.** Say which gates you ran, against which tree state, and name any file outside your stage's usual scope: a tests session that edits a production file widens the blast radius to that file's, and only you can see it.

### Lint

`bun run lint` runs oxlint over the repository (P5); `bun x oxlint <paths>` lints the files you touched. Fix every error at its cause (P6) and re-run until clean. Warnings do not fail the run; § Universal gates owns the one warning you may not leave. Expect `rt-test/no-nonlocal-comment` to fire on the explanation a fix round writes while it still holds the reasoning: extract the function doing two things, so the sentence becomes a name.

### Targeted Typecheck

The per-unit gate after an edit, run before the unit is marked complete.

| Files touched                         | Command                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/<dir>/**`                   | `bun run --filter <name from its package.json> typecheck`                             |
| `test/**/*.ts`, `vitest.config.ts`    | `bun x tsc --noEmit` (the root `tsconfig.json`)                                       |
| `scripts/**/*.mjs`, `lint/**/*.mjs`   | none compiles them: run their tests and the script itself                             |
| a `scripts/**/*.d.mts` a test imports | `bun x tsc --noEmit`, plus the tests, since the declaration can drift from the script |

**Each command compiles the whole workspace**; TypeScript has no per-file mode. Report it as a workspace compile.

**When a return shape changes, the typecheck names the sites that error, not the sites that are wrong.** An assertion that stays type-valid against the new shape fails at runtime instead. Derive the repair from the shape that moved, find every consumer of the old shape (C38), and finish with a search for the old access forms that returns nothing.

**Skip conditions.** Any one skips the gate; name the one that applied:

1. **No TypeScript changed**: every changed file is Markdown, YAML, JSON or another non-code file.
2. **Comment-only**: every edit since the last passing typecheck changed only comments or whitespace. `@ts-expect-error`, triple-slash references and `@type` JSDoc in JavaScript are not comments for this purpose, and a mixed unit is a code change. If unsure, it was not comment-only.
3. **Outside every compiled graph**: every changed file is under `_agent-docs/`, `docs/` or `.claude/`, or is a plain `.mjs` covered by the row above. Typecheck is inert there; run the file's own tool instead (its tests, `bun run rules:check`, `bun run check:planning`, or the script).
4. **Lane member, no type-bearing edit**: no edit since your last passing typecheck changed a type, an export, a signature, or a call into another file. The orchestrator's `bun run check` still gates the final tree. Say which edits you judged type-free.

A comment-only unit still takes § Lint, since comment text is linted.

### Full Typecheck

`bun run typecheck` compiles the root and every workspace, and must exit 0. It is a completion gate; pull it early when a change alters an exported type, since that breaks files you did not edit.

**Scope it by dependency direction when the change stays in one workspace**: typecheck that workspace and every workspace that lists it in `dependencies`. Run everything when the change spans workspaces or you cannot say where each changed file belongs.

### Targeted Test Validation

**Run by the session that may edit tests**: `create-tests`, and `review-changes` over its fix round. The implementer skips it.

Run the tests beside the changed code: `bun x vitest run <repo-relative paths> > <log> 2>&1; echo "RUNNER_EXIT:$?"` (P4).

- **Read the `Test Files` count and confirm it is the number you targeted.** A path that matched nothing reports `No test files found` and exits 1; it is not a pass.
- **A red is real.** Re-run once only a single timing-sensitive test; never re-run a suite to chase a phantom, and never re-run to double-check an exit code.
- **Triage a failure by § Full-Suite Validation.** This gate fires mid-change on a test that was green minutes ago, the likeliest moment to edit an assertion to green quietly.

With no test beside the changed code, skip this gate; § Full-Suite Validation still runs.

### Full-Suite Validation

Run by `create-tests` once an implementation is complete, and by `review-changes` after its fix pass. It protects against **transitive regressions**: A changed, C depends on A through B, and C's test fails. A hand-picked list of related tests cannot see those.

`bun run test:run` runs every Vitest project. Scope to the blast radius only by a graph walk, `bun x vitest related <paths> --run`, and **state the denominator**: `<selected> of <total>` test files. Read a zero or implausibly small selection as a wrong path form, not a pass; fix it and re-run. Run the whole suite when the change spans workspaces, touches shared test helpers, or its reach is uncertain.

**Categorize every failure by causation**, not by whether its file is in your changed list:

- **Caused by this change**: the failing test's code depends, directly or transitively, on a file you changed. When unsure whether a path exists, treat it as caused.
- **Independent and pre-existing**: no path to your change. A red suite is a defect: fix it separately, in its own commit; under a lane, report it to the orchestrator.

For each caused failure, read the test and the code it exercises before changing anything:

- **A genuine regression**: fix the source. `create-tests` does not fix it; it sends the test, the failure and the broken guarantee to the implementer session and leaves the test alone.
- **The test asserts behavior this change deliberately altered**: update the test to pin the new value (C76), and re-prove it with the pre-change code as its mutation (§ Writing Tests Outside create-tests). `review-changes` sends this to the tests session.
- **Unclear**: establish intended behavior from the acceptance criteria, then decide.

**Never green a failing test by editing it** unless the source is confirmed correct and the test asserted deliberately changed behavior. After 3 fix attempts on caused failures, list the remaining errors in detail and stop (§ Failure Investigation Protocol).

### Post-Fix Re-Validation

The gate after a review's findings are applied: `dev-ticket`'s adversarial pass, `review-changes`' fix pass, and their equivalents. The fixes landed after the completion gates ran, so by default all three run again: lint, `bun run typecheck`, and the suite, plus `bun run test:defects` when a fix touched a named-defect test or a line a defect record mutates.

**The implementer's arm runs lint and typecheck only**: `dev-ticket`'s adversarial pass and `change-request`'s inline equivalent, because `create-tests` runs the suite after them.

**Scope the suite from the fix round, never from the change that was reviewed**, by § Full-Suite Validation. Name the scope you ran and the round you scoped from.

**Comment-only exemption.** When every fix in the round is comment-only by § Targeted Typecheck's definition, skip the typecheck and the suite, since no behavior changed, and still run lint.

**Outside-the-graph exemption.** When every fix landed under `_agent-docs/`, `docs/` or `.claude/`, typecheck and the suite are inert: run the doc's own tool instead, and say which.

**Either exemption needs every fix to qualify**, and a mixed round takes the union. Name the exemption in your output, so a reader can see which gates did not run.

### Pre-Done Literal Check

Before marking a change complete, scan every file you touched for inline literals carrying domain meaning: limits, counts, sizes, thresholds, status strings, fixed codes. Each becomes a named constant (C3) placed by its readers (C4). Extracting any of a category obliges you to sweep the whole category: search your own diff for bare literals in the same position as the constant you introduced.

### Citation Shift Check

Once the code is final, run `node scripts/check-line-citations.mjs` and re-point everything it names. It reports `file.ts:NNN` citations in live artifacts that your diff moved, compared with `HEAD` (`--base <ref>` to compare with another ref).

- **Re-point by name, never by the suggested number.** `now ~NNN` helps you find the target; a fresh number is the same defect rearmed. Cite the function, the rule id or the heading.
- **"the cited lines were themselves edited"** means the target changed, not moved: reread the sentence around the citation.
- **It is advisory** (`--strict` exits 1 on a hit).

**Scope.** `--list-live-roots` prints what it reads: the root docs, `docs/`, `_agent-docs/`, `.claude/`, the workspaces and tooling, and every path key in the flow config. It skips design-decision records, done tickets and done sprints, which record what was true when written, and test fixtures, which are deliberate inputs. It reads only tracked files, so an uncommitted record's own anchors are on you: re-measure them by hand after inserting lines, and prefer a name anchor.

### Test Coverage Recommendation

What earns a test. `create-tests` applies this at discovery and `review-changes` at its gap sweep; the implementer does not.

**The only criterion: can you name a specific defect a test would catch?** File size, a missing test file and coverage percentage are not criteria.

**Enumerate over both the changeset and the acceptance criteria.** Walking changed files finds a defect inside a diff hunk. It cannot find one in the join between files: a value one file resolves and another consumes, where each diff is an unremarkable move. In ticket mode, state each criterion's guarantee in one sentence and name the test that goes red if it breaks. No such test is a gap, even when every file reads as covered.

**"Already covered" means a test goes red, not that a test file was touched.** When a change is structural (a moved call, a deleted guard), answer the question by mutation: record the defect in `defects.json` and run `bun run test:defects`, or break the behavior in a scratch copy and run the suite. Still green means unprotected.

**Usually yields a nameable defect:** freshness and state transitions, selection and widening, identity and fingerprint binding, parsers and serializers, guards and validation, error paths, exit codes and emitted output.

**Usually yields none:** type-only changes, re-exports and barrels, static copy, configuration that no code branches on.

The category is a hint; the defect is the criterion. **Expect to recommend no tests often**: a test with no nameable defect is a change detector.

**`review-changes` writes its gap block under exactly `#### Test Coverage Gaps`, on its own line, with `None.` under it when there are none.** `create-tests` searches for that heading, so a reworded one drops the whole gap log without a word.

State the verdict either way. When recommending, name each file and the defect its test would catch; when not, say why. Record each source file you deliberately leave untested as `<path>: <reason>` in the ticket's record, so the next review does not raise it again.

### Zero Technical Debt

Fix every error, pre-existing ones included, and record the pre-existing fixes apart from the change's own. Deferring a finding to an issue is the owner's call (`_agent-docs/rules/github-issues.md`).

## Failure Investigation Protocol

When validation fails after 3 attempts, investigate before escalating:

1. Find every definition and caller of the failing symbol with `rg`, and read them.
2. Run `bun run typecheck` to enumerate call sites a text search missed (P14).
3. For a third-party symbol, read its installed `.d.ts` and `.js` (P10).
4. Read the full source of every other function the error names.

If that finds the root cause, fix it and retry with the attempt count reset. Otherwise ask the owner: **retry** with a fresh approach, **investigate** (report the failure details and wait), or **halt**.

## Writing Tests Outside create-tests

**In a workflow, `create-tests` is the only session that writes or edits a test.** This section is the falsification gate it runs, and the one an ad-hoc change runs when it writes a test. `docs/testing.md` describes the defect checker's mechanics and limits.

**The gate:**

1. **Name the defect before writing** the test, in one sentence, and derive the expected values from the requirement. No nameable defect, no test.
2. **Write it as a named-defect test**: titled `it("D<id>: <behavior>", ...)` (P22), hook-free (P23), with one assertion (P24), an id from your allocated range (P26), and inputs the defect sandbox copies (P27). `it.each` arms are invisible to the checker, so write one `it` per arm.
3. **Record its mutation** in the `defects.json` beside the test: `id`, a `defect` sentence, the `file` it mutates, and the exact `old` and `new` text. The mutation is the named defect; do not improvise another. `old` must match exactly once in the file, and a stale anchor stops the run rather than being skipped.
4. **Prove it with `bun run test:defects`** (P25). The checker requires a passing baseline, applies each mutation in a disposable copy, requires the named test to fail at an assertion, and re-verifies the restored baseline. Read its exit code and the detected count; a setup or compile failure is not a detection.
5. **Diagnose a survivor** before touching anything (C65): a vacuous test is rewritten; a mutation no test could observe is replaced by one that is observable.
6. **A spec-derived test that fails against existing code is a bug finding.** Report it; never bend the test until it agrees.

**A type-level guard** ships with a `@ts-expect-error` fixture checked by `tsc` (C92).

**What a detection does not prove:**

- **A later edit can retire the proof.** A refactor that moves or rewrites the anchored shape invalidates the record, even with every test green. Re-anchor and re-prove after any refactor that moves it, and order the proof after a review's fix round, never before.
- **A detection proves the test observes a shape, not that a real caller reaches it.** For a guard keyed on an absent argument or a flag combination, read the callers that build the input (C94).
- **A green run says nothing about what a test's comment claims.** Verify every library behavior you write down against the installed source.
- **A test locking an exported object's key set has no import edge to the change that must move it.** Search for key-set assertions whenever you add a field, and prove such a lock by mutating its subject, never the test.
- **An approved deviation needs a test that fails when someone "fixes" it.** Seed the value the two spellings disagree on.
- **The author of a test is its worst reader.** Only a mutation separates a passing test from a proving one, and a review by someone who did not write the case is the stronger form of the gate.

**One proof per commit.** A commit is a claim, so its named-defect evidence runs against that commit's tree, and the count it records names the tree and window it measured.

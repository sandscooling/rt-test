# Ticket 3.2b: Probe sites for removed, added and replaced code

## Ticket

As the daemon, which falsifies a consumer's named defects in place of its coding agents,
I want each mutation's reach probe placed only where its firing means the changed code ran, for removed, added and replaced code alike,
so that no test is credited with reaching a change it never ran, and nearly every mutation an author writes gets a probe site.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

AC1 to AC8 are each observable through `mutateWithProbe` (`packages/daemon/src/falsify/reach-probe.ts`) on source text a test gives, with no Vitest instance, and each holds for text with LF and with CRLF line endings. "Probed around X" means the probe fires when X starts to be evaluated and at no other time.

- [ ] AC1: A probe fires only on an execution that reaches the changed code. Where a mutation writes code, the probe stands on the smallest construct holding the written code, or on a construct that always goes on to run that code once it starts, barring a throw inside that construct. Where a mutation only removes code, the probe's place is judged by the unmutated text: it stands where the construct that held the removed code now stands, and only when that construct, once it started, always went on to run the removed code. A probe never stands where the change is reached only through a conditional or later-run step: the right operand of `&&`, `||` or `??`; the right side of `&&=`, `||=` or `??=`; a branch of `?:` or of an `if`; a loop's body, a `for`'s update or a `do...while`'s test; a `case`; a `catch`; a function's body, parameters or default values; a class member; a link to the right of an optional chain's first `?.`. The inputs that pin it: `a && !ok` to `a && ok` is probed around `ok`; `c && a + b` to `c && a` is probed around `a`; `c ? a : !b` to `c ? a : b` is probed around `b`; `xs.map((x) => x + 1)` to `xs.map((x) => x)` is probed around the arrow's body `x`, never around the call; `a` to `a || b` is probed around `b`; `a?.run(b)` to `a?.run(b, 1)` is probed around the added `1`, never around the whole chain; `a?.b` to `x?.b` is probed around `x`; and `a?.b` to `a?.c` has no probe site. (FR11, ADR-0008)
- [ ] AC2: A mutation that drops the right operand of `&&`, `||` or `??` (`a && b` to `a`, at any place an expression stands) gets a probe that fires on exactly the evaluations where the dropped operand would have been evaluated: the kept operand truthy for `&&`, falsy for `||`, and null or undefined for `??`. The kept operand is still evaluated once, where it stands, its value reaches the surrounding code unchanged, and an `await` or a `yield` in it still belongs to the enclosing function. Where the kept operand stands in a position in which such a probe cannot keep the code's meaning (a callee that needs its `this`, an assignment or `delete` target, a `typeof` operand, a link of an optional chain), the mutation has no probe site. (FR11)
- [ ] AC3: A mutation that removes or adds whole statements in a statement list (a program, a block, the statements of a `case`, a static block, a namespace body) is probed by a probe statement at that place in the list: before the first added statement, or where the removed statements stood, the end of the list included. So a deleted guard (`if (!ok) return 0;` before `return 1;`) is probed where the guard stood, inside its function, and a deleted `break;` is probed where the `break` stood, inside its `case`, never before the `switch`. It holds when the removed text repeats the text beside it (removing a `requireScope(scope);` statement that stands before a `return` statement, which share their first two letters), where a character diff cannot say where the removed text began. A mutation that replaces statements of a list, or changes several of them, is probed for the first replaced statement and its replacement alone, as if that pair were the whole mutation: by a probe statement before the replacement when it is another kind of statement (`throw new Error("bad");` to `return 0;`), and inside it, by AC1, when it is the same kind of statement edited in place (`foo(1);` to `bar(2);` is probed around the call). A test that runs only a later changed statement then reads not executed. A removed or added statement that does not run where it stands (an import, a type, a directive, a removed function declaration) has no probe site. (FR11)
- [ ] AC4: A change in a part that its enclosing expression or statement always evaluates once it starts is probed at the nearest enclosing construct that takes a probe: a callee or a property name through its call or member access (`obj.run()` to `alt.go()` is probed around the call); template text through its template literal, tagged or not; an object literal's property, key or shorthand through the object literal; a declarator, its name or its pattern through its declaration statement; an assignment or update target through the assignment; a `typeof` or `delete` operand through that operation; a spread element through its array or call; a removed argument, element or property through its call, array or object literal; an added or removed `finally` through its `try` statement, probed before the `try`. No step on the way crosses a conditional or later-run step (AC1). (FR11)
- [ ] AC5: A function whose parameters, outside their default values, or whole text changed (an arrow function, a function expression, a function declaration, a method), and an added function declaration, is probed at the head of its body, so the probe fires when the function's body starts (at the call, or at a generator's first `next()`) and never where it is defined: as the first statement of a block body, after its directives, or around an expression body. So `const f = (a, b) => a + b;` to `const f = (a) => a;` is probed around the body `a`. A statement that stands alone as a branch or as a loop's body (`if (x) continue;` to `if (x) return y;`) is probed inside that branch, with the branch still running the one statement. A block that replaced such a statement or a body whole is probed first in its list. (FR11)
- [ ] AC6: A mutation whose change stands at or under an argument of a call whose callee is rooted at `import.meta` yields no probe of any form inside that call's arguments: a change to `import.meta.glob("./handlers/*.ts")`'s argument, or to one element of an array passed there, is probed around the whole call, or has no probe site. (FR11)
- [ ] AC7: Every position AC1 to AC6 give no site stays refused, returned by `mutateWithProbe` as `no-probe-site` (which the job's start check reads before any run, unchanged), and its record names the smallest changed node by line and column in the file's own text, its kind and its role, never quoting source; removed code is named where it stood, and a mutation that changes no code is named by the smallest node holding the first character it changes. A probe site is reported where the probe stands in the file's own text, or where the change starts when the probe stands inside written text. The refused classes, beside any other position the placement's allowlists do not admit (each one the build meets is named under AC9): a file that does not parse before or after the mutation; a mutation that changes only white space or comments; a type or an ambient declaration; an import, a re-export or a directive; a removed function declaration; the name alone of a function declaration, a function expression or a class's method; removed code its construct ran only conditionally or later, other than AC2's dropped operand (a removed `else`, `case`, `catch` or default value); a whole `case` or `catch` added; a `catch` clause's own parameter; a class's member list; the left side of `for...of` or `for...in`; a change to the right of an optional chain's first `?.` on a node that takes no wrap itself; JSX text, attributes and element names; and a dropped operand whose kept operand takes no probe (AC2). `mutateWithProbe` keeps its parameters, and `ProbedMutation`, `ProbeSite` and `NoProbeSite` keep their fields, so the experiment record's shape does not change. (FR11)
- [ ] AC8: Every probe this ticket adds keeps what ticket 3.2 guarantees of a probe: it never changes what the module does apart from recording reach, it never throws, it adds no line break, and a probed text the parser rejects is refused rather than served. A change under a TypeScript `as`, `satisfies`, `!`, `<T>` or instantiation wrapper is still probed in the position the wrapper holds; code inside an ambient declaration still takes no probe; and a probe that opens a statement after a line with no semicolon is still not read as a call of that line's value. (FR11)
- [ ] AC9: Measured over this repository's own catalog by the method under Dev Notes § Measuring coverage, at the build's commit: placement refuses at most 2% of the cataloged mutations, a target until measured (it refused 896 of 3,057, 29.3%, at `e6243dcb`); every refused mutation falls in a class AC7 names, and one that does not is reported to the orchestrator before the ticket is handed on; and no cataloged mutation is probed on a construct that reaches the change only through a conditional or later-run step (the scratch classifier estimated 186 of the 2,161 probed at `e6243dcb`). A measured share above 2% does not fail the build by itself: the build reports the refused groups to the orchestrator before the ticket is handed on, and the orchestrator rules whether a position is widened or the figure stands. The measured counts, by kind of refused position, are written in Completion Notes, and the architecture text the build reports names the refused kinds. (FR11)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                   | Why it matters if wrong                                                                                                                                                                                                                     | How to check                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Does Vite 6, which Vitest 4.1 and 5 also accept, read only the text of an `import.meta.glob(...)` call itself, from `import.meta.glob(` to its closing parenthesis, as Vite 8.3.1 and 7.3.1 do (read below)? | Informational: AC6 holds on any Vite, since it puts no probe inside the arguments. Were Vite 6 to read more than the call's own text, a probe around the call could fail the load there, which is an invalid experiment, never a detection. | Read `parseImportGlob` in a Vite 6 install's `dist/node/chunks/`. Vite 6 is not installed on this machine and is not in the bun cache, so record it unresolved if that is still so. |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing, writing each answer with its source location under the table.
- [ ] (AC1, AC3, AC7) Create the pairing of the two parses (Dev Notes § How the site is chosen, steps 1 to 3): parse the unmutated text and the mutated text through `parseGuarded`, compare nodes by structure, and walk both trees from their roots while exactly one child differs, ending at the changed pair and the shape of its difference (a run in a list, several members of a list of unchanged length, a child on one side only, or the nodes themselves). Write the walk and the comparison as loops over an explicit stack, so no input's depth can overflow the call stack and neither needs a ceiling that throws: `parseGuarded` bounds bracket depth only, a long `a + b + c` chain nests as deep as it is long, and a throw out of `mutateWithProbe` would fail the job's planning in `startCheck`, which is ticket 3.3's file. A text that does not parse on either side, and a pair that does not differ, each give the refusal AC7 names.
- [ ] (AC1, AC4, AC6) Replace the choice of the probed node in `mutateWithProbe` with the changed pair, and extend the position rules in `probe-slots.ts`: one table of the child roles a parent always runs once it starts (Dev Notes § The always-run roles), read by the step from a part to its enclosing construct (AC4), by the removed-code check (AC1) and by the added-code check (AC1, ruling Q2: when the unmutated node is a child of the mutated node, a child was added and every added child is off the table, the first added child takes the site, so `a` to `a || b` is probed around `b`; otherwise the mutated node does); no step crosses a role that is not on it. Probe an optional chain whole only when the changed node is the chain or any part of the change stands left of its first `?.`, and wrap an added argument or a computed key to the right of it. Send every node at or under an argument of a call rooted at `import.meta` to the call, whichever probe form it would take, or refuse it (AC6).
- [ ] (AC1, AC2) Place the probe for code that was only removed by the unmutated node of the pair: at the mutated node when no child was removed, when a removed child is on the always-run table, or when both branches of a conditional were removed; by AC2's probe when only the right operand of `&&`, `||` or `??` was removed and the kept operand's position takes a wrap; otherwise refuse. Build AC2's probe as an expression that evaluates the kept operand once, in place, fires only when the dropped operand would have been evaluated, and yields the operand's value (Dev Notes § The dropped-operand probe).
- [ ] (AC3) For a statement list whose run only removes statements, or only adds them, place a probe statement at the head of the run, in the mutated list and after its directive prologue, when every removed or added statement runs where it stands; send one added function declaration to the function rule; refuse the rest. For a run that both removes and adds statements, and for a list of unchanged length with several changed members, place the first removed statement and the first added one alone, as a pair: go on walking inside the pair when the two are one kind of statement, and place the added statement by the position rules when they are not.
- [ ] (AC5) Probe a function at the head of its body when the changed node is the function, its body's kind, or anything under its parameters, outside a default value, that takes no wrap itself. Probe a statement that stands alone as a branch or a loop's body by making it a block that starts with the probe, and a block that is not a list member first in its own list.
- [ ] (AC7) Report every refusal as the smallest changed node (the first node tried, never the last one a step reached), by its line and column in the file's own text, its kind and its role, with removed code named where it stood in the unmutated text, and each case under Dev Notes § Reporting named as that section says; report a site as where the probe stands in the file's own text, or where the change starts when the probed node begins inside written text. Keep `mutateWithProbe`'s parameters and the fields of `ProbedMutation`, `ProbeSite` and `NoProbeSite`.
- [ ] (AC8) Keep the re-parse of every probed text, the TypeScript wrapper rule, the ambient rule and the statement-opening guard, and apply the re-parse, the statement-opening guard and the no-line-break rule to each new probe form, on CRLF text as on LF: the dropped-operand probe opens with `(`, so where it opens a statement after a line with no semicolon the re-parse alone accepts it as a call of the line above.
- [ ] (AC9) Run the measurement (Dev Notes § Measuring coverage) at the build's commit. Write the counts, by kind of refused position, in Completion Notes; check each refused record against AC7's classes and report any outside them to the orchestrator, and report the refused groups too when the share is above 2%, before handing the ticket on; rerun `classify.ts` and report each record it still lists as probed above a conditional step, with the reason it is sound or the fix.
- [ ] (Support) Report to the orchestrator the `docs/architecture.md` § Falsification jobs text and the ADR-0008 text (Dev Notes § Doc text) as built, naming each drafted sentence the build made untrue and the refused kinds the measurement found, since those files are the orchestrator's; write none of it yourself.
- [ ] (Support) Sweep the prose the change falsifies (C48), found by `git grep` of the retired vocabulary ("smallest syntax node enclosing", "smallest node enclosing", `changedSpan`, `enclosingPath`, `probedPath`) and, at least: the header comment of `probe-slots.ts`, the comment on `NEVER_WRAPPED`, the docblock on `NoProbeSite`'s `position` arm and the docblock of `mutateWithProbe`. Delete `changedSpan`, `enclosingPath`, `encloses` and `probedPath` with their comments where the pairing leaves them no caller (C57), keeping only what reports where the change starts, and name in Completion Notes any that survive and why. List under the Dev Handoff each test title that now states the old rule (Dev Notes § Tests this change breaks).
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `parseGuarded`, `parserOptions`, `GuardedParse` (`packages/daemon/src/selection/source-imports.ts`): the parser the dependency build uses, with its bracket-depth guard and the failure arm's `offset` and `nesting`. Parse both texts through it; its `ok` arm carries `program`, read inside the guard.
- `replaceAnchor` and its `AnchorReplacement` (`packages/daemon/src/falsify/anchor-match.ts`): the mutated text, the match and `replacementEnd`. Unchanged by this ticket.
- `placementAt`, `roleOf`, `isSyntaxNode`, `PLACEMENT`, `CHAIN` and the types `SyntaxNode`, `PathStep`, `Slot`, `Placement` (`packages/daemon/src/falsify/probe-slots.ts`), with its module-private tables `EXPRESSION_SLOTS`, `STATEMENT_LISTS`, `NOT_RUN_IN_PLACE`, `NEVER_WRAPPED`, `TS_VALUE_WRAPPERS`, `VALUE_BLIND_UNARY` and the chain check `notChainContinuation`: today's wrap and statement positions, which stay the base of the position rules.
- `withProbe`, `opensStatement`, `positionOf`, `parses`, `STATEMENT_OPENER` and `PROBE_STATEMENT` (module-private in `packages/daemon/src/falsify/reach-probe.ts`): how a wrap and a probe statement are written, the statement-opening guard, the line and column of an offset, and the re-parse of a probed text.
- `REACH_PROBE_CALL` (`packages/daemon/src/falsify/reach-names.ts`): the one spelling of the probe's call. Every probe form calls it, so the reach setup file and the fixture config that finds a probed module by that text need no change.

### Must Create

- The pairing of the unmutated and the mutated parse (the changed pair and the shape of its difference), in a module of its own under `packages/daemon/src/falsify/`, with no Vitest or executor dependency.
- The placements this ticket adds (a probe statement at a point of a list, a function's body head, a lone statement made a block, the dropped-operand probe), in a module of its own under the same folder, so `reach-probe.ts` and `probe-slots.ts` stay under the file size limit (P16).
- The table of always-run roles, in `probe-slots.ts` beside the tables it extends.

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### What the criteria rest on

FR11: "Decide each falsification verdict from run facts (failure phase, error kind, whether the mutated site executed during the intended test, the baseline result), counting as a detection only an assertion failure in the intended test after the mutated site executed, repeated in a confirming run." A probe that fires without the change running makes "the mutated site executed" true for a test that never ran it.

ADR-0008, as it stands: "The transform parses the mutated module with the parser the dependency build uses and places a call to a recorder at the smallest syntax node enclosing the changed text, only where the call firing means the changed code began executing: around an expression whose meaning a comma expression keeps, or before a statement in a statement list." And: "Where no probe can be placed, because the change sits in a callee, an assignment target, a type or any other position the call would alter, or the mutated module does not parse, the experiment is decided before any run: it does not run, and its record names the position." Its known limits say: "A mutation that only removes text can be probed at an ancestor that runs without the changed code, so a test that never ran the change can read as having reached it." This ticket removes that limit and changes the placement rule; the amended text is under § Doc text, and the orchestrator writes it.

The owner's rulings this ticket builds, as the orchestrator relayed them in the dispatch (2026-09-30):

- Soundness, 20:48: "as built, a mutation that only removes text can be probed at an ancestor that runs without the changed code [...]. A deletion's probe must go only where its firing means execution reached the point the deleted text stood. The reviewer notes the mutated text alone may not say which level the deleted text hung on, so a sound rule probably needs the unmutated text too."
- Coverage, 20:42: "Widen to B1 (a removed or added whole statement in a statement list gets the probe at that point in the list) and to each B2 position you can ARGUE SOUND, meaning the probe fires only when the changed code begins executing (a callee or property name through its parent expression, a replaced function through its body, a declarator through its statement, template text, an object property); leave refused every position you cannot argue. The acceptance carries a measured coverage figure over this repository's catalog, by the review's method."
- 03:25: "No edge cases: a limit no realistic consumer reaches is a recorded known limit, unless it could report a stale result as current or credit a detection falsely; a probe that can fire without the changed code running IS that class."

Ticket 3.2's AC5, which AC8 keeps: "A probe never changes what the module does apart from recording reach, and never throws."

#### Rulings during authoring

Asked of the orchestrator at 22:14 on 2026-09-30; decided by the orchestrator at 22:16.

- Q1, a dropped right operand of `&&`, `||` or `??` (118 cataloged mutations, 117 of them probed today above the operand). Ruling: the exact probe. "The kept operand passed once through an inline arrow that fires only when the dropped operand would have been evaluated, and returns the value unchanged, for &&, || and ??. Conditions: the kept operand is still evaluated once and in place, `await` and `yield` in it stay in the enclosing function, and any position where that form cannot keep the code's meaning (a callee that needs its `this`, an assignment or delete target, and the like) is refused, never approximated." Probing where the kept operand stands is the unsound class, and refusing would stop 118 mutations that run today.
- Q2, additions. Ruling: "the soundness criterion covers every mutation, additions included; an added operand is wrapped itself, and a chain is probed whole only when changed text stands left of its first `?.`."
- Q3, what "began executing" tolerates. Ruling: "a probe may stand on the smallest construct that always runs the change once it starts, barring a throw inside that construct; never across a conditional or later-run step", to be said in the ADR.
- Q4, positions beyond the ones the owner named. Ruling, accepted as listed. Included: a statement standing alone as a branch or a loop's body; a function whose body or parameters changed, and an added function declaration, through the head of its body. Left refused, each a recorded limit: a removed `else` (an empty `else {}` is the mutation its author can write instead), a removed `case`, a `catch` whose parameter changed, a function's or a method's name alone, a change to the right of `?.` that takes no wrap itself, imports, class member lists, and JSX text and attributes (none in this repository's catalog; the Fleet Cooling trial will measure them).
- Q5, the figure in the acceptance. Ruling: at most 2% refused as a target until measured, every refused mutation in a class the ticket names, the measured counts by kind in the ticket, replacing "about three in ten" in the architecture text.
- Q6, `import.meta.glob`. Ruling: the class is "a call whose callee is rooted at import.meta: its arguments are probed through the call, never inside it."

Asked of the orchestrator at 22:29, from the grill; decided by the orchestrator at 22:30.

- G1, a mutation that changes several statements of one list without adding or removing any (21 cataloged). Ruling: it "is probed for the first changed statement alone", with the ADR's known limit worded as under § Doc text. One probe statement before the first changed statement is the unsound class.
- G2, a whole `case` added (none cataloged). Ruling: refused, recorded with the removed one.
- G3, a `finally` block. Ruling: "an added or removed `finally` is probed before its `try`; an added or removed `catch` stays refused."
- G4, the glossary. Ruling: the orchestrator writes the entry "Probe site" with the authoring commit (text under § Glossary terms).

Decided by this session, and left standing by the orchestrator at 22:30: a file that does not parse before the mutation while it parses after is refused as unparsed, naming its own first error; and a probe that starts inside written text reports the line and column where the change starts.

Decided by this session while applying the ticket's review (22:48 to 22:55), each under a ruling above and reported to the orchestrator with the ticket:

- A run that both removes and adds statements is placed like G1's case, for its first pair alone. One probe statement before an edited statement of such a run is the probe G1 ruled unsound.
- One node with several changed children that all run conditionally (a `for`'s update and its body) is placed for the first of them alone, by G1's reasoning; a node that stands deeper than a child under the other must pass the removed-code or added-code check at every step, else it is refused.
- A `do...while`'s test is off the always-run table, and a default value is never stepped through to its function: each can be skipped with no throw, which Q3's tolerance does not cover.
- A measured share above 2% is reported to the orchestrator, who rules; the target does not fail the build by itself (Q5 calls it a target until measured).
- The walk and the comparison are loops with no depth ceiling, so `mutateWithProbe` cannot throw into `startCheck`, ticket 3.3's file.

Scope change from the orchestrator at 22:02: this ticket does not raise `FALSIFIER_VERSION` and does not touch `packages/daemon/src/falsify/experiment-record.ts`. Ticket 3.3 owns that file and raises the version once for both tickets; no evidence is stored before ticket 3.5, which both land before.

#### Measured on main (2026-09-30, `e6243dcb`, Windows 11, bun 1.3.14)

Ticket 3.2's review measured 874 refused of 2,966 at `6905c658` (its Review Record owns that figure). The same script at `e6243dcb`, where the catalog has grown:

```sh
bun _agent-docs/.scratch/3-2b/measure.ts
```

printed `catalogs: 19, records with a source file: 3057`, `mutated: 2161`, `no-probe-site:position: 896`.

A scratch classifier written for this ticket pairs the two parses by structure and predicts each record's site under the rule below:

```sh
bun _agent-docs/.scratch/3-2b/classify.ts
```

printed `probed on main: 2161; predicted probed: 3033; predicted refused: 24`. Its section "main's site can fire without the change running" totals 186: a dropped right operand, 117; an added or replaced right operand wrapped at the whole expression, 53; and 16 of the review's kind (removed code inside a right operand, a conditional's branch, an `else if`, an arrow's body or a loop's body). With `--strict-operands`, which refuses a dropped operand, it printed `predicted probed: 2915; predicted refused: 142`. The classifier is an estimate, not the product: it trims white space by text, so it reads D3578 (a space added inside a string) as changing no code, and it reads two removed `else` branches (D1659, D2709) as a block. Its largest predicted groups of newly probed mutations: statements removed from a block, 392; a removed part probed where its construct now stands, 92; a part probed through its enclosing construct, 125; statements replaced or added in a block, 109; a function through its body, 47; a lone statement, 23.

Its section "shapes the walk stopped at" printed: a statement list of unchanged length with several members changed, 21; cases removed, 2, and none added; an `else` removed, 2, and added, 2; a `finally` added, 1, and none removed.

What the samples showed, each by `bun _agent-docs/.scratch/3-2b/show.ts <ids>`:

- D1853 (the second operand of an `&&` dropped from an `if`'s test): main puts the probe before the `if`.
- D1728 (a call added as the right operand of `||` in a conditional's test): main wraps the whole `||` expression.
- D1248 (a `requireScope(scope);` statement removed before a `return` statement): the old and new texts share `re`, so the character diff's deletion point lands inside the `return`, and main probes the `return` statement. A site that depends on which characters repeat is why the two parses are compared by structure.
- D2781 (a removed `case "exited":` before `case "lost":`): main wraps the next case's test, which is sound by chance; under AC7 a removed `case` is refused.

The facts the design rests on, each printed by `bun _agent-docs/.scratch/3-2b/facts.ts`:

- `oxc-parser` 0.151.0 gave the two texts `facts.ts` parsed, which differ only in white space and comments, the same nodes but for `start` and `end` (`same shape across white space and comments: true`), and a space added inside a string a different node (`a space inside a string is a different shape: true`). Read in the installed types (`@oxc-project/types` 0.151.0, `types.d.ts`): every node's position comes from `Span`, which holds `start`, `end` and an optional `range` that the parser adds only under its `range` option (`oxc-parser` `src-js/index.d.ts`), which `parserOptions` does not set; the file's only other `number` field is a numeric literal's `value`. So a comparison of every field but `start`, `end` and `range` needs no trimming of white space or comments. A position field read as a difference would stop the walk at an ancestor and put the probe above the change, so create-tests pins this (P10).
- The inline arrow keeps the value and fires only when the dropped operand would have run: for `&&` it fired on a truthy operand and not on `0`; for `||` on `""` and not on a truthy one; for `??` on `null` and not on `0`; the operand was evaluated once in each; and with `await` and with `yield` in the operand the enclosing async function and generator returned the awaited and the sent value.

Read in installed Vite 8.3.1 (`dist/node/chunks/node.js`, `parseImportGlob`): it finds `import.meta.glob(` by the pattern `importGlobRE`, slices the code from there to the matching closing parenthesis, parses that slice alone, and throws "Could only use literals" for an argument that is not a string literal, a template with no expression, or an array of those. A probe inside the arguments therefore fails the load, and a probe around the call is outside the slice. Vite 7.3.1 in the bun cache (`dist/node/chunks/config.js`) holds the same pattern, the same slice to the closing parenthesis and the same error.

#### How the site is chosen (mechanism; the criteria above are what binds)

Scope of this analysis: JavaScript and TypeScript as the dependency build's parser reads them, one mutation at a time. JSX text, attributes and element names are left refused and unanalyzed; an expression inside a JSX expression container is an ordinary expression position, which `EXPRESSION_SLOTS` already wraps (`JSXExpressionContainer.expression`), and every rule below applies there.

1. Parse the mutated text, as today, and the unmutated text, which `mutateWithProbe` already receives at both of its call sites (the job's start check and the transform). A mutated text that does not parse is refused as today. An unmutated text that does not parse while the mutated one does is refused the same way, naming its own first error.
2. Compare nodes by structure: two nodes are the same when their kind and every field but `start`, `end` and `range` are the same, all the way down. White space and comments then never count as a change, and no span of changed characters decides a site.
3. Walk both trees from their roots. While the two nodes have the same kind and the same own fields, and exactly one child differs (one single child, or one member of a list of unchanged length), step into that pair of children. Where the walk stops is the changed pair, and it stops in one of these ways: a list differs by a run of members, or by several members; a child stands on one side only; nothing differs (no code changed, refused); or the two nodes themselves differ.
4. The site, by how the walk stopped:
   - A statement list whose run only removes statements, or only adds them: a probe statement at the head of the run in the mutated list, when every removed or added statement runs where it stands. One added function declaration goes to the function rule. Anything else is refused.
   - A statement list whose run both removes and adds statements, and a list of unchanged length with several changed members: the site of the first removed statement and the first added one, taken alone as a pair, and no site when that pair has none (ruling G1, which the review's finding on a run of changed length extends by its own reasoning). The walk goes on inside the pair when the two are one kind of statement, and the position rules place the added statement when they are not, which is a probe statement before it. A test that runs only a later changed statement then reads not executed, which makes the experiment invalid and never a detection. One probe statement before an edited statement would be unsound: that statement's change can sit in a branch that is skipped, and a `return` after it can skip the later change.
   - Another list whose members its owner always evaluates (arguments, elements, an object literal's properties, a template's parts, declarators): the first added member when one was added and it takes a wrap; otherwise the owner, by the position rules.
   - A function's parameters: the function rule. A `switch`'s cases, a class's members and any list no bullet above names: refused.
   - A child on one side only: on an always-run role (a `return`'s argument, a declarator's initializer, a `for`'s initializer), the owner by the position rules. On any other role, an added child takes the site itself by the position rules (an added `else`), and a removed one is refused.
   - The mutated node is one of the unmutated node's children (`a && b` to `a`, `!ok` to `ok`, `if (c) return x;` to `return x;`): the mutated node by the position rules when no other child was removed (only an operator or a keyword went), when a removed child is on the always-run table, or when both branches of a conditional were removed. When only the right operand of `&&`, `||` or `??` was removed: the dropped-operand probe. Otherwise refused.
   - The unmutated node is one of the mutated node's children (`a` to `a || b`, `x` to `() => x`): when a child was added and every added child is off the always-run table, the first added child by the position rules; otherwise (an added child is on the table, or none was added, as in `x` to `() => x`) the mutated node.
   - One node stands deeper than a child under the other (`a && b && c` to `a`, or back): the removed-code check, or the added-code check, of the two bullets above must hold at every step between them; otherwise refused. This refuses some sound shapes (`a && b || c` to `a`, where one dropped operand always runs), which is the safe side.
   - The two nodes have one kind and the same own fields, and several children differ: the mutated node when a differing child is on the always-run table, or when the differing children are both branches of one conditional or `if`; otherwise the site of the first differing child taken alone, as G1 rules for a list (`for (; c; i++) s += i;` with its update and its body both changed is placed for the update alone, never before the `for`).
   - Otherwise (the nodes differ in kind or in an own field, such as an operator): the mutated node, by the position rules.
5. The position rules for a node, the first that applies:
   1. It is inside an ambient declaration, or it is a type: refused.
   2. It is a function: the head of its body. The name alone of a function declaration, a function expression or a class's method is refused.
   3. It is a member of a statement list: a probe statement before it when it runs where it stands; a function declaration goes to rule 2; otherwise refused.
   4. It is a block that is not a list member (a branch, a loop's body, a `try`, `catch` or `finally` block, a function's body): a probe statement first in its list.
   5. It is a statement standing alone as a branch or a loop's body: it becomes a block that starts with the probe.
   6. It takes a wrap by today's rules, with these changes. To the right of an optional chain's first `?.`, only a node that is itself an argument or a computed key is wrapped, and the chain is wrapped whole only when the node is the chain or any part of the change stands left of that `?.`. A node at or under an argument of a call whose callee is rooted at `import.meta` takes no probe of any form; the call takes its place.
   7. Its role is on the always-run table, or it stands under a function's parameters and outside every default value (`AssignmentPattern.right`): its parent takes its place, from rule 1.
   8. Refused, naming the node the rules started from.

Hazards the scenario walk found, each for the build to hold: a probe statement placed at the end of a list, or after a statement written with no semicolon, must not be read as part of the statement before it, and it adds no line break (AC8), so write it so the text parses and let the re-parse refuse the rest; a block's probe goes after its directive prologue, since a statement before a directive turns the directive into a plain string; a lone statement made a block keeps a dangling `else` bound as it was, because the block spans the whole statement; and an expression body that is an object literal is wrapped inside its own parentheses, which are not part of the node's span.

Why each placement is sound, in one line each. A probe statement at a point of a list runs exactly when execution reaches that point, and nothing enters a list in its middle. A function's body head runs when the function's body starts: at the call for a plain or an async function, and at the first `next()` for a generator, whose parameters were bound at the call; a parameter that throws while binding ends the call before the body. In both cases a changed parameter can run with the probe unfired, which reads as not executed and never as a detection; a wrap at the function's definition would fire when it is defined. A lone statement made a block runs the probe exactly when that branch is taken. A part on the always-run table is evaluated on every evaluation of its parent, so the parent starting means the part runs, barring a throw in the parent's earlier parts, which is the tolerance ADR-0008's wrap already has (`a + b` to `a - b` fires before `a` is evaluated). A removed part is judged the same way in the unmutated tree, since the mutated tree no longer holds it.

#### The always-run roles

A child role belongs on the table only when its parent evaluates it on every evaluation of the parent. The table is an allowlist, as `EXPRESSION_SLOTS` is today: a role that is not on it is treated as conditional, so a missing entry refuses a mutation and never probes one above its change. The starting set, each `Parent.field`:

- `BinaryExpression.left`, `BinaryExpression.right`, `LogicalExpression.left`, `ConditionalExpression.test`, `SequenceExpression.expressions`.
- `CallExpression.callee`, `CallExpression.arguments`, `NewExpression.callee`, `NewExpression.arguments`, `MemberExpression.object`, `MemberExpression.property`, `TaggedTemplateExpression.tag`, `TaggedTemplateExpression.quasi`, `TemplateLiteral.quasis`, `TemplateLiteral.expressions`.
- `ObjectExpression.properties`, `Property.key`, `Property.value`, `ArrayExpression.elements`, `SpreadElement.argument`.
- `UnaryExpression.argument`, `UpdateExpression.argument`, `AwaitExpression.argument`, `YieldExpression.argument`, `AssignmentExpression.left`, and `AssignmentExpression.right` except under `&&=`, `||=` and `??=`.
- `VariableDeclaration.declarations`, `VariableDeclarator.id`, `VariableDeclarator.init`, and the patterns under a declarator or an assignment target: `ObjectPattern.properties`, `ArrayPattern.elements`, `RestElement.argument`, `AssignmentPattern.left`.
- `IfStatement.test`, `SwitchStatement.discriminant`, `WhileStatement.test`, `DoWhileStatement.body`, `ForStatement.init`, `ForStatement.test`, `ForInStatement.right`, `ForOfStatement.right`, `ReturnStatement.argument`, `ThrowStatement.argument`, `ExpressionStatement.expression`, `TryStatement.block`, `TryStatement.finalizer`, `CatchClause.body`, `ExportNamedDeclaration.declaration`, `ExportDefaultDeclaration.declaration`.
- The operand of a TypeScript value wrapper, and `ChainExpression.expression` under rule 6's limit. Inside an optional chain a property, a callee and an argument run only when every `?.` to their left passes, so every step there stays below that limit.

Not on it, as examples: `LogicalExpression.right`, a conditional's and an `if`'s branches, a loop's body, a `do...while`'s test (a `break` or a `return` in its body skips it with no throw) and a `for`'s update, the left side of `for...of` and `for...in`, `SwitchStatement.cases`, `TryStatement.handler`, a function's body and parameters, `AssignmentPattern.right`, a class's members and a field's initializer. A member of a statement list is never stepped through to its list's owner: the list rule places it.

#### The dropped-operand probe

The form the orchestrator ruled (Q1), written with the existing probe call: the kept operand becomes the argument of an inline arrow function that tests its value, calls the probe on the outcome that would have evaluated the dropped operand, and returns the value. For `a && b` to `a`: `((v) => (v && PROBE, v))(a)`, with `||` and `??` in place of `&&` for the other two, where `PROBE` is `REACH_PROBE_CALL`. The operand is evaluated as the call's argument, so it runs once, in the enclosing function, before the arrow. It is placed only where the kept operand's position takes a wrap by rule 6, inside parentheses of its own as the comma wrap is, and behind the statement-opening guard where it opens a statement; elsewhere the mutation is refused. This analysis covers the three logical operators; `&&=`, `||=` and `??=` are unanalyzed and stay refused when their right side is dropped.

#### Reporting, with the record's shape unchanged

`NoProbeSite` keeps `position` (`line`, `column`, `nodeKind`, `role`) and `unparsed`; `ProbeSite` keeps `line`, `column` and `nodeKind`. A refusal names the node the rules started from: for removed code, the removed node and its role in the unmutated tree (a removed `else` reads as its statement's kind with role `IfStatement.alternate`), at the line and column where it stood. "Where the change starts" is the first character at which the mutated text differs from the file's text, which is the one thing kept of `changedSpan`: it reports a position and decides no site.

- A refused mutation that changes no code (white space or comments only) names the smallest unmutated node holding the character where the change starts, with that node's role.
- A refused run of statements names the first statement of the run that does not run where it stands: where it stood when it was removed, and where the change starts when it was added.
- Any other refused node that was added (a whole `case`, an added `catch`) names its kind and role at the place the change starts.
- A site names where the probe stands. Today every probed node starts at or before the change, so its offset is the same in both texts. A site that starts inside written text (an added operand, an added function's body) has no place in the file's own text, so it reports where the change starts. A site that starts after the written text (a function's body head when only its parameters changed) reports where that body stands in the unmutated node of the pair.

`positionOf` reads the unmutated text, as today, and is never handed an offset of the mutated text past the start of the change.

#### Current structure of the modified files

- `packages/daemon/src/falsify/reach-probe.ts`: `mutateWithProbe(fileName, text, old, replacement)` calls `replaceAnchor`, parses the mutated text, computes `changedSpan` (the written text less the prefix and suffix it shares with the replaced text), finds `enclosingPath` (the deepest node enclosing the span, where `encloses` takes an empty span only strictly inside a node), lifts a chain's body to the chain in `probedPath`, asks `placementAt` for the slot, writes the probe in `withProbe`, and refuses when no placement exists or the probed text does not parse (`parses`). It returns `mutated` with `text` and `site`, `anchor-count`, or `no-probe-site`.
- `packages/daemon/src/falsify/probe-slots.ts`: `placementAt(slot)` refuses a path through an ambient node, returns `statement` for a member of `STATEMENT_LISTS` that `runsWhereItStands`, and otherwise `expression` when the node's kind is wrappable (`NEVER_WRAPPED`, the `Declaration` suffix, the `TS` prefix but for `TS_VALUE_WRAPPERS`) and the role of its outermost TypeScript wrapper is in `EXPRESSION_SLOTS` and passes that entry's check.
- Callers of `mutateWithProbe`, from `git grep -n "mutateWithProbe" -- "packages/*/src"`: `startCheck` in `falsify-workspace.ts` and `#transformInput` in `mutation-transform.ts`. Both pass the unmutated text and read only `status`, `text`, `site`, `count` and `reason`, so neither changes.

#### Tests this change breaks

For create-tests. The search `git grep -l -e "mutateWithProbe" -e "no-probe-site" -e "__rtTestReach" -e "nodeKind" -- packages test`, less the files under `src/`, named `packages/daemon/test/falsify/reach-probe.test.ts`, `packages/daemon/test/falsify/falsify-workspace.test.ts`, `packages/daemon/test/falsify/defects.json` and `test/fixtures/daemon/falsify/vitest.config.mjs` (22:48). `reach-probe.test.ts` holds tests whose expectation states the old rule:

- D3612 (a callee has no probe site): the call is now probed (AC4).
- D3615 (a changed function declaration has no probe site): its body's head is now probed (AC5).
- D3616 (a `typeof` operand has no probe site): the `typeof` operation is now probed (AC4).
- D3617 (`a?.b.c` to `x?.y.c` has no probe site): the change stands left of the first `?.`, so the chain is now probed whole (AC1).
- D3736 (a changed arrow function has no probe site): its body is now probed (AC5).
- D3737 (a `delete` operand has no probe site): the `delete` operation is now probed (AC4).

The other tests of that file keep their expectations: D3611, D3613, D3614, D3618, D3619, D3620, D3738 and D3739. By anchor, from the catalog itself: `packages/daemon/test/falsify/defects.json` holds records anchored in the two modified files (D3611, D3618 and D3738 in `reach-probe.ts`; D3612 to D3617, D3620, D3736 and D3737 in `probe-slots.ts`); D3611's mutation edits `changedSpan`, which the pairing replaces. List every record whose anchor an edit breaks under the Dev Handoff. Each of those records' `new` text edits a table or a check this ticket reworks (D3612 adds a callee entry to `EXPRESSION_SLOTS`; D3615 and D3736 drop a kind from `NOT_RUN_IN_PLACE` and `NEVER_WRAPPED`), so read each against the reworked code as C38 asks: a mutant must still fail by its named defect, not by a crash or a changed meaning.

`packages/daemon/test/falsify/falsify-workspace.test.ts` is not expected to change: its `no-probe` experiment renames a function declaration (`function add(` to `function sum(`), which stays refused with role `FunctionDeclaration.id`; the one site it asserts is a replaced operator's (`a + b` to `a - b`, a `BinaryExpression`); and every other mutation it runs replaces an operator or a literal inside an expression. The fixture config finds a probed module by the text `globalThis.__rtTestReach`, which every probe form holds.

#### Pending siblings

`node scripts/list-unbuilt-work.mjs --except 3.2b` over this ticket's production, test and doc files named one unbuilt ticket at 22:24, ticket 3.3.

- 3.3 (backlog, authored beside this ticket) writes `falsify/falsify-workspace.ts`, `falsify/experiment-record.ts`, `daemon/executor-jobs.ts`, `daemon/executor.ts`, `daemon/executor-main.ts`, the new `falsify/run-facts.ts` and `falsify/verdict.ts`, and one module split out of `falsify-workspace.ts` if its confirming run needs the room (its Execution Metadata, and the orchestrator at 22:02). This ticket writes none of them. 3.3 reads `reach-probe.ts` only for the `NoProbeSite` type, whose fields AC7 keeps, and writes neither `reach-probe.ts` nor `probe-slots.ts`. Both tickets append records to `packages/daemon/test/falsify/defects.json`, which the orchestrator has cleared, and both report text for `docs/architecture.md` and `docs/testing.md` to the orchestrator, who writes those files. 3.3 raises `FALSIFIER_VERSION` for both.
- 3.5 (backlog) stores the first evidence; this ticket lands before it, so no evidence is stored under ticket 3.2's placement.
- 3.7 (backlog) replays the M2 acceptance on a synthetic fixture; nothing here waits on it.
- 3.8 (backlog) converts this repository's own records into definition files. The records AC7 leaves refused read "no probe site" there until their authors reshape them.

#### Previous-ticket intel

From ticket 3.2 (done): the placement is an allowlist by design, since a probe that alters behavior can fail a test as though the mutation had been detected; `probe-slots.ts` was split from `reach-probe.ts` to keep each file focused; TypeScript value wrappers are judged at the outermost wrapper's position; the probed text is re-parsed, since a position only a type checker forbids cannot be told from the tree (D3738). Its review measured `oxc-parser` 0.151.0's node spans and error offsets as UTF-16 code units, checked over accented, CJK and surrogate-pair text before the site. Its review round found that a wrap of an arrow function fires where the function is defined (D3736) and that a `delete` operand must not be wrapped (D3737).

#### Glossary terms, verbatim

- **Reach probe**: The recorder call a mutation's transform places at the mutated site, so an experiment records which tests executed the mutated code.
- **Experiment**: One run of a defect's test with its mutation applied, inside a falsification job.
- **Invalid experiment**: An experiment whose run cannot say whether the test rejects the mutation, such as one whose test failed in a hook or never executed the mutated site.
- **Falsification job**: One executor job that runs a Vitest workspace's baseline, each of its defects' experiments and the restored baseline in one Vitest instance.
- **Probe site**, the entry the orchestrator adds with this ticket's authoring commit (G4): The place in a mutated module where its reach probe stands. A mutation whose change has none is not run. _Avoid_: probe point, instrumentation point

#### Measuring coverage

The method of ticket 3.2's review, kept as `_agent-docs/.scratch/3-2b/measure.ts` (a scratch script, never a repository script, P11). Should the scratch folder be gone, rebuild it: a TypeScript file run with `bun` from the repository root, with no Vitest, that imports `mutateWithProbe`; lists the catalogs with `git ls-files "*defects.json"`; and for every record whose `file` ends in a JavaScript or TypeScript extension reads that file as UTF-8, calls `mutateWithProbe(record.file, text, record.old, record.new)`, and tallies the status and, for `no-probe-site`, the reason's `nodeKind` and `role`. Report the record count, the `mutated` count, each refused group and, apart from both, the `anchor-count` records: the build's edits break anchors in the two modified files until create-tests repairs them, and those are not refusals (there were none at `e6243dcb`).

`classify.ts`, `show.ts` and `facts.ts` beside it are this ticket's estimate, its sample printer and its two fact checks. `classify.ts` reads the tree's own placement through `mutateWithProbe`, so after the build its section "main's site can fire without the change running" lists what the built placement still probes above a conditional step, which is AC9's third clause. Should it be gone, the check it makes is: for each cataloged mutation that is probed, pair the two parses as § How the site is chosen does, take the path from the program to the node the change stands at, find on that path the node the built placement reported as its site (by its offset and kind), and list the mutation when a role off the always-run table lies between the two, or when the change is a dropped right operand that the site does not probe by AC2's form.

The scripts are untracked scratch in the main checkout, `C:/source/rt-test/_agent-docs/.scratch/3-2b/`, kept there by the orchestrator for this ticket until it closes. A worktree does not hold them: copy the folder to the same path under the build tree, since each script imports the tree's own `packages/daemon/src/falsify/` by relative path and must measure the tree it stands in.

#### Sizing

Raw files, each named: production modified, `falsify/reach-probe.ts` and `falsify/probe-slots.ts`; production created, the pairing module and the placements module; tests, for create-tests, `test/falsify/reach-probe.test.ts` and `test/falsify/defects.json`; docs, as text reported to the orchestrator, `docs/architecture.md`, `docs/adr/0008-detection-from-task-facts-and-canaries.md` and `docs/testing.md`. That is 9 raw and 12 estimated (9 times 1.3 is 11.7), and 8 code units (AC1 to AC7 plus validation). Over 10 estimated, so dev delegates. The work is one dependency chain through one subsystem: the pairing first, then the placements that read it.

#### Doc text

For the orchestrator, who writes each file.

(1) `docs/adr/0008-detection-from-task-facts-and-canaries.md`, third paragraph. Replace its second sentence ("The transform parses the mutated module [...] or before a statement in a statement list.") with:

"The transform parses the module before and after the mutation with the parser the dependency build uses, finds the smallest pair of nodes standing in the same place that hold the whole change, and places a call to a recorder only where the call firing means the changed code began executing. A probe may stand on the smallest construct that always runs the change once it starts, barring a throw inside that construct; it never stands across a conditional or later-run step (a right operand of `&&`, `||` or `??`, a branch, a loop's body, a `case`, a `catch`, a function's body or its parameters, a default value, a class member, a link to the right of an optional chain's `?.`). Code that was only removed is placed by the unmutated text: the probe stands where execution reaches the place the removed code stood. The call is placed around an expression whose meaning a comma expression keeps; as a statement at the changed place in a statement list, which is where removed and added statements are probed; at the head of a function's body when the function or its parameters changed; or, for a dropped right operand of `&&`, `||` or `??`, as an inline function that takes the kept operand's value once, fires only when the dropped operand would have been evaluated, and returns the value unchanged. A changed part that takes no call itself (a callee, a property name, template text, an object literal's property, a declarator, an assignment target) is probed through the nearest enclosing construct that always evaluates it."

Replace its last sentence ("Where no probe can be placed, because the change sits in a callee, [...] names the position.") with:

"Where no probe can be placed (any position the placement rules do not admit, among them a type, an import, a function's name alone, a removed `else`, `case`, `catch` or function declaration, an added `case` or `catch`, a change to the right of an optional chain's `?.` that takes no call itself, JSX text, attributes and element names, a change of white space or comments only, or a module that does not parse before or after the mutation), the experiment is decided before any run: it does not run, and its record names the position."

In its known limits, replace "A mutation that only removes text can be probed at an ancestor that runs without the changed code, so a test that never ran the change can read as having reached it." with: "A probe fires when its construct starts, so a throw inside that construct before the changed code leaves the change un-run with the probe fired. A mutation that changes several statements is probed for the first of them."

(2) `docs/architecture.md` § Falsification jobs, a draft the build confirms and completes with its measured figure. Replace the placement sentences ("It is placed at the smallest syntax node enclosing the changed text [...] Code inside an ambient declaration takes no probe.") with:

"It is placed by comparing the module's parse before and after the mutation, with the dependency build's parser: the two trees are walked from their roots while exactly one child differs, and the pair of nodes where the walk stops holds the whole change. The probe stands only where its firing means the changed code began executing: around an expression whose meaning a comma expression keeps; as a statement at the changed place of a statement list, for removed and added statements that run where they stand, which a function declaration, an import, a type declaration and a directive do not; at the head of a function's body when the function or its parameters changed; inside a branch or a loop's body that was a lone statement; and, for a dropped right operand of `&&`, `||` or `??`, as an inline function that fires only when the dropped operand would have been evaluated. A part that takes no probe itself (a callee, a property name, template text, an object literal's property, a declarator, an assignment target, an argument of a call rooted at `import.meta`) is probed through the nearest enclosing construct that always evaluates it, never across a conditional or later-run step. Code that was only removed is placed by the unmutated parse. A TypeScript value wrapper counts as the position it stands in. Code inside an ambient declaration takes no probe."

In its known limits: narrow the bullet on a probe around an argument a build plugin reads statically to what remains ("a probe around an argument a build plugin reads statically, outside a call rooted at `import.meta`, makes the module fail to load in the experiment"), since only that one class was read and ruled; delete the bullet on a mutation that only removes text; and replace "a file the parser cannot read has no probe site, and so do about three in ten of this repository's own cataloged mutations, a deleted statement above all" with a sentence naming the refused kinds AC9's measurement finds, in this form: "a file the parser cannot read has no probe site, and so do a few kinds of mutation: an import, a removed `else`, `case` or `catch`, and a change to the right of an optional chain's `?.` that takes no probe itself". The orchestrator ruled (Q5) that the measured counts replace "about three in ten" in this text; the review of this ticket found that a count in a living doc goes stale at the next landed record (C49), since this ticket and 3.3 both append records. The draft therefore names kinds and leaves the counts in Completion Notes, stamped with their commit, unless the orchestrator rules the stamped count into the doc.

(3) `docs/testing.md` § Falsification jobs, mutation transforms and reach. Its sentence on `reach-probe.test.ts` stays true. The tests session adds the new defect ids to the section's opening range and, after "which calls `mutateWithProbe` on source text the test gives", the clause: "and, for a probe that fires conditionally, evaluates the probed text against a recorder".

### References

- `_agent-docs/sprints/sprint-3-falsification.md` § Ticket 3.2b and its objective.
- `_agent-docs/tickets/3-2-transform-experiments.md` § Review Record: the rulings of 20:42 and 20:48, the known limits, and "Probe coverage measurement, for 3.2b".
- ADR-0003, ADR-0007, ADR-0008.
- `docs/requirements.md`: FR11.
- `docs/architecture.md` § Falsification jobs; § Execution and falsification isolation. `docs/testing.md` § Falsification jobs, mutation transforms and reach.
- GitHub issues: `node scripts/list-open-issues.mjs` printed "0 open issues, complete" on 2026-09-30 at 21:46.

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C8,C12,C13,C14,C19,C28,C30,C38,C39,C45,C46,C48,C49,C51,C52,C55,C57,C59,C135,C138,C147 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P11,P13,P16,P17,P18,P19,P21,P35,P36,P37,P39 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area:
  - packages/daemon
is_consolidation: false
sizing_ac_count: 8
files_to_modify:
  - packages/daemon/src/falsify/reach-probe.ts
  - packages/daemon/src/falsify/probe-slots.ts
files_to_create:
  - packages/daemon/src/falsify/change-pair.ts
  - packages/daemon/src/falsify/probe-placements.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId {{dev_thread_id}}

#### Test Files This Change Broke

None.

#### ACs Owed a Test

None.

#### Tests Owed

None.

### Tests Record

Tests session: threadId {{tests_thread_id}}

#### Named Defects

None.

#### Deliberately Untested

None.

### Review Record

#### Test Coverage Gaps

None.

### Completion Notes

### File List

- `_agent-docs/tickets/3-2b-probe-sites.md` (created by create-ticket)

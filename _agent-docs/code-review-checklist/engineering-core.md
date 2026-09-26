<!--
SHARD: engineering-core. Cross-cutting checks a reviewer runs against every diff.
Ids are C<n>, flat and unique across every shard; take the next unused number and never renumber.
Maintenance: _agent-docs/rule-maintenance-guide.md. A rule states the check and nothing about its origin.
-->

# Engineering Core

## Dependencies

C1. **Declare peer dependencies explicitly**: A new dependency's required peers are declared in the same `package.json`, never satisfied only because an unrelated package happens to pull them in. FAIL on a declared dependency whose peer set resolves only incidentally.

C2. **Bound a root override on both sides**: A root `overrides` entry for a runtime dependency carries an upper bound below the next major and a floor no lower than what its dependents pin. An unbounded or under-floored override silently changes every dependent's version.

## Constants and configuration

C3. **Name every magic value**: A numeric limit, timeout, status string or other domain literal is a named constant. A key one package writes and another reads is one shared constant referenced by both sides, so a rename is a compile error rather than a silent `undefined`.

C4. **Place a constant by its readers**: A constant read by more than one module lives in a shared module; a constant with one reader is declared beside that reader.

C5. **Search before adding a helper**: Before a new utility (formatter, parser, path helper, process wrapper), the diff shows no existing implementation in `packages/*`, `scripts/lib/` or `lint/` answering the same question. Two helpers that disagree on an edge case are a defect, not a style issue.

C6. **Read each environment variable in one place**: Each environment variable is read in exactly one module that exports the value or a helper. Scattered reads of one key drift in their fallbacks.

C7. **Document a new required setting in the same change**: A new required environment variable, config key or CLI flag is documented where a user sets it up in the same diff, including what failure looks like when it is missing.

## Design

C8. **Answer one question once**: Two expressions in one scope must not answer the same question differently, such as two staleness tests with different windows. When a change corrects a predicate, the enclosing function holds no second spelling of it.

C9. **Make an inverse half agree on edge cases**: A helper written as the other half of an existing one (reader for writer, parser for serializer, teardown for setup) handles the empty, absent and sentinel inputs exactly as its counterpart does, or states the divergence at its definition.

C10. **Make the bad state unreachable before cleaning it up**: A design that adds recovery machinery (a flag, a sweep, a compensating write, a retry) first states what makes the bad state reachable and whether moving a guard or narrowing a type removes it. FAIL on machinery for a state the same change could have made unreachable.

C11. **Return which input a fallback used**: A function that may substitute a different input (a widened set, a cached value, a default) returns the substitution with the answer, and callers derive their counts and labels from that, never from what they passed in.

C12. **Never synthesize a recorded value**: A read path never manufactures a default for data that was never recorded and presents it as recorded. Absent stays absent: an unrecorded outcome is unknown, not passed, false or zero.

C13. **Extract near-identical blocks**: Near-identical blocks longer than about ten lines are extracted into a shared helper. FAIL on a diff that adds a second copy of such a block.

C14. **Reuse a type before declaring one**: A new type or schema that describes an existing shape imports or derives it from its source instead of hand-copying it.

C15. **Check extracted parameters against the call site**: When extraction turns locals into parameters, no new parameter shares both a name and a type with a different live value at any call site. Pass the object the correct values came from, so the wrong value is not assignable.

C16. **Pass the entity, not an id read off it**: A helper takes the entity alone and reads its id inside. A parameter list carrying both an entity and one of its own identity fields lets a caller pair the wrong two.

C17. **Narrow on the receiving binding**: A type narrowing that limits what may be read annotates the binding the value arrives on, never a second local beside a wider binding that stays in scope.

C18. **Take the narrowed type, not a restated shape**: A helper receiving a narrowed value declares the narrowed type as its parameter, never its own structural shape of optional members.

C19. **No widening casts**: No `as` cast widens a union or literal type (such as to `string`), since it defeats exhaustiveness checks. Fix the types instead.

C20. **Never sort a shared array in place**: Sorting an array the function did not create uses `toSorted()` or a copy, never `sort()` on the original.

C21. **Guard on presence, not truthiness**: A guard deciding whether to transform a value that can be `0` or `""` tests `!== undefined` or `in`, never truthiness.

## Bounds and truncation

C22. **Bound input before fanning out**: An externally sized array is sliced to a named limit before it feeds `Promise.all` or any per-item work, not after.

C23. **One limit for one dataset**: Two reads of the same dataset for two purposes (a lookup map and an iteration) use the same limit constant.

C24. **Derive a truncation flag from the bound that cut**: A `truncated` flag compares against the same constant that bounded the read, and every bound in a multi-stage aggregation feeds it.

C25. **Detect truncation where completeness decides**: When a bounded result drives a completeness decision (a uniqueness check, an "all done" verdict, a deletion loop), reaching the bound is detected and gates the decision rather than passing silently.

C26. **Filter before slicing**: A visibility or scope filter runs before the slice to the caller's cap, and the read over-fetches to allow for it.

C27. **Clamp the hard limit outermost**: A value clamped between two independently movable constants puts the limit that is not ours to choose outermost, so no later edit to the inner bound can breach it.

C28. **Bound every recursive walk**: A recursive traversal checks a named depth ceiling and throws on reaching it rather than returning a partial answer.

C29. **Take the first match only where one can exist**: Picking the first element of a lookup is allowed only where at most one match can exist; otherwise select by an explicit criterion.

## Errors and outcomes

C30. **No swallowed error**: A `catch` either rethrows, returns an explicit error state, or reports the error; it never converts a failure into a success-shaped value.

C31. **Report success after it happens**: A success event, log line or message is emitted only after the operation completed, never before.

C32. **A degraded result is not a success**: A truncated, partial or fallback result is reported at warning level or stronger and says what was dropped, to the caller and to the log alike.

C33. **Let a wrapper's own fields win**: A wrapper that spreads caller-supplied context into a structured record spreads the caller's object first, so its guaranteed fields cannot be overwritten.

C34. **Treat an expected absence as expected**: In layered cleanup, a later layer finding the resource already gone skips quietly; it is not reported as a failure.

C35. **Report derived values, not the caller's claim**: When code derives a value that replaces a caller-supplied argument, the record and the log carry the derived value.

C36. **Return whether a guarded operation applied**: An operation that can no-op (guard refusal, already terminal, replay) returns an explicit applied flag, and callers gate every success signal on it.

C37. **Do not retry a verdict**: Under automatic retry, a deterministic refusal (invalid input, a failed precondition) is marked non-retryable; only faults that can succeed on a later attempt are retried.

## Consumers and shapes

C38. **Audit every consumer of a changed shape**: When a returned shape or schema changes, every consumer that reads it is found and checked in the same diff, including JSON consumers outside the type system.

C39. **Audit every consumer of a changed behavior**: When a shared helper's behavior changes at an unchanged shape (a short-circuit, a narrowed result), each caller is checked for the new behavior individually.

C40. **Wire a new parameter into every assembler**: A member added to a shared options or params interface is read by every builder that assembles a request from it, in the same edit.

C41. **Audit readers when adding a write**: A handler that starts writing a shared record or file is checked against every reader of the fields it writes, by field name rather than by symbol.

C42. **Emit keys the lookup side will match**: A read that normalizes an identifier (case, trimming, aliasing) returns a key the matching write or lookup side accepts unchanged.

## Comments

C43. **Keep a docblock adjacent to its symbol**: No declaration or second block comment sits between a `/** */` block and the symbol it documents. A new declaration goes above the existing docblock.

C44. **Put a module header above the imports**: A block comment describing the whole module sits above the import statements, where it attaches to no declaration.

C45. **Prove a comment that claims a guarantee**: A comment or docblock asserting or denying a compile-time, test or runtime guarantee has been demonstrated: a compile claim by running `tsc` on the violating snippet, a test claim by a named defect that the test detects. Otherwise add the construct that makes it true or delete the sentence.

C46. **No comment contradicts its code**: Every comment naming a guard, caller, count, default or thrown error is checked against the lines it describes.

C47. **No commented-out code**: Unused code is deleted, not commented out.

## Living documents

C48. **Sweep prose when a symbol, caller, value or mechanism changes**: A diff leaves no live doc, rule, test title or comment describing the old name, caller set, value or mechanism. Grep the callee and the retired vocabulary as well as the deleted name, and verify each rewritten claim against the code rather than swapping the name.

C49. **Keep a count in prose only where an assertion needs it**: A number in prose ("both consumers", "three callers") survives only where an assertion fails without it; otherwise delete the number rather than update it. Adding a member to a set falsifies such counts as surely as removing one.

C50. **Write a closure check as enumerate and classify**: A deletion or migration closure check lists the deliberate survivors and classifies each hit, never "the grep returns zero", and it covers untracked files, every workspace, the test tree and root docs.

C51. **Update the status of a question the change settles**: A change that answers a question a live artifact records as open (an ADR, a rule, a test comment, an assumptions list) corrects every artifact still describing it as open.

C52. **Check a claim whose evidence is in reach**: Arithmetic is recomputed from the artifact's own numbers, a "measured" or "derived" label matches its cited source, an enumeration is regenerated from its registry rather than a sample, and "every caller" or "the only path" is traced through the call graph.

C53. **Fix a whole enumerated set or state what was left**: A fix applied to members of a set covers the whole set, or names the members left and why.

C54. **State the symptom in a finding**: A finding, debt item or issue states what was observed and where, and marks any suspected mechanism as unverified below it.

C55. **Keep living docs as current truth**: A living doc (plan, architecture, rule, ADR decision, comment) is rewritten to the new truth, never amended with "previously", "amended" or "correction" blocks. A dated record (a retrospective, a shipped change record) is never rewritten; point it forward instead.

C56. **Classify a sweep hit by section, not by file**: A rename sweep re-points a symbol only in live sections; inside a dated narrative (an ADR's context, a done ticket's record) the old name stays.

## Removal

C57. **Remove what is superseded in the same change**: A superseded function, field, flag, type or file is deleted in the change that replaces it. A deprecation window is justified only by a caller outside this repository that still uses the old path.

C58. **Remove every usage, including tests and prose**: A deletion removes the symbol's tests, mocks, fixtures, docs and comments along with its code, and `tsc` over the test tree is clean afterwards.

C59. **No unused export**: Every export has a production consumer. A reference from test code, a mock or a barrel re-export is not a consumer; delete the export and its tests, then re-check the layer it exposed.

## Tooling and gates

C60. **Give a "found nothing" gate a positive control**: A script whose pass means "I looked and found nothing" proves it looked: it asserts the target exists and was read, counts what it examined, and fails loudly when the tool did not run or produced no output.

C61. **Accept every form the repository's bans force**: A gate that parses prose or comments matches the form authors are required to write (for example a comma or colon where a banned dash used to be), and a widened pattern is proved by the count of what it now sees.

C62. **Sweep the parsers when adding a ban**: A new ban on a character, word or shape greps the scripts that parse the affected artifacts and confirms each still sees every entry.

C63. **Write control characters as escapes**: No source file contains a raw non-printing character; write the escape (`"\u0000"`) through a named constant, since one raw NUL makes grep treat the file as binary.

C64. **Prove a lint rule's scope and evasions**: A new or widened lint rule is proved to fire on the least obvious file in its intended scope, its `overrides` glob covers every file where the construct does harm, and each alternate spelling of the banned construct has a probe.

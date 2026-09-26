<!--
SHARD: testing. Checks a reviewer runs against Vitest tests and their named-defect records.
Ids are C<n>, flat and unique across every shard. The orchestrator allocates each new id, the next unused number; never renumber.
Maintenance: _agent-docs/rule-maintenance-guide.md. A rule states the check and nothing about its origin.
-->

# Testing

## Named defects

C65. **Diagnose a surviving mutation**: When a mutation survives, the review says whether the test is vacuous (the mutation is observable elsewhere, so rewrite the test) or the production line is redundant (another guard already yields the same result, so keep the test and pick an observable mutation). Never delete a test only because an equivalent mutation survived.

C66. **Prove a control by mutating its subject**: A control or guard assertion is proved by mutating the code it guards, never the expected value, which fails any assertion and proves nothing.

C67. **Treat a detection as proof of the test, not the line**: A detected defect is not offered as evidence the production line is correct. Where the line hands control to code outside the file (a library callback, a child process, a framework hook), check what else that line decides in the installed source.

C68. **Name the defect narrowly enough to be wrong**: A guard with several operands is driven bad through every operand, and a resolver that exists for inheritance, order or precedence is tested on the case that needs it. "The check exists" is not a named defect. A recorded mutation produces the behavior its defect sentence names; one the test catches only through a crash or another failure the sentence does not describe proves a different defect.

C69. **Verify a logged coverage gap against the code**: A recorded coverage gap names a defect traced to the branch that would exhibit it. An unverified gap is not recorded.

C70. **Order assertions so the named defect reaches its own**: Inside a test, no assertion the type system already decides, or that no production change could make false, stands in for a guard.

## Assertions

C71. **Describe behavior in the test name**: A test name states the behavior and outcome ("rejects a missing fingerprint"), not the function under test.

C72. **Assert an observable outcome**: Every test asserts a returned value, a written record, an exit code, an emitted line or a thrown error. FAIL on a test with no assertion, one whose only proof is completing without error, or one comparing a value to its own literal copy.

C73. **No identity assertions**: An expected value is never computed from the same result object under test, and never read back from a constant the production value was composed from where the exact text is the contract. Pin a literal instead.

C74. **Assert exact counts when the count is known**: A count assertion whose value the setup determines uses `toBe(n)`, not `toBeGreaterThanOrEqual(n)`.

C75. **No assertions behind a runtime conditional**: No `expect` sits inside an `if` whose condition the code under test controls. Assert the precondition or the discriminant unconditionally first.

C76. **Fail against the old behavior**: A test covering a changed behavior pins a value the pre-change code would not produce, with an unchanged control beside it.

C77. **Pin a bound against a literal**: A test of a limit pins the constant against a literal from the requirement, and its boundary pair uses literals rather than arithmetic on the constant.

C78. **Test both sides of a boundary**: A max, min or staleness guard is pinned with the over-limit case rejected and the exactly-at-limit case accepted.

C79. **Use a containment matcher only for containment**: Where a change removes text from output, the test pins the exact text, and pins the removed claim's absence as a pattern over its rewordings.

C80. **Pair a cross-variant negative with a positive**: A negative keyed on a sibling variant's text is backed by a positive assertion of that same text in the sibling's own test.

C81. **Keep a class guard's list and pattern in step**: A comment listing a retired form's spellings names none that its own pattern cannot match, and sibling guards for the same form agree.

C82. **Assert the fate of every element**: A batch or multi-item test uses a distinct resource per element and asserts each element's outcome, not one representative.

C83. **Assert every field a conditional update touches**: When an operation conditionally changes secondary state, a dedicated case drives the condition and asserts every affected field.

C84. **Assert new fields after every write path**: A test for a newly persisted field reads the stored value back after each path that writes it.

C85. **Prove a filter excludes**: A filter or scope test includes data outside the boundary and asserts it is excluded.

C86. **Reach the guard you name**: A test for one guard in a chain supplies input that passes every earlier guard, and distinguishes guards that share an error kind.

C87. **Assert the skip mechanism of an idempotency guard**: A skip-if-done test asserts the skip itself (a skip record, an unchanged timestamp), not only a success-shaped return.

C88. **Test the skip path of a conditional side effect**: A side effect gated on state has a test showing the skip path produces none.

C89. **Keep the primary result when a best-effort step fails**: A best-effort step wrapped in `try` has a test proving the primary operation completes when that step throws.

C90. **Assert the emitted event, not just completion**: A test for code that emits a structured record or log asserts the record's name and key fields.

C91. **Price the full worst case in a ceiling assertion**: A `worstCase <= LIMIT` assertion includes every term the production derivation prices; an omitted term admits values that breach the real limit.

C92. **Test type-level guards with a failing fixture**: A type-level assertion ships with an `@ts-expect-error` line proving it rejects the case it exists to catch, checked by `tsc`.

## Inputs, fixtures and mocks

C93. **Call the production function**: A test drives the real function, script or CLI entry, never a reimplementation of its logic inside the test.

C94. **Build inputs a real caller builds**: A test driving a gate keyed on an absent argument, a default or a flag combination uses a payload some production caller constructs; read the caller to confirm.

C95. **Import production constants that size inputs**: A test sizes its input from the production constant it depends on; a hand-copied value drifts.

C96. **Derive a set's size and subsets from the set**: A test never hardcodes how many members a production set has or lists a subset by hand; derive the count, or filter the subset with a predicate over the set.

C97. **Mock a large bound down**: A guard on a limit too large to seed cheaply is tested by mocking the constant down, paired in the same file with a literal pin of the real value read through `vi.importActual`.

C98. **Type a fixture against the symbol it stands in for**: A hand-written return value for an in-repo function carries that function's declared return type, so a shape change fails to compile.

C99. **Read each new fixture member deliberately**: When a required member is added to a fixture type, each fixture is set to the value its case actually describes rather than the falsy default everywhere.

C100. **Mock a function, never a value**: A `vi.mock` factory replaces behavior and spreads `vi.importActual` for the rest; it never re-declares an exported constant's value as a literal.

C101. **Check a module mock can vary the operand under test**: When a guard's operand comes from a module-mocked function, some test in the file varies it; otherwise record the operand as an explicit gap.

C102. **Assert something only the re-stub produces**: A test that overrides shared setup asserts at least one value the default fixture would not also produce.

C103. **Stop mock state leaking between tests**: No implementation set inside one test survives into the next: give module-scope mocks their default in `vi.fn(impl)` and call `vi.resetAllMocks()`, or re-establish every mock in the test's own body. `vi.clearAllMocks()` leaves implementations in place.

C104. **Fail a failure-path test through an explicit mock**: A failure path is triggered by an explicit mock or stub, never by a missing environment variable or absent file.

C105. **Control time explicitly**: A time-dependent test uses `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync()`, never a real wait. A refreshed-timestamp assertion advances the clock and asserts strictly greater.

C106. **Clean up temporary state in the test body**: A test that creates a temporary directory, file or process removes it in a `finally` inside the same test.

C107. **Drive a CLI through its exit code and streams**: A script test asserts the exit code and the stdout or stderr content a user sees, not an internal helper alone.

## Suite hygiene

C108. **One owning test per behavior**: A new test does not re-cover a path already asserted in the same file or a sibling suite; overlap keeps the strongest test.

C109. **Merge tests a deleted branch made identical**: When a diff removes a branch, tests whose only difference was the input selecting that branch are collapsed into one.

C110. **Repair a test whose prose a migration re-points**: When a migration rewrites a test's comments or title for new machinery, the assertions are checked to still fail against the guarantee the title claims.

C111. **Re-key a negative test whose marker moved**: A negative test whose looked-for marker was renamed is re-keyed to the new marker; it is deleted only when its guarantee's subject left.

C112. **Sweep test titles separately**: A migration's `describe` and `it` strings and their docblocks name no retired store, helper or mechanism.

C156. **Make every named mutation observable on each CI platform**: A named defect's mutation shows on Windows and Linux alike. One whose effect depends on the host (path separator, line endings, case sensitivity) is proven through an injected platform module or input, never the host's own.

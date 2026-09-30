# Define named defects in JSON files the consumer lists, naming each test by its identity

Status: accepted

ADR-0004 commits defect definitions in the consumer at a configurable location. A consumer commits them for years, so their format is as hard to change as the location.

`rt-test.json` at the consumer root lists, in a `defects` member, root-relative glob patterns naming the definition files. There is no default: with no member there are no definitions, and every test is a gap. Each file holds JSON with a `defects` array. Each definition has an `id`, unique across every file; the `defect`, the wrong behavior in plain language; the `required` behavior it breaks, in plain language or as a requirement reference; the `test`, as its module's root-relative path, its name path (each enclosing suite's name, then the test's, with an `it.each` arm named by its reported title), and, only where the module alone cannot tell, its Vitest project and its occurrence among tests sharing that name path; and the `mutation`, as a root-relative `file` with the exact `old` text and its `new` replacement. Definition files stay ordinary inputs, since a test may read one.

A definition is invalid, and says why, when its file cannot be read or parsed, its id repeats, its test is not discovered or its name matches more than one test, its mutation changes nothing, or its file lies outside the consumer root. Its anchor is missing when `old` does not match exactly once in the file as it is now. An invalid definition and a missing anchor each count in the denominator and withhold verified, and every other defect still runs.

Rejected: the bootstrap `defects.json` with a `D<id>:` title prefix, which ADR-0004 rejects. Rejected: the text block format of Fleet Cooling's `falsify.mjs`, whose test pattern is a path substring and whose expected test is a name substring, so it cannot name an `it.each` arm or one of two tests sharing a name. Rejected: YAML, which needs a parser dependency. Rejected: a default location, which would claim files of another format, such as this repository's own `defects.json`.

# Shared review rules

Read this in every review lane: `review-changes`' fresh-eyes agents, the `_agent-docs/adversarial-review-prompt.md` sub-agent, `dev-ticket`'s adversarial pass and ticket sanity check, and `create-ticket`'s draft reviewers. It owns how a finding is ranked, and the second search a review does not run by default.

## Finding severity

Severity answers one question: **what does this cost if it fires?** A code-pattern category cannot answer it: "unbounded read" describes the shape of the code, not who is hurt or whether it ever happens.

Two dimensions set severity, and every finding records both beside it.

**Surface: who meets the failure.** The primary axis.

- `consumer`: reachable from what a consumer project or its agents read: CLI output, `--json` output, the programmatic API, and the results and freshness they report.
- `daemon-state`: the daemon, the state store, test execution and defect evidence, before anything is reported.
- `internal`: repository tooling, scripts, workflow docs and tests.

**Reach: how often it fires.** Record `measured N of M`, `unknown`, or `unreachable (measured)`. **Only a measured reach may lower a severity.** "This probably never happens" is the sentence that talks real bugs away; measure it with a fixture or a throwaway script, or record `unknown` and let the severity stand.

|              |                                                                                                                                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CRITICAL** | On any surface: a stale or unverified result reported as current, a zero-test selection or lost state reported as success, stored results or evidence lost or corrupted, a mutation written into a consumer's working tree, an untrusted project executed, or data leaving the machine. |
| **HIGH**     | A `consumer` defect producing wrong output or a blocked flow, or a `daemon-state` defect that loses work or corrupts state without failing loudly.                                                                                                                                      |
| **MEDIUM**   | A `daemon-state` or `internal` defect that fails loudly and reversibly: it throws, exits non-zero with a message, and a retry recovers. Or a cosmetic `consumer` issue.                                                                                                                 |
| **LOW**      | Style, naming, docs, comments: no behavioral consequence.                                                                                                                                                                                                                               |

A finding that cannot name its surface has not been analyzed far enough to rank.

**Worked example.** "The selection walk has no depth ceiling" reads as unbounded recursion, so HIGH on a pattern-only ladder. Suppose a measurement on the fixture projects finds the deepest import chain far below the stack limit, and exceeding it throws before anything is reported. Then it is `daemon-state` and fails loudly: MEDIUM at most, with checklist C28 naming the fix.

## Reviewing for incompleteness

**Every category a review prompt lists describes a claim that is wrong.** Off-by-one, wrong operator, missing guard, race, stale comment: each is found by locating text or behavior that contradicts something else. That search cannot find a claim that is **correct and incomplete**: a constraint stated accurately, in detail, and then not carried through to the mechanism the same artifact specifies. Nothing contradicts it, and the detail makes it read as a well-analyzed decision.

A hostile fresh-eyes review misses this shape, so run it as a search of its own:

- **Follow each stated constraint to the mechanism that implements it.** "A result whose inputs changed is never reported current" is correct; ask which code path enforces it on every read, and whether it does.
- **Treat a completeness claim as a search target, not a result.** "Both callers", "the only writer is X", "every state is handled". An enumeration that over-claims is worse than none, because it stops the next reader looking. Verify the set.
- **Find the decisions the artifact hands forward.** "Decide whether…", a conditional entry in a file list, a count given as "one new constant". Detail makes these look settled; they are open.
- **Diff every enumerated set against what the code has.** Checklist C52 names this for claims you write; point the same probe at what you were handed.

Phrase such a finding as "this is right and stops one step short of where it had to reach". That makes the gap actionable rather than arguable.

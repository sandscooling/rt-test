# Falsify by in-memory transform and decide from run facts

Status: accepted

Fleet Cooling's `falsify.mjs` writes each mutation into the working file, restores it in a `finally`, and decides whether a mutation was detected by matching error message text. That classifier grows with every new failure shape and is the owner's main maintenance cost; the file write is safe only while nothing else reads the tree.

Apply each mutation as an in-memory module transform in a separate Vitest instance, after the unmutated baseline passes for the same inputs, and never write a mutated file. Decide each verdict from facts recorded during the run: the failure phase, the error kind, whether the mutated code was reached, and the baseline result. Only an assertion failure in the intended test counts as a detection. Keep canary fixtures, aimed at the fact collector.

The premise holds on the installed Vitest 5.0.1: a `createVitest` instance given a plugin whose `transform` rewrites one source module ran the baseline to `pass` and the mutated run to `fail` with an error named `AssertionError`, and the source file was unchanged. Vitest 4.1 is unverified until the falsification milestone's first spike.

Rejected: mutating a disposable copy, as the bootstrap `scripts/verify-defects.mjs` does, which pays a copy per experiment and is still a file write. Rejected: porting the message classifier, whose growth is the cost this decision removes. Rejected: Stryker, which chooses mutations, while RT Test runs only the mutations the author defines. Revisit if a supported Vitest version stops applying plugin transforms to the modules a test imports.

Enforcement: the project-context directions on transforms and fact-based verdicts, the checklist checks that no mutation reaches the consumer's tree and that setup failures never count as detections, and named-defect tests over the canary fixtures, owed in the falsification milestone.

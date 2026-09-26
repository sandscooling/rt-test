# Commit defect definitions in the consumer and keep evidence local

Status: accepted

A named defect has two halves with opposite lifetimes. Its definition (id, behavior, test identity, mutation) is authored with the test and must be reviewed with it. Its evidence is bound to one machine's inputs, run, and configuration, and goes stale with the next relevant edit.

Commit defect definitions in the consumer repository at a configurable location, and keep defect evidence in the local state directory, `.rt-test/` by default, which the consumer excludes from version control. Attribute evidence by stable test identity, including each `it.each` arm.

Rejected: definitions in RT Test's local store, which a fresh clone loses and no review sees. Rejected: definitions encoded in test titles, the bootstrap `D<id>:` convention, which cannot carry a mutation and cannot name an `it.each` arm. Rejected: committed evidence, which is machine-bound, churns on every run, and would read as current on a checkout whose inputs differ.

Enforcement: the project-context directions that keep definitions in the consumer and state under `.rt-test/`. Nothing mechanical checks the location; a checklist rule would add nothing a reviewer does not already see in the diff.

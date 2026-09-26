# Tech-debt pass (Step 9)

The pre-existing debt this review collected, worked after its own change is committed.

**The commit is a gate.** Start only once the orchestrator has sent the sha; otherwise say so and stop. The sha is
what an issue comment cites, the reviewed change stays the unit it was measured as, and the debt fixes land in a
commit of their own. A test a debt fix breaks goes to the tests session, as at Step 7.

## 1. Scope every item before triaging

Scoping changes dispositions, since each item arrived as a one-line description written before anyone looked.
For each, establish what has to change, how many files, and whether it is mechanical or needs a decision. Expect
three reversals:

- **Ownership**: an item that reads like a planned ticket's job is often unowned. Read that ticket's criteria,
  not its title.
- **Direction**: a fix can invert once you see the surrounding convention; the one divergent caller may be the
  thing to fix, not the export.
- **Class**: apparent duplication can be a deliberate divergence once both sites are read, which makes it a
  decision.

State the scope, then triage.

## 2. Check the open GitHub issues, both directions

Reading issues is mandatory; only filing is the owner's call. Run `node scripts/list-open-issues.mjs`, following
`{cfg.rules_dir}/github-issues.md` for its exit codes (a `SKIP:` line means carry on without this section; exit 1
means raise `--cap` and re-run). Match the list against the debt items and against the committed change:

- **A debt item may already have an issue**: comment there, never open a second.
- **The committed change may have resolved an issue nobody linked**: that document's § Closing issues your
  change resolved owns the procedure, and this step discharges it for the review. You just read the whole diff, so
  you are best placed to recognize one.

## 3. Two dispositions

- **Fix it**, the default for everything mechanical: a defect, a duplication, a wrong bound, a stale citation, a
  missing guard, an extraction. It has one right answer. Do not ask permission, and do not offer deferral beside
  it. Size, "pre-existing" and "out of scope" select nothing.
- **Discuss it**, only when the fix needs a decision that is the owner's: a product fork, a new requirement, a
  design with more than one defensible answer. Bring the options, what each costs, and your recommendation;
  `change-request` is the route once it is settled.

Never open a GitHub issue as a disposition; that is the owner's call, given in words. If an item cannot be fixed
in this pass, say what it is blocked on in one sentence and let the owner direct it.

**Fold into an unbuilt ticket only where landing separately would collide**: a planned ticket's criteria
re-author the same function or signature. Say where the fix went.

**A round that outgrows one honest validation pass is split** into two debt changes, each gated. Report the split.

## 4. Apply and validate

Apply the fixes with the same loop and gates as Step 7, in the same order: size, lint, typecheck, the suite scoped
from this round, `test:defects` when a fix touched a named-defect test or an anchored line, and the citation check
when lines moved. Verify any third-party claim an item turns on against installed source, and say which you read.

Then report the debt change to the orchestrator as its own path list, with the gates and their windows, and wait
for its sha. Outside a lane, commit it by `{cfg.rules_dir}/git-commits.md`.

## 5. Close the loop

With the sha, close what is fixed and comment what was re-scoped, citing the commit in each. A comment saying
what changed about the issue (a citation moved, a prescribed fix became impossible) is worth more than a
completion notice. Show the exact text of every post: under a lane, send it to the orchestrator, which posts it.

Finish by stating which issues moved and which debt items remain, each naming the fork under discussion or the
thing it is blocked on. An entry whose only reason is size is a deferral nobody decided.

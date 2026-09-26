# Fix fan-out (Step 7)

Delegating the fix loop when the manifest is long. The main loop keeps the task list, the record and every
validation gate; agents apply edits and nothing else.

**Fan out when the manifest spans more than 5 distinct files.** The count is files, not findings: eleven findings
in three files is an inline round.

## Partition by file, never by finding

All findings for one file go to one agent, and no file is held by two agents: concurrent edits to one file lose
each other's writes with nothing reporting it. **A fix spanning several files is one unit** (a rename, a signature
change, an extraction and its imports): give every file it touches to one agent, or keep it in the main loop.

Label each partition by area and folder (`fix-core-evidence`, `fix-scripts-rules`). Write the partition table,
then spawn every partition in one message as a `general-purpose` agent with `run_in_background: true`.

## What each fixer gets

**A fixer writes code this same review judges**, so it gets the rules, the opposite posture from `FRESH-EYES.md`,
whose context-free opening never belongs here.

**By command**, run by the agent itself: `{{fix_rules_command}}`, never `{{rules_command}}`, which leaves the
checklist out; and the standards sections a fixer needs:

```sh
node scripts/doc-section.mjs {cfg.code_change_standards} "Pre-Edit Requirements" "Universal gates" "File Size & Extraction Strategies" "Deleting an Exported Symbol"
```

**By value**: the partition's findings, each with `file:line`, the defect, the fix as triaged and its severity;
and `{{pending_siblings}}`.

## The prompt

```text
You are applying agreed code-review fixes. They were triaged and approved: apply them exactly, and do not reopen
whether they are right.

Partition: {{partition.label}}

Run both of these first and follow what they say. They are the rules this code was written under and the rules
the next review judges it against:
  {{fix_rules_command}}
  node scripts/doc-section.mjs {cfg.code_change_standards} "Pre-Edit Requirements" "Universal gates" "File Size & Extraction Strategies" "Deleting an Exported Symbol"

Work that is planned but not built yet and bears on your files. A helper you cannot find may be one of these. If
a ticket here owns part of what you fix, fix only your side of the line and say so:
{{pending_siblings}}

Findings to fix, all of them, and nothing else:
{{partition.findings}}

How to work:
- Read each file in full with the Read tool before editing it.
- Apply each fix as stated. Do not redesign or widen it, and do not clean up code you pass: anything else you
  touch is unreviewed change.
- Add no comment explaining the fix, citing a rule or ticket, or recording a measurement. A comment you add
  states only a fact the code cannot, in one to three lines.
- If a fix cannot be applied as stated, leave the file alone and report it UNAPPLIED with the reason. A fix of
  your own choosing is not a substitute.
- Edit no test file; a finding that needs one is UNAPPLIED with that reason.
- Never write an em dash (U+2014): a hook denies any write containing one.
- Run no lint, typecheck, test or build. Other agents are editing other files, and the caller validates once at
  the end.
- Do not create or update tasks with TaskCreate or TaskUpdate: the task list belongs to the caller.

## Delivering your result

You run in the background, so your final message is not reliably delivered. Load SendMessage in your first
message, alongside your opening reads: ToolSearch({query: "select:SendMessage", max_results: 1}). As your last
action, send the complete report with SendMessage(to: "main"), one entry per finding:

  Finding: <the id or file:line you were given>
  Status: APPLIED | UNAPPLIED
  Change: <what you edited, at file:line>
  Reason: <UNAPPLIED only: why, and what you need to proceed>

Send it even if every fix was simple, and send it if you failed: a silent agent is indistinguishable from a
working one.
```

Substitute every `{cfg.KEY}` and `{{variable}}` in it with its literal value before sending.

## On collect

One report per partition; a missing one is a stall, never a pass, so ask that agent to resend. Mark each manifest
task from the reports. Every `UNAPPLIED` finding is yours now: fix it inline, or where the finding was wrong, close
it with the reason. Then run Step 7's validation over the union of the files the reports name.

# Implementation fan-out (Step 6)

Delegating the implementation loop when a ticket's tasks decompose. The main loop keeps the ticket file, the
task list, the contract layer and every validation gate; agents write source and nothing else.

## Fan out on independence, not size

Trigger: **two or more groups that are file-disjoint and have no ordering between them**, together spanning more
than 4 files. A twenty-file ticket that is one dependency chain delegates nothing, and a three-file group costs
more to hand off than to write. `review-changes`' `FIX-AGENTS.md` keys on a file count instead, because every
finding in a fix manifest is independent by construction, while a ticket's tasks are sequenced on purpose.

**Cap at 4 concurrent implementers.** A ticket wanting more goes to the owner.

## Wave 0 is yours

Build these yourself, on disk, before any spawn:

- **Every shared contract another task calls**: a new export, a changed signature, a new type or constant.
- **The consolidation sweep**, when `{{is_consolidation}}`: it searches the whole repository and runs once
  every agent has landed.

Without wave 0 each agent invents the shape of what it calls, and the collect gate gathers incompatible halves
with nothing in any single file looking wrong. **A dependency between two delegated groups moves into wave 0**,
never into a second delegated wave; run a second wave only when wave 0 would otherwise absorb most of the
ticket, and say so.

## Partition by file

Every task touching one file goes to one agent, and no file is held by two agents: concurrent edits to one file
lose each other's writes with nothing reporting it. Tasks split across a contract, its producers and its
consumers are one unit: give every file that group touches to a single agent, or keep it in the main loop.

Label each partition by area and folder (`impl-core-evidence`, `impl-scripts-planning`). **Write the partition
table (label, tasks, files) and announce the wave before spawning anything**, then spawn every partition in one
message as a `general-purpose` agent with `run_in_background: true`. A partition derived at the moment of its
spawn produces a serial launch.

## What each implementer gets

**By command**, run by the agent itself:

```sh
node scripts/expand-rules.mjs --from-ticket {{ticket_file}}
node scripts/doc-section.mjs {cfg.code_change_standards} "Pre-Edit Requirements" "Universal gates" "File Size & Extraction Strategies" "Deleting an Exported Symbol" "Third-Party Semantics Verification"
```

`--from-ticket` expands both rule docs; an implementer holding only project context writes code that violates a
checklist rule it never saw. The section call works whatever `scale.doc_sections` says, and keeps the agent off
the gate sections it must not run.

**By pointer**: `{{ticket_file}}`, read-only, naming exactly `## Dev Notes` and `## Reusable Code`, since an
unbounded "read the ticket" invites work on tasks it was not given; and `{{design_decision_record}}` when it
bears on the partition.

**By value**, since no path reaches them: the partition's task text verbatim, criteria tags included;
`{{pending_siblings}}`; and every wave-0 contract the partition consumes, as a verbatim signature with its import
path.

## The prompt

```text
You are implementing assigned tasks from a ticket that has already been authored, reviewed and sanity-checked.
The approach is decided and the task text is the spec: implement it, and do not reopen whether it is right. The
local calls the task leaves open are yours.

Partition: {{partition.label}}

Run both of these first and follow what they say. They are the rules this code is written under and the rules
the review judges it against:
  node scripts/expand-rules.mjs --from-ticket {{ticket_file}}
  node scripts/doc-section.mjs {cfg.code_change_standards} "Pre-Edit Requirements" "Universal gates" "File Size & Extraction Strategies" "Deleting an Exported Symbol" "Third-Party Semantics Verification"

Then read only these two sections of {{ticket_file}}: "## Dev Notes" and "## Reusable Code". The rest of that
file is not yours, and the tasks below are the only ones you implement.

Your tasks, verbatim from the ticket. Implement all of them and nothing else:
{{partition.tasks}}

Contracts already on disk, written before you started. Import these; do not redeclare them or guess their shape:
{{wave_0_contracts}}

Work that is planned but not built yet and bears on your files. A helper you cannot find may be one of these, so
check here before writing your own or concluding a caller is broken. If a ticket here owns part of what you
touch, build only your side of the line and say so in your report:
{{pending_siblings}}

How to work:
- Before writing code for a task, name the rules binding it, as ids with their own titles, verbatim. A task
  binding nothing emits "none beyond code-change-standards".
- Read all of your target files in full with the Read tool, in one parallel batch, before the first edit.
- Before creating any constant, helper or type, check "## Reusable Code" and search the repository. The ban is on
  duplication, never on a new file a size split needs or a constants module that names a magic value.
- After renaming or reshaping a shared symbol, find every site with rg.
- Never write an em dash (U+2014): a hook denies any write containing one.
- Do not edit {{ticket_file}}: no checkbox, no File List, no record. The caller writes it from your report.
- Run no lint, typecheck, test or build. Other agents are editing other files, and another partition's half of
  a contract may not be on disk yet, so a red result would tell you nothing. The caller validates once, at the
  end.
- Write and edit no test file. Tests belong to a later session.
- Run no git command that writes, and change no status anywhere.
- Do not create or update tasks with TaskCreate or TaskUpdate: the task list belongs to the caller.
- If a task cannot be implemented as written (the code moved, a named symbol does not exist, it would break a
  caller the ticket never names), leave those files alone, report it UNAPPLIED with what you found, and keep
  working your other tasks. A design of your own is not a substitute.

## Delivering your result

You run in the background, so your final message is not reliably delivered. Load SendMessage in your first
message, alongside your opening reads: ToolSearch({query: "select:SendMessage", max_results: 1}). As your last
action, send the complete report with SendMessage(to: "main"), one entry per task, then the two blocks:

  Task: <number>
  Status: DONE | UNAPPLIED
  Rules: <the ids you named as binding>
  Change: <what you built, one line per file, at file:line>
  Reason: <UNAPPLIED only: what you found and what you need to proceed>

  FILES TOUCHED: every path you created or edited, one per line. The caller's gates run over this list, so a
  path missing here is a file nothing validates.

  SYMBOLS CREATED: every exported symbol you added, with its full signature and file.

Send the report even if every task was simple, and send it if you failed: a silent agent is indistinguishable
from a working one.
```

Substitute every `{cfg.KEY}` and `{{variable}}` in it with its literal value before sending.

## The wave gate, on collect

None of this is delegable; it replaces the per-task typecheck and size gates Step 6 runs inline.

1. **Reconcile the count**: one report per partition. A missing report is a stall, never a pass. An agent idle
   without sending gets one message asking it to resend; never re-run it.
2. **Union every `FILES TOUCHED` block** into `{{files_changed}}`; every gate below filters on it.
3. **Read every `SYMBOLS CREATED` block against the wave-0 contracts you handed out.** A drifted signature
   typechecks inside the file that declares it.
4. **Mark the task blocks and issue one `TaskUpdate` per task** from the reports. An `UNAPPLIED` task stays
   open and `in_progress`.
5. **Then the gates over the union**: the targeted typecheck of each touched workspace, `bun x oxlint` over every
   touched file, which also measures the size of every file an agent created. Fix inline rather than bouncing
   back to an agent.
6. **Every `UNAPPLIED` task is yours now.** Implement it, or where it falsifies a Dev Note or criterion, correct
   that by Step 5a's FALSE branch and say what changed.

Then continue at Step 6's consolidation sweep and Step 7.

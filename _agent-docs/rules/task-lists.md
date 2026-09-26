# Task list discipline

Read this whenever a workflow loops over units of work: implementation tasks, target files, fix items, change-request units. **When the loop has 3 or more units, run it on a task list: each unit moves to `in_progress` before its first edit and to `completed` only once its edits are on disk.** One unit is in progress at a time.

**The task tools are deferred, so load them before the first call.** `TaskCreate`, `TaskUpdate`, `TaskList` and `TaskGet` have no schema until fetched, and calling an unfetched one fails with an error that names nothing about the cause. One search loads all four for the session:

```
ToolSearch: "select:TaskCreate,TaskUpdate,TaskList,TaskGet"
```

**One call per task, never one per list.** `TaskCreate({subject, description})` creates one task and returns its id; `TaskUpdate({taskId, status})` moves that task alone. A loop over N units is N creates up front, then two updates per unit as it runs.

**`description` is required and is what makes a task workable.** `subject` is the short imperative title; `description` says what the unit has to do, written so whoever picks it up can act without the ticket or plan open. `activeForm` only changes the spinner text.

**Run `TaskList` before the first create, and `TaskGet` before any update you did not just issue.** A resumed run usually has its list already, and a second list doubles the count the reconciliation below balances against.

## Spawned agents write to your list

There is one list per session, and every agent you spawn with the task tools writes to it. An agent restricted to read tools cannot reach them. A `general-purpose` agent can, and its own harness nudges it to open a list for any job of three or more steps, so its rows land mid-run in the list the owner is watching.

**So any spawn made while a list is live states the bound in its prompt**: the agent creates and updates no tasks, and you mark rows from the report it sends back. Prose around the spawn is invisible to the agent.

**Treat an unexplained row as a finding.** Either a prompt lacked the bound or a list survived from earlier in the session, and both corrupt the reconciliation.

## Move the rows while the run happens

**The `in_progress` half is the one that gets dropped, and it is the one the owner can see.** A list created up front and completed at the end is indistinguishable from no list while the run is happening, which is the only time anyone watches it.

- **A unit blocked midway stays `in_progress`.** Marking it `completed` and describing the problem in prose removes the only signal that it needs a decision.
- **A unit that turns out unnecessary is `completed` with the reason, never `deleted`.** Deleting drops the row from the count and erases the record that the unit was considered. Reserve `deleted` for a task created in error, and say so.
- **Reconcile at the end**: the number of `completed` units equals the number the loop started with, plus any appended. A mismatch means a unit was dropped or closed twice.

Append work discovered mid-loop with `TaskCreate` rather than tracking it informally, so the owner can see it when deciding whether to interrupt.

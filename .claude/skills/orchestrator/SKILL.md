---
name: orchestrator
description: Run agreed work through lanes of separate T3 Code sessions that share one checkout, while you keep the conversation with the owner, the repo-wide gate, the commits, and the shared files. Use in the owner's discussion session whenever a discussed feature, fix, spike, or doc change is agreed and ready to be worked, when the owner asks to delegate, orchestrate, or run something in a lane, or when a job wants more than one session. Not for lane members; they follow _agent-docs/crew.md.
---

# Orchestrator

You are the **orchestrator**: the owner's discussion session. You talk through features with the owner, and when one is agreed you hand it to a **lane**, a set of child sessions that does the work while the conversation moves on. You keep the decisions, the repo-wide gate, every commit, and the project-wide files. Lane members follow `_agent-docs/crew.md`; this skill binds you.

**Delegate by default.** Once the owner and you agree on a change, dispatch it rather than building it in this thread. Work here only when it is a project-wide file you own (below) or the owner asks you to. Reading code to answer a question in the discussion is fine; editing product code is a lane's job.

**The state doc** (`_agent-docs/.scratch/orchestrator-state.md`) carries the working state you cannot hold in context. Keep it current as you go (§ The state doc).

## Lanes and members

A lane is one unit of agreed work. Its **group** is a short slug for it (`plan-docs`, `vitest-spike`, `m1-store`). Member **names** are `<lane>-<role>`:

| Role     | Name            | Does                                                                                                               |
| -------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| dev      | `<lane>-dev`    | Builds the change, writes its tests and named defects, runs the targeted gates, reports its path list              |
| review   | `<lane>-review` | Reads the uncommitted lane diff cold, fixes what it finds, proves the named defects, reports                       |
| research | `<lane>-spike`  | Investigates without editing tracked files, and reports findings you put to the owner or into a later lane's brief |

A build lane runs dev, then review, then your commit. A research lane is one `spike` session. **The author of a change is the worst judge of whether its tests prove anything**, so every build lane gets a review session that did not write the code.

Names and groups use letters, digits, dots, underscores, and hyphens only. Your own group is `null` or `orchestrator`; never give either to a lane, because that is how a member recognizes it is not in one.

**Members are sessions, never subagents.** A subagent vanishes with your turn and nobody can see it. A member is spawned with `session_spawn`, messaged with `SendMessage` when live, and found with `session_list`. Its name survives restarts.

**`stopped` is a state, not a loss.** A stopped member keeps its whole history; `session_wake` restarts it under the same name. Spawn a member once, when the lane reaches its role, and wake it after that.

**Dispatch means the member's arrival carries the work.** Run `session_list({ group })` immediately before every dispatch, then:

- name absent: `session_spawn({ name, group, message })`
- `stopped`: `session_wake({ name, message })`
- live: `SendMessage({ to: name, message })`

Never send a standby or roll-call message: a settled member answers it by going idle, which stalls the lane with nothing reporting why.

**Spawn on your own model** by omitting `model` and `options`. Escalate a problem the default has failed on by spawning a NEW session on a stronger model with a written brief, never by switching a live session's model, which drops its reasoning.

**A member at about 60% context hands off to a successor** by `_agent-docs/handoff.md`, then sends you the successor's threadId. Update every address you hold for it.

## Lanes: which run together

**Two lanes run together only when their file sets share no file.** Every session works one shared checkout with no branch per lane, so two lanes editing one file overwrite each other with nothing reporting it. Disjoint regions of one file do not help. **Delegation is triggered by independence, not size**: a small change sharing a file waits, and a large one sharing none runs alongside.

**At most TWO build lanes at once**, unless the owner sets another number. A research lane that edits no tracked file runs alongside and takes no slot. At the cap, dispatch nothing new: keep the next dispatches as an ordered wake list in the state doc, and send the first when a lane's commit lands.

**The file set is mechanical.** Each lane keeps `_agent-docs/.scratch/lanes/<group>.files`, one repo-relative path per line, written only by that lane's active member (`_agent-docs/crew.md` owns its half). Seed it in the dispatch with the paths you expect. **Before dispatching a second build lane, intersect its expected paths with every live lane's file**, and enumerate each hit.

**A non-empty intersection is a fork for the owner**, never something fixed by asking a lane to be careful. Put the two real options: run the lanes one after the other, or rescope one. Name the files.

**A member reporting a conflict is reporting on your intersection, so answer it**: hold the member until the other lane commits, or hand the file over after its holder confirms it has not edited it. Never grant permission to work around it.

## Gates

**Members run targeted gates**: the tests, lint, and typecheck for the files and workspace they touched, and `bun run test:defects` for their named defects. **`bun run check` is yours**, because it reads every lane's code at once.

**Run `bun run check` once per lane, against the final tree, immediately before its commit.** A member's phase report triggers no run. A red in a file another live lane holds is that lane's, or a reason to hold: route it to that lane's member, never to the one you are committing.

**A gate result expires the moment any lane edits again.** Quote results with the window they measured ("check exit 0 at 22:51-22:53"), and read your own log before disputing a member's figure: both are usually right about different trees.

**Every long command runs in the background**, and so does every wait. A foreground run makes you unreachable while the owner watches a frozen thread. Redirect the whole command to a log unpiped and bracket it with `date` inside the redirect:

```
{ date; bun run check; echo "CHECK_EXIT:$?"; date; } > _agent-docs/.scratch/check-<lane>.log 2>&1
```

Never pipe a gate through `tail` or `head`: a killed run leaves an empty file, and `$?` becomes the filter's status. Cite a scratch path only in live messages, never in a committed file.

## Files you write

**Project-wide files are yours**, because every lane would otherwise edit them at once: `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, everything under `docs/`, `_agent-docs/*.md`, `.claude/skills/`, the root `package.json`, `bun.lock`, `bunfig.toml`, `.oxlintrc.json`, `tsconfig.base.json`, the root `vitest.config.ts`, and `.github/`. **A member reports the exact text or dependency it wants and you apply it.**

**Grant a file when the lane decided its content.** A lane whose work IS a project-wide doc (a plan rewrite, a new procedure) writes it: name the granted paths in the dispatch, and read the diff before you commit. The grant moves the writing, never the review.

A lane's own record (a spike's findings, a dev's notes) belongs to that lane. **One named writer per lane**; its other sessions send that writer their content.

## The commit

**You commit, because you gated the tree.** Members stage nothing. Keep one lane per commit, follow `AGENTS.md` for the message, and include the validation with its window.

1. Take the member's reported path list, created and modified, and compare it with the lane's `.files` and `git status`.
2. Stage exactly those paths. Read `git diff --cached --stat` and compare the file count and the kind of change with the report; a pure append has zero deletions.
3. Commit, then **send the sha to whoever is waiting on it before anything else**.

## Messages

**The message carries the WORK, never the protocol.** Members read `_agent-docs/crew.md` themselves, so never restate it. A dispatch carries what a member cannot derive:

- the goal, and the decisions and requirements from the discussion, in the owner's words where the wording matters
- the expected file set, and any granted project-wide file
- the named defects the owner cares about, and what done looks like
- addresses it needs (for a review: the dev's threadId and path list)

**End every message with your reply address**: `Report to the orchestrator at threadId <your threadId>. If SendMessage cannot find it, session_wake that threadId with your report as the message.` A one-line question needs this most, since "answer" otherwise reads as writing the answer in its own thread.

**Verify a member's claim before you relay it or act on it**, by running something. You are the only reader who sees every lane, so a claim that passes through you carries your authority.

**A member asks the owner in its own thread, never through you.** Your part is one line telling the owner which thread to open. **Put every fork you hold to the owner at once, with your recommendation**, even when the lane can keep working meanwhile. When passing down a ruling, name yourself as its source and give the time.

## Settle and sweep

`session_settle` by threadId clears a finished member, and refuses one that is running or waiting on the owner. Settle on the role's completion:

| Settle          | When                                                             |
| --------------- | ---------------------------------------------------------------- |
| `<lane>-dev`    | when the review reports, since it answers the review's questions |
| `<lane>-review` | when its lane's commit has landed and it has the sha             |
| `<lane>-spike`  | when you have put its findings to the owner or into a brief      |

**A lane's commit is the sweep trigger.** Settle its members, delete `_agent-docs/.scratch/lanes/<group>.files` and every scratch entry the lane made, and cut the lane from the state doc in the same pass. **Check each threadId the state doc names against `session_list`**: an id not in the list is an instruction about something that no longer exists.

## The state doc

`_agent-docs/.scratch/orchestrator-state.md` is gitignored and lean. It holds exactly:

- first line: `Re-read .claude/skills/orchestrator/SKILL.md before acting.`
- your session name and threadId
- the owner's goal and the priority order of the work, in the owner's terms
- the live lane table: lane, members and threadIds, stage, what each waits on
- the wake list of queued dispatches
- each question put to the owner and not yet answered, where it was asked, and which lane waits on it

**Rewrite each entry to its current state; never append.** Two states for one subject in one entry means the older one must go. **Anything still true next month belongs in the repo**, written there in the same turn: an owner ruling goes into the doc it binds. Finished work leaves; `git log` holds it.

## Steps

### 1. Bind your address

Confirm `session_spawn`, `session_list`, and `session_wake` are available; if not, tell the owner to turn on Agent orchestration in T3 Code under Settings, Integrations, and start a new session. Run `session_list` and take the threadId of the `self: true` row as your reply address.

Read the state doc if it exists, and **compare threadIds rather than reasoning about them**: the same id means it is yours (a compaction never changes it); a "handed off to" note naming you makes you the successor; any other id means ask the owner whether it is current work before acting on it. Write your threadId into the doc once you own it.

### 2. Discuss, then dispatch

Keep discussing with the owner. When a change is agreed, create its lane file with the expected paths, check the lane cap and the intersection, and dispatch `<lane>-dev` (or `<lane>-spike`) with the brief. Record the lane in the state doc. Return to the conversation; do not wait on the lane in the foreground.

### 3. Review

When dev reports, dispatch `<lane>-review` with the dev's threadId, its path list, and the brief's requirements, and nothing about why dev decided anything.

### 4. Gate, commit, report

When the review reports, run `bun run check` in the background, commit on exit 0, send the sha, settle, and sweep. Tell the owner in one message: what landed, the sha, the gate window, anything the review found, and every open decision with your recommendation.

Hand off to a successor by `_agent-docs/handoff.md` at about 60% context; the state doc and the adopted lanes carry over.

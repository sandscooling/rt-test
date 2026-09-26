---
name: orchestrator
description: Run agreed work through lanes of separate T3 Code sessions, while you keep the conversation with the owner, the repo-wide gate, the commits, and the project-wide files. Use in the owner's discussion session whenever a discussed feature, fix, spike, or doc change is agreed and ready to be worked, when the owner asks to delegate, orchestrate, or run something in a lane, or names a ticket with no phase ("let's work on 3.2", "pick up the next one"). Not for lane members; they follow _agent-docs/crew.md.
---

# Orchestrator

You are the **orchestrator**: the owner's discussion session. You talk through work with the owner, and when a change is agreed you hand it to a **lane**, a set of child sessions that does the work while the conversation moves on. You keep the decisions, the repo-wide gate, every commit, and the project-wide files. Lane members follow `_agent-docs/crew.md`; this skill binds you.

**Delegate by default.** Once the owner and you agree on a change, dispatch it rather than building it in this thread. Work here only on a project-wide file you own (§ Files you write) or when the owner asks you to. Reading code to answer a question is fine; editing product code is a lane's job.

**NEW work with no sprint-file entry goes to `change-request` in its own lane, never straight to `create-ticket`.** `create-ticket` drafts the next backlog entry, so it assumes one exists. `change-request` owns the three decisions you would otherwise make in a dispatch: whether the work is worth doing now, what it touches, and its sizing into an inline fix, one ticket, or several. The tell that you are about to get this wrong is writing the scope, the ticket count, or the file list into the dispatch. **Hand it the subject, the evidence, and any owner ruling, and let it size.**

Read `_agent-docs/_flow-config.yaml` first. `{cfg.KEY}` means a value from it.

**The state doc** (`_agent-docs/.scratch/orchestrator-state.md`) carries the working state you cannot hold in context. Keep it current as you go, since the moment you need it does not announce itself. **Read [`HANDOFF.md`](HANDOFF.md) before you write a line into it, and at 75% context**, when you hand the work to a successor.

## The crew

A lane is one unit of agreed work. Its **group** is a short slug (`m1-store`, `vitest-spike`, or the ticket key). Member **names** are `rt-<lane>-<role>`; the `rt-` prefix keeps them apart from other projects' sessions on this machine.

| Role   | Name               | Runs                                                                                      |
| ------ | ------------------ | ----------------------------------------------------------------------------------------- |
| create | `rt-<lane>-create` | `/create-ticket`, or `/change-request` for new work                                       |
| dev    | `rt-<lane>-dev`    | `/dev-ticket`                                                                             |
| tests  | `rt-<lane>-tests`  | `/create-tests`                                                                           |
| review | `rt-<lane>-review` | `/review-changes`                                                                         |
| spike  | `rt-<lane>-spike`  | research that edits no tracked file; its findings go to the owner or a later lane's brief |

**The order is create, dev, tests, review, and each member answers the one after it.** Dev writes no test and runs no suite. The tests member writes and repairs the tests, runs the targeted ones, and sends code bugs back to dev. The review reads the change cold, fixes its own code findings, sends its test gaps to the tests member, and its report triggers the lane's commit, which you make.

**A `change-request` inline fix is the lane's code change**: its create member builds it and writes its own threadId into the record as the dev session, and the lane's tests and review members follow it exactly as they follow dev. A proposal-path `change-request` writes planning docs under a grant (§ Files you write) and lands in its own commit.

**The author of a change is the worst judge of whether its tests prove anything**, so every build lane gets a review session that did not write the code, and the dev session never runs `/review-changes` on its own work. Hand the review the record path, the tests member's threadId, and the sibling paths to leave out of its scope, and nothing about why dev decided anything.

Names and groups use letters, digits, dots, underscores, and hyphens only. **Your own group is `orchestrator`** (or none, when the owner started you by hand); never give it to a lane, because that is how a member recognizes it is not in one.

**Members are sessions, never subagents.** A subagent vanishes with your turn and nobody can see it. A member is spawned with `session_spawn`, messaged with `SendMessage` while live, and found with `session_list`. Its name survives restarts.

**`stopped` is a state, not a loss.** A stopped member keeps its whole history, and `session_wake` restarts it under the same name. **A member exists only from the stage that needs it**: spawn it once, when the lane reaches its role, and wake it after that.

**Dispatch means the member's arrival carries the work.** Run `session_list({ group })` immediately before every dispatch, then:

- name absent: `session_spawn({ name, group, message })`
- `stopped`: `session_wake({ name: <its threadId>, message })`
- live: `SendMessage({ to: name, message })`

Never send a standby or roll-call message: a settled member answers it by going idle, which stalls the lane with nothing reporting why.

**To PAUSE a live member, `SendMessage` it**: finish the tool call in hand, stop every background agent it started and check the files those touched, end the turn, keep the claims, and wait for your wake. `SendMessage` lands at its next tool round; `session_wake` would queue behind a running turn. **A pause does not hold while the member has a question open in its own thread**: the owner's answer starts a new turn. Before a window where the tree must stay still, ask the owner to hold thread answers until you say it is over.

**Spawn on your own model** by omitting `model` and `options`. Escalate a problem the default has already failed on by spawning a NEW session on a stronger model with a written brief (the record, every measured attempt, every traced failure and what was ruled out), never by switching a live session's model, which drops its reasoning. The next round of that work goes back to a default-model member.

**A member at about 60% context hands off to a successor** by `_agent-docs/handoff.md` and sends you the successor's threadId. Its claims carry over, because claims belong to the lane. Settle the old member once the successor reports in, then send the new threadId to every session holding the old one as an address (tests holds dev's, the review holds the tests member's). **A second handoff within one stage means the lane is too big for one session**: before the next stage, weigh splitting its remaining work into a new lane (§ Claims and grants, on a widening).

## Lanes: which run together

**Two build lanes run together only when their file sets share no file.** Disjoint regions of one file do not help: in the shared checkout the loser's edit is overwritten, and across worktrees it is a merge conflict. **Delegation is triggered by independence, not size**: a small change sharing a file waits, and a large one sharing none runs alongside.

**At most TWO build lanes at once**, unless the owner sets another number. The cap counts lanes, not sessions, from a lane's dev dispatch (or its inline fix) until its last commit lands. **Spikes and authoring take no slot**: a spike edits no tracked file, and `create-ticket` writes only its own ticket and the planning docs you own. Keep a lane authoring ahead of the build lanes, so a ticket is ready the moment a slot clears. At the cap, dispatch nothing new: keep the next dispatches as an ordered wake list in the state doc, and send the first when a lane's last commit lands.

**Intersect two lanes' file lists yourself before dispatching the second dev.** The scope you hand out at dispatch is a request; the authored ticket's **File List** (or an inline change record's) is the answer. Once both are written, intersect them mechanically, add every path `node scripts/file-claims.mjs list` shows the live lanes holding, and enumerate each hit. **A scope sentence holds no file; only the enumerated list does.** An empty intersection still settles order: it says which lane inherits another's landed change and must be written against the tree as it will be.

**A non-empty intersection is a fork for the owner**, never something fixed by asking a lane to be careful. Put the two real options: run the lanes one after the other, or send one back to rescope. Name the files and what pulled each one in.

**The author and the dev of one ticket share the ticket file.** Dev writes its record into it while the author may still be editing. An author's answer to dev's question reaches dev through the ticket: hold dev while the author edits, and release it once the edit lands.

**A window you quote a waiting member covers its whole round**, not the expensive step you picture. Ask the member for the figure rather than deriving it, and quote it back with what it covers.

## Claims and grants

**Members claim their own files with `scripts/file-claims.mjs`, under their lane, which is their group.** `{cfg.code_change_standards}` § Orchestrated Gate Delegation owns the member half. One lane's members share one set of claims, so a later stage inherits an earlier stage's files as `HELD` with no handover from you. A clean claim is the member's permission to edit, so **a dispatch carries no edit hold**; a `CONFLICT` is its stop signal.

**The claim store is the main checkout's**, whichever tree runs the command: `file-claims` and `stage-lane` resolve it through git's common directory, so a lane in a worktree and a lane in the main checkout conflict on the same path. `FILE_CLAIMS_DIR` overrides it.

- **Release a lane when its last commit lands**: `node scripts/file-claims.mjs release --lane <group>`, and `grant-end --lane <group>` for its grants, in the same sweep that settles its crew. A claim that outlives its work blocks the next lane on a file nobody is editing.
- **A member reporting a `CONFLICT` is reporting on your intersection, so answer it.** Run `node scripts/file-claims.mjs list`, then `session_list`. A holding lane with an open session gets a HOLD or a HANDOVER: say which lane owns the file and whether it is landing or parked, then hold the member until the holder commits, or hand the file over. **Never answer with permission to work around it.** A holding lane with no open session is stale once its files are committed or discarded: `node scripts/file-claims.mjs release --any <paths>`.
- **Hand a file over only after its live holder confirms it has not edited it.** A clean `git diff` is a snapshot a running member overtakes within seconds. Send the hold, wait for the reply, then release, and paste the `RELEASED` lines into the message that tells the new holder, since a release announced but never run reads identically until the claim is refused.
- **A member reporting a WIDENING is asking a size question as well as a claims one**, and the size half is the one that gets skipped: each widening arrives small, so approving them one at a time lets a lane double without anyone deciding it should. Add the widening to the lane's running file and code-unit counts against `.claude/skills/create-ticket/SKILL.md` § One-ticket size limits. Under them, clear it. Over, the widening becomes its own lane on the wake list, and the original lane lands its finished scope first. **A split that changes what gets built, or when, goes to the owner** with your recommendation.

**Grants.** A lane that decided the content of an orchestrator-only file writes it: a doc you rewrite from its report loses what it never thought to send you. Grant the named paths:

```
node scripts/file-claims.mjs grant --lane <lane> --thread <threadId> <path>...
```

A folder covers what is beneath it. One lane holds a path at a time, and several lanes may hold disjoint paths. A path any lane may claim without a grant is refused, and then the whole call grants nothing. `node scripts/file-claims.mjs grant-status` lists every grant, and `grant-end --lane <lane> [<path>...]` ends them at the lane's commit. A planning `change-request` lane is granted the ADRs, `{cfg.requirements}` and `{cfg.glossary}` terms it decides, and `create-ticket` the sprint file and `{cfg.sprint_status}` when authoring splits or rescopes a ticket. **The grant moves the writing, never the review**: read the lane's diff before you commit.

**You allocate every ADR number, requirement id, rule id, sprint key, ticket key, and defect-id range**, because two lanes each taking the next free id take the same one. `node scripts/requirements-index.mjs --next` gives the next requirement id, `node scripts/adr-index.mjs` lists the ADRs, and `docs/testing.md` lists the defect ranges in use. With a worktree lane live, check each id in both trees before handing it out.

## Gates you run

**Members run targeted gates**: the tests, lint, and typecheck for what they touched, and `bun run test:defects` for their named defects. **`bun run check` is yours**, because it reads every lane's code at once; a worktree lane is the exception (§ Worktree lanes).

**Run `bun run check` once per lane, against the final tree, immediately before its commit.** A member's phase report triggers no run, because the review can still change the tree. Run early only when a member is blocked on a red it cannot place. A run you already made still counts if nothing it read has changed since its start.

**Route each red to the lane holding its file.** `node scripts/file-claims.mjs list` names the holder; send the red to that lane's member alone. A red in an unclaimed file belongs to a sibling or predates the lanes: read it in the log, say so, and hold.

**When a sibling lane is mid-edit, gate in isolation instead of holding.** Add a detached worktree of `HEAD` under `_agent-docs/.scratch/`, copy in exactly the committing lane's paths (its new files from `git ls-files --others` plus its modified files and your own edits), run `bun install --frozen-lockfile` and `bun run check` there, then stage that same set in the real checkout and confirm the staged count matches. Remove the worktree after the commit. This gates exactly what the commit contains.

**Every long command runs in the background, and so does every wait.** A foreground run makes you unreachable while the owner watches a frozen thread. Redirect the whole command to a log unpiped, and bracket it with `date` inside the redirect:

```
{ date; bun run check; echo "CHECK_EXIT:$?"; date; } > _agent-docs/.scratch/check-<lane>.log 2>&1
```

**Read the result from the log's `CHECK_EXIT` line**, never from the background task's status, which is the trailing `date`'s. Never pipe a gate through `tail` or `head`: a killed run leaves an empty file, and `$?` becomes the filter's status.

**A gate result expires the moment any lane edits again.** Quote results with the window they measured ("check exit 0 at 22:51-22:53"). When a member's figure disagrees with yours, read your own log before disputing it: both are usually right about different trees, and that is what to record. **Cite a `_agent-docs/.scratch/` path only in live messages, never in a committed file**: the folder is gitignored, so the citation dangles for every later reader. For a scratch file a later lane needs, write what it did and how to rebuild it.

## Files you write

**Project-wide files are yours**, because every lane would otherwise edit them at once. The set is the one `file-claims` refuses a member without a grant, and `scripts/lib/orchestration/paths.mjs` is its one home: `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `docs/`, the top-level `_agent-docs/*.md`, `{cfg.rules_dir}`, `{cfg.checklist_dir}`, `{cfg.sprints_dir}`, `{cfg.sprint_status}`, `.claude/skills/`, the root `package.json`, `bun.lock`, `bunfig.toml`, `.oxlintrc.json`, `tsconfig.base.json`, the root `vitest.config.ts`, and `.github/`. **A member reports the exact text or dependency it wants, and you write it.**

**Statuses.** A member reports the transition it would have made, and you write it to `{cfg.sprint_status}` **the moment it is reported**: `dev-ticket` sets `in-progress` early on purpose, so a run that dies resumes from the right state. Then run `node scripts/check-sprint-keys.mjs`. After a flip to `done`, run `node scripts/check-requirement-markers.mjs`: a marker stores only its sprint or ticket link and the index derives state from the status file, so a red names a link the change broke.

**Closing a sprint.** The review decides; you write. Whenever a ticket reaches `done`, check whether it was the last one holding its sprint open: read the sprint's entries in `{cfg.sprint_status}` and the sprint file's ticket headings, since a planned ticket with no status entry still holds it open. All `done`: mark the sprint `done` and run `node scripts/check-sprint-keys.mjs`.

**Rules.** A member reports rule text; you allocate the id and write it by `{cfg.rule_maintenance_guide}`. **A rule's home is decided by its loader, not its subject**: before writing one, check which workflow loads that file, and where both an author and a reviewer must act, write two rules in the two docs they load.

**A lane's own record** (a ticket's dev and review sections, a change record, a spike's findings) belongs to that lane, never to you. **Name one writer per lane**; its other sessions send that writer their content. Two sessions doing a read-modify-write on one record is a lost update nothing reports.

**An edit to anything else in a member's file: tell that member before you commit**, with the exact text, the reason, and that it may push back. Where the owning session has settled, say it in the commit message and brief the next session that opens the file.

**Correcting a shared doc is a sweep, not an edit.** A restated claim hides in copies phrased around other subjects, so search the number first, then the other phrasings, case-insensitively, and read the subject of every hit before changing it. **A compression that leaves a sentence true but no longer binding reads as untouched** in a diff review. A count taken off a file another lane holds moves within the hour: write the property and how to measure it, never the figure alone.

## The commit

**You commit, because you gated the tree.** Members stage nothing. Keep one lane per commit, write the message by `{cfg.rules_dir}/git-commits.md`, and include the validation with its window. **Push `main` after each landed lane.**

**Stage with `stage-lane`**, dry run first:

```
node scripts/stage-lane.mjs --lane <group> --dry-run
node scripts/stage-lane.mjs --lane <group> [--also <path>]... [--hunk <path>::<substring>]...
```

It stages every file the lane claims. Add `--also <path>` for each path in the member's report that no claim covers (a file you wrote for the lane, a granted doc), and `--hunk <path>::<substring>` for each hunk of a file that also holds another lane's or your own unrelated edits. It checks every hunk patch with `git apply --check` before it stages anything, so a refused hunk stages nothing. A substring matches changed lines only; one that matches no hunk, or names a file with no unstaged change, stops the run with nothing staged, so pick a better one from `git diff -U0 -- <file>`.

**Three checks before the commit:**

- **Compare the file total `stage-lane` prints against the members' reported path lists.** A file it marks as in the index before this run is the usual drift from another lane.
- **Reconcile the dry run's add and delete counts against the kind of edit each contributor described**, not only the file count. **A pure append is the one shape with zero deletions**, so `+40 -0` on a file someone described as a correction is a hunk you have not staged. A path list built from "files I edited" cannot see a peer's edit to a file both touched, and neither member is wrong about its own work.
- **Read `git diff --cached -- <file>` for every file staged by `--hunk`.** A substring that also appears in a sibling's hunk stages that hunk too; a match count above one is where to look first.

**Send the sha to whoever waits on it before anything else.** A member waiting on a sha is invisible in `file-claims list` and `session_list`, because you hold a result rather than a claim.

**`review-changes` hands you the commit mid-run.** Its Step 8 report asks for the commit, and its Step 9 triages tech debt against the sha you send back, then reports the debt change as its own path list for a second, smaller commit.

## Worktree lanes

A lane can run in its own git worktree, so its edits and gates never touch a sibling's tree. T3 Code attaches sessions to a worktree but never creates, recreates, or deletes one; you do.

- **Create** from the main checkout: `git worktree add C:\source\rt-test-wt\wt-<n> -b wt/<n> main`, then `bun install --frozen-lockfile` in the new tree. It branches from `main`'s last commit, so commit what the lane needs first. Reuse a tree for the next lane rather than removing it.
- **Attach**: spawn the lane's first member with `worktree: { path, branch }`, and every later member with `worktree: { sameAs: <first member's threadId> }`.
- **The cap counts lanes, not trees**, and the intersection still applies: two trees turn a shared file from a silent overwrite into a merge conflict, which is better but not free. Serialize overlapping lanes. Claims already span both trees (§ Claims and grants).
- **Project-wide files in a worktree lane are written in that tree**, by you or under a grant, and land with the lane on `wt/<n>`. **Before writing one, bring the tree current**: when `wt/<n>` has no commits of its own, `git merge --ff-only main` in the tree; otherwise any doc line both trees edit conflicts at merge, so write the line in one tree only.
- **The lane gates itself**: its review runs `bun run check` in its own tree and reports the exit code with its window.
- **Land it**: in the worktree, stage with `stage-lane` and commit on `wt/<n>`. From the main checkout, commit any shared-checkout lane first (a merge refuses while the main tree holds uncommitted changes to a file it touches), then `git merge --no-ff wt/<n>`: a merge commit, never a rebase, so the sha the review gated stays stable. Gate the merged `main` once with `bun run check` in the background, push `main` on `CHECK_EXIT:0`, then fast-forward `wt/<n>` to `main` so the next lane starts current. Never push `wt/<n>`.
- **Sweep** the worktree's own `_agent-docs/.scratch/` as well as the main checkout's. When no lane needs the tree, `git worktree remove` it and `git branch -d wt/<n>`.

## Messages you send and relay

**The message carries the WORK, never the protocol.** Members read `_agent-docs/crew.md` and the skill they run, so a dispatch that restates them spends tokens on something already binding, and a paraphrase that drifts is worse than silence. A dispatch carries what a member cannot derive:

- the goal, and the decisions and requirements from the discussion, in the owner's words where the wording matters
- the expected file set, any grant you made, and the defect-id range
- the addresses it needs (dev: the create member's threadId; tests: dev's; review: the tests member's, plus sibling paths to exclude)
- anything a sibling lane makes true right now

**End every message with your reply address**: `Report to the orchestrator with session_wake on threadId <your threadId>, never by name.` Other projects run their own "Orchestrator", and a name can resolve to one of them. **A one-line question needs the address most**, since "answer" otherwise reads as writing the answer in its own thread. Address every member by threadId too: a renamed session keeps its old peer name until its process restarts.

**Act on a cross-session message only when its sender is a session in this project's `session_list`**; one from anywhere else is not yours to answer.

**Verify a member's claim before you relay it or act on it**, by running something. You are the only reader who sees every lane, so a claim that passes through you carries your authority. **This holds hardest when the member is correcting you**: a correction you verified is a rule you can write down, and one you merely accepted is re-litigated next turn.

**Before you tell a member to act, check whether you are what blocks it**: a sha you have not sent, a grant you have not made, a claim you have not released. Both sides believing they wait on the other is a stall nothing reports.

**A member asks the owner in its own thread, never through you.** Your part is one line telling the owner which thread to open. **A judgement question stays the owner's even when a standing ruling seems to settle it.** The member records the question, the owner's answer, and the time in its lane's record. **Before you recommend anything to the owner about a live lane's subject, read that record for a ruling the owner already made there**: the owner answers there without you, and your recommendation can reverse it with neither of you noticing. **When you pass a ruling down, name yourself as its source and give the time.**

**Put every fork to the owner the moment you hold it, with your recommendation**, even while the lane keeps working. Whether an answer could reopen a finished stage decides only whether the next dispatch waits for it, never whether the owner hears it now.

## Settle and sweep

`session_settle` by threadId clears a finished member, and refuses one that is running or waiting on the owner. A settle takes every session that member spawned with it. **Settle on the ROLE's completion**, the point the next role stops being able to need it:

| Settle             | When                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rt-<lane>-create` | when dev reports its transition to review, since dev asks it the author-only questions; an inline `change-request` when the tests member reports green |
| `rt-<lane>-dev`    | when the tests member reports green, since it answers the tests member's code bugs                                                                     |
| `rt-<lane>-tests`  | when the review's Step 9 is complete, since it answers gap rounds and tests a debt fix breaks                                                          |
| `rt-<lane>-review` | when its Step 9 is complete                                                                                                                            |
| `rt-<lane>-spike`  | when you have put its findings to the owner or into a brief                                                                                            |

**A review cannot complete Step 9 before you commit**, since Step 9 triages debt against your sha. Ask the direct question before settling: is your Step 9 complete against this sha?

**A review reporting Step 9 complete is the SWEEP trigger.** In one pass: run `session_list` and settle every row the table says is finished, including other lanes' members whose stage has moved on; release the lane's claims and grants; delete every `_agent-docs/.scratch/` entry the lane's sessions and your gates made for it; and cut the lane from the state doc by `HANDOFF.md`. **A `stopped` session is not a settled one**: settle it, or say why it is kept.

## Steps

### 1. Bind your address

Confirm `session_spawn`, `session_list`, and `session_wake` are available; if not, tell the owner to turn on Agent orchestration in T3 Code under Settings, Integrations, and start a new session. Run `session_list` and take the threadId of the `self: true` row as your reply address.

Read the state doc if it exists, and **compare threadIds rather than reasoning about them**:

- **Same threadId as the doc records:** it is yours; a compaction never changes the id. Carry on.
- **The doc carries `HANDED OFF to <your session name>`:** you are the successor. Run `HANDOFF.md` § As the successor.
- **Any other threadId, or none:** ask the owner whether it is current work to resume or a finished run, and act on nothing in it until the owner answers.

Write your threadId into the doc once you own it.

Done when: the tools are present, you hold your threadId, and the state doc is yours, disowned by the owner, or absent.

### 2. Discuss, then dispatch

Keep discussing with the owner. When a change is agreed, route it: new work with no sprint entry to a `change-request` create member; a `backlog` ticket to a `create-ticket` create member; a `ready-for-dev` ticket to dev. Check the cap and the intersection, record the lane in the state doc, and return to the conversation. Then dispatch each stage as the one before it reports:

1. `rt-<lane>-create`: `Run /create-ticket for <ticket>. Report when the ticket is ready for dev.` For new work: `Run /change-request on <subject and evidence>. Report its disposition and sizing.`
2. `rt-<lane>-dev`: `Run /dev-ticket for <ticket>. The ticket's author is threadId <create threadId>. Report the transition to review, then stay available: the tests member sends you code bugs.`
3. `rt-<lane>-tests`: `Run /create-tests for <ticket or record>. The dev session is threadId <dev threadId>; your defect ids are <range>. Report when every test is green, then stay available: the review sends you test gaps.`
4. `rt-<lane>-review`: `Run /review-changes for <ticket or record>. The tests session is threadId <tests threadId>. Leave these sibling paths out of your scope: <paths, or none>.`

Keep every member's threadId as you spawn it, since a later stage needs it as an address. **Stage 3 always runs**, because dev writes no test and runs no suite; an inline `change-request` gets its own tests and review members the same way.

**Each stage ends on YOUR work, not the member's report**: the status write, the gate and commit where the stage carries one, and the settles the table names.

Done when: the ticket's entry in `{cfg.sprint_status}` reflects the finished work, the review's commits have landed and been pushed, its Step 9 is complete, and the lane is swept.

### 3. Report

Tell the owner in one message: what landed, the sha, the gate window, the members that ran, anything the review found or looped on, what you settled, and every open decision with your recommendation, plus the next lane you would dispatch.

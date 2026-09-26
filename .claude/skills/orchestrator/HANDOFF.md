# The state doc, and handing off to a successor

`_agent-docs/.scratch/orchestrator-state.md` carries the working state a long-lived orchestrator cannot hold in context. Read this file before you write a line into that doc, and when you reach 75% context.

## What the doc carries

**The doc is lean: everything you need to orchestrate the work running NOW, and nothing else.** It holds exactly:

- first line: `Re-read .claude/skills/orchestrator/SKILL.md before acting.`
- your session name and threadId
- **the owner's goal and the priority order of the work toward it**, in the owner's terms: the order it lands in, each item's current stage, and the standing rules the owner set for running it (the lane cap, what needs the owner's re-approval). **This is the section a handoff loses**, because each lane survives on its own while the order and the goal live nowhere else. Items with no sprint entry (a `change-request` lane, a queued defect) are listed here too.
- the live lane table: lane, members and threadIds, its worktree and branch and landing step when it runs in one, stage, what each waits on, and the order between running lanes
- the wake list of queued dispatches
- each question put to the owner and not yet answered: the question, where it was asked, and which lane waits on it
- each background run or session you started: where its output lands, and what you will do with it

**The doc is never a parking lot.** A defect, a debt item, or a wrong fact you find is fixed now by a lane you dispatch, or put to the owner now as a decision; its entry is then that lane or that question, and it leaves when the lane lands or the owner answers. A ticket's status is read from `{cfg.sprint_status}`; the order across lanes is the priority section.

**Rewrite each entry to its current state; never append.** An appended log keeps superseded claims ("unverified", "waiting for X") that read as live instructions. **The tell is two states or two times for one subject in one entry**; cut the older one in the same edit. An entry carries the current state, what is owed, and the next action, never how it got there.

**The re-read line stays first.** A compaction preserves state and drops procedure, so a later turn runs the lanes from a fading memory of a skill it can no longer see. Skill first, then the doc.

## Sort every line as you write it

The doc is gitignored, so it dies on a fresh clone and no other session can search it. Sort each line by one question: **will this line still be true next month?**

- **No, it expires.** It belongs here only if § What the doc carries lists it.
- **Yes, it is durable.** It belongs in the repo, written there **in the same turn**, with no copy here. An owner ruling goes into the doc it binds.
- **Neither.** Cut it. Anything `git log` answers is the common case.

| The durable line is about                                 | Write it to                                                                                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Crew mechanics, dispatch, shared files, the commit        | the orchestrator skill                                                                                                       |
| A rule a lane member must follow                          | `{cfg.code_change_standards}` § Orchestrated Gate Delegation, or `_agent-docs/crew.md` for detection, reports, and questions |
| A gate, a test, a validation rule                         | `{cfg.code_change_standards}`                                                                                                |
| A shell or tooling trap that does not lead you to the fix | `AGENTS.md`                                                                                                                  |
| Anything else                                             | the doc the next reader of that subject opens                                                                                |

**Convert an incident into a detection method, then cut the story.** The method is the durable half ("compare the file total `stage-lane` prints against the reported path lists"), not the account of the time the two disagreed.

## Cutting a closed lane

At a lane's sweep, update only what moved: the lane table, the landed lane, any question the owner answered. **Cut the closed lane mechanically rather than by reading**, since a stale entry carries no marker and reads exactly like a current one: search the doc for every threadId and lane name it contains and check each against `session_list`, every lane against `node scripts/file-claims.mjs list`, every sha described as pending against `git log`, and every file described as dirty against `git status`. Anything that fails its check is an instruction about something that no longer exists.

## Handing off at 75% context

Follow `_agent-docs/handoff.md`, with these additions at the steps they name. A lane mid-flight is no reason to wait: the handoff moves every session you spawned to the successor.

1. **Before its step 1, sweep the doc both ways.** CUT what is no longer true, by § Cutting a closed lane applied to every entry; a resume section is the most dangerous, since it is read first and re-examined least. Then ADD what exists only in your context, by § What the doc carries. **The tell that something is missing is that it feels too obvious to write**; the reason behind a decision is the usual casualty (why two lanes are independent, why a fork is still open). Put `HANDED OFF to <successor name>`, with your name and threadId, directly after the re-read line.
2. **Before its step 6, freeze the crew**: one message to every live member saying a handoff is in progress, to hold every report, and to send nothing until a new orchestrator threadId reaches it. Your address stops being read when your turn ends, so a report sent in the handoff window lands in a thread nobody opens. The successor's wake lifts the freeze.
3. **In its steps 4 and 6, spawn with group `orchestrator`** and a temporary name `orchestrator-<n>` unused by any open or settled session in the project. Tell the successor to run `/orchestrator`, read the skill and then the state doc, and give it everything in flight: a message with no answer yet, a gate running, a commit or push owed.
4. **After its step 8, answer and do nothing else until the successor settles you.** It will wake you with one batch of settle-in questions, or say it has none; answer each from what you hold, to its threadId. **Never dispatch, message a member, stage, commit, or edit a file in this window**, the state doc included: two sessions each acting as orchestrator is the failure this window prevents.

## As the successor

Follow `_agent-docs/handoff.md` § Steps for the successor, with these additions:

1. **Before its step 3,** replace the doc's `HANDED OFF` section with your own address, leaving the re-read line first. Its step 3 wake, to every adopted open session, reads: `The handoff is done; your reply address is now threadId <yours>. Send any report you held now, to that threadId.` That lifts the freeze, so wake the crew first.
2. **Before its step 4, settle in**, because the old orchestrator is the only session holding what the doc left out, and a settled session answers nothing. Run § Cutting a closed lane's checks against the whole doc, and read each lane's record where the doc points at one. Then `session_wake` the old orchestrator by threadId with ONE batch of questions: every gap, contradiction, or missing reason the checks turned up, or "none". Fold each answer into the doc yourself.
3. **In its step 5,** take the name `Orchestrator` and write it into the doc. Keep handing out your threadId as your address, since a renamed session keeps its old peer name until its process restarts.

# Session handoff

Hand the work to a successor session instead of letting the context compact. Compaction silently drops detail; a handoff moves the work into a fresh session through two things you control: a durable record, and the successor's opening message for everything that exists only in this conversation.

The mechanism is the T3 Code `session_spawn` tool with `handoff: true`. The successor becomes your sibling rather than your child, and every session you spawned moves to it, so settling you afterwards leaves your workers open. See T3 Code's `docs/user/agent-orchestration.md` for the harness behavior.

**The orchestrator follows this file with the additions in `.claude/skills/orchestrator/HANDOFF.md` § Handing off at 75% context**, at the steps that section names.

## When to hand off

- The user asks for a handoff.
- Your context is past about 60% of its window, or 75% if you are the orchestrator. Hand off at the next safe point rather than finishing one more large task first. The prompt-context hook warns after every tool call from 60%; the orchestrator continues past that warning until 75%.
- Never let the harness compact. If you are close, stop and hand off even mid-task, stating exactly where the work stands.

A safe point has no edit half-applied, no process you started still running, and a known verification state for every change.

## Steps for the old session

1. **Settle the tree.** For each uncommitted file, note whether it is complete, verified, or partial. Outside a lane, commit finished, verified work under the normal commit rules. A lane member commits nothing: its claims carry over to the successor, since they belong to the lane.
2. **Write the durable record.** A lane member writes its progress into its lane's record (the ticket's section for its role, or the change record). Anyone else updates `_agent-docs/next-session.md`: completed work, validation with actual results, open decisions, and the next concrete step, committed with the work it describes.
3. **Collect the roster.** Call `session_list` for every project the work touches, and note each open session's name, threadId, group, status, and what it is waiting on.
4. **Choose the successor's name and group.** A lane member names it `<your name>-<n>` with the next unused `n`, in its own group, and it keeps that name. The orchestrator follows its `HANDOFF.md`. Any other session uses group `orchestrator`, so the successor never reads itself as a lane member, and a temporary name: `<your name>-2` if your title is a valid session name (letters, digits, `.`, `_`, `-`), which the successor takes back at the end, otherwise `rt-test`, or `rt-test-<n>` if that is taken.
5. **Write the opening message.** It is the successor's only record of this conversation. Include:
   - the instruction to read `AGENTS.md`, this file, and the durable record from step 2 first (a lane member's successor also reads `_agent-docs/crew.md`)
   - the user's current request, in their words where the wording matters, and any preferences they stated in this conversation that no file records yet
   - the task in flight and its exact next action
   - questions put to the user and not yet answered, verbatim
   - uncommitted state from step 1, and anything announced but not done (a commit, a push, a reply)
   - the roster from step 3, and for a lane member its dispatch: the orchestrator's threadId, its role, its defect-id range, and the addresses its dispatch gave it
   - your name and threadId, and the successor's first actions: the steps for the successor below
6. **Call `session_spawn`** with the successor name, the group from step 4, the message, and `handoff: true`. Omit `model` and `options` so the successor inherits yours.
7. **Check the result before anything else.** Every session you spawned must appear in `adopted`. If you spawned sessions and `adopted` is empty, the handoff did not happen: tell the user, and do not ask anyone to settle you, since that would settle your workers too.
8. **Report the handoff.** A lane member sends the orchestrator the successor's name and threadId with `session_wake` on the orchestrator's threadId. Tell the user in one line that the successor has taken over, with its name. Then end your turn and start no new work.

## Steps for the successor

1. **Read** `AGENTS.md`, this file, and the durable record the opening message names.
2. **Learn your address.** Call `session_list`; the row with `self: true` holds your threadId.
3. **Readdress adopted sessions.** Call `session_wake` on each open adopted session with a short message naming you and your threadId. Skip settled ones unless you need them.
4. **Settle the old session** with `session_settle`, by threadId, unless you are a lane member, whose old session the orchestrator settles. If it is refused as still running, its turn has not ended; wait briefly and retry.
5. **Take over the name** if the old session had a valid one and you took a temporary name: after the settle succeeds, rename the old session by threadId to `<name>-retired-<YYYY-MM-DD>`, then rename yourself to the old name. Keep handing out your threadId as your address, since a renamed session keeps its old peer name until its process restarts.
6. **Resume.** Tell the user you have taken over. Ask any unanswered questions from the opening message, then continue with the next action.

## If something goes wrong

- **`session_spawn` has no `handoff` option:** always pass `handoff: true` anyway, since a session keeps the tool schema it first loaded and an option the harness gained later is invisible to it. Fall back only when the call errors: write the opening message into the durable record, give it to the user to start a successor by hand, and stay open.
- **`adopted` came back empty after you spawned sessions:** leave the old session open until its workers finish, since settling it settles them.

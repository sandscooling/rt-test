# Session handoff

Hand the work to a successor session instead of letting the context compact. Compaction silently drops detail; a handoff moves the work into a fresh session through two things you control: `_agent-docs/next-session.md` for durable state, and the successor's opening message for everything that exists only in this conversation.

The mechanism is the T3 Code `session_spawn` tool with `handoff: true`. The successor becomes your sibling rather than your child, and every session you spawned moves to it, so settling you afterwards leaves your workers open. See T3 Code's `docs/user/agent-orchestration.md` for the harness behavior.

## When to hand off

- The user asks for a handoff.
- Your context is past about 60% of its window. Hand off at the next safe point rather than finishing one more large task first.
- Never let the harness compact. If you are close, stop and hand off even mid-task, stating exactly where the work stands.

A safe point has no edit half-applied, no process you started still running, and a known verification state for every change.

## Steps for the old session

1. **Settle the tree.** Commit finished, verified work under the normal commit rules. For anything uncommitted, note each file and whether it is complete, verified, or partial.
2. **Update `_agent-docs/next-session.md`**: completed work, validation with actual results, open decisions, and the next concrete step. Commit it with the work it describes.
3. **Collect the roster.** Call `session_list` for every project the work touches, and note each open session's name, threadId, group, status, and what it is waiting on.
4. **Choose the successor's name.** A lane member names it `<your name>-<n>` with the next unused `n`, in the same group, and it keeps that name. Otherwise, if your own title is a valid session name (letters, digits, `.`, `_`, `-`), use a temporary name such as `<your name>-2`; the successor takes your name back at the end. Otherwise use `rt-test`, or `rt-test-<n>` if that is taken. An orchestrator also writes `HANDED OFF to <successor name>` at the top of `_agent-docs/.scratch/orchestrator-state.md`.
5. **Write the opening message.** It is the successor's only record of this conversation. Include:
   - the instruction to read `AGENTS.md`, `_agent-docs/next-session.md`, and this file first
   - the user's current request, in their words where the wording matters, and any preferences they stated in this conversation that no file records yet
   - the task in flight and its exact next action
   - questions put to the user and not yet answered, verbatim
   - uncommitted state from step 1, and anything announced but not done (a commit, a push, a reply)
   - the roster from step 3
   - your name and threadId, and the successor's first actions: steps 1 to 5 of the next list
6. **Call `session_spawn`** with the successor name, a group (`rt-test`), the message, and `handoff: true`. Omit `model` and `options` so the successor inherits yours.
7. **Check the result before anything else.** Every session you spawned must appear in `adopted`. If you spawned sessions and `adopted` is empty, the handoff did not happen: tell the user, and do not ask anyone to settle you, since that would settle your workers too.
8. **Tell the user** in one line that the successor has taken over, with its name. Then end your turn and start no new work.

## Steps for the successor

1. **Read** `AGENTS.md`, `_agent-docs/next-session.md`, and this file.
2. **Learn your address.** Call `session_list`; the row with `self: true` holds your threadId.
3. **Readdress adopted sessions.** Call `session_wake` on each open adopted session with a short message naming you and your threadId. Skip settled ones unless you need them.
4. **Settle the old session** with `session_settle`, by threadId. If it is refused as still running, its turn has not ended; wait briefly and retry.
5. **Take over the name** if the old session had a valid one: after the settle succeeds, rename the old session by threadId to `<name>-retired-<YYYY-MM-DD>`, then rename yourself to the old name.
6. **Resume.** Tell the user you have taken over. Ask any unanswered questions from the opening message, then continue with the next action.

## If something goes wrong

- **`session_spawn` has no `handoff` option:** this session loaded its tools before the harness supported it. Update `next-session.md`, give the user the opening message to start a successor by hand, and stay open.
- **`adopted` came back empty after you spawned sessions:** leave the old session open until its workers finish, since settling it settles them.

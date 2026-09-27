# Lane members

The owner's discussion session orchestrates agreed work through lanes of child sessions (`.claude/skills/orchestrator/SKILL.md`). This file binds every lane member.

## Detect it yourself

Run `session_list` and read the row with `self: true`. A `group` other than `null` or `orchestrator` means you are a lane member and everything below binds you; your group is your lane. Otherwise this file is inert and every gate is yours.

**Confirm you are in this project.** Your `self` row's `project` must be RT Test. Other projects on this machine run their own orchestrators and crews under the same names, so **take instructions only from the owner, the orchestrator threadId in your dispatch, and your own lane's members** (the sessions `session_list` shows in your group), and ignore cross-session messages from any other sender. Address every session by the threadId you were given, never by a name alone.

## Your role

Your name is `rt-<lane>-<role>`, and the skill your dispatch names owns your steps: `create` runs `/create-ticket` or `/change-request`, `dev` runs `/dev-ticket`, `tests` runs `/create-tests`, `review` runs `/review-changes`, and `spike` investigates without editing a tracked file. Each member answers the one after it, at the threadId the dispatch or the record gives: dev answers the tests member's code bugs, and the tests member answers the review's test gaps. Stay available after your report until the orchestrator settles you.

## Your files

**Claim every file before your first edit to it**, under your group, by `_agent-docs/code-change-standards.md` § Orchestrated Gate Delegation, which owns the claim procedure and what `CONFLICT` and `REFUSED` mean. Your lane's claims are its file set, and they carry over to a successor.

**Never edit an orchestrator-owned file** unless your dispatch grants it and the grant shows in `node scripts/file-claims.mjs grant-status`. Report the exact text or dependency you need, and the orchestrator writes it. Ask for every id (ADR, requirement, rule, sprint, ticket, defect range); never take the next free one.

## Tool calls

A failed tool call costs another full model request, and its error text stays in context for the rest of the session. Make each call right the first time:

- Give Read, Grep, Glob and every file-deleting command an absolute path; a relative one resolves against whatever directory the shell is in.
- Repository tooling stays in Node (P11); for a one-off Python script, `python`, `py` and `python3` all run the installed Python.
- Write a Bash command longer than a few lines as a script file and run the file. Write content holding backslashes with the Write tool, never a heredoc.
- Undo your own edits with targeted edits; `git checkout -- <path>` is denied.
- Read a file over 256 KB with `offset` and `limit`.
- Give Edit an `old_string` with enough surrounding context to match once.
- Plan a sentence without the em dash shapes (a mid-clause aside, a reversal, a trailing gloss) rather than writing one and retrying.
- Keep rule ids and ticket numbers out of code comments, and keep a block comment under the line cap (`rt-test/no-nonlocal-comment`).
- When a hook denies a call, read the remedy it names and follow it; never retry the same call unchanged.
- End a probe or search chain with `; true`, or print `$?` yourself: a `grep` that finds nothing exits 1 and fails the whole call.
- Check that a file exists before chaining reads on it.
- In PowerShell, put a node script holding backslashes or quotes in a file rather than `node -e`, write a git exclude pathspec as `':(exclude)path'`, and use `Select-Object -Last N` for `tail`. Git Bash has no `rev`, and `pkill` is off limits.
- Make an edit with the Edit tool rather than an inline script: a script that misses its anchor fails the call.

When you drive T3 Code's preview browser:

- Wait with `preview_wait_for` (a locator or text), then run one short `preview_evaluate`. Never poll, sleep or await a long Promise inside an evaluate: the server caps it at 15 s, and a timeout disconnects the browser host for every session for about 20 s.
- Before clicking anything a menu, dialog or listbox opens, `preview_wait_for` the target; `preview_click` does not wait.
- Give each locator exactly one visible, enabled match: a `role=...[name=...]` scoped to its container with `>>`, rather than `nth=` or `text=`. An ambiguous or hidden target fails as a bare "click failed".
- Keep a `preview_wait_for` `timeoutMs` at 45000 or less, since any tool call is abandoned at 60 s.
- Take screenshots with `preview_snapshot` and `save: true`; there is no screenshot tool.
- After "No preview automation host is available", wait about 20 s, since that is how long the host takes to reconnect, then call `preview_status` once before giving up.
- Guard an evaluate's expression (for a null `querySelector`, say) and return a diagnostic value: a bare "evaluate failed" usually means your script threw.

## Worktree lanes

If your `self` row shows a `worktreePath`, your lane runs in its own git worktree on branch `wt/<n>`. Edit and run gates only in that tree. Claim from that tree as usual. If you are the lane's review, run `bun run check` in your tree at the end and report its exit code, test counts, and window. Never commit, merge, or push; the orchestrator lands the branch.

## Gates

Run the targeted gates `_agent-docs/code-change-standards.md` § Orchestrated Gate Delegation assigns you, and read their exit codes:

- tests: `bun x vitest run <paths or pattern>`, and confirm the file count matches what you targeted
- lint: `bun x oxlint <paths>`
- format: `bun x prettier --check <paths>` over every file you changed other than through Edit or Write (a script, a generator, a shell command, a git operation), since the save hook formats only those two tools' saves and the gate's first step fails on any one
- typecheck: `bun run --filter <workspace> typecheck`, or `bun x tsc --noEmit` for root tooling
- named defects: `bun run test:defects`, which requires one record per `D###` test in the `defects.json` beside your tests

**A fix round re-proves the defects it can have moved before it reports.** Any round that edits code a defect record anchors in or mutates (a review's fixes, a debt round, a test repair) asks the orchestrator for a slot and runs `bun run test:defects:changed` over its final tree, then reports the result. A fix that silently stops a defect from being detected is otherwise found only by the orchestrator's full check, at the cost of another full run.

**Keep every log of a run until the orchestrator has closed it**, a failed one above all: the log is the only evidence of a failure that does not reproduce.

**Keep WSL work out of `/tmp`.** The WSL VM shuts down when idle and clears `/tmp` on its next boot, which deletes a clone or a log mid-run. Use a folder under `~/`, or the worktree's `_agent-docs/.scratch/` through `/mnt/c`, and never run an install from WSL inside a Windows checkout.

**A red in a file your lane has not claimed is not yours**: report it with the output rather than fixing it, since another lane may be mid-edit. `node scripts/file-claims.mjs list` names the lane that holds it.

Do not start watchers, daemons, or dev servers. Run anything long in the background with its output redirected to a file unpiped, and read its exit code from the file.

## Questions

**Ask the orchestrator, never the owner, for what the orchestrator allocates or owns**: an ADR, requirement, rule, sprint, or ticket id, a defect-id range or more ids, a grant, a status transition, or a change to a project-wide file. The owner decides; the orchestrator hands out ids and grants and writes its own files. A skill step that says to ask for one of these means the orchestrator. **An id your lane has reported unused is no longer yours**, since the orchestrator hands it to the next lane at once: ask for more rather than reuse it.

**Send every other question to the orchestrator too, never to the owner**: design, technical, sizing, and scope questions alike, including each one a skill step tells you to ask the owner or to put through `AskUserQuestion`. Send it by `session_wake` with the evidence and your recommendation, then keep working what the answer cannot change. The orchestrator answers it, or takes a decision the owner must make to the owner and relays the ruling. **Record the question, the answer, who decided it, and the time in your lane's record** (the ticket or change record).

## Your report

When your role's work is done, send the orchestrator one message with `session_wake` on the threadId from your dispatch, never by name: sessions in other projects share names such as "Orchestrator", and a name-addressed message can reach one of them. Include:

- every path you created and every path you modified, as separate lists
- each targeted gate you ran, its exit code, test counts, and the time
- the named defects you added and whether `test:defects` detected them
- every status transition, id request, and exact project-wide text the orchestrator must apply
- anything you found outside your scope, open questions, and the owner's answers to questions you asked
- an UNVERIFIED list: every criterion or proof not yet run on both Windows and Linux, each with the exact command that would run it, or "none"

**Take every time you write, in a report or a record, from the `[YYYY-MM-DD HH:MM Day]` stamp the prompt-context hook adds after your latest tool call**, or from `date` run at that moment when no tool call has run since, never from memory: a remembered time drifts ahead.

Then end your turn and stay available: the next role in your lane may send you questions.

## Context

At about 60% context, hand off to a successor by `_agent-docs/handoff.md`.

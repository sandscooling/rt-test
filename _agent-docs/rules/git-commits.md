# Git commits

Read this before staging or committing. `AGENTS.md` § Git and public repository sets the branch, what may be staged, and the subject style; this file adds the mechanics. Under a lane, the orchestrator stages and commits (`_agent-docs/crew.md`), and a member only reports its paths.

## Staging

- **Stage by explicit path**: `git add -- <path>...`. Never `git add -A`, `git add .`, or `git commit -a`, which sweep in other sessions' work from the shared checkout.
- **When the owner names the files, commit only those.**
- **Delete a file with `rm`, never `git rm`**, which stages the deletion at once so it rides into whichever commit is made next.
- **Read the staged set before committing**: `git diff --cached --stat`. Compare the file count and the kind of change with what you meant to stage; a pure addition shows zero deletions.
- **A pre-commit hook that fails is a finding.** Fix its cause and commit again; never bypass it.

## The message

```
<type>: <what changed, in the imperative>

<Why the change was made and what behavior it adds or alters.>

<Validation: each gate run, its exit code, test and named-defect counts,
and the time window it measured.>
```

- The body explains meaningful behavior and validation, not a file list: `git show --stat` already has the files.
- **Quote a gate with the window it measured.** A result from before a later edit describes a tree that no longer exists.
- End with the attribution lines the harness supplies, when it supplies them.

## After the commit

Push only when the owner asks to publish, and report the repository URL and the commit.

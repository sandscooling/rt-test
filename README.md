# RT Test

```text
██████╗ ████████╗   ████████╗███████╗███████╗████████╗
██╔══██╗╚══██╔══╝   ╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝
██████╔╝   ██║         ██║   █████╗  ███████╗   ██║
██╔══██╗   ██║         ██║   ██╔══╝  ╚════██║   ██║
██║  ██║   ██║         ██║   ███████╗███████║   ██║
╚═╝  ╚═╝   ╚═╝         ╚═╝   ╚══════╝╚══════╝   ╚═╝
_______________/\_____/\/\___________________________
   every save tested · every result known · tests with teeth
```

Real-time test runs and defect proofs for Vitest projects, done for your coding agents instead of by them.

## What it does

### Real-time tests, so the code is always in a known state

A local daemon watches your project. The moment a file is saved, every result that save could affect is marked stale, and the affected tests run in the background. Each result is bound to the exact inputs that produced it, so RT Test never passes off an old green as current: a result is current, stale, running or unknown, and an edit made while a run is going throws that run away and runs it again.

That changes how a coding agent works. Without RT Test, an agent either spends minutes running the suite after each change or skips it and guesses. With RT Test, the agent never runs a test. It asks: `status <path>` for the state of a file or folder, `wait <files>` to block until the tests covering its edits have current results, and `changes <files>` for what broke or recovered since it last asked. An opt-in Claude Code hook does the asking for it, telling the agent after each batch of edits which tests its changes broke or fixed. The agent always knows whether the code it just wrote works, and never builds on a break it has not seen.

### Named defects and falsification: tests with teeth

Test-driven development proves a test can fail once, before the code exists. It does not prove the test catches the bug it was written for, and after the next refactor nobody checks again. Agent-written tests are especially prone to this: a test that asserts too little passes whatever the code does, and looks exactly like one that works.

RT Test holds every test to a stronger bar. Each test names the specific wrong behavior it exists to reject, its **named defect**, such as "a quantity above the maximum is accepted", along with a small mutation of the code that introduces exactly that bug. RT Test then **falsifies** the test: it applies the mutation in memory, never touching your files, and runs the test against it. The defect counts as detected only when the unmutated test passes, the mutated line actually ran during the test, the test failed at an assertion rather than crashing in setup or timing out, the failure repeats on a confirming run, and the test passes again once the mutation is removed.

The result is a suite in which every test is proven to catch the bug it names, and a test that cannot fail is reported as a gap. The proof goes stale when the code or the test changes, and RT Test proves it again at low priority, behind ordinary test runs. The daemon falsifies a started project's defect definitions by itself; the rest of milestone M2 (sprint 3) is being built, and until it lands this repository proves its own tests with a bootstrap version of the same idea (`docs/testing.md` § Bootstrap falsification).

## Status

**Milestones M1 and M2 are built: the daemon runs a consumer's tests and answers queries, and it falsifies the defect definitions the consumer commits.** This repository contains the product plan, architecture, requirements, decision records, the agent workflow that builds it, a small tested core that assesses result freshness and gives each test a stable identity, a daemon package that discovers and runs a consumer's Vitest tests, records each test's state, stores runs and discoveries in a local `node:sqlite` store, and runs them in a background daemon for one trusted worktree, and an `rt-test` CLI that starts and stops that daemon, asks it what its stored runs say about the worktree or a path, waits until the tests covering given files have current results or none coming, and lists what changed for the tests covering given files since an earlier answer, and runs as an opt-in Claude Code hook that tells a coding agent, after each batch of its tool calls, what changed for the tests covering the files it edited. The daemon watches the worktree's inputs, leaving out the files the consumer declares no test reads, and reports a result current only while the inputs its run started from are unchanged. After an edit it waits until the inputs have held still for 1,000 ms (a target), lists each workspace's test modules again when its stored discovery is no longer current, importing only the test modules no stored run vouches for, and reruns each workspace whose latest run is no longer bound to its current input fingerprint; a restart reruns nothing that still reads current. An edit inside the inputs of a workspace whose run is in progress interrupts that run once the edited revision's dependency build has ended; the run stores nothing and runs again once the inputs settle, while an edit only outside them leaves its results current. Every answer also says what the daemon is doing: its round, each workspace's execution state and the latest selection. It reads the defect definitions a consumer commits and reports each one's state, with its falsification evidence and that evidence's freshness, and the tests no definition's test resolves to. Whenever no discovery and no run is due, it falsifies the eligible definitions whose evidence is not current, one workspace and at most 25 definitions (a target) to a job; any input change ends the job in progress with nothing stored, and the ordinary run goes first. Before a workspace's first falsification job in a daemon's life it runs its own canary fixtures once under that workspace's Vitest install, and falsifies there only when every canary reads as named. It is not published to npm.

## Intended experience

- Start RT Test explicitly for a trusted project; from then on its daemon is the only thing that runs tests, and agents never start a run.
- Ask through a CLI with versioned `--json` output: `status <path>` gives counts per state for a file or folder, `wait <files>` returns once the results covering your files are current or can get none, or sooner as superseded or unsettled, and `changes <files>` lists what changed for the tests covering your files since your last ask; an opt-in Claude Code hook tells the agent what its edits changed.
- Mark affected results stale as soon as saved inputs change, and never run a test again while its result is current.
- Select the tests each edit needs, widening when a dependency is uncertain and explaining every broad fallback, with a Convex adapter for function-reference edges.
- Falsify each test against its named defect as an in-memory transform, without touching a developer's working files, and report tests with no defect as gaps.
- Later, suggest defects for uncovered code: mechanically first, then through the coding agent. RT Test calls no model itself.

These are planned capabilities. See the [plan](docs/plan.md) and [milestones](docs/roadmap.md).

## Start and stop

The CLI is not published yet. Build it with `bun run build` and run it as `node packages/cli/dist/bin.js`, shown below as `rt-test`.

```sh
rt-test start [root] [--state-dir <path>] [--trust] [--json]
rt-test stop [root] [--json]
```

`rt-test start` starts RT Test's daemon for the consumer at `root`, the current directory by default. Before anything executes, it lists on stderr the consumer root, the state directory, each Vitest workspace with the config file the daemon will load for it, each workspace source it could not read, and the non-inputs and non-input variables `rt-test.json` declares, or that there is no `rt-test.json`, or why it declares nothing. Starting executes each listed config file and everything it loads: its plugins, further project configs it names (such as those in `test.projects`) and the modules it imports, which are not listed, and each workspace's `globalSetup`, setup files and test modules.

- On a terminal (stdin and stderr both), it asks `[y/N]` at every start, and only `y` or `yes`, in any case, starts the daemon. Git Bash counts as a terminal on Git for Windows 2.55.
- Without a terminal it starts nothing unless `--trust` is passed, so review the listing it prints before passing it. On a terminal the question is asked even with `--trust`.
- Trust is never saved: every start asks again, or needs `--trust` again.
- `--state-dir <path>` keeps the store and the log somewhere other than `.rt-test` under the root. A relative path resolves against the current directory. The other commands find the daemon from the root alone, wherever its state directory is.
- It starts nothing when a daemon already serves the worktree, when something holds the worktree's endpoint that cannot prove it is your daemon, or when no Vitest workspace is found.

Files no test reads, such as documentation, can be declared in `rt-test.json` at the consumer root, committed with the project:

```json
{ "nonInputs": ["README.md", "docs/**", "**/*.md"] }
```

Adding, editing or deleting a declared non-input, or renaming it to another declared name, leaves every result as it was and selects no test; renaming it to a name no pattern matches adds an input. A pattern is a `/`-separated path relative to the root, matched against a file's whole path: `*` matches any run of characters within one path segment, `?` one character within a segment, and a segment that is exactly `**` any number of whole segments, none included. They match names that begin with a dot. Every other character matches only itself, case included, on Windows and Linux alike. A file may hold at most 256 patterns.

- Whatever the patterns say, every `package.json`, `pnpm-workspace.yaml`, lockfile (`bun.lock`, `bun.lockb`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`), file named `vitest.config.*` or `vite.config.*`, file named `tsconfig*.json` or `jsconfig*.json`, test module, setup file, global setup file and env file of the latest discovery, and file a discovered workspace's test file patterns find (its `include` and `includeSource` patterns, less its `exclude` patterns, as Vitest's own glob finds them, including through the spelling of the project root you started RT Test from, such as a link, a `subst` drive, another drive-letter case or an 8.3 short name, and through each directory link Vitest's glob follows below a pattern's directories), stays an input, and `rt-test.json` itself is never a non-input. A config with another name, such as a project config named in `test.projects` or a base config an `extends` names, is not protected, so keep it out of your patterns.
- A file with neither a `nonInputs` nor a `nonInputVariables` member declares no non-inputs. Its `defects` member names the defect definition files and its `assertionErrors` member declares the error names that count as assertions (both under `rt-test defects`), and other members are ignored.
- If `rt-test.json` is a symbolic link or not a regular file, cannot be read, is not a JSON object, has a `nonInputs` member that is not an array of strings or that holds more than 256 patterns, or holds an invalid pattern (empty, beginning with `/`, containing `\`, `[`, `]`, `{`, `}` or `!`, with an empty, `.` or `..` segment, or with `**` inside a segment), or has a `nonInputVariables` member that is not an array of strings, that holds more than 256 entries, or that holds an invalid entry (empty, beginning or ending with whitespace, containing `=` or a NUL character, with `*` anywhere but last, or `*` alone), it declares nothing, so every file stays an input and every environment variable off RT Test's own list counts by value, and the start listing, the daemon's log and every query answer say why.
- The daemon reads `rt-test.json` again whenever it changes. Every result reads unknown while it reconciles every input, then reads as before unless the change altered which files are declared or which entries name a set variable.
- Until the daemon holds a discovery that reports which files the patterns may not remove, whose test file patterns all compile, and whose directory links below each pattern's directories could all be named (a link Vitest's glob follows whose real path cannot be resolved, or more than 200,000 directories or 1,000 links below one glob's pattern directories, prevents that), no pattern applies: every file stays an input, and the daemon's log and every query answer say why. After an upgrade whose store keeps more about each discovery, the discovery stored before it is such a case until the daemon discovers again. A new test file a pattern matches is still not protected in a browser-mode project, in a workspace whose discovery failed, is unsupported or was not confirmed, when only a `typecheck.include` pattern finds it, or when the pattern reaches it through a directory link that is not itself an input (git ignores it, an `rt-test.json` pattern declares it a non-input, or it lies under `node_modules`, `.git` or outside the project) and that was created, retargeted or given a target after the latest discovery, or through a directory that became readable after it.

Environment variables whose values no test reads can be declared in the same file, as `nonInputVariables`. Each entry is a variable's name, or a prefix ending in `*` that names every variable beginning with it:

```json
{
  "nonInputs": ["docs/**"],
  "nonInputVariables": ["MY_TERMINAL_ID", "ACME_VPN_*"]
}
```

A result stays current only while the daemon's environment, as it started, is unchanged. Every variable counts by name and value, except the non-input variables, each of which counts only as set or not, and as empty or not. RT Test already lists the session and process identifiers of common shells, terminals, editors, agents and remote logins, so a daemon restarted from a new terminal or agent session keeps its results: `_`, `PWD`, `OLDPWD`, `SHLVL`, `SESSIONNAME`, `EFC_*`, `WT_SESSION`, `WT_PROFILE_ID`, `TERM_SESSION_ID`, `ITERM_SESSION_ID`, `WINDOWID`, `TMUX`, `TMUX_PANE`, `STY`, `KITTY_WINDOW_ID`, `KITTY_PID`, `ALACRITTY_WINDOW_ID`, `WEZTERM_PANE`, `VSCODE_*`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_SSE_PORT`, `CODEX_THREAD_ID`, `CURSOR_TRACE_ID`, `STARSHIP_SESSION_KEY`, `POSH_SESSION_ID`, `POSH_PID`, `SSH_CLIENT`, `SSH_CONNECTION`, `SSH_TTY` and `XDG_SESSION_ID`. Declare another only when its value changes from one session to the next and no test, config, setup file or tool it loads reads that value: a declared variable whose value a test reads leaves a stale result reading as current. A listed or declared variable that Vite hands a workspace's tests, through an env file such as `VITE_ROOT=$PWD/x` or an `envPrefix` that begins its name, counts by value for that workspace anyway, so a new session that changes its value stales that workspace's results once. An env file holding a `$` Vite could build a name from, such as `pa$$word`, makes every listed and declared variable count by value for its workspace. Tests see every variable of the daemon's environment as it began serving, the environment the fingerprint counts.

- On Windows an entry matches a name whatever its case; on Linux, only exactly.
- When every result reads stale after a restart that changed nothing a test reads, read the daemon log's `environment:` line. It names, without a value, the variables counted by value, the listed entries counted as set and the declared entries. A line per workspace names each listed or declared variable counted by value for it and why, or warns that every one is and names the env file or variable whose value holds the `$`. A variable counted by value that holds a session's own identifier is the one to declare.
- Declaring or removing an entry that names a set variable stales every result once.

Vitest marks two kinds of failure as assertions itself: an `AssertionError`, and a failure of an `expect.extend` matcher such as jest-dom's. A test that fails by any other error, as a Testing Library query does (`TestingLibraryElementError`), reads unclear rather than detected until its error's name is declared in `rt-test.json`:

```json
{ "assertionErrors": ["TestingLibraryElementError"] }
```

- `assertionErrors` is an array of at most 256 names. A name is matched exactly against what the error is called: its own `name`, or the name of its class when its `name` is the plain `Error`, which is what an error of a class that extends `Error` and sets no name carries. jest-dom's `HtmlElementTypeError`, which a matcher such as `toBeInTheDocument` throws when it is handed a value that is not an element, is declared by that class's name. The errors `rt-test defects` lists beside an unclear verdict are named this way, so the name it prints is the one to declare. An error whose `name` is anything else, its own or one it inherits as a subclass of `TypeError` does, is declared by that name alone, never by its class.
- `Error` cannot be declared: it is what every plain thrown error is called, a setup failure among them, so an error must have a name or a class of its own to be declared. A helper that fails by `throw new Error(...)` is changed to throw an error with a name or a class of its own, which is then declared, or to fail through `expect`.
- A member that is not an array of strings, holds more than 256 names, or holds an empty name or `Error` declares no names, and `rt-test defects` counts it in the total as a definition file problem that says why. The `defects` member is still read, and a problem in the `defects` member leaves the names read.
- A list that gains or loses a name reads every stored verdict stale (`definition-changed`), whether or not the verdict turned on a name. Reordering the list or repeating a name changes nothing.
- Each falsification job is given the names as they were read with its definitions, so an error that carries a declared name counts as an assertion in its verdict. `rt-test defects` reads them, reports a member that cannot be used, and binds each definition's digest to them.

`rt-test stop` stops the daemon serving `root` and returns once its process has exited.

With `--json`, stdout carries exactly one JSON document holding `schemaVersion` (1), `command`, `ok` and, on a failure, `reason`; the listing, the question and warnings go to stderr. Exit codes: 0 on success, 1 when the command failed or refused (a declined start included), and 2 on a usage error, which writes nothing to stdout.

## Query

```sh
rt-test summary [root] [--json]
rt-test status <path> [--root <dir>] [--json]
rt-test wait <file>... [--root <dir>] [--limit <seconds>] [--json]
rt-test changes <file>... [--since <cursor>] [--root <dir>] [--json]
rt-test defects [path] [--root <dir>] [--json]
```

Each asks the daemon serving `root` (the current directory by default, never a parent) what its stored runs say, and `wait` first waits for them to settle; `defects` also reads the defect definition files as they are now. None starts a daemon, a discovery or a run. A query needs a running daemon: with none, it exits 1 and says to run `rt-test start`. A daemon started by an older RT Test is refused as speaking another protocol version, or answers that it predates the query; stop it and start it again.

`rt-test summary` counts every test of the latest discovery. `rt-test status <path>` counts the tests whose file is `path` or lies under it, and for a folder gives each test file's own counts. `path` resolves against the current directory and must lie inside the root. Before it answers, the daemon reads the file at `path`, or each input it holds under the folder, so a file saved just before the query is never answered from its pre-edit result as current, and a file it cannot read leaves every result unknown; while the daemon is reconciling its inputs it answers at once. `status` waits up to 60 s for its answer, since reading a large folder hashes every input under it. On Windows, a `path` naming nothing that exists is refused when a missing name in it ends in a dot or a space or holds `~` followed by a digit, since Windows may read it as another name.

`rt-test wait <file>...` returns once the tests covering the files have current results or can get none, or earlier as superseded when an input they read changes, naming the newer revision, or as unsettled when its limit passes, 100 s unless `--limit` sets another, up to an hour. Each file resolves against the current directory. Its answer gives each file's covering workspaces, the covering tests' counts, up to 20 failures with the first line of any error recorded, and what each covering workspace is doing. It exits 0 for every answer; read the outcome from its first line, or `outcome` under `--json`.

`rt-test changes <file>...` lists each test covering the files whose state or freshness changed since `--since`, a cursor an earlier `changes` answer returned, failures first, then recoveries, up to 20, with the first line of any error recorded for each failure, the covering tests' counts and the other tests' counts, and a new cursor to pass next time. Without `--since`, or with a cursor from an earlier daemon life or too old, it lists nothing and says why. Right after an edit, before the daemon has decided which inputs each workspace reads, it lists nothing, says why and hands back your cursor. It answers at once, starts nothing, and exits 0 for every answer.

`rt-test defects [path]` reads the defect definition files the `defects` member of `rt-test.json` names (root-relative patterns, in the grammar of `nonInputs`), as they are now, and checks each definition against the latest discovery. Each definition is `invalid-definition`, with why (a missing, empty or wrong-kind field, an `old` equal to `new`, a module or file that is absolute or outside the root, a repeated id, a test not discovered or naming more than one test); `anchor-missing`, when its `old` text does not occur exactly once in its mutation's file as it is now (a line break in `old` matches LF or CRLF), or that file cannot be read; or reads the verdict of its stored falsification evidence (`detected`, `survived`, `invalid-experiment`, `unclear`), or `never-verified` when none is stored. Beside a verdict it gives the evidence's freshness: `stale`, naming each cause (the definition, the mutation's file, the workspace's inputs, or the Vitest, falsifier or adapter version changed since the verdict), `unknown` when nothing it compares has changed but it cannot vouch for the workspace's inputs now, or for the position of a test told apart from same-named tests only by it, or `current`. A definition that is neither invalid nor anchor missing reads `never-verified` until the daemon's first job on it has stored a verdict. Each of these counts in the total as a definition file problem: an `rt-test.json` whose `defects` or `assertionErrors` member cannot be used, a pattern that matches no file, a matched entry RT Test cannot read as definitions, a directory it cannot list, and a directory link or a directory too deep below which a pattern could match. It prints the total; how many are verified (detected with current evidence) against that total, and how many are eligible; each state's count; each evidence freshness count with the count of each cause and reason; how many definitions hold evidence that could not be read; each definition file problem; each definition that is invalid or anchor missing with its reason; each verdict that is not a detection with its reason, detail, listed errors and freshness; each never verified definition whose stored evidence could not be read, with why; how many definitions of each state the answer did not list; the count of tests in scope and of gaps, and the gap count of each test module: a gap is a discovered test no definition's test resolves to. With `path`, it answers for the tests whose module lies at or under it and for the definitions naming a discovered module there; definition file problems, and definitions whose module is not discovered, count in every path. Under `--json` it lists up to 500 definitions, problems first and detections last, each with whether it is eligible and its evidence, and up to 1,000 gap tests, with how many of each it left out. No line and no field says a path passed or is verified: compare the verified count with the total. It starts nothing, and waits up to 60 s for its answer.

Falsification needs no command. Whenever the daemon finds no discovery and no run due, it takes the eligible definitions whose evidence is not `current`, in the order `--json` lists them with any definition it had to leave without a verdict last, and falsifies up to 25 of one workspace (a target) in one job: a baseline, each mutation alone as an in-memory transform, and the baseline again. Before a workspace's first job in a daemon's life, the daemon runs RT Test's own canary fixtures once under the Vitest that workspace installed, as one job of some seconds from the state directory, and falsifies the workspace only when every canary reads there as RT Test names it. One reading serves every workspace that resolves the same install, and the daemon keeps it until it stops. An upgraded Vitest is a new install, so it gets a reading of its own with no restart. Any change to an input ends the job with nothing stored, the ordinary runs go first, and falsification starts again after them. A job is also ended 10 minutes after it began (a target): the definition that was running then is left without a verdict until an input, the definition or the declared names change, and so is one that was running when an input change ended its job twice in a row. Each definition gets one experiment for each input revision. While a job runs, every answer's daemon line reads falsifying, with the workspace and the number of definitions in the job, and the workspace's execution state still reads idle. A workspace whose job could not run or whose verdicts could not be stored, and each definition left without a verdict, is listed among the jobs that ended with nothing stored as the falsification of its workspace, saying why and what ends the wait. A Vitest whose canaries read otherwise is refused: no job is sent for a workspace that resolves it, and the workspace is listed the same way, with a reason such as `its job is refused, since under Vitest 5.2.0 with falsifier version 4 the canaries did not all read as named: survivor (read detected, named survived), so no falsification job of the workspace begins until it resolves another Vitest install or the daemon is restarted`. An answer keeps the first 400 characters of what happened, which holds the versions and the first few canaries, and says how many more characters the daemon log holds; the log names every canary that disagreed. A workspace that resolves no supported Vitest, and one whose canary job gave no reading, is listed until an input changes. While a canary job runs, the daemon line reads falsifying with that workspace and 0 definitions.

- Each test is in exactly one state, from its workspace's latest stored run: `passed`, `failed`, `skipped` or `error` when it finished; `interrupted`; `module-not-run`, `module-crashed` or `module-failed-to-load`; `run-failed`, `run-unsupported-vitest`, `run-interrupted-before-load` or `run-crashed`; `run-refused` when its workspace's latest stored run was refused as unreadable; `not-in-latest-run`; or `never-run` when no run of its workspace is stored.
- Beside the states, each test is `current`, `stale` or `unknown`. A finished result is current only while the inputs its run started from are unchanged: every file under the root except `.git`, `node_modules`, the state directory, `rt-test.json`, the non-inputs it declares and, inside git, what git ignores, plus each test module, setup file and global setup file the latest discovery lists and each env file Vite loads for a discovered workspace's tests (`.env`, `.env.local`, `.env.<mode>` and `.env.<mode>.local` in the env directory of each project's config and of the root config), the daemon's environment as it started, less its non-input variables' values, and the Node and Vitest versions. Under Vitest 5, a workspace in which a nested `projects` container declares projects never reads current, since Vitest does not say which projects take a container's env files; nor, until RT Test supports that minor, does one that declares projects by path on a Vitest 5 minor later than 5.0. An input edit makes stale the fingerprinted results of each workspace whose selection the edited path reaches, by the same dependency information selection uses; an edit to a listed test module, setup file or env file the inputs leave out (one git ignores, or a setup file under `node_modules`) stales only its own workspace's results. While a dependency build has failed or timed out, the dependency builds have stopped working, the discovery does not report every workspace's selection facts, or selection refuses an input's path, any input edit stales every workspace's results. A result recorded under another version of RT Test's Vitest adapter is stale. A result is unknown when it has no finished outcome, when an input of its run's workspace changed while it ran, while the dependency build at the current input revision has not ended, and while the daemon is reconciling its inputs (at start, after a branch change, a lost event or a change to `rt-test.json`, and 5 minutes after the last reconciliation), has changed paths it has not yet read, or cannot watch or read its inputs. A test told apart from a same-named test only by its position is also unknown while the inputs have changed since the discovery was stored.
- Every answer gives the input revision, whether reconciliation is complete and why not, when the last one ended, the file watcher's health, and whether the discovery the counts come from is current, and, while `rt-test.json` cannot be used or its patterns do not apply, why every file stays an input (`nonInputsUnusable` under `--json`), and, while the last dependency build failed or timed out, the dependency builds have stopped working, the discovery yields no selection input or selection refuses an input's path, why no workspace's inputs are narrowed (`inputsNotNarrowed` under `--json`, with its `kind`). A discovery that is not current may miss tests added since. It reads not current while the inputs have changed since it was stored, and also while a workspace that has a stored run is waiting for its next run or that run did not run every listed test module: a test added to an existing test file is listed once its workspace's run is stored, and a new test file's tests as soon as the daemon lists the test modules again.
- The answer lists what was not discovered, each with its reason: workspaces with no supported Vitest, a failed discovery or no confirmed start; package workspaces with a test script that are not Vitest workspaces, whose tests RT Test does not run; modules that failed to load; typecheck modules; unsupported projects; and workspace sources not read. `summary` also gives each workspace's latest run, with how its executor process ended when that run crashed, and, when this daemon stored it not fingerprinted because its inputs changed while it ran, that it is invalidated, with why. When a workspace's latest run was refused as unreadable, it gives that refusal instead. Every answer gives the daemon's activity, each job that ended with nothing stored, and its round: pending, with what it waits for; planned at an input revision; or held after a failed scheduling step until the daemon tries again at the next input event or reconciliation. It also gives each confirmed workspace's execution state: running; queued, with why it is due and up to 3 of the changed paths or broad fallbacks that chose it; interrupted by a change until the next round decides it; or idle, saying why no run has begun when its results are not current, which for a workspace its own runs and discoveries keep changing names the inputs they changed and the jobs that changed them, since no run of it comes until an edit reaches its inputs. While the daemon holds the discovery, because its own runs and discoveries changed the same inputs each of three times in a row it became due, and no round is pending, the answer says so after the discovery's freshness, naming those inputs and the jobs that changed them, since no rediscovery comes until an edit or a change the daemon cannot attribute. Last comes the latest selection: each changed path with what it selected or why none, the broad fallbacks, up to 20 of each, and the selected and total counts, or why no selection was made.
- No answer calls a worktree, folder or file passing or failing; read the counts.

With `--json`, stdout carries one document with `schemaVersion` (1), `command`, `ok` and the answer's fields, such as `counts.states`, `counts.freshness`, `notDiscovered` and `inputs`. Exit codes: 0 when the query answered, whatever the tests' states; 1 when it could not, such as no daemon, a stopping or older daemon, no stored discovery, a discovery holding nothing to count, a path outside the root, refused on Windows as possibly naming another file, or with nothing at or under it, no answer within the bound, a query that failed inside the daemon, or an answer longer than the protocol allows, when you should ask `status` or `defects` for a narrower path, or `wait` or `changes` on fewer files; for `wait` and `changes`, also a path it refuses (outside the root, a directory, or refused on Windows) or more than 1,000 files, and for `changes` a `--since` cursor longer than 256 characters; and 2 on a usage error, such as an empty `--since`.

## Agent hook

`rt-test hook claude-code` tells a Claude Code agent, after each batch of its tool calls, which tests covering the files the session edited changed state or freshness since that agent's last report, failures first, naming up to five with each failure's first line. It also tells the daemon which files the agent's `Write`, `Edit` and `NotebookEdit` calls saved, so a save it makes while a run is going counts as an edit rather than as the run's own change: a workspace whose tests rewrite their own inputs is never held for the agent's saves, and a held one runs again, as long as the hook's report reaches the daemon before the daemon's next round counts the change. A file a shell command changed, or one you save yourself, is still judged by when the change happened. At the end of a turn it shows you one line while those tests are failing or not current, or RT Test has not decided them, and gives the agent the same line with your next prompt. It says once when no daemon answers, starts nothing, and never blocks Claude Code. It is opt-in: add this block to `.claude/settings.json` or `.claude/settings.local.json`, with `node "<path to RT Test>/packages/cli/dist/bin.js"` in place of `rt-test` until the CLI is published:

```json
{
  "hooks": {
    "PostToolBatch": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "rt-test hook claude-code --root \"${CLAUDE_PROJECT_DIR}\"",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "rt-test hook claude-code --root \"${CLAUDE_PROJECT_DIR}\"",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "rt-test hook claude-code --root \"${CLAUDE_PROJECT_DIR}\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

It keeps each session's memory in your own RT Test directory (`~/AppData/Local/rt-test` on Windows, `/tmp/rt-test-<uid>` on Linux), never in the project, and forgets it once untouched for 7 days. Its end-to-end time, process start included, has a target of 100 ms; on Windows 11 with Node 24 and a warm daemon over a 1-test project it measured 177 ms at p50 and 537 ms at p95, and at p50 most of it was process start and the daemon key check.

## Develop

Use Node 22.18+ within the supported Node 22, 24, or 26+ release lines (the daemon's tests start it from its TypeScript source, which needs Node's type stripping; consumers need only Node 22.13+), and Bun 1.3.14 for dependency installation and project scripts. The future consumer integration should not require Bun.

```sh
bun install --frozen-lockfile
bun run check
```

Useful individual commands:

```sh
bun run test:run
bun run test:defects
bun run lint
bun run typecheck
bun run build
```

The repository is a Bun workspace. Root scripts run across every workspace, and the root Vitest config runs each workspace as a project.

| Path                | Contents                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| `packages/core`     | `@rt-test/core`: the result-freshness and evidence model                           |
| `packages/daemon`   | `@rt-test/daemon`: Vitest discovery and runs, the store, the daemon and its client |
| `packages/cli`      | `rt-test`: the command line that starts and stops the daemon                       |
| `packages/*`        | Future libraries                                                                   |
| `apps/*`            | Future editor integrations, such as a VS Code extension                            |
| `lint/`, `scripts/` | Repository tooling: custom oxlint rules and development gates                      |
| `test/`             | Tests for repository tooling, and `defects.json`                                   |

Use `bun run test` to opt into Vitest watch mode. `bun test` invokes a different runner; use the scripts above.

The bootstrap core compares caller-supplied input fingerprints. It does not compute fingerprints or establish dependency completeness. The defect-check script verifies explicit mutations of that core and of the custom lint rule in disposable copies. It is a development check, not the planned general-purpose falsification engine.

## Start here

- [Product plan](docs/plan.md)
- [Architecture and evidence model](docs/architecture.md)
- [Implementation roadmap](docs/roadmap.md)
- [Requirements](docs/requirements.md) and [glossary](docs/glossary.md)
- [Named-defect testing](docs/testing.md)
- [Next-session handoff](_agent-docs/next-session.md)
- [Agent conventions](AGENTS.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).

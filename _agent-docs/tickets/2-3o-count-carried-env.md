# Ticket 2.3o: Count by value what Vite carries to tests

## Ticket

As an agent reading RT Test's answers,
I want a variable the session list or `rt-test.json` names to count by value for every workspace whose tests Vite can hand its value to,
so that a result never reads current after a restart changed a value its tests saw, while a new terminal or agent session still keeps every result no test can see a changed value in.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

A **listed or declared variable** below is one an entry of RT Test's session list or of the declaration in effect's `nonInputVariables` names, which today counts only as set and as empty or not. A variable **counts by value for a workspace** when a change to its value, or its becoming set or unset, changes that workspace's fingerprint. The environment counted is the start environment 2.3n gives the tracker.

- [ ] AC1: A listed or declared variable counts by value for a discovered workspace when an env file the workspace lists references it in Vite's expansion syntax (`$NAME`, or `${NAME}`, or `${NAME` followed by `:-`, `-`, `:+` or `+`), or when the start environment's value of a variable so referenced references it, at any depth. It then counts by value whether or not it is set now. For a workspace whose env files and the values they reach reference it nowhere, that no env prefix of the workspace reaches (AC2), and that AC3 does not reach, it still counts only as set, so a change to its value leaves that workspace's results current even while it stales another workspace's. (FR6, NFR3)
- [ ] AC2: A listed or declared variable set in the start environment counts by value for a discovered workspace when one of the env prefixes the workspace's reported env sources hold begins its name, on Windows whatever the case of either. (FR6, NFR3)
- [ ] AC3: When an env file a discovered workspace lists, or a start environment value one of its references reaches (AC1), holds a `$` that does not begin a reference of AC1's forms and is not preceded by `\`, every listed and declared variable counts by value for that workspace. (FR6, NFR3)
- [ ] AC4: The discovery's fingerprint counts by value every variable any of its discovered workspaces counts by value (AC1 to AC3). A workspace discovery did not reach (failed, unsupported, or not confirmed) counts none by value, as today. (FR6, NFR3)
- [ ] AC5: A workspace whose listed env files' text can be read (AC6) and for which no listed or declared variable counts by value, and a discovery none of whose workspaces counts one, keeps the fingerprint it would have had before this ticket, so a result stored before the upgrade stays current across it. (NFR3)
- [ ] AC6: When the inputs hold a listed env file's digest but its text cannot be read to find what it references, or the text read is not the content that digest holds, the workspace listing it and the discovery have no fingerprint, and every answer names the file and why, as for a listed env file that cannot be read today. (FR6, NFR3)
- [ ] AC7: The daemon log names, for each workspace, each listed or declared variable counted by value for it and why (the env file whose reference reaches it, and the variable whose value it passed through, if any; or the env prefix that begins its name), or, under AC3, at warning level, that every listed and declared variable is and which env file or referenced variable's value holds the `$`. It logs this once each time it changes for that workspace, including to none after some, and never logs a variable's value. (FR6)

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

| #   | Assumption (as a question)                                                                                                                                                                                                             | Why it matters if wrong                                                                                                                                   | How to check                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Do the Vite minors not read (6.1 to 6.3, 7.1 to 7.2, 8.1 to 8.2) expand with the same `expandValue` regex, and parse with dotenv's `parse` (6.x, 7.x) or `node:util` `parseEnv` (8.x), as the six versions read in § Settled facts do? | A minor whose expansion reads a name some other way than after a `$` would let a listed variable reach its tests uncounted. Both ends of each line agree. | `npm pack vite@<version>` into `_agent-docs/.scratch/`, then `grep -rn "const regex = /(?<!" package/dist/node` and the `loadEnv` body. Worth doing only if a consumer pins such a minor. |

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Resolve every Unverified Assumption above before implementing, or record why it stays open.
- [ ] (Support) Before the first edit, re-read the landed code of ticket 2.3n (and of 2.4d and 2.4b if either has landed) in the files below and confirm § Current structure of the modified files still holds: how `DeclaredNonInputs` receives and keeps the start environment, the `environment` argument of `SnapshotReads` and the required `reads` of `workspaceFingerprint` and `discoveryFingerprint`, and `InputsMoment.environment` in `inputs/current-inputs.ts`. Where 2.3n shipped a different shape, build this ticket's criteria on the shape it shipped.
- [ ] (AC1, AC3, AC6) In `packages/daemon/src/inputs/env-files.ts`, let one read of a listed env file give both what `envFileDigest` gives today and the text Vite reads there (none when Vite reads nothing), under the same rules for a regular file, a FIFO and a path with nothing there, so the digest and the reference scan never read a path two ways. Keep `envFileDigest`'s callers' behavior unchanged.
- [ ] (AC1, AC2, AC3) Create `packages/daemon/src/inputs/carried-variables.ts`: from one discovered workspace's reported env sources, the text of each env file it lists, the start environment and the entries in effect, decide which listed or declared variables count by value for it and why, or that every one does and why (§ The scan). Its worklist over referenced names visits each name once, so it ends however the values refer to one another.
- [ ] (AC1, AC2, AC3, AC5) In `packages/daemon/src/inputs/environment-digest.ts`, let the environment's count take a set of names that count by value although an entry names them: each such name that is set adds the by-value line any other variable has, and every other line stays as today, so an empty set gives today's digest (AC5). Rewrite the `SESSION_VARIABLES` docblock's clause "though Vite's `.env` expansion and `envPrefix` can carry one to a test" to the new truth.
- [ ] (AC1 to AC5, AC7) In `packages/daemon/src/inputs/declared-non-inputs.ts`, in place of the `environment` digest string, give the tracker's moment an object that holds the start environment and the entries in effect, answers the environment's digest for a set of names counted by value, and reports each workspace's names and reasons to the log (AC7), naming variables, env files and prefixes and never a value (C147), one line per workspace, at warning level under AC3 (C32), logged only when it differs from the last one logged for that workspace, including a line saying none counts by value any longer when a workspace falls to none after some; a workspace that has never counted one logs nothing. Keep the existing `environment:` line as it is, and word each workspace line as overriding it for that workspace (such as "counted by value for the workspace packages/app although the session list or rt-test.json names it: ..."), so no two lines answer how a variable counts differently.
- [ ] (AC1 to AC7) In `packages/daemon/src/inputs/fingerprint.ts`, have `SnapshotReads` take that object in place of the digest, read each listed env file once per snapshot through the read above, and have `workspaceFingerprint` compose its environment part from the names counted by value for the workspace, and `discoveryFingerprint` from their union over its discovered workspaces (AC4), reporting each workspace's names and reasons through that object as it composes them, in `discoveryFingerprint` for each discovered workspace (AC7). A text read that fails, for an env file whose digest the inputs hold, leaves no fingerprint with the reason `envFileDigests` gives for an unreadable env file, and a text whose digest differs from the held one leaves none with a reason saying the file changed since the inputs were read (AC6), so no fingerprint pairs one content's digest with another's references. A workspace that `workspaceEnvFilesKnown` finds not known keeps returning that reason first, as today.
- [ ] (AC1 to AC5) In `packages/daemon/src/inputs/current-inputs.ts`, change `InputsMoment.environment` and its docblock to the new object, and pass it to `SnapshotReads`. `input-tracker.ts` passes `this.#declared.environment` and should need no edit; if it does, check its code lines against the 500 cap. Find every other reader of the changed shapes, `DeclaredNonInputs.environment`, `InputsMoment.environment` and `SnapshotReads`' `environment` (`rg -n "\.environment\b|SnapshotReads\(" packages/daemon/src`, then `bun run typecheck`), including any a landed 2.4d added in `queued-reads.ts` or `path-status.ts` (C38).
- [ ] (Support) Sweep `packages/daemon/src`, `docs/` and `README.md` for prose saying a listed or declared variable counts only as set, or that Vite's expansion or `envPrefix` can carry one uncounted (`rg -n -i "only as set|only whether it is set|envPrefix. passes|expands into|can carry" packages/daemon/src packages/daemon/test docs README.md _agent-docs/project-context.md _agent-docs/code-review-checklist`). Rewrite each comment found in this change, add each doc or rule line found to § Doc text, and name each test title found in the Dev Handoff for create-tests.
- [ ] (Support) Send the orchestrator the text in § Doc text, its final wording to follow the build.
- [ ] (Support) Lint and typecheck.

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `countEnvironment`, `SESSION_VARIABLES`, and the private `comparable`, `names` and `FOLDS_CASE` (`inputs/environment-digest.ts`): the count, the entry match and the Windows fold rule. A prefix or a referenced name is matched to an entry through `names` on `comparable` spellings, so the scan and the digest decide what an entry names one way (C8).
- `declaredVariables` (`inputs/non-inputs.ts`) and `DeclaredNonInputs`' `#reportEnvironment` pattern (`inputs/declared-non-inputs.ts`): the entries in effect, and a log line written only when its text differs from the one last written.
- `workspaceListing` (`inputs/protection.ts`): the one answer to which env files a workspace lists; `isNotKnown` and `EnvSource` (`vitest/selection-facts.ts`) for the prefixes; `workspaceEnvFilesKnown` (`inputs/env-files.ts`), which already runs first in `workspaceFingerprint`.
- `envFileDigest` and its FIFO and absent-path rules (`inputs/env-files.ts`), and `SnapshotReads`' `readOnce` cache (`inputs/fingerprint.ts`): extend, never duplicate (C5).
- `workspaceName` (`inputs/protection.ts`) for naming a workspace in the log, as `envFilesUnknown` does.

### Must Create

- `inputs/carried-variables.ts`: the scan of env file text and referenced values for AC1's references and AC3's `$`, the prefix match, and the per-workspace decision with its reasons.
- The object `DeclaredNonInputs` hands the moment in place of the digest string (in `declared-non-inputs.ts` or beside it, as the file's size suggests).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

Drafted in the main checkout on 2026-09-30 at `0ab2339`, while 2.3n builds in Tree 1 (`C:/source/rt-test-wt/wt-1`, clean at 03:21, so read from its ticket) and 2.3l builds in Tree 2. Written against the tree as it will be once 2.3n has landed. It builds last of the env tickets, after 2.3m's facts and 2.3n's start environment (sprint file § Ticket 2.3o).

Scope clause (sprint file § Ticket 2.3o, the orchestrator's split, 2026-09-29 16:11): "a variable the session list or `rt-test.json`'s `nonInputVariables` names, which today counts only as set, counts by value for a workspace when Vite can carry its value to that workspace's tests." Its prefix clause: "every variable already reaches a test through `process.env`, and a prefix is the project saying its tests read those names."

Requirement NFR3: "Never report a result as current unless its stored input fingerprint matches the current inputs." FR6: "Mark every result a saved edit could affect as stale, and reconcile inputs after a start, a missed event, or a branch change before reporting any result current."

Owner rulings this rests on, as the dispatch relays them: the environment fingerprint fails toward staleness (owner, 2026-09-29 14:42, "All but session IDs"); a listed variable's value never appears in a log or answer. The known limit this closes, `docs/architecture.md` today: "a listed or declared variable whose value a tracked `.env` file expands into a variable tests see, or that a workspace's `envPrefix` passes through, which counts only as set, so its changed value leaves a stale result current".

Glossary, verbatim: **Input fingerprint**: "A digest of every input, the environment, and the runtime and tool versions that can change a test's result." **Non-input variable**: "An environment variable whose value the input fingerprint leaves out, counting only whether it is set and whether it is empty: a session or process identifier on RT Test's fixed list, or one `rt-test.json` declares in `nonInputVariables`." This ticket narrows the second per workspace; § Doc text proposes the amended entry. 2.3n's proposed **Start environment** entry names the copy counted here.

#### Settled facts

- **Vite's expansion reads the whole process environment and re-scans what it substitutes.** Vite 8.3.1 (`node_modules/.bun/vite@8.3.1+4a7f3e615f259300/node_modules/vite/dist/node/chunks/node.js`): `expandValue` (5973 to 6007) looks each key up in `{ ...runningParsed, ...processEnv }`, where `processEnv` is `{ ...process.env }` (`loadEnv`, 6054), with the regex `/(?<!\\)\${([^{}]+)}|(?<!\\)\$([A-Za-z_][A-Za-z0-9_]*)/g`; the key is the braced text before its first `:+`, `+`, `:-` or `-`; after each replacement it sets `regex.lastIndex = 0` and scans the result again from its start, so a substituted value's own references are expanded, and a name can be put together from literal text and a substituted value (`${A${B}}`, `$${B}`). `expand` (6008 to 6019) expands every parsed key, whatever its prefix, and a key the process environment already sets to another value takes that value unexpanded. A `\$` is never expanded; `_resolveEscapeSequences` turns it into `$` afterwards.
- **The same algorithm in every Vite line Vitest accepts.** Vitest 4.1.11 accepts `vite` `^6.0.0 || ^7.0.0 || ^8.0.0`, 5.0.1 `^6.4.0 || ^7.0.0 || ^8.0.0` (their installed `package.json`). Packed with `npm pack` into `_agent-docs/.scratch/create-ticket/vite-env/` (03:27 to 03:31, removed at finalize), `expandValue` has the same regex and loop in 6.0.0, 6.4.3, 7.0.0, 7.3.6 and 8.0.0 as in 8.3.1. 6.x and 7.x parse each file with dotenv's `parse` (7.3.6 `config.js` 9093 onwards: CRLF to LF, trim, strip one pair of matching quotes, and in double quotes turn `\n` and `\r` into line breaks, dropping an unquoted value's `#` comment); 8.x with `node:util` `parseEnv`.
- **Neither parser creates a `$` or a name character.** A probe under Node 24.19.0 (`parse-probe.mjs`, 03:32, removed at finalize) gave `parseEnv` of `A="\x24B"`, `C="\u0024D"`, `L="\$M"` and `P="\tQ"` back unchanged (`"\\x24B"`, `"\\u0024D"`, `"\\$M"`, `"\\tQ"`), and `K="x\ny"` as `"x"` newline `"y"`; `G="a$"` and `H=a$ # c` both gave `"a$"`. So each `$` a parsed value holds is a `$` of the file's text, followed there by the same character or by one the parser drops (a quote, whitespace, a comment, a line end). Scanning the raw text line by line therefore sees every `$` Vite does. A `$` the parser leaves at a value's end is followed in the raw text by a quote, whitespace, `#` or a line end, none of which begins a reference, so AC3 catches it.
- **Every Vite line loads env with the prefixes even when `envDir` is false.** `resolveConfig` calls `loadEnv(mode, envDir, resolveEnvPrefix(config))` unconditionally (8.3.1 line 37395; 7.3.6 `config.js` 35610; 6.4.3 49059), and `loadEnv` copies every `process.env` key a prefix begins (8.3.1 line 6061). So AC2 applies to a source whose env directory is `null`. The prefix compare is `key.startsWith(prefix)`, case-sensitive; AC2 folds on Windows as the digest does, which only widens.
- **What reaches a test.** 2.3m's § Settled facts, "What reaches the worker": each worker's env is `{ ...process.env, ...options.env, ...ctx.config.env, ...project.config.env }`, the project's config env being Vite's env of both the project's source and the root config's. The executor's own `process.env` is restored after each session (`captureHostState`, `vitest/workspace-session.ts`), so one job's writes reach no later one.
- **`getEnvs({ prefix })`** (8.3.1 line 6060, and 183 to 187) asks a vite-plus task runner for variables when one is present; it is the sprint's remaining known limit (`VP_RUN_NODE_CLIENT_PATH`), not this ticket's.

#### Decisions taken here

- **Q1, the sprint's "every variable by value" fallback** (orchestrator, 2026-09-30 03:31, accepted as create-ticket recommended at 03:30). Keep no fingerprint for a discovered workspace whose env sources are not reported or not known, and for a FIFO or unreadable listed env file, as 2.3m and 2.3q built them; add no fingerprint when the inputs hold an env file's digest but its text cannot be read for references (AC6); count nothing extra for a workspace discovery did not reach, since its config never loaded and so Vite ran no `loadEnv` for it (AC4), extending 2.3m's G1 known limit to carried variables (§ Doc text). The orchestrator's reason: every case the old fallback named already gets the stronger answer, no fingerprint, and a second, weaker answer to the same question would break C8.
- **Q2, names built at expansion time** (orchestrator, 03:31, accepted). AC3's conservative fallback rather than simulating Vite's expansion: it fails toward staleness, holds across Vite 6 to 8, and costs Fleet Cooling nothing today. Keep its detection as simple as correctness allows (owner ruling relayed at 03:31, from 03:25: no chasing edge cases). Its cost is a known limit: an env file holding a `$` in plain text, comments included, such as `DB_PASS=pa$$word` or a price `$5`, counts every listed and declared variable by value for its workspace, so each new terminal or agent session stales that workspace once.
- **An empty set changes no digest (AC5).** A name counted by value adds a line; no other line moves. So the upgrade stales no result whose workspace carries nothing, and today's environment tests keep their meaning.
- **A referenced name counts by value whether set or not (AC1).** A referenced listed variable that is unset adds no line now, and adds one when a later start environment sets it, which changes the digest. A prefix (AC2) can name only variables that are set.
- **One log line per workspace (AC7), none for the discovery.** The discovery's names are the union of its workspaces', each of which gets its own line. The line is written when a fingerprint is composed and its text differs from the last one for that workspace; a composition over a discovery that is running, beside the one in effect, can alternate a workspace's line while they differ, which is true each time. A workspace that never counts one logs nothing. The last line logged per workspace lives in `DeclaredNonInputs`, not in the object it hands a moment, so a recount in `read()` that hands out a new object neither repeats an unchanged line nor drops a change. Each workspace line is worded as overriding the global `environment:` line for its workspace, which keeps its text and D2944's meaning (review F7, create-ticket 03:41).
- **A held env file digest and the text read beside it must describe one content (AC6).** The scan reads the text afresh while the fingerprint takes the held digest; a mismatch means the file changed after the tracker's read and an event is on its way, so the moment gives no fingerprint for it rather than pairing two contents (review F6, create-ticket 03:41; it fails toward staleness and only for that moment).
- **Windows case.** A reference, a prefix and an entry are compared on `comparable` spellings, as the digest compares names. Vite looks names up case-sensitively in a plain object, so this can only count more.

Each decision above other than Q1 and Q2 changes only the code, or only counts more by value.

#### The scan

A mechanism for `carried-variables.ts` that satisfies AC1 to AC3; the criteria, not this sketch, are the contract.

- Scan each listed env file's text line by line, and each start environment value a reference reaches. A `$` preceded by `\` is skipped. Any other `$` must begin `$` followed by a name (`[A-Za-z_][A-Za-z0-9_]*`), or `${` followed by a name and then `}` or one of `:-`, `-`, `:+`, `+`; that name is referenced. Any other `$` puts the workspace under AC3.
- Referenced names form a worklist: for each, the start environment's value under its `comparable` spelling (every value, on Windows, of names that fold to it) is scanned in turn; a name already visited is skipped. Values an env file gives need no second scan, since the whole text of every listed file is scanned.
- A referenced name counts by value when an entry names it. A set variable counts by value when an entry names it and a prefix of any of the workspace's reported env sources begins it.
- The scan reads the raw text, comments included, since each parser drops a comment and a stray `$` there only counts more (Q2).
- The reason AC7 logs is the first path found: the env file, and the variable whose value it passed through when it came from a value.

#### Current structure of the modified files

Read on `main` at `0ab2339` (03:21 to 03:30); 2.3n's changes taken from its ticket, since Tree 1 held no edit yet. Line counts by `wc -l`; lint's cap is 500 code lines.

- `inputs/environment-digest.ts` (126 lines): `FOLDS_CASE`, `SESSION_VARIABLES` (its docblock ends "though Vite's `.env` expansion and `envPrefix` can carry one to a test"), `EnvironmentCount { digest, byValue, sessionEntriesSet }`, `countEnvironment(environment, declared)`, `variableEntryProblem`, private `comparable` and `names`. 2.3n adds the start environment's type, the function that copies `process.env`, and the per-executor-process environment builder.
- `inputs/declared-non-inputs.ts` (241 lines): today `readonly #startEnvironment = { ...process.env }` and `#environment: EnvironmentCount`, recounted in `read()`; `get environment(): string` returns the digest; `report()` calls `#reportEnvironment`, which writes `environmentText` (`environment: counted by value: ...; counted only as set, from RT Test's session list: ...; declared in rt-test.json: ...`) when it changed. 2.3n passes the start environment through the constructor in place of the field's own copy.
- `inputs/fingerprint.ts` (425 lines): `SnapshotReads(root, environment)`, `readonly environment: string`, `envFileDigest(path)` cached by `readOnce`; `workspaceFingerprint(project, entry, reads, narrowed?)` and `discoveryFingerprint(project, discovery, reads)` check `workspaceEnvFilesKnown` or `discoveryEnvFilesKnown` first, then `listedDigests`, then `digestOf({ ...sharedParts(reads.environment), ... })`; `envFileDigests` takes a held digest through `heldEnvDigest` without reading, and returns "the env file <path> cannot be read: <reason>" on a failed read. 2.3n makes the `environment` and `reads` arguments required and deletes `NO_DECLARED_VARIABLES`.
- `inputs/env-files.ts` (154 lines): `projectEnvFiles`, `workspaceEnvFilesKnown`, `discoveryEnvFilesKnown`, `envFileDigest(path)` (stat, refuse a FIFO, open non-blocking, digest a regular file's content, absent otherwise), `EnvFileDigest`.
- `inputs/current-inputs.ts` (201 lines): `InputsMoment.environment: string`, "The environment's digest under the declaration in effect, which every fingerprint of the moment takes"; `currentInputs` builds `new SnapshotReads(inputs.root, environment)`.
- `inputs/input-tracker.ts` (595 lines on `main`): `current()` passes `environment: this.#declared.environment` to `currentInputs`. Expected unedited.

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.3o` over the file list (03:29) named 2.3l, 2.3n, 2.4b and 2.4d; its folder-only hits are those tickets' own test-folder lines.

- **2.3n** (building in Tree 1, lands first): writes `environment-digest.ts`, `declared-non-inputs.ts`, `fingerprint.ts`, `input-tracker.ts`, `daemon-main.ts`, `executor.ts`, and the tests `input-tracker.test.ts`, `executor.test.ts`, `lifecycle.test.ts`, `env-files.test.ts`, `discover-tests.test.ts`. This ticket builds on its shape (the re-read task). Its Decisions: "Where the copy lives. `DeclaredNonInputs` keeps it for the digest, as today; 2.3o ... reads it there."
- **2.3l** (building in Tree 2): writes `query.test.ts` (its `WorkspaceSchedule` helper and schedule queries) and reads `fingerprint.ts`; no production file is shared.
- **2.4d** (ready-for-dev, order against this ticket not set): writes `input-tracker.ts`, `query.test.ts` and `input-tracker.test.ts` in other regions; this ticket expects not to edit `input-tracker.ts`.
- **2.4b** (ready-for-dev): reads `ProjectInputs`, `current-inputs.ts`' narrowing and `workspaceEnvFilesKnown`; it constructs no `SnapshotReads` (2.3n's ticket), so the new `environment` object does not reach it.

#### Existing tests this change breaks

Found by `rg -ln "countEnvironment|SnapshotReads|\.environment\b|environment:" packages/daemon/test` (03:25) on `main`, before 2.3n; re-run it with `envFileDigest` added on the landed tree, then `bun run typecheck`. Then find the tests that break by behavior at an unchanged shape: env file fixtures holding a `$` (AC1, AC3), fixtures whose env prefix begins a listed or declared name (AC2), and tests that assert the whole daemon log or that no warning is logged (AC7).

- `packages/daemon/test/query.test.ts`: `viewOf` passes `environment: countEnvironment(process.env, []).digest` to `currentInputs`.
- `packages/daemon/test/input-tracker.test.ts`: two `new SnapshotReads(root)` calls in `workspaceFingerprint(...)` (2.3n adds their environment argument), and the "environment's count" describe (D2935 to D2944, D2964 to D2968), which calls `countEnvironment(environment, [])` and reads the `environment:` log line; their meaning holds under AC5.
- `packages/daemon/test/env-files.test.ts` and `packages/daemon/test/discover-tests.test.ts`: each fingerprint call 2.3n gives a `SnapshotReads`, and `env-files.test.ts`' tests of `envFileDigest` if its shape changes.

#### Named-defect records the edits reach

A lane re-proves every record whose test or mutated file it edits. By each record's `file` in `packages/daemon/test/defects.json` at `0ab2339`: `input-tracker.ts` 33, `fingerprint.ts` 26, `env-files.ts` 23, `environment-digest.ts` 17, `declared-non-inputs.ts` 14, `current-inputs.ts` 11. Recount on the landed tree, since 2.3n re-anchors some of them. List for create-tests every record, whatever its `file`, whose `new` text constructs `SnapshotReads`, reads `.environment` as a digest string, or calls `envFileDigest` or `countEnvironment` with a changed signature (`rg -n "SnapshotReads|\.environment\b|envFileDigest|countEnvironment" packages/daemon/test/defects.json`): C38 counts each as a consumer, and the typecheck never reads it. D2943's mutation replaces `this.#startEnvironment,` in `read()`'s `countEnvironment` call; 2.3n may move that anchor first.

#### Sizing

Raw 14 files, estimated 18.2; code units 8 (seven criteria plus validation). Production: create `inputs/carried-variables.ts`; modify `inputs/environment-digest.ts`, `inputs/declared-non-inputs.ts`, `inputs/fingerprint.ts`, `inputs/env-files.ts`, `inputs/current-inputs.ts`. Tests, for create-tests: `input-tracker.test.ts`, `query.test.ts`, `env-files.test.ts`, `discover-tests.test.ts`, `defects.json`. Docs, through the orchestrator: `docs/architecture.md`, `README.md`, `docs/glossary.md`. Above 10 estimated files, so dev-ticket delegates the implementation to implementer agents. The production files form one dependency chain through `inputs/` (the scan feeds the count, which feeds the fingerprint), about the 10 the file limit wants for a chain.

#### Doc text

A draft for the orchestrator, its final wording to follow the build.

- `docs/architecture.md`, the input tracker paragraph: after "and any other variable's value, `PATH` and `HOME` included, still stale every result." insert "A listed or declared variable still counts by value for a discovered workspace whose tests Vite can hand it to: when an env file the workspace lists references it in Vite's expansion syntax (`$NAME`, `${NAME}`, or `${NAME` followed by `:-`, `-`, `:+` or `+`), directly or through the value of a variable so referenced, or when one of the workspace's env prefixes begins its name. A listed env file, or a value it reaches, holding any other `$` not preceded by `\` counts every listed and declared variable by value for that workspace, since Vite's expansion can build a name from a substituted value. The discovery's fingerprint counts the union over its discovered workspaces. The log names each such variable per workspace and why, never its value, whenever that changes." Replace "Vitest, Vite and std-env read no listed variable's value, at most whether it is set and non-empty, though Vite's `.env` expansion and `envPrefix` can carry one to a test; a variable the list misses fails toward staleness." with "Vitest, Vite and std-env read no listed variable's value, at most whether it is set and non-empty, apart from what Vite's `.env` expansion and `envPrefix` carry, which counts by value; a variable the list misses fails toward staleness." In Known limits, replace "a listed or declared variable whose value a tracked `.env` file expands into a variable tests see, or that a workspace's `envPrefix` passes through, which counts only as set, so its changed value leaves a stale result current;" with "a listed or declared variable whose value an env file the configuration or a test loads itself expands; the variables a vite-plus task runner hands Vite through its client addon (`VP_RUN_NODE_CLIENT_PATH`), which never enter the daemon's environment; a listed env file holding a `$` in plain text, comments included, such as `DB_PASS=pa$$word`, which counts every listed and declared variable by value for its workspace, so each new terminal or agent session stales it once;", and extend "a workspace whose discovery failed, is unsupported or was not confirmed, which lists no env file" to "... which lists no env file and counts no listed or declared variable by value".
- `README.md`, the environment section: replace "So does a listed or declared variable whose value a tracked `.env` file expands into a variable tests see, such as `VITE_ROOT=$PWD/x`, or that a workspace's `envPrefix` passes through: it counts only as set, so its changed value leaves a stale result current." with "A listed or declared variable that Vite hands a workspace's tests, through an env file such as `VITE_ROOT=$PWD/x` or an `envPrefix` that begins its name, counts by value for that workspace anyway, so a new session stales that workspace's results once. An env file holding a `$` Vite could build a name from, such as `pa$$word`, makes every listed and declared variable count by value for its workspace." In the bullet on the `environment:` line, add "A line per workspace names each listed or declared variable counted by value for it and why."
- `docs/glossary.md`, **Non-input variable**: append "A discovered workspace whose tests Vite can hand one to, through an env file's expansion or an env prefix, counts it by value."

#### Previous ticket

2.3n (ready-for-dev, building in Tree 1): the daemon takes one start environment as it begins serving, hands it to the tracker, whose digest counts it, and to both executors, which start each executor process with it. It keeps the copy in `DeclaredNonInputs` for 2.3o. Its known risks for this ticket: `SnapshotReads`' `environment` and both fingerprint functions' `reads` become required, and D2943's anchor may move.

### References

- Sprint file § Ticket 2.3o, § Ticket 2.3n and the split note after § Ticket 2.3o; 2.3m's ticket § Settled facts (what reaches the worker) and § Decisions (G1, a FIFO leaves no fingerprint); 2.3n's ticket (Tree 1).
- `docs/architecture.md`, the input tracker paragraph and its Known limits; `README.md`, the environment section.
- Open GitHub issues: none (`node scripts/list-open-issues.mjs`, 03:29: "0 open issues, complete").
- Orchestrator rulings Q1 and Q2, 2026-09-30 03:31, on create-ticket's questions of 03:30.
- Grill, 03:34 to 03:35: no further question reached the orchestrator or the owner. The seed's other entries were settled by fact (a referenced unset variable counts by value, by NFR3), by rule (AC3's line at warning level, C32), or change only the code or only count more (AC5's unchanged digest, one log line per workspace, Windows folding, comments scanned).
- Ticket review, one ticket-internal reviewer, 03:35 to 03:40, 12 findings, all applied by create-ticket at 03:41: the sweep task retagged (F1); composition reports each workspace's line, the line's never-a-value and to-none cases stated, and its last-logged state kept in `DeclaredNonInputs` (F2, F3, F11); AC1 carves out AC3 (F4); AC5 conditioned on AC6 (F5); AC6 covers a held digest that differs from the text read (F6, decided by create-ticket: no fingerprint, failing toward staleness for that moment); workspace lines worded as overriding the global `environment:` line (F7, decided by create-ticket); the glossary added to the sizing (F8); the prose sweep widened, test titles going to the Dev Handoff (F9, adjusted); behavior-breaking tests and signature-calling defect records listed for create-tests, and every reader of the changed shapes searched (F10, F12).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C5,C6,C8,C11,C28,C32,C38,C39,C40,C45,C46,C48,C55,C57,C58,C59,C113,C117,C147 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P10,P13,P14,P16,P17,P18,P21,P35 -->

## Execution Metadata

<!--
create-ticket fills this block and dev-ticket parses it. area names each workspace or root tooling area
the ticket touches (packages/core, apps/<name>, scripts, lint, test). Write each file list as a block list,
one `- <path>` per line.
-->

```yaml
area:
  - packages/daemon
is_consolidation: false
sizing_ac_count: 8
files_to_modify:
  - packages/daemon/src/inputs/environment-digest.ts
  - packages/daemon/src/inputs/declared-non-inputs.ts
  - packages/daemon/src/inputs/fingerprint.ts
  - packages/daemon/src/inputs/env-files.ts
  - packages/daemon/src/inputs/current-inputs.ts
files_to_create:
  - packages/daemon/src/inputs/carried-variables.ts
```

## Dev Agent Record

<!--
Written by the sessions after create-ticket. Each heading below is found by exact text: never rename
one, and write None. under any that is empty, since an absent heading reads as nothing to hand over.
-->

### Dev Handoff

Dev session: threadId {{dev_thread_id}}

#### Test Files This Change Broke

None.

#### ACs Owed a Test

None.

#### Tests Owed

None.

### Tests Record

Tests session: threadId {{tests_thread_id}}

#### Named Defects

None.

#### Deliberately Untested

None.

### Review Record

#### Test Coverage Gaps

None.

### Completion Notes

### File List

- _agent-docs/tickets/2-3o-count-carried-env.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (modified by create-ticket: § Ticket 2.3o's scope line and ticket link)
- _agent-docs/sprint-status.yaml (modified by create-ticket: the 2-3o line)

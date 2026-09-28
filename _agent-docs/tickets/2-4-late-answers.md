# Ticket 2.4: Late answers

## Ticket

As the daemon's wait (ticket 2.4b), and every later request whose answer depends on work still to come,
I want the daemon to answer a request once its answer is ready, while it keeps answering everyone else and still stops at once,
so that a client can ask a question whose answer takes minutes without holding any other client, the stop, or the daemon's memory.

## Acceptance Criteria

<!--
Each criterion states an OUTCOME a test or an observation could falsify, never a mechanism. Number
them AC1, AC2, ... and keep the numbers stable: tasks, named defects and review gaps cite them.
-->

- [ ] AC1: A request whose answer is not ready when it arrives is answered on its own connection once the answer is ready, however long that takes. While it is pending, the daemon answers every request on every other connection (hello, status, summary, path status and stop) as it does today, within `RESPONSE_BOUND_MS`.
- [ ] AC2: On one connection, the daemon writes one answer per request, in the order the requests arrived: an answer ready sooner never overtakes an earlier one still pending. A request is unanswered until its answer is written, whether its work is still running (pending) or its answer waits its turn behind a pending one. A connection that has more unanswered requests than a named bound, `MAX_UNANSWERED_REQUESTS`, is closed: the signal of each of its pending requests' work aborts, as AC4 says, and nothing more is written to it.
- [ ] AC3: Once a stop begins, whether a stop request on any connection, a stop signal, or the startup channel's close began it, every pending request (one whose work has not yet answered) is answered at once with the stopping error (`STOPPING_CODE`), its work's signal aborts, and no later answer for it is written; an answer already computed and waiting its turn is written as computed, in order. A stop request on a connection with a pending request is acknowledged as today, after that request's stopping error. A query arriving after the stop began is answered with the stopping error, and a hello or status is answered as today.
- [ ] AC4: When a client closes its connection while a request on it is pending, the signal of that request's work aborts and nothing more is written to the connection; an answer the work gives later is dropped, and a rejection the work gives after the abort ends nothing but that work.
- [ ] AC5: A pending request whose work fails, has nothing to answer, or gives an answer longer than the protocol's line limit is answered with the error a request answered at once gets in that case (`QUERY_FAILED_CODE` or `NOTHING_TO_ANSWER_CODE`, with the same reason).
- [ ] AC6: A client waits for an answer up to the bound its caller gives, and up to `RESPONSE_BOUND_MS` when the caller gives none, as the hello, status, stop and every existing query do today. When no answer has arrived by then, the request rejects with a reason naming the bound, and the connection is closed, so the daemon drops the request (AC4).

## Unverified Assumptions

<!--
Every claim about third-party behavior this ticket could not verify in installed source, phrased as a
question with a one-line way to check it. Never inside an acceptance criterion. create-ticket settles
each row whose answer would change the ticket; dev-ticket resolves the rest first, writing each answer
with the source location it read beneath this table.
Write "None: the ticket calls no third-party behavior this repository has not already exercised." only
when that is literally true.
-->

None: the ticket calls no third-party behavior this repository has not already exercised. It uses Node's `net` sockets as `connectionServer` already does, including the `close` event it already listens for on every connection, and `AbortController`.

## Tasks / Subtasks

<!--
Each task is tagged with the criteria it serves: (AC1), (AC1, AC3), or (Support). The implementer
builds from tasks, so a task's instruction must satisfy the current text of every criterion it names.
No task writes or edits a test: create-tests owns every test change.
-->

- [ ] (Support) Before the first edit, re-read `packages/daemon/src/daemon/server.ts`, `daemon-connection.ts` and `lifecycle.ts` as tickets 2.3f to 2.3i left them, and confirm the names this ticket uses (`DaemonHandlers`, `versionedAnswer`, `queryResponse`, `connectionServer`, `DaemonConnection.request`, `#nextLine`, `DaemonLifecycle.stop`). 2.3i keeps the status response and the handlers' shape; if a sibling changed either, follow it.
- [ ] (AC1, AC2, AC5) In `packages/daemon/src/daemon/server.ts`, let each connection answer through a queue of its unanswered requests: a request's answer is computed as its line arrives, may be a promise, and is written only once every earlier request on the connection has been answered (AC2). Let `DaemonHandlers`' query methods (`summary`, `pathStatus`) answer with their answer or a promise of it, and receive the `AbortSignal` AC3 and AC4 abort; the lifecycle's synchronous methods satisfy that type unchanged, and 2.4b's `wait` is the first to return a promise, then 2.4b's `wait`. Run a late answer through `queryResponse`'s checks once it resolves, so a rejection is `QUERY_FAILED_CODE` and a `NoAnswer` or an overlong answer is `NOTHING_TO_ANSWER_CODE`, exactly as for one answered at once (AC5, C8). Add `MAX_UNANSWERED_REQUESTS`, 8 (G2), beside `CLOSE_GRACE_MS`, labeled with why it bounds memory (C3), and close a connection past it, aborting its pending work's signal as AC4 does (AC2).
- [ ] (AC3) Give `DaemonHandlers` a signal that aborts when the stop begins, and in `packages/daemon/src/daemon/lifecycle.ts` abort it in `stop()` before the stop sequence's first await, since every stop, a stop request, a stop signal or the startup channel's close, goes through `stop()` (`daemon-main.ts`). In the server, on that signal, answer each pending request on every connection with the stopping error, abort its work's signal, and drop its later answer (C157). Keep the stop request's acknowledgement frozen and proven, but begin the stop (`handlers.stop()`) as the stop request arrives, before its acknowledgement is written, so the stop signal answers any earlier pending request on the connection first and the acknowledgement follows it in order; today's order, the acknowledgement then `stop()`, would leave the acknowledgement waiting on an answer only `stop()` gives. Leave `versionedAnswer`'s order as it is: status before the `isStopping()` check, and queries after it (AC3).
- [ ] (AC4) In the server, on a connection's `close`, abort the signal of each request pending on it and discard its queue, so a late answer writes nothing and nothing stays referenced, while the handler attached when its line arrived stays on the dropped promise, so a rejection after the abort (the work's normal response to it) is never unhandled, which would end the daemon (C30); check that the connection is still open with no await between that check and the write (C160).
- [ ] (AC6) In `packages/daemon/src/daemon/daemon-connection.ts`, let `request` take an optional bound in ms, defaulting to `RESPONSE_BOUND_MS`, and name the bound it used in its rejection. Leave every existing caller on the default: `provenRequest` (the hello, and `client.ts`' stop), `query-client.ts`' queries, and `client.ts`' `statusIfServing`, the three sites `rg -n "\.request\(" packages apps` found at 13:21.
- [ ] (Support) Send the orchestrator the doc text in § Doc text, final wording to follow the build.
- [ ] (Support) Lint and typecheck: `bun x oxlint` over the changed files and `bun run typecheck` across the repository, which reports each stand-in the handlers' shape breaks in any workspace (P14).

## Reusable Code

<!--
Check this list before creating any constant, helper or type, and import what exists.
-->

### Reuse

- `queryResponse`, `withType`, `error`, `send` (`daemon/server.ts`): the checks and encoding a late answer goes through once it resolves (AC5).
- `STOPPING_CODE`, `QUERY_FAILED_CODE`, `NOTHING_TO_ANSWER_CODE`, `MAX_LINE_BYTES`, `RESPONSE_BOUND_MS` (`daemon/protocol.ts`): the error codes and bounds, unchanged.
- `ConnectionServer.closeConnections` and `CLOSE_GRACE_MS` (`daemon/server.ts`): how the stop ends each connection once its writes flush; AC3's stopping errors are written before it runs.
- `DaemonConnection.#nextLine` (`daemon/daemon-connection.ts`): the timer AC6 parameterizes.
- `DaemonLifecycle.stop` and `isStopping` (`daemon/lifecycle.ts`): where every stop begins.

### Must Create

- The per-connection answer queue in `server.ts` (AC1, AC2, AC4) and `MAX_UNANSWERED_REQUESTS` (AC2).
- The stop signal `DaemonHandlers` carries and the lifecycle aborts (AC3).
- The optional bound on `DaemonConnection.request` (AC6).

## Dev Notes

<!--
Quote the clause of any ADR, requirement or rule an acceptance criterion rests on; cite everything else.
List each existing test file the change will break, for create-tests. Name the defect class a test
could catch only in the criteria themselves; create-tests decides which tests earn a place.
-->

#### Where this sits

The first of the four tickets the original 2.4 (wait for files) became (orchestrator, 2026-09-28 12:18 and 13:26). This ticket lets the daemon answer a request once its answer is ready; ticket 2.4d makes `status <path>` read its path before answering, the first production answer that is late; ticket 2.4b adds the wait request and `queryWait` over it; ticket 2.4c adds the `rt-test wait` command. Build order: 2.3g, 2.3f, 2.3h, 2.3i, 2.4, 2.4d, 2.4b, 2.4c. Until 2.4d lands, no production request's answer is late: every existing handler answers at once, so production traffic runs through the new queue with each answer ready on arrival, and only the tests exercise a late one (orchestrator, 12:18: "A protocol with no production caller until 2.4b is fine, as 2.3e's selection input was, provided its server and client tests prove the late answer and RESPONSE_BOUND_MS").

Requirement this ticket enables (`docs/requirements.md`), delivered by 2.4b and 2.4c:

- "FR9: Answer `wait <files>` once every test covering those files has a current result or an explicit non-current state, as superseded when a covering input changes after the call, or as unsettled, naming each covering workspace's execution state, when its time limit passes first."

Rule clauses the criteria rest on:

- `daemon/protocol.ts` module comment: "Frozen for every protocol version, so a client of any version can check and stop a daemon of any other: the line framing, the line limit's floor, the hello's type, version and challenge, the stop request, its acknowledgement, the version-mismatch error, and the proof a daemon gives in answer to a challenge." (AC2, AC3: nothing frozen changes; the stop acknowledgement keeps its shape and its proof.)
- `docs/architecture.md`, the `startDaemon` paragraph: "The daemon speaks a versioned protocol of one JSON object per line, and writes nothing to a connection that has not sent it a line." (AC2: one answer per request line, in order.)
- `docs/architecture.md`, the query paragraph: "A query starts no job and changes no activity." (AC1: a pending answer holds nothing else.)
- `docs/architecture.md` § Query surface: "A wait binds to the input revision at call time and returns when every test covering the files has a current result or an explicit non-current state, or as superseded, naming the newer revision, as soon as a covering input changes, or as unsettled, naming each covering workspace's execution state, once its time limit passes." (why a request must be able to wait longer than `RESPONSE_BOUND_MS`)

Glossary (`docs/glossary.md`), verbatim:

- **Wait**: "A query that returns once every test covering the given files has a current result or an explicit non-current state, or earlier as superseded or unsettled."
- **Daemon**: "The local process that alone executes a started consumer's tests and answers queries about them."

#### Orchestrator rulings

Asked by `session_wake` at 12:18 on 2026-09-28, answered at 12:18; decider the orchestrator unless marked. Each reason is the orchestrator's.

- Sizing: the unsplit 2.4 measured about 23 raw files, 30 estimated, and 9 code units. Split three ways (option c): 2.4 the late-answer protocol, 2.4b the daemon wait with the programmatic `queryWait`, 2.4c the `rt-test wait` command and its text, built in that order. Reason: the owner split sprint 2's work to keep each review small, and both the unsplit ticket (30 estimated) and a two-way split's first half (22) pass the limit of 20; the 2.3g exception applied only because a split there would have shipped narrowed fingerprints that looked safe, and here each piece stands alone. The sprint file and `sprint-status.yaml` were granted to this lane for the split.
- Q1 to Q9 settle 2.4b's and 2.4c's design and are recorded in their sprint scope entries: Q1 (read each named file first, then bind), Q2 (covering tests from selection, widening while there is no dependency information), Q3 (what settles a wait, judged again on each change, never on a timer), Q4 (superseded), Q6 (up to 20 named failures), Q7 (exit 0 for every answer), Q8 (Windows spellings resolved by the piece that first takes caller paths, 2.4b's query layer; moved from 2.6), Q9 (files only, a named bound on the number of paths). Q5 went to the owner, who ruled at 12:18 (recorded 13:18): the wait's default limit is about 100 s, under the 2 minutes after which an agent's shell tool kills a call, callers may pass a longer one, and on the limit the wait answers unsettled; that is 2.4b's, and this ticket's client takes whatever bound its caller gives.
- G1 (grill, asked 12:24, answered 13:18; AC3): answer every pending request at the start of a stop with the stopping error, and abort its work's signal, through a stop signal on `DaemonHandlers` that `lifecycle.stop()` aborts. Reason: answering at `closeEndpoint`, the stop sequence's last step, holds the client through the whole sequence (up to 15 s) for an answer the daemon will never give.
- G2 (grill, asked 12:24, answered 13:18; AC2): past `MAX_UNANSWERED_REQUESTS`, 8, close the connection and abort its pending work. Reason: pausing reads would hide the client's close, so the pending work would run on for a client that is gone.
- Ticket review (create-ticket 6c, 13:19 to 13:21): 7 findings, all applied. F1 keeps a hello or status during a stop answered as today, since `versionedAnswer` answers status before its `isStopping()` check; F2 begins the stop before the acknowledgement is written, which would otherwise wait on an answer only the stop gives; F3 names the startup channel's close among AC3's stop paths; F4 keeps a rejection handler on a dropped late answer (C30); F5 widens the typecheck to the repository (P14); F6 backs the client's caller list with its search, which also corrected it (the stop goes through `provenRequest`); F7, a question settled by create-ticket from the criteria themselves, defines pending as a request whose work has not answered, so only those get the stopping error, and restates "holds nothing" as what a test observes.
- G3 (grill, 12:24, agreed 13:18; AC6): the client's default bound stays `RESPONSE_BOUND_MS` for the hello, status, stop and both queries; only a caller that passes its own bound waits longer.

#### Design notes

- **Why a queue per connection.** The client matches each answer to its request by position (`DaemonConnection.#nextLine` takes the next line), so an answer written out of order would answer the wrong request. Today every answer is written in the same turn its line arrives, which keeps the order for free; a late answer breaks that unless the connection writes in request order (AC2).
- **Why a bound, and why close rather than pause.** Every current client sends one request after its hello, but a connection that keeps sending lines behind a pending answer would make the daemon hold each answer, each up to 1 MiB. Pausing the socket would bound that too, but a paused socket reads nothing, so the daemon would not see the client close it, and the pending work would run on for a client that is gone (AC4). Closing the connection past the bound keeps both.
- **Why the stop answers at its start.** The stop sequence aborts the executor, stops the tracker and waits for the job in progress, up to 15 s, before `closeEndpoint` calls `closeConnections`. A pending request answered only then would hold its client for the whole sequence for an answer the daemon will never give; answering it with the stopping error when the stop begins tells the client at once, and aborting its work keeps it from reading the store after the store closes (AC3).
- **Why the default bound stays.** `RESPONSE_BOUND_MS` is how long any existing request may take (two store waits); a hello or a status that took longer means the daemon is not answering, and the client should say so rather than hang. Only a caller that knows its request waits on work passes a longer bound (AC6); 2.4d's `queryPathStatus` is the first, then 2.4b's `queryWait`.
- **Not changed.** `PROTOCOL_VERSION` stays 1: no message changes shape. No request type is added; 2.4b adds the wait request, which an older daemon answers with the unknown-request error that `query-client.ts` already turns into "predates this query".
- **Scope of the analysis.** Analyzed: a late answer beside other connections, order on one connection, a stop from each entry point with requests pending, a client that closes, a failing, empty or overlong late answer, and the client's bound. Not analyzed: what the wait computes, when it settles, and its time limit (2.4b), and the command (2.4c).

#### Pending siblings and their routing

`node scripts/list-unbuilt-work.mjs --except 2.4` over the unsplit ticket's files (12:14) named 2.3f, 2.3g, 2.3h and 2.3i. Of this ticket's three production files, 2.3g, 2.3f, 2.3h and 2.3i each write `lifecycle.ts`, and 2.3i reads `server.ts` (its `DaemonHandlers` and the status response it keeps); none writes `server.ts` or `daemon-connection.ts`. All four build before this ticket, so each is a shape it builds on, never a collision:

- **2.3g, 2.3f, 2.3h, 2.3i** (authored, not built): each changes `lifecycle.ts` (the dependency builds, the scheduler, the interruption, the schedule in the view). This ticket adds only the stop signal to `stop()`, which none of them moves: `stop()` stays `this.#stopping ??= this.#stopSequence()...`, and the stop sequence gains their executors and scheduler.
- **2.4b** (backlog, builds after this ticket): adds the wait request type and `DaemonHandlers.wait`, returning a promise over this ticket's queue and signal, and `queryWait`, passing its own bound to `DaemonConnection.request`.
- **2.4c** (backlog, builds after 2.4b): the command; it names no file here.
- **2.4d** (backlog, builds after this ticket, before 2.4b; orchestrator 13:26): `status <path>` reads its path before answering, so `pathStatus` answers with a promise over this ticket's queue, and `queryPathStatus` passes a bound of its own.
- **Change requests #31 and #35** (in flight on main): #31 changes `selection/*` and the selection policy version; #35 changes tsconfig `extends` resolution in `selection/tsconfig-edges.ts`. Neither touches this ticket's files.

#### Sizing

About 6 raw files and 8 estimated; code units 7 (6 criteria plus validation). Production: `daemon/server.ts`, `daemon/daemon-connection.ts`, `daemon/lifecycle.ts`. Tests, for create-tests: `packages/daemon/test/server.test.ts` (the late answer, order, stop and close through `connectionServer` on a test endpoint; the client's bound through `DaemonConnection` against the same endpoint), `packages/daemon/test/lifecycle.test.ts` (the stop signal aborts when `stop()` begins), and `packages/daemon/test/defects.json`. Under 10 estimated, so dev builds it alone.

#### Current structure of the modified files

As of wt/1 at 8d03112, before 2.3g to 2.3i land.

- `packages/daemon/src/daemon/server.ts` (288 lines): `DaemonHandlers { identity, status(), summary(), pathStatus(path), stop(), isStopping() }`; `connectionServer(handlers, log, prove)` returns `{ onConnection, closeConnections }`, keeping a `Set<Socket>`; `serve` decodes lines and calls `answer` for each while the socket is writable; `answer` handles a stop request first (acknowledgement, then `handlers.stop()`), then the mismatched state, an overlong or invalid line, the hello, `hello-required`, and otherwise `send(socket, versionedAnswer(message, handlers))`; `versionedAnswer` checks the protocol version, answers status, answers `STOPPING_CODE` while `isStopping()`, then summary and path status through `queryResponse`, else `UNKNOWN_REQUEST_CODE`; `queryResponse` turns a throw into `QUERY_FAILED_CODE`, a `NoAnswer` into `NOTHING_TO_ANSWER_CODE`, and an answer over `MAX_LINE_BYTES` into `NOTHING_TO_ANSWER_CODE`; `send` writes only while `socket.writable`.
- `packages/daemon/src/daemon/daemon-connection.ts` (115 lines): `DaemonConnection.open(path)`; `request(message)` writes one line and awaits `#nextLine()`; `#nextLine` rejects with "the daemon did not answer within ${RESPONSE_BOUND_MS} ms" and destroys the socket when its timer passes; `#deliver` and `#end` hand lines and errors to the one waiter.
- `packages/daemon/src/daemon/lifecycle.ts` (357 lines before 2.3g): `DaemonLifecycle implements DaemonHandlers`; `stop()` is `this.#stopping ??= this.#stopSequence().finally(() => this.#markStopped())`; `isStopping()` is `this.#stopping !== undefined`; `#stopSequence` aborts the executor, stops the tracker, awaits the sequence, closes the executor and the store, then `closeEndpoint()`, which calls `server.closeConnections()` (`daemon-main.ts`).
- `packages/daemon/src/daemon/daemon-main.ts` (not modified): `serve` builds the lifecycle, then `connectionServer(lifecycle, log, key.prove)`; `STOP_SIGNALS` and the startup channel's close each call `lifecycle.stop()`.

#### Existing tests this change breaks

- `packages/daemon/test/server.test.ts`: `handlers(stopping, queries)` builds a `DaemonHandlers` by hand and gains the stop signal; `Queries` picks `summary` and `pathStatus`, whose widened return type still accepts its stand-ins. Its tests of order, stop and close hold unchanged, since every stand-in answers at once.
- Found by `rg -l "DaemonHandlers|DaemonConnection|connectionServer|RESPONSE_BOUND_MS" packages/daemon/test` (12:16), which finds names in the daemon's tests only; `bun run typecheck` across the repository reports a hand-built shape in any other workspace: also `protocol.test.ts` (pins `RESPONSE_BOUND_MS` at 10,000 ms, unchanged), `daemon.test.ts` (compares a status answer's time against `RESPONSE_BOUND_MS`, unchanged) and `lifecycle.test.ts` (constructs `DaemonLifecycle`, which gains a member but no parameter). The typecheck reports any hand-built shape the search missed (P14).

#### Doc text

A draft for the orchestrator, final wording to follow the build.

- `docs/architecture.md`, the `startDaemon` paragraph, after "The daemon speaks a versioned protocol of one JSON object per line, and writes nothing to a connection that has not sent it a line.": "It answers each connection's requests in the order they arrived, and an answer may come once its work ends rather than at once, while every other connection is answered meanwhile. A stop answers every request still pending with the stopping error, and a client that closes its connection ends the work its pending request started. A client waits for an answer up to the bound its caller gives, 10 s when it gives none."

#### Previous ticket

2.3i (authored in wt/1, not built), the nearest earlier key: it adds each confirmed workspace's execution state and the latest selection's explanation to every answer, and keeps the status response and `DaemonHandlers` as they are. It is in backlog, so it has no dev notes or completion notes yet; the nearest ticket past backlog is 2.3e (done), whose dependency build shares nothing with this ticket's files. `git log --oneline -- packages/daemon/src/daemon/server.ts packages/daemon/src/daemon/daemon-connection.ts` (12:23) shows 8c7ba58 as the latest change to either, a test-reliability commit whose server tests advance the close grace on faked timers; before it, 1.4 (73180cf) and the ADR-0006 hardening (127caee).

### References

- `_agent-docs/sprints/sprint-2-fresh-runs.md` § Ticket 2.4, § Ticket 2.4b, § Ticket 2.4c.
- Ticket 2.3i (`_agent-docs/tickets/2-3i-schedule-answers.md`) and ticket 1.4 (`_agent-docs/tickets/1-4-query-cli.md`), which added the query requests this ticket's queue carries.
- GitHub issues: `node scripts/list-open-issues.mjs` printed `0 open issues, complete` (12:14).

## Checklist Rules

<!--
Rule ids only; expand the current text with node scripts/expand-rules.mjs --from-ticket <this file>.
create-ticket replaces PENDING with the selected ids, or with none when no rule applies.
-->

<!-- CHECKLIST_RULE_IDS: C3,C8,C14,C22,C30,C38,C39,C40,C46,C48,C55,C59,C131,C142,C157,C160 -->

## Project Context Rules

<!--
Rule ids only, expanded the same way as the checklist rules.
-->

<!-- PROJECT_CONTEXT_RULE_IDS: P13,P14,P16,P17,P18,P19,P21,P32,P33 -->

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
sizing_ac_count: 7
files_to_modify:
  - packages/daemon/src/daemon/server.ts
  - packages/daemon/src/daemon/daemon-connection.ts
  - packages/daemon/src/daemon/lifecycle.ts
files_to_create: []
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

- _agent-docs/tickets/2-4-late-answers.md (created by create-ticket)
- _agent-docs/sprints/sprint-2-fresh-runs.md (§ Ticket 2.4 split into § 2.4, § 2.4b and § 2.4c with a split note, § 2.3i, § 2.5 and § 2.6 repointed, under the orchestrator's 12:18 grant)
- _agent-docs/sprint-status.yaml (2-4-wait-for-files replaced by 2-4-late-answers, 2-4b-wait-for-files and 2-4c-wait-command, under the 12:18 grant)
- docs/requirements.md (FR9 amended), docs/glossary.md (Wait amended, Unsettled added), docs/architecture.md (§ Query surface): written by the orchestrator at 13:19 from this lane's drafts

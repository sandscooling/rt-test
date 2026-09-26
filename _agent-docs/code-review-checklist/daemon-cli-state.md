<!--
SHARD: daemon-cli-state. Reviewable checks of the product guarantees in AGENTS.md, for the daemon,
the CLI, the state store and the defect verifier.
Ids are C<n>, flat and unique across every shard. The orchestrator allocates each new id, the next unused number; never renumber.
Maintenance: _agent-docs/rule-maintenance-guide.md. A rule states the check and nothing about its origin.
-->

# Daemon, CLI and State

## Freshness

C113. **Compare fingerprints before calling a result current**: Every path that labels a result current compares its stored input fingerprint with the current one at read time. A missing, empty or unreadable fingerprint yields unknown, never current.

C114. **Compute freshness, never store it**: Freshness is derived at query time from current inputs; no record stores a current or fresh flag that a later edit could leave true.

C115. **Invalidate on an edit you cannot attribute**: A watcher overflow, missed event, branch switch or startup before reconciliation marks every result it could affect as unconfirmed or stale, never none.

C116. **Never promote a run whose inputs moved**: A run whose inputs changed while it ran is recorded as invalidated and rerun from stable inputs; a generation token stops a late completion from replacing a newer result.

C117. **Fingerprint every input that can change a result**: A new input kind (config, setup file, fixture, lockfile, declared environment input, runtime or runner version) joins the fingerprint in the change that starts depending on it.

C118. **Invalidate defect evidence with its inputs**: A defect evidence record binds the test, the mutation, the relevant inputs and the execution configuration, and a change to any of them makes the evidence stale.

## Independent dimensions

C119. **Store each state dimension separately**: Outcome, freshness, execution state, defect evidence and evidence freshness are separate fields; no value encodes two of them, such as a "stale-pass" outcome.

C120. **Update one dimension without writing another**: An operation that changes one dimension (queuing a run, recording an outcome, verifying a defect) leaves the others untouched unless the change invalidates them by rule.

C121. **Keep result kinds apart**: Local test results, typecheck status, backend synchronization and live integration results are separate record kinds, and none changes another's status.

## Identity

C122. **Bind every result to its identities**: A persisted result carries project identity, run identity, input fingerprint and adapter version; a write missing one is rejected, never defaulted.

C123. **Scope every read to one project and worktree**: A query joins on project identity and worktree, so results from another project or checkout never answer it.

C124. **Invalidate on an adapter version change**: Results produced by an older adapter or runner version are not reported current under a newer one.

C125. **Keep test identity stable and distinct**: A test's identity does not depend only on its display name, each parameterized arm has its own identity, and a renamed or duplicate-named test never inherits another test's result.

## Selection

C126. **Widen on uncertain dependencies**: An unresolved import, dynamic import, generated file, framework registry or adapter gap widens the affected selection; uncertainty never narrows it.

C127. **Never exclude a test on coverage alone**: Excluding a test requires a dependency fact. Historical coverage or a prior run's execution trace alone never removes a test from a selection.

C128. **Report selected and total counts**: Every selection result carries the selected count and the total discovered count.

C129. **Explain every selection and fallback**: Each selected test carries its reason, and each broad fallback names the input or uncertainty that triggered it.

C130. **A zero-test selection is not a pass**: A selection or run that executed no tests reports that nothing ran and why, never success.

## Distinct states

C131. **Keep failure kinds distinct**: Collection errors, crashes, timeouts, interruptions, skips and unknown tests each keep their own state; none is coerced to passed or folded into a generic failed.

C132. **A test missing from a run is unknown**: A known test absent from a run's report is recorded as unknown or not run, never passed.

C133. **Never summarize a mixed set as passing**: Any non-passing or unknown member keeps a path, folder or project summary from reading as passed.

C134. **Record module and run errors apart from test outcomes**: Module-level and unhandled run-level errors are recorded on the run, not dropped because no single test failed.

## Defect verification

C135. **Never write a mutation into the consumer's tree**: Defect verification applies each mutation as an isolated transform or in a disposable copy; no code path writes to the consumer's working files, even temporarily.

C136. **Keep a disposable copy inside its task directory**: A sandbox path is verified to lie inside its parent before any recursive delete, and the copy is removed in a `finally`.

C137. **Verify the baseline first**: A mutation experiment runs only after the unmutated baseline passes for the same input snapshot, and ordinary results and mutation runs use separate namespaces.

C138. **Count setup failures as invalid, not detected**: A compile, collection, setup, timeout or unrelated failure makes the experiment invalid or unclear; only an assertion failure in the named test counts as detection.

C139. **Never call an incomplete set verified**: "Verified" requires every defect in the denominator detected; tests with no defect are reported as a gap rather than left out of the count.

## Execution and trust

C140. **Execute only a started, trusted project**: No code path runs a project's tests, loads its Vitest config or imports its files unless that project was explicitly started and trusted. Discovery reads files without executing them.

C141. **Preserve a failed run's output and exit status**: A runner wrapper keeps stdout, stderr and the exit code of a failed run, and no output filter masks the status.

C142. **Leave explicit states on cancellation**: Cancelling or interrupting a run leaves each affected test interrupted or stale, never at its previous outcome as if current.

## Backend independence

C143. **Keep the daemon and store backend-free**: The daemon, state store and core packages import no backend adapter or backend SDK; adapters plug in through the adapter interface.

C144. **Let adapters widen, never silently narrow**: An adapter may add dependency edges or force broader selection; it narrows only through a tested rule, and its result carries its version, completeness and explanation.

## Local state and privacy

C146. **No network egress without approval**: No code sends source, results, environment values or telemetry off the machine.

C147. **Persist digests, not secrets**: Environment inputs are fingerprinted as digests; state, logs and summaries never contain raw environment values or source text.

C148. **Keep local endpoints local**: A daemon endpoint binds to loopback or a local socket, serves only the explicitly started project, and requires authentication when it speaks HTTP.

C149. **Migrate or invalidate on a state schema change**: A change to the persisted state schema ships a migration or invalidates the old records; old records are never read under the new meaning.

C150. **Make a run visible atomically**: A run's results become visible together; a reader never sees a partial run presented as complete.

## CLI output

C151. **Version the JSON output**: Every `--json` payload carries a schema version, and a breaking field change bumps it.

C152. **Keep stdout parseable**: `--json` output goes to stdout alone; diagnostics and warnings go to stderr.

C153. **Fail rather than answer empty**: A CLI command that could not answer exits non-zero with a reason; it never prints an empty success-shaped result.

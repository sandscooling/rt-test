import { appendFileSync } from "node:fs";
import { isMainThread } from "node:worker_threads";
import { EXIT_ENTRY, EXIT_RECORD_ENV, errorText } from "./run-evidence.mjs";

/*
 * Preloaded into the Vitest main process the defect runner spawns. It records how that process ends, since
 * Vitest can exit before any reporter runs or before its own stderr reaches the pipe. It only observes: every
 * hook leaves the exit code, its timing and Node's default handling as they were.
 */

const REJECTION = "unhandledRejection";
/** The wrapper's own frame and the Error line precede the caller's frames. */
const OWN_STACK_LINES = 2;
const CALLER_FRAMES = 4;

const recordPath = process.env[EXIT_RECORD_ENV];
delete process.env[EXIT_RECORD_ENV];

/** Builds and appends one entry; a failure is dropped, since throwing here would replace the ending being recorded. */
function record(path, entryOf) {
  try {
    appendFileSync(path, `${JSON.stringify(entryOf())}\n`);
  } catch {
    return;
  }
}

const callerOf = (marker) =>
  String(marker.stack)
    .split(/\r?\n/)
    .slice(OWN_STACK_LINES, OWN_STACK_LINES + CALLER_FRAMES)
    .map((line) => line.trim().replace(/^at /, ""))
    .join(" < ");

/**
 * Listens for unhandled rejections only while another listener does, because any listener at all stops Node's
 * default of crashing on one.
 */
function watchRejections(path) {
  let watching = false;
  const onRejection = (reason) =>
    record(path, () => ({
      kind: EXIT_ENTRY.REJECTION,
      error: errorText(reason),
    }));
  process.on("newListener", (event) => {
    if (event !== REJECTION || watching) return;
    watching = true;
    process.prependListener(REJECTION, onRejection);
  });
  process.on("removeListener", (event) => {
    if (event !== REJECTION || !watching) return;
    if (process.listenerCount(REJECTION) > 1) return;
    watching = false;
    process.off(REJECTION, onRejection);
  });
}

function witnessExitCalls(path) {
  const exit = process.exit;
  process.exit = function witnessedExit(...args) {
    const marker = new Error();
    record(path, () => ({
      kind: EXIT_ENTRY.EXIT_CALLED,
      code: args[0] ?? process.exitCode ?? null,
      caller: callerOf(marker),
    }));
    return exit.apply(process, args);
  };
}

function witness(path) {
  record(path, () => ({ kind: EXIT_ENTRY.STARTED, pid: process.pid }));
  process.on("uncaughtExceptionMonitor", (error, origin) =>
    record(path, () => ({
      kind: EXIT_ENTRY.UNCAUGHT,
      origin,
      error: errorText(error),
    })),
  );
  watchRejections(path);
  witnessExitCalls(path);
  process.on("exit", (code) =>
    record(path, () => ({ kind: EXIT_ENTRY.EXITED, code })),
  );
}

if (isMainThread && recordPath) witness(recordPath);

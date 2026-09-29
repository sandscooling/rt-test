import { errorText } from "./error-text.js";

const UNHANDLED_REJECTION = "unhandledRejection";
/** Starts each recorded rejection, so it reads apart from the errors Vitest reports from its workers. */
const RECORDED_LABEL =
  "unhandled rejection on the host thread while the session was open: ";
const OUTSIDE_SESSION_LABEL =
  "unhandled rejection on the host thread while no Vitest session was open: ";
/** Bounds what one session keeps of a rejection raised again and again, such as by a timer that repeats. */
const MAX_RECORDED_REJECTIONS = 100;
const UNRECORDED_SUFFIX =
  " more unhandled rejections on the host thread while the session was open are not recorded";

type Emit = (event: string | symbol, ...args: unknown[]) => boolean;

interface Recording {
  readonly rejections: string[];
  unrecorded: number;
}

/** The session in progress's recording; undefined while no session records. */
let recording: Recording | undefined;
let guarded = false;

/**
 * Keeps an unhandled rejection raised on this thread from ending the process: neither the listener every Vitest
 * instance adds, which ends it, nor Node's default throw receives one. While a session records, a rejection becomes
 * one of that session's, up to the bound; each it keeps, and each raised while no session records, is logged to
 * stderr, which the daemon's log receives. Node emits the event through `process.emit`, which this replaces, but in
 * `--unhandled-rejections=strict` mode ends the process first, so call it only in a process that exists to host
 * Vitest sessions and runs in another mode.
 */
export function guardHostRejections(): void {
  if (guarded) return;
  guarded = true;
  const emit = process.emit;
  const guardedEmit: Emit = (event, ...args) => {
    if (event !== UNHANDLED_REJECTION) {
      return Reflect.apply(emit, process, [event, ...args]) as boolean;
    }
    takeRejection(errorText(args[0]));
    return true;
  };
  process.emit = guardedEmit as typeof process.emit;
}

function takeRejection(text: string): void {
  const open = recording;
  if (open === undefined) {
    logRejection(`${OUTSIDE_SESSION_LABEL}${text}`);
    return;
  }
  if (open.rejections.length >= MAX_RECORDED_REJECTIONS) {
    open.unrecorded += 1;
    return;
  }
  const recorded = `${RECORDED_LABEL}${text}`;
  open.rejections.push(recorded);
  logRejection(recorded);
}

function logRejection(line: string): void {
  process.stderr.write(
    `${new Date().toISOString()} executor ${process.pid}: ${line}\n`,
  );
}

/**
 * Runs `body` while recording each unhandled rejection the guard takes, and returns them, each labelled, beside its
 * value. Node reports a rejection only once the microtasks queued with it have run, so recording lasts one
 * macrotask past the body's end.
 */
export async function recordingHostRejections<T>(
  body: () => Promise<T>,
): Promise<{ readonly value: T; readonly rejections: readonly string[] }> {
  const outer = recording;
  const own: Recording = { rejections: [], unrecorded: 0 };
  recording = own;
  try {
    const value = await body();
    await nextMacrotask();
    return { value, rejections: recordedRejections(own) };
  } finally {
    recording = outer;
  }
}

function recordedRejections(own: Recording): readonly string[] {
  if (own.unrecorded === 0) return own.rejections;
  return [...own.rejections, `${own.unrecorded}${UNRECORDED_SUFFIX}`];
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

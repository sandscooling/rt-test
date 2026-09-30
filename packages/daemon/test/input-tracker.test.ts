import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  watch,
  writeFileSync,
  type BigIntStats,
  type FSWatcher,
  type PathLike,
  type WatchEventType,
  type WatchListener,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  crashError,
  WatchedChild,
  type ChildEnd,
} from "../../../test/scripts/child-end.js";
import { recordStarted } from "../../../test/scripts/run-cleanup.mjs";
import { daemonEntryPoint } from "../src/daemon/entry-point.js";
import {
  countEnvironment,
  SESSION_VARIABLES,
} from "../src/inputs/environment-digest.js";
import {
  discoveryFingerprint,
  ProjectInputs,
  protectedFileChangedSince,
  SnapshotReads,
  workspaceFingerprint,
  type FingerprintResult,
} from "../src/inputs/fingerprint.js";
import { gitSources } from "../src/inputs/git-sources.js";
import {
  readEntryDigest,
  type InputRead,
} from "../src/inputs/input-inventory.js";
import { JobWindows } from "../src/inputs/input-jobs.js";
import { InputTracker } from "../src/inputs/input-tracker.js";
import {
  declaredNonInputs,
  readNonInputs,
  type NonInputsDeclaration,
} from "../src/inputs/non-inputs.js";
import { protection } from "../src/inputs/protection.js";
import { readCheckedIgnored } from "../src/selection/git-ignored.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import { readJson, ROOT_PATH } from "../src/vitest/find-workspaces.js";
import type {
  EnvSource,
  SelectionFacts,
} from "../src/vitest/selection-facts.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  eventually,
  memoryLog,
  withEnvironment,
  type MemoryLog,
} from "./daemon-harness.js";
import {
  DISCOVERED_VITEST_VERSION,
  REPO,
  discoveredWorkspace,
  fakeVitest,
  fixtureRepository,
  inTempDir,
  onPlatform,
  projectFacts,
  runTempRoot,
  settle,
  within,
} from "./harness.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn<typeof actual.watch>(actual.watch) };
});

vi.mock("../src/inputs/input-inventory.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/inputs/input-inventory.js")>();
  return {
    ...actual,
    readEntryDigest: vi.fn<typeof actual.readEntryDigest>(
      actual.readEntryDigest,
    ),
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn<typeof actual.homedir>(actual.homedir) };
});

vi.mock("../src/vitest/find-workspaces.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/vitest/find-workspaces.js")>();
  return {
    ...actual,
    readJson: vi.fn<typeof actual.readJson>(actual.readJson),
  };
});

vi.mock("../src/selection/git-ignored.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/selection/git-ignored.js")>();
  return {
    ...actual,
    readCheckedIgnored: vi.fn<typeof actual.readCheckedIgnored>(
      actual.readCheckedIgnored,
    ),
  };
});

const { watch: realWatch } =
  await vi.importActual<typeof import("node:fs")>("node:fs");
const { readJson: realReadJson } = await vi.importActual<
  typeof import("../src/vitest/find-workspaces.js")
>("../src/vitest/find-workspaces.js");
const { readEntryDigest: realReadEntryDigest } = await vi.importActual<
  typeof import("../src/inputs/input-inventory.js")
>("../src/inputs/input-inventory.js");

const STATE_DIRECTORY = ".rt-test";
/** Far longer than the tracker takes to read an edit on an idle machine; a wait this long has failed. */
const SETTLE_MS = 10_000;
/** How long after a reconciliation ends the next one runs, as the ticket's requirement states it: 5 minutes. */
const RECONCILE_INTERVAL = 300_000;
/** Two thirds of the interval: one such wait never reaches it, and two in a row pass it. */
const SOONER_THAN_INTERVAL = 200_000;
/** How long events stream before the job ends, enough for the tracker to read several. */
const STREAM_MS = 50;
const RECONCILING = "a reconciliation of the inputs is running";
const FIRST_RECONCILIATION = "the first reconciliation has not ended";
const PERIODIC_STARTED =
  "input reconciliation started: the periodic reconciliation";
const RECONCILIATION_ENDED = "input reconciliation ended";
const RECONCILIATION_STARTED = "input reconciliation started: ";
const IGNORE_RULES_CHANGED_STARTED =
  "input reconciliation started: the ignore rules in .gitignore changed";
/** The soonest after a reconciliation that could not establish the input set that an event starts the next one. */
const LOST_INPUT_SET_RETRY = 10_000;
const LOST_INPUT_SET_RETRY_STARTED =
  "input reconciliation started: an input event arrived while the input set could not be established";
const DECLARATION_FILE = "rt-test.json";
const AN_HOUR_MS = 3_600_000;
const MS_PER_SECOND = 1000;
const DECLARATION_CHANGED_STARTED =
  "input reconciliation started: rt-test.json, which declares the non-inputs, changed";
const UNUSABLE_REASON_PREFIX =
  "rt-test.json declares no non-inputs, so every file stays an input: ";
const UNUSABLE_JSON_REASON = `${UNUSABLE_REASON_PREFIX}it is not valid JSON: `;
const NO_DISCOVERY_REASON =
  "rt-test.json's patterns do not apply, so every file stays an input: no discovery in effect reports which files they may not remove";
const NOT_REPORTED_AT_ROOT_REASON =
  "rt-test.json's patterns do not apply, so every file stays an input: the discovery in effect does not report which files they may not remove for the workspace at the consumer root";
/** A consumer declaring `docs/**`, holding a file it matches and one input. */
const DOCS_DECLARED = {
  [DECLARATION_FILE]: JSON.stringify({ nonInputs: ["docs/**"] }),
  "docs/a.md": "# a\n",
  "src/a.ts": "",
};
/** A consumer declaring `setup/**`, holding a setup file it matches and one input. */
const SETUP_DECLARED = {
  [DECLARATION_FILE]: JSON.stringify({ nonInputs: ["setup/**"] }),
  "setup/a.ts": "export {};\n",
  "src/a.ts": "",
};
const PROTECTION_RESOLVED = "protection resolved";
/** A path no test writes: an event naming it is read as absent, which changes no input and marks no job. */
const NEVER_WRITTEN = "c.ts";
/** The verdict of a job during which the tracker read a change to a.md, and to nothing else. */
const A_MD_CHANGED = {
  fingerprinted: false,
  reason: "its inputs changed while it ran: a.md",
  changedWhileRunning: true,
};
/**
 * The verdict of a job during which the tracker read a change to a.md, after an event on the never-written path it
 * held reads, which found absent counts as a path that came and went.
 */
const HELD_AND_A_MD_CHANGED = {
  fingerprinted: false,
  reason: `its inputs changed while it ran: ${NEVER_WRITTEN}, a.md`,
  changedWhileRunning: true,
};
/** How long before protection a job began, so a file written as the test starts was modified during it. */
const JOB_BEGAN_BEFORE_MS = 60_000;
const TRACKER_MODULE = new URL(
  "../src/inputs/input-tracker.ts",
  import.meta.url,
).href;
/** Far past the idle tracker child's start, first reconciliation and timer on a loaded machine. */
const TRACKER_LIFETIME_MS = 30_000;
const LIFETIME_LINE = "lifetime";
const RECONCILED_LINE = "reconciled";
const IDLE_TRACKER_CHILD = "the idle tracker child";
/**
 * Ends the idle tracker child from a thread of its own, whose timers run however the main thread's event loop is held,
 * writing a line first, so a child whose tracker holds that loop still exits and says why. The worker runs with no
 * Node flags, so it loads nothing through the source hooks before its timer is set.
 */
const LIFETIME_WORKER = [
  'const { writeSync } = require("node:fs");',
  `setTimeout(() => { writeSync(1, "${LIFETIME_LINE}\\n"); process.kill(process.pid, "SIGKILL"); }, ${TRACKER_LIFETIME_MS});`,
].join("\n");
/**
 * Starts a tracker over the root it is given and writes a line once the first reconciliation has ended and another
 * once a timer set after that fires. A tracker that holds the event loop after reconciling never lets the timer fire.
 */
const IDLE_TRACKER_SCRIPT = [
  'const { Worker } = await import("node:worker_threads");',
  `new Worker(${JSON.stringify(LIFETIME_WORKER)}, { eval: true, execArgv: [] }).unref();`,
  "const [trackerModule, root] = process.argv.slice(1);",
  "const { InputTracker } = await import(trackerModule);",
  'const log = { file: "idle-tracker.log", entry() {}, error() {} };',
  "const tracker = new InputTracker({ consumerRoot: root, exclusions: [], log });",
  "tracker.start();",
  "await tracker.firstReconciled();",
  `process.stdout.write("${RECONCILED_LINE}\\n");`,
  'setTimeout(() => { process.stdout.write("timer fired\\n"); void tracker.stop(); }, 50);',
].join("\n");

/**
 * The idle tracker child's stdout lines, from an end the tracker produces once it has reconciled: a clean exit, or the
 * lifetime worker's kill, whose exit status differs by platform. Any other end is the child crashing.
 */
function idleTrackerLines(end: ChildEnd): string[] {
  const lines = end.stdout.split("\n").filter((line) => line !== "");
  const exitedClean = end.code === 0 && end.signal === null;
  const heldToItsLifetime = lines.at(-1) === LIFETIME_LINE;
  if (lines.includes(RECONCILED_LINE) && (exitedClean || heldToItsLifetime)) {
    return lines;
  }
  throw crashError(IDLE_TRACKER_CHILD, end);
}

/** Writes each file, relative to `root`, creating the directories it lies in. */
function writeTree(
  root: string,
  files: Readonly<Record<string, string>>,
): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** A git repository at `root` holding `files`, whose `.gitignore` is `ignore`. */
function repository(
  root: string,
  ignore: string,
  files: Readonly<Record<string, string>> = {},
): (...args: string[]) => string {
  writeTree(root, { ".gitignore": ignore, ...files });
  return fixtureRepository(root);
}

/** The consumer root as one Vitest workspace whose latest discovery lists `testModules` and reports `facts`. */
function workspaceAt(
  root: string,
  testModules: readonly string[] = [],
  facts: SelectionFacts = { reported: true, projects: [] },
): WorkspaceDiscovery {
  return discoveredWorkspace(
    { path: ROOT_PATH, directory: root },
    testModules,
    facts,
  );
}

interface Tracked {
  readonly tracker: InputTracker;
  readonly log: MemoryLog;
  /** The root workspace's current fingerprint, or undefined while none can be computed. */
  readonly fingerprint: () => string | undefined;
}

interface TrackingOptions {
  /** The consumer root as the daemon is given it, when not `root` itself. */
  readonly consumerRoot?: string;
  readonly exclusions?: readonly string[];
  readonly log?: MemoryLog;
  /** Test modules the root workspace's latest discovery lists. */
  readonly testModules?: readonly string[];
  /**
   * The discovery protected before the start, as the lifecycle protects the store's latest: the root workspace listing
   * `testModules` unless given, and none for `null`, as when the store holds no discovery.
   */
  readonly discovery?: TestDiscovery | null;
}

/**
 * Resolves once the tracker has read every path an event named. On Windows the tracker's own listing of a directory
 * raises an event for it, so a reconciliation that has just ended can still have one to read. It polls on
 * `setImmediate`, which the tests that fake `setTimeout` leave real.
 */
async function drained(tracker: InputTracker): Promise<void> {
  const deadline = Date.now() + SETTLE_MS;
  while (tracker.facts().pendingChanges > 0) {
    if (Date.now() >= deadline) {
      throw new Error(
        `${tracker.facts().pendingChanges} changed paths were still unread after ${SETTLE_MS} ms`,
      );
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Starts a tracker over `root`, hands it to `body` once its first reconciliation has ended and been read through, and stops it after. */
async function tracking<T>(
  root: string,
  body: (tracked: Tracked) => Promise<T>,
  options: TrackingOptions = {},
): Promise<T> {
  const log = options.log ?? memoryLog();
  const tracker = new InputTracker({
    consumerRoot: options.consumerRoot ?? root,
    exclusions: options.exclusions ?? [join(root, STATE_DIRECTORY)],
    log,
  });
  const entry = workspaceAt(root, options.testModules);
  const stored =
    options.discovery === undefined
      ? discoveryListing(root, options.testModules ?? [])
      : options.discovery;
  try {
    if (stored !== null) await tracker.protectInputs(stored);
    tracker.start();
    await tracker.firstReconciled();
    await drained(tracker);
    return await body({
      tracker,
      log,
      fingerprint: () => {
        const print = tracker.current().workspaceFingerprint(entry);
        return print.ok ? print.digest : undefined;
      },
    });
  } finally {
    await tracker.stop();
  }
}

/**
 * `tracking` with HOME and XDG_CONFIG_HOME pointed at an empty directory beside `root`, so the tracker watches no git
 * config file another process on the machine reads: on Windows, the first read of one idle for an hour raises a change
 * event, which starts a reconciliation no edit under test caused.
 */
async function trackingOwnGitHome<T>(
  root: string,
  body: (tracked: Tracked) => Promise<T>,
  options: TrackingOptions = {},
): Promise<T> {
  const home = `${root}-git-home`;
  mkdirSync(home);
  const saved = {
    HOME: process.env["HOME"],
    XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"],
  };
  process.env["HOME"] = home;
  process.env["XDG_CONFIG_HOME"] = home;
  try {
    return await tracking(root, body, options);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

/** Waits until the fingerprint can be computed and differs from `from`, and says whether it did. */
function movesFrom(
  tracked: Tracked,
  from: string | undefined,
): Promise<boolean> {
  return eventually(() => {
    const now = tracked.fingerprint();
    return now !== undefined && now !== from;
  }, SETTLE_MS);
}

/**
 * Whether `write` leaves the fingerprint where it was. An input is added after it and removed again, each waited
 * for, so by the time the fingerprint is compared any event the write raised has been read.
 */
async function leavesFingerprint(
  tracked: Tracked,
  root: string,
  write: () => void,
): Promise<boolean> {
  const before = tracked.fingerprint();
  write();
  const sentinel = join(root, "sentinel.ts");
  writeFileSync(sentinel, "a sentinel input");
  await movesFrom(tracked, before);
  const withSentinel = tracked.fingerprint();
  rmSync(sentinel);
  await movesFrom(tracked, withSentinel);
  return tracked.fingerprint() === before;
}

/** A watch that opens and never reports an event, as one whose events are all lost would. */
function silentWatch(): FSWatcher {
  return Object.assign(new EventEmitter(), {
    close: () => undefined,
    ref() {
      return this;
    },
    unref() {
      return this;
    },
  }) as unknown as FSWatcher;
}

interface CapturedWatches {
  /** Each watch's listener, so a test can deliver an event the file system never raised. */
  readonly listeners: WatchListener<string>[];
  /** The path each watch was opened on, as `fs.watch` was given it. */
  readonly paths: string[];
}

/** Opens real watches, recording what each was opened on and keeping its listener. */
function capturingWatches(): CapturedWatches {
  const captured: CapturedWatches = { listeners: [], paths: [] };
  vi.mocked(watch).mockImplementation(((
    path: PathLike,
    options: { recursive?: boolean },
    listener: WatchListener<string>,
  ) => {
    captured.listeners.push(listener);
    captured.paths.push(String(path));
    return realWatch(path, options, listener);
  }) as typeof watch);
  return captured;
}

/** How often a modeled inotify watch looks at its directory. */
const MODEL_POLL_MS = 10;

interface EntryStamp {
  readonly id: string;
  /** Its size and modification time. */
  readonly content: string;
}

type EntryStamps = ReadonlyMap<string, EntryStamp>;

/**
 * What tells one file apart from a later one at the same path: its file id with its birth time, since Linux can give a
 * file created just after a deletion the deleted file's number.
 */
function identityOf(stats: BigIntStats): string {
  return `${stats.ino}:${stats.birthtimeNs}`;
}

/** Each entry of `directory` by name, with its identity, size and modification time; empty once it is gone. */
function entryStamps(directory: string): EntryStamps {
  const stamps = new Map<string, EntryStamp>();
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return stamps;
  }
  for (const name of names) {
    try {
      const stats = lstatSync(join(directory, name), { bigint: true });
      stamps.set(name, {
        id: identityOf(stats),
        content: `${stats.size}:${stats.mtimeNs}`,
      });
    } catch {
      // Removed between the listing and its stat, which the next look reports.
    }
  }
  return stamps;
}

function directoryIdentity(directory: string): string | undefined {
  try {
    return identityOf(statSync(directory, { bigint: true }));
  } catch {
    return undefined;
  }
}

/**
 * A model of Linux inotify, injected as `fs.watch` on every host so Linux's watch path is proven on Windows too, and
 * the only thing the modeled tests' proof rests on beyond the tracker's own code. A watch is bound to the directory it
 * opened on, told apart by file id and birth time; it reports each entry of that directory added, removed or replaced
 * as `rename` and each changed as `change`, by the entry's bare name, and nothing from deeper down; once that directory
 * is gone, even with a new one at its path, it reports the removal under the directory's own name and reports nothing
 * again. It polls, so it models what inotify reports, not how soon.
 */
const inotifyModel = ((
  path: PathLike,
  _options: unknown,
  listener: WatchListener<string>,
) => {
  const directory = String(path);
  const opened = identityOf(statSync(directory, { bigint: true }));
  let seen = entryStamps(directory);
  const look = setInterval(() => {
    if (directoryIdentity(directory) !== opened) {
      clearInterval(look);
      listener("rename", basename(directory));
      return;
    }
    const now = entryStamps(directory);
    for (const [name, stamp] of now) {
      const before = seen.get(name);
      if (before?.id !== stamp.id) listener("rename", name);
      else if (before.content !== stamp.content) listener("change", name);
    }
    for (const name of seen.keys()) {
      if (!now.has(name)) listener("rename", name);
    }
    seen = now;
  }, MODEL_POLL_MS);
  look.unref();
  return Object.assign(new EventEmitter(), {
    close: () => clearInterval(look),
    ref() {
      return this;
    },
    unref() {
      return this;
    },
  }) as unknown as FSWatcher;
}) as typeof watch;

interface LostInputSetRetry {
  /** Whether a retry started within half the back-off after the event. */
  readonly early: boolean;
  /** Whether a retry started by the back-off's end. */
  readonly due: boolean;
  /** The reconciliation's state once a started retry has ended. */
  readonly state: string;
}

/**
 * Fails the first reconciliation with a directory past the depth bound, removes it, reports the removal through the
 * root's watch, and says when a reconciliation followed. The watches are silent, so no event the file system raises
 * starts a reconciliation of its own. Only `setTimeout` is fake, so the back-off, timed from the real clock, is
 * already shortened by the setup; half of it is the early mark.
 */
async function retryAfterLostInputSet(
  root: string,
): Promise<LostInputSetRetry> {
  const deep = `${Array(65).fill("d").join("/")}/x.ts`;
  writeTree(root, { "src/a.ts": "", [deep]: "" });
  const { listeners, paths } = silentCapturedWatches();
  try {
    return await withFakeTimeouts(() =>
      tracking(root, async ({ tracker, log }) => {
        rmSync(join(root, "d"), { recursive: true });
        listeners[paths.indexOf(root)]?.("rename", "d");
        await drained(tracker);
        await vi.advanceTimersByTimeAsync(LOST_INPUT_SET_RETRY / 2);
        const early = log.entries.includes(LOST_INPUT_SET_RETRY_STARTED);
        await vi.advanceTimersByTimeAsync(LOST_INPUT_SET_RETRY / 2);
        const due = log.entries.includes(LOST_INPUT_SET_RETRY_STARTED);
        await settled(tracker);
        return { early, due, state: tracker.facts().reconciliation.state };
      }),
    );
  } finally {
    vi.mocked(watch).mockReset();
  }
}

/** Resolves once no reconciliation is running, polling on `setImmediate`, which fake `setTimeout` leaves real. */
async function settled(tracker: InputTracker): Promise<void> {
  const deadline = Date.now() + SETTLE_MS;
  while (tracker.facts().reconciliation.state !== "complete") {
    const facts = tracker.facts().reconciliation;
    if (facts.state === "incomplete" && facts.reason !== RECONCILING) return;
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Runs `body` with fake `setTimeout`, so a test reaches the periodic reconciliation without waiting for it. */
async function withFakeTimeouts<T>(body: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    return await body();
  } finally {
    vi.useRealTimers();
  }
}

/**
 * Runs `body` with fake `setTimeout` and a fake `performance` clock that moves only as the test advances it, so the
 * time between two reconciliations' ends is the time the test advanced.
 */
async function withFakeElapsed<T>(body: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  try {
    return await body();
  } finally {
    vi.useRealTimers();
  }
}

/**
 * Runs `body` with fake `setTimeout` and a fake `Date` that moves only as the test advances it, so a read the tracker
 * takes later is stamped later without a real wait.
 */
async function withFakeClock<T>(body: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    return await body();
  } finally {
    vi.useRealTimers();
  }
}

/** What a job's window recorded: the changed paths and the causes that name none. */
interface WindowFacts {
  readonly paths: readonly string[];
  readonly causes: readonly string[];
}

/**
 * Over a tracker `track` starts on `root`, with silent watches, opens a job, writes the root-relative `path` and
 * removes it again, then delivers the one event naming it, which its read finds absent. Hands back what the job's
 * window recorded once the job has ended.
 */
async function windowAfterTransient(
  root: string,
  path: string,
  track: typeof tracking,
): Promise<WindowFacts> {
  const watches = silentCapturedWatches();
  try {
    return await track(root, async ({ tracker }) => {
      const mark = tracker.beginJob();
      const absolute = join(root, ...path.split("/"));
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, "a file that came and went\n");
      rmSync(absolute);
      deliver(watches, root, join(...path.split("/")));
      await tracker.endJob(mark);
      return {
        paths: [...mark.window.paths],
        causes: [...mark.window.causes],
      };
    });
  } finally {
    vi.mocked(watch).mockReset();
  }
}

/** Opens silent watches, keeping each one's listener, so only the events a test delivers reach the tracker. */
function silentCapturedWatches(): CapturedWatches {
  const captured: CapturedWatches = { listeners: [], paths: [] };
  vi.mocked(watch).mockImplementation(((
    path: PathLike,
    _options: unknown,
    listener: WatchListener<string>,
  ) => {
    captured.listeners.push(listener);
    captured.paths.push(String(path));
    return silentWatch();
  }) as typeof watch);
  return captured;
}

/** Delivers an event naming the root-relative `name` through the watch opened on `root`. */
function deliver(
  watches: CapturedWatches,
  root: string,
  name: string,
  kind: WatchEventType = "change",
): void {
  const listener =
    watches.listeners[watches.paths.indexOf(realpathSync.native(root))];
  if (listener === undefined) throw new Error(`no watch opened on ${root}`);
  listener(kind, name);
}

type ReadChange = (read: InputRead) => InputRead;

/** Makes the tracker's next read of a path an event named report what `change` makes of the real read. */
function changeNextRead(change: ReadChange): void {
  vi.mocked(readEntryDigest).mockImplementationOnce(async (path, signal) => {
    const entry = await realReadEntryDigest(path, signal);
    return entry.kind === "input"
      ? { kind: "input", read: change(entry.read) }
      : entry;
  });
}

/** A read taken `ms` after the later of the input's modification and change times. */
function takenAfterLastWrite(ms: number): ReadChange {
  return (read) => ({
    ...read,
    stamp: {
      ...read.stamp,
      readAtMs: Math.max(read.stamp.modifiedMs, read.stamp.changedMs) + ms,
    },
  });
}

/** A read taken `ms` after the input's change time. */
function takenAfterChange(ms: number): ReadChange {
  return (read) => ({
    ...read,
    stamp: { ...read.stamp, readAtMs: read.stamp.changedMs + ms },
  });
}

/**
 * Sets `file`'s modification time to the whole second `offsetMs` from now, which every supported file system stores
 * exactly, and its access time to now; either moves its change time to now. Returns the modification time set.
 */
function modifiedAt(file: string, offsetMs: number): Date {
  const modified = new Date(
    Math.floor((Date.now() + offsetMs) / MS_PER_SECOND) * MS_PER_SECOND,
  );
  utimesSync(file, new Date(), modified);
  return modified;
}

interface EventAcrossJob {
  /** The root-relative input the events name. */
  readonly name: string;
  /** What the tracker's last read of `name` before the job holds, made from a real read; the reconciliation's when absent. */
  readonly held?: ReadChange;
  /** Runs once the job is open, before its one event. */
  readonly between?: () => void;
  /** What the read after the job's one event reports, made from a real read; that read itself when absent. */
  readonly next?: ReadChange;
}

interface JobAcrossEvent {
  readonly fingerprinted: boolean;
  readonly revisionRose: boolean;
}

/**
 * Tracks `root` over silent watches. Has the tracker read `name` after an event as `held` makes it, opens a job, runs
 * `between`, delivers one event naming `name` whose read `next` makes, and says how the job was judged and whether the
 * input revision rose while it ran.
 */
async function jobAcrossEvent(
  root: string,
  event: EventAcrossJob,
): Promise<JobAcrossEvent> {
  const watches = silentCapturedWatches();
  try {
    return await tracking(root, async ({ tracker }) => {
      const readAfterEvent = async (change?: ReadChange): Promise<void> => {
        if (change !== undefined) changeNextRead(change);
        deliver(watches, root, event.name);
        await drained(tracker);
      };
      if (event.held !== undefined) await readAfterEvent(event.held);
      const revision = tracker.facts().revision;
      const mark = tracker.beginJob();
      event.between?.();
      await readAfterEvent(event.next);
      const verdict = await tracker.endJob(mark);
      return {
        fingerprinted: verdict.fingerprinted,
        revisionRose: tracker.facts().revision > revision,
      };
    });
  } finally {
    vi.mocked(readEntryDigest).mockReset();
    vi.mocked(watch).mockReset();
  }
}

/** The text of an `rt-test.json` declaring `patterns`. */
function declaring(...patterns: string[]): string {
  return JSON.stringify({ nonInputs: patterns });
}

/** The root workspace's discovery, listing `testModules`. */
function discoveryListing(
  root: string,
  testModules: readonly string[],
): TestDiscovery {
  return { workspaces: [workspaceAt(root, testModules)], notRead: [] };
}

/** The root workspace's discovery, listing no test module and reporting `facts`. */
function discoveryReporting(
  root: string,
  facts: SelectionFacts,
): TestDiscovery {
  return { workspaces: [workspaceAt(root, [], facts)], notRead: [] };
}

/** A discovery stored before the store kept selection facts, so no declared pattern may apply. */
function unreportedDiscovery(root: string): TestDiscovery {
  return discoveryReporting(root, { reported: false });
}

/** The root workspace's discovery, whose one project's include patterns are `include`, matched from the root. */
function discoveryIncluding(root: string, ...include: string[]): TestDiscovery {
  return discoveryReporting(root, {
    reported: true,
    projects: [projectFacts({ include })],
  });
}

/** The root workspace's discovery, whose one project reports `setupFiles` and no include pattern. */
function setupDiscovery(
  root: string,
  setupFiles: readonly string[],
): TestDiscovery {
  return discoveryReporting(root, {
    reported: true,
    projects: [projectFacts({ setupFiles })],
  });
}

/**
 * Holds each event read of a file named `name` until `release` is called, so paths queued meanwhile wait behind it.
 * `entered` resolves once such a read has begun.
 */
function holdingReadsOf(name: string): {
  entered: Promise<void>;
  release: () => void;
} {
  let enter = (): void => undefined;
  let release = (): void => undefined;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(readEntryDigest).mockImplementation(async (path, signal) => {
    if (basename(path) === name) {
      enter();
      await released;
    }
    return realReadEntryDigest(path, signal);
  });
  return { entered, release };
}

/** A log line saying which declared patterns are in effect, or that they do not apply. */
function isDeclarationLine(entry: string): boolean {
  return (
    entry.startsWith("non-inputs") ||
    entry.includes(`the patterns ${DECLARATION_FILE} declares`)
  );
}

/** Runs `write`, then says whether a reconciliation ended after it, once the paths it left unread are read. */
async function reconciledAfter(
  tracker: InputTracker,
  write: () => void,
): Promise<boolean> {
  const last = tracker.facts().lastReconciledAt;
  write();
  const reconciled = await eventually(() => {
    const facts = tracker.facts();
    return (
      facts.lastReconciledAt !== last &&
      facts.reconciliation.state === "complete"
    );
  }, SETTLE_MS);
  await drained(tracker);
  return reconciled;
}

/** For each path, the pattern that makes it a declared non-input under `patterns`, with patterns applying and protecting no file. */
function matchedBy(
  patterns: readonly string[],
  paths: readonly string[],
): (string | undefined)[] {
  const match = declaredNonInputs(
    { file: DECLARATION_FILE, state: "declared", patterns },
    protection({ workspaces: [], notRead: [] }, REPO),
  );
  return paths.map((path) => match(path));
}

/** What the reader makes of a consumer root whose `rt-test.json` holds `text`, or what it threw. */
function declarationIn(
  text: string,
): Promise<NonInputsDeclaration | { thrown: string }> {
  return inTempDir((root) => {
    writeFileSync(join(root, DECLARATION_FILE), text);
    return settle(() => readNonInputs(root));
  });
}

/** The state of the declaration the reader makes of `text`, or what it threw. */
async function declarationStateIn(text: string): Promise<string> {
  const declaration = await declarationIn(text);
  return "state" in declaration ? declaration.state : declaration.thrown;
}

/** `count` distinct patterns, each a valid one. */
function patternList(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `docs/${index}.md`);
}

/** The key the environment holds the executable search path under, which Windows spells `Path`. */
function searchPathKey(): string {
  return (
    Object.keys(process.env).find((name) => name.toUpperCase() === "PATH") ??
    "PATH"
  );
}

describe("what the inputs are", { timeout: DAEMON_TEST_TIMEOUT_MS }, () => {
  it("D1888: an edit to an input in a subdirectory changes the workspace fingerprint and raises the input revision", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, { "src/a.ts": "export const a = 1;\n" });
      return tracking(root, async (tracked) => {
        const before = tracked.fingerprint();
        const revision = tracked.tracker.facts().revision;
        appendFileSync(join(root, "src/a.ts"), "// an edit\n");
        return {
          changed: await movesFrom(tracked, before),
          revisionRose: tracked.tracker.facts().revision > revision,
        };
      });
    });
    expect(outcome).toStrictEqual({ changed: true, revisionRose: true });
  });

  it("D1892: a new file git does not ignore, in a directory git listed only because every entry in it was ignored, is an input", async () => {
    const changed = await inTempDir((root) => {
      repository(root, "*.log\n", {
        "newdir/only.log": "",
        "src/a.ts": "",
      });
      return trackingOwnGitHome(root, async (tracked) => {
        const before = tracked.fingerprint();
        writeFileSync(join(root, "newdir/new.ts"), "export {};\n");
        return {
          moved: await movesFrom(tracked, before),
          reconciliations: tracked.log.entries.filter((entry) =>
            entry.startsWith(RECONCILIATION_STARTED),
          ).length,
        };
      });
    });
    // A later reconciliation reads git's listing afresh, so it would find the file whatever the first listing said.
    expect(changed).toStrictEqual({ moved: true, reconciliations: 1 });
  });

  it("D1893: a new file an ignore pattern covers, in a directory no listed ignored directory covers, changes no fingerprint", async () => {
    const unchanged = await inTempDir((root) => {
      repository(root, "*.log\n", { "src/a.ts": "" });
      return tracking(root, (tracked) =>
        leavesFingerprint(tracked, root, () =>
          writeFileSync(join(root, "src/new.log"), "a log line\n"),
        ),
      );
    });
    expect(unchanged).toBe(true);
  });

  it("D1894: a write inside a directory git lists as ignored changes no fingerprint", async () => {
    const unchanged = await inTempDir((root) => {
      repository(root, "build/\n", { "build/old.js": "", "src/a.ts": "" });
      return tracking(root, (tracked) =>
        leavesFingerprint(tracked, root, () =>
          writeFileSync(join(root, "build/out.js"), "built\n"),
        ),
      );
    });
    expect(unchanged).toBe(true);
  });

  it("D1895: a node_modules directory created after the start changes no fingerprint", async () => {
    const unchanged = await inTempDir((root) => {
      writeTree(root, { "src/a.ts": "" });
      return tracking(root, (tracked) =>
        leavesFingerprint(tracked, root, () =>
          writeTree(root, {
            "node_modules/pkg/index.js": "module.exports = 1;\n",
          }),
        ),
      );
    });
    expect(unchanged).toBe(true);
  });

  it("D1896: a write to the state directory changes no fingerprint when the consumer root is given through a link", async () => {
    const unchanged = await inTempDir((dir) => {
      const real = join(dir, "real");
      writeTree(real, {
        "src/a.ts": "",
        [`${STATE_DIRECTORY}/store.sqlite`]: "a store",
        [`${STATE_DIRECTORY}/daemon.log`]: "",
      });
      const link = join(dir, "link");
      symlinkSync(real, link, "junction");
      const stateDirectory = join(link, STATE_DIRECTORY);
      return tracking(
        real,
        (tracked) =>
          leavesFingerprint(tracked, real, () =>
            appendFileSync(join(stateDirectory, "store.sqlite"), "a write"),
          ),
        {
          consumerRoot: link,
          exclusions: [stateDirectory, join(stateDirectory, "daemon.log")],
        },
      );
    });
    expect(unchanged).toBe(true);
  });

  it("D1899: an edit to a listed test module git ignores changes its workspace's fingerprint", async () => {
    const changed = await inTempDir((root) => {
      repository(root, "gen/\n", { "gen/a.test.ts": "it('t', () => {});\n" });
      return tracking(
        root,
        async (tracked) => {
          const before = tracked.fingerprint();
          appendFileSync(join(root, "gen/a.test.ts"), "it('t', () => {});\n");
          const after = tracked.fingerprint();
          return after !== undefined && after !== before;
        },
        { testModules: ["gen/a.test.ts"] },
      );
    });
    expect(changed).toBe(true);
  });
});

describe("a job's inputs", { timeout: DAEMON_TEST_TIMEOUT_MS }, () => {
  it("D1897: a job's end returns while events naming a file never stop arriving, not fingerprinted and naming the file", async () => {
    const outcome = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      // Modified an hour ahead of every read, so no read rules out a write and each event counts against the job.
      modifiedAt(join(root, "src/a.ts"), AN_HOUR_MS);
      const { listeners } = capturingWatches();
      try {
        return await tracking(root, async ({ tracker }) => {
          const mark = tracker.beginJob();
          let streaming = true;
          // One event every turn of the event loop, so one always arrives while the tracker reads the last.
          const stream = (async () => {
            while (streaming) {
              listeners[0]?.("change", join("src", "a.ts"));
              await new Promise((resolve) => setImmediate(resolve));
            }
          })();
          try {
            await new Promise((resolve) => setTimeout(resolve, STREAM_MS));
            const verdict = await within(tracker.endJob(mark), SETTLE_MS);
            return typeof verdict === "string"
              ? verdict
              : {
                  fingerprinted: verdict.fingerprinted,
                  namesFile:
                    !verdict.fingerprinted &&
                    verdict.reason.includes("src/a.ts"),
                };
          } finally {
            streaming = false;
            await stream;
          }
        });
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(outcome).toStrictEqual({ fingerprinted: false, namesFile: true });
  });

  it("D1898: a listed test module git ignores, edited after a job started, is reported as possibly changed during it", async () => {
    const outcome = await inTempDir((root) => {
      repository(root, "gen/\n", { "gen/a.test.ts": "it('t', () => {});\n" });
      const anHourAgo = new Date(Date.now() - 3_600_000);
      utimesSync(join(root, "gen/a.test.ts"), anHourAgo, anHourAgo);
      const discovery: TestDiscovery = {
        workspaces: [workspaceAt(root, ["gen/a.test.ts"])],
        notRead: [],
      };
      return tracking(root, async ({ tracker }) => {
        const since = Date.now();
        const before = tracker
          .current()
          .protectedFileChangedSince(discovery, since);
        appendFileSync(join(root, "gen/a.test.ts"), "// an edit\n");
        const after = tracker
          .current()
          .protectedFileChangedSince(discovery, since);
        return { before, after: after?.includes("gen/a.test.ts") === true };
      });
    });
    expect(outcome).toStrictEqual({ before: undefined, after: true });
  });

  it("D1920: a job during which the watcher reported lost events is not fingerprinted, even once a reconciliation has made it healthy again", async () => {
    const outcome = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const { listeners } = capturingWatches();
      try {
        return await tracking(root, async ({ tracker }) => {
          const mark = tracker.beginJob();
          listeners[0]?.("rename", null as unknown as string);
          await tracker.endJob(tracker.beginJob());
          await drained(tracker);
          return {
            watcher: tracker.facts().watcher.state,
            fingerprinted: (await tracker.endJob(mark)).fingerprinted,
          };
        });
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(outcome).toStrictEqual({ watcher: "healthy", fingerprinted: false });
  });

  it("D1921: a job during which a reconciliation ran and found no change is fingerprinted", async () => {
    const fingerprinted = await inTempDir((root) => {
      writeTree(root, { "src/a.ts": "" });
      return withFakeTimeouts(() =>
        tracking(root, async ({ tracker }) => {
          const mark = tracker.beginJob();
          await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL);
          await tracker.endJob(tracker.beginJob());
          await drained(tracker);
          return (await tracker.endJob(mark)).fingerprinted;
        }),
      );
    });
    expect(fingerprinted).toBe(true);
  });

  it("D2879: an input a job saw change is recorded in its window by the input's root-relative key, never as a cause naming no input", async () => {
    const window = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const watches = silentCapturedWatches();
      try {
        return await tracking(root, async ({ tracker }) => {
          const mark = tracker.beginJob();
          appendFileSync(join(root, "src", "a.ts"), "export {};\n");
          deliver(watches, root, join("src", "a.ts"));
          await tracker.endJob(mark);
          return {
            paths: [...mark.window.paths],
            causes: [...mark.window.causes],
          };
        });
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(window).toStrictEqual({ paths: ["src/a.ts"], causes: [] });
  });

  it("D2893: a file a job saw come and go before its read is recorded in the job's window by its root-relative key", async () => {
    const window = await inTempDir((root) => {
      writeTree(root, { "src/a.ts": "" });
      return windowAfterTransient(root, "src/gone.ts", tracking);
    });
    expect(window).toStrictEqual({ paths: ["src/gone.ts"], causes: [] });
  });

  it("D2894: a file git ignores that a job saw come and go before its read is not recorded in the job's window", async () => {
    const window = await inTempDir((root) => {
      repository(root, "*.tmp\n", { "src/a.ts": "" });
      return windowAfterTransient(root, "src/gone.tmp", trackingOwnGitHome);
    });
    expect(window).toStrictEqual({ paths: [], causes: [] });
  });

  // The tracker drops an event naming a file already declared, so the declaration must come to cover the file between
  // its event and its read for the read to judge it.
  it("D2913: a file a job saw come and go, which the declaration came to cover before its read, is not recorded in the job's window", async () => {
    const goneName = "gone.md";
    const window = await inTempDir(async (root) => {
      writeTree(root, DOCS_DECLARED);
      const watches = silentCapturedWatches();
      try {
        return await trackingOwnGitHome(
          root,
          async ({ tracker }) => {
            const held = holdingReadsOf(goneName);
            const mark = tracker.beginJob();
            const gone = join(root, "docs", goneName);
            writeFileSync(gone, "a file that came and went\n");
            rmSync(gone);
            deliver(watches, root, join("docs", goneName));
            await held.entered;
            const protecting = tracker.protectInputs(
              discoveryListing(root, []),
            );
            held.release();
            await protecting;
            await tracker.endJob(mark);
            return {
              paths: [...mark.window.paths],
              causes: [...mark.window.causes],
            };
          },
          { discovery: unreportedDiscovery(root) },
        );
      } finally {
        vi.mocked(readEntryDigest).mockReset();
        vi.mocked(watch).mockReset();
      }
    });
    expect(window).toStrictEqual({ paths: [], causes: [] });
  });

  it("D2910: an input a reconciliation finds changed, with no event for it, is recorded in the job's window by its root-relative key, never as a cause", async () => {
    const window = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      silentCapturedWatches();
      try {
        return await withFakeTimeouts(() =>
          tracking(root, async ({ tracker }) => {
            const mark = tracker.beginJob();
            appendFileSync(join(root, "src", "a.ts"), "export {};\n");
            await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL);
            await tracker.endJob(mark);
            return {
              paths: [...mark.window.paths],
              causes: [...mark.window.causes],
            };
          }),
        );
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(window).toStrictEqual({ paths: ["src/a.ts"], causes: [] });
  });

  it("D2085: a wait for the inputs to settle, begun after a stop that left an event unread, resolves", async () => {
    const outcome = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const watches = silentCapturedWatches();
      let tracker: InputTracker | undefined;
      let stopping: Promise<void> | undefined;
      const recording = memoryLog();
      const log: MemoryLog = {
        ...recording,
        error: (context, error) => recording.error(context, error),
        entry(message) {
          recording.entry(message);
          if (message.startsWith(RECONCILIATION_ENDED)) {
            deliver(watches, root, "src/a.ts");
            stopping = tracker?.stop();
          }
        },
      };
      tracker = new InputTracker({ consumerRoot: root, exclusions: [], log });
      try {
        tracker.start();
        await tracker.firstReconciled();
        await stopping;
        return await within(
          tracker.settled().then(() => "settled"),
          SETTLE_MS,
        );
      } finally {
        await tracker.stop();
        vi.mocked(watch).mockReset();
      }
    });
    expect(outcome).toBe("settled");
  });
});

describe(
  "an event that may have changed nothing",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    const INPUT = "src/a.ts";
    const CONTENT = "export const a = 1;\n";

    /** A consumer root holding the one input `INPUT`. */
    function oneInput(root: string): string {
      writeTree(root, { [INPUT]: CONTENT });
      return join(root, INPUT);
    }

    it("D2065: an event after which an input reads as the tracker last read it, an hour after its last write, leaves the job fingerprinted and the revision where it was", async () => {
      const outcome = await inTempDir((root) => {
        oneInput(root);
        return jobAcrossEvent(root, {
          name: INPUT,
          held: takenAfterLastWrite(AN_HOUR_MS),
        });
      });
      expect(outcome).toStrictEqual({
        fingerprinted: true,
        revisionRose: false,
      });
    });

    it("D2066: an event after which only an input's content digest differs from the tracker's last read marks the job", async () => {
      const outcome = await inTempDir((root) => {
        oneInput(root);
        return jobAcrossEvent(root, {
          name: INPUT,
          held: takenAfterLastWrite(AN_HOUR_MS),
          next: (read) => ({ ...read, digest: `${read.digest}-other` }),
        });
      });
      expect(outcome.fingerprinted).toBe(false);
    });

    it("D2067: an event after which only an input's modification time differs from the tracker's last read marks the job", async () => {
      const outcome = await inTempDir((root) => {
        oneInput(root);
        return jobAcrossEvent(root, {
          name: INPUT,
          held: takenAfterLastWrite(AN_HOUR_MS),
          next: (read) => ({
            ...read,
            stamp: { ...read.stamp, modifiedMs: read.stamp.modifiedMs + 1 },
          }),
        });
      });
      expect(outcome.fingerprinted).toBe(false);
    });

    it("D2068: an event after which only an input's change time differs from the tracker's last read marks the job", async () => {
      const outcome = await inTempDir((root) => {
        oneInput(root);
        return jobAcrossEvent(root, {
          name: INPUT,
          held: takenAfterLastWrite(AN_HOUR_MS),
          next: (read) => ({
            ...read,
            stamp: { ...read.stamp, changedMs: read.stamp.changedMs + 1 },
          }),
        });
      });
      expect(outcome.fingerprinted).toBe(false);
    });

    it("D2069: an edit reverted with its modification time restored, before the tracker reads the input, marks the job", async () => {
      const outcome = await inTempDir((root) => {
        const file = oneInput(root);
        const modified = modifiedAt(file, -AN_HOUR_MS);
        return jobAcrossEvent(root, {
          name: INPUT,
          held: takenAfterLastWrite(AN_HOUR_MS),
          between: () => {
            const heldChange = statSync(file, { bigint: true }).ctimeNs;
            writeFileSync(file, CONTENT.replace("1", "2"));
            writeFileSync(file, CONTENT);
            // A kernel stamping times from a coarse clock can give this edit the held read's change time, which no read
            // taken 2 s after that time could see; the restore repeats until the change time has moved.
            do {
              utimesSync(file, new Date(), modified);
            } while (statSync(file, { bigint: true }).ctimeNs === heldChange);
          },
        });
      });
      expect(outcome.fingerprinted).toBe(false);
    });

    it("D2070: an event naming a new file, which the tracker held no read of, marks the job", async () => {
      const outcome = await inTempDir((root) => {
        oneInput(root);
        return jobAcrossEvent(root, {
          name: "src/b.ts",
          between: () =>
            writeFileSync(join(root, "src/b.ts"), "export const b = 1;\n"),
        });
      });
      expect(outcome.fingerprinted).toBe(false);
    });

    it("D2071: an event on an input the tracker last read 1999 ms after its last write marks the job, though nothing moved", async () => {
      const outcome = await inTempDir((root) => {
        oneInput(root);
        return jobAcrossEvent(root, {
          name: INPUT,
          held: takenAfterLastWrite(1999),
        });
      });
      expect(outcome.fingerprinted).toBe(false);
    });

    it("D2072: an event on an input the tracker last read exactly 2000 ms after its last write, with nothing moved, leaves the job fingerprinted", async () => {
      const outcome = await inTempDir((root) => {
        oneInput(root);
        return jobAcrossEvent(root, {
          name: INPUT,
          held: takenAfterLastWrite(2000),
        });
      });
      expect(outcome.fingerprinted).toBe(true);
    });

    it("D2073: an event on an input modified an hour ago but changed 1 s before the tracker's last read marks the job, though nothing moved", async () => {
      const outcome = await inTempDir((root) => {
        modifiedAt(oneInput(root), -AN_HOUR_MS);
        return jobAcrossEvent(root, {
          name: INPUT,
          held: takenAfterChange(1000),
        });
      });
      expect(outcome.fingerprinted).toBe(false);
    });

    it("D2074: an event on an input whose modification time lies after the tracker's last read marks the job, though its change time is an hour before that read", async () => {
      const outcome = await inTempDir((root) => {
        modifiedAt(oneInput(root), 2 * AN_HOUR_MS);
        return jobAcrossEvent(root, {
          name: INPUT,
          held: takenAfterChange(AN_HOUR_MS),
        });
      });
      expect(outcome.fingerprinted).toBe(false);
    });

    it("D2079: a link to a file retargeted to another file and back before the tracker reads it marks the job", async () => {
      const outcome = await inTempDir((root) => {
        const target = oneInput(root);
        const other = join(root, "src/other.ts");
        const link = join(root, "src/link.ts");
        writeFileSync(other, "export const other = 1;\n");
        symlinkSync(target, link, "file");
        return jobAcrossEvent(root, {
          name: "src/link.ts",
          held: takenAfterLastWrite(AN_HOUR_MS),
          between: () => {
            const heldChange = lstatSync(link, { bigint: true }).ctimeNs;
            // Repeated until the link's change time has moved, for the coarse clock the edit test above names.
            do {
              rmSync(link);
              symlinkSync(other, link, "file");
              rmSync(link);
              symlinkSync(target, link, "file");
            } while (lstatSync(link, { bigint: true }).ctimeNs === heldChange);
          },
        });
      });
      expect(outcome.fingerprinted).toBe(false);
    });

    it("D2075: an event still unread when a reconciliation reads its input is judged against the read before that reconciliation, so it marks the job", async () => {
      const fingerprinted = await inTempDir(async (root) => {
        // A minute ahead: before it for the first reconciliation's read, long after it for the periodic one's.
        modifiedAt(oneInput(root), 60_000);
        const watches = silentCapturedWatches();
        const recording = memoryLog();
        const log: MemoryLog = {
          ...recording,
          error: (context, error) => recording.error(context, error),
          entry(message) {
            recording.entry(message);
            if (message === PERIODIC_STARTED) deliver(watches, root, INPUT);
          },
        };
        try {
          return await withFakeClock(() =>
            tracking(
              root,
              async ({ tracker }) => {
                const mark = tracker.beginJob();
                await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL);
                await tracker.endJob(tracker.beginJob());
                await drained(tracker);
                return (await tracker.endJob(mark)).fingerprinted;
              },
              { log },
            ),
          );
        } finally {
          vi.mocked(watch).mockReset();
        }
      });
      expect(fingerprinted).toBe(false);
    });

    it("D2076: once a reconciliation finds an input's times moved and its content unchanged, an event on it is judged against the read before, so it marks the job", async () => {
      const fingerprinted = await inTempDir(async (root) => {
        const file = oneInput(root);
        modifiedAt(file, 60_000);
        const watches = silentCapturedWatches();
        try {
          return await withFakeClock(() =>
            tracking(root, async ({ tracker }) => {
              modifiedAt(file, 120_000);
              await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL);
              await tracker.endJob(tracker.beginJob());
              const mark = tracker.beginJob();
              deliver(watches, root, INPUT);
              await drained(tracker);
              return (await tracker.endJob(mark)).fingerprinted;
            }),
          );
        } finally {
          vi.mocked(watch).mockReset();
        }
      });
      expect(fingerprinted).toBe(false);
    });

    it("D2077: a walk of a renamed directory an hour later leaves an event on an input in it judged against the read before the walk, so it marks the job", async () => {
      const fingerprinted = await inTempDir(async (root) => {
        writeTree(root, { "dir/x.ts": CONTENT });
        modifiedAt(join(root, "dir/x.ts"), 60_000);
        const watches = silentCapturedWatches();
        try {
          return await withFakeClock(() =>
            tracking(root, async ({ tracker }) => {
              vi.setSystemTime(Date.now() + AN_HOUR_MS);
              deliver(watches, root, "dir", "rename");
              await drained(tracker);
              const mark = tracker.beginJob();
              deliver(watches, root, "dir/x.ts");
              await drained(tracker);
              return (await tracker.endJob(mark)).fingerprinted;
            }),
          );
        } finally {
          vi.mocked(watch).mockReset();
        }
      });
      expect(fingerprinted).toBe(false);
    });

    it("D2091: a directory replaced by a copy with the same content and other times, walked after both moves, marks the job", async () => {
      const fingerprinted = await inTempDir(async (root) => {
        writeTree(root, { "dir/x.ts": CONTENT });
        const watches = silentCapturedWatches();
        try {
          return await tracking(root, async ({ tracker }) => {
            const mark = tracker.beginJob();
            writeTree(root, { "copy/x.ts": CONTENT });
            modifiedAt(join(root, "copy/x.ts"), -AN_HOUR_MS);
            rmSync(join(root, "dir"), { recursive: true });
            renameSync(join(root, "copy"), join(root, "dir"));
            deliver(watches, root, "dir", "rename");
            await drained(tracker);
            return (await tracker.endJob(mark)).fingerprinted;
          });
        } finally {
          vi.mocked(watch).mockReset();
        }
      });
      expect(fingerprinted).toBe(false);
    });

    it("D2078: a reconciliation that finds an input's content changed, with no event reporting it, moves the fingerprint", async () => {
      const moved = await inTempDir(async (root) => {
        const file = oneInput(root);
        vi.mocked(watch).mockImplementation((() =>
          silentWatch()) as typeof watch);
        try {
          return await withFakeTimeouts(() =>
            tracking(root, async ({ tracker, fingerprint }) => {
              const before = fingerprint();
              appendFileSync(file, "// unreported\n");
              await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL);
              await tracker.endJob(tracker.beginJob());
              const after = fingerprint();
              return after !== undefined && after !== before;
            }),
          );
        } finally {
          vi.mocked(watch).mockReset();
        }
      });
      expect(moved).toBe(true);
    });
  },
);

describe(
  "an input set that cannot be established",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D1900: a listed test module that cannot be read leaves its workspace with no fingerprint, naming the module", async () => {
      const outcome = await inTempDir((root) => {
        mkdirSync(join(root, "src/a.test.ts"), { recursive: true });
        return tracking(root, async ({ tracker }) => {
          const print = tracker
            .current()
            .workspaceFingerprint(workspaceAt(root, ["src/a.test.ts"]));
          return {
            ok: print.ok,
            namesModule: !print.ok && print.reason.includes("src/a.test.ts"),
          };
        });
      });
      expect(outcome).toStrictEqual({ ok: false, namesModule: true });
    });

    it("D1901: a directory 65 levels below the root leaves reconciliation incomplete, naming the 64-level bound", async () => {
      const reconciliation = await inTempDir((root) => {
        writeTree(root, { [`${Array(65).fill("d").join("/")}/x.ts`]: "" });
        return tracking(root, async ({ tracker }) => {
          const facts = tracker.facts().reconciliation;
          return {
            state: facts.state,
            namesBound:
              facts.state === "incomplete" &&
              facts.reason.includes("more than 64 levels"),
          };
        });
      });
      expect(reconciliation).toStrictEqual({
        state: "incomplete",
        namesBound: true,
      });
    });

    it("D1902: a directory exactly 64 levels below the root is read, and reconciliation completes", async () => {
      const state = await inTempDir((root) => {
        writeTree(root, { [`${Array(64).fill("d").join("/")}/x.ts`]: "" });
        return tracking(
          root,
          async ({ tracker }) => tracker.facts().reconciliation.state,
        );
      });
      expect(state).toBe("complete");
    });

    it("D1903: a watch that cannot open leaves the watcher unhealthy with the reason, and the first reconciliation still ends", async () => {
      const outcome = await inTempDir(async (root) => {
        writeTree(root, { "src/a.ts": "" });
        vi.mocked(watch).mockImplementation(((path: PathLike) => {
          throw Object.assign(
            new Error(
              `ENOSPC: System limit for number of file watchers reached, watch '${String(path)}'`,
            ),
            { code: "ENOSPC" },
          );
        }) as typeof watch);
        const tracker = new InputTracker({
          consumerRoot: root,
          exclusions: [],
          log: memoryLog(),
        });
        try {
          tracker.start();
          const reconciled = await within(
            tracker.firstReconciled().then(() => "reconciled"),
            SETTLE_MS,
          );
          const { watcher } = tracker.facts();
          return {
            reconciled,
            watcher: watcher.state,
            namesCause:
              watcher.state === "unhealthy" &&
              watcher.reason.includes("ENOSPC"),
          };
        } finally {
          await tracker.stop();
          vi.mocked(watch).mockReset();
        }
      });
      expect(outcome).toStrictEqual({
        reconciled: "reconciled",
        watcher: "unhealthy",
        namesCause: true,
      });
    });

    it("D1904: a git that cannot be run leaves every file an input, and the facts say git's ignored paths could not be read", async () => {
      const outcome = await inTempDir(async (root) => {
        repository(root, "*.log\n", { "a.log": "a log line\n" });
        const empty = join(root, "..", `${root.split(/[\\/]/).at(-1)}-no-git`);
        mkdirSync(empty);
        const key = searchPathKey();
        const saved = process.env[key];
        process.env[key] = empty;
        const log = memoryLog();
        try {
          return await tracking(
            root,
            async ({ tracker }) => ({
              unread: tracker
                .facts()
                .gitUnread.some((reason) =>
                  reason.startsWith("git's ignored paths could not be read"),
                ),
              everyFile: log.entries.some((entry) =>
                entry.startsWith("input reconciliation ended: 2 inputs"),
              ),
            }),
            { log },
          );
        } finally {
          process.env[key] = saved;
          rmSync(empty, { recursive: true, force: true });
        }
      });
      expect(outcome).toStrictEqual({ unread: true, everyFile: true });
    });
  },
);

describe("reconciliation", { timeout: DAEMON_TEST_TIMEOUT_MS }, () => {
  it("D1905: a commit, which moves the ref HEAD names, runs a reconciliation", async () => {
    const reconciled = await inTempDir(async (dir) => {
      const git = repository(dir, "", { "sub/a.ts": "" });
      git("add", "-A");
      git("commit", "-q", "-m", "first");
      const root = join(dir, "sub");
      return trackingOwnGitHome(root, async ({ tracker }) => {
        const last = tracker.facts().lastReconciledAt;
        git("commit", "-q", "--allow-empty", "-m", "second");
        return eventually(
          () => tracker.facts().lastReconciledAt !== last,
          SETTLE_MS,
        );
      });
    });
    expect(reconciled).toBe(true);
  });

  it("D1922: an edit to the repository's info/exclude runs a reconciliation", async () => {
    const reconciled = await inTempDir(async (dir) => {
      const git = repository(dir, "", { "sub/a.ts": "" });
      git("add", "-A");
      git("commit", "-q", "-m", "first");
      return trackingOwnGitHome(join(dir, "sub"), async ({ tracker }) => {
        const last = tracker.facts().lastReconciledAt;
        appendFileSync(join(dir, ".git/info/exclude"), "*.tmp\n");
        return eventually(
          () => tracker.facts().lastReconciledAt !== last,
          SETTLE_MS,
        );
      });
    });
    expect(reconciled).toBe(true);
  });

  it("D1923: an edit to a .gitignore above the consumer root, inside its repository, runs a reconciliation", async () => {
    const reconciled = await inTempDir(async (dir) => {
      const git = repository(dir, "*.log\n", { "sub/a.ts": "" });
      git("add", "-A");
      git("commit", "-q", "-m", "first");
      return trackingOwnGitHome(join(dir, "sub"), async ({ tracker }) => {
        const last = tracker.facts().lastReconciledAt;
        appendFileSync(join(dir, ".gitignore"), "*.tmp\n");
        return eventually(
          () => tracker.facts().lastReconciledAt !== last,
          SETTLE_MS,
        );
      });
    });
    expect(reconciled).toBe(true);
  });

  it("D1924: a rewrite of packed-refs alone, which can move the ref HEAD names, runs a reconciliation", async () => {
    const reconciled = await inTempDir(async (dir) => {
      const git = repository(dir, "", { "sub/a.ts": "" });
      git("add", "-A");
      git("commit", "-q", "-m", "first");
      // With the branch already packed, the only watched file the next pack rewrites is packed-refs.
      git("pack-refs", "--all");
      git("tag", "loose");
      return trackingOwnGitHome(join(dir, "sub"), async ({ tracker }) => {
        const last = tracker.facts().lastReconciledAt;
        git("pack-refs", "--all");
        return eventually(
          () => tracker.facts().lastReconciledAt !== last,
          SETTLE_MS,
        );
      });
    });
    expect(reconciled).toBe(true);
  });

  it("D1906: an edit to a .gitignore under the root runs a reconciliation", async () => {
    const reconciled = await inTempDir((root) => {
      repository(root, "*.log\n", { "src/a.ts": "" });
      return trackingOwnGitHome(root, async ({ log }) => {
        appendFileSync(join(root, ".gitignore"), "*.tmp\n");
        return eventually(
          () => log.entries.includes(IGNORE_RULES_CHANGED_STARTED),
          SETTLE_MS,
        );
      });
    });
    expect(reconciled).toBe(true);
  });

  it("D1907: a reconciliation runs 5 minutes after the last one ended, and not a millisecond before", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, { "src/a.ts": "" });
      return withFakeTimeouts(() =>
        tracking(root, async ({ log }) => {
          await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL - 1);
          const early = log.entries.includes(PERIODIC_STARTED);
          await vi.advanceTimersByTimeAsync(1);
          return { early, due: log.entries.includes(PERIODIC_STARTED) };
        }),
      );
    });
    expect(outcome).toStrictEqual({ early: false, due: true });
  });

  it("D1961: an event after a reconciliation that could not establish the input set starts one by 10 s after it ended, and the inputs read complete after it", async () => {
    const outcome = await inTempDir(retryAfterLostInputSet);
    expect({ due: outcome.due, state: outcome.state }).toStrictEqual({
      due: true,
      state: "complete",
    });
  });

  it("D1962: an event after a reconciliation that could not establish the input set starts no reconciliation within half the 10 s back-off", async () => {
    const outcome = await inTempDir(retryAfterLostInputSet);
    expect(outcome.early).toBe(false);
  });

  it("D1908: a change no event reported, found by a reconciliation, raises the input revision", async () => {
    const rose = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      vi.mocked(watch).mockImplementation((() =>
        silentWatch()) as typeof watch);
      try {
        return await withFakeTimeouts(() =>
          tracking(root, async ({ tracker }) => {
            const revision = tracker.facts().revision;
            appendFileSync(join(root, "src/a.ts"), "// unreported\n");
            await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL);
            await tracker.endJob(tracker.beginJob());
            return tracker.facts().revision - revision;
          }),
        );
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(rose).toBe(1);
  });

  it("D1909: a watch that reports lost events makes the watcher unhealthy and starts a reconciliation", async () => {
    const outcome = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const { listeners } = capturingWatches();
      try {
        return await tracking(root, async ({ tracker }) => {
          listeners[0]?.("rename", null as unknown as string);
          const facts = tracker.facts();
          return {
            watcher: facts.watcher.state,
            reconciliation: facts.reconciliation.state,
          };
        });
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(outcome).toStrictEqual({
      watcher: "unhealthy",
      reconciliation: "incomplete",
    });
  });

  it("D1910: while a reconciliation runs, no fingerprint is current and the reason says one is running", async () => {
    const reason = await inTempDir((root) => {
      writeTree(root, { "src/a.ts": "" });
      let tracker: InputTracker | undefined;
      const seen: (string | undefined)[] = [];
      const recording = memoryLog();
      const log: MemoryLog = {
        ...recording,
        error: (context, error) => recording.error(context, error),
        entry(message) {
          recording.entry(message);
          if (message === PERIODIC_STARTED) {
            seen.push(tracker?.current().unavailable);
          }
        },
      };
      return withFakeTimeouts(() =>
        tracking(
          root,
          async (tracked) => {
            tracker = tracked.tracker;
            await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL);
            return seen;
          },
          { log },
        ),
      );
    });
    expect(reason).toStrictEqual([RECONCILING]);
  });

  it("D1911: a reconciliation that ends with every watch open returns the watcher to healthy", async () => {
    const watcher = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const { listeners } = capturingWatches();
      try {
        return await tracking(root, async ({ tracker }) => {
          listeners[0]?.("rename", null as unknown as string);
          await tracker.endJob(tracker.beginJob());
          return tracker.facts().watcher;
        });
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(watcher).toStrictEqual({ state: "healthy" });
  });

  it("D1912: no fingerprint is current before the first reconciliation has ended, and one is once it has", async () => {
    const outcome = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const tracker = new InputTracker({
        consumerRoot: root,
        exclusions: [],
        log: memoryLog(),
      });
      try {
        const before = tracker.current().unavailable;
        tracker.start();
        await tracker.firstReconciled();
        await drained(tracker);
        return { before, after: tracker.current().unavailable };
      } finally {
        await tracker.stop();
      }
    });
    expect(outcome).toStrictEqual({
      before: FIRST_RECONCILIATION,
      after: undefined,
    });
  });

  it("D1891: an idle tracker leaves the event loop free once its first reconciliation has ended", async () => {
    const lines = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const child = spawn(
        process.execPath,
        [
          ...daemonEntryPoint("daemon-main").execArgv,
          "--input-type=module",
          "--eval",
          IDLE_TRACKER_SCRIPT,
          TRACKER_MODULE,
          root,
        ],
        { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      const watched = new WatchedChild(child, IDLE_TRACKER_CHILD);
      if (child.pid !== undefined) {
        recordStarted(runTempRoot(), { pids: [child.pid] });
      }
      return idleTrackerLines(await watched.end);
    });
    expect(lines.slice(0, 2)).toStrictEqual(["reconciled", "timer fired"]);
  });
});

describe("the fingerprint's parts", () => {
  it("D1913: the project's digest does not depend on the order its inputs were read in", () => {
    const root = REPO;
    const ascending = new ProjectInputs(
      root,
      new Map([
        ["a.ts", "file:1"],
        ["b.ts", "file:2"],
      ]),
    );
    const descending = new ProjectInputs(
      root,
      new Map([
        ["b.ts", "file:2"],
        ["a.ts", "file:1"],
      ]),
    );
    expect(descending.digest()).toBe(ascending.digest());
  });

  it("D1914: a changed environment variable value changes the workspace fingerprint", async () => {
    const planted = "RT_TEST_PLANTED_VARIABLE";
    const saved = process.env[planted];
    const inputs = new Map([["a.ts", "file:1"]]);
    const digestUnder = async (value: string): Promise<string | undefined> => {
      process.env[planted] = value;
      vi.resetModules();
      const fresh = await import("../src/inputs/fingerprint.js");
      const print = fresh.workspaceFingerprint(
        new fresh.ProjectInputs(REPO, inputs),
        workspaceAt(REPO),
      );
      return print.ok ? print.digest : undefined;
    };
    try {
      const first = await digestUnder("first");
      const second = await digestUnder("second");
      expect(first !== undefined && first !== second).toBe(true);
    } finally {
      if (saved === undefined) delete process.env[planted];
      else process.env[planted] = saved;
    }
  });

  it("D2211: a raised selection policy version changes the workspace fingerprint", async () => {
    const types = "../src/selection/selection-types.js";
    const inputs = new Map([["a.ts", "file:1"]]);
    const digestRaisedBy = async (
      raise: number,
    ): Promise<string | undefined> => {
      vi.resetModules();
      vi.doMock(types, async (importOriginal) => {
        const actual =
          await importOriginal<
            typeof import("../src/selection/selection-types.js")
          >();
        return {
          ...actual,
          SELECTION_POLICY_VERSION: actual.SELECTION_POLICY_VERSION + raise,
        };
      });
      const fresh = await import("../src/inputs/fingerprint.js");
      const print = fresh.workspaceFingerprint(
        new fresh.ProjectInputs(REPO, inputs),
        workspaceAt(REPO),
      );
      return print.ok ? print.digest : undefined;
    };
    try {
      const current = await digestRaisedBy(0);
      const raised = await digestRaisedBy(1);
      expect(current !== undefined && current !== raised).toBe(true);
    } finally {
      vi.doUnmock(types);
      vi.resetModules();
    }
  });

  it("D1915: a change of the Vitest version a workspace resolves changes its fingerprint", async () => {
    const changed = await inTempDir((root) => {
      const project = new ProjectInputs(root, new Map([["a.ts", "file:1"]]));
      const digestNow = (): string | undefined => {
        const print = workspaceFingerprint(project, workspaceAt(root));
        return print.ok ? print.digest : undefined;
      };
      fakeVitest(root, "5.0.1");
      const before = digestNow();
      fakeVitest(root, "5.0.2");
      const after = digestNow();
      return before !== undefined && before !== after;
    });
    expect(changed).toBe(true);
  });

  it("D2534: a listed test module the snapshot holds but the workspace's narrowed inputs leave out still changes its fingerprint", async () => {
    const changed = await inTempDir((root) => {
      const entry = workspaceAt(root, ["src/a.test.ts"]);
      const narrowed = new ProjectInputs(root, new Map([["a.ts", "file:1"]]));
      const digestWith = (module: string): string | undefined => {
        const project = new ProjectInputs(
          root,
          new Map([
            ["a.ts", "file:1"],
            ["src/a.test.ts", module],
          ]),
        );
        const print = workspaceFingerprint(
          project,
          entry,
          new SnapshotReads(root),
          narrowed,
        );
        return print.ok ? print.digest : undefined;
      };
      const before = digestWith("module:1");
      return before !== undefined && before !== digestWith("module:2");
    });
    expect(changed).toBe(true);
  });
});

/** The consumer root's own env source, in Vitest's mode with Vite's default prefix. */
const ROOT_ENV_SOURCE: EnvSource = {
  envDirectory: ".",
  envPrefixes: ["VITE_"],
  mode: "test",
};
const ENV_FILE = ".env";
const LOCAL_ENV_FILE = ".env.local";
/** How the inputs hold a link to anything but a file: by the digest of its target's path. */
const HELD_LINK = "link:9f2c6a1e";

/** The source of a config that loads env files from `directory`, root-relative. */
function envSourceAt(directory: string): EnvSource {
  return { ...ROOT_ENV_SOURCE, envDirectory: directory };
}

/** A workspace at `path` under `root`, listing no test module, with one project per list of env sources. */
function workspaceWithEnv(
  root: string,
  path: string,
  ...projects: (readonly EnvSource[])[]
): WorkspaceDiscovery {
  return discoveredWorkspace(
    { path, directory: path === ROOT_PATH ? root : join(root, path) },
    [],
    {
      reported: true,
      projects: projects.map((envSources, index) =>
        projectFacts({ projectName: `project-${index}`, envSources }),
      ),
    },
  );
}

/** The root workspace's discovery, its one project naming the root's env files. */
function envDiscovery(root: string): TestDiscovery {
  return {
    workspaces: [workspaceWithEnv(root, ROOT_PATH, [ROOT_ENV_SOURCE])],
    notRead: [],
  };
}

function printed(print: FingerprintResult): string | undefined {
  return print.ok ? print.digest : undefined;
}

/** The fingerprint of `entry` over inputs holding `held`, with every file outside them read afresh. */
function envPrint(
  root: string,
  entry: WorkspaceDiscovery,
  held: Readonly<Record<string, string>> = {},
): string | undefined {
  return printed(
    workspaceFingerprint(
      new ProjectInputs(root, new Map(Object.entries(held))),
      entry,
    ),
  );
}

/** Whether `write` moves the fingerprint `print` reads, which must be computed before it. */
function movedBy(
  print: () => string | undefined,
  write: () => void,
): { computed: boolean; changed: boolean } {
  const before = print();
  write();
  const after = print();
  return {
    computed: before !== undefined,
    changed: after !== undefined && after !== before,
  };
}

const MOVED = { computed: true, changed: true };

describe(
  "each workspace's env files",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D3065: an edit to a listed env file git ignores changes its workspace's fingerprint at the next composition", async () => {
      const outcome = await inTempDir((root) => {
        repository(root, `${LOCAL_ENV_FILE}\n`, {
          [LOCAL_ENV_FILE]: "VITE_A=1\n",
          "src/a.ts": "",
        });
        const entry = workspaceWithEnv(root, ROOT_PATH, [ROOT_ENV_SOURCE]);
        return tracking(root, async ({ tracker }) =>
          movedBy(
            () => printed(tracker.current().workspaceFingerprint(entry)),
            () => appendFileSync(join(root, LOCAL_ENV_FILE), "VITE_B=2\n"),
          ),
        );
      });
      expect(outcome).toStrictEqual(MOVED);
    });

    it("D3066: creating a listed env file changes the discovery's fingerprint", async () => {
      const outcome = await inTempDir((root) =>
        movedBy(
          () =>
            printed(
              discoveryFingerprint(
                new ProjectInputs(root, new Map()),
                envDiscovery(root),
              ),
            ),
          () => writeFileSync(join(root, LOCAL_ENV_FILE), "VITE_A=1\n"),
        ),
      );
      expect(outcome).toStrictEqual(MOVED);
    });

    it("D3067: the discovery's fingerprint counts an env file only its second workspace lists", async () => {
      const outcome = await inTempDir((root) => {
        mkdirSync(join(root, "packages/b"), { recursive: true });
        const discovery: TestDiscovery = {
          workspaces: [
            workspaceWithEnv(root, ROOT_PATH, []),
            workspaceWithEnv(root, "packages/b", [envSourceAt("packages/b")]),
          ],
          notRead: [],
        };
        return movedBy(
          () =>
            printed(
              discoveryFingerprint(
                new ProjectInputs(root, new Map()),
                discovery,
              ),
            ),
          () => writeFileSync(join(root, "packages/b", ENV_FILE), "VITE_B=1\n"),
        );
      });
      expect(outcome).toStrictEqual(MOVED);
    });

    it("D3068: an edit to a listed env file that keeps its size changes its workspace's fingerprint", async () => {
      const outcome = await inTempDir((root) => {
        writeFileSync(join(root, ENV_FILE), "VITE_A=1\n");
        const entry = workspaceWithEnv(root, ROOT_PATH, [ROOT_ENV_SOURCE]);
        return movedBy(
          () => envPrint(root, entry),
          () => writeFileSync(join(root, ENV_FILE), "VITE_A=2\n"),
        );
      });
      expect(outcome).toStrictEqual(MOVED);
    });

    it("D3069: creating a listed env file changes its workspace's fingerprint, and deleting it again restores the fingerprint it had without it", async () => {
      const prints = await inTempDir((root) => {
        const entry = workspaceWithEnv(root, ROOT_PATH, [ROOT_ENV_SOURCE]);
        const absent = envPrint(root, entry);
        writeFileSync(join(root, LOCAL_ENV_FILE), "VITE_A=1\n");
        const created = envPrint(root, entry);
        rmSync(join(root, LOCAL_ENV_FILE));
        return { absent, created, deleted: envPrint(root, entry) };
      });
      expect({
        computed: prints.absent !== undefined,
        createdMoved:
          prints.created !== undefined && prints.created !== prints.absent,
        deletedRestored: prints.deleted === prints.absent,
      }).toStrictEqual({
        computed: true,
        createdMoved: true,
        deletedRestored: true,
      });
    });

    it("D3070: the root config's env file changes the fingerprint of a workspace whose own config loads env files from its own directory", async () => {
      const outcome = await inTempDir((root) => {
        mkdirSync(join(root, "packages/app"), { recursive: true });
        const entry = workspaceWithEnv(root, "packages/app", [
          envSourceAt("packages/app"),
          ROOT_ENV_SOURCE,
        ]);
        return movedBy(
          () => envPrint(root, entry),
          () => writeFileSync(join(root, LOCAL_ENV_FILE), "VITE_ROOT=1\n"),
        );
      });
      expect(outcome).toStrictEqual(MOVED);
    });

    it("D3071: an env file only a workspace's second project names changes the workspace's fingerprint", async () => {
      const outcome = await inTempDir((root) => {
        mkdirSync(join(root, "b"));
        const entry = workspaceWithEnv(
          root,
          ROOT_PATH,
          [envSourceAt("a")],
          [envSourceAt("b")],
        );
        return movedBy(
          () => envPrint(root, entry),
          () => writeFileSync(join(root, "b", ENV_FILE), "VITE_B=1\n"),
        );
      });
      expect(outcome).toStrictEqual(MOVED);
    });

    it("D3072: a listed env file the snapshot holds as a file's content, which the workspace's narrowed inputs leave out, changes its fingerprint by the held digest", async () => {
      const changed = await inTempDir((root) => {
        const entry = workspaceWithEnv(root, ROOT_PATH, [ROOT_ENV_SOURCE]);
        const narrowed = new ProjectInputs(root, new Map([["a.ts", "file:1"]]));
        const digestWith = (envFile: string): string | undefined => {
          const project = new ProjectInputs(
            root,
            new Map([
              ["a.ts", "file:1"],
              [ENV_FILE, envFile],
            ]),
          );
          return printed(
            workspaceFingerprint(
              project,
              entry,
              new SnapshotReads(root),
              narrowed,
            ),
          );
        };
        const before = digestWith("file:1");
        return before !== undefined && before !== digestWith("file:2");
      });
      expect(changed).toBe(true);
    });

    it("D3073: a listed env file the inputs hold by type or link target, as a FIFO, socket, device or link to anything but a file, is read as Vite reads it, so an edit there changes the fingerprint", async () => {
      const outcome = await inTempDir((root) => {
        writeFileSync(join(root, ENV_FILE), "VITE_A=1\n");
        const entry = workspaceWithEnv(root, ROOT_PATH, [ROOT_ENV_SOURCE]);
        return movedBy(
          () => envPrint(root, entry, { [ENV_FILE]: HELD_LINK }),
          () => writeFileSync(join(root, ENV_FILE), "VITE_A=2\n"),
        );
      });
      expect(outcome).toStrictEqual(MOVED);
    });

    it("D3074: a discovered workspace whose selection facts are not reported has no fingerprint, the reason saying its env files are not known", () => {
      const print = workspaceFingerprint(
        new ProjectInputs(REPO, new Map()),
        workspaceAt(REPO, [], { reported: false }),
      );
      expect(
        print.ok
          ? print
          : {
              ok: false,
              saysNotKnown:
                print.reason.includes("env files") &&
                print.reason.includes("not known"),
            },
      ).toStrictEqual({ ok: false, saysNotKnown: true });
    });

    it("D3075: a discovery holding a workspace whose selection facts are not reported has no fingerprint, the reason naming that workspace", async () => {
      const outcome = await inTempDir((root) => {
        const print = discoveryFingerprint(new ProjectInputs(root, new Map()), {
          workspaces: [
            workspaceWithEnv(root, ROOT_PATH, [ROOT_ENV_SOURCE]),
            discoveredWorkspace(
              { path: "packages/b", directory: join(root, "packages/b") },
              [],
              { reported: false },
            ),
          ],
          notRead: [],
        });
        return print.ok
          ? print
          : { ok: false, namesWorkspace: print.reason.includes("packages/b") };
      });
      expect(outcome).toStrictEqual({ ok: false, namesWorkspace: true });
    });

    it("D3076: a workspace whose discovery failed, which loaded no config, keeps a fingerprint rather than one of unknown env files", () => {
      const print = workspaceFingerprint(new ProjectInputs(REPO, new Map()), {
        status: "failed",
        workspace: { path: ROOT_PATH, directory: REPO },
        vitestVersion: DISCOVERED_VITEST_VERSION,
        error: "Error: Failed to load config",
      });
      expect(print.ok).toBe(true);
    });

    it("D3077: a listed env file no watch covers, created or modified after a job started, is reported as possibly changed during it, naming the file", async () => {
      const outcome = await inTempDir((dir) => {
        const created = join(dir, "created");
        const modified = join(dir, "modified");
        mkdirSync(created);
        writeTree(modified, { [ENV_FILE]: "VITE_A=1\n" });
        modifiedAt(join(modified, ENV_FILE), -AN_HOUR_MS);
        const since = Date.now();
        writeFileSync(join(created, LOCAL_ENV_FILE), "VITE_A=1\n");
        appendFileSync(join(modified, ENV_FILE), "VITE_B=2\n");
        const changed = (root: string): string | undefined =>
          protectedFileChangedSince(
            new ProjectInputs(root, new Map()),
            envDiscovery(root),
            since,
          );
        return {
          created: changed(created)?.startsWith(`${LOCAL_ENV_FILE},`) === true,
          modified: changed(modified)?.startsWith(`${ENV_FILE},`) === true,
        };
      });
      expect(outcome).toStrictEqual({ created: true, modified: true });
    });

    it("D3078: a listed env file with nothing at its path is not reported as possibly changed during a job", async () => {
      const changed = await inTempDir((root) =>
        protectedFileChangedSince(
          new ProjectInputs(root, new Map()),
          envDiscovery(root),
          Date.now(),
        ),
      );
      expect(changed).toBeUndefined();
    });

    it("D3079: a listed test module no watch covers that cannot be found is still reported as possibly changed during a job", async () => {
      const changed = await inTempDir((root) =>
        protectedFileChangedSince(
          new ProjectInputs(root, new Map()),
          discoveryListing(root, ["gen/a.test.ts"]),
          Date.now(),
        ),
      );
      expect(changed?.startsWith("gen/a.test.ts,")).toBe(true);
    });

    it("D3080: a listed env file the inputs hold as a link to anything but a file, edited after a job started, is reported as possibly changed during it", async () => {
      const changed = await inTempDir((root) => {
        const since = Date.now();
        writeFileSync(join(root, ENV_FILE), "VITE_A=1\n");
        return protectedFileChangedSince(
          new ProjectInputs(root, new Map([[ENV_FILE, HELD_LINK]])),
          envDiscovery(root),
          since,
        );
      });
      expect(changed?.startsWith(`${ENV_FILE},`)).toBe(true);
    });
  },
);

/** A variable no shell, terminal or agent sets, planted so its value is the test's alone. */
const PLANTED_VARIABLE = "RT_TEST_PLANTED_BY_VALUE";
const DECLARED_VARIABLE = "RT_TEST_DECLARED_VARIABLE";
/** Variables that can change a result, which the session list leaves counted by value. */
const RESULT_VARIABLES = ["PATH", "HOME", "TERM", "SSH_AUTH_SOCK", "DISPLAY"];
const PREFIX_MARK = "*";
const SEARCH_PATH = "/usr/bin";
const ENVIRONMENT_LINE = "environment:";

/** The digest of `environment` counted with the session list and no declared entry. */
function environmentDigest(environment: NodeJS.ProcessEnv): string {
  return countEnvironment(environment, []).digest;
}

/** A variable the session-list `entry` names: the entry itself, or for a prefix, a name beginning with it. */
function namedBy(entry: string): string {
  return entry.endsWith(PREFIX_MARK)
    ? `${entry.slice(0, -PREFIX_MARK.length)}1`
    : entry;
}

/** A variable for every session-list entry, each holding `value`, beside a planted variable counted by value. */
function sessionEnvironment(value: string): NodeJS.ProcessEnv {
  return {
    [PLANTED_VARIABLE]: "held",
    ...Object.fromEntries(
      SESSION_VARIABLES.map((entry) => [namedBy(entry), value]),
    ),
  };
}

/** `countEnvironment` from a fresh import, whose case rule follows the platform `onPlatform` sets. */
async function freshEnvironmentCount(): Promise<typeof countEnvironment> {
  vi.resetModules();
  const fresh = await import("../src/inputs/environment-digest.js");
  return fresh.countEnvironment;
}

/** The text of an `rt-test.json` declaring the variable entries `entries`, and no pattern. */
function declaringVariables(...entries: unknown[]): string {
  return JSON.stringify({ nonInputVariables: entries });
}

/** The same declaration as `declaringVariables()`, spelled differently, so writing it starts a reconciliation. */
const NO_VARIABLES_RESPELLED = JSON.stringify(
  { nonInputVariables: [] },
  null,
  2,
);

/** Runs `body` with each variable of `values` set, then restores what each held before. */
function withVariables<T>(
  values: Readonly<Record<string, string>>,
  body: () => Promise<T>,
): Promise<T> {
  const nested = Object.entries(values).reduce<() => Promise<T>>(
    (inner, [name, value]) =>
      () =>
        withEnvironment(name, value, inner),
    body,
  );
  return nested();
}

describe("the environment's count", () => {
  it("D2935: a change in the value of each variable the session list names leaves the environment's digest as it was", () => {
    const before = sessionEnvironment("first");
    const moved = SESSION_VARIABLES.filter(
      (entry) =>
        environmentDigest({ ...before, [namedBy(entry)]: "second" }) !==
        environmentDigest(before),
    );
    expect(moved).toStrictEqual([]);
  });

  it("D2936: a variable the session list names becoming set changes the environment's digest", () => {
    const unset = { [PLANTED_VARIABLE]: "held" };
    const unmoved = SESSION_VARIABLES.filter(
      (entry) =>
        environmentDigest({ ...unset, [namedBy(entry)]: "set" }) ===
        environmentDigest(unset),
    );
    expect(unmoved).toStrictEqual([]);
  });

  it("D2937: a change in the value of PATH, HOME, TERM, SSH_AUTH_SOCK, DISPLAY or any other variable changes the environment's digest", () => {
    const unmoved = [...RESULT_VARIABLES, PLANTED_VARIABLE].filter(
      (name) =>
        environmentDigest({ [name]: "first" }) ===
        environmentDigest({ [name]: "second" }),
    );
    expect(unmoved).toStrictEqual([]);
  });

  it("D2938: EFC_* counts once as set, whichever variables beginning with EFC_ are set", () => {
    const one = environmentDigest({
      [PLANTED_VARIABLE]: "held",
      EFC_1234_1: "a",
    });
    const two = environmentDigest({
      [PLANTED_VARIABLE]: "held",
      EFC_5678_1: "b",
      EFC_5678_2: "c",
    });
    expect(two).toBe(one);
  });

  it("D2939: on Windows, Path and PATH count as one variable", async () => {
    const same = await onPlatform("win32", async () => {
      const count = await freshEnvironmentCount();
      return (
        count({ Path: SEARCH_PATH }, []).digest ===
        count({ PATH: SEARCH_PATH }, []).digest
      );
    });
    expect(same).toBe(true);
  });

  it("D2940: on Linux, Path and PATH count as two variables", async () => {
    const distinct = await onPlatform("linux", async () => {
      const count = await freshEnvironmentCount();
      return (
        count({ Path: SEARCH_PATH }, []).digest !==
        count({ PATH: SEARCH_PATH }, []).digest
      );
    });
    expect(distinct).toBe(true);
  });

  it("D2964: a variable the session list names going from empty to non-empty changes the environment's digest", () => {
    const base = { [PLANTED_VARIABLE]: "held" };
    const unmoved = SESSION_VARIABLES.filter(
      (entry) =>
        environmentDigest({ ...base, [namedBy(entry)]: "" }) ===
        environmentDigest({ ...base, [namedBy(entry)]: "non-empty" }),
    );
    expect(unmoved).toStrictEqual([]);
  });

  it("D2965: on Windows, a change in the value of one of two names that fold to one key, such as Aß beside ASS, changes the environment's digest", async () => {
    const moved = await onPlatform("win32", async () => {
      const count = await freshEnvironmentCount();
      return (
        count({ Aß: "first", ASS: "held" }, []).digest !==
        count({ Aß: "second", ASS: "held" }, []).digest
      );
    });
    expect(moved).toBe(true);
  });

  it("D2966: a variable whose name begins with an exact session-list entry, such as PWD_RT_TEST_SUFFIX under PWD, still counts by value", () => {
    const exact = SESSION_VARIABLES.filter(
      (entry) => !entry.endsWith(PREFIX_MARK),
    );
    const unmoved = exact.filter((entry) => {
      const name = `${entry}_RT_TEST_SUFFIX`;
      return (
        environmentDigest({ [name]: "first" }) ===
        environmentDigest({ [name]: "second" })
      );
    });
    expect(unmoved).toStrictEqual([]);
  });

  it("D2967: on Windows, a declared entry matches a variable whatever its case, so the value of RT_TEST_DECLARED under a declared rt_test_declared leaves the digest as it was", async () => {
    const held = await onPlatform("win32", async () => {
      const count = await freshEnvironmentCount();
      const declared = ["rt_test_declared"];
      return (
        count({ RT_TEST_DECLARED: "first" }, declared).digest ===
        count({ RT_TEST_DECLARED: "second" }, declared).digest
      );
    });
    expect(held).toBe(true);
  });

  it("D2968: the environment's digest does not depend on the order the environment lists its variables in", () => {
    const listed = environmentDigest({
      [PLANTED_VARIABLE]: "a",
      [DECLARED_VARIABLE]: "b",
    });
    const reversed = environmentDigest({
      [DECLARED_VARIABLE]: "b",
      [PLANTED_VARIABLE]: "a",
    });
    expect(reversed).toBe(listed);
  });
});

describe(
  "the environment under the declaration",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D2941: a declared variable's value leaves the workspace's and the discovery's fingerprints as they were", async () => {
      const prints = await inTempDir(async (root) => {
        writeTree(root, {
          [DECLARATION_FILE]: declaringVariables(DECLARED_VARIABLE),
          "src/a.ts": "",
        });
        const under = (value: string) =>
          withEnvironment(DECLARED_VARIABLE, value, () =>
            tracking(root, async ({ tracker, fingerprint }) => {
              const discovery = tracker
                .current()
                .discoveryFingerprint(discoveryListing(root, []));
              return {
                workspace: fingerprint(),
                discovery: discovery.ok ? discovery.digest : undefined,
              };
            }),
          );
        return { first: await under("first"), second: await under("second") };
      });
      const { first, second } = prints;
      expect({
        computed:
          first.workspace !== undefined && first.discovery !== undefined,
        workspaceHeld: second.workspace === first.workspace,
        discoveryHeld: second.discovery === first.discovery,
      }).toStrictEqual({
        computed: true,
        workspaceHeld: true,
        discoveryHeld: true,
      });
    });

    it("D2942: a variable rt-test.json comes to declare counts only as set from the reconciliation that reads the declaration", async () => {
      const outcome = await withEnvironment(DECLARED_VARIABLE, "held", () =>
        inTempDir((root) => {
          writeTree(root, {
            [DECLARATION_FILE]: declaringVariables(),
            "src/a.ts": "",
          });
          return tracking(root, async (tracked) => {
            const before = tracked.fingerprint();
            const reconciled = await reconciledAfter(tracked.tracker, () =>
              writeFileSync(
                join(root, DECLARATION_FILE),
                declaringVariables(DECLARED_VARIABLE),
              ),
            );
            const after = tracked.fingerprint();
            return {
              reconciled,
              moved:
                before !== undefined && after !== undefined && after !== before,
            };
          });
        }),
      );
      expect(outcome).toStrictEqual({ reconciled: true, moved: true });
    });

    it("D2943: a write to the daemon's process.env after its start leaves the fingerprint as it was", async () => {
      const outcome = await withEnvironment(PLANTED_VARIABLE, "at start", () =>
        inTempDir((root) => {
          writeTree(root, {
            [DECLARATION_FILE]: declaringVariables(),
            "src/a.ts": "",
          });
          return tracking(root, async (tracked) => {
            const before = tracked.fingerprint();
            process.env[PLANTED_VARIABLE] = "written later";
            const reconciled = await reconciledAfter(tracked.tracker, () =>
              writeFileSync(
                join(root, DECLARATION_FILE),
                NO_VARIABLES_RESPELLED,
              ),
            );
            return {
              reconciled,
              held: before !== undefined && tracked.fingerprint() === before,
            };
          });
        }),
      );
      expect(outcome).toStrictEqual({ reconciled: true, held: true });
    });

    it("D2944: one environment line names the variables counted by value, the listed entries set and the declared entries, and no value", async () => {
      const values = {
        [PLANTED_VARIABLE]: "planted-value-1",
        CLAUDE_CODE_SESSION_ID: "session-value-2",
        [DECLARED_VARIABLE]: "declared-value-3",
      };
      const logged = await withVariables(values, () =>
        inTempDir((root) => {
          writeTree(root, {
            [DECLARATION_FILE]: declaringVariables(DECLARED_VARIABLE),
            "src/a.ts": "",
          });
          const log = memoryLog();
          return tracking(root, async () => [...log.entries], { log });
        }),
      );
      const lines = logged.filter((entry) =>
        entry.startsWith(ENVIRONMENT_LINE),
      );
      expect({
        lines: lines.length,
        named: Object.keys(values).map(
          (name) => lines[0]?.includes(JSON.stringify(name)) === true,
        ),
        valueShown: logged.some((entry) =>
          Object.values(values).some((value) => entry.includes(value)),
        ),
      }).toStrictEqual({
        lines: 1,
        named: [true, true, true],
        valueShown: false,
      });
    });

    it("D2945: the environment line is logged after the first reconciliation and after one that changes the count, and not after one that leaves it", async () => {
      const outcome = await withEnvironment(DECLARED_VARIABLE, "held", () =>
        inTempDir((root) => {
          writeTree(root, {
            [DECLARATION_FILE]: declaringVariables(),
            "src/a.ts": "",
          });
          const log = memoryLog();
          return tracking(
            root,
            async ({ tracker }) => {
              const unchanged = await reconciledAfter(tracker, () =>
                writeFileSync(
                  join(root, DECLARATION_FILE),
                  NO_VARIABLES_RESPELLED,
                ),
              );
              const changed = await reconciledAfter(tracker, () =>
                writeFileSync(
                  join(root, DECLARATION_FILE),
                  declaringVariables(DECLARED_VARIABLE),
                ),
              );
              const lines = log.entries.filter((entry) =>
                entry.startsWith(ENVIRONMENT_LINE),
              );
              return {
                reconciled: unchanged && changed,
                lines: lines.length,
                lastDeclares:
                  lines.at(-1)?.includes(JSON.stringify(DECLARED_VARIABLE)) ===
                  true,
              };
            },
            { log },
          );
        }),
      );
      expect(outcome).toStrictEqual({
        reconciled: true,
        lines: 2,
        lastDeclares: true,
      });
    });
  },
);

/** Event-loop turns in which a tracker with nothing to read must leave its change signal pending. */
const QUIET_TURNS = 20;
const UNCHANGED_TEXT = "export {};\n";

/** Takes the tracker's change signal now, and says later whether it has resolved. */
function changeSignal(tracker: InputTracker): () => boolean {
  let resolved = false;
  void tracker.changed().then(() => {
    resolved = true;
  });
  return () => resolved;
}

describe(
  "the tracker's change signal",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D2538: the tracker's change signal resolves once an edit to an input has been read", async () => {
      const signalled = await inTempDir((root) => {
        writeTree(root, { "a.ts": UNCHANGED_TEXT });
        return trackingOwnGitHome(root, async ({ tracker }) => {
          const resolved = changeSignal(tracker);
          appendFileSync(join(root, "a.ts"), "// an edit\n");
          return eventually(resolved, SETTLE_MS);
        });
      });
      expect(signalled).toBe(true);
    });

    it("D2555: the change signal stays pending while nothing changes, then resolves at the next edit", async () => {
      const outcome = await inTempDir((root) => {
        writeTree(root, { "a.ts": UNCHANGED_TEXT });
        return trackingOwnGitHome(root, async ({ tracker }) => {
          const resolved = changeSignal(tracker);
          for (let turn = 0; turn < QUIET_TURNS; turn += 1) {
            await new Promise((resolve) => setImmediate(resolve));
          }
          const quiet = !resolved();
          appendFileSync(join(root, "a.ts"), "// an edit\n");
          return { quiet, signalled: await eventually(resolved, SETTLE_MS) };
        });
      });
      expect(outcome).toStrictEqual({ quiet: true, signalled: true });
    });

    it("D2556: the change signal resolves once pending reads drain, though they moved no digest", async () => {
      const outcome = await inTempDir((root) => {
        writeTree(root, { "a.ts": UNCHANGED_TEXT });
        return trackingOwnGitHome(root, async ({ tracker }) => {
          const revision = tracker.facts().revision;
          const resolved = changeSignal(tracker);
          writeFileSync(join(root, "a.ts"), UNCHANGED_TEXT);
          const signalled = await eventually(resolved, SETTLE_MS);
          return { signalled, moved: tracker.facts().revision - revision };
        });
      });
      expect(outcome).toStrictEqual({ signalled: true, moved: 0 });
    });

    it("D2557: the change signal resolves once a protection walk ends, though the walk released no file", async () => {
      const outcome = await inTempDir((root) => {
        writeTree(root, {
          [DECLARATION_FILE]: JSON.stringify({ nonInputs: ["docs/**"] }),
          "src/a.ts": "",
        });
        return trackingOwnGitHome(root, async ({ tracker }) => {
          const revision = tracker.facts().revision;
          const resolved = changeSignal(tracker);
          // No discovery now protects the tests, so the patterns stop applying and a walk runs, over no hidden file.
          await tracker.protectInputs(undefined);
          const signalled = await eventually(resolved, SETTLE_MS);
          return { signalled, moved: tracker.facts().revision - revision };
        });
      });
      expect(outcome).toStrictEqual({ signalled: true, moved: 0 });
    });
  },
);

describe("each platform's watches", { timeout: DAEMON_TEST_TIMEOUT_MS }, () => {
  it("D1916: with process.platform read as win32, the one watch of the root sees an edit two directories down", async () => {
    const moved = await inTempDir((root) => {
      writeTree(root, { "src/deep/a.ts": "" });
      return onPlatform("win32", () =>
        tracking(root, async (tracked) => {
          const before = tracked.fingerprint();
          appendFileSync(join(root, "src/deep/a.ts"), "// an edit\n");
          return movesFrom(tracked, before);
        }),
      );
    });
    expect(moved).toBe(true);
  });

  it("D1917: with process.platform read as linux, over the inotify model, a directory deleted and then re-created is watched again", async () => {
    const moved = await inTempDir(async (root) => {
      writeTree(root, { "x/y.ts": "" });
      vi.mocked(watch).mockImplementation(inotifyModel);
      try {
        return await onPlatform("linux", () =>
          tracking(root, async (tracked) => {
            const initial = tracked.fingerprint();
            rmSync(join(root, "x"), { recursive: true });
            await movesFrom(tracked, initial);
            const removed = tracked.fingerprint();
            writeTree(root, { "x/y.ts": "" });
            await movesFrom(tracked, removed);
            const recreated = tracked.fingerprint();
            appendFileSync(join(root, "x/y.ts"), "// an edit\n");
            return movesFrom(tracked, recreated);
          }),
        );
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(moved).toBe(true);
  });

  it("D1918: with process.platform read as linux, over the inotify model, a directory removed and re-created in one step is watched again", async () => {
    const moved = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      vi.mocked(watch).mockImplementation(inotifyModel);
      try {
        return await onPlatform("linux", () =>
          tracking(root, async (tracked) => {
            const initial = tracked.fingerprint();
            rmSync(join(root, "src"), { recursive: true });
            writeTree(root, { "src/c.ts": "" });
            await movesFrom(tracked, initial);
            const replaced = tracked.fingerprint();
            appendFileSync(join(root, "src/c.ts"), "// an edit\n");
            return movesFrom(tracked, replaced);
          }),
        );
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(moved).toBe(true);
  });

  it("D1919: every watch opens on the real path of what it watches, a root and a git config home each reached through a link included", async () => {
    const outcome = await inTempDir(async (dir) => {
      const real = join(dir, "real");
      repository(real, "", { "src/a.ts": "" });
      const rootLink = join(dir, "root-link");
      symlinkSync(real, rootLink, "junction");
      const configHome = join(dir, "config");
      mkdirSync(configHome);
      const configLink = join(dir, "config-link");
      symlinkSync(configHome, configLink, "junction");
      const { paths } = capturingWatches();
      const saved = process.env["XDG_CONFIG_HOME"];
      process.env["XDG_CONFIG_HOME"] = configLink;
      try {
        await tracking(real, async () => undefined, {
          consumerRoot: rootLink,
        });
      } finally {
        if (saved === undefined) delete process.env["XDG_CONFIG_HOME"];
        else process.env["XDG_CONFIG_HOME"] = saved;
        vi.mocked(watch).mockReset();
      }
      return {
        notReal: paths.filter((path) => path !== realpathSync.native(path)),
        watchedConfigHome: paths.includes(configHome),
      };
    });
    expect(outcome).toStrictEqual({ notReal: [], watchedConfigHome: true });
  });
});

describe(
  "jobs, re-walks and git's own files",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D1945: a job that starts while the watcher is unhealthy is not fingerprinted, even once a reconciliation that found no change has ended", async () => {
      const outcome = await inTempDir(async (root) => {
        writeTree(root, { "src/a.ts": "" });
        const { listeners } = capturingWatches();
        try {
          return await tracking(root, async ({ tracker }) => {
            listeners[0]?.("rename", null as unknown as string);
            const mark = tracker.beginJob();
            await tracker.endJob(tracker.beginJob());
            await drained(tracker);
            const verdict = await tracker.endJob(mark);
            return {
              watcher: tracker.facts().watcher.state,
              fingerprinted: verdict.fingerprinted,
              unsettled:
                !verdict.fingerprinted &&
                verdict.reason.startsWith(
                  "its inputs were unsettled when it started",
                ),
            };
          });
        } finally {
          vi.mocked(watch).mockReset();
        }
      });
      expect(outcome).toStrictEqual({
        watcher: "healthy",
        fingerprinted: false,
        unsettled: true,
      });
    });

    it("D1946: with process.platform read as linux, over the inotify model, a re-walk of the root that finds nothing changed leaves the revision where it was", async () => {
      const rose = await inTempDir(async (root) => {
        writeTree(root, { "src/a.ts": "", "b.ts": "" });
        mkdirSync(join(root, basename(root)));
        const delivered: string[] = [];
        vi.mocked(watch).mockImplementation(((
          path: PathLike,
          options: unknown,
          listener: WatchListener<string>,
        ) =>
          inotifyModel(
            path,
            options as { recursive?: boolean },
            (kind, name) => {
              delivered.push(String(name));
              listener(kind, name);
            },
          )) as typeof watch);
        try {
          return await onPlatform("linux", () =>
            tracking(root, async ({ tracker }) => {
              const revision = tracker.facts().revision;
              // An event named like the root, once no entry of that name exists, reads on Linux as the root's own
              // removal, so the root is walked again.
              rmSync(join(root, basename(root)), { recursive: true });
              await eventually(
                () => delivered.includes(basename(root)),
                SETTLE_MS,
              );
              await tracker.endJob(tracker.beginJob());
              await drained(tracker);
              return tracker.facts().revision - revision;
            }),
          );
        } finally {
          vi.mocked(watch).mockReset();
        }
      });
      expect(rose).toBe(0);
    });

    it("D1947: a job's end returns once a read of its changed paths has thrown, not fingerprinted", async () => {
      const outcome = await inTempDir(async (root) => {
        writeTree(root, { "src/a.ts": "" });
        return tracking(root, async ({ tracker }) => {
          const read = vi.mocked(readEntryDigest);
          const readsBefore = read.mock.calls.length;
          read.mockImplementationOnce(() =>
            Promise.reject(new Error("a planted read failure")),
          );
          try {
            const mark = tracker.beginJob();
            appendFileSync(join(root, "src/a.ts"), "// an edit\n");
            await eventually(
              () => read.mock.calls.length > readsBefore,
              SETTLE_MS,
            );
            const verdict = await within(tracker.endJob(mark), SETTLE_MS);
            return typeof verdict === "string"
              ? verdict
              : { fingerprinted: verdict.fingerprinted };
          } finally {
            read.mockReset();
          }
        });
      });
      expect(outcome).toStrictEqual({ fingerprinted: false });
    });

    it("D1948: a git file whose watch cannot open is named among git's unread files, and leaves the watcher healthy", async () => {
      const outcome = await inTempDir(async (root) => {
        repository(root, "", { "src/a.ts": "" });
        vi.mocked(watch).mockImplementation(((
          path: PathLike,
          options: { recursive?: boolean },
          listener: WatchListener<string>,
        ) => {
          const watched = String(path);
          if (watched === root || watched.startsWith(`${root}${sep}src`)) {
            return realWatch(path, options, listener);
          }
          throw Object.assign(
            new Error(`EACCES: permission denied, watch '${watched}'`),
            { code: "EACCES" },
          );
        }) as typeof watch);
        try {
          return await tracking(root, async ({ tracker }) => {
            const facts = tracker.facts();
            return {
              watcher: facts.watcher.state,
              named: facts.gitUnread.some((reason) =>
                reason.includes("EACCES"),
              ),
            };
          });
        } finally {
          vi.mocked(watch).mockReset();
        }
      });
      expect(outcome).toStrictEqual({ watcher: "healthy", named: true });
    });

    it("D1949: with the consumer root outside git, an edit to a nested repository's info/exclude runs a reconciliation", async () => {
      const reconciled = await inTempDir(async (root) => {
        writeTree(root, { "src/a.ts": "" });
        repository(join(root, "nested"), "", { "b.ts": "" });
        return trackingOwnGitHome(root, async ({ tracker }) => {
          const last = tracker.facts().lastReconciledAt;
          appendFileSync(join(root, "nested/.git/info/exclude"), "*.tmp\n");
          return eventually(
            () => tracker.facts().lastReconciledAt !== last,
            SETTLE_MS,
          );
        });
      });
      expect(reconciled).toBe(true);
    });

    it("D1950: a write to a path a nested repository's .gitignore ignores changes no fingerprint", async () => {
      const unchanged = await inTempDir((root) => {
        writeTree(root, { "src/a.ts": "" });
        repository(join(root, "nested"), "out/\n", { "out/old.js": "" });
        return tracking(root, (tracked) =>
          leavesFingerprint(tracked, root, () =>
            writeFileSync(join(root, "nested/out/new.js"), "built\n"),
          ),
        );
      });
      expect(unchanged).toBe(true);
    });

    it("D1951: a commit that creates the directory of the ref HEAD names, which did not exist, runs a reconciliation", async () => {
      const reconciled = await inTempDir(async (dir) => {
        const git = repository(dir, "", { "sub/a.ts": "" });
        git("add", "-A");
        git("commit", "-q", "-m", "first");
        git("symbolic-ref", "HEAD", "refs/heads/feature/x");
        return trackingOwnGitHome(join(dir, "sub"), async ({ tracker }) => {
          const last = tracker.facts().lastReconciledAt;
          git("commit", "-q", "--allow-empty", "-m", "on feature/x");
          return eventually(
            () => tracker.facts().lastReconciledAt !== last,
            SETTLE_MS,
          );
        });
      });
      expect(reconciled).toBe(true);
    });

    it("D1952: reading a file's content under a stop that has already arrived gives no digest", async () => {
      const kind = await inTempDir(async (root) => {
        writeTree(root, { "a.ts": "export {};\n" });
        const stop = new AbortController();
        stop.abort();
        return (await readEntryDigest(join(root, "a.ts"), stop.signal)).kind;
      });
      expect(kind === "input").toBe(false);
    });

    it("D1960: a check-ignore that fails for a path created after a reconciliation is named among git's unread reasons", async () => {
      const reason = "check-ignore failed for the new path";
      const named = await inTempDir(async (root) => {
        repository(root, "", { "src/a.ts": "" });
        return tracking(root, async ({ tracker }) => {
          vi.mocked(readCheckedIgnored).mockResolvedValue({
            ok: false,
            reason,
          });
          try {
            writeFileSync(join(root, "src/new.ts"), "export {};\n");
            return await eventually(
              () =>
                tracker
                  .facts()
                  .gitUnread.some((unread) => unread.includes(reason)),
              SETTLE_MS,
            );
          } finally {
            vi.mocked(readCheckedIgnored).mockReset();
          }
        });
      });
      expect(named).toBe(true);
    });

    it("D1966: a write under a nested repository git cannot answer for counts as an input, though the enclosing repository ignores its name", async () => {
      const moved = await inTempDir(async (root) => {
        repository(root, "*.gen\n", {
          "src/a.ts": "",
          "nested/keep.ts": "",
          "nested/.git": "gitdir: missing\n",
        });
        return tracking(root, async (tracked) => {
          const before = tracked.fingerprint();
          writeFileSync(join(root, "nested/new.gen"), "generated\n");
          return movesFrom(tracked, before);
        });
      });
      expect(moved).toBe(true);
    });
  },
);

describe("the git files a reconciliation watches", () => {
  it("D1963: a relative core.excludesFile is resolved against the repository's top level, with the consumer root in a subdirectory", async () => {
    const outcome = await inTempDir(async (dir) => {
      const git = repository(dir, "", { "sub/a.ts": "" });
      git("config", "core.excludesFile", "rules");
      const sources = await gitSources(
        join(dir, "sub"),
        [],
        new AbortController().signal,
      );
      return sources.ok
        ? sources.files.includes(resolve(realpathSync.native(dir), "rules"))
        : sources.reason;
    });
    expect(outcome).toBe(true);
  });

  it("D1964: on Windows with HOME set, the user's git config files are read under HOME, not the profile directory", async () => {
    const outcome = await inTempDir(async (dir) => {
      const home = join(dir, "home");
      const profile = join(dir, "profile");
      mkdirSync(home);
      mkdirSync(profile);
      repository(join(dir, "repo"), "", { "a.ts": "" });
      vi.mocked(homedir).mockReturnValue(profile);
      const saved = {
        HOME: process.env["HOME"],
        XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"],
      };
      process.env["HOME"] = home;
      delete process.env["XDG_CONFIG_HOME"];
      try {
        const sources = await onPlatform("win32", () =>
          gitSources(join(dir, "repo"), [], new AbortController().signal),
        );
        return sources.ok
          ? {
              config: sources.files.includes(join(home, ".gitconfig")),
              xdg: sources.files.includes(
                join(home, ".config", "git", "config"),
              ),
            }
          : sources.reason;
      } finally {
        for (const [name, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
        vi.mocked(homedir).mockReset();
      }
    });
    expect(outcome).toStrictEqual({ config: true, xdg: true });
  });
});

describe("declared non-inputs", { timeout: DAEMON_TEST_TIMEOUT_MS }, () => {
  it("D1991: a job open while a declared test module is protected stays fingerprinted, and the protection raises the input revision", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("src/**"),
        "src/a.test.ts": "it('t', () => {});\n",
        "b.ts": "",
      });
      return trackingOwnGitHome(root, async ({ tracker }) => {
        const revision = tracker.facts().revision;
        const mark = tracker.beginJob();
        await tracker.protectInputs(discoveryListing(root, ["src/a.test.ts"]));
        const verdict = await tracker.endJob(mark);
        return {
          fingerprinted: verdict.fingerprinted,
          revisionRose: tracker.facts().revision > revision,
        };
      });
    });
    expect(outcome).toStrictEqual({ fingerprinted: true, revisionRose: true });
  });

  it("D1992: a protected test module the next discovery no longer lists is a declared non-input again", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("src/**"),
        "src/a.test.ts": "it('t', () => {});\n",
        "b.ts": "",
      });
      return trackingOwnGitHome(root, async (tracked) => {
        const before = tracked.fingerprint();
        await tracked.tracker.protectInputs(
          discoveryListing(root, ["src/a.test.ts"]),
        );
        const whileProtected = tracked.fingerprint();
        await tracked.tracker.protectInputs(discoveryListing(root, []));
        return {
          protectionMoved: whileProtected !== before,
          restored: tracked.fingerprint() === before,
        };
      });
    });
    expect(outcome).toStrictEqual({ protectionMoved: true, restored: true });
  });

  it("D1993: writing rt-test.json takes the file it declares out of the inputs, and deleting it puts the file back", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, { "README.md": "# a\n", "src/a.ts": "" });
      return tracking(root, async (tracked) => {
        const before = tracked.fingerprint();
        writeFileSync(join(root, DECLARATION_FILE), declaring("README.md"));
        const declared = await movesFrom(tracked, before);
        const whileDeclared = tracked.fingerprint();
        rmSync(join(root, DECLARATION_FILE));
        await movesFrom(tracked, whileDeclared);
        return { declared, restored: tracked.fingerprint() === before };
      });
    });
    expect(outcome).toStrictEqual({ declared: true, restored: true });
  });

  it("D1994: an edit to rt-test.json that declares the same patterns leaves the fingerprint as it was once its reconciliation ends", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("README.md"),
        "README.md": "# a\n",
        "src/a.ts": "",
      });
      return tracking(root, async ({ tracker, fingerprint }) => {
        const before = fingerprint();
        const reconciled = await reconciledAfter(tracker, () =>
          writeFileSync(
            join(root, DECLARATION_FILE),
            JSON.stringify({ nonInputs: ["README.md"] }, null, 2),
          ),
        );
        return { reconciled, unchanged: fingerprint() === before };
      });
    });
    expect(outcome).toStrictEqual({ reconciled: true, unchanged: true });
  });

  it("D2218: an edit to the file a linked rt-test.json points to is read by the time a later edit beside it is, without waiting for the periodic reconciliation", async () => {
    const outcome = await inTempDir((root) => {
      const target = join(root, "config/declaration.json");
      const sentinel = join(root, "config/sentinel.ts");
      writeTree(root, {
        "config/declaration.json": declaring("docs/**"),
        "config/sentinel.ts": "export const sentinel = 0;\n",
      });
      symlinkSync(target, join(root, DECLARATION_FILE), "file");
      return tracking(root, async (tracked) => {
        const original = tracked.fingerprint();
        writeFileSync(sentinel, "export const sentinel = 1;\n");
        const sentinelEdited = await movesFrom(tracked, original);
        const withEditedSentinel = tracked.fingerprint();
        writeFileSync(target, declaring("docs/**", "notes/**"));
        // The sentinel lies beside the target so one watch reports both in order, and no fingerprint is computed while
        // an event is unread, so once the restoration is read a target edit that counts as an input has moved it.
        writeFileSync(sentinel, "export const sentinel = 0;\n");
        const sentinelRestored = await movesFrom(tracked, withEditedSentinel);
        return {
          baselineRead: original !== undefined,
          sentinelEdited,
          sentinelRestored,
          targetEditRead: tracked.fingerprint() !== original,
        };
      });
    });
    expect(outcome).toStrictEqual({
      baselineRead: true,
      sentinelEdited: true,
      sentinelRestored: true,
      targetEditRead: true,
    });
  });

  it("D2219: an edit to a file under a directory named rt-test.json moves the fingerprint once the reconciliation it requests ends", async () => {
    const outcome = await inTempDir((root) => {
      const inner = join(root, DECLARATION_FILE, "inner.ts");
      writeTree(root, {
        [`${DECLARATION_FILE}/inner.ts`]: "export const inner = 0;\n",
        "src/a.ts": "",
      });
      return tracking(root, async ({ tracker, fingerprint }) => {
        const original = fingerprint();
        const reconciled = await reconciledAfter(tracker, () =>
          writeFileSync(inner, "export const inner = 1;\n"),
        );
        return {
          baselineRead: original !== undefined,
          reconciled,
          innerEditRead: fingerprint() !== original,
        };
      });
    });
    expect(outcome).toStrictEqual({
      baselineRead: true,
      reconciled: true,
      innerEditRead: true,
    });
  });

  it("D1995: an edit to a declared file leaves the fingerprint as it was", async () => {
    const unchanged = await inTempDir((root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("docs/**"),
        "docs/a.md": "# a\n",
        "src/a.ts": "",
      });
      return tracking(root, (tracked) =>
        leavesFingerprint(tracked, root, () =>
          appendFileSync(join(root, "docs/a.md"), "more\n"),
        ),
      );
    });
    expect(unchanged).toBe(true);
  });

  it("D1996: the first reconciliation counts neither a declared file nor rt-test.json among the inputs", async () => {
    const ended = await inTempDir((root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("docs/**"),
        "docs/a.md": "",
        "src/a.ts": "",
      });
      const log = memoryLog();
      return tracking(
        root,
        async () =>
          log.entries.filter((entry) =>
            entry.startsWith("input reconciliation ended"),
          ),
        { log },
      );
    });
    expect(ended).toStrictEqual([
      "input reconciliation ended: 1 inputs, 0 changed, revision 0",
    ]);
  });

  it("D1997: the declaration is logged after the first reconciliation and after one that finds it changed, and not after one that finds it the same", async () => {
    const logged = await inTempDir((root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("docs/**"),
        "docs/a.md": "",
        "src/a.ts": "",
      });
      const log = memoryLog();
      return tracking(
        root,
        async ({ tracker }) => {
          await reconciledAfter(tracker, () =>
            writeFileSync(
              join(root, DECLARATION_FILE),
              JSON.stringify({ nonInputs: ["docs/**"] }, null, 2),
            ),
          );
          await reconciledAfter(tracker, () =>
            writeFileSync(
              join(root, DECLARATION_FILE),
              declaring("docs/**", "*.md"),
            ),
          );
          return log.entries.filter((entry) => entry.startsWith("non-inputs"));
        },
        { log },
      );
    });
    expect(logged).toStrictEqual([
      'non-inputs in effect from rt-test.json: "docs/**"',
      'non-inputs in effect from rt-test.json: "docs/**", "*.md"',
    ]);
  });

  it("D1998: while rt-test.json is not valid JSON, the current inputs carry the reason every file stays an input", async () => {
    const carried = await inTempDir((root) => {
      writeTree(root, { [DECLARATION_FILE]: "{ not json", "src/a.ts": "" });
      return tracking(
        root,
        async ({ tracker }) =>
          tracker
            .current()
            .nonInputsUnusable?.startsWith(UNUSABLE_JSON_REASON) === true,
      );
    });
    expect(carried).toBe(true);
  });

  it("D1999: an rt-test.json deleted between the reader's check that it exists and its read declares nothing, with no reason", async () => {
    const declaration = await inTempDir((root) => {
      writeFileSync(join(root, DECLARATION_FILE), declaring("docs/**"));
      vi.mocked(readJson).mockImplementationOnce((file) => {
        rmSync(file);
        return realReadJson(file);
      });
      try {
        return readNonInputs(root);
      } finally {
        vi.mocked(readJson).mockReset();
      }
    });
    expect(declaration).toStrictEqual({
      file: DECLARATION_FILE,
      state: "absent",
    });
  });

  it("D2008: with process.platform read as win32, an event naming RT-Test.json, rt-test.json in another case, starts a reconciliation", async () => {
    const started = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const log = memoryLog();
      const { listeners, paths } = capturingWatches();
      try {
        return await onPlatform("win32", () =>
          tracking(
            root,
            async () => {
              listeners[paths.indexOf(realpathSync.native(root))]?.(
                "change",
                "RT-Test.json",
              );
              return eventually(
                () => log.entries.includes(DECLARATION_CHANGED_STARTED),
                SETTLE_MS,
              );
            },
            { log },
          ),
        );
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(started).toBe(true);
  });

  it("D2044: once an rt-test.json that was not valid JSON is fixed and a reconciliation ends, the current inputs carry no reason", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, {
        [DECLARATION_FILE]: "{ not json",
        "README.md": "",
        "src/a.ts": "",
      });
      return tracking(root, async ({ tracker }) => {
        const before =
          tracker
            .current()
            .nonInputsUnusable?.startsWith(UNUSABLE_JSON_REASON) === true;
        const reconciled = await reconciledAfter(tracker, () =>
          writeFileSync(join(root, DECLARATION_FILE), declaring("README.md")),
        );
        return {
          before,
          reconciled,
          after: tracker.current().nonInputsUnusable,
        };
      });
    });
    expect(outcome).toStrictEqual({
      before: true,
      reconciled: true,
      after: undefined,
    });
  });

  it("D2050: with process.platform read as linux, over the inotify model, a package.json created in a new directory a declared pattern matches is an input, and so is its edit", async () => {
    const outcome = await inTempDir(async (root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("docs/**"),
        "docs/a.md": "",
        "src/a.ts": "",
      });
      vi.mocked(watch).mockImplementation(inotifyModel);
      try {
        return await onPlatform("linux", () =>
          tracking(root, async (tracked) => {
            const before = tracked.fingerprint();
            writeTree(root, { "docs/pkg/package.json": "{}" });
            const created = await movesFrom(tracked, before);
            const afterCreate = tracked.fingerprint();
            appendFileSync(join(root, "docs/pkg/package.json"), "\n");
            return { created, edited: await movesFrom(tracked, afterCreate) };
          }),
        );
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(outcome).toStrictEqual({ created: true, edited: true });
  });

  it("D2051: moving a directory a declared pattern matches out of the root removes the package.json it held from the inputs", async () => {
    const moved = await inTempDir(async (root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("docs/**"),
        "docs/pkg/package.json": "{}",
        "src/a.ts": "",
      });
      const outside = `${root}-moved`;
      try {
        return await tracking(root, async (tracked) => {
          const before = tracked.fingerprint();
          renameSync(join(root, "docs/pkg"), outside);
          return movesFrom(tracked, before);
        });
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
    expect(moved).toBe(true);
  });

  it("D2149: with no discovery in effect, an edit to a file a declared pattern matches moves the fingerprint, and the current inputs say why no pattern applies", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, DOCS_DECLARED);
      return trackingOwnGitHome(
        root,
        async (tracked) => {
          const before = tracked.fingerprint();
          appendFileSync(join(root, "docs/a.md"), "more\n");
          return {
            moved: await movesFrom(tracked, before),
            unusable: tracked.tracker.current().nonInputsUnusable,
          };
        },
        { discovery: null },
      );
    });
    expect(outcome).toStrictEqual({
      moved: true,
      unusable: NO_DISCOVERY_REASON,
    });
  });

  it("D2150: with no discovery in effect, an rt-test.json declaring no pattern gives the current inputs no reason", async () => {
    const reason = await inTempDir((root) => {
      writeTree(root, { [DECLARATION_FILE]: declaring(), "src/a.ts": "" });
      return trackingOwnGitHome(
        root,
        async ({ tracker }) => tracker.current().nonInputsUnusable,
        { discovery: null },
      );
    });
    expect(reason).toBeUndefined();
  });

  it("D2151: with no discovery in effect the log warns that the declared patterns do not apply, and once a discovery reporting its facts is protected it says they apply", async () => {
    const logged = await inTempDir((root) => {
      writeTree(root, DOCS_DECLARED);
      const log = memoryLog();
      return trackingOwnGitHome(
        root,
        async ({ tracker }) => {
          await tracker.protectInputs(discoveryListing(root, []));
          return log.entries.filter(isDeclarationLine);
        },
        { log, discovery: null },
      );
    });
    expect(logged).toStrictEqual([
      `warning: ${NO_DISCOVERY_REASON}; the patterns rt-test.json declares: "docs/**"`,
      'non-inputs in effect from rt-test.json: "docs/**"',
    ]);
  });

  it("D2152: once a discovery that does not report its facts is protected in place of one that did, the log warns that the declared patterns stopped applying", async () => {
    const logged = await inTempDir((root) => {
      writeTree(root, DOCS_DECLARED);
      const log = memoryLog();
      return trackingOwnGitHome(
        root,
        async ({ tracker }) => {
          await tracker.protectInputs(unreportedDiscovery(root));
          return log.entries.filter(isDeclarationLine);
        },
        { log },
      );
    });
    expect(logged).toStrictEqual([
      'non-inputs in effect from rt-test.json: "docs/**"',
      `warning: ${NOT_REPORTED_AT_ROOT_REASON}; the patterns rt-test.json declares: "docs/**"`,
    ]);
  });

  it("D2153: once the declared patterns stop applying, a file one hid is an input by the time protection resolves, and a job open through it stays fingerprinted", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, DOCS_DECLARED);
      return trackingOwnGitHome(root, async ({ tracker, fingerprint }) => {
        const before = fingerprint();
        const mark = tracker.beginJob();
        await tracker.protectInputs(unreportedDiscovery(root));
        const after = fingerprint();
        return {
          moved: after !== undefined && after !== before,
          fingerprinted: (await tracker.endJob(mark)).fingerprinted,
        };
      });
    });
    expect(outcome).toStrictEqual({ moved: true, fingerprinted: true });
  });

  it("D2154: once a discovered project's include patterns come to match a file a declared pattern hid, it is an input by the time protection resolves", async () => {
    const moved = await inTempDir((root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("docs/**"),
        "docs/a.test.ts": "it('t', () => {});\n",
        "src/a.ts": "",
      });
      return trackingOwnGitHome(
        root,
        async ({ tracker, fingerprint }) => {
          const before = fingerprint();
          await tracker.protectInputs(discoveryIncluding(root, "**/*.test.ts"));
          const after = fingerprint();
          return after !== undefined && after !== before;
        },
        { discovery: discoveryIncluding(root, "src/**/*.test.ts") },
      );
    });
    expect(moved).toBe(true);
  });

  it("D2155: a file only the walk after patterns stop applying finds, modified after the job began, is named as possibly changed during it", async () => {
    const reason = await inTempDir((root) => {
      writeTree(root, DOCS_DECLARED);
      return trackingOwnGitHome(root, async ({ tracker }) =>
        tracker.protectInputs(
          unreportedDiscovery(root),
          Date.now() - JOB_BEGAN_BEFORE_MS,
        ),
      );
    });
    expect(reason).toBe(
      "docs/a.md, an input the tracker had not read before protection changed, may have changed while the job ran",
    );
  });

  it("D2156: while protection walks for the files a declared pattern no longer hides, no fingerprint can be computed", async () => {
    const during = await inTempDir((root) => {
      writeTree(root, DOCS_DECLARED);
      return trackingOwnGitHome(root, async ({ tracker }) => {
        const walking = tracker.protectInputs(unreportedDiscovery(root));
        const unavailable = tracker.current().unavailable;
        await walking;
        return unavailable;
      });
    });
    expect(during).toBe(
      "a change of protection is finding the files a declared pattern no longer hides",
    );
  });

  it("D2157: a setup file a declared pattern hid, which the tracker never read, is an input by the time a discovery reporting it is protected, and a job open through it stays fingerprinted", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, SETUP_DECLARED);
      return trackingOwnGitHome(
        root,
        async ({ tracker, fingerprint }) => {
          const before = fingerprint();
          const mark = tracker.beginJob();
          await tracker.protectInputs(setupDiscovery(root, ["setup/a.ts"]));
          const after = fingerprint();
          return {
            moved: after !== undefined && after !== before,
            fingerprinted: (await tracker.endJob(mark)).fingerprinted,
          };
        },
        { discovery: setupDiscovery(root, []) },
      );
    });
    expect(outcome).toStrictEqual({ moved: true, fingerprinted: true });
  });

  it("D2160: a setup file the discovery reports, which a declared pattern hid, edited after a job started, is reported as possibly changed during it", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, SETUP_DECLARED);
      const anHourAgo = new Date(Date.now() - AN_HOUR_MS);
      utimesSync(join(root, "setup/a.ts"), anHourAgo, anHourAgo);
      const discovery = setupDiscovery(root, ["setup/a.ts"]);
      return trackingOwnGitHome(
        root,
        async ({ tracker }) => {
          const since = Date.now();
          const before = tracker
            .current()
            .protectedFileChangedSince(discovery, since);
          appendFileSync(join(root, "setup/a.ts"), "// an edit\n");
          const after = tracker
            .current()
            .protectedFileChangedSince(discovery, since);
          return { before, after: after?.includes("setup/a.ts") === true };
        },
        { discovery: setupDiscovery(root, []) },
      );
    });
    expect(outcome).toStrictEqual({ before: undefined, after: true });
  });

  it("D2162: a stop while protection walks lets protection resolve, though a path it flipped is never read", async () => {
    const settled = await inTempDir((root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("docs/**"),
        "docs/a.test.ts": "it('t', () => {});\n",
        "src/a.ts": "",
      });
      return trackingOwnGitHome(
        root,
        async ({ tracker }) => {
          // Narrowing the include both flips the held docs/a.test.ts and starts a walk, which the stop then overtakes.
          const protecting = tracker.protectInputs(
            discoveryIncluding(root, "src/**"),
          );
          await tracker.stop();
          return within(
            protecting.then(() => PROTECTION_RESOLVED),
            SETTLE_MS,
          );
        },
        { discovery: discoveryIncluding(root, "**/*.test.ts") },
      );
    });
    expect(settled).toBe(PROTECTION_RESOLVED);
  });

  it("D2164: an input event on a path protection flipped, arriving before its quiet read, marks a job open through it", async () => {
    const verdict = await inTempDir(async (root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("*.md"),
        "a.md": "# a\n",
        "b.ts": "",
      });
      const { listeners, paths } = capturingWatches();
      try {
        return await trackingOwnGitHome(root, async ({ tracker }) => {
          const rootWatch = listeners[paths.indexOf(realpathSync.native(root))];
          const held = holdingReadsOf(NEVER_WRITTEN);
          const mark = tracker.beginJob();
          rootWatch?.("change", NEVER_WRITTEN);
          await held.entered;
          const protecting = tracker.protectInputs(
            discoveryListing(root, ["a.md"]),
          );
          rootWatch?.("change", "a.md");
          held.release();
          await protecting;
          return tracker.endJob(mark);
        });
      } finally {
        vi.mocked(readEntryDigest).mockReset();
        vi.mocked(watch).mockReset();
      }
    });
    expect(verdict).toStrictEqual(HELD_AND_A_MD_CHANGED);
  });

  it("D2165: while protection walks, the input facts read the reconciliation incomplete, naming the walk", async () => {
    const reconciliation = await inTempDir((root) => {
      writeTree(root, DOCS_DECLARED);
      return trackingOwnGitHome(root, async ({ tracker }) => {
        const walking = tracker.protectInputs(unreportedDiscovery(root));
        const during = tracker.facts().reconciliation;
        await walking;
        return during;
      });
    });
    expect(reconciliation).toStrictEqual({
      state: "incomplete",
      reason:
        "a change of protection is finding the files a declared pattern no longer hides",
    });
  });

  it("D2170: an input event already queued on a path protection then flips keeps that path's read marking a job open through it", async () => {
    const verdict = await inTempDir(async (root) => {
      writeTree(root, {
        [DECLARATION_FILE]: declaring("*.md"),
        "a.md": "# a\n",
        "b.ts": "",
      });
      const { listeners, paths } = capturingWatches();
      try {
        return await trackingOwnGitHome(
          root,
          async ({ tracker }) => {
            const rootWatch =
              listeners[paths.indexOf(realpathSync.native(root))];
            const held = holdingReadsOf(NEVER_WRITTEN);
            const mark = tracker.beginJob();
            rootWatch?.("change", NEVER_WRITTEN);
            await held.entered;
            rootWatch?.("change", "a.md");
            const protecting = tracker.protectInputs(
              discoveryListing(root, []),
            );
            held.release();
            await protecting;
            return tracker.endJob(mark);
          },
          { testModules: ["a.md"] },
        );
      } finally {
        vi.mocked(readEntryDigest).mockReset();
        vi.mocked(watch).mockReset();
      }
    });
    expect(verdict).toStrictEqual(HELD_AND_A_MD_CHANGED);
  });
});

describe("the declared patterns", () => {
  it("D2040: an rt-test.json saved with a UTF-8 byte-order mark declares its patterns", async () => {
    expect(await declarationIn(`﻿${declaring("docs/**")}`)).toStrictEqual({
      file: DECLARATION_FILE,
      state: "declared",
      patterns: ["docs/**"],
    });
  });

  it("D2047: a tsconfig file stays an input though a declared pattern matches it", () => {
    expect(
      matchedBy(
        ["**/*.json"],
        ["packages/lib/tsconfig.base.json", "packages/lib/data.json"],
      ),
    ).toStrictEqual([undefined, "**/*.json"]);
  });

  it("D2048: a jsconfig file stays an input though a declared pattern matches it", () => {
    expect(
      matchedBy(["**/*.json"], ["jsconfig.json", "data.json"]),
    ).toStrictEqual([undefined, "**/*.json"]);
  });

  it("D2049: a trailing ** or * also matches nothing, so docs/** matches docs and README* matches README", () => {
    expect(matchedBy(["docs/**", "README*"], ["docs", "README"])).toStrictEqual(
      ["docs/**", "README*"],
    );
  });

  it("D2000: ? matches exactly one character of a name", () => {
    expect(
      matchedBy(["docs/?.md"], ["docs/a.md", "docs/ab.md", "docs/.md"]),
    ).toStrictEqual(["docs/?.md", undefined, undefined]);
  });

  it("D2001: a pattern matches a path only in its own case", () => {
    expect(matchedBy(["docs/**"], ["docs/a.md", "Docs/a.md"])).toStrictEqual([
      "docs/**",
      undefined,
    ]);
  });

  it("D2002: * matches within one path segment and never across a /", () => {
    expect(matchedBy(["docs/*"], ["docs/a.md", "docs/a/b.md"])).toStrictEqual([
      "docs/*",
      undefined,
    ]);
  });

  it("D2003: rt-test.json may declare 256 patterns, and one declaring 257 declares nothing", async () => {
    const states = {
      atBound: await declarationStateIn(declaring(...patternList(256))),
      overBound: await declarationStateIn(declaring(...patternList(257))),
    };
    expect(states).toStrictEqual({
      atBound: "declared",
      overBound: "unusable",
    });
  });

  it("D2004: a pattern with a .. segment makes the declaration unusable", async () => {
    expect(await declarationStateIn(declaring("docs/../src/**"))).toBe(
      "unusable",
    );
  });

  it("D2005: a pattern using ** inside a segment makes the declaration unusable", async () => {
    expect(await declarationStateIn(declaring("docs/a**"))).toBe("unusable");
  });

  it("D2006: a pattern beginning with ! makes the declaration unusable", async () => {
    expect(await declarationStateIn(declaring("!docs/**"))).toBe("unusable");
  });

  it("D2007: a nonInputs array holding a number makes the declaration unusable", async () => {
    expect(
      await declarationStateIn(JSON.stringify({ nonInputs: ["docs/**", 3] })),
    ).toBe("unusable");
  });

  it("D2021: an rt-test.json whose top level is an array makes the declaration unusable", async () => {
    expect(await declarationStateIn(JSON.stringify(["docs/**"]))).toBe(
      "unusable",
    );
  });

  it("D2055: an rt-test.json that is not valid JSON is reported as not valid JSON, never as a file that cannot be read", async () => {
    const declaration = await declarationIn("{ not json");
    const reason = "reason" in declaration ? declaration.reason : "";
    expect({
      notValid: reason.includes("it is not valid JSON:"),
      unreadable: reason.includes("cannot be read"),
    }).toStrictEqual({ notValid: true, unreadable: false });
  });

  it("D2946: an empty nonInputVariables entry makes the declaration unusable", async () => {
    expect(await declarationStateIn(declaringVariables(""))).toBe("unusable");
  });

  it("D2947: a nonInputVariables entry beginning or ending with whitespace makes the declaration unusable", async () => {
    const states = {
      leading: await declarationStateIn(declaringVariables(" CI")),
      trailing: await declarationStateIn(declaringVariables("CI ")),
    };
    expect(states).toStrictEqual({ leading: "unusable", trailing: "unusable" });
  });

  it("D2948: a nonInputVariables entry holding = makes the declaration unusable", async () => {
    expect(await declarationStateIn(declaringVariables("CI=true"))).toBe(
      "unusable",
    );
  });

  it("D2949: a nonInputVariables entry holding a NUL character makes the declaration unusable", async () => {
    expect(await declarationStateIn(declaringVariables("CI\u0000"))).toBe(
      "unusable",
    );
  });

  it("D2950: a nonInputVariables entry holding * other than last makes the declaration unusable", async () => {
    expect(await declarationStateIn(declaringVariables("EFC_*_1"))).toBe(
      "unusable",
    );
  });

  it("D2951: a nonInputVariables entry of * alone makes the declaration unusable, with the reason a malformed nonInputs gives", async () => {
    const declaration = await declarationIn(declaringVariables("*"));
    const reason = "reason" in declaration ? declaration.reason : "";
    expect({
      state: "state" in declaration ? declaration.state : declaration.thrown,
      samePrefix: reason.startsWith(UNUSABLE_REASON_PREFIX),
    }).toStrictEqual({ state: "unusable", samePrefix: true });
  });

  it("D2952: a nonInputVariables array holding a number makes the declaration unusable", async () => {
    expect(await declarationStateIn(declaringVariables("CI", 3))).toBe(
      "unusable",
    );
  });

  it("D2953: rt-test.json may declare 256 variable entries, and one declaring 257 declares nothing", async () => {
    const entries = (count: number): string[] =>
      Array.from({ length: count }, (_, index) => `RT_TEST_${index}`);
    const states = {
      atBound: await declarationStateIn(declaringVariables(...entries(256))),
      overBound: await declarationStateIn(declaringVariables(...entries(257))),
    };
    expect(states).toStrictEqual({
      atBound: "declared",
      overBound: "unusable",
    });
  });

  it("D2957: a nonInputs or nonInputVariables member that is a string or an object makes the declaration unusable, and reading it never throws", async () => {
    const states = {
      patternsString: await declarationStateIn(
        JSON.stringify({ nonInputs: "docs/**" }),
      ),
      patternsObject: await declarationStateIn(
        JSON.stringify({ nonInputs: { docs: "**" } }),
      ),
      variablesString: await declarationStateIn(
        JSON.stringify({ nonInputVariables: "CI" }),
      ),
      variablesObject: await declarationStateIn(
        JSON.stringify({ nonInputVariables: { CI: true } }),
      ),
    };
    expect(states).toStrictEqual({
      patternsString: "unusable",
      patternsObject: "unusable",
      variablesString: "unusable",
      variablesObject: "unusable",
    });
  });
});

describe("the count of periodic reconciliations", () => {
  it("D2680: the count is 0 once the first reconciliation has ended, and rises by one when the periodic reconciliation ends", async () => {
    const outcome = await inTempDir((root) => {
      writeTree(root, { "src/a.ts": "" });
      return withFakeElapsed(() =>
        tracking(root, async ({ tracker }) => {
          const before = tracker.periodicReconciliations();
          await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL);
          await settled(tracker);
          return { before, after: tracker.periodicReconciliations() };
        }),
      );
    });
    expect(outcome).toStrictEqual({ before: 0, after: 1 });
  });

  it("D2681: a reconciliation an edit to an ignore file started does not count as a periodic one", async () => {
    const count = await inTempDir((root) => {
      repository(root, "*.log\n", { "src/a.ts": "" });
      return trackingOwnGitHome(root, async ({ tracker, log }) => {
        appendFileSync(join(root, ".gitignore"), "*.tmp\n");
        await eventually(
          () => log.entries.includes(IGNORE_RULES_CHANGED_STARTED),
          SETTLE_MS,
        );
        await eventually(
          () =>
            log.entries.filter((entry) =>
              entry.startsWith(RECONCILIATION_ENDED),
            ).length >= 2,
          SETTLE_MS,
        );
        return tracker.periodicReconciliations();
      });
    });
    expect(count).toBe(0);
  });

  /** Counts each reconciliation's end from the log; the count moves before the reconciliation is settled, so a test polls it. */
  const endsIn = (log: MemoryLog): number =>
    log.entries.filter((entry) => entry.startsWith(RECONCILIATION_ENDED))
      .length;

  /** Resolves once the log holds `count` ends, polling on `setImmediate`, which fake `setTimeout` leaves real. */
  async function untilEnds(log: MemoryLog, count: number): Promise<void> {
    const deadline = Date.now() + SETTLE_MS;
    while (endsIn(log) < count && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  it("D2737: a reconciliation an edit to the declaration started, after the periodic one, does not count as a periodic one", async () => {
    const outcome = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const watches = silentCapturedWatches();
      try {
        return await withFakeElapsed(() =>
          tracking(root, async ({ tracker, log }) => {
            await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL);
            await untilEnds(log, 2);
            const afterPeriodic = tracker.periodicReconciliations();
            deliver(watches, root, DECLARATION_FILE);
            await untilEnds(log, 3);
            return {
              afterPeriodic,
              afterEdit: tracker.periodicReconciliations(),
            };
          }),
        );
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(outcome).toStrictEqual({ afterPeriodic: 1, afterEdit: 1 });
  });

  it("D2738: a periodic reconciliation the timer requests while another reconciliation runs is counted once they have ended", async () => {
    const count = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const watches = silentCapturedWatches();
      try {
        return await withFakeElapsed(() =>
          tracking(root, async ({ tracker, log }) => {
            deliver(watches, root, DECLARATION_FILE);
            vi.advanceTimersByTime(RECONCILE_INTERVAL);
            await untilEnds(log, 2);
            return tracker.periodicReconciliations();
          }),
        );
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(count).toBe(1);
  });

  it("D2878: reconciliations another cause starts more often than the interval still count one as periodic once the interval has passed since the last one counted", async () => {
    const count = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const watches = silentCapturedWatches();
      try {
        return await withFakeElapsed(() =>
          tracking(root, async ({ tracker, log }) => {
            await vi.advanceTimersByTimeAsync(SOONER_THAN_INTERVAL);
            deliver(watches, root, DECLARATION_FILE);
            await untilEnds(log, 2);
            await vi.advanceTimersByTimeAsync(SOONER_THAN_INTERVAL);
            deliver(watches, root, DECLARATION_FILE);
            await untilEnds(log, 3);
            return tracker.periodicReconciliations();
          }),
        );
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(count).toBe(1);
  });
});

describe("a job's verdict", () => {
  it("D2728: a job during which a watcher failure was recorded, and that ended with no fingerprint computable, is not judged as having had its inputs change while it ran", () => {
    const failure = "the watcher failed: ENOSPC";
    const windows = new JobWindows();
    const mark = windows.open(undefined);
    windows.recordCause(failure);
    const verdict = windows.close(mark, failure);
    expect(
      "changedWhileRunning" in verdict && verdict.changedWhileRunning,
    ).toBe(false);
  });

  it("D2684: a job during which a change was recorded is judged as having had its inputs change while it ran", () => {
    const windows = new JobWindows();
    const mark = windows.open(undefined);
    windows.recordPath("a.md");
    expect(windows.close(mark, undefined)).toStrictEqual(A_MD_CHANGED);
  });

  it("D2685: a job that began with its inputs unsettled is not judged as having had them change while it ran", () => {
    const windows = new JobWindows();
    const verdict = windows.close(
      windows.open("a reconciliation was running"),
      undefined,
    );
    expect(
      "changedWhileRunning" in verdict && verdict.changedWhileRunning,
    ).toBe(false);
  });

  it("D2686: a job that ended with no fingerprint computable and no change recorded is not judged as having had its inputs change while it ran", () => {
    const windows = new JobWindows();
    const verdict = windows.close(
      windows.open(undefined),
      "the watcher failed: ENOSPC",
    );
    expect(verdict).toStrictEqual({
      fingerprinted: false,
      reason: "the watcher failed: ENOSPC",
      changedWhileRunning: false,
    });
  });

  it("D2687: the count of changes a verdict leaves unnamed counts each distinct one once, however often it was recorded", () => {
    const windows = new JobWindows();
    const mark = windows.open(undefined);
    for (let named = 0; named < 20; named += 1) {
      windows.recordPath(`named-${named}.ts`);
    }
    for (const past of ["past-1.ts", "past-1.ts", "past-2.ts"]) {
      windows.recordPath(past);
    }
    const verdict = windows.close(mark, undefined);
    expect("reason" in verdict && verdict.reason.endsWith(" and 2 more")).toBe(
      true,
    );
  });
});

describe("a workspace whose env files are not known", () => {
  it("D3124: a workspace one of whose projects' env sources are not known has no fingerprint, the reason saying its env files are not known and giving the reason its discovery stored", () => {
    const print = workspaceFingerprint(
      new ProjectInputs(REPO, new Map()),
      workspaceAt(REPO, [], {
        reported: true,
        projects: [
          projectFacts({ projectName: "flat", envSources: [ROOT_ENV_SOURCE] }),
          projectFacts({
            projectName: "nested",
            envSources: {
              notKnown:
                "a nested projects container declares its projects (app/vitest.config.mjs)",
            },
          }),
        ],
      }),
    );
    expect(print).toStrictEqual({
      ok: false,
      reason:
        "the env files of the workspace at the consumer root are not known: a nested projects container declares its projects (app/vitest.config.mjs)",
    });
  });

  it("D3125: a discovered workspace whose selection facts are not reported has no fingerprint, the reason saying its discovery does not report its projects' env sources", () => {
    const print = workspaceFingerprint(
      new ProjectInputs(REPO, new Map()),
      workspaceAt(REPO, [], { reported: false }),
    );
    expect(print).toStrictEqual({
      ok: false,
      reason:
        "the env files of the workspace at the consumer root are not known: its discovery does not report the env sources of its projects",
    });
  });
});

describe("the committed digests a job's window keeps", () => {
  it("D3172: a job's window keeps the committed digests at its open and at its close", async () => {
    const kept = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const watches = silentCapturedWatches();
      try {
        return await tracking(root, async ({ tracker }) => {
          const digestNow = (): string | undefined =>
            tracker.current().snapshot?.digests.get("src/a.ts");
          const opened = digestNow();
          const mark = tracker.beginJob();
          appendFileSync(join(root, "src", "a.ts"), "export {};\n");
          deliver(watches, root, join("src", "a.ts"));
          await tracker.endJob(mark);
          const closed = digestNow();
          const { startDigests, endDigests } = mark.window;
          return {
            start:
              opened !== undefined && startDigests?.get("src/a.ts") === opened,
            end: closed !== opened && endDigests?.get("src/a.ts") === closed,
          };
        });
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(kept).toStrictEqual({ start: true, end: true });
  });

  it("D3173: a job's window opened before the first reconciliation has ended keeps no digests", async () => {
    const digests = await inTempDir(async (root) => {
      writeTree(root, { "src/a.ts": "" });
      const tracker = new InputTracker({
        consumerRoot: root,
        exclusions: [join(root, STATE_DIRECTORY)],
        log: memoryLog(),
      });
      try {
        return tracker.beginJob().window.startDigests;
      } finally {
        await tracker.stop();
      }
    });
    expect(digests).toBeUndefined();
  });
});

/** A watch that never reports and whose close throws, as closing a handle the system already released can. */
function throwingCloseWatch(): FSWatcher {
  return Object.assign(silentWatch(), {
    close: () => {
      throw new Error("the watch handle is gone");
    },
  });
}

describe("stopping the tracker", { timeout: DAEMON_TEST_TIMEOUT_MS }, () => {
  it("D3256: a stop whose watcher close throws still releases a wait on the tracker's change signal", async () => {
    const outcome = await inTempDir(async (root) => {
      writeTree(root, { "a.ts": UNCHANGED_TEXT });
      vi.mocked(watch).mockImplementation((() =>
        throwingCloseWatch()) as typeof watch);
      try {
        const tracker = new InputTracker({
          consumerRoot: root,
          exclusions: [join(root, STATE_DIRECTORY)],
          log: memoryLog(),
        });
        tracker.start();
        await tracker.firstReconciled();
        const resolved = changeSignal(tracker);
        const watchesOpened = vi.mocked(watch).mock.calls.length > 0;
        await tracker.stop().catch(() => undefined);
        await new Promise((resolve) => setImmediate(resolve));
        return { watchesOpened, released: resolved() };
      } finally {
        vi.mocked(watch).mockReset();
      }
    });
    expect(outcome).toStrictEqual({ watchesOpened: true, released: true });
  });
});

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
  type WatchListener,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { recordStarted } from "../../../test/scripts/run-cleanup.mjs";
import { daemonEntryPoint } from "../src/daemon/entry-point.js";
import {
  ProjectInputs,
  workspaceFingerprint,
} from "../src/inputs/fingerprint.js";
import { gitSources } from "../src/inputs/git-sources.js";
import { readEntryDigest } from "../src/inputs/input-inventory.js";
import { InputTracker } from "../src/inputs/input-tracker.js";
import {
  declaredNonInputs,
  readNonInputs,
  type NonInputsDeclaration,
} from "../src/inputs/non-inputs.js";
import { readCheckedIgnored } from "../src/selection/git-ignored.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import { readJson } from "../src/vitest/find-workspaces.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  eventually,
  memoryLog,
  type MemoryLog,
} from "./daemon-harness.js";
import {
  REPO,
  fakeVitest,
  fixtureRepository,
  inTempDir,
  onPlatform,
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

const ROOT_WORKSPACE = ".";
const STATE_DIRECTORY = ".rt-test";
/** Far longer than the tracker takes to read an edit on an idle machine; a wait this long has failed. */
const SETTLE_MS = 10_000;
/** How long after a reconciliation ends the next one runs, as the ticket's requirement states it: 5 minutes. */
const RECONCILE_INTERVAL = 300_000;
/** How long events stream before the job ends, enough for the tracker to read several. */
const STREAM_MS = 50;
const RECONCILING = "a reconciliation of the inputs is running";
const FIRST_RECONCILIATION = "the first reconciliation has not ended";
const PERIODIC_STARTED =
  "input reconciliation started: the periodic reconciliation";
/** The soonest after a reconciliation that could not establish the input set that an event starts the next one. */
const LOST_INPUT_SET_RETRY = 10_000;
const LOST_INPUT_SET_RETRY_STARTED =
  "input reconciliation started: an input event arrived while the input set could not be established";
const DECLARATION_FILE = "rt-test.json";
const DECLARATION_CHANGED_STARTED =
  "input reconciliation started: rt-test.json, which declares the non-inputs, changed";
const UNUSABLE_JSON_REASON =
  "rt-test.json declares no non-inputs, so every file stays an input: it is not valid JSON: ";
const TRACKER_MODULE = new URL(
  "../src/inputs/input-tracker.ts",
  import.meta.url,
).href;
/**
 * Starts a tracker over the root it is given and writes a line once the first reconciliation has ended and another
 * once a timer set after that fires. A tracker that holds the event loop after reconciling never lets the timer fire.
 */
const IDLE_TRACKER_SCRIPT = [
  "const [trackerModule, root] = process.argv.slice(1);",
  "const { InputTracker } = await import(trackerModule);",
  'const log = { file: "idle-tracker.log", entry() {}, error() {} };',
  "const tracker = new InputTracker({ consumerRoot: root, exclusions: [], log });",
  "tracker.start();",
  "await tracker.firstReconciled();",
  'process.stdout.write("reconciled\\n");',
  'setTimeout(() => { process.stdout.write("timer fired\\n"); void tracker.stop(); }, 50);',
].join("\n");

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

/** The consumer root as one Vitest workspace whose latest discovery lists `testModules`. */
function workspaceAt(
  root: string,
  testModules: readonly string[] = [],
): WorkspaceDiscovery {
  return {
    status: "discovered",
    workspace: { path: ROOT_WORKSPACE, directory: root },
    vitestVersion: "5.0.1",
    tests: testModules.map((modulePath) => ({
      identity: {
        workspacePath: ROOT_WORKSPACE,
        projectName: "unit",
        modulePath,
        namePath: ["t"],
        occurrence: 0,
      },
      isDuplicate: false,
      mode: "run",
    })),
    failedModules: [],
    typecheckModules: [],
    unsupportedProjects: [],
    unhandledErrors: [],
  };
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
  try {
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
  const listeners: WatchListener<string>[] = [];
  const paths: string[] = [];
  vi.mocked(watch).mockImplementation(((
    path: PathLike,
    _options: unknown,
    listener: WatchListener<string>,
  ) => {
    listeners.push(listener);
    paths.push(String(path));
    return silentWatch();
  }) as typeof watch);
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

/** For each path, the pattern that makes it a declared non-input under `patterns`, protecting no test module. */
function matchedBy(
  patterns: readonly string[],
  paths: readonly string[],
): (string | undefined)[] {
  const match = declaredNonInputs(
    { file: DECLARATION_FILE, state: "declared", patterns },
    new Set(),
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
      return tracking(root, async (tracked) => {
        const before = tracked.fingerprint();
        writeFileSync(join(root, "newdir/new.ts"), "export {};\n");
        return movesFrom(tracked, before);
      });
    });
    expect(changed).toBe(true);
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
          .testModuleChangedSince(discovery, since);
        appendFileSync(join(root, "gen/a.test.ts"), "// an edit\n");
        const after = tracker
          .current()
          .testModuleChangedSince(discovery, since);
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
});

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
      return tracking(root, async ({ tracker }) => {
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
      return tracking(join(dir, "sub"), async ({ tracker }) => {
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
      return tracking(join(dir, "sub"), async ({ tracker }) => {
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
      return tracking(join(dir, "sub"), async ({ tracker }) => {
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
      return tracking(root, async ({ tracker }) => {
        const last = tracker.facts().lastReconciledAt;
        appendFileSync(join(root, ".gitignore"), "*.tmp\n");
        return eventually(
          () => tracker.facts().lastReconciledAt !== last,
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
        { cwd: REPO, stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
      );
      if (child.pid !== undefined) {
        recordStarted(runTempRoot(), { pids: [child.pid] });
      }
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      if ((await within(exited, SETTLE_MS)) === "waiting") {
        child.kill();
        await exited;
      }
      return stdout.split("\n").filter((line) => line !== "");
    });
    expect(lines).toStrictEqual(["reconciled", "timer fired"]);
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
});

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
        return tracking(root, async ({ tracker }) => {
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
        return tracking(join(dir, "sub"), async ({ tracker }) => {
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
      return tracking(root, async ({ tracker }) => {
        const revision = tracker.facts().revision;
        const mark = tracker.beginJob();
        await tracker.protectTestModules(
          discoveryListing(root, ["src/a.test.ts"]),
        );
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
      return tracking(root, async (tracked) => {
        const before = tracked.fingerprint();
        await tracked.tracker.protectTestModules(
          discoveryListing(root, ["src/a.test.ts"]),
        );
        const whileProtected = tracked.fingerprint();
        await tracked.tracker.protectTestModules(discoveryListing(root, []));
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
});

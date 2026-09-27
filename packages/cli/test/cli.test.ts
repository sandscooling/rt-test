import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  daemonStatus,
  servingDaemon,
  type DaemonIdentity,
  type NotDiscoveredEntry,
  type StartPlan,
} from "@rt-test/daemon/client";
import { daemonEntryPoint } from "../../daemon/src/daemon/entry-point.js";
import { isRunning } from "../../daemon/src/daemon/runtime-directory.js";
import { consumerIdentity } from "../../daemon/src/store/consumer-identity.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  DAEMON_WAIT_MS,
  IDLE_ENTRY,
  WORKSPACE_A,
  WORKSPACE_B,
  atHoldPoint,
  confirmNothing,
  eventually,
  holdAt,
  logged,
  settled,
  started,
  storedRuns,
  withDaemonConsumer,
  withStandIn,
  type Settled,
} from "../../daemon/test/daemon-harness.js";
import { REPO, confirmEvery, inTempDir } from "../../daemon/test/harness.js";
import type { CliIo } from "../src/command.js";
import { notDiscoveredLines } from "../src/answer-text.js";
import { main } from "../src/main.js";
import { Output, type ExitCode } from "../src/output.js";
import { decideTrust, type TrustDecision } from "../src/trust-prompt.js";

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const LIST_MODULES = join(REPO, "test/fixtures/daemon/list-modules.mjs");
/** The Node flags a process needs to run this repository's packages from source. */
const SOURCE_FLAGS = daemonEntryPoint("daemon-main").execArgv;
/** A module of the Vitest package, as opposed to the daemon's own `src/vitest/`. */
const VITEST_PACKAGE_URL =
  /\/node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?vitest\//;

/** The daemon fixture's workspaces, each with the config file a start confirms for it. */
const LISTED_WORKSPACES = [WORKSPACE_A, WORKSPACE_B].map((path) => ({
  path,
  configFile: `${path}/vitest.config.mjs`,
}));
const DECLINED = "not started: not trusted";
/** How the question marks its answers. */
const QUESTION = /y\/N/;
const ENTER = "\r";
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
/** Ends the simulated terminal's input in place of typing a reply. */
const END_OF_INPUT = Symbol("end of input");
/** An answer settles the prompt within milliseconds, so one still pending by then never settles. */
const HANG_BOUND_MS = 5_000;
const HUNG = "hung";
/** Any process id: a stand-in on the endpoint never proves it. */
const STAND_IN_PID = 4242;
/** A config that marks the moment any process loads it. */
const MARKING_CONFIG = [
  'import { writeFileSync } from "node:fs";',
  'writeFileSync(new URL("./loaded", import.meta.url), "");',
  "export default { test: { globals: true } };",
  "",
].join("\n");

type Reply = string | typeof END_OF_INPUT;

interface Invocation {
  readonly cwd: string;
  readonly terminal?: { readonly stdin: boolean; readonly stderr: boolean };
  /** Typed once the question appears on stderr. */
  readonly reply?: Reply;
  /** Runs once the question appears, before the reply. */
  readonly atQuestion?: () => void;
}

interface Session {
  readonly io: CliIo;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly asked: () => boolean;
  readonly close: () => void;
}

const BOTH_TERMINALS = { stdin: true, stderr: true } as const;

/** The streams a command gets, with stdin a simulated terminal when `terminal` says so, which types `reply`. */
function simulatedSession(invocation: Invocation): Session {
  const stdin = Object.assign(new PassThrough(), {
    isTTY: invocation.terminal?.stdin === true,
    setRawMode: () => undefined,
  });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  let asked = false;
  stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString("utf8");
  });
  stderr.on("data", (chunk: Buffer) => {
    err += chunk.toString("utf8");
    if (asked || !QUESTION.test(err)) return;
    asked = true;
    setImmediate(() => {
      invocation.atQuestion?.();
      if (invocation.reply === END_OF_INPUT) stdin.end();
      else if (invocation.reply !== undefined) stdin.write(invocation.reply);
    });
  });
  return {
    io: {
      stdin,
      stdout,
      stderr,
      stdinIsTerminal: invocation.terminal?.stdin === true,
      stderrIsTerminal: invocation.terminal?.stderr === true,
      cwd: invocation.cwd,
    },
    stdout: () => out,
    stderr: () => err,
    asked: () => asked,
    close: () => {
      stdin.destroy();
      stdout.end();
      stderr.end();
    },
  };
}

function bounded<T>(work: Promise<T>): Promise<T | typeof HUNG> {
  let timer: NodeJS.Timeout | undefined;
  const hung = new Promise<typeof HUNG>((resolve) => {
    timer = setTimeout(() => resolve(HUNG), HANG_BOUND_MS);
  });
  return Promise.race([work, hung]).finally(() => clearTimeout(timer));
}

interface CliRun {
  readonly exit: Settled<ExitCode> | typeof HUNG;
  readonly stdout: string;
  readonly stderr: string;
  readonly asked: boolean;
}

/** Runs `rt-test <argv>` in process, as `bin.ts` does, with the streams `invocation` describes. */
async function runCli(
  argv: readonly string[],
  invocation: Invocation,
): Promise<CliRun> {
  const session = simulatedSession(invocation);
  try {
    const exit = await bounded(settled(main(argv, session.io)));
    return {
      exit,
      stdout: session.stdout(),
      stderr: session.stderr(),
      asked: session.asked(),
    };
  } finally {
    session.close();
  }
}

type Document = Readonly<Record<string, unknown>>;

/** The one JSON document on stdout, or an empty object when stdout is not exactly one. */
function documentOf(run: CliRun): Document {
  try {
    const value: unknown = JSON.parse(run.stdout);
    return typeof value === "object" && value !== null
      ? (value as Document)
      : {};
  } catch {
    return {};
  }
}

function reasonOf(run: CliRun): string {
  return String(documentOf(run)["reason"]);
}

function daemonOf(run: CliRun): Document {
  const daemon = documentOf(run)["daemon"];
  return typeof daemon === "object" && daemon !== null
    ? (daemon as Document)
    : {};
}

/** Adds the process of any daemon the run reports starting, so the test ends it however the test ends. */
function tracked(run: CliRun, pids: Set<number>): CliRun {
  const pid = daemonOf(run)["pid"];
  if (typeof pid === "number") pids.add(pid);
  return run;
}

/** Decides trust on a simulated terminal that types `reply` at the question. */
async function trustAfter(
  reply: Reply,
): Promise<Settled<TrustDecision> | typeof HUNG> {
  const session = simulatedSession({
    cwd: REPO,
    terminal: BOTH_TERMINALS,
    reply,
  });
  const plan: StartPlan = {
    start: { consumerRoot: join(REPO, "consumer"), workspaces: [] },
    stateDirectory: join(REPO, "consumer", ".rt-test"),
    notRead: [],
  };
  try {
    return await bounded(
      settled(
        decideTrust(
          session.io,
          new Output(session.io, "start", false),
          plan,
          false,
        ),
      ),
    );
  } finally {
    session.close();
  }
}

/** Adds `pattern` to the consumer's `package.json` workspaces, as a project's own manifest could hold it. */
function addWorkspacePattern(root: string, pattern: string): void {
  const file = join(root, "package.json");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as {
    workspaces: string[];
  };
  manifest.workspaces.push(pattern);
  writeFileSync(file, JSON.stringify(manifest));
}

function usageOutcome(run: CliRun, usage: readonly string[]) {
  return {
    exit: run.exit,
    stdout: run.stdout,
    usage: usage.every((line) => run.stderr.includes(line)),
  };
}

const USAGE_ERROR = { exit: 2, stdout: "", usage: true };

/** Runs each argument list from an empty directory, where a command that ran anyway finds nothing to start or stop. */
function usageOutcomes(
  cases: readonly (readonly string[])[],
  usage: (argv: readonly string[]) => readonly string[],
) {
  return inTempDir(async (cwd) => {
    const outcomes = [];
    for (const argv of cases) {
      outcomes.push(usageOutcome(await runCli(argv, { cwd }), usage(argv)));
    }
    return outcomes;
  });
}

describe("the listing a start shows before anything executes", () => {
  it(
    "D1711: the listing names the root, the state directory resolved against the command's directory, and each workspace's config file",
    async () => {
      const outcome = await withDaemonConsumer(async (root) => {
        const cwd = dirname(root);
        const run = await runCli(
          ["start", basename(root), "--state-dir", "custom-state"],
          { cwd },
        );
        return {
          root: run.stderr.includes(root),
          stateDirectory: run.stderr.includes(join(cwd, "custom-state")),
          configs: LISTED_WORKSPACES.map((workspace) =>
            run.stderr.includes(workspace.configFile),
          ),
        };
      });
      expect(outcome).toStrictEqual({
        root: true,
        stateDirectory: true,
        configs: [true, true],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1712: with no --state-dir, the state directory is .rt-test under the root",
    async () => {
      const outcome = await withDaemonConsumer(async (root) => {
        const run = await runCli(["start", "--json"], { cwd: root });
        return {
          stateDirectory: documentOf(run)["stateDirectory"],
          expected: join(root, ".rt-test"),
        };
      });
      expect(outcome.stateDirectory).toBe(outcome.expected);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1713: with no root argument, the root is the command's current directory",
    async () => {
      const outcome = await withDaemonConsumer(async (root) => {
        const run = await runCli(["start", "--json"], { cwd: root });
        return { consumerRoot: documentOf(run)["consumerRoot"], root };
      });
      expect(outcome.consumerRoot).toBe(outcome.root);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1714: the listing says starting executes plugins, further project configs such as test.projects, globalSetup, setup files and test modules",
    async () => {
      const missing = await withDaemonConsumer(async (root) => {
        const run = await runCli(["start"], { cwd: root });
        return [
          "plugins",
          "test.projects",
          "globalSetup",
          "setup files",
          "test modules",
        ].filter((term) => !run.stderr.includes(term));
      });
      expect(missing).toStrictEqual([]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1715: each workspace source the listing could not read is named on one line",
    async () => {
      const lines = await withDaemonConsumer(async (root) => {
        addWorkspacePattern(root, "!packages/skip");
        const run = await runCli(["start"], { cwd: root });
        return run.stderr
          .split("\n")
          .filter((line) => line.includes("!packages/skip")).length;
      });
      expect(lines).toBe(1);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1716: a terminal escape sequence in a consumer's workspace pattern reaches stderr escaped, never as a raw ESC",
    async () => {
      const outcome = await withDaemonConsumer(async (root) => {
        addWorkspacePattern(root, "!\u001b[1A\u001b[2KHIDDEN");
        const run = await runCli(["start"], { cwd: root });
        return {
          raw: run.stderr.includes("\u001b"),
          escaped: run.stderr.includes("\\u001b[1A\\u001b[2KHIDDEN"),
        };
      });
      expect(outcome).toStrictEqual({ raw: false, escaped: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1717: a line break in a consumer's workspace pattern is escaped, so it cannot forge a line of the listing",
    async () => {
      const outcome = await withDaemonConsumer(async (root) => {
        addWorkspacePattern(root, "!x\nwarning: FORGED");
        const run = await runCli(["start"], { cwd: root });
        return {
          forged: run.stderr
            .split("\n")
            .filter((line) => line.startsWith("warning: FORGED")).length,
          escaped: run.stderr.includes("!x\\u000awarning: FORGED"),
        };
      });
      expect(outcome).toStrictEqual({ forged: 0, escaped: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("the question on a terminal", () => {
  it(
    "D1718: YES in capitals is a yes",
    async () => {
      expect(await trustAfter(`YES${ENTER}`)).toStrictEqual({ trusted: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1719: a y surrounded by whitespace is a yes",
    async () => {
      expect(await trustAfter(`  y  ${ENTER}`)).toStrictEqual({
        trusted: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1720: yes spelled out is a yes",
    async () => {
      expect(await trustAfter(`yes${ENTER}`)).toStrictEqual({ trusted: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1721: any other answer starts nothing and exits 1 with the reason not started: not trusted",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const run = tracked(
          await runCli(["start", "--json"], {
            cwd: root,
            terminal: BOTH_TERMINALS,
            reply: `yep${ENTER}`,
          }),
          pids,
        );
        return { exit: run.exit, reason: reasonOf(run) };
      });
      expect(outcome).toStrictEqual({ exit: 1, reason: DECLINED });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1722: input that ends at the question is a no, and the question never hangs",
    async () => {
      expect(await trustAfter(END_OF_INPUT)).toStrictEqual({
        trusted: false,
        reason: DECLINED,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1723: Ctrl-C at the question is a no, and the question never hangs",
    async () => {
      expect(await trustAfter(CTRL_C)).toStrictEqual({
        trusted: false,
        reason: DECLINED,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1724: Ctrl-D at the question is a no, and the question never hangs",
    async () => {
      expect(await trustAfter(CTRL_D)).toStrictEqual({
        trusted: false,
        reason: DECLINED,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1745: Enter alone is a no",
    async () => {
      expect(await trustAfter(ENTER)).toStrictEqual({
        trusted: false,
        reason: DECLINED,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1725: --trust on a terminal still asks, and one line says --trust applies only without a terminal",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const run = tracked(
          await runCli(["start", "--trust", "--json"], {
            cwd: root,
            terminal: BOTH_TERMINALS,
            reply: `n${ENTER}`,
          }),
          pids,
        );
        return {
          exit: run.exit,
          asked: run.asked,
          trustLines: run.stderr
            .split("\n")
            .filter((line) => line.includes("--trust")).length,
        };
      });
      expect(outcome).toStrictEqual({ exit: 1, asked: true, trustLines: 1 });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1726: a terminal on stdin with no terminal on stderr counts as no terminal: nothing is asked and the start is refused",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const run = tracked(
          await runCli(["start", "--json"], {
            cwd: root,
            terminal: { stdin: true, stderr: false },
            reply: `n${ENTER}`,
          }),
          pids,
        );
        return {
          exit: run.exit,
          asked: run.asked,
          saysTrust: reasonOf(run).includes("--trust"),
        };
      });
      expect(outcome).toStrictEqual({ exit: 1, asked: false, saysTrust: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("a start with no terminal", () => {
  it(
    "D1727: without --trust it starts nothing and exits 1 with a reason naming the root and --trust, on stdout's document and on stderr",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const run = tracked(
          await runCli(["start", "--json"], { cwd: root }),
          pids,
        );
        const reason = reasonOf(run);
        return {
          exit: run.exit,
          ok: documentOf(run)["ok"],
          namesRoot: reason.includes(root),
          namesTrust: reason.includes("--trust"),
          onStderr: run.stderr.includes(reason),
        };
      });
      expect(outcome).toStrictEqual({
        exit: 1,
        ok: false,
        namesRoot: true,
        namesTrust: true,
        onStderr: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1728: after a trusted start and a stop, a start without --trust is refused, with every file they left still present",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const trusted = tracked(
          await runCli(["start", "--trust", "--json"], { cwd: root }),
          pids,
        );
        const stop = await runCli(["stop", "--json"], { cwd: root });
        const again = tracked(
          await runCli(["start", "--json"], { cwd: root }),
          pids,
        );
        const reason = reasonOf(again);
        return {
          trusted: trusted.exit,
          stop: stop.exit,
          again: again.exit,
          refusedForTrust: reason.includes(root) && reason.includes("--trust"),
        };
      });
      expect(outcome).toStrictEqual({
        trusted: 0,
        stop: 0,
        again: 1,
        refusedForTrust: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("a trusted start", () => {
  it(
    "D1729: exits 0 once the daemon answers, reporting its process, the root, both identities, the state directory, the protocol version and the confirmed workspaces",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const run = tracked(
          await runCli(["start", "--trust", "--json"], { cwd: root }),
          pids,
        );
        const daemon = daemonOf(run);
        const status = await settled(daemonStatus(root));
        return {
          actual: {
            exit: run.exit,
            answering: !("thrown" in status) && status.pid === daemon["pid"],
            consumerRoot: daemon["consumerRoot"],
            projectIdentity: daemon["projectIdentity"],
            worktreeIdentity: daemon["worktreeIdentity"],
            stateDirectory: daemon["stateDirectory"],
            protocolVersion: daemon["protocolVersion"],
            workspaces: documentOf(run)["workspaces"],
          },
          expected: {
            exit: 0,
            answering: true,
            consumerRoot: root,
            ...consumerIdentity(root),
            stateDirectory: join(root, ".rt-test"),
            protocolVersion: 1,
            workspaces: LISTED_WORKSPACES,
          },
        };
      });
      expect(outcome.actual).toStrictEqual(outcome.expected);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1730: a workspace added after the listing is never loaded",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const added = join(root, "packages/c");
        const run = tracked(
          await runCli(["start", "--json"], {
            cwd: root,
            terminal: BOTH_TERMINALS,
            reply: `y${ENTER}`,
            atQuestion: () => {
              mkdirSync(added);
              writeFileSync(join(added, "vitest.config.mjs"), MARKING_CONFIG);
            },
          }),
          pids,
        );
        const logFile = String(daemonOf(run)["logFile"]);
        return {
          exit: run.exit,
          idle: await eventually(() => logged(logFile, IDLE_ENTRY)),
          loaded: existsSync(join(added, "loaded")),
        };
      });
      expect(outcome).toStrictEqual({ exit: 0, idle: true, loaded: false });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1731: with a daemon already serving the worktree, it asks nothing and exits 1 naming that daemon's process",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const serving = await started(root, pids);
        if ("thrown" in serving) return serving;
        const run = tracked(
          await runCli(["start", "--json"], {
            cwd: root,
            terminal: BOTH_TERMINALS,
            reply: `n${ENTER}`,
          }),
          pids,
        );
        return {
          exit: run.exit,
          asked: run.asked,
          namesProcess: reasonOf(run).includes(`process ${serving.pid}`),
        };
      });
      expect(outcome).toStrictEqual({
        exit: 1,
        asked: false,
        namesProcess: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1732: with the endpoint held by something the client cannot confirm, it asks nothing and exits 1 with the client's reason",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) =>
        withStandIn(
          consumerIdentity(root).worktreeIdentity,
          (request) =>
            request["type"] === "hello"
              ? { type: "hello", protocolVersion: 1, pid: STAND_IN_PID }
              : undefined,
          async () => {
            const client = await settled(servingDaemon(root));
            const run = tracked(
              await runCli(["start", "--json"], {
                cwd: root,
                terminal: BOTH_TERMINALS,
                reply: `n${ENTER}`,
              }),
              pids,
            );
            return {
              actual: {
                exit: run.exit,
                asked: run.asked,
                reason: reasonOf(run),
              },
              expected: {
                exit: 1,
                asked: false,
                reason:
                  client !== undefined && "thrown" in client
                    ? `not started: ${client.thrown}`
                    : "the client confirmed the stand-in",
              },
            };
          },
        ),
      );
      expect(outcome.actual).toStrictEqual(outcome.expected);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1733: a daemon that cannot start is one --json document with ok false, the not started: reason and the plan it would have started",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const blocker = join(root, "state-file");
        writeFileSync(blocker, "");
        const run = tracked(
          await runCli(["start", "--trust", "--json", "--state-dir", blocker], {
            cwd: root,
          }),
          pids,
        );
        const document = documentOf(run);
        return {
          actual: {
            exit: run.exit,
            ok: document["ok"],
            notStarted: reasonOf(run).startsWith("not started: "),
            consumerRoot: document["consumerRoot"],
            stateDirectory: document["stateDirectory"],
            workspaces: document["workspaces"],
          },
          expected: {
            exit: 1,
            ok: false,
            notStarted: true,
            consumerRoot: root,
            stateDirectory: blocker,
            workspaces: LISTED_WORKSPACES,
          },
        };
      });
      expect(outcome.actual).toStrictEqual(outcome.expected);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1744: a declined start executes no project code in any process",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        writeFileSync(
          join(root, WORKSPACE_A, "vitest.config.mjs"),
          MARKING_CONFIG,
        );
        const run = tracked(
          await runCli(["start", "--json"], {
            cwd: root,
            terminal: BOTH_TERMINALS,
            reply: `n${ENTER}`,
          }),
          pids,
        );
        return {
          exit: run.exit,
          serving: await settled(servingDaemon(root)),
          loaded: existsSync(join(root, WORKSPACE_A, "loaded")),
        };
      });
      expect(outcome).toStrictEqual({
        exit: 1,
        serving: undefined,
        loaded: false,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1768: the daemon runs every listed workspace, not only some of them",
    async () => {
      const runs = await withDaemonConsumer(async (root, pids) => {
        const run = tracked(
          await runCli(["start", "--trust", "--json"], { cwd: root }),
          pids,
        );
        const logFile = String(daemonOf(run)["logFile"]);
        const idle = await eventually(() => logged(logFile, IDLE_ENTRY));
        if (!idle) return "never idle";
        return storedRuns(join(root, ".rt-test"), root).sort();
      });
      expect(runs).toStrictEqual([
        [WORKSPACE_A, "completed"],
        [WORKSPACE_B, "completed"],
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1769: without --json, a trusted start reports on stdout the daemon's process and the root",
    async () => {
      const outcome = await withDaemonConsumer(async (root) => {
        const run = await runCli(["start", "--trust"], { cwd: root });
        const status = await settled(daemonStatus(root));
        if ("thrown" in status) return { exit: run.exit, status };
        return {
          exit: run.exit,
          namesProcess: new RegExp(`\\b${status.pid}\\b`).test(run.stdout),
          namesRoot: run.stdout.includes(root),
        };
      });
      expect(outcome).toStrictEqual({
        exit: 0,
        namesProcess: true,
        namesRoot: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("a start with nothing to start", () => {
  it(
    "D1734: with no Vitest workspace under the root, it asks nothing and exits 1 naming the root and each source it could not read",
    async () => {
      const outcome = await inTempDir(async (root) => {
        writeFileSync(join(root, "package.json"), '{"workspaces":5}');
        const run = await runCli(["start", "--json"], {
          cwd: root,
          terminal: BOTH_TERMINALS,
          reply: `n${ENTER}`,
        });
        const reason = reasonOf(run);
        return {
          exit: run.exit,
          asked: run.asked,
          namesRoot: reason.includes(root),
          namesSource: reason.includes("package.json workspaces"),
        };
      });
      expect(outcome).toStrictEqual({
        exit: 1,
        asked: false,
        namesRoot: true,
        namesSource: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("a stop", () => {
  it(
    "D1735: exits 0 only once the daemon has exited, naming the root and the process that stopped",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const serving = await started(root, pids);
        if ("thrown" in serving) return { actual: serving, expected: {} };
        const run = await runCli(["stop", "--json"], { cwd: root });
        const document = documentOf(run);
        return {
          actual: {
            exit: run.exit,
            consumerRoot: document["consumerRoot"],
            pid: document["pid"],
            running: isRunning(serving.pid),
          },
          expected: {
            exit: 0,
            consumerRoot: root,
            pid: serving.pid,
            running: false,
          },
        };
      });
      expect(outcome.actual).toStrictEqual(outcome.expected);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1743: without --json, a stop reports its success on stdout, naming the root and the process, and writes nothing to stderr",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const serving = await started(root, pids);
        if ("thrown" in serving) return serving;
        const run = await runCli(["stop"], { cwd: root });
        return {
          exit: run.exit,
          namesProcess: run.stdout.includes(String(serving.pid)),
          namesRoot: run.stdout.includes(root),
          stderr: run.stderr,
        };
      });
      expect(outcome).toStrictEqual({
        exit: 0,
        namesProcess: true,
        namesRoot: true,
        stderr: "",
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1736: with no daemon serving the worktree, it exits 1 with a reason naming the root on stderr and nothing on stdout",
    async () => {
      const outcome = await inTempDir(async (root) => {
        const run = await runCli(["stop"], { cwd: root });
        return {
          exit: run.exit,
          stdout: run.stdout,
          namesRoot: run.stderr.includes(root),
        };
      });
      expect(outcome).toStrictEqual({ exit: 1, stdout: "", namesRoot: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1770: a relative root resolves against the command's directory and stops that worktree's daemon",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const serving = await started(root, pids);
        if ("thrown" in serving) return { actual: serving, expected: {} };
        const run = await runCli(["stop", basename(root), "--json"], {
          cwd: dirname(root),
        });
        return {
          actual: { exit: run.exit, pid: documentOf(run)["pid"] },
          expected: { exit: 0, pid: serving.pid },
        };
      });
      expect(outcome.actual).toStrictEqual(outcome.expected);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1742: a failure under --json is one document carrying schemaVersion 1, the command and the reason",
    async () => {
      const outcome = await inTempDir(async (root) => {
        const run = await runCli(["stop", "--json"], { cwd: root });
        return { document: documentOf(run), root };
      });
      expect(outcome.document).toStrictEqual({
        schemaVersion: 1,
        command: "stop",
        ok: false,
        reason: expect.stringContaining(outcome.root),
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

/** A test that fails, planted in the daemon fixture's workspace B beside its passing one. */
const PLANTED_FAILURE = [
  'it("planted", () => {',
  '  throw new Error("a planted failure");',
  "});",
  "",
].join("\n");
/** Any word that reads as a verdict of passing or failing. */
const VERDICT =
  /\b(?:pass|passes|passed|passing|fail|fails|failed|failing|success|successful|succeeded)\b/i;
/** The one kind of line that may name an outcome: a set's counts per state. */
const STATES_LINE = /^\s*States: /;

function plantFailure(root: string): void {
  writeFileSync(join(root, WORKSPACE_B, "planted.test.mjs"), PLANTED_FAILURE);
}

/**
 * A path or file name, which is the consumer's text, such as the fixture's `passes.test.mjs`: a token holding a path
 * separator, or a dot followed by a letter. A word ending a sentence, as in `passed.`, is not one.
 */
const PATH_TOKEN = /\S*[/\\]\S*|\S+\.[A-Za-z]\S*/g;

/** Each line of the output that speaks of passing or failing other than as a count of tests in a state. */
function verdictLines(output: string): string[] {
  return output
    .split("\n")
    .filter(
      (line) =>
        VERDICT.test(line.replace(PATH_TOKEN, "")) && !STATES_LINE.test(line),
    );
}

/** Starts a daemon for `root` as `start` confirms, and resolves once it has stored its discovery and every confirmed run. */
async function idleDaemon(
  root: string,
  pids: Set<number>,
  start = confirmEvery(root),
): Promise<Settled<DaemonIdentity>> {
  const identity = await started(root, pids, start);
  if ("thrown" in identity) return identity;
  const idle = await eventually(() => logged(identity.logFile, IDLE_ENTRY));
  return idle ? identity : { thrown: "the daemon never reached idle" };
}

function countsOf(run: CliRun): Document {
  const counts = documentOf(run)["counts"];
  return typeof counts === "object" && counts !== null
    ? (counts as Document)
    : {};
}

function nonZeroStates(run: CliRun): Document {
  const states = countsOf(run)["states"] as Document | undefined;
  return Object.fromEntries(
    Object.entries(states ?? {}).filter(([, count]) => count !== 0),
  );
}

function notDiscoveredKinds(run: CliRun): unknown[] {
  const entries = documentOf(run)["notDiscovered"];
  return Array.isArray(entries)
    ? entries.map((entry: Document) => entry["kind"])
    : [];
}

describe("a query", () => {
  it(
    "D1848: with no daemon serving the root, a summary exits 1 with one failure document whose reason names the root and says to run rt-test start",
    async () => {
      const outcome = await inTempDir(async (root) => {
        const run = await runCli(["summary", "--json"], { cwd: root });
        const document = documentOf(run);
        const reason = String(document["reason"]);
        return {
          exit: run.exit,
          schemaVersion: document["schemaVersion"],
          command: document["command"],
          ok: document["ok"],
          namesRoot: reason.includes(root),
          saysStart: reason.includes("rt-test start"),
          reasonOnStderr: run.stderr.includes(reason),
          servingAfter: await settled(servingDaemon(root)),
        };
      });
      expect(outcome).toStrictEqual({
        exit: 1,
        schemaVersion: 1,
        command: "summary",
        ok: false,
        namesRoot: true,
        saysStart: true,
        reasonOnStderr: true,
        servingAfter: undefined,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1849: a summary whose worktree holds a failed test exits 0, since it answered, with the failure counted",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        plantFailure(root);
        const identity = await idleDaemon(root, pids);
        if ("thrown" in identity) return identity;
        const run = await runCli(["summary", "--json"], { cwd: root });
        return {
          exit: run.exit,
          ok: documentOf(run)["ok"],
          states: nonZeroStates(run),
        };
      });
      expect(outcome).toStrictEqual({
        exit: 0,
        ok: true,
        states: { passed: 2, failed: 1 },
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1850: a summary's human text describes the worktree by its counts, with no line of passing or failing for it",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        plantFailure(root);
        const identity = await idleDaemon(root, pids);
        if ("thrown" in identity) return identity;
        const run = await runCli(["summary"], { cwd: root });
        return {
          exit: run.exit,
          counted: run.stdout.includes("States: passed 2, failed 1"),
          verdicts: verdictLines(run.stdout),
        };
      });
      expect(outcome).toStrictEqual({ exit: 0, counted: true, verdicts: [] });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1851: a folder status's human text describes the folder and each file by counts, with no line of passing or failing for any",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        plantFailure(root);
        const identity = await idleDaemon(root, pids);
        if ("thrown" in identity) return identity;
        const run = await runCli(["status", WORKSPACE_B], { cwd: root });
        return {
          exit: run.exit,
          counted: run.stdout.includes("States: passed 1, failed 1"),
          verdicts: verdictLines(run.stdout),
        };
      });
      expect(outcome).toStrictEqual({ exit: 0, counted: true, verdicts: [] });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1852: a relative status path resolves against the command's directory, answering for that folder of the root",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await idleDaemon(root, pids, {
          consumerRoot: root,
          workspaces: [],
        });
        if ("thrown" in identity) return identity;
        const run = await runCli(["status", WORKSPACE_B, "--json"], {
          cwd: root,
        });
        const document = documentOf(run);
        return {
          exit: run.exit,
          path: document["path"],
          pathKind: document["pathKind"],
        };
      });
      expect(outcome).toStrictEqual({
        exit: 0,
        path: WORKSPACE_B,
        pathKind: "folder",
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1853: a summary listing no test but a workspace not confirmed at start exits 0 with that entry",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await idleDaemon(root, pids, {
          consumerRoot: root,
          workspaces: [],
        });
        if ("thrown" in identity) return identity;
        const run = await runCli(["summary", "--json"], { cwd: root });
        return {
          exit: run.exit,
          tests: countsOf(run)["tests"],
          kinds: notDiscoveredKinds(run),
        };
      });
      expect(outcome).toStrictEqual({
        exit: 0,
        tests: 0,
        kinds: ["workspace-not-confirmed", "workspace-not-confirmed"],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1854: a summary before the daemon has stored a discovery exits 1 with a reason naming the daemon's activity",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        holdAt(root, "hold-collect");
        try {
          const identity = await started(root, pids, confirmEvery(root));
          if ("thrown" in identity) return identity;
          await atHoldPoint(root, "collecting");
          const run = await runCli(["summary", "--json"], { cwd: root });
          return {
            exit: run.exit,
            ok: documentOf(run)["ok"],
            namesActivity: reasonOf(run).includes("discovering"),
          };
        } finally {
          holdAt(root, "release-collect");
        }
      });
      expect(outcome).toStrictEqual({
        exit: 1,
        ok: false,
        namesActivity: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1855: a missing status path, an extra argument, a missing --root value and an unknown option each exit 2 with the usage on stderr and nothing on stdout",
    async () => {
      const cases = [
        ["status"],
        ["status", "a", "b"],
        ["status", "a", "--root"],
        ["status", "a", "--bogus"],
        ["summary", "a", "b"],
        ["summary", "--bogus"],
      ];
      const outcomes = await usageOutcomes(cases, ([command]) => [
        `rt-test ${command}`,
      ]);
      expect(outcomes).toStrictEqual(cases.map(() => USAGE_ERROR));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1867: a status path resolves against the command's directory, not against --root",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await idleDaemon(root, pids, confirmNothing(root));
        if ("thrown" in identity) return identity;
        const run = await runCli(["status", "b", "--root", "..", "--json"], {
          cwd: join(root, "packages"),
        });
        return { exit: run.exit, path: documentOf(run)["path"] };
      });
      expect(outcome).toStrictEqual({ exit: 0, path: WORKSPACE_B });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1868: a status with --root asks the daemon of that root, resolved against the command's directory",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await idleDaemon(root, pids, confirmNothing(root));
        if ("thrown" in identity) return identity;
        const name = basename(root);
        const run = await runCli(
          ["status", join(name, WORKSPACE_B), "--root", name, "--json"],
          { cwd: dirname(root) },
        );
        return { exit: run.exit, path: documentOf(run)["path"] };
      });
      expect(outcome).toStrictEqual({ exit: 0, path: WORKSPACE_B });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1869: a summary's relative root resolves against the command's directory and asks that worktree's daemon",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await idleDaemon(root, pids, confirmNothing(root));
        if ("thrown" in identity) return { actual: identity, expected: {} };
        const run = await runCli(["summary", basename(root), "--json"], {
          cwd: dirname(root),
        });
        return {
          actual: {
            exit: run.exit,
            consumerRoot: documentOf(run)["consumerRoot"],
          },
          expected: { exit: 0, consumerRoot: root },
        };
      });
      expect(outcome.actual).toStrictEqual(outcome.expected);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it("D1873: a human not-discovered line for a module that failed to load gives its error count", () => {
    const entry: NotDiscoveredEntry = {
      kind: "failed-module",
      workspacePath: WORKSPACE_A,
      projectName: "unit",
      modulePath: "src/broken.test.ts",
      errorCount: 2,
      reason: "SyntaxError: one\nError: two",
      omittedCharacters: 0,
    };
    expect(notDiscoveredLines([entry])[1]).toContain("2 errors");
  });

  it(
    "D1874: a human summary of a workspace whose latest run could not load it reads no verdict on that workspace",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        writeFileSync(
          join(root, WORKSPACE_B, "vitest.config.mjs"),
          'throw new Error("a planted config error");\n',
        );
        const identity = await idleDaemon(root, pids);
        if ("thrown" in identity) return identity;
        const run = await runCli(["summary"], { cwd: root });
        const line = run.stdout
          .split("\n")
          .find((text) => text.startsWith(`  ${WORKSPACE_B}:`));
        return {
          exit: run.exit,
          workspaceLine: line !== undefined,
          verdict: VERDICT.test((line ?? "").replace(PATH_TOKEN, "")),
        };
      });
      expect(outcome).toStrictEqual({
        exit: 0,
        workspaceLine: true,
        verdict: false,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1876: a failed status document names the path it was asked for requestedPath, never the success's path key",
    async () => {
      const outcome = await inTempDir(async (root) => {
        const run = await runCli(["status", "x", "--json"], { cwd: root });
        const document = documentOf(run);
        return {
          actual: {
            exit: run.exit,
            requestedPath: document["requestedPath"],
            hasPath: "path" in document,
          },
          expected: { exit: 1, requestedPath: join(root, "x"), hasPath: false },
        };
      });
      expect(outcome.actual).toStrictEqual(outcome.expected);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("a usage error", () => {
  it(
    "D1737: an unknown option, a missing option value, and --trust or --state-dir given to stop each exit 2 with the usage on stderr and nothing on stdout",
    async () => {
      const cases = [
        ["start", "--bogus"],
        ["start", "--state-dir"],
        ["start", "--trust=yes"],
        ["stop", "--trust"],
        ["stop", "--state-dir", "x"],
      ];
      const outcomes = await usageOutcomes(cases, ([command]) => [
        `rt-test ${command}`,
      ]);
      expect(outcomes).toStrictEqual(cases.map(() => USAGE_ERROR));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1738: an extra argument exits 2 with the usage on stderr and nothing on stdout",
    async () => {
      const cases = [
        ["start", "a", "b"],
        ["stop", "a", "b"],
      ];
      const outcomes = await usageOutcomes(cases, ([command]) => [
        `rt-test ${command}`,
      ]);
      expect(outcomes).toStrictEqual(cases.map(() => USAGE_ERROR));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1739: an empty root or --state-dir exits 2 rather than resolving to the current directory",
    async () => {
      const cases = [
        ["start", "--state-dir="],
        ["start", ""],
        ["stop", ""],
      ];
      const outcomes = await usageOutcomes(cases, ([command]) => [
        `rt-test ${command}`,
      ]);
      expect(outcomes).toStrictEqual(cases.map(() => USAGE_ERROR));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1741: a missing or unknown command exits 2 with every command's usage on stderr and nothing on stdout",
    async () => {
      const cases = [[], ["bogus"]];
      const outcomes = await usageOutcomes(cases, () => [
        "rt-test start",
        "rt-test stop",
        "rt-test summary",
        "rt-test status",
      ]);
      expect(outcomes).toStrictEqual(cases.map(() => USAGE_ERROR));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("the CLI's own process", () => {
  it(
    "D1740: a refused start loads no Vitest module, no node:sqlite and no consumer file in the CLI process",
    async () => {
      const outcome = await withDaemonConsumer(async (root) => {
        const listed = spawnSync(
          process.execPath,
          [
            ...SOURCE_FLAGS,
            "--import",
            pathToFileURL(LIST_MODULES).href,
            BIN,
            "start",
          ],
          {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: DAEMON_WAIT_MS,
            windowsHide: true,
          },
        );
        const modules = JSON.parse(listed.stdout || "[]") as string[];
        const consumer = pathToFileURL(root).href;
        return {
          status: listed.status,
          binLoaded: modules.includes(pathToFileURL(BIN).href),
          forbidden: modules.filter(
            (url) =>
              url === "node:sqlite" ||
              VITEST_PACKAGE_URL.test(url) ||
              url.startsWith(consumer),
          ),
        };
      });
      expect(outcome).toStrictEqual({
        status: 1,
        binLoaded: true,
        forbidden: [],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

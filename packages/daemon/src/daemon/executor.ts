import { fork, type ChildProcess } from "node:child_process";
import type {
  DependencyInformation,
  SelectableWorkspace,
} from "../selection/selection-types.js";
import {
  executorEnvironment,
  type StartEnvironment,
} from "../inputs/environment-digest.js";
import type { ConfirmedStart } from "../vitest/confirmed-start.js";
import { errorText, exitText } from "../vitest/error-text.js";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import type { VitestWorkspace } from "../vitest/find-workspaces.js";
import type { NotConfirmedRun, WorkspaceRun } from "../vitest/run-workspace.js";
import { hasExited } from "./child-exit.js";
import type { DaemonLog } from "./daemon-log.js";
import { daemonEntryPoint } from "./entry-point.js";
import {
  EXECUTOR_BOUND_MS,
  isExecutorReply,
  type ExecutorJob,
  type ExecutorReply,
  type ExecutorRequest,
} from "./executor-jobs.js";
import {
  createParseRecord,
  parsingLabel,
  removeParseRecord,
} from "./parse-record.js";
import {
  endProcessTree,
  ownsProcessGroup,
  treeContainment,
  type ContainedTree,
  type TreeContainment,
} from "./process-tree.js";

const EXECUTOR_ENTRY = "executor-main";
/** Overrides a strict mode `NODE_OPTIONS` may set, in which Node ends the process before the executor's guard sees a rejection. */
const UNHANDLED_REJECTIONS_THROW = "--unhandled-rejections=throw";
const ABORTED_BEFORE_SEND_REASON =
  "the stop arrived before the job was sent to its executor process, so the job was not run";
const INTERRUPTED_BEFORE_SEND_REASON =
  "the run was interrupted by a change before the job was sent to its executor process, so the job was not run";

/** What an abort is for, which names why a job aborted before it was sent ended with nothing. */
export const ABORT_PURPOSE = {
  stop: "stop",
  interruption: "interruption",
} as const;

type AbortPurpose = (typeof ABORT_PURPOSE)[keyof typeof ABORT_PURPOSE];

const UNSENT_REASONS: Readonly<Record<AbortPurpose, string>> = {
  [ABORT_PURPOSE.stop]: ABORTED_BEFORE_SEND_REASON,
  [ABORT_PURPOSE.interruption]: INTERRUPTED_BEFORE_SEND_REASON,
};
const NOT_STARTED_REASON =
  "the executor process could not be started, so the job was not run";
const NO_PARSE_RECORD_REASON =
  "the dependency build's parse record could not be created in the state directory, so the build was not run";
const BUILD_STOPPED_REASON =
  "the dependency build was stopped, so its executor process was ended before the build finished";
const WHILE_PARSING = "while parsing";
const PARSED_FILE_NOT_KNOWN =
  "and the file it was parsing, if any, is not known";
const RECORD_NOT_REMOVED_REASON =
  "the dependency build's parse record could not be removed";
const NOT_A_REPLY_REASON =
  "the executor process sent a message that is no job reply, as the project's own code may, so the message was ignored";

/** A job either ended and produced its record, or ended with nothing to store and the reason. */
export type JobOutcome<T> =
  | { readonly ended: true; readonly value: T }
  | { readonly ended: false; readonly reason: string };

/**
 * The executor's reply, or the reason the job ended without one: its process exited with no stop asked of it, or the
 * job was lost another way.
 */
type JobReply =
  | ExecutorReply
  | { readonly type: "exited"; readonly reason: string }
  | { readonly type: "lost"; readonly reason: string };

type Settle = (reply: JobReply) => void;

/**
 * Runs each job, a Vitest discovery or run or a dependency build, in a child process of its own, so Vitest's signal
 * handlers, env writes and stuck code and a parser's native crash stay out of the daemon, and nothing a job started
 * outlives it.
 */
export class Executor {
  readonly #log: DaemonLog;
  #child: ChildProcess | undefined;
  #settle: Settle | undefined;
  #boundTimer: NodeJS.Timeout | undefined;
  #boundPassed = false;
  /** The parse record of the dependency build in progress; a build is busy in synchronous code, so it cannot read an abort. */
  #buildRecord: string | undefined;
  #buildStopped = false;
  /** What an abort that arrived while the job's executor was being contained, before the job was sent to it, was for. */
  #abortBeforeSend: AbortPurpose | undefined;
  /** Whether the daemon asked the job in progress to stop, by an abort or a close, so its executor's exit is no crash. */
  #stopAsked = false;
  readonly #containment: TreeContainment = treeContainment();
  readonly #startEnvironment: StartEnvironment;

  constructor(log: DaemonLog, startEnvironment: StartEnvironment) {
    this.#log = log;
    this.#startEnvironment = startEnvironment;
  }

  async discover(start: ConfirmedStart): Promise<JobOutcome<TestDiscovery>> {
    const reply = await this.#job({ type: "discover", start });
    return reply.type === "discovered"
      ? { ended: true, value: reply.discovery }
      : { ended: false, reason: failureReason(reply) };
  }

  async run(
    workspace: VitestWorkspace,
    configFile: string,
  ): Promise<JobOutcome<WorkspaceRun | NotConfirmedRun>> {
    const reply = await this.#job({ type: "run", workspace, configFile });
    if (reply.type === "ran") return { ended: true, value: reply.run };
    if (reply.type === "exited") {
      return {
        ended: true,
        value: { status: "crashed", workspace, error: reply.reason },
      };
    }
    return { ended: false, reason: failureReason(reply) };
  }

  /**
   * Builds the dependency information over `consumerRoot` as discovery was given it. `stateDirectory` holds the
   * build's parse record, which names the file a parser crash ended the build in and is removed once the build ends.
   */
  async buildDependencies(
    consumerRoot: string,
    workspaces: readonly SelectableWorkspace[],
    stateDirectory: string,
  ): Promise<JobOutcome<DependencyInformation>> {
    let parseRecord: string;
    try {
      parseRecord = createParseRecord(stateDirectory);
    } catch (error) {
      const reason = `${NO_PARSE_RECORD_REASON}: ${errorText(error)}`;
      this.#log.entry(reason);
      return { ended: false, reason };
    }
    try {
      const reply = await this.#job({
        type: "build-dependencies",
        consumerRoot,
        workspaces,
        parseRecord,
      });
      return reply.type === "dependencies-built"
        ? { ended: true, value: reply.dependencies }
        : { ended: false, reason: failureReason(reply) };
    } finally {
      this.#removeRecord(parseRecord);
    }
  }

  /**
   * Aborts the job in progress, and ends the executor's process tree when the job has not ended within the bound.
   * A dependency build's tree is ended at once. A stop outranks an interruption asked of the same job. Returns
   * whether a job was in progress, which a job whose reply has settled no longer is.
   */
  abort(purpose: AbortPurpose = ABORT_PURPOSE.stop): boolean {
    const child = this.#child;
    if (child === undefined) return false;
    if (this.#settle === undefined) {
      if (this.#abortBeforeSend !== ABORT_PURPOSE.stop) {
        this.#abortBeforeSend = purpose;
      }
      return true;
    }
    this.#stopAsked = true;
    if (this.#buildRecord !== undefined) {
      this.#buildStopped = true;
      endProcessTree(child);
      return true;
    }
    if (child.connected)
      child.send({ type: "abort" } satisfies ExecutorRequest);
    this.#boundTimer ??= setTimeout(() => {
      this.#boundPassed = true;
      endProcessTree(child);
    }, EXECUTOR_BOUND_MS);
    return true;
  }

  /**
   * Resolves once no executor process remains. Each job's process tree ends with the job, so only a job still in
   * progress holds one: closing its channel aborts it, and its tree is ended when the bound passes. A dependency
   * build's tree is ended at once, as a stop.
   */
  async close(): Promise<void> {
    if (this.#settle !== undefined) this.#stopAsked = true;
    if (this.#buildRecord !== undefined) this.abort();
    await this.#childEnded();
    await this.#containment.close();
  }

  #childEnded(): Promise<void> {
    const child = this.#child;
    if (child === undefined || hasExited(child)) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => endProcessTree(child), EXECUTOR_BOUND_MS);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      if (child.connected) child.disconnect();
    });
  }

  /**
   * Runs one job in a process of its own, held with every process it starts before the job is sent, and settles once
   * that whole tree has ended.
   */
  async #job(request: ExecutorJob): Promise<JobReply> {
    this.#abortBeforeSend = undefined;
    const child = this.#startChild();
    const exited = new Promise<void>((ended) => {
      if (neverStarted(child) || hasExited(child)) ended();
      else child.once("exit", () => ended());
    });
    if (neverStarted(child)) {
      return this.#unsent(child, exited, NOT_STARTED_REASON);
    }
    let tree: ContainedTree;
    try {
      tree = await this.#containment.contain(child);
    } catch (error) {
      return this.#unsent(
        child,
        exited,
        `the executor process ${child.pid} could not be held with the processes it starts, so the job was not run: ${errorText(error)}`,
      );
    }
    if (this.#child !== child) {
      await tree.end();
      return this.#unsent(
        child,
        exited,
        `the executor process ${child.pid} ended before its job was sent, so the job was not run`,
      );
    }
    if (this.#abortBeforeSend !== undefined) {
      await tree.end();
      return this.#unsent(child, exited, UNSENT_REASONS[this.#abortBeforeSend]);
    }
    return new Promise((resolve) => {
      this.#buildRecord =
        request.type === "build-dependencies" ? request.parseRecord : undefined;
      this.#settle = (reply) => {
        this.#settle = undefined;
        clearTimeout(this.#boundTimer);
        this.#boundTimer = undefined;
        this.#boundPassed = false;
        this.#buildRecord = undefined;
        this.#buildStopped = false;
        this.#stopAsked = false;
        if (this.#child === child) this.#child = undefined;
        void tree.end().then(() => exited.then(() => resolve(reply)));
      };
      child.send(request, (error) => {
        if (error !== null) {
          this.#lost(
            child,
            `the job could not be sent to the executor process ${child.pid}: ${errorText(error)}`,
          );
        }
      });
    });
  }

  /** Ends an executor that was never sent its job, and says why the job has nothing to store. */
  async #unsent(
    child: ChildProcess,
    exited: Promise<void>,
    reason: string,
  ): Promise<JobReply> {
    this.#log.entry(reason);
    if (this.#child === child) this.#child = undefined;
    endProcessTree(child);
    await exited;
    return { type: "lost", reason };
  }

  #startChild(): ChildProcess {
    const entry = daemonEntryPoint(EXECUTOR_ENTRY);
    const child = fork(entry.file, [], {
      execArgv: [...entry.execArgv, UNHANDLED_REJECTIONS_THROW],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: executorEnvironment(this.#startEnvironment),
      detached: ownsProcessGroup(),
      windowsHide: true,
    });
    child.on("message", (message: unknown) => {
      if (this.#child !== child) return;
      if (isExecutorReply(message)) {
        this.#settle?.(message);
        return;
      }
      this.#log.entry(`${NOT_A_REPLY_REASON} (process ${child.pid})`);
    });
    child.once("exit", (code, signal) => this.#exited(child, code, signal));
    child.on("error", (error) => {
      this.#lost(
        child,
        `the executor process ${child.pid} failed: ${errorText(error)}`,
      );
    });
    this.#child = child;
    return child;
  }

  /**
   * Ends an executor process that can no longer take jobs, and fails the job it held. A process already replaced
   * holds no job: the job in progress belongs to its successor.
   */
  #lost(child: ChildProcess, reason: string): void {
    this.#log.entry(reason);
    endProcessTree(child);
    if (this.#child !== child) return;
    this.#child = undefined;
    this.#settle?.({ type: "lost", reason });
  }

  #exited(
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.#child !== child) return;
    this.#child = undefined;
    const settle = this.#settle;
    if (settle === undefined) return;
    const reason = this.#exitReason(child, code, signal);
    this.#log.entry(reason);
    settle({ type: this.#stopAsked ? "lost" : "exited", reason });
  }

  #exitReason(
    child: ChildProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): string {
    if (this.#boundPassed) {
      return `the job had not ended ${EXECUTOR_BOUND_MS} ms after its abort, so the executor process ${child.pid} was ended`;
    }
    if (this.#buildStopped) {
      return `${BUILD_STOPPED_REASON} (process ${child.pid})`;
    }
    const exited = `the executor process ${child.pid} exited during the job (${exitText(code, signal)})`;
    if (this.#buildRecord === undefined) return exited;
    const label = parsingLabel(this.#buildRecord);
    return label === undefined
      ? `${exited}, ${PARSED_FILE_NOT_KNOWN}`
      : `${exited} ${WHILE_PARSING} ${label}`;
  }

  /** A record left behind names no later build's file, since every build's record has a name of its own. */
  #removeRecord(parseRecord: string): void {
    try {
      removeParseRecord(parseRecord);
    } catch (error) {
      this.#log.entry(
        `${RECORD_NOT_REMOVED_REASON} (${parseRecord}): ${errorText(error)}`,
      );
    }
  }
}

/** A child whose spawn failed has no process id and emits `error` but never `exit`. */
function neverStarted(child: ChildProcess): boolean {
  return child.pid === undefined;
}

function failureReason(reply: JobReply): string {
  switch (reply.type) {
    case "exited":
    case "lost":
      return reply.reason;
    case "job-failed":
      return `the job failed: ${reply.error}`;
    default:
      return `the executor answered the job with a ${reply.type} reply, which belongs to another kind of job`;
  }
}

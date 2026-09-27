import { fork, type ChildProcess } from "node:child_process";
import type { ConfirmedStart } from "../vitest/confirmed-start.js";
import { errorText } from "../vitest/error-text.js";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import type { VitestWorkspace } from "../vitest/find-workspaces.js";
import type { NotConfirmedRun, WorkspaceRun } from "../vitest/run-workspace.js";
import type { DaemonLog } from "./daemon-log.js";
import { daemonEntryPoint } from "./entry-point.js";
import {
  EXECUTOR_BOUND_MS,
  type ExecutorReply,
  type ExecutorRequest,
} from "./executor-jobs.js";

const EXECUTOR_ENTRY = "executor-main";
const KILL_SIGNAL = "SIGKILL";

/** A job either ended and produced its record, or ended with nothing to store and the reason. */
export type JobOutcome<T> =
  | { readonly ended: true; readonly value: T }
  | { readonly ended: false; readonly reason: string };

/** The executor's reply, or the reason the job ended without one. */
type JobReply =
  ExecutorReply | { readonly type: "lost"; readonly reason: string };

type Settle = (reply: JobReply) => void;

/** Hosts Vitest in a child process, one job at a time, so its signal handlers, env writes and stuck code stay out of the daemon. */
export class Executor {
  readonly #log: DaemonLog;
  #child: ChildProcess | undefined;
  #settle: Settle | undefined;
  #boundTimer: NodeJS.Timeout | undefined;
  #boundPassed = false;

  constructor(log: DaemonLog) {
    this.#log = log;
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
    return reply.type === "ran"
      ? { ended: true, value: reply.run }
      : { ended: false, reason: failureReason(reply) };
  }

  /** Aborts the job in progress, and ends the executor process when the job has not ended within the bound. */
  abort(): void {
    const child = this.#child;
    if (this.#settle === undefined || child === undefined) return;
    if (child.connected)
      child.send({ type: "abort" } satisfies ExecutorRequest);
    this.#boundTimer ??= setTimeout(() => {
      this.#boundPassed = true;
      child.kill(KILL_SIGNAL);
    }, EXECUTOR_BOUND_MS);
  }

  /** Closes the channel, which ends an idle executor process, and resolves once it has exited or been ended. */
  close(): Promise<void> {
    const child = this.#child;
    if (
      child === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => child.kill(KILL_SIGNAL),
        EXECUTOR_BOUND_MS,
      );
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      if (child.connected) child.disconnect();
    });
  }

  #job(
    request: Exclude<ExecutorRequest, { type: "abort" }>,
  ): Promise<JobReply> {
    return new Promise((resolve) => {
      const child = this.#ensureChild();
      this.#settle = (reply) => {
        this.#settle = undefined;
        clearTimeout(this.#boundTimer);
        this.#boundTimer = undefined;
        this.#boundPassed = false;
        resolve(reply);
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

  #ensureChild(): ChildProcess {
    if (this.#child !== undefined) return this.#child;
    const entry = daemonEntryPoint(EXECUTOR_ENTRY);
    const child = fork(entry.file, [], {
      execArgv: [...entry.execArgv],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      windowsHide: true,
    });
    child.on("message", (reply: ExecutorReply) => {
      if (this.#child === child) this.#settle?.(reply);
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
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(KILL_SIGNAL);
    }
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
    const reason = this.#boundPassed
      ? `the job had not ended ${EXECUTOR_BOUND_MS} ms after its abort, so the executor process ${child.pid} was ended`
      : `the executor process ${child.pid} exited during the job (${exitText(code, signal)})`;
    this.#log.entry(reason);
    settle({ type: "lost", reason });
  }
}

function failureReason(reply: JobReply): string {
  switch (reply.type) {
    case "lost":
      return reply.reason;
    case "job-failed":
      return `the job failed: ${reply.error}`;
    default:
      return `the executor answered the job with a ${reply.type} reply, which belongs to another kind of job`;
  }
}

function exitText(code: number | null, signal: NodeJS.Signals | null): string {
  return signal === null ? `exit code ${code}` : `signal ${signal}`;
}

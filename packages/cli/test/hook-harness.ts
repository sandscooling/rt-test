import { PassThrough } from "node:stream";
import { main } from "../src/main.js";
import type { ExitCode } from "../src/output.js";

export const HARNESS = "claude-code";
export const BATCH = "PostToolBatch";
export const STOP = "Stop";
export const PROMPT = "UserPromptSubmit";

export interface HookRun {
  readonly exit: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs `rt-test hook <args>` in process from `cwd`, as Claude Code runs it: `payload` as its whole stdin, or, when it
 * is undefined, a stdin that never ends.
 */
export async function runHook(
  args: readonly string[],
  cwd: string,
  payload: unknown,
): Promise<HookRun> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString("utf8");
  });
  stderr.on("data", (chunk: Buffer) => {
    err += chunk.toString("utf8");
  });
  if (payload !== undefined) stdin.end(JSON.stringify(payload));
  try {
    const exit = await main(["hook", ...args], {
      stdin,
      stdout,
      stderr,
      stdinIsTerminal: false,
      stderrIsTerminal: false,
      cwd,
    });
    await new Promise((resolve) => setImmediate(resolve));
    return { exit, stdout: out, stderr: err };
  } finally {
    stdin.destroy();
    stdout.end();
    stderr.end();
  }
}

/** The one JSON object a run printed, or its raw stdout when that is not one. */
export function printed(run: HookRun): unknown {
  try {
    return JSON.parse(run.stdout) as unknown;
  } catch {
    return run.stdout;
  }
}

/** What Claude Code adds to the agent's context on `event`. */
export function context(event: string, text: string): object {
  return {
    hookSpecificOutput: { hookEventName: event, additionalContext: text },
  };
}

/** A `PostToolBatch` payload's call of each tool, with the input Claude Code 2.1.285 gives it. */
export const TOOL_CALLS = {
  write: (path: string) => ({
    tool_name: "Write",
    tool_input: { file_path: path, content: "edited" },
  }),
  edit: (path: string) => ({
    tool_name: "Edit",
    tool_input: { file_path: path, old_string: "a", new_string: "b" },
  }),
  notebookEdit: (path: string) => ({
    tool_name: "NotebookEdit",
    tool_input: {
      notebook_path: path,
      cell_id: "cell-0",
      new_source: "x = 2",
      edit_mode: "replace",
    },
  }),
  bash: () => ({
    tool_name: "Bash",
    tool_input: { command: "echo hi", description: "Print hi" },
  }),
} as const;

export interface PayloadFields {
  readonly root: string;
  readonly sessionId: string;
  /** Absent for the main agent. */
  readonly agentId?: string;
  readonly toolCalls?: readonly unknown[];
}

/** The payload Claude Code sends the hook on `event`, as the spike on 2.1.285 recorded it. */
export function payloadOf(event: string, fields: PayloadFields): object {
  const { root, sessionId, agentId, toolCalls = [] } = fields;
  return {
    session_id: sessionId,
    transcript_path: `${root}/transcript.jsonl`,
    cwd: root,
    permission_mode: "bypassPermissions",
    hook_event_name: event,
    ...(agentId === undefined
      ? {}
      : { agent_id: agentId, agent_type: "general-purpose" }),
    ...(event === BATCH ? { tool_calls: toolCalls } : {}),
    ...(event === STOP ? { stop_hook_active: false } : {}),
    ...(event === PROMPT ? { prompt: "Carry on." } : {}),
  };
}

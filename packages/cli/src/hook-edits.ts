import { resolve } from "node:path";
import { resolveCallerPath } from "@rt-test/daemon/client";

/** The tools that edit one file by path, each with the input naming it. */
const FILE_PATH_INPUTS: ReadonlyMap<string, string> = new Map([
  ["Write", "file_path"],
  ["Edit", "file_path"],
  ["NotebookEdit", "notebook_path"],
]);
/** How Claude Code begins the result of a call that failed or that the user rejected, either of which saved nothing. */
const UNSAVED_RESULT_STARTS: readonly string[] = [
  "<tool_use_error>",
  "The user doesn't want to proceed with this tool use",
];

/** The files a batch's `Write`, `Edit` and `NotebookEdit` calls named that lie under the root, judged as the daemon judges them. */
export interface BatchEdits {
  /** Each file a call named. */
  readonly named: string[];
  /** Each file a call named whose result says no failure or rejection; a call with no result counts as saved. */
  readonly saved: string[];
}

export function batchEdits(
  toolCalls: readonly unknown[],
  cwd: string,
  root: string,
): BatchEdits {
  const named: string[] = [];
  const saved: string[] = [];
  for (const call of toolCalls) {
    const path = editedPath(call);
    if (path === undefined) continue;
    const file = resolve(cwd, path);
    if (!resolveCallerPath(file, root).ok) continue;
    named.push(file);
    if (!unsaved(call)) saved.push(file);
  }
  return { named, saved };
}

function editedPath(call: unknown): string | undefined {
  if (typeof call !== "object" || call === null) return undefined;
  const { tool_name: tool, tool_input: input } = call as Record<
    string,
    unknown
  >;
  const key = typeof tool === "string" ? FILE_PATH_INPUTS.get(tool) : undefined;
  if (key === undefined || typeof input !== "object" || input === null) {
    return undefined;
  }
  const path = Object.hasOwn(input, key)
    ? (input as Record<string, unknown>)[key]
    : undefined;
  return typeof path === "string" && path !== "" ? path : undefined;
}

/** Whether the call's result, its text or its first text block, is one Claude Code gives a call that saved nothing. */
function unsaved(call: unknown): boolean {
  const text = resultText((call as Record<string, unknown>)["tool_response"]);
  return (
    text !== undefined &&
    UNSAVED_RESULT_STARTS.some((start) => text.trimStart().startsWith(start))
  );
}

function resultText(response: unknown): string | undefined {
  if (typeof response === "string") return response;
  if (!Array.isArray(response)) return undefined;
  const [first] = response as unknown[];
  if (typeof first !== "object" || first === null) return undefined;
  const { text } = first as Record<string, unknown>;
  return typeof text === "string" ? text : undefined;
}

import { discoverTests } from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import { runWorkspace } from "../vitest/run-workspace.js";
import {
  EXECUTOR_BOUND_MS,
  type ExecutorReply,
  type ExecutorRequest,
} from "./executor-jobs.js";
import { endOwnTree } from "./process-tree.js";

const STOP_REASON = "the daemon is stopping";
const DISCONNECTED_REASON = "the executor lost its channel to the daemon";

let current: AbortController | undefined;
let disconnected = false;

process.on("message", (request: ExecutorRequest) => {
  if (request.type === "abort") {
    current?.abort(new Error(STOP_REASON));
    return;
  }
  void runJob(request);
});

process.on("disconnect", () => {
  disconnected = true;
  if (current === undefined) return endOwnTree();
  current.abort(new Error(DISCONNECTED_REASON));
  setTimeout(endOwnTree, EXECUTOR_BOUND_MS);
});

async function runJob(
  request: Exclude<ExecutorRequest, { type: "abort" }>,
): Promise<void> {
  const controller = new AbortController();
  current = controller;
  let reply: ExecutorReply;
  try {
    reply =
      request.type === "discover"
        ? {
            type: "discovered",
            discovery: await discoverTests(request.start, controller.signal),
          }
        : {
            type: "ran",
            run: await runWorkspace(
              request.workspace,
              request.configFile,
              controller.signal,
            ),
          };
  } catch (error) {
    reply = { type: "job-failed", error: errorText(error) };
  }
  current = undefined;
  if (disconnected) endOwnTree();
  process.send?.(reply);
}

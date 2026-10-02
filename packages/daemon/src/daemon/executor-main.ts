import type { FalsificationJob } from "../falsify/experiment-record.js";
import type { DependencyInformation } from "../selection/selection-types.js";
import { rediscoverTests } from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import { findPackageWorkspaces } from "../vitest/find-workspaces.js";
import { guardHostRejections } from "../vitest/host-rejections.js";
import { runWorkspaceListing } from "../vitest/run-workspace.js";
import {
  EXECUTOR_BOUND_MS,
  type ExecutorJob,
  type ExecutorReply,
  type ExecutorRequest,
} from "./executor-jobs.js";
import { openParseRecord } from "./parse-record.js";
import { endOwnTree } from "./process-tree.js";

const STOP_REASON = "the daemon is stopping";
const DISCONNECTED_REASON = "the executor lost its channel to the daemon";
const UNSENDABLE_REPLY_REASON =
  "the job's reply could not be sent to the daemon";

let current: AbortController | undefined;
let disconnected = false;

guardHostRejections();

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

async function runJob(request: ExecutorJob): Promise<void> {
  const controller = new AbortController();
  current = controller;
  let reply: ExecutorReply;
  try {
    reply = await answer(request, controller.signal);
  } catch (error) {
    reply = { type: "job-failed", error: errorText(error) };
  }
  current = undefined;
  if (disconnected) endOwnTree();
  sendReply(reply);
}

/** The channel carries JSON, so a reply holding a value JSON cannot carry fails the job instead of sending nothing. */
function sendReply(reply: ExecutorReply): void {
  try {
    process.send?.(reply);
  } catch (error) {
    process.send?.({
      type: "job-failed",
      error: `${UNSENDABLE_REPLY_REASON}: ${errorText(error)}`,
    } satisfies ExecutorReply);
  }
}

async function answer(
  request: ExecutorJob,
  signal: AbortSignal,
): Promise<ExecutorReply> {
  switch (request.type) {
    case "discover":
      return {
        type: "discovered",
        ...(await rediscoverTests(request.start, request.carried, signal)),
      };
    case "run":
      return {
        type: "ran",
        ...(await runWorkspaceListing(
          request.workspace,
          request.configFile,
          signal,
        )),
      };
    case "build-dependencies":
      return {
        type: "dependencies-built",
        dependencies: await buildDependencies(request),
      };
    case "falsify":
      return { type: "falsified", job: await falsify(request, signal) };
  }
}

/** Loaded here alone, as the dependency build loads it, so the parser's native binding stays out of every other job. */
async function falsify(
  request: Extract<ExecutorJob, { type: "falsify" }>,
  signal: AbortSignal,
): Promise<FalsificationJob> {
  const { falsifyWorkspace } = await import("../falsify/falsify-workspace.js");
  return falsifyWorkspace(
    request.workspace,
    request.configFile,
    request.experiments,
    request.assertionErrors,
    signal,
  );
}

/** Loaded here alone, so the parser's native binding stays out of every discovery and run process. */
async function buildDependencies(
  request: Extract<ExecutorJob, { type: "build-dependencies" }>,
): Promise<DependencyInformation> {
  const { buildDependencyInformation } =
    await import("../selection/workspace-graph.js");
  const record = openParseRecord(request.parseRecord);
  try {
    return buildDependencyInformation(
      findPackageWorkspaces(request.consumerRoot),
      request.workspaces,
      record,
    );
  } finally {
    record.close();
  }
}

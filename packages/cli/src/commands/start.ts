import { parseArgs } from "node:util";
import {
  alreadyServingReason,
  errorText,
  servingDaemon,
  startDaemon,
  startPlan,
  type DaemonIdentity,
  type StartPlan,
  type StatusResponse,
} from "@rt-test/daemon/client";
import {
  absolutePath,
  JSON_OPTION,
  nonEmptyPath,
  optionalRoot,
  type CliIo,
  type Command,
} from "../command.js";
import {
  NOT_STARTED,
  oneLine,
  reported,
  type ExitCode,
  type Fields,
  type Output,
} from "../output.js";
import { decideTrust, listing, unreadWarnings } from "../trust-prompt.js";

const NAME = "start";
const OPTIONS = {
  ...JSON_OPTION,
  "state-dir": { type: "string" },
  trust: { type: "boolean" },
} as const;

interface StartArguments {
  readonly root: string | undefined;
  readonly stateDirectory: string | undefined;
  readonly trust: boolean;
}

export const startCommand: Command = {
  name: NAME,
  usage: `rt-test ${NAME} [root] [--state-dir <path>] [--trust] [--json]`,
  parse(args) {
    const { values, positionals } = parseArgs({
      args,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    const start: StartArguments = {
      root: optionalRoot(positionals),
      stateDirectory: nonEmptyPath(values["state-dir"], "--state-dir"),
      trust: values.trust === true,
    };
    return (io) =>
      reported(io, NAME, values.json === true, (output) =>
        runStart(io, output, start),
      );
  },
};

async function runStart(
  io: CliIo,
  output: Output,
  start: StartArguments,
): Promise<ExitCode> {
  const root = absolutePath(io, start.root);
  const refusal = await runningDaemonRefusal(root);
  if (refusal !== undefined) return output.fail(refusal.reason, refusal.fields);
  const plan = startPlan(
    root,
    start.stateDirectory === undefined
      ? undefined
      : absolutePath(io, start.stateDirectory),
  );
  if (plan.start.workspaces.length === 0) {
    return output.fail(noWorkspaceReason(plan), planFields(plan));
  }
  for (const line of listing(plan)) output.note(line);
  const trust = await decideTrust(io, output, plan, start.trust);
  if (!trust.trusted) return output.fail(trust.reason, planFields(plan));
  let daemon: DaemonIdentity;
  try {
    daemon = await startDaemon({
      trusted: true,
      start: plan.start,
      stateDirectory: plan.stateDirectory,
    });
  } catch (error) {
    return output.fail(`${NOT_STARTED} ${errorText(error)}`, planFields(plan));
  }
  return output.succeed(
    { ...planFields(plan), daemon },
    startedText(daemon, plan),
  );
}

interface Refusal {
  readonly reason: string;
  readonly fields: Fields;
}

/** Asks nothing and never retries: whatever holds the endpoint is reported as the client names it. */
async function runningDaemonRefusal(
  root: string,
): Promise<Refusal | undefined> {
  let serving: StatusResponse | undefined;
  try {
    serving = await servingDaemon(root);
  } catch (error) {
    return {
      reason: `${NOT_STARTED} ${errorText(error)}`,
      fields: { consumerRoot: root },
    };
  }
  if (serving === undefined) return undefined;
  return {
    reason: `${NOT_STARTED} ${alreadyServingReason(serving.pid, oneLine(root))}`,
    fields: { consumerRoot: root, pid: serving.pid },
  };
}

function noWorkspaceReason(plan: StartPlan): string {
  const found = `${NOT_STARTED} no Vitest workspace was found under ${oneLine(plan.start.consumerRoot)}`;
  const unread = unreadWarnings(plan);
  return unread.length === 0
    ? found
    : [`${found}. Sources not read:`, ...unread].join("\n");
}

function planFields(plan: StartPlan): Fields {
  return {
    consumerRoot: plan.start.consumerRoot,
    stateDirectory: plan.stateDirectory,
    workspaces: plan.start.workspaces,
    notRead: plan.notRead,
    nonInputs: plan.nonInputs,
  };
}

function startedText(daemon: DaemonIdentity, plan: StartPlan): string {
  return [
    `Started the RT Test daemon, process ${daemon.pid}, for ${oneLine(daemon.consumerRoot)}.`,
    `Worktree identity: ${oneLine(daemon.worktreeIdentity)}`,
    `Project identity: ${oneLine(daemon.projectIdentity)}`,
    `State directory: ${oneLine(daemon.stateDirectory)}`,
    `Protocol version: ${daemon.protocolVersion}`,
    `Workspaces: ${plan.start.workspaces.map((workspace) => oneLine(workspace.path)).join(", ")}`,
  ].join("\n");
}

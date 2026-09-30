import { parseArgs } from "node:util";
import {
  errorText,
  querySummary,
  type LatestRunFacts,
  type SummaryResponse,
  type WorkspaceFacts,
} from "@rt-test/daemon/client";
import {
  answerFields,
  contextLines,
  countLines,
  cutReasonText,
  INDENT,
  joinLines,
  notDiscoveredLines,
} from "../answer-text.js";
import {
  absolutePath,
  JSON_OPTION,
  optionalRoot,
  type Command,
} from "../command.js";
import { oneLine, reported } from "../output.js";

const NAME = "summary";
const DETAIL_SEPARATOR = ", ";
const REASON_SEPARATOR = ": ";
const NO_RUN_PHRASE = "no run stored";
const RUN_REFUSED_PHRASE = "latest run refused as unreadable";
const RUN_STATUS_PHRASES: Record<LatestRunFacts["status"], string> = {
  ran: "latest run loaded the workspace",
  failed: "latest run could not load the workspace",
  unsupported: "latest run found no supported Vitest",
  "interrupted-before-load":
    "latest run was interrupted before loading the workspace",
  crashed: "latest run crashed",
};

export const summaryCommand: Command = {
  name: NAME,
  usage: `rt-test ${NAME} [root] [--json]`,
  parse(args) {
    const { values, positionals } = parseArgs({
      args,
      options: JSON_OPTION,
      strict: true,
      allowPositionals: true,
    });
    const rootArgument = optionalRoot(positionals);
    return (io) =>
      reported(io, NAME, values.json === true, async (output) => {
        const root = absolutePath(io, rootArgument);
        let answer: SummaryResponse;
        try {
          answer = await querySummary(root);
        } catch (error) {
          return output.fail(errorText(error), { consumerRoot: root });
        }
        return output.succeed(answerFields(answer), summaryText(answer));
      });
  },
};

function summaryText(answer: SummaryResponse): string {
  return joinLines([
    `RT Test summary for ${oneLine(answer.consumerRoot)}`,
    `Tests discovered: ${answer.counts.tests}, of which ${answer.duplicateTests} marked duplicate`,
    ...countLines(answer.counts),
    "Workspaces:",
    ...answer.workspaces.map(workspaceLine),
    ...notDiscoveredLines(answer.notDiscovered),
    ...contextLines(answer),
  ]);
}

function workspaceLine(workspace: WorkspaceFacts): string {
  return `${INDENT}${oneLine(workspace.workspacePath)}: ${workspaceFacts(workspace).join(DETAIL_SEPARATOR)}`;
}

function workspaceFacts(workspace: WorkspaceFacts): string[] {
  const run = workspace.latestRun;
  if (run !== null) return labelledRunFacts(run);
  const refusal = workspace.refusedRun;
  if (refusal === undefined) return [NO_RUN_PHRASE];
  return [`${RUN_REFUSED_PHRASE}${REASON_SEPARATOR}${cutReasonText(refusal)}`];
}

/** The run's status, then its invalidated label when it has one, then the rest of its facts. */
function labelledRunFacts(run: LatestRunFacts): string[] {
  const [status = "", ...rest] = runFacts(run);
  const label =
    run.invalidated === undefined
      ? []
      : [`invalidated${REASON_SEPARATOR}${cutReasonText(run.invalidated)}`];
  return [status, ...label, ...rest];
}

function runFacts(run: LatestRunFacts): string[] {
  const version = `adapter version ${run.adapterVersion}${run.adapterVersionCurrent ? "" : " (not current)"}`;
  if (run.status === "crashed") {
    return [
      `${RUN_STATUS_PHRASES[run.status]}${REASON_SEPARATOR}${cutReasonText(run)}`,
      version,
    ];
  }
  if (!("execution" in run)) return [RUN_STATUS_PHRASES[run.status], version];
  return [
    `${RUN_STATUS_PHRASES[run.status]}${DETAIL_SEPARATOR}${run.execution}`,
    version,
    ...(run.forceStopped ? ["Vitest force-stopped"] : []),
    ...(run.nothingRan === null ? [] : [`nothing ran: ${run.nothingRan}`]),
    `${run.unhandledErrors} unhandled errors`,
    `${run.moduleErrors} module errors`,
  ];
}

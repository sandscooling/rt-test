import { parseArgs } from "node:util";
import {
  errorText,
  queryPathStatus,
  type FileCounts,
  type PathStatusResponse,
} from "@rt-test/daemon/client";
import {
  answerFields,
  contextLines,
  countLines,
  INDENT,
  joinLines,
  notDiscoveredLines,
} from "../answer-text.js";
import {
  absolutePath,
  JSON_OPTION,
  nonEmptyPath,
  UsageError,
  type Command,
} from "../command.js";
import { oneLine, reported } from "../output.js";

const NAME = "status";
const OPTIONS = {
  ...JSON_OPTION,
  root: { type: "string" },
} as const;
const PATH_POSITIONALS = 1;
const ENCLOSING_HEADING = "Not discovered above this path:";

export const statusCommand: Command = {
  name: NAME,
  usage: `rt-test ${NAME} <path> [--root <dir>] [--json]`,
  parse(args) {
    const { values, positionals } = parseArgs({
      args,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    const pathArgument = requiredPath(positionals);
    const rootArgument = nonEmptyPath(values.root, "--root");
    return (io) =>
      reported(io, NAME, values.json === true, async (output) => {
        const root = absolutePath(io, rootArgument);
        const path = absolutePath(io, pathArgument);
        let answer: PathStatusResponse;
        try {
          answer = await queryPathStatus(root, path);
        } catch (error) {
          return output.fail(errorText(error), {
            consumerRoot: root,
            requestedPath: path,
          });
        }
        return output.succeed(answerFields(answer), statusText(answer));
      });
  },
};

function requiredPath(positionals: string[]): string {
  const [path] = positionals;
  if (path === undefined) throw new UsageError("Missing path.");
  if (positionals.length > PATH_POSITIONALS) {
    throw new UsageError(
      `Unexpected argument: ${positionals.slice(PATH_POSITIONALS).join(" ")}`,
    );
  }
  nonEmptyPath(path, "path");
  return path;
}

function statusText(answer: PathStatusResponse): string {
  return joinLines([
    `RT Test status for the ${answer.pathKind} ${oneLine(answer.path)} in ${oneLine(answer.consumerRoot)}`,
    `Tests: ${answer.counts.tests}`,
    ...countLines(answer.counts),
    ...(answer.files.length === 0
      ? []
      : ["Files:", ...answer.files.flatMap(fileLines)]),
    ...notDiscoveredLines(answer.notDiscovered),
    ...notDiscoveredLines(answer.enclosingNotDiscovered, ENCLOSING_HEADING),
    ...contextLines(answer),
  ]);
}

function fileLines(file: FileCounts): string[] {
  return [
    `${INDENT}${oneLine(file.file)}: ${file.counts.tests} tests`,
    ...countLines(file.counts).map((line) => `${INDENT}${INDENT}${line}`),
  ];
}

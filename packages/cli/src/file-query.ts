import {
  errorText,
  type ChangesResponse,
  type WaitResponse,
} from "@rt-test/daemon/client";
import { answerFields } from "./answer-text.js";
import { absolutePath, type CommandRun } from "./command.js";
import { reported } from "./output.js";

/** A query for given files, and the text its answer prints. */
export interface FileQuery<A extends WaitResponse | ChangesResponse> {
  readonly name: string;
  readonly json: boolean;
  readonly rootArgument: string | undefined;
  readonly fileArguments: readonly string[];
  readonly query: (root: string, files: string[]) => Promise<A>;
  readonly text: (answer: A) => string;
}

/**
 * Resolves the root and every file against the command's directory and asks the daemon; every answer succeeds, and a
 * rejection fails naming the root and the files it asked about.
 */
export function fileQueryRun<A extends WaitResponse | ChangesResponse>(
  request: FileQuery<A>,
): CommandRun {
  const { name, json, rootArgument, fileArguments, query, text } = request;
  return (io) =>
    reported(io, name, json, async (output) => {
      const root = absolutePath(io, rootArgument);
      const files = fileArguments.map((file) => absolutePath(io, file));
      let answer: A;
      try {
        answer = await query(root, files);
      } catch (error) {
        return output.fail(errorText(error), {
          consumerRoot: root,
          requestedPaths: files,
        });
      }
      return output.succeed(answerFields(answer), text(answer));
    });
}

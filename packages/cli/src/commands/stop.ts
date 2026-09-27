import { parseArgs } from "node:util";
import { stopDaemon } from "@rt-test/daemon/client";
import {
  absolutePath,
  JSON_OPTION,
  optionalRoot,
  type Command,
} from "../command.js";
import { oneLine, reported } from "../output.js";

const NAME = "stop";

export const stopCommand: Command = {
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
        const { pid } = await stopDaemon(root);
        return output.succeed(
          { consumerRoot: root, pid },
          `Stopped the RT Test daemon, process ${pid}, for ${oneLine(root)}.`,
        );
      });
  },
};

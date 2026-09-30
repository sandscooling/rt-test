import { isUsageError, type CliIo, type Command } from "./command.js";
import { changesCommand } from "./commands/changes.js";
import { defectsCommand } from "./commands/defects.js";
import { hookCommand } from "./commands/hook.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { stopCommand } from "./commands/stop.js";
import { summaryCommand } from "./commands/summary.js";
import { waitCommand } from "./commands/wait.js";
import { EXIT_USAGE, type ExitCode } from "./output.js";

const COMMANDS: readonly Command[] = [
  startCommand,
  stopCommand,
  summaryCommand,
  statusCommand,
  waitCommand,
  changesCommand,
  defectsCommand,
  hookCommand,
];

/** Writes nothing to stdout on a usage error, since a strict parse that fails never reached `--json`. */
export async function main(
  argv: readonly string[],
  io: CliIo,
): Promise<ExitCode> {
  const [name, ...args] = argv;
  const command = COMMANDS.find((entry) => entry.name === name);
  if (command === undefined) {
    const problem =
      name === undefined ? "Missing command." : `Unknown command: ${name}`;
    return usageError(io, problem, COMMANDS);
  }
  let run;
  try {
    run = command.parse(args);
  } catch (error) {
    if (!isUsageError(error)) throw error;
    return usageError(io, error.message, [command]);
  }
  return run(io);
}

function usageError(
  io: CliIo,
  problem: string,
  commands: readonly Command[],
): ExitCode {
  const usage = commands.map((command) => `  ${command.usage}`);
  io.stderr.write([problem, "Usage:", ...usage, ""].join("\n"));
  return EXIT_USAGE;
}

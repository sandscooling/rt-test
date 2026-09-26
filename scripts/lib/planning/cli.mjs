import { loadFlowConfig } from "../flow-config.mjs";

export function runCli(command) {
  const result = command(loadFlowConfig(), process.argv.slice(2));
  process.stdout.write(result.out);
  process.stderr.write(result.err);
  process.exitCode = result.code;
}

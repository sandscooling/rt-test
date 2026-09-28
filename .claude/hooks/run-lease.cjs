// PreToolUse hook on Bash and PowerShell: denies a heavy test run started without the run lease wrapper.
// Which commands are heavy lives in scripts/lib/orchestration/heavy-command.mjs, the denial in lease-cli.mjs.
// Any hook error fails open, so a fault here never blocks an ordinary command.
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO = path.resolve(__dirname, "..", "..");
const POWERSHELL_TOOL = "PowerShell";
const load = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

async function main() {
  const input = readInput();
  const command = input.tool_input?.command;
  if (typeof command !== "string") return;
  try {
    const { SHELL, unleasedHeavyRuns } = await load(
      "scripts/lib/orchestration/heavy-command.mjs",
    );
    const shell =
      input.tool_name === POWERSHELL_TOOL ? SHELL.POWERSHELL : SHELL.BASH;
    const [heavy] = unleasedHeavyRuns(command, {
      cwd: input.cwd ?? REPO,
      shell,
    });
    if (heavy === undefined) return;
    const { heavyRunDenial, leaseDirFor } = await load(
      "scripts/lib/orchestration/lease-cli.mjs",
    );
    const reason = heavyRunDenial(leaseDirFor(REPO), heavy);
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      }),
    );
  } catch (error) {
    process.stderr.write(`run-lease hook skipped: ${error.message}\n`);
  }
}

main();

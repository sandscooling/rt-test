// Stop hook: runs the binary doc gates for watched files this session's own tool calls named.
// The gate map and the session scoping live in scripts/lib/orchestration/doc-integrity.mjs.
// Exit 2 blocks the stop and feeds stderr back to the model; any hook error fails open.
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO = path.resolve(__dirname, "..", "..");
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
  try {
    const { loadFlowConfig } = await load("scripts/lib/flow-config.mjs");
    const { docIntegrity } = await load(
      "scripts/lib/orchestration/doc-integrity.mjs",
    );
    const result = docIntegrity(loadFlowConfig(REPO), input);
    if (result.err) process.stderr.write(result.err);
    return result.code;
  } catch (error) {
    process.stderr.write(`doc-integrity hook skipped: ${error.message}\n`);
    return 0;
  }
}

main().then((code) => {
  process.exitCode = code;
});

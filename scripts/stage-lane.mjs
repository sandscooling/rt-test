import { fileURLToPath } from "node:url";
import { claimsDirFor } from "./lib/orchestration/claims-cli.mjs";
import { runStageCli } from "./lib/orchestration/stage-cli.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = runStageCli(process.argv.slice(2), {
  root,
  claimsDir: claimsDirFor(root),
});
for (const line of result.out) console.log(line);
for (const line of result.err) console.error(line);
process.exitCode = result.code;

import { fileURLToPath } from "node:url";
import { claimsDirFor, runClaimsCli } from "./lib/orchestration/claims-cli.mjs";
import { pathRules } from "./lib/orchestration/paths.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = runClaimsCli(process.argv.slice(2), {
  root,
  dir: claimsDirFor(root),
  rules: pathRules(),
});
for (const line of result.out) console.log(line);
for (const line of result.err) console.error(line);
process.exitCode = result.code;

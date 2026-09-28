import { fileURLToPath } from "node:url";
import { leaseDirFor, runLeaseCli } from "./lib/orchestration/lease-cli.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.exitCode = await runLeaseCli(process.argv.slice(2), {
  root,
  dir: leaseDirFor(root),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});

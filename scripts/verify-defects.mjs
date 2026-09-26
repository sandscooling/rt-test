import { fileURLToPath } from "node:url";
import { runVerification } from "./lib/defects/verify.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.exitCode = await runVerification({
  root,
  argv: process.argv.slice(2),
});

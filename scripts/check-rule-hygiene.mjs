import { runRuleHygiene } from "./lib/rules/hygiene-cli.mjs";
import { consoleIo } from "./lib/rules/io.mjs";

process.exitCode = runRuleHygiene(process.argv.slice(2), consoleIo());

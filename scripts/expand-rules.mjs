import { runExpandRules } from "./lib/rules/expand-cli.mjs";
import { consoleIo } from "./lib/rules/io.mjs";

process.exitCode = runExpandRules(process.argv.slice(2), consoleIo());

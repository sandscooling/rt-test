import { runFillTicket } from "./lib/skills/fill-ticket-cli.mjs";
import { consoleIo } from "./lib/rules/io.mjs";

process.exitCode = runFillTicket(process.argv.slice(2), consoleIo());

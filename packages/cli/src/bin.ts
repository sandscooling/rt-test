#!/usr/bin/env node
import { errorText } from "@rt-test/daemon/client";
import { main } from "./main.js";
import { EXIT_FAILURE } from "./output.js";

const FIRST_ARGUMENT = 2;

try {
  process.exitCode = await main(process.argv.slice(FIRST_ARGUMENT), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    stdinIsTerminal: process.stdin.isTTY === true,
    stderrIsTerminal: process.stderr.isTTY === true,
    cwd: process.cwd(),
    exit: (code) => process.exit(code),
  });
} catch (error) {
  process.stderr.write(`rt-test failed unexpectedly: ${errorText(error)}\n`);
  process.exitCode = EXIT_FAILURE;
}

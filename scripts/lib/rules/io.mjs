import { readFileSync } from "node:fs";

export function consoleIo() {
  return {
    root: undefined,
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    stdin: () => (process.stdin.isTTY ? "" : readFileSync(0, "utf8")),
  };
}

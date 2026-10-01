// Stands in for Vitest's entry under the defect verifier's runner. It reads its script from `stand-in.json` in the
// `--root` directory: `stderr` and `lines` to write to stderr and stdout at once, a `repeat` line to write every
// REPEAT_MS until the test writes `released` in the root, `children` to start detached (each an argument list for an
// idle Node process, so the command line can name what the test needs, followed by the root, which ties the child to
// the test), `childStdio` for them ("ignore" unless "inherit", which holds the runner's pipes open), and `finish`,
// which writes an empty report and exits; otherwise it hangs until it is ended.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPEAT_MS = 100;
const RELEASED = "released";
const IDLE_SCRIPT = "setInterval(() => {}, 1000);";
const EMPTY_REPORT = { numPassedTests: 0, numFailedTests: 0, testResults: [] };

const args = process.argv.slice(2);
const valueOf = (flag) => args[args.indexOf(flag) + 1];
const root = valueOf("--root");
const script = JSON.parse(readFileSync(join(root, "stand-in.json"), "utf8"));

const children = (script.children ?? []).map((extra) => {
  const child = spawn(process.execPath, ["-e", IDLE_SCRIPT, ...extra, root], {
    cwd: tmpdir(),
    detached: true,
    stdio: script.childStdio ?? "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid;
});
writeFileSync(join(root, "children.json"), JSON.stringify(children));

for (const line of script.stderr ?? []) process.stderr.write(`${line}\n`);
for (const line of script.lines ?? []) process.stdout.write(`${line}\n`);

function finish() {
  if (!script.finish) {
    setInterval(() => {}, 1000);
    return;
  }
  writeFileSync(valueOf("--outputFile"), JSON.stringify(EMPTY_REPORT));
  process.exit(0);
}

if (script.repeat === undefined) finish();
else {
  const beat = setInterval(() => {
    process.stdout.write(`${script.repeat}\n`);
    if (!existsSync(join(root, RELEASED))) return;
    clearInterval(beat);
    finish();
  }, REPEAT_MS);
}

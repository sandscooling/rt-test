import { cleanUpRun } from "./run-cleanup.mjs";

const USAGE_EXIT = 2;
const LEFT_EXIT = 1;
const READY = "ready\n";
const [runRoot] = process.argv.slice(2);

if (runRoot === undefined) {
  process.exit(USAGE_EXIT);
}

let cleaning;

/** The pipe from the guarded process closes only when that process ends. */
function onGuardedProcessEnd() {
  cleaning ??= cleanUpRun(runRoot).then(
    ({ removed }) => process.exit(removed ? 0 : LEFT_EXIT),
    () => process.exit(LEFT_EXIT),
  );
}

process.stdin.on("end", onGuardedProcessEnd);
process.stdin.on("close", onGuardedProcessEnd);
process.stdin.on("error", onGuardedProcessEnd);
process.stdin.resume();
process.stdout.on("error", () => undefined);
process.stdout.write(READY);

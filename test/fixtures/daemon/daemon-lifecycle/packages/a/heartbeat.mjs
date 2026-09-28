import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";

// A long-lived child a job starts. It connects to the test's endpoint that `child-endpoint` beside it names, then
// rewrites its file with its process id and the time every 50 ms, and answers each line the test writes with its
// process id: the test asks whether it still runs, and the OS closes the connection once it has ended, however it was
// ended. A child that cannot connect writes `failed-heartbeat-<name>` with the reason and exits, so the job and the
// test report it rather than wait for a beat. Bounded, and its next write throws uncaught once its file's directory is
// gone, so a child nobody ends still exits.
const BEAT_MS = 50;
const LIFETIME_MS = 60_000;
const file = process.argv[2];
const endpoint = new URL("./child-endpoint", import.meta.url);

function fail(reason) {
  writeFileSync(join(dirname(file), `failed-${basename(file)}`), reason);
  process.exit(1);
}

const beat = () => writeFileSync(file, `${process.pid} ${Date.now()}`);

setTimeout(() => process.exit(), LIFETIME_MS);
if (!existsSync(endpoint)) fail("no child-endpoint names the test's endpoint");
let connected = false;
const socket = createConnection(readFileSync(endpoint, "utf8"));
socket.on("error", (error) => {
  if (!connected)
    fail(`cannot connect to the test's endpoint: ${error.message}`);
});
socket.once("close", () => {
  if (!connected)
    fail("the test's endpoint closed the connection before it was made");
});
socket.once("connect", () => {
  connected = true;
  beat();
  setInterval(beat, BEAT_MS);
});
createInterface({ input: socket }).on("line", () =>
  socket.write(`${process.pid}\n`),
);

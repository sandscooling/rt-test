import { writeFileSync } from "node:fs";

// A long-lived child a job starts. It rewrites its file with its process id and the time every 50 ms, so a test can
// tell it still runs without trusting a process id Windows may have handed to another process. Bounded, and its next
// write throws uncaught once its file's directory is gone, so a child nobody ends still exits.
const BEAT_MS = 50;
const LIFETIME_MS = 60_000;
const file = process.argv[2];

const beat = () => writeFileSync(file, `${process.pid} ${Date.now()}`);
beat();
setInterval(beat, BEAT_MS);
setTimeout(() => process.exit(), LIFETIME_MS);

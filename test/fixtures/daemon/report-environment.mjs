import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

// Preloaded into every process a test starts. In an executor process started with RT_REPORT_ENVIRONMENT naming a
// file, it appends the environment the process started with to that file as one JSON line, before any job runs. In
// the daemon, it sets RT_GAINED_AFTER_START in the daemon's own environment at each fork, so the variable is gained
// after the daemon took its start environment and before an executor process starts from it.
export const REPORT_VARIABLE = "RT_REPORT_ENVIRONMENT";
export const GAINED_VARIABLE = "RT_GAINED_AFTER_START";
const EXECUTOR_ENTRY = /executor-main\.[jt]s$/;
const [, entry = ""] = process.argv;
const report = process.env[REPORT_VARIABLE];

if (EXECUTOR_ENTRY.test(entry) && report !== undefined) {
  appendFileSync(report, `${JSON.stringify(process.env)}\n`);
}

if (entry.endsWith("daemon-main.ts")) {
  const { fork } = childProcess;
  childProcess.fork = (...args) => {
    process.env[GAINED_VARIABLE] = "gained after the start";
    return fork(...args);
  };
  syncBuiltinESMExports();
}

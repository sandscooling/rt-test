import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

// Preloaded into every process a test starts. In an executor process started with RT_REPORT_ENVIRONMENT naming a
// file, it appends the environment the process started with to that file as one JSON line, before any job runs. In
// the daemon, it sets RT_GAINED_AFTER_START in the daemon's own environment at each fork, so the variable is gained
// after the daemon took its start environment and before an executor process starts from it. Each such fork also
// appends a line to the report's fork file: `held` when the daemon's environment already held the variable as the
// fork began, `gaining` otherwise.
export const REPORT_VARIABLE = "RT_REPORT_ENVIRONMENT";
export const GAINED_VARIABLE = "RT_GAINED_AFTER_START";
export const DAEMON_FORKS_SUFFIX = ".daemon-forks";
export const HELD_AT_FORK = "held";
const EXECUTOR_ENTRY = /executor-main\.[jt]s$/;
const DAEMON_ENTRY = /daemon-main\.[jt]s$/;
const [, entry = ""] = process.argv;
const report = process.env[REPORT_VARIABLE];

if (EXECUTOR_ENTRY.test(entry) && report !== undefined) {
  appendFileSync(report, `${JSON.stringify(process.env)}\n`);
}

if (DAEMON_ENTRY.test(entry)) {
  const { fork } = childProcess;
  childProcess.fork = (...args) => {
    const held = process.env[GAINED_VARIABLE] !== undefined;
    process.env[GAINED_VARIABLE] = "gained after the start";
    if (report !== undefined) {
      appendFileSync(
        `${report}${DAEMON_FORKS_SUFFIX}`,
        `${held ? HELD_AT_FORK : "gaining"}\n`,
      );
    }
    return fork(...args);
  };
  syncBuiltinESMExports();
}

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const POLL_MS = 5;
/** `spawn-children` holding this starts each child through a shell, as an npm script or a `.cmd` launcher does. */
const THROUGH_A_SHELL = "shell";
const here = (name) => new URL(`./${name}`, import.meta.url);

/** A path as one word for `cmd.exe`, or for `/bin/sh`, where only single quotes keep `$` and backticks literal. */
function shellQuoted(part) {
  if (process.platform === "win32") return `"${part}"`;
  return `'${part.replaceAll("'", "'\\''")}'`;
}

/** With `spawn-children` present, whether the global setup and the test each start a heartbeat child. */
export function spawnsChildren() {
  return existsSync(here("spawn-children"));
}

/**
 * Starts a heartbeat child that does not detach, outside the consumer tree, and resolves once it has written its
 * first beat to `heartbeat-<name>`, so a job that ends at once still ends a running child. Throws the child's reason
 * once it writes `failed-heartbeat-<name>` instead.
 */
export async function startHeartbeat(name) {
  const beat = here(`heartbeat-${name}`);
  const failed = here(`failed-heartbeat-${name}`);
  const args = [fileURLToPath(here("heartbeat.mjs")), fileURLToPath(beat)];
  const options = { cwd: tmpdir(), stdio: "ignore", windowsHide: true };
  if (readFileSync(here("spawn-children"), "utf8") === THROUGH_A_SHELL) {
    const quoted = [process.execPath, ...args].map(shellQuoted);
    spawn(quoted.join(" "), { ...options, shell: true });
  } else {
    spawn(process.execPath, args, options);
  }
  while (!existsSync(beat)) {
    if (existsSync(failed)) {
      throw new Error(
        `heartbeat ${name} failed: ${readFileSync(failed, "utf8")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

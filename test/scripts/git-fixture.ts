import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { PROCESS_SCENARIO_TIMEOUT_MS } from "./timeouts.js";

// A hooks path that does not exist runs no hook, so a developer's global hooks
// and signing settings cannot fail or stall a fixture repository.
const FIXTURE_GIT_SETTINGS = [
  ["user", "name", "RT Test fixture"],
  ["user", "email", "fixture@example.invalid"],
  ["core", "autocrlf", "false"],
  ["core", "hooksPath", ".git/no-hooks"],
  ["commit", "gpgsign", "false"],
] as const;

export const FIXTURE_GIT_FLAGS = FIXTURE_GIT_SETTINGS.flatMap(
  ([section, key, value]) => ["-c", `${section}.${key}=${value}`],
);

// Writing the config saves a git spawn per value; git reads repeated sections as one.
export function writeFixtureGitConfig(root: string): void {
  const text = FIXTURE_GIT_SETTINGS.map(
    ([section, key, value]) => `[${section}]\n\t${key} = ${value}\n`,
  ).join("");
  appendFileSync(join(root, ".git/config"), text);
}

export function authorOf(root: string): string {
  return execFileSync("git", ["log", "-1", "--format=%an <%ae>"], {
    cwd: root,
    encoding: "utf8",
    timeout: PROCESS_SCENARIO_TIMEOUT_MS,
    windowsHide: true,
  }).trim();
}

// A builder that throws yields its message, so a missing setting fails an assertion
// whether or not the machine has a global identity to fall back on.
export function outcomeOf(build: () => string): string {
  try {
    return build();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

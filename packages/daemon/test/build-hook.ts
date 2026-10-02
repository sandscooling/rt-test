import { join } from "node:path";
import { HOOK_VARIABLE } from "../../../test/fixtures/daemon/build-hook.mjs";
import { withEnvironment, withPreload } from "./daemon-harness.js";
import { REPO } from "./harness.js";

const BUILD_HOOK = join(REPO, "test/fixtures/daemon/build-hook.mjs");

export interface BuildHook {
  /** The root-relative label of the file the hook acts at. */
  readonly at: string;
  readonly action: "hold" | "exit" | "remove-and-exit";
  /** Written once a hold begins. */
  readonly marker?: string;
}

/** Runs `body` with every executor it starts, and every executor of a daemon it starts, preloading the build hook. */
export function withBuildHook<T>(
  hook: BuildHook,
  body: () => Promise<T>,
): Promise<T> {
  return withEnvironment(HOOK_VARIABLE, JSON.stringify(hook), () =>
    withPreload(BUILD_HOOK, body),
  );
}

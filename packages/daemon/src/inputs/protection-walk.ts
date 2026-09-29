import { absoluteInputPath } from "./input-filter.js";
import {
  MODIFIED_TIME_RESOLUTION_MS,
  takeInventory,
  type InventoryScope,
} from "./input-inventory.js";
import type { InputState } from "./input-state.js";

export type ReleasedFiles =
  | {
      readonly ok: true;
      /** Why an input the walk kept may have changed at or after the time given; undefined when none may have. */
      readonly changed: string | undefined;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Walks the consumer root under the filter's current decision for the inputs `state` does not hold: files a
 * declared pattern hid until protection changed, which the tracker never read and no watch reported. Keeps each read
 * no queued path supersedes, marking no job, and leaves the commit to the caller. Call it only once that decision governs which events are dropped, so an
 * edit to such a file either lands before the walk reads its time, or arrives as an event. `queued` takes an absolute
 * path; `since` is the job's start in ms, when a job relies on the inputs.
 */
export async function keepReleasedFiles(
  scope: InventoryScope,
  state: InputState,
  queued: (path: string) => boolean,
  since: number | undefined,
): Promise<ReleasedFiles> {
  const walked = await takeInventory(scope, scope.root);
  if (!walked.ok) return walked;
  const released = [...walked.inputs].filter(([path]) => !state.hasInput(path));
  for (const [path, read] of released) {
    if (!queued(absoluteInputPath(scope.root, path))) state.set(path, read);
  }
  const changed =
    since === undefined
      ? undefined
      : released.find(
          ([, read]) =>
            read.stamp.modifiedMs >= since - MODIFIED_TIME_RESOLUTION_MS,
        )?.[0];
  return {
    ok: true,
    changed:
      changed === undefined
        ? undefined
        : `${changed}, an input the tracker had not read before protection changed, may have changed while the job ran`,
  };
}

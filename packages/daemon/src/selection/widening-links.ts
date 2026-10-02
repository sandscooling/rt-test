import type { NonInputMatch } from "../inputs/non-inputs.js";
import type {
  DependencyUncertainty,
  DependentLink,
  LeftOutWidening,
} from "./selection-types.js";

export interface FollowedWidenings {
  /** One link per widening selection follows, which every workspace reaches. */
  readonly links: readonly DependentLink[];
  readonly leftOut: readonly LeftOutWidening[];
}

/**
 * Splits the uncertainties into the links selection follows and the widenings it leaves out. One is left out only
 * when a single source file raised it and `declared` calls that file a non-input, which no test reads. `declared`
 * answers undefined for a file the protection keeps and while no pattern applies, so each of those widenings stays.
 */
export function followedWidenings(
  uncertainties: readonly DependencyUncertainty[],
  declared: NonInputMatch,
): FollowedWidenings {
  const links: DependentLink[] = [];
  const leftOut: LeftOutWidening[] = [];
  for (const widening of uncertainties) {
    const { file } = widening;
    const pattern = file === undefined ? undefined : declared(file);
    if (file !== undefined && pattern !== undefined) {
      leftOut.push({ ...widening, file, pattern });
      continue;
    }
    links.push({
      workspace: widening.dependent,
      step: {
        workspace: widening.dependent,
        via: widening.kind,
        detail: widening.cause,
      },
      widening,
    });
  }
  return { links, leftOut };
}

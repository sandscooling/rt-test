import { display, failed, passed } from "./files.mjs";
import { analyzeRequirements, unknownReferences } from "./requirements.mjs";

export function checkRequirementMarkers(config, args) {
  if (args.length > 0) return failed(["usage: check-requirement-markers.mjs"]);
  const { requirements, problems } = analyzeRequirements(config);
  problems.push(...unknownReferences(config, requirements));
  if (problems.length > 0) return failed(problems);
  const file = display(config, config.requirements);
  return passed([
    `requirement-markers: clean, ${requirements.length} requirement(s) in ${file} link to known sprints and tickets.`,
  ]);
}

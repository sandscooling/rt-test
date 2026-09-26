import { failed, passed } from "./files.mjs";
import { deriveState } from "./markers.mjs";
import { historicIds } from "./requirement-history.mjs";
import { analyzeRequirements } from "./requirements.mjs";

const USAGE = "usage: requirements-index.mjs [--ids FR1,NFR2 | --next]";
const FAMILIES = [
  ["FR", "FUNCTIONAL REQUIREMENTS"],
  ["NFR", "NON-FUNCTIONAL REQUIREMENTS"],
];

export function requirementsIndex(config, args) {
  const options = parseArgs(args);
  if (!options) return failed([USAGE]);
  const { status, requirements, problems } = analyzeRequirements(config);
  if (problems.length > 0) return failed(problems);
  if (options.next) {
    const history = historicIds(config);
    if (history.problem) return failed([history.problem]);
    return passed(
      nextIds([
        ...requirements.map((requirement) => requirement.id),
        ...history.ids,
      ]),
    );
  }
  if (!options.ids) return passed(render(requirements, status));
  const found = new Set(requirements.map((requirement) => requirement.id));
  const missing = options.ids.filter((id) => !found.has(id));
  if (missing.length > 0)
    return failed([`no such requirement id: ${missing.join(", ")}`]);
  const wanted = new Set(options.ids);
  return passed(
    render(
      requirements.filter((requirement) => wanted.has(requirement.id)),
      status,
    ),
  );
}

function parseArgs(args) {
  if (args.length === 0) return {};
  if (args.length === 1 && args[0] === "--next") return { next: true };
  if (args.length === 2 && args[0] === "--ids") {
    const ids = args[1]
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return ids.length > 0 ? { ids } : undefined;
  }
  return undefined;
}

function family(id) {
  return id.startsWith("NFR") ? "NFR" : "FR";
}

function nextIds(ids) {
  return FAMILIES.map(([prefix]) => {
    const numbers = ids
      .filter((id) => family(id) === prefix)
      .map((id) => Number(id.slice(prefix.length)));
    return `NEXT_${prefix}: ${prefix}${Math.max(0, ...numbers) + 1}`;
  });
}

function render(requirements, status) {
  return FAMILIES.flatMap(([prefix, heading]) => {
    const members = requirements.filter(
      (requirement) => family(requirement.id) === prefix,
    );
    return [
      `=== ${heading} (${members.length}) ===`,
      ...members.map(
        (requirement) =>
          `${requirement.id}: ${requirement.title} | ${deriveState(requirement.marker, status)} | ${requirement.markerText}`,
      ),
    ];
  });
}

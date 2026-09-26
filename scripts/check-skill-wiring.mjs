import { loadFlowConfig } from "./lib/flow-config.mjs";
import { skillWiring } from "./lib/skills/skill-wiring.mjs";
import { emit } from "./lib/standards/result.mjs";

emit(skillWiring(loadFlowConfig(), process.argv.slice(2)));

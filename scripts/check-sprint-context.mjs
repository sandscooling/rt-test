import { loadFlowConfig } from "./lib/flow-config.mjs";
import { sprintContext } from "./lib/skills/sprint-context.mjs";
import { emit } from "./lib/standards/result.mjs";

emit(sprintContext(loadFlowConfig(), process.argv.slice(2)));

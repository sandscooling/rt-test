import { loadFlowConfig } from "./lib/flow-config.mjs";
import { emit } from "./lib/standards/result.mjs";
import { listUnbuiltWork } from "./lib/unbuilt/unbuilt-work.mjs";

emit(listUnbuiltWork(loadFlowConfig(), process.argv.slice(2)));

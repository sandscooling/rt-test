import { loadFlowConfig } from "./lib/flow-config.mjs";
import { checkLineCitations } from "./lib/standards/line-citations.mjs";
import { emit } from "./lib/standards/result.mjs";

emit(checkLineCitations(loadFlowConfig(), process.argv.slice(2)));

import { loadFlowConfig } from "./lib/flow-config.mjs";
import { docSection } from "./lib/standards/doc-section.mjs";
import { emit } from "./lib/standards/result.mjs";

emit(docSection(loadFlowConfig(), process.argv.slice(2)));

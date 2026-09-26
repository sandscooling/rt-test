import { loadFlowConfig } from "./lib/flow-config.mjs";
import { emit } from "./lib/standards/result.mjs";
import { checkWorkspaceScripts } from "./lib/standards/workspace-scripts.mjs";

emit(checkWorkspaceScripts(loadFlowConfig()));

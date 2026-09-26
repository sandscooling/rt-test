import { listOpenIssues } from "./lib/standards/open-issues.mjs";
import { emit } from "./lib/standards/result.mjs";

emit(listOpenIssues(process.argv.slice(2)));

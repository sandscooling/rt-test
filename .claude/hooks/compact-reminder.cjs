// SessionStart hook for the `compact` source: this repository hands off to a successor instead
// of compacting, so a compacted session is told to hand off now.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const GAUGE = pathToFileURL(
  path.resolve(
    __dirname,
    "..",
    "..",
    "scripts/lib/orchestration/context-gauge.mjs",
  ),
).href;

import(GAUGE).then(
  ({ compactReminder }) =>
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: compactReminder(),
        },
      }),
    ),
  () => console.log("{}"),
);

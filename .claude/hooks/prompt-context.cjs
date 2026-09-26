// UserPromptSubmit hook: prepends local time, context use, and rate-limit windows to each prompt.
//   --post-tool  PostToolUse hook: silent below the handoff line, a handoff instruction above it.
//   --self       prints this session's context line on demand.
// Fields are dropped rather than faked when a source is unavailable, and any error fails open.
const { readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO = path.resolve(__dirname, "..", "..");
const GAUGE = pathToFileURL(
  path.join(REPO, "scripts/lib/orchestration/context-gauge.mjs"),
).href;

const emit = (event, text) =>
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text },
    }),
  );

async function main(argv) {
  const gauge = await import(GAUGE);
  if (argv.includes("--self")) {
    const transcript = gauge.ownTranscriptPath(
      os.homedir(),
      process.env.CLAUDE_CODE_SESSION_ID,
    );
    const used = gauge.usedTokens(transcript);
    if (used == null) {
      console.error(
        "context unknown: no transcript for CLAUDE_CODE_SESSION_ID",
      );
      return 1;
    }
    console.log(gauge.formatContext(used));
    return 0;
  }
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (argv.includes("--post-tool")) {
    const warning = gauge.postToolWarning(payload);
    if (warning) emit("PostToolUse", warning);
    return 0;
  }
  emit("UserPromptSubmit", gauge.promptHeader(payload, { home: os.homedir() }));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    if (!process.argv.includes("--post-tool")) console.log("{}");
  },
);

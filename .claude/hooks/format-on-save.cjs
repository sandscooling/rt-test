// PostToolUse hook for Edit and Write: formats the saved file with the project's prettier.
// It fails open: the save always stands, and a failure reaches the session as a note, never a block.
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPO = path.resolve(__dirname, "..", "..");
const FORMATTER = pathToFileURL(
  path.join(REPO, "scripts/lib/orchestration/format-on-save.mjs"),
).href;

const emit = (text) =>
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: text,
      },
    }),
  );

async function main() {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  const { formatOnSave } = await import(FORMATTER);
  const { note } = await formatOnSave(REPO, payload.tool_input?.file_path);
  if (note) emit(note);
}

main().catch((error) => {
  const reason = String(error?.message ?? error).split("\n")[0];
  emit(`The format-on-save hook failed, so the file stays as saved: ${reason}`);
});

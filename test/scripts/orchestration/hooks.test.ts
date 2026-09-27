import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GATE_TIMEOUT_MS,
  GATES,
  GIT_TIMEOUT_MS,
} from "../../../scripts/lib/orchestration/doc-integrity.mjs";
import { PROCESS_SCENARIO, PROCESS_SCENARIO_TIMEOUT_MS } from "../timeouts.js";
import {
  CLOCK_ONLY,
  FIXTURES,
  initRepo,
  REPO,
  withTemp,
  writeIn,
} from "./harness.js";

const ADR = "docs/adr/0001-first.md";
const HOOKS = ".claude/hooks";
const PROJECT_DIR = "$CLAUDE_PROJECT_DIR/";
const ENTRY_DEPENDENCIES = [
  HOOKS,
  "scripts/lib/flow-config.mjs",
  "scripts/lib/paths.mjs",
  "scripts/lib/orchestration",
  "_agent-docs/_flow-config.yaml",
];

interface HookCommand {
  readonly event: string;
  readonly matcher?: string | undefined;
  readonly command: string;
  readonly shell?: string;
  readonly timeout?: number;
}

interface Settings {
  readonly hooks: Record<
    string,
    {
      readonly matcher?: string;
      readonly hooks: Omit<HookCommand, "event" | "matcher">[];
    }[]
  >;
}

function hookCommands(): HookCommand[] {
  const settings = JSON.parse(
    readFileSync(join(REPO, ".claude/settings.json"), "utf8"),
  ) as Settings;
  return Object.entries(settings.hooks).flatMap(([event, groups]) =>
    groups.flatMap((group) =>
      group.hooks.map((hook) => ({ event, matcher: group.matcher, ...hook })),
    ),
  );
}

// The entry's own path, as the command names it below $CLAUDE_PROJECT_DIR.
const entryOf = (command: string) =>
  command
    .slice(command.indexOf(PROJECT_DIR) + PROJECT_DIR.length)
    .split('"')[0] ?? "";

function copyEntries(root: string): void {
  for (const path of ENTRY_DEPENDENCIES) {
    cpSync(join(REPO, path), join(root, path), { recursive: true });
  }
}

function runEntry(
  root: string,
  entry: string,
  input: Record<string, unknown> | string,
  args: string[] = [],
) {
  return spawnSync("node", [join(root, HOOKS, entry), ...args], {
    cwd: root,
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    timeout: PROCESS_SCENARIO_TIMEOUT_MS,
  });
}

// A repo whose ADR gate fails, with a session transcript that edited the ADR.
function runDocIntegrity(
  input: Record<string, unknown> = {},
  { dropConfig = false } = {},
) {
  return withTemp((root) => {
    initRepo(root, { "docs/adr/README.md": "index\n" });
    copyEntries(root);
    cpSync(
      join(FIXTURES, "failing-gate.mjs"),
      join(root, "scripts/adr-index.mjs"),
    );
    writeIn(root, ADR, "new\n");
    const edit = {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Write", input: { file_path: ADR } },
        ],
      },
    };
    writeIn(root, "session.jsonl", `${JSON.stringify(edit)}\n`);
    if (dropConfig) rmSync(join(root, "_agent-docs/_flow-config.yaml"));
    const transcript_path = join(root, "session.jsonl");
    return runEntry(root, "doc-integrity.cjs", { transcript_path, ...input });
  });
}

function hookOutput(
  entry: string,
  tokens: number,
  args: string[] = [],
  payload: Record<string, unknown> = {},
) {
  const run = withTemp((root) => {
    copyEntries(root);
    const usage = { message: { usage: { input_tokens: tokens } } };
    writeIn(root, "session.jsonl", `${JSON.stringify(usage)}\n`);
    return runEntry(
      root,
      entry,
      { transcript_path: join(root, "session.jsonl"), ...payload },
      args,
    );
  });
  if (run.error || run.signal || run.status !== 0) {
    throw new Error(
      `${entry} failed: ${run.error ?? run.signal ?? `exit ${run.status}: ${run.stderr}`}`,
    );
  }
  return JSON.parse(run.stdout || "{}") as {
    hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
  };
}

function runMalformedPostTool() {
  return withTemp((root) => {
    copyEntries(root);
    return runEntry(root, "prompt-context.cjs", "{not json", ["--post-tool"]);
  });
}

describe("hook entries", PROCESS_SCENARIO, () => {
  it("D357: exits 2 from the doc-integrity entry when a gate fails", () => {
    expect(runDocIntegrity().status).toBe(2);
  });

  it("D358: hands the failing gate's output back on stderr", () => {
    expect(runDocIntegrity().stderr).toContain("fixture gate failed");
  });

  it("D359: reads stop_hook_active from the entry's stdin", () => {
    expect(runDocIntegrity({ stop_hook_active: true }).status).toBe(0);
  });

  it("D360: fails open when the flow config cannot be read", () => {
    expect(runDocIntegrity({}, { dropConfig: true }).status).toBe(0);
  });

  it("D1933: carries the handoff warning after the stamp above the handoff line", () => {
    const out = hookOutput("prompt-context.cjs", 700_000, ["--post-tool"], {
      hook_event_name: "PostToolUse",
    });
    expect(out.hookSpecificOutput).toEqual({
      hookEventName: "PostToolUse",
      additionalContext: expect.stringMatching(
        /^\[[^\]]+\] ctx 700k\/1M \(70%\): past the 60% handoff line\. /,
      ),
    });
  });

  it("D1928: emits the local time as PostToolUse context below the handoff line", () => {
    const out = hookOutput("prompt-context.cjs", 1000, ["--post-tool"], {
      hook_event_name: "PostToolUse",
    });
    expect(out.hookSpecificOutput).toEqual({
      hookEventName: "PostToolUse",
      additionalContext: expect.stringMatching(CLOCK_ONLY),
    });
  });

  it("D1932: labels a failed tool call's stamp as PostToolUseFailure context", () => {
    const out = hookOutput("prompt-context.cjs", 1000, ["--post-tool"], {
      hook_event_name: "PostToolUseFailure",
    });
    expect(out.hookSpecificOutput).toEqual({
      hookEventName: "PostToolUseFailure",
      additionalContext: expect.stringMatching(CLOCK_ONLY),
    });
  });

  it("D1930: prints nothing on a malformed post-tool payload", () => {
    const run = runMalformedPostTool();
    expect(run.stdout).toBe("");
  });

  it("D1934: exits 0 on a malformed post-tool payload", () => {
    const run = runMalformedPostTool();
    expect(run.status).toBe(0);
  });

  it("D362: labels the prompt header as UserPromptSubmit context", () => {
    const out = hookOutput("prompt-context.cjs", 1000);
    expect(out.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
  });

  it("D363: labels the compact reminder as SessionStart context", () => {
    const out = hookOutput("compact-reminder.cjs", 1000);
    expect(out.hookSpecificOutput?.hookEventName).toBe("SessionStart");
  });
});

describe("hook settings", () => {
  it("D364: names only hook entries that exist", () => {
    const missing = hookCommands()
      .map((hook) => entryOf(hook.command))
      .filter((entry) => !existsSync(join(REPO, entry)));
    expect(missing).toEqual([]);
  });

  it("D365: runs every hook in bash from $CLAUDE_PROJECT_DIR, so it expands under a PowerShell default", () => {
    const loose = hookCommands().filter(
      (hook) =>
        hook.shell !== "bash" ||
        !hook.command.startsWith(`node "${PROJECT_DIR}`),
    );
    expect(loose).toEqual([]);
  });

  it("D366: runs the handoff reminder when a session starts from a compaction", () => {
    const reminders = hookCommands().filter(
      (hook) =>
        hook.event === "SessionStart" &&
        hook.matcher === "compact" &&
        entryOf(hook.command) === `${HOOKS}/compact-reminder.cjs`,
    );
    expect(reminders).toHaveLength(1);
  });

  it("D1931: stamps the clock after a failed tool call too", () => {
    const clocks = hookCommands().filter(
      (hook) =>
        hook.event === "PostToolUseFailure" &&
        entryOf(hook.command) === `${HOOKS}/prompt-context.cjs` &&
        hook.command.endsWith(" --post-tool"),
    );
    expect(clocks).toHaveLength(1);
  });

  it("D367: gives the Stop hook time to run every doc gate", () => {
    const [stop] = hookCommands().filter((hook) => hook.event === "Stop");
    const needed = GATES.length * GATE_TIMEOUT_MS + GIT_TIMEOUT_MS;
    expect((stop?.timeout ?? 0) * 1000).toBeGreaterThan(needed);
  });
});

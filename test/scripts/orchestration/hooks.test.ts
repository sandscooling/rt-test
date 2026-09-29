import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { format } from "prettier";
import { describe, expect, it, vi } from "vitest";
import {
  GATE_TIMEOUT_MS,
  GATES,
  GIT_TIMEOUT_MS,
} from "../../../scripts/lib/orchestration/doc-integrity.mjs";
import {
  formatOnSave,
  type FormatResult,
} from "../../../scripts/lib/orchestration/format-on-save.mjs";
import { PROCESS_SCENARIO, PROCESS_SCENARIO_TIMEOUT_MS } from "../timeouts.js";
import {
  CLOCK_ONLY,
  FIXTURES,
  initRepo,
  REPO,
  withTemp,
  withTempAsync,
  writeIn,
} from "./harness.js";

// Passes through to prettier, so a test can make one format call race a concurrent save.
vi.mock("prettier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("prettier")>();
  return { ...actual, format: vi.fn<typeof actual.format>(actual.format) };
});

const ADR = "docs/adr/0001-first.md";
const HOOKS = ".claude/hooks";
const FORMAT_ENTRY = "format-on-save.cjs";
const LEASE_ENTRY = "run-lease.cjs";
const PROJECT = "project";
// A line prettier's defaults rewrite, and the text they rewrite it to.
const UNFORMATTED = "const a=1\n";
const PRETTIER_DEFAULTS = "const a = 1;\n";
const UNPARSEABLE = "const = ;\n";
const CONCURRENT_SAVE = "const concurrent=2\n";
const PROJECT_DIR = "$CLAUDE_PROJECT_DIR/";
const ENTRY_DEPENDENCIES = [
  HOOKS,
  "scripts/lib/flow-config.mjs",
  "scripts/lib/paths.mjs",
  "scripts/lib/processes.mjs",
  "scripts/lib/orchestration",
  "test/scripts/run-cleanup.mjs",
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
  env: NodeJS.ProcessEnv = process.env,
) {
  return spawnSync("node", [join(root, HOOKS, entry), ...args], {
    cwd: root,
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    timeout: PROCESS_SCENARIO_TIMEOUT_MS,
    env,
  });
}

// The run-lease hook over a tool call, with the lease store in the temp root rather than the real one.
function runLeaseHook(
  tool_name: string,
  command: string,
  copy: (root: string) => void = copyEntries,
) {
  return withTemp((root) => {
    copy(root);
    return runEntry(
      root,
      LEASE_ENTRY,
      { tool_name, tool_input: { command }, cwd: root },
      [],
      { ...process.env, RUN_LEASE_DIR: join(root, "lease") },
    );
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

interface Saved {
  readonly result: FormatResult | string;
  readonly text: string;
}

// Lays `files` out in a temp directory whose `project` folder is the root, formats `target` through
// the repo's library, and returns its result, or the error it threw, with the target's text after.
function formatSaved(
  files: Record<string, string>,
  target: string,
  prepare: (dir: string) => void = () => undefined,
): Promise<Saved> {
  return withTempAsync(async (dir) => {
    mkdirSync(join(dir, PROJECT));
    for (const [path, text] of Object.entries(files)) writeIn(dir, path, text);
    prepare(dir);
    const file = join(dir, target);
    const result = await formatOnSave(join(dir, PROJECT), file).catch(
      (error: unknown) => `threw ${String(error)}`,
    );
    return { result, text: readFileSync(file, "utf8") };
  });
}

const savePayload = (file_path: string) => ({
  tool_name: "Write",
  tool_input: { file_path },
});

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

  it("D1959: exits 1 from --self, printing nothing on stdout, when the gauge cannot load", () => {
    const run = withTemp((root) => {
      cpSync(join(REPO, HOOKS), join(root, HOOKS), { recursive: true });
      return runEntry(root, "prompt-context.cjs", {}, ["--self"]);
    });
    expect({ status: run.status, stdout: run.stdout }).toEqual({
      status: 1,
      stdout: "",
    });
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

describe("format on save", PROCESS_SCENARIO, () => {
  it("D1981: rewrites an unformatted saved file to prettier's output", async () => {
    const saved = await formatSaved(
      { "project/a.ts": UNFORMATTED },
      "project/a.ts",
    );
    expect(saved.text).toBe(PRETTIER_DEFAULTS);
  });

  it("D1985: returns no note for a file it rewrote", async () => {
    const saved = await formatSaved(
      { "project/a.ts": UNFORMATTED },
      "project/a.ts",
    );
    expect(saved.result).toEqual({
      status: "formatted",
      repoPath: "a.ts",
      reason: null,
      note: null,
    });
  });

  it("D2022: indents by the project's .editorconfig", async () => {
    const saved = await formatSaved(
      {
        "project/.editorconfig": "root = true\n\n[*]\nindent_style = tab\n",
        "project/f.ts": "function f(){return 1}\n",
      },
      "project/f.ts",
    );
    expect(saved.text).toBe("function f() {\n\treturn 1;\n}\n");
  });

  it("D1982: leaves a file .prettierignore names untouched", async () => {
    const saved = await formatSaved(
      {
        "project/.prettierignore": "skip.ts\n",
        "project/skip.ts": UNFORMATTED,
      },
      "project/skip.ts",
    );
    expect(saved.text).toBe(UNFORMATTED);
  });

  it("D2025: leaves a file .gitignore names untouched", async () => {
    const saved = await formatSaved(
      { "project/.gitignore": "skip.ts\n", "project/skip.ts": UNFORMATTED },
      "project/skip.ts",
    );
    expect(saved.text).toBe(UNFORMATTED);
  });

  it("D2023: leaves a file inside a .git folder untouched", async () => {
    const saved = await formatSaved(
      { "project/.git/a.ts": UNFORMATTED },
      "project/.git/a.ts",
    );
    expect(saved.text).toBe(UNFORMATTED);
  });

  it("D2028: leaves a file inside a nested .git folder untouched", async () => {
    const saved = await formatSaved(
      { "project/sub/.git/a.ts": UNFORMATTED },
      "project/sub/.git/a.ts",
    );
    expect(saved.text).toBe(UNFORMATTED);
  });

  it("D2029: skips a file prettier has no parser for, with no note", async () => {
    const saved = await formatSaved(
      { "project/notes.txt": "some  notes\n" },
      "project/notes.txt",
    );
    expect(saved.result).toEqual(
      expect.objectContaining({ status: "skipped", note: null }),
    );
  });

  it("D2024: leaves a file reached through a link out of the project untouched", async () => {
    const saved = await formatSaved(
      { "outside/a.ts": UNFORMATTED },
      "project/link/a.ts",
      (dir) =>
        symlinkSync(
          join(dir, "outside"),
          join(dir, PROJECT, "link"),
          "junction",
        ),
    );
    expect(saved.text).toBe(UNFORMATTED);
  });

  it("D1984: fails open on an unparseable file, keeping its text and naming it in the note", async () => {
    const saved = await formatSaved(
      { "project/bad.ts": UNPARSEABLE },
      "project/bad.ts",
    );
    expect(saved).toEqual({
      result: expect.objectContaining({
        status: "failed",
        note: expect.stringContaining("bad.ts"),
      }),
      text: UNPARSEABLE,
    });
  });

  it("D2027: keeps a save that lands while prettier runs, with a note naming the file", async () => {
    const actual = await vi.importActual<typeof import("prettier")>("prettier");
    vi.mocked(format).mockImplementationOnce(async (source, options) => {
      writeFileSync(String(options?.filepath), CONCURRENT_SAVE);
      return actual.format(source, options);
    });
    const saved = await formatSaved(
      { "project/a.ts": UNFORMATTED },
      "project/a.ts",
    ).finally(() => vi.mocked(format).mockReset());
    expect(saved).toEqual({
      result: expect.objectContaining({
        status: "skipped",
        note: expect.stringContaining("a.ts"),
      }),
      text: CONCURRENT_SAVE,
    });
  });

  it("D1983: prints nothing for a save outside the project", () => {
    const run = withTemp((dir) => {
      const root = join(dir, PROJECT);
      copyEntries(root);
      writeIn(dir, "outside.ts", UNFORMATTED);
      return runEntry(root, FORMAT_ENTRY, savePayload(join(dir, "outside.ts")));
    });
    expect({ status: run.status, stdout: run.stdout }).toEqual({
      status: 0,
      stdout: "",
    });
  });

  it("D2030: prints nothing for an empty payload", () => {
    const run = withTemp((root) => {
      copyEntries(root);
      return runEntry(root, FORMAT_ENTRY, "");
    });
    expect({ status: run.status, stdout: run.stdout }).toEqual({
      status: 0,
      stdout: "",
    });
  });

  it("D2026: exits 0 with a one-line note when the formatter cannot load", () => {
    const run = withTemp((root) => {
      cpSync(join(REPO, HOOKS), join(root, HOOKS), { recursive: true });
      writeIn(root, "a.ts", UNFORMATTED);
      return runEntry(root, FORMAT_ENTRY, savePayload(join(root, "a.ts")));
    });
    expect({ status: run.status, stdout: run.stdout }).toEqual({
      status: 0,
      stdout: expect.stringMatching(
        /^\{"hookSpecificOutput":\{"hookEventName":"PostToolUse","additionalContext":"The format-on-save hook failed, so the file stays as saved: [^\n]*"\}\}\n$/,
      ),
    });
  });
});

describe("run-lease hook", PROCESS_SCENARIO, () => {
  it("D2338: denies a bare heavy command, giving the queue sentence when no lease is held", () => {
    const run = runLeaseHook("Bash", "bun run check");
    expect({
      status: run.status,
      output: JSON.parse(run.stdout || "{}"),
    }).toEqual({
      status: 0,
      output: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            "To queue, run it as: node scripts/run-lease.mjs run --lane <group> --thread <threadId> -- bun run check",
        },
      },
    });
  });

  it("D2339: reads a PowerShell tool call with PowerShell's backtick escape", () => {
    const run = runLeaseHook("PowerShell", "echo a`;bun run check");
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
    }).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("D2340: fails open, exiting 0 with a note on stderr, when its modules cannot load", () => {
    const run = runLeaseHook("Bash", "bun run check", (root) =>
      cpSync(join(REPO, HOOKS), join(root, HOOKS), { recursive: true }),
    );
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
    }).toEqual({
      status: 0,
      stdout: "",
      stderr: expect.stringMatching(/^run-lease hook skipped: /),
    });
  });
});

describe("hook settings", () => {
  it("D2341: gates each Bash and PowerShell call through the run-lease hook, within a 10 s timeout", () => {
    const gates = hookCommands()
      .filter((hook) => entryOf(hook.command) === `${HOOKS}/${LEASE_ENTRY}`)
      .map(({ event, matcher, timeout }) => ({ event, matcher, timeout }));
    expect(gates).toEqual([
      { event: "PreToolUse", matcher: "Bash|PowerShell", timeout: 10 },
    ]);
  });

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

  it("D1986: formats each Edit and Write save, within a 10 s timeout", () => {
    const formatters = hookCommands()
      .filter((hook) => entryOf(hook.command) === `${HOOKS}/${FORMAT_ENTRY}`)
      .map(({ event, matcher, timeout }) => ({ event, matcher, timeout }));
    expect(formatters).toEqual([
      { event: "PostToolUse", matcher: "Edit|Write", timeout: 10 },
    ]);
  });

  it("D367: gives the Stop hook time to run every doc gate", () => {
    const [stop] = hookCommands().filter((hook) => hook.event === "Stop");
    const needed = GATES.length * GATE_TIMEOUT_MS + GIT_TIMEOUT_MS;
    expect((stop?.timeout ?? 0) * 1000).toBeGreaterThan(needed);
  });
});

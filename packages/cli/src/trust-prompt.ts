import { createInterface } from "node:readline/promises";
import type { StartPlan } from "@rt-test/daemon/client";
import type { CliIo } from "./command.js";
import { NOT_STARTED, oneLine, type Output } from "./output.js";

export type TrustDecision =
  | { readonly trusted: true }
  | { readonly trusted: false; readonly reason: string };

const YES_ANSWERS: ReadonlySet<string> = new Set(["y", "yes"]);
const DECLINED_REASON = `${NOT_STARTED} not trusted`;
const INDENT = "  ";
const COLUMN_GAP = 2;
const TRUST_FLAG_NOTE =
  "--trust applies only without a terminal, so the question is still asked.";
const EXECUTES_SENTENCE =
  "Starting executes each listed config file and everything it loads: its plugins, the further project configs it names (such as those in test.projects) and the modules it imports, none of which are listed here, and each workspace's globalSetup, setup files and test modules.";

/** What a start would execute, shown before the question and before the refusal for want of a terminal. */
export function listing(plan: StartPlan): string[] {
  const { consumerRoot, workspaces } = plan.start;
  const paths = workspaces.map((workspace) => oneLine(workspace.path));
  const width = Math.max(...paths.map((path) => path.length)) + COLUMN_GAP;
  return [
    `Consumer root: ${oneLine(consumerRoot)}`,
    `State directory: ${oneLine(plan.stateDirectory)}`,
    "Vitest workspaces, each with the config file the daemon will load for it:",
    ...workspaces.map(
      (workspace, index) =>
        `${INDENT}${(paths[index] ?? "").padEnd(width)}${oneLine(workspace.configFile)}`,
    ),
    EXECUTES_SENTENCE,
    ...unreadWarnings(plan),
  ];
}

export function unreadWarnings(plan: StartPlan): string[] {
  return plan.notRead.map(
    (source) =>
      `warning: ${oneLine(source.source)} was not read: ${oneLine(source.reason)}`,
  );
}

/**
 * Trust for this one invocation: asked on a terminal every time, and otherwise only the `--trust` flag. Nothing is
 * read from or kept in a file or the environment.
 */
export async function decideTrust(
  io: CliIo,
  output: Output,
  plan: StartPlan,
  trustFlag: boolean,
): Promise<TrustDecision> {
  const root = oneLine(plan.start.consumerRoot);
  if (!(io.stdinIsTerminal && io.stderrIsTerminal)) {
    return trustFlag
      ? { trusted: true }
      : {
          trusted: false,
          reason: `${NOT_STARTED} no terminal to ask on, so ${root} is not trusted. Review the configs listed above, then pass --trust to start it.`,
        };
  }
  if (trustFlag) output.note(TRUST_FLAG_NOTE);
  const answer = await ask(
    io,
    `Start RT Test for ${root} and execute the configs above? [y/N] `,
  );
  if (answer === undefined) output.note("");
  return answer !== undefined && YES_ANSWERS.has(answer.trim().toLowerCase())
    ? { trusted: true }
    : { trusted: false, reason: DECLINED_REASON };
}

/**
 * Undefined when the input ended or the user pressed Ctrl-C or Ctrl-D: the interface closes then, and the pending
 * question never settles.
 */
async function ask(io: CliIo, question: string): Promise<string | undefined> {
  const prompt = createInterface({
    input: io.stdin,
    output: io.stderr,
    terminal: true,
  });
  const closed = new Promise<undefined>((settle) => {
    prompt.once("close", () => settle(undefined));
  });
  prompt.on("SIGINT", () => prompt.close());
  try {
    return await Promise.race([prompt.question(question), closed]);
  } finally {
    prompt.close();
  }
}

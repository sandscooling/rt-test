import { statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { ASSIGNMENT, scanSegments, SHELL } from "./shell-segments.mjs";

// A heavy run is one that loads the whole machine: the repo-wide check, the full suite, the named-defect
// checker, or a Vitest run not narrowed to named test files. The run-lease wrapper is how one takes its turn.

export { SHELL };

const HEAVY_SCRIPTS = new Set([
  "check",
  "test:defects",
  "test:defects:changed",
]);
const VITEST_SCRIPTS = new Map([
  ["test:run", ["run"]],
  ["test", []],
  ["vitest", []],
]);
const RELATED = "related";
const VITEST_TARGETED_SUBCOMMANDS = new Set([
  "run",
  "watch",
  "dev",
  RELATED,
  "typecheck",
]);
const VITEST_OTHER_SUBCOMMANDS = new Set(["list", "bench", "init"]);
const VITEST_VALUE_FLAGS = new Set([
  "-c",
  "--config",
  "-r",
  "--root",
  "--dir",
  "--project",
  "--reporter",
  "--outputFile",
  "-t",
  "--testNamePattern",
  "--pool",
  "--environment",
  "--shard",
  "--maxWorkers",
  "--minWorkers",
  "--maxConcurrency",
  "--mode",
  "--exclude",
  "--testTimeout",
  "--hookTimeout",
  "--bail",
  "--retry",
]);
// A named test file: no glob character, a stem before `.test`/`.spec`, and an optional `:<line>` filter.
const TEST_FILE = /^[^*?[{]*[^*?[{/\\]\.(?:test|spec)\.[cm]?[jt]sx?(?::\d+)?$/;
const LEASE_ENTRY = "run-lease.mjs";
const LEASE_RUN = "run";
const DEFECTS_ENTRY = "verify-defects.mjs";
const VITEST_ENTRIES = new Set(["vitest.mjs", "vitest"]);
const NODE_RUN = "--run";
const NODE_VALUE_FLAGS = new Set([
  NODE_RUN,
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "-C",
  "--conditions",
  "--env-file",
  "--input-type",
]);
const NODE_INLINE_FLAGS = new Set(["-e", "--eval", "-p", "--print"]);
const BUN_VALUE_FLAGS = new Set(["--cwd", "-c", "--config", "--env-file"]);
const BUN_FILTER_FLAGS = ["--filter", "-F"];
// A workspace filter runs the workspaces' own scripts, spelled with a space or with `=`.
const isBunFilter = (word) =>
  BUN_FILTER_FLAGS.some((flag) => word === flag || word.startsWith(`${flag}=`));
const BUN_BUILTINS = new Set([
  "run",
  "x",
  "exec",
  "test",
  "install",
  "i",
  "add",
  "a",
  "remove",
  "rm",
  "update",
  "upgrade",
  "build",
  "init",
  "create",
  "pm",
  "link",
  "unlink",
  "repl",
  "outdated",
  "publish",
  "audit",
  "info",
  "patch",
  "why",
  "help",
]);
const PACKAGE_RUN_VERBS = new Set(["run", "run-script"]);
const PACKAGE_EXEC_VERBS = new Set(["exec", "x", "dlx"]);
const NPM_TEST_VERBS = new Set(["test", "t", "tst"]);
const SCRIPT_FILE = /[/\\]|\.[cm]?[jt]sx?$/;
const KEYWORDS = new Set([
  "do",
  "then",
  "else",
  "elif",
  "if",
  "while",
  "until",
  "!",
]);
const PS_VARIABLE = /^\$[\w:]+$/;
const PS_ASSIGN_OPERATOR = /^[-+*/%]?=$/;
const PS_JOINED_ASSIGNMENT = /^\$[\w:]+[-+*/%]?=(.+)$/;
// A prefix command, the options that take a value, and how many plain arguments it takes before the command.
const PREFIX_COMMANDS = new Map([
  ["env", { values: new Set(["-u", "--unset", "-C", "--chdir"]), skip: 0 }],
  ["time", { values: new Set(["-f", "-o"]), skip: 0 }],
  ["exec", { values: new Set(["-a"]), skip: 0 }],
  ["nohup", { values: new Set(), skip: 0 }],
  ["sudo", { values: new Set(["-u", "-g", "-h", "-p", "-C", "-D"]), skip: 0 }],
  ["command", { values: new Set(), skip: 0 }],
  ["nice", { values: new Set(["-n", "--adjustment"]), skip: 0 }],
  [
    "timeout",
    { values: new Set(["-s", "--signal", "-k", "--kill-after"]), skip: 1 },
  ],
  [
    "xargs",
    {
      values: new Set(["-I", "-n", "-P", "-L", "-d", "-a", "-E", "-s"]),
      skip: 0,
    },
  ],
]);
const REDIRECT = /^(?:\d+|\*)?(?:[<>]|&>)/;
const BARE_REDIRECT = /^(?:\d+|\*)?(?:>>?|<|&>>?)$/;
const EXECUTABLE_SUFFIX = /\.(?:exe|cmd|bat|ps1)$/i;
const POSIX_SCRIPT_FLAG = /^-[a-z]*c[a-z]*$/;
const POSIX_SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
const POWERSHELLS = new Set(["pwsh", "powershell"]);
const POWERSHELL_SCRIPT_FLAGS = new Set(["-c", "-command"]);
const WSL_VALUE_FLAGS = new Set([
  "-d",
  "--distribution",
  "-u",
  "--user",
  "--cd",
]);
const WSL_EXEC_FLAGS = new Set(["-e", "--exec", "--"]);
const MAX_DEPTH = 4;

const VERDICT = Object.freeze({ HEAVY: "heavy", WRAPPED: "wrapped" });

function withoutRedirects(words) {
  const kept = [];
  for (let i = 0; i < words.length; i++) {
    if (!REDIRECT.test(words[i])) kept.push(words[i]);
    else if (BARE_REDIRECT.test(words[i])) i++;
  }
  return kept;
}

// Index of the first word after a run of options, where each option in `values` also takes the next word.
function afterOptions(words, from, values) {
  let i = from;
  while (i < words.length && words[i].startsWith("-") && words[i] !== "-") {
    i += values.has(words[i]) ? 2 : 1;
  }
  return i;
}

function skipPrefix(words, i) {
  if (ASSIGNMENT.test(words[i]) || KEYWORDS.has(words[i])) return i + 1;
  if (
    PS_VARIABLE.test(words[i] ?? "") &&
    PS_ASSIGN_OPERATOR.test(words[i + 1] ?? "")
  ) {
    return i + 2;
  }
  const prefix = PREFIX_COMMANDS.get(words[i]);
  if (!prefix) return i;
  return afterOptions(words, i + 1, prefix.values) + prefix.skip;
}

function commandStart(words) {
  let i = 0;
  for (
    let next = skipPrefix(words, i);
    next !== i;
    next = skipPrefix(words, i)
  ) {
    i = next;
  }
  const joined = PS_JOINED_ASSIGNMENT.exec(words[i] ?? "");
  return joined ? [joined[1], ...words.slice(i + 1)] : words.slice(i);
}

const programName = (word) =>
  basename(word.replaceAll("\\", "/"))
    .replace(EXECUTABLE_SUFFIX, "")
    .toLowerCase();

const isTestFile = (word, ctx) => TEST_FILE.test(word) || ctx.isFile(word);

function vitestTargets(args) {
  const [first] = args;
  if (first !== undefined && VITEST_OTHER_SUBCOMMANDS.has(first)) return null;
  const rest =
    first !== undefined && VITEST_TARGETED_SUBCOMMANDS.has(first)
      ? args.slice(1)
      : args;
  const targets = [];
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (VITEST_VALUE_FLAGS.has(word)) i++;
    else if (!word.startsWith("-")) targets.push(word);
  }
  return targets;
}

// `related` runs every test that depends on its targets, so only a test file named as one stays scoped there.
const scopedTarget = (subcommand, ctx) =>
  subcommand === RELATED
    ? (target) => TEST_FILE.test(target)
    : (target) => isTestFile(target, ctx);

// Heavy unless every target names a test file, since a directory, a source file or a filter runs all it matches.
function judgeVitest(args, ctx) {
  const targets = vitestTargets(args);
  if (targets === null) return null;
  const scoped =
    targets.length > 0 && targets.every(scopedTarget(args[0], ctx));
  return scoped ? null : VERDICT.HEAVY;
}

function judgePackageScript(script, rest, ctx) {
  if (HEAVY_SCRIPTS.has(script)) return VERDICT.HEAVY;
  const implied = VITEST_SCRIPTS.get(script);
  return implied ? judgeVitest([...implied, ...rest], ctx) : null;
}

function judgeRunner(args, ctx) {
  const at = afterOptions(args, 0, new Set());
  return args[at] === "vitest" ? judgeVitest(args.slice(at + 1), ctx) : null;
}

function judgeScriptFile(file, after, ctx) {
  const name = programName(file);
  if (name === LEASE_ENTRY && after[0] === LEASE_RUN) return VERDICT.WRAPPED;
  if (name === DEFECTS_ENTRY) return VERDICT.HEAVY;
  if (VITEST_ENTRIES.has(name)) return judgeVitest(after, ctx);
  return null;
}

const isNodeRun = (word) =>
  word === NODE_RUN || word.startsWith(`${NODE_RUN}=`);

function judgeNodeRun(args, flag, ctx) {
  const joined = args[flag] !== NODE_RUN;
  const script = joined
    ? args[flag].slice(NODE_RUN.length + 1)
    : args[flag + 1];
  if (script === undefined) return null;
  return judgePackageScript(
    script,
    args.slice(joined ? flag + 1 : flag + 2),
    ctx,
  );
}

function judgeNode(args, ctx) {
  if (args.some((word) => NODE_INLINE_FLAGS.has(word))) return null;
  const at = afterOptions(args, 0, NODE_VALUE_FLAGS);
  const run = args.slice(0, at).findIndex(isNodeRun);
  if (run !== -1) return judgeNodeRun(args, run, ctx);
  if (at >= args.length) return null;
  return judgeScriptFile(args[at], args.slice(at + 1), ctx);
}

const judgeBunTarget = (name, rest, ctx) =>
  SCRIPT_FILE.test(name)
    ? judgeScriptFile(name, rest, ctx)
    : judgePackageScript(name, rest, ctx);

function judgeBun(args, ctx) {
  if (args.some(isBunFilter)) return null;
  const at = afterOptions(args, 0, BUN_VALUE_FLAGS);
  const verb = args[at];
  if (verb === undefined) return null;
  if (verb === "x" || verb === "exec")
    return judgeRunner(args.slice(at + 1), ctx);
  if (verb === "run") {
    const script = afterOptions(args, at + 1, BUN_VALUE_FLAGS);
    return args[script] === undefined
      ? null
      : judgeBunTarget(args[script], args.slice(script + 1), ctx);
  }
  if (BUN_BUILTINS.has(verb)) return null;
  return judgeBunTarget(verb, args.slice(at + 1), ctx);
}

// npm runs only `run` and `test` scripts by name; pnpm and yarn also run any other word as a script.
function judgePackageManager(args, ctx, anyWordIsScript) {
  const at = afterOptions(args, 0, new Set());
  const verb = args[at];
  if (verb === undefined) return null;
  const rest = args.slice(at + 1);
  if (PACKAGE_RUN_VERBS.has(verb)) {
    const script = afterOptions(rest, 0, new Set());
    return rest[script] === undefined
      ? null
      : judgePackageScript(rest[script], rest.slice(script + 1), ctx);
  }
  if (PACKAGE_EXEC_VERBS.has(verb)) return judgeRunner(rest, ctx);
  if (NPM_TEST_VERBS.has(verb)) return judgePackageScript("test", rest, ctx);
  return anyWordIsScript ? judgePackageScript(verb, rest, ctx) : null;
}

function judgeScript(script, shell, ctx) {
  return heavySegments(script, { ...ctx, shell }, ctx.depth + 1).length > 0
    ? VERDICT.HEAVY
    : null;
}

function judgePosixShell(args, ctx) {
  const flag = args.findIndex((w) => POSIX_SCRIPT_FLAG.test(w));
  const script = flag === -1 ? undefined : args[flag + 1];
  return script === undefined ? null : judgeScript(script, SHELL.BASH, ctx);
}

function judgePowerShell(args, ctx) {
  const flag = args.findIndex((w) =>
    POWERSHELL_SCRIPT_FLAGS.has(w.toLowerCase()),
  );
  if (flag === -1 || flag + 1 >= args.length) return null;
  return judgeScript(args.slice(flag + 1).join(" "), SHELL.POWERSHELL, ctx);
}

function judgeWsl(args, ctx) {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    if (WSL_EXEC_FLAGS.has(args[i])) {
      i++;
      break;
    }
    i += WSL_VALUE_FLAGS.has(args[i]) ? 2 : 1;
  }
  return judgeWords(args.slice(i), ctx);
}

function judgeCmd(args, ctx) {
  const flag = args.findIndex((w) => w.toLowerCase() === "/c");
  if (flag === -1) return null;
  return judgeScript(args.slice(flag + 1).join(" "), SHELL.BASH, ctx);
}

const judgeInvokeExpression = (args, ctx) =>
  judgeScript(args.join(" "), SHELL.POWERSHELL, ctx);

const JUDGES = new Map([
  ["node", judgeNode],
  ["bun", judgeBun],
  ["bunx", judgeRunner],
  ["npx", judgeRunner],
  ["npm", (args, ctx) => judgePackageManager(args, ctx, false)],
  ["pnpm", (args, ctx) => judgePackageManager(args, ctx, true)],
  ["yarn", (args, ctx) => judgePackageManager(args, ctx, true)],
  ["vitest", judgeVitest],
  ["wsl", judgeWsl],
  ["cmd", judgeCmd],
  ["eval", (args, ctx) => judgeScript(args.join(" "), SHELL.BASH, ctx)],
  ["iex", judgeInvokeExpression],
  ["invoke-expression", judgeInvokeExpression],
  ...[...POSIX_SHELLS].map((name) => [name, judgePosixShell]),
  ...[...POWERSHELLS].map((name) => [name, judgePowerShell]),
]);

function judgeWords(words, ctx) {
  const [program, ...args] = commandStart(withoutRedirects(words));
  if (program === undefined) return null;
  const judge = JUDGES.get(programName(program));
  return judge ? judge(args, ctx) : null;
}

function heavySegments(command, ctx, depth) {
  if (depth > MAX_DEPTH) {
    throw new Error(
      `command nests shells more than ${MAX_DEPTH} deep: ${command}`,
    );
  }
  const inner = { ...ctx, depth };
  return scanSegments(command, ctx.shell).flatMap((segment) => [
    ...(judgeWords(segment.words, inner) === VERDICT.HEAVY
      ? [segment.text]
      : []),
    ...segment.substitutions.flatMap((body) =>
      heavySegments(body, ctx, depth + 1),
    ),
  ]);
}

function fileProbe(cwd) {
  return (target) =>
    statSync(resolve(cwd, target), { throwIfNoEntry: false })?.isFile() ??
    false;
}

/**
 * The segments of a command line that start a heavy run without the run-lease wrapper, each as written.
 * A segment run through `run-lease.mjs run` is taking its turn, so it is never returned.
 */
export function unleasedHeavyRuns(
  command,
  { cwd = process.cwd(), isFile, shell = SHELL.BASH } = {},
) {
  return heavySegments(command, { isFile: isFile ?? fileProbe(cwd), shell }, 0);
}

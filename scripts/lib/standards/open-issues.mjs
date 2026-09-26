import { execFileSync } from "node:child_process";
import { result } from "./result.mjs";

const DEFAULT_CAP = 1000;
const USAGE =
  'Usage: list-open-issues.mjs [--search "<query>"] [--label <name>]... [--json] [--cap <n>]';

const EXIT = { OK: 0, TRUNCATED: 1, FAILED: 2 };
const VALUE_FLAGS = new Set(["--search", "--label", "--cap"]);
const ISSUE_FIELDS = "number,title,labels,updatedAt";

class UsageError extends Error {}

function runProcess(file, args) {
  return execFileSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function readValue(argv, index) {
  const value = argv[index + 1];
  if (value === undefined) throw new UsageError(`${argv[index]} needs a value`);
  return value;
}

function applyValue(options, flag, value) {
  if (flag === "--search") options.search = value;
  else if (flag === "--label") options.labels.push(value);
  else options.cap = Number(value);
}

function parseArgs(argv) {
  const options = {
    search: undefined,
    labels: [],
    json: false,
    cap: DEFAULT_CAP,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") {
      options.json = true;
    } else if (VALUE_FLAGS.has(flag)) {
      applyValue(options, flag, readValue(argv, index));
      index += 1;
    } else {
      throw new UsageError(`unknown argument ${flag}`);
    }
  }
  if (!Number.isInteger(options.cap) || options.cap < 1) {
    throw new UsageError("--cap must be a positive integer");
  }
  return options;
}

function skipReason(run) {
  let remotes;
  try {
    remotes = run("git", ["remote", "-v"]);
  } catch {
    return "not a git repository, so no GitHub remote could be resolved.";
  }
  if (!/github\.com/i.test(remotes)) {
    return "no GitHub remote on this repository, so there are no issues to read.";
  }
  try {
    run("gh", ["auth", "status"]);
  } catch {
    return "`gh auth status` did not exit 0, so the open issues could not be read.";
  }
  return undefined;
}

function ghArgs(options) {
  const args = [
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    String(options.cap),
  ];
  args.push("--json", ISSUE_FIELDS);
  if (options.search !== undefined) args.push("--search", options.search);
  for (const label of options.labels) args.push("--label", label);
  return args;
}

function fetchIssues(run, options) {
  const raw = run("gh", ghArgs(options));
  const issues = JSON.parse(raw);
  if (!Array.isArray(issues)) throw new Error("gh returned a non-array result");
  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    labels: (issue.labels ?? []).map((label) => label.name),
    updatedAt: issue.updatedAt,
  }));
}

function headline(issues, options, truncated) {
  const scope = [
    options.search === undefined ? undefined : `search "${options.search}"`,
    ...options.labels.map((label) => `label ${label}`),
  ].filter((part) => part !== undefined);
  const noun = issues.length === 1 ? "issue" : "issues";
  const within = scope.length === 0 ? "" : ` (${scope.join(", ")})`;
  return `${issues.length} open ${noun}${within}${truncated ? "" : ", complete"}`;
}

function truncationNotice(options) {
  const lost =
    options.search === undefined
      ? "Results are newest first, so what is missing is the OLDEST issues."
      : "Results are best-match first, so what is missing is whatever GitHub ranked lowest.";
  return [
    `TRUNCATED: the result filled the cap of ${options.cap}, so open issues exist that are NOT listed.`,
    lost,
    `Re-run with a higher --cap (for example --cap ${options.cap * 2}), or narrow with --search or --label.`,
  ];
}

function render(issues, options) {
  if (options.json) return [JSON.stringify(issues, null, 2)];
  return issues.map(
    (issue) => `${issue.number}\t${issue.title}\t${issue.labels.join(",")}`,
  );
}

export function listOpenIssues(argv, run = runProcess) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    return result(
      EXIT.FAILED,
      [],
      [`list-open-issues: ${error.message}`, USAGE],
    );
  }
  const skip = skipReason(run);
  if (skip !== undefined) return result(EXIT.OK, [`SKIP: ${skip}`]);
  let issues;
  try {
    issues = fetchIssues(run, options);
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    return result(EXIT.FAILED, [], ["`gh issue list` failed:", detail]);
  }
  const truncated = issues.length >= options.cap;
  const out = [
    headline(issues, options, truncated),
    ...render(issues, options),
  ];
  if (!truncated) return result(EXIT.OK, out);
  return result(EXIT.TRUNCATED, out, truncationNotice(options));
}

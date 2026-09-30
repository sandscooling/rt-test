import { createHash } from "node:crypto";
import { DIGEST_ALGORITHM, DIGEST_ENCODING } from "./input-inventory.js";

const PREFIX_MARK = "*";
const ASSIGNMENT = "=";
const NUL = "\u0000";
const ENTRY_SEPARATOR = "\n";
const BY_VALUE = "value";
const BY_PRESENCE = "set";

/** Windows looks a variable up whatever its case, and one shell spells `Path` where another spells `PATH`. */
const FOLDS_CASE = process.platform === "win32";
/** Node copies it from the live environment into a child's unless the child's environment holds it as an own key. */
const CARRIED_VARIABLE = "NODE_V8_COVERAGE";

/** The daemon's environment as it began serving: the digest counts it, and every executor process starts with it. */
export type StartEnvironment = Readonly<NodeJS.ProcessEnv>;

/** The daemon's one read of its whole environment for the digest and the executor processes, taken as it begins serving. */
export function takeStartEnvironment(): StartEnvironment {
  return Object.freeze({ ...process.env });
}

/**
 * A fresh environment for one executor process, holding every variable of `start`. Node writes into the object it is
 * given, and carries the live `NODE_V8_COVERAGE` into it unless that is an own key, so the key holds what the child
 * would see from `start` alone.
 */
export function executorEnvironment(
  start: StartEnvironment,
): NodeJS.ProcessEnv {
  return { ...start, [CARRIED_VARIABLE]: carriedValue(start) };
}

/**
 * On Windows, the value under the first name in sort order among those that fold to the carried one, the name Node
 * keeps; the all-upper-case spelling sorts before every other, so Node keeps the key added in its place.
 */
function carriedValue(start: StartEnvironment): string | undefined {
  const carried = comparable(CARRIED_VARIABLE);
  const [kept] = Object.keys(start)
    .filter((name) => comparable(name) === carried)
    .sort();
  return kept === undefined ? undefined : start[kept];
}

/**
 * Each entry names state a shell, terminal, editor, agent or login keeps for one session or process, such as its id.
 * Vitest, Vite and std-env read none's value, at most whether one is set and non-empty, though Vite's `.env`
 * expansion and `envPrefix` can carry one to a test. An entry ending in `*` names every variable it begins.
 */
export const SESSION_VARIABLES: readonly string[] = [
  "_",
  "PWD",
  "OLDPWD",
  "SHLVL",
  "SESSIONNAME",
  "EFC_*",
  "WT_SESSION",
  "WT_PROFILE_ID",
  "TERM_SESSION_ID",
  "ITERM_SESSION_ID",
  "WINDOWID",
  "TMUX",
  "TMUX_PANE",
  "STY",
  "KITTY_WINDOW_ID",
  "KITTY_PID",
  "ALACRITTY_WINDOW_ID",
  "WEZTERM_PANE",
  "VSCODE_*",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_PID",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SSE_PORT",
  "CODEX_THREAD_ID",
  "CURSOR_TRACE_ID",
  "STARSHIP_SESSION_KEY",
  "POSH_SESSION_ID",
  "POSH_PID",
  "SSH_CLIENT",
  "SSH_CONNECTION",
  "SSH_TTY",
  "XDG_SESSION_ID",
];

/** How the environment enters a fingerprint: every variable by value, except those an entry names. */
export interface EnvironmentCount {
  readonly digest: string;
  /** Sorted, spelled as the digest compares them. */
  readonly byValue: readonly string[];
  /** The entries of `SESSION_VARIABLES` that name a variable set now; each counts only as set. */
  readonly sessionEntriesSet: readonly string[];
}

/**
 * Counts `environment` with the session entries and the `declared` ones: a variable an entry names leaves the digest,
 * and in its place the entry counts once as set, with whether any variable it names is non-empty. So a session's own
 * identifier moves nothing, while its presence and every other variable's value still do.
 */
export function countEnvironment(
  environment: NodeJS.ProcessEnv,
  declared: readonly string[],
): EnvironmentCount {
  const session = SESSION_VARIABLES.map(comparable);
  const entries = [...new Set([...session, ...declared.map(comparable)])];
  /** Names Windows keeps apart can fold to one key, so each key keeps every value. */
  const values = new Map<string, Set<string>>();
  const set = new Set<string>();
  const nonEmpty = new Set<string>();
  for (const [name, value] of Object.entries(environment)) {
    const key = comparable(name);
    const naming = entries.filter((entry) => names(entry, key));
    const held = value ?? "";
    if (naming.length === 0) {
      values.set(key, (values.get(key) ?? new Set<string>()).add(held));
    }
    for (const entry of naming) set.add(entry);
    if (held !== "") for (const entry of naming) nonEmpty.add(entry);
  }
  const lines = [
    ...[...values].map(([name, held]) => [BY_VALUE, name, ...[...held].sort()]),
    ...[...set].map((entry) => [BY_PRESENCE, entry, nonEmpty.has(entry)]),
  ].map((line) => JSON.stringify(line));
  const hash = createHash(DIGEST_ALGORITHM);
  for (const line of lines.sort()) hash.update(`${line}${ENTRY_SEPARATOR}`);
  return {
    digest: hash.digest(DIGEST_ENCODING),
    byValue: [...values.keys()].sort(),
    sessionEntriesSet: session.filter((entry) => set.has(entry)),
  };
}

/** Why a declared entry cannot be used; undefined when it names a variable, or a non-empty prefix ending in `*`. */
export function variableEntryProblem(entry: string): string | undefined {
  if (entry === "") return "is empty";
  if (entry.trim() !== entry) return "begins or ends with whitespace";
  if (entry.includes(ASSIGNMENT)) return `contains ${ASSIGNMENT}`;
  if (entry.includes(NUL)) return "contains a NUL character";
  const mark = entry.indexOf(PREFIX_MARK);
  if (mark === -1) return undefined;
  if (mark !== entry.length - 1) {
    return `holds ${PREFIX_MARK} other than as its last character`;
  }
  return mark === 0
    ? `is ${PREFIX_MARK} alone, which would leave every variable's value out`
    : undefined;
}

function comparable(name: string): string {
  return FOLDS_CASE ? name.toUpperCase() : name;
}

function names(entry: string, name: string): boolean {
  return entry.endsWith(PREFIX_MARK)
    ? name.startsWith(entry.slice(0, -PREFIX_MARK.length))
    : name === entry;
}

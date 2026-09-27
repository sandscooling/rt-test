import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

// Pinned, not detected: hook payloads carry no model, and a 1M-context model records the same
// model name as its 200k variant. Change it by hand if the session model changes.
const CONTEXT_WINDOW = 1_000_000;
const HANDOFF_PERCENT = 60;
const HANDOFF_DOC = "_agent-docs/handoff.md";
const ORCHESTRATOR_STATE = "_agent-docs/.scratch/orchestrator-state.md";

const ORCHESTRATOR_HANDOFF_PERCENT = 75;
const LOWEST_HANDOFF_PERCENT = Math.min(
  HANDOFF_PERCENT,
  ORCHESTRATOR_HANDOFF_PERCENT,
);
const SESSION_LIST_TOOL = "mcp__t3-code__session_list";
const ORCHESTRATOR_GROUP = "orchestrator";
const TAIL_BYTES = 1024 * 1024;
const STALE_CACHE_MS = 24 * 60 * 60 * 1000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n) => String(n).padStart(2, "0");

function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${DAYS[d.getDay()]}`;
}

const clock = (now) => `[${stamp(now)}]`;

function resetAt(value) {
  if (value == null) return "";
  const d =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${pad(d.getMinutes())}${ampm} ${DAYS[d.getDay()]}`;
}

function compact(n) {
  if (n >= 1_000_000) {
    const digits = n % 1_000_000 === 0 ? 0 : 1;
    return `${+(n / 1_000_000).toFixed(digits)}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function lastUsage(text) {
  const lines = text.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    // A sidechain entry is a subagent's own window, not this session's.
    if (entry.isSidechain === true) continue;
    const u = entry.message?.usage;
    if (!u) continue;
    return (
      (u.input_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0) +
      (u.output_tokens || 0)
    );
  }
  return null;
}

function readTail(file) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
  } finally {
    closeSync(fd);
  }
}

export function usedTokens(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  try {
    return (
      lastUsage(readTail(transcriptPath)) ??
      lastUsage(readFileSync(transcriptPath, "utf8"))
    );
  } catch {
    return null;
  }
}

export function formatContext(used, max = CONTEXT_WINDOW) {
  return `ctx ${compact(used)}/${compact(max)} (${Math.round((used / max) * 100)}%)`;
}

export function limitsFromCache(home, now = Date.now()) {
  const file = join(home, ".claude", ".usage-cache.json");
  try {
    if (now - statSync(file).mtimeMs > STALE_CACHE_MS) return null;
    const data = JSON.parse(readFileSync(file, "utf8"));
    const window = (w) =>
      w && { used_percentage: w.utilization, resets_at: w.resets_at };
    return {
      five_hour: window(data.five_hour),
      seven_day: window(data.seven_day),
    };
  } catch {
    return null;
  }
}

function rateLimitParts(limits) {
  if (!limits) return [];
  const part = (label, win) => {
    if (!win || win.used_percentage == null) return null;
    const reset = resetAt(win.resets_at);
    const suffix = reset ? ` (resets ${reset})` : "";
    return `${label} ${Math.round(win.used_percentage)}%${suffix}`;
  };
  return [part("5h", limits.five_hour), part("7d", limits.seven_day)].filter(
    Boolean,
  );
}

function contextPart(payload) {
  const cw = payload.context_window;
  if (cw && cw.used_percentage != null) {
    const max = cw.max_tokens || cw.total_tokens;
    return cw.used_tokens != null && max
      ? formatContext(cw.used_tokens, max)
      : `ctx ${Math.round(cw.used_percentage)}%`;
  }
  const used = usedTokens(payload.transcript_path);
  return used == null ? null : formatContext(used);
}

export function promptHeader(payload, { now = new Date(), home }) {
  const parts = [clock(now), contextPart(payload)];
  const limits = payload.rate_limits || limitsFromCache(home, now.getTime());
  return [...parts, ...rateLimitParts(limits)].filter(Boolean).join(" | ");
}

export function postToolContext(payload, { now = new Date() } = {}) {
  return [clock(now), handoffWarning(payload)].filter(Boolean).join(" ");
}

function parseEntry(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

const blocksOf = (entry) =>
  Array.isArray(entry?.message?.content) ? entry.message.content : [];

function resultText(block) {
  if (typeof block.content === "string") return block.content;
  if (!Array.isArray(block.content)) return "";
  return block.content.map((part) => part.text ?? "").join("");
}

function selfRow(block) {
  try {
    const rows = JSON.parse(resultText(block))?.sessions;
    return Array.isArray(rows) ? rows.find((row) => row?.self === true) : null;
  } catch {
    return null;
  }
}

function recordListCalls(entry, callIds) {
  for (const block of blocksOf(entry)) {
    if (block.type === "tool_use" && block.name === SESSION_LIST_TOOL) {
      callIds.add(block.id);
    }
  }
}

// A group-filtered list omits the self row, so it leaves the previous one standing.
function latestSelfRow(entry, pendingIds, previous) {
  let row = previous;
  for (const block of blocksOf(entry)) {
    if (block.type !== "tool_result" || !pendingIds.has(block.tool_use_id)) {
      continue;
    }
    pendingIds.delete(block.tool_use_id);
    row = selfRow(block) ?? row;
  }
  return row;
}

function mentionsAny(line, ids) {
  for (const id of ids) if (line.includes(id)) return true;
  return false;
}

const isOrchestratorGroup = (group) =>
  group === null || group === ORCHESTRATOR_GROUP;

// Only a real session_list call's result counts, so a command that prints another session's list cannot
// pass for this session's own. A session that never listed itself is not the orchestrator.
function isOrchestratorTranscript(text) {
  const pendingIds = new Set();
  let row = null;
  for (const line of text.split("\n")) {
    const names = line.includes(SESSION_LIST_TOOL);
    const answers = mentionsAny(line, pendingIds);
    if (!names && !answers) continue;
    const entry = parseEntry(line);
    if (names) recordListCalls(entry, pendingIds);
    if (answers) row = latestSelfRow(entry, pendingIds, row);
  }
  return row != null && isOrchestratorGroup(row.group);
}

function isOrchestrator(transcriptPath) {
  try {
    return isOrchestratorTranscript(readFileSync(transcriptPath, "utf8"));
  } catch {
    return false;
  }
}

function handoffThreshold(transcriptPath) {
  return isOrchestrator(transcriptPath)
    ? {
        percent: ORCHESTRATOR_HANDOFF_PERCENT,
        label: `orchestrator's ${ORCHESTRATOR_HANDOFF_PERCENT}%`,
      }
    : { percent: HANDOFF_PERCENT, label: `${HANDOFF_PERCENT}%` };
}

function handoffWarning(payload) {
  // A subagent's call carries the parent's transcript, and a subagent cannot hand the parent off.
  if (payload.agent_id) return null;
  const used = usedTokens(payload.transcript_path);
  if (used == null) return null;
  const percent = (used / CONTEXT_WINDOW) * 100;
  // Below the lowest line no session is warned, so the whole transcript is read only past it.
  if (percent < LOWEST_HANDOFF_PERCENT) return null;
  const threshold = handoffThreshold(payload.transcript_path);
  if (percent < threshold.percent) return null;
  return (
    `${formatContext(used)}: past the ${threshold.label} handoff line. Finish the tool call in hand, ` +
    `start nothing new, and hand off to a successor by ${HANDOFF_DOC} (the /handoff skill). Never let the context compact.`
  );
}

export function compactReminder() {
  return (
    "You were just compacted, which this repository never allows. Compaction keeps state and drops " +
    `procedure, so hand off to a successor now by ${HANDOFF_DOC} (the /handoff skill), stating exactly ` +
    "where the work stands. Before that handoff, re-read the SKILL.md of any skill you are running. " +
    `An orchestrator also re-reads ${ORCHESTRATOR_STATE}.`
  );
}

export function ownTranscriptPath(home, sessionId) {
  if (!sessionId) return null;
  const root = join(home, ".claude", "projects");
  let dirs;
  try {
    dirs = readdirSync(root);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const candidate = join(root, dir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

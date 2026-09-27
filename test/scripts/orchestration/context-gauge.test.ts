import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compactReminder,
  lastUsage,
  limitsFromCache,
  postToolContext,
  promptHeader,
} from "../../../scripts/lib/orchestration/context-gauge.mjs";
import { CLOCK_ONLY, withTemp, writeIn } from "./harness.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// Local time, so the stamp reads the same in every time zone.
const CALL_TIME = new Date(2026, 8, 27, 12, 52);

const usageLine = (tokens: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...extra, message: { usage: { input_tokens: tokens } } });

const SESSION_LIST = "mcp__t3-code__session_list";
const LIST_ID = "toolu_list";
const ORCHESTRATOR_ROW = { name: "Orchestrator", group: "orchestrator" };

const toolCalls = (...calls: [id: string, name: string][]) =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: calls.map(([id, name]) => ({
        type: "tool_use",
        id,
        name,
        input: {},
      })),
    },
  });

const toolResults = (...results: [id: string, content: unknown][]) =>
  JSON.stringify({
    type: "user",
    message: {
      content: results.map(([id, content]) => ({
        tool_use_id: id,
        type: "tool_result",
        content,
      })),
    },
  });

const sessionsJson = (...rows: Record<string, unknown>[]) =>
  JSON.stringify({ sessions: rows });

const selfRow = (fields: Record<string, unknown>) => ({
  ...fields,
  name: "me",
  self: true,
});

// The session's own session_list call and its answer, with the orchestrator's row beside its own.
const listedAs = (self: Record<string, unknown>) => [
  toolCalls([LIST_ID, SESSION_LIST]),
  toolResults([
    LIST_ID,
    sessionsJson({ ...ORCHESTRATOR_ROW, self: false }, selfRow(self)),
  ]),
];

function withTranscript<T>(lines: string[], run: (path: string) => T): T {
  return withTemp((dir) => {
    writeIn(dir, "session.jsonl", `${lines.join("\n")}\n`);
    return run(join(dir, "session.jsonl"));
  });
}

describe("context gauge", () => {
  it("D340: skips a subagent's sidechain usage when reading the session's context", () => {
    expect(
      lastUsage(
        [usageLine(100), usageLine(900, { isSidechain: true })].join("\n"),
      ),
    ).toBe(100);
  });

  it("D341: counts input, cache creation, cache read, and output tokens", () => {
    const usage = {
      input_tokens: 1,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 300,
      output_tokens: 4000,
    };
    expect(lastUsage(JSON.stringify({ message: { usage } }))).toBe(4321);
  });

  it("D1925: stamps the local time on a tool call below the handoff line", () => {
    const context = withTranscript([usageLine(599_999)], (path) =>
      postToolContext({ transcript_path: path }),
    );
    expect(context).toMatch(CLOCK_ONLY);
  });

  it("D1926: stamps the time of the call in the prompt header's format", () => {
    const context = withTranscript([usageLine(1000)], (path) =>
      postToolContext({ transcript_path: path }, { now: CALL_TIME }),
    );
    expect(context).toBe("[2026-09-27 12:52 Sun]");
  });

  it("D1927: gives a subagent's tool call past the line the stamp without the handoff warning", () => {
    const context = withTranscript([usageLine(900_000)], (path) =>
      postToolContext(
        { transcript_path: path, agent_id: "agent-1" },
        { now: CALL_TIME },
      ),
    );
    expect(context).toBe("[2026-09-27 12:52 Sun]");
  });

  it("D1929: follows the stamp with the handoff warning once the session reaches 60% of its context", () => {
    const context = withTranscript([usageLine(600_000)], (path) =>
      postToolContext({ transcript_path: path }, { now: CALL_TIME }),
    );
    expect(context).toMatch(
      /^\[2026-09-27 12:52 Sun\] ctx 600k\/1M \(60%\): past the 60% handoff line\. /,
    );
  });

  it("D2032: gives the orchestrator just below 75% of its context the stamp without the handoff warning", () => {
    const lines = [...listedAs({ group: "orchestrator" }), usageLine(749_999)];
    const context = withTranscript(lines, (path) =>
      postToolContext({ transcript_path: path }, { now: CALL_TIME }),
    );
    expect(context).toBe("[2026-09-27 12:52 Sun]");
  });

  it("D2033: warns the orchestrator at 75% of its context with the orchestrator's 75% handoff line", () => {
    const lines = [...listedAs({ group: "orchestrator" }), usageLine(750_000)];
    const context = withTranscript(lines, (path) =>
      postToolContext({ transcript_path: path }, { now: CALL_TIME }),
    );
    expect(context).toMatch(
      /^\[2026-09-27 12:52 Sun\] ctx 750k\/1M \(75%\): past the orchestrator's 75% handoff line\. /,
    );
  });

  it("D2034: warns a lane member at 60% of its context with the 60% handoff line", () => {
    const lines = [
      ...listedAs({ group: "gauge-orchestrator-line" }),
      usageLine(600_000),
    ];
    const context = withTranscript(lines, (path) =>
      postToolContext({ transcript_path: path }, { now: CALL_TIME }),
    );
    expect(context).toMatch(
      /^\[2026-09-27 12:52 Sun\] ctx 600k\/1M \(60%\): past the 60% handoff line\. /,
    );
  });

  it("D2035: treats a session whose own row has a null group as the orchestrator, unwarned below 75%", () => {
    const lines = [...listedAs({ group: null }), usageLine(749_999)];
    const context = withTranscript(lines, (path) =>
      postToolContext({ transcript_path: path }, { now: CALL_TIME }),
    );
    expect(context).toBe("[2026-09-27 12:52 Sun]");
  });

  it("D2038: warns a session whose own row lacks a group key from the 60% handoff line", () => {
    const lines = [...listedAs({}), usageLine(650_000)];
    const context = withTranscript(lines, (path) =>
      postToolContext({ transcript_path: path }, { now: CALL_TIME }),
    );
    expect(context).toMatch(
      /^\[2026-09-27 12:52 Sun\] ctx 650k\/1M \(65%\): past the 60% handoff line\. /,
    );
  });

  it("D2036: keeps a lane member on the 60% line when a Bash result naming its pending session_list echoes an orchestrator's list", () => {
    const echo = JSON.stringify({
      tool_use_id: "toolu_filtered",
      sessions: [selfRow({ group: "orchestrator" })],
    });
    const lines = [
      ...listedAs({ group: "gauge-orchestrator-line" }),
      toolCalls(["toolu_filtered", SESSION_LIST]),
      toolCalls(["toolu_bash", "Bash"]),
      toolResults(["toolu_bash", echo]),
      toolResults([
        "toolu_filtered",
        sessionsJson({ name: "rt-other-dev", group: "other", self: false }),
      ]),
      usageLine(650_000),
    ];
    const context = withTranscript(lines, (path) =>
      postToolContext({ transcript_path: path }, { now: CALL_TIME }),
    );
    expect(context).toMatch(
      /^\[2026-09-27 12:52 Sun\] ctx 650k\/1M \(65%\): past the 60% handoff line\. /,
    );
  });

  it("D2037: keeps the orchestrator unwarned below 75% after a group-filtered session_list with no self row", () => {
    const lines = [
      ...listedAs({ group: "orchestrator" }),
      toolCalls(["toolu_filtered", SESSION_LIST]),
      toolResults([
        "toolu_filtered",
        sessionsJson({ name: "rt-other-dev", group: "other", self: false }),
      ]),
      usageLine(700_000),
    ];
    const context = withTranscript(lines, (path) =>
      postToolContext({ transcript_path: path }, { now: CALL_TIME }),
    );
    expect(context).toBe("[2026-09-27 12:52 Sun]");
  });

  it("D2039: reads the orchestrator's self row from a session_list result written as an array of text parts", () => {
    const text = sessionsJson(selfRow({ group: "orchestrator" }));
    const lines = [
      toolCalls([LIST_ID, SESSION_LIST]),
      toolResults([LIST_ID, [{ type: "text", text }]]),
      usageLine(749_999),
    ];
    const context = withTranscript(lines, (path) =>
      postToolContext({ transcript_path: path }, { now: CALL_TIME }),
    );
    expect(context).toBe("[2026-09-27 12:52 Sun]");
  });

  it("D344: drops a rate-limit cache older than a day rather than report it as current", () => {
    const limits = withTemp((home) => {
      const cache = { five_hour: { utilization: 34 } };
      writeIn(home, ".claude/.usage-cache.json", JSON.stringify(cache));
      const written = statSync(join(home, ".claude/.usage-cache.json")).mtimeMs;
      return limitsFromCache(home, written + DAY_MS + 1);
    });
    expect(limits).toBeNull();
  });

  it("D345: tells a compacted session to hand off by the handoff doc", () => {
    expect(compactReminder()).toContain("_agent-docs/handoff.md");
  });

  it("D346: reads context use from the transcript when the payload omits it", () => {
    const header = withTranscript([usageLine(150_000)], (path) =>
      withTemp((home) =>
        promptHeader({ transcript_path: path }, { now: new Date(0), home }),
      ),
    );
    expect(header).toContain("ctx 150k/1M (15%)");
  });
});

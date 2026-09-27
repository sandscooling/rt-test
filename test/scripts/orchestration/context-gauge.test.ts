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

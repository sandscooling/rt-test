import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compactReminder,
  lastUsage,
  limitsFromCache,
  postToolWarning,
  promptHeader,
} from "../../../scripts/lib/orchestration/context-gauge.mjs";
import { withTemp, writeIn } from "./harness.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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

  it("D342: warns once the session reaches 60% of its context", () => {
    const warning = withTranscript([usageLine(600_000)], (path) =>
      postToolWarning({ transcript_path: path }),
    );
    expect(warning).not.toBeNull();
  });

  it("D343: stays silent for a subagent's tool call", () => {
    const warning = withTranscript([usageLine(900_000)], (path) =>
      postToolWarning({ transcript_path: path, agent_id: "agent-1" }),
    );
    expect(warning).toBeNull();
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

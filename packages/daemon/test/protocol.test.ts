import { describe, expect, it } from "vitest";
import { STOP_DEADLINE_MS } from "../src/client.js";
import { EXECUTOR_BOUND_MS } from "../src/daemon/executor-jobs.js";
import {
  LineDecoder,
  RESPONSE_BOUND_MS,
  type DecodedLine,
} from "../src/daemon/protocol.js";

/** The frozen line limit's floor, 1 MiB. */
const ONE_MIB = 1024 * 1024;
const LETTER_A = 0x61;

function decodeAll(chunks: readonly (string | Buffer)[]): DecodedLine[] {
  const decoder = new LineDecoder();
  return chunks.flatMap((chunk) =>
    decoder.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
  );
}

describe("splitting the byte stream into lines", () => {
  it("D1436: a line split across two chunks arrives once, whole", () => {
    expect(decodeAll(['{"a":', "1}\n"])).toStrictEqual([
      { tooLong: false, text: '{"a":1}' },
    ]);
  });

  it("D1437: a character whose UTF-8 bytes are split across two chunks decodes intact", () => {
    const bytes = Buffer.from('{"name":"é"}\n');
    const split = bytes.indexOf(Buffer.from("é")) + 1;
    expect(
      decodeAll([bytes.subarray(0, split), bytes.subarray(split)]),
    ).toStrictEqual([{ tooLong: false, text: '{"name":"é"}' }]);
  });

  it("D1438: a line past the limit is reported once, and the line after it decodes", () => {
    expect(
      decodeAll([Buffer.alloc(ONE_MIB + 1, LETTER_A), '\n{"b":1}\n']),
    ).toStrictEqual([{ tooLong: true }, { tooLong: false, text: '{"b":1}' }]);
  });

  it("D1439: a line of exactly 1 MiB is within the limit", () => {
    const lines = decodeAll([Buffer.alloc(ONE_MIB, LETTER_A), "\n"]);
    expect(lines.map((line) => line.tooLong)).toStrictEqual([false]);
  });
});

describe("the named bounds", () => {
  it("D1441: the daemon's response bound is 10 s, twice the store's 5 s busy timeout", () => {
    expect(RESPONSE_BOUND_MS).toBe(10_000);
  });

  it("D1442: the executor bound is Vitest's 10 s force-stop grace plus a 5 s margin", () => {
    expect(EXECUTOR_BOUND_MS).toBe(15_000);
  });

  it("D1443: the stop deadline covers the 15 s executor bound, one 5 s store wait and a 5 s margin", () => {
    expect(STOP_DEADLINE_MS).toBe(25_000);
  });
});

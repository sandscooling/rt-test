import { describe, expect, it } from "vitest";
import { countAnchor, replaceAnchor } from "../../src/falsify/anchor-match.js";

describe("counting a mutation's anchor", () => {
  it("D3604: occurrences are counted without overlap, as the defect catalog counts them", () => {
    expect(countAnchor("aaa", "aa")).toBe(1);
  });

  it("D3605: a line break in the anchor matches a CRLF line break in the text", () => {
    expect(countAnchor("  return a;\r\n}\r\n", "  return a;\n}")).toBe(1);
  });

  it("D3606: a CRLF line break in the anchor matches an LF line break in the text", () => {
    expect(countAnchor("  return a;\n}\n", "  return a;\r\n}")).toBe(1);
  });

  it("D3607: an anchor's regular-expression characters match only themselves", () => {
    expect(countAnchor("a.b(c) axb(c)", "a.b(c)")).toBe(1);
  });

  it("D3608: an anchor that occurs twice is not replaced, and the count says two", () => {
    expect(replaceAnchor("x = a;\ny = a;\n", "a;", "b;")).toEqual({
      applied: false,
      count: 2,
    });
  });
});

describe("replacing a mutation's anchor", () => {
  it("D3609: the replacement's line breaks take the CRLF ending the matched text used", () => {
    const replaced = replaceAnchor(
      "function f() {\r\n  return 1;\r\n}\r\n",
      "  return 1;\n}",
      "  const r = 2;\n  return r;\n}",
    );
    expect(replaced.applied ? replaced.text : replaced).toBe(
      "function f() {\r\n  const r = 2;\r\n  return r;\r\n}\r\n",
    );
  });

  it("D3610: a one-line match in a CRLF file writes a line break the replacement adds as CRLF", () => {
    const replaced = replaceAnchor(
      "let a = 1;\r\nlet b = 2;\r\n",
      "let a = 1;",
      "let a = 1;\nlet c = 3;",
    );
    expect(replaced.applied ? replaced.text : replaced).toBe(
      "let a = 1;\r\nlet c = 3;\r\nlet b = 2;\r\n",
    );
  });
});

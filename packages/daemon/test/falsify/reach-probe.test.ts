import { describe, expect, it } from "vitest";
import { mutateWithProbe } from "../../src/falsify/reach-probe.js";

const JS = "case.js";
const TS = "case.ts";

describe("placing a reach probe at the mutated site", () => {
  it("D3611: the probe wraps the smallest node enclosing the changed text, not the whole replaced text", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f(c, a, b) {\n  return c && a + b;\n}\n",
        "return c && a + b;",
        "return c && a - b;",
      ),
    ).toEqual({
      status: "mutated",
      text: "function f(c, a, b) {\n  return c && (globalThis.__rtTestReach?.(), a - b);\n}\n",
      site: { line: 2, column: 15, nodeKind: "BinaryExpression" },
    });
  });

  it("D3612: a change in a call's callee has no probe site, since wrapping a method reference loses its receiver", () => {
    expect(
      mutateWithProbe(JS, "const r = obj.run();\n", "obj.run", "alt.go"),
    ).toEqual({
      status: "no-probe-site",
      reason: {
        kind: "position",
        line: 1,
        column: 11,
        nodeKind: "MemberExpression",
        role: "CallExpression.callee",
      },
    });
  });

  it("D3613: a change under a TypeScript `as` is probed in the position the wrapper holds", () => {
    expect(
      mutateWithProbe(TS, "const n = (a + b) as number;\n", "a + b", "a - b"),
    ).toEqual({
      status: "mutated",
      text: "const n = ((globalThis.__rtTestReach?.(), a - b)) as number;\n",
      site: { line: 1, column: 12, nodeKind: "BinaryExpression" },
    });
  });

  it("D3614: a replaced statement in a block is probed by a statement placed before it", () => {
    expect(
      mutateWithProbe(
        JS,
        'function f() {\n  throw new Error("bad");\n}\n',
        'throw new Error("bad");',
        "return 0;",
      ),
    ).toEqual({
      status: "mutated",
      text: "function f() {\n  globalThis.__rtTestReach?.(); return 0;\n}\n",
      site: { line: 2, column: 3, nodeKind: "ReturnStatement" },
    });
  });

  it("D3615: a change to a hoisted function declaration has no probe site, since a probe before it fires when the module loads", () => {
    expect(
      mutateWithProbe(
        JS,
        "export const v = 1;\nfunction helper(a) {\n  return a;\n}\n",
        "helper(a)",
        "helper(a, b)",
      ),
    ).toEqual({
      status: "no-probe-site",
      reason: {
        kind: "position",
        line: 2,
        column: 1,
        nodeKind: "FunctionDeclaration",
        role: "Program.body",
      },
    });
  });

  it("D3616: a change to a `typeof` operand has no probe site, since wrapping an undeclared name throws", () => {
    expect(
      mutateWithProbe(
        JS,
        "const t = typeof maybeGlobal;\n",
        "maybeGlobal",
        "otherGlobal",
      ),
    ).toEqual({
      status: "no-probe-site",
      reason: {
        kind: "position",
        line: 1,
        column: 18,
        nodeKind: "Identifier",
        role: "UnaryExpression.argument",
      },
    });
  });

  it("D3617: a change to a link of an optional chain has no probe site, since wrapping it ends the chain's short circuit", () => {
    expect(
      mutateWithProbe(JS, "const v = a?.b.c;\n", "a?.b.c", "x?.y.c"),
    ).toEqual({
      status: "no-probe-site",
      reason: {
        kind: "position",
        line: 1,
        column: 11,
        nodeKind: "MemberExpression",
        role: "MemberExpression.object",
      },
    });
  });

  it("D3618: a wrap that opens a statement after a line with no semicolon is not read as a call of that line's value", () => {
    expect(
      mutateWithProbe(JS, "const a = g()\nb + 1\n", "b + 1", "b - 1"),
    ).toEqual({
      status: "mutated",
      text: "const a = g()\nvoid 0, (globalThis.__rtTestReach?.(), b - 1)\n",
      site: { line: 2, column: 1, nodeKind: "BinaryExpression" },
    });
  });

  it("D3619: a mutation that does not parse has no probe site, naming where the parse failed and quoting no source", () => {
    expect(
      mutateWithProbe(
        JS,
        "const a = 1;\nconst b = 2;\n",
        "const b = 2;",
        "const b = ;",
      ),
    ).toEqual({
      status: "no-probe-site",
      reason: { kind: "unparsed", line: 2, column: 11 },
    });
  });

  it("D3620: a change inside a `declare global` block has no probe site, since its code never runs", () => {
    expect(
      mutateWithProbe(
        TS,
        "declare global {\n  var g: number;\n}\n",
        "var g",
        "let g",
      ),
    ).toEqual({
      status: "no-probe-site",
      reason: {
        kind: "position",
        line: 2,
        column: 3,
        nodeKind: "VariableDeclaration",
        role: "TSModuleBlock.body",
      },
    });
  });
});

describe("positions a probe would alter or the parser rejects", () => {
  it("D3736: a changed arrow function has no probe site, since a wrap fires where the function is defined, not when it is called", () => {
    expect(
      mutateWithProbe(
        JS,
        "const f = (a, b) => a + b;\n",
        "(a, b) => a + b",
        "(a) => a",
      ),
    ).toEqual({
      status: "no-probe-site",
      reason: {
        kind: "position",
        line: 1,
        column: 11,
        nodeKind: "ArrowFunctionExpression",
        role: "VariableDeclarator.init",
      },
    });
  });

  it("D3737: a change to a `delete` operand has no probe site, since deleting a wrapped value deletes nothing", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f(a, c) {\n  delete a.b;\n}\n",
        "delete a.b",
        "delete c.d",
      ),
    ).toEqual({
      status: "no-probe-site",
      reason: {
        kind: "position",
        line: 2,
        column: 10,
        nodeKind: "MemberExpression",
        role: "UnaryExpression.argument",
      },
    });
  });

  it("D3738: a probe the parser rejects, in a literal type, leaves no probe site rather than a module that fails to load", () => {
    expect(
      mutateWithProbe(
        TS,
        "type N = -1;\nexport const n: N = -1;\n",
        "type N = -1",
        "type N = -2",
      ),
    ).toEqual({
      status: "no-probe-site",
      reason: {
        kind: "position",
        line: 1,
        column: 11,
        nodeKind: "Literal",
        role: "UnaryExpression.argument",
      },
    });
  });

  it("D3739: in a CRLF file, a three-line replacement that changes only its first line is probed at that line's changed node", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f(a, b) {\r\n  const x = a + b;\r\n  const y = 1;\r\n  return x + y;\r\n}\r\n",
        "  const x = a + b;\n  const y = 1;\n  return x + y;",
        "  const x = a - b;\n  const y = 1;\n  return x + y;",
      ),
    ).toEqual({
      status: "mutated",
      text: "function f(a, b) {\r\n  const x = (globalThis.__rtTestReach?.(), a - b);\r\n  const y = 1;\r\n  return x + y;\r\n}\r\n",
      site: { line: 2, column: 13, nodeKind: "BinaryExpression" },
    });
  });
});

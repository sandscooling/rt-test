import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  mutateWithProbe,
  type ProbedMutation,
} from "../../src/falsify/reach-probe.js";

const JS = "case.js";
const TS = "case.ts";
const TSX = "case.tsx";
/** A probe's call as a probed module's text holds it. */
const PROBE = "globalThis.__rtTestReach?.()";
/** A function whose guard returns before its last two statements. */
const GUARDED =
  "function f(x) {\n  if (!x) return;\n  cancel();\n  later();\n}\n";
/** A function that returns from each case of a `switch`. */
const SWITCHED =
  "function f(k) {\n  switch (k) {\n    case 1:\n      return 2;\n    default:\n      return 3;\n  }\n}\n";

type Ran = { readonly fired: number; readonly value: unknown } | string;

/**
 * Runs a probed text as a script, then `drive`, in a context of its own that holds `globals`: what `drive` evaluated
 * to, with how often `fired` says the probe fired. A mutation that got no probe answers with its status, and a text
 * that throws with the error.
 */
function evaluated(
  probed: ProbedMutation,
  drive: string,
  globals: Record<string, unknown>,
  fired: () => number,
): Ran {
  if (probed.status !== "mutated") return probed.status;
  try {
    const value: unknown = runInNewContext(`${probed.text}\n${drive}`, globals);
    return { fired: fired(), value };
  } catch (error) {
    return `threw ${String(error)}`;
  }
}

/** Runs a probed text and `drive` against a recorder that counts the probe's firings. */
function ran(probed: ProbedMutation, drive: string): Ran {
  let fired = 0;
  const recorder = (): void => {
    fired += 1;
  };
  return evaluated(probed, drive, { __rtTestReach: recorder }, () => fired);
}

/** Runs a probed text and `drive` where no recorder is defined, as in a worker the reach setup file never ran in. */
function ranWithoutRecorder(probed: ProbedMutation, drive: string): Ran {
  return evaluated(probed, drive, {}, () => 0);
}

/** `mutateWithProbe`'s answer, or the error it threw as text, so a placement that throws fails the test's assertion. */
function placed(
  ...mutation: Parameters<typeof mutateWithProbe>
): ProbedMutation | string {
  try {
    return mutateWithProbe(...mutation);
  } catch (error) {
    return `threw ${String(error)}`;
  }
}

describe("a change inside a statement of a statement list", () => {
  it("D3612: a change inside a statement of a module's top level is probed by a statement placed just before that statement", () => {
    expect(
      mutateWithProbe(JS, "const r = obj.run();\n", "obj.run", "alt.go"),
    ).toEqual({
      status: "mutated",
      text: `${PROBE}; const r = alt.go();\n`,
      site: { line: 1, column: 1, nodeKind: "VariableDeclaration" },
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

  it("D3966: a change inside a statement of a static block is probed by a statement placed just before that statement", () => {
    expect(
      mutateWithProbe(
        JS,
        "class A {\n  static {\n    setUp(1);\n  }\n}\n",
        "setUp(1)",
        "setUp(2)",
      ),
    ).toEqual({
      status: "mutated",
      text: `class A {\n  static {\n    ${PROBE}; setUp(2);\n  }\n}\n`,
      site: { line: 3, column: 5, nodeKind: "ExpressionStatement" },
    });
  });

  it("D3967: a changed declaration inside a `case` is probed just before it, inside the case, not before the `switch`", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f(k) {\n  switch (k) {\n    case 1:\n      const n = k + 1;\n      return n;\n    default:\n      return 0;\n  }\n}\n",
        "k + 1",
        "k + 2",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f(k) {\n  switch (k) {\n    case 1:\n      ${PROBE}; const n = k + 2;\n      return n;\n    default:\n      return 0;\n  }\n}\n`,
      site: { line: 4, column: 7, nodeKind: "VariableDeclaration" },
    });
  });

  it("D3968: a change inside a statement after a guard is probed just before that statement, not at the head of its block", () => {
    expect(mutateWithProbe(JS, GUARDED, "later()", "after()")).toEqual({
      status: "mutated",
      text: `function f(x) {\n  if (!x) return;\n  cancel();\n  ${PROBE}; after();\n}\n`,
      site: { line: 4, column: 3, nodeKind: "ExpressionStatement" },
    });
  });

  it("D3611: a replacement of several statements that changes only the last is probed before the statement that changed, not before the first one replaced", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f(x) {\n  first();\n  if (!x) return;\n  later();\n}\n",
        "  first();\n  if (!x) return;\n  later();",
        "  first();\n  if (!x) return;\n  after();",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f(x) {\n  first();\n  if (!x) return;\n  ${PROBE}; after();\n}\n`,
      site: { line: 4, column: 3, nodeKind: "ExpressionStatement" },
    });
  });

  it("D3984: a change inside a JSX attribute is probed before the statement that holds the element", () => {
    expect(
      mutateWithProbe(
        TSX,
        'function A(p: { c: string }) {\n  return <a href="x" className={p.c}>t</a>;\n}\n',
        'href="x"',
        'href="y"',
      ),
    ).toEqual({
      status: "mutated",
      text: `function A(p: { c: string }) {\n  ${PROBE}; return <a href="y" className={p.c}>t</a>;\n}\n`,
      site: { line: 2, column: 3, nodeKind: "ReturnStatement" },
    });
  });
});

describe("a change that sits directly in a statement list", () => {
  it("D3969: a statement removed after a guard is probed before the statement that follows it, not before the guard", () => {
    expect(
      mutateWithProbe(
        JS,
        GUARDED,
        "  if (!x) return;\n  cancel();",
        "  if (!x) return;",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f(x) {\n  if (!x) return;\n  ${PROBE}; later();\n}\n`,
      site: { line: 4, column: 3, nodeKind: "ExpressionStatement" },
    });
  });

  it("D3983: a statement added after another is probed before the added statement, its site where the change starts", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f() {\n  a();\n  c();\n}\n",
        "  a();",
        "  a();\n  b();",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f() {\n  a();\n  ${PROBE}; b();\n  c();\n}\n`,
      site: { line: 2, column: 7, nodeKind: "ExpressionStatement" },
    });
  });

  it("D3970: the last statement of a block, removed after a guard, is probed by a probe that ends the block, not before the guard", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f(x) {\n  if (!x) return;\n  later();\n}\n",
        "  if (!x) return;\n  later();",
        "  if (!x) return;",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f(x) {\n  if (!x) return;;${PROBE};\n}\n`,
      site: { line: 2, column: 18, nodeKind: "BlockStatement" },
    });
  });

  it("D3985: the only statement of a function's body, removed, is probed inside the emptied body, so the probe fires each time the function is called", () => {
    expect(
      ran(
        mutateWithProbe(JS, "function f() {\n  save();\n}\n", "save();", ""),
        "[f(), f()].length",
      ),
    ).toEqual({ fired: 2, value: 2 });
  });

  it("D3618: a probe that ends a block after a statement written with no semicolon opens with one, so it does not join that statement", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f() {\n  a()\n  b()\n}\n",
        "  a()\n  b()",
        "  a()",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f() {\n  a();${PROBE};\n}\n`,
      site: { line: 2, column: 6, nodeKind: "BlockStatement" },
    });
  });

  it("D3971: a change in the header of a function whose body opens with a directive is probed after the directive", () => {
    expect(
      mutateWithProbe(
        JS,
        'function f(a) {\n  "use strict";\n  return a;\n}\n',
        "f(a)",
        "f(a, b)",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f(a, b) {\n  "use strict";\n  ${PROBE}; return a;\n}\n`,
      site: { line: 3, column: 3, nodeKind: "ReturnStatement" },
    });
  });
});

describe("a statement that stands alone as a branch", () => {
  it("D3972: a changed statement that is a one-line guard's branch becomes a block that starts with the probe, not a probe before the `if`", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f(a) {\n  if (!a) return 0;\n  return 1;\n}\n",
        "return 0;",
        "return 2;",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f(a) {\n  if (!a) { ${PROBE}; return 2; }\n  return 1;\n}\n`,
      site: { line: 2, column: 11, nodeKind: "ReturnStatement" },
    });
  });

  it("D3737: an `if` that is another `if`'s branch keeps its `else` when it becomes a block, so the probed text returns what the mutated text returns", () => {
    expect(
      ran(
        mutateWithProbe(
          JS,
          "function f(a, b) {\n  if (a) if (b) return 1; else return 2;\n  return 3;\n}\n",
          "if (b)",
          "if (!b)",
        ),
        "[f(1, 1), f(1, 0), f(0, 0)].join()",
      ),
    ).toEqual({ fired: 2, value: "2,1,3" });
  });

  it("D3973: a change in a labelled loop is probed before the label, which stays with its loop", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f(n) {\n  outer: for (let i = 0; i < n; i++) { continue outer; }\n}\n",
        "i < n",
        "i <= n",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f(n) {\n  ${PROBE}; outer: for (let i = 0; i <= n; i++) { continue outer; }\n}\n`,
      site: { line: 2, column: 3, nodeKind: "LabeledStatement" },
    });
  });
});

describe("a change in a function outside every statement of its body", () => {
  it("D3615: a change in a function's parameters is probed at the head of its body, not where the function is declared", () => {
    expect(
      mutateWithProbe(
        JS,
        "export const v = 1;\nfunction helper(a) {\n  return a;\n}\n",
        "helper(a)",
        "helper(a, b)",
      ),
    ).toEqual({
      status: "mutated",
      text: `export const v = 1;\nfunction helper(a, b) {\n  ${PROBE}; return a;\n}\n`,
      site: { line: 3, column: 3, nodeKind: "ReturnStatement" },
    });
  });

  it("D3736: a changed arrow function with an expression body is probed as the first member of a comma expression in that body, not where the arrow is defined", () => {
    expect(
      mutateWithProbe(
        JS,
        "const f = (a, b) => a + b;\n",
        "(a, b) => a + b",
        "(a) => a",
      ),
    ).toEqual({
      status: "mutated",
      text: `const f = (a) => (${PROBE}, a);\n`,
      site: { line: 1, column: 13, nodeKind: "Identifier" },
    });
  });

  it("D3974: a changed class field initializer is probed as the first member of a comma expression in the initializer, not before the class", () => {
    expect(
      mutateWithProbe(
        TS,
        "class A {\n  n = 1;\n  get(): number {\n    return this.n;\n  }\n}\n",
        "n = 1",
        "n = 2",
      ),
    ).toEqual({
      status: "mutated",
      text: `class A {\n  n = (${PROBE}, 2);\n  get(): number {\n    return this.n;\n  }\n}\n`,
      site: { line: 2, column: 7, nodeKind: "Literal" },
    });
  });
});

describe("text a mutation only removed", () => {
  it("D3975: the removed tail of an arrow's expression body is probed inside that body, not at the statement that defines the arrow", () => {
    expect(
      mutateWithProbe(
        JS,
        "function mk(a, b) {\n  return {\n    matches: (p) => a.matches(p) || b.matches(p),\n  };\n}\n",
        " || b.matches(p)",
        "",
      ),
    ).toEqual({
      status: "mutated",
      text: `function mk(a, b) {\n  return {\n    matches: (p) => (${PROBE}, a.matches(p)),\n  };\n}\n`,
      site: { line: 3, column: 21, nodeKind: "CallExpression" },
    });
  });

  it("D3976: `async` removed from a callback is probed at the head of the callback's body, not before the call that passes it", () => {
    expect(
      mutateWithProbe(
        JS,
        "function register(fn) {}\nregister(async () => {\n  return 1;\n});\n",
        "async () =>",
        "() =>",
      ),
    ).toEqual({
      status: "mutated",
      text: `function register(fn) {}\nregister(() => {\n  ${PROBE}; return 1;\n});\n`,
      site: { line: 3, column: 3, nodeKind: "ReturnStatement" },
    });
  });

  it("D3977: a statement removed just before a function declaration is probed before that declaration, not inside the function", () => {
    expect(
      mutateWithProbe(
        JS,
        "function outer() {\n  a();\n  function f() {\n    return 1;\n  }\n  return f;\n}\n",
        "  a();\n  function f() {",
        "  function f() {",
      ),
    ).toEqual({
      status: "mutated",
      text: `function outer() {\n  ${PROBE}; function f() {\n    return 1;\n  }\n  return f;\n}\n`,
      site: { line: 2, column: 3, nodeKind: "FunctionDeclaration" },
    });
  });

  it("D3982: a probe that stands after removed lines reports the line its statement has in the unmutated text", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f() {\n  a();\n  b();\n  c();\n  d();\n}\n",
        "  a();\n  b();\n  c();",
        "  a();",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f() {\n  a();\n  ${PROBE}; d();\n}\n`,
      site: { line: 5, column: 3, nodeKind: "ExpressionStatement" },
    });
  });
});

describe("what is no step of its own", () => {
  it("D3978: a changed `case` label is probed before the `switch`, not inside the case the new label may never enter", () => {
    expect(mutateWithProbe(JS, SWITCHED, "default:", "case 3:")).toEqual({
      status: "mutated",
      text: `function f(k) {\n  ${PROBE}; switch (k) {\n    case 1:\n      return 2;\n    case 3:\n      return 3;\n  }\n}\n`,
      site: { line: 2, column: 3, nodeKind: "SwitchStatement" },
    });
  });

  it("D3979: a change inside a namespace is probed before the namespace, not inside it", () => {
    expect(
      mutateWithProbe(
        TS,
        "export const User = { id: 1 };\nexport namespace User {\n  export type Id = string;\n}\n",
        "string",
        "number",
      ),
    ).toEqual({
      status: "mutated",
      text: `export const User = { id: 1 };\n${PROBE}; export namespace User {\n  export type Id = number;\n}\n`,
      site: { line: 2, column: 1, nodeKind: "ExportNamedDeclaration" },
    });
  });

  it("D3980: a changed overload signature, a function with no body, is probed before the signature", () => {
    expect(
      placed(
        TS,
        "function f(a: number): number;\nfunction f(a: string): string;\nfunction f(a: unknown): unknown {\n  return a;\n}\n",
        "f(a: string): string",
        "f(a: boolean): boolean",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f(a: number): number;\n${PROBE}; function f(a: boolean): boolean;\nfunction f(a: unknown): unknown {\n  return a;\n}\n`,
      site: { line: 2, column: 1, nodeKind: "TSDeclareFunction" },
    });
  });
});

describe("a change with no probe site", () => {
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

  it("D3981: a mutation that leaves its module with no statement has no probe site, reported at the start of the change", () => {
    expect(mutateWithProbe(JS, "run();\n", "run();", "")).toEqual({
      status: "no-probe-site",
      reason: {
        kind: "position",
        line: 1,
        column: 1,
        nodeKind: "Program",
        role: "root",
      },
    });
  });

  it("D3738: a probe the parser rejects, between a class's decorator and its `export`, leaves no probe site rather than a module that fails to load", () => {
    expect(
      mutateWithProbe(
        TS,
        "const a = 1;\n@Component({ sel: 'x' })\nexport class C {}\n",
        "'x'",
        "'y'",
      ),
    ).toEqual({
      status: "no-probe-site",
      reason: {
        kind: "position",
        line: 2,
        column: 20,
        nodeKind: "ExportNamedDeclaration",
        role: "Program.body",
      },
    });
  });

  it("D3613: a change of types alone, outside any ambient declaration, is probed before its statement", () => {
    expect(
      mutateWithProbe(
        TS,
        "type N = -1;\nexport const n: N = -1;\n",
        "type N = -1",
        "type N = -2",
      ),
    ).toEqual({
      status: "mutated",
      text: `${PROBE}; type N = -2;\nexport const n: N = -1;\n`,
      site: { line: 1, column: 1, nodeKind: "TSTypeAliasDeclaration" },
    });
  });
});

describe("what a probe leaves as it was", () => {
  it("D3617: an arrow passed as an argument, probed in its expression body, returns what the mutated text returns and fires once a call", () => {
    expect(
      ran(
        mutateWithProbe(
          JS,
          "function g(xs) {\n  return xs.map((x) => x + 1);\n}\n",
          "x + 1",
          "x + 2",
        ),
        "g([1, 2]).join()",
      ),
    ).toEqual({ fired: 2, value: "3,4" });
  });

  it("D3616: a probed text run where no recorder is defined returns what the mutated text returns and does not throw", () => {
    expect(
      ranWithoutRecorder(
        mutateWithProbe(
          JS,
          "function f(a) {\n  return a + 1;\n}\n",
          "a + 1",
          "a + 2",
        ),
        "f(1)",
      ),
    ).toEqual({ fired: 0, value: 3 });
  });

  it("D3739: in a CRLF file, a three-line replacement that changes only its first line is probed at that line's changed statement, every line ending kept", () => {
    expect(
      mutateWithProbe(
        JS,
        "function f(a) {\r\n  if (!a) return 0;\r\n  const y = 1;\r\n  return y;\r\n}\r\n",
        "  if (!a) return 0;\n  const y = 1;\n  return y;",
        "  if (!a) return 2;\n  const y = 1;\n  return y;",
      ),
    ).toEqual({
      status: "mutated",
      text: `function f(a) {\r\n  if (!a) { ${PROBE}; return 2; }\r\n  const y = 1;\r\n  return y;\r\n}\r\n`,
      site: { line: 2, column: 11, nodeKind: "ReturnStatement" },
    });
  });
});

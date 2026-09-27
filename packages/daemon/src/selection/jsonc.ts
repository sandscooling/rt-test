import { readFileSync } from "node:fs";
import type { Expression } from "oxc-parser";
import { errorText } from "../vitest/error-text.js";
import { parseGuarded } from "./source-imports.js";
import { UNCERTAINTY, type UncertaintyKind } from "./selection-types.js";

/** Nesting a config or `imports` value may reach before it is treated as unreadable. */
export const MAX_JSON_DEPTH = 64;
const JSONC_FILE_NAME = "config.js";
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const NEGATIVE = "-";

type Read<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly kind: UncertaintyKind;
      readonly reason: string;
    };

/**
 * Parses JSONC (comments and trailing commas) as one parenthesized JavaScript expression and accepts only
 * JSON values from it, so nothing in the file can run. The newline keeps a closing line comment open.
 */
export function readJsonc(file: string): Read<unknown> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return {
      ok: false,
      kind: UNCERTAINTY.unreadableSource,
      reason: `cannot be read: ${errorText(error)}`,
    };
  }
  const json = text.startsWith(BYTE_ORDER_MARK)
    ? text.slice(BYTE_ORDER_MARK.length)
    : text;
  const parsed = parseGuarded(JSONC_FILE_NAME, `(${json}\n)`, {
    preserveParens: false,
  });
  const unparsed = (reason: string): Read<unknown> => ({
    ok: false,
    kind: UNCERTAINTY.unparsedSource,
    reason: `does not parse as JSON: ${reason}`,
  });
  if (!parsed.ok) return unparsed(parsed.reason);
  const [statement, ...rest] = parsed.program.body;
  if (statement?.type !== "ExpressionStatement" || rest.length > 0) {
    return unparsed("it is not a single value");
  }
  const value = jsonValue(statement.expression, 0);
  return value.ok ? value : unparsed(value.reason);
}

type JsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

function jsonValue(node: Expression, depth: number): JsonResult {
  if (depth > MAX_JSON_DEPTH) {
    return {
      ok: false,
      reason: `it nests deeper than ${MAX_JSON_DEPTH} levels`,
    };
  }
  switch (node.type) {
    case "Literal":
      return "regex" in node || "bigint" in node
        ? notJson("a regular expression or BigInt literal")
        : literalValue(node.value);
    case "UnaryExpression":
      return node.operator === NEGATIVE &&
        node.argument.type === "Literal" &&
        typeof node.argument.value === "number"
        ? { ok: true, value: -node.argument.value }
        : notJson(node.type);
    case "ArrayExpression":
      return arrayValue(node.elements, depth);
    case "ObjectExpression":
      return objectValue(node.properties, depth);
    default:
      return notJson(node.type);
  }
}

function literalValue(value: unknown): JsonResult {
  const isJson =
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean";
  return isJson ? { ok: true, value } : notJson("a non-JSON literal");
}

function arrayValue(
  elements: Extract<Expression, { type: "ArrayExpression" }>["elements"],
  depth: number,
): JsonResult {
  const values: unknown[] = [];
  for (const element of elements) {
    if (element === null || element.type === "SpreadElement") {
      return notJson("an array hole or spread");
    }
    const value = jsonValue(element, depth + 1);
    if (!value.ok) return value;
    values.push(value.value);
  }
  return { ok: true, value: values };
}

function objectValue(
  properties: Extract<Expression, { type: "ObjectExpression" }>["properties"],
  depth: number,
): JsonResult {
  const entries: [string, unknown][] = [];
  for (const property of properties) {
    if (property.type !== "Property" || property.computed || property.method) {
      return notJson("a spread, computed or method property");
    }
    const { key } = property;
    const name =
      key.type === "Literal" && typeof key.value === "string"
        ? key.value
        : key.type === "Identifier"
          ? key.name
          : undefined;
    if (name === undefined)
      return notJson("a property key that is not a string");
    const value = jsonValue(property.value, depth + 1);
    if (!value.ok) return value;
    entries.push([name, value.value]);
  }
  return { ok: true, value: Object.fromEntries(entries) };
}

function notJson(what: string): JsonResult {
  return { ok: false, reason: `it holds ${what}, which JSON does not allow` };
}

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import {
  parseSync,
  Visitor,
  type Argument,
  type Expression,
  type ParseResult,
  type ParserOptions,
} from "oxc-parser";
import { errorText } from "../vitest/error-text.js";
import { UNCERTAINTY, type UncertaintyKind } from "./selection-types.js";

/** How a specifier resolves: as a module request, always against its file's directory, or as a glob pattern. */
export const SPECIFIER_FORM = {
  module: "module",
  fileRelative: "file-relative",
  glob: "glob",
} as const;

export type SpecifierForm =
  (typeof SPECIFIER_FORM)[keyof typeof SPECIFIER_FORM];

export interface FoundSpecifier {
  readonly text: string;
  readonly form: SpecifierForm;
}

export type SourceImports =
  | { readonly ok: true; readonly specifiers: readonly FoundSpecifier[] }
  | {
      readonly ok: false;
      readonly kind: UncertaintyKind;
      readonly reason: string;
    };

const JSX_EXTENSIONS = [".js", ".mjs"];
const COMMONJS_JSX_EXTENSION = ".cjs";
const REQUIRE = "require";
const RESOLVE = "resolve";
const VITEST_GLOBAL = "vi";
const VITEST_MODULE_METHODS = [
  "mock",
  "doMock",
  "importActual",
  "importMock",
  "unmock",
  "doUnmock",
];
const IMPORT_META_GLOB = "glob";
const IMPORT_META_URL = "url";
const URL_CONSTRUCTOR = "URL";
const GLOB_NEGATION = "!";
const REFERENCE_PATH_DIRECTIVE = /^\/\s*<reference\s+path\s*=\s*(["'])(.+?)\1/;
const ERROR_SEPARATOR = "; ";
/** Well below the bracket nesting at which the native parser overflows its stack and ends the process, which no catch recovers. */
const MAX_BRACKET_DEPTH = 1000;
const OPENING_BRACKETS = "([{";
const CLOSING_BRACKETS = ")]}";

export type GuardedParse =
  | {
      readonly ok: true;
      readonly result: ParseResult;
      /** Read inside the guard, since the parser builds it on first access and that can throw. */
      readonly program: ParseResult["program"];
    }
  | { readonly ok: false; readonly reason: string };

/** Reads and parses one source file; executes nothing, and a file with any parse error yields no specifier. */
export function readSourceImports(file: string): SourceImports {
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
  const parsed = parseGuarded(file, text, parserOptions(file));
  if (!parsed.ok) return unparsed(`does not parse: ${parsed.reason}`);
  try {
    return { ok: true, specifiers: specifiersOf(parsed.result) };
  } catch (error) {
    return unparsed(`cannot be walked: ${errorText(error)}`);
  }
}

function unparsed(reason: string): SourceImports {
  return { ok: false, kind: UNCERTAINTY.unparsedSource, reason };
}

/**
 * Parses with every failure as a reason: an error the parser reports or throws, and bracket nesting past
 * `MAX_BRACKET_DEPTH`, which is refused before the parse. Deep nesting without brackets still reaches the parser.
 */
export function parseGuarded(
  filename: string,
  text: string,
  options: ParserOptions,
): GuardedParse {
  const depth = bracketDepth(text);
  if (depth > MAX_BRACKET_DEPTH) {
    return {
      ok: false,
      reason: `it nests brackets ${depth} deep, past the ${MAX_BRACKET_DEPTH} the parser is given`,
    };
  }
  let result: ParseResult;
  let program: ParseResult["program"];
  try {
    result = parseSync(filename, text, options);
    program = result.program;
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  }
  return result.errors.length > 0
    ? {
        ok: false,
        reason: result.errors
          .map(({ message }) => message)
          .join(ERROR_SEPARATOR),
      }
    : { ok: true, result, program };
}

/** Every bracket counts, those in strings and comments included, since the text is not parsed yet. */
function bracketDepth(text: string): number {
  let depth = 0;
  let deepest = 0;
  for (const character of text) {
    if (OPENING_BRACKETS.includes(character)) {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if (CLOSING_BRACKETS.includes(character)) {
      depth = Math.max(0, depth - 1);
    }
  }
  return deepest;
}

function specifiersOf(result: ParseResult): FoundSpecifier[] {
  const specifiers: FoundSpecifier[] = [];
  const add = (text: string, form: SpecifierForm): void => {
    specifiers.push({ text, form });
  };
  for (const { moduleRequest } of result.module.staticImports) {
    add(moduleRequest.value, SPECIFIER_FORM.module);
  }
  for (const { entries } of result.module.staticExports) {
    for (const { moduleRequest } of entries) {
      if (moduleRequest !== null)
        add(moduleRequest.value, SPECIFIER_FORM.module);
    }
  }
  for (const { type, value } of result.comments) {
    const directive =
      type === "Line" ? REFERENCE_PATH_DIRECTIVE.exec(value) : null;
    const path = directive?.[2];
    if (path !== undefined) add(path, SPECIFIER_FORM.fileRelative);
  }
  visitCalls(result.program, add);
  return specifiers;
}

/** JSX is accepted in every JavaScript extension, and `.cjs` keeps CommonJS's top-level `return`. */
function parserOptions(file: string): ParserOptions {
  const extension = extname(file);
  if (extension === COMMONJS_JSX_EXTENSION) {
    return { lang: "jsx", sourceType: "commonjs", preserveParens: false };
  }
  return JSX_EXTENSIONS.includes(extension)
    ? { lang: "jsx", preserveParens: false }
    : { preserveParens: false };
}

type AddSpecifier = (text: string, form: SpecifierForm) => void;

/** The file being walked: the parser keeps every `Visitor` it builds for the life of the process, so one is built. */
let visiting: AddSpecifier | undefined;
const CALL_VISITOR = callVisitor();

function visitCalls(
  program: Parameters<Visitor["visit"]>[0],
  add: AddSpecifier,
): void {
  visiting = add;
  try {
    CALL_VISITOR.visit(program);
  } finally {
    visiting = undefined;
  }
}

function callVisitor(): Visitor {
  const add: AddSpecifier = (text, form) => {
    visiting?.(text, form);
  };
  return new Visitor({
    ImportExpression(node) {
      addLiteral(node.source, SPECIFIER_FORM.module, add);
    },
    TSImportEqualsDeclaration(node) {
      if (node.moduleReference.type === "TSExternalModuleReference") {
        add(node.moduleReference.expression.value, SPECIFIER_FORM.module);
      }
    },
    CallExpression(node) {
      const form = callForm(node.callee);
      const [first] = node.arguments;
      if (form === undefined || first === undefined) return;
      if (form === SPECIFIER_FORM.glob && first.type === "ArrayExpression") {
        for (const element of first.elements) {
          if (element !== null) addLiteral(element, form, add);
        }
        return;
      }
      addLiteral(first, form, add);
    },
    NewExpression(node) {
      const [first, second] = node.arguments;
      const isFileUrl =
        node.callee.type === "Identifier" &&
        node.callee.name === URL_CONSTRUCTOR &&
        second !== undefined &&
        isImportMeta(second, IMPORT_META_URL);
      if (isFileUrl && first !== undefined) {
        addLiteral(first, SPECIFIER_FORM.fileRelative, add);
      }
    },
  });
}

/** The form of the first argument of `require`, `require.resolve`, a `vi` module method, `import.meta.resolve` or `import.meta.glob`. */
function callForm(callee: Expression): SpecifierForm | undefined {
  if (callee.type === "Identifier") {
    return callee.name === REQUIRE ? SPECIFIER_FORM.module : undefined;
  }
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  if (callee.property.type !== "Identifier") return undefined;
  const method = callee.property.name;
  const { object } = callee;
  if (object.type === "MetaProperty") {
    if (method === RESOLVE) return SPECIFIER_FORM.module;
    return method === IMPORT_META_GLOB ? SPECIFIER_FORM.glob : undefined;
  }
  if (object.type !== "Identifier") return undefined;
  const isModuleCall =
    (object.name === REQUIRE && method === RESOLVE) ||
    (object.name === VITEST_GLOBAL && VITEST_MODULE_METHODS.includes(method));
  return isModuleCall ? SPECIFIER_FORM.module : undefined;
}

function isImportMeta(node: Argument, property: string): boolean {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "MetaProperty" &&
    node.property.type === "Identifier" &&
    node.property.name === property
  );
}

/** A string literal or a template literal with no substitution; any computed specifier is a known limit. */
function addLiteral(
  node: Argument,
  form: SpecifierForm,
  add: (text: string, form: SpecifierForm) => void,
): void {
  const text = literalText(node);
  if (text === undefined) return;
  const negated =
    form === SPECIFIER_FORM.glob && text.startsWith(GLOB_NEGATION);
  add(negated ? text.slice(GLOB_NEGATION.length) : text, form);
}

function literalText(node: Argument): string | undefined {
  if (node.type === "Literal") {
    return typeof node.value === "string" ? node.value : undefined;
  }
  if (node.type !== "TemplateLiteral" || node.expressions.length > 0) {
    return undefined;
  }
  return node.quasis[0]?.value.cooked ?? undefined;
}

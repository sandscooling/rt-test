import {
  parseGuarded,
  parserOptions,
  type GuardedParse,
} from "../selection/source-imports.js";
import { replaceAnchor } from "./anchor-match.js";
import {
  CHAIN,
  isSyntaxNode,
  PLACEMENT,
  placementAt,
  roleOf,
  type PathStep,
  type Placement,
  type Slot,
  type SyntaxNode,
} from "./probe-slots.js";
import { REACH_PROBE_CALL } from "./reach-names.js";

/** 1-based line and 1-based column (UTF-16 code units) in the text the function was given, before the mutation. */
export interface ProbeSite {
  readonly line: number;
  readonly column: number;
  readonly nodeKind: string;
}

export type NoProbeSite =
  /** The smallest node enclosing the changed text sits where a probe would alter what the module does. `role` names the parent's node type and the field holding the node, such as "CallExpression.callee". */
  | {
      readonly kind: "position";
      readonly line: number;
      readonly column: number;
      readonly nodeKind: string;
      readonly role: string;
    }
  /** The mutated text does not parse. line and column locate the first error in the mutated text when the parser gave an offset; `nesting` is the bracket depth when parseGuarded refused the text before parsing. Never the parser's message, which can quote source. */
  | {
      readonly kind: "unparsed";
      readonly line?: number;
      readonly column?: number;
      readonly nesting?: number;
    };

export type ProbedMutation =
  | {
      readonly status: "mutated";
      readonly text: string;
      readonly site: ProbeSite;
    }
  /** `old` did not occur exactly once, counted by the anchor matcher. */
  | { readonly status: "anchor-count"; readonly count: number }
  | { readonly status: "no-probe-site"; readonly reason: NoProbeSite };

interface Span {
  readonly start: number;
  readonly end: number;
}

interface TextPosition {
  readonly line: number;
  readonly column: number;
}

type ParseFailure = Extract<GuardedParse, { ok: false }>;

const LINE_BREAK = "\n";
const CHAIN_BODY = "expression";
const EXPRESSION_STATEMENT = "ExpressionStatement";
const ROOT_ROLE = "root";
/** Keeps a wrap that opens a statement from being read as a call of the previous line's value. */
const STATEMENT_OPENER = "void 0, ";
const PROBE_STATEMENT = `${REACH_PROBE_CALL}; `;

/**
 * Applies a mutation to a file's text in memory and places a reach probe at the smallest node enclosing the changed
 * text, where the probe firing means the changed code began executing. Inserts no line break.
 */
export function mutateWithProbe(
  fileName: string,
  text: string,
  old: string,
  replacement: string,
): ProbedMutation {
  const replaced = replaceAnchor(text, old, replacement);
  if (!replaced.applied) {
    return { status: "anchor-count", count: replaced.count };
  }
  const { match, replacementEnd } = replaced;
  const mutated = replaced.text;
  const parsed = parseGuarded(fileName, mutated, parserOptions(fileName));
  if (!parsed.ok) return noProbeSite(unparsed(mutated, parsed));
  const span = changedSpan(
    text.slice(match.start, match.end),
    mutated.slice(match.start, replacementEnd),
    match.start,
  );
  const path = probedPath(enclosingPath(syntaxRoot(parsed.program), span));
  const node = lastNode(path);
  const slot = slotOf(path);
  const placement = slot === undefined ? undefined : placementAt(slot);
  const probed =
    placement === undefined ? undefined : withProbe(mutated, path, placement);
  if (probed === undefined || !parses(fileName, probed)) {
    return noProbeSite({
      kind: "position",
      ...positionOf(text, node.start),
      nodeKind: node.type,
      role: slot === undefined ? ROOT_ROLE : roleOf(slot.parent, slot.field),
    });
  }
  return {
    status: "mutated",
    text: probed,
    site: { ...positionOf(text, node.start), nodeKind: node.type },
  };
}

/** A probe the parser rejects, such as one in a position only a type checker forbids, has no site. */
function parses(fileName: string, text: string): boolean {
  return parseGuarded(fileName, text, parserOptions(fileName)).ok;
}

function noProbeSite(reason: NoProbeSite): ProbedMutation {
  return { status: "no-probe-site", reason };
}

function unparsed(mutated: string, failure: ParseFailure): NoProbeSite {
  return {
    kind: "unparsed",
    ...(failure.offset === undefined
      ? {}
      : positionOf(mutated, failure.offset)),
    ...(failure.nesting === undefined ? {} : { nesting: failure.nesting }),
  };
}

/** The written replacement, less the longest prefix and then the longest suffix it shares with the text it replaced. */
function changedSpan(replaced: string, written: string, offset: number): Span {
  const shortest = Math.min(replaced.length, written.length);
  let prefix = 0;
  while (prefix < shortest && replaced[prefix] === written[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    replaced[replaced.length - 1 - suffix] ===
      written[written.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { start: offset + prefix, end: offset + written.length - suffix };
}

function syntaxRoot(program: unknown): SyntaxNode {
  if (!isSyntaxNode(program)) {
    throw new Error("the parser returned a program without a type and a span");
  }
  return program;
}

/** Descends one child at a time, since siblings never overlap, so the path ends at the deepest enclosing node. */
function enclosingPath(root: SyntaxNode, span: Span): PathStep[] {
  const path: PathStep[] = [{ node: root, field: "" }];
  for (;;) {
    const next = enclosingChild(lastNode(path), span);
    if (next === undefined) return path;
    path.push(next);
  }
}

function enclosingChild(node: SyntaxNode, span: Span): PathStep | undefined {
  for (const [field, value] of Object.entries(node)) {
    const children: unknown[] = Array.isArray(value) ? value : [value];
    const child = children.find(
      (candidate) => isSyntaxNode(candidate) && encloses(candidate, span),
    );
    if (isSyntaxNode(child)) return { node: child, field };
  }
  return undefined;
}

/** An empty span, a deletion, is enclosed only by a node it falls strictly inside. */
function encloses(node: SyntaxNode, span: Span): boolean {
  if (span.start === span.end) {
    return node.start < span.start && span.start < node.end;
  }
  return node.start <= span.start && span.end <= node.end;
}

/** A chain's body spans the same text as the chain, so the chain's position is the one a wrap would take. */
function probedPath(path: PathStep[]): PathStep[] {
  const holder = path[path.length - 2];
  const isChainBody =
    holder?.node.type === CHAIN && lastStep(path).field === CHAIN_BODY;
  return isChainBody ? path.slice(0, -1) : path;
}

function slotOf(path: readonly PathStep[]): Slot | undefined {
  const holder = path[path.length - 2];
  if (holder === undefined) return undefined;
  const { node, field } = lastStep(path);
  return { node, field, parent: holder.node, path };
}

function withProbe(
  mutated: string,
  path: readonly PathStep[],
  placement: Placement,
): string {
  const node = lastNode(path);
  const before = mutated.slice(0, node.start);
  if (placement === PLACEMENT.statement) {
    return before + PROBE_STATEMENT + mutated.slice(node.start);
  }
  const opener = opensStatement(path) ? STATEMENT_OPENER : "";
  const wrapped = `(${REACH_PROBE_CALL}, ${mutated.slice(node.start, node.end)})`;
  return before + opener + wrapped + mutated.slice(node.end);
}

/** The node is the first token of its nearest enclosing expression statement. */
function opensStatement(path: readonly PathStep[]): boolean {
  const node = lastNode(path);
  const statement = path.findLast(
    (step) => step.node !== node && step.node.type === EXPRESSION_STATEMENT,
  );
  return statement?.node.start === node.start;
}

function positionOf(text: string, offset: number): TextPosition {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf(LINE_BREAK) + 1;
  return {
    line: before.split(LINE_BREAK).length,
    column: offset - lineStart + 1,
  };
}

function lastStep(path: readonly PathStep[]): PathStep {
  const step = path[path.length - 1];
  if (step === undefined) throw new Error("an enclosing path is never empty");
  return step;
}

function lastNode(path: readonly PathStep[]): SyntaxNode {
  return lastStep(path).node;
}

import {
  parseGuarded,
  parserOptions,
  type GuardedParse,
} from "../selection/source-imports.js";
import { replaceAnchor } from "./anchor-match.js";
import {
  isSyntaxNode,
  stepAt,
  withProbe,
  type Span,
  type Step,
  type StepChoice,
  type SyntaxNode,
} from "./probe-step.js";

/**
 * Where the probe stands: 1-based line and 1-based column (UTF-16 code units) in the text the function was given,
 * before the mutation, with the kind of the node it stands on. A probe that stands inside written text reports where
 * the change starts.
 */
export interface ProbeSite {
  readonly line: number;
  readonly column: number;
  readonly nodeKind: string;
}

export type NoProbeSite =
  /**
   * Nothing runs where the change sits, or the parser rejects the text with the probe written in. line and column
   * locate the start of the change. `role` names the parent's node type and the field holding the node, such as
   * "TSModuleBlock.body", or "root" for the program.
   */
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

/** The characters a mutation changed, less what the replaced and the written text share at their ends. */
interface Change {
  /** In the unmutated text. Empty when the mutation only added text. */
  readonly removed: Span;
  /** In the mutated text, starting where `removed` starts. Empty when the mutation only removed text. */
  readonly written: Span;
}

interface TextPosition {
  readonly line: number;
  readonly column: number;
}

type ParseFailure = Extract<GuardedParse, { ok: false }>;

const LINE_BREAK = "\n";

/**
 * Applies a mutation to a file's text in memory and places a reach probe at the start of the step that holds the
 * change, so the probe firing means execution reached that step. Inserts no line break.
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
  const change = changeOf(
    text.slice(match.start, match.end),
    mutated.slice(match.start, replacementEnd),
    match.start,
  );
  const choice = stepOfChange(
    syntaxRoot(parsed.program),
    change,
    removedStep(fileName, text, change),
  );
  const changeStart = positionOf(text, change.written.start);
  if (!choice.found) {
    const { nodeKind, role } = choice;
    return noProbeSite({ kind: "position", ...changeStart, nodeKind, role });
  }
  const { step } = choice;
  const { nodeKind, role } = step;
  const probed = withProbe(mutated, step);
  if (!parses(fileName, probed)) {
    return noProbeSite({ kind: "position", ...changeStart, nodeKind, role });
  }
  return {
    status: "mutated",
    text: probed,
    site: { ...positionOf(text, siteOffset(step, change)), nodeKind },
  };
}

/** A probe the parser rejects has no site, since the module would fail to load in the experiment. */
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

/** Trims the longest prefix the replaced and the written text share, and then the longest suffix. */
function changeOf(replaced: string, written: string, offset: number): Change {
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
  const start = offset + prefix;
  return {
    removed: { start, end: offset + replaced.length - suffix },
    written: { start, end: offset + written.length - suffix },
  };
}

/** Removed text has no extent in the mutated text, so the step that held it is found in the unmutated text. */
function removedStep(
  fileName: string,
  text: string,
  { removed }: Change,
): Step | undefined {
  if (removed.start === removed.end) return undefined;
  const parsed = parseGuarded(fileName, text, parserOptions(fileName));
  if (!parsed.ok) return undefined;
  const choice = stepAt(syntaxRoot(parsed.program), removed, false);
  return choice.found ? choice.step : undefined;
}

/**
 * The step of the mutated text that holds the written text and the start of the step that held the removed text; the
 * text before a change is the same in both texts, so that start is an offset of both. Where the removed text began a
 * step entered at its first character, such as a function, what stands there now holds the change.
 */
function stepOfChange(
  root: SyntaxNode,
  { written }: Change,
  held: Step | undefined,
): StepChoice {
  const start = Math.min(held?.start ?? written.start, written.start);
  const opensNode =
    held !== undefined && !held.inList && held.start === written.start;
  return stepAt(root, { start, end: written.end }, opensNode);
}

/** Where the probe stands, as an offset of the unmutated text. */
function siteOffset(step: Step, { removed, written }: Change): number {
  const [{ offset }] = step.insertions;
  if (offset <= written.start) return offset;
  if (offset < written.end) return written.start;
  return offset - (written.end - removed.end);
}

function syntaxRoot(program: unknown): SyntaxNode {
  if (!isSyntaxNode(program)) {
    throw new Error("the parser returned a program without a type and a span");
  }
  return program;
}

function positionOf(text: string, offset: number): TextPosition {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf(LINE_BREAK) + 1;
  return {
    line: before.split(LINE_BREAK).length,
    column: offset - lineStart + 1,
  };
}

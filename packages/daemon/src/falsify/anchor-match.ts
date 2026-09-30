/**
 * Finds a mutation's anchor in a file's text the way the defect catalog counts it, as non-overlapping occurrences
 * from the start, except that a line break in the anchor matches a line break of either ending in the text, since a
 * checkout on Windows can hold CRLF files whatever the repository's attributes say.
 */

export type LineEnding = "\n" | "\r\n";

export interface AnchorMatch {
  /** Offset in the text of the match's first character. */
  readonly start: number;
  /** Offset in the text just past the match. */
  readonly end: number;
  /** The ending of the match's first line break, or of the line holding the match when it spans none. */
  readonly lineEnding: LineEnding;
}

export type AnchorLocation =
  | { readonly found: true; readonly match: AnchorMatch }
  /** Anything but exactly one occurrence; `count` is how many there were. */
  | { readonly found: false; readonly count: number };

export type AnchorReplacement =
  | {
      readonly applied: true;
      readonly text: string;
      readonly match: AnchorMatch;
      /** Offset just past the replacement in the new text. */
      readonly replacementEnd: number;
    }
  | { readonly applied: false; readonly count: number };

const LF: LineEnding = "\n";
const CRLF: LineEnding = "\r\n";
const ANY_LINE_BREAK = "\\r?\\n";
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** How many times the anchor occurs, counted non-overlapping from the start. An empty anchor occurs nowhere. */
export function countAnchor(text: string, anchor: string): number {
  if (anchor === "") return 0;
  return [...text.matchAll(anchorPattern(anchor))].length;
}

/** The anchor's one occurrence, or how many there were when that is not one. */
export function locateAnchor(text: string, anchor: string): AnchorLocation {
  const count = countAnchor(text, anchor);
  if (count !== 1) return { found: false, count };
  const found = anchorPattern(anchor).exec(text);
  if (found === null) return { found: false, count: 0 };
  const start = found.index;
  const end = start + found[0].length;
  return {
    found: true,
    match: { start, end, lineEnding: matchLineEnding(text, found[0], start) },
  };
}

/** Replaces the anchor's one occurrence, writing each line break of `replacement` with the ending the match used. */
export function replaceAnchor(
  text: string,
  anchor: string,
  replacement: string,
): AnchorReplacement {
  const location = locateAnchor(text, anchor);
  if (!location.found) return { applied: false, count: location.count };
  const { match } = location;
  const written = withLineEnding(replacement, match.lineEnding);
  return {
    applied: true,
    text: text.slice(0, match.start) + written + text.slice(match.end),
    match,
    replacementEnd: match.start + written.length,
  };
}

function anchorPattern(anchor: string): RegExp {
  const lines = toLf(anchor)
    .split(LF)
    .map((line) => line.replace(REGEX_SPECIALS, "\\$&"));
  return new RegExp(lines.join(ANY_LINE_BREAK), "g");
}

function matchLineEnding(
  text: string,
  matched: string,
  start: number,
): LineEnding {
  const inMatch = matched.indexOf(LF);
  if (inMatch !== -1) return matched[inMatch - 1] === "\r" ? CRLF : LF;
  const after = text.indexOf(LF, start);
  return after > 0 && text[after - 1] === "\r" ? CRLF : LF;
}

function withLineEnding(value: string, ending: LineEnding): string {
  const lf = toLf(value);
  return ending === LF ? lf : lf.split(LF).join(CRLF);
}

function toLf(value: string): string {
  return value.split(CRLF).join(LF);
}

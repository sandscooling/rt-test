/**
 * A comment may state a fact the code cannot state. It may not carry an issue or rule reference,
 * an ADR or ticket reference, a date, or a `file:line` citation, and a block comment may not run
 * past the configured cap. Each of those is a second copy of something maintained elsewhere, so it
 * goes stale with nothing to report it. Judging whether a comment restates its code stays with review.
 *
 * Directives are exempt, since removing one changes what another tool sees. A directive quoted in
 * backticks is prose about a directive and is checked normally.
 */

const PATTERNS = [
  { id: "issueRef", re: /(?:^|[\s(])#\d{2,}(?:\.\d+[a-z]?)?\b/ },
  { id: "adrRef", re: /\bADR-\d{3,4}\b/ },
  { id: "ticketRef", re: /\b(?:Ticket|Sprint|Issue|PR)\s+#?\d+/i },
  { id: "dateRef", re: /\b20\d{2}-\d{2}-\d{2}\b/ },
  { id: "lineCitation", re: /\b[\w.-]+\.[cm]?[jt]sx?:\d+\b/ },
];

const MAX_BLOCK_LINES = 12;

const DIRECTIVE_PREFIX =
  /^\s*\/\/\s*(?:eslint-|oxlint-|@ts-|prettier-|#region|#endregion)/;
const DIRECTIVE_ANYWHERE =
  /@ts-expect-error|@ts-ignore|eslint-disable|oxlint-disable|prettier-ignore/;
const BACKTICK_SPAN = /`[^`]*`/g;

const MESSAGES = {
  issueRef:
    "Issue or rule reference in a comment. The tracker and rule docs are the record; state the local consequence instead.",
  adrRef:
    "ADR reference in a comment. The ADR owns the decision; keep the invariant and drop the reference.",
  ticketRef:
    "Ticket, sprint, issue, or PR reference in a comment. Git owns history; state the fact this code depends on.",
  dateRef:
    "Date in a comment. A dated sentence is history and belongs in git; state the invariant instead.",
  lineCitation:
    "file:line citation in a comment. Line numbers shift silently; cite the symbol name instead.",
  tooLong:
    "Block comment runs {{lines}} lines, past the {{max}}-line cap. Move rationale or history to docs or git.",
};

function isDirective(text) {
  const unquoted = text.replace(BACKTICK_SPAN, "");
  return (
    DIRECTIVE_PREFIX.test(`//${text}`) || DIRECTIVE_ANYWHERE.test(unquoted)
  );
}

function reportPatterns(context, comment) {
  for (const { id, re } of PATTERNS) {
    if (re.test(comment.value))
      context.report({ node: comment, messageId: id });
  }
}

function reportLength(context, comment, maxBlockLines) {
  if (comment.type !== "Block" || maxBlockLines === 0) return;
  const lines = comment.loc.end.line - comment.loc.start.line + 1;
  if (lines > maxBlockLines) {
    context.report({
      node: comment,
      messageId: "tooLong",
      data: { lines: String(lines), max: String(maxBlockLines) },
    });
  }
}

export const noNonlocalComment = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Comments state local facts: no references, dates, or line citations, and a capped block length",
    },
    schema: [
      {
        type: "object",
        properties: { maxBlockLines: { type: "integer", minimum: 0 } },
        additionalProperties: false,
      },
    ],
    messages: MESSAGES,
  },
  create(context) {
    const maxBlockLines = context.options[0]?.maxBlockLines ?? MAX_BLOCK_LINES;
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (isDirective(comment.value)) continue;
          reportPatterns(context, comment);
          reportLength(context, comment, maxBlockLines);
        }
      },
    };
  },
};

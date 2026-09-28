// Splits a Bash or PowerShell command line into its simple commands, each as its unquoted words and its text.
// It skips comments and heredoc and here-string bodies. The body of a command substitution inside double
// quotes, and of a Bash backtick span, runs too, so each is recorded on the segment it occurs in.

export const SHELL = Object.freeze({ BASH: "bash", POWERSHELL: "powershell" });
/** A word that sets a variable for the command after it. */
export const ASSIGNMENT = /^[A-Za-z_]\w*=/;

const ESCAPE = { [SHELL.BASH]: "\\", [SHELL.POWERSHELL]: "`" };
const BASH_QUOTED_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);
const HEREDOC = /^<<(?!<)-?[ \t]*(['"]?)([A-Za-z_]\w*)\1/;
const HERE_STRING_OPEN = /^@(['"])\r?\n/;
const BLOCK_COMMENT_OPEN = "<#";
const BLOCK_COMMENT_CLOSE = "#>";
const SUBSTITUTION_OPEN = "$(";
const BACKTICK = "`";
// A word that a following `>` or `<` continues as one redirect, such as `2`, `&`, `*`, `>` or `2>`.
const REDIRECT_SO_FAR = /^(?:\d+|\*)?[<>&]*$/;

function newScan(text, shell) {
  return {
    text,
    escape: ESCAPE[shell] ?? ESCAPE[SHELL.BASH],
    powershell: shell === SHELL.POWERSHELL,
    segments: [],
    words: [],
    word: "",
    inWord: false,
    start: 0,
    pending: [],
    substitutions: [],
  };
}

function endWord(s) {
  if (s.inWord) s.words.push(s.word);
  s.word = "";
  s.inWord = false;
}

function endSegment(s, at) {
  endWord(s);
  const text = s.text.slice(s.start, at).trim();
  if (s.words.length > 0) {
    s.segments.push({ words: s.words, text, substitutions: s.substitutions });
  }
  s.words = [];
  s.substitutions = [];
  s.start = at + 1;
}

function appendChar(s, c, i) {
  s.word += c;
  s.inWord = true;
  return i;
}

// Index of the line end of the first line from `from` that `isClose` accepts, or the text's end.
function skipLinesUntil(text, from, isClose) {
  let lineStart = from;
  while (lineStart < text.length) {
    const end = text.indexOf("\n", lineStart);
    const lineEnd = end === -1 ? text.length : end;
    if (isClose(text.slice(lineStart, lineEnd))) return lineEnd;
    lineStart = lineEnd + 1;
  }
  return text.length;
}

function skipHeredocBodies(text, newline, pending) {
  let at = newline;
  for (const delimiter of pending.splice(0)) {
    at = skipLinesUntil(text, at + 1, (line) => line.trim() === delimiter);
  }
  return at;
}

function heredocAt(text, i) {
  if (text[i - 1] === "<") return null;
  return HEREDOC.exec(text.slice(i));
}

// Index of the quote closing the string opened at `open`, honoring the shell's escape character.
function closingQuote(text, open, escape) {
  const quote = text[open];
  let j = open + 1;
  while (j < text.length && text[j] !== quote) {
    j += quote === '"' && text[j] === escape ? 2 : 1;
  }
  return j;
}

/** Index of the `)` closing a substitution whose body starts at `from`, skipping quotes and heredoc bodies. */
function closingParen(text, from, escape) {
  const pending = [];
  let depth = 1;
  for (let j = from; j < text.length; j++) {
    const c = text[j];
    const heredoc = c === "<" ? heredocAt(text, j) : null;
    if (c === "'" || c === '"') j = closingQuote(text, j, escape);
    else if (c === escape) j++;
    else if (heredoc) {
      pending.push(heredoc[2]);
      j += heredoc[0].length - 1;
    } else if (c === "\n" && pending.length > 0) {
      j = skipHeredocBodies(text, j, pending);
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return j;
  }
  return text.length;
}

function quotedEscape(s, j) {
  const next = s.text[j + 1];
  if (next === undefined) return { text: s.escape, width: 1 };
  if (s.powershell || BASH_QUOTED_ESCAPES.has(next)) {
    return { text: next, width: 2 };
  }
  return { text: s.escape, width: 1 };
}

// Appends the substitution opened at `open` to the word, records its body, and returns `close`.
function recordSubstitution(s, open, body, close) {
  s.substitutions.push(s.text.slice(body, close));
  s.word += s.text.slice(open, close + 1);
  s.inWord = true;
  return close;
}

const isBashBacktick = (s, i) => !s.powershell && s.text[i] === BACKTICK;

// Index of the backtick closing the span opened at `open`, where a backslash escapes the next character.
function closingBacktick(text, open) {
  let j = open + 1;
  while (j < text.length && text[j] !== BACKTICK) {
    j += text[j] === ESCAPE[SHELL.BASH] ? 2 : 1;
  }
  return Math.min(j, text.length);
}

function readBacktickSpan(s, i) {
  return recordSubstitution(s, i, i + 1, closingBacktick(s.text, i));
}

function readQuoted(s, i) {
  const quote = s.text[i];
  let j = i + 1;
  while (j < s.text.length && s.text[j] !== quote) {
    if (quote === '"' && s.text[j] === s.escape) {
      const escaped = quotedEscape(s, j);
      s.word += escaped.text;
      j += escaped.width;
    } else if (quote === '"' && s.text.startsWith(SUBSTITUTION_OPEN, j)) {
      const body = j + SUBSTITUTION_OPEN.length;
      const close = closingParen(s.text, body, s.escape);
      j = recordSubstitution(s, j, body, close) + 1;
    } else if (quote === '"' && isBashBacktick(s, j)) {
      j = readBacktickSpan(s, j) + 1;
    } else {
      s.word += s.text[j];
      j++;
    }
  }
  s.inWord = true;
  return j;
}

function readHeredoc(s, i) {
  const match = heredocAt(s.text, i);
  if (!match) return null;
  s.pending.push(match[2]);
  return i + match[0].length - 1;
}

function readHereString(s, i) {
  const match = HERE_STRING_OPEN.exec(s.text.slice(i));
  if (!match || (s.inWord && !s.word.endsWith("="))) return null;
  const close = `${match[1]}@`;
  s.word += "(here-string)";
  s.inWord = true;
  const lineEnd = skipLinesUntil(s.text, i + match[0].length, (line) =>
    line.startsWith(close),
  );
  const lineStart = s.text.lastIndexOf("\n", lineEnd - 1) + 1;
  return s.text.startsWith(close, lineStart)
    ? lineStart + close.length - 1
    : lineEnd;
}

function readArithmetic(s, i) {
  if (!s.text.startsWith("$((", i)) return null;
  const close = closingParen(s.text, i + SUBSTITUTION_OPEN.length, s.escape);
  s.word += s.text.slice(i, close + 1);
  s.inWord = true;
  return close;
}

function skipComment(s, i) {
  if (s.inWord) return null;
  const end = s.text.indexOf("\n", i);
  return (end === -1 ? s.text.length : end) - 1;
}

function skipBlockComment(s, i) {
  if (!s.powershell || !s.text.startsWith(BLOCK_COMMENT_OPEN, i)) return null;
  const end = s.text.indexOf(
    BLOCK_COMMENT_CLOSE,
    i + BLOCK_COMMENT_OPEN.length,
  );
  return end === -1 ? s.text.length : end + BLOCK_COMMENT_CLOSE.length - 1;
}

const isBlank = (c) => c === undefined || /[\s;]/.test(c);

function isSeparator(s, i) {
  const c = s.text[i];
  if (c === ";" || c === "|" || c === "(" || c === ")") return true;
  if (c === "&") return s.text[i - 1] !== ">" && s.text[i + 1] !== ">";
  if (c === "{" || c === "}") return !s.inWord && isBlank(s.text[i + 1]);
  return false;
}

function endLine(s, i) {
  const at = skipHeredocBodies(s.text, i, s.pending);
  endSegment(s, i);
  s.start = at + 1;
  return at;
}

// Ends the word before an unquoted `>` or `<`, unless the word so far is the start of that redirect.
function splitBeforeRedirect(s) {
  if (REDIRECT_SO_FAR.test(s.word)) return;
  if (!s.word.endsWith("&")) {
    endWord(s);
    return;
  }
  s.word = s.word.slice(0, -1);
  endWord(s);
  s.word = "&";
  s.inWord = true;
}

const READERS = new Map([
  ["'", readQuoted],
  ['"', readQuoted],
  ["#", skipComment],
  ["$", readArithmetic],
  ["@", readHereString],
  ["<", (s, i) => skipBlockComment(s, i) ?? readHeredoc(s, i)],
  [BACKTICK, (s, i) => (isBashBacktick(s, i) ? readBacktickSpan(s, i) : null)],
  ["\n", endLine],
]);

// Returns the index scanning resumes after, having consumed the construct at `i`.
function scanAt(s, i) {
  const c = s.text[i];
  if (c === s.escape && i + 1 < s.text.length) {
    const next = s.text[i + 1];
    return next === "\n" ? i + 1 : appendChar(s, next, i + 1);
  }
  const consumed = READERS.get(c)?.(s, i);
  if (consumed !== null && consumed !== undefined) return consumed;
  if (/\s/.test(c)) {
    endWord(s);
    return i;
  }
  if (isSeparator(s, i)) {
    endSegment(s, i);
    return i;
  }
  if (c === ">" || c === "<") splitBeforeRedirect(s);
  return appendChar(s, c, i);
}

/** The simple commands of a command line, in order, each as `{ words, text, substitutions }`. */
export function scanSegments(text, shell = SHELL.BASH) {
  const s = newScan(text, shell);
  for (let i = 0; i < text.length; i++) i = scanAt(s, i);
  endSegment(s, text.length);
  return s.segments;
}

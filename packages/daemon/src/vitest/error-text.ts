const CAUSE_LABEL = "caused by: ";
const MEMBER_LABEL = "includes: ";
const NESTED_INDENT = "  ";
const MAX_ERROR_DEPTH = 32;
const DEPTH_CUT_TEXT = `errors nested deeper than ${MAX_ERROR_DEPTH} levels are not shown`;

/** Vitest reports worker errors as serialized plain objects, so a `message` field counts as an error. */
export function errorText(error: unknown): string {
  return errorLines(error, new Set(), 0).join(`\n${NESTED_INDENT}`);
}

function errorLines(
  error: unknown,
  seen: Set<object>,
  depth: number,
): string[] {
  if (depth > MAX_ERROR_DEPTH) return [DEPTH_CUT_TEXT];
  if (typeof error === "object" && error !== null) {
    if (seen.has(error)) return [];
    seen.add(error);
  }
  const members = error instanceof AggregateError ? error.errors : [];
  const cause = fieldOf(error, "cause");
  return [
    messageOf(error),
    ...members.flatMap((member) =>
      labelled(MEMBER_LABEL, errorLines(member, seen, depth + 1)),
    ),
    ...(cause === undefined
      ? []
      : labelled(CAUSE_LABEL, errorLines(cause, seen, depth + 1))),
  ];
}

function labelled(label: string, lines: string[]): string[] {
  const [first, ...rest] = lines;
  if (first === undefined) return [];
  return [`${label}${first}`, ...rest.map((line) => `${NESTED_INDENT}${line}`)];
}

function messageOf(error: unknown): string {
  const message = fieldOf(error, "message");
  if (typeof message === "string") return message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

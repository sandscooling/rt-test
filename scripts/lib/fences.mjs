// Classifies each Markdown line as prose, a fence marker, or code inside a
// fence. A fence closes only on a bare marker of its own character at least as
// long as its opener. An opener that never closes fences nothing, so a stray
// marker cannot hide the headings, tickets, or rules after it.

const OPENER = /^\s*(?:(`{3,})[^`]*|(~{3,}).*)$/;
const CLOSER = /^\s*(`{3,}|~{3,})\s*$/;

function closes(opener, line) {
  const marker = CLOSER.exec(line)?.[1];
  return (
    marker !== undefined &&
    marker[0] === opener[0] &&
    marker.length >= opener.length
  );
}

export function fenceKinds(lines) {
  const kinds = lines.map(() => "prose");
  let index = 0;
  while (index < lines.length) {
    const match = OPENER.exec(lines[index]);
    const opener = match?.[1] ?? match?.[2];
    const end =
      opener === undefined
        ? -1
        : lines.findIndex((line, at) => at > index && closes(opener, line));
    if (end === -1) {
      index += 1;
      continue;
    }
    kinds.fill("code", index + 1, end);
    kinds[index] = "marker";
    kinds[end] = "marker";
    index = end + 1;
  }
  return kinds;
}

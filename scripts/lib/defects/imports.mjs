import { posix } from "node:path";

const RELATIVE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;
const TS_SOURCE_FOR = [
  [".js", ".ts"],
  [".mjs", ".mts"],
];

function resolveImport(files, from, specifier) {
  const path = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (files.has(path)) return path;
  for (const [js, ts] of TS_SOURCE_FOR) {
    const source = `${path.slice(0, -js.length)}${ts}`;
    if (path.endsWith(js) && files.has(source)) return source;
  }
  return null;
}

function directImports(files, path) {
  const text = files.get(path)?.toString("utf8") ?? "";
  return [...text.matchAll(RELATIVE_IMPORT)]
    .map((match) => resolveImport(files, path, match[1]))
    .filter((resolved) => resolved !== null);
}

export function importClosures(files) {
  const direct = new Map();
  const closures = new Map();
  const importsOf = (path) => {
    if (!direct.has(path)) direct.set(path, directImports(files, path));
    return direct.get(path);
  };
  const walk = (start) => {
    const seen = new Set([start]);
    const pending = [start];
    while (pending.length) {
      for (const next of importsOf(pending.pop())) {
        if (seen.has(next)) continue;
        seen.add(next);
        pending.push(next);
      }
    }
    return seen;
  };
  return (start) => {
    if (!closures.has(start)) closures.set(start, walk(start));
    return closures.get(start);
  };
}

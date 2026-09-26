import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fenceKinds } from "../fences.mjs";

export function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${error.message}`, { cause: error });
  }
}

export function display(config, path) {
  return relative(config.root, path).replaceAll("\\", "/");
}

// Fenced blocks hold format examples, never planning facts.
export function proseLines(text) {
  const lines = text.split(/\r?\n/);
  const kinds = fenceKinds(lines);
  return lines.flatMap((line, index) =>
    kinds[index] === "prose" ? [{ text: line, number: index + 1 }] : [],
  );
}

export function planningFiles(dir, { optional = false } = {}) {
  if (optional && !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort()
    .map((name) => ({ name, path: join(dir, name) }));
}

export function passed(lines) {
  return { code: 0, out: `${lines.join("\n")}\n`, err: "" };
}

export function failed(problems) {
  return { code: 1, out: "", err: `${problems.join("\n")}\n` };
}

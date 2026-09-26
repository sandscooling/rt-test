import { posix } from "node:path";
import { changedPaths } from "../git.mjs";
import { isInSandboxDir, SANDBOX_FILES } from "./catalog.mjs";
import { importClosures } from "./imports.mjs";

const ROOT_INPUTS = new Set(["vitest.config.ts", "package.json", "bun.lock"]);
const DECLARATION = /\.d\.m?ts$/;
const RECORDS = "defects.json";

export function requireChangeset(git) {
  const changeset = changedPaths(git);
  if (changeset.error !== undefined) {
    throw new Error(
      `--changed needs git to compare with HEAD: ${changeset.error}`,
    );
  }
  return new Set(changeset.paths);
}

const recordText = ({ id, defect, file, old, new: replacement }) =>
  JSON.stringify({ id, defect, file, old, new: replacement });

export function headRecordsIn(git) {
  return (source) => {
    const shown = git(["show", `HEAD:${source}`]);
    if (!shown.ok) return new Map();
    return new Map(
      JSON.parse(shown.out).map((record) => [record.id, recordText(record)]),
    );
  };
}

const isVerifierInput = (path, files) =>
  files.has(path) ||
  ROOT_INPUTS.has(path) ||
  SANDBOX_FILES.includes(path) ||
  isInSandboxDir(path);

const needsAttribution = (path, files) =>
  isVerifierInput(path, files) &&
  !DECLARATION.test(path) &&
  posix.basename(path) !== RECORDS;

function reasonsFor(defect, changed, headRecords, reach) {
  const reasons = [];
  if (
    changed.has(defect.source) &&
    headRecords(defect.source).get(defect.id) !== recordText(defect)
  ) {
    reasons.push("record changed");
  }
  if (changed.has(defect.test)) reasons.push("test file changed");
  if (changed.has(defect.file)) reasons.push("mutated file changed");
  const imported = [...reach].filter(
    (path) => path !== defect.test && path !== defect.file,
  );
  if (imported.some((path) => changed.has(path))) {
    reasons.push("an import of its test or mutated file changed");
  }
  return reasons;
}

function unattributedPaths(catalog, changed, reaches) {
  const reached = new Set([...reaches.values()].flatMap((reach) => [...reach]));
  return [...changed]
    .filter((path) => needsAttribution(path, catalog.files))
    .filter((path) => !reached.has(path))
    .sort();
}

export function selectChanged(catalog, changed, headRecords) {
  const closureOf = importClosures(catalog.files);
  const reaches = new Map(
    catalog.defects.map((defect) => [
      defect,
      new Set([...closureOf(defect.test), ...closureOf(defect.file)]),
    ]),
  );
  const unattributed = unattributedPaths(catalog, changed, reaches);
  const cache = new Map();
  const cachedHead = (source) => {
    if (!cache.has(source)) cache.set(source, headRecords(source));
    return cache.get(source);
  };
  const picks = catalog.defects.flatMap((defect) => {
    const reach = reaches.get(defect);
    const reasons = reasonsFor(defect, changed, cachedHead, reach);
    if (unattributed.length) reasons.push("a change no import explains");
    return reasons.length ? [{ defect, reasons }] : [];
  });
  return { picks, unattributed };
}

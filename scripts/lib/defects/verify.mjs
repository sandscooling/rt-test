import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { gitIn } from "../git.mjs";
import { isAtOrInside } from "../paths.mjs";
import { loadCatalog, recordLinks, snapshotFiles } from "./catalog.mjs";
import {
  CHANGED_FLAG,
  headRecordsIn,
  requireChangeset,
  selectChanged,
  selectEdited,
} from "./changed.mjs";
import { treeDifference, verifyInSandboxes } from "./pool.mjs";
import { createVitestRunner, testFilesOf } from "./vitest.mjs";

const MIN_JOBS = 1;
const SHARE_OF_CORES = 3 / 4;
const DECIMAL_DIGITS = /^\d+$/;
const PACKAGES_DIR = "node_modules";
const ID_SEPARATORS = /[\s,]+/;
const SELECTOR = Object.freeze({
  CHANGED: CHANGED_FLAG,
  EDITED: "--edited",
  IDS: "--ids",
});
const NAMED_BY_ID = `named by ${SELECTOR.IDS}`;
const ID_LIST_EXAMPLE = `${SELECTOR.IDS} D12,D40`;

export const defaultJobs = (cores) =>
  Math.max(MIN_JOBS, Math.floor(cores * SHARE_OF_CORES));

function jobsFrom(text, cores) {
  if (text === undefined) return defaultJobs(cores);
  return DECIMAL_DIGITS.test(text) ? Number(text) : Number.NaN;
}

function idsIn(list) {
  const ids = list.split(ID_SEPARATORS).filter((id) => id !== "");
  if (ids.length === 0) {
    throw new Error(
      `${SELECTOR.IDS} "${list}" names no defect; write ids such as ${ID_LIST_EXAMPLE}.`,
    );
  }
  return ids;
}

const idsFrom = (lists) => [...new Set(lists.flatMap(idsIn))];

export function parseOptions(argv, cores) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      changed: { type: "boolean", default: false },
      edited: { type: "boolean", default: false },
      ids: { type: "string", multiple: true, default: [] },
      jobs: { type: "string" },
    },
  });
  if (positionals.length > 0) {
    const remedy = values.ids.length
      ? "write several ids as one list"
      : `name defects with ${SELECTOR.IDS}`;
    throw new Error(
      `${positionals.join(" ")} is not an option; ${remedy}, such as ${ID_LIST_EXAMPLE}.`,
    );
  }
  const jobs = jobsFrom(values.jobs, cores);
  if (!Number.isInteger(jobs) || jobs < MIN_JOBS) {
    throw new Error(
      `--jobs takes a whole number of sandboxes, at least ${MIN_JOBS}.`,
    );
  }
  return {
    changed: values.changed,
    edited: values.edited,
    ids: idsFrom(values.ids),
    jobs,
  };
}

const selectorsOf = (options) => [
  ...(options.changed ? [SELECTOR.CHANGED] : []),
  ...(options.edited ? [SELECTOR.EDITED] : []),
  ...(options.ids.length > 0 ? [SELECTOR.IDS] : []),
];

function pickByIds(catalog, ids) {
  const wanted = new Set(ids);
  const picks = catalog.defects
    .filter((defect) => wanted.has(defect.id))
    .map((defect) => ({ defect, reasons: [NAMED_BY_ID] }));
  const found = new Set(picks.map(({ defect }) => defect.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new Error(
      `${SELECTOR.IDS} names ${missing.join(", ")}, which no defects.json records.`,
    );
  }
  return picks;
}

function pickChanged(catalog, changeset, headRecords, log) {
  const { picks, unattributed } = selectChanged(
    catalog,
    changeset,
    headRecords,
  );
  if (unattributed.length) {
    log(
      `${SELECTOR.CHANGED} selects every defect: no import explains ${unattributed.join(", ")}.`,
    );
  }
  return picks;
}

function picksFor(catalog, options, selectors, git, log) {
  const picks = pickByIds(catalog, options.ids);
  const needingGit = selectors.filter((selector) => selector !== SELECTOR.IDS);
  if (needingGit.length === 0) return picks;
  const changeset = requireChangeset(git, needingGit.join(" with "));
  const headRecords = headRecordsIn(git);
  if (options.edited) {
    picks.push(...selectEdited(catalog, changeset, headRecords));
  }
  if (options.changed) {
    picks.push(...pickChanged(catalog, changeset, headRecords, log));
  }
  return picks;
}

function pickSelected(catalog, options, selectors, git, log) {
  const reasons = new Map();
  for (const pick of picksFor(catalog, options, selectors, git, log)) {
    const known = reasons.get(pick.defect) ?? [];
    reasons.set(pick.defect, new Set([...known, ...pick.reasons]));
  }
  const selected = catalog.defects.filter((defect) => reasons.has(defect));
  log(
    `${selectors.join(", ")} selected ${selected.length} of ${catalog.defects.length} defects; the full run in \`bun run check\` is the gate.`,
  );
  for (const defect of selected) {
    log(`  ${defect.id}: ${[...reasons.get(defect)].join(", ")}`);
  }
  return selected;
}

function packagesAbove(dir) {
  for (let at = dir; ; at = dirname(at)) {
    const packages = join(at, PACKAGES_DIR);
    if (existsSync(packages)) return packages;
    if (dirname(at) === at) return null;
  }
}

// A sandbox inside the repository, or below any node_modules, would resolve an
// unlinked import upward instead of failing.
function sandboxParent(root) {
  const parent = realpathSync.native(tmpdir());
  const repo = realpathSync.native(root);
  if (isAtOrInside(repo, parent)) {
    throw new Error(
      `The temp directory ${parent} lies inside ${repo}; point it outside the repository.`,
    );
  }
  const stray = packagesAbove(parent);
  if (stray) {
    throw new Error(
      `${stray} would answer any import a sandbox under ${parent} leaves unlinked; remove it or point the temp directory elsewhere.`,
    );
  }
  return parent;
}

const linkText = (link) => `${link.path} -> ${link.target}`;

function linkDifference(expected, actual) {
  const before = expected.map(linkText);
  const after = actual.map(linkText);
  return (
    after.find((link) => !before.includes(link)) ??
    before.find((link) => !after.includes(link)) ??
    null
  );
}

function assertLiveUnchanged(root, catalog, log) {
  const changed = treeDifference(catalog.files, snapshotFiles(root));
  if (changed) {
    throw new Error(
      `Working files changed during verification (${changed}); rerun on a stable revision.`,
    );
  }
  const relinked = linkDifference(catalog.links, recordLinks(root));
  if (relinked) {
    throw new Error(
      `Dependency links changed during verification (${relinked}); rerun once no install is running.`,
    );
  }
  const watched = new Set([
    ...testFilesOf(catalog.defects),
    ...catalog.defects.map((defect) => defect.file),
  ]);
  for (const file of [...watched].sort()) {
    const digest = createHash("sha256")
      .update(catalog.files.get(file))
      .digest("hex");
    log(`${file} SHA-256: ${digest}`);
  }
}

function logFilteredScope({ selected, total, selectors }, log) {
  if (selectors.length) {
    log(
      `Selected by ${selectors.join(", ")}: ${selected.length} of ${total} defects; this is not the full run.`,
    );
  }
}

function summarize(result, counts, log) {
  const { selected, selectors } = counts;
  for (const failure of result.failures) log(`FAILED ${failure}`);
  if (result.undetected.length) {
    log(`Not detected: ${result.undetected.join(", ")}`);
  }
  const scope = selectors.length ? "selected" : "bootstrap";
  const sandboxes =
    result.sandboxes === 1 ? "1 sandbox" : `${result.sandboxes} sandboxes`;
  log(
    result.ok
      ? `${selected.length}/${selected.length} ${scope} defects detected in ${sandboxes}; baseline green before and after, sandboxes restored.`
      : `${result.detected.length}/${selected.length} ${scope} defects detected; verification failed.`,
  );
  logFilteredScope(counts, log);
}

export async function runVerification({
  root,
  argv = [],
  log = console.log,
  runTests = createVitestRunner({ root }),
  git = gitIn(root),
  cores = availableParallelism(),
}) {
  const options = parseOptions(argv, cores);
  const catalog = loadCatalog(root);
  if (catalog.defects.length === 0) {
    throw new Error(
      "No named defect was found, so verification would prove nothing.",
    );
  }
  const selectors = selectorsOf(options);
  const selected = selectors.length
    ? pickSelected(catalog, options, selectors, git, log)
    : catalog.defects;
  const counts = { selected, total: catalog.defects.length, selectors };
  if (selected.length === 0) {
    assertLiveUnchanged(root, catalog, log);
    log("No defect was verified.");
    logFilteredScope(counts, log);
    return 0;
  }
  const files = new Set(testFilesOf(selected));
  const result = await verifyInSandboxes({
    files: catalog.files,
    links: catalog.links,
    baseline: catalog.defects.filter((defect) => files.has(defect.test)),
    baselineFiles: selectors.length ? [...files] : undefined,
    selected,
    jobs: options.jobs,
    runTests,
    parent: sandboxParent(root),
    log,
  });
  assertLiveUnchanged(root, catalog, log);
  summarize(result, counts, log);
  return result.ok ? 0 : 1;
}

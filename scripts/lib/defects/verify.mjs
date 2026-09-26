import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { gitIn } from "../git.mjs";
import { isAtOrInside } from "../paths.mjs";
import { loadCatalog, recordLinks, snapshotFiles } from "./catalog.mjs";
import { headRecordsIn, requireChangeset, selectChanged } from "./changed.mjs";
import { treeDifference, verifyInSandboxes } from "./pool.mjs";
import { createVitestRunner, testFilesOf } from "./vitest.mjs";

const MIN_JOBS = 1;
const SHARE_OF_CORES = 3 / 4;
const DECIMAL_DIGITS = /^\d+$/;
const PACKAGES_DIR = "node_modules";

export const defaultJobs = (cores) =>
  Math.max(MIN_JOBS, Math.floor(cores * SHARE_OF_CORES));

function jobsFrom(text, cores) {
  if (text === undefined) return defaultJobs(cores);
  return DECIMAL_DIGITS.test(text) ? Number(text) : Number.NaN;
}

export function parseOptions(argv, cores) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      changed: { type: "boolean", default: false },
      jobs: { type: "string" },
    },
  });
  const jobs = jobsFrom(values.jobs, cores);
  if (!Number.isInteger(jobs) || jobs < MIN_JOBS) {
    throw new Error(
      `--jobs takes a whole number of sandboxes, at least ${MIN_JOBS}.`,
    );
  }
  return { changed: values.changed, jobs };
}

function pickChanged(catalog, git, log) {
  const { picks, unattributed } = selectChanged(
    catalog,
    requireChangeset(git),
    headRecordsIn(git),
  );
  if (unattributed.length) {
    log(
      `--changed selects every defect: no import explains ${unattributed.join(", ")}.`,
    );
  }
  log(
    `--changed selected ${picks.length} of ${catalog.defects.length} defects; the full run in \`bun run check\` is the gate.`,
  );
  for (const { defect, reasons } of picks) {
    log(`  ${defect.id}: ${reasons.join(", ")}`);
  }
  return picks.map((pick) => pick.defect);
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

function summarize(result, selected, options, log) {
  for (const failure of result.failures) log(`FAILED ${failure}`);
  if (result.undetected.length) {
    log(`Not detected: ${result.undetected.join(", ")}`);
  }
  const scope = options.changed ? "changed" : "bootstrap";
  const sandboxes =
    result.sandboxes === 1 ? "1 sandbox" : `${result.sandboxes} sandboxes`;
  log(
    result.ok
      ? `${selected.length}/${selected.length} ${scope} defects detected in ${sandboxes}; baseline green before and after, sandboxes restored.`
      : `${result.detected.length}/${selected.length} ${scope} defects detected; verification failed.`,
  );
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
  const selected = options.changed
    ? pickChanged(catalog, git, log)
    : catalog.defects;
  if (selected.length === 0) {
    assertLiveUnchanged(root, catalog, log);
    log("No defect was verified.");
    return 0;
  }
  const files = new Set(testFilesOf(selected));
  const result = await verifyInSandboxes({
    files: catalog.files,
    links: catalog.links,
    baseline: catalog.defects.filter((defect) => files.has(defect.test)),
    baselineFiles: options.changed ? [...files] : undefined,
    selected,
    jobs: options.jobs,
    runTests,
    parent: sandboxParent(root),
    log,
  });
  assertLiveUnchanged(root, catalog, log);
  summarize(result, selected, options, log);
  return result.ok ? 0 : 1;
}

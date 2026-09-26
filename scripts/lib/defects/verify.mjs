import { createHash } from "node:crypto";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gitIn } from "../git.mjs";
import { loadCatalog, snapshotFiles } from "./catalog.mjs";
import { headRecordsIn, requireChangeset, selectChanged } from "./changed.mjs";
import { treeDifference, verifyInSandboxes } from "./pool.mjs";
import { createVitestRunner, testFilesOf } from "./vitest.mjs";

const MIN_JOBS = 1;
const SHARE_OF_CORES = 3 / 4;
const DECIMAL_DIGITS = /^\d+$/;
const SCRATCH_DIR = "_agent-docs/.scratch";

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

function assertLiveUnchanged(root, catalog, log) {
  const changed = treeDifference(catalog.files, snapshotFiles(root));
  if (changed) {
    throw new Error(
      `Working files changed during verification (${changed}); rerun on a stable revision.`,
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
    baseline: catalog.defects.filter((defect) => files.has(defect.test)),
    baselineFiles: options.changed ? [...files] : undefined,
    selected,
    jobs: options.jobs,
    runTests,
    scratch: join(root, SCRATCH_DIR),
    log,
  });
  assertLiveUnchanged(root, catalog, log);
  summarize(result, selected, options, log);
  return result.ok ? 0 : 1;
}

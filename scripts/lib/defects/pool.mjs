import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { toPosix, walkTree } from "./catalog.mjs";
import { baselineProblem, detectionProblem } from "./vitest.mjs";

const VITEST_RESULTS_CACHE = /(^|\/)node_modules\/\.vite\/vitest(\/|$)/;

function assertInside(parent, child) {
  const path = relative(parent, child);
  if (
    !path ||
    path.startsWith(`..${sep}`) ||
    path === ".." ||
    isAbsolute(path)
  ) {
    throw new Error("Refusing a sandbox outside the task scratch directory.");
  }
}

export function writeTree(dir, files) {
  for (const [path, content] of files) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

// Node resolves a junction's relative target against the link's directory,
// so one relative target serves a Windows junction and a POSIX symlink.
function writeLinks(dir, links) {
  for (const link of links) {
    const path = join(dir, link.path);
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(
      relative(dirname(path), join(dir, link.target)),
      path,
      "junction",
    );
  }
}

function readTree(dir) {
  return new Map(
    walkTree(dir)
      .files.filter((file) => !VITEST_RESULTS_CACHE.test(file))
      .map((file) => [file, readFileSync(join(dir, file))]),
  );
}

const targetIn = (dir, path) =>
  toPosix(
    relative(
      dir,
      resolve(dirname(join(dir, path)), readlinkSync(join(dir, path))),
    ),
  );

function linkDifference(dir, expected) {
  const actual = walkTree(dir).links;
  for (const link of expected) {
    if (!actual.includes(link.path) || targetIn(dir, link.path) !== link.target)
      return link.path;
  }
  return (
    actual.find((path) => !expected.some((link) => link.path === path)) ?? null
  );
}

export function treeDifference(expected, actual) {
  for (const [path, content] of expected) {
    if (!actual.get(path)?.equals(content)) return path;
  }
  return [...actual.keys()].find((path) => !expected.has(path)) ?? null;
}

async function checkBaseline(ctx, slot) {
  const result = await ctx.runTests({
    sandbox: slot.sandbox,
    report: slot.report,
    files: ctx.baselineFiles,
  });
  return baselineProblem(result, slot.sandbox, ctx.baseline, ctx.baselineFiles);
}

async function detect(ctx, slot, defect) {
  try {
    const result = await ctx.runTests({
      sandbox: slot.sandbox,
      report: slot.report,
      files: [defect.test],
      pattern: defect.id,
    });
    return detectionProblem(result, slot.sandbox, defect);
  } catch (error) {
    return error.message;
  }
}

async function verifyOne(ctx, slot, defect) {
  const original = ctx.files.get(defect.file);
  const target = join(slot.sandbox, defect.file);
  const mutated = original
    .toString("utf8")
    // A replacer function inserts `new` literally; a string would expand `$&`.
    .replace(defect.old, () => defect.new);
  writeFileSync(target, mutated);
  const problem = await detect(ctx, slot, defect);
  writeFileSync(target, original);
  if (problem) {
    ctx.failures.push(`${defect.id}: ${problem}.`);
    return;
  }
  ctx.detected.push(defect.id);
  ctx.log(`${defect.id}: detected (${defect.defect})`);
}

function assertSnapshot(ctx, slot) {
  const changed = treeDifference(ctx.files, readTree(slot.sandbox));
  const relinked = linkDifference(slot.sandbox, ctx.links);
  if (changed || relinked) {
    throw new Error(
      `sandbox ${slot.index}: ${changed ?? relinked} differs from the snapshot.`,
    );
  }
}

async function worker(ctx, slot) {
  try {
    for (;;) {
      const defect = ctx.stopped ? undefined : ctx.queue.shift();
      if (!defect) break;
      await verifyOne(ctx, slot, defect);
    }
    assertSnapshot(ctx, slot);
  } catch (error) {
    ctx.stopped = true;
    ctx.failures.push(error.message);
  }
}

async function verifyAll(ctx, slots) {
  for (const slot of slots) {
    writeTree(slot.sandbox, ctx.files);
    writeLinks(slot.sandbox, ctx.links);
    assertSnapshot(ctx, slot);
  }
  const before = await checkBaseline(ctx, slots[0]);
  if (before) throw new Error(`before any mutation: ${before}.`);
  await Promise.all(slots.map((slot) => worker(ctx, slot)));
  if (ctx.failures.length) return;
  const after = await checkBaseline(ctx, slots[0]);
  if (after) throw new Error(`after every mutation: ${after}.`);
}

export async function verifyInSandboxes({
  files,
  links = [],
  baseline,
  baselineFiles,
  selected,
  jobs,
  runTests,
  scratch,
  log,
}) {
  mkdirSync(scratch, { recursive: true });
  const run = mkdtempSync(join(scratch, "defects-"));
  assertInside(scratch, run);
  const ctx = {
    files,
    links,
    baseline,
    baselineFiles,
    queue: [...selected],
    runTests,
    run,
    log,
    stopped: false,
    detected: [],
    failures: [],
  };
  const count = Math.max(1, Math.min(jobs, selected.length));
  const slots = Array.from({ length: count }, (_, index) => ({
    index,
    sandbox: join(run, `sandbox-${index}`),
    report: join(run, `report-${index}.json`),
  }));
  try {
    await verifyAll(ctx, slots);
  } catch (error) {
    ctx.failures.push(error.message);
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
  const detected = new Set(ctx.detected);
  const undetected = selected
    .map((defect) => defect.id)
    .filter((id) => !detected.has(id));
  return {
    detected: ctx.detected,
    failures: ctx.failures,
    ok: ctx.failures.length === 0 && undetected.length === 0,
    sandboxes: slots.length,
    undetected,
  };
}

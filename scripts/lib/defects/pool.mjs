import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { toPosix } from "./catalog.mjs";
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

function readTree(dir) {
  return new Map(
    readdirSync(dir, { recursive: true })
      .map((file) => toPosix(String(file)))
      .filter((file) => !VITEST_RESULTS_CACHE.test(file))
      .filter((file) => statSync(join(dir, file)).isFile())
      .map((file) => [file, readFileSync(join(dir, file))]),
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
  if (changed) {
    throw new Error(
      `sandbox ${slot.index}: ${changed} differs from the snapshot.`,
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

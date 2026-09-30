/**
 * A setup file RT Test puts first in every project of a falsification run. It defines the recorder each reach probe
 * calls and marks, on each test's metadata, whether the probe fired during that test or outside it. It imports no
 * package, since it runs in the consumer's worker, where a package name resolves to the consumer's install.
 */

import {
  REACH_META_KEY,
  REACH_RECORDER,
  type ReachMark,
} from "./reach-names.js";

interface RunnerTask {
  readonly type: "test" | "suite";
  readonly suite?: RunnerTask;
  readonly file: RunnerTask;
  readonly meta: { [REACH_META_KEY]?: ReachMark };
}

interface HookContext {
  readonly task: RunnerTask;
  readonly onTestFinished: (hook: () => void) => void;
}

type EachHook = (context: HookContext) => void;

interface VitestIndex {
  readonly beforeEach: (hook: EachHook) => void;
  readonly afterEach: (hook: EachHook) => void;
}

interface VitestWorker {
  readonly current?: RunnerTask;
}

interface ReachGlobals {
  readonly __vitest_index__?: VitestIndex;
  readonly __vitest_worker__?: VitestWorker;
  [REACH_RECORDER]?: () => void;
}

const OBSERVED: ReachMark = { observed: true };
const IN_TEST: ReachMark = { observed: true, inTest: true };
const OUTSIDE_TEST: ReachMark = { observed: true, outsideTest: true };
const UNATTRIBUTED: ReachMark = { observed: true, unattributed: true };

const globals = globalThis as ReachGlobals;
const index = globals.__vitest_index__;
const worker = globals.__vitest_worker__;
if (index === undefined || worker === undefined) {
  const missing =
    index === undefined ? "__vitest_index__" : "__vitest_worker__";
  throw new Error(
    `RT Test found no Vitest ${missing} in this worker, so it cannot record which tests reach a mutation`,
  );
}

/* State lives for one test file: each file imports this module fresh in its own worker, and every key is its task. */
const running = new Set<RunnerTask>();
const firedOutside = new Set<RunnerTask>();
let firedAtFileLevel = false;

function merge(task: RunnerTask, addition: ReachMark): void {
  task.meta[REACH_META_KEY] = { ...task.meta[REACH_META_KEY], ...addition };
}

function runningTest(current: RunnerTask | undefined): RunnerTask | undefined {
  const [only] = running;
  if (only !== undefined) {
    return only;
  }
  return current?.type === "test" ? current : undefined;
}

function record(): void {
  if (running.size > 1) {
    for (const task of running) {
      merge(task, UNATTRIBUTED);
    }
    return;
  }
  const current = worker?.current;
  const test = runningTest(current);
  if (test !== undefined) {
    merge(test, IN_TEST);
  } else if (current === undefined) {
    firedAtFileLevel = true;
  } else {
    firedOutside.add(current);
  }
}

function firedOutsideAround(test: RunnerTask): boolean {
  if (firedAtFileLevel || firedOutside.has(test.file)) {
    return true;
  }
  for (let suite = test.suite; suite !== undefined; suite = suite.suite) {
    if (firedOutside.has(suite)) {
      return true;
    }
  }
  return false;
}

globals[REACH_RECORDER] = () => {
  try {
    record();
  } catch {
    // A probe never changes what the consumer's module does; a lost firing leaves the mark reading not executed.
  }
};

index.beforeEach(({ task, onTestFinished }) => {
  merge(task, OBSERVED);
  running.add(task);
  onTestFinished(() => running.delete(task));
  if (firedOutsideAround(task)) {
    merge(task, OUTSIDE_TEST);
  }
});

/* A throwing consumer `afterEach` skips this one, and a dynamic `ctx.skip()` skips `onTestFinished`, so both end the test. */
index.afterEach(({ task }) => {
  running.delete(task);
});

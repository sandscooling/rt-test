/** Starts each stdout line this reporter writes, so the runner tells progress from other output. */
export const PROGRESS_MARKER = "rt-test-progress ";

export const PROGRESS_EVENT = Object.freeze({
  LIMITS: "limits",
  COLLECTED: "collected",
  STARTED: "started",
  FINISHED: "finished",
  HOOK_STARTED: "hook-started",
  HOOK_FINISHED: "hook-finished",
});

function emit(event) {
  process.stdout.write(`${PROGRESS_MARKER}${JSON.stringify(event)}\n`);
}

const testName = (testCase) =>
  `${testCase.module.moduleId} > ${testCase.fullName}`;

const retriesOf = (retry) =>
  typeof retry === "number" ? retry : (retry?.count ?? 0);

/** How long a test may run between its start and its result: every retry and repeat under its own timeout. */
function silenceBound({ timeout = 0, retry, repeats = 0 }) {
  return timeout * (retriesOf(retry) + 1) * (repeats + 1);
}

/** A Vitest reporter that writes one line per collected module, test and hook, as a liveness signal. */
export default class ProgressReporter {
  onInit(vitest) {
    emit({
      event: PROGRESS_EVENT.LIMITS,
      teardownTimeout: vitest.config.teardownTimeout,
      hookTimeouts: vitest.projects.map((project) => ({
        project: project.name,
        timeout: project.config.hookTimeout,
      })),
    });
  }

  onTestModuleCollected(testModule) {
    emit({ event: PROGRESS_EVENT.COLLECTED, module: testModule.moduleId });
  }

  onTestCaseReady(testCase) {
    emit({
      event: PROGRESS_EVENT.STARTED,
      test: testName(testCase),
      timeout: silenceBound(testCase.options),
    });
  }

  onTestCaseResult(testCase) {
    emit({ event: PROGRESS_EVENT.FINISHED, test: testName(testCase) });
  }

  onHookStart(hook) {
    emit({ event: PROGRESS_EVENT.HOOK_STARTED, hook: hook.name });
  }

  onHookEnd(hook) {
    emit({ event: PROGRESS_EVENT.HOOK_FINISHED, hook: hook.name });
  }
}

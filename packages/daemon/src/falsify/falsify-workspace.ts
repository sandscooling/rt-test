import { readFileSync } from "node:fs";
import type { TestIdentity, TestModuleLocation } from "@rt-test/core";
import type {
  Reporter,
  TestModule,
  TestRunEndReason,
  TestSpecification,
} from "vitest/node";
import { errorText } from "../vitest/error-text.js";
import type { VitestWorkspace } from "../vitest/find-workspaces.js";
import { RunInterruption } from "../vitest/run-interruption.js";
import { CONFIG_NOT_CONFIRMED_REASON } from "../vitest/run-workspace.js";
import {
  inWorkspaceSession,
  queueSessionJob,
  type WorkspaceSession,
} from "../vitest/workspace-session.js";
import {
  FALSIFIER_VERSION,
  recordRun,
  testResultIn,
  type DefectExperiment,
  type ExperimentNotRun,
  type ExperimentRecord,
  type FalsificationJob,
  type JobRuns,
  type RunOutcome,
  type RunRecord,
  type SessionJobFacts,
  type UnrecordedRun,
} from "./experiment-record.js";
import {
  MutationTransform,
  onDiskModuleCaches,
  type Mutation,
  type MutationLoad,
} from "./mutation-transform.js";
import { mutateWithProbe } from "./reach-probe.js";

/** An experiment whose file, anchor and probe site checked out when the job started, with its test's module. */
interface PlannedExperiment {
  readonly experiment: DefectExperiment;
  readonly specification: TestSpecification;
}

interface LocatedSpecification {
  readonly specification: TestSpecification;
  readonly location: TestModuleLocation;
}

type RunStep =
  | {
      readonly kind: "ran";
      readonly record: RunRecord;
      readonly loads: readonly MutationLoad[];
    }
  | { readonly kind: "unrecorded"; readonly unrecorded: UnrecordedRun }
  /** An abort came before the run started or while it ran; an interrupted run leaves no result. */
  | { readonly kind: "interrupted" };

type EndedStep = Exclude<RunStep, { kind: "interrupted" }>;

/** A mutated file's text as the job read it when it started, or why it could not be read. */
type FileText =
  | { readonly read: true; readonly text: string }
  | { readonly read: false; readonly error: string };

const INTERRUPTED: ExperimentNotRun = { kind: "interrupted" };
const INTERRUPTED_STEP: RunStep = { kind: "interrupted" };
const BASELINE_NOT_RUN: ExperimentNotRun = { kind: "baseline-not-run" };
const NO_MODULE: ExperimentNotRun = { kind: "no-module" };
const NOT_REPORTED = "not-reported";
const PASSED = "passed";

/**
 * Runs one workspace's defect experiments in one Vitest instance: the baseline over the intended tests' modules, each
 * experiment over its test's whole module with its own mutation alone applied in memory, then the restored baseline.
 * It executes project code, so call it only for a started, trusted project. An abort ends the job at the run in
 * progress, and the record holds only the runs that finished.
 */
export function falsifyWorkspace(
  workspace: VitestWorkspace,
  confirmedConfigFile: string,
  experiments: readonly DefectExperiment[],
  signal: AbortSignal,
): Promise<FalsificationJob> {
  return queueSessionJob(async () => {
    if (signal.aborted) {
      return { status: "interrupted-before-load", workspace };
    }
    const relay = new RunRelay();
    const result = await inWorkspaceSession(
      workspace,
      confirmedConfigFile,
      [relay],
      (session) => falsifySession(session, experiments, relay, signal),
    );
    if (result.status === "not-confirmed") {
      return { ...result, workspace, reason: CONFIG_NOT_CONFIRMED_REASON };
    }
    if (result.status !== "loaded") return { ...result, workspace };
    const { value, status: _loaded, ...loaded } = result;
    return { ...loaded, ...value, workspace };
  });
}

/**
 * An instance's reporters are fixed at load, so this one forwards each run's events to that run's interruption, and
 * collects the modules Vitest queued during it.
 */
class RunRelay implements Reporter {
  #current: RunInterruption | undefined;
  #queued: TestModule[] = [];

  start(interruption: RunInterruption): void {
    this.#current = interruption;
    this.#queued = [];
  }

  /** The modules queued since `start`; one queued after this joins no run's list. */
  end(): readonly TestModule[] {
    this.#current = undefined;
    const queued = this.#queued;
    this.#queued = [];
    return queued;
  }

  onTestModuleQueued(testModule: TestModule): void {
    this.#queued.push(testModule);
    this.#current?.onTestModuleQueued();
  }

  onTestRunEnd(
    testModules: readonly TestModule[],
    unhandledErrors: readonly unknown[],
    reason: TestRunEndReason,
  ): void {
    this.#current?.onTestRunEnd(testModules, unhandledErrors, reason);
  }
}

async function falsifySession(
  session: WorkspaceSession,
  experiments: readonly DefectExperiment[],
  relay: RunRelay,
  signal: AbortSignal,
): Promise<SessionJobFacts> {
  const loaded = { falsifierVersion: FALSIFIER_VERSION, unhandledErrors: [] };
  const caches = onDiskModuleCaches(session.instance);
  if (caches.length > 0) {
    return {
      ...loaded,
      status: "refused",
      refusal: { kind: "module-cache", caches },
    };
  }
  let transform: MutationTransform;
  try {
    transform = MutationTransform.install(session.instance);
  } catch (error) {
    return {
      ...loaded,
      status: "refused",
      refusal: { kind: "not-prepared", error: errorText(error) },
    };
  }
  const runs = new FalsificationRuns(session, transform, relay, signal);
  return { ...loaded, status: "ran", ...(await runs.all(experiments)) };
}

/** One loaded instance's runs, every one of them through the mutation transform and its stale-transform guard. */
class FalsificationRuns {
  readonly #session: WorkspaceSession;
  readonly #transform: MutationTransform;
  readonly #relay: RunRelay;
  readonly #signal: AbortSignal;
  /** Each specification's module located once, however many experiments name a test in it. */
  readonly #located: readonly LocatedSpecification[];
  /** Each mutated file read once, when the job starts, however many experiments mutate it. */
  readonly #texts = new Map<string, FileText>();
  /** The file the last experiment mutated, invalidated before every later run whatever the guard finds. */
  #lastMutated: string | undefined;

  constructor(
    session: WorkspaceSession,
    transform: MutationTransform,
    relay: RunRelay,
    signal: AbortSignal,
  ) {
    this.#session = session;
    this.#transform = transform;
    this.#relay = relay;
    this.#signal = signal;
    this.#located = session.specifications.map((specification) => ({
      specification,
      location: session.locate(
        specification.project.name,
        specification.moduleId,
      ),
    }));
  }

  async all(experiments: readonly DefectExperiment[]): Promise<JobRuns> {
    const records = new Map<DefectExperiment, ExperimentRecord>();
    const planned = this.#planAll(experiments, records);
    const ordered = (): ExperimentRecord[] =>
      experiments.flatMap((experiment) => {
        const record = records.get(experiment);
        return record === undefined ? [] : [record];
      });
    if (planned.length === 0) {
      return { interrupted: false, experiments: ordered() };
    }
    const modules = uniqueSpecifications(planned);
    const baseline = await this.#run(modules);
    if (baseline.kind === "interrupted") {
      markAll(records, planned, INTERRUPTED);
      return { interrupted: true, experiments: ordered() };
    }
    const { interrupted, anyRan } = await this.#experimentsAfter(
      baseline,
      planned,
      records,
    );
    const shared = { baseline: outcomeOf(baseline), experiments: ordered() };
    if (interrupted) return { ...shared, interrupted: true };
    if (!anyRan) return { ...shared, interrupted: false };
    const restored = await this.#run(modules);
    if (restored.kind === "interrupted") {
      return { ...shared, interrupted: true };
    }
    return {
      ...shared,
      interrupted: false,
      restoredBaseline: outcomeOf(restored),
    };
  }

  /** Callable again for the same experiment in the same instance, as a confirming run needs. */
  async experiment(plan: PlannedExperiment): Promise<ExperimentRecord> {
    const { experiment, specification } = plan;
    const step = await this.#run([specification], experiment.mutation);
    switch (step.kind) {
      case "interrupted":
        return notRun(experiment, INTERRUPTED);
      case "unrecorded":
        return notRun(experiment, {
          kind: "run-unrecorded",
          run: step.unrecorded,
        });
      case "ran":
        return {
          defectId: experiment.defectId,
          status: "ran",
          run: step.record,
          mutation: step.loads,
        };
    }
  }

  /** Records each experiment decided before any run, and returns the rest in order. */
  #planAll(
    experiments: readonly DefectExperiment[],
    records: Map<DefectExperiment, ExperimentRecord>,
  ): PlannedExperiment[] {
    const planned: PlannedExperiment[] = [];
    for (const experiment of experiments) {
      const plan = this.#plan(experiment);
      if ("reason" in plan) {
        records.set(experiment, notRun(experiment, plan.reason));
      } else {
        planned.push(plan);
      }
    }
    return planned;
  }

  /** Decided before any run: the mutation's file, its anchor and its probe site as the file reads now, and its module. */
  #plan(
    experiment: DefectExperiment,
  ): PlannedExperiment | { readonly reason: ExperimentNotRun } {
    const reason = startCheck(
      experiment,
      this.#textOf(experiment.mutation.file),
    );
    if (reason !== undefined) return { reason };
    const located = this.#located.find(({ location }) =>
      holdsTest(location, experiment.test),
    );
    return located === undefined
      ? { reason: NO_MODULE }
      : { experiment, specification: located.specification };
  }

  #textOf(file: string): FileText {
    let text = this.#texts.get(file);
    if (text === undefined) {
      text = readText(file);
      this.#texts.set(file, text);
    }
    return text;
  }

  /** Once an abort interrupts one experiment, every later one is recorded interrupted without a run. */
  async #experimentsAfter(
    baseline: EndedStep,
    planned: readonly PlannedExperiment[],
    records: Map<DefectExperiment, ExperimentRecord>,
  ): Promise<{ readonly interrupted: boolean; readonly anyRan: boolean }> {
    let interrupted = false;
    let anyRan = false;
    for (const plan of planned) {
      const record: ExperimentRecord = interrupted
        ? notRun(plan.experiment, INTERRUPTED)
        : await this.#experimentAfter(baseline, plan);
      records.set(plan.experiment, record);
      anyRan ||= record.status === "ran";
      interrupted ||=
        record.status === "not-run" && record.reason.kind === "interrupted";
    }
    return { interrupted, anyRan };
  }

  #experimentAfter(
    baseline: EndedStep,
    plan: PlannedExperiment,
  ): Promise<ExperimentRecord> | ExperimentRecord {
    if (baseline.kind === "unrecorded") {
      return notRun(plan.experiment, BASELINE_NOT_RUN);
    }
    const result = testResultIn(baseline.record, plan.experiment.test);
    if (result === undefined) {
      return notRun(plan.experiment, {
        kind: "baseline-not-passed",
        state: NOT_REPORTED,
      });
    }
    if (result.state !== PASSED) {
      return notRun(plan.experiment, {
        kind: "baseline-not-passed",
        state: result.state,
      });
    }
    return this.experiment(plan);
  }

  /**
   * Invalidates the mutated files and whatever the guard finds stale, then starts the run with no await after the
   * abort check, so an abort that came first starts nothing. A run the job's own abort interrupted leaves no result.
   */
  async #run(
    specifications: readonly TestSpecification[],
    mutation?: Mutation,
  ): Promise<RunStep> {
    const invalidated = [mutation?.file, this.#lastMutated].filter(
      (file): file is string => file !== undefined,
    );
    const stale = this.#transform.guard.freshen(invalidated);
    if (stale.length > 0) {
      return unrecorded({ kind: "stale-modules", modules: stale });
    }
    if (this.#signal.aborted) return INTERRUPTED_STEP;
    const interruption = new RunInterruption(this.#signal);
    this.#relay.start(interruption);
    if (mutation !== undefined) {
      this.#lastMutated = mutation.file;
      this.#transform.activate(mutation);
    }
    const { instance } = this.#session;
    let ran: Awaited<ReturnType<typeof instance.runTestSpecifications>>;
    let queued: readonly TestModule[] = [];
    let loads: readonly MutationLoad[] = [];
    try {
      ran = await interruption.duringRun(instance, () =>
        instance.runTestSpecifications([...specifications]),
      );
    } catch (error) {
      return unrecorded({ kind: "run-failed", error: errorText(error) });
    } finally {
      queued = this.#relay.end();
      if (mutation !== undefined) loads = this.#transform.deactivate();
    }
    const execution = interruption.execution();
    if (execution === "interrupted" && this.#signal.aborted) {
      return INTERRUPTED_STEP;
    }
    const cancelError = await interruption.cancelError();
    try {
      const record = recordRun({
        execution,
        forceStopped: interruption.forceStopped(),
        ...(cancelError === undefined ? {} : { cancelError }),
        specifications,
        testModules: ran.testModules,
        queued,
        unhandledErrors: ran.unhandledErrors,
        locate: this.#session.locate,
        ...(mutation === undefined ? {} : { mutation: loads }),
      });
      return { kind: "ran", record, loads };
    } catch (error) {
      return unrecorded({ kind: "run-failed", error: errorText(error) });
    }
  }
}

function readText(file: string): FileText {
  try {
    return { read: true, text: readFileSync(file, "utf8") };
  } catch (error) {
    return { read: false, error: errorText(error) };
  }
}

/**
 * Applies the mutation in memory to its file's text as the job read it and places its probe, so an experiment whose
 * file cannot be read, whose anchor does not occur exactly once or whose change has no probe site never runs.
 */
function startCheck(
  experiment: DefectExperiment,
  fileText: FileText,
): ExperimentNotRun | undefined {
  if (!fileText.read) return { kind: "unreadable", error: fileText.error };
  const { file, old, new: replacement } = experiment.mutation;
  const probed = mutateWithProbe(file, fileText.text, old, replacement);
  switch (probed.status) {
    case "mutated":
      return undefined;
    case "anchor-count":
      return { kind: "anchor-count", count: probed.count };
    case "no-probe-site":
      return { kind: "no-probe-site", site: probed.reason };
  }
}

function holdsTest(
  location: TestModuleLocation,
  identity: TestIdentity,
): boolean {
  return (
    location.workspacePath === identity.workspacePath &&
    location.projectName === identity.projectName &&
    location.modulePath === identity.modulePath
  );
}

function uniqueSpecifications(
  planned: readonly PlannedExperiment[],
): TestSpecification[] {
  return [...new Set(planned.map((plan) => plan.specification))];
}

function unrecorded(run: UnrecordedRun): RunStep {
  return { kind: "unrecorded", unrecorded: run };
}

function outcomeOf(step: EndedStep): RunOutcome {
  return step.kind === "ran"
    ? { ran: true, record: step.record }
    : { ran: false, unrecorded: step.unrecorded };
}

function markAll(
  records: Map<DefectExperiment, ExperimentRecord>,
  planned: readonly PlannedExperiment[],
  reason: ExperimentNotRun,
): void {
  for (const plan of planned) {
    records.set(plan.experiment, notRun(plan.experiment, reason));
  }
}

function notRun(
  experiment: DefectExperiment,
  reason: ExperimentNotRun,
): ExperimentRecord {
  return { defectId: experiment.defectId, status: "not-run", reason };
}

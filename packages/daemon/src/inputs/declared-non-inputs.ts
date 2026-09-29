import { lstatSync } from "node:fs";
import type { DaemonLog } from "../daemon/daemon-log.js";
import {
  countEnvironment,
  type EnvironmentCount,
} from "./environment-digest.js";
import {
  declaredNonInputs,
  declaredVariables,
  NON_INPUTS_ABSENT,
  NON_INPUTS_DECLARED,
  NON_INPUTS_FILE,
  NON_INPUTS_UNUSABLE,
  readNonInputs,
  unusableReason,
  type NonInputMatch,
  type NonInputsDeclaration,
} from "./non-inputs.js";
import { liesUnderRoot, protection, type Protection } from "./protection.js";

const LIST_SEPARATOR = ", ";
const PART_SEPARATOR = "; ";
const EMPTY_LIST = "none";
const NO_DECLARATION: NonInputsDeclaration = {
  file: NON_INPUTS_FILE,
  state: NON_INPUTS_ABSENT,
};

/** What a change of protection moved: the paths whose declared state flipped, and whether only a walk finds the rest. */
export interface ProtectionChange {
  /** Root-relative, each under the consumer root. */
  readonly flipped: readonly string[];
  /** Whether a file no path names may have become an input, which only a walk under the new decision finds. */
  readonly walk: boolean;
}

/**
 * The declaration in effect in the daemon and the files it may not remove: read again at each full reconciliation,
 * and protected from each discovery the lifecycle gives. No pattern applies until the first one does.
 */
export class DeclaredNonInputs {
  readonly #root: string;
  readonly #log: DaemonLog;
  #declaration: NonInputsDeclaration | undefined;
  #logged: string | undefined;
  #loggedEnvironment: string | undefined;
  #protection: Protection;
  #match: NonInputMatch = () => undefined;
  /** The daemon's environment as it started, which every executor process inherits. */
  readonly #startEnvironment: NodeJS.ProcessEnv = { ...process.env };
  #environment: EnvironmentCount = countEnvironment(
    this.#startEnvironment,
    declaredVariables(NO_DECLARATION),
  );

  /** `root` is the consumer root's real path. */
  constructor(root: string, log: DaemonLog) {
    this.#root = root;
    this.#log = log;
    this.#protection = protection(undefined, root);
  }

  /** The pattern that makes a root-relative path a declared non-input, or undefined when it is an input. */
  readonly match: NonInputMatch = (path) => this.#match(path);

  /**
   * Whether an event names a declared non-input file, which nothing reads, so it never becomes pending. A directory
   * a pattern matches is read as usual, since what lies under it may be an input; so is a path that cannot be told.
   */
  namesFile(
    relativePath: string,
    absolutePath: string,
    knownDirectory: boolean,
  ): boolean {
    if (knownDirectory || this.#match(relativePath) === undefined) return false;
    try {
      return (
        lstatSync(absolutePath, { throwIfNoEntry: false })?.isDirectory() !==
        true
      );
    } catch {
      return false;
    }
  }

  /**
   * Why every file stays an input: the declaration in effect cannot be used, or it declares patterns and no pattern
   * applies. Undefined otherwise, and before the declaration is first read.
   */
  get unusable(): string | undefined {
    if (this.#declaration === undefined) return undefined;
    return (
      unusableReason(this.#declaration) ??
      (this.#declaresPatterns() && !this.#protection.applies
        ? this.#protection.reason
        : undefined)
    );
  }

  /** The declaration in effect; before the first read the absent one, since no pattern applies until then. */
  get declaration(): NonInputsDeclaration {
    return this.#declaration ?? NO_DECLARATION;
  }

  /** The environment's digest under the variable entries the declaration in effect adds to the session list. */
  get environment(): string {
    return this.#environment.digest;
  }

  /** Reads `rt-test.json` again, which takes effect at once. */
  read(): void {
    this.#declaration = readNonInputs(this.#root);
    this.#environment = countEnvironment(
      this.#startEnvironment,
      declaredVariables(this.#declaration),
    );
    this.#rebuild();
  }

  /**
   * Logs the declaration in effect, whether its patterns apply, and how the environment is counted under it, each when
   * it differs from the one last logged.
   */
  report(): void {
    const declaration = this.#declaration;
    if (declaration === undefined) return;
    this.#reportDeclaration(declaration);
    this.#reportEnvironment(declaration);
  }

  /**
   * Replaces the protection, logs the declaration when its line changed, and returns each path whose declared state
   * flipped among those either protection names and those in `held`, the root-relative inputs the tracker holds, and
   * whether a walk must find the rest.
   */
  protect(next: Protection, held: Iterable<string>): ProtectionChange {
    const before = this.#match;
    const previous = this.#protection;
    this.#protection = next;
    this.#rebuild();
    this.report();
    const candidates = new Set([
      ...namedFiles(previous),
      ...namedFiles(next),
      ...held,
    ]);
    return {
      flipped: [...candidates].filter(
        (path) =>
          liesUnderRoot(path) &&
          (before(path) === undefined) !== (this.#match(path) === undefined),
      ),
      walk: this.#declaresPatterns() && patternsReleaseFiles(previous, next),
    };
  }

  #reportDeclaration(declaration: NonInputsDeclaration): void {
    const text = declarationText(declaration, this.#protection);
    if (text === this.#logged) return;
    this.#logged = text;
    this.#log.entry(text);
  }

  #reportEnvironment(declaration: NonInputsDeclaration): void {
    const text = environmentText(
      this.#environment,
      declaredVariables(declaration),
    );
    if (text === this.#loggedEnvironment) return;
    this.#loggedEnvironment = text;
    this.#log.entry(text);
  }

  #declaresPatterns(): boolean {
    return (
      this.#declaration?.state === NON_INPUTS_DECLARED &&
      this.#declaration.patterns.length > 0
    );
  }

  #rebuild(): void {
    this.#match =
      this.#declaration === undefined
        ? () => undefined
        : declaredNonInputs(this.#declaration, this.#protection);
  }
}

function namedFiles(value: Protection): ReadonlySet<string> {
  return value.applies ? value.files : new Set();
}

/**
 * Whether a file a declared pattern hid may count now: the patterns stopped applying, or a discovered project's
 * test file patterns or pattern directory changed, or a project joined or left.
 */
function patternsReleaseFiles(previous: Protection, next: Protection): boolean {
  if (!previous.applies) return false;
  return !next.applies || previous.patternKey !== next.patternKey;
}

/** Names only, never a value, so the log shows which variables a restart compares without showing what they hold. */
function environmentText(
  count: EnvironmentCount,
  declared: readonly string[],
): string {
  return [
    `environment: counted by value: ${quotedList(count.byValue)}`,
    `counted only as set, from RT Test's session list: ${quotedList(count.sessionEntriesSet)}`,
    `declared in ${NON_INPUTS_FILE}: ${quotedList(declared)}`,
  ].join(PART_SEPARATOR);
}

function quotedList(names: readonly string[]): string {
  return names.length === 0
    ? EMPTY_LIST
    : names.map((name) => JSON.stringify(name)).join(LIST_SEPARATOR);
}

function declarationText(
  declaration: NonInputsDeclaration,
  current: Protection,
): string {
  switch (declaration.state) {
    case NON_INPUTS_UNUSABLE:
      return `warning: ${declaration.reason}`;
    case NON_INPUTS_ABSENT:
      return `non-inputs: none, since there is no ${declaration.file}`;
    default: {
      if (declaration.patterns.length === 0) {
        return `non-inputs: none, since ${declaration.file} declares no pattern`;
      }
      const patterns = declaration.patterns
        .map((pattern) => JSON.stringify(pattern))
        .join(LIST_SEPARATOR);
      return current.applies
        ? `non-inputs in effect from ${declaration.file}: ${patterns}`
        : `warning: ${current.reason}; the patterns ${declaration.file} declares: ${patterns}`;
    }
  }
}

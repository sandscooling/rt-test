import { lstatSync } from "node:fs";
import type { DaemonLog } from "../daemon/daemon-log.js";
import {
  declaredNonInputs,
  NON_INPUTS_ABSENT,
  NON_INPUTS_UNUSABLE,
  readNonInputs,
  sameDeclaration,
  unusableReason,
  type NonInputMatch,
  type NonInputsDeclaration,
} from "./non-inputs.js";

const LIST_SEPARATOR = ", ";

/**
 * The declaration in effect in the daemon and the test modules it may not remove: read again at each full
 * reconciliation, and protected from each stored discovery.
 */
export class DeclaredNonInputs {
  readonly #root: string;
  readonly #log: DaemonLog;
  #declaration: NonInputsDeclaration | undefined;
  #logged: NonInputsDeclaration | undefined;
  #protected: ReadonlySet<string> = new Set();
  #match: NonInputMatch = () => undefined;

  /** `root` is the consumer root's real path. */
  constructor(root: string, log: DaemonLog) {
    this.#root = root;
    this.#log = log;
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

  /** Why every file stays an input, while the declaration in effect cannot be used. */
  get unusable(): string | undefined {
    return this.#declaration === undefined
      ? undefined
      : unusableReason(this.#declaration);
  }

  /** Reads `rt-test.json` again, which takes effect at once. */
  read(): void {
    this.#declaration = readNonInputs(this.#root);
    this.#rebuild();
  }

  /** Logs the declaration in effect when it differs from the one last logged. */
  report(): void {
    const declaration = this.#declaration;
    if (declaration === undefined) return;
    if (
      this.#logged !== undefined &&
      sameDeclaration(this.#logged, declaration)
    ) {
      return;
    }
    this.#logged = declaration;
    this.#log.entry(declarationText(declaration));
  }

  /**
   * Replaces the protected test modules, root-relative, and returns each path that was a declared non-input and is
   * now an input, or the reverse.
   */
  protect(testModules: readonly string[]): string[] {
    const next = new Set(testModules);
    const changed = [
      ...[...next].filter((path) => !this.#protected.has(path)),
      ...[...this.#protected].filter((path) => !next.has(path)),
    ];
    if (changed.length === 0) return [];
    const before = this.#match;
    this.#protected = next;
    this.#rebuild();
    return changed.filter(
      (path) =>
        (before(path) === undefined) !== (this.#match(path) === undefined),
    );
  }

  #rebuild(): void {
    this.#match =
      this.#declaration === undefined
        ? () => undefined
        : declaredNonInputs(this.#declaration, this.#protected);
  }
}

function declarationText(declaration: NonInputsDeclaration): string {
  switch (declaration.state) {
    case NON_INPUTS_UNUSABLE:
      return `warning: ${declaration.reason}`;
    case NON_INPUTS_ABSENT:
      return `non-inputs: none, since there is no ${declaration.file}`;
    default:
      return declaration.patterns.length === 0
        ? `non-inputs: none, since ${declaration.file} declares no pattern`
        : `non-inputs in effect from ${declaration.file}: ${declaration.patterns.map((pattern) => JSON.stringify(pattern)).join(LIST_SEPARATOR)}`;
  }
}

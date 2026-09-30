import { join, posix, win32 } from "node:path";
import { isRecord, isStringArray } from "../json-guards.js";
import {
  climbsOut,
  liesInside,
  objectField,
  POSIX_SEPARATOR,
  realPath,
  ROOT_PATH,
} from "../vitest/find-workspaces.js";
import type { DefinitionSource } from "./definition-files.js";

const WINDOWS_SEPARATOR = "\\";
const NAME_SEPARATOR = ", ";
const TRAILING_SEPARATORS = /\/+$/;
const LF = "\n";
const CRLF = "\r\n";
/** The members of a definition, as its file spells them. */
const MEMBER = {
  id: "id",
  defect: "defect",
  required: "required",
  test: "test",
  module: "module",
  name: "name",
  project: "project",
  occurrence: "occurrence",
  mutation: "mutation",
  file: "file",
  old: "old",
  new: "new",
} as const;

/** A definition's test as it writes it. */
export interface DefinitionTest {
  /** Relative to the consumer root, in the definition's spelling. */
  readonly module: string;
  /** Each enclosing suite's name, then the test's. */
  readonly name: readonly string[];
  readonly project?: string;
  /** Among the tests sharing the module, project and name path, from 0. */
  readonly occurrence?: number;
}

export interface DefinitionMutation {
  /** Relative to the consumer root, in the definition's spelling. */
  readonly file: string;
  readonly old: string;
  readonly new: string;
}

/** A definition with each problem that makes it invalid, before its test is resolved. */
export interface CheckedDefinition {
  /** Relative to the consumer root, `/`-separated. */
  readonly file: string;
  /** Its index in its file's `defects` array. */
  readonly position: number;
  /** Undefined when it has no usable id. */
  readonly id: string | undefined;
  /** Undefined when its test is not well-formed. */
  readonly test: DefinitionTest | undefined;
  /** The test's module relative to the root, `/`-separated; undefined when the test names no usable one. */
  readonly modulePath: string | undefined;
  /** Undefined when its mutation is not well-formed. */
  readonly mutation: DefinitionMutation | undefined;
  /** Absolute; undefined when the mutation names no file inside the root. */
  readonly mutationPath: string | undefined;
  /** Each reason it is invalid, none quoting its `old` or `new` text. */
  readonly problems: readonly string[];
}

type RootRelative =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly problem: string };

/** Checks each definition alone, then marks every definition whose id another one repeats. */
export function checkDefinitions(
  sources: readonly DefinitionSource[],
  consumerRoot: string,
): CheckedDefinition[] {
  const root = realPath(consumerRoot);
  const realRoot = root.ok ? root.path : consumerRoot;
  const checked = sources.map((source) =>
    checkDefinition(source, consumerRoot, realRoot),
  );
  return withRepeatedIds(checked);
}

/** How a reason names one definition. */
function definitionName(file: string, position: number): string {
  return `${file} (definition ${position})`;
}

function checkDefinition(
  source: DefinitionSource,
  consumerRoot: string,
  realRoot: string,
): CheckedDefinition {
  const { file, position, value } = source;
  const base = { file, position };
  if (!isRecord(value)) {
    return {
      ...base,
      id: undefined,
      test: undefined,
      modulePath: undefined,
      mutation: undefined,
      mutationPath: undefined,
      problems: ["it is not a JSON object"],
    };
  }
  const problems: string[] = [];
  const id = objectField(value, MEMBER.id);
  const usableId = typeof id === "string" && id !== "" ? id : undefined;
  if (usableId === undefined) problems.push("its id is not a non-empty string");
  for (const member of [MEMBER.defect, MEMBER.required]) {
    if (typeof objectField(value, member) !== "string") {
      problems.push(`its ${member} is not a string`);
    }
  }
  const test = checkedTest(objectField(value, MEMBER.test), problems);
  const modulePath = testModulePath(test, problems);
  const mutation = checkedMutation(
    objectField(value, MEMBER.mutation),
    problems,
  );
  const mutationPath = mutationFilePath(
    mutation,
    consumerRoot,
    realRoot,
    problems,
  );
  return {
    ...base,
    id: usableId,
    test,
    modulePath,
    mutation,
    mutationPath,
    problems,
  };
}

function checkedTest(
  value: unknown,
  problems: string[],
): DefinitionTest | undefined {
  if (!isRecord(value)) {
    problems.push("its test is not an object");
    return undefined;
  }
  const module = objectField(value, MEMBER.module);
  const name = objectField(value, MEMBER.name);
  const project = objectField(value, MEMBER.project);
  const occurrence = objectField(value, MEMBER.occurrence);
  const found = [
    typeof module === "string" && module !== ""
      ? undefined
      : "its test's module is not a non-empty string",
    isStringArray(name) && name.length > 0
      ? undefined
      : "its test's name is not a non-empty array of strings",
    project === undefined || typeof project === "string"
      ? undefined
      : "its test's project is not a string",
    occurrence === undefined ||
    (Number.isInteger(occurrence) && (occurrence as number) >= 0)
      ? undefined
      : "its test's occurrence is not a whole number from 0",
  ].filter((problem) => problem !== undefined);
  if (found.length > 0) {
    problems.push(...found);
    return undefined;
  }
  return {
    module: module as string,
    name: name as string[],
    ...(project === undefined ? {} : { project: project as string }),
    ...(occurrence === undefined ? {} : { occurrence: occurrence as number }),
  };
}

function testModulePath(
  test: DefinitionTest | undefined,
  problems: string[],
): string | undefined {
  if (test === undefined) return undefined;
  const module = rootRelativePath(test.module);
  if (module.ok) return module.path;
  problems.push(
    `its test's module ${JSON.stringify(test.module)} ${module.problem}`,
  );
  return undefined;
}

function checkedMutation(
  value: unknown,
  problems: string[],
): DefinitionMutation | undefined {
  if (!isRecord(value)) {
    problems.push("its mutation is not an object");
    return undefined;
  }
  const file = objectField(value, MEMBER.file);
  const old = objectField(value, MEMBER.old);
  const replacement = objectField(value, MEMBER.new);
  const found = [
    typeof file === "string" && file !== ""
      ? undefined
      : "its mutation's file is not a non-empty string",
    typeof old === "string" ? undefined : "its mutation's old is not a string",
    typeof replacement === "string"
      ? undefined
      : "its mutation's new is not a string",
  ].filter((problem) => problem !== undefined);
  if (found.length > 0) {
    problems.push(...found);
    return undefined;
  }
  const mutation = {
    file: file as string,
    old: old as string,
    new: replacement as string,
  };
  if (mutation.old === "") problems.push("its mutation's old text is empty");
  else if (withLfBreaks(mutation.old) === withLfBreaks(mutation.new)) {
    problems.push(
      "its mutation's old text equals its new text, so it changes nothing",
    );
  }
  return mutation;
}

/** The anchor matcher writes each line break of `new` with the file's own ending, so a mutation differing only there changes nothing. */
function withLfBreaks(text: string): string {
  return text.split(CRLF).join(LF);
}

/**
 * The mutation's file, absolute, when it lies inside the root by its spelling and, when it exists, by its real path.
 * A file whose real path cannot be read is left to the anchor check, which reads it.
 */
function mutationFilePath(
  mutation: DefinitionMutation | undefined,
  consumerRoot: string,
  realRoot: string,
  problems: string[],
): string | undefined {
  if (mutation === undefined) return undefined;
  const spelled = rootRelativePath(mutation.file);
  if (!spelled.ok) {
    problems.push(
      `its mutation's file ${JSON.stringify(mutation.file)} ${spelled.problem}`,
    );
    return undefined;
  }
  const path = join(consumerRoot, spelled.path);
  const real = realPath(path);
  if (real.ok && !liesInside(realRoot, real.path)) {
    problems.push(
      `its mutation's file ${JSON.stringify(mutation.file)} resolves through a link to a path outside the consumer root`,
    );
    return undefined;
  }
  return path;
}

/** Separators normalized to `/` and `.` and `..` segments resolved, so every spelling of one file is one path. */
function rootRelativePath(spelling: string): RootRelative {
  const slashed = spelling.split(WINDOWS_SEPARATOR).join(POSIX_SEPARATOR);
  if (posix.isAbsolute(slashed) || win32.isAbsolute(spelling)) {
    return {
      ok: false,
      problem: "is absolute, not relative to the consumer root",
    };
  }
  const normal = posix.normalize(slashed).replace(TRAILING_SEPARATORS, "");
  if (climbsOut(normal, POSIX_SEPARATOR)) {
    return { ok: false, problem: "lies outside the consumer root" };
  }
  if (normal === ROOT_PATH || normal === "") {
    return { ok: false, problem: "names the consumer root, not a file" };
  }
  return { ok: true, path: normal };
}

function withRepeatedIds(
  definitions: readonly CheckedDefinition[],
): CheckedDefinition[] {
  const byId = new Map<string, CheckedDefinition[]>();
  for (const definition of definitions) {
    if (definition.id === undefined) continue;
    const group = byId.get(definition.id);
    if (group === undefined) byId.set(definition.id, [definition]);
    else group.push(definition);
  }
  return definitions.map((definition) => {
    const group =
      definition.id === undefined ? undefined : byId.get(definition.id);
    if (group === undefined || group.length === 1) return definition;
    const others = group
      .filter((other) => other !== definition)
      .map((other) => definitionName(other.file, other.position));
    return {
      ...definition,
      problems: [
        ...definition.problems,
        `its id ${JSON.stringify(definition.id)} repeats in ${others.join(NAME_SEPARATOR)}`,
      ],
    };
  });
}

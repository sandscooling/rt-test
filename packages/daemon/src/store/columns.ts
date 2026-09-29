import type { IdentifiedTest } from "@rt-test/core";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import type { UnreadWorkspaceSource } from "../vitest/find-workspaces.js";
import type { FailedModule, ModuleReport } from "../vitest/module-tests.js";
import {
  REGEXP_FIND,
  STRING_FIND,
  STRING_FIND_FLAGS,
  type AliasFindKind,
  type PatternBase,
  type ProjectSelectionFacts,
  type ReportedAlias,
  type TestFilePatterns,
} from "../vitest/selection-facts.js";
import type {
  UnsupportedProject,
  UnsupportedVitest,
} from "../vitest/workspace-session.js";

export type Row = Record<string, SQLOutputValue>;
export type Members<T extends string> = Readonly<Record<T, true>>;

const DUPLICATE_MARK = 1;
const NOT_DUPLICATE_MARK = 0;

const ALIAS_FIND_KINDS: Members<AliasFindKind> = {
  [STRING_FIND]: true,
  [REGEXP_FIND]: true,
};

/** Both test tables declare these columns in this order, before their own. */
export function identifiedTestColumns(test: IdentifiedTest): SQLInputValue[] {
  const { identity } = test;
  return [
    identity.workspacePath,
    identity.projectName,
    identity.modulePath,
    JSON.stringify(identity.namePath),
    identity.occurrence,
    test.isDuplicate ? DUPLICATE_MARK : NOT_DUPLICATE_MARK,
  ];
}

export function identifiedTest(row: Row): IdentifiedTest {
  return {
    identity: {
      workspacePath: text(row, "workspace_path"),
      projectName: text(row, "project_name"),
      modulePath: text(row, "module_path"),
      namePath: stringArray(json(row, "name_path")),
      occurrence: integer(row, "occurrence"),
    },
    isDuplicate: duplicateMark(row),
  };
}

export function column(row: Row, name: string): SQLOutputValue {
  const value = row[name];
  if (value === undefined) {
    throw new Error(`The store query returned no ${name} column`);
  }
  return value;
}

export function text(row: Row, name: string): string {
  const value = column(row, name);
  if (typeof value === "string") return value;
  throw unreadable(name, value);
}

/** NULL is a value the record never held, so it reads back absent. */
export function optionalText(row: Row, name: string): string | undefined {
  return column(row, name) === null ? undefined : text(row, name);
}

export function closeError(row: Row): { readonly closeError?: string } {
  const value = optionalText(row, "close_error");
  return value === undefined ? {} : { closeError: value };
}

export function integer(row: Row, name: string): number {
  const value = column(row, name);
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw unreadable(name, value);
}

/** Groups rows by an integer column, keeping their order within each group. */
export function rowsBy(rows: readonly Row[], name: string): Map<number, Row[]> {
  const groups = new Map<number, Row[]>();
  for (const row of rows) {
    const key = integer(row, name);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }
  return groups;
}

function duplicateMark(row: Row): boolean {
  const value = integer(row, "is_duplicate");
  if (value === DUPLICATE_MARK) return true;
  if (value === NOT_DUPLICATE_MARK) return false;
  throw unreadable("is_duplicate", value);
}

export function json(row: Row, name: string): unknown {
  const value = text(row, name);
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw unreadable(name, value, error);
  }
}

export function member<T extends string>(
  members: Members<T>,
  value: string,
  name: string,
): T {
  if (isMember(members, value)) return value;
  throw unreadable(name, value);
}

export function arrayOf<T>(value: unknown, item: (element: unknown) => T): T[] {
  if (!Array.isArray(value)) throw unreadable("JSON array", value);
  return value.map((element: unknown) => item(element));
}

export function stringArray(value: unknown): string[] {
  if (
    Array.isArray(value) &&
    value.every((element): element is string => typeof element === "string")
  ) {
    return value;
  }
  throw unreadable("JSON string array", value);
}

export function unsupportedVitest(value: unknown): UnsupportedVitest {
  if (!isRecord(value) || value["supported"] !== false) {
    throw unreadable("unsupported Vitest report", value);
  }
  const version = value["version"];
  if (version !== undefined && typeof version !== "string") {
    throw unreadable("unsupported Vitest report", value);
  }
  return {
    supported: false,
    supportedRange: jsonText(value, "supportedRange"),
    reason: jsonText(value, "reason"),
    ...(version === undefined ? {} : { version }),
  };
}

export function moduleReport(value: unknown): ModuleReport {
  return {
    projectName: jsonText(value, "projectName"),
    modulePath: jsonText(value, "modulePath"),
  };
}

export function failedModule(value: unknown): FailedModule {
  return {
    ...moduleReport(value),
    errors: stringArray(jsonField(value, "errors")),
  };
}

export function unsupportedProject(value: unknown): UnsupportedProject {
  return {
    projectName: jsonText(value, "projectName"),
    reason: jsonText(value, "reason"),
  };
}

export function unreadWorkspaceSource(value: unknown): UnreadWorkspaceSource {
  return {
    source: jsonText(value, "source"),
    reason: jsonText(value, "reason"),
  };
}

export function projectSelectionFacts(value: unknown): ProjectSelectionFacts {
  return {
    projectName: jsonText(value, "projectName"),
    viteRoot: jsonText(value, "viteRoot"),
    setupFiles: stringArray(jsonField(value, "setupFiles")),
    globalSetupFiles: stringArray(jsonField(value, "globalSetupFiles")),
    aliases: arrayOf(jsonField(value, "aliases"), reportedAlias),
    testFilePatterns: testFilePatterns(jsonField(value, "testFilePatterns")),
  };
}

function reportedAlias(value: unknown): ReportedAlias {
  const findKind = member(
    ALIAS_FIND_KINDS,
    jsonText(value, "findKind"),
    "JSON field findKind",
  );
  return {
    find: jsonText(value, "find"),
    findKind,
    flags: aliasFlags(value, findKind),
    replacement: jsonText(value, "replacement"),
    hasCustomResolver: jsonBoolean(value, "hasCustomResolver"),
  };
}

/** Only a RegExp find carries flags. */
function aliasFlags(value: unknown, findKind: AliasFindKind): string {
  const flags = jsonText(value, "flags");
  if (findKind === STRING_FIND && flags !== STRING_FIND_FLAGS) {
    throw unreadable("JSON field flags", value);
  }
  return flags;
}

function testFilePatterns(value: unknown): TestFilePatterns {
  return {
    directory: jsonText(value, "directory"),
    vitestDirectory: jsonText(value, "vitestDirectory"),
    patternBases: arrayOf(jsonField(value, "patternBases"), patternBase),
    include: stringArray(jsonField(value, "include")),
    exclude: stringArray(jsonField(value, "exclude")),
    includeSource: stringArray(jsonField(value, "includeSource")),
  };
}

function patternBase(value: unknown): PatternBase {
  return {
    spelled: jsonText(value, "spelled"),
    directory: jsonText(value, "directory"),
  };
}

export function unreadable(
  name: string,
  value: unknown,
  cause?: unknown,
): Error {
  const shown =
    typeof value === "bigint" ? String(value) : JSON.stringify(value);
  return new Error(
    `The store holds an unreadable ${name}: ${shown}`,
    cause === undefined ? undefined : { cause },
  );
}

function jsonText(value: unknown, key: string): string {
  const field = jsonField(value, key);
  if (typeof field === "string") return field;
  throw unreadable(`JSON field ${key}`, value);
}

function jsonBoolean(value: unknown, key: string): boolean {
  const field = jsonField(value, key);
  if (typeof field === "boolean") return field;
  throw unreadable(`JSON field ${key}`, value);
}

function jsonField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMember<T extends string>(
  members: Members<T>,
  value: string,
): value is T {
  return Object.hasOwn(members, value);
}

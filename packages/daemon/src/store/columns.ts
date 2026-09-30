import type { IdentifiedTest } from "@rt-test/core";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { isRecord, isStringArray } from "../json-guards.js";
import type {
  NotCoveredWorkspace,
  UnreadWorkspaceSource,
} from "../vitest/find-workspaces.js";
import type { FailedModule, ModuleReport } from "../vitest/module-tests.js";
import {
  REGEXP_FIND,
  STRING_FIND,
  STRING_FIND_FLAGS,
  type AliasFindKind,
  type CrawledLinks,
  type EnvSource,
  type ProjectSelectionFacts,
  type ReportedAlias,
  type SpelledDirectory,
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
      namePath: stringArray(row, "name_path"),
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

/** A column holding a JSON array, each element read by `item`. */
export function arrayOf<T>(
  row: Row,
  name: string,
  item: (element: unknown) => T,
): T[] {
  const value = json(row, name);
  if (!Array.isArray(value)) throw unreadable(name, value);
  return value.map((element: unknown) => item(element));
}

/** A column holding a JSON array of strings. */
export function stringArray(row: Row, name: string): string[] {
  const value = json(row, name);
  if (isStringArray(value)) return value;
  throw unreadable(name, value);
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
    errors: jsonStrings(value, "errors"),
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

export function notCoveredWorkspace(value: unknown): NotCoveredWorkspace {
  return {
    path: jsonText(value, "path"),
    reason: jsonText(value, "reason"),
  };
}

export function projectSelectionFacts(value: unknown): ProjectSelectionFacts {
  return {
    projectName: jsonText(value, "projectName"),
    viteRoot: jsonText(value, "viteRoot"),
    setupFiles: jsonStrings(value, "setupFiles"),
    globalSetupFiles: jsonStrings(value, "globalSetupFiles"),
    aliases: jsonArray(value, "aliases", reportedAlias),
    testFilePatterns: testFilePatterns(jsonRecord(value, "testFilePatterns")),
    envSources: storedEnvSources(value),
  };
}

function storedEnvSources(value: unknown): ProjectSelectionFacts["envSources"] {
  const field = jsonField(value, "envSources");
  if (isRecord(field)) return { notKnown: jsonText(field, "notKnown") };
  return jsonArray(value, "envSources", envSource);
}

function envSource(value: unknown): EnvSource {
  return {
    envDirectory:
      jsonField(value, "envDirectory") === null
        ? null
        : jsonText(value, "envDirectory"),
    envPrefixes: jsonStrings(value, "envPrefixes"),
    mode: jsonText(value, "mode"),
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
    patternBases: jsonArray(value, "patternBases", spelledDirectory),
    crawledLinks: crawledLinks(jsonRecord(value, "crawledLinks")),
    include: jsonStrings(value, "include"),
    exclude: jsonStrings(value, "exclude"),
    includeSource: jsonStrings(value, "includeSource"),
  };
}

function crawledLinks(value: unknown): CrawledLinks {
  return jsonBoolean(value, "complete")
    ? { complete: true, links: jsonArray(value, "links", spelledDirectory) }
    : { complete: false, reason: jsonText(value, "reason") };
}

function spelledDirectory(value: unknown): SpelledDirectory {
  return {
    spelled: jsonText(value, "spelled"),
    directory: jsonText(value, "directory"),
  };
}

/** A stored record this RT Test cannot rebuild, told apart from a failure of the store itself. */
export class UnreadableRecordError extends Error {}

export function unreadable(
  name: string,
  value: unknown,
  cause?: unknown,
): UnreadableRecordError {
  const shown =
    typeof value === "bigint" ? String(value) : JSON.stringify(value);
  return new UnreadableRecordError(
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

function jsonArray<T>(
  value: unknown,
  key: string,
  item: (element: unknown) => T,
): T[] {
  const field = jsonField(value, key);
  if (Array.isArray(field))
    return field.map((element: unknown) => item(element));
  throw unreadable(`JSON field ${key}`, value);
}

function jsonStrings(value: unknown, key: string): string[] {
  const field = jsonField(value, key);
  if (isStringArray(field)) return field;
  throw unreadable(`JSON field ${key}`, value);
}

function jsonRecord(value: unknown, key: string): Record<string, unknown> {
  const field = jsonField(value, key);
  if (isRecord(field)) return field;
  throw unreadable(`JSON field ${key}`, value);
}

function jsonField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function isMember<T extends string>(
  members: Members<T>,
  value: string,
): value is T {
  return Object.hasOwn(members, value);
}

import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  errorText,
  identityHash,
  MAX_CHANGES_PATHS,
} from "@rt-test/daemon/client";

/** An agent's memory untouched this long is removed, and read as none. */
export const MEMORY_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Raised when the file's fields change incompatibly; a file of another version reads as no memory. */
const MEMORY_VERSION = 1;
const FILE_PREFIX = "hook-";
const FILE_EXTENSION = ".json";
const NAME_SEPARATOR = "-";
const TEMPORARY_SUFFIX = ".tmp";
const OWNER_ONLY_FILE_MODE = 0o600;
const UTF8 = "utf8";
/** Linux reports a path through a file as `ENOTDIR` where Windows reports `ENOENT`. */
const MISSING_CODES: ReadonlySet<unknown> = new Set(["ENOENT", "ENOTDIR"]);
const AGENT = "agent";
const PROMPTS = "prompts";
const TURN_ENDS = "turn-ends";

/**
 * Who writes a memory file: one agent's batches (the main agent's when `agentId` is absent), the session's prompts,
 * or its turn ends. Each file has this one writer, whose runs never overlap, so no two runs write one file.
 */
export type Writer =
  | { readonly kind: typeof AGENT; readonly agentId?: string }
  | { readonly kind: typeof PROMPTS }
  | { readonly kind: typeof TURN_ENDS };

const MAIN_AGENT: Writer = { kind: AGENT };

/** The agent a payload's `agent_id` names, the main agent when it names none. */
export function agentWriter(agentId: string | undefined): Writer {
  return agentId === undefined ? MAIN_AGENT : { kind: AGENT, agentId };
}
export const PROMPTS_WRITER: Writer = { kind: PROMPTS };
export const TURN_ENDS_WRITER: Writer = { kind: TURN_ENDS };

export interface EditedPath {
  /** Absolute, as the agent's call named it. */
  readonly path: string;
  readonly editedAt: number;
}

/** What one writer remembers, each time a `Date.now()` value. */
export interface WriterMemory {
  /** The files an agent edited, most recent first; none for another writer. */
  readonly paths: readonly EditedPath[];
  /** The cursor the agent's last answer returned. */
  readonly cursor?: string;
  readonly toldLossAt?: number;
  readonly answeredAt?: number;
}

/** The session's edited files, most recently edited first, and how many older ones the bound left out. */
export interface SessionPaths {
  readonly paths: readonly string[];
  readonly leftOut: number;
}

const NO_MEMORY: WriterMemory = { paths: [] };

/** Every memory file of one session and consumer root, as read once at a run's start. */
export class SessionMemory {
  readonly #directory: string;
  readonly #prefix: string;
  readonly #memories: Map<string, WriterMemory>;
  /** Each memory file that exists but could not be read, and why; each counts as no memory. */
  readonly problems: readonly string[];

  private constructor(
    directory: string,
    prefix: string,
    memories: Map<string, WriterMemory>,
    problems: readonly string[],
  ) {
    this.#directory = directory;
    this.#prefix = prefix;
    this.#memories = memories;
    this.problems = problems;
  }

  /** Throws when the directory itself cannot be listed. */
  static read(
    directory: string,
    sessionId: string,
    consumerRoot: string,
    now: number,
  ): SessionMemory {
    const prefix = `${FILE_PREFIX}${identityHash(sessionId, consumerRoot)}${NAME_SEPARATOR}`;
    const memories = new Map<string, WriterMemory>();
    const problems: string[] = [];
    for (const name of readdirSync(directory)) {
      if (!name.startsWith(prefix) || !name.endsWith(FILE_EXTENSION)) continue;
      const read = readMemory(join(directory, name), now);
      if (typeof read === "string") problems.push(read);
      else if (read !== undefined) memories.set(name, read);
    }
    return new SessionMemory(directory, prefix, memories, problems);
  }

  of(writer: Writer): WriterMemory {
    return this.#memories.get(this.#fileName(writer)) ?? NO_MEMORY;
  }

  /** Replaces the writer's memory for the rest of this run; `save` writes it. */
  set(writer: Writer, memory: WriterMemory): void {
    this.#memories.set(this.#fileName(writer), memory);
  }

  /** The union of every agent's edited files, each at its latest edit, cut to `MAX_CHANGES_PATHS`. */
  editedPaths(): SessionPaths {
    const latest = new Map<string, number>();
    for (const memory of this.#memories.values()) {
      for (const { path, editedAt } of memory.paths) {
        latest.set(path, Math.max(editedAt, latest.get(path) ?? editedAt));
      }
    }
    const paths = [...latest.entries()]
      .sort(([pathA, a], [pathB, b]) =>
        a === b ? pathA.localeCompare(pathB) : b - a,
      )
      .map(([path]) => path);
    return {
      paths: paths.slice(0, MAX_CHANGES_PATHS),
      leftOut: Math.max(0, paths.length - MAX_CHANGES_PATHS),
    };
  }

  /**
   * Whether the writer has told of the current loss: it told after the latest answer any of the session's files
   * records. The main agent's batches and the session's prompts reach the same agent, so either one's telling counts.
   */
  toldLoss(writer: Writer): boolean {
    const answers = [...this.#memories.values()].map(
      (memory) => memory.answeredAt ?? Number.NEGATIVE_INFINITY,
    );
    const latestAnswer = Math.max(Number.NEGATIVE_INFINITY, ...answers);
    const told = this.#tellers(writer).map(
      (teller) => this.of(teller).toldLossAt ?? Number.NEGATIVE_INFINITY,
    );
    return Math.max(Number.NEGATIVE_INFINITY, ...told) > latestAnswer;
  }

  /**
   * Writes the writer's memory through a temporary file and a rename, so no reader sees it torn. A run that creates
   * a file also removes every hook memory file untouched for `MEMORY_AGE_MS`, and returns why any could not be.
   * Throws when the memory cannot be written.
   */
  save(writer: Writer, now: number): string[] {
    const file = join(this.#directory, this.#fileName(writer));
    const created = !existsSync(file);
    const document = { version: MEMORY_VERSION, ...this.of(writer) };
    const temporary = `${file}.${process.pid}${TEMPORARY_SUFFIX}`;
    try {
      writeFileSync(temporary, JSON.stringify(document), {
        mode: OWNER_ONLY_FILE_MODE,
      });
      renameSync(temporary, file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw new Error(
        `Cannot write the hook's memory ${file}: ${errorText(error)}.`,
        { cause: error },
      );
    }
    return created ? pruneExpired(this.#directory, now) : [];
  }

  #fileName(writer: Writer): string {
    const parts =
      writer.kind === AGENT && writer.agentId !== undefined
        ? [writer.kind, writer.agentId]
        : [writer.kind];
    return `${this.#prefix}${identityHash(...parts)}${FILE_EXTENSION}`;
  }

  #tellers(writer: Writer): readonly Writer[] {
    const isMainAgent = writer.kind === AGENT && writer.agentId === undefined;
    return isMainAgent || writer.kind === PROMPTS
      ? [MAIN_AGENT, PROMPTS_WRITER]
      : [writer];
  }
}

/**
 * The agent's memory with `paths` edited at `now`, each moved to the front, keeping the `MAX_CHANGES_PATHS` most
 * recent.
 */
export function withEdits(
  memory: WriterMemory,
  paths: readonly string[],
  now: number,
): WriterMemory {
  const edited = new Set(paths);
  return {
    ...memory,
    paths: [
      ...[...edited].map((path) => ({ path, editedAt: now })),
      ...memory.paths.filter(({ path }) => !edited.has(path)),
    ].slice(0, MAX_CHANGES_PATHS),
  };
}

export function withoutPaths(
  memory: WriterMemory,
  paths: readonly string[],
): WriterMemory {
  const dropped = new Set(paths);
  return {
    ...memory,
    paths: memory.paths.filter(({ path }) => !dropped.has(path)),
  };
}

/** Undefined for a missing or expired file; a string saying why for one that cannot be read or parsed. */
function readMemory(
  file: string,
  now: number,
): WriterMemory | string | undefined {
  let text: string;
  try {
    if (expired(statSync(file).mtimeMs, now)) return undefined;
    text = readFileSync(file, UTF8);
  } catch (error) {
    if (isMissing(error)) return undefined;
    return unreadable(file, errorText(error));
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return unreadable(file, errorText(error));
  }
  const memory = memoryOf(value);
  return typeof memory === "string" ? unreadable(file, memory) : memory;
}

function unreadable(file: string, reason: string): string {
  return `The hook's memory ${file} cannot be read, so it counts as none: ${reason}.`;
}

/** The memory a parsed file holds, or why it holds none. */
function memoryOf(value: unknown): WriterMemory | string {
  if (typeof value !== "object" || value === null) return "it is not an object";
  const fields = value as Record<string, unknown>;
  if (fields["version"] !== MEMORY_VERSION) {
    return `its version is ${JSON.stringify(fields["version"])}, not ${MEMORY_VERSION}`;
  }
  const { paths, cursor, toldLossAt, answeredAt } = fields;
  if (!Array.isArray(paths) || !paths.every(isEditedPath)) {
    return "its paths are not a list of edited paths";
  }
  if (cursor !== undefined && typeof cursor !== "string") {
    return "its cursor is not a string";
  }
  if (!isOptionalTime(toldLossAt) || !isOptionalTime(answeredAt)) {
    return "a time it holds is not a number";
  }
  return {
    paths,
    ...(cursor === undefined ? {} : { cursor }),
    ...(toldLossAt === undefined ? {} : { toldLossAt }),
    ...(answeredAt === undefined ? {} : { answeredAt }),
  };
}

function isEditedPath(value: unknown): value is EditedPath {
  if (typeof value !== "object" || value === null) return false;
  const { path, editedAt } = value as Record<string, unknown>;
  return typeof path === "string" && Number.isFinite(editedAt);
}

function isOptionalTime(value: unknown): value is number | undefined {
  return value === undefined || Number.isFinite(value);
}

/** Why each expired hook memory file, of any session, could not be removed. */
function pruneExpired(directory: string, now: number): string[] {
  const problems: string[] = [];
  for (const name of readdirSync(directory)) {
    if (!name.startsWith(FILE_PREFIX)) continue;
    const file = join(directory, name);
    try {
      if (expired(statSync(file).mtimeMs, now)) unlinkSync(file);
    } catch (error) {
      if (!isMissing(error)) {
        problems.push(
          `Cannot remove the expired hook memory ${file}: ${errorText(error)}.`,
        );
      }
    }
  }
  return problems;
}

function expired(modifiedAt: number, now: number): boolean {
  return now - modifiedAt > MEMORY_AGE_MS;
}

function isMissing(error: unknown): boolean {
  return MISSING_CODES.has((error as NodeJS.ErrnoException | undefined)?.code);
}

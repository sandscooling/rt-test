import { randomUUID } from "node:crypto";
import {
  closeSync,
  ftruncateSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import type { ParseObserver } from "../selection/specifier-edges.js";

const RECORD_PREFIX = "dependency-build-";
const RECORD_SUFFIX = ".parsing";
const RECORD_ENCODING = "utf8";
const EXCLUSIVE_CREATE = "wx";
const READ_WRITE = "r+";
const RECORD_START = 0;
const EMPTY = "";

/** Writes to a parse record the build's caller created, and releases it once the build ends. */
export interface ParseRecordWriter extends ParseObserver {
  close(): void;
}

/**
 * Creates an empty parse record in the state directory, under a name no other build in any daemon or worktree
 * shares, so no build can read a record another left.
 */
export function createParseRecord(stateDirectory: string): string {
  const file = join(
    stateDirectory,
    `${RECORD_PREFIX}${randomUUID()}${RECORD_SUFFIX}`,
  );
  writeFileSync(file, EMPTY, { flag: EXCLUSIVE_CREATE });
  return file;
}

/**
 * Each write returns before the parse it names starts, so a native abort that drops queued work still leaves the
 * label of the file whose parse did not return.
 */
export function openParseRecord(file: string): ParseRecordWriter {
  const descriptor = openSync(file, READ_WRITE);
  return {
    parsing(label) {
      ftruncateSync(descriptor, RECORD_START);
      writeSync(descriptor, label, RECORD_START, RECORD_ENCODING);
    },
    parsed() {
      ftruncateSync(descriptor, RECORD_START);
    },
    close() {
      closeSync(descriptor);
    },
  };
}

/** The root-relative label of the file being parsed, or `undefined` when no parse was in progress or the record cannot be read. */
export function parsingLabel(file: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(file, RECORD_ENCODING);
  } catch {
    return undefined;
  }
  return text === EMPTY ? undefined : text;
}

export function removeParseRecord(file: string): void {
  rmSync(file, { force: true });
}

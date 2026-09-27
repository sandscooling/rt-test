import { errorText } from "@rt-test/daemon/client";
import type { CliIo } from "./command.js";

/** Raised when a `--json` field changes incompatibly. */
export const CLI_JSON_SCHEMA_VERSION = 1;

export const EXIT_SUCCESS = 0;
/** The command ran and could not do what was asked, or refused to. */
export const EXIT_FAILURE = 1;
/** The arguments did not fit the command; nothing ran. */
export const EXIT_USAGE = 2;

export type ExitCode =
  typeof EXIT_SUCCESS | typeof EXIT_FAILURE | typeof EXIT_USAGE;

export type Fields = Readonly<Record<string, unknown>>;

/** Opens the reason of every start that started nothing. */
export const NOT_STARTED = "not started:";

const JSON_INDENT = 2;
const LINE_BREAK = "\n";
/** Control and invisible formatting characters, which could move the cursor or reorder what the user reviews. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}]/gu;
const ESCAPE_RADIX = 16;
const ESCAPE_DIGITS = 4;

function escaped(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  return `\\u${code.toString(ESCAPE_RADIX).padStart(ESCAPE_DIGITS, "0")}`;
}

/** A value read from the consumer's tree, made safe to print inside one line. */
export function oneLine(value: string): string {
  return value.replace(UNPRINTABLE, escaped);
}

/** Text for a terminal: every unprintable character escaped except the line breaks the CLI wrote itself. */
function terminalText(text: string): string {
  return text.replace(UNPRINTABLE, (character) =>
    character === LINE_BREAK ? character : escaped(character),
  );
}

/**
 * One command's outcome. Under `--json` stdout carries exactly one document, so `succeed` or `fail` is called once;
 * everything else a command says goes to stderr.
 */
export class Output {
  readonly io: CliIo;
  readonly command: string;
  readonly json: boolean;
  #reported = false;

  constructor(io: CliIo, command: string, json: boolean) {
    this.io = io;
    this.command = command;
    this.json = json;
  }

  /** A listing line, a question or a warning: stderr, whatever the mode. */
  note(line: string): void {
    this.io.stderr.write(`${terminalText(line)}\n`);
  }

  succeed(fields: Fields, human: string): ExitCode {
    this.#report();
    this.io.stdout.write(
      this.json ? this.#document(true, fields) : `${terminalText(human)}\n`,
    );
    return EXIT_SUCCESS;
  }

  fail(reason: string, fields: Fields = {}): ExitCode {
    this.#report();
    this.io.stderr.write(`${terminalText(reason)}\n`);
    if (this.json) {
      this.io.stdout.write(this.#document(false, { ...fields, reason }));
    }
    return EXIT_FAILURE;
  }

  #report(): void {
    if (this.#reported) {
      throw new Error(
        `rt-test ${this.command} tried to report its outcome twice.`,
      );
    }
    this.#reported = true;
  }

  #document(ok: boolean, fields: Fields): string {
    const document = {
      ...fields,
      schemaVersion: CLI_JSON_SCHEMA_VERSION,
      command: this.command,
      ok,
    };
    return `${JSON.stringify(document, null, JSON_INDENT)}\n`;
  }
}

/** Runs a command's work so that anything it throws is still reported, as one failure with its reason. */
export async function reported(
  io: CliIo,
  command: string,
  json: boolean,
  work: (output: Output) => Promise<ExitCode>,
): Promise<ExitCode> {
  const output = new Output(io, command, json);
  try {
    return await work(output);
  } catch (error) {
    return output.fail(errorText(error));
  }
}

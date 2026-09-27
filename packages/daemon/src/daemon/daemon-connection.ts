import type { Socket } from "node:net";
import { connectEndpoint } from "./endpoint.js";
import {
  encodeLine,
  LineDecoder,
  parseLine,
  RESPONSE_BOUND_MS,
} from "./protocol.js";

type Message = Readonly<Record<string, unknown>>;

/** The connection errors that mean nothing listens on the endpoint: no pipe or socket file, or a stale Linux one. */
const NOTHING_LISTENS = new Set(["ENOENT", "ECONNREFUSED"]);

export type Connected =
  | { readonly ok: true; readonly connection: DaemonConnection }
  | {
      readonly ok: false;
      readonly nothingListens: boolean;
      readonly reason: string;
    };

/** A client's connection to a daemon, answering each request with the daemon's next line. */
export class DaemonConnection {
  readonly #socket: Socket;
  readonly #lines: string[] = [];
  #waiting: ((line: string | Error) => void) | undefined;
  #closed: Error | undefined;

  private constructor(socket: Socket) {
    this.#socket = socket;
    const decoder = new LineDecoder();
    socket.on("data", (chunk: Buffer) => {
      for (const line of decoder.push(chunk)) {
        this.#deliver(
          line.tooLong
            ? new Error(
                "the daemon sent a line longer than the protocol allows",
              )
            : line.text,
        );
      }
    });
    socket.on("error", (error) => this.#end(error));
    socket.on("close", () =>
      this.#end(new Error("the daemon closed the connection")),
    );
  }

  static async open(path: string): Promise<Connected> {
    try {
      return {
        ok: true,
        connection: new DaemonConnection(await connectEndpoint(path)),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        ok: false,
        nothingListens: typeof code === "string" && NOTHING_LISTENS.has(code),
        reason: `cannot connect to ${path}: ${(error as Error).message}`,
      };
    }
  }

  /** Sends one message and resolves with the daemon's answer, rejecting when none arrives within the response bound. */
  async request(message: object): Promise<Message> {
    this.#socket.write(encodeLine(message));
    const line = await this.#nextLine();
    const parsed = parseLine(line);
    if (!parsed.ok)
      throw new Error(
        `the daemon answered with a line that is ${parsed.reason}`,
      );
    return parsed.message;
  }

  close(): void {
    this.#socket.destroy();
  }

  #nextLine(): Promise<string> {
    const queued = this.#lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.#closed !== undefined) return Promise.reject(this.#closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting = undefined;
        this.#socket.destroy();
        reject(
          new Error(`the daemon did not answer within ${RESPONSE_BOUND_MS} ms`),
        );
      }, RESPONSE_BOUND_MS);
      this.#waiting = (line) => {
        clearTimeout(timer);
        this.#waiting = undefined;
        if (line instanceof Error) reject(line);
        else resolve(line);
      };
    });
  }

  #deliver(line: string | Error): void {
    if (this.#waiting !== undefined) {
      this.#waiting(line);
      return;
    }
    if (line instanceof Error) this.#closed ??= line;
    else this.#lines.push(line);
  }

  #end(error: Error): void {
    this.#closed ??= error;
    this.#waiting?.(error);
  }
}

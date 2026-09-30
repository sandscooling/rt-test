import { isAbsolute } from "node:path";
import {
  CHANGES_TYPE,
  ERROR_TYPE,
  PROTOCOL_VERSION,
  type ErrorCode,
  type ErrorResponse,
  type ProtocolMessage,
} from "./protocol.js";

export function error(code: ErrorCode, message: string): ErrorResponse {
  return { type: ERROR_TYPE, protocolVersion: PROTOCOL_VERSION, code, message };
}

/** A refused value by its kind and size, never echoed, since a value near the line limit would push the refusal past it. */
export function valueShape(value: unknown): string {
  if (typeof value !== "string") return `a value of type ${typeof value}`;
  return `a string of ${Array.from(value).length} characters`;
}

/** The request's paths when they are a non-empty array of at most `max` absolute paths; otherwise its refusal. */
export function namedPaths(
  message: ProtocolMessage,
  type: string,
  max: number,
  allower: string,
): string[] | ErrorResponse {
  const paths = message["paths"];
  if (!Array.isArray(paths) || paths.length === 0) {
    return error(
      "invalid-request",
      `a ${type} request must carry a non-empty array of absolute paths`,
    );
  }
  if (paths.length > max) {
    return error(
      "invalid-request",
      `a ${type} request names ${paths.length} files, more than the ${max} ${allower} allows`,
    );
  }
  const notAbsolute = (paths as unknown[]).filter(
    (path) => typeof path !== "string" || !isAbsolute(path),
  );
  if (notAbsolute.length > 0) {
    return error(
      "invalid-request",
      `a ${type} request's paths must be absolute; got ${notAbsolute.map((path) => JSON.stringify(path)).join(", ")}`,
    );
  }
  return paths as string[];
}

/** A changes request's edited files, none when absent, when each is one of its `paths`; otherwise its refusal. */
export function editedPaths(
  edited: unknown,
  paths: readonly string[],
): string[] | ErrorResponse {
  if (edited === undefined) return [];
  if (!Array.isArray(edited)) {
    return error(
      "invalid-request",
      `a ${CHANGES_TYPE} request's edited must be an array of files among its paths; got ${valueShape(edited)}`,
    );
  }
  const named = new Set(paths);
  const strays = (edited as unknown[]).filter(
    (path) => typeof path !== "string" || !named.has(path),
  );
  if (strays.length > 0) {
    return error(
      "invalid-request",
      `a ${CHANGES_TYPE} request's edited must name only files among its paths; ${strays.length} of its ${edited.length} are not`,
    );
  }
  return edited as string[];
}

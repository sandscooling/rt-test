import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { errorText } from "../vitest/error-text.js";
import {
  runSystemTool as runTool,
  TOOL_TIMEOUT_MS,
} from "./windows-system-tool.js";

const WHOAMI = "whoami.exe";
const ICACLS = "icacls.exe";
/**
 * The most tool runs a daemon's start makes: the user's SID, the owner and the DACL of the directory it built, both
 * again when another start moved its own directory into place first, and the check.
 */
const START_TOOL_RUNS = 6;
/** A client's check of the directory: the user's SID and the DACL. */
const CHECK_TOOL_RUNS = 2;
/** The longest the key directory may hold up a start: the daemon's protection of it, then the client's first check. */
export const KEY_DIRECTORY_START_BOUND_MS =
  (START_TOOL_RUNS + CHECK_TOOL_RUNS) * TOOL_TIMEOUT_MS;
const SAVE_ENCODING = "utf16le";
const RANDOM_NAME_BYTES = 8;
const SAVE_PREFIX = ".acl-";
const BUILDING_SUFFIX = ".building-";
/** icacls names a well-known group by its SID after `*`, whatever the system's language. */
const SID_TRUSTEE_PREFIX = "*";
const FULL_ACCESS_INHERITED = ":(OI)(CI)F";
const SYSTEM_SID = "S-1-5-18";
const ADMINISTRATORS_SID = "S-1-5-32-544";
/** How SDDL writes SYSTEM and Administrators. */
const SYSTEM_ALIAS = "SY";
const ADMINISTRATORS_ALIAS = "BA";
/** How SDDL writes a machine's built-in Administrator and Guest accounts, by their SIDs' last part. */
const LOCAL_ACCOUNT_ALIASES: Readonly<Record<string, string>> = {
  "500": "LA",
  "501": "LG",
};
const DACL_PREFIX = "D:";
/** Where a mandatory label or audit entries follow the DACL on the same line; they grant nobody access. */
const SACL_PREFIX = "S:";
/** A DACL of this form grants every principal full access. */
const NO_DACL = "NO_ACCESS_CONTROL";
const ACE_START = "(";
const ACE_PATTERN = /\(([^)]*)\)/g;
const ACE_FIELD_SEPARATOR = ";";
const ACE_TRUSTEE_FIELD = 5;
const DENY_ACE_TYPES = new Set(["D", "OD"]);
const SID_PATTERN = /^S-1-\d+(?:-\d+)+$/;
const SID_PART_SEPARATOR = "-";
const CSV_FIELD_PATTERN = /"([^"]*)"/g;

let userSid: string | undefined;

/**
 * Why a directory cannot hold this user's daemon key: it must be a directory whose DACL grants access to nobody
 * but this user, SYSTEM and Administrators. Inherited access counts, since a profile folder may grant a group more.
 */
export function protectedDirectoryRefusal(
  directory: string,
): string | undefined {
  try {
    if (!statSync(directory).isDirectory()) {
      return `${directory} is not a directory`;
    }
    const dacl = daclOf(directory);
    if (dacl.includes(NO_DACL) || !dacl.includes(ACE_START)) {
      return `the key directory ${directory} has no access control list, so it grants everyone access`;
    }
    const others = otherTrustees(dacl, currentUserSid());
    if (others.length === 0) return undefined;
    return `the key directory ${directory} grants access to ${others.join(", ")}, not only to this user, SYSTEM and Administrators`;
  } catch (error) {
    return `cannot check who may read the key directory ${directory}: ${errorText(error)}`;
  }
}

/**
 * Makes the directory this user's own, with a DACL no parent's access reaches, then checks it. A missing directory is
 * built under another name and moved into place, so no path ever holds it with inherited access. An existing one is
 * taken over as its owner, so nobody else keeps an owner's right to change its DACL, and is refused when it still
 * grants anyone else.
 */
export function protectDirectory(directory: string): string | undefined {
  try {
    if (existsSync(directory)) {
      protect(directory, currentUserSid());
      return protectedDirectoryRefusal(directory);
    }
    return createProtected(directory);
  } catch (error) {
    return `cannot make the key directory ${directory} this user's alone: ${errorText(error)}`;
  }
}

function createProtected(directory: string): string | undefined {
  const building = `${directory}${BUILDING_SUFFIX}${randomName()}`;
  try {
    mkdirSync(dirname(directory), { recursive: true });
    mkdirSync(building);
    protect(building, currentUserSid());
    renameSync(building, directory);
  } catch (error) {
    rmSync(building, { recursive: true, force: true });
    if (!existsSync(directory)) {
      return `cannot create the key directory ${directory}: ${errorText(error)}`;
    }
    protect(directory, currentUserSid());
  }
  return protectedDirectoryRefusal(directory);
}

function protect(directory: string, sid: string): void {
  const user = `${SID_TRUSTEE_PREFIX}${sid}`;
  runTool(ICACLS, [directory, "/setowner", user]);
  runTool(ICACLS, [
    directory,
    "/inheritance:r",
    "/grant:r",
    `${user}${FULL_ACCESS_INHERITED}`,
    `${SID_TRUSTEE_PREFIX}${SYSTEM_SID}${FULL_ACCESS_INHERITED}`,
    `${SID_TRUSTEE_PREFIX}${ADMINISTRATORS_SID}${FULL_ACCESS_INHERITED}`,
  ]);
}

/**
 * The directory's DACL in SDDL, which names trustees by SID or alias rather than by localized account names. It is
 * saved beside the directory, in the profile folder only this user can write, since anyone who can write inside the
 * directory could replace the saved copy before it is read.
 */
function daclOf(directory: string): string {
  const saved = join(dirname(directory), `${SAVE_PREFIX}${randomName()}`);
  try {
    runTool(ICACLS, [directory, "/save", saved]);
    const dacl = readFileSync(saved, SAVE_ENCODING)
      .split(/\r?\n/)
      .find((line) => line.startsWith(DACL_PREFIX));
    if (dacl === undefined) {
      throw new Error(`${ICACLS} /save wrote no DACL for ${directory}`);
    }
    return dacl;
  } finally {
    rmSync(saved, { force: true });
  }
}

/** Each trustee an allowing entry names, other than this user, SYSTEM and Administrators. */
function otherTrustees(dacl: string, sid: string): string[] {
  const allowed = new Set([
    sid,
    SYSTEM_ALIAS,
    ADMINISTRATORS_ALIAS,
    SYSTEM_SID,
    ADMINISTRATORS_SID,
  ]);
  const alias =
    LOCAL_ACCOUNT_ALIASES[sid.split(SID_PART_SEPARATOR).at(-1) ?? ""];
  if (alias !== undefined) allowed.add(alias);
  const others = new Set<string>();
  const [daclAces = ""] = dacl.split(SACL_PREFIX);
  for (const [, ace] of daclAces.matchAll(ACE_PATTERN)) {
    const fields = (ace ?? "").split(ACE_FIELD_SEPARATOR);
    const trustee = fields[ACE_TRUSTEE_FIELD] ?? "";
    if (DENY_ACE_TYPES.has(fields[0] ?? "")) continue;
    if (!allowed.has(trustee)) others.add(trustee);
  }
  return [...others];
}

/** The SID of the account this process runs as, from its token. */
function currentUserSid(): string {
  if (userSid !== undefined) return userSid;
  const output = runTool(WHOAMI, ["/user", "/fo", "csv", "/nh"]);
  const sid = [...output.matchAll(CSV_FIELD_PATTERN)].at(-1)?.[1];
  if (sid === undefined || !SID_PATTERN.test(sid)) {
    throw new Error(`${WHOAMI} /user named no SID: ${JSON.stringify(output)}`);
  }
  userSid = sid;
  return sid;
}

function randomName(): string {
  return randomBytes(RANDOM_NAME_BYTES).toString("hex");
}

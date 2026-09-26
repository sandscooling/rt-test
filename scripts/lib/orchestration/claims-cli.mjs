import { statSync } from "node:fs";
import { join } from "node:path";
import {
  CLAIMS_DIR,
  claimFailureAdvice,
  claimPaths,
  endGrants,
  grantPaths,
  listClaims,
  listGrants,
  releasePaths,
} from "./claims.mjs";
import { toRepoPath } from "./paths.mjs";

const PROG = "file-claims";
const EXIT = { OK: 0, REFUSED: 1, USAGE: 2 };
const MS_PER_MINUTE = 60_000;
const VALUE_FLAGS = new Set(["--lane", "--thread"]);
const USAGE = [
  "  claim        --lane <name> --thread <threadId> <path>...",
  "  release      --lane <name> [<path>...]  |  release --any <path>...",
  "  list         [--lane <name>]",
  "  grant        --lane <name> --thread <threadId> <path>...",
  "  grant-end    --lane <name> [<path>...]  |  grant-end --any <path>...",
  "  grant-status",
];

class UsageError extends Error {}

export const claimsDirFor = (root, env = process.env) =>
  env.FILE_CLAIMS_DIR ?? join(root, CLAIMS_DIR);

function parseArgs(argv) {
  const flags = { any: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--any") flags.any = true;
    else if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
    } else positional.push(arg);
  }
  return { flags, positional };
}

function repoPaths(root, inputs, { files = true } = {}) {
  return inputs.map((input) => {
    const path = toRepoPath(root, input);
    if (path === null) {
      throw new UsageError(`path is outside the repository: ${input}`);
    }
    const stat = statSync(join(root, path), { throwIfNoEntry: false });
    if (files && stat?.isDirectory()) {
      throw new UsageError(`claims are per file, not per directory: ${input}`);
    }
    return path;
  });
}

const age = (ctx, at) => Math.round((ctx.now() - at) / MS_PER_MINUTE);

function describeHolder(ctx, holder) {
  return `${holder.lane} (thread ${holder.thread}, ${age(ctx, holder.at)} min ago)`;
}

function requireOwner(command, { flags, positional }) {
  if (!flags.lane || !flags.thread || positional.length === 0) {
    throw new UsageError(
      `${command} needs --lane, --thread and at least one path`,
    );
  }
  return { lane: flags.lane, thread: flags.thread };
}

function createdLines(r, verb) {
  return [
    ...r.created.map((p) => `${verb.padEnd(8)} ${p}`),
    ...r.held.map((p) => `HELD     ${p} (already yours)`),
  ];
}

function refusedLines(ctx, r) {
  return [
    ...r.refused.map((f) => `REFUSED  ${f.path}: ${f.reason}`),
    ...r.conflicts.map(
      (c) =>
        `CONFLICT ${c.path}: ${c.holder.path} held by ${describeHolder(ctx, c.holder)}`,
    ),
  ];
}

function claim(ctx, args) {
  const owner = requireOwner("claim", args);
  const paths = repoPaths(ctx.root, args.positional);
  const r = claimPaths(ctx.dir, ctx.rules, owner, paths, ctx.now());
  if (r.ok) return { code: EXIT.OK, out: createdLines(r, "CLAIMED"), err: [] };
  const err = [...refusedLines(ctx, r), `${PROG}: ${claimFailureAdvice(r)}`];
  return { code: EXIT.REFUSED, out: [], err };
}

function grant(ctx, args) {
  const owner = requireOwner("grant", args);
  const paths = repoPaths(ctx.root, args.positional, { files: false });
  const r = grantPaths(ctx.dir, ctx.rules, owner, paths, ctx.now());
  if (r.ok) return { code: EXIT.OK, out: createdLines(r, "GRANTED"), err: [] };
  const err = [
    ...refusedLines(ctx, r),
    `${PROG}: NOTHING WAS GRANTED. One lane holds a path at a time.`,
  ];
  return { code: EXIT.REFUSED, out: [], err };
}

function removal(remove, command, verb, ctx, { flags, positional }) {
  if (!flags.any && !flags.lane) {
    throw new UsageError(`${command} needs --lane, or --any with paths`);
  }
  if (flags.any && positional.length === 0) {
    throw new UsageError(`${command} --any needs at least one path`);
  }
  const who = { lane: flags.lane, any: flags.any };
  const paths = repoPaths(ctx.root, positional, { files: false });
  const r = remove(ctx.dir, who, paths);
  const out = [
    ...r.removed.map((p) => `${verb.toUpperCase().padEnd(8)} ${p}`),
    ...r.missing.map((p) => `NONE     ${p}`),
  ];
  const err = r.refused.map(
    (p) =>
      `REFUSED  ${p}: held by another lane; only the orchestrator removes it`,
  );
  return { code: err.length > 0 ? EXIT.REFUSED : EXIT.OK, out, err };
}

function grantLines(ctx, lane) {
  const grants = listGrants(ctx.dir, lane);
  return [
    ...grants.map((g) => `GRANT    ${g.path} to ${describeHolder(ctx, g)}`),
    `${grants.length} grant(s)${lane ? ` for ${lane}` : ""}`,
  ];
}

function list(ctx, { flags }) {
  const claims = listClaims(ctx.dir, flags.lane);
  const out = claims.map(
    (c) => `${c.lane}  ${c.path}  thread ${c.thread}  ${age(ctx, c.at)} min`,
  );
  out.push(
    `${claims.length} claim(s)${flags.lane ? ` for ${flags.lane}` : ""}`,
    ...grantLines(ctx, flags.lane),
  );
  return { code: EXIT.OK, out, err: [] };
}

const COMMANDS = {
  claim,
  release: (ctx, args) =>
    removal(releasePaths, "release", "released", ctx, args),
  list,
  grant,
  "grant-end": (ctx, args) =>
    removal(endGrants, "grant-end", "ended", ctx, args),
  "grant-status": (ctx) => ({ code: EXIT.OK, out: grantLines(ctx), err: [] }),
};

export function runClaimsCli(argv, ctx) {
  const [command, ...rest] = argv;
  try {
    if (!Object.hasOwn(COMMANDS, command ?? "")) {
      throw new UsageError(`unknown command ${JSON.stringify(command ?? "")}`);
    }
    const now = ctx.now ?? Date.now;
    return COMMANDS[command]({ ...ctx, now }, parseArgs(rest));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    return {
      code: EXIT.USAGE,
      out: [],
      err: [`${PROG}: ${error.message}`, ...USAGE],
    };
  }
}

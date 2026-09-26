import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  duplicateAnchors,
  loadBlocks,
  orphanLines,
  strayProse,
} from "./blocks.mjs";
import {
  DOC_NAMES,
  RuleError,
  docLabel,
  docSpec,
  loadRuleDocs,
  sources,
} from "./docs.mjs";
import {
  normalizeIds,
  parseIdList,
  renderMenu,
  renderRules,
} from "./render.mjs";

export const USAGE = `Usage: expand-rules.mjs <mode>
  --doc <checklist|project-context> <ids>      expand ids; an unresolved id fails
  --doc <doc> --list [--shard <name>]          list anchors; fails on a malformed corpus
  --doc <doc> --menu [ids] [--shard <name>]    one-read selection menu
  --ids checklist=<ids> --ids project-context=<ids>   both docs, strict
  --from-ticket <file> [--menu]                expand a ticket's rule-id markers
  --quiet                                      omit the count line, or the anchors under --list`;

const VALUE_FLAGS = new Map([
  ["--doc", "doc"],
  ["--shard", "shard"],
  ["--from-ticket", "fromTicket"],
]);
const BOOLEAN_FLAGS = new Map([
  ["--list", "list"],
  ["--menu", "menu"],
  ["--quiet", "quiet"],
]);

function parseArgs(argv) {
  const args = {
    list: false,
    menu: false,
    quiet: false,
    pairs: [],
    anchors: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (VALUE_FLAGS.has(arg) || arg === "--ids") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new RuleError(`${arg} needs a value.`);
      }
      index += 1;
      if (arg === "--ids") args.pairs.push(value);
      else args[VALUE_FLAGS.get(arg)] = value;
    } else if (BOOLEAN_FLAGS.has(arg)) {
      args[BOOLEAN_FLAGS.get(arg)] = true;
    } else if (arg.startsWith("--")) {
      throw new RuleError(`Unknown flag: ${arg}\n${USAGE}`);
    } else {
      args.anchors.push(arg);
    }
  }
  return args;
}

function resolveIds(spec, raw, io) {
  const { ids, repaired } = normalizeIds(spec, parseIdList(raw));
  if (repaired.length > 0) {
    io.err(
      `expand-rules: normalized ${repaired.length} ${spec.name} id(s) missing their ${spec.prefix} prefix (${repaired.join(", ")}). Fix the source that wrote them.`,
    );
  }
  return ids;
}

const isNone = (value) => value === "" || value.toLowerCase() === "none";

function ticketSection(spec, ticket, args, io) {
  const match = spec.marker.exec(ticket);
  if (!match) return { count: `${spec.name}=absent` };
  const value = match[1].trim();
  if (value === "PENDING") {
    throw new RuleError(
      `${spec.name} ids marker is still PENDING in ${args.fromTicket}: the ticket was never finalized.`,
    );
  }
  if (isNone(value)) {
    return {
      text: `${spec.sectionTitle}\n\n(none selected)`,
      count: `${spec.name}=0`,
    };
  }
  const wanted = resolveIds(spec, value, io);
  const { text, count, missing } = args.menu
    ? menuFor(spec, wanted)
    : renderRules(spec, wanted);
  if (count === 0) {
    throw new RuleError(
      `${spec.name} ids marker in ${args.fromTicket} resolves to ZERO rules (${wanted.join(", ")}). That is a malformed marker, not retired rules: ${spec.name} ids carry a ${spec.prefix} prefix. Run --list for valid anchors, or set the marker to none.`,
    );
  }
  if (missing.length > 0) {
    io.err(
      `expand-rules: WARNING, ${missing.length} of ${wanted.length} ${spec.name} id(s) no longer resolve and were skipped: ${missing.join(", ")}`,
    );
  }
  return {
    text: `${spec.sectionTitle}\n\n${text}`,
    count: `${spec.name}=${count}`,
  };
}

function menuFor(spec, wanted) {
  const { text, seen } = renderMenu(spec, new Set(wanted));
  return {
    text,
    count: seen.size,
    missing: wanted.filter((id) => !seen.has(id)),
  };
}

function readTicket(file) {
  try {
    return readFileSync(resolve(file), "utf8");
  } catch (error) {
    throw new RuleError(`--from-ticket target not readable: ${file}`, {
      cause: error,
    });
  }
}

function expandTicket(args, docs, io) {
  const ticket = readTicket(args.fromTicket);
  const sections = DOC_NAMES.map((name) =>
    ticketSection(docs[name], ticket, args, io),
  );
  if (sections.every((section) => section.text === undefined)) {
    throw new RuleError(`no rule-id markers found in ${args.fromTicket}.`);
  }
  return emit(sections, args, io);
}

function emit(sections, args, io) {
  io.out(
    sections
      .flatMap((s) => (s.text === undefined ? [] : [s.text]))
      .join("\n\n"),
  );
  if (!args.quiet)
    io.out(`\nRULE_COUNT: ${sections.map((s) => s.count).join(" ")}`);
  return 0;
}

function pairSection(pair, docs, io) {
  const at = pair.indexOf("=");
  if (at === -1) throw new RuleError(`--ids expects <doc>=<ids>, got: ${pair}`);
  const spec = docSpec(docs, pair.slice(0, at).trim());
  const value = pair.slice(at + 1).trim();
  if (isNone(value)) {
    return {
      text: `${spec.sectionTitle}\n\n(none selected)`,
      count: `${spec.name}=0`,
    };
  }
  const { text, count, missing } = renderRules(
    spec,
    resolveIds(spec, value, io),
  );
  if (missing.length > 0) {
    throw new RuleError(
      `${spec.name}: unresolved id(s): ${missing.join(", ")}`,
    );
  }
  return {
    text: `${spec.sectionTitle}\n\n${text}`,
    count: `${spec.name}=${count}`,
  };
}

function checkShard(spec, args) {
  if (!args.shard) return;
  if (spec.file) {
    throw new RuleError(
      `--shard does not apply to --doc ${spec.name}: that doc is a single file.`,
    );
  }
  if (sources(spec, args.shard).length === 0) {
    const available = sources(spec)
      .map((source) => source.name)
      .join(", ");
    throw new RuleError(
      `--shard ${args.shard} matches no shard of --doc ${spec.name}. Available: ${available}`,
    );
  }
}

function showMenu(spec, args, io) {
  const requested =
    args.anchors.length > 0
      ? resolveIds(spec, args.anchors.join(","), io)
      : undefined;
  const { text, seen } = renderMenu(
    spec,
    requested && new Set(requested),
    args.shard,
  );
  io.out(text);
  const unresolved = (requested ?? []).filter((id) => !seen.has(id));
  if (unresolved.length > 0) io.out(`\nUNRESOLVED: ${unresolved.join(",")}`);
  if (!args.quiet) {
    const scope = requested ? ` of ${requested.length} requested` : "";
    io.out(
      `\nMENU: ${seen.size}${scope} rule(s), ${text.length} chars. Expand the ones you keep with --doc ${spec.name} <ids>.`,
    );
  }
  return 0;
}

function reportProblems(io, heading, problems) {
  if (problems.length === 0) return false;
  const shown = problems.slice(0, 40).join("\n  ");
  const more =
    problems.length > 40 ? `\n  ... and ${problems.length - 40} more` : "";
  io.err(`\nexpand-rules: ${problems.length} ${heading}:\n  ${shown}${more}`);
  return true;
}

function listAnchors(spec, args, io) {
  for (const block of args.quiet ? [] : loadBlocks(spec, args.shard)) {
    io.out(`${block.anchor}\t${block.file}`);
  }
  const duplicates = duplicateAnchors(loadBlocks(spec)).map(
    (d) => `${d.anchor} at ${d.where.join(", ")}`,
  );
  const failed = [
    reportProblems(
      io,
      "id(s) claimed by more than one rule block; give the newer block a fresh id",
      duplicates,
    ),
    reportProblems(
      io,
      "line(s) shaped like a rule id that parse to no anchor, so nothing can select them",
      orphanLines(spec),
    ),
    reportProblems(
      io,
      `content line(s) in ${docLabel(spec)} outside every rule block, so nothing can select them. Give each an id or delete it; a ">" signpost is the only exemption`,
      strayProse(spec),
    ),
  ];
  return failed.some(Boolean) ? 1 : 0;
}

function expandExplicit(spec, args, io) {
  const raw = args.anchors.length > 0 ? args.anchors.join("\n") : io.stdin();
  const wanted = resolveIds(spec, raw, io);
  if (wanted.length === 0)
    throw new RuleError("no ids given (pass as arguments or on stdin).");
  const { text, count, missing } = renderRules(spec, wanted);
  if (missing.length > 0) {
    throw new RuleError(
      `unresolved id(s), refusing to emit a partial rule set: ${missing.join(", ")}. Run --doc ${spec.name} --list for valid anchors.`,
    );
  }
  io.out(text);
  if (!args.quiet) io.out(`\nRULE_COUNT: ${count}`);
  return 0;
}

function dispatch(args, docs, io) {
  if (args.fromTicket) return expandTicket(args, docs, io);
  if (args.pairs.length > 0) {
    return emit(
      args.pairs.map((pair) => pairSection(pair, docs, io)),
      args,
      io,
    );
  }
  if (!args.doc)
    throw new RuleError(`--doc, --ids or --from-ticket is required.\n${USAGE}`);
  const spec = docSpec(docs, args.doc);
  checkShard(spec, args);
  if (args.menu) return showMenu(spec, args, io);
  if (args.list) return listAnchors(spec, args, io);
  return expandExplicit(spec, args, io);
}

export function runExpandRules(argv, io) {
  try {
    const args = parseArgs(argv);
    return dispatch(args, loadRuleDocs(io.root).docs, io);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    io.err(`expand-rules: ${error.message}`);
    return 1;
  }
}

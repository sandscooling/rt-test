import { display, readText } from "./files.mjs";

const SPRINT_STATES = new Set(["backlog", "in-progress", "done"]);
const TICKET_STATES = new Set([
  "backlog",
  "ready-for-dev",
  "in-progress",
  "review",
  "done",
  "deferred",
]);
const SKIPPED = /^\s*(?:#.*)?$/;
const ENTRY = /^([^\s:#][^:]*):\s+(\S+)\s*(?:#.*)?$/;
const SPRINT_KEY = /^sprint-([1-9]\d*)$/;
const TICKET_KEY = /^([1-9]\d*)-([1-9]\d*[a-z]?)-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function readStatus(config) {
  const status = { sprints: new Map(), tickets: new Map(), problems: [] };
  const name = display(config, config.sprint_status);
  readText(config.sprint_status)
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (!SKIPPED.test(line)) addEntry(status, line, `${name}:${index + 1}`);
    });
  return status;
}

function addEntry(status, line, where) {
  const match = ENTRY.exec(line);
  if (!match) {
    status.problems.push(`${where}: expected "key: state", got: ${line}`);
    return;
  }
  const [, key, state] = match;
  const sprint = SPRINT_KEY.exec(key);
  if (sprint) {
    const entry = { key, state, where };
    record(status, status.sprints, sprint[1], entry, SPRINT_STATES);
    return;
  }
  const ticket = TICKET_KEY.exec(key);
  if (ticket) {
    const entry = { key, state, where, sprint: ticket[1] };
    record(
      status,
      status.tickets,
      `${ticket[1]}.${ticket[2]}`,
      entry,
      TICKET_STATES,
    );
    return;
  }
  status.problems.push(`${where}: malformed status key ${key}.`);
}

function record(status, map, id, entry, states) {
  if (!states.has(entry.state)) {
    const allowed = [...states].join(" | ");
    status.problems.push(
      `${entry.where}: ${entry.key} has unknown state ${entry.state}; use ${allowed}.`,
    );
    return;
  }
  const previous = map.get(id);
  if (previous) {
    status.problems.push(
      `${entry.where}: ${entry.key} repeats id ${id} from ${previous.where}.`,
    );
    return;
  }
  map.set(id, entry);
}

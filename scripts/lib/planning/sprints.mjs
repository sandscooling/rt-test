import { display, planningFiles, proseLines, readText } from "./files.mjs";

const SPRINT_FILE = /^sprint-([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const SPRINT_TITLE = /^# Sprint ([1-9]\d*): \S/;
const MILESTONE = /^\*\*Milestone:\*\* M\d+$/;
const TICKET_LIKE = /^#{1,6}\s+Tickets?\b/;
const TICKET_HEADING = /^## Ticket ([1-9]\d*)\.([1-9]\d*[a-z]?): \S/;

export function readSprints(config) {
  const plan = { sprints: new Map(), problems: [] };
  for (const { name, path } of planningFiles(config.sprints_dir)) {
    const where = display(config, path);
    const number = SPRINT_FILE.exec(name)?.[1];
    if (number === undefined) {
      plan.problems.push(
        `${where}: not a sprint file name (sprint-N-slug.md).`,
      );
      continue;
    }
    const previous = plan.sprints.get(number);
    if (previous) {
      plan.problems.push(
        `${where}: repeats Sprint ${number} from ${previous.where}.`,
      );
      continue;
    }
    plan.sprints.set(number, readSprint(readText(path), number, where, plan));
  }
  return plan;
}

function readSprint(text, number, where, plan) {
  const sprint = { where, tickets: new Map() };
  const lines = proseLines(text);
  const title = lines.find((line) => line.text.startsWith("# "));
  if (SPRINT_TITLE.exec(title?.text ?? "")?.[1] !== number) {
    plan.problems.push(
      `${where}: first heading must be "# Sprint ${number}: <title>".`,
    );
  }
  if (!lines.some((line) => MILESTONE.test(line.text))) {
    plan.problems.push(`${where}: missing "**Milestone:** M<n>" line.`);
  }
  for (const line of lines) {
    if (TICKET_LIKE.test(line.text)) addTicket(sprint, line, number, plan);
  }
  return sprint;
}

function addTicket(sprint, line, number, plan) {
  const at = `${sprint.where}:${line.number}`;
  const match = TICKET_HEADING.exec(line.text);
  if (!match) {
    plan.problems.push(`${at}: malformed ticket heading: ${line.text}`);
    return;
  }
  const id = `${match[1]}.${match[2]}`;
  if (match[1] !== number) {
    plan.problems.push(
      `${at}: Ticket ${id} belongs in the Sprint ${match[1]} file.`,
    );
    return;
  }
  if (sprint.tickets.has(id)) {
    plan.problems.push(`${at}: repeats Ticket ${id}.`);
    return;
  }
  sprint.tickets.set(id, { where: at });
}

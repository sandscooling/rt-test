import { display, failed, passed } from "./files.mjs";
import { readSprints } from "./sprints.mjs";
import { readStatus } from "./status.mjs";

export function checkSprintKeys(config, args) {
  if (args.length > 0) return failed(["usage: check-sprint-keys.mjs"]);
  const status = readStatus(config);
  const plan = readSprints(config);
  const problems = [
    ...status.problems,
    ...plan.problems,
    ...keysWithoutHeadings(status, plan),
    ...headingsWithoutKeys(status, plan),
  ];
  if (problems.length > 0) return failed(problems);
  const file = display(config, config.sprint_status);
  return passed([
    `sprint-keys: clean, ${status.sprints.size} sprint(s) and ${status.tickets.size} ticket(s) agree with ${file}.`,
  ]);
}

function keysWithoutHeadings(status, plan) {
  const problems = [];
  for (const [number, entry] of status.sprints) {
    if (!plan.sprints.has(number)) {
      problems.push(`${entry.where}: ${entry.key} has no sprint file.`);
    }
  }
  for (const [id, entry] of status.tickets) {
    const sprint = plan.sprints.get(entry.sprint);
    if (!sprint?.tickets.has(id)) {
      problems.push(
        `${entry.where}: ${entry.key} has no "## Ticket ${id}:" heading in a Sprint ${entry.sprint} file.`,
      );
    }
  }
  return problems;
}

function headingsWithoutKeys(status, plan) {
  const problems = [];
  for (const [number, sprint] of plan.sprints) {
    if (!status.sprints.has(number)) {
      problems.push(
        `${sprint.where}: Sprint ${number} has no sprint-${number} status key.`,
      );
    }
    for (const [id, ticket] of sprint.tickets) {
      if (!status.tickets.has(id)) {
        problems.push(`${ticket.where}: Ticket ${id} has no status key.`);
      }
    }
  }
  return problems;
}

const TICKET_ID = String.raw`[1-9]\d*\.[1-9]\d*[a-z]?`;
const SPRINT_LINK = /^Sprint ([1-9]\d*)$/;
const ONE_TICKET = new RegExp(`^Ticket (${TICKET_ID})$`);
const MANY_TICKETS = new RegExp(`^Tickets (${TICKET_ID}(?:, ${TICKET_ID})+)$`);
const UNSCHEDULED = /^Unscheduled: (\S.*)$/;
const PARTIAL = /^Partial: ([^;]+); remainder: (\S.*)$/;
const STARTED = new Set(["in-progress", "review", "done"]);

export function parseMarker(body) {
  const unscheduled = UNSCHEDULED.exec(body);
  if (unscheduled) return { kind: "unscheduled", reason: unscheduled[1] };
  const partial = PARTIAL.exec(body);
  if (partial) {
    const link = parseLink(partial[1]);
    return link && { kind: "partial", link, remainder: partial[2] };
  }
  const link = parseLink(body);
  return link && { kind: "linked", link };
}

function parseLink(text) {
  const sprint = SPRINT_LINK.exec(text);
  if (sprint) return { sprint: sprint[1] };
  const one = ONE_TICKET.exec(text);
  if (one) return { tickets: [one[1]] };
  const many = MANY_TICKETS.exec(text);
  if (many) return { tickets: many[1].split(", ") };
  return undefined;
}

export function unresolvedLinks(marker, status) {
  if (marker.kind === "unscheduled") return [];
  const { sprint, tickets } = marker.link;
  if (sprint !== undefined) {
    return status.sprints.has(sprint) ? [] : [`Sprint ${sprint}`];
  }
  return tickets
    .filter((id) => !status.tickets.has(id))
    .map((id) => `Ticket ${id}`);
}

export function deriveState(marker, status) {
  if (marker.kind === "unscheduled") return "unscheduled";
  const linked = linkState(marker.link, status);
  return marker.kind === "partial" && linked === "implemented"
    ? "partial"
    : linked;
}

function linkState(link, status) {
  if (link.sprint !== undefined) {
    return status.sprints.get(link.sprint)?.state === "done"
      ? "unclaimed"
      : "planned";
  }
  const states = link.tickets.map((id) => status.tickets.get(id)?.state);
  if (states.every((state) => state === "done")) return "implemented";
  if (states.some((state) => STARTED.has(state))) return "in-progress";
  return "planned";
}

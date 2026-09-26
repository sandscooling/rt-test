import { describe, expect, it } from "vitest";
import {
  TEMPLATE_FILE,
  applyFills,
  applyIds,
  checkTicket,
  parseSectionsFile,
  scaffold,
  templateProblems,
} from "../../../scripts/lib/skills/ticket.mjs";
import { fillTicket, inTree } from "./harness.js";

const TICKET = [
  "# Ticket 1.1: Parse events",
  "",
  "## Ticket",
  "",
  "TBD",
  "",
  "## Acceptance Criteria",
  "",
  "## Dev Notes",
  "",
  "<!--",
  "guidance the template ships",
  "-->",
  "",
  "TBD",
  "",
  "### References",
  "",
  "none",
  "",
  "## Checklist Rules",
  "",
  "<!-- CHECKLIST_RULE_IDS: PENDING -->",
  "",
  "## Execution Metadata",
  "",
  "```yaml",
  "area:",
  "```",
  "",
  "## Dev Agent Record",
  "",
].join("\n");

const CONTRACT_TEMPLATE = [
  "# Ticket {{sprint_num}}.{{ticket_num}}: {{ticket_title}}",
  "## Ticket",
  "## Acceptance Criteria",
  "## Unverified Assumptions",
  "## Tasks / Subtasks",
  "## Reusable Code",
  "## Dev Notes",
  "### References",
  "## Checklist Rules",
  "<!-- CHECKLIST_RULE_IDS: PENDING -->",
  "## Project Context Rules",
  "<!-- PROJECT_CONTEXT_RULE_IDS: PENDING -->",
  "## Execution Metadata",
  "```yaml",
  "area:",
  "is_consolidation: false",
  "sizing_ac_count:",
  "files_to_modify: []",
  "files_to_create: []",
  "```",
  "## Dev Agent Record",
  "### Dev Handoff",
  "#### Test Files This Change Broke",
  "#### ACs Owed a Test",
  "#### Tests Owed",
  "### Tests Record",
  "#### Named Defects",
  "#### Deliberately Untested",
  "### Review Record",
  "#### Test Coverage Gaps",
  "### Completion Notes",
  "### File List",
  "",
].join("\n");

const fill = (name: string, ...body: string[]) => ({ name, body });

describe("section fills", () => {
  it("D500: a fill stops at the next heading of the same level", () => {
    const result = applyFills(TICKET, [
      fill("Acceptance Criteria", "- [ ] AC1: a"),
    ]);
    expect(result.text).toContain("## Dev Notes");
  });

  it("D501: a fill keeps the guidance comment the section already carries", () => {
    const result = applyFills(TICKET, [fill("Dev Notes", "real notes")]);
    expect(result.text).toContain("guidance the template ships");
  });

  it("D502: one unknown heading aborts the whole batch", () => {
    const result = applyFills(TICKET, [
      fill("Acceptance Criteria", "kept out"),
      fill("No Such Heading", "x"),
    ]);
    expect(result.errors).toEqual([
      'No Such Heading: no heading matches "No Such Heading"',
    ]);
  });

  it("D503: a batch naming a section and its child is refused", () => {
    const result = applyFills(TICKET, [
      fill("Dev Notes", "parent prose"),
      fill("References", "- source"),
    ]);
    expect(result.errors).toHaveLength(1);
  });

  it("D504: a prose fill over a machine-read block is refused", () => {
    const result = applyFills(TICKET, [
      fill("Execution Metadata", "some prose"),
    ]);
    expect(result.errors).toBeDefined();
  });

  it("D861: a heading inside a longer fence stays text across a shorter marker", () => {
    const example = "````md\n```\n## Acceptance Criteria\n```\n````";
    const result = applyFills(TICKET.replace("none", example), [
      fill("Acceptance Criteria", "- [ ] AC1: a"),
    ]);
    expect(result.errors).toBeUndefined();
  });

  it("D862: an opener that never closes leaves the headings after it findable", () => {
    const result = applyFills(TICKET.replace("none", "~~~sh"), [
      fill("Dev Agent Record", "notes"),
    ]);
    expect(result.errors).toBeUndefined();
  });

  it("D877: a heading inside a fenced example does not collide with the real section", () => {
    const example = "```md\n## Acceptance Criteria\n```";
    const result = applyFills(TICKET.replace("none", example), [
      fill("Acceptance Criteria", "- [ ] AC1: a"),
    ]);
    expect(result.errors).toBeUndefined();
  });

  it("D879: a data fence nested inside a longer fenced example is not the section's machine-read block", () => {
    const example = "````md\n```yaml\na: 1\n```\n````";
    const result = applyFills(TICKET.replace("none", example), [
      fill("References", "plain"),
    ]);
    expect(result.errors).toBeUndefined();
  });
});

describe("scaffold", () => {
  it("D505: leaves the rule-id sections to --ids", () => {
    expect(scaffold(TICKET).sections).not.toContain("<<< Checklist Rules");
  });

  it("D506: puts a child heading inside its parent's block", () => {
    expect(scaffold(TICKET).sections).toContain(
      "<<< Dev Notes\n\n### References\n\n>>>",
    );
  });

  it("D507: leaves the Dev Agent Record to the later sessions", () => {
    expect(scaffold(TICKET).sections).not.toContain("<<< Dev Agent Record");
  });
});

describe("sections file", () => {
  it("D517: a heading named twice is refused", () => {
    const parsed = parseSectionsFile(
      "<<< Ticket\na\n>>>\n<<< Ticket\nb\n>>>\n",
    );
    expect(parsed.errors).toEqual([
      '"Ticket" is named twice; the second would silently win',
    ]);
  });

  it("D518: an unclosed block is named", () => {
    expect(parseSectionsFile("<<< Ticket\nbody\n").errors).toEqual([
      'block "Ticket" at line 1 never closes with ">>>"',
    ]);
  });
});

describe("rule-id markers", () => {
  it("D508: two markers for one doc are refused", () => {
    const doubled = `${TICKET}\n<!-- CHECKLIST_RULE_IDS: PENDING -->\n`;
    expect(applyIds(doubled, { checklist: "C1" }).errors).toEqual([
      "CHECKLIST_RULE_IDS: expected exactly 1 marker, found 2",
    ]);
  });
});

describe("ticket check", () => {
  it("D509: placeholders under the Dev Agent Record are left for later sessions", () => {
    const done = `${TICKET.replace(
      "<!-- CHECKLIST_RULE_IDS: PENDING -->",
      "<!-- CHECKLIST_RULE_IDS: C1 -->",
    )}Dev session: threadId {{dev_thread_id}}\n`;
    expect(checkTicket(done, TICKET)).toEqual([]);
  });

  it("D510: a PENDING marker fails the check", () => {
    expect(checkTicket(TICKET, TICKET)).toEqual([
      "line 23: rule-id marker still PENDING",
    ]);
  });

  it("D511: a nested heading the template ships is required", () => {
    const done = TICKET.replace("### References", "### Sources").replace(
      "PENDING",
      "none",
    );
    expect(checkTicket(done, TICKET)).toEqual([
      'missing section "References", which the template ships',
    ]);
  });

  it("D512: a lost machine-read block fails the check", () => {
    const done = TICKET.replace("```yaml\narea:\n```", "area: scripts").replace(
      "PENDING",
      "none",
    );
    expect(checkTicket(done, TICKET)).toEqual([
      'section "Execution Metadata" lost the machine-read block the template ships there; restore it',
    ]);
  });

  it("D521: a title that is not the ticket heading fails the check", () => {
    const done = TICKET.replace(
      "# Ticket 1.1: Parse events",
      "# Parse events",
    ).replace("PENDING", "none");
    expect(checkTicket(done, TICKET)).toEqual([
      'the first line is not "# Ticket <N>.<M>: <title>"',
    ]);
  });

  it("D527: a split ticket's lettered title passes the check", () => {
    const done = TICKET.replace(
      "# Ticket 1.1: Parse events",
      "# Ticket 3.2b: Parse events",
    ).replace("PENDING", "none");
    expect(checkTicket(done, TICKET)).toEqual([]);
  });

  it("D522: a bold Status line in the ticket header fails the check", () => {
    const done = TICKET.replace(
      "# Ticket 1.1: Parse events",
      "# Ticket 1.1: Parse events\n**Status:** ready-for-dev",
    ).replace("PENDING", "none");
    expect(checkTicket(done, TICKET)).toEqual([
      "line 2: a Status line; state lives only in the status file",
    ]);
  });

  it("D523: an emptied rule-id marker fails the check", () => {
    const done = TICKET.replace("PENDING", "");
    expect(checkTicket(done, TICKET)).toEqual([
      "line 23: rule-id marker is empty; write the ids or none",
    ]);
  });

  it("D524: a metadata key the template ships is required", () => {
    const done = TICKET.replace(
      "```yaml\narea:\n```",
      "```yaml\nsizing_ac_count: 3\n```",
    ).replace("PENDING", "none");
    expect(checkTicket(done, TICKET)).toEqual([
      '"Execution Metadata" yaml block lost the area key',
    ]);
  });

  it("D525: --ids refuses an empty id list", () => {
    expect(applyIds(TICKET, { checklist: "" }).errors).toEqual([
      "CHECKLIST_RULE_IDS: no ids given; write none for an empty selection",
    ]);
  });
});

describe("template contract", () => {
  it("D513: a template missing a contract heading is reported", () => {
    const broken = CONTRACT_TEMPLATE.replace("#### Test Coverage Gaps\n", "");
    expect(templateProblems(broken)).toEqual([
      'template carries "#### Test Coverage Gaps" 0 times; expected once',
    ]);
  });

  it("D514: a template whose marker is not PENDING is reported", () => {
    const broken = CONTRACT_TEMPLATE.replace(
      "PROJECT_CONTEXT_RULE_IDS: PENDING",
      "PROJECT_CONTEXT_RULE_IDS: P1",
    );
    expect(templateProblems(broken)).toEqual([
      "template carries 0 PENDING PROJECT_CONTEXT_RULE_IDS markers; expected 1",
    ]);
  });

  it("D515: a metadata block missing a key dev-ticket reads is reported", () => {
    const broken = CONTRACT_TEMPLATE.replace("sizing_ac_count:\n", "");
    expect(templateProblems(broken)).toEqual([
      '"Execution Metadata" yaml block lacks the sizing_ac_count key',
    ]);
  });
});

describe("fill-ticket CLI", () => {
  it("D519: --check compares the ticket with the template's structure", () => {
    const ticket = CONTRACT_TEMPLATE.replace("## Reusable Code\n", "")
      .replaceAll("PENDING", "none")
      .replace(
        "# Ticket {{sprint_num}}.{{ticket_num}}: {{ticket_title}}",
        "# Ticket 1.1: X",
      );
    const code = inTree(
      { [TEMPLATE_FILE]: CONTRACT_TEMPLATE, "t.md": ticket },
      ({ root }) => fillTicket(root, ["--check", "t.md"]).code,
    );
    expect(code).toBe(1);
  });

  it("D520: --ids writes the ids after the equals sign into the marker", () => {
    const written = inTree({ "t.md": TICKET }, ({ root, read }) => {
      fillTicket(root, ["--ids", "t.md", "checklist=C1, C2"]);
      return read("t.md");
    });
    expect(written).toContain("<!-- CHECKLIST_RULE_IDS: C1, C2 -->");
  });
});

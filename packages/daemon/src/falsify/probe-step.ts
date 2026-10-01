/**
 * Where a reach probe stands: at the start of the step that holds a change. A step is the innermost statement around
 * the change, or the head of a function's body when the change sits in that function outside every statement of its
 * body. A probe is only ever text inserted into the module, and it stands inside every function that holds the change.
 */
import { REACH_PROBE_CALL } from "./reach-names.js";

/** An ESTree node as the parser returns it, a plain object. */
export interface SyntaxNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [field: string]: unknown;
}

export interface Span {
  readonly start: number;
  readonly end: number;
}

interface Insertion {
  readonly offset: number;
  readonly text: string;
}

export interface Step {
  /** Offset where the step starts: its statement's first character, its function's, or where a probe ends a list. */
  readonly start: number;
  /** The step is a place in a statement list, which a probe stands before; any other step is entered at its first character. */
  readonly inList: boolean;
  /** The node the probe stands on, and the parent's node type and field holding it, such as "BlockStatement.body". */
  readonly nodeKind: string;
  readonly role: string;
  /** In text order. The first is where the probe stands. */
  readonly insertions: readonly [Insertion, ...Insertion[]];
}

export type StepChoice =
  | { readonly found: true; readonly step: Step }
  /** Nothing runs where the change sits. `role` is "root" for the program itself. */
  | { readonly found: false; readonly nodeKind: string; readonly role: string };

interface PathStep {
  readonly node: SyntaxNode;
  /** The field of the previous step's node that holds this node; empty for the root. */
  readonly field: string;
}

const ROLE_SEPARATOR = ".";
const ROOT_ROLE = "root";
const PROGRAM = "Program";
const BLOCK = "BlockStatement";
const STATIC_BLOCK = "StaticBlock";
const SWITCH_CASE = "SwitchCase";
const LABELED = "LabeledStatement";
const STATEMENT_SUFFIX = "Statement";
const MODULE_DECLARATION = "TSModuleDeclaration";
const BODY_FIELD = "body";
const CONSEQUENT_FIELD = "consequent";
const INITIALIZER_FIELD = "value";
const CLOSING_BRACE_LENGTH = 1;

/**
 * The node kinds that own a statement list, with the field holding it. A list not named here is probed at the step
 * around it, as a namespace's is: a probe inside a namespace of types alone would make it a value.
 */
const STATEMENT_LIST_FIELDS: ReadonlyMap<string, string> = new Map([
  [PROGRAM, BODY_FIELD],
  [BLOCK, BODY_FIELD],
  [STATIC_BLOCK, BODY_FIELD],
  [SWITCH_CASE, CONSEQUENT_FIELD],
]);

/** The list owners written between braces, where an empty list takes the probe before the closing one. */
const BRACED_LISTS = new Set([BLOCK, STATIC_BLOCK]);

/** A class field's initializer runs when an instance is made, as a function's body runs when it is called. */
const FIELD_OWNERS = new Set(["PropertyDefinition", "AccessorProperty"]);

const PROBE_STATEMENT = `${REACH_PROBE_CALL}; `;
/** Opens with a semicolon, since the statement before it may be written without one. */
const CLOSING_PROBE_STATEMENT = `;${REACH_PROBE_CALL};`;
const BLOCK_OPENING = `{ ${PROBE_STATEMENT}`;
const BLOCK_CLOSING = " }";
const WRAP_OPENING = `(${REACH_PROBE_CALL}, `;
const WRAP_CLOSING = ")";

/**
 * The step that holds every character of `span` in the tree under `root`, or why the change has none. An empty span is
 * a point between two characters. It lies in each node it falls strictly inside, and, when `opensNode` says the
 * change began with the first character of what stands there, in each node that starts at it.
 */
export function stepAt(
  root: SyntaxNode,
  span: Span,
  opensNode: boolean,
): StepChoice {
  const path = enclosingPath(root, span, opensNode);
  if (path.some(({ node }) => isAmbient(node))) return noStep(path);
  return changedListPoint(path, span) ?? enclosingStep(path) ?? noStep(path);
}

/** The text with a step's probe written in. */
export function withProbe(text: string, step: Step): string {
  let written = "";
  let from = 0;
  for (const { offset, text: inserted } of step.insertions) {
    written += text.slice(from, offset) + inserted;
    from = offset;
  }
  return written + text.slice(from);
}

export function isSyntaxNode(value: unknown): value is SyntaxNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    "start" in value &&
    typeof value.start === "number" &&
    "end" in value &&
    typeof value.end === "number"
  );
}

/** Descends one child at a time, since siblings never overlap, so the path ends at the deepest enclosing node. */
function enclosingPath(
  root: SyntaxNode,
  span: Span,
  opensNode: boolean,
): PathStep[] {
  const path: PathStep[] = [{ node: root, field: "" }];
  for (;;) {
    const next = enclosingChild(lastStep(path).node, span, opensNode);
    if (next === undefined) return path;
    path.push(next);
  }
}

function enclosingChild(
  node: SyntaxNode,
  span: Span,
  opensNode: boolean,
): PathStep | undefined {
  for (const [field, value] of Object.entries(node)) {
    const children: unknown[] = Array.isArray(value) ? value : [value];
    const child = children.find(
      (candidate) =>
        isSyntaxNode(candidate) && encloses(candidate, span, opensNode),
    );
    if (isSyntaxNode(child)) return { node: child, field };
  }
  return undefined;
}

function encloses(node: SyntaxNode, span: Span, opensNode: boolean): boolean {
  if (span.start !== span.end) {
    return node.start <= span.start && span.end <= node.end;
  }
  const startsBefore = opensNode
    ? node.start <= span.start
    : node.start < span.start;
  return startsBefore && span.start < node.end;
}

/** Code inside an ambient declaration never runs. */
function isAmbient(node: SyntaxNode): boolean {
  return (
    node.declare === true ||
    (node.type === MODULE_DECLARATION && node.global === true)
  );
}

/**
 * The change sits directly in a statement list, between its statements or across several: the probe stands before the
 * first statement that ends after the change starts. Before a `case`'s first statement the change may be the case's
 * own test, which decides whether those statements run at all, so that change belongs to the step around the `switch`.
 */
function changedListPoint(
  path: readonly PathStep[],
  span: Span,
): StepChoice | undefined {
  const owner = lastStep(path).node;
  const field = STATEMENT_LIST_FIELDS.get(owner.type);
  if (field === undefined) return undefined;
  const members = membersOf(owner, field);
  const first = members[0];
  if (
    owner.type === SWITCH_CASE &&
    (first === undefined || span.start < first.start)
  ) {
    return undefined;
  }
  const touched = members.findIndex((member) => member.end > span.start);
  const step = listPoint(
    owner,
    field,
    touched === -1 ? members.length : touched,
  );
  return step === undefined ? noStep(path) : { found: true, step };
}

/** Walks out from the change to the first node that is a step of its own. */
function enclosingStep(path: readonly PathStep[]): StepChoice | undefined {
  for (const [index, here] of [...path.entries()].reverse()) {
    const step = stepOn(here, path[index - 1]?.node);
    if (step !== undefined) return { found: true, step };
  }
  return undefined;
}

function stepOn(
  { node, field }: PathStep,
  holder: SyntaxNode | undefined,
): Step | undefined {
  const body = functionBody(node);
  if (body !== undefined) return bodyHead(node, body);
  if (holder === undefined) return undefined;
  const role = roleOf(holder, field);
  if (STATEMENT_LIST_FIELDS.get(holder.type) === field) {
    return listPoint(holder, field, membersOf(holder, field).indexOf(node));
  }
  if (FIELD_OWNERS.has(holder.type) && field === INITIALIZER_FIELD) {
    return wrapped(node, role);
  }
  return standsAlone(node, holder) ? asBlock(node, role) : undefined;
}

/** A function without a body, an overload or an abstract method, runs nothing and is no step. */
function functionBody(node: SyntaxNode): SyntaxNode | undefined {
  const body = node[BODY_FIELD];
  return Array.isArray(node.params) && isSyntaxNode(body) ? body : undefined;
}

/** The head of a function's body runs when the function is called, never where it is defined. */
function bodyHead(fn: SyntaxNode, body: SyntaxNode): Step | undefined {
  const field = STATEMENT_LIST_FIELDS.get(body.type);
  const step =
    field === undefined
      ? wrapped(body, roleOf(fn, BODY_FIELD))
      : listPoint(body, field, 0);
  return step === undefined
    ? undefined
    : { ...step, start: fn.start, inList: false };
}

/**
 * A statement that is a branch or a loop's body on its own, held by the statement it belongs to. A label stays with
 * the statement it names, since a loop that continues to its label must stand directly under it.
 */
function standsAlone(node: SyntaxNode, holder: SyntaxNode): boolean {
  return isStatement(node) && isStatement(holder) && holder.type !== LABELED;
}

function isStatement(node: SyntaxNode): boolean {
  return node.type.endsWith(STATEMENT_SUFFIX);
}

/**
 * A probe statement at `index` of a statement list. It never stands inside the list's directive prologue, where it
 * would turn each later directive into a plain string. Undefined where the list is empty and not written between
 * braces, as a program with no statement is.
 */
function listPoint(
  owner: SyntaxNode,
  field: string,
  index: number,
): Step | undefined {
  const members = membersOf(owner, field);
  const prologue = members.findIndex((member) => !isDirective(member));
  const at = Math.max(index, prologue === -1 ? members.length : prologue);
  const role = roleOf(owner, field);
  const next = members[at];
  if (next !== undefined) {
    return {
      start: next.start,
      inList: true,
      nodeKind: next.type,
      role,
      insertions: [{ offset: next.start, text: PROBE_STATEMENT }],
    };
  }
  const end = members[at - 1]?.end ?? emptyListEnd(owner);
  if (end === undefined) return undefined;
  return {
    start: end,
    inList: true,
    nodeKind: owner.type,
    role,
    insertions: [{ offset: end, text: CLOSING_PROBE_STATEMENT }],
  };
}

function emptyListEnd(owner: SyntaxNode): number | undefined {
  return BRACED_LISTS.has(owner.type)
    ? owner.end - CLOSING_BRACE_LENGTH
    : undefined;
}

/** The node becomes the last member of a comma expression that starts with the probe. */
function wrapped(node: SyntaxNode, role: string): Step {
  return {
    start: node.start,
    inList: false,
    nodeKind: node.type,
    role,
    insertions: [
      { offset: node.start, text: WRAP_OPENING },
      { offset: node.end, text: WRAP_CLOSING },
    ],
  };
}

/** The statement becomes a block that starts with the probe; the block spans the whole statement, so an `else` after it binds as before. */
function asBlock(node: SyntaxNode, role: string): Step {
  return {
    start: node.start,
    inList: false,
    nodeKind: node.type,
    role,
    insertions: [
      { offset: node.start, text: BLOCK_OPENING },
      { offset: node.end, text: BLOCK_CLOSING },
    ],
  };
}

function noStep(path: readonly PathStep[]): StepChoice {
  const { node, field } = lastStep(path);
  const holder = path[path.length - 2]?.node;
  return {
    found: false,
    nodeKind: node.type,
    role: holder === undefined ? ROOT_ROLE : roleOf(holder, field),
  };
}

function isDirective(node: SyntaxNode): boolean {
  return typeof node.directive === "string";
}

function membersOf(owner: SyntaxNode, field: string): SyntaxNode[] {
  const list = owner[field];
  return Array.isArray(list) ? list.filter(isSyntaxNode) : [];
}

/** The parent's node type and the field holding the node, such as `IfStatement.consequent`. */
function roleOf(parent: SyntaxNode, field: string): string {
  return `${parent.type}${ROLE_SEPARATOR}${field}`;
}

function lastStep(path: readonly PathStep[]): PathStep {
  const step = path[path.length - 1];
  if (step === undefined) throw new Error("an enclosing path is never empty");
  return step;
}

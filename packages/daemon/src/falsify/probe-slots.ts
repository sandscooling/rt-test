/**
 * Where a reach probe may sit without changing what the module does. Only an allowlisted position takes a probe,
 * since a probe that alters behavior can fail a test as though the mutation had been detected.
 */

/** An ESTree node as the parser returns it, a plain object. */
export interface SyntaxNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [field: string]: unknown;
}

export interface PathStep {
  readonly node: SyntaxNode;
  /** The field of the previous step's node that holds this node; empty for the root. */
  readonly field: string;
}

/** A node in its position, with every step from the root down to it, the node last. */
export interface Slot {
  readonly node: SyntaxNode;
  readonly field: string;
  readonly parent: SyntaxNode;
  readonly path: readonly PathStep[];
}

export const PLACEMENT = {
  /** Wrap the node as the last member of a comma expression. */
  expression: "expression",
  /** Insert a probe statement before the node. */
  statement: "statement",
} as const;

export type Placement = (typeof PLACEMENT)[keyof typeof PLACEMENT];

type SlotCheck = (slot: Slot) => boolean;

const ROLE_SEPARATOR = ".";
const OBJECT_LITERAL = "ObjectExpression";
const BLOCK = "BlockStatement";
export const CHAIN = "ChainExpression";
const TS_PREFIX = "TS";
const DECLARATION_SUFFIX = "Declaration";
const INIT_PROPERTY = "init";
const TYPE_EXPORT = "type";
const VALUE_BLIND_UNARY = new Set(["typeof", "delete"]);
const EXPORTS = new Set(["ExportNamedDeclaration", "ExportDefaultDeclaration"]);

/** Wrapping these changes their meaning wherever they sit: an inferred name is lost, or the result is not an expression. */
const NEVER_WRAPPED = new Set([
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassExpression",
  "Super",
  "PrivateIdentifier",
  "SpreadElement",
  "TemplateElement",
  "ObjectPattern",
  "ArrayPattern",
  "RestElement",
  "AssignmentPattern",
  "JSXEmptyExpression",
]);

/**
 * The TypeScript nodes that are values, each holding one in `expression`; every other `TS` node is a type or a
 * declaration. Compiling strips each, so its operand runs in the wrapper's own position.
 */
const TS_VALUE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);
const WRAPPED_OPERAND = "expression";
const MODULE_DECLARATION = "TSModuleDeclaration";

/** A link through which an optional chain continues, as `role`, and the node kinds that continue it. */
const CHAIN_LINKS = new Set([
  "MemberExpression.object",
  "CallExpression.callee",
  "TSNonNullExpression.expression",
]);
const CHAIN_CONTINUATIONS = new Set([
  "MemberExpression",
  "CallExpression",
  "TSNonNullExpression",
]);

const STATEMENT_LISTS = new Set([
  "Program.body",
  "BlockStatement.body",
  "StaticBlock.body",
  "SwitchCase.consequent",
  "TSModuleBlock.body",
]);

/** Statements whose position runs nothing when reached: hoisted, linked before the module runs, or types only. */
const NOT_RUN_IN_PLACE = new Set([
  "FunctionDeclaration",
  "ImportDeclaration",
  "ExportAllDeclaration",
  "TSImportEqualsDeclaration",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSDeclareFunction",
  "TSNamespaceExportDeclaration",
]);

const always: SlotCheck = () => true;

const EXPRESSION_SLOTS: ReadonlyMap<string, SlotCheck> = new Map([
  ["BinaryExpression.left", always],
  ["BinaryExpression.right", always],
  ["LogicalExpression.left", always],
  ["LogicalExpression.right", always],
  ["ConditionalExpression.test", always],
  ["ConditionalExpression.consequent", always],
  ["ConditionalExpression.alternate", always],
  ["CallExpression.arguments", always],
  ["NewExpression.arguments", always],
  ["ArrayExpression.elements", always],
  ["Property.value", objectLiteralValue],
  ["Property.key", objectLiteralComputedKey],
  ["PropertyDefinition.key", computedKey],
  ["MethodDefinition.key", computedKey],
  ["AccessorProperty.key", computedKey],
  ["PropertyDefinition.value", always],
  ["VariableDeclarator.init", always],
  ["AssignmentExpression.right", always],
  ["ReturnStatement.argument", always],
  ["ThrowStatement.argument", always],
  ["UnaryExpression.argument", valueUnaryArgument],
  ["AwaitExpression.argument", always],
  ["YieldExpression.argument", always],
  ["SpreadElement.argument", always],
  ["TemplateLiteral.expressions", always],
  ["MemberExpression.object", notChainContinuation],
  ["MemberExpression.property", computedKey],
  ["IfStatement.test", always],
  ["WhileStatement.test", always],
  ["DoWhileStatement.test", always],
  ["ForStatement.test", always],
  ["ForStatement.init", always],
  ["ForStatement.update", always],
  ["ForInStatement.right", always],
  ["ForOfStatement.right", always],
  ["SwitchStatement.discriminant", always],
  ["SwitchCase.test", always],
  ["SequenceExpression.expressions", always],
  ["AssignmentPattern.right", always],
  ["ArrowFunctionExpression.body", expressionBody],
  ["JSXExpressionContainer.expression", always],
  ["ExportDefaultDeclaration.declaration", always],
  ["ExpressionStatement.expression", notDirective],
]);

/** The parent's node type and the field holding the node, such as `CallExpression.callee`. */
export function roleOf(parent: SyntaxNode, field: string): string {
  return `${parent.type}${ROLE_SEPARATOR}${field}`;
}

/**
 * How a probe can be placed at this node, or undefined where every placement could alter the module. Code inside an
 * ambient declaration never runs, so it takes no probe.
 */
export function placementAt(slot: Slot): Placement | undefined {
  if (slot.path.some(({ node }) => isAmbient(node))) return undefined;
  if (STATEMENT_LISTS.has(roleOf(slot.parent, slot.field))) {
    return runsWhereItStands(slot.node) ? PLACEMENT.statement : undefined;
  }
  if (!wrappableKind(slot.node.type) || !wrappableKind(operandOf(slot.node))) {
    return undefined;
  }
  const position = outermostWrapper(slot);
  const check = EXPRESSION_SLOTS.get(roleOf(position.parent, position.field));
  return check?.(position) === true ? PLACEMENT.expression : undefined;
}

function isAmbient(node: SyntaxNode): boolean {
  return (
    node.declare === true ||
    (node.type === MODULE_DECLARATION && node.global === true)
  );
}

/** The value a chain of TypeScript wrappers holds, as its node kind. */
function operandOf(node: SyntaxNode): string {
  let operand = node;
  while (TS_VALUE_WRAPPERS.has(operand.type)) {
    const inner = operand[WRAPPED_OPERAND];
    if (!isSyntaxNode(inner)) break;
    operand = inner;
  }
  return operand.type;
}

/** The slot of the outermost TypeScript wrapper around the node, since the node runs in that wrapper's position. */
function outermostWrapper(slot: Slot): Slot {
  let position = slot;
  for (;;) {
    const holder = ancestorStep(position, 2);
    if (
      !TS_VALUE_WRAPPERS.has(position.parent.type) ||
      position.field !== WRAPPED_OPERAND ||
      holder === undefined
    ) {
      return position;
    }
    const path = position.path.slice(0, -1);
    const step = path[path.length - 1];
    if (step === undefined) return position;
    position = {
      node: step.node,
      field: step.field,
      parent: holder.node,
      path,
    };
  }
}

function isDirective(node: SyntaxNode): boolean {
  return typeof node.directive === "string";
}

function wrappableKind(type: string): boolean {
  if (NEVER_WRAPPED.has(type) || type.endsWith(DECLARATION_SUFFIX)) {
    return false;
  }
  return !type.startsWith(TS_PREFIX) || TS_VALUE_WRAPPERS.has(type);
}

function runsWhereItStands(node: SyntaxNode): boolean {
  if (isDirective(node)) return false;
  if (!EXPORTS.has(node.type)) return runsInPlace(node);
  if (node.exportKind === TYPE_EXPORT) return false;
  const declared = node.declaration;
  return isSyntaxNode(declared) && runsInPlace(declared);
}

function runsInPlace(node: SyntaxNode): boolean {
  return !NOT_RUN_IN_PLACE.has(node.type) && node.declare !== true;
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

/** The step `generations` above the slot's node: 1 is its parent. */
function ancestorStep(slot: Slot, generations: number): PathStep | undefined {
  return slot.path[slot.path.length - 1 - generations];
}

function inObjectLiteral(slot: Slot): boolean {
  return ancestorStep(slot, 2)?.node.type === OBJECT_LITERAL;
}

function objectLiteralValue(slot: Slot): boolean {
  const { parent } = slot;
  return (
    inObjectLiteral(slot) &&
    parent.shorthand !== true &&
    parent.method !== true &&
    parent.kind === INIT_PROPERTY
  );
}

function objectLiteralComputedKey(slot: Slot): boolean {
  return inObjectLiteral(slot) && computedKey(slot);
}

function computedKey(slot: Slot): boolean {
  return slot.parent.computed === true;
}

function valueUnaryArgument(slot: Slot): boolean {
  const { operator } = slot.parent;
  return typeof operator === "string" && !VALUE_BLIND_UNARY.has(operator);
}

function expressionBody(slot: Slot): boolean {
  return slot.node.type !== BLOCK;
}

function notDirective(slot: Slot): boolean {
  return !isDirective(slot.parent);
}

/** Wrapping a link of an optional chain ends the chain there, so a short circuit no longer skips the rest. */
function notChainContinuation(slot: Slot): boolean {
  if (!CHAIN_CONTINUATIONS.has(slot.node.type)) return true;
  let generations = 0;
  for (;;) {
    const step = ancestorStep(slot, generations);
    const holder = ancestorStep(slot, generations + 1);
    if (step === undefined || holder === undefined) return true;
    if (holder.node.type === CHAIN) return false;
    if (!CHAIN_LINKS.has(roleOf(holder.node, step.field))) return true;
    generations += 1;
  }
}

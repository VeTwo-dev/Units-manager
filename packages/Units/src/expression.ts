/**
 * expression.ts
 * -----------------------------------------------------------------------
 * Single responsibility: a declarative, immutable expression layer for
 * unit-aware calculations.
 *
 * An expression is a frozen AST — never a JavaScript function — so it can
 * be inspected, dimension-checked, serialized, optimized, cached and
 * evaluated deterministically:
 *
 *   - Literal    — a numeric value with a unit expression string
 *   - Variable   — a named placeholder resolved from an evaluation context
 *   - Add / Subtract / Multiply / Divide — binary Quantity operations
 *   - Power      — integer exponent (delegates to Quantity.pow)
 *   - Convert    — convert sub-expression result to a target unit
 *
 * The engine orchestrates existing primitives (Quantity, Dimension algebra,
 * UnitParser, ConversionEngine). It duplicates no unit arithmetic.
 *
 * Compilation produces a validated, constant-folded, unit-pre-resolved
 * stack-machine plan (NOT generated JavaScript). Repeated evaluation of a
 * compiled expression with different contexts performs no parsing and no
 * re-validation — this is the batch-evaluation path for scientific
 * workloads.
 *
 * Security: variable names are validated; depth/node counts are bounded
 * (configurable); contexts are read with own-property checks; serialized
 * ASTs are validated structurally before use. No eval/Function/dynamic
 * import anywhere.
 * -----------------------------------------------------------------------
 */
import {
  dimensionsEqual,
  divideDim,
  isDimensionless,
  multiplyDim,
  powDim,
  type DimensionVector,
} from "./dimension.js";
import { parenthesizeComposite, parseUnit } from "./unit-parser.js";
import { DIMENSIONLESS_UNIT } from "./unit.js";
import { Quantity } from "./quantity.js";
import { defaultUnitRegistry, type UnitRegistry } from "./unit-registry.js";
import { defaultFunctionRegistry, type FunctionRegistry } from "./function-registry.js";
import type { Unit } from "./unit.js";
import { isDimension } from "./guards.js";
import { ExpressionError, ExpressionLimitError, UnknownVariableError } from "./errors/index.js";

// ---------------------------------------------------------------------------
// AST node types (all immutable, frozen at construction)
// ---------------------------------------------------------------------------

export interface LiteralNode {
  readonly kind: "literal";
  readonly value: number;
  readonly unit: string;
}

export interface VariableNode {
  readonly kind: "variable";
  readonly name: string;
}

export interface BinaryNode {
  readonly kind: "add" | "subtract" | "multiply" | "divide";
  readonly left: Expression;
  readonly right: Expression;
}

export interface PowerNode {
  readonly kind: "power";
  readonly base: Expression;
  readonly exponent: number;
}

export interface ConvertNode {
  readonly kind: "convert";
  readonly expr: Expression;
  readonly unit: string;
}

/**
 * Registered-function call (Phase 24). The AST carries only the NAME —
 * never code. Evaluation resolves the name against a FunctionRegistry
 * (host-trusted implementations); unknown names and arity violations
 * throw before any numeric work.
 */
export interface CallNode {
  readonly kind: "call";
  readonly function: string;
  readonly args: readonly Expression[];
}

export type Expression =
  LiteralNode | VariableNode | BinaryNode | PowerNode | ConvertNode | CallNode;

// ---------------------------------------------------------------------------
// Limits & options
// ---------------------------------------------------------------------------

export interface ExpressionLimits {
  /** Maximum AST depth (default 64). */
  readonly maxDepth?: number;
  /** Maximum AST node count (default 2048). */
  readonly maxNodes?: number;
  /** Maximum serialized JSON characters accepted by deserialize (default 65536). */
  readonly maxSerializedChars?: number;
  /** Maximum plan operations per evaluation (default: unbounded). */
  readonly maxEvaluationSteps?: number;
}

export interface ExpressionOptions {
  readonly registry?: UnitRegistry;
  readonly limits?: ExpressionLimits;
  /** Function registry for `call` nodes (default: seeded generic functions). */
  readonly functions?: FunctionRegistry;
}

export const DEFAULT_MAX_DEPTH = 64;
export const DEFAULT_MAX_NODES = 2048;
export const DEFAULT_MAX_SERIALIZED_CHARS = 65536;

const VARIABLE_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function resolveLimits(limits?: ExpressionLimits): {
  maxDepth: number;
  maxNodes: number;
  maxSerializedChars: number;
} {
  const maxDepth = limits?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = limits?.maxNodes ?? DEFAULT_MAX_NODES;
  const maxSerializedChars = limits?.maxSerializedChars ?? DEFAULT_MAX_SERIALIZED_CHARS;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new ExpressionLimitError(`maxDepth must be a positive integer, got ${String(maxDepth)}`);
  }
  if (!Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new ExpressionLimitError(`maxNodes must be a positive integer, got ${String(maxNodes)}`);
  }
  return { maxDepth, maxNodes, maxSerializedChars };
}

function assertValidVariableName(name: string): void {
  if (typeof name !== "string" || !VARIABLE_NAME_RE.test(name)) {
    throw new ExpressionError(
      `Invalid variable name "${String(name)}" (expected /^[A-Za-z][A-Za-z0-9_]*$/).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Builders (validate eagerly, freeze results)
// ---------------------------------------------------------------------------

function freezeNode<T extends object>(node: T): T {
  return Object.freeze(node);
}

/** A literal Quantity value with a unit expression string (e.g. 10, "kg/day"). */
export function lit(value: number, unit: string): Expression {
  if (typeof value !== "number") {
    throw new ExpressionError(`Literal value must be a number, got ${typeof value}.`);
  }
  if (typeof unit !== "string" || unit.trim().length === 0) {
    throw new ExpressionError("Literal unit must be a non-empty unit expression string.");
  }
  return freezeNode({ kind: "literal", value, unit } as LiteralNode);
}

/** A named variable resolved from the evaluation context. */
export function variable(name: string): Expression {
  assertValidVariableName(name);
  return freezeNode({ kind: "variable", name } as VariableNode);
}

function binary(kind: BinaryNode["kind"], left: Expression, right: Expression): Expression {
  assertIsExpression(left, "left operand");
  assertIsExpression(right, "right operand");
  return freezeNode({ kind, left, right } as BinaryNode);
}

/** Addition — valid only for dimensionally compatible operands (checked at eval/infer). */
export function add(left: Expression, right: Expression): Expression {
  return binary("add", left, right);
}

/** Subtraction — valid only for dimensionally compatible operands. */
export function subtract(left: Expression, right: Expression): Expression {
  return binary("subtract", left, right);
}

/** Multiplication — dimensions multiply via generic Dimension algebra. */
export function multiply(left: Expression, right: Expression): Expression {
  return binary("multiply", left, right);
}

/** Division — dimensions divide via generic Dimension algebra. */
export function divide(left: Expression, right: Expression): Expression {
  return binary("divide", left, right);
}

/** Integer power — delegates to Quantity.pow; non-integers rejected. */
export function power(base: Expression, exponent: number): Expression {
  assertIsExpression(base, "power base");
  if (!Number.isInteger(exponent)) {
    throw new ExpressionError(`Power exponent must be an integer, got ${String(exponent)}.`);
  }
  return freezeNode({ kind: "power", base, exponent } as PowerNode);
}

/** Convert sub-expression result to a target unit (same-dimension, via ConversionEngine). */
export function convertTo(expr: Expression, unit: string): Expression {
  assertIsExpression(expr, "convert operand");
  if (typeof unit !== "string" || unit.trim().length === 0) {
    throw new ExpressionError("Convert target must be a non-empty unit expression string.");
  }
  return freezeNode({ kind: "convert", expr, unit } as ConvertNode);
}

const FUNCTION_NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Call a registered function by name (e.g. `call("sqrt", [x])`). The name is
 * validated syntactically here; existence/arity are checked at
 * evaluation/inference time against the active FunctionRegistry.
 */
export function call(functionName: string, args: readonly Expression[]): Expression {
  if (typeof functionName !== "string" || !FUNCTION_NAME_RE.test(functionName)) {
    throw new ExpressionError(
      `Invalid function name "${String(functionName)}" (expected /^[a-z][a-z0-9_]*$/).`,
    );
  }
  if (!Array.isArray(args)) {
    throw new ExpressionError("Call arguments must be an array of expressions.");
  }
  for (const arg of args) assertIsExpression(arg, `argument of "${functionName}"`);
  return freezeNode({
    kind: "call",
    function: functionName,
    args: Object.freeze([...args]),
  } as CallNode);
}

// ---------------------------------------------------------------------------
// Ergonomic namespace (builders grouped; standalone functions also exported)
// ---------------------------------------------------------------------------

/**
 * Ergonomic builder namespace. `Expression.literal(…)` etc. are the same
 * frozen-node builders also exported standalone; the namespace avoids
 * generic top-level names like `add` in the package surface.
 */
export const Expression = {
  literal: lit,
  variable,
  add,
  subtract,
  multiply,
  divide,
  power,
  convert: convertTo,
  call,
} as const;

// ---------------------------------------------------------------------------
// Structural validation (iterative — safe for hostile input)
// ---------------------------------------------------------------------------

const KNOWN_KINDS = new Set([
  "literal",
  "variable",
  "add",
  "subtract",
  "multiply",
  "divide",
  "power",
  "convert",
  "call",
]);

function hasPollutionKey(obj: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
    Object.prototype.hasOwnProperty.call(obj, "constructor") ||
    Object.prototype.hasOwnProperty.call(obj, "prototype")
  );
}

function assertIsExpression(value: unknown, what = "expression"): asserts value is Expression {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ExpressionError(`Invalid ${what}: expected an expression node object.`);
  }
  const node = value as Record<string, unknown>;
  if (hasPollutionKey(node)) {
    throw new ExpressionError(`Invalid ${what}: forbidden prototype keys.`);
  }
  if (typeof node.kind !== "string" || !KNOWN_KINDS.has(node.kind)) {
    throw new ExpressionError(`Invalid ${what}: unknown node kind "${String(node.kind)}".`);
  }
}

/**
 * Validate structure, depth and node count iteratively.
 * Returns node count. Throws ExpressionError / ExpressionLimitError.
 */
function validateStructure(root: Expression, limits?: ExpressionLimits): number {
  const { maxDepth, maxNodes } = resolveLimits(limits);
  assertIsExpression(root, "root expression");
  let count = 0;
  // Stack of [node, depth]
  const stack: Array<{ node: Expression; depth: number }> = [{ node: root, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > maxDepth) {
      throw new ExpressionLimitError(
        `Expression exceeds maxDepth ${maxDepth} (node "${node.kind}" at depth ${depth}).`,
      );
    }
    count++;
    if (count > maxNodes) {
      throw new ExpressionLimitError(`Expression exceeds maxNodes ${maxNodes}.`);
    }
    assertIsExpression(node, "expression node");
    switch (node.kind) {
      case "literal":
        if (typeof node.value !== "number") {
          throw new ExpressionError("Literal node value must be a number.");
        }
        if (typeof node.unit !== "string" || node.unit.trim().length === 0) {
          throw new ExpressionError("Literal node unit must be a non-empty string.");
        }
        break;
      case "variable":
        assertValidVariableName(node.name);
        break;
      case "add":
      case "subtract":
      case "multiply":
      case "divide":
        stack.push({ node: node.left, depth: depth + 1 });
        stack.push({ node: node.right, depth: depth + 1 });
        break;
      case "power":
        if (!Number.isInteger(node.exponent)) {
          throw new ExpressionError(
            `Power exponent must be an integer, got ${String(node.exponent)}.`,
          );
        }
        stack.push({ node: node.base, depth: depth + 1 });
        break;
      case "convert":
        if (typeof node.unit !== "string" || node.unit.trim().length === 0) {
          throw new ExpressionError("Convert node unit must be a non-empty string.");
        }
        stack.push({ node: node.expr, depth: depth + 1 });
        break;
      case "call":
        if (typeof node.function !== "string" || !FUNCTION_NAME_RE.test(node.function)) {
          throw new ExpressionError("Call node function must be a valid function name.");
        }
        if (!Array.isArray(node.args)) {
          throw new ExpressionError("Call node args must be an array.");
        }
        for (const arg of node.args) stack.push({ node: arg, depth: depth + 1 });
        break;
      default:
        throw new ExpressionError(
          `Unknown expression node kind "${(node as { kind: string }).kind}".`,
        );
    }
  }
  return count;
}

/**
 * Measure AST depth iteratively (for diagnostics / tests).
 * Bounded by a visit cap so cyclic hand-built objects terminate with
 * ExpressionLimitError instead of hanging.
 */
export function expressionDepth(root: Expression, limits?: ExpressionLimits): number {
  const { maxNodes } = resolveLimits(limits);
  assertIsExpression(root, "root expression");
  let max = 0;
  let visits = 0;
  const stack: Array<{ node: Expression; depth: number }> = [{ node: root, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    // Re-validate each node: callers may pass hand-built (hostile) objects.
    assertIsExpression(node, "expression node");
    if (depth > max) max = depth;
    if (++visits > maxNodes) {
      throw new ExpressionLimitError(
        `Depth measurement exceeded maxNodes ${maxNodes} (possible cycle).`,
      );
    }
    switch (node.kind) {
      case "add":
      case "subtract":
      case "multiply":
      case "divide":
        stack.push({ node: node.left, depth: depth + 1 });
        stack.push({ node: node.right, depth: depth + 1 });
        break;
      case "power":
        stack.push({ node: node.base, depth: depth + 1 });
        break;
      case "convert":
        stack.push({ node: node.expr, depth: depth + 1 });
        break;
      case "call":
        if (Array.isArray(node.args)) {
          for (const arg of node.args) stack.push({ node: arg, depth: depth + 1 });
        }
        break;
      default:
        break;
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// Evaluation context
// ---------------------------------------------------------------------------

export interface ExpressionContext {
  readonly [name: string]: Quantity;
}

function lookupVariable(context: ExpressionContext, name: string): Quantity {
  if (context === null || typeof context !== "object") {
    throw new ExpressionError("Evaluation context must be an object mapping names to Quantities.");
  }
  if (!Object.prototype.hasOwnProperty.call(context, name)) {
    throw new UnknownVariableError(name);
  }
  const value = (context as Record<string, unknown>)[name];
  if (!(value instanceof Quantity)) {
    throw new ExpressionError(
      `Variable "${name}" must be bound to a Quantity, got ${typeof value}.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Evaluation (recursive; depth pre-validated so stack use is bounded)
// ---------------------------------------------------------------------------

export function evaluateExpression(
  expr: Expression,
  context: ExpressionContext = {},
  opts: ExpressionOptions = {},
): Quantity {
  validateStructure(expr, opts.limits);
  const registry = opts.registry ?? defaultUnitRegistry;
  const functions = opts.functions ?? defaultFunctionRegistry;
  return evalNode(expr, context, registry, functions);
}

function evalNode(
  expr: Expression,
  context: ExpressionContext,
  registry: UnitRegistry,
  functions: FunctionRegistry,
): Quantity {
  switch (expr.kind) {
    case "literal":
      return Quantity.of(expr.value, resolveLiteralUnit(expr.unit, registry));
    case "variable":
      return lookupVariable(context, expr.name);
    case "add":
      return evalNode(expr.left, context, registry, functions).add(
        evalNode(expr.right, context, registry, functions),
      );
    case "subtract":
      return evalNode(expr.left, context, registry, functions).subtract(
        evalNode(expr.right, context, registry, functions),
      );
    case "multiply": {
      const left = evalNode(expr.left, context, registry, functions);
      const right = evalNode(expr.right, context, registry, functions);
      return left.multiply(right);
    }
    case "divide": {
      const left = evalNode(expr.left, context, registry, functions);
      const right = evalNode(expr.right, context, registry, functions);
      return left.divide(right);
    }
    case "power":
      return evalNode(expr.base, context, registry, functions).pow(expr.exponent);
    case "convert":
      return evalNode(expr.expr, context, registry, functions).to(expr.unit, registry);
    case "call":
      return functions.call(
        expr.function,
        expr.args.map((arg) => evalNode(arg, context, registry, functions)),
      );
    default:
      throw new ExpressionError(
        `Unknown expression node kind "${(expr as { kind: string }).kind}".`,
      );
  }
}

// ---------------------------------------------------------------------------
// Static dimension inference (no numeric evaluation)
// ---------------------------------------------------------------------------

export type VariableDimensions = Record<string, DimensionVector | string>;

function resolveVarDimension(
  name: string,
  varDimensions: VariableDimensions,
  registry: UnitRegistry,
): DimensionVector {
  if (!Object.prototype.hasOwnProperty.call(varDimensions, name)) {
    throw new UnknownVariableError(name);
  }
  const declared = (varDimensions as Record<string, unknown>)[name];
  if (typeof declared === "string") {
    if (declared.trim() === "1") return {};
    return parseUnit(declared, registry).dimension;
  }
  if (declared !== null && typeof declared === "object" && !Array.isArray(declared)) {
    if (!isDimension(declared)) {
      throw new ExpressionError(
        `Declared dimension for variable "${name}" is not a valid DimensionVector.`,
      );
    }
    return declared;
  }
  throw new ExpressionError(
    `Declared dimension for variable "${name}" must be a DimensionVector or unit string.`,
  );
}

/**
 * Infer the resulting DimensionVector of an expression given known
 * variable dimensions — without evaluating any numeric values.
 * Throws on dimensional mismatches (e.g. mass + length) before execution.
 */
export function inferExpressionDimension(
  expr: Expression,
  varDimensions: VariableDimensions = {},
  opts: ExpressionOptions = {},
): DimensionVector {
  validateStructure(expr, opts.limits);
  const registry = opts.registry ?? defaultUnitRegistry;
  const functions = opts.functions ?? defaultFunctionRegistry;
  return inferNode(expr, varDimensions, registry, functions);
}

function inferNode(
  expr: Expression,
  varDimensions: VariableDimensions,
  registry: UnitRegistry,
  functions: FunctionRegistry,
): DimensionVector {
  switch (expr.kind) {
    case "literal":
      return resolveLiteralUnit(expr.unit, registry).dimension;
    case "variable":
      return resolveVarDimension(expr.name, varDimensions, registry);
    case "add":
    case "subtract": {
      const left = inferNode(expr.left, varDimensions, registry, functions);
      const right = inferNode(expr.right, varDimensions, registry, functions);
      if (!dimensionsEqual(left, right)) {
        throw new ExpressionError(
          `Dimension mismatch in "${expr.kind}": left and right dimensions differ.`,
        );
      }
      return left;
    }
    case "multiply":
      return multiplyDim(
        inferNode(expr.left, varDimensions, registry, functions),
        inferNode(expr.right, varDimensions, registry, functions),
      );
    case "divide":
      return divideDim(
        inferNode(expr.left, varDimensions, registry, functions),
        inferNode(expr.right, varDimensions, registry, functions),
      );
    case "power": {
      // Quantity.pow rejects non-integers; inference mirrors powDim (integer only).
      return powDim(inferNode(expr.base, varDimensions, registry, functions), expr.exponent);
    }
    case "convert": {
      const inner = inferNode(expr.expr, varDimensions, registry, functions);
      const target = parseUnit(expr.unit, registry).dimension;
      if (!dimensionsEqual(inner, target)) {
        throw new ExpressionError(
          `Dimension mismatch in "convert": expression dimension differs from target unit "${expr.unit}".`,
        );
      }
      return target;
    }
    case "call":
      return functions.infer(
        expr.function,
        expr.args.map((arg) => inferNode(arg, varDimensions, registry, functions)),
      );
    default:
      throw new ExpressionError(
        `Unknown expression node kind "${(expr as { kind: string }).kind}".`,
      );
  }
}

// ---------------------------------------------------------------------------
// Simplification: constant folding + safe identities + unit normalization
// ---------------------------------------------------------------------------

/**
 * Resolve a literal's unit string, treating the canonical "1" as the
 * shared DIMENSIONLESS_UNIT without requiring registry registration.
 */
function resolveLiteralUnit(unit: string, registry: UnitRegistry): Unit {
  if (unit.trim() === "1") {
    return DIMENSIONLESS_UNIT;
  }
  return parseUnit(unit, registry);
}

function isDimensionlessLiteral(expr: Expression, value: number, registry: UnitRegistry): boolean {
  if (expr.kind !== "literal" || expr.value !== value) return false;
  if (expr.unit.trim() === "1") return true;
  try {
    return isDimensionless(parseUnit(expr.unit, registry).dimension);
  } catch {
    return false;
  }
}

/**
 * Simplify an expression: fold constant-only subtrees (using Quantity
 * machinery, preserving units), apply safe identities (x·1→x, x/1→x,
 * x^1→x, x^0→1), and normalize compatible literal units via folding
 * (e.g. 1000 m + 1 km → 2000 m, since add preserves the left unit).
 * Never performs unsafe x/x→1. Returns a new frozen expression.
 */
export function simplifyExpression(expr: Expression, opts: ExpressionOptions = {}): Expression {
  validateStructure(expr, opts.limits);
  const registry = opts.registry ?? defaultUnitRegistry;
  const functions = opts.functions ?? defaultFunctionRegistry;
  return simplifyNode(expr, registry, functions, opts.limits);
}

function literalFromQuantity(q: Quantity): Expression {
  // Composite symbols would re-parse with different precedence, so reuse
  // the parser's own parenthesization rule (idempotent: already-grouped
  // symbols like "(m/s)^2" pass through untouched).
  const unit = parenthesizeComposite(q.unit.symbol);
  return lit(q.value, unit + (q.unit.basis ? ` ${q.unit.basis}` : ""));
}

function isLiteralOnly(expr: Expression): boolean {
  switch (expr.kind) {
    case "literal":
      return true;
    case "variable":
      return false;
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
      return isLiteralOnly(expr.left) && isLiteralOnly(expr.right);
    case "power":
      return isLiteralOnly(expr.base);
    case "convert":
      return isLiteralOnly(expr.expr);
    case "call":
      return expr.args.every(isLiteralOnly);
    default:
      return false;
  }
}

function foldLiterals(
  expr: Expression,
  registry: UnitRegistry,
  functions: FunctionRegistry,
): Expression | undefined {
  // Attempt full evaluation with empty context; undefined if it has variables or fails.
  if (!isLiteralOnly(expr)) return undefined;
  try {
    const q = evalNode(expr, {}, registry, functions);
    return literalFromQuantity(q);
  } catch {
    return undefined;
  }
}

function simplifyNode(
  expr: Expression,
  registry: UnitRegistry,
  functions: FunctionRegistry,
  limits?: ExpressionLimits,
): Expression {
  switch (expr.kind) {
    case "literal":
    case "variable":
      return expr;
    case "add":
    case "subtract": {
      const left = simplifyNode(expr.left, registry, functions, limits);
      const right = simplifyNode(expr.right, registry, functions, limits);
      const folded = foldLiterals(
        { kind: expr.kind, left, right } as BinaryNode,
        registry,
        functions,
      );
      if (folded) return folded;
      return expr.kind === "add" ? add(left, right) : subtract(left, right);
    }
    case "multiply": {
      const left = simplifyNode(expr.left, registry, functions, limits);
      const right = simplifyNode(expr.right, registry, functions, limits);
      if (isDimensionlessLiteral(right, 1, registry)) return left;
      if (isDimensionlessLiteral(left, 1, registry)) return right;
      const folded = foldLiterals(
        { kind: "multiply", left, right } as BinaryNode,
        registry,
        functions,
      );
      if (folded) return folded;
      return multiply(left, right);
    }
    case "divide": {
      const left = simplifyNode(expr.left, registry, functions, limits);
      const right = simplifyNode(expr.right, registry, functions, limits);
      if (isDimensionlessLiteral(right, 1, registry)) return left;
      const folded = foldLiterals(
        { kind: "divide", left, right } as BinaryNode,
        registry,
        functions,
      );
      if (folded) return folded;
      return divide(left, right);
    }
    case "power": {
      const base = simplifyNode(expr.base, registry, functions, limits);
      if (expr.exponent === 1) return base;
      if (expr.exponent === 0) return lit(1, "1");
      if (base.kind === "literal") {
        const folded = foldLiterals(
          { kind: "power", base, exponent: expr.exponent } as PowerNode,
          registry,
          functions,
        );
        if (folded) return folded;
      }
      return power(base, expr.exponent);
    }
    case "convert": {
      const inner = simplifyNode(expr.expr, registry, functions, limits);
      if (inner.kind === "literal") {
        const folded = foldLiterals(
          { kind: "convert", expr: inner, unit: expr.unit } as ConvertNode,
          registry,
          functions,
        );
        if (folded) return folded;
      }
      return convertTo(inner, expr.unit);
    }
    case "call": {
      const args = expr.args.map((arg) => simplifyNode(arg, registry, functions, limits));
      const folded = foldLiterals(
        { kind: "call", function: expr.function, args } as CallNode,
        registry,
        functions,
      );
      if (folded) return folded;
      return call(expr.function, args);
    }
    default:
      throw new ExpressionError(
        `Unknown expression node kind "${(expr as { kind: string }).kind}".`,
      );
  }
}

// ---------------------------------------------------------------------------
// Compilation: validated plan with pre-resolved units (no code generation)
// ---------------------------------------------------------------------------

type PlanOp =
  | { readonly op: "lit"; readonly value: number; readonly unit: Unit }
  | { readonly op: "var"; readonly name: string }
  | { readonly op: "add" }
  | { readonly op: "sub" }
  | { readonly op: "mul" }
  | { readonly op: "div" }
  | { readonly op: "pow"; readonly exponent: number }
  | { readonly op: "convert"; readonly unit: Unit }
  | { readonly op: "call"; readonly function: string; readonly argCount: number };

export interface CompiledExpression {
  /** The simplified, frozen expression this plan was built from. */
  readonly expression: Expression;
  /** Canonical cache key (stable serialization of the simplified AST). */
  readonly key: string;
  /** Evaluate with a variable context (no parsing, no re-validation of structure). */
  evaluate(context?: ExpressionContext): Quantity;
  /** Infer result dimension given variable dimensions. */
  inferDimension(varDimensions?: VariableDimensions): DimensionVector;
  /** Number of plan operations. */
  readonly size: number;
}

const MAX_COMPILED_CACHE = 100;
// Scoped per (unit registry, function registry): both affect plan semantics.
const compiledCaches = new WeakMap<
  UnitRegistry,
  WeakMap<FunctionRegistry, Map<string, CompiledExpression>>
>();

function compiledCacheFor(
  registry: UnitRegistry,
  functions: FunctionRegistry,
): Map<string, CompiledExpression> {
  let inner = compiledCaches.get(registry);
  if (!inner) {
    inner = new WeakMap();
    compiledCaches.set(registry, inner);
  }
  let m = inner.get(functions);
  if (!m) {
    m = new Map<string, CompiledExpression>();
    inner.set(functions, m);
  }
  return m;
}

function buildPlan(expr: Expression, registry: UnitRegistry): readonly PlanOp[] {
  // Iterative post-order traversal to avoid recursion on hostile depth
  // (depth pre-validated, but iterative keeps stack use constant).
  type Frame = { node: Expression; visited: boolean };
  const stack: Frame[] = [{ node: expr, visited: false }];
  const out: PlanOp[] = [];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const { node } = frame;
    switch (node.kind) {
      case "literal":
        out.push({ op: "lit", value: node.value, unit: resolveLiteralUnit(node.unit, registry) });
        break;
      case "variable":
        out.push({ op: "var", name: node.name });
        break;
      case "add":
        if (!frame.visited) {
          stack.push({ node, visited: true });
          stack.push({ node: node.right, visited: false });
          stack.push({ node: node.left, visited: false });
        } else {
          out.push({ op: "add" });
        }
        break;
      case "subtract":
        if (!frame.visited) {
          stack.push({ node, visited: true });
          stack.push({ node: node.right, visited: false });
          stack.push({ node: node.left, visited: false });
        } else {
          out.push({ op: "sub" });
        }
        break;
      case "multiply":
        if (!frame.visited) {
          stack.push({ node, visited: true });
          stack.push({ node: node.right, visited: false });
          stack.push({ node: node.left, visited: false });
        } else {
          out.push({ op: "mul" });
        }
        break;
      case "divide":
        if (!frame.visited) {
          stack.push({ node, visited: true });
          stack.push({ node: node.right, visited: false });
          stack.push({ node: node.left, visited: false });
        } else {
          out.push({ op: "div" });
        }
        break;
      case "power":
        if (!frame.visited) {
          stack.push({
            node: { kind: "power", base: node.base, exponent: node.exponent },
            visited: true,
          });
          stack.push({ node: node.base, visited: false });
        } else {
          out.push({ op: "pow", exponent: node.exponent });
        }
        break;
      case "convert":
        if (!frame.visited) {
          stack.push({
            node: { kind: "convert", expr: node.expr, unit: node.unit },
            visited: true,
          });
          stack.push({ node: node.expr, visited: false });
        } else {
          out.push({ op: "convert", unit: parseUnit(node.unit, registry) });
        }
        break;
      case "call":
        if (!frame.visited) {
          stack.push({ node, visited: true });
          for (let i = node.args.length - 1; i >= 0; i--) {
            stack.push({ node: node.args[i]!, visited: false });
          }
        } else {
          out.push({ op: "call", function: node.function, argCount: node.args.length });
        }
        break;
      default:
        throw new ExpressionError(
          `Unknown expression node kind "${(node as { kind: string }).kind}".`,
        );
    }
  }
  return Object.freeze(out);
}

function runPlan(
  plan: readonly PlanOp[],
  context: ExpressionContext,
  functions: FunctionRegistry,
  maxSteps?: number,
): Quantity {
  const stack: Quantity[] = [];
  let steps = 0;
  for (const op of plan) {
    if (maxSteps !== undefined && ++steps > maxSteps) {
      throw new ExpressionLimitError(`Evaluation exceeds maxEvaluationSteps ${maxSteps}.`);
    }
    switch (op.op) {
      case "lit":
        stack.push(Quantity.of(op.value, op.unit));
        break;
      case "var":
        stack.push(lookupVariable(context, op.name));
        break;
      case "add": {
        const right = stack.pop();
        const left = stack.pop();
        if (!left || !right) throw new ExpressionError("Malformed execution plan (add).");
        stack.push(left.add(right));
        break;
      }
      case "sub": {
        const right = stack.pop();
        const left = stack.pop();
        if (!left || !right) throw new ExpressionError("Malformed execution plan (subtract).");
        stack.push(left.subtract(right));
        break;
      }
      case "mul": {
        const right = stack.pop();
        const left = stack.pop();
        if (!left || !right) throw new ExpressionError("Malformed execution plan (multiply).");
        stack.push(left.multiply(right));
        break;
      }
      case "div": {
        const right = stack.pop();
        const left = stack.pop();
        if (!left || !right) throw new ExpressionError("Malformed execution plan (divide).");
        stack.push(left.divide(right));
        break;
      }
      case "pow": {
        const base = stack.pop();
        if (!base) throw new ExpressionError("Malformed execution plan (power).");
        stack.push(base.pow(op.exponent));
        break;
      }
      case "convert": {
        const value = stack.pop();
        if (!value) throw new ExpressionError("Malformed execution plan (convert).");
        stack.push(value.to(op.unit));
        break;
      }
      case "call": {
        const args: Quantity[] = [];
        for (let i = 0; i < op.argCount; i++) {
          const value = stack.pop();
          if (!value) throw new ExpressionError("Malformed execution plan (call).");
          args.unshift(value);
        }
        stack.push(functions.call(op.function, args));
        break;
      }
      default:
        throw new ExpressionError("Malformed execution plan (unknown op).");
    }
  }
  if (stack.length !== 1) {
    throw new ExpressionError("Malformed execution plan (stack imbalance).");
  }
  return stack[0]!;
}

/**
 * Compile an expression into an efficient immutable evaluator.
 * Validates, constant-folds, pre-resolves all unit strings and caches the
 * plan per registry (bounded). The result contains no generated code.
 */
export function compileExpression(
  expr: Expression,
  opts: ExpressionOptions = {},
): CompiledExpression {
  validateStructure(expr, opts.limits);
  const registry = opts.registry ?? defaultUnitRegistry;
  const functions = opts.functions ?? defaultFunctionRegistry;
  const simplified = simplifyExpression(expr, { registry, functions, limits: opts.limits });
  const key = canonicalExpressionKey(simplified);
  // Scope the cache entry to both registry generations: later
  // register/unregister calls may change unit or function resolution, so
  // pre-mutation plans must not be hit. The public `.key` stays the pure
  // canonical expression identity.
  const cacheKey = `${registry.version}::${functions.version}::${key}`;
  const cache = compiledCacheFor(registry, functions);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const plan = buildPlan(simplified, registry);
  const maxSteps = opts.limits?.maxEvaluationSteps;
  const compiled: CompiledExpression = Object.freeze({
    expression: simplified,
    key,
    size: plan.length,
    evaluate: (context: ExpressionContext = {}) => runPlan(plan, context, functions, maxSteps),
    inferDimension: (varDimensions: VariableDimensions = {}) =>
      inferExpressionDimension(simplified, varDimensions, {
        registry,
        functions,
        limits: opts.limits,
      }),
  });
  if (cache.size >= MAX_COMPILED_CACHE) {
    const first = cache.keys().next().value as string | undefined;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(cacheKey, compiled);
  return compiled;
}

/**
 * Canonical, deterministic key for an expression (stable field order).
 * Validates first so malformed/hostile input yields a typed error rather
 * than a stack overflow.
 */
export function canonicalExpressionKey(expr: Expression, limits?: ExpressionLimits): string {
  validateStructure(expr, limits);
  return JSON.stringify(serializeExpressionRoot(expr));
}

// ---------------------------------------------------------------------------
// Serialization (versioned, declarative, validated)
// ---------------------------------------------------------------------------

export interface SerializedExpression {
  readonly version: 1;
  readonly type: "expression";
  readonly root: unknown;
}

function serializeExpressionRoot(expr: Expression): unknown {
  switch (expr.kind) {
    case "literal":
      return { kind: "literal", value: expr.value, unit: expr.unit };
    case "variable":
      return { kind: "variable", name: expr.name };
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
      return {
        kind: expr.kind,
        left: serializeExpressionRoot(expr.left),
        right: serializeExpressionRoot(expr.right),
      };
    case "power":
      return { kind: "power", base: serializeExpressionRoot(expr.base), exponent: expr.exponent };
    case "convert":
      return { kind: "convert", expr: serializeExpressionRoot(expr.expr), unit: expr.unit };
    case "call":
      return {
        kind: "call",
        function: expr.function,
        args: expr.args.map(serializeExpressionRoot),
      };
    default:
      throw new ExpressionError(
        `Unknown expression node kind "${(expr as { kind: string }).kind}".`,
      );
  }
}

/** Serialize an expression to a versioned declarative form (deterministic key order). */
export function serializeExpression(expr: Expression): SerializedExpression {
  validateStructure(expr, undefined);
  return Object.freeze({
    version: 1 as const,
    type: "expression" as const,
    root: serializeExpressionRoot(expr),
  });
}

function rebuildNode(
  data: unknown,
  depth: number,
  limits: { maxDepth: number; maxNodes: number },
  counter: { count: number },
): Expression {
  if (depth > limits.maxDepth) {
    throw new ExpressionLimitError(`Serialized expression exceeds maxDepth ${limits.maxDepth}.`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ExpressionError("Malformed serialized expression: node must be an object.");
  }
  const node = data as Record<string, unknown>;
  if (hasPollutionKey(node)) {
    throw new ExpressionError("Malformed serialized expression: forbidden prototype keys.");
  }
  counter.count++;
  if (counter.count > limits.maxNodes) {
    throw new ExpressionLimitError(`Serialized expression exceeds maxNodes ${limits.maxNodes}.`);
  }
  const kind = node.kind;
  switch (kind) {
    case "literal": {
      if (typeof node.value !== "number") {
        throw new ExpressionError("Malformed serialized literal: value must be a number.");
      }
      if (typeof node.unit !== "string" || (node.unit as string).trim().length === 0) {
        throw new ExpressionError("Malformed serialized literal: unit must be a non-empty string.");
      }
      return lit(node.value, node.unit);
    }
    case "variable": {
      if (typeof node.name !== "string") {
        throw new ExpressionError("Malformed serialized variable: name must be a string.");
      }
      return variable(node.name);
    }
    case "add":
    case "subtract":
    case "multiply":
    case "divide": {
      const left = rebuildNode(node.left, depth + 1, limits, counter);
      const right = rebuildNode(node.right, depth + 1, limits, counter);
      return kind === "add"
        ? add(left, right)
        : kind === "subtract"
          ? subtract(left, right)
          : kind === "multiply"
            ? multiply(left, right)
            : divide(left, right);
    }
    case "power": {
      if (typeof node.exponent !== "number" || !Number.isInteger(node.exponent)) {
        throw new ExpressionError("Malformed serialized power: exponent must be an integer.");
      }
      return power(rebuildNode(node.base, depth + 1, limits, counter), node.exponent);
    }
    case "convert": {
      if (typeof node.unit !== "string" || (node.unit as string).trim().length === 0) {
        throw new ExpressionError("Malformed serialized convert: unit must be a non-empty string.");
      }
      return convertTo(rebuildNode(node.expr, depth + 1, limits, counter), node.unit);
    }
    case "call": {
      if (typeof node.function !== "string" || !FUNCTION_NAME_RE.test(node.function)) {
        throw new ExpressionError("Malformed serialized call: function must be a valid name.");
      }
      if (!Array.isArray(node.args)) {
        throw new ExpressionError("Malformed serialized call: args must be an array.");
      }
      const args = (node.args as unknown[]).map((arg) =>
        rebuildNode(arg, depth + 1, limits, counter),
      );
      return call(node.function, args);
    }
    default:
      throw new ExpressionError(`Malformed serialized expression: unknown kind "${String(kind)}".`);
  }
}

/**
 * Deserialize an expression from its versioned declarative form.
 * Validates shape, version, depth and node counts. Never executes code.
 */
export function deserializeExpression(data: unknown, limits?: ExpressionLimits): Expression {
  const resolved = resolveLimits(limits);
  if (typeof data === "string") {
    if (data.length > resolved.maxSerializedChars) {
      throw new ExpressionLimitError(
        `Serialized expression exceeds maxSerializedChars ${resolved.maxSerializedChars}.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new ExpressionError("Malformed serialized expression: invalid JSON.");
    }
    return deserializeExpression(parsed, limits);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ExpressionError("Malformed serialized expression: expected an object.");
  }
  const obj = data as Record<string, unknown>;
  if (hasPollutionKey(obj)) {
    throw new ExpressionError("Malformed serialized expression: forbidden prototype keys.");
  }
  if (obj.version !== 1) {
    if (obj.version === undefined)
      throw new ExpressionError("Serialized expression missing version.");
    throw new ExpressionError(`Unsupported serialized expression version ${String(obj.version)}.`);
  }
  if (obj.type !== "expression") {
    throw new ExpressionError(`Serialized expression has wrong type "${String(obj.type)}".`);
  }
  return rebuildNode(obj.root, 1, resolved, { count: 0 });
}

// ---------------------------------------------------------------------------
// Formula registry (generic named declarative formulas — NOT domain rules)
// ---------------------------------------------------------------------------

export interface FormulaDefinition {
  readonly name: string;
  readonly variables: readonly string[];
  readonly expression: Expression;
  /**
   * Registry the formula was defined against. `run`/`inferDimension` fall
   * back to it when no explicit registry is passed, so custom-registry
   * formulas work end-to-end without repeating options.
   */
  readonly registry: UnitRegistry;
}

const FORMULA_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_FORMULAS = 500;

export class FormulaRegistry {
  private readonly formulas = new Map<string, FormulaDefinition>();

  /**
   * Define a reusable named formula: a variable list plus a declarative
   * expression. Validates names, duplicates, structure and limits.
   * Generic only — no domain semantics (contrast CalculationRuleRegistry,
   * which holds domain functions).
   */
  define(
    name: string,
    variables: readonly string[],
    expression: Expression,
    opts: ExpressionOptions = {},
  ): FormulaDefinition {
    if (typeof name !== "string" || !FORMULA_NAME_RE.test(name)) {
      throw new ExpressionError(`Invalid formula name "${String(name)}".`);
    }
    if (!Array.isArray(variables)) {
      throw new ExpressionError(`Formula "${name}" variables must be an array.`);
    }
    const seen = new Set<string>();
    for (const v of variables) {
      assertValidVariableName(v as string);
      if (seen.has(v as string)) {
        throw new ExpressionError(`Formula "${name}" has duplicate variable "${v}".`);
      }
      seen.add(v as string);
    }
    if (this.formulas.has(name)) {
      throw new ExpressionError(`Formula "${name}" is already defined.`);
    }
    validateStructure(expression, opts.limits);
    // Collect free variables and require them to be declared
    const free = collectVariables(expression);
    for (const v of free) {
      if (!seen.has(v)) {
        throw new ExpressionError(`Formula "${name}" uses undeclared variable "${v}".`);
      }
    }
    const registry = opts.registry ?? defaultUnitRegistry;
    // Resolve every literal/convert unit now: typos surface at define time
    // (with the registry's own errors) rather than at first evaluation.
    assertUnitsResolvable(expression, registry);
    if (this.formulas.size >= MAX_FORMULAS) {
      const first = this.formulas.keys().next().value as string | undefined;
      if (first !== undefined) this.formulas.delete(first);
    }
    const def: FormulaDefinition = Object.freeze({
      name,
      variables: Object.freeze([...variables]),
      expression,
      registry,
    });
    this.formulas.set(name, def);
    return def;
  }

  has(name: string): boolean {
    return this.formulas.has(name);
  }

  get(name: string): FormulaDefinition {
    const def = this.formulas.get(name);
    if (!def) throw new ExpressionError(`Unknown formula "${name}".`);
    return def;
  }

  list(): readonly string[] {
    return [...this.formulas.keys()];
  }

  /** Evaluate a named formula with a context providing all declared variables. */
  run(name: string, context: ExpressionContext, opts: ExpressionOptions = {}): Quantity {
    const def = this.get(name);
    for (const v of def.variables) {
      if (!Object.prototype.hasOwnProperty.call(context, v)) {
        throw new UnknownVariableError(v);
      }
    }
    return evaluateExpression(def.expression, context, {
      ...opts,
      registry: opts.registry ?? def.registry,
    });
  }

  /** Infer a named formula's result dimension from variable dimensions. */
  inferDimension(
    name: string,
    varDimensions: VariableDimensions,
    opts: ExpressionOptions = {},
  ): DimensionVector {
    const def = this.get(name);
    return inferExpressionDimension(def.expression, varDimensions, {
      ...opts,
      registry: opts.registry ?? def.registry,
    });
  }
}

export const defaultFormulaRegistry = new FormulaRegistry();

/**
 * Resolve every literal/convert unit string against the registry.
 * Called at define/compile time so unit typos surface early with the
 * registry's own typed errors (UnsupportedUnitError / InvalidUnitExpressionError).
 * Structure is assumed validated (bounded depth/nodes).
 */
function assertUnitsResolvable(expr: Expression, registry: UnitRegistry): void {
  const stack: Expression[] = [expr];
  while (stack.length > 0) {
    const node = stack.pop()!;
    switch (node.kind) {
      case "literal":
        resolveLiteralUnit(node.unit, registry);
        break;
      case "convert":
        resolveLiteralUnit(node.unit, registry);
        stack.push(node.expr);
        break;
      case "add":
      case "subtract":
      case "multiply":
      case "divide":
        stack.push(node.left, node.right);
        break;
      case "power":
        stack.push(node.base);
        break;
      case "call":
        for (const arg of node.args) stack.push(arg);
        break;
      case "variable":
        break;
      default:
        throw new ExpressionError(
          `Unknown expression node kind "${(node as { kind: string }).kind}".`,
        );
    }
  }
}

/** Collect free variable names (iterative, deterministic insertion order). */
export function collectVariables(expr: Expression): Set<string> {
  const out = new Set<string>();
  const stack: Expression[] = [expr];
  while (stack.length > 0) {
    const node = stack.pop()!;
    switch (node.kind) {
      case "variable":
        out.add(node.name);
        break;
      case "add":
      case "subtract":
      case "multiply":
      case "divide":
        stack.push(node.left, node.right);
        break;
      case "power":
        stack.push(node.base);
        break;
      case "convert":
        stack.push(node.expr);
        break;
      case "call":
        for (const arg of node.args) stack.push(arg);
        break;
      default:
        break;
    }
  }
  return out;
}

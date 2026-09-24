/**
 * formula.ts
 * -----------------------------------------------------------------------
 * Single responsibility: the FORMULA layer (Phase 24) — typed, validated,
 * compiled scientific formulas built on the existing Expression engine.
 *
 * Pipeline (one coherent architecture, no second engine):
 *
 *   defineFormula  →  parse/validate (structure, units, dimensions, kinds)
 *                  →  constant substitution + simplification (partial eval)
 *   compileFormula →  compileExpression plan (cached, immutable)
 *   evaluate       →  run plan with Quantity | number | Measurement bindings
 *
 * - Inputs are TYPED: each variable declares a dimension (vector or unit
 *   string) plus an optional semantic kind. Bindings are checked against
 *   declarations BEFORE evaluation — `length + time` fails at define time,
 *   never mid-computation.
 * - Numbers bind as dimensionless; Measurements propagate uncertainty via
 *   Measurement methods (call nodes reject Measurements explicitly).
 * - `outputUnit` converts (validated); `expectedDimension`/`expectedKind`
 *   gate the result; `trace` yields step-by-step diagnostics (optional,
 *   off the fast path).
 * - Serialization is data-only (AST + declarations); deserialization
 *   revalidates everything and recompiles.
 *
 * No domain formulas live here — only the generic machinery. No eval /
 * Function / dynamic import anywhere.
 * -----------------------------------------------------------------------
 */
import {
  dimensionKey,
  dimensionsEqual,
  divideDim,
  multiplyDim,
  powDim,
  type DimensionVector,
} from "./dimension.js";
import { parseUnit } from "./unit-parser.js";
import { DIMENSIONLESS_UNIT } from "./unit.js";
import { Quantity } from "./quantity.js";
import { Measurement } from "./measurement.js";
import { defaultUnitRegistry, type UnitRegistry } from "./unit-registry.js";
import { defaultFunctionRegistry, type FunctionRegistry } from "./function-registry.js";
import {
  assertSemanticCompatible,
  defaultQuantityKindRegistry,
  type QuantityKindRegistry,
  type SemanticPolicy,
} from "./quantity-kind.js";
import {
  canonicalExpressionKey,
  collectVariables,
  compileExpression,
  deserializeExpression,
  inferExpressionDimension,
  lit,
  serializeExpression,
  simplifyExpression,
  type Expression,
  type ExpressionLimits,
  type SerializedExpression,
  type VariableDimensions,
} from "./expression.js";
import { isDimension } from "./guards.js";
import { ExpressionLimitError, FormulaError, UnknownVariableError } from "./errors/index.js";
import type { ConstantRegistry, ScientificConstant } from "./constants.js";

// ---------------------------------------------------------------------------
// Declarations & limits
// ---------------------------------------------------------------------------

export interface FormulaInputDeclaration {
  /** Required dimension (vector or unit string, e.g. "kg" or Dim.Mass). */
  readonly dimension: DimensionVector | string;
  /** Optional semantic kind claim (e.g. "angle"). */
  readonly kind?: string;
  /** When true, the binding may be omitted if `default` is provided. */
  readonly optional?: boolean;
  /** Pre-bound value used when the binding is omitted (partial evaluation). */
  readonly default?: Quantity | number | Measurement;
}

/** Provenance reference for a ScientificConstant baked into a formula. */
export interface FormulaConstantRef {
  readonly id: string;
  readonly version: number;
  readonly namespace?: string;
}

export interface FormulaLimits extends ExpressionLimits {
  /** Maximum declared + free variables (default 256). */
  readonly maxVariables?: number;
}

export interface DefineFormulaOptions {
  readonly registry?: UnitRegistry;
  readonly functions?: FunctionRegistry;
  readonly kinds?: QuantityKindRegistry;
  readonly limits?: FormulaLimits;
  /** Semantic strictness for kind validation (default "dimensional-only"). */
  readonly semanticPolicy?: SemanticPolicy;
  /** Registry resolving ScientificConstant refs on deserialization. */
  readonly constantRegistry?: ConstantRegistry;
}

const FORMULA_ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const DEFAULT_MAX_VARIABLES = 256;

function resolveFormulaLimits(limits?: FormulaLimits): {
  maxVariables: number;
} {
  const maxVariables = limits?.maxVariables ?? DEFAULT_MAX_VARIABLES;
  if (!Number.isInteger(maxVariables) || maxVariables < 1) {
    throw new ExpressionLimitError(
      `maxVariables must be a positive integer, got ${String(maxVariables)}`,
    );
  }
  return { maxVariables };
}

function assertFormulaId(id: string): void {
  if (typeof id !== "string" || !FORMULA_ID_RE.test(id)) {
    throw new FormulaError(id, `invalid formula id "${String(id)}"`);
  }
}

// ---------------------------------------------------------------------------
// Formula definition
// ---------------------------------------------------------------------------

export interface Formula {
  readonly id: string;
  /** Simplified expression AFTER constant substitution (partial evaluation). */
  readonly expression: Expression;
  readonly inputs: Readonly<Record<string, FormulaInputDeclaration>>;
  readonly outputName?: string;
  readonly outputUnit?: string;
  readonly expectedDimension?: DimensionVector;
  readonly expectedKind?: string;
  /** Scientific constants baked in: exact ones folded as literals, uncertain
   * ones added as pre-bound Measurement inputs. Records id/version for
   * reproducibility. */
  readonly constantRefs: Readonly<Record<string, FormulaConstantRef>>;
  readonly description?: string;
  readonly version: number;
  readonly registry: UnitRegistry;
  readonly semanticPolicy: SemanticPolicy;
}

export interface DefineFormulaArgs {
  readonly id: string;
  readonly expression: Expression | SerializedExpression | string;
  readonly inputs?: Readonly<Record<string, FormulaInputDeclaration>>;
  readonly outputName?: string;
  readonly outputUnit?: string;
  readonly expectedDimension?: DimensionVector | string;
  readonly expectedKind?: string;
  /**
   * Immutable named constants. Exact values (numbers, Quantities, exact
   * ScientificConstants) substitute as literals and fold at define time.
   * Uncertain values (Measurements with nonzero uncertainty, uncertain
   * ScientificConstants) become auto-declared inputs pre-bound to their
   * Measurement, so uncertainty propagates through the Measurement path —
   * never silently dropped.
   */
  readonly constants?: Readonly<
    Record<string, Quantity | number | Measurement | ScientificConstant>
  >;
  readonly description?: string;
  readonly version?: number;
}

function resolveExpressionInput(
  id: string,
  expression: Expression | SerializedExpression | string,
  limits?: FormulaLimits,
): Expression {
  if (typeof expression === "string") {
    return deserializeExpression(expression, limits);
  }
  if (
    expression !== null &&
    typeof expression === "object" &&
    !Array.isArray(expression) &&
    (expression as unknown as Record<string, unknown>).type === "expression"
  ) {
    return deserializeExpression(expression as SerializedExpression, limits);
  }
  return expression as Expression;
}

function resolveDeclaredDimension(
  id: string,
  name: string,
  declared: unknown,
  registry: UnitRegistry,
): DimensionVector {
  if (typeof declared === "string") {
    if (declared.trim() === "1") return {};
    try {
      return parseUnit(declared, registry).dimension;
    } catch (error) {
      throw new FormulaError(
        id,
        `input "${name}" declares unresolvable dimension unit "${declared}" (${(error as Error).message})`,
      );
    }
  }
  if (declared !== null && typeof declared === "object" && !Array.isArray(declared)) {
    if (!isDimension(declared)) {
      throw new FormulaError(id, `input "${name}" declares an invalid DimensionVector`);
    }
    return declared as DimensionVector;
  }
  throw new FormulaError(id, `input "${name}" dimension must be a DimensionVector or unit string`);
}

function isScientificConstant(value: unknown): value is ScientificConstant {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && v.quantity instanceof Quantity && typeof v.exact === "boolean";
}

function literalForConstant(
  value: Quantity | number | Measurement | ScientificConstant,
  name: string,
  id: string,
): Expression {
  if (typeof value === "number") {
    return lit(value, "1");
  }
  if (value instanceof Quantity) {
    const symbol = value.unit.symbol + (value.unit.basis ? ` ${value.unit.basis}` : "");
    return lit(value.value, symbol);
  }
  if (isScientificConstant(value)) {
    if (!value.exact) {
      throw new FormulaError(
        id,
        `constant "${name}" carries uncertainty and cannot fold to a literal (it becomes an input instead)`,
      );
    }
    const q = value.quantity;
    const symbol = q.unit.symbol + (q.unit.basis ? ` ${q.unit.basis}` : "");
    return lit(q.value, symbol);
  }
  throw new FormulaError(
    id,
    `constant "${name}" must be a Quantity, number, Measurement, or ScientificConstant`,
  );
}

/**
 * Split constants into exact (fold as literals) and uncertain (auto-declared
 * pre-bound Measurement inputs). Returns literal substitutions, extra input
 * declarations, and reproducibility refs.
 */
function partitionConstants(
  id: string,
  constants: Readonly<Record<string, Quantity | number | Measurement | ScientificConstant>>,
  declaredInputs: Readonly<Record<string, FormulaInputDeclaration>>,
): {
  literals: Record<string, Quantity | number>;
  autoInputs: Record<string, FormulaInputDeclaration>;
  refs: Record<string, FormulaConstantRef>;
} {
  const literals: Record<string, Quantity | number> = {};
  const autoInputs: Record<string, FormulaInputDeclaration> = {};
  const refs: Record<string, FormulaConstantRef> = {};
  for (const [name, value] of Object.entries(constants)) {
    if (!FORMULA_ID_RE.test(name)) {
      throw new FormulaError(id, `invalid constant name "${name}"`);
    }
    if (Object.prototype.hasOwnProperty.call(declaredInputs, name)) {
      throw new FormulaError(
        id,
        `constant "${name}" collides with a declared input (rename one of them)`,
      );
    }
    if (isScientificConstant(value)) {
      refs[name] = Object.freeze({
        id: value.id,
        version: value.version,
        ...(value.namespace !== undefined ? { namespace: value.namespace } : {}),
      });
      if (value.exact) {
        literals[name] = value.quantity;
        continue;
      }
      autoInputs[name] = Object.freeze({
        dimension: { ...value.measurement.dimension },
        ...(value.measurement.value.kind !== undefined
          ? { kind: value.measurement.value.kind }
          : {}),
        default: value.measurement,
      });
      continue;
    }
    if (value instanceof Measurement) {
      if (value.uncertainty.value === 0) {
        literals[name] = value.value;
        continue;
      }
      autoInputs[name] = Object.freeze({
        dimension: { ...value.dimension },
        ...(value.value.kind !== undefined ? { kind: value.value.kind } : {}),
        default: value,
      });
      continue;
    }
    literals[name] = value as Quantity | number;
  }
  return { literals, autoInputs, refs };
}

/** Substitute constants as literals, then simplify (partial evaluation at define time). */
function substituteConstants(
  expr: Expression,
  constants: Readonly<Record<string, Quantity | number>>,
  id: string,
  registry: UnitRegistry,
  functions: FunctionRegistry,
  limits?: FormulaLimits,
): Expression {
  const names = Object.keys(constants);
  if (names.length === 0) return expr;
  for (const name of names) {
    if (!FORMULA_ID_RE.test(name)) {
      throw new FormulaError(id, `invalid constant name "${name}"`);
    }
  }
  const substituted = substituteVariables(expr, names, (name) =>
    literalForConstant(constants[name]!, name, id),
  );
  return simplifyExpression(substituted, { registry, functions, limits });
}

function substituteVariables(
  expr: Expression,
  names: readonly string[],
  replacement: (name: string) => Expression,
): Expression {
  const wanted = new Set(names);
  const rewrite = (node: Expression): Expression => {
    switch (node.kind) {
      case "variable":
        return wanted.has(node.name) ? replacement(node.name) : node;
      case "add":
      case "subtract":
      case "multiply":
      case "divide": {
        const left = rewrite(node.left);
        const right = rewrite(node.right);
        if (left === node.left && right === node.right) return node;
        return Object.freeze({ kind: node.kind, left, right }) as Expression;
      }
      case "power": {
        const base = rewrite(node.base);
        if (base === node.base) return node;
        return Object.freeze({ kind: "power", base, exponent: node.exponent }) as Expression;
      }
      case "convert": {
        const inner = rewrite(node.expr);
        if (inner === node.expr) return node;
        return Object.freeze({ kind: "convert", expr: inner, unit: node.unit }) as Expression;
      }
      case "call": {
        const args = node.args.map(rewrite);
        if (args.every((arg, i) => arg === node.args[i])) return node;
        return Object.freeze({ kind: "call", function: node.function, args }) as Expression;
      }
      default:
        return node;
    }
  };
  return rewrite(expr);
}

/** Static kind inference over an expression (no numerics). */
function inferKinds(
  id: string,
  expr: Expression,
  varKinds: Readonly<Record<string, string | undefined>>,
  registry: UnitRegistry,
  functions: FunctionRegistry,
  kinds: QuantityKindRegistry,
  policy: SemanticPolicy,
): string | undefined {
  const visit = (node: Expression): string | undefined => {
    switch (node.kind) {
      case "literal":
        if (node.unit.trim() === "1") return undefined;
        return parseUnit(node.unit, registry).metadata?.kind;
      case "variable":
        return varKinds[node.name];
      case "add":
      case "subtract": {
        const left = visit(node.left);
        const right = visit(node.right);
        try {
          assertSemanticCompatible(left, right, policy, kinds);
        } catch (error) {
          throw new FormulaError(
            id,
            `"${node.kind}" mixes kinds "${left ?? "unknown"}" and "${right ?? "unknown"}" (${(error as Error).message})`,
          );
        }
        return left ?? right;
      }
      case "multiply":
      case "divide":
        visit(node.left);
        visit(node.right);
        return undefined; // compound kinds are not tracked
      case "power":
        return node.exponent === 1 ? visit(node.base) : (visit(node.base), undefined);
      case "convert":
        visit(node.expr);
        return parseUnit(node.unit, registry).metadata?.kind;
      case "call": {
        const spec = functions.require(node.function);
        const argKinds = node.args.map(visit);
        if (policy !== "dimensional-only" && spec.requiresKind !== undefined) {
          for (const [index, kind] of argKinds.entries()) {
            try {
              assertSemanticCompatible(kind, spec.requiresKind, policy, kinds);
            } catch (error) {
              throw new FormulaError(
                id,
                `function "${node.function}" argument ${index} has kind "${kind ?? "unknown"}", requires "${spec.requiresKind}" (${(error as Error).message})`,
              );
            }
          }
        }
        return undefined;
      }
      default:
        throw new FormulaError(id, "cannot infer kinds of an unknown node");
    }
  };
  return visit(expr);
}

/**
 * Define a validated formula. Validation order: structure → variables →
 * constants → static dimensions → expected dimension/kind → output unit.
 * Nothing numeric executes here.
 */
export function defineFormula(args: DefineFormulaArgs, opts: DefineFormulaOptions = {}): Formula {
  assertFormulaId(args.id);
  const registry = opts.registry ?? defaultUnitRegistry;
  const functions = opts.functions ?? defaultFunctionRegistry;
  const kinds = opts.kinds ?? defaultQuantityKindRegistry;
  const policy = opts.semanticPolicy ?? "dimensional-only";
  const { maxVariables } = resolveFormulaLimits(opts.limits);

  let expression = resolveExpressionInput(args.id, args.expression, opts.limits);
  // Structural validation up front (depth/nodes/kinds), so hostile
  // hand-built ASTs fail here instead of in later unguarded traversals.
  canonicalExpressionKey(expression, opts.limits);
  const constants = args.constants ?? {};
  if (constants === null || typeof constants !== "object" || Array.isArray(constants)) {
    throw new FormulaError(args.id, "constants must be a plain object");
  }
  const declaredInputs = args.inputs ?? {};
  if (
    declaredInputs === null ||
    typeof declaredInputs !== "object" ||
    Array.isArray(declaredInputs)
  ) {
    throw new FormulaError(args.id, "inputs must be a plain object");
  }
  // Exact constants fold to literals; uncertain ones (Measurements with
  // nonzero uncertainty, uncertain ScientificConstants) become auto-declared
  // pre-bound Measurement inputs so uncertainty propagates.
  const {
    literals,
    autoInputs,
    refs: constantRefs,
  } = partitionConstants(args.id, constants, declaredInputs);
  expression = substituteConstants(expression, literals, args.id, registry, functions, opts.limits);
  const inputs: Record<string, FormulaInputDeclaration> = { ...declaredInputs, ...autoInputs };

  const free = [...collectVariables(expression)];
  const inputNames = Object.keys(inputs);
  if (free.length + inputNames.length > maxVariables) {
    throw new ExpressionLimitError(`Formula "${args.id}" exceeds maxVariables ${maxVariables}.`);
  }
  for (const name of inputNames) {
    if (!FORMULA_ID_RE.test(name)) {
      throw new FormulaError(args.id, `invalid input name "${name}"`);
    }
  }
  for (const name of free) {
    if (!Object.prototype.hasOwnProperty.call(inputs, name)) {
      throw new FormulaError(
        args.id,
        `unbound variable "${name}" (declare it in inputs or constants)`,
      );
    }
  }

  // Declared dimensions for static analysis.
  const varDimensions: VariableDimensions = {};
  const varKinds: Record<string, string | undefined> = {};
  for (const [name, decl] of Object.entries(inputs)) {
    if (decl === null || typeof decl !== "object" || Array.isArray(decl)) {
      throw new FormulaError(args.id, `input "${name}" declaration must be an object`);
    }
    varDimensions[name] = resolveDeclaredDimension(args.id, name, decl.dimension, registry);
    if (decl.kind !== undefined) {
      if (typeof decl.kind !== "string") {
        throw new FormulaError(args.id, `input "${name}" kind must be a string`);
      }
      if (!kinds.has(decl.kind)) {
        throw new FormulaError(args.id, `input "${name}" declares unknown kind "${decl.kind}"`);
      }
      varKinds[name] = decl.kind;
    } else {
      varKinds[name] = undefined;
    }
  }

  // Static dimensional analysis — invalid formulas die here.
  let inferred: DimensionVector;
  try {
    inferred = inferExpressionDimension(expression, varDimensions, {
      registry,
      functions,
      limits: opts.limits,
    });
  } catch (error) {
    if (error instanceof ExpressionLimitError) throw error;
    throw new FormulaError(args.id, `dimensional analysis failed (${(error as Error).message})`);
  }

  if (args.expectedDimension !== undefined) {
    const expected =
      typeof args.expectedDimension === "string"
        ? parseUnit(args.expectedDimension, registry).dimension
        : args.expectedDimension;
    if (!dimensionsEqual(inferred, expected)) {
      throw new FormulaError(
        args.id,
        `expected dimension ${dimensionKey(expected)} but expression yields ${dimensionKey(inferred)}`,
      );
    }
  }

  const inferredKind = inferKinds(
    args.id,
    expression,
    varKinds,
    registry,
    functions,
    kinds,
    policy,
  );
  if (args.expectedKind !== undefined) {
    if (!kinds.has(args.expectedKind)) {
      throw new FormulaError(args.id, `unknown expectedKind "${args.expectedKind}"`);
    }
    try {
      assertSemanticCompatible(inferredKind, args.expectedKind, policy, kinds);
    } catch (error) {
      throw new FormulaError(
        args.id,
        `expected kind "${args.expectedKind}" but expression yields "${inferredKind ?? "unknown"}" (${(error as Error).message})`,
      );
    }
  }

  if (args.outputUnit !== undefined) {
    try {
      const target = parseUnit(args.outputUnit, registry);
      if (!dimensionsEqual(inferred, target.dimension)) {
        throw new FormulaError(
          args.id,
          `output unit "${args.outputUnit}" is incompatible with result dimension ${dimensionKey(inferred)}`,
        );
      }
    } catch (error) {
      if (error instanceof FormulaError) throw error;
      throw new FormulaError(
        args.id,
        `unresolvable output unit "${args.outputUnit}" (${(error as Error).message})`,
      );
    }
  }

  if (args.outputName !== undefined && !FORMULA_ID_RE.test(args.outputName)) {
    throw new FormulaError(args.id, `invalid outputName "${args.outputName}"`);
  }

  const version = args.version ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new FormulaError(args.id, "version must be a positive integer");
  }

  const frozenInputs: Record<string, FormulaInputDeclaration> = {};
  for (const [name, decl] of Object.entries(inputs)) {
    // Copy a caller-supplied raw dimension vector so later caller mutation
    // cannot silently change validation/evaluation semantics. Unit-string
    // declarations resolve to registry-owned (frozen) dimensions already.
    const dimension =
      typeof decl.dimension === "string" ? decl.dimension : Object.freeze({ ...decl.dimension });
    frozenInputs[name] = Object.freeze({ ...decl, dimension });
  }
  const frozenRefs: Record<string, FormulaConstantRef> = {};
  for (const [name, ref] of Object.entries(constantRefs)) {
    frozenRefs[name] = Object.freeze({ ...ref });
  }
  return Object.freeze({
    id: args.id,
    expression,
    inputs: Object.freeze(frozenInputs),
    outputName: args.outputName,
    outputUnit: args.outputUnit,
    constantRefs: Object.freeze(frozenRefs),
    expectedDimension: args.expectedDimension
      ? Object.freeze({
          ...(typeof args.expectedDimension === "string"
            ? parseUnit(args.expectedDimension, registry).dimension
            : args.expectedDimension),
        })
      : undefined,
    expectedKind: args.expectedKind,
    description: args.description,
    version,
    registry,
    semanticPolicy: policy,
  });
}

// ---------------------------------------------------------------------------
// Bindings & evaluation
// ---------------------------------------------------------------------------

export type FormulaBinding = Quantity | number | Measurement;
export type FormulaBindings = Readonly<Record<string, FormulaBinding>>;

export interface FormulaTraceStep {
  readonly expression: string;
  readonly result: string;
}

export interface FormulaTrace {
  readonly result: Quantity;
  readonly steps: readonly FormulaTraceStep[];
}

export interface EvaluateFormulaOptions {
  readonly registry?: UnitRegistry;
  readonly functions?: FunctionRegistry;
  readonly limits?: FormulaLimits;
  /** Convert the result to this unit (validated against the definition). */
  readonly outputUnit?: string;
  /** Collect step-by-step diagnostics (Quantity/number bindings only). */
  readonly trace?: boolean;
}

function toQuantityBinding(name: string, id: string, binding: FormulaBinding): Quantity {
  if (typeof binding === "number") {
    return Quantity.of(binding, DIMENSIONLESS_UNIT);
  }
  if (binding instanceof Quantity) return binding;
  throw new FormulaError(id, `binding "${name}" must be a Quantity, number or Measurement`);
}

function checkBindingAgainstDeclaration(
  id: string,
  name: string,
  quantity: Quantity,
  decl: FormulaInputDeclaration,
  registry: UnitRegistry,
): void {
  const expected = resolveDeclaredDimension(id, name, decl.dimension, registry);
  if (!dimensionsEqual(quantity.dimension, expected)) {
    throw new FormulaError(
      id,
      `binding "${name}" has dimension ${dimensionKey(quantity.dimension)} but declared ${dimensionKey(expected)}`,
    );
  }
  // Declared kinds are explicit contracts: always checked semantic-aware
  // (kind-less bindings still pass via the unknown-wildcard rule).
  if (decl.kind !== undefined) {
    try {
      assertSemanticCompatible(quantity.kind, decl.kind, "semantic-aware");
    } catch (error) {
      throw new FormulaError(
        id,
        `binding "${name}" has kind "${quantity.kind ?? "unknown"}" but declared "${decl.kind}" (${(error as Error).message})`,
      );
    }
  }
}

function evalMeasurementNode(
  id: string,
  expr: Expression,
  bindings: Readonly<Record<string, Measurement>>,
  registry: UnitRegistry,
  depth: number,
): Measurement {
  if (depth > 64) {
    throw new FormulaError(id, "evaluation exceeded depth 64");
  }
  switch (expr.kind) {
    case "literal":
      return Measurement.exact(Quantity.of(expr.value, expr.unit, registry));
    case "variable": {
      const bound = bindings[expr.name];
      if (bound === undefined) throw new FormulaError(id, `missing binding "${expr.name}"`);
      return bound;
    }
    case "add":
      return evalMeasurementNode(id, expr.left, bindings, registry, depth + 1).add(
        evalMeasurementNode(id, expr.right, bindings, registry, depth + 1),
      );
    case "subtract":
      return evalMeasurementNode(id, expr.left, bindings, registry, depth + 1).subtract(
        evalMeasurementNode(id, expr.right, bindings, registry, depth + 1),
      );
    case "multiply":
      return evalMeasurementNode(id, expr.left, bindings, registry, depth + 1).multiply(
        evalMeasurementNode(id, expr.right, bindings, registry, depth + 1),
      );
    case "divide":
      return evalMeasurementNode(id, expr.left, bindings, registry, depth + 1).divide(
        evalMeasurementNode(id, expr.right, bindings, registry, depth + 1),
      );
    case "power":
      return evalMeasurementNode(id, expr.base, bindings, registry, depth + 1).pow(expr.exponent);
    case "convert":
      return evalMeasurementNode(id, expr.expr, bindings, registry, depth + 1).to(
        expr.unit,
        registry,
      );
    case "call":
      throw new FormulaError(
        id,
        `function "${expr.function}" has no Measurement overload (evaluate Quantities first)`,
      );
    default:
      throw new FormulaError(id, "cannot evaluate an unknown node");
  }
}

function describeExpr(expr: Expression): string {
  switch (expr.kind) {
    case "literal":
      return `${expr.value} ${expr.unit}`;
    case "variable":
      return expr.name;
    case "add":
      return `(${describeExpr(expr.left)} + ${describeExpr(expr.right)})`;
    case "subtract":
      return `(${describeExpr(expr.left)} - ${describeExpr(expr.right)})`;
    case "multiply":
      return `(${describeExpr(expr.left)} × ${describeExpr(expr.right)})`;
    case "divide":
      return `(${describeExpr(expr.left)} / ${describeExpr(expr.right)})`;
    case "power":
      return `(${describeExpr(expr.base)}^${expr.exponent})`;
    case "convert":
      return `(${describeExpr(expr.expr)} → ${expr.unit})`;
    case "call":
      return `${expr.function}(${expr.args.map(describeExpr).join(", ")})`;
  }
}

function evaluateWithTrace(
  expr: Expression,
  context: Readonly<Record<string, Quantity>>,
  registry: UnitRegistry,
  functions: FunctionRegistry,
  steps: FormulaTraceStep[],
): Quantity {
  const record = (node: Expression, result: Quantity): Quantity => {
    steps.push({ expression: describeExpr(node), result: result.toString() });
    return result;
  };
  switch (expr.kind) {
    case "literal":
      return record(expr, Quantity.of(expr.value, expr.unit, registry));
    case "variable": {
      if (!Object.prototype.hasOwnProperty.call(context, expr.name)) {
        throw new UnknownVariableError(expr.name);
      }
      return record(expr, context[expr.name]!);
    }
    case "add":
      return record(
        expr,
        evaluateWithTrace(expr.left, context, registry, functions, steps).add(
          evaluateWithTrace(expr.right, context, registry, functions, steps),
        ),
      );
    case "subtract":
      return record(
        expr,
        evaluateWithTrace(expr.left, context, registry, functions, steps).subtract(
          evaluateWithTrace(expr.right, context, registry, functions, steps),
        ),
      );
    case "multiply":
      return record(
        expr,
        evaluateWithTrace(expr.left, context, registry, functions, steps).multiply(
          evaluateWithTrace(expr.right, context, registry, functions, steps),
        ),
      );
    case "divide":
      return record(
        expr,
        evaluateWithTrace(expr.left, context, registry, functions, steps).divide(
          evaluateWithTrace(expr.right, context, registry, functions, steps),
        ),
      );
    case "power":
      return record(
        expr,
        evaluateWithTrace(expr.base, context, registry, functions, steps).pow(expr.exponent),
      );
    case "convert":
      return record(
        expr,
        evaluateWithTrace(expr.expr, context, registry, functions, steps).to(expr.unit, registry),
      );
    case "call":
      return record(
        expr,
        functions.call(
          expr.function,
          expr.args.map((arg) => evaluateWithTrace(arg, context, registry, functions, steps)),
        ),
      );
  }
}

// ---------------------------------------------------------------------------
// Compilation & evaluation entry points
// ---------------------------------------------------------------------------

export interface CompiledFormula {
  readonly definition: Formula;
  /** Canonical cache key (definition id + version + expression + registry generations). */
  readonly key: string;
  /** Free variables remaining after constant substitution. */
  readonly variables: readonly string[];
  evaluate(
    inputs?: FormulaBindings,
    opts?: EvaluateFormulaOptions,
  ): Quantity | Measurement | FormulaTrace;
  inferDimension(): DimensionVector;
}

const MAX_FORMULA_CACHE = 100;
const formulaCaches = new WeakMap<UnitRegistry, Map<string, CompiledFormula>>();

function formulaCacheFor(registry: UnitRegistry): Map<string, CompiledFormula> {
  let m = formulaCaches.get(registry);
  if (!m) {
    m = new Map<string, CompiledFormula>();
    formulaCaches.set(registry, m);
  }
  return m;
}

/**
 * Compile a defined formula into an efficient immutable evaluator.
 * Reuses compileExpression (plan caching, constant folding); the formula
 * layer adds binding validation, output conversion, kinds and tracing.
 */
export function compileFormula(
  definition: Formula,
  opts: EvaluateFormulaOptions = {},
): CompiledFormula {
  const registry = opts.registry ?? definition.registry;
  const functions = opts.functions ?? defaultFunctionRegistry;
  // Key covers constant refs/versions AND pre-bound defaults: two definitions
  // with the same id/version but different constant data must not collide.
  const refKey = Object.keys(definition.constantRefs)
    .sort()
    .map((name) => {
      const ref = definition.constantRefs[name]!;
      return `${name}=${ref.namespace ?? ""}:${ref.id}@${ref.version}`;
    })
    .join(",");
  const defaultsKey = Object.keys(definition.inputs)
    .sort()
    .map((name) => {
      const d = definition.inputs[name]!.default;
      if (d === undefined) return `${name}=-`;
      if (typeof d === "number") return `${name}#${d}`;
      if (d instanceof Measurement) {
        return `${name}=${d.value.value}(${d.value.unit.symbol})±${d.uncertainty.value}(${d.uncertainty.unit.symbol})`;
      }
      return `${name}=${d.value}(${d.unit.symbol})`;
    })
    .join(",");
  const key = `${definition.id}::v${definition.version}::${canonicalExpressionKey(definition.expression)}::${registry.version}::${functions.version}::refs[${refKey}]::defs[${defaultsKey}]`;
  const cache = formulaCacheFor(registry);
  const cached = cache.get(key);
  if (cached) return cached;

  const plan = compileExpression(definition.expression, {
    registry,
    functions,
    limits: opts.limits,
  });
  const variables = Object.freeze([...collectVariables(definition.expression)].sort());

  const run = (
    inputs: FormulaBindings = {},
    evalOpts: EvaluateFormulaOptions = {},
  ): Quantity | Measurement | FormulaTrace => {
    if (inputs === null || typeof inputs !== "object" || Array.isArray(inputs)) {
      throw new FormulaError(definition.id, "inputs must be an object");
    }
    // Resolve bindings: declared defaults fill gaps; undeclared extras rejected.
    const quantityContext: Record<string, Quantity> = {};
    const measurementContext: Record<string, Measurement> = {};
    let hasMeasurement = false;
    for (const name of variables) {
      const decl = definition.inputs[name];
      let binding = Object.prototype.hasOwnProperty.call(inputs, name)
        ? (inputs as Record<string, FormulaBinding>)[name]!
        : undefined;
      if (binding === undefined && decl?.default !== undefined) {
        binding = decl.default;
      }
      if (binding === undefined) {
        if (decl?.optional === true) continue;
        throw new FormulaError(definition.id, `missing binding "${name}"`);
      }
      if (binding instanceof Measurement) {
        hasMeasurement = true;
        measurementContext[name] = binding;
        continue;
      }
      const quantity = toQuantityBinding(name, definition.id, binding);
      if (decl) checkBindingAgainstDeclaration(definition.id, name, quantity, decl, registry);
      quantityContext[name] = quantity;
    }
    for (const name of Object.keys(inputs)) {
      if (!variables.includes(name)) {
        throw new FormulaError(definition.id, `unexpected binding "${name}"`);
      }
    }

    const outputUnit = evalOpts.outputUnit ?? definition.outputUnit;
    if (hasMeasurement) {
      if (evalOpts.trace === true) {
        throw new FormulaError(definition.id, "trace mode supports Quantity bindings only");
      }
      // Promote Quantity bindings to exact measurements for a uniform walk.
      const uniform: Record<string, Measurement> = { ...measurementContext };
      for (const [name, q] of Object.entries(quantityContext)) {
        uniform[name] = Measurement.exact(q);
      }
      let result = evalMeasurementNode(definition.id, plan.expression, uniform, registry, 1);
      if (outputUnit !== undefined) result = result.to(outputUnit, registry);
      return result;
    }

    if (evalOpts.trace === true) {
      const steps: FormulaTraceStep[] = [];
      const result = evaluateWithTrace(
        plan.expression,
        quantityContext,
        registry,
        functions,
        steps,
      );
      const converted = outputUnit !== undefined ? result.to(outputUnit, registry) : result;
      if (outputUnit !== undefined) {
        steps.push({ expression: `convert to ${outputUnit}`, result: converted.toString() });
      }
      return { result: converted, steps: Object.freeze(steps) };
    }

    let result = plan.evaluate(quantityContext);
    if (outputUnit !== undefined) result = result.to(outputUnit, registry);
    return result;
  };

  const compiled: CompiledFormula = Object.freeze({
    definition,
    key,
    variables,
    evaluate: run,
    inferDimension: () => {
      const varDimensions: VariableDimensions = {};
      for (const [name, decl] of Object.entries(definition.inputs)) {
        varDimensions[name] = resolveDeclaredDimension(
          definition.id,
          name,
          decl.dimension,
          registry,
        );
      }
      return inferExpressionDimension(plan.expression, varDimensions, {
        registry,
        functions,
        limits: opts.limits,
      });
    },
  });
  if (cache.size >= MAX_FORMULA_CACHE) {
    const first = cache.keys().next().value as string | undefined;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, compiled);
  return compiled;
}

/** One-shot evaluation (defines nothing, caches nothing beyond the plan). */
export function evaluateFormula(
  definition: Formula,
  inputs: FormulaBindings = {},
  opts: EvaluateFormulaOptions = {},
): Quantity | Measurement | FormulaTrace {
  return compileFormula(definition, opts).evaluate(inputs, opts);
}

/** Free variables remaining after constant substitution (partial-eval surface). */
export function formulaVariables(definition: Formula): readonly string[] {
  return Object.freeze([...collectVariables(definition.expression)].sort());
}

// ---------------------------------------------------------------------------
// Dimensional analysis API (23.10–23.12, reused by validation above)
// ---------------------------------------------------------------------------

export interface DimensionAnalysis {
  readonly dimension?: DimensionVector;
  readonly valid: boolean;
  readonly diagnostics: readonly string[];
}

/**
 * Analyze an expression's dimension without numeric evaluation.
 * Always returns (never throws for dimensional issues); hostile/limit
 * violations still throw typed errors.
 */
export function analyzeDimensions(
  expr: Expression,
  varDimensions: VariableDimensions = {},
  opts: { registry?: UnitRegistry; functions?: FunctionRegistry; limits?: ExpressionLimits } = {},
): DimensionAnalysis {
  try {
    const dimension = inferExpressionDimension(expr, varDimensions, opts);
    return { dimension, valid: true, diagnostics: Object.freeze([]) };
  } catch (error) {
    if (error instanceof ExpressionLimitError) throw error;
    return {
      dimension: undefined,
      valid: false,
      diagnostics: Object.freeze([(error as Error).message]),
    };
  }
}

/**
 * Infer unknown variable dimensions by constraint propagation (23.11).
 * Given known variable dimensions (and optionally the output dimension),
 * solves single-unknown constraints iteratively:
 * add/sub unify siblings; multiply/divide invert; power scales; convert
 * unifies with the target. Stops at a fixed point; unknown remainder stays
 * absent. Only dimensional constraints — never general symbolic math.
 */
export function inferUnknownDimensions(
  expr: Expression,
  known: Readonly<Record<string, DimensionVector | string>>,
  opts: {
    registry?: UnitRegistry;
    functions?: FunctionRegistry;
    limits?: ExpressionLimits;
    outputDimension?: DimensionVector | string;
    maxIterations?: number;
  } = {},
): Readonly<Record<string, DimensionVector>> {
  const registry = opts.registry ?? defaultUnitRegistry;
  const functions = opts.functions ?? defaultFunctionRegistry;
  const maxIterations = opts.maxIterations ?? 64;
  // Seed with resolved known dimensions.
  const solved = new Map<string, DimensionVector>();
  for (const [name, declared] of Object.entries(known)) {
    solved.set(
      name,
      typeof declared === "string" ? parseUnit(declared, registry).dimension : declared,
    );
  }
  // Node dimension environment: variable name → dimension (partial).
  const target =
    opts.outputDimension !== undefined
      ? typeof opts.outputDimension === "string"
        ? parseUnit(opts.outputDimension, registry).dimension
        : opts.outputDimension
      : undefined;

  // Iterative fixed-point propagation over the tree.
  for (let iter = 0; iter < maxIterations; iter++) {
    let progressed = false;
    const before = solved.size;
    propagate(expr, solved, registry, functions, target, {
      progress: () => {
        progressed = true;
      },
    });
    if (solved.size === before && !progressed) break;
    void iter;
  }
  return Object.freeze(Object.fromEntries(solved));
}

function dimOfVar(name: string, solved: Map<string, DimensionVector>): DimensionVector | undefined {
  if (solved.has(name)) return solved.get(name);
  return undefined;
}

/** One propagation sweep; returns nothing, mutates `solved` monotonically. */
function propagate(
  expr: Expression,
  solved: Map<string, DimensionVector>,
  registry: UnitRegistry,
  functions: FunctionRegistry,
  target: DimensionVector | undefined,
  hooks: { progress: () => void },
  inherited?: DimensionVector,
): DimensionVector | undefined {
  const want = inherited ?? target;
  switch (expr.kind) {
    case "literal":
      return parseUnit(expr.unit, registry).dimension;
    case "variable":
      return dimOfVar(expr.name, solved);
    case "add":
    case "subtract": {
      const left = propagate(expr.left, solved, registry, functions, undefined, hooks, want);
      const right = propagate(expr.right, solved, registry, functions, undefined, hooks, want);
      if (left && !right) {
        assignUnknown(expr.right, left, solved, hooks);
        return left;
      }
      if (right && !left) {
        assignUnknown(expr.left, right, solved, hooks);
        return right;
      }
      if (left && right) return left;
      return want;
    }
    case "multiply": {
      const left = propagate(expr.left, solved, registry, functions, undefined, hooks);
      const right = propagate(expr.right, solved, registry, functions, undefined, hooks);
      if (left && right) return multiplyDim(left, right);
      if (want && left && !right) {
        assignUnknown(expr.right, divideDim(want, left), solved, hooks);
        return want;
      }
      if (want && right && !left) {
        assignUnknown(expr.left, divideDim(want, right), solved, hooks);
        return want;
      }
      return want && left ? multiplyDim(left, right ?? {}) : want;
    }
    case "divide": {
      const left = propagate(expr.left, solved, registry, functions, undefined, hooks);
      const right = propagate(expr.right, solved, registry, functions, undefined, hooks);
      if (left && right) return divideDim(left, right);
      if (want && left && !right) {
        assignUnknown(expr.right, divideDim(left, want), solved, hooks);
        return want;
      }
      if (want && right && !left) {
        assignUnknown(expr.left, multiplyDim(want, right), solved, hooks);
        return want;
      }
      return want;
    }
    case "power": {
      const base = propagate(expr.base, solved, registry, functions, undefined, hooks);
      if (base) {
        try {
          return powDim(base, expr.exponent);
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
    case "convert": {
      const targetDim = parseUnit(expr.unit, registry).dimension;
      propagate(expr.expr, solved, registry, functions, undefined, hooks, targetDim);
      return targetDim;
    }
    case "call":
      for (const arg of expr.args) propagate(arg, solved, registry, functions, undefined, hooks);
      return undefined;
    default:
      return undefined;
  }
}

function assignUnknown(
  expr: Expression,
  dim: DimensionVector,
  solved: Map<string, DimensionVector>,
  hooks: { progress: () => void },
): void {
  // Only direct variables can be assigned; deeper unknowns need more passes
  // with narrower constraints (handled by re-propagation with inheritance).
  if (expr.kind === "variable" && !solved.has(expr.name)) {
    solved.set(expr.name, dim);
    hooks.progress();
  }
}

// ---------------------------------------------------------------------------
// Serialization (data-only, validated, recompiled on load)
// ---------------------------------------------------------------------------

export interface SerializedFormula {
  readonly version: 1;
  readonly type: "formula";
  readonly id: string;
  readonly expression: unknown;
  readonly inputs: Readonly<
    Record<string, { dimension: unknown; kind?: unknown; optional?: unknown; default?: unknown }>
  >;
  readonly outputName?: string;
  readonly outputUnit?: string;
  readonly expectedDimension?: unknown;
  readonly expectedKind?: string;
  readonly constants?: Readonly<Record<string, unknown>>;
  /** ScientificConstant provenance refs {name: {id, version, namespace?}}. */
  readonly constantRefs?: Readonly<
    Record<string, { id: unknown; version: unknown; namespace?: unknown }>
  >;
  readonly description?: string;
  readonly formulaVersion?: number;
}

function hasPollutionKey(obj: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
    Object.prototype.hasOwnProperty.call(obj, "constructor") ||
    Object.prototype.hasOwnProperty.call(obj, "prototype")
  );
}

/** Serialize a formula definition (AST + declarations + constant refs; no functions, no code). */
export function serializeFormula(definition: Formula): SerializedFormula {
  const inputs: Record<string, { dimension: unknown; kind?: unknown; optional?: unknown }> = {};
  for (const [name, decl] of Object.entries(definition.inputs)) {
    inputs[name] = {
      dimension: decl.dimension,
      ...(decl.kind !== undefined ? { kind: decl.kind } : {}),
      ...(decl.optional === true ? { optional: true } : {}),
    };
  }
  const constantRefs: Record<string, { id: string; version: number; namespace?: string }> = {};
  for (const [name, ref] of Object.entries(definition.constantRefs)) {
    constantRefs[name] = {
      id: ref.id,
      version: ref.version,
      ...(ref.namespace !== undefined ? { namespace: ref.namespace } : {}),
    };
  }
  return Object.freeze({
    version: 1 as const,
    type: "formula" as const,
    id: definition.id,
    expression: (serializeExpression(definition.expression) as { root: unknown }).root,
    inputs: Object.freeze(inputs),
    ...(Object.keys(constantRefs).length > 0 ? { constantRefs: Object.freeze(constantRefs) } : {}),
    ...(definition.outputName !== undefined ? { outputName: definition.outputName } : {}),
    ...(definition.outputUnit !== undefined ? { outputUnit: definition.outputUnit } : {}),
    ...(definition.expectedDimension !== undefined
      ? { expectedDimension: definition.expectedDimension }
      : {}),
    ...(definition.expectedKind !== undefined ? { expectedKind: definition.expectedKind } : {}),
    ...(definition.description !== undefined ? { description: definition.description } : {}),
    formulaVersion: definition.version,
  });
}

/**
 * Deserialize + revalidate + return a definition (recompile via
 * compileFormula). Plain constants/defaults are NOT serialized (they may
 * hold live Quantities) — re-supply them to defineFormula if needed.
 * ScientificConstant refs ARE serialized and resolved here via
 * opts.constantRegistry, with a version-match reproducibility gate: a
 * registry holding a different constant version fails explicitly instead
 * of silently computing with different data.
 */
export function deserializeFormula(data: unknown, opts: DefineFormulaOptions = {}): Formula {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new FormulaError("?", "malformed serialized formula: expected an object");
  }
  const obj = data as Record<string, unknown>;
  if (hasPollutionKey(obj)) {
    throw new FormulaError("?", "malformed serialized formula: forbidden prototype keys");
  }
  if (obj.version !== 1) {
    if (obj.version === undefined)
      throw new FormulaError("?", "serialized formula missing version");
    throw new FormulaError("?", `unsupported serialized formula version ${String(obj.version)}`);
  }
  if (obj.type !== "formula") {
    throw new FormulaError("?", `serialized formula has wrong type "${String(obj.type)}"`);
  }
  if (typeof obj.id !== "string") {
    throw new FormulaError("?", "serialized formula missing id");
  }
  if (obj.inputs === null || typeof obj.inputs !== "object" || Array.isArray(obj.inputs)) {
    throw new FormulaError(obj.id, "serialized formula inputs must be an object");
  }
  const inputsRecord = obj.inputs as Record<string, unknown>;
  if (hasPollutionKey(inputsRecord)) {
    throw new FormulaError(obj.id, "serialized formula inputs contain forbidden keys");
  }
  const inputs: Record<string, FormulaInputDeclaration> = {};
  for (const [name, raw] of Object.entries(inputsRecord)) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new FormulaError(obj.id, `serialized input "${name}" must be an object`);
    }
    const decl = raw as Record<string, unknown>;
    if (hasPollutionKey(decl)) {
      throw new FormulaError(obj.id, `serialized input "${name}" contains forbidden keys`);
    }
    const dimension = decl.dimension;
    if (typeof dimension !== "string" && (typeof dimension !== "object" || dimension === null)) {
      throw new FormulaError(obj.id, `serialized input "${name}" needs a dimension`);
    }
    inputs[name] = {
      dimension: dimension as DimensionVector | string,
      ...(typeof decl.kind === "string" ? { kind: decl.kind } : {}),
      ...(decl.optional === true ? { optional: true } : {}),
    };
  }
  // Resolve ScientificConstant refs (reproducibility-gated on id + version).
  const constants: Record<string, ScientificConstant> = {};
  if (obj.constantRefs !== undefined) {
    if (
      obj.constantRefs === null ||
      typeof obj.constantRefs !== "object" ||
      Array.isArray(obj.constantRefs)
    ) {
      throw new FormulaError(obj.id, "serialized formula constantRefs must be an object");
    }
    const refsRecord = obj.constantRefs as Record<string, unknown>;
    if (hasPollutionKey(refsRecord)) {
      throw new FormulaError(obj.id, "serialized formula constantRefs contains forbidden keys");
    }
    if (opts.constantRegistry === undefined) {
      throw new FormulaError(
        obj.id,
        "serialized formula references constants but no constantRegistry was provided",
      );
    }
    for (const [name, raw] of Object.entries(refsRecord)) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new FormulaError(obj.id, `serialized constant ref "${name}" must be an object`);
      }
      const ref = raw as Record<string, unknown>;
      if (typeof ref.id !== "string") {
        throw new FormulaError(obj.id, `serialized constant ref "${name}" needs an id string`);
      }
      const qualified = typeof ref.namespace === "string" ? `${ref.namespace}:${ref.id}` : ref.id;
      let resolved: ScientificConstant;
      try {
        resolved = opts.constantRegistry.require(qualified);
      } catch (error) {
        throw new FormulaError(
          obj.id,
          `cannot resolve constant ref "${name}" (${qualified}): ${(error as Error).message}`,
        );
      }
      if (ref.version !== undefined && ref.version !== resolved.version) {
        throw new FormulaError(
          obj.id,
          `constant ref "${name}" pins ${ref.id}@v${String(ref.version)} but registry holds v${resolved.version} (reproducibility gate: pass a matching snapshot)`,
        );
      }
      constants[name] = resolved;
    }
  }
  return defineFormula(
    {
      id: obj.id,
      expression: deserializeExpression(
        { version: 1, type: "expression", root: obj.expression },
        opts.limits,
      ),
      inputs,
      constants,
      ...(typeof obj.outputName === "string" ? { outputName: obj.outputName } : {}),
      ...(typeof obj.outputUnit === "string" ? { outputUnit: obj.outputUnit } : {}),
      ...(obj.expectedDimension !== undefined
        ? { expectedDimension: obj.expectedDimension as DimensionVector | string }
        : {}),
      ...(typeof obj.expectedKind === "string" ? { expectedKind: obj.expectedKind } : {}),
      ...(typeof obj.description === "string" ? { description: obj.description } : {}),
      ...(typeof obj.formulaVersion === "number" ? { version: obj.formulaVersion } : {}),
    },
    opts,
  );
}

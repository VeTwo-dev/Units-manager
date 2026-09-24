/**
 * function-registry.ts
 * -----------------------------------------------------------------------
 * Single responsibility: the SAFE function registry for formula
 * expressions (Phase 24.17/24.18).
 *
 * Trust boundary (read carefully):
 * - Formula AUTHORS (untrusted) may only reference functions BY NAME inside
 *   declarative ASTs. Names are validated; unknown names throw.
 * - Function IMPLEMENTATIONS are registered by the HOST application
 *   (trusted code) via register(). The core seeds only generic scientific
 *   functions whose evaluators delegate to Quantity methods — dimensional
 *   rules are therefore enforced twice (registry declaration + Quantity).
 * - No eval/Function/dynamic import anywhere. Serialized formulas carry
 *   names, never code; deserialization resolves names against a registry.
 *
 * Each function declares: name, arity range, evaluator, dimension rule
 * (used by static inference without numeric values), and an optional
 * semantic-kind gate (`requiresKind`, enforced by the formula layer when a
 * non-dimensional policy is active — e.g. sin wants kind "angle").
 * -----------------------------------------------------------------------
 */
import {
  dimensionsEqual,
  isDimensionless,
  powDim,
  rootDim,
  type DimensionVector,
} from "./dimension.js";
import type { Quantity } from "./quantity.js";
import { ExpressionError } from "./errors/index.js";

export interface ScientificFunction {
  /** Function name referenced from ASTs (e.g. "sqrt"). */
  readonly name: string;
  /** Minimum argument count (inclusive). */
  readonly minArity: number;
  /** Maximum argument count (inclusive). */
  readonly maxArity: number;
  /** Human description (no behavior). */
  readonly description?: string;
  /**
   * Alternate names resolving to this function (e.g. ["arcsin"]).
   * Aliases are data-only references — never separate implementations.
   */
  readonly aliases?: readonly string[];
  /**
   * Semantic kind every argument must satisfy under a non-dimensional
   * policy (e.g. "angle" for sin/cos/tan). Dimensional rules always apply.
   */
  readonly requiresKind?: string;
  /**
   * Declared output semantic kind (metadata for diagnostics and formula
   * validation; e.g. a "bearing" function could declare "angle").
   * Data only — never changes numeric behavior.
   */
  readonly outputKind?: string;
  /** Host-trusted evaluator (core seeds delegate to Quantity methods). */
  evaluate(args: readonly Quantity[]): Quantity;
  /** Static dimension rule (no numeric evaluation). */
  inferDimension(argDims: readonly DimensionVector[]): DimensionVector;
}

const FUNCTION_NAME_RE = /^[a-z][a-z0-9_]*$/;

export class FunctionRegistry {
  private readonly functions = new Map<string, ScientificFunction>();
  /** Alias → canonical name. Aliases resolve to the same frozen definition. */
  private readonly aliases = new Map<string, string>();
  /** Monotonic version: caches scope entries to a generation (see compileExpression). */
  private generation = 0;

  constructor(seed: readonly ScientificFunction[] = defaultScientificFunctions()) {
    for (const fn of seed) this.register(fn);
  }

  get version(): number {
    return this.generation;
  }

  register(fn: ScientificFunction): void {
    if (!fn || typeof fn !== "object" || Array.isArray(fn)) {
      throw new ExpressionError("Function definition must be a plain object.");
    }
    if (typeof fn.name !== "string" || !FUNCTION_NAME_RE.test(fn.name)) {
      throw new ExpressionError(
        `Invalid function name "${String(fn.name)}" (expected /^[a-z][a-z0-9_]*$/).`,
      );
    }
    if (this.functions.has(fn.name) || this.aliases.has(fn.name)) {
      throw new ExpressionError(
        `Function "${fn.name}" collides with a registered function or alias.`,
      );
    }
    if (!Number.isInteger(fn.minArity) || fn.minArity < 0) {
      throw new ExpressionError(`Function "${fn.name}" needs an integer minArity >= 0.`);
    }
    if (!Number.isInteger(fn.maxArity) || fn.maxArity < fn.minArity) {
      throw new ExpressionError(`Function "${fn.name}" needs an integer maxArity >= minArity.`);
    }
    if (typeof fn.evaluate !== "function" || typeof fn.inferDimension !== "function") {
      throw new ExpressionError(
        `Function "${fn.name}" needs evaluate and inferDimension implementations.`,
      );
    }
    if (fn.requiresKind !== undefined && typeof fn.requiresKind !== "string") {
      throw new ExpressionError(`Function "${fn.name}" requiresKind must be a string.`);
    }
    if (fn.outputKind !== undefined && typeof fn.outputKind !== "string") {
      throw new ExpressionError(`Function "${fn.name}" outputKind must be a string.`);
    }
    const aliases = fn.aliases ?? [];
    if (
      !Array.isArray(aliases) ||
      aliases.some((a) => typeof a !== "string" || !FUNCTION_NAME_RE.test(a))
    ) {
      throw new ExpressionError(
        `Function "${fn.name}" aliases must be an array of valid function names.`,
      );
    }
    for (const alias of aliases) {
      if (alias === fn.name) {
        throw new ExpressionError(`Function "${fn.name}" cannot alias itself.`);
      }
      if (this.functions.has(alias) || this.aliases.has(alias)) {
        throw new ExpressionError(
          `Function alias "${alias}" collides with an existing function or alias.`,
        );
      }
    }
    this.functions.set(fn.name, Object.freeze({ ...fn, aliases: Object.freeze([...aliases]) }));
    for (const alias of aliases) this.aliases.set(alias, fn.name);
    this.generation++;
  }

  /** Canonical name for a function or alias (undefined when unknown). */
  canonicalName(name: string): string | undefined {
    if (this.functions.has(name)) return name;
    return this.aliases.get(name);
  }

  has(name: string): boolean {
    return this.functions.has(name) || this.aliases.has(name);
  }

  require(name: string): ScientificFunction {
    const canonical = this.functions.has(name) ? name : this.aliases.get(name);
    const fn = canonical === undefined ? undefined : this.functions.get(canonical);
    if (!fn) throw new ExpressionError(`Unknown function "${name}".`);
    return fn;
  }

  list(): readonly string[] {
    return [...this.functions.keys()].sort();
  }

  /** Alias → canonical name pairs, sorted for determinism. */
  listAliases(): ReadonlyArray<readonly [string, string]> {
    return Object.freeze(
      [...this.aliases.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([alias, target]) => Object.freeze([alias, target]) as readonly [string, string]),
    );
  }

  /**
   * Immutable snapshot: a detached registry sharing the frozen definitions.
   * Later registrations on either side stay isolated. The generation
   * restarts at the snapshot size (a new generation line — caches keyed by
   * registry identity stay correct because the snapshot is a new object).
   */
  snapshot(): FunctionRegistry {
    const snap = new FunctionRegistry([]);
    for (const [name, fn] of this.functions) snap.functions.set(name, fn);
    for (const [alias, target] of this.aliases) snap.aliases.set(alias, target);
    snap.generation = this.functions.size;
    return snap;
  }

  /** Arity-checked invocation (used by evaluators, never by formula text). */
  call(name: string, args: readonly Quantity[]): Quantity {
    const fn = this.require(name);
    if (args.length < fn.minArity || args.length > fn.maxArity) {
      throw new ExpressionError(
        `Function "${name}" expects ${fn.minArity === fn.maxArity ? `${fn.minArity}` : `${fn.minArity}..${fn.maxArity}`} argument(s), got ${args.length}.`,
      );
    }
    return fn.evaluate(args);
  }

  /** Arity-checked static dimension inference. */
  infer(name: string, argDims: readonly DimensionVector[]): DimensionVector {
    const fn = this.require(name);
    if (argDims.length < fn.minArity || argDims.length > fn.maxArity) {
      throw new ExpressionError(
        `Function "${name}" expects ${fn.minArity === fn.maxArity ? `${fn.minArity}` : `${fn.minArity}..${fn.maxArity}`} argument(s), got ${argDims.length}.`,
      );
    }
    return fn.inferDimension(argDims);
  }
}

function unary(name: string, description: string): { name: string; description: string } {
  return { name, description };
}

function dimensionlessOf(fnName: string, argDims: readonly DimensionVector[]): DimensionVector {
  if (argDims.length !== 1 || !isDimensionless(argDims[0]!)) {
    throw new ExpressionError(
      `Function "${fnName}" requires one dimensionless argument (radians convention for trig).`,
    );
  }
  return {};
}

/** Seed: generic scientific functions only (no domain functions, ever). */
function defaultScientificFunctions(): readonly ScientificFunction[] {
  const defs: ScientificFunction[] = [
    {
      ...unary(
        "sqrt",
        "Square root (exact dimensions only; rejects negatives/affine via Quantity).",
      ),
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.sqrt(),
      inferDimension: (dims) => rootDim(dims[0]!, 2),
    },
    {
      ...unary("cbrt", "Cube root (exact dimensions only)."),
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.cbrt(),
      inferDimension: (dims) => rootDim(dims[0]!, 3),
    },
    {
      ...unary("abs", "Absolute value (unit preserved)."),
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.abs(),
      inferDimension: (dims) => dims[0]!,
    },
    {
      ...unary("negate", "Arithmetic negation (unit preserved)."),
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.negate(),
      inferDimension: (dims) => dims[0]!,
    },
    {
      ...unary("reciprocal", "Multiplicative inverse (dimension inverted)."),
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.reciprocal(),
      inferDimension: (dims) => powDim(dims[0]!, -1),
    },
    {
      name: "min",
      description: "Minimum by base value (same dimension required).",
      minArity: 2,
      maxArity: 2,
      evaluate: (args) => args[0]!.min(args[1]!),
      inferDimension: (dims) => {
        if (!dimensionsEqual(dims[0]!, dims[1]!)) {
          throw new ExpressionError('Function "min" requires dimensionally compatible arguments.');
        }
        return dims[0]!;
      },
    },
    {
      name: "max",
      description: "Maximum by base value (same dimension required).",
      minArity: 2,
      maxArity: 2,
      evaluate: (args) => args[0]!.max(args[1]!),
      inferDimension: (dims) => {
        if (!dimensionsEqual(dims[0]!, dims[1]!)) {
          throw new ExpressionError('Function "max" requires dimensionally compatible arguments.');
        }
        return dims[0]!;
      },
    },
    {
      ...unary("exp", "Exponential (dimensionless only)."),
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.exp(),
      inferDimension: (dims) => dimensionlessOf("exp", dims),
    },
    {
      ...unary("ln", "Natural logarithm (dimensionless only)."),
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.ln(),
      inferDimension: (dims) => dimensionlessOf("ln", dims),
    },
    {
      ...unary("log10", "Base-10 logarithm (dimensionless only)."),
      minArity: 1,
      maxArity: 1,
      evaluate: (args) => args[0]!.log10(),
      inferDimension: (dims) => dimensionlessOf("log10", dims),
    },
    {
      ...unary("sin", "Sine (dimensionless radians; kind-gated to angle by the formula layer)."),
      minArity: 1,
      maxArity: 1,
      requiresKind: "angle",
      evaluate: (args) => args[0]!.sin(),
      inferDimension: (dims) => dimensionlessOf("sin", dims),
    },
    {
      ...unary("cos", "Cosine (dimensionless radians; kind-gated to angle by the formula layer)."),
      minArity: 1,
      maxArity: 1,
      requiresKind: "angle",
      evaluate: (args) => args[0]!.cos(),
      inferDimension: (dims) => dimensionlessOf("cos", dims),
    },
    {
      ...unary("tan", "Tangent (dimensionless radians; kind-gated to angle by the formula layer)."),
      minArity: 1,
      maxArity: 1,
      requiresKind: "angle",
      evaluate: (args) => args[0]!.tan(),
      inferDimension: (dims) => dimensionlessOf("tan", dims),
    },
  ];
  return defs;
}

export const defaultFunctionRegistry = new FunctionRegistry();

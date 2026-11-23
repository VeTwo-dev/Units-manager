/**
 * unit-algebra.ts
 * -----------------------------------------------------------------------
 * Single responsibility: FIRST-CLASS structural unit algebra (Phase 23).
 *
 * The unit parser flattens `kg·m/s²` into (dimension, scale) — correct for
 * conversion, but structure is lost: `N` and `kg·m/s²` become
 * indistinguishable, and relationships like `Pa = N/m²` cannot be reasoned
 * about. This module adds the missing structural layer WITHOUT replacing
 * anything:
 *
 * - `UnitExpr`: immutable AST (atom / multiply / divide / power / one).
 *   Atoms wrap registry-resolved Units, so prefixes, aliases and validation
 *   are reused, never reimplemented.
 * - Canonicalization: factor collection, exponent aggregation, zero-exponent
 *   elimination, deterministic ordering, cancellation — all with INTEGER
 *   exponents (no float approximations, ever).
 * - Derived units: named relationships (`N → kg·m/s²`) as data; display
 *   intent (`N`) is preserved separately from canonical identity.
 * - Equivalence: same dimension AND same scale (tolerance-documented),
 *   plus affine/nonlinear/kind/basis guards — never "same dimension =
 *   interchangeable".
 * - Dimension/scale inference without any numeric quantity involved.
 * - Versioned serialization, interning, and hardened limits.
 *
 * Rational powers: the engine dimension model is integer-exponent, so
 * fractional dimensions are NOT introduced. `rootUnitExpr` supports only
 * exact roots (sqrt(m²) → m; sqrt(m) throws) — explicit and safe.
 * -----------------------------------------------------------------------
 */
import {
  dimensionsEqual,
  isDimensionless,
  multiplyDim,
  powDim,
  type DimensionVector,
} from "./dimension.js";
import { makeUnit, type Unit } from "./unit.js";
import { defaultUnitRegistry, type UnitRegistry } from "./unit-registry.js";
import { linearScaleOf } from "./conversion-engine.js";
import { createRegistry } from "./unit-system.js";
import { SI_PACK } from "./packs/si.js";
import { areKindsCompatible, type SemanticPolicy } from "./quantity-kind.js";
import { ExpressionError, ExpressionLimitError, UnitEngineError } from "./errors/index.js";

// ---------------------------------------------------------------------------
// AST (immutable, frozen at construction)
// ---------------------------------------------------------------------------

export interface AtomNode {
  readonly kind: "atom";
  readonly unit: Unit;
}

export interface OneNode {
  readonly kind: "one";
}

export interface MulNode {
  readonly kind: "mul";
  readonly left: UnitExpr;
  readonly right: UnitExpr;
}

export interface DivNode {
  readonly kind: "div";
  readonly numerator: UnitExpr;
  readonly denominator: UnitExpr;
}

export interface PowNode {
  readonly kind: "pow";
  readonly base: UnitExpr;
  readonly exponent: number;
}

export type UnitExpr = AtomNode | OneNode | MulNode | DivNode | PowNode;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export interface UnitAlgebraLimits {
  /** Maximum input text length for parseUnitExpression (default 512). */
  readonly maxExpressionLength?: number;
  /** Maximum AST nodes (default 512). */
  readonly maxAstNodes?: number;
  /** Maximum AST depth (default 32). */
  readonly maxDepth?: number;
  /** Maximum |power exponent| (default 1000). */
  readonly maxExponent?: number;
  /** Maximum derived-unit expansion depth (default 16). */
  readonly maxDerivedExpansionDepth?: number;
}

export const DEFAULT_UALGEBRA_LIMITS = Object.freeze({
  maxExpressionLength: 512,
  maxAstNodes: 512,
  maxDepth: 32,
  maxExponent: 1000,
  maxDerivedExpansionDepth: 16,
});

function resolveLimits(limits?: UnitAlgebraLimits): {
  maxExpressionLength: number;
  maxAstNodes: number;
  maxDepth: number;
  maxExponent: number;
  maxDerivedExpansionDepth: number;
} {
  const r = {
    maxExpressionLength: limits?.maxExpressionLength ?? DEFAULT_UALGEBRA_LIMITS.maxExpressionLength,
    maxAstNodes: limits?.maxAstNodes ?? DEFAULT_UALGEBRA_LIMITS.maxAstNodes,
    maxDepth: limits?.maxDepth ?? DEFAULT_UALGEBRA_LIMITS.maxDepth,
    maxExponent: limits?.maxExponent ?? DEFAULT_UALGEBRA_LIMITS.maxExponent,
    maxDerivedExpansionDepth:
      limits?.maxDerivedExpansionDepth ?? DEFAULT_UALGEBRA_LIMITS.maxDerivedExpansionDepth,
  };
  for (const [k, v] of Object.entries(r)) {
    if (!Number.isInteger(v) || v < 1) {
      throw new ExpressionLimitError(`Unit algebra limit ${k} must be a positive integer.`);
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Builders (validate eagerly, freeze)
// ---------------------------------------------------------------------------

function freeze<T extends object>(node: T): T {
  return Object.freeze(node);
}

function assertUnitExpr(value: unknown, what = "unit expression"): asserts value is UnitExpr {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ExpressionError(`Invalid ${what}: expected a unit expression node.`);
  }
  const kind = (value as Record<string, unknown>).kind;
  if (kind !== "atom" && kind !== "one" && kind !== "mul" && kind !== "div" && kind !== "pow") {
    throw new ExpressionError(`Invalid ${what}: unknown node kind "${String(kind)}".`);
  }
}

/** Leaf wrapping a resolved Unit (prefixes/aliases already handled by the registry). */
export function atom(unit: Unit): UnitExpr {
  if (!unit || typeof unit !== "object" || typeof unit.symbol !== "string") {
    throw new ExpressionError("Unit atom requires a resolved Unit.");
  }
  return freeze({ kind: "atom", unit } as AtomNode);
}

/** The dimensionless identity. */
export function one(): UnitExpr {
  return freeze({ kind: "one" } as OneNode);
}

export function multiplyUnits(a: UnitExpr, b: UnitExpr): UnitExpr {
  assertUnitExpr(a, "left operand");
  assertUnitExpr(b, "right operand");
  return freeze({ kind: "mul", left: a, right: b } as MulNode);
}

export function divideUnits(a: UnitExpr, b: UnitExpr): UnitExpr {
  assertUnitExpr(a, "numerator");
  assertUnitExpr(b, "denominator");
  return freeze({ kind: "div", numerator: a, denominator: b } as DivNode);
}

/** Integer power (mirrors Quantity.pow — fractional powers are not representable). */
export function powUnitExpr(base: UnitExpr, exponent: number): UnitExpr {
  assertUnitExpr(base, "power base");
  if (!Number.isInteger(exponent)) {
    throw new ExpressionError(`Unit power exponent must be an integer, got ${String(exponent)}.`);
  }
  return freeze({ kind: "pow", base, exponent } as PowNode);
}

/** Reciprocal: 1/expr. */
export function reciprocalUnitExpr(expr: UnitExpr): UnitExpr {
  assertUnitExpr(expr, "reciprocal operand");
  return freeze({ kind: "div", numerator: one(), denominator: expr } as DivNode);
}

/**
 * Exact root (sqrt(m²) → m). Every collected exponent must be exactly
 * divisible by `degree` — otherwise throws (sqrt(m) is NOT m).
 */
export function rootUnitExpr(expr: UnitExpr, degree: number): UnitExpr {
  assertUnitExpr(expr, "root operand");
  if (!Number.isInteger(degree) || degree <= 0) {
    throw new ExpressionError(`Root degree must be a positive integer, got ${String(degree)}.`);
  }
  const norm = normalizeUnitExpr(expr);
  const factors = norm.factors.map((f) => {
    if (f.exponent % degree !== 0) {
      throw new ExpressionError(
        `Inexact root: exponent ${f.exponent} of "${f.unit.symbol}" is not divisible by ${degree}.`,
      );
    }
    return { unit: f.unit, exponent: f.exponent / degree };
  });
  return denormalize(factors);
}

// ---------------------------------------------------------------------------
// Structural validation (iterative; counts nodes, checks depth/exponents)
// ---------------------------------------------------------------------------

function validateUnitExpr(root: UnitExpr, limits: ReturnType<typeof resolveLimits>): number {
  assertUnitExpr(root, "root unit expression");
  let count = 0;
  const stack: Array<{ node: UnitExpr; depth: number }> = [{ node: root, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > limits.maxDepth) {
      throw new ExpressionLimitError(`Unit expression exceeds maxDepth ${limits.maxDepth}.`);
    }
    if (++count > limits.maxAstNodes) {
      throw new ExpressionLimitError(`Unit expression exceeds maxAstNodes ${limits.maxAstNodes}.`);
    }
    assertUnitExpr(node, "unit expression node");
    switch (node.kind) {
      case "atom":
      case "one":
        break;
      case "mul":
        stack.push({ node: node.left, depth: depth + 1 });
        stack.push({ node: node.right, depth: depth + 1 });
        break;
      case "div":
        stack.push({ node: node.numerator, depth: depth + 1 });
        stack.push({ node: node.denominator, depth: depth + 1 });
        break;
      case "pow":
        if (!Number.isInteger(node.exponent)) {
          throw new ExpressionError("Unit power exponent must be an integer.");
        }
        if (Math.abs(node.exponent) > limits.maxExponent) {
          throw new ExpressionLimitError(
            `Unit power exponent |${node.exponent}| exceeds maxExponent ${limits.maxExponent}.`,
          );
        }
        stack.push({ node: node.base, depth: depth + 1 });
        break;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Canonicalization: normalized factor map (integer exponents, sorted)
// ---------------------------------------------------------------------------

export interface NormalizedFactor {
  readonly unit: Unit;
  readonly exponent: number;
}

export interface NormalizedUnitExpr {
  /** Sorted by unit id; zero exponents eliminated; the empty list is dimensionless 1. */
  readonly factors: readonly NormalizedFactor[];
  /** Deterministic canonical key (`id^exp` joined, or "1"). */
  readonly key: string;
}

const internCache = new Map<string, NormalizedUnitExpr>();
const MAX_INTERN = 500;

function factorKey(unit: Unit): string {
  return `${unit.id}|${unit.basis ?? ""}`;
}

/**
 * Normalize: collect atoms with signs, aggregate exponents per unit,
 * eliminate zeros, sort deterministically. Merging is by unit IDENTITY
 * (id + basis) — `N` and `kg·m/s²` keep distinct factors (display intent
 * preserved); their equivalence is answered by equivalentUnits(), not by
 * collapsing structure.
 */
export function normalizeUnitExpr(expr: UnitExpr, limits?: UnitAlgebraLimits): NormalizedUnitExpr {
  const resolved = resolveLimits(limits);
  validateUnitExpr(expr, resolved);
  // Collect (unit, signedExponent) pairs iteratively.
  const collected: Array<{ unit: Unit; exponent: number }> = [];
  const stack: Array<{ node: UnitExpr; sign: number }> = [{ node: expr, sign: 1 }];
  while (stack.length > 0) {
    const { node, sign } = stack.pop()!;
    switch (node.kind) {
      case "atom":
        collected.push({ unit: node.unit, exponent: sign });
        break;
      case "one":
        break;
      case "mul":
        stack.push({ node: node.left, sign });
        stack.push({ node: node.right, sign });
        break;
      case "div":
        stack.push({ node: node.numerator, sign });
        stack.push({ node: node.denominator, sign: -sign });
        break;
      case "pow":
        if (node.exponent === 0) break; // x^0 → 1 (contributes nothing)
        stack.push({ node: node.base, sign: sign * node.exponent });
        break;
    }
  }
  // Aggregate by unit identity.
  const merged = new Map<string, { unit: Unit; exponent: number }>();
  for (const { unit, exponent } of collected) {
    const key = factorKey(unit);
    const existing = merged.get(key);
    if (existing) existing.exponent += exponent;
    else merged.set(key, { unit, exponent });
  }
  const factors = [...merged.values()]
    .filter((f) => f.exponent !== 0)
    .sort((a, b) =>
      factorKey(a.unit) < factorKey(b.unit) ? -1 : factorKey(a.unit) > factorKey(b.unit) ? 1 : 0,
    )
    .map((f) => Object.freeze({ unit: f.unit, exponent: f.exponent }));
  const key =
    factors.length === 0 ? "1" : factors.map((f) => `${factorKey(f.unit)}^${f.exponent}`).join("·");
  const cached = internCache.get(key);
  if (cached) return cached;
  const normalized: NormalizedUnitExpr = Object.freeze({ factors: Object.freeze(factors), key });
  if (internCache.size >= MAX_INTERN) {
    const first = internCache.keys().next().value as string | undefined;
    if (first !== undefined) internCache.delete(first);
  }
  internCache.set(key, normalized);
  return normalized;
}

/** Rebuild a (non-minimal but valid) UnitExpr from normalized factors. */
function denormalize(factors: readonly { unit: Unit; exponent: number }[]): UnitExpr {
  let out: UnitExpr = one();
  for (const f of factors) {
    out = multiplyUnits(out, powUnitExpr(atom(f.unit), f.exponent));
  }
  return out;
}

/** Simplify = normalize then rebuild (cancellation applied, structure preserved). */
export function simplifyUnitExpr(expr: UnitExpr, limits?: UnitAlgebraLimits): UnitExpr {
  return denormalize(normalizeUnitExpr(expr, limits).factors);
}

/** Canonical key for equality, caching, memoization and registry lookup. */
export function unitExprKey(expr: UnitExpr, limits?: UnitAlgebraLimits): string {
  return normalizeUnitExpr(expr, limits).key;
}

// ---------------------------------------------------------------------------
// Dimension & scale inference (no numeric quantity involved)
// ---------------------------------------------------------------------------

/** Reject atoms the algebra cannot treat multiplicatively (affine/log/custom). */
function requireAlgebraicAtom(unit: Unit, what: string): void {
  if (unit.conversion.kind !== "linear") {
    throw new ExpressionError(
      `Unit algebra cannot ${what} "${unit.symbol}" (${unit.conversion.kind} conversion): ` +
        `affine and nonlinear units are not multiplicative scales.`,
    );
  }
}

/** Combined dimension of an expression (integer-exponent algebra). */
export function dimensionOfUnitExpr(expr: UnitExpr, limits?: UnitAlgebraLimits): DimensionVector {
  const norm = normalizeUnitExpr(expr, limits);
  let dim: DimensionVector = {};
  for (const f of norm.factors) {
    requireAlgebraicAtom(f.unit, "combine dimensions of");
    // Exponents are integers by construction (validated at build time).
    dim = multiplyDim(dim, powDim(f.unit.dimension, f.exponent));
  }
  return dim;
}

/**
 * Combined scale to canonical base units (product of scale^exponent).
 * Linear atoms only — affine/logarithmic/custom throw explicitly.
 */
export function scaleOfUnitExpr(expr: UnitExpr, limits?: UnitAlgebraLimits): number {
  const norm = normalizeUnitExpr(expr, limits);
  let scale = 1;
  for (const f of norm.factors) {
    requireAlgebraicAtom(f.unit, "scale");
    const s = Math.pow(linearScaleOf(f.unit), f.exponent);
    if (!Number.isFinite(s) || s === 0) {
      throw new ExpressionError(`Unit algebra produced a non-finite scale for "${f.unit.symbol}".`);
    }
    scale *= s;
  }
  if (!Number.isFinite(scale) || scale === 0) {
    throw new ExpressionError("Unit algebra produced a non-finite combined scale.");
  }
  return scale;
}

// ---------------------------------------------------------------------------
// Equivalence (structural + metrological, never dimension-only)
// ---------------------------------------------------------------------------

const EQUIVALENCE_REL_TOL = 1e-12;

/**
 * True structural/metrological equivalence: same dimension AND same scale
 * (relative tolerance 1e-12 for chained float constants — documented; the
 * ALGEBRA (exponents, ordering) stays exact). Additionally requires:
 * same affine-ness, same conversion kind, same basis, and — unless
 * `ignoreKind` — compatible semantic kinds under the given policy.
 */
export function equivalentUnits(
  a: UnitExpr,
  b: UnitExpr,
  opts: {
    limits?: UnitAlgebraLimits;
    ignoreKind?: boolean;
    semanticPolicy?: SemanticPolicy;
  } = {},
): boolean {
  const normA = normalizeUnitExpr(a, opts.limits);
  const normB = normalizeUnitExpr(b, opts.limits);
  if (normA.key === normB.key) return true; // identical structure (fast path)
  // A predicate, not a thrower: non-algebraic atoms (affine/nonlinear) or
  // dimension mismatches mean "not equivalent". Limit violations still throw.
  let dimA: DimensionVector;
  let dimB: DimensionVector;
  let scaleA: number;
  let scaleB: number;
  try {
    dimA = dimensionOfUnitExpr(a, opts.limits);
    dimB = dimensionOfUnitExpr(b, opts.limits);
    if (!dimensionsEqual(dimA, dimB)) return false;
    scaleA = scaleOfUnitExpr(a, opts.limits);
    scaleB = scaleOfUnitExpr(b, opts.limits);
  } catch (error) {
    if (error instanceof ExpressionLimitError) throw error;
    return false;
  }
  const denom = Math.max(Math.abs(scaleA), Math.abs(scaleB), 1);
  if (Math.abs(scaleA - scaleB) / denom > EQUIVALENCE_REL_TOL) return false;
  // Basis must match (DM vs asFed never silently equated). Compared as
  // multisets of claimed bases so different factor arities (N vs kg·m/s²)
  // still compare correctly when neither claims a basis.
  const basisA = normA.factors
    .map((f) => f.unit.basis ?? "")
    .filter((b) => b !== "")
    .sort();
  const basisB = normB.factors
    .map((f) => f.unit.basis ?? "")
    .filter((b) => b !== "")
    .sort();
  if (JSON.stringify(basisA) !== JSON.stringify(basisB)) return false;
  if (opts.ignoreKind === true) return true;
  // Semantic kinds: every factor pair compared positionally is overkill;
  // compare the SETS of claimed kinds for equality under the policy.
  const kindsA = normA.factors.map((f) => f.unit.metadata?.kind).filter((k) => k !== undefined);
  const kindsB = normB.factors.map((f) => f.unit.metadata?.kind).filter((k) => k !== undefined);
  if (kindsA.length === 0 && kindsB.length === 0) return true;
  if (kindsA.length !== kindsB.length) return false;
  const sortedA = [...kindsA].sort();
  const sortedB = [...kindsB].sort();
  const policy = opts.semanticPolicy ?? "semantic-aware";
  return sortedA.every((k, i) => areKindsCompatible(k, sortedB[i], policy));
}

// ---------------------------------------------------------------------------
// Materialization: expression → executable Unit
// ---------------------------------------------------------------------------

/**
 * Materialize an expression as a real Unit (for conversion/evaluation).
 * Linear atoms only. The symbol is the canonical rendering; use
 * formatUnitExpr for display control.
 */
export function toUnit(expr: UnitExpr, limits?: UnitAlgebraLimits): Unit {
  const norm = normalizeUnitExpr(expr, limits);
  if (norm.factors.length === 0) {
    return makeUnit({ symbol: "1", dimension: {}, toBaseFactor: 1, label: "dimensionless" });
  }
  const dim = dimensionOfUnitExpr(expr, limits);
  const scale = scaleOfUnitExpr(expr, limits);
  return makeUnit({
    symbol: formatUnitExpr(expr, { style: "unicode" }),
    dimension: isDimensionless(dim) ? {} : dim,
    toBaseFactor: scale,
    label: formatUnitExpr(expr, { style: "ascii" }),
  });
}

// ---------------------------------------------------------------------------
// Rendering (deterministic ordering, numerator/denominator, named units)
// ---------------------------------------------------------------------------

export interface FormatUnitExprOptions {
  readonly style?: "unicode" | "ascii";
  readonly limits?: UnitAlgebraLimits;
}

const SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
};

function renderExponent(exp: number, style: "unicode" | "ascii"): string {
  if (style === "ascii") return `^${exp}`;
  return String(exp)
    .split("")
    .map((ch) => SUPERSCRIPT_MAP[ch] ?? ch)
    .join("");
}

function renderFactor(symbol: string, exp: number, style: "unicode" | "ascii"): string {
  if (exp === 1) return symbol;
  return style === "ascii" ? `${symbol}^${exp}` : `${symbol}${renderExponent(exp, style)}`;
}

/**
 * Render numerator/denominator form (`kg·m/s²`), deterministic factor order
 * (inherited from normalization). Negative exponents go to the denominator
 * with positive powers; dimensionless renders as "1".
 */
export function formatUnitExpr(expr: UnitExpr, opts: FormatUnitExprOptions = {}): string {
  const style = opts.style ?? "unicode";
  const norm = normalizeUnitExpr(expr, opts.limits);
  if (norm.factors.length === 0) return "1";
  const mul = style === "ascii" ? "*" : "·";
  const num = norm.factors.filter((f) => f.exponent > 0);
  const den = norm.factors.filter((f) => f.exponent < 0);
  const numStr = num.map((f) => renderFactor(f.unit.symbol, f.exponent, style)).join(mul);
  if (den.length === 0) return numStr === "" ? "1" : numStr;
  const denStr = den.map((f) => renderFactor(f.unit.symbol, -f.exponent, style)).join(mul);
  const denWrapped = den.length > 1 ? `(${denStr})` : denStr;
  return numStr === "" ? `1/${denWrapped}` : `${numStr}/${denWrapped}`;
}

// ---------------------------------------------------------------------------
// Text parser for unit-factor expressions (proper tokenizer, not regex hacks)
// ---------------------------------------------------------------------------

type Token =
  | { readonly kind: "unit"; readonly symbol: string }
  | { readonly kind: "op"; readonly op: "*" | "/" | "^" }
  | { readonly kind: "lparen" }
  | { readonly kind: "rparen" }
  | { readonly kind: "int"; readonly value: number };

const SUPERSCRIPT_VALUES: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁻": "-",
};

function tokenizeUnitExpr(input: string, limits: ReturnType<typeof resolveLimits>): Token[] {
  if (input.length > limits.maxExpressionLength) {
    throw new ExpressionLimitError(
      `Unit expression exceeds maxExpressionLength ${limits.maxExpressionLength}.`,
    );
  }
  const tokens: Token[] = [];
  let i = 0;
  const pushOp = (op: "*" | "/" | "^"): void => {
    tokens.push({ kind: "op", op });
  };
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === "*" || ch === "·" || ch === "⋅" || ch === "×") {
      pushOp("*");
      i++;
      continue;
    }
    if (ch === "/") {
      pushOp("/");
      i++;
      continue;
    }
    if (ch === "^") {
      pushOp("^");
      i++;
      continue;
    }
    if (SUPERSCRIPT_VALUES[ch] !== undefined) {
      let digits = "";
      while (i < input.length && SUPERSCRIPT_VALUES[input[i]!] !== undefined) {
        digits += SUPERSCRIPT_VALUES[input[i]!];
        i++;
      }
      const value = Number.parseInt(digits, 10);
      if (!Number.isInteger(value)) {
        throw new ExpressionError(`Invalid superscript exponent "${digits}".`);
      }
      tokens.push({ kind: "int", value });
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      // Integers only (exponents after ^). A leading "-" starts an integer.
      let j = i;
      if (input[j] === "-") j++;
      if (j >= input.length || input[j]! < "0" || input[j]! > "9") {
        throw new ExpressionError(`Unexpected character "${ch}" in unit expression.`);
      }
      while (j < input.length && input[j]! >= "0" && input[j]! <= "9") j++;
      tokens.push({ kind: "int", value: Number.parseInt(input.slice(i, j), 10) });
      i = j;
      continue;
    }
    // Unit symbol: run of non-operator characters.
    let j = i;
    while (
      j < input.length &&
      !" \t\n()*/·⋅×^".includes(input[j]!) &&
      SUPERSCRIPT_VALUES[input[j]!] === undefined &&
      !(input[j]! >= "0" && input[j]! <= "9")
    ) {
      j++;
    }
    if (j === i) {
      throw new ExpressionError(`Unexpected character "${input[i]}" in unit expression.`);
    }
    tokens.push({ kind: "unit", symbol: input.slice(i, j) });
    i = j;
  }
  return tokens;
}

class UnitExprParser {
  private pos = 0;
  private nodes = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly registry: UnitRegistry,
    private readonly limits: ReturnType<typeof resolveLimits>,
  ) {}

  parse(): UnitExpr {
    if (this.tokens.length === 0) {
      throw new ExpressionError("Empty unit expression.");
    }
    const expr = this.parseMulDiv(1);
    if (this.pos < this.tokens.length) {
      throw new ExpressionError("Unexpected trailing tokens in unit expression.");
    }
    return expr;
  }

  private countNode(): void {
    if (++this.nodes > this.limits.maxAstNodes) {
      throw new ExpressionLimitError(
        `Unit expression exceeds maxAstNodes ${this.limits.maxAstNodes}.`,
      );
    }
  }

  // muldiv := pow (("*" | "/") pow)* — same precedence, left-associative,
  // so a/b*c means (a/b)*c and a*b/c means (a*b)/c (standard convention).
  private parseMulDiv(depth: number): UnitExpr {
    this.checkDepth(depth);
    let left = this.parsePow(depth);
    for (;;) {
      const t = this.tokens[this.pos];
      if (t?.kind !== "op" || (t.op !== "*" && t.op !== "/")) return left;
      const op = t.op;
      this.pos++;
      this.countNode();
      const right = this.parsePow(depth);
      left =
        op === "*"
          ? freeze({ kind: "mul", left, right } as MulNode)
          : freeze({ kind: "div", numerator: left, denominator: right } as DivNode);
    }
  }

  private checkDepth(depth: number): void {
    if (depth > this.limits.maxDepth) {
      throw new ExpressionLimitError(`Unit expression exceeds maxDepth ${this.limits.maxDepth}.`);
    }
  }

  // pow := primary (("^"|superscript-int) int?)*
  private parsePow(depth: number): UnitExpr {
    let base = this.parsePrimary(depth);
    for (;;) {
      const t = this.tokens[this.pos];
      if (t?.kind === "op" && t.op === "^") {
        this.pos++;
        const exp = this.tokens[this.pos];
        if (exp?.kind !== "int") {
          throw new ExpressionError('Expected integer exponent after "^".');
        }
        this.pos++;
        base = this.applyExponent(base, exp.value);
      } else if (t?.kind === "int") {
        // Adjacent superscript integer, e.g. m² (tokenizer split superscript).
        this.pos++;
        base = this.applyExponent(base, t.value);
      } else {
        return base;
      }
    }
  }

  private applyExponent(base: UnitExpr, exponent: number): UnitExpr {
    this.countNode();
    if (Math.abs(exponent) > this.limits.maxExponent) {
      throw new ExpressionLimitError(
        `Unit power exponent |${exponent}| exceeds maxExponent ${this.limits.maxExponent}.`,
      );
    }
    return freeze({ kind: "pow", base, exponent } as PowNode);
  }

  private parsePrimary(depth: number): UnitExpr {
    this.checkDepth(depth);
    const t = this.tokens[this.pos];
    if (t?.kind === "lparen") {
      this.pos++;
      this.countNode();
      const inner = this.parseMulDiv(depth + 1);
      const close = this.tokens[this.pos];
      if (close?.kind !== "rparen") {
        throw new ExpressionError("Unbalanced parenthesis in unit expression.");
      }
      this.pos++;
      return inner;
    }
    if (t?.kind === "int" && t.value === 1) {
      // Dimensionless literal one (lets definitions read "1/s").
      this.pos++;
      this.countNode();
      return freeze({ kind: "one" } as OneNode);
    }
    if (t?.kind === "unit") {
      this.pos++;
      this.countNode();
      let unit: Unit;
      try {
        unit = this.registry.resolve(t.symbol);
      } catch (error) {
        throw new ExpressionError(
          `Unknown unit "${t.symbol}" in unit expression (${(error as Error).message}).`,
        );
      }
      return freeze({ kind: "atom", unit } as AtomNode);
    }
    throw new ExpressionError("Expected a unit or '(' in unit expression.");
  }
}

/**
 * Parse a unit-factor expression (`kg*m/s^2`, `kg·m/s²`, `kg/(m*s^2)`,
 * `(m/s)^2`). Resolution (prefixes, aliases) is delegated to the registry;
 * unknown symbols and structural abuse fail with typed errors.
 */
export function parseUnitExpression(
  text: string,
  registry: UnitRegistry = defaultUnitRegistry,
  limits?: UnitAlgebraLimits,
): UnitExpr {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new ExpressionError("Unit expression text must be a non-empty string.");
  }
  const resolved = resolveLimits(limits);
  // Trailing basis tag ("kg DM", mirroring the core parser). Basis is
  // whole-expression metadata: supported structurally only for single-atom
  // expressions — composites must materialize first (toUnit) and tag there.
  let core = text;
  let basis: "asFed" | "DM" | undefined;
  const dmMatch = /^(.*)\s+DM$/.exec(text);
  const asFedMatch = /^(.*)\s+asFed$/.exec(text);
  if (dmMatch?.[1] !== undefined && dmMatch[1].trim().length > 0) {
    core = dmMatch[1].trim();
    basis = "DM";
  } else if (asFedMatch?.[1] !== undefined && asFedMatch[1].trim().length > 0) {
    core = asFedMatch[1].trim();
    basis = "asFed";
  }
  const tokens = tokenizeUnitExpr(core, resolved);
  const expr = new UnitExprParser(tokens, registry, resolved).parse();
  if (basis === undefined) return expr;
  if (expr.kind !== "atom") {
    throw new ExpressionError(
      "Basis tags attach to single units in unit-factor expressions (use toUnit() for composites).",
    );
  }
  return atom(
    makeUnit({
      id: expr.unit.id,
      symbol: expr.unit.symbol,
      name: expr.unit.name,
      aliases: [...expr.unit.aliases],
      dimension: expr.unit.dimension,
      conversion: expr.unit.conversion,
      basis,
      label: expr.unit.label,
      metadata: expr.unit.metadata ? { ...expr.unit.metadata } : undefined,
    }),
  );
}

// ---------------------------------------------------------------------------
// Derived units (named relationships as data; display vs canonical split)
// ---------------------------------------------------------------------------

export interface DerivedUnitDefinition {
  /** Display name, e.g. "N". */
  readonly name: string;
  /**
   * Defining expression over CORE-registry symbols (e.g. "kg*m/s^2").
   * Core symbols keep seeds registry-independent; expansion resolves them
   * in the caller's registry.
   */
  readonly definition: string;
  /** Human description. */
  readonly description?: string;
}

/**
 * Registry used to validate seed/custom derived definitions at define time.
 * Seeds name SI units (N, Pa, …) that live in packs, not the core registry,
 * so validation resolves against an SI-backed registry. Expansion still
 * resolves in the CALLER's registry.
 */
const seedValidationRegistry = createRegistry({ packs: [SI_PACK] });

export class DerivedUnitRegistry {
  private readonly defs = new Map<string, DerivedUnitDefinition>();

  constructor(seed: readonly DerivedUnitDefinition[] = defaultDerivedUnits()) {
    for (const def of seed) this.define(def);
  }

  define(def: DerivedUnitDefinition): void {
    if (!def || typeof def !== "object" || Array.isArray(def)) {
      throw new UnitEngineError("Derived unit definition must be a plain object.");
    }
    if (typeof def.name !== "string" || def.name.trim().length === 0) {
      throw new UnitEngineError("Derived unit definition needs a non-empty name.");
    }
    if (this.defs.has(def.name)) {
      throw new UnitEngineError(`Derived unit "${def.name}" is already defined.`);
    }
    if (typeof def.definition !== "string" || def.definition.trim().length === 0) {
      throw new UnitEngineError(`Derived unit "${def.name}" needs a non-empty definition.`);
    }
    if (typeof def.description !== "string" && def.description !== undefined) {
      throw new UnitEngineError(`Derived unit "${def.name}" description must be a string.`);
    }
    // Validate parseability now (fail fast on typos) against an SI-backed
    // registry, since seeds legitimately name pack units (N, Pa, …).
    parseUnitExpression(def.definition, seedValidationRegistry);
    this.defs.set(def.name, Object.freeze({ ...def }));
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  require(name: string): DerivedUnitDefinition {
    const def = this.defs.get(name);
    if (!def) throw new UnitEngineError(`Unknown derived unit "${name}".`);
    return def;
  }

  list(): readonly string[] {
    return [...this.defs.keys()].sort();
  }

  /**
   * Expand a named derived unit into a structural expression. Recursive
   * definitions terminate: definitions reference core symbols (validated at
   * define time), and expansion depth is bounded defensively.
   */
  expand(
    name: string,
    registry: UnitRegistry = defaultUnitRegistry,
    limits?: UnitAlgebraLimits,
  ): UnitExpr {
    const resolved = resolveLimits(limits);
    const def = this.require(name);
    return this.expandText(def.definition, registry, resolved, 1);
  }

  private expandText(
    text: string,
    registry: UnitRegistry,
    limits: ReturnType<typeof resolveLimits>,
    depth: number,
  ): UnitExpr {
    if (depth > limits.maxDerivedExpansionDepth) {
      throw new ExpressionLimitError(
        `Derived-unit expansion exceeds maxDerivedExpansionDepth ${limits.maxDerivedExpansionDepth}.`,
      );
    }
    const parsed = parseUnitExpression(text, registry, limits);
    // Rewrite any atoms that are themselves derived names (one level per
    // recursion, depth-bounded so hostile registrations terminate).
    const norm = normalizeUnitExpr(parsed, limits);
    let out: UnitExpr = one();
    for (const f of norm.factors) {
      const nested = this.defs.get(f.unit.symbol);
      const base: UnitExpr =
        nested !== undefined
          ? powUnitExpr(this.expandText(nested.definition, registry, limits, depth + 1), f.exponent)
          : powUnitExpr(atom(f.unit), f.exponent);
      out = multiplyUnits(out, base);
    }
    return out;
  }

  /**
   * Match an expression against known derived units: returns the first name
   * (alphabetical) whose expansion is structurally equivalent. Display
   * intent (`N`) is thus recoverable from canonical structure.
   */
  matchDerived(
    expr: UnitExpr,
    registry: UnitRegistry = defaultUnitRegistry,
    limits?: UnitAlgebraLimits,
  ): string | undefined {
    for (const name of this.list()) {
      try {
        const expanded = this.expand(name, registry, limits);
        if (equivalentUnits(expr, expanded, { limits, ignoreKind: true })) return name;
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

function defaultDerivedUnits(): readonly DerivedUnitDefinition[] {
  return [
    { name: "N", definition: "kg*m/s^2", description: "newton" },
    { name: "Pa", definition: "N/m^2", description: "pascal" },
    {
      name: "J",
      definition: "N*m",
      description: "joule (structural; engine E dimension separate)",
    },
    { name: "W", definition: "J/s", description: "watt" },
    { name: "Hz", definition: "1/s", description: "hertz" },
    { name: "C", definition: "A*s", description: "coulomb" },
    { name: "V", definition: "W/A", description: "volt" },
    { name: "ohm", definition: "V/A", description: "ohm (ASCII name; symbol Ω)" },
  ];
}

export const defaultDerivedUnitRegistry = new DerivedUnitRegistry();

// ---------------------------------------------------------------------------
// Serialization (versioned, declarative, validated)
// ---------------------------------------------------------------------------

export interface SerializedUnitExpr {
  readonly version: 1;
  readonly type: "unit-expr";
  /** Normalized factors: deterministic order, integer exponents. */
  readonly factors: readonly { readonly unit: string; readonly exponent: number }[];
}

function serializeNormalized(norm: NormalizedUnitExpr): SerializedUnitExpr {
  return Object.freeze({
    version: 1 as const,
    type: "unit-expr" as const,
    factors: Object.freeze(
      norm.factors.map((f) => Object.freeze({ unit: f.unit.symbol, exponent: f.exponent })),
    ),
  });
}

/** Serialize any expression (normalized first — output is canonical). */
export function serializeUnitExpr(expr: UnitExpr, limits?: UnitAlgebraLimits): SerializedUnitExpr {
  return serializeNormalized(normalizeUnitExpr(expr, limits));
}

function hasPollutionKey(obj: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
    Object.prototype.hasOwnProperty.call(obj, "constructor") ||
    Object.prototype.hasOwnProperty.call(obj, "prototype")
  );
}

/**
 * Deserialize: validate shape/version/factors, resolve every symbol through
 * the registry (unknown symbols throw), rebuild structurally. Never executes
 * code; exponents must be integers within maxExponent.
 */
export function deserializeUnitExpr(
  data: unknown,
  registry: UnitRegistry = defaultUnitRegistry,
  limits?: UnitAlgebraLimits,
): UnitExpr {
  const resolved = resolveLimits(limits);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new ExpressionError("Malformed serialized unit expression: expected an object.");
  }
  const obj = data as Record<string, unknown>;
  if (hasPollutionKey(obj)) {
    throw new ExpressionError("Malformed serialized unit expression: forbidden prototype keys.");
  }
  if (obj.version !== 1) {
    if (obj.version === undefined)
      throw new ExpressionError("Serialized unit expression missing version.");
    throw new ExpressionError(
      `Unsupported serialized unit expression version ${String(obj.version)}.`,
    );
  }
  if (obj.type !== "unit-expr") {
    throw new ExpressionError(`Serialized unit expression has wrong type "${String(obj.type)}".`);
  }
  if (!Array.isArray(obj.factors)) {
    throw new ExpressionError("Malformed serialized unit expression: factors must be an array.");
  }
  if (obj.factors.length > resolved.maxAstNodes) {
    throw new ExpressionLimitError("Serialized unit expression exceeds maxAstNodes.");
  }
  let out: UnitExpr = one();
  for (const entry of obj.factors) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ExpressionError("Malformed serialized unit expression: factor must be an object.");
    }
    const factor = entry as Record<string, unknown>;
    if (hasPollutionKey(factor)) {
      throw new ExpressionError("Malformed serialized unit expression: forbidden prototype keys.");
    }
    if (typeof factor.unit !== "string" || factor.unit.trim().length === 0) {
      throw new ExpressionError(
        "Malformed serialized unit expression: factor needs a unit symbol.",
      );
    }
    if (!Number.isInteger(factor.exponent)) {
      throw new ExpressionError(
        "Malformed serialized unit expression: exponent must be an integer.",
      );
    }
    const exponent = factor.exponent as number;
    if (Math.abs(exponent) > resolved.maxExponent) {
      throw new ExpressionLimitError("Serialized unit expression exponent exceeds maxExponent.");
    }
    let unit: Unit;
    try {
      unit = registry.resolve(factor.unit);
    } catch (error) {
      throw new ExpressionError(
        `Unknown unit "${factor.unit}" in serialized unit expression (${(error as Error).message}).`,
      );
    }
    out = multiplyUnits(out, powUnitExpr(atom(unit), exponent));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structural analysis helpers (23.10–23.12 building blocks)
// ---------------------------------------------------------------------------

/**
 * Analyze an expression's dimension without any numeric values.
 * Returns `{ dimension, valid, diagnostics }` — always reusable by the
 * formula engine (Phase 24): invalid input yields valid:false with reasons
 * instead of throwing, except for hostile/limit violations which throw.
 */
export function analyzeUnitExpr(
  expr: UnitExpr,
  limits?: UnitAlgebraLimits,
): { dimension?: DimensionVector; valid: boolean; diagnostics: readonly string[] } {
  const diagnostics: string[] = [];
  try {
    const dimension = dimensionOfUnitExpr(expr, limits);
    return { dimension, valid: true, diagnostics: Object.freeze([]) };
  } catch (error) {
    if (error instanceof ExpressionLimitError) throw error;
    diagnostics.push((error as Error).message);
    return { dimension: undefined, valid: false, diagnostics: Object.freeze(diagnostics) };
  }
}

/** Infer unknown factor exponents? Not applicable — exponents are structural. */
export function checkUnitExpr(expr: UnitExpr, limits?: UnitAlgebraLimits): boolean {
  return analyzeUnitExpr(expr, limits).valid;
}

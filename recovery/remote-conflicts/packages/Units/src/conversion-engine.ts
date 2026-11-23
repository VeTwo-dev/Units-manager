/**
 * conversion-engine.ts
 * -----------------------------------------------------------------------
 * Single responsibility: convert numeric values between units of the
 * same dimension. Supports:
 *
 * - Linear conversions:      base = value × scale
 * - Affine conversions:      base = value × scale + offset
 * - Logarithmic/custom:      REJECTED explicitly (UnsupportedTransformationError).
 *   dB/pH-style units need a reference/context model, not `value × factor`
 * - Same-unit optimization:  convert(x, A, A) → x (no computation)
 * - Base-unit path:          source → canonical base → target
 *
 * The engine is domain-independent. It knows nothing about nutrition,
 * chemistry, or any other application domain.
 *
 * Architecture: the engine reads conversion definitions from Unit objects
 * and applies them. No graph traversal is needed for the common case
 * because all atomic units define their conversion directly to the
 * canonical base. Derived units compose via the parser.
 *
 * Performance: resolved conversion plans (captured numbers only) are
 * cached in a bounded Map. Cache keys embed the full conversion
 * parameters, so a hit can only reuse a mathematically identical plan —
 * correctness never depends on the cache.
 * -----------------------------------------------------------------------
 */
import { dimensionKey, dimensionsEqual } from "./dimension.js";
import type { ConversionDef, Unit } from "./unit.js";
import { ImpossibleConversionError, UnsupportedTransformationError } from "./errors/index.js";

/**
 * Reject conversions the numeric engine cannot execute (Phase 21.29).
 * Logarithmic conversions need a reference/context model and custom
 * conversions need host-provided handlers — neither is `value × factor`,
 * so failing explicitly here is the extension point (never silent NaN).
 */
function requireExecutableConversion(unit: Unit): asserts unit is Unit & {
  conversion: Extract<ConversionDef, { kind: "linear" | "affine" }>;
} {
  const kind = unit.conversion.kind;
  if (kind !== "linear" && kind !== "affine") {
    throw new UnsupportedTransformationError(
      `"${unit.symbol}" (${kind} conversion)`,
      "only linear/affine conversions are executable; logarithmic/custom units need an explicit context model",
    );
  }
}

// ---------------------------------------------------------------------------
// Conversion plans (cached, declarative, immutable)
// ---------------------------------------------------------------------------

/** A resolved conversion plan: captured numbers only, no Unit references. */
export interface ConversionPlan {
  readonly sameUnit: boolean;
  readonly fromKind: "linear" | "affine";
  readonly fromScale: number;
  readonly fromOffset: number;
  readonly toKind: "linear" | "affine";
  readonly toScale: number;
  readonly toOffset: number;
}

const MAX_PLAN_CACHE = 500;
const planCache = new Map<string, ConversionPlan>();

function planKey(from: Unit, to: Unit, registryVersion?: number): string {
  requireExecutableConversion(from);
  requireExecutableConversion(to);
  const fromOffset = from.conversion.kind === "affine" ? from.conversion.offset : 0;
  const toOffset = to.conversion.kind === "affine" ? to.conversion.offset : 0;
  return [
    `v${registryVersion ?? "*"}`,
    `${from.id}|${from.basis ?? ""}`,
    dimensionKey(from.dimension),
    from.conversion.kind,
    from.conversion.scale,
    fromOffset,
    "->",
    `${to.id}|${to.basis ?? ""}`,
    dimensionKey(to.dimension),
    to.conversion.kind,
    to.conversion.scale,
    toOffset,
  ].join(":");
}

/**
 * Identity requires more than a shared id: two distinct Unit objects may
 * legally share an id across registries, so the conversion parameters must
 * also match. Otherwise conversion would be silently skipped.
 */
function isSameUnit(from: Unit, to: Unit): boolean {
  if (from.id !== to.id || from.basis !== to.basis) return false;
  if (from.conversion.kind !== to.conversion.kind) return false;
  requireExecutableConversion(from);
  requireExecutableConversion(to);
  if (from.conversion.scale !== to.conversion.scale) return false;
  if (from.conversion.kind === "affine" && to.conversion.kind === "affine") {
    return from.conversion.offset === to.conversion.offset;
  }
  return true;
}

function cachePlan(key: string, plan: ConversionPlan): void {
  if (planCache.size >= MAX_PLAN_CACHE) {
    const first = planCache.keys().next().value as string | undefined;
    if (first !== undefined) planCache.delete(first);
  }
  planCache.set(key, plan);
}

/**
 * Read the linear scale of a unit, rejecting logarithmic/custom units
 * explicitly. Use this instead of touching `.conversion.scale` directly —
 * direct access is a type error since Phase 21 by design.
 */
export function linearScaleOf(unit: Unit): number {
  requireExecutableConversion(unit);
  return unit.conversion.scale;
}

/**
 * Resolve a conversion plan for a unit pair. Validates dimensions first.
 * Plans are cached (bounded); the key embeds unit identity, dimensions and
 * all conversion parameters (plus the optional registry version), so a
 * cache hit is always mathematically identical to a fresh resolution.
 * Pass `registryVersion` (see `UnitRegistry.version`) when the units come
 * from a mutable registry to scope cached plans to a generation.
 */
export function getConversionPlan(from: Unit, to: Unit, registryVersion?: number): ConversionPlan {
  if (isSameUnit(from, to)) {
    return {
      sameUnit: true,
      fromKind: "linear",
      fromScale: 1,
      fromOffset: 0,
      toKind: "linear",
      toScale: 1,
      toOffset: 0,
    };
  }
  if (!dimensionsEqual(from.dimension, to.dimension)) {
    throw new ImpossibleConversionError(from.symbol, to.symbol);
  }
  requireExecutableConversion(from);
  requireExecutableConversion(to);
  const key = planKey(from, to, registryVersion);
  const cached = planCache.get(key);
  if (cached) return cached;
  const plan: ConversionPlan = Object.freeze({
    sameUnit: false,
    fromKind: from.conversion.kind,
    fromScale: from.conversion.scale,
    fromOffset: from.conversion.kind === "affine" ? from.conversion.offset : 0,
    toKind: to.conversion.kind,
    toScale: to.conversion.scale,
    toOffset: to.conversion.kind === "affine" ? to.conversion.offset : 0,
  });
  cachePlan(key, plan);
  return plan;
}

/** Apply a resolved plan to a numeric value (dimensions pre-validated). */
export function convertWithPlan(value: number, plan: ConversionPlan): number {
  if (plan.sameUnit) return value;
  const base =
    plan.fromKind === "linear" ? value * plan.fromScale : value * plan.fromScale + plan.fromOffset;
  return plan.toKind === "linear" ? base / plan.toScale : (base - plan.toOffset) / plan.toScale;
}

// ---------------------------------------------------------------------------
// Core conversion
// ---------------------------------------------------------------------------

/**
 * Convert a numeric value from one unit to another.
 *
 * Both units must have the same dimension (dimensional validation happens
 * first). For affine units (e.g. temperature), the offset is correctly
 * applied in both directions.
 *
 * @throws {ImpossibleConversionError} if dimensions differ
 * @throws {ConversionError} if the conversion path cannot be resolved
 */
export function convert(value: number, from: Unit, to: Unit): number {
  // Fast path preserves exact legacy semantics: identical object → identity.
  if (from === to) return value;
  return convertWithPlan(value, getConversionPlan(from, to));
}

// ---------------------------------------------------------------------------
// Low-level conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert a value in `unit` to the canonical base value of its dimension.
 *   base = value × scale + offset
 */
export function toBase(value: number, unit: Unit): number {
  const conv = unit.conversion;
  switch (conv.kind) {
    case "linear":
      return value * conv.scale;
    case "affine":
      return value * conv.scale + conv.offset;
    default:
      throw new UnsupportedTransformationError(
        `"${unit.symbol}" (${conv.kind} conversion)`,
        "toBase requires a linear/affine conversion",
      );
  }
}

/**
 * Convert a canonical base value to a value in `unit`.
 * This is the inverse of `toBase`:
 *   value = (base - offset) / scale
 */
export function fromBase(baseValue: number, unit: Unit): number {
  const conv = unit.conversion;
  switch (conv.kind) {
    case "linear":
      return baseValue / conv.scale;
    case "affine":
      return (baseValue - conv.offset) / conv.scale;
    default:
      throw new UnsupportedTransformationError(
        `"${unit.symbol}" (${conv.kind} conversion)`,
        "fromBase requires a linear/affine conversion",
      );
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Check if two units are dimensionally compatible (can be converted between).
 */
export function areConvertible(a: Unit, b: Unit): boolean {
  return dimensionsEqual(a.dimension, b.dimension);
}

/**
 * Validate that a conversion is possible. Throws with a descriptive error
 * if not. Returns void on success.
 */
export function validateConversion(from: Unit, to: Unit): void {
  if (!dimensionsEqual(from.dimension, to.dimension)) {
    throw new ImpossibleConversionError(from.symbol, to.symbol);
  }
}

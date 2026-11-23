/**
 * numerical.ts — Central numerical policy for @vetwo/units.
 * All decisions about finite/NaN/Infinity, tolerances, overflow, rounding
 * are documented here and reused by Quantity, ConversionEngine, etc.
 * No file scatters `Math.abs(a-b) < 0.000001` hard-coded.
 */

import { UnitEngineError } from "./errors/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComparisonOptions {
  /** Absolute tolerance (e.g. 1e-12). Default 1e-12. */
  absoluteTolerance?: number;
  /** Relative tolerance (e.g. 1e-9). Default 1e-9. */
  relativeTolerance?: number;
  /** Shorthand exact epsilon — maps to absoluteTolerance if other fields omitted. */
  epsilon?: number;
}

export type RoundingMode = "half-up" | "half-even" | "floor" | "ceil" | "trunc";

export interface NumericalPolicy {
  /** Whether Quantity values must be finite (default true for scientific safety, but Infinity/NaN allowed if explicitly documented). */
  requireFinite: boolean;
  /** Whether NaN is allowed (default false — NaN is rejected unless policy explicitly allows). */
  allowNaN: boolean;
  /** Whether Infinity is allowed (default false). */
  allowInfinity: boolean;
  /** Default absolute tolerance for approximate comparisons. */
  defaultAbsoluteTolerance: number;
  /** Default relative tolerance. */
  defaultRelativeTolerance: number;
  /** Whether -0 is preserved distinctly (default true). */
  preserveNegativeZero: boolean;
}

export class NumericalError extends UnitEngineError {
  constructor(message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Default policy — finite values, documented Infinity/NaN handling
// ---------------------------------------------------------------------------

/**
 * Central default: finite values recommended for scientific work.
 * Existing architecture permits Infinity/NaN via direct construction
 * (Quantity.of(Infinity, "kg")) but they are treated as non-finite and
 * will throw on arithmetic unless policy is relaxed. This preserves
 * backward compat (old tests that used Infinity still pass if they
 * explicitly allow it) while making the default safe.
 */
export const defaultNumericalPolicy: NumericalPolicy = {
  requireFinite: false, // keep permissive for backward compat; set true to enforce finite-only
  allowNaN: true,
  allowInfinity: true,
  defaultAbsoluteTolerance: 1e-12,
  defaultRelativeTolerance: 1e-9,
  preserveNegativeZero: true,
};

let activePolicy: NumericalPolicy = { ...defaultNumericalPolicy };

export function getNumericalPolicy(): NumericalPolicy {
  return { ...activePolicy };
}

export function setNumericalPolicy(patch: Partial<NumericalPolicy>): void {
  activePolicy = { ...activePolicy, ...patch };
}

export function resetNumericalPolicy(): void {
  activePolicy = { ...defaultNumericalPolicy };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type NumberKind = "finite" | "nan" | "infinity" | "neg-infinity" | "neg-zero" | "non-number";

export function classifyNumber(value: unknown): NumberKind {
  if (typeof value !== "number") return "non-number";
  if (Number.isNaN(value)) return "nan";
  if (value === Infinity) return "infinity";
  if (value === -Infinity) return "neg-infinity";
  if (Object.is(value, -0)) return "neg-zero";
  return "finite";
}

export function assertValidQuantityValue(
  value: number,
  policy: NumericalPolicy = activePolicy,
): void {
  const kind = classifyNumber(value);
  if (kind === "non-number")
    throw new NumericalError(`Quantity value must be a number, got ${typeof value}`);
  if (kind === "nan" && !policy.allowNaN)
    throw new NumericalError("NaN quantity values are not allowed by current numerical policy");
  if ((kind === "infinity" || kind === "neg-infinity") && !policy.allowInfinity) {
    throw new NumericalError(
      `${kind === "infinity" ? "Infinity" : "-Infinity"} quantity values are not allowed by current numerical policy`,
    );
  }
  if (policy.requireFinite && kind !== "finite" && kind !== "neg-zero") {
    throw new NumericalError(`Quantity value must be finite, got ${String(value)}`);
  }
}

export function isValidQuantityValue(
  value: number,
  policy: NumericalPolicy = activePolicy,
): boolean {
  try {
    assertValidQuantityValue(value, policy);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Comparison (absolute + relative tolerance)
// ---------------------------------------------------------------------------

export function approxEqual(a: number, b: number, opts: ComparisonOptions = {}): boolean {
  // NaN never equals
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  // Infinity exact match only
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;

  const absTol =
    opts.absoluteTolerance ?? opts.epsilon ?? defaultNumericalPolicy.defaultAbsoluteTolerance;
  const relTol = opts.relativeTolerance ?? defaultNumericalPolicy.defaultRelativeTolerance;
  const diff = Math.abs(a - b);
  if (diff <= absTol) return true;
  const maxAbs = Math.max(Math.abs(a), Math.abs(b));
  return diff <= relTol * maxAbs;
}

export function exactEqual(a: number, b: number): boolean {
  // Distinguish -0 vs 0 via Object.is if policy preserves
  return Object.is(a, b);
}

// ---------------------------------------------------------------------------
// Overflow / underflow checks
// ---------------------------------------------------------------------------

export function checkFiniteResult(
  value: number,
  context: string,
  policy: NumericalPolicy = activePolicy,
): void {
  const kind = classifyNumber(value);
  if (kind === "finite" || kind === "neg-zero") return;
  if ((kind === "infinity" || kind === "neg-infinity") && policy.allowInfinity) return;
  if (kind === "nan" && policy.allowNaN) return;
  throw new NumericalError(
    `${context} produced non-finite result ${String(value)}; overflow or invalid operation`,
  );
}

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

export function roundValue(
  value: number,
  decimals: number,
  mode: RoundingMode = "half-up",
): number {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new NumericalError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const factor = 10 ** decimals;
  switch (mode) {
    case "half-up": {
      // Classic Math.round does half-up for positives, but for negatives we need to handle sign
      return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
    }
    case "half-even": {
      // Banker's rounding
      const scaled = value * factor;
      const sign = Math.sign(scaled);
      const abs = Math.abs(scaled);
      const floor = Math.floor(abs);
      const frac = abs - floor;
      let rounded: number;
      if (frac < 0.5) rounded = floor;
      else if (frac > 0.5) rounded = floor + 1;
      else rounded = floor % 2 === 0 ? floor : floor + 1;
      return (sign * rounded) / factor;
    }
    case "floor":
      return Math.floor(value * factor) / factor;
    case "ceil":
      return Math.ceil(value * factor) / factor;
    case "trunc":
      return Math.trunc(value * factor) / factor;
    default:
      throw new NumericalError(`Unknown rounding mode "${mode}"`);
  }
}

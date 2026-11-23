/**
 * nutrition-context.ts — Explicit nutrition measurement context.
 *
 * Holds dry-matter / moisture information required for basis conversion.
 * Immutable, validated, deterministic. One of dryMatterFraction or
 * moistureFraction may be supplied; the other is derived. If both supplied,
 * they must be consistent within tolerance.
 */

import {
  InvalidNutritionBasisError,
  InvalidNutritionContextError,
  MissingNutritionContextError,
  NutritionContextError,
} from "./errors.js";
import type { Measurement } from "@vetwo/units";

export interface NutritionContextOptions {
  readonly dryMatterFraction?: number;
  readonly moistureFraction?: number;
  /** Uncertain dry-matter as a Measurement (dimensionless 0< x ≤1). If provided, basis conversion propagates its uncertainty. */
  readonly dryMatterMeasurement?: Measurement;
  readonly sampleState?: string;
  readonly source?: string;
  readonly sampleId?: string;
  readonly analyticalMethod?: string;
  readonly timestamp?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NutritionContext {
  readonly dryMatterFraction?: number;
  readonly moistureFraction?: number;
  readonly dryMatterMeasurement?: Measurement;
  readonly sampleState?: string;
  readonly source?: string;
  readonly sampleId?: string;
  readonly analyticalMethod?: string;
  readonly timestamp?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Derived — always available if either fraction supplied. */
  readonly resolvedDryMatterFraction?: number;
  readonly resolvedMoistureFraction?: number;
  readonly resolvedDryMatterMeasurement?: Measurement;
}

function assertFiniteFraction(value: number, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new NutritionContextError(`${name} must be a finite number, got ${String(value)}`);
  }
  if (value <= 0 || value > 1) {
    throw new InvalidNutritionBasisError(name, `must satisfy 0 < ${name} ≤ 1, got ${value}`);
  }
}

function validateContextInput(opts: NutritionContextOptions): void {
  if (!opts || typeof opts !== "object" || Array.isArray(opts)) {
    throw new InvalidNutritionContextError("NutritionContext must be a plain object");
  }
  const r = opts as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(r, "__proto__") ||
    Object.prototype.hasOwnProperty.call(r, "constructor") ||
    Object.prototype.hasOwnProperty.call(r, "prototype")
  ) {
    throw new InvalidNutritionContextError("NutritionContext contains forbidden keys");
  }
  if (opts.dryMatterFraction !== undefined)
    assertFiniteFraction(opts.dryMatterFraction, "dryMatterFraction");
  if (opts.moistureFraction !== undefined)
    assertFiniteFraction(opts.moistureFraction, "moistureFraction");
  if (opts.dryMatterMeasurement !== undefined) {
    const m = opts.dryMatterMeasurement as unknown;
    const maybe = m as { value?: unknown; uncertainty?: unknown };
    if (!maybe || typeof maybe !== "object" || !("value" in maybe) || !("uncertainty" in maybe)) {
      throw new InvalidNutritionContextError("dryMatterMeasurement must be a Measurement");
    }
  }
  // Both supplied → must be consistent: DM + moisture ≈ 1
  if (opts.dryMatterFraction !== undefined && opts.moistureFraction !== undefined) {
    const sum = opts.dryMatterFraction + opts.moistureFraction;
    if (Math.abs(sum - 1) > 1e-6) {
      throw new InvalidNutritionContextError(
        `dryMatterFraction (${opts.dryMatterFraction}) + moistureFraction (${opts.moistureFraction}) must ≈ 1 (got ${sum})`,
      );
    }
  }
  if (opts.dryMatterMeasurement !== undefined && opts.dryMatterFraction !== undefined) {
    const dmVal = (opts.dryMatterMeasurement as unknown as { value: { value: number } }).value
      .value;
    if (Math.abs(dmVal - opts.dryMatterFraction) > 1e-6) {
      throw new InvalidNutritionContextError(
        `dryMatterMeasurement value ${dmVal} inconsistent with dryMatterFraction ${opts.dryMatterFraction}`,
      );
    }
  }
  // If moisture supplied without DM, derive DM = 1 - moisture
  // If neither supplied but sampleState provided, that's okay — context may be minimal
  // But if absolutely no fraction supplied, caller must provide one for basis conversion
  if (opts.dryMatterFraction === undefined && opts.moistureFraction === undefined) {
    // Allow empty context for non-basis operations; basis conversion will throw missing
  }
  if (
    opts.sampleState !== undefined &&
    (typeof opts.sampleState !== "string" || opts.sampleState.trim().length === 0)
  ) {
    throw new InvalidNutritionContextError("sampleState must be a non-empty string if provided");
  }
  if (opts.metadata !== undefined) {
    if (
      typeof opts.metadata !== "object" ||
      opts.metadata === null ||
      Array.isArray(opts.metadata)
    ) {
      throw new InvalidNutritionContextError("metadata must be a plain object if provided");
    }
    const m = opts.metadata as Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(m, "__proto__") ||
      Object.prototype.hasOwnProperty.call(m, "constructor") ||
      Object.prototype.hasOwnProperty.call(m, "prototype")
    ) {
      throw new InvalidNutritionContextError("metadata contains forbidden keys");
    }
  }
}

export function createNutritionContext(opts: NutritionContextOptions = {}): NutritionContext {
  validateContextInput(opts);
  const dm = opts.dryMatterFraction;
  const moist = opts.moistureFraction;
  const dmMeas = opts.dryMatterMeasurement;
  let resolvedDM = dm;
  let resolvedMoist = moist;
  const resolvedDmMeas = dmMeas as Measurement | undefined;
  if (dmMeas) {
    // Derive fraction from Measurement value if not already set
    const val = dmMeas.value.value;
    const sym = dmMeas.value.unit.symbol;
    const maybeFraction = sym.includes("%") ? val / 100 : val;
    if (resolvedDM === undefined) resolvedDM = maybeFraction;
    if (resolvedMoist === undefined) resolvedMoist = 1 - maybeFraction;
  } else {
    if (dm === undefined && moist !== undefined) resolvedDM = 1 - moist;
    if (moist === undefined && dm !== undefined) resolvedMoist = 1 - dm;
  }

  const result: NutritionContext = {
    ...(dm !== undefined ? { dryMatterFraction: dm } : {}),
    ...(moist !== undefined ? { moistureFraction: moist } : {}),
    ...(dmMeas ? { dryMatterMeasurement: dmMeas } : {}),
    ...(opts.sampleState ? { sampleState: opts.sampleState } : {}),
    ...(opts.source ? { source: opts.source } : {}),
    ...(opts.sampleId ? { sampleId: opts.sampleId } : {}),
    ...(opts.analyticalMethod ? { analyticalMethod: opts.analyticalMethod } : {}),
    ...(opts.timestamp ? { timestamp: opts.timestamp } : {}),
    ...(opts.metadata ? { metadata: Object.freeze({ ...opts.metadata }) } : {}),
    ...(resolvedDM !== undefined ? { resolvedDryMatterFraction: resolvedDM } : {}),
    ...(resolvedMoist !== undefined ? { resolvedMoistureFraction: resolvedMoist } : {}),
    ...(resolvedDmMeas ? { resolvedDryMatterMeasurement: resolvedDmMeas } : {}),
  };
  return Object.freeze(result);
}

/**
 * Extract DM fraction as 0< x ≤1 from context or from a Quantity(%).
 * Accepts either NutritionContext or a Quantity with % unit.
 */
export function resolveDryMatterFraction(
  context: NutritionContext | undefined,
  dmQuantity?: unknown,
): number {
  if (dmQuantity !== undefined) {
    // Allow Quantity(%) or plain number fraction
    if (typeof dmQuantity === "number") {
      if (!Number.isFinite(dmQuantity) || dmQuantity <= 0 || dmQuantity > 1) {
        throw new InvalidNutritionBasisError(
          "dryMatterFraction",
          `must be 0< x ≤1, got ${dmQuantity}`,
        );
      }
      return dmQuantity;
    }
    // Try to treat as Quantity
    const q = dmQuantity as {
      value?: unknown;
      unit?: unknown;
      to?: (u: string) => { value: number };
    };
    if (q && typeof q.value === "number" && typeof q.to === "function") {
      try {
        const pct = q.to("%");
        const fraction = pct.value / 100;
        if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
          throw new InvalidNutritionBasisError(
            "dryMatterFraction",
            `must be 0< x ≤1, got ${fraction} from ${pct.value}%`,
          );
        }
        return fraction;
      } catch (e) {
        if (e instanceof InvalidNutritionContextError) throw e;
        if (e instanceof NutritionContextError) throw e;
        if (e instanceof InvalidNutritionBasisError) throw e;
        throw new InvalidNutritionContextError(
          `failed to resolve dryMatterFraction from Quantity: ${(e as Error).message}`,
        );
      }
    }
    throw new InvalidNutritionContextError(
      "dryMatterFraction must be a NutritionContext, Quantity(%), or number fraction",
    );
  }
  if (!context) throw new MissingNutritionContextError("unknown");
  const dm = context.resolvedDryMatterFraction ?? context.dryMatterFraction;
  if (dm === undefined) throw new MissingNutritionContextError("unknown");
  if (!Number.isFinite(dm) || dm <= 0 || dm > 1)
    throw new InvalidNutritionBasisError("dryMatterFraction", `resolved invalid: ${dm}`);
  return dm;
}

// NOTE (Prompt 25 forensics): the canonical MissingNutritionContextError and
// InvalidNutritionContextError live in ./errors.js and are re-exported from the
// package index. They are imported above — this module intentionally defines no
// local duplicates so `instanceof` stays consistent across the package.

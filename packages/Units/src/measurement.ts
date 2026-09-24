/**
 * measurement.ts
 * -----------------------------------------------------------------------
 * Single responsibility: the Measurement value object — a nominal Quantity
 * plus its absolute uncertainty, with first-order error propagation.
 *
 * A plain Quantity is deliberately lightweight (value + unit) and stays
 * that way: Measurement is an OPTIONAL, separate abstraction layered on
 * top. Basic Quantity operations never slow down because Measurement exists.
 *
 * Model (all generic, no domain knowledge):
 * - value: Quantity — the nominal measured value.
 * - uncertainty: Quantity — ABSOLUTE uncertainty in the SAME dimension as
 *   value (e.g. 10.0 ± 0.2 kg). Relative uncertainties (e.g. ±2%) are
 *   accepted at construction as a dimensionless fraction and converted.
 * - Uncertainty units must be LINEAR (scale-only). Temperature uncertainty
 *   must be expressed in K, never °C/°F: affine offsets are meaningless
 *   for intervals, and silently applying them would corrupt results.
 * - Optional significant figures for presentation precision.
 * - Optional confidence/coverage metadata.
 * - Optional provenance (instrument, method, source, timestamp).
 *
 * Propagation assumes INDEPENDENT uncertainties (first-order Taylor):
 * - add/subtract: σ = √(σ₁² + σ₂²)            (absolute quadrature)
 * - multiply/divide: relative quadrature       (r = σ/|v|)
 * - pow(n): relative × |n|
 * Correlation/covariance is NOT modeled by default — see the documented
 * limitation; correlated measurements must be handled explicitly via the
 * covariance API. Never assume independence silently: every propagation
 * method documents its independence assumption.
 *
 * Immutability: Measurement instances are frozen; all operations return
 * new instances. Quantity math is never duplicated here — every operation
 * delegates nominal values to Quantity and propagates uncertainty alongside.
 * -----------------------------------------------------------------------
 */
import { Quantity } from "./quantity.js";
import type { Unit } from "./unit.js";
import { isAffineUnit } from "./unit.js";
import { defaultUnitRegistry, type UnitRegistry } from "./unit-registry.js";
import { convert, linearScaleOf } from "./conversion-engine.js";
import { dimensionsEqual } from "./dimension.js";
import { InvalidMeasurementError, UnitMismatchError } from "./errors/index.js";
import { NumericalError } from "./numerical.js";
import type { SemanticPolicy } from "./quantity-kind.js";
import {
  approxEqual as approxEqualNumeric,
  checkFiniteResult,
  type ComparisonOptions,
} from "./numerical.js";
import type { Expression, VariableDimensions } from "./expression.js";
import { inferExpressionDimension as inferDim } from "./expression.js";
import type { DimensionVector } from "./dimension.js";
import {
  toSignificantFigures,
  toScientificNotation,
  toEngineeringNotation,
} from "./significant-figures.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Uncertainty propagation method. Only first-order linearization is implemented. */
export type UncertaintyMethod = "linearized";

/** Optional per-call semantic policy for same-dimension Measurement arithmetic. */
export interface MeasurementArithmeticOptions {
  readonly semanticPolicy?: SemanticPolicy;
}

/**
 * Correlation/covariance specification for correlated measurements.
 * Used when measurements are known to be correlated (not independent).
 */
export interface CorrelationSpec {
  /** The other measurement this one is correlated with. */
  readonly with: Measurement;
  /** Correlation coefficient in [-1, 1]. */
  readonly coefficient: number;
}

/**
 * Provenance information for a measurement.
 * Tracks origin, method, and chain of custody.
 */
export interface MeasurementProvenance {
  /** Human-readable description of the measurement method. */
  readonly method?: string;
  /** Instrument or device identifier. */
  readonly instrumentId?: string;
  /** Laboratory or facility identifier. */
  readonly laboratoryId?: string;
  /** Operator or observer identifier. */
  readonly operatorId?: string;
  /** Timestamp of the measurement (ISO 8601). */
  readonly timestamp?: string;
  /** Free-form source description. */
  readonly source?: string;
  /** Digital signature or hash for integrity verification. */
  readonly integrityHash?: string;
  /** Parent measurements this measurement was derived from. */
  readonly derivedFrom?: readonly Measurement[];
}

/**
 * Significant figures configuration for presentation precision.
 * Significant figures are presentation metadata, not mathematical properties.
 */
export interface SignificantFiguresConfig {
  /** Number of significant figures (1-100). */
  readonly sigFigs: number;
  /** Preferred notation for display. */
  readonly notation?: "standard" | "scientific" | "engineering";
}

/**
 * Confidence/coverage interval specification.
 */
export interface ConfidenceInterval {
  /** Coverage factor k (e.g., 1 for ~68%, 2 for ~95%, 3 for ~99.7%). */
  readonly coverageFactor: number;
  /** Confidence level as a fraction (e.g., 0.95 for 95%). */
  readonly confidenceLevel?: number;
  /** Distribution assumption ("normal", "t", "uniform", "rectangular", "triangular"). */
  readonly distribution?: "normal" | "t" | "uniform" | "rectangular" | "triangular";
  /** Degrees of freedom for t-distribution. */
  readonly degreesOfFreedom?: number;
}

/**
 * Extended metadata for a measurement, including uncertainty presentation,
 * confidence, provenance, and correlation.
 */
export interface MeasurementMetadata {
  /** Confidence level in (0, 1) exclusive, e.g. 0.95. Optional. */
  readonly confidenceLevel?: number;
  /** Propagation method (default "linearized"). Unknown methods are rejected. */
  readonly method?: UncertaintyMethod;
  /** Free-form source description (e.g. "caliper #3"). Optional, never affects math. */
  readonly source?: string;
  /** Instrument identifier. Optional, never affects math. */
  readonly instrumentId?: string;

  // ---- Phase 25 Extensions ----
  /** Significant figures for presentation precision. */
  readonly significantFigures?: SignificantFiguresConfig;
  /** Confidence/coverage interval specification. */
  readonly confidenceInterval?: ConfidenceInterval;
  /** Provenance tracking. */
  readonly provenance?: MeasurementProvenance;
  /** Correlation specification for non-independent measurements. */
  readonly correlation?: CorrelationSpec;
  /** Significant figures derived from the uncertainty (auto-calculated if not set). */
  readonly autoSigFigs?: boolean;
}

// ---------------------------------------------------------------------------
// Validation helpers (local, no shared mutable state)
// ---------------------------------------------------------------------------

function assertValidMetadata(metadata: MeasurementMetadata | undefined, what: string): void {
  if (metadata === undefined) return;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new InvalidMeasurementError(`${what} metadata must be a plain object`);
  }
  const {
    confidenceLevel,
    method,
    source,
    instrumentId,
    significantFigures,
    confidenceInterval,
    provenance,
    correlation,
    autoSigFigs,
  } = metadata;
  if (confidenceLevel !== undefined) {
    if (typeof confidenceLevel !== "number" || !(confidenceLevel > 0 && confidenceLevel < 1)) {
      throw new InvalidMeasurementError(
        `${what} confidence level must be strictly between 0 and 1, got ${String(confidenceLevel)}`,
      );
    }
  }
  if (method !== undefined && method !== "linearized") {
    throw new InvalidMeasurementError(
      `${what} method "${String(method)}" is not supported (only "linearized"; interval and Monte Carlo are deferred extension points)`,
    );
  }
  if (source !== undefined && typeof source !== "string") {
    throw new InvalidMeasurementError(`${what} source must be a string`);
  }
  if (instrumentId !== undefined && typeof instrumentId !== "string") {
    throw new InvalidMeasurementError(`${what} instrumentId must be a string`);
  }
  if (significantFigures !== undefined) {
    if (
      !Number.isInteger(significantFigures.sigFigs) ||
      significantFigures.sigFigs < 1 ||
      significantFigures.sigFigs > 100
    ) {
      throw new InvalidMeasurementError(
        `${what} significantFigures.sigFigs must be an integer in [1, 100]`,
      );
    }
    if (
      significantFigures.notation !== undefined &&
      !["standard", "scientific", "engineering"].includes(significantFigures.notation)
    ) {
      throw new InvalidMeasurementError(
        `${what} significantFigures.notation must be "standard", "scientific", or "engineering"`,
      );
    }
  }
  if (confidenceInterval !== undefined) {
    if (
      typeof confidenceInterval.coverageFactor !== "number" ||
      confidenceInterval.coverageFactor <= 0
    ) {
      throw new InvalidMeasurementError(
        `${what} confidenceInterval.coverageFactor must be a positive number`,
      );
    }
    if (
      confidenceInterval.confidenceLevel !== undefined &&
      (typeof confidenceInterval.confidenceLevel !== "number" ||
        !(confidenceInterval.confidenceLevel > 0 && confidenceInterval.confidenceLevel < 1))
    ) {
      throw new InvalidMeasurementError(
        `${what} confidenceInterval.confidenceLevel must be in (0, 1)`,
      );
    }
    if (
      confidenceInterval.distribution !== undefined &&
      !["normal", "t", "uniform", "rectangular", "triangular"].includes(
        confidenceInterval.distribution,
      )
    ) {
      throw new InvalidMeasurementError(
        `${what} confidenceInterval.distribution must be "normal", "t", "uniform", "rectangular", or "triangular"`,
      );
    }
    if (
      confidenceInterval.degreesOfFreedom !== undefined &&
      (!Number.isInteger(confidenceInterval.degreesOfFreedom) ||
        confidenceInterval.degreesOfFreedom < 1)
    ) {
      throw new InvalidMeasurementError(
        `${what} confidenceInterval.degreesOfFreedom must be a positive integer`,
      );
    }
  }
  if (provenance !== undefined) {
    if (provenance.timestamp !== undefined && typeof provenance.timestamp !== "string") {
      throw new InvalidMeasurementError(`${what} provenance.timestamp must be an ISO 8601 string`);
    }
    if (provenance.derivedFrom !== undefined && !Array.isArray(provenance.derivedFrom)) {
      throw new InvalidMeasurementError(`${what} provenance.derivedFrom must be an array`);
    }
  }
  if (correlation !== undefined) {
    if (!(correlation.with instanceof Measurement)) {
      throw new InvalidMeasurementError(`${what} correlation.with must be a Measurement`);
    }
    if (
      typeof correlation.coefficient !== "number" ||
      correlation.coefficient < -1 ||
      correlation.coefficient > 1
    ) {
      throw new InvalidMeasurementError(`${what} correlation.coefficient must be in [-1, 1]`);
    }
  }
  if (autoSigFigs !== undefined && typeof autoSigFigs !== "boolean") {
    throw new InvalidMeasurementError(`${what} autoSigFigs must be a boolean`);
  }
}

function assertLinearUncertaintyUnit(unit: Unit, what: string): void {
  if (isAffineUnit(unit)) {
    throw new InvalidMeasurementError(
      `${what} uncertainty unit "${unit.symbol}" is affine: express temperature uncertainties ` +
        `in kelvin (scale-only intervals), never in °C/°F`,
    );
  }
  if (unit.conversion.kind === "logarithmic" || unit.conversion.kind === "custom") {
    throw new InvalidMeasurementError(
      `${what} uncertainty unit "${unit.symbol}" has a ${unit.conversion.kind} conversion: ` +
        `uncertainty propagation through nonlinear scales is not supported; ` +
        `evaluate Quantities first, then wrap the result`,
    );
  }
}

/**
 * Audit §8: nominal values may be affine (absolute temperatures are valid
 * measurands) but never logarithmic/custom — no Measurement operation can
 * represent uncertainty on a nonlinear scale, so construction fails here
 * instead of leaving a time bomb for later arithmetic.
 */
function assertMeasurableValueUnit(unit: Unit, what: string): void {
  if (unit.conversion.kind === "logarithmic" || unit.conversion.kind === "custom") {
    throw new InvalidMeasurementError(
      `${what} value unit "${unit.symbol}" has a ${unit.conversion.kind} conversion: ` +
        `measurements require linear or affine nominal units`,
    );
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export class Measurement {
  /** Nominal measured value. */
  readonly value: Quantity;
  /** Absolute uncertainty, same dimension as value, linear conversion, finite and ≥ 0. */
  readonly uncertainty: Quantity;
  /** Optional frozen metadata (never affects mathematical identity). */
  readonly metadata?: MeasurementMetadata;
  /** Significant figures for presentation (derived from metadata if not explicitly set). */
  readonly significantFigures?: number;
  /** Confidence interval for the measurement. */
  readonly confidenceInterval?: ConfidenceInterval;
  /** Provenance tracking. */
  readonly provenance?: MeasurementProvenance;
  /** Correlation with another measurement. */
  readonly correlation?: CorrelationSpec;
  /** Whether significant figures are auto-calculated from uncertainty. */
  readonly autoSigFigs?: boolean;

  private constructor(value: Quantity, uncertainty: Quantity, metadata?: MeasurementMetadata) {
    this.value = value;
    this.uncertainty = uncertainty;
    // Deep-copy-freeze known nested structure: a shallow freeze would leave
    // provenance.derivedFrom (caller-held array) and sibling objects mutable
    // through the caller's references. Measurements inside derivedFrom are
    // already frozen, so only containers are copied.
    if (metadata === undefined) {
      this.metadata = undefined;
    } else {
      const provenance =
        metadata.provenance === undefined
          ? undefined
          : Object.freeze({
              ...metadata.provenance,
              derivedFrom:
                metadata.provenance.derivedFrom === undefined
                  ? undefined
                  : Object.freeze([...metadata.provenance.derivedFrom]),
            });
      this.metadata = Object.freeze({
        ...metadata,
        ...(metadata.significantFigures !== undefined
          ? { significantFigures: Object.freeze({ ...metadata.significantFigures }) }
          : {}),
        ...(metadata.confidenceInterval !== undefined
          ? { confidenceInterval: Object.freeze({ ...metadata.confidenceInterval }) }
          : {}),
        ...(provenance !== undefined ? { provenance } : {}),
        ...(metadata.correlation !== undefined
          ? { correlation: Object.freeze({ ...metadata.correlation }) }
          : {}),
      });
    }
    // Extract commonly accessed fields for convenience
    this.significantFigures = metadata?.significantFigures?.sigFigs;
    this.confidenceInterval = metadata?.confidenceInterval;
    this.provenance = metadata?.provenance;
    this.correlation = metadata?.correlation;
    this.autoSigFigs = metadata?.autoSigFigs;
    Object.freeze(this);
  }

  /** Dimension of the nominal value (shorthand). */
  get dimension(): DimensionVector {
    return this.value.dimension;
  }

  /** Semantic kind of the nominal value, if it claims one (Phase 22). */
  get kind(): string | undefined {
    return this.value.kind;
  }

  // ---- Construction -------------------------------------------------------

  /**
   * Build a measurement from a nominal Quantity and an uncertainty given
   * either as an absolute Quantity (same dimension, linear unit) or as a
   * relative dimensionless fraction (e.g. 0.02 for ±2%).
   *
   * A relative uncertainty requires a finite nominal value; an absolute
   * uncertainty must be finite and non-negative. Use `Measurement.exact`
   * for stated-exact values.
   */
  static of(
    value: Quantity,
    uncertainty: Quantity | number,
    metadata?: MeasurementMetadata,
  ): Measurement {
    if (!(value instanceof Quantity)) {
      throw new InvalidMeasurementError(
        `Measurement value must be a Quantity, got ${typeof value}`,
      );
    }
    assertValidMetadata(metadata, "Measurement");
    assertMeasurableValueUnit(value.unit, "Measurement");
    let absolute: Quantity;
    if (typeof uncertainty === "number") {
      if (!Number.isFinite(uncertainty) || uncertainty < 0) {
        throw new InvalidMeasurementError(
          `Relative uncertainty must be a finite number ≥ 0, got ${String(uncertainty)}`,
        );
      }
      if (!Number.isFinite(value.value)) {
        throw new InvalidMeasurementError(
          `Relative uncertainty of a non-finite nominal value is undefined; use an absolute Quantity instead`,
        );
      }
      if (isAffineUnit(value.unit)) {
        throw new InvalidMeasurementError(
          `Relative uncertainty for affine unit "${value.unit.symbol}" is ambiguous; use an absolute Quantity in K (linear interval)`,
        );
      }
      absolute = Quantity.of(Math.abs(value.value) * uncertainty, value.unit);
      assertLinearUncertaintyUnit(absolute.unit, "Measurement (relative)");
    } else {
      if (!(uncertainty instanceof Quantity)) {
        throw new InvalidMeasurementError(
          `Measurement uncertainty must be a Quantity or a relative fraction, got ${typeof uncertainty}`,
        );
      }
      if (!dimensionsEqual(value.dimension, uncertainty.dimension)) {
        throw new InvalidMeasurementError(
          `Uncertainty dimension must match value dimension: ` +
            `"${uncertainty.unit.symbol}" is not compatible with "${value.unit.symbol}"`,
        );
      }
      assertLinearUncertaintyUnit(uncertainty.unit, "Measurement");
      if (!Number.isFinite(uncertainty.value) || uncertainty.value < 0) {
        throw new InvalidMeasurementError(
          `Absolute uncertainty must be finite and ≥ 0, got ${String(uncertainty.value)}`,
        );
      }
      absolute = uncertainty;
    }
    return new Measurement(value, absolute, metadata);
  }

  /**
   * A stated-exact value (zero uncertainty). This records an explicit claim,
   * not perfect physical knowledge — e.g. defined constants or counted integers.
   * Exactness is never inferred from a numeric literal automatically.
   */
  static exact(value: Quantity, metadata?: MeasurementMetadata): Measurement {
    if (!(value instanceof Quantity)) {
      throw new InvalidMeasurementError(
        `Measurement value must be a Quantity, got ${typeof value}`,
      );
    }
    assertValidMetadata(metadata, "Measurement");
    assertMeasurableValueUnit(value.unit, "Measurement");
    return new Measurement(value, Quantity.of(0, value.unit), metadata);
  }

  // ---- Conversion -----------------------------------------------------------

  /**
   * Convert nominal value and uncertainty to the target unit. The nominal
   * value converts normally; the uncertainty converts SCALE-ONLY
   * (delta factor), so affine offsets never corrupt intervals:
   * 10 ± 2 K → °C stays ±2, not ±275.15.
   */
  to(targetUnitSymbol: string | Unit, registry: UnitRegistry = defaultUnitRegistry): Measurement {
    const newValue = this.value.to(targetUnitSymbol, registry);
    const target = newValue.unit;
    const factor = Measurement.deltaScale(this.uncertainty.unit, target);
    const newUncertainty = Quantity.of(this.uncertainty.value * factor, target);
    checkFiniteResult(newUncertainty.value, "Measurement.to uncertainty");
    return new Measurement(newValue, newUncertainty, this.metadata);
  }

  /**
   * Pure scale factor between two units of the same dimension, ignoring any
   * affine offset: factor = convert(1) − convert(0). For linear units this
   * equals the ordinary ratio; for affine units it is the interval scale.
   */
  private static deltaScale(from: Unit, to: Unit): number {
    // convert() validates dimensional compatibility first.
    return convert(1, from, to) - convert(0, from, to);
  }

  // ---- Arithmetic (first-order independent propagation) -----------------------
  //
  // All methods assume INDEPENDENT uncertainties. Correlated inputs must be
  // decorrelated by the caller — covariance is a documented limitation.

  private assertCompatible(other: Measurement, op: string): void {
    if (!dimensionsEqual(this.dimension, other.dimension)) {
      throw new UnitMismatchError(this.value.unit.symbol, other.value.unit.symbol);
    }
    void op;
  }

  /** Add nominal values; uncertainties combine in quadrature. Result keeps left unit. */
  add(other: Measurement, opts: MeasurementArithmeticOptions = {}): Measurement {
    this.assertCompatible(other, "add");
    const value = this.value.add(other.value, opts);
    const sThis = linearScaleOf(this.uncertainty.unit);
    const sOther = linearScaleOf(other.uncertainty.unit);
    const sResult = linearScaleOf(value.unit);
    const combined =
      Math.sqrt((this.uncertainty.value * sThis) ** 2 + (other.uncertainty.value * sOther) ** 2) /
      sResult;
    checkFiniteResult(combined, "Measurement.add uncertainty");
    return new Measurement(value, Quantity.of(combined, value.unit), this.metadata);
  }

  /** Subtract nominal values; uncertainties combine in quadrature. */
  subtract(other: Measurement, opts: MeasurementArithmeticOptions = {}): Measurement {
    this.assertCompatible(other, "subtract");
    const value = this.value.subtract(other.value, opts);
    const sThis = linearScaleOf(this.uncertainty.unit);
    const sOther = linearScaleOf(other.uncertainty.unit);
    const sResult = linearScaleOf(value.unit);
    const combined =
      Math.sqrt((this.uncertainty.value * sThis) ** 2 + (other.uncertainty.value * sOther) ** 2) /
      sResult;
    checkFiniteResult(combined, "Measurement.subtract uncertainty");
    return new Measurement(value, Quantity.of(combined, value.unit), this.metadata);
  }

  /**
   * Multiply nominal values; relative uncertainties combine in quadrature.
   * A zero nominal value with nonzero uncertainty is undefined → NumericalError.
   */
  multiply(other: Measurement): Measurement {
    const value = this.value.multiply(other.value);
    const r1 = Measurement.relativeOf(this);
    const r2 = Measurement.relativeOf(other);
    const combined = Math.abs(value.value) * Math.sqrt(r1 * r1 + r2 * r2);
    checkFiniteResult(combined, "Measurement.multiply uncertainty");
    return new Measurement(value, Quantity.of(combined, value.unit), this.metadata);
  }

  /**
   * Divide nominal values; relative uncertainties combine in quadrature.
   * Zero divisors throw via Quantity.divide; zero nominals follow the
   * same undefined-relative rule as multiply.
   */
  divide(other: Measurement): Measurement {
    const value = this.value.divide(other.value);
    const r1 = Measurement.relativeOf(this);
    const r2 = Measurement.relativeOf(other);
    const combined = Math.abs(value.value) * Math.sqrt(r1 * r1 + r2 * r2);
    checkFiniteResult(combined, "Measurement.divide uncertainty");
    return new Measurement(value, Quantity.of(combined, value.unit), this.metadata);
  }

  /** Integer power; relative uncertainty scales by |n|. Delegates dimension math to Quantity.pow. */
  pow(power: number): Measurement {
    if (!Number.isInteger(power)) {
      throw new NumericalError(`Measurement.pow() power must be an integer, got ${power}`);
    }
    const value = this.value.pow(power);
    const r = Measurement.relativeOf(this);
    const combined = Math.abs(value.value) * Math.abs(power) * r;
    checkFiniteResult(combined, "Measurement.pow uncertainty");
    return new Measurement(value, Quantity.of(combined, value.unit), this.metadata);
  }

  /** Scale nominal and uncertainty by |factor|; unit preserved. */
  scale(factor: number): Measurement {
    if (typeof factor !== "number") {
      throw new NumericalError(`Scale factor must be a number, got ${typeof factor}`);
    }
    const value = this.value.scale(factor);
    const unc = Math.abs(factor) * this.uncertainty.value;
    checkFiniteResult(unc, "Measurement.scale uncertainty");
    return new Measurement(value, Quantity.of(unc, this.uncertainty.unit), this.metadata);
  }

  /** Negate the nominal value; uncertainty unchanged (symmetric). */
  negate(): Measurement {
    return new Measurement(this.value.negate(), this.uncertainty, this.metadata);
  }

  /** Absolute nominal value; uncertainty unchanged (symmetric). */
  abs(): Measurement {
    return new Measurement(this.value.abs(), this.uncertainty, this.metadata);
  }

  /** Relative uncertainty u/|v| as a fraction. Zero value: 0 if u==0 else NumericalError. */
  relativeUncertainty(): number {
    return Measurement.relativeOf(this);
  }

  private static relativeOf(m: Measurement): number {
    if (isAffineUnit(m.value.unit)) {
      throw new NumericalError(
        `Relative uncertainty is undefined for affine unit "${m.value.unit.symbol}"; convert to K (linear interval) first`,
      );
    }
    // Unit-aware: compare in base units so mixed representations
    // (e.g. 10 kg ± 200 g) yield the physical ratio, not a unit artifact.
    // The uncertainty unit is always linear (affine rejected at
    // construction), so its toBase is a pure scale.
    const vBase = Math.abs(m.value.toBase().value);
    const uBase = m.uncertainty.toBase().value;
    if (uBase === 0) return 0;
    if (vBase === 0) {
      throw new NumericalError(
        `Relative uncertainty of zero nominal value with nonzero uncertainty is undefined`,
      );
    }
    return uBase / vBase;
  }

  // ---- Comparison -------------------------------------------------------------

  /**
   * Exact equality: same dimension, Object.is on nominal and uncertainty
   * base values. Metadata never affects identity.
   */
  exactEquals(other: Measurement): boolean {
    if (!dimensionsEqual(this.dimension, other.dimension)) return false;
    return (
      Object.is(this.value.toBase().value, other.value.toBase().value) &&
      Object.is(this.uncertainty.toBase().value, other.uncertainty.toBase().value)
    );
  }

  /**
   * Approximate equality: nominal and uncertainty both within tolerance.
   * Metadata never affects identity.
   */
  equals(other: Measurement, epsilon: number | ComparisonOptions = 1e-9): boolean {
    if (!dimensionsEqual(this.dimension, other.dimension)) return false;
    const opts: ComparisonOptions = typeof epsilon === "number" ? { epsilon } : epsilon;
    return (
      approxEqualNumeric(this.value.toBase().value, other.value.toBase().value, opts) &&
      approxEqualNumeric(this.uncertainty.toBase().value, other.uncertainty.toBase().value, opts)
    );
  }

  /** Explicit alias for equals with tolerance. */
  approximatelyEquals(other: Measurement, epsilon: number | ComparisonOptions = 1e-9): boolean {
    return this.equals(other, epsilon);
  }

  /**
   * Explicit interval-overlap check: [v−u, v+u] ranges intersect (inclusive,
   * compared in base units). Never implicit — call this deliberately.
   * NaN bounds never overlap (returns false).
   */
  overlaps(other: Measurement): boolean {
    if (!dimensionsEqual(this.dimension, other.dimension)) {
      throw new UnitMismatchError(this.value.unit.symbol, other.value.unit.symbol);
    }
    const aBase = this.value.toBase().value;
    const aUnc = this.uncertainty.toBase().value;
    const bBase = other.value.toBase().value;
    const bUnc = other.uncertainty.toBase().value;
    if ([aBase, aUnc, bBase, bUnc].some((x) => Number.isNaN(x))) return false;
    return aBase - aUnc <= bBase + bUnc && bBase - bUnc <= aBase + aUnc;
  }

  toString(): string {
    const basis = this.value.unit.basis ? ` ${this.value.unit.basis}` : "";
    return `${this.value.value} ± ${this.uncertainty.value} ${this.value.unit.symbol}${basis}`;
  }

  /** Calculate significant figures from uncertainty if autoSigFigs is enabled. */
  private computeAutoSigFigs(): number {
    if (!this.autoSigFigs) return 0;
    // Based on ISO 80000-1: significant figures ≈ -log10(relative uncertainty)
    const relUnc = this.relativeUncertainty();
    if (relUnc === 0) return 1;
    return Math.max(1, Math.floor(-Math.log10(relUnc)) + 1);
  }

  /** Get effective significant figures (explicit or auto-calculated). */
  getEffectiveSigFigs(): number {
    if (this.significantFigures !== undefined) return this.significantFigures;
    return this.computeAutoSigFigs();
  }

  /** Format value with effective significant figures. */
  formatWithSigFigs(requestedNotation?: "standard" | "scientific" | "engineering"): string {
    const sigFigs = this.getEffectiveSigFigs();
    const notation = this.metadata?.significantFigures?.notation ?? requestedNotation ?? "standard";
    const value = this.value.value;
    switch (notation) {
      case "scientific":
        return toScientificNotation(value, sigFigs);
      case "engineering":
        return toEngineeringNotation(value, sigFigs);
      default:
        return toSignificantFigures(value, sigFigs);
    }
  }

  /** Get the confidence interval for this measurement. */
  getConfidenceInterval(): { lower: Quantity; upper: Quantity; coverageFactor: number } | null {
    if (!this.confidenceInterval) return null;
    const coverageFactor = this.confidenceInterval.coverageFactor;
    const uncBase = this.uncertainty.toBase().value;
    const valueBase = this.value.toBase().value;
    const margin = coverageFactor * uncBase;
    const lowerBase = valueBase - margin;
    const upperBase = valueBase + margin;
    const lower = Quantity.of(lowerBase, this.value.unit).to(this.value.unit);
    const upper = Quantity.of(upperBase, this.value.unit).to(this.value.unit);
    return { lower, upper, coverageFactor: this.confidenceInterval.coverageFactor };
  }

  /** Correlation-aware addition: σ = √(σ₁² + σ₂² + 2ρσ₁σ₂) */
  addCorrelated(other: Measurement, correlation?: CorrelationSpec): Measurement {
    const rho = correlation?.coefficient ?? other.correlation?.coefficient ?? 0;
    this.assertCompatible(other, "addCorrelated");
    const value = this.value.add(other.value);
    const sThis = linearScaleOf(this.uncertainty.unit);
    const sOther = linearScaleOf(other.uncertainty.unit);
    const sResult = linearScaleOf(value.unit);
    const u1 = (this.uncertainty.value * sThis) / sResult;
    const u2 = (other.uncertainty.value * sOther) / sResult;
    const combined = Math.sqrt(u1 * u1 + u2 * u2 + 2 * rho * u1 * u2);
    checkFiniteResult(combined, "Measurement.addCorrelated uncertainty");
    return new Measurement(value, Quantity.of(combined, value.unit), this.metadata);
  }

  /** Correlation-aware subtraction: σ = √(σ₁² + σ₂² - 2ρσ₁σ₂) */
  subtractCorrelated(other: Measurement, correlation?: CorrelationSpec): Measurement {
    const rho = correlation?.coefficient ?? other.correlation?.coefficient ?? 0;
    this.assertCompatible(other, "subtractCorrelated");
    const value = this.value.subtract(other.value);
    const sThis = linearScaleOf(this.uncertainty.unit);
    const sOther = linearScaleOf(other.uncertainty.unit);
    const sResult = linearScaleOf(value.unit);
    const u1 = (this.uncertainty.value * sThis) / sResult;
    const u2 = (other.uncertainty.value * sOther) / sResult;
    const combined = Math.sqrt(u1 * u1 + u2 * u2 - 2 * rho * u1 * u2);
    checkFiniteResult(combined, "Measurement.subtractCorrelated uncertainty");
    return new Measurement(value, Quantity.of(combined, value.unit), this.metadata);
  }

  /** Correlation-aware multiplication: relative σ = √(r₁² + r₂² + 2ρr₁r₂) */
  multiplyCorrelated(other: Measurement, correlation?: CorrelationSpec): Measurement {
    const rho = correlation?.coefficient ?? other.correlation?.coefficient ?? 0;
    const value = this.value.multiply(other.value);
    const r1 = Measurement.relativeOf(this);
    const r2 = Measurement.relativeOf(other);
    const combinedRel = Math.sqrt(r1 * r1 + r2 * r2 + 2 * rho * r1 * r2);
    const combined = Math.abs(value.value) * combinedRel;
    checkFiniteResult(combined, "Measurement.multiplyCorrelated uncertainty");
    return new Measurement(value, Quantity.of(combined, value.unit), this.metadata);
  }

  /** Correlation-aware division: relative σ = √(r₁² + r₂² - 2ρr₁r₂) */
  divideCorrelated(other: Measurement, correlation?: CorrelationSpec): Measurement {
    const rho = correlation?.coefficient ?? other.correlation?.coefficient ?? 0;
    const value = this.value.divide(other.value);
    const r1 = Measurement.relativeOf(this);
    const r2 = Measurement.relativeOf(other);
    const combinedRel = Math.sqrt(r1 * r1 + r2 * r2 - 2 * rho * r1 * r2);
    const combined = Math.abs(value.value) * combinedRel;
    checkFiniteResult(combined, "Measurement.divideCorrelated uncertainty");
    return new Measurement(value, Quantity.of(combined, value.unit), this.metadata);
  }
}

// ---------------------------------------------------------------------------
// Expression integration (measurement-aware evaluation)
// ---------------------------------------------------------------------------

/**
 * Evaluate a declarative Expression with Measurement (or plain Quantity)
 * bindings. Plain Quantities are treated as exact. Reuses the Expression
 * AST shape but applies Measurement algebra per node — the Quantity
 * evaluator is never duplicated, only orchestrated through Measurement.
 */
export function evaluateMeasurement(
  expr: Expression,
  context: Record<string, Measurement | Quantity>,
  opts: { registry?: UnitRegistry } = {},
): Measurement {
  const registry = opts.registry ?? defaultUnitRegistry;
  return evalMeasurementNode(expr, context, registry, 0);
}

function evalMeasurementNode(
  expr: Expression,
  context: Record<string, Measurement | Quantity>,
  registry: UnitRegistry,
  depth: number,
): Measurement {
  if (depth > 64) {
    throw new InvalidMeasurementError(`Measurement expression evaluation exceeded depth 64`);
  }
  switch (expr.kind) {
    case "literal":
      return Measurement.exact(Quantity.of(expr.value, expr.unit, registry));
    case "variable": {
      if (!Object.prototype.hasOwnProperty.call(context, expr.name)) {
        throw new InvalidMeasurementError(
          `Unknown variable "${expr.name}": no Measurement binding in the evaluation context`,
        );
      }
      const bound = (context as Record<string, unknown>)[expr.name];
      if (bound instanceof Measurement) return bound;
      if (bound instanceof Quantity) return Measurement.exact(bound);
      throw new InvalidMeasurementError(
        `Variable "${expr.name}" must be bound to a Measurement or Quantity`,
      );
    }
    case "add":
      return evalMeasurementNode(expr.left, context, registry, depth + 1).add(
        evalMeasurementNode(expr.right, context, registry, depth + 1),
      );
    case "subtract":
      return evalMeasurementNode(expr.left, context, registry, depth + 1).subtract(
        evalMeasurementNode(expr.right, context, registry, depth + 1),
      );
    case "multiply":
      return evalMeasurementNode(expr.left, context, registry, depth + 1).multiply(
        evalMeasurementNode(expr.right, context, registry, depth + 1),
      );
    case "divide":
      return evalMeasurementNode(expr.left, context, registry, depth + 1).divide(
        evalMeasurementNode(expr.right, context, registry, depth + 1),
      );
    case "power":
      return evalMeasurementNode(expr.base, context, registry, depth + 1).pow(expr.exponent);
    case "convert":
      return evalMeasurementNode(expr.expr, context, registry, depth + 1).to(expr.unit, registry);
    case "call":
      return evalMeasurementNodeCall(expr, context, registry, depth + 1);
    default:
      throw new InvalidMeasurementError(
        `Unknown expression node kind "${(expr as { kind: string }).kind}"`,
      );
  }
}

/**
 * Evaluate a function call node with uncertainty propagation.
 * Uses first-order Taylor expansion: σ_f ≈ |f'(x)| σ_x for unary,
 * and general multivariate formula for multi-argument functions.
 */
function evalMeasurementNodeCall(
  expr: Expression & { kind: "call" },
  context: Record<string, Measurement | Quantity>,
  registry: UnitRegistry,
  depth: number,
): Measurement {
  if (depth > 64) {
    throw new InvalidMeasurementError(`Measurement expression evaluation exceeded depth 64`);
  }
  // Evaluate all arguments first
  const argResults = expr.args.map((arg) => evalMeasurementNode(arg, context, registry, depth + 1));
  const requireArg = (index: number): Measurement => {
    const arg = argResults[index];
    if (arg === undefined) {
      throw new InvalidMeasurementError(
        `Function "${expr.function}" missing argument at index ${index}`,
      );
    }
    return arg;
  };
  // Radian value for trig derivatives: dimensionless values are radians by
  // convention; angle-kind units convert via the registry.
  const radianValue = (value: Quantity): number => {
    if (Object.keys(value.dimension).length === 0) return value.value;
    return value.to("rad", registry).value;
  };

  // Built-in functions with first-order propagation. Anything else throws
  // explicitly — never silently drop uncertainty.
  switch (expr.function) {
    case "sqrt": {
      const arg = requireArg(0);
      const value = arg.value.sqrt();
      // σ_f = |1/(2√x)| σ_x
      const combinedUnc = Math.abs(value.value) * (0.5 * arg.relativeUncertainty());
      return Measurement.of(value, Quantity.of(combinedUnc, value.unit), arg.metadata);
    }
    case "cbrt": {
      const arg = requireArg(0);
      const value = arg.value.cbrt();
      // σ_f = |1/(3∛x²)| σ_x
      const combinedUnc = Math.abs(value.value) * ((1 / 3) * arg.relativeUncertainty());
      return Measurement.of(value, Quantity.of(combinedUnc, value.unit), arg.metadata);
    }
    case "abs": {
      const arg = requireArg(0);
      return Measurement.of(arg.value.abs(), arg.uncertainty, arg.metadata);
    }
    case "negate": {
      const arg = requireArg(0);
      return Measurement.of(arg.value.negate(), arg.uncertainty, arg.metadata);
    }
    case "reciprocal": {
      const arg = requireArg(0);
      const value = arg.value.reciprocal();
      const rel = arg.relativeUncertainty();
      const combined = Math.abs(value.value) * rel;
      return Measurement.of(value, Quantity.of(combined, value.unit), arg.metadata);
    }
    case "exp": {
      const arg = requireArg(0);
      const value = arg.value.exp();
      // σ_f = f(x) σ_x (since f'(x) = f(x))
      const combinedUnc = value.value * arg.relativeUncertainty();
      return Measurement.of(value, Quantity.of(combinedUnc, value.unit), arg.metadata);
    }
    case "ln": {
      const arg = requireArg(0);
      const value = arg.value.ln();
      // σ_f = |1/x| σ_x = r
      return Measurement.of(
        value,
        Quantity.of(arg.relativeUncertainty(), value.unit),
        arg.metadata,
      );
    }
    case "log10": {
      const arg = requireArg(0);
      const value = arg.value.log10();
      // σ_f = |1/(x ln 10)| σ_x = r / ln(10)
      const combinedUnc = arg.relativeUncertainty() / Math.LN10;
      return Measurement.of(value, Quantity.of(combinedUnc, value.unit), arg.metadata);
    }
    case "sin": {
      const arg = requireArg(0);
      const value = arg.value.sin();
      // σ_f = |cos(x)| σ_x
      const combinedUnc =
        Math.abs(Math.cos(radianValue(arg.value))) * arg.uncertainty.toBase().value;
      return Measurement.of(value, Quantity.of(combinedUnc, value.unit), arg.metadata);
    }
    case "cos": {
      const arg = requireArg(0);
      const value = arg.value.cos();
      // σ_f = |sin(x)| σ_x
      const combinedUnc =
        Math.abs(Math.sin(radianValue(arg.value))) * arg.uncertainty.toBase().value;
      return Measurement.of(value, Quantity.of(combinedUnc, value.unit), arg.metadata);
    }
    case "tan": {
      const arg = requireArg(0);
      const value = arg.value.tan();
      // σ_f = |sec²(x)| σ_x
      const secVal = 1 / Math.cos(radianValue(arg.value));
      const combinedUnc = secVal * secVal * arg.uncertainty.toBase().value;
      return Measurement.of(value, Quantity.of(combinedUnc, value.unit), arg.metadata);
    }
    case "min":
    case "max": {
      // For min/max, uncertainty is the uncertainty of the selected value
      const a = requireArg(0);
      const b = requireArg(1);
      const value = expr.function === "min" ? a.value.min(b.value) : a.value.max(b.value);
      const selected = value === a.value ? a : b;
      return Measurement.of(value, selected.uncertainty, selected.metadata);
    }
    default:
      throw new InvalidMeasurementError(
        `Function "${expr.function}" is not supported for Measurement bindings: ` +
          `uncertainty propagation through arbitrary functions is undefined; ` +
          `evaluate Quantities first, then wrap the result.`,
      );
  }
}

export function inferMeasurementDimension(
  expr: Expression,
  varDimensions: VariableDimensions,
  opts: { registry?: UnitRegistry } = {},
): DimensionVector {
  // Delegate to the generic engine: dimensions don't depend on uncertainty.
  // Registry and limits pass straight through.
  return inferDim(expr, varDimensions, opts);
}

// ---------------------------------------------------------------------------
// Serialization (versioned, deterministic, validated)
// ---------------------------------------------------------------------------

export interface SerializedMeasurement {
  version: 1;
  type: "measurement";
  value: { version: 1; type: "quantity"; value: number | string; unit: string };
  uncertainty: { version: 1; type: "quantity"; value: number | string; unit: string };
  method: "linearized";
  confidenceLevel?: number;
  source?: string;
  instrumentId?: string;

  // Phase 25 extensions
  significantFigures?: { sigFigs: number; notation?: "standard" | "scientific" | "engineering" };
  confidenceInterval?: {
    coverageFactor: number;
    confidenceLevel?: number;
    distribution?: "normal" | "t" | "uniform" | "rectangular" | "triangular";
    degreesOfFreedom?: number;
  };
  provenance?: {
    method?: string;
    instrumentId?: string;
    laboratoryId?: string;
    operatorId?: string;
    timestamp?: string;
    source?: string;
    integrityHash?: string;
    derivedFrom?: readonly SerializedMeasurement[];
  };
  correlation?: { with: SerializedMeasurement; coefficient: number };
  autoSigFigs?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasPollutionKeys(obj: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
    Object.prototype.hasOwnProperty.call(obj, "constructor") ||
    Object.prototype.hasOwnProperty.call(obj, "prototype")
  );
}

function encodeMeasurementValue(v: number): number | string {
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  if (Object.is(v, -0)) return "-0";
  return v;
}

/**
 * Serialize a Measurement to versioned declarative data. Key order is
 * explicit and deterministic. Never serializes functions. Special numeric
 * values (NaN/Infinity/-Infinity/-0) use the same string encoding as
 * serializeQuantity so they survive JSON.
 */
export function serializeMeasurement(m: Measurement): SerializedMeasurement {
  if (!(m instanceof Measurement)) {
    throw new InvalidMeasurementError("Can only serialize Measurement instances");
  }
  const out: SerializedMeasurement = {
    version: 1,
    type: "measurement",
    value: {
      version: 1,
      type: "quantity",
      value: encodeMeasurementValue(m.value.value),
      unit:
        m.value.unit.basis != null
          ? `${m.value.unit.symbol} ${m.value.unit.basis}`
          : m.value.unit.symbol,
    },
    uncertainty: {
      version: 1,
      type: "quantity",
      value: encodeMeasurementValue(m.uncertainty.value),
      unit:
        m.uncertainty.unit.basis != null
          ? `${m.uncertainty.unit.symbol} ${m.uncertainty.unit.basis}`
          : m.uncertainty.unit.symbol,
    },
    method: "linearized",
  };
  const withMeta = out as unknown as Record<string, unknown>;
  if (m.metadata?.confidenceLevel !== undefined)
    withMeta.confidenceLevel = m.metadata.confidenceLevel;
  if (m.metadata?.source !== undefined) withMeta.source = m.metadata.source;
  if (m.metadata?.instrumentId !== undefined) withMeta.instrumentId = m.metadata.instrumentId;

  // Phase 25 extensions
  if (m.significantFigures !== undefined) {
    withMeta.significantFigures = {
      sigFigs: m.significantFigures,
      notation: m.metadata?.significantFigures?.notation,
    };
  }
  if (m.confidenceInterval !== undefined) {
    withMeta.confidenceInterval = {
      coverageFactor: m.confidenceInterval.coverageFactor,
      confidenceLevel: m.confidenceInterval.confidenceLevel,
      distribution: m.confidenceInterval.distribution,
      degreesOfFreedom: m.confidenceInterval.degreesOfFreedom,
    };
  }
  if (m.provenance !== undefined) {
    withMeta.provenance = {
      method: m.provenance.method,
      instrumentId: m.provenance.instrumentId,
      laboratoryId: m.provenance.laboratoryId,
      operatorId: m.provenance.operatorId,
      timestamp: m.provenance.timestamp,
      source: m.provenance.source,
      integrityHash: m.provenance.integrityHash,
      derivedFrom: m.provenance.derivedFrom?.map(serializeMeasurement),
    };
  }
  if (m.correlation !== undefined) {
    withMeta.correlation = {
      with: serializeMeasurement(m.correlation.with),
      coefficient: m.correlation.coefficient,
    };
  }
  if (m.autoSigFigs !== undefined) {
    withMeta.autoSigFigs = m.autoSigFigs;
  }
  return Object.freeze(out);
}

export function deserializeMeasurement(
  data: unknown,
  registry: UnitRegistry = defaultUnitRegistry,
  depth = 0,
): Measurement {
  if (!isPlainObject(data)) {
    throw new InvalidMeasurementError(
      `Serialized measurement must be a plain object, got ${data === null ? "null" : typeof data}`,
    );
  }
  if (hasPollutionKeys(data)) {
    throw new InvalidMeasurementError("Serialized measurement contains forbidden prototype keys");
  }
  if (Array.isArray(data)) {
    throw new InvalidMeasurementError("Serialized measurement must not be an array");
  }
  // Nested correlation/derivation chains recurse; bound the depth so
  // malicious or cyclic payloads terminate with a typed error.
  if (depth > 16) {
    throw new InvalidMeasurementError("Serialized measurement nesting exceeds depth 16");
  }
  const d = data as Record<string, unknown>;
  const {
    version,
    type,
    value,
    uncertainty,
    method,
    confidenceLevel,
    source,
    instrumentId,
    significantFigures,
    confidenceInterval,
    provenance,
    correlation,
    autoSigFigs,
  } = d;
  if (version !== 1) {
    if (version === undefined)
      throw new InvalidMeasurementError("Serialized measurement missing version");
    throw new InvalidMeasurementError(
      `Unsupported serialized measurement version ${String(version)}`,
    );
  }
  if (type !== "measurement") {
    throw new InvalidMeasurementError(`Serialized measurement has wrong type "${String(type)}"`);
  }
  if (method !== undefined && method !== "linearized") {
    throw new InvalidMeasurementError(
      `Unsupported measurement method "${String(method)}" (only "linearized"; interval and Monte Carlo are deferred)`,
    );
  }
  const valueQ = decodeNestedQuantity(value, "value", registry);
  const uncQ = decodeNestedQuantity(uncertainty, "uncertainty", registry);
  const metadata: Record<string, unknown> = {};
  if (confidenceLevel !== undefined) metadata.confidenceLevel = confidenceLevel;
  if (source !== undefined) metadata.source = source;
  if (instrumentId !== undefined) metadata.instrumentId = instrumentId;
  if (significantFigures !== undefined) {
    if (typeof significantFigures === "object" && significantFigures !== null) {
      const sf = significantFigures as Record<string, unknown>;
      metadata.significantFigures = {
        sigFigs: sf.sigFigs,
        notation: sf.notation,
      };
    }
  }
  if (confidenceInterval !== undefined) {
    if (typeof confidenceInterval === "object" && confidenceInterval !== null) {
      const ci = confidenceInterval as Record<string, unknown>;
      metadata.confidenceInterval = {
        coverageFactor: ci.coverageFactor,
        confidenceLevel: ci.confidenceLevel,
        distribution: ci.distribution,
        degreesOfFreedom: ci.degreesOfFreedom,
      };
    }
  }
  if (provenance !== undefined) {
    if (typeof provenance === "object" && provenance !== null) {
      const prov = provenance as Record<string, unknown>;
      const rawDerived = prov.derivedFrom;
      metadata.provenance = {
        method: prov.method,
        instrumentId: prov.instrumentId,
        laboratoryId: prov.laboratoryId,
        operatorId: prov.operatorId,
        timestamp: prov.timestamp,
        source: prov.source,
        integrityHash: prov.integrityHash,
        derivedFrom: Array.isArray(rawDerived)
          ? rawDerived.map((d) => deserializeMeasurement(d, registry, depth + 1))
          : undefined,
      };
    }
  }
  if (correlation !== undefined) {
    if (typeof correlation === "object" && correlation !== null) {
      const corr = correlation as Record<string, unknown>;
      // The referenced measurement must deserialize first; resolve eagerly.
      metadata.correlation = {
        with: deserializeMeasurement(corr.with, registry, depth + 1),
        coefficient: corr.coefficient,
      };
    }
  }
  if (autoSigFigs !== undefined) metadata.autoSigFigs = autoSigFigs;

  return Measurement.of(
    valueQ,
    uncQ,
    Object.keys(metadata).length > 0 ? (metadata as MeasurementMetadata) : undefined,
  );
}

// ---------------------------------------------------------------------------
// Text parsing (controlled forms only — never ambiguous)
// ---------------------------------------------------------------------------

export interface ParseMeasurementOptions {
  readonly registry?: UnitRegistry;
  /** Maximum input characters (default 256). */
  readonly maxLength?: number;
  /** Optional metadata attached to the parsed measurement. */
  readonly metadata?: MeasurementMetadata;
}

const NUM = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const SEP = String.raw`(?:±|\+\/-)`;
// Form A: "<value> ± <uncertainty> <unit>" (shared unit, e.g. "10 ± 0.5 kg").
const MEASUREMENT_RE_A = new RegExp(`^\\s*(${NUM})\\s*${SEP}\\s*(${NUM})\\s+([^\\s].*?)\\s*$`);
// Form B: "<value> <value-unit> ± <uncertainty> <unc-unit>" (e.g. "10 kg ± 200 g").
const MEASUREMENT_RE_B = new RegExp(
  `^\\s*(${NUM})\\s+([^\\s].*?)\\s*${SEP}\\s*(${NUM})\\s+([^\\s].*?)\\s*$`,
);

/**
 * Parse a measurement in controlled forms:
 * - "10 ± 0.5 kg" (U+00B1 separator, shared unit)
 * - "10.0 +/- 0.2 m" (ASCII separator, shared unit)
 * - "10 kg ± 200 g" (explicit uncertainty unit)
 *
 * Value, uncertainty and unit(s) are unambiguous by position; anything else
 * throws InvalidMeasurementError. Respects maxLength; finite numbers only
 * (no NaN/Infinity input text). Dimension agreement is enforced by
 * Measurement.of (e.g. "10 m ± 2 s" throws).
 */
export function parseMeasurement(
  text: string,
  registry: UnitRegistry = defaultUnitRegistry,
  opts: ParseMeasurementOptions = {},
): Measurement {
  if (typeof text !== "string") {
    throw new InvalidMeasurementError("Measurement text must be a string");
  }
  const maxLength = opts.maxLength ?? 256;
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new InvalidMeasurementError("parseMeasurement maxLength must be a positive integer");
  }
  if (text.length > maxLength) {
    throw new InvalidMeasurementError(
      `Measurement text exceeds maxLength ${maxLength} (${text.length} chars)`,
    );
  }
  const activeRegistry = opts.registry ?? registry;
  const a = MEASUREMENT_RE_A.exec(text);
  const b = a === null ? MEASUREMENT_RE_B.exec(text) : null;
  const m = a ?? b;
  if (!m) {
    throw new InvalidMeasurementError(
      `Cannot parse measurement "${text.slice(0, 80)}" (expected "<value> ± <uncertainty> <unit>")`,
    );
  }
  // Form A groups: 1=value, 2=unc, 3=unit. Form B: 1=value, 2=valueUnit, 3=unc, 4=uncUnit.
  const value = Number(m[1]);
  const unc = Number(a !== null ? m[2] : m[3]);
  const valueUnit = (a !== null ? m[3] : m[2])!.trim();
  const uncUnit = (a !== null ? m[3] : m[4])!.trim();
  if (!Number.isFinite(value) || !Number.isFinite(unc)) {
    throw new InvalidMeasurementError("Measurement value and uncertainty must be finite numbers");
  }
  if (unc < 0) {
    throw new InvalidMeasurementError("Parsed uncertainty must be ≥ 0");
  }
  let valueQ: Quantity;
  let uncQ: Quantity;
  try {
    valueQ = Quantity.of(value, valueUnit, activeRegistry);
    uncQ = Quantity.of(unc, uncUnit, activeRegistry);
  } catch (error) {
    throw new InvalidMeasurementError(
      `Cannot parse measurement units in "${text.slice(0, 80)}" (${(error as Error).message})`,
    );
  }
  return Measurement.of(valueQ, uncQ, opts.metadata);
}

function decodeNestedQuantity(field: unknown, name: string, registry: UnitRegistry): Quantity {
  if (!isPlainObject(field)) {
    throw new InvalidMeasurementError(`Serialized measurement ${name} must be a plain object`);
  }
  if (hasPollutionKeys(field)) {
    throw new InvalidMeasurementError(
      `Serialized measurement ${name} contains forbidden prototype keys`,
    );
  }
  const { version, type, value, unit } = field;
  if (version !== 1 || type !== "quantity") {
    throw new InvalidMeasurementError(
      `Serialized measurement ${name} must be a versioned quantity {version:1,type:"quantity",...}`,
    );
  }
  if (typeof unit !== "string" || unit.trim().length === 0) {
    throw new InvalidMeasurementError(
      `Serialized measurement ${name} unit must be a non-empty string`,
    );
  }
  let decoded: number;
  if (typeof value === "number") {
    decoded = value;
  } else if (value === "NaN") {
    decoded = NaN;
  } else if (value === "Infinity") {
    decoded = Infinity;
  } else if (value === "-Infinity") {
    decoded = -Infinity;
  } else if (value === "-0") {
    decoded = -0;
  } else {
    throw new InvalidMeasurementError(
      `Serialized measurement ${name} value must be a number or special encoding, got ${typeof value}`,
    );
  }
  return Quantity.of(decoded, unit, registry);
}

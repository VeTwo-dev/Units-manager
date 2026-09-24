/**
 * statistics.ts — Phase 27: advanced uncertainty, statistical measurements
 * and lightweight scientific data analysis.
 *
 * Extends the Phase 25 Measurement model; duplicates nothing:
 * - Uncertainty components (Type A / Type B) combine through the same
 *   root-sum-square + covariance math as Measurement arithmetic.
 * - CovarianceMatrix is a validated, immutable, dimension-aware container
 *   with a Cholesky-based positive-semidefinite check (no linear-algebra
 *   dependency).
 * - MeasurementSeries provides unit-aware summaries (mean, weighted mean,
 *   variance, stddev, standard error) that preserve units; variance carries
 *   the squared unit, never a bare number.
 * - MeasurementDataset is a thin named-variable container with filtering,
 *   normalization, summaries and per-observation formula evaluation
 *   (delegated to the Formula Engine — no second evaluator).
 * - Nonlinear propagation with covariance (propagateWithCovariance) uses
 *   forward-mode differentiation over the existing Expression AST for
 *   +−×÷^convert; function nodes are rejected explicitly (they assume
 *   independence in evaluateMeasurement) instead of mixing models silently.
 *
 * Deliberately NOT a statistics framework: no sampling, no hypothesis
 * tests, no distributions beyond metadata. Monte Carlo exists only as a
 * typed extension point that fails explicitly.
 */
import { Quantity } from "./quantity.js";
import { Measurement, serializeMeasurement, deserializeMeasurement } from "./measurement.js";
import type { Unit } from "./unit.js";
import { defaultUnitRegistry, type UnitRegistry } from "./unit-registry.js";
import { convert } from "./conversion-engine.js";
import { dimensionKey, dimensionsEqual, type DimensionVector } from "./dimension.js";
import { parseUnit } from "./unit-parser.js";
import {
  InvalidMeasurementError,
  UnitEngineError,
  UnsupportedTransformationError,
} from "./errors/index.js";
import { checkFiniteResult } from "./numerical.js";
import type { Expression } from "./expression.js";
import { evaluateFormula, formulaVariables, type Formula } from "./formula.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export interface StatisticsLimits {
  /** Maximum observations in one series/dataset variable (default 100000). */
  readonly maxObservations?: number;
  /** Maximum covariance matrix dimension (default 32). */
  readonly maxMatrixDimension?: number;
  /** Maximum dataset variables (default 256). */
  readonly maxVariables?: number;
  /** Maximum serialized JSON characters accepted (default 1048576). */
  readonly maxSerializedChars?: number;
  /** Maximum metadata nesting depth (default 4). */
  readonly maxMetadataDepth?: number;
}

const DEFAULT_LIMITS = Object.freeze({
  maxObservations: 100000,
  maxMatrixDimension: 32,
  maxVariables: 256,
  maxSerializedChars: 1048576,
  maxMetadataDepth: 4,
});

function resolveLimits(limits?: StatisticsLimits): {
  maxObservations: number;
  maxMatrixDimension: number;
  maxVariables: number;
  maxSerializedChars: number;
  maxMetadataDepth: number;
} {
  const r = {
    maxObservations: limits?.maxObservations ?? DEFAULT_LIMITS.maxObservations,
    maxVariables: limits?.maxVariables ?? DEFAULT_LIMITS.maxVariables,
    maxMatrixDimension: limits?.maxMatrixDimension ?? DEFAULT_LIMITS.maxMatrixDimension,
    maxSerializedChars: limits?.maxSerializedChars ?? DEFAULT_LIMITS.maxSerializedChars,
    maxMetadataDepth: limits?.maxMetadataDepth ?? DEFAULT_LIMITS.maxMetadataDepth,
  };
  for (const [k, v] of Object.entries(r)) {
    if (!Number.isInteger(v) || v < 1) {
      throw new UnitEngineError(`Statistics limit ${k} must be a positive integer.`);
    }
  }
  return r;
}

function hasPollutionKeys(obj: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, "__proto__") ||
    Object.prototype.hasOwnProperty.call(obj, "constructor") ||
    Object.prototype.hasOwnProperty.call(obj, "prototype")
  );
}

function assertPlainRecord(value: unknown, what: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidMeasurementError(`${what} must be a plain object`);
  }
  if (hasPollutionKeys(value as Record<string, unknown>)) {
    throw new InvalidMeasurementError(`${what} contains forbidden prototype keys`);
  }
}

// ---------------------------------------------------------------------------
// 27.2–27.4 Uncertainty components and combination
// ---------------------------------------------------------------------------

export type UncertaintyComponentType = "A" | "B" | "combined";
export type UncertaintyDistribution = "normal" | "t" | "uniform" | "rectangular" | "triangular";

/**
 * One uncertainty component: a standard (1σ) uncertainty with explicit
 * provenance classification. Type A originates from statistical analysis
 * of repeated observations; Type B from specifications, calibration,
 * reference data or prior knowledge. The classification is never inferred —
 * the caller states it or omits it.
 */
export interface UncertaintyComponent {
  readonly id: string;
  /** Standard uncertainty (1σ). Must use a linear unit. */
  readonly standardUncertainty: Quantity;
  readonly type?: UncertaintyComponentType;
  readonly distribution?: UncertaintyDistribution;
  readonly degreesOfFreedom?: number;
  readonly description?: string;
}

export interface ComponentCorrelation {
  readonly idA: string;
  readonly idB: string;
  /** Correlation coefficient, -1 ≤ ρ ≤ 1. */
  readonly coefficient: number;
}

const COMPONENT_ID_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;

function assertValidComponent(c: UncertaintyComponent, owner: string): void {
  if (c === null || typeof c !== "object" || Array.isArray(c)) {
    throw new InvalidMeasurementError(`${owner} component must be a plain object`);
  }
  if (typeof c.id !== "string" || !COMPONENT_ID_RE.test(c.id)) {
    throw new InvalidMeasurementError(
      `${owner} component id must match /^[A-Za-z][A-Za-z0-9_.-]*$/`,
    );
  }
  if (!(c.standardUncertainty instanceof Quantity)) {
    throw new InvalidMeasurementError(
      `${owner} component "${c.id}" standardUncertainty must be a Quantity`,
    );
  }
  const u = c.standardUncertainty.value;
  if (!Number.isFinite(u) || u < 0) {
    throw new InvalidMeasurementError(
      `${owner} component "${c.id}" standardUncertainty must be finite and ≥ 0`,
    );
  }
  if (c.type !== undefined && c.type !== "A" && c.type !== "B" && c.type !== "combined") {
    throw new InvalidMeasurementError(
      `${owner} component "${c.id}" type must be "A", "B" or "combined"`,
    );
  }
  if (
    c.distribution !== undefined &&
    c.distribution !== "normal" &&
    c.distribution !== "t" &&
    c.distribution !== "uniform" &&
    c.distribution !== "rectangular" &&
    c.distribution !== "triangular"
  ) {
    throw new InvalidMeasurementError(`${owner} component "${c.id}" has an unknown distribution`);
  }
  if (
    c.degreesOfFreedom !== undefined &&
    (!Number.isInteger(c.degreesOfFreedom) || c.degreesOfFreedom < 1)
  ) {
    throw new InvalidMeasurementError(
      `${owner} component "${c.id}" degreesOfFreedom must be a positive integer`,
    );
  }
}

/**
 * Combine standard-uncertainty components:
 *   u_c² = Σ u_i² + 2 Σ ρ_ij u_i u_j
 * All components must share one dimension (covariance of unlike dimensions
 * is rejected — see CovarianceMatrix for the dimension-aware container).
 * With no correlations this is the root-sum-square of independent inputs.
 * Returns a Quantity in the first component's unit.
 */
export function combineUncertainties(
  components: readonly UncertaintyComponent[],
  opts: { correlations?: readonly ComponentCorrelation[]; registry?: UnitRegistry } = {},
): Quantity {
  if (!Array.isArray(components) || components.length === 0) {
    throw new InvalidMeasurementError("combineUncertainties needs at least one component");
  }
  const seen = new Set<string>();
  for (const c of components) {
    assertValidComponent(c, "combineUncertainties");
    if (seen.has(c.id)) {
      throw new InvalidMeasurementError(`Duplicate uncertainty component id "${c.id}"`);
    }
    seen.add(c.id);
  }
  const dim = components[0]!.standardUncertainty.dimension;
  for (const c of components) {
    if (!dimensionsEqual(c.standardUncertainty.dimension, dim)) {
      throw new InvalidMeasurementError(
        `Uncertainty component "${c.id}" dimension does not match "${components[0]!.id}" — ` +
          `covariance across dimensions is not supported by combineUncertainties`,
      );
    }
  }
  // Work in base units so mixed representations (g vs kg) combine physically.
  const base = new Map<string, number>();
  for (const c of components) base.set(c.id, c.standardUncertainty.toBase().value);
  let sumSq = 0;
  for (const v of base.values()) sumSq += v * v;
  for (const corr of opts.correlations ?? []) {
    if (corr === null || typeof corr !== "object") {
      throw new InvalidMeasurementError("Correlation entry must be a plain object");
    }
    const { idA, idB, coefficient } = corr;
    if (!base.has(idA) || !base.has(idB)) {
      throw new InvalidMeasurementError(
        `Correlation references unknown component "${!base.has(idA) ? idA : idB}"`,
      );
    }
    if (typeof coefficient !== "number" || !(coefficient >= -1 && coefficient <= 1)) {
      throw new InvalidMeasurementError(
        `Correlation coefficient for "${idA}"/"${idB}" must satisfy -1 ≤ ρ ≤ 1`,
      );
    }
    if (idA === idB) continue; // self-correlation contributes nothing beyond u²
    sumSq += 2 * coefficient * base.get(idA)! * base.get(idB)!;
  }
  if (!(sumSq >= 0)) {
    throw new InvalidMeasurementError(
      "Combined variance is negative — correlations are inconsistent (matrix not positive semidefinite)",
    );
  }
  const combinedBase = Math.sqrt(sumSq);
  checkFiniteResult(combinedBase, "combineUncertainties");
  const first = components[0]!.standardUncertainty;
  if (combinedBase === 0) return Quantity.of(0, first.unit);
  const ratio = combinedBase / first.toBase().value;
  return Quantity.of(first.value * ratio, first.unit);
}

// ---------------------------------------------------------------------------
// 27.5–27.7 CovarianceMatrix
// ---------------------------------------------------------------------------

export interface CovarianceMatrixOptions {
  readonly registry?: UnitRegistry;
  readonly limits?: StatisticsLimits;
}

/**
 * Immutable, dimension-aware covariance matrix over named variables.
 * Values are stored in the stated unit; all variables share one dimension
 * (use one matrix per dimension — cross-dimension covariance is rejected
 * rather than silently mis-scaled).
 *
 * Positive-semidefiniteness is checked by attempting a Cholesky
 * decomposition of the correlation matrix (O(n³), bounded by
 * maxMatrixDimension). Zero-variance rows must be exactly uncorrelated.
 */
export class CovarianceMatrix {
  private constructor(
    readonly labels: readonly string[],
    readonly unit: Unit,
    readonly values: readonly (readonly number[])[],
  ) {
    Object.freeze(this);
  }

  get dimension(): DimensionVector {
    return this.unit.dimension;
  }

  get size(): number {
    return this.labels.length;
  }

  /** Covariance Cov(i,j) as a Quantity in the matrix unit squared. */
  covariance(labelA: string, labelB: string): Quantity {
    const [i, j] = this.indicesOf(labelA, labelB);
    const unitSq = Quantity.of(1, this.unit).multiply(Quantity.of(1, this.unit)).unit;
    return Quantity.of(this.values[i]![j]!, unitSq);
  }

  /** Variance Var(i) as a Quantity in the matrix unit squared. */
  variance(label: string): Quantity {
    return this.covariance(label, label);
  }

  /** Standard uncertainty σ_i in the matrix unit. */
  standardUncertainty(label: string): Quantity {
    const i = this.indexOf(label);
    const v = this.values[i]![i]!;
    if (v < 0) {
      throw new InvalidMeasurementError(`Negative variance for "${label}"`);
    }
    return Quantity.of(Math.sqrt(v), this.unit);
  }

  /** Correlation ρ_ij = Cov(i,j)/(σ_i σ_j). Exactly 0/1 at degenerate edges. */
  correlation(labelA: string, labelB: string): number {
    const [i, j] = this.indicesOf(labelA, labelB);
    const vi = this.values[i]![i]!;
    const vj = this.values[j]![j]!;
    if (vi === 0 || vj === 0) {
      if (i === j) return 1;
      if (this.values[i]![j]! !== 0) {
        throw new InvalidMeasurementError(
          `Nonzero covariance with zero variance for "${labelA}"/"${labelB}"`,
        );
      }
      return 0;
    }
    const rho = this.values[i]![j]! / Math.sqrt(vi * vj);
    // Clamp float noise at the boundary; reject genuine violations.
    if (rho > 1 && rho <= 1 + 1e-12) return 1;
    if (rho < -1 && rho >= -1 - 1e-12) return -1;
    if (!(rho >= -1 && rho <= 1)) {
      throw new InvalidMeasurementError(
        `Correlation for "${labelA}"/"${labelB}" outside [-1, 1]: ${rho}`,
      );
    }
    return rho;
  }

  private indexOf(label: string): number {
    const i = this.labels.indexOf(label);
    if (i < 0) throw new InvalidMeasurementError(`Unknown covariance variable "${label}"`);
    return i;
  }

  private indicesOf(a: string, b: string): [number, number] {
    return [this.indexOf(a), this.indexOf(b)];
  }

  static fromData(
    labels: readonly string[],
    unitSymbol: string,
    values: readonly (readonly number[])[],
    opts: CovarianceMatrixOptions = {},
  ): CovarianceMatrix {
    const limits = resolveLimits(opts.limits);
    const registry = opts.registry ?? defaultUnitRegistry;
    if (!Array.isArray(labels) || labels.length === 0) {
      throw new InvalidMeasurementError("CovarianceMatrix needs at least one label");
    }
    if (labels.length > limits.maxMatrixDimension) {
      throw new InvalidMeasurementError(
        `CovarianceMatrix dimension ${labels.length} exceeds maxMatrixDimension ${limits.maxMatrixDimension}`,
      );
    }
    const seen = new Set<string>();
    for (const label of labels) {
      if (typeof label !== "string" || !COMPONENT_ID_RE.test(label)) {
        throw new InvalidMeasurementError(
          `Covariance label must match /^[A-Za-z][A-Za-z0-9_.-]*$/`,
        );
      }
      if (seen.has(label))
        throw new InvalidMeasurementError(`Duplicate covariance label "${label}"`);
      seen.add(label);
    }
    let unit: Unit;
    try {
      unit = parseUnit(unitSymbol, registry);
    } catch (error) {
      throw new InvalidMeasurementError(
        `CovarianceMatrix unit "${unitSymbol}" unresolvable (${(error as Error).message})`,
      );
    }
    if (unit.conversion.kind !== "linear") {
      throw new InvalidMeasurementError(
        `CovarianceMatrix unit "${unitSymbol}" must be linear (affine/logarithmic units have no well-defined covariance scale)`,
      );
    }
    if (!Array.isArray(values) || values.length !== labels.length) {
      throw new InvalidMeasurementError(
        "CovarianceMatrix values must be a square array matching labels",
      );
    }
    const rows: number[][] = [];
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (!Array.isArray(row) || row.length !== labels.length) {
        throw new InvalidMeasurementError(
          "CovarianceMatrix values must be a square array matching labels",
        );
      }
      const out: number[] = [];
      for (const v of row) {
        if (typeof v !== "number" || !Number.isFinite(v)) {
          throw new InvalidMeasurementError("CovarianceMatrix values must all be finite numbers");
        }
        out.push(v);
      }
      rows.push(out);
    }
    // Symmetry within a tight relative tolerance.
    const scale = Math.max(1, ...rows.flat().map(Math.abs));
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (Math.abs(rows[i]![j]! - rows[j]![i]!) > 1e-9 * scale) {
          throw new InvalidMeasurementError(
            `CovarianceMatrix is not symmetric at (${labels[i]}, ${labels[j]})`,
          );
        }
      }
      if (rows[i]![i]! < 0) {
        throw new InvalidMeasurementError(
          `CovarianceMatrix has negative variance for "${labels[i]}"`,
        );
      }
    }
    assertPositiveSemidefinite(rows, labels);
    return new CovarianceMatrix(
      Object.freeze([...labels]),
      unit,
      Object.freeze(rows.map((r) => Object.freeze([...r]))),
    );
  }

  /** Build from Measurements + explicit pairwise correlations (diagonal = σ²). */
  static fromMeasurements(
    measurements: Readonly<Record<string, Measurement>> | readonly Measurement[],
    opts: CovarianceMatrixOptions & {
      correlations?: readonly ComponentCorrelation[];
      unit?: string;
      labels?: readonly string[];
    } = {},
  ): CovarianceMatrix {
    const limits = resolveLimits(opts.limits);
    const registry = opts.registry ?? defaultUnitRegistry;
    const entries: Array<[string, Measurement]> = Array.isArray(measurements)
      ? measurements.map((m, i) => [`x${i}`, m] as [string, Measurement])
      : Object.entries(measurements);
    if (entries.length === 0) {
      throw new InvalidMeasurementError(
        "CovarianceMatrix.fromMeasurements needs at least one measurement",
      );
    }
    if (entries.length > limits.maxMatrixDimension) {
      throw new InvalidMeasurementError(
        `CovarianceMatrix dimension ${entries.length} exceeds maxMatrixDimension ${limits.maxMatrixDimension}`,
      );
    }
    const names = opts.labels ?? entries.map(([name]) => name);
    if (names.length !== entries.length) {
      throw new InvalidMeasurementError("CovarianceMatrix labels must match measurement count");
    }
    const first = entries[0]![1];
    if (!(first instanceof Measurement)) {
      throw new InvalidMeasurementError(
        "CovarianceMatrix.fromMeasurements needs Measurement values",
      );
    }
    const dim = first.dimension;
    const unitSymbol = opts.unit ?? first.uncertainty.unit.symbol;
    let unit: Unit;
    try {
      unit = parseUnit(unitSymbol, registry);
    } catch (error) {
      throw new InvalidMeasurementError(
        `CovarianceMatrix unit "${unitSymbol}" unresolvable (${(error as Error).message})`,
      );
    }
    if (!dimensionsEqual(unit.dimension, dim)) {
      throw new InvalidMeasurementError("CovarianceMatrix unit must match measurement dimension");
    }
    // Variances in the matrix unit: σ_unit².
    const sigmas = entries.map(([, m]) => {
      if (!(m instanceof Measurement)) {
        throw new InvalidMeasurementError(
          "CovarianceMatrix.fromMeasurements needs Measurement values",
        );
      }
      if (!dimensionsEqual(m.dimension, dim)) {
        throw new InvalidMeasurementError(
          "All measurements in a CovarianceMatrix must share one dimension",
        );
      }
      return convert(m.uncertainty.value, m.uncertainty.unit, unit);
    });
    const n = entries.length;
    const values: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? sigmas[i]! * sigmas[i]! : 0)),
    );
    for (const corr of opts.correlations ?? []) {
      const i = names.indexOf(corr.idA);
      const j = names.indexOf(corr.idB);
      if (i < 0 || j < 0) {
        throw new InvalidMeasurementError(
          `Correlation references unknown variable "${i < 0 ? corr.idA : corr.idB}"`,
        );
      }
      if (
        typeof corr.coefficient !== "number" ||
        !(corr.coefficient >= -1 && corr.coefficient <= 1)
      ) {
        throw new InvalidMeasurementError("Correlation coefficient must satisfy -1 ≤ ρ ≤ 1");
      }
      if (i === j) continue;
      const cov = corr.coefficient * sigmas[i]! * sigmas[j]!;
      values[i]![j] = cov;
      values[j]![i] = cov;
    }
    return CovarianceMatrix.fromData(names, unit.symbol, values, { registry, limits: opts.limits });
  }

  serialize(): SerializedCovarianceMatrix {
    return Object.freeze({
      version: 1 as const,
      type: "covariance-matrix" as const,
      labels: Object.freeze([...this.labels]),
      unit: this.unit.symbol,
      values: Object.freeze(this.values.map((r) => Object.freeze([...r]))),
    });
  }

  static deserialize(data: unknown, opts: CovarianceMatrixOptions = {}): CovarianceMatrix {
    if (typeof data === "string") {
      const limits = resolveLimits(opts.limits);
      if (data.length > limits.maxSerializedChars) {
        throw new InvalidMeasurementError(
          `Serialized covariance matrix exceeds maxSerializedChars ${limits.maxSerializedChars}`,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new InvalidMeasurementError("Malformed serialized covariance matrix: invalid JSON");
      }
      return CovarianceMatrix.deserialize(parsed, opts);
    }
    assertPlainRecord(data, "Serialized covariance matrix");
    if (data.version !== 1) {
      if (data.version === undefined)
        throw new InvalidMeasurementError("Serialized covariance matrix missing version");
      throw new InvalidMeasurementError(
        `Unsupported covariance matrix version ${String(data.version)}`,
      );
    }
    if (data.type !== "covariance-matrix") {
      throw new InvalidMeasurementError(
        `Serialized covariance matrix has wrong type "${String(data.type)}"`,
      );
    }
    if (!Array.isArray(data.labels) || !Array.isArray(data.values)) {
      throw new InvalidMeasurementError(
        "Serialized covariance matrix needs labels and values arrays",
      );
    }
    if (typeof data.unit !== "string") {
      throw new InvalidMeasurementError("Serialized covariance matrix needs a unit string");
    }
    return CovarianceMatrix.fromData(
      data.labels as string[],
      data.unit as string,
      data.values as number[][],
      opts,
    );
  }
}

export interface SerializedCovarianceMatrix {
  readonly version: 1;
  readonly type: "covariance-matrix";
  readonly labels: readonly string[];
  readonly unit: string;
  readonly values: readonly (readonly number[])[];
}

/**
 * Positive-semidefinite check via Cholesky decomposition of the correlation
 * matrix (zero-variance rows handled separately). O(n³), bounded by
 * maxMatrixDimension. Approximate PSD within 1e-9 relative tolerance passes;
 * anything else throws.
 */
function assertPositiveSemidefinite(rows: number[][], labels: readonly string[]): void {
  const n = rows.length;
  // Build correlation matrix; drop exactly-zero-variance rows (must be uncorrelated).
  const active: number[] = [];
  for (let i = 0; i < n; i++) {
    if (rows[i]![i]! === 0) {
      for (let j = 0; j < n; j++) {
        if (i !== j && rows[i]![j]! !== 0) {
          throw new InvalidMeasurementError(
            `Zero-variance variable "${labels[i]}" has nonzero covariance`,
          );
        }
      }
    } else {
      active.push(i);
    }
  }
  const m = active.length;
  if (m === 0) return;
  const corr: number[][] = Array.from({ length: m }, (_, a) =>
    Array.from({ length: m }, (_, b) => {
      const i = active[a]!;
      const j = active[b]!;
      return rows[i]![j]! / Math.sqrt(rows[i]![i]! * rows[j]![j]!);
    }),
  );
  // Cholesky attempt: L Lᵀ = C. Negative pivot (beyond tolerance) ⇒ not PSD.
  // Prompt-17 fix: a zero pivot with a NONZERO row remainder is also not PSD
  // (e.g. x≡y but z correlates +1 with y and −1 with x). The old
  // `diag === 0 ? 0` branch silently zeroed the remainder and accepted such
  // matrices. Now the remainder must vanish (within tolerance) or the matrix
  // is rejected — a singular-but-valid pivot (all-ones block) still passes.
  const tol = 1e-9;
  const notPsd = (): never => {
    throw new InvalidMeasurementError(
      "CovarianceMatrix is not positive semidefinite (Cholesky pivot negative)",
    );
  };
  for (let i = 0; i < m; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = corr[i]![j]!;
      for (let k = 0; k < j; k++) sum -= corr[i]![k]! * corr[j]![k]!;
      if (i === j) {
        if (sum < -tol) notPsd();
        corr[i]![j] = Math.sqrt(Math.max(0, sum));
      } else {
        const diag = corr[j]![j]!;
        if (Math.abs(diag) <= tol) {
          if (Math.abs(sum) > tol) notPsd();
          corr[i]![j] = 0;
        } else {
          corr[i]![j] = sum / diag;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 27.8–27.14 MeasurementSeries and statistical summaries
// ---------------------------------------------------------------------------

export interface MeasurementSeriesOptions {
  /** Common unit for analysis (observations convert on read; originals kept). */
  readonly targetUnit?: string;
  readonly registry?: UnitRegistry;
  readonly limits?: StatisticsLimits;
}

/**
 * Immutable collection of repeated observations of one quantity.
 * All observations must share one dimension (units may differ — analysis
 * normalizes to a common unit without discarding originals).
 */
export class MeasurementSeries {
  private constructor(
    readonly observations: readonly Measurement[],
    readonly originals: readonly Measurement[],
    readonly unit: Unit,
  ) {
    Object.freeze(this);
  }

  static of(
    observations: readonly Measurement[],
    opts: MeasurementSeriesOptions = {},
  ): MeasurementSeries {
    const limits = resolveLimits(opts.limits);
    const registry = opts.registry ?? defaultUnitRegistry;
    if (!Array.isArray(observations) || observations.length === 0) {
      throw new InvalidMeasurementError("MeasurementSeries needs at least one observation");
    }
    if (observations.length > limits.maxObservations) {
      throw new InvalidMeasurementError(
        `MeasurementSeries has ${observations.length} observations (max ${limits.maxObservations})`,
      );
    }
    for (const [i, o] of observations.entries()) {
      if (!(o instanceof Measurement)) {
        throw new InvalidMeasurementError(`Observation ${i} is not a Measurement`);
      }
    }
    const dim = observations[0]!.dimension;
    for (const [i, o] of observations.entries()) {
      if (!dimensionsEqual(o.dimension, dim)) {
        throw new InvalidMeasurementError(
          `Observation ${i} dimension does not match observation 0 — series must be dimensionally homogeneous`,
        );
      }
    }
    let unit: Unit;
    try {
      unit =
        opts.targetUnit !== undefined
          ? parseUnit(opts.targetUnit, registry)
          : observations[0]!.value.unit;
    } catch (error) {
      throw new InvalidMeasurementError(
        `MeasurementSeries target unit unresolvable (${(error as Error).message})`,
      );
    }
    if (!dimensionsEqual(unit.dimension, dim)) {
      throw new InvalidMeasurementError("MeasurementSeries target unit dimension mismatch");
    }
    if (unit.conversion.kind !== "linear") {
      throw new InvalidMeasurementError(
        "MeasurementSeries target unit must be linear (affine/logarithmic units have no well-defined series statistics)",
      );
    }
    return new MeasurementSeries(
      Object.freeze([...observations]),
      Object.freeze([...observations]),
      unit,
    );
  }

  get count(): number {
    return this.observations.length;
  }

  get dimension(): DimensionVector {
    return this.observations[0]!.dimension;
  }

  /** Observations converted to the common unit (originals untouched). */
  normalized(): readonly Measurement[] {
    return this.observations.map((o) =>
      o.value.unit.symbol === this.unit.symbol ? o : o.to(this.unit.symbol),
    );
  }

  /** Nominal values in the common unit, as plain numbers. */
  private nominals(): number[] {
    return this.normalized().map((o) => o.value.to(this.unit).value);
  }

  /** Standard uncertainties in the common unit. */
  private sigmas(): number[] {
    return this.normalized().map((o) => o.uncertainty.to(this.unit).value);
  }

  /** Re-target the common unit (originals preserved). */
  toUnit(
    targetUnitSymbol: string,
    registry: UnitRegistry = defaultUnitRegistry,
  ): MeasurementSeries {
    let unit: Unit;
    try {
      unit = parseUnit(targetUnitSymbol, registry);
    } catch (error) {
      throw new InvalidMeasurementError(
        `MeasurementSeries target unit unresolvable (${(error as Error).message})`,
      );
    }
    if (!dimensionsEqual(unit.dimension, this.dimension)) {
      throw new InvalidMeasurementError("MeasurementSeries target unit dimension mismatch");
    }
    if (unit.conversion.kind !== "linear") {
      throw new InvalidMeasurementError("MeasurementSeries target unit must be linear");
    }
    return new MeasurementSeries(this.observations, this.originals, unit);
  }

  /**
   * Arithmetic mean. Uncertainty documents BOTH sampling and stated
   * instrument contributions: u = √(SEM² + ū²) where ū is the mean of the
   * input standard uncertainties. This is one defensible strategy, not a
   * universal model — see weightedMean for the inverse-variance alternative.
   */
  mean(): Measurement {
    const xs = this.nominals();
    const ss = this.sigmas();
    const n = xs.length;
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1 ? sampleVariance(xs) : 0;
    const sem = n > 1 ? Math.sqrt(variance / n) : 0;
    const meanSigma = ss.reduce((a, b) => a + b, 0) / n;
    const combined = Math.sqrt(sem * sem + meanSigma * meanSigma);
    checkFiniteResult(mean, "MeasurementSeries.mean value");
    checkFiniteResult(combined, "MeasurementSeries.mean uncertainty");
    return Measurement.of(Quantity.of(mean, this.unit), Quantity.of(combined, this.unit));
  }

  /**
   * Weighted mean. Weights must be dimensionless, finite, ≥ 0 with positive
   * sum. `"inverse-variance"` uses w_i = 1/σ_i² (all σ_i must be > 0) with
   * result uncertainty 1/√Σw; explicit weights propagate as
   * √(Σw²σ²)/Σw. Dimensional weights are rejected, never reinterpreted.
   */
  weightedMean(weights: readonly number[] | "inverse-variance"): Measurement {
    const xs = this.nominals();
    const ss = this.sigmas();
    const n = xs.length;
    let w: number[];
    if (weights === "inverse-variance") {
      w = ss.map((s, i) => {
        if (!(s > 0)) {
          throw new InvalidMeasurementError(
            `Inverse-variance weighting needs σ > 0 for observation ${i}`,
          );
        }
        return 1 / (s * s);
      });
    } else {
      if (!Array.isArray(weights) || weights.length !== n) {
        throw new InvalidMeasurementError(
          `Weights array must have exactly ${n} entries (one per observation)`,
        );
      }
      w = weights.map((x, i) => {
        if (typeof x !== "number" || !Number.isFinite(x) || x < 0) {
          throw new InvalidMeasurementError(`Weight ${i} must be a finite number ≥ 0`);
        }
        return x;
      });
      if (w.every((x) => x === 0)) {
        throw new InvalidMeasurementError("Weights must not all be zero");
      }
    }
    const wSum = w.reduce((a, b) => a + b, 0);
    const mean = xs.reduce((acc, x, i) => acc + w[i]! * x, 0) / wSum;
    let unc: number;
    if (weights === "inverse-variance") {
      unc = 1 / Math.sqrt(wSum);
    } else {
      const num = xs.reduce((acc, _, i) => acc + (w[i]! * ss[i]!) ** 2, 0);
      unc = Math.sqrt(num) / wSum;
    }
    checkFiniteResult(mean, "MeasurementSeries.weightedMean value");
    checkFiniteResult(unc, "MeasurementSeries.weightedMean uncertainty");
    return Measurement.of(Quantity.of(mean, this.unit), Quantity.of(unc, this.unit));
  }

  /** Observation with the smallest nominal value (original preserved). */
  min(): Measurement {
    const xs = this.nominals();
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (xs[i]! < xs[best]!) best = i;
    return this.observations[best]!;
  }

  /** Observation with the largest nominal value (original preserved). */
  max(): Measurement {
    const xs = this.nominals();
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (xs[i]! > xs[best]!) best = i;
    return this.observations[best]!;
  }

  /**
   * Sample variance (n−1, Bessel-corrected) as a Quantity in the SQUARED
   * common unit. Single-observation series have variance 0 (documented
   * convention, not an estimate). Units are preserved, never stripped.
   */
  variance(): Quantity {
    const xs = this.nominals();
    const v = xs.length > 1 ? sampleVariance(xs) : 0;
    checkFiniteResult(v, "MeasurementSeries.variance");
    const unitSq = Quantity.of(1, this.unit).multiply(Quantity.of(1, this.unit)).unit;
    return Quantity.of(v, unitSq);
  }

  /** Sample standard deviation in the common unit. */
  stddev(): Quantity {
    return Quantity.of(Math.sqrt(this.variance().value), this.unit);
  }

  /** Standard error of the mean (s/√n) in the common unit. */
  standardError(): Quantity {
    const n = this.count;
    return Quantity.of(n > 1 ? this.stddev().value / Math.sqrt(n) : 0, this.unit);
  }

  /** Deterministic summary object (frozen). */
  summarize(): SeriesSummary {
    return Object.freeze({
      count: this.count,
      mean: this.mean(),
      min: this.min(),
      max: this.max(),
      variance: this.variance(),
      stddev: this.stddev(),
      standardError: this.standardError(),
      unit: this.unit.symbol,
      dimension: dimensionKey(this.dimension),
    });
  }

  serialize(): SerializedMeasurementSeries {
    return Object.freeze({
      version: 1 as const,
      type: "measurement-series" as const,
      unit: this.unit.symbol,
      observations: Object.freeze(
        this.originals.map((o) => serializeMeasurement(o) as unknown as Record<string, unknown>),
      ),
    });
  }

  static deserialize(data: unknown, opts: MeasurementSeriesOptions = {}): MeasurementSeries {
    const limits = resolveLimits(opts.limits);
    assertPlainRecord(data, "Serialized measurement series");
    if (data.version !== 1) {
      if (data.version === undefined)
        throw new InvalidMeasurementError("Serialized measurement series missing version");
      throw new InvalidMeasurementError(
        `Unsupported measurement series version ${String(data.version)}`,
      );
    }
    if (data.type !== "measurement-series") {
      throw new InvalidMeasurementError(
        `Serialized measurement series has wrong type "${String(data.type)}"`,
      );
    }
    if (!Array.isArray(data.observations)) {
      throw new InvalidMeasurementError(
        "Serialized measurement series needs an observations array",
      );
    }
    if (data.observations.length > limits.maxObservations) {
      throw new InvalidMeasurementError(
        `Serialized series has ${data.observations.length} observations (max ${limits.maxObservations})`,
      );
    }
    if (typeof data.unit !== "string") {
      throw new InvalidMeasurementError("Serialized measurement series needs a unit string");
    }
    const registry = opts.registry ?? defaultUnitRegistry;
    const observations = (data.observations as unknown[]).map((o) =>
      deserializeMeasurement(o, registry),
    );
    return MeasurementSeries.of(observations, {
      targetUnit: data.unit,
      registry,
      limits: opts.limits,
    });
  }
}

export interface SeriesSummary {
  readonly count: number;
  readonly mean: Measurement;
  readonly min: Measurement;
  readonly max: Measurement;
  readonly variance: Quantity;
  readonly stddev: Quantity;
  readonly standardError: Quantity;
  readonly unit: string;
  readonly dimension: string;
}

export interface SerializedMeasurementSeries {
  readonly version: 1;
  readonly type: "measurement-series";
  readonly unit: string;
  readonly observations: readonly Record<string, unknown>[];
}

function sampleVariance(xs: readonly number[]): number {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  return xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1);
}

// ---------------------------------------------------------------------------
// 27.15–27.20 Expanded uncertainty, confidence and physical intervals
// ---------------------------------------------------------------------------

/**
 * Expanded uncertainty U = k·u_c. Returns the expanded Quantity in the
 * input's unit. No confidence level is claimed — k alone just scales.
 */
export function expandUncertainty(standardUncertainty: Quantity, k: number): Quantity {
  if (!(standardUncertainty instanceof Quantity)) {
    throw new InvalidMeasurementError("expandUncertainty needs a Quantity standard uncertainty");
  }
  if (typeof k !== "number" || !Number.isFinite(k) || k <= 0) {
    throw new InvalidMeasurementError(`Coverage factor k must be finite and > 0, got ${String(k)}`);
  }
  if (standardUncertainty.value < 0) {
    throw new InvalidMeasurementError("Standard uncertainty must be ≥ 0");
  }
  return Quantity.of(standardUncertainty.value * k, standardUncertainty.unit);
}

/**
 * A generic physical interval [lower, upper] — e.g. "5 m to 7 m".
 * NOT a confidence interval: no statistical claim is attached, and the
 * type system keeps the two concepts separate.
 */
export interface MeasurementInterval {
  readonly lower: Quantity;
  readonly upper: Quantity;
}

export function makeMeasurementInterval(lower: Quantity, upper: Quantity): MeasurementInterval {
  if (!(lower instanceof Quantity) || !(upper instanceof Quantity)) {
    throw new InvalidMeasurementError("MeasurementInterval bounds must be Quantities");
  }
  if (!dimensionsEqual(lower.dimension, upper.dimension)) {
    throw new InvalidMeasurementError("MeasurementInterval bounds must share one dimension");
  }
  if (lower.toBase().value > upper.toBase().value) {
    throw new InvalidMeasurementError("MeasurementInterval lower must not exceed upper");
  }
  return Object.freeze({ lower, upper });
}

/**
 * A statistical confidence interval: a physical interval PLUS an explicit
 * confidence level and optional coverage metadata. Never inferred — the
 * caller supplies the level and the assumptions behind it.
 */
export interface ConfidenceBounds {
  readonly lower: Quantity;
  readonly upper: Quantity;
  /** Confidence level in (0, 1), e.g. 0.95. */
  readonly level: number;
  readonly coverageFactor?: number;
  readonly distribution?: UncertaintyDistribution;
  readonly degreesOfFreedom?: number;
}

export function makeConfidenceBounds(args: {
  lower: Quantity;
  upper: Quantity;
  level: number;
  coverageFactor?: number;
  distribution?: UncertaintyDistribution;
  degreesOfFreedom?: number;
}): ConfidenceBounds {
  const { lower, upper, level, coverageFactor, distribution, degreesOfFreedom } = args;
  if (!(lower instanceof Quantity) || !(upper instanceof Quantity)) {
    throw new InvalidMeasurementError("ConfidenceBounds bounds must be Quantities");
  }
  if (!dimensionsEqual(lower.dimension, upper.dimension)) {
    throw new InvalidMeasurementError("ConfidenceBounds bounds must share one dimension");
  }
  if (lower.toBase().value > upper.toBase().value) {
    throw new InvalidMeasurementError("ConfidenceBounds lower must not exceed upper");
  }
  if (typeof level !== "number" || !(level > 0 && level < 1)) {
    throw new InvalidMeasurementError(
      `ConfidenceBounds level must be in (0, 1), got ${String(level)}`,
    );
  }
  if (coverageFactor !== undefined && (!Number.isFinite(coverageFactor) || coverageFactor <= 0)) {
    throw new InvalidMeasurementError("ConfidenceBounds coverageFactor must be finite and > 0");
  }
  if (
    distribution !== undefined &&
    distribution !== "normal" &&
    distribution !== "t" &&
    distribution !== "uniform" &&
    distribution !== "rectangular" &&
    distribution !== "triangular"
  ) {
    throw new InvalidMeasurementError("ConfidenceBounds has an unknown distribution");
  }
  if (
    degreesOfFreedom !== undefined &&
    (!Number.isInteger(degreesOfFreedom) || degreesOfFreedom < 1)
  ) {
    throw new InvalidMeasurementError(
      "ConfidenceBounds degreesOfFreedom must be a positive integer",
    );
  }
  return Object.freeze({ lower, upper, level, coverageFactor, distribution, degreesOfFreedom });
}

/**
 * Build a symmetric confidence interval around a measurement:
 * [v − k·u, v + k·u]. The caller supplies k AND the level/assumptions —
 * the library never derives a confidence claim from k alone.
 */
export function confidenceBoundsOf(
  m: Measurement,
  k: number,
  level: number,
  opts: { distribution?: UncertaintyDistribution; degreesOfFreedom?: number } = {},
): ConfidenceBounds {
  if (!(m instanceof Measurement)) {
    throw new InvalidMeasurementError("confidenceIntervalOf needs a Measurement");
  }
  const expanded = expandUncertainty(m.uncertainty, k);
  const lower = Quantity.of(m.value.value - expanded.to(m.value.unit).value, m.value.unit);
  const upper = Quantity.of(m.value.value + expanded.to(m.value.unit).value, m.value.unit);
  return makeConfidenceBounds({ lower, upper, level, coverageFactor: k, ...opts });
}

// ---------------------------------------------------------------------------
// 27.21 Monte Carlo extension point (deferred by design)
// ---------------------------------------------------------------------------

export interface MonteCarloConfig {
  readonly method: "monte-carlo";
  /** Number of samples (positive integer). */
  readonly samples: number;
  /** Optional deterministic seed. */
  readonly seed?: number;
}

/**
 * Monte Carlo propagation is a DEFERRED extension point (see also the
 * MeasurementMetadata.method validation). This function exists so callers
 * discover the boundary explicitly instead of assuming support.
 */
export function runMonteCarloPropagation(
  _expr: Expression,
  _bindings: Record<string, Measurement | Quantity>,
  _config: MonteCarloConfig,
): never {
  throw new UnsupportedTransformationError(
    "monte-carlo",
    "Monte Carlo uncertainty propagation is a deferred extension point; use analytic first-order propagation (evaluateMeasurement / propagateWithCovariance)",
  );
}

// ---------------------------------------------------------------------------
// 27.22 Nonlinear propagation with covariance (forward-mode over the AST)
// ---------------------------------------------------------------------------

export interface CovariancePropagationOptions {
  readonly registry?: UnitRegistry;
}

/**
 * Propagate uncertainty through +−×÷^convert with a full covariance
 * matrix: u²(y) = ΣᵢΣⱼ (∂f/∂xᵢ)(∂f/∂xⱼ) Cov(xᵢ,xⱼ), computed by
 * forward-mode differentiation over the Expression AST in base units.
 * Every free variable must have a covariance entry; extras are ignored.
 * Function nodes are rejected explicitly (they assume independence in
 * evaluateMeasurement) — mixing models silently would be unsound.
 * Domain errors (division by zero, negative sqrt, non-positive log,
 * reciprocal of zero) surface from the underlying Quantity operations.
 */
export function propagateWithCovariance(
  expr: Expression,
  bindings: Record<string, Measurement>,
  cov: CovarianceMatrix,
  opts: CovariancePropagationOptions = {},
): Measurement {
  const registry = opts.registry ?? defaultUnitRegistry;
  if (bindings === null || typeof bindings !== "object" || Array.isArray(bindings)) {
    throw new InvalidMeasurementError("propagateWithCovariance bindings must be a plain object");
  }
  if (!(cov instanceof CovarianceMatrix)) {
    throw new InvalidMeasurementError("propagateWithCovariance needs a CovarianceMatrix");
  }
  const { value, grad } = propagateNode(expr, bindings, registry, cov, 0);
  let variance = 0;
  const vars = [...grad.keys()];
  for (const a of vars) {
    for (const b of vars) {
      variance += grad.get(a)! * grad.get(b)! * covEntryBase(cov, a, b);
    }
  }
  if (!(variance >= 0)) {
    throw new InvalidMeasurementError(
      "Propagated variance is negative — covariance data is inconsistent",
    );
  }
  const uncBase = Math.sqrt(variance);
  checkFiniteResult(uncBase, "propagateWithCovariance uncertainty");
  // Express the base-unit uncertainty in the nominal result's unit using the
  // scale-only delta (affine-safe: same technique as Measurement.to).
  const baseUnit = value.toBase().unit;
  const perUnit = convert(1, value.unit, baseUnit) - convert(0, value.unit, baseUnit);
  return Measurement.of(value, Quantity.of(uncBase / perUnit, value.unit));
}

/**
 * Covariance entry rescaled to base units. The matrix stores values in its
 * own (linear, validated) unit; gradients track base units, so one shared
 * scale factor applies to every entry (single dimension by construction).
 */
function covEntryBase(cov: CovarianceMatrix, a: string, b: string): number {
  const stored = cov.covariance(a, b).value;
  const baseUnit = Quantity.of(1, cov.unit).toBase().unit;
  const perStored = convert(1, cov.unit, baseUnit) - convert(0, cov.unit, baseUnit);
  return stored * perStored * perStored;
}

interface PropagatedNode {
  readonly value: Quantity;
  /** ∂(base-unit value)/∂(base-unit variable), keyed by variable name. */
  readonly grad: ReadonlyMap<string, number>;
}

function baseValueOf(q: Quantity): number {
  return q.toBase().value;
}

function propagateNode(
  expr: Expression,
  bindings: Record<string, Measurement>,
  registry: UnitRegistry,
  cov: CovarianceMatrix,
  depth: number,
): PropagatedNode {
  if (depth > 64) {
    throw new InvalidMeasurementError("propagateWithCovariance exceeded depth 64");
  }
  switch (expr.kind) {
    case "literal": {
      return { value: Quantity.of(expr.value, expr.unit, registry), grad: new Map() };
    }
    case "variable": {
      if (!Object.prototype.hasOwnProperty.call(bindings, expr.name)) {
        throw new InvalidMeasurementError(
          `propagateWithCovariance: no Measurement binding for "${expr.name}"`,
        );
      }
      const bound = (bindings as Record<string, unknown>)[expr.name];
      if (!(bound instanceof Measurement)) {
        throw new InvalidMeasurementError(
          `propagateWithCovariance: "${expr.name}" must bind a Measurement`,
        );
      }
      try {
        void cov.correlation(expr.name, expr.name);
      } catch {
        throw new InvalidMeasurementError(
          `propagateWithCovariance: variable "${expr.name}" has no covariance entry`,
        );
      }
      return { value: bound.value, grad: new Map([[expr.name, 1]]) };
    }
    case "add":
    case "subtract": {
      const left = propagateNode(expr.left, bindings, registry, cov, depth + 1);
      const right = propagateNode(expr.right, bindings, registry, cov, depth + 1);
      const value =
        expr.kind === "add" ? left.value.add(right.value) : left.value.subtract(right.value);
      return { value, grad: mergeGrads(left.grad, right.grad, expr.kind === "add" ? 1 : -1) };
    }
    case "multiply": {
      const left = propagateNode(expr.left, bindings, registry, cov, depth + 1);
      const right = propagateNode(expr.right, bindings, registry, cov, depth + 1);
      const value = left.value.multiply(right.value);
      const lBase = baseValueOf(left.value);
      const rBase = baseValueOf(right.value);
      const grad = new Map<string, number>();
      for (const [k, g] of left.grad) grad.set(k, (grad.get(k) ?? 0) + rBase * g);
      for (const [k, g] of right.grad) grad.set(k, (grad.get(k) ?? 0) + lBase * g);
      return { value, grad };
    }
    case "divide": {
      const left = propagateNode(expr.left, bindings, registry, cov, depth + 1);
      const right = propagateNode(expr.right, bindings, registry, cov, depth + 1);
      const value = left.value.divide(right.value); // throws on zero divisor
      const lBase = baseValueOf(left.value);
      const rBase = baseValueOf(right.value);
      const grad = new Map<string, number>();
      for (const [k, g] of left.grad) grad.set(k, (grad.get(k) ?? 0) + g / rBase);
      for (const [k, g] of right.grad)
        grad.set(k, (grad.get(k) ?? 0) + (-lBase / (rBase * rBase)) * g);
      return { value, grad };
    }
    case "power": {
      const base = propagateNode(expr.base, bindings, registry, cov, depth + 1);
      const value = base.value.pow(expr.exponent); // integer-only, domain-checked
      const bBase = baseValueOf(base.value);
      const factor = expr.exponent * Math.pow(bBase, expr.exponent - 1);
      const grad = new Map<string, number>();
      for (const [k, g] of base.grad) grad.set(k, factor * g);
      return { value, grad };
    }
    case "convert": {
      const inner = propagateNode(expr.expr, bindings, registry, cov, depth + 1);
      const value = inner.value.to(expr.unit, registry);
      // Base-unit values (and hence base-unit gradients) are invariant
      // under conversion, so gradients pass through unchanged.
      return { value, grad: new Map(inner.grad) };
    }
    case "call":
      throw new UnsupportedTransformationError(
        `function "${expr.function}"`,
        "propagateWithCovariance supports +−×÷^convert only; function nodes assume independence (see evaluateMeasurement)",
      );
    default:
      throw new InvalidMeasurementError(
        `Unknown expression node kind "${(expr as { kind: string }).kind}"`,
      );
  }
}

function mergeGrads(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
  sign: 1 | -1,
): Map<string, number> {
  const out = new Map(a);
  for (const [k, g] of b) out.set(k, (out.get(k) ?? 0) + sign * g);
  return out;
}

// ---------------------------------------------------------------------------
// 27.25–27.29 MeasurementDataset: named variables of observations
// ---------------------------------------------------------------------------

export interface DatasetContext {
  /** Formula id/version used to derive results, if any. */
  readonly formulaId?: string;
  readonly formulaVersion?: number;
  /** Reference-data snapshot identity, if any. */
  readonly referenceData?: string;
  /** Standards profile identity, if any (resolved by the caller). */
  readonly profileId?: string;
  readonly profileVersion?: string;
  /** Schema version of this record (always 1). */
  readonly schemaVersion?: number;
}

export interface MeasurementDatasetOptions {
  readonly registry?: UnitRegistry;
  readonly limits?: StatisticsLimits;
  /** Reproducibility context recorded on the dataset (data only). */
  readonly context?: DatasetContext;
}

/**
 * Lightweight named-variable container of observation series — NOT a
 * dataframe: no scripting, no joins, no reshaping. Supports filtering,
 * selection, unit normalization, summaries and per-observation formula
 * evaluation (delegated to the Formula Engine).
 */
export class MeasurementDataset {
  private constructor(
    readonly variables: Readonly<Record<string, MeasurementSeries>>,
    readonly context: DatasetContext | undefined,
  ) {
    Object.freeze(this);
  }

  static of(
    variables: Readonly<Record<string, MeasurementSeries | readonly Measurement[]>>,
    opts: MeasurementDatasetOptions = {},
  ): MeasurementDataset {
    const limits = resolveLimits(opts.limits);
    if (variables === null || typeof variables !== "object" || Array.isArray(variables)) {
      throw new InvalidMeasurementError("MeasurementDataset variables must be a plain object");
    }
    if (hasPollutionKeys(variables as Record<string, unknown>)) {
      throw new InvalidMeasurementError("MeasurementDataset variables contain forbidden keys");
    }
    const names = Object.keys(variables);
    if (names.length === 0) {
      throw new InvalidMeasurementError("MeasurementDataset needs at least one variable");
    }
    if (names.length > limits.maxVariables) {
      throw new InvalidMeasurementError(
        `MeasurementDataset has ${names.length} variables (max ${limits.maxVariables})`,
      );
    }
    const built: Record<string, MeasurementSeries> = {};
    for (const name of names) {
      if (!COMPONENT_ID_RE.test(name)) {
        throw new InvalidMeasurementError(
          `Dataset variable name must match /^[A-Za-z][A-Za-z0-9_.-]*$/`,
        );
      }
      const entry = (variables as Record<string, MeasurementSeries | readonly Measurement[]>)[
        name
      ]!;
      built[name] =
        entry instanceof MeasurementSeries
          ? entry
          : MeasurementSeries.of(entry, { limits: opts.limits });
    }
    // All series must have equal observation counts (rectangular data).
    const counts = new Set(Object.values(built).map((s) => s.count));
    if (counts.size > 1) {
      throw new InvalidMeasurementError(
        `MeasurementDataset series have mismatched counts: ${[...counts].join(", ")}`,
      );
    }
    return new MeasurementDataset(
      Object.freeze(built),
      opts.context ? Object.freeze({ ...opts.context }) : undefined,
    );
  }

  get variableNames(): readonly string[] {
    return Object.freeze(Object.keys(this.variables));
  }

  get observationCount(): number {
    const first = Object.values(this.variables)[0];
    return first ? first.count : 0;
  }

  /** Keep observations where predicate holds (all variables filtered jointly). */
  filter(
    predicate: (row: Readonly<Record<string, Measurement>>, index: number) => boolean,
  ): MeasurementDataset {
    if (typeof predicate !== "function") {
      throw new InvalidMeasurementError("MeasurementDataset.filter needs a predicate function");
    }
    const names = this.variableNames;
    const kept: number[] = [];
    for (let i = 0; i < this.observationCount; i++) {
      const row: Record<string, Measurement> = {};
      for (const name of names) row[name] = this.variables[name]!.observations[i]!;
      if (predicate(Object.freeze(row), i)) kept.push(i);
    }
    const variables: Record<string, MeasurementSeries> = {};
    for (const name of names) {
      variables[name] = MeasurementSeries.of(
        kept.map((i) => this.variables[name]!.observations[i]!),
      );
    }
    return new MeasurementDataset(Object.freeze(variables), this.context);
  }

  /** Keep only the named variables (unknown names throw). */
  select(names: readonly string[]): MeasurementDataset {
    const variables: Record<string, MeasurementSeries> = {};
    for (const name of names) {
      const series = this.variables[name];
      if (!series) throw new InvalidMeasurementError(`Unknown dataset variable "${name}"`);
      variables[name] = series;
    }
    return new MeasurementDataset(Object.freeze(variables), this.context);
  }

  /** Normalize every series to its own target unit (originals preserved). */
  normalize(units: Readonly<Record<string, string>>): MeasurementDataset {
    const variables: Record<string, MeasurementSeries> = {};
    for (const name of this.variableNames) {
      const target = (units as Record<string, string>)[name];
      variables[name] =
        target === undefined ? this.variables[name]! : this.variables[name]!.toUnit(target);
    }
    return new MeasurementDataset(Object.freeze(variables), this.context);
  }

  /** Per-variable statistical summaries (deterministic key order). */
  summarize(): Readonly<Record<string, SeriesSummary>> {
    const out: Record<string, SeriesSummary> = {};
    for (const name of this.variableNames) out[name] = this.variables[name]!.summarize();
    return Object.freeze(out);
  }

  /**
   * Apply a formula to every observation row. `mapping` binds formula
   * variables to dataset variables (defaults to same names). Each row
   * evaluates with Measurement bindings, so uncertainty propagates through
   * the existing Measurement path. Derived measurements carry provenance
   * `{ derivedFrom: [...] }` unless `provenance` is "none".
   */
  applyFormula(
    formula: Formula,
    opts: {
      mapping?: Readonly<Record<string, string>>;
      provenance?: "shallow" | "none";
      registry?: UnitRegistry;
    } = {},
  ): MeasurementSeries {
    if (formula === null || typeof formula !== "object") {
      throw new InvalidMeasurementError("applyFormula needs a Formula definition");
    }
    const mapping = opts.mapping ?? {};
    const mode = opts.provenance ?? "shallow";
    if (mode !== "shallow" && mode !== "none") {
      throw new InvalidMeasurementError(`Unknown provenance mode "${mode}"`);
    }
    // Validate the mapping up front (fail before partial evaluation).
    for (const [formulaVar, datasetVar] of Object.entries(mapping)) {
      if (this.variables[datasetVar] === undefined) {
        throw new InvalidMeasurementError(
          `Mapping target dataset variable "${datasetVar}" not found (for formula variable "${formulaVar}")`,
        );
      }
    }
    const results: Measurement[] = [];
    for (let i = 0; i < this.observationCount; i++) {
      const bindings: Record<string, Measurement> = {};
      for (const name of formulaVariables(formula)) {
        const datasetVar = (mapping as Record<string, string>)[name] ?? name;
        const series = this.variables[datasetVar];
        if (!series) {
          throw new InvalidMeasurementError(
            `Formula variable "${name}" has no dataset variable "${datasetVar}"`,
          );
        }
        bindings[name] = series.observations[i]!;
      }
      const out = evaluateFormula(formula, bindings, { registry: opts.registry });
      if (!(out instanceof Measurement)) {
        throw new InvalidMeasurementError(
          `Formula "${formula.id}" did not produce a Measurement for row ${i}`,
        );
      }
      results.push(
        mode === "none"
          ? out
          : Measurement.of(out.value, out.uncertainty, {
              ...(out.metadata ?? {}),
              provenance: {
                ...(out.metadata?.provenance ?? {}),
                method: `formula:${formula.id}`,
                derivedFrom: Object.values(bindings),
              },
            }),
      );
    }
    return MeasurementSeries.of(results);
  }

  serialize(): SerializedMeasurementDataset {
    const variables: Record<string, unknown> = {};
    for (const name of this.variableNames) {
      variables[name] = this.variables[name]!.serialize();
    }
    return Object.freeze({
      version: 1 as const,
      type: "measurement-dataset" as const,
      variables: Object.freeze(variables),
      ...(this.context ? { context: this.context } : {}),
    });
  }

  static deserialize(data: unknown, opts: MeasurementDatasetOptions = {}): MeasurementDataset {
    const limits = resolveLimits(opts.limits);
    assertPlainRecord(data, "Serialized measurement dataset");
    if (data.version !== 1) {
      if (data.version === undefined)
        throw new InvalidMeasurementError("Serialized dataset missing version");
      throw new InvalidMeasurementError(`Unsupported dataset version ${String(data.version)}`);
    }
    if (data.type !== "measurement-dataset") {
      throw new InvalidMeasurementError(`Serialized dataset has wrong type "${String(data.type)}"`);
    }
    if (
      data.variables === null ||
      typeof data.variables !== "object" ||
      Array.isArray(data.variables)
    ) {
      throw new InvalidMeasurementError("Serialized dataset variables must be an object");
    }
    const rawVars = data.variables as Record<string, unknown>;
    if (hasPollutionKeys(rawVars)) {
      throw new InvalidMeasurementError("Serialized dataset variables contain forbidden keys");
    }
    if (Object.keys(rawVars).length > limits.maxVariables) {
      throw new InvalidMeasurementError(
        `Serialized dataset has too many variables (max ${limits.maxVariables})`,
      );
    }
    const variables: Record<string, MeasurementSeries> = {};
    for (const [name, raw] of Object.entries(rawVars)) {
      variables[name] = MeasurementSeries.deserialize(raw, opts);
    }
    let context: DatasetContext | undefined;
    if (data.context !== undefined) {
      if (
        data.context === null ||
        typeof data.context !== "object" ||
        Array.isArray(data.context)
      ) {
        throw new InvalidMeasurementError("Serialized dataset context must be an object");
      }
      if (hasPollutionKeys(data.context as Record<string, unknown>)) {
        throw new InvalidMeasurementError("Serialized dataset context contains forbidden keys");
      }
      context = data.context as DatasetContext;
    }
    return MeasurementDataset.of(variables, {
      registry: opts.registry,
      limits: opts.limits,
      context,
    });
  }
}

export interface SerializedMeasurementDataset {
  readonly version: 1;
  readonly type: "measurement-dataset";
  readonly variables: Readonly<Record<string, unknown>>;
  readonly context?: DatasetContext;
}

// ---------------------------------------------------------------------------
// Serialization for intervals
// ---------------------------------------------------------------------------

export interface SerializedMeasurementInterval {
  readonly version: 1;
  readonly type: "measurement-interval";
  readonly lower: { value: number | string; unit: string };
  readonly upper: { value: number | string; unit: string };
}

export interface SerializedConfidenceBounds {
  readonly version: 1;
  readonly type: "confidence-interval";
  readonly lower: { value: number | string; unit: string };
  readonly upper: { value: number | string; unit: string };
  readonly level: number;
  readonly coverageFactor?: number;
  readonly distribution?: UncertaintyDistribution;
  readonly degreesOfFreedom?: number;
}

function encodeNumber(v: number): number | string {
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  if (Object.is(v, -0)) return "-0";
  return v;
}

function decodeNumber(v: unknown, what: string): number {
  if (typeof v === "number") return v;
  if (v === "NaN") return NaN;
  if (v === "Infinity") return Infinity;
  if (v === "-Infinity") return -Infinity;
  if (v === "-0") return -0;
  throw new InvalidMeasurementError(`${what} must be a number or special encoding`);
}

export function serializeInterval(interval: MeasurementInterval): SerializedMeasurementInterval {
  return Object.freeze({
    version: 1 as const,
    type: "measurement-interval" as const,
    lower: Object.freeze({
      value: encodeNumber(interval.lower.value),
      unit: interval.lower.unit.symbol,
    }),
    upper: Object.freeze({
      value: encodeNumber(interval.upper.value),
      unit: interval.upper.unit.symbol,
    }),
  });
}

export function deserializeInterval(
  data: unknown,
  registry: UnitRegistry = defaultUnitRegistry,
): MeasurementInterval {
  assertPlainRecord(data, "Serialized measurement interval");
  if (data.version !== 1)
    throw new InvalidMeasurementError("Unsupported measurement interval version");
  if (data.type !== "measurement-interval" && data.type !== "confidence-interval") {
    throw new InvalidMeasurementError("Serialized interval has wrong type");
  }
  const lowerRaw = data.lower as Record<string, unknown>;
  const upperRaw = data.upper as Record<string, unknown>;
  if (!isRecord(lowerRaw) || !isRecord(upperRaw)) {
    throw new InvalidMeasurementError("Serialized interval needs lower/upper objects");
  }
  if (typeof lowerRaw.unit !== "string" || typeof upperRaw.unit !== "string") {
    throw new InvalidMeasurementError("Serialized interval bounds need unit strings");
  }
  return makeMeasurementInterval(
    Quantity.of(decodeNumber(lowerRaw.value, "lower"), lowerRaw.unit, registry),
    Quantity.of(decodeNumber(upperRaw.value, "upper"), upperRaw.unit, registry),
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function serializeConfidenceBounds(ci: ConfidenceBounds): SerializedConfidenceBounds {
  return Object.freeze({
    ...serializeInterval(ci),
    type: "confidence-interval" as const,
    level: ci.level,
    ...(ci.coverageFactor !== undefined ? { coverageFactor: ci.coverageFactor } : {}),
    ...(ci.distribution !== undefined ? { distribution: ci.distribution } : {}),
    ...(ci.degreesOfFreedom !== undefined ? { degreesOfFreedom: ci.degreesOfFreedom } : {}),
  });
}

export function deserializeConfidenceBounds(
  data: unknown,
  registry: UnitRegistry = defaultUnitRegistry,
): ConfidenceBounds {
  assertPlainRecord(data, "Serialized confidence interval");
  if (data.version !== 1)
    throw new InvalidMeasurementError("Unsupported confidence interval version");
  if (data.type !== "confidence-interval") {
    throw new InvalidMeasurementError("Serialized confidence interval has wrong type");
  }
  const base = deserializeInterval(data, registry);
  const level = (data as Record<string, unknown>).level;
  if (typeof level !== "number") {
    throw new InvalidMeasurementError("Serialized confidence interval needs a level");
  }
  const extra = data as Record<string, unknown>;
  return makeConfidenceBounds({
    lower: base.lower,
    upper: base.upper,
    level,
    ...(typeof extra.coverageFactor === "number" ? { coverageFactor: extra.coverageFactor } : {}),
    ...(typeof extra.distribution === "string"
      ? { distribution: extra.distribution as UncertaintyDistribution }
      : {}),
    ...(typeof extra.degreesOfFreedom === "number"
      ? { degreesOfFreedom: extra.degreesOfFreedom }
      : {}),
  });
}

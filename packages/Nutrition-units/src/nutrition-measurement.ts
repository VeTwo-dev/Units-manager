/**
 * nutrition-measurement.ts — Phase 9: scientific nutrition measurement with uncertainty.
 *
 * Wraps the certified core Measurement (value + absolute uncertainty) with
 * nutrition semantics (nutrient, basis, context, metadata). No second
 * uncertainty engine — all math delegates to @vetwo/units.
 */

import {
  Measurement,
  Quantity,
  type Unit,
  serializeMeasurement,
  deserializeMeasurement,
} from "@vetwo/units";
import { defaultBasisRegistry, type BasisRegistry, type BasisDefinition } from "./basis.js";
import {
  defaultNutrientKindRegistry,
  type NutrientKind,
  type NutrientKindRegistry,
} from "./nutrient-kind.js";
import {
  InvalidNutritionQuantityError,
  InvalidNutritionBasisError,
  MissingNutritionContextError,
  UnsupportedBasisConversionError,
  NutritionUnitCompatibilityError,
} from "./errors.js";
import {
  createNutritionContext,
  resolveDryMatterFraction,
  type NutritionContext,
} from "./nutrition-context.js";
import { assertFamilyCompatible } from "./unit-family.js";
import { checkNutrientCompatibility, type SemanticMode } from "./semantic-compatibility.js";
import type { NutritionMetadata } from "./nutrition-metadata.js";
import { createNutritionMetadata } from "./nutrition-metadata.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface NutritionMeasurementOptions {
  readonly basisRegistry?: BasisRegistry;
  readonly kindRegistry?: NutrientKindRegistry;
  readonly metadata?: Readonly<Record<string, unknown>> | NutritionMetadata;
  readonly context?: NutritionContext;
}

export class NutritionMeasurement {
  readonly measurement: Measurement;
  readonly nutrient: NutrientKind;
  readonly basis: BasisDefinition;
  readonly context?: NutritionContext;
  readonly metadata?: NutritionMetadata;

  private constructor(
    measurement: Measurement,
    nutrient: NutrientKind,
    basis: BasisDefinition,
    context?: NutritionContext,
    metadata?: NutritionMetadata,
  ) {
    this.measurement = measurement;
    this.nutrient = nutrient;
    this.basis = basis;
    if (context) this.context = Object.freeze({ ...context });
    if (metadata) this.metadata = createNutritionMetadata(metadata as never);
    Object.freeze(this);
  }

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  static of(
    measurement: Measurement,
    nutrientId: string,
    basisId: string = "asFed",
    opts: NutritionMeasurementOptions = {},
  ): NutritionMeasurement {
    if (!(measurement instanceof Measurement)) {
      throw new InvalidNutritionQuantityError(
        `measurement must be a Measurement, got ${typeof measurement}`,
      );
    }
    const kindRegistry = opts.kindRegistry ?? defaultNutrientKindRegistry;
    const basisRegistry = opts.basisRegistry ?? defaultBasisRegistry;
    const nutrient = kindRegistry.require(nutrientId);
    const basis = basisRegistry.require(basisId);
    // Validate unit family compatibility (reuse)
    try {
      assertFamilyCompatible(nutrient, measurement.value);
    } catch (e) {
      if (e instanceof NutritionUnitCompatibilityError) throw e;
      throw e;
    }
    // Validate basis vs unit tag (allow bare)
    validateBasisMatchesUnit(basis, measurement.value.unit);
    const meta = opts.metadata ? createNutritionMetadata(opts.metadata as never) : undefined;
    const ctx = opts.context ? createNutritionContext(opts.context as never) : undefined;
    return new NutritionMeasurement(measurement, nutrient, basis, ctx, meta);
  }

  static from(
    value: number,
    unit: string,
    nutrientId: string,
    basisId: string = "asFed",
    uncertainty?: Quantity | number,
    opts: NutritionMeasurementOptions = {},
  ): NutritionMeasurement {
    const q = Quantity.of(value, unit);
    const meas =
      uncertainty === undefined ? Measurement.exact(q) : Measurement.of(q, uncertainty as never);
    return NutritionMeasurement.of(meas, nutrientId, basisId, opts);
  }

  // Convenience: expose value/uncertainty directly
  get value(): Quantity {
    return this.measurement.value;
  }
  get uncertainty(): Quantity {
    return this.measurement.uncertainty;
  }
  get dimension() {
    return this.measurement.dimension;
  }

  // -----------------------------------------------------------------------
  // Conversion — preserve semantic, propagate uncertainty via core
  // -----------------------------------------------------------------------

  to(targetUnit: string | Unit): NutritionMeasurement {
    const newMeas = this.measurement.to(targetUnit as string);
    // Validate family still compatible after conversion (should be same dimension)
    return new NutritionMeasurement(
      newMeas,
      this.nutrient,
      this.basis,
      this.context,
      this.metadata,
    );
  }

  convertBasis(
    targetBasisId: string,
    context?: NutritionContext | { dryMatterFraction?: number; moistureFraction?: number },
    opts: NutritionMeasurementOptions = {},
  ): NutritionMeasurement {
    const basisRegistry = opts.basisRegistry ?? defaultBasisRegistry;
    const targetBasis = basisRegistry.require(targetBasisId);
    if (this.basis.id === targetBasis.id) return this;
    const ctx = context
      ? createNutritionContext(context as never)
      : this.context
        ? this.context
        : undefined;
    if (!ctx) throw new MissingNutritionContextError(targetBasisId);
    let newMeas: Measurement;
    const from = this.basis.id;
    const to = targetBasis.id;
    const isDryLike = (id: string) => id === "drymatter";
    const isAsFedLike = (id: string) =>
      id === "asfed" || id === "freshmatter" || id === "wet" || id === "normalized";
    const dmMeas = (ctx as unknown as { resolvedDryMatterMeasurement?: Measurement })
      .resolvedDryMatterMeasurement;
    let dmFractionForTrace: number;
    if (dmMeas) {
      dmFractionForTrace = dmMeas.value.unit.symbol.includes("%")
        ? dmMeas.value.value / 100
        : dmMeas.value.value;
      if (isDryLike(from) && isAsFedLike(to)) {
        newMeas = this.measurement.multiply(dmMeas);
        try {
          const targetSymbol = stripBasisTag(this.measurement.value.unit.symbol, this.basis);
          if (targetSymbol !== this.measurement.value.unit.symbol)
            newMeas = newMeas.to(targetSymbol);
        } catch {
          throw new UnsupportedBasisConversionError(from, to, "target unit not parseable");
        }
      } else if (isAsFedLike(from) && isDryLike(to)) {
        newMeas = this.measurement.divide(dmMeas);
        const targetSymbol =
          `${stripBasisTag(this.measurement.value.unit.symbol, this.basis)} DM`.trim();
        try {
          newMeas = newMeas.to(targetSymbol);
        } catch {
          throw new UnsupportedBasisConversionError(from, to, "target unit not parseable");
        }
      } else if (isAsFedLike(from) && isAsFedLike(to)) {
        newMeas = this.measurement;
      } else {
        throw new InvalidNutritionBasisError(`${from}->${to}`, "unsupported basis conversion");
      }
    } else {
      const dmFraction = resolveDryMatterFraction(ctx as NutritionContext);
      dmFractionForTrace = dmFraction;
      if (isDryLike(from) && isAsFedLike(to)) {
        newMeas = this.measurement.scale(dmFraction);
        try {
          const targetSymbol = stripBasisTag(this.measurement.value.unit.symbol, this.basis);
          if (targetSymbol !== this.measurement.value.unit.symbol)
            newMeas = newMeas.to(targetSymbol);
        } catch {
          throw new UnsupportedBasisConversionError(from, to, "target unit not parseable");
        }
      } else if (isAsFedLike(from) && isDryLike(to)) {
        newMeas = this.measurement.scale(1 / dmFraction);
        const targetSymbol =
          `${stripBasisTag(this.measurement.value.unit.symbol, this.basis)} DM`.trim();
        try {
          newMeas = newMeas.to(targetSymbol);
        } catch {
          throw new UnsupportedBasisConversionError(from, to, "target unit not parseable");
        }
      } else if (isAsFedLike(from) && isAsFedLike(to)) {
        newMeas = this.measurement;
      } else {
        throw new InvalidNutritionBasisError(`${from}->${to}`, "unsupported basis conversion");
      }
    }
    const traceMeta = {
      ...(this.metadata ?? {}),
      conversion: {
        sourceBasis: from,
        targetBasis: to,
        dryMatterFraction: dmFractionForTrace,
        conversionType: "basis-conversion",
      },
    };
    return new NutritionMeasurement(newMeas, this.nutrient, targetBasis, ctx, traceMeta as never);
  }

  convert(
    targetUnit?: string | Unit,
    targetBasisId?: string,
    context?: NutritionContext,
  ): NutritionMeasurement {
    if (targetBasisId && targetBasisId !== this.basis.id) {
      if (!context) throw new MissingNutritionContextError(targetBasisId);
      const convertedByBasis = this.convertBasis(targetBasisId, context);
      return targetUnit ? convertedByBasis.to(targetUnit) : convertedByBasis;
    }
    return targetUnit ? this.to(targetUnit) : this;
  }

  // -----------------------------------------------------------------------
  // Comparison & equality
  // -----------------------------------------------------------------------

  equals(other: NutritionMeasurement, epsilon?: number): boolean {
    if (!(other instanceof NutritionMeasurement)) return false;
    if (this.nutrient.id !== other.nutrient.id) return false;
    if (this.basis.id !== other.basis.id) return false;
    return this.measurement.equals(other.measurement, epsilon);
  }

  exactEquals(other: NutritionMeasurement): boolean {
    if (!(other instanceof NutritionMeasurement)) return false;
    if (this.nutrient.id !== other.nutrient.id) return false;
    if (this.basis.id !== other.basis.id) return false;
    return this.measurement.exactEquals(other.measurement);
  }

  isCompatibleWith(other: NutritionMeasurement, opts: { mode?: SemanticMode } = {}): boolean {
    return (
      checkNutrientCompatibility(this.nutrient.id, other.nutrient.id, opts).isCompatible &&
      this.basis.id === other.basis.id
    );
  }

  compare(other: NutritionMeasurement, opts: { mode?: SemanticMode } = {}): number {
    const compat = checkNutrientCompatibility(this.nutrient.id, other.nutrient.id, opts);
    if (!compat.isCompatible)
      throw new InvalidNutritionQuantityError(`compare requires same nutrient: ${compat.reason}`);
    if (this.basis.id !== other.basis.id)
      throw new InvalidNutritionBasisError(other.basis.id, `compare requires same basis`);
    const a = this.measurement.value.toBase().value;
    const b = other.measurement.value.toBase().value;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  toJSON(): SerializedNutritionMeasurement {
    return serializeNutritionMeasurement(this);
  }

  static fromJSON(data: unknown, opts: NutritionMeasurementOptions = {}): NutritionMeasurement {
    return deserializeNutritionMeasurement(data, opts);
  }

  toString(): string {
    return `${this.measurement.toString()} [${this.nutrient.id}/${this.basis.id}]`;
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export interface SerializedNutritionMeasurement {
  readonly version: 1;
  readonly type: "nutrition-measurement";
  readonly measurement: ReturnType<typeof import("@vetwo/units").serializeMeasurement>;
  readonly nutrient: string;
  readonly basis: string;
  readonly context?: NutritionContext;
  readonly metadata?: NutritionMetadata;
}

export function serializeNutritionMeasurement(
  nm: NutritionMeasurement,
): SerializedNutritionMeasurement {
  if (!(nm instanceof NutritionMeasurement))
    throw new InvalidNutritionQuantityError(
      "serializeNutritionMeasurement expects NutritionMeasurement",
    );
  return Object.freeze({
    version: 1,
    type: "nutrition-measurement",
    measurement: serializeMeasurement(nm.measurement),
    nutrient: nm.nutrient.id,
    basis: nm.basis.id,
    ...(nm.context ? { context: nm.context } : {}),
    ...(nm.metadata ? { metadata: nm.metadata } : {}),
  }) as SerializedNutritionMeasurement;
}

export function deserializeNutritionMeasurement(
  data: unknown,
  opts: NutritionMeasurementOptions = {},
): NutritionMeasurement {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new InvalidNutritionQuantityError(
      "serialized nutrition measurement must be plain object",
    );
  const r = data as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(r, "__proto__") ||
    Object.prototype.hasOwnProperty.call(r, "constructor") ||
    Object.prototype.hasOwnProperty.call(r, "prototype")
  ) {
    throw new InvalidNutritionQuantityError("forbidden keys");
  }
  if (r.version !== 1)
    throw new InvalidNutritionQuantityError(`unsupported version ${String(r.version)}`);
  if (r.type !== "nutrition-measurement")
    throw new InvalidNutritionQuantityError(`invalid type ${String(r.type)}`);
  if (typeof r.nutrient !== "string" || typeof r.basis !== "string")
    throw new InvalidNutritionQuantityError("nutrient and basis must be strings");
  const meas = deserializeMeasurement(r.measurement as never);
  const ctx = r.context ? createNutritionContext(r.context as never) : undefined;
  const meta = r.metadata ? createNutritionMetadata(r.metadata as never) : undefined;
  return NutritionMeasurement.of(meas, r.nutrient, r.basis, {
    ...opts,
    context: ctx,
    metadata: meta as never,
  });
}

// Helpers
function validateBasisMatchesUnit(
  basis: import("./basis.js").BasisDefinition,
  unit: import("@vetwo/units").Unit,
): void {
  const expectedTag = basis.unitBasis;
  const actualTag = unit.basis;
  if (actualTag !== undefined && expectedTag !== undefined && actualTag !== expectedTag) {
    throw new InvalidNutritionBasisError(basis.id, `unit basis "${actualTag}" vs "${basis.id}"`);
  }
  if (actualTag !== undefined && expectedTag === undefined) {
    throw new InvalidNutritionBasisError(
      basis.id,
      `unit carries basis "${actualTag}" but basis is "${basis.id}"`,
    );
  }
}

function stripBasisTag(symbol: string, basis: import("./basis.js").BasisDefinition): string {
  if (!basis.unitBasis) return symbol;
  const suffix = ` ${basis.unitBasis}`;
  if (symbol.endsWith(suffix)) return symbol.slice(0, -suffix.length);
  return symbol;
}
